// The plugin's import of the phone's inbox, against an in-memory copy of the
// synthetic vault (all made up): entries dropped into Coach/Inbox/ are
// written through the plugin's own writers, moved to applied/<YYYY-MM>/,
// refusals kept in refused.json; the second Mac finding a file gone or
// imported before; a write failing at save time; phone.json; the refusals in
// Due today and the Data notes (the fake DOM); the setting.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { readTracking } from '../../src/adapters/vault/tracking-read.ts';
import { momentAt } from '../../src/core/clock.ts';
import { habitCheckinKey } from '../../src/core/tracking.ts';
import { buildDue } from '../../src/report/tracking.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';
import { CheckinWriter } from '../src/checkin-writer.ts';
import { isInboxWatched, isWatched, PahlavanData } from '../src/data-source.ts';
import { importNotice, InboxImporter, type InboxAdapter } from '../src/inbox.ts';
import { LogWriter } from '../src/log-writer.ts';
import { ReminderWriter } from '../src/reminders/writer.ts';
import { defaultPluginData, loadPluginData } from '../src/settings.ts';
import { dueTodayCard } from '../src/ui/due-today.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';
import { memVault, type MemVault } from './mem-vault.ts';

installFakeDom();
type Json = Record<string, any>;
const TODAY = '2026-04-10';
const IN = '3-Personal/Fitness/Coach/Inbox';
const TRACKING = '3-Personal/Fitness/Coach/tracking.json';
const LOG = '3-Personal/Fitness/fitness-log-data.json';
const BODY = '3-Personal/Fitness/body-data.json';
const HABITS = '5-System/Data/habits-data.json';
const NUDGES = '3-Personal/Fitness/Coach/nudges.json';

const SESSION = { v: 1, kind: 'session', at: '2026-04-09T19:02:00-04:00', date: '2026-04-09', session: { type: 'A', lift1: { weight: 55, reps: 10 }, lift2: { weight: 60, reps: 6 }, durationMin: 50 } };
const TICK = { v: 1, kind: 'tick', at: '2026-04-10T09:30:00-04:00', date: TODAY, ids: ['multivitamin', 'protein'] };
const WATER = { v: 1, kind: 'amount', at: '2026-04-10T12:00:00-04:00', date: TODAY, id: 'water', add: 500 };
const REST = { v: 1, kind: 'trained', at: '2026-04-05T20:15:00-04:00', date: '2026-04-05', answer: 'rest' };
const LOGGED = { v: 1, kind: 'session', at: '2026-04-08T18:00:00-04:00', date: '2026-04-08', session: { type: 'A', lift1: { weight: 55, reps: 9 }, lift2: { weight: 60, reps: 5 } } };
const MORNING = { v: 1, kind: 'morning', at: '2026-04-10T07:05:00-04:00', date: TODAY, morning: { energy: 4 } };

function drop(v: MemVault, name: string, entry: Json): void {
  v.folders.add('3-Personal/Fitness/Coach/Inbox');
  v.files.set(`${IN}/${name}`, JSON.stringify(entry));
}
function importer(v: MemVault, adapter: InboxAdapter = v.adapter): InboxImporter {
  return new InboxImporter({ adapter, log: new LogWriter(adapter), writer: new ReminderWriter(adapter), checkin: new CheckinWriter(adapter) });
}
const inbox = (v: MemVault) => [...v.files.keys()].filter((k) => k.startsWith(`${IN}/`)).sort();

