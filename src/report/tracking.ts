// The reports for what is tracked and reminded: what is tracked (with each
// item's schedule, reminder and source in words), what is due now and today,
// each item's stats, and the one-time bring-over from Habit Nudges. Pure:
// the vault adapter's data and the tracking files in, the moment as input.

import type { VaultData } from '../adapters/vault/convert.ts';
import type { QuietHours, TrackingRead } from '../adapters/vault/tracking-read.ts';
import { dayMarks } from '../core/checkins.ts';
import { fixedOffsetClock, hhmm, type Moment } from '../core/clock.ts';
import type { CoachNow } from '../core/coach-steps.ts';
import { addDays, type IsoDate } from '../core/dates.ts';
import { deskHours, deskRoutine, planDeskBreaks, type DeskRoutine } from '../core/desk-breaks.ts';
import { bringOverFromNudges } from '../core/habit-import.ts';
import { bodyParts, DEFAULT_NUDGE_SETTINGS, dueNow, dueToday, quietHolds, trainingDays, type NudgeSettings, type TrainingToday } from '../core/nudges.ts';
import { weekAt } from '../core/plan.ts';
import { isProteinItem, proteinForProfile, type ProteinTarget } from '../core/protein.ts';
import type { Reason, Result } from '../core/reason.ts';
import type { Program, TrackedItem, Tracking } from '../core/schema.ts';
import { deskTimeHistory, hm, sittingDays, type SittingDay } from '../core/sitting.ts';
import { itemStats, pauseNow, scheduleText, type StatsContext } from '../core/tracking.ts';
import { weightTrend } from '../core/weight.ts';

/**
 * Today's training: the days with a logged session, whether the plan has one
 * today, the Workout tick, a rest or missed mark (the day's own, else the
 * Sunday check-in's) and whether the Sunday check-in says today was trained
 * but not logged.
 */
export function trainingToday(data: VaultData, date: IsoDate): TrainingToday {
  const logged = new Set(data.sessions.filter((s) => s.date <= date).map((s) => s.date));
  const week = weekAt(data.program, date);
  const m = dayMarks(data.checkins.daily, data.checkins.weekly, date)(date);
  return {
    logged,
    plannedToday: Boolean(week && week.sessions.length),
    workoutTicked: m?.trained === true,
    restMarked: m?.mark === 'rest',
    missedMarked: m?.mark === 'missed',
    confirmedTrained: m?.confirmed === true,
  };
}

/** The protein range by goal at the trend weight (core/protein.ts): the protein item's gram target is its floor. */
export function proteinFor(data: VaultData, date: IsoDate): Result<ProteinTarget> {
  const since = data.plan.cycleStart ?? undefined;
  const latest = weightTrend(data.body.weights, since ? { through: date, since } : { through: date }).value.latest;
  return proteinForProfile(data.profile, latest ? latest.trend : null, date);
}

/** The protein item's gram target (the floor of the protein range at the trend weight), or null without weigh-ins. */
export const proteinFloor = (data: VaultData, date: IsoDate): number | null => proteinFor(data, date).value.targetG;

const WHEN: Record<string, string> = { morning: 'morning', midday: 'midday', evening: 'evening', bedtime: 'bedtime', training: 'with training', time: 'at a set time', day: 'through the day' };

/** An item's reminder in words: "09:00", "when you log a session", "every 2 h, 09:00 to 21:00", "a card at 5 h 30 of 6 h". */
export function reminderText(item: TrackedItem): string {
  const r = item.reminder;
  if (item.kind === 'standup') return `after ${item.standup!.sitMinutes} min of active sitting`;
  if (item.kind === 'desk') return 'a card at each break';
  if (!r) return 'off';
  if (r.afterLog) return 'when you log a session';
  if (r.every) return `every ${r.every % 60 === 0 ? `${r.every / 60} h` : `${r.every} min`}, ${r.from} to ${r.to}`;
  if (r.atMinutes || r.stretch) return [r.atMinutes ? `a card at ${hm(r.atMinutes)} of ${hm(item.sitting!.limitMinutes)}` : '', r.stretch ? `when a stretch reaches ${item.sitting!.stretchMaxMinutes} min` : ''].filter(Boolean).join(', ');
  return r.at ?? 'off';
}

