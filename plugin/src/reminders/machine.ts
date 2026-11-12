// The reminder machinery: the minute tick that opens the next due card, the
// 30-second tick that counts stand-ups and sitting time, one card at a time,
// and what each answer writes. Habit Nudges' behaviour on the engine's
// rules: dueNow says what is due (from the shared Coach/nudges.json, so an
// answer, snooze or skip on one Mac silences the other), queueOrder which
// comes first, the counts are this Mac's own (in memory), and every write
// goes through ReminderWriter (session 1's merges, read back, one retry).
// Before a card shows, the other Mac's changes are pulled (obsidian-git);
// a minute after an answer, they are committed and synced.
//
// No Obsidian import: the plugin passes the vault adapter, the clock, the
// Mac (idle seconds, the call helper, notifications) and the card UI in
// through `ReminderHost`, so the tests drive the same code with fakes.
//
// "Ask the coach" reads the newest coach letter with the files: the step
// after the Sunday check-in is done once one is dated on or after it.
//
// What the screens use (session 3): dueToday(), openCard(), openKey(),
// openCheckin(), showQueue(), tickItem(), addAmount(), standStatus(),
// sittingNow(), activity(), standingNow()/setStandingNow(), onChange().
//
// Stand-ups and sitting time count keyboard and mouse activity; on a
// computer that can't read it they don't run (activity() says why), and an
// unknown reading never counts as sitting. For the other cards an unknown
// reading counts as "here", so a reminder is never swallowed.

import { bodyUnitsOf } from '../../../src/core/units.ts';
import type { HabitChange } from '../../../src/adapters/vault/habits-write.ts';
import { readVaultAsync, type VaultRead } from '../../../src/adapters/vault/read.ts';
import { readTrackingAsync, type TrackingRead } from '../../../src/adapters/vault/tracking-read.ts';
import type { SittingChange, TrackingOp } from '../../../src/adapters/vault/tracking-write.ts';
import type { MorningValues, RecordValues } from '../../../src/adapters/vault/body-write.ts';
import { hhmm, toTs, type DayClock, type Moment } from '../../../src/core/clock.ts';
import { dayText } from '../../../src/core/dates.ts';
import { deskRoutine } from '../../../src/core/desk-breaks.ts';
import { answerCard, bodyParts, cardSettled, dueNow, dueToday, snoozeUntil, trainingDays, type CardKind, type DueCard, type DueInput, type DueToday, type NudgeChange, type NudgeSettings } from '../../../src/core/nudges.ts';
import { explain, type Result } from '../../../src/core/reason.ts';
import type { NudgeState, SorenessLevel, TrackedItem } from '../../../src/core/schema.ts';
import type { SittingDay } from '../../../src/core/sitting.ts';
import { inStandHours, standProgress, type StandPhase, type StandState } from '../../../src/core/standup.ts';
import { scheduled } from '../../../src/core/tracking.ts';
import { coachStepsOf } from '../../../src/report/checkin-screen.ts';
import { scopeInfo } from '../../../src/report/cycle.ts';
import { buildSession } from '../../../src/report/session.ts';
import { trainingToday } from '../../../src/report/tracking.ts';
import type { CheckinWriter, MorningOutcome } from '../checkin-writer.ts';
import { newestLetter, readerOf } from '../data-source.ts';
import type { DeviceStore, PluginData, Section } from '../settings.ts';
import { cardView, type CardView, type SnoozeChoice } from './card-model.ts';
import { SittingCounter, sittingToday, StandCounter, StandingSwitch, type StandingNow } from './counters.ts';
import { shouldNotify, standGate, tickGate, type GateWhy } from './gate.ts';
import { HeldKeys, HOLD_MS, queueOrder } from './queue.ts';
import type { GitSync } from './sync.ts';
import { ReminderWriter, type PhotoConvert, type PhotoIn, type ReminderAdapter } from './writer.ts';
import { paths } from '../../../src/adapters/vault/layout.ts';

// ---------------------------------------------------------------- the host

/** An open card, as the UI gives it back. */
export interface CardHandle {
  /** Draws the card again from a new view (the stand-up's count, the tape section gone). */
  update(view: CardView): void;
  /** Closes it (the machine's own close: no snooze). */
  close(): void;
  /** A line on the card: a save that failed, a conflict to choose. */
  message(text: string | null, opts?: { conflict?: boolean }): void;
  /** The user has typed or ticked something on it. */
  dirty(): boolean;
  /** Brings it forward (a notification's click). */
  focus(): void;
}

export type CardPayload =
  | { kind: 'morning'; values: MorningValues; baseline: MorningValues; tape?: RecordValues; tapeBaseline?: RecordValues; force?: boolean; sore?: Record<string, SorenessLevel | null>; /** "I'm ill today", only when the card changed it. */ illness?: boolean }
  | { kind: 'tape'; values: RecordValues; baseline: RecordValues; force?: boolean }
  | { kind: 'tests'; values: RecordValues; baseline: RecordValues; force?: boolean }
  | { kind: 'habits'; ticks: Record<string, boolean> }
  | { kind: 'amount'; add: number }
  | { kind: 'photos'; files: PhotoIn[] }
  | { kind: 'desk' }
  | { kind: 'sitting' }
  | { kind: 'coach' };

/** What a card's buttons ask for. */
export type CardAnswer =
  | { do: 'save'; payload: CardPayload }
  | { do: 'skip' }
  | { do: 'later' }
  | { do: 'skip-period' }
  | { do: 'snooze'; choice: SnoozeChoice }
  | { do: 'train'; choice: 'logged' | 'rest' | 'not-today' }
  | { do: 'stand' }
  | { do: 'end-stand' }
  | { do: 'open-checkin' }
  /** Ask the coach's Copy: the command to the clipboard; the card stays open. */
  | { do: 'copy'; text: string };

export interface CardActions {
  answer(a: CardAnswer): Promise<void>;
  /** The card closed (×, Esc, a click outside, or the machine's own close). */
  closed(): void;
}

