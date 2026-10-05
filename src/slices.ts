import type { AudioSlice } from './sequencer';

export const SLICE_COUNT = 256;
export type AutomaticSliceMode = 'beat' | 'transient' | 'equal';
export type SliceMode = AutomaticSliceMode | 'manual';
/** Normalized source boundaries are the sole editable map, including both fixed endpoints. */
export interface SliceState {
  mode: SliceMode;
  automaticMode: AutomaticSliceMode;
  boundaries: number[];
  manuallyEdited: boolean;
  bpm?: number;
  confidence?: number;
}

/** Boundaries are 257 strictly increasing fractions of the recording, from exactly 0 to exactly 1. */
export function validateBoundaries(value: unknown): number[] {
  const valid = Array.isArray(value) &&
    value.length === SLICE_COUNT + 1 &&
    value[0] === 0 &&
    value[SLICE_COUNT] === 1 &&
    value.every((n, i) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1 && (i === 0 || n > value[i - 1]));
  if (!valid) throw new Error('Invalid slice boundaries');
  return [...value];
}

export function slicesToBoundaries(slices: readonly AudioSlice[], duration: number): number[] {
  if (slices.length !== SLICE_COUNT || !Number.isFinite(duration) || duration <= 0) throw new Error('Invalid slice map');
  let end = 0;
  for (const slice of slices) {
    if (!Number.isFinite(slice.offset) || !Number.isFinite(slice.duration) || slice.duration <= 0 || Math.abs(slice.offset - end) > 1e-8 * duration) throw new Error('Non-contiguous slice map');
    end = slice.offset + slice.duration;
  }
  if (Math.abs(end - duration) > 1e-8 * duration) throw new Error('Incomplete slice map');
  return validateBoundaries([0, ...slices.slice(1).map(slice => slice.offset / duration), 1]);
}

