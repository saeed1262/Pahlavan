// The plugin's data source against the synthetic vault, through a fake
// adapter shaped like Obsidian's DataAdapter (vault-relative paths).

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { buildProgress, buildProgressMore, buildSession, buildToday } from '../../src/report/index.ts';
import { isWatched, PahlavanData, readerOf, watchedPaths, type AdapterLike } from '../src/data-source.ts';
import { phaseByHour, phaseNow } from '../src/phase.ts';
import { choosePick, pickFor } from '../src/pick.ts';
import { paths } from '../../src/adapters/vault/layout.ts';
import { useFolders } from '../../src/adapters/vault/layout.ts';
import { FIXTURE_FOLDERS } from '../../test/helpers.ts';

useFolders(FIXTURE_FOLDERS);

const VAULT = join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'vault');
const DATE = '2026-04-10';

function fakeAdapter(base: string, counter?: { reads: number }): AdapterLike {
  const abs = (p: string) => join(base, p);
  return {
    async exists(p) {
      return existsSync(abs(p));
    },
    async read(p) {
      if (counter) counter.reads++;
      return readFileSync(abs(p), 'utf8');
    },
    async list(p) {
      const names = readdirSync(abs(p));
      return { files: names.filter((n) => statSync(join(abs(p), n)).isFile()).map((n) => `${p}/${n}`), folders: names.filter((n) => statSync(join(abs(p), n)).isDirectory()).map((n) => `${p}/${n}`) };
    },
  };
}
const fsIo = {
  readText: (p: string) => (existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null),
  listDir: (p: string) => (existsSync(p) && statSync(p).isDirectory() ? readdirSync(p) : null),
};
const plain = (x: unknown) => JSON.parse(JSON.stringify(x));

describe('readerOf', () => {
  const io = readerOf(fakeAdapter(VAULT));
  it('reads a file, and a missing one as null', async () => {
    assert.match((await io.readText('3-Personal/Fitness/plan-data.json'))!, /weekTarget/);
    assert.equal(await io.readText('3-Personal/Fitness/Coach/checkins.json'), null);
  });
  it('lists a folder’s file names, not paths', async () => {
    const names = (await io.listDir('3-Personal/Fitness'))!;
    assert.ok(names.includes('Baseline - 2026-02-23.md'));
    assert.ok(names.every((n) => !n.includes('/')));
    assert.equal(await io.listDir('nowhere'), null);
  });
});

