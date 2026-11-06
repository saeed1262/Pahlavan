// The Habits section's Add / Edit form as data: a tracked item into the
// form's fields and back, for all six kinds, as signed off in
// mockups/progress.html?sec=habits. An edit applies from today: the settings
// in force until yesterday go into the item's `earlier`, so past days keep
// theirs. Pause, resume, accepting or dismissing a coach suggestion and the
// one-time bring-over become Coach/tracking.json operations (mergeTracking's
// TrackingOp). Pure: the plugin draws the form and writes the operations.

import type { TrackingOp } from '../adapters/vault/tracking-write.ts';
import { toMinutes } from '../core/clock.ts';
import { addDays, type IsoDate } from '../core/dates.ts';
import { DEFAULT_DESK_STEPS, NUDGES_DESK_TIMING, WORKDAYS } from '../core/desk-breaks.ts';
import type { BodyRecordSchedule, DeskStep, ItemKind, ItemSchedule, ItemSlot, ItemSuggestion, MorningReminder, ScheduleKind, Tracking, TrackedItem, Weekday } from '../core/schema.ts';
import { validateTracking } from '../core/validate.ts';

export interface ItemForm {
  /** The item being edited; null for a new one. */
  id: string | null;
  kind: ItemKind;
  name: string;
  /** Supplements: the dose's number and unit ("5", "g"). */
  doseAmount: string;
  doseUnit: string;
  /** Amounts: the daily target, its unit and the card's quick amounts. */
  target: number;
  unit: string;
  quick: number[];
  /** Ticks: what done means. */
  means: string;
  when: ItemSlot;
  whenDetail: 'before' | 'after';
  often: ScheduleKind;
  days: Weekday[];
  n: number;
  /** Reminders for supplements, ticks and amounts: on, a time, after the session, or every N minutes between two times (amounts). */
  remind: boolean;
  remindAt: string;
  afterLog: boolean;
  every: number;
  from: string;
  to: string;
  /** Sitting: a card at this many minutes of sitting, and one when a stretch reaches its limit. */
  limitRemind: boolean;
  limitAt: number;
  /** Stand-ups. */
  sit: number;
  stand: number;
  snooze: number;
  standTarget: number;
  hoursFrom: string;
  hoursTo: string;
  pauseCalls: boolean;
  helper: string;
  activeOnly: boolean;
  activeSeconds: number;
  away: number;
  /** Desk breaks. */
  followPlan: boolean;
  deskEvery: number;
  deskFrom: string;
  deskTo: string;
  deskMinutes: number;
  steps: DeskStep[];
  /** Sitting time. */
  limitMinutes: number;
  stretchMax: number;
  awayEnds: number;
  start: IsoDate;
  habit: string;
  note: string;
}

export const DOSE_UNITS = ['g', 'mg', 'mcg', 'IU', 'capsules', 'capsule', 'tablets', 'tablet', 'scoops', 'scoop', 'mL', 'drops'] as const;
export const AMOUNT_UNITS = ['mL', 'L', 'min', 'g', 'steps', 'pages', 'glasses'] as const;
/** The When choices per kind (the mockup's pills). */
export const WHEN_CHOICES: Record<'supplement' | 'tick' | 'amount', readonly ItemSlot[]> = {
  supplement: ['morning', 'midday', 'evening', 'bedtime', 'training', 'time'],
  tick: ['morning', 'midday', 'evening', 'bedtime', 'training', 'time'],
  amount: ['day', 'morning', 'midday', 'evening', 'time'],
};
export const WHEN_LABEL: Record<ItemSlot, string> = { morning: 'Morning', midday: 'Midday', evening: 'Evening', bedtime: 'Bedtime', training: 'With training', time: 'At a set time', day: 'Through the day' };
/** The default reminder time for a slot. */
const SLOT_TIME: Record<ItemSlot, string> = { morning: '09:00', midday: '12:30', evening: '21:00', bedtime: '22:30', training: '18:00', time: '18:00', day: '09:00' };
export const OFTEN_LABEL: Record<ScheduleKind, string> = { daily: 'Every day', training: 'Training days', rest: 'Rest days', weekdays: 'Chosen weekdays', every: 'Every N days' };
/** Stand-ups, sitting time and desk breaks run every day or on chosen weekdays. */
export const oftenChoices = (kind: ItemKind): ScheduleKind[] => (['supplement', 'amount', 'tick'].includes(kind) ? ['daily', 'training', 'rest', 'weekdays', 'every'] : ['daily', 'weekdays']);
const simple = (k: ItemKind) => k === 'supplement' || k === 'amount' || k === 'tick';

