// Protein a day by goal: the eating plan's range in grams per kg of trend
// weight, and the daily floor the protein item is ticked against (the
// range's low end). The tiers follow the fitness-coach skill's
// references/tracking.md and diet.md:
//
//   lifting goals                  1.6-2.2 g/kg   Morton 2018 (the ISSN gives 1.4-2.0, Jäger 2017)
//   health-only or endurance goals 1.2-1.6 g/kg   Thomas 2016 gives 1.2-2.0 for athletes; the edges (H)
//   in an energy deficit           the upper half Jäger 2017
//   65+                            at least 1.0, and 1.2 when training (Bauer 2013, PROT-AGE)
//
// Pure: the goals, the age, the trend weight and the deficit are inputs.

import { explain, type Result } from './reason.ts';
import type { GoalKind, Profile, RateBand, TrackedItem } from './schema.ts';
import { RATE_BANDS } from './weight.ts';

export const PROTEIN = {
  /** g per kg of trend weight a day. */
  lifting: [1.6, 2.2] as const,
  health: [1.2, 1.6] as const,
  /** 65+: at least this much, more when training (PROT-AGE). */
  older: { age: 65, rest: 1.0, training: 1.2 },
} as const;

/** Goals that need no lifting tier: health on its own, or endurance (conditioning). Every other goal lifts. */
export const NON_LIFTING_GOALS: readonly GoalKind[] = ['health', 'conditioning'];

export type ProteinTier = 'lifting' | 'health';

export interface ProteinGoal {
  kind: GoalKind;
  importance?: number;
  rateBand?: RateBand;
}

export interface ProteinInput {
  /** The profile's goals; none: the lifting tier (the coach's default before there is a profile). */
  goals: readonly ProteinGoal[];
  /** Years. */
  age?: number | null;
  /** Trend weight in kg (review's weight.trend latest); without it, no grams. */
  weightKg?: number | null;
  /** An energy deficit, when the eating plan says so; left out, the weight goal's band decides. */
  deficit?: boolean;
  /** Whether the user trains (65+ floor); left out, true (a coached plan trains). */
  training?: boolean;
}

export interface ProteinTarget {
  tier: ProteinTier;
  deficit: boolean;
  /** The day's range in g per kg. */
  gPerKg: [number, number];
  /** The low end: the protein item is ticked on days this is reached. */
  floorGPerKg: number;
  /** The range in grams a day at the trend weight. */
  grams: [number, number] | null;
  /** The protein item's gram target (the floor at the trend weight, rounded). */
  targetG: number | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** The weight goal that decides the deficit: the most important goal with a band, as review's weight section picks it. */
function weightBand(goals: readonly ProteinGoal[]): { kind: GoalKind; band: RateBand } | null {
  const sorted = [...goals].sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
  for (const g of sorted) {
    const band = g.rateBand ?? (RATE_BANDS as Record<string, RateBand | undefined>)[g.kind];
    if (band) return { kind: g.kind, band };
  }
  return null;
}

/**
 * The protein range and the item's daily floor. The lifting tier unless
 * every goal is health or conditioning; the upper half of the tier in an
 * energy deficit (the weight goal's band losing weight, or the eating plan
 * saying so); at 65+ never under PROT-AGE's floor.
 */
export function proteinTarget(input: ProteinInput): Result<ProteinTarget> {
  const kinds = input.goals.map((g) => g.kind);
  const tier: ProteinTier = kinds.length > 0 && kinds.every((k) => NON_LIFTING_GOALS.includes(k)) ? 'health' : 'lifting';
  const band = weightBand(input.goals);
  const deficit = input.deficit ?? (band !== null && band.band.hi < 0);
  const [lo0, hi] = PROTEIN[tier];
  const tierLo = deficit ? r1((lo0 + hi) / 2) : lo0;
  const age = input.age ?? null;
  const older = age !== null && age >= PROTEIN.older.age;
  const olderFloor = older ? (input.training === false ? PROTEIN.older.rest : PROTEIN.older.training) : null;
  const lo = olderFloor !== null ? Math.max(tierLo, olderFloor) : tierLo;
  const w = input.weightKg && input.weightKg > 0 ? input.weightKg : null;
  const grams: [number, number] | null = w ? [Math.round(lo * w), Math.round(hi * w)] : null;
  const targetG = grams ? grams[0] : null;
  const why = tier === 'lifting' ? (kinds.length ? `lifting goals (${[...new Set(kinds)].join(', ')})` : 'no goals yet, so the lifting range') : `health or endurance goals only (${[...new Set(kinds)].join(', ')})`;
  const source = tier === 'lifting' ? 'Morton 2018; Jäger 2017' : 'Thomas 2016; the edges a heuristic';
  const note = [
    `${why[0]!.toUpperCase()}${why.slice(1)}: ${lo0}-${hi} g/kg a day (${source}).`,
    deficit ? `In an energy deficit${input.deficit === undefined && band ? ` (the ${band.kind} goal's band)` : ''}, the upper half: ${tierLo}-${hi} g/kg (Jäger 2017).` : '',
    olderFloor !== null ? `At ${age}, at least ${olderFloor} g/kg${input.training === false ? '' : ' when training'} (Bauer 2013), ${olderFloor > tierLo ? 'which sets the floor' : 'which the range already meets'}.` : '',
    w && grams ? `At ${r1(w)} kg: ${grams[0]}-${grams[1]} g a day; the protein item is ticked on days with at least ${targetG} g.` : 'No trend weight yet, so no grams: the item waits for the first weigh-ins.',
  ].filter(Boolean).join(' ');
  return explain(
    { tier, deficit, gPerKg: [lo, hi], floorGPerKg: lo, grams, targetG },
    'protein',
    { goals: kinds, age, weightKg: w, deficit, deficitFrom: input.deficit !== undefined ? 'the eating plan' : band ? `the ${band.kind} goal's band` : 'no weight goal', training: input.training ?? true },
    { threshold: { lifting: PROTEIN.lifting, health: PROTEIN.health, deficit: 'the upper half of the tier', older: PROTEIN.older }, note },
  );
}

/** Age in whole years on a date's year from a birth year (the profile keeps only the year). */
export const ageOn = (date: string, birthYear: number | undefined | null): number | null => (birthYear ? Number(date.slice(0, 4)) - birthYear : null);

/** The protein target for a profile (its goals and birth year) at a trend weight, on a date. No profile: the lifting range. */
export function proteinForProfile(profile: Pick<Profile, 'goals' | 'basics'> | null | undefined, weightKg: number | null, date: string): Result<ProteinTarget> {
  return proteinTarget({ goals: profile?.goals ?? [], age: ageOn(date, profile?.basics?.birthYear), weightKg });
}

/** The protein item: a tick named Protein (or with the id protein, or linked to the Protein habit). */
export function isProteinItem(item: Pick<TrackedItem, 'id' | 'kind' | 'name' | 'habit'>): boolean {
  return item.kind === 'tick' && (item.id === 'protein' || /^protein\b/i.test(item.name.trim()) || item.habit === 'protein');
}

/** The protein item the eating plan ticks: its `protein.item`, else the tracked protein tick (the Food tab's and the Sunday check-in's). */
export function proteinItemOf(plan: { protein: { item?: string } } | null | undefined, items: readonly TrackedItem[]): TrackedItem | null {
  const id = plan?.protein.item;
  return (id ? items.find((x) => x.id === id) : undefined) ?? items.find((x) => isProteinItem(x)) ?? null;
}
