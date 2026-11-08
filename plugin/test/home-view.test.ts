// The Home tab drawn in Node with the small fake DOM on the synthetic vault:
// the banner (the session, the notes, Log session and See the workout, the
// week's ring and its line), Needs you (each row to its tab, the quiet line
// when nothing is left), Food and habits, the Progress tiles, and a vault
// with no plan (the welcome, as on Today).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { readTracking } from '../../src/adapters/vault/tracking-read.ts';
import { momentAt } from '../../src/core/clock.ts';
import { dueToday } from '../../src/core/nudges.ts';
import { buildFood, buildHome, buildProgress, buildSession, buildToday, coachStepsOf, trainingToday, yourDay, type Home } from '../../src/report/index.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';
import { renderHome, type HomeContext } from '../src/ui/home.ts';
import { weekRing } from '../src/ui/today.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';

installFakeDom();
const click = (el: FakeElement | null) => {
  assert.ok(el, 'drawn');
  for (const fn of el!.listeners.get('click') ?? []) fn({ target: el });
};

function draw(date: string, opts: { edit?: (f: Record<string, string>) => void; change?: (h: Home) => void; welcome?: boolean; intro?: boolean } = {}) {
  const files = fixtureFiles('v');
  opts.edit?.(files);
  const io = memoryIo(files, date);
  const read = readVault(io, 'v', { asOf: date });
  const tr = readTracking(io, 'v');
  const today = buildToday(read, date, 'full', 'v');
  const session = buildSession(read.data, date, 'full');
  const due = dueToday({ now: momentAt(date, '12:15', 0), tracking: tr.tracking, nudges: tr.nudges, body: tr.body, photoFolders: tr.photoFolders, habits: tr.habits, program: read.data.program, training: trainingToday(read.data, date), coach: coachStepsOf(read, date, null).now?.value ?? null }).value;
  const food = buildFood(read, tr, date);
  const day = yourDay(today, { session, due, food, items: tr.tracking?.items ?? [] })?.value ?? null;
  const home = buildHome({ read, today, session, progress: buildProgress(read, date, 'v'), due, food, day, items: tr.tracking?.items ?? [] });
  opts.change?.(home);
  const calls: string[] = [];
  const welcome = opts.welcome ? (document.createElement('section') as unknown as HTMLElement) : null;
  if (welcome) welcome.className = 'pv-welcome';
  const ctx: HomeContext = {
    phase: { id: 'workday', isfahan: true },
    ring: today.review ? weekRing(today, today.review) : null,
    onLog: () => void calls.push('log'),
    onGo: (go) => void calls.push(go),
    welcome,
    ...(opts.intro !== undefined ? { intro: opts.intro } : {}),
  };
  const root = document.createElement('div') as unknown as FakeElement;
  renderHome(root as unknown as HTMLElement, home, today, ctx);
  return { root, calls };
}

