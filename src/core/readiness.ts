// Readiness, exactly the numbers.md recipe (checkin.md, "Readiness score").
// Each signal is scored against its own previous 28 days; the daily score R is
// the mean of the clipped z-scores; S is a 3-day EWMA of R. Act on S, never on
// one day's R. The mornings read are the current cycle's (`since`, the cycle
// start): a fresh start builds its baseline again from 14 morning check-ins,
// then scores each day against the cycle's own previous 28 days, so the body
// before the reset is never "your usual". A day's score needs at least one of
// the card's own answers (energy, soreness, sleep quality): watch numbers
// alone (sleep hours, resting HR, HRV) never score a morning.

import { addDays, dayText, daysBetween } from './dates.ts';
import { explain, joinNotes, type Result, type RuleFrom } from './reason.ts';
import type { Adjustment } from './rules.ts';
import { MORNING_QUESTIONS } from './morning.ts';
import type { DailyCheckin, IsoDate } from './schema.ts';
import { clip, mean, stdev } from './stats.ts';

export type ReadinessSignal = 'sleepH' | 'sleepQ' | 'energy' | 'rhr' | 'soreness' | 'hrv';

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
  /** HRV's sd floor, on the ln scale it is scored on (about 10 %). */
  hrvFloorLn: 0.1,
  /** The HRV note: this much under the usual (the 28-day geometric mean), this morning and the one before. */
  hrvFlagPct: 20,
} as const;

/**
 * Sign makes higher better; the floor stops a tiny sd from inflating z. HRV
 * is scored on its natural log (`log`), as HRV is usually analysed: its
 * spread grows with its size, so its floor is on the ln scale too.
 */
export const SIGNALS: Readonly<Record<ReadinessSignal, { sign: 1 | -1; floor: number; log?: true }>> = {
  sleepH: { sign: 1, floor: 0.5 },
  sleepQ: { sign: 1, floor: 0.5 },
  energy: { sign: 1, floor: 0.5 },
  rhr: { sign: -1, floor: 2.0 },
  soreness: { sign: -1, floor: 0.5 },
  hrv: { sign: 1, floor: READINESS.hrvFloorLn, log: true },
};

/** A signal's value as it is scored: HRV on its natural log, the rest as they are. */
const scaled = (k: ReadinessSignal, v: number): number => (SIGNALS[k].log ? Math.log(v) : v);
/** The HRV note's line on the ln scale: ln(1 - 20 %) under the ln-mean, so 20 % under the geometric mean. */
const HRV_FLAG_LN = Math.log(1 - READINESS.hrvFlagPct / 100);

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
  /** HRV 20 % or more under its 28-day geometric mean on this day and the day before (14+ HRV mornings): a note on its own. */
  hrvFlag: boolean;
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

/** The old default's low-day change: one set fewer and RIR +1 (checkin.md's decision rule). */
const LEGACY_LOW: Adjustment = { sets: -1, rir: 1 };

/** A low day's change in words: "one set fewer per exercise and RIR +1". */
export function trimWords(a: Adjustment): string {
  const sets = a.sets === 0 ? '' : a.sets === -1 ? 'one set fewer per exercise' : `${-a.sets} sets fewer per exercise`;
  const rir = a.rir ? `RIR +${a.rir}` : '';
  return [sets, rir].filter(Boolean).join(' and ') || 'no change';
}

/**
 * How readiness works, in words, and what each band does to the session:
 * only low changes it, by the plan's rule (`low`; null: nothing changes),
 * else the old default's one set fewer per exercise and RIR +1, so a screen
 * can explain the score beside it.
 */
