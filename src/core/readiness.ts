// Readiness, exactly the numbers.md recipe (checkin.md, "Readiness score").
// Each signal is scored against its own previous 28 days; the daily score R is
// the mean of the clipped z-scores; S is a 3-day EWMA of R. Act on S, never on
// one day's R. The mornings read are the current cycle's (`since`, the cycle
// start): a fresh start builds its baseline again from 14 morning check-ins,
// then scores each day against the cycle's own previous 28 days, so the body
// before the reset is never "your usual".

import { addDays, dayText, daysBetween } from './dates.ts';
import { explain, joinNotes, type Result } from './reason.ts';
import type { DailyCheckin, IsoDate } from './schema.ts';
import { clip, mean, stdev } from './stats.ts';

export type ReadinessSignal = 'sleepH' | 'sleepQ' | 'energy' | 'rhr' | 'soreness';

/** Sign makes higher better; the floor stops a tiny sd from inflating z. */
export const SIGNALS: Readonly<Record<ReadinessSignal, { sign: 1 | -1; floor: number }>> = {
  sleepH: { sign: 1, floor: 0.5 },
  sleepQ: { sign: 1, floor: 0.5 },
  energy: { sign: 1, floor: 0.5 },
  rhr: { sign: -1, floor: 2.0 },
  soreness: { sign: -1, floor: 0.5 },
};

export const READINESS = {
  baselineDays: 28,
  minBaseline: 14,
  clip: 2.5,
  minSignals: 3,
  alpha: 0.5,
  /** S restarts from R after a gap of more than this many days. */
  reseedAfterDays: 3,
  rhrFlagBpm: 7,
  shortSleepH: 6,
  lowRunDays: 5,
  bands: { good: 0.5, normal: -0.5, watch: -1.0 },
} as const;

export type ReadinessBand = 'good' | 'normal' | 'watch' | 'low' | 'unscored';

/** Which mornings readiness reads: those from `since` on (the cycle start); null or absent reads them all. */
export interface ReadinessScope {
  since?: IsoDate | null;
}

const inScope = (daily: readonly DailyCheckin[], scope: ReadinessScope): readonly DailyCheckin[] => {
  const since = scope.since ?? null;
  return since === null ? daily : daily.filter((d) => d.date >= since);
};

export interface ReadinessDay {
  date: IsoDate;
  /** Daily score; null when fewer than 3 signals were scored. */
  r: number | null;
  /** Smoothed score; null on an unscored day. */
  s: number | null;
  band: ReadinessBand;
  z: Partial<Record<ReadinessSignal, number>>;
  signals: number;
  /** RHR at least baseline + 7 on this day and the day before. */
  rhrFlag: boolean;
  /** Under 6 h of sleep: no tests or PRs. */
  shortSleep: boolean;
  illness: boolean;
}

export function readinessBand(s: number): Exclude<ReadinessBand, 'unscored'> {
  const b = READINESS.bands;
  return s >= b.good ? 'good' : s > b.normal ? 'normal' : s > b.watch ? 'watch' : 'low';
}

/** One band of the smoothed score: its edges (null: open-ended) and what it does to the session. */
export interface ReadinessBandKey {
  band: Exclude<ReadinessBand, 'unscored'>;
  label: string;
  from: number | null;
  to: number | null;
  effect: string;
}

/**
 * How readiness works, in words, and what each band does to the session (the
 * checkin.md decision rule: only low changes it, one set fewer per exercise
 * and RIR +1), so a screen can explain the score beside it.
 */
export function readinessKey(): Result<{ how: string; bands: ReadinessBandKey[] }> {
  const b = READINESS.bands;
  const bands: ReadinessBandKey[] = [
    { band: 'good', label: 'Good', from: b.good, to: null, effect: 'Train as planned' },
    { band: 'normal', label: 'Normal', from: b.normal, to: b.good, effect: 'Train as planned' },
    { band: 'watch', label: 'Watch', from: b.watch, to: b.normal, effect: 'Train as planned' },
    { band: 'low', label: 'Low', from: null, to: b.watch, effect: 'One set fewer per exercise and RIR +1' },
  ];
  const how = 'Each row compares the morning with your own baseline from this cycle’s mornings, where 0 is your usual. The needle is their average, smoothed over 3 days.';
  return explain({ how, bands }, 'readiness.key', {}, {
    threshold: { bands: b, alpha: READINESS.alpha, baselineDays: READINESS.baselineDays },
    note: 'Only a low score changes the session: one set fewer per exercise and RIR +1, until it is back to watch or better.',
  });
}

