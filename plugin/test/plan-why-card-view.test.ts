// The Plan tab's Why this plan card, drawn in Node with the small fake DOM:
// the coach's lead, each reason with its grade tag (its meaning in the
// tooltip), the split picked and the ones compared, the families left out
// folded until opened, the links to the roadmap and the decision; and with no
// card, the command that writes it with Copy. It sits under the timeline.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { buildPlan } from '../../src/report/index.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';
import { renderPlan, WHY_LEFT_OUT, type PlanContext } from '../src/ui/plan.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';

installFakeDom();
const DATE = '2026-04-10';
const PLAN = 'v/3-Personal/Fitness/plan-data.json';
const DECISIONS = 'v/3-Personal/Fitness/Coach/Decisions.md';

type Json = Record<string, any>;
function model(edit: (plan: Json) => void = () => {}, decisions: string | null = '# Decisions\n') {
  const files = fixtureFiles('v');
  const plan = JSON.parse(files[PLAN]!) as Json;
  edit(plan);
  files[PLAN] = JSON.stringify(plan);
  if (decisions !== null) files[DECISIONS] = decisions;
  return buildPlan(readVault(memoryIo(files, DATE), 'v', { asOf: DATE }), DATE, { decisions });
}

function draw(m: ReturnType<typeof model>, extra: Partial<PlanContext> = {}) {
  const root = new FakeElement('div');
  const copied: string[] = [];
  const opened: string[] = [];
  const toggled: string[] = [];
  renderPlan(root as unknown as HTMLElement, m, {
    view: 'week', tables: new Set(), onView: () => {}, onTable: () => {},
    hero: { phase: { id: 'workday', isfahan: false }, phaseOf: null, weekTarget: null },
    onCopy: (t) => void copied.push(t),
    onOpenNote: (p) => void opened.push(p),
    links: [{ label: '6-Month Roadmap', path: '3-Personal/Fitness/6-Month Roadmap.md', icon: 'flag' }],
    openWhy: new Set(), onToggleWhy: (k) => void toggled.push(k),
    ...extra,
  });
  return { root, copied, opened, toggled };
}
const click = (el: FakeElement) => { for (const fn of el.listeners.get('click') ?? []) fn({ target: el }); };

