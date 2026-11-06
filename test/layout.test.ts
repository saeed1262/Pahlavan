// Where a vault keeps Pahlavan's files: the layout built from one fitness
// folder, the folders in the plugin's settings, the search a vault without
// the setting gets, and a fresh vault in the default folder read end to end
// (the same data as the synthetic vault in an older install's folders).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_FOLDERS, findFolders, foldersFrom, layoutOf, paths, resolveFolders, useFolders, type Children } from '../src/adapters/vault/layout.ts';
import { readVault } from '../src/adapters/vault/read.ts';
import { readTracking } from '../src/adapters/vault/tracking-read.ts';
import { run } from '../src/cli/cli.ts';
import { buildToday } from '../src/report/index.ts';
import { FIXTURE_FOLDERS, fixtureFiles, memoryIo } from './helpers.ts';

type Json = Record<string, any>;
const DATE = '2026-04-10';

/** A memory vault's children, as the CLI's search sees them. */
function childrenOf(files: Record<string, string>, root = 'v'): Children {
  return (dir) => {
    const at = dir === '' ? root : `${root}/${dir}`;
    const under = Object.keys(files).filter((f) => f.startsWith(`${at}/`)).map((f) => f.slice(at.length + 1));
    if (!under.length) return null;
    return { files: [...new Set(under.filter((u) => !u.includes('/')))], folders: [...new Set(under.filter((u) => u.includes('/')).map((u) => u.split('/')[0]!))] };
  };
}

/** The synthetic vault moved to a fresh vault's layout: everything in Fitness/, the habit check-ins beside the plan, no work timer. */
function freshFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fixtureFiles('v'))) {
    if (k.startsWith('v/3-Personal/Fitness/')) out[`v/Fitness/${k.slice('v/3-Personal/Fitness/'.length)}`] = v;
    else if (k === 'v/5-System/Data/habits-data.json') out['v/Fitness/habits-data.json'] = v;
    else if (!k.startsWith('v/5-System/')) out[k] = v;
  }
  return out;
}

describe('the layout', () => {
  it('a new vault: every file under Fitness, the habit check-ins beside the plan, no work timer', () => {
    const l = layoutOf(DEFAULT_FOLDERS);
    assert.deepEqual([l.fitness, l.plan, l.log, l.body, l.habits], ['Fitness', 'Fitness/plan-data.json', 'Fitness/fitness-log-data.json', 'Fitness/body-data.json', 'Fitness/habits-data.json']);
    assert.deepEqual([l.profile, l.tracking, l.inbox, l.letters, l.decisions, l.help, l.photos, l.guide], [
      'Fitness/Coach/profile.json', 'Fitness/Coach/tracking.json', 'Fitness/Coach/Inbox', 'Fitness/Coach/Letters', 'Fitness/Coach/Decisions.md', 'Fitness/Coach/help.json', 'Fitness/Progress Photos', 'Fitness/Pahlavan guide.md',
    ]);
    assert.equal(l.workTimer, null);
  });

  it('a folder anywhere, the two files elsewhere; slashes at either end are dropped', () => {
    const l = layoutOf({ fitness: '/Personal/Training/', habits: 'Data/habits-data.json', workTimer: 'Data/work-timer-data.json' });
    assert.deepEqual([l.plan, l.habits, l.workTimer, l.eating], ['Personal/Training/plan-data.json', 'Data/habits-data.json', 'Data/work-timer-data.json', 'Personal/Training/Coach/eating-plan.json']);
    assert.equal(layoutOf({ fitness: '  ' }).fitness, 'Fitness', 'an empty folder is the default');
  });

  it('useFolders sets the layout every reader takes its paths from', () => {
    useFolders({ fitness: 'Training' });
    assert.equal(paths().plan, 'Training/plan-data.json');
    useFolders(FIXTURE_FOLDERS);
    assert.equal(paths().plan, '3-Personal/Fitness/plan-data.json');
  });
});

describe('the folders setting', () => {
  it('reads folders.fitness and the two optional files from data.json; anything else is no setting', () => {
    assert.deepEqual(foldersFrom(JSON.stringify({ lastTab: 'today', folders: { fitness: 'Training/', habits: 'Data/habits-data.json' } })), { fitness: 'Training', habits: 'Data/habits-data.json' });
    for (const bad of [null, '{ not json', '{}', '{"folders": "Fitness"}', '{"folders": {"fitness": ""}}', '{"folders": {"habits": "x.json"}}']) assert.equal(foldersFrom(bad), null, String(bad));
  });

  it('the setting wins over what the vault holds', () => {
    const files = { 'v/Fitness/plan-data.json': '{}', 'v/Training/plan-data.json': '{}' };
    assert.deepEqual(resolveFolders('{"folders": {"fitness": "Training"}}', childrenOf(files)), { folders: { fitness: 'Training' }, source: 'settings' });
  });
});

