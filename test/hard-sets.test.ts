// Direct, indirect and hard sets (core/volume.ts): each muscle's weekly sets
// split into direct and indirect, a planned set's effort (the RIR the plan
// wrote, a hold against the user's test, a ladder level under the user's),
// and a priority muscle's minimum met only by direct sets near failure
// (rules.md, "Volume"). The plan's ab work, old and new, on the synthetic
// vault.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { LADDER_BY_ID } from '../src/core/data/ladders.ts';
import { noteRir } from '../src/core/plan-data.ts';
import type { Exercise, SessionTemplate } from '../src/core/schema.ts';
import { checkVolume, holdBests, holdKindOf, plannedSetsPerMuscle, setEffort, setsPerMuscle, VOLUME, type EffortContext } from '../src/core/volume.ts';
import { planGlance } from '../src/report/glance.ts';
import { buildPlan } from '../src/report/plan-screen.ts';
import { buildReview } from '../src/report/review.ts';
import { applyAbWork } from './fixtures/ab-work.ts';
import { fixtureFiles, memoryIo, session, set, slot } from './helpers.ts';

/** The user: side plank and plank tested at 60 s, the core ladder at level 3 (the vault's levels as exercise ids). */
const CTX: EffortContext = {
  holds: { 'side-plank': { seconds: 60, date: '2026-10-08', source: 'tests', field: 'sidePlankS' }, plank: { seconds: 60, date: '2026-11-02', source: 'self-check', field: 'coreHold' } },
  ladders: [{ id: 'hollow', name: 'Core (abs)', levels: ['dead-bug', 'tuck-hollow-hold', 'hollow-hold-arms-by-sides', 'hollow-hold-arms-overhead'], level: 3 }],
};

describe('the RIR a note prescribes', () => {
  it('reads a number, a range (its top is the easiest set the plan allows) and none', () => {
    assert.deepEqual(noteRir('RIR 2. Double progression: at the top of the range.'), { lo: 2, hi: 2 });
    assert.deepEqual(noteRir('From the knees. RIR 1–2: stop when the lower back starts to sag.'), { lo: 1, hi: 2 });
    assert.deepEqual(noteRir('RIR 2-3.'), { lo: 2, hi: 3 });
    assert.deepEqual(noteRir('RIR 1: stop about 5 s before the lower back would lift.'), { lo: 1, hi: 1 });
    assert.equal(noteRir('Hips high. Why: obliques.'), null);
    assert.equal(noteRir(undefined), null);
    // A light week's change is not a prescription.
    assert.equal(noteRir('Deload: half the sets, RIR +3.'), null);
  });
});