describe('the plugin imports the phone\'s inbox through its own writers', () => {
  it('writes each entry, moves it to applied/<YYYY-MM>/, keeps the refused ones with refused.json', async () => {
    const v = memVault();
    drop(v, '2026-04-09T19-02-00-session.json', SESSION);
    drop(v, '2026-04-10T09-30-00-tick.json', TICK);
    drop(v, '2026-04-10T12-00-00-amount.json', WATER);
    drop(v, '2026-04-05T20-15-00-trained.json', REST);
    drop(v, '2026-04-08T18-00-00-session.json', LOGGED);
    drop(v, '2026-04-10T07-05-00-morning.json', MORNING);
    const s = (await importer(v).run(TODAY))!;
    assert.equal(s.found, 6);
    assert.deepEqual(s.imported.map((r) => r.file), ['2026-04-05T20-15-00-trained.json', '2026-04-09T19-02-00-session.json', '2026-04-10T09-30-00-tick.json', '2026-04-10T12-00-00-amount.json']);
    assert.deepEqual(s.refused.map((r) => [r.file, r.code]), [['2026-04-08T18-00-00-session.json', 'already'], ['2026-04-10T07-05-00-morning.json', 'conflict']]);
    assert.equal(s.wrote, true);
    assert.equal(importNotice(s), 'Pahlavan: 4 phone entries imported; 2 need a look on Today.');
    // Through the screens' writers: the session and its Workout tick, the ticks and the water with their habits, the rest day and its answer.
    assert.ok(v.json(LOG).sessions.some((x: Json) => x.date === '2026-04-09' && x.type === 'A' && x.lift2.name === 'Flat DB Bench Press'));
    assert.equal(v.json(TRACKING).days[TODAY].water.amount, 1750);
    assert.equal(v.json(TRACKING).days[TODAY].multivitamin.at, '2026-04-10T13:30:00.000Z');
    assert.equal(v.json(HABITS).checkins[habitCheckinKey('protein', TODAY)], '1');
    assert.equal(v.json(HABITS).checkins[habitCheckinKey('water', TODAY)], '500');
    assert.equal(v.json(BODY).days['2026-04-05'].mark, 'rest');
    assert.deepEqual(v.json(NUDGES).days['2026-04-05'].train, { how: 'rest', at: '2026-04-06T00:15:00.000Z', by: 'phone' });
    assert.equal(v.json(BODY).days[TODAY].energy, 2, 'the conflicting morning wrote nothing');
    assert.deepEqual(inbox(v), [
      `${IN}/2026-04-08T18-00-00-session.json`,
      `${IN}/2026-04-10T07-05-00-morning.json`,
      `${IN}/applied/2026-04/2026-04-05T20-15-00-trained.json`,
      `${IN}/applied/2026-04/2026-04-09T19-02-00-session.json`,
      `${IN}/applied/2026-04/2026-04-10T09-30-00-tick.json`,
      `${IN}/applied/2026-04/2026-04-10T12-00-00-amount.json`,
      `${IN}/refused.json`,
    ]);
    assert.equal(v.files.get(`${IN}/applied/2026-04/2026-04-10T12-00-00-amount.json`), JSON.stringify(WATER), 'moved as it was');
    assert.deepEqual(v.json(`${IN}/refused.json`).refused.map((r: Json) => [r.file, r.date, r.kind, r.code]), [['2026-04-08T18-00-00-session.json', '2026-04-08', 'session', 'already'], ['2026-04-10T07-05-00-morning.json', TODAY, 'morning', 'conflict']]);

    // The next refresh: the refused ones again, the same refusals, nothing written.
    const writes = v.writes.length;
    const again = (await importer(v).run(TODAY))!;
    assert.deepEqual([again.found, again.imported.length, again.refused.length, again.wrote, v.writes.length], [2, 0, 2, false, writes]);
    assert.equal(importNotice(again), null);
    // Deleted by the user: refused.json is emptied once, then left alone.
    v.files.delete(`${IN}/2026-04-08T18-00-00-session.json`);
    v.files.delete(`${IN}/2026-04-10T07-05-00-morning.json`);
    assert.equal((await importer(v).run(TODAY))!.wrote, true);
    assert.deepEqual(v.json(`${IN}/refused.json`), { v: 1, refused: [] });
    assert.equal((await importer(v).run(TODAY))!.wrote, false);
  });

  it('does nothing without an inbox, and uses the adapter\'s rename for the move when it has one', async () => {
    const v = memVault();
    assert.equal(await importer(v).run(TODAY), null);
    drop(v, 't.json', TICK);
    const renames: [string, string][] = [];
    const adapter: InboxAdapter = {
      ...v.adapter,
      async rename(from, to) {
        renames.push([from, to]);
        v.files.set(to, v.files.get(from)!);
        v.files.delete(from);
      },
    };
    const s = (await importer(v, adapter).run(TODAY))!;
    assert.equal(s.imported.length, 1);
    assert.deepEqual(renames, [[`${IN}/t.json`, `${IN}/applied/2026-04/t.json`]]);
  });

  it('two Macs: a file the other Mac moved meanwhile is skipped; one it imported before is refused as already', async () => {
    // Between the read and the move the other Mac's pull takes the file away: the write is the same as the other Mac's, the move is skipped.
    const v = memVault();
    drop(v, 't.json', TICK);
    const gone: InboxAdapter = {
      ...v.adapter,
      async write(p, data) {
        await v.adapter.write(p, data);
        if (p === TRACKING) v.files.delete(`${IN}/t.json`); // the other Mac's pull removes it as this Mac writes
      },
    };
    const s = (await importer(v, gone).run(TODAY))!;
    assert.deepEqual([s.imported.length, s.skipped, s.refused.length], [0, ['t.json'], 0]);
    assert.equal(v.json(TRACKING).days[TODAY].multivitamin.done, true);

    // The other Mac imported the water and its pull brought the data and the applied file, but the inbox copy came back.
    const b = memVault();
    drop(b, 'w.json', WATER);
    await importer(b).run(TODAY);
    drop(b, 'w.json', WATER);
    const twice = (await importer(b).run(TODAY))!;
    assert.deepEqual(twice.refused.map((r) => [r.file, r.code]), [['w.json', 'already']]);
    assert.match(twice.refused[0]!.reason, /^imported before/);
    assert.equal(b.json(TRACKING).days[TODAY].water.amount, 1750, 'counted once');
  });

  it('a write that fails at save time keeps the entry in the inbox, refused as failed, and tries again next time', async () => {
    const v = memVault();
    drop(v, 'w.json', WATER);
    let broken = true;
    const adapter: InboxAdapter = {
      ...v.adapter,
      async write(p, data) {
        if (p === TRACKING && broken) throw new Error('disk full');
        await v.adapter.write(p, data);
      },
    };
    const s = (await importer(v, adapter).run(TODAY))!;
    assert.deepEqual(s.refused.map((r) => [r.file, r.code]), [['w.json', 'failed']]);
    assert.match(s.refused[0]!.reason, /tracking.json could not be written: disk full/);
    assert.ok(v.files.has(`${IN}/w.json`));
    assert.equal(v.json(TRACKING).days[TODAY].water.amount, 1250);
    broken = false;
    const next = (await importer(v, adapter).run(TODAY))!;
    assert.deepEqual([next.imported.length, next.refused.length], [1, 0]);
    assert.equal(v.json(TRACKING).days[TODAY].water.amount, 1750);
  });

  it('"trained" ticks the Workout habit through the log writer', async () => {
    const v = memVault();
    drop(v, 'x.json', { ...REST, answer: 'trained' });
    await importer(v).run(TODAY);
    assert.equal(v.json(HABITS).checkins[habitCheckinKey('workout', '2026-04-05')], '1');
    assert.equal(v.json(NUDGES).days['2026-04-05'].train.how, 'logged');
    assert.equal(await new LogWriter(v.adapter).tickWorkout('2026-04-05'), 'already');
  });

  it('runs once more after a run asked for while one was going', async () => {
    const v = memVault();
    drop(v, 'a.json', TICK);
    const imp = importer(v);
    const first = imp.run(TODAY);
    drop(v, 'b.json', WATER);
    assert.equal(await imp.run(TODAY), null, 'the second call joins the run going');
    const s = (await first)!;
    assert.deepEqual(s.imported.map((r) => r.file).sort(), ['a.json', 'b.json']);
  });
});

