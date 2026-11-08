import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { exerciseHistory } from '../src/core/history.ts';
import { nextTarget, type ProgressionInput } from '../src/core/progression.ts';
import type { LoggedSet, Session, TrackingLevel } from '../src/core/schema.ts';
import { session, set, slot } from './helpers.ts';

const KG = { unit: 'kg' as const, increment: 2.5 };
const LB = { unit: 'lb' as const, increment: 5 };
const SQ = slot('squat', 3, 5, 8, 2);

function input(sessions: Session[], extra: Partial<ProgressionInput> = {}): ProgressionInput {
  return { history: exerciseHistory(sessions, 'squat'), exercise: KG, repRange: [5, 8], targetRir: 2, ...extra };
}

const logged = (date: string, sets: LoggedSet[], level: TrackingLevel = 'standard', weekKind: 'loading' | 'deload' = 'loading') =>
  session(date, { level, logged: { squat: sets }, slots: [SQ], weekKind });

describe('double progression', () => {
  it('starts from scratch with no history', () => {
    const r = nextTarget(input([]));
    assert.deepEqual(r.value, { action: 'start', weight: null, unit: 'kg', reps: 5, rir: 2, assumedAllSets: false });
    assert.equal(r.reason.rule, 'progression.double');
    assert.match(r.reason.note ?? '', /First time/);
  });

  it('reports no-data when the exercise was done but never logged (Light)', () => {
    const r = nextTarget(input([session('2026-03-02', { level: 'light', slots: [SQ] })]));
    assert.equal(r.value.action, 'no-data');
    assert.equal(r.value.weight, null);
    assert.match(r.reason.note ?? '', /no load logged \(Light tracking\)/);
    const standard = nextTarget(input([session('2026-03-02', { level: 'standard', slots: [SQ] })]));
    assert.doesNotMatch(standard.reason.note ?? '', /Light/);
  });

  it('names the deload-week sessions after the last loading one, which it does not use', () => {
    const r = nextTarget(input([logged('2026-03-02', [set(60, 8)]), logged('2026-03-09', [set(55, 5)], 'standard', 'deload')]));
    assert.equal(r.value.action, 'increase');
    assert.deepEqual(r.reason.inputs['deloadSessionsNotUsed'], ['2026-03-09']);
    assert.match(r.reason.note ?? '', /not used: 2026-03-09 \(55 kg x 5\)/);
  });

  it('says so when the only logged sessions were in deload weeks', () => {
    const r = nextTarget(input([logged('2026-03-02', [set(50, 8)], 'standard', 'deload')]));
    assert.equal(r.value.action, 'no-data');
    assert.equal(r.reason.inputs['deloadSessionsLogged'], 1);
    assert.match(r.reason.note ?? '', /Logged only in deload weeks \(last 50 kg x 8 on 2026-03-02\)/);
  });

  it('adds the increment and resets to lo when every set reached hi', () => {
    const r = nextTarget(input([logged('2026-03-02', [set(60, 8, 'kg', 2), set(60, 8, 'kg', 2), set(60, 8, 'kg', 3)], 'full')]));
    assert.deepEqual(r.value, { action: 'increase', weight: 62.5, unit: 'kg', reps: 5, rir: 2, assumedAllSets: false });
  });

  it('assumes every set matched the top set at Standard tracking, and says so', () => {
    const r = nextTarget(input([logged('2026-03-02', [set(60, 8)])]));
    assert.equal(r.value.action, 'increase');
    assert.equal(r.value.assumedAllSets, true);
    assert.match(r.reason.note ?? '', /assumed to have matched it/);
    assert.match(r.reason.note ?? '', /stay at 60 kg/);
  });

  it('does not increase when one set fell short of hi (Full)', () => {
    const r = nextTarget(input([logged('2026-03-02', [set(60, 8, 'kg', 2), set(60, 8, 'kg', 2), set(60, 7, 'kg', 2)], 'full')]));
    assert.deepEqual([r.value.action, r.value.weight, r.value.reps], ['add-reps', 60, 8]);
  });

  it('adds a rep from the weakest set inside the range', () => {
    const r = nextTarget(input([logged('2026-03-02', [set(60, 7), set(60, 6), set(60, 6)], 'full')]));
    assert.deepEqual([r.value.action, r.value.weight, r.value.reps], ['add-reps', 60, 7]);
  });

  it('holds the weight when a set is under lo', () => {
    const r = nextTarget(input([logged('2026-03-02', [set(60, 6), set(60, 5), set(60, 4)], 'full')]));
    assert.deepEqual([r.value.action, r.value.weight, r.value.reps], ['hold', 60, 5]);
  });

  it('goes 10 % lighter, rounded to the step, after two misses in a row', () => {
    const r = nextTarget(input([logged('2026-03-02', [set(80, 4)]), logged('2026-03-05', [set(80, 4)])]));
    assert.deepEqual([r.value.action, r.value.weight, r.value.reps], ['lighter', 72.5, 5]);
    assert.match(r.reason.note ?? '', /9\.4 % lighter/);
  });

  it('drops one step when the step is too coarse for 10 %', () => {
    const db = { history: exerciseHistory([logged('2026-03-02', [set(20, 6, 'lb')]), logged('2026-03-05', [set(20, 6, 'lb')])], 'squat'), exercise: LB, repRange: [8, 12] as [number, number], targetRir: 2 };
    const r = nextTarget(db);
    assert.deepEqual([r.value.action, r.value.weight], ['lighter', 15]);
    assert.match(r.reason.note ?? '', /outside 5-10 %/);
  });

  it('needs the two misses to be consecutive', () => {
    const r = nextTarget(input([logged('2026-03-02', [set(80, 4)]), logged('2026-03-05', [set(80, 6)]), logged('2026-03-09', [set(80, 4)])]));
    assert.equal(r.value.action, 'hold');
  });

  it('holds at hi when hi was reached below the target RIR', () => {
    const r = nextTarget(input([logged('2026-03-02', [set(60, 8, 'kg', 1), set(60, 8, 'kg', 0)], 'full')]));
    assert.deepEqual([r.value.action, r.value.weight, r.value.reps], ['hold', 60, 8]);
    assert.match(r.reason.note ?? '', /less than 2 in reserve/);
  });

  it('treats a missing RIR as no objection', () => {
    const r = nextTarget(input([logged('2026-03-02', [set(60, 8), set(60, 8, 'kg', 2)], 'full')]));
    assert.equal(r.value.action, 'increase');
  });

  it('flags a logged RIR of 5 or more as unreliable', () => {
    const r = nextTarget(input([logged('2026-03-02', [set(60, 6, 'kg', 5)], 'full')]));
    assert.equal(r.value.action, 'add-reps');
    assert.match(r.reason.note ?? '', /RIR of 5 or more is unreliable/);
  });

  it('plans a deload about 10 % lighter at lo with RIR +3', () => {
    const r = nextTarget(input([logged('2026-03-02', [set(80, 8)])], { deload: true }));
    assert.deepEqual(r.value, { action: 'deload', weight: 72.5, unit: 'kg', reps: 5, rir: 5, assumedAllSets: true });
  });

  it('skips deload sessions when picking the last session', () => {
    const r = nextTarget(input([logged('2026-03-16', [set(80, 8)]), logged('2026-03-23', [set(72.5, 5)], 'standard', 'deload')]));
    assert.deepEqual([r.value.action, r.value.weight, r.value.reps], ['increase', 82.5, 5]);
  });

  it('converts a top set logged in the other unit and rounds to the step', () => {
    const h = exerciseHistory([logged('2026-03-02', [set(25, 10, 'kg')])], 'squat');
    const r = nextTarget({ history: h, exercise: LB, repRange: [8, 12], targetRir: 2 });
    assert.deepEqual([r.value.action, r.value.weight, r.value.unit, r.value.reps], ['add-reps', 55, 'lb', 11]);
    const up = nextTarget({ history: exerciseHistory([logged('2026-03-02', [set(25, 12, 'kg')])], 'squat'), exercise: LB, repRange: [8, 12], targetRir: 2 });
    assert.equal(up.value.weight, 60);
  });

  it('rounds base + increment to 0.5 like the dashboard, so an off-step base stays off-step', () => {
    const r = nextTarget(input([logged('2026-03-02', [set(52, 8)])]));
    assert.equal(r.value.weight, 54.5);
  });
});

