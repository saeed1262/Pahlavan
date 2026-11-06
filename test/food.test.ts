// The eating plan: its schema v1 and validator, the Food tab's rules
// (protein days, the planned protein, the waist and the weight trend, the
// adjustment rule, the pattern), the report on the mockup's three states
// (test/fixtures/food: the first day, four weeks on, no plan), `engine
// food` and `engine eating` (dry run, merge, replace, the write and its
// read-back), and the pattern question in the Sunday check-in.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { readTracking } from '../src/adapters/vault/tracking-read.ts';
import { run } from '../src/cli/cli.ts';
import { adjustCheck, plannedProtein, patternWeeks, proteinWeek, proteinWeeks, waistTrend, weightDirection } from '../src/core/diet.ts';
import { titleFor } from '../src/core/reason.ts';
import type { AdjustRule, EatingPlan, TapeEntry, TrackedItem, Tracking, WeighIn } from '../src/core/schema.ts';
import { validateEatingPlan } from '../src/core/validate.ts';
import { addCheckins, buildTemplate } from '../src/report/checkin.ts';
import { answersFromRecord, recordFromAnswers, sundaySummary } from '../src/report/checkin-screen.ts';
import { changedPaths, EATING_ORDER, floorChange, mergeDeep, orderedPlan, planEating } from '../src/report/eating-write.ts';
import { planTrack, readChanges } from '../src/report/track-write.ts';
import { buildFood, checkMet, checksPrefill, foodDay, GOAL_WORDS, planWords } from '../src/report/food.ts';
import { applyFoodState, FOOD_PLAN, FOOD_PLAN_DAY, type FoodState } from './fixtures/food/food-state.ts';
import { builtEngine, fixtureFiles, memoryIo, VAULT } from './helpers.ts';

type Json = Record<string, any>;
const PLAN = FOOD_PLAN as unknown as EatingPlan;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const EATING = 'v/3-Personal/Fitness/Coach/eating-plan.json';

function state(s: FoodState, edit: (f: Record<string, string>) => void = () => {}) {
  const files = fixtureFiles('v');
  const { today } = applyFoodState(files, s, 'v');
  edit(files);
  const io = memoryIo(files, today);
  const read = readVault(io, 'v', { asOf: today });
  return { files, today, io, read, tr: readTracking(io, 'v'), food: buildFood(read, readTracking(io, 'v'), today) as Json };
}

describe('eating plan: schema v1', () => {
  it('the mockup\'s plan is valid', () => {
    assert.deepEqual(validateEatingPlan(PLAN), []);
  });

  it('checks the shapes: required keys, unknown keys, enums, pairs', () => {
    const p = clone(PLAN) as Json;
    delete p.review;
    p.level = 'detailed';
    p.extra = 1;
    p.protein.rangeG = [184, 134];
    p._comment = 'kept';
    const errs = validateEatingPlan(p).map((e) => `${e.path}: ${e.message}`);
    assert.ok(errs.includes('review: is required'), errs.join('; '));
    assert.ok(errs.some((e) => e.startsWith('level: expected one of: light, standard, full')));
    assert.ok(errs.includes('extra: unknown key'));
    assert.ok(errs.includes('protein.rangeG: the low end is above the high end'));
    assert.ok(!errs.some((e) => e.startsWith('_comment')));
  });

  it('checks across fields: dates, the floor in its range, ids and references', () => {
    const p = clone(PLAN) as Json;
    p.review = '2026-11-01';
    p.protein.floorG = 120;
    p.meals[1].portions = 'brunch';
    p.portions.dinner.dessert = [1, 1];
    p.fallbacks.meal = 'supper';
    p.pattern[0] = { id: 'fish', name: 'Fish', target: 'often', per: 'week' };
    p.pattern.push({ id: 'fish', name: 'Fish again', target: 'twice', min: 2, per: 'week' });
    const errs = validateEatingPlan(p).map((e) => `${e.path}: ${e.message}`);
    assert.deepEqual(errs.sort(), [
      'fallbacks.meal: no meal with the id supper',
      'meals[1].portions: no portions named brunch',
      'pattern: duplicate pattern id: fish',
      'pattern[0]: needs min or max',
      'portions.dinner.dessert: no food group with the id dessert',
      'protein.floorG: is outside the range 134 to 184 g',
      "review: is before the plan's date (updated)",
    ]);
  });

  it('a check-in record takes the pattern answers by line id', async () => {
    const { validateCheckinLog } = await import('../src/core/validate.ts');
    assert.deepEqual(validateCheckinLog({ schemaVersion: 1, checkins: [{ date: '2026-11-08', weekStart: '2026-11-02', pattern: { fish: true, legumes: false } }] }), []);
    const bad = validateCheckinLog({ schemaVersion: 1, checkins: [{ date: '2026-11-08', weekStart: '2026-11-02', pattern: { Fish: 'yes' } }] }).map((e) => e.message);
    assert.ok(bad.some((m) => /does not match/.test(m)) && bad.some((m) => /true or false/.test(m)), bad.join('; '));
  });
});

