// Skipped lines and why (the Log panel's Time, Pain, Equipment or Energy on
// each skipped line), over the last 4 weeks, grouped by exercise, with the
// flags they raise: the same exercise skipped for pain twice is the pain
// rule's swap (core/pain.ts); skipped for equipment twice, a swap to
// suggest; lines skipped for time on 2 or more sessions of one week, a
// session too long for the user (the review's `time` has the minutes); an
// energy skip on a low-readiness day, a note and never a rule on its own.
// Pure: the date is an input.

import { addDays, dayText, mondayOf, type IsoDate } from './dates.ts';
import { PAIN, PAIN_ACTIONS } from './pain.ts';
import { explain, joinNotes, type Result } from './reason.ts';
import type { SkipReason } from './schema.ts';

export const SKIPS = {
  /** How far back skips are read: 4 weeks, the pain rule's look-back. */
  days: PAIN.lookbackDays,
  /** The same exercise skipped for pain this many times in the 4 weeks: the pain rule's swap. */
  pain: 2,
  /** The same exercise skipped for equipment this many times in the 4 weeks: suggest a swap. */
  equipment: 2,
  /** Sessions of one week (Monday to Sunday) with a line skipped for time: the session is too long for the user. */
  timeSessions: 2,
  /** The readiness band an energy skip needs for its note. */
  lowBand: 'low',
} as const;

/** One skipped item of a logged session, with its reason (null when none was given). */
export interface SkipLine {
  date: IsoDate;
  /** The session's id, its plan type ("A", "S1") and its display name. */
  session: string;
  type: string;
  sessionName: string;
  exercise: string;
  name: string;
  reason: SkipReason | null;
  /** The session's logged minutes, when it has them (the time flag quotes them). */
  minutes?: number;
}

export interface SkipGroup {
  exercise: string;
  name: string;
  skips: { date: IsoDate; type: string; session: string; reason: SkipReason | null }[];
  /** How many skips had each reason; `none` counts those without one. */
  reasons: Partial<Record<SkipReason | 'none', number>>;
}

export type SkipFlagKind = 'pain' | 'equipment' | 'time' | 'energy';

export interface SkipFlag {
  kind: SkipFlagKind;
  /** pain: the pain rule's swap; equipment: suggest a swap; time: the session is too long (see the review's `time`); energy: a note only. */
  action: 'pain-rule' | 'suggest-swap' | 'too-long' | 'note';
  /** The exercises the flag is about (one for pain and equipment). */
  exercises: { exercise: string; name: string }[];
  dates: IsoDate[];
  /** The sessions' plan types, in date order. */
  types: string[];
  /** time: the week's Monday; null for the others. */
  week: IsoDate | null;
  /** time: each of the week's sessions as planned, against the day's length (the review's `time`). */
  time?: SkipTime[];
}

/** A plan session's planned minutes against its day's length, as the review's `time` checks it. */
export interface SkipTime {
  type: string;
  name: string;
  minutes: number;
  limit: number | null;
  over: number | null;
}

export interface SkipContext {
  /** The readiness band on a date ("low", "watch", ..., "unscored"): an energy skip's note needs a low one. */
  bandOn?: (date: IsoDate) => string;
  /** The plan's sessions as the review's `time` times them, by type: the time flag quotes them. */
  time?: readonly SkipTime[];
}

export interface SkipReport {
  from: IsoDate;
  to: IsoDate;
  /** Skipped items in the 4 weeks, and how many of them had a reason. */
  lines: number;
  withReason: number;
  byExercise: SkipGroup[];
  flags: Result<SkipFlag>[];
}

const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const days = (ds: readonly IsoDate[]) => ds.map(dayText).join(', ');
const uniq = <T>(xs: readonly T[]) => [...new Set(xs)];

/**
 * The last 4 weeks' skipped lines (to the date, inclusive), grouped by
 * exercise (most skipped first), and the flags their reasons raise, each
 * with its reason. A line without a reason is listed and raises nothing.
 */
