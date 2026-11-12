// The preview harness's inlined data, shared by its two builds (tools/build-preview.mjs and
// tools/build-demo.mjs): every file of the synthetic vault, and the made-up samples the
// harness's &rich=1 mode copies into the Coach folder in memory (the fixture has none).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** What a file manager leaves in a folder it shows (macOS's Finder, Windows' Explorer): never part of the vault. */
const LITTER = /^(\.DS_Store|\._.*|Thumbs\.db|desktop\.ini)$/i;

/**
 * The fixture vault's files ({ path: text }) and the samples, as `window.PAHLAVAN_FIXTURE` and `PAHLAVAN_SAMPLES`.
 * Its config folder (`.obsidian`) is part of it; a file manager's litter isn't, nor the tests' expected.json.
 */
export function previewFiles(root) {
  const vault = join(root, 'test/fixtures/vault');
  const files = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name !== 'expected.json' && !LITTER.test(name)) files[relative(vault, p)] = readFileSync(p, 'utf8');
    }
  };
  walk(vault);
  const samples = { decisions: readFileSync(join(root, 'test/fixtures/decisions-sample.md'), 'utf8'), letter: readFileSync(join(root, 'test/fixtures/letter-sample.md'), 'utf8') };
  return { files, samples };
}

/**
 * The script that hands them to the harness. Every `<` is written as `<` (the same string to
 * JavaScript), so a note's own `<!--` or `</script>` can't end or re-open the page's inline script.
 */
export function fixtureScript({ files, samples }) {
  const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
  return `window.PAHLAVAN_FIXTURE = ${json(files)};\nwindow.PAHLAVAN_SAMPLES = ${json(samples)};\n`;
}

/** The esbuild options both builds share: the real view, with `obsidian` swapped for the stub. */
export const PREVIEW_BUILD = {
  entryPoints: ['plugin/preview/preview.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  alias: { obsidian: './plugin/preview/obsidian-stub.ts' },
  legalComments: 'none',
  // Obsidian's globals for the page: the view's DOM builders draw on activeDocument.
  banner: { js: 'window.activeDocument = document; window.activeWindow = window;' },
  logLevel: 'warning',
};
