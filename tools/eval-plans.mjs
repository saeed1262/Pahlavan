#!/usr/bin/env node
// Scores coach-written draft plans for the made-up athletes, so models and
// prompts can be compared on the same people. Running a model is manual:
// save each draft as a whole plan-data.json named after its athlete
// (`1-beginner.json`, `1-beginner-try2.json` or `1-a.json`, by the athlete's
// file name or its number), then:
//
//   node tools/eval-plans.mjs <drafts folder> [--athletes test/fixtures/athletes]
//     [--engine dist/engine.cjs] [--date YYYY-MM-DD] [--json]
//
// For each draft it builds a scratch vault (the athlete's profile, its
// Ledger when it has one, the draft as plan-data.json, empty logs), runs the
// built engine's `check --plan` and `review --plan` on the athlete's date
// (the fixture's `today`, unless --date), and prints one row per draft:
// hard errors, warnings by code, overrides used, priority muscles inside
// their band, region rules met, sessions over the profile's minutes, and
// pulling to pushing sets. Read only outside its scratch folder, which it
// removes. Exit 0 when every draft was scored, 1 when one could not be, 2 on
// a usage error.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'usage: node tools/eval-plans.mjs <drafts folder> [--athletes <folder>] [--engine <engine.cjs>] [--date YYYY-MM-DD] [--json]';

function usage(message) {
  console.error(`eval-plans: ${message}\n${USAGE}`);
  process.exit(2);
}

const opts = { drafts: null, athletes: join(ROOT, 'test', 'fixtures', 'athletes'), engine: join(ROOT, 'dist', 'engine.cjs'), date: null, json: false };
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (['--athletes', '--engine', '--date'].includes(a)) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) usage(`${a} needs a value`);
      opts[a.slice(2)] = argv[++i];
    } else if (a.startsWith('--')) usage(`unknown option ${a}`);
    else if (opts.drafts === null) opts.drafts = a;
    else usage(`one drafts folder only (also got ${a})`);
  }
}
if (!opts.drafts) usage('give the folder of draft plans');
if (opts.date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) usage('--date must be YYYY-MM-DD');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const list = (dir) => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch {
    usage(`no such folder: ${dir}`);
  }
};

const athletes = list(opts.athletes).map((f) => {
  const a = readJson(join(opts.athletes, f));
  return { name: a.name ?? basename(f, '.json'), number: /^(\d+)-/.exec(f)?.[1] ?? null, input: a.input };
});
if (!athletes.length) usage(`no athletes in ${opts.athletes}`);

/** The athlete a draft is for: its name starting the draft's name, else its number ("1-..."). */
function athleteOf(draft) {
  const stem = basename(draft, '.json');
  const byName = athletes.filter((a) => stem === a.name || stem.startsWith(`${a.name}-`) || stem.startsWith(`${a.name}.`) || stem.startsWith(`${a.name}_`));
  if (byName.length) return byName.sort((x, y) => y.name.length - x.name.length)[0];
  const n = /^(\d+)(?:[-_.]|$)/.exec(stem)?.[1];
  return n ? (athletes.find((a) => a.number === n) ?? null) : null;
}

function engine(args) {
  const r = spawnSync(process.execPath, [opts.engine, ...args, '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    json = null;
  }
  return { code: r.status, json, stderr: r.stderr };
}

const scratch = mkdtempSync(join(tmpdir(), 'pahlavan-eval-'));
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));

/** A scratch vault for one draft: the profile, the Ledger, the draft as the plan, empty logs. */
function vaultFor(athlete, draftText, i) {
  const vault = join(scratch, `v${i}`);
  const fitness = join(vault, 'Fitness');
  mkdirSync(join(fitness, 'Coach'), { recursive: true });
  writeFileSync(join(fitness, 'Coach', 'profile.json'), `${JSON.stringify(athlete.input.profile, null, 2)}\n`);
  const ledger = athlete.input.options?.ledger;
  if (Array.isArray(ledger) && ledger.length) writeFileSync(join(fitness, 'Coach', 'ledger.json'), `${JSON.stringify({ schemaVersion: 1, constraints: ledger }, null, 2)}\n`);
  writeFileSync(join(fitness, 'plan-data.json'), draftText);
  writeFileSync(join(fitness, 'fitness-log-data.json'), `${JSON.stringify({ sessions: [] })}\n`);
  writeFileSync(join(fitness, 'body-data.json'), `${JSON.stringify({ days: {} })}\n`);
  return vault;
}

const valueOf = (x) => (x && typeof x === 'object' && 'value' in x ? x.value : x);

/** The scratch vault's own notes (coach files it leaves out on purpose): about the vault, not the draft. */
const SCRATCH_NOTES = new Set(['coach-missing', 'missing']);

