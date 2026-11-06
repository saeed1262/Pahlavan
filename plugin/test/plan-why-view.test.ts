// The plan's own reason on the screens, drawn in Node with the small fake
// DOM: Today's Why panel opens with "From the plan" above the engine's
// adjustments (a swap names the planned exercise), the finisher has its own
// Why, a row with neither has none, and the Plan screen's templates show
// the reason behind a Why tag. Also Today's swap chips on the same rows:
// a chip is today's swap for the plan's item.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { buildPlan, buildToday } from '../../src/report/index.ts';
import { fixtureWithWhy, memoryIo } from '../../test/helpers.ts';
import { renderPlan } from '../src/ui/plan.ts';
import { renderToday, type TodayContext } from '../src/ui/today.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';

installFakeDom();
const DATE = '2026-04-10';
const read = readVault(memoryIo(fixtureWithWhy(), DATE), 'v', { asOf: DATE });

function today(open: Set<string>) {
  const m = buildToday(read, DATE, 'full', 'v');
  const toggled: string[] = [];
  const ctx: TodayContext = { mode: 'full', session: m.session, phase: { id: 'workday', isfahan: false }, open, pick: null, onMode: () => {}, onPick: () => {}, onToggleWhy: (id) => void toggled.push(id), onLog: () => {}, onEditSession: () => {} };
  const root = new FakeElement('div');
  renderToday(root as unknown as HTMLElement, m, ctx);
  return { root, m, toggled };
}

describe('the plan’s Why on Today and the Plan screen', () => {
  it('Today: "From the plan" comes first in a row’s Why, then the engine’s adjustments', () => {
    const { m } = today(new Set());
    const k = m.session!.items.findIndex((i) => i.planName === 'Romanian Deadlift');
    const { root } = today(new Set([`${k}:${m.session!.items[k]!.exercise}`]));
    const row = root.querySelectorAll('.pv-ex')[k]!;
    const panels = row.querySelectorAll('.pv-why');
    assert.ok(panels.length >= 2, 'the plan’s reason and at least the Ledger’s');
    assert.ok(panels[0]!.classList.contains('is-plan'));
    assert.equal(text(panels[0]!.querySelector('.pv-why-title')!), 'From the plan, for Romanian Deadlift');
    assert.match(text(panels[0]!), /The main hinge, for the hamstrings and the back\.$/);
    assert.ok(!panels[1]!.classList.contains('is-plan'));
  });

  it('Today: the finisher has a Why for its plan reason; its click goes to the view', () => {
    const closed = today(new Set());
    const btn = closed.root.querySelector('.pv-lite .pv-why-btn');
    assert.ok(btn, 'the finisher’s Why');
    for (const fn of btn!.listeners.get('click') ?? []) fn({});
    assert.deepEqual(closed.toggled, ['finisher:zone-2-finisher']);
    const { root } = today(new Set(['finisher:zone-2-finisher']));
    const panel = root.querySelectorAll('.pv-why.is-plan').find((x) => x.parentNode?.classList.contains('pv-session'));
    assert.equal(text(panel!), 'From the planEasy minutes toward the cardio goal.');
  });

  it('the Plan screen: a Why tag on a slot with a reason, the panel when open', () => {
    const p = buildPlan(read, DATE);
    const draw = (open: Set<string>) => {
      const root = new FakeElement('div');
      renderPlan(root as unknown as HTMLElement, p, { view: 'week', tables: new Set(), onView: () => {}, onTable: () => {}, hero: { phase: { id: 'workday', isfahan: false }, phaseOf: null, weekTarget: null }, openWhy: open, onToggleWhy: () => {} });
      return root;
    };
    const closed = draw(new Set());
    assert.ok(closed.querySelectorAll('.pv-tag-why').length >= 2);
    assert.equal(closed.querySelectorAll('.pv-tpl-list .pv-why').length, 0);
    const open = draw(new Set(['plan:B:Romanian Deadlift']));
    const panel = open.querySelector('.pv-tpl-list .pv-why.is-plan');
    assert.ok(panel);
    assert.equal(text(panel!), 'From the planThe main hinge, for the hamstrings and the back.');
  });

  it('the Plan screen: each session a panel with its letter, lifting and short days grouped; a one-number range reads linear', () => {
    const p = structuredClone(buildPlan(read, DATE));
    const tpls = (p as unknown as { templates: { type: string; kind: string; slots: { name: string; repRange: [number, number]; progression?: { rule: string } | null }[] }[] }).templates;
    const slot = tpls.find((t) => t.kind === 'lift')!.slots.find((s) => s.progression?.rule === 'double')!;
    slot.repRange = [6, 6];
    const root = new FakeElement('div');
    renderPlan(root as unknown as HTMLElement, p, { view: 'week', tables: new Set(), onView: () => {}, onTable: () => {}, hero: { phase: { id: 'workday', isfahan: false }, phaseOf: null, weekTarget: null } });
    const groups = root.querySelectorAll('.pv-tpl-group');
    assert.deepEqual(groups.map((g) => text(g.querySelector('.pv-tpl-group-h')!)), ['Lifting days', 'Short days']);
    assert.deepEqual(root.querySelectorAll('.pv-tpl-badge').map(text), tpls.filter((t) => t.kind === 'lift').concat(tpls.filter((t) => t.kind !== 'lift')).map((t) => t.type));
    const row = root.querySelectorAll('.pv-tpl-list li').find((li) => text(li.querySelector('.pv-tpl-ex')!).startsWith(slot.name))!;
    const tags = row.querySelectorAll('.pv-tag').map(text);
    assert.ok(tags.includes('linear') && !tags.includes('double'), tags.join(', '));
  });
});

