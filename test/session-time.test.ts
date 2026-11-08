// How long a plan session takes, from its items, timed as the plan
// generator times a session (the warm-up, each item's work and its rest, a
// superset's rounds), and the time check against the profile's day lengths:
// the short days (cardio plus core) now have planned minutes, so one over the
// user's short-day length is flagged with its reason, in `review`, on Today
// and on the Plan. Made-up short days shaped like a real plan's (a 20-minute
// bike plus two core moves), and the synthetic vault.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { run } from '../src/cli/cli.ts';
import { restMinutes, sessionMinutes, timeCheck, type TimedItem } from '../src/core/session-time.ts';
import { buildPlan, buildReview, buildSession, buildToday } from '../src/report/index.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

type Json = Record<string, any>;
const WARMUP = "3 min easy, building up to the session's pace.";
const SHORT: Record<string, TimedItem[]> = {
  bike: [
    { name: 'Easy bike (zone 2)', sr: '20 min', rest: '—' },
    { name: 'Cable crunch', sr: '3 × 8–12', rest: '60 s' },
    { name: 'Pallof Press', sr: '3 × 10/side', rest: '45 s' },
  ],
  intervals: [
    { name: 'Uphill intervals, 4 x 4 min', sr: '22 min', rest: '—' },
    { name: 'Hollow hold (your level)', sr: '3 × hold', rest: '45 s' },
    { name: 'Side Plank', sr: '3 × 45–60 s/side', rest: '30 s after both sides' },
  ],
  walk: [
    { name: 'Brisk walk', sr: '20 min', rest: '—' },
    { name: 'Ab wheel rollout', sr: '3 × 6–10', rest: '60 s' },
    { name: 'Side Plank', sr: '3 × 45–60 s/side', rest: '30 s after both sides' },
  ],
};
const short = (items: TimedItem[]) => sessionMinutes({ items, warmup: WARMUP, kind: 'short' });

