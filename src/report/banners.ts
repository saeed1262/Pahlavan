// The numbers behind the banners on Progress, Plan and Check-in that their
// reports do not already hold: the average strength change across the logged
// lifts, this mesocycle's weeks, the week's check-ins and the next tape day.
// Each reads a report (or the files as read) and the date. Pure: no clock.

import type { VaultRead } from '../adapters/vault/read.ts';
import type { TrackingRead } from '../adapters/vault/tracking-read.ts';
import { scopeInfo } from './cycle.ts';
import { bodyParts } from '../core/nudges.ts';
import type { SundayStatus } from '../core/coach-steps.ts';
import { addDays, daysBetween, mondayOf } from '../core/dates.ts';
import { E1RM } from '../core/e1rm.ts';
import { isMorningDone } from '../core/morning.ts';
import type { IsoDate } from '../core/schema.ts';
import type { liftTrends } from './progress.ts';

type LiftTrend = ReturnType<typeof liftTrends>[number];

// ---------------------------------------------------------------- strength

export interface LiftChange {
  name: string;
  unit: string;
  /** The smoothed e1RM (best of the last 3) at the first and the latest qualifying session. */
  first: number | null;
  last: number | null;
  /** last / first - 1; null with fewer than two qualifying sessions (a unit flag can leave only one). */
  change: number | null;
  /** Up by more than the stall line (2 %), the engine's "still progressing"; down, by more than it the other way. */
  up: boolean;
  down: boolean;
  sessions: number;
  unitFlag: boolean;
}

/**
 * Each logged lift's e1RM change since its first qualifying session, and the
 * average over the lifts that have one. A lift with fewer than two
 * qualifying sessions has no change and stays out of the average (it is not
 * counted as flat).
 */
export function strengthChange(lifts: readonly LiftTrend[]): { lifts: LiftChange[]; mean: number | null; counted: number } {
  const out = lifts.map((l): LiftChange => {
    const pts = l.sets.filter((s) => s.used && s.best !== null);
    const first = pts[0]?.best ?? null;
    const last = pts.at(-1)?.best ?? null;
    const change = pts.length > 1 && first ? last! / first - 1 : null;
    return { name: l.name, unit: l.unit, first, last, change, up: change !== null && change > E1RM.stallGain, down: change !== null && change < -E1RM.stallGain, sessions: pts.length, unitFlag: Boolean(l.unitFlag) };
  });
  const known = out.filter((x) => x.change !== null);
  const mean = known.length ? known.reduce((a, x) => a + x.change!, 0) / known.length : null;
  return { lifts: out, mean, counted: known.length };
}

/** Monday-to-Sunday weeks from the first entry's week to the date's, both counted. */
export function weeksLogged(firstEntry: IsoDate | null, date: IsoDate): number {
  if (!firstEntry || firstEntry > date) return 0;
  return daysBetween(mondayOf(firstEntry), mondayOf(date)) / 7 + 1;
}

// ---------------------------------------------------------------- plan

export type WeekState = 'past' | 'now' | 'future';

/** The weeks of the mesocycle holding `now`, each past, this week or to come. */
export function mesocycleWeeks<W extends { index: number; meso: number }>(weeks: readonly W[], now: { index: number; meso: number } | null): (W & { state: WeekState })[] {
  if (!now) return [];
  return weeks.filter((w) => w.meso === now.meso).map((w) => ({ ...w, state: w.index === now.index ? 'now' : w.index < now.index ? 'past' : 'future' }));
}

// ---------------------------------------------------------------- check-ins

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface CheckinDay {
  date: IsoDate;
  done: boolean;
  future: boolean;
  /** Before the cycle start (a cycle begun this week): not counted. */
  before?: boolean;
}

/**
 * This week's check-ins, Monday to Sunday: a morning counts when
 * body-data.json's day has its `checkedAt` (as Pahlavan and Habit Nudges
 * write it) or one of the morning's own answers; the Sunday one when
 * Coach/checkins.json holds the week's record. Mornings before the cycle
 * start (a cycle begun this week) are `before` and not counted.
 */
export function checkinWeek(read: VaultRead, date: IsoDate) {
  const from = mondayOf(date);
  const to = addDays(from, 6);
  const since = scopeInfo(read.data, date).since;
  const body = read.raw?.body;
  const days = isObj(body) && isObj(body['days']) ? (body['days']) : {};
  const mornings: CheckinDay[] = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(from, i);
    if (since && d < since) return { date: d, done: false, future: false, before: true };
    const day = isObj(days[d]) ? (days[d]) : {};
    const done = d <= date && isMorningDone(day);
    return { date: d, done, future: d > date };
  });
  const record = read.data.checkins.weekly.find((w) => w.date === to || w.weekStart === from || w.weekOf === from) ?? null;
  const sunday: CheckinDay & { savedOn: IsoDate | null } = { date: to, done: record !== null, future: to > date, savedOn: record?.date ?? null };
  const morningsDone = mornings.filter((x) => x.done).length;
  return {
    from,
    to,
    mornings,
    morningsDone,
    /** Mornings up to and including today (from the cycle start). */
    morningsSoFar: mornings.filter((x) => !x.future && !x.before).length,
    sunday,
    done: morningsDone + (sunday.done ? 1 : 0),
    total: mornings.filter((x) => !x.before).length + 1,
  };
}

export type CheckinWeek = ReturnType<typeof checkinWeek>;

/**
 * The Check-in banner's Tape pill: the engine's body-record schedule
 * (bodyParts: the plan's tape days, or every N days from a start date until
 * the reset, as Coach/tracking.json sets it), not the plan calendar's rule.
 * `due`: the occurrence is not done yet (its date may be in the past).
 * Null when the schedule has no date left.
 */
export function tapeDay(read: VaultRead, tr: Pick<TrackingRead, 'tracking' | 'nudges' | 'body' | 'photoFolders'> | null, date: IsoDate): { date: IsoDate; due: boolean; text: string; source: 'plan' | 'fixed' } | null {
  const parts = bodyParts({ tracking: tr?.tracking ?? null, nudges: tr?.nudges ?? null, body: tr ? tr.body : (read.raw?.body ?? null), photoFolders: tr?.photoFolders ?? [], program: read.data.program }, date);
  const t = parts.tape.value;
  return t.nextDate ? { date: t.nextDate, due: t.due, text: t.schedule.text, source: t.schedule.source } : null;
}

/** The Sunday check-in's state on the Check-in screen (buildCheckin's `sunday.status`), as the coach steps read it. */
export type { SundayStatus };

/**
 * The Check-in banner's action for the Sunday check-in: on a Sunday, start
 * it (or, once saved, a quiet "saved"); on other days, finish last Sunday's
 * while it is still unsaved, else the quiet "opens Sun". Primary actions
 * are the filled button; every one scrolls to the Sunday card.
 */
export function sundayAction(status: SundayStatus): { kind: 'start' | 'finish' | 'saved' | 'opens'; primary: boolean; label: string } {
  if (status === 'open') return { kind: 'start', primary: true, label: 'Start the Sunday check-in' };
  if (status === 'late') return { kind: 'finish', primary: true, label: 'Finish last Sunday’s check-in' };
  if (status === 'edit') return { kind: 'saved', primary: false, label: 'Sunday check-in saved' };
  return { kind: 'opens', primary: false, label: 'Sunday check-in opens Sun' };
}
