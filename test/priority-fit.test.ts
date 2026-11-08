// The plan generator's priority muscles, on the owner's shape: four listed
// priority muscles (abs added at his request), abs on the short days (cardio
// and core), the core ladder at level 3 from a 60 s plank. Every listed
// priority muscle is kept, and more than the week has room for is a warning
// (`priority-over-room`), never a drop; no slot picks a lower level of a
// ladder than the user's; a priority muscle short of its direct sets near
// failure gets a set where the session allows, then a swap, and what stays
// short is a warning with what blocked it (`priority-short`).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { run } from '../src/cli/cli.ts';
import { CATALOGUE_BY_ID, type CatalogueEntry } from '../src/core/data/exercises.ts';
import { LADDER_BY_ID } from '../src/core/data/ladders.ts';
import { buildContext, priorityFor, priorityOverRoom, type PlanInput } from '../src/core/plan/context.ts';
import type { BuiltSlot, BuiltTemplate } from '../src/core/plan/dose.ts';
import { generatePlan } from '../src/core/plan/generate.ts';
import { pick } from '../src/core/plan/select.ts';
import { selfCheckPlan } from '../src/core/plan/self-check.ts';
import type { Blueprint } from '../src/core/plan/template.ts';
import { fitVolume, hardDirectVolume, layoutVolume } from '../src/core/plan/volume-fit.ts';
import type { Profile, Program } from '../src/core/schema.ts';
import { setEffort, type EffortContext } from '../src/core/volume.ts';
import { fixtureFiles, memoryIo, ROOT } from './helpers.ts';

const athlete = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'athletes', '2-desk-recomp.json'), 'utf8')) as { input: PlanInput };
const FOUR = ['upper-back', 'lats', 'quads', 'abs'];
/** The owner's shape: the made-up desk recomp athlete (4 days of 60 min and 3 of 30, a 60 s plank) with his four listed priorities. */
const owner: PlanInput = { ...athlete.input, profile: { ...athlete.input.profile, priorityMuscles: FOUR } };

const profile = (p: Partial<Profile> = {}): Profile => ({
  schemaVersion: 1,
  units: { load: 'kg', body: 'kg' },
  goals: [{ id: 'g', kind: 'recomposition', label: 'Recomposition', importance: 8, confidence: 7 }],
  availability: { daysPerWeek: 3, minutesPerSession: 45 },
  equipment: ['dumbbells', 'barbell', 'bench', 'cable', 'machine'],
  trackingLevel: 'standard',
  screening: { outcome: 'go', date: '2026-03-01' },
  emphasis: [],
  experience: 'novice',
  ...p,
});

/** Every slot of every week, with the week's 1-based index. */
const slotsOf = (p: Program) => {
  let i = 0;
  return p.macrocycle.phases.flatMap((ph) => ph.mesocycles.flatMap((m) => m.weeks.flatMap((w) => (i++, w.sessions.flatMap((t) => t.slots.map((s) => ({ week: i, template: t.id, kind: w.kind, slot: s })))))));
};

