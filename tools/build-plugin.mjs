// Builds the Obsidian plugin: plugin/dist/main.js (CommonJS, `obsidian`
// external) from plugin/src/main.ts and the engine's TypeScript sources,
// with manifest.json (at the repository's root, where Obsidian's directory
// reads it) and plugin/styles.css copied beside it.

import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const engine = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// The coach skill the plugin carries ("Set up the coach"): skill/'s files, and
// the engine built now (scripts/engine.cjs) with its VERSION file.
const built = spawnSync(process.execPath, [join(root, 'tools', 'build.mjs')], { cwd: root, encoding: 'utf8' });
if (built.status !== 0) {
  console.error(built.stdout + built.stderr);
  process.exit(built.status ?? 1);
}
const engineFile = join(root, 'dist', 'engine.cjs');
const ver = JSON.parse(spawnSync(process.execPath, [engineFile, '--version', '--json'], { encoding: 'utf8' }).stdout);
const coachFiles = {};
(function walk(dir) {
  for (const e of readdirSync(join(root, 'skill', dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) walk(rel);
    else coachFiles[rel] = readFileSync(join(root, 'skill', rel), 'utf8');
  }
})('');
coachFiles['scripts/engine.cjs'] = readFileSync(engineFile, 'utf8');
coachFiles['scripts/VERSION'] = `engine ${ver.engine}\nschema ${ver.schema}\n`;
const coachPlugin = {
  name: 'coach-files',
  setup(b) {
    b.onResolve({ filter: /^virtual:coach-files$/ }, (a) => ({ path: a.path, namespace: 'coach' }));
    b.onLoad({ filter: /.*/, namespace: 'coach' }, () => ({ contents: `export const COACH_FILES = ${JSON.stringify(coachFiles)};`, loader: 'js' }));
  },
};

rmSync(new URL('../plugin/dist', import.meta.url), { recursive: true, force: true });
mkdirSync(new URL('../plugin/dist', import.meta.url), { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: ['plugin/src/main.ts'],
  outfile: 'plugin/dist/main.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  plugins: [coachPlugin],
  legalComments: 'none',
  logLevel: 'warning',
  banner: {
    js: [
      `// Pahlavan ${manifest.version} (engine ${engine.version}) | Elastic License 2.0 | Saeed Ghorbani`,
      '// The body map\'s outlines and muscle shapes are react-native-body-highlighter\'s',
      '// (github.com/HichamELBSI/react-native-body-highlighter), Copyright (c) 2022',
      '// ELABBASSI Hicham, MIT License: the permission notice is in the source',
      '// (plugin/src/ui/body-map.ts) and the README.',
    ].join('\n'),
  },
});
copyFileSync(new URL('../manifest.json', import.meta.url), new URL('../plugin/dist/manifest.json', import.meta.url));
copyFileSync(new URL('../plugin/styles.css', import.meta.url), new URL('../plugin/dist/styles.css', import.meta.url));
console.log(`built plugin/dist (pahlavan ${manifest.version})`);
