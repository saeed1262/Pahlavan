// Adherence over the last 4 complete Monday-to-Sunday weeks, as in numbers.md
// ("Adherence, last 4 complete weeks"): planned against done, by kind. Logs
// undercount training, so this is a lower bound. A shortfall counts as
// unlogged unless the day was marked rest or missed. With a cycle start, only
// the cycle's weeks count: the weeks before a fresh start are not this plan's
// shortfall, so the stall and light-week gates read the cycle's figure.

import { addDays, dayText, mondayOf } from './dates.ts';
import { explain, joinNotes, type Result } from './reason.ts';
import { markedDays, weekStartOf } from './checkins.ts';
import type { DailyCheckin, IsoDate, Program, Session, SessionKind, WeeklyCheckin } from './schema.ts';

export const ADHERENCE = { weeks: 4 } as const;

/** lift and express count as lifting; short, cardio and mobility as short; no plan as custom. */
export type AdherenceKind = 'lift' | 'short' | 'custom';

const BUCKET: Record<SessionKind, AdherenceKind> = {
  lift: 'lift',
  express: 'lift',
  short: 'short',
  cardio: 'short',
  mobility: 'short',
};

/** A session's kind: its snapshot's, else its template's in the program, else custom. */
export function sessionKind(session: Session, program?: Program): AdherenceKind {
  const kind = session.plan?.kind ?? (program ? templateKind(program, session.plan?.template ?? session.template) : undefined);
  return kind ? BUCKET[kind] : 'custom';
}

function templateKind(program: Program, id: string | undefined): SessionKind | undefined {
  if (!id) return undefined;
  for (const ph of program.macrocycle.phases)
    for (const m of ph.mesocycles)
      for (const w of m.weeks) {
        const t = w.sessions.find((x) => x.id === id);
        if (t) return t.kind;
      }
  return undefined;
}

export interface AdherenceWeek {
  weekOf: IsoDate;
  lift: number;
  short: number;
  custom: number;
  /** Distinct dates with a logged session. */
  days: number;
  /** Days the user ticked as trained (the snippet's habit-days). */
  habitDays: number;
  /** Ticked days with no session logged: likely unlogged sessions. */
  ticksWithoutLog: number;
  /** Planned sessions not logged, split by the day marks. */
  gaps: { unlogged: number; missed: number; rest: number };
  /** Sessions the weekly check-ins confirmed as done but not logged (they close the shortfall before the gaps are split). */
  confirmedUnlogged: number;
}

export interface Adherence {
  /** The first Monday counted (with a cycle start, the cycle's first complete week; after `to` when none is complete yet). */
  from: IsoDate;
  to: IsoDate;
  target: { lift: number; short: number };
  weeks: AdherenceWeek[];
  lifting: { done: number; planned: number; pct: number | null };
  short: { done: number; planned: number; pct: number | null };
  meanSessionsPerWeek: number;
  meanTrainingDays: number;
  gaps: { unlogged: number; missed: number; rest: number };
}

export interface AdherenceInput {
  sessions: readonly Session[];
  today: IsoDate;
  /** Planned sessions a week, by kind (the plan's weekly target). */
  target: { lift: number; short: number };
  daily?: readonly DailyCheckin[];
  weekly?: readonly WeeklyCheckin[];
  program?: Program;
  /** The cycle start: weeks whose Monday is before it are left out (as the Progress and Plan screens count them); null or absent: all 4. */
  since?: IsoDate | null;
}

