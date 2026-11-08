// Concurrent training over a planned week (rules.md, "Concurrent training and
// cardio"). The week is cyclic: Sunday is followed by the next Monday.
// Flags, each with a suggestion:
// - conditioning before lifting in the same session (a short easy warm-up is fine);
// - hard leg intervals within 24 h before a heavy lower-body day;
// - two hard days in a row for the same muscle, unless the second is the
//   lighter one for it (`backToBack`).
// `plan` (the generator's check) and `review` (the written plan on the
// user's week) both build their lifting items with `liftItem`, so both
// judge the same week the same way.
//
// The week is the user's real one (`weekLayout`): each session on the
// weekday the log shows it done most often in the last 2 to 4 complete
// weeks, else on the days the profile says they train, else on the default
// layout. A session the log never shows falls back on its own; each flag's
// reason says where its days came from.

import { LOWER_BODY } from './data/muscles.ts';
import { addDays, dayText, daysBetween, mondayOf } from './dates.ts';
import { explain, joinNotes, type Result } from './reason.ts';
import { WEEKDAYS, type Exercise, type IsoDate, type RepRange, type Weekday } from './schema.ts';

export const CONCURRENT = {
  /** Easy conditioning of this many minutes or fewer before lifting is a warm-up. */
  warmUpMinutes: 10,
  /** Conditioning on the same day as lifting goes at least this many hours after it, else lifting first (Moderate). */
  apartHours: 3,
  legGapHours: 24,
  /** Hour of day assumed when a session gives none. */
  defaultHour: 12,
  /**
   * The second of two days running is the lighter one for a muscle when its
   * heaviest work for it is a load you could lift at least this many more
   * times (the bottom of the rep range plus RIR) than the day before's: more
   * reps or more in reserve, as the four-day pairs' lighter days (RIR +1).
   */
  lighterReps: 1,
  /**
   * Hard work is near failure: rules.md's targets are RIR 1-3 for compounds,
   * and 4 or more is about RPE 6 (the Conservative cap, a light week's RIR + 3).
   */
  hardRir: 3,
} as const;

/** Patterns that are never hard work on their own: isolation, core, skill, mobility and conditioning. */
export const NOT_HARD_PATTERNS: ReadonlySet<string> = new Set(['biceps', 'triceps', 'lateral-raise', 'rear-delt', 'calves', 'neck-upper-back', 'hip-abduction', 'chest-fly', 'core-anti-extension', 'core-anti-rotation', 'core-flexion', 'skill', 'mobility', 'conditioning']);

export interface PlannedItem {
  kind: 'lift' | 'conditioning';
  exercise?: string;
  sets?: number;
  minutes?: number;
  /** Lifting is hard unless false (a technique day); conditioning is easy unless true. */
  hard?: boolean;
  /** Conditioning loads the legs unless false (an arm ergometer). */
  legs?: boolean;
  /** A lift's prescription: the load is a weight you could lift about repRange[0] + rir times. */
  repRange?: RepRange;
  rir?: number;
  label?: string;
}

/**
 * A lifting slot as the concurrent checks see it, the one definition `plan`
 * and `review` share: hard when it is a main lift or a compound pattern (not
 * a hold) taken near failure (RIR 3 or less), with its rep range and RIR for
 * the lighter-day test.
 */
export function liftItem(slot: { exercise: string; sets: number; repRange: RepRange; rir: number; main?: boolean }, exercise: Exercise | undefined, label?: string): PlannedItem {
  const compound = exercise?.pattern !== undefined && !NOT_HARD_PATTERNS.has(exercise.pattern);
  const hard = exercise?.kind !== 'timed' && (slot.main === true || compound) && slot.rir <= CONCURRENT.hardRir;
  return { kind: 'lift', exercise: slot.exercise, sets: slot.sets, hard, repRange: slot.repRange, rir: slot.rir, ...(label !== undefined ? { label } : {}) };
}

export interface PlannedSession {
  id: string;
  /** 0 = Monday ... 6 = Sunday. */
  day: number;
  /** Start hour, 0-23. Without it, sessions on consecutive days count as within 24 h. */
  hour?: number;
  /** Where the day came from (`weekLayout`): each flag's reason names it. */
  source?: DaySource;
  /** In order. */
  items: PlannedItem[];
}

export type ConcurrentFlagId = 'conditioning-before-lifting' | 'intervals-before-heavy-legs' | 'same-muscle-back-to-back';

export interface ConcurrentFlag {
  flag: ConcurrentFlagId;
  sessions: string[];
  muscle?: string;
  suggestion: string;
}

