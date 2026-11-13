// The eating plan's energy arithmetic, as the fitness-coach skill's diet.md
// sets it (section 3, "The numbers") and as numbers.md's Energy and protein
// snippet computed it before: resting energy by Mifflin-St Jeor, maintenance
// at the activity factor the coach chose, the goal energy (the coach's weekly
// rate; without one the goal's range: recomposition and gain by diet.md's
// offsets from maintenance, a loss from the goal's band), the safety floor
// and the 1 % a week limit, protein a meal against the day's range, and the
// fat and fiber minimums. Each returns its reason.
//
// Every figure is computed from the unrounded ones before it, as the snippet
// did, then rounded for output: whole kcal and grams with Math.round (as the
// engine's protein grams are), kg a week to 0.01, a rate to 0.0001. Python's
// format rounds an exact tie to even, so a figure ending in exactly .5 can
// differ from the snippet's by 1.
//
// Pure: the person, the trend weight, the protein range and the coach's
// choices are inputs.

import { DIET } from './diet.ts';
import type { ProteinTarget } from './protein.ts';
import { explain, type Result } from './reason.ts';
import type { EatingLevel, GoalKind, RateBand } from './schema.ts';

export type Sex = 'male' | 'female';
type Pair = [number, number];
/** One figure, or a range's two ends, lowest first. */
export type Figure = number | Pair;

export const ENERGY = {
  /** Mifflin 1990: kcal a day at rest = 10 × kg + 6.25 × cm − 5 × age + 5 (men) or − 161 (women). */
  mifflin: { perKg: 10, perCm: 6.25, perYear: -5, male: 5, female: -161 },
  /** Within ±10 % for most people, not all (Frankenfield 2005): a starting point only. */
  accuracy: 0.1,
  /** The activity factors of diet.md's table (FAO/WHO/UNU 2004): --pal takes one inside them. */
  pal: {
    min: 1.4,
    max: 2.39,
    levels: [
      { label: 'sedentary or light', range: [1.4, 1.69] },
      { label: 'active', range: [1.7, 1.99] },
      { label: 'vigorous', range: [2.0, 2.39] },
    ],
    /** A desk job plus 4 sessions a week (H). */
    desk: [1.5, 1.6],
  },
  /** About 7,700 kcal per kg of body-weight change, a rough rule (H). */
  kcalPerKg: 7700,
  /**
   * diet.md's Goal energy row (H): without a rate, recomposition eats from
   * maintenance down to 250 kcal under it, gain 200 to 300 kcal over it, in
   * kcal a day from maintenance. Every other goal sizes a loss from its band.
   */
  goalKcal: { recomposition: [-250, 0], gain: [200, 300] },
  /** Never below about this a day without a clinician (the low end of the AHA/ACC/TOS 2013 ranges). */
  floorKcal: { male: 1500, female: 1200 },
  /** Never a loss faster than this share of body weight a week: the limit the adjustment rule's "one back" uses. */
  maxLossPctPerWeek: DIET.backPctPerWeek,
  /** Protein a meal, g per kg of trend weight: about 0.4, up to 0.55 (Schoenfeld & Aragon 2018). */
  perMealGPerKg: [0.4, 0.55],
  /** Meals a day when neither the coach nor the eating plan says. */
  meals: 3,
  /** Fat: at least this share of energy (Thomas 2016), at 9 kcal a gram. */
  fat: { minShare: 0.2, kcalPerG: 9 },
  /** Fiber: about 14 g per 1,000 kcal, and at least 25 g a day (Reynolds 2019). */
  fiber: { per1000kcal: 14, minG: 25 },
} as const;

/** Where the meals a day come from: --meals, the eating plan's `habits.meals`, or the default. */
export type MealsFrom = 'flag' | 'eating plan' | 'default';

