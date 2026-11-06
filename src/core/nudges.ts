// What is due now: the reminder cards, from what is tracked (Coach/
// tracking.json), the shared reminder state (Coach/nudges.json), the body
// record and the training log. Pure: the plugin passes the moment, the
// files as read, today's sitting and each stand-up's count; it shows the
// first card and writes the answer. A skip, snooze or answer on one Mac is in
// nudges.json, so the other Mac stays quiet too.
//
// Cards, in the order they are offered: a stand-up that is due (it can't be
// closed); the morning check-in (the tape joins it on a tape day); the tape
// on its own once the morning is in; the habit slots (supplements and ticks
// at the same time share one card; "after the session" items once a session
// is logged); "Did you train today?"; amounts every N minutes until the
// target; desk breaks; sitting time against its limits; photo day; the tests;
// "Ask the coach" once a Sunday's answers are saved and no letter is in.

import { hhmm, minutesAt, msAt, parseTs, toMinutes, toTs, type Moment } from './clock.ts';
import type { CoachNow } from './coach-steps.ts';
import { addDays, dayText, type IsoDate } from './dates.ts';
import { bodyRecordView, bodySchedule, partStatus, resolveSchedule, skipKey, type BodyPart, type Occurrence, type PartStatus } from './body-schedule.ts';
import { deskRoutine, type DeskRoutine } from './desk-breaks.ts';
import { isMorningDone } from './morning.ts';
import { explain, type Reason, type Result } from './reason.ts';
import type { NudgeAnswer, NudgeEntry, NudgeState, Program, TrackedItem, Tracking } from './schema.ts';
import { hm, type SittingDay } from './sitting.ts';
import { inStandHours, sourceNote, standProgress, standReason, type StandState } from './standup.ts';
import { dayValue, scheduled, type HabitsView, type TrainingDays } from './tracking.ts';

// ---------------------------------------------------------------- inputs

/** The Settings tab's options that shape what is due. */
export interface NudgeSettings {
  /** The default snooze, and what closing a card does, in minutes. */
  snoozeMinutes: number;
  /** No cards from..to (local times; may run past midnight). */
  quiet: { from: string; to: string } | null;
  /** "Did you train today?": on or off, and its time. */
  didYouTrain: { on: boolean; at: string };
}

export const DEFAULT_NUDGE_SETTINGS: NudgeSettings = { snoozeMinutes: 30, quiet: null, didYouTrain: { on: true, at: '20:00' } };

/** Pahlavan's quiet hours as the plugin ships them (Settings, Quiet hours: on, 22:30 to 07:00). */
export const PLUGIN_QUIET_HOURS: { on: boolean; from: string; to: string } = { on: true, from: '22:30', to: '07:00' };

/** The morning card and the photo and test cards stop for the day here (Habit Nudges' body card end). */
export const MORNING_UNTIL = '21:00';
/** The photo and test cards wait for this hour at the earliest (Habit Nudges' body card start). */
export const BODY_FROM = '06:00';
/**
 * "Ask the coach" comes at this hour: on the step's Sunday the day is left
 * for the answers and the coach, so the card is an evening nudge (the
 * Snooze menu's "This evening"), before "Did you train today?" at 20:00 and
 * well before the quiet hours; on the late days after it, once a day then.
 */
export const COACH_AT = '18:00';

export interface TrainingToday {
  /** Dates with a logged session (any kind). */
  logged: ReadonlySet<IsoDate>;
  /** Today's plan has a session. */
  plannedToday: boolean;
  /** Local minutes the session was logged today, when known. */
  loggedAt?: number;
  /** The Workout habit is ticked today. */
  workoutTicked?: boolean;
  /** Today is marked rest (on the day, or in the Sunday check-in). */
  restMarked?: boolean;
  /** Today is marked missed (on the day, or in the Sunday check-in). */
  missedMarked?: boolean;
  /** The Sunday check-in says today was trained but not logged. */
  confirmedTrained?: boolean;
}

/** "Did you train today?" has nothing to ask: a session logged, the Workout ticked, a rest or missed mark, or the check-in's "trained, not logged". */
const trainingKnown = (t: TrainingToday, date: IsoDate): boolean => t.logged.has(date) || t.workoutTicked === true || t.restMarked === true || t.missedMarked === true || t.confirmedTrained === true;

export interface DueInput {
  now: Moment;
  tracking: Tracking | null;
  nudges: NudgeState | null;
  /** body-data.json, parsed: today's checkedAt and the tape, tests and photo entries. */
  body: unknown;
  /** The dated folders under Progress Photos. */
  photoFolders?: readonly string[];
  habits: HabitsView | null;
  program: Pick<Program, 'macrocycle' | 'deskBreaks'> | null;
  training: TrainingToday;
  settings?: Partial<NudgeSettings>;
  /** Sitting today (every Mac, the running stretch in full) and the stretch running now on this Mac. */
  sitting?: { today: SittingDay; current: { start: number; minutes: number } | null } | null;
  /** Each stand-up item's count on this Mac. */
  stand?: Readonly<Record<string, StandState>>;
  /** The coach step after the Sunday check-in, where it stands today (coachSteps' `now`); absent: no "Ask the coach" card. */
  coach?: CoachNow | null;
}

// ---------------------------------------------------------------- cards

export type CardKind = 'standup' | 'morning' | 'tape' | 'habits' | 'train' | 'amount' | 'desk' | 'sitting' | 'photos' | 'tests' | 'coach';

const ORDER: CardKind[] = ['standup', 'morning', 'tape', 'habits', 'train', 'amount', 'desk', 'sitting', 'photos', 'tests', 'coach'];

