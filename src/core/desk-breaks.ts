// Desk breaks: a short posture routine at set times in the working day. They
// come from the plan (`Program.deskBreaks`): the vault adapter reads this
// vault's plan-data.json `deskRoutine` on its `deskTiming`, else Habit
// Nudges' timing. A desk-break item that follows the plan takes its routine
// and times from there; one that doesn't keeps its own.

import { toMinutes, hhmm } from './clock.ts';
import { explain, type Result } from './reason.ts';
import { WEEKDAYS, type DeskBreaks, type DeskConfig, type DeskStep, type Program, type TrackedItem, type Weekday } from './schema.ts';

/** Habit Nudges' built-in routine, used when the plan has none (its DESK_FALLBACK). */
export const DEFAULT_DESK_STEPS: readonly DeskStep[] = [
  { name: 'Chin tuck', dose: '×10, hold 2 s' },
  { name: 'Doorway chest stretch', dose: '2 × 30 s' },
  { name: 'Band Pull-Apart', dose: '×20, or wall slides ×10' },
  { name: 'Thoracic extension', dose: 'over the chair back, 5 slow breaths' },
  { name: 'Walk', dose: 'stand up and walk for 1 minute' },
];

export const WORKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];

/** When a routine runs: every `every` minutes from `from` to `to`, about `minutes` each, on `days`. */
export type DeskTiming = Pick<DeskBreaks, 'every' | 'from' | 'to' | 'minutes' | 'days'>;

/** Habit Nudges' desk-break timing: every 90 minutes, 10:00 to 15:00, weekdays, about 5 minutes. */
export const NUDGES_DESK_TIMING: DeskTiming = { every: 90, from: '10:00', to: '15:00', minutes: 5, days: [...WORKDAYS] };

/**
 * The break times in a day: the start time, then every `every` minutes,
 * while a break still fits before the end time (10:00, 11:30, 13:00,
 * 14:30 for every 90 minutes, 10:00 to 15:00, 5 minutes each).
 */
export function deskTimes(cfg: Pick<DeskConfig, 'every' | 'from' | 'to' | 'minutes'>): string[] {
  const from = toMinutes(cfg.from);
  const to = toMinutes(cfg.to);
  if (from === null || to === null || !(cfg.every > 0)) return [];
  const out: string[] = [];
  for (let m = from; m <= to - cfg.minutes; m += cfg.every) out.push(hhmm(m));
  return out;
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * plan-data.json's optional `deskTiming` (`{every, from, to, minutes?,
 * days?}`) as the times its routine runs on, with a warning for each part
 * that cannot be used. Left out: no times, so Habit Nudges' apply. `every`,
 * `from` and `to` stand or fall together (a bad one, `to` not after `from`
 * or no break fitting between them keeps Habit Nudges' three); a bad
 * `minutes` or `days` keeps that one's default alone.
 */
export function deskTimingFromPlanData(raw: unknown): { timing: Partial<DeskTiming>; warnings: string[] } {
  if (raw === undefined) return { timing: {}, warnings: [] };
  const usual = `every ${NUDGES_DESK_TIMING.every} min from ${NUDGES_DESK_TIMING.from} to ${NUDGES_DESK_TIMING.to}`;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { timing: {}, warnings: [`plan-data.json's "deskTiming" is not {every, from, to}: the desk breaks run on the usual times (${usual}).`] };
  const o = raw as Record<string, unknown>;
  const timing: Partial<DeskTiming> = {};
  const warnings: string[] = [];
  const minutes = o['minutes'];
  if (minutes !== undefined) {
    if (typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0) timing.minutes = minutes;
    else warnings.push(`plan-data.json's deskTiming.minutes is ${JSON.stringify(minutes)}, not a number of minutes: about ${NUDGES_DESK_TIMING.minutes} min a break assumed.`);
  }
  const days = o['days'];
  if (days !== undefined) {
    if (Array.isArray(days) && days.length && days.every((d) => (WEEKDAYS as readonly unknown[]).includes(d))) timing.days = WEEKDAYS.filter((d) => days.includes(d));
    else warnings.push(`plan-data.json's deskTiming.days is ${JSON.stringify(days)}, not a list of weekdays (mon to sun): weekdays assumed.`);
  }
  const every = o['every'];
  const from = o['from'];
  const to = o['to'];
  const bad: string[] = [];
  if (!(typeof every === 'number' && Number.isInteger(every) && every >= 1)) bad.push(`every is ${JSON.stringify(every ?? null)}, not a whole number of minutes`);
  if (!(typeof from === 'string' && CLOCK.test(from))) bad.push(`from is ${JSON.stringify(from ?? null)}, not HH:MM`);
  if (!(typeof to === 'string' && CLOCK.test(to))) bad.push(`to is ${JSON.stringify(to ?? null)}, not HH:MM`);
  if (!bad.length && toMinutes(to as string)! - toMinutes(from as string)! < (timing.minutes ?? NUDGES_DESK_TIMING.minutes)) bad.push(`${from} to ${to} holds no break`);
  if (bad.length) warnings.push(`plan-data.json's deskTiming: ${bad.join('; ')}. The desk breaks run on the usual times (${usual}).`);
  else Object.assign(timing, { every, from, to });
  return { timing, warnings };
}

