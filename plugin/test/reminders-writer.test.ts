// The reminder cards' writer on an in-memory copy of the synthetic vault:
// answers into Coach/nudges.json (the other Mac's same answer is `already`,
// a different one a conflict), the re-read before the write and one retry,
// the Coach folder made on the first write, ticks and amounts into
// tracking.json and the linked habit, and the progress photos'
// paths (converted to JPEG, saved as is without sips, an old pose replaced,
// then the photo index).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { answerCard, type DueCard } from '../../src/core/nudges.ts';
import { explain } from '../../src/core/reason.ts';
import { momentAt } from '../../src/core/clock.ts';
import { habitCheckinKey } from '../../src/core/tracking.ts';
import { ReminderWriter, type PhotoConvert } from '../src/reminders/writer.ts';
import { bytes, memVault, text } from './mem-vault.ts';

const COACH = '3-Personal/Fitness/Coach';
const NUDGES = `${COACH}/nudges.json`;
const TRACKING = `${COACH}/tracking.json`;
const BODY = '3-Personal/Fitness/body-data.json';
const HABITS = '5-System/Data/habits-data.json';
const DATE = '2026-04-10';
const NOW = momentAt(DATE, '20:05', 0).ms;
const slot = (key: string): DueCard => ({ key, kind: 'habits', date: DATE, items: ['protein'], at: 1200, late: 5, closable: true, skip: 'today', snooze: null, reason: explain(true, 'habits.slot', {}).reason });

describe('ReminderWriter.nudges', () => {
  it('writes an answer with this Mac’s name, read back', async () => {
    const v = memVault();
    const w = new ReminderWriter(v.adapter);
    const r = await w.nudges(answerCard(slot('slot:20:00'), 'done', NOW, { by: 'Home Mac' }), DATE);
    assert.equal(r.status, 'saved');
    assert.deepEqual(v.json(NUDGES).days[DATE]['slot:20:00'], { how: 'done', at: new Date(NOW).toISOString(), by: 'Home Mac' });
  });

  it('the other Mac had answered the same: already, and nothing changes', async () => {
    const v = memVault();
    const w = new ReminderWriter(v.adapter);
    await w.nudges(answerCard(slot('slot:20:00'), 'skip', NOW, { by: 'Work Mac' }), DATE);
    const before = v.files.get(NUDGES);
    const r = await w.nudges(answerCard(slot('slot:20:00'), 'skip', NOW + 60_000, { by: 'Home Mac' }), DATE);
    assert.deepEqual(r, { status: 'unchanged', already: ['slot:20:00'] });
    assert.equal(v.files.get(NUDGES), before);
  });

  it('a different answer from the other Mac is a conflict; its answer stays', async () => {
    const v = memVault();
    const w = new ReminderWriter(v.adapter);
    await w.nudges(answerCard(slot('slot:20:00'), 'skip', NOW, { by: 'Work Mac' }), DATE);
    const r = await w.nudges(answerCard(slot('slot:20:00'), 'done', NOW, { by: 'Home Mac' }), DATE);
    assert.equal(r.status, 'conflict');
    assert.equal(v.json(NUDGES).days[DATE]['slot:20:00'].how, 'skipped');
  });

  it('a snooze over the other Mac’s answer is dropped as already', async () => {
    const v = memVault();
    const w = new ReminderWriter(v.adapter);
    const r = await w.nudges(answerCard({ ...slot('morning'), kind: 'morning' }, 'snooze', NOW, { snoozeUntil: NOW + 30 * 60_000 }), DATE);
    assert.deepEqual(r, { status: 'unchanged', already: ['morning'] }, 'the fixture has the morning answered');
  });

  it('merges again when the file changes between the read and the write (git pulled the other Mac’s answer)', async () => {
    let bumped = false;
    const v = memVault({
      onRead: (p, _n, vault) => {
        if (p !== NUDGES || bumped) return;
        bumped = true;
        const doc = JSON.parse(vault.files.get(NUDGES)!);
        doc.days[DATE]['slot:21:30'] = { how: 'done', at: '2026-04-10T21:31:00.000Z', by: 'Work Mac' };
        vault.files.set(NUDGES, JSON.stringify(doc, null, 2));
      },
    });
    const w = new ReminderWriter(v.adapter);
    const r = await w.nudges(answerCard(slot('slot:20:00'), 'done', NOW, { by: 'Home Mac' }), DATE);
    assert.equal(r.status, 'saved');
    const day = v.json(NUDGES).days[DATE];
    assert.equal(day['slot:20:00'].how, 'done');
    assert.equal(day['slot:21:30'].by, 'Work Mac', 'the other Mac’s answer is kept');
  });

  it('makes the Coach folder on the first write', async () => {
    const v = memVault({ without: (p) => p.startsWith(`${COACH}/`) });
    v.folders.delete(COACH);
    const w = new ReminderWriter(v.adapter);
    const r = await w.nudges(answerCard(slot('slot:20:00'), 'done', NOW, { by: 'Home Mac' }), DATE);
    assert.equal(r.status, 'saved');
    assert.ok(v.folders.has(COACH));
    assert.equal(v.json(NUDGES).schemaVersion, 1);
  });

  it('never writes over a file that does not read (an unresolved git conflict)', async () => {
    const v = memVault();
    v.files.set(NUDGES, '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> other\n');
    const r = await new ReminderWriter(v.adapter).nudges(answerCard(slot('slot:20:00'), 'done', NOW), DATE);
    assert.equal(r.status, 'failed');
    assert.equal(v.writes.length, 0);
  });
});

