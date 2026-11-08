// The plan generator's inputs and the context every step reads.

import { STARTER_CATALOGUE, type CatalogueEntry, type Equipment } from '../data/exercises.ts';
import { LOWER_BODY, MUSCLES } from '../data/muscles.ts';
import { addDays, mondayOf } from '../dates.ts';
import { activeEmphasis, appliedEmphasis, asksConfirmation, emphasisConfirmation, mayRuleOut, SELF_CHECK_FINDINGS } from '../findings.ts';
import { planDataGroups } from '../plan-data.ts';
import { explain, joinNotes, type Result } from '../reason.ts';
import type { LedgerConstraint } from '../safety.ts';
import { OVERHEAD_PRESSES, selfCheckPlan, type SelfCheckEffect, type SelfCheckPlan } from './self-check.ts';
import { overRoom, postureEmphasis, PRIORITY_ROOM, pullPushAim, weekRoom, type PullPushAim } from '../volume.ts';
import type {
  BadWeekKind,
  DailyCheckin,
  EmphasisKind,
  Exercise,
  Experience,
  Goal,
  GoalKind,
  IsoDate,
  Profile,
  ScreeningOutcome,
  Session,
  SplitKind,
  Unit,
  WeeklyCheckin,
} from '../schema.ts';

export type MacroLength = 12 | 16 | 24;

export interface PlanHistory {
  sessions: readonly Session[];
  daily?: readonly DailyCheckin[];
  weekly?: readonly WeeklyCheckin[];
  /** The plan's weekly target the history was logged against. */
  previousTarget?: { lift: number; short: number };
}

export interface PlanOptions {
  /** The plan starts on the Monday on or after this date (default: the Monday on or after today). */
  start?: IsoDate;
  weeks?: MacroLength;
  deloadEvery?: number;
  /** Active and past Ledger constraints. */
  ledger?: readonly LedgerConstraint[];
  /** Used only when the profile says the user opted in (`useHistory`). */
  history?: PlanHistory;
  /**
   * The vault's muscle overrides by catalogue id (the CLI's --vault): guide
   * entries that keep their own tags with a reason, laid over the
   * catalogue's. Given at all (even empty), the plan is fitted and checked
   * on plan-data's 14 groups, as `engine review` will count the written
   * plan, and each week's count is also given as `perWeekVault`.
   */
  muscleMap?: Readonly<Record<string, MuscleMapEntry>>;
}

/** One catalogue movement's muscles as a vault guide entry overrides them, the entry, and its reason. */
export interface MuscleMapEntry {
  guide: string;
  /** The entry's own tags; its `regions` (left out when it names none) replace the catalogue's too. */
  muscles: { main: string[]; helps: string[]; regions?: string[] };
  override: string;
}

/** Why a muscle is a priority: the profile, a lagging area, or derived from a muscle goal. */
export interface PrioritySource {
  muscle: string;
  source: 'profile' | 'lagging-area' | 'goal' | 'posture';
}

export interface PlanInput {
  profile: Profile;
  today: IsoDate;
  options?: PlanOptions;
  catalogue?: readonly CatalogueEntry[];
}

/** The goal modifier from planning.md step 1.3. */
export type Modifier = 'strength' | 'muscle' | 'health' | 'skill' | 'hybrid';
export type EquipmentMode = 'gym' | 'dumbbell' | 'machines' | 'calisthenics' | 'bodyweight';

