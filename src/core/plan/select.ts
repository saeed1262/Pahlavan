// Step 4: choose exercises for a slot. Filters: equipment, level (a self-check
// result can allow a movement above the training age), dislikes, the Ledger
// (safety.ts screenExercise), the self-check's and body assessment's exclusions. Ranking, best
// first: preferred ids, liked, equipment for the role, level fit, unilateral
// when there is an asymmetry, then id. Deterministic: no randomness anywhere.

import type { CatalogueEntry, Equipment, Level, Pattern } from '../data/exercises.ts';
import { screenExercise } from '../safety.ts';
import type { IsoDate } from '../schema.ts';
import type { EquipmentMode, PlanContext } from './context.ts';
import type { SlotSpec } from './template.ts';

/** When a pattern has no candidate, the next patterns to try. */
export const FALLBACK: Partial<Record<Pattern, Pattern[]>> = {
  'vertical-pull': ['horizontal-pull', 'rear-delt'],
  'vertical-push': ['horizontal-push'],
  'horizontal-pull': ['vertical-pull', 'rear-delt'],
  'horizontal-push': ['vertical-push'],
  'core-anti-rotation': ['core-anti-extension'],
  'core-anti-extension': ['core-anti-rotation', 'core-flexion'],
  'core-flexion': ['core-anti-extension'],
  hinge: ['lunge'],
  lunge: ['squat'],
  squat: ['lunge'],
  'rear-delt': ['neck-upper-back', 'horizontal-pull'],
  carry: ['core-anti-rotation'],
};

const LEVEL_RANK: Record<Level, number> = { beginner: 0, intermediate: 1, advanced: 2 };
const EXPERIENCE_RANK = { novice: 0, intermediate: 1, advanced: 2 } as const;

const MAIN_RANK: Record<EquipmentMode, Partial<Record<Equipment, number>>> = {
  gym: { barbell: 5, dumbbell: 4, machine: 3, cable: 3, 'pull-up-bar': 2, rings: 2, kettlebell: 2, bodyweight: 1, band: 0 },
  dumbbell: { dumbbell: 5, kettlebell: 4, 'pull-up-bar': 3, rings: 3, bench: 2, bodyweight: 2, band: 1 },
  machines: { machine: 5, cable: 4, dumbbell: 3, bodyweight: 2, band: 1 },
  calisthenics: { 'pull-up-bar': 5, rings: 5, bodyweight: 4, bench: 3, band: 2 },
  bodyweight: { bodyweight: 5, bench: 4, band: 3 },
};
const ACCESSORY_RANK: Partial<Record<Equipment, number>> = { cable: 4, dumbbell: 4, machine: 4, rings: 3, 'pull-up-bar': 3, band: 3, bodyweight: 3, bench: 3, kettlebell: 2, barbell: 1 };

export interface Pick {
  id: string;
  pattern: Pattern;
  /** The slot's own pattern had no candidate; this one stood in. */
  fallback: boolean;
}

function allowed(ctx: PlanContext, e: CatalogueEntry, spec: SlotSpec, date: IsoDate): boolean {
  if (!e.equipment.every((q) => q === 'bodyweight' || ctx.equipment.has(q))) return false;
  if (ctx.dislikes.has(e.id)) return false;
  // Ruled out by the self-check or the body assessment (context.ts): a ladder's higher levels, and what a finding rules out once confirmed (pure overhead pressing for a limited reach).
  if (ctx.exclude.has(e.id)) return false;
  // A self-check result can allow a movement above the training age (5 strict pull-ups: pull-ups for a novice).
  if (LEVEL_RANK[e.level] > EXPERIENCE_RANK[ctx.experience] && !ctx.unlock.has(e.id)) return false;
  if (e.load === 'cardio' || e.pattern === 'mobility') return false;
  if (spec.role === 'main' && e.load === 'timed') return false;
  // Holds belong in core and skill slots, or where a slot asks for them (balance work).
  if (e.load === 'timed' && !['core-anti-extension', 'core-anti-rotation', 'core-flexion', 'skill'].includes(e.pattern) && !(spec.prefer ?? []).includes(e.id)) return false;
  return screenExercise(e.id, ctx.ledger, date, ctx.exercises).value.allowed;
}

