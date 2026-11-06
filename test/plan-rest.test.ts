// Rest in the draft (rules.md, "Load, rest, order and range of motion"): at
// least 90 s between sets, 2-3 min on heavy compound lifts, and supersets of
// non-competing muscles, not shorter rests, when the minutes run short.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CATALOGUE_BY_ID } from '../src/core/data/exercises.ts';
import { toPlanData } from '../src/core/plan-data.ts';
import type { PlanInput } from '../src/core/plan/context.ts';
import { competing, dropSlot, fitTime, pairNotes, REST, restKind, restNote, setMinutes, type BuiltSlot, type BuiltTemplate } from '../src/core/plan/dose.ts';
import { generatePlan } from '../src/core/plan/generate.ts';
import type { ExerciseSlot, Profile, Program } from '../src/core/schema.ts';
import { validateProgram } from '../src/core/validate.ts';
import { ROOT } from './helpers.ts';

const E = (id: string) => CATALOGUE_BY_ID.get(id)!;
const built = (id: string, role: 'main' | 'accessory', sets: number, repRange: [number, number] = [8, 12]): BuiltSlot => ({ entry: E(id), role, fixed: false, pinned: false, slotIndex: 0, sets, repRange, rir: 2, note: restNote(E(id), role, repRange) });
const tpl = (slots: BuiltSlot[], capacity: number, minimumDose = false): BuiltTemplate => ({ blueprint: { id: 'x', name: 'x', kind: 'lift', day: null, slots: [] }, minimumDose, finisher: null, capacity, slots });

describe('the rest for each slot', () => {
  it('2-3 min on heavy compound lifts, 90 s for everything else, holds included', () => {
    assert.equal(restKind(E('back-squat'), 'main', [5, 8]), 'heavy');
    assert.equal(restKind(E('goblet-squat'), 'main', [10, 15]), 'sets', 'a lighter day\'s variation at 10-15 is not heavy');
    assert.equal(restKind(E('db-row'), 'accessory', [6, 10]), 'heavy', 'a compound accessory at 6 reps or fewer');
    assert.equal(restKind(E('db-row'), 'accessory', [8, 12]), 'sets');
    assert.equal(restKind(E('cable-pushdown'), 'accessory', [10, 15]), 'sets');
    assert.equal(restKind(E('plank'), 'accessory', [1, 1]), 'sets');
    assert.deepEqual([REST.heavy.text, REST.sets.text, REST.pair.text], ['2-3 min', '90 s', '90 s after each pair']);
    assert.equal(restNote(E('back-squat'), 'main', [5, 8]), 'Rest 2-3 min.');
  });

  it('times a superset by its rounds: a set of each, then one rest', () => {
    const a = built('db-curl', 'accessory', 3);
    const b = { ...built('leg-extension', 'accessory', 3), pair: true };
    assert.equal(setMinutes(tpl([a, b], 99)), 3 * (0.5 + 0.5 + 1.5));
    assert.equal(setMinutes(tpl([a, { ...b, sets: 2 }], 99)), 2 * 2.5 + 1 * 2, 'the extra set alone');
    assert.equal(setMinutes(tpl([built('back-squat', 'main', 3, [5, 8])], 99)), 3 * 2.5);
  });
});

describe('fitting the minutes: supersets before fewer sets', () => {
  it('pairs non-competing accessories first and keeps their sets', () => {
    const t = tpl([built('back-squat', 'main', 3, [5, 8]), built('db-row', 'accessory', 3), built('db-curl', 'accessory', 3), built('leg-extension', 'accessory', 3)], 24);
    assert.equal(setMinutes(t), 7.5 + 18);
    const r = fitTime(t);
    assert.deepEqual(r.value.slots.map((s) => [s.entry.id, s.sets, s.pair ?? false]), [['back-squat', 3, false], ['db-row', 3, false], ['db-curl', 3, false], ['leg-extension', 3, true]]);
    assert.match(r.reason.note ?? '', /Supersets for time \(90 s after each pair\): db-curl \+ leg-extension/);
  });

  it('never pairs muscles that compete (a row and a curl); neighbours first, else a partner moves up beside the slot it pairs with', () => {
    assert.equal(competing(E('db-row'), E('db-curl')), true, 'the curl\'s biceps help the row');
    const near = fitTime(tpl([built('back-squat', 'main', 3, [5, 8]), built('leg-extension', 'accessory', 3), built('db-row', 'accessory', 3), built('db-curl', 'accessory', 3)], 21)).value.slots;
    assert.deepEqual(near.map((s) => [s.entry.id, s.pair ?? false]), [['back-squat', false], ['leg-extension', false], ['db-row', true], ['db-curl', false]]);
    // Each neighbour competes (quads, then hamstrings); the leg curl moves up beside the leg extension.
    const far = fitTime(tpl([built('back-squat', 'main', 3, [5, 8]), built('leg-extension', 'accessory', 3), built('db-split-squat', 'accessory', 3), built('seated-leg-curl', 'accessory', 3)], 24)).value.slots;
    assert.deepEqual(far.map((s) => [s.entry.id, s.pair ?? false]), [['back-squat', false], ['leg-extension', false], ['seated-leg-curl', true], ['db-split-squat', false]]);
  });

  it('trims sets only when no pair is left, and pairs a minimum-dose session\'s accessories whatever the time', () => {
    const tight = fitTime(tpl([built('back-squat', 'main', 3, [5, 8]), built('db-row', 'accessory', 3), built('db-curl', 'accessory', 3)], 15)).value;
    assert.ok(tight.slots.every((s) => !s.pair));
    assert.ok(setMinutes(tight) <= 15);
    const min = fitTime(tpl([built('back-squat', 'main', 2, [5, 8]), built('db-row', 'accessory', 2), built('plank', 'accessory', 2, [1, 1])], 99, true)).value;
    assert.deepEqual(min.slots.map((s) => s.pair ?? false), [false, false, true]);
  });

  it('writes the pair into both notes; a dropped slot leaves its partner as straight sets', () => {
    const slots = [built('db-curl', 'accessory', 3), { ...built('leg-extension', 'accessory', 3), pair: true }];
    const noted = pairNotes(slots);
    assert.equal(noted[0]!.note, 'Rest 90 s after each pair. Superset with Leg extension: a set of each, then rest.');
    assert.equal(noted[1]!.note, `Rest 90 s after each pair. Superset with ${E('db-curl').name}: a set of each, then rest.`);
    const list = [...slots];
    dropSlot(list, list[0]!);
    assert.deepEqual(list.map((s) => [s.entry.id, s.pair]), [['leg-extension', undefined]]);
  });
});

