// The Movements tab: every movement Pahlavan knows, searched and filtered,
// grouped by pattern, each with its guide (the setup, the movement, the
// mistake to avoid, on the body map), its level and equipment, its easier and
// harder steps, and the ladders it sits on. It wraps the coach's catalogue
// search (catalogue.ts) for the screen: plain words, the person's own plan
// and equipment marked, and a filter the search can't use becomes a note,
// never an error. Pure: no clock and no DOM; the plan's names and ladders and
// the profile's equipment come in, and without them the whole catalogue
// still shows.

import { matchCatalogue, normalizeName } from '../adapters/vault/catalogue-match.ts';
import { CATALOGUE, CATALOGUE_BY_ID, LEVELS, PATTERNS, usableWith, type Equipment, type Level, type Pattern } from '../core/data/exercises.ts';
import { MUSCLES } from '../core/data/muscles.ts';
import { normalizeEquipment } from '../core/plan/context.ts';
import { CatalogueQueryError, ladderViews, muscleId, searchCatalogue, type CatalogueQuery, type LadderView, type MovementView } from './catalogue.ts';
import { LEVEL_WORDS, LOAD_WORDS, PATTERN_TITLE } from './catalogue-doc.ts';
import { guideFor, guideVideo, ladderNow, muscleSlugs, type GuideEntry } from './dashboard.ts';

/** What the person asked for: each part optional; a value the catalogue doesn't know is left out with a note. */
export interface MovementsQuery {
  /** The words typed in the search box (blank: no text filter). */
  text?: string;
  /** A movement pattern id (PATTERNS). */
  pattern?: string | null;
  /** A muscle id or its label: the movements that train it, as a main or a helping muscle. */
  muscle?: string | null;
  /** Only the movements at this level (the profile's "novice" reads as beginner). */
  level?: string | null;
  /** Only the movements the profile's equipment covers (a tool that stands in counts). */
  mine?: boolean;
}

export interface MovementsOptions {
  /** plan-data's ladders: the plan's own join the self-check's and the catalogue's. */
  planLadders?: unknown;
  /** The names the plan's sessions train (planNamesOf), matched to the catalogue as the engine matches names. */
  planNames?: readonly string[];
  /** Each of the plan's ladders' level now, by ladder id (planLevelsOf). */
  planLevels?: Readonly<Record<string, number>>;
  /** The profile's equipment words; null or absent: no profile, so nothing is marked and My equipment does nothing. */
  equipment?: readonly string[] | null;
}

/** An easier or harder step: the movement, and the words that find it in the search box. */
export interface MovementLink {
  id: string;
  name: string;
  search: string;
}

export interface MovementRow {
  id: string;
  name: string;
  /** Other common names for it. */
  aka: string[];
  pattern: Pattern;
  level: Level;
  levelText: string;
  /** How it is loaded, in words: "added weight", "bodyweight", "a hold for time", "cardio". */
  loadText: string;
  /** The tools it needs: "Dumbbell and bench", or "No equipment". */
  equipmentText: string;
  /** Tools that can stand in for its own ("kettlebell"), or null. */
  alsoWithText: string | null;
  /** "Quads, glutes · helps adductors", as the guide says it; "Cardio" or "Mobility" for those. */
  works: string;
  /** One side at a time. */
  oneSide: boolean;
  easier: MovementLink[];
  harder: MovementLink[];
  /** Among the movements the plan's sessions train. */
  inPlan: boolean;
  /** The profile's equipment covers it; null without an equipment list. */
  withYours: boolean | null;
  /** What it needs that the profile's equipment lacks, in words (empty when covered, or without a list). */
  needs: string[];
  guide: GuideEntry;
}

export interface MovementGroup {
  pattern: Pattern;
  title: string;
  rows: MovementRow[];
}

export interface LadderStep {
  level: number;
  name: string;
  /** The name without its note in brackets, for the step's chip (the full name is its tooltip). */
  short: string;
  /** The dose or the setup ("3 × 20–30 s"), when the ladder gives one. */
  detail: string | null;
  /** The catalogue movement done at this step (null: the name matches none), and the words that find it. */
  id: string | null;
  search: string | null;
  /** Its movement is among the plan's (on the self-check's and the catalogue's ladders). */
  inPlan: boolean;
  /** The level you are on, on the plan's own ladders. */
  now: boolean;
}

export interface LadderRow {
  /** Unique across the three sources ("plan:pushup"). */
  key: string;
  name: string;
  /** The name, or for a second ladder of the same name its range ("Push-up: wall push-up to one-arm push-up"): no two share one. */
  title: string;
  source: LadderView['source'];
  sourceText: string;
  steps: LadderStep[];
}

export interface MovementsNote {
  code: string;
  text: string;
}

