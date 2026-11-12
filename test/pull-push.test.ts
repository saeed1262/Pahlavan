// Pull to push (core/volume.ts): weekly pulling against pushing sets, held
// against the posture emphasis's ratio. `check` holds a plan to it and
// `review` reports the written plan with it, on the vault's muscle map.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import type { Exercise, Profile, SessionTemplate } from '../src/core/schema.ts';
import { postureEmphasis, PULL_PUSH, pullPushAim, pullPushSets } from '../src/core/volume.ts';
import { buildPlan } from '../src/report/plan-screen.ts';
import { buildReview } from '../src/report/review.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

const EX: Record<string, Exercise> = {
  row: { name: 'Row', pattern: 'horizontal-pull', unit: 'kg', increment: 2.5, muscles: { main: ['upper-back', 'lats'], helps: ['biceps'] } },
  fly: { name: 'Rear delt fly', pattern: 'rear-delt', unit: 'kg', increment: 1, muscles: { main: ['shoulders'], helps: [] } },
  bench: { name: 'Bench', pattern: 'horizontal-push', unit: 'kg', increment: 2.5, muscles: { main: ['chest'], helps: ['triceps'] } },
  // No pattern (no catalogue match): told by its main muscles on the map.
  inverted: { name: 'Ring row', unit: 'kg', increment: 1, muscles: { main: ['lats'], helps: [] } },
  dips: { name: 'Bench dip', unit: 'kg', increment: 1, muscles: { main: ['triceps'], helps: ['chest'] } },
  curl: { name: 'Curl', pattern: 'biceps', unit: 'kg', increment: 1, muscles: { main: ['biceps'], helps: [] } },
  bike: { name: 'Bike', kind: 'cardio' },
};
const tpl = (id: string, ...slots: [string, number][]): SessionTemplate => ({ id, name: id, kind: 'lift', slots: slots.map(([exercise, sets]) => ({ exercise, sets, repRange: [8, 12], rir: 2 })) });

describe('pullPushSets', () => {
  it('counts pulling and pushing sets by pattern, else by the main muscles; isolation and cardio are neither', () => {
    const r = pullPushSets([tpl('a', ['row', 3], ['fly', 3], ['bench', 3], ['curl', 3], ['bike', 1]), tpl('b', ['inverted', 3], ['dips', 3])], EX, { aim: { target: 2, floor: 1.8, why: 'finding' as const } });
    assert.deepEqual([r.value.pull, r.value.push, r.value.ratio], [9, 6, 1.5]);
    assert.deepEqual(r.value.pulling, [{ exercise: 'row', sets: 3, by: 'pattern' }, { exercise: 'fly', sets: 3, by: 'pattern' }, { exercise: 'inverted', sets: 3, by: 'muscles' }]);
    assert.deepEqual(r.value.pushing.map((x) => [x.exercise, x.by]), [['bench', 'pattern'], ['dips', 'muscles']]);
    assert.equal(r.reason.rule, 'volume.pull-push');
    assert.equal(r.reason.title, 'Pull to push');
  });

  it('holds the ratio against the posture finding: at least 1.8, aiming for 2; the note says what reaches it', () => {
    assert.deepEqual(PULL_PUSH, { target: 2, floor: 1.8 });
    const below = pullPushSets([tpl('a', ['row', 7], ['bench', 4])], EX, { aim: { target: 2, floor: 1.8, why: 'finding' as const } });
    assert.deepEqual([below.value.status, below.value.target, below.value.floor], ['below', 2, 1.8]);
    assert.match(below.reason.note ?? '', /7 pulling to 4 pushing sets a week \(1\.75 to 1\): under the 1\.8 .* About 1 more pulling set/);
    assert.equal(pullPushSets([tpl('a', ['row', 8], ['bench', 4])], EX, { aim: { target: 2, floor: 1.8, why: 'finding' as const } }).value.status, 'ok');
    assert.equal(pullPushSets([tpl('a', ['row', 9], ['bench', 5])], EX, { aim: { target: 2, floor: 1.8, why: 'finding' as const } }).value.status, 'ok', '1.8 exactly');
    const none = pullPushSets([tpl('a', ['row', 3], ['bench', 4])], EX, { aim: null });
    assert.deepEqual([none.value.status, none.value.target, none.value.floor], ['no-target', null, null]);
    assert.equal(pullPushSets([tpl('a', ['row', 3])], EX, { aim: { target: 2, floor: 1.8, why: 'finding' as const } }).value.status, 'no-pushing');
  });

  it('weighs each template as the planned volume does (target / types)', () => {
    const r = pullPushSets([tpl('a', ['row', 4]), tpl('b', ['bench', 4])], EX, { aim: { target: 2, floor: 1.8, why: 'finding' as const }, weights: { a: 0.75, b: 0.75 } });
    assert.deepEqual([r.value.pull, r.value.push, r.value.ratio], [3, 3, 1]);
  });

  it('the aim: 2 to 1 only with a forward-head, rounded-shoulders finding; a posture goal alone, at least 1 to 1; else none', () => {
    const finding = [{ area: 'x', seen: 'x', confidence: 'medium' as const, emphasis: 'x', kind: 'forward-head-rounded-shoulders' as const }];
    const goal = [{ id: 'p', kind: 'posture' as const, label: 'Posture', importance: 8, confidence: 8 }];
    assert.deepEqual(pullPushAim({ emphasis: finding, goals: goal }), { target: 2, floor: 1.8, why: 'finding' });
    assert.deepEqual(pullPushAim({ emphasis: [], goals: goal }), { target: 1.2, floor: 1, why: 'goal' });
    assert.equal(pullPushAim({ emphasis: [], goals: [] }), null);
    assert.equal(pullPushAim(null), null);
    // A posture goal alone: 7 to 6 is fine (over 1), where the finding would want 11.
    const g = pullPushSets([tpl('a', ['row', 7], ['bench', 6])], EX, { aim: pullPushAim({ emphasis: [], goals: goal }) });
    assert.deepEqual([g.value.status, g.value.floor], ['ok', 1]);
    assert.match(g.reason.note ?? '', /the posture goal holds/);
  });

  it('the posture emphasis (the rear-delt work, the stretches): a forward-head, rounded-shoulders assessment or a posture goal', () => {
    const p = (emphasis: Profile['emphasis'], goals: Profile['goals']) => postureEmphasis({ emphasis, goals });
    assert.equal(p([{ area: 'x', seen: 'x', confidence: 'medium', emphasis: 'x', kind: 'forward-head-rounded-shoulders' }], []), true);
    assert.equal(p([], [{ id: 'p', kind: 'posture', label: 'Posture', importance: 8, confidence: 8 }]), true);
    assert.equal(p([{ area: 'x', seen: 'x', confidence: 'medium', emphasis: 'x', kind: 'overhead-limited' }], []), false);
    assert.equal(postureEmphasis(null), false);
  });
});

