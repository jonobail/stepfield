import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import ffmpeg from 'ffmpeg-static';

export function youtubeId(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter a valid YouTube video link.');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a valid YouTube video link.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) throw new Error('Enter a valid YouTube video link.');
  const host = url.hostname.toLowerCase();
  const id = ['youtu.be', 'www.youtu.be'].includes(host) ? url.pathname.slice(1) :
    ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host) ?
      (url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})\/?$/)?.[1]) : null;
  if (!id || !/^[\w-]{11}$/.test(id)) throw new Error('Enter a YouTube video link, not a playlist or channel.');
  return id;
}

export function run(command, args, {timeout = 180_000, onOutput = () => {}} = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
    let output = ''; let errors = ''; let expired = false;
    const timer = setTimeout(() => { expired = true; child.kill('SIGKILL'); }, timeout);
    child.stdout.on('data', data => { output = (output + data).slice(-2_000_000); onOutput(String(data)); });
    child.stderr.on('data', data => { errors = (errors + data).slice(-8000); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); if (code === 0) resolvePromise(output); else reject(new Error(expired ? 'Conversion timed out. Try a shorter video.' : errors || `Media tool exited with code ${code}.`)); });
  });
}

export async function convertYoutube(id, directory, update) {
  const binary = process.env.YT_DLP_PATH || resolve('.tools/yt-dlp', process.platform === 'win32' ? 'Scripts/yt-dlp.exe' : 'bin/yt-dlp');
  const common = ['--ignore-config', '--no-plugin-dirs', '--no-playlist', '--no-warnings', '--socket-timeout', '20', '--retries', '1', '--js-runtimes', `node:${process.execPath}`];
  const url = `https://www.youtube.com/watch?v=${id}`;
  update('Checking video…');
  const meta = JSON.parse(await run(binary, [...common, '--dump-single-json', '--skip-download', '--', url], {timeout:60_000}));
  if (meta.is_live || meta.live_status === 'is_upcoming' || !Number.isFinite(meta.duration) || meta.duration <= 0 || meta.duration > 900) throw new Error('Choose a finished video up to 15 minutes long.');
  update('Downloading audio…');
  await run(binary, [...common, '-f', 'bestaudio[abr<=160]/bestaudio', '--max-filesize', '100M', '--match-filters', '!is_live & duration <= 900', '--no-progress', '--no-cache-dir', '-o', join(directory, 'source.%(ext)s'), '--', url]);
  const input = (await readdir(directory)).find(name => /^source\.[a-zA-Z0-9]+$/.test(name));
  if (!input) throw new Error('No audio was downloaded. Choose another video.');
  update('Compressing audio…');
  await run(process.env.FFMPEG_PATH || ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', join(directory,input), '-vn', '-map', '0:a:0', '-t', '900', '-ac', '2', '-ar', '32000', '-c:a', 'libmp3lame', '-b:a', '96k', '-map_metadata', '-1', join(directory,'audio.mp3')]);
  return {title: String(meta.title || 'YouTube audio').slice(0,200), duration: meta.duration};
}

export function friendlyError(error) {
  const message = String(error.message || error);
  if (/ENOENT/.test(message)) return 'Audio tools are missing. Run npm run setup:media, then restart the app.';
  if (/sign in|bot|429|403|private|unavailable|removed|restricted|not available/i.test(message)) return 'YouTube could not provide this audio (unavailable, restricted, or rate-limited). Try another public video or import a local file.';
  if (/15 minutes|timed out|No audio/.test(message)) return message;
  return 'Could not convert this video. Try another link, update the media tools, or import a local file.';
}

export class MediaLibrary {
  constructor({directory = resolve('.cache/audio'), convert = convertYoutube, maxBytes = 200 * 1024 * 1024, maxAge = 30 * 86400_000} = {}) {
    this.directory = directory; this.convert = convert; this.maxBytes = maxBytes; this.maxAge = maxAge; this.jobs = new Map(); this.busy = false;
  }
  async cached(id) {
    try {
      const file = join(this.directory, `${id}.mp3`); const info = await stat(file);
      if (Date.now() - info.mtimeMs > this.maxAge) return null;
      const meta = JSON.parse(await readFile(join(this.directory, `${id}.json`),'utf8'));
      await utimes(file,new Date(),new Date());
      return {...meta, id, bytes: info.size, audioUrl: `/api/audio/${id}`, status:'ready', message:'Audio ready'};
    } catch { return null; }
  }
  async begin(url) {
    const id = youtubeId(url);
    const cached = await this.cached(id); if (cached) return {...cached,cached:true};
    const existing = this.jobs.get(id); if (existing?.status === 'processing') return existing;
    if (this.busy) { const error = new Error('Another video is converting. Please try again when it finishes.'); error.status = 429; throw error; }
    this.busy = true;
    // Only the latest job is retained; completed audio is persisted separately.
    this.jobs.clear();
    const job = {id,status:'processing',message:'Starting import…'}; this.jobs.set(id,job);
    this.pending = this.process(job); return job;
  }
  async process(job) {
    let temporary;
    try {
      await mkdir(this.directory,{recursive:true}); await this.prune();
      temporary = await mkdtemp(join(this.directory,'work-'));
      const meta = await this.convert(job.id,temporary,message => { job.message = message; });
      const size = (await stat(join(temporary,'audio.mp3'))).size;
      if (!size || size > this.maxBytes) throw new Error('Audio exceeds cache limit.');
      await writeFile(join(temporary,'meta.json'),JSON.stringify(meta));
      await rename(join(temporary,'audio.mp3'),join(this.directory,`${job.id}.mp3`));
      await rename(join(temporary,'meta.json'),join(this.directory,`${job.id}.json`));
      await this.prune(job.id);
      Object.assign(job,await this.cached(job.id));
    } catch (error) { job.status = 'error'; job.message = friendlyError(error); }
    finally { if (temporary) await rm(temporary,{recursive:true,force:true}); this.busy = false; }
  }
  async prune(keep) {
    const names = await readdir(this.directory);
    const files = await Promise.all(names.filter(n => /^[\w-]{11}\.mp3$/.test(n)).map(async name => ({name,...await stat(join(this.directory,name))})));
    files.sort((a,b) => a.mtimeMs - b.mtimeMs); let total = files.reduce((sum,f) => sum + f.size,0);
    for (const file of files) {
      if (file.name === `${keep}.mp3`) continue;
      if (Date.now() - file.mtimeMs > this.maxAge || total > this.maxBytes) { await rm(join(this.directory,file.name),{force:true}); await rm(join(this.directory,file.name.replace('.mp3','.json')),{force:true}); total -= file.size; }
    }
  }
}
