// The Progress screen's report: what its five cards draw (sets per muscle,
// readiness over 28 days, the consistency calendar, strength trends, the
// weight trend), every number from the engine's rules through the review.
// Everything counts from the cycle start by default (scope "cycle"); "all"
// counts everything on record, except readiness, which reads this cycle's
// mornings in either range (the last 28 days of it, against the cycle's own
// baseline). Pure: the date is an input.

import type { VaultRead } from '../adapters/vault/read.ts';
import { adherence } from '../core/adherence.ts';
import { markedDays } from '../core/checkins.ts';
import { adherenceSince } from '../core/cycle.ts';
import { MUSCLES } from '../core/data/muscles.ts';
import { addDays, dayText, daysBetween, mondayOf } from '../core/dates.ts';
import { E1RM, epley } from '../core/e1rm.ts';
import { effectiveSlot } from '../core/plan.ts';
import { READINESS, readinessBaseline, readinessSeries } from '../core/readiness.ts';
import type { IsoDate, Session } from '../core/schema.ts';
import { setInUnit } from '../core/units.ts';
import { checkVolume, setsPerMuscle, VOLUME, type PlannedSplit } from '../core/volume.ts';
import { weightTrend } from '../core/weight.ts';
import { cycleOf, scopeInfo, withinCycle, type Scope, type ScopeInfo } from './cycle.ts';
import { envelope, sourcesOf } from './envelope.ts';
import { buildReview, context, liftTopSets, sessionLabel, type Ctx } from './review.ts';
import { dayStateOf, type DayState } from './today.ts';
import { paths } from '../adapters/vault/layout.ts';

type Review = ReturnType<typeof buildReview>;
type PlannedSplits = Readonly<Record<string, PlannedSplit>>;

export const CALENDAR_WEEKS = 26;
const r2 = (v: number) => Math.round(v * 100) / 100;

export type VolumeStatus = 'below' | 'in' | 'above' | 'over';

/**
 * The bands' statuses as the screen reads them: below the minimum, a
 * priority muscle under 10, or one with fewer than 10 direct sets near
 * failure is below; a priority muscle over 16 but at or under the cap is
 * above its band; over the cap is over; else in.
 */
export function volumeStatus(status: string): VolumeStatus {
  return status === 'below-minimum' || status === 'priority-low' || status === 'priority-direct-under' ? 'below' : status === 'priority-high' ? 'above' : status === 'at-cap' ? 'over' : 'in';
}

// ---------------------------------------------------------------- volume
/**
 * Sets per muscle against the bands: this week, the last 4 weeks, and the
 * plan (also the Plan screen's source). With `since` (the cycle start) the
 * 4 weeks begin no earlier than it, averaged over at least one week. The
 * plan's rows carry its split (direct, indirect, near failure, unknown
 * effort), and a priority muscle short of direct sets near failure is
 * `directUnder`.
 */
export function volumeViews(ctx: Ctx, review: Review, date: IsoDate, since: IsoDate | null = null) {
  const { data } = ctx;
  const priority = data.profile?.priorityMuscles ?? data.program.priorityMuscles ?? [];
  const muscles = data.plan.muscles.length ? data.plan.muscles : Object.keys(review.volume.planned.value.perWeek);
  const view = (label: string, perWeek: Record<string, number>, from: IsoDate | null, to: IsoDate | null, note: string | null, split?: PlannedSplits) => ({
    label,
    from,
    to,
    note,
    muscles: checkVolume(perWeek, { muscles, priority, ...(split ? { split } : {}) }).map((b) => ({ ...b.value, sets: r2(b.value.sets), status: volumeStatus(b.value.status), directUnder: b.value.status === 'priority-direct-under', note: b.reason.note ?? null })),
  });
  const clipped = since !== null && since > addDays(date, -27) && since <= date;
  const fourFrom = clipped ? since : addDays(date, -27);
  // A cycle a few days old is averaged over one week, not stretched into a weekly rate.
  const four = setsPerMuscle(ctx.sessions, data.program.exercises, fourFrom, daysBetween(fourFrom, date) < 6 ? addDays(fourFrom, 6) : date);
  const fourNote = clipped ? `Since the cycle began on ${dayText(since)}${daysBetween(since, date) < 6 ? ', as one week' : ', a weekly average'}.` : null;
  // Which exercises give each muscle its planned sets, weighted as the review weights the week's templates.
  const weights = (review.volume.planned.reason.inputs as { weights?: Record<string, number> }).weights ?? {};
  const contrib: Record<string, Record<string, number>> = {};
  for (const t of ctx.week?.sessions ?? []) {
    for (const raw of t.slots) {
      const slot = effectiveSlot(raw, date).value;
      const ex = data.program.exercises[slot.exercise];
      if (!ex?.muscles) continue;
      const add = (m: string, f: number) => {
        (contrib[m] ??= {})[ex.name] = (contrib[m]![ex.name] ?? 0) + slot.sets * f * (weights[t.id] ?? 1);
      };
      for (const m of ex.muscles.main) add(m, 1);
      for (const m of ex.muscles.helps) add(m, VOLUME.indirect);
    }
  }
  const top = Object.fromEntries(Object.entries(contrib).map(([m, o]) => [m, Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, sets]) => ({ name, sets: r2(sets) }))]));
  return {
    priority,
    views: {
      week: view('This week', review.volume.done.value.perWeek, review.volume.done.value.from, date, review.volume.done.reason.note ?? null),
      four: view(clipped ? 'This cycle' : '4 weeks', four.value.perWeek, fourFrom, date, [fourNote, four.reason.note].filter(Boolean).join(' ') || null),
      plan: view('Plan', review.volume.planned.value.perWeek, null, null, null, review.volume.planned.value.split),
    },
    topExercises: top,
    labels: Object.fromEntries(MUSCLES.map((m) => [m.id, { label: m.label, slug: m.highlighter }])),
  };
}

