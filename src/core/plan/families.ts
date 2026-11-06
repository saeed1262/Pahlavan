// The split families (rules.md, "Split families"): what each is, the weeks and
// the people it fits, and what it costs. At matched weekly sets they build the
// same muscle, so what separates them is cost: exposures per muscle, sets per
// session, fatigue, skip risk and interference. The fit and the costs are
// flags on each candidate, never points (the points are rules.md's Scoring
// list, compare.ts). `plan` builds the families marked `built`; the coach
// builds the others as scratch plan-data (planning.md, step 1.4).

import type { PlanContext } from './context.ts';

export const FAMILY_IDS = ['full-body', 'upper-lower', 'push-pull-legs', 'body-part', 'torso-limbs', 'upper-lower-full', 'heavy-light', 'specialization', 'concurrent', 'hift', 'circuit', 'calisthenics'] as const;
export type FamilyId = (typeof FAMILY_IDS)[number];

/** A template's split; heavy/light days and the minimalist (minimum-dose) week are families on top of it. */
export type SplitFamily = 'full-body' | 'upper-lower' | 'push-pull-legs' | 'body-part' | 'torso-limbs' | 'upper-lower-full';

/** The week a family is judged for: lifting days and minutes a session. */
export interface FitWeek {
  days: number;
  minutes: number;
}

interface Criterion {
  text: string;
  test: (ctx: PlanContext, week: FitWeek) => boolean;
}

export interface FamilyDef {
  id: FamilyId;
  name: string;
  structure: string;
  /** Lifting days the Fits column names; none: any. */
  days?: readonly number[];
  /** Minutes a session the Fits column names, [lo, hi]. */
  minutes?: readonly [number, number];
  /** Who it fits: every group met, each group by any one of its criteria. */
  who: (week: FitWeek) => readonly (readonly Criterion[])[];
  costs: readonly string[];
  evidence: string;
  /** built: `plan` builds and scores it; partly: the engine builds a part of it; coach: the coach builds it. */
  engine: 'built' | 'partly' | 'coach';
  /** What the engine does about a family it builds only partly, or not at all. */
  engineNote?: string;
}

const skips = (ctx: PlanContext) => ctx.badWeek.has('skips-sessions') || ctx.badWeek.has('stops-for-a-while');
const C = {
  novice: { text: 'a novice', test: (ctx) => ctx.experience === 'novice' },
  trained: { text: 'a trained lifter (intermediate or advanced)', test: (ctx) => ctx.experience !== 'novice' },
  health: { text: 'a health goal', test: (ctx) => ctx.modifier === 'health' || ctx.goalKinds.has('health') },
  highSkip: { text: 'high skip risk (the bad-week answer)', test: (ctx) => skips(ctx) },
  lowSkip: { text: 'low skip risk (the bad-week answer)', test: (ctx) => !skips(ctx) },
  conservative: { text: 'a Conservative screening', test: (ctx) => ctx.outcome === 'conservative' },
  muscle: { text: 'a muscle goal', test: (ctx) => ctx.modifier === 'muscle' },
  strength: { text: 'a strength goal', test: (ctx) => ctx.goalKinds.has('strength') },
  likesSplit: { text: 'likes a split (preferences.splits)', test: (ctx) => [...ctx.splitLikes].some((k) => k !== 'full-body') },
  likesBodyPart: { text: 'likes a body-part split (preferences.splits)', test: (ctx) => ctx.splitLikes.has('body-part') },
  likesHift: { text: 'likes variety or group classes (preferences.splits: hift)', test: (ctx) => ctx.splitLikes.has('hift') },
  timeRich: { text: '60 min or more a session', test: (_ctx, w) => w.minutes >= 60 },
  arms: { text: 'an arm emphasis (biceps or triceps a priority)', test: (ctx) => ctx.priority.includes('biceps') || ctx.priority.includes('triceps') },
  badWeeks: { text: 'bad weeks (the bad-week answer)', test: (ctx) => ctx.badWeek.size > 0 },
  fatLoss: { text: 'a fat-loss goal', test: (ctx) => ctx.goalKinds.has('fat-loss') || ctx.goalKinds.has('recomposition') },
  lagging: { text: 'a clear lagging muscle (the body assessment)', test: (ctx) => ctx.prioritySources.some((p) => p.value.source === 'lagging-area') },
  endurance: { text: 'an endurance goal', test: (ctx) => ctx.goalKinds.has('conditioning') },
  liftGoal: { text: 'a strength or muscle goal', test: (ctx) => ctx.goalKinds.has('strength') || ctx.modifier === 'muscle' },
  noKit: { text: 'no equipment (bodyweight, a bar or rings)', test: (ctx) => ctx.equipmentMode === 'bodyweight' || ctx.equipmentMode === 'calisthenics' },
  skill: { text: 'a skill goal', test: (ctx) => ctx.goalKinds.has('skill') },
  travel: { text: 'travel (the bad-week answer)', test: (ctx) => ctx.badWeek.has('travel') },
  fiveDays: { text: 'a 5-day week (the push/pull/legs and upper/lower hybrid)', test: (_ctx, w) => w.days === 5 },
} satisfies Record<string, Criterion>;

