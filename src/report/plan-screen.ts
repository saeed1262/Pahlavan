// The Plan screen's report: the vault plan's macrocycle as the adapter reads
// it (phases, mesocycles, weeks, calibration, deload and test weeks), the
// decisions from Coach/Decisions.md, busy weeks from the check-ins, the
// Ledger's limits and the plan's own temporary changes, this mesocycle's
// session templates, planned sets per muscle, the phase targets, the
// training load and what comes up next. What it measures (the targets, the
// adherence row, the priority muscles' sets, the load of the weeks before)
// counts from the cycle start. Each Sunday's check-in and phase review in
// Coming up name the coach step after it, and `coach` has every plan
// Sunday's (core/coach-steps.ts). Pure: the date, the Decisions text and
// the newest letter are inputs.

import type { VaultRead } from '../adapters/vault/read.ts';
import { busyPeriods } from '../core/checkins.ts';
import { planSteps, type CoachStep } from '../core/coach-steps.ts';
import { adherenceSince } from '../core/cycle.ts';
import { addDays, daysBetween, isIsoDate } from '../core/dates.ts';
import { effectiveSlot } from '../core/plan.ts';
import { parseNote } from '../core/plan-data.ts';
import { minimumWeek } from '../core/minimum-week.ts';
import { generatePlan } from '../core/plan/generate.ts';
import { screeningDue } from '../core/safety.ts';
import type { IsoDate } from '../core/schema.ts';
import { coachStepsOf } from './checkin-screen.ts';
import { scopeInfo } from './cycle.ts';
import { envelope, sourcesOf } from './envelope.ts';
import { bodyTargets, healthAverages, tapeTrends } from './progress-more.ts';
import { volumeViews } from './progress.ts';
import { buildReview, context, nameOf, typeOf } from './review.ts';
import { weightTrend } from '../core/weight.ts';
import type { Result } from '../core/reason.ts';
import type { PullPush } from '../core/volume.ts';
import { STALL } from '../core/stall.ts';
import { stepsGoal } from '../core/plan/conditioning.ts';
import { paths } from '../adapters/vault/layout.ts';

// ---------------------------------------------------------------- decisions

export interface Decision {
  date: IsoDate;
  title: string;
  status: string | null;
  review: IsoDate | null;
  outcome: string | null;
  trigger: string | null;
  data: string | null;
  rule: string | null;
  change: string | null;
  effect: string | null;
}

/**
 * Coach/Decisions.md (the skill's formats.md): one "## YYYY-MM-DD · Title"
 * per decision, with "- **Field:** value" lines; the status line carries
 * "· **review:** date · **outcome:** text". Headings that are not dated are
 * skipped.
 */
