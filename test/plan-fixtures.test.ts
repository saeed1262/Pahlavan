// End to end for the plan generator: five made-up people, structural answers
// documented in each fixture, every one recomputed here independently of the
// generator's own checks.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CATALOGUE_BY_ID } from '../src/core/data/exercises.ts';
import { LOWER_BODY, MAJOR_MUSCLES, UPPER_BODY } from '../src/core/data/muscles.ts';
import { normalizeEquipment, type PlanInput } from '../src/core/plan/context.ts';
import { generatePlan } from '../src/core/plan/generate.ts';
import { screenExercise } from '../src/core/safety.ts';
import type { Program, SessionTemplate, Week } from '../src/core/schema.ts';
import { validateProgram } from '../src/core/validate.ts';
import { checkVolume, plannedSetsPerMuscle } from '../src/core/volume.ts';
import { ROOT } from './helpers.ts';

interface PlanFixture {
  name: string;
  about: string;
  input: PlanInput;
  expected: {
    templateId: string;
    liftingDays: number;
    extraDays: number;
    minutes: number;
    weekdays: string[];
    modifier: string;
    equipmentMode: string;
    mainRule: string;
    posture?: boolean;
    pullPushMin?: number;
    finisher?: boolean;
    steps?: number[];
    intervals?: boolean;
    ledger?: { blockedInPhase1: string[]; phase2Mains: string[] };
    senior?: { minRirPhase1: number; balance: string };
    conservative?: { minRir: number };
    skillFirst?: boolean;
    deloadWeeks: number[];
    testWeeks: number[];
    calibrationWeek: number;
    start: string;
    why: string;
  };
}

const dir = join(ROOT, 'test', 'fixtures', 'plans');
const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as PlanFixture);

/** Weeks with their 1-based index over the macrocycle and their phase. */
function weeksOf(p: Program): { index: number; phase: number; week: Week }[] {
  let i = 0;
  return p.macrocycle.phases.flatMap((ph, phase) => ph.mesocycles.flatMap((m) => m.weeks.map((week) => ({ index: ++i, phase, week }))));
}
const lifts = (w: Week): SessionTemplate[] => w.sessions.filter((t) => t.kind === 'lift');
const INTERVALS = ['bike-intervals-4x4', 'hill-intervals-4x4'];

describe('plan fixtures', () => {
  it('has the five made-up people', () => {
    assert.deepEqual(fixtures.map((f) => f.name), ['a-novice-dumbbells', 'b-intermediate-posture', 'c-senior-machines', 'd-conservative-bodyweight', 'e-calisthenics']);
  });
});

