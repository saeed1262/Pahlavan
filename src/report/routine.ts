// "Your routine" in the ? menu, as signed off for 0.13.0: the user's own
// routine with Pahlavan in rows of time, what and where, in three groups.
// Every day: the morning check-in at its card's time, a look at Today, each
// tracked item by its reminder time (close times in one row, the interval
// and desk kinds by the days they run, the rest "Any time"), logging after
// training and the evening "Did you train?". Sundays: the check-in and the
// week's letter, the tape. Every four weeks: the light week and the phase
// end. All of it from the user's plan, tracked items, card times and the
// body record's schedule; nothing is fixed to one user. The user types
// everything in Pahlavan, so no row assumes the phone. Pure: the date is an
// input.

import { legacyRules, lightCalendarText, lightDoseText, type LightWeeksRules } from '../core/rules.ts';
import type { VaultRead } from '../adapters/vault/read.ts';
import type { TrackingRead } from '../adapters/vault/tracking-read.ts';
import { hhmm, toMinutes } from '../core/clock.ts';
import { COACH_COMMANDS, planSteps } from '../core/coach-steps.ts';
import { addDays, dayText, type IsoDate } from '../core/dates.ts';
import { BODY_DEFAULTS, type BodyPart, type PartStatus } from '../core/body-schedule.ts';
import { deskRoutine } from '../core/desk-breaks.ts';
import { bodyParts, DEFAULT_NUDGE_SETTINGS } from '../core/nudges.ts';
import { explain, type Reason, type Result } from '../core/reason.ts';
import { WEEKDAYS, type Program, type TrackedItem, type Tracking, type Weekday } from '../core/schema.ts';
import { hm } from '../core/sitting.ts';
import { itemOn, pausedOn, scheduleText } from '../core/tracking.ts';
import { inLine } from './your-day.ts';

/** Where a row happens: a reminder card, or the screen it is done on. */
export type RoutineWhere = 'Card' | 'Today' | 'Log session' | 'Check-in' | 'Body record' | 'Plan';

export interface RoutineRow {
  /** "07:30", "21:00 to 22:00", "Work days", "After training", "Any time", "Every Sunday", "Light week". */
  time: string;
  what: string;
  /** The coach's command after `what`, drawn as code. */
  command?: string;
  /** "Next: Sun 8 Nov", after the command. */
  next?: string;
  where: RoutineWhere;
  /** The tracked items in the row, by id. */
  items?: string[];
  reason: Reason;
}

export interface RoutineGroup {
  id: 'daily' | 'sunday' | 'weeks' | 'own';
  /** "Every day", "Sundays", "Every four weeks", "On your own schedule". */
  title: string;
  rows: RoutineRow[];
}

export interface Routine {
  title: string;
  intro: string;
  groups: RoutineGroup[];
}

export interface RoutineInput {
  date: IsoDate;
  tracking: Tracking | null;
  /** The plan (null without one: no session, Sunday or light-week rows). */
  program: Pick<Program, 'macrocycle' | 'deskBreaks'> | null;
  /** The plan's length in weeks (its last phase review also plans the next cycle). */
  planWeeks?: number | null;
  /** The plan has lifting days (logged lifts to enter after training). */
  lifts: boolean;
  /** "Did you train today?": on or off, and its time (the Settings tab's). */
  didYouTrain: { on: boolean; at: string };
  /** The body record's parts on the date (the tape, photos and tests: their schedule and next date). */
  body: Record<BodyPart, PartStatus> | null;
  /** The plan's light weeks (rules.ts); without them, the old default's every 4th week. */
  lightWeeks?: LightWeeksRules | null;
}

export const ROUTINE_INTRO = 'About five minutes a day in Pahlavan, plus the session. It changes when your plan or your items change.';
/** Close reminder times share a row: a time within this many minutes of the row's first ("21:00 to 22:00"). */
export const CLOSE_MINUTES = 60;

const ALL_DAYS: readonly Weekday[] = WEEKDAYS;
const WORK_DAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
const cap = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const list = (xs: readonly string[]) => xs.map((x, i) => (i ? inLine(x) : cap(x))).join(', ');
const every = (m: number) => (m % 60 === 0 ? `${m / 60} h` : `${m} min`);
/** An item as a row names it: its dose, and its days when not every day ("Creatine 5 g", "Fish oil (training days)"). */
const named = (it: TrackedItem) => `${it.name}${it.dose ? ` ${it.dose}` : ''}${it.schedule.kind === 'daily' ? '' : ` (${scheduleText(it.schedule)})`}`;

