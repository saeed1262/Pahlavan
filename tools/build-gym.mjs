// Builds the gym page: dist/gym/index.html, one self-contained file (the
// template web/gym/index.html with its CSS, and web/gym/page.ts bundled,
// minified and inlined), to publish as the page's index.html. It loads
// nothing else and sends nothing anywhere.
//
// `--sample` also prints a link to the built file with the made-up sample
// day after its `#` (web/gym/sample.ts), to open in a browser.

import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'dist/gym/index.html');
const MARK = '<!--gym-script-->';

const result = await build({
  absWorkingDir: root,
  entryPoints: ['web/gym/page.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
});
// Inside a <script>, "</script" would end it early.
const js = result.outputFiles[0].text.trim().replace(/<\/script/gi, '<\\/script');
const template = readFileSync(join(root, 'web/gym/index.html'), 'utf8');
if (!template.includes(MARK)) throw new Error(`web/gym/index.html has no ${MARK}`);
// A function, so `$` in the bundle is never read as a replacement pattern.
const html = template.replace(MARK, () => `<script>${js}</script>`);
mkdirSync(join(root, 'dist/gym'), { recursive: true });
writeFileSync(out, html);
console.log(`built dist/gym/index.html (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);

if (process.argv.includes('--sample')) {
  const { SAMPLE } = await import(pathToFileURL(join(root, 'web/gym/sample.ts')).href);
  const { gymLink } = await import(pathToFileURL(join(root, 'src/core/gym.ts')).href);
  console.log(gymLink(SAMPLE, pathToFileURL(out).href));
}
