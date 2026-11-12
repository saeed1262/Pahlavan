// plan-data.json's conventions, and how the vault adapter reads its items.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import {
  dashboardSets,
  deloadSr,
  exerciseId,
  itemFieldProblems,
  itemRir,
  itemSets,
  itemTimed,
  parseNote,
  parseSr,
  phaseNamesFrom,
  PLAN_DATA_MUSCLES,
  planDataGroups,
  sameMuscles,
  toEngineMuscles,
  toPlanDataMuscles,
  type PlanData,
} from '../src/core/plan-data.ts';
import { CATALOGUE_BY_ID } from '../src/core/data/exercises.ts';
import { MUSCLE_IDS } from '../src/core/data/muscles.ts';
import type { ExerciseSlot, Program } from '../src/core/schema.ts';
import type { SlotExtras } from '../src/core/plan-data.ts';
import { fixtureFiles, fsIo, memoryIo, VAULT } from './helpers.ts';

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

describe('plan items: the vault adapter reads the rir and timed fields onto the slot', () => {
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
    return readVault(memoryIo(f, '2026-04-12'), 'v', { asOf: '2026-04-12' }).data.program;
  };
  const weekOf = (p: Program, start: string) => p.macrocycle.phases.flatMap((ph) => ph.mesocycles.flatMap((m) => m.weeks)).find((w) => w.start === start)!;

  it('keeps the fields\' values on the slot, and the item as read', () => {
    const w = weekOf(withFields(), '2026-04-06');
    const row = w.sessions.find((t) => t.id === 'b')!.slots[1] as ExerciseSlot & SlotExtras;
    assert.equal(row.rir, 1, 'the target is the low end of the range');
    assert.deepEqual(row._item!.rir, [1, 2]);
    const rdl = w.sessions.find((t) => t.id === 'b')!.slots[0]!;
    assert.equal(rdl.rir, 3);
    const iv = w.sessions.find((t) => t.id === 's3')!.slots[0] as ExerciseSlot & SlotExtras;
    assert.deepEqual([iv.sets, iv.repRange, iv.timed], [4, [1, 1], INTERVALS.timed]);
    assert.equal(iv._item!.name, INTERVALS.name);
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
});

