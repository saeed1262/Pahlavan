// Steps 8-10 (planning.md): the calibration week, the check-in and test
// calendar, targets with predicted values, and the pre-mortem's data-driven
// risks. Every prediction is a heuristic and says so.

import { CALIBRATION } from '../calibration.ts';
import { addDays, daysBetween } from '../dates.ts';
import { explain, joinNotes, type Result } from '../reason.ts';
import { screeningCaps, screeningDue } from '../safety.ts';
import type { GoalKind, IsoDate } from '../schema.ts';
import type { PlanContext } from './context.ts';
import type { PhasePlan, WeekPlan } from './macrocycle.ts';

export interface Calibration {
  week: 1;
  rir: number;
  instructions: string;
  tests: { id: string; how: string }[];
}

export function calibrationPlan(ctx: PlanContext): Result<Calibration> {
  const caps = screeningCaps(ctx.outcome, { firstMesocycle: true }).value;
  const tests: { id: string; how: string }[] = [
    { id: 'weight', how: 'Morning weigh-ins on 3 or more days, after the bathroom.' },
    { id: 'tape', how: 'Waist at the navel (relaxed, after breathing out), hips, chest, arm.' },
    { id: 'photos', how: 'Front, side and back, same light and distance (if the user agreed to photos).' },
  ];
  if (ctx.posture) tests.push({ id: 'wall-gap', how: 'Back to the wall, heels and buttocks touching: the gap from the back of the head to the wall, in cm.' });
  if (ctx.senior || ctx.goalKinds.has('health')) {
    tests.push({ id: 'chair-stand-30s', how: 'Sit-to-stand from a chair, arms crossed: count in 30 s.' });
    tests.push({ id: 'single-leg-stance', how: 'Single-leg balance, each side, up to 30 s, next to a wall.' });
  }
  if (ctx.modifier === 'skill') {
    tests.push(caps.maxTests ? { id: 'skill-max-holds', how: 'Best hold or reps for each skill, fresh, one attempt each.' } : { id: 'skill-levels', how: 'The ladder level each skill is clean at, without going to failure.' });
  }
  tests.push(
    caps.maxTests
      ? { id: 'push-ups', how: 'Push-ups (or the ladder level) to 1 rep in reserve.' }
      : { id: 'push-ups-submax', how: 'Push-ups (or the ladder level) stopping with 3 or more in reserve: no max tests under this screening.' },
  );
  return explain<Calibration>(
    {
      week: 1,
      rir: CALIBRATION.rir,
      instructions: `For every weighted exercise, find a load that leaves ${CALIBRATION.rir} reps in reserve at the bottom of its range; for each ladder, the level where the bottom of the range is clean. No progression decisions and no stall checks this week.`,
      tests,
    },
    'plan.calibration',
    { outcome: ctx.outcome, posture: ctx.posture, senior: ctx.senior, modifier: ctx.modifier },
    { note: caps.maxTests ? undefined : 'No max tests under this screening: submaximal tests only.' },
  );
}

export type EventKind = 'calibration' | 'checkin' | 'tape' | 'photos' | 'tests' | 'rir-calibration' | 'deload' | 'phase-review' | 'rescreen';

export interface CalendarEvent {
  date: IsoDate;
  week: number | null;
  kind: EventKind;
}

const ORDER: EventKind[] = ['calibration', 'deload', 'rir-calibration', 'tests', 'photos', 'tape', 'checkin', 'phase-review', 'rescreen'];

export function calendar(ctx: PlanContext, weeks: readonly WeekPlan[], phases: readonly PhasePlan[]): Result<CalendarEvent[]> {
  const ev: CalendarEvent[] = [];
  const L = ctx.deloadEvery;
  for (const w of weeks) {
    const sunday = addDays(w.start, 6);
    if (w.calibration) ev.push({ date: w.start, week: w.index, kind: 'calibration' });
    if (w.kind === 'deload') ev.push({ date: w.start, week: w.index, kind: 'deload' });
    if (w.weekInMeso === L - 1 && screeningCaps(ctx.outcome, { firstMesocycle: w.meso === 0 }).value.calibrationToFailure) ev.push({ date: w.start, week: w.index, kind: 'rir-calibration' });
    if (w.tests) ev.push({ date: addDays(w.start, 5), week: w.index, kind: 'tests' });
    if (w.photos) ev.push({ date: sunday, week: w.index, kind: 'photos' });
    if (w.index % 2 === 0) ev.push({ date: sunday, week: w.index, kind: 'tape' });
    ev.push({ date: sunday, week: w.index, kind: 'checkin' });
  }
  for (const p of phases) ev.push({ date: p.to, week: weeks.filter((w) => w.phase === p.index).at(-1)!.index, kind: 'phase-review' });
  const due = screeningDue(ctx.profile.screening.date, ctx.start);
  const rescreen = due.reason.inputs['due'] as IsoDate;
  ev.push({ date: due.value ? ctx.start : rescreen, week: null, kind: 'rescreen' });
  ev.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)));
  return explain(ev, 'plan.calendar', { start: ctx.start, weeks: weeks.length }, {
    note: 'Weekly check-in on Sundays, tape every 2 weeks, photos at each mesocycle end, tests at each phase end, the RIR calibration set in each mesocycle\'s last loading week (when the screening allows sets to failure), a phase review at each phase end, and the re-screening date.',
  });
}

