// Step 1: pick the template (planning.md, 5 steps): screening, then the split
// by days and minutes, then the goal modifier, equipment and training age.

import type { Pattern } from '../data/exercises.ts';
import { explain, joinNotes, type Result } from '../reason.ts';
import type { RepRange, SessionKind } from '../schema.ts';
import type { PlanContext } from './context.ts';
import type { SplitFamily } from './families.ts';

export type Band = 'short' | 'mid' | 'long';
export type Role = 'main' | 'accessory';

export interface SlotSpec {
  pattern: Pattern;
  role: Role;
  /** Exercise ids to rank first (emphasis regressions, balance work). */
  prefer?: string[];
  /** Pick a different candidate (the second-ranked for a volume day). */
  variant?: number;
  /** Added by a modifier (skill block, posture, balance): kept when slots are trimmed for time. */
  fixed?: boolean;
  /** A lighter day's variation of a main lift: any candidate but the heavy days' main lifts in this pattern. */
  variation?: boolean;
}

export interface Blueprint {
  id: string;
  name: string;
  kind: SessionKind;
  /** Undulating days set reps differently; a light day is easier (RIR +3, or `rirAdd`) and lighter for every muscle it shares with the day before. */
  day: 'heavy' | 'volume' | 'light' | null;
  slots: SlotSpec[];
  /** Rep ranges set by the template (the four-day heavy and lighter pairs) over the goal modifier's; `linearMain` null: double progression on the main lifts. */
  reps?: { main: RepRange; accessory: RepRange; linearMain: number | null };
  /** RIR added on a light day (default DOSE.lightRirAdd). */
  rirAdd?: number;
}

export interface TemplateChoice {
  id: string;
  /** What the comparison calls it ("Full body A/B/C/D: a heavy pair and a lighter pair"). */
  label: string;
  /** rules.md's split family; heavy/light days (`heavyLight`) and the minimalist week (`minimumDose`) are flags on top. */
  family: SplitFamily;
  /** Heavier and lighter days in the week (undulation). */
  heavyLight: boolean;
  liftingDays: number;
  /** Training days beyond lifting: conditioning, mobility or skill work. */
  extraDays: number;
  minutes: number;
  band: Band;
  minimumDose: boolean;
  blueprints: Blueprint[];
  /** Week layouts in rotation (template ids per lifting day). */
  rotation: string[][];
}

const M = (pattern: Pattern, extra: Partial<SlotSpec> = {}): SlotSpec => ({ pattern, role: 'main', ...extra });
const A = (pattern: Pattern, extra: Partial<SlotSpec> = {}): SlotSpec => ({ pattern, role: 'accessory', ...extra });

