// The coach's writes into the log through the engine: `log add` (a session
// with fitness_log.py add's checks, its exercise list and checklist frozen,
// then the Workout habit's tick), `log ladder` and `log fix` (mergeFix, the
// script's fix word for word). Each a dry run until --write, merged with the
// file as it is and read back. In-memory copies of the synthetic vault.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeFix } from '../src/adapters/vault/log-write.ts';
import { run } from '../src/cli/cli.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

type Json = Record<string, any>;
const TODAY = '2026-04-12';
const LOG = 'v/3-Personal/Fitness/fitness-log-data.json';
const HABITS = 'v/5-System/Data/habits-data.json';
const PLAN = 'v/3-Personal/Fitness/plan-data.json';
const A = { date: TODAY, type: 'A', lift1: { name: 'Goblet Squat', weight: 24, reps: 10 }, lift2: { name: 'Flat DB Bench Press', weight: 22, reps: 9 }, durationMin: 50, rating: 4, notes: 'felt good', skipped: ['Face Pull + Band External Rotation'] };

function cli(argv: string[], edit: (f: Record<string, string>) => void = () => {}) {
  const f = fixtureFiles('v');
  f['v/s.json'] = JSON.stringify(A);
  edit(f);
  const writes: { log: number; habits: number } = { log: 0, habits: 0 };
  const io = {
    ...memoryIo(f, TODAY),
    writeLog: (_root: string, text: string) => { writes.log++; f[LOG] = text; },
    writeHabits: (_root: string, text: string) => { writes.habits++; f[HABITS] = text; },
  };
  const r = run([...argv, '--vault', 'v'], io as never);
  return { code: r.code, out: JSON.parse(r.stdout) as Json, writes, files: f };
}
const sessions = (f: Record<string, string>) => (JSON.parse(f[LOG]!) as Json).sessions as Json[];

describe('log add', () => {
  it('a dry run unless --write: the entry as the Log panel saves it, nothing written', () => {
    const { code, out, writes } = cli(['log', 'add', '--file', 'v/s.json']);
    assert.equal(code, 0, JSON.stringify(out.errors));
    assert.deepEqual([out.command, out.action, out.result, out.dryRun, out.written], ['log', 'add', 'added', true, false]);
    assert.deepEqual(writes, { log: 0, habits: 0 });
    const s = out.session;
    assert.deepEqual(Object.keys(s).slice(0, 4), ['date', 'type', 'lift1', 'lift2']);
    assert.deepEqual(s.lift1, { name: 'Goblet Squat', weight: 24, reps: 10, unit: 'lb' });
    assert.deepEqual(s.checklist, { done: 4, total: 5, skipped: ['Face Pull + Band External Rotation'] });
    assert.ok(Array.isArray(s.exercises) && s.exercises.length > 0, 'the exercise list is frozen with it');
    assert.ok(Object.keys(s).indexOf('checklist') < Object.keys(s).indexOf('exercises'), 'checklist before exercises, as the script wrote them');
  });

  it('--write appends it, reads it back and ticks the day’s Workout habit; again: already', () => {
    const r = cli(['log', 'add', '--file', 'v/s.json', '--write']);
    assert.deepEqual([r.code, r.out.written, r.out.habit, r.writes.log, r.writes.habits], [0, true, 'ticked', 1, 1]);
    assert.equal(sessions(r.files).at(-1)!.date, TODAY);
    assert.match(r.files[HABITS]!, /"hab-workout-2026-W15-6": "1"/);
    assert.deepEqual(JSON.parse(r.files[LOG]!).todayChecklist, { date: TODAY, type: 'A', express: false, checked: [true, true, true, false, true], picked: false }, 'Today’s circles follow the log');
    const again = cli(['log', 'add', '--file', 'v/s.json', '--write'], (f) => { f[LOG] = r.files[LOG]!; });
    assert.deepEqual([again.code, again.out.result, again.out.written, again.writes.log], [0, 'already', false, 0]);
  });

  it('a session on an earlier day leaves Today’s ticks as they are', () => {
    const r = cli(['log', 'add', '--file', 'v/s.json', '--write'], (f) => { f['v/s.json'] = JSON.stringify({ ...A, date: '2026-04-09' }); });
    assert.equal(r.out.written, true);
    assert.deepEqual(JSON.parse(r.files[LOG]!).todayChecklist, JSON.parse(fixtureFiles('v')[LOG]!).todayChecklist);
  });

  it('--no-habit leaves the habits alone', () => {
    const r = cli(['log', 'add', '--file', 'v/s.json', '--write', '--no-habit']);
    assert.deepEqual([r.out.written, r.out.habit, r.writes.habits], [true, undefined, 0]);
  });

  it('the script’s checks: a wrong lift, a date after today, an unknown skipped line', () => {
    const bad = (s: Json) => cli(['log', 'add', '--file', 'v/s.json'], (f) => { f['v/s.json'] = JSON.stringify(s); });
    const wrong = bad({ ...A, lift1: { name: 'Back Squat', weight: 60, reps: 5 } });
    assert.equal(wrong.code, 1);
    assert.match(wrong.out.errors[0].message, /lift1 of A is Goblet Squat; got 'Back Squat'/);
    assert.match(bad({ ...A, date: '2026-04-13' }).out.errors[0].message, /in the future/);
    assert.equal(bad({ ...A, skipped: ['Burpees'] }).code, 1);
  });

  it('a swap names the plan’s lift as planned; a custom session has no checklist', () => {
    const swap = cli(['log', 'add', '--file', 'v/s.json'], (f) => { f['v/s.json'] = JSON.stringify({ ...A, lift1: { name: 'Leg Press', planned: 'Goblet Squat', weight: 100, reps: 10 }, skipped: [] }); });
    assert.equal(swap.code, 0, JSON.stringify(swap.out.errors));
    assert.deepEqual([swap.out.session.lift1.name, swap.out.session.lift1.planned], ['Leg Press', 'Goblet Squat']);
    const custom = cli(['log', 'add', '--file', 'v/s.json'], (f) => { f['v/s.json'] = JSON.stringify({ date: TODAY, type: 'custom', label: 'Hike', durationMin: 90 }); });
    assert.equal(custom.code, 0, JSON.stringify(custom.out.errors));
    assert.equal(custom.out.session.checklist, undefined);
  });
});

