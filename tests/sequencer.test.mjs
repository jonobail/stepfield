import test from 'node:test';
import assert from 'node:assert/strict';
import { sliceBounds, columnPads } from '../src/sequencer.ts';

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