describe('priority muscles: every one the profile lists is kept', () => {
  it('keeps all four of the owner\'s, in his order, each from the profile', () => {
    const r = priorityFor(owner.profile, owner.profile.goals, true, 3);
    assert.deepEqual(r.map((x) => [x.value.muscle, x.value.source]), FOUR.map((m) => [m, 'profile']));
    const plan = generatePlan(owner).value;
    assert.deepEqual(plan.program!.priorityMuscles, FOUR);
    assert.deepEqual(plan.proposal.priority.map((x) => x.muscle), FOUR);
  });

  it('still sizes the ones derived from a goal to the room, with no warning', () => {
    const plan = generatePlan(athlete.input).value;
    assert.deepEqual(plan.proposal.priority.map((x) => [x.muscle, x.source]), [['upper-back', 'posture'], ['lats', 'posture'], ['quads', 'goal']]);
    assert.equal(plan.proposal.warnings.some((w) => w.code === 'priority-over-room'), false);
  });

  it('warns when the named ones pass the lifting days\' room, with its reason', () => {
    const plan = generatePlan(owner).value;
    const w = plan.proposal.warnings.find((x) => x.code === 'priority-over-room')!;
    assert.deepEqual(w.muscles, FOUR);
    assert.equal(w.reason.rule, 'plan.priority-room');
    assert.deepEqual(w.reason.inputs, { priority: FOUR, liftingDays: 4, minutes: 60, shortSessions: [] });
    assert.match(w.reason.note!, /^4 priority muscles \(Upper back, Lats, Quads, Abs\) on 4 lifting day\(s\) of 60 min, where the week has room for 3 .*all are kept/);
    assert.match(w.reason.note!, /Abs and obliques trained on the short days \(cardio and core\) would not count against it\./);
    assert.equal(buildContext(owner).priorityRoom, 3);
  });

  it('does not count a priority muscle the plan trains only on its short sessions (abs on cardio-and-core days)', () => {
    const named = priorityFor(owner.profile, owner.profile.goals, true, 3).map((s) => s.value.muscle);
    assert.equal(priorityOverRoom(named, 3, { short: ['abs', 'obliques'] }, { liftingDays: 4, minutes: 60 }), null);
    const two = priorityOverRoom(named, 2, { short: ['abs'] }, { liftingDays: 3, minutes: 60 })!;
    assert.deepEqual([two.value.counted, two.value.shortSessions], [['upper-back', 'lats', 'quads'], ['abs']]);
    assert.match(two.reason.note!, /Abs, trained only on the short sessions, do not count against the room\./);
    // Direct sets on a lifting day count, whatever the short days add.
    const lifted = priorityOverRoom(named, 3, { short: ['abs'], lifting: ['abs', 'quads'] }, { liftingDays: 4, minutes: 60 })!;
    assert.deepEqual([lifted.value.counted, lifted.value.shortSessions], [FOUR, []]);
  });

  it('counts the effective priority muscles, as check does: a declared region\'s muscle too', () => {
    const declared: PlanInput = { ...owner, profile: { ...owner.profile, priorityMuscles: ['upper-back', 'lats', 'quads'], priorityRegions: ['shoulders-side'] } };
    const w = generatePlan(declared).value.proposal.warnings.find((x) => x.code === 'priority-over-room')!;
    assert.deepEqual(w.muscles, ['upper-back', 'lats', 'quads', 'shoulders']);
  });

  it('reaches the CLI\'s warnings, with the muscles as items', () => {
    const files = fixtureFiles('v');
    files['v/owner.json'] = JSON.stringify(owner.profile);
    const r = run(['plan', '--profile', 'v/owner.json'], memoryIo(files, '2026-11-04'));
    assert.equal(r.code, 0, r.stdout);
    const w = JSON.parse(r.stdout).warnings.find((x: { code: string }) => x.code === 'priority-over-room');
    assert.deepEqual(w.items, FOUR);
    assert.match(w.message, /room for 3/);
  });
});

describe('no slot picks a lower level of a ladder than the user\'s', () => {
  const kit = { bar: true, loadedPress: true, loadedSingleLeg: true, pulldown: true };

  it('names the lower levels of each tested ladder, and the movement at the level', () => {
    const p = selfCheckPlan({ date: '2026-11-02', coreHold: { kind: 'plank', seconds: 60 }, pullUps: 5, pushUps: 30, balanceS: { left: 30, right: 30 }, sitToStand: { easy: true, heelsDown: true } }, kit);
    const below = Object.fromEntries(p.effects.filter((e) => e.value.belowLevel).map((e) => [e.value.input, e.value.belowLevel]));
    assert.deepEqual(below['coreHold'], { ids: ['dead-bug'], level: 'hollow-hold' });
    assert.deepEqual(below['pullUps'], { ids: ['dead-hang', 'scapular-pull-up', 'inverted-row', 'negative-pull-up', 'assisted-pull-up'], level: 'pull-up' });
    assert.deepEqual(below['pushUps'], { ids: ['incline-push-up'], level: 'push-up' });
    assert.deepEqual(below['balanceS'], { ids: ['split-squat'], level: 'box-pistol' });
    // Without a bar the pull-up ladder cannot be done at its level: inverted rows stay.
    assert.equal(selfCheckPlan({ date: '2026-11-02', pullUps: 5 }, { ...kit, bar: false }).effects.some((e) => e.value.belowLevel), false);
    // Level 1 has nothing below it.
    assert.equal(selfCheckPlan({ date: '2026-11-02', coreHold: { kind: 'plank', seconds: 20 } }, kit).effects.some((e) => e.value.belowLevel), false);
  });

  it('gives a core slot the ladder at the user\'s level when the week already has it, not the dead bug or a plank', () => {
    const ctx = buildContext(owner);
    const slot = { pattern: 'core-anti-extension' as const, role: 'accessory' as const, prefer: ['hollow-hold', 'dead-bug'] };
    const got = pick(ctx, slot, ctx.start, new Set(), new Set(['hollow-hold']), 0);
    assert.equal(got?.id, 'hollow-hold');
    // In a session that already holds it, the next candidate without the lower levels.
    assert.notEqual(pick(ctx, slot, ctx.start, new Set(['hollow-hold']), new Set(), 0)?.id, 'dead-bug');
  });

  it('leaves no movement below the self-check\'s levels anywhere in the owner\'s plan', () => {
    const plan = generatePlan(owner).value;
    const levels = plan.proposal.ladders.filter((l) => l.level !== null);
    for (const { week, template, slot } of slotsOf(plan.program!)) {
      for (const l of levels) {
        const ids = LADDER_BY_ID.get(l.id)!.levels.map((x) => x.exercise);
        const at = ids.lastIndexOf(slot.exercise) + 1;
        assert.ok(at === 0 || at >= l.level!, `week ${week} ${template}: ${slot.exercise} is level ${at} of the ${l.id} ladder, below ${l.level}`);
      }
    }
    // The light hinge day's anti-extension slot: the core ladder at level 3, as the heavy squat day's.
    const light = plan.proposal.sessions.find((s) => s.id === 'light-hinge')!;
    assert.deepEqual(light.slots.find((s) => s.exercise === 'hollow-hold')?.ladder, { id: 'hollow', level: 3, name: 'Hollow hold, arms by sides' });
    assert.equal(light.slots.some((s) => s.exercise === 'dead-bug' || s.exercise === 'plank'), false);
  });

  it('replaces only the slots that picked a lower level: the 0.14.0 desk recomp athlete loses its dead bug and nothing else', () => {
    const plan = generatePlan(athlete.input).value;
    const light = plan.proposal.sessions.find((s) => s.id === 'light-hinge')!;
    // The rear-delt slot rotates over the catalogue's rear-delt movements, the reverse pec deck among them.
    assert.deepEqual(light.slots.map((s) => s.exercise), ['single-leg-rdl', 'lat-pulldown', 'landmine-press', 'reverse-lunge', 'hollow-hold', 'db-lateral-raise', 'reverse-pec-deck', 'zone2-bike']);
  });
});

