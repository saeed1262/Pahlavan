// The plan check (src/report/check.ts) on the synthetic vault, edited per
// case: each hard error, the main evidence warnings with their grades, the
// information notes, and the overrides (a stated reason turns a warning into
// information, never a hard error; one that matches nothing is listed).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { readOverrides } from '../src/core/overrides.ts';
import { buildCheck, type CheckOptions, type CheckReport, type FindingLevel } from '../src/report/check.ts';
import { planDiff, sameJson } from '../src/report/plan-write.ts';
import { fixtureFiles, fixtureWithWhy, memoryIo } from './helpers.ts';

type Json = Record<string, any>;
const PLAN = 'v/3-Personal/Fitness/plan-data.json';
const PROFILE = 'v/3-Personal/Fitness/Coach/profile.json';
const LEDGER = 'v/3-Personal/Fitness/Coach/ledger.json';
/** After the abdominal constraint ends (2026-04-19): the fixture has no hard error. Plan week 8, the light week ending mesocycle 2. */
const CLEAN = '2026-04-20';

function check(edit: (plan: Json, profile: Json, ledger: Json) => void = () => {}, date = CLEAN, opts: CheckOptions = {}): CheckReport {
  const files = fixtureFiles('v');
  const plan = JSON.parse(files[PLAN]!);
  const profile = JSON.parse(files[PROFILE]!);
  const ledger = JSON.parse(files[LEDGER]!);
  edit(plan, profile, ledger);
  files[PLAN] = JSON.stringify(plan);
  files[PROFILE] = JSON.stringify(profile);
  files[LEDGER] = JSON.stringify(ledger);
  return buildCheck(readVault(memoryIo(files), 'v', { asOf: date }), date, opts);
}
const find = (r: CheckReport, code: string, level?: FindingLevel) => r.findings.find((f) => f.code === code && (!level || f.level === level));
const itemOf = (plan: Json, type: string, name: string) => plan.sessions[type].find((i: Json) => i.name === name);
const fixturePlan = () => JSON.parse(fixtureFiles('v')[PLAN]!) as Json;
/**
 * The made-up vault's band external rotation is a rear-delt movement in the
 * catalogue, so it counts as pulling: 12 pulling to 6.5 pushing sets meets the
 * posture finding's 1.8 to 1. A fourth set of the bench press brings the
 * pushing to 8 and the pull-push warning back.
 */
const morePressing = (p: Json) => (itemOf(p, 'A', 'Flat DB Bench Press').sr = '4 × 6–8');

describe('check: the fixture vault', () => {
  it('has no hard error once the abdominal constraint has ended, and warnings with rule, grade and reason', () => {
    assert.equal(find(check(), 'pull-push'), undefined, '12 pulling to 6.5 pushing sets');
    const r = check(morePressing);
    assert.equal(r.summary.ok, true);
    assert.equal(r.summary.errors, 0);
    assert.deepEqual(r.findings.map((f) => f.level), [...r.findings.map((f) => f.level)].sort((a, b) => ['error', 'warning', 'info'].indexOf(a) - ['error', 'warning', 'info'].indexOf(b)), 'errors, then warnings, then information');
    const pp = find(r, 'pull-push', 'warning')!;
    assert.equal(pp.rule, 'volume.pull-push');
    assert.equal(pp.grade, 'heuristic');
    assert.match(pp.items[0]!, /12 pulling to 8 pushing sets a week \(1\.5 to 1\); the posture finding holds at least 1\.8 to 1/);
    assert.ok(pp.reason);
    // The log's and the body record's single-record notes are review's, not the plan's.
    for (const code of ['bad-value', 'unknown-field', 'bad-habit-key', 'test-not-number', 'checkins-missing']) assert.equal(find(r, code), undefined, code);
  });

  it('turns the adapter\'s notes into findings: what was read around is information', () => {
    const r = check();
    assert.equal(find(r, 'muscle-tags-differ')!.level, 'warning');
    assert.equal(find(r, 'snapshot-rebuilt')!.level, 'info');
    // Every movement the made-up vault plans is a catalogue movement; one that is not is information.
    assert.equal(find(r, 'unknown-exercise'), undefined);
    assert.equal(find(check((p) => p.sessions.A.push({ name: 'Cuban Press', sr: '2 × 12' })), 'unknown-exercise')!.level, 'info');
    // The burpee is conditioning in the catalogue: no sets, so its guide entry's tags differ.
    assert.ok(find(r, 'muscle-tags-differ')!.items.includes('Burpee: guide main quads, chest, helps shoulders, abs | catalogue none'));
    assert.equal(find(r, 'legacy-default')!.level, 'info');
    assert.deepEqual(find(r, 'rir-in-note', 'info')!.items, ['A Goblet Squat: RIR 2 (from the note)', 'B Romanian Deadlift: RIR 3 (from the note)']);
  });
});

