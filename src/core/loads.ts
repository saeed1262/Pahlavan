// The gym's real weights (profile.loads): every load each kind of kit can
// make, and a target moved onto one of them. A barbell is the bar plus pairs
// of plates, a stack goes up in steps, dumbbells and kettlebells are the ones
// there are. Pure: no clock, no I/O.

import type { GymLoads, Unit, WeightSet } from './schema.ts';
import { convert } from './units.ts';

/** The kinds of kit `profile.loads` describes, by catalogue equipment id. */
export const LOAD_KINDS = ['dumbbell', 'kettlebell', 'barbell', 'trap-bar', 'machine', 'cable'] as const;
export type LoadKind = (typeof LOAD_KINDS)[number];

export const LOADS = {
  /** The heaviest load Pahlavan reads (and lists for a barbell or a stack with no top of its own). */
  maxKg: 500,
  maxLb: 1100,
  /** The smallest step or plate Pahlavan reads (validate.ts holds the profile to it). */
  minStepKg: 0.25,
  minStepLb: 0.5,
  /** At most this many weights in a dumbbell or kettlebell range or list (validate.ts). */
  maxListed: 200,
  /** A bar's loads go up to this many times its whole set of plates a side. */
  platesPerSide: 4,
  /** At most this many weights for any kind, and grid cells for a bar's plate sums, whatever the profile says. */
  maxWeights: 2000,
  maxBarCells: 20000,
  /** Two loads closer than this are the same weight. */
  eps: 1e-6,
} as const;

export const isLoadKind = (k: unknown): k is LoadKind => typeof k === 'string' && (LOAD_KINDS as readonly string[]).includes(k);

/** Numbers in thousandths, as integers: plate sums and steps without float noise. */
const SCALE = 1000;
const milli = (x: number) => Math.round(x * SCALE);
const fromMilli = (n: number) => n / SCALE;
const trim = (x: number) => Number(x.toFixed(6));

function gcdInt(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x;
}

/**
 * The greatest common divisor of two decimal steps (0.5 and 1.25 give 0.25),
 * worked in thousandths so float noise never shrinks it. A step finer than a
 * thousandth counts as the other step alone.
 */
export function gcdStep(a: number, b: number): number {
  const g = gcdInt(milli(a), milli(b));
  return g > 0 ? fromMilli(g) : Math.max(a, b);
}

const sortUnique = (xs: readonly number[]) => {
  const out: number[] = [];
  for (const x of [...xs].sort((a, b) => a - b)) if (!out.length || x - out.at(-1)! > LOADS.eps) out.push(x);
  return out;
};

/** A range from `from` to `to` by `step`, both ends included when they fall on a step; at most `maxWeights` of them. */
function range(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  const s = milli(step);
  if (s <= 0) return out;
  for (let n = milli(from); n <= milli(to) && out.length < LOADS.maxWeights; n += s) out.push(fromMilli(n));
  return out;
}

function setWeights(w: WeightSet): number[] {
  if (w.weights) return sortUnique(w.weights.filter((x) => x > 0)).slice(0, LOADS.maxWeights);
  if (w.from === undefined || w.to === undefined || w.step === undefined) return [];
  return range(w.from, w.to, w.step);
}

/**
 * A bar's loads: the bar plus a pair of plates for each plate on a side, as
 * many of each as fit, up to `platesPerSide` times the whole set a side and
 * never over the heaviest load (500 kg, 1100 lb); the sums are worked on a
 * grid of the plates' common divisor, at most `maxBarCells` of it.
 */
function barWeights(bar: number, plates: readonly number[], unit: Unit): number[] {
  const ps = [...new Set(plates.filter((p) => p > 0).map(milli))].filter((p) => p > 0);
  if (!ps.length) return [bar];
  const sum = ps.reduce((a, b) => a + b, 0);
  const max = unit === 'kg' ? LOADS.maxKg : LOADS.maxLb;
  const side = Math.min(sum * LOADS.platesPerSide, Math.max(0, Math.floor((milli(max) - milli(bar)) / 2)));
  const g = ps.reduce(gcdInt);
  const cells = Math.min(Math.floor(side / g), LOADS.maxBarCells);
  // What one side can hold: every sum of plates (any number of each), on the grid of their common divisor.
  const can = new Uint8Array(cells + 1);
  can[0] = 1;
  for (let i = 1; i <= cells; i++) for (const p of ps) if (i * g >= p && can[(i * g - p) / g]) { can[i] = 1; break; }
  const out: number[] = [];
  for (let i = 0; i <= cells && out.length < LOADS.maxWeights; i++) if (can[i]) out.push(fromMilli(milli(bar) + 2 * i * g));
  return out;
}

function stackWeights(step: number, from: number | undefined, to: number | undefined, unit: Unit): number[] {
  const max = to ?? (unit === 'kg' ? LOADS.maxKg : LOADS.maxLb);
  return range(from ?? step, max, step);
}

/**
 * The real weights for one kind of kit, lightest first, in `unit` (the
 * lift's): converted from the kit's unit when they differ, to 0.1. Null when
 * the profile lists no kit of that kind: the lift keeps its plan step.
 */
