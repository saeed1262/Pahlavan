// A made-up day for the gym page (no one's real data): a lifting session with
// a warm-up, a loaded lift with a target, a bodyweight lift, a loaded row
// swapped for an injury limit with no target yet (a start note), a superset,
// a timed hold and a Zone 2 finisher; its Express variant; and a short
// skills day. The page's
// screenshots and tests open it; `node tools/build-gym.mjs --sample` prints
// a link to the built page with it.

import type { GymData, GymSet } from '../../src/core/gym.ts';

const sets = (n: number, weight: number | null, reps: number | null): GymSet[] => Array.from({ length: n }, () => ({ weight, reps, rir: null }));

export const SAMPLE: GymData = {
  v: 1,
  date: '2026-11-10',
  next: 'A',
  sessions: [
    {
      type: 'A',
      name: 'Full Body A',
      kind: 'lift',
      mode: 'full',
      cardio: 15,
      cardioMode: 'bike',
      minutes: 60,
      rows: [
        { key: '0:Warm-up', line: 'Warm-up', name: 'Warm-up', planned: null, swap: null, kind: 'warmup', sr: '5 min easy bike, 2 ramp-up sets', sets: 1, range: null, rir: null, lift: null, unit: 'lb', step: 5, rest: null, restText: null, target: null, note: null, last: null, rows: [] },
        { key: '1:Barbell Back Squat', line: 'Barbell Back Squat', name: 'Barbell Back Squat', planned: null, swap: null, kind: 'load', sr: '3 × 5–8', sets: 3, range: [5, 8], rir: 2, lift: 0, unit: 'lb', step: 5, rest: 180, restText: '3 min', target: { weight: 120, reps: 6, rir: 2 }, note: null, last: { weight: 115, unit: 'lb', reps: 6, date: '2026-11-06' }, rows: sets(3, 120, 6) },
        { key: '2:Pull-up', line: 'Pull-up', name: 'Pull-up', planned: null, swap: null, kind: 'reps', sr: '3 × 5–8', sets: 3, range: [5, 8], rir: 2, lift: 1, unit: 'lb', step: 5, rest: 120, restText: '2 min', target: { weight: null, reps: 7, rir: 2 }, note: null, last: { weight: 0, unit: 'lb', reps: 6, date: '2026-11-06' }, rows: sets(3, null, 7) },
        { key: '3:Dumbbell Bench Press', line: 'Dumbbell Bench Press', name: 'Dumbbell Floor Press', planned: 'Dumbbell Bench Press', swap: 'ledger', kind: 'load', sr: '3 × 8–10', sets: 3, range: [8, 10], rir: 3, lift: null, unit: 'lb', step: 5, rest: 120, restText: '2 min', target: null, note: 'pick a weight for 8–10 reps at RIR 3', last: null, rows: sets(3, null, 8) },
        {
          key: '4:Face Pull + Band External Rotation',
          line: 'Face Pull + Band External Rotation',
          name: 'Face Pull + Band External Rotation',
          planned: null,
          swap: null,
          kind: 'load',
          sr: '2 × 12–15 each',
          sets: 2,
          range: [12, 15],
          rir: 2,
          lift: null,
          unit: 'lb',
          step: 5,
          rest: 90,
          restText: '90 s after each pair',
          target: null,
          note: null,
          last: null,
          rows: [],
          parts: [
            { name: 'Face Pull', planned: null, swap: null, kind: 'load', sets: 2, range: [12, 15], unit: 'lb', step: 5, target: { weight: 30, reps: 12, rir: 2 }, last: { weight: 30, unit: 'lb', reps: 12, date: '2026-11-06' }, rows: sets(2, 30, 12) },
            { name: 'Band External Rotation', planned: null, swap: null, kind: 'reps', sets: 2, range: [12, 15], unit: 'lb', step: 5, target: null, last: { weight: 0, unit: 'lb', reps: 15, date: '2026-11-06' }, rows: sets(2, null, 15) },
          ],
        },
        { key: '5:Side Plank', line: 'Side Plank', name: 'Side Plank', planned: null, swap: null, kind: 'timed', sr: '2 × 30 s', sets: 2, range: null, rir: null, lift: null, unit: 'lb', step: 5, rest: 45, restText: '45 s', target: null, note: '30 s each side, hips high', last: { weight: 0, unit: 'lb', reps: 30, date: '2026-11-06' }, rows: sets(2, null, 30) },
        { key: '6:Zone 2 finisher', line: 'Zone 2 finisher', name: 'Zone 2 bike', planned: null, swap: null, kind: 'cardio', sr: '15 min easy', sets: 1, range: null, rir: null, lift: null, unit: 'lb', step: 5, rest: null, restText: null, target: null, note: 'easy enough to talk in full sentences', last: null, rows: [], finisher: true },
      ],
    },
    {
      type: 'A',
      name: 'Full Body A · Express',
      kind: 'lift',
      mode: 'express',
      cardio: 0,
      cardioMode: null,
      minutes: 30,
      rows: [
        { key: '0:Warm-up', line: 'Warm-up', name: 'Warm-up', planned: null, swap: null, kind: 'warmup', sr: '3 min easy, 1 ramp-up set', sets: 1, range: null, rir: null, lift: null, unit: 'lb', step: 5, rest: null, restText: null, target: null, note: null, last: null, rows: [] },
        { key: '1:Barbell Back Squat', line: 'Barbell Back Squat', name: 'Barbell Back Squat', planned: null, swap: null, kind: 'load', sr: '2 × 5–8', sets: 2, range: [5, 8], rir: 2, lift: 0, unit: 'lb', step: 5, rest: 150, restText: '2–3 min', target: { weight: 120, reps: 6, rir: 2 }, note: null, last: { weight: 115, unit: 'lb', reps: 6, date: '2026-11-06' }, rows: sets(2, 120, 6) },
        { key: '2:Pull-up', line: 'Pull-up', name: 'Pull-up', planned: null, swap: null, kind: 'reps', sr: '2 × 5–8', sets: 2, range: [5, 8], rir: 2, lift: 1, unit: 'lb', step: 5, rest: 120, restText: '2 min', target: { weight: null, reps: 7, rir: 2 }, note: null, last: { weight: 0, unit: 'lb', reps: 6, date: '2026-11-06' }, rows: sets(2, null, 7) },
      ],
    },
    {
      type: 'S1',
      name: 'Short 1 · Skills',
      kind: 'short',
      mode: 'full',
      cardio: 0,
      cardioMode: null,
      minutes: 20,
      rows: [
        { key: '0:Warm-up', line: 'Warm-up', name: 'Warm-up', planned: null, swap: null, kind: 'warmup', sr: 'wrists and shoulders, 3 min', sets: 1, range: null, rir: null, lift: null, unit: 'kg', step: 2.5, rest: null, restText: null, target: null, note: null, last: null, rows: [] },
        { key: '1:Chest-to-wall Handstand', line: 'Chest-to-wall Handstand', name: 'Chest-to-wall Handstand', planned: null, swap: null, kind: 'timed', sr: '4 × 20 s', sets: 4, range: null, rir: null, lift: null, unit: 'kg', step: 2.5, rest: 60, restText: '1 min', target: null, note: null, last: { weight: 0, unit: 'kg', reps: 20, date: '2026-11-08' }, rows: sets(4, null, 20) },
        { key: '2:Floor Push-up', line: 'Floor Push-up', name: 'Floor Push-up', planned: null, swap: null, kind: 'reps', sr: '3 × 8–12', sets: 3, range: [8, 12], rir: 2, lift: null, unit: 'kg', step: 2.5, rest: 90, restText: '90 s', target: null, note: null, last: { weight: 0, unit: 'kg', reps: 10, date: '2026-11-08' }, rows: sets(3, null, 10) },
      ],
    },
  ],
};
