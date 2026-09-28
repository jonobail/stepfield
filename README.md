<p align="center">
  <img src="assets/stepfield-logo.svg" alt="Stepfield" width="240" height="46">
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
- Choose a row’s sound with the Source slice dropdown, paint steps by dragging, or move an active step within its row with **Shift + drag**.
- Shape sounds with length, attack, release, level, pitch, and pan controls. Set global defaults or overrides shared across a row.
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

## Edit source slices

The **Row** and **Source slice** dropdowns stay visible above the grid, so you can change a row’s sound at any time, including during playback. Expand **Waveform & boundaries** to see and edit the recording. Its waveform comes from the loaded audio and shows all 256 slice boundaries. The highlighted slice belongs to the selected row; selecting another pad in that row keeps the same source slice.

Click the waveform, or choose a **Source slice** from the dropdown, to assign a slice to all 16 pads in that row. While stopped, the selection also previews the sound. **▶ Slice** auditions it with that row's sound settings and modulation; **▶ Raw** plays the original slice with a short anti-click fade.

- **Beat** uses the automatic beat grid, with even divisions when the recording is too short for 256 beat-grid slices.
- **Transient** places boundaries at prominent attacks and subdivides longer gaps to retain 256 slices.
- **Equal** divides the recording evenly.
- **Manual** starts from the current boundaries. Drag either highlighted edge or a marker at the top of the waveform. You can also edit **Start** and **End** numerically. The recording's first and last boundaries stay fixed, and neighboring slices cannot overlap.

Use **+ / −** to zoom, **Fit** for the full recording, and **Locate** to focus on the selected slice. Drag the waveform away from a boundary, Shift-drag, or use the Position slider to pan. Horizontal trackpad scrolling and Shift-wheel also pan; Ctrl/⌘-wheel zooms at the pointer.

**Reset slices** restores the last automatic slicing method. Replacing manual edits asks for confirmation inline. Slice edits affect preview, sequencing, and WAV/MP3 exports, and are included in saved patterns and JSON exports. After a browser reload, cached YouTube audio restores automatically; reimport the same local file to hear its saved edits. Loading a different recording generates fresh slices.

## Shape and modulate sounds

Use the **Grid action** dropdown to choose **Toggle steps** for changing the pattern or **Select pad** to inspect a pad without changing its on/off state. Source slice selection is available with either grid action. The Sound panel offers **All pads** defaults and **Selected row** overrides. Every pad in the selected row uses the same sound settings, and each control inherits its global value until you override it. Use **Use global** or **Reset row to global** to remove row overrides.

Length trims playback from the start of the assigned slice. Pitch shifts playback speed as well as pitch. Attack and release shape the note envelope; level is per voice, and pan positions it in the stereo field. A small edge fade helps prevent clicks.

Modulation can vary pitch, volume, or pan on each newly triggered step. Choose a sine, triangle, or square shape, a cycle from a quarter note to four bars, and a depth. Modulation is sampled at each step; it does not sweep through notes that are already playing.

## Patterns and audio storage

Patterns, source slice boundaries, row slice assignments, tempo, volume, sound settings, and modulation are saved in this browser. **Export pattern** downloads a JSON session that does not contain audio. Importing that file restores the pattern and settings; load the matching recording separately.

YouTube audio is cached on this computer in `.cache/audio` so it can be reloaded later. The cache is limited to 200 MB, entries expire after 30 days, and imports prune expired or older files. Local files remain in memory and are not cached. Stepfield currently loads one source recording at a time.

## Audio notes

YouTube import and MP3 conversion use the local Node media service. That service downloads audio with [yt-dlp](https://github.com/yt-dlp/yt-dlp) and converts it with FFmpeg; YouTube imports are limited to 15 minutes and files larger than 150 MB are rejected. Decoded audio may use much more memory than the original file. YouTube availability, browser codec support, and background-tab scheduling can also affect playback.

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
