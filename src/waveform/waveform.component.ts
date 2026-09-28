import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core';
import { sliceAtTime, type SliceMode, type SliceState } from '../slices';
import type { WaveformPeaks } from './waveform-peaks';
import { drawActivity, drawWaveform, type WaveformVoice } from './waveform-renderer';

@Component({selector: 'source-editor', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<section class="source-editor" aria-label="Source editor" [style.--slice-color]="color">
  <header><h2>SOURCE EDITOR</h2><div class="source-selectors">
    <label>Row<select aria-label="Source row" [value]="row" (change)="selectSourceRow($event)">@for (number of rows; track number) {<option [value]="number">Row {{ (number + 1).toString().padStart(2, '0') }}</option>}</select></label>
    <label>Source slice<select aria-label="Source slice" [disabled]="!peaks || !state" [value]="selected" (change)="selectSource($event)">@for (number of slices; track number) {<option [value]="number">Slice {{ (number + 1).toString().padStart(3, '0') }}</option>}</select></label>
  </div></header>
  @if (peaks && state) {
    <div class="waveform-surface">
      <canvas #wave aria-label="Source waveform with 256 slices" role="img" [attr.data-selected-slice]="selected" [attr.data-view-start]="viewStart" [attr.data-view-end]="viewEnd"
        (pointerdown)="down($event)" (pointermove)="move($event)" (pointerup)="up($event)" (pointercancel)="cancel()" (pointerleave)="leave()" (wheel)="wheel($event)"></canvas>
      <canvas #activity class="activity" aria-hidden="true"></canvas>
    </div>
    <div class="editor-controls">
      <div class="button-group" aria-label="Waveform zoom"><button aria-label="Zoom out waveform" (click)="zoom(.5)">−</button><button aria-label="Fit entire waveform" (click)="fit()">Fit</button><button aria-label="Zoom in waveform" (click)="zoom(2)">+</button><button (click)="locate()" aria-label="Locate selected slice">Locate</button></div>
      <span class="slice-range">{{ start().toFixed(5) }} – {{ end().toFixed(5) }} s</span>
      <div class="button-group"><button (click)="audition.emit(false)" aria-label="Audition shaped slice">▶ Slice</button><button (click)="audition.emit(true)" aria-label="Audition raw slice">▶ Raw</button></div>
    </div>
    @if (viewEnd - viewStart < duration - .000001) {
      <label class="pan-control">Position<input type="range" aria-label="Waveform horizontal position" min="0" [max]="duration - (viewEnd - viewStart)" [step]="duration / 10000" [value]="viewStart" (input)="panInput($event)"></label>
    }
    <div class="editor-controls">
      <div class="button-group slice-modes" role="group" aria-label="Slice mode"><span>SLICE</span>@for (mode of modes; track mode) {<button [class.chosen]="state.mode === mode" [attr.aria-pressed]="state.mode === mode" (click)="chooseMode(mode)">{{ mode === 'beat' ? 'Beat' : mode === 'transient' ? 'Transient' : mode === 'equal' ? 'Equal' : 'Manual' }}</button>}</div>
      <button (click)="reset()">Reset slices</button>
    </div>
    @if (state.mode === 'manual') {
      <div class="boundary-controls"><label>Start · s<input aria-label="Slice start time" type="number" step="0.00001" min="0" [max]="end()" [disabled]="selected === 0" [value]="start()" (change)="editTime(selected, $event)"></label><label>End · s<input aria-label="Slice end time" type="number" step="0.00001" [min]="start()" [max]="duration" [disabled]="selected === 255" [value]="end()" (change)="editTime(selected + 1, $event)"></label></div>
    }
    @if (pendingMode) {<div class="reset-confirm" role="group" aria-label="Replace manual slices"><span>Replace manual boundaries?</span><button (click)="confirmReset()">Replace slices</button><button (click)="pendingMode = null">Keep edits</button></div>}
    <p class="hint">Click to assign a slice to this row. {{ state.mode === 'manual' ? 'Drag an edge to trim; use the top markers for other boundaries.' : 'Drag to pan when zoomed.' }} Shift-drag to pan · Ctrl/⌘-wheel to zoom.</p>
  } @else {<div class="waveform-surface empty-waveform" aria-label="Waveform preview"><p class="hint">Load a recording to see and edit its 256 source slices.</p></div>}
</section>`,
  styles: [`
:host{display:block;min-width:0}.source-editor{border-bottom:1px solid var(--border,#34393d);margin-bottom:18px;padding-bottom:16px;color:var(--text-primary,#dce2e5)}header,.editor-controls,.button-group,.reset-confirm{display:flex;align-items:center;gap:8px;flex-wrap:wrap}header{justify-content:space-between;margin-bottom:10px}.source-selectors{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.source-selectors label{display:flex;align-items:center;gap:7px}.source-selectors select{margin:0;min-height:34px;width:auto;font-size:12px;padding:6px 9px}h2{font-size:11px;font-weight:600;letter-spacing:.08em;margin:0}.slice-range{font-size:11px;font-variant-numeric:tabular-nums}.waveform-surface{position:relative;height:156px;background:var(--bg,#101618);border:1px solid var(--border,#34393d);border-radius:5px;overflow:hidden}.empty-waveform{display:grid;place-items:center;padding:12px}.empty-waveform .hint{margin:0;text-align:center}canvas{display:block;width:100%;height:100%;touch-action:pan-y}.activity{position:absolute;inset:0;pointer-events:none}.editor-controls{justify-content:space-between;margin-top:10px}.button-group{gap:3px}button{border:1px solid var(--border,#34393d);border-radius:4px;padding:6px 9px;font-size:11px}button.chosen{color:var(--slice-color);border-color:var(--slice-color)}.slice-modes>span{font-size:10px;margin-right:4px}.slice-range{color:var(--slice-color)}label{margin:0;font-size:10px}.boundary-controls{display:flex;gap:10px;margin-top:12px}.boundary-controls label{flex:1;min-width:0}input[type=number]{box-sizing:border-box;width:100%;font-size:12px;padding:7px;margin-top:4px;font-variant-numeric:tabular-nums}.pan-control{display:flex;align-items:center;gap:12px;margin-top:10px}.pan-control input{margin:0;flex:1;min-width:0;accent-color:var(--slice-color)}.hint{font-size:10px;color:var(--text-muted,#8e989e);line-height:1.6;margin:10px 0 0}.reset-confirm{margin-top:12px;font-size:11px}.reset-confirm button:first-of-type{border-color:var(--slice-color)}@media(max-width:560px){.editor-controls{gap:10px}.slice-range{order:3;flex-basis:100%}button{min-height:34px;padding:7px}input[type=number]{font-size:16px}header{gap:6px}.waveform-surface{height:110px}}
`]})
export class WaveformComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() peaks: WaveformPeaks | null = null;
  @Input() state: SliceState | null = null;
  @Input() duration = 0;
  @Input() selected = 0;
  @Input() row = 0;
  @Input() color = '#83C2D1';
  @Output() selectRow = new EventEmitter<number>();
  @Output() selectSlice = new EventEmitter<number>();
  @Output() changeMode = new EventEmitter<SliceMode>();
  @Output() resetSlices = new EventEmitter<void>();
  @Output() boundaryChange = new EventEmitter<{index: number; seconds: number; commit: boolean}>();
  @Output() audition = new EventEmitter<boolean>();
  @ViewChild('wave') wave?: ElementRef<HTMLCanvasElement>;
  @ViewChild('activity') activity?: ElementRef<HTMLCanvasElement>;
  readonly rows = Array.from({length:16},(_,i) => i);
  readonly slices = Array.from({length:256},(_,i) => i);
  readonly modes: SliceMode[] = ['beat', 'transient', 'equal', 'manual'];
  viewStart = 0; viewEnd = 0;
  pendingMode: SliceMode | 'reset' | null = null;
  private lastPeaks: WaveformPeaks | null = null;
  private lastSelection = -1;
  private hover = -1;
  private frame = 0;
  private resize?: ResizeObserver;
  private gesture: {id: number; x: number; start: number; end: number; boundary: number; moved: boolean; pan: boolean} | null = null;
  start() { return (this.state?.boundaries[this.selected] ?? 0) * this.duration; }
  end() { return (this.state?.boundaries[this.selected + 1] ?? 0) * this.duration; }
  ngAfterViewInit() { this.resize = new ResizeObserver(() => this.render()); this.resize.observe(this.host.nativeElement); this.render(); }
  constructor(private host: ElementRef<HTMLElement>) {}
  ngOnChanges(changes: SimpleChanges) {
    if (this.peaks !== this.lastPeaks) { this.lastPeaks = this.peaks; this.viewStart = 0; this.viewEnd = this.duration; this.pendingMode = null; }
    if (this.state?.mode !== 'manual') this.hover = -1;
    if (this.selected !== this.lastSelection || changes['state'] && !this.gesture) this.ensureVisible();
    this.lastSelection = this.selected; this.render();
  }
  private view() { return {start: this.viewStart, end: this.viewEnd, duration: this.duration, selected: this.selected, boundaries: this.state!.boundaries, color: this.color, hover: this.hover}; }
  private render() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; if (this.wave && this.peaks && this.state && this.viewEnd > this.viewStart) drawWaveform(this.wave.nativeElement, this.peaks, this.view()); });
  }
  paintActivity(voices: readonly WaveformVoice[], now: number) { if (this.activity && this.state && this.viewEnd > this.viewStart) drawActivity(this.activity.nativeElement, this.view(), voices, now); }
  private viewport(start: number, span: number) { span = Math.max(Math.min(this.duration, .01), Math.min(this.duration, span)); this.viewStart = Math.max(0, Math.min(this.duration - span, start)); this.viewEnd = this.viewStart + span; this.render(); }
  fit() { this.viewport(0, this.duration); }
  locate() { const span = Math.min(this.duration, Math.max((this.end() - this.start()) * 8, this.duration / 4096)); this.viewport((this.start() + this.end() - span) / 2, span); }
  zoom(factor: number, anchor = (this.start() + this.end()) / 2) { const oldSpan = this.viewEnd - this.viewStart, span = oldSpan / factor; const fraction = Math.max(0, Math.min(1, (anchor - this.viewStart) / oldSpan)); this.viewport(anchor - fraction * span, span); }
  private ensureVisible() { if (this.start() < this.viewStart || this.end() > this.viewEnd) { const span = Math.max(this.viewEnd - this.viewStart, (this.end() - this.start()) * 1.5); this.viewport((this.start() + this.end() - span) / 2, span); } }
  panInput(event: Event) { this.viewport(Number((event.target as HTMLInputElement).value), this.viewEnd - this.viewStart); }
  selectSource(event:Event) { const value = Number((event.target as HTMLSelectElement).value); if (Number.isInteger(value) && value >= 0 && value < 256) this.selectSlice.emit(value); }
  selectSourceRow(event:Event) { this.selectRow.emit(Number((event.target as HTMLSelectElement).value)); }
  editTime(index: number, event: Event) { const input = event.target as HTMLInputElement, value = Number(input.value); if (input.value && Number.isFinite(value)) this.boundaryChange.emit({index, seconds: value, commit: true}); input.value = String((this.state?.boundaries[index] ?? 0) * this.duration); this.render(); }
  chooseMode(mode: SliceMode) { if (mode === this.state?.mode) return; if (mode !== 'manual' && this.state?.manuallyEdited) this.pendingMode = mode; else { this.pendingMode = null; this.changeMode.emit(mode); } }
  reset() { if (this.state?.mode === 'manual' && this.state.manuallyEdited) this.pendingMode = 'reset'; else this.resetSlices.emit(); }
  confirmReset() { const mode = this.pendingMode; this.pendingMode = null; if (mode === 'reset') this.resetSlices.emit(); else if (mode) this.changeMode.emit(mode); }
  private time(clientX: number) { const rect = this.wave!.nativeElement.getBoundingClientRect(); return Math.max(this.viewStart, Math.min(this.viewEnd, this.viewStart + (clientX - rect.left) / rect.width * (this.viewEnd - this.viewStart))); }
  private hit(event: PointerEvent) {
    if (this.state?.mode !== 'manual' || !this.wave) return -1;
    const rect = this.wave.nativeElement.getBoundingClientRect(), time = this.time(event.clientX);
    const tolerance = (event.pointerType === 'touch' ? 10 : 5) / rect.width * (this.viewEnd - this.viewStart);
    const candidates = event.clientY - rect.top < 26 ? Array.from({length: 255}, (_, i) => i + 1) : [this.selected, this.selected + 1].filter(i => i > 0 && i < 256);
    let best = -1, distance = tolerance;
    for (const i of candidates) { const d = Math.abs(this.state.boundaries[i] * this.duration - time); if (d < distance) { best = i; distance = d; } }
    return best;
  }
  down(event: PointerEvent) {
    if (event.button !== 0 || !this.wave || !this.state || this.gesture) return;
    const boundary = event.shiftKey ? -1 : this.hit(event);
    this.gesture = {id: event.pointerId, x: event.clientX, start: this.viewStart, end: this.viewEnd, boundary, moved: false, pan: event.shiftKey};
    this.wave.nativeElement.setPointerCapture(event.pointerId);
  }
  move(event: PointerEvent) {
    const g = this.gesture;
    if (g && g.id === event.pointerId) {
      if (Math.abs(event.clientX - g.x) > 3) g.moved = true;
      if (!g.moved) return;
      if (g.boundary > 0) { this.hover = g.boundary; this.boundaryChange.emit({index: g.boundary, seconds: this.time(event.clientX), commit: false}); }
      else { const width = this.wave!.nativeElement.clientWidth; this.viewport(g.start - (event.clientX - g.x) / width * (g.end - g.start), g.end - g.start); }
    } else { const hover = event.shiftKey ? -1 : this.hit(event); if (hover !== this.hover) { this.hover = hover; this.render(); } }
    if (this.wave) this.wave.nativeElement.style.cursor = this.hover > 0 ? 'ew-resize' : 'grab';
  }
  up(event: PointerEvent) {
    const g = this.gesture; if (!g || g.id !== event.pointerId) return;
    this.gesture = null;
    if (g.moved && g.boundary > 0) this.boundaryChange.emit({index: g.boundary, seconds: this.time(event.clientX), commit: true});
    else if (!g.moved && !g.pan && this.state) this.selectSlice.emit(sliceAtTime(this.state.boundaries, this.time(event.clientX) / this.duration));
    if (this.wave?.nativeElement.hasPointerCapture(event.pointerId)) this.wave.nativeElement.releasePointerCapture(event.pointerId);
    this.render();
  }
  cancel() { const g = this.gesture; this.gesture = null; if (g?.moved && g.boundary > 0 && this.state) this.boundaryChange.emit({index: g.boundary, seconds: this.state.boundaries[g.boundary] * this.duration, commit: true}); this.hover = -1; this.render(); }
  leave() { if (!this.gesture) { this.hover = -1; this.render(); } }
  wheel(event: WheelEvent) {
    if (event.ctrlKey || event.metaKey) { event.preventDefault(); this.zoom(Math.exp(-event.deltaY * .01), this.time(event.clientX)); }
    else if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) { event.preventDefault(); const delta = event.shiftKey ? event.deltaY || event.deltaX : event.deltaX; this.viewport(this.viewStart + delta / this.wave!.nativeElement.clientWidth * (this.viewEnd - this.viewStart), this.viewEnd - this.viewStart); }
  }
  ngOnDestroy() { cancelAnimationFrame(this.frame); this.resize?.disconnect(); }
}
