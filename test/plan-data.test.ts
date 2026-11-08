// plan-data.json's conventions and the exporter from a schema-v1 program.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { matchCatalogue } from '../src/adapters/vault/catalogue-match.ts';
import { canonicalTags } from '../src/adapters/vault/muscle-tags.ts';
import { readVault } from '../src/adapters/vault/read.ts';
import { generatePlan } from '../src/core/plan/generate.ts';
import {
  dashboardSets,
  deloadSr,
  exerciseId,
  formatSr,
  itemFieldProblems,
  itemRir,
  itemSets,
  itemTimed,
  ladderStartOf,
  parseNote,
  parseSr,
  phaseNamesFrom,
  PLAN_DATA_KEYS,
  PLAN_DATA_MUSCLES,
  planDataGroups,
  sameMuscles,
  toEngineMuscles,
  toPlanData,
  toPlanDataMuscles,
  type PlanData,
} from '../src/core/plan-data.ts';
import { CATALOGUE_BY_ID } from '../src/core/data/exercises.ts';
import { MUSCLE_IDS } from '../src/core/data/muscles.ts';
import type { ExerciseSlot, Profile, Program } from '../src/core/schema.ts';
import type { SlotExtras } from '../src/core/plan-data.ts';
import { readRules } from '../src/core/rules.ts';
import { fixtureFiles, fsIo, memoryIo, ROOT, VAULT } from './helpers.ts';

const planPath = join(VAULT, '3-Personal', 'Fitness', 'plan-data.json');
const planText = readFileSync(planPath, 'utf8');
const plan = JSON.parse(planText) as PlanData;
const program = () => readVault(fsIo, VAULT, { asOf: '2026-04-12' }).data.program;

describe('plan-data conventions', () => {
  it('turns names into engine ids, case-insensitively', () => {
    assert.equal(exerciseId('45° Back Extension'), '45-back-extension');
    assert.equal(exerciseId('Circuit: squat jump · burpee'), 'circuit-squat-jump-burpee');
    assert.equal(exerciseId('Dead Bug'), exerciseId('Dead bug'));
    assert.equal(exerciseId('***'), 'exercise');
  });

  it('parses sets and reps the way the sheets write them', () => {
    assert.deepEqual(parseSr('4 × 8–10'), { sets: 4, repRange: [8, 10], seconds: false, per: null, minutes: null, rounds: null });
    assert.deepEqual(parseSr('3 × 8/leg').repRange, [8, 8]);
    assert.equal(parseSr('3 × 10–12/arm').per, 'arm');
    assert.deepEqual(parseSr('3 × 20–40 s/side'), { sets: 3, repRange: [20, 40], seconds: true, per: 'side', minutes: null, rounds: null });
    assert.deepEqual([parseSr('6 min').sets, parseSr('6 min').minutes], [null, 6]);
    assert.deepEqual([parseSr('4 rounds, 40/20').sets, parseSr('4 rounds, 40/20').rounds], [null, 4]);
  });

  it('counts sets as the dashboard\'s setsOf does', () => {
    assert.equal(dashboardSets('3 × 8/leg'), 3);
    assert.equal(dashboardSets('2 working sets'), 2);
    assert.equal(dashboardSets('5–10 min'), 3);
    assert.equal(dashboardSets('3 min'), 2);
    assert.equal(dashboardSets('20 min'), 10);
    assert.equal(dashboardSets('4 rounds, 40/20'), 1);
    assert.equal(deloadSr('4 × 8–10'), '2 × 8–10');
    assert.equal(deloadSr('6 min'), '6 min');
  });

  it('reads until, Replaces and RIR from a note', () => {
    assert.deepEqual(parseNote('until 2026-04-19: knee niggle, easing. Replaces Barbell Back Squat. RIR 2. Elbows in.'), {
      until: { date: '2026-04-19', reason: 'knee niggle, easing' },
      replaces: 'Barbell Back Squat',
      rir: 2,
      why: null,
    });
    assert.deepEqual(parseNote(''), { until: null, replaces: null, rir: null, why: null });
    // The plan's own reason: from "Why:" to the end of the note.
    assert.equal(parseNote('RIR 2. Linear: add one step each session every rep is made. Why: the main horizontal press; flat pressing because overhead reach is limited.').why, 'the main horizontal press; flat pressing because overhead reach is limited.');
    assert.equal(parseNote('RIR 2. Why:   ').why, null);
    assert.equal(parseNote('until 2026-05-01').until!.reason, 'temporary change');
    assert.equal(formatSr(3, [10, 12], { per: 'arm' }), '3 × 10–12/arm');
    assert.equal(formatSr(2, [15, 15]), '2 × 15');
  });

  it('maps plan-data muscle ids to engine ids and back, listing approximations', () => {
    assert.equal(Object.keys(PLAN_DATA_MUSCLES).length, 14);
    for (const [p, e] of Object.entries(PLAN_DATA_MUSCLES)) assert.ok(MUSCLE_IDS.includes(e), `${p} -> ${e}`);
    assert.deepEqual(toEngineMuscles({ main: ['quads', 'hip-flexors'], helps: ['calves'] }), { muscles: { main: ['quads'], helps: ['calves'] }, unknown: ['hip-flexors'] });
    assert.deepEqual(toPlanDataMuscles({ main: ['glutes', 'abductors'], helps: ['neck'] }), { main: ['glutes'], helps: ['upper-back'], approximated: ['abductors', 'neck'] });
  });

  it('never counts a muscle as main and helping at once: the lunge\'s adductors land on glutes, already main', () => {
    const lunge = CATALOGUE_BY_ID.get('reverse-lunge')!.muscles;
    assert.deepEqual(lunge, { main: ['quads', 'glutes'], helps: ['hamstrings', 'adductors'] });
    assert.deepEqual(toPlanDataMuscles(lunge), { main: ['quads', 'glutes'], helps: ['hamstrings'], approximated: ['adductors'] });
    assert.deepEqual(planDataGroups(lunge), { main: ['quads', 'glutes'], helps: ['hamstrings'] });
    assert.deepEqual(toEngineMuscles({ main: ['glutes'], helps: ['glutes', 'hamstrings', 'hamstrings'] }).muscles, { main: ['glutes'], helps: ['hamstrings'] });
  });

  it('compares muscle tags as sets', () => {
    assert.ok(sameMuscles({ main: ['quads', 'glutes'], helps: ['abs', 'lower-back'] }, { main: ['glutes', 'quads'], helps: ['lower-back', 'abs'] }));
    assert.ok(!sameMuscles({ main: ['shoulders', 'upper-back'], helps: [] }, { main: ['upper-back'], helps: ['shoulders'] }));
  });
});

