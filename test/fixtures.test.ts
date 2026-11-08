// End to end: every fixture validates against schema v1, and every expected
// answer documented in it comes out of the engine. The expected numbers were
// computed from ports of the numbers.md snippets, outside this code base.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adherence } from '../src/core/adherence.ts';
import { jointAchesOf, weekStartOf } from '../src/core/checkins.ts';
import { decideDeload } from '../src/core/deload.ts';
import { e1rmTrend } from '../src/core/e1rm.ts';
import { exerciseHistory, topSets } from '../src/core/history.ts';
import { applyReturn, returnProtocol } from '../src/core/missed.ts';
import { nextTarget } from '../src/core/progression.ts';
import { readinessActions, readinessOn, readinessSeries } from '../src/core/readiness.ts';
import {
  applyScreening,
  capLoadJump,
  capTarget,
  checkRedFlags,
  screenExercise,
  screeningOutcome,
  type LedgerConstraint,
  type Prescription,
  type ScreeningAnswers,
} from '../src/core/safety.ts';
import type { RepRange, ScreeningOutcome, Session, Unit } from '../src/core/schema.ts';
import { detectStall, triageLadder, type TriageInput } from '../src/core/stall.ts';
import {
  validateBody,
  validateCheckins,
  validateLog,
  validateProfile,
  validateProgram,
} from '../src/core/validate.ts';
import { checkVolume, setsPerMuscle } from '../src/core/volume.ts';
import { rateStatus, weightRate, weightTrend } from '../src/core/weight.ts';
import { loadFixtures, near, sessionsOf, type Fixture } from './helpers.ts';

interface E1rmExpect {
  exercise: string;
  unit: Unit;
  sessions: number;
  ignored: number;
  points: number;
  e1rms: number[];
  best: number | null;
  change: number | null;
  verdict: string | null;
  stallCandidate: boolean;
  unitFlag: unknown;
  why: string;
}

interface ProgressionExpect {
  exercise: string;
  asOf: string;
  repRange: RepRange;
  targetRir: number;
  deload: boolean;
  action: string;
  weight: number | null;
  unit: Unit;
  reps: number;
  rir: number;
  assumedAllSets: boolean;
  why: string;
}

interface VolumeExpect {
  from: string;
  to: string;
  sessions: number;
  estimated: boolean;
  perWeek: Record<string, number>;
  tiers: Record<string, string>;
  notCounted: string[];
  checkPriority: string[];
  why: string;
}

interface ReadinessExpect {
  asOf: string | null;
  r: number | null;
  s: number | null;
  band: string;
  signals: number;
  scoredDays: number;
  lowRun: number;
  actions: Record<string, boolean>;
  e1rmFallingFrom?: string;
  why: string;
}

interface WeightExpect {
  since: string | null;
  weighIns: number;
  seed: number;
  trend: number;
  trendDate: string;
  rate: { kgPerWeek: number; pctPerWeek: number; spanDays: number; weighIns: number } | null;
  goal: string;
  status: string | null;
  why: string;
}

const upto = (sessions: Session[], date: string) => sessions.filter((s) => s.date <= date);

/** The exercise's unit and step from the fixture's program: the one conversion rule (units.ts weightInUnit). */
function e1rmFor(f: Fixture, exercise: string, unit: Unit) {
  const increment = f.data.program?.exercises[exercise]?.increment;
  return e1rmTrend(topSets(upto(sessionsOf(f), f.today), exercise), increment ? { unit, increment } : unit);
}

const fixtures = loadFixtures();

describe('fixtures', () => {
  it('has the thirteen made-up histories', () => {
    assert.deepEqual(fixtures.map((f) => f.name), [
      '01-novice-steady',
      '02-stalled-intermediate',
      '03-two-missed-weeks',
      '04-deload-week',
      '05-readiness-dip',
      '06-mixed-units',
      '07-light-sparse',
      '08-stall-triage',
      '09-three-weeks-off',
      '10-conservative-screening',
      '11-blocked',
      '12-ledger-iap',
      '13-load-jump-cap',
    ]);
  });
});

