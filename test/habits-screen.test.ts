// The reports behind the Habits section, the Body record card and the
// Plan's Desk breaks card, and the Add / Edit form as data, on the synthetic
// vault (all made up) with in-memory changes.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { readTracking } from '../src/adapters/vault/tracking-read.ts';
import { mergeTracking } from '../src/adapters/vault/tracking-write.ts';
import type { TrackedItem, Tracking } from '../src/core/schema.ts';
import { itemOn } from '../src/core/tracking.ts';
import { buildBodyRecord, buildDeskCard, buildHabitsScreen, daysText, entryText, sundayOf } from '../src/report/habits-screen.ts';
import { acceptOps, bodyScheduleOps, bringOverOps, dismissOps, formFromItem, itemFromForm, itemId, morningOps, newForm, pausedItem, resumedItem, withKind, withWhen } from '../src/report/item-form.ts';
import { ROOT } from './helpers.ts';

const VAULT = join(ROOT, 'test', 'fixtures', 'vault');
const FIT = '3-Personal/Fitness';
const TRACKING = `${FIT}/Coach/tracking.json`;
const DATE = '2026-04-10';
const io = (over: Record<string, string | null> = {}) => ({
  readText: (p: string) => {
    for (const [k, v] of Object.entries(over)) if (p.endsWith(k)) return v;
    return existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null;
  },
  listDir: (p: string) => (existsSync(p) && statSync(p).isDirectory() ? readdirSync(p) : null),
});
const fixture = <T = any>(rel: string): T => JSON.parse(readFileSync(join(VAULT, rel), 'utf8'));
const opts = { configDir: '.obsidian' };
const screen = (over: Record<string, string | null> = {}, date = DATE) => buildHabitsScreen(readVault(io(over), VAULT, { asOf: date }), readTracking(io(over), VAULT, opts), date);
const tracking = (): Tracking => fixture(TRACKING);
const item = (id: string): TrackedItem => tracking().items.find((x) => x.id === id)!;

describe('buildHabitsScreen', () => {
  const s = screen();
  it('groups every item as the section does: supplements, amounts and ticks, at the desk', () => {
    assert.deepEqual(s.groups.map((g) => [g.label, g.items.map((x) => x.id)]), [
      ['Supplements', ['creatine', 'multivitamin', 'shake', 'fish-oil', 'magnesium']],
      ['Amounts and ticks', ['protein', 'flossing', 'water']],
      ['At the desk', ['stand-ups', 'sitting', 'desk-breaks']],
    ]);
    assert.deepEqual(s.counts, { coach: 6, user: 5 });
  });
  it('gives each row its schedule, when, reminder, source, link and stats', () => {
    const w = s.items.find((x) => x.id === 'water')!;
    assert.deepEqual([w.schedule, w.when, w.asks, w.reminder, w.habit, w.source.text], ['Every day', 'through the day', '2500 mL a day', 'every 2 h, 09:00 to 21:00', 'water', 'Suggested by your coach']);
    assert.deepEqual(w.measure, { target: 2500, unit: 'mL', quick: [250, 500], value: 1250 });
    assert.equal(w.grid.cells.length, 26 * 7);
    assert.equal(w.streak.unit, 'days');
    assert.equal(s.items.find((x) => x.id === 'shake')!.streak.unit, 'sessions');
    assert.equal(s.items.find((x) => x.id === 'shake')!.when, 'after the session');
    const f = s.items.find((x) => x.id === 'fish-oil')!;
    assert.equal(f.paused, '2026-03-28');
    assert.equal(s.items.find((x) => x.id === 'multivitamin')!.source.text, 'Added by you, from Habit Nudges');
    const sit = s.items.find((x) => x.id === 'sitting')!;
    assert.equal(sit.sitting!.limit, 360);
    assert.equal(sit.sitting!.bars.length, 28);
    assert.equal(sit.measure, null);
    const d = s.items.find((x) => x.id === 'desk-breaks')!;
    assert.deepEqual(d.measure, { target: 4, unit: 'breaks', quick: [], value: 2 });
    assert.equal(d.when, '10:00 to 15:00, from your plan');
  });
  it('lists the linked habits for the link, and only the open suggestions', () => {
    assert.ok(s.homepage!.some((h) => h.id === 'water'));
    assert.deepEqual(s.suggestions.map((x) => x.id), ['lights-out']);
    assert.equal(s.suggestions[0]!.why, 'Sleep averages 6.4 h; the focus of your last letter');
    assert.equal(s.suggestions[0]!.detail, 'Mon, Tue, Wed, Thu, Sun, bedtime');
  });
  it('offers no homepage link without habits-data.json', () => {
    assert.equal(screen({ '5-System/Data/habits-data.json': null }).homepage, null);
  });
  it('offers the bring-over only when Habit Nudges\' settings exist and something on offer is not tracked yet', () => {
    // Every offered item is tracked already in the fixture.
    assert.equal(s.bringOver, null);
    const empty = JSON.stringify({ schemaVersion: 1, items: [], days: {} });
    const b = screen({ [TRACKING]: empty }).bringOver!;
    assert.deepEqual(b.items.map((x) => [x.id, x.checked]), [['water', true], ['stand-ups', true], ['desk-breaks', true], ['sitting', true], ['protein', true]]);
    assert.deepEqual(b.morning, { on: true, at: '06:30' });
    assert.equal(b.bodyRecord.schedule, 'fixed');
    // No Habit Nudges: no offer.
    assert.equal(screen({ [TRACKING]: empty, '.obsidian/plugins/habit-nudges/data.json': null }).bringOver, null);
    // Brought over once: no offer again.
    assert.equal(screen({ [TRACKING]: JSON.stringify({ schemaVersion: 1, items: [], days: {}, bringOver: { on: DATE, items: [] } }) }).bringOver, null);
  });
  it('works with no tracking file at all', () => {
    const e = screen({ [TRACKING]: null });
    assert.equal(e.exists, false);
    assert.equal(e.items.length, 0);
    assert.ok(e.bringOver);
  });
});

