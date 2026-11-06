// The check-in commands: `checkin template` (a skeleton for the coming
// check-in, pre-filled with what the engine already knows) and `checkin add`
// (validate the answers and merge them into Coach/checkins.json by date). No
// Node APIs: the CLI passes the file text in and does the one write itself.

import { planWeekOf, type VaultData, type VaultWarning } from '../adapters/vault/convert.ts';
import { checkinDate, checkinsThrough, fullLoadWeeks, jointAchesOf, liftMatches, triageStart } from '../core/checkins.ts';
import { toMinutes } from '../core/clock.ts';
import { addDays, dayText, mondayOf } from '../core/dates.ts';
import { DELOAD } from '../core/deload.ts';
import { proteinWeek } from '../core/diet.ts';
import { painText } from '../core/pain.ts';
import { proteinItemOf } from '../core/protein.ts';
import { SCHEMA_VERSION, type CheckinLog, type IsoDate, type Tracking, type WeeklyCheckin } from '../core/schema.ts';
import type { HabitsView } from '../core/tracking.ts';
import { canWrite, validateCheckinLog } from '../core/validate.ts';
import { cycleOf } from './cycle.ts';
import { buildReview, knownLifts } from './review.ts';
import { paths } from '../adapters/vault/layout.ts';

/** Record keys in the order the file writes them (checkin.md's question order, then the coach's fields). */
export const RECORD_ORDER = [
  'date',
  'weekStart',
  'weekOf',
  'confirmedUnlogged',
  'restDays',
  'missedDays',
  'unloggedSessions',
  'effort',
  'jointAches',
  'stress',
  'recovery',
  'reportedRir',
  'rir',
  'proteinDays',
  'proteinExtra',
  'pattern',
  'enjoyment',
  'knownBusy',
  'deload',
  'triage',
  'focusFollowed',
  'energy',
  'sleepQuality',
  'answers',
  'note',
  'notes',
  'letter',
] as const;

/** A question's options in order, each with the value it becomes. */
const o = (...pairs: [string, unknown][]) => pairs.map(([option, value]) => ({ option, value }));

function ordered(r: Record<string, unknown>): WeeklyCheckin {
  const out: Record<string, unknown> = {};
  for (const k of RECORD_ORDER) if (r[k] !== undefined) out[k] = r[k];
  for (const k of Object.keys(r)) if (!(k in out) && r[k] !== undefined) out[k] = r[k];
  return out;
}

/** A date for people: "Mon 6 Apr" (core/dates.ts, kept here for the existing imports). */
export { dayText };
/** "a, b and c". */
const andList = (xs: readonly string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** The Sunday on or before a date: the end of the week a check-in on that date reviews. */
export const reviewedSunday = (date: IsoDate): IsoDate => addDays(mondayOf(addDays(date, 1)), -1);

// ---------------------------------------------------------------- template

/** The focus line of a letter's frontmatter. */
export function letterFocus(text: string | null): string | null {
  const fm = text ? /^---\r?\n([^]*?)\r?\n---/.exec(text)?.[1] : undefined;
  const m = fm ? /^focus:\s*(.+)$/m.exec(fm) : null;
  return m ? m[1]!.trim() : null;
}

export interface LastLetter {
  path: string;
  focus: string | null;
}

/** What the template reads beyond the vault's files: the moment, and what is tracked. */
export interface TemplateOptions {
  /** Now. On the check-in Sunday itself, today is left out of the unticked protein days while its tick time is still ahead. */
  now?: { date: IsoDate; minutes: number } | null;
  /** Coach/tracking.json and the linked habits: the protein item's ticks, as the Food tab counts them. Absent: the Protein habit's ticks. */
  tracking?: { tracking: Tracking | null; habits: HabitsView | null } | null;
}

/** A question's fields as the existing record fills them: answered (open: false) or still open. */
type Filled = (record: WeeklyCheckin) => boolean;
const has = (v: unknown) => v !== null && v !== undefined;

/**
 * The week's protein days for the Sunday question: each day ticked, unticked,
 * or before the cycle (the item's ticks when it is tracked, else the homepage
 * Protein habit's), and whether today is left out (the check-in Sunday
 * itself, its tick still ahead: a tick that comes later counts by itself).
 */
function proteinDaysFor(data: VaultData, sunday: IsoDate, since: IsoDate | null, opts: TemplateOptions) {
  const tr = opts.tracking ?? null;
  const item = tr?.tracking ? proteinItemOf(data.eatingPlan, tr.tracking.items) : null;
  const floorG = data.eatingPlan?.protein.floorG ?? 0;
  const weekStart = mondayOf(sunday);
  const days: { date: IsoDate; ticked: boolean; before: boolean }[] = item
    ? proteinWeek({ item, tracking: tr!.tracking, habits: tr!.habits, date: sunday, since, floorG }).value.days.map((d) => ({ date: d.date, ticked: d.state === 'ticked', before: d.state === 'before' }))
    : Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d) => {
        const before = Boolean(since && d < since);
        return { date: d, ticked: !before && data.checkins.daily.some((c) => c.date === d && c.protein === true), before };
      });
  const tickAt = item?.reminder?.at ?? data.eatingPlan?.protein.tickAt ?? null;
  const at = toMinutes(tickAt);
  const todayOpen = days.find((d) => d.date === sunday && !d.ticked && !d.before) ?? null;
  const todayOut = Boolean(todayOpen && opts.now && opts.now.date === sunday && at !== null && opts.now.minutes < at);
  const unticked = days.filter((d) => !d.ticked && !d.before && !(todayOut && d.date === sunday)).map((d) => d.date);
  return { item: item?.id ?? null, source: item ? ('item' as const) : ('habit' as const), ticks: days.filter((d) => d.ticked).length, unticked, todayOut, tickAt: todayOut ? tickAt : null };
}

