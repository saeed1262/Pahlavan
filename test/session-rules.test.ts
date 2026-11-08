// The plan's rules for the session variants and the test weeks: Hotel
// (`rules.hotel`), Express on a short day (`express.short`) and the fitness
// tests' weeks (`rules.tests`).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { paths } from '../src/adapters/vault/layout.ts';
import { planOccurrences } from '../src/core/body-schedule.ts';
import { CATALOGUE_BY_ID } from '../src/core/data/exercises.ts';
import { addDays } from '../src/core/dates.ts';
import type { PlanData } from '../src/core/plan-data.ts';
import type { Exercise, LedgerConstraint, SessionTemplate } from '../src/core/schema.ts';
import { hotelVariant, shortExpressVariant } from '../src/core/variant.ts';
import { baselineNote } from '../src/report/baseline.ts';
import { buildSession } from '../src/report/session.ts';
import { fixtureFiles, memoryIo, ROOT } from './helpers.ts';

const f = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'rules', 'variants.json'), 'utf8')) as { template: SessionTemplate; exercises: Record<string, Exercise>; ledger: LedgerConstraint[]; date: string };
const catalogueOf = (id: string) => CATALOGUE_BY_ID.get(id) ?? null;
const PLAN = `v/${paths().plan}`;

function vault(edit: (doc: PlanData) => void, asOf = '2026-04-12') {
  const files = fixtureFiles('v');
  const doc = JSON.parse(files[PLAN]!) as PlanData;
  edit(doc);
  files[PLAN] = `${JSON.stringify(doc, null, 2)}\n`;
  return readVault(memoryIo(files, asOf), 'v', { asOf }).data;
}

describe('the plan\'s Hotel rule', () => {
  const base = { template: f.template, exercises: f.exercises, catalogueOf, ledger: f.ledger, date: f.date, unit: 'kg' as const, tripDays: 10 };

  it('the old default swaps from the catalogue and takes a third of the sets on a long trip', () => {
    const r = hotelVariant(base);
    assert.equal(r.value.volumeScaled, true);
    assert.ok(r.value.slots.some((s) => s.replaces));
  });

  it('"skip": no swaps, a movement the kit cannot do is skipped; "all": the usual sets', () => {
    const r = hotelVariant({ ...base, rule: { swaps: 'skip', longTripSets: 'all' } });
    assert.equal(r.value.volumeScaled, false);
    assert.ok(!r.value.slots.some((s) => s.replaces));
    const skipped = r.value.slots.filter((s) => s.unavailable);
    assert.ok(skipped.length > 0);
    assert.match(skipped[0]!.reasons[0]!.note ?? '', /skipped today \(the plan's rule makes no Hotel swaps\)/);
    for (const [i, s] of r.value.slots.entries()) assert.equal(s.sets, f.template.slots[i]!.sets);
  });
});

describe('the plan\'s Express rule for a short day', () => {
  const t: SessionTemplate = { id: 's', name: 'Short', kind: 'short', slots: [{ exercise: 'a', sets: 4, repRange: [8, 12], rir: 2 }] };

  it('"skip": nothing to do, said and cited', () => {
    const from = { kind: 'plan' as const, path: 'express.short', text: "The plan's rule: Express on a short day: skip the short day." };
    const r = shortExpressVariant(t, () => null, { rule: { short: 'skip' }, from });
    assert.deepEqual(r.value.slots, []);
    assert.match(r.reason.note ?? '', /^The plan's rule: Express on a short day: skip the short day\. Express on a short day: the short day is skipped today\./);
  });

  it('through the session: no items, no finisher, no minutes', () => {
    const data = vault((d) => {
      d.express = { ...d.express, short: 'skip' };
    }, '2026-04-10');
    const s = buildSession(data, '2026-04-10', 'express', { type: 'S3' });
    assert.ok('plannedLoad' in s);
    assert.deepEqual([s.items.length, s.finisher, s.plannedLoad.minutes, s.plannedLoad.rpe, s.plannedLoad.load], [0, null, 0, 0, 0]);
    assert.match(s.plannedLoad.reason.note ?? '', /no planned effort/);
  });
});

describe('the plan\'s test weeks', () => {
  it('mark the program\'s weeks, so the body record, the Plan screen and the baseline note follow them', () => {
    const data = vault((d) => {
      d.rules = { tests: { weeks: [6, 12] } };
    });
    const weeks = data.program.macrocycle.phases.flatMap((p) => p.mesocycles.flatMap((m) => m.weeks));
    assert.deepEqual(weeks.map((w, i) => (w.tests ? i + 1 : 0)).filter(Boolean), [6, 12]);
    assert.deepEqual(planOccurrences(data.program).tests, [addDays(weeks[5]!.start, 5), addDays(weeks[11]!.start, 5)]);
    const note = baselineNote('2026-11-02', [], data.rules.rules.lightWeeks, data.rules.rules.tests.weeks);
    assert.equal(note.value.firstTests, '2026-12-12');
    assert.equal(baselineNote('2026-11-02', []).value.firstTests, '2026-12-26', 'phase 1\'s last Saturday by default');
  });
});
