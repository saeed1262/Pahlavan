// The vault's muscle overrides for the plan generator. Catalogue movements
// count with the catalogue's tags everywhere (muscle-tags.ts), so `engine
// plan --vault` needs only the guide entries that keep their own tags with a
// reason (`muscles.override`), keyed by the catalogue movement each names,
// with the entry's own regions; the generator lays them over the catalogue.
// Pure: it takes the parsed guide.

import type { MuscleMapEntry } from '../../core/plan/context.ts';
import type { PlanDataGuide } from '../../core/plan-data.ts';
import { canonicalTags } from './muscle-tags.ts';

/**
 * Catalogue id to the guide entry whose override counts for it in a new
 * plan. An override belongs to the entry that carries it, and Pahlavan reads
 * an item's tags from the guide entry of the item's own name. A generated
 * plan names each movement by the catalogue's name, and the exporter writes
 * its guide under the entry with that name (any case), so only that entry's
 * override can count: one on a variant or synonym key ("Back squat",
 * "Goblet squat (heavy)") keeps counting for the items named by it, never
 * for the catalogue movement in a new plan. Overrides without main muscles
 * are left out (the reader ignores them too).
 */
export function vaultMuscleMap(guide: Readonly<Record<string, PlanDataGuide>>): Record<string, MuscleMapEntry> {
  const out: Record<string, MuscleMapEntry> = {};
  const taken = new Set<string>();
  for (const [key, entry] of Object.entries(guide)) {
    const c = canonicalTags(key, entry);
    if (!c.catalogue || key.toLowerCase() !== c.catalogue.name.toLowerCase()) continue;
    // The first entry of that name is the one the exporter reuses.
    if (taken.has(c.catalogue.id)) continue;
    taken.add(c.catalogue.id);
    if (c.source !== 'override' || c.tags.main.length === 0) continue;
    out[c.catalogue.id] = { guide: key, muscles: { main: [...c.tags.main], helps: [...c.tags.helps], ...(c.tags.regions?.length ? { regions: [...c.tags.regions] } : {}) }, override: c.override! };
  }
  return out;
}
