import { test, expect } from '@playwright/test';

test('PWA metadata uses the Stepfield icon and cached app shell opens offline',async({page,context})=>{
  await page.goto('/');
  const manifestResponse=await page.request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  expect(manifestResponse.headers()['content-type']).toContain('application/manifest+json');
  const manifest=await manifestResponse.json();
  expect(manifest.name).toBe('Stepfield');
  expect(manifest.display).toBe('standalone');
  const faviconResponse=await page.request.get('/favicon.ico');
  expect(faviconResponse.ok()).toBe(true);
  expect(faviconResponse.headers()['content-type']).toContain('image/x-icon');
  const favicon=await page.evaluate(async()=>{
    const image=new Image(); image.src=document.querySelector('link[rel="icon"][type="image/png"]').href;
    await image.decode(); return {width:image.naturalWidth,height:image.naturalHeight};
  });
  expect(favicon).toEqual({width:192,height:192});
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({src:'./icons/icon-192.png',sizes:'192x192'}),
    expect.objectContaining({src:'./icons/icon-512.png',sizes:'512x512',purpose:'any maskable'})
  ]));
  const icon=await page.evaluate(async()=>{
    const image=new Image(); image.src=document.querySelector('link[rel="apple-touch-icon"]').href;
    await image.decode(); return {width:image.naturalWidth,height:image.naturalHeight};
  });
  expect(icon).toEqual({width:180,height:180});
  const worker=await page.evaluate(async()=>{
    const registration=await navigator.serviceWorker.ready;
    await new Promise(resolve=>{
      if(navigator.serviceWorker.controller) resolve();
      else navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true});
    });
    return registration.active?.scriptURL;
  });
  expect(worker).toContain('/service-worker.js');
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('link',{name:'Stepfield home'})).toBeVisible();
});
