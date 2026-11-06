// Sitting time, counted from keyboard and mouse activity. `sittingStep` is
// Habit Nudges' deskStep (the desk-time count), ported step for step (a
// golden test runs both): a stretch runs from your first input to your last;
// a call holds it; more than `awayMinutes` without input (or the Mac asleep)
// ends it at the last input; a stretch crossing local midnight is split
// there. Where deskStep stopped for a timer run by hand, this stops while a
// stand-up is under way: standing at the desk is not sitting.
//
// Each Mac writes its own stretches into Coach/sitting.json by local day; a
// day's total is the union of every Mac's stretches.

import type { DayClock } from './clock.ts';
import { addDays, type IsoDate } from './dates.ts';
import { explain, type Result } from './reason.ts';
import type { SittingConfig, SittingLog, SittingStretch } from './schema.ts';

/** A stretch being counted, in epoch ms. */
export interface Stretch {
  start: number;
  end: number;
}

export interface SittingInput {
  now: number;
  /** Seconds since the last keyboard or mouse input. */
  idleS: number;
  /** A call is on (microphone or camera): it counts as sitting. */
  call: boolean;
  /** A stand-up is under way (or counting is off): not sitting. */
  standing: boolean;
}

/** Stretches shorter than this are not kept (Habit Nudges' DESK_MIN_MS). */
export const SITTING_MIN_MS = 60_000;

/**
 * One step. `st` is the stretch being counted (or null). Returns the stretch
 * to carry on with (or null), one to close (or null), and whether a new one
 * opened.
 */
export function sittingStep(st: Stretch | null, inp: SittingInput, cfg: Pick<SittingConfig, 'awayMinutes'>, clock: Pick<DayClock, 'dayStart'>): { st: Stretch | null; close: Stretch | null; opened: boolean } {
  const limit = cfg.awayMinutes * 60 * 1000;
  const last = inp.call ? inp.now : inp.now - inp.idleS * 1000; // the last sign of you
  const here = !inp.standing && (inp.call || inp.idleS * 1000 < limit);
  if (!here) return { st: null, close: st, opened: false };
  if (!st) return { st: { start: last, end: last }, close: null, opened: true };
  // Back after a break the steps didn't see (asleep, the app closed). A call
  // isn't one: you've been there since the last input.
  if (!inp.call && last - st.end > limit) return { st: { start: last, end: last }, close: st, opened: true };
  const midnight = clock.dayStart(last);
  if (st.start < midnight) return { st: { start: midnight, end: last }, close: { start: st.start, end: midnight - 1 }, opened: true };
  return { st: { start: st.start, end: Math.max(st.end, last) }, close: null, opened: false };
}

/** A stretch as the file holds it, and back. */
export const stretchToFile = (s: Stretch): SittingStretch => ({ start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString() });
export const stretchFromFile = (s: SittingStretch): Stretch | null => {
  const a = Date.parse(s.start);
  const b = Date.parse(s.end);
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? { start: a, end: b } : null;
};

