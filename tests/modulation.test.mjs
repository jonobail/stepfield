import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MODULATION, modulateSound, restoreModulation } from '../src/modulation.ts';
import { DEFAULT_SOUND } from '../src/sampler.ts';

test('modulation defaults off and legacy sessions preserve their sound', () => {
  assert.deepEqual(restoreModulation(undefined),DEFAULT_MODULATION);
  assert.equal(modulateSound(DEFAULT_SOUND,DEFAULT_MODULATION,3),DEFAULT_SOUND);
  assert.equal(modulateSound(DEFAULT_SOUND,{...DEFAULT_MODULATION,enabled:true,depth:0},3),DEFAULT_SOUND);
});
test('cycle phase continues across grid loops and wraps at the chosen musical length', () => {
  const mod = {...DEFAULT_MODULATION,enabled:true,target:'pitch',depth:100,steps:32};
  assert.equal(modulateSound(DEFAULT_SOUND,mod,8).pitch,12);
  assert.equal(modulateSound(DEFAULT_SOUND,mod,24).pitch,-12);
  assert.equal(modulateSound(DEFAULT_SOUND,mod,40).pitch,12);
});
test('wave shapes modulate bounded pitch, pan, and volume without altering defaults', () => {
  const mod = {...DEFAULT_MODULATION,enabled:true,depth:100,steps:4,waveform:'square'};
  assert.equal(modulateSound(DEFAULT_SOUND,{...mod,target:'pitch'},0).pitch,12);
  assert.equal(modulateSound(DEFAULT_SOUND,{...mod,target:'pitch'},2).pitch,-12);
  assert.equal(modulateSound({...DEFAULT_SOUND,pitch:20},{...mod,target:'pitch'},0).pitch,24);
  assert.equal(modulateSound({...DEFAULT_SOUND,pan:50},{...mod,target:'pan'},0).pan,100);
  assert.equal(modulateSound(DEFAULT_SOUND,{...mod,target:'volume'},0).level,100);
  assert.equal(modulateSound(DEFAULT_SOUND,{...mod,target:'volume'},2).level,0);
  assert.equal(modulateSound(DEFAULT_SOUND,{...mod,waveform:'triangle',target:'pan'},0).pan,-100);
  assert.equal(modulateSound(DEFAULT_SOUND,{...mod,waveform:'triangle',target:'pan'},2).pan,100);
  assert.equal(DEFAULT_SOUND.pitch,0);
});
test('saved modulation round-trips and rejects malformed values', () => {
  assert.deepEqual(restoreModulation(JSON.parse(JSON.stringify(DEFAULT_MODULATION))),DEFAULT_MODULATION);
  for (const change of [{enabled:1},{steps:0},{steps:5},{depth:Infinity},{depth:101},{depth:-1},{target:'invalid'},{waveform:'noise'}]) assert.throws(() => restoreModulation({...DEFAULT_MODULATION,...change}));
});
