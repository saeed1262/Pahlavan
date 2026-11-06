// The Check-in writer and the ladder writer against an in-memory vault
// adapter, with another writer (Habit Nudges, the coach) changing the files
// between the steps of a save.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { morningFrom } from '../../src/adapters/vault/body-write.ts';
import { readVault } from '../../src/adapters/vault/read.ts';
import { answersFromRecord, buildTemplate, recordFromAnswers } from '../../src/report/index.ts';
import { CheckinWriter, type MkdirAdapter } from '../src/checkin-writer.ts';
import { LogWriter } from '../src/log-writer.ts';
import { useFolders } from '../../src/adapters/vault/layout.ts';
import { FIXTURE_FOLDERS } from '../../test/helpers.ts';

useFolders(FIXTURE_FOLDERS);

const FIX = join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'vault');
const BODY = '3-Personal/Fitness/body-data.json';
const LOG = '3-Personal/Fitness/fitness-log-data.json';
const CHECKINS = '3-Personal/Fitness/Coach/checkins.json';
const COACH = '3-Personal/Fitness/Coach';
const DATE = '2026-04-10';

function memVault(hooks: { onRead?: (path: string, n: number, files: Map<string, string>) => void; onWrite?: (path: string, n: number, files: Map<string, string>) => void } = {}, withCoach = false) {
  const files = new Map<string, string>([BODY, LOG].map((p) => [p, readFileSync(join(FIX, p), 'utf8')]));
  const folders = new Set<string>(['3-Personal', '3-Personal/Fitness', ...(withCoach ? [COACH] : [])]);
  const reads = new Map<string, number>();
  const writes: { path: string; data: string }[] = [];
  const made: string[] = [];
  const adapter: MkdirAdapter = {
    async exists(p) {
      return files.has(p) || folders.has(p);
    },
    async read(p) {
      const n = (reads.get(p) ?? 0) + 1;
      reads.set(p, n);
      const text = files.get(p)!;
      hooks.onRead?.(p, n, files);
      return text;
    },
    async list() {
      return { files: [], folders: [] };
    },
    async write(p, data) {
      const dir = p.slice(0, p.lastIndexOf('/'));
      if (!folders.has(dir)) throw new Error(`ENOENT: no folder ${dir}`);
      writes.push({ path: p, data });
      files.set(p, data);
      hooks.onWrite?.(p, writes.filter((w) => w.path === p).length, files);
    },
    async mkdir(p) {
      made.push(p);
      folders.add(p);
    },
  };
  return { adapter, files, writes, made };
}
const day = (files: Map<string, string>, d = DATE) => JSON.parse(files.get(BODY)!).days[d];
const baseline = morningFrom(JSON.parse(readFileSync(join(FIX, BODY), 'utf8')), DATE).values;

describe('CheckinWriter.saveMorning', () => {
  it('writes only the changed fields, and the sore muscles, keeping Habit Nudges’ checkedAt and floors', async () => {
    const v = memVault();
    const before = day(v.files);
    const r = await new CheckinWriter(v.adapter).saveMorning(DATE, { values: { energy: 4, sleepQ: 3 }, baseline, sore: { hamstring: 'mild' } });
    assert.deepEqual(r, { status: 'saved', changed: ['energy', 'sleepQ'], sore: true, retried: false });
    assert.deepEqual(day(v.files), { ...before, energy: 4, sleepQ: 3, soreMuscles: { ...before.soreMuscles, hamstrings: 'mild' } });
    assert.deepEqual(v.writes.map((w) => w.path), [BODY]);
  });

  it('merges again when Habit Nudges writes between the merge and the write, and keeps its values', async () => {
    const v = memVault({
      onRead: (p, n, files) => {
        if (p !== BODY || n !== 1) return;
        const doc = JSON.parse(files.get(BODY)!);
        doc.days[DATE] = { ...doc.days[DATE], sleepH: 6.4, checkedAt: '2026-04-10T07:45:00.000Z' };
        files.set(BODY, JSON.stringify(doc, null, 2));
      },
    });
    const r = await new CheckinWriter(v.adapter).saveMorning(DATE, { values: { energy: 4 }, baseline });
    assert.equal(r.status === 'saved' && r.retried, true);
    assert.deepEqual([day(v.files).energy, day(v.files).sleepH, day(v.files).checkedAt], [4, 6.4, '2026-04-10T07:45:00.000Z']);
  });

  it('stops at a field Habit Nudges changed too, and writes it only when told to', async () => {
    const v = memVault();
    const doc = JSON.parse(v.files.get(BODY)!);
    doc.days[DATE].weight = 83.6;
    v.files.set(BODY, JSON.stringify(doc, null, 2));
    const w = new CheckinWriter(v.adapter);
    const r = await w.saveMorning(DATE, { values: { weight: 83.2 }, baseline });
    assert.deepEqual(r, { status: 'conflict', conflicts: [{ key: 'weight', disk: 83.6, baseline: 83.8, mine: 83.2 }] });
    assert.equal(v.writes.length, 0);
    const f = await w.saveMorning(DATE, { values: { weight: 83.2 }, baseline, force: true });
    assert.equal(f.status, 'saved');
    assert.equal(day(v.files).weight, 83.2);
  });

  it('writes the steps on yesterday, and says so when nothing changed', async () => {
    const v = memVault();
    const w = new CheckinWriter(v.adapter);
    assert.deepEqual(await w.saveMorning(DATE, { values: { energy: 2 }, baseline }), { status: 'unchanged' });
    await w.saveMorning(DATE, { values: { steps: 11000 }, baseline });
    assert.equal(day(v.files, '2026-04-09').steps, 11000);
    assert.equal(day(v.files).steps, 9917);
  });

  it('writes again once when the write did not land (another writer put an old copy back)', async () => {
    const original = readFileSync(join(FIX, BODY), 'utf8');
    const v = memVault({ onWrite: (p, n, files) => n === 1 && files.set(p, original) });
    const r = await new CheckinWriter(v.adapter).saveMorning(DATE, { values: { energy: 5 }, baseline });
    assert.equal(r.status === 'saved' && r.retried, true);
    assert.equal(day(v.files).energy, 5);
    assert.equal(v.writes.length, 2);
  });

  it('refuses an out-of-range value and an unreadable file, writing nothing', async () => {
    const v = memVault();
    const w = new CheckinWriter(v.adapter);
    assert.equal((await w.saveMorning(DATE, { values: { rhr: 300 }, baseline })).status, 'failed');
    v.files.set(BODY, '{ broken');
    assert.equal((await w.saveMorning(DATE, { values: { energy: 3 }, baseline })).status, 'failed');
    assert.equal(v.writes.length, 0);
  });
});

