// The minimum week: the least that keeps a bad week on track, as the plan
// generator writes it ("Express: each session's main lifts at 2 working
// sets; accessories and conditioning optional"), from a plan's lifting days
// and its Express block. It beats skipping the week; the roadmap's
// pre-mortem points at it for a bad week. Pure.

import { explain, type Result } from './reason.ts';

export interface MinimumWeek {
  /** Lifting sessions that week, each as Express. */
  sessions: number;
  /** Working sets of each main lift. */
  mainSets: number;
  /** About how long each one takes. */
  minutes: number;
  /** In words, for the screens. */
  text: string;
}

/** Express's own length (the session report's): about 20 minutes. */
export const EXPRESS_MINUTES = 20;

/** The minimum week for a plan of `liftDays` lifting sessions a week; null without any. */
export function minimumWeek(input: { liftDays: number; mainSets: number | null; shortDays: number }): Result<MinimumWeek | null> {
  const n = input.liftDays;
  const sets = input.mainSets && input.mainSets > 0 ? input.mainSets : 2;
  if (!(n > 0)) return explain(null, 'plan.minimum-week', { liftDays: n }, { note: 'No lifting sessions in the plan: no minimum week.' });
  const word = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'][n] ?? String(n);
  const text = `${word[0]!.toUpperCase()}${word.slice(1)} lifting session${n === 1 ? '' : 's'} as Express: each one's main lifts at ${sets} working sets, about ${EXPRESS_MINUTES} minutes.${input.shortDays > 0 ? ' The short sessions and cardio are optional that week; a walk counts.' : ''}`;
  return explain<MinimumWeek>({ sessions: n, mainSets: sets, minutes: EXPRESS_MINUTES, text }, 'plan.minimum-week', { liftDays: n, mainSets: sets, shortDays: input.shortDays }, {
    title: 'The minimum week',
    note: `For a bad week: the least that keeps you on track, and it beats skipping the week. ${text}`,
  });
}
