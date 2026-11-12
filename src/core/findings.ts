// A body-assessment finding (what the photos showed, a self-check result) is
// a question for the user before it rules a movement out or reshapes the
// plan, never a diagnosis: no study validates spotting such problems from
// photos, and a self-check is one try on one day. The profile records the
// answer, per self-check test in `selfCheck.confirmed` and per
// body-assessment row in `emphasis[].confirmed`:
//
// - true (confirmed): the finding holds, and the plan acts on it in full;
// - false (declined): it does not hold; a self-check result keeps only its
//   warm-up lines, and a body-assessment row is left out;
// - left out (unconfirmed): not asked yet. In a profile that records an
//   answer anywhere, the finding is a preference and warm-ups only and
//   rules no movement out. A profile with no answer anywhere was written
//   before the question: it keeps the old behaviour, and `review` carries a
//   `finding-unconfirmed` warning with the question.

import { MUSCLES } from './data/muscles.ts';
import { explain, type Result } from './reason.ts';
import type { Emphasis, EmphasisKind, Profile, SelfCheck } from './schema.ts';

export type Confirmation = 'confirmed' | 'declined' | 'unconfirmed';

/** The self-check tests whose result can be a finding; the counts (push-ups, pull-ups, the hang, the core hold) set ladder levels, which the calibration week checks. */
export const SELF_CHECK_FINDINGS = ['sitToStand', 'hingeFlatBack', 'overheadReach', 'balanceS'] as const;
export type SelfCheckFinding = (typeof SELF_CHECK_FINDINGS)[number];

/** Whether the profile records an answer to any finding: a missing answer then means "not asked yet", not a profile from before the question. */
export function asksConfirmation(profile: Pick<Profile, 'emphasis' | 'selfCheck'>): boolean {
  return profile.selfCheck?.confirmed !== undefined || profile.emphasis.some((e) => e.confirmed !== undefined);
}

const answer = (v: boolean | undefined): Confirmation => (v === true ? 'confirmed' : v === false ? 'declined' : 'unconfirmed');

export function selfCheckConfirmation(s: SelfCheck | undefined, test: SelfCheckFinding): Confirmation {
  return answer(s?.confirmed?.[test]);
}

export function emphasisConfirmation(e: Pick<Emphasis, 'confirmed'>): Confirmation {
  return answer(e.confirmed);
}

/**
 * Whether a finding acts in full (rules movements out, sets the 2-to-1 pull
 * to push and rear-delt work, makes a priority muscle): confirmed, or never
 * asked in a profile from before the question.
 */
export function mayRuleOut(c: Confirmation, asks: boolean): boolean {
  return c === 'confirmed' || (c === 'unconfirmed' && !asks);
}

/** The body-assessment rows that act in full (`mayRuleOut`); an unanswered row in a profile that asks only ranks its regression first and adds its warm-up. */
export function appliedEmphasis(profile: Pick<Profile, 'emphasis' | 'selfCheck'>): Emphasis[] {
  const asks = asksConfirmation(profile);
  return profile.emphasis.filter((e) => mayRuleOut(emphasisConfirmation(e), asks));
}

/** The body-assessment rows the plan acts on: every row but the declined ones. */
export function activeEmphasis(rows: readonly Emphasis[]): Emphasis[] {
  return rows.filter((e) => e.confirmed !== false);
}

// Every question is asked so that yes means the finding holds (confirmed: true) and no means it does not.
const QUESTIONS: Partial<Record<EmphasisKind, (e: Emphasis) => string>> = {
  'forward-head-rounded-shoulders': () => 'Do your shoulders round forward or your head drift forward when you sit or stand relaxed?',
  'overhead-limited': () => 'Does pressing overhead hurt, or make your lower back arch?',
  'squat-heels-lift': () => 'Do your heels come up when you squat deep?',
  'knees-in': () => 'Do your knees travel in when you squat or step down?',
  'low-back-arch': () => 'Does your lower back arch deeply when you stand or brace, or ache after standing?',
  asymmetry: (e) => `Does your ${e.side ?? 'one'} side feel weaker or less steady than the other in one-sided work?`,
  'lagging-area': (e) => {
    const names = (e.muscles ?? []).map((m) => MUSCLES.find((x) => x.id === m)?.label.toLowerCase() ?? m);
    return `Do you want ${names.length ? names.join(' and ') : e.area.toLowerCase()} brought up as a priority (10 to 16 sets a week)?`;
  },
};

/** The body-assessment kinds whose row is a finding to confirm (each has its question); the others the engine does not act on. */
export const EMPHASIS_FINDINGS = Object.keys(QUESTIONS) as EmphasisKind[];

/** The question to ask before the plan acts on a body-assessment row; null for a row the engine does not act on (no kind, or fat carried at the waist). */
export function emphasisQuestion(e: Emphasis): string | null {
  const q = e.kind ? QUESTIONS[e.kind] : undefined;
  return q ? `The body assessment noted "${e.seen}". ${q(e)}` : null;
}

/** One finding the user has not answered yet, and the question that settles it. */
export interface FindingToConfirm {
  /** The finding, as the personalization audit names it: `selfCheck.<test>` or `emphasis.<kind>`. */
  input: string;
  /** Where the answer goes in profile.json. */
  answer: string;
  question: string;
}

/** The `finding-unconfirmed` warning: the question, and what the plan does with the finding until the profile records the answer. */
export function findingUnconfirmed(f: FindingToConfirm, asks: boolean): Result<FindingToConfirm> {
  return explain(f, 'plan.finding-unconfirmed', { input: f.input, answer: f.answer, profileAsks: asks }, {
    title: 'Finding to confirm',
    note: `A finding to confirm with you. Ask: ${f.question} Yes: ${f.answer} true; no: ${f.answer} false. Until profile.json records the answer, ${asks ? 'it only ranks its regression first and adds its warm-up: it rules no movement out and sets no priority or pull-to-push aim.' : 'Pahlavan applies it as before.'}`,
  });
}
