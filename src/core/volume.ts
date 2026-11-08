// Weekly fractional sets per muscle (numbers.md, "Weekly fractional sets per
// muscle"): a set counts 1 for each `main` muscle and 0.5 for each `helps`
// muscle. Items with no muscle tags (circuits, timed work) are not counted.
// Each muscle's count is also split into its direct and indirect sets, and a
// plan's direct sets by effort: a priority muscle's minimum is met by direct
// sets taken near failure (rules.md, "Volume", and the "Muscle" row).
//
// Beside the muscles, the same pass tallies the muscle regions
// (data/regions.ts) an exercise biases, by the catalogue's region credit: 1 a
// set when the region's parent muscle is a main muscle of the exercise, 0.5
// when the parent only helps. The region tally never feeds the muscles' own
// counts; it is reported, and held to the region rules (`checkRegions`).

import { CONCURRENT } from './concurrent.ts';
import type { Pattern } from './data/exercises.ts';
import { MUSCLES } from './data/muscles.ts';
import { REGIONS, REGIONS_BY_ID, type RegionGrade } from './data/regions.ts';
import { dayText, daysBetween } from './dates.ts';
import { appliedEmphasis } from './findings.ts';
import { explain, joinNotes, type Result } from './reason.ts';
import type { Exercise, ExerciseSlot, IsoDate, Profile, SelfCheck, Session, SessionTemplate } from './schema.ts';

export const VOLUME = {
  indirect: 0.5,
  /** The snippet's tier edges: < 4, <= 10, <= 16, <= 20, above. */
  minimum: 4,
  efficientTop: 10,
  priorityTop: 16,
  highTop: 20,
  /** rules.md bands, for the reasons. */
  bands: { minimum: 4, efficient: [5, 10], priority: [10, 16], cap: [20, 24] },
  /** More direct sets than this for one muscle in one session add little. */
  perSessionDirectMax: 8,
  /** A set at this RIR or less is near failure (rules.md: 0-3 RIR for growth; the line concurrent.ts calls hard). */
  hardRir: CONCURRENT.hardRir,
  /** A hold is near failure when its prescribed top is at least this share of the tested best (H). */
  holdShare: 0.75,
} as const;

export type VolumeTier = 'below-minimum' | 'efficient' | 'priority' | 'high' | 'cap';

export function volumeTier(sets: number): VolumeTier {
  return sets < VOLUME.minimum
    ? 'below-minimum'
    : sets <= VOLUME.efficientTop
      ? 'efficient'
      : sets <= VOLUME.priorityTop
        ? 'priority'
        : sets <= VOLUME.highTop
          ? 'high'
          : 'cap';
}

type Catalogue = Readonly<Record<string, Exercise>>;

const r2 = (v: number) => Math.round(v * 100) / 100;

/** A muscle's sets by how they count: direct (a main muscle, 1 a set) and indirect (a helping muscle, 0.5 a set). Their sum is the total. */
export interface VolumeSplit {
  direct: number;
  indirect: number;
}

/** A plan's split, with its direct sets by effort: near failure (`hardDirect`) and with no effort given (`unknown`, counted as near failure). */
export interface PlannedSplit extends VolumeSplit {
  hardDirect: number;
  unknown: number;
}

/** The exercise has muscle tags, so its sets count. */
const tagged = (exercises: Catalogue, id: string) => Boolean(exercises[id]?.muscles && (exercises[id].muscles.main.length > 0 || exercises[id].muscles.helps.length > 0));

/**
 * The region credit of one exercise's tags (data/exercises.ts): each listed
 * region counts 1 a set when its parent muscle is a main muscle, 0.5 when the
 * parent only helps, and nothing when the parent is neither or the id is not
 * a modelled region. A region listed twice counts once.
 */
export function regionCredit(tags: { main: readonly string[]; helps: readonly string[]; regions?: readonly string[] } | undefined): [string, number][] {
  const out: [string, number][] = [];
  for (const id of new Set(tags?.regions ?? [])) {
    const parent = REGIONS_BY_ID.get(id)?.muscle;
    if (!parent) continue;
    if (tags!.main.includes(parent)) out.push([id, 1]);
    else if (tags!.helps.includes(parent)) out.push([id, VOLUME.indirect]);
  }
  return out;
}

/**
 * Adds one exercise's sets to the tally (and its split, and its region
 * credit to `regions`); returns false when it has no muscle tags. The region
 * tally is a separate record: the muscles' own counts never change with it.
 */
function add(tally: Record<string, number>, exercises: Catalogue, id: string, sets: number, split?: Record<string, VolumeSplit>, regions?: Record<string, VolumeSplit>): boolean {
  const ex = exercises[id];
  const m = ex?.muscles;
  if (!m || (m.main.length === 0 && m.helps.length === 0)) return Boolean(ex?.kind && ex.kind !== 'strength');
  for (const g of m.main) {
    tally[g] = (tally[g] ?? 0) + sets;
    if (split) (split[g] ??= { direct: 0, indirect: 0 }).direct += sets;
  }
  for (const g of m.helps) {
    tally[g] = (tally[g] ?? 0) + VOLUME.indirect * sets;
    if (split) (split[g] ??= { direct: 0, indirect: 0 }).indirect += VOLUME.indirect * sets;
  }
  if (regions) {
    for (const [r, w] of regionCredit(m)) {
      const o = (regions[r] ??= { direct: 0, indirect: 0 });
      if (w === 1) o.direct += sets;
      else o.indirect += w * sets;
    }
  }
  return true;
}

/**
 * Adds one done item's direct sets by effort to a tally already holding its
 * sets (`add`): near failure to `hardDirect`, of unknown effort to `unknown`,
 * for each main muscle and each region it gives full credit; an easy set adds
 * to neither.
 */
