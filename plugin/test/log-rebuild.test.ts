// The Log panel's form when its date changes: rebuilt from that date's plan
// (its session, exercises, deload sets and ladder levels), opened as an edit
// when that day already has the session, and moved as it is when it is an
// edit. The files are read as of each date, as the view reads them.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { isDeloadDate } from '../../src/adapters/vault/log-write.ts';
import { readVault } from '../../src/adapters/vault/read.ts';
import { buildSession, customLogForm, logFormFor, logFormFromEntry, type LogForm } from '../../src/report/index.ts';
import { loggedEntry, rebuildForm } from '../src/log-rebuild.ts';
import { useFolders } from '../../src/adapters/vault/layout.ts';
import { FIXTURE_FOLDERS } from '../../test/helpers.ts';

useFolders(FIXTURE_FOLDERS);

const VAULT = join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'vault');
const fsIo = {
  readText: (p: string) => (existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null),
  listDir: (p: string) => (existsSync(p) && statSync(p).isDirectory() ? readdirSync(p) : null),
};
const at = (date: string) => readVault(fsIo, VAULT, { asOf: date });
const TODAY = '2026-04-10';
const today = at(TODAY);
const formFor = (date: string, type?: string) => {
  const r = at(date);
  return logFormFor(r, buildSession(r.data, date, 'full', type ? { type } : {}), date)!;
};
const row = (f: LogForm, name: RegExp) => f.rows.find((r) => name.test(r.name));

describe('rebuildForm: a new log moved to another date', () => {
  const base = formFor(TODAY);
  base.rpe = 7;
  base.notes = 'Felt fine';

  it('takes that date’s session and its sets, keeping the RPE and notes but not today’s sore muscles', () => {
    assert.equal(base.type, 'B');
    assert.equal(row(base, /Single-leg/)!.sets, 2, 'today’s sore glutes trim a set');
    const next = rebuildForm(at('2026-04-09'), base, { date: '2026-04-09' })!;
    assert.deepEqual([next.date, next.type, next.edit], ['2026-04-09', 'B', false]);
    assert.equal(row(next, /Single-leg/)!.sets, 3);
    assert.deepEqual([next.rpe, next.notes], [7, 'Felt fine']);
    assert.deepEqual(next.sore, next.soreFrom);
    assert.notEqual(JSON.stringify(next.sore), JSON.stringify(base.sore));
  });

  it('follows the date’s suggestion when the session was the suggestion', () => {
    const next = rebuildForm(at('2026-04-02'), base, { date: '2026-04-02' })!;
    assert.deepEqual([next.type, next.suggested, next.edit], ['A', 'A', false]);
    assert.ok(row(next, /Goblet Squat/));
  });

  it('gives a deload day its deload sets', () => {
    const date = '2026-03-26';
    assert.equal(isDeloadDate(today.raw?.plan, today.raw?.log, date), true);
    const next = rebuildForm(at(date), base, { date })!;
    assert.equal(next.type, 'A');
    assert.equal(row(next, /Goblet Squat/)!.sets, 2);
    assert.equal(row(next, /Goblet Squat/)!.sr, '2 × 8–10');
    assert.equal(formFor('2026-04-08', 'A').rows.find((r) => /Goblet Squat/.test(r.name))!.sets, 4, 'a loading week has the full sets');
  });

  it('keeps the session the user chose, with the ladder levels of that date', () => {
    const picked = formFor(TODAY, 'S1');
    assert.ok(row(picked, /^Floor push-up/), 'today: the push-up ladder’s level 2');
    assert.ok(row(picked, /^Chest-to-wall handstand/), 'today: the handstand ladder’s level 3');
    const next = rebuildForm(at('2026-03-10'), picked, { date: '2026-03-10' })!;
    assert.deepEqual([next.type, next.edit], ['S1', false]);
    assert.ok(row(next, /^Incline push-up/), 'before 17 Mar: level 1');
    assert.ok(row(next, /^Pike hold on a bench/), 'before 24 Mar: level 1');
  });

  it('opens the session already logged that day as its edit', () => {
    const date = '2026-04-08';
    const r = at(date);
    const next = rebuildForm(r, base, { date })!;
    assert.equal(next.edit, true);
    assert.deepEqual([next.date, next.type, next.original?.key], [date, 'A', `${date}|A|`]);
    assert.deepEqual(next, logFormFromEntry(r, loggedEntry(r, date, 'A')!));
  });

  it('builds a later change of version from the moved date’s plan, not today’s', () => {
    const date = '2026-03-26';
    const moved = rebuildForm(at(date), base, { date })!;
    const next = rebuildForm(at(date), moved, { mode: 'hotel' })!;
    assert.deepEqual([next.date, next.mode], [date, 'hotel']);
    assert.ok(next.rows.filter((r) => r.kind !== 'warmup' && r.kind !== 'cardio').every((r) => r.sets <= 2), 'still the deload sets');
  });
});

