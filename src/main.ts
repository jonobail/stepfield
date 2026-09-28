import { Component, signal, computed, isDevMode, OnDestroy, AfterViewInit, ViewChild, ViewChildren, QueryList, ElementRef } from '@angular/core';
import { DEFAULT_MODULATION, MODULATION_RATES, modulateSound, restoreModulation, type Modulation } from './modulation';
import { bootstrapApplication } from '@angular/platform-browser';
import { sliceBounds, quantizeAudioSlices, columnPads, repeatCellAcrossRow, moveStep, assignRowSample } from './sequencer';
import { DEFAULT_SOUND, SOUND_CONTROLS, effectiveSound, voiceShape, restoreRowSounds, type SoundSettings, type SoundKey, type PadSound } from './sampler';
import { boundariesToSlices, slicesToBoundaries, equalBoundaries, transientBoundaries, moveBoundary, restoreSliceState, type SliceState, type SliceMode, type AutomaticSliceMode } from './slices';
import { WaveformComponent } from './waveform/waveform.component';
import { buildWaveformPeaks, type WaveformPeaks } from './waveform/waveform-peaks';
import type { WaveformVoice } from './waveform/waveform-renderer';
import { getRowColor, TERMINAL_ROW_COLORS } from './terminal-theme';

@Component({selector:'app-root', standalone:true, imports:[WaveformComponent], host:{'(document:keydown)':'onKeydown($event)','(document:pointermove)':'continuePadGesture($event)','(document:pointerup)':'endPadGesture($event)','(document:pointercancel)':'endPadGesture($event)'}, template:`
<header class="app-header"><a class="brand" href="/" aria-label="Stepfield home"><span class="brand-mark" aria-hidden="true">@for (color of logoColors; track $index) {<i [style.background]="color"></i>}</span>Stepfield</a><span class="online" [class.is-playing]="running()"><i></i>{{ running() ? 'Playing' : loaded() ? 'Ready' : 'No audio loaded' }}</span></header>
<main>
<div class="status-bar"><p class="status" role="status">{{ message() }}</p><span>16 × 16</span></div>
<div class="workspace"><section class="instrument" aria-label="Step sequencer">
<div class="grid-area"><div class="step-ruler" aria-hidden="true">@for (step of steps; track step) {<span [class.current]="column() === step">{{ step + 1 }}</span>}</div>
<div class="grid" aria-label="256 audio slices, 16 rows and 16 time steps"><div class="playhead-track" aria-hidden="true">@if (column() >= 0) {<span class="playhead-marker" [style.grid-column]="column() + 1"></span>}</div>@for (enabled of pattern(); track $index) {<button #padButton class="pad" [class.assigned]="enabled" [class.selected]="selected() === $index" [class.dragging]="dragSource() === $index" [class.drop-target]="canDropOn($index)" [style.--row-color]="rowColors[$index]" [attr.data-pad-index]="$index" [attr.aria-pressed]="enabled" [attr.aria-label]="padLabel($index)" [title]="padLabel($index)" (pointerdown)="beginPadGesture($event,$index)" (click)="press($index,$event)"></button>}</div></div>
<div class="grid-footer"><span>{{ enabledCount() }} active <span class="separator">/</span> 256 pads</span><span>{{ mode() === 'pattern' ? (running() ? 'Tap to change steps' : 'Tap to toggle + preview') : 'Select a pad to edit' }}</span><span class="step-count">{{ column() >= 0 ? (column() + 1).toString().padStart(2, '0') : '—' }} / 16</span></div>
</section>
<aside class="inspector" aria-label="Instrument controls"><div class="performance-bar" aria-label="Sequencer controls"><div class="performance-heading"><h2>Sequencer</h2><span>16 × 16</span></div><div class="toolbar"><label class="grid-action">Grid action<select aria-label="Grid action" [value]="mode()" (change)="setGridAction($event)"><option value="pattern">Toggle steps</option><option value="edit">Select pad</option></select></label><div class="transport"><button class="play" [disabled]="!loaded() || loading() || running()" (click)="start()" title="Play · Space">{{ loading() ? 'Loading audio…' : !loaded() ? 'Load audio to play' : running() ? 'Playing' : '▶ Play' }}</button><button class="stop" (click)="stop()" title="Stop · Space">■ Stop</button><button class="clear-pattern" (click)="clearPattern()">Clear pattern</button></div></div>
<div class="transport-settings"><label class="tempo">BPM<input aria-label="Tempo · BPM" type="number" min="30" max="300" [value]="bpm()" (change)="setTempo($event)"></label><label class="master-volume">Volume<input aria-label="Volume · %" type="range" min="0" max="100" [value]="volume()" (input)="setVolume($event)"><span>{{ volume() }}%</span></label><nav class="control-jumps" aria-label="Jump to controls"><a href="#panel-source">Source</a><a href="#panel-sound">Sound</a><a href="#panel-mod">Modulation</a><a href="#panel-session">Session</a></nav></div>
</div><section id="panel-source" class="source-deck" aria-label="Source controls"><div class="source-deck-heading"><div class="source-summary"><span class="source-icon" aria-hidden="true">♫</span><div><p class="source-name" [title]="fileName()">{{ fileName() || 'Load a recording' }}</p><span class="source-meta">{{ loaded() ? duration().toFixed(1) + ' s · 256 slices' : 'YouTube or local file' }}</span></div></div><section id="panel-session" class="session-actions" aria-label="Session controls"><span class="section-label">Session</span><button class="connect" (click)="exportSession()">Export pattern ↗</button><label class="file-picker">Import pattern<input aria-label="Import pattern" type="file" accept="application/json" (change)="importSession($event)"></label><button class="connect loop-export" [disabled]="exporting() || !loaded() || !enabledCount()" (click)="downloadLoop('wav')">{{ exporting() ? 'Rendering loop…' : 'Download loop · WAV' }}</button><button class="connect loop-export" [disabled]="exporting() || !loaded() || !enabledCount()" (click)="downloadLoop('mp3')">Download loop · MP3</button></section></div><form class="youtube-import" (submit)="$event.preventDefault(); importYoutube(youtube.value)"><label>YouTube link<input #youtube type="url" required placeholder="Paste a video link…" [disabled]="loading()"></label><button class="primary" type="submit" [disabled]="loading()">{{ loading() ? 'Importing…' : 'Import YouTube audio' }}</button></form>
<div class="source-extras"><label class="file-picker">Choose audio or video<input aria-label="Import local audio or video" type="file" accept="audio/*,video/*,.wav,.mp3,.m4a,.mp4,.webm,.ogg,.flac" [disabled]="loading()" (change)="loadFile($event)"></label><button class="connect" [hidden]="!sourceId() || loaded()" [disabled]="loading()" (click)="reloadAudio()">Reload saved YouTube audio</button>
</div><section class="storage-manager" aria-label="Audio storage"><button class="connect" (click)="toggleStorage()">{{ storageOpen() ? 'Hide audio storage' : 'Manage audio storage' }}</button>@if (storageOpen()) {<div class="storage-content"><p class="fine">YouTube audio is cached on this device. Local files stay in memory and are not saved.</p>@if (loaded() && !sourceId()) {<div class="storage-track"><span>{{ fileName() }} · current memory</span><button class="inherit" (click)="clearAudio()">Unload</button></div>}<div class="storage-summary"><span>{{ cachedTracks().length }} cached tracks</span><span>{{ formatBytes(storageBytes()) }}</span><button class="inherit" [disabled]="storageLoading()" (click)="refreshStorage()">{{ storageLoading() ? 'Refreshing…' : 'Refresh' }}</button></div>@for (track of cachedTracks(); track track.id) {<div class="storage-track"><span class="storage-title" [title]="track.title">{{ track.title }}<small>{{ track.duration ? (track.duration / 60).toFixed(1) + ' min · ' : '' }}{{ formatBytes(track.bytes) }}</small></span><button class="inherit danger" [disabled]="loading()" [attr.aria-label]="'Remove ' + track.title" (click)="removeCachedTrack(track.id)">Remove</button></div>}@if (!cachedTracks().length && !storageLoading()) {<p class="fine">No cached YouTube tracks.</p>}</div>}</section>
</section>
<source-editor [peaks]="waveformPeaks()" [state]="sliceState()" [duration]="duration()" [selected]="rowSamples()[selectedRow()]" [row]="selectedRow()" [color]="rowColors[selected()]" (selectRow)="selectSourceRow($event)" (selectSlice)="assignWaveformSlice($event)" (changeMode)="setSliceMode($event)" (resetSlices)="resetSlices()" (boundaryChange)="editBoundary($event)" (audition)="auditionWaveform($event)"></source-editor><section id="panel-sound" class="sound-panel" aria-label="Sound controls"><div class="section-heading"><h2>Sound</h2><span>Shape your slices</span></div>
<div class="switch sound-scope"><button [class.chosen]="soundScope() === 'global'" (click)="soundScope.set('global')">All pads</button><button [class.chosen]="soundScope() === 'row'" (click)="soundScope.set('row')">Selected row</button></div>
<div class="sound-heading"><span>{{ soundScope() === 'global' ? 'Global defaults' : 'Row ' + (selectedRow() + 1).toString().padStart(2, '0') + ' · Slice ' + (rowSamples()[selectedRow()] + 1).toString().padStart(3, '0') }}</span><span class="source-meta">{{ soundScope() === 'row' ? 'Shared by all 16 pads' : 'Inherited by pads' }}</span></div>
<div class="sound-controls">@for (control of soundControls; track control.key) {
<div class="sound-control"><div class="control-heading"><label [for]="'sound-' + control.key">{{ control.label }} <span class="dim">{{ control.unit }}</span></label><input [id]="'sound-' + control.key" [attr.aria-label]="control.label + ' value'" type="number" [min]="control.min" [max]="control.max" [step]="control.step" [value]="editorSound()[control.key]" (change)="setSound(control.key, $event)"></div><input type="range" [attr.aria-label]="control.label" [min]="control.min" [max]="control.max" [step]="control.step" [value]="editorSound()[control.key]" (input)="setSound(control.key, $event)">
@if (soundScope() === 'row') {<button class="inherit" [disabled]="!hasOverride(control.key)" (click)="inheritSound(control.key)">{{ hasOverride(control.key) ? '↩ Use global ' + control.label.toLowerCase() : 'Following global ' + control.label.toLowerCase() }}</button>}</div>}
</div><div class="length-presets"><button [disabled]="!loaded()" (click)="lengthPreset('blip')">Blip · 10 ms</button><button (click)="lengthPreset('full')">Full slice</button></div><p class="slice-time">{{ shapedTime() }}</p>
<div class="sound-actions"><button class="connect" [disabled]="!loaded() || loading()" (click)="audition(selected(), soundScope() === 'global')">▶ Preview {{ soundScope() === 'global' ? 'global sound' : 'slice' }}</button><button class="clear" (click)="resetSound()">{{ soundScope() === 'global' ? 'Reset global defaults' : 'Reset row to global' }}</button></div>
</section>
<section id="panel-mod" aria-label="Modulation controls"><div class="mod-heading"><h2>Modulation</h2><label class="mod-enable"><input type="checkbox" aria-label="Enable modulation" [checked]="modulation().enabled" (change)="setModulation('enabled', $event)">On</label></div>
<p class="fine">Vary each new slice in time with the sequence.</p>
<label>Target<select aria-label="Modulation target" [value]="modulation().target" (change)="setModulation('target', $event)"><option value="pan">Pan · left / right</option><option value="volume">Volume · pulse</option><option value="pitch">Pitch · up / down</option></select></label>
<div class="mod-pair"><label>Cycle<select aria-label="Modulation cycle" [value]="modulation().steps" (change)="setModulation('steps', $event)">@for (rate of modulationRates; track rate.steps) {<option [value]="rate.steps">{{ rate.label }}</option>}</select></label><label>Shape<select aria-label="Modulation shape" [value]="modulation().waveform" (change)="setModulation('waveform', $event)"><option value="sine">Sine</option><option value="triangle">Triangle</option><option value="square">Square</option></select></label></div>
<label class="mod-depth">Depth <span>{{ modulation().depth }}%</span><input type="range" aria-label="Modulation depth" min="0" max="100" [value]="modulation().depth" (input)="setModulation('depth', $event)"></label>
<p class="fine">{{ modulation().target === 'pitch' ? 'Up to ±12 semitones. Pitch also changes slice length.' : modulation().target === 'pan' ? 'Adds stereo movement to each pad’s pan setting.' : 'Higher depth makes the quiet steps softer.' }} Resets on Play; sounding slices keep their values.</p></section>
<button class="connect output-test" (click)="testOutput()">Test speaker output</button></aside></div>
<p class="session-note">Patterns save on this device. Exports include settings, not audio.</p>
</main>`})
class App implements OnDestroy, AfterViewInit {
  readonly logoColors = Array.from({length:16},(_,index) => TERMINAL_ROW_COLORS[index % TERMINAL_ROW_COLORS.length]);
  readonly rowColors = Array.from({length:256}, (_, index) => getRowColor(Math.floor(index / 16)));
  readonly steps = Array.from({length:16}, (_, i) => i);
  readonly modulationRates = MODULATION_RATES;
  modulation = signal<Modulation>({...DEFAULT_MODULATION});
  @ViewChildren('padButton') private padButtons!: QueryList<ElementRef<HTMLButtonElement>>;
  private padNodes:HTMLButtonElement[] = [];
  private litPads = new Set<number>();
  private nextPaintTime = 0;
  ngAfterViewInit() { this.padNodes = this.padButtons.map(pad => pad.nativeElement); }
  readonly soundControls = SOUND_CONTROLS;
  globalSound = signal<SoundSettings>({...DEFAULT_SOUND});
  rowSounds = signal<PadSound[]>(Array.from({length:16}, () => ({})));
  soundScope = signal<'global'|'row'>('global');
  editorSound = () => this.soundScope() === 'global' ? this.globalSound() : effectiveSound(this.globalSound(),this.rowSounds()[this.selectedRow()]);
  pattern = signal<boolean[]>(Array(256).fill(false)); mode = signal<'pattern'|'edit'>('pattern'); selected = signal(0);
  rowSamples = signal<number[]>(Array.from({length:16}, (_, row) => row * 16));
  dragSource = signal(-1);
  private paintingPads = false;
  private padGestureActive = false;
  private deferPadPreview = false;
  private pendingPadPreview = -1;
  private paintEnabled = true;
  running = signal(false); loading = signal(false); loaded = signal(false); exporting = signal(false); column = signal(-1);
  sliceState = signal<SliceState | null>(null);
  waveformPeaks = signal<WaveformPeaks | null>(null);
  private audioFormat = signal<{length: number; sampleRate: number} | null>(null);
  private resolvedSlices = computed(() => {
    const state = this.sliceState(), format = this.audioFormat();
    return state && format ? boundariesToSlices(state.boundaries, format.length, format.sampleRate) : [];
  });
  private automaticMaps: Partial<Record<AutomaticSliceMode, number[]>> = {};
  private analysis?: Pick<ReturnType<typeof quantizeAudioSlices>, 'bpm' | 'confidence'>;
  @ViewChild(WaveformComponent) private waveform?: WaveformComponent;
  sourceId = signal(''); fileName = signal(''); duration = signal(0); bpm = signal(120); volume = signal(70);
  storageOpen = signal(false); storageLoading = signal(false); storageBytes = signal(0);
  cachedTracks = signal<{id:string;title:string;duration:number|null;bytes:number;modified:number}[]>([]);
  message = signal('Import a recording, select slices, then press Play.');
  private importController?: AbortController; private context?: AudioContext; private buffer?: AudioBuffer; private master?: GainNode;
  private voices = new Set<AudioBufferSourceNode>(); private timer?: ReturnType<typeof setInterval>; private animation = 0;
  private nextTime = 0; private nextColumn = 0; private nextStep = 0; private generation = 0;
  private events: {time:number; column:number; step:number}[] = []; private lights: (WaveformVoice & {index:number; source:AudioBufferSourceNode; step:number; override?:SoundSettings; raw?:boolean})[] = [];
  enabledCount = () => this.pattern().filter(Boolean).length;
  selectedRow() { return Math.floor(this.selected() / 16); }
  constructor() {
    try { const saved = localStorage.getItem('stepfield-session-v1') ?? localStorage.getItem('grid256-audio-v1'); if (saved) this.restore(JSON.parse(saved)); }
    catch { this.message.set('Could not restore the saved pattern. Import a backup or start fresh.'); }
    const source = this.sourceId();
    if (source) queueMicrotask(() => { if (this.sourceId() === source && !this.loaded()) void this.loadSavedAudio(source); });
  }
  onKeydown(event:KeyboardEvent) {
    if (event.code !== 'Space' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
    const target = event.target;
    // Leave text fields, sliders, file pickers and native disclosure controls to the browser.
    if (target instanceof Element && (target.closest('input, textarea, select, summary, a, [role="textbox"], [role="slider"]') || (target instanceof HTMLElement && target.isContentEditable))) return;
    event.preventDefault();
    if (event.repeat) return;
    if (this.running()) this.stop(); else void this.start();
  }
  setGridAction(event:Event) {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'pattern' || value === 'edit') { this.mode.set(value); if (value === 'edit') this.soundScope.set('row'); }
  }
  selectSourceRow(row:number) {
    if (!Number.isInteger(row) || row < 0 || row > 15) return;
    this.selected.set(row * 16 + this.selected() % 16); this.soundScope.set('row');
  }
  private audio() {
    // Request media playback on iOS rather than the default ambient/ringer session.
    // This is optional; browsers without the Audio Session API retain normal Web Audio.
    try { const session = (navigator as Navigator & {audioSession?: {type:string}}).audioSession; if (session && session.type !== 'playback') session.type = 'playback'; } catch {}
    if (!this.context) {
      this.context = new AudioContext(); this.master = this.context.createGain(); const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -6; limiter.knee.value = 6; limiter.ratio.value = 12;
      this.master.gain.value = this.volume() / 100; this.master.connect(limiter); limiter.connect(this.context.destination);
      this.context.onstatechange = () => { if (this.context?.state !== 'running' && this.running()) { this.stop(); this.message.set('Audio was interrupted. Press Play to resume.'); } };
    }
    return this.context;
  }
  async loadFile(event:Event) {
    const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = ''; if (!file || this.loading()) return;
    if (file.size > 150 * 1024 * 1024) { this.message.set('Choose a file smaller than 150 MB to limit browser memory use.'); return; }
    this.stop(); this.loading.set(true); this.message.set('Decoding audio…');
    try { const decoded = await this.audio().decodeAudioData(await file.arrayBuffer()); if (decoded.length < 256) throw new Error('Too short'); const preserve = !this.sourceId() && this.fileName() === file.name && Math.abs(this.duration() - decoded.duration) < .1; this.buffer = decoded; this.duration.set(decoded.duration); this.fileName.set(file.name); this.sourceId.set(''); const analysis = this.mapAudio(decoded, preserve); this.loaded.set(true); this.persist(); this.message.set(this.sliceMapMessage(analysis)); }
    catch { this.message.set('Could not decode this file. Try WAV, MP3, or an audio track exported from your video.'); }
    finally { this.loading.set(false); }
  }
  async importYoutube(url:string) {
    if (this.loading()) return;
    this.stop(); this.loading.set(true); this.message.set('Checking YouTube link…');
    const controller = new AbortController(); this.importController = controller;
    const timeout = setTimeout(() => controller.abort(), 360_000);
    try {
      let response = await fetch('/api/youtube', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url}),signal:controller.signal});
      let job = await this.readJob(response);
      while (job.status === 'processing') {
        this.message.set(job.message);
        await new Promise<void>((resolve,reject) => { const abort = () => { clearTimeout(timer); reject(new Error('Import cancelled or timed out.')); }; const timer = setTimeout(() => { controller.signal.removeEventListener('abort',abort); resolve(); },700); controller.signal.addEventListener('abort',abort,{once:true}); if (controller.signal.aborted) abort(); });
        response = await fetch('/api/youtube/' + job.id,{signal:controller.signal}); job = await this.readJob(response);
      }
      if (job.status !== 'ready') throw new Error(job.message || 'Audio import failed.');
      this.message.set('Decoding audio and mapping 256 slices…');
      const audio = await fetch('/api/audio/' + job.id,{signal:controller.signal}); if (!audio.ok) throw new Error('Cached audio expired. Import the link again.');
      // Decode at the stored sample rate to avoid expanding to the device rate in memory.
      const decoded = await new OfflineAudioContext(2,1,32000).decodeAudioData(await audio.arrayBuffer());
      if (controller.signal.aborted) return;
      const preserve = this.sourceId() === job.id; this.buffer = decoded; this.duration.set(decoded.duration); this.fileName.set(job.title); this.sourceId.set(job.id); const analysis = this.mapAudio(decoded, preserve); this.loaded.set(true); this.persist();
      this.message.set(`${this.sliceMapMessage(analysis)} · ${(job.bytes / 1_000_000).toFixed(2)} MB${job.cached ? ' · loaded from cache' : ''}. Select squares and press Play.`);
    } catch (error) { this.message.set(error instanceof Error && error.name !== 'AbortError' ? error.message : 'Import timed out. Try again or choose a shorter video.'); }
    finally { clearTimeout(timeout); this.importController = undefined; this.loading.set(false); }
  }
  private async readJob(response:Response):Promise<{id:string;status:string;message:string;title:string;bytes:number;cached?:boolean}> {
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Audio service unavailable. Restart the app with npm start.');
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Audio service unavailable. Restart with npm start.'); return data;
  }
  toggleStorage() { this.storageOpen.update(open => !open); if (!this.storageOpen()) return; void this.refreshStorage(); }
  async refreshStorage() {
    this.storageLoading.set(true);
    try { const response = await fetch('/api/storage'); if (!response.ok) throw new Error('Could not read audio storage.'); const data = await response.json(); this.cachedTracks.set(data.tracks); this.storageBytes.set(data.totalBytes); }
    catch (error) { this.message.set(error instanceof Error ? error.message : 'Could not read audio storage.'); }
    finally { this.storageLoading.set(false); }
  }
  formatBytes(bytes:number) { return bytes < 1_000_000 ? `${(bytes / 1000).toFixed(0)} KB` : `${(bytes / 1_000_000).toFixed(2)} MB`; }
  async removeCachedTrack(id:string) {
    try {
      const response = await fetch(`/api/storage/${id}`,{method:'DELETE'}); const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not remove cached audio.');
      if (this.sourceId() === id) this.clearAudio();
      await this.refreshStorage(); this.message.set('Cached track removed from this device.');
    } catch (error) { this.message.set(error instanceof Error ? error.message : 'Could not remove cached audio.'); }
  }
  clearAudio() {
    this.stop(); this.buffer = undefined; this.sliceState.set(null); this.audioFormat.set(null); this.waveformPeaks.set(null); this.automaticMaps = {}; this.analysis = undefined; this.loaded.set(false); this.sourceId.set(''); this.fileName.set(''); this.duration.set(0); this.persist();
    this.message.set('Audio unloaded from memory.');
  }
  private async loadSavedAudio(id:string) {
    if (this.loading() || this.loaded()) return;
    this.loading.set(true); this.message.set('Restoring cached audio…');
    try {
      const audio = await fetch('/api/audio/' + id);
      if (!audio.ok) throw new Error('Saved audio expired. Open Source to import the link again.');
      const decoded = await new OfflineAudioContext(2,1,32000).decodeAudioData(await audio.arrayBuffer());
      if (this.sourceId() !== id) return;
      this.buffer = decoded; this.duration.set(decoded.duration); this.mapAudio(decoded); this.loaded.set(true);
      this.message.set('Cached audio ready. Press Space or Play.');
    } catch (error) {
      if (this.sourceId() === id) { this.message.set(error instanceof Error ? error.message : 'Could not restore cached audio. Open Source to import it again.'); }
    } finally { this.loading.set(false); }
  }
  reloadAudio() { if (this.sourceId()) void this.importYoutube('https://www.youtube.com/watch?v=' + this.sourceId()); }
  private mapAudio(buffer:AudioBuffer, preserve = true) {
    if (buffer.length < 256) throw new Error('Audio is too short for 256 slices');
    const channels = Array.from({length:buffer.numberOfChannels},(_,channel) => buffer.getChannelData(channel));
    const previous = preserve ? this.sliceState() : null;
    const analysis = quantizeAudioSlices(channels,buffer.sampleRate,this.bpm());
    this.analysis = {bpm:analysis.bpm,confidence:analysis.confidence};
    this.automaticMaps = {beat:slicesToBoundaries(analysis.slices,buffer.duration), equal:equalBoundaries(buffer.length)};
    this.audioFormat.set({length:buffer.length,sampleRate:buffer.sampleRate});
    this.sliceState.set(previous ? {...previous,boundaries:slicesToBoundaries(boundariesToSlices(previous.boundaries,buffer.length,buffer.sampleRate),buffer.duration)} : this.automaticState('beat'));
    this.waveformPeaks.set(buildWaveformPeaks(channels,buffer.sampleRate));
    if (!previous && analysis.confidence > .015) this.bpm.set(analysis.bpm);
    return analysis;
  }
  private automaticState(mode:AutomaticSliceMode):SliceState {
    if (!this.automaticMaps[mode] && this.buffer) {
      this.automaticMaps[mode] = transientBoundaries(Array.from({length:this.buffer.numberOfChannels},(_,i) => this.buffer!.getChannelData(i)),this.buffer.sampleRate);
    }
    return {mode,automaticMode:mode,boundaries:[...this.automaticMaps[mode]!],manuallyEdited:false,bpm:this.analysis?.bpm,confidence:this.analysis?.confidence};
  }
  setSliceMode(mode:SliceMode) {
    const state = this.sliceState(); if (!state || !this.buffer) return;
    this.sliceState.set(mode === 'manual' ? {...state,mode} : this.automaticState(mode));
    this.refreshQueuedSound(true); this.persist();
  }
  resetSlices() { const state = this.sliceState(); if (state) this.setSliceMode(state.automaticMode); }
  editBoundary(edit:{index:number;seconds:number;commit:boolean}) {
    const state = this.sliceState(); if (!state || !this.buffer) return;
    const next = moveBoundary(state,edit.index,edit.seconds,this.buffer.length,this.buffer.sampleRate);
    if (next !== state) { this.sliceState.set(next); this.refreshQueuedSound(true); }
    if (edit.commit) this.persist();
  }
  assignWaveformSlice(slice:number) {
    if (!Number.isInteger(slice) || slice < 0 || slice > 255) return;
    const row = this.selectedRow();
    this.rowSamples.set(assignRowSample(this.rowSamples(),row,slice));
    this.reconcileQueuedPads(Array.from({length:16},(_,column) => row * 16 + column));
    this.persist(); this.message.set(`Row ${row + 1} → Slice ${(slice + 1).toString().padStart(3,'0')}.`);
    if (!this.running()) void this.audition(this.selected());
  }
  auditionWaveform(raw:boolean) { void this.audition(this.selected(),false,raw); }
  private sliceMapMessage(analysis:ReturnType<typeof quantizeAudioSlices>) {
    if (!analysis.quantized) return analysis.confidence > .015 ? `Beat grid detected at ${analysis.bpm} BPM; using even slices because the recording is too short for 256 distinct grid points` : `Recording is too short for 256 distinct beat-grid slices; using even slices`;
    return analysis.confidence > .015 ? `Beat grid detected at ${analysis.bpm} BPM · 256 quantized slices ready` : `No clear beat grid detected; slices aligned to ${analysis.bpm} BPM`;
  }
  private audioSlice(index:number) {
    if (!this.buffer) return {offset:0,duration:0};
    const safeIndex = Number.isInteger(index) ? Math.max(0,Math.min(255,index)) : 0;
    const fallback = sliceBounds(this.buffer.length,this.buffer.sampleRate,safeIndex);
    const slice = this.resolvedSlices()[safeIndex];
    if (!slice || !Number.isFinite(slice.offset) || !Number.isFinite(slice.duration) || slice.offset < 0 || slice.duration <= 0 || slice.offset + slice.duration > this.buffer.duration + 1 / this.buffer.sampleRate) return fallback;
    return {offset:slice.offset,duration:Math.min(slice.duration,this.buffer.duration - slice.offset)};
  }
  padLabel(index:number) { const row = Math.floor(index / 16); return `Slice ${this.rowSamples()[row] + 1}, row ${row + 1}, step ${index % 16 + 1}, ${this.pattern()[index] ? 'enabled' : 'disabled'}`; }
  sliceTime() { if (!this.buffer) return 'Import audio to preview'; const b = this.audioSlice(this.rowSamples()[Math.floor(this.selected() / 16)]); return `${b.offset.toFixed(3)} – ${(b.offset + b.duration).toFixed(3)} s`; }
  beginPadGesture(event:PointerEvent,index:number) {
    if (event.button !== 0) return;
    if (this.mode() === 'edit') { event.preventDefault(); this.press(index); return; }
    event.preventDefault(); this.padGestureActive = true;
    this.deferPadPreview = event.pointerType !== 'mouse'; this.pendingPadPreview = -1;
    if (event.shiftKey && this.pattern()[index]) { this.dragSource.set(index); this.paintingPads = false; return; }
    this.dragSource.set(-1); this.paintingPads = true; this.paintEnabled = !this.pattern()[index]; this.applyPadPaint(index);
  }
  continuePadGesture(event:PointerEvent) {
    if (!this.paintingPads && this.dragSource() < 0) return;
    const element = document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-pad-index]');
    const target = Number(element?.dataset['padIndex']); if (!Number.isInteger(target) || target < 0 || target >= 256) return;
    if (this.dragSource() >= 0) {
      const source = this.dragSource();
      if (!this.canDropOn(target)) return;
      this.pattern.set(moveStep(this.pattern(),source,target)); this.selected.set(target); this.dragSource.set(-1);
      this.reconcileQueuedPads([source,target]); this.persist(); this.message.set('Step moved.'); return;
    }
    if (this.paintingPads) this.applyPadPaint(target);
  }
  endPadGesture(event:PointerEvent) {
    if (!this.padGestureActive) return;
    const preview = this.pendingPadPreview;
    this.padGestureActive = false; this.paintingPads = false; this.dragSource.set(-1);
    this.deferPadPreview = false; this.pendingPadPreview = -1;
    // Touch/pen pointerdown does not authorize audio. Resume directly inside pointerup,
    // after painting, without toggling the pad a second time or queueing locked previews.
    if (event.type === 'pointerup' && preview >= 0 && !this.running() && this.pattern()[preview]) void this.audition(preview);
  }
  private applyPadPaint(index:number) {
    if (this.pattern()[index] === this.paintEnabled) return;
    this.selected.set(index); this.pattern.update(pattern => pattern.map((enabled,pad) => pad === index ? this.paintEnabled : enabled));
    const now = this.context?.currentTime ?? 0;
    if (this.paintEnabled) {
      for (const event of this.events) if (event.time > now && event.column === index % 16) this.trigger(index,event.time,undefined,event.step);
      if (!this.running()) {
        if (this.deferPadPreview) this.pendingPadPreview = index;
        else void this.audition(index);
      }
    } else if (this.running()) {
      for (const light of this.lights) if (light.index === index && light.start > now) light.source.stop();
      this.lights = this.lights.filter(light => light.index !== index || light.start <= now);
    }
    this.nextPaintTime = 0; this.persist();
  }
  press(index:number,event?:MouseEvent) {
    // Pointer input was already handled on pointerdown for responsive drag painting.
    // Keep click activation for keyboard and assistive input, which has detail === 0.
    if (event && event.detail > 0) return;
    this.selected.set(index);
    if (this.mode() === 'edit') { this.soundScope.set('row'); return; }
    this.pattern.update(p => p.map((v,i) => i === index ? !v : v));
    // Reconcile queued steps so edits made just before the playhead arrives are heard.
    const now = this.context?.currentTime ?? 0;
    if (this.pattern()[index]) { for (const event of this.events) if (event.time > now && event.column === index % 16) this.trigger(index,event.time,undefined,event.step); }
    else if (this.running()) {
      for (const light of this.lights) if (light.index === index && light.start > now) light.source.stop();
      this.lights = this.lights.filter(light => light.index !== index || light.start <= now);
    }
    this.nextPaintTime = 0; this.persist();
    if (!this.running() && this.pattern()[index]) void this.audition(index);
  }
  canDropOn(target:number) { const source = this.dragSource(); return source >= 0 && source !== target && !this.pattern()[target] && Math.floor(source / 16) === Math.floor(target / 16); }
  async audition(index:number, globalPreview = false, raw = false) {
    if (!this.buffer || this.loading()) { this.message.set('Import a recording first.'); return; } const generation = this.generation;
    if (this.volume() === 0) { this.message.set('Master volume is at 0%. Raise the Volume control to hear audio.'); return; }
    try { const ctx = this.audio(); await ctx.resume(); if (generation !== this.generation) return; if (ctx.state !== 'running') throw new Error('Audio output is suspended.'); this.trigger(index, ctx.currentTime + .005, globalPreview ? this.globalSound() : undefined,0,raw); this.animate(); } catch (error) { this.message.set(error instanceof Error ? error.message : 'Audio could not start. Try previewing again.'); }
  }
  async testOutput() {
    if (this.volume() === 0) { this.message.set('Master volume is at 0%. Raise the Volume control to hear audio.'); return; }
    try {
      const ctx = this.audio(); await ctx.resume(); if (ctx.state !== 'running' || !this.master) throw new Error('Browser audio output is suspended.');
      const oscillator = ctx.createOscillator(), envelope = ctx.createGain(), now = ctx.currentTime;
      oscillator.type = 'sine'; oscillator.frequency.value = 440; envelope.gain.setValueAtTime(0,now); envelope.gain.linearRampToValueAtTime(.65,now+.02); envelope.gain.setValueAtTime(.65,now+.28); envelope.gain.linearRampToValueAtTime(0,now+.4);
      oscillator.connect(envelope); envelope.connect(this.master); oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
      oscillator.start(now); oscillator.stop(now+.4); this.message.set('Speaker test tone sent.');
    } catch (error) { this.message.set(error instanceof Error ? error.message : 'Browser audio output could not start.'); }
  }
  private trigger(index:number, time:number, override?:SoundSettings, step = 0, raw = false) {
    if (!this.buffer || !this.context || !this.master) return;
    const bounds = this.audioSlice(this.rowSamples()[Math.floor(index / 16)]);
    const settings = override ?? effectiveSound(this.globalSound(),this.rowSounds()[Math.floor(index / 16)]);
    const shape = voiceShape(bounds.duration,raw ? {...DEFAULT_SOUND,attack:0,release:0} : modulateSound(settings,this.modulation(),step));
    const source = this.context.createBufferSource(); const envelope = this.context.createGain(); const pan = this.context.createStereoPanner();
    source.buffer = this.buffer; source.playbackRate.value = shape.rate; pan.pan.value = shape.pan;
    source.connect(envelope); envelope.connect(pan); pan.connect(this.master);
    envelope.gain.setValueAtTime(0,time); envelope.gain.linearRampToValueAtTime(shape.gain,time + shape.attack);
    envelope.gain.setValueAtTime(shape.gain,Math.max(time + shape.attack,time + shape.duration - shape.release)); envelope.gain.linearRampToValueAtTime(0,time + shape.duration);
    this.voices.add(source); source.onended = () => { this.voices.delete(source); source.disconnect(); envelope.disconnect(); pan.disconnect(); };
    try { source.start(time,bounds.offset,shape.sourceDuration); }
    catch { this.voices.delete(source); source.disconnect(); envelope.disconnect(); pan.disconnect(); this.message.set('Audio playback failed. Reload the recording and try again.'); return; }
    this.lights.push({index,start:time,end:time + shape.duration,source,step,override,raw,offset:bounds.offset,sourceDuration:shape.sourceDuration,rate:shape.rate}); this.nextPaintTime = 0;
  }
  hasOverride(key:SoundKey) { return Object.hasOwn(this.rowSounds()[this.selectedRow()],key); }
  shapedTime() {
    if (!this.buffer) return 'Import audio to see the playback length';
    const bounds = this.audioSlice(this.rowSamples()[Math.floor(this.selected() / 16)]);
    const shape = voiceShape(bounds.duration,this.editorSound());
    return `${(shape.duration * 1000).toFixed(1)} ms playback · ${(bounds.duration * 1000).toFixed(1)} ms full slice`;
  }
  setSound(key:SoundKey,event:Event) {
    const input = event.target as HTMLInputElement; if (input.value.trim() === '') { input.value = String(this.editorSound()[key]); return; }
    const value = Number(input.value); if (!Number.isFinite(value)) { input.value = String(this.editorSound()[key]); return; }
    this.updateSound(key,value); input.value = String(this.editorSound()[key]);
  }
  private updateSound(key:SoundKey,value:number) {
    const control = SOUND_CONTROLS.find(c => c.key === key)!;
    const clamped = Math.max(control.min,Math.min(control.max,value));
    if (this.soundScope() === 'global') this.globalSound.update(sound => ({...sound,[key]:clamped}));
    else this.rowSounds.update(rows => rows.map((row,i) => i === this.selectedRow() ? {...row,[key]:clamped} : row));
    this.refreshQueuedSound(); this.persist();
  }
  inheritSound(key:SoundKey) {
    this.rowSounds.update(rows => rows.map((row,i) => { if (i !== this.selectedRow()) return row; const next = {...row}; delete next[key]; return next; }));
    this.refreshQueuedSound(); this.persist();
  }
  resetSound() {
    if (this.soundScope() === 'global') this.globalSound.set({...DEFAULT_SOUND});
    else this.rowSounds.update(rows => rows.map((row,i) => i === this.selectedRow() ? {} : row));
    this.refreshQueuedSound(); this.persist();
  }
  lengthPreset(preset:'blip'|'full') {
    if (preset === 'full') this.updateSound('length',100);
    else if (this.buffer) { const bounds = this.audioSlice(this.rowSamples()[Math.floor(this.selected() / 16)]); this.updateSound('length',Math.round(10 / (bounds.duration * 1000) * 1000) / 10); }
  }
  private refreshQueuedSound(all = false) {
    const now = this.context?.currentTime ?? 0;
    const queued = this.lights.filter(light => light.start > now && (all || this.soundScope() === 'global' || Math.floor(light.index / 16) === this.selectedRow()));
    const replace = new Set(queued);
    for (const light of queued) light.source.stop();
    this.lights = this.lights.filter(light => !replace.has(light));
    for (const light of queued) this.trigger(light.index,light.start,light.override,light.step,light.raw);
    this.nextPaintTime = 0;
  }
  async start() {
    if (!this.buffer || this.loading() || this.running()) return;
    if (this.volume() === 0) { this.message.set('Master volume is at 0%. Raise the Volume control to hear audio.'); return; }
    const generation = this.generation;
    try { const ctx = this.audio(); await ctx.resume(); if (generation !== this.generation || this.running()) return; if (ctx.state !== 'running') throw new Error('Browser audio output is suspended.'); this.running.set(true); this.nextColumn = 0; this.nextStep = 0; this.nextTime = ctx.currentTime + .05; this.schedule(); this.timer = setInterval(() => this.schedule(),25); this.animate(); this.message.set('Sequencing. Toggle squares to change the pattern.'); }
    catch (error) { this.message.set(error instanceof Error ? error.message : 'Audio could not start. Press Play to try again.'); }
  }
  private schedule() {
    if (!this.context || !this.running()) return; const now = this.context.currentTime; const step = 60 / this.bpm() / 4;
    // Skip missed steps after timer throttling instead of firing a burst of notes.
    if (this.nextTime < now) { const missed = Math.ceil((now - this.nextTime) / step); this.nextColumn = (this.nextColumn + missed) % 16; this.nextStep += missed; this.nextTime += missed * step; }
    while (this.nextTime < now + .1) { for (const index of columnPads(this.pattern(),this.nextColumn)) this.trigger(index,this.nextTime,undefined,this.nextStep); this.events.push({time:this.nextTime,column:this.nextColumn,step:this.nextStep}); this.nextColumn = (this.nextColumn + 1) % 16; this.nextStep++; this.nextTime += step; }
  }
  private paintLights(now:number) {
    if (now < this.nextPaintTime) return;
    const active = new Set<number>(); const retained:typeof this.lights = []; this.nextPaintTime = Infinity;
    for (const light of this.lights) {
      if (light.end <= now) continue;
      retained.push(light);
      if (light.start <= now) { active.add(light.index); this.nextPaintTime = Math.min(this.nextPaintTime,light.end); }
      else this.nextPaintTime = Math.min(this.nextPaintTime,light.start);
    }
    this.lights = retained;
    // Only touch pads whose light actually changed; do not invalidate the entire Angular view.
    for (const index of this.litPads) if (!active.has(index)) this.padNodes[index]?.classList.remove('active');
    for (const index of active) if (!this.litPads.has(index)) this.padNodes[index]?.classList.add('active');
    this.litPads = active;
  }
  private animate() {
    if (this.animation) return;
    const frame = () => {
      this.animation = 0; const now = this.context?.currentTime ?? 0;
      let column = this.column();
      while (this.events.length && this.events[0].time <= now) column = this.events.shift()!.column;
      if (column !== this.column()) this.column.set(column);
      this.paintLights(now);
      this.waveform?.paintActivity(this.lights,now);
      if (this.running() || this.lights.length) this.animation = requestAnimationFrame(frame);
    };
    this.animation = requestAnimationFrame(frame);
  }
  setModulation(key:keyof Modulation,event:Event) {
    const input = event.target as HTMLInputElement;
    const value = key === 'enabled' ? input.checked : key === 'depth' || key === 'steps' ? Number(input.value) : input.value;
    try { this.modulation.set(restoreModulation({...this.modulation(),[key]:value})); this.refreshQueuedSound(true); this.persist(); }
    catch { this.message.set('Choose a valid modulation setting.'); }
  }
  stop() { if (this.running()) this.message.set('Stopped. Press Play to start from the first column.'); this.generation++; this.running.set(false); clearInterval(this.timer); cancelAnimationFrame(this.animation); this.animation = 0; for (const voice of this.voices) { try { voice.stop(); } catch {} } this.voices.clear(); this.events = []; this.lights = []; this.waveform?.paintActivity([],0); this.column.set(-1); for (const index of this.litPads) this.padNodes[index]?.classList.remove('active'); this.litPads.clear(); this.nextPaintTime = 0; }
  clearPattern() { this.stop(); this.pattern.set(Array(256).fill(false)); this.persist(); }
  setTempo(event:Event) { const input = event.target as HTMLInputElement; const n = Number(input.value); if (Number.isFinite(n)) this.bpm.set(Math.max(30,Math.min(300,n))); input.value = String(this.bpm()); this.persist(); }
  setVolume(event:Event) { const input = event.target as HTMLInputElement; const n = Number(input.value); if (Number.isFinite(n)) this.volume.set(Math.max(0,Math.min(100,n))); input.value = String(this.volume()); if (this.master && this.context) this.master.gain.setTargetAtTime(this.volume() / 100,this.context.currentTime,.01); this.persist(); }
  repeatSelectedAcrossRow() {
    const sample = this.rowSamples()[Math.floor(this.selected() / 16)];
    this.pattern.set(repeatCellAcrossRow(this.pattern(),this.selected()));
    const rowStart = Math.floor(this.selected() / 16) * 16;
    this.reconcileQueuedPads(Array.from({length:16},(_,column) => rowStart + column));
    this.persist();
    this.message.set(`Slice ${sample + 1} repeated across row ${Math.floor(this.selected() / 16) + 1}.`);
  }
  private reconcileQueuedPads(indices:number[]) {
    if (!this.running()) return;
    const affected = new Set(indices), now = this.context?.currentTime ?? 0;
    const queued = this.lights.filter(light => affected.has(light.index) && light.start > now);
    for (const light of queued) light.source.stop();
    const replaced = new Set(queued);
    this.lights = this.lights.filter(light => !replaced.has(light));
    for (const event of this.events) for (const index of affected) {
      if (this.pattern()[index] && event.time > now && event.column === index % 16 && !this.lights.some(light => light.index === index && light.start === event.time)) this.trigger(index,event.time,undefined,event.step);
    }
  }
  private session() { return {version:3,sliceState:this.sliceState(),sourceDuration:this.duration(),pattern:this.pattern(),rowSamples:this.rowSamples(),sampleAssignments:Array.from({length:256},(_,index) => this.rowSamples()[Math.floor(index / 16)]),bpm:this.bpm(),volume:this.volume(),source:this.fileName(),sourceId:this.sourceId(),globalSound:this.globalSound(),rowSounds:this.rowSounds(),modulation:this.modulation()}; }
  private restore(data:unknown) {
    const d = data as ReturnType<App['session']> & {version:number; padSounds?:unknown; rowSounds?:unknown};
    if (!d || (d.version !== 1 && d.version !== 2 && d.version !== 3) || !Array.isArray(d.pattern) || d.pattern.length !== 256 || !d.pattern.every(v => typeof v === 'boolean') ||
        !Number.isFinite(d.bpm) || d.bpm < 30 || d.bpm > 300 || !Number.isFinite(d.volume) || d.volume < 0 || d.volume > 100) throw new Error('Invalid pattern');
    const legacySamples = d.sampleAssignments === undefined ? Array.from({length:256},(_,index) => Math.floor(index / 16) * 16) : d.sampleAssignments;
    if (!Array.isArray(legacySamples) || legacySamples.length !== 256 || !legacySamples.every(sample => Number.isInteger(sample) && sample >= 0 && sample < 256)) throw new Error('Invalid sample assignments');
    const rowSamples = d.rowSamples ?? Array.from({length:16},(_,row) => legacySamples[row * 16]);
    if (!Array.isArray(rowSamples) || rowSamples.length !== 16 || !rowSamples.every(sample => Number.isInteger(sample) && sample >= 0 && sample < 256)) throw new Error('Invalid row sounds');
    let sliceState = restoreSliceState(d.version === 1 ? 1 : 2,d.sliceState);
    if (d.sourceDuration !== undefined && (!Number.isFinite(d.sourceDuration) || d.sourceDuration < 0)) throw new Error('Invalid source duration');
    if (d.version === 3 && d.rowSounds === undefined || d.version < 3 && d.rowSounds !== undefined) throw new Error('Invalid row sound settings');
    const sounds = restoreRowSounds(d.globalSound,d.rowSounds,d.padSounds), modulation = restoreModulation(d.modulation);
    // Complete all validation and frame normalization before changing any live session state.
    if (this.buffer) sliceState = sliceState ? {...sliceState,boundaries:slicesToBoundaries(boundariesToSlices(sliceState.boundaries,this.buffer.length,this.buffer.sampleRate),this.buffer.duration)} : this.automaticState('beat');
    this.sliceState.set(sliceState); this.modulation.set(modulation); this.globalSound.set(sounds.global); this.rowSounds.set(sounds.rows);
    if (!this.loaded()) {
      this.duration.set(d.sourceDuration ?? 0);
      this.sourceId.set(typeof d.sourceId === 'string' && /^[\w-]{11}$/.test(d.sourceId) ? d.sourceId : '');
      this.fileName.set(typeof d.source === 'string' ? d.source.slice(0,200) : '');
    }
    this.pattern.set([...d.pattern]); this.rowSamples.set([...rowSamples]); this.bpm.set(d.bpm); this.volume.set(d.volume);
    if (this.master && this.context) this.master.gain.setTargetAtTime(d.volume / 100,this.context.currentTime,.01);
  }
  private persist() { try { localStorage.setItem('stepfield-session-v1',JSON.stringify(this.session())); } catch { this.message.set('Storage unavailable. Export your pattern to keep it.'); } }
  private async renderLoopWav() {
    if (!this.buffer || !this.enabledCount()) throw new Error('Load audio and enable at least one step before exporting a loop.');
    const bpm=this.bpm(),volume=this.volume(),pattern=[...this.pattern()],rowSamples=[...this.rowSamples()];
    const global={...this.globalSound()},rowSounds=this.rowSounds().map(sound=>({...sound})),modulation={...this.modulation()};
    const cycleSteps=modulation.enabled ? Math.max(16,modulation.steps) : 16;
    const stepDuration=60/bpm/4,cycleDuration=cycleSteps*stepDuration,sampleRate=32000;
    const buffer=this.buffer;let longestVoice=0;
    for(let step=0;step<cycleSteps;step++) for(let row=0;row<16;row++) {
      const index=row*16+step%16;if(!pattern[index]) continue;
      const shape=voiceShape(this.audioSlice(rowSamples[row]).duration,modulateSound(effectiveSound(global,rowSounds[row]),modulation,step));
      longestVoice=Math.max(longestVoice,shape.duration);
    }
    const framesPerCycle=Math.ceil(cycleDuration*sampleRate),prerollCycles=Math.max(1,Math.ceil(longestVoice/cycleDuration));
    // Prior cycles supply ringing note tails across the loop boundary.
    const offline=new OfflineAudioContext(2,framesPerCycle*(prerollCycles+1),sampleRate);
    const master=offline.createGain(),limiter=offline.createDynamicsCompressor();master.gain.value=volume/100;
    limiter.threshold.value=-6;limiter.knee.value=6;limiter.ratio.value=12;master.connect(limiter);limiter.connect(offline.destination);
    for(let step=0;step<cycleSteps*(prerollCycles+1);step++) {
      const when=step*stepDuration;
      const column=step%16;
      for(let row=0;row<16;row++) {
        const index=row*16+column;if(!pattern[index]) continue;
        const bounds=this.audioSlice(rowSamples[row]);
        const settings=effectiveSound(global,rowSounds[row]);
        const shape=voiceShape(bounds.duration,modulateSound(settings,modulation,step));
        const source=offline.createBufferSource(),envelope=offline.createGain(),pan=offline.createStereoPanner();
        source.buffer=buffer;source.playbackRate.value=shape.rate;pan.pan.value=shape.pan;
        source.connect(envelope);envelope.connect(pan);pan.connect(master);
        envelope.gain.setValueAtTime(0,when);envelope.gain.linearRampToValueAtTime(shape.gain,when+shape.attack);
        envelope.gain.setValueAtTime(shape.gain,Math.max(when+shape.attack,when+shape.duration-shape.release));
        envelope.gain.linearRampToValueAtTime(0,when+shape.duration);
        source.start(when,bounds.offset,shape.sourceDuration);
      }
    }
    const rendered=await offline.startRendering();
    const wavBytes=44+framesPerCycle*2*2,wav=new ArrayBuffer(wavBytes),view=new DataView(wav);
    const write=(offset:number,value:string)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
    write(0,'RIFF');view.setUint32(4,wavBytes-8,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);
    view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*4,true);
    view.setUint16(32,4,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,wavBytes-44,true);
    for(let frame=0;frame<framesPerCycle;frame++) for(let channel=0;channel<2;channel++) {
      const sample=Math.max(-1,Math.min(1,rendered.getChannelData(channel)[framesPerCycle*prerollCycles+frame]));
      view.setInt16(44+(frame*2+channel)*2,Math.round(sample<0?sample*32768:sample*32767),true);
    }
    return wav;
  }
  async downloadLoop(format:'wav'|'mp3') {
    if(this.exporting()) return;
    this.exporting.set(true);this.message.set('Rendering a seamless loop from the current pattern…');
    try {
      const wav=await this.renderLoopWav();let blob:Blob,extension=format;
      if(format==='mp3') {
        this.message.set('Rendering loop · converting to MP3…');
        const response=await fetch('/api/encode-mp3',{method:'POST',headers:{'Content-Type':'audio/wav'},body:wav});
        if(!response.ok) {const error=await response.json().catch(()=>({}));throw new Error(error.error || 'MP3 conversion failed. Try downloading the WAV.');}
        blob=await response.blob();
      } else blob=new Blob([wav],{type:'audio/wav'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;
      a.download=`stepfield-${this.bpm()}bpm-${this.enabledCount()}steps.${extension}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
      this.message.set(`Loop downloaded as ${format.toUpperCase()} · ${this.bpm()} BPM · ${Math.max(1,Math.round((format==='wav'?wav.byteLength:blob.size)/1_000_000))} MB.`);
    } catch(error) {this.message.set(error instanceof Error?error.message:'Could not render the loop. Try WAV or reduce the tempo.');}
    finally {this.exporting.set(false);}
  }
  exportSession() { const url = URL.createObjectURL(new Blob([JSON.stringify(this.session(),null,2)],{type:'application/json'})); const a = document.createElement('a'); a.href = url; a.download = 'stepfield-pattern.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000); }
  async importSession(event:Event) { const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = ''; if (!file) return; try { if (file.size > 100_000) throw new Error(); const data = JSON.parse(await file.text()); this.restore(data); this.stop(); this.persist(); this.message.set('Pattern imported. Audio is not included; load the matching recording.'); } catch { this.message.set('Invalid pattern file. Choose an exported audio-grid pattern.'); } }
  ngOnDestroy() { this.importController?.abort(); this.stop(); if (this.context) { this.context.onstatechange = null; void this.context.close(); } }
}
bootstrapApplication(App).then(() => {
  if (!isDevMode() && 'serviceWorker' in navigator) {
    const worker = new URL('service-worker.js', document.baseURI);
    void navigator.serviceWorker.register(worker).catch(error => console.error('Stepfield offline support could not be started.', error));
  }
}).catch(console.error);
