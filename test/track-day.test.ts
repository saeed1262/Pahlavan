// The daily wrap-up's two commands: `track day` (read only: the date's
// items with their states and linked habits, the session, the evening
// answer, the rest mark, the morning) and `track tick` (the day's ticks and
// amounts into Coach/tracking.json and the linked habits, a dry run
// until --write, read back). Through `run` on an in-memory copy of the
// synthetic vault, then the built engine on a temp copy.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { run } from '../src/cli/cli.ts';
import { habitCheckinKey } from '../src/core/tracking.ts';
import { builtEngine, fixtureFiles, memoryIo, VAULT } from './helpers.ts';
import { paths } from '../src/adapters/vault/layout.ts';

type Json = Record<string, any>;
const TRACKING = 'v/3-Personal/Fitness/Coach/tracking.json';
const HABITS = 'v/5-System/Data/habits-data.json';
const NUDGES = 'v/3-Personal/Fitness/Coach/nudges.json';
const BODY = 'v/3-Personal/Fitness/body-data.json';
const DATE = '2026-04-10';

const cli = (argv: string[], edit: (f: Record<string, string>) => void = () => {}) => {
  const f = fixtureFiles('v');
  edit(f);
  const writes: { file: string; text: string }[] = [];
  const io = {
    ...memoryIo(f, DATE),
    clock: () => ({ minutes: 21 * 60 + 30, offsetMinutes: -240 }),
    writeTracking: (_r: string, text: string) => { writes.push({ file: 'tracking', text }); f[TRACKING] = text; },
    // At the layout's path: a vault with no habits file gets its first one beside the plan.
    writeHabits: (_r: string, text: string) => { writes.push({ file: 'habits', text }); f[`v/${paths().habits}`] = text; },
  };
  const r = run(argv, io);
  return { code: r.code, out: JSON.parse(r.stdout) as Json, writes, files: f };
};
const item = (out: Json, id: string) => out.items.find((x: Json) => x.value.id === id);

describe('track day', () => {
  it('lists the items due that day with their state, kind and linked habit; open is what is left to tick', () => {
    const { code, out } = cli(['track', 'day', '--vault', 'v', '--date', DATE]);
    assert.equal(code, 0);
    assert.equal(out.action, 'day');
    assert.deepEqual(item(out, 'creatine').value, { id: 'creatine', name: 'Creatine', kind: 'supplement', state: 'done', done: true, value: null, target: null, unit: null, desk: null, via: 'pahlavan', habit: null, tickable: 'done' });
    const water = item(out, 'water').value;
    assert.deepEqual([water.state, water.value, water.target, water.unit, water.habit.id, water.tickable], ['not done', 1250, 2500, 'mL', 'water', 'amount']);
    assert.equal(item(out, 'water').reason.note, 'Water: 1250 of 2500 mL so far. The Water (mL) habit is not ticked in the habit check-ins.');
    assert.deepEqual(item(out, 'protein').value.habit, { id: 'protein', name: 'Protein', ticked: false, value: null });
    assert.equal(item(out, 'sitting').value.state, 'counted');
    assert.deepEqual(out.open, ['multivitamin', 'shake', 'magnesium', 'protein', 'flossing', 'water']);
    assert.deepEqual(out.notDue, [{ id: 'fish-oil', name: 'Fish oil', kind: 'supplement', schedule: 'paused' }]);
    for (const x of out.items) assert.equal(x.reason.rule, 'tracking.day');
  });

  it('stand-ups: the day\'s minutes from the stand-up card and stood at the desk', () => {
    const plain = item(cli(['track', 'day', '--vault', 'v', '--date', DATE]).out, 'stand-ups');
    assert.deepEqual([plain.value.value, plain.value.desk], [80, 0]);
    assert.equal(plain.reason.note, 'Stand-ups: 80 of 120 min so far.');
    const { out } = cli(['track', 'day', '--vault', 'v', '--date', DATE], (f) => {
      const t = JSON.parse(f[TRACKING]!);
      t.days[DATE]['stand-ups'].deskMinutes = 20;
      f[TRACKING] = JSON.stringify(t);
    });
    const s = item(out, 'stand-ups');
    assert.deepEqual([s.value.value, s.value.target, s.value.desk, s.value.state], [80, 120, 20, 'not done']);
    assert.equal(s.reason.note, 'Stand-ups: 80 of 120 min so far. 60 min from the stand-up card, 20 at the desk with Standing now on.');
    assert.equal(s.reason.inputs.desk, 20);
  });

  it('says whether a session is logged, the evening card\'s answer, a rest mark and the morning check-in', () => {
    const { out } = cli(['track', 'day', '--vault', 'v', '--date', DATE]);
    assert.deepEqual(out.training.value, { logged: true, sessions: [{ type: 'custom', name: 'Easy run' }], workoutTicked: true, planned: true, didYouTrain: null, mark: null });
    assert.deepEqual([out.morning.value.done, out.morning.value.checkedAt, out.morning.value.at], [true, '2026-04-10T07:10:00.000Z', '07:30']);
    // Thursday 9 April: the Workout tick, no session logged; made up here, a rest mark and the evening answer.
    const rest = cli(['track', 'day', '--vault', 'v', '--date', '2026-04-09'], (f) => {
      const b = JSON.parse(f[BODY]!);
      b.days['2026-04-09'] = { ...b.days['2026-04-09'], mark: 'rest' };
      f[BODY] = JSON.stringify(b);
      const n = JSON.parse(f[NUDGES]!);
      n.days['2026-04-09'] = { ...(n.days['2026-04-09'] ?? {}), train: { how: 'rest', at: '2026-04-10T00:05:00.000Z', by: 'Home Mac' } };
      f[NUDGES] = JSON.stringify(n);
    });
    assert.deepEqual([rest.out.training.value.logged, rest.out.training.value.mark, rest.out.training.value.didYouTrain], [false, 'rest', { answer: 'rest', at: '2026-04-10T00:05:00.000Z', by: 'Home Mac' }]);
    assert.equal(rest.out.training.reason.note, 'Marked a rest day.');
  });

  it('only reads: no --write, and every file stays as it was', () => {
    assert.equal(cli(['track', 'day', '--vault', 'v', '--write']).code, 2);
    const { writes } = cli(['track', 'day', '--vault', 'v']);
    assert.deepEqual(writes, []);
  });
});

