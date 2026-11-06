// The Today screen's report: the review and today's session, plus what the
// screen draws that no command prints: today's readiness inputs against
// their baselines, the week's days and calm notes for missing pieces. Pure:
// the date is an input (the plugin reads the clock, never this module).

import type { VaultData } from '../adapters/vault/convert.ts';
import type { VaultRead } from '../adapters/vault/read.ts';
import { dayMarks } from '../core/checkins.ts';
import { addDays, mondayOf } from '../core/dates.ts';
import { readinessInputs } from '../core/readiness.ts';
import type { IsoDate } from '../core/schema.ts';
import type { SessionMode } from '../core/variant.ts';
import { cycleOf, scopeInfo } from './cycle.ts';
import { envelope, sourcesOf } from './envelope.ts';
import { buildReview, painWarning, skipWarnings } from './review.ts';
import { buildSession, type SessionPick } from './session.ts';
import { dayText } from './checkin.ts';
import { coachStepsOf } from './checkin-screen.ts';
import { paths } from '../adapters/vault/layout.ts';

export type DayState = 'trained' | 'unlogged' | 'rest' | 'missed' | 'none' | 'future';

export interface WeekDay {
  date: IsoDate;
  state: DayState;
  today: boolean;
  /** Before the cycle start (a cycle begun mid-week): nothing from then is shown. */
  beforeCycle?: boolean;
  /** Unlogged because the Sunday check-in says a session was done that day (trained, not logged), not a Workout tick. */
  confirmed?: boolean;
  /** kind: the plan's kind for the session type (lift, short, ...), or custom. */
  sessions: { type: string; name: string; kind: string; label?: string; minutes?: number }[];
}

export interface TodayNote {
  code: string;
  text: string;
}

type Review = ReturnType<typeof buildReview>;
type Session = ReturnType<typeof buildSession>;

/**
 * Monday to Sunday of the week holding `date`. trained: a session logged;
 * unlogged: the Workout habit ticked, or the Sunday check-in saying a
 * session was done (`confirmed`), with nothing logged; rest and missed: a
 * day marked so (on the day, or in the check-in); none: a past day with
 * nothing logged, ticked or marked; future: after `date`. A day before
 * `since` (the cycle start, when the cycle began this week) is none and
 * marked `beforeCycle`, whatever it holds.
 */
export function weekDays(data: VaultData, review: Review, date: IsoDate, since: IsoDate | null = null): WeekDay[] {
  const marksOf = dayMarks(data.checkins.daily, data.checkins.weekly, date);
  const kinds = new Map(data.plan.types.map((t) => [t.type, t.kind as string]));
  const monday = mondayOf(date);
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(monday, i);
    if (since && d < since) return { date: d, state: 'none' as const, today: d === date, beforeCycle: true, sessions: [] };
    const sessions = review.thisWeek.sessions
      .filter((s) => s.date === d)
      .map((s) => {
        const x = s as unknown as { type: string; name?: string; label?: string; minutes?: number };
        return { type: String(x.type), name: x.name ?? String(x.type), kind: kinds.get(String(x.type)) ?? 'custom', ...(x.label ? { label: String(x.label) } : {}), ...(x.minutes !== undefined ? { minutes: x.minutes } : {}) };
      });
    const m = marksOf(d);
    const state = dayStateOf(d, date, sessions.length, m);
    return { date: d, state, today: d === date, ...(state === 'unlogged' && m?.confirmed ? { confirmed: true } : {}), sessions };
  });
}

/**
 * One day's state. A day with nothing logged, ticked or marked is `none`
 * (unknown): logs undercount training, so it is never counted as rest or
 * missed. A day the Sunday check-in says was trained is unlogged until a
 * session is logged on it. The Today strip and the Progress calendar both
 * use this.
 */
export function dayStateOf(day: IsoDate, date: IsoDate, sessionCount: number, c?: { mark?: 'rest' | 'missed'; trained?: boolean; confirmed?: boolean }): DayState {
  if (day > date) return 'future';
  if (sessionCount > 0) return 'trained';
  if (c?.confirmed) return 'unlogged';
  if (c?.mark === 'missed') return 'missed';
  if (c?.mark === 'rest') return 'rest';
  if (c?.trained) return 'unlogged';
  return 'none';
}