function addEffort(exercises: Catalogue, id: string, by: { hard: number; unknown: number }, split: Record<string, VolumeSplit>, regions: Record<string, VolumeSplit>): void {
  const m = exercises[id]?.muscles;
  if (!m) return;
  const put = (o: VolumeSplit & Partial<PlannedSplit>) => {
    o.hardDirect = (o.hardDirect ?? 0) + by.hard;
    o.unknown = (o.unknown ?? 0) + by.unknown;
  };
  for (const g of m.main) put(split[g]!);
  for (const [r, w] of regionCredit(m)) if (w === 1) put(regions[r]!);
}

const splitPerWeek = (o: Readonly<Record<string, VolumeSplit & Partial<PlannedSplit>>>, weeks: number): Record<string, VolumeSplit> =>
  Object.fromEntries(
    Object.entries(o).map(([g, v]) => [g, { direct: v.direct / weeks, indirect: v.indirect / weeks, ...(v.hardDirect !== undefined ? { hardDirect: v.hardDirect / weeks, unknown: (v.unknown ?? 0) / weeks } : {}) }]),
  );

export interface VolumeTally {
  from: IsoDate;
  to: IsoDate;
  weeks: number;
  /** Sessions in the range that added sets. */
  sessions: number;
  /** Some sets came from plan snapshots (Standard or Light tracking), not logged sets. */
  estimated: boolean;
  total: Record<string, number>;
  perWeek: Record<string, number>;
  /** Each muscle's weekly sets split into direct and indirect (`perWeek` is their sum). */
  split: Record<string, VolumeSplit>;
  /** Each muscle region's weekly sets by the region credit: direct (its muscle main, 1 a set) and indirect (its muscle helping, 0.5); left out when no exercise biased a region. */
  regions?: Record<string, VolumeSplit>;
  /** Exercise ids with no muscle tags that are not circuits, timed or cardio items. */
  notCounted: string[];
}

/** One done item as the effort rule reads it: the RIR logged for the set (null when none was), the snapshot's planned slot for it (null when none), and the session's date. */
export interface DoneEffortItem {
  exercise: string;
  rir: number | null;
  planned: ExerciseSlot | null;
  date: IsoDate;
}

/**
 * Done sets per muscle for sessions dated from `from` to `to`, inclusive.
 * Full tracking counts the logged sets, and a planned item with no sets of
 * its own (a superset's pair, a row left blank) at the snapshot's sets.
 * Standard and Light count the plan snapshot's sets minus skipped items, as
 * the snippet does, so they are an estimate. With `effort`, each direct set
 * is also judged (a logged set by its own RIR, a planned one by the
 * snapshot's), and `split` and `regions` carry the direct sets near failure
 * (`hardDirect`) and of unknown effort (`unknown`) as a plan's split does.
 */
export function setsPerMuscle(
  sessions: readonly Session[],
  exercises: Catalogue,
  from: IsoDate,
  to: IsoDate,
  opts: { effort?: (item: DoneEffortItem) => Effort } = {},
): Result<VolumeTally> {
  const days = daysBetween(from, to) + 1;
  if (days < 1) throw new RangeError(`empty range: ${from} to ${to}`);
  const weeks = days / 7;
  const total: Record<string, number> = {};
  const split: Record<string, VolumeSplit> = {};
  const regions: Record<string, VolumeSplit> = {};
  const missing = new Set<string>();
  let counted = 0;
  // Standard or Light sessions counted from their snapshot; Full ones that counted a planned item from it.
  let estimated = false;
  let partial = 0;
  let unusable = 0;

  for (const s of sessions) {
    if (s.date < from || s.date > to) continue;
    const skipped = new Set(s.skipped ?? []);
    const plannedOf = (id: string) => s.plan?.slots.find((x) => x.exercise === id) ?? null;
    // Each item's sets, and the RIR each logged set was logged at (null for an item counted from the snapshot).
    let items: { exercise: string; sets: number; rirs: (number | null)[] | null }[];
    const logged = (x: Session['exercises'][number]) => ({ exercise: x.exercise, sets: x.sets.length, rirs: x.sets.map((st) => st.rir ?? null) });
    const planned = (x: ExerciseSlot) => ({ exercise: x.exercise, sets: x.sets, rirs: null });
    if (s.trackingLevel === 'full' && s.exercises.length > 0) {
      items = s.exercises.map(logged);
      // The planned items the session logged no sets for, done and not skipped: their planned sets.
      const loggedIds = new Set(items.map((x) => x.exercise));
      const rest = (s.plan?.slots ?? []).filter((x) => !loggedIds.has(x.exercise) && !skipped.has(x.exercise));
      if (rest.some((x) => tagged(exercises, x.exercise))) partial++;
      items.push(...rest.map(planned));
    } else if (s.plan) {
      items = s.plan.slots.map(planned);
      estimated = true;
    } else if (s.exercises.length > 0) {
      items = s.exercises.map(logged);
      estimated = true;
    } else {
      unusable++;
      continue;
    }
    counted++;
    for (const it of items) {
      if (skipped.has(it.exercise)) continue;
      if (!add(total, exercises, it.exercise, it.sets, split, regions)) missing.add(it.exercise);
      else if (opts.effort) {
        const slot = plannedOf(it.exercise);
        const by = { hard: 0, unknown: 0 };
        const judge = (rir: number | null, sets: number) => {
          const e = opts.effort!({ exercise: it.exercise, rir, planned: slot, date: s.date });
          if (e === 'hard') by.hard += sets;
          else if (e === 'unknown') by.unknown += sets;
        };
        if (it.rirs) for (const rir of it.rirs) judge(rir, 1);
        else judge(null, it.sets);
        addEffort(exercises, it.exercise, by, split, regions);
      }
    }
  }

  const perWeek = Object.fromEntries(Object.entries(total).map(([g, v]) => [g, v / weeks]));
  return explain<VolumeTally>(
    {
      from,
      to,
      weeks,
      sessions: counted,
      estimated: estimated || partial > 0,
      total,
      perWeek,
      split: splitPerWeek(split, weeks),
      ...(Object.keys(regions).length ? { regions: splitPerWeek(regions, weeks) } : {}),
      notCounted: [...missing].sort(),
    },
    'volume.weekly',
    { from, to, days, sessionsInRange: counted + unusable },
    {
      threshold: { direct: 1, indirect: VOLUME.indirect },
      note: joinNotes(
        estimated && 'Estimated: Standard and Light sessions count the plan snapshot\'s sets minus skipped items.',
        partial > 0 && `Every set logged on ${partial} session${partial === 1 ? '' : 's'}: the sets done, and a planned item logged without sets (a superset's pair, a row left blank) at its planned sets.`,
        unusable > 0 && `${unusable} session(s) had neither logged sets nor a plan snapshot and were not counted.`,
        missing.size > 0 && `Not counted (no muscle tags): ${[...missing].sort().map((x) => exercises[x]?.name ?? x).join(', ')}.`,
      ),
    },
  );
}

