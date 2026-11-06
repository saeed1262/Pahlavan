// The plugin's writer against an in-memory vault adapter, with other writers
// changing the files between the steps of a save.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { sessionKey } from '../../src/adapters/vault/log-write.ts';
import { LogWriter, type WriteAdapter } from '../src/log-writer.ts';
import { useFolders } from '../../src/adapters/vault/layout.ts';
import { FIXTURE_FOLDERS } from '../../test/helpers.ts';

useFolders(FIXTURE_FOLDERS);

const FIX = join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'vault');
const LOG = '3-Personal/Fitness/fitness-log-data.json';
const HABITS = '5-System/Data/habits-data.json';
const BODY = '3-Personal/Fitness/body-data.json';

/** A vault in memory; `hooks` run on the nth read or write of a path, to play another writer. */
function memVault(hooks: { onRead?: (path: string, n: number, files: Map<string, string>) => void; onWrite?: (path: string, n: number, files: Map<string, string>) => void } = {}) {
  const files = new Map<string, string>([LOG, HABITS, BODY].map((p) => [p, readFileSync(join(FIX, p), 'utf8')]));
  const reads = new Map<string, number>();
  const writes: { path: string; data: string }[] = [];
  const adapter: WriteAdapter = {
    async exists(p) {
      return files.has(p);
    },
    async read(p) {
      const n = (reads.get(p) ?? 0) + 1;
      reads.set(p, n);
      const text = files.get(p)!;
      hooks.onRead?.(p, n, files); // another writer, just after this read
      return text;
    },
    async list() {
      return { files: [], folders: [] };
    },
    async write(p, data) {
      writes.push({ path: p, data });
      files.set(p, data);
      hooks.onWrite?.(p, writes.filter((w) => w.path === p).length, files);
    },
  };
  return { adapter, files, writes };
}
const sessions = (files: Map<string, string>) => (JSON.parse(files.get(LOG)!) as { sessions: Record<string, unknown>[] }).sessions;
const entry = { date: '2026-04-09', type: 'B', lift1: { name: 'Romanian Deadlift', weight: 70, reps: 9, unit: 'kg' }, lift2: { name: 'Seated Cable Row', weight: 115, reps: 11, unit: 'lb' }, durationMin: 60, cardioMin: 10, cardioMode: 'bike', rating: null, postureDrill: false, notes: '', sessionRpe: 7 };
const otherWriter = (files: Map<string, string>, s: Record<string, unknown>) => {
  const doc = JSON.parse(files.get(LOG)!);
  doc.sessions.push(s);
  files.set(LOG, JSON.stringify(doc, null, 2));
};

