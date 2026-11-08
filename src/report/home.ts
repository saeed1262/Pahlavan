// Home, the first tab, as signed off in mockups/home.html: an overview that
// reads in a few seconds, every part a link to the tab with the detail. The
// banner holds today's session (and the week's ring, which the plugin draws
// from Today's own); under it, what needs the user (three at most), food and
// habits, and progress in three small tiles. Built from the reports the
// view already has, in plain words: no engine terms, no band names, no
// legends (a test scans every string). Pure: the reports are the inputs.

import { addDays, dayText, daysBetween, mondayOf, type IsoDate } from '../core/dates.ts';
import type { DueToday } from '../core/nudges.ts';
import { isProteinItem } from '../core/protein.ts';
import type { Adjustment } from '../core/rules.ts';
import type { TrackedItem } from '../core/schema.ts';
import { bodyUnitsOf, inWeight } from '../core/units.ts';
import type { VaultRead } from '../adapters/vault/read.ts';
import { scopeInfo } from './cycle.ts';
import type { buildFood } from './food.ts';
import { readinessNow, swapsOf } from './glance.ts';
import type { buildProgress } from './progress.ts';
import type { buildSession } from './session.ts';
import type { buildToday } from './today.ts';
import { habitsTally, type YourDay } from './your-day.ts';

type Today = ReturnType<typeof buildToday>;
type Session = ReturnType<typeof buildSession>;
type Food = ReturnType<typeof buildFood>;
type Progress = ReturnType<typeof buildProgress>;

/** Where a part of Home leads: a tab, a Progress view, Today's Due today, or the morning card. */
export type HomeGo = 'today' | 'due' | 'morning' | 'progress' | 'progress-training' | 'progress-body' | 'plan' | 'checkin' | 'food';

/** One line in the banner under the session: a bold lead and the rest. */
export interface HomeNote {
  icon: string;
  lead: string;
  text: string;
}

export interface HomeHero {
  /** "Today · Friday 10 April". */
  kicker: string;
  /** The session's name, or "Rest day". */
  title: string;
  /** "About 60 minutes · 4 exercises · next in your plan". */
  sub: string;
  state: 'planned' | 'logged' | 'rest' | 'missed';
  /** Two at most: what readiness changes today, then a swap. */
  notes: HomeNote[];
  /** Under the ring: "Today's session finishes the week", "2 more this week", "Week done". */
  ringLine: string;
}

export interface HomeNeed {
  id: string;
  icon: string;
  /** due: something to do; warn: something to check. */
  tone: 'due' | 'warn';
  title: string;
  line: string;
  go: HomeGo;
}

export interface HomeTile {
  id: 'strength' | 'weight' | 'consistency';
  label: string;
  /** The big number and its small unit; null with nothing to show yet. */
  big: { value: string; unit: string } | null;
  /** The small line's points, oldest first (two or more), or empty. */
  spark: number[];
  /** The line's fixed scale (a share from 0 to 1); absent: from its lowest point to its highest. */
  range?: [number, number];
  line: string;
  /** Strength: each lift with a trend and which way it is going, in the order Progress lists them. */
  marks?: { name: string; verdict: 'up' | 'down' | 'flat' | 'stalled' }[];
  /** Showing up: each full week's share of the planned lifting sessions (0 to 1), oldest first, and the cycle's share. */
  weeks?: number[];
  share?: number;
}

/** One row of Your tabs: the tab, what it is for (fixed words), and where it stands now. */
export interface HomeTab {
  id: 'today' | 'progress' | 'plan' | 'checkin' | 'food';
  label: string;
  does: string;
  now: string;
  /** due: something to do there; warn: something to check there; null: nothing waiting. */
  tone: 'due' | 'warn' | null;
}

export interface Home {
  date: IsoDate;
  /** Null without a plan: Home shows the welcome, as Today does. */
  hero: HomeHero | null;
  /** The first three, the rest (shown on a click) and their count. */
  needs: { items: HomeNeed[]; rest: HomeNeed[]; more: number; empty: string };
  food: {
    protein: { grams: number; line: string } | null;
    habits: { done: number; total: number; line: string } | null;
  } | null;
  /** `lead` sums the tiles up in one sentence (drawn bold); `after` adds a stalled lift. */
  progress: { since: IsoDate | null; lead: string; after: string | null; tiles: HomeTile[] } | null;
  /** Your tabs: a short guide to the other tabs, each with its status; empty without a plan. */
  tabs: HomeTab[];
}

