import { modulateSound, type Modulation } from '../modulation';
import { effectiveSound, voiceShape, type PadSound, type SoundSettings } from '../sampler';
import { ROW_COUNT, VIEW_STEPS, padIndex, type AudioSlice } from '../sequencer';
import { createOutputChain, createVoice } from './audio-graph';

export interface LoopRenderInput {
  buffer: AudioBuffer;
  pattern: readonly boolean[];
  /** Resolved source slice for each row. */
  rowSlices: readonly AudioSlice[];
  bpm: number;
  volume: number;
  globalSound: SoundSettings;
  rowSounds: readonly PadSound[];
  modulation: Modulation;
}

const LOOP_SAMPLE_RATE = 32000;

/** Render the pattern offline as a seamless stereo 16-bit WAV loop. */
export async function renderLoopWav(input: LoopRenderInput): Promise<ArrayBuffer> {
  const {buffer, pattern, rowSlices, bpm, volume, globalSound, rowSounds, modulation} = input;

  // Modulated patterns only repeat once the modulation cycle completes.
  const cycleSteps = modulation.enabled ? Math.max(VIEW_STEPS, modulation.steps) : VIEW_STEPS;
  const stepDuration = 60 / bpm / 4;
  const cycleDuration = cycleSteps * stepDuration;

  const activeRows = (step: number) =>
    Array.from({length: ROW_COUNT}, (_, row) => row).filter(row => pattern[padIndex(row, step % VIEW_STEPS)]);
  const shapeAt = (row: number, step: number) =>
    voiceShape(rowSlices[row].duration, modulateSound(effectiveSound(globalSound, rowSounds[row]), modulation, step), buffer.duration - rowSlices[row].offset);

  let longestVoice = 0;
  for (let step = 0; step < cycleSteps; step++) {
    for (const row of activeRows(step)) longestVoice = Math.max(longestVoice, shapeAt(row, step).duration);
  }

  // Render preroll cycles first so tails ringing across the loop point are present at its start.
  const framesPerCycle = Math.ceil(cycleDuration * LOOP_SAMPLE_RATE);
  const prerollCycles = Math.max(1, Math.ceil(longestVoice / cycleDuration));
  const context = new OfflineAudioContext(2, framesPerCycle * (prerollCycles + 1), LOOP_SAMPLE_RATE);
  const output = createOutputChain(context, volume);

  for (let step = 0; step < cycleSteps * (prerollCycles + 1); step++) {
    const when = step * stepDuration;
    for (const row of activeRows(step)) {
      const shape = shapeAt(row, step);
      createVoice(context, output, buffer, shape, when).source.start(when, rowSlices[row].offset, shape.sourceDuration);
    }
  }

  const rendered = await context.startRendering();
  return encodeStereoWav(rendered, framesPerCycle * prerollCycles, framesPerCycle);
}

/** Encode `frameCount` frames of a stereo buffer, starting at `startFrame`, as 16-bit PCM WAV. */
export function encodeStereoWav(audio: AudioBuffer, startFrame: number, frameCount: number): ArrayBuffer {
  const channels = 2, bytesPerSample = 2, headerBytes = 44;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = frameCount * blockAlign;
  const wav = new ArrayBuffer(headerBytes + dataBytes);
  const view = new DataView(wav);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, wav.byteLength - 8, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);                             // fmt chunk size
  view.setUint16(20, 1, true);                              // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * blockAlign, true);  // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  const channelData = [audio.getChannelData(0), audio.getChannelData(1)];
  for (let frame = 0; frame < frameCount; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = Math.max(-1, Math.min(1, channelData[channel][startFrame + frame]));
      const offset = headerBytes + (frame * channels + channel) * bytesPerSample;
      view.setInt16(offset, Math.round(sample < 0 ? sample * 32768 : sample * 32767), true);
    }
  }
  return wav;
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
