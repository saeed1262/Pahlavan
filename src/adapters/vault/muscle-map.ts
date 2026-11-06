// The vault's muscle map for the plan generator: plan-data's guide entries
// (their `muscles`, as `engine review` counts them through convert.ts) keyed
// by the catalogue movement each one names. With it, `engine plan --vault`
// fits and checks sets per muscle on the numbers Pahlavan shows. Pure: it
// takes the parsed guide.

import { CATALOGUE, type CatalogueEntry } from '../../core/data/exercises.ts';
import type { MuscleMapEntry } from '../../core/plan/context.ts';
import { toEngineMuscles, type PlanDataGuide } from '../../core/plan-data.ts';
import { matchCatalogue, normalizeName } from './catalogue-match.ts';

/**
 * Catalogue id to the guide entry whose muscles count for it. The guide key
 * equal to the catalogue name (any case) comes first, as the exporter reuses
 * that entry; then a key with the same normalized name; then a key the
 * catalogue matcher maps to it (a synonym), the first in the guide's order.
 * Entries without main muscles (cardio, mobility, untagged) are left out.
 */
export function vaultMuscleMap(guide: Readonly<Record<string, PlanDataGuide>>, catalogue: readonly CatalogueEntry[] = CATALOGUE): Record<string, MuscleMapEntry> {
  const tagged = Object.entries(guide)
    .map(([key, g]) => {
      const m = g?.muscles;
      if (!m || m.kind) return null;
      const mapped = toEngineMuscles({ main: Array.isArray(m.main) ? m.main : [], helps: Array.isArray(m.helps) ? m.helps : [] }).muscles;
      return mapped.main.length ? { key, muscles: { main: [...mapped.main], helps: [...mapped.helps] } } : null;
    })
    .filter((x): x is { key: string; muscles: { main: string[]; helps: string[] } } => x !== null);
  const out: Record<string, MuscleMapEntry> = {};
  const rank: Record<string, number> = {};
  const offer = (id: string, key: string, muscles: MuscleMapEntry['muscles'], r: number) => {
    if (rank[id] !== undefined && rank[id]! <= r) return;
    out[id] = { guide: key, muscles };
    rank[id] = r;
  };
  for (const t of tagged) {
    for (const e of catalogue) {
      if (t.key.toLowerCase() === e.name.toLowerCase()) offer(e.id, t.key, t.muscles, 0);
      else if (normalizeName(t.key) === normalizeName(e.name)) offer(e.id, t.key, t.muscles, 1);
    }
    const m = matchCatalogue(t.key);
    if (m) offer(m.id, t.key, t.muscles, 2);
  }
  return out;
}