describe('diet rules', () => {
  it('the planned protein against the floor, and the day without the hardest meal', () => {
    const r = plannedProtein(PLAN);
    assert.equal(r.reason.rule, 'diet.meals');
    assert.deepEqual([r.value.lo, r.value.hi, r.value.over], [145, 155, 11]);
    assert.deepEqual(r.value.meals.map((m) => m.from), [0, 40, 85, 130]);
    assert.deepEqual(r.value.without, { id: 'lunch', name: 'Lunch', g: 100, under: true });
    assert.match(r.reason.note!, /11 g over the floor of 134 g\. A missed lunch puts the day under it/);
  });

  const item = { id: 'protein', kind: 'tick', name: 'Protein', habit: 'protein', schedule: { kind: 'daily' }, start: '2026-11-02', source: { by: 'coach', why: 'x' } } as TrackedItem;
  it('protein days from the item and its linked habit; before the cycle, open today, to come', () => {
    const habits = { habits: [{ id: 'protein' }], checkins: { 'hab-protein-2026-W45-1': '1' } };
    const r = proteinWeek({ item, tracking: { days: { '2026-11-02': { protein: { done: true } } } }, habits, date: '2026-11-04', since: '2026-11-02', floorG: 134 });
    assert.deepEqual(r.value.days.map((d) => d.state), ['ticked', 'ticked', 'open', 'future', 'future', 'future', 'future']);
    assert.deepEqual(r.value.days.slice(0, 2).map((d) => d.via), ['pahlavan', 'habit']);
    assert.deepEqual([r.value.ticked, r.value.soFar], [2, 3]);
    const mid = proteinWeek({ item, tracking: null, habits: null, date: '2026-11-04', since: '2026-11-03', floorG: 134 });
    assert.deepEqual(mid.value.days.slice(0, 3).map((d) => d.state), ['before', 'unticked', 'open']);
    assert.match(proteinWeek({ item: null, tracking: null, habits: null, date: '2026-11-04', since: null, floorG: 134 }).reason.note!, /No protein item is tracked/);
  });

  it('the cycle\'s weeks before this one, with the check-in\'s count beside the ticks', () => {
    const r = proteinWeeks({ item, tracking: { days: { '2026-11-03': { protein: { done: true } }, '2026-11-10': { protein: { done: true } } } }, habits: null, date: '2026-11-18', since: '2026-11-02', checkins: [{ date: '2026-11-08', weekStart: '2026-11-02', proteinDays: 3 }] });
    assert.deepEqual(r.value.map((w) => [w.n, w.ticked, w.checkin]), [[1, 1, 3], [2, 1, null]]);
  });

  const tape = (xs: [string, number][]): TapeEntry[] => xs.map(([date, waist]) => ({ date, unit: 'cm', waist }));
  it('the waist against the plan\'s direction: one tape, down, flat within ±0.5 cm, up', () => {
    const w = (xs: [string, number][]) => waistTrend(tape(xs), { since: '2026-11-02', through: '2026-11-30', flatCm: 0.5, goal: 'recomposition' }).value;
    assert.deepEqual([w([['2026-11-02', 92]]).direction, w([['2026-11-02', 92]]).status], ['one', 'early']);
    assert.deepEqual([w([['2026-11-02', 92], ['2026-11-29', 91]]).direction, w([['2026-11-02', 92], ['2026-11-29', 91]]).status], ['down', 'in']);
    assert.equal(w([['2026-11-02', 92], ['2026-11-29', 91.5]]).direction, 'flat');
    assert.equal(w([['2026-11-02', 92], ['2026-11-29', 92.6]]).status, 'out');
    assert.equal(w([['2026-10-20', 95], ['2026-11-02', 92]]).first!.date, '2026-11-02', 'counts from the cycle start');
  });

  it('the weight rate against the goal\'s band: early, in, below', () => {
    assert.equal(weightDirection(null, 'recomposition').value.status, 'early');
    const rate = (pct: number) => ({ kgPerWeek: pct * 83, pctPerWeek: pct, spanDays: 27, weighIns: 20, trend: 83 });
    assert.equal(weightDirection(rate(-0.002), 'recomposition').value.status, 'in');
    assert.equal(weightDirection(rate(-0.008), 'recomposition').value.status, 'below');
  });

  it('the pattern from the Sunday check-ins, the last weeks of the cycle', () => {
    const lines = PLAN.pattern!;
    const r = patternWeeks(lines, [{ date: '2026-11-08', weekStart: '2026-11-02', pattern: { fish: true, lamb: false } }], { since: '2026-11-02', date: '2026-11-15' });
    assert.deepEqual(r.value.sundays, ['2026-11-08', '2026-11-15']);
    assert.deepEqual(r.value.lines.find((l) => l.id === 'fish')!.answers, [true, null]);
    assert.deepEqual(r.value.lines.find((l) => l.id === 'lamb')!.answers, [false, null]);
    assert.deepEqual(r.value.lines.find((l) => l.id === 'legumes')!.answers, [null, null]);
    assert.equal(patternWeeks(lines, [], { since: '2026-01-05', date: '2026-11-15' }).value.sundays.length, 6, 'at most six weeks');
  });

  it('every diet rule has a title of its own', () => {
    for (const rule of ['diet.protein', 'diet.meals', 'diet.protein-days', 'diet.waist', 'diet.weight', 'diet.adjust', 'diet.pattern']) assert.notEqual(titleFor(rule), 'Rule', rule);
  });
});

