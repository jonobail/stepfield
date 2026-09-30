import { restoreModulation, type Modulation } from '../modulation';
import { restoreRowSounds, type PadSound, type SoundSettings } from '../sampler';
import { PAD_COUNT, ROW_COUNT, padIndex, rowOf } from '../sequencer';
import { SLICE_COUNT, restoreSliceState, type SliceState } from '../slices';

const STORAGE_KEY = 'stepfield-session-v1';
const LEGACY_STORAGE_KEY = 'grid256-audio-v1';

/** Everything a pattern needs apart from the audio itself. */
export interface SessionState {
  sliceState: SliceState | null;
  sourceDuration?: number;
  pattern: boolean[];
  rowSamples: number[];
  bpm: number;
  volume: number;
  sourceName: string;
  /** YouTube video id when the audio came from the media service, otherwise empty. */
  sourceId: string;
  globalSound: SoundSettings;
  rowSounds: PadSound[];
  modulation: Modulation;
}

/**
 * Version history:
 * 1 · per-pad samples, no slice state
 * 2 · adds editable slice boundaries and per-pad sounds
 * 3 · sounds and source slices are shared per row
 */
export function serializeSession(state: SessionState) {
  return {
    version: 3,
    sliceState: state.sliceState,
    sourceDuration: state.sourceDuration,
    pattern: state.pattern,
    rowSamples: state.rowSamples,
    // Kept for older builds, which read per-pad assignments.
    sampleAssignments: Array.from({length: PAD_COUNT}, (_, index) => state.rowSamples[rowOf(index)]),
    bpm: state.bpm,
    volume: state.volume,
    source: state.sourceName,
    sourceId: state.sourceId,
    globalSound: state.globalSound,
    rowSounds: state.rowSounds,
    modulation: state.modulation,
  };
}

type StoredSession = Partial<ReturnType<typeof serializeSession>> & {padSounds?: unknown};

/** Validate an untrusted stored or imported session completely; throws without side effects if anything is invalid. */
export function parseSession(data: unknown): SessionState {
  const stored = data as StoredSession;
  if (!stored || (stored.version !== 1 && stored.version !== 2 && stored.version !== 3)) throw new Error('Invalid pattern');
  const {version} = stored;

  const pattern = stored.pattern;
  if (!Array.isArray(pattern) || pattern.length !== PAD_COUNT || !pattern.every(value => typeof value === 'boolean')) throw new Error('Invalid pattern');
  if (!isNumberInRange(stored.bpm, 30, 300) || !isNumberInRange(stored.volume, 0, 100)) throw new Error('Invalid pattern');

  // Version 1 sessions predate sample assignments: each row played the slice matching its first pad.
  const padSamples = stored.sampleAssignments ?? Array.from({length: PAD_COUNT}, (_, index) => padIndex(rowOf(index), 0));
  if (!isSliceList(padSamples, PAD_COUNT)) throw new Error('Invalid sample assignments');
  const rowSamples = stored.rowSamples ?? Array.from({length: ROW_COUNT}, (_, row) => padSamples[padIndex(row, 0)]);
  if (!isSliceList(rowSamples, ROW_COUNT)) throw new Error('Invalid row sounds');

  const sliceState = restoreSliceState(version === 1 ? 1 : 2, stored.sliceState);
  if (stored.sourceDuration !== undefined && !isNumberInRange(stored.sourceDuration, 0, Infinity)) throw new Error('Invalid source duration');
  if ((version === 3) !== (stored.rowSounds !== undefined)) throw new Error('Invalid row sound settings');
  const sounds = restoreRowSounds(stored.globalSound, stored.rowSounds, stored.padSounds);
  const modulation = restoreModulation(stored.modulation);

  return {
    sliceState,
    sourceDuration: stored.sourceDuration,
    pattern: [...pattern],
    rowSamples: [...rowSamples],
    bpm: stored.bpm,
    volume: stored.volume,
    sourceName: typeof stored.source === 'string' ? stored.source.slice(0, 200) : '',
    sourceId: typeof stored.sourceId === 'string' && /^[\w-]{11}$/.test(stored.sourceId) ? stored.sourceId : '',
    globalSound: sounds.global,
    rowSounds: sounds.rows,
    modulation,
  };
}

/** Returns the parsed JSON of the last saved session, or null. May throw if storage or JSON is unreadable. */
export function readSavedSession(): unknown {
  const saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
  return saved ? JSON.parse(saved) : null;
}

export function writeSavedSession(state: SessionState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeSession(state)));
}

function isNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isSliceList(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(slice => Number.isInteger(slice) && slice >= 0 && slice < SLICE_COUNT);
}
