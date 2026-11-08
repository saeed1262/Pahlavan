// "At a glance" and the foldable sections, as signed off in
// mockups/glance-*.html: for each tab, a summary of two or three lines and
// one entry per section (its name, a plain line on what it shows, its
// one-line status for the folded bar, and the state it starts in). Built
// from the same reports the screens draw, never from the mockup's sample.
// Pure: the reports (and, for Today, what is due) are the inputs; the
// plugin draws the panel and keeps what the user opened and folded.

import { trimWords } from '../core/readiness.ts';
import type { CoachNow, CoachStep } from '../core/coach-steps.ts';
import { addDays, dayText, daysBetween, mondayOf, type IsoDate } from '../core/dates.ts';
import { shortDay } from '../core/diet.ts';
import { isMorningDone } from '../core/morning.ts';
import type { DueToday } from '../core/nudges.ts';
import { inLength } from '../core/units.ts';
import type { buildCheckin } from './checkin-screen.ts';
import type { buildFood } from './food.ts';
import type { buildPlan } from './plan-screen.ts';
import type { buildProgress } from './progress.ts';
import type { buildSession } from './session.ts';
import type { buildToday } from './today.ts';
import type { YourDay } from './your-day.ts';

/** A run of text: plain, or bold (the number or the word the line is about). */
export type Run = string | { b: string };

/** One summary line under "At a glance": an icon, its runs, and a flag for something to look at. */
export interface GlanceLine {
  icon: string;
  text: Run[];
  flag?: boolean;
}

/** One section of a tab, for the panel's list and its own fold. */
export interface GlanceSection {
  id: string;
  /** Its name, as its kicker reads. */
  title: string;
  /** What it shows, in a plain line ("What's on this tab"). */
  line: string;
  /** Its one-line status in plain words, shown when it is folded. */
  status: Run[];
  /** How it starts when the user has not chosen. */
  start: 'open' | 'folded';
  /** Something due or needing action: it starts open whatever was chosen on an earlier day. */
  due?: boolean;
}

