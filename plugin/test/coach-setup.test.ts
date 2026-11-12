// "Set up the coach": what setting up would write (missing and different
// files, the version there and the one carried, which of the two is newer),
// the write itself (folders made, each file read back, files already as
// carried left alone, nothing else touched, a newer coach never written
// over), the settings' row, and Node: 18 or later, looked for where a Mac
// has it.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compareVersions, coachVersion } from '../../src/core/version.ts';
import { COACH_DIR, coachRow, coachState, findNode, newerCoachLine, nodeOk, setUpCoach, versionOf, type CoachState } from '../src/coach-setup.ts';

const FILES = { 'SKILL.md': '# coach', 'references/log.md': '# log', 'scripts/engine.cjs': 'engine();', 'scripts/VERSION': 'engine 0.20.0\nschema 1\n' };

/** An in-memory vault adapter; `mkdir` records each folder made. */
function vault(files: Record<string, string> = {}) {
  const dirs = new Set<string>();
  const made: string[] = [];
  const writes: string[] = [];
  const isDir = (p: string) => dirs.has(p) || Object.keys(files).some((f) => f.startsWith(`${p}/`));
  return {
    files, made, writes,
    exists: async (p: string) => p in files || isDir(p),
    read: async (p: string) => {
      if (!(p in files)) throw new Error(`no ${p}`);
      return files[p]!;
    },
    list: async () => ({ files: [], folders: [] }),
    write: async (p: string, t: string) => {
      writes.push(p);
      files[p] = t;
    },
    mkdir: async (p: string) => {
      dirs.add(p);
      made.push(p);
    },
  };
}

describe('the coach set up from Pahlavan', () => {
  it('a vault without it: not set up, every file missing; setting up writes them all, folders first', async () => {
    const v = vault({ 'Fitness/plan-data.json': '{}' });
    const st = await coachState(v, FILES);
    assert.deepEqual([st.installed, st.bundled, st.missing.length, st.differ.length, st.direction], [null, '0.20.0', 4, 0, 'not-set-up']);
    const r = await setUpCoach(v, FILES);
    assert.deepEqual(r, { ok: true, written: Object.keys(FILES) });
    assert.deepEqual(v.made, ['.claude', '.claude/skills', '.claude/skills/fitness-coach', '.claude/skills/fitness-coach/references', '.claude/skills/fitness-coach/scripts']);
    assert.equal(v.files[`${COACH_DIR}/scripts/VERSION`], FILES['scripts/VERSION']);
    const again = await coachState(v, FILES);
    assert.deepEqual([again.installed, again.missing.length, again.differ.length, again.direction], ['0.20.0', 0, 0, 'same']);
  });

  it('an older version: the files that changed are listed and rewritten; the rest and the folder’s other files stay', async () => {
    const v = vault({
      [`${COACH_DIR}/SKILL.md`]: '# coach',
      [`${COACH_DIR}/references/log.md`]: '# old log',
      [`${COACH_DIR}/scripts/engine.cjs`]: 'old();',
      [`${COACH_DIR}/scripts/VERSION`]: 'engine 0.19.0\nschema 1\n',
      [`${COACH_DIR}/notes.md`]: 'my own notes',
    });
    const st = await coachState(v, FILES);
    assert.deepEqual([st.installed, st.missing, st.differ, st.direction], ['0.19.0', [], ['references/log.md', 'scripts/engine.cjs', 'scripts/VERSION'], 'coach-older']);
    const r = await setUpCoach(v, FILES);
    assert.deepEqual(r.written, ['references/log.md', 'scripts/engine.cjs', 'scripts/VERSION']);
    assert.equal(v.files[`${COACH_DIR}/notes.md`], 'my own notes');
    assert.ok(!v.writes.includes(`${COACH_DIR}/SKILL.md`), 'a file already as carried is not written again');
  });

  it('a write that does not read back stops there and says which', async () => {
    const v = vault();
    v.write = async (p: string, t: string) => {
      v.files[p] = p.endsWith('log.md') ? 'garbled' : t;
    };
    const r = await setUpCoach(v, FILES);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /references\/log\.md did not read back as written/);
    assert.deepEqual(r.written, ['SKILL.md']);
  });

  it('a skill newer than the plugin (set up by the other Mac’s newer Pahlavan): never written over, not even its missing files', async () => {
    const newer = {
      [`${COACH_DIR}/SKILL.md`]: '# newer coach',
      [`${COACH_DIR}/scripts/engine.cjs`]: 'newer();',
      [`${COACH_DIR}/scripts/VERSION`]: 'engine 0.21.0\nschema 1\n',
    };
    const v = vault({ ...newer });
    const st = await coachState(v, FILES);
    assert.deepEqual([st.installed, st.bundled, st.direction], ['0.21.0', '0.20.0', 'coach-newer']);
    assert.deepEqual(st.differ, ['SKILL.md', 'scripts/engine.cjs', 'scripts/VERSION']);
    const r = await setUpCoach(v, FILES);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, 'the coach in this vault (0.21.0) is newer than this Pahlavan\'s (0.20.0): update Pahlavan from Community plugins');
    assert.deepEqual([r.written, v.writes, v.made], [[], [], []], 'nothing written, no folder made');
    assert.deepEqual(v.files, newer);
    assert.equal(newerCoachLine('0.21.0', '0.20.0'), 'The coach in this vault (0.21.0) is newer than this Pahlavan\'s (0.20.0): update Pahlavan from Community plugins.');
  });

  it('the same version with files that differ: the user’s own edits, not an older coach', async () => {
    const v = vault({ ...Object.fromEntries(Object.entries(FILES).map(([k, t]) => [`${COACH_DIR}/${k}`, t])), [`${COACH_DIR}/references/log.md`]: '# my log notes' });
    const st = await coachState(v, FILES);
    assert.deepEqual([st.installed, st.direction, st.differ], ['0.20.0', 'same', ['references/log.md']]);
  });

  it('a skill folder without a VERSION file is set up, version unknown (older than any known version)', async () => {
    const st = await coachState(vault({ [`${COACH_DIR}/SKILL.md`]: '# hand-made' }), FILES);
    assert.equal(st.installed, 'unknown');
    assert.equal(st.direction, 'coach-older');
    assert.equal(versionOf('engine 0.20.0\nschema 1'), '0.20.0');
    assert.equal(versionOf(null), null);
  });
});

