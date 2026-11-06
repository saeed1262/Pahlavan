// The current dashboard's plan file, plan-data.json: its shape, the muscle id
// mapping, the `sr` and `note` conventions, and the exporter from a schema-v1
// program back to that shape. Pure: the vault adapter reads the file and calls
// the parsers here; the exporter returns an object for the skill to write
// through its own propose-then-write steps.

import { LADDER_BY_ID } from './data/ladders.ts';
import { MUSCLES } from './data/muscles.ts';
import { addDays, dayText } from './dates.ts';
import { DELOAD } from './deload.ts';
import { effectiveSlot } from './plan.ts';
import { explain, type Result } from './reason.ts';
import type { Exercise, ExerciseSlot, IsoDate, MuscleTags, Program, RepRange, SessionTemplate, Unit, Week, Weekday } from './schema.ts';

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
}

export interface PlanDataMuscles {
  main: string[];
  helps: string[];
  kind?: 'cardio' | 'mobility';
  areas?: string[];
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
  express: { warmup: string; mainSets: string; secondSets: string; finish: { name: string; sr: string } };
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
  /** The plan's length in weeks (a generated plan writes it; without it, 24): the top bar's "Week N of M". */
  weeks?: number;
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
  'weeks',
] as const;
export const ITEM_KEYS = ['name', 'table', 'sr', 'rest', 'note', 'label', 'logged', 'ladder', 'pair'] as const;
export const LIFT_KEYS = ['short', 'unit', 'lo', 'hi', 'inc', 'db', 'chart', 'step'] as const;

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

/** Maps plan-data muscle ids to engine ids; unknown ids are returned separately. */
export function toEngineMuscles(tags: { main?: readonly string[]; helps?: readonly string[] }): { muscles: MuscleTags; unknown: string[] } {
  const unknown: string[] = [];
  const map = (ids: readonly string[] = []) =>
    ids.flatMap((id) => {
      const m = PLAN_DATA_MUSCLES[id];
      if (m === undefined) {
        unknown.push(id);
        return [];
      }
      return [m];
    });
  return { muscles: { main: map(tags.main), helps: map(tags.helps) }, unknown };
}

