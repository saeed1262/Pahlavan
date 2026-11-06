// The four calisthenics ladders the self-check starts (intake.md, "The
// movement self-check"): pull-up, push-up, core and single-leg. Level names
// and details are the vault's plan-data ladders, word for word, so a plan the
// engine writes lines up with the ladders already there. Each level names its
// nearest catalogue movement (what the slot counts and screens) and the reps
// or hold it is done for. Levels are 1-based, as fitness_log.py's `ladder`
// command and the log's ladder history count them.

import type { RepRange } from '../schema.ts';

export interface LadderLevel {
  name: string;
  detail?: string;
  /** The catalogue movement done at this level. */
  exercise: string;
  /** Reps a set, or null for a hold (seconds in `detail`). */
  reps: RepRange | null;
}

export interface Ladder {
  id: 'pullup' | 'pushup' | 'hollow' | 'legs';
  name: string;
  levels: LadderLevel[];
}

export const LADDERS: readonly Ladder[] = [
  {
    id: 'pullup',
    name: 'Pull-up',
    levels: [
      { name: 'Dead hang', detail: '3 × 20–30 s', exercise: 'dead-hang', reps: null },
      { name: 'Scapular pull-up', detail: '3 × 8–10', exercise: 'scapular-pull-up', reps: [8, 10] },
      { name: 'Inverted row', detail: 'bar racked at hip height, 4 × 8–12', exercise: 'inverted-row', reps: [8, 12] },
      { name: 'Negative pull-up', detail: '5-s lowering, 4 × 3–5', exercise: 'negative-pull-up', reps: [3, 5] },
      { name: 'Band-assisted pull-up', detail: '4 × 5–8', exercise: 'assisted-pull-up', reps: [5, 8] },
      { name: 'Pull-up', detail: '4 × 3–8', exercise: 'pull-up', reps: [3, 8] },
      { name: 'Weighted pull-up', detail: '+10 lb, dumbbell between the feet, 4 × 3–6', exercise: 'pull-up', reps: [3, 6] },
      { name: 'L-sit pull-up', detail: 'legs straight out in front, 4 × 3–6', exercise: 'pull-up', reps: [3, 6] },
    ],
  },
  {
    id: 'pushup',
    name: 'Push-up',
    levels: [
      { name: 'Incline push-up', detail: 'hands on a bench', exercise: 'incline-push-up', reps: [8, 15] },
      { name: 'Floor push-up', exercise: 'push-up', reps: [6, 12] },
      { name: 'Tempo push-up', detail: '3 s down', exercise: 'push-up', reps: [6, 10] },
      { name: 'Deficit push-up', detail: 'hands on plates', exercise: 'push-up', reps: [6, 10] },
      { name: 'Archer push-up', detail: '4 × 4–6/side', exercise: 'push-up', reps: [4, 6] },
      { name: 'Pike push-up', detail: 'hips high, head toward the hands, 4 × 6–10', exercise: 'pike-push-up', reps: [6, 10] },
      { name: 'Elevated pike push-up', detail: 'feet on a bench, 4 × 5–8', exercise: 'pike-push-up', reps: [5, 8] },
      { name: 'Wall handstand push-up', detail: 'back to the wall, lower to a folded mat, 4 × 2–5', exercise: 'pike-push-up', reps: [2, 5] },
    ],
  },
  {
    id: 'hollow',
    name: 'Core (abs)',
    levels: [
      { name: 'Dead bug', exercise: 'dead-bug', reps: [8, 12] },
      { name: 'Tuck hollow hold', exercise: 'hollow-hold', reps: null },
      { name: 'Hollow hold, arms by sides', exercise: 'hollow-hold', reps: null },
      { name: 'Hollow hold, arms overhead', exercise: 'hollow-hold', reps: null },
      { name: 'Hollow rocks', exercise: 'hollow-hold', reps: null },
      { name: 'Tuck L-sit', detail: 'hands on a bench or parallettes, 5 × 10–20 s', exercise: 'hollow-hold', reps: null },
      { name: 'One-leg L-sit', detail: '5 × 10–15 s', exercise: 'hollow-hold', reps: null },
      { name: 'L-sit', detail: '5 × 10 s', exercise: 'hollow-hold', reps: null },
    ],
  },
  {
    id: 'legs',
    name: 'Single-leg squat',
    levels: [
      { name: 'Split squat', exercise: 'split-squat', reps: [8, 12] },
      { name: 'Bulgarian split squat', detail: 'bodyweight', exercise: 'split-squat', reps: [8, 12] },
      { name: 'Box pistol, high box', exercise: 'box-pistol', reps: [5, 8] },
      { name: 'Box pistol, low box', exercise: 'box-pistol', reps: [5, 8] },
      { name: 'Assisted pistol', detail: 'hold a post', exercise: 'box-pistol', reps: [4, 6] },
      { name: 'Pistol', exercise: 'pistol-squat', reps: [3, 5] },
      { name: 'Shrimp squat', detail: '4 × 4–6/leg', exercise: 'pistol-squat', reps: [4, 6] },
      { name: 'Weighted pistol', detail: 'a 10–20 lb plate held in front, 4 × 4–6/leg', exercise: 'pistol-squat', reps: [4, 6] },
    ],
  },
];

export const LADDER_BY_ID: ReadonlyMap<string, Ladder> = new Map(LADDERS.map((l) => [l.id, l]));
