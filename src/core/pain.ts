// The pain rule (the skill's adhoc.md, "Pain"), on what the log and the
// Sunday check-in say: up to 3 of 10 during an exercise that settles by the
// next day is fine, carry on and note it; more than that, or still there the
// next day, change the load, the range or the exercise and keep training
// everything else; persisting about 2 weeks, or getting worse, see a
// professional while the plan works around it. A Ledger entry either way.
// Each report is tagged with where it came from (a session's pain in the
// log, or the check-in's joint aches) and its day. A report whose severity
// wasn't given (a pain skip whose slider wasn't moved) is never read as 3 or
// as 0: the rule reads whether it lingered or persisted, and otherwise says
// to ask how bad it was. `painTrend` groups the reports by exercise (by area
// without one) over a span, with their direction. Red flags are the
// intake's, not this rule's. Pure: the date is an input.

import { addDays, dayText, daysBetween, type IsoDate } from './dates.ts';
import { exerciseId } from './plan-data.ts';
import { explain, joinNotes, type Result } from './reason.ts';

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
  /** 0-10; null when it wasn't given. */
  severity: number | null;
  exercise: string | null;
  /** Where it came from: a session's pain in the log, or the Sunday check-in's joint aches. */
  source: 'log' | 'checkin';
  /** The session it was logged with ("Heavy: squat and press"); null for the check-in. */
  session: string | null;
  /** The check-in says it lingered past the next day. */
  lingered?: boolean;
}

/** fine, swap and professional are the rule's; ask: no severity given and nothing else to go on, so ask how bad it was. */
export type PainVerdict = 'fine' | 'ask' | 'swap' | 'professional';
/** The verdicts from the mildest: the worst of several is the latest in this order. */
export const PAIN_ORDER: readonly PainVerdict[] = ['fine', 'ask', 'swap', 'professional'];
/** The worst of the verdicts, or null for none. */
export const worstVerdict = (vs: readonly PainVerdict[]): PainVerdict | null => vs.reduce<PainVerdict | null>((w, v) => (w === null || PAIN_ORDER.indexOf(v) > PAIN_ORDER.indexOf(w) ? v : w), null);

export interface PainRead extends PainReport {
  verdict: PainVerdict;
  /** Still there the next day: the same area the next day, or the check-in after it says it lingered. */
  lingered: boolean;
  /** The same area reported for about 2 weeks or more: the first report this far back, days. */
  persisting: boolean;
  /** Worse than the area's last report with a severity, and over 3 of 10 (false when this one has none). */
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

/** A report in words: "knee 4 of 10 during Barbell Back Squat", "knee (severity not given) during Goblet Squat". */
export function painText(p: Pick<PainReport, 'area' | 'severity' | 'exercise'>): string {
  return `${key(p.area)} ${p.severity === null ? '(severity not given)' : `${p.severity} of 10`}${p.exercise ? ` during ${p.exercise}` : ''}`;
}

/** What the pain rule says to do for each verdict (a repeated Pain skip quotes the swap's). */
export const PAIN_ACTIONS: Readonly<Record<PainVerdict, string>> = {
  fine: 'fine: carry on and note it',
  ask: `ask how bad it was: over ${PAIN.fine} of 10 is the rule's change of load, range or exercise`,
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
      // A severity not given is neither over 3 nor under it: it never makes a report worse, and a report without one is never worse.
      const prev = before.filter((x) => x.severity !== null).at(-1);
      const over = r.severity !== null && r.severity > PAIN.fine;
      const worse = Boolean(prev && r.severity !== null && r.severity > prev.severity! && over);
      const verdict: PainVerdict = persisting || worse ? 'professional' : over || lingered ? 'swap' : r.severity === null ? 'ask' : 'fine';
      const where = r.source === 'log' ? `the log, ${dayText(r.date)}${r.session ? `, ${r.session}` : ''}` : `the Sunday check-in of ${dayText(r.date)}`;
      const why = persisting
        ? `reported since ${dayText(since)}, about 2 weeks or more`
        : worse
          ? `worse than the ${prev!.severity} of 10 on ${dayText(prev!.date)}`
          : over
            ? `over ${PAIN.fine} of 10`
            : lingered
              ? 'still there the next day'
              : r.severity === null
                ? 'no severity given, and nothing says it lingered'
                : `up to ${PAIN.fine} of 10 and settled by the next day, as far as the log and the check-in say`;
      return explain<PainRead>({ ...r, verdict, lingered, persisting, worse, since }, 'pain.rule', { date: r.date, area: r.area, severity: r.severity, source: r.source, exercise: r.exercise, lingered, since }, {
        threshold: { fine: PAIN.fine, persistDays: PAIN.persistDays },
        note: `${painText(r).replace(/^./, (c) => c.toUpperCase())} (${where}): ${why}, so ${PAIN_ACTIONS[verdict]}. Describe it; never diagnose it.`,
      });
    });
}

// ---------------------------------------------------------------- the trend by exercise

/** A group's latest given severity against the one given before it; single under two given. */
export type PainDirection = 'rising' | 'falling' | 'steady' | 'single';