/**
 * A morning check-in: at least one readiness signal or the illness flag. A day
 * that holds only a training or protein tick, steps or floors is not one, so it
 * never becomes "the latest check-in" or breaks a run of low days.
 */
export function isMorningCheckin(d: DailyCheckin): boolean {
  return (Object.keys(SIGNALS) as ReadinessSignal[]).some((k) => typeof d[k] === 'number') || d.illness !== undefined;
}

/** One entry per date (morning check-ins only); a later entry for the same date wins. */
function byDate(daily: readonly DailyCheckin[]): Map<IsoDate, DailyCheckin> {
  const m = new Map<IsoDate, DailyCheckin>();
  for (const d of daily) if (isMorningCheckin(d)) m.set(d.date, d);
  return m;
}

/** Signal k's values on the days d-28 .. d-1 (the snippet's `base`). */
function baseline(days: Map<IsoDate, DailyCheckin>, dates: readonly IsoDate[], d: IsoDate, k: ReadinessSignal): number[] {
  const out: number[] = [];
  for (const e of dates) {
    const v = days.get(e)?.[k];
    if (v === undefined || v === null) continue;
    const gap = daysBetween(e, d);
    if (gap >= 1 && gap <= READINESS.baselineDays) out.push(v);
  }
  return out;
}

/** The scored series for every check-in dated on or before `through` (from `scope.since` on). */
export function readinessSeries(daily: readonly DailyCheckin[], through: IsoDate, scope: ReadinessScope = {}): ReadinessDay[] {
  const days = byDate(inScope(daily, scope));
  const dates = [...days.keys()].filter((d) => d <= through).sort();
  const rows: ReadinessDay[] = [];
  let s: number | null = null;
  let prev: IsoDate | null = null;

  for (const d of dates) {
    const entry = days.get(d)!;
    const z: Partial<Record<ReadinessSignal, number>> = {};
    for (const k of Object.keys(SIGNALS) as ReadinessSignal[]) {
      const { sign, floor } = SIGNALS[k];
      const x = entry[k];
      const b = baseline(days, dates, d, k);
      if (x !== undefined && x !== null && b.length >= READINESS.minBaseline) {
        z[k] = clip((sign * (x - mean(b))) / Math.max(stdev(b), floor), -READINESS.clip, READINESS.clip);
      }
    }
    const zs = Object.values(z);
    const r = zs.length >= READINESS.minSignals ? zs.reduce((a, v) => a + v, 0) / zs.length : null;
    if (r !== null) {
      s = s === null || prev === null || daysBetween(prev, d) > READINESS.reseedAfterDays ? r : READINESS.alpha * r + (1 - READINESS.alpha) * s;
      prev = d;
    }

    const rb = baseline(days, dates, d, 'rhr');
    const limit = rb.length >= READINESS.minBaseline ? mean(rb) + READINESS.rhrFlagBpm : null;
    const rhrAt = (x: IsoDate) => days.get(x)?.rhr;
    const over = (x: IsoDate) => {
      const v = rhrAt(x);
      return limit !== null && typeof v === 'number' && v >= limit;
    };
    rows.push({
      date: d,
      r,
      s: r === null ? null : s,
      band: r === null ? 'unscored' : readinessBand(s!),
      z,
      signals: zs.length,
      rhrFlag: over(d) && over(addDays(d, -1)),
      shortSleep: typeof entry.sleepH === 'number' && entry.sleepH < READINESS.shortSleepH,
      illness: entry.illness === true,
    });
  }
  return rows;
}

const THRESHOLDS = {
  baselineDays: READINESS.baselineDays,
  minBaseline: READINESS.minBaseline,
  clip: READINESS.clip,
  minSignals: READINESS.minSignals,
  alpha: READINESS.alpha,
  bands: READINESS.bands,
  signals: SIGNALS,
};

export interface ReadinessInput {
  signal: ReadinessSignal;
  /** Today's value; null when the check-in did not give it. */
  value: number | null;
  /** The previous 28 days' mean and sample SD (the floor applied), as the score uses them. */
  mean: number | null;
  sd: number | null;
  /** Entries in the baseline (14 or more are needed to score the signal). */
  days: number;
  /** The clipped z-score, signed so that higher is better; null when not scored. */
  z: number | null;
  better: 'higher' | 'lower';
}

