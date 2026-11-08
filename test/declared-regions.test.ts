// Declared weak regions everywhere they show: the region's muscle is a
// priority muscle in every count (review, check, Progress, Plan); the done
// views judge sets by effort before a declared region reads as met; a short
// region no catalogue option can cover says so instead of "under"; and the
// region options leave out what the person's findings rule out.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { CATALOGUE } from '../src/core/data/exercises.ts';
import type { Exercise, Session } from '../src/core/schema.ts';
import { priorityMuscles, setsPerMuscle, type VolumeSplit } from '../src/core/volume.ts';
import { buildCheck, type CheckReport } from '../src/report/check.ts';
import { buildProgress } from '../src/report/progress.ts';
import { regionOptionsFor } from '../src/report/region-options.ts';
import { buildReview } from '../src/report/review.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

type Json = Record<string, any>;
const PLAN = 'v/3-Personal/Fitness/plan-data.json';
const PROFILE = 'v/3-Personal/Fitness/Coach/profile.json';
/** A loading week of the fixture, after its abdominal constraint. */
const DATE = '2026-04-10';
const CLEAN = '2026-04-20';

function read(edit: (plan: Json, profile: Json) => void, date = DATE) {
  const files = fixtureFiles('v');
  const plan = JSON.parse(files[PLAN]!);
  const profile = JSON.parse(files[PROFILE]!);
  edit(plan, profile);
  files[PLAN] = JSON.stringify(plan);
  files[PROFILE] = JSON.stringify(profile);
  return readVault(memoryIo(files, date), 'v', { asOf: date });
}
const check = (edit: (plan: Json, profile: Json) => void): CheckReport => buildCheck(read(edit, CLEAN), CLEAN);
const find = (r: CheckReport, code: string) => r.findings.find((f) => f.code === code && f.level === 'warning');
const itemOf = (plan: Json, type: string, name: string) => plan.sessions[type].find((i: Json) => i.name === name);

describe('a confirmed lagging area makes its muscle a priority everywhere', () => {
  const lagging = (confirmed?: boolean) => ({ area: 'Shoulders', seen: 'Narrow from the front', confidence: 'medium', emphasis: 'Shoulders as a priority', kind: 'lagging-area', muscles: ['shoulders'], ...(confirmed === undefined ? {} : { confirmed }) });

  it('in the one list: confirmed, or in a profile from before the question; never unanswered or declined', () => {
    assert.deepEqual(priorityMuscles({ priorityMuscles: ['glutes'], emphasis: [lagging(true)] } as never), ['glutes', 'shoulders']);
    assert.deepEqual(priorityMuscles({ priorityMuscles: ['glutes'], emphasis: [lagging()] } as never), ['glutes', 'shoulders'], 'no answers anywhere: as the generator reads it');
    assert.deepEqual(priorityMuscles({ priorityMuscles: ['glutes'], emphasis: [lagging(false)] } as never), ['glutes']);
    // A profile that records answers elsewhere: an unanswered row is a preference only.
    assert.deepEqual(priorityMuscles({ priorityMuscles: ['glutes'], emphasis: [lagging()], selfCheck: { date: '2026-04-01', confirmed: {} } } as never), ['glutes']);
  });

  it('in the plan check and the review\'s bands', () => {
    const r = check((_p, pr) => (pr.emphasis = [lagging(true)]));
    assert.ok(find(r, 'priority-under')!.items.some((x) => x.startsWith('shoulders: ')), find(r, 'priority-under')!.items.join('\n'));
    const declined = check((_p, pr) => (pr.emphasis = [lagging(false)]));
    assert.equal(find(declined, 'priority-under'), undefined);
    const data = read((_p, pr) => (pr.emphasis = [lagging(true)]));
    assert.equal(buildReview(data.data, DATE).volume.bands.find((b) => b.value.muscle === 'shoulders')!.value.priority, true);
  });
});