const FULL_A = [M('squat'), M('horizontal-push'), A('horizontal-pull'), A('hinge'), A('core-anti-extension'), A('lateral-raise'), A('biceps'), A('calves')];
const FULL_B = [M('hinge'), M('vertical-pull'), A('vertical-push'), A('lunge'), A('core-anti-rotation'), A('rear-delt'), A('triceps'), A('core-flexion')];
const FULL_C = [M('lunge'), M('horizontal-push', { variant: 1 }), A('horizontal-pull', { variant: 1 }), A('hinge', { variant: 1 }), A('core-flexion'), A('rear-delt'), A('biceps'), A('calves')];
const FULL_ONE = [M('squat'), M('horizontal-push'), A('hinge'), A('horizontal-pull'), A('vertical-pull'), A('core-anti-extension'), A('vertical-push'), A('lunge')];
const MIN_A = [M('squat'), M('horizontal-push'), A('horizontal-pull'), A('core-anti-extension')];
const MIN_B = [M('hinge'), M('vertical-pull'), A('vertical-push'), A('lunge')];
const MIN_C = [M('lunge'), M('horizontal-push', { variant: 1 }), A('horizontal-pull', { variant: 1 }), A('core-anti-rotation')];
const UPPER_MIN = [M('horizontal-push'), M('horizontal-pull'), A('vertical-pull'), A('vertical-push')];
const LOWER_MIN = [M('squat'), M('hinge'), A('lunge'), A('core-anti-extension')];
const UPPER = [M('horizontal-push'), M('horizontal-pull'), A('vertical-push'), A('vertical-pull'), A('lateral-raise'), A('rear-delt'), A('biceps'), A('triceps')];
const LOWER = [M('squat'), M('hinge'), A('lunge'), A('hinge', { variant: 1 }), A('core-anti-extension'), A('calves'), A('core-anti-rotation'), A('core-flexion')];
const PUSH = [M('horizontal-push'), M('vertical-push'), A('horizontal-push', { variant: 1 }), A('lateral-raise'), A('core-anti-extension'), A('triceps')];
const PULL = [M('vertical-pull'), M('horizontal-pull'), A('rear-delt'), A('horizontal-pull', { variant: 1 }), A('biceps'), A('neck-upper-back')];
const LEGS = [M('squat'), M('hinge'), A('lunge'), A('core-anti-rotation'), A('hinge', { variant: 1 }), A('calves')];
// Torso/limbs (rules.md): chest, back and shoulders; legs and arms.
const TORSO = [M('horizontal-push'), M('horizontal-pull'), A('vertical-pull'), A('vertical-push'), A('rear-delt'), A('core-anti-extension'), A('lateral-raise'), A('horizontal-pull', { variant: 1 })];
const LIMBS = [M('squat'), M('hinge'), A('lunge'), A('biceps'), A('core-anti-rotation'), A('triceps'), A('calves'), A('hinge', { variant: 1 })];
// A body-part split: one or two muscle groups a day, each once a week.
const BP_CHEST = [M('horizontal-push'), A('horizontal-push', { variant: 1 }), A('vertical-push'), A('triceps'), A('core-anti-extension'), A('triceps', { variant: 1 }), A('lateral-raise'), A('core-flexion')];
const BP_BACK = [M('vertical-pull'), M('horizontal-pull'), A('horizontal-pull', { variant: 1 }), A('rear-delt'), A('biceps'), A('neck-upper-back'), A('biceps', { variant: 1 }), A('core-anti-rotation')];
const BP_LEGS = [M('squat'), M('hinge'), A('lunge'), A('hinge', { variant: 1 }), A('calves'), A('core-anti-extension'), A('squat', { variant: 1 }), A('calves', { variant: 1 })];
const BP_SHOULDERS_ARMS = [M('vertical-push'), A('lateral-raise'), A('rear-delt'), A('biceps'), A('triceps'), A('core-flexion'), A('lateral-raise', { variant: 1 }), A('core-anti-rotation')];
const BP_SHOULDERS = [M('vertical-push'), A('lateral-raise'), A('rear-delt'), A('vertical-push', { variant: 1 }), A('neck-upper-back'), A('core-flexion'), A('lateral-raise', { variant: 1 }), A('core-anti-rotation')];
const BP_ARMS = [M('biceps'), M('triceps'), A('biceps', { variant: 1 }), A('triceps', { variant: 1 }), A('core-anti-extension'), A('calves'), A('core-flexion'), A('rear-delt')];
// Four full-body days as a heavy pair and a lighter pair: each main pattern twice a week,
// heavy once and as a variation once; a lighter day follows each heavy day, so no muscle
// trains hard two days running (concurrent.ts).
const HEAVY_SQUAT = [M('squat'), M('horizontal-push'), A('horizontal-pull'), A('hinge', { variant: 1 }), A('core-anti-extension'), A('lateral-raise'), A('biceps'), A('calves')];
const HEAVY_HINGE = [M('hinge'), M('vertical-pull'), A('vertical-push'), A('lunge'), A('core-anti-rotation'), A('rear-delt'), A('triceps'), A('core-flexion')];
const LIGHT_HINGE = [M('hinge', { variation: true }), M('vertical-pull', { variation: true }), A('vertical-push', { variant: 1 }), A('lunge', { variant: 1 }), A('core-anti-extension'), A('lateral-raise'), A('triceps'), A('rear-delt')];
const LIGHT_SQUAT = [M('squat', { variation: true }), M('horizontal-push', { variation: true }), A('horizontal-pull', { variant: 1 }), A('hinge', { variant: 2 }), A('core-flexion'), A('rear-delt'), A('biceps'), A('calves')];