/** A blank form for a new item of a kind (the mockup's defaults). */
export function newForm(kind: ItemKind, today: IsoDate): ItemForm {
  return {
    id: null,
    kind,
    name: { supplement: '', amount: '', tick: '', standup: 'Stand-ups', desk: 'Desk breaks', sitting: 'Sitting time' }[kind],
    doseAmount: '',
    doseUnit: 'g',
    target: 2000,
    unit: 'mL',
    quick: [250, 500],
    means: '',
    when: kind === 'amount' ? 'day' : 'morning',
    whenDetail: 'after',
    often: simple(kind) ? 'daily' : 'weekdays',
    days: [...WORKDAYS],
    n: 2,
    remind: true,
    remindAt: '09:00',
    afterLog: true,
    every: 120,
    from: '09:00',
    to: '21:00',
    limitRemind: true,
    limitAt: 330,
    sit: 30,
    stand: 20,
    snooze: 10,
    standTarget: 120,
    hoursFrom: '09:00',
    hoursTo: '17:30',
    pauseCalls: false,
    helper: '',
    activeOnly: true,
    activeSeconds: 120,
    away: 30,
    followPlan: true,
    deskEvery: NUDGES_DESK_TIMING.every,
    deskFrom: NUDGES_DESK_TIMING.from,
    deskTo: NUDGES_DESK_TIMING.to,
    deskMinutes: NUDGES_DESK_TIMING.minutes,
    steps: DEFAULT_DESK_STEPS.map((s) => ({ ...s })),
    limitMinutes: 360,
    stretchMax: 45,
    awayEnds: 5,
    start: today,
    habit: '',
    note: '',
  };
}

/** The form for an item as it is (the settings in force now). */
export function formFromItem(item: TrackedItem, today: IsoDate): ItemForm {
  const f = newForm(item.kind, today);
  const dose = /^\s*([\d.,/]+)\s*(.*)$/.exec(item.dose ?? '');
  const r = item.reminder;
  const out: ItemForm = {
    ...f,
    id: item.id,
    name: item.name,
    doseAmount: dose ? dose[1]! : (item.dose ?? ''),
    doseUnit: dose ? dose[2]!.trim() || 'g' : 'g',
    means: item.means ?? '',
    when: item.when ?? f.when,
    whenDetail: item.whenDetail ?? 'after',
    often: item.schedule.kind,
    days: item.schedule.days ? [...item.schedule.days] : f.days,
    n: item.schedule.n ?? f.n,
    remind: r !== undefined,
    remindAt: r?.at ?? (item.when ? SLOT_TIME[item.when] : f.remindAt),
    afterLog: r?.afterLog === true || (r === undefined && item.when === 'training'),
    every: r?.every ?? f.every,
    from: r?.from ?? f.from,
    to: r?.to ?? f.to,
    start: item.start,
    habit: item.habit ?? '',
    note: item.note ?? '',
  };
  if (item.amount) Object.assign(out, { target: item.amount.target, unit: item.amount.unit, quick: [...(item.amount.quick ?? [])] });
  if (item.standup) {
    const s = item.standup;
    Object.assign(out, { sit: s.sitMinutes, stand: s.standMinutes, snooze: s.snoozeMinutes, standTarget: s.targetMinutes, hoursFrom: s.hours?.[0] ?? '', hoursTo: s.hours?.[1] ?? '', pauseCalls: s.pauseCalls, helper: s.helper ?? '', activeOnly: s.activeOnly, activeSeconds: s.activeSeconds, away: s.awayMinutes });
  }
  if (item.desk) {
    const d = item.desk;
    Object.assign(out, { followPlan: d.followPlan, deskEvery: d.every, deskFrom: d.from, deskTo: d.to, deskMinutes: d.minutes, steps: (d.steps ?? DEFAULT_DESK_STEPS).map((s) => ({ ...s })) });
  }
  if (item.sitting) {
    Object.assign(out, { limitMinutes: item.sitting.limitMinutes, stretchMax: item.sitting.stretchMaxMinutes, awayEnds: item.sitting.awayMinutes, limitRemind: r?.atMinutes !== undefined || r?.stretch === true, limitAt: r?.atMinutes ?? 330 });
  }
  return out;
}

