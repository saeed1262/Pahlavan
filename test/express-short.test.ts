// Express on a short day: every item at half its rounds, minutes or sets,
// rounded up, at least 1. The session never comes out empty.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { halveSr, shortExpressVariant } from '../src/core/variant.ts';
import { buildSession, buildToday } from '../src/report/index.ts';
import { ROOT } from './helpers.ts';

const VAULT = join(ROOT, 'test', 'fixtures', 'vault');
const fsIo = {
  readText: (p: string) => (existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null),
  listDir: (p: string) => (existsSync(p) && statSync(p).isDirectory() ? readdirSync(p) : null),
};
const DATE = '2026-04-10';
const read = readVault(fsIo, VAULT, { asOf: DATE });

describe('halveSr', () => {
  it('halves rounds, minutes and leading sets, rounded up, at least 1', () => {
    assert.equal(halveSr('4 rounds, 40/20'), '2 rounds, 40/20');
    assert.equal(halveSr('3 rounds, 30/30'), '2 rounds, 30/30');
    assert.equal(halveSr('1 round'), '1 round');
    assert.equal(halveSr('2 rounds'), '1 round');
    assert.equal(halveSr('6 min'), '3 min');
    assert.equal(halveSr('3 min'), '2 min');
    assert.equal(halveSr('5–10 min'), '3–5 min');
    assert.equal(halveSr('4 × 6–12'), '2 × 6–12');
    assert.equal(halveSr('3 × 8/side'), '2 × 8/side');
    assert.equal(halveSr('3 × 20–40 s/side'), '2 × 20–40 s/side');
  });
});

describe('shortExpressVariant', () => {
  it('keeps every item at half its sets, with a titled reason each', () => {
    const t = { id: 's', name: 'S', kind: 'short' as const, slots: [{ exercise: 'a', sets: 4, repRange: [1, 1] as [number, number], rir: 2 }, { exercise: 'b', sets: 1, repRange: [8, 8] as [number, number], rir: 2 }] };
    const r = shortExpressVariant(t, (s) => (s.exercise === 'a' ? '4 rounds, 40/20' : null));
    assert.deepEqual(r.value.slots.map((s) => [s.exercise, s.sets, s.sr]), [['a', 2, '2 rounds, 40/20'], ['b', 1, null]]);
    assert.deepEqual(r.value.slots.map((s) => s.reasons[0]!.title), ['Express', 'Express']);
    assert.equal(r.reason.title, 'Express');
    assert.match(r.reason.note!, /half its rounds, minutes or sets/);
  });
});

describe('Express on the fixture’s short days', () => {
  it('S3: the circuit at 2 rounds and its cool-down at 2 minutes', () => {
    const s = buildSession(read.data, DATE, 'express', { type: 'S3' });
    assert.deepEqual(s.items.map((i) => [i.name, i.sr]), [['Circuit: squat jump · burpee', '2 rounds, 40/20']]);
    assert.deepEqual(s.finisher, { exercise: 'cool-down-walk-or-bike', name: 'Cool-down walk or bike', sr: '2 min' });
    assert.ok(s.flags.some((f) => f.rule === 'variant.express' && f.title === 'Express'));
    assert.equal(s.items[0]!.adjustments[0]!.note, '2 rounds, 40/20 instead of 4 rounds, 40/20.');
  });
  it('S1: every item kept, each at half, with the short warm-up', () => {
    const full = buildSession(read.data, DATE, 'full', { type: 'S1' });
    const s = buildSession(read.data, DATE, 'express', { type: 'S1' });
    assert.equal(s.items.length, full.items.length);
    assert.deepEqual(s.items.map((i) => [i.sets, i.sr]), [[2, '3 min'], [2, '2 × 6–12'], [2, '2 × 8/side']]);
    assert.equal(s.warmup, full.warmup);
    const mins = (x: typeof s) => ('plannedLoad' in x ? x.plannedLoad.minutes : null);
    assert.ok(mins(s)! < (mins(full) ?? Infinity));
  });
  it('names each item’s plan line, for the log', () => {
    const s = buildSession(read.data, DATE, 'full', { type: 'S1' });
    assert.deepEqual(s.items.map((i) => i.planName), ['Handstand (your level)', 'Push-up (your level)', 'Dead Bug']);
    const b = buildSession(read.data, DATE, 'full');
    assert.equal(b.items[0]!.planName, 'Romanian Deadlift'); // swapped by the Ledger, the plan's line kept
  });
  it('reaches Today', () => {
    const t = buildToday(read, DATE, 'express', '', { type: 'S3' });
    assert.equal(t.session!.items[0]!.sr, '2 rounds, 40/20');
  });
  it('leaves a lifting day’s Express as it was', () => {
    const s = buildSession(read.data, DATE, 'express');
    assert.deepEqual(s.items.map((i) => i.name), ['Single-leg dumbbell RDL', 'Seated Cable Row']);
  });
});
