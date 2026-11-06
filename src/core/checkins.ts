// The weekly check-in's answers as inputs to the rules (checkin.md): fatigue
// for the stall triage, where the triage left off, the check-in deload
// triggers, busy weeks, cancelled deloads, deload weeks trained at full load,
// reported RIR, and the RIR calibration bias. Each helper reads the records
// dated on or before the date it is given.

import { addDays, daysBetween, mondayOf } from './dates.ts';
import { exerciseId } from './plan-data.ts';
import { explain, joinNotes, type Result } from './reason.ts';
import type { BusyPeriod, DailyCheckin, IsoDate, JointAche, RirCalibration, TriageRecord, WeeklyCheckin } from './schema.ts';

export const CHECKIN = {
  /** Recovery (1-5) at or under this is poor. */
  poorRecovery: 2,
  /** A joint ache counts as a fatigue sign over 3/10 (the pain rule's line), or when it lingered. */
  acheSeverity: 4,
  /** A triage record older than this restarts the ladder at step 1. */
  triageStaleDays: 28,
  /** The latest check-in counts for this many days after its date. */
  freshDays: 7,
} as const;

/** The reviewed week's Monday of a record. */
export function weekStartOf(w: WeeklyCheckin): IsoDate | null {
  return w.weekStart ?? w.weekOf ?? (w.date ? mondayOf(w.date) : null);
}

/** A record's date: its check-in date, else the Sunday of its week. */
export function checkinDate(w: WeeklyCheckin): IsoDate | null {
  if (w.date) return w.date;
  const m = weekStartOf(w);
  return m ? addDays(m, 6) : null;
}

/** The records dated on or before `date`, oldest first. */
export function checkinsThrough(records: readonly WeeklyCheckin[], date: IsoDate): WeeklyCheckin[] {
  return records
    .filter((w) => {
      const d = checkinDate(w);
      return d !== null && d <= date;
    })
    .sort((a, b) => (checkinDate(a)! < checkinDate(b)! ? -1 : checkinDate(a)! > checkinDate(b)! ? 1 : 0));
}

/** The joint aches of a record; a first-v1 `true` is one ache of unknown area that counts. */
export function jointAchesOf(w: WeeklyCheckin | null | undefined): { aches: JointAche[]; fatigue: boolean | null } {
  const j = w?.jointAches;
  if (j === undefined) return { aches: [], fatigue: null };
  if (typeof j === 'boolean') return { aches: j ? [{ area: 'unspecified', severity: CHECKIN.acheSeverity }] : [], fatigue: j };
  return { aches: j, fatigue: j.some((a) => a.severity >= CHECKIN.acheSeverity || a.lingered === true) };
}

export interface Fatigue {
  /** The check-in the values came from, or null when there is none recent enough. */
  from: IsoDate | null;
  recovery: number | null;
  poorRecovery: boolean;
  jointAches: boolean | null;
}

/** Recovery and joint aches from the latest check-in within a week of the date. */
export function fatigueFrom(records: readonly WeeklyCheckin[], date: IsoDate): Result<Fatigue> {
  const last = checkinsThrough(records, date).at(-1) ?? null;
  const fresh = last && daysBetween(checkinDate(last)!, date) <= CHECKIN.freshDays ? last : null;
  const recovery = fresh?.recovery ?? null;
  const aches = jointAchesOf(fresh);
  const value: Fatigue = { from: fresh ? checkinDate(fresh) : null, recovery, poorRecovery: recovery !== null && recovery <= CHECKIN.poorRecovery, jointAches: aches.fatigue };
  return explain(value, 'checkin.fatigue', { date, checkin: value.from, recovery, aches: aches.aches }, {
    threshold: { poorRecovery: CHECKIN.poorRecovery, acheSeverity: CHECKIN.acheSeverity, freshDays: CHECKIN.freshDays },
    note: !fresh
      ? last
        ? `The latest check-in (${checkinDate(last)}) is more than ${CHECKIN.freshDays} days old: no recovery or joint-ache answers used.`
        : 'No check-in recorded: no recovery or joint-ache answers.'
      : joinNotes(
          recovery !== null && `Recovery ${recovery}/5${value.poorRecovery ? ' (poor)' : ''} at the ${value.from} check-in.`,
          aches.fatigue === true && `Joint aches over 3/10 or lingering: ${aches.aches.filter((a) => a.severity >= CHECKIN.acheSeverity || a.lingered).map((a) => `${a.area} ${a.severity}/10`).join(', ')}.`,
          aches.fatigue === false && 'No joint aches over 3/10.',
        ),
  });
}

