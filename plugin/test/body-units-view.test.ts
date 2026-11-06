// Body units on the screens and cards, for an lb profile (lb and in): the
// morning and tape cards show and take them and save kg and cm; the Food
// tab, Progress's weight card and banner, and Check-in's weight field read
// them. A metric profile is unchanged.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { readTracking } from '../../src/adapters/vault/tracking-read.ts';
import { momentAt } from '../../src/core/clock.ts';
import { bodyParts, dueNow } from '../../src/core/nudges.ts';
import { IMPERIAL, METRIC } from '../../src/core/units.ts';
import { buildFood } from '../../src/report/food.ts';
import { buildProgress } from '../../src/report/index.ts';
import { trainingToday } from '../../src/report/tracking.ts';
import { applyFoodState } from '../../test/fixtures/food/food-state.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';
import { cardView } from '../src/reminders/card-model.ts';
import { morningValues, recordValues } from '../src/reminders/inputs.ts';
import { TAPE_FIELDS, TEST_FIELDS } from '../../src/adapters/vault/body-write.ts';
import { renderFood } from '../src/ui/food.ts';
import { renderProgress } from '../src/ui/progress.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';
import { FIX } from './mem-vault.ts';

installFakeDom();

describe('typed in the body units, kept in kg and cm', () => {
  it('the morning weight in lb is kept in kg; its limit reads in lb', () => {
    assert.equal(morningValues({}, { weight: '184.1' }, IMPERIAL).values.weight, 83.5);
    assert.equal(morningValues({}, { weight: '83.5' }).values.weight, 83.5);
    const bad = morningValues({}, { weight: '40' }, IMPERIAL);
    assert.deepEqual(bad.errors, ['Weight is between 67 and 551 lb']);
    assert.deepEqual(bad.bad, ['weight']);
  });

  it('the tape and the wall test in inches are kept in cm; the inch limits sit inside the cm ones', () => {
    const t = recordValues(TAPE_FIELDS, { waist: '36.2', arm: '13' }, IMPERIAL);
    assert.deepEqual(t.values, { waist: 91.9, arm: 33 });
    assert.deepEqual(t.errors, []);
    const out = recordValues(TAPE_FIELDS, { waist: '15' }, IMPERIAL);
    assert.deepEqual(out.errors, ['Waist is between 15.8 and 78.7']);
    assert.equal(recordValues(TEST_FIELDS, { wallGapCm: '2', pushups: '20' }, IMPERIAL).values.wallGapCm, 5.1);
    // The same text twice converts the same way: an untouched field is no change.
    assert.deepEqual(recordValues(TAPE_FIELDS, { waist: '36.2' }, IMPERIAL).values, recordValues(TAPE_FIELDS, { waist: '36.2' }, IMPERIAL).values);
  });
});

describe('the cards in the body units', () => {
  const io = { readText: (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null), listDir: (p: string) => (existsSync(p) ? readdirSync(p) : null) };
  const vault = readVault(io, FIX, { asOf: '2026-04-12' });
  const tr = readTracking(io, FIX);
  const now = momentAt('2026-04-12', '07:35', 0);
  const input = { now, tracking: tr.tracking, nudges: tr.nudges, body: tr.body, photoFolders: tr.photoFolders, habits: tr.habits, program: vault.data.program, training: trainingToday(vault.data, '2026-04-12'), settings: { quiet: null } };
  const parts = bodyParts(input, '2026-04-12');
  const card = dueNow(input).value.cards.find((c) => c.key === 'morning')!;
  const ctx = { now, tracking: tr.tracking, habits: tr.habits, body: tr.body, program: vault.data.program, morningAt: '07:30', parts: { tape: parts.tape.value, photos: parts.photos.value, tests: parts.tests.value } };

  it('the morning card’s weight and the tape day’s fields: lb and in, last values converted', () => {
    const v = cardView(card, { ...ctx, units: IMPERIAL });
    assert.deepEqual(v.units, IMPERIAL);
    assert.equal(v.body.kind, 'morning');
    const b = v.body as Extract<typeof v.body, { kind: 'morning' }>;
    assert.equal(b.fields.find((f) => f.id === 'weight')!.unit, 'lb');
    assert.ok(b.tape, 'a tape day');
    assert.ok(b.tape!.fields.every((f) => f.unit === 'in'));
    const metric = cardView(card, ctx).body as typeof b;
    assert.ok(metric.tape!.fields.every((f) => f.unit === 'cm'));
    const w = metric.tape!.fields.find((f) => f.id === 'waist')!;
    const wi = b.tape!.fields.find((f) => f.id === 'waist')!;
    if (w.placeholder) assert.equal(wi.placeholder, `last ${Math.round((Number(w.placeholder.slice(5)) / 2.54) * 10) / 10}`);
    assert.deepEqual(cardView(card, ctx).units, METRIC);
  });
});

describe('the screens in the body units', () => {
  const food = (lb: boolean) => {
    const files = fixtureFiles('v');
    const { today } = applyFoodState(files, 'later', 'v');
    if (lb) {
      const p = 'v/3-Personal/Fitness/Coach/profile.json';
      const prof = JSON.parse(files[p]!);
      prof.units.body = 'lb';
      files[p] = JSON.stringify(prof);
    }
    const io = memoryIo(files, today);
    const read = readVault(io, 'v', { asOf: today });
    return { m: buildFood(read, readTracking(io, 'v'), today), read, today };
  };

  it('the Food tab: How it’s going’s waist and weight trend, and its table', () => {
    for (const lb of [false, true]) {
      const { m } = food(lb);
      const root = new FakeElement('div');
      renderFood(root as unknown as HTMLElement, m, { phase: { id: 'workday', isfahan: false }, planWeek: null, phaseOf: null, width: 1200, tables: new Set(['food-trend']), onTable: () => {}, tickBusy: false });
      const going = text(root.querySelector('[data-sec="going"]')!);
      if (lb) {
        assert.match(going, /Waist 35\.8 in, /);
        assert.match(going, /Weight trend 18\d\.\d lb/);
        assert.match(going, /Weigh-in \(lb\)Trend \(lb\)Waist \(in\)/);
        assert.doesNotMatch(going, /\d kg\b|\d cm\b/);
      } else {
        assert.match(going, /Waist 91 cm, /);
        assert.match(going, /Weight trend 8\d\.\d kg/);
      }
    }
  });

  it('Progress: the weight card and the banner in lb', () => {
    const { read, today } = food(true);
    const pm = buildProgress(read, today, 'v', { scope: 'cycle' });
    const root = new FakeElement('div');
    renderProgress(root as unknown as HTMLElement, pm, { view: 'week', tables: new Set(['weight']), onView: () => {}, onTable: () => {}, units: IMPERIAL }, { hero: { phase: { id: 'workday', isfahan: false }, phaseOf: null, waist: null } });
    const all = text(root);
    assert.match(all, /Weight trend 18\d\.\d lb, /);
    assert.match(all, /Weigh-in \(lb\)Trend \(lb\)/);
    assert.doesNotMatch(all, /\d kg\b/);
  });
});