/** rules.md's "Split families", in its order. */
export const FAMILIES: readonly FamilyDef[] = [
  {
    id: 'full-body', name: 'Full body', structure: 'All major muscles each session; A/B or A/B/C, 2-4 days',
    days: [2, 3], minutes: [30, 60], who: () => [[C.novice, C.health, C.highSkip, C.conservative]],
    costs: ['Many exercises a session at high volume', 'Legs every session'],
    evidence: 'Equivalence Strong; the skip-risk edge (H)', engine: 'built',
  },
  {
    id: 'upper-lower', name: 'Upper/lower', structure: 'U/L/U/L, or U/L rotating over 2-3 days',
    days: [4], minutes: [45, 75], who: () => [[C.trained], [C.muscle, C.strength]],
    costs: ['Two heavy leg days', 'A missed day hits half the body'],
    evidence: 'Equivalence Strong; 2 exposures for strength Moderate', engine: 'built',
  },
  {
    id: 'push-pull-legs', name: 'Push/pull/legs', structure: '3 days (each once), 6 days (each twice), or push, pull, legs, upper, lower over 5',
    days: [3, 5, 6], who: (w) => (w.days === 3 ? [[C.likesSplit]] : w.days === 6 ? [[C.trained], [C.timeRich]] : [[C.fiveDays]]),
    costs: ['3 days: once a week per muscle (little strength practice, many sets per session)', '6 days: time, recovery and skip cost'],
    evidence: 'No direct trials; equivalence only; the structure (H)', engine: 'built',
  },
  {
    id: 'body-part', name: 'Body-part split', structure: '1-2 muscle groups a day, each once a week, 4-6 days',
    days: [4, 5, 6], who: () => [[C.trained], [C.muscle], [C.likesBodyPart], [C.lowSkip]],
    costs: ['Once a week per muscle', "A muscle's sets likely past the per-session cap", "A missed day loses a muscle's week"],
    evidence: 'Equivalence Moderate (few trained trials); the cap Weak', engine: 'built',
  },
  {
    id: 'torso-limbs', name: 'Torso/limbs', structure: 'Chest, back, shoulders / legs, arms',
    days: [4], who: () => [[C.arms]],
    costs: ['A long limbs day'],
    evidence: '(H) (equivalence by volume)', engine: 'built',
  },
  {
    id: 'upper-lower-full', name: 'Upper/lower/full', structure: 'U/L/F (3 days), U/L/U/L/F (5)',
    days: [3, 5], who: () => [[C.likesSplit]],
    costs: ['About twice a week, uneven per muscle'],
    evidence: '(H)', engine: 'built',
  },
  {
    id: 'heavy-light', name: 'Heavy/light full body', structure: 'Each main lift heavy once and light or varied once a week, 3-4 days',
    days: [3, 4], who: () => [[C.trained], [C.strength]],
    costs: ['Heavy days tire', 'More to plan'],
    evidence: 'Moderate for trained strength, none for muscle', engine: 'built',
  },
  {
    id: 'specialization', name: 'Specialization block', structure: '1-2 priority muscles at 12-18+ sets, trained first; the rest at maintenance, for 4-8 weeks',
    who: () => [[C.trained], [C.lagging]],
    costs: ['Fatigue concentrated', 'Maintenance holds only if load is kept'],
    evidence: 'Local dose-response Moderate, maintenance dose Weak, order Moderate; the block itself (H)', engine: 'coach',
    engineNote: 'The engine gives up to 3 priority muscles 10-16 sets and keeps the rest in the efficient tier; a block at 12-18+ sets with the rest at maintenance is the coach\'s.',
  },
  {
    id: 'concurrent', name: 'Concurrent (hybrid athlete)', structure: '2-4 lifting days plus endurance; 3 h+ apart or lift first',
    days: [2, 3, 4], who: () => [[C.endurance], [C.liftGoal]],
    costs: ['Small interference', 'Explosive and trained lower-body strength most at risk', 'Time'],
    evidence: 'Strong/Moderate ("Concurrent training and cardio")', engine: 'partly',
    engineNote: 'Every candidate carries the conditioning days and the concurrent checks; an endurance plan with its key runs is the coach\'s.',
  },
  {
    id: 'hift', name: 'CrossFit-style (HIFT)', structure: 'Mixed lifts, gymnastics and conditioning at high intensity, varied daily',
    who: () => [[C.likesHift]],
    costs: ['Specific lifts hard to progress', "Injury rate like weightlifting's", 'Fatigue unpredictable'],
    evidence: 'Weak', engine: 'coach',
    engineNote: 'The engine builds no varied daily sessions; its nearest are the conditioning days and, in short weeks, the minimum-dose supersets.',
  },
  {
    id: 'circuit', name: 'Circuit or minimalist', structure: 'Stations with short rest; or 1-2 sessions of a few multi-joint lifts, about 4 sets per muscle a week',
    minutes: [0, 30], who: () => [[C.badWeeks, C.health, C.fatLoss]],
    costs: ['Less maximal strength', 'Low volume per muscle'],
    evidence: 'Moderate', engine: 'partly',
    engineNote: 'The minimum-dose templates are the minimalist version (4 exercises, accessories as supersets); station circuits are the coach\'s.',
  },
  {
    id: 'calisthenics', name: 'Calisthenics skill blocks', structure: 'Leverage ladders (push-up, pull-up, single-leg), skill work early in the session',
    who: () => [[C.noKit, C.skill, C.travel]],
    costs: ['Load hard to measure', 'Leverage steps can be large'],
    evidence: 'Weak (progressive push-ups matched the bench press in small trials); the structure (H)', engine: 'partly',
    engineNote: 'With a skill goal the engine opens each full-body session with a skill block and climbs the ladders; a week built around skill blocks is the coach\'s.',
  },
];

