// The calibration week (planning.md, "Calibration week first"): plan week 1,
// and the first week back after a restart (missed.ts). Every weighted
// exercise finds a load that leaves CALIBRATION.rir reps in reserve at the
// bottom of its range, and nothing progresses or stalls until the week after.
// Intervals that week are easy steady cardio for the same minutes. One rule
// for every place that says or applies it: the vault's week 1, review's
// targets, Today, the log form and the coach.

import type { ProgressionTarget } from './progression.ts';
import { explain, joinNotes, type Result, type RuleFrom } from './reason.ts';
import type { RepRange, TimedWork } from './schema.ts';
import type { Stall } from './stall.ts';
import { isIntervals, timedMinutes, timedText } from './timed.ts';

export const CALIBRATION = {
  /**
   * Reps in reserve while a load is found (H): people misjudge the reps left
   * by about one (Halperin 2022), so aiming at 3 keeps a misjudged first set
   * away from failure while the load found is still a working weight.
   */
  rir: 3,
  /**
   * Intervals in the calibration week (H): easy steady cardio for the same
   * minutes, so the week's hard efforts are the lifts being calibrated and
   * the intervals start after a week of easy base.
   */
  cardio: 'easy, conversational',
} as const;

/** The rule in one line, for notes, flags and tooltips (the plan's calibration RIR, else 3). */
export function calibrationNote(rir: number = CALIBRATION.rir): string {
  return `find a load that leaves ${rir} reps in reserve at the bottom of each range; no progression or stall decisions`;
}

/** A slot as the calibration week has it: its RIR at least the calibration RIR (a copy, never the slot itself). */
export function calibrateSlot<T extends { rir: number }>(slot: T, rir: number = CALIBRATION.rir): T {
  return { ...slot, rir: Math.max(slot.rir, rir) };
}

/** Where a calibration week comes from: plan week 1, or the first week back after 3+ weeks off. */
export type CalibrationSource = 'plan' | 'restart';

/** The calibration week's line for intervals: "easy, conversational; the intervals start in week 2". */
export function calibrationCardioNote(source: CalibrationSource = 'plan'): string {
  return `${CALIBRATION.cardio}; the intervals ${source === 'restart' ? 'come back next week' : 'start in week 2'}`;
}

/**
 * Intervals in a calibration week (rule `plan.calibration.cardio`, H): easy
 * steady cardio for the same total minutes, `{ minutes }`. Null for anything
 * that is not intervals (steady minutes and sets stay as planned).
 */
export function calibrateTimed(timed: TimedWork | null | undefined, source: CalibrationSource = 'plan'): Result<TimedWork> | null {
  if (!isIntervals(timed)) return null;
  const minutes = timedMinutes(timed)!;
  return explain<TimedWork>({ minutes }, 'plan.calibration.cardio', { timed, source }, {
    title: 'Calibration week',
    note: `Calibration week${source === 'restart' ? ' (back after time off)' : ''}: ${minutes} min ${calibrationCardioNote(source)} (planned: ${timedText(timed)}).`,
  });
}

/**
 * A slot as the calibration week has it when it is intervals: one steady
 * block of the same minutes (`timed: { minutes }`, `sets` 1) with the rule's
 * line as its note (a copy, never the slot itself); any other slot as it is.
 */
export function calibrateTimedSlot<T extends { sets: number; timed?: TimedWork; note?: string }>(slot: T, source: CalibrationSource = 'plan'): T {
  const c = calibrateTimed(slot.timed, source);
  if (!c) return slot;
  return { ...slot, sets: 1, timed: c.value, note: `Calibration week: ${c.value.minutes} min ${calibrationCardioNote(source)}.` };
}

export interface CalibrateOptions {
  /**
   * The weight to hold, in the exercise unit: the last loading session's top
   * set; after a restart only one logged since the first session back (the
   * weight from before the gap no longer fits); null without one.
   */
  lastWeight: number | null;
  repRange: RepRange;
  source: CalibrationSource;
  /** The plan's calibration RIR (default 3). */
  rir?: number;
  /** The calibration rule, cited in the note. */
  from?: RuleFrom;
}

/**
 * A progression target turned into the calibration week's: action
 * `calibrate`, the weight held (`lastWeight`, or less when the target already
 * went lighter, as the first week back after 1-2 weeks off does; never more,
 * and none without one), the reps at the bottom of the range and the RIR at
 * least the calibration RIR. What the target proposed is kept in the reason's
 * inputs and named in its note.
 */
export function calibrateTarget(target: ProgressionTarget, opts: CalibrateOptions): Result<ProgressionTarget> {
  const lo = opts.repRange[0];
  const calRir = opts.rir ?? CALIBRATION.rir;
  const rir = Math.max(target.rir, calRir);
  const last = opts.lastWeight;
  const weight = last === null ? null : target.weight === null ? last : Math.min(last, target.weight);
  const unit = target.unit;
  const value: ProgressionTarget = { ...target, action: 'calibrate', weight, reps: lo, rir };
  const found = opts.source === 'restart' ? 'the weight found since coming back' : 'the last weight';
  const held = weight === null ? null : weight === last ? `${found}, held` : `under ${found} of ${last} ${unit}, as the ${target.action} target has it`;
  const proposed = target.weight === null ? null : `${target.weight} ${unit} x ${target.reps} at RIR ${target.rir}`;
  const differs = target.action !== 'calibrate' && proposed !== null && (target.weight !== weight || target.reps !== lo || target.rir !== rir);
  return explain(value, 'calibration.target', { target, lastWeight: opts.lastWeight, repRange: opts.repRange, source: opts.source }, {
    threshold: { rir: calRir },
    ...(opts.from ? { from: opts.from } : {}),
    note: joinNotes(
      `Calibration week${opts.source === 'restart' ? ' (back after time off)' : ''}: ${calibrationNote(calRir)}.`,
      weight === null
        ? `${opts.source === 'restart' ? 'Start lighter than before' : 'No logged load yet'}: find a weight for ${lo} reps at RIR ${rir}.`
        : `Start at ${weight} ${unit} x ${lo} (${held}) and adjust it until ${lo} reps leave ${rir} in reserve.`,
      differs && `Held for now: progression's ${target.action} (${proposed}); from the week after, the targets build on this week's sets.`,
    ),
  });
}

/**
 * A stall verdict in a calibration week: never a stall (status
 * `calibration`). The loads are being found, so a flat or falling e1RM says
 * nothing yet; a stall the trend alone would call is named in the note.
 */
export function calibrationStall(stall: Result<Stall>, source: CalibrationSource): Result<Stall> {
  return explain<Stall>({ ...stall.value, stalled: false, status: 'calibration' }, stall.reason.rule, { ...stall.reason.inputs, calibration: source }, {
    ...(stall.reason.threshold !== undefined ? { threshold: stall.reason.threshold } : {}),
    note: joinNotes(`Calibration week: no stall decision until the week after.`, stall.value.stalled && stall.reason.note && `The trend alone: ${stall.reason.note}`) ?? '',
  });
}
