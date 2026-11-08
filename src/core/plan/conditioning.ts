// Step 7: conditioning (planning.md, rules.md concurrent training). Lifting
// days are spread over the week; extra training days carry conditioning, in
// the user's own cardio modes, rotated, at the short days' minutes when the
// profile has short days. One 4 x 4 interval session a week only when
// screening allows vigorous work and the goals include conditioning or
// health or the user chose intervals as a mode (not in the first phase at
// 65+), never the day before a heavy lower-body day; otherwise easy zone 2.
// Short easy finishers after long sessions. Steps rise by phase.

import { sessionKind } from '../adherence.ts';
import { DAY_SOURCES, loggedWeekdays, REAL_WEEK, type DaySource, type PlannedItem, type PlannedSession } from '../concurrent.ts';
import { dayText } from '../dates.ts';
import { explain, joinNotes, type Result } from '../reason.ts';
import { screeningCaps } from '../safety.ts';
import type { TimedWork, Weekday } from '../schema.ts';
import type { PlanContext } from './context.ts';

export const CONDITIONING = {
  intervalsMinutes: 30,
  /** The interval session: 4 rounds of 4 minutes hard with 3 minutes easy between; the session's other minutes easy around them. */
  intervals: { rounds: 4, workMin: 4, restMin: 3 },
  zone2MaxMinutes: 45,
  finisherFromMinutes: 60,
  steps: { base: 6000, active: 7000, perPhase: 1000, max: 10000 },
  activeMinutes: [150, 300],
} as const;

/** A conditioning session's minutes and structure, as the plan item's `timed`: the 4 × 4 intervals, or steady minutes. */
export function conditioningTimed(minutes: number, vigorous: boolean): TimedWork {
  return vigorous ? { minutes, ...CONDITIONING.intervals } : { minutes };
}

/** The daily steps for a phase (0-based): 7,000 with an active goal (6,000 without), 1,000 more each phase, at most 10,000 (heuristic). */
export function stepsGoal(goalKinds: Iterable<string>, phase: number): number {
  const active = [...goalKinds].some((g) => ACTIVE_GOALS.has(g));
  return Math.min(CONDITIONING.steps.max, (active ? CONDITIONING.steps.active : CONDITIONING.steps.base) + Math.max(0, phase) * CONDITIONING.steps.perPhase);
}

const WEEKDAY_INDEX: Record<Weekday, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
const SPREAD: Record<number, number[]> = { 1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5] };
/** Free days for conditioning, most preferred first. */
const EXTRA_ORDER = [5, 2, 6, 3, 1, 4, 0];

const ACTIVE_GOALS = new Set(['fat-loss', 'recomposition', 'health', 'conditioning']);

export interface DayLayout {
  lifting: number[];
  extra: number[];
}

export function layoutDays(ctx: PlanContext, liftingDays: number, extraDays: number): DayLayout {
  const fixed = (ctx.profile.availability.fixedDays ?? []).map((d) => WEEKDAY_INDEX[d]).sort((a, b) => a - b);
  const lifting = fixed.length >= liftingDays ? fixed.slice(0, liftingDays) : (SPREAD[Math.max(1, liftingDays)] ?? SPREAD[6]!);
  const extra = EXTRA_ORDER.filter((d) => !lifting.includes(d)).slice(0, extraDays);
  return { lifting, extra };
}

/** The days with where each came from (concurrent.ts's sources), aligned with `lifting` and `extra`. */
export interface UserDayLayout extends DayLayout {
  sources: { lifting: DaySource[]; extra: DaySource[] };
}

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** The smallest gap round the week between the days (7 for one day). */
function smallestGap(days: readonly number[]): number {
  const s = [...days].sort((a, b) => a - b);
  return s.length < 2 ? 7 : Math.min(...s.map((d, i) => (s[(i + 1) % s.length]! - d + 7) % 7 || 7));
}

/**
 * `k` of the candidate days added to `fixed`, spread as evenly round the
 * week as they allow (the largest smallest gap), then the most of `prefer`,
 * then the earliest.
 */