describe('PahlavanData', () => {
  it('gives the same Today report as the engine on the same files', async () => {
    const data = new PahlavanData(fakeAdapter(VAULT));
    const t = await data.today(DATE, 'full');
    const expected = buildToday(readVault(fsIo, VAULT, { asOf: DATE }), DATE, 'full', '');
    assert.deepEqual(plain(t.review), plain(expected.review));
    assert.deepEqual(plain(t.session), plain(expected.session));
    assert.deepEqual(plain(t.inputs), plain(expected.inputs));
    assert.deepEqual(plain(t.week), plain(expected.week));
    assert.deepEqual(t.notes.map((n) => n.code), expected.notes.map((n) => n.code));
    assert.equal(t.sources.vault, '');
  });

  it('gives the same Progress report as the engine, from the same read', async () => {
    const counter = { reads: 0 };
    const data = new PahlavanData(fakeAdapter(VAULT, counter));
    await data.today(DATE, 'full');
    const reads = counter.reads;
    const p = await data.progress(DATE);
    assert.equal(counter.reads, reads);
    const expected = buildProgress(readVault(fsIo, VAULT, { asOf: DATE }), DATE, '');
    for (const k of ['volume', 'readiness', 'calendar', 'lifts', 'weight', 'notes'] as const) assert.deepEqual(plain(p[k]), plain(expected[k]), k);
  });

  it('re-runs the session in another mode without reading again', async () => {
    const counter = { reads: 0 };
    const data = new PahlavanData(fakeAdapter(VAULT, counter));
    await data.today(DATE, 'full');
    const reads = counter.reads;
    const hotel = data.session(DATE, 'hotel')!;
    assert.equal(counter.reads, reads);
    assert.deepEqual(plain(hotel), plain(buildSession(readVault(fsIo, VAULT, { asOf: DATE }).data, DATE, 'hotel')));
    assert.equal(hotel.mode, 'hotel');
  });

  it('passes the user’s pick to the Today report and the session, without reading again', async () => {
    const counter = { reads: 0 };
    const data = new PahlavanData(fakeAdapter(VAULT, counter));
    const t = await data.today(DATE, 'full', { type: 'S3' });
    const read = readVault(fsIo, VAULT, { asOf: DATE });
    assert.deepEqual(plain(t.session), plain(buildToday(read, DATE, 'full', '', { type: 'S3' }).session));
    assert.deepEqual([t.session!.session!.type, t.session!.session!.picked], ['S3', true]);
    const reads = counter.reads;
    const express = data.session(DATE, 'express', { type: 'A' })!;
    assert.equal(counter.reads, reads);
    assert.deepEqual(plain(express), plain(buildSession(read.data, DATE, 'express', { type: 'A' })));
    assert.deepEqual([express.mode, express.session!.type], ['express', 'A']);
    assert.equal(data.session(DATE, 'full')!.session!.picked, false);
  });

  it('reads again when the date moves on', async () => {
    const counter = { reads: 0 };
    const data = new PahlavanData(fakeAdapter(VAULT, counter));
    await data.today(DATE, 'full');
    const first = counter.reads;
    await data.today(DATE, 'express');
    assert.equal(counter.reads, first);
    await data.today('2026-04-11', 'full');
    assert.ok(counter.reads > first);
  });

  it('reads another date with that day’s ladder levels, leaving today’s read alone', async () => {
    const data = new PahlavanData(fakeAdapter(VAULT));
    const now = await data.load(DATE);
    assert.equal(await data.readAsOf(DATE), now);
    const before = await data.readAsOf('2026-03-10');
    const s1 = (r: typeof now, date: string) => buildSession(r.data, date, 'full', { type: 'S1' }).items.map((x) => x.name);
    assert.ok(s1(before, '2026-03-10').includes('Incline push-up'));
    assert.ok(s1(now, DATE).includes('Floor push-up'));
    assert.equal(data.current, now);
  });

  it('stays calm on an empty vault', async () => {
    const data = new PahlavanData(fakeAdapter(join(VAULT, 'nowhere')));
    const t = await data.today(DATE, 'full');
    assert.equal(t.review, null);
    assert.ok(t.notes.some((n) => n.code === 'no-plan'));
    assert.equal(data.session(DATE, 'full'), null);
  });
});

describe('watched paths', () => {
  it('covers every source file and the baselines, nothing else', () => {
    assert.equal(watchedPaths().length, 8);
    assert.ok(isWatched('3-Personal/Fitness/Coach/eating-plan.json'), 'the eating plan reloads the Food tab');
    assert.ok(isWatched("3-Personal/Fitness/Coach/Decisions.md"));
    assert.ok(isWatched("3-Personal/Fitness/Coach/Letters/2026-04-12.md"));
    assert.ok(isWatched('3-Personal/Fitness/fitness-log-data.json'));
    assert.ok(isWatched('3-Personal/Fitness/Coach/ledger.json'));
    assert.ok(isWatched('5-System/Data/habits-data.json'));
    assert.ok(isWatched('3-Personal/Fitness/Baseline - 2026-09-30.md'));
    assert.ok(!isWatched('3-Personal/Fitness/Session History.md'));
    assert.ok(!isWatched('Daily/2026-04-10.md'));
  });
  it('re-reads on what is tracked and the reminder state, never on sitting time', () => {
    assert.ok(isWatched('3-Personal/Fitness/Coach/tracking.json'));
    assert.ok(isWatched('3-Personal/Fitness/Coach/nudges.json'));
    // Written every 2 minutes while someone sits: the screens follow the reminders' onChange instead.
    assert.ok(!isWatched('3-Personal/Fitness/Coach/sitting.json'));
  });
});

