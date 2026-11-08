// The muscle regions (data/regions.ts): what is modelled, with what evidence,
// which catalogue movements bias each one, how a person's own words for a
// region are explained, and how review and the plan proposal report their
// sets.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CATALOGUE } from '../src/core/data/exercises.ts';
import { MUSCLE_IDS } from '../src/core/data/muscles.ts';
import { explainRegion, nearestText, parentMissingText, REGION_IDS, regionProblems, REGIONS, REGIONS_BY_ID, regionsOf, regionsWithoutParent, UNSUPPORTED_REGIONS } from '../src/core/data/regions.ts';
import { PLAN_DATA_MUSCLES } from '../src/core/plan-data.ts';
import { validateProfile, validateProgram } from '../src/core/validate.ts';
import { generatePlan } from '../src/core/plan/generate.ts';
import type { Profile } from '../src/core/schema.ts';
import { plannedSetsPerMuscle } from '../src/core/volume.ts';
import { run } from '../src/cli/cli.ts';
import { fixtureFiles, memoryIo, ROOT } from './helpers.ts';

const DOI = /^10\.\d{4,}\/\S+$/;

describe('muscle regions: the data', () => {
  it('prefixes every id with its parent muscle, a muscle plan-data counts, with unique ids', () => {
    assert.equal(new Set(REGION_IDS).size, REGIONS.length);
    for (const r of REGIONS) {
      assert.ok(MUSCLE_IDS.includes(r.muscle), r.id);
      assert.ok(r.id.startsWith(`${r.muscle}-`), r.id);
      assert.ok(r.muscle in PLAN_DATA_MUSCLES, `${r.id}: its parent is one of plan-data's groups, so a guide's copy needs no mapping`);
      assert.ok(r.label.trim() && r.note.trim(), r.id);
    }
  });

  it('models the regions the training studies support, and the back as a rough guide', () => {
    assert.deepEqual(REGION_IDS, ['quads-rf', 'quads-vasti', 'hamstrings-hip', 'hamstrings-knee', 'calves-gastroc', 'calves-soleus', 'triceps-long', 'shoulders-front', 'shoulders-side', 'shoulders-rear', 'chest-upper', 'upper-back-traps', 'upper-back-mid']);
    const grade = Object.fromEntries(REGIONS.map((r) => [r.id, r.grade]));
    for (const id of ['quads-rf', 'quads-vasti', 'hamstrings-hip', 'hamstrings-knee']) assert.equal(grade[id], 'moderate', id);
    for (const id of ['calves-gastroc', 'calves-soleus', 'triceps-long', 'shoulders-front', 'shoulders-side', 'chest-upper']) assert.equal(grade[id], 'weak', id);
    for (const id of ['shoulders-rear', 'upper-back-traps', 'upper-back-mid']) assert.equal(grade[id], 'heuristic', id);
    assert.deepEqual(REGIONS.filter((r) => r.roughGuide).map((r) => r.id), ['upper-back-traps', 'upper-back-mid']);
  });

  it('gives every graded region its sources; a heuristic one has none and is never in the coverage rule', () => {
    for (const r of REGIONS) {
      if (r.grade === 'heuristic') {
        assert.deepEqual(r.sources, [], r.id);
        assert.equal(r.coverage, false, r.id);
      } else {
        assert.ok(r.sources.length > 0, r.id);
      }
      for (const s of r.sources) assert.match(s.doi, DOI, `${r.id}: ${s.label}`);
      if (r.roughGuide) assert.equal(r.grade, 'heuristic', r.id);
    }
  });

  it('checks coverage for the Moderate and Weak regions, upper chest aside (declarable only)', () => {
    assert.deepEqual(REGIONS.filter((r) => r.coverage).map((r) => r.id), ['quads-rf', 'quads-vasti', 'hamstrings-hip', 'hamstrings-knee', 'calves-gastroc', 'calves-soleus', 'triceps-long', 'shoulders-front', 'shoulders-side']);
    assert.equal(REGIONS_BY_ID.get('chest-upper')!.coverage, false);
  });

  it('has a catalogue movement for every coverage region, one that trains its parent as a main muscle', () => {
    for (const r of REGIONS.filter((x) => x.coverage)) {
      const biasing = CATALOGUE.filter((e) => e.regions?.includes(r.id));
      assert.ok(biasing.length > 0, r.id);
      assert.ok(biasing.some((e) => e.muscles.main.includes(r.muscle)), `${r.id}: direct work exists`);
    }
  });

  it('lists a muscle\'s regions, none for a muscle without any', () => {
    assert.deepEqual(regionsOf('shoulders').map((r) => r.id), ['shoulders-front', 'shoulders-side', 'shoulders-rear']);
    assert.deepEqual(regionsOf('upper-back').map((r) => r.id), ['upper-back-traps', 'upper-back-mid']);
    assert.deepEqual(regionsOf('lats'), []);
    assert.deepEqual(regionsOf('glutes'), []);
  });
});