function spreadPick(candidates: readonly number[], k: number, fixed: readonly number[] = [], prefer: readonly number[] = []): number[] {
  let best: number[] = [];
  let key: [number, number] = [-1, -1];
  const visit = (start: number, chosen: number[]) => {
    if (chosen.length === k) {
      const g = smallestGap([...fixed, ...chosen]);
      const p = chosen.filter((d) => prefer.includes(d)).length;
      if (g > key[0] || (g === key[0] && p > key[1])) {
        key = [g, p];
        best = chosen;
      }
      return;
    }
    for (let i = start; i < candidates.length; i++) visit(i + 1, [...chosen, candidates[i]!]);
  };
  if (k > 0) visit(0, []);
  return best;
}

/**
 * The plan's days on the user's week (concurrent.ts: the log, else the
 * days the profile says they train, else the default layout), so the
 * conditioning is placed and the concurrent checks run on the days the user
 * trains. With the history (`--history`, opted in), each logged session
 * goes on the weekday it was done most often in the last 2 to 4 complete
 * weeks: the lifting sessions' days take the lifting slots (spread as evenly
 * as they allow when the log has more), the short sessions' days the
 * conditioning slots. A new plan's sessions are not the logged ones, so the
 * log gives days by kind, not by session; its weeks are the history's last
 * ones, not only the cycle's (a fresh start's baseline note opens the new
 * cycle before the plan is made). What the log does not fill comes from
 * `layoutDays` (the profile's days, else the spread; the conditioning's
 * usual order), a missing lifting day the one that keeps the week most
 * evenly spread.
 */
export function userLayoutDays(ctx: PlanContext, liftingDays: number, extraDays: number): Result<UserDayLayout> {
  const base = layoutDays(ctx, liftingDays, extraDays);
  const fromProfile = (ctx.profile.availability.fixedDays ?? []).length >= liftingDays && liftingDays > 0;
  const baseSource: DaySource = fromProfile ? 'available' : 'default';
  const history = ctx.history;
  const logged = history
    ? loggedWeekdays(
        history.sessions.flatMap((s) => {
          const kind = sessionKind(s);
          const id = s.plan?.template ?? s.template;
          return kind !== 'custom' && id ? [{ date: s.date, id: `${kind}:${id}` }] : [];
        }),
        ctx.today,
      )
    : null;
  const daysOfKind = (kind: 'lift' | 'short') => [...new Set(Object.entries(logged?.days ?? {}).filter(([id]) => id.startsWith(`${kind}:`)).map(([, d]) => d))].sort((a, b) => a - b);

  // Lifting: the log's days (spread when there are more than the plan lifts), then the base's or any day that keeps the spread.
  const fromLog = spreadPick(daysOfKind('lift'), Math.min(liftingDays, daysOfKind('lift').length));
  const all = [0, 1, 2, 3, 4, 5, 6];
  const fill = fromLog.length ? spreadPick(all.filter((d) => !fromLog.includes(d)), liftingDays - fromLog.length, fromLog, base.lifting) : base.lifting;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- needed: TypeScript 7, this project's compiler, rejects the line without it (the linter's TypeScript 5 reads the type differently)
  const lift = [...fromLog.map((d) => ({ d, s: 'log' as DaySource })), ...fill.map((d) => ({ d, s: base.lifting.includes(d) ? baseSource : ('default' as DaySource) }))].sort((a, b) => a.d - b.d);
  const lifting = lift.map((x) => x.d);

  // Conditioning: the log's short days that are not lifting days, then the usual order.
  const shortLog = daysOfKind('short').filter((d) => !lifting.includes(d)).slice(0, extraDays);
  const extraFill = (fromLog.length ? EXTRA_ORDER.filter((d) => !lifting.includes(d)) : base.extra).filter((d) => !shortLog.includes(d)).slice(0, extraDays - shortLog.length);
  const extra = [...shortLog, ...extraFill];
  const sources = { lifting: lift.map((x) => x.s), extra: [...shortLog.map((): DaySource => 'log'), ...extraFill.map((): DaySource => 'default')] };

  // The days in weekday order, grouped by source: "Mon, Wed (your logged weeks); Sun (the default layout)".
  const text = (ds: readonly number[], ss: readonly DaySource[]) => {
    const groups: { s: DaySource; d: string[] }[] = [];
    ds.map((d, i) => ({ d, s: ss[i]! })).sort((a, b) => a.d - b.d).forEach(({ d, s }) => {
      const g = groups.find((x) => x.s === s);
      if (g) g.d.push(WD[d]!);
      else groups.push({ s, d: [WD[d]!] });
    });
    return groups.map((g) => `${g.d.join(', ')} (${DAY_SOURCES[g.s]})`).join('; ');
  };
  const n = logged?.weeks.length ?? 0;
  return explain<UserDayLayout>({ lifting, extra, sources }, 'plan.week-days', { liftingDays, extraDays, history: Boolean(history), weeks: logged?.weeks ?? [], logged: logged?.counts ?? {}, fixedDays: ctx.profile.availability.fixedDays ?? null }, {
    threshold: { minWeeks: REAL_WEEK.minWeeks, maxWeeks: REAL_WEEK.maxWeeks },
    note: joinNotes(
      `Lifting on ${text(lifting, sources.lifting)}${extra.length ? `; conditioning on ${text(extra, sources.extra)}` : ''}.`,
      history && (n === 0 ? `The history has fewer than ${REAL_WEEK.minWeeks} complete weeks, so the log does not set the days.` : `The log's days: the weekday each logged session was done on most often in the ${n} complete weeks from ${dayText(logged!.weeks[0]!)}, a tie going to the latest.`),
    ),
  });
}

