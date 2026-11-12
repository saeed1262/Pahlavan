// The plan's rules for the session variants and the test weeks: Hotel
// (`rules.hotel`), Express on a short day (`express.short`) and the fitness
// tests' weeks (`rules.tests`), which also add a photo day on each test
// week's Sunday.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { paths } from '../src/adapters/vault/layout.ts';
import { bodyRecordView, bodySchedule, partStatus, planOccurrences, planScheduleLine, planScheduleText, resolveSchedule } from '../src/core/body-schedule.ts';
import { CATALOGUE_BY_ID } from '../src/core/data/exercises.ts';
import { addDays } from '../src/core/dates.ts';
import type { PlanData } from '../src/core/plan-data.ts';
import type { Exercise, LedgerConstraint, SessionTemplate } from '../src/core/schema.ts';
import { hotelVariant, shortExpressVariant } from '../src/core/variant.ts';
import { baselineNote } from '../src/report/baseline.ts';
import { buildProgressMore } from '../src/report/progress-more.ts';
import { buildSession } from '../src/report/session.ts';
import { fixtureFiles, memoryIo, ROOT } from './helpers.ts';

const f = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'rules', 'variants.json'), 'utf8')) as { template: SessionTemplate; exercises: Record<string, Exercise>; ledger: LedgerConstraint[]; date: string };
const catalogueOf = (id: string) => CATALOGUE_BY_ID.get(id) ?? null;
const PLAN = `v/${paths().plan}`;

function readWith(edit: (doc: PlanData) => void, asOf = '2026-04-12') {
  const files = fixtureFiles('v');
  const doc = JSON.parse(files[PLAN]!) as PlanData;
  edit(doc);
  files[PLAN] = `${JSON.stringify(doc, null, 2)}\n`;
  return readVault(memoryIo(files, asOf), 'v', { asOf });
}

function vault(edit: (doc: PlanData) => void, asOf = '2026-04-12') {
  return readWith(edit, asOf).data;
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

  const testWeeks = (weeks: number[]) => (d: PlanData) => void (d.rules = { tests: { weeks } });
  const sundays = (data: ReturnType<typeof vault>, ns: number[]) => {
    const weeks = data.program.macrocycle.phases.flatMap((p) => p.mesocycles.flatMap((m) => m.weeks));
    return ns.map((n) => addDays(weeks[n - 1]!.start, 6));
  };

  it('add a photo day on each test week\'s Sunday beside the light weeks\' Sundays, one only when a test week is a light week', () => {
    const data = vault(testWeeks([6, 12]));
    // Plan week 12 is a light week: one photo day on its Sunday, not two.
    assert.deepEqual(planOccurrences(data.program).photos, sundays(data, [4, 6, 8, 12, 16, 20, 24]));
    assert.deepEqual(planScheduleText(data.program), { tape: 'Every second Sunday', photos: 'Each light week’s Sunday, and each test week’s', tests: 'In plan weeks 6 and 12' });
    assert.equal(planScheduleLine(data.program), 'the tape every second Sunday, photos on each light week’s Sunday and each test week’s, tests in plan weeks 6 and 12');
    // The default: each light week's Sunday, in its words.
    const plain = vault(() => {});
    assert.deepEqual(planOccurrences(plain.program).photos, sundays(plain, [4, 8, 12, 16, 20, 24]));
    assert.deepEqual(planScheduleText(plain.program), { tape: 'Every second Sunday', photos: 'Each light week’s Sunday', tests: 'Each phase end, in its light week' });
    assert.equal(planScheduleLine(plain.program), 'the tape every second Sunday, photos on each light week’s Sunday, tests at each phase end');
    assert.equal(planScheduleLine(null), planScheduleLine(plain.program));
    // Test weeks on light weeks add no photo day; test weeks at the phase ends read as the default.
    const onLight = vault(testWeeks([4, 12]));
    assert.deepEqual(planOccurrences(onLight.program).photos, sundays(onLight, [4, 8, 12, 16, 20, 24]));
    assert.deepEqual([planScheduleText(onLight.program).photos, planScheduleText(onLight.program).tests], ['Each light week’s Sunday', 'In plan weeks 4 and 12']);
    assert.deepEqual(planScheduleText(vault(testWeeks([8, 16, 24])).program), planScheduleText(plain.program));
  });

  it('keep every light week\'s photo day, so its skip still counts; the test week\'s Sunday comes next', () => {
    const data = vault(testWeeks([6, 12]));
    const none = bodyRecordView({}, []);
    const on = (date: string) => bodySchedule(resolveSchedule({ schedule: 'plan' }, data.program, { tape: null, tests: null }, date), data.program, date, { hasTests: true, baselineSkipped: false });
    // Between the light week's Sunday (29 Mar) and plan week 6's (12 Apr): the light week's photo day holds, and its skip key.
    const before = on('2026-04-05');
    assert.deepEqual([before.photos.current, before.photos.afterCurrent], ['2026-03-29', '2026-04-12']);
    const skipped = partStatus(before.photos, none, { 'photos:2026-03-29': '2026-03-29T08:00:00Z' }, '2026-04-05').value;
    assert.deepEqual([skipped.due, skipped.skipped, skipped.nextDate], [false, true, '2026-04-12']);
    // On plan week 6's Sunday its own photo day is due, until a set dated on or after it.
    const sunday = on('2026-04-12');
    assert.deepEqual([sunday.photos.current, partStatus(sunday.photos, none, {}, '2026-04-12').value.due], ['2026-04-12', true]);
    assert.equal(partStatus(sunday.photos, bodyRecordView({}, ['2026-04-12']), {}, '2026-04-12').value.done, true);
    assert.equal(partStatus(sunday.photos, bodyRecordView({}, ['2026-03-29']), {}, '2026-04-12').value.done, false, 'the light week\'s set is the round before');
    assert.equal(sunday.photos.text, 'Each light week’s Sunday, and each test week’s');
    assert.match(sunday.photos.reason.note!, /^Each light week’s Sunday, and each test week’s, from your plan\. Next: Sun 26 Apr\./);
    assert.match(sunday.tests.reason.note!, /^In plan weeks 6 and 12, from your plan\./);
  });

  it('Progress says when the photo sets come', () => {
    const more = (edit: (d: PlanData) => void) => buildProgressMore(readWith(edit, '2026-04-10'), '2026-04-10').body!;
    assert.equal(more(() => {}).photoDays, 'each light week’s Sunday, every four weeks');
    assert.equal(more(testWeeks([6, 12])).photoDays, 'each light week’s Sunday, every four weeks, and on each test week’s');
  });
});