export interface PlanContext {
  profile: Profile;
  today: IsoDate;
  start: IsoDate;
  weeks: number;
  deloadEvery: number;
  ledger: readonly LedgerConstraint[];
  catalogue: readonly CatalogueEntry[];
  byId: ReadonlyMap<string, CatalogueEntry>;
  /** Every catalogue entry as a schema exercise, for the Ledger screen. */
  exercises: Readonly<Record<string, Exercise>>;
  equipment: ReadonlySet<Equipment>;
  unknownEquipment: string[];
  equipmentMode: EquipmentMode;
  unit: Unit;
  experience: Experience;
  experienceAssumed: boolean;
  age: number | null;
  senior: boolean;
  goals: Goal[];
  primary: Goal | null;
  goalKinds: ReadonlySet<GoalKind>;
  modifier: Modifier;
  /** Body-assessment kinds the plan acts on (a row the user declined is left out), with the self-check's. */
  emphasis: ReadonlySet<EmphasisKind>;
  weakSide: 'left' | 'right' | null;
  posture: boolean;
  /** The pull-to-push ratio the plan is held to (2 to 1 only with the posture finding, at least 1 to 1 with a posture goal alone), or null. */
  pullPush: PullPushAim | null;
  priority: string[];
  likes: ReadonlySet<string>;
  dislikes: ReadonlySet<string>;
  outcome: ScreeningOutcome;
  history: PlanHistory | null;
  /** Each priority muscle with why. */
  prioritySources: Result<PrioritySource>[];
  /** How many priority muscles the week's lifting days have room for (planning.md, step 5). */
  priorityRoom: number;
  /** The self-check: ladder starts and what each result does to exercise choice. */
  selfCheck: SelfCheckPlan;
  /** Body-assessment kinds the self-check adds (an overhead reach that is not clean, heels that lift). */
  selfCheckEmphasis: ReadonlySet<EmphasisKind>;
  /** Exercise ids ruled out by the self-check or the body assessment, with why: a ladder's higher levels, and what a finding rules out once confirmed (findings.ts). */
  exclude: ReadonlyMap<string, string>;
  /** Exercise ids allowed above the training age by a self-check result, with why. */
  unlock: ReadonlyMap<string, string>;
  /** Movements at a lower level of a ladder than the user's tested level, each with the ladder's movement at that level (select.ts takes it in their place). */
  belowLevel: ReadonlyMap<string, string>;
  /** What usually happens in a bad week. */
  badWeek: ReadonlySet<BadWeekKind>;
  splitLikes: ReadonlySet<SplitKind>;
  splitDislikes: ReadonlySet<SplitKind>;
  /** The vault's muscle overrides (catalogue id to guide entry), or null without --vault. */
  muscleMap: Readonly<Record<string, MuscleMapEntry>> | null;
}

const SYNONYMS: Record<string, Equipment> = {
  bodyweight: 'bodyweight',
  dumbbell: 'dumbbell',
  dumbbells: 'dumbbell',
  barbell: 'barbell',
  'barbell and plates': 'barbell',
  cable: 'cable',
  cables: 'cable',
  'cable machine': 'cable',
  machine: 'machine',
  machines: 'machine',
  'leg press': 'machine',
  band: 'band',
  bands: 'band',
  'resistance bands': 'band',
  bench: 'bench',
  'pull-up bar': 'pull-up-bar',
  'pull-up-bar': 'pull-up-bar',
  'pullup bar': 'pull-up-bar',
  kettlebell: 'kettlebell',
  kettlebells: 'kettlebell',
  rings: 'rings',
  trx: 'rings',
  'suspension trainer': 'rings',
  'parallel bars': 'parallel-bars',
  'parallel-bars': 'parallel-bars',
  'dip station': 'parallel-bars',
  'dip bars': 'parallel-bars',
  parallettes: 'parallel-bars',
  'trap bar': 'trap-bar',
  'trap-bar': 'trap-bar',
  'hex bar': 'trap-bar',
  sled: 'sled',
  prowler: 'sled',
  'jump rope': 'jump-rope',
  'jump-rope': 'jump-rope',
  'skipping rope': 'jump-rope',
  'stability ball': 'stability-ball',
  'stability-ball': 'stability-ball',
  'swiss ball': 'stability-ball',
  'exercise ball': 'stability-ball',
  'ab wheel': 'ab-wheel',
  'ab-wheel': 'ab-wheel',
  'ab roller': 'ab-wheel',
  pool: 'pool',
  'swimming pool': 'pool',
};

/** The equipment words a profile (and `engine catalogue --equipment`) may use, each read as one of the catalogue's equipment ids. */
export const EQUIPMENT_WORDS: readonly string[] = Object.keys(SYNONYMS);