describe('looking for the folders (no setting)', () => {
  it('an empty vault: the default folder', () => {
    assert.deepEqual(findFolders(childrenOf({ 'v/Welcome.md': '' })), DEFAULT_FOLDERS);
    assert.equal(resolveFolders(null, childrenOf({ 'v/Welcome.md': '' })).source, 'default');
  });

  it('the synthetic vault: its fitness folder two down, the habit check-ins and the work timer where they are', () => {
    assert.deepEqual(findFolders(childrenOf(fixtureFiles('v'))), FIXTURE_FOLDERS);
    assert.equal(resolveFolders(null, childrenOf(fixtureFiles('v'))).source, 'found');
  });

  it('Fitness/ with a plan comes first; otherwise the first plan in name order; dot folders are not searched', () => {
    assert.equal(findFolders(childrenOf({ 'v/A/plan-data.json': '{}', 'v/Fitness/plan-data.json': '{}' })).fitness, 'Fitness');
    assert.equal(findFolders(childrenOf({ 'v/B/Gym/plan-data.json': '{}', 'v/A/Gym/plan-data.json': '{}' })).fitness, 'A/Gym');
    assert.deepEqual(findFolders(childrenOf({ 'v/.trash/Old/plan-data.json': '{}' })), DEFAULT_FOLDERS);
  });

  it('the habit check-ins beside the plan need no setting of their own', () => {
    assert.deepEqual(findFolders(childrenOf({ 'v/Gym/plan-data.json': '{}', 'v/Gym/habits-data.json': '{}', 'v/Other/habits-data.json': '{}' })), { fitness: 'Gym' });
  });
});

describe('a fresh vault in the default folder', () => {
  it('reads the same data as the synthetic vault in its older folders', () => {
    useFolders(FIXTURE_FOLDERS);
    const older = readVault(memoryIo(fixtureFiles('v'), DATE), 'v', { asOf: DATE });
    useFolders(DEFAULT_FOLDERS);
    const fresh = readVault(memoryIo(freshFiles(), DATE), 'v', { asOf: DATE });
    assert.deepEqual(fresh.files, older.files);
    assert.deepEqual(fresh.data, older.data);
    assert.equal(buildToday(fresh, DATE, 'full', 'v').session?.session?.type, buildToday(older, DATE, 'full', 'v').session?.session?.type);
    assert.equal(readTracking(memoryIo(freshFiles(), DATE), 'v').files.tracking, 'found');
  });

  it('the engine finds Fitness/ on its own, and a vault whose setting names another folder reads that one', () => {
    const review = (files: Record<string, string>) => {
      const r = run(['review', '--vault', 'v', '--date', DATE], memoryIo(files, DATE) as never);
      return { code: r.code, out: JSON.parse(r.stdout) as Json };
    };
    const older = review(fixtureFiles('v'));
    const fresh = review(freshFiles());
    assert.equal(fresh.code, 0, JSON.stringify(fresh.out.errors));
    assert.equal(paths().fitness, 'Fitness');
    assert.deepEqual(fresh.out.lifts, older.out.lifts);
    assert.deepEqual(fresh.out.adherence, older.out.adherence);

    const elsewhere: Record<string, string> = {};
    for (const [k, v] of Object.entries(freshFiles())) elsewhere[k.replace('v/Fitness/', 'v/Personal/Training/')] = v;
    elsewhere['v/.obsidian/plugins/pahlavan/data.json'] = JSON.stringify({ folders: { fitness: 'Personal/Training' } });
    const set = review(elsewhere);
    assert.equal(set.code, 0, JSON.stringify(set.out.errors));
    assert.equal(paths().plan, 'Personal/Training/plan-data.json');
    assert.deepEqual(set.out.lifts, older.out.lifts);
  });

  it('engine folders: the folders, where they came from, and every path', () => {
    const folders = (files: Record<string, string>) => JSON.parse(run(['folders', '--vault', 'v'], memoryIo(files, DATE) as never).stdout) as Json;
    const fresh = folders(freshFiles());
    assert.deepEqual([fresh.folders, fresh.source, fresh.paths.plan, fresh.paths.workTimer], [{ fitness: 'Fitness' }, 'found', 'Fitness/plan-data.json', null]);
    assert.equal(folders({ 'v/Welcome.md': '' }).source, 'default');
    const set = folders({ ...freshFiles(), 'v/.obsidian/plugins/pahlavan/data.json': JSON.stringify({ folders: { fitness: 'Fitness', habits: 'Data/h.json' } }) });
    assert.deepEqual([set.source, set.paths.habits, set.settings], ['settings', 'Data/h.json', '.obsidian/plugins/pahlavan/data.json']);
  });

  it('with no plan anywhere, the note names the default folder', () => {
    useFolders(DEFAULT_FOLDERS);
    const r = readVault(memoryIo({ 'v/Welcome.md': '' }, DATE), 'v', { asOf: DATE });
    assert.ok(r.data.errors.some((e) => e.message.includes('Fitness/plan-data.json was not found')));
  });
});
