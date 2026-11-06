// The Food tab's states on the synthetic vault, as the mockup draws them
// (mockups/food-data.js): the first day of a fresh cycle (Mon 2 Nov 2026:
// one weigh-in, one tape, nothing ticked), four weeks on (Sun 29 Nov, the
// first check: seeded weigh-ins with creatine's water, three tapes, the
// Protein item's ticks, the pattern answered at three Sunday check-ins),
// and the same first day without an eating plan. All made up. Two plans:
// the schema 1 plan as the Food tab first drew it (`plain`), and the same
// plan with the day, the meal ideas, the reasons, the light checks and the
// coach's tips (`day`, adapted from mockups/food-v2-data.js). Shared by the
// tests and the plugin preview (`&food=early|later|empty`, `&plan=plain`);
// pure, so it bundles for the page: it edits a map of file texts in place.

import { habitCheckinKey } from '../../../src/core/tracking.ts';
import PLAN from './eating-plan.json' with { type: 'json' };
import DAY_PLAN from './eating-plan-day.json' with { type: 'json' };

export type FoodState = 'early' | 'later' | 'empty';
export type FoodPlan = 'plain' | 'day';
export const FOOD_PLAN = PLAN;
export const FOOD_PLAN_DAY = DAY_PLAN;

const d0 = Date.UTC(2026, 10, 2);
const day = (n: number) => new Date(d0 + n * 864e5).toISOString().slice(0, 10);

/** Four weeks of morning weigh-ins, most mornings: creatine's water in the first two weeks, a slow loss under it (food-data.js's seed). */
export function foodWeighIns(): { date: string; kg: number }[] {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out: { date: string; kg: number }[] = [];
  for (let n = 0; n < 28; n++) {
    const skip = rnd() < 0.22 && n > 0 && n < 27;
    const noise = (rnd() - 0.5) * 0.7;
    if (skip) continue;
    const kg = 83.5 + 0.6 * (1 - Math.exp(-n / 4)) - 0.036 * n + (n === 0 ? 0 : noise);
    out.push({ date: day(n), kg: Math.round(kg * 10) / 10 });
  }
  return out;
}

/** The Protein item's ticks from day `start`: "1" ticked, "0" not, "." left out. */
const ticks = (start: number, marks: string) => [...marks].map((m, i) => [day(start + i), m] as const).filter(([, m]) => m === '1').map(([d]) => d);

const PROTEIN_TICKS = [...ticks(0, '1110101'), ...ticks(7, '1011010'), ...ticks(14, '1110111'), ...ticks(21, '110110')];

/** The made-up state into the vault's files (the synthetic vault's, as a map of path to text, under `root`), with the plain or the day plan; returns the state's date. */
export function applyFoodState(files: Record<string, string>, state: FoodState, root = '', plan: FoodPlan = 'plain'): { today: string } {
  const FIT = `${root ? `${root}/` : ''}3-Personal/Fitness`;
  const edit = (path: string, fn: (d: any) => void) => {
    const d = JSON.parse(files[path]!);
    fn(d);
    files[path] = JSON.stringify(d, null, 2);
  };
  // A fresh start on Mon 2 Nov: the baseline note, the plan's phases by name, the log before it archived.
  files[`${FIT}/Baseline - 2026-11-02.md`] = '# Baseline · 2026-11-02 (made up)\n';
  edit(`${FIT}/plan-data.json`, (p) => void (p.phases = [{ name: 'Foundation' }, { name: 'Build' }, { name: 'Peak' }]));
  const later = state === 'later';
  const weighIns = later ? foodWeighIns() : [{ date: '2026-11-02', kg: 83.5 }];
  const tapes = later ? [{ date: '2026-11-02', waist: 92 }, { date: '2026-11-15', waist: 91.5 }, { date: '2026-11-29', waist: 91 }] : [{ date: '2026-11-02', waist: 92 }];
  edit(`${FIT}/body-data.json`, (b) => {
    for (const w of weighIns) b.days[w.date] = { ...(b.days[w.date] ?? {}), weight: w.kg };
    b.tape.push(...tapes);
  });
  edit(`${FIT}/Coach/tracking.json`, (t) => {
    t.bodyRecord = { schedule: 'plan' };
    for (const it of t.items) {
      // The protein tick's card at 21:00, creatine from the fresh start (its water is the rule's exception).
      if (it.id === 'protein') it.reminder = { at: '21:00' };
      if (it.id === 'creatine') it.start = '2026-11-02';
    }
    if (later) for (const d of PROTEIN_TICKS) t.days[d] = { ...(t.days[d] ?? {}), protein: { done: true } };
  });
  // As Pahlavan's tick writes them: the linked habit too.
  if (later) edit(`${root ? `${root}/` : ''}5-System/Data/habits-data.json`, (hd) => void PROTEIN_TICKS.forEach((d) => (hd.checkins[habitCheckinKey('protein', d)] = '1')));
  if (later) {
    const met = [
      { date: '2026-11-08', weekStart: '2026-11-02', proteinDays: 5, pattern: { fish: true, legumes: false, lamb: true, veg: true, fruit: false } },
      { date: '2026-11-15', weekStart: '2026-11-09', proteinDays: 4, pattern: { fish: true, legumes: true, lamb: true, veg: true, fruit: false } },
      { date: '2026-11-22', weekStart: '2026-11-16', proteinDays: 6, pattern: { fish: false, legumes: true, lamb: true, veg: true, fruit: true } },
    ];
    files[`${FIT}/Coach/checkins.json`] = JSON.stringify({ schemaVersion: 1, checkins: met }, null, 2);
  }
  if (state !== 'empty') files[`${FIT}/Coach/eating-plan.json`] = JSON.stringify(plan === 'day' ? DAY_PLAN : PLAN, null, 2);
  return { today: later ? '2026-11-29' : '2026-11-02' };
}