export function normalizeEquipment(items: readonly string[]): { equipment: Set<Equipment>; unknown: string[] } {
  const equipment = new Set<Equipment>(['bodyweight']);
  const unknown: string[] = [];
  for (const raw of items) {
    const tag = SYNONYMS[raw.trim().toLowerCase()];
    if (tag) equipment.add(tag);
    else unknown.push(raw);
  }
  return { equipment, unknown };
}

const MODIFIER: Record<GoalKind, Modifier> = {
  strength: 'strength',
  'fat-loss': 'muscle',
  recomposition: 'muscle',
  gain: 'muscle',
  posture: 'muscle',
  maintenance: 'muscle',
  health: 'health',
  skill: 'skill',
  conditioning: 'hybrid',
};

/** The load step for an exercise in the user's unit (planning.md step 6: steps that exist). */
export function incrementFor(entry: CatalogueEntry, unit: Unit): number {
  const tool = entry.equipment[0];
  const lower = entry.muscles.main.some((m) => LOWER_BODY.includes(m));
  if (tool === 'barbell') return unit === 'kg' ? (lower ? 5 : 2.5) : lower ? 10 : 5;
  if (tool === 'cable' || tool === 'machine') return unit === 'kg' ? 5 : 10;
  if (tool === 'kettlebell') return unit === 'kg' ? 4 : 10;
  return unit === 'kg' ? 2.5 : 5;
}

/** A catalogue entry as a schema v1 exercise. */
export function toExercise(entry: CatalogueEntry, unit: Unit): Exercise {
  const kind = entry.load === 'cardio' ? 'cardio' : entry.pattern === 'mobility' ? 'mobility' : entry.load === 'timed' ? 'timed' : 'strength';
  const ex: Exercise = { name: entry.name, pattern: entry.pattern, kind, risk: [`abdomen-${entry.iap}`], equipment: entry.equipment.join(', ') };
  if (entry.muscles.main.length || entry.muscles.helps.length) {
    ex.muscles = { main: [...entry.muscles.main], helps: [...entry.muscles.helps] };
    if (entry.regions?.length) ex.muscles.regions = [...entry.regions];
  }
  if (kind === 'strength') {
    ex.unit = unit;
    ex.increment = incrementFor(entry, unit);
  }
  return ex;
}

/** Goal kinds that make muscle a goal: priority muscles come from them when the profile sets none. */
const MUSCLE_GOALS: ReadonlySet<GoalKind> = new Set(['recomposition', 'gain']);
/** The large muscles, a lower one, then upper pull and push, for a muscle goal's derived priorities. */
const LARGE_MUSCLES = ['quads', 'lats', 'chest', 'glutes', 'hamstrings', 'upper-back'];
const POSTURE_MUSCLES = ['upper-back', 'lats'];

/**
 * Priority muscles: every one the profile lists, then lagging areas; when
 * neither sets any and a goal is about muscle, the posture emphasis's
 * muscles and then the large muscles, 3 for the first goal and 2 for a later
 * one, and no more than the week has room for (`room`: 3 with 4 or more
 * lifting days, 2 with 3, 1 with 2 or fewer or 30-minute sessions) (H). The
 * room sizes only the derived ones; more named muscles than it is a warning
 * (`priorityOverRoom`), never a drop.
 */
export function priorityRoom(profile: Profile, novice: boolean, fullOnly: boolean): number {
  const days = Math.min(profile.availability.daysPerWeek - (profile.availability.shortSessions?.days ?? 0), novice ? 4 : 6, fullOnly ? 3 : 6);
  return weekRoom(days, profile.availability.minutesPerSession);
}

/** Named priority muscles (the profile's own and lagging areas) past the lifting days' room. */
export interface PriorityOverRoom {
  /** The named priority muscles counted against the room, in the profile's order. */
  counted: string[];
  room: number;
  /** Priority muscles the plan trains on its short sessions: not counted. */
  shortSessions: string[];
}

const label = (m: string) => MUSCLES.find((x) => x.id === m)?.label ?? m;

/**
 * planning.md's room against the priority muscles the user set: the
 * effective ones (`priorityMuscles`: the profile's, the declared regions'
 * muscles and the confirmed lagging areas, the one list `check`'s
 * `priority-room` counts too). All are kept, and more of them than the
 * lifting days have room for is a warning with its reason
 * (`priority-over-room`); null when they fit (priorities derived from a goal
 * are sized to the room already, and not in the list). A priority muscle the
 * plan trains only on its short sessions (abs and obliques on a
 * cardio-and-core day) does not count against the lifting days' room
 * (`overRoom`).
 */
