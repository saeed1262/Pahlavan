// Reads what the reminders and the Habits section need, through the same
// read-only I/O as the vault adapter: Pahlavan's Coach files (tracking,
// reminder state, sitting), the body record, the linked habits, the
// dated photo folders, and, read only, Habit Nudges' settings (for the
// bring-over) and the work timer (desk time, the sitting history); and, for
// the CLI, Pahlavan's own quiet hours and "Did you train today?" time. One
// pure assembly for both readers, like read.ts.

import { validateNudges, validateSitting, validateTracking } from '../../core/validate.ts';
import { DEFAULT_NUDGE_SETTINGS, PLUGIN_QUIET_HOURS, type NudgeSettings } from '../../core/nudges.ts';
import type { NudgeState, SittingLog, Tracking } from '../../core/schema.ts';
import { habitsView, type HabitsView } from '../../core/tracking.ts';
import type { VaultWarning } from './convert.ts';
import { joinPath, type AsyncReadIo, type ReadIo } from './read.ts';
import { paths } from './layout.ts';

/**
 * The files read here: the tracking, reminder and sitting files, the body
 * record and the habit check-ins at the vault's layout (`paths()`); Habit
 * Nudges' settings under the config folder (read for the bring-over only);
 * the work timer, when the vault has one (read for desk time's history
 * only; Pahlavan never writes it).
 */
export type TrackingFileKey = 'tracking' | 'nudges' | 'sitting' | 'body' | 'habits' | 'nudgesSettings' | 'workTimer';

/** Habit Nudges' data.json, relative to the vault's config folder. */
export const NUDGES_SETTINGS_FILE = 'plugins/habit-nudges/data.json';

/** Habit Nudges' data.json under the vault's config folder (the app's own setting; the CLI passes the usual one). */
export const nudgesSettingsPath = (configDir: string): string => `${configDir.replace(/\/+$/, '')}/${NUDGES_SETTINGS_FILE}`;

/** Where each file is read from, the settings file under the config folder. */
function pathOf(key: TrackingFileKey, configDir: string | undefined): string | null {
  if (key === 'nudgesSettings') return configDir ? nudgesSettingsPath(configDir) : null;
  return paths()[key];
}
export const TRACKING_FILE_KEYS: readonly TrackingFileKey[] = ['tracking', 'nudges', 'sitting', 'body', 'habits', 'nudgesSettings', 'workTimer'];

export interface TrackingRead {
  tracking: Tracking | null;
  nudges: NudgeState | null;
  sitting: SittingLog | null;
  /** body-data.json, parsed (the reminder rules read checkedAt and the entry dates). */
  body: unknown;
  habits: HabitsView | null;
  nudgesSettings: unknown;
  workTimer: unknown;
  photoFolders: string[];
  files: Record<TrackingFileKey, 'found' | 'missing' | 'invalid'>;
  warnings: VaultWarning[];
  /** Pahlavan's own files that are unreadable or invalid (nothing is written to them until fixed). */
  errors: VaultWarning[];
}

/** The texts (null: missing) and the photo folder's names into what the rules read. Pure. */
export function assembleTracking(texts: Readonly<Partial<Record<TrackingFileKey, string | null>>>, photoNames: readonly string[] | null): TrackingRead {
  const files = {} as TrackingRead['files'];
  const warnings: VaultWarning[] = [];
  const errors: VaultWarning[] = [];
  const parse = (key: TrackingFileKey): unknown => {
    const t = texts[key] ?? null;
    files[key] = t === null ? 'missing' : 'found';
    if (t === null) return undefined;
    try {
      return JSON.parse(t) as unknown;
    } catch (e) {
      files[key] = 'invalid';
      const msg = { code: 'json', message: `${key === 'nudgesSettings' ? "Habit Nudges' data.json" : paths()[key]} is not valid JSON: ${(e as Error).message}` };
      (['tracking', 'nudges', 'sitting'].includes(key) ? errors : warnings).push(msg);
      return undefined;
    }
  };
  const own = <T>(key: 'tracking' | 'nudges' | 'sitting', validate: (v: unknown) => { path: string; message: string }[]): T | null => {
    const v = parse(key);
    if (v === undefined) return null;
    const errs = validate(v);
    if (errs.length) {
      files[key] = 'invalid';
      errors.push({ code: key, message: `${paths()[key]} is invalid: nothing is written to it until it is fixed.`, items: errs.slice(0, 20).map((e) => `${e.path}: ${e.message}`) });
      return null;
    }
    return v as T;
  };
  const tracking = own<Tracking>('tracking', validateTracking);
  const nudges = own<NudgeState>('nudges', validateNudges);
  const sitting = own<SittingLog>('sitting', validateSitting);
  const body = parse('body');
  const habitsRaw = parse('habits');
  const habits = habitsView(habitsRaw);
  if (files.habits === 'found' && !habits) warnings.push({ code: 'habits', message: `${paths().habits} is not a JSON object: linked habits are not read.` });
  for (const id of new Set((tracking?.items ?? []).map((x) => x.habit).filter((h): h is string => Boolean(h)))) {
    if (habits && !habits.habits.some((h) => h.id === id)) warnings.push({ code: 'unknown-habit', message: `A tracked item links to the habit "${id}", which habits-data.json does not list: its ticks go nowhere.` });
  }
  return {
    tracking,
    nudges,
    sitting,
    body: body ?? null,
    habits,
    nudgesSettings: parse('nudgesSettings') ?? null,
    workTimer: parse('workTimer') ?? null,
    photoFolders: (photoNames ?? []).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort(),
    files,
    warnings,
    errors,
  };
}