const bp = (id: string, name: string, slots: SlotSpec[], day: Blueprint['day'] = null): Blueprint => ({ id, name, kind: 'lift', day, slots });

/**
 * The four-day pairs' reps: heavy 5-8 and lighter 10-15 (strength: 3-6 and
 * 8-12); the lighter pair at RIR +1. Strength's lighter mains start above the
 * heavy accessories' 6-10, so the lighter day is lighter for every muscle the
 * heavy day before it trained (concurrent.ts).
 */
function pairReps(ctx: PlanContext, heavy: boolean): NonNullable<Blueprint['reps']> {
  const strength = ctx.modifier === 'strength';
  if (heavy) return { main: strength ? [3, 6] : [5, 8], accessory: strength ? [6, 10] : [8, 12], linearMain: strength ? 5 : 6 };
  return { main: strength ? [8, 12] : [10, 15], accessory: strength ? [10, 15] : [12, 15], linearMain: null };
}

type Split = Omit<TemplateChoice, 'liftingDays' | 'extraDays' | 'minutes' | 'band'> & {
  /** Fewer lifting days than the week allows (5-6 days as 4 lifting days and the rest conditioning). */
  liftDays?: number;
};

function fourDayPairs(ctx: PlanContext, minimumDose: boolean): Split {
  const heavy = (id: string, name: string, slots: SlotSpec[]): Blueprint => ({ ...bp(id, name, slots, 'heavy'), reps: pairReps(ctx, true) });
  const light = (id: string, name: string, slots: SlotSpec[]): Blueprint => ({ ...bp(id, name, slots, 'light'), reps: pairReps(ctx, false), rirAdd: 1 });
  return {
    id: minimumDose ? 'full-body-abcd-minimum' : 'full-body-abcd',
    label: 'Full body A/B/C/D: a heavy pair and a lighter pair with variations',
    family: 'full-body',
    heavyLight: true,
    minimumDose,
    // Blueprints heavy first, so the lighter days' variations leave the heavy main lifts out.
    blueprints: [heavy('heavy-squat', 'Heavy: squat and press', HEAVY_SQUAT), heavy('heavy-hinge', 'Heavy: hinge and pull', HEAVY_HINGE), light('light-hinge', 'Lighter: hinge and pull', LIGHT_HINGE), light('light-squat', 'Lighter: squat and press', LIGHT_SQUAT)],
    rotation: [['heavy-squat', 'light-hinge', 'heavy-hinge', 'light-squat']],
  };
}

/**
 * A lighter full-body day to follow a heavier day that trains the same
 * muscles: the four-day pairs' lighter squat-and-press day (10-15 reps on
 * variations, RIR +1). The upper/lower/full hybrids end on it, so no muscle
 * trains hard two days running (concurrent.ts: the second day lighter for
 * it), as the four-day pairs put it after their heavy hinge-and-pull day.
 */
function lighterFull(ctx: PlanContext, id = 'full-light'): Blueprint {
  return { ...bp(id, 'Full body (lighter)', LIGHT_SQUAT, 'light'), reps: pairReps(ctx, false), rirAdd: 1 };
}

