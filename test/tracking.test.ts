// Tracked items: schedules (every day, training days, rest days, chosen
// weekdays, every N days; start, pauses, earlier settings), what a day holds
// (Pahlavan's log and the linked habit, stand-ups' desk minutes),
// the grid's day states and the stats (streak, 30-day adherence, the 26-week
// grid, sitting's bars, the stand-ups' minutes from the card and the desk).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { summarizeDay, type SittingDay } from '../src/core/sitting.ts';
import type { TrackedItem, Tracking } from '../src/core/schema.ts';
import {
  adherence30,
  dayCell,
  dayValue,
  firstHabitDay,
  grid26,
  habitCheckinKey,
  itemOn,
  itemStats,
  pausedOn,
  measureBars,
  pauseNow,
  scheduled,
  scheduleText,
  sittingBars,
  standingSplit,
  streak,
  targetOn,
  type HabitsView,
  type StatsContext,
  type TrainingDays,
} from '../src/core/tracking.ts';
import { VAULT } from './helpers.ts';

const T = JSON.parse(readFileSync(join(VAULT, '3-Personal/Fitness/Coach/tracking.json'), 'utf8')) as Tracking;
const item = (id: string): TrackedItem => T.items.find((x) => x.id === id)!;
const TODAY = '2026-04-10'; // a Friday
const training = (logged: string[] = [], plannedToday = false): TrainingDays => ({ logged: new Set(logged), plannedToday, today: TODAY });

const base = (over: Partial<TrackedItem> = {}): TrackedItem => ({ id: 'x', kind: 'tick', name: 'X', schedule: { kind: 'daily' }, start: '2026-03-02', source: { by: 'user' }, ...over });

describe('item schedules', () => {
  it('every day, chosen weekdays, every N days from the start or a date', () => {
    const tr = training();
    assert.equal(scheduled(base(), TODAY, tr), 'due');
    assert.equal(scheduled(base({ schedule: { kind: 'weekdays', days: ['mon', 'wed'] } }), '2026-04-08', tr), 'due');
    assert.equal(scheduled(base({ schedule: { kind: 'weekdays', days: ['mon', 'wed'] } }), TODAY, tr), 'off');
    const every3 = base({ schedule: { kind: 'every', n: 3 }, start: '2026-04-01' });
    assert.deepEqual(['2026-04-01', '2026-04-02', '2026-04-04', '2026-04-07', '2026-04-10'].map((d) => scheduled(every3, d, tr)), ['due', 'off', 'due', 'due', 'due']);
    assert.equal(scheduled(base({ schedule: { kind: 'every', n: 2, from: '2026-04-09' } }), TODAY, tr), 'off');
  });

  it('training days are logged days (and today when planned); rest days the others', () => {
    const tr = training(['2026-04-06', '2026-04-08'], true);
    const t = base({ schedule: { kind: 'training' } });
    const r = base({ schedule: { kind: 'rest' } });
    assert.deepEqual(['2026-04-06', '2026-04-07', TODAY].map((d) => scheduled(t, d, tr)), ['due', 'off', 'due']);
    assert.deepEqual(['2026-04-06', '2026-04-07', TODAY].map((d) => scheduled(r, d, tr)), ['off', 'due', 'off']);
    assert.equal(scheduled(t, TODAY, training(['2026-04-06'], false)), 'off');
  });

  it('before the start is "none", after today "future", a pause "paused" from its first day through its last', () => {
    const p = base({ start: '2026-03-10', pauses: [{ from: '2026-03-20', to: '2026-03-22' }, { from: '2026-04-09' }] });
    const tr = training();
    assert.deepEqual(['2026-03-09', '2026-03-19', '2026-03-20', '2026-03-22', '2026-03-23', '2026-04-09', TODAY, '2026-04-11'].map((d) => scheduled(p, d, tr)), ['none', 'due', 'paused', 'paused', 'due', 'paused', 'paused', 'paused']);
    assert.equal(pausedOn(p, '2026-03-21'), true);
    assert.equal(pauseNow(p, TODAY), '2026-04-09');
    assert.equal(pauseNow(item('creatine'), TODAY), null);
    assert.equal(scheduled(base(), '2026-04-11', tr), 'future');
  });

  it('a desk-break item that follows the plan runs on the plan\'s days', () => {
    const d = item('desk-breaks');
    assert.equal(scheduled(d, '2026-04-11', { ...training(), today: '2026-04-12' }, { days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] }), 'due');
    assert.equal(scheduled(d, '2026-04-11', { ...training(), today: '2026-04-12' }, null), 'off');
  });

  it('says the schedule in words', () => {
    assert.equal(scheduleText({ kind: 'weekdays', days: ['fri', 'mon', 'tue', 'wed', 'thu'] }), 'weekdays');
    assert.equal(scheduleText({ kind: 'weekdays', days: ['wed', 'mon'] }), 'Mon, Wed');
    assert.equal(scheduleText({ kind: 'every', n: 2 }), 'every 2 days');
    assert.equal(scheduleText({ kind: 'training' }), 'training days');
  });
});

