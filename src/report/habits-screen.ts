// The reports behind three stage 3.5 screens: Progress's Habits section
// (every tracked item in words, its stats, the tiles, the coach's open
// suggestions and the one-time bring-over from Habit Nudges), Check-in's
// Body record card (the tape, photos and tests with their last entry, next
// date and schedule) and the Plan's Desk breaks card. Built from session 1's
// reports (buildTracked, buildHabitStats, buildBringOver) and rules
// (bodyParts, planDeskBreaks, deskRoutine). Pure: the date is an input.

import { bodyUnitsOf, inLength, METRIC, type BodyUnits } from '../core/units.ts';
import { POSES, TAPE_FIELDS, TEST_FIELDS } from '../adapters/vault/body-write.ts';
import type { VaultRead } from '../adapters/vault/read.ts';
import type { TrackingRead } from '../adapters/vault/tracking-read.ts';
import type { BodyPart } from '../core/body-schedule.ts';
import { addDays, daysBetween, type IsoDate } from '../core/dates.ts';
import { deskHours, deskRoutine, deskTimes, planDeskBreaks, WORKDAYS, type DeskRoutine } from '../core/desk-breaks.ts';
import { bodyParts } from '../core/nudges.ts';
import { WEEKDAYS, type ItemKind, type Program, type TrackedItem, type Weekday } from '../core/schema.ts';
import { pauseNow, scheduleText } from '../core/tracking.ts';
import { scopeInfo } from './cycle.ts';
import { amountText, buildBringOver, buildHabitStats, buildTracked, deskOf, reminderText, sourceText } from './tracking.ts';

/** The Habits list's groups, in the order the section shows them. */
export const HABIT_GROUPS: readonly { id: string; label: string; kinds: readonly ItemKind[] }[] = [
  { id: 'supplements', label: 'Supplements', kinds: ['supplement'] },
  { id: 'amounts', label: 'Amounts and ticks', kinds: ['amount', 'tick'] },
  { id: 'desk', label: 'At the desk', kinds: ['standup', 'sitting', 'desk'] },
];

export const KIND_LABEL: Record<ItemKind, string> = { supplement: 'Supplement', amount: 'Amount', tick: 'Tick', standup: 'Stand-ups', desk: 'Desk breaks', sitting: 'Sitting time' };

const WHEN_WORD: Record<string, string> = { morning: 'morning', midday: 'midday', evening: 'evening', bedtime: 'bedtime', time: 'at a set time', day: 'through the day' };

/** When in the day, in words: "morning", "after the session", "09:00 to 17:30", "all day"; a desk-break item's routine hours (deskRoutine's), "10:00 to 16:30, from your plan" when it follows the plan. */
export function whenText(item: TrackedItem, desk?: Pick<DeskRoutine, 'from' | 'to' | 'source'> | null): string {
  if (item.kind === 'standup') return item.standup!.hours ? `${item.standup!.hours[0]} to ${item.standup!.hours[1]}` : 'all day';
  if (item.kind === 'desk') return deskHours(desk ?? { ...item.desk!, source: 'item' });
  if (item.kind === 'sitting') return 'all day';
  if (item.when === 'training') return `${item.whenDetail === 'before' ? 'before' : 'after'} the session`;
  return WHEN_WORD[item.when ?? ''] ?? 'any time';
}

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** A short line for a suggestion or a bring-over row: what it asks for and when ("5 g every morning"); a desk-break item on the plan's times when it follows the plan (`program`). */
export function suggestionDetail(item: TrackedItem, program: Pick<Program, 'deskBreaks'> | null = null): string {
  const asks = amountText(item, deskOf(item, program));
  const sched = scheduleText(item.schedule);
  if (item.kind === 'supplement' || item.kind === 'tick') return [asks, `${sched}, ${whenText(item)}`].filter(Boolean).join(', ');
  return asks || sched;
}

// ================================================================ Habits

/**
 * Progress's Habits section. `homepage` is null when habits-data.json does
 * not exist (the link to a linked habit is offered only when it does);
 * `bringOver` is null unless Habit Nudges' settings exist, nothing was
 * brought over yet and something on offer is not tracked already.
 */