describe('a session’s minutes from its items', () => {
  it('rests: the low end of a range, minutes or seconds, and whether it follows each pair', () => {
    assert.deepEqual(restMinutes('60 s'), { minutes: 1, pair: false });
    assert.deepEqual(restMinutes('2–3 min'), { minutes: 2, pair: false });
    assert.deepEqual(restMinutes('60–90 s'), { minutes: 1, pair: false });
    assert.deepEqual(restMinutes('90 s after each pair'), { minutes: 1.5, pair: true });
    assert.deepEqual(restMinutes('30 s after both sides'), { minutes: 0.5, pair: false });
    for (const none of ['—', 'as needed', '', null, undefined]) assert.equal(restMinutes(none), null);
  });

  it('a short day of 20 minutes of cardio and two core moves: about 33, 35 and 34 minutes', () => {
    const bike = short(SHORT.bike!);
    assert.equal(bike.value.minutes, 33);
    assert.equal(bike.value.warmup, 3);
    assert.deepEqual(bike.value.items.map((x) => [x.name, x.minutes, x.how]), [
      ['Easy bike (zone 2)', 20, '20 min'],
      ['Cable crunch', 4.5, '3 × (30 s + 60 s rest)'],
      ['Pallof Press', 5.25, '3 × (60 s, both sides + 45 s rest)'],
    ]);
    assert.equal(short(SHORT.intervals!).value.minutes, 35);
    assert.equal(short(SHORT.walk!).value.minutes, 34);
    assert.deepEqual([bike.reason.rule, bike.reason.title], ['time.estimate', 'Session length']);
    assert.match(bike.reason.note!, /^About 33 min: a 3-min warm-up, 20 min of Easy bike \(zone 2\), and 9\.75 min of sets with their rests\./);
  });

  it('a superset is rounds of a set of each and one rest; a circuit timed on and off holds its rest; a set with no rest gets 90 s', () => {
    const pair = sessionMinutes({ items: [{ name: 'Face Pull', sr: '3 × 12–15', rest: '90 s after each pair' }, { name: 'Leg extension', sr: '3 × 10–15', rest: '90 s after each pair', pair: true }], warmup: null, kind: 'lift' });
    assert.deepEqual(pair.value.items.map((x) => [x.name, x.minutes]), [['Face Pull + Leg extension', 7.5]]);
    assert.equal(pair.value.warmup, 6, 'no minutes in the warm-up: the checklist’s 6 on a lifting day');
    const circuit = sessionMinutes({ items: [{ name: 'Circuit: squat jump · burpee', sr: '4 rounds, 40/20', rest: '20 s between moves' }], warmup: '1 min jumping jacks', kind: 'short' });
    assert.deepEqual([circuit.value.warmup, circuit.value.items[0]!.minutes, circuit.value.minutes], [1, 8, 9]);
    assert.equal(sessionMinutes({ items: [{ name: 'Row', sr: '3 × 10' }], warmup: null, kind: 'short' }).value.items[0]!.minutes, 6);
    const odd = sessionMinutes({ items: [{ name: 'Mobility flow', sr: 'as written' }], warmup: null, kind: 'short' });
    assert.deepEqual([odd.value.untimed, odd.value.minutes], [['Mobility flow'], 3]);
  });

  it('intervals: warm-up, rounds of work, the easy minutes between and cool-down, from the timed field or the note', () => {
    const fields = short([{ name: 'Bike intervals', sr: '30 min', rest: '—', timed: { rounds: 4, workMin: 4, restMin: 3, warmupMin: 5, cooldownMin: 5 } }]);
    assert.deepEqual(fields.value.items.map((x) => [x.minutes, x.how]), [[35, '5 min easy warm-up, 4 × 4 min hard, 3 min easy between, 5 min easy cool-down']]);
    assert.equal(fields.value.minutes, 38);
    // Before the field: the note's intervals (25 min) over sr's 22, which is less than they take.
    const old = short([{ name: 'Uphill intervals, 4 x 4 min', sr: '22 min', rest: '—', note: '4 × 4 min hard, 3 min easy between, warm-up and cool-down easy. Why: you chose intervals.' }, ...SHORT.intervals!.slice(1)]);
    assert.deepEqual(old.value.items.map((x) => [x.name, x.minutes]), [['Uphill intervals, 4 x 4 min', 25], ['Hollow hold (your level)', 3.75], ['Side Plank', 6]]);
    assert.equal(old.value.minutes, 38);
    assert.match(old.reason.note!, /^About 38 min: a 3-min warm-up, 25 min of Uphill intervals, 4 x 4 min \(4 × 4 min hard, 3 min easy between\), and 9\.75 min of sets/);
    // Without intervals in the note, its minutes as before.
    assert.equal(short(SHORT.intervals!).value.items[0]!.minutes, 22);
  });

  it('the time check: over the short day’s length is flagged with its reason; within it, said so; no profile, no limit', () => {
    const av = { daysPerWeek: 7, minutesPerSession: 60, shortSessions: { days: 3, minutes: 30 } };
    const rows = timeCheck([
      { type: 'S2', name: 'Intervals + abs', kind: 'short', estimate: short(SHORT.intervals!) },
      { type: 'A', name: 'Heavy', kind: 'lift', estimate: sessionMinutes({ items: [{ name: 'Squat', sr: '3 × 6', rest: '2–3 min' }], warmup: null, kind: 'lift' }) },
    ], av);
    assert.deepEqual(rows.map((r) => [r.value.type, r.value.minutes, r.value.limit, r.value.over]), [['S2', 35, 30, 5], ['A', 14, 60, 0]]);
    assert.equal(rows[0]!.reason.note, 'S2 (Intervals + abs) takes about 35 min, 5 min over your 30-minute short days; Uphill intervals, 4 x 4 min is the longest part, 22 min. Shorten it, or plan the day longer.');
    assert.deepEqual([rows[0]!.reason.rule, rows[0]!.reason.title, rows[0]!.reason.threshold], ['time.check', 'Time check', { minutes: 30 }]);
    assert.equal(rows[1]!.reason.note, 'A (Heavy) takes about 14 min: it fits your 60-minute lifting days.');
    const none = timeCheck([{ type: 'S1', name: 'Bike', kind: 'short', estimate: short(SHORT.bike!) }], null);
    assert.deepEqual([none[0]!.value.limit, none[0]!.value.over], [null, null]);
    assert.match(none[0]!.reason.note!, /No profile, so no day length/);
    // Without short days in the profile, a short session is checked against the usual length.
    assert.equal(timeCheck([{ type: 'S1', name: 'Bike', kind: 'short', estimate: short(SHORT.bike!) }], { daysPerWeek: 3, minutesPerSession: 45 })[0]!.value.limit, 45);
  });
});