describe('a priority muscle short of its direct sets near failure', () => {
  it('reaches 10 for each of the owner\'s four in every loading week, abs from the core ladder and loaded work', () => {
    const plan = generatePlan(owner).value;
    assert.equal(plan.proposal.status, 'ok', JSON.stringify(plan.proposal.checks.filter((c) => !c.passed)));
    for (const v of plan.proposal.volume) for (const m of FOUR) assert.ok(v.split[m]!.hardDirect >= 10, `week ${v.week} ${m} ${v.split[m]!.hardDirect}`);
    assert.equal(plan.proposal.warnings.some((w) => w.code === 'priority-short'), false);
  });

  it('swaps an accessory for one that trains it directly when no set can be added, and says so', () => {
    // Five 30-minute days on machines: abs a priority, no set left to add for them.
    const input: PlanInput = { profile: profile({ availability: { daysPerWeek: 5, minutesPerSession: 30 }, equipment: ['machine', 'cable'], experience: 'intermediate', priorityMuscles: ['abs'] }), today: '2026-04-01' };
    const plan = generatePlan(input).value;
    assert.ok(plan.proposal.why.some((w) => /^Mesocycle 1: .+ swapped for .+, so abs reaches its 10 direct sets near failure/.test(w)), plan.proposal.why.join('\n'));
    for (const v of plan.proposal.volume) assert.ok(v.split['abs']!.hardDirect >= 10, `week ${v.week}`);
    assert.ok(plan.proposal.checks.find((c) => c.id === 'volume')!.passed);
    // The guards stay: time, the concurrent checks.
    assert.ok(plan.proposal.checks.find((c) => c.id === 'time')!.passed && plan.proposal.checks.find((c) => c.id === 'concurrent')!.passed);
  });

  it('reports what stays short with what blocked it', () => {
    // Three 30-minute bodyweight days and four listed priorities: no room for abs's ten.
    const input: PlanInput = { profile: profile({ availability: { daysPerWeek: 3, minutesPerSession: 30 }, equipment: [], experience: 'advanced', priorityMuscles: FOUR }), today: '2026-04-01' };
    const plan = generatePlan(input).value;
    const w = plan.proposal.warnings.find((x) => x.code === 'priority-short')!;
    assert.deepEqual(w.muscles, ['abs']);
    assert.equal(w.reason.rule, 'plan.priority-short');
    assert.match(w.reason.note!, /^Abs: \d+ direct sets near failure a week in mesocycle \d+.*, under the 10 a priority muscle needs; /);
    assert.ok((w.reason.inputs['have'] as number) < 10);
    assert.ok(plan.proposal.warnings.some((x) => x.code === 'priority-over-room'), 'four named on three 30-minute days');
  });
});