describe('plan items: the rir and timed fields, read first', () => {
  it('rir: the field (a number, or [lo, hi]), else the note; a field that is not one falls back to the note and says why', () => {
    assert.deepEqual(itemRir({ rir: 2, note: 'RIR 3. Hinge.' }), { lo: 2, hi: 2 });
    assert.deepEqual(itemRir({ rir: [2, 1] }), { lo: 1, hi: 2 });
    assert.deepEqual(itemRir({ note: 'RIR 1–2. Strict.' }), { lo: 1, hi: 2 });
    assert.deepEqual(itemRir({ rir: '2', note: 'RIR 3.' }), { lo: 3, hi: 3 });
    assert.equal(itemRir({ note: 'Chest up.' }), null);
    assert.deepEqual(itemFieldProblems({ rir: '2' }), ['rir is "2", not a number of reps in reserve or [lo, hi]']);
    assert.deepEqual(itemFieldProblems({ rir: [1, 2], timed: { minutes: 20 } }), []);
  });

  it('timed: the field, else the minutes in sr and the intervals the note describes; a sets item has none', () => {
    assert.deepEqual(itemTimed({ sr: '22 min', timed: { minutes: 30, rounds: 4, workMin: 4, restMin: 3 } }), { minutes: 30, rounds: 4, workMin: 4, restMin: 3 });
    assert.deepEqual(itemTimed({ sr: '22 min', note: '4 × 4 min hard, 3 min easy between. Why: intervals.' }), { minutes: 22, rounds: 4, workMin: 4, restMin: 3 });
    assert.deepEqual(itemTimed({ sr: '5–10 min' }), { minutes: 5 });
    assert.equal(itemTimed({ sr: '3 × 8–10', note: 'RIR 2.' }), null);
    assert.equal(itemTimed({ sr: '4 rounds, 40/20' }), null);
    // Not a structure: read from sr and the note as before, with the reason.
    assert.deepEqual(itemTimed({ sr: '20 min', timed: { rounds: 4 } }), { minutes: 20 });
    assert.deepEqual(itemFieldProblems({ timed: { rounds: 4 } }), ['timed needs minutes, or rounds with workMin']);
    assert.deepEqual(itemFieldProblems({ timed: { minutes: 0, laps: 3 } }), ['timed minutes is 0, not minutes above 0', 'timed has an unknown key "laps"']);
  });

  it('sets: a timed item\'s rounds (1 for steady minutes), else "N ×", "N sets" or "N rounds", else 1; never minutes halved', () => {
    assert.equal(itemSets({ sr: '22 min' }), 1);
    assert.equal(itemSets({ sr: '22 min', note: '4 × 4 min hard, 3 min easy between.' }), 4);
    assert.equal(itemSets({ sr: '30 min', timed: { minutes: 30, rounds: 5, workMin: 3, restMin: 2 } }), 5);
    assert.equal(itemSets({ sr: '3 × 8/leg' }), 3);
    assert.equal(itemSets({ sr: '2 working sets' }), 2);
    assert.equal(itemSets({ sr: '4 rounds, 40/20' }), 4);
    assert.equal(itemSets({ sr: 'as written' }), 1);
    assert.equal(dashboardSets('22 min'), 11, 'the log\'s count of a timed line is unchanged');
  });
});

/** The synthetic plan with the guide's muscle copies of these entries as `out` has them: the only part of an unchanged plan the exporter rewrites. */
const withGuideOf = (out: PlanData, keys: readonly string[], base: PlanData = plan): PlanData => ({ ...base, guide: { ...base.guide, ...Object.fromEntries(keys.map((k) => [k, out.guide[k]!])) } });
/** This week's catalogue movements whose guide copy differs from the catalogue (as sets). */
const RETAGGED = ['Goblet Squat', 'Face Pull', 'Seated Cable Row', 'Bulgarian Split Squat', 'Side Plank', 'Dead Bug'];
/** This week's catalogue movements whose guide copy has the catalogue's muscles but not yet its regions. */
const REGIONED = ['Flat DB Bench Press', 'Romanian Deadlift', 'Floor push-up'];
/** Every guide entry an unchanged plan's export rewrites. */
const REWRITTEN = [...RETAGGED, ...REGIONED];

describe('exporter: round trip', () => {
  it('writes the synthetic plan-data.json back unchanged, except the guide\'s muscle copies the catalogue retags', () => {
    const r = toPlanData(program());
    const out = r.value.planData;
    // This week's catalogue movements whose guide copy differs from the catalogue (as sets): the copy follows the catalogue, its regions included, nothing else in the entry changes.
    for (const k of RETAGGED) {
      const c = canonicalTags(k, plan.guide[k]);
      assert.equal(c.source, 'catalogue', k);
      assert.ok(c.differs, k);
      assert.deepEqual(out.guide[k], { ...plan.guide[k], muscles: c.tags }, k);
    }
    // A copy with the catalogue's muscles gains only the catalogue's regions: its muscles stay as written, in the writer's order.
    for (const k of REGIONED) {
      const c = canonicalTags(k, plan.guide[k]);
      assert.equal(c.differs, undefined, k);
      assert.ok(c.tags.regions?.length, k);
      assert.deepEqual(out.guide[k], { ...plan.guide[k], muscles: { ...plan.guide[k]!.muscles!, regions: c.tags.regions } }, k);
    }
    assert.deepEqual(out, withGuideOf(out, REWRITTEN));
    assert.deepEqual(Object.keys(out), Object.keys(plan));
    assert.equal(`${JSON.stringify({ ...out, guide: { ...out.guide, ...Object.fromEntries(REWRITTEN.map((k) => [k, plan.guide[k]!])) } }, null, 2)}\n`, planText);
    assert.deepEqual(r.value.unexpressible, []);
    assert.deepEqual(r.value.types, { A: 'a', B: 'b', S1: 's1', S3: 's3' });
    assert.equal(r.value.week.start, '2026-03-09');
  });

  it('exports the loading week when asked for a deload week, and says so', () => {
    const r = toPlanData(program(), { date: '2026-03-25' });
    assert.equal(r.value.week.start, '2026-03-16');
    assert.deepEqual(r.value.planData.sessions, plan.sessions);
    assert.equal(r.value.unexpressible[0]!.what, 'deload week');
  });

  it('rewrites only what changed: a slot with fewer sets gets a new sr, the rest of the item is kept', () => {
    const p = program();
    const weeks = p.macrocycle.phases.flatMap((ph) => ph.mesocycles.flatMap((m) => m.weeks));
    const a = weeks[1]!.sessions.find((t) => t.id === 'a')!;
    weeks[1]!.sessions = weeks[1]!.sessions.map((t) => (t.id === 'a' ? { ...a, slots: a.slots.map((s, i) => (i === 2 ? { ...s, sets: 2 } : s)) } : t));
    const out = toPlanData(p, { date: '2026-03-09' }).value.planData;
    const face = out.sessions['A']![2]!;
    assert.equal(face.sr, '2 × 15');
    assert.equal(face.table, 'Face Pull (rope)');
    assert.equal(face.label, 'Face Pull');
    assert.equal(face.rest, '—');
    // The RIR moves from the note into the item's rir field.
    assert.equal(face.note, 'Light.');
    assert.equal(face.rir, 2);
    assert.deepEqual(out.sessions['A']![0], plan.sessions['A']![0]);
    assert.deepEqual(out.lifts, plan.lifts);
  });
});

