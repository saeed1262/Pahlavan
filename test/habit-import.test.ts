// The one-time bring-over from Habit Nudges: made-up settings (its
// data.json's shape) and linked habits (habits-data.json's shape) into
// proposed tracked items, with protein as one gram-target tick; what stays.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bringOverFromNudges, splitName } from '../src/core/habit-import.ts';
import type { Tracking } from '../src/core/schema.ts';
import { habitCheckinKey } from '../src/core/tracking.ts';
import { validateTracking } from '../src/core/validate.ts';

const SETTINGS = {
  times: { morning: '8:30', evening: '20:15', last: '21:45' },
  assign: { 'hab-100': 'morning', 'hab-101': 'morning', creatine: 'morning', protein: 'morning', workout: 'evening', flashcards: 'evening' },
  water: { habit: 'water', every: 90, start: '08:30', end: '20:30', amounts: [250, 330] },
  desk: { on: true, every: 75, start: '09:30', end: '16:00', weekdays: true },
  body: { on: true, start: '06:15', end: '21:00', measureFrom: '2026-01-07', measureEvery: 14, testsFrom: '2026-01-28', testsEvery: 28 },
  stand: { on: true, sitMinutes: 35, standMinutes: 15, snoozeMinutes: 10, awayMinutes: 30, standAwayMinutes: 5, activeSeconds: 90, habit: 'stand' },
  deskTime: { on: true, idleMinutes: 6, weekends: false, goalHours: 8 },
};
const HABITS = {
  habits: [
    { id: 'workout', name: 'Workout', type: 'binary', max: 1 },
    { id: 'water', name: 'Water (mL)', type: 'numeric', max: 2800, step: 100 },
    { id: 'work', name: 'Work (hours)', type: 'numeric', max: 12, source: 'timer' },
    { id: 'reading', name: 'Reading (minutes)', type: 'numeric', max: 60 },
    { id: 'hab-100', name: 'Multivitamins', type: 'binary', max: 10 },
    { id: 'hab-101', name: 'Magnesium', type: 'binary', max: 10 },
    { id: 'flashcards', name: 'Flashcards', type: 'binary', max: 1 },
    { id: 'protein', name: 'Protein', type: 'binary', max: 1 },
    { id: 'creatine', name: 'Creatine', type: 'binary', max: 1 },
    { id: 'hab-102', name: 'Flossing', type: 'binary', max: 10 },
    { id: 'hab-103', name: 'Skin routine', type: 'binary', max: 10 },
    { id: 'hab-104', name: 'QX', type: 'binary', max: 10 },
    { id: 'stand', name: 'Stand (minutes)', type: 'numeric', max: 80, step: 20 },
  ],
  checkins: {
    [habitCheckinKey('creatine', '2026-02-02')]: '1',
    [habitCheckinKey('creatine', '2026-03-01')]: '1',
    [habitCheckinKey('water', '2026-01-19')]: '1500',
    [habitCheckinKey('stand', '2026-02-10')]: '40',
    [habitCheckinKey('hab-102', '2026-02-20')]: '1',
  },
};
const TODAY = '2026-03-02';