describe('muscle regions: the unsupported ones', () => {
  it('names none of them as a region, and each one\'s nearest option is a region or a muscle', () => {
    for (const u of UNSUPPORTED_REGIONS) {
      assert.ok(REGION_IDS.includes(u.nearest) || MUSCLE_IDS.includes(u.nearest), u.nearest);
      assert.ok(u.why.trim(), u.phrases[0]);
      for (const s of u.sources) assert.match(s.doi, DOI, s.label);
      for (const p of u.phrases) {
        assert.ok(!REGION_IDS.includes(p), p);
        assert.equal(explainRegion(p)?.kind, 'unsupported', `${p} reads as unsupported, never as a modelled region`);
      }
    }
  });

  it('explains the popular ones with the nearest supported option and why', () => {
    const near = (p: string) => {
      const e = explainRegion(p);
      assert.equal(e?.kind, 'unsupported', p);
      return e.kind === 'unsupported' ? e.entry : null;
    };
    for (const p of ['inner chest', 'Outer Chest', 'lower chest']) assert.equal(near(p)!.nearest, 'chest', p);
    assert.match(near('inner chest')!.why, /Pinto 2025/);
    for (const p of ['VMO', 'inner quad', 'outer quads', 'quad sweep']) assert.equal(near(p)!.nearest, 'quads-vasti', p);
    assert.match(near('vmo')!.why, /Smith 2009/);
    for (const p of ['upper lats', 'lower lats']) assert.equal(near(p)!.nearest, 'lats', p);
    for (const p of ['biceps peak', 'long head biceps', 'biceps short head', 'biceps long head']) assert.equal(near(p)!.nearest, 'biceps', p);
    // A bare "short head" names no muscle (the hamstrings have one too).
    assert.equal(explainRegion('short head'), null);
    for (const p of ['upper glutes', 'lower glutes']) assert.equal(near(p)!.nearest, 'glutes', p);
    assert.match(near('upper glutes')!.why, /Plotkin 2023/);
    assert.equal(nearestText(near('inner chest')!), 'the chest as a whole');
    assert.equal(nearestText(near('VMO')!), 'vasti (quads-vasti)');
  });
});

describe('muscle regions: explainRegion and regionProblems', () => {
  it('finds a modelled region by its id, its label or a common name, case and plurals aside', () => {
    const id = (p: string) => {
      const e = explainRegion(p);
      return e?.kind === 'region' ? e.region.id : null;
    };
    assert.equal(id('shoulders-side'), 'shoulders-side');
    assert.equal(id('Side Delts'), 'shoulders-side');
    assert.equal(id('side delt'), 'shoulders-side');
    assert.equal(id('lateral deltoid'), 'shoulders-side');
    assert.equal(id('upper chest'), 'chest-upper');
    assert.equal(id('the upper chest'), 'chest-upper');
    assert.equal(id('The Side Delts'), 'shoulders-side');
    assert.equal(id('long head of the triceps'), 'triceps-long');
    assert.equal(id('rectus femoris'), 'quads-rf');
    assert.equal(id('Gastrocnemius'), 'calves-gastroc');
    assert.equal(id('rhomboids'), 'upper-back-mid');
  });

  it('gives null for a whole muscle or words it does not know', () => {
    for (const p of ['glutes', 'chest', 'arms', '', '   ', 'rotator cuff']) assert.equal(explainRegion(p), null, JSON.stringify(p));
  });

  it('sorts declared values into unknown and unsupported ones, region ids passing', () => {
    const p = regionProblems(['shoulders-side', 'side delts', 'inner chest', 'nonsense', 'nonsense']);
    assert.deepEqual(p.unknown, ['side delts (use the id shoulders-side)', 'nonsense']);
    assert.equal(p.unsupported.length, 1);
    assert.match(p.unsupported[0]!, /^inner chest: nearest the chest as a whole\. A pec deck/);
    assert.deepEqual(regionProblems(REGION_IDS), { unknown: [], unsupported: [] });
  });

  it('finds the regions whose parent muscle the tags leave out', () => {
    assert.deepEqual(regionsWithoutParent({ main: ['shoulders'], helps: ['triceps'], regions: ['shoulders-side', 'triceps-long', 'quads-rf', 'quads-rf', 'mystery'] }), ['quads-rf']);
    assert.deepEqual(regionsWithoutParent({ main: ['chest'], helps: [] }), []);
    assert.equal(parentMissingText('quads-rf'), 'quads-rf (no quads in main or helps)');
  });
});

