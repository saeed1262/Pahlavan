// The two counts kept in memory on each Mac, stepped every 30 seconds:
// each stand-up item's round (Habit Nudges' standTick around the engine's
// standStep) and the sitting stretch (its deskTick around sittingStep). The
// stand-up count never leaves the Mac; a finished stand comes back as an
// event, for the plugin to log. The sitting stretch is written into
// Coach/sitting.json under this Mac's name: while it runs (every 2 minutes,
// once it is a minute long), when it closes, and a stretch that closes under
// a minute is taken out again. Pure: the plugin passes the moment, the idle
// seconds and the call state, and writes what comes back.

import type { DayClock } from '../../../src/core/clock.ts';
import type { IsoDate, SittingConfig, SittingLog, StandupConfig, TrackedItem } from '../../../src/core/schema.ts';
import { SITTING_MIN_MS, sittingStep, stretchesOn, stretchFromFile, stretchToFile, summarizeDay, type SittingDay, type Stretch } from '../../../src/core/sitting.ts';
import { STAND_FRESH, STAND_TICK_MS, standAnswer, standAskNow, standConfig, standMeeting, standStep, type StandState } from '../../../src/core/standup.ts';
import type { SittingChange } from '../../../src/adapters/vault/tracking-write.ts';

// ---------------------------------------------------------------- stand-ups

export interface StandEventOut {
  item: TrackedItem;
  /** 'desk': a stand's minutes stood at the desk with "Standing now" on, logged quietly (and as the day's desk minutes). */
  event: 'finished' | 'abandoned' | 'desk';
  /** Minutes stood, for a finished stand or a desk stand. */
  minutes: number;
}

export class StandCounter {
  private readonly states = new Map<string, StandState>();
  /** Time stood at the desk with "Standing now" on, toward the next desk stand. */
  private readonly desk = new Map<string, number>();
  private last = 0;

  /** Ms stood at the desk toward the item's next desk stand (0 when the switch is off). */
  deskMs(id: string): number {
    return this.desk.get(id) ?? 0;
  }

  /** Each item's count (fresh for one not stepped yet). */
  state(id: string): StandState {
    return this.states.get(id) ?? { ...STAND_FRESH };
  }

  all(): ReadonlyMap<string, StandState> {
    return this.states;
  }

  /** A stand is under way on this Mac (standing is not sitting). */
  standing(): boolean {
    return [...this.states.values()].some((s) => s.phase === 'standing');
  }

  /**
   * One step for the stand-up items counting now (due today, inside their
   * hours, reminders on here). Others start over. `call`: a call is on
   * (null: the helper could not tell, which counts as no call).
   */
  step(items: readonly TrackedItem[], inp: { now: number; idleS: number; call: boolean | null; standingNow?: boolean }): StandEventOut[] {
    const gapMs = this.last ? inp.now - this.last : STAND_TICK_MS;
    this.last = inp.now;
    const ids = new Set(items.map((x) => x.id));
    for (const id of [...this.states.keys()]) if (!ids.has(id)) this.states.delete(id);
    for (const id of [...this.desk.keys()]) if (!ids.has(id)) this.desk.delete(id);
    const out: StandEventOut[] = [];
    for (const item of items) {
      const c: StandupConfig = item.standup!;
      const prev = this.state(item.id);
      // Standing at the desk is standing: each stand's worth of minutes is logged as a stand and the
      // sitting count starts over. Counted like a sitting minute (a long gap, the Mac asleep, adds at most
      // two ticks); time away turns the switch off. Less than a stand's minutes when it goes off: not logged.
      if (inp.standingNow === true && prev.phase !== 'standing') {
        const desk = this.deskMs(item.id) + Math.min(Math.max(0, gapMs), 2 * STAND_TICK_MS);
        if (desk >= c.standMinutes * 60_000) {
          this.desk.set(item.id, desk - c.standMinutes * 60_000);
          this.states.set(item.id, { ...STAND_FRESH });
          out.push({ item, event: 'desk', minutes: c.standMinutes });
          continue;
        }
        this.desk.set(item.id, desk);
      } else this.desk.delete(item.id);
      // A stand keeps counting through a call, so the call matters only while sitting at the Mac.
      // "Standing now" holds the round the way a call does (no sitting minutes, a due card goes down) until its minutes make a desk stand.
      const meeting = prev.phase !== 'standing' && (inp.standingNow === true || (inp.idleS < c.awayMinutes * 60 && standMeeting(c, inp.call)));
      const r = standStep(prev, { now: inp.now, gapMs, idleS: inp.idleS, meeting }, standConfig(c));
      this.states.set(item.id, r.st);
      if (r.event) out.push({ item, event: r.event, minutes: c.standMinutes });
    }
    return out;
  }

