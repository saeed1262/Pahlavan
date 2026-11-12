// The Movements tab drawn in Node with the small fake DOM, from the data
// source over the synthetic vault: the groups and their rows, the search
// box (its data-k, so a redraw gives the focus back) whose typing redraws
// only the results, a name opening its guide, an easier step and a ladder
// step jumping to that movement through the view, the filters and "My
// equipment" handed to the view, the calm empty state, and the tab working
// before the files are read.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATALOGUE, CATALOGUE_BY_ID, PATTERNS } from '../../src/core/data/exercises.ts';
import { plainName, type MovementsQuery } from '../../src/report/movements-screen.ts';
import { PahlavanData } from '../src/data-source.ts';
import { freshMovementsUi, renderMovements, type MovementsUi } from '../src/ui/movements.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';
import { memVault } from './mem-vault.ts';

installFakeDom();
const DATE = '2026-04-10';
const data = new PahlavanData(memVault().adapter);
await data.load(DATE);

function draw(query: MovementsQuery = {}, src: PahlavanData = data) {
  const ui: MovementsUi = { ...freshMovementsUi(), query };
  const calls: string[] = [];
  const root = new FakeElement('div');
  const ctx = {
    ui,
    build: (q: MovementsQuery) => src.movements(q),
    onChange: () => void calls.push('change'),
    delay: 0,
  };
  renderMovements(root as unknown as HTMLElement, src.movements(ui.query), ctx);
  return { root, ui, calls };
}
const fire = (el: FakeElement | null, type: string, ev: Record<string, unknown> = {}) => {
  assert.ok(el, `the element for ${type} is drawn`);
  for (const fn of el.listeners.get(type) ?? []) fn({ target: el, stopPropagation() {}, ...ev });
};
const row = (root: FakeElement, id: string) => root.querySelector(`[data-mv-id="${id}"]`);

