// The plugin's stylesheet against the warnings Obsidian's community directory
// raises on a release's CSS: features its oldest supported Obsidian only
// partly supports (multi-column layout, text-decoration styling, display:
// contents, the ui-* system fonts, clip-path), !important, and :has. Each hit
// names its line, so a new one fails here before a release, not in the review.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const MULTICOLUMN = new Set(['column-gap', 'column-count', 'column-width', 'columns', 'column-rule', 'column-rule-color', 'column-rule-style', 'column-rule-width', 'column-span', 'column-fill', 'break-before', 'break-after', 'break-inside']);
const DECORATION = new Set(['text-decoration-color', 'text-decoration-style', 'text-decoration-thickness', 'text-decoration-line', 'text-decoration-skip', 'text-decoration-skip-ink']);

/** What the review would warn about in a stylesheet, one line each ("<line>: <what> (<the review's feature>)"). */
function scan(css: string): string[] {
  // Comments blanked, line breaks kept, so the line numbers still match.
  const code = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const out: string[] = [];
  code.split('\n').forEach((line, i) => {
    const n = i + 1;
    if (line.includes('!important')) out.push(`${n}: !important`);
    if (line.includes(':has(')) out.push(`${n}: :has()`);
    for (const part of line.split(/[{};]/)) {
      const m = /^\s*([a-z-]+)\s*:\s*(.*?)\s*$/.exec(part);
      if (!m) continue;
      const prop = m[1]!;
      const value = m[2]!.replace(/!important/, '').trim();
      if (MULTICOLUMN.has(prop)) out.push(`${n}: ${prop} (multicolumn; use gap)`);
      if (DECORATION.has(prop)) out.push(`${n}: ${prop} (text-decoration)`);
      if (prop === 'text-decoration' && value.split(/\s+/).length > 1) out.push(`${n}: text-decoration: ${value} (text-decoration; one keyword only)`);
      if (prop === 'display' && /\bcontents\b/.test(value)) out.push(`${n}: display: contents (css-display-contents)`);
      if ((prop === 'font-family' || prop === 'font') && /\bui-(monospace|serif|sans-serif|rounded)\b/.test(value)) out.push(`${n}: ${prop} with a ui-* font (extended-system-fonts)`);
      if (prop === 'clip-path') out.push(`${n}: clip-path (css-clip-path)`);
    }
  });
  return out;
}

describe('plugin/styles.css and the directory review', () => {
  it('uses none of the features the review warns about', () => {
    assert.deepEqual(scan(readFileSync(new URL('../styles.css', import.meta.url).pathname, 'utf8')), []);
  });

  it('catches each kind, and leaves comments, gap, grid-column and one-keyword decorations alone', () => {
    const css = [
      '.a { display: grid; gap: 0 12px; grid-column: span 2; text-decoration: underline; }',
      '.b { column-gap: 12px; text-decoration-color: red; }',
      '.c { text-decoration: underline dotted red; display: contents; }',
      '.d { font-family: var(--font-monospace, ui-monospace, monospace); clip-path: inset(50%); }',
      '.e:has(> svg) { display: none !important; }',
      '/* column-gap: 1px; :has( !important */ .f { color: red; }',
    ].join('\n');
    assert.deepEqual(scan(css), [
      '2: column-gap (multicolumn; use gap)',
      '2: text-decoration-color (text-decoration)',
      '3: text-decoration: underline dotted red (text-decoration; one keyword only)',
      '3: display: contents (css-display-contents)',
      '4: font-family with a ui-* font (extended-system-fonts)',
      '4: clip-path (css-clip-path)',
      '5: !important',
      '5: :has()',
    ]);
  });
});
