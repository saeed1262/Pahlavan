// The back-to-back rule (concurrent.ts): one muscle hard on two days running
// is allowed only when the second day is the lighter one for it. `review`
// reads the written plan (or a draft) through the same rule (liftItem,
// backToBack).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { backToBack, checkConcurrent, CONCURRENT, liftItem, type PlannedSession } from '../src/core/concurrent.ts';
import type { Exercise, RepRange } from '../src/core/schema.ts';
import { buildReview } from '../src/report/review.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

const EX: Record<string, Exercise> = {
  squat: { name: 'Squat', pattern: 'squat', unit: 'kg', increment: 2.5, muscles: { main: ['quads', 'glutes'], helps: [] } },
  goblet: { name: 'Goblet squat', pattern: 'squat', unit: 'kg', increment: 2.5, muscles: { main: ['quads', 'glutes'], helps: [] } },
  incline: { name: 'Incline press', pattern: 'horizontal-push', unit: 'kg', increment: 2.5, muscles: { main: ['chest', 'shoulders'], helps: ['triceps'] } },
  pushup: { name: 'Deficit push-up', pattern: 'horizontal-push', unit: 'kg', increment: 2.5, muscles: { main: ['chest'], helps: ['triceps'] } },
  raise: { name: 'Lateral raise', pattern: 'lateral-raise', unit: 'kg', increment: 1, muscles: { main: ['shoulders'], helps: [] } },
  plank: { name: 'Plank', pattern: 'core-anti-extension', kind: 'timed', muscles: { main: ['abs'], helps: [] } },
};
const slot = (exercise: string, repRange: RepRange, rir: number, main = false) => liftItem({ exercise, sets: 3, repRange, rir, main }, EX[exercise]);
const day = (id: string, d: number, ...items: ReturnType<typeof slot>[]): PlannedSession => ({ id, day: d, items });

describe('liftItem: what counts as hard', () => {
  it('a main lift or a compound pattern near failure; not isolation, holds or RIR 4 and up', () => {
    assert.equal(slot('squat', [6, 6], 2).hard, true);
    assert.equal(slot('raise', [12, 15], 1).hard, false, 'isolation');
    assert.equal(slot('raise', [12, 15], 1, true).hard, true, 'a main lift is hard whatever its pattern');
    assert.equal(slot('plank', [1, 1], 2).hard, false, 'a hold');
    assert.equal(slot('squat', [6, 6], CONCURRENT.hardRir).hard, true);
    assert.equal(slot('squat', [6, 6], CONCURRENT.hardRir + 1).hard, false, 'RIR 4: about RPE 6, not hard');
    assert.deepEqual([slot('squat', [8, 12], 2).repRange, slot('squat', [8, 12], 2).rir], [[8, 12], 2]);
  });
});

describe('backToBack: the second day lighter for the muscle', () => {
  it('allows a heavy day followed by its lighter day, with both loads in the reason', () => {
    const r = backToBack([day('A', 0, slot('squat', [6, 6], 2, true)), day('B', 1, slot('goblet', [10, 15], 3, true))], EX);
    assert.deepEqual(r.map((x) => [x.value.muscle, x.value.firstLoad, x.value.secondLoad, x.value.lighter]), [['quads', 8, 13, true], ['glutes', 8, 13, true]]);
    assert.equal(r[0]!.reason.rule, 'concurrent.back-to-back');
    assert.match(r[0]!.reason.note ?? '', /B is the lighter day for it .*about 13 reps, against 8 the day before/);
    assert.deepEqual(checkConcurrent([day('A', 0, slot('squat', [6, 6], 2, true)), day('B', 1, slot('goblet', [10, 15], 3, true))], EX), []);
  });

  it('flags a lighter day followed by a heavy one (the rules allow only heavy, then lighter)', () => {
    const f = checkConcurrent([day('B', 0, slot('goblet', [10, 15], 3, true)), day('C', 1, slot('squat', [6, 6], 2, true))], EX);
    assert.deepEqual(f.map((x) => [x.value.flag, x.value.muscle]), [['same-muscle-back-to-back', 'quads'], ['same-muscle-back-to-back', 'glutes']]);
    assert.match(f[0]!.value.suggestion, /make C the lighter day for quads/);
    assert.deepEqual(f[0]!.reason.inputs, { first: 'B', second: 'C', muscle: 'quads', firstLoad: 13, secondLoad: 8 });
  });

  it('flags equal loads: a press the day after as heavy as the one before', () => {
    // The written plan's C and D: an incline press at 8-12, RIR 2, then deficit push-ups at 8-15, RIR 2.
    const r = backToBack([day('C', 3, slot('incline', [8, 12], 2, true)), day('D', 4, slot('pushup', [8, 15], 2))], EX);
    assert.deepEqual(r.map((x) => [x.value.muscle, x.value.firstLoad, x.value.secondLoad, x.value.lighter]), [['chest', 10, 10, false]]);
  });

  it('counts the heaviest work for the muscle that day, around the week, and only on consecutive days', () => {
    const r = backToBack([day('Sun', 6, slot('squat', [6, 6], 2)), day('Mon', 0, slot('goblet', [10, 15], 3), slot('squat', [8, 8], 2))], EX);
    assert.deepEqual(r.map((x) => [x.value.first, x.value.second, x.value.secondLoad, x.value.lighter]), [['Sun', 'Mon', 10, true], ['Sun', 'Mon', 10, true]]);
    assert.deepEqual(backToBack([day('Mon', 0, slot('squat', [6, 6], 2)), day('Wed', 2, slot('squat', [6, 6], 2))], EX), []);
  });

  it('flags a pair whose prescription is missing (no rep range or RIR to tell)', () => {
    const bare = { kind: 'lift' as const, exercise: 'squat' };
    const r = backToBack([{ id: 'A', day: 0, items: [bare] }, { id: 'B', day: 1, items: [bare] }], EX);
    assert.deepEqual(r.map((x) => [x.value.firstLoad, x.value.lighter]), [[null, false], [null, false]]);
  });
});

