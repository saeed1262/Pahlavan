// A day as the daily wrap-up (/eod) reads it, and its ticks through
// Pahlavan: `track day` (read only) says, for one date, every tracked item
// due with its state and its linked habit, whether a session is
// logged, the "Did you train today?" answer and a rest mark, and the morning
// check-in, so the wrap-up asks only about what is still open. `track tick`
// turns its answers into the same changes Pahlavan's Due today makes
// (tickItem: a tick in Coach/tracking.json and the linked habit's tick;
// addAmount's write, here as the day's total), for the CLI to merge, write
// and read back. Pure: the date is an input.

import type { VaultData } from '../adapters/vault/convert.ts';
import type { HabitChange } from '../adapters/vault/habits-write.ts';
import type { TrackingRead } from '../adapters/vault/tracking-read.ts';
import type { TrackingOp } from '../adapters/vault/tracking-write.ts';
import { dayText, type IsoDate } from '../core/dates.ts';
import { deskRoutine } from '../core/desk-breaks.ts';
import { isMorningDone } from '../core/morning.ts';
import { checkedIn, trainingDays } from '../core/nudges.ts';
import { explain, type Result } from '../core/reason.ts';
import type { ItemKind, TrackedItem } from '../core/schema.ts';
import { dayValue, habitValue, itemOn, scheduled, type ScheduleState } from '../core/tracking.ts';
import { trainingToday } from './tracking.ts';

