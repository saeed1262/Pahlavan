// The Plan screen's Sets per muscle card: a priority muscle's direct sets
// near failure beside its total, and the flag when they are under 10, drawn
// in Node with the small fake DOM on the synthetic vault's ab work; and a
// region declared weak, its own line against its aim, with every region of
// a muscle in the bar's tooltip.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { buildPlan } from '../../src/report/index.ts';
import { applyAbWork } from '../../test/fixtures/ab-work.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';
import { directLine, renderPlan } from '../src/ui/plan.ts';
import { regionAim, regionValue, type RegionRow } from '../src/ui/regions.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';

installFakeDom();
const DATE = '2026-04-10';

function card(which: 'old' | 'new' | null, regions?: string[]) {
  const files = fixtureFiles('v');
  if (which) applyAbWork(files, which, 'v');
  if (regions) {
    // Made up: regions the person declares weak.
    const at = 'v/3-Personal/Fitness/Coach/profile.json';
    const profile = JSON.parse(files[at]!);
    // With a machine, so the rectus femoris has an option (the leg extension) and a short one reads as under.
    files[at] = JSON.stringify({ ...profile, priorityRegions: regions, equipment: [...profile.equipment, 'machines'] });
  }
  const p = buildPlan(readVault(memoryIo(files, DATE), 'v', { asOf: DATE }), DATE);
  assert.ok('volume' in p);
  const root = new FakeElement('div');
  renderPlan(root as unknown as HTMLElement, p, { view: 'week', tables: new Set(), onView: () => {}, onTable: () => {}, hero: { phase: { id: 'workday', isfahan: false }, phaseOf: null, weekTarget: null } });
  return root.querySelector('[data-sec="vol"]')!;
}

describe('the Sets per muscle card: direct sets near failure', () => {
  it('flags a priority muscle short of them, beside its total', () => {
    const vol = card('old');
    const subs = vol.querySelectorAll('.pv-vsub');
    const abs = subs.find((x) => /direct, near failure/.test(text(x)) && x.classList.contains('is-under'))!;
    assert.ok(abs, 'the abs line is drawn and flagged');
    assert.equal(text(abs), '15 · 8 direct, near failure: under 10');
    // The table says the same in words, and the status names the reason.
    const rows = vol.querySelectorAll('tr').map(text);
    assert.ok(rows.some((r) => r.startsWith('Abs (priority)') && r.includes('15 · 8 direct, near failure') && r.includes('Too few direct sets near failure')), rows.join('\n'));
    // The bar's tooltip has the split.
    assert.ok(vol.querySelectorAll('.pv-vbar').some((b) => /Abs \(priority\)\|15 planned sets a week\|10 direct, 5 from helping \(half credit\)\|8 direct, near failure\|Too few direct sets near failure/.test(b.getAttribute('data-tip') ?? '')));
    assert.doesNotMatch(text(vol), /—/);
  });

  it('shows the count without the flag when the minimum is met', () => {
    const vol = card('new');
    const abs = vol.querySelectorAll('.pv-vsub').find((x) => text(x).startsWith('18 ·'))!;
    assert.equal(text(abs), '18 · 12 direct, near failure');
    assert.ok(!abs.classList.contains('is-under'));
  });

  it('says it in plain words, and nothing for a muscle that is not a priority', () => {
    assert.equal(directLine({ priority: true, hardDirect: 9, unknown: 3 }), '9 direct, near failure, 3 of unknown effort');
    assert.equal(directLine({ priority: false, hardDirect: 9, unknown: 0 }), null);
    assert.equal(directLine({ priority: true }), null);
  });
});

describe('the Sets per muscle card: regions', () => {
  it('draws a declared region on its own line under its muscle, against its aim', () => {
    const vol = card(null, ['quads-vasti']);
    const lines = vol.querySelectorAll('.pv-vsub-region');
    assert.deepEqual(lines.map(text), ['Vasti: 10.5 direct, aim 6']);
    assert.ok(!lines[0]!.classList.contains('is-under'));
    assert.equal(lines[0]!.getAttribute('data-region'), 'quads-vasti');
    // The key says what the line is; the table has the region as a row of its own.
    assert.match(text(vol.querySelector('.pv-chart-key')!), /A region you declared weak has its own line: 6 direct sets near failure a week/);
    const rows = vol.querySelectorAll('tr').map(text);
    assert.ok(rows.includes('Vasti (declared weak)10.5 direct, aim 6Meets its aim'), rows.join('\n'));
    assert.doesNotMatch(text(vol), /—/);
  });

  it('flags a declared region short of its aim', () => {
    const line = card(null, ['shoulders-side']).querySelector('.pv-vsub-region')!;
    assert.equal(text(line), 'Side delts: 0 direct, under the aim of 6');
    assert.ok(line.classList.contains('is-under'));
  });

  it('lists every region of the muscle in its bar\'s tooltip, a rough guide marked', () => {
    const vol = card(null, ['quads-vasti']);
    const tipOf = (muscle: string) => vol.querySelector(`.pv-vbar[data-muscle="${muscle}"]`)!.getAttribute('data-tip')!;
    assert.match(tipOf('quads'), /\|§Regions\|Rectus femoris\t0, under 4\|★ Vasti\t10\.5, ok$/);
    assert.match(tipOf('shoulders'), /\|§Regions\|Front delts\t3\.3 \(0 direct\)\|Side delts\t0\|Rear delts \(rough guide\)\t2\.3 \(0 direct\)$/);
    assert.doesNotMatch(tipOf('biceps'), /Regions/);
  });

  it('draws no region line when nothing is declared', () => {
    assert.equal(card(null).querySelectorAll('.pv-vsub-region').length, 0);
  });

  it('words a declared region whose rule counts fewer sets than its direct ones', () => {
    const r: RegionRow = { id: 'shoulders-side', label: 'Side delts', sets: 8, direct: 8, indirect: 0, grade: 'weak', roughGuide: false, coverage: true, declared: true, rule: 'declared', min: 6, counted: 5, status: 'short', note: null };
    assert.equal(regionAim(r), 'Side delts: 5 of 8 direct near failure, under the aim of 6');
    assert.equal(regionValue(r), '8 (5 of 8 direct near failure), under 6');
    assert.equal(regionAim({ ...r, rule: null, min: null, counted: null, status: 'reported' }), null);
  });
});
