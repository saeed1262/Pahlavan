// The current dashboard's plan file, plan-data.json: its shape, the muscle id
// mapping, and the `sr` and `note` conventions. Pure: the vault adapter reads
// the file and calls the parsers here.

import { isIsoDate, mondayOf } from './dates.ts';
import { DELOAD } from './deload.ts';
import type { IsoDate, MuscleTags, RepRange, TimedWork, Unit, Weekday } from './schema.ts';
import { readTimed, timedFromText, timedSets } from './timed.ts';

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
   * `helps`, a copy of the catalogue's for a movement the catalogue knows;
   * they count only for a movement it does not know, or with an `override`.
   */
  regions?: string[];
  /**
   * Why this entry keeps its own `main` and `helps` for a movement the
   * engine's catalogue knows. Without it the catalogue's tags count and the
   * entry's are a copy; with it (a non-empty reason) the entry's tags count
   * everywhere.
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
   * the first plan of a fresh start or a reset, and every later change keeps
   * it; `engine draft` carries it over from the plan as written.
   */
  start?: IsoDate;
  /** The plan's length in weeks (without it, 24): the top bar's "Week N of M". */
  weeks?: number;
  /**
   * The coach's standing rules (rules.ts, readRules): calibration, light
   * weeks, tests, readiness, soreness, missed time, stalls and Hotel. A kind
   * left out is Pahlavan's old default, with a `legacy-default` warning.
   */
  rules?: Record<string, unknown>;
  /** The coach's stated reasons for going outside an evidence range (overrides.ts, readOverrides): `engine check` turns each matched warning into information. */
  overrides?: unknown[];
  /** The coach's reasons for the plan, to the person (plan-why.ts, readPlanWhy): the Plan tab's Why this plan card. `engine draft` never carries it. */
  why?: unknown;
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
  // The coach's reasons for the plan, to the person (plan-why.ts): the Plan tab's Why this plan card.
  'why',
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
 * each counts as on plan-data's map (`toPlanDataMuscles` lists them as
 * approximations).
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
 * Progress, the movement guide and `check` all read catalogue tags through
 * this.
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

/** A guide entry's `muscles.override` reason, or null when it has none (missing, not a string, or blank). */
export function overrideReason(muscles: unknown): string | null {
  const o = typeof muscles === 'object' && muscles !== null ? (muscles as { override?: unknown }).override : undefined;
  return typeof o === 'string' && o.trim() ? o.trim() : null;
}

/**
 * A guide entry's override as Pahlavan reads it: `active` with its reason
 * when it is a non-empty reason beside at least one main muscle; `ignored`
 * with why when the entry has an `override` key that fails that (the
 * catalogue's tags then count); `none` without the key.
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

/**
 * Kept on a slot the vault adapter built from plan-data.json: the item as
 * read, for the screens that show its own text (its `sr`, note and pair).
 * Stored under a key starting with "_", which schema v1 allows anywhere.
 */
export interface SlotExtras {
  _item?: PlanDataItem;
}

/**
 * Kept on an exercise the adapter built: its guide entry as read (review reads
 * a circuit's muscles from it) and its lifts entry (its `db` flag picks the
 * dumbbell kit among the gym's real weights).
 */
export interface ExerciseExtras {
  _guide?: PlanDataGuide;
  _lift?: PlanDataLift;
}

/**
 * Every kind of thing plan-data can't hold, in the order a coach meets them:
 * `engine --version --json` gives them (its `facts`) so the coach's docs can
 * name only the kinds that exist.
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
  /** One of UNEXPRESSIBLE. */
  what: string;
  detail: string;
}