/** One muscle trained hard on two days running, and whether the second day is the lighter one for it. */
export interface BackToBack {
  first: string;
  second: string;
  muscle: string;
  /** The heaviest hard work for the muscle each day, as the reps its load allows (the bottom of the range plus RIR); null when a prescription is missing. */
  firstLoad: number | null;
  secondLoad: number | null;
  /** The second day is the lighter one for this muscle: allowed (a heavy day followed by its lighter day). */
  lighter: boolean;
  suggestion: string;
}

const isHardLift = (i: PlannedItem) => i.kind === 'lift' && i.hard !== false;
const isLegIntervals = (i: PlannedItem) => i.kind === 'conditioning' && i.hard === true && i.legs !== false;

function hardMuscles(s: PlannedSession, exercises: Readonly<Record<string, Exercise>>): Set<string> {
  const out = new Set<string>();
  for (const i of s.items) if (isHardLift(i) && i.exercise) for (const m of exercises[i.exercise]?.muscles?.main ?? []) out.add(m);
  return out;
}

/** The session's heaviest hard work for a muscle, as the reps its load allows (fewest = heaviest); null when an item has no prescription. */
function heaviestFor(s: PlannedSession, muscle: string, exercises: Readonly<Record<string, Exercise>>): number | null {
  const loads = s.items
    .filter((i) => isHardLift(i) && i.exercise && (exercises[i.exercise]?.muscles?.main ?? []).includes(muscle))
    .map((i) => (i.repRange && i.rir !== undefined ? i.repRange[0] + i.rir : null));
  return loads.length === 0 || loads.includes(null) ? null : Math.min(...(loads as number[]));
}

/** Hours from session a's start to session b's start, going forward around the week (0 to 167). */
function hoursForward(a: PlannedSession, b: PlannedSession): number {
  const t = (s: PlannedSession) => s.day * 24 + (s.hour ?? CONCURRENT.defaultHour);
  return (((t(b) - t(a)) % 168) + 168) % 168;
}

const dayGap = (a: PlannedSession, b: PlannedSession) => (((b.day - a.day) % 7) + 7) % 7;

export function checkConcurrent(week: readonly PlannedSession[], exercises: Readonly<Record<string, Exercise>>): Result<ConcurrentFlag>[] {
  const out: Result<ConcurrentFlag>[] = [];
  const flag = (f: ConcurrentFlag, inputs: Record<string, unknown>, threshold: unknown) => {
    const days = daysOf(f.sessions.map((id) => week.find((s) => s.id === id)));
    out.push(explain(f, `concurrent.${f.flag}`, { ...inputs, ...(days ? { days: days.inputs } : {}) }, { threshold, note: joinNotes(f.suggestion, days?.note) }));
  };

  for (const s of week) {
    const firstLift = s.items.findIndex(isHardLift);
    if (firstLift < 0) continue;
    const before = s.items.slice(0, firstLift).filter(
      (i) => i.kind === 'conditioning' && (i.hard === true || (i.minutes ?? Infinity) > CONCURRENT.warmUpMinutes),
    );
    if (before.length > 0) {
      flag(
        {
          flag: 'conditioning-before-lifting',
          sessions: [s.id],
          suggestion: `Lift first in ${s.id}: move ${before.map((i) => i.label ?? 'the conditioning').join(', ')} after the lifting, or to a non-lifting day (or ${CONCURRENT.apartHours}+ h apart). A 5-10 min easy warm-up is fine.`,
        },
        { session: s.id, items: before.map((i) => ({ label: i.label ?? null, minutes: i.minutes ?? null, hard: i.hard ?? false })) },
        { warmUpMinutes: CONCURRENT.warmUpMinutes },
      );
    }
  }

  const heavyLegs = week.filter((s) => [...hardMuscles(s, exercises)].some((m) => LOWER_BODY.includes(m)));
  for (const a of week.filter((s) => s.items.some(isLegIntervals))) {
    for (const b of heavyLegs) {
      if (a === b) continue;
      const known = a.hour !== undefined && b.hour !== undefined;
      const gap = known ? hoursForward(a, b) : dayGap(a, b) * 24;
      const close = known ? gap < CONCURRENT.legGapHours : dayGap(a, b) <= 1;
      if (!close) continue;
      flag(
        {
          flag: 'intervals-before-heavy-legs',
          sessions: [a.id, b.id],
          suggestion: `Hard leg intervals in ${a.id} come ${known ? `${gap} h` : 'less than a day'} before the heavy lower-body day ${b.id}: move the intervals after it, or 24 h+ earlier.`,
        },
        { intervals: a.id, heavyLegs: b.id, hoursApart: known ? gap : null, days: dayGap(a, b) },
        { minHours: CONCURRENT.legGapHours },
      );
    }
  }

  for (const r of backToBack(week, exercises)) {
    if (r.value.lighter) continue;
    const { first, second, muscle, firstLoad, secondLoad } = r.value;
    flag(
      { flag: 'same-muscle-back-to-back', sessions: [first, second], muscle, suggestion: r.value.suggestion },
      { first, second, muscle, firstLoad, secondLoad },
      { minDaysBetween: 2, lighterReps: CONCURRENT.lighterReps },
    );
  }
  return out;
}