/** Overlapping stretches joined (two Macs used at once count once). */
export function unionStretches(list: readonly Stretch[]): Stretch[] {
  const sorted = [...list].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Stretch[] = [];
  for (const s of sorted) {
    const prev = out.at(-1);
    if (prev && s.start <= prev.end) prev.end = Math.max(prev.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

export interface SittingDay {
  date: IsoDate;
  /** Minutes sitting, every Mac together. */
  minutes: number;
  /** The longest stretch, in minutes. */
  longest: number;
  stretches: number;
  /** Where the day's numbers come from: Pahlavan's count, or Habit Nudges' desk time (before Pahlavan counted). */
  source: 'pahlavan' | 'desk-time' | 'none';
}

const mins = (ms: number) => Math.round(ms / 60000);

/** One day's stretches from Coach/sitting.json (every Mac), with the stretch running now on this Mac (`live`) in full. */
export function stretchesOn(log: SittingLog | null, date: IsoDate, live?: { mac: string; stretch: Stretch | null }): Stretch[] {
  const macs = log?.days[date] ?? {};
  const out: Stretch[] = [];
  for (const [mac, list] of Object.entries(macs)) {
    for (const s of list) {
      const x = stretchFromFile(s);
      if (!x) continue;
      // The running stretch replaces the copy last written for it (same start).
      if (live?.stretch && mac === live.mac && x.start === live.stretch.start) continue;
      out.push(x);
    }
  }
  if (live?.stretch && live.stretch.end - live.stretch.start >= SITTING_MIN_MS) out.push(live.stretch);
  return out;
}

/** A day's sitting from its stretches. */
export function summarizeDay(date: IsoDate, list: readonly Stretch[], source: SittingDay['source']): SittingDay {
  const u = unionStretches(list);
  return {
    date,
    minutes: mins(u.reduce((t, s) => t + (s.end - s.start), 0)),
    longest: mins(u.reduce((m, s) => Math.max(m, s.end - s.start), 0)),
    stretches: u.length,
    source: u.length ? source : 'none',
  };
}

/**
 * The work timer's desk-time stretches (Habit Nudges' `auto` sessions in
 * work-timer-data.json) by local day: the history before Pahlavan counted.
 * Read only; Pahlavan never writes the work timer.
 */
export function deskTimeHistory(timer: unknown, clock: Pick<DayClock, 'dayOf'>): Map<IsoDate, Stretch[]> {
  const out = new Map<IsoDate, Stretch[]>();
  const sessions = typeof timer === 'object' && timer !== null && Array.isArray((timer as { sessions?: unknown }).sessions) ? ((timer as { sessions: unknown[] }).sessions) : [];
  for (const s of sessions) {
    if (typeof s !== 'object' || s === null) continue;
    const o = s as Record<string, unknown>;
    if (o['auto'] !== true || typeof o['start'] !== 'string' || typeof o['end'] !== 'string') continue;
    const x = stretchFromFile({ start: o['start'], end: o['end'] });
    if (!x || x.end - x.start < SITTING_MIN_MS) continue;
    const d = clock.dayOf(x.start);
    const list = out.get(d) ?? [];
    list.push(x);
    out.set(d, list);
  }
  return out;
}

/**
 * Sitting per day from `from` to `to`: Pahlavan's own count where it has the
 * day, else the work timer's desk time (Habit Nudges counted standing at the
 * keyboard too, so that history runs a little high).
 */
export function sittingDays(log: SittingLog | null, history: ReadonlyMap<IsoDate, Stretch[]> | null, from: IsoDate, to: IsoDate, live?: { date: IsoDate; mac: string; stretch: Stretch | null }): SittingDay[] {
  const out: SittingDay[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const own = stretchesOn(log, d, live && live.date === d ? live : undefined);
    if (own.length || log?.days[d]) out.push(summarizeDay(d, own, 'pahlavan'));
    else out.push(summarizeDay(d, history?.get(d) ?? [], 'desk-time'));
  }
  return out;
}

/** A day against the item's limits: over the daily limit, a stretch over the stretch limit. */
export function sittingVerdict(day: SittingDay, c: SittingConfig): Result<{ overLimit: boolean; overStretch: boolean; over: 0 | 1 | 2 }> {
  const overLimit = day.minutes > c.limitMinutes;
  const overStretch = day.longest > c.stretchMaxMinutes;
  const over = ((overLimit ? 1 : 0) + (overStretch ? 1 : 0)) as 0 | 1 | 2;
  return explain({ overLimit, overStretch, over }, 'habits.sitting', { date: day.date, minutes: day.minutes, longest: day.longest, source: day.source }, {
    threshold: { limitMinutes: c.limitMinutes, stretchMaxMinutes: c.stretchMaxMinutes },
    note: over === 0 ? 'Within both limits.' : [overLimit ? `Over the ${hm(c.limitMinutes)} limit` : '', overStretch ? `a stretch over ${c.stretchMaxMinutes} min` : ''].filter(Boolean).join('; ') + '.',
  });
}

/** "5 h 30" from minutes. */
export const hm = (m: number): string => `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`;