export interface CardUi {
  open(view: CardView, actions: CardActions): CardHandle;
}

export interface ReminderHost {
  adapter: ReminderAdapter;
  root?: string;
  /** The vault's config folder (Habit Nudges' settings, for the bring-over). */
  configDir?: string;
  now(): number;
  moment(ms: number): Moment;
  clock: DayClock;
  settings(): PluginData;
  remindHere(): boolean;
  /** This Mac's name in Coach/sitting.json and the answers' `by`. */
  mac(): string;
  /** This Mac's local storage ("Standing now"). */
  device: DeviceStore;
  /** Seconds since the last keyboard or mouse input; null when this computer can't tell. */
  idleSeconds(): Promise<number | null>;
  /** Obsidian is the app in front, and its window is showing. */
  focused(): boolean;
  visible(): boolean;
  /** One of Isfahan's day cards is open. */
  otherCardOpen(): boolean;
  ui: CardUi;
  notifyMac(title: string, body: string, onClick: () => void): void;
  notice(message: string): void;
  focusApp(): void;
  holdFront(on: boolean): void;
  chime(): void;
  convertPhoto: PhotoConvert;
  git: GitSync;
  checkin: Pick<CheckinWriter, 'saveMorning'>;
  /** "Log session": Pahlavan's Log panel for today. */
  openLog(): void;
  /** Copies text to the clipboard (Ask the coach's command); absent: the card says it can't. */
  copy?(text: string): Promise<void>;
  openSection(section: Section): void;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

// ---------------------------------------------------------------- inside

interface Snapshot {
  at: number;
  date: string;
  vault: VaultRead;
  tr: TrackingRead;
  /** The newest coach letter (Coach/Letters), for "Ask the coach". */
  letter: { path: string; text: string } | null;
}

interface Open {
  card: DueCard;
  view: CardView;
  manual: boolean;
  byHand: boolean;
  /** Answered here (or closed by the machine): closing writes no snooze. */
  resolved: boolean;
  handle: CardHandle | null;
}

/** The stand-up count and where it stands, for the status bar and Due today. */
export interface StandStatus {
  id: string;
  name: string;
  phase: StandPhase;
  satMinutes: number;
  sitLeft: number;
  standLeft: number | null;
  snoozeAvailable: boolean;
  inHours: boolean;
  /** With "Standing now" on: minutes standing at the desk to the next desk stand (null with it off). */
  deskLeft?: number | null;
}

/**
 * Whether this computer can read keyboard and mouse activity, which
 * stand-ups and sitting time count from. Null until the first reading.
 */
export interface ActivityStatus {
  readable: boolean | null;
  /** Why not, in words for the screens ("Needs keyboard and mouse activity, not available on this computer"). */
  why: string | null;
}

export const ACTIVITY_UNAVAILABLE = 'Needs keyboard and mouse activity, not available on this computer';
/** An idle reading that fails this many times in a row on a computer that read it before stops the counts. */
export const IDLE_FAILS_OFF = 3;

/** Wait this long after a card closes before looking for the next (Habit Nudges' chain). */
export const CHAIN_MS = 3_000;
/** A snapshot older than this is read again by the 30-second tick. */
const SNAP_MAX_MS = 5 * 60_000;
/** Warnings about unreadable files at most this often. */
const WARN_GAP_MS = 60 * 60_000;
const STANDING_KEY = 'pahlavan-standing-now';

/** The Settings tab's options as the engine reads them. */
export function nudgeSettings(d: PluginData): NudgeSettings {
  const r = d.reminders;
  return { snoozeMinutes: r.snoozeMinutes, quiet: r.quiet.on ? { from: r.quiet.from, to: r.quiet.to } : null, didYouTrain: { on: r.didYouTrain, at: r.didYouTrainAt } };
}

export class Reminders {
  private readonly host: ReminderHost;
  readonly writer: ReminderWriter;
  private readonly stand = new StandCounter();
  private readonly sit = new SittingCounter();
  private readonly standingSwitch: StandingSwitch;
  private readonly held = new HeldKeys();
  private snap: Snapshot | null = null;
  private current: Open | null = null;
  private busy = false;
  private fastBusy = false;
  private lastFast = 0;
  private disposed = false;
  private chainTimer: number | null = null;
  private lastWarn = 0;
  private readonly listeners = new Set<() => void>();
  /** Keyboard and mouse activity on this computer: read yet, and the failures in a row. */
  private idleReadable: boolean | null = null;
  private idleFails = 0;

  constructor(host: ReminderHost) {
    this.host = host;
    this.writer = new ReminderWriter(host.adapter, host.root ?? '');
    this.standingSwitch = new StandingSwitch(host.device.get(STANDING_KEY), host.now(), host.clock);
  }

  // ------------------------------------------------------------ reading

  private async read(): Promise<Snapshot> {
    const now = this.host.now();
    const date = this.host.moment(now).date;
    const io = readerOf(this.host.adapter);
    const root = this.host.root ?? '';
    const [vault, tr, letter] = await Promise.all([readVaultAsync(io, root, { asOf: date }), readTrackingAsync(io, root, this.host.configDir ? { configDir: this.host.configDir } : {}), newestLetter(this.host.adapter, root)]);
    this.snap = { at: now, date, vault, tr, letter };
    if (tr.errors.length && now - this.lastWarn > WARN_GAP_MS) {
      this.lastWarn = now;
      this.host.notice(`Pahlavan: ${tr.errors[0]!.message} Reminders wait until it is fixed.`);
    }
    return this.snap;
  }

  private async fresh(): Promise<Snapshot> {
    const now = this.host.now();
    const s = this.snap;
    if (s && now - s.at < SNAP_MAX_MS && s.date === this.host.moment(now).date) return s;
    return this.read();
  }

  private sittingItem(snap: Snapshot, m: Moment): TrackedItem | null {
    const td = trainingDays(trainingToday(snap.vault.data, m.date), m.date);
    return snap.tr.tracking?.items.find((x) => x.kind === 'sitting' && x.sitting && scheduled(x, m.date, td) === 'due') ?? null;
  }

