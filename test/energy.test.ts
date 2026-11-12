// The eating plan's energy arithmetic (core/energy.ts) and `engine energy`:
// the figures numbers.md's Energy and protein snippet printed (the expected
// values below are what that Python prints for the same inputs), the floor,
// the 1 % a week limit, no sex given, the Light level, the goal band's range
// without a rate, and the CLI on the made-up vault. Made-up people.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { engineFacts, HELP, run } from '../src/cli/cli.ts';
import { bandPct, ENERGY, energyEstimate, energyFacts, palInTable, PAL_TABLE_TEXT, type EnergyInput } from '../src/core/energy.ts';
import { proteinTarget } from '../src/core/protein.ts';
import { titleFor } from '../src/core/reason.ts';
import { RATE_BANDS } from '../src/core/weight.ts';
import { FOOD_PLAN } from './fixtures/food/food-state.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

type Json = Record<string, any>;
const parse = (r: { stdout: string }) => JSON.parse(r.stdout) as Json;
const g = (kind: string, importance = 8) => ({ kind: kind as never, importance });
const recomp = { lo: RATE_BANDS.recomposition.lo, hi: RATE_BANDS.recomposition.hi, source: 'profile goal recomp (recomposition)', goal: 'recomposition' as const, ownBand: false };
const fatLoss = { lo: RATE_BANDS['fat-loss'].lo, hi: RATE_BANDS['fat-loss'].hi, source: 'profile goal cut (fat-loss)', goal: 'fat-loss' as const, ownBand: false };

/** The snippet's own example: a man of 42, 182 cm, a trend of 83.5 kg, PAL 1.5, -0.25 % a week, 3 meals. */
const example = (over: Partial<EnergyInput> = {}): EnergyInput => ({
  sex: 'male',
  age: 42,
  heightCm: 182,
  weightKg: 83.5,
  pal: 1.5,
  rate: -0.0025,
  band: recomp,
  protein: proteinTarget({ goals: [g('recomposition', 9)], weightKg: over.weightKg ?? 83.5 }).value,
  meals: 3,
  mealsFrom: 'default',
  level: null,
  ...over,
});

