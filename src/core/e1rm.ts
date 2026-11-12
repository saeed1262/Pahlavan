// Estimated one-rep max (Epley) and its trend, as in numbers.md ("e1RM, stalls,
// misses and unit flags"). Each exercise is compared only with itself, in its
// own unit.

import { dayText, daysBetween } from './dates.ts';
import type { TopSet } from './history.ts';
import { explain, joinNotes, type Result } from './reason.ts';
import type { IsoDate, Unit } from './schema.ts';
import { weightInUnit } from './units.ts';

export const E1RM = {
  /** Epley only when reps + RIR is at most this. */
  maxReps: 10,
  /** Smoothing: best of the last N qualifying sessions. */
  bestOf: 3,
  /** Changes inside +-4 % are noise. */
  noise: 0.04,
  /** A gain of 2 % or less over 3 sessions is a stall candidate (with adherence >= 80 %). */
  stallGain: 0.02,
  /** A jump outside (0.55x, 1.8x) between two sessions is a likely kg/lb mix-up. */
  unitFlagLow: 0.55,
  unitFlagHigh: 1.8,
  /** A trend needs this many qualifying sessions (best[-1] against best[-4]). */
  trendSessions: 4,
} as const;

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Epley: weight x (1 + n / 30), n = reps + RIR (reps alone without RIR); null when n > 10. */
export function epley(weight: number, reps: number, rir?: number): Result<number | null> {
  const n = reps + (rir ?? 0);
  const inputs = { weight, reps, rir: rir ?? null, n };
  const threshold = { maxRepsPlusRir: E1RM.maxReps };
  if (n > E1RM.maxReps) {
    return explain(null, 'e1rm.epley', inputs, {
      threshold,
      note: 'reps + RIR over 10: no e1RM; judge by load at the same reps',
    });
  }
  return explain(weight * (1 + n / 30), 'e1rm.epley', inputs, {
    threshold,
    note: rir === undefined ? 'RIR not logged: reps alone' : undefined,
  });
}

export type E1rmVerdict = 'up' | 'down' | 'noise';

export interface E1rmPoint {
  date: IsoDate;
  /** In the exercise unit (units.ts weightInUnit: a converted set rounds to the exercise's step). */
  weight: number;
  /** The weight and unit as logged. */
  logged: { weight: number; unit: Unit };
  reps: number;
  rir: number | null;
  e1rm: number;
  /** Best of this and the previous two points. */
  best: number;
}

export interface E1rmTrend {
  unit: Unit;
  /** Top sets given. */
  sessions: number;
  /** Top sets older than the last unit flag, left out. */
  ignored: number;
  unitFlag: { from: { date: IsoDate; weight: number }; to: { date: IsoDate; weight: number } } | null;
  /** The used top sets with reps + RIR <= 10. */
  points: E1rmPoint[];
  /** The latest best-of-3. */
  best: number | null;
  /** best[-1] / best[-4] - 1, once there are 4 points. */
  change: number | null;
  verdict: E1rmVerdict | null;
  /** change <= 2 %: a stall if adherence over the span was 80 % or more. */
  stallCandidate: boolean;
}

/**
 * The e1RM trend from one top set per session (oldest first), in the
 * exercise's unit. A top set logged in the other unit is converted by the one
 * conversion rule (units.ts weightInUnit): rounded to the exercise's step, or
 * to 0.1 when only the unit is given (the snippets' rounding).
 */
export function e1rmTrend(topSets: readonly TopSet[], exercise: Unit | { unit: Unit; increment?: number }): Result<E1rmTrend> {
  const ex = typeof exercise === 'string' ? { unit: exercise } : exercise;
  const unit = ex.unit;
  const h = [...topSets]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((t) => ({ date: t.date, weight: weightInUnit(t.weight, t.unit, ex), logged: { weight: t.weight, unit: t.unit }, reps: t.reps, rir: t.rir ?? null }));

  let cut = 0;
  for (let i = 1; i < h.length; i++) {
    const ratio = h[i]!.weight / h[i - 1]!.weight;
    if (!(E1RM.unitFlagLow < ratio && ratio < E1RM.unitFlagHigh)) cut = i;
  }
  const used = h.slice(cut);

  const points: E1rmPoint[] = [];
  for (const t of used) {
    const e = epley(t.weight, t.reps, t.rir ?? undefined).value;
    if (e === null) continue;
    const prev = points.slice(-(E1RM.bestOf - 1)).map((p) => p.e1rm);
    points.push({ ...t, e1rm: e, best: Math.max(e, ...prev) });
  }

  const best = points.at(-1)?.best ?? null;
  let change: number | null = null;
  let verdict: E1rmVerdict | null = null;
  if (points.length >= E1RM.trendSessions) {
    change = best! / points.at(-E1RM.trendSessions)!.best - 1;
    verdict = change > E1RM.noise ? 'up' : change < -E1RM.noise ? 'down' : 'noise';
  }
  const stallCandidate = change !== null && change <= E1RM.stallGain;

  const unitFlag = cut
    ? { from: { date: h[cut - 1]!.date, weight: h[cut - 1]!.weight }, to: { date: h[cut]!.date, weight: h[cut]!.weight } }
    : null;
  // Every set logged: a session's best set by e1RM can be a lighter one than its heaviest.
  const notTop = [...topSets].filter((t) => t.top).sort((a, b) => (a.date < b.date ? -1 : 1));

  const note = joinNotes(
    unitFlag &&
      `Unit flag: ${unitFlag.from.weight} on ${dayText(unitFlag.from.date)} then ${unitFlag.to.weight} on ${dayText(unitFlag.to.date)} is a likely kg/lb mix-up; ask which is right. ${cut} older top set(s) ignored.`,
    h.length === 0 && 'No logged top sets.',
    h.length > 0 && points.length === 0 && 'No e1RM: reps + RIR over 10 on every used top set; judge by load at the same reps.',
    points.length > 0 && change === null && `A trend needs ${E1RM.trendSessions} sessions with reps + RIR <= 10; have ${points.length}.`,
    verdict === 'noise' && 'The change is inside the +-4 % noise band.',
    stallCandidate && 'Gain of 2 % or less over 3 sessions: a stall if adherence over the span was 80 % or more.',
    notTop.length > 0 &&
      `Every set logged: each session's best set by e1RM is used, not its heaviest (${notTop.map((t) => `${dayText(t.date)}: ${t.weight} ${t.unit} x ${t.reps} over ${t.top!.weight} ${t.top!.unit} x ${t.top!.reps}`).join('; ')}).`,
  );

  return explain<E1rmTrend>(
    { unit, sessions: h.length, ignored: cut, unitFlag, points, best, change, verdict, stallCandidate },
    'e1rm.trend',
    { unit, increment: ex.increment ?? null, topSets: h.length, used: used.length, qualifying: points.length },
    {
      threshold: {
        maxRepsPlusRir: E1RM.maxReps,
        bestOf: E1RM.bestOf,
        noise: E1RM.noise,
        stallGain: E1RM.stallGain,
        unitFlag: [E1RM.unitFlagLow, E1RM.unitFlagHigh],
      },
      note,
      ...(unitFlag ? { title: 'Unit check' } : {}),
    },
  );
}

