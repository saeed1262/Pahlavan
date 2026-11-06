// Templates compared, not defaulted. Every candidate (planning.md's table
// first, then its nearest options, then the other split families) is built
// in full; each is scored against the profile on rules.md's Scoring list: the
// goals in their order, the posture emphasis, a novice's practice of each main
// lift, the skip risk from the bad-week answer, the session minutes, the
// split preferences, and the plan's own checks. Heavier and lighter days earn
// a point only for a trained lifter with a strength goal (Moesgaard 2022);
// for a muscle goal or a novice they are a preference, scored only from
// `preferences.splits`. No split is scored as better for muscle. Each factor
// returns its points with a note naming the input; each row also carries its
// families' fit and costs (families.ts) as flags, not points. Ties go to the
// table's template. The points are heuristics (H): they order the options and
// the reasons are what the proposal shows.

import { explain, joinNotes, type Result } from '../reason.ts';
import type { SplitKind } from '../schema.ts';
import type { PlanContext } from './context.ts';
import { FAMILY_BY_ID, familyFit, type FamilyFit, type FamilyId } from './families.ts';
import type { TemplateChoice } from './template.ts';

export interface CandidateFacts {
  /** Times a week each main lift comes round, on average over the main lifts. */
  mainFrequency: number;
  /** The longest session's estimate, minutes. */
  longest: number;
  /** Liked exercise ids the plan placed. */
  likedPlaced: string[];
  /** Lifting days with a heavy lower-body main lift. */
  heavyLegDays: number;
  checks: { id: string; passed: boolean; detail: string }[];
}

export type FactorId = 'goal' | 'posture' | 'training-age' | 'skip-risk' | 'minutes' | 'preferences' | 'checks';

export interface Factor {
  factor: FactorId;
  points: number;
  note: string;
}

export interface TemplateScore {
  id: string;
  label: string;
  family: TemplateChoice['family'];
  /** Every family the template belongs to: its split, heavy/light days, the minimalist week. */
  families: FamilyId[];
  /** Each family's Fits column against this profile and week (rules.md): a flag, not points. */
  fit: FamilyFit[];
  /** The families' costs (rules.md, "Split families"). */
  costs: string[];
  picked: boolean;
  score: number;
  factors: Factor[];
  failedChecks: string[];
  liftingDays: number;
  minutes: number;
  longestSession: number;
  mainLiftsPerWeek: number;
}

export interface Comparison {
  rows: TemplateScore[];
  /** Index of the picked candidate. */
  picked: number;
  /** The pick with each factor left out in turn: a factor that changes the pick is one the decision rests on. */
  pickWithout: Partial<Record<FactorId, string>>;
}

export const POINTS = { goal: 1, strengthUndulation: 2, posture: 1, trainingAge: 1, skipRisk: 2, shortSessions: 1, splitLiked: 2, splitDisliked: -3, liked: 1, failedCheck: -3 } as const;

/** The families a template belongs to: its split, then heavy/light days and the minimalist (minimum-dose) week. */
export function familiesOf(t: TemplateChoice): FamilyId[] {
  return [t.family, ...(t.heavyLight ? (['heavy-light'] as const) : []), ...(t.minimumDose ? (['circuit'] as const) : [])];
}

/** The split kinds a template counts as, for the profile's split preferences. */
export function splitKinds(t: TemplateChoice): SplitKind[] {
  const out: SplitKind[] = [];
  if (t.family === 'full-body') out.push('full-body');
  // The upper/lower/full hybrids and the 5-day push/pull/legs hybrid have upper and lower days too.
  if (t.family === 'upper-lower' || t.family === 'upper-lower-full' || t.id === 'upper-lower-push-pull-legs') out.push('upper-lower');
  if (t.family === 'upper-lower-full') out.push('upper-lower-full');
  if (t.family === 'push-pull-legs') out.push('push-pull-legs');
  if (t.family === 'torso-limbs') out.push('torso-limbs');
  if (t.family === 'body-part') out.push('body-part');
  if (t.heavyLight) out.push('heavy-and-light-days');
  if (t.minimumDose) out.push('circuit');
  return out;
}

/** What a missed day costs in this family, for the skip-risk note. */
const MISSED: Record<TemplateChoice['family'], string> = {
  'full-body': 'with full body a missed day costs each muscle only part of its week',
  'upper-lower': 'a missed day here costs one region half of its week',
  'torso-limbs': 'a missed day here costs one region half of its week',
  'upper-lower-full': 'a missed upper or lower day costs that region one of its 2-3 days',
  'push-pull-legs': 'a missed day costs one muscle group part or all of its week',
  'body-part': 'a missed day loses a muscle group\'s whole week',
};

const r1 = (x: number) => Math.round(x * 10) / 10;

