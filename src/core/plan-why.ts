// The plan's Why (plan-data.json's top-level `why`): the coach's reasons for
// the plan, written to the person in the coach's own voice when the plan is
// written. A lead, the reasons with their evidence grades, and the split:
// the family picked, the others built and compared, and every other family
// left out, each with one line on why. The Plan tab draws it as the Why this
// plan card; `engine check` holds its shape (`why-shape`), says when a plan
// has none (`no-why-card`) and names any family it doesn't account for
// (`why-split-missing`). `engine draft` never carries it, so a new plan gets
// its own. Pure.

import { isIsoDate, type IsoDate } from './dates.ts';
import { SPLIT_KINDS, SPLIT_LABELS, type SplitKind } from './schema.ts';

/** The evidence grades the coach's rules carry (rules.md): Strong, Moderate, Weak, and (H) for a heuristic. */
export const WHY_GRADES = ['strong', 'moderate', 'weak', 'heuristic'] as const;
export type WhyGrade = (typeof WHY_GRADES)[number];

export interface PlanWhyReason {
  /** The reason in a few words ("Upper back, lats and shoulders come first"). */
  title: string;
  /** The reason itself, to the person ("We decided them together on 9 Nov from your photos..."). */
  text: string;
  /** The grade of the evidence behind it; left out where the reason is the person's own (a rule, a wish). */
  grade?: WhyGrade;
}

export interface PlanWhyFamily {
  family: SplitKind;
  /** Why this family was picked, lost or left out, for this person. */
  why: string;
}

export interface PlanWhySplit {
  picked: PlanWhyFamily;
  /** The other families built as candidates and measured, each with why it lost. */
  compared: PlanWhyFamily[];
  /** Every other family, not built, each with one line from rules.md's Fits column on why it doesn't fit. */
  leftOut: PlanWhyFamily[];
}

export interface PlanWhy {
  /** When the coach wrote it (the plan's yes). */
  date: IsoDate;
  /** The plan in one breath, 1 to 3 sentences, the coach to the person. */
  lead: string;
  reasons: PlanWhyReason[];
  split: PlanWhySplit;
  /** Where the decision is recorded (a Decisions.md entry, "2026-11-09 · Redesign"). */
  decision?: string;
}

export const WHY_KEYS = ['date', 'lead', 'reasons', 'split', 'decision'] as const;
const REASON_KEYS = ['title', 'text', 'grade'] as const;
const SPLIT_KEYS = ['picked', 'compared', 'leftOut'] as const;
const FAMILY_KEYS = ['family', 'why'] as const;

