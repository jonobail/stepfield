import { Component, signal, OnDestroy, AfterViewInit, ViewChildren, QueryList, ElementRef } from '@angular/core';
import { DEFAULT_MODULATION, MODULATION_RATES, modulateSound, restoreModulation, type Modulation } from './modulation';
import { bootstrapApplication } from '@angular/platform-browser';
import { sliceBounds, columnPads } from './sequencer';
import { DEFAULT_SOUND, SOUND_CONTROLS, effectiveSound, voiceShape, restoreSounds, type SoundSettings, type SoundKey, type PadSound } from './sampler';

@Component({selector:'app-root', standalone:true, host:{'(document:keydown)':'onKeydown($event)'}, template:`
<header class="app-header"><a class="brand" href="/" aria-label="Stepfield home"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>Stepfield</a><span class="online" [class.is-playing]="running()"><i></i>{{ running() ? 'Playing' : loaded() ? 'Ready' : 'No audio loaded' }}</span></header>
<main><div class="workspace"><section class="instrument" aria-label="Step sequencer">
<div class="toolbar"><div class="switch" aria-label="Grid mode"><button [class.chosen]="mode() === 'pattern'" [attr.aria-pressed]="mode() === 'pattern'" (click)="mode.set('pattern')">Select steps</button><button [class.chosen]="mode() === 'edit'" [attr.aria-pressed]="mode() === 'edit'" (click)="editMode()">Edit sound</button></div><div class="transport"><button class="play" [disabled]="!loaded() || loading() || running()" (click)="start()" title="Play · Space">{{ loading() ? 'Loading audio…' : !loaded() ? 'Load audio to play' : running() ? 'Playing' : '▶ Play' }}</button><button class="stop" (click)="stop()" title="Stop · Space">■ Stop</button></div></div>
<div class="transport-settings"><label class="tempo">BPM<input aria-label="Tempo · BPM" type="number" min="30" max="300" [value]="bpm()" (change)="setTempo($event)"></label><label class="master-volume">Volume<input aria-label="Volume · %" type="range" min="0" max="100" [value]="volume()" (input)="setVolume($event)"><span>{{ volume() }}%</span></label><span class="shortcut"><kbd>space</kbd> play / stop</span></div>
<div class="grid-area"><div class="step-ruler" aria-hidden="true">@for (step of steps; track step) {<span [class.current]="column() === step">{{ step + 1 }}</span>}</div>
<div class="grid" aria-label="256 audio slices, 16 rows and 16 time steps"><div class="playhead-track" aria-hidden="true">@if (column() >= 0) {<span class="playhead-marker" [style.grid-column]="column() + 1"></span>}</div>@for (enabled of pattern(); track $index) {<button #padButton class="pad" [class.assigned]="enabled" [class.selected]="selected() === $index" [attr.aria-pressed]="enabled" [attr.aria-label]="padLabel($index)" [title]="padLabel($index)" (click)="press($index)"></button>}</div></div>
<div class="grid-footer"><span>{{ enabledCount() }} active <span class="separator">/</span> 256 pads</span><span>{{ mode() === 'pattern' ? (running() ? 'Tap to change steps' : 'Tap to toggle + preview') : 'Select a pad to edit' }}</span><span class="step-count">{{ column() >= 0 ? (column() + 1).toString().padStart(2, '0') : '—' }} / 16</span></div>
</section>
<aside class="inspector" aria-label="Instrument controls"><div class="source-summary"><span class="source-icon" aria-hidden="true">♫</span><div><p class="source-name" [title]="fileName()">{{ fileName() || 'Load a recording' }}</p><span class="source-meta">{{ loaded() ? duration().toFixed(1) + ' s · 256 slices' : 'YouTube or local file' }}</span></div><button class="source-change" aria-label="Change source" title="Change source" (click)="panel.set('source')">↗</button></div>
<nav class="panel-tabs" aria-label="Control panels">@for (tab of panels; track tab.id) {<button [class.chosen]="panel() === tab.id" [attr.aria-pressed]="panel() === tab.id" [attr.aria-controls]="'panel-' + tab.id" (click)="panel.set(tab.id)">{{ tab.label }}</button>}</nav>
<div class="inspector-body">
<section id="panel-source" [hidden]="panel() !== 'source'" aria-label="Source controls">
<form class="youtube-import" (submit)="$event.preventDefault(); importYoutube(youtube.value)"><label>YouTube link<input #youtube type="url" required placeholder="Paste a video link…" [disabled]="loading()"></label><button class="primary" type="submit" [disabled]="loading()">{{ loading() ? 'Importing…' : 'Import YouTube audio' }}</button></form><p class="fine">Up to 15 minutes · audio cached locally</p>
<div class="divider"><span>or</span></div><label class="file-picker">Choose audio or video<input aria-label="Import local audio or video" type="file" accept="audio/*,video/*,.wav,.mp3,.m4a,.mp4,.webm,.ogg,.flac" [disabled]="loading()" (change)="loadFile($event)"></label><button class="connect" [hidden]="!sourceId() || loaded()" [disabled]="loading()" (click)="reloadAudio()">Reload saved YouTube audio</button>
</section>
<section id="panel-sound" class="sound-panel" [hidden]="panel() !== 'sound'" aria-label="Sound controls">
<div class="switch sound-scope"><button [class.chosen]="soundScope() === 'global'" (click)="soundScope.set('global')">All pads</button><button [class.chosen]="soundScope() === 'pad'" (click)="soundScope.set('pad')">Selected pad</button></div>
<div class="sound-heading"><span>{{ soundScope() === 'global' ? 'Global defaults' : 'Slice ' + (selected() + 1).toString().padStart(3, '0') }}</span><span class="source-meta">{{ soundScope() === 'pad' ? 'Per-pad overrides' : 'Inherited by pads' }}</span></div>
@for (control of soundControls.slice(0, 1); track control.key) {
<div class="sound-control"><div class="control-heading"><label [for]="'sound-' + control.key">{{ control.label }} <span class="dim">{{ control.unit }}</span></label><input [id]="'sound-' + control.key" [attr.aria-label]="control.label + ' value'" type="number" [min]="control.min" [max]="control.max" [step]="control.step" [value]="editorSound()[control.key]" (change)="setSound(control.key, $event)"></div><input type="range" [attr.aria-label]="control.label" [min]="control.min" [max]="control.max" [step]="control.step" [value]="editorSound()[control.key]" (input)="setSound(control.key, $event)">
@if (soundScope() === 'pad') {<button class="inherit" [disabled]="!hasOverride(control.key)" (click)="inheritSound(control.key)">{{ hasOverride(control.key) ? '↩ Use global length' : 'Following global length' }}</button>}</div>}
<div class="length-presets"><button [disabled]="!loaded()" (click)="lengthPreset('blip')">Blip · 10 ms</button><button (click)="lengthPreset('full')">Full slice</button></div><p class="slice-time">{{ shapedTime() }}</p>
<details class="sound-details"><summary>Tone &amp; envelope</summary>
@for (control of soundControls.slice(1); track control.key) {
<div class="sound-control"><div class="control-heading"><label [for]="'sound-' + control.key">{{ control.label }} <span class="dim">{{ control.unit }}</span></label><input [id]="'sound-' + control.key" [attr.aria-label]="control.label + ' value'" type="number" [min]="control.min" [max]="control.max" [step]="control.step" [value]="editorSound()[control.key]" (change)="setSound(control.key, $event)"></div><input type="range" [attr.aria-label]="control.label" [min]="control.min" [max]="control.max" [step]="control.step" [value]="editorSound()[control.key]" (input)="setSound(control.key, $event)">
@if (soundScope() === 'pad') {<button class="inherit" [disabled]="!hasOverride(control.key)" (click)="inheritSound(control.key)">{{ hasOverride(control.key) ? '↩ Use global ' + control.label.toLowerCase() : 'Following global ' + control.label.toLowerCase() }}</button>}</div>}
<p class="fine">Pitch changes speed. Pan: −100 L / +100 R.</p></details>
<button class="connect" [disabled]="!loaded() || loading()" (click)="audition(selected(), soundScope() === 'global')">▶ Preview {{ soundScope() === 'global' ? 'global sound' : 'slice' }}</button><button class="clear" (click)="resetSound()">{{ soundScope() === 'global' ? 'Reset global defaults' : 'Reset pad to global' }}</button>
</section>
<section id="panel-mod" [hidden]="panel() !== 'mod'" aria-label="Modulation controls"><div class="mod-heading"><span>Step modulation</span><label class="mod-enable"><input type="checkbox" aria-label="Enable modulation" [checked]="modulation().enabled" (change)="setModulation('enabled', $event)">On</label></div>
<p class="fine">Vary each new slice in time with the sequence.</p>
<label>Target<select aria-label="Modulation target" [value]="modulation().target" (change)="setModulation('target', $event)"><option value="pan">Pan · left / right</option><option value="volume">Volume · pulse</option><option value="pitch">Pitch · up / down</option></select></label>
<div class="mod-pair"><label>Cycle<select aria-label="Modulation cycle" [value]="modulation().steps" (change)="setModulation('steps', $event)">@for (rate of modulationRates; track rate.steps) {<option [value]="rate.steps">{{ rate.label }}</option>}</select></label><label>Shape<select aria-label="Modulation shape" [value]="modulation().waveform" (change)="setModulation('waveform', $event)"><option value="sine">Sine</option><option value="triangle">Triangle</option><option value="square">Square</option></select></label></div>
<label class="mod-depth">Depth <span>{{ modulation().depth }}%</span><input type="range" aria-label="Modulation depth" min="0" max="100" [value]="modulation().depth" (input)="setModulation('depth', $event)"></label>
<p class="fine">{{ modulation().target === 'pitch' ? 'Up to ±12 semitones. Pitch also changes slice length.' : modulation().target === 'pan' ? 'Adds stereo movement to each pad’s pan setting.' : 'Higher depth makes the quiet steps softer.' }} Resets on Play; sounding slices keep their values.</p></section>
<section id="panel-session" [hidden]="panel() !== 'session'" aria-label="Session controls"><p class="section-label">Pattern</p><button class="connect" (click)="exportSession()">Export pattern ↗</button><label class="file-picker">Import pattern<input aria-label="Import pattern" type="file" accept="application/json" (change)="importSession($event)"></label><p class="fine">Patterns and sound settings save on this device. Exports do not include audio.</p><button class="clear danger" (click)="clearPattern()">Clear pattern</button></section>
</div></aside></div>
<div class="status-bar"><p class="status" role="status">{{ message() }}</p><span>16 × 16</span></div>
</main>`})
class App implements OnDestroy, AfterViewInit {
  readonly panels = [{id:'source',label:'Source'},{id:'sound',label:'Sound'},{id:'mod',label:'Mod'},{id:'session',label:'Session'}] as const;
  panel = signal<'source'|'sound'|'mod'|'session'>('source');
  readonly modulationRates = MODULATION_RATES;
  modulation = signal<Modulation>({...DEFAULT_MODULATION});
  @ViewChildren('padButton') private padButtons!: QueryList<ElementRef<HTMLButtonElement>>;
  private padNodes:HTMLButtonElement[] = [];
  private litPads = new Set<number>();
  private nextPaintTime = 0;
  ngAfterViewInit() { this.padNodes = this.padButtons.map(pad => pad.nativeElement); }
  readonly soundControls = SOUND_CONTROLS;
  globalSound = signal<SoundSettings>({...DEFAULT_SOUND});
  padSounds = signal<PadSound[]>(Array.from({length:256}, () => ({})));
  soundScope = signal<'global'|'pad'>('global');
  editorSound = () => this.soundScope() === 'global' ? this.globalSound() : effectiveSound(this.globalSound(),this.padSounds()[this.selected()]);
  readonly steps = Array.from({length:16}, (_, i) => i);
  pattern = signal<boolean[]>(Array(256).fill(false)); mode = signal<'pattern'|'edit'>('pattern'); selected = signal(0);
  running = signal(false); loading = signal(false); loaded = signal(false); column = signal(-1);
  sourceId = signal(''); fileName = signal(''); duration = signal(0); bpm = signal(120); volume = signal(70);
  message = signal('Import a recording, select slices, then press Play.');
  private importController?: AbortController; private context?: AudioContext; private buffer?: AudioBuffer; private master?: GainNode;
  private voices = new Set<AudioBufferSourceNode>(); private timer?: ReturnType<typeof setInterval>; private animation = 0;
  private nextTime = 0; private nextColumn = 0; private nextStep = 0; private generation = 0;
  private events: {time:number; column:number; step:number}[] = []; private lights: {index:number; start:number; end:number; source:AudioBufferSourceNode; step:number; override?:SoundSettings}[] = [];
  enabledCount = () => this.pattern().filter(Boolean).length;
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
  editMode() { this.mode.set('edit'); this.soundScope.set('pad'); this.panel.set('sound'); }
  private audio() {
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
    try { const decoded = await this.audio().decodeAudioData(await file.arrayBuffer()); if (decoded.length < 256) throw new Error('Too short'); this.buffer = decoded; this.duration.set(decoded.duration); this.fileName.set(file.name); this.sourceId.set(''); this.loaded.set(true); this.panel.set('sound'); this.persist(); this.message.set('256 slices ready. Select squares and press Play.'); }
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
      this.buffer = decoded; this.duration.set(decoded.duration); this.fileName.set(job.title); this.sourceId.set(job.id); this.loaded.set(true); this.panel.set('sound'); this.persist();
      this.message.set(`256 slices ready · ${(job.bytes / 1_000_000).toFixed(2)} MB${job.cached ? ' · loaded from cache' : ''}. Select squares and press Play.`);
    } catch (error) { this.message.set(error instanceof Error && error.name !== 'AbortError' ? error.message : 'Import timed out. Try again or choose a shorter video.'); }
    finally { clearTimeout(timeout); this.importController = undefined; this.loading.set(false); }
  }
  private async readJob(response:Response):Promise<{id:string;status:string;message:string;title:string;bytes:number;cached?:boolean}> {
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Audio service unavailable. Restart the app with npm start.');
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Audio service unavailable. Restart with npm start.'); return data;
  }
  private async loadSavedAudio(id:string) {
    if (this.loading() || this.loaded()) return;
    this.loading.set(true); this.message.set('Restoring cached audio…');
    try {
      const audio = await fetch('/api/audio/' + id);
      if (!audio.ok) throw new Error('Saved audio expired. Open Source to import the link again.');
      const decoded = await new OfflineAudioContext(2,1,32000).decodeAudioData(await audio.arrayBuffer());
      if (this.sourceId() !== id) return;
      this.buffer = decoded; this.duration.set(decoded.duration); this.loaded.set(true); this.panel.set('sound');
      this.message.set('Cached audio ready. Press Space or Play.');
    } catch (error) {
      if (this.sourceId() === id) { this.panel.set('source'); this.message.set(error instanceof Error ? error.message : 'Could not restore cached audio. Open Source to import it again.'); }
    } finally { this.loading.set(false); }
  }
  reloadAudio() { if (this.sourceId()) void this.importYoutube('https://www.youtube.com/watch?v=' + this.sourceId()); }
  padLabel(index:number) { return `Slice ${index + 1}, row ${Math.floor(index / 16) + 1}, step ${index % 16 + 1}, ${this.pattern()[index] ? 'enabled' : 'disabled'}`; }
  sliceTime() { if (!this.buffer) return 'Import audio to preview'; const b = sliceBounds(this.buffer.length, this.buffer.sampleRate, this.selected()); return `${b.offset.toFixed(3)} – ${(b.offset + b.duration).toFixed(3)} s`; }
  press(index:number) {
    this.selected.set(index);
    if (this.mode() === 'edit') { this.soundScope.set('pad'); this.panel.set('sound'); return; }
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
  async audition(index:number, globalPreview = false) {
    if (!this.buffer || this.loading()) { this.message.set('Import a recording first.'); return; } const generation = this.generation;
    try { const ctx = this.audio(); await ctx.resume(); if (generation !== this.generation) return; this.trigger(index, ctx.currentTime + .005, globalPreview ? this.globalSound() : undefined); this.animate(); } catch { this.message.set('Audio could not start. Try previewing again.'); }
  }
  private trigger(index:number, time:number, override?:SoundSettings, step = 0) {
    if (!this.buffer || !this.context || !this.master) return;
    const bounds = sliceBounds(this.buffer.length, this.buffer.sampleRate, index);
    const settings = override ?? effectiveSound(this.globalSound(),this.padSounds()[index]);
    const shape = voiceShape(bounds.duration,modulateSound(settings,this.modulation(),step));
    const source = this.context.createBufferSource(); const envelope = this.context.createGain(); const pan = this.context.createStereoPanner();
    source.buffer = this.buffer; source.playbackRate.value = shape.rate; pan.pan.value = shape.pan;
    source.connect(envelope); envelope.connect(pan); pan.connect(this.master);
    envelope.gain.setValueAtTime(0,time); envelope.gain.linearRampToValueAtTime(shape.gain,time + shape.attack);
    envelope.gain.setValueAtTime(shape.gain,Math.max(time + shape.attack,time + shape.duration - shape.release)); envelope.gain.linearRampToValueAtTime(0,time + shape.duration);
    this.voices.add(source); source.onended = () => { this.voices.delete(source); source.disconnect(); envelope.disconnect(); pan.disconnect(); };
    source.start(time,bounds.offset,shape.sourceDuration);
    this.lights.push({index,start:time,end:time + shape.duration,source,step,override}); this.nextPaintTime = 0;
  }
  hasOverride(key:SoundKey) { return Object.hasOwn(this.padSounds()[this.selected()],key); }
  shapedTime() {
    if (!this.buffer) return 'Import audio to see the playback length';
    const bounds = sliceBounds(this.buffer.length,this.buffer.sampleRate,this.selected());
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
    else this.padSounds.update(pads => pads.map((pad,i) => i === this.selected() ? {...pad,[key]:clamped} : pad));
    this.refreshQueuedSound(); this.persist();
  }
  inheritSound(key:SoundKey) {
    this.padSounds.update(pads => pads.map((pad,i) => { if (i !== this.selected()) return pad; const next = {...pad}; delete next[key]; return next; }));
    this.refreshQueuedSound(); this.persist();
  }
  resetSound() {
    if (this.soundScope() === 'global') this.globalSound.set({...DEFAULT_SOUND});
    else this.padSounds.update(pads => pads.map((pad,i) => i === this.selected() ? {} : pad));
    this.refreshQueuedSound(); this.persist();
  }
  lengthPreset(preset:'blip'|'full') {
    if (preset === 'full') this.updateSound('length',100);
    else if (this.buffer) { const bounds = sliceBounds(this.buffer.length,this.buffer.sampleRate,this.selected()); this.updateSound('length',Math.round(10 / (bounds.duration * 1000) * 1000) / 10); }
  }
  private refreshQueuedSound(all = false) {
    const now = this.context?.currentTime ?? 0;
    const queued = this.lights.filter(light => light.start > now && (all || this.soundScope() === 'global' || light.index === this.selected()));
    const replace = new Set(queued);
    for (const light of queued) light.source.stop();
    this.lights = this.lights.filter(light => !replace.has(light));
    for (const light of queued) this.trigger(light.index,light.start,light.override,light.step);
    this.nextPaintTime = 0;
  }
  async start() {
    if (!this.buffer || this.loading() || this.running()) return; const generation = this.generation;
    try { const ctx = this.audio(); await ctx.resume(); if (generation !== this.generation || this.running()) return; this.running.set(true); this.nextColumn = 0; this.nextStep = 0; this.nextTime = ctx.currentTime + .05; this.schedule(); this.timer = setInterval(() => this.schedule(),25); this.animate(); this.message.set('Sequencing. Toggle squares to change the pattern.'); }
    catch { this.message.set('Audio could not start. Press Play to try again.'); }
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
  stop() { if (this.running()) this.message.set('Stopped. Press Play to start from the first column.'); this.generation++; this.running.set(false); clearInterval(this.timer); cancelAnimationFrame(this.animation); this.animation = 0; for (const voice of this.voices) { try { voice.stop(); } catch {} } this.voices.clear(); this.events = []; this.lights = []; this.column.set(-1); for (const index of this.litPads) this.padNodes[index]?.classList.remove('active'); this.litPads.clear(); this.nextPaintTime = 0; }
  clearPattern() { this.stop(); this.pattern.set(Array(256).fill(false)); this.persist(); }
  setTempo(event:Event) { const input = event.target as HTMLInputElement; const n = Number(input.value); if (Number.isFinite(n)) this.bpm.set(Math.max(30,Math.min(300,n))); input.value = String(this.bpm()); this.persist(); }
  setVolume(event:Event) { const input = event.target as HTMLInputElement; const n = Number(input.value); if (Number.isFinite(n)) this.volume.set(Math.max(0,Math.min(100,n))); input.value = String(this.volume()); if (this.master && this.context) this.master.gain.setTargetAtTime(this.volume() / 100,this.context.currentTime,.01); this.persist(); }
  private session() { return {version:1,pattern:this.pattern(),bpm:this.bpm(),volume:this.volume(),source:this.fileName(),sourceId:this.sourceId(),globalSound:this.globalSound(),padSounds:this.padSounds(),modulation:this.modulation()}; }
  private restore(data:unknown) { const d = data as ReturnType<App['session']>; if (!d || d.version !== 1 || !Array.isArray(d.pattern) || d.pattern.length !== 256 || !d.pattern.every(v => typeof v === 'boolean') || !Number.isFinite(d.bpm) || d.bpm < 30 || d.bpm > 300 || !Number.isFinite(d.volume) || d.volume < 0 || d.volume > 100) throw new Error('Invalid pattern'); const sounds = restoreSounds(d.globalSound,d.padSounds); const modulation = restoreModulation(d.modulation); this.modulation.set(modulation); this.globalSound.set(sounds.global); this.padSounds.set(sounds.pads); if (!this.loaded()) { this.sourceId.set(typeof d.sourceId === 'string' && /^[\w-]{11}$/.test(d.sourceId) ? d.sourceId : ''); this.fileName.set(typeof d.source === 'string' ? d.source.slice(0,200) : ''); } this.pattern.set([...d.pattern]); this.bpm.set(d.bpm); this.volume.set(d.volume); if (this.master && this.context) this.master.gain.setTargetAtTime(d.volume / 100,this.context.currentTime,.01); }
  private persist() { try { localStorage.setItem('stepfield-session-v1',JSON.stringify(this.session())); } catch { this.message.set('Storage unavailable. Export your pattern to keep it.'); } }
  exportSession() { const url = URL.createObjectURL(new Blob([JSON.stringify(this.session(),null,2)],{type:'application/json'})); const a = document.createElement('a'); a.href = url; a.download = 'stepfield-pattern.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000); }
  async importSession(event:Event) { const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = ''; if (!file) return; try { if (file.size > 100_000) throw new Error(); const data = JSON.parse(await file.text()); this.restore(data); this.stop(); this.persist(); this.message.set('Pattern imported. Audio is not included; load the matching recording.'); } catch { this.message.set('Invalid pattern file. Choose an exported audio-grid pattern.'); } }
  ngOnDestroy() { this.importController?.abort(); this.stop(); if (this.context) { this.context.onstatechange = null; void this.context.close(); } }
}
bootstrapApplication(App).catch(console.error);
