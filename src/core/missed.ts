// Missed time (rules.md, "Missed time"; adhoc.md, "Missed weeks"). Ask first
// whether training went unlogged. Then, by the time off since the last session:
// - under a week: a missed session shifts the week; never two in one day;
// - 1-2 weeks: the first week back 10 % lighter and RIR +1;
// - 3+ weeks: restart the mesocycle at week 1 with a calibration week.
// No streak-shaming: say what is next, not what was lost.

import { CALIBRATION, calibrateTarget, calibrationNote } from './calibration.ts';
import { addDays, dayText, daysBetween } from './dates.ts';
import { snapLoad } from './loads.ts';
import type { ProgressionTarget } from './progression.ts';
import { explain, joinNotes, type Result, type RuleFrom } from './reason.ts';
import type { MissedRules } from './rules.ts';
import type { DailyCheckin, IsoDate, RepRange, Session, Unit } from './schema.ts';
import { roundToStep } from './units.ts';

export const MISSED = {
  /** The same 0.9x as progression's lighter step. */
  easeBackLoadFactor: 0.9,
  easeBackRirAdd: 1,
  restartAfterWeeks: 3,
} as const;

export type ReturnKind = 'start' | 'continue' | 'ease-back' | 'restart';

export interface ReturnProtocol {
  protocol: ReturnKind;
  lastSession: IsoDate | null;
  /** Days with no session in the gap that set the protocol: before today, or before `backOn` in a restart's first week. */
  daysOff: number;
  /** Whole weeks off: floor(daysOff / 7). */
  weeksOff: number;
  loadFactor: number;
  rirAdd: number;
  /** The first week back (today and the 6 days after; a restart's from its first session back), for ease-back and restart. */
  firstWeek: { from: IsoDate; to: IsoDate } | null;
  /** A restart's first session back, once one is logged: its first week (a calibration week) runs 7 days from it. */
  backOn?: IsoDate;
  restartAtWeek: 1 | null;
  calibration: boolean;
  /** The next template in the rotation, when the rotation is known. */
  nextTemplate: string | null;
  /** Never two sessions in one day. */
  noStacking: true;
  /** Days in the gap ticked as trained, or marked rest or missed. */
  gapDays: { trained: number; rest: number; missed: number };
}

export interface ReturnInput {
  sessions: readonly Session[];
  today: IsoDate;
  /** Template ids in rotation order. */
  rotation?: readonly string[];
  daily?: readonly DailyCheckin[];
  /**
   * The plan's missed-time rule (rules.ts: weeks to ease back and to restart,
   * the first week back's drop and RIR) and whether a restart's first week is
   * a calibration week; without it, the old default.
   */
  rule?: MissedRules & { afterRestart: boolean; calibrationRir?: number };
  /** The rule, cited in the note. */
  from?: RuleFrom;
}

/** The old default, from MISSED. */
const LEGACY_MISSED: MissedRules & { afterRestart: boolean } = {
  easeBackAfterWeeks: 1,
  restartAfterWeeks: MISSED.restartAfterWeeks,
  easeBackDrop: 1 - MISSED.easeBackLoadFactor,
  easeBackRir: MISSED.easeBackRirAdd,
  afterRestart: true,
};

/**
 * The first day of the latest restart on or before `today`: the first session
 * after a gap of 3+ whole weeks, or today while such a gap is still open (a
 * session logged today is back today); null when there was none.
 */
export function restartStart(sessions: readonly Session[], today: IsoDate, restartAfterWeeks: number = MISSED.restartAfterWeeks): IsoDate | null {
  const dates = [...new Set(sessions.filter((s) => s.date <= today).map((s) => s.date))].sort();
  const restarts = (a: IsoDate, b: IsoDate) => Math.floor((daysBetween(a, b) - 1) / 7) >= restartAfterWeeks;
  const last = dates.filter((d) => d < today).at(-1);
  if (last && restarts(last, today)) return today;
  for (let i = dates.length - 1; i > 0; i--) if (restarts(dates[i - 1]!, dates[i]!)) return dates[i]!;
  return null;
}

/**
 * The return protocol from the session history and today. Sessions dated
 * today or later are ignored. A restart's first week runs 7 days from the
 * first session back, so it holds after that session is logged.
 */
