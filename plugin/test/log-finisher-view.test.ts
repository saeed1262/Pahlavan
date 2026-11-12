// The Log panel's "Finisher" tag, drawn in Node with the small fake DOM: on
// the session's finisher only (a lifting day's easy cardio after the
// lifting, Express's own finish), in a new log and in an edit alike. A short
// day's cardio is not a finisher: neither a first item before other work nor
// the only item of an intervals day, which Today shows as the session's item.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { buildSession, buildToday, logFormFor, logFormFromEntry, type LogForm } from '../../src/report/index.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';
import { freshPanelState, renderLogPanel } from '../src/ui/log-panel.ts';
import { renderToday, type TodayContext } from '../src/ui/today.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';

installFakeDom();
type Json = Record<string, any>;
const PLAN = 'v/3-Personal/Fitness/plan-data.json';
const DATE = '2026-04-10';
const CARDIO_GUIDE = { setup: 'Bike.', do: 'Steady.', avoid: 'Sprinting.', q: 'cardio', muscles: { main: [], helps: [], kind: 'cardio' } };
/** Intervals the guide calls cardio, and the same with no guide entry (a timed item). */
const INTERVALS = { name: 'Bike intervals', table: 'Bike intervals', sr: '30 min', rest: '—', timed: { minutes: 30, rounds: 4, workMin: 4, restMin: 3 }, note: 'Hard on the work, easy between.' };
const UNGUIDED = { ...INTERVALS, name: 'Hill intervals', table: 'Hill intervals' };
const EASY_BIKE = { name: 'Easy bike', table: 'Easy bike', sr: '20 min', rest: '—', note: 'Easy.' };
const DEAD_BUG = { name: 'Dead Bug', table: 'Dead Bug', sr: '3 × 8/side', rest: '60 s', note: 'Slow.' };

/** The synthetic vault with a short session S2 of these items. */
function readWith(s2: Json[]) {
  const f = fixtureFiles('v');
  const plan = JSON.parse(f[PLAN]!);
  plan.shortTypes = ['S1', 'S2', 'S3'];
  plan.titles = { ...plan.titles, S2: 'Conditioning' };
  plan.sessions.S2 = s2;
  plan.guide['Bike intervals'] = CARDIO_GUIDE;
  plan.guide['Easy bike'] = CARDIO_GUIDE;
  f[PLAN] = JSON.stringify(plan);
  return readVault(memoryIo(f, DATE), 'v', { asOf: DATE });
}

/** Each row of the drawn panel with its tags, as "name: tag, tag". */
function tagged(read: ReturnType<typeof readWith>, form: LogForm): string[] {
  const layer = new FakeElement('div');
  renderLogPanel(layer as unknown as HTMLElement, { form, state: freshPanelState(), plan: read.raw!.plan, log: read.raw!.log, today: DATE, onChange: () => {}, onClose: () => {}, onRebuild: () => {}, onDate: () => {}, onSave: () => {}, onDelete: () => {}, onEditExisting: () => {}, onUseDisk: () => {} });
  return layer.querySelectorAll('.pv-lg-item').map((li) => {
    const tags = li.querySelectorAll('.pv-lg-tag').map((t) => text(t));
    const line = text(li.querySelector('.pv-lg-name-line')!);
    const name = tags.reduce((s, t) => s.replace(t, ''), line).trim();
    return tags.length ? `${name}: ${tags.join(', ')}` : name;
  });
}
const finishers = (rows: string[]) => rows.filter((r) => /Finisher/.test(r));
const fresh = (read: ReturnType<typeof readWith>, type: string, mode: 'full' | 'express' = 'full') => tagged(read, logFormFor(read, buildSession(read.data, DATE, mode, { type }), DATE)!);
const edit = (read: ReturnType<typeof readWith>, entry: Json) => tagged(read, logFormFromEntry(read, entry));

describe('the Log panel: the Finisher tag on the session’s finisher only', () => {
  it('a lifting day’s easy cardio after the lifting has the tag', () => {
    const read = readWith([INTERVALS]);
    assert.deepEqual(finishers(fresh(read, 'A')), ['Zone 2 finisher: Finisher']);
    assert.equal(logFormFor(read, buildSession(read.data, DATE, 'full', { type: 'A' }), DATE)!.cardio, 10, 'the finisher’s cardio minutes to start');
    assert.deepEqual(finishers(edit(read, { date: DATE, type: 'A', durationMin: 45 })), ['Zone 2 finisher: Finisher']);
    // An edit read from the session's own frozen list.
    const logged = (read.raw!.log as { sessions: Json[] }).sessions.find((s) => s['date'] === '2026-04-08')!;
    assert.ok(Array.isArray(logged['exercises']));
    assert.deepEqual(finishers(edit(read, logged)), ['Zone 2 finisher: Finisher']);
  });

  it('Express’s own finish has the tag, new or edited', () => {
    const read = readWith([INTERVALS]);
    assert.deepEqual(finishers(fresh(read, 'A', 'express')), ['Face Pull: Finisher']);
    assert.deepEqual(finishers(edit(read, { date: DATE, type: 'A', express: true, durationMin: 25 })), ['Face Pull: Finisher']);
  });

  it('a short day’s first item of cardio, before other work: no tag', () => {
    const read = readWith([EASY_BIKE, DEAD_BUG]);
    const rows = fresh(read, 'S2');
    assert.ok(rows.includes('Easy bike'), rows.join(' | '));
    assert.deepEqual(finishers(rows), []);
    assert.deepEqual(finishers(edit(read, { date: DATE, type: 'S2', durationMin: 30 })), []);
  });

  it('a short day whose only item is intervals: no tag, guided as cardio or not', () => {
    for (const item of [INTERVALS, UNGUIDED]) {
      const read = readWith([item]);
      const rows = fresh(read, 'S2');
      assert.ok(rows.includes(item.name), rows.join(' | '));
      assert.deepEqual(finishers(rows), [], item.name);
      assert.equal(logFormFor(read, buildSession(read.data, DATE, 'full', { type: 'S2' }), DATE)!.cardio, 0, 'no cardio default on a short day, as before');
      assert.deepEqual(finishers(edit(read, { date: DATE, type: 'S2', durationMin: 30 })), [], item.name);
    }
  });

  it('Today shows the only item of an intervals day as the session’s item, not a finisher line', () => {
    const read = readWith([INTERVALS]);
    const m = buildToday(read, DATE, 'full', 'v', { type: 'S2' });
    const ctx: TodayContext = { mode: 'full', session: m.session, phase: { id: 'workday', isfahan: false }, open: new Set(), pick: 'S2', onMode: () => {}, onPick: () => {}, onToggleWhy: () => {}, onLog: () => {}, onEditSession: () => {} };
    const root = new FakeElement('div');
    renderToday(root as unknown as HTMLElement, m, ctx);
    assert.equal(root.querySelectorAll('.pv-ex').length, 1);
    assert.match(text(root.querySelectorAll('.pv-ex')[0]!), /Bike intervals/);
    assert.ok(!root.querySelectorAll('.pv-lite').some((x) => /Finisher/.test(text(x))));
  });
});