export function buildHabitsScreen(read: VaultRead, tr: TrackingRead, date: IsoDate, opts: { offsetMinutes?: number } = {}) {
  const data = read.data;
  const tracked = buildTracked(data, tr, date);
  const stats = buildHabitStats(data, tr, date, opts);
  const homepage = tr.files.habits === 'found' && tr.habits ? tr.habits.habits.map((x) => ({ id: x.id, name: x.name ?? x.id, type: x.type ?? null })) : null;
  const habitName = (id: string | null) => (id ? (homepage?.find((x) => x.id === id)?.name ?? id) : null);
  const items = tracked.items.map((t) => {
    const st = stats.items.find((x) => x.item === t.id)!;
    const it = t.item;
    const desk = t.kind === 'desk' && t.desk ? t.desk : null;
    const quick = it.kind === 'amount' ? (it.amount!.quick ?? []) : [];
    const target = it.kind === 'amount' ? it.amount!.target : it.kind === 'standup' ? it.standup!.targetMinutes : it.kind === 'desk' ? (desk?.times.length ?? deskTimes(it.desk!).length) : null;
    const unit = it.kind === 'amount' ? it.amount!.unit : it.kind === 'standup' ? 'min' : it.kind === 'desk' ? 'breaks' : null;
    return {
      id: t.id,
      kind: t.kind,
      name: t.name,
      dose: it.dose ?? null,
      schedule: cap(t.schedule),
      when: whenText(it, desk),
      asks: t.kind === 'desk' && desk ? `${desk.steps.length} steps, about ${desk.minutes} min` : t.asks,
      /** A desk-break item's routine as it runs (the plan's when it follows the plan, `source: plan`), else null. */
      desk: desk ? { every: desk.every, from: desk.from, to: desk.to, times: desk.times, source: desk.source } : null,
      reminder: t.reminder,
      habit: t.habit,
      habitName: habitName(t.habit),
      /** The day the stats count from: the item's start (a linked habit's earlier ticks are not counted). */
      countsFrom: t.start,
      source: { ...it.source, text: sourceText(it) },
      paused: t.paused,
      note: t.note,
      start: t.start,
      measure: target !== null && unit !== null ? { target, unit, quick, value: st.today.value ?? 0 } : null,
      sitting: it.kind === 'sitting' ? { limit: it.sitting!.limitMinutes, stretchMax: it.sitting!.stretchMaxMinutes, today: st.today.sitting ?? { minutes: 0, longest: 0 }, bars: st.sitting ?? [] } : null,
      /** Stand-ups and desk breaks: the last 4 weeks' daily amounts against the day's target. */
      bars: st.bars ?? null,
      streak: { value: st.streak.value, unit: st.unit, reason: st.streak.reason },
      adherence: { ...st.adherence.value, reason: st.adherence.reason },
      grid: st.grid,
      today: st.today,
      item: it,
    };
  });
  const groups = HABIT_GROUPS.map((g) => ({ ...g, items: items.filter((x) => g.kinds.includes(x.kind)) })).filter((g) => g.items.length);
  const open = (tr.tracking?.suggestions ?? []).filter((s) => s.state === 'open');
  const suggestions = open.map((s) => ({ id: s.id, on: s.on, kind: s.item.kind, name: s.item.name, detail: suggestionDetail(s.item, data.program), why: s.item.source.why ?? null, item: s.item }));
  const bring = buildBringOver(data, tr, date);
  const offered = bring.offer.value.items;
  const showBring = bring.settingsFound && !bring.done && offered.some((x) => !x.already);
  const coachToo = new Set(open.map((s) => s.item.kind === 'supplement' || s.item.kind === 'tick' ? s.item.name.toLowerCase() : s.item.kind));
  return {
    date,
    /** Coach/tracking.json exists (the first save makes it otherwise). */
    exists: tr.files.tracking !== 'missing',
    items,
    groups,
    counts: { coach: items.filter((x) => x.source.by === 'coach').length, user: items.filter((x) => x.source.by === 'user').length },
    tiles: stats.tiles,
    suggestions,
    homepage,
    /** The plan's desk breaks (a desk-break item that follows the plan takes its routine from here). */
    planDesk: data.program.deskBreaks ?? null,
    bringOver: showBring
      ? {
          items: offered.map((x) => ({ id: x.item.id, name: x.item.name, kind: x.item.kind, detail: x.detail, habitName: x.habitName, checked: x.checked, already: x.already, coachToo: coachToo.has(x.item.kind === 'supplement' || x.item.kind === 'tick' ? x.item.name.toLowerCase() : x.item.kind), item: x.item })),
          left: bring.offer.value.left,
          morning: bring.offer.value.morning,
          bodyRecord: bring.offer.value.bodyRecord,
          reason: bring.offer.reason,
        }
      : null,
    /** Pahlavan's own files that are unreadable or invalid: nothing is written until they are fixed. */
    errors: tr.errors,
    warnings: tr.warnings,
    reason: stats.reason,
  };
}

