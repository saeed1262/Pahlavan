// Progress's sections drawn in Node with a small fake DOM, on the synthetic
// vault (made-up data): the two-column layouts as independent columns (a
// short card never leaves a gap beside a tall one), with the reading order
// kept for narrow panes, where the columns dissolve; and the body map's
// direct and half-credit split and its Regions list.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { buildProgress, buildProgressMore } from '../../src/report/index.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';
import { renderMore, type MoreContext } from '../src/ui/progress-more.ts';
import { REGIONS_OPEN, renderProgress, type ProgressContext, type VolumeView } from '../src/ui/progress.ts';
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

  it('keeps the reading order for a narrow pane: no columns, Records, Every lift, Sessions, Cardio', () => {
    const grid = draw('training', 700);
    assert.equal(grid.children.filter((c) => c.classList.contains('pv-col')).length, 0);
    assert.deepEqual(grid.children.filter((c) => c.classList.contains('pv-card')).map(kicker), ['Records and milestones', 'Every lift', 'Sessions', 'Cardio minutes']);
  });

  it('Body on a narrow pane: the tape, the targets, then the photos, one under the other', () => {
    const grid = draw('body', 700);
    assert.equal(grid.children.filter((c) => c.classList.contains('pv-col')).length, 0);
    assert.ok(grid.children.at(-1)!.classList.contains('pv-span-12'), 'the photos last');
  });

  it('Body: the tape and the targets side by side in their own columns, the photos below across', () => {
    const grid = draw('body');
    const cols = grid.children.filter((c) => c.classList.contains('pv-col'));
    assert.equal(cols.length, 2);
    assert.equal(cols[0]!.children.length, 1);
    assert.equal(cols[1]!.children.length, 1);
    assert.ok(grid.children.at(-1)!.classList.contains('pv-span-12'), 'the photos span the width');
  });

  it('the stylesheet stacks any columns on a narrow pane (the Plan screen’s), across the width', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url).pathname, 'utf8');
    const narrow = css.slice(css.indexOf('@container pahlavan (max-width: 760px) {'));
    assert.match(narrow.slice(0, narrow.indexOf('\n}')), /\.pahlavan-view \.pv-stack\.pv-col \{ grid-column: 1 \/ -1; \}/);
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

