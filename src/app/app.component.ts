import { AfterViewInit, Component, ElementRef, OnDestroy, QueryList, ViewChild, ViewChildren, computed, signal } from '@angular/core';
import { environment } from '../environments/environment';
import { pad2, pad3 } from '../format';
import { DEFAULT_MODULATION, MODULATION_RATES, modulateSound, restoreModulation, type Modulation } from '../modulation';
import { DEFAULT_SOUND, SOUND_CONTROLS, effectiveSound, voiceShape, type PadSound, type SoundKey, type SoundSettings } from '../sampler';
import { PAD_COUNT, ROW_COUNT, VIEW_STEPS, assignRowSample, columnOf, columnPads, moveStep, quantizeAudioSlices, rowOf, rowPads, sliceBounds, type AudioSlice } from '../sequencer';
import { SLICE_COUNT, boundariesToSlices, equalBoundaries, moveBoundary, slicesToBoundaries, transientBoundaries, type AutomaticSliceMode, type SliceMode, type SliceState } from '../slices';
import { TERMINAL_ROW_COLORS, getRowColor } from '../terminal-theme';
import { buildWaveformPeaks, type WaveformPeaks } from '../waveform/waveform-peaks';
import type { WaveformVoice } from '../waveform/waveform-renderer';
import { SourceEditorComponent } from '../waveform/source-editor.component';
import { createOutputChain, createVoice, decodeStoredAudio, playTestTone, requestPlaybackAudioSession } from './audio-graph';
import { downloadBlob, renderLoopWav } from './loop-export';
import { deleteCachedTrack, encodeMp3, fetchCachedAudio, importYoutubeAudio, listCachedTracks, type CachedTrack } from './media-api';
import { parseSession, readSavedSession, serializeSession, writeSavedSession, type SessionState } from './session';

type GridAction = 'pattern' | 'edit';
type SoundScope = 'global' | 'row';
type LoopFormat = 'wav' | 'mp3';
type SliceAnalysis = ReturnType<typeof quantizeAudioSlices>;

/** A sequencer step placed on the audio clock that the playhead has not reached yet. */
interface ScheduledStep {
  time: number;
  column: number;
  /** Steps since Play, used to sample modulation. */
  step: number;
}

/** A voice started on the audio clock. Kept to light its pad, draw it on the waveform, and re-voice it if edited before it sounds. */
interface ScheduledVoice extends WaveformVoice {
  index: number;
  source: AudioBufferSourceNode;
  step: number;
  override?: SoundSettings;
  raw?: boolean;
}

const LOOKAHEAD_SECONDS = 0.1;
const SCHEDULER_INTERVAL_MS = 25;
const MAX_FILE_BYTES = 150 * 1024 * 1024;
const IMPORT_TIMEOUT_MS = 360_000;
/** Below this, beat detection is treated as a guess and the current tempo is kept. */
const BEAT_CONFIDENCE = 0.015;
const RAW_SOUND: SoundSettings = {...DEFAULT_SOUND, attack: 0, release: 0};
const MUTED_MESSAGE = 'Master volume is at 0%. Raise the Volume control to hear audio.';

@Component({
  selector: 'app-root',
  imports: [SourceEditorComponent],
  templateUrl: './app.component.html',
  host: {
    '(document:keydown)': 'onKeydown($event)',
    '(document:pointermove)': 'continuePadGesture($event)',
    '(document:pointerup)': 'endPadGesture($event)',
    '(document:pointercancel)': 'endPadGesture($event)',
  },
})
export class AppComponent implements AfterViewInit, OnDestroy {
  /** YouTube import, cached audio and MP3 export need the self-hosted media service. */
  readonly mediaService = environment.mediaService;

  readonly logoColors = Array.from({length: 16}, (_, index) => TERMINAL_ROW_COLORS[index % TERMINAL_ROW_COLORS.length]);
  readonly rowColors = Array.from({length: PAD_COUNT}, (_, index) => getRowColor(rowOf(index)));
  readonly steps = Array.from({length: VIEW_STEPS}, (_, step) => step);
  readonly soundControls = SOUND_CONTROLS;
  readonly modulationRates = MODULATION_RATES;

  // ── Pattern & selection ──
  readonly pattern = signal<boolean[]>(Array(PAD_COUNT).fill(false));
  /** The source slice played by each row. */
  readonly rowSamples = signal<number[]>(Array.from({length: ROW_COUNT}, (_, row) => row * VIEW_STEPS));
  readonly mode = signal<GridAction>('pattern');
  readonly selected = signal(0);
  /** Pad being Shift-dragged to another step in its row, or -1. */
  readonly dragSource = signal(-1);
  readonly selectedRow = computed(() => rowOf(this.selected()));
  readonly selectedSlice = computed(() => this.rowSamples()[this.selectedRow()]);
  readonly enabledCount = computed(() => this.pattern().filter(Boolean).length);

  // ── Transport ──
  readonly running = signal(false);
  /** Column under the playhead, or -1 when stopped. */
  readonly column = signal(-1);
  readonly bpm = signal(120);
  readonly volume = signal(70);

