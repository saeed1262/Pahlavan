// The gym page's data in phone.json's `gym` link, on the synthetic vault:
// each plan session (and each lift's Express) as the Log panel's Every set
// form starts it, row for row (a swap with the plan's item and the log's
// reason); the plan's rest in seconds; the rotation's
// next as phone.json says it; the link read back by the page's own decoder;
// and the size guard that cuts a long link to the sessions of the day.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { readTracking } from '../src/adapters/vault/tracking-read.ts';
import { GYM_PAGE, gymFromHash, gymLink, type GymRow } from '../src/core/gym.ts';
import { GYM_LINK_MAX, gymData, gymPhoneLink, restSeconds } from '../src/report/gym.ts';
import { buildPhone } from '../src/report/inbox.ts';
import { logFormFor, swapCode, type FormRow } from '../src/report/log-form.ts';
import { buildSession } from '../src/report/session.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

const DATE = '2026-04-10';
const vault = (date = DATE, edit: (f: Record<string, string>) => void = () => {}) => {
  const f = fixtureFiles('v');
  edit(f);
  const io = memoryIo(f, date);
  return { read: readVault(io, 'v', { asOf: date }), tracking: readTracking(io, 'v') };
};
const hashOf = (link: string) => link.slice(link.indexOf('#') + 1);
/** Last time as the page has it: GymLast's fields only. */
const lastOf = (l: FormRow['last']) => (l ? { weight: l.weight, unit: l.unit, reps: l.reps, date: l.date } : null);

describe('restSeconds: the plan\'s rest in seconds', () => {
  it('reads seconds and minutes, the low end of a range, and words after the time', () => {
    const cases: [string | null, number | null][] = [
      ['90 s', 90],
      ['45 s', 45],
      ['90s', 90],
      ['2 min', 120],
      ['2–3 min', 120],
      ['60–90 s', 60],
      ['1-2 min', 60],
      ['1.5 min', 90],
      ['90 s after each pair', 90],
      ['20 s between moves', 20],
      ['2 minutes', 120],
      ['30 sec', 30],
      ['1:30', 90],
      ['1 min 30 s', 90],
      ['2 min 15 sec', 135],
      ['1 min and 30 seconds', 90],
      ['as needed', null],
      ['—', null],
      ['', null],
      [null, null],
      ['easy', null],
    ];
    for (const [text, want] of cases) assert.equal(restSeconds(text), want, String(text));
  });
});

describe('gymData: every session as the Every set form starts it', () => {
  const { read } = vault();
  const data = gymData(read, DATE)!;

  it('holds every plan session in full, and each lift in Express too, with the rotation\'s next', () => {
    assert.deepEqual([data.v, data.date, data.next], [1, DATE, 'B']);
    assert.deepEqual(data.sessions.map((s) => `${s.type} ${s.mode}`), ['A full', 'A express', 'B full', 'B express', 'S1 full', 'S3 full']);
    assert.deepEqual(data.sessions.map((s) => [s.name, s.kind]), [['Full Body A', 'lift'], ['Full Body A', 'lift'], ['Full Body B', 'lift'], ['Full Body B', 'lift'], ['Short 1 · Skills', 'short'], ['Short 3 · Conditioning', 'short']]);
  });

  it('matches logFormFor row for row: the same rows, swaps, sets, targets, last time and parts', () => {
    for (const s of data.sessions) {
      const session = buildSession(read.data, DATE, s.mode, { type: s.type });
      const form = logFormFor(read, session, DATE, { tracking: 'full' })!;
      assert.equal(form.tracking, 'full');
      assert.deepEqual([s.cardio, s.minutes], [form.cardio, form.minutes], `${s.type} ${s.mode}`);
      assert.equal(s.rows.length, form.rows.length, `${s.type} ${s.mode}: rows`);
      form.rows.forEach((r: FormRow, i) => {
        const g: GymRow = s.rows[i]!;
        const at = `${s.type} ${s.mode} ${r.key}`;
        assert.deepEqual(
          [g.key, g.line, g.name, g.planned, g.swap, g.kind, g.sr, g.sets, g.range, g.rir, g.lift, g.unit, g.step, g.target, g.last, g.finisher ?? false],
          [r.key, r.line, r.name, r.planned, swapCode(r), r.kind, r.sr, r.sets, r.repRange, r.rir, r.lift, r.unit, r.step, r.target, lastOf(r.last), r.finisher ?? false],
          at,
        );
        assert.equal(g.note, r.targetNote ?? r.timed?.text ?? null, `${at}: note`);
        assert.deepEqual(g.rows, r.rows.map(({ done: _done, ...x }) => x), `${at}: sets`);
        assert.deepEqual(g.parts ?? null, r.split ? r.split.map((p) => ({ name: p.name, planned: p.planned, swap: swapCode(p), kind: p.kind, sets: p.sets, range: p.repRange, unit: p.unit, step: p.step, target: p.target, last: lastOf(p.last), rows: p.rows.map(({ done: _done, ...x }) => x) })) : null, `${at}: parts`);
      });
    }
  });

  it('gives a swap the plan\'s item and the log\'s reason, as the Log panel saves it; a row as planned neither', () => {
    // 10 Apr: Single-leg dumbbell RDL in place of B's Romanian Deadlift, for the Ledger's limit (the form's "Injury limit").
    for (const mode of ['full', 'express']) {
      const b = data.sessions.find((s) => s.type === 'B' && s.mode === mode)!;
      assert.deepEqual(b.rows.filter((r) => r.planned !== null).map((r) => [r.name, r.planned, r.swap, r.lift]), [['Single-leg dumbbell RDL', 'Romanian Deadlift', 'ledger', 0]], mode);
    }
    for (const s of data.sessions.filter((x) => x.type !== 'B')) for (const r of s.rows) assert.deepEqual([r.planned, r.swap, ...(r.parts ?? []).flatMap((p) => [p.planned, p.swap])], [null, null, ...(r.parts ?? []).flatMap(() => [null, null])], `${s.type} ${r.key}`);
  });

  it('carries last time as its type has it: weight, unit, reps and date, nothing else', () => {
    const lasts = data.sessions.flatMap((s) => s.rows.flatMap((r) => [r.last, ...(r.parts ?? []).map((p) => p.last)])).filter((l) => l !== null);
    assert.ok(lasts.length > 0);
    for (const l of lasts) assert.deepEqual(Object.keys(l).sort(), ['date', 'reps', 'unit', 'weight']);
  });

  it('gives each row its item\'s rest, a superset the rest after the pair, the warm-up and finisher none', () => {
    const rest = (type: string, mode = 'full') => data.sessions.find((s) => s.type === type && s.mode === mode)!.rows.map((r) => [r.name, r.rest, r.restText]);
    assert.deepEqual(rest('A'), [
      ['Warm-up', null, null],
      ['Goblet Squat', 120, '2 min'],
      ['Flat DB Bench Press', 120, '2 min'],
      ['Face Pull + Band External Rotation', 45, '45 s'],
      ['Zone 2 finisher', null, null],
    ]);
    // A swap keeps its slot's rest (Single-leg dumbbell RDL in the Romanian Deadlift's place); "as needed" is no time.
    assert.deepEqual(rest('B').slice(1, 4), [['Single-leg dumbbell RDL', 120, '2 min'], ['Seated Cable Row', 90, '90 s'], ['Bulgarian Split Squat', 60, '60–90 s']]);
    assert.deepEqual(rest('S1')[1], ['Chest-to-wall handstand', null, 'as needed']);
    assert.deepEqual(rest('S3')[1], ['Circuit: squat jump · burpee', 20, '20 s between moves']);
  });

  it('is null with no plan', () => {
    assert.equal(gymData(vault(DATE, (f) => delete f['v/3-Personal/Fitness/plan-data.json']).read, DATE), null);
  });
});

