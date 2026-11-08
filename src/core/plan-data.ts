// The current dashboard's plan file, plan-data.json: its shape, the muscle id
// mapping, the `sr` and `note` conventions, and the exporter from a schema-v1
// program back to that shape. Pure: the vault adapter reads the file and calls
// the parsers here; the exporter returns an object for the skill to write
// through its own propose-then-write steps.

import { CALIBRATION, calibrationNote } from './calibration.ts';
import { LADDER_BY_ID } from './data/ladders.ts';
import { MUSCLES } from './data/muscles.ts';
import { addDays, dayText, isIsoDate, mondayOf } from './dates.ts';
import { DELOAD } from './deload.ts';
import { effectiveSlot } from './plan.ts';
import { explain, type Result } from './reason.ts';
import type { Exercise, ExerciseSlot, IsoDate, MuscleTags, Program, RepRange, SessionTemplate, TimedWork, Unit, Week, Weekday } from './schema.ts';
import { isIntervals, readTimed, sameTimed, timedFromText, timedMinutes, timedSets } from './timed.ts';

// ---------------------------------------------------------------- the shape

export interface PlanDataItem {
  name: string;
  table?: string;
  /** Sets and reps as written on the sheet: "4 × 8–10", "3 × 8/leg", "6 min", "4 rounds, 40/20". */
  sr: string;
  rest?: string;
  note?: string;
  label?: string;
  /** One of the session's two logged lifts (top set recorded). */
  logged?: boolean;
  /** A calisthenics ladder id: the item is the user's current level. */
  ladder?: string;
  /** Done back to back with the item before it. */
  pair?: boolean;
  /**
   * The reps in reserve: one number, or [lo, hi] for a range ("RIR 1–2").
   * Without it, the note's "RIR n" (plans written before the field).
   */
  rir?: number | [number, number];
  /**
   * A timed item's minutes and structure (intervals: rounds, work, rest,
   * warm-up, cool-down). Without it, the minutes in `sr` and intervals
   * the note describes ("4 × 4 min hard, 3 min easy between").
   */
  timed?: TimedWork;
}

export interface PlanDataLift {
  short?: string;
  /** Only when it differs from `liftUnit`. */
  unit?: Unit;
  lo: number;
  hi: number;
  inc: number;
  db?: boolean;
  chart?: boolean;
  step?: number;
  /** The coach's progression rule for this lift (rules.ts, LiftProgression); without it the old default, double progression. */
  progression?: unknown;
}

export interface PlanDataMuscles {
  main: string[];
  helps: string[];
  kind?: 'cardio' | 'mobility';
  areas?: string[];
  /**
   * The muscle regions it biases (data/regions.ts ids). Like `main` and
   * `helps`, a copy of the catalogue's for a movement the catalogue knows
   * (the exporter keeps it in step); they count only for a movement it does
   * not know, or with an `override`.
   */
  regions?: string[];
  /**
   * Why this entry keeps its own `main` and `helps` for a movement the
   * engine's catalogue knows. Without it the catalogue's tags count and the
   * entry's are a copy the exporter keeps in step; with it (a non-empty
   * reason) the entry's tags count everywhere and the exporter leaves them.
   */
  override?: string;
}

export interface PlanDataGuide {
  setup?: string;
  do?: string;
  avoid?: string;
  q?: string;
  muscles?: PlanDataMuscles;
  [key: string]: unknown;
}

export interface PlanDataLadder {
  id: string;
  name: string;
  levels: { name: string; detail?: string }[];
  /**
   * The level this plan starts the ladder at (1-based, as `engine log
   * ladder --level` counts). Optional: the count reads the log's level
   * first, then this, then the lowest level (ladderLevelOn), so a draft or
   * a new plan counts its ladder items at the level it means before the
   * log holds one.
   */
  startLevel?: number;
}

export interface PlanData {
  _about?: string;
  weekTarget: { lift: number; short: number };
  liftTypes: string[];
  shortTypes: string[];
  titles: Record<string, string>;
  shortNames: Record<string, string>;
  focus: Record<string, string>;
  warmups: { lift: string; short: string };
  sessions: Record<string, PlanDataItem[]>;
  liftUnit: Unit;
  lifts: Record<string, PlanDataLift>;
  /** The 20-minute version: `short` is the coach's rule for a short day's Express (rules.ts; without it, every item at half). */
  express: { warmup: string; mainSets: string; secondSets: string; finish: { name: string; sr: string }; short?: 'half' | 'skip' };
  deloadS3: { name: string; sr: string; label?: string }[];
  ladders: PlanDataLadder[];
  laddersFor: Record<string, string[]>;
  ladderNote: string;
  guide: Record<string, PlanDataGuide>;
  /** The muscle groups the dashboard's muscle map draws: id to label. */
  muscles: Record<string, string>;
  deskRoutine: { name: string; dose: string }[];
  /**
   * When the desk routine runs. Optional: without it the routine runs on
   * Habit Nudges' timing (every 90 minutes, 10:00 to 15:00, weekdays, about
   * 5 minutes a break), as before.
   */
  deskTiming?: PlanDataDeskTiming;
  /**
   * The phases' names in order (phase 1 holds plan weeks 1 to 8, phase 2
   * weeks 9 to 16, ...), with an optional goal line. Optional: a plan
   * without it reads "Phase 1", "Phase 2" as before.
   */
  phases?: PlanDataPhase[];
  /**
   * The plan's first day (YYYY-MM-DD): the Monday-to-Sunday week holding it
   * is plan week 1, whatever the log or the baseline note say. Optional:
   * without it week 1 is the first logged plan session's week (the cycle
   * start's until the cycle has one), as before. The coach writes it with
   * the first plan of a fresh start or a reset, and every later change keeps it;
   * `plan --start D` writes the generator's first Monday.
   */
  start?: IsoDate;
  /** The plan's length in weeks (a generated plan writes it; without it, 24): the top bar's "Week N of M". */
  weeks?: number;
  /**
   * The coach's standing rules (rules.ts, readRules): calibration, light
   * weeks, tests, readiness, soreness, missed time, stalls and Hotel. A kind
   * left out is Pahlavan's old default, with a `legacy-default` warning.
   */
  rules?: Record<string, unknown>;
  /** The coach's stated reasons for going outside an evidence range (overrides.ts, readOverrides): `engine check` turns each matched warning into information. */
  overrides?: unknown[];
}

export interface PlanDataPhase {
  name: string;
  goal?: string;
}

/** The desk breaks' times: a break every `every` minutes from `from` while one fits before `to` (HH:MM), about `minutes` each, on `days` (weekdays when left out). */
export interface PlanDataDeskTiming {
  every: number;
  from: string;
  to: string;
  minutes?: number;
  days?: Weekday[];
}

/**
 * plan-data's `start` as plan week 1's Monday (the Monday-to-Sunday week
 * holding the date). Absent: null, and week 1 comes from the log as before.
 * Not a date: null with the problem, which the plan check holds as a hard
 * error (`plan-data`) and the screens read around.
 */
export function planStartOf(raw: unknown): { monday: IsoDate | null; problem: string | null } {
  const v = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>)['start'] : undefined;
  if (v === undefined) return { monday: null, problem: null };
  if (typeof v !== 'string' || !isIsoDate(v)) return { monday: null, problem: `plan-data.json's start is ${JSON.stringify(v)}, not a date as YYYY-MM-DD: the plan weeks count from the first logged plan session.` };
  return { monday: mondayOf(v), problem: null };
}

/**
 * plan-data's `phases` as names by position: each entry's name (and goal),
 * or null where an entry is not usable, with a warning for it. Absent:
 * no names (the plan's phases read "Phase N").
 */
export function phaseNamesFrom(raw: unknown): { phases: (PlanDataPhase | null)[]; warnings: string[] } {
  if (raw === undefined) return { phases: [], warnings: [] };
  if (!Array.isArray(raw)) return { phases: [], warnings: ['plan-data.json\'s "phases" is not a list of {name}: the phases read Phase 1, Phase 2, ...'] };
  const warnings: string[] = [];
  const phases = raw.map((p, i) => {
    const name = typeof p === 'string' ? p : typeof p === 'object' && p !== null ? (p as { name?: unknown }).name : undefined;
    if (typeof name !== 'string' || !name.trim()) {
      warnings.push(`plan-data.json's phases[${i}] has no name: it reads Phase ${i + 1}.`);
      return null;
    }
    const goal = typeof p === 'object' && p !== null ? (p as { goal?: unknown }).goal : undefined;
    return { name: name.trim(), ...(typeof goal === 'string' && goal.trim() ? { goal: goal.trim() } : {}) };
  });
  return { phases, warnings };
}