function fourDayAb(minimumDose: boolean): Split {
  return {
    id: minimumDose ? 'full-body-ab-x2-minimum' : 'full-body-ab-x2',
    label: 'Full body A/B, each twice a week',
    family: 'full-body',
    heavyLight: false,
    minimumDose,
    blueprints: [bp('full-a', 'Full body A', minimumDose ? MIN_A : FULL_A), bp('full-b', 'Full body B', minimumDose ? MIN_B : FULL_B)],
    rotation: [['full-a', 'full-b', 'full-a', 'full-b']],
  };
}

const LABELS: Record<string, string> = {
  'full-body-minimum-x1': 'Full body once a week, minimum dose (supersets)',
  'full-body-x1': 'Full body once a week',
  'full-body-minimum-x2': 'Full body A/B, minimum dose (supersets)',
  'full-body-ab': 'Full body A/B',
  'full-body-ab-plus': 'Full body A/B with accessories',
  'full-body-same-x2': 'The same full-body session twice a week',
  'full-body-minimum-x3': 'Full body A/B/C, minimum dose (supersets)',
  'full-body-minimum-aba': 'Full body A/B/A, minimum dose (supersets)',
  'full-body-aba': 'Full body A/B/A, alternating weeks',
  'full-body-aba-plus': 'Full body A/B/A with accessories',
  'full-body-undulating': 'Full body heavy, moderate and volume days',
  'full-body-undulating-plus': 'Full body heavy, moderate and volume days with accessories',
  'upper-lower-minimum': 'Upper/lower, minimum dose',
  'upper-lower-x2': 'Upper/lower, each twice a week',
  'upper-lower-heavy-volume': 'Upper/lower, heavy and volume days',
  'upper-lower-full': 'Upper/lower plus a light full-body day',
  'push-pull-legs-x2': 'Push/pull/legs, each twice a week',
  'upper-lower-push-pull-legs': 'Upper/lower plus push/pull/legs',
  'upper-lower-x1': 'Upper/lower, each once a week',
  'upper-lower-rotating': 'Upper/lower rotating: U/L/U, then L/U/L',
  'upper-lower-full-x3': 'Upper/lower/full body',
  'push-pull-legs-x1': 'Push/pull/legs, each once a week',
  'torso-limbs-x2': 'Torso/limbs, each twice a week',
  'upper-lower-full-x4': 'Upper/lower plus a full-body pair, the second lighter',
  'upper-lower-full-x5': 'Upper/lower twice plus a lighter full-body day',
  'body-part-x4': 'Body-part split: chest, back, legs, shoulders and arms',
  'body-part-x5': 'Body-part split: chest, back, legs, shoulders, arms',
};

/**
 * The templates to compare for a number of lifting days and a session
 * length: planning.md's split table first (its default), then the nearest
 * options (for 4 days: full body A/B twice and A/B/C/D too), then the other
 * families of rules.md's catalogue that fit the days (torso/limbs, the
 * upper/lower/full hybrids, push/pull/legs, body-part splits, upper/lower
 * at 2-3 days). Short sessions keep the minimum-dose templates.
 */
