// The plan's own reason for each item ("Why: ..." at the end of its
// plan-data note) travels with today's session items, the finisher and the
// Plan screen's templates, so the screens can show it beside the engine's
// adjustments. A swap keeps the reason of the slot it fills.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { buildPlan, buildSession } from '../src/report/index.ts';
import { fixtureWithWhy, memoryIo } from './helpers.ts';

const DATE = '2026-04-10'; // the rotation suggests B

describe('the plan’s Why on the screens', () => {
  const read = readVault(memoryIo(fixtureWithWhy(), DATE), 'v', { asOf: DATE });

  it('today’s session items and the finisher carry the plan’s Why; items without one carry none', () => {
    const s = buildSession(read.data, DATE, 'full');
    assert.equal(s.session!.type, 'B');
    const row = s.items.find((i) => i.name === 'Seated Cable Row')!;
    assert.equal(row.planWhy, undefined);
    assert.deepEqual(s.finisher!.planWhy, { text: 'easy minutes toward the cardio goal.' });
  });

  it('the Plan screen’s templates carry each slot’s Why, null without one', () => {
    const p = buildPlan(read, DATE);
    assert.ok('templates' in p);
    const b = p.templates!.find((t) => t.type === 'B')!;
    assert.equal(b.slots.find((x) => x.name === 'Romanian Deadlift')!.why, 'the main hinge, for the hamstrings and the back.');
    assert.equal(b.slots.find((x) => x.name === 'Seated Cable Row')!.why, null);
  });

  it('a swap keeps the reason of the slot it fills, naming the planned exercise', () => {
    // The Ledger swaps B's Romanian deadlift for a single-leg one in the fixture.
    const s = buildSession(read.data, DATE, 'full');
    const rdl = s.items.find((i) => i.planName === 'Romanian Deadlift')!;
    assert.equal(rdl.replaces!.name, 'Romanian Deadlift');
    assert.deepEqual(rdl.planWhy, { text: 'the main hinge, for the hamstrings and the back.', of: 'Romanian Deadlift' });
    assert.ok(rdl.adjustments.some((a) => a.rule === 'safety.ledger'), 'the engine’s own reasons are still there');
    // A slot done as planned names no other exercise.
    const goblet = buildSession(read.data, DATE, 'hotel', { type: 'A' }).items.find((i) => i.planName === 'Goblet Squat')!;
    assert.deepEqual(goblet.planWhy, { text: 'the knee tolerates it while the back squat waits.' });
  });
});