describe('phone.json from the plugin', () => {
  it('written when it changes, left alone when it does not, not written in a vault with nothing for the phone', async () => {
    const v = memVault();
    const imp = importer(v);
    assert.equal(await imp.writePhone(TODAY), 'written');
    const p = v.json(`${IN}/phone.json`);
    assert.deepEqual([p.date, p.open.includes('multivitamin')], [TODAY, true]);
    assert.equal(await imp.writePhone(TODAY), 'unchanged');
    drop(v, 't.json', TICK);
    await imp.run(TODAY);
    assert.equal(await imp.writePhone(TODAY), 'written');
    assert.ok(!v.json(`${IN}/phone.json`).open.includes('multivitamin'), 'follows the tick');
    const bare = memVault({ without: (path) => path.endsWith('plan-data.json') || path.endsWith('tracking.json') });
    assert.equal(await importer(bare).writePhone(TODAY), 'skipped');
    assert.ok(!bare.files.has(`${IN}/phone.json`));
  });
});

describe('the refusals on Today', () => {
  it('watches entry files and refused.json, not phone.json or applied/', () => {
    assert.ok(isWatched(`${IN}/2026-04-10T09-30-00-tick.json`));
    assert.ok(isWatched(`${IN}/refused.json`));
    assert.ok(!isInboxWatched(`${IN}/phone.json`));
    assert.ok(!isInboxWatched(`${IN}/applied/2026-04/x.json`));
    assert.ok(!isInboxWatched('3-Personal/Fitness/Coach/Inboxes/x.json'));
  });

  it('the Data notes list each refused entry with its file and reason', async () => {
    const v = memVault();
    drop(v, '2026-04-08T18-00-00-session.json', LOGGED);
    await importer(v).run(TODAY);
    const data = new PahlavanData(v.adapter);
    const t = await data.today(TODAY, 'full');
    const notes = t.warnings.filter((w) => w.code === 'phone');
    assert.deepEqual(notes.map((w) => w.message), ['2026-04-08T18-00-00-session.json: Full Body A is logged on Wed 8 Apr already: the log keeps that one (open it in Pahlavan to change it), so delete this entry']);
    assert.deepEqual(data.inboxRefused.map((r) => r.code), ['already']);
  });

  it('Due today says "1 phone entry needs a look" with what it was and why', async () => {
    const f = fixtureFiles('v');
    const io = memoryIo(f, TODAY);
    const due = buildDue(readVault(io, 'v', { asOf: TODAY }).data, readTracking(io, 'v'), momentAt(TODAY, '12:15', 0)).today.value;
    const card = (phone: Json[]) => dueTodayCard({
      due,
      items: [],
      activity: { readable: true, why: null },
      stand: [],
      sitting: null,
      standing: { on: false, since: null },
      sundayDone: false,
      canWrite: true,
      busy: new Set(),
      onTick() {},
      onAdd() {},
      onOpen() {},
      onStanding() {},
      onHabits() {},
      phone: phone as never,
    }) as unknown as FakeElement;
    const refused = { file: '2026-04-08T18-00-00-session.json', date: '2026-04-08', kind: 'session', code: 'already', reason: 'Full Body A is logged on Wed 8 Apr already' };
    const one = card([refused]);
    const row = one.querySelectorAll('.pv-due-row').map(text).find((x) => /phone/.test(x));
    assert.equal(row, '1 phone entry needs a lookSession, Wed 8 Apr: Full Body A is logged on Wed 8 Apr already');
    const two = card([refused, { ...refused, file: 'b.json', kind: 'morning', date: TODAY, reason: 'Energy is 2' }]);
    assert.match(text(two), /2 phone entries need a lookSession, Wed 8 Apr: Full Body A is logged on Wed 8 Apr already \(and 1 more in Data notes\)/);
    assert.ok(!/phone entr/.test(text(card([]))));
  });
});

describe('the setting', () => {
  it('"Import phone entries" is on by default, kept when off, and a malformed value is the default', () => {
    assert.deepEqual(defaultPluginData({ gitSynced: true }).phone, { import: true });
    assert.deepEqual(loadPluginData({ version: 2, phone: { import: false } }, { gitSynced: true }).data.phone, { import: false });
    assert.deepEqual(loadPluginData({ version: 2, phone: { import: 'no' } }, { gitSynced: true }).data.phone, { import: true });
    // data.json from 0.7 gains the group and is saved once.
    const old = loadPluginData({ ...defaultPluginData({ gitSynced: true }), phone: undefined }, { gitSynced: true });
    assert.deepEqual([old.data.phone, old.migrated], [{ import: true }, true]);
  });
});
