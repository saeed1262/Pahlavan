// The minimum week: the plan's lifting sessions as Express (the main lifts
// at the Express block's working sets, about 20 minutes), the short days
// optional. On the Plan screen, from the vault's plan.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { minimumWeek } from '../src/core/minimum-week.ts';
import { titleFor } from '../src/core/reason.ts';
import { buildPlan } from '../src/report/index.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

describe('the minimum week', () => {
  it('is the lifting days as Express, with its reason', () => {
    const r = minimumWeek({ liftDays: 4, mainSets: 2, shortDays: 3 });
    assert.deepEqual(r.value, { sessions: 4, mainSets: 2, minutes: 20, text: "Four lifting sessions as Express: each one's main lifts at 2 working sets, about 20 minutes. The short sessions and cardio are optional that week; a walk counts." });
    assert.equal(r.reason.rule, 'plan.minimum-week');
    assert.equal(titleFor(r.reason.rule), 'The minimum week');
    assert.match(r.reason.note!, /beats skipping the week/);
    assert.equal(minimumWeek({ liftDays: 1, mainSets: null, shortDays: 0 }).value!.text, "One lifting session as Express: each one's main lifts at 2 working sets, about 20 minutes.");
    assert.equal(minimumWeek({ liftDays: 0, mainSets: 2, shortDays: 3 }).value, null);
  });

  it('the Plan screen carries it from the vault’s plan', () => {
    const read = readVault(memoryIo(fixtureFiles('v'), '2026-04-10'), 'v', { asOf: '2026-04-10' });
    const p = buildPlan(read, '2026-04-10');
    assert.ok('minimumWeek' in p && p.minimumWeek?.value);
    assert.equal(p.minimumWeek.value.sessions, read.data.plan.weekTarget.lift);
  });
});
