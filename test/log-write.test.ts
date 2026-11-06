// The log writer: the session entry against fitness_log.py add's own output
// (golden cases taken from the script on a copy of the fixture vault, see
// tools/golden-log.mjs), the dashboard's checklist and exercise list, the
// merge against the file on disk, the Workout habit key and the sore-muscle
// merge.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { buildLogEntry, checklistLines, habitKey, isDeloadDate, mergeHabit, mergeLadder, mergeLog, mergeSoreMuscles, SCRIPT_KEYS, sessionKey, ticksAfterSave, type LogInput } from '../src/adapters/vault/log-write.ts';
import { ROOT } from './helpers.ts';

const FIT = join(ROOT, 'test', 'fixtures', 'vault', '3-Personal', 'Fitness');
const PLAN = JSON.parse(readFileSync(join(FIT, 'plan-data.json'), 'utf8'));
const LOG_TEXT = readFileSync(join(FIT, 'fitness-log-data.json'), 'utf8');
const LOG = JSON.parse(LOG_TEXT);
const GOLDEN = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'golden', 'log-golden.json'), 'utf8')) as {
  cases: { name: string; input: LogInput; code: number; output: { result?: string; session?: object; error?: string } }[];
  ladderCases: { name: string; args: [string, string]; date: string; prep: { dropLadders?: boolean }; code: number; output: { result?: string; ladder?: string; level?: number; name?: string; error?: string }; written: boolean; ladders: Record<string, { level: number; date: string }[]> | null }[];
};
const CTX = { plan: PLAN, log: LOG, today: '2026-11-01' };
const scriptPart = (e: Record<string, unknown>) => Object.fromEntries(Object.entries(e).filter(([k]) => (SCRIPT_KEYS as readonly string[]).includes(k)));

describe('buildLogEntry against fitness_log.py add (golden)', () => {
  it('has the golden cases', () => assert.ok(GOLDEN.cases.length >= 20));
  for (const c of GOLDEN.cases) {
    it(c.name, () => {
      const r = buildLogEntry(c.input, CTX);
      if (c.code !== 0) {
        assert.equal(r.ok, false);
        assert.equal(!r.ok && r.error, c.output.error);
        return;
      }
      assert.ok(r.ok, !r.ok ? r.error : '');
      // The same keys, in the same order, with the same values.
      assert.equal(JSON.stringify(scriptPart(r.entry)), JSON.stringify(c.output.session));
      if (c.output.result === 'already') assert.equal(mergeLog(LOG_TEXT, r.entry, { mode: 'add' }).result, 'already');
      else assert.equal(mergeLog(LOG_TEXT, r.entry, { mode: 'add' }).result, 'added');
    });
  }
});