/** Maps engine muscle ids to plan-data ids; approximated ids are listed. */
export function toPlanDataMuscles(tags: MuscleTags): { main: string[]; helps: string[]; approximated: string[] } {
  const approximated: string[] = [];
  const map = (ids: readonly string[]) => {
    const out: string[] = [];
    for (const id of ids) {
      const p = PLAN_DATA_FROM_ENGINE[id] ?? id;
      if (id in ENGINE_ONLY_MUSCLES) approximated.push(id);
      if (!out.includes(p)) out.push(p);
    }
    return out;
  };
  return { main: map(tags.main), helps: map(tags.helps), approximated };
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
 * minutes (at least 1); otherwise 1. Session snapshots carry this number.
 */
export function dashboardSets(sr: string): number {
  const s = String(sr ?? '');
  const n = /(\d+)\s*×/.exec(s) ?? /(\d+)\s*(?:working\s+)?sets?\b/i.exec(s);
  if (n) return Number(n[1]);
  const min = /(\d+)(?:\s*[–-]\s*\d+)?\s*min/.exec(s);
  return min ? Math.max(1, Math.round(Number(min[1]) / 2)) : 1;
}

/** The dashboard's deload sets: every "N ×" becomes "2 ×" (its toDeloadSets). */
export function deloadSr(sr: string): string {
  return sr.replace(/(^|\/\s*)\d+ ×/g, (_m, pre: string) => `${pre}${DELOAD.legacySets} ×`);
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
  _derived?: { exercise: string; sets: number; repRange: RepRange; rir: number; until: IsoDate | null };
}

/** Kept on an exercise the adapter built: its guide and lifts entries, under their keys. */
export interface ExerciseExtras {
  _guideKey?: string;
  _guide?: PlanDataGuide;
  _liftKey?: string;
  _lift?: PlanDataLift;
}

export interface Unexpressible {
  what: string;
  detail: string;
}

export interface PlanDataExportOptions {
  /** Export the week holding this date (default: the first loading week after calibration). */
  date?: IsoDate;
  /** The current plan-data.json: warm-ups, ladders, guide text and the desk routine carry over from it. */
  base?: PlanData;
  /** plan-data's `liftUnit` (default: the base's, else the most common unit of the strength exercises). */
  liftUnit?: Unit;
  /** The proposal's warm-up lines, used when there is no base. */
  warmUp?: readonly string[];
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
  'Single source of truth for the fitness plan. Generated by the Pahlavan engine from a schema-v1 program; edit here, then run gen-fitness-plan.py.';
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
  const say = (what: string, detail: string) => {
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
  const liftUnit: Unit = opts.liftUnit ?? (top.liftUnit as Unit | undefined) ?? base?.liftUnit ?? (counts.kg > counts.lb ? 'kg' : 'lb');

  // Sessions, lifts and guide.
  const nameOf = (id: string) => program.exercises[id]?.name ?? id;
  const guide: Record<string, PlanDataGuide> = {};
  const liftsOut: Record<string, PlanDataLift> = {};
  const baseGuide = base?.guide ?? {};
  const baseGuideKey = (name: string) => Object.keys(baseGuide).find((k) => k.toLowerCase() === name.toLowerCase());
  const usedNames: string[] = [];

  const guideFor = (id: string, ex: Exercise | undefined) => {
    const name = nameOf(id);
    if (guide[name] || usedNames.includes(name.toLowerCase())) return;
    usedNames.push(name.toLowerCase());
    const own = (ex as (Exercise & ExerciseExtras) | undefined)?._guide;
    const fromBase = (ex as (Exercise & ExerciseExtras) | undefined)?._guideKey ?? baseGuideKey(name);
    const muscles = ex?.muscles ? toPlanDataMuscles(ex.muscles) : null;
    if (muscles && muscles.approximated.length) {
      say('muscles', `${name}: ${muscles.approximated.join(', ')} ha${muscles.approximated.length > 1 ? 've' : 's'} no plan-data group; written as the nearest one (${muscles.approximated.map((m) => ENGINE_ONLY_MUSCLES[m]).join(', ')}).`);
    }
    const kind = ex?.kind === 'cardio' || ex?.kind === 'mobility' ? ex.kind : undefined;
    const tagged: PlanDataMuscles | undefined = muscles ? { main: muscles.main, helps: muscles.helps } : kind ? { main: [], helps: [], kind } : undefined;
    const prior = own ?? (fromBase ? baseGuide[fromBase] : undefined);
    if (prior) {
      const pm = prior.muscles;
      const same = !tagged || (pm && pm.main.join() === tagged.main.join() && pm.helps.join() === tagged.helps.join() && (pm.kind ?? undefined) === (tagged.kind ?? undefined));
      guide[fromBase ?? name] = same ? prior : { ...prior, muscles: tagged };
      return;
    }
    guide[name] = tagged ? { muscles: tagged } : {};
    say('guide text', `${name} is new: its guide entry needs setup, do, avoid and q written by hand (plan-files.md, a new movement).`);
  };

  const itemFor = (t: SessionTemplate, slot: ExerciseSlot, logged: boolean): PlanDataItem => {
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
      Boolean(own.logged) === logged
    ) {
      return own;
    }
    const ladderId = own?.ladder ?? slot.progression?.ladder;
    const ladderDef = ladderId ? LADDER_BY_ID.get(ladderId) : undefined;
    const name = own?.ladder ? own.name : ladderDef ? `${ladderDef.name} (your level)` : nameOf(eff.exercise);
    const [lo, hi] = eff.repRange;
    const timed = lo === 1 && hi === 1;
    const generated = splitRest(eff.note ?? '');
    let sr: string;
    if (own && parsedOwn && (parsedOwn.sets === null || timed)) sr = own.sr;
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
    const rirRequired = ex?.kind === undefined || ex.kind === 'strength';
    if (rirRequired && !timed) notes.push(`RIR ${eff.rir}.`);
    const rest = own ? (own.note ?? '').replace(/until \d{4}-\d{2}-\d{2}:[^]*?(?:\.\s|\.$|$)/, '').replace(/\bReplaces [^.]+\.\s*/, '').replace(/\bRIR \d+(?:\.\d+)?\.?\s*/, '').trim() : generated.note;
    if (rest) notes.push(rest);
    if (slot.swaps?.length) say('swaps', `${t.name} ${name}: swaps (${slot.swaps.map(nameOf).join(', ')}) have no field; name them in the note or the month plan.`);
    const item: PlanDataItem = {
      name,
      table: own?.table ?? name,
      sr,
      rest: own?.rest ?? generated.rest ?? (timed ? '—' : '90 s'),
      note: notes.join(' '),
      label: own?.label ?? name,
    };
    if (logged) item.logged = true;
    if (ladderId) item.ladder = ladderId;
    if (own?.pair || slot.pair) item.pair = true;
    return ordered(item, ITEM_KEYS);
  };

  const sessions: Record<string, PlanDataItem[]> = {};
  const laddersUsed = new Set<string>();
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
      const item = itemFor(t, slot, logged.has(slot));
      if (item.logged) {
        const eff = effectiveSlot(slot, date).value;
        const e = program.exercises[eff.exercise];
        const own = (e as (Exercise & ExerciseExtras) | undefined)?._lift;
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
          const lift: PlanDataLift = { short: own?.short ?? item.label ?? item.name, lo, hi, inc: step };
          if (unit !== liftUnit) lift.unit = unit;
          if (own?.db ?? e?.equipment === 'dumbbell') lift.db = true;
          if (own?.chart) lift.chart = own.chart;
          if (own?.step !== undefined) lift.step = own.step;
          liftsOut[key] = ordered(lift, LIFT_KEYS);
        }
        if (eff.exercise !== slot.exercise) guideFor(eff.exercise, e);
      }
      if (slot.progression?.rule === 'ladder' && slot.progression.ladder && slot.progression.level && !(slot as ExerciseSlot & SlotExtras)._item?.ladder) {
        laddersUsed.add(slot.progression.ladder);
        say('ladder levels', `${item.name}: the ${slot.progression.ladder} ladder starts at level ${slot.progression.level} (the self-check); set it in the log with fitness_log.py ladder ${slot.progression.ladder} ${slot.progression.level} --date ${week.start}.`);
      } else if (slot.progression?.rule === 'ladder' && !(slot as ExerciseSlot & SlotExtras)._item?.ladder) {
        say('ladders', `${item.name}: a ladder progression (next: ${slot.progression.next ? nameOf(slot.progression.next) : 'a harder variation'}) is written as a plain item; plan-data's ladders need their levels written by hand.`);
      }
      return item;
    });
  };
  lifts.forEach((t, i) => addTemplate(t, liftTypes[i]!, true));
  shorts.forEach((t, i) => addTemplate(t, shortTypes[i]!, false));

  // Everything plan-data cannot hold.
  if (!extras) {
    const phases = program.macrocycle.phases;
    const mesoWeeks = phases.flatMap((p) => p.mesocycles.map((m) => m.weeks.length));
    const fixed = phases.every((p) => p.mesocycles.length === 2) && mesoWeeks.every((n) => n === 4) && phases.length <= 3;
    say(
      'phases',
      `${phases.length} phase(s), ${mesoWeeks.length} mesocycle(s) over ${weeks.length} weeks: plan-data holds one rotation, and the dashboard flips phases at weeks 8, 16 and 24 and deloads every 4th week counted from the first logged plan session.${fixed ? '' : ' This program does not fit fixed 8-week phases of two 4-week mesocycles; the letters carry the difference.'} Write each later month through plan-files.md ("The next month").`,
    );
    const later = weeks.filter((w) => w.kind === 'loading' && w.start > week.start && !w.calibration);
    const sig = (w: Week) => JSON.stringify(w.sessions.map((t) => [t.id, t.slots.map((s) => [s.exercise, s.sets, s.repRange])]));
    const change = later.find((w) => sig(w) !== sig(week));
    if (change) say('later weeks', `The sessions change from the week of ${dayText(change.start)} (accessory rotation or a new phase); export that week with --start when its month comes.`);
    if (weeks.some((w) => w.calibration)) say('calibration week', 'The calibration week (RIR 3, find working weights) has no field: the month note and the first letter carry it.');
    if (weeks.some((w) => w.tests)) say('test weeks', 'Test and photo weeks have no field: the roadmap and the month note list them.');
    say('RIR targets', 'RIR has no field: each target is written into the item note ("RIR 2.").');
    const odd = week.sessions.flatMap((t) => t.slots).filter((s) => s.sets === 2 || s.sets >= 5);
    say(
      'deload prescription',
      `The dashboard deloads every exercise to 2 sets about 10 % lighter, not half the sets at RIR +3.${odd.length ? ` They differ for ${[...new Set(odd.map((s) => `${nameOf(s.exercise)} (${s.sets} sets)`))].join(', ')}; the letter gives that week's sets.` : ' For 3-4-set exercises they agree.'}`,
    );
    if (program.priorityMuscles?.length) say('priority muscles', `Priority muscles (${program.priorityMuscles.join(', ')}) have no field; the Athlete profile keeps them.`);
    if (program.deskBreaks?.why?.length) say('desk-break reasons', 'The desk breaks\' reasons have no field: deskRoutine holds the steps and deskTiming the times, and the desk-break item\'s why in Coach/tracking.json carries the reasons.');
  }

  // Assemble, carrying over what the program cannot express.
  const pick = <K extends keyof PlanData>(k: K, fallback: PlanData[K]): PlanData[K] => (top[k] as PlanData[K] | undefined) ?? base?.[k] ?? fallback;
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
    // The base file's ladders, plus the engine's definition of any ladder a slot uses that the base lacks.
    ladders: (() => {
      const have = pick('ladders', []);
      const add = [...laddersUsed].filter((id) => !have.some((l) => l.id === id)).map((id) => {
        const l = LADDER_BY_ID.get(id)!;
        return { id: l.id, name: l.name, levels: l.levels.map((x) => (x.detail ? { name: x.name, detail: x.detail } : { name: x.name })) };
      });
      return [...have, ...add];
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
  const phaseNames = extras ? (top['phases'] as PlanDataPhase[] | undefined) : program.macrocycle.phases.map((p) => ({ name: p.name, ...(p.goal ? { goal: p.goal } : {}) }));
  if (phaseNames) planData.phases = phaseNames;
  // A generated plan's length; a plan the adapter read keeps the file's (carried over with its other keys).
  if (!extras) planData.weeks = weeks.length;
  if (!extras && !base) {
    say('express', 'Express (the 20-minute version) is written with defaults: 2 working sets of each main lift and 2 sets of the finisher; check its warm-up line.');
    say('ladders', 'No base plan-data.json was given: ladders, the ladder note, the warm-ups and the desk routine are empty; pass --vault to carry them over.');
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
