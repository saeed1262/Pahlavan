// The Food tab's report, and `engine food`'s: the eating plan
// (Coach/eating-plan.json) day to day. The plan's words (the goal, the
// approach and its reasons, or stand-ins built from the goal and the level),
// the day (the meals in time order with up, the rotation's session and bed,
// today's meal ideas), the light checks, the protein floor and today's tick,
// the meals' rough protein against the floor, the week's protein days and
// the cycle's weeks before it, the waist and the weight trend against the
// plan's direction, the adjustment rule's status and the weekly pattern as
// the Sunday check-ins answered it. Everything counts from the cycle start.
// Every number carries its Why (`why`, by key): a title, the inputs and the
// threshold as display rows, a note, and the rule id (for data-rule only).
// Pure: the files as read and the date are inputs.

import { planWeekOf, type VaultWarning } from '../adapters/vault/convert.ts';
import { type VaultRead } from '../adapters/vault/read.ts';
import type { TrackingRead } from '../adapters/vault/tracking-read.ts';
import { bodyRecordView, planOccurrences, resolveSchedule } from '../core/body-schedule.ts';
import { addDays, dayText, daysBetween, mondayOf, type IsoDate } from '../core/dates.ts';
import { adjustCheck, DIET, DIRECTION, LEVEL_LABEL, plannedProtein, proteinWeek, proteinWeeks, patternWeeks, shortDay, waistTrend, weightDirection, type ProteinDayState } from '../core/diet.ts';
import { proteinItemOf } from '../core/protein.ts';
import { explain } from '../core/reason.ts';
import type { EatingLevel, EatingPlan, GoalKind, OptionalCheck, PlanReason, RateBand, TrackedItem } from '../core/schema.ts';
import { weightRate, weightTrend } from '../core/weight.ts';
import { bodyUnitsOf, inLength, inWeight } from '../core/units.ts';
import { scopeInfo } from './cycle.ts';
import { envelope } from './envelope.ts';
import { phaseAt } from './today.ts';
import { proteinFor } from './tracking.ts';
import { buildSession, type SessionPick } from './session.ts';
import { paths } from '../adapters/vault/layout.ts';

