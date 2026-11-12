// `engine catalogue`: the movement catalogue as data for the coach, searched
// by pattern, region, muscle, equipment, level or text. It widens choice
// rather than narrowing it: the coach designs the plan, and the order of the
// results is for display only, never a choice made for the coach.
//
// One ranking for every list of catalogue options (`rankMovements`): this
// command's results, the movements `evidence` lists for each region, and the
// options the plan check gives when a region is short. Exact text matches
// first, then the searched muscle (or the region's muscle) as a main muscle
// over a helping one, then the versions that load a two-joint muscle long
// (data/exercises.ts, `longLength`), then the level fit, then the most
// targeted (fewest muscles trained), then catalogue order.

import { matchCatalogue, NAME_SYNONYMS, normalizeName, ownNames } from '../adapters/vault/catalogue-match.ts';
import { CATALOGUE, CATALOGUE_BY_ID, EQUIPMENT, LEVELS, MOVEMENT_TAGS, MOVEMENT_USES, PATTERNS, usableWith, type CatalogueEntry, type Equipment, type Level, type MovementGuide, type MovementTag, type MovementUse, type Pattern } from '../core/data/exercises.ts';
import { CATALOGUE_LADDERS, LADDERS } from '../core/data/ladders.ts';
import { MUSCLES, MUSCLE_IDS } from '../core/data/muscles.ts';
import { explainRegion, nearestText, REGION_IDS, REGIONS, REGIONS_BY_ID } from '../core/data/regions.ts';
import { normalizeEquipment, EQUIPMENT_WORDS } from '../core/plan/context.ts';

// ---------------------------------------------------------------- the ranking

const LEVEL_RANK: Readonly<Record<Level, number>> = { beginner: 0, intermediate: 1, advanced: 2 };

/** What a list of options is for: each part optional, each only orders (the filters are the caller's). */
export interface RankTarget {
  /** The muscle searched for: main ranks before helps, a version loading it long before one that does not. */
  muscle?: string;
  /** The region searched for; its muscle stands in for `muscle`. */
  region?: string;
  /** The person's level: movements at or under it rank before harder ones. */
  level?: Level;
  /** Text searched for (normalized as names are): exact name matches first. */
  query?: string;
}

/** Why a movement sits where it does in a ranked list (only the parts the target asked about). */
export interface RankFit {
  /** How the text matched: the name or another name exactly, every word in a name, or the words in its pattern, muscles, regions or equipment. */
  query?: 'exact' | 'name' | 'other';
  /** The searched muscle (or the region's muscle) as a main muscle or a helping one. */
  role?: 'main' | 'helps';
  /** It loads the searched two-joint muscle (or region) at a long length. */
  longLength?: true;
  /** Harder than the level searched for. */
  aboveLevel?: true;
}

export interface Ranked {
  entry: CatalogueEntry;
  fit: RankFit;
}

const ORDER: ReadonlyMap<string, number> = new Map(CATALOGUE.map((e, i) => [e.id, i]));

/** The other names a movement answers to (its aliases, then the common gym names matched to it), normalized, its own name and id left out. */
export function aliasesOf(id: string): string[] {
  const e = CATALOGUE_BY_ID.get(id);
  if (!e) return [];
  const own = new Set([normalizeName(e.name), normalizeName(e.id.replace(/-/g, ' '))]);
  const synonyms = Object.entries(NAME_SYNONYMS)
    .filter(([, to]) => to === id)
    .map(([name]) => name);
  return [...new Set([...ownNames(e), ...synonyms])].filter((n) => !own.has(n));
}

/** Whether a movement loads the target's two-joint muscle (or that region) at a long length. */
function loadsLong(e: CatalogueEntry, muscle: string, region: string | undefined): boolean {
  return (e.longLength ?? []).some((x) => (region ? x === region || x === muscle : x === muscle || REGIONS_BY_ID.get(x)?.muscle === muscle));
}

/** A query word found among a text's words: a word starting with it, or the word itself without a plural s. */
function wordsIn(query: readonly string[], text: string): boolean {
  const words = text.split(' ');
  return query.every((q) => words.some((w) => w.startsWith(q) || (q.length > 3 && q.endsWith('s') && w === q.slice(0, -1))));
}

