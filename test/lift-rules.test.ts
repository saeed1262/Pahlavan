// A logged lift's progression rule in plan-data.json (`lifts[name].progression`)
// through the review: the rule's arithmetic, cited, and the stall response
// the rule names.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { paths } from '../src/adapters/vault/layout.ts';
import type { PlanData } from '../src/core/plan-data.ts';
import { buildTemplate } from '../src/report/checkin.ts';
import { buildReview, liftLoad } from '../src/report/review.ts';
import { buildSession } from '../src/report/session.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

const PLAN = `v/${paths().plan}`;

function vault(progression: Record<string, unknown> | null, asOf = '2026-04-12', rules?: Record<string, unknown>) {
  const f = fixtureFiles('v');
  const doc = JSON.parse(f[PLAN]!) as PlanData;
  if (progression) doc.lifts['Flat DB Bench Press'] = { ...doc.lifts['Flat DB Bench Press']!, progression };
  if (rules) doc.rules = rules;
  f[PLAN] = `${JSON.stringify(doc, null, 2)}\n`;
  return readVault(memoryIo(f, asOf), 'v', { asOf }).data;
}

const bench = (r: ReturnType<typeof buildReview>) => r.lifts.find((l) => l.name === 'Flat DB Bench Press')!;

describe('a lift\'s progression rule in the review', () => {
  it('is named on the lift and cited by its target', () => {
    const r = buildReview(vault({ rule: 'linear' }), '2026-04-08');
    const l = bench(r);
    assert.equal(l.progressionRule!.source, 'plan');
    assert.equal(l.progressionRule!.path, 'lifts["Flat DB Bench Press"].progression');
    assert.match(l.next!.reason.note ?? '', /^The plan's rule: linear progression at 8 reps, \+5 lb every session every set reaches 8/);
    assert.equal(l.next!.reason.rule, 'progression.linear');
    assert.equal(r.rules.lifts['Flat DB Bench Press']!.source, 'plan');
    assert.equal(r.rules.lifts['Goblet Squat']!.source, 'legacy-default');
  });

  it('a stall the rule answers with a lighter weight: the reset, cited, with what progression gave beside it', () => {
    const r = buildReview(vault({ rule: 'double', onMiss: 'hold', onStall: { drop: 0.1 } }), '2026-04-12');
    const l = bench(r);
    assert.equal(l.stall.value.stalled, true);
    const n = l.next!.value as { action: string; weight: number };
    const before = (l as { stallReset?: { value: { action: string; weight: number } } }).stallReset!.value;
    assert.equal(n.action, 'lighter');
    assert.equal(before.action, 'hold');
    assert.ok(n.weight < before.weight);
    assert.match(l.next!.reason.note ?? '', /^The plan's rule: double progression .*; a stall -> about 10 % lighter\. Stalled/);
  });

  it('takes the drop once per stall: logging each target after a reset, the weight never falls again', () => {
    const f = fixtureFiles('v');
    const doc = JSON.parse(f[PLAN]!) as PlanData;
    for (const k of Object.keys(doc.lifts)) doc.lifts[k] = { ...doc.lifts[k]!, progression: { rule: 'double', onStall: { drop: 0.1 } } };
    f[PLAN] = `${JSON.stringify(doc, null, 2)}\n`;
    const LOG = `v/${paths().log}`;
    const weights: number[] = [];
    // Plan week 8 (from 20 Apr) is a light week: its lighter target is the light week's, not a stall's.
    for (const date of ['2026-04-10', '2026-04-13', '2026-04-15', '2026-04-17', '2026-04-22', '2026-04-27', '2026-04-29']) {
      const r = buildReview(readVault(memoryIo(f, date), 'v', { asOf: date }).data, date);
      const t = bench(r).next!.value as { weight: number; reps: number; action: string };
      if (t.action !== 'deload') weights.push(t.weight);
      const log = JSON.parse(f[LOG]!) as { sessions: unknown[] };
      log.sessions.push({ date, type: 'A', lift1: { name: 'Goblet Squat', weight: 55, reps: 9, unit: 'lb' }, lift2: { name: 'Flat DB Bench Press', weight: t.weight, reps: t.reps, unit: 'lb' } });
      f[LOG] = JSON.stringify(log);
    }
    assert.ok(weights[0]! < 60, `the first target answers the stall (${weights.join(', ')})`);
    for (let i = 1; i < weights.length; i++) assert.ok(weights[i]! >= weights[i - 1]!, `never lighter again: ${weights.join(', ')}`);
  });

  it('the session shows the rule\'s target', () => {
    const data = vault({ rule: 'target', target: { weight: 50, reps: 6, rir: 2 } });
    const s = buildSession(data, '2026-04-09', 'full', { type: 'A' });
    const item = s.items.find((i) => i.name === 'Flat DB Bench Press')!;
    assert.deepEqual([item.target?.weight, item.target?.reps, item.target?.action], [50, 6, 'target']);
    const r = buildReview(data, '2026-04-09');
    assert.equal((bench(r).next!.value as { action: string }).action, 'target');
  });
});

describe('the plan\'s stall response', () => {
  it('triage (the old default): the ladder picks a step, citing the rule, and the check-in pre-fills it', () => {
    const data = vault(null);
    const l = bench(buildReview(data, '2026-04-12'));
    assert.ok(l.triage!.some((t) => t.value.chosen));
    assert.equal(l.triage![0]!.reason.from?.path, 'rules.stall');
    const t = buildTemplate(data, '2026-04-12', null);
    assert.equal(((t.record as { triage: unknown[] }).triage).length, 1);
  });

  it('report: no step chosen, the facts for the coach, and nothing pre-filled', () => {
    const data = vault(null, '2026-04-12', { stall: { response: 'report' } });
    const l = bench(buildReview(data, '2026-04-12'));
    assert.equal(l.stall.value.stalled, true, 'the stall itself is the same calculation');
    assert.equal(l.triage, null);
    assert.match(l.stallFacts!.reason.note ?? '', /^The plan's rule: a stall is reported with its facts; the coach picks the response at the check-in\. Flat DB Bench Press has stalled/);
    assert.ok('weeksToMesocycleEnd' in l.stallFacts!.value);
    const t = buildTemplate(data, '2026-04-12', null);
    assert.deepEqual((t.record as { triage: unknown[] }).triage, []);
    const q = t.ask.find((x) => x.topic === 'triage')!;
    assert.match(q.answer ?? '', /Nothing is pre-filled/);
  });
});

// The gym's real weights (profile.loads) under a stall reset and a ladder slot.
describe('a lift\'s rule on the gym\'s real weights', () => {
  const PROFILE = `v/${paths().profile}`;
  function withKit(loads: unknown, progression: Record<string, unknown>, asOf = '2026-04-12') {
    const f = fixtureFiles('v');
    const doc = JSON.parse(f[PLAN]!) as PlanData;
    doc.lifts['Flat DB Bench Press'] = { ...doc.lifts['Flat DB Bench Press']!, progression };
    f[PLAN] = `${JSON.stringify(doc, null, 2)}\n`;
    const p = JSON.parse(f[PROFILE]!);
    p.loads = loads;
    f[PROFILE] = JSON.stringify(p);
    return readVault(memoryIo(f, asOf), 'v', { asOf }).data;
  }

  it('a stall reset lands on the nearest real weight under the base', () => {
    const l = bench(buildReview(withKit({ unit: 'lb', dumbbell: { from: 5, to: 80, step: 5 } }, { rule: 'double', onMiss: 'hold', onStall: { drop: 0.1 } }), '2026-04-12'));
    const n = l.next!.value as { action: string; weight: number };
    assert.deepEqual([n.action, n.weight], ['lighter', 55]);
  });

  it('a stall reset at the lightest weight: no reset, and the note says there is nothing lighter', () => {
    const l = bench(buildReview(withKit({ unit: 'lb', dumbbell: { weights: [60, 65, 70] } }, { rule: 'double', onMiss: 'hold', onStall: { drop: 0.1 } }), '2026-04-12'));
    assert.equal(l.stall.value.stalled, true);
    const n = l.next!.value as { action: string; weight: number };
    assert.notEqual(n.action, 'lighter');
    assert.equal(n.weight, 60);
    assert.equal((l as { stallReset?: unknown }).stallReset ?? null, null);
    assert.match(l.next!.reason.note ?? '', /the lightest dumbbell here is 60 lb: nothing lighter to reset to/);
  });

  it('a ladder slot never snaps: its load carries no real weights, as progression reads it', () => {
    const ex = { name: 'Kettlebell Swing', unit: 'kg' as const, increment: 4, equipment: 'kettlebell', weights: [8, 12, 16, 20, 24] };
    assert.deepEqual(liftLoad(ex, 'kg', 4, { progression: { rule: 'ladder', next: 'kb-snatch' } }), { unit: 'kg', increment: 4 });
    assert.deepEqual(liftLoad(ex, 'kg', 4, { progression: { rule: 'double' } }), { unit: 'kg', increment: 4, weights: [8, 12, 16, 20, 24], kit: 'kettlebell' });
    assert.deepEqual(liftLoad(ex, 'kg', 4, null), { unit: 'kg', increment: 4, weights: [8, 12, 16, 20, 24], kit: 'kettlebell' });
    assert.deepEqual(liftLoad(ex, 'lb', 10, null), { unit: 'lb', increment: 10 }, 'weights in another unit than the lift are not used');
  });
});
