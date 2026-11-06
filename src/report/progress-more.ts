// The rest of Progress: Training (records and milestones, every lift's e1RM,
// sessions per week and month, cardio minutes), Body (tape, the profile's
// targets, the photo sets), Health (resting HR, sleep and steps against their
// goals) and Skills (the ladders beside their tests and goals). Each summary
// is a small pure function with its rule written down; buildProgressMore
// puts them together for the date, counting from the cycle start by default
// (scope "cycle") or everything on record ("all"). Pure: the date is an input.

import type { LadderInfo } from '../adapters/vault/convert.ts';
import { ladderStatus } from '../adapters/vault/convert.ts';
import type { VaultRead } from '../adapters/vault/read.ts';
import { addDays, daysBetween, mondayOf } from '../core/dates.ts';
import { stepsGoal } from '../core/plan/conditioning.ts';
import type { BodyTargets, DailyCheckin, IsoDate, TapeEntry, TestEntry } from '../core/schema.ts';
import { STALL } from '../core/stall.ts';
import { weightTrend } from '../core/weight.ts';
import { cycleOf, scopeInfo, withinCycle, type Scope } from './cycle.ts';
import { envelope, sourcesOf } from './envelope.ts';
import { liftTrends } from './progress.ts';
import { buildReview, context } from './review.ts';
import { dayStateOf } from './today.ts';
import { paths } from '../adapters/vault/layout.ts';

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const mean = (xs: readonly number[]) => xs.reduce((a, v) => a + v, 0) / xs.length;

// ---------------------------------------------------------------- records

/** A record is "new" for this many days (the dashboard's NEW badge). */
export const RECORD_NEW_DAYS = 14;
/** The milestone step when plan-data gives a lift none (heuristic): round numbers. */
export const MILESTONE_STEP = { lb: 10, kg: 5 } as const;

export interface RecordSet {
  date: IsoDate;
  weight: number;
  reps: number;
  e1rm: number | null;
  /** Left out of the e1RM trend (before a unit flag): not counted for records either. */
  used?: boolean;
}

/**
 * Records, the dashboard's rule: a top set is a record when it beats every
 * earlier one of the lift, heavier or the same weight for more reps; the
 * first set is the baseline. The best set, the best e1RM, the record dates,
 * whether the best is new, and the round numbers reached and next.
 */
export function recordsFor(sets: readonly RecordSet[], date: IsoDate, step: number) {
  const out: (RecordSet & { record: boolean })[] = [];
  const held: { best: (RecordSet & { record: boolean }) | null } = { best: null };
  for (const s of [...sets].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const b = held.best;
    const counted = s.used !== false && s.weight > 0;
    const record = counted && b !== null && (s.weight > b.weight || (s.weight === b.weight && s.reps > b.reps));
    if (counted && (b === null || record)) held.best = { ...s, record };
    out.push({ ...s, record });
  }
  const best = held.best;
  const counted = out.filter((s) => s.used !== false && s.e1rm !== null);
  const bestE1rm = counted.reduce<RecordSet | null>((a, s) => (!a || (s.e1rm ?? 0) > (a.e1rm ?? 0) ? s : a), null);
  const top = best ? Math.floor(best.weight / step) * step : 0;
  const done: number[] = [];
  for (let m = step; m <= top + 1e-9; m += step) done.push(r2(m));
  return {
    sets: out,
    best,
    bestE1rm: bestE1rm ? { value: bestE1rm.e1rm!, date: bestE1rm.date } : null,
    records: out.filter((s) => s.record).map((s) => s.date),
    isNew: Boolean(best?.record && daysBetween(best.date, date) <= RECORD_NEW_DAYS),
    milestones: best ? { done: done.slice(-2), next: r2(top + step), toGo: r2(top + step - best.weight), step } : null,
  };
}