  // ── Sound ──
  readonly globalSound = signal<SoundSettings>({...DEFAULT_SOUND});
  readonly rowSounds = signal<PadSound[]>(Array.from({length: ROW_COUNT}, () => ({})));
  readonly soundScope = signal<SoundScope>('global');
  readonly modulation = signal<Modulation>({...DEFAULT_MODULATION});
  /** The settings shown in the Sound panel: global defaults, or the selected row with overrides applied. */
  readonly editorSound = computed(() => this.soundScope() === 'global'
    ? this.globalSound()
    : effectiveSound(this.globalSound(), this.rowSounds()[this.selectedRow()]));

  // ── Source audio ──
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly exporting = signal(false);
  /** YouTube video id of a cached source, or empty for local files. */
  readonly sourceId = signal('');
  readonly fileName = signal('');
  readonly duration = signal(0);
  readonly sliceState = signal<SliceState | null>(null);
  readonly waveformPeaks = signal<WaveformPeaks | null>(null);
  private readonly audioFormat = signal<{length: number; sampleRate: number} | null>(null);
  private readonly resolvedSlices = computed(() => {
    const state = this.sliceState(), format = this.audioFormat();
    return state && format ? boundariesToSlices(state.boundaries, format.length, format.sampleRate) : [];
  });
  /** Automatic boundary maps for the current source, computed lazily per mode. */
  private automaticMaps: Partial<Record<AutomaticSliceMode, number[]>> = {};
  private analysis?: Pick<SliceAnalysis, 'bpm' | 'confidence'>;

  // ── Cached audio storage (media service only) ──
  readonly storageOpen = signal(false);
  readonly storageLoading = signal(false);
  readonly storageBytes = signal(0);
  readonly cachedTracks = signal<CachedTrack[]>([]);

  readonly message = signal('Import a recording, select slices, then press Play.');

  // ── View-derived labels ──
  readonly statusLabel = computed(() => this.running() ? 'Playing' : this.loaded() ? 'Ready' : 'No audio loaded');
  readonly playLabel = computed(() =>
    this.loading() ? 'Loading audio…' : !this.loaded() ? 'Load audio to play' : this.running() ? 'Playing' : '▶ Play');
  readonly gridHint = computed(() =>
    this.mode() === 'edit' ? 'Select a pad to edit' : this.running() ? 'Tap to change steps' : 'Tap to toggle + preview');
  readonly sourceSummary = computed(() =>
    this.loaded() ? `${this.duration().toFixed(1)} s · 256 slices` : this.mediaService ? 'YouTube or local file' : 'Local audio or video file');
  readonly canExportLoop = computed(() => !this.exporting() && this.loaded() && this.enabledCount() > 0);
  readonly modulationHint = computed(() => {
    switch (this.modulation().target) {
      case 'pitch': return 'Up to ±12 semitones. Pitch also changes slice length.';
      case 'pan': return 'Adds stereo movement to each pad’s pan setting.';
      default: return 'Higher depth makes the quiet steps softer.';
    }
  });

  // ── Audio engine ──
  private context?: AudioContext;
  private master?: GainNode;
  private buffer?: AudioBuffer;
  private importController?: AbortController;
  /** Every source node that may still sound, so Stop can silence them. */
  private readonly activeSources = new Set<AudioBufferSourceNode>();
  private scheduledVoices: ScheduledVoice[] = [];

  // ── Lookahead scheduler ──
  private schedulerTimer?: ReturnType<typeof setInterval>;
  private upcomingSteps: ScheduledStep[] = [];
  private nextStepTime = 0;
  private nextColumn = 0;
  private nextStep = 0;
  /** Incremented by Stop so pending async starts and previews can tell they are stale. */
  private generation = 0;

  // ── Pad lighting (direct DOM updates, outside change detection) ──
  @ViewChildren('padButton') private padButtons!: QueryList<ElementRef<HTMLButtonElement>>;
  @ViewChild(SourceEditorComponent) private sourceEditor?: SourceEditorComponent;
  private padNodes: HTMLButtonElement[] = [];
  private litPads = new Set<number>();
  private animationFrame = 0;
  /** Audio time of the next light change; 0 forces a repaint. */
  private nextPaintTime = 0;

  // ── Pad pointer gesture ──
  private padGestureActive = false;
  private paintingPads = false;
  /** Whether the current paint stroke turns pads on or off. */
  private paintEnabled = true;
  /** Touch pointerdown cannot unlock audio, so touch previews wait for pointerup. */
  private deferPadPreview = false;
  private pendingPadPreview = -1;

  constructor() {
    try {
      const saved = readSavedSession();
      if (saved) this.applySession(parseSession(saved));
    } catch {
      this.message.set('Could not restore the saved pattern. Import a backup or start fresh.');
    }
    const sourceId = this.sourceId();
    if (sourceId && this.mediaService) {
      queueMicrotask(() => {
        if (this.sourceId() === sourceId && !this.loaded()) void this.loadSavedAudio(sourceId);
      });
    }
  }

  ngAfterViewInit() {
    this.padNodes = this.padButtons.map(pad => pad.nativeElement);
  }