/** The Snooze menu: minutes, the default, and "This evening, 18:00" or "Tomorrow morning" where they apply. */
export interface SnoozeChoices {
  minutes: number[];
  default: number;
  evening?: string;
  tomorrow?: boolean;
}

export interface DueCard {
  /** The reminder key in Coach/nudges.json. */
  key: string;
  kind: CardKind;
  date: IsoDate;
  /** Tracked items on the card. */
  items: string[];
  /** Local minutes it fell due today, and how late it is. */
  at: number;
  late: number;
  /** Closing counts as a snooze; the stand-up card can't be closed. */
  closable: boolean;
  /** What Skip does: today, "No more today" for an amount, nothing for the stand-up and "Did you train?". */
  skip: 'today' | 'no-more-today' | null;
  /** Periodic cards: "Skip this photo day (next: ...)". */
  skipPeriod?: { key: string; next: IsoDate | null };
  /** "Not today" instead of Skip: the photo and test cards. */
  later?: boolean;
  snooze: SnoozeChoices | null;
  /** The morning card on a tape day. */
  tape?: boolean;
  /** Periodic cards: the occurrence it is for. */
  occurrence?: Occurrence;
  /** Desk breaks: which break of the day, of how many, and the next one's time. */
  break?: { n: number; of: number; next: string | null };
  /** The sitting stretch card: the stretch's start. */
  stretch?: string;
  /** "Ask the coach": the step, its command and whether it is due (the Sunday) or late. */
  coach?: Pick<CoachNow, 'date' | 'week' | 'phase' | 'kind' | 'title' | 'command' | 'does' | 'nextCycle' | 'state' | 'line'>;
  reason: Reason;
}

const entryOf = (n: NudgeState | null, date: IsoDate, key: string): NudgeEntry => n?.days[date]?.[key] ?? {};
const snoozed = (e: NudgeEntry, now: Moment) => (parseTs(e.snoozedUntil) ?? 0) > now.ms;