/** How a movement matches the normalized query; null when it does not. */
function queryMatch(e: CatalogueEntry, q: string): RankFit['query'] | null {
  const names = [normalizeName(e.name), normalizeName(e.id.replace(/-/g, ' ')), ...aliasesOf(e.id)];
  if (names.includes(q)) return 'exact';
  const words = q.split(' ').filter(Boolean);
  if (!words.length) return null;
  if (names.some((n) => wordsIn(words, n))) return 'name';
  const label = (id: string) => MUSCLES.find((m) => m.id === id)?.label ?? id;
  const other = [
    e.pattern,
    ...e.equipment,
    ...[...e.muscles.main, ...e.muscles.helps].flatMap((m) => [m, label(m)]),
    ...(e.regions ?? []).flatMap((r) => [r, REGIONS_BY_ID.get(r)?.label ?? r, ...(REGIONS_BY_ID.get(r)?.aliases ?? [])]),
  ]
    .map((t) => normalizeName(t.replace(/-/g, ' ')))
    .join(' ');
  return wordsIn(words, other) ? 'other' : null;
}

/** Whether a movement matches the query at all (the search's text filter). */
export function matchesQuery(e: CatalogueEntry, query: string): boolean {
  return queryMatch(e, normalizeName(query)) !== null;
}

/**
 * Catalogue movements in display order for a target (see the file's head):
 * a sort, never a filter; the caller filters first. Each comes with the
 * parts of the order that applied to it.
 */
export function rankMovements(entries: readonly CatalogueEntry[], target: RankTarget = {}): Ranked[] {
  const muscle = target.region ? REGIONS_BY_ID.get(target.region)?.muscle : target.muscle;
  const q = target.query ? normalizeName(target.query) : '';
  const QUERY_RANK = { exact: 0, name: 1, other: 2 } as const;
  const rows = entries.map((entry) => {
    const fit: RankFit = {};
    const key: number[] = [];
    if (q) {
      const m = queryMatch(entry, q);
      if (m) fit.query = m;
      key.push(m ? QUERY_RANK[m] : 3);
    }
    if (muscle) {
      const main = entry.muscles.main.includes(muscle);
      const helps = entry.muscles.helps.includes(muscle);
      if (main || helps) fit.role = main ? 'main' : 'helps';
      const long = loadsLong(entry, muscle, target.region);
      if (long) fit.longLength = true;
      key.push(main ? 0 : 1, long ? 0 : 1);
    }
    if (target.level) {
      const above = LEVEL_RANK[entry.level] > LEVEL_RANK[target.level];
      if (above) fit.aboveLevel = true;
      key.push(above ? 1 : 0);
    }
    if (muscle) key.push(entry.muscles.main.length + entry.muscles.helps.length);
    key.push(ORDER.get(entry.id) ?? 0);
    return { entry, fit, key };
  });
  rows.sort((a, b) => {
    for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i]! - b.key[i]!;
    return 0;
  });
  return rows.map(({ entry, fit }) => ({ entry, fit }));
}

// ---------------------------------------------------------------- the search

export interface CatalogueQuery {
  pattern?: Pattern;
  region?: string;
  muscle?: string;
  /** The equipment at hand (the profile's words or the catalogue's ids): only movements needing nothing else, a tool that stands in for the defining one (`alsoWith`) counting. */
  equipment?: readonly string[];
  level?: Level;
  query?: string;
}

export interface CatalogueNote {
  code: string;
  message: string;
  items?: string[];
}

/** A search the caller could not run as asked: an unknown pattern, region, muscle, level or piece of equipment, with the words that are known. */
export class CatalogueQueryError extends Error {}

/** A movement as the search returns it. */
export interface MovementView {
  id: string;
  name: string;
  pattern: Pattern;
  equipment: Equipment[];
  muscles: { main: string[]; helps: string[] };
  /** The muscle regions it biases (data/regions.ts); empty when none. */
  regions: string[];
  /** The two-joint muscles or regions it loads at a long length (empty for most). */
  longLength: string[];
  /** The abdominal-strain tag (low, moderate, high), as the Ledger screens it. */
  abdominalStrain: CatalogueEntry['iap'];
  level: Level;
  load: CatalogueEntry['load'];
  unilateral: boolean;
  easier: { id: string; name: string }[];
  harder: { id: string; name: string }[];
  /** Other names it answers to in a plan (matched to it by the vault's reading). */
  aliases: string[];
  /** Tools that can stand in for the defining one (the first of `equipment`). */
  alsoWith: Equipment[];
  /** What it asks of the body (`vocabulary.risk` says what each tag means): facts to weigh, nothing screens on them. */
  risk: MovementTag[];
  /** Roles beyond the pattern (`vocabulary.uses`). */
  uses: MovementUse[];
  /** It fits a hotel room: the travel kit (or a tool that stands in), room furniture, not advanced, quiet. */
  hotel: boolean;
  /** The guide text: the setup, the movement, the mistake to avoid. */
  guide: MovementGuide;
  fit: RankFit;
}

/** One level of a ladder, with the catalogue movement it counts and screens as (null when the name matches none). */
export interface LadderLevelView {
  level: number;
  name: string;
  detail?: string;
  exercise: string | null;
  exerciseName: string | null;
  reps?: [number, number] | null;
}