// ---------------------------------------------------------------- readiness
/**
 * Readiness over the last 28 days of this cycle: the chart starts at the
 * cycle start when that is later, each day scored against the cycle's own
 * previous mornings (the same scope as Today and `review`, whatever the
 * view's range), and `baseline` says while it is still being built.
 */
function readiness28(ctx: Ctx, date: IsoDate, since: IsoDate | null) {
  const last28 = addDays(date, -27);
  const from = since && since > last28 ? since : last28;
  const scope = { since };
  const points = readinessSeries(ctx.daily, date, scope)
    .filter((d) => d.date >= from && d.r !== null)
    .map((d) => ({ date: d.date, r: d.r!, s: d.s!, band: d.band, flags: [d.rhrFlag && 'rhr-flag', d.shortSleep && 'short-sleep', d.illness && 'illness'].filter((x): x is string => Boolean(x)) }));
  const baseline = readinessBaseline(ctx.daily, date, scope);
  const note = since ? `This cycle's mornings only, since ${dayText(since)}: each day against the cycle's own previous ${READINESS.baselineDays} days.` : `The last 28 days, each day against its own previous ${READINESS.baselineDays}.`;
  return { from, to: date, since, bands: READINESS.bands, points, baseline, note };
}

// ---------------------------------------------------------------- calendar
function calendar(ctx: Ctx, review: Review, date: IsoDate, since: IsoDate | null) {
  const end = addDays(mondayOf(date), 6);
  const start = addDays(mondayOf(date), -7 * (CALENDAR_WEEKS - 1));
  const byDate = new Map<IsoDate, Session[]>();
  for (const s of ctx.sessions) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  const marks = new Map(ctx.dailyMarked.map((d) => [d.date, d]));
  // The days the Sunday check-ins say were trained but not logged: unlogged until a session is logged on them.
  const confirmed = new Set(markedDays(ctx.records).confirmed.map((c) => c.date));
  const firstEntry = [ctx.sessions[0]?.date, ctx.daily.find((d) => d.trained || d.mark)?.date].filter((x): x is IsoDate => Boolean(x)).sort()[0] ?? null;
  const days: { date: IsoDate; state: DayState; today: boolean; beforeData: boolean; beforeCycle: boolean; confirmed?: boolean; sessions: string[] }[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const before = since !== null && d < since;
    const ss = before ? [] : (byDate.get(d) ?? []);
    const c = before ? undefined : { ...marks.get(d), ...(confirmed.has(d) ? { confirmed: true } : {}) };
    const state = dayStateOf(d, date, ss.length, c);
    days.push({ date: d, state, today: d === date, beforeData: firstEntry === null || d < firstEntry, beforeCycle: before, ...(state === 'unlogged' && c?.confirmed ? { confirmed: true } : {}), sessions: ss.map((s) => sessionLabel(ctx, s)) });
  }
  const weeks = Array.from({ length: CALENDAR_WEEKS }, (_, i) => {
    const w = days.slice(i * 7, i * 7 + 7);
    const count = (st: DayState) => w.filter((x) => x.state === st).length;
    return { from: w[0]!.date, trained: count('trained'), unlogged: count('unlogged'), rest: count('rest'), missed: count('missed'), none: count('none'), beforeData: w.every((x) => x.beforeData), beforeCycle: w.every((x) => x.beforeCycle) };
  });
  // The complete weeks in the cycle only: weeks before it are not a shortfall of this one. All: the last 4, whatever the cycle (the review's own figure is the cycle's).
  const adh = since === null
    ? adherenceSince(adherence({ sessions: ctx.sessions, today: date, target: ctx.data.plan.weekTarget, daily: ctx.daily, weekly: ctx.data.checkins.weekly, program: ctx.data.program }).value, null)
    : adherenceSince(review.adherence.value, since);
  return { from: start, to: end, since, firstEntry, days, weeks, adherence: adh.value, adherenceReason: adh.reason };
}