describe('the load-jump cap in progression', () => {
  it('holds a 1.25 kg step to one increment and flags the big jump', () => {
    const micro = { unit: 'kg' as const, increment: 1.25 };
    const h = exerciseHistory([logged('2026-03-02', [set(10, 15)])], 'squat');
    const r = nextTarget({ history: h, exercise: micro, repRange: [12, 15], targetRir: 2 });
    // 10 + 1.25 = 11.25 rounds to 11.5 at the dashboard's 0.5; the cap allows one step, 11.25 (12.5 %, a big jump).
    assert.deepEqual([r.value.action, r.value.weight, r.value.reps], ['increase', 11.25, 12]);
    assert.deepEqual(r.reason.inputs['loadCap'], { proposed: 11.5, limit: 11.25, bigJump: true, binding: 'session' });
    assert.match(r.reason.note ?? '', /start at the bottom of the range/);
  });

  it('leaves a normal increase alone', () => {
    const r = nextTarget(input([logged('2026-03-02', [set(60, 8)])]));
    assert.equal(r.reason.inputs['loadCap'], undefined);
  });

  it('stops linear progression at about 10 % a week', () => {
    const three = [logged('2026-03-02', [set(40, 5)]), logged('2026-03-04', [set(42.5, 5)]), logged('2026-03-06', [set(45, 5)])];
    const r = nextTarget({ ...input(three), repRange: [5, 5], rule: { rule: 'linear', step: 2.5 }, date: '2026-03-07' });
    assert.equal(r.reason.rule, 'progression.linear');
    assert.equal(r.value.weight, 45);
    assert.equal((r.reason.inputs['loadCap'] as { binding: string }).binding, 'week');
    const later = nextTarget({ ...input(three), repRange: [5, 5], rule: { rule: 'linear', step: 2.5 }, date: '2026-03-13' });
    assert.equal(later.value.weight, 47.5);
  });

  it('uses the linear step when it is bigger than the increment, still one step at most', () => {
    const r = nextTarget({ ...input([logged('2026-03-02', [set(100, 5)])]), repRange: [5, 5], rule: { rule: 'linear', step: 5 }, date: '2026-03-09' });
    assert.equal(r.value.weight, 102.5); // a 5 kg step on a 2.5 kg increment: capped to one increment
  });

  it('moves a ladder slot to its next variation instead of adding load', () => {
    const r = nextTarget({ ...input([logged('2026-03-02', [set(0, 12), set(0, 12)], 'full')]), repRange: [8, 12], rule: { rule: 'ladder', next: 'decline-push-up' } });
    assert.deepEqual([r.value.action, r.value.weight, r.value.reps], ['next-variation', 0, 8]);
    assert.equal(r.reason.inputs['next'], 'decline-push-up');
  });
});

