import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { E1RM, e1rmRises, e1rmTrend, epley, lastRise } from '../src/core/e1rm.ts';
import type { TopSet } from '../src/core/history.ts';
import { buildProgress, buildReview } from '../src/report/index.ts';
import { approx, fixtureFiles, memoryIo } from './helpers.ts';

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

describe('lastRise', () => {
  const rs = (date: string, weight: number, reps: number, rir?: number) => ({ date, weight, reps, ...(rir !== undefined ? { rir } : {}) });

  it('the latest e1RM above every earlier one, with the sessions and days since', () => {
    // 100 x 5 (116.7), 100 x 6 (120, a rise), 95 x 5 (110.8), 102.5 x 6 (123, a rise), 100 x 5.
    const sets = [rs('2026-03-02', 100, 5), rs('2026-03-05', 100, 6), rs('2026-03-09', 95, 5), rs('2026-03-12', 102.5, 6), rs('2026-03-16', 100, 5)];
    assert.deepEqual(e1rmRises(sets).map((m) => m.rise), [false, true, false, true, false]);
    const r = lastRise(sets, '2026-03-20');
    assert.deepEqual(r.value, { date: '2026-03-12', e1rm: 123, sessionsSince: 1, daysSince: 8 });
    assert.deepEqual([r.reason.rule, r.reason.title, r.reason.threshold], ['e1rm.rise', 'Last rise', { maxRepsPlusRir: E1RM.maxReps }]);
    assert.equal(r.reason.note, 'Last rise: an e1RM of 123 on Thu 12 Mar, above every earlier one; 1 session since, 8 days ago.');
    // An equal e1RM is no rise; RIR counts in the e1RM.
    assert.deepEqual(e1rmRises([rs('2026-03-02', 100, 5), rs('2026-03-05', 100, 5), rs('2026-03-09', 100, 4, 1)]).map((m) => m.rise), [false, false, false]);
    assert.equal(lastRise([rs('2026-03-02', 100, 5), rs('2026-03-05', 100, 5, 2)], '2026-03-05').value!.sessionsSince, 0);
  });

  it('null with its reason: no sets, no e1RM (reps + RIR over 10), or none above the first', () => {
    assert.deepEqual([lastRise([], '2026-03-20').value, lastRise([], '2026-03-20').reason.note], [null, 'No logged sets: no rise yet.']);
    const high = lastRise([rs('2026-03-02', 40, 12), rs('2026-03-05', 40, 9, 2)], '2026-03-20');
    assert.deepEqual([high.value, high.reason.note], [null, 'No e1RM: reps + RIR over 10 on every set; judge by load at the same reps.']);
    const flat = lastRise([rs('2026-03-02', 100, 6), rs('2026-03-05', 100, 5)], '2026-03-20');
    assert.deepEqual([flat.value, flat.reason.note], [null, 'No rise yet: the first e1RM, 120 on Mon 2 Mar, is still the best.']);
  });

  it('the sets before a unit flag are left out: the first one after it is the start', () => {
    const sets = [rs('2026-03-02', 140, 5), rs('2026-03-05', 60, 5), rs('2026-03-09', 62.5, 5)];
    assert.deepEqual(e1rmRises(sets, 1).map((m) => m.rise), [false, false, true]);
    assert.equal(lastRise(sets, '2026-03-09', 1).value!.date, '2026-03-09');
    assert.equal(lastRise(sets, '2026-03-09').value, null, 'with the 140 kept, nothing since is above it');
  });

  it('review’s lifts[].lastRise is the last of Progress’s PR marks on the same data', () => {
    const date = '2026-04-12';
    const read = readVault(memoryIo(fixtureFiles('v'), date), 'v', { asOf: date });
    const review = buildReview(read.data, date);
    const progress = buildProgress(read, date, '', { scope: 'all' }) as unknown as { lifts: { exercise: string; sets: { date: string; pr: boolean; e1rm: number | null }[] }[] };
    assert.ok(progress.lifts.length >= 4);
    for (const p of progress.lifts) {
      const l = review.lifts.find((x) => x.exercise === p.exercise)!;
      const last = p.sets.filter((x) => x.pr).at(-1) ?? null;
      assert.deepEqual(l.lastRise.value && [l.lastRise.value.date, l.lastRise.value.e1rm], last && [last.date, last.e1rm], p.exercise);
    }
    const sq = review.lifts.find((x) => x.exercise === 'goblet-squat')!;
    assert.deepEqual(sq.lastRise.value, { date: '2026-04-08', e1rm: 71.5, sessionsSince: 0, daysSince: 4 });
    // The exercise facts carry the lift's last rise.
    assert.deepEqual((review.exercises.value.exercises.find((x) => x.id === 'goblet-squat') as { lastRise?: unknown }).lastRise, sq.lastRise);
    assert.equal((review.exercises.value.exercises.find((x) => x.id === 'side-plank') as { lastRise?: unknown }).lastRise, undefined, 'no e1RM history: no lastRise');
  });
});

