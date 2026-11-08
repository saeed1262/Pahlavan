// A timed interval item on Today and in the Log panel, drawn in Node with the
// small fake DOM: the structure in words where a lift shows its sets and
// reps ("4 × 4 min hard, 3 min easy between · about 25 min"), never "sets:
// 11"; in the calibration week, the easy minutes with the rule's line as the
// row's cue, and the same line under the Log panel's dose.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { buildToday, logFormFor } from '../../src/report/index.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';
import { freshPanelState, renderLogPanel } from '../src/ui/log-panel.ts';
import { renderToday, type TodayContext } from '../src/ui/today.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';

installFakeDom();
const PLAN = 'v/3-Personal/Fitness/plan-data.json';
const WEEK_1 = '2026-03-07';
const LATER = '2026-04-10';
/** Written before the fields: the minutes in sr, the intervals in the note, no week-1 text. */
const ITEM = { name: 'Uphill intervals, 4 x 4 min', table: 'Intervals', sr: '22 min', rest: '—', note: '4 × 4 min hard, 3 min easy between, warm-up and cool-down easy. Why: you chose intervals.', label: 'Intervals' };

function readAt(date: string) {
  const f = fixtureFiles('v');
  const doc = JSON.parse(f[PLAN]!);
  doc.shortTypes = ['S1', 'S2', 'S3'];
  doc.titles = { ...doc.titles, S2: 'Intervals' };
  doc.sessions.S2 = [ITEM];
  f[PLAN] = `${JSON.stringify(doc, null, 2)}\n`;
  return readVault(memoryIo(f, date), 'v', { asOf: date });
}

function draw(date: string) {
  const read = readAt(date);
  const m = buildToday(read, date, 'full', 'v', { type: 'S2' });
  const ctx: TodayContext = { mode: 'full', session: m.session, phase: { id: 'workday', isfahan: false }, open: new Set(), pick: 'S2', onMode: () => {}, onPick: () => {}, onToggleWhy: () => {}, onLog: () => {}, onEditSession: () => {} };
  const root = new FakeElement('div');
  renderToday(root as unknown as HTMLElement, m, ctx);
  const layer = new FakeElement('div');
  const form = logFormFor(read, m.session!, date)!;
  renderLogPanel(layer as unknown as HTMLElement, { form, state: freshPanelState(), plan: read.raw!.plan, log: read.raw!.log, today: date, onChange: () => {}, onClose: () => {}, onRebuild: () => {}, onDate: () => {}, onSave: () => {}, onDelete: () => {}, onEditExisting: () => {}, onUseDisk: () => {} });
  const row = root.querySelectorAll('.pv-ex')[0]!;
  const item = layer.querySelectorAll('.pv-lg-item').find((li) => /Uphill intervals/.test(text(li.querySelector('.pv-lg-name-line')!)))!;
  return { row, item };
}

describe('Today and the Log panel: an interval item', () => {
  it('says the structure in words, not its minutes as sets', () => {
    const { row, item } = draw(LATER);
    assert.equal(text(row.querySelector('.pv-ex-target')!), '4 × 4 min hard, 3 min easy between · about 25 min');
    assert.equal(text(row.querySelector('.pv-ex-cue')!), '4 × 4 min hard, 3 min easy between, warm-up and cool-down easy.');
    assert.equal(text(item.querySelector('.pv-lg-dose')!), '4 × 4 min hard, 3 min easy between · about 25 min');
    assert.equal(item.querySelector('.pv-lg-hint'), null);
    assert.doesNotMatch(text(row), /\b11\b/);
  });

  it('in the calibration week: the easy minutes, with the rule’s line on Today and under the Log panel’s dose', () => {
    const { row, item } = draw(WEEK_1);
    assert.equal(text(row.querySelector('.pv-ex-target')!), '25 min');
    assert.equal(text(row.querySelector('.pv-ex-cue')!), 'Easy, conversational; the intervals start in week 2.');
    assert.equal(text(item.querySelector('.pv-lg-dose')!), '25 min');
    assert.equal(text(item.querySelector('.pv-lg-hint')!), 'Easy, conversational; the intervals start in week 2.');
  });
});
