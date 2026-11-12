// HRV on Today, drawn in Node with the small fake DOM: its row among the
// readiness inputs (in ms, against your own usual range), and the HRV note
// when it is low two mornings running. The note alone changes nothing (a
// quiet line, and no hard-training stop); with a low score it is named in the
// no-hard-training action instead. Without HRV, no row and no note.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { buildToday } from '../../src/report/index.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';
import { renderToday, type TodayContext } from '../src/ui/today.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';

installFakeDom();
const BODY = 'v/3-Personal/Fitness/body-data.json';

/** The fixture's mornings with HRV about 60 ms, and `low` ms on the given days. */
function draw(date: string, lowDays: string[], hrv = true) {
  const f = fixtureFiles('v');
  const body = JSON.parse(f[BODY]!);
  for (const [d, e] of Object.entries(body.days as Record<string, Record<string, unknown>>)) {
    if (hrv && typeof e['rhr'] === 'number') e['hrv'] = lowDays.includes(d) ? 44 : 58 + (Number(d.slice(8)) % 5);
  }
  f[BODY] = JSON.stringify(body);
  const read = readVault(memoryIo(f, date), 'v', { asOf: date });
  const m = buildToday(read, date, 'full', 'v');
  const ctx: TodayContext = { mode: 'full', session: m.session, phase: { id: 'workday', isfahan: false }, open: new Set(['readiness']), pick: null, onMode: () => {}, onPick: () => {}, onToggleWhy: () => {}, onLog: () => {}, onEditSession: () => {} };
  const root = new FakeElement('div');
  renderToday(root as unknown as HTMLElement, m, ctx);
  const card = root.querySelector('[data-sec="readiness"]')!;
  return { m, card, rows: card.querySelectorAll('.pv-input-row').map(text), actions: card.querySelectorAll('.pv-action').map(text) };
}

describe('Today: HRV in readiness', () => {
  it('a row in ms; low two mornings running on an ordinary day is a quiet note, and hard training stays on', () => {
    const { m, rows, actions } = draw('2026-04-08', ['2026-04-07', '2026-04-08']);
    assert.notEqual(m.review!.readiness.today.value.band, 'low');
    const row = rows.find((r) => r.startsWith('HRV'));
    assert.ok(row, rows.join(' | '));
    assert.match(row!, /44 ms/);
    assert.match(actions[0]!, /^HRV low two mornings running/);
    assert.match(actions[0]!, /a note only/);
    assert.ok(!actions.some((a) => /^No hard training/.test(a)), actions.join(' | '));
  });

  it('with a low score: no hard training, the action names HRV, and no second note', () => {
    const { actions } = draw('2026-04-10', ['2026-04-09', '2026-04-10']);
    assert.ok(actions.some((a) => /^No hard training/.test(a) && /HRV 20% or more under its 28-day baseline two mornings running, with a low score/.test(a)), actions.join(' | '));
    assert.ok(!actions.some((a) => /^HRV low two mornings running/.test(a)));
  });

  it('without HRV: no row and no note', () => {
    const { rows, actions } = draw('2026-04-08', [], false);
    assert.ok(!rows.some((r) => r.startsWith('HRV')));
    assert.ok(!actions.some((a) => /HRV/.test(a)));
    assert.equal(rows.length, 5);
  });
});
