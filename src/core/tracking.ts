// Tracked items (Coach/tracking.json): when each is due, what a day holds,
// and the stats Progress shows (streak, 30-day adherence, the 26-week grid,
// sitting against its limits, stand-ups' minutes from the card and at the
// desk). An item linked to a linked habit reads that habit too: a tick on
// either counts and an amount takes the larger, from the item's start on.
// Every stat counts from the item's start: a day before it is "none" (not
// started), whatever the linked habit or the work timer holds for it.

import { addDays, dayText, daysBetween, mondayOf, type IsoDate } from './dates.ts';
import { deskTimes, type DeskRoutine } from './desk-breaks.ts';
import { explain, type Result } from './reason.ts';
import { sittingVerdict, type SittingDay } from './sitting.ts';
import { WEEKDAYS, type ItemDay, type ItemSchedule, type TrackedItem, type Tracking, type Weekday } from './schema.ts';

// ---------------------------------------------------------------- the linked habit keys

/** The ISO week key the homepage grid uses: "2026-W15" (week not zero-padded). */
export function isoWeekKey(date: IsoDate): string {
  const monday = mondayOf(date);
  const thursday = addDays(monday, 3);
  const year = Number(thursday.slice(0, 4));
  return `${year}-W${Math.floor(daysBetween(`${year}-01-01`, thursday) / 7) + 1}`;
}

/** habits-data.json's key for a habit on a date: hab-<id>-<ISO year>-W<week>-<day, 0 = Monday>. */
export function habitCheckinKey(habit: string, date: IsoDate): string {
  return `hab-${habit}-${isoWeekKey(date)}-${daysBetween(mondayOf(date), date)}`;
}

/** The weekday of a date. */
export const weekdayOf = (date: IsoDate): Weekday => WEEKDAYS[daysBetween(mondayOf(date), date)]!;

// ---------------------------------------------------------------- the settings in force on a day

/**
 * The item as it stood on `date`: an `earlier` version in force then
 * replaces the schedule and the kind's settings (a change applies from the
 * day after its `until`).
 */
export function itemOn(item: TrackedItem, date: IsoDate): TrackedItem {
  const v = (item.earlier ?? []).find((e) => date <= e.until);
  if (!v) return item;
  const out: TrackedItem = { ...item };
  if (v.schedule) out.schedule = v.schedule;
  if (v.amount) out.amount = v.amount;
  if (v.standup) out.standup = v.standup;
  if (v.sitting) out.sitting = v.sitting;
  if (v.desk) out.desk = v.desk;
  return out;
}

/** Paused on that day (a pause runs from its first day through `to`, or on while open). */
export function pausedOn(item: Pick<TrackedItem, 'pauses'>, date: IsoDate): boolean {
  return (item.pauses ?? []).some((p) => date >= p.from && (!p.to || date <= p.to));
}

/** Paused today, and since when. */
export function pauseNow(item: Pick<TrackedItem, 'pauses'>, today: IsoDate): IsoDate | null {
  const p = (item.pauses ?? []).find((x) => today >= x.from && (!x.to || today <= x.to));
  return p ? p.from : null;
}

/** Whether a day is a training day: a session logged; for today, also one planned. */
export interface TrainingDays {
  logged: ReadonlySet<IsoDate>;
  /** Today's plan has a session (a reminder before it, or a rest-day item staying quiet). */
  plannedToday?: boolean;
  today: IsoDate;
}

export type ScheduleState = 'none' | 'paused' | 'future' | 'off' | 'due';

/** Whether the schedule falls on the day (not counting the start, pauses or the future). */
export function scheduleHits(sc: ItemSchedule, start: IsoDate, date: IsoDate, training: TrainingDays): boolean {
  switch (sc.kind) {
    case 'daily':
      return true;
    case 'weekdays':
      return (sc.days ?? []).includes(weekdayOf(date));
    case 'every': {
      const n = sc.n ?? 1;
      const d = daysBetween(sc.from ?? start, date);
      return d >= 0 && d % n === 0;
    }
    case 'training':
      return training.logged.has(date) || (date === training.today && training.plannedToday === true);
    case 'rest':
      return !(training.logged.has(date) || (date === training.today && training.plannedToday === true));
  }
}

/**
 * The item on a day: before its start ("none"), paused, after today
 * ("future"), not one of its days ("off"), or due. A desk-break item that
 * follows the plan runs on the plan's days (`desk.days`).
 */
