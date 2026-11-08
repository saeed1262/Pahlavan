// `engine catalogue`: the movement catalogue searched by pattern, region,
// muscle, equipment, level and text, in the one display order every list of
// catalogue options uses (the plan check's region options among them); the
// long-length versions of two-joint muscles; and movements outside the
// catalogue, counted and checked from their guide entry.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { run } from '../src/cli/cli.ts';
import { CATALOGUE, CATALOGUE_BY_ID, usableWith } from '../src/core/data/exercises.ts';
import { MUSCLE_IDS } from '../src/core/data/muscles.ts';
import { REGION_IDS, REGIONS_BY_ID } from '../src/core/data/regions.ts';
import { CatalogueQueryError, rankMovements, searchCatalogue } from '../src/report/catalogue.ts';
import { buildCheck, type CheckReport } from '../src/report/check.ts';
import { buildReview } from '../src/report/review.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

type Json = Record<string, any>;
const PLAN = 'v/3-Personal/Fitness/plan-data.json';
const PROFILE = 'v/3-Personal/Fitness/Coach/profile.json';
const LEDGER = 'v/3-Personal/Fitness/Coach/ledger.json';
/** After the fixture's abdominal constraint ends: no hard error. */
const CLEAN = '2026-04-20';

function vault(edit: (plan: Json, profile: Json, ledger: Json) => void, date = CLEAN) {
  const files = fixtureFiles('v');
  const plan = JSON.parse(files[PLAN]!);
  const profile = JSON.parse(files[PROFILE]!);
  const ledger = JSON.parse(files[LEDGER]!);
  edit(plan, profile, ledger);
  files[PLAN] = JSON.stringify(plan);
  files[PROFILE] = JSON.stringify(profile);
  files[LEDGER] = JSON.stringify(ledger);
  return readVault(memoryIo(files), 'v', { asOf: date });
}
const check = (edit: (plan: Json, profile: Json, ledger: Json) => void, date = CLEAN): CheckReport => buildCheck(vault(edit, date), date);
const parse = (r: { stdout: string }) => JSON.parse(r.stdout) as Json;
/** A loading week of the fixture (CLEAN is plan week 8, a light week with half the sets). */
const LOADING = '2026-04-14';
const ids = (r: ReturnType<typeof searchCatalogue>) => r.movements.map((m) => m.id);

