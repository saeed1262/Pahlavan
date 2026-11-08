// The Log panel's model: today's session laid onto the dashboard's checklist
// lines, and back to the log writer's input; an edit read back from its entry.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { buildLogEntry, mergeLog } from '../src/adapters/vault/log-write.ts';
import { readVault } from '../src/adapters/vault/read.ts';
import { CALIBRATION } from '../src/core/calibration.ts';
import { buildSession, customLogForm, inputFromForm, logFormFor, logFormFromEntry, soreChanges, topOf } from '../src/report/index.ts';
import { ROOT } from './helpers.ts';

const VAULT = join(ROOT, 'test', 'fixtures', 'vault');
const fsIo = {
  readText: (p: string) => (existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null),
  listDir: (p: string) => (existsSync(p) && statSync(p).isDirectory() ? readdirSync(p) : null),
};
const DATE = '2026-04-10';
const read = readVault(fsIo, VAULT, { asOf: DATE });
const LOG_TEXT = readFileSync(join(VAULT, '3-Personal/Fitness/fitness-log-data.json'), 'utf8');
const ctx = { plan: read.raw!.plan, log: read.raw!.log, today: DATE };
const formB = () => logFormFor(read, buildSession(read.data, DATE, 'full'), DATE)!;

describe('a new log from today’s session', () => {
  it('lays the session onto the checklist lines, with the logged lifts, targets and swaps', () => {
    const f = formB();
    assert.deepEqual(f.rows.map((r) => r.line), ['Warm-up', 'Romanian Deadlift', 'Seated Cable Row', 'Bulgarian Split Squat', 'Side Plank', 'Zone 2 finisher']);
    assert.deepEqual(f.rows.map((r) => r.kind), ['warmup', 'load', 'load', 'load', 'timed', 'cardio']);
    const [, rdl, row] = f.rows;
    assert.deepEqual([rdl!.name, rdl!.planned, rdl!.swapWhy, rdl!.lift, rdl!.target], ['Single-leg dumbbell RDL', 'Romanian Deadlift', 'Injury limit', 0, null]);
    assert.match(rdl!.targetNote!, /pick a weight for 8-10 reps/);
    assert.deepEqual([row!.lift, row!.target, row!.unit, row!.step, row!.top], [1, { weight: 115, reps: 11, rir: 2 }, 'lb', 10, { weight: 115, reps: 11 }]);
    assert.ok(rdl!.swaps.length > 0);
    assert.deepEqual([f.type, f.suggested, f.mode, f.cardio, f.minutes, f.plannedRpe], ['B', 'B', 'full', 10, 60, 7.5]);
    assert.deepEqual(f.soreFrom, { gluteal: 'sore', quadriceps: 'mild' });
  });
  it('starts each row from today’s ticks on Today: ticked rows Done, the others Skipped, once any is ticked', () => {
    const log = read.raw!.log as Record<string, unknown>;
    const ticked = (checked: boolean[], over: Record<string, unknown> = {}) => ({ ...read, raw: { ...read.raw!, log: { ...log, todayChecklist: { date: DATE, type: 'B', express: false, checked, ...over } } } });
    const f = logFormFor(ticked([true, true, false, true, false, true]), buildSession(read.data, DATE, 'full'), DATE)!;
    assert.deepEqual(f.rows.map((r) => r.done), [true, true, false, true, false, true]);
    assert.deepEqual(f.rows.map((r) => r.why), [null, null, null, null, null, null], 'a skip from a tick has no reason yet');
    assert.deepEqual(f.fromTicks, { done: 4, skipped: 2 });
    // Nothing ticked yet, another day's record or another version's: every row starts Done, as before.
    for (const r of [ticked([false, false, false, false, false, false]), ticked([true, false, false, false, false, false], { date: '2026-04-09' }), ticked([true, false, false, false, false, false], { express: true })]) {
      const g = logFormFor(r, buildSession(read.data, DATE, 'full'), DATE)!;
      assert.ok(g.rows.every((x) => x.done));
      assert.equal(g.fromTicks, undefined);
    }
    assert.equal(formB().fromTicks, undefined, 'the fixture’s record is for another day');
  });
  it('counts the Last line and the prefilled weights from the cycle start: an older top set starts blank, its target a tap away', () => {
    // A made-up newer baseline note: the cycle starts after the row's last top set (Mon 6 Apr).
    const fresh = { ...read, data: { ...read.data, plan: { ...read.data.plan, baselines: [...(read.data.plan.baselines ?? []), '2026-04-08'] } } };
    const row = logFormFor(fresh, buildSession(fresh.data, DATE, 'full'), DATE)!.rows[2]!;
    assert.deepEqual([row.name, row.last, row.top, row.target], ['Seated Cable Row', null, { weight: null, reps: null }, { weight: 115, reps: 11, rir: 2 }]);
    assert.ok(row.rows.every((x) => x.weight === null && x.reps === null));
    assert.equal(row.targetNote, 'Your last top set is from before this cycle: enter what you used, or tap Same as target.');
    // In the cycle (the fixture's baseline of 23 Feb): as before.
    const same = formB().rows[2]!;
    assert.deepEqual([same.last?.date, same.top, same.targetNote], ['2026-04-06', { weight: 115, reps: 11 }, null]);
  });
  it('gives the writer an input it accepts, in the script’s shape', () => {
    const f = formB();
    f.rows[1]!.top = { weight: 25, reps: 10 };
    f.rpe = 7;
    const r = buildLogEntry(inputFromForm(f), ctx);
    assert.ok(r.ok, !r.ok ? r.error : '');
    assert.deepEqual(r.entry['lift1'], { name: 'Single-leg dumbbell RDL', planned: 'Romanian Deadlift', weight: 25, reps: 10, unit: 'lb' });
    assert.deepEqual(r.entry['lift2'], { name: 'Seated Cable Row', weight: 115, reps: 11, unit: 'lb' });
    assert.equal(r.entry['swaps'], undefined);
    assert.deepEqual(r.entry['checklist'], { done: 6, total: 6, skipped: [] });
    assert.equal(r.entry['sessionRpe'], 7);
    assert.equal(r.entry['cardioMin'], 10);
    assert.equal(mergeLog(LOG_TEXT, r.entry, { mode: 'add' }).result, 'added');
  });
  it('writes a swap of another item, a skip with its reason, and the pain flag', () => {
    const f = formB();
    f.rows[3]!.planned = 'Bulgarian Split Squat';
    f.rows[3]!.name = 'Dumbbell split squat';
    f.rows[4]!.done = false;
    f.rows[4]!.why = 'pain';
    f.painOn = true;
    f.pain = { area: 'Lower back', severity: 3, during: 'Side Plank' };
    const r = buildLogEntry(inputFromForm(f), ctx);
    assert.ok(r.ok);
    assert.deepEqual(r.entry['swaps'], [{ from: 'Bulgarian Split Squat', to: 'Dumbbell split squat' }]);
    assert.deepEqual(r.entry['checklist'], { done: 5, total: 6, skipped: ['Side Plank'], why: { 'Side Plank': 'pain' } });
    assert.deepEqual(r.entry['pain'], [{ area: 'Lower back', severity: 3, exercise: 'Side Plank' }]);
  });
  it('takes the heaviest set as the top set at full tracking, and writes every set', () => {
    const f = formB();
    f.tracking = 'full';
    f.rows[2]!.rows = [{ weight: 115, reps: 11, rir: 3 }, { weight: 120, reps: 8, rir: 1 }, { weight: 115, reps: 12, rir: null }];
    assert.deepEqual(topOf(f.rows[2]!, 'full'), { weight: 120, reps: 8, rir: 1 });
    const r = buildLogEntry(inputFromForm(f), ctx);
    assert.ok(r.ok);
    assert.deepEqual(r.entry['lift2'], { name: 'Seated Cable Row', weight: 120, reps: 8, unit: 'lb' });
    assert.equal(r.entry['trackingLevel'], 'full');
    const row = (r.entry['exerciseSets'] as { name: string; sets: unknown[] }[]).find((x) => x.name === 'Seated Cable Row')!;
    assert.deepEqual(row.sets, [{ weight: 115, unit: 'lb', reps: 11, rir: 3 }, { weight: 120, unit: 'lb', reps: 8, rir: 1 }, { weight: 115, unit: 'lb', reps: 12 }]);
  });
  it('uses the Express lines for an Express lifting day, and no Express flag on a short day', () => {
    const a = logFormFor(read, buildSession(read.data, DATE, 'express', { type: 'A' }), DATE)!;
    assert.deepEqual(a.rows.map((r) => r.line), ['Warm-up: band external rotation + dislocates', 'Goblet Squat', 'Flat DB Bench Press', 'Face Pull']);
    assert.equal(inputFromForm(a).express, true);
    const s3 = logFormFor(read, buildSession(read.data, DATE, 'express', { type: 'S3' }), DATE)!;
    assert.equal(s3.rows.find((r) => r.line === 'Circuit: squat jump · burpee')!.sr, '2 rounds, 40/20');
    assert.equal(inputFromForm(s3).express, undefined);
    assert.ok(buildLogEntry(inputFromForm(s3), ctx).ok);
  });
  it('writes a hotel session with its swaps and the hotel flag', () => {
    const h = logFormFor(read, buildSession(read.data, DATE, 'hotel'), DATE)!;
    const r = buildLogEntry(inputFromForm(h), ctx);
    assert.ok(r.ok, !r.ok ? r.error : '');
    assert.equal((r.entry['lift1'] as { planned: string }).planned, 'Romanian Deadlift');
    assert.equal(r.entry['hotel'], true);
    assert.ok((r.entry['swaps'] as { from: string }[]).some((s) => s.from === 'Bulgarian Split Squat'));
  });
  it('starts plan week 1 at the calibration week’s targets: the weight held, the bottom of the range, RIR 3', () => {
    const W1 = '2026-03-05';
    const r1 = readVault(fsIo, VAULT, { asOf: W1 });
    const f = logFormFor(r1, buildSession(r1.data, W1, 'full', { type: 'A' }), W1)!;
    const goblet = f.rows.find((r) => r.line === 'Goblet Squat')!;
    assert.deepEqual([goblet.rir, goblet.target, goblet.top], [CALIBRATION.rir, { weight: 40, reps: 8, rir: CALIBRATION.rir, calibrate: true }, { weight: 40, reps: 8 }]);
    assert.equal(goblet.targetNote, `Calibration week: start at 40 lb and adjust until 8 reps leave ${CALIBRATION.rir} in reserve.`);
    assert.equal(CALIBRATION.rir, 3);
    for (const r of f.rows.filter((x) => x.kind === 'load')) assert.ok(r.rir !== null && r.rir >= CALIBRATION.rir, `${r.name} RIR ${r.rir}`);
  });
  it('writes only the sore muscles that changed', () => {
    const f = formB();
    assert.deepEqual(soreChanges(f), {});
    f.sore = { gluteal: 'sore', hamstring: 'mild' };
    assert.deepEqual(soreChanges(f), { quads: null, hamstrings: 'mild' });
  });
});