export interface Target {
  goal: string;
  kind: GoalKind;
  measure: string;
  /** The goal's own measure from the profile, when it names one ("waist (tape), photos"). */
  measuredBy?: string;
  unit: string;
  /** The change predicted by `by`, low to high. */
  predicted: [number, number];
  /** Where it starts, when a baseline is known (the wall test from the self-check). */
  baseline?: number;
  by: IsoDate;
  heuristic: true;
}

export function targets(ctx: PlanContext, phases: readonly PhasePlan[], steps: readonly number[]): Result<Target[]> {
  const first = phases[0]!;
  const weeks = (daysBetween(first.from, first.to) + 1) / 7;
  const r = (x: number) => Math.round(x * 100) / 100;
  const strength = { novice: [10, 20], intermediate: [5, 10], advanced: [2, 5] }[ctx.experience] as [number, number];
  const wall = ctx.profile.selfCheck?.wallGapCm;
  const out: Target[] = ctx.goals.map((g) => {
    const t = (measure: string, unit: string, predicted: [number, number]): Target => {
      const x: Target = { goal: g.id, kind: g.kind, measure, unit, predicted, by: first.to, heuristic: true };
      if (g.measure) x.measuredBy = g.measure;
      if (g.kind === 'posture' && wall !== undefined) x.baseline = wall;
      return x;
    };
    switch (g.kind) {
      case 'fat-loss':
        return t('trend weight', '%', [r(-1.0 * weeks), r(-0.5 * weeks)]);
      case 'gain':
        return t('trend weight', '%', [r(0.25 * weeks), r(0.5 * weeks)]);
      case 'maintenance':
        return t('trend weight', '%', [r(-0.25 * weeks), r(0.25 * weeks)]);
      case 'recomposition':
        return t('waist (tape)', 'cm', [-3, -1]);
      case 'strength':
        return t('main-lift e1RM', '%', strength);
      case 'posture':
        return t('wall gap', 'cm', [-2, -1]);
      case 'skill':
        return t('ladder levels per skill', 'levels', [1, 1]);
      case 'conditioning':
        return t('resting heart rate', 'bpm', [-5, -2]);
      default:
        return t('steps a day (7-day mean)', 'steps', [steps[0] ?? 6000, steps[0] ?? 6000]);
    }
  });
  return explain(out, 'plan.targets', { goals: ctx.goals.map((g) => g.kind), measures: ctx.goals.map((g) => g.measure ?? null), phaseWeeks: weeks, wallGapCm: wall ?? null }, {
    note: joinNotes(
      'Predictions at the end of phase 1, for the phase review to score; all heuristics (weight from the rules.md rate bands times the weeks).',
      ctx.goals.some((g) => g.measure) && 'Each goal is measured the way the profile names it.',
      wall !== undefined && ctx.goalKinds.has('posture') && `The wall gap starts from the self-check's ${wall} cm.`,
    ),
  });
}

/** A pre-mortem risk, its countermeasure, and the profile input(s) it came from (space-separated paths). */
export interface PreMortemItem {
  risk: string;
  countermeasure: string;
  from: string;
}

const LOGGING: Record<'light' | 'standard' | 'full', string> = {
  light: 'Log only that the session happened, its minutes and how hard it felt (Light tracking); progress is read from the check-in.',
  standard: 'Log the top set of the main lifts only (Standard tracking); the rest is optional.',
  full: 'Every set with its RIR (Full tracking); copy the last session in the log form to save time.',
};