function candidates(days: number, band: Band, ctx: PlanContext): Split[] {
  const adv = ctx.experience === 'advanced';
  const nov = ctx.experience === 'novice';
  const full = (id: string, bps: Blueprint[], rotation: string[][], minimumDose = false, heavyLight = false): Split => ({ id, label: LABELS[id] ?? id, family: 'full-body', heavyLight, minimumDose, blueprints: bps, rotation });
  const split = (id: string, family: SplitFamily, bps: Blueprint[], rotation: string[][], extra: Partial<Split> = {}): Split => ({ id, label: LABELS[id] ?? id, family, heavyLight: false, minimumDose: false, blueprints: bps, rotation, ...extra });
  const upper = () => bp('upper', 'Upper', UPPER);
  const lower = () => bp('lower', 'Lower', LOWER);
  const ulX1 = () => split('upper-lower-x1', 'upper-lower', [upper(), lower()], [['upper', 'lower']]);
  const ulRotating = () => split('upper-lower-rotating', 'upper-lower', [upper(), lower()], [['upper', 'lower', 'upper'], ['lower', 'upper', 'lower']]);
  const ulfX3 = () => split('upper-lower-full-x3', 'upper-lower-full', [upper(), lower(), bp('full', 'Full body', FULL_A)], [['upper', 'lower', 'full']]);
  const pplX1 = () => split('push-pull-legs-x1', 'push-pull-legs', [bp('push', 'Push', PUSH), bp('pull', 'Pull', PULL), bp('legs', 'Legs', LEGS)], [['push', 'pull', 'legs']]);
  const pplX2 = () => split('push-pull-legs-x2', 'push-pull-legs', [bp('push', 'Push', PUSH), bp('pull', 'Pull', PULL), bp('legs', 'Legs', LEGS)], [['push', 'pull', 'legs', 'push', 'pull', 'legs']]);
  const ulPpl = () => split('upper-lower-push-pull-legs', 'push-pull-legs', [upper(), lower(), bp('push', 'Push', PUSH), bp('pull', 'Pull', PULL), bp('legs', 'Legs', LEGS)], [['upper', 'lower', 'push', 'pull', 'legs']]);
  const torsoLimbs = () => split('torso-limbs-x2', 'torso-limbs', [bp('torso', 'Torso', TORSO), bp('limbs', 'Limbs', LIMBS)], [['torso', 'limbs', 'torso', 'limbs']]);
  // Upper and lower first, then a full-body day (hinge and pull) and the lighter squat-and-press day after it.
  const ulfX4 = () => split('upper-lower-full-x4', 'upper-lower-full', [upper(), lower(), bp('full', 'Full body', HEAVY_HINGE), lighterFull(ctx)], [['upper', 'lower', 'full', 'full-light']]);
  // Upper/lower twice, then the lighter full-body day after the second lower day.
  const ulfX5 = () => split('upper-lower-full-x5', 'upper-lower-full', [upper(), lower(), lighterFull(ctx)], [['upper', 'lower', 'upper', 'lower', 'full-light']]);
  const bpX4 = () => split('body-part-x4', 'body-part', [bp('chest', 'Chest and triceps', BP_CHEST), bp('back', 'Back and biceps', BP_BACK), bp('legs', 'Legs', BP_LEGS), bp('shoulders-arms', 'Shoulders and arms', BP_SHOULDERS_ARMS)], [['chest', 'back', 'legs', 'shoulders-arms']]);
  const bpX5 = (liftDays?: number) => split('body-part-x5', 'body-part', [bp('chest', 'Chest', BP_CHEST), bp('back', 'Back', BP_BACK), bp('legs', 'Legs', BP_LEGS), bp('shoulders', 'Shoulders', BP_SHOULDERS), bp('arms', 'Arms', BP_ARMS)], [['chest', 'back', 'legs', 'shoulders', 'arms']], liftDays ? { liftDays } : {});
  const minX1 = () => full('full-body-minimum-x1', [bp('min-a', 'Full body', MIN_A)], [['min-a']], true);
  const x1 = () => full('full-body-x1', [bp('full', 'Full body', FULL_ONE)], [['full']]);
  if (days <= 1) return band === 'short' ? [minX1(), x1()] : [x1(), minX1()];
  const minX2 = () => full('full-body-minimum-x2', [bp('min-a', 'Full body A', MIN_A), bp('min-b', 'Full body B', MIN_B)], [['min-a', 'min-b']], true);
  const ab = (id: string) => full(id, [bp('full-a', 'Full body A', FULL_A), bp('full-b', 'Full body B', FULL_B)], [['full-a', 'full-b']]);
  if (days === 2) {
    if (band === 'short') return [minX2(), ab('full-body-ab')];
    if (band === 'mid') return [ab('full-body-ab'), minX2(), ulX1()];
    return [ab('full-body-ab-plus'), full('full-body-same-x2', [bp('full', 'Full body', FULL_ONE)], [['full', 'full']]), ulX1()];
  }
  if (days === 3) {
    const minX3 = () => full('full-body-minimum-x3', [bp('min-a', 'Full body A', MIN_A), bp('min-b', 'Full body B', MIN_B), bp('min-c', 'Full body C', MIN_C)], [['min-a', 'min-b', 'min-c']], true);
    const minAba = () => full('full-body-minimum-aba', [bp('min-a', 'Full body A', MIN_A), bp('min-b', 'Full body B', MIN_B)], [['min-a', 'min-b', 'min-a'], ['min-b', 'min-a', 'min-b']], true);
    const aba = (id: string) => full(id, [bp('full-a', 'Full body A', FULL_A), bp('full-b', 'Full body B', FULL_B)], [['full-a', 'full-b', 'full-a'], ['full-b', 'full-a', 'full-b']]);
    const und = (id: string) => full(id, [bp('heavy', 'Heavy day', FULL_A, 'heavy'), bp('moderate', 'Moderate day', FULL_B), bp('volume', 'Volume day', FULL_C, 'volume')], [['heavy', 'moderate', 'volume']], false, true);
    if (band === 'short') return [minX3(), minAba()];
    const others = [ulfX3(), pplX1(), ulRotating()];
    if (band === 'mid') return nov ? [aba('full-body-aba'), und('full-body-undulating'), ...others] : [und('full-body-undulating'), aba('full-body-aba'), ...others];
    return [und('full-body-undulating-plus'), aba('full-body-aba-plus'), ...others];
  }
  const ul = (id: string, minimumDose = false): Split => split(id, 'upper-lower', [bp('upper', 'Upper', minimumDose ? UPPER_MIN : UPPER), bp('lower', 'Lower', minimumDose ? LOWER_MIN : LOWER)], [['upper', 'lower', 'upper', 'lower']], { minimumDose });
  const ulHeavyVolume = (): Split => ({
    id: 'upper-lower-heavy-volume',
    label: LABELS['upper-lower-heavy-volume']!,
    family: 'upper-lower',
    heavyLight: true,
    minimumDose: false,
    blueprints: [bp('upper-heavy', 'Upper, heavy', UPPER, 'heavy'), bp('lower-heavy', 'Lower, heavy', LOWER, 'heavy'), bp('upper-volume', 'Upper, volume', UPPER.map((x) => ({ ...x, variant: 1 })), 'volume'), bp('lower-volume', 'Lower, volume', LOWER.map((x) => ({ ...x, variant: 1 })), 'volume')],
    rotation: [['upper-heavy', 'lower-heavy', 'upper-volume', 'lower-volume']],
  });
  const fourDay = (): Split[] => {
    if (band === 'short') return [ul('upper-lower-minimum', true), fourDayPairs(ctx, true)];
    return [band === 'mid' ? ul('upper-lower-x2') : ulHeavyVolume(), fourDayAb(false), fourDayPairs(ctx, false), torsoLimbs(), ulfX4(), bpX4()];
  };
  if (days === 4) return fourDay();
  // 5-6 days: the table's split, then 4 lifting days with the rest as conditioning, then the other families.
  const four: Split = { ...fourDay()[0]!, liftDays: 4 };
  if (band === 'short') {
    const layout = days === 5 ? ['upper', 'lower', 'full', 'upper', 'lower'] : ['upper', 'lower', 'full', 'upper', 'lower', 'full'];
    return [split('upper-lower-full', 'upper-lower-full', [bp('upper', 'Upper', UPPER_MIN), bp('lower', 'Lower', LOWER_MIN), bp('full', 'Full body (light)', MIN_A.map((x) => ({ ...x, role: 'accessory' as const })), 'light')], [layout], { minimumDose: true }), four];
  }
  if (days === 5) return [ulPpl(), four, ulfX5(), bpX5()];
  // Six days: push/pull/legs twice for a trained lifter (rules.md: trained, time-rich), first for the advanced.
  return adv ? [pplX2(), four, ulPpl(), bpX5(5)] : [ulPpl(), four, pplX2(), bpX5(5)];
}

