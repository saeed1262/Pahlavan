// plan-data.json's conventions and the exporter from a schema-v1 program.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { generatePlan } from '../src/core/plan/generate.ts';
import {
  dashboardSets,
  deloadSr,
  exerciseId,
  formatSr,
  parseNote,
  parseSr,
  phaseNamesFrom,
  PLAN_DATA_KEYS,
  PLAN_DATA_MUSCLES,
  toEngineMuscles,
  toPlanData,
  toPlanDataMuscles,
  type PlanData,
} from '../src/core/plan-data.ts';
import { MUSCLE_IDS } from '../src/core/data/muscles.ts';
import type { Profile, Program } from '../src/core/schema.ts';
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
});

describe('exporter: round trip', () => {
  it('writes the synthetic plan-data.json back unchanged: same keys, same order, same text', () => {
    const r = toPlanData(program());
    assert.deepEqual(r.value.planData, plan);
    assert.deepEqual(Object.keys(r.value.planData), Object.keys(plan));
    assert.equal(`${JSON.stringify(r.value.planData, null, 2)}\n`, planText);
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
    assert.equal(face.note, 'RIR 2. Light.');
    assert.deepEqual(out.sessions['A']![0], plan.sessions['A']![0]);
    assert.deepEqual(out.lifts, plan.lifts);
  });
});

describe('exporter: an engine-generated program', () => {
  const fixture = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'plans', 'b-intermediate-posture.json'), 'utf8')) as { input: { profile: Profile; today: string; options: Record<string, unknown> } };
  const gen = generatePlan({ profile: fixture.input.profile, today: fixture.input.today, options: fixture.input.options as never });
  const prog = gen.value.program as Program;
  const r = toPlanData(prog, { warmUp: gen.value.proposal.warmUp });
  const pd = r.value.planData;

  it('keeps plan-data\'s keys in their order', () => {
    // No desk work in this profile, so no desk breaks and no deskTiming.
    assert.equal(prog.deskBreaks, undefined);
    assert.deepEqual(Object.keys(pd), PLAN_DATA_KEYS.filter((k) => k !== 'deskTiming'));
  });

  it('writes one week\'s templates as lettered lift types with two logged lifts each', () => {
    assert.deepEqual(pd.liftTypes, ['A', 'B', 'C', 'D']);
    assert.deepEqual(r.value.types, { A: 'heavy-squat', B: 'light-hinge', C: 'heavy-hinge', D: 'light-squat' });
    for (const t of pd.liftTypes) assert.equal(pd.sessions[t]!.filter((i) => i.logged).length, 2, t);
    assert.equal(pd.weekTarget.lift, 4);
    assert.equal(pd.liftUnit, 'kg');
    assert.equal(pd.titles['A'], 'Heavy: squat and press');
  });

  it('writes lifts entries for the logged items, RIR into the notes and rest from the slot note', () => {
    for (const t of pd.liftTypes) {
      for (const i of pd.sessions[t]!.filter((x) => x.logged)) {
        const l = pd.lifts[i.name]!;
        assert.ok(l && l.lo <= l.hi && l.inc > 0, i.name);
      }
    }
    const first = pd.sessions['A']![0]!;
    assert.match(first.note ?? '', /^RIR \d\./);
    assert.equal(first.rest, '2–3 min');
    assert.match(first.sr, /^\d × \d+(–\d+)?$/);
  });

  it('maps muscles back to plan-data ids and asks for guide text for new movements', () => {
    for (const g of Object.values(pd.guide)) for (const m of [...(g.muscles?.main ?? []), ...(g.muscles?.helps ?? [])]) assert.ok(m in PLAN_DATA_MUSCLES, m);
    assert.ok(r.value.unexpressible.some((u) => u.what === 'guide text'));
  });

  it('lists what plan-data cannot express', () => {
    const what = new Set(r.value.unexpressible.map((u) => u.what));
    for (const w of ['phases', 'RIR targets', 'deload prescription', 'calibration week', 'test weeks', 'later weeks', 'express']) assert.ok(what.has(w), w);
  });

  it('carries the base plan-data\'s warm-ups, ladders and guide text over', () => {
    const withBase = toPlanData(prog, { base: plan }).value.planData;
    assert.deepEqual(withBase.ladders, plan.ladders);
    assert.equal(withBase.warmups, plan.warmups);
    assert.equal(withBase.liftUnit, 'lb');
    assert.ok('Goblet Squat' in withBase.guide);
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
    assert.equal(`${JSON.stringify(toPlanData(read.data.program).value.planData, null, 2)}\n`, text);
    assert.equal('phases' in toPlanData(program()).value.planData, false, 'no names in, none out');
    const fixture = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'plans', 'b-intermediate-posture.json'), 'utf8')) as { input: { profile: Profile; today: string; options: Record<string, unknown> } };
    const gen = generatePlan({ profile: fixture.input.profile, today: fixture.input.today, options: fixture.input.options as never });
    const pd = toPlanData(gen.value.program as Program).value.planData;
    assert.deepEqual(pd.phases!.map((p) => p.name), (gen.value.program as Program).macrocycle.phases.map((p) => p.name));
  });
});