describe('track tick', () => {
  it('a dry run unless --write: the ticks, then both files written once and read back', () => {
    const dry = cli(['track', 'tick', '--vault', 'v', '--date', DATE, '--id', 'flossing,protein']);
    assert.deepEqual([dry.code, dry.out.dryRun, dry.out.written, dry.writes.length], [0, true, false, 0]);
    assert.deepEqual(dry.out.results.map((r: Json) => [r.id, r.result]), [['flossing', 'set'], ['protein', 'set']]);
    assert.deepEqual(dry.out.habitChanges, [{ habit: 'protein', date: DATE, tick: true }]);
    assert.deepEqual(dry.out.after.open, ['multivitamin', 'shake', 'magnesium', 'water']);
    const wet = cli(['track', 'tick', '--vault', 'v', '--date', DATE, '--id', 'flossing,protein', '--write']);
    assert.deepEqual([wet.code, wet.out.written, wet.writes.map((w) => w.file)], [0, true, ['tracking', 'habits']]);
    const t = JSON.parse(wet.files[TRACKING]!);
    assert.deepEqual([t.days[DATE].flossing.done, t.days[DATE].protein.done, t.days[DATE].protein.at], [true, true, '2026-04-11T01:30:00.000Z']);
    assert.equal(JSON.parse(wet.files[HABITS]!).checkins[habitCheckinKey('protein', DATE)], '1');
  });

  it('--done false unticks; --amount sets the day\'s total in both files; what holds already is unchanged', () => {
    const off = cli(['track', 'tick', '--vault', 'v', '--date', DATE, '--id', 'creatine', '--done', 'false', '--write']);
    assert.equal(off.code, 0);
    assert.notEqual(JSON.parse(off.files[TRACKING]!).days[DATE]?.creatine?.done, true);
    assert.equal(item(cli(['track', 'day', '--vault', 'v', '--date', DATE], (f) => (f[TRACKING] = off.files[TRACKING]!)).out, 'creatine').value.state, 'not done');
    const water = cli(['track', 'tick', '--vault', 'v', '--date', DATE, '--id', 'water', '--amount', '2500', '--write']);
    assert.equal(water.code, 0);
    assert.equal(JSON.parse(water.files[TRACKING]!).days[DATE].water.amount, 2500);
    assert.equal(Number(JSON.parse(water.files[HABITS]!).checkins[habitCheckinKey('water', DATE)]), 2500);
    assert.match(water.out.results[0].note, /^Water: 2500 mL on 2026-04-10 \(the target met\); the Water \(mL\) habit set to the same\.$/);
    const same = cli(['track', 'tick', '--vault', 'v', '--date', DATE, '--id', 'creatine', '--write']);
    assert.deepEqual([same.code, same.out.results[0].result, same.writes.length], [0, 'unchanged', 0]);
  });

  it('refuses what it cannot write, writing nothing: an unknown id, the wrong flag for a kind, a counted item, a later date', () => {
    const bad = (args: string[]) => cli(['track', 'tick', '--vault', 'v', '--date', DATE, ...args, '--write']);
    const ghost = bad(['--id', 'flossing,ghost']);
    assert.deepEqual([ghost.code, ghost.writes.length], [1, 0]);
    assert.match(ghost.out.errors[0].message, /^ghost is not a tracked item/);
    assert.match(bad(['--id', 'water']).out.errors[0].message, /an amount: give the day's total with --amount N/);
    assert.match(bad(['--id', 'flossing', '--amount', '1']).out.errors[0].message, /tick it with --done true or false, not --amount/);
    assert.match(bad(['--id', 'stand-ups']).out.errors[0].message, /Pahlavan counts it on each Mac/);
    const later = cli(['track', 'tick', '--vault', 'v', '--date', '2026-04-11', '--id', 'flossing', '--write']);
    assert.match(later.out.errors[0].message, /after today/);
    assert.equal(cli(['track', 'tick', '--vault', 'v']).code, 2, '--id is required');
    assert.equal(cli(['track', 'tick', '--vault', 'v', '--id', 'water', '--amount', 'lots']).code, 2);
    assert.equal(cli(['track', 'tick', '--vault', 'v', '--id', 'flossing', '--done', 'maybe']).code, 2, '"maybe" is not a value');
  });

  it('a paused or off-day item is ticked with a warning; with no habits-data.json a linked tick starts the vault’s first one', () => {
    const paused = cli(['track', 'tick', '--vault', 'v', '--date', DATE, '--id', 'fish-oil']);
    assert.deepEqual([paused.code, paused.out.warnings[0].code], [0, 'not-due']);
    const noHabits = cli(['track', 'tick', '--vault', 'v', '--date', DATE, '--id', 'protein', '--write'], (f) => delete f[HABITS]);
    assert.deepEqual([noHabits.code, noHabits.writes.length], [0, 2], JSON.stringify(noHabits.out.errors));
    assert.deepEqual(noHabits.out.errors, []);
    assert.equal(paths().habits, '3-Personal/Fitness/habits-data.json', 'no habits file anywhere: the first one goes beside the plan');
  });
});

function snapshot(dir: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of readdirSync(dir, { recursive: true }) as string[]) {
    const p = join(dir, f);
    if (statSync(p).isFile()) m.set(f, readFileSync(p, 'utf8'));
  }
  return m;
}