describe('CheckinWriter.saveSunday', () => {
  const SUN = '2026-04-12';
  const io = { readText: (p: string) => (existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null), listDir: (p: string) => (existsSync(p) && statSync(p).isDirectory() ? readdirSync(p) : null) };
  const read = readVault(io, FIX, { asOf: SUN });
  const t = buildTemplate(read.data, SUN, null);
  const record = () => recordFromAnswers(t, { ...answersFromRecord(t), effort: 7, stress: 2, recovery: 4, enjoyment: 5 });

  it('makes the Coach folder, writes checkins.json through checkin add and reads it back', async () => {
    const v = memVault();
    const r = await new CheckinWriter(v.adapter).saveSunday(record(), SUN, read.data);
    assert.equal(r.status, 'saved');
    assert.equal(r.status === 'saved' && r.action, 'added');
    assert.deepEqual(v.made, [COACH]);
    const doc = JSON.parse(v.files.get(CHECKINS)!);
    assert.equal(doc.schemaVersion, 1);
    assert.deepEqual([doc.checkins[0].date, doc.checkins[0].effort, doc.checkins[0].enjoyment], [SUN, 7, 5]);
    assert.ok(v.files.get(CHECKINS)!.endsWith('}\n'));
  });

  it('keeps a record the coach added in between, and updates its own by date', async () => {
    const coach = { schemaVersion: 1, checkins: [{ date: '2026-04-05', weekStart: '2026-03-30', effort: 5 }] };
    const v = memVault({ onRead: (p, n, files) => p === CHECKINS && n === 1 && files.set(CHECKINS, JSON.stringify(coach, null, 2)) }, true);
    v.files.set(CHECKINS, JSON.stringify({ schemaVersion: 1, checkins: [] }));
    const w = new CheckinWriter(v.adapter);
    const r = await w.saveSunday(record(), SUN, read.data);
    assert.equal(r.status === 'saved' && r.retried, true);
    assert.deepEqual(JSON.parse(v.files.get(CHECKINS)!).checkins.map((c: { date: string }) => c.date), ['2026-04-05', SUN]);
    const again = await w.saveSunday({ ...record(), effort: 9 }, SUN, read.data);
    assert.equal(again.status === 'saved' && again.action, 'updated');
    assert.equal(JSON.parse(v.files.get(CHECKINS)!).checkins[1].effort, 9);
    assert.equal((await w.saveSunday({ ...record(), effort: 9 }, SUN, read.data)).status === 'saved', true);
  });

  it('refuses an invalid record or a broken file, writing nothing', async () => {
    const v = memVault({}, true);
    const w = new CheckinWriter(v.adapter);
    assert.equal((await w.saveSunday({ ...record(), effort: 11 }, SUN, read.data)).status, 'failed');
    assert.equal((await w.saveSunday({ ...record(), date: '2026-04-19', weekStart: '2026-04-13' }, SUN, read.data)).status, 'failed');
    v.files.set(CHECKINS, '{ nope');
    assert.equal((await w.saveSunday(record(), SUN, read.data)).status, 'failed');
    assert.equal(v.writes.length, 0);
  });
});