describe('a planned set’s effort', () => {
  const effort = (item: Parameters<typeof setEffort>[0], ctx = CTX) => setEffort(item, ctx);

  it('is hard at RIR 3 or less and easy at 4 or more', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5].map((rir) => effort({ exercise: 'cable-crunch', rir }).value.effort), ['hard', 'hard', 'hard', 'hard', 'easy', 'easy']);
    const r = effort({ exercise: 'cable-crunch', name: 'Cable crunch', rir: 1 });
    assert.deepEqual(r.value, { effort: 'hard', by: 'rir' });
    assert.equal(r.reason.rule, 'volume.effort');
    assert.equal(r.reason.title, 'Set effort');
    assert.equal(r.reason.note, 'Cable crunch: RIR 1, near failure (RIR 3 or less).');
    assert.equal(VOLUME.hardRir, 3);
  });

  it('holds a hold against the user’s test: hard from 75 % of the tested best, easy under it, a heuristic', () => {
    const side = (topS: number) => effort({ exercise: 'side-plank', name: 'Side Plank', rir: null, hold: { topS, kind: 'side-plank' } });
    const top = side(60);
    assert.deepEqual(top.value, { effort: 'hard', by: 'hold', heuristic: true });
    assert.match(top.reason.note!, /60 s at the top is 100 % of your tested 60 s \(Thu 8 Oct\).*\(heuristic\), so this one is near failure\./);
    // 45 s is exactly 75 % of 60 s: the rule's "at least".
    assert.equal(side(45).value.effort, 'hard');
    const low = side(30);
    assert.deepEqual(low.value, { effort: 'easy', by: 'hold', heuristic: true });
    assert.match(low.reason.note!, /30 s at the top is 50 % of your tested 60 s.*\(heuristic\), so this one is not near failure\./);
    assert.deepEqual(low.reason.threshold, { hardRir: 3, holdShare: 0.75 });
    assert.equal(VOLUME.holdShare, 0.75);
    // A plank prescribed at 40 s against the self-check's 60 s plank.
    assert.equal(effort({ exercise: 'plank', rir: null, hold: { topS: 40, kind: 'plank' } }).value.effort, 'easy');
  });

  it('takes a hold’s RIR before its test', () => {
    const hollow = effort({ exercise: 'hollow-hold-arms-by-sides', rir: 1, hold: { topS: null, kind: 'hollow' } });
    assert.deepEqual(hollow.value, { effort: 'hard', by: 'rir' });
    assert.equal(effort({ exercise: 'side-plank', rir: 2, hold: { topS: 20, kind: 'side-plank' } }).value.effort, 'hard');
  });

  it('is unknown for a hold with no test, a hold with no time, and an item with no RIR', () => {
    const noTest = effort({ exercise: 'hollow-hold-arms-by-sides', name: 'Hollow hold', rir: null, hold: { topS: 30, kind: 'hollow' } });
    assert.deepEqual(noTest.value, { effort: 'unknown', by: 'none' });
    assert.match(noTest.reason.note!, /no tested hollow hold to judge it by: effort unknown, counted as near failure/);
    assert.match(effort({ exercise: 'side-plank', rir: null, hold: { topS: null, kind: 'side-plank' } }).reason.note!, /no time for the hold/);
    assert.match(effort({ exercise: 'l-sit', rir: null, hold: { topS: 10, kind: null } }).reason.note!, /no test of this hold/);
    assert.deepEqual(effort({ exercise: 'reverse-crunch', rir: null }).value, { effort: 'unknown', by: 'none' });
  });

  it('is easy for a lower level of a ladder than the user’s, whatever the note says', () => {
    const bug = effort({ exercise: 'dead-bug', name: 'Dead Bug', rir: null });
    assert.deepEqual(bug.value, { effort: 'easy', by: 'ladder' });
    assert.equal(bug.reason.note, 'Dead Bug: level 1 of the Core (abs) ladder, below your level 3, so not near failure.');
    assert.equal(effort({ exercise: 'dead-bug', rir: 1 }).value.by, 'ladder');
    // At the user's level or above: the RIR decides.
    assert.equal(effort({ exercise: 'hollow-hold-arms-by-sides', rir: 2 }).value.by, 'rir');
    assert.equal(effort({ exercise: 'hollow-hold-arms-overhead', rir: 2 }).value.by, 'rir');
    // The engine's own ladders repeat a movement over levels: its highest level counts.
    const engine: EffortContext = { holds: {}, ladders: [{ id: 'hollow', name: 'Core (abs)', levels: LADDER_BY_ID.get('hollow')!.levels.map((l) => l.exercise), level: 3 }] };
    assert.equal(effort({ exercise: 'hollow-hold', rir: 2 }, engine).value.effort, 'hard');
    assert.equal(effort({ exercise: 'dead-bug', rir: 2 }, engine).value.effort, 'easy');
  });

  it('knows the tested holds by name and reads the user’s bests from the tests and the self-check', () => {
    assert.deepEqual(['side-plank', 'hollow-hold-arms-by-sides', 'tuck-hollow-hold', 'plank', 'dead-bug', 'core-abs-your-level'].map((id) => holdKindOf([id])), ['side-plank', 'hollow', 'hollow', 'plank', null, null]);
    assert.equal(holdKindOf(['hollow-body', 'hollow-hold']), 'hollow');
    const tests = { sidePlankS: { value: 60, date: '2026-10-08' }, hollowS: { value: 40, date: '2026-10-08' }, pushups: { value: 30, date: '2026-11-02' } };
    assert.deepEqual(holdBests({ date: '2026-11-02', coreHold: { kind: 'plank', seconds: 60 } }, tests), {
      'side-plank': { seconds: 60, date: '2026-10-08', source: 'tests', field: 'sidePlankS' },
      hollow: { seconds: 40, date: '2026-10-08', source: 'tests', field: 'hollowS' },
      plank: { seconds: 60, date: '2026-11-02', source: 'self-check', field: 'coreHold' },
    });
    // A newer self-check hollow hold stands for the hollow hold; an older one does not.
    assert.equal(holdBests({ date: '2026-11-02', coreHold: { kind: 'hollow', seconds: 50 } }, tests).hollow!.seconds, 50);
    assert.equal(holdBests({ date: '2026-09-01', coreHold: { kind: 'hollow', seconds: 50 } }, tests).hollow!.seconds, 40);
    assert.deepEqual(holdBests(undefined, {}), {});
  });
});