describe('the Movements tab', () => {
  it('the header, the search box with its data-k, and every group with its rows', () => {
    const { root } = draw();
    assert.equal(text(root.querySelector('.pv-mv-head h1')!), 'Movements');
    const input = root.querySelector('input.pv-mv-input')!;
    assert.equal(input.getAttribute('data-k'), 'mv-search');
    assert.equal(input.getAttribute('placeholder'), 'Search: squat, row, glutes, band…');
    assert.deepEqual(root.querySelectorAll('[data-mv-group]').map((g) => g.getAttribute('data-mv-group')), [...PATTERNS]);
    assert.equal(root.querySelectorAll('.pv-mv-row').length, CATALOGUE.length);
    assert.equal(text(root.querySelector('.pv-mv-count')!), `${CATALOGUE.length} movements in ${PATTERNS.length} groups`);
    assert.equal(text(root.querySelector('[data-mv-group="horizontal-pull"] .pv-kicker')!), 'Rows');
  });

  it('a row: its name opens the guide, its level, its tools and what it works; the plan’s are marked', () => {
    const { root } = draw();
    const goblet = row(root, 'goblet-squat')!;
    assert.ok(goblet.classList.contains('is-plan'));
    assert.equal(text(goblet.querySelector('.pv-mv-plan')!), 'In your plan');
    assert.match(text(goblet.querySelector('.pv-mv-meta')!), /^Dumbbell \(or kettlebell\)/);
    assert.match(text(goblet.querySelector('.pv-mv-works')!), /^Quads, glutes/);
    assert.equal(goblet.querySelector('.pv-gd-name')!.getAttribute('aria-expanded'), 'false');
    // A movement your equipment doesn't cover says what it needs.
    assert.equal(text(row(root, 'ring-row')!.querySelector('.pv-mv-needs')!), 'Needs rings');
    assert.equal(row(root, 'ring-row')!.classList.contains('is-plan'), false);
  });

  it('typing redraws the results only: the box stays, the rows follow, the view is not redrawn', () => {
    const { root, ui, calls } = draw();
    const input = root.querySelector('input.pv-mv-input')! as FakeElement & { value: string };
    input.value = 'row';
    fire(input, 'input');
    assert.equal(ui.query.text, 'row');
    assert.equal(root.querySelector('input.pv-mv-input'), input, 'the same input element, so the caret stays');
    assert.equal(root.querySelectorAll('[data-mv-group]')[0]!.getAttribute('data-mv-group'), 'horizontal-pull');
    assert.ok(row(root, 'inverted-row'));
    assert.equal(row(root, 'goblet-squat'), null);
    assert.match(text(root.querySelector('.pv-mv-count')!), /^\d+ of 245 movements ?Clear the search$/);
    assert.deepEqual(calls, []);
    // The clear button shows with words in the box.
    assert.equal(root.querySelector('.pv-mv-clear')!.hasAttribute('hidden'), false);
  });

  it('a name opens its guide in place: the body map, setup, do, avoid and a video search', () => {
    const { root, ui, calls } = draw({ text: 'row' });
    fire(row(root, 'inverted-row')!.querySelector('.pv-gd-name'), 'click');
    assert.ok(ui.open.has('inverted-row'));
    const r = row(root, 'inverted-row')!;
    assert.ok(r.classList.contains('is-open'));
    const guide = r.querySelector('.pv-guide')!;
    assert.equal(guide.querySelectorAll('.pv-gd-map svg').length, 2);
    assert.deepEqual(guide.querySelectorAll('.pv-gd-key').map(text), ['Works', 'Setup', 'Do', 'Avoid']);
    assert.equal(text(guide.querySelector('.pv-gd-video')!), 'Search YouTube: Inverted row');
    assert.deepEqual(calls, [], 'a guide opens without redrawing the tab');
    // Again: it closes.
    fire(row(root, 'inverted-row')!.querySelector('.pv-gd-name'), 'click');
    assert.equal(row(root, 'inverted-row')!.querySelector('.pv-guide'), null);
  });

  it('an easier step jumps to that movement: the filters cleared, the search set to it, its guide open, brought into view', () => {
    const { root, ui, calls } = draw({ pattern: 'squat', level: 'beginner', mine: true });
    const easier = CATALOGUE_BY_ID.get('goblet-squat')!.easier[0]!;
    const link = root.querySelector(`[data-k="mv-step-goblet-squat-${easier}"]`);
    fire(link, 'click');
    assert.deepEqual(ui.query, { text: plainName(CATALOGUE_BY_ID.get(easier)!.name) });
    assert.ok(ui.open.has(easier));
    assert.equal(ui.reveal, easier);
    assert.deepEqual(calls, ['change']);
    // Drawn again for that query, the movement comes first with its guide open.
    const again = new FakeElement('div');
    renderMovements(again as unknown as HTMLElement, data.movements(ui.query), { ui, build: (q) => data.movements(q), onChange: () => {} });
    assert.equal(again.querySelector('.pv-mv-row')!.getAttribute('data-mv-id'), easier);
    assert.ok(again.querySelector('.pv-mv-row')!.querySelector('.pv-guide'));
  });

  it('the ladders: the plan’s own first, the level you are on marked, a step jumps to its movement', () => {
    const { root, ui, calls } = draw();
    const ladders = root.querySelectorAll('[data-ladder]');
    assert.equal(ladders[0]!.getAttribute('data-ladder'), 'plan:pushup');
    assert.equal(text(ladders[0]!.querySelector('.pv-mv-src')!), 'Your plan');
    assert.equal(ladders[0]!.querySelectorAll('.pv-mv-chip.is-now').length, 1);
    // Each card its own title, the source chip beside it.
    const titles = ladders.map((l) => text(l.querySelector('.pv-mv-ladder-head b')!));
    assert.equal(new Set(titles).size, titles.length);
    assert.ok(titles.includes('Push-up: wall push-up to one-arm push-up'));
    assert.equal(ladders.filter((l) => l.querySelector('.pv-mv-src')).length, ladders.length);
    const chip = root.querySelector('[data-ladder="catalogue:pull-up"] button.pv-mv-chip')!;
    fire(chip, 'click');
    assert.equal(ui.reveal, 'dead-hang');
    assert.deepEqual(ui.query, { text: plainName(CATALOGUE_BY_ID.get('dead-hang')!.name) });
    assert.deepEqual(calls, ['change']);
  });

  it('the filters and My equipment go to the view, which draws the tab again', () => {
    const { root, ui, calls } = draw();
    const sel = root.querySelector('select[data-k="mv-pattern"]')! as FakeElement & { value: string };
    sel.value = 'vertical-pull';
    fire(sel, 'change');
    assert.equal(ui.query.pattern, 'vertical-pull');
    const muscle = root.querySelector('select[data-k="mv-muscle"]')! as FakeElement & { value: string };
    muscle.value = '';
    fire(muscle, 'change');
    assert.equal(ui.query.muscle, null);
    fire(root.querySelector('[data-k="mv-level-beginner"]'), 'click');
    assert.equal(ui.query.level, 'beginner');
    fire(root.querySelector('[data-k="mv-mine"]'), 'click');
    assert.equal(ui.query.mine, true);
    assert.deepEqual(calls, ['change', 'change', 'change', 'change']);
    // Drawn with them on: the choices show as chosen, and every row is one your equipment covers.
    const on = draw(ui.query);
    assert.ok(on.root.querySelector('[data-k="mv-mine"]')!.classList.contains('is-on'));
    assert.ok(on.root.querySelector('[data-k="mv-level-beginner"]')!.classList.contains('is-on'));
    assert.equal(on.root.querySelector('select[data-k="mv-pattern"] option[value="vertical-pull"]')!.hasAttribute('selected'), true);
    assert.ok(on.root.querySelectorAll('.pv-mv-row').length > 0);
    assert.equal(on.root.querySelectorAll('.pv-mv-needs').length, 0);
  });

  it('nothing matches: a calm message and Clear the search, which empties the query', () => {
    const { root, ui, calls } = draw({ text: 'zzzz', pattern: 'hinge' });
    assert.equal(root.querySelectorAll('.pv-mv-row').length, 0);
    const empty = root.querySelector('[data-mv="empty"]')!;
    assert.match(text(empty), /^No movement matches/);
    assert.equal(root.querySelector('[data-mv="ladders"]'), null);
    fire(empty.querySelector('[data-k="mv-clear"]'), 'click');
    assert.deepEqual(ui.query, {});
    assert.deepEqual(calls, ['change']);
  });

  it('a filter Pahlavan doesn’t know is a note, and the list still shows', () => {
    const { root } = draw({ muscle: 'spleen' });
    assert.equal(root.querySelectorAll('.pv-mv-row').length, CATALOGUE.length);
    assert.match(text(root.querySelector('[data-note="unknown-muscle"]')!), /spleen/);
  });

  it('before the files are read: the whole catalogue, nothing marked, My equipment off', () => {
    const fresh = new PahlavanData(memVault().adapter);
    const { root } = draw({}, fresh);
    assert.equal(root.querySelectorAll('.pv-mv-row').length, CATALOGUE.length);
    assert.equal(root.querySelectorAll('.pv-mv-row.is-plan').length, 0);
    assert.ok(root.querySelector('[data-k="mv-mine"]')!.hasAttribute('disabled'));
    assert.equal(root.querySelectorAll('[data-ladder^="plan:"]').length, 0);
  });
});