// ---------------------------------------------------------------- effort

/**
 * How hard a planned set is (rules.md, "Volume": a priority muscle's minimum
 * is met by direct sets taken near failure, 0-3 RIR; Schoenfeld 2017b,
 * Refalo 2023). `unknown`: the plan gives no RIR and nothing else tells; it
 * counts as near failure, as every set did before, and is reported apart.
 */
export type Effort = 'hard' | 'easy' | 'unknown';

/** What decided a set's effort: a ladder level under the user's, the RIR written, a hold against the user's test, or nothing. */
export type EffortBy = 'ladder' | 'rir' | 'hold' | 'none';

/** The holds a test measures: the side plank, the hollow hold and the front plank. */
export type HoldKind = 'side-plank' | 'hollow' | 'plank';

const HOLD_NAMES: Readonly<Record<HoldKind, string>> = { 'side-plank': 'side plank', hollow: 'hollow hold', plank: 'plank' };

/** A tested best hold: from body-data's tests (the field) or the self-check's core hold. */
export interface HoldBest {
  seconds: number;
  date: IsoDate | null;
  source: 'tests' | 'self-check';
  field: string;
}

/** A ladder as the effort rule reads it: its levels' exercise ids, lowest first, and the user's level now (1-based). */
export interface EffortLadder {
  id: string;
  name: string;
  levels: readonly string[];
  level: number;
}

/** What the effort rule knows about the user: the tested holds and the ladder levels. */
export interface EffortContext {
  holds: Partial<Record<HoldKind, HoldBest>>;
  ladders: readonly EffortLadder[];
}

/** What a planned item says about its effort. */
export interface EffortItem {
  exercise: string;
  /** The display name, for the note. */
  name?: string;
  /** The RIR the plan wrote: the number, or the top of a range ("RIR 1–2" is 2); null when it wrote none. */
  rir: number | null;
  /** A hold (its sets are seconds, or "N × hold"): the top of its prescribed seconds (null without a time) and the kind a test measures (null for others). */
  hold?: { topS: number | null; kind: HoldKind | null } | null;
}

export interface SetEffort {
  effort: Effort;
  by: EffortBy;
  /** The hold rule's 75 % is a heuristic (H). */
  heuristic?: true;
}

/** The hold a test measures, by the exercise's id or its catalogue id: a side plank, a hollow hold or a front plank; null for any other. */
export function holdKindOf(ids: readonly (string | null | undefined)[]): HoldKind | null {
  for (const id of ids) {
    if (!id) continue;
    if (/(^|-)side-plank($|-)/.test(id)) return 'side-plank';
    if (/(^|-)hollow-hold($|-)/.test(id)) return 'hollow';
    if (id === 'plank' || /(^|-)front-plank($|-)/.test(id)) return 'plank';
  }
  return null;
}

/**
 * The user's tested best of each hold: the latest `sidePlankS` and `hollowS`
 * in the body record's tests (`tests` as review's `tests` gives them, the
 * newest of each field), and the self-check's core hold (a plank; a hollow
 * hold when it is newer than the tests' `hollowS`).
 */
export function holdBests(
  selfCheck: SelfCheck | undefined,
  tests: Readonly<Record<string, { value: number; date: IsoDate }>>,
): Partial<Record<HoldKind, HoldBest>> {
  const out: Partial<Record<HoldKind, HoldBest>> = {};
  for (const [kind, field] of [['side-plank', 'sidePlankS'], ['hollow', 'hollowS']] as const) {
    const t = tests[field];
    if (t && t.value > 0) out[kind] = { seconds: t.value, date: t.date, source: 'tests', field };
  }
  const core = selfCheck?.coreHold;
  if (core && core.seconds > 0) {
    const kind: HoldKind = core.kind === 'plank' ? 'plank' : 'hollow';
    const prior = out[kind];
    if (!prior || (prior.date ?? '') <= selfCheck.date) out[kind] = { seconds: core.seconds, date: selfCheck.date, source: 'self-check', field: 'coreHold' };
  }
  return out;
}

const pct = (v: number) => Math.round(v * 100);

/**
 * A planned set's effort, in this order: a lower level of a ladder than the
 * user's is easy (it cannot be taken near failure); the RIR the plan wrote,
 * hard at 3 or less and easy at 4 or more; a hold against the user's test of
 * that hold, hard when the prescribed top is at least 75 % of the tested
 * best (heuristic); otherwise unknown.
 */