describe('the adjustment rule', () => {
  const RULE = PLAN.adjust! as AdjustRule;
  const tapeDays = ['2026-11-15', '2026-11-29', '2026-12-13', '2026-12-27', '2027-01-10'];
  const tape = (xs: [string, number][]): TapeEntry[] => xs.map(([date, waist]) => ({ date, unit: 'cm', waist }));
  /** Daily weigh-ins from 2 Nov changing by `perWeek` kg a week. */
  const weights = (days: number, perWeek: number, from = '2026-11-02'): WeighIn[] => Array.from({ length: days }, (_, i) => ({ date: new Date(Date.parse(`${from}T00:00:00Z`) + i * 864e5).toISOString().slice(0, 10), weight: Math.round((83.5 + (perWeek * i) / 7) * 100) / 100, unit: 'kg' as const }));
  const check = (o: Partial<Parameters<typeof adjustCheck>[0]>) => adjustCheck({ rule: RULE, review: '2026-11-29', date: '2026-11-29', since: '2026-11-02', tape: [], weighIns: [], tapeDays, creatineFrom: null, ...o });

  it('before the review: no change yet, the first check after the 15 and 29 Nov tapes', () => {
    const r = check({ date: '2026-11-02', tape: tape([['2026-11-02', 92]]) });
    assert.equal(r.reason.rule, 'diet.adjust');
    assert.deepEqual([r.value.status, r.value.why, r.value.next, r.value.step], ['waiting', 'before-first-check', '2026-11-29', null]);
    assert.deepEqual(r.value.before, ['2026-11-15', '2026-11-29']);
    assert.match(r.reason.note!, /^No change yet: the first check is Sun 29 Nov, after the 15 Nov and 29 Nov tapes\./);
  });

  it('on the review day before its tape: due', () => {
    const r = check({ tape: tape([['2026-11-02', 92], ['2026-11-15', 91.8]]) });
    assert.deepEqual([r.value.status, r.value.why, r.value.next], ['due', 'tape-due', '2026-11-29']);
  });

  it('the waist down: no change, the next check the next tape day', () => {
    const r = check({ tape: tape([['2026-11-02', 92], ['2026-11-15', 91.5], ['2026-11-29', 91]]), weighIns: weights(28, -0.04) });
    assert.deepEqual([r.value.status, r.value.why, r.value.step, r.value.next, r.value.checkedOn], ['checked', 'waist-down', null, '2026-12-13', '2026-11-29']);
    assert.equal(r.value.span!.changeCm, -1);
    assert.match(r.reason.note!, /The waist is down 1\.0 cm in 4 weeks, so the portions stay\. Next check Sun 13 Dec, after its tape\./);
  });

  it('the waist flat and the trend not falling: one cupped hand of carbs less, then the wait', () => {
    const r = check({ tape: tape([['2026-11-02', 92], ['2026-11-15', 92.2], ['2026-11-29', 91.6]]), weighIns: weights(28, 0.05) });
    assert.deepEqual([r.value.why, r.value.step?.id, r.value.next], ['flat-not-falling', 'less', '2026-12-13']);
    assert.deepEqual(r.value.conditions, { flat: true, notFalling: true, tooFast: false });
    assert.match(r.reason.note!, /one cupped hand of carbs less a day, then wait 2 to 3 weeks/);
  });

  it('creatine\'s water in its first weeks: no step for it', () => {
    const r = check({ tape: tape([['2026-11-02', 92], ['2026-11-15', 92.2], ['2026-11-29', 91.6]]), weighIns: weights(28, 0.3), creatineFrom: '2026-11-10' });
    assert.deepEqual([r.value.why, r.value.step, r.value.creatine?.active], ['creatine', null, true]);
    assert.match(r.reason.note!, /creatine started on Tue 10 Nov/);
  });

  it('losing faster than 1 % a week: one cupped hand back', () => {
    const r = check({ tape: tape([['2026-11-02', 92], ['2026-11-15', 91], ['2026-11-29', 89.5]]), weighIns: weights(28, -2) });
    assert.deepEqual([r.value.why, r.value.step?.id, r.value.conditions.tooFast], ['too-fast', 'back', true]);
    assert.ok(r.value.rate!.pctPerWeek < -0.01);
  });

  it('flat with no rate yet, flat and falling, and too few weeks of tape: no step', () => {
    assert.equal(check({ tape: tape([['2026-11-02', 92], ['2026-11-29', 91.8]]), weighIns: weights(3, 0) }).value.why, 'no-rate');
    assert.equal(check({ tape: tape([['2026-11-02', 92], ['2026-11-29', 91.8]]), weighIns: weights(28, -0.2) }).value.why, 'falling');
    assert.equal(check({ since: '2026-11-15', tape: tape([['2026-11-15', 92], ['2026-11-29', 92]]), weighIns: weights(28, 0.1) }).value.why, 'short-span');
  });

  it('after a step: waits at least 2 weeks, and reads its weeks of tape from the step on', () => {
    const rule = { ...RULE, applied: [{ date: '2026-11-29', step: 'less' as const }] };
    const r = adjustCheck({ rule, review: '2026-11-29', date: '2026-12-06', since: '2026-11-02', tape: tape([['2026-11-02', 92], ['2026-11-29', 91.8]]), weighIns: weights(35, 0), tapeDays, creatineFrom: null });
    assert.deepEqual([r.value.status, r.value.why, r.value.next], ['waiting', 'waiting-after-step', '2026-12-13']);
    const later = adjustCheck({ rule, review: '2026-11-29', date: '2026-12-13', since: '2026-11-02', tape: tape([['2026-11-02', 92], ['2026-11-29', 91.8], ['2026-12-13', 91.8]]), weighIns: weights(42, 0), tapeDays, creatineFrom: null });
    assert.deepEqual([later.value.checkedOn, later.value.why, later.value.span!.first!.date], ['2026-12-13', 'short-span', '2026-11-29']);
  });
});

