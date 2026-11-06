import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { effectiveSlot, weekAt } from '../src/core/plan.ts';
import type { ExerciseSlot } from '../src/core/schema.ts';
import { loadFixtures } from './helpers.ts';

const slot: ExerciseSlot = {
  exercise: 'back-squat',
  sets: 3,
  repRange: [5, 8],
  rir: 2,
  until: { until: '2026-03-15', reason: 'sore knee', exercise: 'goblet-squat', repRange: [8, 12] },
};

describe('until changes', () => {
  it('applies the change through its date, inclusive', () => {
    const on = effectiveSlot(slot, '2026-03-15').value;
    assert.equal(on.exercise, 'goblet-squat');
    assert.deepEqual(on.repRange, [8, 12]);
    assert.equal(on.sets, 3);
  });

  it('drops it after the date and says it is due for review', () => {
    const after = effectiveSlot(slot, '2026-03-16');
    assert.equal(after.value.exercise, 'back-squat');
    assert.equal(after.value.until, undefined);
    assert.match(after.reason.note ?? '', /due for review/);
  });

  it('passes a plain slot through', () => {
    const { until: _u, ...plain } = slot;
    assert.deepEqual(effectiveSlot(plain, '2026-03-01').value, plain);
  });
});

describe('weekAt', () => {
  it('finds the program week holding a date', () => {
    const f = loadFixtures().find((x) => x.name === '04-deload-week')!;
    assert.equal(weekAt(f.data.program!, '2026-03-25')?.kind, 'deload');
    assert.equal(weekAt(f.data.program!, '2026-03-30')?.kind, 'loading');
    assert.equal(weekAt(f.data.program!, '2026-05-01'), undefined);
  });
});
