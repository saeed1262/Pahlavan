// The training cycle the screens count from. A fresh start (a new intake
// and a new plan) begins a cycle: the newest "Baseline - <date>.md" note
// marks it, the date the weight trend has always started from; without one,
// the Monday of the first logged plan session; without either, everything on
// record counts. A view counts from the cycle start by default ("This
// cycle") and shows the earlier data on request ("All"); nothing in the
// vault is deleted or rewritten. Readiness reads the cycle's mornings only
// (core/readiness.ts): a fresh start builds its baseline again.

import type { Adherence } from './adherence.ts';
import { dayText, isIsoDate, mondayOf } from './dates.ts';
import { explain, type Result } from './reason.ts';
import type { IsoDate } from './schema.ts';

export type CycleSource = 'baseline' | 'plan' | 'all';

export interface Cycle {
  /** The first day of the cycle; null when nothing marks one (all the data counts). */
  start: IsoDate | null;
  source: CycleSource;
}

/** What a view counts: the current cycle (the default) or everything on record. */
export type Scope = 'cycle' | 'all';
export const SCOPES: readonly Scope[] = ['cycle', 'all'];

/** The newest baseline note's date, ignoring any after `date` when it is given (a cycle that has not begun). */
export function newestBaseline(dates: readonly string[], date?: IsoDate): IsoDate | null {
  return [...dates].filter((d) => isIsoDate(d) && (!date || d <= date)).sort().at(-1) ?? null;
}

/**
 * The cycle on `date`: the newest baseline note on or before it, else the
 * Monday of plan week 1 (the plan's `start` with `fromPlanStart`, else the
 * first logged plan session: the dashboard's week 1), else none.
 * `firstPlanSession` may be the session's date or its Monday.
 */
export function cycleStart(input: { baselines: readonly string[]; firstPlanSession: IsoDate | null; date?: IsoDate; fromPlanStart?: boolean }): Result<Cycle> {
  const baselines = [...input.baselines].filter(isIsoDate).sort();
  const b = newestBaseline(baselines, input.date);
  const inputs = { baselines, note: b ? `Baseline - ${b}.md` : null, firstPlanSession: input.firstPlanSession, date: input.date ?? null };
  if (b) {
    const older = baselines.filter((d) => d < b).length;
    return explain<Cycle>({ start: b, source: 'baseline' }, 'cycle.start', inputs, {
      note: `This cycle began on ${dayText(b)}, the date of the newest baseline note${older ? `; ${older} older one${older === 1 ? '' : 's'} mark${older === 1 ? 's' : ''} earlier cycles` : ''}.`,
    });
  }
  const first = input.firstPlanSession && isIsoDate(input.firstPlanSession) && (!input.date || input.firstPlanSession <= input.date) ? mondayOf(input.firstPlanSession) : null;
  if (first) {
    return explain<Cycle>({ start: first, source: 'plan' }, 'cycle.start', inputs, {
      note: `No baseline note: the cycle starts on ${dayText(first)}, ${input.fromPlanStart ? 'the Monday of the plan\'s start (plan-data\'s `start`)' : 'the Monday of the first logged plan session'}.`,
    });
  }
  return explain<Cycle>({ start: null, source: 'all' }, 'cycle.start', inputs, {
    note: 'No baseline note and no logged plan session: everything on record counts.',
  });
}

/** The first day a view counts: the cycle start for "This cycle" (null without one), nothing for "All". */
export function scopeSince(cycle: Cycle, scope: Scope): IsoDate | null {
  return scope === 'cycle' ? cycle.start : null;
}

/** On or after the first day counted (always, when there is none). */
export const inScope = (date: IsoDate, since: IsoDate | null): boolean => since === null || date >= since;

/**
 * Adherence counted from the cycle start: only the complete weeks whose
 * Monday is on or after it, summed again against the week's target. Null
 * when no complete week lies in the cycle yet (a first week is not a
 * shortfall of the weeks before it).
 */
export function adherenceSince(a: Adherence, since: IsoDate | null): Result<Adherence | null> {
  if (since === null) return explain<Adherence | null>(a, 'cycle.adherence', { since, weeks: a.weeks.length }, { note: `All ${a.weeks.length} complete weeks count (no cycle start).` });
  const weeks = a.weeks.filter((w) => w.weekOf >= since);
  if (!weeks.length) {
    return explain<Adherence | null>(null, 'cycle.adherence', { since, weeks: 0, dropped: a.weeks.length }, { note: `No complete week since the cycle began on ${dayText(since)} yet: adherence starts after the first full week.` });
  }
  const n = weeks.length;
  const total = (f: (w: Adherence['weeks'][number]) => number) => weeks.reduce((s, w) => s + f(w), 0);
  const liftDone = total((w) => w.lift);
  const shortDone = total((w) => w.short);
  const value: Adherence = {
    from: weeks[0]!.weekOf,
    to: a.to,
    target: a.target,
    weeks,
    lifting: { done: liftDone, planned: n * a.target.lift, pct: a.target.lift ? liftDone / (n * a.target.lift) : null },
    short: { done: shortDone, planned: n * a.target.short, pct: a.target.short ? shortDone / (n * a.target.short) : null },
    meanSessionsPerWeek: total((w) => w.lift + w.short + w.custom) / n,
    meanTrainingDays: total((w) => w.days) / n,
    gaps: { unlogged: total((w) => w.gaps.unlogged), missed: total((w) => w.gaps.missed), rest: total((w) => w.gaps.rest) },
  };
  const dropped = a.weeks.length - n;
  return explain<Adherence | null>(value, 'cycle.adherence', { since, weeks: n, dropped }, {
    note: `${n} complete week${n === 1 ? '' : 's'} since the cycle began on ${dayText(since)}${dropped ? ` (${dropped} earlier left out)` : ''}: lifting ${liftDone} of ${value.lifting.planned}.`,
  });
}
