import test from 'node:test';
import assert from 'node:assert/strict';
import { equalBoundaries, boundariesToSlices, slicesToBoundaries, transientBoundaries, moveBoundary, moveSlice, restoreSliceState, validateBoundaries, sliceAtTime } from '../src/slices.ts';
import { buildWaveformPeaks } from '../src/waveform/waveform-peaks.ts';

const state = (length = 64000) => ({mode:'manual',automaticMode:'equal',boundaries:equalBoundaries(length),manuallyEdited:false});
const assertPartition = (boundaries, length = 64000, rate = 1000) => {
  assert.equal(boundaries.length,257); assert.equal(boundaries[0],0); assert.equal(boundaries.at(-1),1);
  const slices = boundariesToSlices(boundaries,length,rate); assert.equal(slices.length,256);
  let end = 0;
  for (const slice of slices) { assert.ok(slice.duration > 0); assert.ok(Math.abs(slice.offset - end) < 1e-9); end = slice.offset + slice.duration; }
  assert.ok(Math.abs(end - length / rate) < 1e-9);
};

test('equal slicing partitions every source frame, including short and uneven recordings', () => {
  for (const length of [256,257,8000,44100*17+83]) {
    const boundaries = equalBoundaries(length); assertPartition(boundaries,length,44100);
    const slices = boundariesToSlices(boundaries,length,44100);
    assert.deepEqual(slicesToBoundaries(slices,length/44100).map(n=>Math.round(n*length)),boundaries.map(n=>Math.round(n*length)));
    const sizes = slices.map(s=>Math.round(s.duration*44100)); assert.ok(Math.max(...sizes)-Math.min(...sizes)<=1);
  }
  assert.throws(()=>equalBoundaries(255));
});

test('conversion rejects incomplete, overlapping and non-contiguous maps', () => {
  const slices = boundariesToSlices(equalBoundaries(64000),64000,1000);
  assert.throws(()=>slicesToBoundaries(slices.slice(1),64));
  for (const broken of [{offset:.1,duration:.25},{offset:0,duration:0},{offset:0,duration:Infinity}]) {
    assert.throws(()=>slicesToBoundaries([broken,...slices.slice(1)],64));
  }
});

test('transient slicing retains strong onsets and subdivides sparse recordings deterministically', () => {
  const rate=1000, audio=new Float32Array(rate*64);
  for(const frame of [1370,18110,51030]) for(let i=0;i<30;i++) audio[frame+i]=Math.exp(-i/10);
  const boundaries=transientBoundaries([audio],rate); assertPartition(boundaries);
  for(const onset of [1.37,18.11,51.03]) assert.ok(boundaries.some(b=>Math.abs(b*64-onset)<.011));
  assert.deepEqual(boundaries,transientBoundaries([audio],rate));
});

test('transient slicing selects strongest events when there are more than 255 candidates', () => {
  const rate=1000, audio=new Float32Array(rate*64);
  for(let frame=100;frame<audio.length-50;frame+=100) audio[frame]=frame===32100?1:.2;
  const boundaries=transientBoundaries([audio],rate); assertPartition(boundaries);
  assert.ok(boundaries.includes(32100/audio.length));
  assertPartition(transientBoundaries([new Float32Array(256)],rate),256,rate);
  assert.deepEqual(transientBoundaries([new Float32Array(64000)],rate),equalBoundaries(64000));
});

test('manual boundary movement clamps to neighbors, preserves endpoints and exactly 256 slices', () => {
  const original=state(), moved=moveBoundary(original,10,2.4,64000,1000);
  assert.equal(moved.boundaries[10],2.4/64); assert.equal(moved.manuallyEdited,true); assert.equal(original.boundaries[10],10/256);
  assert.equal(moveBoundary(moved,10,-100,64000,1000).boundaries[10],2.253/64);
  assert.equal(moveBoundary(moved,10,1000,64000,1000).boundaries[10],2.747/64);
  for(const index of [0,256,-1,2.5]) assert.equal(moveBoundary(original,index,5,64000,1000),original);
  assert.equal(moveBoundary(original,10,NaN,64000,1000),original);
  assert.equal(moveBoundary({...original,mode:'equal'},10,1,64000,1000).manuallyEdited,false);
  let edited=state(); for(let i=1;i<256;i++) edited=moveBoundary(edited,i,i%2?1000:-10,64000,1000); assertPartition(edited.boundaries);
  assertPartition(moveBoundary(state(256),20,100,256,48000).boundaries,256,48000);
});

