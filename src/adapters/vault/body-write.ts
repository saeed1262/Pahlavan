// The morning check-in into body-data.json, field by field, and the body
// record (the tape, the fitness tests, the photo index) the same way. The
// file is shared: the Habit Nudges plugin writes the same days (with its own
// fields, such as checkedAt), the tape, the tests and the photo index, and
// the dashboard reads them. Only the fields a form changed are written;
// every other field, entry and day stays as it is on disk. Pure: the plugin
// reads and writes the file.

import { addDays, isIsoDate } from '../../core/dates.ts';
import { MORNING_KEYS, MORNING_LIMITS, YESTERDAY_KEYS, type MorningKey } from '../../core/morning.ts';
import type { IsoDate, SorenessLevel } from '../../core/schema.ts';
import { applySore } from './log-write.ts';
import { paths } from './layout.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const pretty = (o: unknown) => JSON.stringify(o, null, 2);

// The fields, their limits and the day-before rule live in the core, where the phone's morning entry is checked too.
export { MORNING_KEYS, MORNING_LIMITS, YESTERDAY_KEYS, type MorningKey };
export type MorningValues = Partial<Record<MorningKey, number | null>>;

/**
 * The day a field is stored on. "Steps yesterday" and "Floors yesterday"
 * belong to yesterday, as Habit Nudges stores them (and as the engine reads
 * a day's steps and floors); the rest to the check-in's day.
 */
export const dayOfField = (key: MorningKey, date: IsoDate): IsoDate => (YESTERDAY_KEYS.includes(key) ? addDays(date, -1) : date);

/** Out-of-range or malformed values, in words (empty when all are fine). */
export function validateMorning(values: MorningValues): string[] {
  const out: string[] = [];
  for (const k of MORNING_KEYS) {
    const v = values[k];
    if (v === undefined || v === null) continue;
    const lim = MORNING_LIMITS[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) out.push(`${lim.label} is not a number`);
    else if (v < lim.min || v > lim.max) out.push(`${lim.label} is between ${lim.min} and ${lim.max}`);
    else if (lim.int && !Number.isInteger(v)) out.push(`${lim.label} is a whole number`);
  }
  return out;
}

