import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { e1rmTrend } from '../src/core/e1rm.ts';
import { detectStall, triageLadder, type TriageInput } from '../src/core/stall.ts';

const trend = (weights: number[]) => e1rmTrend(weights.map((w, i) => ({ date: `2026-03-${String(i + 1).padStart(2, '0')}`, weight: w, unit: 'kg' as const, reps: 5 })), 'kg').value;

describe('stall detection', () => {
  it('needs 4 qualifying sessions', () => {
    assert.equal(detectStall(trend([100, 100, 100]), 0.9).value.status, 'insufficient-data');
  });

  it('is progressing above a 2 % gain', () => {
    assert.equal(detectStall(trend([100, 100, 100, 102.5]), 0.9).value.status, 'progressing');
  });

  it('stalls at 2 % or less with 80 % adherence, as a plateau or a decline', () => {
    const flat = detectStall(trend([100, 100, 100, 101.5]), 0.8);
    assert.deepEqual([flat.value.stalled, flat.value.kind], [true, 'plateau']);
    assert.equal(flat.reason.rule, 'stall.detect');
    const down = detectStall(trend([100, 100, 100, 95, 95, 95]), 1); // best-of-3 needs three lower sessions
    assert.deepEqual([down.value.stalled, down.value.kind], [true, 'decline']);
  });

  it('calls low adherence an adherence question, and unknown adherence unknown', () => {
    const low = detectStall(trend([100, 100, 100, 100]), 0.75);
    assert.deepEqual([low.value.stalled, low.value.status], [false, 'adherence']);
    assert.match(low.reason.note ?? '', /adherence question/);
    assert.equal(detectStall(trend([100, 100, 100, 100]), null).value.status, 'needs-adherence');
  });
});

describe('triage ladder', () => {
  const base: TriageInput = { sleepH: 7.5, readinessBand: 'normal', proteinGPerKg: 1.8, rateStatus: 'in', recovery: 4, jointAches: false, weeksToDeload: 3, weeksToMesocycleEnd: 3, muscle: { name: 'chest', weeklySets: 8 } };
  const chosen = (steps: ReturnType<typeof triageLadder>) => steps.find((s) => s.value.chosen)?.value.step ?? null;

  it('lists the four steps in order with their reasons', () => {
    const steps = triageLadder('bench-press', base);
    assert.deepEqual(steps.map((s) => s.value.id), ['check-basics', 'early-deload', 'change-range-or-variation', 'adjust-volume']);
    assert.deepEqual(steps.map((s) => s.reason.rule), ['stall.triage.1', 'stall.triage.2', 'stall.triage.3', 'stall.triage.4']);
  });

  it('stops at step 1 when sleep, food or readiness is off', () => {
    const steps = triageLadder('bench-press', { ...base, sleepH: 6.2 });
    assert.equal(chosen(steps), 1);
    assert.match(steps[0]!.value.suggestion, /sleep 6\.2 h/);
    assert.equal(chosen(triageLadder('bench-press', { ...base, proteinGPerKg: 1.2 })), 1);
    assert.equal(chosen(triageLadder('bench-press', { ...base, rateStatus: 'below' })), 1);
  });

  it('offers an early deload when fatigued and the scheduled one is 2+ weeks away', () => {
    assert.equal(chosen(triageLadder('bench-press', { ...base, recovery: 2 })), 2);
    assert.equal(chosen(triageLadder('bench-press', { ...base, jointAches: true, weeksToDeload: 2 })), 2);
    const near = triageLadder('bench-press', { ...base, recovery: 2, weeksToDeload: 1 });
    assert.equal(near[1]!.value.applies, false);
    assert.match(near[1]!.value.suggestion, /keep it/);
  });

  it('falls through to the rep range or variation at the next boundary', () => {
    const steps = triageLadder('bench-press', base);
    assert.equal(chosen(steps), 3);
    assert.match(steps[2]!.value.suggestion, /in 3 week/);
  });

  it('starts where last week left off and moves volume by 2 sets', () => {
    const up = triageLadder('bench-press', { ...base, startAt: 4 });
    assert.equal(chosen(up), 4);
    assert.match(up[3]!.value.suggestion, /Add 2 sets/);
    assert.match(up[0]!.reason.note ?? '', /Skipped/);
    const high = triageLadder('bench-press', { ...base, startAt: 4, muscle: { name: 'chest', weeklySets: 12 } });
    assert.equal(chosen(high), null);
    const poor = triageLadder('bench-press', { ...base, startAt: 4, readinessBand: 'watch' });
    assert.match(poor[3]!.value.suggestion, /down 2 sets/);
  });

  it('says what it does not know', () => {
    const steps = triageLadder('bench-press', { weeksToDeload: 3 });
    assert.match(steps[0]!.reason.note ?? '', /Not known: sleep, readiness, protein/);
    assert.equal(chosen(steps), 3);
  });
});