describe('buildLogEntry: the dashboard’s fields and Pahlavan’s', () => {
  const b: LogInput = { date: '2026-04-09', type: 'B', lift1: { name: 'Romanian Deadlift', weight: 70, reps: 9 }, lift2: { name: 'Seated Cable Row', weight: 115, reps: 11 } };
  it('freezes the plan’s exercise list, as the dashboard does', () => {
    const r = buildLogEntry(b, CTX);
    assert.ok(r.ok);
    // The fixture's own B session of 6 Apr carries the dashboard's list for the same plan.
    assert.deepEqual(r.entry['exercises'], LOG.sessions.find((s: { date: string }) => s.date === '2026-04-06').exercises);
  });
  it('takes the ladder level on the day for a ladder line, and the Express list for Express', () => {
    const s1 = buildLogEntry({ date: '2026-04-09', type: 'S1' }, CTX);
    assert.ok(s1.ok);
    assert.deepEqual((s1.entry['exercises'] as { name: string }[]).map((x) => x.name), ['Chest-to-wall handstand', 'Floor push-up', 'Dead Bug']);
    const ex = buildLogEntry({ ...b, type: 'A', express: true, lift1: { name: 'Goblet Squat', weight: 55, reps: 10 }, lift2: { name: 'Flat DB Bench Press', weight: 60, reps: 6 } }, CTX);
    assert.ok(ex.ok);
    assert.deepEqual(ex.entry['exercises'], [{ name: 'Warm-up: band external rotation + dislocates', sets: 2 }, { name: 'Goblet Squat', sets: 2 }, { name: 'Flat DB Bench Press', sets: 2 }, { name: 'Face Pull', sets: 2 }]);
  });
  it('halves to 2 sets in a deload week (every 4th from the first plan session)', () => {
    assert.equal(isDeloadDate(PLAN, LOG, '2026-03-25'), true);
    assert.equal(isDeloadDate(PLAN, LOG, '2026-04-09'), false);
    const r = buildLogEntry({ ...b, date: '2026-03-25' }, CTX);
    assert.ok(r.ok);
    assert.deepEqual((r.entry['exercises'] as { sets: number }[]).map((x) => x.sets), [2, 2, 2, 2, 3]);
    const s3 = buildLogEntry({ date: '2026-03-25', type: 'S3' }, CTX);
    assert.ok(s3.ok);
    assert.deepEqual(s3.entry['exercises'], [{ name: 'Easy Zone 2 (bike or walk)', sets: 10 }]);
  });
  it('writes the checklist from the lines, with the skip reasons', () => {
    const lines = checklistLines(PLAN, 'A', false, false).map((l) => ({ name: l.name, done: l.name !== 'Face Pull + Band External Rotation', why: l.name === 'Face Pull + Band External Rotation' ? 'time' : null }));
    const r = buildLogEntry({ ...b, type: 'A', lift1: { name: 'Goblet Squat', weight: 55, reps: 10 }, lift2: { name: 'Flat DB Bench Press', weight: 60, reps: 6 }, lines }, CTX);
    assert.ok(r.ok);
    assert.deepEqual(r.entry['checklist'], { done: 4, total: 5, skipped: ['Face Pull + Band External Rotation'], why: { 'Face Pull + Band External Rotation': 'time' } });
  });
  it('adds the new fields after the dashboard’s, leaving the script’s part as it was', () => {
    const plain = buildLogEntry(b, CTX);
    const r = buildLogEntry({ ...b, sessionRpe: 7, pain: [{ area: 'Lower back', severity: 3, exercise: 'Side Plank' }], hotel: true, trackingLevel: 'full', exerciseSets: [{ name: 'Seated Cable Row', sets: [{ weight: 115, unit: 'lb', reps: 11, rir: 2 }, { weight: 115, unit: 'lb', reps: 10, rir: null }] }] }, CTX);
    assert.ok(r.ok && plain.ok);
    assert.equal(JSON.stringify(scriptPart(r.entry)), JSON.stringify(scriptPart(plain.entry)));
    assert.deepEqual(Object.keys(r.entry).slice(-5), ['sessionRpe', 'pain', 'hotel', 'trackingLevel', 'exerciseSets']);
    assert.deepEqual(r.entry['exerciseSets'], [{ name: 'Seated Cable Row', sets: [{ weight: 115, unit: 'lb', reps: 11, rir: 2 }, { weight: 115, unit: 'lb', reps: 10 }] }]);
  });
  it('on an edit, keeps the fields it does not own and the saved list when nothing it depends on changed', () => {
    const original = { ...LOG.sessions.find((s: { date: string }) => s.date === '2026-04-08'), coachNote: 'kept', exercises: [{ name: 'An older list', sets: 1 }] };
    const r = buildLogEntry({ date: '2026-04-08', type: 'A', lift1: { name: 'Goblet Squat', weight: 55, reps: 9 }, lift2: { name: 'Flat DB Bench Press', weight: 60, reps: 6 } }, { ...CTX, original });
    assert.ok(r.ok);
    assert.equal(r.entry['coachNote'], 'kept');
    assert.deepEqual(r.entry['exercises'], [{ name: 'An older list', sets: 1 }]);
    assert.deepEqual(r.entry['checklist'], original.checklist); // no lines from the form: the checklist as it was
    const moved = buildLogEntry({ date: '2026-04-09', type: 'A', lift1: { name: 'Goblet Squat', weight: 55, reps: 9 }, lift2: { name: 'Flat DB Bench Press', weight: 60, reps: 6 } }, { ...CTX, original });
    assert.ok(moved.ok);
    assert.notEqual(JSON.stringify(moved.entry['exercises']), JSON.stringify([{ name: 'An older list', sets: 1 }]));
  });
});

