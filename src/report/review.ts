// The review, readiness and next commands: the vault's data, read by the
// adapter, through the rules. No Node APIs and no clock: the date is an input.

import { ladderStatus, planWeekOf, type VaultData, type VaultWarning } from '../adapters/vault/convert.ts';
import { adherence } from '../core/adherence.ts';
import { backToBack, checkConcurrent, liftItem, weekLayout, type PlannedItem, type PlannedSession, type WeekLayout } from '../core/concurrent.ts';
import { LOWER_BODY } from '../core/data/muscles.ts';
import { addDays, dayText, daysBetween, mondayOf, weekOf } from '../core/dates.ts';
import { decideDeload, deloadPrescription } from '../core/deload.ts';
import { e1rmTrend } from '../core/e1rm.ts';
import { exerciseHistory, topSet, trendSets, type TopSet } from '../core/history.ts';
import { applyReturn, returnProtocol, type ReturnProtocol } from '../core/missed.ts';
import { effectiveSlot, weekAt } from '../core/plan.ts';
import { exerciseId, noteRir, parseSr, toEngineMuscles, type ExerciseExtras, type SlotExtras } from '../core/plan-data.ts';
import { plannedEffort, plannedLoad, sessionLoad, typicalMinutes, weekLoad } from '../core/load.ts';
import { soreDays, soreOn } from '../core/soreness.ts';
import { setInUnit } from '../core/units.ts';
import {
  busyPeriods,
  cancelState,
  checkinDate,
  checkinsThrough,
  fatigueFrom,
  fullLoadWeeks,
  jointAchesOf,
  markedDays,
  recoveryTrigger,
  reportedRirFor,
  rirBiasFor,
  triageStart,
  type Fatigue,
} from '../core/checkins.ts';
import { nextTarget } from '../core/progression.ts';
import { proteinForProfile } from '../core/protein.ts';
import { readinessActions, readinessBaseline, readinessOn, readinessSeries, type ReadinessBand, type ReadinessDay } from '../core/readiness.ts';
import { explain, joinNotes, type Result } from '../core/reason.ts';
import { dayLength, sessionMinutes, timeCheck, type SessionMinutes } from '../core/session-time.ts';
import { PAIN, painRule, painText, type PainReport, type PainVerdict } from '../core/pain.ts';
import { skipReport, type SkipLine } from '../core/skips.ts';
import { cycleOf } from './cycle.ts';
import { screenExercise } from '../core/safety.ts';
import type { BusyPeriod, DailyCheckin, Exercise, ExerciseSlot, IsoDate, LedgerConstraint, RateBand, Session, SessionTemplate, Unit, Week, WeeklyCheckin } from '../core/schema.ts';
import { detectStall, triageLadder } from '../core/stall.ts';
import { checkVolume, holdBests, holdKindOf, plannedSetsPerMuscle, pullPushAim, pullPushSets, setEffort, setsPerMuscle, volumeTier, type EffortContext, type SetEffort } from '../core/volume.ts';
import { RATE_BANDS, rateStatus, weightRate, weightTrend, type RateStatus } from '../core/weight.ts';

/** checkin.md: the roadmap's band, used until Coach/profile.json gives a goal. */
export const ROADMAP_BAND: RateBand = { unit: 'kg', lo: -0.5, hi: -0.25 };

/** The training calendar's fixed week (gen-training-calendar.py): lifting Mon, Tue, Thu, Fri at 17:30; short Wed 17:30, Sat and Sun 10:00. */
export const CALENDAR = { liftDays: [0, 1, 3, 4], shortDays: [2, 5, 6], hours: [17, 17, 17, 17, 17, 10, 10] } as const;

const r2 = (v: number) => Math.round(v * 100) / 100;

export interface Ctx {
  data: VaultData;
  date: IsoDate;
  /** Sessions dated on or before the date. */
  sessions: Session[];
  daily: DailyCheckin[];
  planWeek: number | null;
  /** The program week holding the date, and the loading week nearest it (its templates carry the targets). */
  week: Week | undefined;
  loading: Week | undefined;
  /** The check-in records dated on or before the date. */
  records: WeeklyCheckin[];
  /** Daily check-ins with the check-ins' rest and missed days as marks. */
  dailyMarked: DailyCheckin[];
  /** Mondays of deload weeks the check-ins say were trained at full load. */
  fullLoad: IsoDate[];
  fatigue: Result<Fatigue>;
}