/** A part's next date in words: due now, the next one, or none left. */
function nextOf(p: PartStatus, date: IsoDate): string {
  if (p.due && p.nextDate) return p.nextDate < date ? `Due since ${dayText(p.nextDate)}` : 'Due today';
  return p.nextDate ? `Next: ${dayText(p.nextDate)}` : 'None left in this plan';
}

/** The days an interval or desk item runs: its schedule's weekdays, the plan's for desk breaks that follow it; null for training, rest or every-N-days schedules. */
function daysOf(it: TrackedItem, program: RoutineInput['program']): readonly Weekday[] | null {
  if (it.kind === 'desk') {
    const d = deskRoutine(it, program).value.days;
    if (d) return d;
  }
  if (it.schedule.kind === 'daily') return ALL_DAYS;
  if (it.schedule.kind === 'weekdays') return WEEKDAYS.filter((d) => (it.schedule.days ?? []).includes(d));
  return null;
}

const daysLabel = (days: readonly Weekday[] | null, it: TrackedItem) =>
  !days ? cap(scheduleText(it.schedule)) : days.length === 7 ? 'Through the day' : days.length === 5 && WORK_DAYS.every((d) => days.includes(d)) ? 'Work days' : days.map((d) => cap(d)).join(', ');

/**
 * An interval or desk item in a row: "water every 2 h", "stand-ups", "desk
 * breaks 10:00 to 16:00 (from your plan)", "the sitting card at 7 h 30";
 * with the minutes it starts, and for desk breaks on the plan's times a
 * line for the row's reason (the item's own times do not apply then).
 */
function intervalPart(it: TrackedItem, program: RoutineInput['program']): { text: string; from: number | null; note?: string } {
  if (it.kind === 'amount') return { text: `${inLine(it.name)} every ${every(it.reminder!.every!)}`, from: toMinutes(it.reminder!.from) };
  if (it.kind === 'standup') return { text: inLine(it.name), from: toMinutes(it.standup?.hours?.[0]) };
  if (it.kind === 'desk') {
    const r = deskRoutine(it, program).value;
    const plan = r.source === 'plan';
    return {
      text: `${r.times.length ? `${inLine(it.name)} ${r.times[0]} to ${r.times.at(-1)}` : inLine(it.name)}${plan ? ' (from your plan)' : ''}`,
      from: toMinutes(r.times[0] ?? r.from),
      ...(plan ? { note: `${it.name}: from your plan, every ${r.every} min from ${r.from} to ${r.to}.` } : {}),
    };
  }
  const at = it.reminder?.atMinutes;
  return { text: at ? `the sitting card at ${hm(at)}` : `the sitting limit, ${hm(it.sitting?.limitMinutes ?? 0)}`, from: null };
}

type Keyed = RoutineRow & { key: number };

