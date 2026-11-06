// The Hotel version from the profile's travel list (`travelEquipment`): each
// movement pattern kept with only what travel usually offers, bodyweight
// always; without the list, the default bodyweight, light dumbbells and
// bands. The Log panel and Today read it through the same session.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { buildLogEntry } from '../src/adapters/vault/log-write.ts';
import { readVault } from '../src/adapters/vault/read.ts';
import { run } from '../src/cli/cli.ts';
import { CATALOGUE_BY_ID } from '../src/core/data/exercises.ts';
import type { Exercise, LedgerConstraint, SessionTemplate } from '../src/core/schema.ts';
import { validateProfile } from '../src/core/validate.ts';
import { hotelVariant, travelEquipment, VARIANT } from '../src/core/variant.ts';
import { buildSession, buildToday, inputFromForm, logFormFor } from '../src/report/index.ts';
import { fixtureFiles, memoryIo, ROOT } from './helpers.ts';

const f = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'rules', 'variants.json'), 'utf8')) as { template: SessionTemplate; exercises: Record<string, Exercise>; ledger: LedgerConstraint[]; date: string };
const catalogueOf = (id: string) => CATALOGUE_BY_ID.get(id) ?? null;
const hotel = (travel?: ReturnType<typeof travelEquipment>) => hotelVariant({ template: f.template, exercises: f.exercises, catalogueOf, ledger: f.ledger, date: f.date, unit: 'kg', ...(travel ? { travel } : {}) });
const kitOf = (id: string) => CATALOGUE_BY_ID.get(id)?.equipment ?? [];

const DATE = '2026-04-10';
const PROFILE = 'v/3-Personal/Fitness/Coach/profile.json';
/** The synthetic vault, its profile with a travel list (or none). */
const vaultWith = (travelEquipment?: string[]) => {
  const files = fixtureFiles('v');
  const p = JSON.parse(files[PROFILE]!);
  if (travelEquipment) p.travelEquipment = travelEquipment;
  files[PROFILE] = JSON.stringify(p);
  return { files, read: readVault(memoryIo(files, DATE), 'v', { asOf: DATE }) };
};

describe('travelEquipment: what travel usually offers', () => {
  it('reads the profile list in the words of equipment, bodyweight always', () => {
    assert.deepEqual(travelEquipment({ travelEquipment: ['Resistance bands', 'pull-up bar'] }), { equipment: ['bodyweight', 'band', 'pull-up-bar'], source: 'profile', unknown: [] });
    assert.deepEqual(travelEquipment({ travelEquipment: ['kettlebells', 'a suitcase'] }), { equipment: ['bodyweight', 'kettlebell'], source: 'profile', unknown: ['a suitcase'] });
    assert.deepEqual(travelEquipment({ travelEquipment: [] }).equipment, ['bodyweight'], 'an empty list is bodyweight only');
  });

  it('without a list: the default, bodyweight, dumbbells and bands', () => {
    for (const p of [null, undefined, {}]) assert.deepEqual(travelEquipment(p), { equipment: [...VARIANT.hotelEquipment], source: 'default', unknown: [] });
  });

  it('is in the schema: a list of words, optional', () => {
    const p = JSON.parse(vaultWith().files[PROFILE]!);
    assert.deepEqual(validateProfile({ ...p, travelEquipment: ['bands', 'pull-up bar'] }), []);
    assert.deepEqual(validateProfile({ ...p, travelEquipment: [] }), []);
    assert.equal(validateProfile({ ...p, travelEquipment: 'bands' }).length, 1);
    assert.match(validateProfile({ ...p, travelEquipment: ['bands', 3] })[0]!.path, /travelEquipment/);
  });
});