describe('bring over from Habit Nudges', () => {
  const r = bringOverFromNudges({ settings: SETTINGS, habits: HABITS, today: TODAY, proteinG: 133.6 });
  const byId = Object.fromEntries(r.value.items.map((x) => [x.item.id, x]));

  it('offers the ten health items, each ticked, and leaves the rest where they are', () => {
    assert.deepEqual(r.value.items.map((x) => x.item.id), ['water', 'stand-ups', 'desk-breaks', 'sitting', 'multivitamins', 'magnesium', 'protein', 'creatine', 'flossing', 'skin-routine']);
    assert.ok(r.value.items.every((x) => x.checked && x.item.source.by === 'user' && x.item.source.from === 'Habit Nudges'));
    assert.deepEqual(r.value.left.map((x) => [x.habit, x.why]), [
      ['workout', 'Ticked when a session is logged.'],
      ['work', 'Filled in by the work timer; it stays in Habit Nudges.'],
      ['reading', 'Not a health habit: it stays in Habit Nudges.'],
      ['flashcards', 'Not a health habit: it stays in Habit Nudges.'],
      ['hab-104', 'Not one Pahlavan recognises; add it in Habits if you want it tracked here.'],
    ]);
    assert.equal(r.reason.rule, 'habits.import');
  });

  it('water: the habit\'s target and unit, the quick amounts, a card every N minutes in its hours', () => {
    const w = byId['water']!.item;
    assert.deepEqual([w.kind, w.amount, w.reminder, w.habit, w.start], ['amount', { target: 2800, unit: 'mL', quick: [250, 330] }, { every: 90, from: '08:30', to: '20:30' }, 'water', '2026-01-19']);
  });

  it('stand-ups: the stand settings, the habit\'s target in minutes, no call pause (calls are not detected), all day', () => {
    const s = byId['stand-ups']!.item;
    assert.deepEqual(s.standup, { sitMinutes: 35, standMinutes: 15, snoozeMinutes: 10, targetMinutes: 80, pauseCalls: false, activeOnly: true, activeSeconds: 90, awayMinutes: 30, standAwayMinutes: 5 });
    assert.deepEqual([s.habit, s.start, s.schedule], ['stand', '2026-02-10', { kind: 'daily' }]);
  });

  it('desk breaks follow the plan on Habit Nudges\' timing; sitting time from desk time, with new limits', () => {
    const d = byId['desk-breaks']!.item;
    assert.deepEqual([d.desk, d.schedule.kind], [{ followPlan: true, every: 75, from: '09:30', to: '16:00', minutes: 5 }, 'weekdays']);
    const s = byId['sitting']!.item;
    assert.deepEqual([s.sitting, s.reminder, s.schedule.kind], [{ limitMinutes: 360, stretchMaxMinutes: 45, awayMinutes: 6 }, { atMinutes: 330, stretch: true }, 'weekdays']);
  });

  it('protein is one tick with the day\'s gram target, ticked in the evening', () => {
    const p = byId['protein']!;
    assert.deepEqual([p.item.kind, p.item.goal, p.item.means, p.item.when, p.item.reminder, p.item.habit], ['tick', { amount: 134, unit: 'g' }, 'At least 134 g of protein', 'evening', { at: '20:15' }, 'protein']);
    assert.match(p.detail, /134 g a day, ticked in the evening when hit/);
    const none = bringOverFromNudges({ settings: SETTINGS, habits: HABITS, today: TODAY }).value.items.find((x) => x.item.id === 'protein')!;
    assert.equal(none.item.goal, undefined);
  });

  it('supplements and ticks keep their card\'s time (two-digit); unassigned ones the last check', () => {
    assert.deepEqual(['multivitamins', 'magnesium', 'creatine', 'flossing', 'skin-routine'].map((id) => [byId[id]!.item.kind, byId[id]!.item.reminder!.at, byId[id]!.item.habit]), [
      ['supplement', '08:30', 'hab-100'],
      ['supplement', '08:30', 'hab-101'],
      ['supplement', '08:30', 'creatine'],
      ['tick', '21:45', 'hab-102'],
      ['tick', '21:45', 'hab-103'],
    ]);
    assert.equal(byId['creatine']!.item.start, '2026-02-02', 'its history starts at its first tick');
    assert.equal(byId['magnesium']!.item.start, TODAY, 'no ticks yet: today');
  });

  it('the body record continues Habit Nudges\' dates, and the morning card its time', () => {
    assert.deepEqual(r.value.bodyRecord, { schedule: 'fixed', tapeFrom: '2026-01-07', tapeEvery: 14, testsFrom: '2026-01-28', testsEvery: 28 });
    assert.deepEqual(r.value.morning, { on: true, at: '06:15' });
  });

  it('the proposal is a valid Coach/tracking.json as it stands', () => {
    const doc: Tracking = { schemaVersion: 1, items: r.value.items.map((x) => x.item), days: {}, morning: r.value.morning, bodyRecord: r.value.bodyRecord, bringOver: { on: TODAY, items: r.value.items.map((x) => x.item.id) } };
    assert.deepEqual(validateTracking(doc), []);
  });

  it('without Habit Nudges\' settings it uses its defaults; without habits there is nothing linked to offer', () => {
    const d = bringOverFromNudges({ settings: null, habits: HABITS, today: TODAY });
    assert.equal(d.value.items.find((x) => x.item.id === 'stand-ups')!.item.standup!.sitMinutes, 45);
    const empty = bringOverFromNudges({ settings: SETTINGS, habits: null, today: TODAY });
    assert.deepEqual(empty.value.items.map((x) => x.item.id), ['stand-ups', 'desk-breaks', 'sitting']);
    assert.deepEqual(splitName('Water (mL)'), { label: 'Water', unit: 'mL' });
  });
});