/**
 * What an item asks for, in words: the dose, the target, the stand-up, the
 * routine, the limits. A desk-break item's routine is `desk` (deskRoutine's:
 * the plan's times when it follows the plan, said so) when given, else its own.
 */
export function amountText(item: TrackedItem, desk?: Pick<DeskRoutine, 'every' | 'from' | 'to' | 'minutes' | 'source'> | null): string {
  switch (item.kind) {
    case 'supplement':
      return item.dose ?? '';
    case 'tick':
      return item.goal ? `${item.goal.amount} ${item.goal.unit}` : (item.means ?? '');
    case 'amount':
      return `${item.amount!.target} ${item.amount!.unit} a day`;
    case 'standup':
      return `stand ${item.standup!.standMinutes} min after ${item.standup!.sitMinutes}, ${item.standup!.targetMinutes} min a day`;
    case 'sitting':
      return `under ${hm(item.sitting!.limitMinutes)} a day, no stretch over ${item.sitting!.stretchMaxMinutes} min`;
    case 'desk': {
      const d = desk ?? { ...item.desk!, source: 'item' as const };
      return `about ${d.minutes} min, every ${d.every} min, ${deskHours(d)}`;
    }
  }
}

/** A desk-break item's routine (the plan's when it follows the plan), or null for any other item. */
export const deskOf = (item: TrackedItem, program: Pick<Program, 'deskBreaks'> | null): DeskRoutine | null => (item.kind === 'desk' && item.desk ? deskRoutine(item, program).value : null);

export const sourceText = (item: TrackedItem): string => (item.source.by === 'coach' ? 'Suggested by your coach' : item.source.from ? `Added by you, from ${item.source.from}` : 'Added by you');

/** The plugin's quiet hours as the reminder rules take them: null when they are off (as the plugin passes them). */
export const quietSetting = (q: Pick<QuietHours, 'on' | 'from' | 'to'>): NudgeSettings['quiet'] => (q.on ? { from: q.from, to: q.to } : null);

/** The quiet hours, and every reminder whose card falls due inside them (held: later, or never), each with its reason; "Did you train today?" at the plugin's setting (else its default). */
function quietSection(data: VaultData, tracking: Tracking | null, hours: QuietHours, didYouTrain?: NudgeSettings['didYouTrain']) {
  return { hours, held: quietHolds({ tracking, program: data.program, ...(didYouTrain ? { settings: { didYouTrain } } : {}) }, quietSetting(hours)) };
}

/**
 * What is tracked: every item in words, the open suggestions, the check-in
 * reminders and the body record; with the plugin's quiet hours, each item
 * whose card they hold (`quiet`, else null) and the section listing them
 * (with "Did you train today?" at `didYouTrain`, the plugin's setting).
 */