// ---------------------------------------------------------------- lifts
export type Verdict = 'up' | 'down' | 'flat' | 'stalled' | 'units' | 'too-few';

/** Each logged lift's top sets in its own unit, with the e1RM trend's verdict (also the Training section's source). */
export function liftTrends(ctx: Ctx, review: Review, date: IsoDate) {
  const deloadWeeks = ctx.data.program.macrocycle.phases.flatMap((p) => p.mesocycles.flatMap((m) => m.weeks)).filter((w) => w.kind === 'deload' && w.start <= date).map((w) => ({ from: w.start, to: addDays(w.start, 6) }));
  return review.lifts.filter((l) => l.sessions > 0).map((l) => {
    const t = l.e1rm.value;
    const ex = { unit: l.unit, increment: l.increment };
    // Every session's set for the trend (its best by e1RM; the top set at Standard tracking), in the lift's unit; those before a unit flag are left out of the trend.
    const all = liftTopSets(ctx, l.exercise).sort((a, b) => (a.date < b.date ? -1 : 1));
    const best = new Map(t.points.map((p) => [p.date, p.best]));
    let high = -Infinity;
    const sets = all.map((s, i) => {
      const set = setInUnit(s, ex);
      const e = epley(set.weight, set.reps, set.rir).value;
      const used = i >= t.ignored;
      const pr = used && e !== null && high > -Infinity && e > high + 1e-9;
      if (used && e !== null && e > high) high = e;
      // Every set logged: the session's heaviest set, when its best by e1RM is another.
      const top = s.top ? setInUnit(s.top, ex) : null;
      return { date: s.date, weight: set.weight, unit: set.unit, logged: set.logged, reps: set.reps, rir: set.rir ?? null, e1rm: e === null ? null : r2(e), best: best.has(s.date) ? r2(best.get(s.date)!) : null, used, pr, ...(top ? { top: { weight: top.weight, reps: top.reps } } : {}) };
    });
    const verdict: Verdict = l.stall.value.status === 'stalled' ? 'stalled' : t.unitFlag && t.change === null ? 'units' : t.verdict === 'up' ? 'up' : t.verdict === 'down' ? 'down' : t.verdict === 'noise' ? 'flat' : 'too-few';
    const first = sets[0]?.date ?? date;
    return {
      exercise: l.exercise,
      name: l.name,
      unit: l.unit,
      latest: t.best === null ? null : r2(t.best),
      change: t.change,
      noise: t.best === null ? null : { lo: r2(t.best * (1 - E1RM.noise)), hi: r2(t.best * (1 + E1RM.noise)), pct: E1RM.noise },
      verdict,
      sets,
      qualifying: t.points.length,
      unitFlag: t.unitFlag,
      deloadWeeks: deloadWeeks.filter((w) => w.to >= first),
      reason: l.e1rm.reason,
      stall: l.stall.reason,
      /** The Hotel sessions this lift's trend leaves out, in a line (null when none). */
      hotel: 'hotel' in l && l.hotel ? `Hotel session${l.hotel.value.sessions.length === 1 ? '' : 's'} left out: ${l.hotel.value.sessions.map((x) => dayText(x.date)).join(', ')} (other equipment).` : null,
    };
  });
}