export function readinessKey(low: Adjustment | null = LEGACY_LOW): Result<{ how: string; bands: ReadinessBandKey[] }> {
  const b = READINESS.bands;
  const lowWords = low ? trimWords(low) : null;
  const bands: ReadinessBandKey[] = [
    { band: 'good', label: 'Good', from: b.good, to: null, effect: 'Train as planned' },
    { band: 'normal', label: 'Normal', from: b.normal, to: b.good, effect: 'Train as planned' },
    { band: 'watch', label: 'Watch', from: b.watch, to: b.normal, effect: 'Train as planned' },
    { band: 'low', label: 'Low', from: null, to: b.watch, effect: lowWords ? lowWords.charAt(0).toUpperCase() + lowWords.slice(1) : 'Train as planned (the plan’s rule)' },
  ];
  const how = 'Each row compares the morning with your own baseline from this cycle’s mornings, where 0 is your usual. The needle is their average, smoothed over 3 days.';
  return explain({ how, bands }, 'readiness.key', {}, {
    threshold: { bands: b, alpha: READINESS.alpha, baselineDays: READINESS.baselineDays },
    note: lowWords ? `Only a low score changes the session: ${lowWords}, until it is back to watch or better.` : 'No score changes the session: the plan’s rule leaves a low day as planned.',
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

/** Signal k's values on the days d-28 .. d-1 (the snippet's `base`), as they are scored (HRV's on the ln scale). */
function baseline(days: Map<IsoDate, DailyCheckin>, dates: readonly IsoDate[], d: IsoDate, k: ReadinessSignal): number[] {
  const out: number[] = [];
  for (const e of dates) {
    const v = days.get(e)?.[k];
    if (v === undefined || v === null) continue;
    const gap = daysBetween(e, d);
    if (gap >= 1 && gap <= READINESS.baselineDays) out.push(scaled(k, v));
  }
  return out;
}

/** HRV on day x at or under the note's line (ln scale; a hair of slack so exactly 20 % counts). */
function hrvUnder(days: Map<IsoDate, DailyCheckin>, x: IsoDate, limitLn: number | null): boolean {
  const v = days.get(x)?.hrv;
  return limitLn !== null && typeof v === 'number' && v > 0 && Math.log(v) <= limitLn + 1e-9;
}

/** The HRV note's line for day d on the ln scale: the ln-mean of its 28-day baseline + ln(0.8); null under 14 HRV mornings. */
function hrvLimitLn(days: Map<IsoDate, DailyCheckin>, dates: readonly IsoDate[], d: IsoDate): { limit: number | null; base: number[] } {
  const base = baseline(days, dates, d, 'hrv');
  return { limit: base.length >= READINESS.minBaseline ? mean(base) + HRV_FLAG_LN : null, base };
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
        z[k] = clip((sign * (scaled(k, x) - mean(b))) / Math.max(stdev(b), floor), -READINESS.clip, READINESS.clip);
      }
    }
    const zs = Object.values(z);
    // The card-answer guard: 3 scored signals, at least one of them the card's own (energy, soreness, sleep quality).
    const r = zs.length >= READINESS.minSignals && hasCardAnswer(z) ? zs.reduce((a, v) => a + v, 0) / zs.length : null;
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
      hrvFlag: hrvDays(days, dates, d),
      shortSleep: typeof entry.sleepH === 'number' && entry.sleepH < READINESS.shortSleepH,
      illness: entry.illness === true,
    });
  }
  return rows;
}

/** A scored answer to one of the card's own questions (energy, soreness, sleep quality). */
const hasCardAnswer = (z: Partial<Record<ReadinessSignal, number>>): boolean => MORNING_QUESTIONS.some((k) => z[k] !== undefined);

/** The HRV note on day d: HRV at or under the line on d and on the day before, both against d's baseline (as the RHR flag). */
function hrvDays(days: Map<IsoDate, DailyCheckin>, dates: readonly IsoDate[], d: IsoDate): boolean {
  const { limit } = hrvLimitLn(days, dates, d);
  return hrvUnder(days, d, limit) && hrvUnder(days, addDays(d, -1), limit);
}

const THRESHOLDS = {
  baselineDays: READINESS.baselineDays,
  minBaseline: READINESS.minBaseline,
  clip: READINESS.clip,
  minSignals: READINESS.minSignals,
  alpha: READINESS.alpha,
  bands: READINESS.bands,
  signals: SIGNALS,
  cardAnswers: MORNING_QUESTIONS,
};

