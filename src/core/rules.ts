// The coach's standing rules, as plan-data.json declares them, and the old
// defaults that stand in for any rule the plan leaves out. The coach makes
// every coaching decision and writes it here as a rule (`rules`, a lift's
// `progression`, `express.short`); the engine only does each rule's
// arithmetic and cites the rule as its reason. A plan that declares nothing
// reads exactly as before: every kind falls back to the old default, built
// from the constants the engine has always used (never retyped), and a
// `legacy-default` warning asks the coach to write the rule.
//
// This is also the one place the light-week calendar is counted: which plan
// weeks are light, where each mesocycle and phase starts and ends.
//
// Pure. The other modules take what they need from here as parameters.

import { CALIBRATION } from './calibration.ts';
import { DELOAD } from './deload.ts';
import { MISSED } from './missed.ts';
import { PROGRESSION } from './progression.ts';
import type { RuleFrom } from './reason.ts';
import { SORENESS } from './soreness.ts';
import { VARIANT } from './variant.ts';

// ---------------------------------------------------------------- the shapes

export type RuleSource = 'plan' | 'legacy-default';

export const LIFT_RULES = ['double', 'linear', 'hold', 'target'] as const;
export type LiftRuleId = (typeof LIFT_RULES)[number];

/** A logged lift's progression (plan-data `lifts[name].progression`); its lo, hi and inc stay the lift's own fields. */
export interface LiftProgression {
  /** double: reps up inside lo-hi, then +inc; linear: +inc every session each set reaches hi; hold: reps only; target: the coach's numbers. */
  rule: LiftRuleId;
  /** Sessions in a row under lo before the weight drops by `drop` (a fraction), or hold the weight. */
  onMiss: { after: number; drop: number } | 'hold';
  /** A stalled lift: reported only, or the next target `drop` lighter. */
  onStall: 'report' | { drop: number };
  /** Rule `target`: the coach's weight (the lift's unit), reps and RIR. */
  target?: { weight: number; reps: number; rir: number };
}

export interface CalibrationRules {
  /** Plan weeks that find working loads (none: no calibration week). */
  weeks: number[];
  rir: number;
  /** Intervals in a calibration week: easy steady minutes, or as planned. */
  cardio: 'easy' | 'as-planned';
  /** The first week back after a restart is a calibration week too. */
  afterRestart: boolean;
}

export interface LightWeeksRules {
  /** Every Nth plan week, or the listed plan weeks (exactly one of the two). */
  every: number | null;
  weeks: number[] | null;
  /** Sets of every sets item in a light week: a number, or half rounded up. */
  sets: number | 'half';
  /** The light week's load: this fraction of the last loading weight. */
  load: number;
  /** Added to the target RIR in a light week. */
  rirAdd: number;
  /** An early light-week trigger (readiness, stalls, recovery): applied, offered as a fact, or not mentioned. */
  early: 'apply' | 'offer' | 'none';
}

export interface TestsRules {
  /** Plan weeks with the fitness tests; null: each phase end. */
  weeks: number[] | null;
}

export interface Adjustment {
  /** Added to the sets (-1: one set fewer); never under 1 set. */
  sets: number;
  /** Added to the RIR. */
  rir: number;
}

export interface ReadinessRules {
  /** A low-readiness day's change, or null: readiness changes nothing in the session. */
  low: Adjustment | null;
}

export interface SorenessRules {
  /** A sore main muscle's change today, or null: soreness changes nothing. */
  sore: Adjustment | null;
  /** Sore two days running: the easier variation, or the same exercise. */
  twoDays: 'easier' | 'same';
}

export interface MissedRules {
  easeBackAfterWeeks: number;
  restartAfterWeeks: number;
  /** The first week back's load drop, a fraction. */
  easeBackDrop: number;
  easeBackRir: number;
}

export interface StallRules {
  /** triage: the ladder picks a step each check-in; report: the facts only, the coach picks. */
  response: 'triage' | 'report';
}

export interface HotelRules {
  swaps: 'catalogue' | 'skip';
  /** A trip of a week or more: a third of the sets, or all of them. */
  longTripSets: 'third' | 'all';
}

export interface ExpressRules {
  /** Express on a short day: every item at half, or skip the short day. */
  short: 'half' | 'skip';
}

export interface PlanRules {
  calibration: CalibrationRules;
  lightWeeks: LightWeeksRules;
  tests: TestsRules;
  readiness: ReadinessRules;
  soreness: SorenessRules;
  missed: MissedRules;
  stall: StallRules;
  hotel: HotelRules;
  express: ExpressRules;
}