describe('energyEstimate: the snippet\'s figures', () => {
  it('the snippet\'s example: resting, maintenance, protein a day and a meal, the goal energy, fat and fiber', () => {
    // The Python printed: resting 1768 kcal; maintenance about 2651 (x1.5); protein 134-184 g a day;
    // per meal 33-46 g; 3 meals give 100-138 g; goal energy 2422 kcal for -0.25% a week (-0.21 kg);
    // fat at least 54 g; fiber at least 34 g.
    const e = energyEstimate(example());
    assert.deepEqual(e.rmr.value, { kcal: 1768, constants: 'male' });
    assert.deepEqual(e.maintenanceKcal.value, { kcal: 2651, range: [2386, 2916], pal: 1.5 });
    assert.deepEqual([e.protein.value.gPerDay, e.protein.value.perMealG, e.protein.value.perMealTotal, e.protein.value.topUpG], [[134, 184], [33, 46], [100, 138], 34]);
    assert.deepEqual([e.target.value.kcal, e.target.value.pctPerWeek, e.target.value.kgPerWeek, e.target.value.from, e.target.value.inBand], [2422, -0.0025, -0.21, 'rate', true]);
    assert.equal(e.refused.value, false);
    assert.equal(e.belowFloor, false);
    assert.deepEqual(e.floor.value, { kcal: 1500, constants: 'male', below: false, targetKcal: 2422, rateAtFloor: null });
    assert.equal(e.fatMinG.value, 54);
    assert.equal(e.fiberMinG.value, 34);
    // Each figure says where it comes from, under its own title.
    assert.match(e.rmr.reason.note!, /^Mifflin-St Jeor \(Mifflin 1990\): 10 × 83\.5 kg \+ 6\.25 × 182 cm − 5 × 42 years \+ 5 \(men\) = about 1,768 kcal a day at rest\.$/);
    assert.match(e.maintenanceKcal.reason.note!, /about 2,651 kcal a day.*±10 % for most people.*2,386 to 2,916/);
    assert.match(e.target.reason.note!, /^-0\.25 % of body weight a week \(-0\.21 kg\) at about 7,700 kcal per kg \(a rough rule\): about -230 kcal a day from maintenance, about 2,422 kcal a day\. Inside the band/);
    assert.match(e.protein.reason.note!, /33-46 g a meal at 83\.5 kg\. 3 meals \(the default\) give 100-138 g, so top up about 34 g \(a protein snack or shake\) to reach the floor of 134 g\./);
    assert.match(e.fatMinG.reason.note!, /at least 54 g a day at 2,422 kcal/);
    assert.match(e.fiberMinG.reason.note!, /at least 34 g a day at 2,422 kcal/);
    for (const r of [e.rmr, e.maintenanceKcal, e.target, e.refused, e.floor, e.protein, e.fatMinG, e.fiberMinG]) assert.equal(r.reason.title, titleFor(r.reason.rule));
    // The fields as eating-plan.json keeps them: one rate gives one figure, so no targetKcal (the file keeps a range).
    assert.deepEqual(e.eatingPlanFields, { protein: { floorG: 134, rangeG: [134, 184], gPerKg: [1.6, 2.2], perMealG: [33, 46] }, fiber: { g: 34, per1000kcal: 14 }, energy: { maintenanceKcal: 2651 } });
    assert.equal(e.light, null);
  });

  it('enough meals reach the floor: no top-up', () => {
    const e = energyEstimate(example({ meals: 5, mealsFrom: 'flag' }));
    assert.deepEqual([e.protein.value.perMealTotal, e.protein.value.topUpG], [[167, 230], 0]);
    assert.match(e.protein.reason.note!, /5 meals \(--meals\) give 167-230 g, which reaches the floor of 134 g\./);
  });

  it('rounds half up from the unrounded figures (Python\'s format rounds an exact half to even)', () => {
    // 10 × 83 + 6.25 × 182 − 5 × 42 + 5 = 1762.5: Math.round gives 1763, the snippet's :.0f gave 1762.
    assert.equal(energyEstimate(example({ weightKg: 83 })).rmr.value.kcal, 1763);
  });
});