/**
 * A plan-data ladder's `startLevel`: the level, or null when it has none.
 * Not a whole number among the ladder's levels: null with the problem,
 * which the plan check holds as a hard error (`plan-data`) and the count
 * reads around (the log's level, else the lowest).
 */
export function ladderStartOf(ladder: unknown): { level: number | null; problem: string | null } {
  if (typeof ladder !== 'object' || ladder === null || Array.isArray(ladder)) return { level: null, problem: null };
  const l = ladder as Record<string, unknown>;
  const v = l['startLevel'];
  if (v === undefined) return { level: null, problem: null };
  const count = Array.isArray(l['levels']) ? l['levels'].length : 0;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= count) return { level: v, problem: null };
  const id = typeof l['id'] === 'string' ? l['id'] : '?';
  return { level: null, problem: `plan-data.json's ladder "${id}" has startLevel ${JSON.stringify(v)}, not one of its levels (a whole number from 1 to ${count}): its items count at the log's level, else the lowest.` };
}

/** Where a ladder's level comes from: the log, the plan's `startLevel`, or neither (the lowest level). */
export type LadderLevelFrom = 'log' | 'plan' | 'lowest';

/**
 * A ladder's level on a date (1-based; a null date: the latest), in this
 * order: the last level the log holds on or before the date; else the
 * plan's starting level; else the lowest level, 1. Every place that turns a
 * "your level" item into a movement reads it here (the vault's templates,
 * the planned list of a session, the effort rule), so review, check,
 * Progress and the Plan screen count the same level.
 */
export function ladderLevelOn(history: readonly { level: number; date: IsoDate }[], startLevel: number | null | undefined, date: IsoDate | null): { level: number; from: LadderLevelFrom } {
  const logged = history.filter((x) => date === null || x.date <= date).at(-1);
  if (logged) return { level: logged.level, from: 'log' };
  if (typeof startLevel === 'number') return { level: startLevel, from: 'plan' };
  return { level: 1, from: 'lowest' };
}

/** plan-data.json's top-level keys, in the file's order. */
export const PLAN_DATA_KEYS = [
  '_about',
  'weekTarget',
  'liftTypes',
  'shortTypes',
  'titles',
  'shortNames',
  'focus',
  'warmups',
  'sessions',
  'liftUnit',
  'lifts',
  'express',
  'deloadS3',
  'ladders',
  'laddersFor',
  'ladderNote',
  'guide',
  'muscles',
  'deskRoutine',
  'deskTiming',
  'phases',
  // The plan's first day: its week is plan week 1 (planStartOf).
  'start',
  'weeks',
  'rules',
  // The coach's reasons for going outside an evidence range (overrides.ts): `engine check` reads them.
  'overrides',
] as const;
export const ITEM_KEYS = ['name', 'table', 'sr', 'rest', 'rir', 'timed', 'note', 'label', 'logged', 'ladder', 'pair'] as const;
export const LIFT_KEYS = ['short', 'unit', 'lo', 'hi', 'inc', 'db', 'chart', 'step', 'progression'] as const;

// ---------------------------------------------------------------- muscles

/**
 * plan-data's muscle ids (its `muscles` and every `guide[].muscles`) to the
 * engine's ids (data/muscles.ts). The engine kept the plan's 14 ids, so each
 * maps to itself; the table is the single place to change if either side
 * renames one. The body-map slug each one draws is in data/muscles.ts.
 */
export const PLAN_DATA_MUSCLES: Readonly<Record<string, string>> = {
  chest: 'chest',
  shoulders: 'shoulders',
  biceps: 'biceps',
  triceps: 'triceps',
  forearms: 'forearms',
  abs: 'abs',
  obliques: 'obliques',
  'upper-back': 'upper-back',
  lats: 'lats',
  'lower-back': 'lower-back',
  glutes: 'glutes',
  quads: 'quads',
  hamstrings: 'hamstrings',
  calves: 'calves',
};

/**
 * The engine's muscles that plan-data has no group for, and the nearest group
 * the exporter writes instead (each one listed as an approximation).
 */
export const ENGINE_ONLY_MUSCLES: Readonly<Record<string, string>> = {
  neck: 'upper-back',
  adductors: 'glutes',
  abductors: 'glutes',
  tibialis: 'calves',
};

const PLAN_DATA_FROM_ENGINE: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.entries(PLAN_DATA_MUSCLES).map(([p, e]) => [e, p])),
  ...ENGINE_ONLY_MUSCLES,
};

/** plan-data's labels for its groups, as the file writes them. */
export const PLAN_DATA_MUSCLE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.keys(PLAN_DATA_MUSCLES).map((id) => [id, MUSCLES.find((m) => m.id === PLAN_DATA_MUSCLES[id])?.label ?? id]),
);

/**
 * Maps plan-data muscle ids to engine ids; unknown ids are returned
 * separately. A muscle in `main` is dropped from `helps`: it counts once, as
 * a main muscle, never 1.5 sets a set.
 */
export function toEngineMuscles(tags: { main?: readonly string[]; helps?: readonly string[] }): { muscles: MuscleTags; unknown: string[] } {
  const unknown: string[] = [];
  const map = (ids: readonly string[] = [], skip: readonly string[] = []) => {
    const out: string[] = [];
    for (const id of ids) {
      const m = PLAN_DATA_MUSCLES[id];
      if (m === undefined) {
        if (!unknown.includes(id)) unknown.push(id);
        continue;
      }
      if (!out.includes(m) && !skip.includes(m)) out.push(m);
    }
    return out;
  };
  const main = map(tags.main);
  return { muscles: { main, helps: map(tags.helps, main) }, unknown };
}

/**
 * Maps engine muscle ids to plan-data ids; approximated ids are listed. A
 * helper that lands on a main group (a lunge's adductors written as glutes)
 * is dropped from `helps`, so the muscle counts once.
 */
export function toPlanDataMuscles(tags: MuscleTags): { main: string[]; helps: string[]; regions?: string[]; approximated: string[] } {
  const approximated: string[] = [];
  const map = (ids: readonly string[], skip: readonly string[] = []) => {
    const out: string[] = [];
    for (const id of ids) {
      const p = PLAN_DATA_FROM_ENGINE[id] ?? id;
      if (id in ENGINE_ONLY_MUSCLES) approximated.push(id);
      if (!out.includes(p) && !skip.includes(p)) out.push(p);
    }
    return out;
  };
  const main = map(tags.main);
  // Regions pass through as they are: every region's parent muscle is one of plan-data's groups.
  return { main, helps: map(tags.helps, main), ...(tags.regions?.length ? { regions: [...tags.regions] } : {}), approximated };
}

/**
 * Engine muscle tags as the vault counts them: each muscle on plan-data's 14
 * groups (one plan-data has no group for goes to the nearest,
 * ENGINE_ONLY_MUSCLES), and a muscle in `main` dropped from `helps`. Review,
 * Progress, the movement guide and `plan --vault`'s vault count all read
 * catalogue tags through this.
 */
export function planDataGroups(tags: MuscleTags): MuscleTags {
  const p = toPlanDataMuscles(tags);
  return toEngineMuscles({ main: p.main, helps: p.helps }).muscles;
}

/** The same main and helping muscles, in any order. */
export function sameMuscles(a: { main: readonly string[]; helps: readonly string[] }, b: { main: readonly string[]; helps: readonly string[] }): boolean {
  const same = (x: readonly string[], y: readonly string[]) => {
    const sx = new Set(x);
    const sy = new Set(y);
    return sx.size === sy.size && [...sx].every((v) => sy.has(v));
  };
  return same(a.main, b.main) && same(a.helps, b.helps);
}

/** The same regions, in any order; none and an empty list are the same. */
export function sameRegions(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const sa = new Set(a ?? []);
  const sb = new Set(b ?? []);
  return sa.size === sb.size && [...sa].every((v) => sb.has(v));
}

/** A guide entry's `muscles.override` reason, or null when it has none (missing, not a string, or blank). */
export function overrideReason(muscles: unknown): string | null {
  const o = typeof muscles === 'object' && muscles !== null ? (muscles as { override?: unknown }).override : undefined;
  return typeof o === 'string' && o.trim() ? o.trim() : null;
}

/**
 * A guide entry's override as Pahlavan reads it: `active` with its reason
 * when it is a non-empty reason beside at least one main muscle; `ignored`
 * with why when the entry has an `override` key that fails that (the
 * catalogue's tags then count, and an export rewrites the entry); `none`
 * without the key.
 */
