// The eating plan's rules (Coach/eating-plan.json, the fitness-coach skill's
// diet.md): the protein days from the protein item and its linked habit,
// the planned protein against the floor, the waist and the weight trend
// against the plan's direction, the adjustment rule (one cupped hand of
// carbs at a time, read from the tape and the trend, never from one day)
// and the weekly pattern from the Sunday check-ins. Each returns its reason.
// Pure: the plan, the records and the date are inputs.

import { addDays, dayText, daysBetween, mondayOf, type IsoDate } from './dates.ts';
import { explain, type Result } from './reason.ts';
import type { AdjustApplied, AdjustRule, AdjustStep, EatingLevel, EatingPlan, GoalKind, PatternLine, RateBand, TapeEntry, TrackedItem, Tracking, WeeklyCheckin, WeighIn } from './schema.ts';
import { dayValue, type HabitsView } from './tracking.ts';
import { RATE_BANDS, weightRate, weightTrend, type WeightRate } from './weight.ts';
import { inLength, METRIC, type BodyUnits } from './units.ts';

/** The level as the Food tab names it: the Light level is "Hand portions" (the plan's light weeks are something else). */
export const LEVEL_LABEL: Readonly<Record<EatingLevel, string>> = { light: 'Hand portions', standard: 'Protein and calories', full: 'Every macro' };

export const DIET = {
  /** Losing faster than this share of body weight a week sets off "one back", unless the plan's step says otherwise. */
  backPctPerWeek: -0.01,
  /** How long creatine's water counts as "the first weeks", unless the plan says (H). */
  creatineWeeks: 4,
  /** The waist's weeks need this many weeks fewer than its length between its first and last tape (the intake's tape can be a day off a tape Sunday). */
  windowSlackWeeks: 1,
} as const;