/** The morning fields as body-data.json holds them for `date` (steps from yesterday). */
export function morningFrom(doc: unknown, date: IsoDate): { values: Record<MorningKey, number | null>; checkedAt: string | null } {
  const days = isObj(doc) && isObj(doc['days']) ? doc['days'] : {};
  const at = (d: IsoDate): Obj => (isObj(days[d]) ? (days[d]) : {});
  const values = {} as Record<MorningKey, number | null>;
  for (const k of MORNING_KEYS) {
    const v = at(dayOfField(k, date))[k];
    values[k] = typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  const c = at(date)['checkedAt'];
  return { values, checkedAt: typeof c === 'string' ? c : null };
}

export interface MorningChange {
  /** The fields the form changed (null clears one). */
  values: MorningValues;
  /** The same fields as the form first read them: a field that changed on disk since then is a conflict. */
  baseline: MorningValues;
  /** Sore muscles that changed (engine ids or body-map slugs; null clears one). */
  sore?: Readonly<Record<string, SorenessLevel | null>>;
  /** Write over a field that changed on disk since the form read it. */
  force?: boolean;
  /**
   * The save's time (an ISO timestamp, as Habit Nudges writes it): set as the
   * day's `checkedAt` when the day has none, so Habit Nudges' prompt and
   * Isfahan's Check-in ring see the day as checked in. An existing one stays.
   */
  checkedAt?: string;
}

export interface MorningConflict {
  key: MorningKey;
  disk: number | null;
  baseline: number | null;
  mine: number | null;
}

export type MorningMerge =
  | { result: 'merged'; text: string; changed: MorningKey[]; sore: boolean; stamped: boolean }
  | { result: 'unchanged' }
  | { result: 'conflict'; conflicts: MorningConflict[] }
  | { result: 'invalid'; errors: string[] }
  | { result: 'unreadable'; error: string };

/**
 * body-data.json with the morning check-in merged in, per field: a field the
 * form changed is set (or removed, for null) on its day; nothing else moves,
 * so another writer's fields (Habit Nudges' checkedAt) and days stay.
 * A field that someone else changed since the form read it (disk differs from
 * the baseline and from the new value) is a conflict, unless `force`. A
 * missing file starts a new one; an unreadable one is left alone.
 */
export function mergeMorning(text: string | null, date: IsoDate, change: MorningChange): MorningMerge {
  const errors = validateMorning(change.values);
  if (errors.length) return { result: 'invalid', errors };
  let doc: unknown = { days: {} };
  if (text !== null) {
    try {
      doc = JSON.parse(text);
    } catch {
      return { result: 'unreadable', error: 'body-data.json is not valid JSON' };
    }
  }
  if (!isObj(doc)) return { result: 'unreadable', error: 'body-data.json is not a JSON object' };
  if (doc['days'] !== undefined && !isObj(doc['days'])) return { result: 'unreadable', error: 'body-data.json has a "days" that is not an object' };
  const days = isObj(doc['days']) ? doc['days'] : (doc['days'] = {});
  const disk = morningFrom(doc, date).values;

  const keys = MORNING_KEYS.filter((k) => change.values[k] !== undefined);
  const conflicts: MorningConflict[] = [];
  for (const k of keys) {
    const mine = change.values[k] ?? null;
    const base = change.baseline[k] ?? null;
    if (disk[k] !== base && disk[k] !== mine) conflicts.push({ key: k, disk: disk[k], baseline: base, mine });
  }
  if (conflicts.length && !change.force) return { result: 'conflict', conflicts };

  const touched = new Map<IsoDate, Obj>();
  const dayObj = (d: IsoDate): Obj => {
    if (!touched.has(d)) touched.set(d, isObj(days[d]) ? { ...(days[d]) } : {});
    return touched.get(d)!;
  };
  const changed: MorningKey[] = [];
  for (const k of keys) {
    const mine = change.values[k] ?? null;
    if (disk[k] === mine) continue;
    const day = dayObj(dayOfField(k, date));
    if (mine === null) delete day[k];
    else day[k] = mine;
    changed.push(k);
  }
  const sore = change.sore && Object.keys(change.sore).length ? applySore(dayObj(date), change.sore) : false;
  if (!changed.length && !sore) return { result: 'unchanged' };
  let stamped = false;
  if (change.checkedAt) {
    const today = dayObj(date);
    if (typeof today['checkedAt'] !== 'string') {
      today['checkedAt'] = change.checkedAt;
      stamped = true;
    }
  }
  for (const [d, obj] of touched) {
    if (Object.keys(obj).length) days[d] = obj;
    else delete days[d];
  }
  return { result: 'merged', text: pretty(doc), changed, sore, stamped };
}

// ---------------------------------------------------------------- the body record

/** One field of the tape or the tests: a number in range (whole for a step of 1 or more), or free text. */
export interface RecordField {
  id: string;
  label: string;
  unit?: string;
  min?: number;
  max?: number;
  int?: boolean;
  text?: boolean;
}

/** Habit Nudges' tape fields and limits (cm). */
export const TAPE_FIELDS: readonly RecordField[] = [
  { id: 'waist', label: 'Waist', unit: 'cm', min: 40, max: 200 },
  { id: 'hips', label: 'Hips', unit: 'cm', min: 40, max: 200 },
  { id: 'chest', label: 'Chest', unit: 'cm', min: 40, max: 200 },
  { id: 'arm', label: 'Arm', unit: 'cm', min: 15, max: 70 },
];

/** Habit Nudges' eight fitness tests and their limits; two are free text. */
export const TEST_FIELDS: readonly RecordField[] = [
  { id: 'pushups', label: 'Push-ups', unit: 'reps', min: 0, max: 200, int: true },
  { id: 'pullups', label: 'Pull-ups', unit: 'reps', min: 0, max: 60, int: true },
  { id: 'pullupLevel', label: 'Pull-up level', text: true },
  { id: 'hollowS', label: 'Hollow hold', unit: 's', min: 0, max: 600, int: true },
  { id: 'sidePlankS', label: 'Side plank', unit: 's/side', min: 0, max: 600, int: true },
  { id: 'handstandS', label: 'Handstand hold', unit: 's', min: 0, max: 600, int: true },
  { id: 'wallGapCm', label: 'Wall test', unit: 'cm', min: 0, max: 30 },
  { id: 'pistol', label: 'Pistol squat', text: true },
];

/** The progress-photo poses, in order (Habit Nudges' POSES). */
export const POSES = [
  { id: 'front', name: 'Front' },
  { id: 'side', name: 'Side' },
  { id: 'back', name: 'Back' },
  { id: 'posture-closeup', name: 'Posture close-up' },
] as const;

/** Where the photos go: <the layout's photos folder>/<date>/<pose>.jpeg, converted and resized to this on the long side. */
export const PHOTO_MAX_PX = 1600;
export const photoPath = (date: IsoDate, pose: string, ext = 'jpeg') => `${paths().photos}/${date}/${pose}.${ext}`;
/** macOS sips's arguments for one photo (HEIC included): JPEG at quality 82, at most PHOTO_MAX_PX on the long side. */
export const sipsArgs = (src: string, out: string): string[] => ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '-Z', String(PHOTO_MAX_PX), src, '--out', out];