/** Inside quiet hours (a span may run past midnight). */
export function inQuiet(q: NudgeSettings['quiet'], minutes: number): boolean {
  if (!q) return false;
  const from = toMinutes(q.from);
  const to = toMinutes(q.to);
  if (from === null || to === null || from === to) return false;
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

function standardSnooze(s: NudgeSettings, now: Moment, extra: Partial<SnoozeChoices> = {}): SnoozeChoices {
  const minutes = [...new Set([10, 30, 60, 120, s.snoozeMinutes])].sort((a, b) => a - b);
  return { minutes, default: s.snoozeMinutes, ...(now.minutes < 18 * 60 ? { evening: '18:00' } : {}), ...extra };
}

/** The training context for the schedule rules. */
export const trainingDays = (t: TrainingToday, today: IsoDate): TrainingDays => ({ logged: t.logged, plannedToday: t.plannedToday, today });

/** Today's checkedAt in body-data.json, when the morning check-in saved one (Pahlavan or Habit Nudges). */
export function checkedIn(body: unknown, date: IsoDate): string | null {
  const days = typeof body === 'object' && body !== null ? (body as { days?: Record<string, { checkedAt?: unknown }> }).days : undefined;
  const c = days?.[date]?.checkedAt;
  return typeof c === 'string' ? c : null;
}

/** The morning check-in is in for the date: its checkedAt, or one of the card's own questions answered (core/morning.ts's one rule). */
export function morningIn(body: unknown, date: IsoDate): boolean {
  const days = typeof body === 'object' && body !== null ? (body as { days?: Record<string, unknown> }).days : undefined;
  return isMorningDone(days?.[date]);
}

/** The body record's parts on the date, from the schedule setting, the plan and what is on record. */
export function bodyParts(input: Pick<DueInput, 'tracking' | 'nudges' | 'body' | 'photoFolders' | 'program'>, date: IsoDate): Record<BodyPart, Result<PartStatus>> {
  const view = bodyRecordView(input.body, input.photoFolders ?? []);
  const skipped = input.nudges?.skipped ?? {};
  const rs = resolveSchedule(input.tracking?.bodyRecord, input.program, { tape: view.tape.at(-1) ?? null, tests: view.tests.at(-1) ?? null }, date);
  const sch = bodySchedule(rs, input.program, date, { hasTests: view.tests.length > 0, baselineSkipped: skipped['tests:baseline'] !== undefined });
  return { tape: partStatus(sch.tape, view, skipped, date), photos: partStatus(sch.photos, view, skipped, date), tests: partStatus(sch.tests, view, skipped, date) };
}

/**
 * An open card the data has answered since it opened: a session logged or
 * the day marked (from the coach, the Log panel or the phone), the habits
 * ticked or the amount met elsewhere, the morning in, the part recorded,
 * the letter in. The words for the notice, or null. Only the data counts,
 * not the card's hours: one past them stays until it is answered or
 * closed. Stand-ups, sitting time and desk breaks are this Mac's own counts.
 */
export function cardSettled(card: DueCard, input: DueInput): string | null {
  const date = card.date;
  switch (card.kind) {
    case 'train': {
      const t = input.training;
      if (t.logged.has(date)) return `${dayText(date)} has a session logged`;
      if (t.workoutTicked) return `the Workout habit is ticked for ${dayText(date)}`;
      if (t.restMarked) return `${dayText(date)} is marked rest`;
      if (t.missedMarked) return `${dayText(date)} is marked missed`;
      return t.confirmedTrained ? `your Sunday check-in says you trained on ${dayText(date)}` : null;
    }
    case 'morning':
      return morningIn(input.body, date) ? 'the morning check-in is in' : null;
    case 'habits':
    case 'amount': {
      const ctx = { tracking: input.tracking, habits: input.habits };
      const items = card.items.map((id) => input.tracking?.items.find((x) => x.id === id));
      if (!items.length || !items.every((x) => x && dayValue(x, date, ctx).done)) return null;
      return card.kind === 'amount' ? `${items[0]!.name} has reached its target` : 'everything on it is ticked';
    }
    case 'tape':
    case 'photos':
    case 'tests':
      return bodyParts(input, date)[card.kind].value.due ? null : `${card.kind === 'tape' ? 'the tape is' : card.kind === 'photos' ? 'the photos are' : 'the tests are'} on record`;
    case 'coach':
      return input.coach?.state === 'done' ? 'the coach’s letter is in' : null;
    default:
      return null;
  }
}

/** The items due today (scheduled, started, not paused). */
function dueItems(tracking: Tracking | null, td: TrainingDays, program: DueInput['program']): { item: TrackedItem; desk: DeskRoutine | null }[] {
  return (tracking?.items ?? []).flatMap((item) => {
    const desk = item.kind === 'desk' ? deskRoutine(item, program).value : null;
    return scheduled(item, td.today, td, desk) === 'due' ? [{ item, desk }] : [];
  });
}

/** Everything due now, in the order to offer it. During quiet hours: nothing, and `quiet` says why. */
export function dueNow(input: DueInput): Result<{ cards: DueCard[]; quiet: boolean }> {
  const s: NudgeSettings = { ...DEFAULT_NUDGE_SETTINGS, ...input.settings };
  const { now, tracking, nudges } = input;
  const date = now.date;
  if (inQuiet(s.quiet, now.minutes)) {
    return explain({ cards: [], quiet: true }, 'nudges.quiet', { now: hhmm(now.minutes), quiet: s.quiet }, { note: `Quiet hours, ${s.quiet!.from} to ${s.quiet!.to}: no cards. One due in the early morning waits until they end; one due late in the evening is skipped that day, so put evening items before ${s.quiet!.from}.` });
  }
  const td = trainingDays(input.training, date);
  const items = dueItems(tracking, td, input.program);
  const ctx = { tracking, habits: input.habits };
  const cards: DueCard[] = [];
  const card = (c: Omit<DueCard, 'date' | 'late'>) => cards.push({ ...c, date, late: Math.max(0, Math.floor(now.minutes - c.at)) });

  // Stand-ups: the count on this Mac says when.
  for (const { item } of items) {
    if (item.kind !== 'standup') continue;
    const st = input.stand?.[item.id];
    if (!st || st.phase !== 'due' || !inStandHours(item.standup!, now)) continue;
    const c = item.standup!;
    card({
      key: `standup:${item.id}`,
      kind: 'standup',
      items: [item.id],
      at: now.minutes,
      closable: false,
      skip: null,
      snooze: st.snoozeUsed ? null : { minutes: [...new Set([5, c.snoozeMinutes])].sort((a, b) => a - b), default: c.snoozeMinutes },
      reason: standReason(item, st).reason,
    });
  }

  // The morning check-in, and the tape with it on a tape day.
  const parts = tracking?.bodyRecord ? bodyParts(input, date) : null;
  const morning = tracking?.morning;
  const morningAt = morning?.on ? toMinutes(morning.at) : null;
  const mEntry = entryOf(nudges, date, 'morning');
  const morningDone = morningIn(input.body, date) || mEntry.how !== undefined;
  const until = toMinutes(MORNING_UNTIL)!;
  const tapeEntry = entryOf(nudges, date, 'tape');
  const tape = parts?.tape.value;
  const tapeDue = Boolean(tape?.due) && tapeEntry.how === undefined && !snoozed(tapeEntry, now);
  const periodic = (p: PartStatus) => ({ key: skipKey(p.part, p.occurrence!), next: p.schedule.afterCurrent });
  if (morningAt !== null && now.minutes >= morningAt && now.minutes < until && !morningDone && !snoozed(mEntry, now)) {
    card({
      key: 'morning',
      kind: 'morning',
      items: [],
      at: morningAt,
      closable: true,
      skip: 'today',
      snooze: standardSnooze(s, now, tapeDue ? { tomorrow: true } : {}),
      ...(tapeDue ? { tape: true, occurrence: tape!.occurrence!, skipPeriod: periodic(tape!) } : {}),
      reason: explain(true, 'coach.morning-checkin', { at: morning!.at, checkedIn: false, tapeDay: tapeDue }, {
        note: `Daily at ${morning!.at}, the time on its card in Check-in. It comes before training because it sets today's readiness.${tapeDue ? ` Tape day: ${tape!.schedule.text[0]!.toLowerCase()}${tape!.schedule.text.slice(1)}.` : ''}`,
      }).reason,
    });
  } else if (tapeDue && (morningDone || morningAt === null) && now.minutes >= (morningAt ?? toMinutes(BODY_FROM)!) && now.minutes < until) {
    card({ key: 'tape', kind: 'tape', items: [], at: morningAt ?? toMinutes(BODY_FROM)!, closable: true, skip: 'today', later: true, snooze: standardSnooze(s, now, { tomorrow: true }), occurrence: tape!.occurrence!, skipPeriod: periodic(tape!), reason: tape!.schedule.reason });
  }

  // Habit slots: supplements and ticks at the same time share one card.
  const slots = new Map<string, { at: number; items: TrackedItem[] }>();
  for (const { item } of items) {
    if (item.kind !== 'supplement' && item.kind !== 'tick') continue;
    const r = item.reminder;
    if (!r || dayValue(item, date, ctx).done) continue;
    let key: string;
    let at: number;
    if (r.afterLog) {
      if (!input.training.logged.has(date)) continue;
      key = 'slot:after-log';
      at = input.training.loggedAt ?? now.minutes;
    } else {
      const m = toMinutes(r.at);
      if (m === null || now.minutes < m) continue;
      key = `slot:${r.at}`;
      at = m;
    }
    const sl = slots.get(key) ?? { at, items: [] };
    sl.items.push(item);
    slots.set(key, sl);
  }
  for (const [key, sl] of slots) {
    const e = entryOf(nudges, date, key);
    if (e.how !== undefined || snoozed(e, now)) continue;
    const label = key === 'slot:after-log' ? 'after the session' : `with a ${key.slice(5)} reminder`;
    card({
      key,
      kind: 'habits',
      items: sl.items.map((x) => x.id),
      at: sl.at,
      closable: true,
      skip: 'today',
      snooze: standardSnooze(s, now),
      reason: explain(true, 'habits.slot', { slot: key.slice(5), items: sl.items.map((x) => x.id) }, {
        note: `Your items ${label} share one card (Progress, Habits): ${sl.items.map((x) => `${x.name}${sourceNote(x)}`).join('; ')}.`,
      }).reason,
    });
  }

  // "Did you train today?" when the plan had a session and nothing is logged.
  const dyt = s.didYouTrain;
  const dytAt = toMinutes(dyt.at);
  const tEntry = entryOf(nudges, date, 'train');
  const t = input.training;
  if (dyt.on && dytAt !== null && now.minutes >= dytAt && t.plannedToday && !trainingKnown(t, date) && tEntry.how === undefined && !snoozed(tEntry, now)) {
    card({
      key: 'train',
      kind: 'train',
      items: [],
      at: dytAt,
      closable: true,
      skip: null,
      snooze: { minutes: [30, 60], default: 30, tomorrow: true },
      reason: explain(true, 'coach.did-you-train', { at: dyt.at, planned: true, logged: false }, {
        note: `Nothing logged by ${dyt.at} on a day the plan had a session. It doesn't ask on a day already logged, ticked, marked rest or missed, or that your Sunday check-in says you trained.`,
      }).reason,
    });
  }

  // Amounts: every N minutes from the start time until the target, or once at a time.
  for (const { item } of items) {
    if (item.kind !== 'amount' || !item.reminder) continue;
    const v = dayValue(item, date, ctx);
    if (v.done) continue;
    const key = `amount:${item.id}`;
    const e = entryOf(nudges, date, key);
    if (e.how !== undefined || snoozed(e, now)) continue;
    const r = item.reminder;
    const a = item.amount!;
    if (r.at) {
      const m = toMinutes(r.at)!;
      if (now.minutes < m) continue;
      card({ key, kind: 'amount', items: [item.id], at: m, closable: true, skip: 'no-more-today', snooze: { minutes: [30, 60, 120], default: 60 }, reason: amountReason(item, v.value ?? 0, `At ${r.at}`) });
      continue;
    }
    const next = nextRepeat(now, r.from!, r.to!, r.every!, [parseTs(e.lastAt), parseTs(v.via === 'pahlavan' ? v.at : null)]);
    if (next === null || now.minutes < next) continue;
    card({
      key,
      kind: 'amount',
      items: [item.id],
      at: next,
      closable: true,
      skip: 'no-more-today',
      snooze: { minutes: [30, 60, 120], default: 60 },
      reason: amountReason(item, v.value ?? 0, `Every ${everyText(r.every!)} from ${r.from} to ${r.to} until the day's ${a.target} ${a.unit}`),
    });
  }

  // Desk breaks: from the start time, then every N minutes after the last one answered.
  for (const { item, desk } of items) {
    if (item.kind !== 'desk' || !desk || !desk.times.length) continue;
    const key = `desk:${item.id}`;
    const e = entryOf(nudges, date, key);
    if (e.how !== undefined || snoozed(e, now)) continue;
    const done = dayValue(item, date, ctx).value ?? 0;
    if (done >= desk.times.length) continue;
    const last = toMinutes(desk.to)! - desk.minutes;
    const lastAt = parseTs(e.lastAt);
    const next = lastAt === null ? toMinutes(desk.from)! : Math.max(toMinutes(desk.from)!, minutesAt(now, lastAt) + desk.every);
    if (next > last || now.minutes < next) continue;
    const after = next + desk.every;
    card({
      key,
      kind: 'desk',
      items: [item.id],
      at: next,
      closable: true,
      skip: 'today',
      snooze: standardSnooze(s, now),
      break: { n: done + 1, of: desk.times.length, next: after <= last ? hhmm(after) : null },
      reason: deskRoutine(item, input.program).reason,
    });
  }

  // Sitting time: a card at its minutes of sitting, and when a stretch reaches its limit.
  for (const { item } of items) {
    if (item.kind !== 'sitting' || !item.reminder || !input.sitting) continue;
    const c = item.sitting!;
    const r = item.reminder;
    const today = input.sitting.today;
    const key = `sitting:${item.id}`;
    const e = entryOf(nudges, date, key);
    if (r.atMinutes && today.minutes >= r.atMinutes && e.how === undefined && !snoozed(e, now)) {
      card({
        key,
        kind: 'sitting',
        items: [item.id],
        at: now.minutes,
        closable: true,
        skip: 'today',
        snooze: standardSnooze(s, now),
        reason: explain(true, 'habits.sitting', { item: item.id, minutes: today.minutes, longest: today.longest, atMinutes: r.atMinutes }, {
          threshold: { limitMinutes: c.limitMinutes, stretchMaxMinutes: c.stretchMaxMinutes },
          note: `${hm(today.minutes)} of your ${hm(c.limitMinutes)} limit today. Your limit: under ${hm(c.limitMinutes)} a day and no stretch over ${c.stretchMaxMinutes} minutes${sourceNote(item)}.`,
        }).reason,
      });
    }
    const cur = input.sitting.current;
    const se = entryOf(nudges, date, `${key}:stretch`);
    const start = cur ? toTs(cur.start) : null;
    if (r.stretch && cur && cur.minutes >= c.stretchMaxMinutes && se.for !== start && !snoozed(se, now)) {
      card({
        key: `${key}:stretch`,
        kind: 'sitting',
        items: [item.id],
        at: now.minutes,
        closable: true,
        skip: 'today',
        snooze: standardSnooze(s, now),
        stretch: start!,
        reason: explain(true, 'habits.sitting', { item: item.id, stretchMinutes: cur.minutes, stretchStart: start }, {
          threshold: { stretchMaxMinutes: c.stretchMaxMinutes },
          note: `This stretch has run ${cur.minutes} minutes; your longest is ${c.stretchMaxMinutes}. Time away over ${c.awayMinutes} minutes ends a stretch.`,
        }).reason,
      });
    }
  }

  // Photo day and the tests: once the morning is in.
  if (parts) {
    const ready = morningDone || morningAt === null;
    const from = Math.max(morningAt ?? 0, toMinutes(BODY_FROM)!);
    for (const part of ['photos', 'tests'] as const) {
      const p = parts[part].value;
      const e = entryOf(nudges, date, part);
      if (!p.due || !ready || now.minutes < from || now.minutes >= until || e.how !== undefined || snoozed(e, now)) continue;
      card({ key: part, kind: part, items: [], at: from, closable: true, skip: 'today', later: true, snooze: standardSnooze(s, now, { tomorrow: true }), occurrence: p.occurrence!, skipPeriod: periodic(p), reason: p.schedule.reason });
    }
  }

  // Ask the coach: on the step's Sunday once its answers are saved and no letter is in, then once a day while it is late.
  const cn = input.coach;
  const coachAt = toMinutes(COACH_AT)!;
  const cEntry = entryOf(nudges, date, 'coach');
  if (cn && (cn.state === 'due' || cn.state === 'late') && now.minutes >= coachAt && cEntry.how === undefined && !snoozed(cEntry, now)) {
    const { date: sunday, week, phase, kind, title, command, does, nextCycle, state, line } = cn;
    card({
      key: 'coach',
      kind: 'coach',
      items: [],
      at: coachAt,
      closable: true,
      skip: 'today',
      snooze: standardSnooze(s, now),
      occurrence: sunday,
      coach: { date: sunday, week, phase, kind, title, command, does, nextCycle, state, line },
      reason: explain(true, 'coach.ask', { sunday, step: kind, state, at: COACH_AT }, {
        note: `${state === 'due' ? 'Your Sunday answers are saved and no letter is in yet' : `No letter since your answers for ${dayText(sunday)}`}: run ${command} in Claude Code, in your vault. This card comes at ${COACH_AT} on the Sunday, then once a day until a letter dated on or after ${dayText(sunday)} is in, or the next Sunday comes.`,
      }).reason,
    });
  }

  cards.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.at - b.at);
  return explain({ cards, quiet: false }, 'nudges.due', { now: hhmm(now.minutes), date, items: items.length }, {
    note: cards.length ? `${cards.length} due: ${cards.map((c) => c.key).join(', ')}.` : 'Nothing is due right now.',
  });
}