  private standItems(snap: Snapshot, m: Moment): TrackedItem[] {
    const td = trainingDays(trainingToday(snap.vault.data, m.date), m.date);
    return (snap.tr.tracking?.items ?? []).filter((x) => x.kind === 'standup' && x.standup && scheduled(x, m.date, td) === 'due');
  }

  private input(snap: Snapshot, m: Moment, opts: { quiet?: boolean } = {}): DueInput {
    const t = snap.tr;
    const sitItem = this.sittingItem(snap, m);
    const s = nudgeSettings(this.host.settings());
    return {
      now: m,
      tracking: t.tracking,
      nudges: t.nudges,
      body: t.body,
      photoFolders: t.photoFolders,
      habits: t.habits,
      program: snap.vault.data.program,
      training: trainingToday(snap.vault.data, m.date),
      settings: opts.quiet === false ? { ...s, quiet: null } : s,
      // Sitting and stand-ups are this computer's counts: none where it can't read activity.
      sitting: sitItem && this.idleReadable !== false ? sittingToday(t.sitting, m.date, this.host.mac(), this.sit.live()) : null,
      stand: this.idleReadable === false ? {} : Object.fromEntries(this.stand.all()),
      // The coach step after the Sunday check-in, as Today shows it.
      coach: coachStepsOf(snap.vault, m.date, snap.letter).now?.value ?? null,
    };
  }

  private context(snap: Snapshot, m: Moment, manual: boolean) {
    const input = this.input(snap, m);
    const sess = snap.vault.files.plan === 'missing' ? null : buildSession(snap.vault.data, m.date, 'full').session;
    // A card opened by hand says when its part is next due, so it needs the schedule even without a body-record setting.
    const parts = snap.tr.tracking?.bodyRecord || manual ? bodyParts(input, m.date) : undefined;
    return {
      now: m,
      tracking: snap.tr.tracking,
      habits: snap.tr.habits,
      body: snap.tr.body,
      program: snap.vault.data.program,
      units: bodyUnitsOf(snap.vault.data.profile).value,
      stand: this.stand.all(),
      sitting: input.sitting ?? null,
      morningAt: snap.tr.tracking?.morning?.at ?? null,
      session: sess?.name ?? null,
      manual,
      // The forms' "last" hints count from the cycle start, as the screens do.
      since: scopeInfo(snap.vault.data, m.date).since,
      ...(parts ? { parts: { tape: parts.tape.value, photos: parts.photos.value, tests: parts.tests.value } } : {}),
    };
  }

  /** The due cards now, in queue order, without the ones held back on this Mac. */
  private due(snap: Snapshot, m: Moment): DueCard[] {
    return queueOrder(dueNow(this.input(snap, m)).value.cards).filter((c) => !this.held.held(c.key, m.ms));
  }

  // ------------------------------------------------------------ the minute tick

  /**
   * Opens the first due card, when the settings and the Mac allow it. With
   * `byHand` (the reminder queue command) the idle wait does not apply and
   * no notification goes with it. Says what it did, or why not.
   */
  async tick(byHand = false): Promise<'shown' | 'none' | GateWhy> {
    if (this.disposed) return 'off';
    const d = this.host.settings();
    const now = this.host.now();
    const m = this.host.moment(now);
    const gate = (idleS: number | null, busy: boolean) => tickGate({ reminders: d.reminders, remindHere: this.host.remindHere(), time: hhmm(m.minutes), cardOpen: this.current !== null, otherCard: this.host.otherCardOpen(), busy, idleS, byHand });
    const g0 = gate(null, this.busy);
    if (!g0.go) {
      // An open card is looked at whatever else holds the next one (the quiet hours too): one left open in the evening closes at midnight.
      if (this.current && !this.busy) await this.checkOpen();
      return g0.why;
    }
    this.busy = true;
    try {
      let snap = await this.read();
      let card = this.due(snap, m)[0] ?? null;
      if (!card) return 'none';
      if (!byHand) {
        const g = gate(await this.host.idleSeconds(), false);
        if (!g.go) return g.why;
      }
      if (await this.host.git.pull()) {
        // The other Mac may have answered it already.
        snap = await this.read();
        card = this.due(snap, this.host.moment(this.host.now()))[0] ?? null;
        if (!card) return 'none';
      }
      if (this.current) return 'open';
      this.present(card, snap, { manual: false, byHand });
      return 'shown';
    } catch (e) {
      console.error('[Pahlavan] reminders', e);
      return 'none';
    } finally {
      this.busy = false;
    }
  }

  /** The reminder queue by hand: the first card due now, or a note saying nothing is (and what comes next). */
  async showQueue(): Promise<boolean> {
    if (this.current) {
      this.current.handle?.focus();
      return true;
    }
    const r = await this.tick(true);
    if (r === 'shown') return true;
    if (r === 'none') this.host.notice(await this.nothingDue());
    else if (r === 'off') this.host.notice('Pahlavan: reminders are off (Settings, Pahlavan).');
    else if (r === 'not-here') this.host.notice('Pahlavan: reminders are off on this Mac (Settings, Pahlavan).');
    else if (r === 'quiet') this.host.notice('Pahlavan: quiet hours; a card due now is held (an evening one is skipped for today).');
    return false;
  }

  private async nothingDue(): Promise<string> {
    const t = await this.dueToday();
    const v = t?.value;
    const next = [...(v?.amounts.filter((a) => a.next).map((a) => `${a.name} at ${a.next}`) ?? []), ...(v?.desk.filter((x) => x.next).map((x) => `${x.name} at ${x.next}`) ?? [])];
    return `Pahlavan: nothing is due right now.${next.length ? ` Next: ${next.join(', ')}.` : ''}`;
  }

