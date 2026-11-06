import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideDeload, deloadPrescription } from '../src/core/deload.ts';
import { slot } from './helpers.ts';

describe('deload decision', () => {
  const start = '2026-03-02';

  it('schedules every 4th week by default, and every Nth when asked', () => {
    const w4 = decideDeload({ programStart: start, today: '2026-03-25' }).value;
    assert.deepEqual([w4.planWeek, w4.scheduled, w4.deload, w4.weeksToScheduled], [4, true, true, 0]);
    const w2 = decideDeload({ programStart: start, today: '2026-03-10' }).value;
    assert.deepEqual([w2.planWeek, w2.scheduled, w2.weeksToScheduled], [2, false, 2]);
    assert.equal(decideDeload({ programStart: start, today: '2026-03-10', every: 2 }).value.scheduled, true);
    assert.throws(() => decideDeload({ programStart: start, today: '2026-03-10', every: 1 }), RangeError);
    assert.throws(() => decideDeload({ programStart: start, today: '2026-02-20' }), RangeError);
  });

  it('is triggered by readiness or by stalls on 2+ main lifts', () => {
    const r = decideDeload({ programStart: start, today: '2026-03-10', earlyDeloadSignal: true });
    assert.deepEqual([r.value.deload, r.value.triggers], [true, ['readiness']]);
    assert.match(r.reason.note ?? '', /The user decides/);
    assert.equal(decideDeload({ programStart: start, today: '2026-03-10', stalledMainLifts: ['bench-press'] }).value.deload, false);
    const two = decideDeload({ programStart: start, today: '2026-03-10', stalledMainLifts: ['bench-press', 'back-squat'] }).value;
    assert.deepEqual([two.deload, two.triggers], [true, ['stalls']]);
  });

  it('records the user cancelling, except a second scheduled one in a row', () => {
    const c = decideDeload({ programStart: start, today: '2026-03-25', cancelled: true });
    assert.deepEqual([c.value.deload, c.value.cancelled], [false, true]);
    assert.match(c.reason.note ?? '', /Cancelled by the user/);
    const again = decideDeload({ programStart: start, today: '2026-03-25', cancelled: true, previousCancelled: true });
    assert.deepEqual([again.value.deload, again.value.cancelled], [true, false]);
    assert.match(again.reason.note ?? '', /never run without one/);
    const triggered = decideDeload({ programStart: start, today: '2026-03-10', earlyDeloadSignal: true, cancelled: true, previousCancelled: true });
    assert.deepEqual([triggered.value.deload, triggered.value.cancelled], [false, true]);
  });
});

describe('deload prescription', () => {
  const slots = [slot('back-squat', 5, 5, 8, 2), slot('bench-press', 3, 6, 8, 1), slot('curl', 2, 10, 15, 1)];

  it('halves the sets (rounded up) and adds 3 RIR', () => {
    const r = deloadPrescription(slots);
    assert.deepEqual(r.value.map((s) => [s.exercise, s.sets, s.rir, s.loadFactor]), [['back-squat', 3, 5, null], ['bench-press', 2, 4, null], ['curl', 1, 4, null]]);
    assert.equal(r.reason.rule, 'deload.prescription.standard');
  });

  it('offers the dashboard legacy deload: 2 sets, about 10 % lighter, at the bottom of the range', () => {
    const r = deloadPrescription(slots, 'legacy');
    assert.deepEqual(r.value.map((s) => [s.sets, s.rir, s.reps, s.loadFactor]), [[2, 2, 5, 0.9], [2, 1, 6, 0.9], [2, 1, 10, 0.9]]);
    assert.match(r.reason.note ?? '', /5-set exercise drops to 2/);
  });
});