// A lift's standing rule from plan-data.json (`lifts[name].progression`): the
// plan's own does the rule's arithmetic and sets the step; the old default is
// cited and keeps the load cap.
describe('the plan\'s lift rules', () => {
  const plan = (rule: Record<string, unknown>, from = 'The plan\'s rule: test.') => ({
    standing: { rule: { onMiss: { after: 2, drop: 0.1 }, onStall: 'report', ...rule } as never, source: 'plan' as const, from: { kind: 'plan' as const, path: 'lifts["Squat"].progression', text: from } },
  });

  it('cites the rule, the plan\'s or the old default', () => {
    const r = nextTarget(input([logged('2026-03-02', [set(60, 6)])], plan({ rule: 'double' })));
    assert.equal(r.reason.rule, 'progression.double');
    assert.match(r.reason.note ?? '', /^The plan's rule: test\. Inside the range/);
    const legacy = nextTarget(input([logged('2026-03-02', [set(60, 6)])], { standing: { rule: { rule: 'double', onMiss: { after: 2, drop: 0.1 }, onStall: 'report' }, source: 'legacy-default', from: { kind: 'legacy-default', path: 'x', text: 'Pahlavan\'s default (the plan sets none): double.' } } }));
    assert.deepEqual(legacy.value, nextTarget(input([logged('2026-03-02', [set(60, 6)])])).value);
    assert.equal(legacy.reason.from?.kind, 'legacy-default');
  });

  it('linear: the weight up every session each set reaches the top, the reps stay there', () => {
    const up = nextTarget(input([logged('2026-03-02', [set(60, 8, 'kg', 2), set(60, 8, 'kg', 2)], 'full')], plan({ rule: 'linear' })));
    assert.deepEqual([up.value.action, up.value.weight, up.value.reps, up.reason.rule], ['increase', 62.5, 8, 'progression.linear']);
    const short = nextTarget(input([logged('2026-03-02', [set(60, 8, 'kg', 2), set(60, 7, 'kg', 2)], 'full')], plan({ rule: 'linear' })));
    assert.deepEqual([short.value.action, short.value.weight, short.value.reps], ['hold', 60, 8]);
  });

  it('hold: reps up to the top, never a weight step', () => {
    const r = nextTarget(input([logged('2026-03-02', [set(60, 8, 'kg', 2), set(60, 8, 'kg', 2)], 'full')], plan({ rule: 'hold' })));
    assert.deepEqual([r.value.action, r.value.weight, r.value.reps], ['hold', 60, 8]);
    assert.match(r.reason.note ?? '', /adds no weight/);
  });

  it('target: the coach\'s numbers, met or not, never moved on', () => {
    const t = plan({ rule: 'target', target: { weight: 70, reps: 6, rir: 2 } });
    const before = nextTarget(input([logged('2026-03-02', [set(65, 6)])], t));
    assert.deepEqual([before.value.action, before.value.weight, before.value.reps, before.value.rir, before.value.targetMet], ['target', 70, 6, 2, false]);
    const met = nextTarget(input([logged('2026-03-02', [set(70, 6)])], t));
    assert.deepEqual([met.value.weight, met.value.targetMet], [70, true]);
    assert.match(met.reason.note ?? '', /holds until the coach sets the next one/);
    const fresh = nextTarget(input([], t));
    assert.deepEqual([fresh.value.action, fresh.value.weight], ['target', 70]);
  });

  it('onMiss: after the rule\'s sessions, the rule\'s drop; or hold', () => {
    const one = nextTarget(input([logged('2026-03-02', [set(80, 4)])], plan({ rule: 'double', onMiss: { after: 1, drop: 0.05 } })));
    assert.deepEqual([one.value.action, one.value.weight], ['lighter', 75]);
    assert.match(one.reason.note ?? '', /^The plan's rule: test\. A session under 5 reps: 75 kg x 5, 6\.3 % lighter\./);
    const hold = nextTarget(input([logged('2026-03-02', [set(80, 4)]), logged('2026-03-05', [set(80, 4)])], plan({ rule: 'double', onMiss: 'hold' })));
    assert.deepEqual([hold.value.action, hold.value.weight], ['hold', 80]);
  });

  it('the plan\'s step is never capped: an increase over the load-jump guide is reported', () => {
    const big = { unit: 'kg' as const, increment: 10 };
    const sessions = [logged('2026-03-02', [set(40, 8)])];
    const legacy = nextTarget(input(sessions, { exercise: big, date: '2026-03-03' }));
    const own = nextTarget(input(sessions, { exercise: big, date: '2026-03-03', ...plan({ rule: 'double' }) }));
    assert.equal(legacy.reason.title, 'Big jump');
    assert.equal(own.value.weight, 50);
    assert.equal((own.reason.inputs['loadCap'] as { applied: boolean }).applied, false);
    assert.match(own.reason.note ?? '', /reported, the plan's rule sets the step/);
  });
});