describe('buildBodyRecord', () => {
  it('gives each part its last entry, its next date and where its schedule comes from', () => {
    const r = buildBodyRecord(readVault(io(), VAULT, { asOf: DATE }), readTracking(io(), VAULT), DATE);
    assert.equal(r.source, 'plan');
    assert.equal(r.hasPlan, true);
    const tape = r.parts.find((p) => p.part === 'tape')!;
    assert.deepEqual(tape.last, { date: '2026-03-24', text: 'waist 94.5, hips 97, chest 101, arm 33 cm' });
    assert.deepEqual([tape.due, tape.nextDate, tape.schedule.text], [true, '2026-03-29', 'Every second Sunday']);
    const tests = r.parts.find((p) => p.part === 'tests')!;
    assert.deepEqual(tests.last, { date: '2026-03-07', text: 'push-ups 12, pull-ups 0, hollow 25 s' });
    assert.equal(r.parts.find((p) => p.part === 'photos')!.last!.text, '3 of 4 poses');
  });
  it('reads every N days until the reset from Coach/tracking.json', () => {
    const t = tracking();
    t.bodyRecord = { schedule: 'fixed', tapeFrom: '2026-03-24', tapeEvery: 14, testsFrom: '2026-03-21', testsEvery: 28 };
    const over = { [TRACKING]: JSON.stringify(t) };
    const r = buildBodyRecord(readVault(io(over), VAULT, { asOf: DATE }), readTracking(io(over), VAULT), DATE);
    assert.equal(r.source, 'fixed');
    assert.deepEqual(r.fixed, { tapeFrom: '2026-03-24', tapeEvery: 14, testsFrom: '2026-03-21', testsEvery: 28 });
    assert.deepEqual(r.parts.map((p) => p.schedule.text), ['Every 14 days from Tue 24 Mar', 'With the tape, every 14 days', 'Every 28 days from Sat 21 Mar']);
  });
  it('says each entry in words', () => {
    assert.equal(entryText('tests', { date: 'x', pushups: 17, pullups: 1, hollowS: 36, handstandS: 24 }), 'push-ups 17, pull-ups 1, hollow 36 s');
    assert.equal(entryText('photos', { date: 'x', poses: ['front', 'back'] }), '2 of 4 poses');
  });
});