/** Pahlavan's own settings (the plugin's data.json) under the vault's config folder: read for the quiet hours and the "Did you train today?" card only. */
export const pahlavanSettingsPath = (configDir: string): string => `${configDir.replace(/\/+$/, '')}/plugins/pahlavan/data.json`;

/** The quiet hours Pahlavan holds every card in: from the plugin's settings, or its defaults when the file is not there. */
export interface QuietHours {
  on: boolean;
  from: string;
  to: string;
  source: 'settings' | 'default';
}

/** A time as the plugin's settings take it ("HH:MM", two digits each). */
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The quiet hours in the plugin's data.json text (null: not there), each
 * field as the plugin loads it (`reminders.quiet`: a missing or malformed
 * field takes its default), else the plugin's defaults. With them, the
 * "Did you train today?" card as the plugin loads it (`reminders.didYouTrain`
 * and `didYouTrainAt`), whose time the quiet hours may hold. Pure.
 */
export function quietHoursFrom(text: string | null): { hours: QuietHours; didYouTrain: NudgeSettings['didYouTrain']; warnings: VaultWarning[] } {
  const def: QuietHours = { ...PLUGIN_QUIET_HOURS, source: 'default' };
  const train = { ...DEFAULT_NUDGE_SETTINGS.didYouTrain };
  if (text === null) return { hours: def, didYouTrain: train, warnings: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (e) {
    return { hours: def, didYouTrain: train, warnings: [{ code: 'json', message: `Pahlavan's data.json is not valid JSON: the quiet hours are read as the default, ${def.from} to ${def.to}. ${(e as Error).message}` }] };
  }
  const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const rem = obj(obj(raw)['reminders']);
  const q = obj(rem['quiet']);
  const time = (v: unknown, fallback: string) => (typeof v === 'string' && TIME.test(v) ? v : fallback);
  return {
    hours: { on: typeof q['on'] === 'boolean' ? q['on'] : def.on, from: time(q['from'], def.from), to: time(q['to'], def.to), source: 'settings' },
    didYouTrain: { on: typeof rem['didYouTrain'] === 'boolean' ? rem['didYouTrain'] : train.on, at: time(rem['didYouTrainAt'], train.at) },
    warnings: [],
  };
}

/** Reads the plugin's quiet hours (and the "Did you train today?" card) under the vault's config folder. */
export function readQuietHours(io: ReadIo, root: string, configDir: string): { hours: QuietHours; didYouTrain: NudgeSettings['didYouTrain']; warnings: VaultWarning[] } {
  return quietHoursFrom(io.readText(joinPath(root, pahlavanSettingsPath(configDir))));
}

/** Reads the files; Habit Nudges' settings only with the vault's config folder (`configDir`). */
export function readTracking(io: ReadIo, root: string, opts: { configDir?: string } = {}): TrackingRead {
  const texts: Partial<Record<TrackingFileKey, string | null>> = {};
  for (const k of TRACKING_FILE_KEYS) {
    const p = pathOf(k, opts.configDir);
    texts[k] = p === null ? null : io.readText(joinPath(root, p));
  }
  return assembleTracking(texts, io.listDir(joinPath(root, paths().photos)));
}

export async function readTrackingAsync(io: AsyncReadIo, root: string, opts: { configDir?: string } = {}): Promise<TrackingRead> {
  const texts: Partial<Record<TrackingFileKey, string | null>> = {};
  await Promise.all(
    TRACKING_FILE_KEYS.map(async (k) => {
      const p = pathOf(k, opts.configDir);
      texts[k] = p === null ? null : await io.readText(joinPath(root, p));
    }),
  );
  return assembleTracking(texts, await io.listDir(joinPath(root, paths().photos)));
}