describe('catalogue: the search and its display order', () => {
  it('marks long-length versions only for a muscle (or region) the movement trains as a main muscle', () => {
    const marked = CATALOGUE.filter((e) => e.longLength?.length);
    assert.deepEqual(marked.map((e) => e.id), ['seated-leg-curl', 'calf-raise', 'machine-calf-raise', 'single-leg-calf-raise', 'overhead-db-extension', 'cable-overhead-triceps-extension']);
    for (const e of marked) {
      for (const x of e.longLength!) {
        const muscle = REGIONS_BY_ID.get(x)?.muscle ?? (MUSCLE_IDS.includes(x) ? x : null);
        assert.ok(muscle, `${e.id}: ${x} is neither a muscle nor a region`);
        assert.ok(e.muscles.main.includes(muscle), `${e.id}: ${x} is not a main muscle of it`);
        if (REGIONS_BY_ID.has(x)) assert.ok(e.regions?.includes(x), `${e.id}: ${x} is a region it does not bias`);
      }
    }
  });

  it('ranks the version that loads a two-joint muscle long first: seated before lying leg curl, overhead before pushdown, standing before seated calf raise', () => {
    const ham = ids(searchCatalogue({ muscle: 'hamstrings' }));
    assert.ok(ham.indexOf('seated-leg-curl') < ham.indexOf('lying-leg-curl'));
    assert.equal(ham[0], 'seated-leg-curl');
    assert.deepEqual(ids(searchCatalogue({ region: 'hamstrings-knee' })), ['seated-leg-curl', 'lying-leg-curl', 'slider-leg-curl', 'stability-ball-leg-curl', 'nordic-negative', 'nordic-curl']);
    const tri = ids(searchCatalogue({ muscle: 'triceps' }));
    assert.deepEqual(tri.slice(0, 3), ['overhead-db-extension', 'cable-overhead-triceps-extension', 'cable-pushdown']);
    assert.deepEqual(ids(searchCatalogue({ muscle: 'calves' })).slice(0, 4), ['calf-raise', 'machine-calf-raise', 'single-leg-calf-raise', 'seated-calf-raise']);
    // The soleus crosses one joint: no long-length order among its options.
    assert.ok(searchCatalogue({ region: 'calves-soleus' }).movements.every((m) => !m.fit.longLength));
  });

  it('ranks the muscle as main before helping, then the most targeted; a region\'s muscle stands in for the muscle', () => {
    const r = searchCatalogue({ muscle: 'hamstrings' });
    const roles = r.movements.map((m) => m.fit.role);
    assert.equal(roles.lastIndexOf('main') < roles.indexOf('helps'), true);
    assert.deepEqual(ids(searchCatalogue({ region: 'shoulders-side' })).slice(0, 3), ['band-lateral-raise', 'db-lateral-raise', 'cable-lateral-raise']);
  });

  it('filters by pattern, region, muscle, the equipment at hand (in the profile\'s words) and text; the level only orders', () => {
    const r = searchCatalogue({ region: 'side delts', equipment: ['dumbbells', 'bands'], level: 'beginner' });
    assert.equal(r.filters.region, 'shoulders-side');
    assert.deepEqual(r.filters.equipment, ['bodyweight', 'dumbbell', 'band']);
    assert.deepEqual(ids(r), ['band-lateral-raise', 'db-lateral-raise', 'band-overhead-press', 'standing-db-press', 'pike-push-up', 'kb-press', 'elevated-pike-push-up', 'wall-handstand-push-up']);
    assert.equal(r.movements.at(-1)!.fit.aboveLevel, true, 'a harder movement is listed, after the beginner ones');
    assert.ok(r.movements.every((m) => usableWith(m, new Set(['dumbbell', 'band']))));
    // A tool that stands in for the defining one counts: a dumbbell for the kettlebell press.
    assert.deepEqual([CATALOGUE_BY_ID.get('kb-press')!.equipment, CATALOGUE_BY_ID.get('kb-press')!.alsoWith], [['kettlebell'], ['dumbbell']]);
    assert.ok(searchCatalogue({ pattern: 'hinge' }).movements.every((m) => m.pattern === 'hinge'));
    assert.ok(searchCatalogue({ muscle: 'Upper back' }).movements.every((m) => m.muscles.main.includes('upper-back') || m.muscles.helps.includes('upper-back')));
    const q = searchCatalogue({ query: 'leg curl' });
    assert.deepEqual(ids(q), ['seated-leg-curl', 'lying-leg-curl', 'slider-leg-curl', 'stability-ball-leg-curl']);
    assert.deepEqual(q.movements.map((m) => m.fit.query), ['exact', 'name', 'name', 'name']);
    assert.deepEqual(ids(searchCatalogue({ region: 'shoulders-side', level: 'novice' as never })), ids(searchCatalogue({ region: 'shoulders-side', level: 'beginner' })));
    // A level never removes a movement.
    assert.equal(searchCatalogue({ level: 'beginner' }).count, CATALOGUE.length);
  });

  it('gives each movement its tags, regions, strain tag, level, easier and harder versions and other names', () => {
    const m = searchCatalogue({ query: 'hamstring curl' }).movements[0]!;
    assert.equal(m.id, 'seated-leg-curl');
    assert.deepEqual(m.muscles, { main: ['hamstrings'], helps: [] });
    assert.deepEqual([m.regions, m.longLength, m.abdominalStrain, m.level], [['hamstrings-knee'], ['hamstrings'], 'low', 'beginner']);
    assert.deepEqual(m.harder, [{ id: 'db-rdl', name: 'Dumbbell Romanian deadlift' }]);
    assert.ok(m.aliases.includes('hamstring curl') && m.aliases.includes('leg curl'));
  });

  it('gives each movement its guide text, demand tags, roles, stand-in tools and whether it suits a hotel room', () => {
    const swing = searchCatalogue({ query: 'russian swing' }).movements[0]!;
    assert.equal(swing.id, 'kb-swing');
    assert.deepEqual([swing.alsoWith, swing.risk, swing.uses, swing.hotel], [['dumbbell'], ['joint:back-bent-over', 'demand:vigorous'], [], false]);
    assert.deepEqual(Object.keys(swing.guide), ['setup', 'do', 'avoid']);
    assert.match(swing.guide.avoid, /arms/);
    // Its aliases are among its other names, normalized.
    assert.ok(swing.aliases.includes('russian swing') && swing.aliases.includes('dumbbell swing'));
    const v = searchCatalogue({}).vocabulary;
    assert.ok(v.risk.some((t) => t.id === 'demand:impact' && /landing/.test(t.meaning)));
    assert.deepEqual(v.uses.map((u) => u.id), ['warm-up', 'cool-down', 'posture', 'balance', 'desk-break']);
    assert.ok(v.patterns.includes('jump') && v.equipment.ids.includes('parallel-bars'));
  });

  it('finds the later patterns and tools: the jumps, a dip station\'s dips, a stand-in kettlebell', () => {
    assert.deepEqual(ids(searchCatalogue({ pattern: 'jump' })), ['snap-down', 'pogo-hop', 'squat-jump', 'box-jump', 'skater-bound']);
    const dips = searchCatalogue({ pattern: 'horizontal-push', equipment: ['dip station'] });
    assert.deepEqual(dips.filters.equipment, ['bodyweight', 'parallel-bars']);
    assert.ok(['negative-dip', 'parallel-bar-dip'].every((id) => ids(dips).includes(id)));
    // A kettlebell alone stands in for the dumbbell of the goblet squat.
    assert.ok(ids(searchCatalogue({ pattern: 'squat', equipment: ['kettlebell'] })).includes('goblet-squat'));
    assert.ok(!ids(searchCatalogue({ pattern: 'squat', equipment: [] })).includes('goblet-squat'));
  });

  it('searches an unsupported region\'s nearest option, saying why; unknown words are errors naming the known ones', () => {
    const r = searchCatalogue({ region: 'inner chest' });
    assert.deepEqual([r.filters.region, r.filters.muscle], [null, 'chest']);
    assert.match(r.notes[0]!.items![0]!, /^inner chest: nearest the chest as a whole\. A pec deck grew both heads/);
    assert.deepEqual(searchCatalogue({ region: 'VMO' }).filters.region, 'quads-vasti');
    assert.throws(() => searchCatalogue({ region: 'upper abs' }), CatalogueQueryError);
    assert.throws(() => searchCatalogue({ region: 'upper abs' }), /--region: "upper abs" is not a muscle region; the regions are quads-rf/);
    assert.throws(() => searchCatalogue({ muscle: 'pecs' }), /--muscle: "pecs" is not a muscle/);
    // Free-text equipment is left out with a note, as the profile reads it.
    const smith = searchCatalogue({ muscle: 'quads', equipment: ['smith machine', 'dumbbells'] });
    assert.deepEqual(smith.filters.equipment, ['bodyweight', 'dumbbell']);
    assert.deepEqual(smith.notes.map((n) => [n.code, n.items]), [['unknown-equipment', ['smith machine']]]);
    assert.match(smith.notes[0]!.message, /left out: the search uses the rest\. The words are bodyweight/);
    assert.ok(smith.count > 0);
    assert.throws(() => searchCatalogue({ pattern: 'press' as never }), /--pattern: "press" is not a movement pattern/);
    assert.equal(searchCatalogue({ muscle: 'neck', equipment: [] }).count, 2);
    assert.equal(searchCatalogue({ pattern: 'carry', equipment: [] }).notes[0]!.code, 'no-match');
  });

  it('brings the ladders whose levels are among the results (all with no filter), and the plan\'s own', () => {
    const all = searchCatalogue({}).ladders;
    assert.deepEqual(all.filter((l) => l.source === 'engine').map((l) => l.id), ['pullup', 'pushup', 'hollow', 'legs']);
    assert.equal(all.filter((l) => l.source === 'catalogue').length, 20);
    // A catalogue ladder's levels are its steps, each a catalogue movement.
    const dip = all.find((l) => l.source === 'catalogue' && l.id === 'dip')!;
    assert.deepEqual(dip.levels.map((x) => x.exercise), ['bench-dip', 'parallel-bar-support-hold', 'negative-dip', 'parallel-bar-dip', 'ring-dip']);
    assert.deepEqual(dip.levels[0], { level: 1, name: 'Bench dip', exercise: 'bench-dip', exerciseName: 'Bench dip' });
    assert.deepEqual(searchCatalogue({ pattern: 'vertical-pull' }).ladders.map((l) => `${l.source} ${l.id}`), ['engine pullup', 'catalogue pull-up', 'catalogue muscle-up']);
    assert.deepEqual(searchCatalogue({ pattern: 'calves' }).ladders, []);
    const plan = JSON.parse(fixtureFiles('v')[PLAN]!).ladders;
    const skill = searchCatalogue({ pattern: 'skill' }, { planLadders: plan }).ladders;
    const hs = skill.find((l) => l.id === 'handstand' && l.source === 'plan')!;
    assert.ok(skill.some((l) => l.id === 'handstand' && l.source === 'catalogue'), 'the catalogue\'s handstand ladder too');
    // Each level matched by name to its own catalogue movement.
    assert.deepEqual(hs.levels.map((x) => x.exercise), ['box-pike-hold', 'wall-walk', 'wall-handstand']);
  });

  it('is the order the plan check gives a short region\'s options in', () => {
    const r = check((_p, pr) => (pr.priorityRegions = ['shoulders-side']));
    const item = r.findings.find((f) => f.code === 'region-declared-short')!.items[0]!;
    const options = item.split('; options: ')[1]!.split(', ');
    // The fixture: dumbbells, cable, barbell and bench; an intermediate; the Ledger rules the standing barbell press out.
    const order = rankMovements(CATALOGUE.filter((e) => e.regions?.includes('shoulders-side')), { region: 'shoulders-side', level: 'intermediate' }).map((x) => x.entry.name);
    const expected = order.filter((n) => options.includes(n));
    assert.deepEqual(options, expected);
    assert.deepEqual(options, ['Dumbbell lateral raise', 'Cable lateral raise', 'Seated dumbbell shoulder press', 'Pike push-up', 'Elevated pike push-up (feet on a chair or box)']);
  });
});