export function priorityOverRoom(named: readonly string[], room: number, sessions: { short: readonly string[]; lifting?: readonly string[] }, week: { liftingDays: number; minutes: number }): Result<PriorityOverRoom> | null {
  const over = overRoom(named, room, sessions.short, sessions.lifting ?? []);
  if (!over) return null;
  const { counted, onShort } = over;
  const names = (ms: readonly string[]) => ms.map(label).join(', ');
  return explain<PriorityOverRoom>({ counted, room, shortSessions: onShort }, 'plan.priority-room', { priority: named, liftingDays: week.liftingDays, minutes: week.minutes, shortSessions: onShort }, {
    title: 'Priority room',
    threshold: { room: { fourDays: PRIORITY_ROOM.fourDays, threeDays: PRIORITY_ROOM.threeDays, twoDaysOr30Min: PRIORITY_ROOM.twoDaysOr30Min } },
    note: joinNotes(
      `${counted.length} priority muscles (${names(counted)}) on ${week.liftingDays} lifting day(s) of ${week.minutes} min, where the week has room for ${room} (3 with 4 or more lifting days, 2 with 3, 1 with 2 or 30-minute sessions, heuristic): all are kept, so the lifting sessions carry more priority work and less for the rest.`,
      onShort.length > 0 && `${names(onShort)}, trained only on the short sessions, do not count against the room.`,
      onShort.length === 0 && counted.some((m) => m === 'abs' || m === 'obliques') && 'Abs and obliques trained on the short days (cardio and core) would not count against it.',
    ),
  });
}

export function priorityFor(profile: Profile, goals: readonly Goal[], posture: boolean, room = 3): Result<PrioritySource>[] {
  const out: Result<PrioritySource>[] = [];
  const has = (m: string) => out.some((x) => x.value.muscle === m);
  for (const m of profile.priorityMuscles ?? []) {
    if (!has(m)) out.push(explain<PrioritySource>({ muscle: m, source: 'profile' }, 'plan.priority', { priorityMuscles: profile.priorityMuscles }, { note: `${m}: a priority muscle in the profile.` }));
  }
  // A lagging area is a priority once the user wants it (or in a profile from before the question).
  for (const e of appliedEmphasis(profile).filter((x) => x.kind === 'lagging-area')) {
    for (const m of e.muscles ?? []) if (!has(m)) out.push(explain<PrioritySource>({ muscle: m, source: 'lagging-area' }, 'plan.priority', { area: e.area, seen: e.seen }, { note: `${m}: the body assessment saw it lag (${e.area}).` }));
  }
  const rank = goals.findIndex((g) => MUSCLE_GOALS.has(g.kind));
  if (out.length === 0 && rank >= 0) {
    const g = goals[rank]!;
    const n = Math.max(1, Math.min(room, rank === 0 ? 3 : 2));
    const goalText = `goal ${rank + 1}, "${g.label}" (${g.kind}, importance ${g.importance})`;
    if (posture) for (const m of POSTURE_MUSCLES) if (out.length < n) out.push(explain<PrioritySource>({ muscle: m, source: 'posture' }, 'plan.priority', { goal: g.id, rank: rank + 1, posture: true }, { note: `${m}: pulling muscles for the posture emphasis, a priority for ${goalText}.` }));
    for (const m of LARGE_MUSCLES) {
      if (out.length >= n) break;
      if (!has(m)) out.push(explain<PrioritySource>({ muscle: m, source: 'goal' }, 'plan.priority', { goal: g.id, rank: rank + 1 }, { note: `${m}: one of the large muscles, a priority for ${goalText}.` }));
    }
  }
  return out;
}

/**
 * With --vault, catalogue entries as Pahlavan counts them: their tags on
 * plan-data's 14 groups (planDataGroups), with the vault's overrides laid
 * over them (cardio and mobility keep their own), so the fit and every
 * volume check run on the numbers Pahlavan will show for the written plan.
 */
