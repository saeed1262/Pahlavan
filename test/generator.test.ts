// Unit tests for the plan generator's steps (src/core/plan/).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATALOGUE_BY_ID } from '../src/core/data/exercises.ts';
import { conditioningPlan, layoutDays } from '../src/core/plan/conditioning.ts';
import { buildContext, incrementFor, normalizeEquipment, toExercise, type PlanInput } from '../src/core/plan/context.ts';
import { baseRir, fitTime, progressionRule, repRange, type BuiltTemplate } from '../src/core/plan/dose.ts';
import { generatePlan } from '../src/core/plan/generate.ts';
import { buildMacrocycle } from '../src/core/plan/macrocycle.ts';
import { calendar, targets } from '../src/core/plan/schedule.ts';
import { pick, rankCandidates } from '../src/core/plan/select.ts';
import { sizeWeek } from '../src/core/plan/size.ts';
import { chooseTemplate, templateCandidates } from '../src/core/plan/template.ts';
import { selfCheckPlan } from '../src/core/plan/self-check.ts';
import { priorityFor } from '../src/core/plan/context.ts';
import { compareTemplates } from '../src/core/plan/compare.ts';
import type { Profile, Session } from '../src/core/schema.ts';

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
const ctxOf = (p: Partial<Profile> = {}, options: PlanInput['options'] = {}) => buildContext({ profile: profile(p), today: '2026-04-01', options });
const E = (id: string) => CATALOGUE_BY_ID.get(id)!;

describe('context', () => {
  it('starts on the Monday on or after today and normalizes equipment', () => {
    assert.equal(ctxOf().start, '2026-04-06');
    assert.equal(buildContext({ profile: profile(), today: '2026-04-06' }).start, '2026-04-06');
    const n = normalizeEquipment(['Dumbbells', 'TRX', 'pull-up bar', 'rowing machine']);
    assert.deepEqual([...n.equipment].sort(), ['bodyweight', 'dumbbell', 'pull-up-bar', 'rings']);
    assert.deepEqual(n.unknown, ['rowing machine']);
  });

  it('picks steps that exist and converts entries to schema exercises', () => {
    assert.equal(incrementFor(E('back-squat'), 'kg'), 5);
    assert.equal(incrementFor(E('bench-press'), 'kg'), 2.5);
    assert.equal(incrementFor(E('bench-press'), 'lb'), 5);
    assert.equal(incrementFor(E('lat-pulldown'), 'lb'), 10);
    assert.equal(incrementFor(E('goblet-squat'), 'kg'), 2.5);
    assert.deepEqual(toExercise(E('plank'), 'kg'), { name: E('plank').name, pattern: 'core-anti-extension', kind: 'timed', risk: ['abdomen-low'], equipment: 'bodyweight', muscles: { main: ['abs'], helps: ['shoulders'] } });
    assert.equal(toExercise(E('zone2-bike'), 'kg').kind, 'cardio');
  });
});

