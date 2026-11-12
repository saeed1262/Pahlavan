// Movement identity and overlap (src/report/overlap.ts): what counts as a
// movement, the one identity two plans are compared by, the share of one
// plan's movements another holds (both ways), and a plan's shape.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { engineFacts } from '../src/cli/cli.ts';
import { limitText, movementOf, OVERLAP_WARN_ABOVE, overLimit, overlapShare, percent, planMovements, planShape, sharedMovements } from '../src/report/overlap.ts';
import { VAULT } from './helpers.ts';

type Json = Record<string, any>;
const fixturePlan = () => JSON.parse(readFileSync(join(VAULT, '3-Personal', 'Fitness', 'plan-data.json'), 'utf8')) as Json;
const plan = (sessions: Record<string, Json[]>, extra: Json = {}): Json => ({ liftTypes: Object.keys(sessions), shortTypes: [], sessions, ...extra });
const ids = (p: unknown) => planMovements(p).map((m) => m.id);

describe('overlap: a movement and its identity', () => {
  it('a ladder item is its ladder, whatever its level or name', () => {
    assert.deepEqual(movementOf({ name: 'Push-up (your level)', ladder: 'pushup' }), { id: 'pushup', source: 'ladder' });
    assert.equal(overlapShare(planMovements(plan({ S1: [{ name: 'Push-up (your level)', sr: '4 × 8', ladder: 'pushup' }] })), planMovements(plan({ S2: [{ name: 'Push-ups', sr: '3 × 10', ladder: 'pushup' }] }))), 1);
  });

  it('a catalogue movement is its catalogue id, across its names and the common gym names', () => {
    const variants = ['Flat DB Bench Press', 'Dumbbell bench press', 'db bench', 'Dumbbell Bench Press (flat)'];
    for (const name of variants) assert.deepEqual(movementOf({ name }), { id: 'db-bench', source: 'catalogue' }, name);
    const a = planMovements(plan({ A: [{ name: 'Flat DB Bench Press', sr: '3 × 8' }] }));
    const b = planMovements(plan({ X: [{ name: 'Dumbbell bench press', sr: '4 × 10' }] }));
    assert.equal(overlapShare(a, b), 1);
    assert.deepEqual(sharedMovements(a, b).map((m) => m.name), ['Flat DB Bench Press'], 'named as the first plan writes it');
  });

  it('a movement the catalogue does not know is its name, normalized as the catalogue match reads names', () => {
    assert.deepEqual(movementOf({ name: 'Cuban Press!' }), { id: 'cuban press', source: 'name' });
    assert.deepEqual(movementOf({ name: '  cuban   PRESS ' }), { id: 'cuban press', source: 'name' });
  });

  it('leaves out timed items (the field, minutes in the sr, intervals in the note) and cardio', () => {
    assert.equal(movementOf({ name: 'Goblet Squat', timed: { minutes: 10 } }), null, 'a timed field');
    assert.equal(movementOf({ name: 'Handstand practice', sr: '6 min' }), null, 'minutes in the sr');
    assert.equal(movementOf({ name: 'Hill sprints', sr: '1 block', note: '6 × 1 min hard, 2 min easy between.' }), null, 'intervals in the note');
    assert.equal(movementOf({ name: 'Zone 2 finisher', sr: '1 block' }), null, 'cardio in the catalogue, timed or not');
    assert.deepEqual(movementOf({ name: 'Side Plank', sr: '3 × 20–40 s/side' }), { id: 'side-plank', source: 'catalogue' }, 'a hold in sets is a movement');
    assert.deepEqual(movementOf({ name: 'Circuit: squat jump · burpee', sr: '4 rounds, 40/20' }), { id: 'circuit squat jump burpee', source: 'name' }, 'rounds are not minutes');
  });

  it('lists each movement once, in the plan\'s order, with every session that holds it', () => {
    const p = plan({ A: [{ name: 'Goblet Squat', sr: '3 × 8' }, { name: 'Face Pull', sr: '3 × 15' }], B: [{ name: 'goblet squat', sr: '3 × 10' }, { name: 'Zone 2 finisher', sr: '10 min' }, { sr: '3 × 8' }] });
    assert.deepEqual(planMovements(p), [
      { id: 'goblet-squat', name: 'Goblet Squat', source: 'catalogue', sessions: ['A', 'B'] },
      { id: 'face-pull', name: 'Face Pull', source: 'catalogue', sessions: ['A'] },
    ]);
  });

  it('reads the fixture plan: its catalogue movements, the push-up ladder by id, no cardio and nothing timed (the handstand ladder\'s 6 min is)', () => {
    assert.deepEqual(ids(fixturePlan()), ['goblet-squat', 'db-bench', 'face-pull', 'band-external-rotation', 'rdl', 'seated-cable-row', 'bulgarian-split-squat', 'side-plank', 'pushup', 'dead-bug', 'circuit squat jump burpee']);
  });
});

