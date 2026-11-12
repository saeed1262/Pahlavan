import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RED_FLAGS, WARNING_SIGNS } from '../src/core/data/red-flags.ts';
import type { ProgressionTarget } from '../src/core/progression.ts';
import {
  applyScreening,
  capLoadJump,
  capTarget,
  checkRedFlags,
  iapLevel,
  screenExercise,
  screeningCaps,
  screeningDue,
  screeningOutcome,
  type LedgerConstraint,
  type Prescription,
  type ScreeningAnswers,
} from '../src/core/safety.ts';
import type { Exercise } from '../src/core/schema.ts';
import { slot } from './helpers.ts';

const answers = (a: Partial<ScreeningAnswers>): ScreeningAnswers => ({ regularExercise: true, knownCondition: 'none', warningSigns: [], ...a });

describe('screening outcome (intake.md table)', () => {
  const cases: [Partial<ScreeningAnswers>, string][] = [
    [{}, 'go'],
    [{ knownCondition: 'cleared' }, 'go'],
    [{ knownCondition: 'not-cleared' }, 'conservative'],
    [{ regularExercise: false }, 'go-ramped'],
    [{ regularExercise: false, knownCondition: 'cleared' }, 'conservative'],
    [{ regularExercise: false, knownCondition: 'not-cleared' }, 'blocked'],
    [{ warningSigns: ['swollen-ankles'] }, 'blocked'],
    [{ regularExercise: false, knownCondition: 'cleared', warningSigns: ['dizziness-fainting'] }, 'blocked'],
  ];
  for (const [a, outcome] of cases) {
    it(`${JSON.stringify(a)} -> ${outcome}`, () => {
      const r = screeningOutcome(answers(a));
      assert.equal(r.value.outcome, outcome);
      assert.equal(r.reason.rule, 'safety.screening');
    });
  }

  it('does not coach under 18, and refers pregnancy until cleared', () => {
    assert.deepEqual([screeningOutcome(answers({ under18: true })).value.outcome, screeningOutcome(answers({ under18: true })).value.coached], ['blocked', false]);
    assert.equal(screeningOutcome(answers({ pregnantOrPostpartum: true })).value.outcome, 'blocked');
    assert.equal(screeningOutcome(answers({ pregnantOrPostpartum: true, pregnancyCleared: true })).value.outcome, 'conservative');
    assert.equal(screeningOutcome(answers({ regularExercise: false, knownCondition: 'not-cleared', pregnantOrPostpartum: true, pregnancyCleared: true })).value.outcome, 'blocked');
  });

  it('treats an unknown warning-sign id as a warning sign and flags a health change for re-screening', () => {
    const r = screeningOutcome(answers({ warningSigns: ['something-new'] }));
    assert.equal(r.value.outcome, 'blocked');
    assert.match(r.reason.note ?? '', /Unknown warning-sign id/);
    assert.equal(screeningOutcome(answers({ healthChange: true })).value.rescreen, true);
  });

  it('is due again after 12 months', () => {
    assert.equal(screeningDue('2026-03-01', '2027-02-28').value, false);
    assert.equal(screeningDue('2026-03-01', '2027-03-01').value, true);
    assert.equal(screeningDue('2028-02-29', '2029-02-28').value, false);
    assert.equal(screeningDue('2028-02-29', '2029-03-01').value, true);
  });
});

const EX: Record<string, Exercise> = {
  'back-squat': { name: 'Back squat', unit: 'kg', increment: 2.5, risk: ['abdomen-high'], muscles: { main: ['quads', 'glutes'], helps: ['hamstrings', 'lower-back'] } },
  'goblet-squat': { name: 'Goblet squat', unit: 'lb', increment: 5, risk: ['abdomen-moderate'], muscles: { main: ['quads', 'glutes'], helps: ['abs'] } },
  'split-squat': { name: 'Split squat', unit: 'lb', increment: 5, risk: ['abdomen-moderate'], muscles: { main: ['quads', 'glutes'], helps: ['hamstrings'] } },
  'leg-extension': { name: 'Leg extension', unit: 'lb', increment: 10, risk: ['abdomen-low'], muscles: { main: ['quads'], helps: [] } },
  'hip-thrust': { name: 'Hip thrust', unit: 'kg', increment: 2.5, risk: ['abdomen-moderate'], muscles: { main: ['glutes'], helps: ['hamstrings'] } },
  'leg-press': { name: 'Leg press', unit: 'kg', increment: 5, risk: ['abdomen-high'], muscles: { main: ['quads', 'glutes'], helps: [] } },
  'bench-press': { name: 'Bench press', unit: 'kg', increment: 2.5, risk: ['abdomen-moderate', 'joint:shoulder'], muscles: { main: ['chest'], helps: ['triceps'] } },
  'db-bench': { name: 'DB bench', unit: 'lb', increment: 5, risk: ['abdomen-low'], muscles: { main: ['chest'], helps: ['triceps'] } },
  'cable-row': { name: 'Cable row', unit: 'lb', increment: 10, risk: ['abdomen-low'], muscles: { main: ['lats', 'upper-back'], helps: ['biceps'] } },
  'untagged-squat': { name: 'Squat, untagged', unit: 'kg', increment: 2.5, muscles: { main: ['quads'], helps: [] } },
  plank: { name: 'Plank', kind: 'timed' },
};