describe('step 1: template', () => {
  const id = (p: Partial<Profile>) => chooseTemplate(ctxOf(p), p.availability!.daysPerWeek, p.availability!.minutesPerSession).value;
  it("follows planning.md's split table", () => {
    const cases: [number, number, 'novice' | 'intermediate' | 'advanced', string][] = [
      [2, 30, 'novice', 'full-body-minimum-x2'],
      [2, 45, 'novice', 'full-body-ab'],
      [2, 75, 'novice', 'full-body-ab-plus'],
      [3, 30, 'novice', 'full-body-minimum-x3'],
      [3, 60, 'novice', 'full-body-aba'],
      [3, 60, 'intermediate', 'full-body-undulating'],
      [3, 90, 'intermediate', 'full-body-undulating-plus'],
      [4, 25, 'intermediate', 'upper-lower-minimum'],
      [4, 60, 'intermediate', 'upper-lower-x2'],
      [4, 61, 'intermediate', 'upper-lower-heavy-volume'],
      [5, 60, 'intermediate', 'upper-lower-push-pull-legs'],
      [6, 60, 'advanced', 'push-pull-legs-x2'],
      [5, 30, 'advanced', 'upper-lower-full'],
    ];
    for (const [d, m, x, want] of cases) assert.equal(id({ availability: { daysPerWeek: d, minutesPerSession: m }, experience: x }).id, want, `${d} x ${m} ${x}`);
  });

  it('caps novices at 4 lifting days and Conservative and health at 3 full-body days', () => {
    const nov = id({ availability: { daysPerWeek: 6, minutesPerSession: 60 } });
    assert.deepEqual([nov.liftingDays, nov.extraDays], [4, 2]);
    const cons = id({ availability: { daysPerWeek: 5, minutesPerSession: 60 }, experience: 'intermediate', screening: { outcome: 'conservative', date: '2026-03-01' } });
    assert.deepEqual([cons.family, cons.liftingDays, cons.extraDays], ['full-body', 3, 2]);
    const health = id({ availability: { daysPerWeek: 4, minutesPerSession: 45 }, goals: [{ id: 'h', kind: 'health', label: 'h', importance: 9, confidence: 7 }] });
    assert.deepEqual([health.family, health.liftingDays], ['full-body', 3]);
  });

  it('adds the skill block, balance work at 65+ and posture work', () => {
    const skill = id({ availability: { daysPerWeek: 3, minutesPerSession: 60 }, goals: [{ id: 's', kind: 'skill', label: 's', importance: 9, confidence: 8 }] });
    assert.ok(skill.blueprints.every((b) => b.slots[0]!.pattern === 'skill'));
    const senior = id({ availability: { daysPerWeek: 2, minutesPerSession: 45 }, basics: { birthYear: 1958 } });
    assert.ok(senior.blueprints.every((b) => b.slots.some((s) => s.prefer?.includes('single-leg-stance'))));
    const posture = id({ availability: { daysPerWeek: 4, minutesPerSession: 60 }, experience: 'intermediate', emphasis: [{ area: 'p', seen: 'p', confidence: 'high', emphasis: 'p', kind: 'forward-head-rounded-shoulders' }] });
    assert.ok(posture.blueprints.every((b) => b.slots.some((s) => s.pattern === 'rear-delt')));
  });
});

describe('step 2: week size', () => {
  const sessions = (dates: string[]): Session[] => dates.map((date) => ({ id: date, date, trackingLevel: 'light', exercises: [], plan: { weekKind: 'loading', template: 'x', kind: 'lift', slots: [] } }));
  it('sizes from the stated days without opted-in history', () => {
    assert.deepEqual(sizeWeek(ctxOf()).value, { stated: 3, days: 3, minutes: 45, confirmed: null, resized: false, shortMinutes: null, longDays: 3 });
    const ignored = ctxOf({}, { history: { sessions: sessions(['2026-03-02']) } });
    assert.equal(sizeWeek(ignored).value.confirmed, null); // useHistory not set
  });

  it('uses confirmed sessions + 1, and resizes after two weeks under 70 %', () => {
    const four = ['2026-03-02', '2026-03-04', '2026-03-06', '2026-03-09', '2026-03-11', '2026-03-13', '2026-03-16', '2026-03-18', '2026-03-20', '2026-03-23', '2026-03-25', '2026-03-27'];
    const ok = sizeWeek(ctxOf({ useHistory: true, availability: { daysPerWeek: 5, minutesPerSession: 45 } }, { history: { sessions: sessions(four), previousTarget: { lift: 3, short: 0 } } })).value;
    assert.deepEqual([ok.confirmed, ok.days, ok.resized], [3, 4, false]);
    const low = sizeWeek(ctxOf({ useHistory: true, availability: { daysPerWeek: 5, minutesPerSession: 45 } }, { history: { sessions: sessions(['2026-03-02', '2026-03-04', '2026-03-06', '2026-03-09', '2026-03-11', '2026-03-16', '2026-03-23']), weekly: [{ weekOf: '2026-03-16', unloggedSessions: 1 }], previousTarget: { lift: 4, short: 0 } } }));
    assert.deepEqual([low.value.days, low.value.resized], [3, true]); // (3 + 2 + 2 + 1) / 4 = 2 a week: 2 + 1 = 3; the last two weeks at 50 % and 25 %
    assert.match(low.reason.note ?? '', /never more sessions/);
  });
});

