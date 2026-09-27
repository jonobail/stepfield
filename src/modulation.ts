import type { SoundSettings } from './sampler';

export interface Modulation {
  enabled:boolean;
  target:'pitch'|'volume'|'pan';
  waveform:'sine'|'triangle'|'square';
  steps:number;
  depth:number;
}
export const DEFAULT_MODULATION:Modulation = {enabled:false,target:'pan',waveform:'sine',steps:16,depth:35};
export const MODULATION_RATES = [
  {steps:4,label:'¼ note'}, {steps:8,label:'½ note'}, {steps:16,label:'1 bar'},
  {steps:32,label:'2 bars'}, {steps:64,label:'4 bars'},
];

/** Sample the modulation once per sequencer step: no animation or extra audio nodes. */
export function modulateSound(sound:SoundSettings, mod:Modulation, step:number):SoundSettings {
  if (!mod.enabled || !mod.depth) return sound;
  const phase = ((step % mod.steps) + mod.steps) % mod.steps / mod.steps;
  const wave = mod.waveform === 'square' ? (phase < .5 ? 1 : -1) :
    mod.waveform === 'triangle' ? 1 - 4 * Math.abs(phase - .5) : Math.sin(2 * Math.PI * phase);
  const amount = mod.depth / 100;
  if (mod.target === 'volume') return {...sound,level:sound.level * (1 - amount * (1 - wave) / 2)};
  if (mod.target === 'pan') return {...sound,pan:Math.max(-100,Math.min(100,sound.pan + wave * amount * 100))};
  return {...sound,pitch:Math.max(-24,Math.min(24,sound.pitch + wave * amount * 12))};
}

export function restoreModulation(value:unknown):Modulation {
  if (value === undefined) return {...DEFAULT_MODULATION};
  const mod = value as Modulation;
  if (!mod || typeof mod.enabled !== 'boolean' || !['pitch','volume','pan'].includes(mod.target) ||
    !['sine','triangle','square'].includes(mod.waveform) || !MODULATION_RATES.some(rate => rate.steps === mod.steps) ||
    !Number.isFinite(mod.depth) || mod.depth < 0 || mod.depth > 100) throw new Error('Invalid modulation');
  return {enabled:mod.enabled,target:mod.target,waveform:mod.waveform,steps:mod.steps,depth:mod.depth};
}
