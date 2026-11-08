// The catalogue's muscle tags as the evidence audit set them, and the one
// rule every screen reads them through: the catalogue's tags for a movement it
// knows, on plan-data's 14 groups, a main muscle never also a helper.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { canonicalTags } from '../src/adapters/vault/muscle-tags.ts';
import { CATALOGUE, CATALOGUE_BY_ID } from '../src/core/data/exercises.ts';
import { generatePlan } from '../src/core/plan/generate.ts';
import { planDataGroups, PLAN_DATA_MUSCLES } from '../src/core/plan-data.ts';
import type { Profile } from '../src/core/schema.ts';
import { ROOT } from './helpers.ts';

const tags = (id: string) => {
  const e = CATALOGUE_BY_ID.get(id);
  assert.ok(e, id);
  return e.muscles;
};
const trains = (id: string, m: string) => tags(id).main.includes(m) || tags(id).helps.includes(m);

describe('catalogue tags: the evidence audit', () => {
  // Kubo 2019 (https://doi.org/10.1007/s00421-019-04181-y) and Plotkin 2023
  // (https://doi.org/10.3389/fphys.2023.1279170): squats and hip thrusts grow
  // the hamstrings little or not at all; deep squats grow the adductors.
  const squats = CATALOGUE.filter((e) => e.pattern === 'squat' || (/squat|pistol/.test(e.id) && e.pattern !== 'lunge'));

  it('finds the squats', () => {
    for (const id of ['box-squat', 'bodyweight-squat', 'goblet-squat', 'back-squat', 'leg-press', 'pistol-squat', 'supported-squat', 'wall-sit', 'front-squat', 'double-kb-front-squat', 'hack-squat', 'assisted-pistol', 'shrimp-squat', 'squat-jump']) assert.ok(squats.some((e) => e.id === id), id);
  });

  it('credits no hamstrings to any squat or the leg press', () => {
    for (const e of squats) assert.ok(!trains(e.id, 'hamstrings'), e.id);
  });

  it('credits no hamstrings to bridges or the hip thrusts, nor to the jumps that land in a squat', () => {
    const bridges = CATALOGUE.filter((e) => e.pattern === 'hinge' && /bridge|thrust/.test(e.id));
    assert.deepEqual(bridges.map((e) => e.id), ['glute-bridge', 'single-leg-glute-bridge', 'hip-thrust', 'db-hip-thrust']);
    for (const e of bridges) assert.ok(!trains(e.id, 'hamstrings'), e.id);
    for (const id of ['snap-down', 'squat-jump', 'box-jump']) assert.ok(!trains(id, 'hamstrings'), id);
  });

  it('credits the adductors to the deep loaded squats and the leg press, and only those', () => {
    for (const id of ['back-squat', 'goblet-squat', 'leg-press', 'front-squat', 'double-kb-front-squat', 'hack-squat']) assert.ok(tags(id).helps.includes('adductors'), id);
    // Unloaded, part-range or one-leg squats: no adductor credit.
    for (const id of ['box-squat', 'bodyweight-squat', 'supported-squat', 'wall-sit', 'assisted-pistol', 'box-pistol']) assert.ok(!trains(id, 'adductors'), id);
  });

  it('leaves the lunges as they were (no training data either way)', () => {
    for (const id of ['split-squat', 'db-split-squat', 'bulgarian-split-squat', 'reverse-lunge', 'step-up']) assert.ok(tags(id).helps.includes('hamstrings'), id);
  });

  it('credits the forearms to grip work: every row, the Romanian deadlift and deadlift family, pull-ups and chin-ups, the dumbbell shrug (a heuristic)', () => {
    const rows = CATALOGUE.filter((e) => e.pattern === 'horizontal-pull');
    assert.ok(rows.length >= 12);
    for (const e of rows) assert.ok(trains(e.id, 'forearms'), e.id);
    // The family by name: every loaded Romanian deadlift and deadlift, the kettlebell's swings and clean beside them.
    const hinges = CATALOGUE.filter((e) => e.pattern === 'hinge' && /rdl|deadlift/.test(e.id));
    assert.deepEqual(hinges.map((e) => e.id), ['db-rdl', 'single-leg-rdl', 'rdl', 'deadlift', 'kb-deadlift', 'trap-bar-deadlift', 'kickstand-rdl']);
    for (const e of hinges) assert.ok(trains(e.id, 'forearms'), e.id);
    for (const id of ['kb-swing', 'single-arm-kb-swing', 'kb-clean']) assert.ok(trains(id, 'forearms'), id);
    for (const id of ['pull-up', 'assisted-pull-up', 'negative-pull-up', 'chin-up', 'weighted-pull-up', 'chest-to-bar-pull-up', 'flexed-arm-hang', 'assisted-pull-up-machine', 'db-shrug']) assert.ok(trains(id, 'forearms'), id);
  });

  it('keeps a movement that plans named by another\'s synonym on that one\'s tags, so their sets per muscle do not change', () => {
    // These names were synonyms of the entry beside them until the catalogue had a movement of their own.
    const was: [string, string][] = [['chin-up', 'pull-up'], ['weighted-pull-up', 'pull-up'], ['archer-push-up', 'push-up'], ['elevated-pike-push-up', 'pike-push-up'], ['walking-lunge', 'reverse-lunge'], ['assisted-pistol', 'box-pistol'], ['shrimp-squat', 'pistol-squat'], ['tuck-hollow-hold', 'hollow-hold'], ['one-leg-l-sit', 'tuck-l-sit'], ['l-sit', 'tuck-l-sit'], ['box-pike-hold', 'wall-handstand'], ['wall-walk', 'wall-handstand'], ['handstand-kick-up', 'wall-handstand'], ['freestanding-handstand', 'wall-handstand']];
    for (const [own, before] of was) assert.deepEqual(tags(own), tags(before), `${own} like ${before}`);
    // The ball curl holds a bridge as the slider curl does; a hold at the top of a pull-up is a pull-up's work.
    assert.deepEqual(tags('stability-ball-leg-curl'), tags('slider-leg-curl'));
    assert.deepEqual(tags('flexed-arm-hang'), tags('pull-up'));
  });

  it('tags the added movements by the same rules as their neighbours', () => {
    // A machine, cable or band version trains what the movement it stands beside trains.
    const alike: [string, string][] = [['lying-leg-curl', 'seated-leg-curl'], ['seated-calf-raise', 'machine-calf-raise'], ['band-lateral-raise', 'db-lateral-raise'], ['reverse-pec-deck', 'face-pull'], ['cable-overhead-triceps-extension', 'overhead-db-extension'], ['hip-abduction-machine', 'banded-side-walk']];
    for (const [added, like] of alike) assert.deepEqual(tags(added), tags(like), `${added} like ${like}`);
    // The slider curl holds a bridge throughout, so the glutes help.
    assert.deepEqual(tags('slider-leg-curl'), { main: ['hamstrings'], helps: ['glutes'] });
    // A fly: the front delts help, the elbows stay fixed (no triceps).
    assert.deepEqual(tags('pec-deck'), { main: ['chest'], helps: ['shoulders'] });
    assert.deepEqual(tags('db-shrug'), { main: ['upper-back'], helps: ['forearms'] });
    // Seated machines, cables, bands and floor work strain the abdomen little; heavy dumbbells held standing, moderately.
    for (const id of ['lying-leg-curl', 'slider-leg-curl', 'seated-calf-raise', 'band-lateral-raise', 'reverse-pec-deck', 'cable-overhead-triceps-extension', 'pec-deck', 'hip-abduction-machine']) assert.equal(CATALOGUE_BY_ID.get(id)!.iap, 'low', id);
    assert.equal(CATALOGUE_BY_ID.get('db-shrug')!.iap, 'moderate');
  });

  it('gives a typical plan of rows and hinges some forearm sets', () => {
    const fixture = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'plans', 'a-novice-dumbbells.json'), 'utf8')) as { input: { profile: Profile; today: string; options?: Record<string, unknown> } };
    const p = generatePlan({ profile: fixture.input.profile, today: fixture.input.today, options: (fixture.input.options ?? {}) as never }).value.proposal;
    assert.ok(p.volume.length > 0);
    for (const v of p.volume) assert.ok((v.perWeek['forearms'] ?? 0) > 0, `week ${v.week}`);
  });

  it('never tags one muscle as main and helping in the same entry', () => {
    for (const e of CATALOGUE) for (const m of e.muscles.helps) assert.ok(!e.muscles.main.includes(m), `${e.id}: ${m}`);
  });
});

