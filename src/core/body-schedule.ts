// The body record's schedule: when the tape, the progress photos and the
// fitness tests are due. From the plan: the tape every second Sunday, photos
// on the Sunday of each mesocycle's light (deload) week, tests on the Saturday of the
// deload week that ends each phase (the generator's calendar). Before there
// is a plan, or by choice: every N days from a start date (Habit Nudges'
// measureFrom / testsFrom schedule, continued). Each occurrence stays due
// until an entry dated on or after it exists, or it is skipped.

import { addDays, daysBetween, dayText, type IsoDate } from './dates.ts';
import { explain, type Reason, type Result } from './reason.ts';
import type { BodyRecordSchedule, Program } from './schema.ts';

export const BODY_PARTS = ['tape', 'photos', 'tests'] as const;
export type BodyPart = (typeof BODY_PARTS)[number];

/** A periodic part's occurrence: its due date (an IsoDate), or "baseline" for a cycle's first tests. A plain string, since an IsoDate is one. */
export type Occurrence = string;

/** Every N days when nothing says otherwise: the tape and photos every 14, the tests every 28 (Habit Nudges'). */
export const BODY_DEFAULTS = { tapeEvery: 14, testsEvery: 28 } as const;

/**
 * Habit Nudges' periodStart: the start of the period of a repeating schedule
 * (every `every` days from `from`) that holds `day`; null before the first.
 */
export function periodStart(from: IsoDate, every: number, day: IsoDate): IsoDate | null {
  const days = daysBetween(from, day);
  if (!Number.isFinite(days) || days < 0 || !(every > 0)) return null;
  return addDays(from, Math.floor(days / every) * every);
}

export interface PartSchedule {
  part: BodyPart;
  source: 'plan' | 'fixed';
  /** The occurrence holding the date: the latest on or before it; "baseline" for the first tests; null before the first. */
  current: Occurrence | null;
  /** The first occurrence after the date. */
  next: IsoDate | null;
  /** The first occurrence after the current one (what "Skip this photo day" moves to). */
  afterCurrent: IsoDate | null;
  /** How it repeats, in words. */
  text: string;
  reason: Reason;
}

interface PlanWeek {
  n: number;
  start: IsoDate;
  lastOfMeso: boolean;
  lastOfPhase: boolean;
  tests: boolean;
}

function planWeeks(program: Pick<Program, 'macrocycle'>): PlanWeek[] {
  const out: PlanWeek[] = [];
  for (const ph of program.macrocycle.phases) {
    ph.mesocycles.forEach((m, mi) =>
      m.weeks.forEach((w, wi) => {
        out.push({ n: out.length + 1, start: w.start, lastOfMeso: wi === m.weeks.length - 1, lastOfPhase: mi === ph.mesocycles.length - 1 && wi === m.weeks.length - 1, tests: w.tests === true });
      }),
    );
  }
  return out;
}

/** The plan's occurrences of each part, in date order. */
export function planOccurrences(program: Pick<Program, 'macrocycle'>): Record<BodyPart, IsoDate[]> {
  const weeks = planWeeks(program);
  const flagged = weeks.some((w) => w.tests);
  return {
    tape: weeks.filter((w) => w.n % 2 === 0).map((w) => addDays(w.start, 6)),
    photos: weeks.filter((w) => w.lastOfMeso).map((w) => addDays(w.start, 6)),
    tests: weeks.filter((w) => (flagged ? w.tests : w.lastOfPhase)).map((w) => addDays(w.start, 5)),
  };
}

const PLAN_TEXT: Record<BodyPart, string> = {
  tape: 'Every second Sunday',
  photos: 'Each light week’s Sunday',
  tests: 'Each phase end, in its light week',
};

/** What the schedule settings resolve to: the plan, or every N days from a start. */
export interface ResolvedSchedule {
  source: 'plan' | 'fixed';
  tapeFrom: IsoDate;
  tapeEvery: number;
  testsFrom: IsoDate;
  testsEvery: number;
  note?: string;
}

/**
 * Which schedule applies: the setting (Coach/tracking.json `bodyRecord`),
 * the plan when there is no setting and a plan exists, else every N days.
 * A fixed schedule without dates continues from the last entry (or starts
 * on the date).
 */
export function resolveSchedule(setting: BodyRecordSchedule | undefined | null, program: Pick<Program, 'macrocycle'> | null, last: { tape: IsoDate | null; tests: IsoDate | null }, date: IsoDate): ResolvedSchedule {
  const usePlan = program && (setting ? setting.schedule === 'plan' : true);
  const out: ResolvedSchedule = {
    source: usePlan ? 'plan' : 'fixed',
    tapeFrom: setting?.tapeFrom ?? last.tape ?? date,
    tapeEvery: setting?.tapeEvery ?? BODY_DEFAULTS.tapeEvery,
    testsFrom: setting?.testsFrom ?? last.tests ?? date,
    testsEvery: setting?.testsEvery ?? BODY_DEFAULTS.testsEvery,
  };
  if (setting?.schedule === 'plan' && !program) out.note = 'Set to follow the plan, but there is no plan: every N days until there is one.';
  return out;
}

/**
 * Each part's schedule on `date`. `hasTests` is whether any tests are on
 * record: on a fixed schedule with none, the tests are due at once as the
 * cycle's baseline (Habit Nudges' rule), unless the baseline was skipped.
 */