export function returnProtocol(input: ReturnInput): Result<ReturnProtocol> {
  const { today } = input;
  const rule = input.rule ?? LEGACY_MISSED;
  const before = input.sessions.filter((s) => s.date < today).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const last = before.at(-1) ?? null;
  const ruleId = 'missed.return';
  const cite = input.from ? { from: input.from } : {};
  const empty = { trained: 0, rest: 0, missed: 0 };

  if (!last) {
    return explain<ReturnProtocol>(
      {
        protocol: 'start',
        lastSession: null,
        daysOff: 0,
        weeksOff: 0,
        loadFactor: 1,
        rirAdd: 0,
        firstWeek: { from: today, to: addDays(today, 6) },
        restartAtWeek: 1,
        calibration: true,
        nextTemplate: input.rotation?.[0] ?? null,
        noStacking: true,
        gapDays: empty,
      },
      ruleId,
      { today, sessions: 0 },
      { note: 'No sessions yet: start at week 1 with a calibration week.', ...cite },
    );
  }

  // The gap that sets the protocol: before today, or, once back from a 3+ week gap, the one before the first session back.
  const current = daysBetween(last.date, today) - 1;
  const back = Math.floor(current / 7) < 1 ? restartStart(before, addDays(today, -1), rule.restartAfterWeeks) : null;
  const backOn = back && back >= addDays(today, -6) ? back : null;
  const gapFrom = backOn ? before.filter((s) => s.date < backOn).at(-1)!.date : last.date;
  const gapTo = backOn ?? today;
  const daysOff = daysBetween(gapFrom, gapTo) - 1;
  const weeksOff = Math.floor(daysOff / 7);
  const gap = (input.daily ?? []).filter((d) => d.date > gapFrom && d.date < gapTo);
  const gapDays = {
    trained: gap.filter((d) => d.trained === true).length,
    rest: gap.filter((d) => d.mark === 'rest').length,
    missed: gap.filter((d) => d.mark === 'missed').length,
  };
  // The rotation continues from the last session that belongs to it: a custom or
  // short session in between does not restart it.
  const rot = input.rotation ?? [];
  const inRotation = [...before].reverse().find((s) => rot.includes(s.plan?.template ?? s.template ?? ''));
  const template = (inRotation ?? last).plan?.template ?? (inRotation ?? last).template;
  const at = template ? rot.indexOf(template) : -1;
  const nextTemplate = rot.length ? rot[(at + 1) % rot.length]! : null;
  const protocol: ReturnKind = weeksOff >= rule.restartAfterWeeks ? 'restart' : weeksOff >= rule.easeBackAfterWeeks ? 'ease-back' : 'continue';
  const firstWeek = protocol === 'continue' ? null : { from: backOn ?? today, to: addDays(backOn ?? today, 6) };
  // A restart without a calibration week (the plan's rule) eases back like a shorter gap.
  const calibration = protocol === 'restart' && rule.afterRestart;
  const eases = protocol === 'ease-back' || (protocol === 'restart' && !calibration);
  const loadFactor = eases ? (input.rule ? 1 - rule.easeBackDrop : MISSED.easeBackLoadFactor) : 1;
  const pct = Math.round((1 - (input.rule ? 1 - rule.easeBackDrop : MISSED.easeBackLoadFactor)) * 100);
  const easeText = rule.restartAfterWeeks - 1 > rule.easeBackAfterWeeks ? `${rule.easeBackAfterWeeks}-${rule.restartAfterWeeks - 1}` : `${rule.easeBackAfterWeeks}`;

  return explain<ReturnProtocol>(
    {
      protocol,
      lastSession: last.date,
      daysOff,
      weeksOff,
      loadFactor,
      rirAdd: eases ? rule.easeBackRir : 0,
      firstWeek,
      ...(backOn ? { backOn } : {}),
      restartAtWeek: protocol === 'restart' ? 1 : null,
      calibration,
      nextTemplate,
      noStacking: true,
      gapDays,
    },
    ruleId,
    { today, lastSession: last.date, daysOff, rotation: [...rot], lastTemplate: template ?? null, ...(backOn ? { backOn } : {}) },
    {
      threshold: {
        easeBackWeeks: input.rule ? [rule.easeBackAfterWeeks, rule.restartAfterWeeks - 1] : [1, 2],
        restartWeeks: rule.restartAfterWeeks,
        loadFactor: input.rule ? 1 - rule.easeBackDrop : MISSED.easeBackLoadFactor,
        rirAdd: rule.easeBackRir,
      },
      note: joinNotes(
        'Ask first whether any training went unlogged.',
        gapDays.trained > 0 && `${gapDays.trained} day(s) in the gap were ticked as trained: likely unlogged sessions.`,
        protocol === 'continue' && `Next: ${nextTemplate ?? 'the next session in the rotation'}. A missed session shifts the week; never two sessions in one day.`,
        protocol === 'ease-back' && `${weeksOff} week(s) off: the first week back (${dayText(firstWeek!.from)} to ${dayText(firstWeek!.to)}) about ${pct} % lighter and RIR +${rule.easeBackRir}, then the plan as before.`,
        calibration && `${weeksOff} weeks off${backOn ? ` before ${dayText(backOn)}` : ''}: restart the mesocycle at week 1 with a calibration week (${calibrationNote(input.rule?.calibrationRir)})${backOn ? `, ${dayText(firstWeek!.from)} to ${dayText(firstWeek!.to)}` : ''}.`,
        protocol === 'restart' && !calibration && `${weeksOff} weeks off (${easeText === '1' ? '' : `more than ${easeText}; `}no calibration week by the plan's rule): the first week back (${dayText(firstWeek!.from)} to ${dayText(firstWeek!.to)}) about ${pct} % lighter and RIR +${rule.easeBackRir}.`,
      ),
      ...cite,
    },
  );
}