export function overrideOf(muscles: unknown): { state: 'none' } | { state: 'active'; reason: string } | { state: 'ignored'; why: string } {
  if (typeof muscles !== 'object' || muscles === null || !('override' in muscles)) return { state: 'none' };
  const reason = overrideReason(muscles);
  if (reason === null) return { state: 'ignored', why: 'the override is not a reason (a non-empty string)' };
  const main = (muscles as { main?: unknown }).main;
  if (!Array.isArray(main) || !main.some((m) => typeof m === 'string' && m in PLAN_DATA_MUSCLES)) return { state: 'ignored', why: 'the override names no main muscle' };
  return { state: 'active', reason };
}

// ---------------------------------------------------------------- names, sr and notes

/**
 * An engine id for a plan-data exercise name: lowercase, accents and symbols
 * dropped, words joined by dashes ("45° Back Extension" is 45-back-extension).
 * Names that differ only in case are the same exercise, as in the dashboard.
 */
export function exerciseId(name: string): string {
  const id = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return id || 'exercise';
}

export interface ParsedSr {
  /** The leading "N ×", or null (rounds, minutes). */
  sets: number | null;
  /** The reps (or seconds) after the ×. */
  repRange: RepRange | null;
  /** "s" when the range is seconds. */
  seconds: boolean;
  /** "/leg", "/arm", "/side". */
  per: string | null;
  /** The minutes of a timed item ("6 min", "5–10 min": the first number). */
  minutes: number | null;
  rounds: number | null;
}

const SR = /^\s*(\d+)\s*×\s*(\d+)(?:\s*[–-]\s*(\d+))?\s*(s\b)?\s*(?:\/\s*([a-z]+))?/i;

export function parseSr(sr: string): ParsedSr {
  const s = String(sr ?? '');
  const m = SR.exec(s);
  const minutes = /(\d+)(?:\s*[–-]\s*\d+)?\s*min/.exec(s);
  const rounds = /(\d+)\s*rounds?\b/i.exec(s);
  const lead = /^\s*(\d+)\s*×/.exec(s);
  const lo = m ? Number(m[2]) : null;
  const hi = m ? Number(m[3] ?? m[2]) : null;
  return {
    sets: lead ? Number(lead[1]) : null,
    repRange: lo !== null && hi !== null && lo >= 1 && lo <= hi ? [lo, hi] : null,
    seconds: Boolean(m?.[4]),
    per: m?.[5] ? m[5].toLowerCase() : null,
    minutes: minutes ? Number(minutes[1]) : null,
    rounds: rounds ? Number(rounds[1]) : null,
  };
}

/**
 * The dashboard's `setsOf`: "N ×" anywhere, or "N sets"; otherwise half the
 * minutes (at least 1); otherwise 1. The log's session snapshots carry this
 * number (a timed line as a set per 2 minutes), so it is for writing and
 * reading the log only; a slot's sets are `itemSets`.
 */
export function dashboardSets(sr: string): number {
  const s = String(sr ?? '');
  const n = /(\d+)\s*×/.exec(s) ?? /(\d+)\s*(?:working\s+)?sets?\b/i.exec(s);
  if (n) return Number(n[1]);
  const min = /(\d+)(?:\s*[–-]\s*\d+)?\s*min/.exec(s);
  return min ? Math.max(1, Math.round(Number(min[1]) / 2)) : 1;
}

/**
 * A light week's sets as written: every "N ×" becomes the light week's sets,
 * the plan's number or half rounded up (the dashboard's toDeloadSets, with
 * its 2 sets by default).
 */
export function deloadSr(sr: string, sets: number | 'half' = DELOAD.legacySets): string {
  return sr.replace(/(^|\/\s*)(\d+) ×/g, (_m, pre: string, n: string) => `${pre}${sets === 'half' ? Math.max(1, Math.ceil(Number(n) / 2)) : sets} ×`);
}

export interface ParsedNote {
  /** "until YYYY-MM-DD: <why>", anywhere in the note (as the review script reads it). */
  until: { date: IsoDate; reason: string } | null;
  /** "Replaces <item>.": the item to restore when the change ends. */
  replaces: string | null;
  /** "RIR n" in the note. */
  rir: number | null;
  /** "Why: <reason>": the plan's own reason for the item, the rest of the note after "Why:". */
  why: string | null;
}

export function parseNote(note: string | undefined): ParsedNote {
  const s = note ?? '';
  const u = /until (\d{4}-\d{2}-\d{2})(?::\s*([^]*?)(?:\.\s|\.$|$))?/.exec(s);
  const r = /\bReplaces ([^.]+)\./.exec(s);
  const rir = /\bRIR (\d+(?:\.\d+)?)/.exec(s);
  const why = /\bWhy:\s*([^]*)$/.exec(s);
  return {
    until: u ? { date: u[1]!, reason: (u[2] ?? '').trim() || 'temporary change' } : null,
    replaces: r ? r[1]!.trim() : null,
    rir: rir ? Number(rir[1]) : null,
    why: why && why[1]!.trim() ? why[1]!.trim() : null,
  };
}

/**
 * The RIR a note prescribes, as written: "RIR 2" is 2 to 2, "RIR 1–2" is 1
 * to 2; null when the note gives none. `parseNote`'s `rir` keeps the first
 * number (the slot's target); the effort rule reads the top (`hi`), the
 * easiest set the plan allows. A light week's "RIR +3" is a change, not a
 * prescription, and is not read.
 */
export function noteRir(note: string | undefined): { lo: number; hi: number } | null {
  const m = /\bRIR (\d+(?:\.\d+)?)(?:\s*[–-]\s*(\d+(?:\.\d+)?))?/.exec(note ?? '');
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2] ?? m[1]);
  return { lo: Math.min(a, b), hi: Math.max(a, b) };
}

/**
 * An item's `rir` field as written: a number of reps in reserve, or [lo, hi];
 * null with what is wrong when it is neither (absent: null, no problem).
 */
export function readRir(raw: unknown): { rir: { lo: number; hi: number } | null; problem: string | null } {
  if (raw === undefined) return { rir: null, problem: null };
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (ok(raw)) return { rir: { lo: raw, hi: raw }, problem: null };
  if (Array.isArray(raw) && raw.length === 2 && ok(raw[0]) && ok(raw[1])) return { rir: { lo: Math.min(raw[0], raw[1]), hi: Math.max(raw[0], raw[1]) }, problem: null };
  return { rir: null, problem: `rir is ${JSON.stringify(raw)}, not a number of reps in reserve or [lo, hi]` };
}

/**
 * The RIR an item prescribes: its `rir` field first (a number is lo = hi),
 * else the note's "RIR n" or "RIR n–m" (plans written before the field);
 * null when neither gives one. The slot's target is `lo`, the effort rule
 * reads `hi`.
 */
export function itemRir(item: { rir?: unknown; note?: string } | undefined): { lo: number; hi: number } | null {
  return readRir(item?.rir).rir ?? noteRir(item?.note);
}

/**
 * A timed item's structure: its `timed` field first, else the minutes in
 * `sr` and the intervals its note describes (timed.ts, timedFromText);
 * null for a sets item.
 */
export function itemTimed(item: { sr?: string; note?: string; timed?: unknown } | undefined): TimedWork | null {
  if (!item) return null;
  return readTimed(item.timed).timed ?? timedFromText(item.sr, item.note);
}

/**
 * The sets an item counts as a slot: a timed item's rounds (1 for steady
 * minutes); else "N ×" or "N sets"; else "N rounds"; else 1. Its minutes
 * are never sets: the log's count of a timed line (a set per 2 minutes) is
 * `dashboardSets`, for writing the log only.
 */
export function itemSets(item: { sr?: string; note?: string; timed?: unknown }): number {
  const t = itemTimed(item);
  if (t) return timedSets(t);
  const s = String(item.sr ?? '');
  const n = /(\d+)\s*×/.exec(s) ?? /(\d+)\s*(?:working\s+)?sets?\b/i.exec(s) ?? /(\d+)\s*rounds?\b/i.exec(s);
  return n ? Math.max(1, Number(n[1])) : 1;
}

/**
 * What is wrong with an item's optional fields (`rir`, `timed`), in words;
 * empty when they are absent or well formed. The readers fall back to the
 * note for a field that is not.
 */
export function itemFieldProblems(item: { rir?: unknown; timed?: unknown }): string[] {
  const rir = readRir(item.rir).problem;
  return [...(rir ? [rir] : []), ...readTimed(item.timed).problems.map((p) => `timed ${p}`)];
}

/**
 * The note's sentences a screen shows elsewhere: the RIR ("@ RIR 2" on the
 * target line), the progression rule (the target line), the superset
 * sentence (the pair marker), a temporary change and what it replaces (the
 * reasons and "in place of").
 */
