// The rest of Progress: records and milestones, sessions and cardio per
// bucket, tape trends, the profile's targets, watch numbers as 7-day
// averages, and the ladders as paths.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { validateProfile } from '../src/core/validate.ts';
import { bodyTargets, buildProgressMore, cardioWeeks, e1rmChange, healthAverages, ladderPath, monthBuckets, planWeeks, recordsFor, sessionCounts, skillGoal, tapeTrends, testHistory } from '../src/report/index.ts';
import { ROOT } from './helpers.ts';

const VAULT = join(ROOT, 'test', 'fixtures', 'vault');
const DATE = '2026-04-10';
const fsIo = (patch?: (p: string, t: string | null) => string | null) => ({
  readText: (p: string) => {
    const t = existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null;
    return patch ? patch(p, t) : t;
  },
  listDir: (p: string) => (existsSync(p) && statSync(p).isDirectory() ? readdirSync(p) : null),
});

describe('recordsFor', () => {
  const sets = [
    { date: '2026-03-02', weight: 50, reps: 8, e1rm: 63 },
    { date: '2026-03-09', weight: 55, reps: 6, e1rm: 66 },
    { date: '2026-03-14', weight: 55, reps: 7, e1rm: 68 },
    { date: '2026-03-23', weight: 50, reps: 6, e1rm: 60 },
    { date: '2026-03-30', weight: 160, reps: 5, e1rm: 187, used: false },
    { date: '2026-04-03', weight: 60, reps: 5, e1rm: 70 },
  ];
  it('counts a heavier set, or the same weight for more reps, after the baseline', () => {
    const r = recordsFor(sets, DATE, 5);
    assert.deepEqual(r.records, ['2026-03-09', '2026-03-14', '2026-04-03']);
    assert.deepEqual([r.best!.weight, r.best!.reps, r.best!.date], [60, 5, '2026-04-03']);
    assert.deepEqual(r.bestE1rm, { value: 70, date: '2026-04-03' });
  });
  it('leaves out sets the e1RM trend leaves out, and calls a record new for 14 days', () => {
    assert.equal(recordsFor(sets, DATE, 5).sets.find((s) => s.date === '2026-03-30')!.record, false);
    assert.equal(recordsFor(sets, '2026-04-17', 5).isNew, true);
    assert.equal(recordsFor(sets, '2026-04-18', 5).isNew, false);
    assert.equal(recordsFor(sets.slice(0, 1), DATE, 5).isNew, false); // the baseline is not a record
  });
  it('gives the last two round numbers reached and the next, by the step', () => {
    assert.deepEqual(recordsFor(sets, DATE, 5).milestones, { done: [55, 60], next: 65, toGo: 5, step: 5 });
    assert.deepEqual(recordsFor([{ date: DATE, weight: 57.5, reps: 5, e1rm: 66 }], DATE, 10).milestones, { done: [40, 50], next: 60, toGo: 2.5, step: 10 });
  });
  it('counts the e1RM change from after the calibration week, called from the third set', () => {
    assert.deepEqual(e1rmChange(sets, '2026-03-08'), { change: 4, sets: 4, called: true });
    assert.deepEqual(e1rmChange(sets.slice(0, 3), '2026-03-08'), { change: 2, sets: 2, called: false });
    assert.deepEqual(e1rmChange(sets.slice(0, 2), '2026-03-08'), { change: null, sets: 1, called: false });
  });
});

describe('buckets, sessions and cardio', () => {
  it('lays out plan weeks from the plan’s Monday and months across a year', () => {
    assert.deepEqual(planWeeks('2026-03-04', 1, 2).map((w) => [w.key, w.from, w.to]), [['W1', '2026-03-02', '2026-03-08'], ['W2', '2026-03-09', '2026-03-15']]);
    assert.deepEqual(monthBuckets('2026-02-10', 3).map((m) => [m.key, m.from, m.to]), [['2025-12', '2025-12-01', '2025-12-31'], ['2026-01', '2026-01-01', '2026-01-31'], ['2026-02', '2026-02-01', '2026-02-28']]);
  });
  it('counts sessions by kind, ticked days with no log, and marks the current and future buckets', () => {
    const b = planWeeks('2026-03-02', 1, 3);
    const r = sessionCounts([{ date: '2026-03-02', kind: 'lift' }, { date: '2026-03-03', kind: 'short' }, { date: '2026-03-10', kind: 'custom' }, { date: '2026-03-20', kind: 'lift' }], b, ['2026-03-11'], '2026-03-12');
    assert.deepEqual(r.map((x) => [x.lift, x.short, x.custom, x.unlogged, x.current, x.future]), [[1, 1, 0, 0, false, false], [0, 0, 1, 1, true, false], [0, 0, 0, 0, false, true]]);
  });
  it('sums cardio minutes per week with the minutes by mode', () => {
    const r = cardioWeeks([{ date: '2026-03-02', cardioMin: 10, cardioMode: 'Bike' }, { date: '2026-03-04', cardioMin: 5, cardioMode: 'bike' }, { date: '2026-03-05', cardioMin: 8, cardioMode: '' }, { date: '2026-03-06', cardioMin: 0, cardioMode: 'walk' }], planWeeks('2026-03-02', 1, 1), '2026-03-08');
    assert.deepEqual([r[0]!.minutes, r[0]!.sessions, r[0]!.modes], [23, 3, { bike: 15, 'not said': 8 }]);
  });
});