export interface HomeInputs {
  read: VaultRead;
  today: Today;
  session: Session | null;
  progress: Progress | null;
  due: DueToday | null;
  food: Food | null;
  /** Your day (its morning step stands in for Due today's when the reminders are off). */
  day: YourDay | null;
  /** What is tracked (the protein item's goal without an eating plan). */
  items?: readonly TrackedItem[];
}

const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const at = (d: IsoDate) => new Date(`${d}T00:00:00Z`);
const dayLong = (d: IsoDate) => `${DAYS_LONG[at(d).getUTCDay()]} ${at(d).getUTCDate()} ${MONTHS_LONG[at(d).getUTCMonth()]}`;
const clean = (t: string | null | undefined) => (t == null ? '' : String(t).replace(/\s*—\s*/g, ' · '));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const cap = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five'];
const countWord = (n: number) => NUMBER_WORDS[n] ?? String(n);
const round1 = (v: number) => Math.round(v * 10) / 10;
/** At most `n` points, evenly picked, the last one kept. */
function thin(xs: readonly number[], n = 24): number[] {
  if (xs.length <= n) return [...xs];
  const step = (xs.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => xs[Math.round(i * step)]!);
}

// ---------------------------------------------------------------- the banner

/** A low day's change in plain words, from the plan's rule (sets fewer, reps further from failure). */
function lowChange(low: Adjustment | null): string | null {
  if (!low) return null;
  const sets = low.sets === 0 ? '' : low.sets === -1 ? 'one set fewer on each exercise' : `${-low.sets} sets fewer on each exercise`;
  const reps = low.rir ? `stop ${plural(low.rir, 'rep')} earlier than usual` : '';
  return [sets, reps].filter(Boolean).join(', and ') || null;
}

/** What readiness changes today, only when it changes something (a baseline still building, and a normal or good day, say nothing). */
function readinessNote(r: NonNullable<Today['review']>, date: IsoDate): HomeNote | null {
  const rd = readinessNow(r);
  if (rd.building || !rd.scored) return null;
  // Before today's check-in, the last scored one stands (as on Today), and the line says which.
  const who = rd.scored.date === date ? 'Your morning check-in was' : `Your last morning check-in, ${dayText(rd.scored.date)}, was`;
  const active = r.readiness.actions.filter((a) => a.value.active).map((a) => a.value.action as string);
  if (active.includes('no-hard-training')) return { icon: 'pulse', lead: 'Take it easy today.', text: `${who} low: no hard training, an easy walk or mobility at most.` };
  if (rd.scored.band === 'low' || active.includes('trim')) {
    const change = lowChange(r.rules.readiness.value.low);
    return { icon: 'pulse', lead: 'Take it easy today.', text: change ? `${who} low: ${change}.` : `${who} low.` };
  }
  if (active.includes('early-deload')) return { icon: 'pulse', lead: 'An early light week is offered.', text: 'Your recovery has been low for a while; the check-in can start it.' };
  if (active.includes('no-tests')) return { icon: 'pulse', lead: 'Go a little easier today.', text: `${who} a bit low, so no record attempts.` };
  return null;
}

function swapNote(session: Session | null): HomeNote | null {
  const swaps = swapsOf(session);
  if (!swaps.length) return null;
  const first = `${swaps[0]!.name} instead of ${swaps[0]!.replaces}`;
  return swaps.length === 1
    ? { icon: 'swap', lead: 'One swap:', text: `${first}.` }
    : { icon: 'swap', lead: `${swaps.length} swaps:`, text: `${first}, and ${plural(swaps.length - 1, 'more', 'more')}.` };
}

/** The week's ring in words: how many planned sessions are left, today's included. */
function ringLine(r: NonNullable<Today['review']>, planned: boolean): string {
  const tw = r.thisWeek;
  const total = tw.lifting.target + tw.short.target;
  const done = Math.min(tw.lifting.done, tw.lifting.target) + Math.min(tw.short.done, tw.short.target);
  const left = Math.max(0, total - done);
  if (!total) return 'No sessions planned this week';
  if (left === 0) return 'Week done';
  if (planned && left === 1) return 'Today’s session finishes the week';
  return `${left} more this week`;
}

