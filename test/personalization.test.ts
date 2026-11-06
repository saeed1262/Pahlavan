// The personal plan: five made-up athletes (test/fixtures/athletes/). Each
// profile input is named in the proposal's personalization audit, either as
// a decision it drove or with what it is for. An input the audit calls used
// is held to it: change that input (with the inputs that set the same
// decision) and the plan must change. A plan that ignores a profile field
// fails here. The plans also differ where the profiles differ: the split, the
// ladders' levels, the exercises, the volume and the cardio.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { LADDER_BY_ID } from '../src/core/data/ladders.ts';
import type { PlanInput } from '../src/core/plan/context.ts';
import { generatePlan, planCandidates, type GeneratedPlan } from '../src/core/plan/generate.ts';
import type { Profile, Program } from '../src/core/schema.ts';
import { ROOT } from './helpers.ts';

interface Athlete {
  name: string;
  about: string;
  input: PlanInput;
  expected: {
    templateId: string;
    compared: string[];
    ladders: Record<'pullup' | 'pushup' | 'hollow' | 'legs', number | null>;
    laddersUsed: string[];
    mustUse: string[];
    includes: string[];
    excludes: string[];
    cardio: { modes: string[]; minutes: number | null; intervals: boolean };
    priority: string[];
    why: string;
  };
}

const dir = join(ROOT, 'test', 'fixtures', 'athletes');
const athletes = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Athlete);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** The profile's inputs, named as the audit names them. */
function inputsOf(input: PlanInput): string[] {
  const p = input.profile;
  const out = ['units.load', 'units.body'];
  for (const k of ['birthYear', 'heightCm', 'sex'] as const) if (p.basics?.[k] !== undefined) out.push(`basics.${k}`);
  for (const g of p.goals) {
    out.push(`goals.${g.id}`, `goals.${g.id}.confidence`);
    if (g.measure !== undefined) out.push(`goals.${g.id}.measure`);
  }
  for (const k of Object.keys(p.availability)) if (!k.startsWith('_')) out.push(`availability.${k}`);
  out.push('equipment', 'trackingLevel', 'screening.outcome', 'screening.date');
  if (p.screening.limits?.length) out.push('screening.limits');
  for (const e of p.emphasis) out.push(`emphasis.${e.kind ?? e.area}`);
  if (p.priorityMuscles?.length) out.push('priorityMuscles');
  if (p.experience !== undefined) out.push('experience');
  for (const k of ['likes', 'dislikes', 'cardio'] as const) if (p.preferences?.[k]?.length) out.push(`preferences.${k}`);
  if (p.preferences?.splits && (p.preferences.splits.likes?.length || p.preferences.splits.dislikes?.length)) out.push('preferences.splits');
  for (const k of ['useHistory', 'rirCalibration', 'targets', 'work', 'badWeek'] as const) if (p[k] !== undefined) out.push(k);
  if (p.selfCheck) for (const k of Object.keys(p.selfCheck)) if (!k.startsWith('_')) out.push(`selfCheck.${k}`);
  for (const c of input.options?.ledger ?? []) out.push(`ledger.${c.id}`);
  return out.sort();
}

/** What the plan is, without the reasons. */
function signature(r: GeneratedPlan): string {
  const p = r.proposal;
  const program = r.program as Program | null;
  return JSON.stringify({
    program: program ? { exercises: program.exercises, macrocycle: program.macrocycle, priority: program.priorityMuscles ?? null, deskBreaks: program.deskBreaks ?? null } : null,
    template: p.template?.id ?? null,
    week: p.week,
    conditioning: p.conditioning.map((c) => ({ sessions: c.sessions, finisher: c.finisher, intervals: c.intervalsAllowed, steps: c.steps })),
    ladders: p.ladders.map((l) => [l.id, l.level, l.used, l.sessions]),
    priority: p.priority.map((x) => x.muscle),
    targets: p.targets,
    calendar: p.calendar,
    preMortem: p.preMortem.map((x) => [x.risk, x.countermeasure]),
    warmUp: p.warmUp,
    calibration: p.calibration?.tests ?? null,
  });
}