describe('buildDeskCard', () => {
  it('says there are none in the plan, with the item\'s own routine', () => {
    const plan = fixture(`${FIT}/plan-data.json`);
    delete plan.deskRoutine;
    const over = { [`${FIT}/plan-data.json`]: JSON.stringify(plan) };
    const c = buildDeskCard(readVault(io(over), VAULT, { asOf: DATE }), readTracking(io(over), VAULT), DATE);
    assert.equal(c.plan, null);
    assert.equal(c.item!.id, 'desk-breaks');
    assert.equal(c.item!.own!.times.length, 4);
    assert.equal(c.item!.own!.steps[0]!.name, 'Chin tuck');
  });
  it('shows the plan\'s routine, its times and the reason, with the item that follows it', () => {
    const plan = fixture(`${FIT}/plan-data.json`);
    plan.deskRoutine = [{ name: 'Chin tuck', dose: '×10' }, { name: 'Walk', dose: '1 min' }];
    const over = { [`${FIT}/plan-data.json`]: JSON.stringify(plan) };
    const c = buildDeskCard(readVault(io(over), VAULT, { asOf: DATE }), readTracking(io(over), VAULT), DATE);
    assert.deepEqual(c.plan!.times, ['10:00', '11:30', '13:00', '14:30']);
    assert.equal(c.plan!.daysText, 'weekdays');
    assert.deepEqual(c.plan!.why, [{ what: 'From your plan: forward head and rounded shoulders in the photo assessment', from: '' }]);
    assert.equal(c.item!.own, null);
    assert.equal(c.item!.accepted, '2026-03-02');
  });
  it('words the days and finds the Sunday', () => {
    assert.equal(daysText(['mon', 'wed', 'fri']), 'Mon, Wed, Fri');
    assert.equal(sundayOf('2026-04-10'), '2026-04-12');
    assert.equal(sundayOf('2026-04-12'), '2026-04-12');
  });
});