describe('the drafts: every set rests at least 90 s, and pairs reach plan-data', () => {
  const inputs = ['athletes', 'plans'].flatMap((d) => readdirSync(join(ROOT, 'test', 'fixtures', d)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', d, f), 'utf8')).input as PlanInput));

  it('writes only 2-3 min, 90 s or 90 s after each pair on lifting slots, in every fixture\'s plan', () => {
    for (const input of inputs) {
      const program: Program | null = generatePlan(input).value.program;
      if (!program) continue;
      const ex = program.exercises;
      for (const w of program.macrocycle.phases[0]!.mesocycles[0]!.weeks.filter((x) => x.kind === 'loading' && !x.calibration)) {
        for (const t of w.sessions.filter((x) => x.kind === 'lift')) {
          for (const s of t.slots.filter((x: ExerciseSlot) => ex[x.exercise]!.kind !== 'cardio')) {
            const rest: string | undefined = /^Rest ([^.]+)\./.exec(s.note ?? '')?.[1];
            assert.ok(rest === '2-3 min' || rest === '90 s' || rest === '90 s after each pair', `${t.id} ${s.exercise}: ${s.note}`);
            if (s.main && (ex[s.exercise]!.pattern === 'squat' || ex[s.exercise]!.pattern === 'hinge') && s.repRange[0] < 10) assert.equal(rest, '2-3 min', `${t.id} ${s.exercise}`);
          }
        }
      }
    }
  });

  it('a short session pairs accessories as supersets: pair on the second item, the pair\'s rest on both', () => {
    const profile: Profile = {
      schemaVersion: 1,
      units: { load: 'kg', body: 'kg' },
      goals: [{ id: 'g', kind: 'recomposition', label: 'Recomposition', importance: 8, confidence: 7 }],
      availability: { daysPerWeek: 3, minutesPerSession: 30 },
      equipment: ['dumbbells', 'barbell', 'bench', 'cable', 'machine'],
      trackingLevel: 'standard',
      screening: { outcome: 'go', date: '2026-03-01' },
      emphasis: [],
      experience: 'novice',
    };
    const program = generatePlan({ profile, today: '2026-04-01' }).value.program!;
    assert.deepEqual(validateProgram(program), []);
    const pd = toPlanData(program).value.planData;
    const items = Object.values(pd.sessions).flat();
    const seconds = items.filter((i) => i.pair);
    assert.ok(seconds.length > 0, 'pairs in a minimum-dose week');
    for (const [, list] of Object.entries(pd.sessions)) {
      list.forEach((it, k) => {
        if (!it.pair) return;
        const first = list[k - 1]!;
        assert.equal(it.rest, '90 s after each pair');
        assert.equal(first.rest, '90 s after each pair');
        assert.match(first.note ?? '', /Superset with /);
        assert.ok(!first.pair);
      });
    }
  });

  it('the validator takes a slot\'s pair as a boolean only', () => {
    const program = generatePlan({ profile: JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'athletes', '5-bodyweight-30.json'), 'utf8')).input.profile, today: '2026-04-01' }).value.program!;
    const s = program.macrocycle.phases[0]!.mesocycles[0]!.weeks[0]!.sessions[0]!.slots[0]!;
    (s as unknown as Record<string, unknown>)['pair'] = 'yes';
    assert.match(validateProgram(program).map((e) => e.path).join(' '), /slots\[0\]\.pair/);
  });
});