/**
 * A repeating card's next time today: the start time, then `every`
 * minutes after the latest of the given moments (the last card answered,
 * the last amount logged); null once past the end time.
 */
export function nextRepeat(now: Moment, from: string, to: string, every: number, lasts: (number | null)[]): number | null {
  const start = toMinutes(from)!;
  const end = toMinutes(to)!;
  const day0 = msAt(now, 0);
  const seen = lasts.filter((x): x is number => x !== null && x >= day0);
  const next = seen.length ? Math.max(start, minutesAt(now, Math.max(...seen)) + every) : start;
  return next > end ? null : next;
}

const everyText = (m: number) => (m % 60 === 0 ? `${m / 60 === 1 ? 'hour' : `${m / 60} hours`}` : `${m} minutes`);

function amountReason(item: TrackedItem, value: number, how: string): Reason {
  const a = item.amount!;
  return explain(value < a.target, 'habits.amount', { item: item.id, value, target: a.target, unit: a.unit }, {
    threshold: { target: a.target },
    note: `${how} (Progress, Habits)${sourceNote(item)}. ${value} of ${a.target} ${a.unit} so far.`,
  }).reason;
}

// ---------------------------------------------------------------- quiet hours

/** Card times inside the quiet hours: one time, or the held part of an item's hours, and when its card shows instead (null: never). */
export interface QuietSpan {
  from: string;
  to: string;
  shows: string | null;
}