describe('the Food report on the mockup\'s states', () => {
  it('the first day: the floor, today open, about 145 g planned, the first check 29 Nov', () => {
    const { food } = state('early');
    assert.equal(food.command, 'food');
    assert.deepEqual(food.errors, []);
    assert.deepEqual([food.week.planWeek, food.week.phase.name, food.level.label], [1, 'Foundation', 'Hand portions']);
    assert.equal(food.protein.floor.value.floorG, 134);
    assert.deepEqual(food.protein.today, { date: '2026-11-02', state: 'open', via: null });
    assert.equal(food.protein.planned.value.lo, 145);
    assert.deepEqual(food.protein.week.value.days.map((d: Json) => d.state), ['open', 'future', 'future', 'future', 'future', 'future', 'future']);
    assert.deepEqual(food.protein.weeks.value, []);
    assert.equal(food.trend.weight.trend.value.latest.trend, 83.5);
    assert.equal(food.trend.weight.rate.value, null);
    assert.equal(food.trend.waist.value.status, 'early');
    assert.deepEqual(food.trend.tapeDays, ['2026-11-15', '2026-11-29']);
    assert.deepEqual([food.adjust.value.status, food.adjust.value.next], ['waiting', '2026-11-29']);
    assert.deepEqual(food.pattern.value.sundays, ['2026-11-08']);
    assert.equal(food.creatine.start, '2026-11-02');
  });

  it('four weeks on: 4 of 7, the weeks before, the waist down, checked today with no change', () => {
    const { food } = state('later');
    assert.deepEqual(food.protein.week.value.days.map((d: Json) => d.state), ['ticked', 'ticked', 'unticked', 'ticked', 'ticked', 'unticked', 'open']);
    assert.deepEqual(food.protein.weeks.value.map((w: Json) => [w.n, w.ticked, w.checkin]), [[1, 5, 5], [2, 4, 4], [3, 6, 6]]);
    assert.equal(food.trend.weight.trend.value.latest.trend.toFixed(1), '83.4');
    assert.equal(food.trend.weight.rate.value.kgPerWeek.toFixed(2), '-0.04');
    assert.equal(food.trend.weight.direction.value.status, 'in');
    assert.deepEqual([food.trend.waist.value.changeCm, food.trend.waist.value.status], [-1, 'in']);
    assert.deepEqual([food.adjust.value.status, food.adjust.value.why, food.adjust.value.next], ['checked', 'waist-down', '2026-12-13']);
    assert.deepEqual(food.pattern.value.lines.find((l: Json) => l.id === 'fruit').answers, [false, false, true, null]);
  });

  it('every number has its Why: a title, a note, a rule id kept out of the text', () => {
    const { food } = state('later');
    const keys = Object.keys(food.why);
    for (const k of ['floor', 'top', 'permeal', 'planned', 'weekdays', 'review', 'trend', 'waist', 'rate', 'waist-ch', 'fiber', 'fb-min', 'rule', 'check', 'flat', 'onepct', 'wait', 'creatine', 'meal-lunch', 'plate-lunch-carbs', 'day-2026-11-29', 'week-1', 'tape-2026-11-15', 'pt-fish', 'pt-fish-2026-11-08']) assert.ok(keys.includes(k), k);
    for (const [k, w] of Object.entries(food.why) as [string, Json][]) {
      assert.ok(w.title && w.note && w.rule, k);
      const text = JSON.stringify([w.title, w.rows, w.threshold, w.note]);
      assert.doesNotMatch(text, /\b(diet|weight|tracking)\.[a-z]/, `${k} names a rule id in its text`);
      assert.doesNotMatch(text, /—/, `${k} has an em-dash`);
    }
    assert.match(food.why.planned.note, /About 145 g with the smallest figures, 155 with the biggest: 11 g over the floor of 134 g/);
    assert.equal(food.why.rate.rows[0][1], '−0.04 kg a week');
  });

  it('no plan: the empty state, with the waist and the weight trend for the banner', () => {
    const { food } = state('empty');
    assert.equal(food.plan, null);
    assert.equal(food.file.state, 'missing');
    assert.ok(food.notes.some((n: Json) => n.code === 'no-plan'));
    assert.equal(food.trend.waist.value.last.waist, 92);
    assert.equal(food.trend.weight.trend.value.latest.trend, 83.5);
  });

  it('an invalid plan is an error, never a crash', () => {
    const { food, read } = state('early', (f) => void (f[EATING] = JSON.stringify({ ...PLAN, level: 'heavy' })));
    assert.equal(read.data.coach.eating, 'invalid');
    assert.equal(food.plan, null);
    assert.ok(food.errors.some((e: Json) => e.code === 'eating' && /level/.test(e.message)));
    assert.ok(food.notes.some((n: Json) => n.code === 'invalid-plan'));
  });
});