describe('review: the written plan gets the same verdict', () => {
  const PLAN = 'v/3-Personal/Fitness/plan-data.json';
  const LOG = 'v/3-Personal/Fitness/fitness-log-data.json';
  const squat = { name: 'Barbell Back Squat', sr: '3 × 6', rest: '2–3 min', rir: 2, logged: true, note: 'Why: the heavy day.' };
  const goblet = { name: 'Goblet Squat', sr: '3 × 10–15', rest: '90 s', rir: 3, logged: true, note: 'Why: the lighter day.' };
  /** The fixture vault with two lifting days of one squat each, A then B, reviewed on the default layout (A Mon, B Tue). */
  const reviewed = (a: object, b: object) => {
    const f = fixtureFiles('v');
    const plan = JSON.parse(f[PLAN]!);
    plan.sessions.A = [a];
    plan.sessions.B = [b];
    plan.lifts['Barbell Back Squat'] = { ...plan.lifts['Barbell Back Squat'], lo: 6, hi: 6 };
    plan.lifts['Goblet Squat'] = { ...plan.lifts['Goblet Squat'], lo: 10, hi: 15 };
    f[PLAN] = JSON.stringify(plan);
    // The fixture's log would set the days (weekLayout): its last 4 weeks are custom sessions here, so review uses the default layout.
    const log = JSON.parse(f[LOG]!);
    for (const s of log.sessions) if (s.date >= '2026-03-16') s.type = 'custom';
    f[LOG] = JSON.stringify(log);
    const read = readVault(memoryIo(f, '2026-04-12'), 'v', { asOf: '2026-04-12' });
    return buildReview(read.data, '2026-04-12').concurrent;
  };
  const sameMuscle = (c: ReturnType<typeof reviewed>) => c.flags.filter((x) => x.value.flag === 'same-muscle-back-to-back');

  it('the heavy squat, then the lighter goblet squat the day after: allowed', () => {
    const c = reviewed(squat, goblet);
    assert.deepEqual(c.layout.filter((l) => l.session === 'A' || l.session === 'B').map((l) => `${l.session} ${l.day}`), ['A mon', 'B tue']);
    assert.deepEqual(sameMuscle(c), []);
    const allowed = c.backToBack.filter((x) => x.value.lighter);
    assert.ok(allowed.length > 0, 'the two days share muscles');
    assert.deepEqual([...new Set(allowed.map((x) => `${x.value.first}>${x.value.second}`))], ['A>B']);
  });

  it('the lighter day first, then the heavy one: flagged for the same muscles', () => {
    const c = reviewed(goblet, squat);
    const flagged = sameMuscle(c);
    assert.ok(flagged.length > 0);
    assert.ok(flagged.every((x) => x.value.sessions.join('>') === 'A>B'));
    assert.deepEqual(c.backToBack.filter((x) => x.value.lighter), []);
  });
});
