import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { wave } from './audio-fixture.mjs';

const session = page => page.evaluate(()=>JSON.parse(localStorage.getItem('stepfield-session-v1')));
async function load(page, cached=false) {
  await page.addInitScript(()=>{
    window.notes=[]; const start=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(when,offset,duration){window.notes.push({when,offset,duration,rate:this.playbackRate.value,offline:this.context instanceof OfflineAudioContext});return start.call(this,when,offset,duration);};
  });
  if(cached) {
    await page.route('**/api/youtube',route=>route.fulfill({json:{id:'abcdefghijk',status:'ready',title:'Waveform fixture',bytes:1024000}}));
    await page.route('**/api/audio/abcdefghijk',route=>route.fulfill({contentType:'audio/wav',body:wave()}));
  }
  await page.goto('/');
  if(cached) {await page.getByRole('textbox',{name:'YouTube link'}).fill('https://youtu.be/abcdefghijk');await page.getByRole('button',{name:'Import YouTube audio',exact:true}).click();}
  else await page.getByLabel('Import local audio or video',{exact:true}).setInputFiles({name:'tone.wav',mimeType:'audio/wav',buffer:wave()});
  await expect(page.getByRole('status')).toContainText('slices');
  await expect(page.getByRole('region',{name:'Source editor',exact:true})).toBeVisible();
  await expect(canvas(page)).toBeVisible();
  await page.getByRole('combobox',{name:'Grid action',exact:true}).selectOption('edit');
  await expect(page.getByRole('region',{name:'Source editor',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Equal',exact:true}).click();
}
const canvas = page => page.getByRole('img',{name:'Source waveform with 256 slices'});
async function choose(page,number) {await page.getByRole('combobox',{name:'Source slice',exact:true}).selectOption(String(number-1));}
async function downloadPattern(page) {const event=page.waitForEvent('download');await page.getByRole('button',{name:'Export pattern ↗'}).click();return JSON.parse(await readFile(await (await event).path(),'utf8'));}

test('waveform follows rows, assigns slices, drags boundaries, and restores exported and cached sessions',async({page})=>{
  await load(page,true);
  const pad=page.locator('.pad').nth(50); await pad.click();
  await expect(canvas(page)).toHaveAttribute('data-selected-slice','48');
  await expect(page.getByRole('combobox',{name:'Source row',exact:true})).toHaveValue('3'); await expect(page.getByRole('combobox',{name:'Source slice',exact:true})).toHaveValue('48');
  await page.locator('.pad').nth(51).click(); await expect(canvas(page)).toHaveAttribute('data-selected-slice','48');
  await canvas(page).scrollIntoViewIfNeeded();const box=await canvas(page).boundingBox();
  await page.mouse.click(box.x+box.width*100.5/256,box.y+80);
  await expect(canvas(page)).toHaveAttribute('data-selected-slice','100');
  await expect(page.locator('.pad').nth(51)).toHaveClass(/selected/);
  expect((await session(page)).rowSamples[3]).toBe(100);expect((await session(page)).rowSamples[2]).toBe(32);
  await expect(page.locator('.sound-heading')).toContainText('Slice 101');
  await page.getByRole('button',{name:'Manual',exact:true}).click();
  await page.getByRole('button',{name:'Locate selected slice'}).click();
  await canvas(page).scrollIntoViewIfNeeded();
  const zoom=await canvas(page).boundingBox();const viewStart=Number(await canvas(page).getAttribute('data-view-start')),viewEnd=Number(await canvas(page).getAttribute('data-view-end'));
  const edge=zoom.x+(25.25-viewStart)/(viewEnd-viewStart)*zoom.width;
  await page.mouse.move(edge,zoom.y+55);await page.mouse.down();await page.mouse.move(edge+.1/(viewEnd-viewStart)*zoom.width,zoom.y+55,{steps:8});await page.mouse.up();
  await expect.poll(async()=>(await session(page)).sliceState.boundaries[101]*64).toBeCloseTo(25.35,3);
  await expect(page.getByRole('spinbutton',{name:'Slice end time'})).toHaveValue('25.35');
  const saved=await downloadPattern(page);expect(saved.version).toBe(3);expect(saved.sliceState.manuallyEdited).toBe(true);
  await page.reload();await expect(page.getByRole('status')).toContainText('Cached audio ready');await page.getByRole('combobox',{name:'Grid action',exact:true}).selectOption('edit');
  await page.locator('.pad').nth(51).click(); await expect(page.getByRole('spinbutton',{name:'Slice end time'})).toHaveValue('25.35');
  await page.getByRole('button',{name:'Reset slices',exact:true}).click();await page.getByRole('button',{name:'Keep edits'}).click();
  expect((await session(page)).sliceState.boundaries).toEqual(saved.sliceState.boundaries);
  await page.getByRole('button',{name:'Reset slices',exact:true}).click();await page.getByRole('button',{name:'Replace slices',exact:true}).click();
  expect((await session(page)).sliceState.mode).toBe('equal');expect((await session(page)).sliceState.boundaries[101]).toBe(101/256);
  await page.getByLabel('Import pattern',{exact:true}).setInputFiles({name:'saved.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});
  await expect(page.getByRole('spinbutton',{name:'Slice end time'})).toHaveValue('25.35');expect((await session(page)).sliceState.boundaries).toEqual(saved.sliceState.boundaries);
});

test('numeric edits, shaped/raw audition, sequencing and WAV/MP3 share edited boundaries',async({page})=>{
  await load(page);await choose(page,37);await page.getByRole('button',{name:'Manual',exact:true}).click();
  await page.getByRole('spinbutton',{name:'Slice end time'}).fill('9.4');await page.getByRole('spinbutton',{name:'Slice end time'}).press('Tab');
  await page.getByRole('spinbutton',{name:'Length value',exact:true}).fill('50');await page.getByRole('spinbutton',{name:'Length value',exact:true}).press('Tab');
  await page.getByRole('spinbutton',{name:'Pitch value',exact:true}).fill('12');await page.getByRole('spinbutton',{name:'Pitch value',exact:true}).press('Tab');
  await page.evaluate(()=>{window.notes=[];}); await page.getByRole('button',{name:'Audition shaped slice'}).click();
  await expect.poll(()=>page.evaluate(()=>window.notes.length)).toBe(1);
  const shaped=await page.evaluate(()=>window.notes[0]);expect(shaped.offset).toBe(9);expect(shaped.duration).toBeCloseTo(.2,4);expect(shaped.rate).toBe(2);
  await page.getByRole('button',{name:'Audition raw slice'}).click();await expect.poll(()=>page.evaluate(()=>window.notes.length)).toBe(2);
  const raw=await page.evaluate(()=>window.notes[1]);expect(raw.duration).toBeCloseTo(.4,4);expect(raw.rate).toBe(1);
  await page.getByRole('combobox',{name:'Grid action',exact:true}).selectOption('pattern');await page.locator('.pad').first().click();
  await page.evaluate(()=>{window.notes=[];});await page.getByRole('button',{name:'▶ Play',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.notes.length)).toBeGreaterThan(0);const live=await page.evaluate(()=>window.notes[0]);expect(live.offset).toBe(9);expect(live.duration).toBeCloseTo(.2,4);
  await page.getByRole('button',{name:'■ Stop',exact:true}).click();
  for(const format of ['WAV','MP3']) {
    await page.evaluate(()=>{window.notes=[];});const event=page.waitForEvent('download');await page.getByRole('button',{name:`Download loop · ${format}`,exact:true}).click();
    const file=await event;expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${format.toLowerCase()}$`));expect((await readFile(await file.path())).length).toBeGreaterThan(1000);
    const notes=await page.evaluate(()=>window.notes.filter(note=>note.offline));expect(notes.length).toBeGreaterThan(0);expect(notes.every(note=>Math.abs(note.offset-9)<.0001&&Math.abs(note.duration-.2)<.0001)).toBe(true);
  }
});

test('zoom, pan, modes and row navigation leave source and pattern data intact',async({page})=>{
  await load(page);await choose(page,129);const original=await session(page);
  await page.getByRole('button',{name:'Zoom in waveform'}).click();await expect.poll(async()=>Number(await canvas(page).getAttribute('data-view-end'))-Number(await canvas(page).getAttribute('data-view-start'))).toBeCloseTo(32);
  await page.getByRole('slider',{name:'Waveform horizontal position'}).press('End');
  await expect(canvas(page)).toBeVisible();
  await expect.poll(async()=>Number(await canvas(page).getAttribute('data-view-end'))-Number(await canvas(page).getAttribute('data-view-start'))).toBeCloseTo(32);
  await page.locator('.pad').nth(16).click();await expect.poll(async()=>Number(await canvas(page).getAttribute('data-view-start'))).toBeLessThanOrEqual(4);
  await page.getByRole('button',{name:'Fit entire waveform'}).click();await expect(canvas(page)).toHaveAttribute('data-view-start','0');await expect(canvas(page)).toHaveAttribute('data-view-end','64');
  expect((await session(page)).sliceState).toEqual(original.sliceState);expect((await session(page)).pattern).toEqual(original.pattern);
  for(const mode of ['Transient','Beat','Manual']) {await page.getByRole('button',{name:mode,exact:true}).click();expect((await session(page)).sliceState.boundaries).toHaveLength(257);}
  await page.setViewportSize({width:390,height:844});await expect(canvas(page)).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});

test('malformed slice imports are atomic; local source reload retains manual boundaries',async({page})=>{
  await load(page);await choose(page,20);await page.getByRole('button',{name:'Manual',exact:true}).click();
  await page.getByRole('spinbutton',{name:'Slice start time'}).fill('4.8');await page.getByRole('spinbutton',{name:'Slice start time'}).press('Tab');
  const before=await session(page),invalid=structuredClone(before);invalid.bpm=200;invalid.rowSamples[0]=200;invalid.sliceState.boundaries[20]=0;
  await page.getByLabel('Import pattern',{exact:true}).setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalid))});
  await expect(page.getByRole('status')).toContainText('Invalid pattern');expect(await session(page)).toEqual(before);
  await page.reload();await page.getByLabel('Import local audio or video',{exact:true}).setInputFiles({name:'tone.wav',mimeType:'audio/wav',buffer:wave()});await expect(page.getByRole('status')).toContainText('slices');
  expect((await session(page)).sliceState.boundaries).toEqual(before.sliceState.boundaries);
  await page.getByLabel('Import local audio or video',{exact:true}).setInputFiles({name:'another.wav',mimeType:'audio/wav',buffer:wave()});await expect(page.getByRole('status')).toContainText('slices');expect((await session(page)).sliceState.mode).toBe('beat');
});

test('version 1 sessions still restore and regenerate source slices',async({page})=>{
  await load(page);const legacy={version:1,pattern:Array(256).fill(false),bpm:98,volume:45,rowSamples:Array.from({length:16},(_,r)=>r*16),source:'tone.wav'};
  await page.getByLabel('Import pattern',{exact:true}).setInputFiles({name:'legacy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});
  await expect(page.getByRole('status')).toContainText('Pattern imported');const restored=await session(page);expect(restored.bpm).toBe(98);expect(restored.sliceState.mode).toBe('beat');expect(restored.sliceState.boundaries).toHaveLength(257);
});


test('manual edges clamp, fixed endpoints stay locked, and both edges are draggable',async({page})=>{
  await load(page);await choose(page,37);await page.getByRole('button',{name:'Manual',exact:true}).click();await page.getByRole('button',{name:'Locate selected slice'}).click();
  await canvas(page).scrollIntoViewIfNeeded();const box=await canvas(page).boundingBox();
  const start=Number(await canvas(page).getAttribute('data-view-start')),end=Number(await canvas(page).getAttribute('data-view-end'));
  const edge=box.x+(9-start)/(end-start)*box.width;
  await page.mouse.move(edge,box.y+50);await page.mouse.down();await page.mouse.move(edge+.08/(end-start)*box.width,box.y+50,{steps:6});await page.mouse.up();
  await expect.poll(async()=>(await session(page)).sliceState.boundaries[36]*64).toBeCloseTo(9.08,3);
  await page.getByRole('spinbutton',{name:'Slice start time'}).fill('999');await page.getByRole('spinbutton',{name:'Slice start time'}).press('Tab');
  await expect.poll(async()=>((await session(page)).sliceState.boundaries[37]-(await session(page)).sliceState.boundaries[36])*64).toBeCloseTo(.003,4);
  const state=await session(page);expect(state.sliceState.boundaries).toHaveLength(257);expect(state.sliceState.boundaries.every((n,i,a)=>i===0||n>a[i-1])).toBe(true);
  await choose(page,1);await expect(page.getByRole('spinbutton',{name:'Slice start time'})).toBeDisabled();
  await choose(page,256);await expect(page.getByRole('spinbutton',{name:'Slice end time'})).toBeDisabled();
});


test('dragging the selected slice window moves the whole slice and switches to manual',async({page})=>{
  await load(page);await choose(page,37);await page.getByRole('button',{name:'Locate selected slice'}).click();
  await canvas(page).scrollIntoViewIfNeeded();const box=await canvas(page).boundingBox();
  const start=Number(await canvas(page).getAttribute('data-view-start')),end=Number(await canvas(page).getAttribute('data-view-end'));
  const middle=box.x+(9.125-start)/(end-start)*box.width;
  await page.mouse.move(middle,box.y+80);await page.mouse.down();await page.mouse.move(middle+.1/(end-start)*box.width,box.y+80,{steps:6});await page.mouse.up();
  await expect.poll(async()=>(await session(page)).sliceState.boundaries[36]*64).toBeCloseTo(9.1,3);
  const state=(await session(page)).sliceState;expect(state.mode).toBe('manual');expect(state.manuallyEdited).toBe(true);
  expect((state.boundaries[37]-state.boundaries[36])*64).toBeCloseTo(.25,3);
  expect(Number(await canvas(page).getAttribute('data-view-start'))).toBe(start);
});

test('visible row and slice dropdowns change audio during playback without editing the pattern',async({page})=>{
  await load(page);
  
  await page.getByRole('combobox',{name:'Grid action',exact:true}).selectOption('pattern');
  await page.locator('.pad').nth(0).click();await page.locator('.pad').nth(32).click();
  const before=(await session(page)).pattern;
  await page.getByRole('button',{name:'▶ Play',exact:true}).click();
  await page.getByRole('combobox',{name:'Source row',exact:true}).selectOption('2');
  await expect(page.locator('.pad').nth(32)).toHaveClass(/selected/);
  await choose(page,55);
  await expect(page.getByRole('button',{name:'Playing',exact:true})).toBeVisible();
  await expect(canvas(page)).toBeVisible();
  expect((await session(page)).pattern).toEqual(before);
  expect((await session(page)).rowSamples[2]).toBe(54);
  expect((await session(page)).rowSamples[0]).toBe(0);
  await expect.poll(()=>page.evaluate(()=>window.notes.some(note=>note.offset===13.5))).toBe(true);
  await page.getByRole('button',{name:'■ Stop',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('combobox',{name:'Source slice',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