describe('catalogue tags as the vault counts them', () => {
  it('puts every entry on plan-data\'s 14 groups, a main muscle never also a helper', () => {
    for (const e of CATALOGUE) {
      const t = planDataGroups(e.muscles);
      for (const m of [...t.main, ...t.helps]) assert.ok(m in PLAN_DATA_MUSCLES, `${e.id}: ${m}`);
      for (const m of t.helps) assert.ok(!t.main.includes(m), `${e.id}: ${m}`);
    }
    // The goblet squat's adductors land on glutes, already a main muscle: counted once.
    assert.deepEqual(planDataGroups(tags('goblet-squat')), { main: ['quads', 'glutes'], helps: ['abs', 'upper-back'] });
  });

  it('reads a catalogue movement with the catalogue\'s tags, by name or synonym, with or without a guide entry', () => {
    assert.deepEqual(canonicalTags('Face Pull', undefined), { tags: { main: ['upper-back'], helps: ['shoulders'], regions: ['shoulders-rear', 'upper-back-mid'] }, source: 'catalogue', catalogue: CATALOGUE_BY_ID.get('face-pull'), unknown: [], unknownRegions: [], regionsWithoutParent: [] });
    const chin = canonicalTags('Chin-up', { muscles: { main: ['lats', 'biceps'], helps: [] } });
    assert.equal(chin.source, 'catalogue');
    assert.deepEqual(chin.tags, { main: ['lats'], helps: ['biceps', 'upper-back', 'forearms'] });
    assert.deepEqual(chin.differs, { guide: { main: ['lats', 'biceps'], helps: [] }, catalogue: chin.tags });
  });

  it('keeps the guide\'s own tags for a movement the catalogue does not know, or with an override reason', () => {
    const band = canonicalTags('Cuban Press', { muscles: { main: ['shoulders'], helps: ['upper-back', 'shoulders'] } });
    assert.deepEqual([band.source, band.tags, band.catalogue], ['guide', { main: ['shoulders'], helps: ['upper-back'] }, null]);
    const own = canonicalTags('Face Pull', { muscles: { main: ['shoulders', 'upper-back'], helps: [], override: '  rear delts counted as shoulders  ' } });
    assert.deepEqual([own.source, own.override, own.tags], ['override', 'rear delts counted as shoulders', { main: ['shoulders', 'upper-back'], helps: [] }]);
  });

  it('leaves cardio and mobility items untagged, whatever the catalogue says', () => {
    const slide = canonicalTags('Wall slide', { muscles: { main: [], helps: [], kind: 'mobility', areas: ['shoulders'] } });
    assert.deepEqual([slide.source, slide.kind, slide.tags, slide.differs], ['guide', 'mobility', { main: [], helps: [] }, undefined]);
  });
});