export interface DayItem {
  id: string;
  name: string;
  kind: ItemKind;
  /** done; not done (nothing yet, or an amount under its target); counted (sitting, which Pahlavan counts on each Mac). */
  state: 'done' | 'not done' | 'counted';
  done: boolean;
  /** Amounts: the day's amount so far; stand-ups: minutes standing; desk breaks: breaks done. */
  value: number | null;
  target: number | null;
  unit: string | null;
  /** Stand-ups: of `value`, the minutes stood at the desk with "Standing now" on; the rest came from the stand-up card. Null for the other kinds. */
  desk: number | null;
  /** Where the day's value came from: Pahlavan's log, the linked habit, or nothing yet. */
  via: 'pahlavan' | 'habit' | null;
  /** The linked habit: its id and name, and what habits-data.json holds that day. */
  habit: { id: string; name: string | null; ticked: boolean; value: number | null } | null;
  /** `track tick` can write it: supplements and ticks (--done), amounts (--amount). */
  tickable: 'done' | 'amount' | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const unitOf = (it: TrackedItem): string | null => (it.kind === 'amount' ? (it.amount?.unit ?? null) : it.kind === 'standup' ? 'min' : it.kind === 'desk' ? 'breaks' : null);

/** One item on the date: its state and the linked habit, with the reason. */
function dayItem(item: TrackedItem, date: IsoDate, data: VaultData, tr: TrackingRead): Result<DayItem> {
  const it = itemOn(item, date);
  const desk = it.kind === 'desk' ? deskRoutine(it, data.program).value : null;
  const v = dayValue(it, date, { tracking: tr.tracking, habits: tr.habits, desk });
  const hv = it.habit ? habitValue(tr.habits, it.habit, date) : null;
  const habit = it.habit ? { id: it.habit, name: tr.habits?.habits.find((h) => h.id === it.habit)?.name ?? null, ticked: hv !== null && hv > 0, value: hv } : null;
  const state = it.kind === 'sitting' ? 'counted' : v.done ? 'done' : 'not done';
  const unit = unitOf(it);
  const value: DayItem = {
    id: it.id,
    name: it.name,
    kind: it.kind,
    state,
    done: v.done,
    value: v.value,
    target: v.target,
    unit,
    desk: v.desk,
    via: v.via,
    habit,
    tickable: it.kind === 'supplement' || it.kind === 'tick' ? 'done' : it.kind === 'amount' ? 'amount' : null,
  };
  const amount = v.target !== null ? `${v.value ?? 0} of ${v.target}${unit ? ` ${unit}` : ''}` : null;
  // Stand-ups say how the minutes came: from the stand-up card, and stood at the desk.
  const split = v.desk ? ` ${(v.value ?? 0) - v.desk} min from the stand-up card, ${v.desk} at the desk with Standing now on.` : '';
  const habitNote = habit ? ` The ${habit.name ?? habit.id} habit is ${habit.ticked ? (habit.value !== null && habit.value > 1 ? `at ${habit.value}` : 'ticked') : 'not ticked'} in the habit check-ins.` : '';
  const note =
    state === 'counted'
      ? `${it.name}: Pahlavan counts it on each Mac from keyboard and mouse activity; nothing to tick.`
      : v.done
        ? `${it.name}: done${amount ? ` (${amount})` : ''}${v.via === 'habit' ? ', from the linked habit' : ''}.${split}${habitNote}`
        : `${it.name}: ${amount ? `${amount} so far` : 'not done yet'}.${split}${habitNote}`;
  return explain(value, 'tracking.day', { item: it.id, date, value: v.value, target: v.target, ...(it.kind === 'standup' ? { desk: v.desk } : {}), via: v.via, habit: it.habit ?? null }, { note });
}

/**
 * The date as the wrap-up reads it: the items due (scheduled, started, not
 * paused) with their states, `open` (the ids still to ask about: the
 * supplements, ticks and amounts not done, which `track tick` writes;
 * stand-ups and desk breaks are counted by Pahlavan on each Mac), the items
 * tracked but not due that day, the session, the "Did you train today?"
 * answer, the day's mark and the morning check-in.
 */
export function buildTrackDay(data: VaultData, tr: TrackingRead, date: IsoDate) {
  const training = trainingToday(data, date);
  const td = trainingDays(training, date);
  const all = tr.tracking?.items ?? [];
  const states = all.map((item) => {
    const desk = item.kind === 'desk' ? deskRoutine(item, data.program).value : null;
    return { item, state: scheduled(item, date, td, desk) };
  });
  const items = states.filter((x) => x.state === 'due').map((x) => dayItem(x.item, date, data, tr));
  const notDue = states.filter((x) => x.state !== 'due').map((x) => ({ id: x.item.id, name: x.item.name, kind: x.item.kind, schedule: x.state as Exclude<ScheduleState, 'due'> }));
  const sessions = data.sessions.filter((s) => s.date === date).map((s) => {
    const v = (s as unknown as { _vault?: { type?: string; label?: string } })._vault;
    const type = v?.type ?? s.template ?? 'custom';
    return { type, name: v?.label ?? data.plan.types.find((t) => t.type === type)?.label ?? type };
  });
  const entry = (key: string) => tr.nudges?.days[date]?.[key] ?? null;
  const train = entry('train');
  const day = isObj(tr.body) && isObj(tr.body['days']) && isObj(tr.body['days'][date]) ? (tr.body['days'][date]) : {};
  const mark = day['mark'] === 'rest' || day['mark'] === 'missed' ? (day['mark']) : null;
  const checked = checkedIn(tr.body, date);
  const morningEntry = entry('morning');
  const morning = tr.tracking?.morning ?? null;
  const daily = data.checkins.daily.find((c) => c.date === date);
  const trainingNote = sessions.length
    ? `${sessions.length} session${sessions.length === 1 ? '' : 's'} logged on ${dayText(date)}.`
    : mark === 'rest'
      ? `Marked a rest day.`
      : train?.how
        ? `"Did you train today?" was answered ${train.how}.`
        : training.workoutTicked
          ? 'The Workout habit is ticked, but no session is logged.'
          : 'No session logged, no rest mark and no answer to "Did you train today?".';
  return {
    date,
    exists: tr.files.tracking !== 'missing',
    items,
    // What the wrap-up can still ask about and tick: supplements, ticks and amounts not done yet.
    open: items.filter((x) => x.value.state === 'not done' && x.value.tickable !== null).map((x) => x.value.id),
    notDue,
    training: explain(
      {
        logged: sessions.length > 0,
        sessions,
        workoutTicked: training.workoutTicked,
        planned: training.plannedToday,
        didYouTrain: train?.how ? { answer: train.how, at: train.at ?? null, by: train.by ?? null } : null,
        mark,
      },
      'tracking.day-training',
      { date, sessions: sessions.length, mark, didYouTrain: train?.how ?? null },
      { note: trainingNote },
    ),
    morning: explain(
      {
        on: Boolean(morning?.on),
        at: morning?.at ?? null,
        done: isMorningDone(day) || morningEntry?.how === 'done',
        checkedAt: checked,
        answer: morningEntry?.how ?? null,
        filled: daily !== undefined && (['energy', 'soreness', 'sleepQ', 'sleepH', 'rhr', 'hrv'] as const).some((k) => typeof daily[k] === 'number'),
      },
      'tracking.day-morning',
      { date, checkedAt: checked, answer: morningEntry?.how ?? null },
      { note: checked ? `Checked in at ${checked}.` : morningEntry?.how ? `The morning card was answered ${morningEntry.how}.` : 'No morning check-in that day.' },
    ),
  };
}

// ---------------------------------------------------------------- track tick

export interface TickRequest {
  ids: readonly string[];
  date: IsoDate;
  /** Supplements and ticks: done (the default) or not. */
  done?: boolean;
  /** Amounts: the day's total. */
  amount?: number;
  /** The change's time, as an ISO timestamp. */
  at?: string;
}

export interface TickMessage {
  code: string;
  message: string;
}

export interface TickResult {
  id: string;
  result: 'set' | 'unchanged';
  note: string;
}

/**
 * The changes for `track tick`: per item, the day record in Coach/tracking.json
 * (a tick, or the amount as the day's total) and the same change on its
 * linked habit, as Pahlavan's Due today writes them. Unknown ids,
 * the wrong flag for an item's kind, a date after today or an item that
 * cannot be ticked are errors (nothing is written); an item not due that day
 * is ticked with a warning.
 */
export function planTick(data: VaultData, tr: TrackingRead, req: TickRequest, today: IsoDate): { ops: TrackingOp[]; habits: HabitChange[]; results: TickResult[]; errors: TickMessage[]; warnings: TickMessage[] } {
  const ops: TrackingOp[] = [];
  const habits: HabitChange[] = [];
  const results: TickResult[] = [];
  const errors: TickMessage[] = [];
  const warnings: TickMessage[] = [];
  if (req.date > today) errors.push({ code: 'date', message: `${req.date} is after today (${today}): a day is ticked once it has come` });
  if (req.done !== undefined && req.amount !== undefined) errors.push({ code: 'flags', message: 'give --done for supplements and ticks, or --amount for amounts, not both' });
  if (req.amount !== undefined && (!Number.isFinite(req.amount) || req.amount < 0)) errors.push({ code: 'amount', message: '--amount is the day\'s total, a number of 0 or more' });
  const items = tr.tracking?.items ?? [];
  const day = buildTrackDay(data, tr, req.date);
  const habitName = (id: string) => tr.habits?.habits.find((h) => h.id === id)?.name ?? id;
  for (const id of req.ids) {
    const item = items.find((x) => x.id === id);
    if (!item) {
      errors.push({ code: 'id', message: `${id} is not a tracked item (tracked: ${items.map((x) => x.id).join(', ') || 'none'})` });
      continue;
    }
    const it = itemOn(item, req.date);
    const now = day.items.find((x) => x.value.id === id)?.value ?? null;
    const off = day.notDue.find((x) => x.id === id);
    if (off) {
      if (off.schedule === 'none' || off.schedule === 'future') {
        errors.push({ code: 'not-started', message: `${it.name} starts ${item.start}: ${req.date} is before it` });
        continue;
      }
      warnings.push({ code: 'not-due', message: `${it.name} is ${off.schedule === 'paused' ? 'paused' : 'not scheduled'} on ${req.date}; ticked anyway, as asked` });
    }
    if (it.kind === 'supplement' || it.kind === 'tick') {
      if (req.amount !== undefined) {
        errors.push({ code: 'flags', message: `${it.name} is a ${it.kind}: tick it with --done true or false, not --amount` });
        continue;
      }
      const done = req.done ?? true;
      const own = tr.tracking?.days[req.date]?.[id]?.done === true;
      const linked = it.habit ? (habitValue(tr.habits, it.habit, req.date) ?? 0) > 0 : null;
      if (own === done && (linked === null || linked === done)) {
        results.push({ id, result: 'unchanged', note: `${it.name} is ${done ? 'done' : 'not done'} on ${req.date} already${it.habit ? ', and so is its habit' : ''}.` });
        continue;
      }
      ops.push({ op: 'tick', item: id, date: req.date, done, ...(req.at ? { at: req.at } : {}) });
      if (it.habit) habits.push({ habit: it.habit, date: req.date, tick: done });
      results.push({ id, result: 'set', note: `${it.name}: ${done ? 'done' : 'not done'} on ${req.date}${it.habit ? `, and the ${habitName(it.habit)} habit ${done ? 'ticked' : 'unticked'}` : ''}.` });
    } else if (it.kind === 'amount') {
      if (req.amount === undefined) {
        errors.push({ code: 'flags', message: `${it.name} is an amount: give the day's total with --amount N (${it.amount?.unit ?? ''}), not --done` });
        continue;
      }
      const ownRaw = tr.tracking?.days[req.date]?.[id]?.amount;
      const own = typeof ownRaw === 'number' ? ownRaw : null;
      const linked = it.habit ? habitValue(tr.habits, it.habit, req.date) : null;
      if (own === req.amount && (!it.habit || linked === req.amount)) {
        results.push({ id, result: 'unchanged', note: `${it.name} holds ${req.amount} ${it.amount?.unit ?? ''} on ${req.date} already.` });
        continue;
      }
      ops.push({ op: 'set', item: id, date: req.date, field: 'amount', value: req.amount, baseline: own, ...(req.at ? { at: req.at } : {}) });
      if (it.habit) habits.push({ habit: it.habit, date: req.date, value: req.amount });
      const target = it.amount?.target ?? null;
      results.push({ id, result: 'set', note: `${it.name}: ${req.amount} ${it.amount?.unit ?? ''} on ${req.date}${target !== null ? ` (${req.amount >= target ? 'the target met' : `${target} is the target`})` : ''}${now?.via === 'habit' && (now.value ?? 0) > req.amount ? `, lower than the linked habit's ${now.value}` : ''}${it.habit ? `; the ${habitName(it.habit)} habit set to the same` : ''}.` });
    } else {
      errors.push({ code: 'kind', message: `${it.name} is a ${it.kind === 'standup' ? 'stand-up' : it.kind === 'desk' ? 'desk-break' : 'sitting'} item: Pahlavan counts it on each Mac, so it is not ticked here` });
    }
  }
  return { ops, habits, results, errors, warnings };
}