export function scheduled(item: TrackedItem, date: IsoDate, training: TrainingDays, desk?: Pick<DeskRoutine, 'days'> | null): ScheduleState {
  if (date < item.start) return 'none';
  if (pausedOn(item, date)) return 'paused';
  if (date > training.today) return 'future';
  const it = itemOn(item, date);
  if (it.kind === 'desk' && desk?.days) return desk.days.includes(weekdayOf(date)) ? 'due' : 'off';
  return scheduleHits(it.schedule, it.start, date, training) ? 'due' : 'off';
}

/** The schedule in words: "every day", "training days", "Mon, Wed, Fri", "weekdays", "every 2 days". */
export function scheduleText(sc: ItemSchedule): string {
  if (sc.kind === 'weekdays') {
    const days = WEEKDAYS.filter((d) => (sc.days ?? []).includes(d));
    if (days.length === 5 && !days.includes('sat') && !days.includes('sun')) return 'weekdays';
    if (days.length === 7) return 'every day';
    return days.map((d) => d[0]!.toUpperCase() + d.slice(1)).join(', ');
  }
  if (sc.kind === 'every') return `every ${sc.n} days`;
  return { daily: 'every day', training: 'training days', rest: 'rest days' }[sc.kind];
}

// ---------------------------------------------------------------- what a day holds

/** habits-data.json, parsed: the homepage's habits (id, type) and its check-ins. */
export interface HabitsView {
  habits: { id: string; name?: string; type?: string; max?: number }[];
  checkins: Record<string, unknown>;
}

export function habitsView(raw: unknown): HabitsView | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const habits = Array.isArray(o['habits']) ? (o['habits'] as unknown[]).filter((h): h is HabitsView['habits'][number] => typeof h === 'object' && h !== null && typeof (h as { id?: unknown }).id === 'string') : [];
  const checkins = typeof o['checkins'] === 'object' && o['checkins'] !== null ? (o['checkins'] as Record<string, unknown>) : {};
  return { habits, checkins };
}

/** A linked habit's value on a day: 1 or 0 for a tick (the homepage's "the key exists"), the number for an amount; null without one. */
export function habitValue(habits: HabitsView | null, habit: string | undefined, date: IsoDate): number | null {
  if (!habits || !habit) return null;
  const v = habits.checkins[habitCheckinKey(habit, date)];
  if (v === undefined || v === null || v === '') return null;
  const def = habits.habits.find((h) => h.id === habit);
  if (def?.type === 'numeric') {
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : 0;
  }
  return v ? 1 : 0;
}

/** What one day holds for an item: done, or the value against its target, and where it came from. */
export interface DayValue {
  done: boolean;
  /** Amounts: the day's amount; stand-ups: minutes standing; desk breaks: breaks done. */
  value: number | null;
  target: number | null;
  /** Stand-ups finished. */
  count: number | null;
  /**
   * Stand-ups: of `value`, the minutes stood at the desk with "Standing now"
   * on (the day's `deskMinutes`); the rest came from the stand-up card. Null
   * for the other kinds.
   */
  desk: number | null;
  /** The tick or the last change, from Pahlavan's log. */
  at: string | null;
  /** Where the value came from: Pahlavan's log, the linked habit, or nothing yet. */
  via: 'pahlavan' | 'habit' | null;
}

export interface DayContext {
  tracking: Pick<Tracking, 'days'> | null;
  habits: HabitsView | null;
  /** A desk-break item's routine (the plan's or its own) for its daily number of breaks. */
  desk?: Pick<DeskRoutine, 'times' | 'days'> | null;
}

/** The day's record in Pahlavan's log. */
export const logDay = (tracking: Pick<Tracking, 'days'> | null, item: string, date: IsoDate): ItemDay | null => tracking?.days[date]?.[item] ?? null;

/** The target that day: an amount's, the stand-up minutes, the day's number of desk breaks; null for ticks and sitting. */
export function targetOn(item: TrackedItem, date: IsoDate, desk?: Pick<DeskRoutine, 'times'> | null): number | null {
  const it = itemOn(item, date);
  if (it.kind === 'amount') return it.amount?.target ?? null;
  if (it.kind === 'standup') return it.standup?.targetMinutes ?? null;
  if (it.kind === 'desk') return desk?.times.length ?? (it.desk ? deskTimes(it.desk).length : null);
  return null;
}