describe('Progress: the body map\'s split and regions', () => {
  /** The Weekly sets card, drawn for a view, with toggles open and regions declared weak (made up). */
  const bodyCard = (view: VolumeView, open: string[] = [], regions?: string[], machines = true): FakeElement => {
    let pm = buildProgress(readVault(io, FIX, { asOf: DATE }), DATE, FIX);
    if (regions) {
      const files = fixtureFiles('v');
      const at = 'v/3-Personal/Fitness/Coach/profile.json';
      const profile = JSON.parse(files[at]!);
      // With a machine unless `machines` is false: the leg extension is the rectus femoris's only option.
      files[at] = JSON.stringify({ ...profile, priorityRegions: regions, equipment: machines ? [...profile.equipment, 'machines'] : profile.equipment });
      pm = buildProgress(readVault(memoryIo(files, DATE), 'v', { asOf: DATE }), DATE);
    }
    const c: ProgressContext = { view, tables: new Set(open), onView() {}, onTable() {} };
    const root = new FakeElement('div');
    renderProgress(root as unknown as HTMLElement, pm, c, { hero: { phase: { id: 'workday', isfahan: false }, phaseOf: null, waist: null } });
    return root.querySelector('[data-sec="sets"]')!;
  };
  const tipOf = (card: FakeElement, muscle: string) => card.querySelector(`.pv-bm-muscle[data-muscle="${muscle}"]`)!.getAttribute('data-tip')!.split('|');

  it('the tooltip splits the sets into direct and half credit, then lists the muscle\'s regions', () => {
    const lines = tipOf(bodyCard('week'), 'shoulders');
    assert.deepEqual(lines.slice(0, 3), ['Shoulders', '3.5 sets a week (this week)', '0 direct, 3.5 half credit from helping lifts']);
    assert.deepEqual(lines.slice(lines.indexOf('§Regions')), ['§Regions', 'Front delts\t3.5 (0 direct)', 'Side delts\t0', 'Rear delts (rough guide)\t0']);
    assert.ok(!tipOf(bodyCard('week'), 'biceps').includes('§Regions'), 'no region rows for a muscle with none');
    // The plan's view: its own split, and the upper back's rough-guide regions.
    const ub = tipOf(bodyCard('plan'), 'upper-back');
    assert.ok(ub.includes('9 direct, 4.5 half credit from helping lifts'), ub.join('\n'));
    assert.ok(ub.includes('Mid-back (rough guide)\t9'), ub.join('\n'));
  });

  it('the Regions list is folded to one line by default, under the statuses', () => {
    const list = bodyCard('week').querySelector('.pv-bm-side .pv-bm-regions')!;
    const head = list.querySelector('.pv-bm-regions-head')!;
    assert.equal(head.getAttribute('aria-expanded'), 'false');
    // Nothing held to a rule here: the line counts the muscles listed.
    assert.equal(text(head), 'Regions4 muscles');
    assert.equal(list.querySelectorAll('.pv-bm-reg-group').length, 0);
  });

  it('opened, it groups the regions by muscle, leaving out a muscle with no tagged region', () => {
    const card = bodyCard('week', [REGIONS_OPEN]);
    const groups = card.querySelectorAll('.pv-bm-reg-group');
    // The chest's upper chest, the triceps' long head and the calves' regions have no sets and no rule: left out.
    assert.deepEqual(groups.map((g) => text(g.querySelector('.pv-bm-reg-muscle')!)), ['Shoulders', 'Upper back', 'Quads', 'Hamstrings']);
    const rows = card.querySelectorAll('.pv-bm-reg');
    const row = (id: string) => rows.find((r) => r.getAttribute('data-region') === id)!;
    assert.equal(text(row('hamstrings-hip')), 'Hip extension3');
    assert.equal(text(row('shoulders-rear')), 'Rear deltsrough guide0');
    // Nothing is held to a rule here: no chips.
    assert.equal(card.querySelectorAll('.pv-bm-reg .pv-status').length, 0);
    assert.match(row('quads-vasti').getAttribute('data-tip')!, /^Vasti\|7 sets a week \(this week\)\|7 direct, 0 half credit from helping lifts\|Evidence: moderate\|Vasti: 7 direct sets a week/);
  });

  it('a declared region is starred, and a region held to a rule gets an under or ok chip', () => {
    const card = bodyCard('week', [REGIONS_OPEN], ['quads-vasti']);
    assert.equal(text(card.querySelector('.pv-bm-regions-sum')!), '1 under');
    const row = (id: string) => card.querySelector(`.pv-bm-reg[data-region="${id}"]`)!;
    assert.ok(row('quads-vasti').classList.contains('is-declared'));
    assert.ok(row('quads-vasti').querySelector('.pv-bm-reg-star'));
    assert.equal(text(row('quads-vasti').querySelector('.pv-status')!), 'OK');
    assert.equal(text(row('quads-rf').querySelector('.pv-status')!), 'Under');
    assert.ok(row('quads-rf').querySelector('.pv-status')!.classList.contains('is-below'));
    assert.equal(row('quads-rf').querySelector('.pv-bm-reg-star'), null);
    assert.match(text(card.querySelector('.pv-bm-reg-key')!), /4 direct sets a week for a priority muscle’s region, 6 near failure for one you declared weak/);
    // The tooltip says the same, starred.
    const lines = tipOf(card, 'quads');
    assert.deepEqual(lines.slice(lines.indexOf('§Regions')), ['§Regions', 'Rectus femoris\t0, under 4', '★ Vasti\t7, ok']);
  });

  it('a short region with no option for the equipment says so instead of under, and a declared one says it to a screen reader', () => {
    const card = bodyCard('week', [REGIONS_OPEN], ['quads-vasti'], false);
    assert.equal(text(card.querySelector('.pv-bm-regions-sum')!), '1 with no option');
    const rf = card.querySelector('.pv-bm-reg[data-region="quads-rf"]')!;
    assert.equal(text(rf.querySelector('.pv-status')!), 'No option');
    assert.ok(rf.querySelector('.pv-status')!.classList.contains('is-neutral'));
    assert.match(rf.getAttribute('data-tip')!, /No catalogue movement that biases it fits your equipment/);
    assert.match(text(card.querySelector('.pv-bm-reg-key')!), /No option: nothing in the catalogue that biases it fits your equipment/);
    const lines = tipOf(card, 'quads');
    assert.deepEqual(lines.slice(lines.indexOf('§Regions')), ['§Regions', 'Rectus femoris\t0, no option you can do now', '★ Vasti\t7, ok']);
    // The star is drawn only: the declared row carries the words for a screen reader.
    const vasti = card.querySelector('.pv-bm-reg[data-region="quads-vasti"]')!;
    assert.equal(text(vasti.querySelector('.pv-vh')!), '(declared weak)');
    assert.equal(rf.querySelector('.pv-vh'), null);
    const css = readFileSync(new URL('../styles.css', import.meta.url).pathname, 'utf8');
    assert.match(css, /\.pv-vh \{ position: absolute; width: 1px; height: 1px;/);
  });

  it('the table has a Regions column saying the same', () => {
    const rows = bodyCard('week', ['body'], ['quads-vasti']).querySelectorAll('.pv-table-area tr').map(text);
    assert.ok(rows[0]!.includes('Regions'));
    assert.ok(rows.some((r) => r.startsWith('Quads') && r.includes('Rectus femoris 0, under 4; ★ Vasti 7, ok')), rows.join('\n'));
  });

  it('the stylesheet keeps the folded list to one line and lines the sets up at the right', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url).pathname, 'utf8');
    assert.match(css, /\.pv-bm-side li\.pv-bm-reg \{ display: grid; grid-template-columns: minmax\(0, 1fr\) auto 30px;/);
    assert.match(css, /\.pv-bm-regions\.is-open \.pv-bm-regions-head svg \{ transform: rotate\(180deg\); \}/);
  });
});