/** Resolve to frames only when audio is available, retaining at least one frame per slice. */
export function boundariesToSlices(boundaries: readonly number[], length: number, sampleRate: number): AudioSlice[] {
  const valid = validateBoundaries(boundaries);
  if (!Number.isInteger(length) || length < SLICE_COUNT || !Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('Audio is too short for 256 slices');
  const frames = [0];
  for (let i = 1; i < SLICE_COUNT; i++) frames.push(Math.max(frames[i - 1] + 1, Math.min(length - (SLICE_COUNT - i), Math.round(valid[i] * length))));
  frames.push(length);
  return frames.slice(0, -1).map((frame, i) => ({offset: frame / sampleRate, duration: (frames[i + 1] - frame) / sampleRate}));
}

export function equalBoundaries(length: number): number[] {
  if (!Number.isInteger(length) || length < SLICE_COUNT) throw new Error('Audio is too short for 256 slices');
  return Array.from({length: SLICE_COUNT + 1}, (_, i) => Math.floor(i * length / SLICE_COUNT) / length);
}

/** Positive RMS-energy flux, using the same 10 ms analysis windows as beat detection. */
export function transientBoundaries(channels: readonly Float32Array[], sampleRate: number): number[] {
  const length = channels[0]?.length ?? 0;
  if (!channels.length || channels.some(c => c.length !== length) || !Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('Invalid audio');
  const equal = equalBoundaries(length);
  const hop = Math.max(1, Math.round(sampleRate / 100));
  const energy = new Float32Array(Math.ceil(length / hop));
  for (let frame = 0; frame < energy.length; frame++) {
    let sum = 0, count = 0;
    const end = Math.min(length, (frame + 1) * hop);
    // Every fourth sample is enough to estimate the window's energy.
    for (const channel of channels) {
      for (let i = frame * hop; i < end; i += 4) {
        sum += channel[i] ** 2;
        count++;
      }
    }
    energy[frame] = Math.sqrt(sum / Math.max(1, count));
  }

  const flux = new Float32Array(energy.length);
  let sum = 0, peak = 0;
  for (let i = 1; i < energy.length; i++) {
    flux[i] = Math.max(0, energy[i] - energy[i - 1]);
    sum += flux[i];
    peak = Math.max(peak, flux[i]);
  }
  if (peak < 1e-8) return equal;

  // Onsets are local flux maxima well above the average.
  const threshold = Math.max(sum / flux.length * 1.8, peak * .08);
  const candidates: {frame: number; strength: number}[] = [];
  for (let i = 1; i < flux.length - 1; i++) {
    const isPeak = flux[i] >= flux[i - 1] && flux[i] > flux[i + 1];
    if (flux[i] >= threshold && isPeak) candidates.push({frame: i * hop, strength: flux[i]});
  }
  const minimum = Math.max(1, Math.min(Math.round(sampleRate * .003), Math.floor(length / SLICE_COUNT)));
  const frames = [0, length];
  // Strong onsets win; ties use source order, so repeated analysis is deterministic.
  for (const onset of candidates.sort((a, b) => b.strength - a.strength || a.frame - b.frame)) {
    if (frames.length === SLICE_COUNT + 1) break;
    if (frames.every(frame => Math.abs(frame - onset.frame) >= minimum)) frames.push(onset.frame);
  }
  frames.sort((a, b) => a - b);
  // Fill missing divisions by bisecting the largest remaining region, preserving onsets.
  while (frames.length < SLICE_COUNT + 1) {
    let largest = 0;
    for (let i = 1; i < frames.length - 1; i++) {
      if (frames[i + 1] - frames[i] > frames[largest + 1] - frames[largest]) largest = i;
    }
    frames.splice(largest + 1, 0, Math.floor((frames[largest] + frames[largest + 1]) / 2));
  }
  return validateBoundaries(frames.map(frame => frame / length));
}

export function moveBoundary(state: SliceState, index: number, seconds: number, length: number, sampleRate: number): SliceState {
  if (state.mode !== 'manual' || !Number.isInteger(index) || index <= 0 || index >= SLICE_COUNT || !Number.isFinite(seconds)) return state;
  const slices = boundariesToSlices(state.boundaries, length, sampleRate);
  const previous = Math.round(slices[index - 1].offset * sampleRate);
  const next = Math.round((slices[index].offset + slices[index].duration) * sampleRate);
  // Prefer 3 ms, but very short recordings still retain exactly 256 nonempty slices.
  const minimum = Math.max(1, Math.min(Math.round(sampleRate * .003), Math.floor((next - previous) / 2)));
  const frame = Math.max(previous + minimum, Math.min(next - minimum, Math.round(seconds * sampleRate)));
  if (Math.abs(state.boundaries[index] - frame / length) < 1e-12) return state;
  const boundaries = [...state.boundaries];
  boundaries[index] = frame / length;
  return {...state, boundaries, manuallyEdited: true};
}

/** Move a whole slice to start at `seconds`, keeping its length; its neighbours shrink or grow to match. */
export function moveSlice(state: SliceState, slice: number, seconds: number, length: number, sampleRate: number): SliceState {
  if (state.mode !== 'manual' || !Number.isInteger(slice) || slice <= 0 || slice >= SLICE_COUNT - 1 || !Number.isFinite(seconds)) return state;
  const slices = boundariesToSlices(state.boundaries, length, sampleRate);
  const previous = Math.round(slices[slice - 1].offset * sampleRate);
  const start = Math.round(slices[slice].offset * sampleRate);
  const size = Math.round((slices[slice].offset + slices[slice].duration) * sampleRate) - start;
  const next = Math.round((slices[slice + 1].offset + slices[slice + 1].duration) * sampleRate);
  if (next - previous - size < 2) return state;
  // Neighbours keep 3 ms where possible, as with a single boundary edit.
  const minimum = Math.max(1, Math.min(Math.round(sampleRate * .003), Math.floor((next - previous - size) / 2)));
  const frame = Math.max(previous + minimum, Math.min(next - minimum - size, Math.round(seconds * sampleRate)));
  if (frame === start) return state;
  const boundaries = [...state.boundaries];
  boundaries[slice] = frame / length;
  boundaries[slice + 1] = (frame + size) / length;
  return {...state, boundaries, manuallyEdited: true};
}

/** Binary search for the slice containing a time given as a fraction of the recording. */
export function sliceAtTime(boundaries: readonly number[], normalizedTime: number): number {
  let low = 0, high = SLICE_COUNT;
  while (low + 1 < high) {
    const mid = (low + high) >>> 1;
    if (boundaries[mid] <= normalizedTime) low = mid;
    else high = mid;
  }
  return low;
}

/** Legacy sessions intentionally regenerate their map when their source is loaded. */
export function restoreSliceState(version: number, value: unknown): SliceState | null {
  if (version === 1) return null;
  if (version !== 2) throw new Error('Unsupported session version');
  if (value === null) return null;
  if (!value || typeof value !== 'object') throw new Error('Missing slice state');
  const {mode, automaticMode, manuallyEdited, boundaries, bpm, confidence} = value as Record<string, unknown>;

  const automaticModes: unknown[] = ['beat', 'transient', 'equal'];
  if (!automaticModes.includes(automaticMode) || (mode !== 'manual' && !automaticModes.includes(mode)) || typeof manuallyEdited !== 'boolean') {
    throw new Error('Invalid slice mode');
  }
  // Only manual mode can carry edits; automatic modes must match the map they were generated from.
  if (mode !== 'manual' && (manuallyEdited || mode !== automaticMode)) throw new Error('Inconsistent slice mode');
  if (!isOptionalNumberInRange(bpm, 30, 300) || !isOptionalNumberInRange(confidence, 0, 1)) throw new Error('Invalid analysis metadata');

  return {
    mode: mode as SliceMode,
    automaticMode: automaticMode as AutomaticSliceMode,
    manuallyEdited,
    boundaries: validateBoundaries(boundaries),
    bpm,
    confidence,
  };
}

function isOptionalNumberInRange(value: unknown, min: number, max: number): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max);
}
