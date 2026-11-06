// Load units: kg and lb, and rounding to an exercise's load step.

import { explain, type Result } from './reason.ts';
import type { Unit } from './schema.ts';

export const LB_PER_KG = 2.20462;

/** Plain conversion with no rounding (the snippets' `conv`). */
export function convert(weight: number, from: Unit, to: Unit): number {
  return from === to ? weight : from === 'kg' ? weight * LB_PER_KG : weight / LB_PER_KG;
}

export const toKg = (weight: number, unit: Unit): number => convert(weight, unit, 'kg');
export const toLb = (weight: number, unit: Unit): number => convert(weight, unit, 'lb');

/**
 * The nearest multiple of `step`, halves up (the dashboard's `roundTo`).
 * Float noise is trimmed at 6 decimals rather than the dashboard's 1, so a
 * 1.25 step keeps its second decimal.
 */
export function roundToStep(value: number, step: number): number {
  if (!(step > 0)) throw new RangeError(`step must be positive, got ${step}`);
  return Number((Math.round(value / step) * step).toFixed(6));
}

/**
 * Python's `round(x, 1)`: correct rounding of the exact binary value, ties to
 * even. A tie at one decimal happens only for x = odd / 4 (n.25, n.75).
 */
export function roundPy1(x: number): number {
  const q = x * 4; // exact: a power-of-two multiple
  if (Number.isInteger(q) && Math.abs(q % 2) === 1) {
    const down = Math.floor(x * 10); // x * 10 = odd * 2.5, exact
    return (Math.abs(down) % 2 === 0 ? down : down + 1) / 10;
  }
  return Number(x.toFixed(1));
}

/**
 * A weight logged in one unit, in the exercise's unit. A different unit is
 * converted and rounded to the exercise's step, as the dashboard does for a
 * top set logged in the other unit; the same unit is kept as logged.
 */
export function inExerciseUnit(
  weight: number,
  from: Unit,
  exercise: { unit: Unit; increment: number },
): Result<number> {
  const to = exercise.unit;
  if (from === to) {
    return explain(weight, 'units.exercise', { weight, from, to }, { note: 'already in the exercise unit: kept as logged' });
  }
  const raw = convert(weight, from, to);
  const value = roundToStep(raw, exercise.increment);
  return explain(value, 'units.exercise', { weight, from, to, raw, increment: exercise.increment }, {
    threshold: { lbPerKg: LB_PER_KG },
    note: `${weight} ${from} is ${raw.toFixed(2)} ${to}, rounded to the nearest ${exercise.increment} ${to} step`,
  });
}

/**
 * The one conversion rule for a logged set (0.4.0): a weight logged in the
 * exercise's own unit is kept as logged; one logged in the other unit is
 * converted (1 kg = 2.20462 lb) and rounded to the exercise's step, the
 * nearest weight that exercise loads. That value is the set everywhere: shown,
 * progressed from, held against the load cap, and in the e1RM. With no step
 * known, 0.1 (the numbers.md snippets' rounding).
 */
export function weightInUnit(weight: number, from: Unit, exercise: { unit: Unit; increment?: number }): number {
  if (from === exercise.unit) return weight;
  const raw = convert(weight, from, exercise.unit);
  return exercise.increment && exercise.increment > 0 ? roundToStep(raw, exercise.increment) : roundPy1(raw);
}

/** A logged set in the exercise's unit, with the weight and unit as logged kept beside it. */
export interface SetInUnit {
  weight: number;
  unit: Unit;
  reps: number;
  rir?: number;
  logged: { weight: number; unit: Unit };
}

export function setInUnit(set: { weight: number; unit: Unit; reps: number; rir?: number }, exercise: { unit: Unit; increment?: number }): SetInUnit {
  const out: SetInUnit = { weight: weightInUnit(set.weight, set.unit, exercise), unit: exercise.unit, reps: set.reps, logged: { weight: set.weight, unit: set.unit } };
  if (set.rir !== undefined) out.rir = set.rir;
  return out;
}

// ---------------------------------------------------------------- body units

/**
 * Body measures in the profile's units: weight in kg or lb, lengths in cm
 * or in (`units.body` kg: kg and cm; lb: lb and in). The files keep kg and
 * cm; the screens convert on display and on entry, the rules' notes write
 * them in these units.
 */
export type LengthUnit = 'cm' | 'in';
export interface BodyUnits {
  weight: Unit;
  length: LengthUnit;
}
export const METRIC: BodyUnits = { weight: 'kg', length: 'cm' };
export const IMPERIAL: BodyUnits = { weight: 'lb', length: 'in' };
export const CM_PER_IN = 2.54;

/** The body units a profile asks for; kg and cm without one. */
export function bodyUnitsOf(profile: { units?: { body?: Unit } } | null | undefined): Result<BodyUnits> {
  const body = profile?.units?.body;
  const u = body === 'lb' ? IMPERIAL : METRIC;
  return explain(u, 'units.body', { body: body ?? null }, {
    note: body ? `The profile's body unit is ${body}: weight in ${u.weight}, lengths in ${u.length}; the files keep kg and cm.` : 'No body unit in the profile: kg and cm.',
  });
}

/** A weight in kg in the body unit, unrounded. */
export const inWeight = (kg: number, u: BodyUnits): number => (u.weight === 'kg' ? kg : kg * LB_PER_KG);
/** A weight typed in the body unit, in kg, unrounded. */
export const weightKg = (v: number, u: BodyUnits): number => (u.weight === 'kg' ? v : v / LB_PER_KG);
/** A length in cm in the body unit, unrounded. */
export const inLength = (cm: number, u: BodyUnits): number => (u.length === 'cm' ? cm : cm / CM_PER_IN);
/** A length typed in the body unit, in cm, unrounded. */
export const lengthCm = (v: number, u: BodyUnits): number => (u.length === 'cm' ? v : v * CM_PER_IN);

const dp1 = (n: number) => Math.round(n * 10) / 10;
/** "92 cm" as stored (kg and cm are shown as written), or "36.2 in" to one decimal. */
export function lengthText(cm: number, u: BodyUnits): string {
  return u.length === 'cm' ? `${cm} cm` : `${dp1(inLength(cm, u))} in`;
}
/** "83.5 kg" as stored, or "184.1 lb" to one decimal. */
export function weightText(kg: number, u: BodyUnits): string {
  return u.weight === 'kg' ? `${kg} kg` : `${dp1(inWeight(kg, u))} lb`;
}
