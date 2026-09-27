# Stepfield

An audio-only 16 × 16 slice sequencer built with Angular 22 and Web Audio.

## Run

Requires Node 24.15+ (tested with Node 24.21) and Python 3.10+ with venv support for YouTube imports.

```sh
npm install
npm run setup:media
npm start
```

Open http://localhost:4200. `npm run build` creates `dist/stepfield/browser`; `npm run check` checks TypeScript. `npm test` checks the API, cache, real MP3 conversion, slice boundaries, and column mapping. `npm start` launches both Angular and the local audio service. Restart it after updating from the frontend-only version. For the built app, run `npm run build` then `npm run serve` and open http://localhost:3001.

Browser tests: run `npx playwright install --with-deps chromium`, `npm run build`, then `npm run test:browser`.

## Play

1. Paste a YouTube video link and click Import YouTube audio, or import a local audio/video file. YouTube imports show download/conversion status, then fill the grid with slices. Local files stay in your browser. No video is displayed. WAV and MP3 are good local fallbacks when a video codec is unsupported.
2. The entire audio track is divided into 256 equal slices (within one audio frame). Slice 1 is top left, slice 16 is top right, slice 17 starts the next row, and slice 256 is bottom right.
3. Click a square in Select steps mode to enable it and hear its slice while stopped. Turning a step off does not cut off its preview. While playing, clicks change the pattern; newly enabled slices join when their column next triggers. Use Edit sound to select a pad without changing the pattern, then Preview slice to hear it.
4. Press Play. The playhead sweeps left to right over 16 sixteenth-note columns and loops. All enabled squares in a column start simultaneously. Each slice plays for its configured length, overlapping other slices and subsequent loops.
5. Set tempo (30–300 BPM) and volume above the grid. Press **Space** to start/stop (ignored while typing or editing inputs, and on links or disclosure controls). Stop silences all voices and resets the playhead. Clear pattern, in Session, also stops playback.

The sidebar shows one compact panel at a time: **Source** for imports, **Sound** for sample controls, **Mod** for tempo-synced step modulation, and **Session** for pattern import/export and clearing. Importing audio opens Sound automatically. Edit sound also opens the selected pad’s controls. The flat square pads use a blue-grey palette. One playhead overlay and targeted light updates minimize grid redraws.

Audio uses clock-scheduled Web Audio sources, short edge fades, headroom, and a dynamics compressor. The full-height playhead marker follows the audio clock. Pattern edits reconcile already queued notes that have not started, so enabling/disabling a square just before a column arrives changes that event. Tempo changes affect unscheduled steps; up to 100 ms may already be scheduled. Background-tab throttling can interrupt scheduling; missed steps are skipped rather than replayed in a burst.

Pattern, sound controls, and tempo/volume settings save locally. JSON import/export contains the pattern, settings, and source filename, **not audio**. After reload, use Reload saved YouTube audio to fetch the cached recording (or download it again if evicted). Local recordings need to be reimported. Legacy YouTube cue sessions are not compatible and their storage is left intact.

## Media limitations

One source recording fills the grid at a time. Files over 150 MB are rejected; decoded audio can use substantially more memory than the compressed file, so use short recordings. Compression does not reduce the decoded playback buffer. Local video decoding support depends on the browser. Import local audio/video you have permission to use. Google Fonts supplies interface fonts.

## Sample shaping

The Sound panel has **All pads** (global defaults) and **Selected pad** scopes. Use **Edit sound** above the grid to select a pad without changing its active step. Preview and sequencer playback use the same sound settings.

- **Length:** 0.1–100% of the original slice, with the resulting playback duration in milliseconds. The lower bound is 1 ms unless the slice itself is shorter. Blip sets approximately 10 ms of source audio; Full slice restores 100%.
- **Attack / release:** fade-in and fade-out in milliseconds, fitted inside the playback window. A tiny edge fade remains at zero to reduce clicks.
- **Level:** 0–150% per voice, separate from master volume.
- **Pitch:** ±24 semitones, using classic sampler repitching (pitch changes playback speed and duration).
- **Pan:** −100 left through centre to +100 right.

Each pad inherits every global control independently. Changing only its length leaves its pitch, level, pan, and envelope following the global defaults. Use the individual Use global buttons or Reset pad to global to remove overrides. Reset global defaults does not erase pad overrides. Length trims from the beginning of the assigned slice; it never reads into the next slice.

Changes apply to the next trigger, including queued notes that have not started. Sounding tails retain their original settings. Settings persist on reload and travel with JSON exports; older patterns load with full-length slices and default sound controls. Clear pattern clears active steps, retaining sound settings.

## Step modulation

Open **Mod** and enable modulation to vary **pitch**, **volume**, or **pan** across newly triggered slices. Choose sine, triangle, or square shape, a cycle from a quarter note to four bars, and depth from 0–100%. This is step-sampled modulation: values are evaluated when each column triggers and held for that slice, rather than sweeping continuously through already playing audio. Pads in the same column share a modulation phase while retaining their individual settings.

Pitch depth reaches ±12 semitones, with the final pitch limited to ±24; it changes playback duration as well as pitch. Volume modulation attenuates the existing pad level without boosting it. Pan offsets are limited to the left/right bounds. The phase resets when Play starts and continues across grid loops, so two- and four-bar cycles span multiple passes. Preview uses the starting phase. Modulation is off by default and saved with patterns; older patterns retain their sound.

## YouTube audio storage

The local Node service uses [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation) to download audio and FFmpeg to convert it to 96 kbps, 32 kHz stereo MP3 (about 0.72 MB per minute). It caches a single file per video in `.cache/audio`; slices reference offsets in one decoded browser buffer rather than creating 256 files. Temporary downloads are removed after conversion. Repeat imports reuse the cache. Cached audio is limited to 200 MB and 30 days since last use; expired and oldest entries are pruned during imports. YouTube imports are capped at 15 minutes to bound decoded memory, and only one conversion runs at a time.

The service binds to localhost and validates video links before invoking tools without a shell. YouTube unavailable/private/restricted videos and rate limits produce an import error; local import remains available. No cookies or account credentials are used. Run `npm run setup:media` again to update yt-dlp if YouTube changes. FFmpeg is supplied by `ffmpeg-static`; `YT_DLP_PATH` and `FFMPEG_PATH` can override tool locations. Use audio you have permission to sample.

## Manual playback check

Import a known recording, audition the first and last slices, enable multiple squares in one column, and verify simultaneous playback. Enable another column and confirm tails overlap. Change BPM while playing, verify wrapping after column 16, and verify Stop immediately silences playback. Reload and reimport audio to verify pattern persistence. Try an unsupported file and a JSON export/import round trip. Live audio and codec behavior require browser testing.