  /**
   * While a card is open (and untouched here), it closes with no snooze once
   * the other Mac answered or snoozed it, the data answers it (a session
   * logged, the habits ticked elsewhere: cardSettled), or its day is over.
   */
  private async checkOpen(): Promise<void> {
    const o = this.current;
    if (!o || o.manual || o.card.kind === 'standup' || o.handle?.dirty()) return;
    this.busy = true;
    try {
      const why = (await this.otherMac(o)) ?? (await this.settled(o));
      if (!why || this.current !== o || o.handle?.dirty()) return;
      o.resolved = true;
      o.handle?.close();
      this.host.notice(`Pahlavan: ${o.view.kicker} ${why}.`);
    } catch {
      // unreadable: the next look says so
    } finally {
      this.busy = false;
    }
  }

  /** The other Mac's answer or snooze since the card opened, in words ("was answered on Work Mac"). */
  private async otherMac(o: Open): Promise<string | null> {
    const root = this.host.root ?? '';
    const path = root ? `${root.replace(/\/$/, '')}/${paths().nudges}` : paths().nudges;
    if (!(await this.host.adapter.exists(path))) return null;
    const doc = JSON.parse(await this.host.adapter.read(path)) as NudgeState;
    const e = doc.days?.[o.card.date]?.[o.card.key];
    if (!e || e.by === this.host.mac()) return null;
    const answered = e.how !== undefined && (o.card.stretch === undefined || e.for === o.card.stretch);
    const snoozed = (Date.parse(e.snoozedUntil ?? '') || 0) > this.host.now();
    if (!answered && !snoozed) return null;
    return `was ${answered ? 'answered' : 'snoozed'} on ${e.by ?? 'the other Mac'}`;
  }

  /** The data's answer to the card, read fresh, or its day over, in words ("closed: Wed 4 Nov has a session logged"). */
  private async settled(o: Open): Promise<string | null> {
    const snap = await this.read();
    const m = this.host.moment(this.host.now());
    const why = cardSettled(o.card, this.input(snap, { ...m, date: o.card.date }));
    if (why) return `closed: ${why}`;
    return o.card.date < m.date ? `for ${dayText(o.card.date)} closed: that day is over` : null;
  }

  // ------------------------------------------------------------ showing a card

  private present(card: DueCard, snap: Snapshot, opts: { manual: boolean; byHand: boolean }): void {
    const m = this.host.moment(this.host.now());
    const view = cardView(card, this.context(snap, m, opts.manual));
    const o: Open = { card, view, manual: opts.manual, byHand: opts.byHand, resolved: false, handle: null };
    this.current = o;
    o.handle = this.host.ui.open(view, { answer: (a) => this.answer(o, a), closed: () => this.closed(o) });
    if (card.kind === 'standup') this.host.holdFront(true);
    const d = this.host.settings();
    if (shouldNotify({ notifications: d.reminders.notifications, focused: this.host.focused(), visible: this.host.visible(), byHand: opts.byHand || opts.manual })) {
      this.host.notifyMac(view.notify.title, view.notify.body, () => {
        this.host.focusApp();
        o.handle?.focus();
      });
    }
    this.emit();
  }

  /** The card closed: by its own answer (nothing more), or by ×, Esc or a click outside (a snooze with the default time). */
  private closed(o: Open): void {
    if (this.current === o) this.current = null;
    if (o.card.kind === 'standup') this.host.holdFront(false);
    // The stand-up's own snooze is its count's; closing it while standing leaves the count running.
    if (!o.resolved && !o.manual && o.card.closable && o.card.kind !== 'standup') {
      const now = this.host.now();
      const until = now + this.host.settings().reminders.snoozeMinutes * 60_000;
      this.held.hold(o.card.key, until);
      void this.writeAnswer(o, answerCard(o.card, 'close', now, { snoozeUntil: until, by: this.host.mac() }));
    }
    this.emit();
    // Straight on to the next due card rather than a full minute later.
    if (!this.disposed) {
      if (this.chainTimer !== null) this.host.clearTimeout(this.chainTimer);
      this.chainTimer = this.host.setTimeout(() => {
        this.chainTimer = null;
        void this.tick(o.byHand);
      }, CHAIN_MS);
    }
  }

  private finish(o: Open): void {
    o.resolved = true;
    o.handle?.close();
  }

  /** Writes an answer into Coach/nudges.json; the other Mac's same answer is `already` (quiet), a different one is kept. */
  private async writeAnswer(o: Open, changes: NudgeChange[]): Promise<void> {
    if (!changes.length) return;
    const now = this.host.now();
    this.held.hold(o.card.key, now + HOLD_MS);
    const r = await this.writer.nudges(changes, this.host.moment(now).date);
    if (r.status === 'saved') this.host.git.schedule();
    if (r.status === 'conflict') {
      const c = r.conflicts[0]!;
      this.host.notice(`Pahlavan: ${o.view.kicker} was already answered on the other Mac (${String(c.disk)}); that answer stays.`);
    } else if (r.status === 'failed') {
      // The card waits as if snoozed rather than coming back every minute.
      this.held.hold(o.card.key, now + this.host.settings().reminders.snoozeMinutes * 60_000);
      this.host.notice(`Pahlavan: the answer was not saved (${r.error}).`);
    }
    this.emit();
  }

  // ------------------------------------------------------------ answers