/** Slots per session by minutes; modifier slots come on top and are kept when time is short. */
export function slotCount(minutes: number): number {
  return minutes <= 30 ? 4 : minutes <= 45 ? 5 : minutes <= 60 ? 6 : minutes <= 75 ? 7 : 8;
}

const OVERHEAD_FREE = ['landmine-press', 'incline-db-press', 'incline-push-up'];

/** Applies the emphasis, posture, skill and age adjustments to a blueprint's slots. */
function adjust(ctx: PlanContext, b: Blueprint, count: number, index: number, liftingDays: number): Blueprint {
  let slots = b.slots.slice(0, count).map((s) => ({ ...s }));
  const prefer = (pattern: Pattern, ids: string[]) => {
    for (const s of slots) if (s.pattern === pattern) s.prefer = [...ids, ...(s.prefer ?? [])];
  };
  if (ctx.emphasis.has('squat-heels-lift')) prefer('squat', ['heel-elevated-goblet-squat', 'box-squat']);
  if (ctx.emphasis.has('knees-in')) {
    prefer('squat', ['tempo-goblet-squat']);
    prefer('lunge', ['db-split-squat', 'split-squat']);
  }
  if (ctx.emphasis.has('overhead-limited')) prefer('vertical-push', OVERHEAD_FREE);
  if (ctx.emphasis.has('low-back-arch')) {
    prefer('core-anti-extension', ['dead-bug', 'hollow-hold']);
    for (const s of slots) if (s.pattern === 'hinge' && s.role === 'accessory') s.prefer = ['glute-bridge', 'hip-thrust', 'single-leg-glute-bridge'];
  }
  // The self-check last, so its results rank first: a tested ladder level, a regression the tests asked for.
  for (const e of [...ctx.selfCheck.effects].reverse()) {
    const pr = e.value.prefer;
    if (pr) for (const pattern of pr.patterns) prefer(pattern, pr.ids);
  }
  const add = (s: SlotSpec) => {
    slots = [...slots, { ...s, fixed: true }];
  };
  // A self-check second slot (a pull-up regression) beside each main lift of its pattern.
  for (const e of ctx.selfCheck.effects) {
    const sec = e.value.secondary;
    if (sec && slots.some((x) => x.role === 'main' && x.pattern === sec.pattern)) add(A(sec.pattern, { prefer: [sec.id] }));
  }
  // Posture: rear-delt or face-pull work in every session (planning.md); at 5-6 lifting
  // days only in sessions with no pulling of their own, to stay under 20 sets of upper back.
  const pulls = (p: Pattern) => (liftingDays > 4 ? ['rear-delt', 'horizontal-pull', 'vertical-pull'] : ['rear-delt']).includes(p);
  if (ctx.posture && !slots.some((s) => pulls(s.pattern))) add(A('rear-delt'));
  if (ctx.senior && b.kind === 'lift') add(A('lunge', { prefer: ['single-leg-stance'] }));
  if (ctx.modifier === 'skill') slots = [{ ...A('skill', { variant: index }), fixed: true }, ...slots];
  return { ...b, slots };
}