/** The plan-level kinds, in the order the warnings and the Plan screen list them. */
export const RULE_KINDS = ['calibration', 'lightWeeks', 'tests', 'readiness', 'soreness', 'missed', 'stall', 'hotel', 'express'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

/** Where each kind is written in plan-data.json. */
export const RULE_PATHS: Readonly<Record<RuleKind, string>> = {
  calibration: 'rules.calibration',
  lightWeeks: 'rules.lightWeeks',
  tests: 'rules.tests',
  readiness: 'rules.readiness',
  soreness: 'rules.soreness',
  missed: 'rules.missed',
  stall: 'rules.stall',
  hotel: 'rules.hotel',
  express: 'express.short',
};

/** The rules as Pahlavan reads them from a plan: every kind filled, where each came from, and what was wrong. */
export interface ReadRules {
  rules: PlanRules;
  sources: Record<RuleKind, RuleSource>;
  /** By plan-data `lifts` key. */
  lifts: Record<string, { rule: LiftProgression; source: RuleSource }>;
  problems: { path: string; message: string }[];
}

// ---------------------------------------------------------------- the old defaults

/** A logged lift's old default: double progression, two sessions under lo -> about 10 % lighter. */
export function legacyLift(): LiftProgression {
  return { rule: 'double', onMiss: { after: 2, drop: round(1 - PROGRESSION.lighterFactor) }, onStall: 'report' };
}

/**
 * The old defaults, from the constants the engine has always used. A fresh
 * copy each call (a function, so the modules these come from can use this
 * one's helpers without an import cycle at load time).
 */
export function legacyRules(): PlanRules {
  return {
    calibration: { weeks: [1], rir: CALIBRATION.rir, cardio: 'easy', afterRestart: true },
    lightWeeks: { every: DELOAD.every, weeks: null, sets: DELOAD.legacySets, load: DELOAD.legacyLoadFactor, rirAdd: PROGRESSION.deloadRirAdd, early: 'apply' },
    tests: { weeks: null },
    // A low day: one set fewer and RIR +1 (checkin.md's decision rule).
    readiness: { low: { sets: -1, rir: 1 } },
    soreness: { sore: { sets: -SORENESS.setsDrop, rir: SORENESS.rirAdd }, twoDays: 'easier' },
    missed: { easeBackAfterWeeks: 1, restartAfterWeeks: MISSED.restartAfterWeeks, easeBackDrop: round(1 - MISSED.easeBackLoadFactor), easeBackRir: MISSED.easeBackRirAdd },
    stall: { response: 'triage' },
    hotel: { swaps: 'catalogue', longTripSets: 'third' },
    express: { short: 'half' },
  };
}

/** The old defaults as plan-data would write them (the equivalence test writes these and expects the same numbers). */
export function legacyRulesJson(): Record<string, unknown> {
  const r = legacyRules();
  const { express: _e, ...rest } = r;
  return {
    ...rest,
    lightWeeks: { every: r.lightWeeks.every, sets: r.lightWeeks.sets, load: r.lightWeeks.load, rirAdd: r.lightWeeks.rirAdd, early: r.lightWeeks.early },
    tests: { weeks: 'phase-ends' },
  };
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

// ---------------------------------------------------------------- reading

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min = 1): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min;
const isNum = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const known = (v: Obj) => Object.keys(v).filter((k) => !k.startsWith('_'));

class Problems {
  list: { path: string; message: string }[] = [];
  add(path: string, message: string): void {
    this.list.push({ path, message });
  }
  /** Keys a kind does not know: listed, the rest of the kind still read. */
  unknown(path: string, v: Obj, keys: readonly string[]): void {
    for (const k of known(v)) if (!keys.includes(k)) this.add(`${path}.${k}`, `unknown key "${k}" (known: ${keys.join(', ')})`);
  }
}

const weekList = (v: unknown): number[] | null => {
  if (!Array.isArray(v) || !v.every((x) => isInt(x))) return null;
  const s = [...new Set(v)].sort((a, b) => a - b);
  return s.length === v.length ? s : null;
};

/** One kind: its value from the plan, or null (malformed: a problem says why, and the old default stands). */
type Reader<T> = (raw: unknown, legacy: T, p: Problems, path: string) => T | null;

const readCalibration: Reader<CalibrationRules> = (raw, legacy, p, path) => {
  if (raw === 'none') return { ...legacy, weeks: [], afterRestart: false };
  if (!isObj(raw)) return bad(p, path, 'is neither "none" nor an object');
  p.unknown(path, raw, ['weeks', 'rir', 'cardio', 'afterRestart']);
  const weeks = raw['weeks'] === undefined ? legacy.weeks : weekList(raw['weeks']);
  if (weeks === null) return bad(p, `${path}.weeks`, 'is not a list of plan weeks (whole numbers from 1, each once)');
  if (raw['rir'] !== undefined && !isNum(raw['rir'], 0, 6)) return bad(p, `${path}.rir`, 'is not a number of reps in reserve from 0 to 6');
  if (raw['cardio'] !== undefined && raw['cardio'] !== 'easy' && raw['cardio'] !== 'as-planned') return bad(p, `${path}.cardio`, 'is neither "easy" nor "as-planned"');
  if (raw['afterRestart'] !== undefined && typeof raw['afterRestart'] !== 'boolean') return bad(p, `${path}.afterRestart`, 'is not true or false');
  return {
    weeks,
    rir: raw['rir'] ?? legacy.rir,
    cardio: raw['cardio'] ?? legacy.cardio,
    afterRestart: raw['afterRestart'] ?? legacy.afterRestart,
  };
};

const readLightWeeks: Reader<LightWeeksRules> = (raw, legacy, p, path) => {
  if (!isObj(raw)) return bad(p, path, 'is not an object');
  p.unknown(path, raw, ['every', 'weeks', 'sets', 'load', 'rirAdd', 'early']);
  if (raw['every'] !== undefined && raw['weeks'] !== undefined) return bad(p, path, 'gives both "every" and "weeks"; give one');
  if (raw['every'] !== undefined && !isInt(raw['every'], 2)) return bad(p, `${path}.every`, 'is not a whole number of weeks from 2');
  const weeks = raw['weeks'] === undefined ? null : weekList(raw['weeks']);
  if (raw['weeks'] !== undefined && weeks === null) return bad(p, `${path}.weeks`, 'is not a list of plan weeks (whole numbers from 1, each once)');
  const sets = raw['sets'];
  if (sets !== undefined && sets !== 'half' && !isInt(sets)) return bad(p, `${path}.sets`, 'is neither a number of sets nor "half"');
  if (raw['load'] !== undefined && !isNum(raw['load'], 0.5, 1)) return bad(p, `${path}.load`, 'is not a fraction of the last loading weight from 0.5 to 1');
  if (raw['rirAdd'] !== undefined && !isNum(raw['rirAdd'], 0, 6)) return bad(p, `${path}.rirAdd`, 'is not a number of reps in reserve to add, from 0 to 6');
  const early = raw['early'];
  if (early !== undefined && early !== 'apply' && early !== 'offer' && early !== 'none') return bad(p, `${path}.early`, 'is not "apply", "offer" or "none"');
  const every = raw['every'] ?? (weeks ? null : legacy.every);
  return {
    every,
    weeks,
    sets: sets ?? legacy.sets,
    load: raw['load'] ?? legacy.load,
    rirAdd: raw['rirAdd'] ?? legacy.rirAdd,
    // A plan's light weeks apply an early trigger only when the rule says so: otherwise it is a fact for the coach.
    early: early ?? 'offer',
  };
};

const readTests: Reader<TestsRules> = (raw, legacy, p, path) => {
  if (!isObj(raw)) return bad(p, path, 'is not an object');
  p.unknown(path, raw, ['weeks']);
  if (raw['weeks'] === undefined || raw['weeks'] === 'phase-ends') return { weeks: legacy.weeks };
  const weeks = weekList(raw['weeks']);
  if (weeks && !weeks.length) return bad(p, `${path}.weeks`, 'lists no week: list the plan weeks with the tests, or write "phase-ends"');
  return weeks ? { weeks } : bad(p, `${path}.weeks`, 'is neither a list of plan weeks nor "phase-ends"');
};

const readAdjustment = (raw: unknown, p: Problems, path: string): Adjustment | null => {
  if (!isObj(raw)) return bad(p, path, 'is not {sets, rir}');
  p.unknown(path, raw, ['sets', 'rir']);
  if (!(typeof raw['sets'] === 'number' && Number.isInteger(raw['sets']) && raw['sets'] <= 0 && raw['sets'] >= -10)) return bad(p, `${path}.sets`, 'is not a whole number of sets to take off (0 or less)');
  if (!isNum(raw['rir'], 0, 6)) return bad(p, `${path}.rir`, 'is not a number of reps in reserve to add, from 0 to 6');
  return { sets: raw['sets'], rir: raw['rir'] };
};

const readReadiness: Reader<ReadinessRules> = (raw, _legacy, p, path) => {
  if (raw === 'none') return { low: null };
  if (!isObj(raw)) return bad(p, path, 'is neither "none" nor {low}');
  p.unknown(path, raw, ['low']);
  if (raw['low'] === 'none') return { low: null };
  const low = readAdjustment(raw['low'], p, `${path}.low`);
  return low ? { low } : null;
};

const readSoreness: Reader<SorenessRules> = (raw, legacy, p, path) => {
  if (raw === 'none') return { sore: null, twoDays: 'same' };
  if (!isObj(raw)) return bad(p, path, 'is neither "none" nor {sore, twoDays}');
  p.unknown(path, raw, ['sore', 'twoDays']);
  const sore = raw['sore'] === undefined ? legacy.sore : raw['sore'] === 'none' ? null : readAdjustment(raw['sore'], p, `${path}.sore`);
  if (sore === null && raw['sore'] !== 'none') return null;
  const two = raw['twoDays'];
  if (two !== undefined && two !== 'easier' && two !== 'same') return bad(p, `${path}.twoDays`, 'is neither "easier" nor "same"');
  return { sore, twoDays: two ?? legacy.twoDays };
};

const readMissed: Reader<MissedRules> = (raw, legacy, p, path) => {
  if (!isObj(raw)) return bad(p, path, 'is not an object');
  p.unknown(path, raw, ['easeBackAfterWeeks', 'restartAfterWeeks', 'easeBackDrop', 'easeBackRir']);
  for (const k of ['easeBackAfterWeeks', 'restartAfterWeeks'] as const) if (raw[k] !== undefined && !isInt(raw[k])) return bad(p, `${path}.${k}`, 'is not a whole number of weeks from 1');
  if (raw['easeBackDrop'] !== undefined && !isNum(raw['easeBackDrop'], 0, 0.5)) return bad(p, `${path}.easeBackDrop`, 'is not a fraction from 0 to 0.5');
  if (raw['easeBackRir'] !== undefined && !isNum(raw['easeBackRir'], 0, 6)) return bad(p, `${path}.easeBackRir`, 'is not a number of reps in reserve to add, from 0 to 6');
  const out: MissedRules = {
    easeBackAfterWeeks: (raw['easeBackAfterWeeks'] as number | undefined) ?? legacy.easeBackAfterWeeks,
    restartAfterWeeks: (raw['restartAfterWeeks'] as number | undefined) ?? legacy.restartAfterWeeks,
    easeBackDrop: raw['easeBackDrop'] ?? legacy.easeBackDrop,
    easeBackRir: raw['easeBackRir'] ?? legacy.easeBackRir,
  };
  if (out.easeBackAfterWeeks >= out.restartAfterWeeks) return bad(p, path, 'easeBackAfterWeeks must be fewer weeks than restartAfterWeeks');
  return out;
};

const readStall: Reader<StallRules> = (raw, _legacy, p, path) => {
  if (!isObj(raw)) return bad(p, path, 'is not {response}');
  p.unknown(path, raw, ['response']);
  const r = raw['response'];
  return r === 'triage' || r === 'report' ? { response: r } : bad(p, `${path}.response`, 'is neither "triage" nor "report"');
};

const readHotel: Reader<HotelRules> = (raw, legacy, p, path) => {
  if (!isObj(raw)) return bad(p, path, 'is not an object');
  p.unknown(path, raw, ['swaps', 'longTripSets']);
  const s = raw['swaps'];
  const l = raw['longTripSets'];
  if (s !== undefined && s !== 'catalogue' && s !== 'skip') return bad(p, `${path}.swaps`, 'is neither "catalogue" nor "skip"');
  if (l !== undefined && l !== 'third' && l !== 'all') return bad(p, `${path}.longTripSets`, 'is neither "third" nor "all"');
  return { swaps: s ?? legacy.swaps, longTripSets: l ?? legacy.longTripSets };
};

function bad(p: Problems, path: string, message: string): null {
  p.add(path, message);
  return null;
}

const READERS: { [K in Exclude<RuleKind, 'express'>]: Reader<PlanRules[K]> } = {
  calibration: readCalibration,
  lightWeeks: readLightWeeks,
  tests: readTests,
  readiness: readReadiness,
  soreness: readSoreness,
  missed: readMissed,
  stall: readStall,
  hotel: readHotel,
};

/** A lift's `progression` as written, or null with a problem (the old default then stands). */
function readLiftProgression(raw: unknown, p: Problems, path: string): LiftProgression | null {
  if (!isObj(raw)) return bad(p, path, 'is not {rule, ...}');
  p.unknown(path, raw, ['rule', 'onMiss', 'onStall', 'target']);
  const rule = raw['rule'];
  if (!(LIFT_RULES as readonly unknown[]).includes(rule)) return bad(p, `${path}.rule`, `is not one of ${LIFT_RULES.join(', ')} (a ladder is the item's own "ladder")`);
  const legacy = legacyLift();
  let onMiss: LiftProgression['onMiss'] = legacy.onMiss;
  const m = raw['onMiss'];
  if (m === 'hold') onMiss = 'hold';
  else if (m !== undefined) {
    if (!isObj(m) || !isInt(m['after']) || !isNum(m['drop'], 0.01, 0.5)) return bad(p, `${path}.onMiss`, 'is neither "hold" nor {after: sessions, drop: a fraction from 0.01 to 0.5}');
    onMiss = { after: m['after'], drop: m['drop'] };
  }
  let onStall: LiftProgression['onStall'] = legacy.onStall;
  const s = raw['onStall'];
  if (s === 'report') onStall = 'report';
  else if (s !== undefined) {
    if (!isObj(s) || !isNum(s['drop'], 0.01, 0.5)) return bad(p, `${path}.onStall`, 'is neither "report" nor {drop: a fraction from 0.01 to 0.5}');
    onStall = { drop: s['drop'] };
  }
  const out: LiftProgression = { rule: rule as LiftRuleId, onMiss, onStall };
  const t = raw['target'];
  // A coach-set target holds until the coach sets the next: short sessions and stalls are the coach's to answer.
  if (rule === 'target') for (const k of ['onMiss', 'onStall'] as const) if (raw[k] !== undefined) p.add(`${path}.${k}`, 'is not read with rule "target": the target holds until the coach sets the next one');
  if (rule === 'target') {
    if (!isObj(t) || !isNum(t['weight'], 0, 10000) || !isInt(t['reps']) || !isNum(t['rir'], 0, 6)) return bad(p, `${path}.target`, 'is not {weight, reps, rir} (rule "target" needs it)');
    out.target = { weight: t['weight'], reps: t['reps'], rir: t['rir'] };
  } else if (t !== undefined) p.add(`${path}.target`, `is only read with rule "target"; this lift's rule is "${String(rule)}"`);
  return out;
}

/**
 * The standing rules of a plan-data.json (parsed): its `rules`, each lift's
 * `progression` and `express.short`. A kind the plan leaves out, or writes in
 * a way Pahlavan cannot read, is the old default (`sources` says which);
 * `problems` lists what was wrong, unknown keys included.
 */
export function readRules(plan: unknown): ReadRules {
  const legacy = legacyRules();
  const p = new Problems();
  const rules = { ...legacy } as PlanRules;
  const sources = Object.fromEntries(RULE_KINDS.map((k) => [k, 'legacy-default'])) as Record<RuleKind, RuleSource>;
  const raw = isObj(plan) ? plan['rules'] : undefined;
  if (raw !== undefined && !isObj(raw)) p.add('rules', 'is not an object: every rule is the old default');
  if (isObj(raw)) {
    // Express on a short day lives on the express block, beside the plan's own Express sets.
    if (raw['express'] !== undefined) p.add('rules.express', 'is not read here: Express on a short day is the express block\'s "short" (express.short: "half" or "skip")');
    p.unknown('rules', Object.fromEntries(Object.entries(raw).filter(([k]) => k !== 'express')), RULE_KINDS.filter((k) => k !== 'express'));
    for (const k of Object.keys(READERS) as (keyof typeof READERS)[]) {
      if (raw[k] === undefined) continue;
      const v = (READERS[k] as Reader<unknown>)(raw[k], legacy[k], p, `rules.${k}`);
      if (v === null) continue;
      (rules as unknown as Record<string, unknown>)[k] = v;
      sources[k] = 'plan';
    }
  }
  const express = isObj(plan) && isObj(plan['express']) ? plan['express']['short'] : undefined;
  if (express === 'half' || express === 'skip') {
    rules.express = { short: express };
    sources.express = 'plan';
  } else if (express !== undefined) p.add('express.short', 'is neither "half" nor "skip"');

  const lifts: ReadRules['lifts'] = {};
  const rawLifts = isObj(plan) && isObj(plan['lifts']) ? plan['lifts'] : {};
  for (const [name, l] of Object.entries(rawLifts)) {
    const prog = isObj(l) ? l['progression'] : undefined;
    const read = prog === undefined ? null : readLiftProgression(prog, p, `lifts["${name}"].progression`);
    lifts[name] = read ? { rule: read, source: 'plan' } : { rule: legacyLift(), source: 'legacy-default' };
  }
  return { rules, sources, lifts, problems: p.list };
}

// ---------------------------------------------------------------- the light-week calendar

/** A plan week's place in the plan: light or not, its mesocycle and phase (a mesocycle ends at each light week; a phase is two mesocycles). */
export interface WeekPlace {
  planWeek: number;
  light: boolean;
  /** The week after this one is light. */
  lightNext: boolean;
  mesocycle: number;
  weekInMesocycle: number;
  /** The mesocycle's length in weeks; null for the open one after a plan's last listed light week. */
  mesocycleWeeks: number | null;
  phase: number;
  /** Weeks to the end of this mesocycle, its light week (0 in one); null when the plan lists none ahead. */
  weeksToMesocycleEnd: number | null;
}

/** Whether a plan week (1-based) is a light week. */
export function isLightWeek(lw: Pick<LightWeeksRules, 'every' | 'weeks'>, planWeek: number): boolean {
  if (planWeek < 1) return false;
  if (lw.weeks) return lw.weeks.includes(planWeek);
  return lw.every !== null && planWeek % lw.every === 0;
}

/** The first light week on or after a plan week; null when none is ahead. */
export function nextLightWeek(lw: Pick<LightWeeksRules, 'every' | 'weeks'>, planWeek: number): number | null {
  const w = Math.max(1, planWeek);
  if (lw.weeks) return lw.weeks.find((x) => x >= w) ?? null;
  return lw.every === null ? null : Math.ceil(w / lw.every) * lw.every;
}

/** The light weeks before a plan week, newest last (every: counted, not listed). */
function lightCountBefore(lw: Pick<LightWeeksRules, 'every' | 'weeks'>, planWeek: number): { count: number; last: number } {
  if (lw.weeks) {
    const before = lw.weeks.filter((x) => x < planWeek);
    return { count: before.length, last: before.at(-1) ?? 0 };
  }
  if (lw.every === null) return { count: 0, last: 0 };
  const count = Math.max(0, Math.floor((planWeek - 1) / lw.every));
  return { count, last: count * lw.every };
}

/** A plan week's place: light, mesocycle, phase and the weeks to the next light week. */
export function lightWeekAt(lw: Pick<LightWeeksRules, 'every' | 'weeks'>, planWeek: number): WeekPlace {
  const before = lightCountBefore(lw, planWeek);
  const next = nextLightWeek(lw, planWeek);
  const mesocycle = before.count + 1;
  const start = before.last + 1;
  return {
    planWeek,
    light: isLightWeek(lw, planWeek),
    lightNext: isLightWeek(lw, planWeek + 1),
    mesocycle,
    weekInMesocycle: planWeek - start + 1,
    mesocycleWeeks: next === null ? null : next - start + 1,
    phase: Math.floor((mesocycle - 1) / 2) + 1,
    weeksToMesocycleEnd: next === null ? null : next - planWeek,
  };
}

/** The nth light week (1-based); null when the plan has fewer. */
export function nthLightWeek(lw: Pick<LightWeeksRules, 'every' | 'weeks'>, n: number): number | null {
  if (n < 1) return null;
  if (lw.weeks) return lw.weeks[n - 1] ?? null;
  return lw.every === null ? null : n * lw.every;
}

/** A phase's plan weeks: its first, and its last (its second light week; null when the plan lists none). */
export function phaseWeeks(lw: Pick<LightWeeksRules, 'every' | 'weeks'>, phase: number): { first: number; last: number | null } {
  const first = phase <= 1 ? 1 : (nthLightWeek(lw, 2 * (phase - 1)) ?? Number.POSITIVE_INFINITY) + 1;
  return { first, last: nthLightWeek(lw, 2 * phase) };
}

/**
 * The plan's weeks grouped into mesocycles and phases, up to `total` weeks:
 * each mesocycle ends at a light week (the last one runs to `total`).
 */
export function planCalendar(lw: Pick<LightWeeksRules, 'every' | 'weeks'>, total: number): { phase: number; mesocycle: number; weeks: number[] }[][] {
  const mesos = new Map<number, { phase: number; mesocycle: number; weeks: number[] }>();
  for (let w = 1; w <= total; w++) {
    const at = lightWeekAt(lw, w);
    const m = mesos.get(at.mesocycle) ?? { phase: at.phase, mesocycle: at.mesocycle, weeks: [] };
    m.weeks.push(w);
    mesos.set(at.mesocycle, m);
  }
  const phases: { phase: number; mesocycle: number; weeks: number[] }[][] = [];
  for (const m of mesos.values()) (phases[m.phase - 1] ??= []).push(m);
  return phases.filter(Boolean);
}

/**
 * The weeks a plan runs to on a date: its own length, or past it to the end
 * of the phase holding plan week `needed` (whole phases more).
 */
export function weeksThrough(lw: Pick<LightWeeksRules, 'every' | 'weeks'>, planWeeks: number, needed: number): number {
  if (needed <= planWeeks) return planWeeks;
  const end = phaseWeeks(lw, lightWeekAt(lw, needed).phase).last;
  return Math.max(planWeeks, end ?? needed);
}

// ---------------------------------------------------------------- in words

const pct = (f: number) => `${Math.round(f * 100)} %`;
/** Plan weeks in words: "week 6", "weeks 6 and 12", "weeks 4, 8 and 13". */
export const weeksText = (ws: readonly number[]) => (ws.length === 1 ? `week ${ws[0]}` : `weeks ${ws.slice(0, -1).join(', ')} and ${ws.at(-1)}`);
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

function adjustmentText(a: Adjustment): string {
  const sets = a.sets === 0 ? 'the same sets' : a.sets === -1 ? 'one set off' : `${-a.sets} sets off`;
  return `${sets}${a.rir ? ` and ${a.rir} more RIR` : ''}`;
}

/** The light weeks, the calendar part ("every 4th plan week", "weeks 4, 8 and 13"). */
export function lightCalendarText(lw: Pick<LightWeeksRules, 'every' | 'weeks'>): string {
  if (lw.weeks) return lw.weeks.length ? `plan ${weeksText(lw.weeks)}` : 'no light weeks';
  return lw.every === null ? 'no light weeks' : `every ${lw.every === 2 ? '2nd' : lw.every === 3 ? '3rd' : `${lw.every}th`} plan week`;
}

/** What a light week does, in words ("2 sets of everything, about 10 % lighter, RIR +3"). */
export function lightDoseText(lw: Pick<LightWeeksRules, 'sets' | 'load' | 'rirAdd'>): string {
  const sets = lw.sets === 'half' ? 'half the sets' : `${lw.sets} set${lw.sets === 1 ? '' : 's'} of everything`;
  const load = lw.load >= 1 ? 'the same load' : `about ${pct(1 - lw.load)} lighter`;
  return `${sets}, ${load}, RIR ${signed(lw.rirAdd)}`;
}

/** A kind's rule in words, without the citation. */
export function ruleText(kind: RuleKind, rules: PlanRules): string {
  switch (kind) {
    case 'calibration': {
      const c = rules.calibration;
      if (!c.weeks.length) return `no calibration week${c.afterRestart ? '; the first week back after a restart finds its loads at RIR ' + c.rir : ''}`;
      return `calibration in plan ${weeksText(c.weeks)}: find a load that leaves ${c.rir} reps in reserve at the bottom of each range, no progression or stall decisions, ${c.cardio === 'easy' ? 'intervals as easy steady minutes' : 'cardio as planned'}${c.afterRestart ? '; the same after a restart' : ''}`;
    }
    case 'lightWeeks': {
      const lw = rules.lightWeeks;
      const early = lw.early === 'apply' ? 'an early light week applied on a trigger' : lw.early === 'offer' ? 'an early trigger reported for the coach' : 'early triggers not acted on';
      return `light weeks ${lightCalendarText(lw)}: ${lightDoseText(lw)}; ${early}`;
    }
    case 'tests':
      return rules.tests.weeks ? `tests in plan ${weeksText(rules.tests.weeks)}` : 'tests at each phase end, in its light week';
    case 'readiness':
      return rules.readiness.low ? `a low-readiness day takes ${adjustmentText(rules.readiness.low)}` : 'readiness changes nothing in the session';
    case 'soreness': {
      const s = rules.soreness;
      if (!s.sore) return 'soreness changes nothing in the session';
      return `a sore main muscle's exercise takes ${adjustmentText(s.sore)}${s.twoDays === 'easier' ? '; sore two days running, the easier variation' : ''}`;
    }
    case 'missed': {
      const m = rules.missed;
      const ease = m.restartAfterWeeks - 1 > m.easeBackAfterWeeks ? `${m.easeBackAfterWeeks}-${m.restartAfterWeeks - 1}` : `${m.easeBackAfterWeeks}`;
      return `${ease} week${ease === '1' ? '' : 's'} off: the first week back about ${pct(m.easeBackDrop)} lighter, RIR +${m.easeBackRir}; ${m.restartAfterWeeks}+ weeks off: restart at week 1${rules.calibration.afterRestart ? ' with a calibration week' : ''}`;
    }
    case 'stall':
      return rules.stall.response === 'triage' ? 'a stall gets the triage ladder, one step per check-in' : 'a stall is reported with its facts; the coach picks the response at the check-in';
    case 'hotel': {
      const h = rules.hotel;
      return `Hotel ${h.swaps === 'catalogue' ? 'swaps each movement for one with the travel equipment' : 'skips a movement the travel equipment cannot do'}; a trip of a week or more at ${h.longTripSets === 'third' ? `about ${Math.round(VARIANT.volumeFraction * 100)} % of the sets` : 'the usual sets'}`;
    }
    case 'express':
      return rules.express.short === 'half' ? 'Express on a short day: every item at half' : 'Express on a short day: skip the short day';
  }
}

/** A lift's progression in words, for its lo-hi range and step ("double progression on 8-12, +5 lb once every set reaches 12"). */
export function liftRuleText(r: LiftProgression, lift: { lo: number; hi: number; inc: number; unit: string }): string {
  const range = lift.lo === lift.hi ? `${lift.lo}` : `${lift.lo}-${lift.hi}`;
  const miss = r.onMiss === 'hold' ? 'a session under lo holds the weight' : `${r.onMiss.after} session${r.onMiss.after === 1 ? '' : 's'} in a row under ${lift.lo} -> about ${pct(r.onMiss.drop)} lighter`;
  const stall = r.onStall === 'report' ? '' : `; a stall -> about ${pct(r.onStall.drop)} lighter`;
  switch (r.rule) {
    case 'double':
      return `double progression on ${range}, +${lift.inc} ${lift.unit} once every set reaches ${lift.hi}; ${miss}${stall}`;
    case 'linear':
      return `linear progression at ${lift.hi} reps, +${lift.inc} ${lift.unit} every session every set reaches ${lift.hi}; ${miss}${stall}`;
    case 'hold':
      return `the weight held, reps up to ${lift.hi} on ${range}; ${miss}${stall}`;
    case 'target':
      return `the coach's target: ${r.target!.weight} ${lift.unit} x ${r.target!.reps} at RIR ${r.target!.rir}, held once met`;
  }
}

/** A rule with its citation: "The plan's rule: ..." or "Pahlavan's default (the plan sets none): ...". */
export function cite(source: RuleSource, text: string): string {
  const t = text.endsWith('.') ? text : `${text}.`;
  return source === 'plan' ? `The plan's rule: ${t}` : `Pahlavan's default (the plan sets none): ${t}`;
}

/** A plan-level kind as a reason's `from`. */
export function fromKind(read: Pick<ReadRules, 'rules' | 'sources'>, kind: RuleKind): RuleFrom {
  return { kind: read.sources[kind], path: RULE_PATHS[kind], text: cite(read.sources[kind], ruleText(kind, read.rules)) };
}

/** A lift's progression as a reason's `from`. */
export function fromLift(name: string, entry: { rule: LiftProgression; source: RuleSource }, lift: { lo: number; hi: number; inc: number; unit: string }): RuleFrom {
  return { kind: entry.source, path: `lifts["${name}"].progression`, text: cite(entry.source, liftRuleText(entry.rule, lift)) };
}

/**
 * The `legacy-default` warning's items: each kind the plan leaves to the old
 * default, in words, and the lifts without a progression rule. Empty when the
 * plan declares every rule.
 */
export function legacyItems(read: ReadRules, liftNames: (key: string) => string = (k) => k): string[] {
  const items = RULE_KINDS.filter((k) => read.sources[k] === 'legacy-default').map((k) => `${RULE_PATHS[k]}: ${ruleText(k, read.rules)}`);
  const lifts = Object.entries(read.lifts).filter(([, v]) => v.source === 'legacy-default').map(([k]) => liftNames(k));
  if (lifts.length) {
    const l = legacyLift();
    const miss = l.onMiss === 'hold' ? '' : `; ${l.onMiss.after} sessions under lo -> ${pct(l.onMiss.drop)} lighter`;
    items.push(`lifts without a progression rule: ${lifts.join(', ')} (double progression${miss})`);
  }
  return items;
}

export const LEGACY_DEFAULT_MESSAGE =
  'The plan sets no rule for these, so Pahlavan uses its old default. The coach writes them into plan-data.json (`rules`, or a lift\'s `progression`) at the next check-in.';