describe('Home', () => {
  it('the banner: today’s session, its notes, the week’s ring and its line', () => {
    const { root } = draw('2026-04-10');
    const hero = root.querySelector('.pv-hero')!;
    assert.ok(hero.classList.contains('pv-home-hero') && hero.classList.contains('is-workday') && hero.classList.contains('has-tile'));
    assert.equal(text(hero.querySelector('.pv-kicker')!), 'Today · Friday 10 April');
    assert.equal(text(hero.querySelector('.pv-hero-title')!), 'Full Body B');
    assert.equal(text(hero.querySelector('.pv-hero-sub')!), 'About 60 minutes · 4 exercises · next in your plan');
    assert.deepEqual(hero.querySelectorAll('.pv-home-note').map(text), ['Go a little easier today. Your morning check-in was a bit low, so no record attempts.', 'One swap: Single-leg dumbbell RDL instead of Romanian Deadlift.']);
    assert.equal(text(hero.querySelector('.pv-ring-l')!), 'THIS WEEK');
    assert.equal(text(hero.querySelector('.pv-ring-n')!), '3/4');
    assert.equal(text(hero.querySelector('.pv-home-ringline')!), 'Today’s session finishes the week');
    assert.equal(root.querySelector('[data-glance]'), null, 'no At a glance on Home');
  });

  it('Log session opens the Log panel; See the workout goes to Today', () => {
    const { root, calls } = draw('2026-04-10');
    click(root.querySelector('.pv-btn-go'));
    click(root.querySelector('.pv-btn-ghost'));
    assert.deepEqual(calls, ['log', 'today']);
  });

  it('Needs you: three rows, each to its tab, and the rest counted', () => {
    const { root, calls } = draw('2026-04-10');
    const card = root.querySelector('[data-home="needs"]')!;
    assert.equal(text(card.querySelector('.pv-home-count')!), '4');
    const rows = card.querySelector('.pv-home-todo')!.querySelectorAll('.pv-home-row');
    assert.deepEqual(rows.map((r) => text(r.querySelector('b')!)), ['Check-in for Sun 5 Apr not saved', 'Weekly check-in on Sunday', 'Tape measurements due']);
    assert.ok(rows[0]!.classList.contains('is-due'));
    for (const r of rows) click(r);
    assert.deepEqual(calls, ['checkin', 'checkin', 'progress-body']);
    // The fourth waits behind "Show 1 more"; a click shows it and the button goes.
    const rest = card.querySelector('.pv-home-rest')!;
    assert.equal(rest.hasAttribute('hidden'), true);
    const more = card.querySelector('.pv-home-more-n')!;
    assert.equal(text(more), 'Show 1 more');
    click(more);
    assert.equal(rest.hasAttribute('hidden'), false);
    assert.equal(card.querySelector('.pv-home-more-n'), null);
    const extra = rest.querySelectorAll('.pv-home-row');
    assert.equal(extra.length, 1);
    assert.match(text(extra[0]!.querySelector('b')!), /^Seated Cable Row: \d+ or \d+\?$/);
    click(extra[0]!);
    assert.equal(calls.at(-1), 'progress-training');
  });

  it('Needs you with nothing left: the quiet line, no count', () => {
    const { root } = draw('2026-04-10', { change: (h) => { h.needs.items = []; h.needs.rest = []; h.needs.more = 0; } });
    const card = root.querySelector('[data-home="needs"]')!;
    assert.equal(card.querySelector('.pv-home-row'), null);
    assert.equal(card.querySelector('.pv-home-count'), null);
    assert.equal(text(card.querySelector('.pv-home-quiet b')!), 'Nothing needs you today.');
    assert.equal(text(card.querySelector('.pv-home-quiet .tx')!), 'Nothing needs you today.You’re all caught up.');
    assert.ok(card.classList.contains('is-calm'), 'the calm card (its pattern and medallion)');
    assert.ok(root.querySelector('.pv-home-grid')!.classList.contains('is-calm'), 'Needs you narrows, Food and habits widens');
  });

  it('Food and habits: the protein target and the habits, each with its link', () => {
    const { root, calls } = draw('2026-04-10');
    const card = root.querySelector('[data-home="food"]')!;
    assert.deepEqual(card.querySelectorAll('.pv-home-kv .tx b').map(text), ['134 g protein', '1 of 7 habits done']);
    assert.equal(card.querySelectorAll('.pv-home-dots i').filter((i) => i.classList.contains('on')).length, 1);
    for (const l of card.querySelectorAll('.pv-home-link')) click(l);
    assert.deepEqual(calls, ['food', 'due']);
  });

  it('Progress: the lead in bold, three tiles with their small lines, each to Progress', () => {
    const { root, calls } = draw('2026-04-10');
    const card = root.querySelector('[data-home="progress"]')!;
    assert.ok(card.classList.contains('pv-home-wide'));
    assert.equal(text(card.querySelector('.pv-kicker')!), 'Progress · since 23 Feb');
    assert.equal(text(card.querySelector('.pv-home-lead b')!), 'You’re getting stronger and your weight is slowly coming down.');
    const tiles = card.querySelectorAll('.pv-home-tile');
    assert.deepEqual(tiles.map((t) => text(t.querySelector('.lb')!)), ['Strength', 'Body weight', 'Showing up']);
    assert.deepEqual(tiles.map((t) => text(t.querySelector('.big')!)), ['2 of 3 lifts up', '83.8 kg', '92 %']);
    // Each tile its own picture: an arrow per lift, the weight's line over its fill, a bar per week and the cycle's ring.
    assert.deepEqual(tiles[0]!.querySelectorAll('.pv-home-mark').map((m) => m.className.replace('pv-home-mark ', '')), ['is-up', 'is-stalled', 'is-up']);
    assert.equal(tiles[0]!.querySelectorAll('.pv-home-mark')[1]!.getAttribute('data-tip'), 'Flat DB Bench Press|Stopped going up');
    assert.ok(tiles[1]!.querySelector('.pv-home-area polygon') && tiles[1]!.querySelector('.pv-home-area polyline') && tiles[1]!.querySelector('.pv-home-area .end circle'));
    assert.equal(tiles[2]!.querySelectorAll('.pv-home-bars rect').length, 4);
    assert.equal(tiles[2]!.querySelector('.pv-home-ring .arc')!.getAttribute('stroke-dasharray'), '92 100');
    for (const t of tiles) click(t);
    click(card.querySelector('.pv-home-link'));
    assert.deepEqual(calls, ['progress', 'progress', 'progress', 'progress']);
  });

  it('Your tabs: five tiles in the tab bar’s order, each with its status, each opening its tab', () => {
    const { root, calls } = draw('2026-04-10');
    const card = root.querySelector('[data-home="tabs"]')!;
    const tiles = card.querySelectorAll('.pv-home-tab');
    assert.deepEqual(tiles.map((x) => text(x.querySelector('.nm')!)), ['Today', 'Progress', 'Plan', 'Check-in', 'Food']);
    assert.equal(text(tiles[2]!.querySelector('.now')!), 'Week 6 of 24 · light week in 2 weeks');
    assert.ok(tiles[1]!.classList.contains('is-warn'));
    assert.ok(tiles[3]!.classList.contains('is-due'));
    assert.ok(!tiles[0]!.classList.contains('is-due') && !tiles[0]!.classList.contains('is-warn'));
    assert.deepEqual(tiles.map((x) => x.className.match(/is-tab-(\w+)/)?.[1]), ['today', 'progress', 'plan', 'checkin', 'food'], 'each tile takes its tab’s accent');
    for (const x of tiles) click(x);
    assert.deepEqual(calls, ['today', 'progress', 'plan', 'checkin', 'food']);
  });

  it('rises in on the first draw only, on Home’s own wrapper (not the page every tab shares)', () => {
    const first = draw('2026-04-10', { intro: true }).root;
    assert.ok(!first.classList.contains('pv-home-intro'));
    assert.ok(first.querySelector('.pv-home')!.classList.contains('pv-home-intro'));
    assert.ok(!draw('2026-04-10', { intro: false }).root.querySelector('.pv-home')!.classList.contains('pv-home-intro'));
  });

  it('a tile with nothing yet says so', () => {
    const { root } = draw('2026-04-10', { change: (h) => { h.progress!.tiles[1] = { id: 'weight', label: 'Body weight', big: null, spark: [], line: 'No weigh-ins this cycle yet.' }; } });
    const tile = root.querySelectorAll('.pv-home-tile')[1]!;
    assert.equal(text(tile.querySelector('.big')!), 'Not yet');
    assert.equal(tile.querySelector('svg'), null);
  });

  it('without a plan: the welcome under the title, as on Today', () => {
    const { root } = draw('2026-04-10', { edit: (f) => delete f['v/3-Personal/Fitness/plan-data.json'], welcome: true });
    assert.equal(root.querySelector('.pv-hero'), null);
    assert.equal(text(root.querySelector('.pv-serif-title')!), 'Home');
    assert.ok(root.querySelector('.pv-welcome'), 'the welcome card');
  });
});
