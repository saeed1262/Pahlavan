// The Plan screen's Sets per muscle card: a priority muscle's direct sets
// near failure beside its total, and the flag when they are under 10, drawn
// in Node with the small fake DOM on the synthetic vault's ab work.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { buildPlan } from '../../src/report/index.ts';
import { applyAbWork } from '../../test/fixtures/ab-work.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';
import { directLine, renderPlan } from '../src/ui/plan.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';

installFakeDom();
const DATE = '2026-04-10';

function card(which: 'old' | 'new') {
  const files = fixtureFiles('v');
  applyAbWork(files, which, 'v');
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
