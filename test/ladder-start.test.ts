// A ladder item's level in the weekly sets: the log's level first, then the
// plan's startLevel, then the lowest level with a warning that says how to
// declare a start. A draft read with --plan, and a plan written before its
// first logged level, count the level the plan means; review, check, the
// Plan screen and Progress read it through the same path, so they agree.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ladderNameAt, ladderHistory, readPlanData } from '../src/adapters/vault/convert.ts';
import { readVault } from '../src/adapters/vault/read.ts';
import { ladderLevelOn, ladderStartOf } from '../src/core/plan-data.ts';
import { buildCheck } from '../src/report/check.ts';
import { buildPlan, buildProgress } from '../src/report/index.ts';
import { buildReview } from '../src/report/review.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

type Json = Record<string, any>;
const PLAN = 'v/3-Personal/Fitness/plan-data.json';
const LOG = 'v/3-Personal/Fitness/fitness-log-data.json';
/** A loading week after the fixture's abdominal constraint ends: the fixture plan has no hard error. */
const DATE = '2026-04-27';

/** The engine's pull-up ladder, as a coach-written plan-data ladder holds it. */
const PULLUP = {
  id: 'pullup',
  name: 'Pull-up',
  levels: ['Dead hang', 'Scapular pull-up', 'Inverted row', 'Negative pull-up', 'Band-assisted pull-up', 'Pull-up', 'Weighted pull-up', 'L-sit pull-up'].map((name) => ({ name })),
};

/** The fixture plan with a pull-up ladder item in session A, starting at `startLevel` when given. */
function draft(startLevel?: unknown): Json {
  const plan = JSON.parse(fixtureFiles('v')[PLAN]!) as Json;
  plan.ladders.push(startLevel === undefined ? { ...PULLUP } : { ...PULLUP, startLevel });
  plan.laddersFor.A = ['pullup'];
  plan.sessions.A.splice(2, 0, { name: 'Pull-up (your level)', table: 'Pull-up (your level)', sr: '4 × 3–8', rest: '2 min', rir: 2, note: 'Why: the main vertical pull.', label: 'Pull-up', ladder: 'pullup' });
  return plan;
}

/** The fixture vault, its log's pull-up history set to `logged`, read with `plan` as a --plan draft. */
function readDraft(plan: Json, logged: { level: number; date: string }[] = []) {
  const files = fixtureFiles('v');
  const log = JSON.parse(files[LOG]!) as Json;
  if (logged.length) log.ladders.pullup = logged;
  files[LOG] = JSON.stringify(log);
  return readVault(memoryIo(files), 'v', { asOf: DATE, plan: { text: JSON.stringify(plan), file: 'draft.json' } });
}

/** The same files with the plan written as plan-data.json (a plan before its first logged level). */
function readWritten(plan: Json) {
  const files = fixtureFiles('v');
  files[PLAN] = JSON.stringify(plan);
  return readVault(memoryIo(files), 'v', { asOf: DATE });
}

const perWeek = (read: ReturnType<typeof readVault>) => buildReview(read.data, DATE).volume.planned.value.perWeek;
/** Session A's ladder slot in the week holding the date. */
const ladderSlot = (read: ReturnType<typeof readVault>) => {
  const week = read.data.program.macrocycle.phases.flatMap((p) => p.mesocycles.flatMap((m) => m.weeks)).filter((w) => w.start <= DATE).at(-1)!;
  return week.sessions.find((t) => t.id === 'a')!.slots.find((s) => s.progression?.rule === 'ladder')!;
};
const warningOf = (read: ReturnType<typeof readVault>, code: string) => read.data.warnings.find((w) => w.code === code);
const below = (read: ReturnType<typeof readVault>) => buildCheck(read, DATE).findings.find((f) => f.code === 'volume-below-minimum')?.items ?? [];