  private async answer(o: Open, a: CardAnswer): Promise<void> {
    const now = this.host.now();
    const m = this.host.moment(now);
    const by = this.host.mac();
    const card = o.card;
    switch (a.do) {
      case 'snooze': {
        if (card.kind === 'standup') {
          this.stand.answer(card.items[0]!, 'snooze', now, typeof a.choice === 'number' ? a.choice : 10);
          this.finish(o);
          return;
        }
        const until = snoozeUntil(a.choice, m, { evening: card.snooze?.evening ?? '18:00', morning: this.snap?.tr.tracking?.morning?.at ?? '07:30' });
        this.held.hold(card.key, until);
        this.finish(o);
        await this.writeAnswer(o, answerCard(card, 'snooze', now, { snoozeUntil: until, by }));
        return;
      }
      case 'skip':
      case 'later':
        this.finish(o);
        await this.writeAnswer(o, answerCard(card, a.do, now, { by }));
        return;
      case 'skip-period': {
        if (card.kind === 'morning' && card.skipPeriod) {
          // Only the tape is skipped: the morning card stays open without it.
          await this.writeAnswer(o, [{ skip: card.skipPeriod.key, at: toTs(now) }]);
          const next: DueCard = { ...card, tape: false };
          delete next.skipPeriod;
          delete next.occurrence;
          if (next.snooze) next.snooze = { ...next.snooze, tomorrow: false };
          o.card = next;
          o.view = cardView(next, this.context(this.snap ?? (await this.read()), m, o.manual));
          o.handle?.update(o.view);
          return;
        }
        this.finish(o);
        await this.writeAnswer(o, answerCard(card, 'skip-period', now, { by }));
        return;
      }
      case 'train': {
        if (a.choice === 'rest') {
          const r = await this.writer.dayMark(card.date, 'rest');
          if (r.status === 'failed') {
            o.handle?.message(`The rest day was not saved: ${r.error}`);
            return;
          }
          this.host.git.schedule();
        }
        this.finish(o);
        await this.writeAnswer(o, answerCard(card, a.choice, now, { by }));
        if (a.choice === 'logged') this.host.openLog();
        return;
      }
      case 'stand': {
        const id = card.items[0]!;
        this.stand.answer(id, 'stand', now, 0);
        this.host.holdFront(false);
        o.card = { ...card, closable: true };
        o.view = cardView(o.card, this.context(this.snap ?? (await this.read()), m, o.manual));
        o.handle?.update(o.view);
        this.emit();
        return;
      }
      case 'end-stand':
        this.stand.end(card.items[0]!);
        this.host.notice('Pahlavan: stand ended early; it does not count.');
        this.finish(o);
        this.emit();
        return;
      case 'open-checkin':
        o.handle?.close(); // a snooze, as closing is
        this.host.openSection('checkin');
        return;
      case 'copy':
        if (!this.host.copy) {
          o.handle?.message(`Copying is not available here: type ${a.text} in Claude Code.`);
          return;
        }
        await this.host.copy(a.text).then(() => this.host.notice(`Pahlavan: copied ${a.text}. Paste it in Claude Code, in your vault.`), () => o.handle?.message(`Couldn’t copy it: type ${a.text} in Claude Code.`));
        return;
      case 'save':
        await this.save(o, a.payload, now);
        return;
    }
  }

  private async save(o: Open, p: CardPayload, now: number): Promise<void> {
    const card = o.card;
    const date = card.date;
    const at = toTs(now);
    const by = this.host.mac();
    const done = async () => {
      this.host.git.schedule();
      this.finish(o);
      await this.writeAnswer(o, answerCard(card, 'done', now, { by }));
    };
    switch (p.kind) {
      case 'morning': {
        const changed = Object.keys(p.values).filter((k) => (p.values as Record<string, unknown>)[k] !== (p.baseline as Record<string, unknown>)[k]);
        const sore = p.sore && Object.keys(p.sore).length ? p.sore : null;
        const illness = p.illness === undefined ? {} : { illness: p.illness };
        if (changed.length || sore || p.illness !== undefined) {
          const values: MorningValues = {};
          const baseline: MorningValues = {};
          for (const k of changed) {
            (values as Record<string, unknown>)[k] = (p.values as Record<string, unknown>)[k];
            (baseline as Record<string, unknown>)[k] = (p.baseline as Record<string, unknown>)[k] ?? null;
          }
          const r: MorningOutcome = await this.host.checkin.saveMorning(date, { values, baseline, checkedAt: at, ...(sore ? { sore } : {}), ...illness, ...(p.force ? { force: true } : {}) });
          if (r.status === 'conflict') {
            o.handle?.message(`Changed on the other Mac since this card opened: ${r.conflicts.map((c) => `${c.key} is ${c.disk ?? 'empty'} there`).join(', ')}. Save again to keep yours.`, { conflict: true });
            return;
          }
          if (r.status === 'failed') {
            o.handle?.message(r.error);
            return;
          }
        }
        if (p.tape && Object.keys(p.tape).length) {
          const t = await this.writer.record('tape', date, { values: p.tape, baseline: p.tapeBaseline ?? {}, ...(p.force ? { force: true } : {}) });
          if (t.status === 'conflict') {
            o.handle?.message(`The tape changed on the other Mac since this card opened (${t.conflicts.map((c) => c.key).join(', ')}). Save again to keep yours.`, { conflict: true });
            return;
          }
          if (t.status === 'failed') {
            o.handle?.message(`The morning numbers are saved; the tape was not: ${t.error}`);
            return;
          }
        }
        await done();
        return;
      }
      case 'tape':
      case 'tests': {
        const r = await this.writer.record(p.kind, date, { values: p.values, baseline: p.baseline, ...(p.force ? { force: true } : {}) });
        if (r.status === 'conflict') {
          o.handle?.message(`Changed on the other Mac since this card opened: ${r.conflicts.map((c) => c.key).join(', ')}. Save again to keep yours.`, { conflict: true });
          return;
        }
        if (r.status === 'failed') {
          o.handle?.message(r.error);
          return;
        }
        await done();
        return;
      }
      case 'habits': {
        const items = this.snap?.tr.tracking?.items ?? [];
        const ops: TrackingOp[] = [];
        const habits: HabitChange[] = [];
        for (const [id, on] of Object.entries(p.ticks)) {
          const it = items.find((x) => x.id === id);
          if (!it) continue;
          const was = o.view.body.kind === 'habits' ? o.view.body.items.find((x) => x.id === id)?.done : undefined;
          if (was === on) continue;
          ops.push({ op: 'tick', item: id, date, done: on, at });
          if (it.habit) habits.push({ habit: it.habit, date, tick: on });
        }
        if (!(await this.writeData(o, ops, habits))) return;
        await done();
        return;
      }
      case 'amount': {
        const it = this.snap?.tr.tracking?.items.find((x) => x.id === card.items[0]);
        if (it && p.add > 0) {
          const ok = await this.writeData(o, [{ op: 'add', item: it.id, date, field: 'amount', delta: p.add, at }], it.habit ? [{ habit: it.habit, date, add: p.add }] : []);
          if (!ok) return;
        }
        await done();
        return;
      }
      case 'desk': {
        const it = this.snap?.tr.tracking?.items.find((x) => x.id === card.items[0]);
        if (it && !(await this.writeData(o, [{ op: 'add', item: it.id, date, field: 'count', delta: 1, at }], []))) return;
        // You got up: the sitting stretch ends here, as time away ends it.
        await this.writeSitting(this.sit.breakNow(now, this.host.clock));
        await done();
        return;
      }
      case 'sitting':
      case 'coach':
        await done();
        return;
      case 'photos': {
        if (!p.files.length) {
          o.handle?.message('Add a photo first, or choose Not today.');
          return;
        }
        const r = await this.writer.photos(date, p.files, this.host.convertPhoto);
        if (r.status === 'failed') {
          o.handle?.message(`${r.error}${r.saved.length ? ` (${r.saved.map((s) => s.pose).join(', ')} saved)` : ''}`);
          return;
        }
        this.host.notice(`Pahlavan: ${r.saved.length} photo${r.saved.length === 1 ? '' : 's'} saved in Progress Photos/${date}.`);
        await done();
        return;
      }
    }
  }