describe('exporter: the standing rules', () => {
  const PLAN = 'v/3-Personal/Fitness/plan-data.json';
  const RULES = { lightWeeks: { weeks: [4, 8, 12], sets: 'half' }, stall: { response: 'report' } };
  const withRules = () => {
    const f = fixtureFiles('v');
    const doc = JSON.parse(f[PLAN]!) as PlanData;
    doc.rules = RULES;
    doc.lifts['Flat DB Bench Press'] = { ...doc.lifts['Flat DB Bench Press']!, progression: { rule: 'linear', onMiss: 'hold' } };
    f[PLAN] = `${JSON.stringify(doc, null, 2)}\n`;
    return { doc, prog: readVault(memoryIo(f, '2026-04-12'), 'v', { asOf: '2026-04-12' }).data.program };
  };

  it('carries the plan\'s rules and each lift\'s progression over unchanged', () => {
    const { doc, prog } = withRules();
    const out = toPlanData(prog, { date: '2026-04-06' }).value.planData;
    assert.deepEqual(out.rules, RULES);
    assert.deepEqual(out.lifts, doc.lifts);
  });

  it('keeps a lift\'s progression when its range changes', () => {
    const { prog } = withRules();
    for (const w of prog.macrocycle.phases.flatMap((ph) => ph.mesocycles.flatMap((m) => m.weeks))) {
      w.sessions = w.sessions.map((t) => ({ ...t, slots: t.slots.map((s) => (s.exercise === 'flat-db-bench-press' ? { ...s, repRange: [8, 10] as [number, number] } : s)) }));
    }
    const lift = toPlanData(prog, { date: '2026-04-06' }).value.planData.lifts['Flat DB Bench Press']!;
    assert.deepEqual([lift.lo, lift.hi, lift.progression], [8, 10, { rule: 'linear', onMiss: 'hold' }]);
  });
});