/**
 * The skeleton for the check-in that reviews the week ending on the Sunday
 * on or before `date`. With an existing record for that Sunday, a question
 * whose fields it fills is `answered` and not `open` (the coach asks only
 * the open ones); the Check-in screen shows both, to edit.
 */
export function buildTemplate(data: VaultData, date: IsoDate, lastLetterIn: LastLetter | null, opts: TemplateOptions = {}) {
  const sunday = reviewedSunday(date);
  const weekStart = mondayOf(sunday);
  const existing = data.checkins.weekly.find((w) => w.date === sunday) ?? null;
  const review = buildReview(data, sunday);
  const coming = buildReview(data, addDays(sunday, 1));
  const before = checkinsThrough(data.checkins.weekly, sunday).filter((w) => w.date !== sunday);
  const previous = before.at(-1) ?? null;
  const since = cycleOf(data, sunday).value.start;
  // The last letter is the one before this check-in: this Sunday's own letter (written after it) is not "last".
  const letterDate = lastLetterIn ? /(\d{4}-\d{2}-\d{2})\.md$/.exec(lastLetterIn.path)?.[1] ?? null : null;
  const lastLetter = lastLetterIn && !(letterDate && letterDate >= sunday) ? lastLetterIn : null;

  // Gaps: the week's logged days, ticked days with no session, days with neither (the cycle's days only).
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).filter((d) => !since || d >= since);
  const loggedDays = new Set(review.thisWeek.sessions.map((s) => s.date));
  const ticks = new Map(data.checkins.daily.filter((d) => d.date >= weekStart && d.date <= sunday).map((d) => [d.date, d]));
  const tickedNoLog = days.filter((d) => ticks.get(d)?.trained && !loggedDays.has(d));
  const blank = days.filter((d) => !loggedDays.has(d) && !ticks.get(d)?.trained);
  const shortfall = {
    lift: Math.max(0, review.thisWeek.lifting.target - review.thisWeek.lifting.done),
    short: Math.max(0, review.thisWeek.short.target - review.thisWeek.short.done),
  };

  // Lifts: the week's logged top sets, at the top of their range or not (a Hotel session's are other equipment, so not asked about); stalled lifts and their triage step.
  const liftByName = new Map(review.lifts.map((l) => [l.exercise, l]));
  const weekLifts = review.thisWeek.sessions.filter((s) => !('hotel' in s)).flatMap((s) =>
    s.lifts.map((l) => {
      const info = liftByName.get(l.exercise);
      return { date: s.date, lift: l.name, weight: l.weight, unit: l.unit, reps: l.reps, atTopOfRange: info?.repRange ? l.reps >= info.repRange[1] : null };
    }),
  );
  const stalled = review.lifts
    .filter((l) => l.stall.value.stalled)
    .map((l) => {
      const chosen = (l.triage ?? []).find((t) => t.value.chosen)?.value ?? null;
      const start = triageStart(before, [l.exercise, l.name, ...(l.short ? [l.short] : [])], sunday).value;
      return { lift: l.name, exercise: l.exercise, lastStep: start.last, startAt: start.startAt, step: chosen?.step ?? null, stepId: chosen?.id ?? null, suggestion: chosen?.suggestion ?? null };
    });

  // Deloads: the coming week's, and recent dashboard deload weeks with logged loads to ask about.
  const fullLoad = new Set(fullLoadWeeks(data.checkins.weekly, sunday));
  const deloadWeeksToAsk: { weekStart: IsoDate; planWeek: number; sessions: string[] }[] = [];
  if (data.plan.start) {
    for (let k = 0; k < 4; k++) {
      const mon = addDays(weekStart, -7 * k);
      if (mon < data.plan.start) break;
      const pw = planWeekOf(data.plan.start, mon);
      if (pw % DELOAD.every !== 0 || fullLoad.has(mon)) continue;
      const loaded = data.sessions.filter((s) => s.date >= mon && s.date <= addDays(mon, 6) && s.exercises.some((x) => x.sets.some((y) => y.weight > 0)));
      if (loaded.length) deloadWeeksToAsk.push({ weekStart: mon, planWeek: pw, sessions: loaded.map((s) => s.date) });
    }
  }
  const comingDeload = coming.deload?.value ?? null;
  const nextDeloadMonday = comingDeload ? addDays(addDays(sunday, 1), 7 * comingDeload.weeksToScheduled) : null;
  const prevAches = jointAchesOf(previous);
  // The week's pain the logs already hold, with the pain rule's verdict: the pain question shows it.
  const loggedPain = review.pain.reports.filter((r) => r.value.source === 'log' && r.value.date >= weekStart).map((r) => ({ date: r.value.date, area: r.value.area, severity: r.value.severity, exercise: r.value.exercise, session: r.value.session, verdict: r.value.verdict }));
  const painKnown = {
    ...(previous ? { lastCheckin: checkinDate(previous), aches: prevAches.aches } : {}),
    ...(loggedPain.length ? { logged: loggedPain, line: `Logged: ${loggedPain.map((p) => `${painText(p)}, ${dayText(p.date).split(' ')[0]}`).join('; ')}.` } : {}),
  };

  const record: Record<string, unknown> = existing
    ? { ...existing }
    : {
        date: sunday,
        weekStart,
        confirmedUnlogged: [],
        restDays: [],
        missedDays: [],
        effort: null,
        jointAches: null,
        stress: null,
        recovery: null,
        reportedRir: null,
        proteinExtra: null,
        ...(data.eatingPlan?.pattern?.length ? { pattern: null } : {}),
        enjoyment: null,
        knownBusy: [],
        deload: { cancelled: null, reason: null, trainedAtFullLoad: [] },
        triage: stalled.filter((t) => t.step !== null).map((t) => ({ lift: t.lift, step: t.step, date: sunday })),
        focusFollowed: null,
        energy: null,
        sleepQuality: null,
        notes: null,
        letter: `${paths().letters}/${sunday}.md`,
      };

  const protein = proteinDaysFor(data, sunday, since, opts);
  const proteinTicks = protein.ticks;
  const k = protein.unticked.length;
  const floorG = data.eatingPlan?.protein.floorG ?? review.weight.proteinFloorG ?? '<target>';
  const ask = [
    {
      n: 1,
      topic: 'gaps',
      question: `${review.thisWeek.sessions.length ? `The log shows ${andList(review.thisWeek.sessions.map((s) => `${s.name} on ${dayText(s.date)}`))}` : `Nothing is logged for the week of ${dayText(weekStart)}`}. Anything you did that isn't logged?`,
      fields: ['confirmedUnlogged', 'restDays', 'missedDays'],
      open: true,
      known: { lifting: review.thisWeek.lifting, short: review.thisWeek.short, shortfall, tickedNotLogged: tickedNoLog, noSessionNoTick: blank },
      answer: 'Each session done but not logged: {date, type} (type: the plan session, A or S1, or custom); offer to log it now (log.md). Days that were planned rest: restDays; sessions skipped: missedDays.',
    },
    { n: 2, topic: 'effort', question: "How hard did the week's training feel overall?", fields: ['effort'], open: true, options: o(['Easy (5 or less of 10)', 5], ['Solid (6-7)', 7], ['Hard (8-9)', 9], ['Too much (10)', 10]) },
    {
      n: 3,
      topic: 'pain',
      question: 'Any pain or niggle?',
      fields: ['jointAches'],
      open: true,
      options: o(['None', []], ['Mild, gone by the next day (3/10 or less)', [{ area: '<where>', severity: 2 }]], ['Lingered or over 3/10', [{ area: '<where>', severity: 5, exercise: '<movement>', lingered: true }]], ['Something new', [{ area: '<where>', severity: '<0-10>' }]]),
      known: Object.keys(painKnown).length ? painKnown : null,
      answer: 'Over 3/10 or lingering: the pain rule (skip or swap the movement; if it persists, see a professional) and a Ledger entry. A red flag stops the check-in.',
    },
    { n: 4, topic: 'life', question: 'How was the week outside training?', fields: ['stress'], open: true, options: o(['Calm', 1], ['Normal', 2], ['Busy', 4], ['Crunch, travel or illness', 5]) },
    {
      n: 5,
      topic: 'recovery',
      question: 'Recovered by the next session?',
      fields: ['recovery'],
      open: true,
      options: o(['Always', 5], ['Mostly', 4], ['Often still sore', 2], ['Sore all week', 1]),
      known: previous ? { lastCheckin: checkinDate(previous), recovery: previous.recovery ?? null, jointAches: prevAches.fatigue } : null,
      answer: previous && previous.recovery !== undefined && previous.recovery <= 2 && prevAches.fatigue
        ? 'The last check-in had poor recovery and joint aches: another one brings the offer of an early light week.'
        : undefined,
    },
    {
      n: 6,
      topic: 'rir',
      question: 'On your logged top sets, how many more clean reps were left?',
      fields: ['reportedRir'],
      open: weekLifts.length > 0,
      options: o(['0-1', 0.5], ['2-3', 2.5], ['4', 4], ['5 or more (too light to judge)', 5], ["Didn't notice", null]),
      known: { topSets: weekLifts },
      answer: 'One number for all, or {"<lift name>": n} when the lifts differ. It matters most where the top set reached the top of its range.',
    },
    {
      n: 7,
      topic: 'protein',
      // The eating plan's floor when there is one (the protein item is ticked at it), else the engine's at the trend weight.
      question: `On how many of the ${k} unticked day${k === 1 ? '' : 's'}${protein.todayOut ? ' before today' : ''} did you reach about ${floorG} g of protein${data.eatingPlan ? '' : " (or the Eating plan's target)"}?`,
      fields: ['proteinExtra'],
      open: k > 0,
      // One option a day: 0, 1, ... up to the unticked days asked about.
      options: o(...Array.from({ length: k + 1 }, (_, i): [string, unknown] => [String(i), i])),
      known: { proteinTicks, unticked: protein.unticked, source: protein.source, item: protein.item, ...(protein.todayOut ? { today: { leftOut: true, tickAt: protein.tickAt } } : {}) },
      answer: `proteinExtra = the answer, 0 to ${k}: the unticked days that reached it. The week's protein days are its ticks plus these, counted when read, so a tick that comes later${protein.todayOut ? ` (today's, at ${protein.tickAt})` : ''} is not counted twice.`,
    },
    // The eating plan's weekly pattern: one question, a tap per line (met this week or not); the Food tab shows the answers.
    ...(data.eatingPlan?.pattern?.length
      ? [
          {
            n: 14,
            topic: 'pattern',
            question: 'The eating plan\u2019s pattern, the week just gone: which lines did you meet?',
            fields: ['pattern'],
            open: true,
            lines: data.eatingPlan.pattern.map((l) => ({ id: l.id, name: l.name, target: l.target, per: l.per })),
            options: o(['Met', true], ['Not met', false]),
            known: { lines: data.eatingPlan.pattern.map((l) => `${l.name}: ${l.target}`), last: previous?.pattern ?? null },
            answer: '{"<line id>": true or false}, one tap per line, met this week or not; leave out a line the user is unsure of. Only the Food tab shows them: no rule reads them.',
          },
        ]
      : []),
    { n: 8, topic: 'enjoyment', question: 'How much did you look forward to sessions?', fields: ['enjoyment'], open: true, options: o(['A lot', 5], ['Fine', 4], ['Meh', 2], ['Dreaded them', 1]) },
    {
      n: 9,
      topic: 'availability',
      question: 'Anything different next week?',
      fields: ['knownBusy'],
      open: true,
      options: o(['Normal', []], ['Travel', [{ from: '<date>', to: '<date>', kind: 'travel' }]], ['Busy, fewer days', [{ from: '<date>', to: '<date>', kind: 'crunch', sessions: '<how many>' }]], ['Unsure', []]),
      known: { nextDeloadWeek: nextDeloadMonday, alreadyKnown: review.checkins.knownBusy },
      answer: nextDeloadMonday ? `A busy week next to the light week (from ${dayText(nextDeloadMonday)}) moves the light week onto it; ask about the weeks around it too.` : undefined,
    },
    {
      n: 10,
      topic: 'decisions',
      question: "The due Decisions and last letter's question (prose: Decisions.md and the letter); and the last focus: followed?",
      fields: ['focusFollowed', 'notes'],
      open: true,
      known: { lastLetter },
    },
    ...(comingDeload?.deload
      ? [
          {
            n: 11,
            topic: 'deload',
            question: `Next week (from ${dayText(addDays(sunday, 1))}) is a light week${comingDeload.move ? ' (moved for a busy week)' : ''}. Keep it, or cancel it?`,
            fields: ['deload.cancelled', 'deload.reason'],
            open: true,
            known: {
              cancelOnlyIf: 'readiness normal or better, nothing stalled, adherence 80 % or more, and the last mesocycle had a light week',
              readiness: review.readiness.latestScored?.band ?? null,
              stalled: stalled.map((s) => s.lift),
              adherence: review.adherence.value.lifting.pct,
            },
          },
        ]
      : []),
    ...(deloadWeeksToAsk.length
      ? [
          {
            n: 12,
            topic: 'full-load',
            question: `The plan counted ${andList(deloadWeeksToAsk.map((w) => `week ${w.planWeek} (from ${dayText(w.weekStart)})`))} as a light week, and loads were logged for it. Was it trained at full load?`,
            fields: ['deload.trainedAtFullLoad'],
            open: true,
            known: { weeks: deloadWeeksToAsk },
            answer: 'Yes: its Monday goes in deload.trainedAtFullLoad, and progression uses those sessions as loading sessions.',
          },
        ]
      : []),
    ...(stalled.length
      ? [
          {
            n: 13,
            topic: 'triage',
            question: 'Not a question: record the triage step the letter applies to each stalled lift.',
            fields: ['triage'],
            open: true,
            known: { stalled },
            answer: 'The record is pre-filled with the step the engine chose; keep it if the letter applies it, change or drop it if not.',
          },
        ]
      : []),
  ];

  // An existing record answers a question when it fills its fields: then the question is not open (the coach asks only the open ones).
  const gapDays = [...tickedNoLog, ...blank];
  const lines = (data.eatingPlan?.pattern ?? []).map((l) => l.id);
  const lastFocus = lastLetter?.focus ?? null;
  const FILLED: Record<string, Filled> = {
    // Every day it asks about is answered (trained, rest or missed); none to ask about is answered too.
    gaps: (r) => gapDays.every((d) => (r.confirmedUnlogged ?? []).some((c) => c.date === d) || (r.restDays ?? []).includes(d) || (r.missedDays ?? []).includes(d)),
    effort: (r) => has(r.effort),
    pain: (r) => has(r.jointAches),
    life: (r) => has(r.stress),
    recovery: (r) => has(r.recovery),
    rir: (r) => has(r.reportedRir),
    protein: (r) => has(r.proteinExtra) || has(r.proteinDays),
    pattern: (r) => lines.every((id) => typeof r.pattern?.[id] === 'boolean'),
    enjoyment: (r) => has(r.enjoyment),
    // An empty list is the skeleton's default as well as "Normal": only a period on record answers it.
    availability: (r) => (r.knownBusy ?? []).length > 0,
    // The last focus, when there is one to ask about; else the notes.
    decisions: (r) => (lastFocus ? has(r.focusFollowed) : has(r.notes)),
    deload: (r) => has(r.deload?.cancelled),
    triage: (r) => stalled.every((t) => (r.triage ?? []).some((x) => liftMatches(x.lift, [t.lift, t.exercise]))),
  };
  // Number only the questions present; checkinMd keeps checkin.md's own number. A question that does not apply this week (no top sets, every protein day ticked) is neither open nor answered.
  const numbered = ask.map(({ n, ...a }, i) => {
    const answered = a.open && existing !== null && (FILLED[a.topic]?.(existing) ?? false);
    return { n: i + 1, ...(n <= 10 ? { checkinMd: n } : {}), ...a, open: a.open && !answered, answered };
  });
  return {
    date: sunday,
    weekStart,
    existing: existing !== null,
    record: ordered(record),
    ask: numbered,
    known: {
      deload: { reviewedWeek: review.deload?.value ?? null, comingWeek: comingDeload },
      fatigue: review.checkins.fatigue.value,
      recoveryTrigger: review.checkins.recoveryTrigger.value,
      trainedAtFullLoad: [...fullLoad],
    },
  };
}