for (const f of fixtures) {
  describe(`plan ${f.name}`, () => {
    const e = f.expected;
    const run = generatePlan(f.input);
    const { program, proposal } = run.value;
    const weeks = program ? weeksOf(program) : [];
    const kit = normalizeEquipment(f.input.profile.equipment).equipment;

    it('is documented', () => {
      assert.ok(f.about.length > 20 && e.why.length > 40);
    });

    it('produces a valid program with every check passing', () => {
      assert.ok(program);
      assert.deepEqual(validateProgram(program), []);
      assert.equal(proposal.status, 'ok', JSON.stringify(proposal.checks.filter((c) => !c.passed)));
      assert.ok(proposal.checks.every((c) => c.passed));
      assert.equal(program.macrocycle.start, e.start);
    });

    it('is deterministic', () => {
      assert.deepEqual(generatePlan(f.input), run);
    });

    it('picks the template, days and session length', () => {
      const t = proposal.template!;
      assert.deepEqual(
        { id: t.id, liftingDays: t.liftingDays, extraDays: t.extraDays, minutes: t.minutes, modifier: t.modifier, equipmentMode: t.equipmentMode },
        { id: e.templateId, liftingDays: e.liftingDays, extraDays: e.extraDays, minutes: e.minutes, modifier: e.modifier, equipmentMode: e.equipmentMode },
      );
      assert.deepEqual(proposal.week!.days.filter((d) => d.kind === 'lift').map((d) => d.weekday), e.weekdays);
      for (const s of proposal.sessions) if (s.estimatedMinutes !== null) assert.ok(s.estimatedMinutes <= e.minutes, `${s.id} ${s.estimatedMinutes} min`);
      for (const { week } of weeks) assert.equal(lifts(week).length, e.liftingDays);
    });

    it('lays out the macrocycle: calibration first, deloads, tests', () => {
      assert.deepEqual(weeks.filter((w) => w.week.kind === 'deload').map((w) => w.index), e.deloadWeeks);
      assert.deepEqual(weeks.filter((w) => w.week.calibration).map((w) => w.index), [e.calibrationWeek]);
      assert.deepEqual(weeks.filter((w) => w.week.tests).map((w) => w.index), e.testWeeks);
      for (const t of lifts(weeks[0]!.week)) for (const s of t.slots) assert.ok(s.rir >= 3, 'calibration week at RIR 3 or more');
      assert.ok(proposal.calendar.some((c) => c.kind === 'calibration' && c.week === 1));
    });

    it('uses only listed equipment and nothing the Ledger blocks', () => {
      for (const id of Object.keys(program!.exercises)) {
        const entry = CATALOGUE_BY_ID.get(id)!;
        assert.ok(entry.equipment.every((q) => q === 'bodyweight' || kit.has(q)), `${id} needs ${entry.equipment.join(', ')}`);
      }
      for (const { week } of weeks) {
        for (const t of week.sessions) for (const s of t.slots) {
          assert.ok(screenExercise(s.exercise, f.input.options?.ledger ?? [], week.start, program!.exercises).value.allowed, `${week.start} ${s.exercise}`);
        }
      }
    });

    it('keeps weekly sets per muscle inside the bands', () => {
      const priority = program!.priorityMuscles ?? [];
      for (const { index, week } of weeks) {
        if (week.kind !== 'loading') continue;
        const v = plannedSetsPerMuscle(lifts(week), program!.exercises).value;
        assert.deepEqual(v.overSession, [], `week ${index}: at most 8 direct sets per muscle per session`);
        for (const c of checkVolume(v.perWeek, { muscles: [...MAJOR_MUSCLES, ...priority], priority })) {
          // The posture emphasis lets upper back and lats pass the priority top (16) up to the cap, for pull at twice push.
          const posturePull = e.posture === true && (c.value.muscle === 'upper-back' || c.value.muscle === 'lats') && c.value.status === 'priority-high';
          if (!posturePull) assert.equal(c.value.status, 'ok', `week ${index} ${c.value.muscle} ${c.value.sets}`);
        }
        for (const [m, n] of Object.entries(v.perWeek)) assert.ok(n <= 20, `week ${index} ${m} ${n}`);
      }
    });

    it('keeps the main lifts constant within each phase', () => {
      for (let p = 0; p < program!.macrocycle.phases.length; p++) {
        const ws = weeks.filter((w) => w.phase === p);
        const ids = new Set(ws.flatMap((w) => lifts(w.week).map((t) => t.id)));
        for (const id of ids) {
          const mains = ws.map((w) => JSON.stringify(lifts(w.week).find((t) => t.id === id)?.slots.filter((s) => s.main).map((s) => s.exercise) ?? null)).filter((x) => x !== 'null');
          assert.equal(new Set(mains).size, 1, `phase ${p + 1} ${id}: ${[...new Set(mains)].join(' | ')}`);
        }
      }
      for (const t of lifts(weeks[1]!.week)) for (const s of t.slots.filter((x) => x.main)) assert.equal(s.progression?.rule, e.mainRule, s.exercise);
    });

    it('places conditioning validly', () => {
      assert.ok(proposal.checks.find((c) => c.id === 'concurrent')!.passed);
      if (e.intervals === false) for (const { week } of weeks) for (const t of week.sessions) for (const s of t.slots) assert.ok(!INTERVALS.includes(s.exercise));
      if (e.steps) assert.deepEqual(proposal.conditioning[0]!.steps, e.steps);
      if (e.finisher) for (const t of lifts(weeks[1]!.week)) assert.equal(program!.exercises[t.slots.at(-1)!.exercise]!.kind, 'cardio');
    });

    if (e.posture) {
      it('pulls at least 1.8 times as many sets as it pushes', () => {
        for (const { index, week } of weeks) {
          if (week.kind !== 'loading') continue;
          let pull = 0;
          let push = 0;
          for (const t of lifts(week)) for (const s of t.slots) {
            const p = program!.exercises[s.exercise]!.pattern;
            if (p === 'horizontal-pull' || p === 'vertical-pull' || p === 'rear-delt') pull += s.sets;
            if (p === 'horizontal-push' || p === 'vertical-push') push += s.sets;
          }
          assert.ok(pull >= e.pullPushMin! * push, `week ${index}: ${pull} / ${push}`);
          for (const t of lifts(week)) assert.ok(t.slots.some((s) => program!.exercises[s.exercise]!.pattern === 'rear-delt'), `week ${index} ${t.id} has rear-delt work`);
        }
      });
    }

    if (e.ledger) {
      it('keeps high-strain lifts out of phase 1 and brings them back in phase 2', () => {
        const mains = (p: number) => new Set(weeks.filter((w) => w.phase === p).flatMap((w) => lifts(w.week).flatMap((t) => t.slots.filter((s) => s.main).map((s) => s.exercise))));
        const all1 = new Set(weeks.filter((w) => w.phase === 0).flatMap((w) => w.week.sessions.flatMap((t) => t.slots.map((s) => s.exercise))));
        for (const id of e.ledger!.blockedInPhase1) assert.ok(!all1.has(id), `${id} in phase 1`);
        for (const id of e.ledger!.phase2Mains) assert.ok(mains(1).has(id), `${id} back in phase 2`);
      });
    }

    if (e.senior) {
      it('applies the 65+ start: RIR 4 or more in phase 1, balance work every session, no intervals yet', () => {
        for (const { phase, week } of weeks) {
          for (const t of lifts(week)) {
            assert.ok(t.slots.some((s) => s.exercise === e.senior!.balance), `${week.start} ${t.id} balance`);
            if (phase === 0) for (const s of t.slots) assert.ok(s.rir >= e.senior!.minRirPhase1, `${week.start} ${s.exercise} RIR ${s.rir}`);
          }
        }
        assert.equal(proposal.conditioning[0]!.intervalsAllowed, false);
      });
    }

    if (e.conservative) {
      it('applies the Conservative caps everywhere', () => {
        for (const { week } of weeks) {
          for (const t of lifts(week)) {
            for (const s of t.slots) assert.ok(s.rir >= e.conservative!.minRir, `${week.start} ${s.exercise} RIR ${s.rir}`);
            const main = t.slots.flatMap((s) => program!.exercises[s.exercise]!.muscles?.main ?? []);
            assert.ok(main.some((m) => LOWER_BODY.includes(m)) && main.some((m) => UPPER_BODY.includes(m)), `${t.id} is full body`);
          }
        }
        assert.ok(!proposal.calendar.some((c) => c.kind === 'rir-calibration'), 'no calibration sets to failure');
        assert.ok(proposal.calibration!.tests.some((t) => t.id === 'push-ups-submax'), 'submaximal tests only');
        assert.ok(proposal.conditioning.every((c) => c.sessions.every((s) => !s.vigorous)));
      });
    }

    if (e.skillFirst) {
      it('opens every session with a skill block, a different skill each day', () => {
        for (const { week } of weeks) {
          const firsts = lifts(week).map((t) => t.slots[0]!.exercise);
          for (const id of firsts) assert.equal(program!.exercises[id]!.pattern, 'skill', id);
          assert.equal(new Set(firsts).size, firsts.length, `${week.start}: ${firsts.join(', ')}`);
        }
      });
    }
  });
}