describe('exporter: the rir and timed fields', () => {
  const PLAN = 'v/3-Personal/Fitness/plan-data.json';
  const INTERVALS = { name: 'Uphill walk or run intervals, 4 x 4 min', table: 'Intervals', sr: '22 min', rest: '—', timed: { minutes: 30, rounds: 4, workMin: 4, restMin: 3 }, note: 'Hard on the work. Why: conditioning.', label: 'Intervals' };
  /** The synthetic vault with fields on some items: B's row a RIR range, the RDL a number, S3 an interval item first. */
  const withFields = () => {
    const f = fixtureFiles('v');
    const doc = JSON.parse(f[PLAN]!) as PlanData;
    doc.sessions['B']![0] = { ...doc.sessions['B']![0]!, rir: 3, note: 'Hinge at the hips.' };
    doc.sessions['B']![1] = { ...doc.sessions['B']![1]!, rir: [1, 2] };
    doc.sessions['S3'] = [INTERVALS, ...doc.sessions['S3']!];
    f[PLAN] = `${JSON.stringify(doc, null, 2)}\n`;
    return { doc, prog: readVault(memoryIo(f, '2026-04-12'), 'v', { asOf: '2026-04-12' }).data.program };
  };
  const weekOf = (p: Program, start: string) => p.macrocycle.phases.flatMap((ph) => ph.mesocycles.flatMap((m) => m.weeks)).find((w) => w.start === start)!;

  it('items with the fields round-trip unchanged, byte for byte', () => {
    const { doc, prog } = withFields();
    const out = toPlanData(prog, { date: '2026-04-06' }).value.planData;
    assert.equal(JSON.stringify(out.sessions), JSON.stringify(doc.sessions));
  });

  it('the vault adapter keeps the fields\' values on the slot and in its derived values', () => {
    const { prog } = withFields();
    const w = weekOf(prog, '2026-04-06');
    const row = w.sessions.find((t) => t.id === 'b')!.slots[1] as ExerciseSlot & SlotExtras;
    assert.deepEqual([row.rir, row._derived!.rir], [1, 1], 'the target is the low end of the range');
    const iv = w.sessions.find((t) => t.id === 's3')!.slots[0] as ExerciseSlot & SlotExtras;
    assert.deepEqual([iv.sets, iv.repRange, iv.timed], [4, [1, 1], INTERVALS.timed]);
    assert.deepEqual(iv._derived!.timed, INTERVALS.timed);
  });

  it('a changed item gets the RIR in its rir field, never as a note sentence; a range stays while its low end holds', () => {
    const { prog } = withFields();
    const w = weekOf(prog, '2026-04-06');
    w.sessions = w.sessions.map((t) => (t.id === 'b' ? { ...t, slots: t.slots.map((x, i) => (i === 1 ? { ...x, sets: 4 } : i === 0 ? { ...x, sets: 4, rir: 2 } : x)) } : t));
    const out = toPlanData(prog, { date: '2026-04-06' }).value.planData;
    const [rdl, row] = out.sessions['B']!;
    assert.deepEqual([row!.sr, row!.rir, row!.note], ['4 × 10–12', [1, 2], 'Chest up.']);
    assert.deepEqual([rdl!.sr, rdl!.rir, rdl!.note], ['4 × 8–10', 2, 'Hinge at the hips.']);
  });

  it('an old note\'s "RIR n." sentence moves into the field; one inside a cue stays, and a disagreeing one is listed', () => {
    const f = fixtureFiles('v');
    const doc = JSON.parse(f[PLAN]!) as PlanData;
    doc.sessions['B']![1] = { ...doc.sessions['B']![1]!, note: 'RIR 1–2. Chest up.' };
    doc.sessions['B']![3] = { ...doc.sessions['B']![3]!, note: 'RIR 1: stop before the hips drop.' };
    f[PLAN] = `${JSON.stringify(doc, null, 2)}\n`;
    const prog = readVault(memoryIo(f, '2026-04-12'), 'v', { asOf: '2026-04-12' }).data.program;
    const w = weekOf(prog, '2026-04-06');
    w.sessions = w.sessions.map((t) => (t.id === 'b' ? { ...t, slots: t.slots.map((x, i) => (i === 1 ? { ...x, sets: 4 } : i === 3 ? { ...x, sets: 2, rir: 2 } : x)) } : t));
    const r = toPlanData(prog, { date: '2026-04-06' }).value;
    const b = r.planData.sessions['B']!;
    assert.deepEqual([b[1]!.rir, b[1]!.note], [[1, 2], 'Chest up.']);
    assert.deepEqual([b[3]!.rir, b[3]!.note], [2, 'RIR 1: stop before the hips drop.']);
    assert.ok(r.unexpressible.some((u) => u.what === 'RIR in a note' && /Side Plank: the note still says RIR 1 and the item's rir is 2/.test(u.detail)));
  });

  it('a changed timed item writes its structure to the field and its minutes to sr; a note describing other intervals is listed', () => {
    const { prog } = withFields();
    const w = weekOf(prog, '2026-04-06');
    const timed = { minutes: 30, rounds: 5, workMin: 3, restMin: 2 };
    w.sessions = w.sessions.map((t) => (t.id === 's3' ? { ...t, slots: t.slots.map((x, i) => (i === 0 ? { ...x, sets: 5, timed } : x)) } : t));
    const r = toPlanData(prog, { date: '2026-04-06' }).value;
    const iv = r.planData.sessions['S3']![0]!;
    assert.deepEqual([iv.sr, iv.timed, iv.rir], ['30 min', timed, undefined]);
    assert.ok(!r.unexpressible.some((u) => u.what === 'intervals in a note'));
    // An old item whose note describes 4 × 4: the field is written and the note listed for a rewrite.
    const f = fixtureFiles('v');
    const doc = JSON.parse(f[PLAN]!) as PlanData;
    doc.sessions['S3'] = [{ ...INTERVALS, timed: undefined, note: '4 × 4 min hard, 3 min easy between.' } as never, ...doc.sessions['S3']!];
    f[PLAN] = `${JSON.stringify(doc, null, 2)}\n`;
    const old = readVault(memoryIo(f, '2026-04-12'), 'v', { asOf: '2026-04-12' }).data.program;
    const ow = weekOf(old, '2026-04-06');
    ow.sessions = ow.sessions.map((t) => (t.id === 's3' ? { ...t, slots: t.slots.map((x, i) => (i === 0 ? { ...x, sets: 5, timed } : x)) } : t));
    const r2 = toPlanData(old, { date: '2026-04-06' }).value;
    assert.deepEqual(r2.planData.sessions['S3']![0]!.timed, timed);
    assert.ok(r2.unexpressible.some((u) => u.what === 'intervals in a note'));
  });
});

describe('exporter: the guide\'s muscle copies', () => {
  it('leaves a copy that differs only in order, adding only the catalogue\'s regions', () => {
    // The bench press: the guide lists shoulders before triceps, the catalogue after.
    const out = toPlanData(program()).value.planData;
    const own = plan.guide['Flat DB Bench Press']!;
    assert.deepEqual(out.guide['Flat DB Bench Press'], { ...own, muscles: { ...own.muscles!, regions: ['shoulders-front'] } });
    assert.deepEqual(out.guide['Flat DB Bench Press']!.muscles!.helps, ['shoulders', 'triceps']);
  });

  it('keeps a region copy in step: the catalogue\'s added or put right, a stale one dropped, a movement it does not know left as written', () => {
    const f = fixtureFiles('v');
    const PLAN = 'v/3-Personal/Fitness/plan-data.json';
    const doc = JSON.parse(f[PLAN]!) as PlanData;
    doc.guide['Romanian Deadlift']!.muscles!.regions = ['hamstrings-knee'];
    doc.guide['Dead Bug']!.muscles = { main: ['abs'], helps: [], regions: ['quads-rf'] };
    // A movement the catalogue does not know: the band external rotation (a catalogue movement), renamed.
    for (const item of Object.values(doc.sessions).flat()) if (item.name === 'Band External Rotation') item.name = item.table = 'Cuban Press';
    doc.guide = Object.fromEntries(Object.entries(doc.guide).map(([k, v]) => [k === 'Band External Rotation' ? 'Cuban Press' : k, v]));
    doc.guide['Cuban Press']!.muscles!.regions = ['shoulders-rear'];
    f[PLAN] = `${JSON.stringify(doc, null, 2)}\n`;
    const prog = readVault(memoryIo(f, '2026-04-12'), 'v', { asOf: '2026-04-12' }).data.program;
    // The guide's regions count only for the movement the catalogue does not know.
    assert.deepEqual(prog.exercises['romanian-deadlift']!.muscles!.regions, ['hamstrings-hip']);
    assert.equal(prog.exercises['dead-bug']!.muscles!.regions, undefined);
    assert.deepEqual(prog.exercises['cuban-press']!.muscles!.regions, ['shoulders-rear']);
    const rule = (key: string, entry: unknown) => {
      const c = canonicalTags(key, entry);
      return c.source === 'catalogue' ? c.tags : null;
    };
    const out = toPlanData(prog, { guideMuscles: rule }).value.planData;
    assert.deepEqual(out.guide['Romanian Deadlift']!.muscles, { main: ['hamstrings', 'glutes'], helps: ['lower-back', 'forearms'], regions: ['hamstrings-hip'] });
    assert.deepEqual(out.guide['Dead Bug']!.muscles, { main: ['abs'], helps: [] });
    assert.deepEqual(out.guide['Cuban Press'], doc.guide['Cuban Press']);
  });

  it('reads an old file without regions as before: the same muscles, the catalogue\'s regions on top', () => {
    const p = program();
    assert.ok(Object.values(plan.guide).every((g) => g.muscles?.regions === undefined), 'the synthetic file predates regions');
    assert.deepEqual(p.exercises['face-pull']!.muscles, { main: ['upper-back'], helps: ['shoulders'], regions: ['shoulders-rear', 'upper-back-mid'] });
    assert.deepEqual(p.exercises['band-external-rotation']!.muscles, { main: ['shoulders'], helps: ['upper-back'] });
    // A second export of the first export's output changes nothing more.
    const once = toPlanData(p).value.planData;
    const f = fixtureFiles('v');
    f['v/3-Personal/Fitness/plan-data.json'] = `${JSON.stringify(once, null, 2)}\n`;
    const twice = toPlanData(readVault(memoryIo(f, '2026-04-12'), 'v', { asOf: '2026-04-12' }).data.program).value.planData;
    assert.deepEqual(twice, once);
  });

  it('never rewrites an entry with an override, and rewrites the same entry without one', () => {
    const fixture = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'plans', 'b-intermediate-posture.json'), 'utf8')) as { input: { profile: Profile; today: string; options: Record<string, unknown> } };
    const prog = generatePlan({ profile: fixture.input.profile, today: fixture.input.today, options: fixture.input.options as never }).value.program as Program;
    const plain = toPlanData(prog).value.planData;
    const name = plain.sessions['A']![0]!.name;
    const own = { main: ['chest'], helps: [] as string[] };
    const kept = toPlanData(prog, { base: { ...plan, guide: { [name]: { setup: 'Mine.', muscles: { ...own, override: 'counted my way on purpose' } } } } }).value.planData;
    assert.deepEqual(kept.guide[name], { setup: 'Mine.', muscles: { ...own, override: 'counted my way on purpose' } });
    const synced = toPlanData(prog, { base: { ...plan, guide: { [name]: { setup: 'Mine.', muscles: own } } } }).value.planData;
    assert.equal(synced.guide[name]!.setup, 'Mine.');
    assert.deepEqual(synced.guide[name]!.muscles, plain.guide[name]!.muscles, 'the program\'s tags');
  });

  it('brings every entry in step when given the vault\'s rule, overrides and cardio aside', () => {
    const f = fixtureFiles('v');
    const PLAN = 'v/3-Personal/Fitness/plan-data.json';
    const doc = JSON.parse(f[PLAN]!) as PlanData;
    doc.guide['Hamstring Curl']!.muscles!.override = 'the curl machine here loads the calves';
    f[PLAN] = `${JSON.stringify(doc, null, 2)}\n`;
    const prog = readVault(memoryIo(f, '2026-04-12'), 'v', { asOf: '2026-04-12' }).data.program;
    const rule = (key: string, entry: unknown) => {
      const c = canonicalTags(key, entry);
      return c.source === 'catalogue' ? c.tags : null;
    };
    const out = toPlanData(prog, { guideMuscles: rule }).value.planData;
    for (const [k, g] of Object.entries(out.guide)) {
      const c = canonicalTags(k, g);
      if (c.source === 'catalogue') assert.equal(c.differs, undefined, k);
    }
    // Entries outside the exported week, and timed holds the sets do not count, follow too: the back squat's copy loses its hamstrings.
    assert.deepEqual(out.guide['Barbell Back Squat']!.muscles, { main: ['quads', 'glutes'], helps: ['lower-back', 'abs'], regions: ['quads-vasti'] });
    assert.deepEqual(out.guide['Wall walk']!.muscles, { main: ['shoulders'], helps: ['triceps', 'abs'] });
    assert.deepEqual(out.guide['Hamstring Curl'], doc.guide['Hamstring Curl']);
    assert.deepEqual(out.guide['Zone 2 finisher'], doc.guide['Zone 2 finisher']);
    assert.deepEqual(out.guide['Band External Rotation'], doc.guide['Band External Rotation'], 'a catalogue movement whose copy already agrees');
  });

  it('rewrites an entry whose override is not honoured, override and all', () => {
    const f = fixtureFiles('v');
    const PLAN = 'v/3-Personal/Fitness/plan-data.json';
    const doc = JSON.parse(f[PLAN]!) as PlanData;
    (doc.guide['Face Pull']!.muscles as unknown as Record<string, unknown>)['override'] = 3;
    doc.guide['Dead Bug']!.muscles = { main: [], helps: ['obliques'], override: 'counted my way' };
    f[PLAN] = `${JSON.stringify(doc, null, 2)}\n`;
    const prog = readVault(memoryIo(f, '2026-04-12'), 'v', { asOf: '2026-04-12' }).data.program;
    const out = toPlanData(prog).value.planData;
    assert.deepEqual(out.guide['Face Pull']!.muscles, { main: ['upper-back'], helps: ['shoulders'], regions: ['shoulders-rear', 'upper-back-mid'] });
    assert.deepEqual(out.guide['Dead Bug']!.muscles, { main: ['abs'], helps: [] });
  });

  it('writes each entry the tags Pahlavan counts for that entry, never another entry\'s override', () => {
    // The program's goblet squat carries a variant entry's override (as a plan --vault built before the fix would):
    // the entry of its own name gets the catalogue's, the variant keeps its override.
    const base = { ...plan, guide: { ...plan.guide, 'Goblet squat (heavy)': { muscles: { main: ['quads', 'glutes'], helps: ['hamstrings'], override: 'counted my way' } } } };
    const fixture = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'plans', 'a-novice-dumbbells.json'), 'utf8')) as { input: { profile: Profile; today: string; options?: Record<string, unknown> } };
    const prog = generatePlan({ profile: fixture.input.profile, today: fixture.input.today, options: (fixture.input.options ?? {}) as never }).value.program as Program;
    assert.ok(prog.exercises['goblet-squat']);
    prog.exercises['goblet-squat'] = { ...prog.exercises['goblet-squat'], name: 'Goblet Squat', muscles: { main: ['quads', 'glutes'], helps: ['hamstrings'] } };
    const rule = (key: string, entry: unknown) => {
      const c = canonicalTags(key, entry);
      return c.source === 'catalogue' ? c.tags : null;
    };
    const out = toPlanData(prog, { base, guideMuscles: rule }).value.planData;
    assert.deepEqual(out.guide['Goblet Squat']!.muscles, { main: ['quads', 'glutes'], helps: ['abs', 'upper-back'], regions: ['quads-vasti'] });
    assert.deepEqual(out.guide['Goblet squat (heavy)'], base.guide['Goblet squat (heavy)']);
  });
});