// ---------------------------------------------------------------- add

/** Drops unanswered (null) fields, at the top level and in `deload`; an empty `deload` goes too. */
export function cleanRecord(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || v === undefined) continue;
    if (k === 'deload' && typeof v === 'object' && !Array.isArray(v)) {
      const d = Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== null && x !== undefined && !(Array.isArray(x) && x.length === 0)));
      if (Object.keys(d).length) out[k] = d;
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** The records in an answers file: one record, a list of them, a log, or a template's output. */
export function recordsOf(answers: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(answers)) return answers.every((x) => typeof x === 'object' && x !== null && !Array.isArray(x)) ? (answers as Record<string, unknown>[]) : null;
  if (typeof answers !== 'object' || answers === null) return null;
  const a = answers as Record<string, unknown>;
  if (Array.isArray(a['checkins'])) return recordsOf(a['checkins']);
  if (typeof a['record'] === 'object' && a['record'] !== null) return [a['record'] as Record<string, unknown>];
  return [a];
}

export interface AddResult {
  errors: VaultWarning[];
  warnings: VaultWarning[];
  doc: CheckinLog | null;
  results: { action: 'added' | 'updated' | 'unchanged'; date: IsoDate; record: WeeklyCheckin; previous?: WeeklyCheckin }[];
}