// ================================================================ Body record

const TAPE_SHOWN = TAPE_FIELDS.map((f) => f.id);
const TEST_SHORT: Record<string, [string, string]> = { pushups: ['push-ups', ''], pullups: ['pull-ups', ''], hollowS: ['hollow', ' s'], sidePlankS: ['side plank', ' s'], handstandS: ['handstand', ' s'], wallGapCm: ['wall test', ' cm'], pullupLevel: ['pull-up level', ''], pistol: ['pistol', ''] };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const entries = (body: unknown, key: string): Obj[] => (isObj(body) && Array.isArray(body[key]) ? (body[key] as unknown[]).filter(isObj) : []).filter((e) => typeof e['date'] === 'string');

/** One entry in words: "waist 93.6, hips 96.4, chest 101.5, arm 33.5 cm", "3 of 4 poses", "push-ups 17, pull-ups 1, hollow 36 s". */
export function entryText(part: BodyPart, e: Obj | null, units: BodyUnits = METRIC): string {
  if (!e) return '';
  const len = (cm: number) => (units.length === 'cm' ? cm : Math.round(inLength(cm, units) * 10) / 10);
  if (part === 'tape') {
    const vals = TAPE_SHOWN.filter((k) => typeof e[k] === 'number').map((k) => `${k} ${len(e[k] as number)}`);
    return vals.length ? `${vals.join(', ')} ${units.length}` : 'no measures';
  }
  if (part === 'photos') {
    const n = Array.isArray(e['poses']) ? (e['poses'] as unknown[]).filter((p) => POSES.some((x) => x.id === p)).length : 0;
    return n ? `${n} of ${POSES.length} poses` : 'a dated folder';
  }
  const vals = TEST_FIELDS.map((f) => f.id).filter((k) => e[k] !== undefined && e[k] !== null && e[k] !== '').slice(0, 3).map((k) => (k === 'wallGapCm' && typeof e[k] === 'number' ? `wall test ${len(e[k])} ${units.length}` : `${TEST_SHORT[k]![0]} ${String(e[k])}${TEST_SHORT[k]![1]}`));
  return vals.join(', ') || 'no results';
}

const PART_TITLE: Record<BodyPart, string> = { tape: 'Tape', photos: 'Photos', tests: 'Fitness tests' };

/**
 * Check-in's Body record card: each part with whether it is due, its next
 * date, its last entry, and where its schedule comes from (the plan, or
 * every N days, the user's own). `setting` is the schedule as resolved,
 * for the schedule switch; `hasPlan` says whether "From the plan" can apply.
 */
