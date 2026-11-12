// At a glance and the foldable sections drawn in Node with the small fake
// DOM: the panel open (the summary, What's on this tab with each section's
// row, Open all and Fold all, Progress's other views) and folded to its one
// line (a click opens it); a card's fold (the corner chevron, the folded bar
// with its name and status, drawn again on the same card without doubling);
// the Food tab's cards folded by its glance; the Plan packed in two columns
// when folds are known; and the Sunday check-in's pattern pre-filled from
// the Food tab's light checks.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { readTracking } from '../../src/adapters/vault/tracking-read.ts';
import { checkinWeek } from '../../src/report/banners.ts';
import { buildCheckin } from '../../src/report/checkin-screen.ts';
import { buildFood, checksPrefill } from '../../src/report/food.ts';
import { foodGlance, planGlance, type GlanceLine } from '../../src/report/glance.ts';
import { buildPlan } from '../../src/report/plan-screen.ts';
import { applyFoodState } from '../../test/fixtures/food/food-state.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';
import { sectionFolded } from '../src/help.ts';
import { applyPatternChecks, refreshCheckinState, renderCheckin } from '../src/ui/checkin.ts';
import { renderFood } from '../src/ui/food.ts';
import { foldCard, glancePanel, type PanelContext } from '../src/ui/glance.ts';
import { renderPlan } from '../src/ui/plan.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';

installFakeDom();
const click = (el: FakeElement | null) => {
  assert.ok(el, 'drawn');
  for (const fn of el!.listeners.get('click') ?? []) fn({ target: el, stopPropagation() {} });
};
const SUMS: GlanceLine[] = [
  { icon: 'dumbbell', text: [{ b: 'Full Body B' }, ', about 60 min.'] },
  { icon: 'pulse', flag: true, text: ['Readiness ', { b: 'Watch' }, '.'] },
];

function panel(over: Partial<PanelContext> = {}) {
  const calls: string[] = [];
  const el = glancePanel({
    sums: SUMS,
    rows: [{ id: 'readiness', title: 'Readiness', line: 'Recovery from the morning check-in', folded: true }, { id: 'session', title: 'Today’s session', line: 'The workout to do now', folded: false }],
    open: true,
    heading: 'What’s on this tab',
    onPanel: (open) => void calls.push(`panel:${open}`),
    onAll: (fold) => void calls.push(`all:${fold}`),
    onGo: (id) => void calls.push(`go:${id}`),
    ...over,
  }) as unknown as FakeElement;
  return { el, calls };
}

describe('the At a glance panel', () => {
  it('open: the summary, What’s on this tab with a row per section, Open all and Fold all, its fold', () => {
    const { el, calls } = panel();
    assert.ok(el.classList.contains('is-open'));
    assert.equal(text(el.querySelector('.pv-kicker')!), 'At a glance');
    assert.deepEqual(el.querySelectorAll('.pv-gl-sum li').map(text), ['Full Body B, about 60 min.', 'Readiness Watch.']);
    assert.ok(el.querySelectorAll('.pv-gl-sum li')[1]!.classList.contains('is-flag'));
    assert.equal(text(el.querySelector('.pv-gl-map-h')!), 'What’s on this tab');
    assert.deepEqual(el.querySelectorAll('.pv-gl-row').map(text), ['ReadinessRecovery from the morning check-infolded', 'Today’s sessionThe workout to do now']);
    click(el.querySelector('[data-k="gl-go-readiness"]'));
    click(el.querySelector('[data-k="gl-open-all"]'));
    click(el.querySelector('[data-k="gl-fold-all"]'));
    click(el.querySelector('[data-k="gl-panel"]'));
    assert.deepEqual(calls, ['go:readiness', 'all:false', 'all:true', 'panel:false']);
    assert.equal(el.querySelector('.pv-gl-first'), null, 'the first line shows only when folded');
  });

  it('folded: its one line, no list and no Open all; a click anywhere opens it', () => {
    const { el, calls } = panel({ open: false });
    assert.ok(el.classList.contains('is-folded'));
    assert.equal(text(el.querySelector('.pv-gl-first')!), 'Full Body B, about 60 min.');
    assert.equal(el.querySelector('.pv-gl-body'), null);
    assert.equal(el.querySelector('[data-k="gl-open-all"]'), null);
    assert.equal(el.querySelector('[data-k="gl-panel"]')!.getAttribute('aria-expanded'), 'false');
    click(el);
    assert.deepEqual(calls, ['panel:true']);
  });

  it('Progress: What’s on the view, and the other views a click away', () => {
    const seen: string[] = [];
    const { el } = panel({ heading: 'What’s on Overview', views: { label: 'Also on Progress', items: [{ id: 'training', label: 'Training', line: 'Records' }, { id: 'body', label: 'Body', line: 'Tape' }], onView: (id) => void seen.push(id) } });
    assert.equal(text(el.querySelector('.pv-gl-views')!), 'Also on ProgressTrainingBody');
    click(el.querySelector('[data-k="gl-view-body"]'));
    assert.deepEqual(seen, ['body']);
  });
});