/** One calm line for each missing piece the screen would otherwise leave blank. */
export function todayNotes(read: VaultRead, review: Review | null, session: Session | null, date: IsoDate): TodayNote[] {
  const notes: TodayNote[] = [];
  const { data } = read;
  if (read.files.plan === 'missing') notes.push({ code: 'no-plan', text: `No plan found (${paths().plan}), so there is no session to show.` });
  if (data.coach.profile === 'missing') notes.push({ code: 'no-profile', text: 'No coach profile yet (Coach/profile.json): the goal band uses the roadmap’s, and the plan generator waits for it.' });
  if (data.coach.ledger === 'missing') notes.push({ code: 'no-ledger', text: 'No Ledger yet (Coach/ledger.json): no injury limits are applied.' });
  if (data.coach.checkins === 'missing') notes.push({ code: 'no-checkins', text: 'No weekly check-in answers yet (Coach/checkins.json): the Sunday check-in writes them.' });
  if (review && review.readiness.today.value.band === 'unscored') {
    const latest = review.readiness.latestScored as { date: IsoDate } | null;
    const hasCheckin = data.checkins.daily.some((d) => d.date === date && (d.energy !== undefined || d.sleepH !== undefined || d.rhr !== undefined));
    // While the cycle's baseline builds, the readiness card says how far; only a missing check-in is worth a note.
    const building = review.readiness.baseline.value.building;
    if (!hasCheckin) notes.push({ code: 'no-checkin-today', text: `No morning check-in today yet${latest && !building ? `: readiness shows the latest, from ${dayText(latest.date)}` : ''}.` });
    else if (!building) notes.push({ code: 'no-checkin-today', text: 'Today’s check-in is not scored yet: readiness needs 3 signals with 14 days of history.' });
  }
  if (session && !session.session) notes.push({ code: 'no-session', text: (session as { note?: string }).note ?? 'No planned session for today.' });
  if (session?.pickNote) notes.push({ code: 'pick-unknown', text: session.pickNote });
  return notes;
}

/** The phase holding the date, by the plan's own name ("Phase 1" in the vault plan). */
export function phaseAt(data: VaultData, date: IsoDate): { index: number; name: string } | null {
  let index = 0;
  for (const p of data.program.macrocycle.phases) {
    index++;
    for (const m of p.mesocycles) for (const w of m.weeks) if (w.start <= date && date <= addDays(w.start, 6)) return { index, name: p.name };
  }
  return null;
}

/**
 * The whole Today report: the review, the session in the given mode (the
 * user's pick, if any), the inputs, the week, the coach step after the
 * Sunday check-in (`extra.letter`: the newest coach letter's text), the notes;
 * the warnings (Data notes) add a pain over 3 of 10 logged in the last week,
 * and the exercises skipped for pain or for equipment twice in 4 weeks.
 */
export function buildToday(read: VaultRead, date: IsoDate, mode: SessionMode, root = '', pick: SessionPick = {}, extra: { letter?: { path: string; text: string } | null } = {}) {
  const { data } = read;
  const planned = read.files.plan !== 'missing';
  const review = planned ? buildReview(data, date) : null;
  const cycle = scopeInfo(data, date);
  const session = planned ? buildSession(data, date, mode, pick) : null;
  return envelope('today', {
    sources: sourcesOf(read, root),
    date,
    mode,
    cycle,
    phase: planned ? phaseAt(data, date) : null,
    review,
    session,
    // Against this cycle's mornings only, as the score is.
    inputs: readinessInputs(data.checkins.daily, date, { since: cycleOf(data, date).value.start }),
    week: review ? weekDays(data, review, date, cycle.since) : [],
    coach: coachStepsOf(read, date, extra.letter ?? null),
    notes: todayNotes(read, review, session, date),
  }, [...data.warnings, ...(planned ? [painWarning(data, date)].filter((w) => w !== null) : []), ...(review ? skipWarnings(review.skips) : [])], data.errors);
}
