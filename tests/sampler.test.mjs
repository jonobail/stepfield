import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SOUND, effectiveSound, voiceShape, restoreSounds } from '../src/sampler.ts';

test('length trims inside the slice, from a blip to full length', () => {
  assert.equal(voiceShape(.25,DEFAULT_SOUND).sourceDuration,.25);
  assert.equal(voiceShape(.25,{...DEFAULT_SOUND,length:4}).sourceDuration,.01);
  assert.equal(voiceShape(.25,{...DEFAULT_SOUND,length:50}).sourceDuration,.125);
  assert.equal(voiceShape(.0001,{...DEFAULT_SOUND,length:.1}).sourceDuration,.0001);
});
test('per-control overrides keep inheriting other global changes', () => {
  const pad = {length:10,pan:-50};
  const sound = effectiveSound({...DEFAULT_SOUND,length:25,pitch:12},pad);
  assert.equal(sound.length,10); assert.equal(sound.pitch,12); assert.equal(sound.pan,-50);
  const {length,...reset} = pad;
  assert.equal(effectiveSound({...DEFAULT_SOUND,length:25},reset).length,25);
});
test('pitch, gain, pan and envelope use playback time without leaking beyond slice bounds', () => {
  const shape = voiceShape(.25,{...DEFAULT_SOUND,length:50,pitch:12,level:50,pan:-100,attack:500,release:1000});
  assert.equal(shape.sourceDuration,.125); assert.equal(shape.duration,.0625); assert.equal(shape.rate,2);
  assert.equal(shape.pan,-1); assert.equal(shape.gain,.125);
  assert.ok(Math.abs(shape.attack + shape.release - shape.duration) < 1e-10);
  assert.equal(voiceShape(.25,{...DEFAULT_SOUND,pitch:-12}).duration,.5);
});
test('legacy sessions get full slices; settings round-trip and reject unsafe values atomically', () => {
  const legacy = restoreSounds(undefined,undefined); assert.deepEqual(legacy.global,DEFAULT_SOUND); assert.equal(legacy.pads.length,256);
  legacy.pads[3] = {length:12.5,pitch:-12};
  const saved = JSON.parse(JSON.stringify(legacy)); assert.deepEqual(restoreSounds(saved.global,saved.pads),legacy);
  for (const invalid of [{length:0},{pitch:25},{pan:Infinity},{release:'3'},{extra:1}]) {
    const pads = [...legacy.pads]; pads[0] = invalid; assert.throws(() => restoreSounds(DEFAULT_SOUND,pads));
  }
  assert.throws(() => restoreSounds({...DEFAULT_SOUND,length:1601},legacy.pads));
});

test('length above 100% plays on past the slice end, but never past the recording', () => {
  assert.equal(voiceShape(.02,{...DEFAULT_SOUND,length:800},10).sourceDuration,.16);
  assert.equal(voiceShape(.02,{...DEFAULT_SOUND,length:1600},.1).sourceDuration,.1);
  assert.equal(voiceShape(.02,{...DEFAULT_SOUND,length:800}).sourceDuration,.02);
  assert.equal(voiceShape(.02,{...DEFAULT_SOUND,length:800,pitch:12},10).duration,.08);
});