describe('LogWriter.save', () => {
  it('adds the session, ticks the habit and merges the sore muscles, in that order', async () => {
    const v = memVault();
    const before = sessions(v.files).length;
    const r = await new LogWriter(v.adapter).save({ mode: 'add', entry, date: '2026-04-09', sore: { hamstrings: 'mild' } });
    assert.deepEqual(r, { status: 'saved', result: 'added', habit: 'already', habitKey: 'hab-workout-2026-W15-3', sore: 'merged', retried: false });
    assert.equal(sessions(v.files).length, before + 1);
    assert.deepEqual(sessions(v.files).at(-1), entry);
    assert.deepEqual(v.writes.map((w) => w.path), [LOG, BODY]); // the habit was ticked already: no write
    const body = JSON.parse(v.files.get(BODY)!);
    assert.deepEqual(body.days['2026-04-09'].soreMuscles, { hamstrings: 'mild' });
    assert.equal(body.days['2026-04-09'].weight !== undefined, true);
  });
  it('a session saved for Today’s day sets Today’s ticks in the same write', async () => {
    const v = memVault();
    const plan = JSON.parse(readFileSync(join(FIX, '3-Personal/Fitness/plan-data.json'), 'utf8'));
    const withList = { ...entry, checklist: { done: 5, total: 6, skipped: ['Side Plank'] } };
    const r = await new LogWriter(v.adapter).save({ mode: 'add', entry: withList, date: '2026-04-09', ticks: { plan, today: '2026-04-09' } });
    assert.equal(r.status, 'saved');
    assert.deepEqual(v.writes.map((w) => w.path), [LOG]);
    const tc = JSON.parse(v.files.get(LOG)!).todayChecklist;
    assert.deepEqual([tc.date, tc.type, tc.checked.filter(Boolean).length, tc.checked.length], ['2026-04-09', 'B', 5, 6]);
  });
  it('ticks the habit when it is not ticked yet', async () => {
    const v = memVault();
    const r = await new LogWriter(v.adapter).save({ mode: 'add', entry: { ...entry, date: '2026-04-13' }, date: '2026-04-13' });
    assert.equal(r.status === 'saved' && r.habit, 'ticked');
    assert.equal(JSON.parse(v.files.get(HABITS)!).checkins['hab-workout-2026-W16-0'], '1');
  });
  it('says already, and writes nothing, for a session that is logged', async () => {
    const v = memVault();
    const r = await new LogWriter(v.adapter).save({ mode: 'add', entry: { ...entry, date: '2026-04-06' }, date: '2026-04-06' });
    assert.equal(r.status, 'already');
    assert.equal(v.writes.length, 0);
  });
  it('merges again when another writer adds a session between the read and the write, keeping both', async () => {
    const theirs = { date: '2026-04-09', type: 'custom', label: 'Hike', lift1: null, lift2: null };
    const v = memVault({ onRead: (p, n, files) => { if (p === LOG && n === 1) otherWriter(files, theirs); } });
    const r = await new LogWriter(v.adapter).save({ mode: 'add', entry, date: '2026-04-09' });
    assert.equal(r.status, 'saved');
    assert.equal(r.status === 'saved' && r.retried, true);
    const list = sessions(v.files);
    assert.ok(list.some((s) => sessionKey(s) === '2026-04-09|custom|Hike'));
    assert.ok(list.some((s) => JSON.stringify(s) === JSON.stringify(entry)));
    assert.equal(v.writes.filter((w) => w.path === LOG).length, 1);
  });
  it('writes again when another writer overwrote the save, and keeps theirs too', async () => {
    const theirs = { date: '2026-04-09', type: 'S1', lift1: null, lift2: null };
    const v = memVault({
      onWrite: (p, n, files) => {
        if (p !== LOG || n !== 1) return;
        // The other writer read before the save and writes its own version after it.
        const doc = JSON.parse(readFileSync(join(FIX, LOG), 'utf8'));
        doc.sessions.push(theirs);
        files.set(LOG, JSON.stringify(doc, null, 2));
      },
    });
    const r = await new LogWriter(v.adapter).save({ mode: 'add', entry, date: '2026-04-09' });
    assert.deepEqual(r.status === 'saved' && [r.result, r.retried], ['added', true]);
    const list = sessions(v.files);
    assert.ok(list.some((s) => sessionKey(s) === '2026-04-09|S1|'));
    assert.ok(list.some((s) => JSON.stringify(s) === JSON.stringify(entry)));
  });
  it('is a conflict when the session being edited changed elsewhere, and keeps mine only when forced', async () => {
    const v = memVault();
    const orig = sessions(v.files).find((s) => s['date'] === '2026-04-08')!;
    const original = { key: sessionKey(orig), json: JSON.stringify(orig) };
    const doc = JSON.parse(v.files.get(LOG)!);
    doc.sessions.find((s: Record<string, unknown>) => s['date'] === '2026-04-08').notes = 'from the dashboard';
    v.files.set(LOG, JSON.stringify(doc, null, 2));
    const mine = { ...orig, notes: 'from Pahlavan' };
    const w = new LogWriter(v.adapter);
    const r = await w.save({ mode: 'edit', entry: mine, original, date: '2026-04-08' });
    assert.equal(r.status, 'conflict');
    assert.equal(r.status === 'conflict' && (r.disk as { notes: string }).notes, 'from the dashboard');
    assert.equal(v.writes.length, 0);
    const f = await w.save({ mode: 'edit', entry: mine, original, force: true, date: '2026-04-08' });
    assert.deepEqual(f.status === 'saved' && f.result, 'updated');
    assert.equal(sessions(v.files).find((s) => s['date'] === '2026-04-08')!['notes'], 'from Pahlavan');
  });
  it('deletes without unticking the habit', async () => {
    const v = memVault();
    const orig = sessions(v.files).find((s) => s['date'] === '2026-04-08')!;
    const r = await new LogWriter(v.adapter).save({ mode: 'delete', entry: null, original: { key: sessionKey(orig), json: JSON.stringify(orig) }, date: '2026-04-08' });
    assert.deepEqual(r.status === 'saved' && [r.result, r.habit], ['deleted', 'skipped']);
    assert.ok(!sessions(v.files).some((s) => s['date'] === '2026-04-08'));
    assert.deepEqual(v.writes.map((w) => w.path), [LOG]);
  });
  it('fails calmly when the log does not parse, writing nothing', async () => {
    const v = memVault();
    v.files.set(LOG, '{ broken');
    const r = await new LogWriter(v.adapter).save({ mode: 'add', entry, date: '2026-04-09' });
    assert.equal(r.status, 'failed');
    assert.equal(v.writes.length, 0);
  });
  it('gives up after two rounds when the file keeps changing', async () => {
    let k = 0;
    const v = memVault({ onRead: (p, n, files) => { if (p === LOG && n % 2 === 1) otherWriter(files, { date: `2026-04-0${++k}`, type: 'custom', label: `x${k}` }); } });
    const r = await new LogWriter(v.adapter).save({ mode: 'add', entry, date: '2026-04-09' });
    assert.equal(r.status, 'failed');
    assert.equal(v.writes.length, 0);
  });
  it('reads the log and the habit for the summary', async () => {
    const v = memVault();
    const w = new LogWriter(v.adapter);
    assert.equal((await w.readLog())!['sessions'] instanceof Array, true);
    assert.equal(await w.habitTicked('2026-04-10'), true);
    assert.equal(await w.habitTicked('2026-04-13'), false);
  });
});
