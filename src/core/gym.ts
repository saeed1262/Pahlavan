// The gym page's format, shared by the engine and the page. The link
// (phone.json's `gym`): the page's address, then after the `#` every plan
// session as the Log panel's Every set form lays it out (its rows, each set
// prefilled from the target or last time, the rest, a superset's parts, a
// swap with the plan's item it replaces and why), base64url JSON. And what
// the page sends back to the Pahlavan shortcut: the inbox session entry's
// fields at Every set, which the inbox checks as `engine log add` does.
// Pure: no clock, nothing read.

import { decodeBase64url, encodeBase64url } from './base64url.ts';
import type { IsoDate, SwapReason } from './schema.ts';

/** Where the page lives: in code, so a move is a plugin update, never a shortcut re-import. */
export const GYM_PAGE = 'https://saeed1262.github.io/pahlavan-gym/';
export const GYM_VERSION = 1;
/** The page's Send: the Pahlavan shortcut, the session's JSON as its input (URL-encoded after this). */
export const GYM_SEND = 'shortcuts://run-shortcut?name=Pahlavan&input=text&text=';

/** A row's kind, as the Log panel's (`RowKind`): a warm-up or cardio line is done or not; the others have sets. */
export type GymKind = 'warmup' | 'load' | 'reps' | 'timed' | 'cardio';

/** One set as the page starts it (the form's prefill): weight only for a loaded row; reps are seconds on a timed row. */
export interface GymSet {
  weight: number | null;
  reps: number | null;
  rir: number | null;
}

export interface GymTarget {
  weight: number | null;
  reps: number;
  rir: number;
  /** A calibration week's: the weight held, or none yet (find it at the bottom of the range). */
  calibrate?: true;
}

export interface GymLast {
  weight: number;
  unit: string;
  reps: number;
  date: IsoDate;
}

/** One part of a superset, with its own sets (saved as its own exercise). */
export interface GymPart {
  name: string;
  /** The plan's item when another is done in its place (the Log panel's `planned`); null as planned. */
  planned: string | null;
  /** The swap's reason as the log keeps it (mine, ledger, soreness, hotel); null as planned or with none given. */
  swap: SwapReason | null;
  kind: GymKind;
  sets: number;
  range: [number, number] | null;
  unit: 'lb' | 'kg';
  step: number;
  target: GymTarget | null;
  last: GymLast | null;
  rows: GymSet[];
}

export interface GymRow {
  /** The form row's key: the page keeps its progress by it. */
  key: string;
  /** The checklist line this row ticks ("Warm-up", "Face Pull + Band External Rotation"); null when not on the checklist. */
  line: string | null;
  name: string;
  /** The plan's item when another is done in its place ("Romanian Deadlift" for a Single-leg dumbbell RDL); null as planned. */
  planned: string | null;
  /** The swap's reason as the log keeps it (mine, ledger, soreness, hotel); null as planned or with none given. */
  swap: SwapReason | null;
  kind: GymKind;
  /** The plan's sets × reps in words ("3 × 5–8"). */
  sr: string;
  sets: number;
  range: [number, number] | null;
  rir: number | null;
  /** Which logged lift (lift1 = 0, lift2 = 1), or null. */
  lift: 0 | 1 | null;
  unit: 'lb' | 'kg';
  step: number;
  /** The rest after a set, in seconds (the plan's "2–3 min" is its low end); null when the plan gives none. */
  rest: number | null;
  /** The plan's rest in its own words ("2–3 min", "90 s after each pair"). */
  restText: string | null;
  target: GymTarget | null;
  /** No target: the engine's start note ("pick a weight for 8-10 reps at RIR 4"); a timed row: its dose in words. */
  note: string | null;
  last: GymLast | null;
  rows: GymSet[];
  /** A superset: each part's own sets (the row's own `rows` are then empty). */
  parts?: GymPart[];
  /** The session's finisher (its trailing cardio). */
  finisher?: true;
}

export interface GymSession {
  type: string;
  name: string;
  kind: 'lift' | 'short';
  mode: 'full' | 'express';
  rows: GymRow[];
  /** The cardio minutes the plan gives (0 when none). */
  cardio: number;
  /** How the plan does that cardio ("bike"), as the Log panel starts it; null when it says none. */
  cardioMode: string | null;
  /** The session's planned minutes, when the plan gives them. */
  minutes: number | null;
}

export interface GymData {
  v: typeof GYM_VERSION;
  date: IsoDate;
  /** The session the page opens on (the rotation's next for the day), by type. */
  next: string | null;
  sessions: GymSession[];
}

