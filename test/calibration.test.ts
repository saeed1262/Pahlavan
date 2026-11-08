// The calibration week: one rule (calibration.ts) for plan week 1 and the
// first week back after a restart. Its items carry the calibration RIR, every
// target holds the weight there and nothing proposes an increase or calls a
// stall until the week after; an export dated inside it writes the ordinary
// loading week. On the synthetic vault, whose plan week 1 is 2 to 8 March.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { CALIBRATION, calibrateSlot, calibrateTarget, calibrationNote, calibrationStall } from '../src/core/calibration.ts';
import { toPlanData, type PlanData } from '../src/core/plan-data.ts';
import { planText } from '../src/report/dashboard.ts';
import type { ProgressionTarget } from '../src/core/progression.ts';
import type { Stall } from '../src/core/stall.ts';
import type { Result } from '../src/core/reason.ts';
import { legacyRules, ruleText } from '../src/core/rules.ts';
import { buildReview, buildSession, logFormFor } from '../src/report/index.ts';
import { fixtureFiles, fsIo, memoryIo, VAULT } from './helpers.ts';

const WEEK1 = '2026-03-05';
const WEEK2 = '2026-03-10';
const at = (date: string) => readVault(fsIo, VAULT, { asOf: date });
const plan = JSON.parse(readFileSync(join(VAULT, '3-Personal', 'Fitness', 'plan-data.json'), 'utf8')) as PlanData;
const increase: ProgressionTarget = { action: 'increase', weight: 45, unit: 'lb', reps: 8, rir: 2, assumedAllSets: true };
type Lift = ReturnType<typeof buildReview>['lifts'][number] & { heldProgression?: Result<ProgressionTarget> };

