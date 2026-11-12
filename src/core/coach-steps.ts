// When to talk to the coach. Each plan Sunday has a coach step after its
// check-in: the week's letter (`/fitness-coach checkin`), on a light week's
// Sunday the mesocycle review, which also writes next month's plan, and at
// a phase's end the phase review in its place, which at the plan's last week
// also plans the next cycle (both `/fitness-coach review`). Where the step
// for the Sunday on or before the date stands: answer first (that Sunday's
// answers are not saved yet), due (saved, on the Sunday, no letter dated on
// or after it), late (after the Sunday, still no letter, until the next
// Sunday's step takes over) or done (a letter dated on or after it). And the
// next steps with their dates. From the plan's weeks, the Sunday check-in's
// status (the Check-in screen's) and the newest coach letter's date. Pure:
// the date is an input.

import { addDays, dayText, mondayOf, type IsoDate } from './dates.ts';
import { explain, type Result } from './reason.ts';
import type { Program } from './schema.ts';

/**
 * The coach's commands as typed in Claude Code (the skill alone, for
 * anything said in your own words, and its two scheduled jobs), the one
 * place they are spelled: the skill's name may change for public users.
 */
export const COACH_COMMANDS = { ask: '/fitness-coach', intake: '/fitness-coach intake', plan: '/fitness-coach plan', planWhy: '/fitness-coach plan why', checkin: '/fitness-coach checkin', review: '/fitness-coach review' } as const;

export type CoachStepKind = 'letter' | 'mesocycle-review' | 'phase-review';
export type CoachState = 'answer-first' | 'due' | 'late' | 'done';
/** The Sunday check-in's status, as the Check-in screen has it. */
export type SundayStatus = 'open' | 'late' | 'edit' | 'saved';

export interface CoachStep {
  /** The Sunday it follows: that week's check-in. */
  date: IsoDate;
  /** The plan week it closes and its phase; null for a Sunday outside the plan's weeks (a letter, as every week). */
  week: number | null;
  phase: number | null;
  kind: CoachStepKind;
  /** "The week’s letter", "Mesocycle review", "Phase review". */
  title: string;
  command: string;
  /** What the coach does then, after "the coach": "writes the week’s letter". */
  does: string;
  /** The plan's last week: the phase review also plans the next cycle. */
  nextCycle: boolean;
}

export interface CoachNow extends CoachStep {
  state: CoachState;
  /** Why now, in one plain line for the screens. */
  line: string;
  /** The newest letter's date, when there is one this cycle. */
  letter: IsoDate | null;
}

export interface CoachSteps {
  /** The step for the Sunday on or before the date; null with no check-in to ask (no plan, a week before the cycle). */
  now: Result<CoachNow> | null;
  /** The next steps after it, a Sunday each. */
  next: Result<CoachStep>[];
}

export interface CoachInput {
  program: Pick<Program, 'macrocycle'> | null;
  /** The plan's length in weeks (plan-data's `weeks`): its last week plans the next cycle. Absent: the macrocycle's last week. */
  planWeeks?: number | null;
  date: IsoDate;
  /** The Sunday check-in the date reviews, and its status; null when there is none to ask. */
  sunday: { date: IsoDate; status: SundayStatus } | null;
  /** The newest coach letter this cycle: its date (frontmatter, else the file name) and kind. */
  letter: { date: IsoDate | null; kind: string } | null;
}

/** How many steps `next` lists. */
export const NEXT_STEPS = 3;

const TITLE: Record<CoachStepKind, string> = { letter: 'The week’s letter', 'mesocycle-review': 'Mesocycle review', 'phase-review': 'Phase review' };

/** The step for one plan week's Sunday: the letter, the mesocycle review (a light week), the phase review (a phase's end). */
function stepFor(week: number | null, phase: number | null, sunday: IsoDate, light: boolean, phaseEnd: boolean, last: boolean): Result<CoachStep> {
  const kind: CoachStepKind = phaseEnd ? 'phase-review' : light ? 'mesocycle-review' : 'letter';
  const command = kind === 'letter' ? COACH_COMMANDS.checkin : COACH_COMMANDS.review;
  const nextCycle = kind === 'phase-review' && last;
  const does = kind === 'letter' ? 'writes the week’s letter' : kind === 'mesocycle-review' ? 'reviews the month and writes next month’s plan' : nextCycle ? 'reviews the phase and plans the next cycle' : 'reviews the phase and plans the next one';
  const what = week === null
    ? `${dayText(sunday)} is outside the plan’s weeks: after the Sunday check-in the coach writes the week’s letter, as every week.`
    : kind === 'letter'
      ? `Plan week ${week}: after the Sunday check-in the coach writes the week’s letter.`
      : kind === 'mesocycle-review'
        ? `Plan week ${week} is a light week: its Sunday closes the month, so the check-in is the mesocycle review, and the coach writes next month’s plan.`
        : `Plan week ${week} ends phase ${phase}: its check-in is the phase review${nextCycle ? '; it is the plan’s last week, so the coach also plans the next cycle' : ', and the coach plans the next phase'}.`;
  return explain<CoachStep>({ date: sunday, week, phase, kind, title: TITLE[kind], command, does, nextCycle }, 'coach.step', { sunday, week, phase, light, phaseEnd, last }, { note: `${what} In Claude Code: ${command}.` });
}

