// Missed time (rules.md, "Missed time"; adhoc.md, "Missed weeks"). Ask first
// whether training went unlogged. Then, by the time off since the last session:
// - under a week: a missed session shifts the week; never two in one day;
// - 1-2 weeks: the first week back 10 % lighter and RIR +1;
// - 3+ weeks: restart the mesocycle at week 1 with a calibration week.
// No streak-shaming: say what is next, not what was lost.

import { addDays, dayText, daysBetween } from './dates.ts';
import type { ProgressionTarget } from './progression.ts';
import { explain, joinNotes, type Result } from './reason.ts';
import type { DailyCheckin, IsoDate, Session, Unit } from './schema.ts';
import { roundToStep } from './units.ts';

export const MISSED = {
  /** The same 0.9x as progression's lighter step. */
  easeBackLoadFactor: 0.9,
  easeBackRirAdd: 1,
  restartAfterWeeks: 3,
  /** Calibration: a load that leaves 2-3 reps in reserve at the bottom of the range; the engine asks for 3. */
  calibrationRir: 3,
} as const;

export type ReturnKind = 'start' | 'continue' | 'ease-back' | 'restart';

export interface ReturnProtocol {
  protocol: ReturnKind;
  lastSession: IsoDate | null;
  /** Days with no session between the last session and today. */
  daysOff: number;
  /** Whole weeks off: floor(daysOff / 7). */
  weeksOff: number;
  loadFactor: number;
  rirAdd: number;
  /** The first week back (today and the 6 days after), for ease-back and restart. */
  firstWeek: { from: IsoDate; to: IsoDate } | null;
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
}

/** The return protocol from the session history and today. Sessions dated today or later are ignored. */
export function returnProtocol(input: ReturnInput): Result<ReturnProtocol> {
  const { today } = input;
  const before = input.sessions.filter((s) => s.date < today).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const last = before.at(-1) ?? null;
  const rule = 'missed.return';
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
      rule,
      { today, sessions: 0 },
      { note: 'No sessions yet: start at week 1 with a calibration week.' },
    );
  }

  const daysOff = daysBetween(last.date, today) - 1;
  const weeksOff = Math.floor(daysOff / 7);
  const gap = (input.daily ?? []).filter((d) => d.date > last.date && d.date < today);
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
  const protocol: ReturnKind = weeksOff >= MISSED.restartAfterWeeks ? 'restart' : weeksOff >= 1 ? 'ease-back' : 'continue';
  const firstWeek = protocol === 'continue' ? null : { from: today, to: addDays(today, 6) };

  return explain<ReturnProtocol>(
    {
      protocol,
      lastSession: last.date,
      daysOff,
      weeksOff,
      loadFactor: protocol === 'ease-back' ? MISSED.easeBackLoadFactor : 1,
      rirAdd: protocol === 'ease-back' ? MISSED.easeBackRirAdd : 0,
      firstWeek,
      restartAtWeek: protocol === 'restart' ? 1 : null,
      calibration: protocol === 'restart',
      nextTemplate,
      noStacking: true,
      gapDays,
    },
    rule,
    { today, lastSession: last.date, daysOff, rotation: [...rot], lastTemplate: template ?? null },
    {
      threshold: { easeBackWeeks: [1, 2], restartWeeks: MISSED.restartAfterWeeks, loadFactor: MISSED.easeBackLoadFactor, rirAdd: MISSED.easeBackRirAdd },
      note: joinNotes(
        'Ask first whether any training went unlogged.',
        gapDays.trained > 0 && `${gapDays.trained} day(s) in the gap were ticked as trained: likely unlogged sessions.`,
        protocol === 'continue' && `Next: ${nextTemplate ?? 'the next session in the rotation'}. A missed session shifts the week; never two sessions in one day.`,
        protocol === 'ease-back' && `${weeksOff} week(s) off: the first week back (${dayText(firstWeek!.from)} to ${dayText(firstWeek!.to)}) about 10 % lighter and RIR +1, then the plan as before.`,
        protocol === 'restart' && `${weeksOff} weeks off: restart the mesocycle at week 1 with a calibration week (a load that leaves 2-3 reps in reserve at the bottom of each range; no progression or stall checks that week).`,
      ),
    },
  );
}

/** A progression target adjusted for the return protocol, on `date` (a day in the first week back). */
export function applyReturn(
  target: ProgressionTarget,
  protocol: ReturnProtocol,
  exercise: { unit: Unit; increment: number },
  date: IsoDate,
): Result<ProgressionTarget> {
  const inWeek = protocol.firstWeek !== null && date >= protocol.firstWeek.from && date <= protocol.firstWeek.to;
  const inputs = { protocol: protocol.protocol, date, firstWeek: protocol.firstWeek, target };
  if (!inWeek || protocol.protocol === 'continue') {
    return explain(target, 'missed.apply', inputs, { note: inWeek ? undefined : 'Outside the first week back: unchanged.' });
  }
  if (protocol.protocol === 'restart' || protocol.protocol === 'start') {
    return explain<ProgressionTarget>(
      { ...target, action: 'calibrate', weight: null, rir: Math.max(target.rir, MISSED.calibrationRir) },
      'missed.apply',
      inputs,
      { threshold: { calibrationRir: MISSED.calibrationRir }, note: 'Calibration week: find a load that leaves 2-3 reps in reserve at the bottom of the range.' },
    );
  }
  let weight = target.weight;
  if (weight !== null) {
    const lighter = roundToStep(weight * MISSED.easeBackLoadFactor, exercise.increment);
    weight = lighter < weight ? lighter : Math.max(0, Number((weight - exercise.increment).toFixed(6)));
  }
  return explain<ProgressionTarget>(
    { ...target, action: 'ease-back', weight, rir: target.rir + MISSED.easeBackRirAdd },
    'missed.apply',
    inputs,
    {
      threshold: { loadFactor: MISSED.easeBackLoadFactor, rirAdd: MISSED.easeBackRirAdd },
      note: `First week back: ${weight === null ? 'a lighter load' : `${weight} ${exercise.unit}`} x ${target.reps}, RIR ${target.rir + MISSED.easeBackRirAdd} (was ${target.weight ?? '-'} at RIR ${target.rir}).`,
    },
  );
}
