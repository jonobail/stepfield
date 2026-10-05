import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core';
import { pad2, pad3 } from '../format';
import { SLICE_COUNT, sliceAtTime, type SliceMode, type SliceState } from '../slices';
import type { WaveformPeaks } from './waveform-peaks';
import { drawActivity, drawWaveform, type WaveformView, type WaveformVoice } from './waveform-renderer';

export interface BoundaryEdit {
  /** Boundary index, 1–255; the recording's first and last boundaries are fixed. */
  index: number;
  seconds: number;
  /** False while dragging; true when the edit is final and should be saved. */
  commit: boolean;
}

export interface SliceMoveEdit {
  slice: number;
  /** New start time; the slice keeps its length. */
  seconds: number;
  commit: boolean;
}

/** A pointer interaction on the waveform: a click, a pan, a boundary drag, or a whole-slice drag. */
interface WaveformGesture {
  pointerId: number;
  startX: number;
  viewStart: number;
  viewEnd: number;
  /** Boundary being dragged, or -1 when panning/clicking. */
  boundary: number;
  /** True when dragging the selected slice's window as a whole. */
  slide: boolean;
  /** Pointer time and slice start when the press began, for whole-slice drags. */
  grabTime: number;
  grabStart: number;
  moved: boolean;
  pan: boolean;
}

/** Pixels a pointer must move before a press becomes a drag. */
const DRAG_THRESHOLD_PX = 3;
/** Pointers within this many pixels of the top grab any boundary marker, not just the selected slice's edges. */
const MARKER_STRIP_PX = 26;
const MIN_VIEW_SECONDS = 0.01;