export interface MovementsScreen {
  /** The query as it was used: the values the catalogue knows, the rest left out. */
  query: { text: string; pattern: Pattern | null; muscle: string | null; level: Level | null; mine: boolean };
  /** Any filter or text at work. */
  filtered: boolean;
  count: number;
  total: number;
  countText: string;
  /** By pattern; with text or a muscle the best match's group comes first, otherwise the catalogue's order. */
  groups: MovementGroup[];
  /** The plan's ladders first, then the self-check's (one the plan already holds shows once, as the plan's), then the catalogue's; filtered, only those with a step among the results. */
  ladders: LadderRow[];
  options: {
    patterns: { id: Pattern; label: string; count: number }[];
    muscles: { id: string; label: string }[];
    levels: { id: Level; label: string }[];
  };
  /** Whether the profile lists equipment (My equipment works), and its words Pahlavan doesn't know. */
  equipment: { listed: boolean; unknown: string[] };
  notes: MovementsNote[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const tool = (t: Equipment) => t.replace(/-/g, ' ');
/** A name without its note in brackets: "Inverted row (under a sturdy table)" is "Inverted row" (the search reads it the same). */
export const plainName = (name: string) => name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

const MUSCLE_WORD: ReadonlyMap<string, string> = new Map(MUSCLES.map((m) => [m.id, m.label.toLowerCase()]));
const SOURCE_TEXT: Readonly<Record<LadderView['source'], string>> = { plan: 'Your plan', engine: 'Self-check', catalogue: 'Catalogue' };
const SOURCE_ORDER: Readonly<Record<LadderView['source'], number>> = { plan: 0, engine: 1, catalogue: 2 };
const PATTERN_COUNT: ReadonlyMap<Pattern, number> = new Map(PATTERNS.map((p) => [p, CATALOGUE.filter((e) => e.pattern === p).length]));

/**
 * The names a plan's sessions train, for "in your plan": each item's name, a
 * combined line piece by piece ("Circuit: squat jump · burpee"), the guide
 * entry it names (by its other names and its parts, as the movement guide
 * finds it), and a ladder item's level now (the log's, else the plan's start,
 * else the lowest).
 */
export function planNamesOf(rawPlan: unknown, rawLog: unknown): string[] {
  const plan = isObj(rawPlan) ? rawPlan : {};
  const sessions = isObj(plan['sessions']) ? plan['sessions'] : {};
  const ladders = Array.isArray(plan['ladders']) ? plan['ladders'].filter(isObj) : [];
  const out = new Set<string>();
  const add = (name: string) => {
    out.add(name);
    const pieces = name.replace(/^[^:]*:\s*/, '').split(/\s+\+\s+|\s+·\s+/);
    if (pieces.length > 1 || pieces[0] !== name) for (const p of pieces) if (p.trim()) out.add(p.trim());
    for (const g of guideFor(rawPlan, rawLog, name)) out.add(g.title);
  };
  for (const list of Object.values(sessions)) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!isObj(item) || typeof item['name'] !== 'string') continue;
      const ladder = item['ladder'];
      if (typeof ladder !== 'string') {
        add(item['name']);
        continue;
      }
      const l = ladders.find((x) => x['id'] === ladder);
      const levels = Array.isArray(l?.['levels']) ? (l['levels'] as unknown[]) : [];
      const now = levels[ladderNow(l, rawLog, ladder).level - 1];
      if (isObj(now) && typeof now['name'] === 'string') add(now['name']);
    }
  }
  return [...out];
}

/** The level now of each of the plan's ladders, by ladder id: the log's, else the plan's start, else the lowest. */
export function planLevelsOf(rawPlan: unknown, rawLog: unknown): Record<string, number> {
  const plan = isObj(rawPlan) ? rawPlan : {};
  const ladders = Array.isArray(plan['ladders']) ? plan['ladders'].filter(isObj) : [];
  const out: Record<string, number> = {};
  for (const l of ladders) if (typeof l['id'] === 'string') out[l['id']] = ladderNow(l, rawLog, l['id']).level;
  return out;
}

/** What a movement needs that this equipment lacks: its defining tool (unless one that stands in is there), then the rest. */
function missing(v: Pick<MovementView, 'equipment' | 'alsoWith'>, have: ReadonlySet<Equipment>): Equipment[] {
  const ok = (q: Equipment) => q === 'bodyweight' || have.has(q);
  const [first, ...rest] = v.equipment;
  const out: Equipment[] = [];
  if (first && !ok(first) && !v.alsoWith.some(ok)) out.push(first);
  for (const q of rest) if (!ok(q)) out.push(q);
  return out;
}

