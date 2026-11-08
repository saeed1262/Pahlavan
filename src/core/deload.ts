// Deloads (rules.md, "Deloads"; checkin.md, deload triggers): the plan's
// light weeks (rules.ts: every Nth week, or the weeks the plan lists), the
// early signals (readiness, stalls on 2+ main lifts, poor recovery), and the
// prescription for the week. The old default applies an early signal, moves
// a light week onto a busy week and lets the user cancel one; a plan that
// declares its light weeks reports the signals as facts and the coach moves
// a light week by editing the plan.

import { daysBetween, mondayOf } from './dates.ts';
import { explain, joinNotes, type Result, type RuleFrom } from './reason.ts';
import { isLightWeek, lightCalendarText, nextLightWeek, nthLightWeek, type LightWeeksRules } from './rules.ts';
import type { BusyKind, BusyPeriod, ExerciseSlot, IsoDate, RepRange } from './schema.ts';

export const DELOAD = {
  every: 4,
  /** Stalls on this many main lifts in one week trigger a deload. */
  stalledMainLifts: 2,
  rirAdd: 3,
  /** The dashboard's legacy deload: 2 sets of everything, about 10 % lighter. */
  legacySets: 2,
  legacyLoadFactor: 0.9,
} as const;

/** readiness and stalls from the data; recovery (two poor check-ins with joint aches) and busy-week from the check-in answers. */
export type DeloadTrigger = 'readiness' | 'stalls' | 'recovery' | 'busy-week';

export interface DeloadMove {
  /** The scheduled plan week the deload moved from, and the plan week it moved to. */
  from: number;
  to: number;
  busy: { from: IsoDate; to: IsoDate; kind: BusyKind };
}

export interface DeloadDecision {
  /** Plan week counted from the program start's Monday (week 1). */
  planWeek: number;
  scheduled: boolean;
  /** Weeks to the next deload (moved by a busy week if one was), 0 in a deload week; null when the plan lists none ahead. */
  weeksToScheduled: number | null;
  /** Every early signal that fired (and a busy-week move): facts, whether or not the rule acts on them. */
  signals: DeloadTrigger[];
  /** The signals acted on: the ones that make this a light week. */
  triggers: DeloadTrigger[];
  deload: boolean;
  /** The user's override was applied. */
  cancelled: boolean;
  /** Present when a busy week moved the deload into or out of this week. */
  move?: DeloadMove;
}

export interface DeloadInput {
  programStart: IsoDate;
  today: IsoDate;
  /** Deload every Nth week (default 4), when `lightWeeks` is not given. */
  every?: number;
  /** The plan's light weeks (rules.ts): every Nth week or the listed weeks. */
  lightWeeks?: Pick<LightWeeksRules, 'every' | 'weeks'>;
  /** What an early signal does: makes the week light (the old default), is offered as a fact, or is only listed. */
  early?: LightWeeksRules['early'];
  /** The old default's busy-week move and cancel (default true): a plan's declared light weeks move only when the coach edits them. */
  legacy?: boolean;
  /** The light-week rule, cited in the note. */
  from?: RuleFrom;
  /** readiness.ts readinessActions: the early-deload action is active. */
  earlyDeloadSignal?: boolean;
  /** Main lifts with a stall this week (stall.ts). */
  stalledMainLifts?: readonly string[];
  /** checkins.ts recoveryTrigger: poor recovery and joint aches at two check-ins running. */
  recoveryTrigger?: boolean;
  /** Known busy periods (check-in answers): a busy week next to a scheduled deload becomes the deload. */
  busy?: readonly BusyPeriod[];
  /** The user cancels this week's deload (scheduled or triggered). */
  cancelled?: boolean;
  /** The previous scheduled deload was cancelled too. */
  previousCancelled?: boolean;
}

/**
 * The deload weeks after busy moves: each scheduled week stays when a busy
 * period covers it, else moves to the busy week just before it, else to the
 * busy week just after it (planning.md, life-aware scheduling).
 */