/** Waveform view of the source recording: pick a row's slice, zoom/pan, and edit slice boundaries. */
@Component({
  selector: 'source-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './source-editor.component.html',
  styleUrl: './source-editor.component.css',
})
export class SourceEditorComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() peaks: WaveformPeaks | null = null;
  @Input() state: SliceState | null = null;
  @Input() duration = 0;
  /** Slice assigned to the selected row. */
  @Input() selected = 0;
  @Input() row = 0;
  @Input() color = '#83C2D1';

  @Output() selectRow = new EventEmitter<number>();
  @Output() selectSlice = new EventEmitter<number>();
  @Output() changeMode = new EventEmitter<SliceMode>();
  @Output() resetSlices = new EventEmitter<void>();
  @Output() boundaryChange = new EventEmitter<BoundaryEdit>();
  @Output() sliceMove = new EventEmitter<SliceMoveEdit>();
  /** Emits true for a raw audition, false for one with the row's sound settings. */
  @Output() audition = new EventEmitter<boolean>();
  /** The empty state asks the app to open its file picker. */
  @Output() chooseAudio = new EventEmitter<void>();

  @ViewChild('wave') private wave?: ElementRef<HTMLCanvasElement>;
  @ViewChild('activity') private activity?: ElementRef<HTMLCanvasElement>;

  readonly rows = Array.from({length: 16}, (_, row) => row);
  readonly slices = Array.from({length: SLICE_COUNT}, (_, slice) => slice);
  readonly modes: {value: SliceMode; label: string}[] = [
    {value: 'beat', label: 'Beat'},
    {value: 'transient', label: 'Transient'},
    {value: 'equal', label: 'Equal'},
    {value: 'manual', label: 'Manual'},
  ];

  /** Visible time range, in seconds. */
  viewStart = 0;
  viewEnd = 0;
  /** A mode change or reset waiting for confirmation because it would discard manual edits. */
  pendingMode: SliceMode | 'reset' | null = null;

  private lastPeaks: WaveformPeaks | null = null;
  private lastSelection = -1;
  /** Boundary under the pointer, or -1. */
  private hover = -1;
  private frame = 0;
  private resizeObserver?: ResizeObserver;
  private gesture: WaveformGesture | null = null;

  constructor(private host: ElementRef<HTMLElement>) {}

  ngAfterViewInit() {
    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(this.host.nativeElement);
    this.render();
  }

  ngOnChanges(changes: SimpleChanges) {
    // A new recording resets the view.
    if (this.peaks !== this.lastPeaks) {
      this.lastPeaks = this.peaks;
      this.viewStart = 0;
      this.viewEnd = this.duration;
      this.pendingMode = null;
    }
    if (this.selected !== this.lastSelection || (changes['state'] && !this.gesture)) this.ensureVisible();
    this.lastSelection = this.selected;
    this.render();
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
  }

  start() {
    return (this.state?.boundaries[this.selected] ?? 0) * this.duration;
  }

  end() {
    return (this.state?.boundaries[this.selected + 1] ?? 0) * this.duration;
  }

  zoomedIn() {
    return this.viewEnd - this.viewStart < this.duration - 0.000001;
  }

  /** Draw the playing voices over the waveform. Called every animation frame by the app, bypassing change detection. */
  paintActivity(voices: readonly WaveformVoice[], now: number) {
    if (this.activity && this.state && this.viewEnd > this.viewStart) drawActivity(this.activity.nativeElement, this.view(), voices, now);
  }

  // ── Toolbar actions ──

  fit() {
    this.setViewport(0, this.duration);
  }

  locate() {
    const span = Math.min(this.duration, Math.max((this.end() - this.start()) * 8, this.duration / 4096));
    this.setViewport((this.start() + this.end() - span) / 2, span);
  }

  /** Zoom by `factor`, keeping `anchor` (seconds) at the same place on screen. */
  zoom(factor: number, anchor = (this.start() + this.end()) / 2) {
    const oldSpan = this.viewEnd - this.viewStart;
    const span = oldSpan / factor;
    const fraction = Math.max(0, Math.min(1, (anchor - this.viewStart) / oldSpan));
    this.setViewport(anchor - fraction * span, span);
  }

  panInput(event: Event) {
    this.setViewport(Number((event.target as HTMLInputElement).value), this.viewEnd - this.viewStart);
  }

  selectSource(event: Event) {
    const slice = Number((event.target as HTMLSelectElement).value);
    if (Number.isInteger(slice) && slice >= 0 && slice < SLICE_COUNT) this.selectSlice.emit(slice);
  }

  selectSourceRow(event: Event) {
    this.selectRow.emit(Number((event.target as HTMLSelectElement).value));
  }

  editTime(index: number, event: Event) {
    const input = event.target as HTMLInputElement;
    const seconds = Number(input.value);
    if (input.value && Number.isFinite(seconds)) this.boundaryChange.emit({index, seconds, commit: true});
    // Show the clamped value the parent actually applied.
    input.value = String((this.state?.boundaries[index] ?? 0) * this.duration);
    this.render();
  }

  chooseMode(mode: SliceMode) {
    if (mode === this.state?.mode) return;
    if (mode !== 'manual' && this.state?.manuallyEdited) {
      this.pendingMode = mode;
    } else {
      this.pendingMode = null;
      this.changeMode.emit(mode);
    }
  }

  reset() {
    if (this.state?.mode === 'manual' && this.state.manuallyEdited) this.pendingMode = 'reset';
    else this.resetSlices.emit();
  }

  confirmReset() {
    const mode = this.pendingMode;
    this.pendingMode = null;
    if (mode === 'reset') this.resetSlices.emit();
    else if (mode) this.changeMode.emit(mode);
  }

  // ── Pointer & wheel ──

  down(event: PointerEvent) {
    if (event.button !== 0 || !this.wave || !this.state || this.gesture) return;
    const boundary = event.shiftKey ? -1 : this.boundaryAt(event);
    this.gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      viewStart: this.viewStart,
      viewEnd: this.viewEnd,
      boundary,
      slide: !event.shiftKey && boundary < 0 && this.inSelectedWindow(event.clientX),
      grabTime: this.timeAt(event.clientX),
      grabStart: this.start(),
      moved: false,
      pan: event.shiftKey,
    };
    this.wave.nativeElement.setPointerCapture(event.pointerId);
  }

  move(event: PointerEvent) {
    const gesture = this.gesture;
    if (gesture && gesture.pointerId === event.pointerId) {
      if (Math.abs(event.clientX - gesture.startX) > DRAG_THRESHOLD_PX) gesture.moved = true;
      if (!gesture.moved) return;
      if (gesture.boundary > 0 || gesture.slide) this.ensureManual();
      if (gesture.boundary > 0) {
        this.hover = gesture.boundary;
        this.boundaryChange.emit({index: gesture.boundary, seconds: this.timeAt(event.clientX), commit: false});
      } else if (gesture.slide) {
        this.sliceMove.emit({slice: this.selected, seconds: this.slideTarget(gesture, event.clientX), commit: false});
      } else {
        const span = gesture.viewEnd - gesture.viewStart;
        const width = this.wave!.nativeElement.clientWidth;
        this.setViewport(gesture.viewStart - (event.clientX - gesture.startX) / width * span, span);
      }
    } else {
      const hover = event.shiftKey ? -1 : this.boundaryAt(event);
      if (hover !== this.hover) {
        this.hover = hover;
        this.render();
      }
    }
    if (this.wave) {
      this.wave.nativeElement.style.cursor = this.hover > 0 ? 'ew-resize'
        : gesture?.slide ? 'grabbing'
        : !gesture && !event.shiftKey && this.inSelectedWindow(event.clientX) ? 'move'
        : 'grab';
    }
  }

  up(event: PointerEvent) {
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    this.gesture = null;
    if (gesture.moved && gesture.boundary > 0) {
      this.boundaryChange.emit({index: gesture.boundary, seconds: this.timeAt(event.clientX), commit: true});
    } else if (gesture.moved && gesture.slide) {
      this.sliceMove.emit({slice: this.selected, seconds: this.slideTarget(gesture, event.clientX), commit: true});
    } else if (!gesture.moved && !gesture.pan && this.state) {
      // A click without dragging assigns the slice under the pointer.
      this.selectSlice.emit(sliceAtTime(this.state.boundaries, this.timeAt(event.clientX) / this.duration));
    }
    if (this.wave?.nativeElement.hasPointerCapture(event.pointerId)) this.wave.nativeElement.releasePointerCapture(event.pointerId);
    this.render();
  }

  cancel() {
    const gesture = this.gesture;
    this.gesture = null;
    // Commit the boundary where it was last emitted, so the parent saves it.
    if (gesture?.moved && gesture.boundary > 0 && this.state) {
      this.boundaryChange.emit({index: gesture.boundary, seconds: this.state.boundaries[gesture.boundary] * this.duration, commit: true});
    } else if (gesture?.moved && gesture.slide && this.state) {
      this.sliceMove.emit({slice: this.selected, seconds: this.start(), commit: true});
    }
    this.hover = -1;
    this.render();
  }

  leave() {
    if (this.gesture) return;
    this.hover = -1;
    this.render();
  }

  wheel(event: WheelEvent) {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      this.zoom(Math.exp(-event.deltaY * 0.01), this.timeAt(event.clientX));
    } else if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      event.preventDefault();
      const delta = event.shiftKey ? event.deltaY || event.deltaX : event.deltaX;
      const span = this.viewEnd - this.viewStart;
      this.setViewport(this.viewStart + delta / this.wave!.nativeElement.clientWidth * span, span);
    }
  }

  // ── Internals ──

  private view(): WaveformView {
    return {
      start: this.viewStart,
      end: this.viewEnd,
      duration: this.duration,
      selected: this.selected,
      boundaries: this.state!.boundaries,
      color: this.color,
      hover: this.hover,
    };
  }

  /** Redraw on the next animation frame, coalescing repeated requests. */
  private render() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.wave && this.peaks && this.state && this.viewEnd > this.viewStart) drawWaveform(this.wave.nativeElement, this.peaks, this.view());
    });
  }

  private setViewport(start: number, span: number) {
    span = Math.max(Math.min(this.duration, MIN_VIEW_SECONDS), Math.min(this.duration, span));
    this.viewStart = Math.max(0, Math.min(this.duration - span, start));
    this.viewEnd = this.viewStart + span;
    this.render();
  }

  /** Scroll so the selected slice is visible, zooming out if it is wider than the view. */
  private ensureVisible() {
    if (this.start() >= this.viewStart && this.end() <= this.viewEnd) return;
    const span = Math.max(this.viewEnd - this.viewStart, (this.end() - this.start()) * 1.5);
    this.setViewport((this.start() + this.end() - span) / 2, span);
  }

  /** Seconds under a client x coordinate, clamped to the view. */
  private timeAt(clientX: number) {
    const rect = this.wave!.nativeElement.getBoundingClientRect();
    const time = this.viewStart + (clientX - rect.left) / rect.width * (this.viewEnd - this.viewStart);
    return Math.max(this.viewStart, Math.min(this.viewEnd, time));
  }

  /** Dragging edits the map by hand; switching to manual keeps the current boundaries. */
  private ensureManual() {
    if (this.state && this.state.mode !== 'manual') this.changeMode.emit('manual');
  }

  /** Whether a client x coordinate is inside the selected slice, which can be dragged as a whole unless it touches a fixed endpoint. */
  private inSelectedWindow(clientX: number) {
    if (!this.state || this.selected <= 0 || this.selected >= SLICE_COUNT - 1) return false;
    const time = this.timeAt(clientX);
    return time > this.start() && time < this.end();
  }

  private slideTarget(gesture: WaveformGesture, clientX: number) {
    return gesture.grabStart + this.timeAt(clientX) - gesture.grabTime;
  }

  /** The draggable boundary under the pointer, or -1. */
  private boundaryAt(event: PointerEvent) {
    if (!this.state || !this.wave) return -1;
    const rect = this.wave.nativeElement.getBoundingClientRect();
    const time = this.timeAt(event.clientX);
    const tolerance = (event.pointerType === 'touch' ? 10 : 5) / rect.width * (this.viewEnd - this.viewStart);
    const candidates = event.clientY - rect.top < MARKER_STRIP_PX
      ? Array.from({length: SLICE_COUNT - 1}, (_, i) => i + 1)
      : [this.selected, this.selected + 1].filter(i => i > 0 && i < SLICE_COUNT);

    let best = -1, bestDistance = tolerance;
    for (const index of candidates) {
      const distance = Math.abs(this.state.boundaries[index] * this.duration - time);
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    }
    return best;
  }

  readonly pad2 = pad2;
  readonly pad3 = pad3;
}