describe('checklistLines (the dashboard’s exercisesFor)', () => {
  it('opens with the warm-up and joins a paired item to the one before', () => {
    assert.deepEqual(checklistLines(PLAN, 'A', false, false).map((l) => [l.name, l.parts]), [
      ['Warm-up', []], ['Goblet Squat', ['Goblet Squat']], ['Flat DB Bench Press', ['Flat DB Bench Press']], ['Face Pull + Band External Rotation', ['Face Pull', 'Band External Rotation']], ['Zone 2 finisher', ['Zone 2 finisher']],
    ]);
    assert.equal(checklistLines(PLAN, 'S1', false, false)[0]!.sr, '3 min');
  });
  it('is its own four lines for Express, and the deload block for S3 in a deload week', () => {
    assert.deepEqual(checklistLines(PLAN, 'B', true, false).map((l) => l.name), ['Warm-up: band external rotation + dislocates', 'Romanian Deadlift', 'Seated Cable Row', 'Face Pull']);
    assert.deepEqual(checklistLines(PLAN, 'S3', false, true).map((l) => l.name), ['Easy Zone 2 (bike or walk)']);
    assert.deepEqual(checklistLines(PLAN, 'B', false, true).map((l) => l.sr).slice(1, 3), ['2 × 8–10', '2 × 10–12']);
  });
});

describe('mergeLog', () => {
  const entry = { date: '2026-04-09', type: 'B', lift1: null };
  it('adds a new session and keeps every other key, in order', () => {
    const r = mergeLog(LOG_TEXT, entry, { mode: 'add' });
    assert.equal(r.result, 'added');
    const doc = JSON.parse((r as { text: string }).text);
    assert.deepEqual(Object.keys(doc), Object.keys(LOG));
    assert.deepEqual(doc.todayChecklist, LOG.todayChecklist);
    assert.deepEqual(doc.ladders, LOG.ladders);
    assert.equal(doc.sessions.length, LOG.sessions.length + 1);
    assert.deepEqual(doc.sessions.slice(0, -1), LOG.sessions);
  });
  it('starts a log when there is none, and refuses a file it cannot read', () => {
    const r = mergeLog(null, entry, { mode: 'add' });
    assert.deepEqual(JSON.parse((r as { text: string }).text), { sessions: [entry] });
    assert.equal(mergeLog('{not json', entry, { mode: 'add' }).result, 'unreadable');
    assert.equal(mergeLog('{"sessions": {}}', entry, { mode: 'add' }).result, 'unreadable');
  });
  it('says already for a date, type and label that is logged', () => {
    const r = mergeLog(LOG_TEXT, { date: '2026-04-10', type: 'custom', label: 'Easy run' }, { mode: 'add' });
    assert.equal(r.result, 'already');
    assert.equal(mergeLog(LOG_TEXT, { date: '2026-04-10', type: 'custom', label: 'Hike' }, { mode: 'add' }).result, 'added');
  });
  const orig = LOG.sessions.find((s: { date: string }) => s.date === '2026-04-08');
  const original = { key: sessionKey(orig), json: JSON.stringify(orig) };
  it('updates the session in place when it is as the form read it', () => {
    const r = mergeLog(LOG_TEXT, { ...orig, notes: 'edited' }, { mode: 'edit', original });
    assert.equal(r.result, 'updated');
    const doc = JSON.parse((r as { text: string }).text);
    const i = LOG.sessions.findIndex((s: { date: string }) => s.date === '2026-04-08');
    assert.equal(doc.sessions[i].notes, 'edited');
    assert.equal(doc.sessions.length, LOG.sessions.length);
  });
  it('is a conflict when the session changed or went since the form opened, unless forced', () => {
    const changed = JSON.parse(LOG_TEXT);
    changed.sessions.find((s: { date: string }) => s.date === '2026-04-08').notes = 'changed elsewhere';
    const r = mergeLog(JSON.stringify(changed), { ...orig, notes: 'mine' }, { mode: 'edit', original });
    assert.equal(r.result, 'conflict');
    assert.equal((r as unknown as { disk: { notes: string } }).disk.notes, 'changed elsewhere');
    assert.equal(mergeLog(JSON.stringify(changed), { ...orig, notes: 'mine' }, { mode: 'edit', original, force: true }).result, 'updated');
    const gone = JSON.parse(LOG_TEXT);
    gone.sessions = gone.sessions.filter((s: { date: string }) => s.date !== '2026-04-08');
    const g = mergeLog(JSON.stringify(gone), orig, { mode: 'edit', original });
    assert.deepEqual([g.result, (g as { disk: unknown }).disk], ['conflict', null]);
  });
  it('says already when an edit moves onto another logged session, and deletes', () => {
    assert.equal(mergeLog(LOG_TEXT, { ...orig, date: '2026-04-06', type: 'B' }, { mode: 'edit', original }).result, 'already');
    const d = mergeLog(LOG_TEXT, null, { mode: 'delete', original });
    assert.equal(d.result, 'deleted');
    assert.equal(JSON.parse((d as { text: string }).text).sessions.length, LOG.sessions.length - 1);
  });
});

