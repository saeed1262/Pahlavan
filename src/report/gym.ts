// The gym page's data, for phone.json's `gym` link: every plan session (and
// each lifting session's Express) as the Log panel's Every set form lays it
// out for the day, slimmed to what the page draws (its rows, each set
// prefilled from the target or last time, a superset's parts, a swap's
// planned item and reason, the plan's rest in seconds and in its own
// words), with the rotation's next session first. Pure: the date is an
// input.

import type { VaultRead } from '../adapters/vault/read.ts';
import { GYM_VERSION, gymLink, type GymData, type GymLast, type GymPart, type GymRow, type GymSession, type GymSet } from '../core/gym.ts';
import type { IsoDate } from '../core/schema.ts';
import type { SessionMode } from '../core/variant.ts';
import { logFormFor, swapCode, type FormPart, type FormRow, type FormSet } from './log-form.ts';
import { buildReview, nextOfDay } from './review.ts';
import { buildSession } from './session.ts';

type Session = ReturnType<typeof buildSession>;
type Item = Session['items'][number];
type Review = ReturnType<typeof buildReview>;

/**
 * The plan's rest in seconds: the low end of a range ("2–3 min" is 120,
 * "60–90 s" is 60), "90 s after each pair" is 90, "1:30" is 90; null when
 * it is not a time ("as needed", or none given).
 */
export function restSeconds(text: string | null | undefined): number | null {
  const t = (text ?? '').trim().toLowerCase();
  const clock = /^(\d+):([0-5]\d)\b/.exec(t);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  // "1 min 30 s": minutes, then seconds.
  const both = /^(\d+)\s*(?:m|mins?|minutes?)\s*(?:and\s*)?(\d+)\s*(?:s|secs?|seconds?)\b/.exec(t);
  if (both) return Number(both[1]) * 60 + Number(both[2]);
  const m = /^(\d+(?:\.\d+)?)\s*(?:(?:[–—-]|to)\s*\d+(?:\.\d+)?\s*)?(s|secs?|seconds?|m|mins?|minutes?)\b/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return Math.round(m[2]!.startsWith('m') ? n * 60 : n);
}

/**
 * The session's item behind each form row, matched as logFormFor matches
 * them: each checklist line's parts in order (by the plan's name, the item
 * it replaces, or its own), an item taken once; a warm-up row has none, and
 * a row off the checklist (`x<k>:`) is item k.
 */
function rowItems(session: Session, rows: readonly FormRow[]): Item[][] {
  const used = new Set<number>();
  const find = (part: string): Item | null => {
    const i = session.items.findIndex((it, k) => !used.has(k) && (it.planName === part || it.replaces?.name === part || it.name === part));
    if (i < 0) return null;
    used.add(i);
    return session.items[i]!;
  };
  return rows.map((r) => {
    if (r.line === null) {
      const k = /^x(\d+):/.exec(r.key);
      const it = k ? session.items[Number(k[1])] : undefined;
      return it ? [it] : [];
    }
    if (r.kind === 'warmup') return [];
    return r.parts.map(find).filter((x): x is Item => x !== null);
  });
}

/** A form set as the page starts it: the tick is the page's own. */
const setOf = ({ weight, reps, rir }: FormSet): GymSet => ({ weight, reps, rir });

/** Last time as the page shows it: the engine's own extras (what was logged, in its unit) left out. */
const lastOf = (l: FormRow['last']): GymLast | null => (l ? { weight: l.weight, unit: l.unit, reps: l.reps, date: l.date } : null);

const partOf = (p: FormPart): GymPart => ({ name: p.name, planned: p.planned, swap: swapCode(p), kind: p.kind, sets: p.sets, range: p.repRange, unit: p.unit, step: p.step, target: p.target, last: lastOf(p.last), rows: p.rows.map(setOf) });

