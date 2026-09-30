/**
 * Client for the self-hosted media service in server/index.mjs.
 * Only used when `environment.mediaService` is true.
 */

export interface ImportJob {
  id: string;
  status: 'processing' | 'ready' | 'error';
  message: string;
  title: string;
  bytes: number;
  cached?: boolean;
}

export interface CachedTrack {
  id: string;
  title: string;
  duration: number | null;
  bytes: number;
  modified: number;
}

const POLL_INTERVAL_MS = 700;

/** Start a YouTube import and poll until the server has converted and cached the audio. */
export async function importYoutubeAudio(url: string, signal: AbortSignal, onProgress: (message: string) => void): Promise<ImportJob> {
  let job = await readJob(await fetch('/api/youtube', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({url}),
    signal,
  }));
  while (job.status === 'processing') {
    onProgress(job.message);
    await delay(POLL_INTERVAL_MS, signal);
    job = await readJob(await fetch(`/api/youtube/${job.id}`, {signal}));
  }
  if (job.status !== 'ready') throw new Error(job.message || 'Audio import failed.');
  return job;
}

export async function fetchCachedAudio(id: string, expiredMessage: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(`/api/audio/${id}`, {signal});
  if (!response.ok) throw new Error(expiredMessage);
  return response.arrayBuffer();
}

export async function listCachedTracks(): Promise<{tracks: CachedTrack[]; totalBytes: number}> {
  const response = await fetch('/api/storage');
  if (!response.ok) throw new Error('Could not read audio storage.');
  return response.json();
}

export async function deleteCachedTrack(id: string) {
  const response = await fetch(`/api/storage/${id}`, {method: 'DELETE'});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not remove cached audio.');
}

export async function encodeMp3(wav: ArrayBuffer): Promise<Blob> {
  const response = await fetch('/api/encode-mp3', {method: 'POST', headers: {'Content-Type': 'audio/wav'}, body: wav});
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'MP3 conversion failed. Try downloading the WAV.');
  }
  return response.blob();
}

async function readJob(response: Response): Promise<ImportJob> {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Audio service unavailable. Restart the app with npm start.');
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Audio service unavailable. Restart with npm start.');
  return data;
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new Error('Import cancelled or timed out.'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, {once: true});
    if (signal.aborted) abort();
  });
}