  /** Tracking.json first (Pahlavan's own record), then the linked habits; a failure stays on the card. */
  private async writeData(o: Open | null, ops: TrackingOp[], habits: HabitChange[]): Promise<boolean> {
    const t = await this.writer.tracking(ops);
    if (t.status === 'failed' || t.status === 'conflict') {
      const msg = t.status === 'failed' ? t.error : 'Coach/tracking.json changed in a way that clashes; try again.';
      if (o) o.handle?.message(msg);
      else this.host.notice(`Pahlavan: ${msg}`);
      return false;
    }
    const hb = await this.writer.habits(habits);
    if (hb.status === 'failed' && habits.length) this.host.notice(`Pahlavan: saved, but the linked habit was not ticked (${hb.error}).`);
    if (hb.status !== 'failed' && hb.skipped.length) this.host.notice(`Pahlavan: saved; the linked habit was skipped (${hb.skipped[0]!.why}).`);
    this.host.git.schedule();
    this.emit();
    return true;
  }

  private async writeSitting(changes: SittingChange[]): Promise<void> {
    if (!changes.length) return;
    const r = await this.writer.sitting(this.host.mac(), changes);
    if (r.status === 'failed' || r.status === 'conflict') console.warn('[Pahlavan] sitting time was not written', r);
  }

  // ------------------------------------------------------------ the 30-second tick

  /** Counts the stand-ups and the sitting stretch, writes what they need, and keeps the stand-up card in step. */
  async fastTick(): Promise<void> {
    if (this.disposed || this.fastBusy) return;
    this.fastBusy = true;
    try {
      const now = this.host.now();
      const m = this.host.moment(now);
      const gapMs = this.lastFast ? now - this.lastFast : 30_000;
      this.lastFast = now;
      const snap = await this.fresh();
      const d = this.host.settings();
      const active = d.reminders.on && this.host.remindHere();
      const standItems = active ? this.standItems(snap, m).filter((x) => inStandHours(x.standup!, m)) : [];
      const sitItem = this.sittingItem(snap, m);
      if (!standItems.length && !sitItem) {
        this.stand.reset();
        await this.writeSitting(this.sit.stop(this.host.clock));
        this.syncStandCard(snap, m);
        return;
      }
      const reading = await this.host.idleSeconds();
      if (reading === null) {
        // Unknown is not "here" for counting. On a computer that never reads it (another OS without
        // the powerMonitor) the counts don't run; one that did skips this step, and stops after a few.
        this.idleFails++;
        if (this.idleReadable !== true || this.idleFails >= IDLE_FAILS_OFF) {
          const was = this.idleReadable;
          this.idleReadable = false;
          this.stand.reset();
          await this.writeSitting(this.sit.stop(this.host.clock));
          if (this.current?.card.kind === 'standup') this.finish(this.current);
          if (was !== false) this.emit();
        }
        return;
      }
      const idleS = reading;
      this.idleFails = 0;
      if (this.idleReadable !== true) {
        this.idleReadable = true;
        this.emit();
      }
      if (this.standingSwitch.check({ now, idleS, gapMs }, this.host.clock)) {
        this.host.device.set(STANDING_KEY, '');
        this.host.notice('Pahlavan: Standing now turned off (time away).');
        this.emit();
      }
      const standingNow = this.standingSwitch.state.on;
      // Calls are not detected (no helper program is run): a call reads as no input, so it holds nothing.
      const call = null;
      for (const ev of this.stand.step(standItems, { now, idleS, call, standingNow })) {
        if (ev.event === 'finished') await this.standFinished(ev.item, ev.minutes, m);
        else if (ev.event === 'desk') await this.logStand(ev.item, ev.minutes, m, true);
        else this.host.notice(`Pahlavan: stand ended, no keyboard or mouse for ${ev.item.standup!.standAwayMinutes} minutes, so it doesn't count.`);
      }
      if (sitItem) {
        this.sit.resume(snap.tr.sitting, this.host.mac(), now, sitItem.sitting!, this.host.clock);
        await this.writeSitting(this.sit.step({ now, idleS, call: call === true, standing: this.stand.standing() || standingNow }, sitItem.sitting!, this.host.clock));
      } else await this.writeSitting(this.sit.stop(this.host.clock));
      this.syncStandCard(snap, m);
      this.emit();
    } catch (e) {
      console.error('[Pahlavan] stand-ups and sitting', e);
    } finally {
      this.fastBusy = false;
    }
  }

