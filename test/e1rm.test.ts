import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { E1RM, e1rmTrend, epley } from '../src/core/e1rm.ts';
import type { TopSet } from '../src/core/history.ts';
import { approx } from './helpers.ts';

const top = (date: string, weight: number, reps: number, rir?: number, unit: 'kg' | 'lb' = 'kg'): TopSet =>
  rir === undefined ? { date, weight, unit, reps } : { date, weight, unit, reps, rir };

describe('epley', () => {
  it('uses reps alone when RIR is missing', () => {
    const r = epley(100, 5);
    approx(r.value, 100 * (1 + 5 / 30));
    assert.equal(r.reason.rule, 'e1rm.epley');
    assert.match(r.reason.note ?? '', /RIR not logged/);
  });

  it('adds RIR to reps', () => {
    approx(epley(100, 5, 2).value, 100 * (1 + 7 / 30));
  });

  it('allows reps + RIR of exactly 10 and refuses 11', () => {
    approx(epley(100, 8, 2).value, 100 * (1 + 10 / 30));
    const over = epley(100, 9, 2);
    assert.equal(over.value, null);
    assert.deepEqual(over.reason.threshold, { maxRepsPlusRir: 10 });
    assert.equal(epley(60, 11).value, null);
  });
});

describe('e1rmTrend', () => {
  it('handles no data', () => {
    const r = e1rmTrend([], 'kg');
    assert.equal(r.value.best, null);
    assert.equal(r.value.change, null);
    assert.equal(r.value.verdict, null);
    assert.equal(r.value.stallCandidate, false);
    assert.match(r.reason.note ?? '', /No logged top sets/);
  });

  it('needs 4 qualifying sessions for a trend', () => {
    const r = e1rmTrend([top('2026-03-02', 100, 5), top('2026-03-05', 100, 6), top('2026-03-09', 100, 7)], 'kg');
    approx(r.value.best, 100 * (1 + 7 / 30));
    assert.equal(r.value.change, null);
    assert.match(r.reason.note ?? '', /needs 4 sessions/);
  });

  it('smooths with the best of the last 3 and compares with 3 sessions back', () => {
    const h = [top('2026-03-02', 100, 5), top('2026-03-05', 100, 8), top('2026-03-09', 90, 5), top('2026-03-12', 92.5, 5), top('2026-03-16', 95, 5)];
    const r = e1rmTrend(h, 'kg');
    const e = (w: number, n: number) => w * (1 + n / 30);
    assert.deepEqual(r.value.points.map((p) => p.best), [e(100, 5), e(100, 8), e(100, 8), e(100, 8), e(95, 5)]);
    approx(r.value.change, e(95, 5) / e(100, 8) - 1);
    assert.equal(r.value.verdict, 'down');
  });

  it('calls changes inside +-4 % noise and flags a stall at 2 % or less', () => {
    const flat = [100, 100, 100, 101].map((w, i) => top(`2026-03-0${i + 1}`, w, 5));
    const r = e1rmTrend(flat, 'kg');
    approx(r.value.change, 0.01);
    assert.equal(r.value.verdict, 'noise');
    assert.equal(r.value.stallCandidate, true);

    const three = [100, 100, 100, 103].map((w, i) => top(`2026-03-0${i + 1}`, w, 5));
    const r3 = e1rmTrend(three, 'kg');
    assert.equal(r3.value.verdict, 'noise');
    assert.equal(r3.value.stallCandidate, false);

    const up = [100, 100, 100, 105].map((w, i) => top(`2026-03-0${i + 1}`, w, 5));
    assert.equal(e1rmTrend(up, 'kg').value.verdict, 'up');
    assert.equal(E1RM.noise, 0.04);
  });

  it('skips top sets with reps + RIR over 10', () => {
    const h = [top('2026-03-02', 60, 12), top('2026-03-05', 60, 9, 2), top('2026-03-09', 60, 8, 2), top('2026-03-12', 60, 8)];
    const r = e1rmTrend(h, 'kg');
    assert.equal(r.value.sessions, 4);
    assert.equal(r.value.points.length, 2);
    assert.deepEqual(r.value.points.map((p) => p.date), ['2026-03-09', '2026-03-12']);
  });

  it('says so when no top set qualifies', () => {
    const r = e1rmTrend([top('2026-03-02', 60, 12), top('2026-03-05', 60, 15)], 'kg');
    assert.equal(r.value.best, null);
    assert.match(r.reason.note ?? '', /judge by load at the same reps/);
  });

  it('converts other units and rounds to 0.1 like the snippet', () => {
    const r = e1rmTrend([top('2026-03-02', 50, 8, undefined, 'lb'), top('2026-03-05', 22.5, 9, undefined, 'kg')], 'lb');
    assert.deepEqual(r.value.points.map((p) => p.weight), [50, 49.6]);
    approx(r.value.points[1]!.e1rm, 49.6 * (1 + 9 / 30));
  });

  it('flags a likely kg/lb mix-up and uses only the run after the last flag', () => {
    const h = [top('2026-03-02', 60, 5), top('2026-03-05', 62.5, 5), top('2026-03-09', 140, 5), top('2026-03-12', 65, 5), top('2026-03-16', 65, 6)];
    const r = e1rmTrend(h, 'kg');
    assert.equal(r.value.ignored, 3);
    assert.deepEqual(r.value.unitFlag, { from: { date: '2026-03-09', weight: 140 }, to: { date: '2026-03-12', weight: 65 } });
    assert.equal(r.value.points.length, 2);
    assert.match(r.reason.note ?? '', /kg\/lb mix-up/);
  });

  it('treats the flag edges as exclusive (1.8x and 0.55x flag)', () => {
    assert.notEqual(e1rmTrend([top('2026-03-02', 50, 5), top('2026-03-05', 90, 5)], 'kg').value.unitFlag, null);
    assert.equal(e1rmTrend([top('2026-03-02', 50, 5), top('2026-03-05', 89.9, 5)], 'kg').value.unitFlag, null);
    assert.notEqual(e1rmTrend([top('2026-03-02', 100, 5), top('2026-03-05', 55, 5)], 'kg').value.unitFlag, null);
  });

  it('sorts its input by date', () => {
    const r = e1rmTrend([top('2026-03-09', 105, 5), top('2026-03-02', 100, 5)], 'kg');
    assert.deepEqual(r.value.points.map((p) => p.date), ['2026-03-02', '2026-03-09']);
  });
});
