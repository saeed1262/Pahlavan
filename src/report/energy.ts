// `engine energy`'s report: the eating plan's numbers for the diet job.
// From the vault: the profile's basics (birth year, height, sex) and goals,
// the weigh-ins from the cycle start (the trend weight, as review reads it),
// the eating plan's level and meals a day when there is one. From the coach:
// the activity factor, and the weekly rate when it isn't the goal's band.
// Pure: the vault as read, the date and the coach's choices are inputs.

import type { VaultWarning } from '../adapters/vault/convert.ts';
import { paths } from '../adapters/vault/layout.ts';
import type { VaultRead } from '../adapters/vault/read.ts';
import { bandPct, ENERGY, energyEstimate, type MealsFrom } from '../core/energy.ts';
import { ageOn, proteinForProfile } from '../core/protein.ts';
import type { IsoDate } from '../core/schema.ts';
import { weightTrend } from '../core/weight.ts';
import { goalBandOf } from './review.ts';

export interface EnergyOptions {
  /** The activity factor (diet.md's table). */
  pal: number;
  /** The weekly change as a signed fraction of body weight; null: the goal's band. */
  rate: number | null;
  /** Meals a day; null: the eating plan's, else 3. */
  meals: number | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (v: number) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(2)} %`;

/**
 * The energy estimate for the vault on the date. Errors (exit 1) when the
 * profile's age or height or the trend weight is missing; the weight and
 * the protein range still come when they can.
 */
export function buildEnergy(read: VaultRead, date: IsoDate, opts: EnergyOptions) {
  const { data } = read;
  const errors: VaultWarning[] = [];
  const warnings: VaultWarning[] = [];
  const profile = data.profile;
  const since = data.plan.cycleStart ?? undefined;
  const trend = weightTrend(data.body.weights, since ? { through: date, since } : { through: date });
  const latest = trend.value.latest;
  const weighIns = trend.value.points.length;
  const weight = { value: latest ? { kg: r2(latest.trend), date: latest.date, weighIns, since: trend.value.since } : null, reason: trend.reason };
  // The engine's protein range, as review's weight.protein gives it.
  const proteinRange = proteinForProfile(profile, latest ? latest.trend : null, date);
  const plan = data.eatingPlan;
  const planMeals = plan?.habits?.meals;
  const meals = opts.meals ?? planMeals ?? ENERGY.meals;
  const mealsFrom: MealsFrom = opts.meals !== null ? 'flag' : planMeals !== undefined ? 'eating plan' : 'default';
  const level = plan?.level ?? null;
  const basics = profile?.basics;
  const age = ageOn(date, basics?.birthYear);
  const heightCm = basics?.heightCm ?? null;
  const sex = basics?.sex ?? null;
  const inputs = { sex, age, heightCm, pal: opts.pal, rate: opts.rate, meals, mealsFrom, level };

  if (!profile) {
    errors.push({
      code: 'no-basics',
      message:
        read.files.profile === 'missing'
          ? `There is no ${paths().profile} yet (the intake writes it): resting energy needs its basics, the birth year and height (sex is optional).`
          : `${paths().profile} could not be read (its errors are listed): resting energy needs its basics, the birth year and height (sex is optional).`,
    });
  } else {
    const missing = [age === null ? 'basics.birthYear' : '', heightCm === null ? 'basics.heightCm' : ''].filter(Boolean);
    if (missing.length) errors.push({ code: 'no-basics', message: `${paths().profile} has no ${missing.join(' or ')}: resting energy needs the age and the height (the intake's basics; sex is optional).` });
  }
  if (!latest) errors.push({ code: 'no-weight', message: `No weigh-ins in ${paths().body}${since ? ` from the cycle start (${since})` : ''} through ${date}: the estimate needs the trend weight.` });
  if (errors.length || !latest || age === null || heightCm === null) return { payload: { date, inputs, weight, proteinRange }, warnings, errors };

  const w = latest.trend;
  const goal = goalBandOf(profile);
  const band = { ...bandPct(goal.band, w), source: goal.source, goal: goal.kind, ownBand: goal.ownBand };
  const est = energyEstimate({ sex, age, heightCm, weightKg: w, pal: opts.pal, rate: opts.rate, band, protein: proteinRange.value, meals, mealsFrom, level });

  if (sex === null) {
    warnings.push({
      code: 'no-sex',
      message: `The profile gives no sex (prefer not to say): resting energy uses the female constants (Mifflin-St Jeor's − 161) and the floor of ${ENERGY.floorKcal.female} kcal; the male ones would give ${ENERGY.mifflin.male - ENERGY.mifflin.female} kcal more at rest and a floor of ${ENERGY.floorKcal.male}.`,
    });
  }
  if (opts.rate !== null && est.target.value.inBand === false && !est.refused.value) {
    warnings.push({ code: 'rate-outside-band', message: `--rate ${pct(opts.rate)} a week is outside the band of ${goal.source}, ${pct(band.lo)} to ${pct(band.hi)}: the goal energy is for the coach's rate.` });
  }
  if (opts.rate === null && goal.roadmap) {
    warnings.push({ code: 'roadmap-band', message: `${goal.source[0]!.toUpperCase()}${goal.source.slice(1)}: the range is for the roadmap's band, ${pct(band.lo)} to ${pct(band.hi)} a week; --rate gives the plan's own.` });
  }
  if (opts.rate === null && est.target.value.from === 'band' && est.target.value.clamped) {
    warnings.push({ code: 'band-clamped', message: `The band of ${goal.source} reaches ${pct(band.lo)} a week, beyond the limit of 1 % of body weight a week: the range starts at ${pct(ENERGY.maxLossPctPerWeek)}.` });
  }
  if (data.coach.eating === 'invalid') {
    warnings.push({ code: 'eating-invalid', message: `${paths().eating} is not valid (its errors are listed as elsewhere): its level and meals are not read, so the meals are ${mealsFrom === 'flag' ? '--meals' : `the default ${ENERGY.meals}`}.` });
  }

  const { rmr, maintenanceKcal, target, refused, floor, belowFloor, protein, fatMinG, fiberMinG, light, eatingPlanFields } = est;
  return {
    payload: {
      date,
      inputs,
      weight,
      rmr,
      maintenanceKcal,
      target,
      refused,
      floor,
      belowFloor,
      protein,
      proteinRange,
      fatMinG,
      fiberMinG,
      light,
      eatingPlanFields: { basis: { trendKg: r1(w), date: latest.date, weighIns }, ...eatingPlanFields },
    },
    warnings,
    errors,
  };
}