export function dayValue(item: TrackedItem, date: IsoDate, ctx: DayContext): DayValue {
  const own = logDay(ctx.tracking, item.id, date);
  const linked = item.kind === 'desk' || item.kind === 'sitting' ? null : habitValue(ctx.habits, item.habit, date);
  const target = targetOn(item, date, ctx.desk);
  const at = own?.at ?? null;
  if (item.kind === 'supplement' || item.kind === 'tick') {
    const mine = own?.done === true;
    const theirs = linked !== null && linked > 0;
    return { done: mine || theirs, value: null, target: null, count: null, desk: null, at, via: mine ? 'pahlavan' : theirs ? 'habit' : null };
  }
  const mine = item.kind === 'amount' ? own?.amount : item.kind === 'standup' ? own?.minutes : own?.count;
  const a = typeof mine === 'number' ? mine : null;
  const value = a === null && linked === null ? null : Math.max(a ?? 0, linked ?? 0);
  const via = value === null ? null : linked !== null && linked > (a ?? 0) ? 'habit' : 'pahlavan';
  // The desk minutes are counted in the day's minutes, so never more than them.
  const desk = item.kind === 'standup' ? Math.min(own?.deskMinutes ?? 0, value ?? 0) : null;
  return { done: value !== null && target !== null && value >= target, value, target, count: item.kind === 'standup' ? (own?.count ?? null) : null, desk, at, via };
}

// ---------------------------------------------------------------- day states

/**
 * A day as the grid colours it. Ticks and supplements: taken, missed, or
 * open (today, not yet). Counted items: taken at the target, part at half
 * or more, missed below; today open until met. Sitting: taken within both
 * limits, part with one over, missed with both; today open.
 */
export type CellState = 'taken' | 'part' | 'missed' | 'open' | 'off' | 'paused' | 'none' | 'future';

export interface DayCell {
  date: IsoDate;
  state: CellState;
  value?: number;
  target?: number;
  via?: 'pahlavan' | 'habit' | 'desk-time';
  at?: string;
  /** Stand-ups: of `value`, the minutes stood at the desk ("Standing now"), when there were any. */
  desk?: number;
  /** Sitting: minutes and the longest stretch. */
  sitting?: { minutes: number; longest: number };
}

export interface StatsContext extends DayContext {
  training: TrainingDays;
  /** Sitting per day (Pahlavan's count, else desk time), for sitting items. */
  sitting?: ReadonlyMap<IsoDate, SittingDay>;
}

export function dayCell(item: TrackedItem, date: IsoDate, ctx: StatsContext): DayCell {
  const sc = scheduled(item, date, ctx.training, ctx.desk);
  if (sc !== 'due') return { date, state: sc };
  const today = date === ctx.training.today;
  if (item.kind === 'sitting') {
    // A day with nothing counted (no stretches, no desk time) is 0 minutes: within both limits.
    const day = ctx.sitting?.get(date) ?? { date, minutes: 0, longest: 0, stretches: 0, source: 'none' as const };
    const cell: DayCell = { date, state: 'open', sitting: { minutes: day.minutes, longest: day.longest } };
    if (day.source !== 'none') cell.via = day.source === 'desk-time' ? 'desk-time' : 'pahlavan';
    if (today) return cell;
    const v = sittingVerdict(day, itemOn(item, date).sitting!).value;
    return { ...cell, state: v.over === 0 ? 'taken' : v.over === 1 ? 'part' : 'missed' };
  }
  const v = dayValue(item, date, ctx);
  const cell: DayCell = { date, state: 'missed' };
  if (v.via) cell.via = v.via;
  if (v.at) cell.at = v.at;
  if (item.kind === 'supplement' || item.kind === 'tick') {
    cell.state = v.done ? 'taken' : today ? 'open' : 'missed';
    return cell;
  }
  if (v.value !== null) cell.value = v.value;
  if (v.target !== null) cell.target = v.target;
  if (v.desk) cell.desk = v.desk;
  const f = v.target ? (v.value ?? 0) / v.target : 0;
  cell.state = f >= 1 ? 'taken' : today ? 'open' : f >= 0.5 ? 'part' : 'missed';
  return cell;
}

// ---------------------------------------------------------------- stats