describe('the calibration rule', () => {
  it('says its number from one constant', () => {
    assert.equal(calibrationNote(), `find a load that leaves ${CALIBRATION.rir} reps in reserve at the bottom of each range; no progression or stall decisions`);
    const slot = { exercise: 'x', rir: 2 };
    const c = calibrateSlot(slot);
    assert.deepEqual([c.rir, slot.rir, c === slot], [CALIBRATION.rir, 2, false], 'a copy at the calibration RIR');
    assert.equal(calibrateSlot({ rir: CALIBRATION.rir + 1 }).rir, CALIBRATION.rir + 1, 'an easier RIR stays');
  });

  it('holds the weight at the bottom of the range, never adds to it, and names what progression wanted', () => {
    const r = calibrateTarget(increase, { lastWeight: 40, repRange: [8, 10], source: 'plan' });
    assert.deepEqual(r.value, { action: 'calibrate', weight: 40, unit: 'lb', reps: 8, rir: CALIBRATION.rir, assumedAllSets: true });
    assert.equal(r.reason.rule, 'calibration.target');
    assert.match(r.reason.note ?? '', /Held for now: progression's increase \(45 lb x 8 at RIR 2\)/);
    // A target already lighter keeps its lighter weight; an easier RIR stays.
    assert.equal(calibrateTarget({ ...increase, action: 'lighter', weight: 35 }, { lastWeight: 40, repRange: [8, 10], source: 'plan' }).value.weight, 35);
    assert.equal(calibrateTarget({ ...increase, rir: 4 }, { lastWeight: 40, repRange: [8, 10], source: 'plan' }).value.rir, 4);
  });

  it('gives no weight without one to hold; after a restart, holds only the weight found since', () => {
    const none = calibrateTarget({ ...increase, action: 'start', weight: null }, { lastWeight: null, repRange: [6, 8], source: 'plan' });
    assert.deepEqual([none.value.action, none.value.weight, none.value.reps, none.value.rir], ['calibrate', null, 6, CALIBRATION.rir]);
    const back = calibrateTarget(increase, { lastWeight: null, repRange: [8, 10], source: 'restart' });
    assert.deepEqual([back.value.weight, back.value.reps], [null, 8]);
    assert.match(back.reason.note ?? '', /back after time off.*Start lighter than before/);
    const found = calibrateTarget(increase, { lastWeight: 40, repRange: [8, 10], source: 'restart' });
    assert.equal(found.value.weight, 40);
    assert.match(found.reason.note ?? '', /the weight found since coming back, held/);
  });

  it('calls no stall, naming the one the trend alone would call', () => {
    const stalled: Result<Stall> = { value: { stalled: true, status: 'stalled', kind: 'plateau', change: 0.01, adherence: 0.9 }, reason: { rule: 'stall.detect', title: 'Stall', inputs: {}, note: 'a stall (inside the noise band).' } };
    const r = calibrationStall(stalled, 'plan');
    assert.deepEqual([r.value.stalled, r.value.status, r.value.change], [false, 'calibration', 0.01]);
    assert.match(r.reason.note ?? '', /no stall decision.*The trend alone: a stall/);
  });
});

describe('plan week 1 on the vault', () => {
  const week1 = at(WEEK1);
  const weeks = week1.data.program.macrocycle.phases.flatMap((p) => p.mesocycles.flatMap((m) => m.weeks));
  const strength = (id: string) => (week1.data.program.exercises[id]?.kind ?? 'strength') === 'strength';

  it('carries the calibration RIR on every strength item; week 2 keeps the plan\'s own', () => {
    assert.equal(weeks[0]!.calibration, true);
    for (const t of weeks[0]!.sessions) for (const s of t.slots.filter((x) => strength(x.exercise))) assert.ok(s.rir >= CALIBRATION.rir, `${t.id} ${s.exercise} RIR ${s.rir}`);
    const goblet = (w: number) => weeks[w]!.sessions.find((t) => t.id === 'a')!.slots.find((s) => s.exercise === 'goblet-squat')!.rir;
    assert.deepEqual([goblet(0), goblet(1)], [CALIBRATION.rir, 2]);
    for (const type of ['A', 'B']) {
      const s = buildSession(week1.data, WEEK1, 'full', { type });
      for (const it of s.items.filter((x) => strength(x.exercise))) assert.ok(it.rir >= CALIBRATION.rir, `${type} ${it.name} RIR ${it.rir}`);
      // The rule's citation says it all, once: no second sentence repeating it.
      assert.ok(s.flags.some((f) => f.note === `Pahlavan's default (the plan sets none): ${ruleText('calibration', legacyRules())}.`));
    }
  });

  it('calibrates every target: the weight held, the bottom of the range, no increase and no stall', () => {
    const review = buildReview(week1.data, WEEK1);
    const lifts = review.lifts as Lift[];
    assert.ok(lifts.length >= 4);
    for (const l of lifts) {
      const n = l.next.value as ProgressionTarget;
      assert.equal(n.action, 'calibrate', l.name);
      assert.ok(n.weight === null || (l.last !== null && n.weight <= l.last.weight), `${l.name}: never above the last weight`);
      assert.deepEqual([n.reps, n.rir >= CALIBRATION.rir], [l.repRange![0], true], l.name);
      assert.ok(l.heldProgression, `${l.name}: what progression would have given`);
      assert.equal(l.stall.value.status, 'calibration');
      assert.equal('returnAdjusted' in l, false);
    }
    // The goblet squat reached the top of its range on 2 March: progression's increase waits.
    const goblet = lifts.find((l) => l.exercise === 'goblet-squat')!;
    assert.deepEqual([goblet.heldProgression!.value.action, goblet.heldProgression!.value.weight, goblet.heldProgression!.value.rir], ['increase', 45, 2]);
    assert.deepEqual((({ weight, reps, rir }) => ({ weight, reps, rir }))(goblet.next.value as ProgressionTarget), { weight: 40, reps: 8, rir: CALIBRATION.rir });
    assert.deepEqual([review.deload!.reason.inputs['stalledMainLifts'], review.deload!.value.triggers.includes('stalls')], [[], false]);
    // Today's targets are the calibrated ones.
    const a = buildSession(week1.data, WEEK1, 'full', { type: 'A' });
    assert.deepEqual(a.items.find((x) => x.exercise === 'goblet-squat')!.target, { weight: 40, unit: 'lb', reps: 8, rir: CALIBRATION.rir, action: 'calibrate' });
  });

  it('is back to progression in week 2', () => {
    const review = buildReview(at(WEEK2).data, WEEK2);
    const lifts = review.lifts as Lift[];
    for (const l of lifts) {
      assert.notEqual((l.next.value as ProgressionTarget).action, 'calibrate', l.name);
      assert.equal(l.heldProgression, undefined);
      assert.notEqual(l.stall.value.status, 'calibration');
    }
    const goblet = lifts.find((l) => l.exercise === 'goblet-squat')!.next.value as ProgressionTarget;
    assert.deepEqual([goblet.action, goblet.weight, goblet.reps, goblet.rir], ['add-reps', 45, 10, 2]);
  });

  it('copies today\'s plan as Today shows it: the calibration line, the held weight, RIR 3', () => {
    const s = buildSession(week1.data, WEEK1, 'full', { type: 'A' });
    const copy = planText({ plan: week1.raw!.plan, log: week1.raw!.log, date: WEEK1, type: 'A', express: false, deload: false, dayLabel: 'Thursday', shortDay: (d) => d, session: s });
    const lines = copy.split('\n');
    assert.equal(lines[1], `Calibration week: ${calibrationNote()}.`);
    assert.ok(lines.includes(`   start at 50 lb × 6 @ RIR ${CALIBRATION.rir}`), 'the bench press held at 50 lb');
    assert.doesNotMatch(copy, /next \d|RIR 2\b/);
  });

  it('exports week 2 when asked for a date in the calibration week, and says so', () => {
    const r = toPlanData(week1.data.program, { date: WEEK1 });
    assert.equal(r.value.week.start, '2026-03-09');
    assert.deepEqual(r.value.planData.sessions, plan.sessions);
    assert.ok(r.value.unexpressible.some((u) => u.what === 'calibration week' && u.detail.includes(calibrationNote())));
  });
});

/** The synthetic vault (last session Sat 11 April) with sessions after a 3+ week gap, read on `date`. */
function backFrom(sessions: { date: string; rdl: number; row: number }[], date: string) {
  const f = fixtureFiles('v');
  const key = Object.keys(f).find((k) => k.endsWith('fitness-log-data.json'))!;
  const log = JSON.parse(f[key]!) as { sessions: unknown[] };
  for (const x of sessions) log.sessions.push({ date: x.date, type: 'B', lift1: { name: 'Romanian Deadlift', weight: x.rdl, reps: 8, unit: 'kg' }, lift2: { name: 'Seated Cable Row', weight: x.row, reps: 8, unit: 'lb' } });
  f[key] = JSON.stringify(log);
  return readVault(memoryIo(f, date), 'v', { asOf: date });
}

describe('the first week back after a restart', () => {
  it('lasts 7 days from the first session back, holding the weight found that week', () => {
    for (const date of ['2026-05-06', '2026-05-10']) {
      const r = backFrom([{ date: '2026-05-04', rdl: 50, row: 90 }], date);
      const review = buildReview(r.data, date);
      assert.deepEqual([review.missed.value.protocol, review.missed.value.backOn, review.missed.value.firstWeek], ['restart', '2026-05-04', { from: '2026-05-04', to: '2026-05-10' }], date);
      const next = (id: string) => review.lifts.find((l) => l.exercise === id)!.next.value as ProgressionTarget;
      assert.deepEqual([next('romanian-deadlift').action, next('romanian-deadlift').weight], ['calibrate', 50], `${date}: the weight found on 4 May, held`);
      assert.deepEqual([next('goblet-squat').action, next('goblet-squat').weight], ['calibrate', null], `${date}: nothing from before the gap`);
      assert.ok(review.missed.reason.note?.includes(calibrationNote()));
    }
    // The day after it ends: the plan as before, from the week's sets.
    const after = buildReview(backFrom([{ date: '2026-05-04', rdl: 50, row: 90 }], '2026-05-11').data, '2026-05-11');
    assert.equal(after.missed.value.protocol, 'continue');
    assert.notEqual((after.lifts.find((l) => l.exercise === 'romanian-deadlift')!.next.value as ProgressionTarget).action, 'calibrate');
  });

  it('shows the calibration RIR on the items, the targets, the log form and the copy', () => {
    const date = '2026-05-06';
    const r = backFrom([{ date: '2026-05-04', rdl: 50, row: 90 }], date);
    const s = buildSession(r.data, date, 'full', { type: 'A' });
    const strength = (id: string) => (r.data.program.exercises[id]?.kind ?? 'strength') === 'strength';
    for (const it of s.items.filter((x) => strength(x.exercise))) {
      assert.ok(it.rir >= CALIBRATION.rir, `${it.name} RIR ${it.rir}`);
      if (it.target) assert.equal(it.target.rir, it.rir, `${it.name}: the row and its target agree`);
    }
    const goblet = logFormFor(r, s, date)!.rows.find((x) => x.line === 'Goblet Squat')!;
    assert.deepEqual([goblet.target?.weight, goblet.target?.reps, goblet.target?.calibrate], [null, 8, true]);
    assert.match(goblet.targetNote ?? '', /^Calibration week: find a weight that leaves \d reps in reserve at 8 reps\.$/);
    const copy = planText({ plan: r.raw!.plan, log: r.raw!.log, date, type: 'A', express: false, deload: false, dayLabel: 'Wed', shortDay: (d) => d, session: s });
    assert.ok(copy.split('\n')[1] === `Calibration week: ${calibrationNote()}.`);
    assert.match(copy, /find a weight for 6 reps @ RIR \d/);
  });

  it('starts each lift\'s e1RM trend at the first session back, so lighter sets are not a decline', () => {
    const date = '2026-05-14';
    const r = backFrom([{ date: '2026-05-04', rdl: 50, row: 90 }, { date: '2026-05-08', rdl: 55, row: 100 }, { date: '2026-05-13', rdl: 55, row: 100 }], date);
    const review = buildReview(r.data, date);
    const rdl = review.lifts.find((l) => l.exercise === 'romanian-deadlift')!;
    assert.ok(rdl.e1rm.value.points.every((p) => p.date >= '2026-05-04'));
    assert.ok(Number(rdl.e1rm.reason.inputs['leftOut']) > 0);
    assert.match(rdl.e1rm.reason.note ?? '', /before the calibration week of .* left out/);
    assert.notEqual(rdl.e1rm.value.verdict, 'down');
    assert.equal(rdl.stall.value.stalled, false);
    assert.deepEqual(review.deload!.reason.inputs['stalledMainLifts'], []);
  });

  it('is no calibration week in a vault with no plan start', () => {
    const f = fixtureFiles('v');
    for (const k of Object.keys(f)) if (/Baseline - .*\.md$/.test(k)) delete f[k];
    const key = Object.keys(f).find((k) => k.endsWith('fitness-log-data.json'))!;
    const log = JSON.parse(f[key]!) as { sessions: Record<string, unknown>[] };
    log.sessions = log.sessions.map((x) => ({ ...x, type: 'custom', label: 'Gym' }));
    f[key] = JSON.stringify(log);
    const date = '2026-04-14';
    const r = readVault(memoryIo(f, date), 'v', { asOf: date });
    const review = buildReview(r.data, date);
    assert.deepEqual([r.data.plan.start, review.week.planWeek, review.missed.value.protocol], [null, null, 'continue']);
    const first = r.data.program.macrocycle.phases[0]!.mesocycles[0]!.weeks[0]!;
    assert.equal(first.calibration, undefined, 'no calibration week without a start');
    for (const l of review.lifts) {
      assert.notEqual((l.next.value as ProgressionTarget | null)?.action, 'calibrate', l.name);
      assert.notEqual(l.stall.value.status, 'calibration', l.name);
    }
  });

  it('calibrates every target with no weight carried over', () => {
    const date = '2026-05-04'; // more than three weeks after the synthetic log's last session, in plan week 10
    const review = buildReview(at(date).data, date);
    assert.deepEqual([review.missed.value.protocol, review.week.planWeek], ['restart', 10]);
    for (const l of review.lifts as Lift[]) {
      const n = l.next.value as ProgressionTarget;
      assert.deepEqual([n.action, n.weight, n.reps, n.rir], ['calibrate', null, l.repRange![0], CALIBRATION.rir], l.name);
      assert.ok(l.heldProgression);
      assert.equal(l.stall.value.status, 'calibration');
    }
  });
});
