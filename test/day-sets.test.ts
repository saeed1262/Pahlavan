// The day's set count, frozen with each session: a readiness or soreness
// trim (one set fewer) and Express's own sets are what the day called for,
// so logging every one of them at the top of the range earns the increase.
// The Log panel's save and `log add` write `daySets` beside each item's
// plan `sets`; the adapter reads it onto the snapshot slot; progression
// judges against it; an old entry, saved before the count was, is judged
// as before, on the sets it logged.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildLogEntry, mergeLog } from '../src/adapters/vault/log-write.ts';
import { readVault } from '../src/adapters/vault/read.ts';
import { run } from '../src/cli/cli.ts';
import { buildReview, buildSession, inputFromForm, logFormFor } from '../src/report/index.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

type Obj = Record<string, any>;
const DATE = '2026-04-10';
const LOG = 'v/3-Personal/Fitness/fitness-log-data.json';
const files = fixtureFiles('v');
const read = readVault(memoryIo(files, DATE), 'v', { asOf: DATE });
const ctx = { plan: read.raw!.plan, log: read.raw!.log, today: DATE };
const list = (e: Obj, name: string) => (e['exercises'] as Obj[]).find((x) => x['name'] === name);

/** The fixture with one more session in the log, read on the 12th; Goblet Squat's next target. */
function nextAfter(entry: Obj) {
  const m = mergeLog(files[LOG]!, entry, { mode: 'add' });
  assert.equal(m.result, 'added');
  const back = readVault(memoryIo({ ...files, [LOG]: m.text! }, '2026-04-12'), 'v', { asOf: '2026-04-12' });
  const lift = buildReview(back.data, '2026-04-12').lifts.find((l) => l.exercise === 'goblet-squat')!;
  return { back, next: lift.next! as { value: { action: string; weight: number }; reason: { note?: string; inputs: Obj } } };
}
// A session at Every set: Goblet Squat's sets at the top of its 8-10.
const goblet = (n: number) => Array.from({ length: n }, () => ({ weight: 55, unit: 'lb', reps: 10, rir: 3 }));
const fullEntry = (over: Obj, n: number) => {
  const r = buildLogEntry({ date: DATE, type: 'A', lift1: { name: 'Goblet Squat', weight: 55, reps: 10 }, lift2: { name: 'Flat DB Bench Press', weight: 0, reps: 0 }, trackingLevel: 'full', exerciseSets: [{ name: 'Goblet Squat', sets: goblet(n) }], ...over }, ctx);
  assert.ok(r.ok, r.ok ? '' : r.error);
  return r.entry;
};

describe('the day\'s set count, frozen with the session', () => {
  it('the Log panel\'s save writes the day\'s sets beside the plan\'s: a trimmed lift, Express\'s', () => {
    // On the 10th the session trims Goblet Squat to 3 of the plan's 4.
    const full = logFormFor(read, buildSession(read.data, DATE, 'full', { type: 'A' }), DATE)!;
    const e = buildLogEntry(inputFromForm(full), ctx);
    assert.ok(e.ok);
    assert.deepEqual(list(e.entry, 'Goblet Squat'), { name: 'Goblet Squat', sets: 4, daySets: 3 });
    assert.deepEqual(list(e.entry, 'Face Pull'), { name: 'Face Pull', sets: 3, daySets: 3 });
    assert.equal('daySets' in list(e.entry, 'Zone 2 finisher')!, false, 'cardio has no working sets');
    const ex = logFormFor(read, buildSession(read.data, DATE, 'express', { type: 'A' }), DATE)!;
    const x = buildLogEntry(inputFromForm(ex), ctx);
    assert.ok(x.ok);
    assert.deepEqual(list(x.entry, 'Flat DB Bench Press'), { name: 'Flat DB Bench Press', sets: 2, daySets: 2 });
  });

  it('a ladder item goes by its level that day', () => {
    const s1 = logFormFor(read, buildSession(read.data, DATE, 'full', { type: 'S1' }), DATE)!;
    const e = buildLogEntry(inputFromForm(s1), ctx);
    assert.ok(e.ok);
    assert.deepEqual(list(e.entry, 'Floor push-up'), { name: 'Floor push-up', sets: 4, daySets: 4 });
  });

  it('log add freezes it too, from the day\'s session', () => {
    const f = { ...files, 'v/s.json': JSON.stringify({ date: DATE, type: 'A', lift1: { name: 'Goblet Squat', weight: 55, reps: 10 }, lift2: { name: 'Flat DB Bench Press', weight: 55, reps: 6 } }) };
    const r = run(['log', 'add', '--file', 'v/s.json', '--vault', 'v'], memoryIo(f, '2026-04-12') as never);
    assert.equal(r.code, 0, r.stdout);
    const s = (JSON.parse(r.stdout) as Obj).session;
    assert.deepEqual(list(s, 'Goblet Squat'), { name: 'Goblet Squat', sets: 4, daySets: 3 });
  });

  it('the adapter reads it onto the snapshot slot; an old entry has none', () => {
    const { back } = nextAfter(fullEntry({ daySets: { 'Goblet Squat': 3 } }, 3));
    const slot = back.data.sessions.find((s) => s.date === DATE && s.template === 'a')!.plan!.slots.find((x) => x.exercise === 'goblet-squat') as Obj;
    assert.deepEqual([slot['sets'], slot['_daySets']], [4, 3]);
    const old = nextAfter(fullEntry({}, 3)).back.data.sessions.find((s) => s.date === DATE && s.template === 'a')!.plan!.slots.find((x) => x.exercise === 'goblet-squat') as Obj;
    assert.equal('_daySets' in old, false);
  });
});

describe('progression on the day\'s set count', () => {
  it('a trimmed day (plan 4, the day 3): all 3 at the top increase', () => {
    const { next } = nextAfter(fullEntry({ daySets: { 'Goblet Squat': 3 } }, 3));
    assert.equal(next.value.action, 'increase', next.reason.note);
    assert.deepEqual([next.reason.inputs['plannedSets'], next.reason.inputs['plannedFrom']], [3, 'day']);
  });

  it('the same day with 2 logged holds: "2 of 3 sets logged"', () => {
    const { next } = nextAfter(fullEntry({ daySets: { 'Goblet Squat': 3 } }, 2));
    assert.equal(next.value.action, 'hold');
    assert.match(next.reason.note ?? '', /2 of 3 sets logged: the weight goes up when every set reaches the top/);
  });

  it('an old entry without the day\'s count is judged as before: its 3 sets at the top increase', () => {
    const { next } = nextAfter(fullEntry({}, 3));
    assert.equal(next.value.action, 'increase', next.reason.note);
    assert.doesNotMatch(next.reason.note ?? '', /sets logged/);
    assert.deepEqual([next.reason.inputs['plannedSets'], next.reason.inputs['plannedFrom']], [4, 'plan']);
  });

  it('Express: the main lift\'s 2 working sets are the count', () => {
    const { next } = nextAfter(fullEntry({ express: true, lift2: { name: 'Flat DB Bench Press', weight: 0, reps: 0 }, daySets: { 'Goblet Squat': 2 } }, 2));
    assert.equal(next.value.action, 'increase', next.reason.note);
    assert.deepEqual([next.reason.inputs['plannedSets'], next.reason.inputs['plannedFrom']], [2, 'day']);
    // Without the day's count, Express's own list already says 2.
    const old = nextAfter(fullEntry({ express: true }, 2)).next;
    assert.deepEqual([old.value.action, old.reason.inputs['plannedSets'], old.reason.inputs['plannedFrom']], ['increase', 2, 'plan']);
  });
});
