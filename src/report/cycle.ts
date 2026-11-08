// The cycle a screen counts from, for the reports: the core's rule on the
// adapter's data (the baseline notes, the first logged plan session), what a
// view says about it, and the data from the cycle start on. Scoping copies
// the data and drops what came before; the vault is never touched. Pure:
// the date is an input.

import type { VaultData } from '../adapters/vault/convert.ts';
import { cycleStart, scopeSince, type Cycle, type CycleSource, type Scope } from '../core/cycle.ts';
import type { Reason, Result } from '../core/reason.ts';
import type { IsoDate } from '../core/schema.ts';

export type { Scope } from '../core/cycle.ts';

/** The cycle holding `date`, from the vault's baseline notes and its first logged plan session. */
export function cycleOf(data: VaultData, date: IsoDate): Result<Cycle> {
  return cycleStart({ baselines: data.plan.baselines ?? (data.plan.cycleStart ? [data.plan.cycleStart] : []), firstPlanSession: data.plan.start, date, fromPlanStart: data.plan.startFrom === 'plan' });
}

/** What a view counts and how it says so: its scope, the cycle, and the first day it counts (null: everything). */
export interface ScopeInfo {
  scope: Scope;
  start: IsoDate | null;
  source: CycleSource;
  since: IsoDate | null;
  reason: Reason;
}

export function scopeInfo(data: VaultData, date: IsoDate, scope: Scope = 'cycle'): ScopeInfo {
  const c = cycleOf(data, date);
  return { scope, start: c.value.start, source: c.value.source, since: scopeSince(c.value, scope), reason: c.reason };
}

const from = <T extends { date: IsoDate }>(xs: readonly T[], since: IsoDate): T[] => xs.filter((x) => x.date >= since);

/**
 * The data from `since` on: sessions, daily and weekly check-ins, weigh-ins,
 * tape, tests and photos dated before it are left out, and the weight trend
 * starts there (`plan.cycleStart`). With `since` null nothing is left out
 * and the weight trend takes every weigh-in ("All"). The plan, the profile,
 * the Ledger and the ladders' levels are kept as they are.
 */
export function withinCycle(data: VaultData, since: IsoDate | null): VaultData {
  if (since === null) return { ...data, plan: { ...data.plan, cycleStart: null } };
  return {
    ...data,
    sessions: from(data.sessions, since),
    checkins: { ...data.checkins, daily: from(data.checkins.daily, since), weekly: data.checkins.weekly.filter((w) => (w.date ?? w.weekStart ?? w.weekOf ?? '') >= since) },
    body: { ...data.body, weights: from(data.body.weights, since), tape: from(data.body.tape, since), tests: from(data.body.tests, since), photos: from(data.body.photos, since) },
    plan: { ...data.plan, cycleStart: since },
  };
}

/**
 * fitness-log-data.json as parsed, with only the sessions from `since` on
 * (the dashboard's parts: the month's count, the recent list, the "New
 * record" notice). Everything else in the file is kept; null keeps it all.
 */
export function logFrom(rawLog: unknown, since: IsoDate | null): unknown {
  if (!since || typeof rawLog !== 'object' || rawLog === null || Array.isArray(rawLog)) return rawLog;
  const o = rawLog as Record<string, unknown>;
  if (!Array.isArray(o['sessions'])) return rawLog;
  return { ...o, sessions: (o['sessions'] as unknown[]).filter((s) => typeof s === 'object' && s !== null && typeof (s as { date?: unknown }).date === 'string' && (s as { date: string }).date >= since) };
}
