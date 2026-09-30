export interface SoundSettings {
  length: number;
  attack: number;
  release: number;
  level: number;
  pitch: number;
  pan: number;
}
export type SoundKey = keyof SoundSettings;
export type PadSound = Partial<SoundSettings>;
export const DEFAULT_SOUND: SoundSettings = {length: 100, attack: 3, release: 3, level: 100, pitch: 0, pan: 0};

export interface SoundControl {
  key: SoundKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}

export const SOUND_CONTROLS: SoundControl[] = [
  {key: 'length', label: 'Length', unit: '%', min: 0.1, max: 100, step: 0.1},
  {key: 'attack', label: 'Attack', unit: 'ms', min: 0, max: 500, step: 1},
  {key: 'release', label: 'Release', unit: 'ms', min: 0, max: 1000, step: 1},
  {key: 'level', label: 'Level', unit: '%', min: 0, max: 150, step: 1},
  {key: 'pitch', label: 'Pitch', unit: 'st', min: -24, max: 24, step: 1},
  {key: 'pan', label: 'Pan', unit: 'L / R', min: -100, max: 100, step: 1},
];

/** Row (or legacy pad) overrides layered over the global defaults. */
export function effectiveSound(global: SoundSettings, pad: PadSound): SoundSettings {
  return {...global, ...pad};
}

/** Source duration is trimmed before repitching; the envelope is in playback seconds. */
export function voiceShape(sliceDuration: number, settings: SoundSettings) {
  const sourceDuration = Math.min(sliceDuration, Math.max(0.001, sliceDuration * settings.length / 100));
  const rate = 2 ** (settings.pitch / 12);
  const duration = sourceDuration / rate;
  // A short fade is always applied to avoid clicks; attack and release shrink together to fit short voices.
  let attack = Math.max(0.0005, settings.attack / 1000);
  let release = Math.max(0.0005, settings.release / 1000);
  const scale = Math.min(1, duration / (attack + release));
  attack *= scale;
  release *= scale;
  return {sourceDuration, duration, rate, attack, release, gain: 0.25 * settings.level / 100, pan: settings.pan / 100};
}

/** Validate completely before restoring, so malformed imports cannot partially replace a session. */
export function restoreSounds(global: unknown, pads: unknown): {global: SoundSettings; pads: PadSound[]} {
  if (global === undefined && pads === undefined) return {global: {...DEFAULT_SOUND}, pads: Array.from({length: 256}, () => ({}))};
  if (!isSound(global, false) || !Array.isArray(pads) || pads.length !== 256 || !pads.every(pad => isSound(pad, true))) {
    throw new Error('Invalid sound settings');
  }
  return {global: {...DEFAULT_SOUND, ...global}, pads: pads.map(pad => ({...pad}))};
}

/** Every key must be a known control within range; `partial` allows keys to be missing. */
function isSound(value: unknown, partial: boolean): value is PadSound {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const sound = value as Record<string, unknown>;
  if (Object.keys(sound).some(key => !SOUND_CONTROLS.some(control => control.key === key))) return false;
  return SOUND_CONTROLS.every(control => {
    if (partial && !Object.hasOwn(sound, control.key)) return true;
    const setting = sound[control.key];
    return typeof setting === 'number' && Number.isFinite(setting) && setting >= control.min && setting <= control.max;
  });
}

/** Read row overrides and consolidate legacy per-pad overrides without losing row settings. */
export function restoreRowSounds(global: unknown, rows: unknown, legacyPads: unknown): {global: SoundSettings; rows: PadSound[]} {
  const emptyPads = Array.from({length: 256}, () => ({}));
  const defaults = global === undefined ? {...DEFAULT_SOUND} : restoreSounds(global, emptyPads).global;

  if (rows !== undefined) {
    if (legacyPads !== undefined) throw new Error('Ambiguous sound settings');
    // Reuse the 256-pad validator by padding the 16 rows with empty overrides.
    const decoded = restoreSounds(defaults, [...(Array.isArray(rows) ? rows : []), ...Array.from({length: 240}, () => ({}))]);
    if (!Array.isArray(rows) || rows.length !== 16) throw new Error('Invalid row sound settings');
    return {global: decoded.global, rows: decoded.pads.slice(0, 16)};
  }

  // Legacy sessions stored overrides per pad: each row takes the first override found for each control.
  const legacy = restoreSounds(defaults, legacyPads ?? emptyPads).pads;
  const migrated = Array.from({length: 16}, (_, row) => {
    const rowPads = legacy.slice(row * 16, row * 16 + 16);
    const result: PadSound = {};
    for (const control of SOUND_CONTROLS) {
      const existing = rowPads.find(pad => Object.hasOwn(pad, control.key));
      if (existing) result[control.key] = existing[control.key];
    }
    return result;
  });
  return {global: defaults, rows: migrated};
}
