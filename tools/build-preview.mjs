// Builds the plugin's static preview: plugin/preview/dist/preview.js, the real
// view bundled with a stubbed `obsidian` module and the synthetic vault's
// files inlined. Open plugin/preview/index.html (file:// works).
// tools/build-demo.mjs builds the public Try it page from the same harness.

import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PREVIEW_BUILD, fixtureScript, previewFiles } from './preview-files.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const data = previewFiles(root);
mkdirSync(join(root, 'plugin/preview/dist'), { recursive: true });
writeFileSync(join(root, 'plugin/preview/dist/fixture-files.js'), fixtureScript(data));

await build({ ...PREVIEW_BUILD, absWorkingDir: root, outfile: 'plugin/preview/dist/preview.js' });
console.log(`built plugin/preview/dist (${Object.keys(data.files).length} fixture files)`);