describe('energyEstimate: the floor and the 1 % limit', () => {
  it('under the floor: the floor, and the slower rate it gives', () => {
    // The Python printed: resting 1078; maintenance about 1509 (x1.4); protein 99-114 g; per meal 21-29 g; 3 meals 62-86 g;
    // goal energy 937 kcal for -1.00% a week (-0.52 kg); BELOW THE FLOOR 1200: use 1200 and a slower rate; fat at least 27 g; fiber at least 25 g.
    const e = energyEstimate(
      example({ sex: 'female', age: 50, heightCm: 155, weightKg: 52, pal: 1.4, rate: -0.01, band: fatLoss, protein: proteinTarget({ goals: [g('fat-loss')], weightKg: 52 }).value }),
    );
    assert.deepEqual([e.rmr.value.kcal, e.maintenanceKcal.value.kcal, e.protein.value.gPerDay, e.protein.value.perMealG, e.protein.value.perMealTotal], [1078, 1509, [99, 114], [21, 29], [62, 86]]);
    assert.deepEqual([e.target.value.kcal, e.target.value.kgPerWeek, e.refused.value], [937, -0.52, false]);
    assert.equal(e.belowFloor, true);
    // (1200 − 1508.85) × 7 / (7700 × 52) = −0.54 % a week at the floor.
    assert.deepEqual(e.floor.value, { kcal: 1200, constants: 'female', below: true, targetKcal: 1200, rateAtFloor: { pctPerWeek: -0.0054, kgPerWeek: -0.28 } });
    assert.match(e.floor.reason.note!, /^BELOW THE FLOOR: 937 kcal is under it\. Never below about 1,200 kcal a day for women without a clinician \(AHA\/ACC\/TOS 2013\): use 1,200 and a slower rate \(about -0\.54 % a week at the floor\)\.$/);
    assert.deepEqual([e.fatMinG.value, e.fiberMinG.value], [27, 25]);
  });

  it('a range with its fast end under the floor starts at the floor', () => {
    const e = energyEstimate(example({ sex: 'female', age: 50, heightCm: 155, weightKg: 52, pal: 1.4, rate: null, band: fatLoss }));
    assert.deepEqual([e.target.value.kcal, e.floor.value.targetKcal, e.belowFloor], [[937, 1223], [1200, 1223], true]);
    assert.match(e.floor.reason.note!, /^The fast end, 937 kcal, is under the floor\..*the range starts at 1,200, a slower rate/);
    assert.deepEqual(e.eatingPlanFields.energy.targetKcal, [1200, 1223]);
  });

  it('maintenance at or under the floor: no deficit from food alone', () => {
    const e = energyEstimate(example({ sex: 'female', age: 80, heightCm: 145, weightKg: 42, pal: 1.4, rate: -0.005 }));
    assert.ok(e.maintenanceKcal.value.kcal <= 1200);
    assert.match(e.floor.reason.note!, /Maintenance \(about [\d,]+ kcal\) is at or under it: eat at least 1,200 and expect no loss from food alone\./);
    assert.ok(e.floor.value.rateAtFloor!.pctPerWeek >= 0);
  });

  it('a rate faster than 1 % of body weight a week is refused: no goal energy, no fat or fiber figure', () => {
    // The Python printed "RATE beyond 1% a week: not allowed; use -0.01 or slower", then a goal energy anyway: the engine gives none.
    const e = energyEstimate(example({ rate: -0.015 }));
    assert.equal(e.refused.value, true);
    assert.match(e.refused.reason.note!, /-1\.50 % a week is a loss faster than 1 % of body weight a week: not allowed.*Use -0\.01 or slower\./);
    assert.deepEqual([e.target.value.kcal, e.floor.value.targetKcal, e.belowFloor, e.fatMinG.value, e.fiberMinG.value], [null, null, false, null, null]);
    assert.deepEqual(e.eatingPlanFields.energy, { maintenanceKcal: 2651 });
    assert.equal(e.eatingPlanFields.fiber, undefined);
    // The limit itself is allowed, and is the adjustment rule's own.
    assert.equal(ENERGY.maxLossPctPerWeek, -0.01);
    assert.equal(energyEstimate(example({ rate: -0.01 })).refused.value, false);
  });
});