/** "Quads, glutes · helps adductors", as the movement guide says it. */
function worksOf(v: MovementView): string {
  const list = (ids: readonly string[]) => ids.map((id) => MUSCLE_WORD.get(id) ?? id).join(', ');
  if (v.muscles.main.length) return cap(list(v.muscles.main)) + (v.muscles.helps.length ? ` · helps ${list(v.muscles.helps)}` : '');
  if (v.pattern === 'conditioning' || v.load === 'cardio') return 'Cardio';
  if (v.pattern === 'mobility') return 'Mobility';
  return v.muscles.helps.length ? cap(`helps ${list(v.muscles.helps)}`) : '';
}

/** The movement guide's entry for a catalogue movement: its own text, its muscles on the body map, a video search by its name. */
export function catalogueGuide(v: MovementView): GuideEntry {
  const main = muscleSlugs(v.muscles.main);
  return {
    title: v.name,
    unset: false,
    planStart: false,
    works: worksOf(v),
    setup: v.guide.setup || null,
    do: v.guide.do || null,
    avoid: v.guide.avoid || null,
    video: guideVideo(undefined, plainName(v.name)),
    main,
    helps: muscleSlugs(v.muscles.helps).filter((x) => !main.includes(x)),
  };
}

const linkOf = (l: { id: string; name: string }): MovementLink => ({ id: l.id, name: l.name, search: plainName(l.name) });

function rowOf(v: MovementView, plan: ReadonlySet<string>, have: ReadonlySet<Equipment> | null): MovementRow {
  const tools = v.equipment.filter((t) => t !== 'bodyweight');
  const needs = have ? missing(v, have) : [];
  return {
    id: v.id,
    name: v.name,
    aka: [...(CATALOGUE_BY_ID.get(v.id)?.aliases ?? [])],
    pattern: v.pattern,
    level: v.level,
    levelText: LEVEL_WORDS[v.level],
    loadText: LOAD_WORDS[v.load],
    equipmentText: tools.length ? cap(tools.map(tool).join(' and ')) : 'No equipment',
    alsoWithText: v.alsoWith.length ? v.alsoWith.map(tool).join(' or ') : null,
    works: worksOf(v),
    oneSide: v.unilateral,
    easier: v.easier.map(linkOf),
    harder: v.harder.map(linkOf),
    inPlan: plan.has(v.id),
    withYours: have ? usableWith(v, have) : null,
    needs: needs.map(tool),
    guide: catalogueGuide(v),
  };
}

/** A step's name inside a title: "Wall push-up" reads "wall push-up", an "L-sit" stays as it is. */
const inTitle = (name: string) => {
  const t = plainName(name);
  return /^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
};

/**
 * Every ladder once, in order, each with its own title. A self-check ladder
 * whose levels the plan's own ladder holds (the plan's ladders come from the
 * self-check's, word for word) is the same ladder: the plan's copy stays. A
 * name already taken gets the ladder's range ("Pull-up: dead hang to
 * weighted pull-up"), and the source as well in the rare case that is taken
 * too.
 */
function ladderList(views: readonly LadderView[]): (LadderView & { title: string })[] {
  const names = (l: LadderView) => new Set(l.levels.map((x) => normalizeName(x.name)));
  const plans = views.filter((l) => l.source === 'plan' && l.levels.length).map(names);
  const same = (l: LadderView) => l.source === 'engine' && plans.some((p) => [...p].every((n) => names(l).has(n)));
  const used = new Set<string>();
  return views
    .filter((l) => !same(l))
    .sort((a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source])
    .map((l) => {
      let title = l.name;
      const first = l.levels[0];
      const last = l.levels.at(-1);
      if (used.has(title.toLowerCase()) && first && last && first !== last) title = `${l.name}: ${inTitle(first.name)} to ${inTitle(last.name)}`;
      if (used.has(title.toLowerCase())) title = `${title} (${SOURCE_TEXT[l.source].toLowerCase()})`;
      used.add(title.toLowerCase());
      return { ...l, title };
    });
}

function ladderRow(l: LadderView & { title: string }, plan: ReadonlySet<string>, levels: Readonly<Record<string, number>>): LadderRow {
  // The plan's own ladder marks the level you are on; the others mark the steps your plan trains.
  const own = l.source === 'plan';
  return {
    key: `${l.source}:${l.id}`,
    name: l.name,
    title: l.title,
    source: l.source,
    sourceText: SOURCE_TEXT[l.source],
    steps: l.levels.map((x) => ({
      level: x.level,
      name: x.name,
      short: plainName(x.name),
      detail: x.detail ?? null,
      id: x.exercise,
      search: x.exerciseName ? plainName(x.exerciseName) : null,
      inPlan: !own && x.exercise !== null && plan.has(x.exercise),
      now: own && levels[l.id] === x.level,
    })),
  };
}

