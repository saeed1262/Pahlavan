// The public copy of this repository: the last commit's files, less what
// stays private (the design mockups and their renders, the preview's
// screenshots, the golden tools that compare against a real vault, the
// development notes), scanned for anything private, then one fresh commit
// and, with --bundle, a git bundle to push from elsewhere.
//
//   node tools/export-public.mjs --out DIR --author "Name <email>" [--deny "word,word"] [--check] [--bundle FILE] [--worktree]
//
// --author is required: the public commit never takes this machine's git
// identity (which may be a work address).
//
// --deny (or PAHLAVAN_DENY) lists the words that must not appear anywhere in
// the copy (a home folder, a vault's name, a workplace), given at run time
// so this file names none of them. Tokens, keys and home-folder paths are
// always checked. --check runs the type check and the tests in the copy,
// which must pass without the left-out files. The copy is the last commit
// (the working tree must be clean), or with --worktree the tracked files as
// they are now (staged new files included).

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

/** Left out of the public copy (paths from the repository's root; a trailing slash is a folder). */
export const PRIVATE = ['mockups/', 'plugin/preview/renders/', 'tools/golden-dashboard.mjs', 'tools/golden-log.mjs', 'tools/golden-nudges.mjs', 'docs/notes.md', 'docs/dashboard-parity.md'];

/** Always refused: secrets, and a home folder other than the tests' made-up one. */
export const ALWAYS = [/ghp_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/, /sk-ant-[A-Za-z0-9-]{10,}/, /xox[abp]-[A-Za-z0-9-]{10,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\/Users\/(?!x\b)[a-z][a-z0-9._-]*/];

const TEXT = /\.(ts|mjs|js|cjs|json|md|css|html|txt|sh|yml|yaml|svg)$|(^|\/)(LICENSE|\.gitignore)$/;

/** Every word or pattern found in the copy's text files, with where. */
export function scan(dir, deny) {
  const hits = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (name === '.git' || name === 'node_modules') continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (TEXT.test(relative(dir, p))) {
        const text = readFileSync(p, 'utf8');
        // Whole words, any case: a word inside a longer one is not a hit.
        for (const w of deny) if (new RegExp(`(^|[^A-Za-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9])`, 'i').test(text)) hits.push(`${relative(dir, p)}: "${w}"`);
        for (const re of ALWAYS) {
          const m = re.exec(text);
          if (m) hits.push(`${relative(dir, p)}: ${m[0].slice(0, 24)}`);
        }
      }
    }
  };
  walk(dir);
  return hits;
}

function main() {
  const { values } = parseArgs({ options: { out: { type: 'string' }, deny: { type: 'string' }, check: { type: 'boolean' }, bundle: { type: 'string' }, author: { type: 'string' }, worktree: { type: 'boolean' } } });
  if (!values.out || !values.author) throw new Error('usage: node tools/export-public.mjs --out DIR [--deny "word,word"] [--check] [--bundle FILE] --author "Name <email>"');
  const root = resolve(new URL('..', import.meta.url).pathname);
  const git = (args, cwd = root, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
  if (!values.worktree && git(['status', '--porcelain']).trim()) throw new Error('the working tree has changes: commit them first, or pass --worktree');
  const out = resolve(values.out);
  if (existsSync(out) && readdirSync(out).length) throw new Error(`${out} is not empty`);
  mkdirSync(out, { recursive: true });

  // The last commit's files (or the tracked ones as they are now), then the private ones taken out.
  if (values.worktree) {
    for (const f of git(['ls-files', '-z']).split('\0').filter(Boolean)) {
      if (!existsSync(join(root, f))) continue; // deleted, not yet staged
      mkdirSync(dirname(join(out, f)), { recursive: true });
      copyFileSync(join(root, f), join(out, f));
    }
  } else execFileSync('sh', ['-c', `git archive --format=tar HEAD | tar -x -C "${out}"`], { cwd: root });
  for (const p of PRIVATE) rmSync(join(out, p), { recursive: true, force: true });

  const deny = (values.deny ?? process.env.PAHLAVAN_DENY ?? '').split(',').map((w) => w.trim()).filter(Boolean);
  const hits = scan(out, deny);
  if (hits.length) {
    console.error(`private words or secrets found (${hits.length}):\n  ${hits.slice(0, 50).join('\n  ')}`);
    process.exit(1);
  }
  console.log(`copied ${countFiles(out)} files to ${out}; scanned for ${deny.length} private word(s), tokens and home-folder paths: clean`);

  if (values.check) {
    // The left-out files must not be needed: the type check and every test pass in the copy.
    symlinkSync(join(root, 'node_modules'), join(out, 'node_modules'));
    try {
      for (const script of ['typecheck', 'test']) execFileSync('npm', ['run', '--silent', script], { cwd: out, stdio: ['ignore', 'ignore', 'inherit'] });
      console.log('the copy type-checks and passes its tests');
    } finally {
      rmSync(join(out, 'node_modules'));
    }
  }

  const version = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')).version;
  const [, name, email] = /^(.*?)\s*<(.+)>$/.exec(values.author) ?? [];
  if (!name || !email) throw new Error('--author is "Name <email>"');
  const who = { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
  git(['init', '-q', '-b', 'main'], out);
  git(['add', '-A'], out);
  git(['commit', '-q', '-m', `Pahlavan ${version}`], out, who);
  console.log(`one commit: Pahlavan ${version} by ${name} <${email}>`);
  if (values.bundle) {
    git(['bundle', 'create', resolve(values.bundle), 'main'], out);
    console.log(`bundle: ${resolve(values.bundle)}`);
  }
}

function countFiles(dir) {
  let n = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    n += statSync(p).isDirectory() ? countFiles(p) : 1;
  }
  return n;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
