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

// The engine and the plugin serve any vault: their text and comments never
// send anyone to a script only one vault has (the log and plan scripts it
// had before Pahlavan); the engine's own commands do that work.
describe('no vault-local script names', () => {
  const sources = ['src', join('plugin', 'src')].flatMap((dir) =>
    readdirSync(join(ROOT, dir), { recursive: true })
      .filter((f) => f.endsWith('.ts'))
      .map((f) => ({ name: join(dir, f), text: readFileSync(join(ROOT, dir, f), 'utf8') })),
  );

  it('finds the engine and plugin sources', () => {
    assert.ok(sources.some((f) => f.name.startsWith('src')) && sources.some((f) => f.name.startsWith(join('plugin', 'src'))));
    assert.ok(sources.length >= 50);
  });

  it('names neither fitness_log.py nor gen-fitness-plan anywhere under src/ or plugin/src/', () => {
    for (const { name, text } of sources) {
      for (const re of [/fitness_log\.py/, /gen-fitness-plan/]) assert.doesNotMatch(text, re, `${name} matches ${re}`);
    }
  });
});
