import test from 'node:test';
import assert from 'node:assert/strict';
import { sliceBounds, quantizeAudioSlices, columnPads, repeatCellAcrossRow, moveStep, assignRowSample } from '../src/sequencer.ts';

test('256 slices cover the full recording with contiguous boundaries', () => {
  for (const length of [256, 257, 44100 * 17 + 83]) {
    let end = 0;
    const lengths = [];
    for (let index = 0; index < 256; index++) {
      const slice = sliceBounds(length, 44100, index);
      const startFrame = Math.round(slice.offset * 44100);
      const frames = Math.round(slice.duration * 44100);
      assert.equal(startFrame, end);
      assert.ok(frames > 0);
      lengths.push(frames);
      end = startFrame + frames;
    }
    assert.equal(end, length);
    assert.ok(Math.max(...lengths) - Math.min(...lengths) <= 1);
  }
});

test('audio analysis detects a beat pulse and snaps slice boundaries to its sixteenth grid', () => {
  const sampleRate = 8000, duration = 64, audio = new Float32Array(sampleRate * duration);
  for (let time = .1; time < duration; time += .5) {
    const start = Math.floor(time * sampleRate);
    for (let frame = 0; frame < 120; frame++) audio[start + frame] = Math.exp(-frame / 20);
  }
  const result = quantizeAudioSlices([audio],sampleRate,100);
  assert.equal(result.bpm,120);
  assert.ok(result.confidence > .015);
  assert.equal(result.quantized,true);
  assert.equal(result.slices.length,256);
  assert.equal(result.slices[0].offset,0);
  for (const slice of result.slices) {
    assert.ok(slice.duration > 0);
    const gridPosition = (slice.offset - .1) / .125;
    assert.ok(Math.abs(gridPosition - Math.round(gridPosition)) < .001 || slice.offset === 0);
  }
});

test('short recordings retain usable even slices when there are too few beat points', () => {
  const sampleRate = 8000, audio = new Float32Array(sampleRate * 8);
  const result = quantizeAudioSlices([audio],sampleRate,120);
  assert.equal(result.quantized,false);
  assert.equal(result.slices.length,256);
  assert.ok(result.slices.every(slice => slice.duration > 0));
  assert.ok(Math.abs(result.slices[0].duration - 8 / 256) < 1 / sampleRate);
});

test('a horizontal sweep visits all pads once and layers vertical selections', () => {
  const all = Array(256).fill(true);
  const visited = [];
  for (let column = 0; column < 16; column++) {
    const pads = columnPads(all, column);
    assert.equal(pads.length, 16);
    assert.equal(pads[0], column);
    assert.equal(pads[15], 240 + column);
    visited.push(...pads);
  }
  assert.equal(new Set(visited).size, 256);
  const pattern = Array(256).fill(false);
  pattern[0] = pattern[16] = pattern[240] = pattern[1] = true;
  assert.deepEqual(columnPads(pattern, 0), [0,16,240]);
  assert.deepEqual(columnPads(pattern, 1), [1]);
  assert.deepEqual(columnPads(pattern, 2), []);
});

test('row repeat fills all 16 steps with the selected slice and preserves other rows', () => {
  const pattern = Array(256).fill(false);
  pattern[34] = pattern[48] = true;
  const result = repeatCellAcrossRow(pattern,34);
  assert.deepEqual(result.slice(32,48), Array(16).fill(true));
  assert.equal(result[48],true);
  assert.equal(result[50],false);
});

test('scrolling a row sound changes the shared slice without changing other rows', () => {
  const samples = Array.from({length:16},(_,row) => row * 16);
  const next = assignRowSample(samples,2,200);
  assert.equal(next[2],200);
  assert.equal(samples[2],32);
  assert.equal(next[1],16);
  assert.equal(next[3],48);
});

test('moving a step into an empty cell stays within its row', () => {
  const pattern = Array(256).fill(false); pattern[3] = true;
  const result = moveStep(pattern,3,4);
  assert.equal(result[3],false);
  assert.equal(result[4],true);
  assert.equal(moveStep(pattern,3,20)[20],false);
});