export function setEffort(item: EffortItem, ctx: EffortContext): Result<SetEffort> {
  const name = item.name ?? item.exercise;
  const inputs: Record<string, unknown> = { exercise: item.exercise, rir: item.rir, ...(item.hold ? { hold: item.hold } : {}) };
  const threshold = { hardRir: VOLUME.hardRir, holdShare: VOLUME.holdShare };
  const out = (v: SetEffort, extra: Record<string, unknown>, note: string) => explain<SetEffort>(v, 'volume.effort', { ...inputs, ...extra }, { threshold, note });

  for (const l of ctx.ladders) {
    // The highest level the movement is done at (the engine's ladders repeat a movement across levels).
    const at = l.levels.lastIndexOf(item.exercise) + 1;
    if (at > 0 && at < l.level) {
      return out({ effort: 'easy', by: 'ladder' }, { ladder: l.id, itemLevel: at, level: l.level }, `${name}: level ${at} of the ${l.name} ladder, below your level ${l.level}, so not near failure.`);
    }
  }
  if (item.rir !== null) {
    const hard = item.rir <= VOLUME.hardRir;
    return out({ effort: hard ? 'hard' : 'easy', by: 'rir' }, {}, hard ? `${name}: RIR ${item.rir}, near failure (RIR ${VOLUME.hardRir} or less).` : `${name}: RIR ${item.rir}, not near failure (a set counts at RIR ${VOLUME.hardRir} or less).`);
  }
  const hold = item.hold;
  if (hold) {
    const best = hold.kind ? ctx.holds[hold.kind] : undefined;
    if (hold.topS !== null && best) {
      const share = hold.topS / best.seconds;
      const hard = share >= VOLUME.holdShare - 1e-9;
      const when = best.date ? ` (${dayText(best.date)})` : '';
      return out(
        { effort: hard ? 'hard' : 'easy', by: 'hold', heuristic: true },
        { best: { seconds: best.seconds, date: best.date, source: best.source, field: best.field }, share: Math.round(share * 100) / 100 },
        `${name}: ${hold.topS} s at the top is ${pct(share)} % of your tested ${best.seconds} s${when}; a hold counts as near failure at ${pct(VOLUME.holdShare)} % or more (heuristic), so this one is ${hard ? '' : 'not '}near failure.`,
      );
    }
    const missing = hold.topS === null ? 'no time for the hold' : hold.kind ? `no tested ${HOLD_NAMES[hold.kind]}` : 'no test of this hold';
    return out({ effort: 'unknown', by: 'none' }, {}, `${name}: no RIR in the plan and ${missing} to judge it by: effort unknown, counted as near failure.`);
  }
  return out({ effort: 'unknown', by: 'none' }, {}, `${name}: no RIR in the plan: effort unknown, counted as near failure.`);
}

// ---------------------------------------------------------------- planned

/** One planned slot's effort, for the reasons: its weekly sets (weighted) and what decided it. */
export interface SlotEffort {
  template: string;
  exercise: string;
  sets: number;
  effort: Effort;
  by: EffortBy;
  note: string | null;
}

export interface PlannedVolume {
  perWeek: Record<string, number>;
  /** Each muscle's weekly sets split into direct and indirect (`perWeek` is their sum), and the direct sets by effort. */
  split: Record<string, PlannedSplit>;
  /** Each muscle region's weekly sets by the region credit, its direct sets by effort as the muscles' are; left out when no slot biases a region. */
  regions?: Record<string, PlannedSplit>;
  /** Each slot with direct sets and its effort (empty without an effort rule). */
  efforts: SlotEffort[];
  /** Templates with more than 8 direct sets for one muscle. */
  overSession: { template: string; muscle: string; sets: number }[];
  notCounted: string[];
}

/**
 * Planned sets per muscle for one week's session templates. `weights` scales a
 * template's sets by its id (default 1): a rotation of 4 templates done 3 times
 * a week weighs each 0.75, as the snippet's target / types does. The per-session
 * check always uses the template's own sets. `effort` judges each slot's sets
 * (`setEffort`); without it every direct set is of unknown effort.
 */
export function plannedSetsPerMuscle(
  templates: readonly SessionTemplate[],
  exercises: Catalogue,
  opts: { weights?: Readonly<Record<string, number>>; effort?: (slot: ExerciseSlot, template: SessionTemplate) => Result<SetEffort> } = {},
): Result<PlannedVolume> {
  const perWeek: Record<string, number> = {};
  const split: Record<string, PlannedSplit> = {};
  const regions: Record<string, PlannedSplit> = {};
  const efforts: SlotEffort[] = [];
  const missing = new Set<string>();
  const overSession: PlannedVolume['overSession'] = [];
  const weights = opts.weights ?? {};
  for (const t of templates) {
    const direct: Record<string, number> = {};
    const k = weights[t.id] ?? 1;
    for (const slot of t.slots) {
      const sets = slot.sets * k;
      const main = exercises[slot.exercise]?.muscles?.main ?? [];
      const credit = regionCredit(exercises[slot.exercise]?.muscles);
      for (const g of [...main, ...(exercises[slot.exercise]?.muscles?.helps ?? [])]) split[g] ??= { direct: 0, indirect: 0, hardDirect: 0, unknown: 0 };
      for (const [r] of credit) regions[r] ??= { direct: 0, indirect: 0, hardDirect: 0, unknown: 0 };
      if (!add(perWeek, exercises, slot.exercise, sets, split, regions)) missing.add(slot.exercise);
      for (const g of main) direct[g] = (direct[g] ?? 0) + slot.sets;
      if (main.length === 0) continue;
      const e = opts.effort?.(slot, t);
      const effort: Effort = e?.value.effort ?? 'unknown';
      for (const g of main) {
        if (effort === 'hard') split[g]!.hardDirect += sets;
        else if (effort === 'unknown') split[g]!.unknown += sets;
      }
      // A region's direct sets (its muscle main) take the slot's effort, as the muscle's do.
      for (const [r, w] of credit) {
        if (w !== 1) continue;
        if (effort === 'hard') regions[r]!.hardDirect += sets;
        else if (effort === 'unknown') regions[r]!.unknown += sets;
      }
      if (e) efforts.push({ template: t.id, exercise: slot.exercise, sets: r2(sets), effort, by: e.value.by, note: e.reason.note ?? null });
    }
    for (const [g, v] of Object.entries(direct)) {
      if (v > VOLUME.perSessionDirectMax) overSession.push({ template: t.id, muscle: g, sets: v });
    }
  }
  const nameOf = (x: string) => exercises[x]?.name ?? x;
  const listed = (kind: Effort) => [...new Set(efforts.filter((e) => e.effort === kind).map((e) => nameOf(e.exercise)))].join(', ');
  return explain<PlannedVolume>(
    { perWeek, split, ...(Object.keys(regions).length ? { regions } : {}), efforts, overSession, notCounted: [...missing].sort() },
    'volume.planned',
    { templates: templates.map((t) => t.id), ...(opts.weights ? { weights } : {}) },
    {
      threshold: { direct: 1, indirect: VOLUME.indirect, perSessionDirectMax: VOLUME.perSessionDirectMax, ...(opts.effort ? { hardRir: VOLUME.hardRir, holdShare: VOLUME.holdShare } : {}) },
      note: joinNotes(
        overSession.length > 0 &&
          `More than ${VOLUME.perSessionDirectMax} direct sets for one muscle in a session: ${overSession.map((o) => `${o.template} ${o.muscle} ${o.sets}`).join(', ')}.`,
        missing.size > 0 && `Not counted (no muscle tags): ${[...missing].sort().map(nameOf).join(', ')}.`,
        efforts.some((e) => e.effort === 'easy') && `Direct sets not near failure: ${listed('easy')}.`,
        efforts.some((e) => e.effort === 'unknown') && `Direct sets of unknown effort (counted as near failure): ${listed('unknown')}.`,
      ),
    },
  );
}