/** Each plan week's coach step, in date order (on the week's Sunday). */
export function planSteps(program: Pick<Program, 'macrocycle'>, planWeeks: number | null = null): Result<CoachStep>[] {
  const weeks: { n: number; phase: number; start: IsoDate; light: boolean; phaseEnd: boolean }[] = [];
  program.macrocycle.phases.forEach((ph, pi) =>
    ph.mesocycles.forEach((m, mi) =>
      m.weeks.forEach((w, wi) => {
        weeks.push({ n: weeks.length + 1, phase: pi + 1, start: w.start, light: w.kind === 'deload', phaseEnd: mi === ph.mesocycles.length - 1 && wi === m.weeks.length - 1 });
      }),
    ),
  );
  const last = planWeeks && planWeeks > 0 ? planWeeks : weeks.length;
  return weeks.map((w) => stepFor(w.n, w.phase, addDays(w.start, 6), w.light, w.phaseEnd, w.n === last));
}

/** The step on a Sunday: the plan's, else the week's letter (a Sunday outside the plan's weeks). */
function stepOn(steps: readonly Result<CoachStep>[], sunday: IsoDate): Result<CoachStep> {
  return steps.find((s) => s.value.date === sunday) ?? stepFor(null, null, sunday, false, false, false);
}

/** Where the step stands, and its line. */
function stateOf(step: CoachStep, input: CoachInput & { sunday: NonNullable<CoachInput['sunday']> }): { state: CoachState; line: string } {
  const sun = input.sunday;
  const letter = input.letter?.date ?? null;
  if (letter && letter >= step.date) return { state: 'done', line: `The coach’s letter of ${dayText(letter)} is in.` };
  if (sun.status === 'open' || sun.status === 'late') {
    return { state: 'answer-first', line: `Save your answers${sun.status === 'late' ? ` for ${dayText(step.date)}` : ''}, then ask the coach: it ${step.does}.` };
  }
  if (input.date === step.date) {
    const lead = step.kind === 'mesocycle-review' ? 'The light week ends today and your answers are saved' : step.kind === 'phase-review' ? `${step.nextCycle ? 'The plan' : `Phase ${step.phase}`} ends today and your answers are saved` : 'Your answers are saved';
    return { state: 'due', line: `${lead}: the coach ${step.does}.` };
  }
  return { state: 'late', line: `Your answers for ${dayText(step.date)} are saved, but no letter is in yet: the coach ${step.does}.` };
}

const STATE_NOTE: Record<CoachState, string> = {
  'answer-first': 'Its answers are not saved yet: save them in Check-in first, then ask the coach.',
  due: 'Its answers are saved and no letter is dated on or after it: ask the coach today.',
  late: 'Its answers are saved, the Sunday has passed and no letter is dated on or after it: still to do, until the next Sunday’s step takes over.',
  done: 'A letter dated on or after it is in: done.',
};

/** The coach step for the Sunday on or before the date, where it stands, and the next ones. */
export function coachSteps(input: CoachInput): CoachSteps {
  const steps = input.program ? planSteps(input.program, input.planWeeks ?? null) : [];
  // The Sunday on or before the date: the week the Sunday check-in reviews.
  const sunday = input.sunday?.date ?? addDays(mondayOf(addDays(input.date, 1)), -1);
  const next = Array.from({ length: NEXT_STEPS }, (_, i) => stepOn(steps, addDays(sunday, 7 * (i + 1))));
  if (!input.sunday) return { now: null, next };
  const step = stepOn(steps, sunday);
  const { state, line } = stateOf(step.value, { ...input, sunday: input.sunday });
  const letter = input.letter?.date ?? null;
  const now = explain<CoachNow>({ ...step.value, state, line, letter }, 'coach.now', { sunday, status: input.sunday.status, letter, letterKind: input.letter?.kind ?? null, step: step.value.kind, date: input.date }, {
    note: `The step after the Sunday check-in of ${dayText(sunday)} is the ${step.value.kind === 'letter' ? 'week’s letter' : step.value.title.toLowerCase()} (${step.value.command}). ${STATE_NOTE[state]}`,
  });
  return { now, next };
}