export function parseDecisions(md: string): Decision[] {
  const out: Decision[] = [];
  const blocks = md.split(/^##\s+/m).slice(1);
  for (const block of blocks) {
    const [head = '', ...lines] = block.split('\n');
    const m = /^(\d{4}-\d{2}-\d{2})\s*[·\-–—:]\s*(.+?)\s*$/.exec(head.trim());
    if (!m || !isIsoDate(m[1])) continue;
    // "- **Field:** value" (formats.md), or plain "- Field: value".
    const field = (name: string) => {
      const re = new RegExp(`^\\s*-\\s*(?:\\*\\*)?${name}:(?:\\*\\*)?\\s*([^·\\n]*?)\\s*(?:·|$)`, 'i');
      for (const l of lines) {
        const f = re.exec(l);
        if (f) return f[1]!.trim() || null;
      }
      return null;
    };
    const statusLine = lines.find((l) => /(?:\*\*)?Status:/i.test(l)) ?? '';
    const status = /Status:(?:\*\*)?\s*([a-z-]+)/i.exec(statusLine)?.[1]?.toLowerCase() ?? null;
    const review = /review:(?:\*\*)?\s*(\d{4}-\d{2}-\d{2})/i.exec(block)?.[1] ?? null;
    const outcome = /outcome:(?:\*\*)?\s*([^\n]+)/i.exec(statusLine)?.[1]?.trim() ?? null;
    out.push({ date: m[1] as IsoDate, title: m[2]!, status, review: review as IsoDate | null, outcome: outcome && !/^\(filled at review\)$/i.test(outcome) ? outcome : null, trigger: field('Trigger'), data: field('Data'), rule: field('Rule'), change: field('Change'), effect: field('Expected effect') });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ---------------------------------------------------------------- the calendar

export type PlanEventKind = 'checkin' | 'tape' | 'photos' | 'tests' | 'deload' | 'phase-review' | 'rescreen' | 'ledger-end' | 'change-end';

export interface PlanWeek {
  index: number;
  start: IsoDate;
  end: IsoDate;
  kind: string;
  calibration: boolean;
  tests: boolean;
  phase: number;
  meso: number;
  weekInMeso: number;
  /** The mesocycle's last week: photo day. */
  photos: boolean;
}

/**
 * What comes up, by the generator's calendar rules (schedule.ts) applied to
 * the vault plan's weeks: the check-in every Sunday, tape every second week,
 * photos at each mesocycle's end, tests on the Saturday of a test week, the
 * deload week's Monday, a phase review at each phase's end, and the
 * re-screening date when there is a profile.
 */
export function planCalendar(weeks: readonly PlanWeek[], phases: readonly { index: number; to: IsoDate }[], rescreen: IsoDate | null) {
  const ev: { date: IsoDate; week: number | null; kind: PlanEventKind }[] = [];
  for (const w of weeks) {
    if (w.kind === 'deload') ev.push({ date: w.start, week: w.index, kind: 'deload' });
    if (w.tests) ev.push({ date: addDays(w.start, 5), week: w.index, kind: 'tests' });
    if (w.photos) ev.push({ date: w.end, week: w.index, kind: 'photos' });
    if (w.index % 2 === 0) ev.push({ date: w.end, week: w.index, kind: 'tape' });
    ev.push({ date: w.end, week: w.index, kind: 'checkin' });
  }
  for (const p of phases) ev.push({ date: p.to, week: weeks.filter((w) => w.phase === p.index).at(-1)?.index ?? null, kind: 'phase-review' });
  if (rescreen) ev.push({ date: rescreen, week: null, kind: 'rescreen' });
  const order: PlanEventKind[] = ['deload', 'tests', 'photos', 'tape', 'checkin', 'phase-review', 'rescreen'];
  return ev.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : order.indexOf(a.kind) - order.indexOf(b.kind)));
}

// ---------------------------------------------------------------- the report

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The whole Plan report for the date. `decisions` is Coach/Decisions.md's text (null: no file); `letter` the newest coach letter's. */
export function buildPlan(read: VaultRead, date: IsoDate, extra: { decisions?: string | null; letter?: { path: string; text: string } | null } = {}, root = '') {
  const { data } = read;
  const notes: { code: string; text: string }[] = [];
  if (read.files.plan === 'missing') {
    notes.push({ code: 'no-plan', text: `No plan found (${paths().plan}).` });
    return envelope('plan-screen', { sources: sourcesOf(read, root), date, weeks: [], phases: [], mesocycles: [], notes }, data.warnings, data.errors);
  }
  const ctx = context(data, date);
  const review = buildReview(data, date);
  const cycle = scopeInfo(data, date, 'cycle');

  // The macrocycle, week by week.
  const weeks: PlanWeek[] = [];
  const phases: { index: number; name: string; goal: string | null; from: IsoDate; to: IsoDate }[] = [];
  const mesocycles: { index: number; name: string; phase: number; from: IsoDate; to: IsoDate }[] = [];
  let n = 0;
  let mi = 0;
  data.program.macrocycle.phases.forEach((ph, pi) => {
    const first = n + 1;
    for (const m of ph.mesocycles) {
      mi++;
      m.weeks.forEach((w, wi) => {
        n++;
        weeks.push({ index: n, start: w.start, end: addDays(w.start, 6), kind: w.kind, calibration: w.calibration === true, tests: w.tests === true, phase: pi + 1, meso: mi, weekInMeso: wi + 1, photos: wi === m.weeks.length - 1 });
      });
      const ws = weeks.filter((w) => w.meso === mi);
      if (ws.length) mesocycles.push({ index: mi, name: m.name, phase: pi + 1, from: ws[0]!.start, to: ws.at(-1)!.end });
    }
    const ws = weeks.slice(first - 1);
    // Tests in each phase's last week, the generator's rule, when the plan does not mark them.
    if (ws.length && !ws.some((w) => w.tests)) ws.at(-1)!.tests = true;
    if (ws.length) phases.push({ index: pi + 1, name: ph.name, goal: ph.goal ?? null, from: ws[0]!.start, to: ws.at(-1)!.end });
  });
  const now = weeks.find((w) => w.start <= date && date <= w.end) ?? null;
  if (!weeks.length) notes.push({ code: 'no-weeks', text: 'The plan has no weeks yet: they start with the first logged plan session.' });

  // Decisions, busy weeks, the Ledger and the temporary changes.
  // The decision log from the cycle start: entries from the cycle before are history, not this plan's.
  const decisions = (typeof extra.decisions === 'string' ? parseDecisions(extra.decisions) : []).filter((d) => !cycle.since || d.date >= cycle.since);
  if (extra.decisions == null) notes.push({ code: 'no-decisions', text: 'No decision log yet (Coach/Decisions.md): the coach writes one entry per plan change.' });
  const busy = busyPeriods(data.checkins.weekly, addDays(date, 365)).map((b) => ({ from: b.from, to: b.to, kind: b.kind, label: (b as { label?: string; note?: string }).label ?? (b as { note?: string }).note ?? (b.kind === 'travel' ? 'Travel' : 'Busy') }));
  const ledger = (data.ledger?.constraints ?? []).map((c) => ({ id: c.id, area: c.area ?? c.id, noTags: c.noTags ?? [], noMovements: c.noMovements ?? [], until: c.until ?? null, note: c.note ?? null, source: 'ledger' as const }));
  if (data.coach.ledger === 'missing') notes.push({ code: 'no-ledger', text: 'No Ledger yet (Coach/ledger.json): the plan’s own temporary changes are shown.' });
  const temporary = review.temporaryChanges.active.map((t) => ({ session: t.session, item: t.item, until: t.until, reason: t.reason, wayBack: t.wayBack }));

  // This mesocycle's templates, as planned this week.
  const week = ctx.week;
  const flagged = (review.ledger?.flagged ?? []) as { session: string; value: { exercise: string; allowed: boolean; conditions: string[] }; reason: { note?: string } }[];
  const templates = (week?.sessions ?? []).map((t) => {
    const type = typeOf(ctx, t.id);
    // A short day's minutes as planned and its time check (the review's); a lifting day shows none here.
    const time = t.kind === 'short' ? review.time.sessions.find((x) => x.type === type) : undefined;
    return {
      id: t.id,
      type,
      name: data.plan.types.find((x) => x.template === t.id)?.label ?? t.name,
      kind: t.kind,
      ...(time ? { minutes: { estimate: time.estimate, check: time.check } } : {}),
      slots: t.slots.map((raw) => {
        const s = effectiveSlot(raw, date).value;
        const extra2 = raw as typeof raw & { _item?: { sr?: string; note?: string } };
        const lf = flagged.find((f) => f.session === type && f.value.exercise === s.exercise);
        return {
          exercise: s.exercise,
          name: nameOf(ctx, s.exercise),
          sr: extra2._item?.sr ?? null,
          sets: s.sets,
          repRange: s.repRange,
          rir: s.rir,
          main: s.main === true,
          progression: raw.progression ?? null,
          until: raw.until && raw.until.until >= date ? { until: raw.until.until, reason: raw.until.reason, exercise: raw.until.exercise ?? null, exerciseName: raw.until.exercise ? nameOf(ctx, raw.until.exercise) : null } : null,
          ledger: lf ? { allowed: lf.value.allowed, conditions: lf.value.conditions, note: lf.reason.note ?? null } : null,
          /** The plan's own reason for the item ("Why: ..." in its plan-data note), or null. */
          why: parseNote(extra2._item?.note).why,
        };
      }),
    };
  });

  // Planned sets per muscle against the bands (the priority rows' done sets from the cycle start).
  const volume = volumeViews(ctx, review, date, cycle.since);

  // Targets: the generator's predictions on the profile, the profile's own numbers, and the standing rows.
  const profile = data.profile;
  let generated: { measure: string; unit: string; predicted: [number, number]; by: IsoDate; goal: string; kind: string }[] | null = null;
  if (profile && now) {
    const g = generatePlan({ profile, today: date, options: { start: phases[0]?.from ?? date } });
    const phaseEnd = phases[now.phase - 1]?.to ?? date;
    generated = (g.value.proposal.targets ?? []).map((t) => ({ measure: t.measure, unit: t.unit, predicted: t.predicted, by: phaseEnd, goal: t.goal, kind: t.kind }));
  }
  // The targets count from the cycle start (the newest baseline, else the first plan week).
  const since = cycle.since;
  const tape = tapeTrends(data.body.tape, since);
  const waist = tape.measures.find((m) => m.key === 'waist');
  const wpts = weightTrend(data.body.weights, since ? { through: date, since } : { through: date }).value.points;
  const rhr = healthAverages(data.checkins.daily, 'rhr', date, since);
  const sleep = healthAverages(data.checkins.daily, 'sleepH', date, since);
  const steps = healthAverages(data.checkins.daily, 'steps', date, since);
  const profileTargets = profile?.targets ? bodyTargets(profile.targets, {
    waist: waist && waist.points.length > 1 ? { first: waist.first!.value, last: waist.last!.value } : null,
    weight: wpts.length > 1 ? { first: r2(wpts[0]!.trend), last: r2(wpts.at(-1)!.trend) } : null,
    rhr: rhr && rhr.series.length >= 8 ? { first: rhr.firstWeek, last: rhr.avg7, n: rhr.series.length } : null,
    steps: steps ? { avg: steps.avg7, n: steps.n7 } : null,
    sleep: sleep ? { avg: sleep.avg7, n: sleep.n7 } : null,
  }, { steps: stepsGoal((profile.goals ?? []).map((g) => g.kind), Math.max(0, (now?.phase ?? 1) - 1)), sleepH: STALL.sleepH }) : null;
  if (!profile) notes.push({ code: 'no-profile', text: 'No coach profile yet (Coach/profile.json): the phase targets come from the intake (/fitness-coach intake).' });
  const rate = review.weight.rate.value as { pctPerWeek: number; kgPerWeek: number } | null;
  const band = (review.weight.band as { value: { band: { unit: string; lo: number; hi: number }; status: string } | null }).value;
  // Only the cycle's complete weeks: the weeks before a fresh start are not this plan's shortfall.
  const adherence = adherenceSince(review.adherence.value, since).value as { lifting: { done: number; planned: number; pct: number }; weeks: unknown[]; to: IsoDate } | null;
  const four = volume.views.four.muscles.filter((m) => m.priority);
  const standing = {
    rate: rate && band ? { pct: r2(rate.pctPerWeek * 100), lo: r2(band.band.lo * (band.band.unit === 'pct' ? 100 : 1)), hi: r2(band.band.hi * (band.band.unit === 'pct' ? 100 : 1)), unit: band.band.unit, status: band.status } : null,
    adherence: adherence ? { done: adherence.lifting.done, planned: adherence.lifting.planned, pct: r2(adherence.lifting.pct * 100), to: adherence.to, weeks: adherence.weeks.length } : null,
    priority: four.map((m) => ({ muscle: m.muscle, sets: m.sets, status: m.status })),
    baselineWaist: waist?.first ?? null,
    currentWaist: waist?.last ?? null,
  };

  // Training load: the last 4 weeks, this week so far, and next week as planned.
  const load = review.load as unknown as { thisWeek: { value: WeekLoadShape }; last4: { value: WeekLoadShape }[]; nextWeek: { value: { from: IsoDate; sessions: { template: string; name: string; minutes: number | null; rpe: number; load: number | null }[]; load: number; heuristic: boolean } } };
  const layout = (review.concurrent as { layout?: { session: string; day: string }[] }).layout ?? [];
  const dayIdx: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
  const usedDays = new Set<number>();
  const nextSessions = load.nextWeek.value.sessions.map((s) => {
    const type = data.plan.types.find((t) => t.template === s.template)?.type;
    const slot = layout.find((l) => l.session === type && !usedDays.has(dayIdx[l.day] ?? -1));
    const day = slot ? dayIdx[slot.day]! : [...Array(7).keys()].find((d) => !usedDays.has(d)) ?? 6;
    usedDays.add(day);
    return { ...s, day };
  });
  const daily = (w: WeekLoadShape) => w.daily;
  const loadView = {
    // The weeks before the cycle start are left out (this week always stays).
    weeks: [...load.last4.map((w) => w.value).filter((w) => !since || w.to >= since), load.thisWeek.value].map((w) => ({ from: w.from, to: w.to, load: w.knownLoad ?? w.load, monotony: w.monotony, daily: daily(w), sessions: w.sessions.map((s) => ({ date: s.date, minutes: s.minutes, rpe: s.rpe, load: s.load })), unknown: w.unknownSessions, current: w.from <= date && date <= w.to })),
    // A planned session without minutes has no load: `knownLoad` sums the rest and `unknown` counts them.
    next: { from: load.nextWeek.value.from, load: load.nextWeek.value.load, knownLoad: r2(nextSessions.reduce((a, s) => a + (s.load ?? 0), 0)), unknown: nextSessions.filter((s) => s.load == null).length, sessions: nextSessions, daily: Array.from({ length: 7 }, (_, d) => nextSessions.filter((s) => s.day === d).reduce((a, s) => a + (s.load ?? 0), 0)), heuristic: load.nextWeek.value.heuristic },
  };
  const nextMean = loadView.next.daily.reduce((a, v) => a + v, 0) / 7;
  const nextSd = Math.sqrt(loadView.next.daily.reduce((a, v) => a + (v - nextMean) ** 2, 0) / 6);
  // An unknown session's day would read as rest, so the spread is not known either.
  const nextMonotony = nextSd && !loadView.next.unknown ? r2(nextMean / nextSd) : null;

  // Coming up, to the end of the phase.
  const rescreen = profile ? (screeningDue(profile.screening.date, date).reason.inputs['due'] as IsoDate) : null;
  const cal = planCalendar(weeks, phases, rescreen);
  const phaseEnd = now ? phases[now.phase - 1]!.to : addDays(date, 56);
  // Each plan Sunday's coach step: the check-in and the phase review name it.
  const coachSteps = planSteps(data.program, data.plan.weeks);
  const stepOf = new Map(coachSteps.map((x) => [x.value.date, x.value] as const));
  const withCoach = <E extends { date: IsoDate; kind: PlanEventKind }>(e: E): E & { coach?: CoachStep } => {
    const st = e.kind === 'checkin' || e.kind === 'phase-review' ? stepOf.get(e.date) : undefined;
    return st ? { ...e, coach: st } : e;
  };
  const upcoming = [
    ...cal.filter((e) => e.date > date && e.date <= phaseEnd).map(withCoach),
    ...ledger.filter((c) => c.until && c.until > date && c.until <= phaseEnd).map((c) => ({ date: c.until!, week: null, kind: 'ledger-end' as const, item: c.area })),
    ...temporary.filter((t) => t.until > date).map((t) => ({ date: t.until, week: null, kind: 'change-end' as const, item: t.item, wayBack: t.wayBack })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return envelope('plan-screen', {
    sources: sourcesOf(read, root),
    date,
    cycle,
    week: review.week,
    now: now ? { index: now.index, phase: now.phase, meso: now.meso } : null,
    weeks,
    phases,
    mesocycles,
    decisions,
    busy,
    ledger,
    temporary,
    templates,
    // The least that keeps a bad week on track: the plan's lifting days as Express.
    minimumWeek: minimumWeek({ liftDays: data.plan.weekTarget.lift, mainSets: data.plan.express?.mainSets ?? null, shortDays: data.plan.weekTarget.short }),
    volume: { muscles: volume.views.plan.muscles, priority: volume.priority, labels: volume.labels, topExercises: volume.topExercises, pullPush: pullPushView(review.volume.pullPush) },
    targets: { generated, profile: profileTargets, standing },
    load: { ...loadView, nextMonotony },
    upcoming,
    // The coach: the step after this week's check-in and where it stands, the next ones, and every plan Sunday's (the calendar).
    coach: { ...coachStepsOf(read, date, extra.letter ?? null), steps: coachSteps },
    daysLeft: now ? daysBetween(date, phaseEnd) : null,
    notes,
  }, data.warnings, data.errors);
}

/** The planned week's pull to push (review's `volume.pullPush`), for the Sets per muscle card's line. */
function pullPushView(r: Result<PullPush>) {
  const v = r.value;
  return { pull: v.pull, push: v.push, ratio: v.ratio, target: v.target, floor: v.floor, status: v.status, note: r.reason.note ?? null, rule: r.reason.rule };
}

interface WeekLoadShape {
  from: IsoDate;
  to: IsoDate;
  sessions: { date: IsoDate; minutes: number | null; rpe: number | null; load: number | null }[];
  daily: number[];
  load: number;
  knownLoad?: number;
  unknownSessions: number;
  monotony: number | null;
}