describe('exporter: an engine-generated program', () => {
  const fixture = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'plans', 'b-intermediate-posture.json'), 'utf8')) as { input: { profile: Profile; today: string; options: Record<string, unknown> } };
  const gen = generatePlan({ profile: fixture.input.profile, today: fixture.input.today, options: fixture.input.options as never });
  const prog = gen.value.program as Program;
  const r = toPlanData(prog, { warmUp: gen.value.proposal.warmUp });
  const pd = r.value.planData;

  it('keeps plan-data\'s keys in their order', () => {
    // No desk work in this profile, so no desk breaks and no deskTiming; a generated plan states no overrides, and no start without --start.
    assert.equal(prog.deskBreaks, undefined);
    assert.deepEqual(Object.keys(pd), PLAN_DATA_KEYS.filter((k) => k !== 'deskTiming' && k !== 'overrides' && k !== 'start'));
  });

  it('writes one week\'s templates as lettered lift types with two logged lifts each', () => {
    assert.deepEqual(pd.liftTypes, ['A', 'B', 'C', 'D']);
    assert.deepEqual(r.value.types, { A: 'heavy-squat', B: 'light-hinge', C: 'heavy-hinge', D: 'light-squat' });
    for (const t of pd.liftTypes) assert.equal(pd.sessions[t]!.filter((i) => i.logged).length, 2, t);
    assert.equal(pd.weekTarget.lift, 4);
    assert.equal(pd.liftUnit, 'kg');
    assert.equal(pd.titles['A'], 'Heavy: squat and press');
  });

  it('writes lifts entries for the logged items, the RIR into the rir field (never the note) and rest from the slot note', () => {
    for (const t of pd.liftTypes) {
      for (const i of pd.sessions[t]!.filter((x) => x.logged)) {
        const l = pd.lifts[i.name]!;
        assert.ok(l && l.lo <= l.hi && l.inc > 0, i.name);
      }
    }
    const first = pd.sessions['A']![0]!;
    assert.equal(typeof first.rir, 'number');
    assert.doesNotMatch(first.note ?? '', /RIR/);
    for (const t of [...pd.liftTypes, ...pd.shortTypes]) for (const i of pd.sessions[t]!) assert.doesNotMatch(i.note ?? '', /\bRIR \d/, `${t} ${i.name}`);
    assert.equal(first.rest, '2–3 min');
    assert.match(first.sr, /^\d × \d+(–\d+)?$/);
  });

  it('maps muscles back to plan-data ids and asks for guide text for new movements', () => {
    for (const g of Object.values(pd.guide)) for (const m of [...(g.muscles?.main ?? []), ...(g.muscles?.helps ?? [])]) assert.ok(m in PLAN_DATA_MUSCLES, m);
    for (const [k, g] of Object.entries(pd.guide)) assert.ok(!(g.muscles?.helps ?? []).some((m) => g.muscles!.main.includes(m)), `${k}: a main muscle is not also a helper`);
    assert.ok(r.value.unexpressible.some((u) => u.what === 'guide text'));
  });

  it('lands with its standing rules declared: its calibration, light and test weeks, and each logged lift\'s rule', () => {
    const read = readRules(pd);
    assert.deepEqual(read.problems, []);
    assert.deepEqual([read.sources.calibration, read.sources.lightWeeks, read.sources.tests], ['plan', 'plan', 'plan']);
    assert.equal(read.sources.stall, 'legacy-default', 'the rest are the coach\'s to declare');
    assert.deepEqual([read.rules.lightWeeks.sets, read.rules.lightWeeks.rirAdd, read.rules.lightWeeks.early], ['half', 3, 'offer']);
    assert.ok(Object.values(pd.lifts).length > 0 && Object.values(pd.lifts).every((l) => (l.progression as { rule?: string } | undefined)?.rule !== undefined));
  });

  it('with a base file, keeps the coach\'s own rules and progressions and fills only the rest', () => {
    const liftKey = Object.keys(pd.lifts)[0]!;
    const base = { ...pd, rules: { lightWeeks: { every: 5, sets: 'half' }, stall: { response: 'report' } }, lifts: { [liftKey]: { ...pd.lifts[liftKey]!, progression: { rule: 'hold' } } } } as PlanData;
    const out = toPlanData(prog, { warmUp: gen.value.proposal.warmUp, base }).value;
    assert.deepEqual(out.planData.rules!['lightWeeks'], { every: 5, sets: 'half' });
    assert.deepEqual(out.planData.rules!['stall'], { response: 'report' });
    assert.deepEqual(out.planData.rules!['calibration'], pd.rules!['calibration'], 'what the base leaves out, the program fills');
    assert.deepEqual(out.planData.lifts[liftKey]!.progression, { rule: 'hold' });
    const kept = out.unexpressible.filter((u) => u.what === 'standing rules kept').map((u) => u.detail);
    assert.ok(kept.some((d) => d.startsWith('rules.lightWeeks: the plan\'s own rule')));
    assert.ok(kept.some((d) => d.startsWith(`${liftKey}: the plan's own progression`)));
  });

  it('lists what plan-data cannot express', () => {
    const what = new Set(r.value.unexpressible.map((u) => u.what));
    for (const w of ['phases', 'standing rules', 'later weeks', 'express']) assert.ok(what.has(w), w);
    // The calibration, light and test weeks have fields now: the standing rules.
    for (const w of ['deload prescription', 'test weeks']) assert.ok(!what.has(w), w);
    assert.ok(!what.has('RIR targets'), 'the RIR has a field now');
  });

  it('says where the plan comes from without naming a vault\'s own script', () => {
    assert.match(pd._about ?? '', /^Single source of truth for the fitness plan\. Generated by the Pahlavan engine/);
    assert.match(pd._about ?? '', /regenerated, never edited by hand/);
  });

  it('carries the base plan-data\'s warm-ups, ladders and guide text over', () => {
    const withBase = toPlanData(prog, { base: plan }).value.planData;
    assert.deepEqual(withBase.ladders, plan.ladders);
    assert.equal(withBase.warmups, plan.warmups);
    assert.equal(withBase.liftUnit, 'lb');
    assert.ok('Goblet Squat' in withBase.guide);
  });
});