describe('ladderLevelOn: the order a ladder item reads its level in', () => {
  const history = [{ level: 2, date: '2026-04-01' }, { level: 3, date: '2026-04-15' }];

  it('takes the log\'s level on the date first, whatever the plan declares', () => {
    assert.deepEqual(ladderLevelOn(history, 6, '2026-04-20'), { level: 3, from: 'log' });
    assert.deepEqual(ladderLevelOn(history, 6, '2026-04-10'), { level: 2, from: 'log' });
    assert.deepEqual(ladderLevelOn(history, null, null), { level: 3, from: 'log' });
  });

  it('then the plan\'s starting level, then the lowest level', () => {
    assert.deepEqual(ladderLevelOn(history, 6, '2026-03-01'), { level: 6, from: 'plan' });
    assert.deepEqual(ladderLevelOn([], 6, null), { level: 6, from: 'plan' });
    assert.deepEqual(ladderLevelOn([], null, '2026-04-20'), { level: 1, from: 'lowest' });
    assert.deepEqual(ladderLevelOn([], undefined, null), { level: 1, from: 'lowest' });
  });
});

describe('ladderStartOf: plan-data\'s startLevel', () => {
  it('is a whole number among the ladder\'s levels, or nothing', () => {
    assert.deepEqual(ladderStartOf({ ...PULLUP, startLevel: 6 }), { level: 6, problem: null });
    assert.deepEqual(ladderStartOf({ ...PULLUP, startLevel: 8 }), { level: 8, problem: null });
    assert.deepEqual(ladderStartOf(PULLUP), { level: null, problem: null });
  });

  it('says what is wrong with any other value, and is read around', () => {
    for (const bad of [0, 9, 2.5, '6', null]) {
      const s = ladderStartOf({ ...PULLUP, startLevel: bad });
      assert.equal(s.level, null, JSON.stringify(bad));
      assert.match(s.problem!, /ladder "pullup" has startLevel .*, not one of its levels \(a whole number from 1 to 8\)/);
    }
  });
});

describe('a draft whose pull-up ladder starts at pull-ups', () => {
  const lowest = readDraft(draft());
  const started = readDraft(draft(6));

  it('counts the item as pull-ups, not a dead hang', () => {
    assert.equal(ladderSlot(lowest).exercise, 'dead-hang');
    assert.equal(ladderSlot(started).exercise, 'pull-up');
    // The next harder variation follows the level it starts at.
    assert.equal(ladderSlot(started).progression?.next, 'weighted-pull-up');
  });

  it('counts biceps and lats as pull-ups do: lats direct, biceps half credit; the forearms lose the hang\'s direct sets', () => {
    // A and B weigh 1.5 each (3 lifting days over two sessions): 4 sets of pull-ups are 6 a week.
    const before = perWeek(lowest);
    const after = perWeek(started);
    assert.deepEqual([before['biceps'], before['lats'], before['forearms']], [2.25, 7.5, 10.5]);
    assert.deepEqual([after['biceps'], after['lats'], after['forearms']], [5.25, 10.5, 7.5]);
    assert.equal(after['biceps']! - before['biceps']!, 3, 'pull-ups add 6 × 0.5 biceps sets a week');
    assert.equal(after['lats']! - before['lats']!, 3, 'lats: 6 direct sets for the hang\'s 3 half-credit ones');
  });

  it('judges the item at its own level: near failure by its RIR, not easy for being under level 1', () => {
    const e = buildReview(started.data, DATE).volume.planned.value.efforts.find((x) => x.exercise === 'pull-up')!;
    assert.deepEqual([e.effort, e.by], ['hard', 'rir']);
  });

  it('agrees in check: biceps leave the under-minimum list', () => {
    assert.ok(below(lowest).includes('biceps: 2.25 sets a week, under the minimum dose of 4'));
    assert.ok(!below(started).some((t) => t.startsWith('biceps:')));
  });

  it('agrees on the Plan screen and Progress, read from the plan as written before any level is logged', () => {
    const written = readWritten(draft(6));
    const want = perWeek(started);
    const plan = buildPlan(written, DATE) as { volume: { muscles: { muscle: string; sets: number }[] } };
    const progress = buildProgress(written, DATE);
    const rows = (muscles: { muscle: string; sets: number }[]) => Object.fromEntries(muscles.filter((m) => ['biceps', 'lats', 'forearms'].includes(m.muscle)).map((m) => [m.muscle, m.sets]));
    assert.deepEqual(rows(plan.volume.muscles), { biceps: want['biceps'], lats: want['lats'], forearms: want['forearms'] });
    assert.deepEqual(rows(progress.volume!.views.plan.muscles), { biceps: want['biceps'], lats: want['lats'], forearms: want['forearms'] });
    assert.equal(warningOf(written, 'ladder-start'), undefined);
  });

  it('names the level in the session and the log, as it counts it', () => {
    const plan = readPlanData(draft(6))!;
    assert.equal(ladderNameAt(plan, {}, 'pullup', DATE), 'Pull-up');
    assert.equal(ladderNameAt(readPlanData(draft())!, {}, 'pullup', DATE), 'Dead hang');
  });

  it('gives no warning about the lowest level', () => {
    assert.equal(warningOf(started, 'ladder-start'), undefined);
    assert.equal(buildCheck(started, DATE).findings.find((f) => f.code === 'ladder-start'), undefined);
  });
});