describe('earlier settings', () => {
  it('a change applies from the day after `until`; the target in force on each day', () => {
    const w = item('water');
    assert.equal(itemOn(w, '2026-03-15').amount!.target, 2000);
    assert.equal(itemOn(w, '2026-03-16').amount!.target, 2500);
    assert.equal(targetOn(w, '2026-03-10'), 2000);
    const s = base({ schedule: { kind: 'weekdays', days: ['mon'] }, earlier: [{ until: '2026-04-05', schedule: { kind: 'daily' } }] });
    assert.equal(scheduled(s, '2026-04-04', training()), 'due');
    assert.equal(scheduled(s, '2026-04-07', training()), 'off');
  });
});

describe('what a day holds', () => {
  const habits: HabitsView = {
    habits: [{ id: 'water', type: 'numeric', max: 3000 }, { id: 'protein', type: 'binary' }],
    checkins: { [habitCheckinKey('water', TODAY)]: '1500', [habitCheckinKey('protein', '2026-04-09')]: '1', [habitCheckinKey('water', '2026-04-08')]: '2000' },
  };
  const ctx = { tracking: T, habits };

  it('a tick from Pahlavan or the linked habit counts; the source is named', () => {
    assert.deepEqual(dayValue(item('creatine'), TODAY, ctx), { done: true, value: null, target: null, count: null, desk: null, at: '2026-04-10T09:04:00.000Z', via: 'pahlavan' });
    assert.equal(dayValue(item('protein'), '2026-04-09', ctx).via, 'habit');
    assert.equal(dayValue(item('protein'), TODAY, ctx).done, false);
  });

  it('an amount takes the larger of the log and the habit', () => {
    const v = dayValue(item('water'), TODAY, ctx);
    assert.deepEqual([v.value, v.target, v.via, v.done], [1500, 2500, 'habit', false]);
    assert.deepEqual([dayValue(item('water'), '2026-04-08', ctx).value, dayValue(item('water'), '2026-04-08', ctx).via], [2500, 'pahlavan']);
  });

  it('stand-ups count minutes against the target, desk breaks against the day\'s breaks', () => {
    const s = dayValue(item('stand-ups'), TODAY, ctx);
    assert.deepEqual([s.value, s.target, s.count, s.desk], [80, 120, 4, 0]);
    const d = dayValue(item('desk-breaks'), TODAY, { ...ctx, desk: { times: ['10:00', '11:30', '13:00', '14:30'], days: null } });
    assert.deepEqual([d.value, d.target, d.desk], [2, 4, null]);
  });

  it('stand-ups: the desk minutes are part of the day\'s minutes, never more than them', () => {
    const t = JSON.parse(JSON.stringify(T)) as Tracking;
    t.days[TODAY]!['stand-ups']!.deskMinutes = 40;
    t.days['2026-04-09']!['stand-ups']!.deskMinutes = 90; // more than the day's 40 (a hand edit): only the 40
    const s = dayValue(item('stand-ups'), TODAY, { ...ctx, tracking: t });
    assert.deepEqual([s.value, s.count, s.desk, s.done], [80, 4, 40, false], 'the minutes and the count take both alike');
    assert.equal(dayValue(item('stand-ups'), '2026-04-09', { ...ctx, tracking: t }).desk, 40);
  });
});