describe('exporter: over a base file, the names and reasons the plan already has', () => {
  // A dumbbell novice's generated program, exported over a hand-made plan file whose names differ from the catalogue's.
  const fixture = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'plans', 'a-novice-dumbbells.json'), 'utf8')) as { input: { profile: Profile; today: string; options?: Record<string, unknown> } };
  const gen = generatePlan({ profile: fixture.input.profile, today: fixture.input.today, options: (fixture.input.options ?? {}) as never });
  const prog = gen.value.program as Program;
  const matchId = (n: string) => matchCatalogue(n)?.id ?? null;
  const base: PlanData = {
    ...plan,
    lifts: { ...plan.lifts, 'One-Arm DB Row': { short: 'DB row', lo: 8, hi: 12, inc: 5, db: true } },
    sessions: {
      ...plan.sessions,
      B: [
        { name: 'Goblet Squat', table: 'Goblet Squat (DB)', sr: '3 × 8', rest: '2 min', note: 'Elbows inside the knees. Why: the sit-to-stand was easy, so a loaded squat.', label: 'Goblet', logged: true },
        { name: 'One-Arm DB Row', table: 'DB Row (one arm)', sr: '4 × 10', rest: '90 s', note: 'Why: posture, pulling at least equal to pushing.', label: 'Row' },
      ],
    },
    guide: { ...plan.guide, 'One-Arm DB Row': { setup: 'Knee and hand on the bench.', muscles: { main: ['upper-back', 'lats'], helps: ['biceps'] } } },
  };
  const items = (pd: PlanData) => Object.values(pd.sessions).flat();
  const find = (pd: PlanData, ty: string, name: string) => pd.sessions[ty]!.find((i) => i.name === name);

  it('names each movement as the plan or the log already does: a lifts key, a logged name, then a guide key', () => {
    const r = toPlanData(prog, { base, matchId, logNames: ['DB RDL'] }).value;
    const pd = r.planData;
    assert.ok(prog.exercises['db-row'] && prog.exercises['db-rdl'] && prog.exercises['goblet-squat']);
    // The catalogue's "One-arm dumbbell row" is the plan's "One-Arm DB Row"; the log's "DB RDL" is the dumbbell RDL.
    assert.ok(find(pd, 'B', 'One-Arm DB Row'), 'the lifts key names the row');
    assert.ok(find(pd, 'B', 'Goblet Squat'), 'the program\'s own spelling, as the plan writes it');
    const rdl = find(pd, 'A', 'DB RDL')!;
    assert.ok(rdl && rdl.logged, 'the logged name names the logged lift');
    assert.ok('DB RDL' in pd.lifts, 'and its lifts entry, so its history stays its own');
    assert.equal(items(pd).some((i) => /One-arm dumbbell row|Dumbbell Romanian deadlift/.test(i.name)), false);
    // The plan's guide entry is the movement's: its text carried, no new entry, no "guide text" asked for it.
    assert.equal(pd.guide['One-Arm DB Row']!.setup, 'Knee and hand on the bench.');
    assert.equal(Object.keys(pd.guide).some((k) => k === 'One-arm dumbbell row'), false);
    assert.ok(!r.unexpressible.some((u) => u.what === 'guide text' && u.detail.startsWith('One-Arm DB Row')));
    // The sheet and short names of the item as written stay; a lifts entry keeps its short name.
    const row = find(pd, 'B', 'One-Arm DB Row')!;
    assert.deepEqual([row.table, row.label], ['DB Row (one arm)', 'Row']);
    assert.equal(pd.lifts['Goblet Squat']!.short, 'Goblet squat');
  });

  it('keeps the "Why:" line of an item unchanged in its session; a new or changed item without one is listed', () => {
    const r = toPlanData(prog, { base, matchId, logNames: ['DB RDL'] }).value;
    const goblet = find(r.planData, 'B', 'Goblet Squat')!;
    assert.equal(goblet.sr, '3 × 8', 'the same sets and reps as written');
    assert.equal(parseNote(goblet.note).why, 'the sit-to-stand was easy, so a loaded squat.');
    const row = find(r.planData, 'B', 'One-Arm DB Row')!;
    assert.notEqual(row.sr, '4 × 10');
    assert.equal(parseNote(row.note).why, null, 'its sets changed: the old reason is not carried');
    const why = r.unexpressible.filter((u) => u.what === 'why lines');
    const b = why.find((u) => u.detail.startsWith('B: '))!;
    assert.match(b.detail, /One-Arm DB Row \(its sets and reps were "4 × 10"; the plan as written gave "Why: posture, pulling at least equal to pushing\."\)/);
    assert.doesNotMatch(b.detail, /Goblet Squat/, 'the kept reason is not asked for again');
    assert.match(why.find((u) => u.detail.startsWith('A: '))!.detail, /DB RDL.*no "Why:" line; end each note with one/);
  });

  it('matches by spelling only without a matcher, and never takes a name whose guide entry keeps its own tags', () => {
    const plain = toPlanData(prog, { base }).value.planData;
    assert.ok(find(plain, 'B', 'Goblet Squat'), 'any case still matches');
    assert.ok(find(plain, 'B', 'One-arm dumbbell row'), 'no matcher: the catalogue name stays');
    const withOverride: PlanData = { ...base, guide: { ...base.guide, 'DB Romanian Deadlift': { muscles: { main: ['hamstrings'], helps: [], override: 'counted my way' } } } };
    const pd = toPlanData(prog, { base: withOverride, matchId }).value.planData;
    assert.ok(find(pd, 'A', 'Dumbbell Romanian deadlift'), 'taking it would change what the item counts');
  });

  it('never renames a logged lift: a lifts key or logged name keeps its name even when its guide entry has an override, and says so', () => {
    const withOverride: PlanData = {
      ...base,
      lifts: { ...base.lifts, 'DB Romanian Deadlift': { short: 'RDL', lo: 8, hi: 12, inc: 5, db: true } },
      guide: { ...base.guide, 'DB Romanian Deadlift': { muscles: { main: ['hamstrings'], helps: [], override: 'counted my way' } } },
    };
    for (const opts of [{ base: withOverride, matchId }, { base: { ...withOverride, lifts: base.lifts }, matchId, logNames: ['DB Romanian Deadlift'] }]) {
      const r = toPlanData(prog, opts).value;
      const rdl = find(r.planData, 'A', 'DB Romanian Deadlift');
      assert.ok(rdl && rdl.logged, 'the name its history is matched by');
      assert.ok('DB Romanian Deadlift' in r.planData.lifts && !('Dumbbell Romanian deadlift' in r.planData.lifts));
      assert.deepEqual(r.planData.guide['DB Romanian Deadlift']!.muscles, withOverride.guide['DB Romanian Deadlift']!.muscles, 'the override is kept');
      const said = r.unexpressible.filter((u) => u.what === 'muscle override');
      assert.equal(said.length, 1);
      assert.match(said[0]!.detail, /^DB Romanian Deadlift: kept under its own name.*override counts \("counted my way"\)/);
    }
  });

  it('lists the cues and temporary changes of the notes as written that the export leaves out', () => {
    const noted: PlanData = { ...base, sessions: { ...base.sessions, B: [{ ...base.sessions.B![0]!, note: 'until 2026-12-01: knee niggle. Elbows inside the knees. Why: the sit-to-stand was easy, so a loaded squat.' }] } };
    const r = toPlanData(prog, { base: noted, matchId }).value;
    assert.ok(r.unexpressible.some((u) => u.what === 'note cues' && u.detail.startsWith('B Goblet Squat: the plan as written\'s note says "Elbows inside the knees."')));
    assert.ok(r.unexpressible.some((u) => u.what === 'temporary changes' && /^B Goblet Squat: .*until 2026-12-01: knee niggle/.test(u.detail)));
    // The Why line is carried, so it isn't asked for.
    assert.equal(parseNote(find(r.planData, 'B', 'Goblet Squat')!.note).why, 'the sit-to-stand was easy, so a loaded squat.');
  });

  it('changes nothing for a plan the vault adapter read, or an export with no base', () => {
    const read = toPlanData(program(), { matchId, logNames: ['DB RDL'] }).value;
    assert.deepEqual(read.unexpressible, []);
    const none = toPlanData(prog, { matchId, logNames: ['DB RDL'] }).value.planData;
    assert.ok(find(none, 'A', 'Dumbbell Romanian deadlift'));
  });
});