describe('an edit, read back from the log', () => {
  const entry = (read.raw!.log as { sessions: Record<string, unknown>[] }).sessions.find((s) => s['date'] === '2026-04-08')!;
  it('reads the lifts, the checklist, the effort and the key', () => {
    const f = logFormFromEntry(read, entry);
    assert.equal(f.edit, true);
    assert.deepEqual(f.rows.filter((r) => r.lift !== null).map((r) => [r.name, r.top]), [['Goblet Squat', { weight: 55, reps: 9 }], ['Flat DB Bench Press', { weight: 60, reps: 5 }]]);
    // Rows from the session's own frozen list; the paired checklist line marks both parts.
    assert.deepEqual(f.rows.map((r) => r.line), ['Goblet Squat', 'Flat DB Bench Press', 'Face Pull', 'Band External Rotation', 'Zone 2 finisher']);
    assert.deepEqual(f.rows.filter((r) => !r.done).map((r) => r.line), ['Face Pull', 'Band External Rotation']);
    assert.deepEqual([f.rpe, f.minutes, f.cardio, f.cardioMode, f.rating], [8, 60, 5, 'bike', 8]);
    assert.equal(f.original!.key, '2026-04-08|A|');
  });
  it('saves a changed rep count in place, keeping the saved exercise list', () => {
    const f = logFormFromEntry(read, entry);
    f.rows.find((r) => r.lift === 1)!.top.reps = 6;
    const r = buildLogEntry(inputFromForm(f), { ...ctx, original: f.original!.entry });
    assert.ok(r.ok);
    assert.equal((r.entry['lift2'] as { reps: number }).reps, 6);
    assert.deepEqual(r.entry['exercises'], entry['exercises']);
    assert.deepEqual(r.entry['checklist'], entry['checklist']); // untouched: kept as the dashboard wrote it
    const m = mergeLog(LOG_TEXT, r.entry, { mode: 'edit', original: f.original! });
    assert.equal(m.result, 'updated');
  });
});

