import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { networkInterfaces, hostname } from 'node:os';
import { MediaLibrary, encodeMp3 } from './media.mjs';

export function allowedHost(host, interfaces = networkInterfaces()) {
  try {
    const url = new URL(`http://${host}`);
    if (!host || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return false;
    const normalize = value => new URL(`http://${value.includes(':') && !value.startsWith('[') ? `[${value}]` : value}`).hostname;
    const addresses = Object.values(interfaces).flat().filter(Boolean).map(entry => normalize(entry.address.split('%')[0]));
    return ['localhost', '127.0.0.1', '[::1]', hostname().toLowerCase(), ...addresses].includes(url.hostname);
  } catch { return false; }
}

export function createApp(library = new MediaLibrary()) {
  const json = (res, status, value) => { res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); };
  return createServer(async (req,res) => {
    try {
      const host = req.headers.host || '';
      if (!allowedHost(host)) return json(res,403,{error:'Open the app using localhost or one of this computer’s network addresses.'});
      const url = new URL(req.url,`http://${host}`);
      if (req.method === 'POST' && url.pathname === '/api/youtube') {
        if ((req.headers.origin && new URL(req.headers.origin).host !== host) || !req.headers['content-type']?.startsWith('application/json')) return json(res,403,{error:'Use the app to import a video.'});
        let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 4096) return json(res,413,{error:'Request too large.'}); }
        let data; try { data = JSON.parse(body); } catch { return json(res,400,{error:'Invalid request.'}); }
        try { const job = await library.begin(data.url); return json(res,job.status === 'ready' ? 200 : 202,job); }
        catch (error) { return json(res,error.status || 400,{error:error.message}); }
      }
      const job = url.pathname.match(/^\/api\/youtube\/([\w-]{11})$/);
      if (req.method === 'GET' && job) { const state = library.jobs.get(job[1]) || await library.cached(job[1]); return json(res,state ? 200 : 404,state || {error:'Import expired. Submit the link again.'}); }
      if (req.method === 'POST' && url.pathname === '/api/encode-mp3') {
        if ((req.headers.origin && new URL(req.headers.origin).host !== host) || !req.headers['content-type']?.startsWith('audio/wav')) return json(res,403,{error:'Use the app to export MP3 audio.'});
        const chunks=[];let size=0;
        for await (const chunk of req) { size+=chunk.length;if(size>16*1024*1024) return json(res,413,{error:'Loop is too large to convert. Download WAV instead.'});chunks.push(chunk); }
        try { const mp3=await encodeMp3(Buffer.concat(chunks));res.writeHead(200,{'Content-Type':'audio/mpeg','Content-Length':mp3.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(mp3); }
        catch(error) { return json(res,422,{error:/ENOENT/.test(error.message)?'FFmpeg is unavailable. Download WAV instead.':'Could not convert this loop to MP3. Download WAV instead.'}); }
      }
      if (req.method === 'GET' && url.pathname === '/api/storage') return json(res,200,await library.listCached());
      const storedAudio = url.pathname.match(/^\/api\/storage\/([\w-]{11})$/);
      if (req.method === 'DELETE' && storedAudio) {
        if (req.headers.origin && new URL(req.headers.origin).host !== host) return json(res,403,{error:'Use the app to remove cached audio.'});
        const removed = await library.removeCached(storedAudio[1]);
        return json(res,removed ? 200 : 404,removed ? {removed:true} : {error:'Cached track not found or still importing.'});
      }
      const audio = url.pathname.match(/^\/api\/audio\/([\w-]{11})$/);
      if (req.method === 'GET' && audio) {
        const meta = await library.cached(audio[1]); if (!meta) return json(res,404,{error:'Cached audio expired. Import the link again.'});
        res.writeHead(200,{'Content-Type':'audio/mpeg','Content-Length':meta.bytes,'Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff'});
        const stream = createReadStream(join(library.directory,`${audio[1]}.mp3`)); stream.on('error',() => res.destroy()); stream.pipe(res); return;
      }
      if (url.pathname.startsWith('/api/')) return json(res,404,{error:'Not found.'});
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res,405,{error:'Method not allowed.'});
      const root = resolve('dist/stepfield/browser');
      const path = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
      const file = resolve(root,`.${path}`); if (!file.startsWith(root + '/')) return json(res,404,{error:'Not found.'});
      const info = await stat(file); if (!info.isFile()) return json(res,404,{error:'Not found.'});
      const type = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.ico':'image/x-icon','.png':'image/png','.webmanifest':'application/manifest+json'}[extname(file)] || 'application/octet-stream';
      res.writeHead(200,{'Content-Type':type,'Content-Length':info.size,'X-Content-Type-Options':'nosniff'});
      if (req.method === 'HEAD') return res.end(); const stream = createReadStream(file); stream.on('error',() => res.destroy()); stream.pipe(res);
    } catch (error) { if (!res.headersSent) json(res,error.code === 'ENOENT' ? 404 : 500,{error:'Request failed. Check that the app is built and try again.'}); else res.destroy(); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 3001);
  createApp().listen(port,'127.0.0.1',() => console.log(`Stepfield audio service: http://localhost:${port}`));
}