export type VolumeStatus = 'ok' | 'below-minimum' | 'priority-low' | 'priority-direct-under' | 'priority-high' | 'at-cap';

export interface VolumeCheck {
  muscle: string;
  sets: number;
  tier: VolumeTier;
  priority: boolean;
  status: VolumeStatus;
  /** With a plan's split: the muscle's weekly direct and indirect sets, and its direct sets near failure and of unknown effort. */
  direct?: number;
  indirect?: number;
  hardDirect?: number;
  unknown?: number;
}

const labelOf = (muscle: string) => MUSCLES.find((m) => m.id === muscle)?.label ?? muscle;

/**
 * Each muscle's weekly sets against the bands: under 4 is below the minimum
 * dose, over 20 is at the cap, and a priority muscle under 10 is short of its
 * tier; one over 16 (the top of the priority tier) but at or under the cap is
 * above its band. `muscles` lists every muscle to report (zeros included).
 * With a plan's `split`, a priority muscle meets its minimum of 10 only from
 * direct sets near failure (an unknown effort counts): 10 or more in all with
 * fewer of those is `priority-direct-under`, before the cap.
 */
export function checkVolume(
  perWeek: Readonly<Record<string, number>>,
  opts: { muscles?: readonly string[]; priority?: readonly string[]; split?: Readonly<Record<string, PlannedSplit>> } = {},
): Result<VolumeCheck>[] {
  const muscles = opts.muscles ?? Object.keys(perWeek);
  const priority = new Set(opts.priority ?? []);
  return muscles.map((muscle) => {
    const sets = perWeek[muscle] ?? 0;
    const tier = volumeTier(sets);
    const isPriority = priority.has(muscle);
    const sp = opts.split ? (opts.split[muscle] ?? { direct: 0, indirect: 0, hardDirect: 0, unknown: 0 }) : null;
    const counted = sp ? sp.hardDirect + sp.unknown : null;
    const directUnder = isPriority && counted !== null && sets >= VOLUME.efficientTop && counted < VOLUME.efficientTop - 1e-9;
    const status: VolumeStatus =
      tier === 'below-minimum'
        ? 'below-minimum'
        : directUnder
          ? 'priority-direct-under'
          : tier === 'cap'
            ? 'at-cap'
            : isPriority && sets < VOLUME.efficientTop
              ? 'priority-low'
              : isPriority && sets > VOLUME.priorityTop
                ? 'priority-high'
                : 'ok';
    const unknown = sp && sp.unknown > 0 ? ` and ${r2(sp.unknown)} more direct of unknown effort (counted)` : '';
    const note = {
      'below-minimum': `${sets} sets a week is under 4, the minimum dose.`,
      'at-cap': `${sets} sets a week is over 20: at the cap, where returns flatten and fatigue does not.`,
      'priority-low': `${sets} sets a week is under 10 for a priority muscle (priority tier 10-16).`,
      'priority-direct-under': sp
        ? `${labelOf(muscle)}: ${r2(sets)} sets in all, ${r2(sp.hardDirect)} of them direct and near failure${unknown}; a priority muscle needs ${VOLUME.efficientTop}. Half credit from helping muscles and easy sets do not fill it.${tier === 'cap' ? ' The total is also over 20, at the cap.' : ''}`
        : undefined,
      'priority-high': `${sets} sets a week is over 16, above the priority tier (10-16), and under the cap of 20.`,
      ok: undefined,
    }[status];
    // A priority muscle with a split also says how its minimum is met.
    const minimum = sp && isPriority && status !== 'priority-direct-under' && status !== 'below-minimum'
      ? `${r2(sp.hardDirect)} of the ${r2(sets)} are direct and near failure${unknown}; the priority minimum of ${VOLUME.efficientTop} counts only those.`
      : undefined;
    const value: VolumeCheck = { muscle, sets, tier, priority: isPriority, status };
    if (sp) Object.assign(value, { direct: r2(sp.direct), indirect: r2(sp.indirect), hardDirect: r2(sp.hardDirect), unknown: r2(sp.unknown) });
    return explain<VolumeCheck>(value, 'volume.bands', { muscle, sets, priority: isPriority, ...(sp ? { direct: r2(sp.direct), hardDirect: r2(sp.hardDirect), unknown: r2(sp.unknown) } : {}) }, {
      threshold: sp ? { ...VOLUME.bands, priorityDirect: VOLUME.efficientTop, hardRir: VOLUME.hardRir } : VOLUME.bands,
      note: joinNotes(note, minimum),
    });
  });
}