function factorsFor(ctx: PlanContext, all: readonly { tpl: TemplateChoice; facts: CandidateFacts }[], i: number): Factor[] {
  const { tpl, facts } = all[i]!;
  const out: Factor[] = [];
  const g = ctx.primary;
  const goalText = g ? `goal 1, "${g.label}" (${g.kind})` : 'no goal in the profile (health by default)';

  // The goal, in order: the first goal sets the modifier.
  const age = ctx.experience === 'advanced' ? 'an advanced lifter' : ctx.experience === 'intermediate' ? 'an intermediate' : `a novice${ctx.experienceAssumed ? ' (assumed)' : ''}`;
  switch (ctx.modifier) {
    case 'strength':
      // rules.md: undulating beat linear only in trained lifters (Moesgaard 2022, Moderate).
      out.push(
        !tpl.heavyLight
          ? { factor: 'goal', points: 0, note: `One rep range per lift: no undulation for ${goalText}.` }
          : ctx.experience !== 'novice'
            ? { factor: 'goal', points: POINTS.strengthUndulation, note: `Heavier and lighter days (undulation) for ${age} with ${goalText}: undulating beat linear in trained lifters (Moesgaard 2022, Moderate).` }
            : { factor: 'goal', points: 0, note: `Heavier and lighter days for ${age}: undulating beat linear only in trained lifters (Moesgaard 2022), so no edge here; a preference, scored from preferences.splits.` },
      );
      break;
    case 'muscle':
      // rules.md: for a muscle goal undulation is a preference, never a score (periodization added nothing for muscle).
      out.push(tpl.heavyLight ? { factor: 'goal', points: 0, note: `Heavier and lighter days: a preference for ${goalText}, never a score (periodization added nothing for muscle, Moesgaard 2022); preferences.splits scores it.` } : { factor: 'goal', points: 0, note: `One rep range per lift; at matched sets any split builds the same muscle for ${goalText}.` });
      break;
    case 'health':
      out.push(tpl.family === 'full-body' && !tpl.heavyLight ? { factor: 'goal', points: POINTS.goal, note: `The simplest full-body week suits ${goalText}.` } : { factor: 'goal', points: 0, note: `More structure than ${goalText} needs.` });
      break;
    case 'skill':
      out.push(tpl.family === 'full-body' ? { factor: 'goal', points: POINTS.goal, note: `Full body puts a skill block in every session for ${goalText}.` } : { factor: 'goal', points: 0, note: `Skill work only on some days for ${goalText}.` });
      break;
    case 'hybrid': {
      const fewest = Math.min(...all.map((x) => x.facts.heavyLegDays));
      const better = facts.heavyLegDays === fewest && all.some((x) => x.facts.heavyLegDays > fewest);
      out.push({ factor: 'goal', points: better ? POINTS.goal : 0, note: `${facts.heavyLegDays} heavy leg day(s) a week${better ? ', the fewest: easier to keep away from key runs' : ''} for ${goalText}.` });
      break;
    }
  }

  // The posture emphasis: pulling in every session.
  if (ctx.posture) {
    out.push(tpl.family === 'full-body' ? { factor: 'posture', points: POINTS.posture, note: 'Every session carries pulling and rear-delt work for the posture emphasis.' } : { factor: 'posture', points: 0, note: 'Pulling only on the upper or pull days for the posture emphasis.' });
  }

  // Training age, by how fast the user progresses: a novice's practice of each main lift (rules.md, Weak).
  if (ctx.experience === 'novice') {
    const top = Math.max(...all.map((x) => x.facts.mainFrequency));
    const low = Math.min(...all.map((x) => x.facts.mainFrequency));
    const best = facts.mainFrequency >= top - 1e-9 && top > low + 1e-9;
    out.push({ factor: 'training-age', points: best ? POINTS.trainingAge : 0, note: `Novice${ctx.experienceAssumed ? ' (assumed)' : ''}: progress comes session to session; each main lift about ${r1(facts.mainFrequency)} time(s) a week${best ? ', the most practice of the options' : ''}.` });
  } else {
    // A trained lifter's heavier and lighter days are scored under the goal (strength only), not here.
    out.push({ factor: 'training-age', points: 0, note: `${ctx.experience === 'advanced' ? 'Advanced' : 'Intermediate'}: progress comes week to week; no split scores better for that (heavier and lighter days count only with a strength goal).` });
  }

  // Skip risk, from the bad-week answer.
  const skips = ctx.badWeek.has('skips-sessions') || ctx.badWeek.has('stops-for-a-while');
  if (skips) {
    out.push({ factor: 'skip-risk', points: tpl.family === 'full-body' ? POINTS.skipRisk : 0, note: `A bad week means skipped sessions: ${MISSED[tpl.family]}.` });
  } else {
    out.push({ factor: 'skip-risk', points: 0, note: ctx.badWeek.size ? 'The bad-week answer is not about skipping sessions: no skip penalty either way.' : 'No bad-week answer in the profile: skip risk not scored.' });
  }

  // Session minutes.
  const shortest = Math.min(...all.map((x) => x.facts.longest));
  const shorter = ctx.badWeek.has('shortens-sessions') && facts.longest <= shortest + 1e-9 && all.some((x) => x.facts.longest > shortest + 1e-9);
  out.push({ factor: 'minutes', points: shorter ? POINTS.shortSessions : 0, note: `The longest session is about ${facts.longest} of the ${tpl.minutes} min available${shorter ? '; the shortest option, for weeks when sessions get cut short' : ''}.` });

  // Preferences: splits liked or disliked before, liked exercises placed.
  const kinds = splitKinds(tpl);
  const liked = kinds.filter((k) => ctx.splitLikes.has(k));
  const disliked = kinds.filter((k) => ctx.splitDislikes.has(k));
  const mostLiked = Math.max(...all.map((x) => x.facts.likedPlaced.length));
  const placesMore = ctx.likes.size > 0 && facts.likedPlaced.length === mostLiked && all.some((x) => x.facts.likedPlaced.length < mostLiked);
  const prefPoints = liked.length * POINTS.splitLiked + disliked.length * POINTS.splitDisliked + (placesMore ? POINTS.liked : 0);
  const prefNotes = [
    liked.length > 0 && `The user liked ${liked.join(' and ')} before.`,
    disliked.length > 0 && `The user disliked ${disliked.join(' and ')} before.`,
    placesMore && `Places the most liked exercises (${facts.likedPlaced.join(', ')}).`,
  ].filter((x): x is string => typeof x === 'string');
  out.push({ factor: 'preferences', points: prefPoints, note: prefNotes.length ? prefNotes.join(' ') : ctx.splitLikes.size || ctx.splitDislikes.size || ctx.likes.size ? 'No stated preference touches this option.' : 'No split or exercise preferences in the profile.' });

  // The plan's own checks.
  const failed = facts.checks.filter((c) => !c.passed);
  out.push({ factor: 'checks', points: failed.length * POINTS.failedCheck, note: failed.length ? `Fails ${failed.map((c) => `${c.id} (${c.detail.split('; ')[0]})`).join(', ')}.` : 'Passes every check.' });
  return out;
}

