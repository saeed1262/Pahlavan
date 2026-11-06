// The core must run anywhere (an Obsidian plugin on a phone, the Node CLI), so
// it may not touch Node, Obsidian or the DOM, and must stay deterministic.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { ROOT } from './helpers.ts';

const CORE = join(ROOT, 'src', 'core');
const files = readdirSync(CORE, { recursive: true })
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({ name: f, text: readFileSync(join(CORE, f), 'utf8') }));

describe('core purity', () => {
  it('finds the core files', () => {
    assert.ok(files.length >= 10);
  });

  it('mentions no Node, file system, Obsidian or DOM APIs', () => {
    const banned = [/node:/i, /\bfs\b/i, /obsidian/i, /\bdocument\b/i, /\bwindow\b/i];
    for (const { name, text } of files) {
      for (const re of banned) assert.doesNotMatch(text, re, `${name} matches ${re}`);
    }
  });

  it('imports only other core modules', () => {
    for (const { name, text } of files) {
      const depth = name.split('/').length - 1; // 0 in src/core, 1 in src/core/data
      for (const m of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1]!;
        assert.match(spec, /^\.{1,2}\/([a-z0-9-]+\/)?[a-z0-9-]+\.ts$/, `${name} imports ${spec}`);
        const ups = spec.split('/').filter((p) => p === '..').length;
        assert.ok(ups <= depth, `${name} reaches outside src/core with ${spec}`);
      }
      assert.doesNotMatch(text, /\bimport\s*\(|\brequire\s*\(/, `${name} loads modules dynamically`);
    }
  });

  it('never reads the clock, randomness, the process or globals', () => {
    const banned = [/Date\.now/, /new Date\(\s*\)/, /Math\.random/, /\bprocess\b/, /globalThis/, /\bfetch\s*\(/];
    for (const { name, text } of files) {
      for (const re of banned) assert.doesNotMatch(text, re, `${name} matches ${re}`);
    }
  });
});