export interface QuietHold {
  /** The tracked item's id; null for the morning check-in, "Did you train today?" and "Ask the coach". */
  item: string | null;
  /** The card when it is no tracked item's: the morning check-in, "Did you train today?", or "Ask the coach". */
  card?: 'morning' | 'train' | 'coach';
  name: string;
  spans: QuietSpan[];
}

/**
 * The reminders whose cards fall due inside the quiet hours, where dueNow
 * holds every card. A card due before the hours end waits until they end
 * (unless its card stops first, as the morning's does at 21:00); one due
 * after they start, in hours that run past midnight, never shows: when
 * they end it is the next day, whose card is not due yet. From each
 * item's clock times: a supplement's, tick's or amount's time, an amount's
 * repeating hours, the stand-up hours, the desk breaks' hours, the
 * morning check-in, and, with a plan, "Did you train today?" at its
 * setting's time (`settings.didYouTrain`, 20:00 by default, while it is
 * on) and "Ask the coach" at 18:00 (its time is fixed, so only the quiet
 * hours can move). Sitting cards follow the minutes sat, and "after the
 * session" the log, not the clock.
 */
export function quietHolds(input: Pick<DueInput, 'tracking' | 'program' | 'settings'>, quiet: NudgeSettings['quiet']): Result<QuietHold>[] {
  const out: Result<QuietHold>[] = [];
  if (!quiet) return out;
  const hold = (item: string | null, name: string, from: string | undefined, to: string | undefined, until = 24 * 60, card?: QuietHold['card']) => {
    const a = toMinutes(from);
    const b = toMinutes(to);
    if (a === null || b === null || b < a) return;
    const spans = heldSpans(quiet, a, b, until);
    if (spans.length) out.push(explain({ item, ...(card ? { card } : {}), name, spans }, 'nudges.quiet', { item, ...(card ? { card } : {}), times: a === b ? from : `${from} to ${to}`, quiet }, { note: quietNote(quiet, spans, a === b, card) }));
  };
  const t = input.tracking;
  if (t?.morning?.on) hold(null, 'Morning check-in', t.morning.at, t.morning.at, toMinutes(MORNING_UNTIL)!, 'morning');
  for (const item of t?.items ?? []) {
    const r = item.reminder;
    if (item.kind === 'standup') {
      if (item.standup?.hours) hold(item.id, item.name, item.standup.hours[0], item.standup.hours[1]);
    } else if (item.kind === 'desk') {
      const d = deskRoutine(item, input.program).value;
      if (d.times.length) hold(item.id, item.name, d.from, hhmm(toMinutes(d.to)! - d.minutes));
    } else if (item.kind !== 'sitting' && r?.at) hold(item.id, item.name, r.at, r.at);
    else if (item.kind === 'amount' && r?.every) hold(item.id, item.name, r.from, r.to);
  }
  // "Did you train today?" asks only on a plan's training days, at its setting's time until midnight;
  // Ask the coach: a plan's Sundays have a coach step, and its card comes at 18:00 (last, as in the queue).
  const planned = input.program?.macrocycle.phases.some((p) => p.mesocycles.some((m) => m.weeks.some((w) => w.sessions.length > 0))) ?? false;
  const train = { ...DEFAULT_NUDGE_SETTINGS, ...input.settings }.didYouTrain;
  if (planned && train.on) hold(null, 'Did you train today?', train.at, train.at, 24 * 60, 'train');
  if (planned) hold(null, 'Ask the coach', COACH_AT, COACH_AT, 24 * 60, 'coach');
  return out;
}