function pickOf(rows: readonly { score: number }[]): number {
  let best = 0;
  rows.forEach((r, i) => {
    if (r.score > rows[best]!.score + 1e-9) best = i;
  });
  return best;
}

export function compareTemplates(ctx: PlanContext, all: readonly { tpl: TemplateChoice; facts: CandidateFacts }[]): Result<Comparison> {
  const scored = all.map((c, i) => {
    const factors = factorsFor(ctx, all, i);
    return { c, factors, score: factors.reduce((a, f) => a + f.points, 0) };
  });
  const picked = pickOf(scored);
  const rows: TemplateScore[] = scored.map(({ c, factors, score }, i) => ({
    id: c.tpl.id,
    label: c.tpl.label,
    family: c.tpl.family,
    families: familiesOf(c.tpl),
    fit: familiesOf(c.tpl).map((f) => familyFit(f, ctx, { days: c.tpl.liftingDays, minutes: c.tpl.minutes })),
    costs: [...new Set(familiesOf(c.tpl).flatMap((f) => FAMILY_BY_ID.get(f)!.costs))],
    picked: i === picked,
    score,
    factors,
    failedChecks: c.facts.checks.filter((x) => !x.passed).map((x) => x.id),
    liftingDays: c.tpl.liftingDays,
    minutes: c.tpl.minutes,
    longestSession: c.facts.longest,
    mainLiftsPerWeek: r1(c.facts.mainFrequency),
  }));
  const pickWithout: Partial<Record<FactorId, string>> = {};
  const ids: FactorId[] = ['goal', 'posture', 'training-age', 'skip-risk', 'minutes', 'preferences', 'checks'];
  for (const f of ids) {
    const alt = pickOf(scored.map((x) => ({ score: x.score - (x.factors.find((y) => y.factor === f)?.points ?? 0) })));
    pickWithout[f] = rows[alt]!.id;
  }
  const win = rows[picked]!;
  const others = rows.filter((_, i) => i !== picked);
  const pts = (r: TemplateScore, f: FactorId) => r.factors.find((x) => x.factor === f)?.points ?? 0;
  const forIt = win.factors.filter((f) => others.some((o) => pts(o, f.factor) < f.points));
  const against = win.factors.filter((f) => others.some((o) => pts(o, f.factor) > f.points));
  return explain<Comparison>(
    { rows, picked, pickWithout },
    'plan.compare',
    { candidates: rows.map((r) => ({ id: r.id, score: r.score })), modifier: ctx.modifier, experience: ctx.experience, posture: ctx.posture, badWeek: [...ctx.badWeek], splits: { likes: [...ctx.splitLikes], dislikes: [...ctx.splitDislikes] } },
    {
      threshold: POINTS,
      note: joinNotes(
        rows.length === 1 ? `One option for this week: ${win.label}.` : `Compared ${rows.length} templates: ${win.label} (score ${win.score}) over ${others.map((o) => `${o.label} (${o.score})`).join(' and ')}.`,
        forIt.length > 0 && `For it: ${forIt.map((f) => f.note).join(' ')}`,
        against.length > 0 && `Against it: ${against.map((f) => f.note).join(' ')}`,
        rows.length > 1 && forIt.length === 0 && against.length === 0 && 'They score the same: the table\'s template stands.',
      ),
    },
  );
}