describe('day states and stats', () => {
  const habits: HabitsView = { habits: [{ id: 'protein', type: 'binary' }], checkins: {} };
  // Protein ticked on the homepage 1-8 Apr except the 5th.
  for (const d of ['2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04', '2026-04-06', '2026-04-07', '2026-04-08']) habits.checkins[habitCheckinKey('protein', d)] = '1';
  const ctx = (extra: Partial<StatsContext> = {}): StatsContext => ({ tracking: T, habits, training: training(['2026-04-06', '2026-04-08']), ...extra });

  it('ticks: taken, missed, open today', () => {
    const p = item('protein');
    assert.deepEqual(['2026-04-08', '2026-04-09', TODAY].map((d) => dayCell(p, d, ctx()).state), ['taken', 'missed', 'open']);
  });

  it('counted items: taken at the target, part at half, missed below; today open until met', () => {
    const w = item('water');
    // 6 Apr 2750 of 2500, 7 Apr 1500, 9 Apr 900, today 1250.
    assert.deepEqual(['2026-04-06', '2026-04-07', '2026-04-09', TODAY].map((d) => dayCell(w, d, ctx()).state), ['taken', 'part', 'missed', 'open']);
    assert.deepEqual(dayCell(w, '2026-04-07', ctx()), { date: '2026-04-07', state: 'part', via: 'pahlavan', value: 1500, target: 2500 });
  });

  it('a streak skips days off, paused days and today while open; a miss ends it', () => {
    const p = item('protein');
    const s = streak(p, ctx());
    // Today open, 9 Apr missed: no streak.
    assert.equal(s.value, 0);
    assert.equal(s.reason.inputs['brokenOn'], '2026-04-09');
    const sh = item('shake'); // training days only: 6 and 8 Apr done
    assert.equal(streak(sh, ctx()).value, 2);
    assert.match(streak(sh, ctx()).reason.note!, /2 sessions in a row/);
  });

  it('30-day adherence: done against due, part counted as due', () => {
    const a = adherence30(item('water'), ctx());
    // Logged on 6-9 Apr only: 6 and 8 done, 7 part, 9 missed, 13-31 Mar and 1-5 Apr missed; today open.
    assert.equal(a.value.done, 2);
    assert.equal(a.value.due, 29);
    assert.equal(a.reason.rule, 'habits.adherence');
  });

  it('the grid runs Monday 25 weeks back through this Sunday', () => {
    const g = grid26(item('creatine'), ctx());
    assert.equal(g.from, '2025-10-13');
    assert.equal(g.to, '2026-04-12');
    assert.equal(g.cells.length, 182);
    assert.equal(g.cells[0]!.state, 'none');
    assert.equal(g.cells.at(-1)!.state, 'future');
    assert.equal(g.cells.find((c) => c.date === TODAY)!.state, 'taken');
    assert.equal(itemStats(item('fish-oil'), ctx()).paused, '2026-03-28');
  });

  it('sitting: within both limits, one over, both over; the 4-week bars mark each', () => {
    const sit = item('sitting'); // 6 h a day, stretches of 45 min at most
    const day = (date: string, stretches: [number, number][]): SittingDay => summarizeDay(date, stretches.map(([a, b]) => ({ start: Date.UTC(2026, 3, 1) + a * 60000, end: Date.UTC(2026, 3, 1) + b * 60000 })), 'pahlavan');
    const sitting = new Map<string, SittingDay>([
      ['2026-04-07', day('2026-04-07', [[0, 40], [60, 100]])],
      ['2026-04-08', day('2026-04-08', [[0, 50]])],
      ['2026-04-09', day('2026-04-09', [[0, 300], [310, 400]])],
    ]);
    const c = ctx({ sitting });
    assert.deepEqual(['2026-04-07', '2026-04-08', '2026-04-09', TODAY].map((d) => dayCell(sit, d, c).state), ['taken', 'part', 'missed', 'open']);
    assert.deepEqual(dayCell(sit, '2026-04-05', c), { date: '2026-04-05', state: 'taken', sitting: { minutes: 0, longest: 0 } }, 'nothing counted: 0 minutes, within the limits');
    const bars = sittingBars(sit, c);
    assert.equal(bars.length, 28);
    assert.deepEqual(bars.find((b) => b.date === '2026-04-09'), { date: '2026-04-09', minutes: 390, longest: 300, overLimit: true, overStretch: true, today: false, beforeStart: false, source: 'pahlavan' });
    assert.equal(bars.at(-1)!.today, true);
  });

  it('stand-ups: each day\'s desk minutes on its cell, and the last 30 days from the card and at the desk', () => {
    const t = JSON.parse(JSON.stringify(T)) as Tracking;
    t.days['2026-04-08']!['stand-ups']!.deskMinutes = 60;
    t.days[TODAY]!['stand-ups']!.deskMinutes = 20;
    const c = ctx({ tracking: t });
    const st = item('stand-ups');
    assert.deepEqual(dayCell(st, '2026-04-08', c), { date: '2026-04-08', state: 'taken', via: 'pahlavan', value: 140, target: 120, desk: 60 });
    assert.equal(dayCell(st, '2026-04-07', c).desk, undefined, 'no desk minutes: no field');
    const sum = (days: string[]) => days.reduce((n, d) => n + (T.days[d]?.['stand-ups']?.minutes ?? 0), 0);
    const logged = Object.keys(T.days).filter((d) => d >= '2026-03-12' && d <= TODAY);
    const split = standingSplit(st, c);
    assert.deepEqual(split.value, { days: 22, minutes: sum(logged), prompted: sum(logged) - 80, desk: 80, deskDays: 2 });
    assert.equal(split.reason.rule, 'habits.standing');
    assert.match(split.reason.note!, new RegExp(`${sum(logged)} min standing on 22 day\\(s\\) due in the last 30: ${sum(logged) - 80} from the stand-up card, 80 at the desk with Standing now on \\(2 days\\)`));
    assert.deepEqual(itemStats(st, c).standing, split);
    assert.equal(itemStats(item('creatine'), c).standing, undefined);
    assert.equal(standingSplit(st, ctx()).value.desk, 0, 'before any desk stand');
  });

  it('stand-ups and desk breaks: 4 weeks of bars, each day\'s amount against its target', () => {
    const t = JSON.parse(JSON.stringify(T)) as Tracking;
    t.days['2026-04-08']!['stand-ups']!.deskMinutes = 60;
    const c = ctx({ tracking: t });
    const sb = measureBars(item('stand-ups'), c);
    assert.equal(sb.length, 28);
    assert.deepEqual(sb.find((b) => b.date === '2026-04-08'), { date: '2026-04-08', value: 140, target: 120, desk: 60, count: 7, today: false, beforeStart: false });
    assert.deepEqual(sb.at(-1)!, { date: TODAY, value: 80, target: 120, desk: 0, count: 4, today: true, beforeStart: false });
    const late = measureBars({ ...item('stand-ups'), start: '2026-04-01' }, c);
    assert.deepEqual(late.find((b) => b.date === '2026-03-31'), { date: '2026-03-31', value: 0, target: null, desk: null, count: null, today: false, beforeStart: true }, 'before its start: nothing counted');
    const db = measureBars(item('desk-breaks'), c);
    assert.deepEqual(db.find((b) => b.date === '2026-04-08'), { date: '2026-04-08', value: 4, target: dayValue(item('desk-breaks'), '2026-04-08', c).target, desk: null, count: null, today: false, beforeStart: false });
    for (const b of db) if (scheduled(item('desk-breaks'), b.date, c.training, c.desk) !== 'due') assert.equal(b.target, null, `${b.date} is not due: no target`);
    assert.deepEqual(itemStats(item('stand-ups'), c).bars, sb);
    assert.equal(itemStats(item('creatine'), c).bars, undefined);
  });

  it('finds where a linked habit\'s history starts', () => {
    assert.equal(firstHabitDay(habits, 'protein'), '2026-04-01');
    assert.equal(firstHabitDay(habits, 'water'), null);
  });
});
