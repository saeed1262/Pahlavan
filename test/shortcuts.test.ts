// The phone shortcuts (tools/shortcuts/build.mjs): both files build, with the
// action counts the README's import notes were checked against, every action
// output a step refers to exists, and no token is written into either file.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

const ROOT = join(import.meta.dirname, '..');
const FILES = { 'Pahlavan.shortcut': 295, 'Health to Pahlavan.shortcut': 107 };

describe('phone shortcuts', () => {
  let out = '';
  let stdout = '';
  const read = (name: string) => readFileSync(join(out, name), 'utf8');

  before(() => {
    out = mkdtempSync(join(tmpdir(), 'pahlavan-shortcuts-'));
    process.on('exit', () => rmSync(out, { recursive: true, force: true }));
    const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'shortcuts', 'build.mjs'),
      '--repo', 'someone/vault', '--inbox', '/3-Personal/Fitness/Coach/Inbox/', '--out', out], { encoding: 'utf8', cwd: ROOT });
    assert.equal(r.status, 0, r.stderr);
    stdout = r.stdout;
  });

  it('writes the two files as XML plists', () => {
    assert.deepEqual(readdirSync(out).sort(), Object.keys(FILES).sort());
    for (const name of Object.keys(FILES)) {
      const xml = read(name);
      assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist'), name);
      assert.ok(xml.endsWith('</dict>\n</plist>\n'), name);
    }
  });

  it('has the expected number of actions in each', () => {
    for (const [name, count] of Object.entries(FILES)) {
      assert.equal(read(name).split('<key>WFWorkflowActionIdentifier</key>').length - 1, count, name);
      assert.match(stdout, new RegExp(`${name} \\(${count} actions, `));
    }
  });

  it('points every request at the inbox folder', () => {
    const xml = read('Pahlavan.shortcut');
    assert.ok(xml.includes('<string>https://api.github.com/repos/someone/vault/contents/3-Personal/Fitness/Coach/Inbox/phone.json</string>'));
    assert.doesNotMatch(xml, /Inbox\/\/|contents\/\//);
  });

  it('refers only to action outputs that exist, and closes every group it opens', () => {
    const ids = (xml: string, key: string) => [...xml.matchAll(new RegExp(`<key>${key}</key>\\n\\t*<string>([0-9A-F-]{36})</string>`, 'g'))].map((m) => m[1]);
    for (const name of Object.keys(FILES)) {
      const xml = read(name);
      const actions = new Set(ids(xml, 'UUID'));
      assert.equal(actions.size, FILES[name as keyof typeof FILES], `${name}: one UUID per action`);
      for (const u of ids(xml, 'OutputUUID')) assert.ok(actions.has(u), `${name}: output of a missing action ${u}`);
      const groups = new Map<string, number>();
      for (const g of ids(xml, 'GroupingIdentifier')) groups.set(g!, (groups.get(g!) ?? 0) + 1);
      assert.ok(groups.size > 0, `${name}: no groups found`);
      for (const [g, n] of groups) assert.ok(n >= 2, `${name}: group ${g} is never closed`);
    }
  });

  it('holds no token', () => {
    for (const name of Object.keys(FILES)) assert.doesNotMatch(read(name), /github_pat|ghp_/, name);
  });
});