describe('exporter: a self-checked ladder\'s starting level', () => {
  it('names the engine command that sets it in the log', () => {
    const athlete = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'athletes', '3-knee-62.json'), 'utf8')) as { input: { profile: Profile; today: string; options?: Record<string, unknown> } };
    const gen = generatePlan({ profile: athlete.input.profile, today: athlete.input.today, options: (athlete.input.options ?? {}) as never });
    const levels = toPlanData(gen.value.program as Program, {}).value.unexpressible.filter((u) => u.what === 'ladder levels');
    assert.ok(levels.length > 0);
    for (const u of levels) assert.match(u.detail, /set it in the log with `engine log ladder --id [a-z-]+ --level \d+ --date \d{4}-\d{2}-\d{2} --write`\.$/);
  });

  it('writes it as the ladder\'s startLevel, so the draft counts that level before the log holds one', () => {
    const athlete = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'athletes', '3-knee-62.json'), 'utf8')) as { input: { profile: Profile; today: string; options?: Record<string, unknown> } };
    const gen = generatePlan({ profile: athlete.input.profile, today: athlete.input.today, options: (athlete.input.options ?? {}) as never });
    const r = toPlanData(gen.value.program as Program, {}).value;
    const said = r.unexpressible.filter((u) => u.what === 'ladder levels').map((u) => /--id ([a-z-]+) --level (\d+)/.exec(u.detail)!).map((m) => [m[1]!, Number(m[2])] as const);
    assert.ok(said.length > 0);
    for (const [id, level] of said) {
      const l = r.planData.ladders.find((x) => x.id === id)!;
      assert.equal(l.startLevel, level, id);
      assert.deepEqual(ladderStartOf(l), { level, problem: null }, `${id}: a level the ladder has`);
    }
  });
});