function withMuscleMap(catalogue: readonly CatalogueEntry[], map: Readonly<Record<string, MuscleMapEntry>> | undefined): CatalogueEntry[] {
  if (!map) return [...catalogue];
  return catalogue.map((e) => {
    if (e.load === 'cardio' || e.pattern === 'mobility') return e;
    const m = map[e.id];
    if (!m || m.muscles.main.length === 0) return { ...e, muscles: planDataGroups(e.muscles) };
    // An override counts the guide entry's own tags, its regions included (none when it names none).
    const { regions: _catalogueRegions, ...rest } = e;
    return { ...rest, muscles: { main: [...m.muscles.main], helps: [...m.muscles.helps] }, ...(m.muscles.regions?.length ? { regions: [...m.muscles.regions] } : {}) };
  });
}

/**
 * The movements a person's findings rule out, each with its reason: each
 * self-check finding's exclusions (the sit-to-stand, the hinge, the overhead
 * reach, balance) and a limited overhead range the photos showed, each only
 * when it acts in full (findings.ts: confirmed, or never asked in a profile
 * from before the question). The plan builder leaves them out, and so do the
 * plan check's region options. `effects`: the self-check's effects when the
 * caller has them (the plan builder's, with its kit); the findings' own do
 * not depend on the kit.
 */
export function findingExclusions(profile: Pick<Profile, 'selfCheck' | 'emphasis'>, effects?: readonly Result<SelfCheckEffect>[]): Map<string, string> {
  const asks = asksConfirmation(profile);
  const list = effects ?? selfCheckPlan(profile.selfCheck, { bar: false, loadedPress: false, loadedSingleLeg: false, pulldown: false }, asks).effects;
  const out = new Map<string, string>();
  for (const e of list) {
    if (!(SELF_CHECK_FINDINGS as readonly string[]).includes(e.value.input)) continue;
    for (const id of e.value.exclude ?? []) if (!out.has(id)) out.set(id, e.value.note);
  }
  for (const e of activeEmphasis(profile.emphasis)) {
    if (e.kind !== 'overhead-limited' || !mayRuleOut(emphasisConfirmation(e), asks)) continue;
    for (const id of OVERHEAD_PRESSES) if (!out.has(id)) out.set(id, `The body assessment saw a limited overhead range (${e.seen}): pure overhead pressing waits until the reach improves.`);
  }
  return out;
}