describe('the short days’ minutes in review, Today and the Plan', () => {
  const DATE = '2026-04-10';
  const PROFILE = 'v/3-Personal/Fitness/Coach/profile.json';
  // The synthetic profile with 2 short days of 10 minutes: its S1 (about 15) and S3 (about 12) run over.
  const tight = (f: Record<string, string>) => {
    const p = JSON.parse(f[PROFILE]!);
    p.availability = { ...p.availability, shortSessions: { days: 2, minutes: 10 } };
    f[PROFILE] = JSON.stringify(p);
  };
  const read = (edit?: (f: Record<string, string>) => void) => {
    const f = fixtureFiles('v');
    edit?.(f);
    return readVault(memoryIo(f, DATE), 'v', { asOf: DATE });
  };

  it('review: every session as planned with its estimate and check; the short days over their length named', () => {
    const t = buildReview(read().data, DATE).time;
    assert.deepEqual(t.limits, { lift: 60, short: 60 });
    assert.deepEqual(t.sessions.map((s) => [s.type, s.kind, s.estimate.value.minutes, s.check.value.over]), [['A', 'lift', 31, 0], ['B', 'lift', 34, 0], ['S1', 'short', 15, 0], ['S3', 'short', 12, 0]]);
    assert.deepEqual(t.over, []);
    const over = buildReview(read(tight).data, DATE).time;
    assert.deepEqual([over.limits, over.over], [{ lift: 60, short: 10 }, ['S1', 'S3']]);
  });

  it('engine review warns once for the sessions over their length; not when they fit', () => {
    const io = (edit?: (f: Record<string, string>) => void) => {
      const f = fixtureFiles('v');
      edit?.(f);
      return memoryIo(f, DATE);
    };
    const warn = (edit?: (f: Record<string, string>) => void) => (JSON.parse(run(['review', '--vault', 'v', '--date', DATE], io(edit)).stdout) as Json).warnings.filter((w: Json) => w.code === 'time-over');
    assert.deepEqual(warn(tight), [{ code: 'time-over', message: "2 sessions run over the day's length in the profile: S1 about 15 min of 10, S3 about 12 min of 10.", items: ['S1', 'S3'] }]);
    assert.deepEqual(warn(), []);
  });

  it('Today: a short day’s minutes are its estimate, with the check; Express halves them; a lifting day keeps its logged length', () => {
    const r = read(tight);
    const planned = (mode: 'full' | 'express', type: string): Json => {
      const s = buildSession(r.data, DATE, mode, { type });
      assert.ok('plannedLoad' in s, type);
      return s.plannedLoad as Json;
    };
    const pl = planned('full', 'S1');
    assert.deepEqual([pl.minutes, pl.estimate.value.minutes, pl.time.value.over, pl.typical], [15, 15, 5, 60]);
    const ex = planned('express', 'S1');
    assert.deepEqual([ex.minutes, 'time' in ex], [10, false]);
    const lift = planned('full', 'A');
    assert.deepEqual([lift.minutes, 'estimate' in lift], [60, false]);
    const today = buildToday(r, DATE, 'full', 'v', { type: 'S3' }).session!;
    assert.ok('plannedLoad' in today);
    assert.equal(today.plannedLoad.minutes, 12);
  });

  it('the Plan: each short day’s panel has its minutes and check; a lifting day’s has none', () => {
    const p = buildPlan(read(tight), DATE, { decisions: null });
    assert.ok('templates' in p);
    const t = p.templates!;
    const s1 = t.find((x) => x.type === 'S1')!;
    assert.ok('minutes' in s1 && s1.minutes);
    assert.deepEqual([s1.minutes.estimate.value.minutes, s1.minutes.check.value.over], [15, 5]);
    assert.ok(!('minutes' in t.find((x) => x.type === 'A')!));
  });
});