/**
 * Each signal of the check-in on `date` against its personal baseline: the
 * same previous 28 days, mean, SD floor and clip that `readinessSeries`
 * scores with, so a screen can draw today's value against the usual range.
 * Empty when there is no morning check-in that day.
 */
export function readinessInputs(daily: readonly DailyCheckin[], date: IsoDate, scope: ReadinessScope = {}): ReadinessInput[] {
  const days = byDate(inScope(daily, scope));
  const entry = days.get(date);
  if (!entry) return [];
  const dates = [...days.keys()].filter((d) => d <= date).sort();
  return (Object.keys(SIGNALS) as ReadinessSignal[]).map((k) => {
    const { sign, floor } = SIGNALS[k];
    const b = baseline(days, dates, date, k);
    const x = entry[k];
    const value = typeof x === 'number' ? x : null;
    const scored = value !== null && b.length >= READINESS.minBaseline;
    const m = b.length ? mean(b) : null;
    const sd = b.length >= 2 ? Math.max(stdev(b), floor) : b.length ? floor : null;
    const z = scored ? clip((sign * (value - m!)) / sd!, -READINESS.clip, READINESS.clip) : null;
    return { signal: k, value, mean: m, sd, days: b.length, z, better: sign > 0 ? 'higher' : 'lower' };
  });
}

/** The scored row for one date (unscored when there is no check-in that day), from `scope.since` on. */
export function readinessOn(daily: readonly DailyCheckin[], date: IsoDate, scope: ReadinessScope = {}): Result<ReadinessDay> {
  const row = readinessSeries(daily, date, scope).at(-1);
  const base = readinessBaseline(daily, date, scope).value;
  const since = scope.since ?? null;
  if (!row || row.date !== date) {
    const empty: ReadinessDay = { date, r: null, s: null, band: 'unscored', z: {}, signals: 0, rhrFlag: false, shortSleep: false, illness: false };
    return explain(empty, 'readiness.score', { date, checkin: false, since }, { threshold: THRESHOLDS, note: joinNotes('No check-in that day.', base.building && buildingNote(base)) });
  }
  return explain(row, 'readiness.score', { date, z: row.z, signals: row.signals, since }, {
    threshold: THRESHOLDS,
    note:
      row.r === null
        ? base.building
          ? buildingNote(base)
          : `Not scored: ${row.signals} signal(s) had 14 entries in the previous 28 days${since ? ' of this cycle' : ''}; a day needs 3.`
        : `R ${row.r.toFixed(2)}, S ${row.s!.toFixed(2)}: ${row.band}.`,
  });
}

export interface ReadinessBaseline {
  /** The cycle's first day the mornings count from (null: all of them). */
  since: IsoDate | null;
  /** Morning check-ins from `since` through the date. */
  mornings: number;
  /** How many the baseline needs before a day can be scored (14). */
  needed: number;
  /** Still building: no day can be scored yet, so train as planned. */
  building: boolean;
}

/**
 * Where the cycle's readiness baseline stands on `date`: a day is scored
 * against the previous mornings, at least 14 of them, so until the cycle
 * holds 14 morning check-ins there is no score and the session is not
 * changed by it ("Building your baseline: n of 14"); the first score comes
 * with the check-in after the 14th.
 */
export function readinessBaseline(daily: readonly DailyCheckin[], date: IsoDate, scope: ReadinessScope = {}): Result<ReadinessBaseline> {
  const since = scope.since ?? null;
  const mornings = [...byDate(inScope(daily, scope)).keys()].filter((d) => d <= date).length;
  const needed = READINESS.minBaseline;
  const building = mornings <= needed;
  const value: ReadinessBaseline = { since, mornings, needed, building };
  return explain(value, 'readiness.baseline', { since, mornings, date }, {
    threshold: { minBaseline: needed, baselineDays: READINESS.baselineDays },
    note: building ? buildingNote(value) : `The baseline is this cycle's mornings${since ? ` (since ${dayText(since)})` : ''}: each day against its own previous ${READINESS.baselineDays} days.`,
  });
}