/** A meaningfully different value for one input; null when the test has no mutation for it. */
function mutate(input: PlanInput, name: string): PlanInput | null {
  const x = clone(input);
  const p = x.profile as Profile;
  const [head, key, sub] = name.split('.');
  const age = p.basics?.birthYear ? 2026 - p.basics.birthYear : null;
  switch (head) {
    case 'units':
      if (key === 'load') p.units.load = p.units.load === 'kg' ? 'lb' : 'kg';
      else return null;
      return x;
    case 'basics':
      if (key !== 'birthYear' || age === null) return null;
      p.basics!.birthYear = age >= 65 ? 1986 : 1956;
      return x;
    case 'goals': {
      const g = p.goals.find((y) => y.id === key)!;
      if (sub === 'measure') g.measure = 'a different measure';
      else if (sub === 'confidence') g.confidence = g.confidence < 7 ? 9 : 5;
      else if (p.goals.length > 1) p.goals = p.goals.filter((y) => y !== g);
      else g.kind = g.kind === 'strength' ? 'fat-loss' : 'strength';
      return x;
    }
    case 'availability': {
      const a = p.availability;
      if (key === 'daysPerWeek') a.daysPerWeek = a.daysPerWeek >= 4 ? 2 : 5;
      else if (key === 'minutesPerSession') a.minutesPerSession = a.minutesPerSession >= 45 ? 30 : 75;
      else delete (a as unknown as Record<string, unknown>)[key!];
      if (a.shortSessions && (a.shortSessions.days >= a.daysPerWeek || a.shortSessions.minutes >= a.minutesPerSession)) delete a.shortSessions;
      return x;
    }
    case 'equipment':
      p.equipment = p.equipment.length ? [] : ['dumbbells', 'bench'];
      return x;
    case 'trackingLevel':
      p.trackingLevel = p.trackingLevel === 'light' ? 'full' : 'light';
      return x;
    case 'screening':
      if (key === 'outcome') p.screening.outcome = p.screening.outcome === 'go' ? 'conservative' : 'go';
      else if (key === 'date') p.screening.date = `${Number(p.screening.date.slice(0, 4)) - 1}${p.screening.date.slice(4)}`;
      else return null;
      return x;
    case 'emphasis':
      p.emphasis = p.emphasis.filter((e) => (e.kind ?? e.area) !== name.slice('emphasis.'.length));
      return x;
    case 'priorityMuscles':
      delete p.priorityMuscles;
      return x;
    case 'experience':
      p.experience = p.experience === 'novice' ? 'intermediate' : 'novice';
      return x;
    case 'preferences':
      delete (p.preferences as Record<string, unknown>)[key!];
      return x;
    case 'work':
      p.work = p.work?.desk ? { desk: false } : { desk: true, sittingHours: 8 };
      return x;
    case 'badWeek':
      delete p.badWeek;
      return x;
    case 'selfCheck':
      delete (p.selfCheck as unknown as Record<string, unknown>)[key!];
      return x;
    case 'ledger':
      x.options = { ...x.options, ledger: (x.options?.ledger ?? []).filter((c) => c.id !== key) };
      return x;
    default:
      return null;
  }
}

const runs = new Map(athletes.map((a) => [a.name, generatePlan(a.input).value]));