describe('step 3: macrocycle', () => {
  it('builds 12, 16 and 24 weeks with deloads every 4th week and tests at phase ends', () => {
    for (const [weeks, phases, tests] of [[12, 2, [8, 12]], [16, 2, [8, 16]], [24, 3, [8, 16, 24]]] as const) {
      const m = buildMacrocycle(ctxOf({}, { weeks })).value;
      assert.equal(m.weeks.length, weeks);
      assert.equal(m.phases.length, phases);
      assert.deepEqual(m.weeks.filter((w) => w.kind === 'deload').map((w) => w.index), Array.from({ length: weeks / 4 }, (_, i) => 4 * (i + 1)));
      assert.deepEqual(m.weeks.filter((w) => w.tests).map((w) => w.index), [...tests]);
      assert.deepEqual(m.weeks.filter((w) => w.calibration).map((w) => w.index), [1]);
    }
    assert.deepEqual(buildMacrocycle(ctxOf()).value.phases.map((p) => p.name), ['Foundation', 'Build', 'Peak']);
    assert.deepEqual(buildMacrocycle(ctxOf({ goals: [{ id: 's', kind: 'strength', label: 's', importance: 9, confidence: 8 }] })).value.phases.map((p) => p.name), ['Accumulation', 'Intensification', 'Realization']);
    assert.throws(() => buildMacrocycle(ctxOf({}, { weeks: 12, deloadEvery: 5 })), RangeError);
  });
});

describe('step 4: exercise selection', () => {
  it('filters by equipment, level, dislikes and the Ledger, and ranks compound main lifts first', () => {
    const main = { pattern: 'squat' as const, role: 'main' as const };
    assert.equal(pick(ctxOf(), main, '2026-04-06', new Set(), new Set(), 0)!.id, 'back-squat');
    assert.equal(pick(ctxOf({ equipment: ['dumbbells'] }), main, '2026-04-06', new Set(), new Set(), 0)!.id, 'goblet-squat');
    assert.equal(pick(ctxOf({ equipment: ['machines'] }), main, '2026-04-06', new Set(), new Set(), 0)!.id, 'leg-press'); // two main muscles beat the leg extension
    assert.equal(pick(ctxOf({ preferences: { dislikes: ['back-squat'] } }), main, '2026-04-06', new Set(), new Set(), 0)!.id, 'goblet-squat');
    const ledger = ctxOf({}, { ledger: [{ id: 'abdomen', noTags: ['abdomen-high'], until: '2026-05-01' }] });
    assert.equal(pick(ledger, main, '2026-04-06', new Set(), new Set(), 0)!.id, 'goblet-squat');
    assert.equal(pick(ledger, main, '2026-05-04', new Set(), new Set(), 0)!.id, 'back-squat');
    const ranked = rankCandidates(ctxOf({ equipment: ['dumbbells'] }), main, '2026-04-06', new Set())!.ranked.map((e) => e.id);
    assert.ok(!ranked.includes('tempo-goblet-squat'), 'intermediate exercises are out for a novice');
  });

  it('honours emphasis regressions and falls back to a related pattern', () => {
    const heels = ctxOf({ equipment: ['dumbbells'], emphasis: [{ area: 'm', seen: 'm', confidence: 'medium', emphasis: 'm', kind: 'squat-heels-lift' }] });
    assert.equal(pick(heels, { pattern: 'squat', role: 'main', prefer: ['heel-elevated-goblet-squat'] }, '2026-04-06', new Set(), new Set(), 0)!.id, 'heel-elevated-goblet-squat');
    const overhead = ctxOf({ emphasis: [{ area: 'o', seen: 'o', confidence: 'high', emphasis: 'o', kind: 'overhead-limited' }] });
    const vp = rankCandidates(overhead, { pattern: 'vertical-push', role: 'accessory' }, '2026-04-06', new Set())!.ranked.map((e) => e.id);
    assert.ok(!vp.includes('overhead-press') && !vp.includes('db-shoulder-press'), vp.join(', '));
    const noBar = pick(ctxOf({ equipment: ['dumbbells', 'bench'] }), { pattern: 'vertical-pull', role: 'main' }, '2026-04-06', new Set(), new Set(), 0)!;
    assert.deepEqual([noBar.pattern, noBar.fallback], ['horizontal-pull', true]);
  });

  it('rotates by offset and skips avoided and crowded picks', () => {
    const acc = { pattern: 'horizontal-pull' as const, role: 'accessory' as const };
    const c = ctxOf();
    const r = rankCandidates(c, acc, '2026-04-06', new Set())!.ranked.map((e) => e.id);
    assert.equal(pick(c, acc, '2026-04-06', new Set(), new Set(), 1)!.id, r[1]);
    assert.equal(pick(c, acc, '2026-04-06', new Set(), new Set([r[0]!]), 0)!.id, r[1]);
  });
});

