import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkConcurrent, type PlannedSession } from '../src/core/concurrent.ts';
import type { Exercise } from '../src/core/schema.ts';

const EX: Record<string, Exercise> = {
  squat: { name: 'Squat', unit: 'kg', increment: 2.5, muscles: { main: ['quads', 'glutes'], helps: [] } },
  bench: { name: 'Bench', unit: 'kg', increment: 2.5, muscles: { main: ['chest'], helps: ['triceps'] } },
  row: { name: 'Row', unit: 'kg', increment: 2.5, muscles: { main: ['lats'], helps: [] } },
};
const lift = (exercise: string, hard?: boolean) => (hard === undefined ? { kind: 'lift' as const, exercise } : { kind: 'lift' as const, exercise, hard });
const flags = (week: PlannedSession[]) => checkConcurrent(week, EX).map((r) => r.value.flag);

describe('concurrent training', () => {
  it('passes a clean week', () => {
    const week: PlannedSession[] = [
      { id: 'mon', day: 0, items: [{ kind: 'conditioning', minutes: 5, label: 'easy bike' }, lift('squat'), { kind: 'conditioning', minutes: 8, label: 'Zone 2 finisher' }] },
      { id: 'wed', day: 2, items: [lift('bench'), lift('row')] },
      { id: 'sat', day: 5, items: [{ kind: 'conditioning', hard: true, minutes: 30, label: '4x4 intervals' }] },
    ];
    assert.deepEqual(flags(week), []);
  });

  it('flags conditioning before lifting, but not a short easy warm-up', () => {
    const r = checkConcurrent([{ id: 'mon', day: 0, items: [{ kind: 'conditioning', minutes: 20, label: 'run' }, lift('bench')] }], EX);
    assert.deepEqual(r.map((x) => x.value.flag), ['conditioning-before-lifting']);
    assert.match(r[0]!.value.suggestion, /Lift first/);
    assert.equal(r[0]!.reason.rule, 'concurrent.conditioning-before-lifting');
    assert.deepEqual(flags([{ id: 'mon', day: 0, items: [{ kind: 'conditioning', minutes: 6, hard: true }, lift('bench')] }]), ['conditioning-before-lifting']);
  });

  it('flags hard leg intervals within 24 h before a heavy lower-body day, around the week', () => {
    const intervals = { kind: 'conditioning' as const, hard: true, minutes: 30, label: 'hill sprints' };
    assert.deepEqual(flags([{ id: 'sun', day: 6, items: [intervals] }, { id: 'mon', day: 0, items: [lift('squat')] }]), ['intervals-before-heavy-legs']);
    assert.deepEqual(flags([{ id: 'sun', day: 6, hour: 8, items: [intervals] }, { id: 'mon', day: 0, hour: 18, items: [lift('squat')] }]), []); // 34 h
    assert.deepEqual(flags([{ id: 'sun', day: 6, hour: 18, items: [intervals] }, { id: 'mon', day: 0, hour: 8, items: [lift('squat')] }]), ['intervals-before-heavy-legs']); // 14 h
    assert.deepEqual(flags([{ id: 'mon', day: 0, items: [lift('squat')] }, { id: 'tue', day: 1, items: [intervals] }]), []); // after, not before
    assert.deepEqual(flags([{ id: 'sun', day: 6, items: [{ ...intervals, legs: false }] }, { id: 'mon', day: 0, items: [lift('squat')] }]), []); // arms
    assert.deepEqual(flags([{ id: 'sun', day: 6, items: [intervals] }, { id: 'mon', day: 0, items: [lift('bench')] }]), []); // upper body
  });

  it('flags two hard days in a row for the same muscle, not a light one', () => {
    const r = checkConcurrent([{ id: 'mon', day: 0, items: [lift('bench')] }, { id: 'tue', day: 1, items: [lift('bench'), lift('row')] }], EX);
    assert.deepEqual(r.map((x) => [x.value.flag, x.value.muscle]), [['same-muscle-back-to-back', 'chest']]);
    assert.deepEqual(flags([{ id: 'mon', day: 0, items: [lift('bench')] }, { id: 'tue', day: 1, items: [lift('bench', false)] }]), []);
    assert.deepEqual(flags([{ id: 'mon', day: 0, items: [lift('bench')] }, { id: 'wed', day: 2, items: [lift('bench')] }]), []);
  });
});