// ---------------------------------------------------------------- rises

/** A session's set for the rises: in the lift's unit, oldest first. */
export interface RiseSet {
  date: IsoDate;
  weight: number;
  reps: number;
  rir?: number | null;
}

/**
 * Each set's e1RM (Epley; null when reps + RIR is over 10) and whether it is
 * a rise: an e1RM above every earlier one from `from` on (the sets before it,
 * older than a unit flag, are left out). The first e1RM is never a rise. The
 * Progress tab marks these as its PRs.
 */
export function e1rmRises(sets: readonly RiseSet[], from = 0): { e1rm: number | null; rise: boolean }[] {
  let high = -Infinity;
  return sets.map((s, i) => {
    const e = epley(s.weight, s.reps, s.rir ?? undefined).value;
    const used = i >= from;
    const rise = used && e !== null && high > -Infinity && e > high + 1e-9;
    if (used && e !== null && e > high) high = e;
    return { e1rm: e, rise };
  });
}

export interface LastRise {
  date: IsoDate;
  /** In the lift's unit, to 0.01. */
  e1rm: number;
  /** The lift's sessions logged after it. */
  sessionsSince: number;
  daysSince: number;
}

/** What a rise is read against: the span's first day (this cycle's start; null: the whole log) and the best e1RM before it. */
export interface RiseSpan {
  since?: IsoDate | null;
  before?: { date: IsoDate; e1rm: number } | null;
}

/**
 * The lift's latest rise (`e1rmRises`, the Progress tab's PR) and how long
 * ago it was: the sessions since and the days to `date`. Null with its
 * reason when there is none: no sets, no e1RM (reps + RIR over 10 on every
 * set), or none above the first. With a `since` the sets are that span's
 * (this cycle's), and the note names the best before it when given.
 */
export function lastRise(sets: readonly RiseSet[], date: IsoDate, from = 0, span: RiseSpan = {}): Result<LastRise | null> {
  const marks = e1rmRises(sets, from);
  const i = marks.map((m) => m.rise).lastIndexOf(true);
  const since = span.since ?? null;
  const before = span.before ?? null;
  const inputs = { sets: sets.length, from, date, ...(since ? { since, before } : {}) };
  const threshold = { maxRepsPlusRir: E1RM.maxReps };
  const cycle = since ? ` since ${dayText(since)}` : '';
  const prior = before && `The best before this cycle: ${before.e1rm} on ${dayText(before.date)}.`;
  if (i < 0) {
    const firstAt = marks.findIndex((m, k) => k >= from && m.e1rm !== null);
    const note = !sets.length
      ? `No logged sets${cycle}: no rise yet.`
      : firstAt < 0
        ? `No e1RM${cycle}: reps + RIR over 10 on every set; judge by load at the same reps.`
        : `No rise${since ? ' this cycle' : ''} yet: the first e1RM${cycle}, ${r2(marks[firstAt]!.e1rm!)} on ${dayText(sets[firstAt]!.date)}, is still the best.`;
    return explain(null, 'e1rm.rise', inputs, { threshold, note: joinNotes(note, prior) });
  }
  const s = sets[i]!;
  const sessionsSince = sets.length - 1 - i;
  const daysSince = daysBetween(s.date, date);
  const value: LastRise = { date: s.date, e1rm: r2(marks[i]!.e1rm!), sessionsSince, daysSince };
  return explain(value, 'e1rm.rise', inputs, {
    threshold,
    note: joinNotes(
      `Last rise${since ? ' this cycle' : ''}: an e1RM of ${value.e1rm} on ${dayText(s.date)}, above every earlier one${cycle}; ${sessionsSince === 0 ? 'the latest session' : `${sessionsSince} session${sessionsSince === 1 ? '' : 's'} since`}, ${daysSince} day${daysSince === 1 ? '' : 's'} ago.`,
      before && (before.e1rm > value.e1rm ? `Under the best before this cycle (${before.e1rm} on ${dayText(before.date)}).` : `Above the best before this cycle too (${before.e1rm} on ${dayText(before.date)}).`),
    ),
  });
}
