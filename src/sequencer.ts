export const ROW_COUNT = 16;
export const VIEW_STEPS = 16;

/** Partition the whole recording without dropping or duplicating audio frames. */
export function sliceBounds(length: number, sampleRate: number, index: number) {
  const start = Math.floor(index * length / 256);
  const end = Math.floor((index + 1) * length / 256);
  return {offset: start / sampleRate, duration: (end - start) / sampleRate};
}

export interface AudioSlice { offset: number; duration: number }
export interface QuantizedSliceMap { bpm: number; confidence: number; quantized: boolean; slices: AudioSlice[] }

/** Detect a beat pulse and snap 256 full-recording slice boundaries to its sixteenth-note grid. */
export function quantizeAudioSlices(channels: readonly Float32Array[], sampleRate: number, fallbackBpm: number): QuantizedSliceMap {
  const length = Math.min(...channels.map(channel => channel.length));
  if (!channels.length || !length || !sampleRate) return {bpm:fallbackBpm,confidence:0,quantized:false,slices:[]};
  const hop = Math.max(1,Math.round(sampleRate / 100));
  const frameCount = Math.ceil(length / hop);
  const energy = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * hop, end = Math.min(length,start + hop);
    let sum = 0, count = 0;
    for (const channel of channels) for (let i = start; i < end; i += 4) { const sample = channel[i]; sum += sample * sample; count++; }
    energy[frame] = count ? Math.sqrt(sum / count) : 0;
  }
  const flux = new Float32Array(frameCount);
  let fluxSum = 0, fluxPeak = 0;
  for (let i = 1; i < frameCount; i++) { flux[i] = Math.max(0,energy[i] - energy[i - 1]); fluxSum += flux[i]; fluxPeak = Math.max(fluxPeak,flux[i]); }
  const averageFlux = fluxSum / Math.max(1,frameCount - 1);
  const threshold = Math.max(averageFlux * 1.8,fluxPeak * 0.08);
  const onsets: number[] = [];
  let lastOnset = -8;
  for (let i = 2; i < frameCount - 2; i++) {
    if (i - lastOnset < 7 || flux[i] < threshold || flux[i] < energy[i] * 0.025) continue;
    if (flux[i] >= flux[i - 1] && flux[i] > flux[i + 1]) { onsets.push(i / 100); lastOnset = i; }
  }

  let bpm = fallbackBpm, confidence = 0;
  if (onsets.length >= 4) {
    const scores: {lag:number;score:number}[] = [];
    for (let lag = 34; lag <= 100; lag++) {
      let correlation = 0, left = 0, right = 0;
      for (let i = lag; i < flux.length; i++) { const a = flux[i], b = flux[i - lag]; correlation += a * b; left += a * a; right += b * b; }
      const score = left && right ? correlation / Math.sqrt(left * right) : 0;
      scores.push({lag,score});
    }
    const peak = Math.max(...scores.map(candidate => candidate.score));
    const best = scores.filter(candidate => candidate.score >= peak * .99).reduce((a,b) => b.lag < a.lag ? b : a);
    const sortedScores = scores.map(candidate => candidate.score).sort((a,b) => a - b);
    const background = sortedScores[Math.floor(sortedScores.length / 2)];
    confidence = best.score > 0 ? Math.max(0,(best.score - background) / best.score) : 0;
    if (best.score > 0.08 && confidence > 0.015) bpm = Math.max(60,Math.min(180,Math.round(6000 / best.lag)));
  }

  const onsetOrigin = onsets[0] ?? 0;
  const quantum = 15 / bpm;
  const boundaries = new Int32Array(257);
  boundaries[0] = 0; boundaries[256] = length;
  const firstGrid = Math.ceil((0 - onsetOrigin) / quantum);
  const lastGrid = Math.floor((length / sampleRate - onsetOrigin) / quantum);
  const hasEnoughGridPoints = lastGrid - firstGrid >= 256;
  for (let index = 1; index < 256; index++) {
    const target = index * length / 256;
    const minimum = boundaries[index - 1] + 1;
    const maximum = length - (256 - index);
    const targetFrame = Math.round(target);
    if (hasEnoughGridPoints) {
      const minimumGrid = Math.ceil((minimum / sampleRate - onsetOrigin) / quantum);
      const maximumGrid = Math.floor((maximum / sampleRate - onsetOrigin) / quantum);
      if (minimumGrid <= maximumGrid) {
        const nearestGrid = Math.round((target / sampleRate - onsetOrigin) / quantum);
        const grid = Math.max(minimumGrid,Math.min(maximumGrid,nearestGrid));
        boundaries[index] = Math.round((onsetOrigin + grid * quantum) * sampleRate);
        continue;
      }
    }
    boundaries[index] = Math.max(minimum,Math.min(maximum,targetFrame));
  }
  const slices = Array.from({length:256},(_,index) => ({offset:boundaries[index] / sampleRate,duration:(boundaries[index + 1] - boundaries[index]) / sampleRate}));
  return {bpm,confidence,quantized:hasEnoughGridPoints,slices};
}
export function columnPads(pattern: readonly boolean[], column: number, timelineSteps = VIEW_STEPS): number[] {
  return Array.from({length: ROW_COUNT}, (_, row) => row * timelineSteps + column).filter(index => pattern[index]);
}

/** Fill a selected cell's row with repeats of its assigned slice. */
export function repeatCellAcrossRow(pattern: readonly boolean[], source: number) {
  const rowStart = Math.floor(source / VIEW_STEPS) * VIEW_STEPS;
  const nextPattern = [...pattern];
  for (let column = 0; column < VIEW_STEPS; column++) {
    const index = rowStart + column;
    nextPattern[index] = true;
  }
  return nextPattern;
}

/** Change the shared source slice for one sound row. */
export function assignRowSample(samples: readonly number[], row: number, sample: number) {
  const next = [...samples];
  next[row] = sample;
  return next;
}

/** Move an active step to an empty step within its row. */
export function moveStep(pattern: readonly boolean[], source: number, target: number) {
  const nextPattern = [...pattern];
  if (Math.floor(source / VIEW_STEPS) !== Math.floor(target / VIEW_STEPS) || nextPattern[target]) return nextPattern;
  nextPattern[source] = false;
  nextPattern[target] = true;
  return nextPattern;
}
