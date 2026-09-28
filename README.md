<p align="center">
  <img src="assets/stepfield-logo.svg" alt="Stepfield" width="280" height="54">
</p>

<p align="center">
  A 16 × 16 audio slice sequencer for turning a recording into a playable pattern.
</p>

<p align="center">
  Built with Angular and the Web Audio API · Runs locally in your browser
</p>

Stepfield divides a recording into 256 slices and maps them to a monome-style grid. Choose the steps that play, shape each sound, and export the result as a WAV or MP3 loop.

## Features

- Import audio from a YouTube link, or load an audio/video file from your device.
- Sequence 256 slices on a responsive 16 × 16 grid, with all enabled steps in a column triggering together.
- Scroll over a row to change its assigned slice, paint steps by dragging, or move an active step within its row with **Shift + drag**.
- Shape sounds with length, attack, release, level, pitch, and pan controls. Set global defaults or per-pad overrides.
- Add step-based pitch, volume, or pan modulation.
- Save patterns and sound settings in the browser, or export and import them as JSON.
- Render the current pattern as a stereo WAV or MP3 loop.

## Run locally

**Requirements:** Node.js 24.15 or newer. Python 3.10+ with `venv` support is needed only to install the YouTube downloader.

```sh
git clone https://github.com/jonobail/stepfield.git
cd stepfield
npm install
npm run setup:media
npm start
```

Open [http://localhost:4200](http://localhost:4200). The start command launches the Angular app and its local media service together. You can skip `npm run setup:media` if you only plan to load files from your device; YouTube import will need it. MP3 export uses the FFmpeg binary installed with the project dependencies.

To serve a production build locally:

```sh
npm run build
npm run serve
```

Then open [http://localhost:3001](http://localhost:3001).

## Make a loop

1. Paste a public YouTube video link and choose **Import YouTube audio**, or choose an audio/video file from your device. Stepfield extracts audio; it does not display video.
2. Tap a pad to turn its step on or off. When stopped, turning a step on also previews its slice. While playing, edits take effect at the next step trigger. Drag across pads to paint a run of steps.
3. Press **Play**. The playhead moves across 16 columns and loops. Pads in the same column sound together, and their tails can overlap later steps.
4. Adjust the tempo and master volume in the playback bar. Use **Clear pattern** to remove active steps without resetting your sound settings.
5. Choose **Download loop · WAV** or **Download loop · MP3** in Session. The render uses the active pattern, row slices, tempo, volume, sound settings, and modulation.

Press **Space** to start or stop playback. The shortcut is ignored while typing in a field.

## Shape and modulate sounds

In **Select steps** mode, pads control the pattern. **Edit sound** mode lets you select a pad without changing its on/off state. The Sound panel offers **All pads** defaults and **Selected pad** overrides. Each pad inherits global settings until you change one of its controls; use **Use global** or **Reset pad to global** to remove overrides.

Length trims playback from the start of the assigned slice. Pitch shifts playback speed as well as pitch. Attack and release shape the note envelope; level is per voice, and pan positions it in the stereo field. A small edge fade helps prevent clicks.

Modulation can vary pitch, volume, or pan on each newly triggered step. Choose a sine, triangle, or square shape, a cycle from a quarter note to four bars, and a depth. Modulation is sampled at each step; it does not sweep through notes that are already playing.

## Patterns and audio storage

Patterns, row slice assignments, tempo, volume, sound settings, and modulation are saved in this browser. **Export pattern** downloads a JSON session that does not contain audio. Importing that file restores the pattern and settings; load the matching recording separately.

YouTube audio is cached on this computer in `.cache/audio` so it can be reloaded later. The cache is limited to 200 MB, entries expire after 30 days, and imports prune expired or older files. Local files remain in memory and are not cached. Stepfield currently loads one source recording at a time.

## Limits and hosting

YouTube import and MP3 conversion use the local Node media service. That service downloads audio with [yt-dlp](https://github.com/yt-dlp/yt-dlp) and converts it with FFmpeg; YouTube imports are limited to 15 minutes and files larger than 150 MB are rejected. Decoded audio may use much more memory than the original file. YouTube availability, browser codec support, and background-tab scheduling can also affect playback.

GitHub Pages can host the Angular files, but it cannot run this Node media service. A Pages-only deployment would not support YouTube import, cached-track management, or MP3 conversion. Run Stepfield locally for the full workflow; a live deployment needs a separately hosted media backend.

Use recordings you have permission to sample. The app does not use YouTube cookies or account credentials.

## Development checks

```sh
npm run check       # TypeScript check
npm test            # Unit and media-service tests
npm run build       # Production Angular build
```

Browser tests use Playwright and Chromium:

```sh
npx playwright install --with-deps chromium
npm run test:browser
```
