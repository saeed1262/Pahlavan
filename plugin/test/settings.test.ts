// The plugin's settings: the defaults (sync on only in a git-synced vault),
// data.json from older versions and partial or malformed data loaded into
// the current shape, the quiet hours across midnight, and "Remind on this
// Mac" in this Mac's local storage.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_REMINDERS, DEFAULT_SETTINGS, defaultPluginData, inQuietHours, loadPluginData, progressScope, REMIND_HERE_KEY, remindHere, setProgressScope, setRemindHere, SETTINGS_VERSION, type PahlavanSettings } from '../src/settings.ts';

const GIT = { gitSynced: true };
const NO_GIT = { gitSynced: false };

describe('settings defaults', () => {
  it('start with no pick of session, reminders on and the 30-minute snooze', () => {
    const d = defaultPluginData(GIT);
    assert.equal(DEFAULT_SETTINGS.pick, null);
    assert.deepEqual({ lastTab: d.lastTab, mode: d.mode, pick: d.pick }, { lastTab: 'today', mode: 'full', pick: null });
    assert.deepEqual(d.reminders, { on: true, notifications: true, snoozeMinutes: 30, quiet: { on: true, from: '22:30', to: '07:00' }, didYouTrain: true, didYouTrainAt: '20:00' });
    assert.equal(d.version, SETTINGS_VERSION);
  });

  it('turn sync on only in a vault that is a git repository with obsidian-git', () => {
    assert.deepEqual(defaultPluginData(GIT).sync, { pullBefore: true, syncAfter: true });
    assert.deepEqual(defaultPluginData(NO_GIT).sync, { pullBefore: false, syncAfter: false });
  });

  it('are fresh copies, so editing one leaves the defaults alone', () => {
    const d = defaultPluginData(GIT);
    d.reminders.quiet.from = '21:00';
    assert.equal(DEFAULT_REMINDERS.quiet.from, '22:30');
  });
});

describe('loadPluginData', () => {
  it('keeps the view state of data.json from plugin 0.5 and adds the new options', () => {
    const { data, migrated } = loadPluginData({ lastTab: 'today', mode: 'hotel', pick: null, progressSection: 'body' }, GIT);
    assert.deepEqual({ lastTab: data.lastTab, mode: data.mode, pick: data.pick, progressSection: data.progressSection }, { lastTab: 'today', mode: 'hotel', pick: null, progressSection: 'body' });
    assert.deepEqual(data.reminders, DEFAULT_REMINDERS);
    assert.deepEqual(data.sync, { pullBefore: true, syncAfter: true });
    assert.equal(data.version, SETTINGS_VERSION);
    assert.equal(migrated, true);
  });

  it('reads the oldest shape (the tab and the mode) and a day’s pick', () => {
    assert.equal(loadPluginData({ lastTab: 'plan', mode: 'express' }, NO_GIT).data.pick, null);
    const { data } = loadPluginData({ lastTab: 'checkin', mode: 'full', pick: { date: '2026-04-10', type: 'S3' } }, NO_GIT);
    assert.deepEqual([data.lastTab, data.pick], ['checkin', { date: '2026-04-10', type: 'S3' }]);
  });

  it('fills a partial group and keeps what was chosen, even against the git default', () => {
    const { data } = loadPluginData({ version: 2, lastTab: 'today', mode: 'full', pick: null, reminders: { on: false, quiet: { from: '23:00' } }, sync: { pullBefore: false } }, GIT);
    assert.equal(data.reminders.on, false);
    assert.equal(data.reminders.notifications, true);
    assert.deepEqual(data.reminders.quiet, { on: true, from: '23:00', to: '07:00' });
    assert.deepEqual(data.sync, { pullBefore: false, syncAfter: true });
  });

  it('keeps the evening card’s time, and a malformed one falls back to 20:00', () => {
    assert.equal(loadPluginData({ version: 2, reminders: { didYouTrainAt: '19:15' } }, GIT).data.reminders.didYouTrainAt, '19:15');
    assert.equal(loadPluginData({ version: 2, reminders: { didYouTrainAt: '8pm' } }, GIT).data.reminders.didYouTrainAt, '20:00');
    // data.json from 0.6.5 has no time: it gains 20:00 and is saved once.
    const old = loadPluginData({ ...defaultPluginData(GIT), reminders: { on: true, notifications: true, snoozeMinutes: 30, quiet: { on: true, from: '22:30', to: '07:00' }, didYouTrain: true } }, GIT);
    assert.deepEqual([old.data.reminders.didYouTrainAt, old.migrated], ['20:00', true]);
  });

  it('gives the reminder rules the card’s time', async () => {
    const { nudgeSettings } = await import('../src/reminders/machine.ts');
    const d = defaultPluginData(GIT);
    d.reminders.didYouTrainAt = '21:30';
    assert.deepEqual(nudgeSettings(d).didYouTrain, { on: true, at: '21:30' });
  });

  it('replaces malformed values with the defaults', () => {
    const { data } = loadPluginData({ lastTab: 'habits', mode: 'weird', pick: 'A', progressSection: 'photos', reminders: { snoozeMinutes: 45, quiet: { on: 'yes', from: '25:00', to: '7:00' }, didYouTrain: 1 }, sync: 'on' }, NO_GIT);
    assert.deepEqual([data.lastTab, data.mode, data.pick, data.progressSection], ['today', 'full', null, undefined]);
    assert.deepEqual(data.reminders, DEFAULT_REMINDERS);
    assert.deepEqual(data.sync, { pullBefore: false, syncAfter: false });
    assert.deepEqual(loadPluginData(null, NO_GIT).data, defaultPluginData(NO_GIT));
  });

  it('does not ask for a save when the stored data is already current, in any key order', () => {
    const saved = JSON.parse(JSON.stringify(defaultPluginData(GIT)));
    assert.equal(loadPluginData(saved, GIT).migrated, false);
    const reordered = Object.fromEntries(Object.entries(saved).reverse());
    assert.equal(loadPluginData(reordered, GIT).migrated, false);
  });

  it('keeps the folders setting; data.json without it has none, so the plugin looks for the folders once', () => {
    const saved = { ...JSON.parse(JSON.stringify(defaultPluginData(GIT))), folders: { fitness: 'Personal/Training/', habits: 'Data/habits-data.json' } };
    assert.deepEqual(loadPluginData(saved, GIT).data.folders, { fitness: 'Personal/Training', habits: 'Data/habits-data.json' });
    assert.equal(loadPluginData(defaultPluginData(GIT), GIT).data.folders, undefined);
    assert.equal(loadPluginData({ ...defaultPluginData(GIT), folders: { fitness: '' } }, GIT).data.folders, undefined, 'an empty folder is no setting');
  });
});