describe('energyEstimate: no sex given, the Light level, the band\'s range', () => {
  it('no sex given: the female constants and the 1,200 floor, said in the notes', () => {
    const e = energyEstimate(example({ sex: null }));
    // 10 × 83.5 + 6.25 × 182 − 5 × 42 − 161 = 1601.5.
    assert.deepEqual([e.rmr.value, e.floor.value.kcal, e.floor.value.constants], [{ kcal: 1602, constants: 'female' }, 1200, 'female']);
    assert.match(e.rmr.reason.note!, /− 161 \(women\) \(the female constants: no sex given\) = about 1,602/);
    assert.match(e.floor.reason.note!, /1,200 kcal a day for women \(no sex given, so the female floor\)/);
  });

  it('the Light level: only protein and fiber are used', () => {
    const e = energyEstimate(example({ level: 'light' }));
    assert.deepEqual(e.light?.value, { level: 'light', use: ['protein', 'fiberMinG'] });
    assert.equal(e.light?.reason.title, 'Hand portions');
    assert.match(e.light!.reason.note!, /only the protein and fiber figures are used/);
    assert.equal(energyEstimate(example({ level: 'standard' })).light, null);
  });

  it('without a rate, recomposition: maintenance down to 250 kcal under it (diet.md\'s goal energy row)', () => {
    // 2651.25 − 250 = 2401.25; −250 kcal a day is −0.23 kg (−0.27 %) a week at 7,700 kcal per kg.
    const e = energyEstimate(example({ rate: null }));
    assert.deepEqual([e.target.value.kcal, e.target.value.pctPerWeek, e.target.value.kgPerWeek, e.target.value.from, e.target.value.offsetKcal, e.target.value.inBand], [[2401, 2651], [-0.0027, 0], [-0.23, 0], 'goal', [-250, 0], null]);
    assert.deepEqual([e.fatMinG.value, e.fiberMinG.value, e.floor.value.targetKcal], [[53, 59], [34, 37], [2401, 2651]]);
    assert.match(e.target.reason.note!, /^Profile goal recomp \(recomposition\): maintenance to -250 kcal a day \(diet\.md's goal energy rule, H\): about 2,401 to 2,651 kcal a day, -0\.23 to 0\.00 kg a week at about 7,700 kcal per kg \(a rough rule\)\.$/);
    assert.match(e.refused.reason.note!, /^The goal's range is inside the limit of 1 % of body weight a week\.$/);
    // The plan keeps the range, and the fiber figure that meets the rule anywhere in it.
    assert.deepEqual(e.eatingPlanFields.energy, { maintenanceKcal: 2651, targetKcal: [2401, 2651] });
    assert.deepEqual(e.eatingPlanFields.fiber, { g: 37, per1000kcal: 14 });
    assert.match(e.fiberMinG.reason.note!, /The eating plan's one figure is the top, 37 g/);
  });

  it('without a rate, gain: 200 to 300 kcal over maintenance', () => {
    const e = energyEstimate(example({ rate: null, band: { ...recomp, ...RATE_BANDS.gain, source: 'profile goal bulk (gain)', goal: 'gain' } }));
    assert.deepEqual([e.target.value.kcal, e.target.value.pctPerWeek, e.target.value.kgPerWeek, e.target.value.from, e.target.value.offsetKcal], [[2851, 2951], [0.0022, 0.0033], [0.18, 0.27], 'goal', [200, 300]]);
    assert.deepEqual([e.fatMinG.value, e.fiberMinG.value, e.belowFloor], [[63, 66], [40, 41], false]);
    assert.match(e.target.reason.note!, /^Profile goal bulk \(gain\): maintenance \+200 to \+300 kcal a day \(diet\.md's goal energy rule, H\): about 2,851 to 2,951 kcal a day, \+0\.18 to \+0\.27 kg a week/);
    assert.deepEqual(e.eatingPlanFields.energy.targetKcal, [2851, 2951]);
  });

  it('without a rate, fat loss (and a goal\'s own band) sizes the range from the band', () => {
    // The Python at RATE -0.01 and -0.005: goal energy 1733 (1732.75) and 2192; fat at least 39 and 49 g; fiber at least 25 and 31 g.
    // -0.01 × 83.5 = -0.835 kg rounds half up to -0.83.
    const e = energyEstimate(example({ rate: null, band: fatLoss }));
    assert.deepEqual([e.target.value.kcal, e.target.value.pctPerWeek, e.target.value.kgPerWeek, e.target.value.from, e.target.value.offsetKcal], [[1733, 2192], [-0.01, -0.005], [-0.83, -0.42], 'band', null]);
    assert.deepEqual([e.fatMinG.value, e.fiberMinG.value], [[39, 49], [25, 31]]);
    assert.match(e.target.reason.note!, /^The band of profile goal cut \(fat-loss\), -1\.00 % to -0\.50 % a week \(-0\.83 to -0\.42 kg\) at about 7,700 kcal per kg \(a rough rule\): about 1,733 to 2,192 kcal a day\.$/);
    // A recomposition goal the profile gives its own band: the band, as the coach wrote it.
    const own = energyEstimate(example({ rate: null, band: { ...recomp, source: 'profile goal recomp (its own band)', ownBand: true } }));
    assert.deepEqual([own.target.value.kcal, own.target.value.from], [[2192, 2651], 'band']);
  });

  it('without a rate, an offset is held to the 1 % limit and to the floor', () => {
    // A very light person: 250 kcal a day is more than 1 % of 20 kg a week, so the range starts at −1 %; the floor then lifts it.
    const e = energyEstimate(example({ sex: 'female', age: 30, heightCm: 120, weightKg: 20, pal: 1.4, rate: null }));
    assert.deepEqual([e.target.value.from, e.target.value.clamped, e.target.value.pctPerWeek[0 as never], e.refused.value], ['goal', true, -0.01, false]);
    assert.match(e.refused.reason.note!, /^The goal's range reaches beyond 1 % of body weight a week: the range starts at -1\.00 % instead\.$/);
    assert.equal(e.belowFloor, true);
    assert.deepEqual(e.floor.value.targetKcal, [1200, 1200]);
  });

  it('a band beyond the 1 % limit starts at it; a kg band is read against the trend weight', () => {
    const e = energyEstimate(example({ rate: null, band: { lo: -0.015, hi: -0.005, source: 'profile goal cut (its own band)', goal: 'fat-loss', ownBand: true } }));
    assert.deepEqual([e.target.value.pctPerWeek, e.target.value.clamped, e.refused.value], [[-0.01, -0.005], true, false]);
    assert.match(e.target.reason.note!, /Its fast end, -1\.50 %, is beyond 1 % of body weight a week, so the range starts at -1\.00 %\./);
    const kg = bandPct({ unit: 'kg', lo: -0.5, hi: -0.25 }, 83.5);
    assert.ok(Math.abs(kg.lo - -0.5 / 83.5) < 1e-12 && Math.abs(kg.hi - -0.25 / 83.5) < 1e-12);
    assert.deepEqual(bandPct({ unit: 'pct', lo: 0.005, hi: 0.0025 }, 80), { lo: 0.0025, hi: 0.005 });
  });

  it('a rate outside the band is the coach\'s, and says so', () => {
    const e = energyEstimate(example({ rate: 0.004 }));
    assert.equal(e.target.value.inBand, false);
    assert.match(e.target.reason.note!, /about \+\d+ kcal a day from maintenance.*Outside the band of profile goal recomp \(recomposition\), -0\.50 % to 0\.00 % a week: the coach's rate, not the goal's\./);
  });

  it('the activity factor stays inside diet.md\'s table', () => {
    assert.ok(palInTable(1.4) && palInTable(1.55) && palInTable(2.39));
    assert.ok(!palInTable(1.39) && !palInTable(2.4) && !palInTable(Number.NaN));
    assert.equal(PAL_TABLE_TEXT, '1.40-1.69 sedentary or light, 1.70-1.99 active, 2.00-2.39 vigorous; a desk job plus 4 sessions a week is about 1.5-1.6');
  });

  it('gives its constants to engine --version --json', () => {
    assert.deepEqual(engineFacts().energy, energyFacts());
    assert.deepEqual(energyFacts().floorKcal, { male: 1500, female: 1200 });
    assert.deepEqual(energyFacts().goalKcal, { recomposition: [-250, 0], gain: [200, 300] });
    assert.deepEqual([energyFacts().fiber, energyFacts().fat, energyFacts().perMealGPerKg], [{ per1000kcal: 14, minG: 25 }, { minShare: 0.2, kcalPerG: 9 }, [0.4, 0.55]]);
  });
});

describe('cli: energy', () => {
  const PROFILE = 'v/3-Personal/Fitness/Coach/profile.json';
  const EATING = 'v/3-Personal/Fitness/Coach/eating-plan.json';
  const mem = (edit: (f: Record<string, string>) => void = () => {}) => {
    const f = fixtureFiles('v');
    edit(f);
    return memoryIo(f, '2026-04-11');
  };
  const editProfile = (fn: (p: Json) => void) => (f: Record<string, string>) => {
    const p = JSON.parse(f[PROFILE]!) as Json;
    fn(p);
    f[PROFILE] = JSON.stringify(p);
  };
  const energy = (args: string[], io = mem()) => run(['energy', '--vault', 'v', '--json', ...args], io);

  it('reads the profile, the trend from the cycle start and the review\'s protein range; the goal\'s range without --rate', () => {
    const io = mem();
    const r = energy(['--pal', '1.5'], io);
    assert.equal(r.code, 0, r.stdout);
    const o = parse(r);
    const review = parse(run(['review', '--vault', 'v', '--json'], io));
    assert.equal(o.command, 'energy');
    assert.deepEqual(o.inputs, { sex: 'male', age: 42, heightCm: 180, pal: 1.5, rate: null, meals: 3, mealsFrom: 'default', level: null });
    assert.equal(o.weight.value.kg, Math.round(review.weight.trend.value.latest.trend * 100) / 100);
    assert.equal(o.weight.value.since, review.weight.cycleStart);
    assert.deepEqual(o.proteinRange, review.weight.protein);
    // The made-up vault's goal is recomposition: maintenance down to 250 kcal under it (2637 − 250 = 2387).
    assert.equal(o.target.value.from, 'goal');
    assert.equal(o.target.value.band.source, review.weight.band.source);
    assert.deepEqual([o.maintenanceKcal.value.kcal, o.target.value.kcal], [2637, [2387, 2637]]);
    assert.deepEqual(Object.keys(o.eatingPlanFields), ['basis', 'protein', 'fiber', 'energy']);
    assert.deepEqual(o.eatingPlanFields.basis, { trendKg: Math.round(review.weight.trend.value.latest.trend * 10) / 10, date: '2026-04-11', weighIns: review.weight.trend.value.weighIns });
    assert.deepEqual(o.eatingPlanFields.protein.rangeG, review.weight.protein.value.grams);
    assert.deepEqual(o.warnings, []);
  });

  it('--rate gives one figure; --meals sets the meals; a rate outside the band warns', () => {
    const o = parse(energy(['--pal', '1.6', '--rate', '-0.0025', '--meals', '4']));
    assert.deepEqual([o.target.value.from, typeof o.target.value.kcal, o.protein.value.meals, o.protein.value.mealsFrom], ['rate', 'number', 4, 'flag']);
    assert.equal(o.eatingPlanFields.energy.targetKcal, undefined);
    const out = parse(energy(['--pal', '1.6', '--rate', '0.004']));
    assert.deepEqual(out.warnings.map((w: Json) => w.code), ['rate-outside-band']);
    const refused = energy(['--pal', '1.5', '--rate', '-0.02']);
    assert.equal(refused.code, 0);
    assert.deepEqual([parse(refused).refused.value, parse(refused).target.value.kcal], [true, null]);
  });

  it('no sex in the profile: a warning names the constants used', () => {
    const o = parse(energy(['--pal', '1.5'], mem(editProfile((p) => delete p.basics.sex))));
    assert.equal(o.ok, true);
    assert.equal(o.rmr.value.constants, 'female');
    const w = o.warnings.find((x: Json) => x.code === 'no-sex');
    assert.match(w.message, /the female constants \(Mifflin-St Jeor's − 161\) and the floor of 1200 kcal; the male ones would give 166 kcal more at rest and a floor of 1500/);
  });

  it('no weight goal: the roadmap\'s band, said; a goal\'s own band past 1 % a week starts at it', () => {
    const postureOnly = editProfile((p) => (p.goals = p.goals.filter((x: Json) => x.kind === 'posture')));
    const roadmap = parse(energy(['--pal', '1.5'], mem(postureOnly)));
    assert.equal(roadmap.target.value.band.source, 'the roadmap (no weight goal in the profile)');
    assert.deepEqual(roadmap.warnings.map((w: Json) => w.code), ['roadmap-band']);
    assert.match(roadmap.warnings[0].message, /^The roadmap \(no weight goal in the profile\): the range is for the roadmap's band, -0\.\d+ % to -0\.\d+ % a week; --rate gives the plan's own\.$/);
    // With --rate the band isn't used, so no warning about it.
    assert.deepEqual(parse(energy(['--pal', '1.5', '--rate', '-0.004'], mem(postureOnly))).warnings, []);
    const fast = parse(energy(['--pal', '1.5'], mem(editProfile((p) => (p.goals[0].rateBand = { unit: 'pct', lo: -0.015, hi: -0.005 })))));
    assert.deepEqual([fast.target.value.pctPerWeek, fast.target.value.clamped], [[-0.01, -0.005], true]);
    assert.deepEqual(fast.warnings.map((w: Json) => w.code), ['band-clamped']);
  });

  it('the eating plan\'s level and meals: at the Light level only protein and fiber', () => {
    const plan = { ...(FOOD_PLAN as Json), habits: { ...(FOOD_PLAN as Json).habits, meals: 4 } };
    const o = parse(energy(['--pal', '1.5'], mem((f) => (f[EATING] = JSON.stringify(plan)))));
    assert.equal(o.ok, true, JSON.stringify(o.errors));
    assert.deepEqual([o.inputs.level, o.protein.value.meals, o.protein.value.mealsFrom], ['light', 4, 'eating plan']);
    assert.deepEqual(o.light.value.use, ['protein', 'fiberMinG']);
    // --meals wins over the plan's.
    assert.equal(parse(energy(['--pal', '1.5', '--meals', '2'], mem((f) => (f[EATING] = JSON.stringify(plan))))).protein.value.meals, 2);
  });

  it('no basics, no profile or no weigh-ins: exit 1, the weight and the protein range still given', () => {
    const noHeight = energy(['--pal', '1.5'], mem(editProfile((p) => delete p.basics.heightCm)));
    assert.equal(noHeight.code, 1);
    const o = parse(noHeight);
    assert.deepEqual(o.errors.map((e: Json) => e.code), ['no-basics']);
    assert.match(o.errors[0].message, /profile\.json has no basics\.heightCm: resting energy needs the age and the height/);
    assert.ok(o.weight.value.kg > 0 && o.proteinRange.value.grams);
    assert.equal(o.rmr, undefined);
    const noProfile = parse(energy(['--pal', '1.5'], mem((f) => delete f[PROFILE])));
    assert.match(noProfile.errors.find((e: Json) => e.code === 'no-basics').message, /^There is no 3-Personal\/Fitness\/Coach\/profile\.json yet \(the intake writes it\)/);
    const noWeight = energy(['--pal', '1.5'], mem((f) => delete f['v/3-Personal/Fitness/body-data.json']));
    assert.equal(noWeight.code, 1);
    assert.deepEqual(parse(noWeight).errors.map((e: Json) => e.code), ['no-weight']);
    assert.equal(parse(noWeight).weight.value, null);
  });

  it('flags: --pal required and inside the table, --rate a fraction, --meals a whole number (exit 2)', () => {
    const cases: [string[], RegExp][] = [
      [[], /energy needs --pal N, the activity factor from diet\.md's table: 1\.40-1\.69 sedentary or light, 1\.70-1\.99 active, 2\.00-2\.39 vigorous/],
      [['--pal', 'x'], /--pal takes the activity factor/],
      [['--pal', '1.2'], /--pal must be from 1\.40 to 2\.39/],
      [['--pal', '1.5', '--rate', '0.2'], /--rate takes the weekly change as a fraction of body weight/],
      [['--pal', '1.5', '--rate', 'fast'], /--rate takes the weekly change/],
      [['--pal', '1.5', '--meals', '2.5'], /--meals takes the meals a day, a whole number from 1 to 8/],
      [['--pal', '1.5', '--meals', '0'], /--meals takes/],
      [['--pal', '1.5', '--write'], /energy does not take --write/],
      [['--pal', '1.5', '--date', '2026-4-1'], /--date must be a date/],
    ];
    for (const [args, re] of cases) {
      const r = energy(args);
      assert.equal(r.code, 2, args.join(' '));
      assert.match(parse(r).errors[0].message, re, args.join(' '));
    }
  });

  it('is in --help with its flags, and only reads', () => {
    assert.match(HELP, /\n {2}energy {4}--vault <path> --pal N \[--rate R\] \[--meals N\] \[--date D\]\n/);
    assert.equal(run(['energy', '--help']).stdout, HELP);
    const files = fixtureFiles('v');
    const before = JSON.stringify(files);
    run(['energy', '--vault', 'v', '--json', '--pal', '1.5'], memoryIo(files, '2026-04-11'));
    assert.equal(JSON.stringify(files), before);
  });
});
