// The Plan screen's Sets per muscle card: the pull-to-push line under the
// chart, drawn in Node with the small fake DOM.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { buildPlan } from '../../src/report/index.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';
import { pullPushLine, renderPlan } from '../src/ui/plan.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';

installFakeDom();
const DATE = '2026-04-10';
const read = readVault(memoryIo(fixtureFiles('v'), DATE), 'v', { asOf: DATE });

describe('the Sets per muscle card: pull to push', () => {
  it('reads the planned week\'s pulling and pushing sets against the posture emphasis, the rule id kept out of the text', () => {
    const p = buildPlan(read, DATE);
    assert.ok('volume' in p);
    const root = new FakeElement('div');
    renderPlan(root as unknown as HTMLElement, p, { view: 'week', tables: new Set(), onView: () => {}, onTable: () => {}, hero: { phase: { id: 'workday', isfahan: false }, phaseOf: null, weekTarget: null } });
    const card = root.querySelector('[data-sec="vol"]')!;
    const line = card.querySelector('.pv-pull-push')!;
    assert.ok(line, 'the line is in the card');
    const pp = p.volume!.pullPush;
    assert.ok(line.classList.contains(`is-${pp.status}`));
    assert.match(text(line), /^Pull to push: [\d.]+ pulling to [\d.]+ pushing sets a week/);
    assert.equal(line.getAttribute('data-rule'), 'volume.pull-push');
    assert.doesNotMatch(text(line), /volume\.pull-push|—/);
  });

  it('says each status in plain words', () => {
    type Line = Parameters<typeof pullPushLine>[0] & object;
    const base: Omit<Line, 'status'> = { pull: 21, push: 12, ratio: 1.75, target: 2, floor: 1.8, note: 'n', rule: 'volume.pull-push' };
    const say = (x: Partial<Line> & Pick<Line, 'status'>) => text(pullPushLine({ ...base, ...x }) as unknown as FakeElement);
    assert.equal(say({ status: 'below' }), 'Pull to push: 21 pulling to 12 pushing sets a week (1.75 to 1), under the 1.8 the posture emphasis asks for (about 2 to 1).');
    assert.equal(say({ status: 'ok', pull: 24, ratio: 2 }), 'Pull to push: 24 pulling to 12 pushing sets a week (2 to 1). The posture emphasis asks for about 2 to 1, at least 1.8.');
    assert.equal(say({ status: 'no-target', target: null, floor: null }), 'Pull to push: 21 pulling to 12 pushing sets a week (1.75 to 1). No target without a posture emphasis.');
    assert.equal(say({ status: 'no-pushing', push: 0, ratio: null }), 'Pull to push: 21 pulling to 0 pushing sets a week.');
    assert.equal(pullPushLine(undefined), null);
  });
});