/**
 * Every muscle trained hard on two days running (planning.md: no muscle
 * trained hard two days running, H), each with its verdict. rules.md's
 * heavy/light week puts a lighter day after each heavy one, so the pair is
 * allowed when the second day is the lighter one for that muscle: its
 * heaviest work for it is a load you could lift at least `lighterReps` more
 * times than the day before's. A lighter day followed by a heavy one, equal
 * loads, or a missing prescription are flagged: the rules allow only the
 * heavy-then-lighter order.
 */
export function backToBack(week: readonly PlannedSession[], exercises: Readonly<Record<string, Exercise>>): Result<BackToBack>[] {
  const out: Result<BackToBack>[] = [];
  const seen = new Set<string>();
  for (const a of week) {
    for (const b of week) {
      if (a === b || dayGap(a, b) !== 1) continue;
      const shared = [...hardMuscles(a, exercises)].filter((m) => hardMuscles(b, exercises).has(m));
      for (const m of shared) {
        const key = `${a.id}|${b.id}|${m}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const firstLoad = heaviestFor(a, m, exercises);
        const secondLoad = heaviestFor(b, m, exercises);
        const lighter = firstLoad !== null && secondLoad !== null && secondLoad - firstLoad >= CONCURRENT.lighterReps;
        const loads = firstLoad !== null && secondLoad !== null ? ` (its heaviest ${m} work is a load for about ${secondLoad} reps, against ${firstLoad} the day before)` : '';
        const suggestion = lighter
          ? `${m} trains hard in ${a.id} and the next day in ${b.id}, but ${b.id} is the lighter day for it${loads}: a heavy day followed by its lighter day.`
          : `${m} trains hard in ${a.id} and again the next day in ${b.id}${loads}: move one session a day, or make ${b.id} the lighter day for ${m} (a load you could lift more times: more reps or more in reserve).`;
        const days = daysOf([a, b]);
        out.push(explain<BackToBack>({ first: a.id, second: b.id, muscle: m, firstLoad, secondLoad, lighter, suggestion }, 'concurrent.back-to-back', { first: a.id, second: b.id, muscle: m, firstLoad, secondLoad, ...(days ? { days: days.inputs } : {}) }, { threshold: { lighterReps: CONCURRENT.lighterReps, minDaysBetween: 2 }, note: joinNotes(suggestion, days?.note) }));
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- the user's week

/** Where a session's weekday came from: the log, the days the profile says the user trains, or the default layout. */
export type DaySource = 'log' | 'available' | 'default';

/** How the reasons name each source. */
export const DAY_SOURCES: Readonly<Record<DaySource, string>> = { log: 'your logged weeks', available: 'your available days', default: 'the default layout' };

export const REAL_WEEK = {
  /** The log sets the days from the last complete weeks: at least this many of them, */
  minWeeks: 2,
  /** and at most this many. */
  maxWeeks: 4,
} as const;

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const andList = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** The sessions with their days, grouped by source in order of appearance: "A Mon and B Tue (your logged weeks); S2 Sat (the default layout)". */
function sourcesText(placed: readonly { id: string; day: number; source?: DaySource }[]): string {
  const groups: { source: DaySource; items: string[] }[] = [];
  for (const p of placed) {
    if (!p.source) continue;
    let g = groups.find((x) => x.source === p.source);
    if (!g) groups.push((g = { source: p.source, items: [] }));
    g.items.push(`${p.id} ${WD[p.day]}`);
  }
  return groups.map((g) => `${andList(g.items)} (${DAY_SOURCES[g.source]})`).join('; ');
}

/** A flag's sessions with their days and sources, for its reason; null when no session says where its day came from. */
function daysOf(sessions: readonly (PlannedSession | undefined)[]): { inputs: { session: string; day: Weekday; source: DaySource }[]; note: string } | null {
  const known = [...new Set(sessions)].filter((s): s is PlannedSession & { source: DaySource } => s?.source !== undefined);
  if (!known.length) return null;
  return { inputs: known.map((s) => ({ session: s.id, day: WEEKDAYS[s.day]!, source: s.source })), note: `Days: ${sourcesText(known)}.` };
}

/** One logged session: its date and which session it was (a plan type such as "A" or "S1"). */
export interface LoggedSession {
  date: IsoDate;
  id: string;
}

export interface LoggedWeekdays {
  /** The Mondays of the complete weeks read, oldest first; empty when fewer than `REAL_WEEK.minWeeks` are complete. */
  weeks: IsoDate[];
  /** Each session's weekday (0 = Monday): the one it was done on most often in those weeks, a tie going to the latest. */
  days: Record<string, number>;
  /** How many times each session was done on each weekday (Monday first) in those weeks. */
  counts: Record<string, number[]>;
}

/**
 * The weekday each session was done on most often over the last 2 to 4
 * complete Monday-to-Sunday weeks (ending on the Sunday on or before the
 * date, as adherence counts them), only the cycle's with `since` (a week
 * that began before it is left out). A tie goes to the weekday it was done
 * on last. Fewer than 2 complete weeks: no weekdays.
 */
export function loggedWeekdays(log: readonly LoggedSession[], date: IsoDate, since: IsoDate | null = null): LoggedWeekdays {
  const sunday = addDays(mondayOf(addDays(date, 1)), -1);
  const weeks: IsoDate[] = [];
  for (let k = REAL_WEEK.maxWeeks - 1; k >= 0; k--) {
    const monday = addDays(sunday, -7 * k - 6);
    if (!since || monday >= since) weeks.push(monday);
  }
  if (weeks.length < REAL_WEEK.minWeeks) return { weeks: [], days: {}, counts: {} };
  const counts: Record<string, number[]> = {};
  const latest: Record<string, IsoDate[]> = {};
  for (const s of log) {
    if (s.date < weeks[0]! || s.date > sunday) continue;
    const d = daysBetween(mondayOf(s.date), s.date);
    const c = (counts[s.id] ??= [0, 0, 0, 0, 0, 0, 0]);
    c[d] = c[d]! + 1;
    const l = (latest[s.id] ??= ['', '', '', '', '', '', '']);
    if (s.date > l[d]!) l[d] = s.date;
  }
  const days: Record<string, number> = {};
  for (const [id, c] of Object.entries(counts)) {
    const l = latest[id]!;
    let best = 0;
    for (let d = 1; d < 7; d++) if (c[d]! > c[best]! || (c[d] === c[best] && l[d]! > l[best]!)) best = d;
    days[id] = best;
  }
  return { weeks, days, counts };
}

/** A session of the week to lay out: its id (the plan type) and its kind. */
export interface LayoutSession {
  id: string;
  kind: 'lift' | 'short';
}

export interface WeekLayoutInput {
  /** The week's sessions in rotation order. */
  sessions: readonly LayoutSession[];
  /** The plan's sessions as logged, each with its date and id. */
  log?: readonly LoggedSession[];
  /** The day the week is read on: the log's weeks are the complete ones up to it. */
  date: IsoDate;
  /** The cycle start: only the cycle's weeks are read (null: any). */
  since?: IsoDate | null;
  /** The days the user said they train (the profile's availability.fixedDays). */
  available?: readonly Weekday[] | null;
  /** The default layout: the lifting days and the short days in order (0 = Monday), and each weekday's start hour. */
  fallback: { lift: readonly number[]; short: readonly number[]; hours?: readonly number[] };
}

export interface PlacedSession extends LayoutSession {
  day: number;
  /** The default layout's start hour; the log and the available days give none. */
  hour?: number;
  source: DaySource;
}

export interface WeekLayout {
  /** The sessions placed, in the input's order. */
  sessions: PlacedSession[];
  /** Sessions left without a free day (more sessions than days): not checked. */
  unplaced: string[];
  /** The Mondays of the logged weeks read; empty when the log has fewer than 2 complete weeks. */
  weeks: IsoDate[];
  /** The sources used, in the order log, available days, default layout. */
  sources: DaySource[];
}

/**
 * The user's week for the concurrent checks. Each session goes on the
 * weekday the log shows it done most often (`loggedWeekdays`; two sessions
 * on one day when that is how they were done). A session the log does not
 * show falls back on its own, lifting first and each in rotation order: the
 * next free day the user said they train, else the next free day of its
 * kind in the default layout, else any free day, else it is left unplaced
 * (more sessions than days). Only the default layout gives a start hour.
 */
export function weekLayout(input: WeekLayoutInput): Result<WeekLayout> {
  const logged = loggedWeekdays(input.log ?? [], input.date, input.since ?? null);
  const available = [...new Set((input.available ?? []).map((d) => WEEKDAYS.indexOf(d)).filter((d) => d >= 0))].sort((a, b) => a - b);
  const placed: (PlacedSession | null)[] = input.sessions.map(() => null);
  const used = new Set<number>();
  const put = (i: number, day: number, source: DaySource) => {
    const s = input.sessions[i]!;
    const hour = source === 'default' ? input.fallback.hours?.[day] : undefined;
    placed[i] = { id: s.id, kind: s.kind, day, ...(hour !== undefined ? { hour } : {}), source };
    used.add(day);
  };
  input.sessions.forEach((s, i) => {
    const d = logged.days[s.id];
    if (d !== undefined) put(i, d, 'log');
  });
  const open = (kind: 'lift' | 'short') => input.sessions.flatMap((s, i) => (s.kind === kind && !placed[i] ? [i] : []));
  for (const kind of ['lift', 'short'] as const) {
    for (const i of open(kind)) {
      const d = available.find((x) => !used.has(x));
      if (d !== undefined) put(i, d, 'available');
    }
  }
  for (const kind of ['lift', 'short'] as const) {
    for (const i of open(kind)) {
      const d = input.fallback[kind].find((x) => !used.has(x));
      if (d !== undefined) put(i, d, 'default');
    }
  }
  // A session whose kind has no free day left takes any free day, in the default layout's order.
  const anyDay = [...new Set([...input.fallback.lift, ...input.fallback.short, 0, 1, 2, 3, 4, 5, 6])];
  for (const kind of ['lift', 'short'] as const) {
    for (const i of open(kind)) {
      const d = anyDay.find((x) => !used.has(x));
      if (d !== undefined) put(i, d, 'default');
    }
  }

  const sessions = placed.filter((p): p is PlacedSession => p !== null);
  const unplaced = input.sessions.filter((_, i) => !placed[i]).map((s) => s.id);
  const sources = (['log', 'available', 'default'] as const).filter((src) => sessions.some((p) => p.source === src));
  const ids = (src: DaySource) => sessions.filter((p) => p.source === src).map((p) => p.id);
  const notLogged = input.sessions.filter((_, i) => placed[i]?.source !== 'log').map((s) => s.id);
  const n = logged.weeks.length;
  const from = n ? dayText(logged.weeks[0]!) : '';
  const daysText = (ds: readonly number[]) => andList(ds.map((d) => WD[d]!));
  return explain<WeekLayout>(
    { sessions, unplaced, weeks: logged.weeks, sources },
    'concurrent.week',
    { date: input.date, since: input.since ?? null, weeks: logged.weeks, logged: logged.counts, available: input.available ?? null, fallback: { lift: input.fallback.lift, short: input.fallback.short } },
    {
      threshold: { minWeeks: REAL_WEEK.minWeeks, maxWeeks: REAL_WEEK.maxWeeks },
      note: joinNotes(
        sessions.length ? `The week: ${sourcesText(sessions)}.` : 'No session to lay out.',
        n === 0
          ? notLogged.length > 0 && `Fewer than ${REAL_WEEK.minWeeks} complete weeks ${input.since ? `since the cycle began on ${dayText(input.since)}` : 'to read'}, so the log does not set the days.`
          : ids('log').length
            ? `${andList(ids('log'))}: the weekday each was done on most often in the ${n} complete weeks from ${from}, a tie going to the latest${notLogged.length ? `; ${andList(notLogged)} not logged in them` : ''}.`
            : `No session of the week was logged in the ${n} complete weeks from ${from}.`,
        ids('default').length > 0 && (available.length ? `${andList(ids('default'))}: no free day left among the days you train (${daysText(available)}).` : 'The profile does not say which days you train.'),
        ids('default').length > 0 && `The default layout: lifting ${daysText(input.fallback.lift)}; short ${daysText(input.fallback.short)}.`,
        unplaced.length > 0 && `${andList(unplaced)}: no free day left, so not checked.`,
        sessions.some((p) => p.hour === undefined) && 'A day from the log or the profile has no start time: sessions on consecutive days count as within 24 h.',
      ),
    },
  );
}