export function buildTracked(data: VaultData, tr: TrackingRead, date: IsoDate, opts: { quiet?: QuietHours; didYouTrain?: NudgeSettings['didYouTrain'] } = {}) {
  const t = tr.tracking;
  const quiet = opts.quiet ? quietSection(data, t, opts.quiet, opts.didYouTrain) : null;
  const items = (t?.items ?? []).map((item) => {
    const desk = item.kind === 'desk' ? deskRoutine(item, data.program) : null;
    return {
      id: item.id,
      kind: item.kind,
      name: item.name,
      schedule: scheduleText(item.schedule),
      when: item.kind === 'standup' ? (item.standup!.hours ? `${item.standup!.hours[0]} to ${item.standup!.hours[1]}` : 'all day') : item.kind === 'desk' ? deskHours(desk!.value) : item.kind === 'sitting' ? 'all day' : item.when === 'training' ? `${item.whenDetail === 'before' ? 'before' : 'after'} the session` : (WHEN[item.when ?? ''] ?? null),
      asks: amountText(item, desk?.value),
      reminder: reminderText(item),
      start: item.start,
      paused: pauseNow(item, date),
      habit: item.habit ?? null,
      source: { text: sourceText(item), ...item.source },
      note: item.note ?? null,
      ...(desk ? { desk: desk.value, deskReason: desk.reason } : {}),
      ...(quiet ? { quiet: quiet.held.find((h) => h.value.item === item.id) ?? null } : {}),
      item,
    };
  });
  const parts = bodyParts({ tracking: t, nudges: tr.nudges, body: tr.body, photoFolders: tr.photoFolders, program: data.program }, date);
  const protein = proteinFor(data, date);
  // With an eating plan, the protein item is ticked at the plan's floor (as the Food tab, the diet job and `eating` keep it); else at the engine's target.
  const plan = data.eatingPlan;
  const target = plan ? plan.protein.floorG : protein.value.targetG;
  const proteinItems = (t?.items ?? []).filter(isProteinItem).map((x) => ({ id: x.id, goal: x.goal?.amount ?? null, follows: target !== null && x.goal?.amount === target, by: x.source.by }));
  const behind = proteinItems.filter((x) => !x.follows && x.by === 'coach');
  return {
    date,
    file: 'Coach/tracking.json',
    exists: tr.files.tracking !== 'missing',
    items,
    suggestions: (t?.suggestions ?? []).filter((s) => s.state === 'open').map((s) => ({ id: s.id, on: s.on, name: s.item.name, kind: s.item.kind, asks: amountText(s.item, deskOf(s.item, data.program)), why: s.item.source.why ?? null })),
    morning: t?.morning ?? null,
    bodyRecord: { setting: t?.bodyRecord ?? null, parts: [parts.tape, parts.photos, parts.tests] },
    deskBreaks: planDeskBreaks(data.program),
    ...(quiet ? { quiet } : {}),
    bringOver: t?.bringOver ?? null,
    protein: {
      ...protein,
      /** What the protein item is compared with: the eating plan's floor when there is a plan (Coach/eating-plan.json), else the engine's target at the trend weight. */
      compare: { floorG: target, source: plan ? ('eating-plan' as const) : ('engine' as const) },
      items: proteinItems,
      note: !proteinItems.length
        ? 'No protein item is tracked.'
        : plan
          ? behind.length
            ? `The eating plan's floor is ${target} g a day (Coach/eating-plan.json); ${behind.map((x) => `${x.id} says ${x.goal ?? 'none'}`).join(', ')}. The plan sets the item's floor: the diet job sets the two together.`
            : `The protein item${proteinItems.length > 1 ? 's follow' : ' follows'} the eating plan's floor (${target} g a day)${proteinItems.some((x) => x.by === 'user' && !x.follows) ? ', except the one added by you' : ''}.`
          : target === null
            ? 'No trend weight yet, so the engine has no gram target for the protein item.'
            : behind.length
              ? `The protein range's floor is ${target} g a day now; ${behind.map((x) => `${x.id} says ${x.goal ?? 'none'}`).join(', ')}: \`track protein --write\` moves the coach's item to it.`
              : `The protein item${proteinItems.length > 1 ? 's follow' : ' follows'} the target (${target} g a day)${proteinItems.some((x) => x.by === 'user' && !x.follows) ? ', except the one added by you' : ''}.`,
    },
  };
}

/** Sitting per day for the stats and today, from Coach/sitting.json and the work timer's desk time. */
function sittingMap(tr: TrackingRead, from: IsoDate, to: IsoDate, offsetMinutes: number): Map<IsoDate, SittingDay> {
  const history = tr.workTimer ? deskTimeHistory(tr.workTimer, fixedOffsetClock(offsetMinutes)) : null;
  return new Map(sittingDays(tr.sitting, history, from, to).map((d) => [d.date, d]));
}

/**
 * What is due now (the reminder cards, as the plugin would offer them on
 * this Mac, without its stand-up count or a sitting stretch still being
 * counted) and the Due today summary. With the plugin's quiet hours, no
 * card inside them (dueNow's own rule), and `quiet` lists every reminder
 * they hold. With the coach step (`opts.coach`, coachStepsOf's `now`), the
 * "Ask the coach" card at 18:00 and Due today's `coach`, as Pahlavan has them.
 */