/**
 * The Movements tab for a query: the catalogue searched (text, pattern,
 * muscle, the profile's equipment), then held to the level asked for, in
 * groups by pattern; the ladders with a step among the results (all of them
 * with nothing asked); the filters' choices; and notes for what was left
 * out. Never throws on the query: a value the catalogue doesn't know is
 * dropped with a note.
 */
export function buildMovements(query: MovementsQuery = {}, opts: MovementsOptions = {}): MovementsScreen {
  const notes: MovementsNote[] = [];
  const text = (query.text ?? '').trim();
  let pattern: Pattern | null = null;
  if (query.pattern) {
    if ((PATTERNS as readonly string[]).includes(query.pattern)) pattern = query.pattern as Pattern;
    else notes.push({ code: 'unknown-pattern', text: `“${query.pattern}” is not a movement group Pahlavan knows, so the list shows every group.` });
  }
  let muscle: string | null = null;
  if (query.muscle) {
    muscle = muscleId(query.muscle);
    if (!muscle) notes.push({ code: 'unknown-muscle', text: `“${query.muscle}” is not a muscle Pahlavan knows, so the list shows every muscle.` });
  }
  let level: Level | null = null;
  if (query.level) {
    const l = query.level === 'novice' ? 'beginner' : query.level;
    if ((LEVELS as readonly string[]).includes(l)) level = l as Level;
    else notes.push({ code: 'unknown-level', text: `“${query.level}” is not a level, so the list shows every level.` });
  }
  const profile = opts.equipment ? normalizeEquipment(opts.equipment) : null;
  let mine = Boolean(query.mine) && profile !== null;
  if (query.mine && !profile) notes.push({ code: 'no-equipment', text: 'Your profile lists no equipment yet, so My equipment shows every movement. The coach records it at the intake.' });
  if (mine && profile!.unknown.length) notes.push({ code: 'unknown-equipment', text: `My equipment leaves out the words Pahlavan doesn’t know: ${profile!.unknown.join(', ')}.` });

  const ask = (): CatalogueQuery => ({ ...(pattern ? { pattern } : {}), ...(muscle ? { muscle } : {}), ...(mine ? { equipment: opts.equipment! } : {}), ...(text ? { query: text } : {}) });
  let found: MovementView[];
  try {
    found = searchCatalogue(ask()).movements;
  } catch (e) {
    if (!(e instanceof CatalogueQueryError)) throw e;
    // Checked above, so not expected: the words alone, rather than an error on the screen.
    notes.push({ code: 'filters-dropped', text: 'A filter could not be used, so the list shows every match for the words.' });
    pattern = muscle = level = null;
    mine = false;
    found = searchCatalogue(ask()).movements;
  }
  const shown = level ? found.filter((m) => m.level === level) : found;

  const plan = new Set((opts.planNames ?? []).map((n) => matchCatalogue(n)?.id).filter((x): x is string => Boolean(x)));
  const have = profile ? profile.equipment : null;
  const rows = shown.map((v) => rowOf(v, plan, have));
  // With text or a muscle the search's order says what fits best, so the group of the first result leads.
  const order: Pattern[] = text || muscle ? [...new Set(rows.map((r) => r.pattern))] : PATTERNS.filter((p) => rows.some((r) => r.pattern === p));
  const groups = order.map((p) => ({ pattern: p, title: PATTERN_TITLE[p] ?? p.replace(/-/g, ' '), rows: rows.filter((r) => r.pattern === p) }));

  const filtered = Boolean(text || pattern || muscle || level || mine);
  const ids = new Set(rows.map((r) => r.id));
  // Titles come from the whole list, so a ladder keeps its title whatever the search.
  const ladders = ladderList(ladderViews(opts.planLadders))
    .filter((l) => !filtered || l.levels.some((x) => x.exercise !== null && ids.has(x.exercise)))
    .map((l) => ladderRow(l, plan, opts.planLevels ?? {}));

  const total = CATALOGUE.length;
  const countText = !filtered ? `${total} movements in ${groups.length} groups` : rows.length ? `${rows.length} of ${total} movements` : 'No movement matches';
  return {
    query: { text, pattern, muscle, level, mine },
    filtered,
    count: rows.length,
    total,
    countText,
    groups,
    ladders,
    options: {
      patterns: PATTERNS.map((p) => ({ id: p, label: PATTERN_TITLE[p] ?? p, count: PATTERN_COUNT.get(p) ?? 0 })),
      muscles: MUSCLES.map((m) => ({ id: m.id, label: m.label })),
      levels: LEVELS.map((l) => ({ id: l, label: LEVEL_WORDS[l] })),
    },
    equipment: { listed: profile !== null, unknown: profile ? [...profile.unknown] : [] },
    notes,
  };
}