/** Ranked candidates for a slot, trying fallback patterns in order; `exclude` ids are left out. */
export function rankCandidates(
  ctx: PlanContext,
  spec: SlotSpec,
  date: IsoDate,
  exclude: ReadonlySet<string>,
): { pattern: Pattern; fallback: boolean; ranked: CatalogueEntry[] } | null {
  for (const [i, pattern] of [spec.pattern, ...(FALLBACK[spec.pattern] ?? [])].entries()) {
    // A single-leg slot also takes a preferred one-sided squat (box pistols on the single-leg ladder).
    const related = (e: CatalogueEntry) => i === 0 && pattern === 'lunge' && e.unilateral && (e.pattern === 'squat' || e.pattern === 'skill') && (spec.prefer ?? []).includes(e.id);
    const pool = ctx.catalogue.filter((e) => (e.pattern === pattern || related(e)) && !exclude.has(e.id) && allowed(ctx, e, spec, date));
    if (pool.length === 0) continue;
    const prefer = spec.prefer ?? [];
    const exp = EXPERIENCE_RANK[ctx.experience];
    const equip = (e: CatalogueEntry) => (spec.role === 'main' ? (MAIN_RANK[ctx.equipmentMode][e.equipment[0]!] ?? 0) : (ACCESSORY_RANK[e.equipment[0]!] ?? 0));
    const key = (e: CatalogueEntry): number[] => [
      prefer.includes(e.id) ? prefer.indexOf(e.id) : prefer.length,
      ctx.likes.has(e.id) ? 0 : 1,
      -equip(e),
      exp - LEVEL_RANK[e.level],
      spec.role === 'main' ? -e.muscles.main.length : 0,
      ctx.weakSide && e.unilateral ? 0 : ctx.weakSide ? 1 : 0,
    ];
    const ranked = [...pool].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      for (let k = 0; k < ka.length; k++) if (ka[k] !== kb[k]) return ka[k]! - kb[k]!;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return { pattern, fallback: i > 0, ranked };
  }
  return null;
}

/**
 * The ranked list rotated by `offset`, then the first candidate that is not
 * in `avoid` (variety across the week) and trains none of the `crowded`
 * muscles as a main muscle (the session's 8-direct-set limit); failing that,
 * the first not avoided; or null when nothing fits. A lower level of a
 * ladder than the user's tested level never takes the slot (it is not near
 * failure at that level): the ladder's movement at the level stands in when
 * it is of the same pattern and not already in the session, whatever the
 * week's variety; else the next candidate without the lower levels.
 */
export function pick(
  ctx: PlanContext,
  spec: SlotSpec,
  date: IsoDate,
  exclude: ReadonlySet<string>,
  avoid: ReadonlySet<string>,
  offset: number,
  crowded: ReadonlySet<string> = new Set(),
): Pick | null {
  const got = pickRanked(ctx, spec, date, exclude, avoid, offset, crowded);
  const level = got ? ctx.belowLevel.get(got.id) : undefined;
  if (!got || level === undefined) return got;
  const up = ctx.byId.get(level);
  if (up && up.pattern === got.pattern && !exclude.has(up.id) && allowed(ctx, up, spec, date)) return { ...got, id: up.id };
  return pickRanked(ctx, spec, date, new Set([...exclude, ...ctx.belowLevel.keys()]), avoid, offset, crowded);
}

function pickRanked(ctx: PlanContext, spec: SlotSpec, date: IsoDate, exclude: ReadonlySet<string>, avoid: ReadonlySet<string>, offset: number, crowded: ReadonlySet<string>): Pick | null {
  const r = rankCandidates(ctx, spec, date, exclude);
  if (!r) return null;
  const o = offset % r.ranked.length;
  const rotated = [...r.ranked.slice(o), ...r.ranked.slice(0, o)];
  const roomy = (x: CatalogueEntry) => !x.muscles.main.some((m) => crowded.has(m));
  const e = rotated.find((x) => !avoid.has(x.id) && roomy(x)) ?? rotated.find((x) => !avoid.has(x.id)) ?? rotated[0]!;
  return { id: e.id, pattern: r.pattern, fallback: r.fallback };
}