export interface EnergyInput {
  /** The profile's sex; null when it isn't given (prefer not to say): the female constants are used. */
  sex: Sex | null;
  /** Years. */
  age: number;
  heightCm: number;
  /** The trend weight in kg (review's weight.trend latest), unrounded. */
  weightKg: number;
  /** The activity factor the coach chose from diet.md's table. */
  pal: number;
  /** The weekly change the coach chose, a signed fraction of body weight (-0.0025 is -0.25 %); null: the goal's range. */
  rate: number | null;
  /**
   * The goal's weekly band as signed fractions of body weight (bandPct), with
   * where it comes from (review's goal band), the goal's kind (null: the
   * roadmap's) and whether the profile gives the goal its own band.
   */
  band: { lo: number; hi: number; source: string; goal: GoalKind | null; ownBand: boolean };
  /** The day's protein range at the same trend weight (proteinTarget's). */
  protein: Pick<ProteinTarget, 'grams' | 'gPerKg' | 'targetG'>;
  meals: number;
  mealsFrom: MealsFrom;
  /** The eating plan's level, when there is one. */
  level: EatingLevel | null;
}

export interface EnergyTarget {
  /** kcal a day: one figure for --rate, the goal's range without it; null when the rate is refused. Before the floor. */
  kcal: Figure | null;
  /** The weekly change it is for, as a fraction of body weight and in kg. */
  pctPerWeek: Figure;
  kgPerWeek: Figure;
  /** The coach's rate, the goal's offsets from maintenance (recomposition, gain), or the goal's band. */
  from: 'rate' | 'goal' | 'band';
  /** The offsets from maintenance, kcal a day, when `from` is `goal`. */
  offsetKcal: Pair | null;
  band: { lo: number; hi: number; source: string };
  /** --rate inside the goal's band (null without --rate). */
  inBand: boolean | null;
  /** The range's fast end was beyond the 1 % a week limit and starts at it. */
  clamped: boolean;
}

export interface FloorCheck {
  kcal: number;
  constants: Sex;
  /** The target (either end of a range) under the floor. */
  below: boolean;
  /** The target with the floor applied: what the plan uses. Null when the rate is refused. */
  targetKcal: Figure | null;
  /** The weekly change eating at the floor gives, when the target is under it. */
  rateAtFloor: { pctPerWeek: number; kgPerWeek: number } | null;
}

export interface MealProtein {
  /** The day's range in grams (the engine's, by goal) and per kg. */
  gPerDay: Pair;
  gPerKg: Pair;
  /** The day's floor: the protein item's target. */
  floorG: number;
  /** About 0.4 to 0.55 g/kg a meal. */
  perMealG: Pair;
  meals: number;
  mealsFrom: MealsFrom;
  /** What the meals give at 0.4 and 0.55 g/kg. */
  perMealTotal: Pair;
  /** How far the meals at 0.4 g/kg fall short of the day's floor: the top-up (a snack or shake); 0 when they reach it. */
  topUpG: number;
}

/** The fields as Coach/eating-plan.json stores them (formats.md), from these figures. */
export interface EnergyPlanFields {
  protein: { floorG: number; rangeG: Pair; gPerKg: Pair; perMealG: Pair };
  /** The figure that meets the fiber rule anywhere in the target (a range's top end). Left out when the rate is refused. */
  fiber?: { g: number; per1000kcal: number };
  /** `targetKcal` only for a range (the goal's): one rate gives one figure, and the file keeps a range. */
  energy: { maintenanceKcal: number; targetKcal?: Pair };
}

export interface EnergyEstimate {
  rmr: Result<{ kcal: number; constants: Sex }>;
  maintenanceKcal: Result<{ kcal: number; range: Pair; pal: number }>;
  target: Result<EnergyTarget>;
  refused: Result<boolean>;
  floor: Result<FloorCheck>;
  belowFloor: boolean;
  protein: Result<MealProtein>;
  fatMinG: Result<Figure | null>;
  fiberMinG: Result<Figure | null>;
  /** At the Light level only the protein and fiber figures are used; null at the other levels or without an eating plan. */
  light: Result<{ level: 'light'; use: ['protein', 'fiberMinG'] }> | null;
  eatingPlanFields: EnergyPlanFields;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const isPair = (f: Figure): f is Pair => Array.isArray(f);
const each = (f: Figure, fn: (n: number) => number): Figure => (isPair(f) ? [fn(f[0]), fn(f[1])] : fn(f));
const top = (f: Figure) => (isPair(f) ? f[1] : f);
const low = (f: Figure) => (isPair(f) ? f[0] : f);
/** 2422 → "2,422". */
export const kcalText = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const figText = (f: Figure, unit: string) => (isPair(f) ? (f[0] === f[1] ? `${kcalText(f[0])} ${unit}` : `${kcalText(f[0])} to ${kcalText(f[1])} ${unit}`) : `${kcalText(f)} ${unit}`);
const pct = (v: number) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(2)} %`;
const kg = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`;