describe('muscle regions: the files', () => {
  const PROFILE = 'v/3-Personal/Fitness/Coach/profile.json';
  const profile = () => JSON.parse(fixtureFiles('v')[PROFILE]!) as Record<string, any>;
  const program = (regions: unknown) => ({
    schemaVersion: 1,
    id: 'p1',
    name: 'Plan',
    exercises: { press: { name: 'Press', unit: 'kg', increment: 2.5, muscles: { main: ['shoulders'], helps: ['triceps'], regions } } },
    macrocycle: { id: 'm1', name: 'Macro', start: '2026-03-02', phases: [{ id: 'ph1', name: 'Base', mesocycles: [{ id: 'me1', name: 'Meso', weeks: [{ index: 1, kind: 'loading', start: '2026-03-02', sessions: [{ id: 'a', name: 'A', kind: 'lift', slots: [{ exercise: 'press', sets: 3, repRange: [6, 10], rir: 2 }] }] }] }] }] },
  });

  it('accepts declared regions on the profile and its emphasis rows, and regions on an exercise\'s muscles', () => {
    const p = profile();
    p['priorityRegions'] = ['shoulders-side'];
    p['emphasis'][0].regions = ['chest-upper'];
    assert.deepEqual(validateProfile(p), []);
    assert.deepEqual(validateProgram(program(['shoulders-front', 'shoulders-side'])), []);
    p['priorityRegions'] = 'shoulders-side';
    assert.deepEqual(validateProfile(p).map((e) => e.path), ['priorityRegions']);
    assert.deepEqual(validateProgram(program([3])).map((e) => e.path), ['exercises.press.muscles.regions[0]']);
  });

  it('validate warns about region values the engine cannot use, an unsupported one with the nearest option and why', () => {
    const files = fixtureFiles('v');
    const p = profile();
    p['priorityRegions'] = ['shoulders-side', 'side delts', 'inner chest'];
    p['emphasis'][0].regions = ['VMO', 'mystery'];
    files['v/p.json'] = JSON.stringify(p);
    files['v/prog.json'] = JSON.stringify(program(['shoulders-side', 'upper lats']));
    const io = memoryIo(files);
    const r = run(['validate', 'v/p.json'], io);
    assert.equal(r.code, 0);
    const out = JSON.parse(r.stdout) as { valid: boolean; warnings: { code: string; message: string; items: string[] }[] };
    assert.equal(out.valid, true);
    const w = (code: string) => out.warnings.find((x) => x.code === code);
    assert.deepEqual(w('unknown-region')!.items, ['side delts (use the id shoulders-side)', 'mystery']);
    assert.match(w('unknown-region')!.message, /shoulders-side/);
    const unsupported = w('unsupported-region')!.items;
    assert.equal(unsupported.length, 2);
    assert.match(unsupported[0]!, /^inner chest: nearest the chest as a whole\. /);
    assert.match(unsupported[1]!, /^VMO: nearest vasti \(quads-vasti\)\. The vasti grow together/);
    const prog = JSON.parse(run(['validate', 'v/prog.json'], io).stdout) as { warnings: { code: string; items: string[] }[] };
    assert.deepEqual(prog.warnings.map((x) => x.code), ['unsupported-region']);
    assert.match(prog.warnings[0]!.items[0]!, /^upper lats: nearest the lats as a whole\. /);
    // A region of a muscle the exercise does not tag (the press trains shoulders and triceps, not quads).
    files['v/orphan.json'] = JSON.stringify(program(['shoulders-side', 'triceps-long', 'quads-rf']));
    const orphan = JSON.parse(run(['validate', 'v/orphan.json'], memoryIo(files)).stdout) as { valid: boolean; warnings: { code: string; items: string[] }[] };
    assert.equal(orphan.valid, true);
    assert.deepEqual(orphan.warnings.map((x) => [x.code, x.items]), [['region-parent-missing', ['press: quads-rf (no quads in main or helps)']]]);
    // The synthetic profile declares no regions: nothing to warn about.
    const plain = JSON.parse(run(['validate', PROFILE], io).stdout) as { warnings: { code: string }[] };
    assert.ok(!plain.warnings.some((x) => x.code.endsWith('-region')));
  });
});