// The link leaves out every field that is null (most rows have no swap, many no target or RIR), and reading it puts
// them back, so the page sees the same data; it keeps the link short enough for every session to fit.
const SESSION_NULLS = ['minutes', 'cardioMode'] as const;
const ROW_NULLS = ['line', 'range', 'rir', 'lift', 'rest', 'restText', 'target', 'note', 'last', 'planned', 'swap'] as const;
const PART_NULLS = ['range', 'target', 'last', 'planned', 'swap'] as const;
const SET_NULLS = ['weight', 'reps', 'rir'] as const;
const TARGET_NULLS = ['weight'] as const;

/** The page's link for a day's sessions. */
export const gymLink = (data: GymData, page: string = GYM_PAGE): string => `${page}#${encodeBase64url(JSON.stringify(data, (_k, v: unknown) => (v === null ? undefined : v)))}`;

type Loose = Record<string, unknown>;
const isLoose = (v: unknown): v is Loose => typeof v === 'object' && v !== null && !Array.isArray(v);
function fill(o: unknown, keys: readonly string[]): void {
  if (!isLoose(o)) return;
  for (const k of keys) if (o[k] === undefined) o[k] = null;
}
const fillSets = (rows: unknown) => (Array.isArray(rows) ? rows.forEach((x) => fill(x, SET_NULLS)) : undefined);

/** The null fields the link left out, back in place. */
function restoreNulls(d: Loose): void {
  if (d['next'] === undefined) d['next'] = null;
  for (const s of d['sessions'] as unknown[]) {
    fill(s, SESSION_NULLS);
    if (!isLoose(s) || !Array.isArray(s['rows'])) continue;
    for (const r of s['rows'] as unknown[]) {
      fill(r, ROW_NULLS);
      if (!isLoose(r)) continue;
      fill(r['target'], TARGET_NULLS);
      fillSets(r['rows']);
      if (Array.isArray(r['parts'])) {
        for (const p of r['parts'] as unknown[]) {
          fill(p, PART_NULLS);
          if (!isLoose(p)) continue;
          fill(p['target'], TARGET_NULLS);
          fillSets(p['rows']);
        }
      }
    }
  }
}

/** A link's data, from its `#` part (with or without the `#`); null when it isn't a gym link this version reads. */
export function gymFromHash(hash: string): GymData | null {
  const text = decodeBase64url(hash.replace(/^#/, ''));
  if (text === null) return null;
  try {
    const d = JSON.parse(text) as unknown;
    if (typeof d !== 'object' || d === null) return null;
    const o = d as Record<string, unknown>;
    if (o['v'] !== GYM_VERSION || typeof o['date'] !== 'string' || !Array.isArray(o['sessions'])) return null;
    restoreNulls(o);
    return d as GymData;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- what the page sends

export type GymSkipReason = 'time' | 'pain' | 'equipment' | 'energy';

/** One logged set: weight and unit only on a loaded exercise (null or left out for bodyweight). */
export interface GymEntrySet {
  weight?: number | null;
  unit?: 'lb' | 'kg' | null;
  reps: number;
  rir?: number | null;
}

/**
 * A logged lift's top set. A swap names the lift done (`name`) and the
 * plan's (`planned`), with the swap's reason when known; a lift done as
 * planned has neither, and is named by the plan.
 */
export interface GymEntryLift {
  name?: string;
  planned?: string;
  swapWhy?: SwapReason;
  weight: number;
  reps: number;
  unit?: 'lb' | 'kg';
}

/**
 * The inbox session entry's `session` at Every set, as the page sends it
 * (the shortcut adds `v`, `at`, `date` and `kind` around it). Its fields
 * are `engine log add`'s, as the Log panel's `inputFromForm` gives them:
 * the logged lifts' top sets (in the plan's order), every ticked set by
 * exercise (a swap's with the plan's item as `planned`), the other swaps,
 * the checklist lines skipped and why. `_say` is the shortcut's question
 * ("A · 12 sets"); the inbox ignores keys that start with `_`.
 */
export interface GymEntry {
  type: string;
  lift1?: GymEntryLift;
  lift2?: GymEntryLift;
  express?: true;
  durationMin?: number;
  cardioMin?: number;
  cardioMode?: string;
  notes?: string;
  trackingLevel: 'full';
  exerciseSets: { name: string; planned?: string; sets: GymEntrySet[] }[];
  /** Every swap but the logged lifts' (they carry their own): a row's, and each superset part's. */
  swaps?: { from: string; to: string; why?: SwapReason }[];
  skipped?: string[];
  skipWhy?: Record<string, GymSkipReason>;
  _say: string;
}

/** The page's Send link for a session entry. */
export const gymSendUrl = (entry: GymEntry): string => GYM_SEND + encodeURIComponent(JSON.stringify(entry));