const SHOWN_ELSEWHERE: readonly RegExp[] = [
  /^RIR \d+(?:\.\d+)?(?:\s*[–-]\s*\d+(?:\.\d+)?)?\.?$/,
  /^(?:Linear|Double progression|Progression|Ladder|Weekly wave|Wave):/i,
  /^Superset with\b/i,
  /^until \d{4}-\d{2}-\d{2}\b/i,
  /^Replaces\b/,
];

/**
 * The form cue in an item's note: the note before its "Why:", without the
 * sentences shown elsewhere. "RIR 1. Full range: lower over 2–3 s. Double
 * progression: ... Why: ..." is "Full range: lower over 2–3 s."; null when
 * nothing is left.
 */
export function noteCue(note: string | undefined): string | null {
  const before = (note ?? '').replace(/\bWhy:[^]*$/, '').trim();
  const kept = before.split(/(?<=\.)\s+/).map((x) => x.trim()).filter((x) => x && !SHOWN_ELSEWHERE.some((re) => re.test(x)));
  return kept.length ? kept.join(' ') : null;
}

/** An item's rest as written ("2–3 min", "90 s after each pair"); null when it has none ("—", or left out). */
export function restOf(item: { rest?: string } | undefined): string | null {
  const r = (item?.rest ?? '').trim();
  return r && !/^[—–-]+$/.test(r) ? r : null;
}

/**
 * Row numbers as the month plan numbers its tables: 1, 2, 3, and a pair
 * (a superset) 4a and 4b. `paired[k]` is true when row k is done back to
 * back with row k - 1 (plan-data's `pair`); the first row never is.
 */
export function numberRows(paired: readonly boolean[]): { num: string; group: number; part: 'a' | 'b' | null }[] {
  let n = 0;
  return paired.map((p, k) => {
    if (p && k > 0) return { num: `${n}b`, group: n, part: 'b' as const };
    n++;
    return paired[k + 1] ? { num: `${n}a`, group: n, part: 'a' as const } : { num: String(n), group: n, part: null };
  });
}

/** "4 × 8–10", "3 × 8", with the per-side suffix and seconds kept. */
export function formatSr(sets: number, repRange: RepRange, opts: { per?: string | null; seconds?: boolean } = {}): string {
  const [lo, hi] = repRange;
  const reps = lo === hi ? `${lo}` : `${lo}–${hi}`;
  return `${sets} × ${reps}${opts.seconds ? ' s' : ''}${opts.per ? `/${opts.per}` : ''}`;
}

// ---------------------------------------------------------------- the exporter

/**
 * A generated program's standing rules (rules.ts shapes): its calibration
 * weeks at the calibration RIR, its light weeks (every Nth when regular, else
 * listed) with the generator's light week (half the sets, about 10 % lighter,
 * RIR +3; an early signal offered, never applied), and its test weeks.
 */
function generatedRules(weeks: readonly Week[]): Record<string, unknown> {
  const numbered = (pick: (w: Week) => boolean) => weeks.flatMap((w, i) => (pick(w) ? [i + 1] : []));
  const light = numbered((w) => w.kind === 'deload');
  const every = light.length > 0 && light.every((n, i) => n === (i + 1) * light[0]!) && light[0]! >= 2 ? light[0]! : null;
  const cal = numbered((w) => w.calibration === true);
  const tests = numbered((w) => w.tests === true);
  return {
    calibration: cal.length ? { weeks: cal, rir: CALIBRATION.rir, cardio: 'easy', afterRestart: true } : 'none',
    lightWeeks: { ...(every ? { every } : { weeks: light }), sets: 'half', load: DELOAD.legacyLoadFactor, rirAdd: DELOAD.rirAdd, early: 'offer' },
    tests: tests.length ? { weeks: tests } : { weeks: 'phase-ends' },
  };
}

/**
 * What the vault adapter keeps beside a program it read from plan-data.json,
 * so an unchanged program exports back to the same file. Stored under keys
 * starting with "_", which schema v1 allows anywhere.
 */
export interface PlanDataExtras {
  /** plan-data's top-level keys other than sessions, lifts and guide. */
  top: Record<string, unknown>;
  /** Key order of the file, of `lifts` and of `guide`. */
  topOrder: string[];
  liftsOrder: string[];
  guideOrder: string[];
}

/** Kept on a slot the adapter built: the item as read, and the values it derived from it. */
export interface SlotExtras {
  _item?: PlanDataItem;
  _derived?: { exercise: string; sets: number; repRange: RepRange; rir: number; until: IsoDate | null; timed: TimedWork | null };
}

/** Kept on an exercise the adapter built: its guide and lifts entries, under their keys. */
export interface ExerciseExtras {
  _guideKey?: string;
  _guide?: PlanDataGuide;
  _liftKey?: string;
  _lift?: PlanDataLift;
}

/**
 * Every kind of thing the exporter lists as plan-data can't hold, in the
 * order a coach meets them: `engine --version --json` gives them (its
 * `facts`) so the coach's docs can name only the kinds that exist.
 */
export const UNEXPRESSIBLE = [
  'deload week',
  'calibration week',
  'conditioning sessions',
  'muscles',
  'guide text',
  'holds',
  'RIR in a note',
  'intervals in a note',
  'swaps',
  'why lines',
  'note cues',
  'temporary changes',
  'muscle override',
  'logged lifts',
  'linear progression',
  'wave progression',
  'standing rules kept',
  'ladder levels',
  'ladders',
  'phases',
  'later weeks',
  'standing rules',
  'priority muscles',
  'desk-break reasons',
  'express',
] as const;
export type UnexpressibleKind = (typeof UNEXPRESSIBLE)[number];

export interface Unexpressible {
  /** One of UNEXPRESSIBLE (the exporter says nothing else). */
  what: string;
  detail: string;
}

export interface PlanDataExportOptions {
  /** Export the week holding this date (default: the first loading week after calibration). */
  date?: IsoDate;
  /** Write the program's first day as plan-data's `start` (`plan --start D`: the program's week 1, the Monday on or before D). */
  start?: boolean;
  /** The current plan-data.json: warm-ups, ladders, guide text and the desk routine carry over from it. */
  base?: PlanData;
  /** plan-data's `liftUnit` (default: the base's, else the most common unit of the strength exercises). */
  liftUnit?: Unit;
  /** The proposal's warm-up lines, used when there is no base. */
  warmUp?: readonly string[];
  /**
   * The muscles a guide entry counts with (the vault adapter's rule: the
   * catalogue's tags for a movement it knows), or null to leave the entry
   * as it is. Entries carried over without a movement in the exported week
   * are brought in step with it too, so one export clears every stale copy.
   */
  guideMuscles?: (key: string, entry: PlanDataGuide) => MuscleTags | null;
  /**
   * The names the log holds for its logged lifts. Exporting a program over a
   * base file, a movement the plan as written already names keeps that name
   * (`matchId` says which names are the same movement), so its history, its
   * `lifts` entry and its guide entry stay its own.
   */
  logNames?: readonly string[];
  /** A movement's name to its catalogue id (the vault adapter's matcher), null when the catalogue doesn't know it. */
  matchId?: (name: string) => string | null;
}

export interface PlanDataExport {
  planData: PlanData;
  /** The program week the sessions came from. */
  week: { start: IsoDate; index: number; kind: Week['kind'] };
  /** plan-data type (A, B, S1 ...) to the program's template id. */
  types: Record<string, string>;
  unexpressible: Unexpressible[];
}

const DEFAULT_ABOUT =
  'Single source of truth for the fitness plan. Generated by the Pahlavan engine from a schema-v1 program; edit the plan here: notes made from it are regenerated, never edited by hand.';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

type Extras = { _planData?: PlanDataExtras };

function weeksOf(program: Program): Week[] {
  return program.macrocycle.phases.flatMap((p) => p.mesocycles.flatMap((m) => m.weeks));
}

function ordered<T extends object>(obj: T, keys: readonly string[]): T {
  const out: Record<string, unknown> = {};
  const src = obj as Record<string, unknown>;
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
  for (const k of Object.keys(src)) if (!(k in out) && src[k] !== undefined) out[k] = src[k];
  return out as T;
}

function sameRange(a: RepRange | null | undefined, b: RepRange | null | undefined): boolean {
  return Boolean(a && b && a[0] === b[0] && a[1] === b[1]);
}

/**
 * A guide entry with its `muscles` copy in step with the tags the program
 * counts: unchanged when they are the same as sets (order is the writer's)
 * or when the entry has an override Pahlavan honours (its own tags count, by
 * the user's choice); otherwise the entry with those tags (an override that
 * was ignored, review's `muscle-tags-override-ignored`, goes with the old copy).
 */