describe('log add: why a line was skipped', () => {
  const add = (s: Json) => cli(['log', 'add', '--file', 'v/s.json'], (f) => { f['v/s.json'] = JSON.stringify(s); });

  it('writes each reason into the checklist\'s why, by the line\'s name as skipped names it', () => {
    const r = add({ ...A, skipped: ['Face Pull + Band External Rotation', 'zone 2 finisher'], skipWhy: { 'Face Pull + Band External Rotation': 'time', 'Zone 2 Finisher': 'energy' } });
    assert.equal(r.code, 0, JSON.stringify(r.out.errors));
    assert.deepEqual(r.out.session.checklist, { done: 3, total: 5, skipped: ['Face Pull + Band External Rotation', 'Zone 2 finisher'], why: { 'Face Pull + Band External Rotation': 'time', 'Zone 2 finisher': 'energy' } });
    // A reason for some skipped lines only; none at all leaves `why` out, as before.
    assert.deepEqual(add({ ...A, skipped: ['Face Pull + Band External Rotation', 'Zone 2 finisher'], skipWhy: { 'Zone 2 finisher': 'pain' } }).out.session.checklist.why, { 'Zone 2 finisher': 'pain' });
    assert.equal(add({ ...A, skipWhy: {} }).out.session.checklist.why, undefined);
  });

  it('refuses a reason that is not one of the four, and a line that is not skipped, writing nothing', () => {
    const cases: [Json, RegExp][] = [
      [{ ...A, skipWhy: { 'Face Pull + Band External Rotation': 'tired' } }, /^"skipWhy" for Face Pull \+ Band External Rotation is "tired": a skip's reason is time, pain, equipment or energy$/],
      [{ ...A, skipWhy: ['time'] }, /^"skipWhy" gives each skipped line's reason by its name/],
      [{ ...A, skipWhy: { 'Goblet Squat': 'time' } }, /^"skipWhy" gives a reason for "Goblet Squat", which is not skipped: a reason goes with a line in "skipped"$/],
      [{ ...A, skipWhy: { Burpees: 'time' } }, /^"skipWhy": "Burpees" is not a line of A on /],
      [{ ...A, skipWhy: { 'Face Pull': 'equipment' } }, /^"skipWhy": "Face Pull" is one part of the paired line "Face Pull \+ Band External Rotation"/],
      [{ date: TODAY, type: 'custom', label: 'Hike', skipWhy: { Hike: 'time' } }, /^"skipWhy" goes with a planned session's skipped lines: a custom session has no checklist$/],
    ];
    for (const [s, msg] of cases) {
      const r = cli(['log', 'add', '--file', 'v/s.json', '--write'], (f) => { f['v/s.json'] = JSON.stringify(s); });
      assert.equal(r.code, 1, `${msg}: ${JSON.stringify(r.out)}`);
      assert.match(r.out.errors[0].message, msg);
      assert.equal(r.writes.log, 0);
    }
  });
});

describe('log add at Every set', () => {
  // The lifts' every set, and the pair's two parts each as its own exercise.
  const FULL = {
    ...A,
    skipped: [],
    trackingLevel: 'full',
    exerciseSets: [
      { name: 'Goblet Squat', sets: [{ weight: 24, reps: 10, rir: 2 }, { weight: 24, reps: 10 }, { weight: 24, reps: 9, rir: 1 }] },
      { name: 'Flat DB Bench Press', sets: [{ weight: 22, unit: 'lb', reps: 9 }] },
      { name: 'Face Pull', sets: [{ weight: 30, reps: 15 }] },
      { name: 'Band External Rotation', sets: [{ reps: 15 }, { reps: 12 }] },
    ],
  };
  const add = (s: Json, write = false) => cli(['log', 'add', '--file', 'v/s.json', ...(write ? ['--write'] : [])], (f) => { f['v/s.json'] = JSON.stringify(s); });

  it('writes every set as given, each part of a pair by its own name', () => {
    const r = add(FULL, true);
    assert.equal(r.code, 0, JSON.stringify(r.out.errors));
    const s = sessions(r.files).at(-1)!;
    assert.equal(s.trackingLevel, 'full');
    assert.deepEqual(s.exerciseSets.map((x: Json) => [x.name, x.sets.length]), [['Goblet Squat', 3], ['Flat DB Bench Press', 1], ['Face Pull', 1], ['Band External Rotation', 2]]);
    assert.deepEqual(s.exerciseSets[0].sets[0], { weight: 24, unit: null, reps: 10, rir: 2 });
  });

  it('refuses what the log cannot read, and writes nothing', () => {
    const cases: [Json, RegExp][] = [
      [{ ...FULL, trackingLevel: 'every' }, /"trackingLevel" is "standard" or "full"/],
      [{ ...FULL, trackingLevel: 'standard' }, /"exerciseSets" needs "trackingLevel": "full"/],
      [{ ...FULL, exerciseSets: undefined }, /"trackingLevel": "full" needs "exerciseSets"/],
      [{ ...FULL, exerciseSets: { name: 'Goblet Squat' } }, /"exerciseSets" is a list/],
      [{ ...FULL, exerciseSets: [{ name: 'Goblet Squat', sets: 3 }] }, /Goblet Squat: "sets" is a list of sets/],
      [{ ...FULL, exerciseSets: [{ sets: [] }] }, /exerciseSets item 1 needs a "name"/],
      [{ ...FULL, exerciseSets: [{ name: 'Goblet Squat', sets: [{ weight: 24, reps: 9.5 }] }] }, /Goblet Squat, set 1: reps is a whole number, 0 or more/],
      [{ ...FULL, exerciseSets: [{ name: 'Goblet Squat', sets: [{ weight: 24, reps: -1 }] }] }, /reps is a whole number/],
      [{ ...FULL, exerciseSets: [{ name: 'Goblet Squat', sets: [{ weight: 24, reps: 8 }, { weight: 24, reps: 8, rir: 11 }] }] }, /Goblet Squat, set 2: RIR is 0 to 10/],
      [{ ...FULL, exerciseSets: [{ name: 'Goblet Squat', sets: [{ weight: -5, reps: 8 }] }] }, /weight is a number, 0 or more/],
      [{ ...FULL, exerciseSets: [{ name: 'Goblet Squat', sets: [{ weight: 24, unit: 'stone', reps: 8 }] }] }, /unit is lb or kg/],
      [{ ...FULL, exerciseSets: [...FULL.exerciseSets, { name: 'Back Squat', sets: [{ weight: 60, reps: 5 }] }] }, /Back Squat is not an item of A on .*its items: Goblet Squat; Flat DB Bench Press/],
      [{ ...FULL, exerciseSets: [...FULL.exerciseSets, { name: 'Cable Fly', planned: 'Pec Deck', sets: [{ weight: 20, reps: 12 }] }] }, /Cable Fly: "planned" Pec Deck is not an item of A/],
      [{ ...FULL, exerciseSets: FULL.exerciseSets.slice(1) }, /lift1 Goblet Squat has a top set but no sets in "exerciseSets"/],
    ];
    for (const [s, msg] of cases) {
      const r = add(s, true);
      assert.equal(r.code, 1, `${msg}: ${JSON.stringify(r.out)}`);
      assert.match(r.out.errors[0].message, msg);
      assert.equal(r.writes.log, 0);
    }
  });

  it('takes a swap that names the plan\'s item, a ladder\'s level by its name that day, and RIR 0 to 10', () => {
    const swap = add({ ...FULL, exerciseSets: [...FULL.exerciseSets.slice(0, 2), { name: 'Band Pull-Apart', planned: 'Face Pull', sets: [{ reps: 20, rir: 0 }] }, { name: 'band external rotation', sets: [{ reps: 15, rir: 10 }] }] });
    assert.equal(swap.code, 0, JSON.stringify(swap.out.errors));
    // Lifts given as 0 x 0 (not logged) need no sets.
    const none = add({ ...FULL, lift1: { name: 'Goblet Squat', weight: 0, reps: 0 }, exerciseSets: FULL.exerciseSets.slice(1) });
    assert.equal(none.code, 0, JSON.stringify(none.out.errors));
    const s1 = add({ date: TODAY, type: 'S1', trackingLevel: 'full', exerciseSets: [{ name: 'Push-up (your level)', sets: [{ reps: 8 }] }, { name: 'Dead Bug', sets: [{ reps: 8 }, { reps: 8 }] }] });
    assert.equal(s1.code, 0, JSON.stringify(s1.out.errors));
  });
});

describe('log ladder', () => {
  it('sets a level with its date, says already for the same level, refuses an unknown ladder or level', () => {
    const r = cli(['log', 'ladder', '--id', 'pushup', '--level', '3', '--date', TODAY, '--write']);
    assert.deepEqual([r.code, r.out.result, r.out.written, r.writes.log], [0, 'set', true, 1]);
    assert.deepEqual((JSON.parse(r.files[LOG]!) as Json).ladders.pushup.at(-1), { level: 3, date: TODAY });
    assert.equal(cli(['log', 'ladder', '--id', 'pushup', '--level', '2', '--date', TODAY]).out.result, 'already');
    assert.match(cli(['log', 'ladder', '--id', 'plank', '--level', '1']).out.errors[0].message, /^no ladder 'plank'; ladders: \['pushup', 'handstand'\]$/);
    assert.match(cli(['log', 'ladder', '--id', 'pushup', '--level', '9']).out.errors[0].message, /has levels 1-3$/);
  });
});

describe('log fix', () => {
  it('corrects a logged lift and reads it back; the same values again: already', () => {
    const r = cli(['log', 'fix', '--date', '2026-04-11', '--type', 'B', '--lift', 'lift1', '--weight', '72.5', '--write']);
    assert.deepEqual([r.code, r.out.result, r.out.changed, r.out.written], [0, 'fixed', ['weight'], true]);
    assert.equal(sessions(r.files).find((s) => s.date === '2026-04-11')!.lift1.weight, 72.5);
    assert.equal(cli(['log', 'fix', '--date', '2026-04-11', '--type', 'B', '--lift', 'lift1', '--weight', '70']).out.result, 'already');
  });

  it('clears "planned" only when the lift is the plan’s; the script’s messages', () => {
    const msg = (argv: string[]) => cli(['log', 'fix', ...argv]).out.errors?.[0]?.message;
    assert.equal(msg(['--date', '2026-03-20', '--type', 'B', '--lift', 'lift1', '--clear-planned']), 'lift1 of B is Romanian Deadlift in the plan, not \'Hamstring Curl\': "planned" stays');
    assert.equal(msg(['--date', '2026-04-11', '--type', 'B', '--lift', 'lift1', '--clear-planned']), 'lift1 (Romanian Deadlift) has no "planned" to clear');
    assert.equal(msg(['--date', '2026-04-01', '--type', 'A', '--lift', 'lift1', '--weight', '1']), 'no session logged for 2026-04-01 A');
    assert.equal(msg(['--date', '2026-04-11', '--type', 'B', '--lift', 'lift1']), 'give --weight, --reps, --clear-planned or a mix');
  });

  it('mergeFix: a plan that has adopted the swap lets "planned" go', () => {
    const f = fixtureFiles('v');
    const plan = JSON.parse(f[PLAN]!);
    plan.sessions.B.find((x: Json) => x.name === 'Romanian Deadlift').name = 'Hamstring Curl';
    const m = mergeFix(f[LOG]!, plan, { date: '2026-03-20', type: 'B', lift: 'lift1', clearPlanned: true });
    assert.equal(m.result, 'fixed');
    if (m.result === 'fixed') assert.deepEqual([m.changed, 'planned' in m.after], [['planned'], false]);
  });
});
