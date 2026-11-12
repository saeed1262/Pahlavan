import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { exerciseHistory } from '../src/core/history.ts';
import { weightsFor } from '../src/core/loads.ts';
import { applyReturn } from '../src/core/missed.ts';
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
    const r = nextTarget(input([logged('2026-03-02', [set(60, 8), set(60, 8, 'kg', 2), set(60, 8)], 'full')]));
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
  it('keeps a 1.25 kg step exact and flags the big jump', () => {
    const micro = { unit: 'kg' as const, increment: 1.25 };
    const h = exerciseHistory([logged('2026-03-02', [set(10, 15)])], 'squat');
    const r = nextTarget({ history: h, exercise: micro, repRange: [12, 15], targetRir: 2 });
    // 10 + 1.25 = 11.25, kept exact (a step finer than the dashboard's 0.5 keeps its own); one step, 12.5 %: a big jump.
    assert.deepEqual([r.value.action, r.value.weight, r.value.reps], ['increase', 11.25, 12]);
    assert.deepEqual(r.reason.inputs['loadCap'], { proposed: 11.25, limit: 11.25, bigJump: true, binding: 'none' });
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
    const r = nextTarget({ ...input([logged('2026-03-02', [set(0, 12), set(0, 12), set(0, 12)], 'full')]), repRange: [8, 12], rule: { rule: 'ladder', next: 'decline-push-up' } });
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
    const up = nextTarget(input([logged('2026-03-02', [set(60, 8, 'kg', 2), set(60, 8, 'kg', 2), set(60, 8, 'kg', 2)], 'full')], plan({ rule: 'linear' })));
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

// The gym's real weights (profile.loads, loads.ts): every target lands on one.
describe('targets on the gym\'s real weights', () => {
  const DB = weightsFor('dumbbell', { unit: 'kg', dumbbell: { from: 2, to: 30, step: 2 } }, 'kg')!;
  const BAR = weightsFor('barbell', { unit: 'kg', barbell: { bar: 20, plates: [20, 10, 5, 2.5, 1.25] } }, 'kg')!;
  const dumbbells = (increment: number) => ({ unit: 'kg' as const, increment, weights: DB, kit: 'dumbbell' as const });
  const top = (date: string, w: number) => logged(date, [set(w, 8)]);

  it('an increase goes to the next real weight up: 20 kg dumbbells at the top of the range give 22, not 21', () => {
    const r = nextTarget(input([top('2026-03-02', 20)], { exercise: dumbbells(1) }));
    assert.deepEqual([r.value.action, r.value.weight, r.value.reps], ['increase', 22, 5]);
    assert.deepEqual(r.reason.inputs['realWeights'], { lightest: 2, heaviest: 30 });
    assert.equal(r.reason.inputs['loadCap'], undefined, 'one real step is one step');
    const coarse = nextTarget(input([top('2026-03-02', 20)], { exercise: dumbbells(2.5) }));
    assert.equal(coarse.value.weight, 22, 'not 22.5');
  });

  it('a barbell with plates down to 1.25: a 61.25 target lands on 62.5', () => {
    const r = nextTarget(input([top('2026-03-02', 60)], { exercise: { unit: 'kg', increment: 1.25, weights: BAR, kit: 'barbell' } }));
    assert.deepEqual([r.value.action, r.value.weight], ['increase', 62.5]);
  });

  it('the light week from 22 kg lands on 20', () => {
    const r = nextTarget(input([top('2026-03-02', 22)], { exercise: dumbbells(2), deload: true }));
    assert.deepEqual([r.value.action, r.value.weight, r.value.reps], ['deload', 20, 5]);
    assert.match(r.reason.note ?? '', /Deload week: 20 kg x 5, about 9 % under the last loading session \(22 kg\)/);
    const lightest = nextTarget(input([top('2026-03-02', 2)], { exercise: dumbbells(2), deload: true }));
    assert.equal(lightest.value.weight, 2);
    assert.match(lightest.reason.note ?? '', /the load of the last loading session.*The lightest dumbbell here is 2 kg: nothing lighter to drop to\./);
  });

  it('two misses go to the nearest real weight under the base', () => {
    const r = nextTarget(input([logged('2026-03-02', [set(22, 4)]), logged('2026-03-05', [set(22, 4)])], { exercise: dumbbells(2) }));
    assert.deepEqual([r.value.action, r.value.weight], ['lighter', 20]);
    assert.match(r.reason.note ?? '', /20 kg x 5, 9\.1 % lighter/);
    const coarse = nextTarget(input([logged('2026-03-02', [set(10, 4)]), logged('2026-03-05', [set(10, 4)])], { exercise: dumbbells(2) }));
    assert.equal(coarse.value.weight, 8);
    assert.match(coarse.reason.note ?? '', /The weights here make this outside 5-10 %/);
  });

  it('at the heaviest dumbbell the weight holds and reps carry it', () => {
    const r = nextTarget(input([top('2026-03-02', 30)], { exercise: dumbbells(2) }));
    assert.deepEqual([r.value.action, r.value.weight, r.value.reps], ['hold', 30, 9]);
    assert.equal(r.reason.title, 'Load ceiling');
    assert.equal(r.reason.inputs['ceiling'], 30);
    assert.match(r.reason.note ?? '', /Every set reached 8: the heaviest dumbbell here is 30 kg, so reps carry it: 30 kg x 9\./);
    // The next session at 30 x 10: one more again.
    assert.equal(nextTarget(input([logged('2026-03-02', [set(30, 10)])], { exercise: dumbbells(2) })).value.reps, 11);
    // Linear: the same hold.
    const linear = nextTarget({ ...input([logged('2026-03-02', [set(30, 5)])], { exercise: dumbbells(2) }), repRange: [5, 5], rule: { rule: 'linear', step: 2 } });
    assert.deepEqual([linear.value.action, linear.value.weight, linear.value.reps], ['hold', 30, 6]);
  });

  it('when the next real weight is over the load-jump cap, the weight holds and reps carry it', () => {
    // 40, 42, 44 within a week: 46 would be more than 10 % over 40.
    const week = [top('2026-03-02', 40), top('2026-03-04', 42), top('2026-03-06', 44)];
    const kit = { unit: 'kg' as const, increment: 2, weights: [...DB, 32, 34, 36, 38, 40, 42, 44, 46, 48], kit: 'dumbbell' as const };
    const r = nextTarget(input(week, { exercise: kit, date: '2026-03-07' }));
    assert.deepEqual([r.value.action, r.value.weight, r.value.reps], ['hold', 44, 9]);
    assert.equal(r.reason.title, 'Load cap');
    assert.match(r.reason.note ?? '', /46 kg would be more than 10 % over 40 within 7 days: it is the next weight here, so hold 44 kg and let reps carry it\. Next: 44 kg x 9\./);
    // A big jump (10 to 12 kg is 20 %) is allowed once, never twice in 7 days.
    const once = nextTarget(input([top('2026-03-02', 10)], { exercise: dumbbells(2), date: '2026-03-04' }));
    assert.deepEqual([once.value.action, once.value.weight], ['increase', 12]);
    assert.equal(once.reason.title, 'Big jump');
    const twice = nextTarget(input([top('2026-03-02', 10), top('2026-03-04', 12)], { exercise: dumbbells(2), date: '2026-03-06' }));
    assert.deepEqual([twice.value.action, twice.value.weight, twice.value.reps], ['hold', 12, 9]);
    assert.match(twice.reason.note ?? '', /A big jump already happened within 7 days: hold 12 kg and let reps carry it\./);
  });

  it('a ladder slot moves to its next variation, whatever the kit', () => {
    const r = nextTarget({ ...input([logged('2026-03-02', [set(30, 12), set(30, 12), set(30, 12)], 'full')], { exercise: dumbbells(2) }), repRange: [8, 12], rule: { rule: 'ladder', next: 'decline-push-up' } });
    assert.equal(r.value.action, 'next-variation');
  });

  it('the first week back after time off lands on the nearest real weight down', () => {
    const target = nextTarget(input([top('2026-03-02', 22)], { exercise: dumbbells(2) })).value;
    const protocol = { protocol: 'ease-back' as const, firstWeek: { from: '2026-03-16', to: '2026-03-22' }, loadFactor: 0.9, rirAdd: 1 } as never;
    const eased = applyReturn({ ...target, weight: 26 }, protocol, { unit: 'kg', increment: 2.5, weights: DB }, '2026-03-17');
    assert.deepEqual([eased.value.action, eased.value.weight], ['ease-back', 24]);
    const plain = applyReturn({ ...target, weight: 26 }, protocol, { unit: 'kg', increment: 2.5 }, '2026-03-17');
    assert.equal(plain.value.weight, 22.5, 'no kit: 23.4 rounded to the 2.5 kg step');
  });
});

describe('without a kit: increases keep a fine step exact', () => {
  it('60 + 1.25 is 61.25, not 61.5', () => {
    const r = nextTarget(input([logged('2026-03-02', [set(60, 8)])], { exercise: { unit: 'kg', increment: 1.25 } }));
    assert.deepEqual([r.value.action, r.value.weight], ['increase', 61.25]);
  });
});

// Edges of the kit found in review: every target stays on a real weight and says what it does.
describe('targets on the gym\'s real weights: the edges of the kit', () => {
  const BELLS = { unit: 'kg' as const, increment: 2.5, weights: [8, 12, 16, 20, 24], kit: 'kettlebell' as const };
  const keepLoad = { load: 1, rirAdd: 3 };

  it('a light week that keeps the load keeps a real weight: the base, or the nearest real one under it', () => {
    const top = nextTarget(input([logged('2026-03-02', [set(24, 8)])], { exercise: BELLS, deload: true, lightWeek: keepLoad }));
    assert.deepEqual([top.value.action, top.value.weight], ['deload', 24], 'not 25');
    const mid = nextTarget(input([logged('2026-03-02', [set(16, 8)])], { exercise: BELLS, deload: true, lightWeek: keepLoad }));
    assert.equal(mid.value.weight, 16, 'not 15');
    const off = nextTarget(input([logged('2026-03-02', [set(18, 8)])], { exercise: BELLS, deload: true, lightWeek: keepLoad }));
    assert.equal(off.value.weight, 16, 'a weight from another gym: the nearest real one under it');
  });

  it('a last weight above the kit\'s heaviest is kept, never a silent drop, and the note says to correct the loads', () => {
    const r = nextTarget(input([logged('2026-03-02', [set(28, 8)])], { exercise: BELLS }));
    assert.deepEqual([r.value.action, r.value.weight, r.value.reps], ['hold', 28, 9]);
    assert.match(r.reason.note ?? '', /28 kg is heavier than the heaviest kettlebell here \(24 kg\)/);
    assert.match(r.reason.note ?? '', /correct the profile's loads/);
  });

  it('two misses at the lightest weight hold it and say there is nothing lighter, not "0.0 % lighter"', () => {
    const r = nextTarget(input([logged('2026-03-02', [set(8, 4)]), logged('2026-03-05', [set(8, 4)])], { exercise: BELLS }));
    assert.deepEqual([r.value.action, r.value.weight, r.value.reps], ['hold', 8, 5]);
    assert.doesNotMatch(r.reason.note ?? '', /lighter\./);
    assert.match(r.reason.note ?? '', /the lightest kettlebell here is 8 kg: nothing lighter, so hold 8 kg/);
  });

  it('the first week back at the lightest weight keeps it and says the RIR alone eases it', () => {
    const target = nextTarget(input([logged('2026-03-02', [set(8, 6)])], { exercise: BELLS })).value;
    const protocol = { protocol: 'ease-back' as const, firstWeek: { from: '2026-03-16', to: '2026-03-22' }, loadFactor: 0.9, rirAdd: 1 } as never;
    const eased = applyReturn(target, protocol, { unit: 'kg', increment: 2.5, weights: BELLS.weights }, '2026-03-17');
    assert.deepEqual([eased.value.action, eased.value.weight, eased.value.rir], ['ease-back', 8, 3]);
    assert.match(eased.reason.note ?? '', /8 kg is the lightest weight here: the RIR alone eases it/);
  });

  it('a top set logged in the other unit lands on the real weight it was, so the light week drops a real step', () => {
    // A kg kit for a lb lift: 22.5 kg is the 49.6 lb dumbbell here, not the 50 lb the step would give.
    const lbKit = { unit: 'lb' as const, increment: 5, weights: [39.7, 44.1, 49.6, 55.1], kit: 'dumbbell' as const };
    const h = exerciseHistory([logged('2026-03-02', [set(22.5, 8, 'kg')])], 'squat');
    const r = nextTarget({ history: h, exercise: lbKit, repRange: [5, 8], targetRir: 2, deload: true });
    assert.equal(r.reason.inputs['base'], 49.6);
    assert.equal(r.value.weight, 44.1, 'one dumbbell lighter, not the same one');
  });
});

// Every set: the weight goes up only when every planned set (the session's
// plan snapshot) was logged at the top of the range.
describe('every set: fewer sets logged than planned', () => {
  const top3 = [set(60, 8, 'kg', 2), set(60, 8, 'kg', 2), set(60, 8, 'kg', 2)];
  // A session saved with the day's count (3, as the plan's): the partial-sets rule applies.
  const saved = (date: string, sets: LoggedSet[]) => session(date, { level: 'full', logged: { squat: sets }, slots: [{ ...SQ, _daySets: 3 } as typeof SQ] });

  it('2 of 3 sets at the top hold the weight, and say why', () => {
    const r = nextTarget(input([saved('2026-03-02', top3.slice(0, 2))]));
    assert.deepEqual([r.value.action, r.value.weight, r.value.reps, r.value.assumedAllSets], ['hold', 60, 8, false]);
    assert.equal(r.reason.title, 'Sets not logged');
    assert.match(r.reason.note ?? '', /^2 of 3 sets logged: the weight goes up when every set reaches the top\./);
    assert.deepEqual([r.reason.inputs['loggedSets'], r.reason.inputs['plannedSets']], [2, 3]);
  });

  it('3 of 3 at the top increase, as before', () => {
    const r = nextTarget(input([saved('2026-03-02', top3)]));
    assert.deepEqual([r.value.action, r.value.weight, r.value.reps], ['increase', 62.5, 5]);
    assert.deepEqual([r.reason.inputs['loggedSets'], r.reason.inputs['plannedSets']], [3, 3]);
    assert.doesNotMatch(r.reason.note ?? '', /sets logged/);
  });

  it('Standard tracking is unchanged: the top set stands in for every set', () => {
    const r = nextTarget(input([logged('2026-03-02', [set(60, 8)])]));
    assert.equal(r.value.action, 'increase');
    assert.equal(r.reason.inputs['loggedSets'], undefined);
  });

  it('inside the range or under it, the rules are as before', () => {
    const inside = nextTarget(input([saved('2026-03-02', [set(60, 7), set(60, 6)])]));
    assert.deepEqual([inside.value.action, inside.value.reps], ['add-reps', 7]);
    const under = nextTarget(input([saved('2026-03-02', [set(60, 4)])]));
    assert.deepEqual([under.value.action, under.value.reps], ['hold', 5]);
    assert.doesNotMatch(under.reason.note ?? '', /sets logged/);
  });

  it('a ladder keeps its variation, linear and the coach\'s target wait for every set', () => {
    const ladder = nextTarget({ ...input([saved('2026-03-02', [set(0, 12), set(0, 12)])]), repRange: [8, 12], rule: { rule: 'ladder', next: 'decline-push-up' } });
    assert.deepEqual([ladder.value.action, ladder.value.weight, ladder.value.reps], ['hold', 0, 12]);
    assert.match(ladder.reason.note ?? '', /2 of 3 sets logged: the next variation comes when every set reaches the top/);
    const standing = (rule: Record<string, unknown>) => ({ standing: { rule: { onMiss: { after: 2, drop: 0.1 }, onStall: 'report', ...rule } as never, source: 'plan' as const } });
    const linear = nextTarget(input([saved('2026-03-02', top3.slice(0, 2))], standing({ rule: 'linear' })));
    assert.deepEqual([linear.value.action, linear.value.weight], ['hold', 60]);
    const target = nextTarget(input([saved('2026-03-02', [set(70, 6), set(70, 6)])], standing({ rule: 'target', target: { weight: 70, reps: 6, rir: 2 } })));
    assert.equal(target.value.targetMet, false);
    assert.match(target.reason.note ?? '', /2 of 3 sets logged: the target is met when every set reaches it/);
    const all = nextTarget(input([saved('2026-03-02', [set(70, 6), set(70, 6), set(70, 6)])], standing({ rule: 'target', target: { weight: 70, reps: 6, rir: 2 } })));
    assert.equal(all.value.targetMet, true);
  });
});

// A trimmed day (a readiness or soreness trim, Express's own sets): the
// session froze the day's working sets beside the plan's (`_daySets` on the
// snapshot slot), and the weight is judged against the day's count.
describe('every set: the day\'s set count', () => {
  const dayOf = (date: string, sets: LoggedSet[], day?: number) => session(date, { level: 'full', logged: { squat: sets }, slots: [{ ...SQ, ...(day !== undefined ? { _daySets: day } : {}) } as typeof SQ] });
  const top = set(60, 8, 'kg', 2);

  it('plan 3, the day 2: both logged at the top increase', () => {
    const r = nextTarget(input([dayOf('2026-03-02', [top, top], 2)]));
    assert.deepEqual([r.value.action, r.value.weight], ['increase', 62.5]);
    assert.deepEqual([r.reason.inputs['loggedSets'], r.reason.inputs['plannedSets'], r.reason.inputs['plannedFrom']], [2, 2, 'day']);
  });

  it('plan 3, the day 2: one logged holds, against the day\'s count', () => {
    const r = nextTarget(input([dayOf('2026-03-02', [top], 2)]));
    assert.deepEqual([r.value.action, r.value.weight, r.value.reps], ['hold', 60, 8]);
    assert.match(r.reason.note ?? '', /^1 of 2 sets logged: the weight goes up when every set reaches the top\./);
    assert.equal(r.reason.inputs['plannedFrom'], 'day');
  });

  it('an old entry without the day\'s count is judged as before, on the sets it logged', () => {
    // The old panel showed the day's rows (a trim: 2 of the plan's 3), so its sets were the day's: no hold.
    const r = nextTarget(input([dayOf('2026-03-02', [top, top])]));
    assert.deepEqual([r.value.action, r.value.weight], ['increase', 62.5]);
    assert.doesNotMatch(r.reason.note ?? '', /sets logged/);
    assert.deepEqual([r.reason.inputs['loggedSets'], r.reason.inputs['plannedSets'], r.reason.inputs['plannedFrom']], [2, 3, 'plan']);
    const one = nextTarget(input([dayOf('2026-03-02', [top])]));
    assert.equal(one.value.action, 'increase');
  });
});
