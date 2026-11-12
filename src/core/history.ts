// Per-exercise views of the session log, shared by the rules.

import { epley } from './e1rm.ts';
import type { ExerciseSlot, IsoDate, LoggedSet, Session, TrackingLevel, Unit } from './schema.ts';
import { toKg } from './units.ts';

/** One session's view of one exercise. */
export interface ExerciseSession {
  date: IsoDate;
  sessionId: string;
  trackingLevel: TrackingLevel;
  /** The session's plan snapshot was a deload week. */
  deload: boolean;
  /** Logged sets; empty when the exercise was done (per the plan snapshot) but not logged. */
  sets: LoggedSet[];
  /** The plan snapshot's slot for the exercise, when there is one. */
  slot?: ExerciseSlot;
}

/** A session's top set of one exercise, as the e1RM snippet reads it. */
export interface TopSet {
  date: IsoDate;
  weight: number;
  unit: Unit;
  reps: number;
  rir?: number;
  /** The session's heaviest set, when the set used is another (every set logged: the best by e1RM). */
  top?: { weight: number; unit: Unit; reps: number };
}

const byDate = <T extends { date: IsoDate }>(a: T, b: T) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/**
 * Every session that holds the exercise, oldest first: logged, or in the plan
 * snapshot and not skipped. Sessions on the same date keep their input order.
 */
export function exerciseHistory(sessions: readonly Session[], exercise: string): ExerciseSession[] {
  const out: ExerciseSession[] = [];
  for (const s of [...sessions].sort(byDate)) {
    const logged = s.exercises.filter((x) => x.exercise === exercise);
    const slot = s.plan?.slots.find((x) => x.exercise === exercise);
    const skipped = (s.skipped ?? []).includes(exercise);
    if (logged.length === 0 && (!slot || skipped)) continue;
    const entry: ExerciseSession = {
      date: s.date,
      sessionId: s.id,
      trackingLevel: s.trackingLevel,
      deload: s.plan?.weekKind === 'deload',
      sets: logged.flatMap((x) => x.sets),
    };
    if (slot) entry.slot = slot;
    out.push(entry);
  }
  return out;
}

/** The heaviest set (compared in kg); ties go to more reps, then the earlier set. */
export function topSet(sets: readonly LoggedSet[]): LoggedSet | undefined {
  let best: LoggedSet | undefined;
  for (const s of sets) {
    if (!best) best = s;
    else {
      const a = toKg(s.weight, s.unit);
      const b = toKg(best.weight, best.unit);
      if (a > b || (a === b && s.reps > best.reps)) best = s;
    }
  }
  return best;
}

/**
 * One top set per logged session, oldest first. Like the snippet, a top set
 * with no weight or no reps (a bodyweight set, a blank) is left out.
 */
export function topSets(sessions: readonly Session[], exercise: string): TopSet[] {
  const out: TopSet[] = [];
  for (const h of exerciseHistory(sessions, exercise)) {
    const t = topSet(h.sets);
    if (!t || !t.weight || !t.reps) continue;
    const row: TopSet = { date: h.date, weight: t.weight, unit: t.unit, reps: t.reps };
    if (t.rir !== undefined) row.rir = t.rir;
    out.push(row);
  }
  return out;
}

/** A set's Epley e1RM in kg (reps + RIR at most 10), or null. */
const e1rmKg = (s: LoggedSet) => epley(toKg(s.weight, s.unit), s.reps, s.rir).value;

/**
 * The set with the best e1RM (Epley, with the set's RIR when logged; compared
 * in kg); ties go to the heavier set, then the earlier. When no set has an
 * e1RM (reps + RIR over 10 on all), the top set. Only sets with a weight and
 * reps count. With one set (Standard tracking) it is that set.
 */
export function bestSet(sets: readonly LoggedSet[]): LoggedSet | undefined {
  const loaded = sets.filter((s) => s.weight > 0 && s.reps > 0);
  let best: LoggedSet | undefined;
  let bestE = -Infinity;
  for (const s of loaded) {
    const e = e1rmKg(s);
    if (e === null) continue;
    if (e > bestE + 1e-9 || (Math.abs(e - bestE) <= 1e-9 && toKg(s.weight, s.unit) > toKg(best!.weight, best!.unit))) {
      best = s;
      bestE = e;
    }
  }
  return best ?? topSet(loaded);
}

/**
 * One set per logged session for the e1RM trend, oldest first: the session's
 * best set by e1RM (bestSet). At Standard tracking that is the one top set;
 * when every set is logged, a lighter set with more reps can beat the
 * heaviest, which the row then names as `top` (not when the two differ only
 * in RIR). As in topSets, a session with no set carrying both a weight and
 * reps is left out.
 */
export function trendSets(sessions: readonly Session[], exercise: string): TopSet[] {
  const out: TopSet[] = [];
  for (const h of exerciseHistory(sessions, exercise)) {
    const t = bestSet(h.sets);
    if (!t) continue;
    const row: TopSet = { date: h.date, weight: t.weight, unit: t.unit, reps: t.reps };
    if (t.rir !== undefined) row.rir = t.rir;
    const heaviest = topSet(h.sets.filter((s) => s.weight > 0 && s.reps > 0))!;
    if (toKg(heaviest.weight, heaviest.unit) !== toKg(t.weight, t.unit) || heaviest.reps !== t.reps) row.top = { weight: heaviest.weight, unit: heaviest.unit, reps: heaviest.reps };
    out.push(row);
  }
  return out;
}

/** The slot from the newest plan snapshot that holds the exercise. */
export function latestSlot(sessions: readonly Session[], exercise: string): ExerciseSlot | undefined {
  const withSlot = exerciseHistory(sessions, exercise).filter((h) => h.slot);
  return withSlot.at(-1)?.slot;
}

/** What a new log starts an exercise from: the newest session that logged it. */
export interface LastSets {
  date: IsoDate;
  /** Every set when that session logged every set; else its top set alone. */
  sets: LoggedSet[];
  every: boolean;
}

/**
 * The sets a new log starts an exercise from: the newest session that
 * logged it, with every set when every set was logged (Full tracking),
 * else its top set alone. Null when no session logged it. The caller picks
 * the sessions (before the new log's date, its version).
 */
export function lastSets(sessions: readonly Session[], exercise: string): LastSets | null {
  const h = exerciseHistory(sessions, exercise).filter((x) => x.sets.length > 0).at(-1);
  if (!h) return null;
  if (h.trackingLevel === 'full') return { date: h.date, sets: h.sets.map((s) => ({ ...s })), every: true };
  return { date: h.date, sets: [{ ...topSet(h.sets)! }], every: false };
}
