// Step 3: the macrocycle (planning.md). Week 1 is the calibration week; then
// phases of two mesocycles of 3 loading weeks and a deload; tests at each
// phase's end, photos at each mesocycle's end.

import { addDays, dayText } from '../dates.ts';
import { explain, type Result } from '../reason.ts';
import type { IsoDate } from '../schema.ts';
import type { Modifier, PlanContext } from './context.ts';

export interface WeekPlan {
  /** 1-based over the whole macrocycle. */
  index: number;
  start: IsoDate;
  phase: number;
  /** 0-based over the whole macrocycle. */
  meso: number;
  /** 1-based within the mesocycle. */
  weekInMeso: number;
  kind: 'loading' | 'deload';
  calibration: boolean;
  tests: boolean;
  photos: boolean;
}

export interface PhasePlan {
  index: number;
  id: string;
  name: string;
  goal: string;
  mesos: number[];
  from: IsoDate;
  to: IsoDate;
}

const PHASES: Record<Modifier, [string, string][]> = {
  muscle: [
    ['Foundation', 'Calibrate, learn the lifts, efficient volume.'],
    ['Build', 'Priority muscles toward 10-16 sets, heavier main lifts.'],
    ['Peak', 'The most volume you recover from, then tests.'],
  ],
  strength: [
    ['Accumulation', 'More sets, 6-10 reps on accessories.'],
    ['Intensification', '3-5 reps on the main lifts, fewer sets.'],
    ['Realization', 'Heavy work and tests, low volume.'],
  ],
  health: [
    ['Base', 'Steady full-body training; walking and steps.'],
    ['Build', 'The same lifts heavier; more conditioning and steps.'],
    ['Sustain', 'Keep it going; conditioning and steps at their targets.'],
  ],
  skill: [
    ['Foundation', 'Skill basics and strength by leverage.'],
    ['Skill build', 'Harder ladder steps on every skill.'],
    ['Peak', 'Skill tests at the end.'],
  ],
  hybrid: [
    ['Base', 'Lifting at 4-8 sets per muscle; aerobic base.'],
    ['Build', 'More conditioning; heavy legs away from key sessions.'],
    ['Peak', 'Conditioning tests and strength upkeep.'],
  ],
};

export function buildMacrocycle(ctx: PlanContext): Result<{ weeks: WeekPlan[]; phases: PhasePlan[] }> {
  const L = ctx.deloadEvery;
  if (!(Number.isInteger(L) && L >= 2)) throw new RangeError(`deload interval must be a whole number of 2 or more, got ${L}`);
  if (ctx.weeks % L !== 0) throw new RangeError(`${ctx.weeks} weeks is not a whole number of ${L}-week mesocycles`);
  const mesoCount = ctx.weeks / L;
  const weeks: WeekPlan[] = [];
  for (let i = 0; i < ctx.weeks; i++) {
    const meso = Math.floor(i / L);
    const weekInMeso = (i % L) + 1;
    const phase = Math.floor(meso / 2);
    const lastOfPhase = weekInMeso === L && (meso % 2 === 1 || meso === mesoCount - 1);
    weeks.push({
      index: i + 1,
      start: addDays(ctx.start, 7 * i),
      phase,
      meso,
      weekInMeso,
      kind: weekInMeso === L ? 'deload' : 'loading',
      calibration: i === 0,
      tests: lastOfPhase,
      photos: weekInMeso === L,
    });
  }
  const names = PHASES[ctx.modifier];
  const phaseCount = Math.ceil(mesoCount / 2);
  const phases: PhasePlan[] = Array.from({ length: phaseCount }, (_, p) => {
    const ws = weeks.filter((w) => w.phase === p);
    const [name, goal] = names[Math.min(p, names.length - 1)]!;
    return { index: p, id: `phase-${p + 1}`, name, goal, mesos: [...new Set(ws.map((w) => w.meso))], from: ws[0]!.start, to: addDays(ws.at(-1)!.start, 6) };
  });
  return explain(
    { weeks, phases },
    'plan.macrocycle',
    { start: ctx.start, weeks: ctx.weeks, deloadEvery: L },
    {
      note: `${ctx.weeks} weeks from ${dayText(ctx.start)}: ${phaseCount} phase(s) of 2 mesocycles (${L - 1} loading weeks + 1 deload); week 1 calibrates; deloads in weeks ${weeks.filter((w) => w.kind === 'deload').map((w) => w.index).join(', ')}; tests in weeks ${weeks.filter((w) => w.tests).map((w) => w.index).join(', ')}.`,
    },
  );
}
