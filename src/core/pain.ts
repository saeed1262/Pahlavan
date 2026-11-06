// The pain rule (the skill's adhoc.md, "Pain"), on what the log and the
// Sunday check-in say: up to 3 of 10 during an exercise that settles by the
// next day is fine, carry on and note it; more than that, or still there the
// next day, change the load, the range or the exercise and keep training
// everything else; persisting about 2 weeks, or getting worse, see a
// professional while the plan works around it. A Ledger entry either way.
// Each report is tagged with where it came from (a session's pain in the
// log, or the check-in's joint aches) and its day. Red flags are the
// intake's, not this rule's. Pure: the date is an input.

import { addDays, dayText, daysBetween, type IsoDate } from './dates.ts';
import { explain, type Result } from './reason.ts';

export const PAIN = {
  /** Up to this, during an exercise and gone by the next day: fine. */
  fine: 3,
  /** The same area reported over this many days or more: persisting ("about 2 weeks"). */
  persistDays: 14,
  /** How far back the earlier reports of an area are read, for lingering, persisting and worse. */
  lookbackDays: 28,
} as const;

export interface PainReport {
  date: IsoDate;
  area: string;
  severity: number;
  exercise: string | null;
  /** Where it came from: a session's pain in the log, or the Sunday check-in's joint aches. */
  source: 'log' | 'checkin';
  /** The session it was logged with ("Heavy: squat and press"); null for the check-in. */
  session: string | null;
  /** The check-in says it lingered past the next day. */
  lingered?: boolean;
}

export type PainVerdict = 'fine' | 'swap' | 'professional';

export interface PainRead extends PainReport {
  verdict: PainVerdict;
  /** Still there the next day: the same area the next day, or the check-in after it says it lingered. */
  lingered: boolean;
  /** The same area reported for about 2 weeks or more: the first report this far back, days. */
  persisting: boolean;
  /** Worse than the area's report before it, and over 3 of 10. */
  worse: boolean;
  /** The area's first report in the look-back. */
  since: IsoDate;
}

const key = (area: string) => area.trim().toLowerCase();
/** One area or the other named inside it ("left knee" and "knee"). */
const sameArea = (a: string, b: string) => {
  const x = key(a);
  const y = key(b);
  return x === y || x.includes(y) || y.includes(x);
};

/** A report in words: "knee 4 of 10 during Barbell Back Squat". */
export function painText(p: Pick<PainReport, 'area' | 'severity' | 'exercise'>): string {
  return `${key(p.area)} ${p.severity} of 10${p.exercise ? ` during ${p.exercise}` : ''}`;
}

/** What the pain rule says to do for each verdict (a repeated Pain skip quotes the swap's). */
export const PAIN_ACTIONS: Readonly<Record<PainVerdict, string>> = {
  fine: 'fine: carry on and note it',
  swap: 'change the load, the range or the exercise (a pain-free variant) and keep training everything else; a Ledger entry',
  professional: 'see a professional; the plan works around it meanwhile, with a Ledger entry',
};

/**
 * The pain rule on each report from `from` to `date`, with the area's
 * earlier reports (up to 4 weeks back) and the check-ins after it for
 * lingering, persisting and worse. A log report on its own counts as
 * settled by the next day unless the next day's log or the check-in says
 * otherwise: the log has no next-day answer of its own.
 */
export function painRule(reports: readonly PainReport[], from: IsoDate, date: IsoDate): Result<PainRead>[] {
  const all = [...reports].filter((r) => r.date <= date && r.date >= addDays(from, -PAIN.lookbackDays)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return all
    .filter((r) => r.date >= from)
    .map((r) => {
      const area = all.filter((x) => sameArea(x.area, r.area));
      const before = area.filter((x) => x.date < r.date);
      const since = area[0]!.date;
      // Still there the next day: the next day's session logged it too, or the check-in after it says it lingered (a check-in's own answer for its own report).
      const nextDay = r.source === 'log' && area.some((x) => x.source === 'log' && x.date === addDays(r.date, 1));
      const checkinSays = r.source === 'checkin' ? r.lingered === true : area.some((x) => x.source === 'checkin' && x.lingered === true && x.date >= r.date && daysBetween(r.date, x.date) <= 7);
      const lingered = nextDay || checkinSays;
      const persisting = daysBetween(since, r.date) >= PAIN.persistDays;
      const prev = before.at(-1);
      const worse = Boolean(prev && r.severity > prev.severity && r.severity > PAIN.fine);
      const verdict: PainVerdict = persisting || worse ? 'professional' : r.severity > PAIN.fine || lingered ? 'swap' : 'fine';
      const where = r.source === 'log' ? `the log, ${dayText(r.date)}${r.session ? `, ${r.session}` : ''}` : `the Sunday check-in of ${dayText(r.date)}`;
      const why = persisting
        ? `reported since ${dayText(since)}, about 2 weeks or more`
        : worse
          ? `worse than the ${prev!.severity} of 10 on ${dayText(prev!.date)}`
          : r.severity > PAIN.fine
            ? `over ${PAIN.fine} of 10`
            : lingered
              ? 'still there the next day'
              : `up to ${PAIN.fine} of 10 and settled by the next day, as far as the log and the check-in say`;
      return explain<PainRead>({ ...r, verdict, lingered, persisting, worse, since }, 'pain.rule', { date: r.date, area: r.area, severity: r.severity, source: r.source, exercise: r.exercise, lingered, since }, {
        threshold: { fine: PAIN.fine, persistDays: PAIN.persistDays },
        note: `${painText(r).replace(/^./, (c) => c.toUpperCase())} (${where}): ${why}, so ${PAIN_ACTIONS[verdict]}. Describe it; never diagnose it.`,
      });
    });
}
