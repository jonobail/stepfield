import { test, expect } from '@playwright/test';

function wave() {
  const rate = 8000; const frames = rate * 64; const data = Buffer.alloc(44 + frames * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8,4); data.write('WAVEfmt ',8); data.writeUInt32LE(16,16); data.writeUInt16LE(1,20); data.writeUInt16LE(1,22); data.writeUInt32LE(rate,24); data.writeUInt32LE(rate*2,28); data.writeUInt16LE(2,32); data.writeUInt16LE(16,34); data.write('data',36); data.writeUInt32LE(frames*2,40);
  for (let i=0;i<frames;i++) data.writeInt16LE(Math.round(Math.sin(i*440*2*Math.PI/rate)*2000),44+i*2); return data;
}

test('playhead sweeps, wraps, and triggers selected rows simultaneously',async ({page}) => {
  await page.addInitScript(() => {
    window.audioStarts = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(when,offset,duration) { window.audioStarts.push({when,offset,duration}); return start.call(this,when,offset,duration); };
  });
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({name:'tone.wav',mimeType:'audio/wav',buffer:wave()});
  await expect(page.getByRole('status')).toContainText('256 slices ready');
  const pads = page.locator('.pad'); await pads.nth(0).click(); await pads.nth(16).click(); await pads.nth(1).click();
  await expect.poll(() => page.evaluate(() => window.audioStarts.length)).toBe(3);
  await page.evaluate(() => { window.audioStarts = []; });
  await page.getByRole('button',{name:'▶ Play',exact:true}).click();
  await expect(page.locator('.playhead-marker')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.audioStarts.length)).toBeGreaterThanOrEqual(3);
  const starts = await page.evaluate(() => window.audioStarts.slice(0,3));
  expect(starts[0].when).toBe(starts[1].when); expect(starts[0].offset).toBe(0); expect(starts[1].offset).toBe(4); expect(starts[2].offset).toBe(.25); expect(starts[2].when-starts[0].when).toBeCloseTo(.125);
  const columns = await page.evaluate(() => new Promise(resolve => { const values = []; const begin = performance.now(); const timer = setInterval(() => { const marker = document.querySelector('.playhead-marker'); if(marker) values.push(Number(marker.style.gridColumn)); if(performance.now()-begin > 2300) { clearInterval(timer); resolve(values); } },16); }));
  expect(new Set(columns).size).toBe(16); expect(columns.some((n,i) => n === 1 && columns[i-1] === 16)).toBe(true);
  await page.getByRole('button',{name:'■ Stop'}).click(); await expect(page.locator('.playhead-marker')).toHaveCount(0); await expect(page.locator('.pad.active')).toHaveCount(0);
  await page.screenshot({path:'test-results/grid.png',fullPage:true});
});