/**
 * The templates to compare (planning.md's table first, then the nearest
 * options), each with the shared notes: screening, the goal modifier, the
 * equipment and the training age. The comparison (compare.ts) picks one.
 */
export function templateCandidates(ctx: PlanContext, days: number, minutes: number, maxLifting = days): Result<TemplateChoice>[] {
  const band: Band = minutes <= 30 ? 'short' : minutes <= 60 ? 'mid' : 'long';
  const notes: string[] = [];
  let lifting = Math.min(days, 6, Math.max(1, maxLifting));
  if (lifting < Math.min(days, 6)) notes.push(`Lifting on the ${lifting} long day(s); the short days carry conditioning.`);
  const fullOnly = ctx.outcome === 'conservative' || ctx.modifier === 'health';
  if (ctx.outcome === 'conservative') {
    lifting = Math.min(lifting, 3);
    notes.push('Screening is Conservative: full body only, at most 3 lifting days.');
  } else if (ctx.outcome === 'go-ramped') notes.push('Screening is Go, ramped: the first mesocycle at RIR 3 or more.');
  if (ctx.modifier === 'health') {
    lifting = Math.min(lifting, 3);
    notes.push('Health and longevity: 2-3 full-body days plus 150-300 active minutes.');
  }
  if (ctx.experience === 'novice' && lifting > 4) {
    lifting = 4;
    notes.push('Novices get at most 4 lifting days; the rest become conditioning or mobility.');
  }
  const modifierNote = {
    strength: 'Goal modifier: strength (3-6 reps on the main lifts).',
    muscle: `Goal modifier: muscle (6-15 reps)${ctx.goalKinds.has('fat-loss') ? ', plus a step target for fat loss' : ''}.`,
    health: 'Goal modifier: health (full body, active minutes, steps).',
    skill: 'Goal modifier: calisthenics skills (a skill block each session, leverage ladders).',
    hybrid: 'Goal modifier: hybrid endurance (4-8 sets per muscle, heavy legs away from key runs).',
  }[ctx.modifier];
  const equipmentNote = {
    gym: ctx.experience === 'novice' ? 'Equipment: a full gym (barbell linear progression for novices).' : 'Equipment: a full gym.',
    dumbbell: 'Equipment: dumbbells (double progression; unilateral when the heaviest gets light).',
    machines: 'Equipment: machines and cables.',
    calisthenics: 'Equipment: bodyweight with a bar or rings (progress by leverage, range, tempo and reps).',
    bodyweight: 'Equipment: bodyweight only (progress by leverage, range, tempo and reps).',
  }[ctx.equipmentMode];
  const ageNote = ctx.senior ? `Age ${ctx.age}: start around RPE 5-6 (RIR 4 or more for the first phase), balance work every session, fast lifting from week 9.` : null;
  const list = candidates(fullOnly ? Math.min(lifting, 3) : lifting, band, ctx).filter((c) => !fullOnly || c.family === 'full-body');
  return list.map((c, i) => {
    const liftingDays = Math.min(lifting, c.liftDays ?? lifting);
    const count = c.minimumDose ? 4 : slotCount(minutes);
    const blueprints = c.blueprints.map((b, j) => adjust(ctx, b, count, j, liftingDays));
    const { liftDays: _drop, ...rest } = c;
    return explain<TemplateChoice>(
      { ...rest, blueprints, liftingDays, extraDays: Math.max(0, days - liftingDays), minutes, band },
      'plan.template',
      { days, minutes, band, outcome: ctx.outcome, modifier: ctx.modifier, equipmentMode: ctx.equipmentMode, experience: ctx.experience, age: ctx.age, candidate: i + 1 },
      {
        note: joinNotes(
          ...notes,
          i === 0 ? `Split: ${liftingDays} day(s) x ${minutes} min (${band}) gives ${c.id} in planning.md's table.` : `Split: ${c.id} (${c.label}), the option nearest the table's for ${liftingDays} day(s) x ${minutes} min.`,
          modifierNote,
          equipmentNote,
          `Training age: ${ctx.experience}${ctx.experienceAssumed ? ' (assumed: not in the profile)' : ''}.`,
          ageNote,
        ),
      },
    );
  });
}

/** planning.md's table's template (the first candidate). */
export function chooseTemplate(ctx: PlanContext, days: number, minutes: number, maxLifting = days): Result<TemplateChoice> {
  return templateCandidates(ctx, days, minutes, maxLifting)[0]!;
}