describe('phone.json\'s gym link', () => {
  it('is the page\'s address with the data after the #, which the page\'s decoder reads back whole', () => {
    const { read, tracking } = vault();
    const p = buildPhone(read, tracking, DATE);
    assert.ok(p.gym!.startsWith(`${GYM_PAGE}#`));
    assert.match(hashOf(p.gym!), /^[A-Za-z0-9_-]+$/);
    const back = gymFromHash(hashOf(p.gym!))!;
    assert.deepEqual(back, gymData(read, DATE));
    // The page opens on the session phone.json calls next.
    assert.equal(back.next, p.next!.type);
  });

  it('is well under 32 KB on the synthetic vault, so it carries every session', () => {
    const { read, tracking } = vault();
    const link = buildPhone(read, tracking, DATE).gym!;
    assert.ok(link.length < GYM_LINK_MAX, `${link.length} characters`);
    assert.equal(gymFromHash(hashOf(link))!.sessions.length, 6);
  });

  it('over its limit carries only the next session and the ones logged today, each in its modes', () => {
    // Sat 11 Apr, a short day on the calendar: B is logged, and the rotation's next is S3.
    const day = '2026-04-11';
    const { read, tracking } = vault(day);
    const p = buildPhone(read, tracking, day);
    assert.deepEqual([p.next?.type, p.logged], ['S3', ['B']]);
    const whole = gymLink(gymData(read, day)!);
    assert.equal(gymPhoneLink(read, day, p.logged, whole.length), whole, 'a link at the limit is whole');
    const cut = gymFromHash(hashOf(gymPhoneLink(read, day, p.logged, whole.length - 1)!))!;
    assert.deepEqual(cut.sessions.map((s) => `${s.type} ${s.mode}`), ['B full', 'B express', 'S3 full']);
    assert.equal(cut.next, 'S3');
    // Nothing logged: the next session alone.
    assert.deepEqual(gymFromHash(hashOf(gymPhoneLink(read, day, [], 100)!))!.sessions.map((s) => s.type), ['S3']);
  });

  it('is null without a plan', () => {
    const { read, tracking } = vault(DATE, (f) => delete f['v/3-Personal/Fitness/plan-data.json']);
    assert.equal(buildPhone(read, tracking, DATE).gym, null);
  });

  it('is null before the plan starts (no session to open), not an empty link', () => {
    const { read, tracking } = vault('2026-02-25');
    assert.equal(buildPhone(read, tracking, '2026-02-25').gym, null);
  });
});
