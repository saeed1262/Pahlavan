// The frozen exercise list for a session logged elsewhere (fitness_log.py
// add): `session --freeze` prints the `exercises` a log entry gets, exactly
// as the Log panel's save writes it for that session and date (the plan's
// lines and sets, a light week's 2 sets, the ladder levels of that day,
// Express's own block), with the logged lifts as the entry names them (a
// swap's `planned`). Read only. On the synthetic vault (plan from Mon 2 Mar
// 2026; plan week 4, from 23 Mar, is a light week).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildLogEntry } from '../src/adapters/vault/log-write.ts';
import { readVault } from '../src/adapters/vault/read.ts';
import { run } from '../src/cli/cli.ts';
import { buildSession, frozenList, inputFromForm, logFormFor } from '../src/report/index.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

type Json = Record<string, any>;
const TODAY = '2026-04-10';
const at = (date: string) => readVault(memoryIo(fixtureFiles('v'), TODAY), 'v', { asOf: date });
const cli = (...argv: string[]) => {
  const files = fixtureFiles('v');
  const before = JSON.stringify(files);
  const r = run(['session', '--vault', 'v', ...argv], memoryIo(files, TODAY));
  assert.equal(JSON.stringify(files), before, 'read only');
  return { code: r.code, out: JSON.parse(r.stdout) as Json, stderr: r.stderr };
};
/** The list the Log panel's save writes for a new log of that session and date. */
function panelList(date: string, type: string, mode: 'full' | 'express' = 'full') {
  const r = at(date);
  const form = logFormFor(r, buildSession(r.data, date, mode, { type }), date)!;
  const e = buildLogEntry(inputFromForm(form), { plan: r.raw?.plan, log: r.raw?.log, today: TODAY });
  assert.ok(e.ok);
  return e.entry['exercises'];
}

describe('frozenList: the exercise list a log entry gets, as the Log panel saves it', () => {
  for (const [date, type, mode] of [['2026-04-09', 'A', 'full'], ['2026-03-26', 'A', 'full'], ['2026-04-08', 'B', 'express'], ['2026-03-10', 'S1', 'full'], ['2026-04-10', 'S1', 'full']] as const) {
    it(`${type} on ${date}${mode === 'express' ? ', Express' : ''}: the same list word for word`, () => {
      const f = frozenList(at(date), { date, type, mode }, TODAY);
      assert.ok(f.ok);
      assert.deepEqual(f.list.value.exercises, panelList(date, type, mode));
    });
  }

  it('a light week gives 2 sets of each; the ladder levels are that day’s', () => {
    const light = frozenList(at('2026-03-26'), { date: '2026-03-26', type: 'A', mode: 'full' }, TODAY);
    assert.ok(light.ok && light.list.value.deloadWeek);
    assert.ok(light.list.value.exercises.filter((x) => x.name !== 'Zone 2 finisher').every((x) => x.sets === 2), JSON.stringify(light.list.value.exercises));
    const early = frozenList(at('2026-03-10'), { date: '2026-03-10', type: 'S1', mode: 'full' }, TODAY);
    const now = frozenList(at(TODAY), { date: TODAY, type: 'S1', mode: 'full' }, TODAY);
    assert.ok(early.ok && now.ok);
    assert.ok(early.list.value.exercises.some((x) => /^Incline push-up/.test(x.name)), 'before 17 Mar: the push-up ladder’s level 1');
    assert.ok(now.list.value.exercises.some((x) => /^Floor push-up/.test(x.name)), 'later: level 2');
  });

  it('a swap names the plan’s lift as planned; the list keeps the plan’s names', () => {
    const plain = frozenList(at('2026-04-09'), { date: '2026-04-09', type: 'A', mode: 'full' }, TODAY);
    const swap = frozenList(at('2026-04-09'), { date: '2026-04-09', type: 'A', mode: 'full', lifts: [null, 'Incline DB Press'] }, TODAY);
    assert.ok(plain.ok && swap.ok);
    assert.deepEqual(swap.list.value.exercises, plain.list.value.exercises);
    assert.deepEqual(swap.list.value.lift1, plain.list.value.lift1);
    assert.deepEqual(swap.list.value.lift2, { name: 'Incline DB Press', planned: plain.list.value.lift2!.name });
    assert.match(swap.list.reason.note!, /A swap names the plan's lift as `planned` \(Incline DB Press for .+\); the list keeps the plan's names\./);
    assert.deepEqual([swap.list.reason.rule, swap.list.reason.title], ['log.freeze', 'Exercise list']);
  });

  it('refuses what the log writer refuses: a date after today, a lift on a short day', () => {
    assert.deepEqual(frozenList(at(TODAY), { date: '2026-04-11', type: 'A', mode: 'full' }, TODAY), { ok: false, error: '2026-04-11 is in the future' });
    assert.deepEqual(frozenList(at(TODAY), { date: TODAY, type: 'S1', mode: 'full', lifts: ['Push-up', null] }, TODAY), { ok: false, error: 'a S1 session has no logged lifts' });
  });

  it('Express on a short day is saved as the short day itself, as the Log panel saves it', () => {
    const f = frozenList(at(TODAY), { date: TODAY, type: 'S1', mode: 'express' }, TODAY);
    const full = frozenList(at(TODAY), { date: TODAY, type: 'S1', mode: 'full' }, TODAY);
    assert.ok(f.ok && full.ok);
    assert.equal(f.list.value.express, false);
    const plan = (xs: { name: string; sets: number; daySets?: number }[]) => xs.map((x) => ({ name: x.name, sets: x.sets }));
    assert.deepEqual(plan(f.list.value.exercises), plan(full.list.value.exercises));
    // The day's working sets are the Express day's own (half the sets); the timed handstand has none.
    assert.deepEqual(f.list.value.exercises.map((x) => x.daySets), [undefined, 2, 2]);
    assert.deepEqual(full.list.value.exercises.map((x) => x.daySets), [undefined, 4, 3]);
  });
});

