import { test, expect } from '@playwright/test';
import { wave, installOutputMeter } from './audio-fixture.mjs';

// Do not bypass gesture policy: the original regression was hidden by desktop mouse
// tests and by Chromium's no-user-gesture-required switch.
test.use({hasTouch:true,viewport:{width:390,height:844},launchOptions:{args:[]}});
test.describe('touch audio activation', () => {

  async function restoreCachedSource(page) {
    await page.route('**/api/audio/abcdefghijk',route=>route.fulfill({contentType:'audio/wav',body:wave()}));
    await page.addInitScript(()=>{
      localStorage.setItem('stepfield-session-v1',JSON.stringify({version:1,pattern:Array(256).fill(false),bpm:120,volume:70,sourceId:'abcdefghijk',source:'Touch fixture'}));
      window.audioResumes=[]; window.audioStarts=[]; window.audioEvent='';
      for(const type of ['pointerdown','pointerup','pointercancel','click']) document.addEventListener(type,()=>{window.audioEvent=type;},true);
      const resume=AudioContext.prototype.resume;
      AudioContext.prototype.resume=function(){window.audioResumes.push({event:window.audioEvent,active:navigator.userActivation.isActive});return resume.call(this);};
      const start=AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start=function(...args){window.audioStarts.push(args);return start.apply(this,args);};
      Object.defineProperty(navigator,'audioSession',{configurable:true,value:{type:'auto'}});
    });
    await installOutputMeter(page);
    await page.goto('/');
    await expect(page.getByRole('status')).toContainText('Cached audio ready');
  }

  test('first finger tap resumes on release, plays a sample, and toggles only once',async({page})=>{
    await restoreCachedSource(page);
    await page.locator('.pad').first().tap();
    await expect(page.locator('.pad').first()).toHaveAttribute('aria-pressed','true');
    await expect.poll(()=>page.evaluate(()=>window.audioStarts.length)).toBe(1);
    expect(await page.evaluate(()=>window.audioResumes)).toEqual([{event:'pointerup',active:true}]);
    expect(await page.evaluate(()=>navigator.audioSession.type)).toBe('playback');
    await expect.poll(()=>page.evaluate(()=>window.outputPeak())).toBeGreaterThan(.002);
    await page.locator('.pad').first().tap();
    await expect(page.locator('.pad').first()).toHaveAttribute('aria-pressed','false');
    expect(await page.evaluate(()=>window.audioStarts.length)).toBe(1);
  });

  test('cancelling a touch does not leave a blocked preview waiting for the next tap',async({page})=>{
    await restoreCachedSource(page);
    const pad=page.locator('.pad').first();
    await pad.dispatchEvent('pointerdown',{pointerType:'touch',button:0});
    expect(await page.evaluate(()=>window.audioResumes.length)).toBe(0);
    await pad.dispatchEvent('pointercancel',{pointerType:'touch',button:0});
    await page.getByRole('button',{name:'▶ Play',exact:true}).tap();
    await expect(page.locator('.playhead-marker')).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>window.audioStarts.length)).toBe(1);
    expect(await page.evaluate(()=>window.audioResumes)).toEqual([{event:'click',active:true}]);
    await expect.poll(()=>page.evaluate(()=>window.outputPeak())).toBeGreaterThan(.002);
    await page.getByRole('button',{name:'■ Stop',exact:true}).tap();
  });

});