export interface ReadPlanWhy {
  /**
   * The Why as written, or null: none, or one too broken to show (no lead, no
   * family picked). A reason with no title or text, a family line with no why
   * and a family named again are left out of it; what else is wrong (a bad
   * grade, an unknown key) is reported and the rest shown as written.
   */
  why: PlanWhy | null;
  /** Whether the plan has a `why` at all. */
  present: boolean;
  /** What is wrong with it as written: each a hard error in `engine check` (`why-shape`). */
  problems: string[];
  /** The split families it names nowhere (picked, compared or left out), in SPLIT_KINDS order. */
  missing: SplitKind[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const isFamily = (v: unknown): v is SplitKind => typeof v === 'string' && (SPLIT_KINDS as readonly string[]).includes(v);

function unknownKeys(o: Record<string, unknown>, keys: readonly string[], at: string, problems: string[]): void {
  const extra = Object.keys(o).filter((k) => !k.startsWith('_') && !keys.includes(k));
  if (extra.length) problems.push(`${at} has unknown key(s): ${extra.join(', ')}`);
}

/** One family line ({family, why}), or null with its problem said; `named` gathers every valid family id, with a why or not. */
function family(v: unknown, at: string, problems: string[], named: Set<SplitKind>): PlanWhyFamily | null {
  if (!isObj(v)) {
    problems.push(`${at} is not {family, why}`);
    return null;
  }
  unknownKeys(v, FAMILY_KEYS, at, problems);
  if (!isFamily(v['family'])) {
    problems.push(`${at}.family is not a split family (${SPLIT_KINDS.join(', ')})`);
    return null;
  }
  if (named.has(v['family'])) {
    problems.push(`why.split names ${v['family']} more than once`);
    return null;
  }
  named.add(v['family']);
  if (!isText(v['why'])) {
    problems.push(`${at} (${v['family']}) has no why`);
    return null;
  }
  return { family: v['family'], why: v['why'].trim() };
}

function families(v: unknown, at: string, problems: string[], named: Set<SplitKind>): PlanWhyFamily[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    problems.push(`${at} is not a list of {family, why}`);
    return [];
  }
  return v.map((x, i) => family(x, `${at}[${i}]`, problems, named)).filter((x): x is PlanWhyFamily => x !== null);
}

function split(v: unknown, problems: string[], named: Set<SplitKind>): PlanWhySplit | null {
  if (v === undefined) {
    problems.push('why.split is missing: the family picked, the ones compared and the ones left out');
    return null;
  }
  if (!isObj(v)) {
    problems.push('why.split is not {picked, compared, leftOut}');
    return null;
  }
  unknownKeys(v, SPLIT_KEYS, 'why.split', problems);
  // A family named again is a problem, and the first line naming it stands.
  const picked = family(v['picked'], 'why.split.picked', problems, named);
  const compared = families(v['compared'], 'why.split.compared', problems, named);
  const leftOut = families(v['leftOut'], 'why.split.leftOut', problems, named);
  return picked ? { picked, compared, leftOut } : null;
}

/** The plan's `why` as written: what can be shown, the problems, and the families it leaves unaccounted for. Absent: none, and no problems. */
export function readPlanWhy(raw: unknown): ReadPlanWhy {
  const v = isObj(raw) ? raw['why'] : undefined;
  if (v === undefined) return { why: null, present: false, problems: [], missing: [] };
  const problems: string[] = [];
  if (!isObj(v)) return { why: null, present: true, problems: ['why is not {date, lead, reasons, split, decision?}'], missing: [] };
  unknownKeys(v, WHY_KEYS, 'why', problems);
  const date = v['date'];
  if (typeof date !== 'string' || !isIsoDate(date)) problems.push('why.date is not a YYYY-MM-DD date (the day the coach wrote it)');
  if (!isText(v['lead'])) problems.push('why.lead is missing: the plan in one breath, 1 to 3 sentences to the person');
  const reasons: PlanWhyReason[] = [];
  if (!Array.isArray(v['reasons']) || v['reasons'].length === 0) problems.push('why.reasons is not a list of {title, text, grade?} with at least one reason');
  else
    v['reasons'].forEach((r, i) => {
      const at = `why.reasons[${i}]`;
      if (!isObj(r)) {
        problems.push(`${at} is not {title, text, grade?}`);
        return;
      }
      unknownKeys(r, REASON_KEYS, at, problems);
      if (!isText(r['title']) || !isText(r['text'])) {
        problems.push(`${at} needs a title and a text`);
        return;
      }
      const grade = r['grade'];
      if (grade !== undefined && !(WHY_GRADES as readonly unknown[]).includes(grade)) problems.push(`${at}.grade is not one of ${WHY_GRADES.join(', ')}`);
      reasons.push({ title: r['title'].trim(), text: r['text'].trim(), ...((WHY_GRADES as readonly unknown[]).includes(grade) ? { grade: grade as WhyGrade } : {}) });
    });
  if (v['decision'] !== undefined && !isText(v['decision'])) problems.push('why.decision is not text (the Decisions entry that holds the plan)');
  // Every family the card names, with a why or not: a line with no why is its own problem, not a missing family.
  const named = new Set<SplitKind>();
  const sp = split(v['split'], problems, named);
  const missing = sp ? SPLIT_KINDS.filter((k) => !named.has(k)) : [...SPLIT_KINDS];
  if (!isText(v['lead']) || !sp) return { why: null, present: true, problems, missing };
  return {
    why: {
      date: typeof date === 'string' && isIsoDate(date) ? date : ('' as IsoDate),
      lead: v['lead'].trim(),
      reasons,
      split: sp,
      ...(isText(v['decision']) ? { decision: v['decision'].trim() } : {}),
    },
    present: true,
    problems,
    missing,
  };
}

/** A family line for the screens: its label beside it. */
const labelled = (f: PlanWhyFamily) => ({ family: f.family, label: SPLIT_LABELS[f.family], why: f.why });

/** The Why as the Plan screen draws it (each family with its label), or null when the plan has none to show. */
export function planWhyView(r: ReadPlanWhy) {
  const w = r.why;
  if (!w) return null;
  return {
    date: w.date || null,
    lead: w.lead,
    reasons: w.reasons.map((x) => ({ title: x.title, text: x.text, grade: x.grade ?? null })),
    split: { picked: labelled(w.split.picked), compared: w.split.compared.map(labelled), leftOut: w.split.leftOut.map(labelled) },
    decision: w.decision ?? null,
  };
}
export type PlanWhyView = NonNullable<ReturnType<typeof planWhyView>>;
