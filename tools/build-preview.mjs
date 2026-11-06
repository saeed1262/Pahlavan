// Builds the plugin's static preview: plugin/preview/dist/preview.js, the real
// view bundled with a stubbed `obsidian` module and the synthetic vault's
// files inlined. Open plugin/preview/index.html (file:// works).

import { build } from 'esbuild';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const vault = join(root, 'test/fixtures/vault');
const files = {};
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name !== 'expected.json') files[relative(vault, p)] = readFileSync(p, 'utf8');
  }
};
walk(vault);
// Made-up samples the preview's &rich=1 mode copies into the Coach folder in memory (the fixture has none).
const samples = { decisions: readFileSync(join(root, 'mockups/data/Decisions.md'), 'utf8'), letter: readFileSync(join(root, 'mockups/data/Letter-2026-04-05.md'), 'utf8') };
mkdirSync(join(root, 'plugin/preview/dist'), { recursive: true });
writeFileSync(join(root, 'plugin/preview/dist/fixture-files.js'), `window.PAHLAVAN_FIXTURE = ${JSON.stringify(files)};\nwindow.PAHLAVAN_SAMPLES = ${JSON.stringify(samples)};\n`);

await build({
  absWorkingDir: root,
  entryPoints: ['plugin/preview/preview.ts'],
  outfile: 'plugin/preview/dist/preview.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  alias: { obsidian: './plugin/preview/obsidian-stub.ts' },
  legalComments: 'none',
  logLevel: 'warning',
});
console.log(`built plugin/preview/dist (${Object.keys(files).length} fixture files)`);
