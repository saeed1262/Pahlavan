// The user's pick of session: any session type in the plan, built with the
// same targets, trims, Ledger screen and variants as the suggestion, and
// marked as the user's choice.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { buildSession, buildToday } from '../src/report/index.ts';
import { ROOT } from './helpers.ts';

const VAULT = join(ROOT, 'test', 'fixtures', 'vault');
const fsIo = {
  readText: (p: string) => (existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null),
  listDir: (p: string) => (existsSync(p) && statSync(p).isDirectory() ? readdirSync(p) : null),
};
const DATE = '2026-04-10'; // the rotation suggests B; readiness is low on short sleep
const read = readVault(fsIo, VAULT, { asOf: DATE });
const plain = (x: unknown) => JSON.parse(JSON.stringify(x));

describe('a picked session', () => {
  const none = buildSession(read.data, DATE, 'full');
  const a = buildSession(read.data, DATE, 'full', { type: 'A' });

  it('builds the picked type and says it was the user’s choice', () => {
    assert.deepEqual([none.session!.type, none.session!.picked], ['B', false]);
    assert.deepEqual([a.session!.type, a.session!.picked, a.session!.logged], ['A', true, false]);
    assert.equal(a.session!.why, 'Chosen by you; the rotation suggested Full Body B.');
    assert.deepEqual(a.session!.suggested, { type: 'B', name: 'Full Body B', kind: 'lift', why: none.session!.why });
  });

  it('applies the same rules: targets, the readiness trim and the session flags', () => {
    assert.deepEqual(a.flags.map((f) => f.rule), none.flags.map((f) => f.rule));
    const squat = a.items.find((i) => i.exercise === 'goblet-squat')!;
    assert.ok(squat.target && squat.target.weight !== null);
    assert.ok(squat.adjustments.some((x) => x.rule === 'progression.double' || x.rule.startsWith('progression')));
  });

  it('trims a picked session on a low-readiness day and screens it against the Ledger', () => {
    const day = '2026-04-13'; // readiness low: one set fewer, RIR +1; the rotation suggests A
    const b = buildSession(readVault(fsIo, VAULT, { asOf: day }).data, day, 'full', { type: 'B' });
    assert.deepEqual([b.session!.type, b.session!.why], ['B', 'Chosen by you; the rotation suggested Full Body A.']);
    assert.ok(b.items.every((i) => i.adjustments.some((x) => x.rule === 'readiness.trim')));
    const rdl = b.items[0]!;
    assert.deepEqual([rdl.replaces?.exercise, rdl.adjustments[0]!.rule], ['romanian-deadlift', 'safety.ledger']);
  });

  it('keeps the mode: Express and Hotel work on the pick', () => {
    const ae = buildSession(read.data, DATE, 'express', { type: 'A' });
    const ah = buildSession(read.data, DATE, 'hotel', { type: 'A' });
    assert.deepEqual([ae.mode, ae.session!.type, ae.session!.picked], ['express', 'A', true]);
    assert.ok(ae.items.length < a.items.length);
    assert.deepEqual([ah.mode, ah.session!.type], ['hotel', 'A']);
    assert.ok(ah.flags.some((f) => f.rule.startsWith('variant.hotel') || f.title === 'Hotel'));
  });

  it('picks a short session on a lifting day', () => {
    const s3 = buildSession(read.data, DATE, 'full', { type: 'S3' });
    assert.deepEqual([s3.session!.type, s3.session!.kind, s3.session!.picked], ['S3', 'short', true]);
  });

  it('lists every plan session, the suggestion first', () => {
    assert.deepEqual(a.choices.map((c) => [c.type, c.suggested]), [['B', true], ['A', false], ['S1', false], ['S3', false]]);
  });

  it('treats a pick of the suggestion as no pick', () => {
    assert.deepEqual(plain(buildSession(read.data, DATE, 'full', { type: 'B' })), plain(none));
    assert.deepEqual(plain(buildSession(read.data, DATE, 'full', { type: null })), plain(none));
  });

  it('falls back to the suggestion, with a calm note, for a type the plan does not have', () => {
    const z = buildSession(read.data, DATE, 'full', { type: 'Z' });
    assert.deepEqual([z.session!.type, z.session!.picked], ['B', false]);
    assert.match(z.pickNote!, /^No session "Z" in the plan \(it has A, B, S1, S3\); showing the suggested session\.$/);
    const t = buildToday(read, DATE, 'full', '', { type: 'Z' });
    assert.ok(t.notes.some((n) => n.code === 'pick-unknown'));
  });

  it('carries the pick through the Today report', () => {
    const t = buildToday(read, DATE, 'full', '', { type: 'S1' });
    assert.deepEqual([t.session!.session!.type, t.session!.session!.picked], ['S1', true]);
    assert.ok(!t.notes.some((n) => n.code === 'pick-unknown'));
  });
});