describe('the item form', () => {
  const ids = tracking().items.map((x) => x.id);
  const ctx = { today: DATE, ids };
  it('round-trips every kind unchanged', () => {
    for (const it of tracking().items) {
      const out = itemFromForm(formFromItem(it, DATE), it, ctx);
      assert.deepEqual(out.errors, [], it.id);
      assert.deepEqual(out.item, it, it.id);
    }
  });
  it('adds a new supplement as yours, with an id from its name', () => {
    const f = { ...newForm('supplement', DATE), name: 'Vitamin D', doseAmount: '1000', doseUnit: 'IU' };
    const { item: it, errors } = itemFromForm(f, null, ctx);
    assert.deepEqual(errors, []);
    assert.deepEqual(it, { id: 'vitamin-d', kind: 'supplement', name: 'Vitamin D', schedule: { kind: 'daily' }, start: DATE, source: { by: 'user', on: DATE }, when: 'morning', dose: '1000 IU', reminder: { at: '09:00' } });
    assert.equal(itemId('Creatine', ids), 'creatine-2');
  });
  it('asks for a name, a weekday and a target', () => {
    const f = { ...newForm('amount', DATE), target: 0, often: 'weekdays' as const, days: [] };
    assert.deepEqual(itemFromForm(f, null, ctx).errors, ['Give it a name.', 'Pick at least one weekday.', 'The daily target needs a number above 0.']);
  });
  it('keeps the settings in force until yesterday when an edit changes them', () => {
    const w = item('water');
    const f = { ...formFromItem(w, DATE), target: 3000 };
    const out = itemFromForm(f, w, ctx).item;
    assert.equal(out.amount!.target, 3000);
    assert.deepEqual(out.earlier, [...w.earlier!, { until: '2026-04-09', schedule: { kind: 'daily' }, amount: { target: 2500, unit: 'mL', quick: [250, 500] } }]);
    assert.equal(itemOn(out, '2026-04-09').amount!.target, 2500);
    assert.equal(itemOn(out, '2026-03-10').amount!.target, 2000);
    assert.equal(itemOn(out, DATE).amount!.target, 3000);
    // A second change the same day keeps the one version.
    assert.deepEqual(itemFromForm({ ...f, target: 3200 }, out, ctx).item.earlier, out.earlier);
    // A name or note change keeps no version.
    assert.equal(itemFromForm({ ...formFromItem(w, DATE), note: 'two bottles' }, w, ctx).item.earlier!.length, 1);
  });
  it('moves the When and the How often with the kind', () => {
    const f = withKind(newForm('supplement', DATE), 'standup');
    assert.deepEqual([f.kind, f.name, f.often], ['standup', 'Stand-ups', 'daily']);
    const g = withKind({ ...newForm('supplement', DATE), often: 'training' }, 'desk');
    assert.equal(g.often, 'weekdays');
    assert.equal(withKind(newForm('supplement', DATE), 'amount').when, 'day');
    const t = withWhen(newForm('supplement', DATE), 'training');
    assert.deepEqual([t.often, t.afterLog], ['training', true]);
    const tr = itemFromForm({ ...t, name: 'Shake 2' }, null, ctx).item;
    assert.deepEqual([tr.when, tr.whenDetail, tr.reminder], ['training', 'after', { afterLog: true }]);
  });
  it('makes valid stand-ups, desk breaks and sitting time', () => {
    for (const kind of ['standup', 'desk', 'sitting'] as const) {
      const out = itemFromForm({ ...newForm(kind, DATE), name: `My ${kind}` }, null, ctx);
      assert.deepEqual(out.errors, [], kind);
    }
    const sit = itemFromForm({ ...newForm('sitting', DATE), limitRemind: false }, null, ctx).item;
    assert.equal(sit.reminder, undefined);
  });
  it('pauses from today and resumes, keeping the paused days', () => {
    const c = item('creatine');
    const p = pausedItem(c, DATE);
    assert.deepEqual(p.pauses, [{ from: DATE }]);
    assert.deepEqual(resumedItem(p, DATE).pauses, undefined);
    const fish = item('fish-oil');
    assert.deepEqual(resumedItem(fish, DATE).pauses, [{ from: '2026-03-28', to: '2026-04-09' }]);
    assert.equal(pausedItem(fish, DATE), fish);
  });
  it('accepts a suggestion under the coach\'s settings, from today, and dismisses one', () => {
    const s = tracking().suggestions!.find((x) => x.id === 'lights-out')!;
    const ops = acceptOps(s, ctx);
    const m = mergeTracking(JSON.stringify(tracking()), ops);
    assert.equal(m.result, 'merged');
    const doc = (m as { doc: Tracking }).doc;
    const added = doc.items.find((x) => x.id === 'lights-out')!;
    assert.deepEqual([added.start, added.source.on, added.source.by], [DATE, DATE, 'coach']);
    assert.equal(doc.suggestions!.find((x) => x.id === 'lights-out')!.state, 'accepted');
    const d = mergeTracking(JSON.stringify(tracking()), dismissOps(s, DATE));
    assert.equal((d as { doc: Tracking }).doc.suggestions!.find((x) => x.id === 'lights-out')!.decided, DATE);
  });
  it('brings items over once, with the morning check-in and the body-record schedule', () => {
    const empty: Tracking = { schemaVersion: 1, items: [], days: {} };
    const b = screen({ [TRACKING]: JSON.stringify(empty) }).bringOver!;
    const chosen = b.items.filter((x) => x.id !== 'protein').map((x) => x.item);
    const m = mergeTracking(JSON.stringify(empty), bringOverOps(chosen, b, empty, DATE));
    assert.equal(m.result, 'merged');
    const doc = (m as { doc: Tracking }).doc;
    assert.deepEqual(doc.items.map((x) => x.id), ['water', 'stand-ups', 'desk-breaks', 'sitting']);
    assert.deepEqual(doc.bringOver, { on: DATE, items: ['water', 'stand-ups', 'desk-breaks', 'sitting'] });
    assert.deepEqual(doc.morning, { on: true, at: '06:30' });
    assert.equal(doc.bodyRecord!.schedule, 'fixed');
    // An existing morning time and schedule are kept.
    const ops = bringOverOps([], b, tracking(), DATE);
    assert.deepEqual(ops.map((o) => (o.op === 'settings' ? o.key : o.op)), ['bringOver']);
  });
  it('sets the morning reminder and the body-record schedule against what was read', () => {
    const m = mergeTracking(JSON.stringify(tracking()), morningOps({ on: true, at: '07:00' }, tracking().morning));
    assert.deepEqual((m as { doc: Tracking }).doc.morning, { on: true, at: '07:00' });
    const c = mergeTracking(JSON.stringify(tracking()), bodyScheduleOps({ schedule: 'plan' }, { schedule: 'fixed', tapeFrom: DATE, tapeEvery: 14, testsFrom: DATE, testsEvery: 28 }));
    assert.equal(c.result, 'unchanged');
  });
});