export function context(data: VaultData, date: IsoDate): Ctx {
  const weeks = data.program.macrocycle.phases.flatMap((p) => p.mesocycles.flatMap((m) => m.weeks));
  const week = weekAt(data.program, date);
  const loading = week?.kind === 'loading' ? week : (weeks.filter((w) => w.kind === 'loading' && w.start <= date).at(-1) ?? weeks.find((w) => w.kind === 'loading'));
  const records = checkinsThrough(data.checkins.weekly, date);
  const daily = data.checkins.daily.filter((d) => d.date <= date);
  const marks = markedDays(records);
  const byDay = new Map(daily.map((d) => [d.date, d]));
  for (const [m, days] of [['rest', marks.rest], ['missed', marks.missed]] as const) {
    for (const d of days) if (d <= date && !byDay.get(d)?.mark) byDay.set(d, { ...(byDay.get(d) ?? { date: d }), mark: m });
  }
  return {
    data,
    date,
    sessions: data.sessions.filter((s) => s.date <= date),
    daily,
    planWeek: data.plan.start && date >= data.plan.start ? planWeekOf(data.plan.start, date) : null,
    week,
    loading,
    records,
    dailyMarked: [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    fullLoad: fullLoadWeeks(records, date),
    fatigue: fatigueFrom(records, date),
  };
}

/** The names an exercise goes by: its id, plan name, short name and catalogue id. */
function aliasesOf(ctx: Ctx, exercise: string): string[] {
  const info = ctx.data.plan.lifts.find((l) => l.exercise === exercise);
  return [exercise, nameOf(ctx, exercise), ...(info?.short ? [info.short] : []), ...(ctx.data.catalogueMatch[exercise] ? [ctx.data.catalogueMatch[exercise]!] : [])];
}

const effective = (t: SessionTemplate, date: IsoDate): SessionTemplate => ({ ...t, slots: t.slots.map((s) => effectiveSlot(s, date).value) });
const liftTemplates = (w: Week | undefined) => (w?.sessions ?? []).filter((t) => t.kind === 'lift' || t.kind === 'express');
export function nameOf(ctx: Ctx, id: string): string {
  return ctx.data.program.exercises[id]?.name ?? id;
}
export const typeOf = (ctx: Ctx, templateId: string) => ctx.data.plan.types.find((t) => t.template === templateId)?.type ?? templateId;

// ---------------------------------------------------------------- readiness

function compactDay(d: ReadinessDay) {
  const flags = [d.rhrFlag && 'rhr-flag', d.shortSleep && 'short-sleep', d.illness && 'illness'].filter((x): x is string => Boolean(x));
  return { date: d.date, r: d.r, s: d.s, band: d.band, signals: d.signals, z: d.z, flags };
}

/**
 * Readiness reads this cycle's mornings only (the cycle start on the date):
 * no score until the cycle holds 14 morning check-ins (`baseline`), then each
 * day against the cycle's own previous 28 days.
 */
function readinessSection(ctx: Ctx, e1rmFalling: boolean | undefined) {
  const since = cycleOf(ctx.data, ctx.date).value.start;
  const scope = { since };
  const series = readinessSeries(ctx.daily, ctx.date, scope);
  const scored = series.filter((d) => d.r !== null);
  const latest = scored.at(-1) ?? null;
  return {
    since,
    baseline: readinessBaseline(ctx.daily, ctx.date, scope),
    today: readinessOn(ctx.daily, ctx.date, scope),
    latestScored: latest ? compactDay(latest) : null,
    last14: series.slice(-14).map(compactDay),
    scoredDays: scored.length,
    actions: readinessActions(ctx.daily, ctx.date, { since, ...(e1rmFalling === undefined ? {} : { e1rmFalling }) }),
  };
}

// ---------------------------------------------------------------- body

function last7(ctx: Ctx, field: 'sleepH' | 'steps' | 'floors' | 'rhr') {
  const since = ctx.data.plan.cycleStart ?? '0000-00-00';
  const pts = ctx.daily.filter((d) => d.date >= since && typeof d[field] === 'number');
  if (!pts.length) return null;
  const end = pts.at(-1)!.date;
  const win = pts.filter((d) => d.date >= addDays(end, -6));
  return { value: r2(win.reduce((a, d) => a + (d[field] as number), 0) / win.length), days: win.length, through: end };
}

function goalBand(ctx: Ctx): { band: RateBand; source: string } {
  const goals = [...(ctx.data.profile?.goals ?? [])].sort((a, b) => b.importance - a.importance);
  for (const g of goals) {
    if (g.rateBand) return { band: g.rateBand, source: `profile goal ${g.id} (its own band)` };
    const b = (RATE_BANDS as Record<string, RateBand | undefined>)[g.kind];
    if (b) return { band: b, source: `profile goal ${g.id} (${g.kind})` };
  }
  return { band: ROADMAP_BAND, source: ctx.data.profile ? 'the roadmap (no weight goal in the profile)' : 'the roadmap (no Coach/profile.json yet)' };
}

/**
 * The dashboard's own weight numbers (fitness_log.py review's weightTrend):
 * an EWMA with a 7-day time constant, and the rate against the trend point 7+
 * days back. checkin.md quotes the coach's slope and mentions these when the
 * two disagree in direction.
 */
function dashboardWeight(ctx: Ctx, since: IsoDate | undefined) {
  const pts = ctx.data.body.weights.filter((w) => (!since || w.date >= since) && w.date <= ctx.date);
  if (!pts.length) return null;
  const tr: { date: IsoDate; trend: number }[] = [];
  let t: number | null = null;
  let prev: IsoDate | null = null;
  for (const w of pts) {
    t = t === null || prev === null ? w.weight : t + (1 - Math.exp(-(daysBetween(prev, w.date)) / 7)) * (w.weight - t);
    prev = w.date;
    tr.push({ date: w.date, trend: t });
  }
  const last = tr.at(-1)!;
  const back = tr.filter((x) => daysBetween(x.date, last.date) >= 7).at(-1);
  const rate = back ? r2((last.trend - back.trend) / (daysBetween(back.date, last.date) / 7)) : null;
  return explain(
    { trend: r2(last.trend), ratePerWeek: rate, through: last.date },
    'weight.dashboard',
    { since: since ?? null, weighIns: pts.length, against: back?.date ?? null },
    { threshold: { timeConstantDays: 7, backDays: 7 }, note: 'The dashboard\'s smoothing, for reference only: quote the slope (rate), and mention this number when the two disagree in direction.' },
  );
}

function weightSection(ctx: Ctx) {
  const since = ctx.data.plan.cycleStart ?? undefined;
  const trend = weightTrend(ctx.data.body.weights, since ? { through: ctx.date, since } : { through: ctx.date });
  const rate = weightRate(trend.value);
  const gb = goalBand(ctx);
  const band = rate.value ? rateStatus(rate.value, gb.band) : null;
  const latest = trend.value.latest;
  const protein = proteinForProfile(ctx.data.profile, latest ? latest.trend : null, ctx.date);
  return {
    cycleStart: ctx.data.plan.cycleStart,
    dashboard: dashboardWeight(ctx, since),
    trend: { ...trend, value: { since: trend.value.since, through: trend.value.through, seed: trend.value.seed, weighIns: trend.value.points.length, latest } },
    rate,
    band: band ? { source: gb.source, ...band } : { source: gb.source, value: null, reason: { rule: 'weight.band', title: 'Weight pace', inputs: {}, note: 'No rate yet, so no band check.' } },
    protein,
    proteinFloorG: protein.value.targetG,
    tape: ctx.data.body.tape.filter((t) => (!since || t.date >= since) && t.date <= ctx.date),
    last7: { sleepH: last7(ctx, 'sleepH'), steps: last7(ctx, 'steps'), floors: last7(ctx, 'floors'), rhr: last7(ctx, 'rhr') },
  };
}

// ---------------------------------------------------------------- lifts

export interface LiftContext {
  adherencePct: number | null;
  deloadThisWeek: boolean;
  protocol: ReturnProtocol | null;
  readinessBand: ReadinessBand | null;
  sleep7: number | null;
  rateStatus: RateStatus | null;
  weeksToDeload: number | null;
  weeksToMesocycleEnd: number | null;
  plannedPerWeek: Record<string, number>;
}

/**
 * The sessions a lift's strength numbers read: all but the Hotel ones. A
 * Hotel session's light dumbbells, bands and shifted reps are other
 * equipment, so it never feeds an e1RM trend, a stall check or a next
 * target; it still counts for adherence and the week's sets.
 */
export const strengthSessions = (sessions: readonly Session[]): Session[] => sessions.filter((s) => !s.hotel);

/**
 * A session's logged lifts: at Standard tracking every logged exercise (the
 * top sets of lift1 and lift2); at Full, where every exercise's sets are
 * logged, the plan's main lifts among them (lift1 and lift2), or all of them
 * when the session has no plan snapshot.
 */
export function liftLogs(s: Session): Session['exercises'] {
  if (s.trackingLevel !== 'full' || !s.plan) return s.exercises;
  const mains = new Set(s.plan.slots.filter((x) => x.main).map((x) => x.exercise));
  return s.exercises.filter((x) => mains.has(x.exercise));
}

/** The lifts to report: this week's main lifts in rotation order, then every other lift with a logged top set (Hotel sessions left out). */
function liftIds(ctx: Ctx): string[] {
  const out: string[] = [];
  for (const t of liftTemplates(ctx.loading)) for (const s of t.slots) if (s.main && !out.includes(s.exercise)) out.push(s.exercise);
  const logged = new Set(strengthSessions(ctx.sessions).flatMap((s) => liftLogs(s).filter((x) => x.sets.some((y) => y.weight && y.reps)).map((x) => x.exercise)));
  for (const id of [...logged].sort((a, b) => nameOf(ctx, a).localeCompare(nameOf(ctx, b)))) if (!out.includes(id)) out.push(id);
  return out;
}

/** A lift's sets for its e1RM trend, oldest first: each session's best set by e1RM (the top set at Standard tracking), Hotel sessions left out. */
export function liftTopSets(ctx: Ctx, exercise: string): TopSet[] {
  return trendSets(strengthSessions(ctx.sessions), exercise);
}

/**
 * The Hotel sessions a lift's numbers leave out: each one that logged the
 * lift, carried it in its plan snapshot, or did another exercise in its
 * place (a Hotel swap), with its reason; null when there are none.
 */
function hotelLeftOut(ctx: Ctx, exercise: string): Result<{ sessions: { date: IsoDate; name: string }[] }> | null {
  const left = ctx.sessions.filter((s) => s.hotel && (s.exercises.some((x) => x.exercise === exercise) || (s.plan?.slots ?? []).some((x) => x.exercise === exercise || exerciseId((x as ExerciseSlot & { _planned?: string })._planned ?? '') === exercise)));
  if (!left.length) return null;
  const sessions = left.map((s) => ({ date: s.date, name: sessionLabel(ctx, s) }));
  return explain({ sessions }, 'lifts.hotel', { exercise, hotelSessions: sessions.map((x) => x.date) }, {
    note: `Left out of ${nameOf(ctx, exercise)}'s e1RM trend, stall check and next target: ${sessions.length === 1 ? 'the Hotel session' : `${sessions.length} Hotel sessions`} of ${sessions.map((x) => dayText(x.date)).join(', ')} (other equipment).`,
  });
}

function currentSlot(ctx: Ctx, exercise: string): ExerciseSlot | undefined {
  for (const t of liftTemplates(ctx.loading)) {
    const s = t.slots.find((x) => x.exercise === exercise);
    if (s) return s;
  }
  return undefined;
}

function trendOf(ctx: Ctx, exercise: string) {
  const info = ctx.data.plan.lifts.find((l) => l.exercise === exercise);
  const ex = ctx.data.program.exercises[exercise];
  const unit: Unit = info?.unit ?? ex?.unit ?? ctx.data.plan.liftUnit;
  const increment = info?.increment ?? ex?.increment ?? (unit === 'kg' ? 2.5 : 5);
  const tops = liftTopSets(ctx, exercise);
  return { info, ex, unit, increment, tops, trend: e1rmTrend(tops, { unit, increment }) };
}

function analyseLift(ctx: Ctx, exercise: string, lc: LiftContext) {
  const { info, unit, increment, tops, trend: own } = trendOf(ctx, exercise);
  // The Hotel sessions left out, said in the trend's own note too.
  const hotel = hotelLeftOut(ctx, exercise);
  const trend = hotel ? { ...own, reason: { ...own.reason, note: joinNotes(own.reason.note, hotel.reason.note) ?? '' } } : own;
  const slot = currentSlot(ctx, exercise);
  const stall = detectStall(trend.value, lc.adherencePct);
  const repRange = info?.repRange ?? (slot?.main ? slot.repRange : null);
  const name = nameOf(ctx, exercise);
  let next: Result<unknown> | null = null;
  let returnAdjusted: Result<unknown> | null = null;
  const aliases = aliasesOf(ctx, exercise);
  if (repRange) {
    const history = exerciseHistory(strengthSessions(ctx.sessions), exercise);
    const full = new Set(ctx.fullLoad);
    const lastLogged = history.filter((h) => (!h.deload || full.has(mondayOf(h.date))) && h.sets.length > 0).at(-1);
    const capDate = lastLogged && addDays(lastLogged.date, 1) > ctx.date ? addDays(lastLogged.date, 1) : ctx.date;
    const reported = lastLogged ? reportedRirFor(ctx.records, aliases, lastLogged.date) : null;
    const bias = rirBiasFor(ctx.data.profile?.rirCalibration, aliases, ctx.date);
    const t = nextTarget({
      exerciseName: (id) => nameOf(ctx, id),
      history,
      exercise: { unit, increment },
      repRange,
      targetRir: slot?.rir ?? 2,
      deload: lc.deloadThisWeek,
      ...(slot?.progression ? { rule: slot.progression } : {}),
      date: capDate,
      ...(ctx.fullLoad.length ? { fullLoadWeeks: ctx.fullLoad } : {}),
      ...(reported ? { reportedRir: { rir: reported.rir, checkin: reported.checkin } } : {}),
      ...(bias ? { rirBias: { bias: bias.bias, date: bias.entry.date } } : {}),
    });
    next = t;
    const p = lc.protocol;
    if (p && (p.protocol === 'ease-back' || p.protocol === 'restart') && p.firstWeek && ctx.date >= p.firstWeek.from && ctx.date <= p.firstWeek.to) {
      returnAdjusted = applyReturn(t.value, p, { unit, increment }, ctx.date);
    }
  } else {
    next = explain(null, 'progression.double', { exercise }, { note: `${name} has no rep range in plan-data's lifts: no next target (add a lifts entry to get one).` });
  }
  const mainMuscle = ctx.data.program.exercises[exercise]?.muscles?.main[0];
  const start = stall.value.stalled ? triageStart(ctx.records, aliases, ctx.date) : null;
  const triage = stall.value.stalled
    ? triageLadder(name, {
        sleepH: lc.sleep7,
        readinessBand: lc.readinessBand,
        proteinGPerKg: null,
        rateStatus: lc.rateStatus,
        recovery: ctx.fatigue.value.recovery,
        jointAches: ctx.fatigue.value.jointAches,
        startAt: start!.value.startAt,
        weeksToDeload: lc.weeksToDeload,
        weeksToMesocycleEnd: lc.weeksToMesocycleEnd,
        muscle: mainMuscle ? { name: mainMuscle, weeklySets: r2(lc.plannedPerWeek[mainMuscle] ?? 0) } : null,
      })
    : null;
  // The last top set: with every set logged, the session's heaviest, even where its e1RM used another.
  const lastTop = tops.at(-1) ?? null;
  const last = lastTop ? { date: lastTop.date, ...setInUnit(lastTop.top ?? lastTop, { unit, increment }) } : null;
  return {
    exercise,
    name,
    ...(info?.short ? { short: info.short } : {}),
    unit,
    increment,
    repRange,
    inPlanThisWeek: Boolean(slot?.main),
    sessions: tops.length,
    last,
    e1rm: trend,
    stall,
    ...(hotel ? { hotel } : {}),
    ...(start ? { triageStart: start } : {}),
    triage,
    next,
    ...(returnAdjusted ? { returnAdjusted } : {}),
  };
}

// ---------------------------------------------------------------- concurrent training

function minutesOf(slot: ExerciseSlot): number | undefined {
  const item = (slot as SlotExtras)._item;
  const m = /(\d+)\s*(?:[–-]\s*\d+\s*)?min/.exec(item?.sr ?? '') ?? /(\d+)\s*min/.exec(slot.note ?? '');
  return m ? Number(m[1]) : undefined;
}

/**
 * The program week on the user's week, for the concurrent-training checks
 * (core/concurrent.ts's weekLayout): each session on the weekday this
 * cycle's log shows it done most often, else on the profile's training
 * days, else on the training calendar's fixed week.
 */
export function calendarWeek(ctx: Ctx, templates: readonly SessionTemplate[]): { week: PlannedSession[]; unplaced: string[]; layout: Result<WeekLayout> } {
  const ex = ctx.data.program.exercises as Record<string, Exercise & ExerciseExtras>;
  const lift = templates.filter((t) => t.kind === 'lift' || t.kind === 'express');
  const short = templates.filter((t) => !(t.kind === 'lift' || t.kind === 'express'));
  const toItems = (t: SessionTemplate): PlannedItem[] =>
    t.slots.flatMap((s): PlannedItem[] => {
      const e = ex[s.exercise];
      const label = e?.name ?? s.exercise;
      if (e?.kind === 'mobility') return [];
      if (e?.kind === 'cardio') {
        const minutes = minutesOf(s);
        return [{ kind: 'conditioning', hard: false, label, ...(minutes !== undefined ? { minutes } : {}) }];
      }
      if (e?.kind === 'circuit') {
        const gm = e._guide?.muscles;
        const main = gm ? toEngineMuscles({ main: gm.main ?? [] }).muscles.main : [];
        const minutes = minutesOf(s);
        return [{ kind: 'conditioning', hard: true, legs: main.some((m) => LOWER_BODY.includes(m)), label, ...(minutes !== undefined ? { minutes } : {}) }];
      }
      return [liftItem(s, e, label)];
    });
  const ordered = [...lift, ...short];
  const byType = new Map(ordered.map((t) => [typeOf(ctx, t.id), t]));
  const planned = new Set(ctx.data.plan.types.map((t) => t.template));
  const log = ctx.sessions.flatMap((s) => {
    const tp = s.plan?.template ?? s.template;
    return tp && planned.has(tp) ? [{ date: s.date, id: typeOf(ctx, tp) }] : [];
  });
  const layout = weekLayout({
    sessions: ordered.map((t) => ({ id: typeOf(ctx, t.id), kind: lift.includes(t) ? 'lift' : 'short' })),
    log,
    date: ctx.date,
    since: cycleOf(ctx.data, ctx.date).value.start,
    available: ctx.data.profile?.availability.fixedDays ?? null,
    fallback: { lift: CALENDAR.liftDays, short: CALENDAR.shortDays, hours: CALENDAR.hours },
  });
  const week = layout.value.sessions.map((p): PlannedSession => ({ id: p.id, day: p.day, ...(p.hour !== undefined ? { hour: p.hour } : {}), source: p.source, items: toItems(byType.get(p.id)!) }));
  return { week, unplaced: layout.value.unplaced.map((id) => byType.get(id)!.id), layout };
}

// ---------------------------------------------------------------- the review

export function buildReview(data: VaultData, date: IsoDate) {
  const ctx = context(data, date);
  const { from, to } = weekOf(date);
  const target = data.plan.weekTarget;
  const exercises = data.program.exercises;

  // The week reviewed.
  const inWeek = ctx.sessions.filter((s) => s.date >= from && s.date <= to);
  const vaultOf = (s: Session) => ((s as Session & { _vault?: Record<string, unknown> })._vault ?? {}) as Record<string, unknown>;
  const kindOf = (s: Session) => (s.plan?.kind === 'lift' || s.plan?.kind === 'express' ? 'lift' : s.plan ? 'short' : 'custom');
  const daysIn = ctx.daily.filter((d) => d.date >= from && d.date <= to);
  const thisWeek = {
    from,
    to,
    sessions: inWeek.map((s) => {
      const v = vaultOf(s);
      return {
        date: s.date,
        type: v['type'] ?? s.template ?? 'custom',
        ...(v['label'] ? { label: v['label'] } : {}),
        ...(s.plan?.kind === 'express' ? { express: true } : {}),
        name: sessionLabel(ctx, s),
        // Each logged lift's top set; every set logged, how many.
        lifts: liftLogs(s).map((x) => ({ exercise: x.exercise, name: nameOf(ctx, x.exercise), ...setInUnit(topSet(x.sets)!, exerciseUnit(ctx, x.exercise)), ...(s.trackingLevel === 'full' ? { sets: x.sets.length } : {}) })),
        ...(s.trackingLevel === 'full' ? { everySet: true } : {}),
        ...(s.hotel ? { hotel: true, hotelReason: hotelSessionReason(ctx, s) } : {}),
        ...(s.minutes !== undefined ? { minutes: s.minutes } : {}),
        ...(v['cardioMin'] !== undefined ? { cardioMin: v['cardioMin'] } : {}),
        ...(v['rating'] !== undefined ? { rating: v['rating'] } : {}),
        ...(s.skipped?.length ? { skipped: s.skipped.map((x) => nameOf(ctx, x)) } : {}),
        ...(s.note ? { note: s.note } : {}),
      };
    }),
    lifting: { done: inWeek.filter((s) => kindOf(s) === 'lift').length, target: target.lift },
    short: { done: inWeek.filter((s) => kindOf(s) === 'short').length, target: target.short },
    custom: inWeek.filter((s) => kindOf(s) === 'custom').length,
    cardioMin: inWeek.reduce((a, s) => a + (Number(vaultOf(s)['cardioMin']) || 0), 0),
    trainedTicks: daysIn.filter((d) => d.trained).length,
    proteinTicks: daysIn.filter((d) => d.protein).length,
  };

  // Plan week, adherence.
  // Adherence: the cycle's weeks only (a fresh start's earlier weeks are not this plan's shortfall), so the stall and light-week gates read the cycle's figure.
  const adh = adherence({ sessions: ctx.sessions, today: date, target, daily: ctx.daily, weekly: data.checkins.weekly, program: data.program, since: cycleOf(data, date).value.start });

  // e1RM and stalls first: they feed the readiness and deload triggers.
  const ids = liftIds(ctx);
  const mains = new Set(liftTemplates(ctx.loading).flatMap((t) => t.slots.filter((s) => s.main).map((s) => s.exercise)));
  const trends = new Map(ids.map((id) => [id, trendOf(ctx, id)]));
  const adherencePct = adh.value.lifting.pct;
  const stalledMain = ids.filter((id) => mains.has(id) && detectStall(trends.get(id)!.trend.value, adherencePct).value.stalled).map((id) => nameOf(ctx, id));
  const e1rmFalling = ids.some((id) => mains.has(id) && trends.get(id)!.trend.value.verdict === 'down');
  const readiness = readinessSection(ctx, e1rmFalling);
  const earlySignal = readiness.actions.find((a) => a.value.action === 'early-deload')?.value.active === true;
  const recovery = recoveryTrigger(ctx.records, date);
  const busy = busyPeriods(ctx.records, date);
  const cancel = cancelState(ctx.records, date);
  const cancelledWeeks = cancel.weeks;
  const deload = data.plan.start && date >= data.plan.start
    ? decideDeload({
        programStart: data.plan.start,
        today: date,
        earlyDeloadSignal: earlySignal,
        stalledMainLifts: stalledMain,
        ...(ctx.records.length ? { recoveryTrigger: recovery.value } : {}),
        ...(busy.length ? { busy } : {}),
        cancelled: cancel.cancelled,
        previousCancelled: cancel.previousCancelled,
      })
    : null;
  const planWeek = ctx.planWeek;
  const weekInMeso = planWeek ? ((planWeek - 1) % 4) + 1 : null;

  // Volume.
  const templates = (ctx.week?.sessions ?? []).map((t) => effective(t, date));
  const liftCount = templates.filter((t) => t.kind === 'lift' || t.kind === 'express').length;
  const shortCount = templates.length - liftCount;
  const weights = Object.fromEntries(templates.map((t) => [t.id, t.kind === 'lift' || t.kind === 'express' ? (liftCount ? target.lift / liftCount : 0) : shortCount ? target.short / shortCount : 0]));
  const planned = plannedSetsPerMuscle(templates, exercises, { weights, effort: effortOf(ctx) });
  const done = setsPerMuscle(ctx.sessions, exercises, from, to);
  const priority = data.profile?.priorityMuscles ?? data.program.priorityMuscles ?? [];
  const muscles = data.plan.muscles.length ? data.plan.muscles : [...new Set([...Object.keys(planned.value.perWeek), ...Object.keys(done.value.perWeek)])];
  const volume = {
    weekKind: ctx.week?.kind ?? null,
    planned,
    done,
    /** Each muscle against the bands, with its direct, indirect, near-failure and unknown-effort sets: a priority muscle's minimum counts its direct sets near failure. */
    bands: checkVolume(planned.value.perWeek, { muscles, priority, split: planned.value.split }),
    doneTiers: Object.fromEntries(muscles.map((m) => [m, volumeTier(done.value.perWeek[m] ?? 0)])),
    /** Weekly pulling against pushing sets of this week's plan, weighted as `planned`, against the posture emphasis's ratio (as `plan` checks it). */
    pullPush: pullPushSets(templates, exercises, { weights, aim: pullPushAim(data.profile) }),
  };

  // Body and the rest.
  const weight = weightSection(ctx);
  const protocol = returnProtocol({ sessions: ctx.sessions, today: date, rotation: data.plan.types.filter((t) => t.kind === 'lift').map((t) => t.template), daily: ctx.dailyMarked });
  const lc: LiftContext = {
    adherencePct,
    deloadThisWeek: deload?.value.deload ?? false,
    protocol: protocol.value,
    readinessBand: readiness.latestScored?.band ?? null,
    sleep7: weight.last7.sleepH?.value ?? null,
    rateStatus: weight.band.value && typeof weight.band.value === 'object' && 'status' in weight.band.value ? (weight.band.value as { status: RateStatus }).status : null,
    weeksToDeload: deload?.value.weeksToScheduled ?? null,
    weeksToMesocycleEnd: weekInMeso ? 4 - weekInMeso : null,
    plannedPerWeek: planned.value.perWeek,
  };
  const lifts = ids.map((id) => analyseLift(ctx, id, lc));

  // The deload prescription when a deload is this week or next.
  let prescription = null;
  if (deload && (deload.value.deload || deload.value.weeksToScheduled === 1)) {
    const diffs: { session: string; exercise: string; standardSets: number; dashboardSets: number }[] = [];
    for (const t of liftTemplates(ctx.loading)) {
      const std = deloadPrescription(t.slots, 'standard').value;
      const leg = deloadPrescription(t.slots, 'legacy').value;
      std.forEach((s, i) => {
        if (s.sets !== leg[i]!.sets) diffs.push({ session: typeOf(ctx, t.id), exercise: nameOf(ctx, s.exercise), standardSets: s.sets, dashboardSets: leg[i]!.sets });
      });
    }
    prescription = explain(
      { week: deload.value.deload ? 'this week' : 'next week', differences: diffs },
      'deload.prescription.compare',
      { sessions: liftTemplates(ctx.loading).map((t) => typeOf(ctx, t.id)) },
      { note: `The dashboard deloads every exercise to 2 sets about 10 % lighter; rules.md's deload is half the sets at RIR +3. ${diffs.length ? `They differ for ${diffs.length} exercise(s): say so in the letter.` : 'They agree on every exercise this week.'}` },
    );
  }

  // Each plan session's minutes as planned (the time check, and the short days' planned load).
  const minutes = planMinutes(data, date);
  const time = timeSection(ctx, minutes);

  // Concurrent training over this week's plan, on the user's week: the log's weekdays, else the profile's days, else the calendar's.
  const cal = calendarWeek(ctx, templates);
  const concurrent = {
    layout: cal.week.map((s) => ({ session: s.id, day: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'][s.day], ...(s.hour !== undefined ? { hour: s.hour } : {}), source: s.source })),
    note: joinNotes(cal.layout.reason.note, cal.layout.value.sources.includes('default') && 'Its start times are the training calendar\'s: 17:30 on weekdays, 10:00 on Saturday and Sunday.'),
    /** Where each session's day came from (your logged weeks, your available days, the default layout), with its reason. */
    week: cal.layout,
    ...(cal.unplaced.length ? { unplaced: cal.unplaced } : {}),
    flags: checkConcurrent(cal.week, exercises),
    /** Every muscle hard on two days running, the allowed ones (the second day lighter for it) too. */
    backToBack: backToBack(cal.week, exercises),
  };

  // Temporary changes.
  const changes = liftTemplates(ctx.loading)
    .concat((ctx.loading?.sessions ?? []).filter((t) => !(t.kind === 'lift' || t.kind === 'express')))
    .flatMap((t) =>
      t.slots
        .filter((s) => s.until)
        .map((s) => ({
          session: typeOf(ctx, t.id),
          item: (s as SlotExtras)._item?.name ?? nameOf(ctx, s.exercise),
          until: s.until!.until,
          reason: s.until!.reason,
          wayBack: /Replaces ([^.]+)\./.exec(s.until!.note ?? '')?.[1] ?? null,
          due: s.until!.until <= date,
        })),
    );

  // The Ledger against this week's plan.
  let ledger = null;
  if (data.ledger) {
    const constraints = ledgerConstraints(data);
    const seen = new Set<string>();
    const flagged = [];
    for (const t of templates) {
      for (const s of t.slots) {
        if (seen.has(s.exercise)) continue;
        seen.add(s.exercise);
        const r = screenExercise(s.exercise, constraints, date, exercises, s.swaps ? { swaps: s.swaps } : {});
        if (!r.value.allowed || r.value.conditions.length) flagged.push({ session: typeOf(ctx, t.id), name: nameOf(ctx, s.exercise), ...r });
      }
    }
    ledger = { constraints: data.ledger.constraints.length, flagged };
  }

  return {
    date,
    week: {
      from,
      to,
      planStart: data.plan.start,
      planWeek,
      /** The plan's length in weeks (the top bar's "Week N of M"). */
      planWeeks: data.plan.weeks,
      phase: planWeek ? Math.floor((planWeek - 1) / 8) + 1 : null,
      mesocycle: planWeek ? Math.floor((planWeek - 1) / 4) + 1 : null,
      weekInMesocycle: weekInMeso,
      deload: planWeek !== null && planWeek % 4 === 0,
      deloadNext: planWeek !== null && planWeek % 4 === 3,
    },
    thisWeek,
    adherence: adh,
    readiness,
    weight,
    lifts,
    volume,
    deload,
    deloadPrescription: prescription,
    missed: protocol,
    nextInRotation: nextInRotation(ctx),
    concurrent,
    temporaryChanges: { due: changes.filter((c) => c.due), active: changes.filter((c) => !c.due) },
    ledger,
    // This cycle's tests only: one from before a fresh start shows no level, and only a ladder a plan session carries gets testShowsLevel.
    ladders: ladderStatus(data, date, cycleOf(data, date).value.start),
    tests: testsSection(ctx),
    checkins: checkinSection(ctx, { recovery, busy, cancelledWeeks }),
    load: loadSection(ctx, protocolNext(ctx), minutes),
    soreness: {
      today: soreOn(ctx.daily, date),
      thisWeek: soreDays(ctx.daily, from, to),
      last4Weeks: soreDays(ctx.daily, addDays(from, -21), to),
    },
    /** Each plan session's minutes as planned, against the profile's lifting-day and short-day lengths. */
    time,
    /** The week's pain, from the log and the Sunday check-in, with the pain rule applied to each. */
    pain: painSection(ctx, from),
    /** The last 4 weeks' skipped lines with their reasons, by exercise, and the flags they raise. */
    skips: skipsSection(ctx, time),
  };
}

/** Why a Hotel session is marked: what it counts for, and the lifts whose numbers leave it out. */
function hotelSessionReason(ctx: Ctx, s: Session) {
  const lifts = liftIds(ctx).filter((id) => hotelLeftOut({ ...ctx, sessions: [s] }, id)).map((id) => nameOf(ctx, id));
  return explain(true, 'lifts.hotel', { date: s.date, session: s.id, lifts }, {
    note: `Done as the Hotel version (bodyweight, light dumbbells, bands): it counts for adherence and the week's sets, by its own exercises, and is left out of the lifts' e1RM trends, stall checks and next targets${lifts.length ? ` (${lifts.join(', ')})` : ''}.`,
  }).reason;
}

/** The Ledger's constraints, with each catalogue id also blocking the plan exercises that match it. */
export function ledgerConstraints(data: VaultData): LedgerConstraint[] {
  return (data.ledger?.constraints ?? []).map((c) => ({
    ...c,
    noMovements: [...(c.noMovements ?? []), ...Object.entries(data.catalogueMatch).filter(([, cat]) => (c.noMovements ?? []).includes(cat)).map(([id]) => id)],
  }));
}

/** An exercise's unit and step: plan-data's lifts entry, else the program exercise, else the plan's lift unit. */
export function exerciseUnit(ctx: Ctx, exercise: string): { unit: Unit; increment: number } {
  const info = ctx.data.plan.lifts.find((l) => l.exercise === exercise);
  const ex = ctx.data.program.exercises[exercise];
  const unit: Unit = info?.unit ?? ex?.unit ?? ctx.data.plan.liftUnit;
  return { unit, increment: info?.increment ?? ex?.increment ?? (unit === 'kg' ? 2.5 : 5) };
}

/** A session's display name: the plan's (Full Body A, Short 1 · Skills), or a custom session's label. */
export function sessionLabel(ctx: Ctx, s: Session): string {
  const t = ctx.data.plan.types.find((x) => x.template === (s.plan?.template ?? s.template));
  if (t) return `${t.label}${s.plan?.kind === 'express' ? ' (Express)' : ''}`;
  const v = (s as Session & { _vault?: { label?: string } })._vault;
  return v?.label ?? 'Custom session';
}

/** The next lift and short session types after the last logged ones (the dashboard's rotation). */
function protocolNext(ctx: Ctx): { lift: string | null; short: string | null } {
  return nextInRotation(ctx);
}

/** The rotation's next lift and short session types on a date, as review's `nextInRotation`, without the rest of the review (phone.json). */
export function rotationNext(data: VaultData, date: IsoDate): { lift: string | null; short: string | null } {
  return nextInRotation(context(data, date));
}

/** The week's check-in effort for a date: the record whose reviewed week holds it. */
function effortOn(ctx: Ctx, date: IsoDate): number | null {
  const r = ctx.data.checkins.weekly.find((w) => {
    const m = w.weekStart ?? w.weekOf;
    return m && date >= m && date <= addDays(m, 6);
  });
  return r?.effort ?? null;
}

/** Training load: this week, the 4 weeks before, and next week as planned (heuristic). */
function loadSection(ctx: Ctx, next: { lift: string | null; short: string | null }, minutes: ReturnType<typeof planMinutes>) {
  const { from } = weekOf(ctx.date);
  // A short day's minutes as planned, from its items: next week's short days use them, and a short day logged without minutes falls back to them after its type's typical logged length.
  const planned = new Map(minutes.filter((p) => p.kind === 'short').map((p) => [p.template, p.estimate.value.minutes]));
  const loads = ctx.sessions
    .filter((s) => s.date >= addDays(from, -28))
    .map((s) => {
      const template = s.plan?.template ?? s.template;
      return sessionLoad(s, { effort: effortOn(ctx, s.date), minutes: template ? (typicalMinutes(ctx.data.sessions, template, s.date) ?? planned.get(template) ?? null) : null }).value;
    });
  const thisWeek = weekLoad(loads, from);
  const last4 = [4, 3, 2, 1].map((k) => weekLoad(loads, addDays(from, -7 * k)));

  // Next week: the weekly target's sessions in rotation order, from the program week holding next Monday.
  const monday = addDays(from, 7);
  const week = weekAt(ctx.data.program, monday);
  const target = ctx.data.plan.weekTarget;
  const pickFrom = (kind: 'lift' | 'short', count: number, start: string | null) => {
    const types = ctx.data.plan.types.filter((t) => t.kind === kind);
    if (!types.length || count <= 0) return [];
    const i0 = Math.max(0, types.findIndex((t) => t.type === start));
    return Array.from({ length: count }, (_, k) => types[(i0 + k) % types.length]!);
  };
  const plannedTypes = [...pickFrom('lift', target.lift, next.lift), ...pickFrom('short', target.short, next.short)];
  const nextPlanned = plannedTypes.flatMap((t) => {
    const tpl = week?.sessions.find((x) => x.id === t.template);
    if (!tpl) return [];
    // A lifting day: its typical logged minutes; a short day: its minutes as planned, from its items.
    const minutes = t.kind === 'short' ? (planned.get(t.template) ?? typicalMinutes(ctx.data.sessions, t.template, monday)) : typicalMinutes(ctx.data.sessions, t.template, monday);
    const rpe = plannedEffort({ ...tpl, name: t.label }, ctx.data.program.exercises, { deload: week?.kind === 'deload' }).value;
    return [{ template: t.template, name: t.label, minutes, rpe, load: minutes === null ? null : minutes * rpe }];
  });
  return { thisWeek, last4, nextWeek: plannedLoad(nextPlanned, monday) };
}

// ---------------------------------------------------------------- pain

/** Every pain on record up to the date, tagged with where it came from: each session's in the log, and each check-in's joint aches (on its date). */
export function painReports(data: VaultData, date: IsoDate): PainReport[] {
  const ctx = context(data, date);
  const log = ctx.sessions.flatMap((s) => (s.pain ?? []).map((p): PainReport => ({ date: s.date, area: p.area, severity: p.severity, exercise: p.exercise ?? null, source: 'log', session: sessionLabel(ctx, s) })));
  const checkins = ctx.records.flatMap((w) => {
    const on = checkinDate(w);
    // A first-v1 true or false says nothing of where or how bad: only the list is read.
    return on && Array.isArray(w.jointAches) ? w.jointAches.map((a): PainReport => ({ date: on, area: a.area, severity: a.severity, exercise: a.exercise ?? null, source: 'checkin', session: null, ...(a.lingered ? { lingered: true } : {}) })) : [];
  });
  return [...log, ...checkins];
}

/** The review's pain: each report in its week (the log's and the check-in's) with the pain rule applied, and the worst verdict. */
function painSection(ctx: Ctx, from: IsoDate) {
  const reads = painRule(painReports(ctx.data, ctx.date), from, ctx.date);
  const order: PainVerdict[] = ['fine', 'swap', 'professional'];
  const worst = reads.reduce<PainVerdict | null>((w, r) => (w === null || order.indexOf(r.value.verdict) > order.indexOf(w) ? r.value.verdict : w), null);
  return { from, to: ctx.date, reports: reads, worst };
}

/**
 * One warning for a pain over 3 of 10 logged in the last 7 days (Today's
 * Data notes, the review's warnings): every such report in one line, each
 * with its day and the exercise, and the pain rule's action.
 */
export function painWarning(data: VaultData, date: IsoDate): VaultWarning | null {
  const reads = painRule(painReports(data, date), addDays(date, -6), date).filter((r) => r.value.source === 'log' && r.value.severity > PAIN.fine);
  if (!reads.length) return null;
  const pro = reads.some((r) => r.value.verdict === 'professional');
  return {
    code: 'pain',
    message: `Pain over ${PAIN.fine} of 10 in the last week: ${reads.map((r) => `${painText(r.value)}, ${dayText(r.value.date)}`).join('; ')}. The pain rule: ${pro ? 'it has lasted about 2 weeks or got worse, so see a professional; the plan works around it meanwhile' : 'change the load, the range or the exercise, and keep training everything else'}. Tell the coach, for the Ledger.`,
    items: reads.map((r) => `${r.value.date} ${r.value.area}`),
  };
}

// ---------------------------------------------------------------- skipped lines

/** Every skipped item of the sessions on or before the date, with its reason (the Log panel's time, pain, equipment or energy) and its session. */
export function skipLines(ctx: Ctx): SkipLine[] {
  return ctx.sessions.flatMap((s) =>
    (s.skipped ?? []).map((exercise) => ({
      date: s.date,
      session: s.id,
      type: String(((s as Session & { _vault?: { type?: unknown } })._vault?.type ?? s.template) ?? 'custom'),
      sessionName: sessionLabel(ctx, s),
      exercise,
      name: nameOf(ctx, exercise),
      reason: s.skipWhy?.[exercise] ?? null,
      ...(s.minutes !== undefined ? { minutes: s.minutes } : {}),
    })),
  );
}

/** The review's skips: the last 4 weeks' skipped lines by exercise and their flags; an energy skip reads that day's readiness, a time flag the plan's minutes. */
function skipsSection(ctx: Ctx, time: ReturnType<typeof timeSection>) {
  const since = cycleOf(ctx.data, ctx.date).value.start;
  return skipReport(skipLines(ctx), ctx.date, {
    bandOn: (d) => readinessOn(ctx.daily, d, { since }).value.band,
    time: time.sessions.map((x) => ({ type: x.type, name: x.name, minutes: x.check.value.minutes, limit: x.check.value.limit, over: x.check.value.over })),
  });
}

/**
 * The skip flags for the warnings (Today's Data notes, the review's
 * warnings): one for the exercises skipped for pain twice in 4 weeks (the
 * pain rule's swap) and one for those skipped for equipment twice (a swap to
 * suggest), each once, every exercise in its line.
 */
export function skipWarnings(skips: ReturnType<typeof skipReport>): VaultWarning[] {
  const out: VaultWarning[] = [];
  for (const kind of ['pain', 'equipment'] as const) {
    const flagged = skips.value.flags.filter((f) => f.value.kind === kind);
    if (!flagged.length) continue;
    const text = flagged.map((f) => `${f.value.exercises[0]!.name} (${f.value.dates.map(dayText).join(', ')})`).join('; ');
    out.push({
      code: `skip-${kind}`,
      message: kind === 'pain'
        ? `Skipped for pain twice or more in 4 weeks: ${text}. The pain rule: change the load, the range or the exercise, and keep training everything else. Tell the coach, for the Ledger.`
        : `Skipped for equipment twice or more in 4 weeks: ${text}. Swap it for one your equipment allows (the row's Swap in the Log panel), and tell the coach.`,
      items: flagged.map((f) => f.value.exercises[0]!.name),
    });
  }
  return out;
}

// ---------------------------------------------------------------- session length

/**
 * Each plan session's minutes as planned, from a loading week's items (the
 * plan's own sets, rests and cardio minutes, not a light week's halves),
 * timed as the plan generator times a session (core/session-time.ts).
 */
export function planMinutes(data: VaultData, date: IsoDate): { type: string; template: string; name: string; kind: 'lift' | 'short'; estimate: Result<SessionMinutes> }[] {
  const ctx = context(data, date);
  return (ctx.loading?.sessions ?? []).flatMap((t) => {
    const type = data.plan.types.find((x) => x.template === t.id);
    if (!type) return [];
    const items = t.slots.map((s) => (s as ExerciseSlot & SlotExtras)._item).filter((x): x is NonNullable<typeof x> => Boolean(x));
    const estimate = sessionMinutes({ items, warmup: data.plan.warmups[type.kind], kind: type.kind });
    return [{ type: type.type, template: t.id, name: type.label, kind: type.kind, estimate }];
  });
}

/** How long each session takes as planned, and the time check against the profile's day lengths: a session over its length is flagged with its reason. */
function timeSection(ctx: Ctx, sessions: ReturnType<typeof planMinutes>) {
  const av = ctx.data.profile?.availability ?? null;
  const checks = timeCheck(sessions, av);
  return {
    limits: { lift: dayLength(av, 'lift'), short: dayLength(av, 'short') },
    sessions: sessions.map((s, i) => ({ type: s.type, name: s.name, kind: s.kind, estimate: s.estimate, check: checks[i]! })),
    /** The sessions over their day's length, by type. */
    over: checks.filter((c) => (c.value.over ?? 0) > 0).map((c) => c.value.type),
  };
}

/** One warning for the sessions over their day's length (the review's warnings): each with its minutes and the limit. */
export function timeWarning(time: ReturnType<typeof timeSection>): VaultWarning | null {
  const over = time.sessions.filter((s) => (s.check.value.over ?? 0) > 0);
  if (!over.length) return null;
  return { code: 'time-over', message: `${over.length === 1 ? 'A session runs' : `${over.length} sessions run`} over the day's length in the profile: ${over.map((s) => `${s.type} about ${s.check.value.minutes} min of ${s.check.value.limit}`).join(', ')}.`, items: over.map((s) => s.type) };
}

/** What the check-in answers contribute: the latest record, fatigue, the triggers and the weeks they change. */
function checkinSection(ctx: Ctx, d: { recovery: Result<boolean>; busy: BusyPeriod[]; cancelledWeeks: IsoDate[] }) {
  const last = ctx.records.at(-1) ?? null;
  return {
    file: ctx.data.coach.checkins,
    records: ctx.records.length,
    latest: last ? { date: last.date ?? null, weekStart: last.weekStart ?? last.weekOf ?? null, recovery: last.recovery ?? null, effort: last.effort ?? null, stress: last.stress ?? null, jointAches: jointAchesOf(last).aches, letter: last.letter ?? null } : null,
    fatigue: ctx.fatigue,
    recoveryTrigger: d.recovery,
    knownBusy: d.busy,
    cancelledDeloadWeeks: d.cancelledWeeks,
    trainedAtFullLoad: ctx.fullLoad,
  };
}

/** The dashboard's nextInRotation for each rotation: the type after the last one logged. */
function nextInRotation(ctx: Ctx): { lift: string | null; short: string | null } {
  const next = (kind: 'lift' | 'short') => {
    const types = ctx.data.plan.types.filter((t) => t.kind === kind);
    if (!types.length) return null;
    const last = [...ctx.sessions].reverse().find((s) => types.some((t) => t.template === s.template));
    const at = last ? types.findIndex((t) => t.template === last.template) : -1;
    return types[(at + 1) % types.length]!.type;
  };
  return { lift: next('lift'), short: next('short') };
}

/**
 * The effort rule on the vault's plan (volume.ts's setEffort): the RIR in the
 * item's note (the top of a range), a hold read from its sets and reps ("3 ×
 * 45–60 s/side", "2 × hold") against the latest tested hold, and each
 * ladder's level in the log on the date (level 1 before any entry, as the
 * plan's "your level" items read it).
 */
export function effortContextOf(ctx: Ctx): EffortContext {
  return {
    holds: holdBests(ctx.data.profile?.selfCheck, latestTests(ctx)),
    ladders: ctx.data.plan.ladders.map((l) => ({ id: l.id, name: l.name, levels: l.levels.map(exerciseId), level: l.history.filter((x) => x.date <= ctx.date).at(-1)?.level ?? 1 })),
  };
}

function effortOf(ctx: Ctx): (slot: ExerciseSlot) => Result<SetEffort> {
  const effortCtx = effortContextOf(ctx);
  return (slot) => {
    const sr = (slot as SlotExtras)._item?.sr ?? '';
    const p = parseSr(sr);
    const topS = p.seconds ? (p.repRange?.[1] ?? null) : /\bhold\b/i.test(sr) ? null : undefined;
    const hold = topS === undefined ? null : { topS, kind: holdKindOf([slot.exercise, ctx.data.catalogueMatch[slot.exercise]]) };
    return setEffort({ exercise: slot.exercise, name: nameOf(ctx, slot.exercise), rir: noteRir(slot.note)?.hi ?? null, hold }, effortCtx);
  };
}

/** The latest value of each test, this cycle's only (a test dated before the cycle start does not count): the effort rule's holds read them too. */
function latestTests(ctx: Ctx): Record<string, { value: number; date: IsoDate }> {
  const since = cycleOf(ctx.data, ctx.date).value.start;
  const out: Record<string, { value: number; date: IsoDate }> = {};
  for (const t of ctx.data.body.tests) if (t.date <= ctx.date && (!since || t.date >= since)) for (const [k, v] of Object.entries(t.results)) out[k] = { value: v, date: t.date };
  return out;
}

/** The review's tests: the latest of each this cycle, and which earlier ones were left out. */
function testsSection(ctx: Ctx): Result<Record<string, { value: number; date: IsoDate }>> {
  const since = cycleOf(ctx.data, ctx.date).value.start;
  const latest = latestTests(ctx);
  const before = since ? ctx.data.body.tests.filter((t) => t.date < since && t.date <= ctx.date) : [];
  const left = [...new Set(before.flatMap((t) => Object.keys(t.results)))].filter((k) => !(k in latest));
  const dates = [...new Set(before.map((t) => t.date))].sort();
  return explain(latest, 'tests.latest', { since, tests: Object.keys(latest).length, before: dates }, {
    note: [
      Object.keys(latest).length ? `The latest of each test${since ? ` since the cycle began on ${dayText(since)}` : ''}.` : `No test${since ? ` since the cycle began on ${dayText(since)}` : ''} yet.`,
      dates.length ? `${dates.length === 1 ? 'The test' : 'The tests'} of ${dates.map(dayText).join(', ')} came before this cycle and ${dates.length === 1 ? 'does' : 'do'} not count${left.length ? ` (${left.join(', ')} ${left.length === 1 ? 'has' : 'have'} no test this cycle yet)` : ''}.` : '',
    ].filter(Boolean).join(' '),
  });
}

export function buildReadiness(data: VaultData, date: IsoDate) {
  const ctx = context(data, date);
  const mains = new Set(liftTemplates(ctx.loading).flatMap((t) => t.slots.filter((s) => s.main).map((s) => s.exercise)));
  const e1rmFalling = [...mains].some((id) => trendOf(ctx, id).trend.value.verdict === 'down');
  return {
    date,
    ...readinessSection(ctx, e1rmFalling),
    weekly: { file: data.coach.checkins, fatigue: ctx.fatigue, recoveryTrigger: recoveryTrigger(ctx.records, date) },
  };
}

/**
 * Finds a lift by its name, its plan short name or its id, ignoring case:
 * one of plan-data's lifts, or a lift logged under that name. A name only
 * the guide or a log's `planned` still holds (a lift renamed in the plan)
 * is not one: it has no top sets of its own.
 */
export function findLift(data: VaultData, query: string): string | null {
  const q = query.trim().toLowerCase();
  const byLift = data.plan.lifts.find((l) => l.name.toLowerCase() === q || l.short?.toLowerCase() === q || l.exercise === q);
  if (byLift) return byLift.exercise;
  return loggedLifts(data).find((id) => id === q || (data.program.exercises[id]?.name ?? id).toLowerCase() === q) ?? null;
}

/** The exercises with a logged top set, by id (each a lift's name in the log). */
const loggedLifts = (data: VaultData): string[] => [...new Set(data.sessions.flatMap((s) => s.exercises.map((x) => x.exercise)))];

/** The lifts `next` can answer for: plan-data's lifts and any exercise with a logged top set. */
export function knownLifts(data: VaultData): string[] {
  const logged = loggedLifts(data).map((id) => data.program.exercises[id]?.name ?? id);
  return [...new Set([...data.plan.lifts.map((l) => l.name), ...logged])];
}

/**
 * One lift's answer. A lift with no top sets that is not in this week's
 * plan has nothing to answer from (its numbers are empty, not zero): a
 * warning says so and names the lifts this week's plan has.
 */
export function buildNext(data: VaultData, date: IsoDate, exercise: string) {
  const review = buildReview(data, date);
  const lift = review.lifts.find((l) => l.exercise === exercise) ?? analyseLift(context(data, date), exercise, {
    adherencePct: review.adherence.value.lifting.pct,
    deloadThisWeek: review.deload?.value.deload ?? false,
    protocol: review.missed.value,
    readinessBand: review.readiness.latestScored?.band ?? null,
    sleep7: review.weight.last7.sleepH?.value ?? null,
    rateStatus: null,
    weeksToDeload: review.deload?.value.weeksToScheduled ?? null,
    weeksToMesocycleEnd: review.week.weekInMesocycle ? 4 - review.week.weekInMesocycle : null,
    plannedPerWeek: review.volume.planned.value.perWeek,
  });
  const warnings: VaultWarning[] = [];
  if (lift.sessions === 0 && !lift.inPlanThisWeek) {
    const current = review.lifts.filter((l) => l.inPlanThisWeek).map((l) => l.name);
    warnings.push({
      code: 'lift-not-in-plan',
      message: `${lift.name} has no logged top sets by ${dayText(date)}${'hotel' in lift && lift.hotel ? ' outside Hotel sessions (other equipment, left out)' : ''} and is not in this week's plan, so there is nothing to answer from. This week's lifts: ${current.join(', ') || 'none'}.`,
      items: current,
    });
  }
  return { date, week: review.week, lift, deload: review.deload, missed: review.missed, warnings };
}

