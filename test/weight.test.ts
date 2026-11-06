import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays } from '../src/core/dates.ts';
import type { WeighIn } from '../src/core/schema.ts';
import { rateStatus, weightRate, weightTrend, type WeightRate } from '../src/core/weight.ts';
import { approx } from './helpers.ts';

const kg = (date: string, weight: number): WeighIn => ({ date, weight, unit: 'kg' });
const daily = (start: string, values: number[]) => values.map((w, i) => kg(addDays(start, i), w));

describe('weight trend', () => {
  it('handles no weigh-ins', () => {
    const t = weightTrend([], { through: '2026-03-29' });
    assert.equal(t.value.latest, null);
    assert.equal(weightRate(t.value).value, null);
    assert.match(t.reason.note ?? '', /No weigh-ins/);
  });

  it('seeds with the mean of the first 7 days', () => {
    const t = weightTrend([kg('2026-03-01', 80), kg('2026-03-03', 81), kg('2026-03-07', 82), kg('2026-03-08', 90)], { through: '2026-03-31' });
    approx(t.value.seed, 81);
    approx(t.value.points[0]!.trend, 81); // the first point is the seed itself
  });

  it('weights a gap of g days by 1 - 0.9^g', () => {
    const t = weightTrend([kg('2026-03-01', 80), kg('2026-03-11', 82)], { through: '2026-03-31' });
    approx(t.value.latest!.trend, 80 + (1 - 0.9 ** 10) * 2);
    const next = weightTrend([kg('2026-03-01', 80), kg('2026-03-02', 82)], { through: '2026-03-31' });
    approx(next.value.latest!.trend, 81 + 0.1 * (82 - 81)); // both in the seed week: seed 81
  });

  it('filters by cycle start and today, converts lb, and keeps the later entry for a date', () => {
    const w: WeighIn[] = [kg('2026-02-20', 70), { date: '2026-03-01', weight: 176.3696, unit: 'lb' }, kg('2026-03-01', 81), kg('2026-04-02', 99)];
    const t = weightTrend(w, { since: '2026-03-01', through: '2026-03-31' });
    assert.equal(t.value.points.length, 1);
    approx(t.value.latest!.weight, 81);
    const lb = weightTrend([{ date: '2026-03-01', weight: 176.3696, unit: 'lb' }], { through: '2026-03-31' });
    approx(lb.value.latest!.weight, 80);
  });
});

describe('weight rate', () => {
  it('waits for 14 days and 8 weigh-ins in the last 28 days', () => {
    const short = weightTrend(daily('2026-03-01', Array(13).fill(80)), { through: '2026-03-31' });
    assert.equal(weightRate(short.value).value, null); // 12 days
    const sparse = weightTrend([0, 3, 6, 9, 12, 15, 18].map((d) => kg(addDays('2026-03-01', d), 80)), { through: '2026-03-31' });
    const r = weightRate(sparse.value);
    assert.equal(r.value, null); // 18 days but 7 weigh-ins
    assert.match(r.reason.note ?? '', /have 18 days and 7/);
    const ok = weightTrend(daily('2026-03-01', Array(15).fill(80)), { through: '2026-03-31' });
    assert.equal(weightRate(ok.value).value?.kgPerWeek, 0);
  });

  it('fits the slope of the trend over the last 28 days only', () => {
    const values = Array.from({ length: 40 }, (_, i) => 90 - 0.1 * i);
    const t = weightTrend(daily('2026-02-01', values), { through: '2026-03-31' });
    const r = weightRate(t.value).value!;
    assert.equal(r.spanDays, 28);
    assert.equal(r.weighIns, 29);
    // Independent least squares over the same 29 trend points.
    const pts = t.value.points.slice(-29);
    const xs = pts.map((_, i) => i);
    const ys = pts.map((p) => p.trend);
    const mx = xs.reduce((a, b) => a + b) / xs.length;
    const my = ys.reduce((a, b) => a + b) / ys.length;
    const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i]! - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    approx(r.kgPerWeek, slope * 7, 1e-9);
    approx(r.pctPerWeek, (slope * 7) / t.value.latest!.trend, 1e-12);
  });
});

describe('rate bands', () => {
  const rate = (pct: number, kgw = pct * 80): WeightRate => ({ kgPerWeek: kgw, pctPerWeek: pct, spanDays: 28, weighIns: 20, trend: 80 });

  it('places the rate against the goal band, ends inclusive', () => {
    assert.equal(rateStatus(rate(-0.007), 'fat-loss').value.status, 'in');
    assert.equal(rateStatus(rate(-0.005), 'fat-loss').value.status, 'in');
    assert.equal(rateStatus(rate(-0.01), 'fat-loss').value.status, 'in');
    assert.equal(rateStatus(rate(-0.012), 'fat-loss').value.status, 'below');
    assert.equal(rateStatus(rate(-0.003), 'fat-loss').value.status, 'above');
    assert.equal(rateStatus(rate(0.004), 'gain').value.status, 'in');
    assert.equal(rateStatus(rate(0.001), 'maintenance').value.status, 'in');
    assert.equal(rateStatus(rate(-0.002), 'recomposition').value.status, 'in');
    assert.equal(rateStatus(rate(0.001), 'recomposition').value.status, 'above');
  });

  it('accepts an explicit kg band and refuses goals without a band', () => {
    const r = rateStatus(rate(-0.004, -0.4), { unit: 'kg', lo: -0.5, hi: -0.25 });
    assert.equal(r.value.status, 'in');
    assert.equal(r.value.value, -0.4);
    assert.equal(r.reason.rule, 'weight.band');
    assert.throws(() => rateStatus(rate(0), 'strength'), RangeError);
  });
});