test('slice hit testing handles boundaries and the fixed final endpoint', () => {
  const b=equalBoundaries(64000);
  assert.equal(sliceAtTime(b,0),0); assert.equal(sliceAtTime(b,100.5/256),100); assert.equal(sliceAtTime(b,101/256),101); assert.equal(sliceAtTime(b,1),255);
});

test('v1 sessions regenerate slices; v2 manual sessions round-trip without aliasing', () => {
  assert.equal(restoreSliceState(1,undefined),null);
  const edited=moveBoundary(state(),37,9.4,64000,1000);
  const restored=restoreSliceState(2,JSON.parse(JSON.stringify(edited)));
  assert.deepEqual(restored.boundaries,edited.boundaries); assert.equal(restored.mode,'manual'); assert.equal(restored.automaticMode,'equal'); assert.equal(restored.manuallyEdited,true);
  restored.boundaries[37]=.1; assert.notEqual(restored.boundaries[37],edited.boundaries[37]);
  assert.equal(restoreSliceState(2,null),null); assert.throws(()=>restoreSliceState(3,null));
});

test('import validation rejects malformed boundaries and inconsistent metadata before restoration', () => {
  const sparse=new Array(257);sparse[0]=0;sparse[256]=1;
  for(const bad of [sparse,[],Array(257).fill(0),[...equalBoundaries(64000),1],equalBoundaries(64000).map((n,i)=>i===10?NaN:n),equalBoundaries(64000).map((n,i)=>i===10?'0.1':n)]) assert.throws(()=>validateBoundaries(bad));
  for(const patch of [{mode:'bad'},{automaticMode:['equal']},{automaticMode:'manual'},{mode:'equal',manuallyEdited:true},{bpm:Infinity},{confidence:2},{manuallyEdited:'true'},{boundaries:undefined}]) assert.throws(()=>restoreSliceState(2,{...state(),...patch}));
});

test('waveform peaks retain impulses across stereo channels without phase cancellation', () => {
  const left=new Float32Array(1024),right=new Float32Array(1024); left[140]=.9;right[140]=-.9;right[700]=-.7;
  const peaks=buildWaveformPeaks([left,right],48000);
  assert.ok(peaks.levels[0][1]>.89);assert.ok(peaks.levels[0][5]>.69); assert.ok(peaks.levels.at(-1)[0]>.89);
  assert.equal(peaks.levels[0].length,8); assert.equal(left[140],Math.fround(.9)); assert.equal(right[140],Math.fround(-.9));
  assert.ok(buildWaveformPeaks([new Float32Array(10000)],1000).levels[0].every(v=>v===0));
});

test('moving a whole slice keeps its length, clamps against neighbours, and leaves fixed endpoints alone', () => {
  const original=state(), moved=moveSlice(original,10,2.6,64000,1000);
  assert.equal(moved.boundaries[10],2.6/64); assert.equal(moved.boundaries[11],2.85/64); assert.equal(moved.manuallyEdited,true); assertPartition(moved.boundaries);
  assert.deepEqual([moveSlice(original,10,-100,64000,1000).boundaries[10],moveSlice(original,10,-100,64000,1000).boundaries[11]],[2.253/64,2.503/64]);
  assert.deepEqual([moveSlice(original,10,1000,64000,1000).boundaries[10],moveSlice(original,10,1000,64000,1000).boundaries[11]],[2.747/64,2.997/64]);
  for(const slice of [0,255,-1,2.5]) assert.equal(moveSlice(original,slice,5,64000,1000),original);
  assert.equal(moveSlice(original,10,NaN,64000,1000),original);
  assert.equal(moveSlice({...original,mode:'equal'},10,2.6,64000,1000).manuallyEdited,false);
  assertPartition(moveSlice(state(256),20,100,256,48000).boundaries,256,48000);
});