describe('muscle regions: review counts them', () => {
  type Json = Record<string, any>;
  const PROFILE = 'v/3-Personal/Fitness/Coach/profile.json';

  it('reports every region, planned and done, against the region rules, with the target note', () => {
    const files = fixtureFiles('v');
    const profile = JSON.parse(files[PROFILE]!);
    profile.priorityMuscles = ['quads'];
    profile.priorityRegions = ['shoulders-side'];
    files[PROFILE] = JSON.stringify(profile);
    const j = JSON.parse(run(['review', '--vault', 'v', '--date', '2026-04-12'], memoryIo(files)).stdout) as Json;
    const rows = j.volume.regions as { value: Json; reason: Json }[];
    assert.deepEqual(rows.map((r) => r.value.id), REGION_IDS);
    const by = Object.fromEntries(rows.map((r) => [r.value.id, r]));
    // The plan's vasti: goblet squats 4 sets and split squats 3, each lifting session weighted 1.5 (3 a week over 2 types).
    assert.deepEqual(by['quads-vasti']!.value, {
      id: 'quads-vasti', muscle: 'quads', label: 'Vasti', grade: 'moderate', coverage: true, roughGuide: false, declared: false, priority: true,
      sets: 10.5, direct: 10.5, indirect: 0, hardDirect: 6, unknown: 4.5, done: { sets: 10, direct: 10, indirect: 0 }, rule: 'coverage', min: 4, counted: 10.5, status: 'ok',
    });
    assert.equal(by['quads-vasti']!.reason.note, 'Vasti: 10.5 direct sets a week, at or over the 4 direct sets a priority muscle\'s coverage region gets (heuristic).');
    assert.deepEqual([by['quads-rf']!.value.status, by['quads-rf']!.value.counted], ['short', 0]);
    // Declared: the side delts, held to 6 near failure; their muscle is a priority for the region rules, so the front delts (half credit only) are short.
    assert.deepEqual([by['shoulders-side']!.value.declared, by['shoulders-side']!.value.rule, by['shoulders-side']!.value.min, by['shoulders-side']!.value.status], [true, 'declared', 6, 'short']);
    assert.deepEqual([by['shoulders-front']!.value.direct, by['shoulders-front']!.value.indirect, by['shoulders-front']!.value.done, by['shoulders-front']!.value.status], [0, 3.25, { sets: 3.5, direct: 0, indirect: 3.5 }, 'short']);
    // A rough-guide region is reported with its numbers, held to nothing.
    assert.deepEqual([by['upper-back-mid']!.value.roughGuide, by['upper-back-mid']!.value.rule, by['upper-back-mid']!.value.sets, by['upper-back-mid']!.value.status], [true, null, 9, 'reported']);
    assert.equal(by['upper-back-mid']!.reason.rule, 'volume.regions');
    // The tallies under them, planned and done.
    assert.deepEqual(j.volume.planned.value.regions['quads-vasti'], { direct: 10.5, indirect: 0, hardDirect: 6, unknown: 4.5 });
    assert.deepEqual(j.volume.done.value.regions['quads-vasti'], { direct: 10, indirect: 0 });
  });

  it('declares nothing and holds nothing without priority muscles that have regions', () => {
    const j = JSON.parse(run(['review', '--vault', 'v', '--date', '2026-04-12'], memoryIo(fixtureFiles('v'))).stdout) as Json;
    assert.ok((j.volume.regions as { value: Json }[]).every((r) => r.value.rule === null && r.value.status === 'reported' && !r.value.declared));
  });
});

describe('muscle regions: the plan proposal reports them', () => {
  it('gives each loading week its region sets, the same count review makes, without planning by region', () => {
    const fixture = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'plans', 'a-novice-dumbbells.json'), 'utf8')) as { input: { profile: Profile; today: string; options?: Record<string, unknown> } };
    const r = generatePlan({ profile: fixture.input.profile, today: fixture.input.today, options: (fixture.input.options ?? {}) as never }).value;
    const p = r.proposal;
    assert.ok(p.volume.length > 0);
    const weeks = r.program!.macrocycle.phases.flatMap((ph) => ph.mesocycles.flatMap((m) => m.weeks));
    for (const v of p.volume) {
      const week = weeks[v.week - 1]!;
      const counted = plannedSetsPerMuscle(week.sessions.filter((t) => t.kind === 'lift'), r.program!.exercises).value.regions;
      assert.deepEqual(Object.keys(v.regions ?? {}).sort(), Object.keys(counted ?? {}).sort(), `week ${v.week}`);
      for (const [id, s] of Object.entries(v.regions ?? {})) assert.equal(s.direct, counted![id]!.direct, `week ${v.week} ${id}`);
    }
    assert.ok(p.volume.some((v) => Object.keys(v.regions ?? {}).length > 0), 'a dumbbell plan biases some region');
  });
});