describe('cli: session --freeze', () => {
  it('prints the list with the logged lifts and its reason, read only', () => {
    const { code, out } = cli('--freeze', '--type', 'A', '--date', '2026-03-26', '--lift1', 'Front Squat');
    assert.equal(code, 0);
    assert.deepEqual(Object.keys(out.freeze.value), ['date', 'type', 'express', 'deloadWeek', 'exercises', 'lift1', 'lift2', 'checklist']);
    assert.deepEqual(out.freeze.value.exercises, panelList('2026-03-26', 'A'));
    assert.equal(out.freeze.value.lift1.name, 'Front Squat');
    assert.ok(out.freeze.value.lift1.planned);
    assert.equal(out.freeze.reason.rule, 'log.freeze');
    assert.ok(!('items' in out), 'not the session itself');
  });

  it('--mode express gives the Express block', () => {
    const { out } = cli('--freeze', '--type', 'B', '--date', '2026-04-08', '--mode', 'express');
    assert.equal(out.freeze.value.express, true);
    assert.deepEqual(out.freeze.value.exercises, panelList('2026-04-08', 'B', 'express'));
  });

  it('usage errors: no --type, an unknown one, a date after today, a lift on a short day, --lift1 without --freeze', () => {
    for (const [argv, msg] of [
      [['--freeze'], /session --freeze needs --type, one of the plan's sessions: A, B, S1, S3/],
      [['--freeze', '--type', 'Z'], /--type must be one of the plan's sessions/],
      [['--freeze', '--type', 'A', '--date', '2026-04-11'], /session --freeze: 2026-04-11 is in the future/],
      [['--freeze', '--type', 'S1', '--lift1', 'Push-up'], /session --freeze: a S1 session has no logged lifts/],
      [['--type', 'A', '--lift1', 'Front Squat'], /--lift1, --lift2 and --skip go with --freeze/],
    ] as const) {
      const r = cli(...argv);
      assert.equal(r.code, 2, argv.join(' '));
      assert.match(r.stderr, msg);
    }
  });
});