/** A goal's band as signed fractions of body weight a week: a kg band divided by the trend weight. */
export function bandPct(band: RateBand, weightKg: number): { lo: number; hi: number } {
  const lo = band.unit === 'kg' ? band.lo / weightKg : band.lo;
  const hi = band.unit === 'kg' ? band.hi / weightKg : band.hi;
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
}

/** The activity factor inside diet.md's table. */
export const palInTable = (pal: number): boolean => Number.isFinite(pal) && pal >= ENERGY.pal.min && pal <= ENERGY.pal.max;

/** diet.md's activity-factor table in words, for a usage error. */
export const PAL_TABLE_TEXT = `${ENERGY.pal.levels.map((l) => `${l.range[0].toFixed(2)}-${l.range[1].toFixed(2)} ${l.label}`).join(', ')}; a desk job plus 4 sessions a week is about ${ENERGY.pal.desk[0]}-${ENERGY.pal.desk[1]}`;

/**
 * The energy estimate for the eating plan: resting energy, maintenance, the
 * goal energy for the rate (or the goal's range), the 1 % a week limit,
 * the floor, protein a meal, and the fat and fiber minimums, each with its
 * reason. With no sex given the female constants (−161, the 1,200 kcal
 * floor) are used, as the snippet did; the caller warns.
 */
