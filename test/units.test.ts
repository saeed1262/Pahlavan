import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { convert, inExerciseUnit, LB_PER_KG, roundPy1, roundToStep, toKg, toLb, weightInUnit } from '../src/core/units.ts';
import { approx } from './helpers.ts';

describe('units', () => {
  it('converts with 1 kg = 2.20462 lb', () => {
    assert.equal(LB_PER_KG, 2.20462);
    approx(convert(100, 'kg', 'lb'), 220.462);
    approx(convert(220.462, 'lb', 'kg'), 100);
    assert.equal(convert(52.5, 'kg', 'kg'), 52.5);
    approx(toKg(45, 'lb'), 20.411681, 1e-6);
    approx(toLb(20, 'kg'), 44.0924);
    assert.equal(toKg(20, 'kg'), 20);
  });

  it('rounds to 2.5 kg plate steps, halves up', () => {
    assert.equal(roundToStep(47.3, 2.5), 47.5);
    assert.equal(roundToStep(46.2, 2.5), 45);
    assert.equal(roundToStep(48.75, 2.5), 50); // exactly half: up
    assert.equal(roundToStep(72, 2.5), 72.5);
    assert.equal(roundToStep(74.25, 2.5), 75);
  });

  it('rounds to 5 lb dumbbell steps, halves up', () => {
    assert.equal(roundToStep(52, 5), 50);
    assert.equal(roundToStep(52.5, 5), 55);
    assert.equal(roundToStep(57.4, 5), 55);
    assert.equal(roundToStep(44.0924, 5), 45);
  });

  it('keeps fine steps without float noise', () => {
    assert.equal(roundToStep(61.3, 1.25), 61.25);
    assert.equal(roundToStep(0.1 * 3, 0.1), 0.3);
    assert.throws(() => roundToStep(10, 0), RangeError);
  });

  it("matches Python's round(x, 1), ties to even", () => {
    assert.equal(roundPy1(22.25), 22.2);
    assert.equal(roundPy1(22.75), 22.8);
    assert.equal(roundPy1(0.15), 0.1); // 0.15 is just under in binary
    assert.equal(roundPy1(45.35), 45.4); // just over in binary
    assert.equal(roundPy1(22.5 * LB_PER_KG), 49.6);
    assert.equal(roundPy1(140 / LB_PER_KG), 63.5);
  });

  it('converts a weight into the exercise unit and rounds to its step', () => {
    const lbDumbbell = { unit: 'lb' as const, increment: 5 };
    const kgBar = { unit: 'kg' as const, increment: 2.5 };
    assert.equal(inExerciseUnit(20, 'kg', lbDumbbell).value, 45); // 44.09 lb
    assert.equal(inExerciseUnit(25, 'kg', lbDumbbell).value, 55); // 55.12 lb
    assert.equal(inExerciseUnit(50, 'lb', kgBar).value, 22.5); // 22.68 kg
    assert.equal(inExerciseUnit(132, 'lb', kgBar).value, 60); // 59.87 kg
    const same = inExerciseUnit(52, 'lb', lbDumbbell);
    assert.equal(same.value, 52); // same unit: kept as logged, even off the step
    assert.equal(same.reason.rule, 'units.exercise');
    assert.match(same.reason.note ?? '', /kept as logged/);
  });
});

describe('weightInUnit on the gym\'s real weights', () => {
  it('a set logged in the other unit lands on the nearest real weight, not the step', () => {
    const lb = { unit: 'lb' as const, increment: 5, weights: [39.7, 44.1, 49.6, 55.1] };
    assert.equal(weightInUnit(22.5, 'kg', lb), 49.6);
    assert.equal(weightInUnit(22.5, 'kg', { unit: 'lb', increment: 5 }), 50, 'without weights, the step');
    assert.equal(weightInUnit(50, 'lb', lb), 50, 'the same unit is kept as logged');
  });
});