function inStep(prior: PlanDataGuide, tagged: PlanDataMuscles | undefined): PlanDataGuide {
  const pm = prior.muscles;
  if (!tagged || overrideOf(pm).state === 'active') return prior;
  const same = pm !== undefined && Array.isArray(pm.main) && Array.isArray(pm.helps) && sameMuscles(pm, tagged) && (pm.kind ?? undefined) === (tagged.kind ?? undefined);
  if (!same) return { ...prior, muscles: tagged };
  if (sameRegions(Array.isArray(pm.regions) ? pm.regions : undefined, tagged.regions)) return prior;
  // Only the regions differ: the entry keeps its muscles as written (their order is the writer's) and takes the regions.
  const { regions: _old, ...rest } = pm;
  return { ...prior, muscles: tagged.regions?.length ? { ...rest, regions: [...tagged.regions] } : rest };
}

/** Tags as a guide entry's `muscles` copy: main, helps and, when there are any, the regions. */
const guideCopy = (t: MuscleTags): PlanDataMuscles => ({ main: [...t.main], helps: [...t.helps], ...(t.regions?.length ? { regions: [...t.regions] } : {}) });

/** A note without its sentences that only say the RIR ("RIR 2.", "RIR 1–2."): the item's `rir` field holds it. */
function withoutRirSentences(note: string): string {
  return note.split(/(?<=\.)\s+/).filter((x) => !/^RIR \d+(?:\.\d+)?(?:\s*[–-]\s*\d+(?:\.\d+)?)?\.?$/.test(x.trim())).join(' ').trim();
}

/** "Rest 2-3 min." at the start of a generated note, as plan-data's `rest`. */
function splitRest(note: string): { rest: string | null; note: string } {
  const m = /^Rest ([^.]+)\.\s*/.exec(note);
  return m ? { rest: m[1]!.replace(/(\d)-(\d)/g, '$1–$2'), note: note.slice(m[0].length) } : { rest: null, note };
}

/**
 * A program (schema v1) as a plan-data.json object, for the week holding
 * `date`. plan-data holds one rotation of sessions, so the export is one week
 * of the program; everything plan-data cannot hold is listed in
 * `unexpressible` with what to do about it. A program the vault adapter read
 * exports back to the same file while it is unchanged.
 */