describe('customLogForm: Something else, against fitness_log.py add (golden)', () => {
  const GOLDEN = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'golden', 'log-golden.json'), 'utf8')) as { cases: { name: string; input: Record<string, unknown>; code: number; output: { result?: string; session?: Record<string, unknown> } }[] };
  const SCRIPT = ['date', 'type', 'label', 'express', 'lift1', 'lift2', 'durationMin', 'cardioMin', 'cardioMode', 'rating', 'postureDrill', 'notes', 'swaps'];
  const part = (e: Record<string, unknown>) => Object.fromEntries(Object.entries(e).filter(([k]) => SCRIPT.includes(k)));
  for (const c of GOLDEN.cases.filter((x) => x.input['type'] === 'custom' && x.code === 0)) {
    it(`fills to the script's entry: ${c.name}`, () => {
      const f = customLogForm(read, c.input['date'] as string, c.input['label'] as string);
      f.minutes = (c.input['durationMin'] as number | undefined) ?? null;
      f.cardio = (c.input['cardioMin'] as number | undefined) ?? 0;
      f.cardioMode = (c.input['cardioMode'] as string | undefined) || null;
      f.rating = (c.input['rating'] as number | undefined) ?? null;
      f.posture = c.input['postureDrill'] === true;
      f.notes = (c.input['notes'] as string | undefined) ?? '';
      f.rpe = 6;
      const r = buildLogEntry(inputFromForm(f), ctx);
      assert.ok(r.ok, !r.ok ? r.error : '');
      assert.equal(JSON.stringify(part(r.entry)), JSON.stringify(c.output.session));
      assert.equal(r.entry['sessionRpe'], 6);
      assert.equal(mergeLog(LOG_TEXT, r.entry, { mode: 'add' }).result, c.output.result === 'already' ? 'already' : 'added');
    });
  }
  it('starts with no checklist or lifts, today’s sore muscles, and refuses an empty label like the script', () => {
    const f = customLogForm(read, DATE);
    assert.deepEqual([f.type, f.lifting, f.rows.length, f.typeName], ['custom', false, 0, 'Something else']);
    assert.deepEqual(f.sore, { gluteal: 'sore', quadriceps: 'mild' });
    const r = buildLogEntry(inputFromForm(f), ctx);
    assert.equal(!r.ok && r.error, 'a custom session needs a label');
  });
});

describe('a new log with today’s swaps from Today’s chips', () => {
  it('starts the plan item’s row with the swap, as its own Swap menu would; others stay', async () => {
    const { withSwaps } = await import('../src/report/index.ts');
    const f = formB();
    const g = withSwaps(f, { 'Romanian Deadlift': 'Hamstring Curl' });
    const [, rdl, row] = g.rows;
    assert.deepEqual([rdl!.name, rdl!.planned, rdl!.swapWhy, rdl!.top], ['Hamstring Curl', 'Romanian Deadlift', 'Your swap', { weight: null, reps: null }]);
    assert.equal(rdl!.targetNote, 'New to the log: enter what you used.');
    assert.deepEqual(row, f.rows[2], 'a row without a swap is as it was');
    assert.equal(withSwaps(f, {}), f);
    assert.equal(withSwaps({ ...f, edit: true }, { 'Romanian Deadlift': 'Hamstring Curl' }).rows[1]!.name, f.rows[1]!.name, 'an edit keeps the logged session');
  });
});