export interface ReadinessInput {
  signal: ReadinessSignal;
  /** Today's value; null when the check-in did not give it. */
  value: number | null;
  /**
   * The previous 28 days' mean and sample SD (the floor applied), as the
   * score uses them. HRV is scored on its natural log: its mean is the
   * geometric mean in ms, and its SD is on the ln scale.
   */
  mean: number | null;
  sd: number | null;
  /** Your usual range in the signal's own unit: the mean ± SD (for HRV, the geometric mean times or divided by e^SD). */
  range: [number, number] | null;
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
 * Empty when there is no morning check-in that day. HRV is left out when
 * neither that morning nor its 28 days hold one: most people never send it.
 */
export function readinessInputs(daily: readonly DailyCheckin[], date: IsoDate, scope: ReadinessScope = {}): ReadinessInput[] {
  const days = byDate(inScope(daily, scope));
  const entry = days.get(date);
  if (!entry) return [];
  const dates = [...days.keys()].filter((d) => d <= date).sort();
  const shown = (Object.keys(SIGNALS) as ReadinessSignal[]).filter((k) => k !== 'hrv' || typeof entry.hrv === 'number' || baseline(days, dates, date, k).length > 0);
  return shown.map((k) => {
    const { sign, floor, log } = SIGNALS[k];
    const b = baseline(days, dates, date, k);
    const x = entry[k];
    const value = typeof x === 'number' ? x : null;
    const scored = value !== null && b.length >= READINESS.minBaseline;
    const m = b.length ? mean(b) : null;
    const sd = b.length >= 2 ? Math.max(stdev(b), floor) : b.length ? floor : null;
    const z = scored ? clip((sign * (scaled(k, value) - m!)) / sd!, -READINESS.clip, READINESS.clip) : null;
    const back = (v: number) => (log ? Math.exp(v) : v);
    const range: [number, number] | null = m !== null && sd !== null ? [back(m - sd), back(m + sd)] : null;
    return { signal: k, value, mean: m === null ? null : back(m), sd, range, days: b.length, z, better: sign > 0 ? 'higher' : 'lower' };
  });
}

/** The scored row for one date (unscored when there is no check-in that day), from `scope.since` on. */
export function readinessOn(daily: readonly DailyCheckin[], date: IsoDate, scope: ReadinessScope = {}): Result<ReadinessDay> {
  const row = readinessSeries(daily, date, scope).at(-1);
  const base = readinessBaseline(daily, date, scope).value;
  const since = scope.since ?? null;
  if (!row || row.date !== date) {
    const empty: ReadinessDay = { date, r: null, s: null, band: 'unscored', z: {}, signals: 0, rhrFlag: false, hrvFlag: false, shortSleep: false, illness: false };
    return explain(empty, 'readiness.score', { date, checkin: false, since }, { threshold: THRESHOLDS, note: joinNotes('No check-in that day.', base.building && buildingNote(base)) });
  }
  const unscored = base.building
    ? buildingNote(base)
    : row.signals >= READINESS.minSignals
      ? `Not scored: watch numbers alone never score a morning; it needs energy, soreness or sleep quality too, each with 14 entries in the previous 28 days${since ? ' of this cycle' : ''}.`
      : `Not scored: ${row.signals} signal(s) had 14 entries in the previous 28 days${since ? ' of this cycle' : ''}; a day needs 3.`;
  return explain(row, 'readiness.score', { date, z: row.z, signals: row.signals, since }, {
    threshold: THRESHOLDS,
    note: joinNotes(
      row.r === null ? unscored : `R ${row.r.toFixed(2)}, S ${row.s!.toFixed(2)}: ${row.band}.`,
      row.hrvFlag && `HRV ${READINESS.hrvFlagPct}% or more under your usual two mornings running: a note on its own.`,
    ),
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

export interface ReadinessHrv {
  /** The latest check-in on or before the date, the one the actions read (null: none). */
  asOf: IsoDate | null;
  /** HRV that morning and the morning before it, ms (null: none given). */
  value: number | null;
  dayBefore: number | null;
  /** The previous 28 days' geometric mean, ms (null under 14 HRV mornings). */
  usual: number | null;
  /** The note's line, ms: 20 % under the usual. */
  limit: number | null;
  /** HRV mornings in those 28 days; `needed` (14) before the note can come. */
  days: number;
  needed: number;
  building: boolean;
  /** 20 % or more under the usual that morning and the one before: a note, not a change to the session. */
  flag: boolean;
}

/**
 * The HRV note for the latest check-in on or before `date` (the one the
 * actions read): HRV 20 % or more under its own 28-day geometric mean that
 * morning and the one before. A note on its own, for Today and the review;
 * `no-hard-training` takes it only with the resting-HR flag or a low score.
 * No HRV that morning: no note. Under 14 HRV mornings: "building".
 */
export function readinessHrv(daily: readonly DailyCheckin[], date: IsoDate, scope: ReadinessScope = {}): Result<ReadinessHrv> {
  const days = byDate(inScope(daily, scope));
  const dates = [...days.keys()].filter((d) => d <= date).sort();
  const asOf = dates.at(-1) ?? null;
  const since = scope.since ?? null;
  const needed = READINESS.minBaseline;
  const pct = READINESS.hrvFlagPct;
  const threshold = { underBaselinePct: pct, days: 2, minBaseline: needed, baselineDays: READINESS.baselineDays };
  if (asOf === null) {
    const v: ReadinessHrv = { asOf, value: null, dayBefore: null, usual: null, limit: null, days: 0, needed, building: true, flag: false };
    return explain(v, 'readiness.hrv-flag', { asOf, since }, { threshold, note: since ? 'No check-ins this cycle yet.' : 'No check-ins on or before today.' });
  }
  const { limit, base } = hrvLimitLn(days, dates, asOf);
  const at = (x: IsoDate) => {
    const v = days.get(x)?.hrv;
    return typeof v === 'number' ? v : null;
  };
  const value = at(asOf);
  const dayBefore = at(addDays(asOf, -1));
  const usual = limit === null ? null : Math.exp(mean(base));
  const flag = hrvDays(days, dates, asOf);
  const v: ReadinessHrv = { asOf, value, dayBefore, usual, limit: usual === null ? null : usual * (1 - pct / 100), days: base.length, needed, building: base.length < needed, flag };
  const ms = (x: number) => `${Math.round(x)} ms`;
  const row = readinessSeries(daily, asOf, scope).at(-1);
  const hard = row?.rhrFlag ? 'with the resting-HR flag as well: no hard training' : row?.band === 'low' ? 'with a low score as well: no hard training' : null;
  const stale = asOf !== date ? `From the check-in on ${dayText(asOf)}: ` : '';
  const note =
    value === null
      ? `No HRV on the latest check-in (${dayText(asOf)}).`
      : v.building
        ? `${stale}HRV baseline building: ${base.length} of ${needed} mornings with HRV in the previous ${READINESS.baselineDays} days${since ? ' of this cycle' : ''}; no HRV note until then.`
        : flag
          ? `${stale}HRV ${ms(dayBefore!)} and ${ms(value)}, ${pct}% or more under your usual ${ms(usual!)} two mornings running${hard ? `, ${hard}.` : ": a note only. On its own it doesn't stop hard training; with the resting-HR flag or a low score it would."}`
          : `${stale}HRV ${ms(value)} against your usual ${ms(usual!)}; the note comes at ${ms(v.limit!)} or less two mornings running.`;
  return explain(v, 'readiness.hrv-flag', { asOf, value, dayBefore, days: base.length, since }, { threshold, note });
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
 * - no-hard-training: the resting-HR flag, illness, or the HRV note together
 *   with the resting-HR flag or a low score (the HRV note alone changes nothing);
 * - no-tests: under 6 h of sleep, only when the check-in is today's.
 */
export function readinessActions(
  daily: readonly DailyCheckin[],
  today: IsoDate,
  opts: {
    e1rmFalling?: boolean;
    since?: IsoDate | null;
    /** The plan's low-day change (null: none, so trim is never active); the old default without it. */
    low?: Adjustment | null;
    /** The readiness rule, cited by the trim. */
    from?: RuleFrom;
  } = {},
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

  const low = opts.low === undefined ? LEGACY_LOW : opts.low;
  const isLow = row?.band === 'low';
  const trim = isLow && low !== null;
  const earlyDeload = lowRun >= READINESS.lowRunDays && opts.e1rmFalling === true;
  // The HRV note stops hard training only with the resting-HR flag (which stops it anyway) or a low score.
  const hrvHard = row ? row.hrvFlag && (row.rhrFlag || row.band === 'low') : false;
  const noHard = row ? row.rhrFlag || row.illness || hrvHard : false;
  const noTests = row ? row.date === today && row.shortSleep : false;

  return [
    explain<ReadinessAction>({ action: 'trim', active: trim }, 'readiness.trim', { asOf, s: row?.s ?? null, band: row?.band ?? 'unscored' }, {
      threshold: { low: `S <= ${READINESS.bands.watch}` },
      note: joinNotes(
        trim && `Readiness is low: ${trimWords(low!)} until it is back to watch or better.`,
        isLow && !low && 'Readiness is low; the plan\'s rule leaves the session as planned.',
        base.building ? buildingNote(base) : row?.band === 'unscored' && 'The latest check-in is not scored.',
        stale,
        none,
      ),
      ...(opts.from ? { from: opts.from } : {}),
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
    explain<ReadinessAction>({ action: 'no-hard-training', active: noHard }, 'readiness.rhr-flag', { asOf, rhrFlag: row?.rhrFlag ?? false, illness: row?.illness ?? false, hrvFlag: row?.hrvFlag ?? false, band: row?.band ?? 'unscored' }, {
      threshold: { rhrOverBaselineBpm: READINESS.rhrFlagBpm, days: 2, hrvUnderBaselinePct: READINESS.hrvFlagPct, hrvWith: ['rhr-flag', 'low'] },
      note: joinNotes(
        row?.rhrFlag && 'Resting HR 7+ bpm over its 28-day baseline two days running: no hard training (easy Zone 2 or mobility at most).',
        row?.rhrFlag && row.hrvFlag && `HRV ${READINESS.hrvFlagPct}% or more under its baseline two mornings running too.`,
        row && !row.rhrFlag && hrvHard && `HRV ${READINESS.hrvFlagPct}% or more under its 28-day baseline two mornings running, with a low score: no hard training (easy Zone 2 or mobility at most).`,
        row?.hrvFlag && !hrvHard && `HRV ${READINESS.hrvFlagPct}% or more under its 28-day baseline two mornings running: a note only. On its own it doesn't stop hard training; with the resting-HR flag or a low score it would.`,
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
