// Stand-ups: after a stretch of active sitting, a card asks you to stand.
// `standStep` is Habit Nudges' standStep, ported step for step (a golden test
// runs both on the same inputs): the plugin calls it every tick with the
// gap since the last tick, the seconds since the last keyboard or mouse
// input and whether a call is on, and keeps the state in memory per Mac.

import { toMinutes, type Moment } from './clock.ts';
import { explain, type Result } from './reason.ts';
import type { StandupConfig, TrackedItem } from './schema.ts';

export type StandPhase = 'sitting' | 'due' | 'standing';

/** The stand-up count: the phase, minutes sat and stood (as ms), the snooze. */
export interface StandState {
  phase: StandPhase;
  satMs: number;
  stoodMs: number;
  /** Epoch ms: the card waits until then. */
  snoozedUntil: number;
  /** One snooze per round. */
  snoozeUsed: boolean;
}

/** What the plugin reads each tick. */
export interface StandInput {
  /** Epoch ms now. */
  now: number;
  /** Ms since the last step (a long gap: the Mac slept, or the app was closed). */
  gapMs: number;
  /** Seconds since the last keyboard or mouse input anywhere on the Mac. */
  idleS: number;
  /** A call is on (microphone or camera); false when calls do not pause, or the helper cannot tell. */
  meeting: boolean;
}

/** The step's settings: Habit Nudges' stand settings. */
export interface StandStepConfig {
  sitMinutes: number;
  standMinutes: number;
  activeSeconds: number;
  awayMinutes: number;
  standAwayMinutes: number;
  /**
   * Time away during a stand counts as standing (Pahlavan's own): you got
   * up, and the stand runs its minutes whether or not the keyboard and
   * mouse are touched. Off (Habit Nudges' rule): no input for
   * `standAwayMinutes` ends the stand uncounted.
   */
  countAway?: boolean;
}

export type StandEvent = 'finished' | 'abandoned' | null;

export const STAND_FRESH: Readonly<StandState> = { phase: 'sitting', satMs: 0, stoodMs: 0, snoozedUntil: 0, snoozeUsed: false };

/** Habit Nudges' tick: a step counts at most two of these. */
export const STAND_TICK_MS = 30_000;

/**
 * One step of the stand-up count. Away (no input for `awayMinutes`, or that
 * long between steps: the Mac slept) starts over; a stand with no input for
 * `standAwayMinutes` does not count ("abandoned"), unless `countAway`: then
 * the time away counts as standing, a gap between steps (the Mac asleep)
 * included, until the stand's minutes are done; a finished stand returns
 * "finished". While sitting, a minute counts only with recent input and no
 * call; a call takes a due card down until it ends.
 */
export function standStep(st: Partial<StandState>, inp: StandInput, cfg: StandStepConfig, tickMs = STAND_TICK_MS): { st: StandState; event: StandEvent } {
  const s: StandState = { ...STAND_FRESH, ...st };
  const gone = (min: number) => inp.gapMs >= min * 60000 || inp.idleS >= min * 60;
  const away = gone(cfg.awayMinutes);
  const step = Math.min(Math.max(0, inp.gapMs), 2 * tickMs);
  if (s.phase === 'standing') {
    if (!cfg.countAway && gone(cfg.standAwayMinutes)) return { st: { ...STAND_FRESH }, event: 'abandoned' };
    s.stoodMs += cfg.countAway ? Math.max(0, inp.gapMs) : step;
    if (s.stoodMs >= cfg.standMinutes * 60000) return { st: { ...STAND_FRESH }, event: 'finished' };
    return { st: s, event: null };
  }
  if (away) return { st: { ...STAND_FRESH }, event: null };
  if (s.phase === 'due' && inp.meeting) s.phase = 'sitting'; // the card comes back after the call
  if (s.phase === 'sitting') {
    if (inp.idleS < cfg.activeSeconds && !inp.meeting) s.satMs += step;
    if (s.satMs >= cfg.sitMinutes * 60000 && !inp.meeting && inp.now >= s.snoozedUntil) s.phase = 'due';
  }
  return { st: s, event: null };
}