describe('check: hard errors (no override clears them)', () => {
  it('ledger-blocked: a movement an active Ledger constraint rules out, by tag or by id', () => {
    const r = check(() => {}, '2026-04-12');
    const e = find(r, 'ledger-blocked', 'error')!;
    assert.match(e.items[0]!, /^B Romanian Deadlift: ruled out by abdominal-wall through Sun 19 Apr; swaps: /);
    assert.equal(r.summary.ok, false);
    const byId = check((_p, _pr, l) => l.constraints.push({ id: 'knee', area: 'knee', noMovements: ['goblet-squat'] }));
    assert.match(find(byId, 'ledger-blocked', 'error')!.items[0]!, /^A Goblet Squat: ruled out by knee/);
  });

  it('screening-blocked and screening-limit: the safety screen\'s outcome', () => {
    assert.ok(find(check((_p, pr) => (pr.screening.outcome = 'blocked')), 'screening-blocked', 'error'));
    const r = check((p, pr) => {
      pr.screening.outcome = 'conservative';
      itemOf(p, 'B', 'Zone 2 finisher').timed = { rounds: 4, workMin: 1, restMin: 1 };
      itemOf(p, 'B', 'Zone 2 finisher').sr = '7 min';
    });
    const items = find(r, 'screening-limit', 'error')!.items;
    assert.ok(items.includes('A Goblet Squat: RIR 2; the conservative screen needs 4 or more'), items.join('\n'));
    assert.ok(items.some((x) => /^B Zone 2 finisher: hard intervals/.test(x)));
    // Under a screen's RIR floor the type targets give way to it.
    assert.equal(find(r, 'rir-by-type'), undefined);
  });

  it('invalid-data: an item with no sr, an unknown key, a type sessions does not hold, an unknown lifts key, a malformed override list', () => {
    const r = check((p) => {
      p.sessions.A.push({ name: 'Mystery' });
      itemOf(p, 'A', 'Face Pull').rpe = 8;
      p.shortTypes.push('S9');
      p.lifts['Goblet Squat'].target = 50;
      p.overrides = { code: 'rest' };
    });
    const items = find(r, 'invalid-data', 'error')!.items;
    for (const re of [/^A Mystery has no sr/, /^A Face Pull: unknown key\(s\) rpe/, /^shortTypes names "S9"/, /^lifts\["Goblet Squat"\]: unknown key\(s\) target/, /^overrides is not a list/]) assert.ok(items.some((x) => re.test(x)), `${re}\n${items.join('\n')}`);
  });

  it('a field Pahlavan cannot read (plan-item-field), an unknown ladder and malformed standing rules block the write', () => {
    const r = check((p) => {
      itemOf(p, 'A', 'Face Pull').rir = 'two';
      itemOf(p, 'S1', 'Dead Bug').ladder = 'nope';
      p.rules = { lightWeeks: { every: 'often' } };
    });
    for (const code of ['plan-item-field', 'unknown-ladder', 'rules-invalid']) assert.equal(find(r, code)?.level, 'error', code);
  });

  it('muscle-tags-duplicate: a muscle in main and helps of an entry whose tags count', () => {
    const r = check((p) => (p.guide['Goblet Squat'].muscles = { main: ['quads', 'glutes'], helps: ['glutes'], override: 'counted my way' }));
    assert.deepEqual(find(r, 'muscle-tags-duplicate', 'error')!.items, ['Goblet Squat: glutes in main and helps']);
    // The catalogue's tags count for an entry without an override: its copy differing is a warning, not this error.
    assert.equal(find(check((p) => (p.guide['Goblet Squat'].muscles = { main: ['quads', 'glutes'], helps: ['glutes'] })), 'muscle-tags-duplicate'), undefined);
  });

  it('no-lift-entry: a logged lift with no lifts entry (and a third logged item is a logged-count warning)', () => {
    const r = check((p) => (itemOf(p, 'B', 'Bulgarian Split Squat').logged = true));
    assert.deepEqual(find(r, 'no-lift-entry', 'error')!.items, ['B Bulgarian Split Squat']);
    assert.match(find(r, 'logged-count', 'warning')!.items[0]!, /^B: 3 items marked logged/);
  });

  it('override-without-reason', () => {
    const r = check((p) => {
      morePressing(p);
      p.overrides = [{ code: 'pull-push' }, { code: 'rest', item: 'B Bulgarian Split Squat', reason: '  ' }];
    });
    assert.deepEqual(find(r, 'override-without-reason', 'error')!.items, ['overrides[0] (pull-push)', 'overrides[1] (rest: B Bulgarian Split Squat)']);
    // An override with no reason overrides nothing.
    assert.equal(find(r, 'pull-push')!.level, 'warning');
  });

  it('a draft that is not JSON is an error naming the draft', () => {
    const files = fixtureFiles('v');
    const read = readVault(memoryIo(files), 'v', { asOf: CLEAN, plan: { text: '{ nope', file: 'draft.json' } });
    const r = buildCheck(read, CLEAN);
    assert.match(find(r, 'json', 'error')!.items[0]!, /^draft\.json is not valid JSON/);
    assert.equal(r.summary.ok, false);
  });
});

