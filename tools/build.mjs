// Two builds from one source:
//   dist/pahlavan.js  the ESM library, platform neutral (later inlined into the plugin's main.js)
//   dist/engine.cjs   the Node CLI (later shipped in the skill's scripts/)
//
// `--out <dir>` builds into another folder instead of dist/ (the CLI tests
// each build their own copy, so two test files never delete each other's).
// The files are built in a fresh folder beside the target and moved into
// place, so the target is never half-written.

import { build } from 'esbuild';
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const banner = `// pahlavan ${pkg.version} | Elastic License 2.0 | https://www.elastic.co/licensing/elastic-license`;

const at = process.argv.indexOf('--out');
const out = at >= 0 && process.argv[at + 1] ? resolve(process.argv[at + 1]) : join(root, 'dist');
const tmp = `${out}.tmp-${process.pid}`;
rmSync(tmp, { recursive: true, force: true });
mkdirSync(dirname(out), { recursive: true });

const common = { absWorkingDir: root, bundle: true, legalComments: 'none', logLevel: 'warning' };

await build({
  ...common,
  entryPoints: ['src/index.ts'],
  outfile: join(tmp, 'pahlavan.js'),
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  banner: { js: banner },
});

await build({
  ...common,
  entryPoints: ['src/cli/engine.ts'],
  outfile: join(tmp, 'engine.cjs'),
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  banner: { js: `#!/usr/bin/env node\n${banner}` },
});

chmodSync(join(tmp, 'engine.cjs'), 0o755);
rmSync(out, { recursive: true, force: true });
renameSync(tmp, out);
console.log(`built ${out === join(root, 'dist') ? 'dist' : out}/pahlavan.js and engine.cjs`);