describe('body and health', () => {
  it('trends each tape measure from the cycle’s start', () => {
    const t = tapeTrends([{ date: '2026-02-10', unit: 'cm', waist: 99 }, { date: '2026-02-24', unit: 'cm', waist: 96, hips: 98 }, { date: '2026-03-24', unit: 'cm', waist: 94.5 }], '2026-02-23');
    assert.equal(t.days, 2);
    assert.deepEqual(t.measures.map((m) => [m.key, m.points.length, m.change]), [['waist', 2, -1.5], ['hips', 1, null]]);
  });
  it('averages a watch number over 7 calendar days, with the first week as the baseline', () => {
    const daily = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-10', '2026-03-11'].map((date, i) => ({ date, rhr: 60 - i }));
    const h = healthAverages(daily, 'rhr', '2026-03-11')!;
    assert.deepEqual([h.firstWeek, h.avg7, h.n7, h.series.length], [59, 56.5, 2, 5]);
    assert.equal(healthAverages(daily, 'steps', '2026-03-11'), null);
  });
  it('measures the profile’s targets, falling back to the plan’s steps and the engine’s sleep', () => {
    const rows = bodyTargets({ waistDropCm: [4, 6], weightDropKg: [3, 5], rhrDropBpm: [3, 6] }, { waist: { first: 96, last: 91.5 }, weight: { first: 84.8, last: 83.9 }, rhr: { first: 58, last: 59.3, n: 40 }, steps: { avg: 8289, n: 7 }, sleep: { avg: 6.3, n: 7 } }, { steps: 7000, sleepH: 7 });
    assert.deepEqual(rows.map((r) => [r.key, r.status, r.source]), [['waist', 'met', 'profile'], ['weight', 'on-the-way', 'profile'], ['rhr', 'not-yet', 'profile'], ['steps', 'at-goal', 'plan'], ['sleep', 'under', 'engine']]);
    assert.deepEqual(bodyTargets(undefined, {}, { steps: 7000, sleepH: 7 }).map((r) => [r.key, r.status]), [['steps', 'no-data'], ['sleep', 'no-data']]);
  });
});

describe('skills', () => {
  it('reads a test’s history and the profile’s goal', () => {
    assert.deepEqual(testHistory([{ date: '2026-03-21', results: { pushups: 15 } }, { date: '2026-03-07', results: { pushups: 12, pullups: 0 } }], 'pushups'), [{ date: '2026-03-07', value: 12 }, { date: '2026-03-21', value: 15 }]);
    assert.equal(skillGoal({ tests: { pushups: 25 } }, 'pushups'), 25);
    assert.equal(skillGoal(undefined, 'pushups'), null);
  });
  it('draws a ladder as mastered, in progress, unlocked and locked levels', () => {
    const p = ladderPath({ id: 'x', name: 'X', levels: ['a', 'b', 'c', 'd', 'e'], history: [{ level: 1, date: '2026-03-01' }, { level: 3, date: '2026-03-20' }], carried: true }, 3);
    assert.deepEqual(p.map((x) => [x.state, x.reached]), [['mastered', '2026-03-01'], ['mastered', null], ['progress', '2026-03-20'], ['unlocked', null], ['locked', null]]);
  });
});

describe('buildProgressMore', () => {
  it('builds every section on the fixture, with calm notes for what it lacks', () => {
    const r = buildProgressMore(readVault(fsIo(), VAULT, { asOf: DATE }), DATE);
    const t = r.training!;
    assert.deepEqual(t.weeks.map((w) => w.key), ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8']);
    assert.equal(t.weeks.find((w) => w.current)!.key, 'W6');
    assert.deepEqual(t.weeks.filter((w) => w.deload).map((w) => w.key), ['W4', 'W8']);
    assert.deepEqual(t.lifts.map((l) => l.name), ['Goblet Squat', 'Flat DB Bench Press', 'Romanian Deadlift', 'Seated Cable Row']);
    assert.deepEqual(t.notLogged, ['Barbell Back Squat']);
    assert.equal(t.lifts.find((l) => l.name === 'Flat DB Bench Press')!.stepFromPlan, true);
    assert.deepEqual(r.skills!.ladders.map((l) => [l.id, l.level]), [['pushup', 2], ['handstand', 3]]);
    assert.deepEqual(r.notes.map((n) => n.code), ['no-targets', 'one-photo-set', 'no-goals']);
  });
  it('measures against the profile’s targets when it has them', () => {
    const io = fsIo((p, text) => {
      if (!p.endsWith('Coach/profile.json') || !text) return text;
      const prof = JSON.parse(text);
      prof.targets = { waistDropCm: [4, 6], weightDropKg: [3, 5], rhrDropBpm: [3, 6], sleepHours: 7.5, tests: { pushups: 25, handstandS: 45 } };
      return JSON.stringify(prof);
    });
    const r = buildProgressMore(readVault(io, VAULT, { asOf: DATE }), DATE);
    assert.deepEqual(r.body!.targets.map((x) => [x.key, x.source]), [['waist', 'profile'], ['weight', 'profile'], ['rhr', 'profile'], ['steps', 'plan'], ['sleep', 'profile']]);
    assert.deepEqual(r.skills!.ladders.map((l) => l.goal), [25, 45]);
    assert.ok(!r.notes.some((n) => n.code === 'no-targets'));
  });
  it('accepts the profile’s targets in the schema, and refuses a range upside down', () => {
    const prof = JSON.parse(readFileSync(join(VAULT, '3-Personal/Fitness/Coach/profile.json'), 'utf8'));
    assert.deepEqual(validateProfile({ ...prof, targets: { waistDropCm: [4, 6], stepsPerDay: 8000, tests: { pushups: 25 } } }), []);
    assert.ok(validateProfile({ ...prof, targets: { waistDropCm: [6, 4] } }).length > 0);
  });
});
