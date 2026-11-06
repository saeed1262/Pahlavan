// Program helpers: a slot's `until` change and the week a date falls in.

import { explain, type Result } from './reason.ts';
import type { ExerciseSlot, IsoDate, Program, Week } from './schema.ts';
import { addDays, dayText } from './dates.ts';

/** The slot as it stands on `date`: its `until` change applies through that date. */
export function effectiveSlot(slot: ExerciseSlot, date: IsoDate): Result<ExerciseSlot> {
  const change = slot.until;
  if (!change) return explain(slot, 'plan.until', { date, change: null });
  if (date > change.until) {
    const { until: _done, ...rest } = slot;
    return explain(rest, 'plan.until', { date, until: change.until }, {
      note: `The temporary change ended on ${dayText(change.until)} (${change.reason}): due for review, back to the standing slot.`,
    });
  }
  const applied: ExerciseSlot = { ...slot };
  if (change.exercise !== undefined) applied.exercise = change.exercise;
  if (change.sets !== undefined) applied.sets = change.sets;
  if (change.repRange !== undefined) applied.repRange = change.repRange;
  if (change.rir !== undefined) applied.rir = change.rir;
  return explain(applied, 'plan.until', { date, until: change.until }, {
    note: `Temporary change through ${dayText(change.until)}: ${change.reason}.`,
  });
}

/** The program week holding `date` (weeks run Monday to Sunday from their start). */
export function weekAt(program: Program, date: IsoDate): Week | undefined {
  for (const phase of program.macrocycle.phases) {
    for (const meso of phase.mesocycles) {
      for (const week of meso.weeks) {
        if (week.start <= date && date <= addDays(week.start, 6)) return week;
      }
    }
  }
  return undefined;
}