/** The card's answers: stand now, or the one snooze of the round (Habit Nudges' standAnswered). */
export function standAnswer(st: StandState, how: 'stand' | 'snooze', now: number, snoozeMinutes: number): StandState {
  if (how === 'stand') return { ...st, phase: 'standing', stoodMs: 0 };
  return { ...st, phase: 'sitting', snoozeUsed: true, snoozedUntil: now + snoozeMinutes * 60000 };
}

/** "Ask me now": as if the sitting minutes were done, so a call that takes the card down brings it back after. */
export function standAskNow(st: StandState, cfg: Pick<StandStepConfig, 'sitMinutes'>): StandState {
  return { ...st, phase: 'due', satMs: Math.max(st.satMs, cfg.sitMinutes * 60000) };
}

/**
 * The step's settings from a stand-up item. "Count only while active" off
 * counts every minute until time away resets it (the active span becomes
 * the away limit).
 */
export function standConfig(c: StandupConfig): StandStepConfig {
  return {
    sitMinutes: c.sitMinutes,
    standMinutes: c.standMinutes,
    activeSeconds: c.activeOnly ? c.activeSeconds : c.awayMinutes * 60,
    awayMinutes: c.awayMinutes,
    standAwayMinutes: c.standAwayMinutes,
    // Standing away from the desk is the point of a stand: Pahlavan counts it.
    countAway: true,
  };
}

/** Whether a call should hold the count: only when the item pauses for calls. */
export const standMeeting = (c: StandupConfig, callOn: boolean | null): boolean => c.pauseCalls && callOn === true;

/** Inside the item's hours now (all day without them). */
export function inStandHours(c: StandupConfig, now: Moment): boolean {
  if (!c.hours) return true;
  const from = toMinutes(c.hours[0]) ?? 0;
  const to = toMinutes(c.hours[1]) ?? 24 * 60;
  return now.minutes >= from && now.minutes < to;
}

/** Where the count stands, for the status bar and Due today: minutes sitting this round, minutes left to sit or to stand. */
export function standProgress(st: StandState, c: StandupConfig): { phase: StandPhase; satMinutes: number; sitLeft: number; standLeft: number | null; snoozeAvailable: boolean } {
  return {
    phase: st.phase,
    satMinutes: Math.floor(st.satMs / 60000),
    sitLeft: Math.max(0, Math.ceil((c.sitMinutes * 60000 - st.satMs) / 60000)),
    standLeft: st.phase === 'standing' ? Math.max(1, Math.ceil((c.standMinutes * 60000 - st.stoodMs) / 60000)) : null,
    snoozeAvailable: !st.snoozeUsed,
  };
}

/** The card's Why: after N minutes of active sitting, stand M, and who set it. */
export function standReason(item: TrackedItem, st: StandState): Result<boolean> {
  const c = item.standup!;
  return explain(st.phase === 'due', 'habits.stand-ups', { item: item.id, satMinutes: Math.floor(st.satMs / 60000), sitMinutes: c.sitMinutes, standMinutes: c.standMinutes, pauseCalls: c.pauseCalls }, {
    threshold: { sitMinutes: c.sitMinutes },
    note: `After ${c.sitMinutes} minutes of active sitting, stand for ${c.standMinutes}. It can't be closed, only started or snoozed${sourceNote(item)}.`,
  });
}

/** ", suggested by your coach: <why>" or ", added by you". */
export function sourceNote(item: Pick<TrackedItem, 'source'>): string {
  const s = item.source;
  if (s.by === 'coach') return `, suggested by your coach: ${lowerFirst(s.why ?? '')}`;
  return s.from ? `, added by you (from ${s.from})` : ', added by you';
}

const lowerFirst = (t: string) => (t && /^[A-Z][a-z]/.test(t) ? t[0]!.toLowerCase() + t.slice(1) : t);