const EX: Record<string, Exercise> = {
  squat: { name: 'Squat', unit: 'kg', increment: 2.5, muscles: { main: ['quads', 'glutes'], helps: ['abs'] } },
  crunch: { name: 'Cable crunch', unit: 'kg', increment: 2.5, muscles: { main: ['abs'], helps: ['obliques'] } },
  bug: { name: 'Dead bug', unit: 'kg', increment: 1, muscles: { main: ['abs'], helps: [] } },
  bench: { name: 'Bench', unit: 'kg', increment: 2.5, muscles: { main: ['chest'], helps: ['triceps'] } },
};
const tpl = (id: string, ...slots: ReturnType<typeof slot>[]): SessionTemplate => ({ id, name: id, kind: 'lift', slots });

describe('direct and indirect sets', () => {
  it('splits the planned week, its total unchanged; without an effort rule every direct set is of unknown effort', () => {
    const week = [tpl('a', slot('squat', 3, 6, 8), slot('crunch', 3, 8, 12, 1)), tpl('b', slot('squat', 3, 6, 8), slot('bug', 2, 8, 12), slot('bench', 3, 8, 12))];
    const plain = plannedSetsPerMuscle(week, EX).value;
    assert.deepEqual(plain.perWeek, { quads: 6, glutes: 6, abs: 8, obliques: 1.5, chest: 3, triceps: 1.5 });
    assert.deepEqual(plain.split['abs'], { direct: 5, indirect: 3, hardDirect: 0, unknown: 5 });
    assert.deepEqual(plain.split['obliques'], { direct: 0, indirect: 1.5, hardDirect: 0, unknown: 0 });
    assert.deepEqual(plain.efforts, []);
    const total: Record<string, number> = plain.perWeek;
    for (const [m, s] of Object.entries(plain.split)) assert.equal(s.direct + s.indirect, total[m], m);

    const ladder: EffortContext = { holds: {}, ladders: [{ id: 'hollow', name: 'Core (abs)', levels: ['bug', 'hollow'], level: 2 }] };
    const judged = plannedSetsPerMuscle(week, EX, { effort: (s) => setEffort({ exercise: s.exercise, name: EX[s.exercise]?.name, rir: s.rir === 2 && s.exercise === 'bug' ? null : s.rir }, ladder) }).value;
    assert.deepEqual(judged.perWeek, plain.perWeek);
    assert.deepEqual(judged.split['abs'], { direct: 5, indirect: 3, hardDirect: 3, unknown: 0 });
    assert.deepEqual(judged.efforts.map((e) => [e.template, e.exercise, e.sets, e.effort, e.by]), [
      ['a', 'squat', 3, 'hard', 'rir'],
      ['a', 'crunch', 3, 'hard', 'rir'],
      ['b', 'squat', 3, 'hard', 'rir'],
      ['b', 'bug', 2, 'easy', 'ladder'],
      ['b', 'bench', 3, 'hard', 'rir'],
    ]);
  });

  it('weights the split as the total, and splits the done sets too', () => {
    const week = [tpl('a', slot('crunch', 4, 8, 12, 1)), tpl('b', slot('squat', 4, 6, 8))];
    const v = plannedSetsPerMuscle(week, EX, { weights: { a: 0.75, b: 0.5 }, effort: (s) => setEffort({ exercise: s.exercise, rir: s.rir }, { holds: {}, ladders: [] }) }).value;
    assert.deepEqual([v.perWeek['abs'], v.split['abs']], [4, { direct: 3, indirect: 1, hardDirect: 3, unknown: 0 }]);
    const done = setsPerMuscle([session('2026-03-24', { level: 'full', logged: { squat: [set(60, 5), set(60, 5)], crunch: [set(20, 10)] } })], EX, '2026-03-23', '2026-03-29').value;
    assert.deepEqual(done.split['abs'], { direct: 1, indirect: 1 });
    assert.equal(done.perWeek['abs'], 2);
  });
});