// ---------------------------------------------------------------- regions

/**
 * The region rules (both heuristic, built on the regional growth studies
 * data/regions.ts cites and grades): each coverage region of a
 * priority muscle gets at least 4 direct region sets a week, and a region the
 * person declares weak at least 6 direct region sets near failure (0-3 RIR,
 * an unknown effort counted) inside its muscle's priority 10-16. Whole-muscle
 * tiers are unchanged by them.
 */
export const REGION_RULES = { coverage: 4, declared: 6 } as const;

/**
 * The regions a profile declares weak: `priorityRegions` and the `regions`
 * of its body-assessment rows that act in full (confirmed rows, or every row
 * in a profile that records no answers; an unanswered or declined row is left out).
 * Modelled region ids only, each once, in that order: a weak region is the
 * person's word, never a diagnosis.
 */
export function declaredRegions(profile: Pick<Profile, 'priorityRegions' | 'emphasis' | 'selfCheck'> | null | undefined): string[] {
  if (!profile) return [];
  const all = [...(profile.priorityRegions ?? []), ...appliedEmphasis(profile).flatMap((e) => e.regions ?? [])];
  return [...new Set(all.filter((r) => REGIONS_BY_ID.has(r)))];
}

/** The given priority muscles, then each declared region's muscle (each once). */
export function regionPriority(priority: readonly string[], declared: readonly string[]): string[] {
  return [...new Set([...priority, ...declared.map((r) => REGIONS_BY_ID.get(r)?.muscle).filter((m): m is string => Boolean(m))])];
}

/**
 * The muscles of the body assessment's lagging areas that act in full
 * (confirmed rows, or every row in a profile that records no answers, as the
 * plan generator reads them); an unanswered or declined row adds none.
 */
export function laggingMuscles(profile: Pick<Profile, 'emphasis' | 'selfCheck'> | null | undefined): string[] {
  if (!profile) return [];
  return [...new Set(appliedEmphasis(profile).filter((e) => e.kind === 'lagging-area').flatMap((e) => e.muscles ?? []))];
}

/**
 * The week's room for priority muscles (H): each takes 10-16 weekly sets, so
 * up to 2-3 fit a phase (rules.md, "Volume", the Priority row): 3 with 4 or
 * more lifting days, 2 with 3, 1 with 2 or fewer or 30-minute sessions.
 */
export const PRIORITY_ROOM = { fourDays: 3, threeDays: 2, twoDaysOr30Min: 1, shortSessionMinutes: 30 } as const;

/** The room a week of `liftingDays` lifting sessions of `minutes` has for priority muscles (PRIORITY_ROOM). */
export function weekRoom(liftingDays: number, minutes: number): number {
  if (minutes <= PRIORITY_ROOM.shortSessionMinutes || liftingDays <= 2) return PRIORITY_ROOM.twoDaysOr30Min;
  return liftingDays >= 4 ? PRIORITY_ROOM.fourDays : PRIORITY_ROOM.threeDays;
}

/**
 * The priority muscles counted against the week's room: all but those the
 * plan trains only on its short sessions (abs and obliques on a
 * cardio-and-core day use none of the lifting days' room). A muscle with
 * direct sets on a lifting day counts, whatever the short days add: one
 * push-up item on a short day does not excuse a chest priority. Null when
 * they fit. `shortSessions` and `liftingSessions` are the main muscles each
 * kind of session trains (cardio aside).
 */
export function overRoom(priority: readonly string[], room: number, shortSessions: readonly string[], liftingSessions: readonly string[] = []): { counted: string[]; onShort: string[] } | null {
  const onShort = priority.filter((m) => shortSessions.includes(m) && !liftingSessions.includes(m));
  const counted = priority.filter((m) => !onShort.includes(m));
  return counted.length > room ? { counted, onShort } : null;
}

/**
 * The effective priority muscles, the one list every count holds to the
 * priority tier (10-16, its minimum direct sets near failure) and the region
 * rules read: the profile's priority muscles (else the program's), then the
 * muscles of a lagging area the person confirmed, then the muscle of each
 * region the person declares weak. A confirmed lagging area or a declared
 * weak region makes its muscle a priority everywhere: the review's bands,
 * the plan check, Progress and Plan.
 */
export function priorityMuscles(profile: Pick<Profile, 'priorityMuscles' | 'priorityRegions' | 'emphasis' | 'selfCheck'> | null | undefined, programPriority: readonly string[] = []): string[] {
  return regionPriority([...(profile?.priorityMuscles ?? programPriority), ...laggingMuscles(profile)], declaredRegions(profile));
}

export type RegionStatus = 'ok' | 'short' | 'reported';

/** One modelled region's weekly sets against the region rules. */
export interface RegionCheck {
  id: string;
  muscle: string;
  label: string;
  grade: RegionGrade;
  /** In the coverage rule (a priority muscle's coverage region gets 4 direct sets a week). */
  coverage: boolean;
  /** A heuristic region shown as a rough guide only. */
  roughGuide: boolean;
  /** Declared weak by the person (`declaredRegions`). */
  declared: boolean;
  /** Its muscle is a priority muscle (the profile's, or a declared region's muscle). */
  priority: boolean;
  /** The plan's weekly region sets (direct plus half credit), its direct and half-credit sets, and its direct sets near failure and of unknown effort. */
  sets: number;
  direct: number;
  indirect: number;
  hardDirect: number;
  unknown: number;
  /** The week's sets done, when given. */
  done: { sets: number; direct: number; indirect: number } | null;
  /** The rule it is held to: `declared` (6 direct near failure), `coverage` (4 direct), or null (reported only). */
  rule: 'declared' | 'coverage' | null;
  min: number | null;
  /** The sets the rule counts: direct for coverage, direct near failure (unknown effort counted) for a declared region. */
  counted: number | null;
  status: RegionStatus;
}