/** The Every day rows, in the day's order. */
function dailyRows(input: RoutineInput, items: TrackedItem[]): RoutineRow[] {
  const rows: Keyed[] = [];
  const planned = input.program !== null;
  const mo = input.tracking?.morning;
  const mAt = mo?.on ? toMinutes(mo.at) : null;
  rows.push({
    key: mAt ?? 0,
    time: mAt !== null ? mo!.at : 'Morning',
    what: 'Morning check-in: energy, soreness, sleep, and the numbers from your watch or phone if you have them',
    where: mAt !== null ? 'Card' : 'Check-in',
    reason: explain(mo ?? null, 'routine.morning', { on: mo?.on ?? false, at: mo?.at ?? null }, { note: mAt !== null ? `The morning card comes at ${mo!.at} (its time is on its card in Check-in). You type the numbers; about 30 seconds.` : 'No morning card is set: open Check-in in the morning, or turn its card on there.' }).reason,
  });
  if (planned) rows.push({ key: (mAt ?? 0) + 0.5, time: 'Then', what: 'Look at Today: Readiness, and the session it adjusted for you', where: 'Today', reason: explain(true, 'routine.today', {}, { note: 'Today’s session already has readiness, sore muscles and the Ledger applied.' }).reason });

  // Supplements, ticks and single-time amounts by their reminder time; close times share a row.
  const timed = items.filter((it) => (it.kind === 'supplement' || it.kind === 'tick' || (it.kind === 'amount' && !it.reminder?.every)) && toMinutes(it.reminder?.at) !== null)
    .sort((a, b) => toMinutes(a.reminder!.at)! - toMinutes(b.reminder!.at)!);
  const runs: { from: number; to: number; items: TrackedItem[] }[] = [];
  for (const it of timed) {
    const t = toMinutes(it.reminder!.at)!;
    const last = runs.at(-1);
    if (last && t - last.from <= CLOSE_MINUTES) {
      last.to = t;
      last.items.push(it);
    } else runs.push({ from: t, to: t, items: [it] });
  }
  for (const r of runs) {
    const time = r.from === r.to ? hhmm(r.from) : `${hhmm(r.from)} to ${hhmm(r.to)}`;
    rows.push({ key: r.from, time, what: list(r.items.map(named)), where: 'Card', items: r.items.map((x) => x.id), reason: explain(r.items.map((x) => x.id), 'routine.items', { times: r.items.map((x) => x.reminder!.at), close: CLOSE_MINUTES }, { note: `${r.items.length === 1 ? 'Its card comes' : 'Their cards come'} at ${[...new Set(r.items.map((x) => x.reminder!.at))].join(' and ')}${r.from === r.to ? '' : `: times within ${CLOSE_MINUTES} minutes share a row`}. Tick early on Today’s Due today.` }).reason });
  }

  // The interval and desk kinds, one row per set of days they run.
  const interval = items.filter((it) => (it.kind === 'amount' && it.reminder?.every && it.reminder.from) || it.kind === 'standup' || it.kind === 'desk' || it.kind === 'sitting');
  const byDays = new Map<string, { label: string; parts: ReturnType<typeof intervalPart>[]; ids: string[] }>();
  for (const it of interval) {
    const days = daysOf(it, input.program);
    const label = daysLabel(days, it);
    const g = byDays.get(label) ?? { label, parts: [], ids: [] };
    g.parts.push(intervalPart(it, input.program));
    g.ids.push(it.id);
    byDays.set(label, g);
  }
  for (const g of byDays.values()) {
    // In the order they start (sitting, which has no start, last); a row every day before the work days' at the same time.
    const parts = [...g.parts].sort((a, b) => (a.from ?? Infinity) - (b.from ?? Infinity));
    const starts = parts.map((p) => p.from).filter((x): x is number => x !== null);
    rows.push({ key: (starts.length ? Math.min(...starts) : 12 * 60) + (g.label === 'Through the day' ? 0.2 : 0.25), time: g.label, what: cap(parts.map((p) => p.text).join(', ')), where: 'Card', items: g.ids, reason: explain(g.ids, 'routine.through', { days: g.label, items: g.ids }, { note: [`${g.label === 'Through the day' ? 'Every day' : g.label}: their cards come by the clock or by your sitting; Due today shows where each stands.`, ...parts.flatMap((p) => (p.note ? [p.note] : []))].join(' ') }).reason });
  }

  if (planned) rows.push({ key: 17 * 60, time: 'After training', what: input.lifts ? 'Log the session: the two logged lifts’ top sets and the minutes' : 'Log the session and its minutes', where: 'Log session', reason: explain(true, 'routine.after', { lifts: input.lifts }, { note: 'Log session fills in today’s targets: change what differed, then save. Saving also ticks the Workout habit.' }).reason });
  // Items whose card comes once a session is logged.
  const after = items.filter((it) => (it.kind === 'supplement' || it.kind === 'tick') && it.reminder?.afterLog);
  if (after.length) rows.push({ key: 17 * 60 + 0.5, time: 'After training', what: list(after.map(named)), where: 'Card', items: after.map((x) => x.id), reason: explain(after.map((x) => x.id), 'routine.items', { afterLog: true }, { note: 'Their card comes once the session is logged.' }).reason });
  const t = input.didYouTrain;
  if (planned && t.on && toMinutes(t.at) !== null) rows.push({ key: toMinutes(t.at)!, time: t.at, what: 'Did you train? Only if nothing is logged', where: 'Card', reason: explain(t, 'routine.train', { at: t.at }, { note: `At ${t.at} (Settings), only on a day your plan has a session and nothing is logged, ticked or marked rest.` }).reason });

  // Last: what has no reminder time.
  const any = items.filter((it) => (it.kind === 'supplement' || it.kind === 'tick' || it.kind === 'amount') && !timed.includes(it) && !after.includes(it) && !interval.includes(it));
  if (any.length) rows.push({ key: Infinity, time: 'Any time', what: list(any.map(named)), where: 'Today', items: any.map((x) => x.id), reason: explain(any.map((x) => x.id), 'routine.anytime', {}, { note: 'No reminder time: tick them on Today’s Due today.' }).reason });
  return rows.sort((a, b) => a.key - b.key).map(({ key: _k, ...r }) => r);
}