describe('check: evidence warnings', () => {
  it('volume: over the cap and the per-session cap (heuristic, weak), a priority muscle under or over its tier (moderate)', () => {
    const r = check((p, pr) => {
      itemOf(p, 'B', 'Seated Cable Row').sr = '9 × 10–12';
      pr.priorityMuscles = ['glutes', 'chest'];
    }, '2026-04-14');
    const cap = find(r, 'volume-over-cap')!;
    assert.deepEqual([cap.items, cap.grade, cap.rule], [['upper-back: 22.5 sets a week, over the cap of 20'], 'heuristic', 'volume.bands']);
    const session = find(r, 'session-cap')!;
    assert.equal(session.grade, 'weak');
    assert.deepEqual(session.items, ['B lats: 9 direct sets in one session, over about 8', 'B upper-back: 9 direct sets in one session, over about 8']);
    assert.deepEqual(find(r, 'priority-under')!.items, ['chest: 6.5 sets a week, under 10 for a priority muscle (10–16)']);
    assert.deepEqual(find(r, 'priority-over')!.items, ['glutes: 17.25 sets a week, over 16 (the priority tier is 10–16)']);
    assert.equal(find(r, 'priority-over')!.grade, 'moderate');
    assert.ok(find(r, 'volume-below-minimum')!.items.includes('calves: 0 sets a week, under the minimum dose of 4'));
  });

  it('the posture emphasis lets upper back and lats past 16 (to the cap) without a warning', () => {
    const edit = (p: Json, pr: Json) => {
      itemOf(p, 'B', 'Seated Cable Row').sr = '6 × 10–12';
      pr.priorityMuscles = ['upper-back'];
    };
    assert.equal(find(check(edit), 'priority-over'), undefined);
    const plain = check((p, pr) => {
      edit(p, pr);
      pr.emphasis = [];
      pr.goals = pr.goals.filter((g: Json) => g.kind !== 'posture');
    });
    assert.deepEqual(find(plain, 'priority-over')!.items, ['upper-back: 18 sets a week, over 16 (the priority tier is 10–16)']);
  });

  it('RIR by exercise type, rep ranges and rest', () => {
    const r = check((p) => {
      Object.assign(itemOf(p, 'A', 'Face Pull'), { rir: 3, rest: '90 s' });
      Object.assign(itemOf(p, 'A', 'Flat DB Bench Press'), { rir: 0, rest: '90 s' });
      Object.assign(itemOf(p, 'B', 'Seated Cable Row'), { sr: '3 × 15–20', rir: 1 });
      p.sessions.B.push({ name: 'Band Pull-Apart', sr: '2 × 25–35', rest: '90 s', note: 'Why: posture.' });
    });
    const rir = find(r, 'rir-by-type')!;
    assert.equal(rir.grade, 'heuristic');
    assert.deepEqual(rir.items, ['A Flat DB Bench Press: RIR 0; a compound lift aims for 1–3', 'A Face Pull: RIR 3; isolation and machine work aims for 0–2']);
    assert.deepEqual(find(r, 'rep-range')!.items, ['B Band Pull-Apart: up to 35 reps, past the about 30 that size studies cover']);
    assert.equal(find(r, 'rep-range')!.grade, 'strong');
    assert.deepEqual(find(r, 'rep-range-rir')!.items, ['B Seated Cable Row: up to 20 reps at RIR 1; reps in reserve are judged poorly past about 15']);
    assert.deepEqual(find(r, 'rest-heavy')!.items, ['A Flat DB Bench Press: rest 1.5 min on a heavy compound lift (6–8 reps), under 2 min']);
    assert.ok(find(r, 'rest')!.items.includes('B Bulgarian Split Squat: rest 1 min, under 90 s'));
  });

  it('no-light-week: more than 6 loading weeks in a row', () => {
    const r = check((p) => (p.rules = { lightWeeks: { weeks: [4, 12] } }));
    assert.deepEqual(find(r, 'no-light-week')!.items, ['plan weeks 5–11: 7 loading weeks in a row', 'plan weeks 13–24: 12 loading weeks in a row']);
    assert.equal(find(check(), 'no-light-week'), undefined, 'every 4th week by default');
  });

  it('time-over: a session over the profile\'s day length', () => {
    const r = check((_p, pr) => (pr.availability.minutesPerSession = 30));
    const t = find(r, 'time-over')!;
    assert.equal(t.rule, 'time.check');
    assert.equal(t.grade, undefined, 'the person\'s own limit, not evidence');
    assert.ok(t.items.some((x) => /^A: about \d+ min of 30$/.test(x)), t.items.join('\n'));
  });

  it('plan-rule: the profile\'s planRules', () => {
    const r = check((_p, pr) => (pr.planRules = { setsPerExercise: 3, liftSession: { patterns: ['squat|lunge', 'vertical-pull', 'legs'] }, shortDayCore: true }));
    assert.deepEqual(find(r, 'plan-rule')!.items, [
      'A Goblet Squat: 4 sets; the profile\'s rule is 3 an exercise',
      'A Band External Rotation: 2 sets; the profile\'s rule is 3 an exercise',
      'A: nothing for "vertical-pull"; the profile\'s rule wants it in every lifting session',
      'B: nothing for "vertical-pull"; the profile\'s rule wants it in every lifting session',
      'liftSession: "legs" is neither a movement pattern nor a muscle id, so "legs" is not checked',
      'S3: no core exercise; the profile\'s rule wants one on every short day',
    ]);
  });

  it('load-jump: an increase over the guide under the lift\'s own rule, reported as a fact', () => {
    const r = check((p) => (p.lifts['Seated Cable Row'].progression = { rule: 'double' }), '2026-04-03');
    assert.deepEqual(find(r, 'load-jump')!.items, ['Seated Cable Row: next 60 lb; one step is more than 10 % of the load']);
    assert.equal(find(check(() => {}, '2026-04-03'), 'load-jump'), undefined, 'the old default caps the jump itself');
  });

  it('exercise-change: against the plan as written, inside a mesocycle; main lifts inside a phase', () => {
    const previous = fixturePlan();
    const swap = (p: Json) => {
      itemOf(p, 'A', 'Face Pull').name = 'Reverse Fly';
      itemOf(p, 'B', 'Seated Cable Row').name = 'Chest-Supported Row';
    };
    // Plan week 7: week 3 of mesocycle 2.
    const mid = check(swap, '2026-04-14', { previous });
    assert.deepEqual(find(mid, 'exercise-change')!.items, ['A: out Face Pull; in Reverse Fly (plan week 7, week 3 of mesocycle 2)', 'B: out Seated Cable Row; in Chest-Supported Row (plan week 7, week 3 of mesocycle 2)']);
    assert.equal(find(mid, 'exercise-change')!.grade, 'weak');
    // The light week ends the phase's second mesocycle: any change starts the next.
    assert.equal(find(check(swap, CLEAN, { previous }), 'exercise-change'), undefined);
    // Plan week 5 starts mesocycle 2 inside phase 1: accessories may change, the main lifts not.
    const meso = check(swap, '2026-03-31', { previous });
    assert.deepEqual(find(meso, 'exercise-change')!.items, ['B main lifts: out Seated Cable Row; in Chest-Supported Row (plan week 5, week 1 of mesocycle 2; main lifts stay for a phase)']);
    assert.equal(find(check(swap, '2026-04-14'), 'exercise-change'), undefined, 'no plan as written to compare with');
  });

  it('redesign: the same changes are information (redesign-changes), never the exercise-change warning', () => {
    const previous = fixturePlan();
    const swap = (p: Json) => {
      itemOf(p, 'A', 'Face Pull').name = 'Reverse Fly';
      itemOf(p, 'B', 'Seated Cable Row').name = 'Chest-Supported Row';
    };
    const r = check(swap, '2026-04-14', { previous, redesign: true });
    assert.equal(find(r, 'exercise-change'), undefined);
    const info = find(r, 'redesign-changes', 'info')!;
    assert.deepEqual(info.items, ['A: out Face Pull; in Reverse Fly (plan week 7, week 3 of mesocycle 2)', 'B: out Seated Cable Row; in Chest-Supported Row (plan week 7, week 3 of mesocycle 2)']);
    assert.equal(info.message, 'A redesign: the exercises that change, against the plan as written.');
    assert.deepEqual([info.rule, info.grade], ['plan.exercise-changes', undefined]);
    // At a mesocycle boundary the changes are allowed, so neither is said; with no plan as written there is nothing to compare.
    assert.equal(find(check(swap, CLEAN, { previous, redesign: true }), 'redesign-changes'), undefined);
    assert.equal(find(check(swap, '2026-04-14', { redesign: true }), 'redesign-changes'), undefined);
  });

  describe('similar-to-current: a redesign that keeps most of the plan as written', () => {
    const previous = fixturePlan();
    /** A redesign with only these lifting sessions. */
    const redesign = (sessions: Record<string, string[]>) => (p: Json) => {
      p.sessions = Object.fromEntries(Object.entries(sessions).map(([t, names]) => [t, names.map((name) => ({ name, sr: '3 × 8–10', note: 'Why: the redesign.' }))]));
      p.liftTypes = Object.keys(sessions);
      p.shortTypes = [];
    };
    const kept = ['Goblet Squat', 'Face Pull', 'Romanian Deadlift', 'Seated Cable Row'];
    const fresh = ['Back Squat', 'Bench Press', 'Lat Pulldown', 'Deadlift', 'Overhead Press', 'Barbell Row'];

    it('a copy of the plan as written: every movement shared, a heuristic warning listing them', () => {
      const r = check(() => {}, CLEAN, { previous, redesign: true });
      const w = find(r, 'similar-to-current', 'warning')!;
      assert.equal(w.message, '100% of the draft\'s movements (11 of 11) are in the plan as written (over half).');
      assert.deepEqual(w.items, ['Goblet Squat', 'Flat DB Bench Press', 'Face Pull', 'Band External Rotation', 'Romanian Deadlift', 'Seated Cable Row', 'Bulgarian Split Squat', 'Side Plank', 'Push-up (your level)', 'Dead Bug', 'Circuit: squat jump · burpee']);
      assert.deepEqual([w.rule, w.grade], ['plan.redesign', 'heuristic']);
      assert.match(w.reason!, /blank draft/);
      // Only a redesign is measured: the same draft as a change inside the plan is not.
      assert.equal(find(check(() => {}, CLEAN, { previous }), 'similar-to-current'), undefined);
      assert.equal(find(check(() => {}, CLEAN, { redesign: true }), 'similar-to-current'), undefined, 'no plan as written');
    });

    it('names a movement as the draft writes it, with the written plan\'s name when it differs', () => {
      const r = check(redesign({ A: ['Dumbbell bench press', ...kept], B: ['Back Squat'] }), CLEAN, { previous, redesign: true });
      const w = find(r, 'similar-to-current', 'warning')!;
      assert.equal(w.message, '83% of the draft\'s movements (5 of 6) are in the plan as written (over half).');
      assert.deepEqual(w.items, ['Dumbbell bench press (Flat DB Bench Press in the plan as written)', ...kept]);
    });

    it('half or less shared is no warning', () => {
      assert.equal(find(check(redesign({ A: kept.slice(0, 3), B: fresh.slice(0, 3) }), CLEAN, { previous, redesign: true }), 'similar-to-current'), undefined, '3 of 6: half');
      assert.equal(find(check(redesign({ A: fresh.slice(0, 3), B: fresh.slice(3) }), CLEAN, { previous, redesign: true }), 'similar-to-current'), undefined, 'nothing shared');
    });

    it('an override answers one shared movement (by its name or id), or with no item all of them', () => {
      const draft = redesign({ A: kept, B: fresh.slice(0, 2) });
      const one = check((p) => {
        draft(p);
        p.overrides = [{ code: 'similar-to-current', item: 'rdl', reason: 'The hinge is still progressing: kept for its trend.' }];
      }, CLEAN, { previous, redesign: true });
      assert.deepEqual(find(one, 'similar-to-current', 'warning')!.items, ['Goblet Squat', 'Face Pull', 'Seated Cable Row']);
      assert.deepEqual(find(one, 'similar-to-current', 'info')!.items, ['Romanian Deadlift']);
      const all = check((p) => {
        draft(p);
        p.overrides = [{ code: 'similar-to-current', reason: 'A new block on the same equipment: the person asked to keep the main movements.' }];
      }, CLEAN, { previous, redesign: true });
      assert.equal(find(all, 'similar-to-current', 'warning'), undefined);
      assert.equal(find(all, 'similar-to-current', 'info')!.items.length, 4);
      assert.equal(all.summary.overridden, 1);
    });
  });

  it('equipment-missing: a catalogue movement the profile\'s equipment does not cover, a tool that stands in counting', () => {
    assert.equal(find(check(), 'equipment-missing'), undefined, 'the fixture has what its plan needs');
    const some = check((_p, pr) => (pr.equipment = ['dumbbells', 'bench']));
    const w = find(some, 'equipment-missing', 'warning')!;
    assert.deepEqual(w.items, ['A Face Pull: needs cable or band', 'A Band External Rotation: needs band or cable', 'B Romanian Deadlift: needs barbell', 'B Seated Cable Row: needs cable']);
    assert.deepEqual([w.rule, w.grade], ['profile.equipment', undefined]);
    // A kettlebell stands in for the dumbbell of the goblet squat, the bench press and the split squat.
    assert.equal(find(check((_p, pr) => (pr.equipment = ['kettlebell', 'bench', 'cable', 'barbell'])), 'equipment-missing'), undefined);
    // An empty list is bodyweight only; cardio (the zone 2 bike) is never judged.
    const none = find(check((_p, pr) => (pr.equipment = [])), 'equipment-missing')!.items;
    assert.ok(none.includes('A Goblet Squat: needs dumbbell or kettlebell') && none.includes('A Flat DB Bench Press: needs dumbbell or kettlebell and bench'), none.join('\n'));
    assert.ok(!none.some((x) => /Zone 2|Push-up|Dead Bug|Side Plank/.test(x)), none.join('\n'));
    // No profile: nothing to judge by.
    const files = fixtureFiles('v');
    delete files[PROFILE];
    assert.equal(find(buildCheck(readVault(memoryIo(files), 'v', { asOf: CLEAN }), CLEAN), 'equipment-missing'), undefined);
    // An override answers it.
    const answered = check((p, pr) => {
      pr.equipment = ['dumbbells', 'bench'];
      p.overrides = [{ code: 'equipment-missing', reason: 'The new gym has cables and a barbell; the profile is updated at the check-in.' }];
    });
    assert.equal(find(answered, 'equipment-missing', 'warning'), undefined);
    assert.equal(find(answered, 'equipment-missing', 'info')!.items.length, 4);
  });

  it('disliked-movement: a movement whose catalogue id the profile dislikes, cardio included', () => {
    assert.equal(find(check(), 'disliked-movement'), undefined, 'the fixture dislikes nothing it plans');
    const r = check((_p, pr) => {
      pr.preferences.likes = [];
      pr.preferences.dislikes = ['goblet-squat', 'zone2-bike'];
    });
    const w = find(r, 'disliked-movement', 'warning')!;
    assert.deepEqual(w.items, ['A Goblet Squat: Goblet squat is on the profile\'s dislikes', 'A Zone 2 finisher: Easy bike (zone 2) is on the profile\'s dislikes', 'B Zone 2 finisher: Easy bike (zone 2) is on the profile\'s dislikes']);
    assert.deepEqual([w.rule, w.grade], ['profile.dislikes', undefined]);
    const answered = check((p, pr) => {
      pr.preferences.dislikes = ['goblet-squat'];
      p.overrides = [{ code: 'disliked-movement', item: 'goblet-squat', reason: 'The person agreed to keep it while the knee settles.' }];
    });
    assert.equal(find(answered, 'disliked-movement', 'warning'), undefined);
    assert.equal(find(answered, 'disliked-movement', 'info')!.override!.item, 'goblet-squat');
  });

  it('step-not-in-gym: a lift\'s inc the gym\'s weights cannot make, with the step to set', () => {
    assert.equal(find(check(), 'step-not-in-gym'), undefined, 'no loads in the profile: nothing to judge by');
    // The plan's lb lifts: dumbbells in 4 lb steps make no 5 lb step; the cable's 10 is two 5 lb plates.
    const r = check((_p, pr) => (pr.loads = { unit: 'lb', dumbbell: { from: 4, to: 80, step: 4 }, cable: { step: 5, to: 200 } }));
    const w = find(r, 'step-not-in-gym', 'warning')!;
    assert.deepEqual(w.items, [
      'Goblet Squat: inc 5 lb, but no dumbbell here is 5 lb from another (the finest step is 4 lb): set inc to 4',
      'Flat DB Bench Press: inc 5 lb, but no dumbbell here is 5 lb from another (the finest step is 4 lb): set inc to 4',
    ]);
    assert.deepEqual([w.rule, w.grade], ['profile.loads', undefined]);
    assert.ok(w.reason);
    // A step the kit makes is fine: 5 lb dumbbells, and the squat's 5 kg on a bar with 1.25 kg plates (in kg).
    assert.equal(find(check((_p, pr) => (pr.loads = { unit: 'lb', dumbbell: { from: 5, to: 80, step: 5 } })), 'step-not-in-gym'), undefined);
    const bar = check((p, pr) => {
      p.lifts['Barbell Back Squat'].inc = 1.25;
      pr.loads = { unit: 'kg', barbell: { bar: 20, plates: [20, 10, 5, 2.5, 1.25] } };
    });
    assert.deepEqual(find(bar, 'step-not-in-gym', 'warning')!.items, ['Barbell Back Squat: inc 1.25 kg, but no barbell load here is 1.25 kg from another (the finest step is 2.5 kg): set inc to 2.5']);
    const answered = check((p, pr) => {
      pr.loads = { unit: 'lb', dumbbell: { from: 4, to: 80, step: 4 } };
      p.overrides = [{ code: 'step-not-in-gym', reason: 'Fractional plates for the dumbbells arrive next week; the loads are updated then.' }];
    });
    assert.equal(find(answered, 'step-not-in-gym', 'warning'), undefined);
    assert.equal(find(answered, 'step-not-in-gym', 'info')!.items.length, 2);
  });

  it('rir-differs and timed-differs: a field the note or the sets contradict is a warning an override answers', () => {
    const edit = (p: Json) => {
      Object.assign(itemOf(p, 'A', 'Goblet Squat'), { rir: 1 });
      Object.assign(itemOf(p, 'A', 'Zone 2 finisher'), { timed: { minutes: 20 } });
      Object.assign(itemOf(p, 'B', 'Zone 2 finisher'), { sr: '25 min', note: '4 × 4 min hard, 3 min easy between.', timed: { rounds: 5, workMin: 3, restMin: 2 } });
      // The coach's own wording for two weeks: not compared.
      Object.assign(itemOf(p, 'B', 'Romanian Deadlift'), { rir: [1, 2], note: 'In the calibration week RIR 3, then RIR 1–2. Hinge at the hips.' });
    };
    const r = check(edit);
    assert.equal(r.summary.ok, true, 'never a hard error');
    assert.deepEqual(find(r, 'rir-differs', 'warning')!.items, ['A Goblet Squat: rir 1, the note says RIR 2']);
    const timed = find(r, 'timed-differs', 'warning')!.items;
    assert.ok(timed.includes('A Zone 2 finisher: sr says 5–10 min, the timed field adds up to 20 min'), timed.join('\n'));
    assert.ok(timed.some((x) => /^B Zone 2 finisher: the note describes 4 × 4 min/.test(x)));
    const answered = check((p) => {
      edit(p);
      p.overrides = [{ code: 'rir-differs', item: 'A Goblet Squat', reason: 'The note keeps last block\'s RIR until the knee settles.' }];
    });
    assert.equal(find(answered, 'rir-differs', 'warning'), undefined);
    assert.equal(find(answered, 'rir-differs', 'info')!.override!.code, 'rir-differs');
  });

  it('session-unlisted: a session neither liftTypes nor shortTypes names', () => {
    const r = check((p) => (p.sessions.C = [{ name: 'Old day', sr: '3 × 10', note: 'Why: kept from last block.' }]));
    assert.deepEqual(find(r, 'session-unlisted', 'warning')!.items, ['sessions.C']);
    assert.equal(find(check(), 'session-unlisted'), undefined);
  });

  it('rest: core work is not held to the 90 s between sets', () => {
    const r = check((p) => p.sessions.S1.push({ name: 'Pallof Press', sr: '3 × 10/side', rest: '45 s', note: 'Why: anti-rotation.' }));
    const items = find(r, 'rest')!.items;
    assert.ok(!items.some((x) => /Pallof Press|Dead Bug/.test(x)), items.join('\n'));
    assert.ok(items.includes('B Bulgarian Split Squat: rest 1 min, under 90 s'));
  });

  it('no-why and week-override-in-note', () => {
    const files = fixtureWithWhy('v');
    const plan = JSON.parse(files[PLAN]!);
    itemOf(plan, 'B', 'Side Plank').note = 'Week 1 (calibration): 2 sets. Why: obliques.';
    files[PLAN] = JSON.stringify(plan);
    const r = buildCheck(readVault(memoryIo(files), 'v', { asOf: CLEAN }), CLEAN);
    const why = find(r, 'no-why')!.items;
    assert.ok(!why.includes('B Romanian Deadlift') && !why.includes('B Side Plank') && why.includes('A Face Pull'));
    assert.deepEqual(find(r, 'week-override-in-note')!.items, ['B Side Plank: "Week 1 (calibration): 2 sets. Why: obliques.…"']);
  });

  it('timed-in-note and muscle-tags-overridden are information', () => {
    const r = check((p) => {
      itemOf(p, 'A', 'Zone 2 finisher').note = '4 × 4 min hard, 3 min easy between.';
      itemOf(p, 'A', 'Zone 2 finisher').sr = '30 min';
      p.guide['Goblet Squat'].muscles.override = 'counted as the old sheet did';
    });
    assert.deepEqual(find(r, 'timed-in-note', 'info')!.items, ['A Zone 2 finisher: 4 × 4 min hard, 3 min easy between, easy before and after · about 30 min (from the note)']);
    assert.deepEqual(find(r, 'muscle-tags-overridden', 'info')!.items, ['Goblet Squat: counted as the old sheet did']);
  });

  it('a draft read in place of the plan is information, and says so', () => {
    const files = fixtureFiles('v');
    const read = readVault(memoryIo(files), 'v', { asOf: CLEAN, plan: { text: files[PLAN]!, file: 'draft.json' } });
    assert.deepEqual(read.draft, { file: 'draft.json' });
    assert.deepEqual(find(buildCheck(read, CLEAN), 'draft-plan', 'info')!.items, ['draft.json']);
  });
});