describe('the coach’s version against the one Pahlavan carries', () => {
  it('compares major, then minor, then patch, as numbers', () => {
    assert.ok(compareVersions('0.27.0', '0.28.0') < 0);
    assert.ok(compareVersions('0.28.0', '0.27.0') > 0);
    assert.ok(compareVersions('0.27.10', '0.27.9') > 0, 'not as text');
    assert.ok(compareVersions('1.0.0', '0.99.99') > 0);
    assert.equal(compareVersions('0.27.0', 'v0.27.0'), 0);
    assert.ok(compareVersions('unknown', '0.1.0') < 0, 'an unreadable version is older than any');
    assert.equal(compareVersions('unknown', null), 0);
  });

  it('four states: not set up, the same, the coach older, the coach newer', () => {
    assert.deepEqual([coachVersion(null, '0.27.0'), coachVersion('0.27.0', '0.27.0'), coachVersion('0.26.3', '0.27.0'), coachVersion('0.28.0', '0.27.0'), coachVersion('unknown', '0.27.0')], ['not-set-up', 'same', 'coach-older', 'coach-newer', 'coach-older']);
  });

  it('the settings’ row: set up or update when older, no button when newer, restore only at the same version', () => {
    const st = (over: Partial<CoachState>): CoachState => ({ installed: '0.20.0', bundled: '0.20.0', missing: [], differ: [], direction: 'same', ...over });
    assert.deepEqual(coachRow(st({ installed: null, direction: 'not-set-up', missing: ['SKILL.md'] })), { line: `Not set up in this vault. The coach is a Claude Code skill (/fitness-coach); this writes it into ${COACH_DIR}.`, button: 'Set up the coach' });
    assert.deepEqual(coachRow(st({})), { line: 'Set up, version 0.20.0. In Claude Code, open this vault and run /fitness-coach.', button: null });
    assert.deepEqual(coachRow(st({ installed: '0.19.0', direction: 'coach-older', differ: ['scripts/engine.cjs', 'scripts/VERSION'] })), { line: 'Version 0.19.0 is set up; this Pahlavan carries 0.20.0. 2 of its files differ and will be replaced.', button: 'Update the coach' });
    assert.deepEqual(coachRow(st({ installed: '0.21.0', direction: 'coach-newer', differ: ['scripts/engine.cjs'] })), { line: 'The coach in this vault (0.21.0) is newer than this Pahlavan\'s (0.20.0): update Pahlavan from Community plugins.', button: null });
    assert.deepEqual(coachRow(st({ differ: ['references/log.md'] })), { line: 'Set up, version 0.20.0. 1 of its files differs from this Pahlavan\'s copy (your own edits, perhaps).', button: 'Restore its files' });
    assert.deepEqual(coachRow(st({ missing: ['SKILL.md', 'references/log.md'], differ: ['scripts/engine.cjs'] })), { line: 'Set up, version 0.20.0. 2 of its files are missing and 1 differs from this Pahlavan\'s copy (your own edits, perhaps).', button: 'Restore its files' });
    for (const d of ['not-set-up', 'same', 'coach-older', 'coach-newer'] as const) assert.doesNotMatch(coachRow(st({ direction: d, installed: d === 'not-set-up' ? null : '0.20.0' })).line, /—/);
  });
});

describe('Node for the coach’s engine', () => {
  it('18 or later', () => {
    assert.deepEqual(['v22.11.0', 'v18.0.0', 'v16.20.2', 'nonsense', null].map(nodeOk), [true, true, false, false, false]);
  });

  it('the app’s PATH first, then Homebrew’s and Volta’s places, then the login shell', async () => {
    const tried: string[] = [];
    const run = (answers: Record<string, string>) => async (file: string, args: string[]) => {
      tried.push(`${file} ${args.join(' ')}`);
      return answers[`${file} ${args.join(' ')}`] ?? null;
    };
    assert.deepEqual(await findNode(run({ '/opt/homebrew/bin/node --version': 'v22.1.0\n' }), '/Users/x'), { path: '/opt/homebrew/bin/node', version: 'v22.1.0' });
    assert.deepEqual(tried, ['node --version', '/opt/homebrew/bin/node --version']);
    const viaShell = await findNode(run({ '/bin/zsh -lc command -v node': '/Users/x/.nvm/versions/node/v20.0.0/bin/node\n', '/Users/x/.nvm/versions/node/v20.0.0/bin/node --version': 'v20.0.0' }), '/Users/x');
    assert.deepEqual(viaShell, { path: '/Users/x/.nvm/versions/node/v20.0.0/bin/node', version: 'v20.0.0' });
    assert.equal(await findNode(run({}), null), null);
  });
});
