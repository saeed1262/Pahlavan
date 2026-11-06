// The Food tab drawn in Node with the small fake DOM, on the mockup's
// states (test/fixtures/food, made up), with the plan as the coach writes
// it now (the day, the meal ideas, the reasons, the light checks, the tips)
// and the schema 1 plan without them: the kicker names the level "Hand
// portions", Your plan in a minute, the day's timeline from the plan's times
// and the rotation's kind of day, today's idea stepping on, the light
// checks, the tips, How it's going in one card; every number carries its
// Why with the rule id on the element only, the protein tick goes to the
// view's handler, and the empty state offers the diet command.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { readTracking } from '../../src/adapters/vault/tracking-read.ts';
import { buildFood } from '../../src/report/food.ts';
import { applyFoodState, type FoodPlan, type FoodState } from '../../test/fixtures/food/food-state.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';
import { renderFood, type FoodContext } from '../src/ui/food.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';

installFakeDom();

const RULE_ID = /\b(diet|weight|tracking|plan|protein)\.[a-z][a-z0-9-]*\b/;

function draw(state: FoodState, over: Partial<FoodContext> = {}, plan: FoodPlan = 'day') {
  const files = fixtureFiles('v');
  const { today } = applyFoodState(files, state, 'v', plan);
  const io = memoryIo(files, today);
  const model = buildFood(readVault(io, 'v', { asOf: today }), readTracking(io, 'v'), today);
  const calls: string[] = [];
  const ctx: FoodContext = {
    phase: { id: 'workday', isfahan: false },
    planWeek: null,
    phaseOf: null,
    width: 1200,
    tables: new Set(),
    onTable: (id) => void calls.push(`table:${id}`),
    onTick: (done) => void calls.push(`tick:${done}`),
    tickBusy: false,
    onCopy: () => void calls.push('copy'),
    onCheck: (id, slot) => void calls.push(`check:${id}:${slot}`),
    onIdea: (meal) => void calls.push(`idea:${meal}`),
    ...over,
  };
  const root = new FakeElement('div');
  renderFood(root as unknown as HTMLElement, model, ctx);
  return { root, calls, model };
}
const click = (el: FakeElement | null) => {
  assert.ok(el, 'the element is drawn');
  for (const fn of el.listeners.get('click') ?? []) fn({ target: el } as unknown as Event);
};
const sec = (root: FakeElement, id: string) => root.querySelector(`[data-sec="${id}"]`)!;

