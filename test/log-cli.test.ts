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
