// Training load (Foster 2001): a session's load is its session RPE (0-10)
// times its minutes. Over a Monday-to-Sunday week: the load, the monotony
// (the mean daily load divided by its standard deviation over the 7 days,
// rest days counting as 0) and the strain (the week's load times the
// monotony). A session without an RPE has an unknown load; the week's
// check-in effort can stand in for it, flagged as an estimate. Next week's
// planned load uses a planned effort per template, a heuristic.

import { addDays, daysBetween } from './dates.ts';
import { explain, joinNotes, type Result } from './reason.ts';
import type { Exercise, IsoDate, Session, SessionTemplate } from './schema.ts';
import { mean, stdev } from './stats.ts';

export const LOAD = {
  days: 7,
  /** Median minutes per session type look back this far. */
  minutesLookbackDays: 56,
  /** Planned effort (heuristic): conditioning circuits, other short sessions, easy cardio, the deload drop. */
  circuitRpe: 8,
  shortRpe: 6,
  cardioRpe: 4,
  deloadDrop: 2,
} as const;

export interface SessionLoad {
  date: IsoDate;
  session: string;
  minutes: number | null;
  rpe: number | null;
  /** RPE x minutes; null when either is unknown. */
  load: number | null;
  /** The RPE or the minutes came from a stand-in, not the session's own log. */
  estimated: boolean;
}

export interface LoadFallback {
  /** The week's check-in effort (1-10), standing in for a missing session RPE. */
  effort?: number | null;
  /** Typical minutes for the session's type, standing in for missing minutes. */
  minutes?: number | null;
}

/** One session's load, with the stand-ins it used. */
export function sessionLoad(s: Session, fallback: LoadFallback = {}): Result<SessionLoad> {
  const ownRpe = typeof s.rpe === 'number' ? s.rpe : null;
  const ownMin = typeof s.minutes === 'number' && s.minutes > 0 ? s.minutes : null;
  const rpe = ownRpe ?? fallback.effort ?? null;
  const minutes = ownMin ?? fallback.minutes ?? null;
  const estimated = (ownRpe === null && rpe !== null) || (ownMin === null && minutes !== null);
  const load = rpe !== null && minutes !== null ? rpe * minutes : null;
  return explain<SessionLoad>({ date: s.date, session: s.id, minutes, rpe, load, estimated }, 'load.session', { session: s.id, rpe: ownRpe, minutes: ownMin, fallback }, {
    threshold: { formula: 'session RPE x minutes (Foster 2001)' },
    note: joinNotes(
      load === null && ownRpe === null && rpe === null && 'No session RPE logged and no check-in effort: load unknown.',
      load === null && minutes === null && 'No minutes logged: load unknown.',
      ownRpe === null && rpe !== null && `No session RPE logged: the week's check-in effort (${rpe}/10) stands in, an estimate.`,
      ownMin === null && minutes !== null && `No minutes logged: ${minutes} min, the type's typical length, stands in, an estimate.`,
    ),
  });
}

export interface WeekLoad {
  from: IsoDate;
  to: IsoDate;
  sessions: SessionLoad[];
  /** Load per day, Monday first; null for a day with a session of unknown load. */
  daily: (number | null)[];
  /** The week's load; null when any session's load is unknown. */
  load: number | null;
  /** The sum of the sessions whose load is known. */
  knownLoad: number;
  unknownSessions: number;
  estimatedSessions: number;
  monotony: number | null;
  strain: number | null;
}

/** The week from `from` (a Monday) through the 6 days after, from session loads (sessionLoad). */
export function weekLoad(loads: readonly SessionLoad[], from: IsoDate): Result<WeekLoad> {
  const to = addDays(from, LOAD.days - 1);
  const inWeek = loads.filter((l) => l.date >= from && l.date <= to);
  const daily: (number | null)[] = Array.from({ length: LOAD.days }, () => 0);
  for (const l of inWeek) {
    const i = daysBetween(from, l.date);
    daily[i] = l.load === null || daily[i] === null ? null : daily[i]! + l.load;
  }
  const unknown = inWeek.filter((l) => l.load === null).length;
  const knownLoad = inWeek.reduce((a, l) => a + (l.load ?? 0), 0);
  const load = unknown ? null : knownLoad;
  let monotony: number | null = null;
  if (load !== null && load > 0) {
    const days = daily as number[];
    const sd = stdev(days);
    monotony = sd > 0 ? mean(days) / sd : null;
  }
  const strain = load !== null && monotony !== null ? load * monotony : null;
  const estimated = inWeek.filter((l) => l.estimated).length;
  return explain<WeekLoad>(
    { from, to, sessions: inWeek, daily, load, knownLoad, unknownSessions: unknown, estimatedSessions: estimated, monotony, strain },
    'load.week',
    { from, to, sessions: inWeek.length, daily },
    {
      threshold: { monotony: 'mean daily load / its sample SD over 7 days, rest days 0', strain: 'week load x monotony' },
      note: joinNotes(
        load !== null && `Load ${Math.round(load)} (RPE x min) from ${inWeek.length} session(s)${monotony !== null ? `; monotony ${monotony.toFixed(2)}, strain ${Math.round(strain!)}` : ''}.`,
        unknown > 0 && `${unknown} session(s) without a session RPE (and no check-in effort to stand in): the week's load is unknown; the known part is ${Math.round(knownLoad)}.`,
        estimated > 0 && `${estimated} session(s) estimated from the check-in effort or typical minutes.`,
        load === 0 && 'No sessions: no load.',
      ),
    },
  );
}