/** The plain progression target for one exercise as of a date. */
function targetFor(f: Fixture, exercise: string, asOf: string, repRange: RepRange, targetRir: number) {
  const ex = f.data.program!.exercises[exercise]!;
  return nextTarget({
    history: exerciseHistory(upto(sessionsOf(f), asOf), exercise),
    exercise: { unit: ex.unit!, increment: ex.increment! },
    repRange,
    targetRir,
  });
}

for (const f of fixtures) {
  describe(`fixture ${f.name}`, () => {
    const sessions = sessionsOf(f);
    const exercises = f.data.program?.exercises ?? {};

    it('validates against schema v1', () => {
      const { profile, program, logs, checkins, body } = f.data;
      if (profile) assert.deepEqual(validateProfile(profile), [], 'profile');
      if (program) assert.deepEqual(validateProgram(program), [], 'program');
      for (const log of logs ?? []) assert.deepEqual(validateLog(log), [], `log ${log.month}`);
      if (checkins) assert.deepEqual(validateCheckins(checkins), [], 'checkins');
      if (body) assert.deepEqual(validateBody(body), [], 'body');
      for (const s of sessions) {
        for (const id of [...s.exercises.map((x) => x.exercise), ...(s.plan?.slots.map((x) => x.exercise) ?? [])]) {
          assert.ok(id in exercises, `${s.id}: exercise ${id} is not in the program`);
        }
      }
    });

    it('documents every expected answer', () => {
      const all = Object.values(f.expected).flatMap((v) => (Array.isArray(v) ? v : [v])) as { why?: unknown }[];
      assert.ok(all.length > 0);
      for (const x of all) assert.ok(typeof x.why === 'string' && x.why.length > 20, 'each expectation explains itself');
      assert.ok(f.about.length > 20);
    });

    for (const e of (f.expected['e1rm'] ?? []) as E1rmExpect[]) {
      it(`e1RM trend: ${e.exercise}`, () => {
        const v = e1rmFor(f, e.exercise, e.unit).value;
        near(
          {
            unit: v.unit,
            sessions: v.sessions,
            ignored: v.ignored,
            points: v.points.length,
            e1rms: v.points.map((p) => p.e1rm),
            best: v.best,
            change: v.change,
            verdict: v.verdict,
            stallCandidate: v.stallCandidate,
            unitFlag: v.unitFlag,
          },
          {
            unit: e.unit,
            sessions: e.sessions,
            ignored: e.ignored,
            points: e.points,
            e1rms: e.e1rms,
            best: e.best,
            change: e.change,
            verdict: e.verdict,
            stallCandidate: e.stallCandidate,
            unitFlag: e.unitFlag,
          },
          `${f.name} e1rm ${e.exercise}`,
        );
      });
    }

    for (const e of (f.expected['progression'] ?? []) as ProgressionExpect[]) {
      it(`next target: ${e.exercise} as of ${e.asOf}${e.deload ? ' (deload)' : ''}`, () => {
        const ex = exercises[e.exercise];
        assert.ok(ex?.unit && ex.increment, `${e.exercise} has a unit and a step`);
        const r = nextTarget({
          history: exerciseHistory(upto(sessions, e.asOf), e.exercise),
          exercise: { unit: ex.unit, increment: ex.increment },
          repRange: e.repRange,
          targetRir: e.targetRir,
          deload: e.deload,
          date: e.asOf,
        });
        near(r.value, {
          action: e.action,
          weight: e.weight,
          unit: e.unit,
          reps: e.reps,
          rir: e.rir,
          assumedAllSets: e.assumedAllSets,
        }, `${f.name} progression ${e.exercise}`);
        assert.equal(r.reason.rule, 'progression.double');
        if (e.assumedAllSets) assert.match(r.reason.note ?? '', /assumed to have matched it/);
        assert.deepEqual(r.reason.inputs['loadCap'], (e as { loadCap?: unknown }).loadCap);
      });
    }

    for (const e of (f.expected['volume'] ?? []) as VolumeExpect[]) {
      it(`sets per muscle: ${e.from} to ${e.to}`, () => {
        const v = setsPerMuscle(sessions, exercises, e.from, e.to).value;
        assert.equal(v.sessions, e.sessions);
        assert.equal(v.estimated, e.estimated);
        assert.deepEqual(v.notCounted, e.notCounted);
        near(v.perWeek, e.perWeek, `${f.name} perWeek`);
        const checks = checkVolume(v.perWeek, { muscles: Object.keys(e.tiers), priority: e.checkPriority });
        assert.deepEqual(Object.fromEntries(checks.map((c) => [c.value.muscle, c.value.tier])), e.tiers);
        for (const c of checks) {
          if (c.value.priority && c.value.sets < 10 && c.value.sets >= 4) assert.equal(c.value.status, 'priority-low', c.value.muscle);
        }
      });
    }

    const rd = f.expected['readiness'] as ReadinessExpect | undefined;
    if (rd) {
      it('readiness score and actions', () => {
        const daily = f.data.checkins!.daily;
        let e1rmFalling: boolean | undefined;
        if (rd.e1rmFallingFrom) {
          const ex = exercises[rd.e1rmFallingFrom]!;
          e1rmFalling = e1rmFor(f, rd.e1rmFallingFrom, ex.unit!).value.verdict === 'down';
        }
        const actions = readinessActions(daily, f.today, e1rmFalling === undefined ? {} : { e1rmFalling });
        assert.deepEqual(Object.fromEntries(actions.map((a) => [a.value.action, a.value.active])), rd.actions);
        const early = actions.find((a) => a.value.action === 'early-deload')!;
        assert.equal(early.reason.inputs['lowRun'], rd.lowRun);
        assert.equal(actions[0]!.reason.inputs['asOf'], rd.asOf);
        const day = readinessOn(daily, rd.asOf!).value;
        near({ r: day.r, s: day.s, band: day.band, signals: day.signals }, { r: rd.r, s: rd.s, band: rd.band, signals: rd.signals }, `${f.name} readiness`);
        assert.equal(readinessSeries(daily, f.today).filter((x) => x.r !== null).length, rd.scoredDays);
      });
    }

    const wt = f.expected['weight'] as WeightExpect | undefined;
    if (wt) {
      it('weight trend, rate and band', () => {
        const opts = wt.since ? { since: wt.since, through: f.today } : { through: f.today };
        const t = weightTrend(f.data.body!.weights, opts).value;
        near(
          { weighIns: t.points.length, seed: t.seed, trend: t.latest!.trend, trendDate: t.latest!.date },
          { weighIns: wt.weighIns, seed: wt.seed, trend: wt.trend, trendDate: wt.trendDate },
          `${f.name} trend`,
        );
        const rate = weightRate(t).value;
        if (wt.rate === null) {
          assert.equal(rate, null);
        } else {
          near(rate && { kgPerWeek: rate.kgPerWeek, pctPerWeek: rate.pctPerWeek, spanDays: rate.spanDays, weighIns: rate.weighIns }, wt.rate, `${f.name} rate`);
          assert.equal(rateStatus(rate!, wt.goal as 'fat-loss').value.status, wt.status);
        }
      });
    }

    const ad = f.expected['adherence'] as { target: { lift: number; short: number }; value: unknown } | undefined;
    if (ad) {
      it('adherence, last 4 complete weeks', () => {
        const c = f.data.checkins;
        const r = adherence({ sessions, today: f.today, target: ad.target, daily: c?.daily ?? [], weekly: c?.weekly ?? [], program: f.data.program! });
        near(r.value, ad.value, `${f.name} adherence`);
      });
    }

    for (const e of (f.expected['stall'] ?? []) as { exercise: string; unit: Unit; stalled: boolean; status: string; kind: string | null; change: number }[]) {
      it(`stall: ${e.exercise}`, () => {
        const c = f.data.checkins;
        const adh = adherence({ sessions, today: f.today, target: (f.expected['adherence'] as { target: { lift: number; short: number } }).target, daily: c?.daily ?? [], weekly: c?.weekly ?? [] });
        const r = detectStall(e1rmFor(f, e.exercise, e.unit).value, adh.value.lifting.pct).value;
        near({ stalled: r.stalled, status: r.status, kind: r.kind, change: r.change }, { stalled: e.stalled, status: e.status, kind: e.kind, change: e.change }, `${f.name} stall`);
      });
    }

    const dl = f.expected['deload'] as { input: { stalledMainLifts?: string[] }; planWeek: number; scheduled: boolean; weeksToScheduled: number; triggers: string[]; deload: boolean; cancelled: boolean } | undefined;
    const deloadDecision = () => decideDeload({ programStart: f.data.program!.macrocycle.start, today: f.today, ...dl!.input });
    if (dl) {
      it('deload decision', () => {
        const v = deloadDecision().value;
        // The old default acts on every signal it reports, so its signals are its triggers.
        assert.deepEqual(v, { planWeek: dl.planWeek, scheduled: dl.scheduled, weeksToScheduled: dl.weeksToScheduled, signals: dl.triggers, triggers: dl.triggers, deload: dl.deload, cancelled: dl.cancelled });
      });
    }

    const tr = f.expected['triage'] as { exercise: string; input: TriageInput; steps: { step: number; applies: boolean; chosen: boolean }[] } | undefined;
    if (tr) {
      it('triage ladder', () => {
        const daily = f.data.checkins!.daily.filter((d) => d.date <= f.today).sort((a, b) => (a.date < b.date ? -1 : 1));
        const last7 = daily.slice(-7).map((d) => d.sleepH!);
        const weekly = f.data.checkins!.weekly.filter((w) => (weekStartOf(w) ?? '') <= f.today).at(-1);
        const week = setsPerMuscle(sessions, exercises, '2026-03-16', '2026-03-22').value.perWeek;
        const steps = triageLadder(tr.exercise, {
          ...tr.input,
          sleepH: last7.reduce((a, b) => a + b, 0) / last7.length,
          readinessBand: readinessOn(daily, f.today).value.band,
          recovery: weekly?.recovery ?? null,
          jointAches: jointAchesOf(weekly).fatigue,
          weeksToDeload: deloadDecision().value.weeksToScheduled,
          muscle: { name: 'chest', weeklySets: week['chest'] ?? 0 },
        });
        assert.deepEqual(steps.map((x) => ({ step: x.value.step, applies: x.value.applies, chosen: x.value.chosen })), tr.steps);
      });
    }

    interface Applied { exercise: string; repRange: RepRange; targetRir: number; date: string; before: { action: string; weight: number; reps: number }; after: unknown }
    const ms = f.expected['missed'] as ({ rotation: string[]; applied: Applied[] } & Record<string, unknown>) | undefined;
    if (ms) {
      it('missed-time return protocol', () => {
        const p = returnProtocol({ sessions, today: f.today, rotation: ms.rotation, daily: f.data.checkins?.daily ?? [] }).value;
        const keys = ['protocol', 'lastSession', 'daysOff', 'weeksOff', 'loadFactor', 'rirAdd', 'firstWeek', 'restartAtWeek', 'calibration', 'nextTemplate', 'gapDays'] as const;
        near(Object.fromEntries(keys.map((k) => [k, p[k]])), Object.fromEntries(keys.map((k) => [k, ms[k]])), `${f.name} missed`);
        for (const a of ms.applied) {
          const t = targetFor(f, a.exercise, f.today, a.repRange, a.targetRir).value;
          assert.deepEqual({ action: t.action, weight: t.weight, reps: t.reps }, a.before, `${a.exercise} before`);
          const ex = exercises[a.exercise]!;
          near(applyReturn(t, p, { unit: ex.unit!, increment: ex.increment! }, a.date).value, a.after, `${a.exercise} after`);
        }
      });
    }

    const sc = f.expected['screening'] as { answers: ScreeningAnswers; outcome: string; coached: boolean; rescreen: boolean; referral?: string } | undefined;
    if (sc) {
      it('screening outcome', () => {
        const r = screeningOutcome(sc.answers).value;
        assert.deepEqual([r.outcome, r.coached, r.rescreen], [sc.outcome, sc.coached, sc.rescreen]);
        if (sc.referral) assert.equal(r.referral, sc.referral);
        if (f.data.profile) assert.equal(f.data.profile.screening.outcome, r.outcome, 'the profile records the outcome');
      });
    }

    for (const [i, e] of ((f.expected['applyScreening'] ?? []) as { prescription: Prescription; outcome: ScreeningOutcome; expected: Record<string, unknown> }[]).entries()) {
      it(`apply screening ${i + 1}: ${e.outcome}`, () => {
        const r = applyScreening(e.prescription, e.outcome, { exercises }).value;
        const x = e.expected;
        if ('prescription' in x) assert.equal(r.prescription, x['prescription']);
        if ('violations' in x) assert.deepEqual(r.violations, x['violations']);
        if ('changes' in x) assert.deepEqual(r.changes, x['changes']);
        if ('rir' in x) assert.deepEqual(r.prescription!.sessions.flatMap((t) => t.slots.map((s) => s.rir)), x['rir']);
        if ('vigorous' in x) assert.deepEqual(r.prescription!.conditioning.map((c) => c.vigorous), x['vigorous']);
        if ('maxTests' in x) assert.equal(r.prescription!.maxTests, x['maxTests']);
        if ('calibrationToFailure' in x) assert.equal(r.prescription!.calibrationToFailure, x['calibrationToFailure']);
      });
    }

    for (const e of (f.expected['capTarget'] ?? []) as { exercise: string; repRange: RepRange; targetRir: number; outcome: ScreeningOutcome; expected: unknown }[]) {
      it(`screening cap on the ${e.exercise} target`, () => {
        near(capTarget(targetFor(f, e.exercise, f.today, e.repRange, e.targetRir).value, e.outcome).value, e.expected, `${f.name} capTarget`);
      });
    }

    for (const e of (f.expected['redFlags'] ?? []) as { ids: string[]; stop: boolean; severity: string | null; messageStartsWith: string | null }[]) {
      it(`red flags: ${e.ids.join(', ') || 'none'}`, () => {
        const r = checkRedFlags(e.ids).value;
        assert.deepEqual([r.stop, r.severity], [e.stop, e.severity]);
        if (e.messageStartsWith === null) assert.equal(r.message, null);
        else assert.ok(r.message!.startsWith(e.messageStartsWith), r.message!);
      });
    }

    for (const e of (f.expected['ledger'] ?? []) as { exercise: string; today: string; swapsFromSlot: boolean; allowed: boolean; blockedBy: string[]; conditions: number; swaps: string[] }[]) {
      it(`Ledger screen: ${e.exercise} on ${e.today}`, () => {
        const ledger = (f.data.inputs?.ledger ?? []) as LedgerConstraint[];
        const slotSwaps = f.data.program!.macrocycle.phases[0]!.mesocycles[0]!.weeks[0]!.sessions.flatMap((t) => t.slots).find((s) => s.exercise === e.exercise)?.swaps ?? [];
        const r = screenExercise(e.exercise, ledger, e.today, exercises, e.swapsFromSlot ? { swaps: slotSwaps } : {}).value;
        assert.deepEqual({ allowed: r.allowed, blockedBy: r.blockedBy, conditions: r.conditions.length, swaps: r.swaps }, { allowed: e.allowed, blockedBy: e.blockedBy, conditions: e.conditions, swaps: e.swaps });
      });
    }

    for (const e of (f.expected['loadCap'] ?? []) as { exercise: string; date: string; history: { date: string; weight: number }[]; proposed: number; weight: number; capped: boolean; limit: number; bigJump: boolean; binding: string }[]) {
      it(`load cap: ${e.exercise} -> ${e.proposed} on ${e.date}`, () => {
        const ex = exercises[e.exercise]!;
        const r = capLoadJump({ proposed: e.proposed, date: e.date, history: e.history, exercise: { unit: ex.unit!, increment: ex.increment! } }).value;
        near(r, { weight: e.weight, capped: e.capped, limit: e.limit, bigJump: e.bigJump, binding: e.binding }, `${f.name} loadCap`);
      });
    }
  });
}

describe('fixture 02: the priority check', () => {
  it('calls chest at 8 sets short of its priority tier', () => {
    const f = fixtures.find((x) => x.name === '02-stalled-intermediate')!;
    const v = setsPerMuscle(sessionsOf(f), f.data.program!.exercises, '2026-03-23', '2026-03-29').value;
    const chest = checkVolume(v.perWeek, { muscles: ['chest'], priority: ['chest'] })[0]!;
    assert.deepEqual([chest.value.sets, chest.value.status], [8, 'priority-low']);
  });
});