/**
 * Every modelled region (data/regions.ts, in its order) with the plan's
 * weekly region sets against the region rules: a declared region is held to
 * 6 direct sets near failure, a coverage region of a priority muscle to 4
 * direct sets, and the rest (a muscle that is not a priority, the rough-guide
 * and heuristic regions, the upper chest) are reported only. `done` adds the
 * week's sets done to each row.
 */
export function checkRegions(
  planned: Readonly<Record<string, PlannedSplit>>,
  opts: { priority?: readonly string[]; declared?: readonly string[]; done?: Readonly<Record<string, VolumeSplit>> } = {},
): Result<RegionCheck>[] {
  const priority = new Set(opts.priority ?? []);
  const declared = new Set(opts.declared ?? []);
  return REGIONS.map((r) => {
    const p = planned[r.id] ?? { direct: 0, indirect: 0, hardDirect: 0, unknown: 0 };
    const d = opts.done ? (opts.done[r.id] ?? { direct: 0, indirect: 0 }) : null;
    const isDeclared = declared.has(r.id);
    const isPriority = priority.has(r.muscle);
    const rule: RegionCheck['rule'] = isDeclared ? 'declared' : r.coverage && isPriority ? 'coverage' : null;
    const min = rule === 'declared' ? REGION_RULES.declared : rule === 'coverage' ? REGION_RULES.coverage : null;
    const counted = rule === 'declared' ? r2(p.hardDirect + p.unknown) : rule === 'coverage' ? r2(p.direct) : null;
    const status: RegionStatus = min === null || counted === null ? 'reported' : counted < min - 1e-9 ? 'short' : 'ok';
    const muscle = labelOf(r.muscle).toLowerCase();
    const sets = `${r2(p.direct)} direct sets a week${p.indirect > 0 ? ` (and ${r2(p.indirect)} at half credit from lifts its muscle helps)` : ''}`;
    const unknown = p.unknown > 0 ? ` (${r2(p.unknown)} of unknown effort, counted)` : '';
    const note =
      rule === 'declared'
        ? `${r.label}: ${counted} direct sets near failure a week${unknown}, ${status === 'short' ? 'under' : 'at or over'} the ${REGION_RULES.declared} a declared weak region gets, inside the priority 10-16 for the ${muscle} (heuristic).`
        : rule === 'coverage'
          ? `${r.label}: ${sets}, ${status === 'short' ? 'under' : 'at or over'} the ${REGION_RULES.coverage} direct sets a priority muscle's coverage region gets (heuristic).`
          : r.roughGuide
            ? `${r.label}: ${sets}. A rough guide only, held to no minimum unless declared.`
            : !r.coverage
              ? `${r.label}: ${sets}. Not in the coverage rule (${r.grade === 'heuristic' ? 'a heuristic region' : `${r.grade} evidence`}): reported, held to ${REGION_RULES.declared} only when declared.`
              : `${r.label}: ${sets}. The ${muscle} are not a priority muscle: reported, not held to a minimum.`;
    const value: RegionCheck = {
      id: r.id,
      muscle: r.muscle,
      label: r.label,
      grade: r.grade,
      coverage: r.coverage,
      roughGuide: r.roughGuide === true,
      declared: isDeclared,
      priority: isPriority,
      sets: r2(p.direct + p.indirect),
      direct: r2(p.direct),
      indirect: r2(p.indirect),
      hardDirect: r2(p.hardDirect),
      unknown: r2(p.unknown),
      done: d ? { sets: r2(d.direct + d.indirect), direct: r2(d.direct), indirect: r2(d.indirect) } : null,
      rule,
      min,
      counted,
      status,
    };
    return explain<RegionCheck>(value, 'volume.regions', { region: r.id, muscle: r.muscle, direct: value.direct, hardDirect: value.hardDirect, unknown: value.unknown, priority: isPriority, declared: isDeclared }, {
      threshold: { coverage: REGION_RULES.coverage, declared: REGION_RULES.declared, hardRir: VOLUME.hardRir, direct: 1, indirect: VOLUME.indirect },
      note,
    });
  });
}

// ---------------------------------------------------------------- pull to push

/** Patterns that count as pulling and pushing, for the posture ratio. */
export const PULL_PATTERNS: readonly Pattern[] = ['horizontal-pull', 'vertical-pull', 'rear-delt'];
/** A chest fly pushes as a press does (the chest and front delts), so it counts on the pushing side, as a reverse fly counts on the pulling side. */
export const PUSH_PATTERNS: readonly Pattern[] = ['horizontal-push', 'vertical-push', 'chest-fly'];

/**
 * The posture ratio for a forward-head, rounded-shoulders finding in the body
 * assessment (rules.md, "Volume": upper back and lats may run to the cap to
 * keep pull at about twice push): the plan aims for 2 and its check holds at
 * least 1.8 in every loading week.
 */
export const PULL_PUSH = { target: 2, floor: 1.8 } as const;
/** A posture goal with no such finding: pull at least equal to push (rules.md), aiming a little over. */
export const PULL_PUSH_GOAL = { target: 1.2, floor: 1 } as const;

/** What the pull-to-push check holds a plan to, and why: the body assessment's finding, or a posture goal alone. */
export interface PullPushAim {
  target: number;
  floor: number;
  why: 'finding' | 'goal';
}

