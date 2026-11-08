import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CALIBRATION, calibrationNote } from '../src/core/calibration.ts';
import { applyReturn, restartStart, returnProtocol } from '../src/core/missed.ts';
import type { ProgressionTarget } from '../src/core/progression.ts';
import type { Session } from '../src/core/schema.ts';

const s = (date: string, template = 'a'): Session => ({ id: date, date, trackingLevel: 'standard', exercises: [], template, plan: { weekKind: 'loading', template, slots: [] } });
const target: ProgressionTarget = { action: 'add-reps', weight: 60, unit: 'kg', reps: 8, rir: 2, assumedAllSets: true };
const KG = { unit: 'kg' as const, increment: 2.5 };

describe('return protocol', () => {
  it('starts with calibration when there are no sessions', () => {
    const r = returnProtocol({ sessions: [], today: '2026-03-02', rotation: ['a', 'b'] }).value;
    assert.deepEqual([r.protocol, r.calibration, r.nextTemplate], ['start', true, 'a']);
  });

  it('continues with the next session in the rotation under a week off, never stacking', () => {
    const r = returnProtocol({ sessions: [s('2026-03-02', 'a'), s('2026-03-04', 'b')], today: '2026-03-10', rotation: ['a', 'b', 'c'] });
    assert.deepEqual([r.value.protocol, r.value.daysOff, r.value.weeksOff, r.value.nextTemplate, r.value.noStacking], ['continue', 5, 0, 'c', true]);
    assert.match(r.reason.note ?? '', /never two sessions in one day/);
    assert.equal(returnProtocol({ sessions: [s('2026-03-04', 'c')], today: '2026-03-06', rotation: ['a', 'b', 'c'] }).value.nextTemplate, 'a');
  });

  it('continues the rotation from its own last session when a custom or short session came after', () => {
    const custom: Session = { id: 'x', date: '2026-03-05', trackingLevel: 'light', exercises: [] };
    const r = returnProtocol({ sessions: [s('2026-03-02', 'a'), s('2026-03-04', 'b'), custom, s('2026-03-06', 's1')], today: '2026-03-09', rotation: ['a', 'b', 'c'] });
    assert.equal(r.value.lastSession, '2026-03-06');
    assert.equal(r.value.daysOff, 2);
    assert.equal(r.value.nextTemplate, 'c');
    assert.equal(r.reason.inputs['lastTemplate'], 'b');
  });

  it('eases back after 1-2 weeks off: 0.9x and RIR +1 for the first week', () => {
    const one = returnProtocol({ sessions: [s('2026-03-02')], today: '2026-03-10' }).value; // 7 days off
    assert.deepEqual([one.protocol, one.weeksOff, one.loadFactor, one.rirAdd], ['ease-back', 1, 0.9, 1]);
    assert.deepEqual(one.firstWeek, { from: '2026-03-10', to: '2026-03-16' });
    assert.equal(returnProtocol({ sessions: [s('2026-03-02')], today: '2026-03-09' }).value.protocol, 'continue'); // 6 days off
    assert.equal(returnProtocol({ sessions: [s('2026-03-02')], today: '2026-03-23' }).value.weeksOff, 2); // 20 days off
  });

  it('restarts the mesocycle at week 1 after 3+ weeks off', () => {
    const r = returnProtocol({ sessions: [s('2026-03-02')], today: '2026-03-24' }); // 21 days off
    assert.deepEqual([r.value.protocol, r.value.weeksOff, r.value.restartAtWeek, r.value.calibration], ['restart', 3, 1, true]);
    assert.ok(r.reason.note?.includes(`with a calibration week (${calibrationNote()})`), 'the calibration rule, in its own words');
  });

  it('keeps a restart\'s calibration week for 7 days from the first session back', () => {
    const back = [s('2026-03-02'), s('2026-03-24')]; // 21 days off, then back on Tue 24 March
    for (const today of ['2026-03-25', '2026-03-30']) {
      const r = returnProtocol({ sessions: back, today });
      assert.deepEqual([r.value.protocol, r.value.backOn, r.value.firstWeek, r.value.weeksOff, r.value.calibration], ['restart', '2026-03-24', { from: '2026-03-24', to: '2026-03-30' }, 3, true], today);
      assert.match(r.reason.note ?? '', /3 weeks off before Tue 24 Mar/);
    }
    assert.equal(returnProtocol({ sessions: back, today: '2026-03-31' }).value.protocol, 'continue');
    // A 1-2 week break keeps its first week from today, as before.
    assert.equal(returnProtocol({ sessions: [s('2026-03-02'), s('2026-03-12')], today: '2026-03-13' }).value.protocol, 'continue');
  });

  it('finds the latest restart: the first session after 3+ weeks off, or today while the gap is open', () => {
    assert.equal(restartStart([s('2026-03-02'), s('2026-03-24'), s('2026-03-26')], '2026-04-01'), '2026-03-24');
    assert.equal(restartStart([s('2026-03-02')], '2026-03-24'), '2026-03-24');
    assert.equal(restartStart([s('2026-03-02'), s('2026-03-20')], '2026-03-24'), null);
    assert.equal(restartStart([], '2026-03-24'), null);
  });

  it('ignores sessions dated today or later and asks about unlogged training', () => {
    const r = returnProtocol({
      sessions: [s('2026-03-02'), s('2026-03-24')],
      today: '2026-03-24',
      daily: [{ date: '2026-03-10', trained: true }, { date: '2026-03-11', mark: 'missed' }, { date: '2026-03-12', mark: 'rest' }],
    });
    assert.equal(r.value.lastSession, '2026-03-02');
    assert.deepEqual(r.value.gapDays, { trained: 1, rest: 1, missed: 1 });
    assert.match(r.reason.note ?? '', /Ask first/);
    assert.match(r.reason.note ?? '', /likely unlogged/);
  });
});

describe('applying the protocol to a target', () => {
  it('takes 10 % off, rounded to the step, and adds 1 RIR in the first week back', () => {
    const p = returnProtocol({ sessions: [s('2026-03-02')], today: '2026-03-16' }).value;
    const r = applyReturn(target, p, KG, '2026-03-16');
    assert.deepEqual([r.value.action, r.value.weight, r.value.reps, r.value.rir], ['ease-back', 55, 8, 3]); // 54 rounds to 55
    assert.equal(applyReturn(target, p, KG, '2026-03-23').value, target); // the second week back
  });

  it('drops a whole step when the step is too coarse for 10 %', () => {
    const p = returnProtocol({ sessions: [s('2026-03-02')], today: '2026-03-16' }).value;
    const db = applyReturn({ ...target, weight: 20, unit: 'lb' }, p, { unit: 'lb', increment: 5 }, '2026-03-16');
    assert.equal(db.value.weight, 15);
  });

  it('turns a restart into a calibration week', () => {
    const p = returnProtocol({ sessions: [s('2026-03-02')], today: '2026-03-30' }).value;
    const r = applyReturn(target, p, KG, '2026-03-31');
    assert.deepEqual([r.value.action, r.value.weight, r.value.reps, r.value.rir], ['calibrate', null, 8, CALIBRATION.rir]);
    assert.ok(r.reason.note?.includes(calibrationNote()));
    assert.doesNotMatch(r.reason.note ?? '', /2-3/);
    // With the rep range, the reps sit at its bottom.
    assert.equal(applyReturn(target, p, { ...KG, repRange: [6, 10] }, '2026-03-31').value.reps, 6);
  });
});