test('YouTube import polls conversion, decodes the response, and reloads saved audio',async ({page}) => {
  let polls = 0;
  await page.route('**/api/youtube',route => route.fulfill({json:{id:'abcdefghijk',status:'processing',message:'Downloading audio…'}}));
  await page.route('**/api/youtube/abcdefghijk',route => { polls++; return route.fulfill({json:{id:'abcdefghijk',status:'ready',title:'YouTube fixture',bytes:24000}}); });
  await page.route('**/api/audio/abcdefghijk',route => route.fulfill({contentType:'audio/wav',body:wave()}));
  await page.goto('/'); await page.getByRole('textbox',{name:'YouTube link'}).fill('https://youtu.be/abcdefghijk'); await page.getByRole('button',{name:'Import YouTube audio',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('256 slices ready'); expect(polls).toBe(1); await expect(page.locator('.source-name')).toHaveText('YouTube fixture'); await expect(page.locator('video,iframe')).toHaveCount(0);
  await page.reload(); await expect(page.getByRole('status')).toContainText('Cached audio ready. Press Space or Play.');
  await expect(page.getByRole('button',{name:'▶ Play',exact:true})).toBeEnabled();
});

test('global and per-pad shaping alter real audio triggers and survive reload',async ({page}) => {
  await page.addInitScript(() => {
    window.audioStarts = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(when,offset,duration) { window.audioStarts.push({when,offset,duration,rate:this.playbackRate.value}); return start.call(this,when,offset,duration); };
  });
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles({name:'tone.wav',mimeType:'audio/wav',buffer:wave()});
  await expect(page.getByRole('status')).toContainText('256 slices ready');
  const change = async (label,value) => { const input = page.getByRole('spinbutton',{name:label+' value',exact:true}); await input.fill(String(value)); await input.press('Tab'); };
  await change('Length',50);
  await page.getByRole('button',{name:'Edit sound',exact:true}).click();
  await page.locator('.pad').nth(0).click();
  await expect(page.locator('.pad').nth(0)).toHaveAttribute('aria-pressed','false');
  await page.getByRole('button',{name:'Blip · 10 ms',exact:true}).click();
  await expect(page.getByRole('spinbutton',{name:'Length value'})).toHaveValue('4');
  await page.getByText('Tone & envelope',{exact:true}).click();
  await change('Pitch',12); await change('Attack',500); await change('Release',1000); await change('Pan',-50);
  await expect(page.locator('.sound-panel .slice-time')).toContainText('5.0 ms playback');
  await page.getByRole('button',{name:'▶ Preview slice',exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.audioStarts.length)).toBe(1);
  const preview = await page.evaluate(() => window.audioStarts[0]); expect(preview.duration).toBeCloseTo(.01); expect(preview.rate).toBe(2);
  await page.locator('.pad').nth(16).click(); await expect(page.getByRole('spinbutton',{name:'Length value'})).toHaveValue('50');
  await page.getByRole('button',{name:'Select steps',exact:true}).click(); await page.locator('.pad').nth(0).click(); await page.locator('.pad').nth(16).click();
  await page.evaluate(() => { window.audioStarts = []; });
  await page.getByRole('button',{name:'▶ Play',exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.audioStarts.length)).toBeGreaterThanOrEqual(2);
  const voices = await page.evaluate(() => window.audioStarts.slice(0,2));
  expect(voices[0].when).toBe(voices[1].when); expect(voices[0].duration).toBeCloseTo(.01); expect(voices[0].rate).toBe(2); expect(voices[1].duration).toBe(.125); expect(voices[1].rate).toBe(1);
  await page.getByRole('button',{name:'■ Stop',exact:true}).click();
  await page.reload(); await page.getByRole('button',{name:'Edit sound',exact:true}).click(); await page.locator('.pad').nth(0).click();
  await expect(page.getByRole('spinbutton',{name:'Length value'})).toHaveValue('4');
  await page.getByRole('button',{name:'↩ Use global length',exact:true}).click(); await expect(page.getByRole('spinbutton',{name:'Length value'})).toHaveValue('50');
  await page.getByText('Tone & envelope',{exact:true}).click(); await expect(page.getByRole('spinbutton',{name:'Pitch value'})).toHaveValue('12');
  await page.getByRole('button',{name:'Reset pad to global',exact:true}).click(); await expect(page.getByRole('spinbutton',{name:'Pitch value'})).toHaveValue('0');
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
  await page.locator('input[type=file]').first().setInputFiles({name:'tone.wav',mimeType:'audio/wav',buffer:wave()});
  await expect(page.getByRole('status')).toContainText('256 slices ready');
  const pad = page.locator('.pad').first(); await pad.click();
  await expect.poll(() => page.evaluate(() => window.audioStarts.length)).toBe(1);
  await page.keyboard.press('Space'); await expect(page.locator('.playhead-marker')).toBeVisible();
  await expect(pad).toHaveAttribute('aria-pressed','true');
  await page.keyboard.down('Space'); await expect(page.locator('.playhead-marker')).toHaveCount(0);
  await page.keyboard.down('Space'); await page.keyboard.up('Space'); await expect(page.locator('.playhead-marker')).toHaveCount(0);
  await expect(pad).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Shift+Space'); await expect(page.locator('.playhead-marker')).toHaveCount(0);
  await page.getByRole('button',{name:'Source',exact:true}).click();
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
  await page.goto('/'); await page.locator('input[type=file]').first().setInputFiles({name:'tone.wav',mimeType:'audio/wav',buffer:wave()});
  await expect(page.getByRole('status')).toContainText('256 slices ready');
  await page.locator('.pad').nth(17).click();
  await expect.poll(() => page.evaluate(() => window.audioStarts.length)).toBe(1);
  expect(await page.evaluate(() => window.audioStarts[0].offset)).toBe(4.25);
  await expect(page.locator('.pad').nth(17)).toHaveAttribute('aria-pressed','true');
  await page.evaluate(() => { window.audioStarts = []; }); await page.getByRole('button',{name:'▶ Play',exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.audioStarts.length)).toBe(1);
  const sequenceStart = await page.evaluate(() => window.audioStarts[0]);
  expect(sequenceStart.offset).toBe(4.25);
  const selectedAt = sequenceStart.when;
  await page.locator('.pad').nth(33).click();
  await expect.poll(() => page.evaluate(() => window.audioStarts.length)).toBe(2);
  const next = await page.evaluate(() => window.audioStarts[1]);
  expect(next.offset).toBe(8.25); expect(next.when).toBeGreaterThanOrEqual(selectedAt);
  await expect(page.locator('.pad').nth(33)).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'■ Stop',exact:true}).click();
});