export function skipReport(all: readonly SkipLine[], date: IsoDate, ctx: SkipContext = {}): Result<SkipReport> {
  const from = addDays(date, -(SKIPS.days - 1));
  const lines = all.filter((l) => l.date >= from && l.date <= date).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const groups = new Map<string, SkipGroup>();
  for (const l of lines) {
    const g = groups.get(l.exercise) ?? { exercise: l.exercise, name: l.name, skips: [], reasons: {} };
    g.skips.push({ date: l.date, type: l.type, session: l.sessionName, reason: l.reason });
    const k = l.reason ?? 'none';
    g.reasons[k] = (g.reasons[k] ?? 0) + 1;
    groups.set(l.exercise, g);
  }
  const byExercise = [...groups.values()].sort((a, b) => b.skips.length - a.skips.length || a.name.localeCompare(b.name));

  const flags: Result<SkipFlag>[] = [];
  const inputs = { from, to: date };

  // The same exercise, skipped for pain (the pain rule's swap) or for equipment (a swap to suggest) twice or more.
  for (const kind of ['pain', 'equipment'] as const) {
    for (const g of byExercise) {
      const hits = lines.filter((l) => l.exercise === g.exercise && l.reason === kind);
      if (hits.length < SKIPS[kind]) continue;
      const ds = hits.map((l) => l.date);
      const value: SkipFlag = { kind, action: kind === 'pain' ? 'pain-rule' : 'suggest-swap', exercises: [{ exercise: g.exercise, name: g.name }], dates: ds, types: hits.map((l) => l.type), week: null };
      const said = `${g.name} skipped for ${kind} ${times(hits.length)} in 4 weeks (${days(ds)})`;
      flags.push(
        explain(value, `skips.${kind}`, { ...inputs, exercise: g.exercise, skips: hits.length }, {
          threshold: { skips: SKIPS[kind], days: SKIPS.days },
          note: kind === 'pain'
            ? `${said}: the pain rule, so ${PAIN_ACTIONS.swap}. Tell the coach.`
            : `${said}: suggest a swap to one the equipment you have allows (the row's Swap in the Log panel lists some), and tell the coach so the plan changes.`,
        }),
      );
    }
  }

  // Time: lines skipped for time on 2 or more sessions of one week.
  const timed = lines.filter((l) => l.reason === 'time');
  for (const week of uniq(timed.map((l) => mondayOf(l.date)))) {
    const hits = timed.filter((l) => mondayOf(l.date) === week);
    const sessions = uniq(hits.map((l) => l.session));
    if (sessions.length < SKIPS.timeSessions) continue;
    const first = sessions.map((id) => hits.find((l) => l.session === id)!);
    const types = first.map((l) => l.type);
    const time = uniq(types).flatMap((t) => (ctx.time ?? []).filter((x) => x.type === t));
    const over = time.filter((x) => (x.over ?? 0) > 0);
    const logged = first.filter((l) => l.minutes !== undefined);
    const value: SkipFlag = { kind: 'time', action: 'too-long', exercises: uniq(hits.map((l) => l.exercise)).map((id) => ({ exercise: id, name: hits.find((l) => l.exercise === id)!.name })), dates: first.map((l) => l.date), types, week, ...(time.length ? { time } : {}) };
    flags.push(
      explain(value, 'skips.time', { ...inputs, week, sessions: sessions.length, see: 'time' }, {
        threshold: { sessions: SKIPS.timeSessions, per: 'week' },
        note: joinNotes(
          `Lines skipped for time on ${sessions.length} sessions in the week of ${dayText(week)} (${first.map((l) => `${l.sessionName}, ${dayText(l.date)}`).join('; ')}): the session is too long for you.`,
          time.length > 0 && `As planned (the review's time): ${time.map((x) => `${x.type} about ${x.minutes} min${x.limit !== null ? ` of your ${x.limit}` : ''}`).join(', ')}${logged.length ? `; as logged: ${logged.map((l) => `${l.type} ${l.minutes} min`).join(', ')}` : ''}.`,
          time.length > 0 && (over.length ? 'Shorten it, or plan the day longer.' : 'It fits as planned, so the sessions run longer than the plan: worth a word with the coach.'),
        ),
      }),
    );
  }

  // Energy on a low-readiness day: a note, never a rule on its own.
  const energy = lines.filter((l) => l.reason === 'energy');
  for (const id of uniq(energy.map((l) => l.session))) {
    const hits = energy.filter((l) => l.session === id);
    const d = hits[0]!.date;
    const band = ctx.bandOn?.(d) ?? 'unscored';
    if (band !== SKIPS.lowBand) continue;
    const value: SkipFlag = { kind: 'energy', action: 'note', exercises: hits.map((l) => ({ exercise: l.exercise, name: l.name })), dates: [d], types: [hits[0]!.type], week: null };
    flags.push(
      explain(value, 'skips.energy', { ...inputs, date: d, band }, {
        threshold: { band: SKIPS.lowBand },
        note: `${hits.map((l) => l.name).join(' and ')} skipped for energy on ${dayText(d)}, a low-readiness day: a note for the coach with the week's sleep and stress, not a rule on its own.`,
      }),
    );
  }

  const withReason = lines.filter((l) => l.reason !== null).length;
  const counts = (['time', 'pain', 'equipment', 'energy'] as const).map((r) => [r, lines.filter((l) => l.reason === r).length] as const).filter(([, n]) => n > 0);
  return explain<SkipReport>({ from, to: date, lines: lines.length, withReason, byExercise, flags }, 'skips', { ...inputs, lines: lines.length, withReason }, {
    threshold: { days: SKIPS.days, pain: SKIPS.pain, equipment: SKIPS.equipment, timeSessions: SKIPS.timeSessions },
    note: lines.length
      ? joinNotes(
          `${lines.length} item${lines.length === 1 ? '' : 's'} skipped since ${dayText(from)} (a paired line's two count apart), ${withReason} with a reason${counts.length ? ` (${counts.map(([r, n]) => `${r} ${n}`).join(', ')})` : ''}.`,
          flags.length ? `${flags.length} flag${flags.length === 1 ? '' : 's'}: ${(['pain', 'equipment', 'time', 'energy'] as const).map((k) => [k, flags.filter((f) => f.value.kind === k).length] as const).filter(([, n]) => n > 0).map(([k, n]) => `${n} for ${k}`).join(', ')}.` : 'Nothing to flag.',
        )
      : `Nothing skipped since ${dayText(from)}.`,
  });
}
