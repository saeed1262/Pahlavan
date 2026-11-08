// The plugin's Plan and Progress counts for a ladder item before any level
// is logged: a plan whose pull-up ladder declares startLevel 6 counts the
// item as pull-ups on both screens, as `engine review` does on the same
// files (the plugin reads through the same adapter and review).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { buildReview } from '../../src/report/review.ts';
import { PahlavanData } from '../src/data-source.ts';
import { memVault } from './mem-vault.ts';

const PLAN = '3-Personal/Fitness/plan-data.json';
const DATE = '2026-04-27';
const LEVELS = ['Dead hang', 'Scapular pull-up', 'Inverted row', 'Negative pull-up', 'Band-assisted pull-up', 'Pull-up', 'Weighted pull-up', 'L-sit pull-up'];

/** The synthetic vault with a pull-up ladder item in session A, the ladder starting at `startLevel` when given. */
function vault(startLevel?: number) {
  const v = memVault();
  const plan = v.json(PLAN);
  plan.ladders.push({ id: 'pullup', name: 'Pull-up', levels: LEVELS.map((name) => ({ name })), ...(startLevel ? { startLevel } : {}) });
  plan.laddersFor.A = ['pullup'];
  plan.sessions.A.splice(2, 0, { name: 'Pull-up (your level)', sr: '4 × 3–8', rir: 2, note: 'Why: the main vertical pull.', ladder: 'pullup' });
  v.files.set(PLAN, JSON.stringify(plan));
  return v;
}

const pick = (rows: { muscle: string; sets: number }[]) => Object.fromEntries(rows.filter((r) => ['biceps', 'lats', 'forearms'].includes(r.muscle)).map((r) => [r.muscle, r.sets]));

async function counts(startLevel?: number) {
  const v = vault(startLevel);
  const data = new PahlavanData(v.adapter);
  await data.load(DATE);
  const plan = data.plan(DATE) as { volume: { muscles: { muscle: string; sets: number }[] } };
  const progress = await data.progress(DATE);
  const io = { readText: (p: string) => v.files.get(p) ?? null, listDir: (p: string) => [...new Set([...v.files.keys()].filter((k) => k.startsWith(`${p}/`)).map((k) => k.slice(p.length + 1).split('/')[0]!))] };
  const review = buildReview(readVault(io, '', { asOf: DATE }).data, DATE).volume.planned.value.perWeek;
  return { plan: pick(plan.volume.muscles), progress: pick(progress.volume!.views.plan.muscles), review: { biceps: review['biceps'], lats: review['lats'], forearms: review['forearms'] } };
}

describe('the plugin: a ladder item before any level is logged', () => {
  it('counts the declared start on the Plan and Progress screens, as review does', async () => {
    const c = await counts(6);
    assert.deepEqual(c.plan, { biceps: 5.25, lats: 10.5, forearms: 7.5 });
    assert.deepEqual(c.progress, c.plan);
    assert.deepEqual(c.review, c.plan);
  });

  it('without a start, all three count the lowest level (a dead hang)', async () => {
    const c = await counts();
    assert.deepEqual(c.plan, { biceps: 2.25, lats: 7.5, forearms: 10.5 });
    assert.deepEqual(c.progress, c.plan);
    assert.deepEqual(c.review, c.plan);
  });
});