describe('track day and tick with the built engine, on a temp copy of the vault', () => {
  it('day and the dry run leave every file as it was; --write changes tracking.json and habits-data.json only', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pahlavan-tick-'));
    try {
      const vault = join(tmp, 'vault');
      cpSync(VAULT, vault, { recursive: true });
      const before = snapshot(vault);
      for (const args of [['track', 'day', '--vault', vault, '--date', DATE], ['track', 'tick', '--vault', vault, '--date', DATE, '--id', 'protein']]) {
        const r = spawnSync(process.execPath, [builtEngine(), ...args], { encoding: 'utf8' });
        assert.equal(r.status, 0, r.stdout + r.stderr);
      }
      assert.deepEqual(snapshot(vault), before);
      const wet = spawnSync(process.execPath, [builtEngine(), 'track', 'tick', '--vault', vault, '--date', DATE, '--id', 'protein', '--write'], { encoding: 'utf8' });
      assert.equal(wet.status, 0, wet.stdout + wet.stderr);
      assert.equal(JSON.parse(wet.stdout).written, true);
      const after = snapshot(vault);
      assert.deepEqual([...after.keys()].filter((k) => after.get(k) !== before.get(k)).sort(), ['3-Personal/Fitness/Coach/tracking.json', '5-System/Data/habits-data.json']);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