export interface ConditioningPlan {
  /** Per extra day: the cardio exercise id and minutes. */
  sessions: { day: number; exercise: string; minutes: number; vigorous: boolean }[];
  finisher: string | null;
  intervalsAllowed: boolean;
  steps: number[];
  activeMinutes: readonly [number, number] | null;
}

/** The user's cardio modes that fit the equipment, easy and interval, in their order; defaults when none fit. */
export function cardioModes(ctx: PlanContext): { easy: string[]; intervals: string[]; chosen: string[]; defaults: boolean; fallback: { easy: string; intervals: string } } {
  const chosen = (ctx.profile.preferences?.cardio ?? []).filter((id) => {
    const e = ctx.byId.get(id);
    return e && e.load === 'cardio' && e.equipment.every((q) => q === 'bodyweight' || ctx.equipment.has(q));
  });
  const easy = chosen.filter((id) => !id.includes('interval'));
  const intervals = chosen.filter((id) => id.includes('interval'));
  const machine = ctx.equipment.has('machine');
  const fallback = { easy: machine ? 'zone2-bike' : 'brisk-walk', intervals: machine ? 'bike-intervals-4x4' : 'hill-intervals-4x4' };
  return {
    easy: easy.length ? easy : [fallback.easy],
    intervals: intervals.length ? intervals : [fallback.intervals],
    chosen,
    defaults: chosen.length === 0,
    fallback,
  };
}

/**
 * The conditioning for one phase. `heavyLowerDays` are the weekdays with a
 * heavy lower-body lifting session: intervals never go on the day before one.
 */