export function buildBodyRecord(read: VaultRead, tr: TrackingRead, date: IsoDate) {
  const program = read.data.program;
  const parts = bodyParts({ tracking: tr.tracking, nudges: tr.nudges, body: tr.body, photoFolders: tr.photoFolders, program }, date);
  // The last entry shown is this cycle's: one from before the cycle start reads "None yet". The schedule itself is unchanged.
  const since = scopeInfo(read.data, date).since;
  const lastOf = (part: BodyPart) => {
    const d = parts[part].value.last;
    return d && (!since || d >= since) ? d : null;
  };
  const hasPlan = program.macrocycle.phases.some((p) => p.mesocycles.some((m) => m.weeks.length > 0));
  const units = bodyUnitsOf(read.data.profile).value;
  const setting = tr.tracking?.bodyRecord ?? null;
  const tape = parts.tape.value.schedule;
  const tests = parts.tests.value.schedule;
  const fixed = {
    tapeFrom: setting?.tapeFrom ?? lastOf('tape') ?? date,
    tapeEvery: setting?.tapeEvery ?? 14,
    testsFrom: setting?.testsFrom ?? lastOf('tests') ?? date,
    testsEvery: setting?.testsEvery ?? 28,
  };
  const list = (['tape', 'photos', 'tests'] as const).map((part) => {
    const p = parts[part].value;
    const all = entries(tr.body, part).filter((e) => (e['date'] as string) <= date).sort((a, b) => ((a['date'] as string) < (b['date'] as string) ? -1 : 1));
    const lastEntry = all.at(-1) ?? null;
    // A dated photo folder without an index entry still counts as the last photo day.
    const lastDate = lastOf(part);
    const e = lastEntry && lastEntry['date'] === lastDate ? lastEntry : null;
    return {
      part,
      title: PART_TITLE[part],
      due: p.due,
      occurrence: p.occurrence,
      skipped: p.skipped,
      nextDate: p.nextDate,
      inDays: p.inDays,
      last: lastDate ? { date: lastDate, text: e ? entryText(part, e, units) : part === 'photos' ? 'a dated folder' : '' } : null,
      schedule: { source: p.schedule.source, text: p.schedule.text, next: p.schedule.next },
      reason: parts[part].reason,
    };
  });
  return {
    date,
    parts: list,
    source: tape.source,
    setting,
    fixed,
    hasPlan,
    /** The tape's next date for the Check-in banner: the due occurrence, else the next. */
    tapeNext: parts.tape.value.nextDate,
    tapeText: tape.text,
    testsText: tests.text,
    canWrite: tr.files.tracking !== 'invalid',
  };
}

// ================================================================ Desk breaks on the Plan

const DAY_NAME: Record<Weekday, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

/** Days in words: "weekdays", "every day", "Mon, Wed, Fri". */
export function daysText(days: readonly Weekday[]): string {
  if (days.length === 7) return 'every day';
  if (days.length === 5 && WORKDAYS.every((d) => days.includes(d))) return 'weekdays';
  return WEEKDAYS.filter((d) => days.includes(d)).map((d) => DAY_NAME[d]).join(', ');
}

/**
 * The Plan's Desk breaks card: the plan's routine (steps, how often, the
 * hours and days, its Why) and the desk-break item that takes it into
 * Habits, or "No desk breaks in this plan" with the item's own routine
 * when there is one.
 */
export function buildDeskCard(read: VaultRead, tr: TrackingRead | null, date: IsoDate) {
  const program = read.data.program;
  const plan = planDeskBreaks(program);
  const items = (tr?.tracking?.items ?? []).filter((x) => x.kind === 'desk');
  const item = items.find((x) => x.desk!.followPlan) ?? items[0] ?? null;
  const routine = item ? deskRoutine(item, program) : null;
  const d = plan.value;
  // The plan's own reasons; for a routine without them (this vault's plan-data), the desk-break item's.
  const why = d?.why?.length ? d.why : item?.source.why ? [{ what: item.source.why, from: '' }] : [];
  return {
    date,
    plan: d ? { steps: d.steps, every: d.every, from: d.from, to: d.to, minutes: d.minutes, days: d.days, daysText: daysText(d.days), times: deskTimes(d), why } : null,
    reason: plan.reason,
    item: item
      ? {
          id: item.id,
          name: item.name,
          followPlan: item.desk!.followPlan,
          accepted: item.source.on ?? item.start,
          start: item.start,
          paused: pauseNow(item, date),
          own: routine && routine.value.source === 'item' ? { steps: routine.value.steps, every: routine.value.every, from: routine.value.from, to: routine.value.to, times: routine.value.times } : null,
          reason: routine?.reason ?? null,
        }
      : null,
  };
}

/** Days until a date ("today", "tomorrow", "in 3 days", "2 days ago"). */
export function inDaysText(today: IsoDate, d: IsoDate): string {
  const n = daysBetween(today, d);
  return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n > 0 ? `in ${n} days` : n === -1 ? 'yesterday' : `${-n} days ago`;
}

/** The Sunday on or after the date (the Sunday check-in's day). */
export const sundayOf = (date: IsoDate): IsoDate => {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, (7 - dow) % 7);
};

export { reminderText };