describe('test athletes', () => {
  it('has the five made-up athletes', () => {
    assert.deepEqual(athletes.map((a) => a.name), ['1-beginner', '2-desk-recomp', '3-knee-62', '4-runner', '5-bodyweight-30']);
  });

  for (const a of athletes) {
    describe(a.name, () => {
      const r = runs.get(a.name)!;
      const p = r.proposal;
      const e = a.expected;
      const uses = new Map(p.personalization.map((u) => [u.input, u]));
      const ids = new Set(Object.keys(r.program?.exercises ?? {}));

      it('is documented', () => {
        assert.ok(a.about.length > 40 && e.why.length > 80);
      });

      it('produces a plan with every check passing', () => {
        assert.ok(r.program);
        assert.equal(p.status, 'ok', JSON.stringify(p.checks.filter((c) => !c.passed)));
      });

      it('names every profile input in the audit, and only those', () => {
        assert.deepEqual([...uses.keys()].sort(), inputsOf(a.input));
        for (const u of p.personalization) assert.ok(u.effect.length > 15 && u.value.length > 0, `${u.input}: ${u.effect}`);
      });

      it('uses the inputs this profile must use', () => {
        for (const name of e.mustUse) assert.equal(uses.get(name)?.used, true, `${name}: ${uses.get(name)?.effect}`);
      });

      it('changes the plan when an input it used changes', () => {
        const base = signature(r);
        for (const u of p.personalization.filter((x) => x.used)) {
          let m: PlanInput | null = a.input;
          for (const name of [u.input, ...(u.with ?? [])]) m = m && mutate(m, name);
          assert.ok(m, `no mutation for ${u.input}`);
          assert.ok(signature(generatePlan(m).value) !== base, `${u.input} is marked used, but changing it leaves the plan as it was (${u.effect})`);
        }
      });

      it('compares the templates and picks with reasons that cite the profile', () => {
        assert.deepEqual(p.templates.map((t) => t.id), e.compared);
        assert.equal(p.templates.find((t) => t.picked)?.id, e.templateId);
        assert.equal(p.template?.id, e.templateId);
        const notes = p.templates.flatMap((t) => t.factors.map((f) => f.note)).join(' ');
        assert.ok(notes.includes(a.input.profile.goals[0]!.label) || notes.includes([...a.input.profile.goals].sort((x, y) => y.importance - x.importance)[0]!.label), 'the goal is named');
        assert.ok(notes.includes(a.input.profile.experience === 'novice' ? 'Novice' : a.input.profile.experience === 'advanced' ? 'Advanced' : 'Intermediate'), 'the training age is named');
        if (a.input.profile.badWeek) assert.match(notes, /bad.week/i);
      });

      it('starts each ladder at the level the self-check gives', () => {
        assert.deepEqual(Object.fromEntries(p.ladders.map((l) => [l.id, l.level])), e.ladders);
        assert.deepEqual(p.ladders.filter((l) => l.used).map((l) => l.id).sort(), [...e.laddersUsed].sort());
        for (const l of p.ladders.filter((x) => x.used)) {
          const level = LADDER_BY_ID.get(l.id)!.levels[l.level! - 1]!;
          const slots = r.program!.macrocycle.phases[0]!.mesocycles[0]!.weeks[1]!.sessions.flatMap((t) => t.slots).filter((s) => s.progression?.ladder === l.id);
          assert.ok(slots.length > 0 && slots.every((s) => s.exercise === level.exercise && s.progression?.level === l.level), l.id);
        }
      });

      it('chooses exercises from the profile', () => {
        for (const id of e.includes) assert.ok(ids.has(id), `${id} in the plan`);
        for (const id of e.excludes) assert.ok(!ids.has(id), `${id} not in the plan`);
        assert.deepEqual(p.priority.map((x) => x.muscle), e.priority);
      });

      it('takes cardio from the preferences', () => {
        const c = p.conditioning[0]!;
        const modes = [...new Set([...c.sessions.map((s) => s.exercise), ...(c.finisher ? [c.finisher] : [])])].sort();
        assert.deepEqual(modes, [...e.cardio.modes].sort());
        assert.equal(c.sessions.some((s) => s.vigorous), e.cardio.intervals);
        if (e.cardio.minutes !== null) for (const s of c.sessions.filter((x) => !x.vigorous)) assert.equal(s.minutes, e.cardio.minutes);
      });

      it('writes no em-dash in anything the user reads', () => {
        assert.doesNotMatch(JSON.stringify(p), /\u2014/);
        assert.doesNotMatch(JSON.stringify(r.program), /\u2014/);
      });
    });
  }
});

describe('the plans differ where the profiles differ', () => {
  const by = (n: string) => runs.get(athletes.find((a) => a.name.startsWith(n))!.name)!;
  const ladder = (n: string, id: string) => by(n).proposal.ladders.find((l) => l.id === id)!.level!;
  const ids = (n: string) => new Set(Object.keys(by(n).program!.exercises));

  it('the split: by days, minutes, goal and training age', () => {
    const picks = athletes.map((a) => runs.get(a.name)!.proposal.template!.id);
    assert.ok(new Set(picks).size >= 3, picks.join(', '));
    assert.equal(by('2').proposal.template!.liftingDays, 4);
    assert.ok(by('5').proposal.template!.id.includes('minimum'), 'thirty-minute sessions get a minimum-dose template');
  });

  it('the ladders: a beginner starts lower than a trained user', () => {
    assert.ok(ladder('1', 'pushup') < ladder('2', 'pushup'));
    assert.ok(ladder('1', 'pullup') < ladder('2', 'pullup'));
    assert.ok(ladder('1', 'hollow') < ladder('2', 'hollow'));
    assert.ok(ladder('1', 'legs') < ladder('2', 'legs'));
    assert.ok(ladder('3', 'pullup') < ladder('4', 'pullup'));
  });

  it('the exercises: tests, equipment and the Ledger change them', () => {
    assert.ok(ids('2').has('pull-up') && !ids('1').has('pull-up'), 'pull-ups only for the user with strict pull-ups');
    assert.ok(ids('1').has('incline-push-up') && !ids('1').has('push-up'), 'no floor push-ups before the first one');
    assert.ok(!ids('1').has('rdl') && !ids('1').has('db-rdl'), 'no Romanian deadlifts before a flat-back hinge');
    for (const id of ['back-squat', 'reverse-lunge', 'split-squat', 'bulgarian-split-squat']) assert.ok(!ids('3').has(id), `the knee Ledger keeps ${id} out`);
    assert.ok(ids('3').has('lat-pulldown') && ids('3').has('scapular-pull-up'), 'a low pull-up level beside the pulldown');
    assert.ok(!ids('4').has('back-squat'), 'the disliked back squat stays out');
    assert.ok(ids('5').has('box-pistol') && ids('5').has('push-up'), 'bodyweight only: the single-leg and push-up ladders carry the work');
  });

  it('the volume: priority muscles for the muscle goal, less for the runner', () => {
    const v2 = by('2').proposal.volume[1]!.perWeek;
    for (const m of by('2').proposal.priority.map((x) => x.muscle)) assert.ok((v2[m] ?? 0) >= 10, `${m} ${v2[m]}`);
    const total = (v: Record<string, number>) => Object.values(v).reduce((x, y) => x + y, 0);
    assert.ok(total(by('4').proposal.volume[1]!.perWeek) < total(v2), 'hybrid endurance plans fewer sets');
    assert.deepEqual(by('4').proposal.priority, []);
  });

  it('the cardio: each user\'s own modes, on their short days', () => {
    const modes = (n: string) => by(n).proposal.conditioning[0]!.sessions.map((s) => s.exercise);
    assert.ok(modes('2').includes('zone2-bike') && modes('2').includes('brisk-walk'));
    assert.ok(modes('4').includes('easy-run') && !modes('4').includes('zone2-bike'));
    assert.deepEqual(by('2').proposal.conditioning[0]!.sessions.filter((s) => !s.vigorous).map((s) => s.minutes), [30, 30]);
  });
});

