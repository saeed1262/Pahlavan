// A ladder item's level in the weekly sets: the log's level first, then the
// plan's startLevel, then the lowest level with a warning that says how to
// declare a start. A draft read with --plan, and a plan written before its
// first logged level, count the level the plan means; review, check, the
// Plan screen and Progress read it through the same path, so they agree.
// The displays follow it too: review's ladders, Progress's Skills data,
// Today's "Your levels" copy and the movement guide show the plan's start
// before a level is logged, and say it is the start.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ladderNameAt, ladderHistory, ladderStatus, readPlanData } from '../src/adapters/vault/convert.ts';
import { readVault } from '../src/adapters/vault/read.ts';
import { ladderLevelOn, ladderStartOf } from '../src/core/plan-data.ts';
import { buildCheck } from '../src/report/check.ts';
import { buildPlan, buildProgress, buildProgressMore, guideFor, levelsText } from '../src/report/index.ts';
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

/** The plan written as plan-data.json, the log's pull-up history set to `logged`, and a made-up pull-up test of `pullups` on 20 Apr when given. */
function readWith(plan: Json, opts: { logged?: { level: number; date: string }[]; pullups?: number } = {}) {
  const files = fixtureFiles('v');
  files[PLAN] = JSON.stringify(plan);
  const log = JSON.parse(files[LOG]!) as Json;
  if (opts.logged) log.ladders.pullup = opts.logged;
  files[LOG] = JSON.stringify(log);
  if (opts.pullups !== undefined) {
    const at = 'v/3-Personal/Fitness/body-data.json';
    const body = JSON.parse(files[at]!) as Json;
    body.tests.push({ date: '2026-04-20', pullups: opts.pullups });
    files[at] = JSON.stringify(body);
  }
  return { read: readVault(memoryIo(files), 'v', { asOf: DATE }), plan, log };
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

describe('the displays before a level is logged: the plan\'s start', () => {
  /** A guide entry for each pull-up level, so the movement guide has something to show. */
  const guided = (startLevel?: unknown): Json => {
    const plan = draft(startLevel);
    for (const l of PULLUP.levels) plan.guide[l.name] = { setup: 'Set up.', do: 'Do it.', avoid: 'Avoid that.', q: 'how to', muscles: { main: ['lats'], helps: ['biceps'] } };
    return plan;
  };
  const pullup = <T extends { id: string }>(rows: readonly T[]) => rows.find((r) => r.id === 'pullup')!;

  it('ladderStatus and review\'s ladders: level 6 from the plan, its name, no since, the reason says it is the start', () => {
    const { read } = readWith(guided(6));
    const st = pullup(ladderStatus(read.data, DATE));
    assert.deepEqual([st.level, st.from, st.levelName, st.since, st.testShowsLevel], [6, 'plan', 'Pull-up', null, undefined]);
    assert.match(st.reason.note!, /^Pull-up: level 6 \(Pull-up\), the plan's start \(its startLevel\), not logged yet\./);
    assert.equal(st.reason.inputs['from'], 'plan');
    const r = pullup(buildReview(read.data, DATE).ladders);
    assert.deepEqual([r.level, r.from, r.levelName, r.since], [6, 'plan', 'Pull-up', null]);
    // The fixture's own ladders, which the log holds, say so.
    assert.deepEqual(ladderStatus(read.data, DATE).filter((l) => l.id !== 'pullup').map((l) => [l.id, l.from]), [['pushup', 'log'], ['handstand', 'log']]);
  });

  it('Progress\'s Skills: the level, its name and where it comes from; the path is in progress at the start', () => {
    const { read } = readWith(guided(6));
    const l = pullup(buildProgressMore(read, DATE, 'v').skills!.ladders);
    assert.deepEqual([l.level, l.from, l.levelName, l.since, l.testShowsLevel], [6, 'plan', 'Pull-up', null, null]);
    assert.deepEqual(l.path.map((p) => p.state), ['mastered', 'mastered', 'mastered', 'mastered', 'mastered', 'progress', 'unlocked', 'locked']);
    assert.ok(l.path.every((p) => p.reached === null), 'nothing logged, so no level has a date');
  });

  it('a test shows a level only above the start: at the start it shows nothing, under it the hint moves up', () => {
    // One pull-up shows level 6 (Pull-up).
    assert.equal(pullup(ladderStatus(readWith(guided(6), { pullups: 1 }).read.data, DATE)).testShowsLevel, undefined);
    assert.deepEqual(pullup(ladderStatus(readWith(guided(4), { pullups: 1 }).read.data, DATE)).testShowsLevel, { level: 6, name: 'Pull-up' });
    const more = pullup(buildProgressMore(readWith(guided(4), { pullups: 1 }).read, DATE, 'v').skills!.ladders);
    assert.deepEqual([more.level, more.from, more.testShowsLevel], [4, 'plan', { level: 6, name: 'Pull-up' }]);
    // No start: level 0, not set, and the test shows level 6 as before.
    const none = pullup(ladderStatus(readWith(guided(), { pullups: 1 }).read.data, DATE));
    assert.deepEqual([none.level, none.from, none.levelName, none.testShowsLevel], [0, 'lowest', null, { level: 6, name: 'Pull-up' }]);
  });

  it('a logged level wins over the start, from its date; before it the start shows', () => {
    const { read } = readWith(guided(6), { logged: [{ level: 7, date: '2026-04-20' }] });
    const st = pullup(ladderStatus(read.data, DATE));
    assert.deepEqual([st.level, st.from, st.levelName, st.since], [7, 'log', 'Weighted pull-up', '2026-04-20']);
    assert.match(st.reason.note!, /^Pull-up: level 7 \(Weighted pull-up\) since Mon 20 Apr\./);
    const before = pullup(ladderStatus(read.data, '2026-04-13'));
    assert.deepEqual([before.level, before.from, before.since], [6, 'plan', null]);
    const l = pullup(buildProgressMore(read, DATE, 'v').skills!.ladders);
    assert.deepEqual([l.level, l.from, l.since], [7, 'log', '2026-04-20']);
  });

  it('Today\'s "Your levels": the plan\'s start, said as the start; the log\'s level when there is one; not set with neither', () => {
    const { plan, log } = readWith(guided(6));
    assert.equal(levelsText(plan, log, 'A'), 'Your levels: Pull-up L6 · Pull-up (the plan\'s start)');
    assert.equal(levelsText(plan, { ...log, ladders: { ...log.ladders, pullup: [{ level: 7, date: '2026-04-20' }] } }, 'A'), 'Your levels: Pull-up L7 · Weighted pull-up');
    assert.equal(levelsText(guided(), log, 'A'), 'Your levels: Pull-up: not set');
  });

  it('the movement guide: the start\'s level, marked as the plan\'s start, not as unset', () => {
    const { plan, log } = readWith(guided(6));
    const [e] = guideFor(plan, log, 'Pull-up (your level)');
    assert.deepEqual([e!.title, e!.unset, e!.planStart], ['Pull-up · L6 Pull-up', false, true]);
    const [logged] = guideFor(plan, { ...log, ladders: { ...log.ladders, pullup: [{ level: 7, date: '2026-04-20' }] } }, 'Pull-up (your level)');
    assert.deepEqual([logged!.title, logged!.unset, logged!.planStart], ['Pull-up · L7 Weighted pull-up', false, false]);
    const [unset] = guideFor(guided(), log, 'Pull-up (your level)');
    assert.deepEqual([unset!.title, unset!.unset, unset!.planStart], ['Pull-up · L1 Dead hang', true, false]);
  });

  it('a malformed start is ignored everywhere: not set, level 1 in the guide', () => {
    for (const bad of [9, 0, 2.5, '6']) {
      const { read, plan, log } = readWith(guided(bad));
      const st = pullup(ladderStatus(read.data, DATE));
      assert.deepEqual([st.level, st.from, st.levelName], [0, 'lowest', null], JSON.stringify(bad));
      assert.equal(pullup(buildProgressMore(read, DATE, 'v').skills!.ladders).from, 'lowest');
      assert.equal(levelsText(plan, log, 'A'), 'Your levels: Pull-up: not set');
      const [e] = guideFor(plan, log, 'Pull-up (your level)');
      assert.deepEqual([e!.title, e!.unset, e!.planStart], ['Pull-up · L1 Dead hang', true, false]);
    }
    // Read straight, too: ladderStatus takes the start through ladderStartOf, never the raw value.
    const { read } = readWith(guided(6));
    const raw = { ...read.data, plan: { ...read.data.plan, ladders: read.data.plan.ladders.map((l) => (l.id === 'pullup' ? { ...l, startLevel: 9 } : l)) } };
    assert.deepEqual([pullup(ladderStatus(raw, DATE)).level, pullup(ladderStatus(raw, DATE)).from], [0, 'lowest']);
  });
});