/** "2 Nov": a date without its weekday. */
export const shortDay = (date: IsoDate): string => dayText(date).replace(/^\S+ /, '');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const signed = (v: number, dp = 1) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(dp)}`;
const and = (xs: readonly string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

// ---------------------------------------------------------------- planned protein

export interface PlannedProtein {
  /** The day's planned protein with each meal's low and high figure. */
  lo: number;
  hi: number;
  floor: number;
  top: number;
  /** How far the low figure clears the floor (negative: under it). */
  over: number;
  /** Each meal in order, with the running total of the low figures before it. */
  meals: { id: string; name: string; lo: number; hi: number; from: number }[];
  /** The day without the hardest meal (the fallbacks' meal), and whether that puts it under the floor. */
  without: { id: string; name: string; g: number; under: boolean } | null;
}

/** The meals' rough protein summed, against the floor and the range: a guide at the Light level, never a count. */
export function plannedProtein(plan: Pick<EatingPlan, 'meals' | 'protein' | 'fallbacks'>): Result<PlannedProtein> {
  let from = 0;
  const meals = plan.meals.map((m) => {
    const out = { id: m.id, name: m.name, lo: m.proteinG[0], hi: m.proteinG[1], from };
    from += m.proteinG[0];
    return out;
  });
  const lo = meals.reduce((a, m) => a + m.lo, 0);
  const hi = meals.reduce((a, m) => a + m.hi, 0);
  const floor = plan.protein.floorG;
  const top = plan.protein.rangeG[1];
  const hard = plan.fallbacks ? meals.find((m) => m.id === plan.fallbacks!.meal) : undefined;
  const without = hard ? { id: hard.id, name: hard.name, g: lo - hard.lo, under: lo - hard.lo < floor } : null;
  const span = lo === hi ? `About ${lo} g` : `About ${lo} g with the smallest figures, ${hi} with the biggest`;
  const note = [
    `${span}: ${lo >= floor ? `${lo - floor} g over the floor of ${floor} g` : `${floor - lo} g under the floor of ${floor} g`}.`,
    without?.under ? `A missed ${without.name.toLowerCase()} puts the day under it, which is why the fallbacks matter.` : '',
  ].filter(Boolean).join(' ');
  return explain({ lo, hi, floor, top, over: lo - floor, meals, without }, 'diet.meals', { meals: meals.map((m) => ({ id: m.id, g: [m.lo, m.hi] })), floor, top }, {
    threshold: { floorG: floor, rangeG: plan.protein.rangeG, perMealG: plan.protein.perMealG },
    note,
  });
}

// ---------------------------------------------------------------- protein days

export type ProteinDayState = 'ticked' | 'unticked' | 'open' | 'future' | 'before';

export interface ProteinDay {
  date: IsoDate;
  state: ProteinDayState;
  /** Where a tick came from: Pahlavan's own log or the linked habit. */
  via: 'pahlavan' | 'habit' | null;
}

export interface ProteinDaysInput {
  item: TrackedItem | null;
  tracking: Pick<Tracking, 'days'> | null;
  habits: HabitsView | null;
  date: IsoDate;
  /** The cycle start: days before it are not this cycle's. */
  since: IsoDate | null;
}

function dayOf(input: ProteinDaysInput, d: IsoDate): ProteinDay {
  const start = [input.since, input.item?.start ?? null].filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
  if (start && d < start) return { date: d, state: 'before', via: null };
  if (d > input.date) return { date: d, state: 'future', via: null };
  const v = input.item ? dayValue(input.item, d, { tracking: input.tracking, habits: input.habits }) : null;
  if (v?.done) return { date: d, state: 'ticked', via: v.via };
  return { date: d, state: d === input.date ? 'open' : 'unticked', via: null };
}

/**
 * The week's protein days, Monday to Sunday: a day is ticked when the
 * protein item is (in Pahlavan's log or the linked habit, as the
 * Habits stats read it). An unticked day is not counted as missed: the
 * Sunday check-in asks about it.
 */
export function proteinWeek(input: ProteinDaysInput & { floorG: number }): Result<{ from: IsoDate; to: IsoDate; days: ProteinDay[]; ticked: number; soFar: number; item: string | null }> {
  const from = mondayOf(input.date);
  const days = Array.from({ length: 7 }, (_, i) => dayOf(input, addDays(from, i)));
  const ticked = days.filter((d) => d.state === 'ticked').length;
  const soFar = days.filter((d) => d.state !== 'future' && d.state !== 'before').length;
  const open = days.some((d) => d.state === 'open');
  const note = input.item
    ? `${ticked} of ${soFar} day${soFar === 1 ? '' : 's'} so far ticked at ${input.floorG} g or more${open ? ', today open' : ''}. An unticked day is not counted as missed: the Sunday check-in asks about it.`
    : 'No protein item is tracked, so no day can be ticked: the diet job adds one (a tick named Protein, linked to the Protein habit).';
  return explain({ from, to: addDays(from, 6), days, ticked, soFar, item: input.item?.id ?? null }, 'diet.protein-days', { item: input.item?.id ?? null, habit: input.item?.habit ?? null, week: from, since: input.since }, {
    threshold: { proteinDayG: input.floorG },
    note,
  });
}

export interface ProteinWeekCount {
  /** The week's number from the cycle start (1 is the cycle's first week). */
  n: number;
  from: IsoDate;
  to: IsoDate;
  ticked: number;
  /** The cycle's days in that week. */
  days: number;
  /** The Sunday check-in's protein days for that week (the ticks plus the unticked days it says reached the floor, `proteinExtra`), when saved. */
  checkin: number | null;
}

/** The cycle's complete weeks before this one: each week's ticks, and the check-in's count beside them. */
export function proteinWeeks(input: ProteinDaysInput & { checkins: readonly WeeklyCheckin[] }): Result<ProteinWeekCount[]> {
  const out: ProteinWeekCount[] = [];
  const thisWeek = mondayOf(input.date);
  if (input.since) {
    let n = 1;
    for (let m = mondayOf(input.since); m < thisWeek; m = addDays(m, 7), n++) {
      const days = Array.from({ length: 7 }, (_, i) => dayOf(input, addDays(m, i)));
      const rec = input.checkins.find((w) => (w.weekStart ?? w.weekOf) === m || w.date === addDays(m, 6));
      const ticked = days.filter((d) => d.state === 'ticked').length;
      const inCycle = days.filter((d) => d.state !== 'before').length;
      // The answer adds to the ticks as they are now (a tick after the check-in counts once); a record from before 0.14.0 holds the total.
      const checkin = typeof rec?.proteinExtra === 'number' ? Math.min(inCycle, ticked + rec.proteinExtra) : typeof rec?.proteinDays === 'number' ? rec.proteinDays : null;
      out.push({ n, from: m, to: addDays(m, 6), ticked, days: inCycle, checkin });
    }
  }
  return explain(out, 'diet.protein-days', { since: input.since, weeks: out.length }, {
    note: out.length ? `${out.length} complete week${out.length === 1 ? '' : 's'} this cycle: ${out.map((w) => `week ${w.n} ${w.ticked} ticked${w.checkin !== null && w.checkin !== w.ticked ? ` (${w.checkin} at the check-in)` : ''}`).join(', ')}.` : 'The first week of this cycle: no complete week yet.',
  });
}

// ---------------------------------------------------------------- the trend

/** What each goal asks of the waist and the weight (the plan's direction). */
export const DIRECTION: Readonly<Record<string, { waist: 'down' | 'flat' | null; weight: string }>> = {
  recomposition: { waist: 'down', weight: 'flat to slightly down' },
  'fat-loss': { waist: 'down', weight: 'down, 0.5 to 1 % a week' },
  gain: { waist: null, weight: 'up, 0.25 to 0.5 % a week' },
  maintenance: { waist: 'flat', weight: 'flat' },
};

const toCm = (t: TapeEntry) => (t.waist === undefined ? null : t.unit === 'in' ? t.waist * 2.54 : t.waist);

export interface WaistPoint {
  date: IsoDate;
  waist: number;
}

/** The waist entries (cm) from `since` through `through`, in date order. */
export function waistPoints(tape: readonly TapeEntry[], since: IsoDate | null, through: IsoDate): WaistPoint[] {
  return tape
    .filter((t) => (!since || t.date >= since) && t.date <= through)
    .map((t) => ({ date: t.date, waist: toCm(t) }))
    .filter((t): t is WaistPoint => t.waist !== null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export interface WaistTrend {
  points: WaistPoint[];
  first: WaistPoint | null;
  last: WaistPoint | null;
  changeCm: number | null;
  flatCm: number;
  /** down or up past the flat band, flat inside it; one: a single tape; none: no tape. */
  direction: 'none' | 'one' | 'down' | 'flat' | 'up';
  /** Against the goal's direction for the waist: in it, not yet, or not judged (one tape, or a goal without one). */
  status: 'early' | 'in' | 'flat' | 'out' | 'none';
}

/** The waist since the cycle start against the plan's direction; flat is within `flatCm` of the first tape. */
export function waistTrend(tape: readonly TapeEntry[], opts: { since: IsoDate | null; through: IsoDate; flatCm: number; goal: GoalKind; units?: BodyUnits }): Result<WaistTrend> {
  const u = opts.units ?? METRIC;
  const L = (cm: number, f: (n: number) => string = String) => `${f(u.length === 'cm' ? cm : Math.round(inLength(cm, u) * 10) / 10)} ${u.length}`;
  const points = waistPoints(tape, opts.since, opts.through);
  const first = points[0] ?? null;
  const last = points.at(-1) ?? null;
  const want = DIRECTION[opts.goal]?.waist ?? null;
  const changeCm = first && last && points.length > 1 ? Math.round((last.waist - first.waist) * 100) / 100 : null;
  const direction: WaistTrend['direction'] = !last ? 'none' : changeCm === null ? 'one' : Math.abs(changeCm) <= opts.flatCm + 1e-9 ? 'flat' : changeCm < 0 ? 'down' : 'up';
  const status: WaistTrend['status'] = !want ? 'none' : direction === 'none' || direction === 'one' ? 'early' : direction === want ? 'in' : direction === 'flat' ? 'flat' : 'out';
  const note = !last
    ? `No tape since ${opts.since ? shortDay(opts.since) : 'the start'}.`
    : changeCm === null
      ? `One tape so far: ${L(last.waist)} on ${dayText(last.date)}.${want ? ` The plan's direction: ${want}.` : ''}`
      : direction === 'flat'
        ? `Flat so far: ${L(changeCm, signed)} since ${shortDay(first!.date)}, within ±${L(opts.flatCm)}.`
        : direction === 'down'
          ? `Down ${L(Math.abs(changeCm), (n) => n.toFixed(1))} since ${shortDay(first!.date)}${want === 'down' ? ': the plan’s direction' : ''}.`
          : `Up ${L(changeCm, (n) => n.toFixed(1))} since ${shortDay(first!.date)}.`;
  return explain({ points, first, last, changeCm, flatCm: opts.flatCm, direction, status }, 'diet.waist', { tapes: points.length, since: opts.since, first: first?.date ?? null, last: last?.date ?? null, goal: opts.goal }, {
    threshold: { flatCm: opts.flatCm, direction: want },
    note,
  });
}

/** The weight trend's rate against the plan's goal band (rules.md): early until the rate exists. */
export function weightDirection(rate: WeightRate | null, goal: GoalKind, band?: RateBand | null): Result<{ status: 'early' | 'in' | 'below' | 'above'; band: RateBand | null; want: string | null }> {
  const b = band ?? (RATE_BANDS as Record<string, RateBand | undefined>)[goal] ?? null;
  const want = DIRECTION[goal]?.weight ?? null;
  const pct = (v: number) => `${signed(v * 100, 2)} %`;
  if (!rate || !b) {
    return explain({ status: 'early' as const, band: b, want }, 'diet.weight', { goal, rate: null }, {
      threshold: b,
      note: rate ? 'No goal band for this goal.' : `A rate needs 14 days and 8 weigh-ins.${want ? ` The plan's direction: ${want}.` : ''}`,
    });
  }
  const value = b.unit === 'pct' ? rate.pctPerWeek : rate.kgPerWeek;
  const status = value < b.lo ? 'below' : value > b.hi ? 'above' : 'in';
  return explain({ status, band: b, want }, 'diet.weight', { goal, kgPerWeek: rate.kgPerWeek, pctPerWeek: rate.pctPerWeek }, {
    threshold: b,
    note: status === 'in'
      ? `${pct(rate.pctPerWeek)} a week, in the band: ${want ?? 'as the goal wants'}. Act only after two weekly readings out of it.`
      : `${pct(rate.pctPerWeek)} a week, ${status === 'below' ? 'falling faster than the band' : 'above the band'}; act only after two weekly readings out of it.`,
  });
}

// ---------------------------------------------------------------- the adjustment rule

export type AdjustWhy = 'before-first-check' | 'waiting-after-step' | 'tape-due' | 'too-fast' | 'short-span' | 'creatine' | 'flat-not-falling' | 'no-rate' | 'falling' | 'waist-down' | 'waist-up' | 'no-tape';

export interface AdjustInput {
  rule: AdjustRule;
  /** The plan's review date: the first check. */
  review: IsoDate;
  date: IsoDate;
  /** The cycle start: tapes and weigh-ins before it are not read. */
  since: IsoDate | null;
  tape: readonly TapeEntry[];
  weighIns: readonly WeighIn[];
  /** The scheduled tape days (the body record's schedule), in date order. */
  tapeDays: readonly IsoDate[];
  /** When creatine started: the plan's `creatineFrom`, else the tracked creatine item's start. */
  creatineFrom: IsoDate | null;
  /** The units the notes write the waist in (kg and cm without them). */
  units?: BodyUnits;
}

export interface AdjustOutcome {
  /** waiting: the first check (or the one after a step) is ahead; due: its date came, its tape is not in; checked: decided on `checkedOn`'s tape. */
  status: 'waiting' | 'due' | 'checked';
  checkedOn: IsoDate | null;
  /** The step the rule takes, or null: no change. */
  step: AdjustStep | null;
  why: AdjustWhy;
  /** The next check: a tape day. */
  next: IsoDate | null;
  /** The tape days the next check reads, from today to it. */
  before: IsoDate[];
  span: { from: IsoDate; to: IsoDate; first: WaistPoint | null; last: WaistPoint | null; changeCm: number | null; spanDays: number | null; enough: boolean; flat: boolean | null } | null;
  rate: { kgPerWeek: number; pctPerWeek: number; spanDays: number; weighIns: number } | null;
  trendKg: number | null;
  /** 1 % of the trend weight, in kg a week: losing faster than this sets off "back". */
  onePctKg: number | null;
  conditions: { flat: boolean | null; notFalling: boolean | null; tooFast: boolean | null };
  creatine: { from: IsoDate; until: IsoDate; active: boolean } | null;
  wait: { last: AdjustApplied; until: IsoDate } | null;
}

const firstOnOrAfter = (days: readonly IsoDate[], d: IsoDate) => days.find((x) => x >= d) ?? null;

/**
 * The plan's adjustment rule on the date. The first check is the review
 * date, read once its tape is in; after it, each tape day. At a check: losing
 * faster than 1 % of body weight a week takes the "back" step (one cupped
 * hand back); the waist flat (within `flatCm`) over `windowWeeks` and the
 * weight trend not falling takes the "less" step (one cupped hand of carbs
 * less a day), except while creatine's water lifts the scale (its first
 * weeks: no step for it); anything else is no change. After a step the
 * rule waits `waitWeeks` (the low end) before it checks again, and its
 * span of tape starts after the step.
 */
export function adjustCheck(input: AdjustInput): Result<AdjustOutcome> {
  const r = input.rule;
  const less = r.steps.find((s) => s.id === 'less') ?? null;
  const back = r.steps.find((s) => s.id === 'back') ?? null;
  const backPct = back?.pctPerWeek ?? DIET.backPctPerWeek;
  const last = (r.applied ?? []).filter((a) => a.date <= input.date).at(-1) ?? null;
  const waitDays = Math.round(r.waitWeeks[0] * 7);
  const waitUntil = last ? addDays(last.date, waitDays) : null;
  const checkStart = waitUntil && waitUntil > input.review ? waitUntil : input.review;
  const since = [input.since, last?.date ?? null].filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
  const tapes = waistPoints(input.tape, input.since, input.date);
  const checks = tapes.filter((t) => t.date >= checkStart);
  const creatineWeeks = r.creatineWeeks ?? DIET.creatineWeeks;
  const creatineAt = (d: IsoDate) => (input.creatineFrom ? { from: input.creatineFrom, until: addDays(input.creatineFrom, creatineWeeks * 7), active: d >= input.creatineFrom && d < addDays(input.creatineFrom, creatineWeeks * 7) } : null);
  const inputs = { review: input.review, date: input.date, since: input.since, tapes: tapes.map((t) => t.date), lastStep: last, creatineFrom: input.creatineFrom };
  const threshold = { windowWeeks: r.windowWeeks, flatCm: r.flatCm, backPctPerWeek: backPct, waitWeeks: r.waitWeeks, creatineWeeks };
  const wait = last && waitUntil ? { last, until: waitUntil } : null;

  if (!checks.length) {
    const next = firstOnOrAfter(input.tapeDays, checkStart) ?? checkStart;
    const due = input.date >= checkStart;
    const before = input.tapeDays.filter((d) => d > input.date && d <= next);
    const why: AdjustWhy = due ? 'tape-due' : last && waitUntil && waitUntil > input.review ? 'waiting-after-step' : 'before-first-check';
    const tapesText = before.length ? `, after the ${and(before.map(shortDay))} tape${before.length === 1 ? '' : 's'}` : '';
    const note = why === 'tape-due'
      ? `The check is due: it reads the tape of ${dayText(next)} once it is in.`
      : why === 'waiting-after-step'
        ? `One step on ${dayText(last!.date)} (${last!.step === 'less' ? 'one cupped hand of carbs less' : 'one cupped hand back'}): the next check waits at least ${plural(r.waitWeeks[0], 'week', 'weeks')}, until ${dayText(next)}${tapesText}.`
        : `No change yet: the first check is ${dayText(next)}${tapesText}. The tape every 2 weeks and the weight trend decide, never one day.`;
    return explain<AdjustOutcome>({ status: due ? 'due' : 'waiting', checkedOn: null, step: null, why, next, before: before.length ? before : [next], span: null, rate: null, trendKg: null, onePctKg: null, conditions: { flat: null, notFalling: null, tooFast: null }, creatine: creatineAt(input.date), wait }, 'diet.adjust', inputs, { threshold, note });
  }

  const checkedOn = checks.at(-1)!.date;
  // The waist's span: the tapes since the later of the cycle start and the last step, within the rule's weeks (and their slack) before the check.
  const winFrom = [since, addDays(checkedOn, -(r.windowWeeks + DIET.windowSlackWeeks) * 7)].filter((x): x is string => Boolean(x)).sort().at(-1)!;
  const win = tapes.filter((t) => t.date >= winFrom && t.date <= checkedOn);
  const wFirst = win[0] ?? null;
  const wLast = win.at(-1) ?? null;
  const spanDays = wFirst && wLast ? daysBetween(wFirst.date, wLast.date) : null;
  const enough = spanDays !== null && spanDays >= (r.windowWeeks - DIET.windowSlackWeeks) * 7;
  const changeCm = wFirst && wLast && win.length > 1 ? Math.round((wLast.waist - wFirst.waist) * 100) / 100 : null;
  const flat = changeCm === null ? null : Math.abs(changeCm) <= r.flatCm + 1e-9;
  const trend = weightTrend(input.weighIns, { through: checkedOn, ...(input.since ? { since: input.since } : {}) }).value;
  const rr = weightRate(trend).value;
  const rate = rr ? { kgPerWeek: rr.kgPerWeek, pctPerWeek: rr.pctPerWeek, spanDays: rr.spanDays, weighIns: rr.weighIns } : null;
  const trendKg = trend.latest?.trend ?? null;
  const tooFast = rate ? rate.pctPerWeek < backPct : null;
  const notFalling = rate ? rate.kgPerWeek >= 0 : null;
  const creatine = creatineAt(checkedOn);

  let step: AdjustStep | null = null;
  let why: AdjustWhy;
  if (back && tooFast) {
    step = back;
    why = 'too-fast';
  } else if (!enough) why = 'short-span';
  else if (flat && notFalling && less) {
    if (creatine?.active) why = 'creatine';
    else {
      step = less;
      why = 'flat-not-falling';
    }
  } else if (flat && notFalling === null) why = 'no-rate';
  else if (flat) why = 'falling';
  else why = (changeCm ?? 0) < 0 ? 'waist-down' : 'waist-up';

  const afterStep = step ? addDays(checkedOn, waitDays) : null;
  const next = afterStep ? (firstOnOrAfter(input.tapeDays, afterStep) ?? afterStep) : (input.tapeDays.find((d) => d > checkedOn) ?? null);
  const status: AdjustOutcome['status'] = next && next <= input.date && !step ? 'due' : 'checked';
  const weeks = spanDays === null ? '' : ` in ${Math.round(spanDays / 7)} weeks`;
  const u = input.units ?? METRIC;
  const L = (cm: number, f: (n: number) => string = String) => `${f(u.length === 'cm' ? cm : Math.round(inLength(cm, u) * 10) / 10)} ${u.length}`;
  const pct = rate ? `${signed(rate.pctPerWeek * 100, 2)} % a week` : '';
  const noteOf: Record<AdjustWhy, string> = {
    'before-first-check': '',
    'waiting-after-step': '',
    'tape-due': '',
    'no-tape': '',
    'too-fast': `Losing faster than ${Math.abs(backPct * 100)} % of body weight a week (${pct}): ${back?.then.toLowerCase() ?? 'one cupped hand back'}, then wait ${r.waitWeeks[0]} to ${r.waitWeeks[1]} weeks.`,
    'short-span': `The tapes span ${spanDays ?? 0} days of the ${r.windowWeeks} weeks the rule reads: no step until two tape intervals are in.`,
    creatine: `The waist is flat and the trend is not falling, but creatine started on ${dayText(creatine?.from ?? checkedOn)}: its water lifts the scale until about ${dayText(creatine?.until ?? checkedOn)}, and the rule takes no step for it.`,
    'flat-not-falling': `The waist is flat (${L(changeCm ?? 0, signed)}${weeks}, within ±${L(r.flatCm)}) and the trend is not falling (${pct}): ${less?.then.toLowerCase() ?? 'one cupped hand of carbs less a day'}, then wait ${r.waitWeeks[0]} to ${r.waitWeeks[1]} weeks.`,
    'no-rate': 'The waist is flat, but the weight trend has no rate yet (14 days and 8 weigh-ins): no step.',
    falling: `The waist is flat and the weight trend is falling (${pct}): the change is happening, so the portions stay.`,
    'waist-down': `The waist is down ${L(Math.abs(changeCm ?? 0), (n) => n.toFixed(1))}${weeks}, so the portions stay.`,
    'waist-up': `The waist is up ${L(changeCm ?? 0, (n) => n.toFixed(1))}${weeks}: the rule has no step for that; the coach reviews it with the plan.`,
  };
  const nextText = next ? ` Next check ${dayText(next)}${step ? `, at least ${plural(r.waitWeeks[0], 'week', 'weeks')} after the step` : ', after its tape'}.` : '';
  return explain<AdjustOutcome>({
    status,
    checkedOn,
    step,
    why,
    next,
    before: next ? [next] : [],
    span: { from: winFrom, to: checkedOn, first: wFirst, last: wLast, changeCm, spanDays, enough, flat },
    rate,
    trendKg,
    onePctKg: trendKg === null ? null : trendKg * Math.abs(backPct),
    conditions: { flat, notFalling, tooFast },
    creatine,
    wait,
  }, 'diet.adjust', { ...inputs, checkedOn, span: win.map((t) => t.date) }, {
    threshold,
    note: `${step ? `Checked ${dayText(checkedOn)}: ${step.then.toLowerCase()}.` : `Checked ${dayText(checkedOn)}: no change.`} ${noteOf[why]}${nextText}`,
  });
}

// ---------------------------------------------------------------- the pattern

export interface PatternWeeks {
  /** The Sundays shown, oldest first (the cycle's, the last `max`, this week's included). */
  sundays: IsoDate[];
  lines: { id: string; name: string; target: string; per: PatternLine['per']; answers: (boolean | null)[]; met: number; answered: number }[];
  /** Each Sunday's check-in date (null: no record for that week). */
  records: (IsoDate | null)[];
}

/**
 * The weekly pattern, as the Sunday check-ins answered it: per line, met
 * (true), not met (false) or not asked (null) for each of the cycle's
 * weeks, the last `max` of them. Display only: nothing here is ticked.
 */
export function patternWeeks(lines: readonly PatternLine[], checkins: readonly WeeklyCheckin[], opts: { since: IsoDate | null; date: IsoDate; max?: number }): Result<PatternWeeks> {
  const thisSunday = addDays(mondayOf(opts.date), 6);
  const first = opts.since ? addDays(mondayOf(opts.since), 6) : thisSunday;
  const all: IsoDate[] = [];
  for (let d = first; d <= thisSunday; d = addDays(d, 7)) all.push(d);
  const sundays = all.slice(-(opts.max ?? 6));
  const recs = sundays.map((s) => checkins.find((w) => w.date === s || (w.weekStart ?? w.weekOf) === addDays(s, -6)) ?? null);
  const out = lines.map((x) => {
    const answers = recs.map((r) => (r?.pattern && typeof r.pattern[x.id] === 'boolean' ? r.pattern[x.id]! : null));
    return { id: x.id, name: x.name, target: x.target, per: x.per, answers, met: answers.filter((a) => a === true).length, answered: answers.filter((a) => a !== null).length };
  });
  const answered = recs.filter((r) => r?.pattern && Object.keys(r.pattern).length).length;
  return explain({ sundays, lines: out, records: recs.map((r) => r?.date ?? null) }, 'diet.pattern', { since: opts.since, sundays, answered }, {
    note: answered ? `Answered at ${answered} Sunday check-in${answered === 1 ? '' : 's'} this cycle: ${out.map((l) => `${l.name.toLowerCase()} met ${l.met} of ${l.answered}`).join(', ')}.` : 'Not answered yet: the Sunday check-in asks one question, a tap per line, met this week or not.',
  });
}