describe('PahlavanData: the stage 3.5 screens', () => {
  it('reads the tracking files with the vault, and Habit Nudges\' settings under the config folder', async () => {
    const data = new PahlavanData(fakeAdapter(VAULT), '', { configDir: '.obsidian' });
    await data.load(DATE);
    assert.equal(data.tracking!.files.tracking, 'found');
    assert.equal(data.tracking!.files.nudgesSettings, 'found');
    const hb = data.habits(DATE)!;
    assert.equal(hb.items.length, 11);
    assert.equal(hb.bringOver, null);
    assert.equal(data.bodyRecord(DATE)!.parts.length, 3);
    assert.equal(data.deskCard(DATE)!.item!.id, 'desk-breaks');
  });
  it('reads no Habit Nudges settings without the config folder', async () => {
    const data = new PahlavanData(fakeAdapter(VAULT));
    await data.load(DATE);
    assert.equal(data.tracking!.files.nudgesSettings, 'missing');
  });
  it('has nothing to show before the first read', () => {
    const data = new PahlavanData(fakeAdapter(VAULT));
    assert.equal(data.habits(DATE), null);
    assert.equal(data.bodyRecord(DATE), null);
    assert.equal(data.deskCard(DATE), null);
  });
});

describe('the banner phase', () => {
  const classes = (...names: string[]) => ({ contains: (n: string) => names.includes(n) });
  it('follows Isfahan’s class on the body', () => {
    assert.deepEqual(phaseNow(classes('isfahan', 'isfahan-night'), 11), { id: 'night', isfahan: true });
  });
  it('falls back to the hour, as the dashboard does', () => {
    assert.deepEqual(phaseNow(classes('theme-light'), 11), { id: 'workday', isfahan: false });
    assert.deepEqual([5, 6, 9, 10, 14, 15, 17, 18, 23].map(phaseByHour), ['night', 'dawn', 'dawn', 'workday', 'workday', 'evening', 'evening', 'night', 'night']);
  });
});

describe('the pick of session', () => {
  it('holds for its own day only', () => {
    assert.equal(pickFor({ date: DATE, type: 'S3' }, DATE), 'S3');
    assert.equal(pickFor({ date: DATE, type: 'S3' }, '2026-04-11'), null);
    assert.equal(pickFor(null, DATE), null);
    assert.equal(pickFor(undefined, DATE), null);
  });
  it('is set by a choice and cleared by going back to the suggestion', () => {
    assert.deepEqual(choosePick('A', DATE), { date: DATE, type: 'A' });
    assert.equal(choosePick(null, DATE), null);
  });
});

describe('the rest of Progress and the photo files', () => {
  it('gives the same sections as the engine, from the same read', async () => {
    const data = new PahlavanData(fakeAdapter(VAULT));
    await data.today(DATE, 'full');
    const more = data.progressMore(DATE)!;
    const expected = buildProgressMore(readVault(fsIo, VAULT, { asOf: DATE }), DATE, '');
    for (const k of ['training', 'body', 'health', 'skills', 'notes'] as const) assert.deepEqual(plain(more[k]), plain(expected[k]), k);
  });
  it('finds each set’s images by pose, in the index’s folders and any other dated folder', async () => {
    const base = '3-Personal/Fitness/Progress Photos';
    const tree: Record<string, { files: string[]; folders: string[] }> = {
      [base]: { files: [], folders: [`${base}/2026-02-24`, `${base}/2026-03-10`, `${base}/old`] },
      [`${base}/2026-02-24`]: { files: [`${base}/2026-02-24/Front.jpg`, `${base}/2026-02-24/side.JPG`, `${base}/2026-02-24/notes.txt`], folders: [] },
      [`${base}/2026-03-10`]: { files: [`${base}/2026-03-10/back.png`], folders: [] },
    };
    const adapter: AdapterLike = { exists: async (p) => p in tree, read: async () => '', list: async (p) => tree[p]! };
    const files = await new PahlavanData(adapter).photoFiles([{ date: '2026-02-24', folder: 'Progress Photos/2026-02-24/' }]);
    assert.deepEqual(files, { '2026-02-24': { front: `${base}/2026-02-24/Front.jpg`, side: `${base}/2026-02-24/side.JPG` }, '2026-03-10': { back: `${base}/2026-03-10/back.png` } });
  });
});