describe('each Progress view\'s range (this cycle or all)', () => {
  it('is this cycle by default for every view, and always for Habits', () => {
    const d = defaultPluginData(GIT);
    assert.equal(d.progressScopes, undefined);
    for (const v of ['overview', 'training', 'body', 'health', 'skills', 'habits'] as const) assert.equal(progressScope(d, v), 'cycle');
    assert.equal(progressScope({ progressScopes: { training: 'all' } }, 'habits'), 'cycle');
  });

  it('remembers All per view, and stores the default as nothing', () => {
    const st: PahlavanSettings = structuredClone(DEFAULT_SETTINGS);
    setProgressScope(st, 'body', 'all');
    setProgressScope(st, 'training', 'all');
    assert.deepEqual(st.progressScopes, { body: 'all', training: 'all' });
    assert.deepEqual([progressScope(st, 'body'), progressScope(st, 'training'), progressScope(st, 'overview')], ['all', 'all', 'cycle']);
    setProgressScope(st, 'body', 'cycle');
    assert.deepEqual(st.progressScopes, { training: 'all' });
    setProgressScope(st, 'training', 'cycle');
    assert.equal('progressScopes' in st, false);
  });

  it('survives data.json: valid choices kept, the default and anything unknown dropped', () => {
    const { data, migrated } = loadPluginData({ ...defaultPluginData(GIT), progressScopes: { overview: 'all', health: 'cycle', habits: 'all', skills: 'everything', body: 'all' } }, GIT);
    assert.deepEqual(data.progressScopes, { overview: 'all', body: 'all' });
    assert.equal(migrated, true, 'the cleaned choices are saved once');
    const again = loadPluginData(data, GIT);
    assert.deepEqual([again.data.progressScopes, again.migrated], [{ overview: 'all', body: 'all' }, false]);
    assert.equal(loadPluginData({ ...defaultPluginData(GIT), progressScopes: 'all' }, GIT).data.progressScopes, undefined);
  });
});

describe('inQuietHours', () => {
  const q = { on: true, from: '22:30', to: '07:00' };
  it('wraps a window that crosses midnight, the end excluded', () => {
    assert.deepEqual(['22:29', '22:30', '23:59', '00:00', '06:59', '07:00', '12:00'].map((t) => inQuietHours(q, t)), [false, true, true, true, true, false, false]);
  });
  it('holds a same-day window, and nothing when off', () => {
    assert.deepEqual(['12:59', '13:00', '13:59', '14:00'].map((t) => inQuietHours({ on: true, from: '13:00', to: '14:00' }, t)), [false, true, true, false]);
    assert.equal(inQuietHours({ ...q, on: false }, '23:00'), false);
  });
});

describe('Remind on this Mac', () => {
  it('is on until this Mac turns it off, in local storage only', () => {
    const m = new Map<string, string>();
    const store = { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v) };
    assert.equal(remindHere(store), true);
    setRemindHere(store, false);
    assert.deepEqual([remindHere(store), m.get(REMIND_HERE_KEY)], [false, 'off']);
    setRemindHere(store, true);
    assert.equal(remindHere(store), true);
    assert.equal('remindHere' in defaultPluginData(GIT), false);
  });
});

describe('today’s swaps from the chips', () => {
  it('are remembered for one day, by the plan’s item, and undone one by one', async () => {
    const { chooseSwap, swapsFor } = await import('../src/pick.ts');
    let s = chooseSwap(null, '2026-04-10', 'Romanian Deadlift', 'Hamstring Curl');
    assert.deepEqual(swapsFor(s, '2026-04-10'), { 'Romanian Deadlift': 'Hamstring Curl' });
    assert.deepEqual(swapsFor(s, '2026-04-11'), {}, 'another day has none');
    s = chooseSwap(s, '2026-04-10', 'Romanian Deadlift', null);
    assert.equal(s, null);
    const loaded = loadPluginData({ version: 2, swaps: { date: '2026-04-10', by: { 'Romanian Deadlift': 'Hamstring Curl', bad: 3 } } }, GIT).data;
    assert.deepEqual(loaded.swaps, { date: '2026-04-10', by: { 'Romanian Deadlift': 'Hamstring Curl' } });
  });
});
