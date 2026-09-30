import { test, expect } from '@playwright/test';

import { wave, installOutputMeter } from './audio-fixture.mjs';

test('playhead sweeps, wraps, and triggers selected rows simultaneously',async ({page}) => {
  await page.addInitScript(() => {
    window.audioStarts = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(when,offset,duration) { window.audioStarts.push({when,offset,duration}); return start.call(this,when,offset,duration); };
  });
  await page.goto('/');
  await page.getByLabel('Import local audio or video',{exact:true}).setInputFiles({name:'tone.wav',mimeType:'audio/wav',buffer:wave()});
  await expect(page.getByRole('status')).toContainText('slices');
  const pads = page.locator('.pad'); await pads.nth(0).click(); await pads.nth(16).click(); await pads.nth(1).click();
  await expect.poll(() => page.evaluate(() => window.audioStarts.length)).toBe(3);
  await page.evaluate(() => { window.audioStarts = []; });
  await page.getByRole('button',{name:'▶ Play',exact:true}).click();
  await expect(page.locator('.playhead-marker')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.audioStarts.length)).toBeGreaterThanOrEqual(3);
  const starts = await page.evaluate(() => window.audioStarts.slice(0,3));
  expect(starts[0].when).toBe(starts[1].when); expect(starts[0].offset).toBe(0); expect(starts[1].offset).toBe(4); expect(starts[2].offset).toBe(0); expect(starts[2].when-starts[0].when).toBeCloseTo(.125);
  const columns = await page.evaluate(() => new Promise(resolve => { const values = []; const begin = performance.now(); const timer = setInterval(() => { const marker = document.querySelector('.playhead-marker'); if(marker) values.push(Number(marker.style.gridColumn)); if(performance.now()-begin > 2300) { clearInterval(timer); resolve(values); } },16); }));
  expect(new Set(columns).size).toBe(16); expect(columns.some((n,i) => n === 1 && columns[i-1] === 16)).toBe(true);
  await page.getByRole('button',{name:'■ Stop'}).click(); await expect(page.locator('.playhead-marker')).toHaveCount(0); await expect(page.locator('.pad.active')).toHaveCount(0);
  await page.screenshot({path:'test-results/grid.png',fullPage:true});
});

test('a first pointer tap enables a step once instead of toggling it back off',async ({page}) => {
  await page.goto('/'); const pad = page.locator('.pad').first();
  await expect(pad).toHaveAttribute('aria-pressed','false'); await pad.click();
  await expect(pad).toHaveAttribute('aria-pressed','true');
});

test('speaker test and loaded sample both produce signal at the master output',async ({page}) => {
  await installOutputMeter(page); await page.goto('/');
  await page.getByLabel('Import local audio or video',{exact:true}).setInputFiles({name:'tone.wav',mimeType:'audio/wav',buffer:wave()});
  await expect(page.getByRole('status')).toContainText('slices');
  await page.getByRole('button',{name:'Test speaker output'}).click();
  await expect.poll(() => page.evaluate(() => window.outputPeak())).toBeGreaterThan(.1);
  await page.getByRole('button',{name:'▶ Preview global sound',exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.outputPeak())).toBeGreaterThan(.002);
});

