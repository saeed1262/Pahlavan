// Builds the plugin, then copies main.js, manifest.json and styles.css into
// the given plugin folder (created if needed). The folder must be named
// after the plugin id, so a slip cannot write anywhere else in a vault.
//   npm run ship-plugin -- <vault>/.obsidian/plugins/pahlavan

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = process.argv[2];
if (!target) {
  console.error('usage: npm run ship-plugin -- <vault>/.obsidian/plugins/pahlavan');
  process.exit(2);
}
const dir = resolve(process.env.INIT_CWD ?? process.cwd(), target);
if (basename(dir) !== 'pahlavan') {
  console.error(`refusing to ship into ${dir}: the folder must be named "pahlavan"`);
  process.exit(2);
}
const root = fileURLToPath(new URL('..', import.meta.url));
execFileSync('node', [join(root, 'tools/build-plugin.mjs')], { stdio: 'inherit' });
mkdirSync(dir, { recursive: true });
for (const f of ['main.js', 'manifest.json', 'styles.css']) copyFileSync(join(root, 'plugin/dist', f), join(dir, f));
console.log(`shipped main.js, manifest.json and styles.css to ${dir}`);