describe('the priority minimum', () => {
  const split = (direct: number, indirect: number, hardDirect: number, unknown = 0) => ({ direct, indirect, hardDirect, unknown });

  it('needs 10 direct sets near failure: half credit and easy sets do not fill it', () => {
    const [abs] = checkVolume({ abs: 22.5 }, { priority: ['abs'], split: { abs: split(9, 13.5, 5) } });
    assert.equal(abs!.value.status, 'priority-direct-under');
    assert.deepEqual([abs!.value.direct, abs!.value.indirect, abs!.value.hardDirect, abs!.value.unknown], [9, 13.5, 5, 0]);
    assert.equal(abs!.reason.note, 'Abs: 22.5 sets in all, 5 of them direct and near failure; a priority muscle needs 10. Half credit from helping muscles and easy sets do not fill it. The total is also over 20, at the cap.');
    assert.equal((abs!.reason.threshold as { priorityDirect: number }).priorityDirect, 10);
  });

  it('counts sets of unknown effort, so a plan without RIR notes does not fail', () => {
    const [abs] = checkVolume({ abs: 12 }, { priority: ['abs'], split: { abs: split(12, 0, 0, 12) } });
    assert.equal(abs!.value.status, 'ok');
    assert.match(abs!.reason.note!, /^0 of the 12 are direct and near failure and 12 more direct of unknown effort \(counted\)/);
    const [short] = checkVolume({ abs: 14 }, { priority: ['abs'], split: { abs: split(9, 5, 6, 3) } });
    assert.equal(short!.value.status, 'priority-direct-under');
    assert.match(short!.reason.note!, /6 of them direct and near failure and 3 more direct of unknown effort \(counted\); a priority muscle needs 10/);
  });

  it('says how the minimum is met, and keeps the other statuses', () => {
    const r = checkVolume({ abs: 18, quads: 8, glutes: 12 }, { priority: ['abs', 'quads', 'glutes'], split: { abs: split(12, 6, 12), quads: split(8, 0, 2), glutes: split(10, 2, 10) } });
    assert.deepEqual(r.map((x) => x.value.status), ['priority-high', 'priority-low', 'ok']);
    assert.match(r[0]!.reason.note!, /12 of the 18 are direct and near failure; the priority minimum of 10 counts only those\.$/);
    // Under 10 in all is still priority-low, with the direct sets named.
    assert.match(r[1]!.reason.note!, /^8 sets a week is under 10 for a priority muscle \(priority tier 10-16\)\. 2 of the 8 are direct/);
  });

  it('leaves non-priority muscles as they were, and every muscle without a split', () => {
    const perWeek = { obliques: 16.5, chest: 3, lats: 21, abs: 22.5 };
    const sp = { obliques: split(4, 12.5, 0), chest: split(3, 0, 0), lats: split(21, 0, 21), abs: split(9, 13.5, 5) };
    const before = checkVolume(perWeek, { priority: ['lats'] });
    const after = checkVolume(perWeek, { priority: ['lats'], split: sp });
    assert.deepEqual(after.map((x) => x.value.status), before.map((x) => x.value.status));
    assert.deepEqual(after.map((x) => x.value.status), ['ok', 'below-minimum', 'at-cap', 'at-cap']);
    assert.deepEqual(after.slice(0, 2).map((x) => x.reason.note), before.slice(0, 2).map((x) => x.reason.note));
    // A priority muscle without a split: the total, as before.
    assert.equal(checkVolume({ abs: 22.5 }, { priority: ['abs'] })[0]!.value.status, 'at-cap');
  });
});