/** Days (or sessions, for training-day items) in a row: today and back, skipping days off, paused days and today while open. */
export function streak(item: TrackedItem, ctx: StatsContext): Result<number> {
  let n = 0;
  let broke: IsoDate | null = null;
  for (let d = ctx.training.today; d >= item.start; d = addDays(d, -1)) {
    const c = dayCell(item, d, ctx);
    if (c.state === 'open' || c.state === 'off' || c.state === 'paused' || c.state === 'future') continue;
    if (c.state !== 'taken') {
      broke = d;
      break;
    }
    n++;
  }
  const unit = item.schedule.kind === 'training' ? 'sessions' : 'days';
  return explain(n, 'habits.streak', { item: item.id, today: ctx.training.today, start: item.start, brokenOn: broke }, {
    note: `${n} ${unit} in a row${item.kind === 'sitting' ? ' within limits' : ['amount', 'standup', 'desk'].includes(item.kind) ? ' at target' : ''}, counted from its start (${dayText(item.start)}); days off and paused days don't break it${broke ? `, the last miss was ${broke}` : ''}.`,
  });
}

/** The last 30 days: days done against days due (part of a target counts as due, not done). */
export function adherence30(item: TrackedItem, ctx: StatsContext, days = 30): Result<{ due: number; done: number; pct: number | null }> {
  let due = 0;
  let done = 0;
  for (let i = 0; i < days; i++) {
    const c = dayCell(item, addDays(ctx.training.today, -i), ctx);
    if (c.state === 'taken') {
      done++;
      due++;
    } else if (c.state === 'missed' || c.state === 'part') due++;
  }
  const pct = due ? done / due : null;
  const from = addDays(ctx.training.today, -(days - 1));
  const late = item.start > from ? ` since its start (${dayText(item.start)})` : '';
  return explain({ due, done, pct }, 'habits.adherence', { item: item.id, days, from, to: ctx.training.today, start: item.start }, {
    note: pct === null ? `Not due in the last ${days} days${late}.` : `${done} of ${due} days due in the last ${days}${late} (${Math.round(pct * 100)} %); today counts once it is done.`,
  });
}

/** A stand-up item's minutes over a span: in all, from the stand-up card, and stood at the desk with "Standing now" on. */
export interface StandingSplit {
  /** The days counted: due and started, today included. */
  days: number;
  minutes: number;
  /** From the stand-up card (a prompted stand): the minutes less the desk's. */
  prompted: number;
  desk: number;
  /** Days with any minutes at the desk. */
  deskDays: number;
}

/** The last 30 days' stand-up minutes, split into the card's stands and the desk's ("Standing now"), from the day records. */
export function standingSplit(item: TrackedItem, ctx: StatsContext, days = 30): Result<StandingSplit> {
  const out: StandingSplit = { days: 0, minutes: 0, prompted: 0, desk: 0, deskDays: 0 };
  for (let i = 0; i < days; i++) {
    const d = addDays(ctx.training.today, -i);
    if (scheduled(item, d, ctx.training, ctx.desk) !== 'due') continue;
    const v = dayValue(item, d, ctx);
    out.days++;
    out.minutes += v.value ?? 0;
    out.desk += v.desk ?? 0;
    if (v.desk) out.deskDays++;
  }
  out.prompted = out.minutes - out.desk;
  const from = addDays(ctx.training.today, -(days - 1));
  return explain(out, 'habits.standing', { item: item.id, days, from, to: ctx.training.today }, {
    note: out.minutes
      ? `${out.minutes} min standing on ${out.days} day(s) due in the last ${days}: ${out.prompted} from the stand-up card, ${out.desk} at the desk with Standing now on${out.desk ? ` (${out.deskDays} day${out.deskDays === 1 ? '' : 's'})` : ''}.`
      : `No standing minutes in the last ${days} days.`,
  });
}

/** The 26-week grid: Monday 25 weeks before this week through this Sunday, one cell a day. */
export function grid26(item: TrackedItem, ctx: StatsContext, weeks = 26): { from: IsoDate; to: IsoDate; cells: DayCell[] } {
  const from = addDays(mondayOf(ctx.training.today), -7 * (weeks - 1));
  const to = addDays(mondayOf(ctx.training.today), 6);
  const cells: DayCell[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) cells.push(dayCell(item, d, ctx));
  return { from, to, cells };
}

/**
 * Sitting's own chart: the last 4 weeks as daily bars against the limits, a
 * day over a limit marked. A day before the item's start is `beforeStart`
 * with nothing counted (the work timer's desk time for it is not shown).
 */