describe('a declared weak region makes its muscle a priority everywhere', () => {
  it('in the one list of effective priority muscles', () => {
    assert.deepEqual(priorityMuscles({ priorityMuscles: ['glutes'], priorityRegions: ['shoulders-side'], emphasis: [] }), ['glutes', 'shoulders']);
    assert.deepEqual(priorityMuscles({ priorityRegions: ['quads-rf', 'quads-vasti'], emphasis: [] }, ['chest']), ['chest', 'quads']);
    assert.deepEqual(priorityMuscles(null, ['chest']), ['chest']);
  });

  it('in the plan check: its muscle is held to the priority 10–16', () => {
    const r = check((_p, pr) => (pr.priorityRegions = ['shoulders-side']));
    assert.ok(find(r, 'priority-under')!.items.some((x) => x.startsWith('shoulders: ')), find(r, 'priority-under')!.items.join('\n'));
    assert.equal(find(check(() => {}), 'priority-under'), undefined, 'the fixture: glutes in band');
  });

  it('in the review\'s bands and on the Progress and Plan screens', () => {
    const data = read((_p, pr) => (pr.priorityRegions = ['shoulders-side']));
    const shoulders = buildReview(data.data, DATE).volume.bands.find((b) => b.value.muscle === 'shoulders')!.value;
    assert.equal(shoulders.priority, true);
    const v = buildProgress(data, DATE).volume!;
    assert.ok(v.priority.includes('shoulders') && v.priority.includes('glutes'));
    for (const k of ['week', 'four', 'plan'] as const) assert.equal(v.views[k].muscles.find((m) => m.muscle === 'shoulders')!.priority, true, k);
  });
});

describe('the done views judge a set\'s effort before a declared region reads as met', () => {
  const vasti = (edit: (plan: Json, profile: Json) => void) => {
    const v = buildProgress(read((p, pr) => {
      pr.priorityRegions = ['quads-vasti'];
      pr.equipment.push('machines');
      edit(p, pr);
    }), DATE).volume!;
    return (k: 'week' | 'four') => v.views[k].muscles.find((m) => m.muscle === 'quads')!.regions.find((r) => r.id === 'quads-vasti')!;
  };

  it('counts a Standard session\'s sets at the plan item\'s RIR: at RIR 4 or more they are not near failure', () => {
    // This week: goblet squats (4 sets, the item's RIR 2) and split squats (3 sets, no RIR: unknown, counted).
    const met = vasti(() => {})('week');
    assert.deepEqual([met.direct, met.counted, met.status], [7, 7, 'ok']);
    const easy = vasti((p) => (itemOf(p, 'A', 'Goblet Squat').rir = 5))('week');
    assert.deepEqual([easy.direct, easy.counted, easy.status], [7, 3, 'short']);
    assert.match(easy.note ?? '', /3 direct sets near failure a week \(3 of unknown effort, counted\), under the 6/);
    assert.equal(vasti((p) => (itemOf(p, 'A', 'Goblet Squat').rir = 5))('four').status, 'short');
  });

  it('counts a logged set at its own RIR, else the snapshot\'s; a ladder level under the person\'s is easy', () => {
    const exercises: Record<string, Exercise> = {
      squat: { name: 'Squat', muscles: { main: ['quads'], helps: [], regions: ['quads-vasti'] } },
    };
    const set = (rir?: number) => ({ weight: 50, unit: 'kg' as const, reps: 8, ...(rir !== undefined ? { rir } : {}) });
    const sessions: Session[] = [
      { date: '2026-04-06', trackingLevel: 'full', exercises: [{ exercise: 'squat', sets: [set(2), set(5), set()] }], plan: { weekKind: 'loading', template: 'a', slots: [{ exercise: 'squat', sets: 3, repRange: [6, 10], rir: 1 }] } } as Session,
    ];
    const effort = (it: { rir: number | null; planned: { rir: number } | null }) => {
      const rir = it.rir ?? it.planned?.rir ?? null;
      return rir === null ? 'unknown' : rir <= 3 ? 'hard' : 'easy';
    };
    const t = setsPerMuscle(sessions, exercises, '2026-04-06', '2026-04-12', { effort }).value;
    const q = t.split['quads'] as VolumeSplit & { hardDirect: number; unknown: number };
    // RIR 2 hard; RIR 5 easy; no RIR logged: the snapshot's RIR 1, hard.
    assert.deepEqual([q.direct, q.hardDirect, q.unknown], [3, 2, 0]);
    assert.deepEqual(t.regions!['quads-vasti'], { direct: 3, indirect: 0, hardDirect: 2, unknown: 0 });
    // Without the effort rule the tally is as before: no effort fields.
    assert.deepEqual(setsPerMuscle(sessions, exercises, '2026-04-06', '2026-04-12').value.split['quads'], { direct: 3, indirect: 0 });
  });
});