function movedDeloads(programStart: IsoDate, lw: Pick<LightWeeksRules, 'every' | 'weeks'>, busy: readonly BusyPeriod[], upTo: number): Map<number, DeloadMove | null> {
  const week = (d: IsoDate) => Math.floor(daysBetween(mondayOf(programStart), mondayOf(d)) / 7) + 1;
  const busyWeeks = new Map<number, BusyPeriod>();
  for (const b of busy) for (let w = week(b.from); w <= week(b.to); w++) if (!busyWeeks.has(w)) busyWeeks.set(w, b);
  const out = new Map<number, DeloadMove | null>();
  for (let n = 1; ; n++) {
    const s = nthLightWeek(lw, n);
    if (s === null || s > upTo) break;
    const pick = busyWeeks.has(s) ? s : busyWeeks.has(s - 1) && s - 1 >= 1 ? s - 1 : busyWeeks.has(s + 1) ? s + 1 : s;
    const b = busyWeeks.get(pick);
    out.set(pick, pick === s || !b ? null : { from: s, to: pick, busy: { from: b.from, to: b.to, kind: b.kind } });
  }
  return out;
}

/** The light weeks up to a plan week, unmoved. */
function plainDeloads(lw: Pick<LightWeeksRules, 'every' | 'weeks'>, upTo: number): Map<number, DeloadMove | null> {
  const out = new Map<number, DeloadMove | null>();
  for (let n = 1; ; n++) {
    const s = nthLightWeek(lw, n);
    if (s === null || s > upTo) break;
    out.set(s, null);
  }
  return out;
}

export function decideDeload(input: DeloadInput): Result<DeloadDecision> {
  const every = input.lightWeeks ? input.lightWeeks.every : (input.every ?? DELOAD.every);
  if (every !== null && !(Number.isInteger(every) && every >= 2)) throw new RangeError(`deload interval must be a whole number of 2 or more, got ${every}`);
  const lw = input.lightWeeks ?? { every, weeks: null };
  const legacy = input.legacy ?? true;
  const early = input.early ?? 'apply';
  const offset = daysBetween(mondayOf(input.programStart), mondayOf(input.today));
  if (offset < 0) throw new RangeError(`${input.today} is before the program start ${input.programStart}`);
  const planWeek = offset / 7 + 1;
  const scheduled = isLightWeek(lw, planWeek);
  // Far enough ahead for the next light week after this one, moved or not.
  const ahead = (nextLightWeek(lw, planWeek + 1) ?? planWeek) + 1;
  const deloads = legacy ? movedDeloads(input.programStart, lw, input.busy ?? [], ahead) : plainDeloads(lw, ahead);
  const here = deloads.has(planWeek);
  const movedIn = deloads.get(planWeek) ?? null;
  const movedOut = scheduled && !here ? [...deloads.values()].find((m) => m?.from === planWeek) ?? null : null;
  const upcoming = [...deloads.keys()].filter((w) => w >= planWeek).map((w) => w - planWeek);
  const weeksToScheduled = upcoming.length ? Math.min(...upcoming) : null;
  const stalled = input.stalledMainLifts ?? [];
  const signals: DeloadTrigger[] = [];
  if (input.earlyDeloadSignal === true) signals.push('readiness');
  if (stalled.length >= DELOAD.stalledMainLifts) signals.push('stalls');
  if (input.recoveryTrigger === true) signals.push('recovery');
  const triggers: DeloadTrigger[] = early === 'apply' ? [...signals] : [];
  if (movedIn) {
    signals.push('busy-week');
    triggers.push('busy-week');
  }
  const wanted = here || triggers.length > 0;

  let deload = wanted;
  let cancelled = false;
  let cancelNote: string | undefined;
  if (input.cancelled && wanted && !legacy) {
    cancelNote = 'The check-in cancels this light week, but the plan\'s rule still has it: to move it, the coach edits the plan\'s light weeks.';
  } else if (input.cancelled && wanted) {
    if (here && input.previousCancelled) {
      cancelNote = 'Cancel not applied: the last scheduled deload was cancelled too, and two mesocycles never run without one.';
    } else {
      deload = false;
      cancelled = true;
      cancelNote = `Cancelled by the user (their override of the ${here ? 'scheduled' : 'triggered'} deload).`;
    }
  }

  const move = movedIn ?? movedOut ?? undefined;
  const value: DeloadDecision = { planWeek, scheduled, weeksToScheduled, signals, triggers, deload, cancelled };
  if (move) value.move = move;
  const fired = signals.filter((t) => t !== 'busy-week');
  const act = early === 'apply' ? 'offer an early light week' : early === 'offer' ? 'a signal for an early light week; the plan\'s rule leaves it to the coach' : 'a fact only (the plan\'s rule takes no early light week)';
  return explain<DeloadDecision>(
    value,
    'deload.decide',
    {
      programStart: input.programStart,
      today: input.today,
      planWeek,
      earlyDeloadSignal: input.earlyDeloadSignal ?? null,
      stalledMainLifts: stalled,
      ...(input.recoveryTrigger !== undefined ? { recoveryTrigger: input.recoveryTrigger } : {}),
      ...(input.busy?.length ? { busy: input.busy.map((b) => ({ from: b.from, to: b.to, kind: b.kind })) } : {}),
      cancelled: input.cancelled ?? false,
      previousCancelled: input.previousCancelled ?? false,
    },
    {
      threshold: lw.weeks ? { weeks: lw.weeks, stalledMainLifts: DELOAD.stalledMainLifts } : { every, stalledMainLifts: DELOAD.stalledMainLifts },
      note: joinNotes(
        scheduled && !movedOut && (lw.weeks ? `Plan week ${planWeek}: a light week (${lightCalendarText(lw)}).` : `Plan week ${planWeek}: the scheduled deload (every ${every}th week).`),
        movedOut && `Plan week ${planWeek} was the scheduled deload; it moved to week ${movedOut.to}, the ${movedOut.busy.kind} week (${movedOut.busy.from} to ${movedOut.busy.to}).`,
        movedIn && `Plan week ${planWeek}: the deload moved here from week ${movedIn.from}, to fall on the ${movedIn.busy.kind} week (${movedIn.busy.from} to ${movedIn.busy.to}).`,
        !here && !movedOut && (weeksToScheduled === null ? `Plan week ${planWeek}: the plan lists no light week ahead.` : `Plan week ${planWeek}: the ${scheduled ? 'next' : 'scheduled'} deload is in ${weeksToScheduled} week(s).`),
        movedOut && `The next deload is in ${weeksToScheduled} week(s).`,
        fired.includes('readiness') && `Readiness has been low 5 days running with a falling e1RM: ${act}.`,
        fired.includes('stalls') && `Stalls on ${stalled.length} main lifts (${stalled.join(', ')}): ${act}.`,
        fired.includes('recovery') && `Poor recovery and joint aches at two check-ins running: ${act} (heuristic).`,
        !here && triggers.some((t) => t !== 'busy-week') && 'The user decides.',
        cancelNote,
      ),
      ...(input.from ? { from: input.from } : {}),
    },
  );
}

