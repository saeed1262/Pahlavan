// Body-weight trend and rate, as in numbers.md ("Body-weight trend and rate").
// EWMA at alpha 0.1 a day (a gap of g days uses 1 - 0.9^g), seeded with the
// mean of the first 7 days; the rate is the least-squares slope of the trend
// over the last 28 days, once that span covers 14+ days with 8+ weigh-ins.

import { dayText, daysBetween } from './dates.ts';
import { explain, type Result } from './reason.ts';
import type { GoalKind, IsoDate, RateBand, WeighIn } from './schema.ts';
import { toKg } from './units.ts';

export const WEIGHT = {
  alpha: 0.1,
  /** 1 - alpha, the per-day decay, written as the snippet writes it. */
  decay: 0.9,
  seedDays: 7,
  rateDays: 28,
  rateMinDays: 14,
  rateMinWeighIns: 8,
} as const;

/** rules.md, "Body weight and food": signed fractions of body weight a week. */
export const RATE_BANDS: Readonly<Record<'fat-loss' | 'recomposition' | 'gain' | 'maintenance', RateBand>> = {
  'fat-loss': { unit: 'pct', lo: -0.01, hi: -0.005 },
  recomposition: { unit: 'pct', lo: -0.005, hi: 0 },
  gain: { unit: 'pct', lo: 0.0025, hi: 0.005 },
  maintenance: { unit: 'pct', lo: -0.0025, hi: 0.0025 },
};

export interface TrendPoint {
  date: IsoDate;
  /** kg. */
  weight: number;
  trend: number;
}

export interface WeightTrend {
  since: IsoDate | null;
  through: IsoDate;
  seed: number | null;
  points: TrendPoint[];
  latest: TrendPoint | null;
}

/**
 * The trend over weigh-ins dated from `since` (the cycle start; all when
 * omitted) through `through` (today). Weights in lb are converted to kg; a
 * later weigh-in on the same date wins.
 */
export function weightTrend(weighIns: readonly WeighIn[], opts: { through: IsoDate; since?: IsoDate }): Result<WeightTrend> {
  const since = opts.since ?? null;
  const byDate = new Map<IsoDate, number>();
  for (const w of weighIns) {
    if ((since === null || w.date >= since) && w.date <= opts.through) byDate.set(w.date, toKg(w.weight, w.unit));
  }
  const pts = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (pts.length === 0) {
    return explain<WeightTrend>({ since, through: opts.through, seed: null, points: [], latest: null }, 'weight.trend', { since, through: opts.through, weighIns: 0 }, {
      threshold: { alpha: WEIGHT.alpha, seedDays: WEIGHT.seedDays },
      note: `No weigh-ins${since ? ` since ${since}` : ''}.`,
    });
  }
  const first = pts[0]![0];
  const seedValues = pts.filter(([d]) => daysBetween(first, d) < WEIGHT.seedDays).map(([, w]) => w);
  const seed = seedValues.reduce((a, v) => a + v, 0) / seedValues.length;
  let t = seed;
  const points: TrendPoint[] = [];
  pts.forEach(([d, w], i) => {
    if (i > 0) t += (1 - WEIGHT.decay ** daysBetween(pts[i - 1]![0], d)) * (w - t);
    points.push({ date: d, weight: w, trend: t });
  });
  const latest = points.at(-1)!;
  return explain<WeightTrend>({ since, through: opts.through, seed, points, latest }, 'weight.trend', {
    since,
    through: opts.through,
    weighIns: points.length,
    seedWeighIns: seedValues.length,
  }, {
    threshold: { alpha: WEIGHT.alpha, seedDays: WEIGHT.seedDays },
    note: `Trend ${latest.trend.toFixed(2)} kg on ${dayText(latest.date)} from ${points.length} weigh-in(s); last weigh-in ${latest.weight.toFixed(1)} kg.`,
  });
}

export interface WeightRate {
  kgPerWeek: number;
  /** Fraction of the latest trend weight a week (-0.006 is -0.6 %). */
  pctPerWeek: number;
  spanDays: number;
  weighIns: number;
  trend: number;
}

/** The least-squares slope of the trend over the last 28 days; null until 14+ days and 8+ weigh-ins. */
export function weightRate(trend: WeightTrend): Result<WeightRate | null> {
  const threshold = { days: WEIGHT.rateDays, minDays: WEIGHT.rateMinDays, minWeighIns: WEIGHT.rateMinWeighIns };
  const latest = trend.latest;
  if (!latest) return explain(null, 'weight.rate', { weighIns: 0 }, { threshold, note: 'No weigh-ins.' });
  const recent = trend.points.filter((p) => daysBetween(p.date, latest.date) <= WEIGHT.rateDays);
  const span = daysBetween(recent[0]!.date, latest.date);
  const inputs = { from: recent[0]!.date, to: latest.date, spanDays: span, weighIns: recent.length };
  if (span < WEIGHT.rateMinDays || recent.length < WEIGHT.rateMinWeighIns) {
    return explain(null, 'weight.rate', inputs, {
      threshold,
      note: `Rate not yet: needs 14+ days and 8+ weigh-ins in the last 28 days; have ${span} days and ${recent.length}.`,
    });
  }
  const xs = recent.map((p) => daysBetween(recent[0]!.date, p.date));
  const ys = recent.map((p) => p.trend);
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < xs.length; i++) {
    sx += xs[i]!;
    sy += ys[i]!;
  }
  const mx = sx / xs.length;
  const my = sy / ys.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  const kgPerWeek = (sxy / sxx) * 7;
  const pctPerWeek = kgPerWeek / latest.trend;
  return explain<WeightRate>({ kgPerWeek, pctPerWeek, spanDays: span, weighIns: recent.length, trend: latest.trend }, 'weight.rate', inputs, {
    threshold,
    note: `${kgPerWeek >= 0 ? '+' : ''}${kgPerWeek.toFixed(2)} kg a week = ${pctPerWeek >= 0 ? '+' : ''}${(pctPerWeek * 100).toFixed(2)} % of body weight (slope over ${span} days, ${recent.length} weigh-ins).`,
  });
}

export type RateStatus = 'below' | 'in' | 'above';

/**
 * The rate against a band: the goal kind's default (RATE_BANDS) or an explicit
 * band. "below" means more negative than the band's low end.
 */
export function rateStatus(rate: WeightRate, band: RateBand | GoalKind): Result<{ band: RateBand; value: number; status: RateStatus }> {
  const b = typeof band === 'string' ? (RATE_BANDS as Record<string, RateBand | undefined>)[band] : band;
  if (!b) throw new RangeError(`no default rate band for goal kind "${String(band)}"`);
  const value = b.unit === 'pct' ? rate.pctPerWeek : rate.kgPerWeek;
  const status: RateStatus = value < b.lo ? 'below' : value > b.hi ? 'above' : 'in';
  const fmt = (v: number) => (b.unit === 'pct' ? `${(v * 100).toFixed(2)} %` : `${v.toFixed(2)} kg`);
  return explain({ band: b, value, status }, 'weight.band', { goal: typeof band === 'string' ? band : null, value, unit: b.unit }, {
    threshold: b,
    note: `${fmt(value)} a week against ${fmt(b.lo)} to ${fmt(b.hi)}: ${status === 'in' ? 'in the band' : status === 'below' ? 'below the band (falling faster than it)' : 'above the band (falling slower or rising faster than it)'}. Act only after two weekly readings out of band.`,
  });
}