describe('the plan’s ab work on the vault', () => {
  const DATE = '2026-04-10';
  const reviewOf = (which: 'old' | 'new') => {
    const files = fixtureFiles('v');
    applyAbWork(files, which, 'v');
    const read = readVault(memoryIo(files, DATE), 'v', { asOf: DATE });
    return { read, review: buildReview(read.data, DATE) };
  };
  const absOf = (r: ReturnType<typeof reviewOf>['review']) => r.volume.bands.find((b) => b.value.muscle === 'abs')!;

  it('the old ab work: easy sets and half credit leave abs short of direct sets near failure', () => {
    const { review } = reviewOf('old');
    assert.equal(review.volume.weekKind, 'loading');
    const abs = absOf(review);
    assert.deepEqual(abs.value, { muscle: 'abs', sets: 15, tier: 'priority', priority: true, status: 'priority-direct-under', direct: 10, indirect: 5, hardDirect: 8, unknown: 0 });
    assert.equal(abs.reason.note, 'Abs: 15 sets in all, 8 of them direct and near failure; a priority muscle needs 10. Half credit from helping muscles and easy sets do not fill it.');
    const short = review.volume.planned.value.efforts.filter((e) => /^s\d$/.test(e.template)).map((e) => [e.template, e.exercise, e.sets, e.effort, e.by]);
    assert.deepEqual(short, [
      ['s1', 'hollow-hold-arms-by-sides', 2, 'hard', 'rir'],
      ['s1', 'pallof-press', 3, 'hard', 'rir'],
      ['s2', 'reverse-crunch', 3, 'hard', 'rir'],
      ['s2', 'side-plank', 2, 'hard', 'hold'],
      ['s3', 'dead-bug', 2, 'easy', 'ladder'],
      ['s3', 'side-plank', 2, 'hard', 'hold'],
    ]);
    assert.match(review.volume.planned.reason.note!, /Direct sets not near failure: Dead bug\./i);
    // The split is review's planned split; the total is unchanged.
    assert.equal(review.volume.planned.value.perWeek['abs'], 15);
  });

  it('the new ab work: about 12 direct sets near failure, so abs meet their minimum', () => {
    const { review } = reviewOf('new');
    const abs = absOf(review);
    assert.notEqual(abs.value.status, 'priority-direct-under');
    assert.deepEqual([abs.value.sets, abs.value.direct, abs.value.indirect, abs.value.hardDirect, abs.value.unknown], [18, 12, 6, 12, 0]);
    assert.match(abs.reason.note!, /12 of the 18 are direct and near failure; the priority minimum of 10 counts only those\./);
    const by = Object.fromEntries(review.volume.planned.value.efforts.filter((e) => /^s\d$/.test(e.template)).map((e) => [`${e.template} ${e.exercise}`, `${e.effort} ${e.by}`]));
    assert.deepEqual(by, {
      's1 cable-crunch': 'hard rir',
      's1 pallof-press': 'hard rir',
      's2 hollow-hold-arms-by-sides': 'hard rir',
      's2 side-plank': 'hard hold',
      's3 ab-wheel-rollout': 'hard rir',
      's3 side-plank': 'hard hold',
    });
  });

  it('a muscle that is not a priority keeps its status', () => {
    for (const which of ['old', 'new'] as const) {
      const { read, review } = reviewOf(which);
      const ctxFree = checkVolume(review.volume.planned.value.perWeek, { muscles: read.data.plan.muscles, priority: ['abs'] });
      for (const b of review.volume.bands.filter((x) => !x.value.priority)) assert.equal(b.value.status, ctxFree.find((x) => x.value.muscle === b.value.muscle)!.value.status, `${which} ${b.value.muscle}`);
    }
  });

  it('the Plan screen’s rows carry the split and flag the short priority muscle', () => {
    for (const [which, under] of [['old', true], ['new', false]] as const) {
      const files = fixtureFiles('v');
      applyAbWork(files, which, 'v');
      const p = buildPlan(readVault(memoryIo(files, DATE), 'v', { asOf: DATE }), DATE);
      assert.ok('volume' in p);
      const abs = p.volume!.muscles.find((m) => m.muscle === 'abs')!;
      assert.equal(abs.directUnder, under, which);
      assert.equal(abs.status, under ? 'below' : 'above', which);
      assert.equal(abs.hardDirect, under ? 8 : 12);
      // At a glance names the short muscle apart from those under their minimum.
      const vol = planGlance(p as Parameters<typeof planGlance>[0], { weekTarget: null, targets: null, desk: null, links: 0 }).sections.find((x) => x.id === 'vol')!;
      const words = vol.status.map((r) => (typeof r === 'string' ? r : r.b)).join('');
      if (under) assert.match(words, /Abs short of direct sets near failure/);
      else assert.doesNotMatch(words, /near failure/);
    }
  });
});
