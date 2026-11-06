// Body units: the profile's `units.body` (kg: kg and cm; lb: lb and in).
// The files keep kg and cm; the rules' notes the screens show, the Food
// tab's reasons and the Body record's last entry are written in the
// profile's units. A metric profile reads exactly as before.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { readTracking } from '../src/adapters/vault/tracking-read.ts';
import { waistTrend } from '../src/core/diet.ts';
import { titleFor } from '../src/core/reason.ts';
import { bodyUnitsOf, IMPERIAL, inLength, inWeight, lengthCm, lengthText, METRIC, weightKg, weightText } from '../src/core/units.ts';
import { buildFood } from '../src/report/food.ts';
import { buildBodyRecord, entryText } from '../src/report/habits-screen.ts';
import { applyFoodState } from './fixtures/food/food-state.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

const imperial = (files: Record<string, string>, root = 'v') => {
  const p = `${root}/3-Personal/Fitness/Coach/profile.json`;
  const prof = JSON.parse(files[p]!);
  prof.units = { ...prof.units, body: 'lb' };
  files[p] = JSON.stringify(prof);
  return files;
};

describe('body units', () => {
  it('come from the profile: lb means lb and in, kg (or none) kg and cm', () => {
    assert.deepEqual(bodyUnitsOf({ units: { body: 'lb' } }).value, IMPERIAL);
    assert.deepEqual(bodyUnitsOf({ units: { body: 'kg' } }).value, METRIC);
    assert.deepEqual(bodyUnitsOf(null).value, METRIC);
    const r = bodyUnitsOf({ units: { body: 'lb' } });
    assert.equal(r.reason.rule, 'units.body');
    assert.equal(titleFor(r.reason.rule), 'Body units');
  });

  it('convert both ways; the texts keep cm and kg as written', () => {
    assert.equal(Math.round(inWeight(83.5, IMPERIAL) * 10) / 10, 184.1);
    assert.equal(Math.round(weightKg(184.1, IMPERIAL) * 10) / 10, 83.5);
    assert.equal(inLength(91.44, IMPERIAL), 36);
    assert.equal(lengthCm(36, IMPERIAL), 91.44);
    assert.equal(inWeight(80, METRIC), 80);
    assert.deepEqual([lengthText(92, METRIC), lengthText(92, IMPERIAL), weightText(83.5, METRIC), weightText(83.5, IMPERIAL)], ['92 cm', '36.2 in', '83.5 kg', '184.1 lb']);
  });

  it('the waist note in inches; metric unchanged', () => {
    const tape = [{ date: '2026-11-02', unit: 'cm' as const, waist: 92 }, { date: '2026-11-29', unit: 'cm' as const, waist: 90.5 }];
    const opts = { since: '2026-11-02', through: '2026-11-30', flatCm: 0.5, goal: 'recomposition' as const };
    assert.match(waistTrend(tape, opts).reason.note!, /^Down 1\.5 cm since/);
    assert.match(waistTrend(tape, { ...opts, units: IMPERIAL }).reason.note!, /^Down 0\.6 in since/);
  });

  it('the Food tab’s reasons in lb and in for an lb profile; the model says which units', () => {
    const files = fixtureFiles('v');
    const { today } = applyFoodState(files, 'later', 'v');
    const metric = buildFood(readVault(memoryIo(files, today), 'v', { asOf: today }), readTracking(memoryIo(files, today), 'v'), today);
    imperial(files);
    const io = memoryIo(files, today);
    const f = buildFood(readVault(io, 'v', { asOf: today }), readTracking(io, 'v'), today);
    assert.deepEqual(f.units, IMPERIAL);
    assert.deepEqual(metric.units, METRIC);
    const why = f.why as Record<string, { rows: [string, string][]; threshold: [string, string][]; note: string }>;
    const mwhy = metric.why as typeof why;
    assert.match(mwhy['trend']!.rows[1]![1], / kg$/);
    assert.match(why['trend']!.rows[1]![1], / lb$/);
    assert.match(mwhy['waist']!.rows[0]![1], /^92 cm|^91 cm/);
    assert.match(why['waist']!.rows[0]![1], /^\d+\.\d in, /);
    assert.match(why['rate']!.rows[0]![1], / lb a week$/);
    assert.doesNotMatch(JSON.stringify([why['waist'], why['waist-ch'], why['trend'], why['rate'], why['flat'], why['onepct']]), /\d ?(kg|cm)\b/);
  });

  it('the Body record’s last tape and wall test in inches', () => {
    assert.equal(entryText('tape', { date: '2026-04-07', waist: 93.6, hips: 96.4 }), 'waist 93.6, hips 96.4 cm');
    assert.equal(entryText('tape', { date: '2026-04-07', waist: 93.6, hips: 96.4 }, IMPERIAL), 'waist 36.9, hips 38 in');
    assert.equal(entryText('tests', { date: '2026-04-04', pushups: 17, wallGapCm: 5 }, IMPERIAL), 'push-ups 17, wall test 2 in');
    const files = imperial(fixtureFiles('v'));
    const io = memoryIo(files, '2026-04-10');
    const b = buildBodyRecord(readVault(io, 'v', { asOf: '2026-04-10' }), readTracking(io, 'v'), '2026-04-10');
    const tape = b.parts.find((p) => p.part === 'tape')!;
    if (tape.last?.text) assert.match(tape.last.text, / in$/);
  });
});