describe('screening caps', () => {
  it('lists each outcome\'s limits', () => {
    assert.equal(screeningCaps('go').value.minRir, null);
    assert.equal(screeningCaps('go-ramped', { firstMesocycle: true }).value.minRir, 3);
    assert.equal(screeningCaps('go-ramped').value.minRir, null);
    assert.deepEqual(screeningCaps('conservative').value, { prescribe: true, minRir: 4, fullBodyOnly: true, vigorous: false, maxTests: false, calibrationToFailure: false });
    assert.equal(screeningCaps('blocked').value.prescribe, false);
  });

  const fullBody: Prescription = {
    sessions: [{ id: 'full-a', name: 'Full A', kind: 'lift', slots: [slot('goblet-squat', 3, 8, 12, 2), slot('db-bench', 3, 8, 12, 1), slot('cable-row', 3, 10, 15, 4)] }],
    conditioning: [{ id: 'intervals', minutes: 25, vigorous: true }, { id: 'walk', minutes: 30, vigorous: false }],
    maxTests: true,
    calibrationToFailure: true,
  };

  it('leaves a Go plan unchanged', () => {
    const r = applyScreening(fullBody, 'go', { exercises: EX });
    assert.deepEqual(r.value, { prescription: fullBody, changes: [], violations: [] });
  });

  it('raises RIR to 3 in a ramped first mesocycle', () => {
    const r = applyScreening(fullBody, 'go-ramped', { exercises: EX, firstMesocycle: true }).value;
    assert.deepEqual(r.prescription!.sessions[0]!.slots.map((s) => s.rir), [3, 3, 4]);
  });

  it('applies the Conservative caps and refuses a split session', () => {
    const r = applyScreening(fullBody, 'conservative', { exercises: EX }).value;
    assert.deepEqual(r.prescription!.sessions[0]!.slots.map((s) => s.rir), [4, 4, 4]);
    assert.deepEqual(r.prescription!.conditioning.map((c) => c.vigorous), [false, false]);
    assert.deepEqual([r.prescription!.maxTests, r.prescription!.calibrationToFailure], [false, false]);
    assert.equal(r.changes.length, 5);
    const split = { ...fullBody, sessions: [{ id: 'upper', name: 'Upper', kind: 'lift' as const, slots: [slot('db-bench', 3, 8, 12)] }] };
    const bad = applyScreening(split, 'conservative', { exercises: EX });
    assert.equal(bad.value.prescription, null);
    assert.deepEqual(bad.value.violations, ['upper is not full body (upper muscles only)']);
  });

  it('gives no prescription when blocked', () => {
    const r = applyScreening(fullBody, 'blocked', { exercises: EX });
    assert.equal(r.value.prescription, null);
    assert.match(r.reason.note ?? '', /logging only/);
  });

  it('caps a progression target', () => {
    const t: ProgressionTarget = { action: 'increase', weight: 50, unit: 'lb', reps: 8, rir: 2, assumedAllSets: true };
    assert.equal(capTarget(t, 'blocked').value, null);
    assert.equal(capTarget(t, 'conservative').value!.rir, 4);
    assert.equal(capTarget(t, 'go').value, t);
  });
});