describe('the Hotel version with a travel list', () => {
  const noDumbbells = travelEquipment({ travelEquipment: ['bands', 'pull-up bar'] });

  it('keeps each pattern without dumbbells when travel has none', () => {
    const r = hotel(noDumbbells);
    // The cardio item is kept as any machine or a walk outside.
    for (const s of r.value.slots.filter((x) => f.exercises[x.exercise]?.kind !== 'cardio')) assert.ok(kitOf(s.exercise).every((q) => noDumbbells.equipment.includes(q)), `${s.exercise} uses only bodyweight, a band or a pull-up bar`);
    // The dumbbell squat and bench of the default give way to bodyweight ones.
    const def = hotel().value.slots.map((s) => s.exercise);
    assert.ok(def.includes('goblet-squat'));
    assert.ok(!r.value.slots.some((s) => s.exercise === 'goblet-squat' || kitOf(s.exercise).includes('dumbbell')));
    assert.deepEqual(r.value.slots.filter((s) => s.replaces).map((s) => s.replaces), ['back-squat', 'db-bench', 'seated-cable-row', 'lat-pulldown']);
  });

  it('says where the list came from, and names the equipment in a swap and a missing option', () => {
    const r = hotel(noDumbbells);
    assert.match(r.reason.note ?? '', /With what you said travel usually offers: bodyweight, a band and a pull-up bar\./);
    assert.deepEqual([r.reason.inputs['equipment'], r.reason.inputs['equipmentFrom']], [['bodyweight', 'band', 'pull-up-bar'], 'profile']);
    assert.deepEqual((r.value.slots[0]!.reasons[0]!.threshold as { equipment: string[] }).equipment, ['bodyweight', 'band', 'pull-up-bar']);
    const carry = hotelVariant({ template: { ...f.template, slots: [{ exercise: 'farmer', sets: 3, repRange: [8, 8], rir: 2 }] }, exercises: { farmer: { name: 'Sled push', unit: 'kg', increment: 5, pattern: 'carry' } }, catalogueOf, ledger: [], date: f.date, unit: 'kg', travel: travelEquipment({ travelEquipment: [] }) });
    assert.match(carry.value.slots[0]!.reasons[0]!.note ?? '', /no carry option with bodyweight passes the Ledger screen/);
    assert.match(hotel(travelEquipment({ travelEquipment: ['bands', 'a suitcase'] })).reason.note ?? '', /Not equipment the engine knows, so left out: a suitcase\./);
  });

  it('without a list: the same session as before, and the reason says the profile has none', () => {
    const r = hotel();
    assert.deepEqual(r.value.slots.map((s) => s.exercise), ['goblet-squat', 'push-up', 'band-row', 'band-pulldown', 'plank', 'zone2-bike']);
    assert.deepEqual(r.value.slots, hotel(travelEquipment(null)).value.slots);
    assert.match(r.reason.note ?? '', /With bodyweight, light dumbbells and bands \(the profile does not say what travel usually offers\)\./);
    assert.equal(r.reason.inputs['equipmentFrom'], 'default');
  });
});

describe('session --mode hotel, Today and the Log panel read the travel list', () => {
  it('builds the Hotel session from the profile list: no dumbbells, and the soreness swaps keep to it', () => {
    const { read } = vaultWith(['bands']);
    const allowed: readonly string[] = ['bodyweight', 'band'];
    for (const type of ['A', 'B']) {
      const s = buildSession(read.data, DATE, 'hotel', { type });
      for (const it of s.items) assert.ok(kitOf(it.exercise).every((q) => allowed.includes(q)), `${type}: ${it.name}`);
      assert.match(s.flags.find((x) => x.rule === 'variant.hotel')!.note ?? '', /travel usually offers: bodyweight and a band/);
    }
    // The default still has the dumbbell swaps.
    const def = buildSession(vaultWith().read.data, DATE, 'hotel', { type: 'B' });
    assert.ok(def.items.some((it) => kitOf(it.exercise).includes('dumbbell')));
  });

  it('the CLI gives the same session', () => {
    const { files } = vaultWith(['bands']);
    const r = run(['session', '--vault', 'v', '--date', DATE, '--mode', 'hotel', '--type', 'B'], memoryIo(files, DATE));
    assert.equal(r.code, 0, r.stderr);
    const items = (JSON.parse(r.stdout) as { items: { exercise: string }[] }).items;
    assert.ok(items.length > 0 && items.every((it) => kitOf(it.exercise).every((q) => q === 'bodyweight' || q === 'band')));
  });

  it('Today and the Log panel work as before with it', () => {
    const { read } = vaultWith(['bands']);
    const today = buildToday(read, DATE, 'hotel', 'v');
    assert.equal(today.session!.mode, 'hotel');
    const form = logFormFor(read, buildSession(read.data, DATE, 'hotel'), DATE)!;
    const entry = buildLogEntry(inputFromForm(form), { plan: read.raw!.plan, log: read.raw!.log, today: DATE });
    assert.ok(entry.ok, !entry.ok ? entry.error : '');
    assert.equal(entry.entry['hotel'], true);
  });
});