export interface LadderView {
  id: string;
  name: string;
  /** engine: the four the self-check starts (data/ladders.ts); catalogue: the catalogue's chains of movements along their harder links, not logged by level; plan: the vault plan's own (plan-data `ladders`). */
  source: 'engine' | 'catalogue' | 'plan';
  levels: LadderLevelView[];
}

const link = (ids: readonly string[]) => ids.map((id) => ({ id, name: CATALOGUE_BY_ID.get(id)?.name ?? id }));

function view(r: Ranked): MovementView {
  const e = r.entry;
  return {
    id: e.id,
    name: e.name,
    pattern: e.pattern,
    equipment: [...e.equipment],
    muscles: { main: [...e.muscles.main], helps: [...e.muscles.helps] },
    regions: [...(e.regions ?? [])],
    longLength: [...(e.longLength ?? [])],
    abdominalStrain: e.iap,
    level: e.level,
    load: e.load,
    unilateral: e.unilateral,
    easier: link(e.easier),
    harder: link(e.harder),
    aliases: aliasesOf(e.id),
    alsoWith: [...e.alsoWith],
    risk: [...e.risk],
    uses: [...e.uses],
    hotel: e.hotel,
    guide: { ...e.guide },
    fit: r.fit,
  };
}

/** A muscle as asked for: its id, or its label ("Upper back"). */
export function muscleId(v: string): string | null {
  const t = v.trim().toLowerCase();
  if (MUSCLE_IDS.includes(t)) return t;
  return MUSCLES.find((m) => m.label.toLowerCase() === t || m.id.replace(/-/g, ' ') === t)?.id ?? null;
}

/**
 * The region asked for: a region id or another name for one. An unsupported
 * one ("inner chest") gives its nearest supported option instead (a region,
 * or a muscle as a whole) and a note saying why; anything else is an error.
 */
function resolveRegion(v: string, notes: CatalogueNote[]): { region?: string; muscle?: string } {
  if (REGION_IDS.includes(v)) return { region: v };
  const e = explainRegion(v);
  if (e?.kind === 'region') return { region: e.region.id };
  if (e?.kind === 'unsupported') {
    notes.push({ code: 'unsupported-region', message: 'A region the evidence does not support: the search is for its nearest supported option instead.', items: [`${v}: nearest ${nearestText(e.entry)}. ${e.entry.why}`] });
    return REGIONS_BY_ID.has(e.entry.nearest) ? { region: e.entry.nearest } : { muscle: e.entry.nearest };
  }
  throw new CatalogueQueryError(`--region: "${v}" is not a muscle region; the regions are ${REGION_IDS.join(', ')}`);
}

/** The engine's ladders, the catalogue's, and the plan's own (each level matched to a catalogue movement by name). */
export function ladderViews(planLadders: unknown): LadderView[] {
  const engine: LadderView[] = LADDERS.map((l) => ({
    id: l.id,
    name: l.name,
    source: 'engine',
    levels: l.levels.map((x, i) => ({ level: i + 1, name: x.name, ...(x.detail ? { detail: x.detail } : {}), exercise: x.exercise, exerciseName: CATALOGUE_BY_ID.get(x.exercise)?.name ?? null, reps: x.reps ? [x.reps[0], x.reps[1]] : null })),
  }));
  const catalogue: LadderView[] = CATALOGUE_LADDERS.map((l) => ({
    id: l.id,
    name: l.name,
    source: 'catalogue',
    levels: l.steps.map((id, i) => {
      const name = CATALOGUE_BY_ID.get(id)?.name ?? id;
      return { level: i + 1, name, exercise: id, exerciseName: name };
    }),
  }));
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const plan: LadderView[] = (Array.isArray(planLadders) ? planLadders : []).filter(isObj).flatMap((l) => {
    if (typeof l['id'] !== 'string' || !Array.isArray(l['levels'])) return [];
    const levels = (l['levels'] as unknown[]).filter(isObj).filter((x) => typeof x['name'] === 'string').map((x, i) => {
      const m = matchCatalogue(x['name'] as string);
      return { level: i + 1, name: x['name'] as string, ...(typeof x['detail'] === 'string' ? { detail: x['detail'] } : {}), exercise: m?.id ?? null, exerciseName: m?.name ?? null };
    });
    return [{ id: l['id'], name: typeof l['name'] === 'string' ? l['name'] : l['id'], source: 'plan' as const, levels }];
  });
  return [...engine, ...catalogue, ...plan];
}