describe('steps 5 and 6: dose and progression rule', () => {
  it('sets reps by goal, role and kind', () => {
    const c = ctxOf({ experience: 'intermediate' });
    assert.deepEqual(repRange(c, E('back-squat'), 'main', null, 0), [6, 10]);
    assert.deepEqual(repRange(c, E('back-squat'), 'main', 'heavy', 0), [4, 6]);
    assert.deepEqual(repRange(c, E('db-lateral-raise'), 'accessory', null, 0), [8, 15]); // dumbbell steps are big: a wide range
    assert.deepEqual(repRange(c, E('plank'), 'accessory', null, 0), [1, 1]);
    assert.deepEqual(repRange(ctxOf(), E('back-squat'), 'main', null, 0), [8, 8]); // novice linear
    assert.deepEqual(repRange(ctxOf({ experience: 'intermediate', goals: [{ id: 's', kind: 'strength', label: 's', importance: 9, confidence: 8 }] }), E('back-squat'), 'main', null, 1), [3, 5]);
    assert.equal(baseRir(E('back-squat')), 2);
    assert.equal(baseRir(E('cable-pushdown')), 1);
  });

  it('encodes the progression rule for progression.ts', () => {
    assert.deepEqual(progressionRule(ctxOf(), E('back-squat'), 'main'), { rule: 'linear', step: 5 });
    assert.deepEqual(progressionRule(ctxOf(), E('bench-press'), 'main'), { rule: 'linear', step: 2.5 });
    assert.deepEqual(progressionRule(ctxOf({ experience: 'intermediate' }), E('back-squat'), 'main'), { rule: 'double' });
    assert.deepEqual(progressionRule(ctxOf({ experience: 'advanced' }), E('back-squat'), 'main'), { rule: 'wave' });
    assert.deepEqual(progressionRule(ctxOf({ equipment: ['rings'] }), E('push-up'), 'main'), { rule: 'ladder', next: 'ring-push-up' });
    assert.deepEqual(progressionRule(ctxOf({ equipment: [] }), E('push-up'), 'main'), { rule: 'ladder' });
  });

  it('trims accessory sets, then slots, to fit the minutes', () => {
    const slot = (id: string, role: 'main' | 'accessory', sets: number, i: number) => ({ entry: E(id), role, fixed: false, pinned: false, slotIndex: i, sets, repRange: [8, 12] as [number, number], rir: 2, note: '' });
    const t: BuiltTemplate = { blueprint: { id: 'x', name: 'x', kind: 'lift', day: null, slots: [] }, minimumDose: false, finisher: null, capacity: 15, slots: [slot('back-squat', 'main', 3, 0), slot('db-row', 'accessory', 3, 1), slot('db-curl', 'accessory', 3, 2)] };
    const r = fitTime(t);
    assert.deepEqual(r.value.slots.map((s) => [s.entry.id, s.sets]), [['back-squat', 3], ['db-row', 2]]);
    assert.match(r.reason.note ?? '', /Dropped for time: db-curl/);
  });
});