describe('check: priority room', () => {
  // The fixture's week: 3 lifting sessions of 60 minutes (room for 2); its S1 trains chest (push-ups) and abs (the dead bug), and A chest too (the bench press).
  const three = ['glutes', 'quads', 'hamstrings'];

  it('priority-room: more effective priority muscles than the week has room for (heuristic), with the rule\'s reason', () => {
    const r = check((_p, pr) => (pr.priorityMuscles = three));
    const f = find(r, 'priority-room', 'warning')!;
    assert.deepEqual([f.rule, f.grade], ['volume.priority-room', 'heuristic']);
    assert.deepEqual(f.items, ['3 priority muscles (Glutes, Quads, Hamstrings) on 3 lifting day(s) of 60 min, where the week has room for 2']);
    assert.match(f.reason!, /^Up to 2–3 priority muscles per phase \(rules\.md, "Volume", the Priority row/);
    assert.match(f.reason!, /Later priorities/);
    // Two fit.
    assert.equal(find(check((_p, pr) => (pr.priorityMuscles = ['glutes', 'quads'])), 'priority-room'), undefined);
  });

  it('counts declared regions\' muscles and confirmed lagging areas, but not a priority trained on the short sessions', () => {
    // A declared weak region makes its muscle a priority: glutes, quads and the side delts' shoulders.
    const declared = check((_p, pr) => {
      pr.priorityMuscles = ['glutes', 'quads'];
      pr.priorityRegions = ['shoulders-side'];
    });
    assert.match(find(declared, 'priority-room')!.items[0]!, /^3 priority muscles \(Glutes, Quads, Shoulders\)/);
    // A confirmed lagging area is a priority too; an unanswered one in a profile that asks is not.
    const lagging = (confirmed?: boolean) => ({ area: 'Upper back', seen: 'Upper back lags the chest', confidence: 'medium', emphasis: 'Upper back as a priority', kind: 'lagging-area', muscles: ['upper-back'], ...(confirmed === undefined ? {} : { confirmed }) });
    const confirmed = check((_p, pr) => {
      pr.priorityMuscles = ['glutes', 'quads'];
      pr.emphasis = [...(pr.emphasis ?? []), lagging(true)];
    });
    assert.match(find(confirmed, 'priority-room')!.items[0]!, /^3 priority muscles \(Glutes, Quads, Upper back\)/);
    const declined = check((_p, pr) => {
      pr.priorityMuscles = ['glutes', 'quads'];
      pr.emphasis = [...(pr.emphasis ?? []), lagging(false)];
    });
    assert.equal(find(declined, 'priority-room'), undefined);
    // Abs (the dead bug, on S1 only) take no room from the lifting days.
    assert.equal(find(check((_p, pr) => (pr.priorityMuscles = ['glutes', 'quads', 'abs'])), 'priority-room'), undefined);
    const four = check((_p, pr) => (pr.priorityMuscles = [...three, 'abs']));
    assert.match(find(four, 'priority-room')!.items[0]!, /^3 priority muscles \(Glutes, Quads, Hamstrings\) .*room for 2; Abs, trained only on the short sessions, use none of it$/);
    // Chest has direct sets on A (the bench press): S1's push-ups do not excuse it.
    const chest = check((_p, pr) => (pr.priorityMuscles = ['glutes', 'quads', 'chest', 'abs']));
    assert.match(find(chest, 'priority-room')!.items[0]!, /^3 priority muscles \(Glutes, Quads, Chest\) .*room for 2; Abs, trained only on the short sessions, use none of it$/);
  });

  it('sizes the room from the plan\'s lifting days and the profile\'s minutes, as the generator does', () => {
    const short = check((_p, pr) => {
      pr.priorityMuscles = ['glutes', 'quads'];
      pr.availability.minutesPerSession = 30;
    });
    assert.match(find(short, 'priority-room')!.items[0]!, /^2 priority muscles .* of 30 min, where the week has room for 1$/);
    const fourDays = check((p, pr) => {
      pr.priorityMuscles = three;
      p.weekTarget.lift = 4;
    });
    assert.equal(find(fourDays, 'priority-room'), undefined);
  });

  it('an override with its reason turns it into information', () => {
    const r = check((p, pr) => {
      pr.priorityMuscles = three;
      p.overrides = [{ code: 'priority-room', reason: 'The user chose longer sessions to keep all three this phase.' }];
    });
    assert.equal(find(r, 'priority-room', 'warning'), undefined);
    assert.equal(find(r, 'priority-room', 'info')!.override!.reason, 'The user chose longer sessions to keep all three this phase.');
  });
});

describe('check: region coverage', () => {
  const regionFindings = (r: CheckReport) => r.findings.filter((f) => f.code.startsWith('region-')).map((f) => `${f.level} ${f.code}`);

  it('region-coverage: a priority muscle\'s coverage region under 4 direct sets, with the catalogue movements that would cover it', () => {
    const r = check((_p, pr) => {
      pr.priorityMuscles = ['quads'];
      pr.equipment.push('machines');
    });
    const w = find(r, 'region-coverage', 'warning')!;
    // The vasti have 10.5 direct sets a week (goblet squats and split squats); the rectus femoris none.
    assert.deepEqual(w.items, ['quads-rf (Rectus femoris): 0 direct sets a week, under 4 for a priority muscle\'s coverage region; options: Leg extension']);
    assert.deepEqual([w.rule, w.grade], ['volume.region-coverage', 'heuristic']);
    assert.match(w.reason!, /choices for the coach, not instructions/);
    assert.deepEqual(regionFindings(r), ['warning region-coverage']);
  });

  it('marks an option already in the plan, where more sets would do', () => {
    const r = check((p, pr) => {
      pr.priorityMuscles = ['quads'];
      pr.equipment.push('machines');
      p.sessions.A.push({ name: 'Leg Extension', sr: '2 × 12–15', note: 'Why: the rectus femoris.' });
    });
    assert.deepEqual(find(r, 'region-coverage')!.items, ['quads-rf (Rectus femoris): 3 direct sets a week, under 4 for a priority muscle\'s coverage region; options: Leg extension (in the plan)']);
  });

  it('region-uncoverable: information, not a warning, when no catalogue movement that biases the region fits', () => {
    const noMachine = check((_p, pr) => (pr.priorityMuscles = ['quads']));
    assert.equal(find(noMachine, 'region-coverage'), undefined);
    const info = find(noMachine, 'region-uncoverable', 'info')!;
    assert.deepEqual(info.items, ['quads-rf (Rectus femoris): 0 direct sets a week, under 4 for a priority muscle\'s coverage region; no catalogue movement that biases it fits: Leg extension (needs machine)']);
    assert.equal(info.grade, undefined);
    const ledger = check((_p, pr, l) => {
      pr.priorityMuscles = ['quads'];
      pr.equipment.push('machines');
      l.constraints.push({ id: 'knee', area: 'knee', noMovements: ['leg-extension'] });
    });
    assert.match(find(ledger, 'region-uncoverable')!.items[0]!, /: Leg extension \(ruled out by knee\)$/);
  });

  it('region-declared-short: a declared weak region under 6 direct sets near failure; its muscle\'s coverage regions are then held too', () => {
    const r = check((_p, pr) => (pr.priorityRegions = ['shoulders-side']));
    assert.deepEqual(find(r, 'region-declared-short', 'warning')!.items, ['shoulders-side (Side delts): 0 direct sets near failure a week, under 6 for a declared weak region; options: Dumbbell lateral raise, Cable lateral raise, Seated dumbbell shoulder press, Pike push-up, Elevated pike push-up (feet on a chair or box)']);
    assert.deepEqual([find(r, 'region-declared-short')!.rule, find(r, 'region-declared-short')!.grade], ['volume.region-declared', 'heuristic']);
    // The side delts' muscle becomes a priority for the region rules: the front delts (half credit from the presses) are short too.
    assert.match(find(r, 'region-coverage')!.items[0]!, /^shoulders-front \(Front delts\): 0 direct sets a week, under 4/);
  });

  it('a body-assessment row\'s regions are declared too, unless the user declined the row', () => {
    const row = { area: 'Shoulders', seen: 'Narrow from the front', confidence: 'low', emphasis: 'Side delts', regions: ['shoulders-side'] };
    assert.ok(find(check((_p, pr) => pr.emphasis.push(row)), 'region-declared-short'));
    assert.equal(find(check((_p, pr) => pr.emphasis.push({ ...row, confirmed: false })), 'region-declared-short'), undefined);
  });

  it('the options leave out what the Ledger rules out and what the user dislikes', () => {
    const r = check((_p, pr, l) => {
      pr.priorityRegions = ['shoulders-side'];
      pr.preferences.dislikes.push('cable-lateral-raise');
      l.constraints.push({ id: 'elbow', area: 'elbow', noMovements: ['db-lateral-raise'] });
    });
    // The fixture's own shoulder constraint already rules out the standing barbell press.
    assert.match(find(r, 'region-declared-short')!.items[0]!, /; options: Seated dumbbell shoulder press, Pike push-up, Elevated pike push-up \(feet on a chair or box\), Standing dumbbell overhead press, Wall handstand push-up$/);
  });

  it('a rough-guide or other non-coverage region is never warned about unless declared', () => {
    const r = check((_p, pr) => (pr.priorityMuscles = ['upper-back', 'chest']));
    assert.deepEqual(regionFindings(r), []);
    assert.deepEqual(regionFindings(check()), [], 'the fixture: glutes, a muscle with no modelled region');
  });

  it('an override with a reason turns a region warning into information, by the region\'s id or label', () => {
    const r = check((p, pr) => {
      pr.priorityMuscles = ['quads'];
      pr.equipment.push('machines');
      p.overrides = [{ code: 'region-coverage', item: 'Rectus femoris', reason: 'Sissy squats on the short days, not in the catalogue yet.' }];
    });
    assert.equal(find(r, 'region-coverage', 'warning'), undefined);
    const info = find(r, 'region-coverage', 'info')!;
    assert.match(info.items[0]!, /^quads-rf /);
    assert.equal(info.override!.reason, 'Sissy squats on the short days, not in the catalogue yet.');
    assert.equal(r.summary.overridden, 1);
  });
});

describe('check: overrides', () => {
  it('a stated reason turns a warning into information, shown with it', () => {
    const r = check((p) => {
      morePressing(p);
      p.overrides = [{ code: 'pull-push', reason: 'Pull work is in the short days\' band sessions.', decision: '2026-04-20 · Pull to push' }];
    });
    assert.equal(find(r, 'pull-push', 'warning'), undefined);
    const info = find(r, 'pull-push', 'info')!;
    assert.deepEqual(info.override, { code: 'pull-push', reason: 'Pull work is in the short days\' band sessions.', decision: '2026-04-20 · Pull to push' });
    assert.equal(info.grade, 'heuristic', 'the rule and grade stay with it');
    assert.equal(r.summary.overridden, 1);
  });

  it('an override with an item takes that item only: the rest of the warning stays', () => {
    const r = check((p) => (p.overrides = [{ code: 'rest', item: 'B Bulgarian Split Squat', reason: 'Supersetted with the plank in practice.' }, { code: 'volume-below-minimum', item: 'Calves', reason: 'Calves are trained on the bike.' }]));
    assert.ok(!find(r, 'rest', 'warning')!.items.some((x) => x.startsWith('B Bulgarian Split Squat')));
    assert.deepEqual(find(r, 'rest', 'info')!.items, ['B Bulgarian Split Squat: rest 1 min, under 90 s']);
    // A muscle by its id or its label.
    assert.deepEqual(find(r, 'volume-below-minimum', 'info')!.items, ['calves: 0 sets a week, under the minimum dose of 4']);
    assert.equal(r.summary.overridden, 2);
  });

  it('an override never clears a hard error, and says so', () => {
    const r = check((p) => {
      itemOf(p, 'B', 'Bulgarian Split Squat').logged = true;
      p.overrides = [{ code: 'no-lift-entry', reason: 'I know.' }];
    });
    assert.equal(find(r, 'no-lift-entry')!.level, 'error');
    assert.equal(r.summary.ok, false);
    assert.deepEqual(find(r, 'override-unused', 'info')!.items, ['no-lift-entry (a hard error: an override never applies to one)']);
    const ledger = check((p) => (p.overrides = [{ code: 'ledger-blocked', reason: 'The physio cleared it.' }]), '2026-04-12');
    assert.equal(find(ledger, 'ledger-blocked')!.level, 'error');
  });

  it('override-unused: an override that matches nothing on this plan', () => {
    const r = check((p) => (p.overrides = [{ code: 'volume-over-cap', reason: 'A shoulder block.' }, { code: 'rest', item: 'A Goblet Squat', reason: 'x' }]));
    assert.deepEqual(find(r, 'override-unused', 'info')!.items, ['volume-over-cap (no volume-over-cap finding on this plan)', 'rest: A Goblet Squat (the rest warning has no such item)']);
  });

  it('readOverrides: the usable ones, the ones with no reason, and what else is wrong', () => {
    assert.deepEqual(readOverrides(undefined), { overrides: [], withoutReason: [], problems: [] });
    const r = readOverrides([{ code: ' rest ', item: 'A', reason: ' because ', decision: 'D' }, { code: 'x' }, 'no', { reason: 'r' }, { code: 'y', reason: 'r', extra: 1, _note: 'kept' }]);
    assert.deepEqual(r.overrides, [{ code: 'rest', item: 'A', reason: 'because', decision: 'D' }, { code: 'y', reason: 'r' }]);
    assert.deepEqual(r.withoutReason, ['overrides[1] (x)']);
    assert.deepEqual(r.problems, ['overrides[2] is not an object', 'overrides[3] has no code (the finding it answers)', 'overrides[4] has unknown key(s): extra']);
  });
});

describe('plan-write: the key-level diff', () => {
  it('lists added, removed and changed keys, item fields by name, and a new order', () => {
    const before = fixturePlan();
    const after = fixturePlan();
    itemOf(after, 'A', 'Face Pull').sr = '4 × 15';
    after.sessions.B.reverse();
    after.sessions.S1.push({ name: 'Plank', sr: '3 × 30 s' });
    delete after.lifts['Barbell Back Squat'];
    after.weekTarget.lift = 4;
    after.overrides = [{ code: 'rest', reason: 'x' }];
    assert.deepEqual(planDiff(before, after), [
      { path: 'weekTarget.lift', change: 'changed', before: 3, after: 4 },
      { path: 'sessions.A["Face Pull"].sr', change: 'changed', before: '3 × 15', after: '4 × 15' },
      { path: 'sessions.B', change: 'reordered' },
      { path: 'sessions.S1.Plank', change: 'added' },
      { path: 'lifts["Barbell Back Squat"]', change: 'removed' },
      { path: 'overrides', change: 'added' },
    ]);
    assert.deepEqual(planDiff(before, fixturePlan()), []);
    assert.ok(sameJson({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }));
    assert.ok(!sameJson({ a: [1, 2] }, { a: [2, 1] }));
  });
});