describe('ReminderWriter.tracking and habits', () => {
  it('ticks an item and its linked habit', async () => {
    const v = memVault();
    const w = new ReminderWriter(v.adapter);
    const at = new Date(NOW).toISOString();
    assert.equal((await w.tracking([{ op: 'tick', item: 'protein', date: DATE, done: true, at }])).status, 'saved');
    assert.equal((await w.habits([{ habit: 'protein', date: DATE, tick: true }])).status, 'saved');
    assert.deepEqual(v.json(TRACKING).days[DATE].protein, { done: true, at });
    assert.equal(v.json(HABITS).checkins[habitCheckinKey('protein', DATE)], '1');
  });

  it('adds water as a delta, here and on the homepage', async () => {
    const v = memVault();
    const w = new ReminderWriter(v.adapter);
    const key = habitCheckinKey('water', DATE);
    const before = Number(v.json(HABITS).checkins[key] ?? 0);
    await w.tracking([{ op: 'add', item: 'water', date: DATE, field: 'amount', delta: 500 }]);
    await w.habits([{ habit: 'water', date: DATE, add: 500 }]);
    assert.equal(v.json(TRACKING).days[DATE].water.amount, 1750);
    assert.equal(Number(v.json(HABITS).checkins[key]), before + 500);
  });

  it('an unknown item is a failure, nothing written', async () => {
    const v = memVault();
    const r = await new ReminderWriter(v.adapter).tracking([{ op: 'tick', item: 'nope', date: DATE, done: true }]);
    assert.equal(r.status, 'failed');
    assert.equal(v.writes.length, 0);
  });
});