function hero(m: Today, session: Session | null): HomeHero | null {
  const r = m.review;
  if (!r) return null;
  const kicker = `Today · ${dayLong(m.date)}`;
  const day = m.week.find((d) => d.today) ?? null;
  const sess = session?.session ?? null;
  const items = session?.items ?? [];
  const pl = (session as { plannedLoad?: { minutes: number | null } } | null)?.plannedLoad;
  const minutes = pl?.minutes ? Math.round(pl.minutes) : null;
  if (day?.state === 'rest' || !sess) {
    return { kicker, title: 'Rest day', sub: day?.state === 'rest' ? 'Marked rest: nothing to log today' : 'No session in your plan today', state: 'rest', notes: [], ringLine: ringLine(r, false) };
  }
  if (day?.state === 'missed') {
    return { kicker, title: clean(sess.name), sub: 'Marked missed today: the Sunday check-in asks about the week', state: 'missed', notes: [], ringLine: ringLine(r, false) };
  }
  if (sess.logged) {
    const logged = day?.sessions.find((s) => s.type === sess.type);
    const mins = logged?.minutes ? ` · ${Math.round(logged.minutes)} minutes` : '';
    return { kicker, title: clean(sess.name), sub: `Logged today${mins}`, state: 'logged', notes: [], ringLine: ringLine(r, false) };
  }
  const sub = [minutes ? `About ${minutes} minutes` : null, items.length ? plural(items.length, 'exercise') : null, sess.picked ? 'your pick' : 'next in your plan'].filter(Boolean).join(' · ');
  const notes = [readinessNote(r, m.date), swapNote(session)].filter((n): n is HomeNote => n !== null).slice(0, 2);
  return { kicker, title: clean(sess.name), sub, state: 'planned', notes, ringLine: ringLine(r, true) };
}

// ---------------------------------------------------------------- needs you

const BODY_NEED: Readonly<Record<string, { title: string; line: string; icon: string }>> = {
  tape: { title: 'Tape measurements due', line: 'Waist, hips, chest and arm, saved in Progress.', icon: 'tape' },
  photos: { title: 'Progress photos due', line: 'Four poses in the same light as last time.', icon: 'camera' },
  tests: { title: 'Fitness tests due', line: 'Your plan’s tests, to see how far you have come.', icon: 'flag' },
};

/** This week's Sunday check-in, from Friday to Sunday while it is not saved (none before the cycle's first Sunday). */
function sundayNeed(read: VaultRead, date: IsoDate): HomeNeed | null {
  if (read.files.plan === 'missing') return null;
  const from = mondayOf(date);
  const sunday = addDays(from, 6);
  if (daysBetween(date, sunday) > 2) return null;
  const since = scopeInfo(read.data, date).since;
  if (since && sunday < since) return null;
  const saved = read.data.checkins.weekly.some((w) => w.date === sunday || w.weekStart === from || w.weekOf === from);
  if (saved) return null;
  return { id: 'sunday', icon: 'clipboard', tone: 'due', title: date === sunday ? 'Weekly check-in today' : 'Weekly check-in on Sunday', line: 'About 10 minutes. It sets next week’s weights.', go: 'checkin' };
}

/** The coach's step after a Sunday check-in: last Sunday's answers still to save, or the letter to ask for. */
function coachNeed(m: Today): HomeNeed | null {
  const c = m.coach.now?.value;
  if (!c) return null;
  if (c.state === 'answer-first' && c.date < m.date) return { id: 'coach', icon: 'mail', tone: 'due', title: `Check-in for ${dayText(c.date)} not saved`, line: 'Save your answers so the coach can write the week’s letter.', go: 'checkin' };
  if (c.state === 'due' || c.state === 'late') {
    const what = c.kind === 'letter' ? 'the week’s letter' : `the ${c.title.toLowerCase()}`;
    return { id: 'coach', icon: 'mail', tone: 'due', title: `Ask the coach for ${what}`, line: `Your answers are saved. Run ${c.command} in Claude Code.`, go: 'checkin' };
  }
  return null;
}