  ngOnDestroy() {
    this.importController?.abort();
    this.stop();
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close();
    }
  }

  // ════════════════════════ Keyboard & grid ════════════════════════

  onKeydown(event: KeyboardEvent) {
    if (event.code !== 'Space' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
    // Leave text fields, sliders, file pickers and native disclosure controls to the browser.
    const target = event.target;
    const isEditable = target instanceof Element && (
      target.closest('input, textarea, select, summary, a, [role="textbox"], [role="slider"]') ||
      (target instanceof HTMLElement && target.isContentEditable));
    if (isEditable) return;
    event.preventDefault();
    if (event.repeat) return;
    if (this.running()) this.stop();
    else void this.start();
  }

  setGridAction(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    if (value !== 'pattern' && value !== 'edit') return;
    this.mode.set(value);
    if (value === 'edit') this.soundScope.set('row');
  }

  padLabel(index: number) {
    const row = rowOf(index);
    const state = this.pattern()[index] ? 'enabled' : 'disabled';
    return `Slice ${this.rowSamples()[row] + 1}, row ${row + 1}, step ${columnOf(index) + 1}, ${state}`;
  }

  canDropOn(target: number) {
    const source = this.dragSource();
    return source >= 0 && source !== target && !this.pattern()[target] && rowOf(source) === rowOf(target);
  }

  beginPadGesture(event: PointerEvent, index: number) {
    if (event.button !== 0) return;
    event.preventDefault();
    if (this.mode() === 'edit') {
      this.press(index);
      return;
    }
    this.padGestureActive = true;
    this.deferPadPreview = event.pointerType !== 'mouse';
    this.pendingPadPreview = -1;
    if (event.shiftKey && this.pattern()[index]) {
      this.dragSource.set(index);
      this.paintingPads = false;
      return;
    }
    this.dragSource.set(-1);
    this.paintingPads = true;
    this.paintEnabled = !this.pattern()[index];
    this.paintPad(index);
  }

  continuePadGesture(event: PointerEvent) {
    if (!this.paintingPads && this.dragSource() < 0) return;
    const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-pad-index]');
    const target = Number(element?.dataset['padIndex']);
    if (!Number.isInteger(target) || target < 0 || target >= PAD_COUNT) return;

    const source = this.dragSource();
    if (source >= 0) {
      if (!this.canDropOn(target)) return;
      this.pattern.set(moveStep(this.pattern(), source, target));
      this.selected.set(target);
      this.dragSource.set(-1);
      this.reconcileQueuedPads([source, target]);
      this.persist();
      this.message.set('Step moved.');
      return;
    }
    if (this.paintingPads) this.paintPad(target);
  }

  endPadGesture(event: PointerEvent) {
    if (!this.padGestureActive) return;
    const preview = this.pendingPadPreview;
    this.padGestureActive = false;
    this.paintingPads = false;
    this.dragSource.set(-1);
    this.deferPadPreview = false;
    this.pendingPadPreview = -1;
    // Touch/pen pointerdown does not authorize audio. Resume directly inside pointerup,
    // after painting, without toggling the pad a second time or queueing locked previews.
    if (event.type === 'pointerup' && preview >= 0 && !this.running() && this.pattern()[preview]) void this.audition(preview);
  }

  press(index: number, event?: MouseEvent) {
    // Pointer input was already handled on pointerdown for responsive drag painting.
    // Keep click activation for keyboard and assistive input, which has detail === 0.
    if (event && event.detail > 0) return;
    this.selected.set(index);
    if (this.mode() === 'edit') {
      this.soundScope.set('row');
      return;
    }
    this.setPadEnabled(index, !this.pattern()[index]);
    if (!this.running() && this.pattern()[index]) void this.audition(index);
  }

  private paintPad(index: number) {
    if (this.pattern()[index] === this.paintEnabled) return;
    this.setPadEnabled(index, this.paintEnabled);
    if (!this.paintEnabled || this.running()) return;
    if (this.deferPadPreview) this.pendingPadPreview = index;
    else void this.audition(index);
  }

  private setPadEnabled(index: number, enabled: boolean) {
    this.selected.set(index);
    this.pattern.update(pattern => pattern.map((value, pad) => pad === index ? enabled : value));
    // Edits made just before the playhead arrives are still heard (or silenced).
    if (enabled) this.triggerAtUpcomingSteps(index);
    else if (this.running()) this.cancelQueuedVoices(voice => voice.index === index);
    this.nextPaintTime = 0;
    this.persist();
  }

  clearPattern() {
    this.stop();
    this.pattern.set(Array(PAD_COUNT).fill(false));
    this.persist();
  }

  // ════════════════════════ Loading source audio ════════════════════════

  async loadFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.loading()) return;
    if (file.size > MAX_FILE_BYTES) {
      this.message.set('Choose a file smaller than 150 MB to limit browser memory use.');
      return;
    }

    this.stop();
    this.loading.set(true);
    this.message.set('Decoding audio…');
    try {
      const decoded = await this.audioContext().decodeAudioData(await file.arrayBuffer());
      if (decoded.length < SLICE_COUNT) throw new Error('Too short');
      // Reloading the same local file keeps its saved slice edits.
      const sameFile = !this.sourceId() && this.fileName() === file.name && Math.abs(this.duration() - decoded.duration) < 0.1;
      const analysis = this.useSource(decoded, file.name, '', sameFile);
      this.message.set(this.sliceMapMessage(analysis));
    } catch {
      this.message.set('Could not decode this file. Try WAV, MP3, or an audio track exported from your video.');
    } finally {
      this.loading.set(false);
    }
  }

  async importYoutube(url: string) {
    if (this.loading()) return;
    this.stop();
    this.loading.set(true);
    this.message.set('Checking YouTube link…');
    const controller = new AbortController();
    this.importController = controller;
    const timeout = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_MS);

    try {
      const job = await importYoutubeAudio(url, controller.signal, progress => this.message.set(progress));
      this.message.set('Decoding audio and mapping 256 slices…');
      const bytes = await fetchCachedAudio(job.id, 'Cached audio expired. Import the link again.', controller.signal);
      const decoded = await decodeStoredAudio(bytes);
      if (controller.signal.aborted) return;

      const analysis = this.useSource(decoded, job.title, job.id, this.sourceId() === job.id);
      const size = `${(job.bytes / 1_000_000).toFixed(2)} MB${job.cached ? ' · loaded from cache' : ''}`;
      this.message.set(`${this.sliceMapMessage(analysis)} · ${size}. Select squares and press Play.`);
    } catch (error) {
      this.message.set(error instanceof Error && error.name !== 'AbortError' ? error.message : 'Import timed out. Try again or choose a shorter video.');
    } finally {
      clearTimeout(timeout);
      this.importController = undefined;
      this.loading.set(false);
    }
  }

  reloadAudio() {
    if (this.sourceId()) void this.importYoutube(`https://www.youtube.com/watch?v=${this.sourceId()}`);
  }

  /** Restore the cached YouTube audio for a session saved in this browser. */
  private async loadSavedAudio(id: string) {
    if (this.loading() || this.loaded()) return;
    this.loading.set(true);
    this.message.set('Restoring cached audio…');
    try {
      const bytes = await fetchCachedAudio(id, 'Saved audio expired. Open Source to import the link again.');
      const decoded = await decodeStoredAudio(bytes);
      if (this.sourceId() !== id) return;
      this.useSource(decoded, this.fileName(), id, true);
      this.message.set('Cached audio ready. Press Space or Play.');
    } catch (error) {
      if (this.sourceId() === id) {
        this.message.set(error instanceof Error ? error.message : 'Could not restore cached audio. Open Source to import it again.');
      }
    } finally {
      this.loading.set(false);
    }
  }

  clearAudio() {
    this.stop();
    this.buffer = undefined;
    this.sliceState.set(null);
    this.audioFormat.set(null);
    this.waveformPeaks.set(null);
    this.automaticMaps = {};
    this.analysis = undefined;
    this.loaded.set(false);
    this.sourceId.set('');
    this.fileName.set('');
    this.duration.set(0);
    this.persist();
    this.message.set('Audio unloaded from memory.');
  }

  private useSource(buffer: AudioBuffer, name: string, sourceId: string, preserveSlices: boolean) {
    this.buffer = buffer;
    this.duration.set(buffer.duration);
    this.fileName.set(name);
    this.sourceId.set(sourceId);
    const analysis = this.analyzeSource(buffer, preserveSlices);
    this.loaded.set(true);
    this.persist();
    return analysis;
  }

  /** Detect tempo, build the beat and equal slice maps and the waveform, and pick the slice state for this source. */
  private analyzeSource(buffer: AudioBuffer, preserveSlices: boolean) {
    const channels = channelData(buffer);
    const previous = preserveSlices ? this.sliceState() : null;
    const analysis = quantizeAudioSlices(channels, buffer.sampleRate, this.bpm());

    this.analysis = {bpm: analysis.bpm, confidence: analysis.confidence};
    this.automaticMaps = {
      beat: slicesToBoundaries(analysis.slices, buffer.duration),
      equal: equalBoundaries(buffer.length),
    };
    this.audioFormat.set({length: buffer.length, sampleRate: buffer.sampleRate});
    this.sliceState.set(previous ? this.fitSliceStateToBuffer(previous, buffer) : this.automaticState('beat'));
    this.waveformPeaks.set(buildWaveformPeaks(channels, buffer.sampleRate));
    if (!previous && analysis.confidence > BEAT_CONFIDENCE) this.bpm.set(analysis.bpm);
    return analysis;
  }

  /** Snap normalized boundaries to whole frames of this buffer. */
  private fitSliceStateToBuffer(state: SliceState, buffer: AudioBuffer): SliceState {
    const slices = boundariesToSlices(state.boundaries, buffer.length, buffer.sampleRate);
    return {...state, boundaries: slicesToBoundaries(slices, buffer.duration)};
  }

  private sliceMapMessage(analysis: SliceAnalysis) {
    const confident = analysis.confidence > BEAT_CONFIDENCE;
    if (!analysis.quantized) {
      return confident
        ? `Beat grid detected at ${analysis.bpm} BPM; using even slices because the recording is too short for 256 distinct grid points`
        : 'Recording is too short for 256 distinct beat-grid slices; using even slices';
    }
    return confident
      ? `Beat grid detected at ${analysis.bpm} BPM · 256 quantized slices ready`
      : `No clear beat grid detected; slices aligned to ${analysis.bpm} BPM`;
  }

  // ════════════════════════ Cached audio storage ════════════════════════

  toggleStorage() {
    this.storageOpen.update(open => !open);
    if (this.storageOpen()) void this.refreshStorage();
  }

  async refreshStorage() {
    this.storageLoading.set(true);
    try {
      const {tracks, totalBytes} = await listCachedTracks();
      this.cachedTracks.set(tracks);
      this.storageBytes.set(totalBytes);
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : 'Could not read audio storage.');
    } finally {
      this.storageLoading.set(false);
    }
  }

  async removeCachedTrack(id: string) {
    try {
      await deleteCachedTrack(id);
      if (this.sourceId() === id) this.clearAudio();
      await this.refreshStorage();
      this.message.set('Cached track removed from this device.');
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : 'Could not remove cached audio.');
    }
  }

  formatBytes(bytes: number) {
    return bytes < 1_000_000 ? `${(bytes / 1000).toFixed(0)} KB` : `${(bytes / 1_000_000).toFixed(2)} MB`;
  }

  // ════════════════════════ Slices ════════════════════════

  private automaticState(mode: AutomaticSliceMode): SliceState {
    if (!this.automaticMaps[mode] && this.buffer) {
      this.automaticMaps[mode] = transientBoundaries(channelData(this.buffer), this.buffer.sampleRate);
    }
    return {
      mode,
      automaticMode: mode,
      boundaries: [...this.automaticMaps[mode]!],
      manuallyEdited: false,
      bpm: this.analysis?.bpm,
      confidence: this.analysis?.confidence,
    };
  }

  setSliceMode(mode: SliceMode) {
    const state = this.sliceState();
    if (!state || !this.buffer) return;
    this.sliceState.set(mode === 'manual' ? {...state, mode} : this.automaticState(mode));
    this.refreshQueuedSound(true);
    this.persist();
  }

  resetSlices() {
    const state = this.sliceState();
    if (state) this.setSliceMode(state.automaticMode);
  }

  editBoundary(edit: {index: number; seconds: number; commit: boolean}) {
    const state = this.sliceState();
    if (!state || !this.buffer) return;
    const next = moveBoundary(state, edit.index, edit.seconds, this.buffer.length, this.buffer.sampleRate);
    if (next !== state) {
      this.sliceState.set(next);
      this.refreshQueuedSound(true);
    }
    if (edit.commit) this.persist();
  }

  selectSourceRow(row: number) {
    if (!Number.isInteger(row) || row < 0 || row >= ROW_COUNT) return;
    this.selected.set(row * VIEW_STEPS + columnOf(this.selected()));
    this.soundScope.set('row');
  }

  assignWaveformSlice(slice: number) {
    if (!Number.isInteger(slice) || slice < 0 || slice >= SLICE_COUNT) return;
    const row = this.selectedRow();
    this.rowSamples.set(assignRowSample(this.rowSamples(), row, slice));
    this.reconcileQueuedPads(rowPads(row));
    this.persist();
    this.message.set(`Row ${row + 1} → Slice ${pad3(slice + 1)}.`);
    if (!this.running()) void this.audition(this.selected());
  }

  auditionWaveform(raw: boolean) {
    void this.audition(this.selected(), false, raw);
  }

  /** Time range of a source slice, falling back to an even division if the slice map is unusable. */
  private sliceBoundsFor(slice: number): AudioSlice {
    if (!this.buffer) return {offset: 0, duration: 0};
    const index = Number.isInteger(slice) ? Math.max(0, Math.min(SLICE_COUNT - 1, slice)) : 0;
    const resolved = this.resolvedSlices()[index];
    const frame = 1 / this.buffer.sampleRate;
    const valid = resolved && Number.isFinite(resolved.offset) && Number.isFinite(resolved.duration) &&
      resolved.offset >= 0 && resolved.duration > 0 && resolved.offset + resolved.duration <= this.buffer.duration + frame;
    if (!valid) return sliceBounds(this.buffer.length, this.buffer.sampleRate, index);
    return {offset: resolved.offset, duration: Math.min(resolved.duration, this.buffer.duration - resolved.offset)};
  }

  // ════════════════════════ Sound shaping ════════════════════════

  hasOverride(key: SoundKey) {
    return Object.hasOwn(this.rowSounds()[this.selectedRow()], key);
  }

  shapedTime() {
    if (!this.buffer) return 'Import audio to see the playback length';
    const bounds = this.sliceBoundsFor(this.selectedSlice());
    const shape = voiceShape(bounds.duration, this.editorSound());
    return `${(shape.duration * 1000).toFixed(1)} ms playback · ${(bounds.duration * 1000).toFixed(1)} ms full slice`;
  }

  setSound(key: SoundKey, event: Event) {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value);
    if (input.value.trim() !== '' && Number.isFinite(value)) this.updateSound(key, value);
    input.value = String(this.editorSound()[key]);
  }

  inheritSound(key: SoundKey) {
    this.updateSelectedRowSound(sound => {
      const next = {...sound};
      delete next[key];
      return next;
    });
    this.refreshQueuedSound();
    this.persist();
  }

  resetSound() {
    if (this.soundScope() === 'global') this.globalSound.set({...DEFAULT_SOUND});
    else this.updateSelectedRowSound(() => ({}));
    this.refreshQueuedSound();
    this.persist();
  }

  lengthPreset(preset: 'blip' | 'full') {
    if (preset === 'full') {
      this.updateSound('length', 100);
    } else if (this.buffer) {
      // Length is a percentage of the slice, so 10 ms depends on the slice's duration.
      const sliceMs = this.sliceBoundsFor(this.selectedSlice()).duration * 1000;
      this.updateSound('length', Math.round(10 / sliceMs * 1000) / 10);
    }
  }

  private updateSound(key: SoundKey, value: number) {
    const control = SOUND_CONTROLS.find(c => c.key === key)!;
    const clamped = Math.max(control.min, Math.min(control.max, value));
    if (this.soundScope() === 'global') this.globalSound.update(sound => ({...sound, [key]: clamped}));
    else this.updateSelectedRowSound(sound => ({...sound, [key]: clamped}));
    this.refreshQueuedSound();
    this.persist();
  }

  private updateSelectedRowSound(update: (sound: PadSound) => PadSound) {
    const selectedRow = this.selectedRow();
    this.rowSounds.update(rows => rows.map((sound, row) => row === selectedRow ? update(sound) : sound));
  }

  setModulation(key: keyof Modulation, event: Event) {
    const input = event.target as HTMLInputElement;
    const value = key === 'enabled' ? input.checked : key === 'depth' || key === 'steps' ? Number(input.value) : input.value;
    try {
      this.modulation.set(restoreModulation({...this.modulation(), [key]: value}));
      this.refreshQueuedSound(true);
      this.persist();
    } catch {
      this.message.set('Choose a valid modulation setting.');
    }
  }

  // ════════════════════════ Transport ════════════════════════

  async start() {
    if (!this.buffer || this.loading() || this.running()) return;
    if (this.volume() === 0) {
      this.message.set(MUTED_MESSAGE);
      return;
    }
    const generation = this.generation;
    try {
      const context = this.audioContext();
      await context.resume();
      if (generation !== this.generation || this.running()) return;
      if (context.state !== 'running') throw new Error('Browser audio output is suspended.');

      this.running.set(true);
      this.nextColumn = 0;
      this.nextStep = 0;
      this.nextStepTime = context.currentTime + 0.05;
      this.schedule();
      this.schedulerTimer = setInterval(() => this.schedule(), SCHEDULER_INTERVAL_MS);
      this.animate();
      this.message.set('Sequencing. Toggle squares to change the pattern.');
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : 'Audio could not start. Press Play to try again.');
    }
  }

  stop() {
    if (this.running()) this.message.set('Stopped. Press Play to start from the first column.');
    this.generation++;
    this.running.set(false);
    clearInterval(this.schedulerTimer);
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;

    for (const source of this.activeSources) {
      try { source.stop(); } catch {}
    }
    this.activeSources.clear();
    this.upcomingSteps = [];
    this.scheduledVoices = [];

    this.sourceEditor?.paintActivity([], 0);
    this.column.set(-1);
    for (const index of this.litPads) this.padNodes[index]?.classList.remove('active');
    this.litPads.clear();
    this.nextPaintTime = 0;
  }

  setTempo(event: Event) {
    const input = event.target as HTMLInputElement;
    const bpm = Number(input.value);
    if (Number.isFinite(bpm)) this.bpm.set(Math.max(30, Math.min(300, bpm)));
    input.value = String(this.bpm());
    this.persist();
  }

  setVolume(event: Event) {
    const input = event.target as HTMLInputElement;
    const volume = Number(input.value);
    if (Number.isFinite(volume)) this.volume.set(Math.max(0, Math.min(100, volume)));
    input.value = String(this.volume());
    this.applyMasterVolume();
    this.persist();
  }

  private applyMasterVolume() {
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.volume() / 100, this.context.currentTime, 0.01);
  }

  /** Queue every step that falls inside the lookahead window onto the audio clock. */
  private schedule() {
    if (!this.context || !this.running()) return;
    const now = this.context.currentTime;
    const stepDuration = 60 / this.bpm() / 4;

    // Skip missed steps after timer throttling instead of firing a burst of notes.
    if (this.nextStepTime < now) {
      const missed = Math.ceil((now - this.nextStepTime) / stepDuration);
      this.nextColumn = (this.nextColumn + missed) % VIEW_STEPS;
      this.nextStep += missed;
      this.nextStepTime += missed * stepDuration;
    }

    while (this.nextStepTime < now + LOOKAHEAD_SECONDS) {
      for (const index of columnPads(this.pattern(), this.nextColumn)) this.trigger(index, this.nextStepTime, undefined, this.nextStep);
      this.upcomingSteps.push({time: this.nextStepTime, column: this.nextColumn, step: this.nextStep});
      this.nextColumn = (this.nextColumn + 1) % VIEW_STEPS;
      this.nextStep++;
      this.nextStepTime += stepDuration;
    }
  }

  // ════════════════════════ Voices ════════════════════════

  private audioContext() {
    requestPlaybackAudioSession();
    if (!this.context) {
      this.context = new AudioContext();
      this.master = createOutputChain(this.context, this.volume());
      this.context.onstatechange = () => {
        if (this.context?.state !== 'running' && this.running()) {
          this.stop();
          this.message.set('Audio was interrupted. Press Play to resume.');
        }
      };
    }
    return this.context;
  }

  private now() {
    return this.context?.currentTime ?? 0;
  }

  /** Play a pad now, outside the sequence. `globalPreview` ignores row overrides; `raw` bypasses all shaping. */
  async audition(index: number, globalPreview = false, raw = false) {
    if (!this.buffer || this.loading()) {
      this.message.set('Import a recording first.');
      return;
    }
    const generation = this.generation;
    if (this.volume() === 0) {
      this.message.set(MUTED_MESSAGE);
      return;
    }
    try {
      const context = this.audioContext();
      await context.resume();
      if (generation !== this.generation) return;
      if (context.state !== 'running') throw new Error('Audio output is suspended.');
      this.trigger(index, context.currentTime + 0.005, globalPreview ? this.globalSound() : undefined, 0, raw);
      this.animate();
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : 'Audio could not start. Try previewing again.');
    }
  }

  async testOutput() {
    if (this.volume() === 0) {
      this.message.set(MUTED_MESSAGE);
      return;
    }
    try {
      const context = this.audioContext();
      await context.resume();
      if (context.state !== 'running' || !this.master) throw new Error('Browser audio output is suspended.');
      playTestTone(context, this.master);
      this.message.set('Speaker test tone sent.');
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : 'Browser audio output could not start.');
    }
  }

  /** Start one pad's slice at `time` on the audio clock. */
  private trigger(index: number, time: number, override?: SoundSettings, step = 0, raw = false) {
    if (!this.buffer || !this.context || !this.master) return;
    const row = rowOf(index);
    const bounds = this.sliceBoundsFor(this.rowSamples()[row]);
    const settings = override ?? effectiveSound(this.globalSound(), this.rowSounds()[row]);
    const shape = voiceShape(bounds.duration, raw ? RAW_SOUND : modulateSound(settings, this.modulation(), step));
    const voice = createVoice(this.context, this.master, this.buffer, shape, time);
    const {source} = voice;

    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
      voice.disconnect();
    };
    try {
      source.start(time, bounds.offset, shape.sourceDuration);
    } catch {
      this.activeSources.delete(source);
      voice.disconnect();
      this.message.set('Audio playback failed. Reload the recording and try again.');
      return;
    }

    this.scheduledVoices.push({
      index, source, step, override, raw,
      start: time,
      end: time + shape.duration,
      offset: bounds.offset,
      sourceDuration: shape.sourceDuration,
      rate: shape.rate,
    });
    this.nextPaintTime = 0;
  }

  /** Trigger a newly enabled pad for steps already queued in the lookahead window. */
  private triggerAtUpcomingSteps(index: number) {
    const now = this.now();
    for (const step of this.upcomingSteps) {
      if (step.time > now && step.column === columnOf(index)) this.trigger(index, step.time, undefined, step.step);
    }
  }

  /** Stop and forget voices that have not started yet. */
  private cancelQueuedVoices(shouldCancel: (voice: ScheduledVoice) => boolean) {
    const now = this.now();
    const cancelled = new Set(this.scheduledVoices.filter(voice => voice.start > now && shouldCancel(voice)));
    for (const voice of cancelled) voice.source.stop();
    this.scheduledVoices = this.scheduledVoices.filter(voice => !cancelled.has(voice));
    return [...cancelled];
  }

  /** Re-voice queued notes after a sound or slice edit. By default only the rows the Sound panel is editing. */
  private refreshQueuedSound(all = false) {
    const editedRow = this.selectedRow();
    const affects = (voice: ScheduledVoice) => all || this.soundScope() === 'global' || rowOf(voice.index) === editedRow;
    for (const voice of this.cancelQueuedVoices(affects)) {
      this.trigger(voice.index, voice.start, voice.override, voice.step, voice.raw);
    }
    this.nextPaintTime = 0;
  }

  /** After pattern or row-slice edits, replace queued voices for the given pads to match the new pattern. */
  private reconcileQueuedPads(indices: number[]) {
    if (!this.running()) return;
    const affected = new Set(indices);
    const now = this.now();
    this.cancelQueuedVoices(voice => affected.has(voice.index));
    for (const step of this.upcomingSteps) {
      for (const index of affected) {
        const due = this.pattern()[index] && step.time > now && step.column === columnOf(index);
        const alreadyQueued = this.scheduledVoices.some(voice => voice.index === index && voice.start === step.time);
        if (due && !alreadyQueued) this.trigger(index, step.time, undefined, step.step);
      }
    }
  }

  // ════════════════════════ Animation ════════════════════════

  /** Drive the playhead, pad lights and waveform activity from the audio clock while anything is sounding. */
  private animate() {
    if (this.animationFrame) return;
    const frame = () => {
      this.animationFrame = 0;
      const now = this.now();

      let column = this.column();
      while (this.upcomingSteps.length && this.upcomingSteps[0].time <= now) column = this.upcomingSteps.shift()!.column;
      if (column !== this.column()) this.column.set(column);

      this.paintLights(now);
      this.sourceEditor?.paintActivity(this.scheduledVoices, now);
      if (this.running() || this.scheduledVoices.length) this.animationFrame = requestAnimationFrame(frame);
    };
    this.animationFrame = requestAnimationFrame(frame);
  }

  private paintLights(now: number) {
    if (now < this.nextPaintTime) return;
    const lit = new Set<number>();
    const remaining: ScheduledVoice[] = [];
    this.nextPaintTime = Infinity;

    for (const voice of this.scheduledVoices) {
      if (voice.end <= now) continue;
      remaining.push(voice);
      if (voice.start <= now) {
        lit.add(voice.index);
        this.nextPaintTime = Math.min(this.nextPaintTime, voice.end);
      } else {
        this.nextPaintTime = Math.min(this.nextPaintTime, voice.start);
      }
    }
    this.scheduledVoices = remaining;

    // Only touch pads whose light actually changed; do not invalidate the entire Angular view.
    for (const index of this.litPads) if (!lit.has(index)) this.padNodes[index]?.classList.remove('active');
    for (const index of lit) if (!this.litPads.has(index)) this.padNodes[index]?.classList.add('active');
    this.litPads = lit;
  }

  // ════════════════════════ Sessions & export ════════════════════════

  private sessionState(): SessionState {
    return {
      sliceState: this.sliceState(),
      sourceDuration: this.duration(),
      pattern: this.pattern(),
      rowSamples: this.rowSamples(),
      bpm: this.bpm(),
      volume: this.volume(),
      sourceName: this.fileName(),
      sourceId: this.sourceId(),
      globalSound: this.globalSound(),
      rowSounds: this.rowSounds(),
      modulation: this.modulation(),
    };
  }

  /** Apply an already validated session. Source details only change when no audio is loaded. */
  private applySession(session: SessionState) {
    let sliceState = session.sliceState;
    if (this.buffer) sliceState = sliceState ? this.fitSliceStateToBuffer(sliceState, this.buffer) : this.automaticState('beat');

    this.sliceState.set(sliceState);
    this.modulation.set(session.modulation);
    this.globalSound.set(session.globalSound);
    this.rowSounds.set(session.rowSounds);
    if (!this.loaded()) {
      this.duration.set(session.sourceDuration ?? 0);
      this.sourceId.set(session.sourceId);
      this.fileName.set(session.sourceName);
    }
    this.pattern.set(session.pattern);
    this.rowSamples.set(session.rowSamples);
    this.bpm.set(session.bpm);
    this.volume.set(session.volume);
    this.applyMasterVolume();
  }

  private persist() {
    try {
      writeSavedSession(this.sessionState());
    } catch {
      this.message.set('Storage unavailable. Export your pattern to keep it.');
    }
  }

  exportSession() {
    const json = JSON.stringify(serializeSession(this.sessionState()), null, 2);
    downloadBlob(new Blob([json], {type: 'application/json'}), 'stepfield-pattern.json');
  }

  async importSession(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      if (file.size > 100_000) throw new Error('Pattern file too large');
      this.applySession(parseSession(JSON.parse(await file.text())));
      this.stop();
      this.persist();
      this.message.set('Pattern imported. Audio is not included; load the matching recording.');
    } catch {
      this.message.set('Invalid pattern file. Choose an exported audio-grid pattern.');
    }
  }

  async downloadLoop(format: LoopFormat) {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.message.set('Rendering a seamless loop from the current pattern…');
    try {
      if (!this.buffer || !this.enabledCount()) throw new Error('Load audio and enable at least one step before exporting a loop.');
      const wav = await renderLoopWav({
        buffer: this.buffer,
        pattern: [...this.pattern()],
        rowSlices: this.rowSamples().map(slice => this.sliceBoundsFor(slice)),
        bpm: this.bpm(),
        volume: this.volume(),
        globalSound: {...this.globalSound()},
        rowSounds: this.rowSounds().map(sound => ({...sound})),
        modulation: {...this.modulation()},
      });

      let blob: Blob;
      if (format === 'mp3') {
        this.message.set('Rendering loop · converting to MP3…');
        blob = await encodeMp3(wav);
      } else {
        blob = new Blob([wav], {type: 'audio/wav'});
      }
      downloadBlob(blob, `stepfield-${this.bpm()}bpm-${this.enabledCount()}steps.${format}`);

      const megabytes = Math.max(1, Math.round((format === 'wav' ? wav.byteLength : blob.size) / 1_000_000));
      this.message.set(`Loop downloaded as ${format.toUpperCase()} · ${this.bpm()} BPM · ${megabytes} MB.`);
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : 'Could not render the loop. Try WAV or reduce the tempo.');
    } finally {
      this.exporting.set(false);
    }
  }

  readonly pad2 = pad2;
  readonly pad3 = pad3;
}

function channelData(buffer: AudioBuffer) {
  return Array.from({length: buffer.numberOfChannels}, (_, channel) => buffer.getChannelData(channel));
}
