// One source of muscle tags for a vault movement. A movement the engine's
// catalogue knows (matchCatalogue: its name, id, an alias or a common
// synonym) counts with the catalogue's tags, so Review, Progress, Plan, the
// movement guide and `engine plan` agree; the vault guide's `muscles` count only for a
// movement the catalogue does not know, or when the entry gives a reason to
// keep its own (`muscles.override`). Either way the tags are on plan-data's
// 14 groups, with a muscle in `main` never also in `helps`. The muscle
// regions follow the same rule: the catalogue's for a movement it knows, the
// guide's `regions` for one it does not know or with an override. Pure: it
// takes the parsed guide entry.

import type { CatalogueEntry } from '../../core/data/exercises.ts';
import { REGION_IDS, regionsWithoutParent as parentless } from '../../core/data/regions.ts';
import { overrideOf, planDataGroups, sameMuscles, toEngineMuscles } from '../../core/plan-data.ts';
import type { MuscleTags } from '../../core/schema.ts';
import { matchCatalogue } from './catalogue-match.ts';

export type TagSource = 'catalogue' | 'guide' | 'override';

export interface CanonicalTags {
  /** The muscles that count, as engine ids on plan-data's 14 groups. */
  tags: MuscleTags;
  source: TagSource;
  /** The catalogue movement the name matched, or null. */
  catalogue: CatalogueEntry | null;
  /** The guide entry's cardio or mobility kind: an item that is not counted in sets per muscle. */
  kind?: 'cardio' | 'mobility';
  /** The entry's reason for keeping its own tags (source `override`). */
  override?: string;
  /** Why the entry's `override` is not honoured (not a non-empty reason, or no main muscle beside it): the catalogue's tags count. */
  overrideIgnored?: string;
  /** A cardio or mobility entry for a movement the catalogue counts as strength work: the catalogue's tags, which do not count while `kind` stays. */
  uncounted?: MuscleTags;
  /** The guide's tags and the catalogue's, when they differ as sets (the guide names at least one muscle). */
  differs?: { guide: MuscleTags; catalogue: MuscleTags };
  /** Muscle ids in the guide entry the engine does not know (dropped). */
  unknown: string[];
  /** Region values in the guide entry that are not region ids (dropped where the guide's regions count). */
  unknownRegions: string[];
  /** Region ids in the guide entry whose parent muscle the entry does not tag in main or helps (dropped where the guide's regions count). */
  regionsWithoutParent: string[];
}

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Tags with these regions, or without the key when there are none. */
const withRegions = (t: MuscleTags, regions: readonly string[] | undefined): MuscleTags => (regions?.length ? { ...t, regions: [...regions] } : t);

/**
 * The muscles a vault movement counts with, and where they come from. `name`
 * is the plan's or the guide's name for it; `guideEntry` its plan-data guide
 * entry, if any (read defensively: the file is the user's).
 */
export function canonicalTags(name: string, guideEntry: unknown): CanonicalTags {
  const raw = typeof guideEntry === 'object' && guideEntry !== null ? (guideEntry as { muscles?: unknown }).muscles : undefined;
  const gm = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as { main?: unknown; helps?: unknown; kind?: unknown; regions?: unknown }) : null;
  const catalogue = matchCatalogue(name);
  // A cardio or mobility item: the guide says it is not strength work, so it carries no tags (a catalogue strength movement's are named, to warn).
  if (gm?.kind === 'cardio' || gm?.kind === 'mobility') {
    const strength = catalogue && catalogue.muscles.main.length > 0 ? planDataGroups(catalogue.muscles) : null;
    return { tags: { main: [], helps: [] }, source: 'guide', catalogue, kind: gm.kind, ...(strength ? { uncounted: strength } : {}), unknown: [], unknownRegions: [], regionsWithoutParent: [] };
  }
  const mapped = gm ? toEngineMuscles({ main: strs(gm.main), helps: strs(gm.helps) }) : { muscles: { main: [], helps: [] }, unknown: [] };
  const unknown = mapped.unknown;
  // The guide's regions: a known id whose parent muscle the entry tags counts (where the guide's tags do);
  // the rest, ids it does not know and regions of a muscle the entry does not train, are named to warn.
  const rawRegions = gm ? strs(gm.regions) : [];
  const unknownRegions = [...new Set(rawRegions.filter((r) => !REGION_IDS.includes(r)))];
  const known = [...new Set(rawRegions.filter((r) => REGION_IDS.includes(r)))];
  const regionsWithoutParent = parentless({ ...mapped.muscles, regions: known });
  const guide = withRegions(mapped.muscles, known.filter((r) => !regionsWithoutParent.includes(r)));
  if (!catalogue) return { tags: guide, source: 'guide', catalogue: null, unknown, unknownRegions, regionsWithoutParent };
  const fromCatalogue = planDataGroups(catalogue.muscles);
  const named = guide.main.length + guide.helps.length > 0;
  const differs = named && !sameMuscles(guide, fromCatalogue) ? { guide: mapped.muscles, catalogue: fromCatalogue } : undefined;
  // An override keeps the guide's own tags when it is a reason beside a main muscle; otherwise it is ignored, and said so.
  const o = overrideOf(gm);
  if (o.state === 'active') return { tags: guide, source: 'override', catalogue, override: o.reason, ...(differs ? { differs } : {}), unknown, unknownRegions, regionsWithoutParent };
  // The same muscles as the guide's (in any order): the guide's order, as the user wrote it; the catalogue's regions either way.
  const counted = named && !differs ? { main: guide.main, helps: guide.helps } : fromCatalogue;
  return { tags: withRegions(counted, catalogue.regions), source: 'catalogue', catalogue, ...(differs ? { differs } : {}), ...(o.state === 'ignored' ? { overrideIgnored: o.why } : {}), unknown, unknownRegions, regionsWithoutParent };
}

/** "main shoulders, upper-back, helps triceps": a tag set as the muscle-tags warnings list it. */
export function tagsText(t: MuscleTags): string {
  if (!t.main.length && !t.helps.length) return 'none';
  return [t.main.length ? `main ${t.main.join(', ')}` : 'no main', t.helps.length ? `helps ${t.helps.join(', ')}` : null].filter(Boolean).join(', ');
}

/** One `muscle-tags-differ` item: "Face Pull: guide main shoulders, upper-back | catalogue main upper-back, helps shoulders". */
export function differsItem(key: string, d: NonNullable<CanonicalTags['differs']>): string {
  return `${key}: guide ${tagsText(d.guide)} | catalogue ${tagsText(d.catalogue)}`;
}