/** Sundays (with a plan): the check-in and the letter; the tape when it follows the plan. */
function sundayRows(input: RoutineInput): RoutineRow[] {
  if (!input.program) return [];
  const rows: RoutineRow[] = [{ time: 'Every Sunday', what: 'The week’s questions, then ask the coach for the letter', command: COACH_COMMANDS.checkin, where: 'Check-in', reason: explain(true, 'routine.sunday', { command: COACH_COMMANDS.checkin }, { note: `Answer the open questions in Check-in, save, then run ${COACH_COMMANDS.checkin} in Claude Code for the week’s letter.` }).reason }];
  const tape = input.body?.tape;
  if (tape?.schedule.source === 'plan') rows.push({ time: 'Every second Sunday', what: 'The tape.', next: nextOf(tape, input.date), where: 'Body record', reason: explain(tape.nextDate, 'routine.tape', { next: tape.nextDate, due: tape.due }, { note: `${tape.schedule.text}, from your plan.` }).reason });
  return rows;
}

/** The plan's light weeks in a sentence: "Every 4th plan week is a light week: 2 sets of everything, about 10 % lighter, RIR +3." */
function lightLine(lw: LightWeeksRules): string {
  const when = cap(lightCalendarText(lw));
  return `${when} ${lw.weeks && lw.weeks.length > 1 ? 'are light weeks' : 'is a light week'}: ${lightDoseText(lw)}.`;
}

/** Every mesocycle (with a plan): the light week, and the phase end with its tests and review. */
function weekRows(input: RoutineInput): RoutineRow[] {
  const program = input.program;
  if (!program) return [];
  const rows: RoutineRow[] = [];
  const date = input.date;
  const weeks = program.macrocycle.phases.flatMap((p) => p.mesocycles.flatMap((m) => m.weeks));
  const light = weeks.filter((w) => w.kind === 'deload').map((w) => ({ from: w.start, to: addDays(w.start, 6) })).find((w) => w.to >= date) ?? null;
  if (weeks.some((w) => w.kind === 'deload')) {
    const photos = input.body?.photos.schedule.source === 'plan';
    rows.push({
      time: 'Light week',
      what: photos ? 'Lighter sessions; on its Sunday the photos, then' : 'Lighter sessions; on its Sunday the check-in, then',
      command: COACH_COMMANDS.review,
      next: !light ? 'None left in this plan' : light.from <= date ? `Now, until ${dayText(light.to)}` : `Next: ${dayText(light.from)} to ${dayText(light.to)}`,
      where: 'Plan',
      reason: explain(light, 'routine.light', { next: light }, { note: `${lightLine(input.lightWeeks ?? legacyRules().lightWeeks)} Its Sunday closes the mesocycle: the mesocycle review writes the next one’s plan.` }).reason,
    });
  }
  const reviews = planSteps(program, input.planWeeks ?? null).filter((s) => s.value.kind === 'phase-review');
  const end = reviews.find((s) => s.value.date >= date)?.value ?? null;
  if (reviews.length) {
    const tests = input.body?.tests.schedule.source === 'plan';
    const sat = end ? addDays(end.date, -1) : null;
    rows.push({
      time: 'Phase end',
      what: tests ? 'The tests on Saturday, the review on Sunday:' : 'The review on Sunday:',
      command: COACH_COMMANDS.review,
      next: !end ? 'None left in this plan' : tests ? `Next: ${dayText(sat!)} and ${dayText(end.date)}` : `Next: ${dayText(end.date)}`,
      where: tests ? 'Body record' : 'Check-in',
      reason: explain(end ? end.date : null, 'routine.phase', { sunday: end?.date ?? null, week: end?.week ?? null, nextCycle: end?.nextCycle ?? false }, { note: end ? `Plan week ${end.week} ends phase ${end.phase}: ${tests ? 'the fitness tests on its Saturday, ' : ''}the phase review on its Sunday${end.nextCycle ? ', which also plans the next cycle' : ''}.` : 'No phase end is left in this plan.' }).reason,
    });
  }
  return rows;
}

