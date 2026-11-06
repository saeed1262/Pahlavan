// "Your day" at the top of Today, as signed off for 0.13.0: the day with
// Pahlavan in one strip, its steps in the day's order (the morning check-in,
// the session, the habits, the food, and on a coach step's Sunday the Sunday
// check-in, then the coach), each with its state (done, next or open; quiet
// when there is nothing to do yet, not counted), a status word, a bold
// name, one line and at most one action, and how many are done. The step
// that comes next is the first one not done. Built from the reports Today
// already has (Today's, Due today's and the Food tab's), every step with its
// reason. Pure: the reports and the clock's text are inputs; the plugin
// draws the strip and wires the actions.

import { COACH_COMMANDS, type CoachNow } from '../core/coach-steps.ts';
import { dayText, type IsoDate } from '../core/dates.ts';
import { MORNING_QUESTIONS } from '../core/morning.ts';
import type { DueToday } from '../core/nudges.ts';
import { isProteinItem } from '../core/protein.ts';
import { explain, type Reason, type Result } from '../core/reason.ts';
import type { TrackedItem } from '../core/schema.ts';
import type { buildFood } from './food.ts';
import { readinessNow } from './glance.ts';
import type { buildSession } from './session.ts';
import type { buildToday } from './today.ts';

type Today = ReturnType<typeof buildToday>;
type Session = ReturnType<typeof buildSession>;
type Food = ReturnType<typeof buildFood>;

export type DayStepId = 'morning' | 'session' | 'habits' | 'food' | 'sunday';
/** done; next: the step that comes next in the day (one at most); open: still to do; quiet: nothing to do yet, not counted. */
export type DayStepState = 'done' | 'next' | 'open' | 'quiet';

/** A step's one action; the plugin wires each kind. */
export type DayAction =
  /** Opens the morning card. */
  | { kind: 'morning'; label: string }
  /** Opens the Log panel on today's session, as the banner's Log session does. */
  | { kind: 'log'; label: string }
  /** Goes to Due today, where the habits are ticked. */
  | { kind: 'due'; label: string }
  /** Opens the Food tab. */
  | { kind: 'food'; label: string }
  /** Opens the Check-in tab (the Sunday check-in). */
  | { kind: 'checkin'; label: string }
  /** The coach's command in a chip, with Copy. */
  | { kind: 'copy'; label: string; command: string };

export interface DayStep {
  id: DayStepId;
  icon: string;
  state: DayStepState;
  /** The status word: "Done 07:42", "Rest", "Next", "Open", "No plan yet". */
  word: string;
  /** "Morning check-in", "Session S1", "Habits: 3 of 6". */
  name: string;
  /** One plain line: "Readiness Normal", "Bike + core, about 33 min", "Next: water at 13:00". */
  line: string;
  action: DayAction | null;
  reason: Reason;
}

export interface YourDay {
  date: IsoDate;
  /** "Your day · Wed 4 Nov". */
  kicker: string;
  done: number;
  /** The steps counted (a quiet one is not). */
  total: number;
  /** "2 of 4 done". */
  count: string;
  steps: DayStep[];
  /** The step that comes next; null once every counted step is done. */
  next: DayStepId | null;
}

export interface YourDayExtras {
  /** Today's session as the screen shows it (the user's pick and mode). */
  session: Session | null;
  /** Due today from the reminder machinery; null without it (the morning step then reads today's inputs, and there is no habits step). */
  due: DueToday | null;
  /** The Food tab's report for the date; null: no food step. */
  food: Food | null;
  /** What is tracked (Coach/tracking.json's items): the protein item's target without an eating plan. */
  items?: readonly TrackedItem[];
  /** A moment as local HH:MM (the morning check-in's saved time); absent: the time is left out. */
  clock?: (ms: number) => string;
}

