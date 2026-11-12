// Write the Pahlavan phone shortcuts as unsigned files.
//
//   node tools/shortcuts/build.mjs --repo OWNER/NAME --inbox PATH/TO/Coach/Inbox --out DIR
//
// Then, on a Mac signed into iCloud: `shortcuts sign --mode anyone --input X --output Y` and open Y.
// No token goes into the files: each one runs the user's own "Pahlavan Token" shortcut.

import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { build as healthToPahlavan } from './health-to-pahlavan.mjs';
import { build as pahlavanMenu } from './pahlavan-menu.mjs';
import { save } from './shortcut.mjs';

const SHORTCUTS = [
  ['Pahlavan.shortcut', pahlavanMenu, { color: 4292093695, glyph: 59446, input: true }], // the gym page's Send hands it the session
  ['Health to Pahlavan.shortcut', healthToPahlavan, { color: 4282601983, glyph: 59784 }],
];

const USAGE = `usage: node tools/shortcuts/build.mjs --repo OWNER/NAME --inbox PATH --out DIR

Write the Pahlavan phone shortcuts as unsigned files.

  --repo   the vault's GitHub repository, OWNER/NAME
  --inbox  the inbox folder in the repository (Pahlavan's Settings > Phone)
  --out    where to write the files`;

function fail(message) {
  console.error(`${USAGE}\n\nbuild: ${message}`);
  process.exit(2);
}

let values;
try {
  ({ values } = parseArgs({
    options: { repo: { type: 'string' }, inbox: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
  }));
} catch (e) {
  fail(e.message);
}
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
const missing = ['repo', 'inbox', 'out'].filter((k) => !values[k]);
if (missing.length) fail(`the following arguments are required: ${missing.map((k) => `--${k}`).join(', ')}`);

const url = `https://api.github.com/repos/${values.repo}/contents/${values.inbox.replace(/^\/+|\/+$/g, '')}/`;
mkdirSync(values.out, { recursive: true });
for (const [name, build, icon] of SHORTCUTS) {
  const actions = build(url);
  const path = join(values.out, name);
  save(path, actions, icon);
  console.log(`wrote ${path} (${actions.length} actions, ${statSync(path).size} bytes)`);
}
