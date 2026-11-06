// Progress's sections drawn in Node with a small fake DOM, on the synthetic
// vault (made-up data): the two-column layouts as independent columns (a
// short card never leaves a gap beside a tall one), with the reading order
// kept for narrow panes, where the columns dissolve.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { buildProgressMore } from '../../src/report/index.ts';
import { renderMore, type MoreContext } from '../src/ui/progress-more.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';
import { FIX } from './mem-vault.ts';

const io = { readText: (p: string) => (existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null), listDir: (p: string) => (existsSync(p) && statSync(p).isDirectory() ? readdirSync(p) : null) };
const DATE = '2026-04-10';
const more = buildProgressMore(readVault(io, FIX, { asOf: DATE }), DATE);
const ctx: MoreContext = {
  view: 'week',
  tables: new Set(),
  onView() {},
  onTable() {},
  sessionsView: 'weeks',
  onSessionsView() {},
  health: 'rhr',
  onHealth() {},
  photo: { a: null, b: null, pose: 'front', mode: 'side', pos: 50, opacity: 50 },
  onPhoto() {},
  photoFiles: {},
  resourcePath: null,
} as unknown as MoreContext;

// Each test file runs in its own process, so the fake stays installed for this one.
installFakeDom();

const draw = (section: 'training' | 'body', total = 1200): FakeElement => {
  const grid = new FakeElement('div');
  renderMore(grid as unknown as HTMLElement, section, more, total, ctx, () => null);
  return grid;
};
const kicker = (card: FakeElement) => text(card.querySelector('.pv-kicker')!);

describe('Progress: two-column sections as independent columns', () => {
  it('Training: Records over Sessions on the left, Every lift over Cardio on the right', () => {
    const grid = draw('training');
    const cols = grid.children.filter((c) => c.classList.contains('pv-col'));
    assert.equal(cols.length, 2);
    assert.deepEqual(cols.map((c) => c.className), ['pv-span-7 pv-stack pv-col', 'pv-span-5 pv-stack pv-col']);
    assert.deepEqual(cols.map((c) => c.children.map(kicker)), [['Records and milestones', 'Sessions'], ['Every lift', 'Cardio minutes']]);
  });

  it('keeps the reading order for a narrow pane: Records, Every lift, Sessions, Cardio', () => {
    const cards = draw('training').querySelectorAll('.pv-card').filter((c) => c.style['order']);
    const order = [...cards].sort((a, b) => Number(a.style['order']) - Number(b.style['order'])).map(kicker);
    assert.deepEqual(order, ['Records and milestones', 'Every lift', 'Sessions', 'Cardio minutes']);
  });

  it('Body: the tape and the targets side by side in their own columns, the photos below across', () => {
    const grid = draw('body');
    const cols = grid.children.filter((c) => c.classList.contains('pv-col'));
    assert.equal(cols.length, 2);
    assert.equal(cols[0]!.children.length, 1);
    assert.equal(cols[1]!.children.length, 1);
    assert.ok(grid.children.at(-1)!.classList.contains('pv-span-12'), 'the photos span the width');
  });

  it('the stylesheet dissolves the columns on a narrow pane', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url).pathname, 'utf8');
    const narrow = css.slice(css.indexOf('@container pahlavan (max-width: 760px) {'));
    assert.match(narrow.slice(0, narrow.indexOf('\n}')), /\.pahlavan-view \.pv-col \{ display: contents; \}/);
  });
});

describe('Progress: Every lift', () => {
  const card = () => draw('training').querySelectorAll('.pv-card').find((c) => kicker(c) === 'Every lift')!;

  it('gives each name its own line, the last set under it, and the change beside both', () => {
    const rows = card().querySelectorAll('.pv-ev-row');
    assert.ok(rows.length >= 4);
    const bench = rows.find((r) => text(r.querySelector('.pv-ev-name')!) === 'Flat DB Bench Press')!;
    assert.equal(text(bench.querySelector('.pv-ev-last')!), '60 lb × 5 · Wed 8 Apr');
    const css = readFileSync(new URL('../styles.css', import.meta.url).pathname, 'utf8');
    assert.match(css, /\.pv-ev-row > \.pv-ev-name \{ grid-column: 1; grid-row: 1; \}/);
    assert.match(css, /\.pv-ev-row > \.pv-ev-last \{ grid-column: 1; grid-row: 2;/);
  });

  it('ends with a key, not a line that reads like data', () => {
    const k = card().querySelector('.pv-chart-key')!;
    assert.deepEqual(k.children.map(text), ['The change since week 1', '↑up over 3 or more sets', '↓down over 3 or more sets', '±no arrow: under 3 sets, not called yet', '–nothing to compare yet']);
    assert.doesNotMatch(text(k), /\d+ (lb|kg)/);
  });
});


describe('Health: the daily chart stays inside its box', () => {
  // Two flat readings, no goal: the y range must not shrink to hundredths, and a band must fit it.
  const flat = structuredClone(more);
  const rhr = flat.health!.rhr!;
  rhr.series = rhr.series.slice(-2).map((p) => ({ ...p, value: 63, avg7: 63 }));
  rhr.last = rhr.series.at(-1)!.date;
  flat.health!.goals.rhr = null;
  const chart = (base: { mean: number; sd: number; days: number } | null) => {
    const grid = new FakeElement('div');
    renderMore(grid as unknown as HTMLElement, 'health', flat, 1200, ctx, () => base);
    return grid.querySelectorAll('svg.pv-chart').find((x) => x.getAttribute('aria-label') === 'Resting HR per day')!;
  };

  it('a flat series gets a whole-number axis, not 62.95 to 63.05', () => {
    const ticks = chart(null).querySelectorAll('text.pv-ax.end').map(text).filter((t) => /^[\d.]+$/.test(t));
    assert.ok(ticks.length >= 2 && ticks.every((t) => Number.isInteger(Number(t))), ticks.join(', '));
  });

  it('no usual-range band before the 14-morning baseline; once there, it fits the chart', () => {
    assert.equal(chart({ mean: 63, sd: 3, days: 1 }).querySelectorAll('rect.pv-c-band').length, 0);
    const svg = chart({ mean: 60, sd: 3, days: 20 });
    const band = svg.querySelector('rect.pv-c-band')!;
    const H = Number(svg.getAttribute('viewBox')!.split(' ')[3]);
    const top = Number(band.getAttribute('y'));
    assert.ok(top >= 0 && top + Number(band.getAttribute('height')) <= H, `band ${top}+${band.getAttribute('height')} in ${H}`);
  });
});