describe('the fit\'s swap and its guards', () => {
  const entry = (id: string): CatalogueEntry => CATALOGUE_BY_ID.get(id)!;
  const s = (id: string, sets: number, slotIndex: number, extra: Partial<BuiltSlot> = {}): BuiltSlot => ({ entry: entry(id), role: 'accessory', fixed: false, pinned: false, slotIndex, sets, repRange: [8, 12], rir: 2, note: '', ...extra });
  const bp = (id: string): Blueprint => ({ id, name: id, kind: 'lift', day: null, slots: [] });
  /** Two sessions: a squat, a reverse crunch at its 4 sets (no set left to add) and a curl; minutes to spare. */
  const sessions = (): BuiltTemplate[] =>
    ['a', 'b'].map((id) => ({ blueprint: bp(id), minimumDose: false, finisher: null, capacity: 60, slots: [s('back-squat', 3, 0, { role: 'main' }), s('reverse-crunch', 4, 1), s('db-curl', 2, 2)] }));
  const ladders: EffortContext = { holds: {}, ladders: [{ id: 'hollow', name: 'Core (abs)', levels: LADDER_BY_ID.get('hollow')!.levels.map((l) => l.exercise), level: 3 }] };
  const hard = (x: BuiltSlot) => setEffort({ exercise: x.entry.id, rir: x.rir }, ladders).value.effort !== 'easy';
  const input = { layouts: [['a', 'b']], priority: ['abs'], pullPush: null, minimumDose: false, hard };
  const offer = (ids: string[]) => (_t: BuiltTemplate, slot: BuiltSlot) => ids.map((id) => s(id, 2, slot.slotIndex));

  it('swaps the curl for a Pallof press: abs from 8 to 10 direct near failure, the later session first', () => {
    const r = fitVolume({ ...input, templates: sessions(), swaps: offer(['pallof-press']) });
    assert.equal(hardDirectVolume(r.value.templates, ['a', 'b'], hard)['abs'], 10);
    assert.deepEqual(r.value.swaps, [{ template: 'b', from: 'db-curl', to: 'pallof-press', muscle: 'abs', for: 'priority' }]);
    assert.deepEqual(r.value.shortfalls, []);
    assert.match(r.reason.note!, /Swapped for a priority muscle's direct sets near failure: b\/db-curl -> pallof-press \(abs\)\./);
  });

  it('swaps a free accessory for a movement that helps a major muscle under its minimum dose, when nothing trains it', () => {
    // No slot trains or helps the hamstrings: the curls make way for split squats (which help them) until the minimum of 4 is met.
    const legs = (): BuiltTemplate[] => ['a', 'b'].map((id) => ({ blueprint: bp(id), minimumDose: true, finisher: null, capacity: 60, slots: [s('back-squat', 3, 0, { role: 'main' }), s('db-curl', 2, 1)] }));
    const base = { layouts: [['a', 'b']], priority: [], pullPush: null, minimumDose: true };
    const none = fitVolume({ ...base, templates: legs() }).value;
    assert.deepEqual(none.swaps, []);
    const r = fitVolume({ ...base, templates: legs(), cover: offer(['split-squat']) });
    assert.ok(r.value.swaps.length > 0 && r.value.swaps.every((x) => x.from === 'db-curl' && x.to === 'split-squat' && x.muscle === 'hamstrings' && x.for === 'minimum'), JSON.stringify(r.value.swaps));
    assert.ok((layoutVolume(r.value.templates, ['a', 'b'])['hamstrings'] ?? 0) >= 4);
    assert.match(r.reason.note!, /Swapped for a major muscle's minimum of 4 sets: .*db-curl -> split-squat \(hamstrings\)/);
  });

  it('keeps every other muscle in its band: a lateral raise under the shoulders\' 6 is not given up', () => {
    const shoulders = sessions().map((t) => ({ ...t, slots: t.slots.map((x) => (x.entry.id === 'db-curl' ? { ...x, entry: entry('cable-lateral-raise') } : x)) }));
    const r = fitVolume({ ...input, templates: shoulders, swaps: offer(['pallof-press']) }).value;
    assert.deepEqual(r.swaps, []);
    assert.equal(r.shortfalls[0]!.muscle, 'abs');
  });

  it('never swaps in a lower level of a ladder (not near failure), a movement already in the session, or past the concurrent checks', () => {
    const bug = fitVolume({ ...input, templates: sessions(), swaps: offer(['dead-bug', 'reverse-crunch']) }).value;
    assert.deepEqual(bug.swaps, []);
    assert.deepEqual(bug.shortfalls.map((f) => [f.muscle, f.have]), [['abs', 8]]);
    const guarded = fitVolume({ ...input, templates: sessions(), swaps: offer(['pallof-press']), concurrent: (ts) => (ts.some((t) => t.slots.some((x) => x.entry.id === 'pallof-press')) ? ['back-to-back: a, b'] : []) }).value;
    assert.deepEqual(guarded.swaps, []);
    assert.match(guarded.shortfalls[0]!.blocked.join('; '), /every swap would push another muscle out of its band, or break .* the concurrent-training checks/);
  });

  it('says what blocked each way when nothing can reach it', () => {
    const r = fitVolume({ ...input, templates: sessions(), swaps: () => [] });
    const f = r.value.shortfalls[0]!;
    assert.deepEqual([f.muscle, f.have, f.need], ['abs', 8, 10]);
    assert.ok(f.blocked.includes('Reverse crunch in a is at 4 sets') && f.blocked.includes('Reverse crunch in b is at 4 sets'));
    assert.ok(f.blocked.some((b) => /^no movement that trains it directly near failure fits a free slot/.test(b)));
    assert.match(r.reason.note!, /Abs: 8 direct sets near failure of the 10; /);
    // A pinned or fixed slot is not free to swap.
    const pinned = sessions().map((t) => ({ ...t, slots: t.slots.map((x) => (x.entry.id === 'db-curl' ? { ...x, pinned: true } : x)) }));
    assert.ok(fitVolume({ ...input, templates: pinned, swaps: offer(['pallof-press']) }).value.shortfalls[0]!.blocked.some((b) => /^no accessory or core slot is free to swap/.test(b)));
  });

  it('lets the half credit from helping lifts take a priority muscle past 16 on top of its 10, never past 20', () => {
    // Back squats and goblet squats help abs: 3 + 3 sets a session, 6 of half credit a week.
    const helped = (squat: number, more: BuiltSlot[] = []): BuiltTemplate[] =>
      ['a', 'b'].map((id) => ({ blueprint: bp(id), minimumDose: false, finisher: null, capacity: 90, slots: [s('back-squat', squat, 0, { role: 'main' }), s('goblet-squat', 3, 1), s('hollow-hold', 2, 2), s('reverse-crunch', 2, 3), ...more.map((x) => ({ ...x }))] }));
    const at16 = fitVolume({ ...input, templates: helped(3) }).value;
    assert.equal(hardDirectVolume(at16.templates, ['a', 'b'], hard)['abs'], 10);
    // A back squat set more a session: 7 of credit, so 10 direct is 17 in all, inside its top of 10 + 7 (16 would stop it at 9).
    const at17 = fitVolume({ ...input, templates: helped(4) }).value;
    assert.equal(hardDirectVolume(at17.templates, ['a', 'b'], hard)['abs'], 10);
    assert.deepEqual(at17.shortfalls, []);
    // Push-ups and farmer carries help abs too: 11 of credit, so 10 direct would be 21, past the cap of 20.
    const at21 = fitVolume({ ...input, templates: helped(4, [s('push-up', 3, 4), s('farmer-carry', 2, 5)]) }).value;
    assert.ok((hardDirectVolume(at21.templates, ['a', 'b'], hard)['abs'] ?? 0) < 10);
    assert.match(at21.shortfalls[0]!.blocked.join('; '), /another direct set would take abs past its top of 20 sets in all \(1\d(\.5)? of them half credit from the lifts it helps\)/);
  });

  it('adds the minimum\'s sets under the posture emphasis while pull is short of twice push: an ab set cannot lower it', () => {
    const t = (id: string): BuiltTemplate => ({ blueprint: bp(id), minimumDose: false, finisher: null, capacity: 60, slots: [s('db-row', 3, 0, { role: 'main' }), s('db-bench', 2, 1, { role: 'main', sets: 2 }), s('reverse-crunch', 2, 2), s('hollow-hold', 2, 3)] });
    // Pull 6, push 4 in the week (1.5): the bench press is under a main lift's 3 sets, so no push set can go, and one more row alone does not reach 2.
    const r = fitVolume({ templates: [t('a'), t('b')], layouts: [['a', 'b']], priority: ['abs'], pullPush: { target: 2, why: 'finding' as const }, minimumDose: false, hard }).value;
    assert.ok((hardDirectVolume(r.templates, ['a', 'b'], hard)['abs'] ?? 0) >= 10);
  });
});