describe('ReminderWriter.photos', () => {
  const sips: PhotoConvert = async (p) => ({ data: bytes(`jpeg of ${p.name}`), ext: 'jpeg' });
  const asIs: PhotoConvert = async (p) => ({ data: p.data, ext: (/\.([a-z0-9]+)$/i.exec(p.name)?.[1] ?? 'jpeg').toLowerCase() });

  it('saves each pose as Progress Photos/<date>/<pose>.jpeg and indexes the date', async () => {
    const v = memVault();
    const w = new ReminderWriter(v.adapter);
    const r = await w.photos('2026-04-26', [{ pose: 'side', name: 'IMG_4822.HEIC', data: bytes('b') }, { pose: 'front', name: 'IMG_4821.HEIC', data: bytes('a') }], sips);
    assert.equal(r.status, 'saved');
    if (r.status !== 'saved') return;
    assert.deepEqual(r.saved.map((s) => s.path), ['3-Personal/Fitness/Progress Photos/2026-04-26/front.jpeg', '3-Personal/Fitness/Progress Photos/2026-04-26/side.jpeg']);
    assert.equal(text(v.binaries.get('3-Personal/Fitness/Progress Photos/2026-04-26/front.jpeg')), 'jpeg of IMG_4821.HEIC');
    const idx = v.json<{ photos: { date: string; poses: string[] }[] }>(BODY).photos.find((p) => p.date === '2026-04-26');
    assert.deepEqual(idx?.poses, ['front', 'side']);
  });

  it('without sips the photo is saved as it is, with its own extension; the earlier file of that pose goes', async () => {
    const v = memVault();
    v.folders.add('3-Personal/Fitness/Progress Photos');
    v.folders.add('3-Personal/Fitness/Progress Photos/2026-04-26');
    v.binaries.set('3-Personal/Fitness/Progress Photos/2026-04-26/back.jpeg', bytes('old'));
    const w = new ReminderWriter(v.adapter);
    const r = await w.photos('2026-04-26', [{ pose: 'back', name: 'IMG_1.HEIC', data: bytes('heic') }], asIs);
    assert.equal(r.status, 'saved');
    assert.ok(v.binaries.has('3-Personal/Fitness/Progress Photos/2026-04-26/back.heic'));
    assert.ok(!v.binaries.has('3-Personal/Fitness/Progress Photos/2026-04-26/back.jpeg'));
    assert.deepEqual(v.removed, ['3-Personal/Fitness/Progress Photos/2026-04-26/back.jpeg']);
  });

  it('keeps the index in date order and the poses it had', async () => {
    const v = memVault();
    const w = new ReminderWriter(v.adapter);
    await w.photos('2026-02-24', [{ pose: 'posture-closeup', name: 'x.jpg', data: bytes('c') }], sips);
    const p = v.json<{ photos: { date: string; poses: string[] }[] }>(BODY).photos;
    assert.deepEqual(p.find((x) => x.date === '2026-02-24')?.poses, ['front', 'side', 'back', 'posture-closeup']);
  });

  it('a pose that could not be saved is not indexed, and says which were', async () => {
    const v = memVault();
    const w = new ReminderWriter(v.adapter);
    const bad: PhotoConvert = async (p) => {
      if (p.pose === 'side') throw new Error('disk full');
      return sips(p);
    };
    const r = await w.photos('2026-04-26', [{ pose: 'front', name: 'a.jpg', data: bytes('a') }, { pose: 'side', name: 'b.jpg', data: bytes('b') }], bad);
    assert.equal(r.status, 'failed');
    assert.deepEqual(r.saved.map((s) => s.pose), ['front']);
    assert.ok(!v.json<{ photos: { date: string }[] }>(BODY).photos.some((x) => x.date === '2026-04-26'));
  });
});

describe('ReminderWriter.record and dayMark', () => {
  it('the tape for a date, field by field; a field changed on disk since the card read it is a conflict', async () => {
    const v = memVault();
    const w = new ReminderWriter(v.adapter);
    assert.equal((await w.record('tape', '2026-04-12', { values: { waist: 93.1, arm: 33.5 }, baseline: {} })).status, 'saved');
    const doc = v.json<{ tape: Record<string, unknown>[] }>(BODY);
    assert.deepEqual(doc.tape.at(-1), { date: '2026-04-12', waist: 93.1, arm: 33.5 });
    const r = await w.record('tape', '2026-04-12', { values: { waist: 92 }, baseline: { waist: null } });
    assert.equal(r.status, 'conflict');
  });

  it('"Rest day" marks the day in body-data.json', async () => {
    const v = memVault();
    const r = await new ReminderWriter(v.adapter).dayMark('2026-04-09', 'rest');
    assert.equal(r.status, 'saved');
    assert.equal(v.json<{ days: Record<string, { mark?: string }> }>(BODY).days['2026-04-09']!.mark, 'rest');
  });
});