  /** "I'm standing" or the round's one snooze, from the card. */
  answer(id: string, how: 'stand' | 'snooze', now: number, snoozeMinutes: number): StandState {
    const st = standAnswer(this.state(id), how, now, snoozeMinutes);
    this.states.set(id, st);
    return st;
  }

  /** "Ask me now": the card comes up on the next step. */
  askNow(item: TrackedItem): StandState {
    const st = standAskNow(this.state(item.id), { sitMinutes: item.standup!.sitMinutes });
    this.states.set(item.id, st);
    return st;
  }

  /** Ends a stand early: it does not count. */
  end(id: string): void {
    this.states.set(id, { ...STAND_FRESH });
  }

  reset(): void {
    this.states.clear();
    this.desk.clear();
    this.last = 0;
  }
}

// ---------------------------------------------------------------- sitting

/** A running stretch's end is written this often (Habit Nudges' DESK_WRITE_MS). */
export const SITTING_WRITE_MS = 2 * 60_000;


/** After a desk break's Done, input this close to the click is the click itself: the next stretch waits for fresh input. */
export const BREAK_CLICK_MS = 3_000;

export class SittingCounter {
  private st: Stretch | null = null;
  /** The running stretch as last written (its start and end in the file's form), and when. */
  private written: { start: string; end: string } | null = null;
  private writtenAt = 0;
  private resumeTried = false;
  /** A desk break's Done ended the stretch then: no new one opens until input after it. */
  private breakAt: number | null = null;

  /** The stretch being counted now. */
  live(): Stretch | null {
    return this.st;
  }

  /**
   * Carries on from this Mac's last stretch in the file when it ended less
   * than the away limit ago (Obsidian restarted mid-stretch). Once.
   */
  resume(log: SittingLog | null, mac: string, now: number, cfg: Pick<SittingConfig, 'awayMinutes'>, clock: Pick<DayClock, 'dayOf'>): boolean {
    if (this.resumeTried || this.st) return false;
    this.resumeTried = true;
    const list = log?.days[clock.dayOf(now)]?.[mac] ?? [];
    const lastOne = list.at(-1);
    const s = lastOne ? stretchFromFile(lastOne) : null;
    if (!s || now - s.end >= cfg.awayMinutes * 60_000 || s.end > now) return false;
    this.st = s;
    this.written = { start: lastOne!.start, end: lastOne!.end };
    this.writtenAt = now;
    return true;
  }

  /**
   * A desk break's Done: you got up, so the stretch ends at its last input,
   * as time away ends it. The next stretch opens with the first input after
   * the click (the routine itself is not sitting). Stand-up minutes are not
   * touched: a desk break is not a stand.
   */
  breakNow(now: number, clock: Pick<DayClock, 'dayOf'>): SittingChange[] {
    this.breakAt = now;
    const s = this.st;
    this.st = null;
    return s ? this.closeOut(s, clock) : [];
  }

  /** One step; returns the changes to merge into Coach/sitting.json (by date). */
  step(inp: { now: number; idleS: number; call: boolean; standing: boolean }, cfg: Pick<SittingConfig, 'awayMinutes'>, clock: DayClock): SittingChange[] {
    if (this.breakAt !== null) {
      const last = inp.call ? inp.now : inp.now - inp.idleS * 1000;
      if (!this.st && !inp.call && last <= this.breakAt + BREAK_CLICK_MS) return [];
      this.breakAt = null;
    }
    const r = sittingStep(this.st, inp, cfg, clock);
    const out: SittingChange[] = [];
    if (r.close) out.push(...this.closeOut(r.close, clock));
    this.st = r.st;
    if (r.opened) this.written = null;
    if (this.st && this.st.end - this.st.start >= SITTING_MIN_MS && (!this.written || inp.now - this.writtenAt >= SITTING_WRITE_MS)) out.push(this.put(this.st, clock, inp.now));
    return out;
  }