describe('movements outside the catalogue count and are checked from their guide entry', () => {
  const sissy = (muscles: Json | null) => (p: Json, pr: Json) => {
    pr.priorityMuscles = ['quads'];
    pr.equipment.push('machines');
    p.sessions.A.push({ name: 'Sissy Squat', sr: '3 × 10–15', rest: '90 s', rir: 1, note: 'Why: the rectus femoris, at home.' });
    if (muscles) p.guide['Sissy Squat'] = { muscles };
  };

  it('counts its guide muscles and regions like a catalogue movement\'s, and notes only that the catalogue does not know it', () => {
    const r = check(sissy({ main: ['quads'], helps: [], regions: ['quads-rf'] }));
    // 3 sets in A, A weighted 1.5 a week: 4.5 direct rectus femoris sets meet the coverage rule.
    assert.equal(r.findings.find((f) => f.code === 'region-coverage'), undefined);
    assert.ok(r.findings.some((f) => f.code === 'unknown-exercise' && f.level === 'info' && f.items.includes('Sissy Squat')));
    assert.equal(r.findings.find((f) => f.code === 'no-muscles'), undefined);
    const review = buildReview(vault(sissy({ main: ['quads'], helps: [], regions: ['quads-rf'] }), LOADING).data, LOADING);
    const rf = review.volume.regions.map((x: Json) => x.value).find((x: Json) => x.id === 'quads-rf');
    assert.deepEqual([rf.direct, rf.status], [4.5, 'ok']);
    const without = buildReview(vault(sissy(null), LOADING).data, LOADING).volume.regions.map((x: Json) => x.value).find((x: Json) => x.id === 'quads-rf');
    assert.equal(without.direct, 0);
  });

  it('warns only when its guide entry gives no muscles', () => {
    const r = check(sissy(null));
    const w = r.findings.find((f) => f.code === 'no-muscles')!;
    assert.equal(w.level, 'warning');
    assert.deepEqual(w.items, ['Sissy Squat']);
    assert.ok(r.findings.some((f) => f.code === 'region-coverage'), 'its sets count nowhere, so the rectus femoris is short');
  });
});

