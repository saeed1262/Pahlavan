// The Log panel's weight stepper on the gym's real weights (the profile's
// loads), drawn in Node with the small fake DOM: − and + walk to the
// previous and next weight the gym has; without loads, the lift's step.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { buildSession, logFormFor, type LogForm } from '../../src/report/index.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';
import { freshPanelState, renderLogPanel } from '../src/ui/log-panel.ts';
import { FakeElement, installFakeDom } from './fake-dom.ts';

installFakeDom();
const PROFILE = 'v/3-Personal/Fitness/Coach/profile.json';
const DATE = '2026-04-10';
const BENCH = 'Flat DB Bench Press';

function formWith(loads?: unknown): { form: LogForm; read: ReturnType<typeof readVault> } {
  const f = fixtureFiles('v');
  if (loads) {
    const p = JSON.parse(f[PROFILE]!);
    p.loads = loads;
    f[PROFILE] = JSON.stringify(p);
  }
  const read = readVault(memoryIo(f, DATE), 'v', { asOf: DATE });
  return { read, form: logFormFor(read, buildSession(read.data, DATE, 'full', { type: 'A' }), DATE)! };
}

/** Draws the panel and presses a row's top-set weight button ("More" or "Less") once; the row's top weight after. */
function press(read: ReturnType<typeof readVault>, form: LogForm, name: string, which: 'More' | 'Less'): number | null {
  const layer = new FakeElement('div');
  renderLogPanel(layer as unknown as HTMLElement, { form, state: freshPanelState(), plan: read.raw!.plan, log: read.raw!.log, today: DATE, onChange: () => {}, onClose: () => {}, onRebuild: () => {}, onDate: () => {}, onSave: () => {}, onDelete: () => {}, onEditExisting: () => {}, onUseDisk: () => {} });
  const i = form.rows.findIndex((r) => r.name === name);
  const li = layer.querySelectorAll('.pv-lg-item')[i]!;
  const button = li.querySelectorAll('button').find((b) => b.getAttribute('aria-label') === `${which} top-set weight`)!;
  assert.ok(button, `${name}: the ${which} button`);
  for (const fn of button.listeners.get('click') ?? []) fn({ target: button } as unknown as Event);
  return form.rows[i]!.top.weight;
}

describe('the Log panel: the weight stepper walks the gym\'s real weights', () => {
  it('the row carries the weights, and − and + go to the previous and next one', () => {
    const { read, form } = formWith({ unit: 'lb', dumbbell: { weights: [40, 45, 50, 52.5, 55, 60] } });
    const row = form.rows.find((r) => r.name === BENCH)!;
    assert.deepEqual(row.weights, [40, 45, 50, 52.5, 55, 60]);
    row.top.weight = 50;
    assert.equal(press(read, form, BENCH, 'More'), 52.5);
    assert.equal(press(read, form, BENCH, 'More'), 55);
    assert.equal(press(read, form, BENCH, 'Less'), 52.5);
    // A typed weight between two walks to its neighbour; the ends hold.
    row.top.weight = 47;
    assert.equal(press(read, form, BENCH, 'Less'), 45);
    row.top.weight = 60;
    assert.equal(press(read, form, BENCH, 'More'), 60);
    row.top.weight = null;
    assert.equal(press(read, form, BENCH, 'More'), 40, 'empty: the lightest');
  });

  it('without loads: the lift\'s step, as before', () => {
    const { read, form } = formWith();
    const row = form.rows.find((r) => r.name === BENCH)!;
    assert.equal(row.weights, undefined);
    assert.equal(row.step, 5);
    row.top.weight = 50;
    assert.equal(press(read, form, BENCH, 'More'), 55);
    assert.equal(press(read, form, BENCH, 'Less'), 50);
  });
});