  /** Counting stops (no sitting item today, or Obsidian closing): the running stretch is closed and kept if long enough. */
  stop(clock: Pick<DayClock, 'dayOf'>): SittingChange[] {
    const s = this.st;
    this.st = null;
    return s ? this.closeOut(s, clock) : [];
  }

  private put(s: Stretch, clock: Pick<DayClock, 'dayOf'>, now: number): SittingChange {
    const f = stretchToFile(s);
    const base = this.written && this.written.start === f.start ? this.written.end : null;
    this.written = f;
    this.writtenAt = now;
    return { date: clock.dayOf(s.start), put: [f], baseline: { [f.start]: base } };
  }

  private closeOut(s: Stretch, clock: Pick<DayClock, 'dayOf'>): SittingChange[] {
    const w = this.written;
    const f = stretchToFile(s);
    this.written = null;
    if (s.end - s.start < SITTING_MIN_MS) return w && w.start === f.start ? [{ date: clock.dayOf(s.start), remove: [w.start] }] : [];
    return [{ date: clock.dayOf(s.start), put: [f], baseline: { [f.start]: w && w.start === f.start ? w.end : null } }];
  }
}

/** Today's sitting for the rules: every Mac's stretches with this one's running stretch in full, and that stretch. */
export function sittingToday(log: SittingLog | null, date: IsoDate, mac: string, live: Stretch | null): { today: SittingDay; current: { start: number; minutes: number } | null } {
  const today = summarizeDay(date, stretchesOn(log, date, { mac, stretch: live }), 'pahlavan');
  return { today, current: live ? { start: live.start, minutes: Math.floor((live.end - live.start) / 60_000) } : null };
}

// ---------------------------------------------------------------- standing now

/** "Standing now" turns itself off after this long without input (or that long between steps: the Mac slept). */
export const STANDING_IDLE_OFF_MIN = 30;

/** The switch as kept in this Mac's local storage: the day it was turned on and when. */
export interface StandingNow {
  on: boolean;
  /** Epoch ms it was turned on. */
  since: number | null;
}

/**
 * "Standing now", for a standing desk: while it is on, typing at the desk
 * is not sitting (the sitting counter gets `standing`), and the stand-up
 * counter logs each stand's worth of desk minutes as a stand (not while a
 * stand is already counting down: that would count the same time twice).
 * Per Mac. It turns itself off at local midnight and after a long gap
 * without input.
 */
export class StandingSwitch {
  private on = false;
  private since: number | null = null;

  constructor(saved: string | null, now: number, clock: Pick<DayClock, 'dayOf'>) {
    const t = Number(saved);
    if (saved && Number.isFinite(t) && t > 0 && t <= now && clock.dayOf(t) === clock.dayOf(now)) {
      this.on = true;
      this.since = t;
    }
  }

  get state(): StandingNow {
    return { on: this.on, since: this.since };
  }

  /** What to keep in local storage: when it was turned on, or "" when off. */
  get saved(): string {
    return this.on && this.since !== null ? String(this.since) : '';
  }

  set(on: boolean, now: number): StandingNow {
    this.on = on;
    this.since = on ? now : null;
    return this.state;
  }

  /** The step's check: off at local midnight, or after a long gap without input. True when it just turned off. */
  check(inp: { now: number; idleS: number; gapMs: number }, clock: Pick<DayClock, 'dayOf'>): boolean {
    if (!this.on) return false;
    const away = STANDING_IDLE_OFF_MIN * 60_000;
    const crossed = this.since !== null && clock.dayOf(this.since) !== clock.dayOf(inp.now);
    if (crossed || inp.idleS * 1000 >= away || inp.gapMs >= away) {
      this.set(false, inp.now);
      return true;
    }
    return false;
  }
}
