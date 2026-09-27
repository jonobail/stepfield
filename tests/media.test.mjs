import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaLibrary, youtubeId, run } from '../server/media.mjs';
import { createApp, allowedHost } from '../server/index.mjs';
import { networkInterfaces } from 'node:os';
import { request } from 'node:http';
import ffmpeg from 'ffmpeg-static';

test('host validation allows this machine’s LAN and VPN addresses, not arbitrary hosts', () => {
  const interfaces = {lan:[{address:'192.168.40.184'}],vpn:[{address:'100.87.111.51'},{address:'fd7a:115c:a1e0::1234'}]};
  for (const host of ['localhost:4200','127.0.0.1:4200','[::1]:4200','192.168.40.184:4200','100.87.111.51:4200','[fd7a:115c:a1e0::1234]:4200']) assert.equal(allowedHost(host,interfaces),true,host);
  for (const host of ['evil.test:4200','192.168.40.99:4200','localhost.evil.test','user@localhost:4200','localhost/path','']) assert.equal(allowedHost(host,interfaces),false,host);
});

test('YouTube links are normalized without accepting arbitrary hosts or commands', () => {
  for (const url of ['https://youtu.be/abcdefghijk?t=5','https://www.youtube.com/watch?v=abcdefghijk&list=x','https://youtube.com/shorts/abcdefghijk','https://music.youtube.com/watch?v=abcdefghijk']) assert.equal(youtubeId(url),'abcdefghijk');
  for (const url of ['file:///etc/passwd','http://localhost/watch?v=abcdefghijk','https://youtube.com.evil.test/watch?v=abcdefghijk','https://youtube.com/playlist?list=abc','https://user@youtube.com/watch?v=abcdefghijk','https://youtube.com:8080/watch?v=abcdefghijk','--exec touch /tmp/test']) assert.throws(() => youtubeId(url));
});

test('conversion API deduplicates jobs, caches audio, serves bytes, and reports failures', async () => {
  const directory = await mkdtemp(join(tmpdir(),'grid-api-')); let conversions = 0; let release;
  const gate = new Promise(resolve => { release = resolve; });
  const library = new MediaLibrary({directory,convert:async (id,path,update) => { conversions++; update('Compressing audio…'); await gate; await writeFile(join(path,'audio.mp3'),Buffer.from('test-audio')); return {title:'Fixture',duration:2}; }});
  const server = createApp(library); await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = url => fetch(base+'/api/youtube',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
  try {
    assert.equal((await post('https://evil.test/')).status,400);
    const first = await post('https://youtu.be/abcdefghijk'); assert.equal(first.status,202);
    const repeated = await post('https://youtube.com/watch?v=abcdefghijk'); assert.equal((await repeated.json()).id,'abcdefghijk');
    assert.equal((await post('https://youtu.be/lmnopqrstuv')).status,429);
    release(); await library.pending;
    const ready = await (await fetch(base+'/api/youtube/abcdefghijk')).json(); assert.equal(ready.status,'ready');
    assert.equal(await (await fetch(base+ready.audioUrl)).text(),'test-audio');
    assert.equal((await (await post('https://youtu.be/abcdefghijk')).json()).cached,true); assert.equal(conversions,1);
    assert.equal((await readdir(directory)).some(name => name.startsWith('work-')),false);
    const denied = await fetch(base+'/api/youtube',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.test'},body:'{}'}); assert.equal(denied.status,403);
    const address = Object.values(networkInterfaces()).flat().find(entry => entry.family === 'IPv4' && !entry.internal)?.address || '127.0.0.1';
    const host = `${address}:4200`;
    const viaProxy = origin => new Promise((resolve,reject) => {
      const req = request(base+'/api/youtube',{method:'POST',headers:{Host:host,Origin:origin,'Content-Type':'application/json'}},res => {
        let body = ''; res.on('data',chunk => { body += chunk; }); res.on('end',() => resolve({status:res.statusCode,data:JSON.parse(body)}));
      }); req.on('error',reject); req.end(JSON.stringify({url:'https://youtu.be/abcdefghijk'}));
    });
    const lan = await viaProxy(`http://${host}`); assert.equal(lan.status,200); assert.equal(lan.data.cached,true);
    const crossOrigin = await viaProxy('https://evil.test'); assert.equal(crossOrigin.status,403);
    library.convert = async () => { throw new Error('private video'); };
    await post('https://youtu.be/lmnopqrstuv'); await library.pending;
    const failed = await (await fetch(base+'/api/youtube/lmnopqrstuv')).json(); assert.equal(failed.status,'error'); assert.match(failed.message,/unavailable/);
    assert.equal((await readdir(directory)).some(name => name.startsWith('work-')),false);
  } finally { release(); await new Promise(resolve => server.close(resolve)); await rm(directory,{recursive:true,force:true}); }
});

test('cache evicts older audio when the size cap is reached', async () => {
  const directory = await mkdtemp(join(tmpdir(),'grid-cache-'));
  const library = new MediaLibrary({directory,maxBytes:15,convert:async (id,path) => { await writeFile(join(path,'audio.mp3'),'1234567890'); return {title:id}; }});
  try { await library.begin('https://youtu.be/abcdefghijk'); await library.pending; await library.begin('https://youtu.be/lmnopqrstuv'); await library.pending; assert.equal(await library.cached('abcdefghijk'),null); assert.equal((await library.cached('lmnopqrstuv')).bytes,10); }
  finally { await rm(directory,{recursive:true,force:true}); }
});

test('real ffmpeg produces compact 32 kHz stereo MP3', async () => {
  const directory = await mkdtemp(join(tmpdir(),'grid-codec-'));
  try {
    await run(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=2','-ac','2','-ar','32000','-c:a','libmp3lame','-b:a','96k',join(directory,'audio.mp3')]);
    const { stat } = await import('node:fs/promises'); const size = (await stat(join(directory,'audio.mp3'))).size; assert.ok(size > 20000 && size < 30000);
    await run(ffmpeg,['-hide_banner','-loglevel','error','-i',join(directory,'audio.mp3'),'-f','null','-']);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