type Guide = Record<string, { do?: unknown } | undefined>;

/**
 * plan-data.json's `deskRoutine` as the plan's desk breaks, each step's
 * how-to from the plan's movement guide (matched by name, ignoring case), on
 * Habit Nudges' timing unless `timing` (the plan's `deskTiming`) says
 * otherwise. Null when the plan has no routine.
 */
export function deskBreaksFromPlanData(routine: unknown, guide: unknown, timing: Partial<DeskTiming> = {}): DeskBreaks | null {
  if (!Array.isArray(routine)) return null;
  const g = (typeof guide === 'object' && guide !== null ? guide : {}) as Guide;
  const find = (n: string) => g[n] ?? Object.entries(g).find(([k]) => k.toLowerCase() === n.toLowerCase())?.[1];
  const steps: DeskStep[] = [];
  for (const r of routine) {
    if (typeof r !== 'object' || r === null) continue;
    const o = r as Record<string, unknown>;
    if (typeof o['name'] !== 'string' || !o['name'].trim()) continue;
    const how = find(o['name'])?.do;
    steps.push({ name: o['name'], dose: typeof o['dose'] === 'string' ? o['dose'] : '', ...(typeof how === 'string' && how ? { how } : {}) });
  }
  if (!steps.length) return null;
  const t = { ...NUDGES_DESK_TIMING, ...timing };
  return { steps, every: t.every, from: t.from, to: t.to, minutes: t.minutes, days: [...t.days] };
}

/** A desk-break item's routine and times today: the plan's when it follows the plan (and the plan has them), else its own. */
export interface DeskRoutine {
  steps: DeskStep[];
  every: number;
  from: string;
  to: string;
  minutes: number;
  /** The days it runs: the plan's, or null to follow the item's own schedule. */
  days: Weekday[] | null;
  times: string[];
  source: 'plan' | 'item';
}

export function deskRoutine(item: Pick<TrackedItem, 'id' | 'desk'>, program: Pick<Program, 'deskBreaks'> | null): Result<DeskRoutine> {
  const c = item.desk!;
  const plan = program?.deskBreaks ?? null;
  if (c.followPlan && plan) {
    return explain<DeskRoutine>({ steps: plan.steps, every: plan.every, from: plan.from, to: plan.to, minutes: plan.minutes, days: plan.days, times: deskTimes(plan), source: 'plan' }, 'plan.desk-breaks', { item: item.id, followPlan: true, planHasBreaks: true }, {
      note: `From your plan: every ${plan.every} min from ${plan.from} to ${plan.to}${daysNote(plan.days)}.${plan.why?.length ? ` Why: ${plan.why.map((w) => `${w.what} (${w.from})`).join('; ')}.` : ''}`,
    });
  }
  const steps = c.steps ?? [...DEFAULT_DESK_STEPS];
  return explain<DeskRoutine>({ steps, every: c.every, from: c.from, to: c.to, minutes: c.minutes, days: null, times: deskTimes(c), source: 'item' }, 'plan.desk-breaks', { item: item.id, followPlan: c.followPlan, planHasBreaks: Boolean(plan) }, {
    note: c.followPlan ? `No desk breaks in this plan: the item's own routine, every ${c.every} min from ${c.from} to ${c.to}.` : `Your own routine: every ${c.every} min from ${c.from} to ${c.to}.`,
  });
}

/**
 * Where a desk-break item's times come from, in words for the end of a line:
 * ", from your plan" when it follows the plan (the item's own `from` and `to`
 * in Coach/tracking.json do not apply then), else nothing.
 */
export const fromYourPlan = (r: Pick<DeskRoutine, 'source'>): string => (r.source === 'plan' ? ', from your plan' : '');

/** A desk-break item's hours as the screens and reports show them: "10:00 to 16:30, from your plan", or its own "10:00 to 15:00". */
export const deskHours = (r: Pick<DeskRoutine, 'from' | 'to' | 'source'>): string => `${r.from} to ${r.to}${fromYourPlan(r)}`;

/** "No desk breaks in this plan", or the plan's desk breaks with its reasons: the Plan screen's card. */
export function planDeskBreaks(program: Pick<Program, 'deskBreaks'> | null): Result<DeskBreaks | null> {
  const d = program?.deskBreaks ?? null;
  return explain(d, 'plan.desk-breaks', { planHasBreaks: Boolean(d), steps: d?.steps.length ?? 0 }, {
    note: d ? `${d.steps.length} steps, about ${d.minutes} min, every ${d.every} min from ${d.from} to ${d.to}${daysNote(d.days)}; ${deskTimes(d).length} a day.` : 'No desk breaks in this plan.',
  });
}

function daysNote(days: readonly Weekday[]): string {
  if (days.length === 7) return ', every day';
  if (days.length === 5 && WORKDAYS.every((d) => days.includes(d))) return ' on weekdays';
  return ` on ${WEEKDAYS.filter((d) => days.includes(d)).map((d) => d[0]!.toUpperCase() + d.slice(1)).join(', ')}`;
}