export type RecordValue = number | string;
export type RecordValues = Record<string, RecordValue | null>;

/** Out-of-range, malformed or unknown values, in words (empty when all are fine). */
export function validateRecord(fields: readonly RecordField[], values: RecordValues): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(values)) {
    const f = fields.find((x) => x.id === k);
    if (!f) {
      out.push(`${k} is not a field here`);
      continue;
    }
    if (v === null) continue;
    if (f.text) {
      if (typeof v !== 'string' || !v.trim()) out.push(`${f.label} is text`);
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) out.push(`${f.label} is not a number`);
    else if ((f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max)) out.push(`${f.label} is between ${f.min} and ${f.max}`);
    else if (f.int && !Number.isInteger(v)) out.push(`${f.label} is a whole number`);
  }
  return out;
}

/** A list's entry for a date, as it is on disk (an empty object when there is none). */
export function recordFrom(doc: unknown, list: 'tape' | 'tests', date: IsoDate): Record<string, RecordValue> {
  const arr = isObj(doc) && Array.isArray(doc[list]) ? (doc[list] as unknown[]) : [];
  const e = arr.find((x) => isObj(x) && x['date'] === date);
  const out: Record<string, RecordValue> = {};
  if (isObj(e)) for (const [k, v] of Object.entries(e)) if (k !== 'date' && (typeof v === 'number' || typeof v === 'string')) out[k] = v;
  return out;
}

export interface RecordChange {
  /** The fields the form changed (null clears one). */
  values: RecordValues;
  /** The same fields as the form first read them: one changed on disk since then is a conflict. */
  baseline: RecordValues;
  force?: boolean;
}

export interface RecordConflict {
  key: string;
  disk: RecordValue | null;
  baseline: RecordValue | null;
  mine: RecordValue | null;
}

export type RecordMerge =
  | { result: 'merged'; text: string; changed: string[]; entry: Record<string, unknown> | null }
  | { result: 'unchanged' }
  | { result: 'conflict'; conflicts: RecordConflict[] }
  | { result: 'invalid'; errors: string[] }
  | { result: 'unreadable'; error: string };

function readBody(text: string | null): { doc: Obj } | { error: string } {
  if (text === null) return { doc: { days: {} } };
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { error: 'body-data.json is not valid JSON' };
  }
  if (!isObj(doc)) return { error: 'body-data.json is not a JSON object' };
  return { doc };
}

/**
 * body-data.json with a tape or tests entry changed field by field: the
 * entry for `date` is created when missing, a changed field is set (null
 * removes it), the other fields and entries stay, the list stays in date
 * order, and an entry left with no fields goes. A field someone else changed
 * since the form read it is a conflict unless forced. A missing file starts
 * a new one; an unreadable one is left alone.
 */
export function mergeRecord(text: string | null, list: 'tape' | 'tests', date: IsoDate, change: RecordChange): RecordMerge {
  if (!isIsoDate(date)) return { result: 'invalid', errors: [`${date} is not a date`] };
  const fields = list === 'tape' ? TAPE_FIELDS : TEST_FIELDS;
  const errors = validateRecord(fields, change.values);
  if (errors.length) return { result: 'invalid', errors };
  const r = readBody(text);
  if ('error' in r) return { result: 'unreadable', error: r.error };
  const doc = r.doc;
  if (doc[list] !== undefined && !Array.isArray(doc[list])) return { result: 'unreadable', error: `body-data.json has a "${list}" that is not a list` };
  const arr = Array.isArray(doc[list]) ? (doc[list] as unknown[]) : (doc[list] = []);
  const disk = recordFrom(doc, list, date);
  const keys = Object.keys(change.values);
  const conflicts: RecordConflict[] = [];
  for (const k of keys) {
    const mine = change.values[k] ?? null;
    const base = change.baseline[k] ?? null;
    const d = disk[k] ?? null;
    if (d !== base && d !== mine) conflicts.push({ key: k, disk: d, baseline: base, mine });
  }
  if (conflicts.length && !change.force) return { result: 'conflict', conflicts };
  const idx = arr.findIndex((x) => isObj(x) && x['date'] === date);
  const entry: Obj = idx >= 0 ? { ...(arr[idx] as Obj) } : { date };
  const changed: string[] = [];
  for (const k of keys) {
    const mine = change.values[k] ?? null;
    if ((disk[k] ?? null) === mine) continue;
    if (mine === null) delete entry[k];
    else entry[k] = mine;
    changed.push(k);
  }
  if (!changed.length) return { result: 'unchanged' };
  const empty = Object.keys(entry).every((k) => k === 'date' || k.startsWith('_'));
  if (idx >= 0) {
    if (empty) arr.splice(idx, 1);
    else arr[idx] = entry;
  } else if (!empty) arr.push(entry);
  arr.sort((a, b) => String(isObj(a) ? a['date'] : '').localeCompare(String(isObj(b) ? b['date'] : '')));
  return { result: 'merged', text: pretty(doc), changed, entry: empty ? null : entry };
}