/** A new kind on the form: the When and How often choices that fit it (the mockup's rules). */
export function withKind(f: ItemForm, kind: ItemKind): ItemForm {
  const next = { ...f, kind };
  if (kind === 'amount') next.when = 'day';
  else if (f.when === 'day') next.when = 'morning';
  if (!oftenChoices(kind).includes(next.often)) next.often = 'weekdays';
  if (!f.name || ['Stand-ups', 'Desk breaks', 'Sitting time'].includes(f.name)) next.name = newForm(kind, f.start).name;
  return next;
}

/** A new When: training items default to training days and the after-the-session card. */
export function withWhen(f: ItemForm, when: ItemSlot): ItemForm {
  const next = { ...f, when };
  if (when === 'training') {
    if (f.often === 'daily') next.often = 'training';
    next.afterLog = true;
  } else if (f.when === 'training' || f.remindAt === SLOT_TIME[f.when]) next.remindAt = SLOT_TIME[when];
  return next;
}

const slugOf = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';

/** An id for a new item: its name in lowercase with dashes, made unique against the ids in use. */
export function itemId(name: string, taken: readonly string[]): string {
  const base = slugOf(name);
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
  return id;
}

function schedule(f: ItemForm, base: TrackedItem | null): ItemSchedule {
  if (f.often === 'weekdays') return { kind: 'weekdays', days: WORKDAYS.concat(['sat', 'sun'] as Weekday[]).filter((d) => f.days.includes(d)) };
  if (f.often === 'every') return { kind: 'every', n: Math.max(1, Math.round(f.n)), ...(base?.schedule.kind === 'every' && base.schedule.from ? { from: base.schedule.from } : {}) };
  return { kind: f.often };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const round = (n: number) => Math.round(n);

/**
 * The item the form describes. A new item gets an id from its name and
 * "Added by you"; an edit keeps the item's id, source, pauses, goal and
 * history. When the schedule or the kind's settings change on an item that
 * started before today, the old ones go into `earlier` through yesterday.
 * Errors are in words, for the form.
 */
export function itemFromForm(f: ItemForm, base: TrackedItem | null, ctx: { today: IsoDate; ids: readonly string[] }): { item: TrackedItem; errors: string[] } {
  const errors: string[] = [];
  const name = f.name.trim();
  if (!name) errors.push('Give it a name.');
  const kind = f.kind;
  const item: TrackedItem = {
    id: base?.id ?? itemId(name || kind, ctx.ids),
    kind,
    name: name || newForm(kind, ctx.today).name || 'Item',
    schedule: schedule(f, base),
    start: f.start || ctx.today,
    source: base?.source ?? { by: 'user', on: ctx.today },
  };
  if (f.often === 'weekdays' && !f.days.length) errors.push('Pick at least one weekday.');
  if (simple(kind)) {
    item.when = f.when;
    if (f.when === 'training') item.whenDetail = f.whenDetail;
  }
  if (kind === 'supplement') {
    const dose = [f.doseAmount.trim(), f.doseAmount.trim() ? f.doseUnit.trim() : ''].filter(Boolean).join(' ');
    if (dose) item.dose = dose;
  }
  if (kind === 'tick') {
    if (f.means.trim()) item.means = f.means.trim();
    if (base?.goal) item.goal = base.goal;
  }
  if (kind === 'amount') {
    if (!(f.target > 0)) errors.push('The daily target needs a number above 0.');
    const quick = [...new Set(f.quick.filter((q) => q > 0))].sort((a, b) => a - b);
    item.amount = { target: f.target > 0 ? f.target : 1, unit: f.unit.trim() || 'mL', ...(quick.length ? { quick } : {}) };
  }
  if (kind === 'standup') {
    const hours: [string, string] | undefined = f.hoursFrom && f.hoursTo ? [f.hoursFrom, f.hoursTo] : undefined;
    if (hours && hours[0] >= hours[1]) errors.push('The stand-up hours end before they start.');
    for (const [v, what] of [[f.sit, 'sitting'], [f.stand, 'standing'], [f.snooze, 'snooze'], [f.standTarget, 'daily target'], [f.away, 'time away']] as const) if (!(v >= 1)) errors.push(`The ${what} minutes need a number of at least 1.`);
    item.standup = {
      sitMinutes: round(f.sit),
      standMinutes: round(f.stand),
      snoozeMinutes: round(f.snooze),
      targetMinutes: round(f.standTarget),
      ...(hours ? { hours } : {}),
      pauseCalls: f.pauseCalls,
      ...(f.helper.trim() ? { helper: f.helper.trim() } : {}),
      activeOnly: f.activeOnly,
      activeSeconds: Math.max(1, round(f.activeSeconds)),
      awayMinutes: round(f.away),
      standAwayMinutes: base?.standup?.standAwayMinutes ?? 5,
    };
  }
  if (kind === 'desk') {
    if (!f.followPlan && f.deskFrom >= f.deskTo) errors.push('The desk-break hours end before they start.');
    if (!(f.deskEvery >= 1)) errors.push('Desk breaks need a number of minutes between them.');
    // Following the plan, the routine is the plan's: the item's own steps stay as they were (none, for most).
    const steps = f.followPlan ? (base?.desk?.steps ?? []) : f.steps.filter((s) => s.name.trim()).map((s) => ({ name: s.name.trim(), dose: s.dose.trim(), ...(s.how ? { how: s.how } : {}) }));
    item.desk = { followPlan: f.followPlan, every: Math.max(1, round(f.deskEvery)), from: f.deskFrom, to: f.deskTo, minutes: f.deskMinutes > 0 ? f.deskMinutes : 5, ...(steps.length ? { steps } : {}) };
  }
  if (kind === 'sitting') {
    if (!(f.limitMinutes >= 1)) errors.push('The daily limit needs a number.');
    if (!(f.stretchMax >= 1)) errors.push('The longest stretch needs a number of minutes.');
    item.sitting = { limitMinutes: round(f.limitMinutes), stretchMaxMinutes: round(f.stretchMax), awayMinutes: Math.max(1, round(f.awayEnds)) };
  }
  // The reminder (stand-ups and desk breaks have their own cards).
  if (kind === 'sitting') {
    if (f.limitRemind) item.reminder = { ...(f.limitAt >= 1 ? { atMinutes: round(f.limitAt) } : {}), stretch: true };
  } else if (simple(kind) && f.remind) {
    if (kind === 'amount' && f.when === 'day') {
      if (!(toMinutes(f.from)! < toMinutes(f.to)!)) errors.push('The reminders’ hours end before they start.');
      item.reminder = { every: Math.max(1, round(f.every)), from: f.from, to: f.to };
    } else if (f.when === 'training' && f.afterLog && kind !== 'amount') item.reminder = { afterLog: true };
    else if (toMinutes(f.remindAt) !== null) item.reminder = { at: f.remindAt };
    else errors.push('Give the reminder a time.');
  }
  if (f.habit && ['supplement', 'amount', 'tick', 'standup'].includes(kind)) item.habit = f.habit;
  if (f.note.trim()) item.note = f.note.trim();
  if (base?.pauses?.length) item.pauses = base.pauses.map((p) => ({ ...p }));
  const earlier = earlierFor(item, base, ctx.today);
  if (earlier.length) item.earlier = earlier;
  if (!errors.length) {
    const v = validateTracking({ schemaVersion: 1, items: [item], days: {} } satisfies Tracking);
    for (const e of v) errors.push(`${e.path.replace(/^items\[0\]\.?/, '') || 'item'}: ${e.message}`);
  }
  return { item, errors };
}

/**
 * An edit applies from today: when the schedule or the kind's settings
 * change on an item that started before today, the settings in force
 * through yesterday go into `earlier`, so past days keep theirs (one entry
 * a day: a second edit today keeps the first one's). The item's earlier
 * settings as they will be saved.
 */
export function earlierFor(item: TrackedItem, base: TrackedItem | null, today: IsoDate): NonNullable<TrackedItem['earlier']> {
  const earlier = (base?.earlier ?? []).map((v) => ({ ...v }));
  if (base && base.kind === item.kind && base.start < today) {
    const key = ({ amount: 'amount', standup: 'standup', sitting: 'sitting', desk: 'desk' } as const)[item.kind as 'amount'];
    const changedSchedule = !same(base.schedule, item.schedule);
    const changedConfig = key ? !same(base[key], item[key]) : false;
    const last = earlier.at(-1);
    if ((changedSchedule || changedConfig) && !(last && last.until >= addDays(today, -1))) {
      earlier.push({ until: addDays(today, -1), schedule: base.schedule, ...(key && base[key] ? { [key]: base[key] } : {}) });
    }
  }
  return earlier;
}

/** The ops for a save: a new item (baseline null) or the edit against the item as read. */
export function saveOps(item: TrackedItem, base: TrackedItem | null): TrackingOp[] {
  return [{ op: 'put-item', item, baseline: base }];
}

/** Paused from today ("Pausing keeps its history"). */
export function pausedItem(item: TrackedItem, today: IsoDate): TrackedItem {
  const pauses = (item.pauses ?? []).map((p) => ({ ...p }));
  if (pauses.some((p) => !p.to || p.to >= today)) return item;
  return { ...item, pauses: [...pauses, { from: today }] };
}

/** Resumed from today: the open pause ends yesterday (a pause that began today goes); the paused days stay paused. */
export function resumedItem(item: TrackedItem, today: IsoDate): TrackedItem {
  const pauses = (item.pauses ?? []).map((p) => ({ ...p }));
  const p = pauses.find((x) => today >= x.from && (!x.to || today <= x.to)) ?? pauses.find((x) => x.from > today);
  if (!p) return item;
  if (p.from >= today) pauses.splice(pauses.indexOf(p), 1);
  else p.to = addDays(today, -1);
  const out: TrackedItem = { ...item };
  if (pauses.length) out.pauses = pauses;
  else delete out.pauses;
  return out;
}

/**
 * Accepting a coach suggestion: the suggestion decided, and its item added
 * with the coach's settings and reason, starting today (or its own later
 * start), under an id not in use.
 */
export function acceptOps(s: ItemSuggestion, ctx: { today: IsoDate; ids: readonly string[] }): TrackingOp[] {
  const id = ctx.ids.includes(s.item.id) ? itemId(s.item.id, ctx.ids) : s.item.id;
  const item: TrackedItem = { ...clone(s.item), id, start: s.item.start > ctx.today ? s.item.start : ctx.today, source: { ...s.item.source, on: ctx.today } };
  return [{ op: 'decide', id: s.id, state: 'accepted', on: ctx.today }, { op: 'put-item', item, baseline: null }];
}

export function dismissOps(s: ItemSuggestion, today: IsoDate): TrackingOp[] {
  return [{ op: 'decide', id: s.id, state: 'dismissed', on: today }];
}

/**
 * The one-time bring-over: the ticked items added (each under an id not in
 * use), the record of it (so the offer does not come back), and the morning
 * check-in and the body-record schedule as the offer defines them, unless
 * Coach/tracking.json already has its own.
 */
export function bringOverOps(chosen: readonly TrackedItem[], offer: { morning: MorningReminder; bodyRecord: BodyRecordSchedule }, t: Pick<Tracking, 'items' | 'morning' | 'bodyRecord'> | null, today: IsoDate): TrackingOp[] {
  const ids = [...(t?.items ?? []).map((x) => x.id)];
  const ops: TrackingOp[] = [];
  const brought: string[] = [];
  for (const it of chosen) {
    const id = ids.includes(it.id) ? itemId(it.id, ids) : it.id;
    ids.push(id);
    brought.push(id);
    ops.push({ op: 'put-item', item: { ...clone(it), id }, baseline: null });
  }
  ops.push({ op: 'settings', key: 'bringOver', value: { on: today, items: brought }, baseline: null });
  if (!t?.morning) ops.push({ op: 'settings', key: 'morning', value: offer.morning, baseline: null });
  if (!t?.bodyRecord) ops.push({ op: 'settings', key: 'bodyRecord', value: offer.bodyRecord, baseline: null });
  return ops;
}

/** The morning check-in's reminder (its card on Check-in). */
export function morningOps(next: MorningReminder, current: MorningReminder | null | undefined): TrackingOp[] {
  return [{ op: 'settings', key: 'morning', value: next, baseline: current ?? null }];
}

/** The body record's schedule (the Schedule switch on Check-in's Body record card). */
export function bodyScheduleOps(next: BodyRecordSchedule, current: BodyRecordSchedule | null | undefined): TrackingOp[] {
  return [{ op: 'settings', key: 'bodyRecord', value: next, baseline: current ?? null }];
}