export function sittingBars(item: TrackedItem, ctx: StatsContext, days = 28): { date: IsoDate; minutes: number; longest: number; overLimit: boolean; overStretch: boolean; today: boolean; beforeStart: boolean; source: SittingDay['source'] }[] {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(ctx.training.today, -i);
    if (d < item.start) {
      out.push({ date: d, minutes: 0, longest: 0, overLimit: false, overStretch: false, today: false, beforeStart: true, source: 'none' as const });
      continue;
    }
    const day = ctx.sitting?.get(d) ?? { date: d, minutes: 0, longest: 0, stretches: 0, source: 'none' as const };
    const c = itemOn(item, d).sitting!;
    out.push({ date: d, minutes: day.minutes, longest: day.longest, overLimit: day.minutes > c.limitMinutes, overStretch: day.longest > c.stretchMaxMinutes, today: d === ctx.training.today, beforeStart: false, source: day.source });
  }
  return out;
}

/** One day of stand-ups' or desk breaks' chart. */
export interface MeasureBar {
  date: IsoDate;
  /** Minutes stood (stand-ups) or breaks done (desk breaks); 0 for a day with nothing logged. */
  value: number;
  /** The day's target (minutes, or the breaks planned that day); null on a day the item is not due. */
  target: number | null;
  /** Stand-ups: of `value`, the minutes stood at the desk ("Standing now"). */
  desk: number | null;
  /** Stand-ups: how many stands made up the minutes. */
  count: number | null;
  today: boolean;
  /** Before the item's start: nothing counted or drawn. */
  beforeStart: boolean;
}

/**
 * Stand-ups' and desk breaks' own chart, as sitting has one: the last 4
 * weeks as daily bars of the day's amount (minutes stood, with the desk's
 * share; breaks done) against the day's target, from the days the tracking
 * file keeps (or a linked habit's values, as the grid reads them).
 */
export function measureBars(item: TrackedItem, ctx: StatsContext, days = 28): MeasureBar[] {
  const out: MeasureBar[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(ctx.training.today, -i);
    const today = d === ctx.training.today;
    if (d < item.start) {
      out.push({ date: d, value: 0, target: null, desk: null, count: null, today, beforeStart: true });
      continue;
    }
    const due = scheduled(item, d, ctx.training, ctx.desk) === 'due';
    const v = dayValue(item, d, ctx);
    out.push({ date: d, value: v.value ?? 0, target: due ? v.target : null, desk: v.desk, count: v.count, today, beforeStart: false });
  }
  return out;
}

export interface ItemStats {
  item: string;
  kind: TrackedItem['kind'];
  paused: IsoDate | null;
  streak: Result<number>;
  adherence: Result<{ due: number; done: number; pct: number | null }>;
  grid: { from: IsoDate; to: IsoDate; cells: DayCell[] };
  today: DayCell;
  sitting?: ReturnType<typeof sittingBars>;
  /** Stand-ups and desk breaks: their 4-week bars. */
  bars?: MeasureBar[];
  /** Stand-ups: the last 30 days' minutes, from the card and at the desk. */
  standing?: Result<StandingSplit>;
}

export function itemStats(item: TrackedItem, ctx: StatsContext): ItemStats {
  const out: ItemStats = {
    item: item.id,
    kind: item.kind,
    paused: pauseNow(item, ctx.training.today),
    streak: streak(item, ctx),
    adherence: adherence30(item, ctx),
    grid: grid26(item, ctx),
    today: dayCell(item, ctx.training.today, ctx),
  };
  if (item.kind === 'sitting') out.sitting = sittingBars(item, ctx);
  if (item.kind === 'standup' || item.kind === 'desk') out.bars = measureBars(item, ctx);
  if (item.kind === 'standup') out.standing = standingSplit(item, ctx);
  return out;
}

/** The earliest day a linked habit has a value: where a brought-over item's history starts. */
export function firstHabitDay(habits: HabitsView | null, habit: string): IsoDate | null {
  if (!habits) return null;
  const re = new RegExp(`^hab-${habit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d{4})-W(\\d{1,2})-(\\d)$`);
  let first: IsoDate | null = null;
  for (const [k, v] of Object.entries(habits.checkins)) {
    const m = re.exec(k);
    if (!m || v === undefined || v === null || v === '' || v === '0') continue;
    const week1 = mondayOf(`${m[1]}-01-04`);
    const d = addDays(week1, 7 * (Number(m[2]) - 1) + Number(m[3]));
    if (!first || d < first) first = d;
  }
  return first;
}