describe('Today’s swap chips', () => {
  it('choose today’s swap for the plan’s item; the chosen one is marked and undoes', () => {
    const m = buildToday(read, DATE, 'full', 'v');
    const calls: [string, string | null][] = [];
    const draw = (swaps: Record<string, string>) => {
      const root = new FakeElement('div');
      renderToday(root as unknown as HTMLElement, m, { mode: 'full', session: m.session, phase: { id: 'workday', isfahan: false }, open: new Set(), pick: null, onMode: () => {}, onPick: () => {}, onToggleWhy: () => {}, onLog: () => {}, onEditSession: () => {}, swaps, onSwap: (item, to) => void calls.push([item, to]) });
      return root;
    };
    const chips = draw({}).querySelectorAll('.pv-swap-chip');
    assert.ok(chips.length >= 1, 'the Ledger-swapped row offers other swaps');
    assert.ok(chips.every((c) => !c.hasAttribute('disabled')));
    const name = chips[0]!.getAttribute('data-swap')!;
    for (const fn of chips[0]!.listeners.get('click') ?? []) fn({});
    assert.deepEqual(calls, [['Romanian Deadlift', name]]);
    const on = draw({ 'Romanian Deadlift': name }).querySelector('.pv-swap-chip.is-on')!;
    assert.equal(on.getAttribute('data-swap'), name);
    for (const fn of on.listeners.get('click') ?? []) fn({});
    assert.deepEqual(calls.at(-1), ['Romanian Deadlift', null]);
  });
});

describe('the Plan’s minimum week', () => {
  it('a card with the plan’s Express week, its rule on the element only', () => {
    const p = buildPlan(read, DATE);
    const root = new FakeElement('div');
    renderPlan(root as unknown as HTMLElement, p, { view: 'week', tables: new Set(), onView: () => {}, onTable: () => {}, hero: { phase: { id: 'workday', isfahan: false }, phaseOf: null, weekTarget: null } });
    const card = root.querySelector('[data-card="minimum-week"]')!;
    assert.ok(card);
    assert.match(text(card), /The minimum week.*as Express: each one's main lifts at \d working sets/);
    assert.equal(card.getAttribute('data-rule'), 'plan.minimum-week');
    assert.doesNotMatch(text(card), /plan\.minimum-week/);
  });
});
