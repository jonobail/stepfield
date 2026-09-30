import type { WaveformPeaks } from './waveform-peaks';

/** A sounding voice: audio-clock start/end, plus the part of the source it plays. */
export interface WaveformVoice {
  start: number;
  end: number;
  offset: number;
  sourceDuration: number;
  rate: number;
}

export interface WaveformView {
  /** Visible range in seconds. */
  start: number;
  end: number;
  duration: number;
  selected: number;
  /** Normalized (0–1) slice boundaries. */
  boundaries: readonly number[];
  color: string;
  hover: number;
}

/** Vertical layout, in CSS pixels. */
const MARKER_TOP = 17;
const LINE_TOP = 26;
const BAND_TOP = 22;
const BOTTOM_MARGIN = 20;

/** Size the canvas backing store for the device pixel ratio and clear it. */
function surface(canvas: HTMLCanvasElement) {
  const width = canvas.clientWidth, height = canvas.clientHeight, ratio = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx || !width || !height) return null;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return {ctx, width, height};
}

export function drawWaveform(canvas: HTMLCanvasElement, peaks: WaveformPeaks, view: WaveformView) {
  const s = surface(canvas);
  if (!s) return;
  const {ctx, width, height} = s, span = view.end - view.start;
  const x = (time: number) => (time - view.start) / span * width;
  const bandHeight = height - BAND_TOP - BOTTOM_MARGIN;

  // Highlight the selected slice.
  const left = x(view.boundaries[view.selected] * view.duration);
  const right = x(view.boundaries[view.selected + 1] * view.duration);
  ctx.fillStyle = view.color;
  ctx.globalAlpha = .15;
  ctx.fillRect(left, BAND_TOP, Math.max(1, right - left), bandHeight);
  ctx.globalAlpha = 1;

  // A pyramid level close to one bin per pixel bounds drawing work at every zoom level.
  const framesPerPixel = span * peaks.sampleRate / width;
  const level = Math.max(0, Math.min(peaks.levels.length - 1, Math.floor(Math.log2(Math.max(1, framesPerPixel / peaks.blockSize)))));
  const bins = peaks.levels[level], binSize = peaks.blockSize * 2 ** level;
  // One vertical peak line per pixel.
  ctx.strokeStyle = '#8e989e';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const middle = height / 2, amplitude = (height - 52) / 2;
  const binAt = (pixel: number) => (view.start + pixel / width * span) * peaks.sampleRate / binSize;
  for (let pixel = 0; pixel < width; pixel++) {
    const from = Math.max(0, Math.floor(binAt(pixel)));
    const to = Math.min(bins.length, Math.ceil(binAt(pixel + 1)));
    let peak = 0;
    for (let bin = from; bin < to; bin++) peak = Math.max(peak, bins[bin]);
    const size = Math.max(.5, Math.min(1, peak) * amplitude);
    ctx.moveTo(pixel + .5, middle - size);
    ctx.lineTo(pixel + .5, middle + size);
  }
  ctx.stroke();

  // Slice boundaries; the selected slice's edges get a handle, the hovered one is thicker.
  for (let i = 0; i < view.boundaries.length; i++) {
    const position = x(view.boundaries[i] * view.duration);
    if (position < 0 || position > width) continue;
    const selected = i === view.selected || i === view.selected + 1;
    const hovered = i === view.hover;
    const emphasized = selected || hovered;
    ctx.strokeStyle = emphasized ? view.color : '#626c73';
    ctx.globalAlpha = emphasized ? 1 : .35;
    ctx.lineWidth = hovered ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(position, emphasized ? MARKER_TOP : LINE_TOP);
    ctx.lineTo(position, height - BOTTOM_MARGIN);
    ctx.stroke();
    if (selected) {
      ctx.fillStyle = view.color;
      ctx.fillRect(position - 3, MARKER_TOP, 6, 7);
    }
  }

  // Time labels for the visible range and the hovered boundary.
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#aab5bb';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${view.start.toFixed(3)} s`, 5, height - 5);
  ctx.textAlign = 'right';
  ctx.fillText(`${view.end.toFixed(3)} s`, width - 5, height - 5);
  if (view.hover > 0 && view.hover < 256) {
    const time = view.boundaries[view.hover] * view.duration;
    ctx.textAlign = 'center';
    ctx.fillStyle = view.color;
    ctx.fillText(`${time.toFixed(5)} s`, Math.max(40, Math.min(width - 40, x(time))), 12);
  }
}

export function drawActivity(canvas: HTMLCanvasElement, view: WaveformView, voices: readonly WaveformVoice[], now: number) {
  const s = surface(canvas);
  if (!s) return;
  const {ctx, width, height} = s, span = view.end - view.start;
  const x = (time: number) => (time - view.start) / span * width;
  const bandHeight = height - BAND_TOP - BOTTOM_MARGIN;
  ctx.fillStyle = view.color;
  for (const voice of voices) {
    if (voice.start > now || voice.end <= now) continue;
    // Shade the region the voice plays, with a cursor at its current source position.
    const left = x(voice.offset), right = x(voice.offset + voice.sourceDuration);
    const position = voice.offset + Math.min(voice.sourceDuration, (now - voice.start) * voice.rate);
    ctx.globalAlpha = .12;
    ctx.fillRect(left, BAND_TOP, Math.max(1, right - left), bandHeight);
    ctx.globalAlpha = .9;
    ctx.fillRect(x(position), BAND_TOP, 1.5, bandHeight);
  }
  ctx.globalAlpha = 1;
}