describe('the Why this plan card', () => {
  it('under the timeline: the lead, each reason with its grade, the split picked and the ones compared', () => {
    const { root } = draw(model());
    const cards = root.querySelectorAll('section');
    const at = cards.findIndex((c) => c.getAttribute('data-sec') === 'why');
    assert.ok(at > 0, 'drawn');
    assert.equal(cards[at - 1]!.getAttribute('data-sec'), 'timeline', 'right under the timeline');
    const card = cards[at]!;
    assert.match(text(card.querySelector('.pv-card-sub')!), /^From your coach · written 16 Mar$/);
    assert.match(text(card.querySelector('.pv-why-lead')!), /^This plan is built for a recomposition/);
    const reasons = card.querySelectorAll('.pv-why-reasons li');
    assert.deepEqual(reasons.map((li) => text(li.querySelector('b')!)), ['Glutes come first', 'More pulling than pushing', 'Three lifting days and a short one']);
    assert.deepEqual(reasons.map((li) => li.querySelector('.pv-tag') ? text(li.querySelector('.pv-tag')!) : null), ['Moderate', 'Heuristic', 'Strong']);
    assert.match(reasons[1]!.querySelector('.pv-tag')!.getAttribute('data-tip') ?? '', /weak or no direct evidence/);
    assert.equal(text(card.querySelector('.pv-why-split b')!), 'The split: Full body');
    assert.deepEqual(card.querySelectorAll('.pv-why-fams dt').map(text), ['Also built: Upper/lower', 'Also built: Torso/limbs']);
  });

  it('the families left out stay folded until opened, then each has its line', () => {
    const closed = draw(model());
    const more = closed.root.querySelector('[data-k="why-left-out"]')!;
    assert.equal(text(more), 'Why not the other 8 splits');
    assert.equal(more.getAttribute('aria-expanded'), 'false');
    assert.equal(closed.root.querySelectorAll('.pv-why-fams.is-left-out').length, 0);
    click(more);
    assert.deepEqual(closed.toggled, [WHY_LEFT_OUT]);
    const open = draw(model(), { openWhy: new Set([WHY_LEFT_OUT]) });
    const rows = open.root.querySelectorAll('.pv-why-fams.is-left-out dt').map(text);
    assert.equal(rows.length, 8);
    assert.ok(rows.includes('Push/pull/legs') && rows.includes('Body-part split') && rows.includes('CrossFit-style (HIFT)'), rows.join(', '));
    assert.equal(open.root.querySelector('[data-k="why-left-out"]')!.getAttribute('aria-expanded'), 'true');
  });

  it('links to the roadmap and to the decision, which open the notes', () => {
    const d = draw(model());
    const links = d.root.querySelectorAll('.pv-why-links .pv-link-row');
    assert.deepEqual(links.map(text), ['The full reasoning: 6-Month Roadmap', 'The decision, 16 Mar']);
    assert.equal(links[1]!.getAttribute('data-tip'), 'The decision, 16 Mar|2026-03-16 · New plan', 'the whole heading in the tooltip');
    links.forEach(click);
    assert.deepEqual(d.opened, ['3-Personal/Fitness/6-Month Roadmap.md', '3-Personal/Fitness/Coach/Decisions.md']);
    // No Decisions.md: no decision link.
    const none = draw(model(() => {}, null));
    assert.deepEqual(none.root.querySelectorAll('.pv-why-links .pv-link-row').map(text), ['The full reasoning: 6-Month Roadmap']);
  });

  it('a reason with no grade has no tag', () => {
    const { root } = draw(model((p) => delete p['why'].reasons[0].grade));
    assert.equal(root.querySelectorAll('.pv-why-reasons li')[0]!.querySelector('.pv-tag'), null);
  });

  it('no card yet: what the coach does and the command, with Copy', () => {
    const d = draw(model((p) => delete p['why']));
    const card = d.root.querySelector('[data-sec="why"]')!;
    assert.ok(card.className.includes('is-empty'));
    assert.match(text(card), /hasn’t written this plan’s reasons here yet/);
    assert.equal(text(card.querySelector('code')!), '/fitness-coach plan why');
    click(card.querySelector('[data-k="why-copy"]')!);
    assert.deepEqual(d.copied, ['/fitness-coach plan why']);
  });

  it('a card in the file that can\'t be read says so, with the same command', () => {
    const d = draw(model((p) => (p['why'].lead = '')));
    const card = d.root.querySelector('[data-sec="why"]')!;
    assert.match(text(card), /can’t be read as written/);
    assert.doesNotMatch(text(card), /hasn’t written/);
    assert.equal(card.querySelectorAll('code').map(text).at(-1), '/fitness-coach plan why');
  });

  it('one family left out: "Why not the other split"', () => {
    const d = draw(model((p) => (p['why'].split.leftOut = p['why'].split.leftOut.slice(0, 1))));
    assert.equal(text(d.root.querySelector('[data-k="why-left-out"]')!), 'Why not the other split');
  });

  it('packed in two columns: open, under the timeline; folded, at the head of the left column', () => {
    const open = draw(model(), { folded: () => false });
    const kids = open.root.querySelector('.pv-prog-grid')!.children as FakeElement[];
    assert.equal(kids[1]!.getAttribute('data-sec'), 'why');
    const folded = draw(model(), { folded: (id) => id === 'why' });
    const col = folded.root.querySelector('.pv-col')!;
    assert.equal((col.children as FakeElement[])[0]!.getAttribute('data-sec'), 'why');
  });
});