describe('the Food tab', () => {
  it('the banner: the week, the phase and the level; protein days and the next check', () => {
    const { root } = draw('early');
    assert.equal(text(root.querySelector('.pv-kicker')!), 'Week 1 · Foundation · Hand portions');
    assert.equal(text(root.querySelector('.pv-hero-sub')!), 'Monday 2 November · your eating plan of 2 Nov');
    assert.deepEqual(root.querySelectorAll('.pv-hero-chip').map(text), ['Protein days 0 of 7', 'Next check Sun 29 Nov']);
    assert.equal(root.querySelectorAll('.pv-ring-seg').length, 7);
  });

  it('the cards in their order, each with its section id', () => {
    const { root } = draw('early');
    assert.deepEqual(root.querySelectorAll('[data-sec]').map((c) => c.getAttribute('data-sec')), ['plan', 'day', 'today', 'tips', 'going']);
    const side = root.querySelector('.pv-fd-side')!;
    assert.deepEqual(side.children.map((c) => c.getAttribute('data-sec')), ['today', 'tips', 'going']);
  });

  it('your plan in a minute: the goal, the approach, the three facts, why this plan with each source', () => {
    const plan = sec(draw('early').root, 'plan');
    assert.equal(text(plan.querySelector('.pv-fd-plan-title')!), 'Build muscle, lose a little fat');
    assert.match(text(plan.querySelector('.pv-fd-lead')!), /^Eat about what you burn, keep protein high/);
    assert.deepEqual(plan.querySelectorAll('.pv-fd-fact-big').map(text), ['About 2,800 kcal a day', '134 g protein or more', '3 meals and snacks']);
    assert.equal(text(plan.querySelectorAll('.pv-fd-fact-sub')[2]!), 'Cooking daily, no pork, no alcohol');
    assert.deepEqual(plan.querySelectorAll('.pv-fd-reason h4').map(text), ['Eat about what you burn, protein high', 'Hands, not numbers', 'Heart-healthy foods']);
    const src = plan.querySelectorAll('.pv-fd-src').map(text);
    assert.equal(src[0], 'From your intake: your goal is to build muscle and lose a little fat.');
    assert.equal(src[2], 'You said: your cholesterol is borderline. The numbers stay with your doctor.');
  });

  it('a day on your plan, a lifting Monday: up, the meals by the clock, the lift after work, bed, the drinks', () => {
    const day = sec(draw('early').root, 'day');
    assert.equal(text(day.querySelector('.pv-card-title')!), 'Monday, a lifting day');
    assert.equal(text(day.querySelector('.pv-card-sub')!), 'Up at 7, work 9 to 17, bed around 23:30. About 150 g of protein planned, over your 134 g.');
    const rows = day.querySelectorAll('.pv-fd-tl-row');
    assert.deepEqual(rows.map((r) => text(r.querySelector('time')!)), ['7:00', '7:30', '12:30', '16:00', '17:30', '19:30', '21:30', '23:30']);
    assert.deepEqual(rows.filter((r) => r.classList.contains('is-mark')).map((r) => text(r.querySelector('.pv-fd-tl-body')!)), ['Up', 'Lift, about an hourFull Body A', 'Bed']);
    const lunch = day.querySelector('[data-meal="lunch"]')!;
    assert.ok(lunch.classList.contains('is-hard'));
    assert.equal(lunch.querySelectorAll('.pv-fd-hand').length, 8, '2 palms, 2 fists, 2 cupped hands (one maybe), 2 thumbs');
    assert.equal(lunch.querySelectorAll('.pv-fd-hand.is-maybe').length, 1);
    assert.equal(text(lunch.querySelectorAll('.pv-fd-hg-t')[0]!), '2 palmsProtein: fish, chicken or lamb');
    assert.equal(lunch.querySelector('.pv-fd-meal-text'), null, 'the hands with their foods say what the text said');
    assert.match(text(lunch.querySelector('.pv-fd-fb')!), /^If lunch is hardFirst choice: cook double at dinner, box half for the next day’s lunch\.Or one of these, in 5 minutes:A tuna or chickpea wrap/);
    assert.equal(text(day.querySelector('[data-meal="snack"] .pv-fd-tl-note')!), 'A lifting day: have it 1 to 2 hours before you train.');
    assert.equal(text(day.querySelector('[data-meal="dinner"] .pv-fd-tl-note.is-quiet')!), 'Cooking double? Box half for tomorrow’s lunch.');
    assert.equal(text(day.querySelector('.pv-fd-day-foot')!), 'Through the day: about 2 L of water, 2 glasses of milk and 2 to 3 coffees with the last by 17:00.');
  });

  it('today’s idea: the day’s own, its pattern lines, and Another idea stepping on (never saved)', () => {
    const { root, calls } = draw('early');
    const lunch = root.querySelector('[data-meal="lunch"]')!;
    assert.equal(text(lunch.querySelector('.pv-fd-idea-k')!), 'Today’s idea');
    assert.match(text(lunch.querySelector('.pv-fd-idea-t')!), /^Tuna and white bean salad/);
    assert.equal(text(lunch.querySelector('.pv-fd-counts')!), 'Counts forFishLegumes');
    assert.equal(text(lunch.querySelector('.pv-fd-more')!), 'Another idea· 1 of 6');
    click(lunch.querySelector('[data-k="fd-idea-lunch"]'));
    assert.deepEqual(calls, ['idea:lunch']);
    const next = draw('early', { ideaSteps: { lunch: 1 } }).root.querySelector('[data-meal="lunch"]')!;
    assert.equal(text(next.querySelector('.pv-fd-idea-k')!), 'Another idea');
    assert.equal(text(next.querySelector('.pv-fd-more')!), 'Another idea· 2 of 6');
    assert.equal(draw('early').root.querySelector('[data-meal="evening"] .pv-fd-idea'), null, 'no ideas: no idea box');
  });

  it('a short Sunday four weeks on: no lift, no pre-lift note, the short session at its time, the ideas moved on by the days', () => {
    const day = sec(draw('later').root, 'day');
    assert.equal(text(day.querySelector('.pv-card-title')!), 'Sunday, a short day');
    const marks = day.querySelectorAll('.pv-fd-tl-row.is-mark').map((r) => text(r.querySelector('.pv-fd-tl-body')!));
    assert.deepEqual(marks, ['Up', 'Short session, 30 minutesShort 3 · Conditioning', 'Bed']);
    assert.equal(day.querySelector('[data-meal="snack"] .pv-fd-tl-note'), null);
    // 27 days after the plan's date: breakfast's 5 ideas at 27 % 5 = 2, lunch's 6 at 27 % 6 = 3.
    assert.equal(text(day.querySelector('[data-meal="breakfast"] .pv-fd-more')!), 'Another idea· 3 of 5');
    assert.equal(text(day.querySelector('[data-meal="lunch"] .pv-fd-more')!), 'Another idea· 4 of 6');
  });

  it('today: the protein tick to the handler; the light checks tapped, never a score', () => {
    const { root, calls } = draw('early', { checks: { veg: [0] } });
    const t = sec(root, 'today');
    assert.equal(text(t.querySelector('.pv-card-title')!), 'Protein, 134 g or more');
    assert.match(text(t.querySelector('[data-k="fd-tick"]')!), /^Not ticked yetTick it tonight if you got there\. The 21:00 card asks too\.$/);
    assert.deepEqual(t.querySelectorAll('.pv-fd-opt-l').map(text), ['Vegetables at 2 meals', 'Fruit twice']);
    assert.deepEqual(t.querySelectorAll('.pv-fd-chk').map((b) => `${text(b)}:${b.getAttribute('aria-pressed')}`), ['Lunch:true', 'Dinner:false', 'Once:false', 'Twice:false']);
    click(t.querySelector('[data-k="fd-tick"]'));
    click(t.querySelector('[data-k="fd-chk-fruit-1"]'));
    assert.deepEqual(calls, ['tick:true', 'check:fruit:1']);
    assert.doesNotMatch(text(t), /score:|points|\d+ %/i);
    const busy = draw('early', { tickBusy: true }).root.querySelector('[data-k="fd-tick"]')!;
    assert.ok(busy.hasAttribute('disabled'));
    assert.match(text(busy), /Saving/);
    const ro = draw('early', { onTick: undefined, onCheck: undefined }).root;
    assert.ok(ro.querySelector('[data-k="fd-tick"]')!.hasAttribute('disabled'), 'read only without the reminders');
    assert.ok(ro.querySelector('[data-k="fd-chk-veg-0"]')!.hasAttribute('disabled'), 'read only without the help store');
  });

  it('coach’s tips and how it’s going: protein days, waist and weight with a Table view, the pattern, the next check', () => {
    const { root, calls } = draw('later');
    assert.deepEqual(sec(root, 'tips').querySelectorAll('.pv-fd-tip b').map(text), ['Cook double at dinner', 'Keep a lunch shelf at work', 'Give fish two fixed days', 'Eating out, or a loose day']);
    const g = sec(root, 'going');
    assert.equal(text(g.querySelector('.pv-card-sub')!), 'Checked today: no change · next check 13 Dec');
    const heads = g.querySelectorAll('.pv-fd-sec-h').map((x) => text(x.children[0]!));
    assert.deepEqual(heads, ['Protein days this week', 'Waist and weight', 'The weekly pattern', 'Next check']);
    assert.equal(text(g.querySelector('.pv-fd-sec-v')!), '4 of 7 so far, today open');
    assert.match(text(g), /Weeks before: W1 5, W2 4, W3 6\./);
    assert.equal(g.querySelectorAll('svg.pv-chart').length, 2, 'the waist and the weight on a shared date axis');
    const fish = g.querySelectorAll('.pv-fd-pt-marks')[0]!.querySelectorAll('.pv-day-mark').map((x) => x.className.split(' ').at(-1));
    assert.deepEqual(fish, ['is-ticked', 'is-ticked', 'is-unticked', 'is-future']);
    assert.match(text(g.querySelector('.pv-fd-status')!), /^Checked today: no changeThe waist is down 1\.0 cm in 4 weeks, so the portions stay\.$/);
    click(g.querySelector('[data-k="fd-table"]'));
    assert.deepEqual(calls, ['table:food-trend']);
    assert.ok(sec(draw('later', { tables: new Set(['food-trend']) }).root, 'going').querySelector('[data-card="food-trend"]')!.classList.contains('is-table'));
    assert.equal(text(sec(draw('early').root, 'going').querySelector('.pv-card-sub')!), 'Week 1, too early to judge · next check 29 Nov');
  });

  it('every number has its Why on hover; rule ids only in data-rule; no em-dash, no "deload" in the text', () => {
    for (const state of ['early', 'later'] as const) {
      for (const plan of ['day', 'plain'] as const) {
        const { root } = draw(state, {}, plan);
        const whys = root.querySelectorAll('.pv-fd-why');
        assert.ok(whys.length > 20, `${state} ${plan}: ${whys.length} numbers with a Why`);
        for (const w of whys) {
          assert.ok(w.getAttribute('data-tip'), `${state}: ${text(w)} has a tooltip`);
          assert.match(w.getAttribute('data-rule') ?? '', /^(diet|weight|tracking|plan|protein)(\.[a-z][a-z0-9-]*)*$/, `${state}: ${text(w)} keeps its rule id`);
          assert.doesNotMatch(w.getAttribute('data-tip')!, RULE_ID, `${state}: ${text(w)}'s tooltip names no rule id`);
        }
        assert.doesNotMatch(text(root), RULE_ID, `${state}: the visible text names no rule id`);
        assert.doesNotMatch(text(root), /—/, `${state}: no em-dash`);
        assert.doesNotMatch(text(root), /deload/i, `${state}: the user's word is light week`);
      }
    }
  });

  it('the schema 1 plan: the stand-ins for the words, the meals in order without times, no ideas, checks or tips', () => {
    const { root } = draw('early', {}, 'plain');
    assert.deepEqual(root.querySelectorAll('[data-sec]').map((c) => c.getAttribute('data-sec')), ['plan', 'day', 'today', 'going']);
    const plan = sec(root, 'plan');
    assert.equal(text(plan.querySelector('.pv-fd-plan-title')!), 'Build muscle, lose a little fat');
    assert.equal(text(plan.querySelector('.pv-fd-lead')!), 'Keep protein high and let your hands set the portions. Nothing to weigh, nothing to count.');
    assert.equal(text(plan.querySelector('.pv-fd-reason-line')!), 'Made for your goal: build muscle, lose a little fat. Hand portions, the level you chose with the coach. The coach adds the reasons behind it at the next review.');
    const day = sec(root, 'day');
    assert.ok(day.classList.contains('is-untimed'));
    assert.equal(text(day.querySelector('.pv-card-sub')!), 'About 150 g of protein planned, over your 134 g.');
    assert.deepEqual(day.querySelectorAll('.pv-fd-tl-row').map((r) => r.getAttribute('data-meal')), ['breakfast', 'lunch', 'dinner', 'snacks']);
    assert.equal(day.querySelectorAll('.pv-fd-tl-row.is-mark').length, 0);
    assert.equal(day.querySelectorAll('.pv-fd-idea').length, 0);
    assert.equal(day.querySelector('.pv-fd-day-foot'), null);
    assert.equal(text(day.querySelectorAll('.pv-fd-hg-t')[0]!), '2 palmsProtein: fish, chicken, lamb, eggs, lentils or chickpeas, cottage cheese', 'the foods from the group');
    assert.equal(sec(root, 'today').querySelector('.pv-fd-today-opt'), null);
  });

  it('no plan: the empty state with the command to copy, the waist and the weight trend in the banner', () => {
    const { root, calls } = draw('empty');
    assert.equal(text(root.querySelector('.pv-kicker')!), 'Week 1 · Foundation');
    assert.deepEqual(root.querySelectorAll('.pv-hero-chip').map(text), ['Waist 92 cm, 2 Nov', 'Weight trend 83.5 kg']);
    assert.equal(text(root.querySelector('.pv-ring-l')!), 'NO PLAN');
    assert.match(text(root.querySelector('.pv-fd-empty-t')!), /Run \/fitness-coach diet to make one/);
    assert.equal(root.querySelector('.pv-fd-soon')!.children.length, 6);
    assert.equal(root.querySelectorAll('[data-sec]').length, 0);
    click(root.querySelector('[data-k="fd-copy"]'));
    assert.deepEqual(calls, ['copy']);
  });
});