  /**
   * A stand's minutes and count into the day (and the linked habit).
   * A desk stand ("Standing now") also adds its minutes to the day's
   * `deskMinutes`, so the reviews can tell it from a stand the card asked for;
   * the minutes, the count and the habit take both alike.
   */
  private logStand(item: TrackedItem, minutes: number, m: Moment, desk = false): Promise<boolean> {
    return this.writeData(null, [
      { op: 'add', item: item.id, date: m.date, field: 'minutes', delta: minutes, at: toTs(m.ms) },
      { op: 'add', item: item.id, date: m.date, field: 'count', delta: 1, at: toTs(m.ms) },
      ...(desk ? [{ op: 'add', item: item.id, date: m.date, field: 'deskMinutes', delta: minutes, at: toTs(m.ms) } as const] : []),
    ], item.habit ? [{ habit: item.habit, date: m.date, add: minutes }] : []);
  }

  private async standFinished(item: TrackedItem, minutes: number, m: Moment): Promise<void> {
    this.host.chime();
    const ok = await this.logStand(item, minutes, m);
    this.host.notice(ok ? `Pahlavan: stand done, ${minutes} minutes logged. Sit whenever you like.` : 'Pahlavan: stand done, but it could not be logged.');
    if (!this.host.focused()) this.host.notifyMac('Stand done', `${minutes} minutes. Sit whenever you like.`, () => this.host.focusApp());
    const o = this.current;
    if (o && o.card.kind === 'standup' && o.card.items[0] === item.id) this.finish(o);
  }

  /** The stand-up card follows the count: up while due (pulled to the front), down when a call takes it, counting down while standing. */
  private syncStandCard(snap: Snapshot, m: Moment): void {
    const o = this.current;
    if (o && o.card.kind === 'standup') {
      const st = this.stand.state(o.card.items[0]!);
      if (st.phase === 'sitting') {
        this.finish(o);
        return;
      }
      o.view = cardView(o.card, this.context(snap, m, o.manual));
      o.handle?.update(o.view);
      if (st.phase === 'due') this.host.holdFront(true);
      return;
    }
    if (o) return;
    if (![...this.stand.all().values()].some((s) => s.phase === 'due')) return;
    const d = this.host.settings();
    const g = standGate({ reminders: d.reminders, remindHere: this.host.remindHere(), time: hhmm(m.minutes), cardOpen: false, otherCard: this.host.otherCardOpen() });
    if (!g.go) return;
    const card = this.due(snap, m).find((c) => c.kind === 'standup');
    if (card) this.present(card, snap, { manual: false, byHand: false });
  }

  // ------------------------------------------------------------ by hand

  /**
   * Opens a card by hand (a command, the Body record card, Due today): the
   * due one when there is one (so Snooze and Skip work as usual), else the
   * card for today with Cancel. A card already open comes forward instead.
   */
  async openCard(kind: Extract<CardKind, 'morning' | 'tape' | 'photos' | 'tests' | 'amount' | 'desk' | 'habits'>, item?: string): Promise<boolean> {
    if (this.current) {
      this.current.handle?.focus();
      if (this.current.card.kind !== kind) this.host.notice('Pahlavan: finish the card that is open first.');
      return false;
    }
    const snap = await this.read();
    const m = this.host.moment(this.host.now());
    const due = queueOrder(dueNow(this.input(snap, m, { quiet: false })).value.cards);
    const found = due.find((c) => (c.kind === kind || (kind === 'tape' && c.kind === 'morning' && c.tape)) && (!item || c.items.includes(item)));
    if (found) {
      this.present(found, snap, { manual: false, byHand: true });
      return true;
    }
    const card = this.byHandCard(kind, snap, m, item);
    if (!card) {
      this.host.notice(kind === 'amount' || kind === 'desk' || kind === 'habits' ? 'Pahlavan: nothing to open for that today.' : 'Pahlavan: there is nothing to open.');
      return false;
    }
    this.present(card, snap, { manual: true, byHand: true });
    return true;
  }

  /** A due card by its key (Due today's rows), else the matching card by hand. */
  async openKey(key: string): Promise<boolean> {
    if (this.current) {
      this.current.handle?.focus();
      return false;
    }
    const snap = await this.read();
    const m = this.host.moment(this.host.now());
    const card = queueOrder(dueNow(this.input(snap, m, { quiet: false })).value.cards).find((c) => c.key === key);
    if (card) {
      this.present(card, snap, { manual: false, byHand: true });
      return true;
    }
    const [kind, item] = key.split(':') as [string, string | undefined];
    if (kind === 'morning' || kind === 'tape' || kind === 'photos' || kind === 'tests') return this.openCard(kind);
    if (kind === 'amount' || kind === 'desk') return this.openCard(kind, item);
    return false;
  }

  /**
   * "Open check-in" (Isfahan's new-tab Check-in row calls this): the
   * morning check-in card while today's is not in yet, else the Check-in
   * screen.
   */
  async openCheckin(): Promise<boolean> {
    const snap = await this.read();
    const m = this.host.moment(this.host.now());
    const t = dueToday(this.input(snap, m)).value;
    if (!t.morning.done) return this.openCard('morning');
    this.host.openSection('checkin');
    return true;
  }

  private byHandCard(kind: string, snap: Snapshot, m: Moment, item?: string): DueCard | null {
    const input = this.input(snap, m);
    const parts = bodyParts(input, m.date);
    const base = { date: m.date, at: m.minutes, late: 0, closable: true, skip: null, snooze: null } as const;
    if (kind === 'morning' || kind === 'tape') {
      const tape = parts.tape.value;
      const withTape = tape.due && tape.occurrence !== null;
      if (kind === 'tape' && !withTape) {
        return { ...base, key: 'tape', kind: 'tape', items: [], reason: tape.schedule.reason };
      }
      return {
        ...base,
        key: 'morning',
        kind: 'morning',
        items: [],
        ...(withTape ? { tape: true, occurrence: tape.occurrence!, skipPeriod: { key: `tape:${tape.occurrence}`, next: tape.schedule.afterCurrent } } : {}),
        reason: explain(true, 'coach.morning-checkin', { byHand: true, tapeDay: withTape }, { note: `The morning numbers set today's readiness.${withTape ? ` Tape day: ${tape.schedule.text[0]!.toLowerCase()}${tape.schedule.text.slice(1)}.` : ''}` }).reason,
      };
    }
    if (kind === 'photos' || kind === 'tests') {
      const p = parts[kind].value;
      return { ...base, key: kind, kind, items: [], ...(p.due && p.occurrence ? { occurrence: p.occurrence } : {}), reason: p.schedule.reason };
    }
    const it = item ? snap.tr.tracking?.items.find((x) => x.id === item) : snap.tr.tracking?.items.find((x) => x.kind === kind);
    if (!it) return null;
    if (kind === 'amount' && it.kind === 'amount') return { ...base, key: `amount:${it.id}`, kind: 'amount', items: [it.id], reason: explain(true, 'habits.amount', { item: it.id, byHand: true }, { note: `${it.name}: ${it.amount!.target} ${it.amount!.unit} a day (Progress, Habits).` }).reason };
    if (kind === 'desk' && it.kind === 'desk') {
      const r = deskRoutine(it, snap.vault.data.program);
      return { ...base, key: `desk:${it.id}`, kind: 'desk', items: [it.id], reason: r.reason };
    }
    return null;
  }