describe('a logged level and a declared start', () => {
  it('counts the logged level, even one under the start', () => {
    const read = readDraft(draft(6), [{ level: 2, date: '2026-04-20' }]);
    assert.equal(ladderSlot(read).exercise, 'scapular-pull-up');
    // A scapular pull-up trains upper back and lats, no biceps: only the row's half credit is left.
    assert.equal(perWeek(read)['biceps'], 2.25);
    assert.equal(ladderNameAt(readPlanData(draft(6))!, ladderHistory({ ladders: { pullup: [{ level: 2, date: '2026-04-20' }] } }), 'pullup', DATE), 'Scapular pull-up');
    assert.equal(warningOf(read, 'ladder-start'), undefined);
  });

  it('counts the start before the first logged date, and the log from it', () => {
    const files = { pullup: [{ level: 7, date: '2026-05-04' }] };
    const plan = readPlanData(draft(6))!;
    assert.equal(ladderNameAt(plan, files, 'pullup', DATE), 'Pull-up');
    assert.equal(ladderNameAt(plan, files, 'pullup', '2026-05-04'), 'Weighted pull-up');
  });
});

describe('no start and no logged level', () => {
  const read = readDraft(draft());

  it('counts the lowest level and warns, naming the field that declares a start', () => {
    const w = warningOf(read, 'ladder-start')!;
    assert.match(w.message, /the weekly sets assume the ladder's lowest level/);
    assert.match(w.message, /"startLevel" in plan-data\.json/);
    assert.match(w.message, /engine log ladder/);
    assert.deepEqual(w.items, ['pullup: counted as level 1 (Dead hang)']);
  });

  it('is a warning in check, not a hard error', () => {
    const f = buildCheck(read, DATE).findings.find((x) => x.code === 'ladder-start')!;
    assert.equal(f.level, 'warning');
    assert.equal(buildCheck(read, DATE).summary.ok, true);
  });

  it('says nothing for the fixture\'s own ladders, which the log holds', () => {
    const files = fixtureFiles('v');
    assert.equal(warningOf(readVault(memoryIo(files), 'v', { asOf: DATE }), 'ladder-start'), undefined);
  });
});

describe('a startLevel that is not one of the ladder\'s levels', () => {
  it('is a hard plan-data error in check, and the count reads around it', () => {
    const read = readDraft(draft(9));
    const errors = buildCheck(read, DATE).findings.filter((f) => f.level === 'error');
    assert.deepEqual(errors.map((f) => f.code), ['plan-data']);
    assert.match(errors[0]!.items[0]!, /ladder "pullup" has startLevel 9/);
    assert.equal(ladderSlot(read).exercise, 'dead-hang');
    assert.ok(warningOf(read, 'ladder-start'));
  });
});