export const FAMILY_BY_ID: ReadonlyMap<FamilyId, FamilyDef> = new Map(FAMILIES.map((f) => [f.id, f]));

export interface FamilyFit {
  family: FamilyId;
  name: string;
  /** The week and the person meet the family's Fits column. */
  fits: boolean;
  meets: string[];
  misses: string[];
}

const range = (xs: readonly number[]) => (xs.length > 1 && xs.every((x, i) => i === 0 || x === xs[i - 1]! + 1) ? `${xs[0]}-${xs.at(-1)}` : xs.join(' or '));

/** A family's Fits column against this profile and week: what it meets and what it misses. */
export function familyFit(id: FamilyId, ctx: PlanContext, week: FitWeek): FamilyFit {
  const f = FAMILY_BY_ID.get(id)!;
  const meets: string[] = [];
  const misses: string[] = [];
  if (f.days) (f.days.includes(week.days) ? meets : misses).push(`${range(f.days)} days (this week ${week.days})`);
  if (f.minutes) {
    const [lo, hi] = f.minutes;
    (week.minutes >= lo && week.minutes <= hi ? meets : misses).push(lo === 0 ? `${hi} min or less (${week.minutes})` : `${lo}-${hi} min (${week.minutes})`);
  }
  for (const group of f.who(week)) {
    const met = group.filter((c) => c.test(ctx, week));
    if (met.length) meets.push(...met.map((c) => c.text));
    else misses.push(group.length > 1 ? `none of: ${group.map((c) => c.text).join(', ')}` : group[0]!.text);
  }
  return { family: id, name: f.name, fits: misses.length === 0, meets, misses };
}