describe('rebuildForm: what the user typed stays where the same field exists', () => {
  const DAY = '2026-04-09';
  const fresh = formFor(DAY);

  it('a typed top set, a skip with its reason and the session’s own answers move to the same lines; untouched values take the new date’s', () => {
    const f = formFor(TODAY);
    row(f, /^Seated Cable Row/)!.top = { weight: 120, reps: 10 };
    Object.assign(row(f, /^Side Plank/)!, { done: false, why: 'time' });
    Object.assign(f, { cardio: 15, cardioMode: 'bike', rating: 8, posture: true });
    const next = rebuildForm(at(DAY), f, { date: DAY })!;
    assert.deepEqual([next.date, next.type, next.edit], [DAY, 'B', false]);
    assert.deepEqual(row(next, /^Seated Cable Row/)!.top, { weight: 120, reps: 10 });
    assert.deepEqual([row(next, /^Side Plank/)!.done, row(next, /^Side Plank/)!.why], [false, 'time']);
    assert.deepEqual([next.cardio, next.cardioMode, next.rating, next.posture], [15, 'bike', 8, true]);
    // Not typed: the new date's own minutes, sets and rows.
    assert.equal(next.minutes, fresh.minutes);
    assert.equal(row(next, /^Bulgarian/)!.sets, 3, 'the new date’s sets (today’s sore glutes trimmed one)');
    for (const name of [/^Warm-up/, /^Bulgarian/, /^Zone 2/]) assert.deepEqual({ ...row(next, name)!, key: '' }, { ...row(fresh, name)!, key: '' }, String(name));
  });

  it('the user’s own swap stays on its line; a logged lift swapped starts blank, as the Swap menu sets it', () => {
    const f = formFor(TODAY);
    Object.assign(row(f, /^Bulgarian/)!, { planned: 'Bulgarian Split Squat', name: 'Reverse Lunge', swapWhy: 'Your swap' });
    Object.assign(row(f, /^Seated Cable Row/)!, { planned: 'Seated Cable Row', name: 'One-Arm DB Row', swapWhy: 'Your swap', target: null, top: { weight: null, reps: null }, targetNote: 'New to the log: enter what you used.' });
    const next = rebuildForm(at(DAY), f, { date: DAY })!;
    const b = next.rows.find((r) => r.line === 'Bulgarian Split Squat')!;
    assert.deepEqual([b.name, b.planned, b.swapWhy], ['Reverse Lunge', 'Bulgarian Split Squat', 'Your swap']);
    const lift = next.rows.find((r) => r.line === 'Seated Cable Row')!;
    assert.deepEqual([lift.name, lift.planned, lift.target, lift.top, lift.targetNote], ['One-Arm DB Row', 'Seated Cable Row', null, { weight: null, reps: null }, 'New to the log: enter what you used.']);
    // A swap the plan made (the Ledger's) is the new date's own, not carried.
    assert.deepEqual([row(next, /dumbbell RDL/)!.planned, row(next, /dumbbell RDL/)!.swapWhy], [row(fresh, /dumbbell RDL/)!.planned, row(fresh, /dumbbell RDL/)!.swapWhy]);
  });

  it('every set typed stays; sets still as prefilled take the new date’s', () => {
    const f = formFor(TODAY);
    f.tracking = 'full';
    row(f, /^Seated Cable Row/)!.rows = [{ weight: 120, reps: 10, rir: 2, done: true }, { weight: 120, reps: 9, rir: 1, done: true }, { weight: 120, reps: 8, rir: 0, done: false }];
    const next = rebuildForm(at(DAY), f, { date: DAY })!;
    assert.equal(next.tracking, 'full');
    assert.deepEqual(row(next, /^Seated Cable Row/)!.rows.map((x) => [x.reps, x.done]), [[10, true], [9, true], [8, false]], 'the ticks come along');
    assert.deepEqual(row(next, /^Bulgarian/)!.rows, row(fresh, /^Bulgarian/)!.rows);
  });

  it('a value typed and then put back as it started is not carried: the new form’s own stands', () => {
    // "Something else" starts with no minutes; the planned session has its own.
    const c = customLogForm(at('2026-02-20'), '2026-02-20');
    c.minutes = 45;
    c.minutes = null;
    assert.equal(rebuildForm(at(TODAY), c, { date: TODAY })!.minutes, formFor(TODAY).minutes);
    assert.notEqual(formFor(TODAY).minutes, null);
  });

  it('the "Something else" a day without a plan opened on follows the date, keeping what was typed; one with a label stays', () => {
    const before = '2026-02-20';
    const c = customLogForm(at(before), before);
    assert.deepEqual([c.type, c.suggested], ['custom', null]);
    c.minutes = 45;
    c.notes = 'Felt fine';
    const next = rebuildForm(at(TODAY), c, { date: TODAY })!;
    assert.deepEqual([next.type, next.suggested, next.edit, next.minutes, next.notes], ['B', 'B', false, 45, 'Felt fine']);
    const hike = { ...customLogForm(at(before), before), label: 'Easy hike' };
    const kept = rebuildForm(at(TODAY), hike, { date: TODAY })!;
    assert.deepEqual([kept.type, kept.label, kept.suggested], ['custom', 'Easy hike', 'B']);
  });

  it('"Something else" picked over the day’s suggestion stays the user’s choice', () => {
    const picked = rebuildForm(at(TODAY), formFor(TODAY), { type: 'custom' })!;
    assert.deepEqual([picked.type, picked.suggested], ['custom', 'B']);
    assert.equal(rebuildForm(at(DAY), picked, { date: DAY })!.type, 'custom');
  });
});

describe('rebuildForm: an edit', () => {
  it('moves to the new date with what was logged, rebuilding nothing', () => {
    const r = at('2026-04-08');
    const edit = logFormFromEntry(r, loggedEntry(r, '2026-04-08', 'A')!);
    const next = rebuildForm(at('2026-04-09'), edit, { date: '2026-04-09' })!;
    assert.deepEqual({ ...next, date: edit.date }, edit);
    assert.deepEqual([next.date, next.edit, next.original?.key], ['2026-04-09', true, '2026-04-08|A|']);
  });
});