describe('four full-body days: A/B and A/B/C/D are both built', () => {
  const a = athletes.find((x) => x.name === '2-desk-recomp')!;
  const cands = planCandidates(a.input);
  const abcd = cands.find((c) => c.template.id === 'full-body-abcd')!;

  it('builds upper/lower, A/B twice and A/B/C/D, then torso/limbs, the upper/lower/full hybrid and a body-part split', () => {
    assert.deepEqual(cands.map((c) => c.template.id), ['upper-lower-x2', 'full-body-ab-x2', 'full-body-abcd', 'torso-limbs-x2', 'upper-lower-full-x4', 'body-part-x4']);
  });

  it('A/B/C/D: a heavy pair at 5-8 and a lighter pair at 10-15, each main pattern twice a week', () => {
    const week = abcd.program.macrocycle.phases[0]!.mesocycles[0]!.weeks[1]!;
    const lifts = week.sessions.filter((t) => t.kind === 'lift');
    assert.deepEqual(lifts.map((t) => t.id), ['heavy-squat', 'light-hinge', 'heavy-hinge', 'light-squat']);
    const pattern = (id: string) => abcd.program.exercises[id]!.pattern;
    for (const pat of ['squat', 'hinge', 'horizontal-push', 'vertical-pull']) {
      const where = lifts.filter((t) => t.slots.some((s) => s.main && pattern(s.exercise) === pat)).map((t) => t.id);
      assert.equal(where.length, 2, `${pat}: ${where.join(', ')}`);
      assert.ok(where.some((w) => w.startsWith('heavy')) && where.some((w) => w.startsWith('light')), `${pat} heavy once and lighter once`);
    }
    for (const t of lifts) {
      for (const s of t.slots.filter((x) => x.main && !x.progression?.ladder)) {
        const [lo, hi] = s.repRange;
        if (t.id.startsWith('heavy')) assert.ok(lo >= 5 && hi <= 8, `${t.id} ${s.exercise} ${lo}-${hi}`);
        else assert.deepEqual([lo, hi], [10, 15], `${t.id} ${s.exercise}`);
      }
    }
    const heavyMains = new Set(lifts.filter((t) => t.id.startsWith('heavy')).flatMap((t) => t.slots.filter((s) => s.main).map((s) => s.exercise)));
    for (const t of lifts.filter((x) => x.id.startsWith('light'))) for (const s of t.slots.filter((x) => x.main)) assert.ok(!heavyMains.has(s.exercise), `${s.exercise} is a variation`);
    assert.ok(abcd.proposal.checks.find((c) => c.id === 'concurrent')!.passed, 'a lighter day follows each heavy day');
  });

  it('A/B twice puts the same muscles hard on consecutive days, and the comparison says so', () => {
    const ab = cands.find((c) => c.template.id === 'full-body-ab-x2')!;
    assert.equal(ab.proposal.checks.find((c) => c.id === 'concurrent')!.passed, false);
    const row = runs.get(a.name)!.proposal.templates.find((t) => t.id === 'full-body-ab-x2')!;
    assert.ok(row.failedChecks.includes('concurrent'));
  });
});
