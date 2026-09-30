import type { SoundSettings } from './sampler';

const TARGETS = ['pitch', 'volume', 'pan'] as const;
const WAVEFORMS = ['sine', 'triangle', 'square'] as const;

export interface Modulation {
  enabled: boolean;
  target: typeof TARGETS[number];
  waveform: typeof WAVEFORMS[number];
  /** Cycle length in sixteenth-note steps. */
  steps: number;
  /** 0–100 %. */
  depth: number;
}

export const DEFAULT_MODULATION: Modulation = {enabled: false, target: 'pan', waveform: 'sine', steps: 16, depth: 35};

export const MODULATION_RATES = [
  {steps: 4, label: '¼ note'},
  {steps: 8, label: '½ note'},
  {steps: 16, label: '1 bar'},
  {steps: 32, label: '2 bars'},
  {steps: 64, label: '4 bars'},
];

/** Sample the modulation once per sequencer step: no animation or extra audio nodes. */
export function modulateSound(sound: SoundSettings, mod: Modulation, step: number): SoundSettings {
  if (!mod.enabled || !mod.depth) return sound;
  const phase = ((step % mod.steps) + mod.steps) % mod.steps / mod.steps;
  const wave = oscillate(mod.waveform, phase);
  const amount = mod.depth / 100;
  switch (mod.target) {
    // Volume only dips: the loudest steps keep their level.
    case 'volume': return {...sound, level: sound.level * (1 - amount * (1 - wave) / 2)};
    case 'pan': return {...sound, pan: clamp(sound.pan + wave * amount * 100, -100, 100)};
    case 'pitch': return {...sound, pitch: clamp(sound.pitch + wave * amount * 12, -24, 24)};
  }
}

/** A value between -1 and 1 for a phase between 0 and 1. */
function oscillate(waveform: Modulation['waveform'], phase: number) {
  switch (waveform) {
    case 'square': return phase < 0.5 ? 1 : -1;
    case 'triangle': return 1 - 4 * Math.abs(phase - 0.5);
    case 'sine': return Math.sin(2 * Math.PI * phase);
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** Validate stored or edited modulation settings; missing settings restore the defaults. */
export function restoreModulation(value: unknown): Modulation {
  if (value === undefined) return {...DEFAULT_MODULATION};
  const mod = value as Modulation;
  const valid = mod &&
    typeof mod.enabled === 'boolean' &&
    TARGETS.includes(mod.target) &&
    WAVEFORMS.includes(mod.waveform) &&
    MODULATION_RATES.some(rate => rate.steps === mod.steps) &&
    Number.isFinite(mod.depth) && mod.depth >= 0 && mod.depth <= 100;
  if (!valid) throw new Error('Invalid modulation');
  return {enabled: mod.enabled, target: mod.target, waveform: mod.waveform, steps: mod.steps, depth: mod.depth};
}