describe('Today’s ticks after a save', () => {
  const day = '2026-04-09';
  const a = { date: day, type: 'A', checklist: { done: 4, total: 5, skipped: ['Face Pull + Band External Rotation'] } };
  const ticks = { plan: PLAN, today: day };
  const ticksIn = (r: ReturnType<typeof mergeLog>) => JSON.parse((r as { text: string }).text).todayChecklist;
  it('a session saved for Today’s day ticks its lines, all but the skipped ones', () => {
    assert.deepEqual(ticksIn(mergeLog(LOG_TEXT, a, { mode: 'add', ticks })), { date: day, type: 'A', express: false, checked: [true, true, true, false, true], picked: false });
    const ex = ticksAfterSave(LOG, { date: day, type: 'B', express: true, checklist: { done: 4, total: 4, skipped: [] } }, PLAN, day);
    assert.deepEqual(ex, { date: day, type: 'B', express: true, checked: [true, true, true, true], picked: false });
  });
  it('an edit sets them again, and a pick made on Today that day is kept', () => {
    const disk = JSON.parse(LOG_TEXT);
    disk.todayChecklist = { date: day, type: 'B', express: false, checked: [false, false, false, false, false, false], picked: true };
    disk.sessions.push(a);
    const all = { ...a, checklist: { done: 5, total: 5, skipped: [] } };
    const r = mergeLog(JSON.stringify(disk), all, { mode: 'edit', original: { key: sessionKey(a), json: JSON.stringify(a) }, ticks });
    assert.deepEqual(ticksIn(r), { date: day, type: 'A', express: false, checked: [true, true, true, true, true], picked: true });
  });
  it('leaves the record as it is for another day, a custom session, lines that no longer match, or no ticks asked', () => {
    assert.deepEqual(ticksIn(mergeLog(LOG_TEXT, a, { mode: 'add', ticks: { plan: PLAN, today: '2026-04-12' } })), LOG.todayChecklist);
    assert.deepEqual(ticksIn(mergeLog(LOG_TEXT, { date: day, type: 'custom', label: 'Hike' }, { mode: 'add', ticks })), LOG.todayChecklist);
    assert.deepEqual(ticksIn(mergeLog(LOG_TEXT, { ...a, checklist: { done: 6, total: 6, skipped: [] } }, { mode: 'add', ticks })), LOG.todayChecklist);
    assert.deepEqual(ticksIn(mergeLog(LOG_TEXT, a, { mode: 'add' })), LOG.todayChecklist);
  });
});

describe('the Workout habit', () => {
  it('uses the ISO week and Monday as day 0', () => {
    assert.equal(habitKey('2026-04-10'), 'hab-workout-2026-W15-4');
    assert.equal(habitKey('2026-01-01'), 'hab-workout-2026-W1-3');
    assert.equal(habitKey('2027-01-01'), 'hab-workout-2026-W53-4');
    assert.equal(habitKey('2024-12-30'), 'hab-workout-2025-W1-0');
    assert.equal(habitKey('2026-04-12'), 'hab-workout-2026-W15-6');
  });
  it('ticks add-only, starts a vault’s first file with Workout and Protein, and leaves an unreadable one alone', () => {
    const text = JSON.stringify({ habits: [{ id: 'workout' }], checkins: { 'hab-workout-2026-W15-4': '1' } });
    assert.equal(mergeHabit(text, '2026-04-10').result, 'already');
    const r = mergeHabit(text, '2026-04-11');
    assert.equal(r.result, 'ticked');
    const doc = JSON.parse((r as { text: string }).text);
    assert.deepEqual(doc.habits, [{ id: 'workout' }]);
    assert.deepEqual(doc.checkins, { 'hab-workout-2026-W15-4': '1', 'hab-workout-2026-W15-5': '1' });
    const first = mergeHabit(null, '2026-04-11');
    assert.equal(first.result, 'ticked');
    const fresh = JSON.parse((first as { text: string }).text);
    assert.deepEqual([fresh.habits.map((x: { id: string }) => x.id), fresh.checkins], [['workout', 'protein'], { 'hab-workout-2026-W15-5': '1' }]);
    assert.equal(mergeHabit('nope', '2026-04-11').result, 'unreadable');
  });
});