/** One draft's scores from the check and the review (null when the review gave no numbers: those scores are null). */
function score(check, review) {
  const findings = (check.findings ?? []).filter((f) => !SCRATCH_NOTES.has(f.code));
  const errors = findings.filter((f) => f.level === 'error');
  const warnings = {};
  for (const f of findings.filter((x) => x.level === 'warning')) warnings[f.code] = (warnings[f.code] ?? 0) + Math.max(1, f.items?.length ?? 0);
  const base = { errors: { count: errors.length, codes: [...new Set(errors.map((e) => e.code))] }, warnings, overrides: check.summary?.overridden ?? 0 };
  if (!review) return { ...base, priority: null, regions: null, time: null, pullPush: null };
  const bands = (review.volume.bands ?? []).map(valueOf);
  const priority = bands.filter((b) => b.priority);
  const regions = (review.volume.regions ?? []).map(valueOf).filter((r) => r.rule);
  const sessions = (review.time?.sessions ?? []).map((s) => ({ type: s.type, minutes: valueOf(s.estimate)?.minutes ?? null, limit: s.kind === 'short' ? (review.time.limits?.short ?? null) : (review.time.limits?.lift ?? null) }));
  const over = sessions.filter((s) => s.minutes !== null && s.limit !== null && s.minutes > s.limit);
  const pp = valueOf(review.volume.pullPush);
  return {
    ...base,
    priority: { inBand: priority.filter((b) => b.status === 'ok').length, of: priority.length, muscles: priority.map((b) => `${b.muscle} ${b.sets} (${b.status})`) },
    regions: { met: regions.filter((r) => r.status === 'ok').length, of: regions.length, short: regions.filter((r) => r.status === 'short').map((r) => r.id) },
    time: { sessions, over: over.map((s) => `${s.type} ${s.minutes}/${s.limit}`) },
    pullPush: pp ? { pull: pp.pull, push: pp.push, ratio: pp.ratio, status: pp.status } : null,
  };
}

const rows = [];
let failed = 0;
list(opts.drafts).forEach((file, i) => {
  const athlete = athleteOf(file);
  if (!athlete) {
    rows.push({ draft: file, athlete: null, error: `no athlete matches the name (athletes: ${athletes.map((a) => a.name).join(', ')})` });
    failed++;
    return;
  }
  const draftPath = join(resolve(opts.drafts), file);
  const vault = vaultFor(athlete, readFileSync(draftPath, 'utf8'), i);
  const date = opts.date ?? athlete.input.today;
  const common = ['--vault', vault, '--plan', draftPath, ...(date ? ['--date', date] : [])];
  const check = engine(['check', ...common]);
  const review = engine(['review', ...common]);
  if (!check.json || !Array.isArray(check.json.findings)) {
    rows.push({ draft: file, athlete: athlete.name, error: `check gave no findings (exit ${check.code}): ${check.stderr.trim().split('\n')[0] ?? ''}` });
    failed++;
    return;
  }
  // A review that failed (an error exit: the draft unreadable reads as an empty plan) is said, never scored: its sets, minutes and pull to push are unknown.
  const reviewed = review.code === 0 && review.json?.volume ? review.json : null;
  const reviewError = reviewed ? null : `${review.json?.errors?.[0]?.message ?? (review.stderr.trim().split('\n')[0] || 'no output')} (exit ${review.code})`;
  rows.push({ draft: file, athlete: athlete.name, date, checkExit: check.code, ...(reviewError ? { reviewError } : {}), ...score(check.json, reviewed) });
});

if (opts.json) {
  console.log(JSON.stringify({ athletes: opts.athletes, engine: opts.engine, rows }, null, 2));
} else {
  const head = ['athlete', 'draft', 'errors', 'warnings by code', 'overrides', 'priority in band', 'regions met', 'over time', 'pull:push'];
  const cells = rows.map((r) =>
    r.error
      ? [r.athlete ?? '?', r.draft, `not scored: ${r.error}`, '', '', '', '', '', '']
      : [
          r.athlete,
          r.draft,
          r.errors.count ? `${r.errors.count} (${r.errors.codes.join(', ')})` : '0',
          Object.entries(r.warnings).map(([c, n]) => `${c} ${n}`).join(', ') || 'none',
          String(r.overrides),
          ...(r.reviewError
            ? [`review failed: ${r.reviewError}`, '?', '?', '?']
            : [
                r.priority.of ? `${r.priority.inBand}/${r.priority.of}` : '-',
                r.regions.of ? `${r.regions.met}/${r.regions.of}` : '-',
                r.time.over.join(', ') || 'none',
                r.pullPush && r.pullPush.ratio !== null ? `${r.pullPush.ratio}` : '-',
              ]),
        ],
  );
  const widths = head.map((h, c) => Math.max(h.length, ...cells.map((row) => row[c].length)));
  const line = (row) => row.map((x, c) => x.padEnd(widths[c])).join(' | ').trimEnd();
  console.log(line(head));
  console.log(widths.map((w) => '-'.repeat(w)).join('-|-'));
  for (const row of cells) console.log(line(row));
}
process.exit(failed ? 1 : 0);