export function toPlanData(program: Program, opts: PlanDataExportOptions = {}): Result<PlanDataExport> {
  const extras = (program as Program & Extras)._planData;
  const base = opts.base;
  const top = (extras?.top ?? {}) as Partial<PlanData>;
  const unexpressible: Unexpressible[] = [];
  const say = (what: UnexpressibleKind, detail: string) => {
    if (!unexpressible.some((u) => u.what === what && u.detail === detail)) unexpressible.push({ what, detail });
  };

  // The week to export.
  const weeks = weeksOf(program);
  if (weeks.length === 0) throw new RangeError('the program has no weeks');
  const holding = opts.date ? weeks.find((w) => w.start <= opts.date! && opts.date! <= addDays(w.start, 6)) : undefined;
  let week = holding ?? weeks.find((w) => w.kind === 'loading' && !w.calibration) ?? weeks[0]!;
  if (week.kind === 'deload') {
    const before = weeks.filter((w) => w.kind === 'loading' && w.start < week.start).at(-1);
    say('deload week', `The week of ${week.start} is a deload; plan-data holds the loading week and the dashboard derives every 4th week's deload from it, so the loading week ${before?.start ?? '(none)'} was exported instead.`);
    if (before) week = before;
  }
  if (week.calibration) {
    // plan-data holds the plan's ordinary loading week; Pahlavan calibrates the calibration weeks (rules.calibration) from it.
    const after = weeks.find((w) => w.kind === 'loading' && !w.calibration && w.start > week.start);
    say('calibration week', `The week of ${week.start} is a calibration week (${calibrationNote()}); plan-data holds the loading week and Pahlavan calibrates the plan's calibration weeks (\`rules.calibration\`, plan week 1 by default) from it, so the loading week ${after?.start ?? '(none)'} was exported instead.`);
    if (after) week = after;
  }
  const date = opts.date && holding === week ? opts.date : week.start;

  // Lift and short types.
  const liftKinds = new Set(['lift', 'express']);
  const liftTemplates = week.sessions.filter((t) => liftKinds.has(t.kind));
  const shortTemplates = week.sessions.filter((t) => !liftKinds.has(t.kind));
  const typeOf = (t: SessionTemplate, i: number, lift: boolean): string => {
    const own = (t as SessionTemplate & { _type?: string })._type;
    return own ?? (lift ? LETTERS[i] ?? `L${i + 1}` : `S${i + 1}`);
  };
  const uniq = (ts: SessionTemplate[]) => ts.filter((t, i) => ts.findIndex((x) => x.id === t.id) === i);
  const lifts = uniq(liftTemplates);
  const shorts = uniq(shortTemplates);
  const types: Record<string, string> = {};
  const liftTypes = lifts.map((t, i) => {
    const ty = typeOf(t, i, true);
    types[ty] = t.id;
    return ty;
  });
  const shortTypes = shorts.map((t, i) => {
    const ty = typeOf(t, i, false);
    types[ty] = t.id;
    return ty;
  });
  if (shorts.some((t) => t.kind === 'cardio' || t.kind === 'mobility')) {
    say('conditioning sessions', 'Cardio and mobility sessions are written as short sessions (shortTypes); the dashboard counts them against weekTarget.short.');
  }
  const weekTarget = extras ? (top.weekTarget ?? { lift: liftTemplates.length, short: shortTemplates.length }) : { lift: liftTemplates.length, short: shortTemplates.length };

  // Units.
  const strength = Object.values(program.exercises).filter((e) => (e.kind ?? 'strength') === 'strength' && e.unit);
  const counts = { kg: strength.filter((e) => e.unit === 'kg').length, lb: strength.filter((e) => e.unit === 'lb').length };
  const liftUnit: Unit = opts.liftUnit ?? top.liftUnit ?? base?.liftUnit ?? (counts.kg > counts.lb ? 'kg' : 'lb');

  // Sessions, lifts and guide.
  const guide: Record<string, PlanDataGuide> = {};
  const liftsOut: Record<string, PlanDataLift> = {};
  const baseGuide = base?.guide ?? {};
  const baseGuideKey = (name: string) => Object.keys(baseGuide).find((k) => k.toLowerCase() === name.toLowerCase());
  const usedNames: string[] = [];

  // Exporting a generated program over a base file: a movement keeps the name the plan as written already gives it:
  // the program's spelling (any case) among its `lifts` keys, the names the log holds and its guide keys; else, with
  // `matchId`, a `lifts` key or logged name of the same catalogue movement, then such a guide key. Its history (e1RM,
  // stalls, Pahlavan's Last) is matched by name, so a logged lift is never renamed, even when its guide entry keeps
  // its own tags (an override: said, since that entry's tags then count). A guide key alone with an override is left
  // alone: taking it would change what the item counts.
  const historyNames = base && !extras ? [...Object.keys(base.lifts ?? {}), ...(opts.logNames ?? [])] : [];
  const guideNames = base && !extras ? Object.keys(baseGuide) : [];
  const knownNames = [...historyNames, ...guideNames];
  const overrideFor = (n: string) => {
    const k = baseGuideKey(n);
    const o = k === undefined ? null : overrideOf(baseGuide[k]?.muscles);
    return o?.state === 'active' ? o.reason : null;
  };
  const named = new Map<string, string>();
  const claimed = new Set<string>();
  const nameOf = (id: string): string => {
    const own = program.exercises[id]?.name ?? id;
    if (!knownNames.length) return own;
    const hit = named.get(id);
    if (hit !== undefined) return hit;
    const free = (n: string) => !claimed.has(n.toLowerCase());
    const same = (n: string) => free(n) && opts.matchId!(n) === id;
    const exact = knownNames.find((n) => n.toLowerCase() === own.toLowerCase() && free(n));
    const history = exact === undefined && opts.matchId ? historyNames.find(same) : undefined;
    const fromGuide = exact === undefined && history === undefined && opts.matchId ? guideNames.find((n) => same(n) && overrideFor(n) === null) : undefined;
    const name = exact ?? history ?? fromGuide ?? own;
    const reason = history !== undefined ? overrideFor(history) : null;
    if (reason !== null) say('muscle override', `${name}: kept under its own name, since its history is matched by name; its guide entry's override counts ("${reason}"), not the catalogue's tags for ${own}, so this plan's sets per muscle follow the override, where the proposal counted the catalogue's.`);
    named.set(id, name);
    claimed.add(name.toLowerCase());
    return name;
  };
  // The plan as written's item of that name: in the same session type first (for its "Why:"), else in any session.
  const baseItem = (ty: string, name: string, sameType: boolean): PlanDataItem | undefined => {
    if (!base || extras) return undefined;
    const lower = name.toLowerCase();
    const inType = (base.sessions?.[ty] ?? []).find((i) => i.name?.toLowerCase() === lower);
    if (inType || sameType) return inType;
    for (const items of Object.values(base.sessions ?? {})) {
      const i = items.find((x) => x.name?.toLowerCase() === lower);
      if (i) return i;
    }
    return undefined;
  };
  const noWhy: Record<string, string[]> = {};

  const guideFor = (id: string, ex: Exercise | undefined) => {
    const name = nameOf(id);
    if (guide[name] || usedNames.includes(name.toLowerCase())) return;
    usedNames.push(name.toLowerCase());
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- needed: TypeScript 7, this project's compiler, rejects the line without it (the linter's TypeScript 5 reads the type differently)
    const own = (ex as (Exercise & ExerciseExtras) | undefined)?._guide;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- needed: TypeScript 7, this project's compiler, rejects the line without it (the linter's TypeScript 5 reads the type differently)
    const fromBase = (ex as (Exercise & ExerciseExtras) | undefined)?._guideKey ?? baseGuideKey(name);
    const muscles = ex?.muscles ? toPlanDataMuscles(ex.muscles) : null;
    if (muscles && muscles.approximated.length) {
      say('muscles', `${name}: ${muscles.approximated.join(', ')} ha${muscles.approximated.length > 1 ? 've' : 's'} no plan-data group; written as the nearest one (${muscles.approximated.map((m) => ENGINE_ONLY_MUSCLES[m]).join(', ')}).`);
    }
    const kind = ex?.kind === 'cardio' || ex?.kind === 'mobility' ? ex.kind : undefined;
    const tagged: PlanDataMuscles | undefined = muscles ? { main: muscles.main, helps: muscles.helps, ...(muscles.regions ? { regions: muscles.regions } : {}) } : kind ? { main: [], helps: [], kind } : undefined;
    const prior = own ?? (fromBase ? baseGuide[fromBase] : undefined);
    if (prior) {
      // With the vault's rule the copy becomes what Pahlavan counts for this very entry (an item not counted in sets
      // included), never tags another entry's override gave the program; without it, the program's tags.
      const rule = opts.guideMuscles ? opts.guideMuscles(fromBase ?? name, prior) : null;
      guide[fromBase ?? name] = inStep(prior, rule ? guideCopy(rule) : tagged);
      return;
    }
    guide[name] = tagged ? { muscles: tagged } : {};
    say('guide text', `${name} is new: its guide entry needs setup, do, avoid and q written by hand (plan-files.md, a new movement).`);
  };

  const itemFor = (t: SessionTemplate, ty: string, slot: ExerciseSlot, logged: boolean): PlanDataItem => {
    const eff = effectiveSlot(slot, date).value;
    const ex = program.exercises[slot.exercise];
    const own = (slot as ExerciseSlot & SlotExtras)._item;
    const derived = (slot as ExerciseSlot & SlotExtras)._derived;
    const parsedOwn = own ? parseSr(own.sr) : null;
    // Unchanged since the adapter read it: write it back as it was.
    if (
      own &&
      derived &&
      derived.exercise === slot.exercise &&
      derived.sets === slot.sets &&
      sameRange(derived.repRange, slot.repRange) &&
      derived.rir === slot.rir &&
      derived.until === (slot.until?.until ?? null) &&
      sameTimed(derived.timed, slot.timed) &&
      Boolean(own.logged) === logged
    ) {
      return own;
    }
    const ladderId = own?.ladder ?? slot.progression?.ladder;
    const ladderDef = ladderId ? LADDER_BY_ID.get(ladderId) : undefined;
    const name = own?.ladder ? own.name : ladderDef ? `${ladderDef.name} (your level)` : nameOf(eff.exercise);
    const [lo, hi] = eff.repRange;
    const slotTimed = eff.timed ?? null;
    const timed = slotTimed !== null || (lo === 1 && hi === 1);
    const ownTimed = own ? itemTimed(own) : null;
    const generated = splitRest(eff.note ?? '');
    let sr: string;
    if (own && parsedOwn && (parsedOwn.sets === null || timed) && sameTimed(ownTimed, slotTimed)) sr = own.sr;
    else if (slotTimed && timedMinutes(slotTimed) !== null) sr = `${timedMinutes(slotTimed)} min`;
    else if (timed) {
      const min = /(\d+(?:[–-]\d+)?) min/.exec(eff.note ?? '');
      sr = min ? `${min[1]!.replace('-', '–')} min` : `${eff.sets} × hold`;
      if (!min) say('holds', `${name}: a hold or timed set; written as "${sr}", put the seconds in the sheet by hand.`);
    } else sr = formatSr(eff.sets, eff.repRange, { per: parsedOwn?.per ?? null, seconds: parsedOwn?.seconds ?? false });
    const notes: string[] = [];
    if (slot.until && date <= slot.until.until) {
      const changed = slot.until.exercise && slot.until.exercise !== slot.exercise;
      notes.push(`until ${slot.until.until}: ${slot.until.reason}.${changed ? ` Replaces ${nameOf(slot.exercise)}.` : ''}${slot.until.note ? ` ${slot.until.note}` : ''}`);
    }
    // The RIR goes in the item's `rir` field, never into the note; a range the item had ("RIR 1–2") stays while its
    // target (the low end) is the slot's.
    const rirRequired = ex?.kind === undefined || ex.kind === 'strength';
    const ownRir = own ? itemRir(own) : null;
    const rir: PlanDataItem['rir'] = !rirRequired || timed ? undefined : ownRir && ownRir.lo === eff.rir ? (ownRir.lo === ownRir.hi ? ownRir.lo : [ownRir.lo, ownRir.hi]) : eff.rir;
    const rest = own ? withoutRirSentences((own.note ?? '').replace(/until \d{4}-\d{2}-\d{2}:[^]*?(?:\.\s|\.$|$)/, '').replace(/\bReplaces [^.]+\.\s*/, '')) : generated.note;
    if (rest) notes.push(rest);
    const left = noteRir(rest);
    if (rir !== undefined && left && left.lo !== (typeof rir === 'number' ? rir : rir[0])) say('RIR in a note', `${t.name} ${name}: the note still says RIR ${left.lo === left.hi ? left.lo : `${left.lo}–${left.hi}`} and the item's rir is ${typeof rir === 'number' ? rir : rir.join('–')}; rewrite the note's sentence (the rir field counts).`);
    const noteTimed = own ? timedFromText('', own.note) : null;
    if (slotTimed && isIntervals(noteTimed) && !(noteTimed.rounds === slotTimed.rounds && noteTimed.workMin === slotTimed.workMin && noteTimed.restMin === slotTimed.restMin)) {
      say('intervals in a note', `${t.name} ${name}: the note still describes ${noteTimed.rounds} × ${noteTimed.workMin} min and the item's timed field has ${slotTimed.rounds ?? 0} rounds of ${slotTimed.workMin ?? 0} min; rewrite the note (the timed field counts).`);
    }
    if (slot.swaps?.length) say('swaps', `${t.name} ${name}: swaps (${slot.swaps.map(nameOf).join(', ')}) have no field; name them in the note or the month plan.`);
    // Over a base file, the plan as written's item for this movement keeps its sheet and short names; in the same
    // session with the same sets and reps it is unchanged, so its "Why:" line (the coach's reason) still holds.
    const prior = own ? undefined : baseItem(ty, name, false);
    const samePrior = own ? undefined : baseItem(ty, name, true);
    const priorWhy = samePrior ? parseNote(samePrior.note).why : null;
    if (priorWhy && samePrior!.sr === sr && !parseNote(notes.join(' ')).why) notes.push(`Why: ${priorWhy}`);
    const item: PlanDataItem = {
      name,
      table: own?.table ?? prior?.table ?? name,
      sr,
      rest: own?.rest ?? generated.rest ?? (timed ? '—' : '90 s'),
      note: notes.join(' '),
      label: own?.label ?? prior?.label ?? name,
    };
    if (!own && !parseNote(item.note).why) {
      const hint = priorWhy ? ` (its sets and reps were "${samePrior!.sr}"; the plan as written gave "Why: ${priorWhy}")` : '';
      (noWhy[ty] ??= []).push(`${name}${hint}`);
    }
    // The rest of the plan as written's note (a form cue, a temporary change) is the coach's; the export writes the
    // program's note, so what it leaves out is listed, never dropped silently.
    if (prior) {
      const cue = noteCue(prior.note);
      if (cue && !item.note!.includes(cue)) say('note cues', `${ty} ${name}: the plan as written's note says "${cue}"; the export writes the program's note, so carry the cue over if it still holds.`);
      const until = parseNote(prior.note).until;
      if (until) say('temporary changes', `${ty} ${name}: the plan as written has a temporary change (until ${until.date}: ${until.reason}) the export doesn't carry; write it again with its until date if it still applies (plan-files.md, a temporary change), or let it end.`);
    }
    if (rir !== undefined) item.rir = rir;
    // The structure goes in `timed` when it holds more than the minutes `sr` already says (or the item had the field).
    if (slotTimed && (isIntervals(slotTimed) || slotTimed.warmupMin !== undefined || slotTimed.cooldownMin !== undefined || own?.timed !== undefined)) item.timed = { ...slotTimed };
    if (logged) item.logged = true;
    if (ladderId) item.ladder = ladderId;
    if (own?.pair || slot.pair) item.pair = true;
    return ordered(item, ITEM_KEYS);
  };

  const sessions: Record<string, PlanDataItem[]> = {};
  const laddersUsed = new Set<string>();
  // The level each ladder starts at in this program (the self-check's), written as the ladder's startLevel.
  const ladderStarts = new Map<string, number>();
  const addTemplate = (t: SessionTemplate, ty: string, lift: boolean) => {
    // A ladder item is the user's level, never a logged lift (the dashboard logs a weight for those).
    const onLadder = (s: ExerciseSlot) => s.progression?.rule === 'ladder' && s.progression.ladder !== undefined;
    const mains = t.slots.filter((s) => s.main && !onLadder(s));
    let logged = new Set(mains.slice(0, 2));
    if (lift) {
      if (mains.length !== 2) {
        const strengthSlots = t.slots.filter((s) => !onLadder(s) && (program.exercises[s.exercise]?.kind ?? 'strength') === 'strength' && program.exercises[s.exercise]?.unit);
        logged = new Set([...mains, ...strengthSlots.filter((s) => !mains.includes(s))].slice(0, 2));
        say('logged lifts', `${t.name}: the dashboard logs exactly two lifts a session; ${mains.length} main lift(s) in the program, so ${[...logged].map((s) => nameOf(s.exercise)).join(' and ')} are marked logged.`);
      }
    } else logged = new Set();
    sessions[ty] = t.slots.map((slot) => {
      const ex = program.exercises[slot.exercise];
      guideFor(slot.exercise, ex);
      const item = itemFor(t, ty, slot, logged.has(slot));
      if (item.logged) {
        const eff = effectiveSlot(slot, date).value;
        const e = program.exercises[eff.exercise];
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- needed: TypeScript 7, this project's compiler, rejects the line without it (the linter's TypeScript 5 reads the type differently)
        const own = (e as (Exercise & ExerciseExtras) | undefined)?._lift;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- needed: TypeScript 7, this project's compiler, rejects the line without it (the linter's TypeScript 5 reads the type differently)
        const key = (e as (Exercise & ExerciseExtras) | undefined)?._liftKey ?? item.name;
        const unit = e?.unit ?? liftUnit;
        const inc = e?.increment ?? (unit === 'kg' ? 2.5 : 5);
        let lo = eff.repRange[0];
        const hi = eff.repRange[1];
        let step = inc;
        if (slot.progression?.rule === 'linear') {
          lo = hi;
          step = slot.progression.step ?? inc;
          say('linear progression', `${item.name}: linear progression written as lo = hi (${hi}) with inc ${step}, so the dashboard adds a step every session the reps are made (planning.md).`);
        }
        if (slot.progression?.rule === 'wave') say('wave progression', `${item.name}: the weekly RIR wave (3, 2, 1) has no field; the dashboard runs double progression, so the letters give each week's RIR.`);
        if (own && own.lo === lo && own.hi === hi && own.inc === step && (own.unit ?? liftUnit) === unit) liftsOut[key] = own;
        else {
          // Over a base file, the lift's entry as written gives its short name (what `next --lift` and the screens use).
          const baseKey = !extras ? Object.keys(base?.lifts ?? {}).find((k) => k.toLowerCase() === key.toLowerCase()) : undefined;
          const baseLift = baseKey ? base!.lifts[baseKey] : undefined;
          const lift: PlanDataLift = { short: own?.short ?? baseLift?.short ?? item.label ?? item.name, lo, hi, inc: step };
          // A generated lift's rule is written with it (linear, else double); a lift the adapter read keeps its own, and
          // so does a lift the base file (--vault) already gives a rule: the coach's rule wins, the difference listed.
          if (!extras && own?.progression === undefined) {
            const generated = { rule: slot.progression?.rule === 'linear' ? 'linear' : 'double' };
            const kept = baseLift?.progression;
            lift.progression = kept ?? generated;
            if (kept !== undefined && (kept as { rule?: unknown }).rule !== generated.rule) say('standing rules kept', `${key}: the plan's own progression (${JSON.stringify(kept)}) is kept; the generated program's is ${JSON.stringify(generated)}.`);
          }
          if (unit !== liftUnit) lift.unit = unit;
          if (own?.db ?? e?.equipment === 'dumbbell') lift.db = true;
          if (own?.chart ?? baseLift?.chart) lift.chart = (own?.chart ?? baseLift?.chart)!;
          if (own?.step !== undefined) lift.step = own.step;
          // The coach's progression rule stays when the range or the step changes: it is the coach's to revise.
          if (own?.progression !== undefined) lift.progression = own.progression;
          liftsOut[key] = ordered(lift, LIFT_KEYS);
        }
        if (eff.exercise !== slot.exercise) guideFor(eff.exercise, e);
      }
      if (slot.progression?.rule === 'ladder' && slot.progression.ladder && slot.progression.level && !(slot as ExerciseSlot & SlotExtras)._item?.ladder) {
        laddersUsed.add(slot.progression.ladder);
        ladderStarts.set(slot.progression.ladder, slot.progression.level);
        say('ladder levels', `${item.name}: the ${slot.progression.ladder} ladder starts at level ${slot.progression.level} (the self-check), written as the ladder's startLevel so the draft counts that level; the level history starts in the log, so set it in the log with \`engine log ladder --id ${slot.progression.ladder} --level ${slot.progression.level} --date ${week.start} --write\`.`);
      } else if (slot.progression?.rule === 'ladder' && !(slot as ExerciseSlot & SlotExtras)._item?.ladder) {
        say('ladders', `${item.name}: a ladder progression (next: ${slot.progression.next ? nameOf(slot.progression.next) : 'a harder variation'}) is written as a plain item; plan-data's ladders need their levels written by hand.`);
      }
      return item;
    });
  };
  lifts.forEach((t, i) => addTemplate(t, liftTypes[i]!, true));
  shorts.forEach((t, i) => addTemplate(t, shortTypes[i]!, false));
  // Every item's note ends with its reason; the program has none to give a new item, so the coach writes them.
  for (const ty of [...liftTypes, ...shortTypes]) {
    const missing = noWhy[ty];
    if (missing?.length) say('why lines', `${ty}: ${missing.join('; ')} ${missing.length > 1 ? 'have' : 'has'} no "Why:" line; end each note with one (the intake fact or rule it comes from) before the write (plan-files.md).`);
  }

  // Everything plan-data cannot hold.
  if (!extras) {
    const phases = program.macrocycle.phases;
    const mesoWeeks = phases.flatMap((p) => p.mesocycles.map((m) => m.weeks.length));
    const fixed = phases.every((p) => p.mesocycles.length === 2);
    say(
      'phases',
      `${phases.length} phase(s), ${mesoWeeks.length} mesocycle(s) over ${weeks.length} weeks: plan-data holds one rotation. Pahlavan ends a mesocycle at each of the plan's light weeks (\`rules.lightWeeks\`, written from the program) and makes a phase of two, counting from the first logged plan session.${fixed ? '' : ' This program has phases of other than two mesocycles, so Pahlavan\'s phases differ from its own; the letters carry the difference.'} Write each later month through plan-files.md ("The next month").`,
    );
    const later = weeks.filter((w) => w.kind === 'loading' && w.start > week.start && !w.calibration);
    const sig = (w: Week) => JSON.stringify(w.sessions.map((t) => [t.id, t.slots.map((s) => [s.exercise, s.sets, s.repRange])]));
    const change = later.find((w) => sig(w) !== sig(week));
    if (change) say('later weeks', `The sessions change from the week of ${dayText(change.start)} (accessory rotation or a new phase); export that week with --start when its month comes.`);
    // The calibration, light and test weeks are written as the plan's standing rules (rules.ts), below.
    say('standing rules', `The program's calibration, light and test weeks and each logged lift's progression are written as standing rules (\`rules\`, \`lifts[].progression\`); the coach declares the rest (readiness, soreness, missed time, stalls, Hotel) at the next check-in.`);
    if (program.priorityMuscles?.length) say('priority muscles', `Priority muscles (${program.priorityMuscles.join(', ')}) have no field; the Athlete profile keeps them.`);
    if (program.deskBreaks?.why?.length) say('desk-break reasons', 'The desk breaks\' reasons have no field: deskRoutine holds the steps and deskTiming the times, and the desk-break item\'s why in Coach/tracking.json carries the reasons.');
  }

  // Assemble, carrying over what the program cannot express.
  const pick = <K extends keyof PlanData>(k: K, fallback: PlanData[K]): PlanData[K] => top[k] ?? base?.[k] ?? fallback;
  const firstLift = sessions[liftTypes[0] ?? '']?.filter((i) => i.logged) ?? [];
  const planData: PlanData = {
    _about: pick('_about', DEFAULT_ABOUT),
    weekTarget,
    liftTypes,
    shortTypes,
    titles: extras ? pick('titles', {}) : Object.fromEntries([...lifts, ...shorts].map((t, i) => [[...liftTypes, ...shortTypes][i]!, t.name])),
    shortNames: extras ? pick('shortNames', {}) : Object.fromEntries(shorts.map((t, i) => [shortTypes[i]!, t.name])),
    focus: extras ? pick('focus', {}) : Object.fromEntries(lifts.map((t, i) => [liftTypes[i]!, t.name])),
    warmups: pick('warmups', { lift: (opts.warmUp ?? []).join(' · '), short: (opts.warmUp ?? []).slice(0, 2).join(' · ') }),
    sessions,
    liftUnit,
    lifts: {},
    express: pick('express', { warmup: 'Warm-up: 3 min easy', mainSets: '2 working sets', secondSets: '2 sets', finish: { name: firstLift[1]?.name ?? 'Face Pull', sr: '2 × 15' } }),
    deloadS3: pick('deloadS3', []),
    // The base file's ladders, plus the engine's definition of any ladder a slot uses that the base lacks; each
    // ladder the program starts at a level carries it as startLevel (the program's level over the base's own).
    ladders: (() => {
      const started = (l: PlanDataLadder): PlanDataLadder => (ladderStarts.has(l.id) ? { ...l, startLevel: ladderStarts.get(l.id)! } : l);
      const have = pick('ladders', []);
      const add = [...laddersUsed].filter((id) => !have.some((l) => l.id === id)).map((id) => {
        const l = LADDER_BY_ID.get(id)!;
        return { id: l.id, name: l.name, levels: l.levels.map((x) => (x.detail ? { name: x.name, detail: x.detail } : { name: x.name })) };
      });
      return [...have, ...add].map(started);
    })(),
    laddersFor: pick('laddersFor', {}),
    ladderNote: pick('ladderNote', ''),
    guide: {},
    muscles: pick('muscles', { ...PLAN_DATA_MUSCLE_LABELS }),
    // A generated plan's desk breaks become the routine and its times; a plan the adapter read keeps the file's.
    deskRoutine: !extras && program.deskBreaks ? program.deskBreaks.steps.map((x) => ({ name: x.name, dose: x.dose })) : pick('deskRoutine', []),
    deskTiming: !extras && program.deskBreaks ? { every: program.deskBreaks.every, from: program.deskBreaks.from, to: program.deskBreaks.to, minutes: program.deskBreaks.minutes, days: [...program.deskBreaks.days] } : pick('deskTiming', undefined),
  };
  // The phases' names: a generated plan writes its own (Foundation, Build, Peak); a plan the adapter
  // read keeps the file's (none when it had none, so it reads back the same).
  const phaseNames = extras ? top['phases'] : program.macrocycle.phases.map((p) => ({ name: p.name, ...(p.goal ? { goal: p.goal } : {}) }));
  if (phaseNames) planData.phases = phaseNames;
  // A generated plan's length; a plan the adapter read keeps the file's (carried over with its other keys).
  if (!extras) planData.weeks = weeks.length;
  // The chosen start (`plan --start D`): the program's week 1, so Pahlavan's plan weeks match the generator's dates from day one.
  // Without it, an export over the plan as written keeps that plan's start: a new block inside the plan never restarts week 1.
  if (!extras && opts.start) planData.start = program.macrocycle.start;
  else if (!extras && base && base.start !== undefined) planData.start = base.start;
  // A generated plan lands with its standing rules declared: the program's calibration, light and test weeks, filling
  // only what the base file (--vault) does not declare; the coach's own rules are kept, a difference listed.
  if (!extras) {
    const own = base && typeof base.rules === 'object' && base.rules !== null && !Array.isArray(base.rules) ? base.rules : {};
    const generated = generatedRules(weeks);
    const rules: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(generated)) {
      rules[k] = k in own ? own[k] : v;
      if (k in own && JSON.stringify(own[k]) !== JSON.stringify(v)) say('standing rules kept', `rules.${k}: the plan's own rule (${JSON.stringify(own[k])}) is kept; the generated program's would be ${JSON.stringify(v)}.`);
    }
    for (const [k, v] of Object.entries(own)) if (!(k in rules)) rules[k] = v;
    planData.rules = rules;
  }
  if (!extras && !base) {
    say('express', 'Express (the 20-minute version) is written with defaults: 2 working sets of each main lift and 2 sets of the finisher; check its warm-up line.');
    say('ladders', 'No base plan-data.json (no --vault, or no plan written yet): ladders, the ladder note, the warm-ups and the desk routine are empty; over a written plan (--vault) they carry over.');
  }

  // Lifts and guide in their original order, then the new ones. A program the
  // adapter read keeps every lifts entry it had, used this week or not.
  const liftOrder = extras?.liftsOrder ?? Object.keys(base?.lifts ?? {});
  if (extras) {
    for (const ex of Object.values(program.exercises) as (Exercise & ExerciseExtras)[]) {
      if (ex._lift && ex._liftKey && !(ex._liftKey in liftsOut)) liftsOut[ex._liftKey] = ex._lift;
    }
  }
  for (const k of liftOrder) if (liftsOut[k]) planData.lifts[k] = liftsOut[k]!;
  for (const [k, v] of Object.entries(liftsOut)) if (!(k in planData.lifts)) planData.lifts[k] = v;
  const guideOrder = extras?.guideOrder ?? Object.keys(baseGuide);
  // Keep every guide entry the plan had (ladder levels, the desk routine, past movements).
  const carried: Record<string, PlanDataGuide> = {};
  if (extras) {
    for (const ex of Object.values(program.exercises) as (Exercise & ExerciseExtras)[]) if (ex._guide) carried[ex._guideKey ?? ex.name] = ex._guide;
  } else Object.assign(carried, baseGuide);
  if (opts.guideMuscles) {
    for (const [k, v] of Object.entries(carried)) {
      const t = opts.guideMuscles(k, v);
      if (t) carried[k] = inStep(v, guideCopy(t));
    }
  }
  const keyFor = (name: string) => Object.keys(guide).find((k) => k.toLowerCase() === name.toLowerCase());
  for (const k of guideOrder) {
    const own = keyFor(k);
    if (own) planData.guide[k] = guide[own]!;
    else if (carried[k]) planData.guide[k] = carried[k]!;
  }
  for (const [k, v] of Object.entries(guide)) if (!Object.keys(planData.guide).some((g) => g.toLowerCase() === k.toLowerCase())) planData.guide[k] = v;

  // Top-level keys plan-data has that this module does not know are carried over.
  for (const [k, v] of Object.entries(top)) if (!(k in planData)) (planData as unknown as Record<string, unknown>)[k] = v;
  const out = ordered(planData, extras?.topOrder ?? (PLAN_DATA_KEYS as readonly string[]));
  if (out._about === undefined) delete out._about;
  return explain<PlanDataExport>(
    { planData: out, week: { start: week.start, index: week.index, kind: week.kind }, types, unexpressible },
    'plan-data.export',
    { program: program.id, week: week.start, liftTypes, shortTypes, fromVault: Boolean(extras), base: Boolean(base) },
    {
      note: `${liftTypes.length} lifting and ${shortTypes.length} short session type(s) from the week of ${dayText(week.start)}; ${unexpressible.length} thing(s) plan-data cannot express are listed.`,
    },
  );
}