describe('overlap: the share', () => {
  it('is |A ∩ B| / |A|, so not symmetric', () => {
    const small = planMovements(plan({ A: [{ name: 'Goblet Squat', sr: '3 × 8' }, { name: 'Face Pull', sr: '3 × 15' }] }));
    const big = planMovements(plan({ A: [{ name: 'Goblet Squat', sr: '3 × 8' }, { name: 'Face Pull', sr: '3 × 15' }, { name: 'Romanian Deadlift', sr: '3 × 8' }, { name: 'Seated Cable Row', sr: '3 × 10' }] }));
    assert.equal(overlapShare(small, big), 1);
    assert.equal(overlapShare(big, small), 0.5);
    assert.deepEqual(sharedMovements(big, small).map((m) => m.id), ['goblet-squat', 'face-pull']);
    // Sets of ids work too.
    assert.equal(overlapShare(new Set(['a', 'b', 'c']), new Set(['a'])), 1 / 3);
  });

  it('is null for a plan with no movements (a blank draft), and 0 against one', () => {
    const blank = planMovements({ liftTypes: [], shortTypes: [], sessions: {} });
    assert.deepEqual(blank, []);
    assert.equal(overlapShare(blank, planMovements(fixturePlan())), null);
    assert.equal(overlapShare(planMovements(fixturePlan()), blank), 0);
    assert.deepEqual(planMovements(null), []);
    assert.deepEqual(planMovements({ sessions: 'none' }), []);
  });

  it('warns over half: the limit is one constant, in the engine facts', () => {
    assert.equal(OVERLAP_WARN_ABOVE, 0.5);
    assert.deepEqual(engineFacts().redesign, { overlapWarnAbove: OVERLAP_WARN_ABOVE });
    assert.deepEqual([overLimit(0.5), overLimit(0.51), overLimit(null), overLimit(1)], [false, true, false, true]);
    assert.deepEqual([limitText(), percent(10 / 13)], ['half', '77%']);
  });
});

describe('overlap: a plan\'s shape', () => {
  it('lifting days, lifting sessions, and each session\'s pattern order (null for a movement the catalogue does not know)', () => {
    const s = planShape(fixturePlan());
    assert.equal(s.liftDays, 3);
    assert.equal(s.liftSessions, 2);
    assert.deepEqual(s.sessions.map((x) => [x.type, x.kind]), [['A', 'lift'], ['B', 'lift'], ['S1', 'short'], ['S3', 'short']]);
    assert.deepEqual(s.sessions[0]!.patterns, ['squat', 'horizontal-push', 'rear-delt', 'rear-delt', 'conditioning']);
    // A ladder item whose name the catalogue does not match takes its ladder's levels' pattern.
    assert.deepEqual(s.sessions[2]!.patterns, ['skill', 'horizontal-push', 'core-anti-extension']);
    assert.deepEqual(s.sessions[3]!.patterns, [null, 'conditioning']);
  });

  it('an unlisted session has no kind, and a plan with no week target no lifting days', () => {
    const s = planShape({ liftTypes: ['A'], sessions: { A: [], Old: [{ name: 'Cuban Press', sr: '2 × 12' }] } });
    assert.deepEqual([s.liftDays, s.liftSessions, s.sessions], [null, 1, [{ type: 'A', kind: 'lift', patterns: [] }, { type: 'Old', kind: null, patterns: [null] }]]);
  });
});