describe('a short region no catalogue option can cover', () => {
  it('reads "uncoverable" on Progress and Plan, not short', () => {
    const rf = (machines: boolean) => {
      const v = buildProgress(read((_p, pr) => {
        pr.priorityMuscles = ['quads'];
        if (machines) pr.equipment.push('machines');
      }), DATE).volume!;
      return v.views.plan.muscles.find((m) => m.muscle === 'quads')!.regions.find((r) => r.id === 'quads-rf')!;
    };
    assert.equal(rf(true).status, 'short');
    const none = rf(false);
    assert.equal(none.status, 'uncoverable');
    assert.match(none.note ?? '', /No catalogue movement that biases it fits your equipment, the Ledger and your findings/);
  });
});

describe('region options leave out what the person\'s findings rule out', () => {
  const overhead = { area: 'Overhead reach', seen: 'Ribs flare reaching overhead', confidence: 'medium', emphasis: 'Landmine pressing', kind: 'overhead-limited' };
  const options = (edit: (pr: Json) => void) => {
    const r = check((_p, pr) => {
      pr.priorityRegions = ['shoulders-side'];
      edit(pr);
    });
    return find(r, 'region-declared-short')!.items[0]!.split('; options: ')[1];
  };

  it('a confirmed limited overhead reach takes the overhead presses out of the side delts\' options', () => {
    assert.equal(options(() => {}), 'Dumbbell lateral raise, Cable lateral raise, Seated dumbbell shoulder press, Pike push-up, Elevated pike push-up (feet on a chair or box)');
    assert.equal(options((pr) => pr.emphasis.push({ ...overhead, confirmed: true })), 'Dumbbell lateral raise, Cable lateral raise');
    // Declined, or unanswered in a profile that records answers: a preference only, nothing ruled out.
    assert.equal(options((pr) => pr.emphasis.push({ ...overhead, confirmed: false })), 'Dumbbell lateral raise, Cable lateral raise, Seated dumbbell shoulder press, Pike push-up, Elevated pike push-up (feet on a chair or box)');
    assert.equal(options((pr) => pr.emphasis.push(overhead, { ...overhead, kind: 'knees-in', confirmed: true })), 'Dumbbell lateral raise, Cable lateral raise, Seated dumbbell shoulder press, Pike push-up, Elevated pike push-up (feet on a chair or box)');
  });

  it('says a finding ruled a movement out', () => {
    const data = read((_p, pr) => {
      pr.equipment = ['dumbbells', 'bench'];
      pr.emphasis.push({ ...overhead, confirmed: true });
      pr.preferences.dislikes.push('db-lateral-raise');
    }).data;
    const o = regionOptionsFor(data, CLEAN)('shoulders-side');
    assert.deepEqual(o.options.map((e) => e.id), []);
    assert.ok(o.blocked.includes('Seated dumbbell shoulder press (a finding rules it out)'), o.blocked.join('\n'));
    assert.ok(o.blocked.includes('Dumbbell lateral raise (disliked)'));
    assert.ok(CATALOGUE.some((e) => e.id === 'band-lateral-raise'), 'a band would have covered it');
  });
});
