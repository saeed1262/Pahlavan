// The gym's real weights (profile.loads): what each kind of kit can make, and
// a target moved onto one of them.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { finestStep, gcdStep, LOADS, loadKindOf, nextWeight, snapLoad, stepInKit, weightsFor } from '../src/core/loads.ts';
import type { GymLoads } from '../src/core/schema.ts';

const KIT: GymLoads = {
  unit: 'kg',
  dumbbell: { from: 2, to: 30, step: 2 },
  kettlebell: { weights: [24, 8, 16, 12, 20] },
  barbell: { bar: 20, plates: [20, 10, 5, 2.5, 1.25] },
  'trap-bar': { bar: 25 },
  machine: { step: 5, to: 100 },
  cable: { step: 2.5 },
};

describe('weightsFor: the real weights of each kind of kit', () => {
  it('dumbbells as a range, kettlebells as a list in any order', () => {
    assert.deepEqual(weightsFor('dumbbell', KIT, 'kg'), [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30]);
    assert.deepEqual(weightsFor('kettlebell', KIT, 'kg'), [8, 12, 16, 20, 24]);
    assert.deepEqual(weightsFor('dumbbell', { unit: 'kg', dumbbell: { weights: [5, 2.5, 5, 7.5] } }, 'kg'), [2.5, 5, 7.5], 'duplicates once');
    assert.deepEqual(weightsFor('dumbbell', { unit: 'kg', dumbbell: { from: 1.25, to: 5, step: 1.25 } }, 'kg'), [1.25, 2.5, 3.75, 5], 'decimal steps without float noise');
  });

  it('a barbell: the bar plus pairs of plates, in steps of two of the smallest plate', () => {
    const bar = weightsFor('barbell', KIT, 'kg')!;
    assert.deepEqual(bar.slice(0, 5), [20, 22.5, 25, 27.5, 30]);
    assert.ok(bar.includes(61.25) === false && bar.includes(62.5));
    assert.equal(bar.at(-1), 20 + 2 * 4 * (20 + 10 + 5 + 2.5 + 1.25), 'four of each plate a side at most');
    // Plates that are not multiples of the smallest: only the sums a side can hold.
    const odd = weightsFor('barbell', { unit: 'kg', barbell: { bar: 20, plates: [5, 2] } }, 'kg')!;
    assert.deepEqual(odd.slice(0, 8), [20, 24, 28, 30, 32, 34, 36, 38], '1 and 3 a side cannot be made');
  });

  it('a trap bar uses the barbell\'s plates unless it lists its own', () => {
    assert.deepEqual(weightsFor('trap-bar', KIT, 'kg')!.slice(0, 3), [25, 27.5, 30]);
    assert.deepEqual(weightsFor('trap-bar', { unit: 'kg', 'trap-bar': { bar: 25, plates: [10, 5] } }, 'kg')!.slice(0, 3), [25, 35, 45]);
    assert.equal(weightsFor('trap-bar', { unit: 'kg', 'trap-bar': { bar: 25 } }, 'kg'), null, 'no plates anywhere: no kit');
  });

  it('a machine and a cable go up by their step, to their top or a sane maximum', () => {
    const m = weightsFor('machine', KIT, 'kg')!;
    assert.deepEqual([m[0], m[1], m.at(-1), m.length], [5, 10, 100, 20]);
    const c = weightsFor('cable', KIT, 'kg')!;
    assert.deepEqual([c[0], c[1], c.at(-1)], [2.5, 5, 500]);
    assert.deepEqual(weightsFor('cable', { unit: 'lb', cable: { step: 10, from: 15, to: 45 } }, 'lb'), [15, 25, 35, 45]);
  });

  it('null with no kit of that kind, no loads or a kind loads do not describe', () => {
    assert.equal(weightsFor('dumbbell', { unit: 'kg' }, 'kg'), null);
    assert.equal(weightsFor('dumbbell', undefined, 'kg'), null);
    assert.equal(weightsFor('band', KIT, 'kg'), null);
    assert.equal(weightsFor(undefined, KIT, 'kg'), null);
  });

  it('converts to the lift\'s unit, to 0.1, when the kit\'s differs', () => {
    assert.deepEqual(weightsFor('kettlebell', KIT, 'lb'), [17.6, 26.5, 35.3, 44.1, 52.9]);
    assert.deepEqual(weightsFor('dumbbell', { unit: 'lb', dumbbell: { weights: [10, 20] } }, 'kg'), [4.5, 9.1]);
  });
});