/** Does a record's lift name match one of the exercise's aliases (id, plan name, short name)? */
export function liftMatches(lift: string, aliases: readonly string[]): boolean {
  const k = exerciseId(lift);
  return aliases.some((a) => exerciseId(a) === k);
}

/**
 * Where the stall triage starts for a lift: one step after the last step a
 * letter applied (one step per check-in), capped at 4. A record older than
 * 28 days, or none, starts at step 1.
 */
export function triageStart(records: readonly WeeklyCheckin[], aliases: readonly string[], date: IsoDate): Result<{ startAt: 1 | 2 | 3 | 4; last: TriageRecord | null }> {
  const all = checkinsThrough(records, date).flatMap((w) => w.triage ?? []).filter((t) => t.date <= date && liftMatches(t.lift, aliases));
  const last = all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).at(-1) ?? null;
  const stale = last !== null && daysBetween(last.date, date) > CHECKIN.triageStaleDays;
  const startAt = (!last || stale ? 1 : Math.min(4, last.step + 1)) as 1 | 2 | 3 | 4;
  return explain({ startAt, last }, 'checkin.triage-start', { date, lift: aliases[0] ?? null, last }, {
    threshold: { staleDays: CHECKIN.triageStaleDays },
    note: !last
      ? 'No triage step recorded for this lift: start at step 1.'
      : stale
        ? `The last triage step (${last.step} on ${last.date}) is more than ${CHECKIN.triageStaleDays} days old: start again at step 1.`
        : `The ${last.date} letter took step ${last.step}: this check-in starts at step ${startAt}.`,
  });
}

/** checkin.md's early-deload trigger: two check-ins running (consecutive weeks) with poor recovery and joint aches. */
export function recoveryTrigger(records: readonly WeeklyCheckin[], date: IsoDate): Result<boolean> {
  const recs = checkinsThrough(records, date);
  const [a, b] = recs.slice(-2);
  const poor = (w: WeeklyCheckin | undefined) => w !== undefined && w.recovery !== undefined && w.recovery <= CHECKIN.poorRecovery && jointAchesOf(w).fatigue === true;
  const fresh = b !== undefined && daysBetween(checkinDate(b)!, date) <= CHECKIN.freshDays;
  const consecutive = a !== undefined && b !== undefined && daysBetween(weekStartOf(a)!, weekStartOf(b)!) === 7;
  const fired = fresh && consecutive && poor(a) && poor(b);
  return explain(fired, 'checkin.early-deload', { date, checkins: [a, b].filter(Boolean).map((w) => ({ date: checkinDate(w!), recovery: w!.recovery ?? null, jointAches: jointAchesOf(w).fatigue })) }, {
    threshold: { checkins: 2, poorRecovery: CHECKIN.poorRecovery, acheSeverity: CHECKIN.acheSeverity },
    note: fired
      ? `Poor recovery and joint aches at two check-ins running (${checkinDate(a!)}, ${checkinDate(b!)}): offer an early light week (heuristic); the user decides.`
      : undefined,
  });
}