/** The body record on a fixed schedule (every N days, set in Check-in): the tape with the photos, and the tests. */
function ownRows(input: RoutineInput): RoutineRow[] {
  const b = input.body;
  if (!b) return [];
  const set = input.tracking?.bodyRecord;
  const rows: RoutineRow[] = [];
  if (b.tape.schedule.source === 'fixed') rows.push({ time: `Every ${set?.tapeEvery ?? BODY_DEFAULTS.tapeEvery} days`, what: 'The tape and the photos.', next: nextOf(b.tape, input.date), where: 'Body record', reason: explain(b.tape.nextDate, 'routine.body', { part: 'tape', next: b.tape.nextDate }, { note: `${b.tape.schedule.text}, set on the Check-in screen.` }).reason });
  if (b.tests.schedule.source === 'fixed') rows.push({ time: `Every ${set?.testsEvery ?? BODY_DEFAULTS.testsEvery} days`, what: 'The tests.', next: nextOf(b.tests, input.date), where: 'Body record', reason: explain(b.tests.nextDate, 'routine.body', { part: 'tests', next: b.tests.nextDate }, { note: `${b.tests.schedule.text}, set on the Check-in screen.` }).reason });
  return rows;
}

/** The routine from the user's own plan, items, card times and schedules. */
export function yourRoutine(input: RoutineInput): Result<Routine> {
  // What is tracked as of the date: started, not paused, in its settings for that day.
  const items = (input.tracking?.items ?? []).filter((it) => it.start <= input.date && !pausedOn(it, input.date)).map((it) => itemOn(it, input.date));
  const groups: RoutineGroup[] = [
    { id: 'daily' as const, title: 'Every day', rows: dailyRows(input, items) },
    { id: 'sunday' as const, title: 'Sundays', rows: sundayRows(input) },
    { id: 'weeks' as const, title: (input.lightWeeks ?? legacyRules().lightWeeks).every === 4 ? 'Every four weeks' : 'Each mesocycle', rows: weekRows(input) },
    { id: 'own' as const, title: 'On your own schedule', rows: ownRows(input) },
  ].filter((g) => g.rows.length);
  return explain({ title: 'Your routine', intro: ROUTINE_INTRO, groups }, 'routine', { date: input.date, items: items.length, plan: input.program !== null, morning: input.tracking?.morning ?? null, didYouTrain: input.didYouTrain }, {
    note: 'Built from your plan, what you track, the cards’ times and the body record’s schedule: it changes when they do.',
  });
}

/** The routine for the date from the files as read; `didYouTrain` is the Settings tab's (the plugin's defaults without it). */
export function buildRoutine(read: VaultRead, tr: TrackingRead | null, date: IsoDate, opts: { didYouTrain?: { on: boolean; at: string } } = {}): Result<Routine> {
  const planned = read.files.plan !== 'missing';
  const program = planned ? read.data.program : null;
  const tracking = tr?.tracking ?? null;
  const parts = bodyParts({ tracking, nudges: tr?.nudges ?? null, body: tr?.body ?? null, photoFolders: tr?.photoFolders ?? [], program }, date);
  return yourRoutine({
    date,
    tracking,
    program,
    planWeeks: planned ? read.data.plan.weeks : null,
    lifts: planned && read.data.plan.types.some((t) => t.kind === 'lift'),
    didYouTrain: opts.didYouTrain ?? DEFAULT_NUDGE_SETTINGS.didYouTrain,
    body: { tape: parts.tape.value, photos: parts.photos.value, tests: parts.tests.value },
    lightWeeks: planned ? read.data.rules.rules.lightWeeks : null,
  });
}
