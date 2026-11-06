// npm run ship-skill -- <skill-dir> [--no-check] [--from <source-dir>]
// Builds, then installs the coach skill into <skill-dir>: its text and its
// self-check from this repository's skill/ folder (or --from <source-dir>,
// a draft elsewhere: SKILL.md, references/, scripts/selfcheck.mjs, over the
// folder's own copies; any other file there stays), and dist/engine.cjs as scripts/engine.cjs with a VERSION file (the
// engine and schema versions). The bundle has no runtime
// dependencies, so the skill runs it on any machine with Node, without this
// project. No vault path is built in: the caller names the skill folder.
//
// Then the skill's own self-check (<skill-dir>/scripts/selfcheck.mjs, when it
// has one) runs against the vault that holds the skill (<vault>/.claude/skills/<name>):
// every documented engine command, read only, and the docs against the engine.
// A failed check exits nonzero; the engine is shipped by then, so fix what it
// names and run the check again. --no-check skips it.

import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const noCheck = args.includes('--no-check');
const fromAt = args.indexOf('--from');
const from = fromAt >= 0 ? args[fromAt + 1] : null;
const rest = args.filter((a, i) => a !== '--no-check' && (fromAt < 0 || (i !== fromAt && i !== fromAt + 1)));
const unknown = rest.filter((a) => a.startsWith('-'));
const dirs = rest.filter((a) => !a.startsWith('-'));
if (unknown.length || dirs.length !== 1 || (fromAt >= 0 && (!from || from.startsWith('-')))) {
  if (unknown.length) console.error(`ship-skill: unknown option ${unknown.join(' ')}`);
  console.error('usage: npm run ship-skill -- <skill-dir> [--no-check] [--from <source-dir>]   (the folder holding SKILL.md; the source defaults to skill/)');
  process.exit(2);
}
// npm runs scripts from the package root; resolve the folder against where the caller ran npm.
const skill = resolve(process.env.INIT_CWD ?? process.cwd(), dirs[0]);
// An existing skill folder, or a new one inside a .claude/skills/ folder.
const fresh = !existsSync(skill) && basename(dirname(skill)) === 'skills' && basename(dirname(dirname(skill))) === '.claude';
if (!fresh && (!existsSync(skill) || !statSync(skill).isDirectory() || !existsSync(join(skill, 'SKILL.md')))) {
  console.error(`ship-skill: ${skill} is not a skill folder (no SKILL.md) nor a new one in a .claude/skills/ folder`);
  process.exit(2);
}

const node = process.execPath;
const build = spawnSync(node, [join(root, 'tools', 'build.mjs')], { cwd: root, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const engine = join(root, 'dist', 'engine.cjs');
const version = spawnSync(node, [engine, '--version', '--json'], { encoding: 'utf8' });
if (version.status !== 0) {
  console.error(`ship-skill: the built engine did not run: ${version.stderr}`);
  process.exit(1);
}
const v = JSON.parse(version.stdout);

// The skill's own files, from skill/ in this repository.
const source = from ? resolve(process.env.INIT_CWD ?? process.cwd(), from) : join(root, 'skill');
if (!existsSync(join(source, 'SKILL.md'))) {
  console.error(`ship-skill: ${source} has no SKILL.md to install`);
  process.exit(2);
}
const files = (function walk(dir) {
  return readdirSync(join(source, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
})('');
for (const rel of files) {
  mkdirSync(dirname(join(skill, rel)), { recursive: true });
  copyFileSync(join(source, rel), join(skill, rel));
}
console.log(`shipped the skill's ${files.length} files to ${skill}`);

const scripts = join(skill, 'scripts');
mkdirSync(scripts, { recursive: true });
copyFileSync(engine, join(scripts, 'engine.cjs'));
chmodSync(join(scripts, 'engine.cjs'), 0o755);
writeFileSync(join(scripts, 'VERSION'), `engine ${v.engine}\nschema ${v.schema}\n`);
console.log(`shipped pahlavan engine ${v.engine} (schema v${v.schema}) to ${join(scripts, 'engine.cjs')}`);

// The vault a skill folder sits in: <vault>/.claude/skills/<name>.
const skills = dirname(skill);
const vault = basename(skills) === 'skills' && basename(dirname(skills)) === '.claude' ? dirname(dirname(skills)) : null;
const check = join(scripts, 'selfcheck.mjs');
if (noCheck) console.log('ship-skill: selfcheck skipped (--no-check)');
else if (!existsSync(check)) console.log('ship-skill: the skill has no scripts/selfcheck.mjs, nothing to check');
else if (!vault) console.log(`ship-skill: selfcheck skipped, ${skill} is not inside a vault's .claude/skills/`);
else {
  console.log(`ship-skill: selfcheck against ${vault}`);
  const r = spawnSync(node, [check, '--vault', vault, '--repo', root], { cwd: vault, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`ship-skill: the skill's selfcheck failed (the engine is shipped; fix what it names, then run node ${check} --vault ${vault})`);
    process.exit(r.status || 1);
  }
}
