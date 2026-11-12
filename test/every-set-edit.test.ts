// An Every-set session edited and saved again comes back as it was: a
// swapped exercise keeps its sets, its swap and the swap's reason. The two
// ways one is saved: a superset part swapped by the Hotel version (the Log
// panel), and `log add` naming the plan's item as an exerciseSets item's
// `planned`. An entry saved before part swaps were written to `swaps` still
// opens with the done exercise and its sets.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildLogEntry } from '../src/adapters/vault/log-write.ts';
import { readVault } from '../src/adapters/vault/read.ts';
import { run } from '../src/cli/cli.ts';
import { buildSession, inputFromForm, logFormFor, logFormFromEntry } from '../src/report/index.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

type Obj = Record<string, any>;
const DATE = '2026-04-10';
const files = fixtureFiles('v');
const read = readVault(memoryIo(files, DATE), 'v', { asOf: DATE });
const ctx = { plan: read.raw!.plan, log: read.raw!.log, today: DATE };
const FLY = 'Bent-over reverse dumbbell fly';

/** An edit of the entry, saved with nothing changed. */
function resave(entry: Obj): Obj {
  const f = logFormFromEntry(read, entry);
  const r = buildLogEntry(inputFromForm(f), { ...ctx, original: entry });
  assert.ok(r.ok, r.ok ? '' : r.error);
  return r.entry;
}

/** Hotel A at Every set from the Log panel: the goblet squat's sets and the swapped face pull's, ticked. */
function hotelA(): Obj {
  const f = logFormFor(read, buildSession(read.data, DATE, 'hotel', { type: 'A' }), DATE)!;
  f.tracking = 'full';
  for (const s of f.rows.find((r) => r.name === 'Goblet Squat')!.rows) s.done = true;
  const fly = f.rows.find((r) => r.split)!.split!.find((p) => p.planned === 'Face Pull')!;
  assert.equal(fly.name, FLY);
  for (const s of fly.rows) Object.assign(s, { weight: 15, reps: 12, done: true });
  const r = buildLogEntry(inputFromForm(f), ctx);
  assert.ok(r.ok, r.ok ? '' : r.error);
  return r.entry;
}

describe('an Every-set session edited and saved again', () => {
  it('a superset part\'s swap is saved in swaps, with its reason', () => {
    const e = hotelA();
    assert.ok((e['swaps'] as Obj[]).some((s) => s['from'] === 'Face Pull' && s['to'] === FLY && s['why'] === 'hotel'), JSON.stringify(e['swaps']));
    assert.deepEqual((e['exerciseSets'] as Obj[]).find((x) => x['name'] === FLY), { name: FLY, planned: 'Face Pull', sets: [0, 1, 2].map(() => ({ weight: 15, unit: 'lb', reps: 12 })) });
  });

  it('Hotel A: the edit shows the fly with its sets and the swap, and saves the identical entry', () => {
    const e = hotelA();
    const f = logFormFromEntry(read, e);
    const row = f.rows.find((r) => r.line === 'Face Pull')!;
    assert.deepEqual([row.name, row.planned, row.swapWhy, row.rows.length, row.rows.every((s) => s.done)], [FLY, 'Face Pull', 'Hotel swap', 3, true]);
    assert.deepEqual(resave(e), e);
  });

  it('an entry saved before part swaps were in swaps opens with the fly and its sets, and keeps them', () => {
    const e = hotelA();
    const old = { ...e, swaps: (e['swaps'] as Obj[]).filter((s) => s['from'] !== 'Face Pull') };
    if (!old.swaps.length) delete (old as Obj)['swaps'];
    const row = logFormFromEntry(read, old).rows.find((r) => r.line === 'Face Pull')!;
    assert.deepEqual([row.name, row.planned, row.swapWhy, row.rows.length], [FLY, 'Face Pull', 'Swap', 3]);
    const again = resave(old);
    assert.deepEqual(again['exerciseSets'], e['exerciseSets'], 'the fly\'s sets are kept');
    assert.ok((again['swaps'] as Obj[]).some((s) => s['from'] === 'Face Pull' && s['to'] === FLY && !('why' in s)), 'the swap is recorded, its reason unknown');
  });

  it('log add: a swap named only as planned in exerciseSets is saved in swaps too, and an edit saves the identical entry', () => {
    const session = {
      date: DATE,
      type: 'B',
      lift1: { name: 'Romanian Deadlift', weight: 0, reps: 0 },
      lift2: { name: 'Seated Cable Row', weight: 115, reps: 11, unit: 'lb' },
      trackingLevel: 'full',
      exerciseSets: [
        { name: 'Seated Cable Row', sets: [{ weight: 115, unit: 'lb', reps: 11, rir: 2 }, { weight: 115, unit: 'lb', reps: 10 }] },
        { name: 'Goblet Squat', planned: 'Bulgarian Split Squat', sets: [{ weight: 40, unit: 'lb', reps: 10 }, { weight: 40, unit: 'lb', reps: 9, rir: 1 }] },
      ],
    };
    const r = run(['log', 'add', '--file', 'v/s.json', '--vault', 'v'], memoryIo({ ...files, 'v/s.json': JSON.stringify(session) }, DATE) as never);
    assert.equal(r.code, 0, r.stdout);
    const e = (JSON.parse(r.stdout) as Obj).session as Obj;
    assert.deepEqual(e['swaps'], [{ from: 'Bulgarian Split Squat', to: 'Goblet Squat' }]);
    const row = logFormFromEntry(read, e).rows.find((x) => x.line === 'Bulgarian Split Squat')!;
    assert.deepEqual([row.name, row.planned, row.rows.map((s) => s.reps)], ['Goblet Squat', 'Bulgarian Split Squat', [10, 9]]);
    assert.deepEqual(resave(e), e);
    // An entry from before (no swaps): the edit keeps the goblet squat's sets.
    const { swaps: _, ...old } = e;
    assert.deepEqual(resave(old)['exerciseSets'], e['exerciseSets']);
  });
});