export function conditioningPlan(ctx: PlanContext, days: DayLayout, minutes: number, phase: number, phases: number, heavyLowerDays: readonly number[], shortMinutes: number | null = null): Result<ConditioningPlan> {
  const caps = screeningCaps(ctx.outcome, { firstMesocycle: phase === 0 }).value;
  const modes = cardioModes(ctx);
  const chosenIntervals = modes.chosen.some((id) => id.includes('interval'));
  const wantsIntervals = ctx.goalKinds.has('conditioning') || ctx.goalKinds.has('health') || chosenIntervals;
  const intervalsAllowed = caps.vigorous && wantsIntervals && !(ctx.senior && phase === 0);
  const intervalDay = intervalsAllowed ? days.extra.find((d) => !heavyLowerDays.includes((d + 1) % 7)) : undefined;
  const easyMinutes = shortMinutes ?? Math.min(minutes, CONDITIONING.zone2MaxMinutes);
  // Easy days in weekday order rotate the chosen easy modes; the interval day rotates the interval modes by phase.
  let k = phase;
  const sessions = [...days.extra].sort((a, b) => a - b).map((day) => {
    const vigorous = day === intervalDay;
    const exercise = vigorous ? modes.intervals[phase % modes.intervals.length]! : modes.easy[k++ % modes.easy.length]!;
    return { day, exercise, minutes: vigorous ? Math.min(CONDITIONING.intervalsMinutes, shortMinutes ?? CONDITIONING.intervalsMinutes) : easyMinutes, vigorous };
  });
  const active = [...ctx.goalKinds].some((g) => ACTIVE_GOALS.has(g));
  const finisher = minutes >= CONDITIONING.finisherFromMinutes && active ? modes.easy[0]! : null;
  const base = active ? CONDITIONING.steps.active : CONDITIONING.steps.base;
  const steps = Array.from({ length: phases }, (_, p) => Math.min(CONDITIONING.steps.max, base + p * CONDITIONING.steps.perPhase));
  const name = (id: string) => ctx.byId.get(id)?.name ?? id;
  return explain<ConditioningPlan>(
    { sessions, finisher, intervalsAllowed, steps, activeMinutes: active ? CONDITIONING.activeMinutes : null },
    'plan.conditioning',
    { phase: phase + 1, extraDays: days.extra, vigorousAllowed: caps.vigorous, wantsIntervals, senior: ctx.senior, cardio: modes.chosen, shortMinutes },
    {
      note: joinNotes(
        sessions.length > 0 && (modes.defaults ? `No cardio mode in the profile fits the equipment: ${[...new Set(sessions.map((x) => name(x.exercise)))].join(' and ')}.` : `The conditioning days rotate the chosen modes: ${sessions.map((x) => name(x.exercise)).join(', ')}.`),
        sessions.length > 0 && shortMinutes !== null && `${shortMinutes} min each, the profile's short days.`,
        intervalDay !== undefined && `One 4 x 4 interval session a week (${ctx.goalKinds.has('conditioning') || ctx.goalKinds.has('health') ? 'the goals include conditioning or health' : 'intervals are a chosen cardio mode'}), on a day that is not before a heavy lower-body day.`,
        intervalsAllowed && intervalDay === undefined && (days.extra.length ? 'Intervals allowed, but every free day is before a heavy lower-body day: zone 2 instead.' : 'Intervals allowed but no free day: walking and steps carry the conditioning.'),
        !intervalsAllowed && wantsIntervals && (!caps.vigorous ? 'No vigorous work under this screening: zone 2 only.' : 'Age 65+: no intervals in the first phase.'),
        finisher && 'An 8-min easy finisher after lifting.',
        `Steps: ${steps.join(', ')} a day by phase (heuristic).`,
      ),
    },
  );
}

/** The planned week for the concurrent-training check (concurrent.ts); `lifts` are concurrent.ts's `liftItem`s, as `review` builds them. */
export function plannedWeek(
  lifting: { day: number; id: string; lifts: PlannedItem[]; finisher: boolean }[],
  cardio: ConditioningPlan['sessions'],
  /** Where each day came from (`userLayoutDays`): the flags' reasons name it. */
  sourceOf?: (day: number) => DaySource | undefined,
): PlannedSession[] {
  const src = (day: number) => {
    const s = sourceOf?.(day);
    return s ? { source: s } : {};
  };
  const week: PlannedSession[] = lifting.map((s) => ({
    id: `${s.id}@${s.day}`,
    day: s.day,
    ...src(s.day),
    items: [
      { kind: 'conditioning' as const, minutes: 5, label: 'easy warm-up' },
      ...s.lifts,
      ...(s.finisher ? [{ kind: 'conditioning' as const, minutes: 8, label: 'zone 2 finisher' }] : []),
    ],
  }));
  for (const c of cardio) week.push({ id: `${c.exercise}@${c.day}`, day: c.day, ...src(c.day), items: [{ kind: 'conditioning', minutes: c.minutes, hard: c.vigorous, label: c.exercise }] });
  return week.sort((a, b) => a.day - b.day);
}