/** Known busy periods from the records dated on or before the date (duplicates dropped). */
export function busyPeriods(records: readonly WeeklyCheckin[], date: IsoDate): BusyPeriod[] {
  const seen = new Set<string>();
  const out: BusyPeriod[] = [];
  for (const w of checkinsThrough(records, date)) {
    for (const b of w.knownBusy ?? []) {
      const k = `${b.from}|${b.to}|${b.kind}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(b);
      }
    }
  }
  return out;
}

/** Mondays of the weeks whose deload the user cancelled: the week after each check-in that says so. */
export function cancelledDeloadWeeks(records: readonly WeeklyCheckin[], date: IsoDate): IsoDate[] {
  return checkinsThrough(records, date)
    .filter((w) => w.deload?.cancelled === true)
    .map((w) => mondayOf(addDays(checkinDate(w)!, 1)));
}

/**
 * The user's deload override for the week holding the date: cancelled when a
 * check-in in the week before asked for it; previousCancelled when the
 * previous mesocycle's deload (about `every` weeks earlier) was cancelled too.
 */
export function cancelState(records: readonly WeeklyCheckin[], date: IsoDate, every = 4): { cancelled: boolean; previousCancelled: boolean; weeks: IsoDate[] } {
  const weeks = cancelledDeloadWeeks(records, date);
  const monday = mondayOf(date);
  return {
    cancelled: weeks.includes(monday),
    previousCancelled: weeks.some((w) => w >= addDays(monday, -7 * (every + 1)) && w <= addDays(monday, -7 * (every - 1))),
    weeks,
  };
}

/** Mondays of dashboard deload weeks the user trained at full load. */
export function fullLoadWeeks(records: readonly WeeklyCheckin[], date: IsoDate): IsoDate[] {
  return [...new Set(checkinsThrough(records, date).flatMap((w) => w.deload?.trainedAtFullLoad ?? []))].sort();
}

/** Days marked rest or missed, and sessions confirmed as done but not logged, from the records. */
export function markedDays(records: readonly WeeklyCheckin[]): { rest: Set<IsoDate>; missed: Set<IsoDate>; confirmed: { date: IsoDate; type?: string }[] } {
  const rest = new Set<IsoDate>();
  const missed = new Set<IsoDate>();
  const confirmed: { date: IsoDate; type?: string }[] = [];
  const seen = new Set<string>();
  for (const w of records) {
    for (const d of w.restDays ?? []) rest.add(d);
    for (const d of w.missedDays ?? []) missed.add(d);
    (w.confirmedUnlogged ?? []).forEach((c, i) => {
      const k = `${c.date}|${c.type ?? ''}|${i}|${checkinDate(w)}`;
      if (!seen.has(k)) {
        seen.add(k);
        confirmed.push(c);
      }
    });
  }
  return { rest, missed, confirmed };
}

/**
 * A day's marks: the body record's (rest or missed, the Workout tick) and the
 * Sunday check-ins' dated on or before `date` (their rest and missed days,
 * and the days they say were trained but not logged). A mark on the day
 * itself comes first. Today's strip, the Progress calendar and "Did you
 * train today?" read them.
 */
export function dayMarks(daily: readonly DailyCheckin[], weekly: readonly WeeklyCheckin[], date: IsoDate): (day: IsoDate) => { mark?: 'rest' | 'missed'; trained?: boolean; confirmed?: boolean } | undefined {
  const byDay = new Map(daily.map((d) => [d.date, d]));
  const marks = markedDays(checkinsThrough(weekly, date));
  const confirmed = new Set(marks.confirmed.map((c) => c.date));
  return (day) => {
    const c = byDay.get(day);
    const mark = c?.mark ?? (marks.missed.has(day) ? 'missed' : marks.rest.has(day) ? 'rest' : undefined);
    const out = { ...(mark ? { mark } : {}), ...(c?.trained ? { trained: true } : {}), ...(confirmed.has(day) ? { confirmed: true } : {}) };
    return Object.keys(out).length ? out : undefined;
  };
}

/**
 * The RIR the user reported for a session's top sets: the check-in whose
 * reviewed week holds the session (its per-lift value, else its one number).
 */
export function reportedRirFor(records: readonly WeeklyCheckin[], aliases: readonly string[], sessionDate: IsoDate): { rir: number; checkin: IsoDate; perLift: boolean } | null {
  for (const w of [...records].reverse()) {
    const monday = weekStartOf(w);
    const d = checkinDate(w);
    if (!monday || !d || sessionDate < monday || sessionDate > d) continue;
    const r = w.reportedRir ?? w.rir;
    if (typeof r === 'number') return { rir: r, checkin: d, perLift: false };
    if (r && typeof r === 'object') {
      const hit = Object.entries(r).find(([k]) => liftMatches(k, aliases));
      if (hit) return { rir: hit[1], checkin: d, perLift: true };
    }
  }
  return null;
}

/** The RIR calibration bias for an exercise: its latest calibration on or before the date, actual - predicted. */
export function rirBiasFor(calibration: readonly RirCalibration[] | undefined, aliases: readonly string[], date: IsoDate): { bias: number; entry: RirCalibration } | null {
  const hits = (calibration ?? []).filter((c) => c.date <= date && liftMatches(c.exercise, aliases)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const entry = hits.at(-1);
  return entry ? { bias: entry.actual - entry.predicted, entry } : null;
}