/** The tape (waist, hips, chest, arm) for a date, field by field. */
export const mergeTape = (text: string | null, date: IsoDate, change: RecordChange): RecordMerge => mergeRecord(text, 'tape', date, change);

/** The fitness tests for a date, field by field. */
export const mergeTests = (text: string | null, date: IsoDate, change: RecordChange): RecordMerge => mergeRecord(text, 'tests', date, change);

export type PhotoMerge = { result: 'merged'; text: string; poses: string[] } | { result: 'unchanged' } | { result: 'invalid'; errors: string[] } | { result: 'unreadable'; error: string };

/**
 * The photo index after photos were saved for `date` (the plugin saves the
 * files first): the poses added to the date's entry, in the order they were
 * there then the new ones (Habit Nudges' order), the list in date order. A
 * removed pose comes out; an entry left with none goes.
 */
export function mergePhotoIndex(text: string | null, date: IsoDate, add: readonly string[], remove: readonly string[] = []): PhotoMerge {
  const known = POSES.map((p) => p.id as string);
  const bad = [...add, ...remove].filter((p) => !known.includes(p));
  if (!isIsoDate(date)) bad.unshift(`${date} (not a date)`);
  if (bad.length) return { result: 'invalid', errors: bad.map((p) => `${p} is not a pose (${known.join(', ')})`) };
  const r = readBody(text);
  if ('error' in r) return { result: 'unreadable', error: r.error };
  const doc = r.doc;
  if (doc['photos'] !== undefined && !Array.isArray(doc['photos'])) return { result: 'unreadable', error: 'body-data.json has a "photos" that is not a list' };
  const arr = Array.isArray(doc['photos']) ? (doc['photos'] as unknown[]) : (doc['photos'] = []);
  const idx = arr.findIndex((x) => isObj(x) && x['date'] === date);
  const was = idx >= 0 && Array.isArray((arr[idx] as Obj)['poses']) ? ((arr[idx] as Obj)['poses'] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const poses = [...new Set([...was, ...add])].filter((p) => !remove.includes(p));
  if (JSON.stringify(poses) === JSON.stringify(was)) return { result: 'unchanged' };
  if (idx >= 0) {
    if (poses.length) arr[idx] = { ...(arr[idx] as Obj), poses };
    else arr.splice(idx, 1);
  } else arr.push({ date, poses });
  arr.sort((a, b) => String(isObj(a) ? a['date'] : '').localeCompare(String(isObj(b) ? b['date'] : '')));
  return { result: 'merged', text: pretty(doc), poses };
}

/**
 * A day marked rest (or missed) in body-data.json's `days`, as "Did you
 * train today?"'s "Rest day" answer writes it; null clears the mark. The
 * engine reads it as the day's mark (adherence counts it as planned rest).
 */
export function mergeDayMark(text: string | null, date: IsoDate, mark: 'rest' | 'missed' | null): { result: 'merged'; text: string } | { result: 'unchanged' } | { result: 'unreadable'; error: string } {
  const r = readBody(text);
  if ('error' in r) return { result: 'unreadable', error: r.error };
  const doc = r.doc;
  if (doc['days'] !== undefined && !isObj(doc['days'])) return { result: 'unreadable', error: 'body-data.json has a "days" that is not an object' };
  const days = isObj(doc['days']) ? doc['days'] : (doc['days'] = {});
  const day: Obj = isObj(days[date]) ? { ...(days[date]) } : {};
  if ((day['mark'] ?? null) === mark) return { result: 'unchanged' };
  if (mark === null) delete day['mark'];
  else day['mark'] = mark;
  if (Object.keys(day).length) days[date] = day;
  else delete days[date];
  return { result: 'merged', text: pretty(doc) };
}