describe('red flags', () => {
  it('holds the intake.md lists with unique ids and wellness wording', () => {
    assert.equal(RED_FLAGS.filter((f) => f.severity === 'emergency').length, 8);
    assert.equal(RED_FLAGS.filter((f) => f.severity === 'stop-and-refer').length, 10 + WARNING_SIGNS.length);
    assert.equal(new Set(RED_FLAGS.map((f) => f.id)).size, RED_FLAGS.length);
    for (const f of RED_FLAGS) assert.doesNotMatch(f.text, /hernia|stroke|heart attack|embolism|thrombosis|rhabdo|cauda|appendic/i, f.id);
  });

  it('passes no flags, stops on any, and leads emergencies with the urgent line', () => {
    assert.deepEqual([checkRedFlags([]).value.stop, checkRedFlags([]).value.severity], [false, null]);
    const stop = checkRedFlags(['one-calf-swollen']).value;
    assert.deepEqual([stop.stop, stop.severity], [true, 'stop-and-refer']);
    assert.match(stop.message!, /^Stop training/);
    const urgent = checkRedFlags(['pain-over-5', 'chest-pain']).value;
    assert.equal(urgent.severity, 'emergency');
    assert.match(urgent.message!, /^Call emergency services now\./);
    assert.equal(urgent.flags.length, 2);
  });

  it('treats an unknown id as stop and refer', () => {
    const r = checkRedFlags(['made-up']);
    assert.deepEqual([r.value.stop, r.value.severity, r.value.unknown], [true, 'stop-and-refer', ['made-up']]);
  });
});

describe('Ledger screening', () => {
  const abdomen: LedgerConstraint = { id: 'abdominal-wall', area: 'abdomen', noTags: ['abdomen-high'], until: '2026-04-30' };

  it('reads the abdominal-strain tag', () => {
    assert.equal(iapLevel(EX['back-squat']), 'high');
    assert.equal(iapLevel(EX['untagged-squat']), null);
  });

  it('blocks a high-strain lift and suggests lower-strain swaps that share a muscle', () => {
    const r = screenExercise('back-squat', [abdomen], '2026-03-30', EX);
    assert.equal(r.value.allowed, false);
    assert.deepEqual(r.value.blockedBy, ['abdominal-wall']);
    assert.deepEqual(r.value.swaps, ['split-squat', 'goblet-squat', 'leg-extension', 'hip-thrust']);
    // The note is for people ("Thu 30 Apr"); the date itself is in the value.
    assert.match(r.reason.note ?? '', /through Thu 30 Apr/);
    assert.equal(r.value.blockedUntil, '2026-04-30');
  });

  it('puts the plan\'s own swaps first', () => {
    assert.deepEqual(screenExercise('back-squat', [abdomen], '2026-03-30', EX, { swaps: ['leg-extension'] }).value.swaps[0], 'leg-extension');
  });

  it('allows a moderate lift with conditions while the abdominal constraint is active', () => {
    const r = screenExercise('goblet-squat', [abdomen], '2026-03-30', EX).value;
    assert.equal(r.allowed, true);
    assert.equal(r.conditions.length, 2);
  });

  it('ignores an expired constraint', () => {
    const r = screenExercise('back-squat', [abdomen], '2026-05-01', EX);
    assert.equal(r.value.allowed, true);
    assert.match(r.reason.note ?? '', /Expired, not applied: abdominal-wall/);
  });

  it('blocks a named movement and allows equal-strain swaps for it', () => {
    const shoulder: LedgerConstraint = { id: 'shoulder', noMovements: ['bench-press'] };
    const r = screenExercise('bench-press', [shoulder], '2026-03-30', EX).value;
    assert.deepEqual([r.allowed, r.swaps], [false, ['db-bench']]);
  });

  it('refuses an unknown exercise', () => {
    assert.equal(screenExercise('mystery', [], '2026-03-30', EX).value.allowed, false);
  });
});