/** The 4 complete weeks ending on the Sunday on or before `today`, those of the cycle only when `since` is given. */
export function adherence(input: AdherenceInput): Result<Adherence> {
  const { sessions, today, target } = input;
  const sunday = addDays(mondayOf(addDays(today, 1)), -1); // today if Sunday, else the Sunday before
  const firstMonday = addDays(sunday, -7 * ADHERENCE.weeks + 1);
  const daily = new Map((input.daily ?? []).map((d) => [d.date, d]));
  const records = input.weekly ?? [];
  const marks = markedDays(records);
  const legacy = new Map(records.filter((w) => !(w.confirmedUnlogged ?? []).length && w.unloggedSessions).map((w) => [weekStartOf(w), w.unloggedSessions!]));
  /** A confirmed session's kind from its type: a template id or plan type (A, S1), or lift, short, custom. */
  const kindOfType = (type: string | undefined): AdherenceKind | null => {
    if (!type) return null;
    const t = type.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (t === 'lift' || t === 'short' || t === 'custom') return t;
    const k = input.program ? templateKind(input.program, t) : undefined;
    return k ? BUCKET[k] : null;
  };

  const since = input.since ?? null;
  const weeks: AdherenceWeek[] = [];
  for (let k = 0; k < ADHERENCE.weeks; k++) {
    const mon = addDays(firstMonday, 7 * k);
    // A week before the cycle start (or the one it began in) is not this cycle's.
    if (since && mon < since) continue;
    const sun = addDays(mon, 6);
    const wk = sessions.filter((s) => s.date >= mon && s.date <= sun);
    const count = (kind: AdherenceKind) => wk.filter((s) => sessionKind(s, input.program) === kind).length;
    const logged = new Set(wk.map((s) => s.date));
    const dates = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
    const ticked = dates.filter((d) => daily.get(d)?.trained === true);
    // A day the check-in confirmed as trained counts as done but not logged only while nothing is logged on it.
    const confirmed = marks.confirmed.filter((c) => c.date >= mon && c.date <= sun && !logged.has(c.date));
    const confirmedDays = new Set(confirmed.map((c) => c.date));
    const marked = (m: 'rest' | 'missed') =>
      dates.filter((d) => (daily.get(d)?.mark === m || marks[m].has(d)) && !logged.has(d) && !confirmedDays.has(d)).length;
    const lift = count('lift');
    const short = count('short');
    // Sessions confirmed as done but not logged close the shortfall first (of their kind; untyped ones either).
    let liftGap = Math.max(0, target.lift - lift);
    let shortGap = Math.max(0, target.short - short);
    const untyped = confirmed.length ? 0 : (legacy.get(mon) ?? 0);
    let anyKind = untyped;
    for (const c of confirmed) {
      const k = kindOfType(c.type);
      if (k === 'lift') liftGap = Math.max(0, liftGap - 1);
      else if (k === 'short') shortGap = Math.max(0, shortGap - 1);
      else if (k === null) anyKind++;
    }
    const fromLift = Math.min(liftGap, anyKind);
    liftGap -= fromLift;
    shortGap = Math.max(0, shortGap - (anyKind - fromLift));
    const shortfall = liftGap + shortGap;
    const missed = Math.min(shortfall, marked('missed'));
    const rest = Math.min(shortfall - missed, marked('rest'));
    weeks.push({
      weekOf: mon,
      lift,
      short,
      custom: count('custom'),
      days: logged.size,
      habitDays: ticked.length,
      ticksWithoutLog: ticked.filter((d) => !logged.has(d)).length,
      gaps: { unlogged: shortfall - missed - rest, missed, rest },
      confirmedUnlogged: confirmed.length || untyped,
    });
  }

  const total = (f: (w: AdherenceWeek) => number) => weeks.reduce((a, w) => a + f(w), 0);
  const liftDone = total((w) => w.lift);
  const shortDone = total((w) => w.short);
  const n = weeks.length;
  const dropped = ADHERENCE.weeks - n;
  const lifting = { done: liftDone, planned: n * target.lift, pct: n && target.lift ? liftDone / (n * target.lift) : null };
  const short = { done: shortDone, planned: n * target.short, pct: n && target.short ? shortDone / (n * target.short) : null };
  const gaps = {
    unlogged: total((w) => w.gaps.unlogged),
    missed: total((w) => w.gaps.missed),
    rest: total((w) => w.gaps.rest),
  };
  const ticks = total((w) => w.ticksWithoutLog);
  const confirmedTotal = total((w) => w.confirmedUnlogged);
  const pct = (x: number | null) => (x === null ? '-' : `${Math.round(x * 100)} %`);
  // The first Monday counted: the 4 weeks' first, or the cycle's first complete week (after `to` while there is none).
  const from = weeks[0]?.weekOf ?? (since && since > firstMonday ? (mondayOf(since) === since ? since : addDays(mondayOf(since), 7)) : firstMonday);
  const clip = since && dropped > 0
    ? n
      ? `${n} of ${ADHERENCE.weeks} weeks, the cycle started ${dayText(since)}: the weeks before it are not counted.`
      : `No complete week since the cycle started ${dayText(since)} yet: adherence counts from its first full week.`
    : null;

  return explain<Adherence>(
    {
      from,
      to: sunday,
      target,
      weeks,
      lifting,
      short,
      meanSessionsPerWeek: n ? total((w) => w.lift + w.short + w.custom) / n : 0,
      meanTrainingDays: n ? total((w) => w.days) / n : 0,
      gaps,
    },
    'adherence.weeks',
    { from, to: sunday, target, sessionsInWindow: total((w) => w.lift + w.short + w.custom), since, weeks: n, ...(since ? { dropped } : {}) },
    {
      threshold: { weeks: ADHERENCE.weeks },
      note: joinNotes(
        n ? `Lifting ${liftDone}/${lifting.planned} = ${pct(lifting.pct)}${target.short ? `, short ${shortDone}/${short.planned} = ${pct(short.pct)}` : ''}.` : null,
        clip,
        'A lower bound: logs undercount training.',
        gaps.unlogged > 0 && `${gaps.unlogged} planned session(s) not logged and not marked rest or missed: ask whether they happened before using this.`,
        ticks > 0 && `${ticks} day(s) ticked as trained with no session logged.`,
        confirmedTotal > 0 && `${confirmedTotal} session(s) the check-ins confirm as done but not logged: not gaps, and not in the percentages.`,
      ),
    },
  );
}