/**
 * Validates the answers and merges them into the check-in log by date: a new
 * date is added, an existing date is updated field by field (a field left
 * out keeps its value; `deload` merges by key). No other record changes.
 */
export function addCheckins(input: { existingText: string | null; answers: unknown; today: IsoDate; data: VaultData }): AddResult {
  const errors: VaultWarning[] = [];
  const warnings: VaultWarning[] = [];
  const fail = (message: string): AddResult => ({ errors: [...errors, { code: 'checkin', message }], warnings, doc: null, results: [] });

  const raw = recordsOf(input.answers);
  if (!raw || raw.length === 0) return fail('The answers file holds no check-in record (an object, a list of them, or a template output with "record").');
  const records = raw.map(cleanRecord);
  const own = validateCheckinLog({ schemaVersion: SCHEMA_VERSION, checkins: records });
  if (own.length) return { errors: own.map((e) => ({ code: 'schema', message: `answers ${e.path}: ${e.message}` })), warnings, doc: null, results: [] };
  for (const r of records) if ((r['date'] as string) > input.today) return fail(`The check-in date ${String(r['date'])} is after today (${input.today}).`);

  let doc: CheckinLog = { schemaVersion: SCHEMA_VERSION, checkins: [] };
  if (input.existingText !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.existingText);
    } catch (e) {
      return fail(`Coach/checkins.json is not valid JSON (${(e as Error).message}): fix it first; nothing was merged.`);
    }
    const guard = canWrite(parsed);
    if (!guard.value) return fail(`Coach/checkins.json: ${guard.reason.note}`);
    const errs = validateCheckinLog(parsed);
    if (errs.length) return { errors: errs.map((e) => ({ code: 'checkins', message: `Coach/checkins.json ${e.path}: ${e.message} (fix it first; nothing was merged)` })), warnings, doc: null, results: [] };
    doc = parsed as CheckinLog;
  }

  const results: AddResult['results'] = [];
  const merged = [...doc.checkins];
  for (const r of records) {
    const i = merged.findIndex((w) => w.date === r['date']);
    if (i < 0) {
      const rec = ordered(r);
      merged.push(rec);
      results.push({ action: 'added', date: rec.date!, record: rec });
      continue;
    }
    const prev = merged[i]!;
    const next: Record<string, unknown> = { ...prev, ...r };
    if (prev.deload && r['deload']) next['deload'] = { ...prev.deload, ...(r['deload']) };
    const rec = ordered(next);
    const same = JSON.stringify(rec) === JSON.stringify(ordered(prev as Record<string, unknown>));
    merged[i] = rec;
    results.push({ action: same ? 'unchanged' : 'updated', date: rec.date!, record: rec, previous: prev });
  }
  merged.sort((a, b) => ((a.date ?? '') < (b.date ?? '') ? -1 : (a.date ?? '') > (b.date ?? '') ? 1 : 0));
  const out: CheckinLog = { ...doc, schemaVersion: SCHEMA_VERSION, checkins: merged };
  const errs = validateCheckinLog(out);
  if (errs.length) return { errors: errs.map((e) => ({ code: 'schema', message: `merged log ${e.path}: ${e.message}` })), warnings, doc: null, results: [] };

  // What the engine will not be able to use.
  const lifts = knownLifts(input.data);
  const isLift = (name: string) => lifts.some((l) => liftMatches(name, [l])) || Object.keys(input.data.program.exercises).some((id) => liftMatches(name, [id]));
  const group = (code: string, message: string, items: string[]) => items.length && warnings.push({ code, message, items });
  for (const r of results.map((x) => x.record)) {
    group('unknown-lift', `${r.date}: triage or reported-RIR lifts the plan and the log do not know; the engine will not match them.`, [
      ...(r.triage ?? []).map((t) => t.lift).filter((l) => !isLift(l)),
      ...(r.reportedRir && typeof r.reportedRir === 'object' ? Object.keys(r.reportedRir).filter((l) => !isLift(l)) : []),
    ]);
    if (input.data.plan.start) {
      const start = input.data.plan.start;
      group('not-a-deload-week', `${r.date}: trainedAtFullLoad weeks that are not dashboard deload weeks (every ${DELOAD.every}th plan week); they change nothing.`, (r.deload?.trainedAtFullLoad ?? []).filter((m) => m < start || planWeekOf(start, m) % DELOAD.every !== 0));
      if (r.deload?.cancelled) {
        const coming = mondayOf(addDays(r.date!, 1));
        const review = buildReview(input.data, coming);
        if (!review.deload?.value.deload && !review.deload?.value.cancelled) {
          warnings.push({ code: 'nothing-to-cancel', message: `${dayText(r.date!)}: deload.cancelled applies to the week of ${dayText(coming)}, which is not a deload week.` });
        }
      }
    }
    group('past-busy', `${r.date}: knownBusy periods that ended before the check-in; they move no deload.`, (r.knownBusy ?? []).filter((b) => b.to < r.date!).map((b) => `${b.from} to ${b.to}`));
    const lines = new Set((input.data.eatingPlan?.pattern ?? []).map((l) => l.id));
    group('unknown-pattern', `${r.date}: pattern answers for lines the eating plan does not have${input.data.eatingPlan ? '' : ' (there is no eating plan)'}; the Food tab shows only the plan's lines.`, Object.keys(r.pattern ?? {}).filter((k) => !lines.has(k)));
  }
  return { errors, warnings, doc: out, results };
}