describe('step 7: conditioning', () => {
  it('spreads lifting days and puts intervals on a free day not before heavy legs', () => {
    const c = ctxOf({ availability: { daysPerWeek: 4, minutesPerSession: 45 }, goals: [{ id: 'h', kind: 'health', label: 'h', importance: 9, confidence: 7 }] });
    const days = layoutDays(c, 3, 1);
    assert.deepEqual(days, { lifting: [0, 2, 4], extra: [5] });
    const plan = conditioningPlan(c, days, 45, 0, 3, [0, 2, 4]).value;
    assert.deepEqual(plan.sessions, [{ day: 5, exercise: 'bike-intervals-4x4', minutes: 30, vigorous: true }]);
    const fixed = layoutDays(ctxOf({ availability: { daysPerWeek: 2, minutesPerSession: 45, fixedDays: ['tue', 'sat'] } }), 2, 0);
    assert.deepEqual(fixed.lifting, [1, 5]);
  });

  it('allows no intervals under Conservative, or at 65+ in the first phase', () => {
    const goal = [{ id: 'h', kind: 'health' as const, label: 'h', importance: 9, confidence: 7 }];
    const cons = ctxOf({ goals: goal, screening: { outcome: 'conservative', date: '2026-03-01' } });
    assert.equal(conditioningPlan(cons, { lifting: [0, 2, 4], extra: [5] }, 45, 0, 3, [0, 2, 4]).value.intervalsAllowed, false);
    const senior = ctxOf({ goals: goal, basics: { birthYear: 1957 } });
    assert.equal(conditioningPlan(senior, { lifting: [0, 3], extra: [5] }, 45, 0, 3, [0, 3]).value.intervalsAllowed, false);
    assert.equal(conditioningPlan(senior, { lifting: [0, 3], extra: [5] }, 45, 1, 3, [0, 3]).value.intervalsAllowed, true);
  });
});

describe('steps 8-10 and the whole', () => {
  it('lists the calendar and heuristic targets', () => {
    const c = ctxOf();
    const m = buildMacrocycle(c).value;
    const cal = calendar(c, m.weeks, m.phases).value;
    assert.equal(cal.filter((x) => x.kind === 'checkin').length, 24);
    assert.equal(cal.filter((x) => x.kind === 'tape').length, 12);
    assert.deepEqual(cal.filter((x) => x.kind === 'rir-calibration').map((x) => x.week), [3, 7, 11, 15, 19, 23]);
    assert.deepEqual(cal.filter((x) => x.kind === 'rescreen').map((x) => x.date), ['2027-03-01']);
    const t = targets(c, m.phases, [7000]).value;
    assert.deepEqual(t, [{ goal: 'g', kind: 'recomposition', measure: 'waist (tape)', unit: 'cm', predicted: [-3, -1], by: '2026-05-31', heuristic: true }]);
  });

  it('returns no program when screening is Blocked', () => {
    const r = generatePlan({ profile: profile({ screening: { outcome: 'blocked', date: '2026-03-01' } }), today: '2026-04-01' });
    assert.equal(r.value.program, null);
    assert.equal(r.value.proposal.status, 'blocked');
    assert.match(r.value.proposal.why.join(' '), /logging only/);
  });

  it('generates 12 and 16 weeks with every check passing', () => {
    for (const weeks of [12, 16] as const) {
      const r = generatePlan({ profile: profile(), today: '2026-04-01', options: { weeks } });
      assert.equal(r.value.proposal.status, 'ok', JSON.stringify(r.value.proposal.checks.filter((c) => !c.passed)));
      assert.equal(r.value.program!.macrocycle.phases.flatMap((p) => p.mesocycles.flatMap((m) => m.weeks)).length, weeks);
    }
  });
});