export function buildDue(data: VaultData, tr: TrackingRead, now: Moment, opts: { settings?: Partial<NudgeSettings>; offsetMinutes?: number; quiet?: QuietHours; coach?: CoachNow | null } = {}) {
  const training = trainingToday(data, now.date);
  const today = sittingMap(tr, now.date, now.date, opts.offsetMinutes ?? 0).get(now.date)!;
  const settings = { ...DEFAULT_NUDGE_SETTINGS, ...(opts.quiet ? { quiet: quietSetting(opts.quiet) } : {}), ...opts.settings };
  const input = { now, tracking: tr.tracking, nudges: tr.nudges, body: tr.body, photoFolders: tr.photoFolders, habits: tr.habits, program: data.program, training, settings, sitting: { today, current: null }, coach: opts.coach ?? null };
  return { date: now.date, time: hhmm(now.minutes), due: dueNow(input), today: dueToday(input), ...(opts.quiet ? { quiet: quietSection(data, tr.tracking, opts.quiet, settings.didYouTrain) } : {}) };
}

export interface HabitStatsReport {
  date: IsoDate;
  items: (ReturnType<typeof itemStats> & { name: string; unit: 'days' | 'sessions' })[];
  tiles: { last30: { done: number; due: number; pct: number | null; active: number }; longest: { item: string | null; name: string | null; days: number }; today: { done: number; due: number } };
  reason: Reason;
}

/** Each item's streak, 30-day adherence and 26-week grid (sitting: its 4-week bars), and the section's three tiles. */
export function buildHabitStats(data: VaultData, tr: TrackingRead, date: IsoDate, opts: { item?: string; offsetMinutes?: number } = {}): HabitStatsReport {
  const all = tr.tracking?.items ?? [];
  const items = opts.item ? all.filter((x) => x.id === opts.item) : all;
  const training = trainingToday(data, date);
  const from = addDays(date, -7 * 27);
  const sitting = items.some((x) => x.kind === 'sitting') ? sittingMap(tr, from, date, opts.offsetMinutes ?? 0) : undefined;
  const out = items.map((item) => {
    const desk = item.kind === 'desk' ? deskRoutine(item, data.program).value : null;
    const ctx: StatsContext = { tracking: tr.tracking, habits: tr.habits, desk, training: trainingDays(training, date), ...(sitting ? { sitting } : {}) };
    return { ...itemStats(item, ctx), name: item.name, unit: item.schedule.kind === 'training' ? ('sessions' as const) : ('days' as const) };
  });
  const active = out.filter((x) => !x.paused);
  const due = active.reduce((t, x) => t + x.adherence.value.due, 0);
  const done = active.reduce((t, x) => t + x.adherence.value.done, 0);
  const top = [...active].sort((a, b) => b.streak.value - a.streak.value)[0];
  const todayDue = active.filter((x) => x.kind !== 'sitting' && x.today.state !== 'off' && x.today.state !== 'none');
  return {
    date,
    items: out,
    tiles: {
      last30: { done, due, pct: due ? done / due : null, active: active.length },
      longest: { item: top?.item ?? null, name: top?.name ?? null, days: top?.streak.value ?? 0 },
      today: { done: todayDue.filter((x) => x.today.state === 'taken').length, due: todayDue.length },
    },
    reason: { rule: 'habits', title: 'Habits', inputs: { date, items: out.length }, note: `${out.length} item(s); the last 30 days ${due ? `${Math.round((done / due) * 100)} %` : 'not due yet'} across ${active.length} active.` },
  };
}

/** The one-time offer from Habit Nudges, with what Pahlavan tracks already marked. */
export function buildBringOver(data: VaultData, tr: TrackingRead, date: IsoDate) {
  const offer = bringOverFromNudges({ settings: tr.nudgesSettings, habits: tr.habits ? { habits: tr.habits.habits, checkins: tr.habits.checkins } : null, today: date, proteinG: proteinFloor(data, date) });
  const have = new Set((tr.tracking?.items ?? []).flatMap((x) => [x.id, ...(x.habit ? [`habit:${x.habit}`] : [])]));
  const items = offer.value.items.map((x) => {
    const already = have.has(x.item.id) || (x.item.habit !== undefined && have.has(`habit:${x.item.habit}`));
    return { ...x, already, checked: x.checked && !already };
  });
  return {
    date,
    settingsFound: tr.files.nudgesSettings === 'found',
    done: tr.tracking?.bringOver ?? null,
    offer: { ...offer, value: { ...offer.value, items } },
  };
}