/** The words each filter takes, for the coach (and the usage errors). */
export function vocabulary() {
  return {
    patterns: [...PATTERNS],
    equipment: { ids: [...EQUIPMENT], words: [...EQUIPMENT_WORDS] },
    levels: [...LEVELS],
    muscles: MUSCLES.map((m) => ({ id: m.id, label: m.label })),
    regions: REGIONS.map((r) => ({ id: r.id, muscle: r.muscle, label: r.label })),
    risk: Object.entries(MOVEMENT_TAGS).map(([id, meaning]) => ({ id, meaning })),
    uses: Object.entries(MOVEMENT_USES).map(([id, meaning]) => ({ id, meaning })),
  };
}

export const ORDER_NOTE =
  'The order is for display only, never a choice: exact text matches first, then the searched muscle (or the region\'s muscle) as a main muscle over a helping one, then versions that load a two-joint muscle at a long length, then movements at or under the level, then the most targeted, then catalogue order. The coach chooses; every movement listed fits the filters.';

/**
 * The search: the movements that fit every filter given (pattern, region,
 * muscle as main or helping, equipment at hand with the stand-in tools,
 * text), in display order; the level only orders, it removes nothing. The
 * ladders come along when one of their levels is among the results, or with
 * no filter at all. An unknown
 * pattern, region, muscle or level is a CatalogueQueryError naming the known
 * ones; an unknown equipment word is left out with an `unknown-equipment` note.
 */
export function searchCatalogue(q: CatalogueQuery, opts: { planLadders?: unknown } = {}) {
  const notes: CatalogueNote[] = [];
  // The profile's experience words read as the catalogue's levels (novice is beginner).
  if ((q.level as string | undefined) === 'novice') q = { ...q, level: 'beginner' };
  if (q.pattern !== undefined && !(PATTERNS as readonly string[]).includes(q.pattern)) throw new CatalogueQueryError(`--pattern: "${q.pattern}" is not a movement pattern; the patterns are ${PATTERNS.join(', ')}`);
  if (q.level !== undefined && !(LEVELS as readonly string[]).includes(q.level)) throw new CatalogueQueryError(`--level must be ${LEVELS.join(', ')} (or the profile's novice)`);
  let muscle: string | undefined;
  if (q.muscle !== undefined) {
    const id = muscleId(q.muscle);
    if (!id) throw new CatalogueQueryError(`--muscle: "${q.muscle}" is not a muscle; the muscles are ${MUSCLE_IDS.join(', ')}`);
    muscle = id;
  }
  let region: string | undefined;
  if (q.region !== undefined) {
    const r = resolveRegion(q.region, notes);
    region = r.region;
    if (r.muscle && !muscle) muscle = r.muscle;
  }
  let have: Set<Equipment> | null = null;
  if (q.equipment !== undefined) {
    const n = normalizeEquipment(q.equipment);
    // Free text ("smith machine") is left out with a note, as the profile and the check read it: the search uses the words it knows.
    if (n.unknown.length) notes.push({ code: 'unknown-equipment', message: `Equipment words Pahlavan does not know, left out: the search uses the rest. The words are ${[...EQUIPMENT_WORDS].join(', ')}.`, items: n.unknown });
    have = n.equipment;
  }
  const fits = CATALOGUE.filter(
    (e) =>
      (q.pattern === undefined || e.pattern === q.pattern) &&
      (region === undefined || (e.regions ?? []).includes(region)) &&
      (muscle === undefined || e.muscles.main.includes(muscle) || e.muscles.helps.includes(muscle)) &&
      (have === null || usableWith(e, have)) &&
      (q.query === undefined || matchesQuery(e, q.query)),
  );
  const ranked = rankMovements(fits, { ...(muscle ? { muscle } : {}), ...(region ? { region } : {}), ...(q.level ? { level: q.level } : {}), ...(q.query ? { query: q.query } : {}) });
  const movements = ranked.map(view);
  const ids = new Set(movements.map((m) => m.id));
  const unfiltered = q.pattern === undefined && q.region === undefined && q.muscle === undefined && q.equipment === undefined && q.query === undefined;
  const ladders = ladderViews(opts.planLadders).filter((l) => unfiltered || l.levels.some((x) => x.exercise !== null && ids.has(x.exercise)));
  if (!movements.length) notes.push({ code: 'no-match', message: 'No catalogue movement fits every filter: widen one. A movement the catalogue does not know still counts once its guide entry names its muscles (and regions).' });
  return {
    filters: {
      pattern: q.pattern ?? null,
      region: region ?? null,
      muscle: muscle ?? null,
      equipment: have ? [...have] : null,
      level: q.level ?? null,
      query: q.query ?? null,
    },
    order: ORDER_NOTE,
    count: movements.length,
    movements,
    ladders,
    vocabulary: vocabulary(),
    notes,
  };
}