/**
 * The pre-mortem's risks from the data, most specific first, at most 3, then
 * the logging line for the user's tracking level. The bad-week answer, goal
 * confidence under 7 and known busy periods come first: they are the user's own.
 */
export function preMortem(ctx: PlanContext, liftingDays: number, minimumDose: boolean, confirmed: number | null, family = 'full-body'): Result<PreMortemItem[]> {
  const out: PreMortemItem[] = [];
  const bad = ctx.badWeek;
  if (bad.has('skips-sessions')) out.push({ from: 'badWeek', risk: 'A bad week means skipped sessions (the profile\'s bad-week answer).', countermeasure: `Express (20 min) instead of a skip; the minimum week is ${liftingDays} sessions of the main lifts at 2 sets${family === 'full-body' ? ', and full body means a missed day costs each muscle only part of its week' : ''}.` });
  if (bad.has('shortens-sessions')) out.push({ from: 'badWeek', risk: 'Sessions get cut short in a bad week.', countermeasure: 'The main lifts come first in every session; when time runs out, the accessories are what drops.' });
  if (bad.has('stops-for-a-while')) out.push({ from: 'badWeek', risk: 'One missed session turns into a week off.', countermeasure: 'If a session is missed, then the next one is Express the same week: the return protocol (missed.ts) restarts gently after longer gaps.' });
  if (bad.has('travel')) out.push({ from: 'badWeek', risk: 'Travel weeks break the routine.', countermeasure: 'The hotel version of each session (bodyweight, bands, light dumbbells) on travel days.' });
  if (bad.has('sleeps-badly')) out.push({ from: 'badWeek', risk: 'Bad weeks come with poor sleep.', countermeasure: 'Readiness trims a session (one set fewer, RIR +1) rather than cancelling it.' });
  const low = ctx.goals.filter((g) => g.confidence < 7);
  if (low.length) out.push({ from: low.map((g) => `goals.${g.id}.confidence`).join(' '), risk: `Confidence under 7 for ${low.map((g) => `"${g.label}" (${g.confidence})`).join(', ')}.`, countermeasure: 'Ask what would make it a 7; the minimum week is the target until it is.' });
  const busy = (ctx.profile.availability.busy ?? []).filter((b) => b.to >= ctx.start);
  if (busy.length) out.push({ from: 'availability.busy', risk: `A known busy period: ${busy.map((b) => `${b.from} to ${b.to}${b.note ? ` (${b.note})` : ''}`).join(', ')}.`, countermeasure: 'The minimum week then, or the deload moved onto it when it falls within a week of one.' });
  if (confirmed !== null && confirmed < liftingDays) out.push({ from: 'useHistory', risk: `${liftingDays} lifting days against ${confirmed.toFixed(1)} confirmed sessions a week lately.`, countermeasure: 'Express (20 min) as the floor on busy days; the minimum week is the main lifts only.' });
  const active = ctx.ledger.filter((c) => c.until === undefined || c.until >= ctx.start);
  if (active.length) out.push({ from: active.map((c) => `ledger.${c.id}`).join(' '), risk: `An active Ledger entry (${active.map((c) => c.id).join(', ')}).`, countermeasure: `Swaps are in the plan; re-screen the lifts ${active.some((c) => c.until) ? `after ${active.map((c) => c.until).filter(Boolean).join(', ')}` : 'at each mesocycle'}, back in at deload loads.` });
  if (ctx.outcome !== 'go') out.push({ from: 'screening.outcome', risk: `Screening is ${ctx.outcome}.`, countermeasure: 'The effort caps are built in; re-screen when health changes or a clinician clears more.' });
  if (ctx.senior) out.push({ from: 'basics.birthYear', risk: 'Starting too hard at 65+.', countermeasure: 'RIR 4 or more for the first phase, balance work every session, fast lifting only from week 9.' });
  if (minimumDose) out.push({ from: 'availability.minutesPerSession', risk: 'Short sessions get skipped when the day runs long.', countermeasure: 'A minimum-dose template: 4 exercises, supersets allowed.' });
  const picked = out.slice(0, 3);
  picked.push({ from: 'trackingLevel', risk: 'Logging friction.', countermeasure: LOGGING[ctx.profile.trackingLevel] });
  return explain(picked, 'plan.pre-mortem', { liftingDays, confirmed, ledger: active.map((c) => c.id), outcome: ctx.outcome, senior: ctx.senior, badWeek: [...bad], lowConfidence: low.map((g) => g.id), busy: busy.length, trackingLevel: ctx.profile.trackingLevel });
}