/** One exercise's pain over a span (or one area's, for reports with no exercise). */
export interface PainGroup {
  /** The exercise's id, or "area:<area>" for the reports that name no exercise (the check-in's joint aches among them). */
  key: string;
  exercise: { id: string; name: string } | null;
  /** The latest report's area, and every area the group's reports name. */
  area: string;
  areas: string[];
  /** The reports in the span, oldest first, each with its pain-rule verdict. */
  reports: { date: IsoDate; area: string; severity: number | null; source: PainReport['source']; session: string | null; verdict: PainVerdict }[];
  count: number;
  first: IsoDate | null;
  last: IsoDate | null;
  /** The highest severity given; null when none was. */
  max: number | null;
  /** The latest report's date and severity (null: not given). */
  latest: { date: IsoDate; severity: number | null } | null;
  direction: PainDirection;
  /** The worst pain-rule verdict of the group's reports; null with none (pain skips only). */
  verdict: PainVerdict | null;
  /** Reports with no severity given: left out of `max` and `direction`. */
  notGiven: number;
  /** Times the exercise was skipped for pain in the span (the Log panel's Pain reason). */
  painSkips: number;
}

export interface PainTrendOptions {
  /** The exercise a report's name stands for, as an id (the default: the name's own id). */
  exerciseOf?: (name: string) => string;
  /** An exercise's display name (the default: the report's own name). */
  nameOf?: (id: string) => string | null;
  /** The skips for pain, by exercise id: each one counts for its exercise, which gets a group even with no report. */
  painSkips?: readonly { exercise: string; date: IsoDate }[];
}

const sev = (s: number | null) => (s === null ? 'not given' : `${s}`);

/**
 * The pain reports from `from` to `to`, grouped by exercise (a name matched
 * to its exercise by `exerciseOf`), and by area for those that name none:
 * each group's reports with the pain rule's verdict, how many, the first and
 * last day, the highest and the latest severity, the direction (the latest
 * given severity against the one before it) and the worst verdict, with the
 * exercise's skips for pain. A severity not given counts as a report and is
 * left out of the highest and the direction.
 */
export function painTrend(reports: readonly PainReport[], from: IsoDate, to: IsoDate, opts: PainTrendOptions = {}): Result<PainGroup[]> {
  const idOf = opts.exerciseOf ?? exerciseId;
  const reads = painRule(reports, from, to);
  const groups = new Map<string, PainGroup>();
  const blank = (k: string, exercise: PainGroup['exercise'], area: string): PainGroup => ({ key: k, exercise, area, areas: [], reports: [], count: 0, first: null, last: null, max: null, latest: null, direction: 'single', verdict: null, notGiven: 0, painSkips: 0 });
  for (const { value: r } of reads) {
    let k: string;
    let exercise: PainGroup['exercise'] = null;
    if (r.exercise) {
      const id = idOf(r.exercise);
      k = id;
      exercise = { id, name: opts.nameOf?.(id) ?? r.exercise };
    } else {
      // An area named inside another ("left knee", "knee") joins the group already there.
      k = [...groups.keys()].find((g) => g.startsWith('area:') && sameArea(g.slice(5), r.area)) ?? `area:${key(r.area)}`;
    }
    const g = groups.get(k) ?? blank(k, exercise, r.area);
    g.reports.push({ date: r.date, area: r.area, severity: r.severity, source: r.source, session: r.session, verdict: r.verdict });
    groups.set(k, g);
  }
  for (const s of opts.painSkips ?? []) {
    if (s.date < from || s.date > to) continue;
    const g = groups.get(s.exercise) ?? blank(s.exercise, { id: s.exercise, name: opts.nameOf?.(s.exercise) ?? s.exercise }, '');
    g.painSkips++;
    groups.set(s.exercise, g);
  }
  const out = [...groups.values()].map((g) => {
    const rs = g.reports;
    const given = rs.filter((x) => x.severity !== null).map((x) => x.severity!);
    const a = given.at(-1);
    const b = given.at(-2);
    const last = rs.at(-1);
    const direction: PainDirection = a === undefined || b === undefined ? 'single' : a > b ? 'rising' : a < b ? 'falling' : 'steady';
    return {
      ...g,
      area: last?.area ?? g.area,
      areas: [...new Set(rs.map((x) => key(x.area)))],
      count: rs.length,
      first: rs[0]?.date ?? null,
      last: last?.date ?? null,
      max: given.length ? Math.max(...given) : null,
      latest: last ? { date: last.date, severity: last.severity } : null,
      direction,
      verdict: worstVerdict(rs.map((x) => x.verdict)),
      notGiven: rs.length - given.length,
    };
  });
  const rank = (v: PainVerdict | null) => (v === null ? -1 : PAIN_ORDER.indexOf(v));
  out.sort((x, y) => rank(y.verdict) - rank(x.verdict) || (y.last ?? '').localeCompare(x.last ?? '') || y.painSkips - x.painSkips || x.key.localeCompare(y.key));
  const label = (g: PainGroup) => (g.exercise ? g.exercise.name : key(g.area));
  const line = (g: PainGroup) =>
    [
      `${label(g)}: ${g.count ? `${g.count} report${g.count === 1 ? '' : 's'} (${g.reports.map((x) => sev(x.severity)).join(' then ')} of 10)` : 'no report'}`,
      g.direction !== 'single' && g.direction,
      g.painSkips > 0 && `skipped for pain ${g.painSkips === 1 ? 'once' : g.painSkips === 2 ? 'twice' : `${g.painSkips} times`}`,
      g.verdict && `the rule: ${g.verdict}`,
    ].filter(Boolean).join(', ');
  return explain(out, 'pain.trend', { from, to, reports: reads.length, painSkips: (opts.painSkips ?? []).filter((s) => s.date >= from && s.date <= to).length }, {
    note: out.length
      ? joinNotes(`Pain since ${dayText(from)} by exercise (by area where none is named): ${out.map(line).join('; ')}.`, out.some((g) => g.notGiven > 0) && 'A severity not given is left out of the highest and the direction: ask how bad it was.')
      : `No pain reported and nothing skipped for pain since ${dayText(from)}.`,
  });
}
