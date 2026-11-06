// "Set up the coach": what setting up would write (missing and different
// files, the version there and the one carried), the write itself (folders
// made, each file read back, files already as carried left alone, nothing
// else touched), and Node: 18 or later, looked for where a Mac has it.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COACH_DIR, coachState, findNode, nodeOk, setUpCoach, versionOf } from '../src/coach-setup.ts';

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
    assert.deepEqual([st.installed, st.bundled, st.missing.length, st.differ.length], [null, '0.20.0', 4, 0]);
    const r = await setUpCoach(v, FILES);
    assert.deepEqual(r, { ok: true, written: Object.keys(FILES) });
    assert.deepEqual(v.made, ['.claude', '.claude/skills', '.claude/skills/fitness-coach', '.claude/skills/fitness-coach/references', '.claude/skills/fitness-coach/scripts']);
    assert.equal(v.files[`${COACH_DIR}/scripts/VERSION`], FILES['scripts/VERSION']);
    const again = await coachState(v, FILES);
    assert.deepEqual([again.installed, again.missing.length, again.differ.length], ['0.20.0', 0, 0]);
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
    assert.deepEqual([st.installed, st.missing, st.differ], ['0.19.0', [], ['references/log.md', 'scripts/engine.cjs', 'scripts/VERSION']]);
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

  it('a skill folder without a VERSION file is set up, version unknown', async () => {
    const st = await coachState(vault({ [`${COACH_DIR}/SKILL.md`]: '# hand-made' }), FILES);
    assert.equal(st.installed, 'unknown');
    assert.equal(versionOf('engine 0.20.0\nschema 1'), '0.20.0');
    assert.equal(versionOf(null), null);
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