describe('a section’s fold', () => {
  const card = () => {
    const c = new FakeElement('section');
    c.className = 'pv-card';
    c.append(Object.assign(new FakeElement('div'), { className: 'pv-card-head' }));
    return c;
  };

  it('open: the corner chevron folds it; folded: the bar with its name and status opens it', () => {
    const c = card();
    const calls: boolean[] = [];
    const o = { id: 'week', title: 'This week', status: ['Lifting ', { b: '2 of 3' }], folded: false, onToggle: (f: boolean) => void calls.push(f) };
    foldCard(c as unknown as HTMLElement, o);
    assert.ok(c.classList.contains('pv-fold-card') && !c.classList.contains('is-folded'));
    assert.equal(c.getAttribute('data-folded'), 'false');
    click(c.querySelector('[data-k="fold-week"]'));
    foldCard(c as unknown as HTMLElement, { ...o, folded: true });
    assert.ok(c.classList.contains('is-folded'));
    assert.equal(c.querySelectorAll('.pv-fold-bar').length, 1, 'drawn again: one bar, one chevron');
    assert.equal(c.querySelectorAll('.pv-fold-btn').length, 1);
    assert.equal(text(c.querySelector('.pv-fold-bar')!), 'This weekLifting 2 of 3');
    assert.equal(text(c.querySelector('.pv-fold-st b')!), '2 of 3');
    click(c.querySelector('[data-k="fold-open-week"]'));
    assert.deepEqual(calls, [true, false]);
    assert.ok(c.children[2]!.classList.contains('pv-card-head'), 'the card’s own parts stay, after the bar and the chevron');
  });

  it('the Food tab’s cards folded by its glance: How it’s going and, after the first visits, the plan', () => {
    const files = fixtureFiles('v');
    const { today } = applyFoodState(files, 'early', 'v', 'day');
    const io = memoryIo(files, today);
    const m = buildFood(readVault(io, 'v', { asOf: today }), readTracking(io, 'v'), today);
    const root = new FakeElement('div');
    renderFood(root as unknown as HTMLElement, m, { phase: { id: 'workday', isfahan: false }, planWeek: null, phaseOf: null, width: 1200, tables: new Set(), onTable: () => {}, tickBusy: false });
    for (const sp of foodGlance(m, { early: false }).sections) {
      const c = root.querySelector(`[data-sec="${sp.id}"]`)!;
      foldCard(c as unknown as HTMLElement, { id: sp.id, title: sp.title, status: sp.status, folded: sectionFolded(null, 'food', sp, today), onToggle: () => {} });
    }
    assert.deepEqual(root.querySelectorAll('.pv-fold-card').map((c) => `${c.getAttribute('data-sec')}:${c.getAttribute('data-folded')}`), ['plan:true', 'day:false', 'today:false', 'tips:false', 'going:true']);
    assert.equal(text(root.querySelector('[data-sec="going"] .pv-fold-bar')!), 'How it’s goingWeek 1, too early to judge · next check 29 Nov');
  });
});

