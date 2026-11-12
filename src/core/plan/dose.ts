// A set's own time, the rest between sets, and the patterns counted as
// isolation and core work: what session times, the plan check and the
// evidence library read.

import type { Pattern } from '../data/exercises.ts';

export const DOSE = {
  /** A set's own time (the work, not the rest after it), minutes. */
  workMinutes: 0.5,
} as const;

export const ISOLATION: ReadonlySet<Pattern> = new Set(['biceps', 'triceps', 'lateral-raise', 'rear-delt', 'calves', 'neck-upper-back', 'hip-abduction', 'chest-fly']);
export const CORE: ReadonlySet<Pattern> = new Set(['core-anti-extension', 'core-anti-rotation', 'core-flexion']);

/**
 * Rest between sets (rules.md, "Load, rest, order and range of motion"): at
 * least 90 s between sets, since past 90 s size gains show no clear
 * difference; 2-3 min on heavy compound lifts; a superset of non-competing
 * muscles, when time is the limit, rests 90 s after each pair. `minutes` is
 * what a session's time counts (the low end of 2-3 min).
 */
export const REST = {
  heavy: { text: '2-3 min', minutes: 2, range: [2, 3] },
  sets: { text: '90 s', minutes: 1.5 },
  pair: { text: '90 s after each pair', minutes: 1.5 },
} as const;