describe('the self-check', () => {
  const kit = { bar: true, loadedPress: true, loadedSingleLeg: true, pulldown: true };
  const levels = (sc: Parameters<typeof selfCheckPlan>[0]) => Object.fromEntries(selfCheckPlan(sc, kit).ladders.map((l) => [l.value.id, l.value.level]));

  it('starts each ladder from its test, with the thresholds in the reason', () => {
    assert.deepEqual(levels({ date: '2026-11-02', pullUps: 5, pushUps: 30, coreHold: { kind: 'plank', seconds: 60 }, balanceS: { left: 30, right: 30 }, sitToStand: { easy: true, heelsDown: true } }), { pullup: 6, pushup: 4, hollow: 3, legs: 3 });
    assert.deepEqual(levels({ date: '2026-11-02', pullUps: 0, deadHangS: 8, pushUps: 0, coreHold: { kind: 'plank', seconds: 20 }, balanceS: { left: 18, right: 25 } }), { pullup: 1, pushup: 1, hollow: 1, legs: 1 });
    assert.deepEqual(levels({ date: '2026-11-02', pullUps: 0, deadHangS: 35, pushUps: 12, coreHold: { kind: 'hollow', seconds: 45 }, balanceS: { left: 30, right: 30 } }), { pullup: 4, pushup: 3, hollow: 4, legs: 2 });
    assert.deepEqual(levels({ date: '2026-11-02', pullUps: 9, deadHangS: 25 }), { pullup: 7, pushup: null, hollow: null, legs: null });
    assert.deepEqual(levels({ date: '2026-11-02', pullUps: 2 }), { pullup: 5, pushup: null, hollow: null, legs: null });
    const r = selfCheckPlan({ date: '2026-11-02', pullUps: 5 }, kit).ladders[0]!;
    assert.match(r.reason.note ?? '', /5 strict pull-ups: the pull-up ladder starts at level 6/);
  });

  it('turns test results into regressions, exclusions and unlocks', () => {
    const p = selfCheckPlan({ date: '2026-11-02', sitToStand: { easy: false, heelsDown: true }, hingeFlatBack: false, overheadReach: { clean: false, ribFlare: true }, pushUps: 0, balanceS: { left: 30, right: 18 } }, { ...kit, loadedPress: false });
    const by = (input: string) => p.effects.filter((e) => e.value.input === input).map((e) => e.value);
    assert.deepEqual(by('sitToStand')[0]!.prefer!.ids, ['box-squat', 'goblet-squat']);
    assert.ok(by('hingeFlatBack')[0]!.exclude!.includes('rdl'));
    assert.equal(by('overheadReach')[0]!.asEmphasis, 'overhead-limited');
    assert.ok(by('pushUps').some((e) => e.prefer?.ids.includes('incline-push-up')), 'no loaded press: the push-up ladder presses');
    assert.ok(by('pushUps').some((e) => e.exclude?.includes('push-up')), 'floor push-ups wait');
    assert.ok(by('balanceS').some((e) => e.exclude?.includes('single-leg-rdl') && e.warmUp?.includes('single-leg-stance')));
    assert.ok(by('balanceS').some((e) => e.weakSide === 'right'));
    const pull = selfCheckPlan({ date: '2026-11-02', pullUps: 0, deadHangS: 25 }, kit).effects.find((e) => e.value.input === 'deadHangS')!.value;
    assert.deepEqual(pull.secondary, { pattern: 'vertical-pull', id: 'scapular-pull-up' }, 'beside the pulldown, not in its place');
    assert.deepEqual(selfCheckPlan({ date: '2026-11-02', pullUps: 5 }, kit).effects[0]!.value.unlock, ['pull-up']);
    assert.deepEqual(selfCheckPlan(undefined, kit), { date: null, ladders: [], effects: [] });
  });
});

describe('priority muscles from the goals', () => {
  const goal = (kind: 'recomposition' | 'strength' | 'gain', label = kind) => ({ id: kind, kind, label, importance: 8, confidence: 8 });
  it('derives them from a muscle goal when the profile sets none, sized to the week', () => {
    const m = (p: Partial<Profile>, posture: boolean, room?: number) => priorityFor(profile(p), profile(p).goals, posture, room).map((r) => [r.value.muscle, r.value.source]);
    assert.deepEqual(m({}, true), [['upper-back', 'posture'], ['lats', 'posture'], ['quads', 'goal']]);
    assert.deepEqual(m({}, false), [['quads', 'goal'], ['lats', 'goal'], ['chest', 'goal']]);
    assert.deepEqual(m({}, false, 2), [['quads', 'goal'], ['lats', 'goal']]);
    assert.deepEqual(m({ goals: [goal('strength'), goal('gain')] }, false), [['quads', 'goal'], ['lats', 'goal']], 'a later goal gets two');
    assert.deepEqual(m({ goals: [goal('strength')] }, false), []);
    assert.deepEqual(m({ priorityMuscles: ['glutes'] }, true), [['glutes', 'profile']], 'the profile\'s own come first and stop the derivation');
    const r = priorityFor(profile(), profile().goals, false)[0]!;
    assert.match(r.reason.note ?? '', /goal 1, "Recomposition"/);
  });
});