describe('LogWriter.saveLadder', () => {
  const plan = JSON.parse(readFileSync(join(FIX, '3-Personal/Fitness/plan-data.json'), 'utf8'));
  it('appends the level as fitness_log.py ladder does, and says already for the same level', async () => {
    const v = memVault();
    const w = new LogWriter(v.adapter);
    assert.deepEqual(await w.saveLadder({ id: 'pushup', level: 3, date: DATE, plan }), { status: 'set', name: 'Tempo push-up' });
    assert.deepEqual(JSON.parse(v.files.get(LOG)!).ladders.pushup.at(-1), { level: 3, date: DATE });
    assert.deepEqual(await w.saveLadder({ id: 'pushup', level: 3, date: DATE, plan }), { status: 'already', name: 'Tempo push-up' });
    assert.equal(v.writes.length, 1);
  });
  it('keeps a session another writer logged in between', async () => {
    const v = memVault({
      onRead: (p, n, files) => {
        if (p !== LOG || n !== 1) return;
        const doc = JSON.parse(files.get(LOG)!);
        doc.sessions.push({ date: DATE, type: 'custom', label: 'Walk' });
        files.set(LOG, JSON.stringify(doc, null, 2));
      },
    });
    assert.equal((await new LogWriter(v.adapter).saveLadder({ id: 'handstand', level: 2, date: DATE, plan })).status, 'set');
    const doc = JSON.parse(v.files.get(LOG)!);
    assert.equal(doc.sessions.at(-1).label, 'Walk');
    assert.deepEqual(doc.ladders.handstand.at(-1), { level: 2, date: DATE });
  });
  it('refuses a level the ladder does not have', async () => {
    const v = memVault();
    assert.deepEqual(await new LogWriter(v.adapter).saveLadder({ id: 'pushup', level: 9, date: DATE, plan }), { status: 'failed', error: 'Push-up has levels 1-3' });
  });
});

describe('LogWriter.saveChecklist (todayChecklist, shared with the dashboard)', () => {
  it('writes today’s record and keeps a tick the dashboard made in between', async () => {
    const tick = (i: number) => (log: Record<string, unknown>) => {
      const tc = (log['todayChecklist'] as { date?: string; type?: string; checked?: boolean[] } | undefined) ?? {};
      const checked = tc.date === DATE && tc.type === 'B' && tc.checked?.length === 6 ? [...tc.checked] : Array(6).fill(false);
      checked[i] = !checked[i];
      return { date: DATE, type: 'B', express: false, checked };
    };
    const v = memVault({
      onRead: (p, n, files) => {
        if (p !== LOG || n !== 1) return;
        // The dashboard ticks line 4 just after Pahlavan read the file.
        const doc = JSON.parse(files.get(LOG)!);
        doc.todayChecklist = { date: DATE, type: 'B', express: false, checked: [false, false, false, false, true, false] };
        files.set(LOG, JSON.stringify(doc, null, 2));
      },
    });
    const before = JSON.parse(v.files.get(LOG)!).sessions.length;
    const r = await new LogWriter(v.adapter).saveChecklist(tick(1));
    assert.equal(r.status, 'saved');
    const doc = JSON.parse(v.files.get(LOG)!);
    assert.deepEqual(doc.todayChecklist.checked, [false, true, false, false, true, false]);
    assert.equal(doc.sessions.length, before);
    assert.ok(doc.ladders);
  });
  it('says unchanged when the record is already as asked, and refuses a broken log', async () => {
    const v = memVault();
    const w = new LogWriter(v.adapter);
    const same = { date: DATE, type: 'A', express: false, checked: [true] };
    await w.saveChecklist(() => same);
    assert.equal((await w.saveChecklist(() => same)).status, 'unchanged');
    v.files.set(LOG, '{ nope');
    assert.equal((await w.saveChecklist(() => same)).status, 'failed');
  });
});

describe('CheckinWriter.saveMorning marks the day checked in', () => {
  it('sets checkedAt when the day has none, keeps Habit Nudges’ when it has one', async () => {
    const v = memVault();
    const w = new CheckinWriter(v.adapter);
    const r = await w.saveMorning('2026-04-12', { values: { energy: 3 }, baseline: {}, checkedAt: '2026-04-12T06:31:00.000Z' });
    assert.equal(r.status === 'saved' && r.stamped, true);
    assert.equal(day(v.files, '2026-04-12').checkedAt, '2026-04-12T06:31:00.000Z');
    const k = await w.saveMorning(DATE, { values: { energy: 4 }, baseline, checkedAt: '2026-04-10T09:00:00.000Z' });
    assert.equal(k.status === 'saved' && !k.stamped, true);
    assert.equal(day(v.files).checkedAt, '2026-04-10T07:10:00.000Z');
  });
});