test('YouTube import polls conversion, decodes the response, and reloads saved audio',async ({page}) => {
  let polls = 0;
  await page.route('**/api/youtube',route => route.fulfill({json:{id:'abcdefghijk',status:'processing',message:'Downloading audio…'}}));
  await page.route('**/api/youtube/abcdefghijk',route => { polls++; return route.fulfill({json:{id:'abcdefghijk',status:'ready',title:'YouTube fixture',bytes:24000}}); });
  await page.route('**/api/audio/abcdefghijk',route => route.fulfill({contentType:'audio/wav',body:wave()}));
  await page.goto('/'); await page.getByRole('textbox',{name:'YouTube link'}).fill('https://youtu.be/abcdefghijk'); await page.getByRole('button',{name:'Import YouTube audio',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('slices'); expect(polls).toBe(1); await expect(page.locator('.source-name')).toHaveText('YouTube fixture'); await expect(page.locator('video,iframe')).toHaveCount(0);
  await page.reload(); await expect(page.getByRole('status')).toContainText('Cached audio ready. Press Space or Play.');
  await expect(page.getByRole('button',{name:'▶ Play',exact:true})).toBeEnabled();
});

test('global and per-row shaping alter real audio triggers and survive reload',async ({page}) => {
  await page.addInitScript(() => {
    window.audioStarts = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(when,offset,duration) { window.audioStarts.push({when,offset,duration,rate:this.playbackRate.value}); return start.call(this,when,offset,duration); };
  });
  await page.goto('/');
  await page.getByLabel('Import local audio or video',{exact:true}).setInputFiles({name:'tone.wav',mimeType:'audio/wav',buffer:wave()});
  await expect(page.getByRole('status')).toContainText('slices');
  const change = async (label,value) => { const input = page.getByRole('spinbutton',{name:label+' value',exact:true}); await input.fill(String(value)); await input.press('Tab'); };
  await change('Length',50);
  await page.getByRole('combobox',{name:'Grid action',exact:true}).selectOption('edit');
  await page.locator('.pad').nth(0).click();
  await expect(page.locator('.pad').nth(0)).toHaveAttribute('aria-pressed','false');
  await page.getByRole('button',{name:'Blip · 10 ms',exact:true}).click();
  await expect(page.getByRole('spinbutton',{name:'Length value'})).toHaveValue('4');

  await change('Pitch',12); await change('Attack',500); await change('Release',1000); await change('Pan',-50);
  await expect(page.locator('.sound-panel .slice-time')).toContainText('5.0 ms playback');
  await page.getByRole('button',{name:'▶ Preview slice',exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.audioStarts.length)).toBe(1);
  const preview = await page.evaluate(() => window.audioStarts[0]); expect(preview.duration).toBeCloseTo(.01); expect(preview.rate).toBe(2);
  await page.locator('.pad').nth(16).click(); await expect(page.getByRole('spinbutton',{name:'Length value'})).toHaveValue('50');
  await page.getByRole('combobox',{name:'Grid action',exact:true}).selectOption('pattern'); await page.locator('.pad').nth(0).click(); await page.locator('.pad').nth(16).click();
  await page.evaluate(() => { window.audioStarts = []; });
  await page.getByRole('button',{name:'▶ Play',exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.audioStarts.length)).toBeGreaterThanOrEqual(2);
  const voices = await page.evaluate(() => window.audioStarts.slice(0,2));
  expect(voices[0].when).toBe(voices[1].when); expect(voices[0].duration).toBeCloseTo(.01); expect(voices[0].rate).toBe(2); expect(voices[1].duration).toBe(.125); expect(voices[1].rate).toBe(1);
  await page.getByRole('button',{name:'■ Stop',exact:true}).click();
  await page.reload(); await page.getByRole('combobox',{name:'Grid action',exact:true}).selectOption('edit'); await page.locator('.pad').nth(0).click();
  await expect(page.getByRole('spinbutton',{name:'Length value'})).toHaveValue('4');
  await page.getByRole('button',{name:'↩ Use global length',exact:true}).click(); await expect(page.getByRole('spinbutton',{name:'Length value'})).toHaveValue('50');
   await expect(page.getByRole('spinbutton',{name:'Pitch value'})).toHaveValue('12');
  await page.getByRole('button',{name:'Reset row to global',exact:true}).click(); await expect(page.getByRole('spinbutton',{name:'Pitch value'})).toHaveValue('0');
  await page.setViewportSize({width:390,height:844}); expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('Space toggles transport without toggling the focused pad or interrupting typing', async ({page}) => {
  await page.addInitScript(() => {
    window.audioStarts = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(when,offset,duration) { window.audioStarts.push({when,offset,duration}); return start.call(this,when,offset,duration); };
  });
  await page.goto('/');
  await expect(page).toHaveTitle('Stepfield');
  await page.keyboard.press('Space'); await expect(page.locator('.playhead-marker')).toHaveCount(0);
  await page.getByLabel('Import local audio or video',{exact:true}).setInputFiles({name:'tone.wav',mimeType:'audio/wav',buffer:wave()});
  await expect(page.getByRole('status')).toContainText('slices');
  const pad = page.locator('.pad').first(); await pad.click();
  await expect.poll(() => page.evaluate(() => window.audioStarts.length)).toBe(1);
  await page.keyboard.press('Space'); await expect(page.locator('.playhead-marker')).toBeVisible();
  await expect(pad).toHaveAttribute('aria-pressed','true');
  await page.keyboard.down('Space'); await expect(page.locator('.playhead-marker')).toHaveCount(0);
  await page.keyboard.down('Space'); await page.keyboard.up('Space'); await expect(page.locator('.playhead-marker')).toHaveCount(0);
  await expect(pad).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Shift+Space'); await expect(page.locator('.playhead-marker')).toHaveCount(0);

  const input = page.getByRole('textbox',{name:'YouTube link'}); await input.fill('hello'); await input.press('End'); await page.keyboard.press('Space');
  await expect(input).toHaveValue('hello '); await expect(page.locator('.playhead-marker')).toHaveCount(0);
  await page.getByRole('spinbutton',{name:'Tempo · BPM'}).focus(); await page.keyboard.press('Space'); await expect(page.locator('.playhead-marker')).toHaveCount(0);
  await page.getByRole('slider',{name:'Volume · %'}).focus(); await page.keyboard.press('Space'); await expect(page.locator('.playhead-marker')).toHaveCount(0);
  await pad.focus(); await page.keyboard.press('Space'); await expect(page.locator('.playhead-marker')).toBeVisible();
  await page.keyboard.press('Space'); await expect(page.locator('.playhead-marker')).toHaveCount(0);
});

test('selecting a step auditions its slice while stopped; running selection waits for its step',async ({page}) => {
  await page.addInitScript(() => {
    window.audioStarts = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(when,offset,duration) { window.audioStarts.push({when,offset,duration}); return start.call(this,when,offset,duration); };
  });
  await page.goto('/'); await page.getByLabel('Import local audio or video',{exact:true}).setInputFiles({name:'tone.wav',mimeType:'audio/wav',buffer:wave()});
  await expect(page.getByRole('status')).toContainText('slices');
  await page.locator('.pad').nth(17).click();
  await expect.poll(() => page.evaluate(() => window.audioStarts.length)).toBe(1);
  expect(await page.evaluate(() => window.audioStarts[0].offset)).toBe(4);
  await expect(page.locator('.pad').nth(17)).toHaveAttribute('aria-pressed','true');
  await page.evaluate(() => { window.audioStarts = []; }); await page.getByRole('button',{name:'▶ Play',exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.audioStarts.length)).toBe(1);
  const sequenceStart = await page.evaluate(() => window.audioStarts[0]);
  expect(sequenceStart.offset).toBe(4);
  const selectedAt = sequenceStart.when;
  await page.locator('.pad').nth(33).click();
  await expect.poll(() => page.evaluate(() => window.audioStarts.length)).toBe(2);
  const next = await page.evaluate(() => window.audioStarts[1]);
  expect(next.offset).toBe(8); expect(next.when).toBeGreaterThanOrEqual(selectedAt);
  await expect(page.locator('.pad').nth(33)).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'■ Stop',exact:true}).click();
});

test('scrolling over the grid leaves its row sounds unchanged', async ({page}) => {
  await page.addInitScript(() => {
    window.audioStarts = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(when,offset,duration) { window.audioStarts.push({when,offset,duration}); return start.call(this,when,offset,duration); };
  });
  await page.goto('/'); await page.getByLabel('Import local audio or video',{exact:true}).setInputFiles({name:'tone.wav',mimeType:'audio/wav',buffer:wave()});
  await expect(page.getByRole('button',{name:'▶ Play',exact:true})).toBeEnabled();
  await page.locator('.pad').nth(0).hover(); await page.mouse.wheel(0,100);
  await page.locator('.pad').nth(0).click(); await page.locator('.pad').nth(7).click();
  await expect.poll(() => page.evaluate(() => window.audioStarts.length)).toBe(2);
  expect(await page.evaluate(() => window.audioStarts.map(start => start.offset))).toEqual([0,0]);
  await expect(page.locator('.pad').nth(0)).toHaveAttribute('title',/Slice 1,/);
  await expect(page.locator('.pad').nth(16)).toHaveAttribute('title',/Slice 17/);
});

test('drag painting fills and clears crossed pads while Shift-drag moves a step',async ({page}) => {
  await page.goto('/');
  const pads = page.locator('.pad');
  const point = async index => { const box = await pads.nth(index).boundingBox(); return {x:box.x+box.width/2,y:box.y+box.height/2}; };
  await page.mouse.move((await point(0)).x,(await point(0)).y); await page.mouse.down();
  for (const index of [1,2,3]) { const p = await point(index); await page.mouse.move(p.x,p.y); }
  await page.mouse.up();
  for (const index of [0,1,2,3]) await expect(pads.nth(index)).toHaveAttribute('aria-pressed','true');
  const from = await point(3), to = await point(4); await page.mouse.move(from.x,from.y); await page.keyboard.down('Shift'); await page.mouse.down(); await page.mouse.move(to.x,to.y); await page.mouse.up(); await page.keyboard.up('Shift');
  await expect(pads.nth(3)).toHaveAttribute('aria-pressed','false'); await expect(pads.nth(4)).toHaveAttribute('aria-pressed','true');
  const clearFrom = await point(1); await page.mouse.move(clearFrom.x,clearFrom.y); await page.mouse.down();
  for (const index of [2,4]) { const p = await point(index); await page.mouse.move(p.x,p.y); }
  await page.mouse.up();
  for (const index of [1,2,3,4]) await expect(pads.nth(index)).toHaveAttribute('aria-pressed','false');
  await expect(pads.nth(0)).toHaveAttribute('aria-pressed','true');
});

test('source, sound, modulation and session actions are directly accessible on desktop and mobile', async ({page}) => {
  await page.setViewportSize({width:1280,height:900}); await page.goto('/');
  await expect(page.getByRole('link',{name:'Stepfield home'})).toBeVisible();
  const grid = await page.locator('.grid').boundingBox(); expect(grid.width).toBeGreaterThan(540); expect(grid.width).toBeLessThan(700);
  expect(await page.locator('.grid').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
  const controls = await page.locator('.inspector').boundingBox(); expect(controls.y).toBeGreaterThanOrEqual(grid.y + grid.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await expect(page.locator('source-editor .empty-waveform')).toBeVisible();
  await expect(page.getByRole('textbox',{name:'YouTube link'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Export pattern ↗'})).toBeVisible();
  for (const name of ['Length','Pitch','Pan','Attack','Release','Level']) await expect(page.getByRole('spinbutton',{name:name+' value',exact:true})).toBeVisible();
  await expect(page.getByRole('combobox',{name:'Modulation target'})).toBeVisible();
  await expect(page.locator('.panel-tabs, .sound-details')).toHaveCount(0);
  expect(await page.locator('.pad').first().evaluate(el => getComputedStyle(el).borderRadius)).toBe('4px');
  expect(await page.locator('.pad').first().evaluate(el => getComputedStyle(el).boxShadow)).toBe('none');
  const download = page.waitForEvent('download'); await page.getByRole('button',{name:'Export pattern ↗'}).click(); expect((await download).suggestedFilename()).toBe('stepfield-pattern.json');
  await page.locator('.pad').first().click();
  await page.getByRole('button',{name:'Clear pattern',exact:true}).click();
  await expect(page.locator('.pad.assigned')).toHaveCount(0);
  await page.screenshot({path:'test-results/stepfield-desktop.png',fullPage:true});
  await page.setViewportSize({width:1600,height:1000});
  const wideGrid=await page.locator('.grid').boundingBox(),widePanel=await page.locator('.inspector').boundingBox();
  expect(wideGrid.width).toBeGreaterThan(700); expect(wideGrid.width).toBeLessThan(760); expect(widePanel.width).toBeGreaterThan(700);
  expect(await page.locator('.grid').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
  expect(widePanel.x).toBeGreaterThanOrEqual(wideGrid.x+wideGrid.width);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.getByRole('link',{name:'Modulation',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Modulation target'})).toBeInViewport();
  await expect(page.getByRole('button',{name:'Clear pattern',exact:true})).toBeInViewport();
  await page.getByRole('link',{name:'Sound',exact:true}).click();
  await expect(page.getByRole('spinbutton',{name:'Length value',exact:true})).toBeInViewport();
  await page.getByRole('link',{name:'Source',exact:true}).click();
  await page.screenshot({path:'test-results/stepfield-mobile.png',fullPage:true});
});

test('step modulation changes triggered pitch, resets with Play and persists', async ({page}) => {
  await page.addInitScript(() => {
    window.audioStarts = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(when,offset,duration) { window.audioStarts.push({when,rate:this.playbackRate.value}); return start.call(this,when,offset,duration); };
  });
  await page.goto('/'); await page.getByLabel('Import local audio or video',{exact:true}).setInputFiles({name:'tone.wav',mimeType:'audio/wav',buffer:wave()});
  await expect(page.getByRole('status')).toContainText('slices');
  for (let index=0;index<4;index++) await page.locator('.pad').nth(index).click();

  await page.getByRole('checkbox',{name:'Enable modulation'}).check();
  await page.getByRole('combobox',{name:'Modulation target'}).selectOption('pitch');
  await page.getByRole('combobox',{name:'Modulation shape'}).selectOption('square');
  await page.getByRole('combobox',{name:'Modulation cycle'}).selectOption('4');
  await page.getByRole('slider',{name:'Modulation depth'}).press('End');
  await expect.poll(() => page.evaluate(() => window.audioStarts.length)).toBe(4);
  await page.evaluate(() => { window.audioStarts = []; });
  await page.getByRole('button',{name:'▶ Play',exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.audioStarts.length)).toBeGreaterThanOrEqual(4);
  expect(await page.evaluate(() => window.audioStarts.slice(0,4).map(s => s.rate))).toEqual([2,2,.5,.5]);
  await page.getByRole('button',{name:'■ Stop',exact:true}).click();
  await expect(page.locator('.pad.active')).toHaveCount(0);
  await page.evaluate(() => { window.audioStarts = []; }); await page.getByRole('button',{name:'▶ Play',exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.audioStarts[0]?.rate)).toBe(2);
  await page.getByRole('button',{name:'■ Stop',exact:true}).click();
  await page.getByRole('checkbox',{name:'Enable modulation'}).uncheck();
  await page.evaluate(() => { window.audioStarts = []; }); await page.getByRole('button',{name:'▶ Play',exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.audioStarts[0]?.rate)).toBe(1);
  await page.getByRole('button',{name:'■ Stop',exact:true}).click();
  await page.reload();
  await expect(page.getByRole('checkbox',{name:'Enable modulation'})).not.toBeChecked();
  await expect(page.getByRole('combobox',{name:'Modulation target'})).toHaveValue('pitch');
  await expect(page.getByRole('combobox',{name:'Modulation shape'})).toHaveValue('square');
  await expect(page.getByRole('slider',{name:'Modulation depth'})).toHaveValue('100');
});

test('dropdowns built from lists show their current values on first render',async ({page}) => {
  await page.goto('/');
  await expect(page.getByRole('combobox',{name:'Modulation cycle'})).toHaveValue('16');
  await page.getByRole('combobox',{name:'Source row'}).selectOption('3');
  await expect(page.getByRole('combobox',{name:'Source row'})).toHaveValue('3');
  await page.reload();
  await expect(page.getByRole('combobox',{name:'Modulation cycle'})).toHaveValue('16');
});