export function energyEstimate(input: EnergyInput): EnergyEstimate {
  const { weightKg: w, pal, heightCm, age, meals } = input;
  const constants: Sex = input.sex ?? 'female';
  const m = ENERGY.mifflin;
  const noSex = input.sex === null ? ' (the female constants: no sex given)' : '';

  // Resting energy and maintenance.
  const rmrRaw = m.perKg * w + m.perCm * heightCm + m.perYear * age + m[constants];
  const rmr = explain(
    { kcal: Math.round(rmrRaw), constants },
    'energy.resting',
    { weightKg: r2(w), heightCm, age, sex: input.sex, constants },
    {
      threshold: { ...m },
      note: `Mifflin-St Jeor (Mifflin 1990): 10 × ${w.toFixed(1)} kg + 6.25 × ${heightCm} cm − 5 × ${age} years ${constants === 'male' ? '+ 5 (men)' : '− 161 (women)'}${noSex} = about ${kcalText(rmrRaw)} kcal a day at rest.`,
    },
  );
  const tdee = rmrRaw * pal;
  const range: Pair = [Math.round(tdee * (1 - ENERGY.accuracy)), Math.round(tdee * (1 + ENERGY.accuracy))];
  const level = ENERGY.pal.levels.find((l) => pal >= l.range[0] && pal <= l.range[1]);
  const maintenanceKcal = explain(
    { kcal: Math.round(tdee), range, pal },
    'energy.maintenance',
    { rmrKcal: Math.round(rmrRaw), pal },
    {
      threshold: { accuracy: ENERGY.accuracy, pal: { min: ENERGY.pal.min, max: ENERGY.pal.max } },
      note: `Resting energy × ${pal}, the activity factor${level ? ` (${level.label}, FAO/WHO/UNU 2004)` : ''}: about ${kcalText(tdee)} kcal a day. Mifflin-St Jeor is within ±10 % for most people, not all (Frankenfield 2005): ${kcalText(range[0])} to ${kcalText(range[1])}, a starting point the weight trend corrects.`,
    },
  );

  // The goal energy: the coach's rate, or the goal's range (its offsets from maintenance, else its band), the fast end no faster than the 1 % limit.
  const at = (r: number) => tdee + (r * w * ENERGY.kcalPerKg) / 7;
  const limit = ENERGY.maxLossPctPerWeek;
  const band = { lo: r4(input.band.lo), hi: r4(input.band.hi), source: input.band.source };
  const bandText = `the band of ${band.source}, ${pct(band.lo)} to ${pct(band.hi)} a week`;
  const rule = `about ${kcalText(ENERGY.kcalPerKg)} kcal per kg (a rough rule)`;
  let target: Result<EnergyTarget>;
  let refused: Result<boolean>;
  let raw: Figure | null;
  if (input.rate !== null) {
    const rate = input.rate;
    const isRefused = rate < limit;
    const inBand = rate >= input.band.lo && rate <= input.band.hi;
    raw = isRefused ? null : at(rate);
    const delta = (rate * w * ENERGY.kcalPerKg) / 7;
    target = explain(
      { kcal: raw === null ? null : Math.round(raw), pctPerWeek: rate, kgPerWeek: r2(rate * w), from: 'rate', offsetKcal: null, band, inBand, clamped: false },
      'energy.target',
      { rate, weightKg: r2(w), maintenanceKcal: Math.round(tdee) },
      {
        threshold: { kcalPerKg: ENERGY.kcalPerKg, band, maxLossPctPerWeek: limit },
        note: isRefused
          ? `${pct(rate)} a week is refused (the 1 % limit), so there is no goal energy for it.`
          : [
              `${pct(rate)} of body weight a week (${kg(rate * w)} kg) at ${rule}: about ${delta < 0 ? '' : '+'}${kcalText(delta)} kcal a day from maintenance, about ${kcalText(raw!)} kcal a day.`,
              inBand ? `Inside ${bandText}.` : `Outside ${bandText}: the coach's rate, not the goal's.`,
            ].join(' '),
      },
    );
    refused = explain(isRefused, 'energy.refused', { rate }, {
      threshold: { maxLossPctPerWeek: limit },
      note: isRefused
        ? `${pct(rate)} a week is a loss faster than 1 % of body weight a week: not allowed (diet.md's safety floors). Use ${limit} or slower.`
        : `${pct(rate)} a week is inside the limit of 1 % of body weight a week.`,
    });
  } else {
    const kind = input.band.goal;
    const offsets = !input.band.ownBand && (kind === 'recomposition' || kind === 'gain') ? ENERGY.goalKcal[kind] : null;
    // The weekly change a day's energy gives, as a fraction of body weight.
    const rateOf = (k: number) => ((k - tdee) * 7) / (ENERGY.kcalPerKg * w);
    const loRate = offsets ? rateOf(tdee + offsets[0]) : input.band.lo;
    const hiRate = offsets ? rateOf(tdee + offsets[1]) : input.band.hi;
    const clamped = loRate < limit;
    const lo = Math.max(loRate, limit);
    const hi = Math.max(hiRate, limit);
    raw = [at(lo), at(hi)];
    const offsetText = offsets ? (offsets[1] === 0 ? `maintenance to ${offsets[0]} kcal a day` : `maintenance +${offsets[0]} to +${offsets[1]} kcal a day`) : '';
    target = explain(
      { kcal: each(raw, Math.round), pctPerWeek: [r4(lo), r4(hi)], kgPerWeek: [r2(lo * w), r2(hi * w)], from: offsets ? 'goal' : 'band', offsetKcal: offsets ? [offsets[0], offsets[1]] : null, band, inBand: null, clamped },
      'energy.target',
      { band, goal: kind, ownBand: input.band.ownBand, weightKg: r2(w), maintenanceKcal: Math.round(tdee) },
      {
        threshold: { kcalPerKg: ENERGY.kcalPerKg, maxLossPctPerWeek: limit, ...(offsets ? { goalKcal: [offsets[0], offsets[1]] } : {}) },
        note: [
          offsets
            ? `${band.source[0]!.toUpperCase()}${band.source.slice(1)}: ${offsetText} (diet.md's goal energy rule, H): about ${figText(raw, 'kcal a day')}, ${kg(lo * w)} to ${kg(hi * w)} kg a week at ${rule}.`
            : `${bandText[0]!.toUpperCase()}${bandText.slice(1)} (${kg(lo * w)} to ${kg(hi * w)} kg) at ${rule}: about ${figText(raw, 'kcal a day')}.`,
          clamped ? `Its fast end, ${pct(loRate)}, is beyond 1 % of body weight a week, so the range starts at ${pct(limit)}.` : '',
        ].filter(Boolean).join(' '),
      },
    );
    const what = offsets ? "The goal's range" : 'The band';
    refused = explain(false, 'energy.refused', { band, goal: kind }, {
      threshold: { maxLossPctPerWeek: limit },
      note: clamped
        ? `${offsets ? "The goal's range reaches" : "The band's fast end is"} beyond 1 % of body weight a week: the range starts at ${pct(limit)} instead.`
        : `${what} is inside the limit of 1 % of body weight a week.`,
    });
  }

  // The floor: never under it without a clinician; under it, eat at it and lose more slowly.
  const floorKcal = ENERGY.floorKcal[constants];
  const who = constants === 'male' ? 'for men' : input.sex === null ? 'for women (no sex given, so the female floor)' : 'for women';
  const below = raw !== null && low(raw) < floorKcal;
  const afterRaw: Figure | null = raw === null ? null : each(raw, (k) => Math.max(k, floorKcal));
  const after: Figure | null = afterRaw === null ? null : each(afterRaw, Math.round);
  const atFloor = below ? ((floorKcal - tdee) * 7) / (ENERGY.kcalPerKg * w) : null;
  const rateAtFloor = atFloor === null ? null : { pctPerWeek: r4(atFloor), kgPerWeek: r2(atFloor * w) };
  const floorNote = (() => {
    const base = `Never below about ${kcalText(floorKcal)} kcal a day ${who} without a clinician (AHA/ACC/TOS 2013)`;
    if (raw === null) return `${base}: no target to hold to it, the rate is refused.`;
    if (!below) return `${base}: ${figText(each(raw, Math.round), 'kcal')} ${isPair(raw) ? 'are' : 'is'} at or above it.`;
    if (tdee <= floorKcal) return `${base}. Maintenance (about ${kcalText(tdee)} kcal) is at or under it: eat at least ${kcalText(floorKcal)} and expect no loss from food alone.`;
    const slower = `about ${pct(atFloor!)} a week at the floor`;
    if (!isPair(raw)) return `BELOW THE FLOOR: ${kcalText(raw)} kcal is under it. ${base}: use ${kcalText(floorKcal)} and a slower rate (${slower}).`;
    return top(raw) < floorKcal
      ? `BELOW THE FLOOR: both ends, ${figText(each(raw, Math.round), 'kcal')}, are under it. ${base}: use ${kcalText(floorKcal)} and a slower rate (${slower}).`
      : `The fast end, ${kcalText(raw[0])} kcal, is under the floor. ${base}: the range starts at ${kcalText(floorKcal)}, a slower rate (${slower}).`;
  })();
  const floor = explain<FloorCheck>({ kcal: floorKcal, constants, below, targetKcal: after, rateAtFloor }, 'energy.floor', { target: raw === null ? null : each(raw, Math.round), constants, sex: input.sex }, {
    threshold: { ...ENERGY.floorKcal },
    note: floorNote,
  });

  // Protein a meal against the day's range.
  const [aLo, aHi] = ENERGY.perMealGPerKg;
  const gPerDay: Pair = input.protein.grams ? [...input.protein.grams] : [0, 0];
  const floorG = input.protein.targetG ?? gPerDay[0];
  const perMealG: Pair = [Math.round(aLo * w), Math.round(aHi * w)];
  const perMealTotal: Pair = [Math.round(meals * aLo * w), Math.round(meals * aHi * w)];
  const topUpG = Math.max(0, floorG - perMealTotal[0]);
  const mealsWord = input.mealsFrom === 'flag' ? '--meals' : input.mealsFrom === 'eating plan' ? "the eating plan's" : 'the default';
  const protein = explain<MealProtein>(
    { gPerDay, gPerKg: [...input.protein.gPerKg], floorG, perMealG, meals, mealsFrom: input.mealsFrom, perMealTotal, topUpG },
    'energy.protein',
    { weightKg: r2(w), meals, mealsFrom: input.mealsFrom, gPerDay },
    {
      threshold: { perMealGPerKg: [aLo, aHi] },
      note: [
        `The day's range is the engine's, by goal: ${gPerDay[0]}-${gPerDay[1]} g (proteinRange's note).`,
        `About ${aLo} g/kg a meal, up to ${aHi} (Schoenfeld & Aragon 2018): ${perMealG[0]}-${perMealG[1]} g a meal at ${w.toFixed(1)} kg.`,
        `${meals} ${meals === 1 ? 'meal' : 'meals'} (${mealsWord}) give ${perMealTotal[0]}-${perMealTotal[1]} g${topUpG > 0 ? `, so top up about ${topUpG} g (a protein snack or shake) to reach the floor of ${floorG} g.` : `, which reaches the floor of ${floorG} g.`}`,
      ].join(' '),
    },
  );

  // Fat and fiber at the target energy, the floor applied.
  const fat = afterRaw === null ? null : each(afterRaw, (e) => Math.round((ENERGY.fat.minShare * e) / ENERGY.fat.kcalPerG));
  const fiber = afterRaw === null ? null : each(afterRaw, (e) => Math.round(Math.max(ENERGY.fiber.minG, (ENERGY.fiber.per1000kcal * e) / 1000)));
  const atE = after === null ? '' : ` at ${figText(after, 'kcal')}`;
  const fatMinG = explain(fat, 'energy.fat', { kcal: after }, {
    threshold: { ...ENERGY.fat },
    note: fat === null ? 'No goal energy (the rate is refused), so no fat minimum yet.' : `At least 20 % of energy (Thomas 2016), at 9 kcal a gram: at least ${figText(fat, 'g')} a day${atE}.`,
  });
  const fiberMinG = explain(fiber, 'energy.fiber', { kcal: after }, {
    threshold: { ...ENERGY.fiber },
    note:
      fiber === null
        ? 'No goal energy (the rate is refused), so no fiber figure yet.'
        : `About 14 g per 1,000 kcal, and at least 25 g a day (Reynolds 2019): at least ${figText(fiber, 'g')} a day${atE}.${isPair(fiber) && fiber[0] !== fiber[1] ? ` The eating plan's one figure is the top, ${fiber[1]} g, which meets the rule anywhere in the range.` : ''}`,
  });

  const light =
    input.level === 'light'
      ? explain({ level: 'light' as const, use: ['protein', 'fiberMinG'] as ['protein', 'fiberMinG'] }, 'energy.light', { level: input.level }, {
          note: 'The eating plan is at the Light level (Hand portions): nothing is counted, so only the protein and fiber figures are used; the energy figures stay the coach\'s reference, which the Food tab shows only at the Standard and Full levels.',
        })
      : null;

  const eatingPlanFields: EnergyPlanFields = {
    protein: { floorG, rangeG: gPerDay, gPerKg: [...input.protein.gPerKg], perMealG },
    ...(fiber === null ? {} : { fiber: { g: top(fiber), per1000kcal: ENERGY.fiber.per1000kcal } }),
    energy: { maintenanceKcal: Math.round(tdee), ...(after !== null && isPair(after) ? { targetKcal: after } : {}) },
  };

  return { rmr, maintenanceKcal, target, refused, floor, belowFloor: below, protein, fatMinG, fiberMinG, light, eatingPlanFields };
}

/** The constants as plain data, for `engine --version --json`'s facts (the self-check holds the docs to them). */
export function energyFacts() {
  return {
    mifflin: { ...ENERGY.mifflin },
    accuracy: ENERGY.accuracy,
    pal: { min: ENERGY.pal.min, max: ENERGY.pal.max, levels: ENERGY.pal.levels.map((l) => ({ label: l.label, range: [...l.range] })), desk: [...ENERGY.pal.desk] },
    kcalPerKg: ENERGY.kcalPerKg,
    goalKcal: { recomposition: [...ENERGY.goalKcal.recomposition], gain: [...ENERGY.goalKcal.gain] },
    floorKcal: { ...ENERGY.floorKcal },
    maxLossPctPerWeek: ENERGY.maxLossPctPerWeek,
    perMealGPerKg: [...ENERGY.perMealGPerKg],
    meals: ENERGY.meals,
    fat: { ...ENERGY.fat },
    fiber: { ...ENERGY.fiber },
  };
}