export type DeloadStyle = 'standard' | 'legacy';

export interface DeloadSlot {
  exercise: string;
  sets: number;
  repRange: RepRange;
  rir: number;
  /** Reps to aim for; null leaves them to the range (standard). */
  reps: number | null;
  /** A multiplier on the last loading weight; null when the load follows from the RIR. */
  loadFactor: number | null;
}

/**
 * The deload week for a session's slots.
 * - standard (rules.md): half the sets rounded up, RIR +3, the same exercises.
 * - legacy (the dashboard's): 2 sets of everything, about 10 % lighter, at the bottom of the range.
 */
export function deloadPrescription(slots: readonly ExerciseSlot[], style: DeloadStyle = 'standard'): Result<DeloadSlot[]> {
  const out: DeloadSlot[] = slots.map((s) =>
    style === 'standard'
      ? { exercise: s.exercise, sets: Math.ceil(s.sets / 2), repRange: s.repRange, rir: s.rir + DELOAD.rirAdd, reps: null, loadFactor: null }
      : { exercise: s.exercise, sets: DELOAD.legacySets, repRange: s.repRange, rir: s.rir, reps: s.repRange[0], loadFactor: DELOAD.legacyLoadFactor },
  );
  return explain(out, `deload.prescription.${style}`, { style, slots: slots.map((s) => ({ exercise: s.exercise, sets: s.sets, rir: s.rir })) }, {
    threshold: style === 'standard' ? { sets: 'half, rounded up', rirAdd: DELOAD.rirAdd } : { sets: DELOAD.legacySets, loadFactor: DELOAD.legacyLoadFactor },
    note:
      style === 'standard'
        ? 'Half the sets, RIR +3, same exercises; never a full week off. The load is whatever leaves 3 more reps in reserve (progression gives about 10 % under the last loading weight at the bottom of the range).'
        : 'The dashboard\'s deload: 2 sets of everything, about 10 % lighter, at the bottom of the range. The same set count as the standard one for 3-4-set exercises; a 2-set exercise keeps both sets and a 5-set exercise drops to 2.',
  });
}