// The review's lastRise is the cycle's, as Progress marks its PRs at its default scope (the cycle); at
// every scope the two read the same marks, with the trend's unit flag placed on the list they mark.
describe('lastRise at the cycle scope, as Progress marks its PRs', () => {
  type Prog = { cycle: { since: string | null }; lifts: { exercise: string; unitFlag: { to: { date: string } } | null; sets: { date: string; pr: boolean; used: boolean; e1rm: number | null }[] }[] };
  const LOG = 'v/3-Personal/Fitness/fitness-log-data.json';
  const date = '2026-04-12';
  /** The fixture with a fresh start on Wed 1 Apr (a baseline note), and any edits to its log. */
  const cycleRead = (on = date, ...edits: ((log: { sessions: Record<string, any>[] }) => void)[]) => {
    const f = fixtureFiles('v');
    f['v/3-Personal/Fitness/Baseline - 2026-04-01.md'] = '';
    const log = JSON.parse(f[LOG]!);
    for (const e of edits) e(log);
    f[LOG] = JSON.stringify(log);
    return readVault(memoryIo(f, on), 'v', { asOf: on });
  };
  const progress = (read: ReturnType<typeof cycleRead>, on: string, scope?: 'cycle' | 'all') => buildProgress(read, on, '', scope ? { scope } : {}) as unknown as Prog;
  const prs = (p: Prog, id: string) => p.lifts.find((x) => x.exercise === id)!.sets.filter((x) => x.pr).map((x) => x.date);
  const agrees = (read: ReturnType<typeof cycleRead>, on: string) => {
    const review = buildReview(read.data, on);
    const p = progress(read, on);
    for (const l of p.lifts) {
      const last = l.sets.filter((x) => x.pr).at(-1) ?? null;
      const rise = review.lifts.find((x) => x.exercise === l.exercise)!.lastRise.value;
      assert.deepEqual(rise && [rise.date, rise.e1rm], last && [last.date, last.e1rm], l.exercise);
    }
    return review;
  };

  it('a rise before the cycle is not this cycle’s: none since Wed 1 Apr, with the best before it as context', () => {
    const read = cycleRead();
    assert.equal(progress(read, date).cycle.since, '2026-04-01');
    const review = agrees(read, date);
    const bench = review.lifts.find((x) => x.exercise === 'flat-db-bench-press')!.lastRise;
    assert.equal(bench.value, null);
    assert.equal(bench.reason.note, 'No rise this cycle yet: the first e1RM since Wed 1 Apr, 70 on Fri 3 Apr, is still the best. The best before this cycle: 70 on Mon 30 Mar.');
    assert.deepEqual([bench.reason.inputs['since'], bench.reason.inputs['before']], ['2026-04-01', { date: '2026-03-30', e1rm: 70 }]);
    // All: the whole log's marks.
    assert.deepEqual(prs(progress(read, date, 'all'), 'flat-db-bench-press'), ['2026-03-09', '2026-03-14', '2026-03-18', '2026-03-30']);
    const sq = review.lifts.find((x) => x.exercise === 'goblet-squat')!.lastRise;
    assert.deepEqual(sq.value, { date: '2026-04-08', e1rm: 71.5, sessionsSince: 0, daysSince: 4 });
    assert.equal(sq.reason.note, 'Last rise this cycle: an e1RM of 71.5 on Wed 8 Apr, above every earlier one since Wed 1 Apr; the latest session, 4 days ago. Above the best before this cycle too (66.67 on Mon 30 Mar).');
  });

  it('a rise this cycle under an older cycle’s best is this cycle’s rise', () => {
    // The bench at 50 x 8 on Fri 3 Apr (63.33), then 55 x 8 on Wed 8 Apr (69.67): a rise this cycle, under the 70 of Mon 30 Mar.
    const read = cycleRead(date, (log) => {
      for (const s of log.sessions) {
        if (s['date'] === '2026-04-03') s['lift2'] = { ...s['lift2'], weight: 50, reps: 8 };
        if (s['date'] === '2026-04-08') s['lift2'] = { ...s['lift2'], weight: 55, reps: 8 };
      }
    });
    const review = agrees(read, date);
    const bench = review.lifts.find((x) => x.exercise === 'flat-db-bench-press')!.lastRise;
    assert.deepEqual(bench.value, { date: '2026-04-08', e1rm: 69.67, sessionsSince: 0, daysSince: 4 });
    assert.match(bench.reason.note!, /Under the best before this cycle \(70 on Mon 30 Mar\)\.$/);
    assert.deepEqual(prs(progress(read, date), 'flat-db-bench-press'), ['2026-04-08']);
    assert.ok(!prs(progress(read, date, 'all'), 'flat-db-bench-press').includes('2026-04-08'), 'under the whole log’s best: no PR at All');
  });

  it('the trend’s unit flag, found after a calibration week, is placed on the whole list both mark', () => {
    // Back after 3+ weeks off on Mon 4 May (a calibration week, where the trend starts), with 121 logged as kg on Wed 13 May (lb).
    const back = [['2026-05-04', 50], ['2026-05-08', 55], ['2026-05-13', 121], ['2026-05-15', 57.5]] as const;
    const on = '2026-05-16';
    const read = cycleRead(on, (log) => {
      for (const [d, w] of back) log.sessions.push({ date: d, type: 'B', lift1: { name: 'Romanian Deadlift', weight: w, reps: 8, unit: 'kg' }, lift2: { name: 'Seated Cable Row', weight: 100, reps: 8, unit: 'lb' } });
    });
    const review = agrees(read, on);
    const rdl = review.lifts.find((x) => x.exercise === 'romanian-deadlift')!;
    assert.equal(rdl.e1rm.reason.inputs['calibrationFrom'], '2026-05-04', 'the trend starts at the calibration week');
    assert.equal(rdl.e1rm.value.unitFlag!.to.date, '2026-05-15');
    for (const scope of ['cycle', 'all'] as const) {
      const l = progress(read, on, scope).lifts.find((x) => x.exercise === 'romanian-deadlift')!;
      // Every set before the flag is left out, and only those.
      assert.deepEqual(l.sets.filter((x) => x.used).map((x) => x.date), ['2026-05-15'], scope);
      assert.deepEqual(prs(progress(read, on, scope), 'romanian-deadlift'), [], scope);
    }
    assert.equal(rdl.lastRise.value, null);
    assert.match(rdl.lastRise.reason.note!, /^No rise this cycle yet: the first e1RM since Wed 1 Apr, 72\.83 on Fri 15 May, is still the best\./);
  });
});
