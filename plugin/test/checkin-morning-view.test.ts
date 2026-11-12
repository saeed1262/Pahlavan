// Check-in's morning form drawn in Node with the small fake DOM: the Sleep
// field reads what the morning card reads ("7:20", "7h20" or "7.3"), and a
// value it can't read is marked, not saved; for an lb profile the weight
// shows in lb and is kept in kg.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { checkinWeek } from '../../src/report/banners.ts';
import { buildCheckin } from '../../src/report/index.ts';
import { IMPERIAL } from '../../src/core/units.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';
import { refreshCheckinState, renderCheckin, type CheckinContext } from '../src/ui/checkin.ts';
import { FakeElement, installFakeDom } from './fake-dom.ts';

installFakeDom();
const DATE = '2026-04-10';
const read = readVault(memoryIo(fixtureFiles('v'), DATE), 'v', { asOf: DATE });

function draw(over: Partial<CheckinContext> = {}) {
  const c = buildCheckin(read, DATE, null);
  const st = refreshCheckinState(null, c);
  const root = new FakeElement('div');
  const ctx: CheckinContext = { canWrite: true, hero: { phase: { id: 'workday', isfahan: false }, phaseOf: null, planWeek: 6, phaseNo: 1, week: checkinWeek(read, DATE), tape: null }, onChange: () => {}, onSaveMorning: () => {}, onSaveSunday: () => {}, ...over };
  renderCheckin(root as unknown as HTMLElement, c, st, ctx);
  return { root, st };
}
const type = (el: FakeElement, v: string) => {
  (el as unknown as { value: string }).value = v;
  for (const fn of el.listeners.get('change') ?? []) fn({ target: el });
};

describe('Check-in’s morning form', () => {
  it('Sleep takes "7:20" and "7.3", as the card does; a value it can’t read is marked and not kept', () => {
    const { root, st } = draw();
    const sleep = root.querySelector('[data-k="m-sleepH"]')!;
    assert.equal(sleep.getAttribute('type'), 'text');
    type(sleep, '7:20');
    assert.equal(st.morning.values.sleepH, 7.33);
    type(sleep, '6.5');
    assert.equal(st.morning.values.sleepH, 6.5);
    type(sleep, 'seven');
    assert.equal(st.morning.values.sleepH, 6.5);
    assert.ok(sleep.classList.contains('is-bad'));
  });

  it('the weight in lb for an lb profile, kept in kg', () => {
    const { root, st } = draw({ units: IMPERIAL });
    const w = root.querySelector('[data-k="m-weight"]')!;
    type(w, '184.1');
    assert.equal(st.morning.values.weight, 83.5);
  });

  it('HRV is typed in ms beside resting HR', () => {
    const { root, st } = draw();
    const hrv = root.querySelector('[data-k="m-hrv"]')!;
    assert.equal(hrv.getAttribute('aria-label'), 'HRV');
    type(hrv, '52');
    assert.equal(st.morning.values.hrv, 52);
    assert.equal(st.morning.dirty, true);
  });

  it('"I’m ill today" is one tap, shown in what Save will write, and a second tap takes it back', () => {
    let changes = 0;
    const c = buildCheckin(read, DATE, null);
    const st = refreshCheckinState(null, c);
    const ctx: CheckinContext = { canWrite: true, hero: { phase: { id: 'workday', isfahan: false }, phaseOf: null, planWeek: 6, phaseNo: 1, week: checkinWeek(read, DATE), tape: null }, onChange: () => void changes++, onSaveMorning: () => {}, onSaveSunday: () => {} };
    const render = () => {
      const root = new FakeElement('div');
      renderCheckin(root as unknown as HTMLElement, c, st, ctx);
      return root;
    };
    let root = render();
    const pill = () => root.querySelector('[data-k="m-ill"]')!;
    assert.equal(st.morning.ill, false);
    assert.equal(pill().getAttribute('aria-pressed'), 'false');
    for (const fn of pill().listeners.get('click') ?? []) fn({ target: pill() });
    assert.equal(st.morning.ill, true);
    root = render();
    assert.equal(pill().getAttribute('aria-pressed'), 'true');
    assert.ok(root.textContent.includes('To save: ill today.'), root.textContent);
    assert.ok(root.textContent.includes('No hard training today'));
    for (const fn of pill().listeners.get('click') ?? []) fn({ target: pill() });
    root = render();
    assert.equal(st.morning.ill, false);
    assert.ok(root.textContent.includes('Nothing changed yet.'));
    assert.equal(changes, 2);
  });
});