/**
 * A progression target adjusted for the return protocol, on `date` (a day in
 * the first week back). A restart's first week is a calibration week: the
 * target is calibrated with no weight carried over, at the bottom of
 * `exercise.repRange` (the target's own reps without one).
 */
export function applyReturn(
  target: ProgressionTarget,
  protocol: ReturnProtocol,
  /** `weights`: the gym's real weights (loads.ts): the lighter week lands on the nearest one down. */
  exercise: { unit: Unit; increment: number; repRange?: RepRange; weights?: readonly number[] },
  date: IsoDate,
  from?: RuleFrom,
  /** The plan's calibration RIR for a restart's calibration week (default 3). */
  calibrationRir: number = CALIBRATION.rir,
): Result<ProgressionTarget> {
  const inWeek = protocol.firstWeek !== null && date >= protocol.firstWeek.from && date <= protocol.firstWeek.to;
  const inputs = { protocol: protocol.protocol, date, firstWeek: protocol.firstWeek, target };
  const cite = from ? { from } : {};
  if (!inWeek || protocol.protocol === 'continue') {
    return explain(target, 'missed.apply', inputs, { note: inWeek ? undefined : 'Outside the first week back: unchanged.', ...cite });
  }
  if ((protocol.protocol === 'restart' && protocol.calibration) || protocol.protocol === 'start') {
    const c = calibrateTarget(target, { lastWeight: null, repRange: exercise.repRange ?? [target.reps, target.reps], source: protocol.protocol === 'restart' ? 'restart' : 'plan', rir: calibrationRir });
    return explain<ProgressionTarget>(c.value, 'missed.apply', { ...inputs, calibration: c.reason.inputs }, { threshold: { calibrationRir }, ...(c.reason.note ? { note: c.reason.note } : {}), ...cite });
  }
  let weight = target.weight;
  // No lighter real weight: the weight stays and the added RIR alone eases the week.
  let lightest = false;
  if (weight !== null) {
    const weights = exercise.weights?.length ? exercise.weights : null;
    if (weights) {
      const snap = snapLoad(weight * protocol.loadFactor, weight, 'down', weights);
      lightest = snap.floor;
      weight = snap.floor ? Math.min(weight, snap.weight) : snap.weight;
    } else {
      const lighter = roundToStep(weight * protocol.loadFactor, exercise.increment);
      weight = lighter < weight ? lighter : Math.max(0, Number((weight - exercise.increment).toFixed(6)));
    }
  }
  return explain<ProgressionTarget>(
    { ...target, action: 'ease-back', weight, rir: target.rir + protocol.rirAdd },
    'missed.apply',
    inputs,
    {
      threshold: { loadFactor: protocol.loadFactor, rirAdd: protocol.rirAdd },
      note: joinNotes(
        `First week back: ${weight === null ? 'a lighter load' : `${weight} ${exercise.unit}`} x ${target.reps}, RIR ${target.rir + protocol.rirAdd} (was ${target.weight ?? '-'} at RIR ${target.rir}).`,
        lightest && `${weight} ${exercise.unit} is the lightest weight here: the RIR alone eases it.`,
      ) ?? '',
      ...cite,
    },
  );
}