describe('templates compared', () => {
  it('lists the table\'s template first and the nearest options after it', () => {
    const ids = (d: number, m: number, x: Profile['experience'] = 'novice') => templateCandidates(ctxOf({ experience: x }), d, m).map((c) => c.value.id);
    assert.deepEqual(ids(4, 60), ['upper-lower-x2', 'full-body-ab-x2', 'full-body-abcd', 'torso-limbs-x2', 'upper-lower-full-x4', 'body-part-x4']);
    assert.deepEqual(ids(4, 30), ['upper-lower-minimum', 'full-body-abcd-minimum']);
    assert.deepEqual(ids(3, 45), ['full-body-aba', 'full-body-undulating', 'upper-lower-full-x3', 'push-pull-legs-x1', 'upper-lower-rotating']);
    assert.deepEqual(ids(3, 45, 'intermediate'), ['full-body-undulating', 'full-body-aba', 'upper-lower-full-x3', 'push-pull-legs-x1', 'upper-lower-rotating']);
    assert.deepEqual(ids(2, 45), ['full-body-ab', 'full-body-minimum-x2', 'upper-lower-x1']);
    assert.deepEqual(ids(5, 60, 'intermediate'), ['upper-lower-push-pull-legs', 'upper-lower-x2', 'upper-lower-full-x5', 'body-part-x5']);
    assert.deepEqual(ids(6, 60, 'intermediate'), ['upper-lower-push-pull-legs', 'upper-lower-x2', 'push-pull-legs-x2', 'body-part-x5']);
    assert.deepEqual(ids(6, 60, 'advanced'), ['push-pull-legs-x2', 'upper-lower-x2', 'upper-lower-push-pull-legs', 'body-part-x5']);
    assert.equal(templateCandidates(ctxOf({ experience: 'intermediate' }), 5, 60)[1]!.value.liftingDays, 4);
  });

  it('scores each factor with a note, and ties go to the table\'s template', () => {
    const ctx = ctxOf({ experience: 'intermediate', badWeek: { usually: ['skips-sessions'] }, preferences: { splits: { dislikes: ['upper-lower'] } } });
    const [ul, , abcd] = templateCandidates(ctx, 4, 60).map((c) => c.value);
    const facts = { mainFrequency: 1, longest: 50, likedPlaced: [], heavyLegDays: 2, checks: [{ id: 'volume', passed: true, detail: '' }] };
    const c = compareTemplates(ctx, [{ tpl: ul!, facts }, { tpl: abcd!, facts }]).value;
    assert.equal(c.rows[c.picked]!.id, 'full-body-abcd');
    const f = (i: number, id: string) => c.rows[i]!.factors.find((x) => x.factor === id)!;
    assert.equal(f(0, 'preferences').points, -3);
    assert.match(f(0, 'preferences').note, /disliked upper-lower/);
    assert.equal(f(1, 'skip-risk').points, 2);
    // rules.md: heavier and lighter days earn a point only for a trained lifter with a strength goal.
    assert.equal(f(1, 'training-age').points, 0);
    assert.match(f(1, 'training-age').note, /only with a strength goal/);
    assert.equal(f(1, 'goal').points, 0);
    assert.equal(c.pickWithout['preferences'], 'full-body-abcd');
    const tie = compareTemplates(ctxOf(), [{ tpl: ul!, facts }, { tpl: ul!, facts }]).value;
    assert.equal(tie.picked, 0);
  });
});