/** A form row for the page, with its item's rest (a superset's: the one after the pair, its last part's that gives one). */
function rowOf(r: FormRow, items: readonly Item[]): GymRow {
  const restText = [...items].reverse().map((it) => it.rest ?? null).find((x) => x !== null) ?? null;
  return {
    key: r.key,
    line: r.line,
    name: r.name,
    planned: r.planned,
    swap: swapCode(r),
    kind: r.kind,
    sr: r.sr,
    sets: r.sets,
    range: r.repRange,
    rir: r.rir,
    lift: r.lift,
    unit: r.unit,
    step: r.step,
    rest: restSeconds(restText),
    restText,
    target: r.target,
    note: r.targetNote ?? r.timed?.text ?? null,
    last: lastOf(r.last),
    rows: r.rows.map(setOf),
    ...(r.split ? { parts: r.split.map(partOf) } : {}),
    ...(r.finisher ? { finisher: true as const } : {}),
  };
}

/** One plan session in one mode for the page; null when the engine builds another for the day (the week's plan does not hold it). */
function gymSession(read: VaultRead, date: IsoDate, type: { type: string; kind: 'lift' | 'short'; label: string }, mode: SessionMode, review: Review): GymSession | null {
  const session = buildSession(read.data, date, mode, { type: type.type }, { review });
  if (session.session?.type !== type.type) return null;
  const form = logFormFor(read, session, date, { tracking: 'full' });
  if (!form) return null;
  const items = rowItems(session, form.rows);
  return {
    type: type.type,
    name: type.label,
    kind: type.kind,
    mode: mode === 'express' ? 'express' : 'full',
    rows: form.rows.map((r, i) => rowOf(r, items[i]!)),
    cardio: form.cardio,
    cardioMode: form.cardioMode,
    minutes: form.minutes,
  };
}

/**
 * The gym page's data for a date: every plan session in full, and each
 * lifting session in Express too when the plan has Express (as phone.json's
 * sessions say `express`), each built as the Log panel's Every set form
 * starts it for that day; `next` the rotation's next for the calendar's day
 * (phone.json's `next`). Null with no plan.
 */
export function gymData(read: VaultRead, date: IsoDate): GymData | null {
  const types = read.data.plan.types;
  if (!types.length || !read.raw?.plan) return null;
  // One review for the day's sessions: each would build the same one.
  const review = buildReview(read.data, date);
  const sessions: GymSession[] = [];
  for (const t of types) {
    const full = gymSession(read, date, t, 'full', review);
    if (full) sessions.push(full);
    if (t.kind === 'lift' && read.data.plan.express !== null) {
      const express = gymSession(read, date, t, 'express', review);
      if (express) sessions.push(express);
    }
  }
  const next = nextOfDay(read.data, date);
  return { v: GYM_VERSION, date, next: next !== null && sessions.some((s) => s.type === next) ? next : null, sessions };
}

/** The longest gym link phone.json carries whole. */
export const GYM_LINK_MAX = 32 * 1024;

/**
 * phone.json's `gym`: the gym page's link for the date, or null with no
 * plan. A link over 32 KB carries only the next session and the sessions
 * logged today (each in its modes): the phone's shortcut copies the link as
 * it is, and those are the sessions the page is opened for that day.
 */
export function gymPhoneLink(read: VaultRead, date: IsoDate, logged: readonly string[], max: number = GYM_LINK_MAX): string | null {
  const data = gymData(read, date);
  // No session to open (before the plan starts): no link, rather than one the page can't read.
  if (!data || !data.sessions.length) return null;
  const link = gymLink(data);
  if (link.length <= max) return link;
  const keep = new Set<string | null>([data.next, ...logged]);
  const some = data.sessions.filter((s) => keep.has(s.type));
  if (!some.length) return null;
  const short = gymLink({ ...data, sessions: some });
  if (short.length <= max || !logged.length) return short;
  // Still over with today's logged sessions: the next one alone, however long.
  const next = data.sessions.filter((s) => s.type === data.next);
  return next.length ? gymLink({ ...data, sessions: next }) : short;
}
