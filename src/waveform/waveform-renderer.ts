import type { WaveformPeaks } from './waveform-peaks';

export interface WaveformVoice { start: number; end: number; offset: number; sourceDuration: number; rate: number }
export interface WaveformView { start: number; end: number; duration: number; selected: number; boundaries: readonly number[]; color: string; hover: number }

function surface(canvas: HTMLCanvasElement) {
  const width = canvas.clientWidth, height = canvas.clientHeight, ratio = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
  const ctx = canvas.getContext('2d');
  if (!ctx || !width || !height) return null;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
  return {ctx, width, height};
}

export function drawWaveform(canvas: HTMLCanvasElement, peaks: WaveformPeaks, view: WaveformView) {
  const s = surface(canvas); if (!s) return;
  const {ctx, width, height} = s, span = view.end - view.start;
  const x = (time: number) => (time - view.start) / span * width;
  const left = x(view.boundaries[view.selected] * view.duration), right = x(view.boundaries[view.selected + 1] * view.duration);
  ctx.fillStyle = view.color; ctx.globalAlpha = .15; ctx.fillRect(left, 22, Math.max(1, right - left), height - 42); ctx.globalAlpha = 1;
  // A pyramid level close to one bin per pixel bounds drawing work at every zoom level.
  const framesPerPixel = span * peaks.sampleRate / width;
  const level = Math.max(0, Math.min(peaks.levels.length - 1, Math.floor(Math.log2(Math.max(1, framesPerPixel / peaks.blockSize)))));
  const bins = peaks.levels[level], binSize = peaks.blockSize * 2 ** level;
  ctx.strokeStyle = '#8e989e'; ctx.lineWidth = 1; ctx.beginPath();
  const middle = height / 2, amplitude = (height - 52) / 2;
  for (let pixel = 0; pixel < width; pixel++) {
    const from = Math.floor((view.start + pixel / width * span) * peaks.sampleRate / binSize);
    const to = Math.min(bins.length, Math.ceil((view.start + (pixel + 1) / width * span) * peaks.sampleRate / binSize));
    let peak = 0; for (let bin = Math.max(0, from); bin < to; bin++) peak = Math.max(peak, bins[bin]);
    const size = Math.max(.5, Math.min(1, peak) * amplitude);
    ctx.moveTo(pixel + .5, middle - size); ctx.lineTo(pixel + .5, middle + size);
  }
  ctx.stroke();
  for (let i = 0; i < view.boundaries.length; i++) {
    const position = x(view.boundaries[i] * view.duration); if (position < 0 || position > width) continue;
    const selected = i === view.selected || i === view.selected + 1, hovered = i === view.hover;
    ctx.strokeStyle = selected || hovered ? view.color : '#626c73'; ctx.globalAlpha = selected || hovered ? 1 : .35; ctx.lineWidth = hovered ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(position, selected || hovered ? 17 : 26); ctx.lineTo(position, height - 20); ctx.stroke();
    if (selected) { ctx.fillStyle = view.color; ctx.fillRect(position - 3, 17, 6, 7); }
  }
  ctx.globalAlpha = 1; ctx.fillStyle = '#aab5bb'; ctx.font = '10px sans-serif';
  ctx.textAlign = 'left'; ctx.fillText(`${view.start.toFixed(3)} s`, 5, height - 5);
  ctx.textAlign = 'right'; ctx.fillText(`${view.end.toFixed(3)} s`, width - 5, height - 5);
  if (view.hover > 0 && view.hover < 256) {
    const time = view.boundaries[view.hover] * view.duration;
    ctx.textAlign = 'center'; ctx.fillStyle = view.color; ctx.fillText(`${time.toFixed(5)} s`, Math.max(40, Math.min(width - 40, x(time))), 12);
  }
}

export function drawActivity(canvas: HTMLCanvasElement, view: WaveformView, voices: readonly WaveformVoice[], now: number) {
  const s = surface(canvas); if (!s) return;
  const {ctx, width, height} = s, span = view.end - view.start;
  const x = (time: number) => (time - view.start) / span * width;
  ctx.fillStyle = view.color;
  for (const voice of voices) {
    if (voice.start > now || voice.end <= now) continue;
    const left = x(voice.offset), right = x(voice.offset + voice.sourceDuration);
    ctx.globalAlpha = .12; ctx.fillRect(left, 22, Math.max(1, right - left), height - 42);
    ctx.globalAlpha = .9; ctx.fillRect(x(voice.offset + Math.min(voice.sourceDuration, (now - voice.start) * voice.rate)), 22, 1.5, height - 42);
  }
  ctx.globalAlpha = 1;
}