describe('snapLoad: a target onto a real weight', () => {
  const DB = weightsFor('dumbbell', KIT, 'kg')!;
  const BAR = weightsFor('barbell', KIT, 'kg')!;

  it('up: the nearest real weight above the base', () => {
    assert.deepEqual(snapLoad(22.5, 20, 'up', DB), { weight: 22, ceiling: false, floor: false });
    assert.equal(snapLoad(21, 20, 'up', DB).weight, 22, 'a tie with the base itself is not an increase');
    assert.equal(snapLoad(61.25, 60, 'up', BAR).weight, 62.5);
    assert.equal(snapLoad(19, 20, 'up', DB).weight, 22, 'a target at or under the base: the next one up');
    assert.equal(snapLoad(25, 20, 'up', DB).weight, 24, 'a tie between 24 and 26: the smaller jump');
  });

  it('up past the heaviest: the heaviest, flagged as the ceiling', () => {
    assert.deepEqual(snapLoad(32.5, 30, 'up', DB), { weight: 30, ceiling: true, floor: false });
    assert.deepEqual(snapLoad(33, 28, 'up', DB), { weight: 30, ceiling: false, floor: false }, 'still an increase to the heaviest');
  });

  it('down: the nearest real weight under the base', () => {
    assert.equal(snapLoad(22 * 0.9, 22, 'down', DB).weight, 20);
    assert.equal(snapLoad(23, 22, 'down', DB).weight, 20, 'a target at or over the base: the next one down');
    assert.equal(snapLoad(19, 20, 'down', DB).weight, 18, 'the base itself is not lighter');
    assert.equal(snapLoad(17, 20, 'down', DB).weight, 18, 'a tie between 16 and 18: the gentler drop');
    assert.deepEqual(snapLoad(1.8, 2, 'down', DB), { weight: 2, ceiling: false, floor: true }, 'nothing lighter');
  });

  it('nextWeight walks the list; finestStep and stepInKit read a lift\'s step against the kit', () => {
    assert.equal(nextWeight(20, 'up', DB), 22);
    assert.equal(nextWeight(21, 'down', DB), 20);
    assert.equal(nextWeight(30, 'up', DB), null);
    assert.equal(finestStep(DB), 2);
    assert.equal(finestStep(BAR), 2.5);
    assert.equal(stepInKit(2, DB), true);
    assert.equal(stepInKit(1, DB), false);
    assert.equal(stepInKit(5, DB), false, '5 kg is two and a half dumbbell steps');
    assert.equal(stepInKit(5, BAR), true);
    assert.equal(stepInKit(1.25, BAR), false, 'one 1.25 plate is not a pair');
  });

  it('gcdStep keeps a fine step exact', () => {
    assert.equal(gcdStep(0.5, 1.25), 0.25);
    assert.equal(gcdStep(0.5, 2.5), 0.5);
    assert.equal(gcdStep(0.5, 5), 0.5);
    assert.equal(gcdStep(0.5, 0.2), 0.1);
  });

  it('loadKindOf: the catalogue\'s equipment, else dumbbells for a db lift', () => {
    assert.equal(loadKindOf('barbell'), 'barbell');
    assert.equal(loadKindOf(undefined, true), 'dumbbell');
    assert.equal(loadKindOf('bodyweight', true), 'dumbbell');
    assert.equal(loadKindOf('bodyweight'), null);
  });
});

describe('weightsFor and stepInKit stay small and fast on a kit nobody validated', () => {
  it('caps a huge range, a huge stack and odd plates', () => {
    const t0 = Date.now();
    const range = weightsFor('dumbbell', { unit: 'kg', dumbbell: { from: 1, to: 1e9, step: 1 } }, 'kg')!;
    const stack = weightsFor('machine', { unit: 'kg', machine: { step: 0.0001 } }, 'kg');
    const bar = weightsFor('barbell', { unit: 'kg', barbell: { bar: 20, plates: [20, 0.001] } }, 'kg')!;
    assert.ok(range.length <= LOADS.maxWeights, `${range.length} range weights`);
    assert.ok(stack === null || stack.length <= LOADS.maxWeights);
    assert.ok(bar.length <= LOADS.maxWeights, `${bar.length} bar weights`);
    assert.ok(Date.now() - t0 < 500, `${Date.now() - t0} ms`);
  });

  it('stepInKit is about linear: 10,000 weights in well under the old half second', () => {
    const many = Array.from({ length: 10000 }, (_, i) => (i + 1) * 0.5);
    const t0 = Date.now();
    assert.equal(stepInKit(0.3, many), false);
    assert.equal(stepInKit(1.5, many), true);
    assert.ok(Date.now() - t0 < 100, `${Date.now() - t0} ms`);
  });
});
