// A session's finisher is its trailing cardio after other work: a lifting
// day's easy Zone 2, a short day's cool-down after its circuit. A short day
// whose only item is cardio (an intervals day, the light week's easy Zone 2)
// has it as its item, not as a finisher of nothing; Today's checklist ticks
// it as an item, and Express halves it as one.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checklistLines } from '../src/adapters/vault/log-write.ts';
import { readVault } from '../src/adapters/vault/read.ts';
import { buildSession, checklistTargets, endsInFinisher } from '../src/report/index.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

type Json = Record<string, any>;
const PLAN = 'v/3-Personal/Fitness/plan-data.json';
const LATER = '2026-04-10'; // plan week 6, a loading week
const LIGHT = '2026-03-27'; // plan week 4, a light week
/** Intervals the guide calls cardio: the session's only item. */
const INTERVALS = { name: 'Bike intervals', table: 'Bike intervals', sr: '30 min', rest: '—', timed: { minutes: 30, rounds: 4, workMin: 4, restMin: 3 }, note: 'Hard on the work, easy between.' };

/** The synthetic vault with a short session S2 of these items. */
function readWith(s2: Json[], date: string) {
  const f = fixtureFiles('v');
  const plan = JSON.parse(f[PLAN]!);
  plan.shortTypes = ['S1', 'S2', 'S3'];
  plan.titles = { ...plan.titles, S2: 'Intervals' };
  plan.sessions.S2 = s2;
  plan.guide['Bike intervals'] = { setup: 'Bike.', do: 'Hard, then easy.', avoid: 'Sprinting.', q: 'intervals', muscles: { main: [], helps: [], kind: 'cardio' } };
  f[PLAN] = JSON.stringify(plan);
  return readVault(memoryIo(f, date), 'v', { asOf: date });
}

describe('endsInFinisher: cardio after other work', () => {
  const kind = (id: string) => (id.startsWith('bike') ? 'cardio' : 'strength');
  it('the last item when it is cardio and something comes before it', () => {
    assert.equal(endsInFinisher(['squat', 'bike'], kind), true);
    assert.equal(endsInFinisher(['bike'], kind), false, 'a session of one cardio item has nothing to finish');
    assert.equal(endsInFinisher(['bike', 'squat'], kind), false);
    assert.equal(endsInFinisher([], kind), false);
  });
});

describe('the session: a finisher only after other work', () => {
  it('a lifting day’s trailing easy cardio is its finisher', () => {
    const s = buildSession(readWith([INTERVALS], LATER).data, LATER, 'full', { type: 'A' });
    assert.equal(s.finisher?.name, 'Zone 2 finisher');
    assert.ok(!s.items.some((i) => i.name === 'Zone 2 finisher'));
  });

  it('a short day whose only item is cardio has it as its item, with its intervals', () => {
    const read = readWith([INTERVALS], LATER);
    assert.equal(read.data.program.exercises['bike-intervals']?.kind, 'cardio');
    const s = buildSession(read.data, LATER, 'full', { type: 'S2' });
    assert.equal(s.finisher, null);
    assert.deepEqual(s.items.map((i) => [i.name, i.sets, i.timed?.text]), [['Bike intervals', 4, '4 × 4 min hard, 3 min easy between, easy before and after · about 30 min']]);
    // Today's checklist ticks it as the session's item.
    const lines = checklistLines(read.raw!.plan, 'S2', false, false);
    assert.deepEqual(checklistTargets(lines, s.items, null), [{ kind: 'warmup' }, { kind: 'item', index: 0 }]);
  });

  it('Express halves it as the short day’s item', () => {
    const s = buildSession(readWith([INTERVALS], LATER).data, LATER, 'express', { type: 'S2' });
    assert.equal(s.finisher, null);
    assert.deepEqual(s.items.map((i) => [i.name, i.sets, i.sr]), [['Bike intervals', 2, '15 min']]);
  });

  it('the light week’s S3 of easy Zone 2 alone: its item, not a finisher', () => {
    const s = buildSession(readWith([INTERVALS], LIGHT).data, LIGHT, 'full', { type: 'S3' });
    assert.equal('week' in s && s.week.deload, true);
    assert.equal(s.finisher, null);
    assert.deepEqual(s.items.map((i) => i.name), ['Easy Zone 2 (bike or walk)']);
  });

  it('a short day keeps its cool-down after the circuit as its finisher', () => {
    const s = buildSession(readWith([INTERVALS], LATER).data, LATER, 'full', { type: 'S3' });
    assert.deepEqual(s.items.map((i) => i.name), ['Circuit: squat jump · burpee']);
    assert.equal(s.finisher?.name, 'Cool-down walk or bike');
  });
});