function needs(x: HomeInputs): Home['needs'] {
  const m = x.today;
  const all: HomeNeed[] = [];
  if (m.review) {
    const morningOpen = x.due ? !x.due.morning.done : x.day?.steps.some((s) => s.id === 'morning' && s.state !== 'done') ?? false;
    if (morningOpen) all.push({ id: 'morning', icon: 'clipboard', tone: 'due', title: 'Morning check-in', line: 'About 30 seconds. It tells Pahlavan how recovered you are.', go: 'morning' });
    const coach = coachNeed(m);
    if (coach) all.push(coach);
    const sunday = sundayNeed(x.read, m.date);
    if (sunday) all.push(sunday);
    for (const b of x.due?.body ?? []) {
      const n = BODY_NEED[b.part];
      if (b.due && n) all.push({ id: `body-${b.part}`, icon: n.icon, tone: 'due', title: n.title, line: n.line, go: 'progress-body' });
    }
    for (const l of x.progress?.lifts ?? []) {
      const f = l.unitFlag;
      if (f) all.push({ id: `units-${l.exercise}`, icon: 'alert', tone: 'warn', title: `${clean(l.name)}: ${f.from.weight} or ${f.to.weight}?`, line: 'One entry looks like a kg and lb mix-up. Pick the right one.', go: 'progress-training' });
    }
  }
  if (m.errors.length) all.push({ id: 'data', icon: 'alert', tone: 'warn', title: `${plural(m.errors.length, 'problem')} in your fitness files`, line: 'Today’s data notes, at the bottom, say which.', go: 'today' });
  return { items: all.slice(0, 3), rest: all.slice(3), more: Math.max(0, all.length - 3), empty: 'Nothing needs you today.' };
}

// ---------------------------------------------------------------- food and habits

function protein(food: Food | null, due: DueToday | null, items: readonly TrackedItem[]): { grams: number; line: string } | null {
  if (food?.plan) {
    const st = food.protein?.today?.state ?? null;
    return { grams: food.plan.protein.floorG, line: st === 'ticked' ? 'Today’s target, ticked.' : 'Today’s target.' };
  }
  const it = items.find((x) => isProteinItem(x)) ?? null;
  if (!it?.goal || it.goal.unit !== 'g') return null;
  const today = due?.habits.slots.flatMap((sl) => sl.items).find((x) => x.id === it.id) ?? null;
  return { grams: it.goal.amount, line: today?.done ? 'Today’s target, ticked.' : 'Today’s target.' };
}

function foodPart(x: HomeInputs): Home['food'] {
  const p = protein(x.food, x.due, x.items ?? []);
  const t = x.due ? habitsTally(x.due, x.today.week.find((d) => d.today)?.state === 'trained') : null;
  const open = t?.open.length ? `${t.open.length > 2 ? `${t.open[0]} and ${t.open.length - 1} more` : t.open.join(' and ')} open` : null;
  const habits = t ? { done: t.done, total: t.total, line: t.done === t.total ? 'Nothing left today' : t.next ? `Next: ${t.next}` : open ? cap(open) : 'Nothing left today' } : null;
  if (!p && !habits) return null;
  return { protein: p, habits };
}

// ---------------------------------------------------------------- progress

