// The plan's length: plan-data's `weeks`, else the dashboard's 24. The top bar's "Week N of M", the Plan's timeline and
// the past-the-end warning all read it.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { planWeeksOf } from '../src/adapters/vault/convert.ts';
import { buildPlan, buildReview } from '../src/report/index.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

const DATE = '2026-04-10';
const PLAN = 'v/3-Personal/Fitness/plan-data.json';
function withWeeks(weeks: unknown, asOf = DATE) {
  const files = fixtureFiles('v');
  const p = JSON.parse(files[PLAN]!);
  if (weeks === undefined) delete p.weeks;
  else p.weeks = weeks;
  files[PLAN] = JSON.stringify(p);
  return readVault(memoryIo(files, asOf), 'v', { asOf });
}

describe('the plan’s length', () => {
  it('is plan-data’s weeks, in whole mesocycles, else 24', () => {
    assert.equal(planWeeksOf({ weeks: 12 }), 12);
    assert.equal(planWeeksOf({ weeks: 14 }), 16, 'up to a whole mesocycle');
    // The plan's own light weeks end its mesocycles: 15 weeks with light weeks 5, 10 and 15 is 15 weeks.
    assert.equal(planWeeksOf({ weeks: 15, rules: { lightWeeks: { weeks: [5, 10, 15] } } }), 15);
    assert.equal(planWeeksOf({ weeks: 13, rules: { lightWeeks: { every: 5 } } }), 15);
    assert.equal(planWeeksOf({ weeks: 17, rules: { lightWeeks: { weeks: [5, 10, 15] } } }), 17, 'past the last listed light week, as written');
    assert.equal(planWeeksOf({ weeks: 0 }), 24);
    assert.equal(planWeeksOf({ weeks: '12' }), 24);
    assert.equal(planWeeksOf({}), 24);
    assert.equal(planWeeksOf(null), 24);
  });

  it('a 12-week plan: the review’s week, the program (two phases, the second of one mesocycle) and the Plan’s timeline', () => {
    const read = withWeeks(12);
    assert.equal(read.data.plan.weeks, 12);
    const r = buildReview(read.data, DATE);
    assert.deepEqual([r.week.planWeek, r.week.planWeeks], [6, 12]);
    assert.deepEqual(read.data.program.macrocycle.phases.map((p) => p.mesocycles.length), [2, 1]);
    assert.equal(buildPlan(read, DATE).weeks!.length, 12);
  });

  it('without weeks the 24 stay; past the end the program grows and a warning says so', () => {
    assert.equal(buildReview(withWeeks(undefined).data, DATE).week.planWeeks, 24);
    const late = withWeeks(12, '2026-05-25'); // plan week 13
    assert.ok(late.data.warnings.some((w) => w.code === 'past-plan-end' && /past the plan's 12 weeks/.test(w.message)));
    assert.equal(late.data.plan.weeks, 12);
    assert.equal(late.data.program.macrocycle.phases.flatMap((p) => p.mesocycles.flatMap((m) => m.weeks)).length, 16);
  });
});
