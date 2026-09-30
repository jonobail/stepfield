import type { voiceShape } from '../sampler';

export type VoiceShape = ReturnType<typeof voiceShape>;

/** One sounding slice: buffer source → envelope → panner → output. */
export interface Voice {
  source: AudioBufferSourceNode;
  disconnect(): void;
}

/**
 * Master gain feeding a gentle limiter, so stacked voices do not clip.
 * Shared by live playback and offline loop rendering so both sound the same.
 */
export function createOutputChain(context: BaseAudioContext, volume: number): GainNode {
  const master = context.createGain();
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  master.gain.value = volume / 100;
  master.connect(limiter);
  limiter.connect(context.destination);
  return master;
}

/** Build a voice for one slice. The caller starts it with `voice.source.start(when, offset, shape.sourceDuration)`. */
export function createVoice(context: BaseAudioContext, output: AudioNode, buffer: AudioBuffer, shape: VoiceShape, when: number): Voice {
  const source = context.createBufferSource();
  const envelope = context.createGain();
  const panner = context.createStereoPanner();

  source.buffer = buffer;
  source.playbackRate.value = shape.rate;
  panner.pan.value = shape.pan;
  source.connect(envelope);
  envelope.connect(panner);
  panner.connect(output);

  // Attack ramp, hold, then release ramp ending exactly when the voice does.
  const gain = envelope.gain;
  const releaseStart = Math.max(when + shape.attack, when + shape.duration - shape.release);
  gain.setValueAtTime(0, when);
  gain.linearRampToValueAtTime(shape.gain, when + shape.attack);
  gain.setValueAtTime(shape.gain, releaseStart);
  gain.linearRampToValueAtTime(0, when + shape.duration);

  return {
    source,
    disconnect: () => {
      source.disconnect();
      envelope.disconnect();
      panner.disconnect();
    },
  };
}

/** A short 440 Hz beep through the master output, for checking speakers. */
export function playTestTone(context: AudioContext, output: AudioNode) {
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  const now = context.currentTime;

  oscillator.type = 'sine';
  oscillator.frequency.value = 440;
  envelope.gain.setValueAtTime(0, now);
  envelope.gain.linearRampToValueAtTime(0.65, now + 0.02);
  envelope.gain.setValueAtTime(0.65, now + 0.28);
  envelope.gain.linearRampToValueAtTime(0, now + 0.4);

  oscillator.connect(envelope);
  envelope.connect(output);
  oscillator.onended = () => {
    oscillator.disconnect();
    envelope.disconnect();
  };
  oscillator.start(now);
  oscillator.stop(now + 0.4);
}

/**
 * Request media playback on iOS rather than the default ambient/ringer session.
 * This is optional; browsers without the Audio Session API retain normal Web Audio.
 */
export function requestPlaybackAudioSession() {
  try {
    const session = (navigator as Navigator & {audioSession?: {type: string}}).audioSession;
    if (session && session.type !== 'playback') session.type = 'playback';
  } catch {}
}

/** Cached audio is stored at 32 kHz; decoding at that rate avoids expanding it to the device rate in memory. */
export function decodeStoredAudio(bytes: ArrayBuffer): Promise<AudioBuffer> {
  return new OfflineAudioContext(2, 1, 32000).decodeAudioData(bytes);
}