test('compact panels retain controls and the larger grid uses flat square pads', async ({page}) => {
  await page.setViewportSize({width:1280,height:900}); await page.goto('/');
  await expect(page.getByRole('link',{name:'Stepfield home'})).toBeVisible();
  const grid = await page.locator('.grid').boundingBox(); expect(grid.width).toBeGreaterThan(750);
  await expect(page.getByRole('button',{name:'Audition',exact:true})).toHaveCount(0);
  await expect(page.getByText('One recording. 256 slices. Build a pattern and let it move.')).toHaveCount(0);
  await expect(page.locator('#panel-source')).toBeVisible(); await expect(page.locator('#panel-sound')).toBeHidden(); await expect(page.locator('#panel-session')).toBeHidden();
  await page.getByRole('button',{name:'Sound',exact:true}).click();
  await expect(page.locator('#panel-source')).toBeHidden(); await expect(page.getByRole('spinbutton',{name:'Length value'})).toBeVisible();
  await page.getByText('Tone & envelope',{exact:true}).click();
  const inspector = await page.locator('.inspector').boundingBox(); expect(inspector.y + inspector.height).toBeLessThanOrEqual(900);
  expect(await page.locator('.pad').first().evaluate(el => getComputedStyle(el).borderRadius)).toBe('4px');
  expect(await page.locator('.pad').first().evaluate(el => getComputedStyle(el).boxShadow)).toBe('none');
  await page.getByRole('button',{name:'Session',exact:true}).click(); await expect(page.getByRole('button',{name:'Export pattern ↗'})).toBeVisible();
  const download = page.waitForEvent('download'); await page.getByRole('button',{name:'Export pattern ↗'}).click(); expect((await download).suggestedFilename()).toBe('stepfield-pattern.json');
  await page.getByRole('button',{name:'Sound',exact:true}).click(); await page.getByText('Tone & envelope',{exact:true}).click();
  await page.screenshot({path:'test-results/stepfield-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844}); expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({path:'test-results/stepfield-mobile.png',fullPage:true});
});

test('step modulation changes triggered pitch, resets with Play and persists', async ({page}) => {
  await page.addInitScript(() => {
    window.audioStarts = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(when,offset,duration) { window.audioStarts.push({when,rate:this.playbackRate.value}); return start.call(this,when,offset,duration); };
  });
  await page.goto('/'); await page.locator('input[type=file]').first().setInputFiles({name:'tone.wav',mimeType:'audio/wav',buffer:wave()});
  await expect(page.getByRole('status')).toContainText('256 slices ready');
  for (let index=0;index<4;index++) await page.locator('.pad').nth(index).click();
  await page.getByRole('button',{name:'Mod',exact:true}).click();
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
  await page.reload(); await page.getByRole('button',{name:'Mod',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'Enable modulation'})).not.toBeChecked();
  await expect(page.getByRole('combobox',{name:'Modulation target'})).toHaveValue('pitch');
  await expect(page.getByRole('combobox',{name:'Modulation shape'})).toHaveValue('square');
  await expect(page.getByRole('slider',{name:'Modulation depth'})).toHaveValue('100');
});