/** The parts of a..b (local minutes) inside the quiet hours, each with when its cards show: the hours' end that day, or never. */
function heldSpans(quiet: NonNullable<NudgeSettings['quiet']>, a: number, b: number, until: number): QuietSpan[] {
  const spans: QuietSpan[] = [];
  const end = toMinutes(quiet.to)!;
  for (let m = a; m <= b; m++) {
    if (!inQuiet(quiet, m)) continue;
    const last = spans.at(-1);
    if (last && toMinutes(last.to) === m - 1) last.to = hhmm(m);
    else spans.push({ from: hhmm(m), to: hhmm(m), shows: end > m && end < until ? hhmm(end) : null });
  }
  return spans;
}

function quietNote(quiet: NonNullable<NudgeSettings['quiet']>, spans: QuietSpan[], point: boolean, card?: QuietHold['card']): string {
  const said = spans.map((s) => {
    const what = point ? `this ${s.from} card` : s.from === s.to ? `its ${s.from} card` : `its cards from ${s.from} to ${s.to}`;
    const one = point || s.from === s.to;
    return s.shows ? `${what} ${one ? 'waits' : 'wait'} until ${s.shows}` : `${what} never ${one ? 'shows' : 'show'}`;
  });
  // A card at a fixed time (Ask the coach): only the quiet hours can change.
  if (card === 'coach') return `Pahlavan holds cards from ${quiet.from} to ${quiet.to}: ${said.join('; ')}. Its time is fixed, so change quiet hours in Settings to leave ${spans[0]!.from} out of them.`;
  const fixes = spans.map((s) =>
    s.shows
      ? point ? `move it to ${quiet.to} or later` : `start its hours at ${quiet.to} or later`
      : (toMinutes(s.from)! >= toMinutes(quiet.from)! ? (point ? `move it before ${quiet.from}` : `end its hours by ${quiet.from}`) : 'move it out of them'),
  );
  // "Did you train today?": its time is the Settings tab's, not an item's.
  if (card === 'train') return `Pahlavan holds cards from ${quiet.from} to ${quiet.to}: ${said.join('; ')}. Its time is a setting: ${[...new Set(fixes)].join(' and ')} under "Did you train today?" in Settings, or change quiet hours there.`;
  return `Pahlavan holds cards from ${quiet.from} to ${quiet.to}: ${said.join('; ')}; ${[...new Set(fixes)].join(' and ')}, or change quiet hours in Settings.`;
}

// ---------------------------------------------------------------- answers

export type CardAction = 'done' | 'skip' | 'skip-period' | 'snooze' | 'close' | 'later' | 'logged' | 'rest' | 'not-today';

/** A change to Coach/nudges.json: an entry on a day (merged field by field), or a body-record occurrence skipped. */
export type NudgeChange = { date: IsoDate; key: string; set: NudgeEntry } | { skip: string; at: string };

/**
 * What an answer on a card writes into Coach/nudges.json. Done on a
 * repeating card (an amount, a desk break) only moves its clock; Skip on one
 * ends it for the day. A snooze (or closing the card) waits `snoozeMs`; the
 * stand-up's own snooze is the plugin's count, not this file.
 */