const and = (xs: readonly string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const cap = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const clean = (t: string | null | undefined) => (t == null ? '' : String(t).replace(/\s*—\s*/g, ' · '));
/** An item's name inside a line: "water", "skin routine"; a name with a capital after its first letter stays ("Vitamin D3"). */
export const inLine = (name: string): string => (/[A-Z]/.test(name.slice(1)) ? name : name.charAt(0).toLowerCase() + name.slice(1));
/** "the week’s letter", "the mesocycle review", "the phase review". */
const stepWords = (c: Pick<CoachNow, 'kind' | 'title'>) => (c.kind === 'letter' ? 'the week’s letter' : `the ${c.title.toLowerCase()}`);

/** A step before its place in the day is known: open steps get "next" or "open" once all are built. */
type Draft = Omit<DayStep, 'state' | 'word'> & { state: 'done' | 'open' | 'quiet'; word?: string };

function morningStep(m: Today, due: DueToday | null, clock: YourDayExtras['clock']): Draft {
  const r = m.review!;
  const mo = due?.morning ?? null;
  // Without Due today, the card's own questions answered today count as checked in (the one rule: numbers alone are not).
  const done = mo ? mo.done : m.inputs.some((x) => x.value !== null && (MORNING_QUESTIONS as readonly string[]).includes(x.signal));
  const at = mo?.checkedAt && clock && !Number.isNaN(Date.parse(mo.checkedAt)) ? clock(Date.parse(mo.checkedAt)) : null;
  const rd = readinessNow(r);
  const today = r.readiness.today.value;
  const reading = rd.building ? `Readiness building, ${rd.mornings} of ${rd.needed}` : today.band !== 'unscored' ? `Readiness ${rd.label}${rd.changes ? `: ${rd.short}` : ''}` : 'Readiness not scored today';
  const later = !done && mo?.at && mo.at > (due?.now ?? '') ? mo.at : null;
  const inputs = { done, checkedAt: mo?.checkedAt ?? null, cardAt: mo?.at ?? null, on: mo?.on ?? null, building: rd.building, band: today.band, from: mo ? 'due' : 'inputs' };
  if (done) {
    return { id: 'morning', icon: 'clipboard', state: 'done', word: at ? `Done ${at}` : 'Done', name: 'Morning check-in', line: reading, action: null, reason: explain(true, 'day.morning', inputs, { note: `Saved${at ? ` at ${at}` : ''}: today’s readiness reads it. ${rd.building ? `The baseline is building: ${rd.mornings} of ${rd.needed} mornings this cycle, so train as planned.` : today.band !== 'unscored' ? `Today: ${rd.label}, ${rd.short}.` : 'Today’s check-in is not scored: readiness needs 3 signals with 14 days of history.'}` }).reason };
  }
  return {
    id: 'morning', icon: 'clipboard', state: 'open', name: 'Morning check-in',
    line: later ? `A card at ${later}, about 30 seconds` : 'About 30 seconds, it feeds readiness',
    action: { kind: 'morning', label: 'Open' },
    reason: explain(false, 'day.morning', inputs, { note: `Not saved yet: energy, soreness and sleep take about 30 seconds, and today’s readiness reads them.${mo?.on && mo.at ? ` The card comes at ${mo.at}.` : ''}` }).reason,
  };
}

function sessionStep(m: Today, x: YourDayExtras): Draft {
  const day = m.week.find((d) => d.today) ?? null;
  const sess = x.session?.session ?? null;
  const pl = (x.session as { plannedLoad?: { minutes: number | null } } | null)?.plannedLoad;
  const minutes = pl?.minutes ? Math.round(pl.minutes) : null;
  const name = sess ? `Session ${sess.type}` : 'Session';
  const inputs = { date: m.date, day: day?.state ?? null, planned: sess?.type ?? null, logged: day?.sessions.map((s) => s.type) ?? [] };
  if (day?.state === 'trained') {
    const what = day.sessions.map((s) => `${clean(s.label ?? s.name)}${s.minutes ? `, ${Math.round(s.minutes)} min` : ''}`);
    const own = sess && day.sessions.some((s) => s.type === sess.type);
    const first = day.sessions[0]!;
    return { id: 'session', icon: 'dumbbell', state: 'done', word: 'Done', name: own ? name : first.type === 'custom' ? 'Session' : `Session ${first.type}`, line: `Logged: ${what.join('; ')}`, action: null, reason: explain(true, 'day.session', inputs, { note: `Logged today: ${and(what)}.` }).reason };
  }
  if (day?.state === 'rest') return { id: 'session', icon: 'dumbbell', state: 'done', word: 'Rest', name: 'Rest day', line: 'Marked rest: nothing to log', action: null, reason: explain(true, 'day.session', inputs, { note: 'Today is marked a rest day: nothing to log, and it counts as done.' }).reason };
  if (day?.state === 'missed') return { id: 'session', icon: 'dumbbell', state: 'done', word: 'Missed', name, line: 'Marked missed today', action: null, reason: explain(true, 'day.session', inputs, { note: 'Today is marked missed: nothing is left to do for it today. The Sunday check-in asks about the week.' }).reason };
  if (!sess) return { id: 'session', icon: 'dumbbell', state: 'done', word: 'Rest', name: 'Rest day', line: 'No session in your plan today', action: null, reason: explain(true, 'day.session', inputs, { note: 'Your plan has no session today: a rest day, counted as done.' }).reason };
  const planned = `${clean(sess.name)}${minutes ? `, about ${minutes} min` : ''}`;
  if (day?.state === 'unlogged') {
    const said = day.confirmed ? 'Your Sunday check-in says you trained today' : 'The Workout habit is ticked';
    return { id: 'session', icon: 'dumbbell', state: 'open', name, line: day.confirmed ? 'Trained, not logged yet' : 'Ticked as trained, not logged yet', action: { kind: 'log', label: 'Log session' }, reason: explain(false, 'day.session', inputs, { note: `${said} but nothing is logged: log ${clean(sess.name)} so its numbers count.` }).reason };
  }
  return { id: 'session', icon: 'dumbbell', state: 'open', name, line: planned, action: { kind: 'log', label: 'Log session' }, reason: explain(false, 'day.session', inputs, { note: `Today’s session is ${clean(sess.name)} (${sess.type})${minutes ? `, about ${minutes} minutes` : ''}: log it after training.` }).reason };
}

/**
 * The supplements, ticks and amounts due today (the evening ones too): done
 * of total, what is open now and the next card. An "after training" item
 * waits for the session (its card comes once one is logged).
 */
function habitsStep(due: DueToday, trained: boolean): Draft | null {
  const items = due.habits.slots.flatMap((sl) => sl.items.map((it) => ({ name: it.name, done: it.done, at: it.later && !it.done ? sl.time : null, after: sl.key === 'after-log' && !trained && !it.done })));
  // An amount's card at the time it is now (one overdue) is open now, not next.
  const amounts = due.amounts.map((a) => ({ name: a.name, done: a.met, at: !a.met && a.next && a.next > due.now ? a.next : null, after: false }));
  const all = [...items, ...amounts];
  if (!all.length) return null;
  const done = all.filter((x) => x.done).length;
  const total = all.length;
  const name = `Habits: ${done} of ${total}`;
  const coming = all.filter((x) => x.at !== null).sort((a, b) => a.at!.localeCompare(b.at!));
  const nextAt = coming[0]?.at ?? null;
  const nextNames = coming.filter((x) => x.at === nextAt).map((x) => inLine(x.name));
  const afterNames = all.filter((x) => x.after).map((x) => inLine(x.name));
  const now = all.filter((x) => !x.done && x.at === null && !x.after).map((x) => inLine(x.name));
  const inputs = { done, total, open: now, next: nextAt ? { at: nextAt, items: nextNames } : null, afterTraining: afterNames, now: due.now };
  if (done === total) return { id: 'habits', icon: 'pill', state: 'done', word: 'Done', name, line: 'Everything ticked today', action: null, reason: explain(true, 'day.habits', inputs, { note: `All ${total} of today’s supplements, ticks and amounts are done.` }).reason };
  const nowText = now.length ? `${now.length > 2 ? `${now[0]} and ${now.length - 1} more` : and(now)} open` : null;
  const nextText = nextAt ? `next: ${and(nextNames)} at ${nextAt}` : afterNames.length ? `next: ${and(afterNames)} after training` : null;
  return {
    id: 'habits', icon: 'pill', state: 'open', name,
    line: cap([nowText, nextText].filter(Boolean).join(' · ')),
    action: { kind: 'due', label: 'Due today' },
    reason: explain(false, 'day.habits', inputs, { note: `${done} of ${total} of today’s supplements, ticks and amounts done (Due today’s, the evening ones too).${now.length ? ` Open now: ${and(now)}.` : ''}${nextAt ? ` The next card: ${and(nextNames)} at ${nextAt}.` : ''}${afterNames.length ? ` After training: ${and(afterNames)}.` : ''}` }).reason,
  };
}

/** The Food tab's day: the protein tick from the eating plan's item, else a protein item alone; quiet with neither. */
function foodStep(food: Food, due: DueToday | null, items: readonly TrackedItem[]): Draft {
  const open: DayAction = { kind: 'food', label: 'Open Food' };
  if (food.plan) {
    const floor = food.plan.protein.floorG;
    const item = food.protein?.item ?? null;
    const st = food.protein?.today?.state ?? null;
    const inputs = { plan: true, item: item?.id ?? null, state: st, floorG: floor };
    if (!item) return { id: 'food', icon: 'bowl', state: 'quiet', word: 'No item yet', name: 'Food', line: `Protein ${floor} g a day, no item to tick yet`, action: open, reason: explain(null, 'day.food', inputs, { note: `Your eating plan asks for ${floor} g of protein a day, but no protein item is tracked to tick: the coach adds one. Not counted.` }).reason };
    if (st === 'ticked') return { id: 'food', icon: 'bowl', state: 'done', word: 'Done', name: 'Food', line: 'Protein ticked', action: open, reason: explain(true, 'day.food', inputs, { note: `The protein item is ticked today: ${floor} g or more.` }).reason };
    return { id: 'food', icon: 'bowl', state: 'open', name: 'Food', line: `Protein: ${floor} g target, open`, action: open, reason: explain(false, 'day.food', inputs, { note: `Tick the protein item tonight if you got to ${floor} g${item.tickAt ? `; the ${item.tickAt} card asks too` : ''}.` }).reason };
  }
  // No eating plan: a protein item tracked on its own still makes the step.
  const it = items.find((x) => isProteinItem(x)) ?? null;
  const today = it ? due?.habits.slots.flatMap((sl) => sl.items).find((x) => x.id === it.id) ?? null : null;
  const goal = it?.goal ? `${it.goal.amount} ${it.goal.unit}` : null;
  const inputs = { plan: false, item: it?.id ?? null, due: today ? today.done : null };
  if (it && today) {
    if (today.done) return { id: 'food', icon: 'bowl', state: 'done', word: 'Done', name: 'Food', line: 'Protein ticked', action: open, reason: explain(true, 'day.food', inputs, { note: `No eating plan yet; the ${it.name} item is ticked today.` }).reason };
    return { id: 'food', icon: 'bowl', state: 'open', name: 'Food', line: goal ? `Protein: ${goal} target, open` : 'Protein: open', action: open, reason: explain(false, 'day.food', inputs, { note: `No eating plan yet; the ${it.name} item is open today${it.reminder?.at ? `, its card at ${it.reminder.at}` : ''}.` }).reason };
  }
  return { id: 'food', icon: 'bowl', state: 'quiet', word: 'No plan yet', name: 'Food', line: 'No eating plan yet', action: open, reason: explain(null, 'day.food', inputs, { note: `No eating plan and no protein item yet: the coach makes the plan with you (${COACH_COMMANDS.ask} diet). Not counted.` }).reason };
}

/** On a coach step's Sunday: the Sunday check-in, then the coach, as coachSteps has it. */
function sundayStep(m: Today): Draft | null {
  const now = m.coach.now;
  const c = now?.value;
  if (!now || !c || c.date !== m.date) return null;
  const name = 'Sunday check-in';
  if (c.state === 'done') return { id: 'sunday', icon: 'mail', state: 'done', word: 'Done', name, line: c.line, action: null, reason: now.reason };
  if (c.state === 'answer-first') return { id: 'sunday', icon: 'mail', state: 'open', name, line: `Then ask the coach for ${stepWords(c)}`, action: { kind: 'checkin', label: 'Open check-in' }, reason: now.reason };
  return { id: 'sunday', icon: 'mail', state: 'open', name, line: `Saved: ask the coach for ${stepWords(c)}`, action: { kind: 'copy', label: 'Copy', command: c.command }, reason: now.reason };
}

/**
 * Your day for Today: null without a plan (Today has no screen then). The
 * steps in the day's order; the first one not done is next. Rest days (the
 * plan's or a mark) and a day marked missed count as done; a food step with
 * no eating plan and no protein item is quiet and not counted.
 */
export function yourDay(m: Today, x: YourDayExtras): Result<YourDay> | null {
  if (!m.review) return null;
  const drafts = [
    morningStep(m, x.due, x.clock),
    sessionStep(m, x),
    x.due ? habitsStep(x.due, m.week.find((d) => d.today)?.state === 'trained') : null,
    x.food ? foodStep(x.food, x.due, x.items ?? []) : null,
    sundayStep(m),
  ].filter((d): d is Draft => d !== null);
  const nextId = drafts.find((d) => d.state === 'open')?.id ?? null;
  const steps: DayStep[] = drafts.map((d) => {
    const state: DayStepState = d.state === 'open' ? (d.id === nextId ? 'next' : 'open') : d.state;
    return { ...d, state, word: d.word ?? (state === 'next' ? 'Next' : 'Open') };
  });
  const counted = steps.filter((s) => s.state !== 'quiet');
  const done = counted.filter((s) => s.state === 'done').length;
  const next = steps.find((s) => s.state === 'next') ?? null;
  const value: YourDay = { date: m.date, kicker: `Your day · ${dayText(m.date)}`, done, total: counted.length, count: `${done} of ${counted.length} done`, steps, next: next?.id ?? null };
  return explain(value, 'day.steps', { date: m.date, steps: steps.map((s) => [s.id, s.state]), due: x.due !== null, food: x.food !== null }, {
    note: `The day’s steps with Pahlavan in the day’s order: ${done} of ${counted.length} done${next ? `, next: ${next.name}` : ''}. The next is the first not done yet; a rest day counts as done, and a step with nothing to do yet is not counted.`,
  });
}