// ---------------------------------------------------------------- weight
function weight(ctx: Ctx, review: Review, date: IsoDate) {
  // The scoped data's trend start: the cycle start, or (All) every weigh-in.
  const since = ctx.data.plan.cycleStart ?? undefined;
  const points = weightTrend(ctx.data.body.weights, since ? { through: date, since } : { through: date }).value.points.map((p) => ({ date: p.date, weight: r2(p.weight), trend: r2(p.trend) }));
  const rate = review.weight.rate.value as { kgPerWeek: number; pctPerWeek: number; spanDays: number; weighIns: number; trend: number } | null;
  const bandSection = review.weight.band as { source: string; value: { band: { unit: string; lo: number; hi: number }; value: number; status: string } | null };
  const band = bandSection.value?.band ?? null;
  // The goal band as a wedge from the trend where the rate's 28 days begin, in kg a week.
  const from = (review.weight.rate.reason.inputs as { from?: IsoDate }).from ?? null;
  const anchor = from ? points.find((p) => p.date >= from) ?? null : null;
  const perWeek = (v: number) => (band?.unit === 'pct' ? v * (anchor?.trend ?? 0) : v);
  const latest = points.at(-1) ?? null;
  return {
    since: since ?? null,
    points,
    rate,
    rateNote: review.weight.rate.reason.note ?? null,
    band: band ? { ...band, source: bandSection.source, status: bandSection.value!.status, note: (review.weight.band as { reason?: { note?: string } }).reason?.note ?? null } : null,
    wedge: band && anchor ? { from: anchor.date, trend: anchor.trend, loPerWeek: Math.round(perWeek(band.lo) * 1000) / 1000, hiPerWeek: Math.round(perWeek(band.hi) * 1000) / 1000 } : null,
    projection: rate && latest ? { from: latest.date, to: addDays(latest.date, 21), fromTrend: latest.trend, toTrend: r2(latest.trend + rate.kgPerWeek * 3) } : null,
    // The profile has no goal weight, so no goal date is projected (none is made up).
    goal: { weight: null as number | null, date: null as IsoDate | null, note: 'No goal weight in the profile: no goal date is projected.' },
  };
}

// ---------------------------------------------------------------- notes
function notes(read: VaultRead, p: { lifts: unknown[]; weight: { points: unknown[] }; readiness: { points: unknown[]; baseline?: { reason: { note?: string }; value: { building: boolean } } } }, cycle: ScopeInfo | null = null) {
  const out: { code: string; text: string }[] = [];
  const thisCycle = cycle?.since ? ' this cycle' : '';
  if (read.files.plan === 'missing') out.push({ code: 'no-plan', text: `No plan found (${paths().plan}): sets per muscle and the plan weeks need it.` });
  if (!p.lifts.length) out.push({ code: 'no-lifts', text: `No logged top sets${thisCycle} yet: strength trends start with the first logged lift.` });
  if (!p.weight.points.length) out.push({ code: 'no-weight', text: cycle?.since ? 'No weigh-ins since the cycle began: the weight trend starts with the first one.' : 'No weigh-ins yet: the weight trend starts with the first one.' });
  if (!p.readiness.points.length) {
    const b = p.readiness.baseline;
    out.push({ code: 'no-readiness', text: b?.value.building ? (b.reason.note ?? 'Building your readiness baseline.') : 'No scored check-ins in the last 28 days: readiness needs 14 days of history.' });
  }
  return out;
}

/**
 * The whole Progress report for the date. `scope` "cycle" (the default)
 * counts from the cycle start, "all" counts everything; readiness is this
 * cycle's last 28 days either way. `cycle` says which and from when.
 */
export function buildProgress(read: VaultRead, date: IsoDate, root = '', opts: { scope?: Scope } = {}) {
  const { data } = read;
  const cycle = scopeInfo(data, date, opts.scope ?? 'cycle');
  if (read.files.plan === 'missing') {
    const empty = { lifts: [], weight: { points: [] }, readiness: { points: [] } };
    return envelope('progress', { sources: sourcesOf(read, root), date, cycle, week: null, volume: null, readiness: null, calendar: null, lifts: [], weight: null, notes: notes(read, empty, cycle) }, data.warnings, data.errors);
  }
  const scoped = withinCycle(data, cycle.since);
  const ctx = context(scoped, date);
  const review = buildReview(scoped, date);
  const p = {
    volume: volumeViews(ctx, review, date, cycle.since),
    // Readiness reads this cycle's mornings whatever the range: the baseline is the body since the reset.
    readiness: readiness28(context(data, date), date, cycleOf(data, date).value.start),
    calendar: calendar(ctx, review, date, cycle.since),
    lifts: liftTrends(ctx, review, date),
    weight: weight(ctx, review, date),
  };
  return envelope('progress', { sources: sourcesOf(read, root), date, cycle, week: review.week, ...p, notes: notes(read, p, cycle) }, data.warnings, data.errors);
}