  // ------------------------------------------------------------ what the screens read and do

  /**
   * Today's side column: the engine's dueToday with this Mac's stand-up
   * counts and sitting. `reread`: read the files first (a screen reloading
   * after a file changed), instead of the last snapshot (up to 5 minutes old).
   */
  async dueToday(opts: { reread?: boolean } = {}): Promise<Result<DueToday> | null> {
    try {
      const snap = opts.reread ? await this.read() : await this.fresh();
      return dueToday(this.input(snap, this.host.moment(this.host.now())));
    } catch {
      return null;
    }
  }

  /** A tick from a screen (Due today's boxes): tracking.json and the linked habit. */
  async tickItem(id: string, done: boolean, date?: string): Promise<boolean> {
    const snap = await this.read();
    const it = snap.tr.tracking?.items.find((x) => x.id === id);
    if (!it || (it.kind !== 'supplement' && it.kind !== 'tick')) return false;
    const now = this.host.now();
    const d = date ?? this.host.moment(now).date;
    const ok = await this.writeData(null, [{ op: 'tick', item: id, date: d, done, at: toTs(now) }], it.habit ? [{ habit: it.habit, date: d, tick: done }] : []);
    if (ok) await this.read();
    return ok;
  }

  /** An amount from a screen (Due today's water buttons): added to the day, here and in the linked habit. */
  async addAmount(id: string, delta: number, date?: string): Promise<boolean> {
    const snap = await this.read();
    const it = snap.tr.tracking?.items.find((x) => x.id === id);
    if (!it || it.kind !== 'amount' || !Number.isFinite(delta) || delta === 0) return false;
    const now = this.host.now();
    const d = date ?? this.host.moment(now).date;
    const ok = await this.writeData(null, [{ op: 'add', item: id, date: d, field: 'amount', delta, at: toTs(now) }], it.habit ? [{ habit: it.habit, date: d, add: delta }] : []);
    if (ok) await this.read();
    return ok;
  }

  /**
   * Whether stand-ups and sitting time can run on this computer (they count
   * keyboard and mouse activity). Desk breaks and every card on a clock work
   * either way.
   */
  activity(): ActivityStatus {
    return { readable: this.idleReadable, why: this.idleReadable === false ? ACTIVITY_UNAVAILABLE : null };
  }

  /** Each stand-up item counting on this Mac today. */
  standStatus(): StandStatus[] {
    const snap = this.snap;
    if (!snap || this.idleReadable === false) return [];
    const m = this.host.moment(this.host.now());
    return this.standItems(snap, m).map((it) => {
      const st: StandState = this.stand.state(it.id);
      const p = standProgress(st, it.standup!);
      const deskLeft = this.standingSwitch.state.on && p.phase !== 'standing' ? Math.max(1, Math.ceil((it.standup!.standMinutes * 60_000 - this.stand.deskMs(it.id)) / 60_000)) : null;
      return { id: it.id, name: it.name, phase: p.phase, satMinutes: p.satMinutes, sitLeft: p.sitLeft, standLeft: p.standLeft, snoozeAvailable: p.snoozeAvailable, inHours: inStandHours(it.standup!, m), deskLeft };
    });
  }

  /** Sitting today (every Mac, this one's running stretch in full), or null without a sitting item today. */
  sittingNow(): { today: SittingDay; current: { start: number; minutes: number } | null } | null {
    const snap = this.snap;
    if (!snap || this.idleReadable === false) return null;
    const m = this.host.moment(this.host.now());
    return this.sittingItem(snap, m) ? sittingToday(snap.tr.sitting, m.date, this.host.mac(), this.sit.live()) : null;
  }

  /** "Standing now" on this Mac. */
  standingNow(): StandingNow {
    return this.standingSwitch.state;
  }

  /** Turns "Standing now" on or off (the status bar, the command, Due today). */
  setStandingNow(on: boolean): StandingNow {
    const st = this.standingSwitch.set(on, this.host.now());
    this.host.device.set(STANDING_KEY, this.standingSwitch.saved);
    this.emit();
    return st;
  }

  /** "Stand-up: ask me now": the card on the next 30-second step. */
  standAskNow(): boolean {
    const snap = this.snap;
    if (!snap || this.idleReadable === false) return false;
    const m = this.host.moment(this.host.now());
    const it = this.standItems(snap, m)[0];
    if (!it) return false;
    this.stand.askNow(it);
    return true;
  }

  /** A card is open now. */
  get cardOpen(): boolean {
    return this.current !== null;
  }

  /** Called after anything a screen shows changed (a write, the counts, the switch). */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) {
      try {
        cb();
      } catch (e) {
        console.error('[Pahlavan]', e);
      }
    }
  }

  /** Obsidian is closing: the running sitting stretch is written, the card closed. */
  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.chainTimer !== null) this.host.clearTimeout(this.chainTimer);
    this.host.git.dispose();
    const o = this.current;
    if (o) this.finish(o);
    await this.writeSitting(this.sit.stop(this.host.clock));
  }
}