/** The ratio a profile's plan is held to: 2 to 1 only with the finding acting in full (confirmed, or a profile from before the question); a posture goal alone, at least 1 to 1; else none. */
export function pullPushAim(profile: Pick<Profile, 'emphasis' | 'goals' | 'selfCheck'> | null | undefined): PullPushAim | null {
  if (!profile) return null;
  if (appliedEmphasis(profile).some((e) => e.kind === 'forward-head-rounded-shoulders')) return { ...PULL_PUSH, why: 'finding' };
  if (profile.goals.some((g) => g.kind === 'posture')) return { ...PULL_PUSH_GOAL, why: 'goal' };
  return null;
}

/** The posture emphasis: a forward-head, rounded-shoulders body assessment acting in full (as `pullPushAim`), or a posture goal. */
export function postureEmphasis(profile: Pick<Profile, 'emphasis' | 'goals' | 'selfCheck'> | null | undefined): boolean {
  if (!profile) return false;
  return appliedEmphasis(profile).some((e) => e.kind === 'forward-head-rounded-shoulders') || profile.goals.some((g) => g.kind === 'posture');
}

export type PullPushStatus = 'ok' | 'below' | 'no-target' | 'no-pushing';

export interface PullPush {
  /** Weekly sets of pulling and pushing work (weighted as the planned volume is). */
  pull: number;
  push: number;
  /** pull / push to 2 decimals; null with no pushing sets. */
  ratio: number | null;
  /** The posture emphasis's aim and floor; null without the emphasis. */
  target: number | null;
  floor: number | null;
  status: PullPushStatus;
  /** Each counted exercise, its weekly sets and how it was told: its movement pattern, or its main muscles when it has none. */
  pulling: { exercise: string; sets: number; by: 'pattern' | 'muscles' }[];
  pushing: { exercise: string; sets: number; by: 'pattern' | 'muscles' }[];
}

/** Pulling or pushing: the exercise's pattern, else its main muscles on the map in use (upper back or lats pull; chest or triceps push). */
function pullOrPush(ex: Exercise | undefined): { side: 'pull' | 'push'; by: 'pattern' | 'muscles' } | null {
  if (!ex || (ex.kind && ex.kind !== 'strength' && ex.kind !== 'timed')) return null;
  if (ex.pattern) return PULL_PATTERNS.includes(ex.pattern) ? { side: 'pull', by: 'pattern' } : PUSH_PATTERNS.includes(ex.pattern) ? { side: 'push', by: 'pattern' } : null;
  const main = ex.muscles?.main ?? [];
  if (main.includes('upper-back') || main.includes('lats')) return { side: 'pull', by: 'muscles' };
  if (main.includes('chest') || main.includes('triceps')) return { side: 'push', by: 'muscles' };
  return null;
}

/**
 * Weekly pulling against pushing sets for one week's templates, weighted as
 * `plannedSetsPerMuscle` weighs them. `plan` checks its draft with it and
 * `review` reports the written plan with it, so the two count alike. The
 * ratio is held to the profile's aim (`pullPushAim`: 2 to 1 with the posture
 * finding, at least 1 to 1 with a posture goal alone); without one there is
 * no target.
 */
export function pullPushSets(
  templates: readonly SessionTemplate[],
  exercises: Catalogue,
  opts: { weights?: Readonly<Record<string, number>>; aim: PullPushAim | null },
): Result<PullPush> {
  const weights = opts.weights ?? {};
  const tally = { pull: new Map<string, { sets: number; by: 'pattern' | 'muscles' }>(), push: new Map<string, { sets: number; by: 'pattern' | 'muscles' }>() };
  for (const t of templates) {
    const k = weights[t.id] ?? 1;
    for (const s of t.slots) {
      const c = pullOrPush(exercises[s.exercise]);
      if (!c) continue;
      const m = tally[c.side];
      m.set(s.exercise, { sets: (m.get(s.exercise)?.sets ?? 0) + s.sets * k, by: c.by });
    }
  }
  const list = (m: Map<string, { sets: number; by: 'pattern' | 'muscles' }>) => [...m].map(([exercise, v]) => ({ exercise, sets: r2(v.sets), by: v.by }));
  const pulling = list(tally.pull);
  const pushing = list(tally.push);
  const rawPull = [...tally.pull.values()].reduce((a, x) => a + x.sets, 0);
  const rawPush = [...tally.push.values()].reduce((a, x) => a + x.sets, 0);
  const pull = r2(rawPull);
  const push = r2(rawPush);
  const ratio = rawPush > 0 ? r2(rawPull / rawPush) : null;
  const aim = opts.aim;
  const target = aim ? aim.target : null;
  const floor = aim ? aim.floor : null;
  const status: PullPushStatus = !aim ? 'no-target' : rawPush === 0 ? 'no-pushing' : rawPull < aim.floor * rawPush - 1e-9 ? 'below' : 'ok';
  const sets = `${pull} pulling to ${push} pushing sets a week${ratio !== null ? ` (${ratio} to 1)` : ''}`;
  const whose = aim?.why === 'finding' ? 'the posture finding' : 'the posture goal';
  const note = {
    ok: `${sets}: at or over the ${aim?.floor} ${whose} holds (it aims for about ${aim?.target} to 1).`,
    below: `${sets}: under the ${aim?.floor} ${whose} holds (it aims for about ${aim?.target} to 1). About ${Math.max(1, Math.ceil((aim?.floor ?? 0) * rawPush - rawPull - 1e-9))} more pulling set(s) a week, or fewer pushing sets, would reach it.`,
    'no-target': `${sets}. No target: the profile has no posture finding (forward head, rounded shoulders) and no posture goal.`,
    'no-pushing': `${sets}: no pushing sets, so no ratio.`,
  }[status];
  return explain<PullPush>(
    { pull, push, ratio, target, floor, status, pulling, pushing },
    'volume.pull-push',
    { pull, push, aim: aim?.why ?? null, templates: templates.map((t) => t.id), ...(opts.weights ? { weights } : {}) },
    { threshold: { target, floor, pullPatterns: PULL_PATTERNS, pushPatterns: PUSH_PATTERNS }, note },
  );
}