function progressPart(x: HomeInputs): Home['progress'] {
  const pm = x.progress;
  if (!pm || !x.today.review) return null;
  const units = bodyUnitsOf(x.read.data.profile ?? null).value;
  const lifts = pm.lifts ?? [];
  const real = lifts.filter((l) => l.verdict === 'up' || l.verdict === 'down' || l.verdict === 'flat' || l.verdict === 'stalled');
  const up = real.filter((l) => l.verdict === 'up');
  const stalled = real.filter((l) => l.verdict === 'stalled');
  // The best lift's line: the biggest rise among those going up, else any lift with a trend.
  const best = [...up].sort((a, b) => (b.change ?? 0) - (a.change ?? 0))[0] ?? real[0] ?? null;
  const bestPoints = best ? best.sets.filter((s) => s.used && s.best !== null).map((s) => s.best!) : [];
  const strength: HomeTile = real.length
    ? { id: 'strength', label: 'Strength', big: { value: `${up.length} of ${real.length}`, unit: real.length === 1 ? 'lift up' : 'lifts up' }, spark: bestPoints.length >= 2 ? thin(bestPoints) : [], marks: real.map((l) => ({ name: clean(l.name), verdict: l.verdict as 'up' | 'down' | 'flat' | 'stalled' })), line: stalled.length ? `${clean(stalled[0]!.name)} has stopped going up.` : up.length ? `${clean(best!.name)} is up the most.` : 'Holding steady.' }
    : { id: 'strength', label: 'Strength', big: null, spark: [], line: 'A trend shows after a few logged sessions of a lift.' };

  const w = pm.weight;
  const trend = w?.points ?? [];
  const latest = trend.at(-1) ?? null;
  const rate = w?.rate?.kgPerWeek ?? null;
  const shown = (kg: number) => round1(inWeight(kg, units));
  const weightWords = rate === null ? null : Math.abs(rate) < 0.1 ? 'steady' : rate < 0 ? (Math.abs(rate) < 0.5 ? 'slowly coming down' : 'coming down') : Math.abs(rate) < 0.5 ? 'slowly going up' : 'going up';
  const weight: HomeTile = latest
    ? { id: 'weight', label: 'Body weight', big: { value: shown(latest.trend).toFixed(1), unit: units.weight }, spark: trend.length >= 2 ? thin(trend.map((p) => p.trend)) : [], line: rate === null ? 'The weekly pace shows after a few more weigh-ins.' : Math.abs(rate) < 0.1 ? 'Steady over the last weeks.' : `${rate < 0 ? 'Down' : 'Up'} about ${shown(Math.abs(rate)).toFixed(1)} ${units.weight} a week.` }
    : { id: 'weight', label: 'Body weight', big: null, spark: [], line: 'No weigh-ins this cycle yet.' };

  const a = pm.calendar?.adherence ?? null;
  const consistency: HomeTile = a && a.lifting.pct !== null
    ? { id: 'consistency', label: 'Showing up', big: { value: String(Math.round(a.lifting.pct * 100)), unit: '%' }, spark: a.weeks.length >= 2 && a.target.lift ? thin(a.weeks.map((wk) => Math.min(1, wk.lift / a.target.lift))) : [], range: [0, 1], weeks: a.target.lift ? a.weeks.slice(-12).map((wk) => Math.min(1, wk.lift / a.target.lift)) : [], share: Math.min(1, a.lifting.pct), line: `${a.lifting.done} of ${a.lifting.planned} lifting days done this cycle.` }
    : { id: 'consistency', label: 'Showing up', big: null, spark: [], line: 'Counts from your first full week.' };

  // The lead: what the tiles say, in one or two sentences.
  const strong = real.length ? (up.length * 2 > real.length ? 'you’re getting stronger' : 'your lifts are holding steady') : null;
  const body = weightWords ? `your weight is ${weightWords}` : null;
  const first = [strong, body].filter(Boolean).join(' and ');
  // Early in a cycle no trend is ready yet; the sessions done so far are, so the sentence says that instead.
  const early = a && a.lifting.planned && a.lifting.done ? `Early days: ${a.lifting.done} of ${a.lifting.planned} lifting days done so far.` : null;
  const lead = first ? `${first.charAt(0).toUpperCase()}${first.slice(1)}.` : early ?? 'Your progress shows here after a few logged sessions and weigh-ins.';
  const second = stalled.length ? `${countWord(stalled.length)} ${stalled.length === 1 ? 'lift has' : 'lifts have'} stopped moving; Sunday’s check-in will look at ${stalled.length === 1 ? 'it' : 'them'}.` : null;
  return { since: pm.cycle?.since ?? null, lead, after: second ?? (!first && early ? 'The trends show after a few more sessions and weigh-ins.' : null), tiles: [strength, weight, consistency] };
}


// ---------------------------------------------------------------- your tabs