export function answerCard(card: Pick<DueCard, 'key' | 'kind' | 'date' | 'skipPeriod' | 'stretch'>, action: CardAction, nowMs: number, opts: { snoozeUntil?: number; by?: string } = {}): NudgeChange[] {
  const at = toTs(nowMs);
  const by = opts.by ? { by: opts.by } : {};
  const set = (e: NudgeEntry): NudgeChange => ({ date: card.date, key: card.key, set: e });
  const repeating = card.kind === 'amount' || card.kind === 'desk';
  switch (action) {
    case 'snooze':
    case 'close':
      return card.kind === 'standup' ? [] : [set({ snoozedUntil: toTs(opts.snoozeUntil ?? nowMs + DEFAULT_NUDGE_SETTINGS.snoozeMinutes * 60_000) })];
    case 'skip-period':
      return card.skipPeriod ? [{ skip: card.skipPeriod.key, at }, set({ how: 'skipped', at, ...by })] : [];
    case 'done':
      if (card.kind === 'standup') return [];
      if (repeating) return [set({ lastAt: at, ...by })];
      return [set({ how: 'done', at, ...by, ...(card.stretch ? { for: card.stretch } : {}) })];
    default: {
      const how: NudgeAnswer = action === 'skip' ? 'skipped' : action;
      return [set({ how, at, ...by, ...(card.stretch ? { for: card.stretch } : {}) })];
    }
  }
}

/** When a snooze choice ends: minutes from now, this evening, or tomorrow morning (at the morning check-in's time). */
export function snoozeUntil(choice: number | 'evening' | 'tomorrow', now: Moment, opts: { evening?: string; morning?: string } = {}): number {
  if (typeof choice === 'number') return now.ms + choice * 60_000;
  if (choice === 'evening') return msAt(now, toMinutes(opts.evening ?? '18:00')!);
  return msAt(now, 24 * 60 + (toMinutes(opts.morning ?? '07:30') ?? 450));
}

// ---------------------------------------------------------------- Due today

export interface DueTodayHabit {
  id: string;
  name: string;
  kind: TrackedItem['kind'];
  dose?: string;
  done: boolean;
  /** Its reminder is later today. */
  later: boolean;
}

export interface DueToday {
  date: IsoDate;
  now: string;
  morning: { on: boolean; at: string | null; done: boolean; checkedAt: string | null };
  habits: { slots: { key: string; time: string | null; items: DueTodayHabit[] }[]; done: number; total: number };
  amounts: { id: string; name: string; value: number; target: number; unit: string; met: boolean; next: string | null }[];
  /** Each stand-up item: the day's minutes and stands so far, `desk` of those minutes stood at the desk with "Standing now" on. */
  standups: { id: string; name: string; minutes: number; desk: number; target: number; count: number; sitting: number | null; sitMinutes: number; phase: string | null }[];
  sitting: { id: string; name: string; minutes: number; longest: number; limit: number; stretchMax: number; overLimit: boolean; overStretch: boolean }[];
  desk: { id: string; name: string; done: number; total: number; times: string[]; next: string | null }[];
  body: { part: BodyPart; due: boolean; nextDate: IsoDate | null; inDays: number | null; text: string; source: 'plan' | 'fixed' }[];
  train: { on: boolean; at: string; needed: boolean };
  /**
   * The coach step after the Sunday check-in, while it is due or late, on
   * its Sunday while the answers wait (answer first), and done once its
   * letter is in, until the next Sunday's step takes over: the step and its
   * command, its line, the "Ask the coach" card's time (null while the
   * answers wait, and once done), whether today's card is answered, the
   * letter's date when there is one, and the reason. Null otherwise, and
   * without a plan.
   */
  coach: DueTodayCoach | null;
}

export interface DueTodayCoach extends Pick<CoachNow, 'date' | 'week' | 'phase' | 'kind' | 'title' | 'command' | 'does' | 'nextCycle' | 'state' | 'line' | 'letter'> {
  at: string | null;
  answered: boolean;
  reason: Reason;
}

/** The coach step as Due today lists it: due, late, done, or answer first on its own Sunday; else null. */
export function coachToday(cn: CoachNow | null | undefined, date: IsoDate, nudges: NudgeState | null): DueTodayCoach | null {
  if (!cn) return null;
  const sunday = cn.state === 'answer-first' && cn.date === date;
  if (cn.state !== 'due' && cn.state !== 'late' && cn.state !== 'done' && !sunday) return null;
  const { date: on, week, phase, kind, title, command, does, nextCycle, state, line, letter } = cn;
  const at = state === 'answer-first' || state === 'done' ? null : COACH_AT;
  const answered = entryOf(nudges, date, 'coach').how !== undefined;
  const reason = explain(state !== 'done', 'coach.ask', { sunday: on, step: kind, state, at, letter }, {
    note: state === 'done'
      ? `The coach’s letter${letter ? ` of ${dayText(letter)}` : ''} is in: the step after your answers for ${dayText(on)} is done, and no card comes. The next step follows the Sunday check-in of ${dayText(addDays(on, 7))}.`
      : state === 'answer-first'
        ? `Your answers for ${dayText(on)} are not saved yet: save them in Check-in, then run ${command} in Claude Code. The Ask the coach card comes at ${COACH_AT} once they are saved.`
        : `${state === 'due' ? 'Your Sunday answers are saved and no letter is in yet' : `No letter since your answers for ${dayText(on)}`}: run ${command} in Claude Code, in your vault. The Ask the coach card comes at ${COACH_AT}${state === 'late' ? ' each day until a letter is in, or the next Sunday comes' : ''}${answered ? '; today’s is answered' : ''}.`,
  }).reason;
  return { date: on, week, phase, kind, title, command, does, nextCycle, state, line, letter, at, answered, reason };
}