export function weightsFor(kind: string | undefined, loads: GymLoads | null | undefined, unit: Unit): number[] | null {
  if (!loads || !isLoadKind(kind)) return null;
  let own: number[] = [];
  if (kind === 'dumbbell' || kind === 'kettlebell') {
    const w = loads[kind];
    if (!w) return null;
    own = setWeights(w);
  } else if (kind === 'barbell') {
    const b = loads.barbell;
    if (!b) return null;
    own = barWeights(b.bar, b.plates, loads.unit);
  } else if (kind === 'trap-bar') {
    const t = loads['trap-bar'];
    const plates = t?.plates ?? loads.barbell?.plates;
    if (!t || !plates) return null;
    own = barWeights(t.bar, plates, loads.unit);
  } else {
    const s = loads[kind];
    if (!s) return null;
    own = stackWeights(s.step, s.from, s.to, loads.unit);
  }
  const out = loads.unit === unit ? own : sortUnique(own.map((w) => Math.round(convert(w, loads.unit, unit) * 10) / 10));
  return out.length ? out : null;
}

export type SnapDirection = 'up' | 'down';

export interface Snapped {
  weight: number;
  /** Up, with no real weight above the base: the heaviest there is, held (reps carry the progression). */
  ceiling: boolean;
  /** Down, with no real weight below the base: the lightest there is. */
  floor: boolean;
}

/**
 * A target moved onto the gym's real weights, from `base` (the last weight)
 * in `direction`. Up: the real weight nearest the target that is above the
 * base (a target at or under the base gives the next one up); none above
 * gives the heaviest, flagged `ceiling`. Down: the real weight nearest the
 * target that is under the base (a target at or over the base gives the next
 * one down); none under gives the lightest, flagged `floor`. A tie goes to
 * the weight nearer the base: the smaller jump, the gentler drop.
 */
export function snapLoad(target: number, base: number, direction: SnapDirection, weights: readonly number[]): Snapped {
  const ws = sortUnique(weights);
  if (!ws.length) return { weight: trim(target), ceiling: false, floor: false };
  const eps = LOADS.eps;
  const pool = direction === 'up' ? ws.filter((w) => w > base + eps) : ws.filter((w) => w < base - eps);
  if (!pool.length) {
    return direction === 'up' ? { weight: ws.at(-1)!, ceiling: true, floor: false } : { weight: ws[0]!, ceiling: false, floor: true };
  }
  let best = pool[0]!;
  for (const w of pool) {
    const d = Math.abs(w - target);
    const b = Math.abs(best - target);
    if (d < b - eps || (Math.abs(d - b) <= eps && Math.abs(w - base) < Math.abs(best - base))) best = w;
  }
  return { weight: best, ceiling: false, floor: false };
}

/** The heaviest real weight at or under a value, or null when every one is heavier. */
export function atOrUnder(value: number, weights: readonly number[]): number | null {
  return sortUnique(weights).filter((w) => w <= value + LOADS.eps).at(-1) ?? null;
}

/** The next real weight above (`up`) or under (`down`) a value, or null at the end of the list. */
export function nextWeight(value: number, direction: SnapDirection, weights: readonly number[]): number | null {
  const ws = sortUnique(weights);
  const eps = LOADS.eps;
  return direction === 'up' ? (ws.find((w) => w > value + eps) ?? null) : (ws.filter((w) => w < value - eps).at(-1) ?? null);
}

/** Whether a weight is one the gym has. */
export const isRealWeight = (w: number, weights: readonly number[]): boolean => weights.some((x) => Math.abs(x - w) <= 0.05 + LOADS.eps);

/**
 * The kind of kit a lift is loaded with: the catalogue's first equipment id
 * when it is one `loads` describes, else dumbbells for a plan-data lift
 * marked `db`; null for anything else (it keeps its plan step).
 */
export function loadKindOf(equipment: string | undefined, db?: boolean): LoadKind | null {
  if (isLoadKind(equipment)) return equipment;
  return db === true ? 'dumbbell' : null;
}

/** A kind of kit in words, for the notes ("the heaviest dumbbell here is 30 kg"). */
export const KIT_WORDS: Record<LoadKind, string> = {
  dumbbell: 'dumbbell',
  kettlebell: 'kettlebell',
  barbell: 'barbell load',
  'trap-bar': 'trap-bar load',
  machine: 'machine load',
  cable: 'cable load',
};

/** "dumbbell", or "weight" when the kind is not known. */
export const kitWord = (kind: LoadKind | null | undefined): string => (kind ? KIT_WORDS[kind] : 'weight');

/**
 * The smallest gap between two real weights (2 for dumbbells in 2 kg
 * steps, 2.5 for a bar with 1.25 plates): the finest step the kit allows.
 */
export function finestStep(weights: readonly number[]): number | null {
  const ws = sortUnique(weights);
  let best: number | null = null;
  for (let i = 1; i < ws.length; i++) {
    const d = trim(ws[i]! - ws[i - 1]!);
    if (best === null || d < best) best = d;
  }
  return best;
}

/**
 * Whether a lift's `inc` is a step the kit can make: some real weight plus
 * `inc` is also a real weight (to 0.05, for converted units). Linear: the
 * weights in hundredths, each looked up once.
 */
export function stepInKit(inc: number, weights: readonly number[]): boolean {
  const keys = new Set(weights.map((w) => Math.round(w * 100)));
  for (const w of weights) {
    const at = Math.round((w + inc) * 100);
    for (let d = -5; d <= 5; d++) if (keys.has(at + d)) return true;
  }
  return false;
}
