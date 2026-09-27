import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const windows = process.platform === 'win32';
function run(command,args) { const result = spawnSync(command,args,{stdio:'inherit'}); if (result.error || result.status !== 0) { console.error(result.error?.message || 'Media setup failed. Install Python 3.10+ with venv support and retry.'); process.exit(1); } }
run(process.env.PYTHON || (windows ? 'python' : 'python3'),['-m','venv','--clear','.tools/yt-dlp']);
run(resolve('.tools/yt-dlp',windows ? 'Scripts/python.exe' : 'bin/python'),['-m','pip','install','--upgrade','yt-dlp[default]']);
console.log('YouTube audio tools ready.');