describe('the eating write path', () => {
  it('merges objects key by key, replaces lists and values, null removes', () => {
    assert.deepEqual(mergeDeep({ a: { b: 1, c: 2 }, l: [1, 2], x: 1 }, { a: { c: 3 }, l: [3], x: null }), { a: { b: 1, c: 3 }, l: [3] });
    assert.deepEqual(changedPaths({ a: { b: 1 }, l: [1] }, { a: { b: 2 }, l: [1] }), ['a.b']);
  });

  it('a first plan is added, a change merged, the same plan unchanged; warnings for the coach', () => {
    const tracking = { schemaVersion: 1, items: [{ id: 'protein', kind: 'tick', name: 'Protein', goal: { amount: 130, unit: 'g' }, schedule: { kind: 'daily' }, start: '2026-11-02', source: { by: 'coach', why: 'x' } }], days: {} } as never;
    const add = planEating({ existingText: null, given: PLAN, replace: false, today: '2026-11-02', tracking });
    assert.equal(add.action, 'added');
    assert.ok(add.warnings.some((w) => w.code === 'protein-item' && /130 g; it should match the eating plan's floor of 134 g/.test(w.message)));
    const text = add.text!;
    const same = planEating({ existingText: text, given: PLAN, replace: false, today: '2026-11-02' });
    assert.deepEqual([same.action, same.text], ['unchanged', null]);
    const step = planEating({ existingText: text, given: { adjust: { applied: [{ date: '2026-11-29', step: 'less' }] }, portions: { lunch: { carbs: [1, 1] } } }, replace: false, today: '2026-11-29' });
    assert.equal(step.action, 'merged');
    assert.deepEqual(step.changed.sort(), ['adjust.applied', 'portions.lunch.carbs']);
    assert.deepEqual(step.doc!.portions!.lunch, { protein: [2, 2], veg: [2, 2], carbs: [1, 1], fat: [2, 2] });
    assert.ok(step.warnings.some((w) => w.code === 'updated-unchanged'));
    assert.ok(step.warnings.some((w) => w.code === 'review-past') === false);
  });

  it('refuses an invalid result, a date after today, and a file of another schema', () => {
    assert.ok(planEating({ existingText: null, given: { level: 'light' }, replace: false, today: '2026-11-02' }).errors.some((e) => /is required/.test(e.message)));
    assert.ok(planEating({ existingText: null, given: { ...PLAN, updated: '2026-11-03', review: '2026-11-29' }, replace: false, today: '2026-11-02' }).errors.some((e) => /after today/.test(e.message)));
    assert.ok(planEating({ existingText: JSON.stringify({ ...PLAN, schemaVersion: 2 }), given: { note: 'x' }, replace: false, today: '2026-11-02' }).errors.some((e) => /refusing to write/.test(e.message)));
    const broken = planEating({ existingText: '{ not json', given: { note: 'x' }, replace: false, today: '2026-11-02' });
    assert.ok(broken.errors.some((e) => /--replace/.test(e.message)));
    assert.equal(planEating({ existingText: '{ not json', given: PLAN, replace: true, today: '2026-11-02' }).action, 'added');
  });

  it('the protein item against the plan\'s floor: the `track add` that sets it to the plan\'s number, never the trend floor', () => {
    // The item at the engine's floor at the trend weight (133 g), the plan's floor 134 g.
    const item = (over: Partial<TrackedItem> = {}): TrackedItem => ({ id: 'protein', kind: 'tick', name: 'Protein', goal: { amount: 133, unit: 'g' }, means: 'At least 133 g of protein', schedule: { kind: 'daily' }, start: '2026-11-02', source: { by: 'coach', why: 'x' }, ...over }) as TrackedItem;
    const tracking = (it: TrackedItem): Tracking => ({ schemaVersion: 1, items: [it], days: {} }) as unknown as Tracking;
    const check = (it: TrackedItem) => planEating({ existingText: null, given: PLAN, replace: false, today: '2026-11-02', tracking: tracking(it) }).warnings.filter((w) => w.code === 'protein-item');
    const [w] = check(item());
    assert.equal(w!.message, 'The Protein item asks for 133 g; it should match the eating plan\'s floor of 134 g. Set it with `track add --file <file> --write`, the file holding {"id":"protein","goal":{"amount":134,"unit":"g"},"means":"At least 134 g of protein"}.');
    assert.doesNotMatch(w!.message, /track protein/);
    // The write it names lands the plan's number, and the check is then quiet.
    const change = JSON.parse(/holding (\{.*\})\.$/.exec(w!.message)![1]!);
    const ctx = { tracking: tracking(item()), today: '2026-11-04', protein: { tier: 'lifting' as const, deficit: false, gPerKg: [1.6, 2.2] as [number, number], floorGPerKg: 1.6, grams: [133, 183] as [number, number], targetG: 133 }, habits: null };
    const plan = planTrack(readChanges(change, 'add').changes!, ctx);
    assert.deepEqual(plan.results.map((r) => [r.id, r.result]), [['protein', 'updated']]);
    const put = plan.ops.find((o) => o.op === 'put-item') as { item: TrackedItem };
    assert.deepEqual([put.item.goal, put.item.means], [{ amount: 134, unit: 'g' }, 'At least 134 g of protein']);
    assert.deepEqual(check(put.item), []);
    // Its own wording stays; no goal is a difference too; the user's own item is theirs to change.
    assert.deepEqual(floorChange(item({ means: 'Two palms at lunch and dinner' }), 134), { id: 'protein', goal: { amount: 134, unit: 'g' } });
    assert.match(check(item({ goal: undefined, means: 'Your protein target reached' }))[0]!.message, /^The Protein item has no gram goal; it should match the eating plan's floor of 134 g\..*"means":"At least 134 g of protein"\}\.$/);
    assert.match(check(item({ source: { by: 'user' } }))[0]!.message, /\. Protein was added by the user: change it only when they ask to\.$/);
  });
});

describe('cli: food and eating', () => {
  const io = (s: FoodState, edit: (f: Record<string, string>) => void = () => {}) => {
    const files = fixtureFiles('v');
    const { today } = applyFoodState(files, s, 'v');
    edit(files);
    return { files, io: { ...memoryIo(files, today), writeEating: (root: string, text: string) => void (files[`${root}/3-Personal/Fitness/Coach/eating-plan.json`] = text) } };
  };
  const j = (argv: string[], i: ReturnType<typeof io>['io']) => {
    const r = run(argv, i);
    return { code: r.code, out: JSON.parse(r.stdout) as Json };
  };

  it('food prints the report, read only', () => {
    const { files, io: i } = io('later');
    const before = JSON.stringify(files);
    const { code, out } = j(['food', '--vault', 'v', '--date', '2026-11-29', '--json'], i);
    assert.equal(code, 0);
    assert.deepEqual([out.command, out.adjust.value.why, out.protein.week.value.ticked], ['food', 'waist-down', 4]);
    assert.ok(out.sources.files.eating === 'found');
    assert.equal(JSON.stringify(files), before);
    assert.equal(run(['food', '--vault', 'v', '--write'], i).code, 2);
  });

  it('eating: a dry run, then --write; a merge; validate infers the kind', () => {
    const { files, io: i } = io('empty');
    files['plan.json'] = JSON.stringify(PLAN);
    const dry = j(['eating', '--vault', 'v', '--file', 'plan.json'], i);
    assert.deepEqual([dry.code, dry.out.result, dry.out.dryRun, dry.out.written], [0, 'added', true, false]);
    assert.equal(files[EATING], undefined, 'a dry run writes nothing');
    const wr = j(['eating', '--vault', 'v', '--file', 'plan.json', '--write'], i);
    assert.deepEqual([wr.code, wr.out.result, wr.out.written], [0, 'added', true]);
    assert.deepEqual(JSON.parse(files[EATING]!).meals.length, 4);
    assert.ok(files[EATING]!.endsWith('}\n'));
    files['change.json'] = JSON.stringify({ updated: '2026-11-02', review: '2026-12-13', note: 'Review moved' });
    const m = j(['eating', '--vault', 'v', '--file', 'change.json', '--write'], i);
    assert.deepEqual([m.code, m.out.result, m.out.changed.sort()], [0, 'merged', ['note', 'review']]);
    assert.equal(JSON.parse(files[EATING]!).review, '2026-12-13');
    const again = j(['eating', '--vault', 'v', '--file', 'change.json', '--write'], i);
    assert.deepEqual([again.out.result, again.out.written], ['unchanged', false]);
    files['bad.json'] = JSON.stringify({ protein: { floorG: 400 } });
    const bad = j(['eating', '--vault', 'v', '--file', 'bad.json', '--write'], i);
    assert.equal(bad.code, 1);
    assert.equal(JSON.parse(files[EATING]!).protein.floorG, 134, 'an invalid merge writes nothing');
    const v = j(['validate', 'v/3-Personal/Fitness/Coach/eating-plan.json'], i);
    assert.deepEqual([v.code, v.out.kind, v.out.shape, v.out.valid], [0, 'eating', 'eatingPlan', true]);
    assert.equal(run(['eating', '--vault', 'v'], i).code, 2, '--file is required');
  });
});

describe('the pattern in the Sunday check-in', () => {
  it('the template asks one question with the plan\'s lines; the answers become the record', () => {
    const { read } = state('early');
    const t = buildTemplate(read.data, '2026-11-08', null);
    const q = t.ask.find((a) => a.topic === 'pattern') as Json;
    assert.ok(q, 'asked');
    assert.deepEqual(q.lines.map((l: Json) => l.id), ['fish', 'legumes', 'lamb', 'veg', 'fruit']);
    assert.equal(q.checkinMd, undefined);
    assert.match(t.ask.find((x) => x.topic === 'protein')!.question, /about 134 g of protein\?$/, 'the protein question asks at the eating plan\'s floor');
    assert.ok(t.ask.findIndex((a) => a.topic === 'pattern') === t.ask.findIndex((a) => a.topic === 'protein') + 1, 'after the protein question');
    const a = answersFromRecord(t);
    assert.deepEqual({ ...a.pattern }, { fish: null, legumes: null, lamb: null, veg: null, fruit: null });
    a.pattern.fish = true;
    a.pattern.fruit = false;
    const rec = recordFromAnswers(t, a);
    assert.deepEqual(rec['pattern'], { fish: true, fruit: false });
    const sum = sundaySummary(t, a);
    assert.ok(sum.items.includes('The pattern: fish met, fruit not met'));
    assert.ok(sum.open.includes('The pattern: legumes, lamb, vegetables'));
    const added = addCheckins({ existingText: null, answers: rec, today: '2026-11-08', data: read.data });
    assert.deepEqual(added.errors, []);
    assert.deepEqual(added.doc!.checkins[0]!.pattern, { fish: true, fruit: false });
  });

  it('no eating plan: no pattern question; an answer for an unknown line is warned about', () => {
    const { read } = state('empty');
    assert.equal(buildTemplate(read.data, '2026-11-08', null).ask.find((a) => a.topic === 'pattern'), undefined);
    const r = addCheckins({ existingText: null, answers: { date: '2026-11-08', weekStart: '2026-11-02', pattern: { fish: true } }, today: '2026-11-08', data: read.data });
    assert.ok(r.warnings.some((w) => w.code === 'unknown-pattern'));
  });
});

describe('cli: eating and food with the built engine, on a temp copy of the vault', () => {
  const snapshot = (dir: string) => {
    const m = new Map<string, string>();
    for (const f of readdirSync(dir, { recursive: true }) as string[]) if (statSync(join(dir, f)).isFile()) m.set(f, readFileSync(join(dir, f), 'utf8'));
    return m;
  };
  it('the dry run and food leave every file as it was; --write changes Coach/eating-plan.json and nothing else', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pahlavan-eating-'));
    try {
      const vault = join(tmp, 'vault');
      cpSync(VAULT, vault, { recursive: true });
      const plan = join(tmp, 'plan.json');
      writeFileSync(plan, JSON.stringify(PLAN));
      const before = snapshot(vault);
      const sh = (...args: string[]) => spawnSync(process.execPath, [builtEngine(), ...args], { encoding: 'utf8' });
      const dry = sh('eating', '--vault', vault, '--file', plan);
      assert.equal(dry.status, 0, dry.stdout + dry.stderr);
      assert.equal(JSON.parse(dry.stdout).result, 'added');
      assert.deepEqual(snapshot(vault), before);
      const wet = sh('eating', '--vault', vault, '--file', plan, '--write');
      assert.equal(wet.status, 0, wet.stdout + wet.stderr);
      assert.equal(JSON.parse(wet.stdout).written, true);
      const after = snapshot(vault);
      assert.deepEqual([...after.keys()].filter((k) => after.get(k) !== before.get(k)), ['3-Personal/Fitness/Coach/eating-plan.json']);
      const food = sh('food', '--vault', vault, '--date', '2026-04-10', '--json');
      assert.equal(food.status, 0, food.stdout + food.stderr);
      assert.equal(JSON.parse(food.stdout).plan.protein.floorG, 134);
      assert.deepEqual(snapshot(vault), after, 'food only reads');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('the eating plan’s words, day, ideas, light checks and tips (optional, schema 1)', () => {
  const DAY = FOOD_PLAN_DAY as unknown as EatingPlan;
  const dayState = (s: FoodState) => {
    const files = fixtureFiles('v');
    const { today } = applyFoodState(files, s, 'v', 'day');
    const io = memoryIo(files, today);
    return buildFood(readVault(io, 'v', { asOf: today }), readTracking(io, 'v'), today) as Json;
  };

  it('the day plan is valid; every new field optional, so the schema 1 plan stays valid', () => {
    assert.deepEqual(validateEatingPlan(DAY), []);
    assert.deepEqual(validateEatingPlan(PLAN), []);
    for (const k of ['goalLabel', 'summary', 'why', 'day', 'today', 'tips']) assert.ok(k in DAY && !(k in PLAN), k);
  });

  it('checks the new shapes: unknown keys, times, a work span the wrong way round, an empty check', () => {
    const p = clone(DAY) as Json;
    p.why[0].source.kind = 'guess';
    p.why[1].extra = 1;
    p.day.wake = '7am';
    p.day.work = ['17:00', '09:00'];
    p.day.training.lift.minutes = 0;
    p.meals[0].at = '25:00';
    p.meals[1].ideas[0].counts = ['Fish'];
    p.today.optional[0].slots = [];
    p.tips[0].icon = 'Heart';
    const errs = validateEatingPlan(p).map((e) => `${e.path}: ${e.message}`);
    for (const want of ['why[0].source.kind: expected one of: intake, said', 'why[1].extra: unknown key', 'day.work: the start is after the end', 'day.training.lift.minutes: must be above 0', 'today.optional[0].slots: needs at least 1 item(s)']) assert.ok(errs.includes(want), `${want} in ${errs.join('; ')}`);
    assert.ok(errs.some((e) => e.startsWith('day.wake: does not match')));
    assert.ok(errs.some((e) => e.startsWith('meals[0].at: does not match')));
    assert.ok(errs.some((e) => e.startsWith('meals[1].ideas[0].counts[0]: does not match')));
    assert.ok(errs.some((e) => e.startsWith('tips[0].icon: does not match')));
  });

  it('checks the new references: foods by the plan’s groups, ideas and checks by its pattern lines, unique ids', () => {
    const p = clone(DAY) as Json;
    p.meals[1].foods.dessert = 'cake';
    p.meals[0].ideas[0].counts = ['nuts'];
    p.today.optional.push({ id: 'greens', label: 'Greens', slots: ['Once'] });
    p.today.optional.push({ id: 'veg', label: 'Again', slots: ['Once'] });
    p.why.push({ ...p.why[0] });
    p.tips.push({ ...p.tips[0] });
    const errs = validateEatingPlan(p).map((e) => `${e.path}: ${e.message}`);
    assert.deepEqual(errs.sort(), [
      'meals[0].ideas[0].counts: no pattern line with the id nuts',
      'meals[1].foods.dessert: no food group with the id dessert',
      'tips: duplicate tip id: double',
      'today.optional: duplicate check id: veg',
      'today.optional[2].id: no pattern line with the id greens (a check pre-fills its line)',
      'why: duplicate reason id: maintenance',
    ]);
  });

  it('the plan’s words: the coach’s goal label, summary and reasons; else stand-ins from the goal and the level', () => {
    assert.deepEqual(planWords(DAY).goal, 'Build muscle, lose a little fat');
    assert.equal(planWords(DAY).reasons.length, 3);
    assert.equal(planWords(DAY).reasonLine, null);
    const w = planWords(PLAN);
    assert.deepEqual([w.goal, w.summary, w.reasons], [GOAL_WORDS.recomposition, 'Keep protein high and let your hands set the portions. Nothing to weigh, nothing to count.', []]);
    assert.match(w.reasonLine!, /^Made for your goal: build muscle, lose a little fat\. Hand portions, the level you chose with the coach\./);
    assert.equal(planWords({ ...PLAN, goal: 'fat-loss', level: 'standard' }).summary, 'Count protein and calories; the rest by hand.');
  });

  it('the day: up, the meals by the clock with the rotation’s session among them, bed; a meal before a session at the same minute', () => {
    const d = foodDay(DAY, '2026-11-02', { type: 'A', name: 'Full Body A', kind: 'lift' });
    assert.equal(d.timed, true);
    assert.deepEqual(d.rows.map((r) => `${r.kind === 'meal' ? r.id : r.kind}@${r.at}`), ['wake@07:00', 'breakfast@07:30', 'lunch@12:30', 'snack@16:00', 'training@17:30', 'dinner@19:30', 'evening@21:30', 'bed@23:30']);
    const snack = d.rows.find((r) => r.kind === 'meal' && r.id === 'snack') as Json;
    assert.equal(snack.note, 'A lifting day: have it 1 to 2 hours before you train.');
    assert.deepEqual(d.rows.find((r) => r.kind === 'training'), { kind: 'training', at: '17:30', session: 'lift', minutes: 60, name: 'Full Body A' });
    const same = clone(DAY) as Json;
    same.meals[3].at = '17:30';
    assert.deepEqual(foodDay(same as unknown as EatingPlan, '2026-11-02', { type: 'A', name: 'A', kind: 'lift' }).rows.filter((r) => r.at === '17:30').map((r) => r.kind), ['meal', 'training']);
    const short = foodDay(DAY, '2026-11-04', { type: 'S3', name: 'Short 3 · Conditioning', kind: 'short' });
    assert.equal((short.rows.find((r) => r.kind === 'meal' && r.id === 'snack') as Json).note, null, 'no pre-lift note on a short day');
    assert.equal((short.rows.find((r) => r.kind === 'training') as Json).session, 'short');
    const none = foodDay(DAY, '2026-11-02', null);
    assert.deepEqual([none.kind, none.rows.some((r) => r.kind === 'training')], [null, false]);
    const noShort = clone(DAY) as Json;
    delete noShort.day.training.short;
    assert.equal(foodDay(noShort as unknown as EatingPlan, '2026-11-04', { type: 'S3', name: 'S3', kind: 'short' }).rows.some((r) => r.kind === 'training'), false, 'no time for the short session: no row');
  });

  it('the ideas step by one a day from the plan’s date; a meal without ideas has none', () => {
    const at = (date: string) => (foodDay(DAY, date, null).rows.find((r) => r.kind === 'meal' && r.id === 'lunch') as Json).idea;
    assert.deepEqual(at('2026-11-02'), { index: 0, of: 6 });
    assert.deepEqual(at('2026-11-03'), { index: 1, of: 6 });
    assert.deepEqual(at('2026-11-08'), { index: 0, of: 6 });
    assert.equal((foodDay(DAY, '2026-11-02', null).rows.find((r) => r.kind === 'meal' && r.id === 'evening') as Json).idea, null);
  });

  it('a plan without times: the meals in the plan’s order, nothing else', () => {
    const d = foodDay(PLAN, '2026-11-02', { type: 'A', name: 'A', kind: 'lift' });
    assert.equal(d.timed, false);
    assert.deepEqual(d.rows.map((r) => r.kind === 'meal' && r.id), ['breakfast', 'lunch', 'dinner', 'snacks']);
    assert.deepEqual([d.wake, d.work, d.bed, d.drinks], [null, null, null, null]);
  });

  it('the report: the kind of day from the plan’s rotation (Monday lifting, Sunday short), the words, the checks with their lines’ min', () => {
    const early = dayState('early');
    assert.deepEqual([early.day.kind, early.day.session], ['lift', { type: 'A', name: 'Full Body A' }]);
    assert.deepEqual(early.checks.map((c: Json) => [c.id, c.slots, c.min]), [['veg', ['Lunch', 'Dinner'], 2], ['fruit', ['Once', 'Twice'], 2]]);
    assert.equal(early.words.goal, 'Build muscle, lose a little fat');
    assert.equal(early.why.energy.title, 'About 2,800 kcal a day');
    const later = dayState('later');
    assert.deepEqual([later.day.kind, later.day.session.type], ['short', 'S3']);
    const plain = state('early').food;
    assert.deepEqual([plain.day.timed, plain.checks, plain.words.reasons], [false, [], []]);
    assert.deepEqual([state('empty').food.day, state('empty').food.words, state('empty').food.checks], [null, null, []]);
  });

  it('the light checks: a day meets a line when its taps reach the line’s min; most days of the week pre-fill met, fewer leave it open', () => {
    const veg = DAY.today!.optional![0]!;
    assert.equal(checkMet(veg, { min: 2 }, [0]), false);
    assert.equal(checkMet(veg, { min: 2 }, [1, 0]), true);
    assert.equal(checkMet(veg, { min: 9 }, [0, 1]), true, 'a min above the slots: all the slots');
    assert.equal(checkMet(veg, undefined, [0, 0, 7]), false, 'out-of-range and repeated taps do not count');
    const days = (n: number, slots: number[]) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`2026-11-0${2 + i}`, { veg: slots, fruit: [0] }]));
    const five = checksPrefill(DAY, days(5, [0, 1]), '2026-11-02');
    assert.deepEqual(five, { veg: { met: true, days: 5, of: 7, tapped: 5 }, fruit: { met: null, days: 0, of: 7, tapped: 5 } });
    assert.deepEqual(checksPrefill(DAY, days(4, [0, 1]), '2026-11-02').veg, { met: null, days: 4, of: 7, tapped: 4 });
    assert.deepEqual(checksPrefill(DAY, days(3, [0, 1]), '2026-11-02', '2026-11-05').veg, { met: null, days: 0, of: 4, tapped: 0 }, 'only the cycle’s days count, Thursday to Sunday');
    const late = Object.fromEntries(['05', '06', '07', '08'].map((d) => [`2026-11-${d}`, { veg: [0, 1] }]));
    assert.deepEqual(checksPrefill(DAY, late, '2026-11-02', '2026-11-05').veg, { met: true, days: 4, of: 4, tapped: 4 }, 'a shorter week needs all of its days up to 5');
    delete late['2026-11-08'];
    assert.deepEqual(checksPrefill(DAY, late, '2026-11-02', '2026-11-05').veg, { met: null, days: 3, of: 4, tapped: 3 });
    assert.deepEqual(checksPrefill(PLAN, days(7, [0, 1]), '2026-11-02'), {}, 'no checks in the plan: nothing to pre-fill');
  });

  it('the write order: the words after the goal, the day before the meals, the checks and the tips beside the plate', () => {
    const keys = Object.keys(orderedPlan({ ...clone(DAY), schemaVersion: 1 } as Json));
    assert.deepEqual(keys, EATING_ORDER.filter((k) => k in DAY));
  });

  it('cli: eating takes the new fields (a dry run, then the write and its read-back) and food returns them', () => {
    const files = fixtureFiles('v');
    const { today } = applyFoodState(files, 'early', 'v', 'plain');
    const io = { ...memoryIo(files, today), writeEating: (root: string, text: string) => void (files[`${root}/3-Personal/Fitness/Coach/eating-plan.json`] = text) };
    const j = (argv: string[]) => {
      const r = run(argv, io);
      return { code: r.code, out: JSON.parse(r.stdout) as Json };
    };
    // The coach's words and the day, merged into the plan the file holds (meals replace the list whole).
    const part = { goalLabel: DAY.goalLabel, summary: DAY.summary, why: DAY.why, day: DAY.day, meals: DAY.meals, today: DAY.today, tips: DAY.tips };
    files['words.json'] = JSON.stringify(part);
    const dry = j(['eating', '--vault', 'v', '--file', 'words.json']);
    assert.deepEqual([dry.code, dry.out.result, dry.out.changed.sort()], [0, 'merged', ['day', 'goalLabel', 'meals', 'summary', 'tips', 'today', 'why']]);
    assert.equal(JSON.parse(files[EATING]!).summary, undefined, 'a dry run writes nothing');
    const wr = j(['eating', '--vault', 'v', '--file', 'words.json', '--write']);
    assert.deepEqual([wr.code, wr.out.written], [0, true]);
    const saved = JSON.parse(files[EATING]!);
    assert.deepEqual(Object.keys(saved).filter((k) => ['goalLabel', 'summary', 'why', 'day', 'today', 'tips'].includes(k)), ['goalLabel', 'summary', 'why', 'day', 'today', 'tips']);
    assert.equal(saved.meals[1].ideas.length, 6);
    files['bad.json'] = JSON.stringify({ today: { optional: [{ id: 'nuts', label: 'Nuts', slots: ['Once'] }] } });
    const bad = j(['eating', '--vault', 'v', '--file', 'bad.json', '--write']);
    assert.equal(bad.code, 1);
    assert.ok(bad.out.errors.some((e: Json) => /no pattern line with the id nuts/.test(e.message)));
    const f = j(['food', '--vault', 'v', '--date', today, '--json']);
    assert.equal(f.code, 0);
    assert.deepEqual([f.out.day.kind, f.out.day.timed, f.out.day.rows.length, f.out.words.goal, f.out.checks.length, f.out.plan.tips.length], ['lift', true, 8, 'Build muscle, lose a little fat', 2, 4]);
  });
});