/** The Sunday check-in's state in a few words: what the Check-in tab would ask for now. */
function checkinNow(x: HomeInputs, needs: readonly HomeNeed[]): Pick<HomeTab, 'now' | 'tone'> {
  const m = x.today;
  const c = m.coach.now?.value;
  if (c?.state === 'answer-first' && c.date < m.date) return { now: `${dayText(c.date)} not saved yet`, tone: 'due' };
  if (c && (c.state === 'due' || c.state === 'late')) return { now: c.kind === 'letter' ? 'Answers saved; ask for the letter' : `Answers saved; ask for the ${c.title.toLowerCase()}`, tone: 'due' };
  const sunday = addDays(mondayOf(m.date), 6);
  const from = mondayOf(m.date);
  if (x.read.data.checkins.weekly.some((w) => w.date === sunday || w.weekStart === from || w.weekOf === from)) return { now: 'This week’s answers saved', tone: null };
  const due = needs.find((n) => n.id === 'sunday');
  if (due) return { now: m.date === sunday ? 'Due today' : 'Due Sunday', tone: 'due' };
  return { now: `Next on ${dayText(sunday)}`, tone: null };
}

function tabsPart(x: HomeInputs, home: Omit<Home, 'tabs'>, allNeeds: readonly HomeNeed[]): HomeTab[] {
  const r = x.today.review;
  const hero = home.hero;
  if (!r || !hero) return [];
  const habits = home.food?.habits ?? null;
  const habitsText = habits && habits.total ? (habits.done === habits.total ? 'habits all done' : `${habits.done} of ${habits.total} habits done`) : null;
  const morningOpen = allNeeds.some((n) => n.id === 'morning');
  const day = hero.state === 'planned' ? hero.title : hero.state === 'logged' ? `${hero.title} logged` : hero.state === 'missed' ? 'Marked missed' : 'Rest day';
  const today: HomeTab = { id: 'today', label: 'Today', does: 'Your workout and what’s left today', now: morningOpen ? 'Morning check-in open' : [day, habitsText].filter(Boolean).join(' · '), tone: morningOpen ? 'due' : null };

  const strength = home.progress?.tiles.find((t) => t.id === 'strength')?.big ?? null;
  const weight = home.progress?.tiles.find((t) => t.id === 'weight')?.big ?? null;
  const flagged = allNeeds.some((n) => n.id.startsWith('units-'));
  const bodyDue = allNeeds.some((n) => n.id.startsWith('body-'));
  const progress: HomeTab = {
    id: 'progress', label: 'Progress', does: 'Strength, weight and body over time',
    now: flagged ? 'One entry to check' : bodyDue ? 'Measurements due' : strength ? `${strength.value} ${strength.unit}` : weight ? `Weight ${weight.value} ${weight.unit}` : 'Starts with your first logged lift',
    tone: flagged ? 'warn' : bodyDue ? 'due' : null,
  };

  const w = r.week;
  const d = r.deload?.value;
  const light = d?.deload ? 'light week now' : d?.weeksToScheduled ? (d.weeksToScheduled === 1 ? 'light week next week' : `light week in ${d.weeksToScheduled} weeks`) : null;
  const plan: HomeTab = {
    id: 'plan', label: 'Plan', does: w?.planWeeks ? `Your ${w.planWeeks} weeks, each phase, and why` : 'Every session, and why',
    now: [w?.planWeek ? `Week ${w.planWeek}${w.planWeeks ? ` of ${w.planWeeks}` : ''}` : null, light].filter(Boolean).join(' · ') || 'Your sessions this week',
    tone: null,
  };

  const checkin: HomeTab = { id: 'checkin', label: 'Check-in', does: 'Sunday’s questions and the coach’s letter', ...checkinNow(x, allNeeds) };

  const p = home.food?.protein ?? null;
  const food: HomeTab = {
    id: 'food', label: 'Food', does: 'Your eating plan and protein',
    now: p ? `${p.grams} g protein a day` : x.food?.plan ? 'Your eating plan' : 'No eating plan yet',
    tone: null,
  };
  return [today, progress, plan, checkin, food];
}

/** Home for the date, from the reports the view has. */
export function buildHome(x: HomeInputs): Home {
  const n = needs(x);
  const home = { date: x.today.date, hero: hero(x.today, x.session), needs: n, food: x.today.review ? foodPart(x) : null, progress: progressPart(x) };
  return { ...home, tabs: tabsPart(x, home, [...n.items, ...n.rest]) };
}