export function buildContext(input: PlanInput): PlanContext {
  const { profile, today } = input;
  const opts = input.options ?? {};
  // The generator, an optional baseline, chooses from the starter movements, so its plans stay as they were (STARTER_IDS).
  const catalogue = withMuscleMap(input.catalogue ?? STARTER_CATALOGUE, opts.muscleMap);
  // A chosen start (--start D) begins the Monday-based week holding D, as plan-data's `start` does; without one, the Monday on or after today.
  const start = opts.start ? mondayOf(opts.start) : mondayOf(addDays(today, 6));
  const { equipment, unknown } = normalizeEquipment(profile.equipment);
  const equipmentMode: EquipmentMode = equipment.has('barbell')
    ? 'gym'
    : equipment.has('dumbbell')
      ? 'dumbbell'
      : equipment.has('machine') || equipment.has('cable')
        ? 'machines'
        : equipment.has('pull-up-bar') || equipment.has('rings')
          ? 'calisthenics'
          : 'bodyweight';
  const goals = [...profile.goals].sort((a, b) => b.importance - a.importance); // stable: ties keep their order
  const primary = goals[0] ?? null;
  const fits = (e: CatalogueEntry) => e.equipment.every((q) => q === 'bodyweight' || equipment.has(q));
  // Each finding acts as the user answered it (findings.ts): a declined row is left out, and one not asked yet rules nothing out in a profile that asks.
  const asks = asksConfirmation(profile);
  const rows = activeEmphasis(profile.emphasis);
  const sc = selfCheckPlan(profile.selfCheck, {
    bar: equipment.has('pull-up-bar'),
    loadedPress: catalogue.some((e) => e.pattern === 'horizontal-push' && e.load === 'external' && fits(e)),
    loadedSingleLeg: catalogue.some((e) => e.pattern === 'lunge' && e.load === 'external' && e.unilateral && fits(e)),
    pulldown: catalogue.some((e) => e.pattern === 'vertical-pull' && e.load === 'external' && (e.equipment[0] === 'machine' || e.equipment[0] === 'cable') && fits(e)),
  }, asks);
  const selfCheckEmphasis = new Set(sc.effects.map((e) => e.value.asEmphasis).filter((k): k is EmphasisKind => k !== undefined));
  const emphasis = new Set([...rows.map((e) => e.kind).filter((k): k is EmphasisKind => k !== undefined), ...selfCheckEmphasis]);
  const goalKinds = new Set(goals.map((g) => g.kind));
  const posture = postureEmphasis(profile);
  const fullOnly = profile.screening.outcome === 'conservative' || (primary !== null && MODIFIER[primary.kind] === 'health');
  const room = priorityRoom(profile, (profile.experience ?? 'novice') === 'novice', fullOnly);
  const prioritySources = priorityFor(profile, goals, posture, room);
  // What a finding rules out, among the movements the generator chooses from (the lists also name later catalogue movements, for the plan check's options).
  const candidates = new Set(catalogue.map((e) => e.id));
  const exclude = new Map<string, string>();
  const unlock = new Map<string, string>();
  const belowLevel = new Map<string, string>();
  for (const e of sc.effects) {
    for (const id of e.value.exclude ?? []) if (!exclude.has(id) && candidates.has(id)) exclude.set(id, e.value.note);
    for (const id of e.value.unlock ?? []) if (!unlock.has(id)) unlock.set(id, e.value.note);
    for (const id of e.value.belowLevel?.ids ?? []) if (!belowLevel.has(id)) belowLevel.set(id, e.value.belowLevel!.level);
  }
  // The findings' own exclusions, a limited overhead range the photos showed among them (once the user confirms it).
  for (const [id, why] of findingExclusions(profile, sc.effects)) if (!exclude.has(id) && candidates.has(id)) exclude.set(id, why);
  const age = profile.basics?.birthYear ? Number(start.slice(0, 4)) - profile.basics.birthYear : null;
  const unit = profile.units.load;
  const exercises: Record<string, Exercise> = {};
  for (const e of catalogue) exercises[e.id] = toExercise(e, unit);
  return {
    profile,
    today,
    start,
    weeks: opts.weeks ?? 24,
    deloadEvery: opts.deloadEvery ?? 4,
    ledger: opts.ledger ?? [],
    catalogue,
    byId: new Map(catalogue.map((e) => [e.id, e])),
    exercises,
    equipment,
    unknownEquipment: unknown,
    equipmentMode,
    unit,
    experience: profile.experience ?? 'novice',
    experienceAssumed: profile.experience === undefined,
    age,
    senior: age !== null && age >= 65,
    goals,
    primary,
    goalKinds,
    modifier: primary ? MODIFIER[primary.kind] : 'health',
    emphasis,
    weakSide: rows.find((e) => e.kind === 'asymmetry')?.side ?? sc.effects.find((e) => e.value.weakSide)?.value.weakSide ?? null,
    posture,
    pullPush: pullPushAim(profile),
    priority: prioritySources.map((p) => p.value.muscle),
    likes: new Set(profile.preferences?.likes ?? []),
    dislikes: new Set(profile.preferences?.dislikes ?? []),
    outcome: profile.screening.outcome,
    history: profile.useHistory && opts.history ? opts.history : null,
    prioritySources,
    priorityRoom: room,
    selfCheck: sc,
    selfCheckEmphasis,
    exclude,
    unlock,
    belowLevel,
    badWeek: new Set(profile.badWeek?.usually ?? []),
    splitLikes: new Set(profile.preferences?.splits?.likes ?? []),
    splitDislikes: new Set(profile.preferences?.splits?.dislikes ?? []),
    muscleMap: opts.muscleMap ?? null,
  };
}

/** Patterns that count as pulling and pushing, for the posture ratio (one list, in volume.ts, for plan and review). */
export { PULL_PATTERNS, PUSH_PATTERNS } from '../volume.ts';