/** The median of the logged minutes for a session type, over the days before `date`. */
export function typicalMinutes(sessions: readonly Session[], template: string, date: IsoDate): number | null {
  const from = addDays(date, -LOAD.minutesLookbackDays);
  const mins = sessions
    .filter((s) => s.date < date && s.date >= from && (s.plan?.template ?? s.template) === template && typeof s.minutes === 'number' && s.minutes > 0)
    .map((s) => s.minutes!)
    .sort((a, b) => a - b);
  if (!mins.length) return null;
  const m = Math.floor(mins.length / 2);
  return mins.length % 2 ? mins[m]! : (mins[m - 1]! + mins[m]!) / 2;
}

/**
 * A heuristic session RPE for a planned template: lifting, 10 minus the main
 * lifts' mean target RIR; a session with a conditioning circuit, 8; easy
 * cardio only, 4; other short sessions (skills, core), 6. A deload week, 2 lower.
 */
export function plannedEffort(t: SessionTemplate, exercises: Readonly<Record<string, Exercise>>, opts: { deload?: boolean } = {}): Result<number> {
  const kindOf = (id: string) => exercises[id]?.kind ?? 'strength';
  const mains = t.slots.filter((s) => s.main);
  const strength = t.slots.filter((s) => kindOf(s.exercise) === 'strength');
  let rpe: number;
  let basis: string;
  if ((t.kind === 'lift' || t.kind === 'express') && (mains.length || strength.length)) {
    const rir = mean((mains.length ? mains : strength).map((s) => s.rir));
    rpe = 10 - rir;
    basis = `10 minus the ${mains.length ? 'main lifts' : 'strength work'}' mean target RIR (${rir})`;
  } else if (t.slots.some((s) => kindOf(s.exercise) === 'circuit')) {
    rpe = LOAD.circuitRpe;
    basis = 'a conditioning circuit';
  } else if (t.slots.length && t.slots.every((s) => kindOf(s.exercise) === 'cardio' || kindOf(s.exercise) === 'mobility')) {
    rpe = LOAD.cardioRpe;
    basis = 'easy cardio only';
  } else {
    rpe = LOAD.shortRpe;
    basis = 'skills and core work';
  }
  if (opts.deload) rpe = Math.max(1, rpe - LOAD.deloadDrop);
  return explain(rpe, 'load.planned-effort', { template: t.id, kind: t.kind, deload: opts.deload ?? false }, {
    threshold: { circuit: LOAD.circuitRpe, short: LOAD.shortRpe, cardio: LOAD.cardioRpe, deloadDrop: LOAD.deloadDrop },
    note: `Planned effort ${rpe}/10 for ${t.name}: ${basis}${opts.deload ? ', 2 lower in a deload week' : ''}. A heuristic, not a logged RPE.`,
  });
}

export interface PlannedSessionLoad {
  template: string;
  name: string;
  minutes: number | null;
  rpe: number;
  load: number | null;
}

/** Next week's planned load: each planned session's typical minutes times its planned effort (both heuristic). */
export function plannedLoad(planned: readonly PlannedSessionLoad[], from: IsoDate): Result<{ from: IsoDate; sessions: PlannedSessionLoad[]; load: number | null; heuristic: true }> {
  const unknown = planned.filter((p) => p.load === null).length;
  const load = unknown ? null : planned.reduce((a, p) => a + p.load!, 0);
  return explain({ from, sessions: [...planned], load, heuristic: true as const }, 'load.planned', { from, sessions: planned.map((p) => p.template) }, {
    threshold: { minutes: `lifting days: median logged minutes per session type over ${LOAD.minutesLookbackDays} days; short days: their minutes as planned, from their items`, effort: 'plannedEffort (heuristic)' },
    note: joinNotes(
      load !== null && `About ${Math.round(load)} (RPE x min) over ${planned.length} planned session(s): typical minutes times a planned effort, a heuristic.`,
      unknown > 0 && `${unknown} planned session(s) have no logged minutes to go by: the planned load is unknown.`,
    ),
  });
}