/** One number's Why, as the tab's tooltip draws it: rows of [label, value], the threshold's rows, a note, the rule id. */
export interface Why {
  title: string;
  rows: [string, string][];
  threshold: [string, string][];
  note: string;
  rule: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const signed = (v: number, dp = 1) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(dp)}`;
const g = (r: readonly [number, number]) => (r[0] === r[1] ? `about ${r[0]} g` : `${r[0]} to ${r[1]} g`);
const and = (xs: readonly string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const lower = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const kcal = (n: number) => n.toLocaleString('en-GB');
const isTopUp = (m: { id: string; tag?: string }) => m.id === 'snacks' || /top-?up/i.test(m.tag ?? '');
const hands = (lo: number, hi: number, w: readonly [string, string]) => (lo === hi ? `${lo} ${lo === 1 ? w[0] : w[1]}` : `${lo} to ${hi} ${w[1]}`);

/** The tracked creatine item, if any (its start dates creatine's water). */
function creatineItem(items: readonly TrackedItem[]): TrackedItem | null {
  return items.find((x) => x.kind === 'supplement' && (x.id === 'creatine' || /^creatine\b/i.test(x.name.trim()))) ?? null;
}

/** The protein item the plan ticks: the plan's `protein.item`, else the tracked protein tick. */
const proteinItem = (plan: EatingPlan | null, items: readonly TrackedItem[]): TrackedItem | null => proteinItemOf(plan, items);

// ---------------------------------------------------------------- the plan's words and the day

/** The goal in plain words, when the plan gives none (`goalLabel`). */
export const GOAL_WORDS: Readonly<Record<GoalKind, string>> = {
  recomposition: 'Build muscle, lose a little fat',
  'fat-loss': 'Lose fat, keep the muscle',
  gain: 'Build muscle',
  maintenance: 'Hold your weight',
  strength: 'Get stronger',
  skill: 'Train for your skills',
  posture: 'Stand taller',
  conditioning: 'Build your fitness',
  health: 'Eat for your health',
};

/** The approach in a sentence, when the plan gives none (`summary`): what the level counts. */
const LEVEL_WORDS: Readonly<Record<EatingLevel, string>> = {
  light: 'Keep protein high and let your hands set the portions. Nothing to weigh, nothing to count.',
  standard: 'Count protein and calories; the rest by hand.',
  full: 'Count every macro against the plan’s figures.',
};

/** One row of the Food tab's day: up, a meal, the session, bed. */
export type FoodDayRow =
  | { kind: 'wake'; at: string }
  | { kind: 'bed'; at: string }
  | { kind: 'training'; at: string; session: 'lift' | 'short'; minutes: number | null; name: string }
  | {
      kind: 'meal';
      id: string;
      at: string | null;
      /** The meal the fallbacks are for: the hardest. */
      hard: boolean;
      /** The meal's line for today's kind of day (before training on a lifting day). */
      note: string | null;
      /** Today's idea: its place in the meal's ideas, which steps by one a day from the plan's date. */
      idea: { index: number; of: number } | null;
    };

/**
 * The Food tab's day: the rows in time order when every meal has its time
 * (with up, the session of the plan's rotation for the date and bed), else
 * the meals in the plan's order. The kind of day is the rotation's: the
 * session Today shows (`buildSession`, with the day's pick), lifting or short.
 */
export function foodDay(plan: EatingPlan, date: IsoDate, session: { type: string; name: string; kind: 'lift' | 'short' } | null) {
  const d = plan.day ?? {};
  const kind = session?.kind ?? null;
  const timed = plan.meals.every((m) => m.at);
  const since = Math.max(0, daysBetween(plan.updated, date));
  const meals: FoodDayRow[] = plan.meals.map((m) => {
    const n = m.ideas?.length ?? 0;
    const note = kind ? (m.trainingNote?.[kind] ?? null) : null;
    return { kind: 'meal', id: m.id, at: m.at ?? null, hard: plan.fallbacks?.meal === m.id, note, idea: n ? { index: since % n, of: n } : null };
  });
  const rows: FoodDayRow[] = [...meals];
  const t = kind ? d.training?.[kind] : undefined;
  if (timed) {
    if (session && kind && t) rows.push({ kind: 'training', at: t.at, session: kind, minutes: t.minutes ?? null, name: session.name });
    // Up first and bed last; between them by the clock, a meal before the session at the same minute.
    const rank = (r: FoodDayRow) => (r.kind === 'meal' ? 0 : 1);
    rows.sort((a, b) => (a.at! < b.at! ? -1 : a.at! > b.at! ? 1 : rank(a) - rank(b)));
    if (d.wake) rows.unshift({ kind: 'wake', at: d.wake });
    if (d.bed) rows.push({ kind: 'bed', at: d.bed });
  }
  return { kind, session: session ? { type: session.type, name: session.name } : null, timed, rows, wake: d.wake ?? null, work: d.work ?? null, bed: d.bed ?? null, drinks: d.drinks ?? null };
}

/** The plan's words for the Food tab: the goal, the approach and the reasons, each with its stand-in when the plan has none. */
export function planWords(plan: EatingPlan): { goal: string; summary: string; reasons: PlanReason[]; reasonLine: string | null } {
  const goal = plan.goalLabel ?? GOAL_WORDS[plan.goal] ?? plan.goal;
  const summary = plan.summary ?? LEVEL_WORDS[plan.level];
  const reasons = plan.why ?? [];
  const reasonLine = reasons.length ? null : `Made for your goal: ${lower(goal)}. ${LEVEL_LABEL[plan.level]}, the level you chose with the coach. The coach adds the reasons behind it at the next review.`;
  return { goal, summary, reasons, reasonLine };
}

/** One day's light checks as Pahlavan keeps them (Coach/help.json): the slots tapped, by check id. */
export type DayChecks = Readonly<Record<string, readonly number[]>>;

/** A light check's pattern line met that day: its slots tapped reach the line's min (all its slots without one). */
export function checkMet(check: OptionalCheck, line: { min?: number } | undefined, tapped: readonly number[] | undefined): boolean {
  const n = new Set((tapped ?? []).filter((i) => i >= 0 && i < check.slots.length)).size;
  return n >= Math.min(check.slots.length, line?.min ?? check.slots.length);
}

/** A pattern line from the week's light checks: met on most days (or left open), the days met of the week's, and the days tapped at all. */
export interface PatternCheck {
  met: true | null;
  days: number;
  of: number;
  tapped: number;
}

/** Days in a week a daily line needs to read "met" from the light checks: most of them (5 of 7, all of a shorter week's up to 5). */
export const PREFILL_DAYS = 5;

/**
 * The Sunday check-in's pattern answers from the week's light checks (the
 * Food tab's Today, never a score): a line is met when its check met it on
 * most of the week's days; otherwise it stays open for the user. Only the
 * days from `since` (the cycle start) count.
 */
export function checksPrefill(plan: Pick<EatingPlan, 'today' | 'pattern'>, byDay: Readonly<Record<string, DayChecks>>, weekStart: IsoDate, since: IsoDate | null = null): Record<string, PatternCheck> {
  const out: Record<string, PatternCheck> = {};
  for (const c of plan.today?.optional ?? []) {
    const line = plan.pattern?.find((x) => x.id === c.id);
    if (!line) continue;
    let days = 0;
    let of = 0;
    let tapped = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      if (since && d < since) continue;
      of++;
      if (byDay[d]?.[c.id]?.length) tapped++;
      if (checkMet(c, line, byDay[d]?.[c.id])) days++;
    }
    out[c.id] = { met: of && days >= Math.min(PREFILL_DAYS, of) ? true : null, days, of, tapped };
  }
  return out;
}

/** The scheduled tape days from `from` through `to`: the plan's every second Sunday, or every N days from the body record's setting. */
export function tapeDays(read: VaultRead, tr: Pick<TrackingRead, 'tracking' | 'body' | 'photoFolders'> | null, from: IsoDate, to: IsoDate): { days: IsoDate[]; text: string } {
  const program = read.files.plan === 'missing' ? null : read.data.program;
  const view = bodyRecordView(tr ? tr.body : (read.raw?.body ?? null), tr?.photoFolders ?? []);
  const rs = resolveSchedule(tr?.tracking?.bodyRecord ?? null, program, { tape: view.tape.at(-1) ?? null, tests: view.tests.at(-1) ?? null }, from);
  if (rs.source === 'plan' && program) return { days: planOccurrences(program).tape.filter((d) => d >= from && d <= to), text: 'every second Sunday' };
  const days: IsoDate[] = [];
  const start = rs.tapeFrom;
  const k = Math.max(0, Math.ceil(daysBetween(start, from) / rs.tapeEvery));
  for (let d = addDays(start, k * rs.tapeEvery); d <= to; d = addDays(d, rs.tapeEvery)) if (d >= from) days.push(d);
  return { days, text: `every ${rs.tapeEvery} days` };
}

export function buildFood(read: VaultRead, tr: TrackingRead | null, date: IsoDate, opts: { pick?: SessionPick } = {}) {
  const { data } = read;
  const plan = data.eatingPlan;
  const state = data.coach.eating;
  const cycle = scopeInfo(data, date);
  const since = cycle.since;
  const items = tr?.tracking?.items ?? [];
  const notes: { code: string; text: string }[] = [];
  const why: Record<string, Why> = {};
  const W = (key: string, w: Why) => void (why[key] = w);
  // Kilos and centimetres in the profile's body units (the files keep kg and cm).
  const units = bodyUnitsOf(data.profile).value;
  const wNum = (kg: number) => (units.weight === 'kg' ? kg : Math.round(inWeight(kg, units) * 100) / 100);
  const cmN = (cm: number) => (units.length === 'cm' ? cm : Math.round(inLength(cm, units) * 10) / 10);
  const kgT = (kg: number, f: (n: number) => string = String) => `${f(units.weight === 'kg' ? kg : inWeight(kg, units))} ${units.weight}`;
  const cmT = (cm: number, f: (n: number) => string = String) => `${f(cmN(cm))} ${units.length}`;
  const week = { planWeek: data.plan.start && read.files.plan !== 'missing' ? planWeekOf(data.plan.start, date) : null, phase: read.files.plan !== 'missing' ? phaseAt(data, date) : null };

  // ---------------------------------------------------------------- the trend (the banner needs it with or without a plan)
  const goal = plan?.goal ?? data.profile?.goals.slice().sort((a, b) => b.importance - a.importance).find((x) => DIRECTION[x.kind])?.kind ?? 'recomposition';
  const flatCm = plan?.adjust?.flatCm ?? 0.5;
  const trend = weightTrend(data.body.weights, { through: date, ...(since ? { since } : {}) });
  const rate = weightRate(trend.value);
  const profileBand: RateBand | null = data.profile?.goals.find((x) => x.kind === goal)?.rateBand ?? null;
  const direction = weightDirection(rate.value, goal, profileBand);
  const waist = waistTrend(data.body.tape, { since, through: date, flatCm, goal, units });
  const chartFrom = since ?? trend.value.points[0]?.date ?? waist.value.first?.date ?? date;
  const chartTo = plan && plan.review > date ? plan.review : date;
  const sched = tapeDays(read, tr, chartFrom, addDays(chartTo, 120));
  const nextTapes = sched.days.filter((d) => d > date);
  const tl = trend.value.latest;
  const n = trend.value.points.length;
  if (tl) {
    W('trend', {
      title: 'Weight trend',
      rows: [['Weigh-ins', n === 1 ? `1, on ${dayText(tl.date)}` : `${n} since ${shortDay(trend.value.points[0]!.date)}`], ['Trend', kgT(tl.trend, (x) => x.toFixed(2))], ['Last weigh-in', `${kgT(tl.weight, (x) => x.toFixed(1))}, ${shortDay(tl.date)}`]],
      threshold: [['Smoothing', 'α 0.1 a day'], ['A rate needs', '14 days, 8 weigh-ins']],
      note: n === 1 ? 'With one weigh-in the trend is that weigh-in. Water moves the scale by a kilo from day to day; the trend smooths it.' : 'Each day moves the trend a tenth of the way to the weigh-in, so one heavy morning barely shows.',
      rule: 'weight.trend',
    });
  }
  const last = waist.value.last;
  if (last) {
    const want = DIRECTION[goal]?.waist;
    W('waist', {
      title: 'Waist',
      rows: [['Last tape', `${cmT(last.waist)}, ${dayText(last.date)}`], ...(waist.value.points.length > 1 ? [['First', `${cmT(waist.value.first!.waist)}, ${dayText(waist.value.first!.date)}`] as [string, string]] : []), ['Next tape', nextTapes[0] ? dayText(nextTapes[0]) : '–']],
      threshold: [['The tape', sched.text]],
      note: `Waist is the ${goal.replace('-', ' ')} goal’s measure${want ? `; ${want} is the plan’s direction` : ''}. The adjustment rule reads it, never one day.`,
      rule: 'diet.waist',
    });
  }
  const rr = rate.value;
  if (rr) {
    const b = direction.value.band;
    W('rate', {
      title: 'Weight rate',
      rows: [['Slope', `${kgT(rr.kgPerWeek, (x) => signed(x, 2))} a week`], ['Share', `${signed(rr.pctPerWeek * 100, 2)} % a week`], ['Over', `${rr.spanDays} days, ${rr.weighIns} weigh-ins`]],
      threshold: b ? [['The plan’s pace', `${b.unit === 'pct' ? `${signed(b.hi * 100, 1).replace('±0.0', '0')} to ${signed(b.lo * 100, 1)} %` : `${wNum(b.hi)} to ${wNum(b.lo)} ${units.weight}`} a week`]] : [],
      note: direction.reason.note ?? '',
      rule: 'weight.band',
    });
  } else {
    const ri = rate.reason.inputs as { spanDays?: number; weighIns?: number };
    W('rate', {
      title: 'Weight rate',
      rows: [['Days', `${ri.spanDays ?? 0} of 14`], ['Weigh-ins', `${ri.weighIns ?? 0} of 8`]],
      threshold: [['Needs', '14 days and 8 weigh-ins']],
      note: plan ? `Not enough data yet: the first check is ${shortDay(plan.review)}.` : 'Not enough data yet.',
      rule: 'weight.rate',
    });
  }
  const waistPts = waist.value.points;
  waistPts.forEach((t, i) => {
    const base = waistPts[0]!.waist;
    const d = t.waist - base;
    W(`tape-${t.date}`, {
      title: `Tape, ${dayText(t.date)}`,
      rows: [['Waist', cmT(t.waist)], ...(i ? [['Since the first', cmT(d, signed)] as [string, string]] : [])],
      threshold: [['Flat', `within ${cmT(flatCm)} of ${cmN(base)}`]],
      note: i ? (Math.abs(d) <= flatCm + 1e-9 ? 'Inside the flat band.' : d < 0 ? 'Below the flat band: going down.' : 'Above the flat band.') : 'The cycle’s first tape.',
      rule: 'diet.waist',
    });
  });
  if (waistPts.length > 1) {
    W('waist-ch', {
      title: 'Waist since the first tape',
      rows: waistPts.map((t) => [shortDay(t.date), cmT(t.waist)]),
      threshold: [['Flat', `within ${cmT(flatCm)}`]],
      note: waist.reason.note ?? '',
      rule: 'diet.waist',
    });
  }

  if (state === 'invalid') notes.push({ code: 'invalid-plan', text: 'Coach/eating-plan.json is not valid, so the Food tab cannot draw it: run /fitness-coach diet to write it again.' });
  if (!plan) {
    if (state === 'missing') notes.push({ code: 'no-plan', text: 'No eating plan yet: run /fitness-coach diet to make one.' });
    return envelope('food', {
      date,
      cycle,
      week,
      /** The profile's body units: the screens show weights and lengths in them. */
      units,
      file: { path: paths().eating, state },
      plan: null,
      level: null,
      protein: null,
      trend: { from: chartFrom, to: chartTo, tapeDays: sched.days.filter((d) => d <= chartTo), nextTapes, weight: { trend, rate, direction }, waist },
      adjust: null,
      pattern: null,
      words: null,
      day: null,
      checks: [],
      why,
      notes,
    }, [], data.errors.filter((e) => e.code === 'eating'));
  }

  // ---------------------------------------------------------------- protein
  const pr = plan.protein;
  const item = proteinItem(plan, items);
  const engine = proteinFor(data, date).value;
  const tier = engine.tier === 'health' ? 'Health or endurance goals' : 'Lifting goals';
  const source = engine.tier === 'health' ? 'Thomas 2016' : 'Morton 2018';
  const goals = data.profile?.goals.map((x) => x.kind.replace('-', ' ')) ?? [plan.goal];
  const drift = engine.targetG !== null && Math.abs(engine.targetG - pr.floorG) >= 2 && tl ? `At today’s trend weight (${kgT(tl.trend, (x) => x.toFixed(1))}) the engine’s floor is ${engine.targetG} g; the review on ${shortDay(plan.review)} sets the plan’s again.` : '';
  const itemGoal = item?.goal?.amount;
  const itemNote = item && itemGoal !== undefined && itemGoal !== pr.floorG ? `The Protein item asks for ${itemGoal} g, not the plan’s ${pr.floorG}.` : '';
  const floor = explain({ floorG: pr.floorG, rangeG: pr.rangeG, gPerKg: pr.gPerKg, basis: plan.basis, engineTargetG: engine.targetG, itemGoalG: itemGoal ?? null }, 'diet.protein', { goals, trendKg: plan.basis.trendKg, basisDate: plan.basis.date, item: item?.id ?? null }, {
    threshold: { gPerKg: pr.gPerKg },
    note: [`The Protein item is ticked on days with at least ${pr.floorG} g. ${tier}: ${pr.gPerKg[0]} to ${pr.gPerKg[1]} g per kg a day (${source}).`, itemNote, drift].filter(Boolean).join(' '),
  });
  W('floor', {
    title: 'Protein a day',
    rows: [['Goals', goals.map((x, i) => (i ? x : x.charAt(0).toUpperCase() + x.slice(1))).join(', ')], ['Trend weight', `${kgT(plan.basis.trendKg)}, ${shortDay(plan.basis.date)}`]],
    threshold: [['Floor', `${pr.gPerKg[0]} × ${plan.basis.trendKg} = ${pr.floorG} g`], ['Top', `${pr.gPerKg[1]} × ${plan.basis.trendKg} = ${pr.rangeG[1]} g`]],
    note: floor.reason.note ?? '',
    rule: 'diet.protein',
  });
  W('top', {
    title: 'Top of the range',
    rows: [['Trend weight', kgT(plan.basis.trendKg)]],
    threshold: [['Top', `${pr.gPerKg[1]} × ${plan.basis.trendKg} = ${pr.rangeG[1]} g`]],
    note: `Gains level off around ${pr.gPerKg[0]} g per kg; ${pr.gPerKg[1]} is the top of the useful range (${source}). More is not harmful, just not needed.`,
    rule: 'diet.protein',
  });
  const eatTimes = plan.habits ? `${plan.habits.meals} meals${plan.habits.snacks ? ' and snacks' : ''}` : `${plan.meals.length} meals`;
  W('permeal', {
    title: 'Protein a meal',
    rows: [['The day', `${pr.rangeG[0]} to ${pr.rangeG[1]} g`], ['Eating times', eatTimes]],
    threshold: [['A meal', `about ${pr.perMealG[0]} to ${pr.perMealG[1]} g`]],
    note: 'Spread over the day rather than in one big meal; the snacks top up what the meals miss.',
    rule: 'diet.meals',
  });

  const planned = plannedProtein(plan);
  const P = planned.value;
  W('planned', {
    title: 'Planned today',
    rows: plan.meals.map((m) => [m.name, m.proteinG[0] === m.proteinG[1] ? `${m.proteinG[0]} g` : `${m.proteinG[0]} to ${m.proteinG[1]} g`]),
    threshold: [['Floor', `${pr.floorG} g`], ['Range', `to ${pr.rangeG[1]} g`]],
    note: planned.reason.note ?? '',
    rule: 'diet.meals',
  });
  for (const m of P.meals) {
    const meal = plan.meals.find((x) => x.id === m.id)!;
    const top = isTopUp(meal);
    W(`meal-${m.id}`, {
      title: `${m.name}, ${g([m.lo, m.hi])}`,
      rows: [['Planned', g([m.lo, m.hi])], ...(top ? [['After the meals', `${P.lo - m.lo} g`] as [string, string]] : [])],
      threshold: [[top ? 'A top-up' : 'A meal', top ? `${m.lo} to ${m.hi} g` : `${pr.perMealG[0]} to ${pr.perMealG[1]} g`]],
      note: top ? `Whatever the meals leave short of ${pr.floorG} g.` : `A rough figure from the eating plan, not a count${plan.level === 'light' ? ': with hand portions nothing is weighed or logged' : ''}.`,
      rule: 'diet.meals',
    });
    W(`meal-${m.id}-bar`, {
      title: `${m.name}, ${g([m.lo, m.hi])}`,
      rows: [['Planned', g([m.lo, m.hi])], ['Running total', `${m.from + m.lo} g`]],
      threshold: [['A meal', `${pr.perMealG[0]} to ${pr.perMealG[1]} g`]],
      note: 'A rough figure from the eating plan, not a count.',
      rule: 'diet.meals',
    });
    if (m.hi > m.lo) {
      W(`meal-${m.id}-upto`, {
        title: `${m.name}, up to ${m.hi} g`,
        rows: [['Planned', `${m.lo} to ${m.hi} g`]],
        threshold: [['A top-up', 'whatever the meals leave short']],
        note: 'The bigger figure: the top-up on a day the meals come in low.',
        rule: 'diet.meals',
      });
    }
  }

  // The week's protein days and the cycle's weeks before it.
  const pIn = { item, tracking: tr?.tracking ?? null, habits: tr?.habits ?? null, date, since };
  const pWeek = proteinWeek({ ...pIn, floorG: pr.floorG });
  const pWeeks = proteinWeeks({ ...pIn, checkins: data.checkins.weekly });
  const today = pWeek.value.days.find((d) => d.date === date) ?? null;
  const tickAt = item?.reminder?.at ?? pr.tickAt ?? null;
  const STATE_TEXT: Record<ProteinDayState, [string, string]> = {
    ticked: ['Ticked', `Ticked: ${pr.floorG} g or more.`],
    unticked: ['Not ticked', 'Not ticked. Not counted as missed: the Sunday check-in asks about the unticked days.'],
    open: ['Open', `Still open: tick it tonight${tickAt ? `; the ${tickAt} card asks too` : ''}.`],
    future: ['To come', 'To come.'],
    before: ['Before this cycle', 'Before this cycle or the item’s start: not counted.'],
  };
  for (const d of pWeek.value.days) {
    const [label, note] = STATE_TEXT[d.state];
    W(`day-${d.date}`, {
      title: `${dayText(d.date)}${d.date === date ? ', today' : ''}`,
      rows: [['Protein item', label], ...(d.via === 'habit' ? [['From', 'the Protein habit'] as [string, string]] : [])],
      threshold: [['A protein day', `${pr.floorG} g or more`]],
      note,
      rule: 'diet.protein-days',
    });
  }
  const wk = pWeek.value;
  W('weekdays', {
    title: 'Protein days this week',
    rows: [['Ticked', `${wk.ticked} of ${wk.soFar} so far`], ['Week', `Mon ${+wk.from.slice(8)} to ${dayText(wk.to)}`]],
    threshold: [['A protein day', `${pr.floorG} g or more`]],
    note: `The Sunday check-in counts the ticks and asks about the unticked days; the review on ${shortDay(plan.review)} reads the weeks since ${shortDay(plan.updated)}.`,
    rule: 'diet.protein-days',
  });
  for (const w of pWeeks.value) {
    W(`week-${w.n}`, {
      title: `Week ${w.n}`,
      rows: [['Ticked', `${w.ticked} of ${w.days}`], ['Week', `${shortDay(w.from)} to ${shortDay(w.to)}`], ...(w.checkin !== null ? [['At the check-in', plural(w.checkin, 'day', 'days')] as [string, string]] : [])],
      threshold: [['A protein day', `${pr.floorG} g or more`]],
      note: w.checkin === null ? 'No Sunday check-in saved for that week: only the ticks count.' : w.checkin > w.ticked ? `The Sunday check-in added ${w.checkin - w.ticked} day${w.checkin - w.ticked === 1 ? '' : 's'} that reached it without a tick.` : 'The Sunday check-in added no days to the ticks.',
      rule: 'diet.protein-days',
    });
  }
  if (!item) notes.push({ code: 'no-protein-item', text: 'No protein item is tracked: the diet job adds one (a tick named Protein, linked to the Protein habit), and the days fill in from there.' });

  // The review.
  const reviewTapes = sched.days.filter((d) => d > plan.updated && d <= plan.review);
  W('review', {
    title: 'Next review',
    rows: [['Date', dayText(plan.review)], ['In', date === plan.review ? 'today' : date > plan.review ? `${plural(daysBetween(plan.review, date), 'day', 'days')} ago` : plural(daysBetween(date, plan.review), 'day', 'days')]],
    threshold: reviewTapes.length ? [['After', `${plural(reviewTapes.length, 'tape', 'tapes')}, ${and(reviewTapes.map(shortDay))}`]] : [],
    note: 'The eating plan’s review reads the protein days, the tape and the weight trend, and takes one portion step at most.',
    rule: 'diet.adjust',
  });

  // ---------------------------------------------------------------- the plate, fiber and the fallbacks
  const groups = plan.groups ?? [];
  const meals = Object.keys(plan.portions ?? {});
  const PLATE_NOTE: Record<string, string> = {
    palm: 'Hands instead of grams: your own hand sets the size, no scale needed.',
    fist: plan.fiber ? `Vegetables at 2 meals a day are most of the fiber; fruit and legumes do the rest.` : 'Salad or cooked vegetables, a fist each.',
    cupped: plan.adjust ? 'The adjustment rule moves carbs by one cupped hand a day, and nothing else: the protein stays.' : 'Rice, bread or potatoes, a heaped handful each.',
    thumb: 'The fats the heart-healthy pattern asks for, over butter.',
  };
  const HAND_SIZE: Record<string, string> = { palm: 'its size and thickness', fist: 'its size', cupped: 'a heaped handful', thumb: 'its length' };
  for (const meal of meals) {
    const mealName = plan.meals.find((m) => m.portions === meal || m.id === meal)?.name ?? meal;
    const mealProtein = plan.meals.find((m) => m.portions === meal || m.id === meal)?.proteinG ?? null;
    for (const gr of groups) {
      const r = plan.portions![meal]![gr.id];
      if (!r) continue;
      const other = meals.filter((m) => m !== meal).map((m) => plan.portions![m]![gr.id]).find(Boolean);
      const extra: [string, string][] = gr.hand === 'palm' && mealProtein ? [['With the meal', `${g(mealProtein)} of protein`]]
        : gr.hand === 'fist' && plan.fiber ? [['Fiber', `part of about ${plan.fiber.g} g a day`]]
          : gr.hand === 'cupped' && other ? [['At the other meal', hands(other[0], other[1], gr.hands)]]
            : gr.what ? [['Kind', lower(gr.what)]] : [];
      W(`plate-${meal}-${gr.id}`, {
        title: `${mealName}: ${hands(r[0], r[1], gr.hands)} of ${gr.name.toLowerCase()}`,
        rows: [[`A ${gr.hands[0]}`, HAND_SIZE[gr.hand] ?? ''], ...extra],
        threshold: gr.hand === 'palm' ? [['A meal', `${pr.perMealG[0]} to ${pr.perMealG[1]} g of protein`]] : [],
        note: PLATE_NOTE[gr.hand] ?? '',
        rule: 'diet',
      });
    }
  }
  if (plan.fiber) {
    W('fiber', {
      title: 'Fiber',
      rows: [['Target', `about ${plan.fiber.g} g a day`]],
      threshold: plan.fiber.per1000kcal ? [['Rule of thumb', `${plan.fiber.per1000kcal} g per 1,000 kcal`]] : [],
      note: plan.fiber.how?.length ? `No counting: it comes from ${and(plan.fiber.how)}.` : 'From vegetables, fruit, legumes and whole grains.',
      rule: 'diet',
    });
  }
  if (plan.fallbacks?.minutes) {
    const hard = plan.meals.find((m) => m.id === plan.fallbacks!.meal);
    W('fb-min', {
      title: `In ${plan.fallbacks.minutes} minutes`,
      rows: [['Meal', `${hard?.name ?? plan.fallbacks.meal}${hard?.tag && /hard/i.test(hard.tag) ? ', the hardest' : ''}`]],
      threshold: [['Time', `${plan.fallbacks.minutes} minutes or less`]],
      note: 'Quick answers from the eating plan for the meal that is hardest to get right: the protein stays at the meal, so the day stays over the floor.',
      rule: 'diet',
    });
  }

  // ---------------------------------------------------------------- the adjustment rule
  const creatine = creatineItem(items);
  const creatineFrom = plan.adjust?.creatineFrom ?? creatine?.start ?? null;
  const adjust = plan.adjust ? adjustCheck({ rule: plan.adjust, review: plan.review, date, since, tape: data.body.tape, weighIns: data.body.weights, tapeDays: sched.days, creatineFrom, units }) : null;
  if (plan.adjust && adjust) {
    const A = plan.adjust;
    const X = adjust.value;
    W('rule', {
      title: 'The adjustment rule',
      rows: [['Tapes so far', waistPts.length ? waistPts.map((t) => shortDay(t.date)).join(', ') : 'none yet'], ['Weigh-ins', String(n)]],
      threshold: [['Reads', 'the tape and the weight trend'], ['Over', plural(A.windowWeeks, 'week', 'weeks')]],
      note: adjust.reason.note ?? '',
      rule: 'diet.adjust',
    });
    if (X.next) {
      W('check', {
        title: X.checkedOn ? 'Next check' : 'First check',
        rows: [['Date', dayText(X.next)], ['After the tape' + (X.before.length === 1 ? '' : 's'), and(X.before.map(shortDay))]],
        threshold: [['Reads', `${plural(A.windowWeeks, 'week', 'weeks')} of tape`]],
        note: X.checkedOn ? `Each tape day from now on, over the last ${plural(A.windowWeeks, 'week', 'weeks')}.` : `${A.windowWeeks} weeks gives two tape intervals: enough to tell flat from down.`,
        rule: 'diet.adjust',
      });
    }
    W('flat', {
      title: 'Waist flat',
      rows: [['Over', `${plural(A.windowWeeks, 'week', 'weeks')}, two tape intervals`]],
      threshold: [['Flat', `within ${cmT(A.flatCm)}`]],
      note: `The plan says flat: within ±${cmT(A.flatCm)}, the tape’s half-centimetre step.`,
      rule: 'diet.adjust',
    });
    const back = A.steps.find((s) => s.id === 'back');
    const backPct = Math.abs((back?.pctPerWeek ?? DIET.backPctPerWeek) * 100);
    const tk = tl?.trend ?? null;
    W('onepct', {
      title: 'Losing too fast',
      rows: tk ? [['Trend', kgT(tk, (x) => x.toFixed(1))], [`${backPct} % of it`, `${kgT((tk * backPct) / 100, (x) => x.toFixed(2))} a week`]] : [['Trend', 'no weigh-ins yet']],
      threshold: [['Faster than', `${backPct} % of body weight a week`]],
      note: `Faster than that is more than ${goal.replace('-', ' ')} needs: ${lower(back?.then ?? 'one cupped hand back')}.`,
      rule: 'diet.adjust',
    });
    W('wait', {
      title: 'One step, then wait',
      rows: [['Wait', `${A.waitWeeks[0]} to ${A.waitWeeks[1]} weeks`], ...(X.wait ? [['Last step', `${dayText(X.wait.last.date)}, wait until ${shortDay(X.wait.until)}`] as [string, string]] : [])],
      threshold: [['Steps', 'one at a time']],
      note: 'A step needs a tape or two to show; changing again sooner chases noise.',
      rule: 'diet.adjust',
    });
    if (A.creatineKg) {
      W('creatine', {
        title: 'Creatine water',
        rows: [...(X.creatine ? [['Creatine', `from ${dayText(X.creatine.from)}${creatine?.dose ? `, ${creatine.dose} a day` : ''}`] as [string, string]] : []), ['Water', `${wNum(A.creatineKg[0])} to ${wNum(A.creatineKg[1])} ${units.weight}, the first weeks`]],
        threshold: [['Step for it', 'none']],
        note: `The scale goes up with the water, not with fat: the rule takes no step for it${X.creatine ? ` until about ${dayText(X.creatine.until)}` : ''}.`,
        rule: 'diet.adjust',
      });
    }
  }

  // ---------------------------------------------------------------- the plan in a minute and the day
  const words = planWords(plan);
  if (plan.energy) {
    const e = plan.energy;
    const target = plan.level !== 'light' && e.targetKcal ? e.targetKcal : null;
    W('energy', {
      title: target ? `About ${kcal(target[0])} to ${kcal(target[1])} kcal a day` : `About ${kcal(e.maintenanceKcal)} kcal a day`,
      rows: [['What you burn', `about ${kcal(e.maintenanceKcal)} kcal`], ...(target ? [['The plan’s target', `${kcal(target[0])} to ${kcal(target[1])} kcal`] as [string, string]] : [['Deficit', 'none'] as [string, string]])],
      threshold: [],
      note: plan.level === 'light' ? 'A guide, not a target: at this level nothing is counted. The tape and the weight trend show whether it is right.' : 'The coach’s figure from your intake; the tape and the weight trend show whether it is right.',
      rule: 'diet',
    });
  }
  const rotation = read.files.plan === 'missing' ? null : buildSession(data, date, 'full', opts.pick ?? {}).session;
  const rotKind = rotation ? data.plan.types.find((t) => t.type === rotation.type)?.kind ?? null : null;
  const day = foodDay(plan, date, rotation && rotKind ? { type: rotation.type, name: rotation.name, kind: rotKind } : null);
  const checks = (plan.today?.optional ?? []).map((c) => ({ ...c, min: plan.pattern?.find((x) => x.id === c.id)?.min ?? null }));

  // ---------------------------------------------------------------- the pattern
  const pattern = plan.pattern?.length ? patternWeeks(plan.pattern, data.checkins.weekly, { since, date }) : null;
  if (pattern) {
    for (const line of pattern.value.lines) {
      W(`pt-${line.id}`, {
        title: line.name,
        rows: [['Target', line.target], ...(line.answered ? [['This cycle', `met ${line.met} of ${line.answered}`] as [string, string]] : [])],
        threshold: [['Answered', 'once a week, on Sunday']],
        note: 'Part of the heart-healthy pattern, for general health.',
        rule: 'diet.pattern',
      });
      pattern.value.sundays.forEach((s, i) => {
        const a = line.answers[i];
        const rec = pattern.value.records[i];
        W(`pt-${line.id}-${s}`, {
          title: `${line.name}, the week to ${dayText(s)}`,
          rows: [['Answer', a === true ? 'Met' : a === false ? 'Not met' : rec ? 'Not answered' : s === date ? 'Asked today' : s > date ? 'Not asked yet' : 'No check-in saved']],
          threshold: [['Target', line.target]],
          note: rec ? `From the Sunday check-in of ${dayText(rec)}.` : s >= date ? `Sunday’s check-in asks it on ${dayText(s)}.` : 'No Sunday check-in was saved for that week.',
          rule: 'diet.pattern',
        });
      });
    }
  }

  return envelope('food', {
    date,
    cycle,
    week,
    /** The profile's body units: the screens show weights and lengths in them. */
    units,
    file: { path: paths().eating, state },
    plan,
    level: { id: plan.level, label: LEVEL_LABEL[plan.level] },
    /** The plan's words (the coach's, or the stand-ins built from the goal and the level). */
    words,
    /** The day: the timeline's rows, the kind of day from the plan's rotation, the drinks. */
    day,
    /** The light checks on Today, each with its pattern line's min. */
    checks,
    protein: {
      floor,
      item: item ? { id: item.id, name: item.name, habit: item.habit ?? null, tickAt } : null,
      today,
      week: pWeek,
      weeks: pWeeks,
      planned,
    },
    trend: { from: chartFrom, to: chartTo, tapeDays: sched.days.filter((d) => d <= chartTo), nextTapes, weight: { trend, rate, direction }, waist },
    adjust,
    pattern,
    creatine: creatine ? { id: creatine.id, start: creatine.start, dose: creatine.dose ?? null } : null,
    why,
    notes,
  }, [], data.errors.filter((e) => e.code === 'eating'));
}

export type FoodReport = ReturnType<typeof buildFood>;
export type FoodWarning = VaultWarning;