describe('sore muscles', () => {
  const body = { _about: 'x', days: { '2026-04-10': { weight: 83.8, soreMuscles: { glutes: 'sore', quadriceps: 'mild' } }, '2026-04-09': { weight: 84 } }, tape: [] };
  const text = JSON.stringify(body);
  it('changes only the muscles named, under the engine’s ids', () => {
    const r = mergeSoreMuscles(text, '2026-04-10', { hamstring: 'mild', quads: null });
    assert.equal(r.result, 'merged');
    const doc = JSON.parse((r as { text: string }).text);
    assert.deepEqual(doc.days['2026-04-10'], { weight: 83.8, soreMuscles: { glutes: 'sore', hamstrings: 'mild' } });
    assert.deepEqual(doc.days['2026-04-09'], { weight: 84 });
    assert.deepEqual(Object.keys(doc), Object.keys(body));
  });
  it('replaces a slug entry with the id, starts a day, clears to nothing, and says unchanged', () => {
    const a = JSON.parse((mergeSoreMuscles(text, '2026-04-10', { gluteal: 'mild' }) as { text: string }).text);
    assert.deepEqual(a.days['2026-04-10'].soreMuscles, { quadriceps: 'mild', glutes: 'mild' });
    const b = JSON.parse((mergeSoreMuscles(text, '2026-04-11', { chest: 'sore' }) as { text: string }).text);
    assert.deepEqual(b.days['2026-04-11'], { soreMuscles: { chest: 'sore' } });
    const c = JSON.parse((mergeSoreMuscles(text, '2026-04-10', { glutes: null, quads: null }) as { text: string }).text);
    assert.deepEqual(c.days['2026-04-10'], { weight: 83.8 });
    assert.equal(mergeSoreMuscles(text, '2026-04-10', { glutes: 'sore' }).result, 'unchanged');
    assert.equal(mergeSoreMuscles(null, '2026-04-10', { glutes: 'sore' }).result, 'unreadable');
  });
});

describe('mergeLadder against fitness_log.py ladder (golden)', () => {
  it('has the golden cases', () => assert.ok(GOLDEN.ladderCases.length >= 8));
  for (const c of GOLDEN.ladderCases) {
    it(c.name, () => {
      let text = LOG_TEXT;
      if (c.prep.dropLadders) {
        const log = JSON.parse(LOG_TEXT);
        delete log.ladders;
        text = JSON.stringify(log, null, 2);
      }
      const r = mergeLadder(text, PLAN, c.args[0], Number(c.args[1]), c.date);
      if (c.code !== 0) {
        assert.equal(r.result, 'invalid');
        assert.equal(r.result === 'invalid' && r.error, c.output.error);
        return;
      }
      assert.equal(r.result, c.output.result);
      if (r.result !== 'set' && r.result !== 'already') return;
      assert.deepEqual([r.ladder, r.level, r.name], [c.output.ladder, c.output.level, c.output.name]);
      assert.equal(r.result === 'set', c.written);
      if (r.result === 'set') {
        const out = JSON.parse(r.text);
        assert.deepEqual(out.ladders, c.ladders);
        // Everything else in the log is as it was.
        const rest = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'ladders'));
        assert.deepEqual(rest(out), rest(JSON.parse(text)));
      }
    });
  }
  it('leaves an unreadable log alone and starts a missing one', () => {
    assert.equal(mergeLadder('{nope', PLAN, 'pushup', 3, '2026-04-10').result, 'unreadable');
    const r = mergeLadder(null, PLAN, 'pushup', 3, '2026-04-10');
    assert.equal(r.result, 'set');
    assert.deepEqual(r.result === 'set' && JSON.parse(r.text), { sessions: [], ladders: { pushup: [{ level: 3, date: '2026-04-10' }] } });
  });
});