/** Every lift's e1RM change from the first set after the calibration week (week 1), called only from the third set on. */
export function e1rmChange(sets: readonly RecordSet[], calibrationEnd: IsoDate) {
  const after = sets.filter((s) => s.used !== false && s.e1rm !== null && s.date > calibrationEnd);
  if (after.length < 2) return { change: null, sets: after.length, called: false };
  const change = r1(after.at(-1)!.e1rm! - after[0]!.e1rm!);
  return { change, sets: after.length, called: after.length >= 3 && Math.abs(change) >= 0.5 };
}

// ---------------------------------------------------------------- sessions and cardio

export type SessionKindOf = 'lift' | 'short' | 'custom';
export interface Bucket {
  key: string;
  from: IsoDate;
  to: IsoDate;
}

/** The plan's weeks, Monday to Sunday from the plan's first Monday: week n is plan week n. */
export function planWeeks(planStart: IsoDate, first: number, count: number): (Bucket & { n: number })[] {
  return Array.from({ length: count }, (_, i) => {
    const n = first + i;
    const from = addDays(mondayOf(planStart), (n - 1) * 7);
    return { key: `W${n}`, n, from, to: addDays(from, 6) };
  });
}

/** The calendar months ending with the date's, oldest first. */
export function monthBuckets(date: IsoDate, count: number): Bucket[] {
  const out: Bucket[] = [];
  let y = Number(date.slice(0, 4));
  let m = Number(date.slice(5, 7));
  for (let i = 0; i < count; i++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const from = `${key}-01`;
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    out.unshift({ key, from, to: addDays(next, -1) });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/**
 * Sessions per bucket by kind, and the days with the Workout habit ticked but
 * no session logged (trained, type not logged). Counted through `through`.
 */
export function sessionCounts(sessions: readonly { date: IsoDate; kind: SessionKindOf }[], buckets: readonly Bucket[], unlogged: readonly IsoDate[], through: IsoDate) {
  return buckets.map((b) => {
    const inB = sessions.filter((s) => s.date >= b.from && s.date <= b.to && s.date <= through);
    const c = { lift: 0, short: 0, custom: 0 };
    for (const s of inB) c[s.kind]++;
    const u = unlogged.filter((d) => d >= b.from && d <= b.to && d <= through).length;
    return { ...b, ...c, total: inB.length, unlogged: u, future: b.from > through, current: b.from <= through && through <= b.to };
  });
}

/** Cardio minutes per bucket, with the minutes by mode ("bike", or the log's own words). */
export function cardioWeeks(sessions: readonly { date: IsoDate; cardioMin: number; cardioMode: string | null }[], buckets: readonly Bucket[], through: IsoDate) {
  return buckets.map((b) => {
    const inB = sessions.filter((s) => s.date >= b.from && s.date <= b.to && s.date <= through && s.cardioMin > 0);
    const modes: Record<string, number> = {};
    for (const s of inB) {
      const k = (s.cardioMode ?? '').trim().toLowerCase() || 'not said';
      modes[k] = (modes[k] ?? 0) + s.cardioMin;
    }
    return { ...b, minutes: inB.reduce((a, s) => a + s.cardioMin, 0), sessions: inB.length, modes, future: b.from > through, current: b.from <= through && through <= b.to };
  });
}

// ---------------------------------------------------------------- body

export const TAPE_MEASURES = [['waist', 'Waist'], ['hips', 'Hips'], ['chest', 'Chest'], ['arm', 'Arm']] as const;

/** Each tape measure over time: its points, first, last and change (the units as logged). */
export function tapeTrends(tape: readonly TapeEntry[], since?: IsoDate | null) {
  const days = tape.filter((t) => !since || t.date >= since).sort((a, b) => (a.date < b.date ? -1 : 1));
  const measures = TAPE_MEASURES.map(([key, label]) => {
    const points = days.filter((t) => typeof t[key] === 'number').map((t) => ({ date: t.date, value: t[key] as number, unit: t.unit }));
    const first = points[0] ?? null;
    const last = points.at(-1) ?? null;
    return { key, label, points, first, last, change: first && last && points.length > 1 ? r1(last.value - first.value) : null };
  }).filter((m) => m.points.length);
  return { days: days.length, measures };
}

export interface HealthSeries {
  /** The 7-day average through the last reading, and how many of the 7 days it has. */
  avg7: number;
  n7: number;
  /** The first week's average (the cycle's or the series' first 7 days). */
  firstWeek: number;
  firstDate: IsoDate;
  last: IsoDate;
  series: { date: IsoDate; value: number; avg7: number; n: number }[];
}

/** A watch number per day with its 7-day average (calendar days, not readings), from `since`. */
export function healthAverages(daily: readonly DailyCheckin[], field: 'rhr' | 'sleepH' | 'steps' | 'floors', date: IsoDate, since?: IsoDate | null): HealthSeries | null {
  const pts = daily.filter((d) => d.date <= date && (!since || d.date >= since) && typeof d[field] === 'number').map((d) => ({ date: d.date, value: d[field] as number })).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!pts.length) return null;
  const series = pts.map((p) => {
    const win = pts.filter((q) => q.date <= p.date && daysBetween(q.date, p.date) < 7);
    return { date: p.date, value: p.value, avg7: r2(mean(win.map((q) => q.value))), n: win.length };
  });
  const last = series.at(-1)!;
  const first = pts.filter((q) => daysBetween(pts[0]!.date, q.date) < 7);
  return { avg7: last.avg7, n7: last.n, firstWeek: r2(mean(first.map((q) => q.value))), firstDate: pts[0]!.date, last: last.date, series };
}

export type TargetStatus = 'met' | 'on-the-way' | 'not-yet' | 'at-goal' | 'under' | 'no-data';

/**
 * The profile's targets against now: a drop target counts down from the
 * cycle's first value (met at its low end; the bar runs to the stretch at
 * hi); a level target is the 7-day average against the goal. Steps and sleep
 * fall back to the plan generator's steps and the engine's 7 h.
 */
export function bodyTargets(t: BodyTargets | undefined, now: { waist?: { first: number; last: number } | null; weight?: { first: number; last: number } | null; rhr?: { first: number; last: number; n: number } | null; steps?: { avg: number; n: number } | null; sleep?: { avg: number; n: number } | null }, fallback: { steps: number; sleepH: number }) {
  const rows: { key: string; label: string; kind: 'drop' | 'level'; unit: string; lo?: number; hi?: number; goal?: number; base?: number | null; cur: number | null; drop?: number | null; status: TargetStatus; source: 'profile' | 'plan' | 'engine'; days?: number }[] = [];
  const drop = (key: string, label: string, unit: string, range: [number, number] | undefined, v: { first: number; last: number } | null | undefined) => {
    if (!range) return;
    const d = v ? r2(v.first - v.last) : null;
    rows.push({ key, label, kind: 'drop', unit, lo: range[0], hi: range[1], base: v?.first ?? null, cur: v?.last ?? null, drop: d, status: d === null ? 'no-data' : d >= range[0] ? 'met' : d > 0 ? 'on-the-way' : 'not-yet', source: 'profile' });
  };
  drop('waist', 'Waist', 'cm', t?.waistDropCm, now.waist);
  drop('weight', 'Weight', 'kg', t?.weightDropKg, now.weight);
  drop('rhr', 'Resting HR', 'bpm', t?.rhrDropBpm, now.rhr);
  const level = (key: string, label: string, unit: string, goal: number, source: 'profile' | 'plan' | 'engine', v: { avg: number; n: number } | null | undefined) =>
    rows.push({ key, label, kind: 'level', unit, goal, cur: v ? r2(v.avg) : null, status: !v ? 'no-data' : v.avg >= goal ? 'at-goal' : 'under', source, days: v?.n ?? 0 });
  level('steps', 'Steps', '', t?.stepsPerDay ?? fallback.steps, t?.stepsPerDay ? 'profile' : 'plan', now.steps);
  level('sleep', 'Sleep', 'h', t?.sleepHours ?? fallback.sleepH, t?.sleepHours ? 'profile' : 'engine', now.sleep);
  return rows;
}

// ---------------------------------------------------------------- skills

/** A fitness test's results over time. */
export function testHistory(tests: readonly TestEntry[], field: string): { date: IsoDate; value: number }[] {
  return tests.filter((t) => typeof t.results[field] === 'number').map((t) => ({ date: t.date, value: t.results[field]! })).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Which test each ladder is checked by (the dashboard's Skills card). */
export const LADDER_TEST: Readonly<Record<string, string>> = { pullup: 'pullups', pushup: 'pushups', hollow: 'hollowS', handstand: 'handstandS' };

/** The goal for a test: the profile's, else none. */
export function skillGoal(targets: BodyTargets | undefined, field: string): number | null {
  const v = targets?.tests?.[field];
  return typeof v === 'number' ? v : null;
}

export type LevelState = 'mastered' | 'progress' | 'unlocked' | 'locked';

/**
 * A ladder as a path: levels below the current mastered, the current in
 * progress, the next unlocked, the rest locked. With `since` (the cycle
 * start) a level reached before it shows no date: the level is where you
 * are now, the date is earlier history.
 */
export function ladderPath(l: LadderInfo, level: number, since: IsoDate | null = null) {
  return l.levels.map((name, i) => {
    const n = i + 1;
    const state: LevelState = n < level ? 'mastered' : n === level ? 'progress' : n === level + 1 ? 'unlocked' : 'locked';
    const reached = l.history.find((h) => h.level === n)?.date ?? null;
    return { n, name, state, reached: reached && (!since || reached >= since) ? reached : null };
  });
}

// ---------------------------------------------------------------- the report

/**
 * Training, Body, Health and Skills for the date, each with calm notes for
 * what is missing. `scope` "cycle" (the default) counts every chart, table,
 * tile and "since start" comparison from the cycle start; "all" counts
 * everything on record. `cycle` says which and from when.
 */
export function buildProgressMore(read: VaultRead, date: IsoDate, root = '', opts: { scope?: Scope } = {}) {
  const notes: { section: string; code: string; text: string }[] = [];
  const cycle = scopeInfo(read.data, date, opts.scope ?? 'cycle');
  const since = cycle.since;
  if (read.files.plan === 'missing') {
    notes.push({ section: 'all', code: 'no-plan', text: `No plan found (${paths().plan}).` });
    return envelope('progress-more', { sources: sourcesOf(read, root), date, cycle, training: null, body: null, health: null, skills: null, notes }, read.data.warnings, read.data.errors);
  }
  // The cycle's data only (everything with "all"): every summary below reads this.
  const data = withinCycle(read.data, since);
  const thisCycle = since ? ' this cycle' : '';
  const ctx = context(data, date);
  const review = buildReview(data, date);
  const week = review.week;
  const planLifts = (read.raw?.plan as { lifts?: Record<string, { step?: number; unit?: string }> } | undefined)?.lifts ?? {};
  const profile = data.profile;
  const targets = profile?.targets;

  // Training: records and milestones, every lift.
  const trends = liftTrends(ctx, review, date);
  const calibrationEnd = week.planStart ? addDays(mondayOf(week.planStart), 6) : date;
  const lifts = trends.map((l) => {
    const step = planLifts[l.name]?.step ?? MILESTONE_STEP[l.unit === 'kg' ? 'kg' : 'lb'];
    // Records stay the dashboard's top-set rule: with every set logged, the session's heaviest set (`top`) where the e1RM used another.
    const sets: RecordSet[] = l.sets.map((s) => ({ date: s.date, weight: s.top?.weight ?? s.weight, reps: s.top?.reps ?? s.reps, e1rm: s.e1rm, used: s.used }));
    return { exercise: l.exercise, name: l.name, unit: l.unit, step, stepFromPlan: planLifts[l.name]?.step !== undefined, records: recordsFor(sets, date, step), change: e1rmChange(sets, calibrationEnd), points: l.sets.filter((s) => s.used && s.e1rm !== null).map((s) => ({ date: s.date, e1rm: s.e1rm!, weight: s.weight, reps: s.reps })) };
  });
  const notLogged = Object.keys(planLifts).filter((n) => !trends.some((l) => l.name === n));
  if (!lifts.length) notes.push({ section: 'training', code: 'no-lifts', text: `No logged top sets${thisCycle} yet: records start with the first logged lift.` });

  // Sessions and cardio.
  const typeKind = new Map(data.plan.types.map((t) => [t.type, t.kind as SessionKindOf]));
  const sessions = ctx.sessions.filter((s) => s.date <= date).map((s) => {
    const v = (s as { _vault?: { type?: string; cardioMin?: number; cardioMode?: string } })._vault ?? {};
    return { date: s.date, kind: (typeKind.get(v.type ?? '') ?? 'custom'), cardioMin: Number(v.cardioMin) || 0, cardioMode: v.cardioMode ?? null };
  });
  const sessionDays = new Set(sessions.map((s) => s.date));
  const unlogged = data.checkins.daily.filter((d) => d.date <= date && !sessionDays.has(d.date) && dayStateOf(d.date, date, 0, d) === 'unlogged').map((d) => d.date);
  // Plan weeks and months that end before the cycle start are left out, not drawn empty.
  const inCycle = <B extends Bucket>(b: B) => !since || b.to >= since;
  const phaseWeeks = (week.planStart && week.planWeek ? planWeeks(week.planStart, ((week.phase ?? 1) - 1) * 8 + 1, 8) : []).filter(inCycle);
  const weeks = sessionCounts(sessions, phaseWeeks, unlogged, date).map((b) => ({ ...b, deload: (b as { n?: number }).n !== undefined && ((b as { n?: number }).n ?? 0) % 4 === 0 }));
  const months = sessionCounts(sessions, monthBuckets(date, 6).filter(inCycle), unlogged, date);
  const cardio = cardioWeeks(sessions, phaseWeeks, date);
  if (!sessions.length) notes.push({ section: 'training', code: 'no-sessions', text: `No sessions logged${thisCycle} yet.` });
  const activeGoals = [...(profile?.goals ?? []).map((g) => g.kind)];

  // Body: tape, targets, photos (the data is already the cycle's; `since` also trims the trends).
  const tape = tapeTrends(data.body.tape, since);
  if (!tape.days) notes.push({ section: 'body', code: 'no-tape', text: `No tape days${thisCycle} yet: the tape trends start with the first one.` });
  else if (tape.days === 1) notes.push({ section: 'body', code: 'one-tape', text: 'One tape day so far: the trends need a second.' });
  const waist = tape.measures.find((m) => m.key === 'waist');
  const wpts = weightTrend(data.body.weights, since ? { through: date, since } : { through: date }).value.points;
  const rhr = healthAverages(data.checkins.daily, 'rhr', date, since);
  const sleep = healthAverages(data.checkins.daily, 'sleepH', date, since);
  const steps = healthAverages(data.checkins.daily, 'steps', date, since);
  const floors = healthAverages(data.checkins.daily, 'floors', date, since);
  const stepGoal = stepsGoal(activeGoals, Math.max(0, (week.phase ?? 1) - 1));
  const targetRows = bodyTargets(targets, {
    waist: waist && waist.points.length > 1 ? { first: waist.first!.value, last: waist.last!.value } : null,
    weight: wpts.length > 1 ? { first: r2(wpts[0]!.trend), last: r2(wpts.at(-1)!.trend) } : null,
    rhr: rhr && rhr.series.length >= 8 ? { first: rhr.firstWeek, last: rhr.avg7, n: rhr.series.length } : null,
    steps: steps ? { avg: steps.avg7, n: steps.n7 } : null,
    sleep: sleep ? { avg: sleep.avg7, n: sleep.n7 } : null,
  }, { steps: stepGoal, sleepH: STALL.sleepH });
  if (!targets) notes.push({ section: 'body', code: 'no-targets', text: 'No numeric targets in the profile yet (Coach/profile.json, "targets"): steps and sleep use the plan’s and the engine’s goals.' });
  const photos = data.body.photos.map((p) => ({ date: p.date, poses: p.poses, folder: p.folder ?? `Progress Photos/${p.date}/` }));
  if (!photos.length) notes.push({ section: 'body', code: 'no-photos', text: `No photo sets${thisCycle} yet: photos come on each light week’s Sunday, every four weeks.` });
  else if (photos.length === 1) notes.push({ section: 'body', code: 'one-photo-set', text: 'One photo set so far: comparing starts with the second.' });

  // Health.
  const health = { rhr, sleep, steps, floors, goals: { rhr: targets?.rhrDropBpm && rhr ? r1(rhr.firstWeek - targets.rhrDropBpm[0]) : null, sleepH: targets?.sleepHours ?? STALL.sleepH, steps: targets?.stepsPerDay ?? stepGoal }, sources: { rhr: targets?.rhrDropBpm ? 'profile' : null, sleepH: targets?.sleepHours ? 'profile' : 'engine', steps: targets?.stepsPerDay ? 'profile' : 'plan' } };
  if (!rhr && !sleep && !steps) notes.push({ section: 'health', code: 'no-health', text: `No watch numbers${thisCycle} yet: the morning check-in brings resting HR, sleep and steps.` });

  // Skills.
  // The test hint follows the cycle whatever the view: a test from before the fresh start moves no ladder.
  const status = ladderStatus(data, date, cycleOf(read.data, date).value.start);
  const ladders = data.plan.ladders.map((l) => {
    const st = status.find((s) => s.id === l.id);
    const field = LADDER_TEST[l.id] ?? null;
    // The level is where you are now; the day it was reached is shown only when it falls in the cycle.
    const at = st?.since ?? null;
    return { id: l.id, name: l.name, level: st?.level ?? 0, levelName: st?.levelName ?? null, since: at && (!since || at >= since) ? at : null, path: ladderPath(l, st?.level ?? 0, since), test: field, tests: field ? testHistory(data.body.tests, field) : [], goal: field ? skillGoal(targets, field) : null, testShowsLevel: st?.testShowsLevel ?? null };
  });
  const laddered = new Set(Object.values(LADDER_TEST));
  const testedOnly = [...new Set(data.body.tests.flatMap((t) => Object.keys(t.results)))].filter((f) => !laddered.has(f) || !ladders.some((l) => l.test === f)).map((f) => ({ test: f, tests: testHistory(data.body.tests, f), goal: skillGoal(targets, f) }));
  if (!ladders.length) notes.push({ section: 'skills', code: 'no-ladders', text: 'No calisthenics ladders in the plan.' });
  if (!data.body.tests.length) notes.push({ section: 'skills', code: 'no-tests', text: `No fitness tests logged${thisCycle} yet: the test days fill the tests and goals.` });
  if (!targets?.tests) notes.push({ section: 'skills', code: 'no-goals', text: 'No test goals in the profile yet ("targets.tests").' });

  return envelope('progress-more', {
    sources: sourcesOf(read, root),
    date,
    cycle,
    week: { planWeek: week.planWeek, phase: week.phase, planStart: week.planStart },
    training: { lifts, notLogged, weeks, months, target: { lift: data.plan.weekTarget.lift, short: data.plan.weekTarget.short }, cardio, activeMinutes: activeGoals.some((g) => ['fat-loss', 'recomposition', 'health', 'conditioning'].includes(g)) ? [150, 300] : null },
    body: { tape, targets: targetRows, targetsBy: targets?.by ?? null, photos, cycleStart: since },
    health,
    skills: { ladders, testedOnly },
    notes,
  }, data.warnings, data.errors);
}