describe('review: pull to push of the written plan', () => {
  const DATE = '2026-04-12';
  const reviewOf = (edit?: (profile: Record<string, unknown>) => void) => {
    const f = fixtureFiles('v');
    const path = 'v/3-Personal/Fitness/Coach/profile.json';
    if (edit) {
      const profile = JSON.parse(f[path]!);
      edit(profile);
      f[path] = JSON.stringify(profile);
    }
    const read = readVault(memoryIo(f, DATE), 'v', { asOf: DATE });
    return { read, review: buildReview(read.data, DATE) };
  };

  it('counts this week\'s plan with the planned volume\'s weights, against the profile\'s posture emphasis', () => {
    const { read, review } = reviewOf();
    const pp = review.volume.pullPush;
    const weights = (review.volume.planned.reason.inputs as { weights: Record<string, number> }).weights;
    assert.deepEqual(pp.reason.inputs['weights'], weights);
    const again = pullPushSets(read.data.program.macrocycle.phases.flatMap((p) => p.mesocycles.flatMap((m) => m.weeks)).find((w) => w.start <= DATE && DATE <= '2026-04-18')!.sessions, read.data.program.exercises, { aim: pullPushAim(read.data.profile), weights });
    assert.deepEqual([pp.value.pull, pp.value.push, pp.value.ratio], [again.value.pull, again.value.push, again.value.ratio]);
    assert.ok(pp.value.pull > 0 && pp.value.push > 0);
    assert.equal(pp.value.target, PULL_PUSH.target, 'the fixture profile has the posture emphasis');
    assert.ok(['ok', 'below'].includes(pp.value.status));
  });

  it('without the posture emphasis there is no target', () => {
    const { review } = reviewOf((p) => {
      p['emphasis'] = [];
      p['goals'] = (p['goals'] as { kind: string }[]).filter((g) => g.kind !== 'posture');
    });
    assert.equal(review.volume.pullPush.value.status, 'no-target');
    assert.match(review.volume.pullPush.reason.note ?? '', /No target: the profile has no posture finding/);
  });

  it('the Plan screen carries it for the Sets per muscle card', () => {
    const { read, review } = reviewOf();
    const p = buildPlan(read, DATE);
    assert.ok('volume' in p);
    assert.deepEqual(p.volume?.pullPush, { pull: review.volume.pullPush.value.pull, push: review.volume.pullPush.value.push, ratio: review.volume.pullPush.value.ratio, target: 2, floor: 1.8, status: review.volume.pullPush.value.status, note: review.volume.pullPush.reason.note, rule: 'volume.pull-push' });
  });
});