describe('load-jump cap (rules.md)', () => {
  const KG = { unit: 'kg' as const, increment: 2.5 };
  const LB = { unit: 'lb' as const, increment: 5 };
  const h = (...rows: [string, number][]) => rows.map(([date, weight]) => ({ date, weight }));

  it('has nothing to compare with on a first session', () => {
    assert.deepEqual(capLoadJump({ proposed: 50, date: '2026-03-02', history: [], exercise: KG }).value, { weight: 50, capped: false, limit: null, bigJump: false, binding: 'none' });
  });

  it('allows at most one increment per session', () => {
    assert.equal(capLoadJump({ proposed: 62.5, date: '2026-03-05', history: h(['2026-03-02', 60]), exercise: KG }).value.capped, false);
    const r = capLoadJump({ proposed: 70, date: '2026-03-05', history: h(['2026-03-02', 60]), exercise: KG });
    assert.deepEqual(r.value, { weight: 62.5, capped: true, limit: 62.5, bigJump: false, binding: 'session' });
    assert.equal(r.reason.rule, 'safety.load-cap');
    assert.equal(capLoadJump({ proposed: 107.5, date: '2026-03-09', history: h(['2026-03-02', 100]), exercise: KG }).value.weight, 102.5);
    assert.equal(capLoadJump({ proposed: 60, date: '2026-03-05', history: h(['2026-03-02', 52]), exercise: LB }).value.weight, 55); // 57 rounds down to the step
  });

  it('keeps a rolling 7 days within about 10 %', () => {
    const week = h(['2026-03-02', 60], ['2026-03-04', 62.5], ['2026-03-06', 65]);
    const r = capLoadJump({ proposed: 67.5, date: '2026-03-08', history: week, exercise: KG });
    assert.deepEqual(r.value, { weight: 65, capped: true, limit: 66, bigJump: false, binding: 'week' });
    assert.match(r.reason.note ?? '', /10 % over 60 within 7 days/);
    // A session 7 days back is outside the window.
    assert.equal(capLoadJump({ proposed: 65, date: '2026-03-16', history: h(['2026-03-02', 60], ['2026-03-09', 62.5]), exercise: KG }).value.capped, false);
  });

  it('allows one big step (over 10 %) once, flagged, but not twice within 7 days', () => {
    const one = capLoadJump({ proposed: 25, date: '2026-03-05', history: h(['2026-03-02', 20]), exercise: LB });
    assert.deepEqual(one.value, { weight: 25, capped: false, limit: 25, bigJump: true, binding: 'none' });
    assert.match(one.reason.note ?? '', /start at the bottom of the range/);
    const again = capLoadJump({ proposed: 25, date: '2026-03-09', history: h(['2026-03-02', 15], ['2026-03-05', 20]), exercise: LB });
    assert.deepEqual(again.value, { weight: 20, capped: true, limit: 20, bigJump: false, binding: 'big-jump-repeat' });
    const later = capLoadJump({ proposed: 25, date: '2026-03-12', history: h(['2026-03-02', 15], ['2026-03-05', 20]), exercise: LB });
    assert.deepEqual([later.value.weight, later.value.bigJump], [25, true]);
  });

  describe('on the gym\'s real weights', () => {
    const DB = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30];
    const dumbbells = (increment: number) => ({ unit: 'kg' as const, increment, weights: DB });

    it('one step is the next real weight up when the increment is finer', () => {
      const r = capLoadJump({ proposed: 22, date: '2026-03-05', history: h(['2026-03-02', 20]), exercise: dumbbells(1) });
      assert.deepEqual(r.value, { weight: 22, capped: false, limit: 22, bigJump: false, binding: 'none' });
      assert.equal(r.reason.inputs['nextWeight'], 22);
    });

    it('a capped weight is the heaviest real one within the cap, never under the last', () => {
      // 21 kg logged elsewhere: 10 % over it is 23.1, and the heaviest dumbbell within that is 22.
      const r = capLoadJump({ proposed: 26, date: '2026-03-05', history: h(['2026-03-02', 21]), exercise: dumbbells(5) });
      assert.deepEqual(r.value, { weight: 22, capped: true, limit: 23.1, bigJump: false, binding: 'week' });
    });

    it('when even the next real weight is over the cap, the weight holds and reps carry it', () => {
      const week = h(['2026-03-02', 20], ['2026-03-04', 22]);
      const r = capLoadJump({ proposed: 24, date: '2026-03-06', history: week, exercise: dumbbells(2) });
      assert.deepEqual(r.value, { weight: 22, capped: true, limit: 22, bigJump: false, binding: 'week' });
      assert.match(r.reason.note ?? '', /24 kg would be more than 10 % over 20 within 7 days: it is the next weight here, so hold 22 kg and let reps carry it\./);
    });

    it('a big real step is allowed once, as one step', () => {
      const r = capLoadJump({ proposed: 14, date: '2026-03-05', history: h(['2026-03-02', 10]), exercise: dumbbells(5) });
      assert.deepEqual(r.value, { weight: 12, capped: true, limit: 12, bigJump: true, binding: 'session' });
    });
  });
});