describe('plan-data: the phases\' names', () => {
  const PLAN = 'v/3-Personal/Fitness/plan-data.json';
  const named = (phases: unknown) => {
    const f = fixtureFiles('v');
    const doc = JSON.parse(f[PLAN]!) as Record<string, unknown>;
    doc['phases'] = phases;
    f[PLAN] = `${JSON.stringify(doc, null, 2)}\n`;
    return { read: readVault(memoryIo(f, '2026-04-12'), 'v', { asOf: '2026-04-12' }), text: f[PLAN]! };
  };

  it('reads names by position, with an optional goal; a bad entry or list is warned about and reads Phase N', () => {
    assert.deepEqual(phaseNamesFrom(undefined), { phases: [], warnings: [] });
    assert.deepEqual(phaseNamesFrom([{ name: 'Foundation' }, 'Build', { name: ' Peak ', goal: 'Tests at the end.' }]).phases, [{ name: 'Foundation' }, { name: 'Build' }, { name: 'Peak', goal: 'Tests at the end.' }]);
    const bad = phaseNamesFrom([{ name: '' }, { name: 'Build' }]);
    assert.deepEqual(bad.phases, [null, { name: 'Build' }]);
    assert.match(bad.warnings[0]!, /phases\[0\] has no name: it reads Phase 1/);
    assert.match(phaseNamesFrom({ name: 'x' }).warnings[0]!, /not a list/);
  });

  it('names the program\'s phases from the file; a plan without names keeps Phase 1, 2, 3', () => {
    const { read } = named([{ name: 'Foundation' }, { name: 'Build', goal: 'Heavier main lifts.' }, { name: 'Peak' }]);
    assert.deepEqual(read.data.program.macrocycle.phases.map((p) => [p.name, p.goal ?? null]), [['Foundation', null], ['Build', 'Heavier main lifts.'], ['Peak', null]]);
    assert.deepEqual(program().macrocycle.phases.map((p) => p.name), ['Phase 1', 'Phase 2', 'Phase 3']);
    const short = named([{ name: 'Foundation' }]).read;
    assert.deepEqual(short.data.program.macrocycle.phases.map((p) => p.name), ['Foundation', 'Phase 2', 'Phase 3'], 'fewer names than phases: the rest by number');
  });

  it('writes a named plan back unchanged, and a generated plan\'s own phase names', () => {
    const { read, text } = named([{ name: 'Foundation' }, { name: 'Build' }, { name: 'Peak' }]);
    const out = toPlanData(read.data.program).value.planData;
    // The guide's muscle copies the catalogue retags aside (the round trip above), the file is written back as it was.
    const asRead = JSON.parse(text) as PlanData;
    assert.deepEqual(out, withGuideOf(out, REWRITTEN, asRead));
    assert.equal(`${JSON.stringify({ ...out, guide: { ...out.guide, ...Object.fromEntries(REWRITTEN.map((k) => [k, asRead.guide[k]!])) } }, null, 2)}\n`, text);
    assert.equal('phases' in toPlanData(program()).value.planData, false, 'no names in, none out');
    const fixture = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'plans', 'b-intermediate-posture.json'), 'utf8')) as { input: { profile: Profile; today: string; options: Record<string, unknown> } };
    const gen = generatePlan({ profile: fixture.input.profile, today: fixture.input.today, options: fixture.input.options as never });
    const pd = toPlanData(gen.value.program as Program).value.planData;
    assert.deepEqual(pd.phases!.map((p) => p.name), (gen.value.program as Program).macrocycle.phases.map((p) => p.name));
  });
});