export interface Glance {
  sums: GlanceLine[];
  sections: GlanceSection[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const and = (xs: readonly string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const lower = (t: string) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);
const signed = (v: number, dp = 1) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(dp)}`;
const clean = (t: string | null | undefined) => (t == null ? '' : String(t).replace(/\s*—\s*/g, ' · '));
const nfmt = (n: number) => n.toLocaleString('en-GB');
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekday = (d: IsoDate) => DAYS_LONG[new Date(`${d}T00:00:00Z`).getUTCDay()]!;
/** "in 2 days", "today", "tomorrow", "3 days ago". */
export const inDays = (from: IsoDate, d: IsoDate): string => {
  const n = daysBetween(from, d);
  return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n > 0 ? `in ${n} days` : n === -1 ? 'yesterday' : `${-n} days ago`;
};
/** Runs joined with " · ", empty parts left out. */
const dots = (...parts: (Run[] | null | false | undefined)[]): Run[] => parts.filter((p): p is Run[] => Boolean(p && p.length)).flatMap((p, i) => (i ? [' · ', ...p] : p));
/** "the week’s letter", "the mesocycle review", "the phase review". */
const stepWords = (c: Pick<CoachStep, 'kind' | 'title'>) => (c.kind === 'letter' ? 'the week’s letter' : `the ${c.title.toLowerCase()}`);
/** The coach step when it is due or still to do: Today's card and the Sunday check-in's next line. */
const asking = (c: CoachNow | null | undefined): CoachNow | null => (c && (c.state === 'due' || c.state === 'late') ? c : null);

// ================================================================ Food

type Food = ReturnType<typeof buildFood>;

/** How it's going in a line: the check's outcome, or how early it is, and the next check. */
export function goingStatus(m: Food): Run[] {
  if (!m.plan) return [];
  const p = m;
  const X = p.adjust?.value ?? null;
  const rate = p.trend.weight.rate.value;
  const waist = p.trend.waist.value;
  const cm = (v: number) => (p.units.length === 'cm' ? v : Math.round(inLength(v, p.units) * 10) / 10);
  let judge: Run[];
  if (X?.checkedOn && X.status === 'checked') {
    const when = X.checkedOn === p.date ? 'today' : shortDay(X.checkedOn);
    judge = [`Checked ${when}: `, { b: X.step ? lower(X.step.then) : 'no change' }];
  } else if (X?.status === 'due') judge = [{ b: 'The check is due' }, ': it reads the next tape'];
  else if (!rate || waist.changeCm === null) judge = [p.week.planWeek ? `Week ${p.week.planWeek}, too early to judge` : 'Too early to judge'];
  else judge = ['Waist ', { b: `${signed(cm(waist.changeCm))} ${p.units.length}` }, p.trend.weight.direction.value.status === 'in' ? ', the trend in the plan’s pace' : ', the trend out of the plan’s pace'];
  const next = X?.next ?? (p.plan.review >= p.date ? p.plan.review : null);
  return dots(judge, next ? [`next check ${shortDay(next)}`] : null);
}

/** The Food tab: the protein days, the day, the next check; Your plan in a minute open on the first visits (`early`). */
export function foodGlance(m: Food, opts: { early: boolean }): Glance {
  if (!m.plan) return { sums: [{ icon: 'info', text: ['No eating plan yet: run ', { b: '/fitness-coach diet' }, ' to make one.'] }], sections: [] };
  const p = m;
  const plan = p.plan;
  const wk = p.protein.week.value;
  const today = p.protein.today?.state ?? null;
  const P = p.protein.planned.value;
  const about = Math.round((P.lo + P.hi) / 2 / 5) * 5;
  const day = p.day;
  const kindWord = day.kind === 'lift' ? 'a lifting day' : day.kind === 'short' ? 'a short day' : null;
  const train = day.rows.find((r) => r.kind === 'training');
  const X = p.adjust?.value ?? null;
  const next = X?.next ?? plan.review;
  const checks = p.checks;
  const sums: GlanceLine[] = [
    { icon: 'target', text: ['Protein ', { b: `${plan.protein.floorG} g` }, ' or more: ', { b: `${wk.ticked} of 7` }, ` days ticked this week${today === 'ticked' ? ', today too' : today === 'open' ? ', today open' : ''}.`] },
    { icon: 'bowl', text: [kindWord ? `${weekday(p.date)}, ` : '', ...(kindWord ? [{ b: kindWord }] : []), kindWord ? ': ' : '', train && train.kind === 'training' ? `${train.session === 'lift' ? 'lift' : 'the short session'} at ${train.at}, ` : '', `about ${about} g of protein planned over ${plural(plan.meals.length, 'meal')}.`].filter(Boolean) },
    { icon: 'review', text: [X?.status === 'due' ? 'The check is due: ' : 'Next check ', { b: dayText(next) }, ': the tape and the weight trend decide, never one day.'] },
  ];
  const kc = plan.energy ? `about ${nfmt(plan.energy.maintenanceKcal)} kcal` : null;
  const ticked = today === 'ticked';
  const tips = plan.tips ?? [];
  const going = goingStatus(m);
  const sections: GlanceSection[] = [
    { id: 'plan', title: 'Your plan in a minute', line: 'The goal, the day’s size and why this plan', status: dots([{ b: p.words.goal }], [`${plan.protein.floorG} g protein`], kc ? [kc] : null), start: opts.early ? 'open' : 'folded' },
    { id: 'day', title: 'A day on your plan', line: 'Your day, each meal with its hands and an idea', status: dots(kindWord ? [`${weekday(p.date)}, `, { b: kindWord }] : [weekday(p.date)], [plural(plan.meals.length, 'meal')], [`about ${about} g protein`]), start: 'open' },
    { id: 'today', title: 'Today', line: checks.length ? 'The protein tick and the light checks' : 'The protein tick', status: dots([`Protein ${plan.protein.floorG} g: `, ticked ? { b: 'reached' } : 'not ticked yet'], checks.length ? [`${plural(checks.length, 'light check')}, for Sunday`] : null), start: 'open' },
    ...(tips.length ? [{ id: 'tips', title: 'Coach’s tips', line: 'Small ways to make the plan easy', status: [tips.length > 2 ? `${tips.slice(0, 2).map((t) => t.title).join(' · ')} and ${tips.length - 2} more` : tips.map((t) => t.title).join(' · ')], start: 'open' as const }] : []),
    { id: 'going', title: 'How it’s going', line: 'Protein days, the waist and weight, the pattern, the next check', status: going, start: 'folded', due: X?.status === 'due' || (X?.status === 'checked' && X.checkedOn === p.date && Boolean(X.step)) },
  ];
  return { sums, sections };
}

// ================================================================ Today

type Today = ReturnType<typeof buildToday>;
type Review = NonNullable<Today['review']>;
type Session = ReturnType<typeof buildSession>;

const BAND: Readonly<Record<string, string>> = { low: 'Low', watch: 'Watch', normal: 'Normal', good: 'Good' };
/** The readiness actions that change the session itself. */
const STRONG: Readonly<Record<string, string>> = { 'early-deload': 'an early light week is offered', 'no-hard-training': 'no hard training today' };

/** Readiness as Today reads it: the band (today's, else the latest scored), the baseline while it builds, and whether it changes the session. */
export function readinessNow(r: Review) {
  const t = r.readiness.today.value;
  const latest = r.readiness.latestScored as { date: string; s: number; band: string } | null;
  const scored = t.band !== 'unscored' ? { date: t.date, s: t.s as number, band: t.band } : latest;
  const base = r.readiness.baseline.value;
  const active = r.readiness.actions.filter((a) => a.value.active).map((a) => a.value.action as string);
  // A low day's change as the plan's rule (or the old default) has it.
  const low = r.rules.readiness.value.low;
  const strong = (a: string) => (a === 'trim' ? (low ? trimWords(low).replace(' per exercise', ' on the top sets').replace(' and RIR', ', RIR') : null) : (STRONG[a] ?? null));
  const big = active.filter((a) => strong(a));
  const short = big.length ? big.map((a) => strong(a)!).join('; ') : active.includes('no-tests') ? 'no tests or PR attempts today' : 'train as planned';
  // It opens by itself only when it changes the session, and only once its baseline is complete.
  const changes = !base.building && (scored?.band === 'low' || big.length > 0);
  return { scored, building: base.building, mornings: Math.min(base.mornings, base.needed), needed: base.needed, short, changes, label: scored ? (BAND[scored.band] ?? 'Not scored') : 'Not scored' };
}

/** The session's swaps for the Ledger: a planned lift ruled out and what is done in its place. */
export function swapsOf(sess: Session | null) {
  return (sess?.items ?? []).filter((it) => it.replaces && it.adjustments.some((a) => a.rule === 'safety.ledger')).map((it) => ({ name: clean(it.name), replaces: clean(it.replaces!.name) }));
}

export interface TodayExtras {
  session: Session | null;
  due: DueToday | null;
  /** The recent list (the cycle's last sessions, newest first) and every session on record. */
  recent: readonly { name: string; date: IsoDate }[];
  totalSessions: number;
  /** The dashboard's For today rules shown with the engine's own. */
  dashReminders: number;
  /** Your day, the strip at the top (report/your-day.ts); absent: no section for it. */
  day?: YourDay | null;
}

/** Today: the session, what is still open, readiness; Today's session, Due today and For today open, Readiness open only when it changes the session. */
export function todayGlance(m: Today, x: TodayExtras): Glance {
  const r = m.review;
  if (!r) return { sums: [], sections: [] };
  const rd = readinessNow(r);
  const sess = x.session?.session ?? null;
  const items = x.session?.items ?? [];
  const pl = (x.session as { plannedLoad?: { minutes: number | null } } | null)?.plannedLoad;
  const minutes = pl?.minutes ? Math.round(pl.minutes) : null;
  const swaps = swapsOf(x.session);
  const due = x.due;
  const habits = due ? due.habits.slots.flatMap((sl) => sl.items.map((it) => ({ ...it, time: sl.time }))) : [];
  const open = habits.filter((it) => !it.done);
  const now = open.filter((it) => !it.later);
  const later = open.filter((it) => it.later);
  const water = due?.amounts[0] ?? null;
  const desk = due?.desk[0] ?? null;
  const tw = r.thisWeek;
  const sums: GlanceLine[] = [
    sess
      ? { icon: 'dumbbell', flag: swaps.length > 0, text: [{ b: clean(sess.name) }, sess.logged ? ', logged today' : minutes ? `, about ${minutes} min` : '', swaps.length ? `: ${swaps[0]!.name} in place of ${swaps[0]!.replaces}` : '', '.'] }
      : { icon: 'dumbbell', text: ['No planned session today.'] },
    ...(due
      ? [!due.morning.done
          ? { icon: 'clipboard', flag: true, text: ['Morning check-in ', { b: 'not done yet' }, `: about 30 seconds${open.length ? `; ${plural(open.length, 'habit')} open too` : ''}.`] }
          : open.length
            ? { icon: 'pill', text: [{ b: plural(open.length, 'habit') }, ' still open', now.length ? `: ${and(now.map((it) => it.name))}` : '', later.length ? `${now.length ? ', then' : ':'} ${later.length} at ${later[0]!.time ?? 'their times'}` : '', '.'] }
            : { icon: 'pill', text: [habits.length ? 'Every habit ticked today.' : 'Nothing to tick today.'] }]
      : []),
    rd.building
      ? { icon: 'pulse', text: ['Readiness: building your baseline, ', { b: `${rd.mornings} of ${rd.needed}` }, ' mornings. Train as planned.'] }
      : rd.scored
        ? { icon: 'pulse', flag: rd.scored.band === 'watch' || rd.scored.band === 'low', text: ['Readiness ', { b: rd.label }, ` (${signed(rd.scored.s, 2)}): ${rd.short}.`] }
        : { icon: 'pulse', text: ['Readiness: no scored check-in yet.'] },
  ];
  // For today, as its card builds it: a stall, short sleep, the light week, a temporary change.
  const flags: Run[][] = [];
  for (const l of r.lifts) if (l.stall?.value.stalled) flags.push([{ b: `${clean(l.short)} stalled` }]);
  const sleep = r.weight.last7.sleepH;
  if (sleep && sleep.value < 7) flags.push([`sleep ${Math.round(sleep.value * 10) / 10} h a night`]);
  const d = r.deload?.value;
  if (d?.deload) flags.push(['a light week now']);
  else if (d?.weeksToScheduled) flags.push([`light week in ${plural(d.weeksToScheduled, 'week')}`]);
  const changes = [...r.temporaryChanges.due, ...r.temporaryChanges.active];
  if (changes.length) flags.push([`${clean(changes[0]!.item)} until ${shortDay(changes[0]!.until)}`]);
  if (!flags.length && x.dashReminders) flags.push([plural(x.dashReminders, 'reminder'), ' from the plan']);
  const unlogged = m.week.filter((day) => day.state === 'unlogged').map((day) => dayText(day.date));
  const recent = x.recent[0];
  const ask = asking(m.coach.now?.value);
  const day = x.day ?? null;
  const nextStep = day?.steps.find((st) => st.state === 'next') ?? null;
  const sections: GlanceSection[] = [
    // Your day, first as on the page: always open, the day's steps at a glance.
    ...(day ? [{ id: 'yourday', title: 'Your day', line: 'What to do today, and what is still left', status: dots([{ b: day.count }], nextStep ? ['next: ', { b: nextStep.name.replace(/:.*$/, '') }] : ['nothing left today']), start: 'open' as const }] : []),
    // Ask the coach, only while it is due or still to do: something to act on, so it opens.
    ...(ask ? [{ id: 'coach', title: 'Ask the coach', line: 'The coach’s next step after the Sunday check-in', status: dots([{ b: ask.title }], [ask.state === 'due' ? 'run ' : `still to do since ${shortDay(ask.date)}: run `, { b: ask.command }]), start: 'open' as const, due: true }] : []),
    { id: 'readiness', title: 'Readiness', line: 'Recovery from the morning check-in', status: rd.building ? ['Building your baseline · ', { b: `${rd.mornings} of ${rd.needed}` }, ' mornings · train as planned'] : rd.scored ? [{ b: `${rd.label}, ${signed(rd.scored.s, 2)}` }, ` · ${rd.short}`] : ['No scored check-in yet'], start: rd.changes ? 'open' : 'folded', due: rd.changes },
    ...(due ? [{
      id: 'due', title: 'Due today', line: 'Habits, water, sitting and desk breaks',
      status: dots(!due.morning.done ? [{ b: 'Morning check-in open' }] : null, habits.length ? [{ b: `${due.habits.done} of ${due.habits.total}` }, ' habits done'] : null, water ? [`${lower(water.name)} `, { b: nfmt(water.value) }, ` of ${nfmt(water.target)} ${water.unit}`] : null, desk?.next ? [`desk break at ${desk.next}`] : null),
      start: 'open' as const, due: !due.morning.done || now.length > 0,
    }] : []),
    { id: 'fortoday', title: 'For today', line: 'Flags: a stall, short sleep, the next light week', status: flags.length ? dots(...flags.slice(0, 3)) : ['Nothing to watch today'], start: 'open' },
    { id: 'session', title: 'Today’s session', line: 'The workout to do now, with targets and swaps', status: sess ? dots([{ b: clean(sess.name) }], [`${plural(items.length, 'exercise')}${minutes ? `, about ${minutes} min` : ''}`], swaps.length ? [`${plural(swaps.length, 'swap')} for the Ledger`] : null, sess.logged ? ['logged today'] : null) : ['No planned session today'], start: 'open' },
    { id: 'week', title: 'This week', line: 'Each day: trained, rest, not logged, missed', status: dots(['Lifting ', { b: `${tw.lifting.done} of ${tw.lifting.target}` }, ', short ', { b: `${tw.short.done} of ${tw.short.target}` }], unlogged.length ? [`${and(unlogged)} not logged`] : null), start: 'folded' },
    ...(recent ? [{ id: 'recent', title: 'Recent', line: 'Your last sessions, each opens to edit', status: dots([{ b: clean(recent.name) }, `, ${dayText(recent.date)}`], [`${plural(x.totalSessions, 'session')} on record`]), start: 'folded' as const }] : []),
  ];
  return { sums, sections };
}

// ================================================================ Progress

type Progress = ReturnType<typeof buildProgress>;

/** The Progress views, each with what it shows: the panel's other views. */
export const PROGRESS_VIEWS: readonly { id: string; label: string; line: string }[] = [
  { id: 'overview', label: 'Overview', line: 'Weekly sets, readiness, consistency, strength and weight' },
  { id: 'training', label: 'Training', line: 'Records, every lift, sessions and cardio' },
  { id: 'body', label: 'Body', line: 'The tape, the targets and progress photos' },
  { id: 'health', label: 'Health', line: 'Resting HR, sleep and steps' },
  { id: 'skills', label: 'Skills', line: 'The skill ladders, their tests and goals' },
  { id: 'habits', label: 'Habits', line: 'What you track, and today’s reminders' },
];

/** What each section of the other views shows (their status is the card's own line under its title). */
export const PROGRESS_LINES: Readonly<Record<string, string>> = {
  records: 'Each lift’s best top sets and the milestones reached',
  every: 'Estimated max per session for every logged lift',
  sessions: 'Each week’s sessions against the target',
  cardio: 'Cardio logged with the sessions, by plan week',
  tape: 'Waist, hips, chest and arm every two weeks',
  targets: 'Body measures against your targets',
  photos: 'Two photo dates side by side, pose by pose',
  health: 'Every day from the morning check-in, with the 7-day average',
  skills: 'Each ladder: the level, the latest test, the goal',
  habits: 'What you track, with each item’s history',
  reminders: 'What pops up today, and when',
};

export interface ProgressExtras {
  today: Today | null;
  /** The cycle's waist (the Body view's tape), in the body units' length. */
  waist: { first: { date: IsoDate; value: number } | null; last: { date: IsoDate; value: number } | null; change: number | null } | null;
  units: { weight: string; length: string };
  /** The kg and cm as shown in the body units. */
  wv: (kg: number) => number;
  lv: (cm: number) => number;
}

/** Progress's summary (the same on every view): the week, the waist or the weight, strength. */
export function progressSums(pm: Progress, x: ProgressExtras, strength: { mean: number | null }): GlanceLine[] {
  const tw = x.today?.review?.thisWeek ?? null;
  const wk = x.today?.review?.week ?? null;
  const out: GlanceLine[] = [];
  if (tw) out.push({ icon: 'calendar', text: [wk?.planWeek ? `Week ${wk.planWeek}${wk.planWeeks ? ` of ${wk.planWeeks}` : ''} · ` : '', { b: `${tw.lifting.done} of ${tw.lifting.target}` }, ` lifting sessions and ${tw.short.done} of ${tw.short.target} short logged this week.`] });
  const w = x.waist;
  const len = (cm: number) => Math.round(x.lv(cm) * 10) / 10;
  if (w?.last) out.push({ icon: 'tape', text: ['Waist ', { b: `${len(w.last.value)} ${x.units.length}` }, w.change !== null && w.first ? `, ${w.change < 0 ? 'down' : w.change > 0 ? 'up' : 'level'} ${Math.abs(len(w.change))} ${x.units.length} since ${shortDay(w.first.date)}.` : `, ${shortDay(w.last.date)}.`] });
  else if (pm.weight?.points.length) {
    const t = pm.weight.points.at(-1)!;
    out.push({ icon: 'trend', text: ['Weight trend ', { b: `${x.wv(t.trend).toFixed(1)} ${x.units.weight}` }, pm.weight.rate ? `, ${signed(x.wv(pm.weight.rate.kgPerWeek), 2)} ${x.units.weight} a week.` : '.'] });
  }
  const stalled = pm.lifts.filter((l) => l.verdict === 'stalled').map((l) => clean(l.name));
  if (strength.mean !== null) out.push({ icon: 'trend', flag: stalled.length > 0, text: ['Strength ', { b: `${signed(strength.mean * 100, 0)} %` }, ` on average${pm.cycle.since ? ` since ${shortDay(pm.cycle.since)}` : ''}`, stalled.length ? `; ${and(stalled)} ${stalled.length === 1 ? 'has' : 'have'} stalled.` : '.'] });
  else if (pm.lifts.length) out.push({ icon: 'trend', text: ['Strength: too few sessions per lift for a change yet.'] });
  return out;
}

/** Progress's Overview: Strength trends, Weight trend and Consistency open; Weekly sets and Readiness folded. */
export function overviewSections(pm: Progress, x: ProgressExtras): GlanceSection[] {
  const out: GlanceSection[] = [];
  const v = pm.volume;
  if (v) {
    const ms = v.views.week.muscles;
    const below = ms.filter((m) => m.status === 'below').length;
    const over = ms.filter((m) => m.status === 'over').length;
    out.push({ id: 'sets', title: 'Weekly sets per muscle', line: 'Sets each muscle got this week, on the body', status: [{ b: `${below} below target` }, ` so far this week, ${over ? `${over} over` : 'none over'}`], start: 'folded' });
  }
  const r = pm.readiness;
  if (r) {
    const cut = r.since !== null && r.from === r.since;
    const good = r.points.filter((p) => p.band === 'normal' || p.band === 'good').length;
    const b = r.baseline.value;
    const last = r.points.at(-1);
    out.push({ id: 'ready', title: cut ? 'Readiness, this cycle' : 'Readiness, 28 days', line: 'Four weeks of morning scores: look for a slide', status: b.building ? ['Building your baseline · ', { b: `${Math.min(b.mornings, b.needed)} of ${b.needed}` }, ' mornings'] : r.points.length ? dots(['Normal or better on ', { b: `${good} of ${r.points.length}` }, ' days'], last ? [`latest ${BAND[last.band] ?? last.band}, ${signed(last.s, 2)}`] : null) : ['No scored mornings yet'], start: 'folded' });
  }
  const c = pm.calendar;
  if (c) {
    const a = c.adherence;
    const n = a?.weeks.length ?? 0;
    out.push({ id: 'consistency', title: 'Consistency', line: '26 weeks of days: trained, rest, missed', status: a ? ['Lifting ', { b: `${a.lifting.done} of ${a.lifting.planned}` }, ', short ', { b: `${a.short.done} of ${a.short.planned}` }, c.since ? `, this cycle’s ${n === 1 ? 'first full week' : `${n} full weeks`}` : `, the last ${n} full weeks`] : ['No full week this cycle yet'], start: 'open' });
  }
  const by = (k: string) => pm.lifts.filter((l) => l.verdict === k).map((l) => clean(l.name));
  const up = by('up');
  const stalled = by('stalled');
  const flat = by('flat');
  const units = by('units');
  out.push({ id: 'strength', title: 'Strength trends', line: 'Each logged lift’s estimated max over time', status: pm.lifts.length ? dots(up.length ? [{ b: and(up) }, ' up'] : null, stalled.length ? [{ b: and(stalled) }, ' stalled'] : null, flat.length ? [`${and(flat)} flat`] : null, units.length ? [`${and(units)}: check the units`] : null, !up.length && !stalled.length && !flat.length && !units.length ? ['Too few sessions per lift yet'] : null) : ['No logged top sets yet'], start: 'open' });
  const w = pm.weight;
  if (w) {
    const t = w.points.at(-1);
    const band = w.band ? (w.band.status === 'in' ? 'in the goal band' : w.band.status === 'below' ? 'faster than the goal band' : w.band.status === 'above' ? 'slower than the goal band' : '') : '';
    out.push({ id: 'weight', title: 'Weight trend', line: 'The smoothed weight against your goal band', status: w.rate ? dots([{ b: `${x.wv(w.rate.trend).toFixed(1)} ${x.units.weight}` }, `, ${signed(x.wv(w.rate.kgPerWeek), 2)} ${x.units.weight} a week`], band ? [band] : null) : t ? [{ b: `${x.wv(t.trend).toFixed(1)} ${x.units.weight}` }, ', too few weigh-ins for a rate'] : ['No weigh-ins yet'], start: 'open' });
  }
  return out;
}

/** The other views' sections, from their cards as drawn (id, kicker, the line under the title): all start open. */
export function moreSections(view: string, cards: readonly { id: string; title: string; sub: string }[]): GlanceSection[] {
  return cards.map((c) => ({ id: `${view}.${c.id}`, title: c.title, line: PROGRESS_LINES[c.id] ?? (c.sub.split(/(?<=[.;])\s/)[0] ?? '').replace(/[.;]$/, ''), status: [c.sub], start: 'open' as const }));
}

// ================================================================ Plan

type Plan = ReturnType<typeof buildPlan>;

export interface PlanExtras {
  weekTarget: { lift: number; short: number } | null;
  /** The phase targets as the card rates them: how many on track, and the others with their status. */
  targets: { ok: number; total: number; others: { name: string; status: string }[] } | null;
  /** The desk breaks card's line, or null without the card. */
  desk: string | null;
  /** How many of the plan's notes are in the vault. */
  links: number;
}

const UPCOMING: Readonly<Record<string, string>> = { tape: 'Tape', checkin: 'Sunday check-in', deload: 'Light week', tests: 'Phase tests', photos: 'Progress photos', 'phase-review': 'Phase review', rescreen: 'Re-screening', 'ledger-end': 'A Ledger limit ends', 'change-end': 'A temporary change ends' };

/** The Plan: This mesocycle and Coming up open, the rest folded. */
export function planGlance(pm: Plan, x: PlanExtras): Glance {
  if (!('templates' in pm) || !pm.weeks?.length) return { sums: [], sections: [] };
  const m = pm;
  const now = m.now;
  const phases = m.phases ?? [];
  const ph = now ? phases.find((p) => p.index === now.phase) ?? null : null;
  const next = ph ? phases.find((p) => p.index === ph.index + 1) ?? null : null;
  const phWeeks = now ? m.weeks.filter((w) => w.phase === now.phase) : [];
  const cur = now ? m.weeks.find((w) => w.index === now.index) ?? null : null;
  const name = (p: { index: number; name?: string | null }) => (p.name && p.name.trim() ? p.name.trim() : `Phase ${p.index}`);
  const light = now ? m.weeks.find((w) => w.kind === 'deload' && w.end >= m.date) ?? null : null;
  const tests = (m.upcoming ?? []).find((u) => u.kind === 'tests') ?? null;
  const sums: GlanceLine[] = [];
  // This mesocycle's length: to its light week, on the plan's light-week calendar.
  const mesoLength = now ? m.weeks.filter((w) => w.meso === now.meso).length : 0;
  if (now && ph && cur) sums.push({ icon: 'layers', text: [`${name(ph)}, week `, { b: `${phWeeks.findIndex((w) => w.index === now.index) + 1} of ${phWeeks.length}` }, ` · mesocycle ${now.meso}, week ${cur.weekInMeso} of ${mesoLength}: ${cur.kind === 'deload' ? 'the light week' : 'a loading week'}.`] });
  if (x.weekTarget) sums.push({ icon: 'dumbbell', text: ['This week: ', { b: `${x.weekTarget.lift} lifting` }, ' and ', { b: `${x.weekTarget.short} short` }, ` ${x.weekTarget.short === 1 ? 'session' : 'sessions'}.`] });
  if (light) sums.push({ icon: 'deload', text: [...(light.start <= m.date ? ['This is the light week'] : ['Next: the light week, ', { b: dayText(light.start) } as Run]), tests ? `; phase tests ${dayText(tests.date)}.` : '.'] });
  const vol = m.volume?.muscles ?? [];
  // A priority muscle short of direct sets near failure is named apart from the muscles under their minimum.
  const short = vol.filter((b) => b.directUnder);
  const under = vol.filter((b) => b.status === 'below' && !b.directUnder);
  const high = vol.filter((b) => b.status === 'above' || b.status === 'over');
  const lab = (id: string) => m.volume?.labels[id]?.label ?? id;
  const up = m.upcoming ?? [];
  const first = up[0];
  const firstDay = first ? up.filter((u) => u.date === first.date) : [];
  // The coach step after that day's check-in; the phase review is named by it, not twice.
  const coach = (firstDay.find((u) => u.kind === 'checkin') as { coach?: CoachStep } | undefined)?.coach ?? null;
  const onFirst = firstDay.filter((u) => !(coach && u.kind === 'phase-review')).map((u) => UPCOMING[u.kind] ?? u.kind);
  const L = m.load;
  const mw = m.minimumWeek?.value ?? null;
  const sections: GlanceSection[] = [
    { id: 'timeline', title: `The plan, ${m.weeks.length} weeks`, line: 'The phases week by week: light weeks, tests, decisions', status: now && ph ? dots(['Week ', { b: `${now.index} of ${m.weeks.length}` }], [`${name(ph)} ends ${dayText(ph.to)}${next ? `, then ${name(next)}` : ''}`]) : [`From ${dayText(m.weeks[0]!.start)}`], start: 'folded' },
    { id: 'meso', title: 'This mesocycle', line: 'This block’s weeks and each session as planned', status: now && cur ? dots(['Mesocycle ', { b: String(now.meso) }, `, week ${cur.weekInMeso} of ${mesoLength}`], light ? [light.start <= m.date ? 'the light week now' : `light week from ${shortDay(light.start)}`] : null) : ['The sessions as planned'], start: 'open' },
    { id: 'vol', title: 'Sets per muscle', line: 'Planned weekly sets against each muscle’s band', status: dots(under.length ? [{ b: `${under.length} under the minimum` }] : short.length ? null : ['Every muscle at its minimum or more'], short.length ? [{ b: `${and(short.map((b) => lab(b.muscle)))} short of direct sets near failure` }] : null, high.length ? [`${and(high.slice(0, 2).map((b) => lab(b.muscle)))} above ${high.length === 1 ? 'its' : 'their'} band`] : null), start: 'folded' },
    { id: 'upcoming', title: 'Coming up', line: 'Dates to the phase end: tape, check-ins and the coach, tests', status: first ? dots([`${and(onFirst)} `, { b: dayText(first.date) }, `, ${inDays(m.date, first.date)}`], coach ? [`then ${stepWords(coach)}: `, { b: coach.command }] : null) : ['Nothing before the phase ends'], start: 'open' },
    ...(L ? [{ id: 'load', title: 'Training load', line: 'Weekly effort: next week’s plan and the last four', status: dots([{ b: nfmt(Math.round(L.next.knownLoad)) }, ' planned next week'], L.nextMonotony != null ? [`monotony ${L.nextMonotony.toFixed(1)}`] : null), start: 'folded' as const }] : []),
    { id: 'targets', title: ph ? `${ph.name && ph.name.trim() && ph.name.trim().toLowerCase() !== `phase ${ph.index}` ? `Phase ${ph.index} · ${ph.name.trim()}` : `Phase ${ph.index}`} targets` : 'Targets', line: 'What this phase aims for, and where you stand', status: x.targets && x.targets.total ? dots([{ b: `${x.targets.ok} of ${x.targets.total}` }, ' on track or in the band'], x.targets.others.length ? [x.targets.others.slice(0, 2).map((o) => `${lower(o.name)}: ${lower(o.status)}`).join(', ')] : null) : ['No targets yet'], start: 'folded' },
    ...(m.rules ? [rulesSection(m.rules)] : []),
    ...(mw ? [{ id: 'minweek', title: 'The minimum week', line: 'The least that keeps a bad week on track', status: [{ b: `${mw.sessions} × Express` }, ` · about ${mw.minutes} minutes each`], start: 'folded' as const }] : []),
    ...(x.desk !== null ? [{ id: 'desk', title: 'Desk breaks', line: 'The plan’s posture breaks: when, what, why', status: [x.desk], start: 'folded' as const }] : []),
    ...(x.links ? [{ id: 'notes', title: 'The plan', line: 'The notes behind the plan, in the vault', status: [plural(x.links, 'note'), ': the roadmap, the month, the guide and more'], start: 'folded' as const }] : []),
  ];
  return { sums, sections };
}

/** The Plan's standing-rules card: how many of the rules the coach has set; the rest are Pahlavan's defaults. */
function rulesSection(rules: Record<string, unknown> & { lifts: Record<string, { source: string }> }): GlanceSection {
  const { lifts, ...kinds } = rules;
  const all = [...Object.values(kinds as Record<string, { source: string }>), ...Object.values(lifts)];
  const set = all.filter((r) => r.source === 'plan').length;
  return {
    id: 'rules',
    title: 'Standing rules',
    line: 'The coach’s rules your numbers follow',
    status: set === all.length ? ['Every rule set by your coach'] : dots([{ b: `${set} of ${all.length}` }, ' set by your coach'], ['the rest use Pahlavan’s default']),
    start: 'folded',
  };
}

// ================================================================ Check-in

type Checkin = ReturnType<typeof buildCheckin>;

export interface CheckinExtras {
  /** The Body record's parts (absent: not read here), each with its next date and whether it is due. */
  body: readonly { part: string; title: string; due: boolean; nextDate: IsoDate | null; inDays: number | null }[] | null;
}

/** Check-in: what is due opens (the morning when not done, the Sunday check-in on Sundays or while it waits, the body record within 3 days), the rest folds. */
export function checkinGlance(c: Checkin, x: CheckinExtras): Glance {
  const date = c.date;
  // Done: checked in, or a morning answer saved (yesterday's steps and floors do not count).
  // Done by the one rule Due today and the morning card use: checkedAt, or the card's own questions answered (numbers alone are not).
  const done = isMorningDone({ ...c.morning.values, checkedAt: c.morning.checkedAt });
  const sun = c.sunday;
  const isSunday = new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
  const parts = (x.body ?? []).filter((p) => p.nextDate).slice().sort((a, b) => (a.nextDate! < b.nextDate! ? -1 : 1));
  const soon = parts.filter((p) => p.due || (p.inDays !== null && p.inDays <= 3));
  const ask = asking(c.coach.now?.value);
  const sunDue = sun ? sun.status === 'open' || sun.status === 'late' || ask !== null : false;
  const nextSunday = addDays(mondayOf(date), 6);
  const opens = sun ? (sun.status === 'saved' ? sun.nextOpens : sun.date) : nextSunday;
  const sums: GlanceLine[] = [
    done ? { icon: 'clipboard', text: ['Morning check-in ', { b: 'done' }, ' for today.'] } : { icon: 'clipboard', flag: true, text: ['Morning check-in ', { b: 'not done yet' }, ': about 30 seconds.'] },
    ask ? { icon: 'mail', flag: true, text: [ask.state === 'due' ? 'The Sunday check-in is saved' : `The check-in of ${dayText(ask.date)} is saved`, '. Next, ask the coach for ', stepWords(ask), ': ', { b: ask.command }, '.'] }
      : sun?.status === 'open' ? { icon: 'review', flag: true, text: ['The Sunday check-in is ', { b: 'open today' }, '.'] }
      : sun?.status === 'late' ? { icon: 'review', flag: true, text: [{ b: `The check-in for the week of ${shortDay(sun.weekStart)}` }, ' is not saved yet.'] }
        : sun?.status === 'edit' ? { icon: 'review', text: ['The Sunday check-in is ', { b: 'saved' }, ' for today.'] }
          : { icon: 'review', text: ['The Sunday check-in opens ', { b: dayText(opens) }, `, ${inDays(date, opens)}.`] },
    ...(parts.length ? [{ icon: 'tape', text: ['Next: ', ...parts.flatMap((p, i): Run[] => (i ? [`, ${lower(p.title)} ${shortDay(p.nextDate!)}`] : [`${lower(p.title)} `, { b: dayText(p.nextDate!) }])), '.'] }] : []),
  ];
  const nq = sun ? sun.template.ask.length : 0;
  const letter = c.letter;
  const focus = letter?.focus ? clean(letter.focus).split(/(?<=\.)\s/)[0]!.replace(/\.$/, '') : '';
  const sections: GlanceSection[] = [
    { id: 'morning', title: 'Morning check-in', line: 'Energy, soreness, sleep and weight, each morning', status: done ? [{ b: 'Done today' }, c.morning.values.sleepH !== null ? ` · sleep ${Math.round(c.morning.values.sleepH * 10) / 10} h` : '', c.morning.values.energy !== null ? `, energy ${c.morning.values.energy} of 5` : ''] : [{ b: 'Not done yet' }, ' · about 30 seconds'], start: done ? 'folded' : 'open', due: !done },
    ...(x.body ? [{
      id: 'body', title: 'Body record', line: 'Tape, photos and tests: when each is due, the last entry',
      status: parts.length ? parts.map((p, i): Run[] => (i ? [` · ${lower(p.title)} ${shortDay(p.nextDate!)}`] : p.due ? [{ b: `${p.title} due` }] : [{ b: `${p.title} ${dayText(p.nextDate!)}` }, `, ${inDays(date, p.nextDate!)}`])).flat() : ['Nothing scheduled'],
      start: soon.length ? 'open' as const : 'folded' as const, due: soon.length > 0,
    }] : []),
    ...(sun ? [{ id: 'sunday', title: 'Sunday check-in', line: 'The week in a few questions, for the letter', status: dots(sun.status === 'open' ? [{ b: 'Open today' }] : sun.status === 'late' ? [{ b: 'Not saved yet' }, `, the week of ${shortDay(sun.weekStart)}`] : sun.status === 'edit' ? [{ b: 'Saved today' }] : ['Saved · the next opens ', { b: dayText(sun.nextOpens) }], sun.status === 'open' || sun.status === 'late' ? [plural(nq, 'question')] : null, ask ? ['next, ask the coach: ', { b: ask.command }] : null), start: isSunday || sunDue ? 'open' as const : 'folded' as const, due: sunDue }] : []),
    { id: 'letter', title: 'Last letter', line: 'The coach’s last letter: what changed, one focus', status: letter?.date ? dots([{ b: dayText(letter.date) }], focus ? [`focus: ${lower(focus)}`] : null) : ['No letter yet this cycle'], start: 'folded' },
  ];
  return { sums, sections };
}

export { and as andList, dots, plural };