describe('the Plan packed, and the Sunday pattern from the light checks', () => {
  it('the Plan: Why this plan under the timeline, This mesocycle and the load on the left, the sets and Coming up on the right, folded full-width cards in the left column', () => {
    const DATE = '2026-04-10';
    const read = readVault(memoryIo(fixtureFiles('v'), DATE), 'v', { asOf: DATE });
    const p = buildPlan(read, DATE);
    const g = planGlance(p, { weekTarget: null, targets: null, desk: null, links: 0 });
    const draw = (folded?: (id: string) => boolean) => {
      const root = new FakeElement('div');
      renderPlan(root as unknown as HTMLElement, p, { view: 'week', tables: new Set(), onView: () => {}, onTable: () => {}, hero: { phase: { id: 'workday', isfahan: false }, phaseOf: null, weekTarget: null }, ...(folded ? { folded } : {}) });
      return root.querySelector('.pv-prog-grid')!;
    };
    const ids = (el: FakeElement) => el.children.map((c) => c.getAttribute('data-sec') ?? (c.classList.contains('pv-col') ? `[${c.children.map((x) => x.getAttribute('data-sec')).join(' ')}]` : '?'));
    assert.deepEqual(ids(draw()), ['timeline', 'why', 'meso', 'vol', 'targets', 'load', 'upcoming', 'rules', 'minweek'], 'no folds known: the page order');
    // The standing rules: each kind and lift, marked default where the coach has not set it.
    const rules = draw().children.find((c) => c.getAttribute('data-sec') === 'rules')!;
    assert.match(text(rules), /Standing rules/);
    assert.match(text(rules), /Light weeksdefault: your coach hasn’t set thislight weeks every 4th plan week/);
    const starting = (id: string) => sectionFolded(null, 'plan', g.sections.find((s) => s.id === id)!, DATE);
    assert.deepEqual(ids(draw(starting)), ['timeline', 'why', '[meso load targets rules minweek]', '[vol upcoming]']);
    assert.deepEqual(ids(draw((id) => id !== 'targets' && starting(id))), ['timeline', 'why', '[meso load rules minweek]', '[vol upcoming]', 'targets'], 'opened, a full-width card goes under the columns');
    assert.deepEqual(ids(draw((id) => id === 'why' || starting(id))), ['timeline', '[why meso load targets rules minweek]', '[vol upcoming]'], 'folded, the Why card heads the left column');
  });

  it('the Sunday check-in: a line the checks met on most days starts as met, with its count; the user’s answer stays', () => {
    const files = fixtureFiles('v');
    const { today } = applyFoodState(files, 'later', 'v', 'day');
    const io = memoryIo(files, today);
    const read = readVault(io, 'v', { asOf: today });
    const plan = buildFood(read, readTracking(io, 'v'), today).plan!;
    const c = buildCheckin(read, today, null);
    const days = Object.fromEntries(['23', '24', '25', '26', '27', '28'].map((d) => [`2026-11-${d}`, { veg: [0, 1], fruit: [0] }]));
    const checks = checksPrefill(plan, days, c.sunday!.weekStart);
    assert.deepEqual(checks, { veg: { met: true, days: 6, of: 7, tapped: 6 }, fruit: { met: null, days: 0, of: 7, tapped: 6 } });
    const st = refreshCheckinState(null, c);
    applyPatternChecks(st, c, checks);
    assert.deepEqual([st.sunday!.answers.pattern['veg'], st.sunday!.answers.pattern['fruit']], [true, null]);
    const mine = refreshCheckinState(null, c);
    mine.sunday!.answers.pattern['veg'] = false;
    mine.sunday!.dirty = true;
    applyPatternChecks(mine, c, checks);
    assert.equal(mine.sunday!.answers.pattern['veg'], false, 'the user’s own answer stays');
    const root = new FakeElement('div');
    renderCheckin(root as unknown as HTMLElement, c, st, { canWrite: true, hero: { phase: { id: 'workday', isfahan: false }, phaseOf: null, planWeek: 4, phaseNo: 1, week: checkinWeek(read, today), tape: null }, onChange: () => {}, onSaveMorning: () => {}, onSaveSunday: () => {}, patternChecks: checks });
    const q = root.querySelectorAll('.pv-q').find((x) => /pattern this week/.test(text(x)))!;
    assert.match(text(q), /Pre-filled/);
    assert.match(text(q), /Vegetablesat 2 meals a dayYour light checks: met on 6 of 7 days, pre-filled/);
    assert.match(text(q), /Fruittwice a dayYour light checks: met on 0 of 7 days(?!, pre)/, 'tapped once a day: counted, not met');
    const none = new FakeElement('div');
    renderCheckin(none as unknown as HTMLElement, c, refreshCheckinState(null, c), { canWrite: true, hero: { phase: { id: 'workday', isfahan: false }, phaseOf: null, planWeek: 4, phaseNo: 1, week: checkinWeek(read, today), tape: null }, onChange: () => {}, onSaveMorning: () => {}, onSaveSunday: () => {}, patternChecks: checksPrefill(plan, {}, c.sunday!.weekStart) });
    assert.doesNotMatch(text(none), /Your light checks/, 'nothing tapped all week: no line');
    assert.equal(q.querySelector('[data-k="s-pt-veg-y"]')!.getAttribute('aria-pressed'), 'true');
  });
});