describe('cli: catalogue', () => {
  const io = memoryIo(fixtureFiles('v'));

  it('catalogue: the search, with the plan\'s own ladders from --vault; an unknown word is a usage error', () => {
    const r = run(['catalogue', '--json', '--muscle', 'hamstrings', '--equipment', 'machines', '--level', 'beginner'], io);
    assert.equal(r.code, 0);
    const j = parse(r);
    assert.deepEqual(j.movements.slice(0, 2).map((m: Json) => m.id), ['seated-leg-curl', 'lying-leg-curl']);
    assert.match(j.order, /for display only, never a choice/);
    const withVault = parse(run(['catalogue', '--json', '--pattern', 'skill', '--vault', 'v'], io));
    assert.ok(withVault.ladders.some((l: Json) => l.id === 'handstand' && l.source === 'plan'));
    const unsupported = parse(run(['catalogue', '--json', '--region', 'upper glutes'], io));
    assert.equal(unsupported.warnings[0].code, 'unsupported-region');
    assert.equal(unsupported.filters.muscle, 'glutes');
    const bad = run(['catalogue', '--json', '--level', 'expert'], io);
    assert.equal(bad.code, 2);
    assert.match(parse(bad).errors[0].message, /--level must be beginner, intermediate, advanced/);
    assert.equal(run(['catalogue', '--json', '--muscle'], io).code, 2);
    for (const id of MUSCLE_IDS) assert.equal(run(['catalogue', '--json', '--muscle', id], io).code, 0, id);
    for (const id of REGION_IDS) assert.ok(parse(run(['catalogue', '--json', '--region', id], io)).count > 0, `${id} has a catalogue movement (${REGIONS_BY_ID.get(id)!.label})`);
  });
});
