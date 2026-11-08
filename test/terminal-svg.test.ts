// tools/terminal-svg.mjs --transcript: every coach line of a replay must be in
// the session it came from. A Claude Code session file (.jsonl) escapes the
// coach's quotes and line breaks, so it is parsed line by line and only the
// assistant's text counts; a plain-text transcript is read as it is.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { ROOT } from './helpers.ts';
// @ts-expect-error: a plain .mjs tool without type declarations
import { transcriptText, verify } from '../tools/terminal-svg.mjs';

const cast = {
  title: 'test',
  steps: [
    { user: 'I want "the plan" today' },
    { say: ['Your first session is **Tue 10 Nov**: session "A" · it\'s 3 lifts', '- Rest "90 s" between sets'] },
  ],
};

const jsonl = [
  { type: 'user', message: { role: 'user', content: 'I want "the plan" today' } },
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'echo "Rest 90 s"' } }] } },
  { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'Rest "90 s" between sets' }] } },
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Your first session is **Tue 10 Nov**: session "A" · it\'s 3 lifts.\n\n- Rest "90 s" between sets' }] } },
]
  .map((e) => JSON.stringify(e))
  .join('\n');

describe('terminal-svg: checking a replay against its transcript', () => {
  it('reads a .jsonl session as JSON: the assistant\'s text, quotes and line breaks as written', () => {
    const text = transcriptText(jsonl, 'session.jsonl');
    assert.match(text, /session "A" · it's 3 lifts\.\n\n- Rest "90 s" between sets/);
    // The user's words, the tool calls and the tool results are not the coach's.
    assert.doesNotMatch(text, /I want/);
    assert.doesNotMatch(text, /echo/);
    assert.deepEqual(verify(cast, text), []);
  });

  it('finds the quoted lines a raw match of the escaped file missed', () => {
    const missing = verify(cast, jsonl);
    assert.ok(missing.some((m: string) => m.includes('"A"')), 'the raw file escapes the quotes');
  });

  it('still says which coach lines are not in the session', () => {
    const other = { title: 't', steps: [{ say: ['Squat "heavy" on Monday'] }] };
    assert.deepEqual(verify(other, transcriptText(jsonl, 'a.JSONL')), ['Squat "heavy" on Monday']);
  });

  it('keeps a plain-text transcript working, and skips a line of a .jsonl that is not JSON', () => {
    const plain = 'Your first session is Tue 10 Nov: session "A" · it\'s 3 lifts\n- Rest "90 s" between sets';
    assert.equal(transcriptText(plain, 'notes.txt'), plain);
    assert.deepEqual(verify(cast, transcriptText(plain, 'notes.txt')), []);
    assert.deepEqual(verify(cast, transcriptText(`not json\n${jsonl}`, 's.jsonl')), []);
  });

  it('counts only the main session: a subagent\'s (sidechain) text is not the coach\'s', () => {
    const side = `${jsonl}\n${JSON.stringify({ type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'Squat "heavy" on Monday' }] } })}`;
    const other = { title: 't', steps: [{ say: ['Squat "heavy" on Monday'] }] };
    assert.deepEqual(verify(other, transcriptText(side, 's.jsonl')), ['Squat "heavy" on Monday']);
  });

  it('reads a .json export holding the events (a list, or under messages), and refuses any other JSON clearly', () => {
    const events = jsonl.split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(verify(cast, transcriptText(JSON.stringify(events), 'export.json')), []);
    assert.deepEqual(verify(cast, transcriptText(JSON.stringify({ messages: events }), 'export.json')), []);
    assert.throws(() => transcriptText('{"title": "a cast"}', 'cast.json'), /cast\.json is not a list of session events .*pass the session's \.jsonl file, or a plain-text transcript/);
    assert.throws(() => transcriptText('{ nope', 'x.json'), /x\.json is not valid JSON/);
  });

  it('the tool checks a .jsonl session from the command line, and fails on a line not in it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pahlavan-terminal-svg-'));
    try {
      writeFileSync(join(dir, 'cast.json'), JSON.stringify(cast));
      writeFileSync(join(dir, 'session.jsonl'), jsonl);
      const tool = join(ROOT, 'tools', 'terminal-svg.mjs');
      const ok = spawnSync(process.execPath, [tool, join(dir, 'cast.json'), '--out', join(dir, 'out.svg'), '--transcript', join(dir, 'session.jsonl')], { encoding: 'utf8' });
      assert.equal(ok.status, 0, ok.stderr);
      assert.match(ok.stdout, /every line is in the transcript/);
      writeFileSync(join(dir, 'cast.json'), JSON.stringify({ title: 't', steps: [{ say: ['Squat "heavy" on Monday'] }] }));
      const bad = spawnSync(process.execPath, [tool, join(dir, 'cast.json'), '--out', join(dir, 'out.svg'), '--transcript', join(dir, 'session.jsonl')], { encoding: 'utf8' });
      assert.equal(bad.status, 1);
      assert.match(bad.stderr, /not in the transcript \(1\):\n {2}Squat "heavy" on Monday/);
      writeFileSync(join(dir, 'other.json'), '{"title": "a cast"}');
      const refused = spawnSync(process.execPath, [tool, join(dir, 'cast.json'), '--out', join(dir, 'out.svg'), '--transcript', join(dir, 'other.json')], { encoding: 'utf8' });
      assert.equal(refused.status, 2);
      assert.match(refused.stderr, /^terminal-svg: .*other\.json is not a list of session events/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