function buildingNote(b: ReadinessBaseline): string {
  const n = Math.min(b.mornings, b.needed);
  return `Building your baseline: ${n} of ${b.needed} morning check-ins ${b.since ? 'this cycle' : 'so far'}; train as planned${n >= b.needed ? '. Scored from your next check-in' : ' meanwhile'}.`;
}

export type ReadinessActionId = 'trim' | 'early-deload' | 'no-hard-training' | 'no-tests';

export interface ReadinessAction {
  action: ReadinessActionId;
  active: boolean;
}

/**
 * The actions for `today`, read from the latest check-in on or before it:
 * - trim: S is low (one set fewer per exercise and RIR +1);
 * - early-deload: low 5 days running and a falling e1RM (offer it; the user decides);
 * - no-hard-training: the resting-HR flag, or illness;
 * - no-tests: under 6 h of sleep, only when the check-in is today's.
 */
export function readinessActions(
  daily: readonly DailyCheckin[],
  today: IsoDate,
  opts: { e1rmFalling?: boolean; since?: IsoDate | null } = {},
): Result<ReadinessAction>[] {
  const scope: ReadinessScope = { since: opts.since ?? null };
  const rows = readinessSeries(daily, today, scope);
  const base = readinessBaseline(daily, today, scope).value;
  const row = rows.at(-1);
  const asOf = row?.date ?? null;
  const stale = row && row.date !== today ? `The latest check-in is from ${dayText(row.date)}, ${daysBetween(row.date, today)} day(s) before ${dayText(today)}.` : undefined;
  const none = row ? undefined : opts.since ? 'No check-ins this cycle yet.' : 'No check-ins on or before today.';

  let lowRun = 0;
  if (row) {
    const byDay = new Map(rows.map((x) => [x.date, x]));
    for (let d = row.date; byDay.get(d)?.band === 'low'; d = addDays(d, -1)) lowRun++;
  }

  const trim = row?.band === 'low';
  const earlyDeload = lowRun >= READINESS.lowRunDays && opts.e1rmFalling === true;
  const noHard = row ? row.rhrFlag || row.illness : false;
  const noTests = row ? row.date === today && row.shortSleep : false;

  return [
    explain<ReadinessAction>({ action: 'trim', active: trim }, 'readiness.trim', { asOf, s: row?.s ?? null, band: row?.band ?? 'unscored' }, {
      threshold: { low: `S <= ${READINESS.bands.watch}` },
      note: joinNotes(trim && 'Readiness is low: one set fewer per exercise and RIR +1 until it is back to watch or better.', base.building ? buildingNote(base) : row?.band === 'unscored' && 'The latest check-in is not scored.', stale, none),
    }),
    explain<ReadinessAction>({ action: 'early-deload', active: earlyDeload }, 'readiness.early-deload', { asOf, lowRun, e1rmFalling: opts.e1rmFalling ?? null }, {
      threshold: { lowRunDays: READINESS.lowRunDays, e1rmFalling: true },
      note: joinNotes(
        earlyDeload && `Low ${lowRun} days running with a falling e1RM: offer an early light week; the user decides.`,
        !earlyDeload && lowRun >= READINESS.lowRunDays && opts.e1rmFalling === undefined && `Low ${lowRun} days running; the e1RM trend decides whether to offer an early light week.`,
        stale,
        none,
      ),
    }),
    explain<ReadinessAction>({ action: 'no-hard-training', active: noHard }, 'readiness.rhr-flag', { asOf, rhrFlag: row?.rhrFlag ?? false, illness: row?.illness ?? false }, {
      threshold: { rhrOverBaselineBpm: READINESS.rhrFlagBpm, days: 2 },
      note: joinNotes(
        row?.rhrFlag && 'Resting HR 7+ bpm over its 28-day baseline two days running: no hard training (easy Zone 2 or mobility at most).',
        row?.illness && 'Illness reported: no hard training.',
        stale,
        none,
      ),
    }),
    explain<ReadinessAction>({ action: 'no-tests', active: noTests }, 'readiness.short-sleep', { asOf, sleepH: row ? (byDate(inScope(daily, scope)).get(row.date)?.sleepH ?? null) : null }, {
      threshold: { sleepUnderH: READINESS.shortSleepH },
      note: joinNotes(noTests && 'Slept under 6 h: no tests or PR attempts today.', row && row.date !== today && 'Sleep counts only from today\'s check-in.', none),
    }),
  ];
}