/** Today's side column: what is due today and where each stands. */
export function dueToday(input: DueInput): Result<DueToday> {
  const s: NudgeSettings = { ...DEFAULT_NUDGE_SETTINGS, ...input.settings };
  const { now, tracking, nudges } = input;
  const date = now.date;
  const td = trainingDays(input.training, date);
  const items = dueItems(tracking, td, input.program);
  const ctx = { tracking, habits: input.habits };
  const checked = checkedIn(input.body, date);
  const morning = tracking?.morning;
  const out: DueToday = {
    date,
    now: hhmm(now.minutes),
    morning: { on: Boolean(morning?.on), at: morning?.at ?? null, done: morningIn(input.body, date) || entryOf(nudges, date, 'morning').how === 'done', checkedAt: checked },
    habits: { slots: [], done: 0, total: 0 },
    amounts: [],
    standups: [],
    sitting: [],
    desk: [],
    body: [],
    train: { on: s.didYouTrain.on, at: s.didYouTrain.at, needed: false },
    coach: coachToday(input.coach, date, nudges),
  };
  const slots = new Map<string, { key: string; time: string | null; items: DueTodayHabit[] }>();
  for (const { item, desk } of items) {
    const v = dayValue(item, date, ctx);
    if (item.kind === 'supplement' || item.kind === 'tick') {
      const r = item.reminder;
      const key = r?.afterLog ? 'after-log' : (r?.at ?? 'any');
      const time = r?.at ?? null;
      const sl = slots.get(key) ?? { key, time, items: [] };
      sl.items.push({ id: item.id, name: item.name, kind: item.kind, ...(item.dose ? { dose: item.dose } : {}), done: v.done, later: !v.done && time !== null && (toMinutes(time) ?? 0) > now.minutes });
      slots.set(key, sl);
      out.habits.total++;
      if (v.done) out.habits.done++;
    } else if (item.kind === 'amount') {
      const a = item.amount!;
      const r = item.reminder;
      const e = entryOf(nudges, date, `amount:${item.id}`);
      let next: number | null = null;
      if (!v.done && e.how === undefined && r?.every) next = nextRepeat(now, r.from!, r.to!, r.every, [parseTs(e.lastAt), parseTs(v.via === 'pahlavan' ? v.at : null)]);
      else if (!v.done && e.how === undefined && r?.at && (toMinutes(r.at) ?? 0) > now.minutes) next = toMinutes(r.at);
      out.amounts.push({ id: item.id, name: item.name, value: v.value ?? 0, target: a.target, unit: a.unit, met: v.done, next: next === null ? null : hhmm(Math.max(next, now.minutes)) });
    } else if (item.kind === 'standup') {
      const c = item.standup!;
      const st = input.stand?.[item.id];
      const p = st ? standProgress(st, c) : null;
      out.standups.push({ id: item.id, name: item.name, minutes: v.value ?? 0, desk: v.desk ?? 0, target: c.targetMinutes, count: v.count ?? 0, sitting: p ? p.satMinutes : null, sitMinutes: c.sitMinutes, phase: p?.phase ?? null });
    } else if (item.kind === 'sitting' && input.sitting) {
      const c = item.sitting!;
      const day = input.sitting.today;
      out.sitting.push({ id: item.id, name: item.name, minutes: day.minutes, longest: day.longest, limit: c.limitMinutes, stretchMax: c.stretchMaxMinutes, overLimit: day.minutes > c.limitMinutes, overStretch: day.longest > c.stretchMaxMinutes });
    } else if (item.kind === 'desk' && desk) {
      const done = v.value ?? 0;
      const e = entryOf(nudges, date, `desk:${item.id}`);
      const lastAt = parseTs(e.lastAt);
      const last = toMinutes(desk.to)! - desk.minutes;
      const next = done >= desk.times.length || e.how !== undefined ? null : lastAt === null ? toMinutes(desk.from)! : Math.max(toMinutes(desk.from)!, minutesAt(now, lastAt) + desk.every);
      out.desk.push({ id: item.id, name: item.name, done, total: desk.times.length, times: desk.times, next: next !== null && next <= last ? hhmm(next) : null });
    }
  }
  out.habits.slots = [...slots.values()].sort((a, b) => (a.time ?? (a.key === 'after-log' ? '17:00' : '12:00')).localeCompare(b.time ?? (b.key === 'after-log' ? '17:00' : '12:00')));
  const parts = bodyParts(input, date);
  out.body = (['tape', 'photos', 'tests'] as const).map((p) => {
    const v = parts[p].value;
    return { part: p, due: v.due, nextDate: v.nextDate, inDays: v.inDays, text: v.schedule.text, source: v.schedule.source };
  }).sort((a, b) => (a.nextDate ?? '9999').localeCompare(b.nextDate ?? '9999'));
  const t = input.training;
  out.train.needed = s.didYouTrain.on && t.plannedToday && !trainingKnown(t, date) && entryOf(nudges, date, 'train').how === undefined;
  return explain(out, 'nudges.today', { date, now: out.now, items: items.length }, {
    note: `${out.habits.done} of ${out.habits.total} habits done; ${out.body.filter((b) => b.due).map((b) => b.part).join(', ') || 'nothing from the body record'} due${out.body.some((b) => !b.due && b.nextDate) ? `; next ${out.body.find((b) => !b.due && b.nextDate)!.part} on ${dayText(out.body.find((b) => !b.due && b.nextDate)!.nextDate!)}` : ''}.`,
  });
}