export function bodySchedule(rs: ResolvedSchedule, program: Pick<Program, 'macrocycle'> | null, date: IsoDate, opts: { hasTests: boolean; baselineSkipped: boolean }): Record<BodyPart, PartSchedule> {
  const out = {} as Record<BodyPart, PartSchedule>;
  if (rs.source === 'plan' && program) {
    const occ = planOccurrences(program);
    for (const part of BODY_PARTS) {
      const list = occ[part];
      const current = [...list].reverse().find((d) => d <= date) ?? null;
      const next = list.find((d) => d > date) ?? null;
      const afterCurrent = current ? (list.find((d) => d > current) ?? null) : next;
      out[part] = {
        part,
        source: 'plan',
        current,
        next,
        afterCurrent,
        text: PLAN_TEXT[part],
        reason: explain(current, `plan.calendar.${part}`, { date, occurrences: list.length, current, next }, {
          note: `${PLAN_TEXT[part]}, from your plan.${next ? ` Next: ${dayText(next)}.` : ' None left in this plan.'}`,
        }).reason,
      };
    }
    return out;
  }
  const fixed = (part: BodyPart, from: IsoDate, every: number): PartSchedule => {
    const current = periodStart(from, every, date);
    const next = current ? addDays(current, every) : from > date ? from : null;
    const text = part === 'photos' ? `With the tape, every ${every} days` : `Every ${every} days from ${dayText(from)}`;
    return {
      part,
      source: 'fixed',
      current,
      next,
      afterCurrent: current ? addDays(current, every) : next,
      text,
      reason: explain(current, 'settings.body-record', { part, date, from, every, current }, {
        note: `${text}${rs.note ? `. ${rs.note}` : ', until your plan sets them'}.${next ? ` Next: ${dayText(next)}.` : ''}`,
      }).reason,
    };
  };
  out.tape = fixed('tape', rs.tapeFrom, rs.tapeEvery);
  out.photos = fixed('photos', rs.tapeFrom, rs.tapeEvery);
  out.tests = fixed('tests', rs.testsFrom, rs.testsEvery);
  if (!opts.hasTests && !opts.baselineSkipped) {
    out.tests = {
      ...out.tests,
      current: 'baseline',
      afterCurrent: out.tests.next,
      reason: explain<Occurrence>('baseline', 'settings.body-record', { part: 'tests', date, tests: 0 }, { note: 'No tests on record yet: the first ones are this cycle\'s baseline, due now.' }).reason,
    };
  }
  return out;
}

/** What the body record already holds: entry dates per part, and the dated photo folders. */
export interface BodyRecordView {
  tape: IsoDate[];
  tests: IsoDate[];
  photos: IsoDate[];
  photoFolders: IsoDate[];
}

export function bodyRecordView(body: unknown, photoFolders: readonly string[] = []): BodyRecordView {
  const o = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const dates = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]) : []).map((e) => (typeof e === 'object' && e !== null ? (e as { date?: unknown }).date : null)).filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return { tape: dates('tape'), tests: dates('tests'), photos: dates('photos'), photoFolders: photoFolders.filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort() };
}

/** Whether the occurrence is done: an entry (or, for photos, a dated folder) on or after it. */
export function partDone(view: BodyRecordView, part: BodyPart, occurrence: Occurrence): boolean {
  if (occurrence === 'baseline') return view.tests.length > 0;
  const list = part === 'photos' ? [...view.photos, ...view.photoFolders] : view[part];
  return list.some((d) => d >= occurrence);
}

/** The key a skip of this occurrence is stored under in Coach/nudges.json. */
export const skipKey = (part: BodyPart, occurrence: Occurrence): string => `${part}:${occurrence}`;

/** One part on the date: due (not done, not skipped), and when next. */
export interface PartStatus {
  part: BodyPart;
  due: boolean;
  occurrence: Occurrence | null;
  done: boolean;
  skipped: boolean;
  /** The next date to show: the occurrence while due, else the next one. */
  nextDate: IsoDate | null;
  inDays: number | null;
  last: IsoDate | null;
  schedule: PartSchedule;
}

export function partStatus(sch: PartSchedule, view: BodyRecordView, skipped: Readonly<Record<string, unknown>>, date: IsoDate): Result<PartStatus> {
  const occ = sch.current;
  const done = occ !== null && partDone(view, sch.part, occ);
  const isSkipped = occ !== null && skipped[skipKey(sch.part, occ)] !== undefined;
  const due = occ !== null && !done && !isSkipped;
  const nextDate = due ? (occ === 'baseline' ? date : occ) : sch.next;
  const list = sch.part === 'photos' ? [...view.photos, ...view.photoFolders].sort() : view[sch.part];
  const last = [...list].reverse().find((d) => d <= date) ?? null;
  return explain<PartStatus>(
    { part: sch.part, due, occurrence: occ, done, skipped: isSkipped, nextDate, inDays: nextDate ? daysBetween(date, nextDate) : null, last, schedule: sch },
    sch.reason.rule,
    { ...sch.reason.inputs, done, skipped: isSkipped, last },
    { note: `${due ? (occ === 'baseline' ? 'Due now (the baseline).' : `Due since ${dayText(occ)}.`) : done ? 'Done for this round.' : isSkipped ? 'Skipped this round.' : 'Not due yet.'} ${sch.reason.note ?? ''}`.trim() },
  );
}
