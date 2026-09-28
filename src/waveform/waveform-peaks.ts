export interface WaveformPeaks { levels: Float32Array[]; blockSize: number; frames: number; sampleRate: number }
/** Absolute maxima across channels keep opposite-phase stereo transients visible. */
export function buildWaveformPeaks(channels: readonly Float32Array[], sampleRate: number): WaveformPeaks {
  const frames = channels[0]?.length ?? 0, blockSize = 128;
  const base = new Float32Array(Math.ceil(frames / blockSize));
  for (let bin = 0; bin < base.length; bin++) {
    const end = Math.min(frames, (bin + 1) * blockSize); let peak = 0;
    for (const channel of channels) for (let i = bin * blockSize; i < end; i++) peak = Math.max(peak, Math.abs(channel[i]));
    base[bin] = peak;
  }
  const levels = [base];
  while (levels[levels.length - 1].length > 1) {
    const previous = levels[levels.length - 1], next = new Float32Array(Math.ceil(previous.length / 2));
    for (let i = 0; i < next.length; i++) next[i] = Math.max(previous[i * 2], previous[i * 2 + 1] ?? 0);
    levels.push(next);
  }
  return {levels, blockSize, frames, sampleRate};
}
