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
// Ledger when it has one, a plan-data.json, empty logs) and runs the built
// engine on the athlete's date (the fixture's `today`, unless --date). An
// athlete with a current plan (`input.current`, a plan-data object) gets it
// as plan-data.json, and the draft is a redesign: `check --plan <draft>
// --redesign` against the plan as written, and `overlap --plans <draft>
// --vault` for the share of the draft's movements the current plan holds.
// Otherwise the draft is plan-data.json itself and `check --plan` runs as a
// plain check. `review --plan` always reads the draft. One row per draft:
// hard errors, warnings by code (but `no-why-card`: a candidate may skip the
// Why this plan card), overrides used, the share kept from the
// current plan, the fit counts (sessions over time, Ledger blocks, missing
// equipment, disliked movements), priority muscles inside their band, region
// rules met, sessions over the profile's minutes, and pulling to pushing
// sets. Under the rows, one `overlap` run over every draft that reads as a
// plan: drafts for different athletes should share little (the mean and the
// largest share), and an athlete's own candidates are listed pair by pair,
// the pairs over the limit named. A high share is a score, not a failure.
// Read only outside its scratch folder, which it removes. Exit 0 when every
// draft was scored, 1 when one could not be (or the overlap run failed), 2
// on a usage error.

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
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (dir) => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch {
    usage(`no such folder: ${dir}`);
  }
};

const athletes = list(opts.athletes).map((f) => {
  const a = readJson(join(opts.athletes, f));
  const current = a.input?.current;
  if (current !== undefined && !isObj(current)) usage(`${f}: input.current must be a plan-data object (the athlete's plan as written)`);
  return { name: a.name ?? basename(f, '.json'), number: /^(\d+)-/.exec(f)?.[1] ?? null, input: a.input, current: current ?? null };
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

/** Why an engine run gave nothing: its first error, else its first line on stderr, with the exit code. */
const failure = (r) => `${r.json?.errors?.[0]?.message ?? (r.stderr.trim().split('\n')[0] || 'no output')} (exit ${r.code})`;

const scratch = mkdtempSync(join(tmpdir(), 'pahlavan-eval-'));
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));

/**
 * A scratch vault for one draft: the profile, the Ledger, a plan, empty logs.
 * The plan is the athlete's current plan when it has one (the draft is then
 * a redesign, read from its own file with --plan), else the draft itself.
 */
function vaultFor(athlete, draftText, i) {
  const vault = join(scratch, `v${i}`);
  const fitness = join(vault, 'Fitness');
  mkdirSync(join(fitness, 'Coach'), { recursive: true });
  writeFileSync(join(fitness, 'Coach', 'profile.json'), `${JSON.stringify(athlete.input.profile, null, 2)}\n`);
  const ledger = athlete.input.options?.ledger;
  if (Array.isArray(ledger) && ledger.length) writeFileSync(join(fitness, 'Coach', 'ledger.json'), `${JSON.stringify({ schemaVersion: 1, constraints: ledger }, null, 2)}\n`);
  writeFileSync(join(fitness, 'plan-data.json'), athlete.current ? `${JSON.stringify(athlete.current, null, 2)}\n` : draftText);
  writeFileSync(join(fitness, 'fitness-log-data.json'), `${JSON.stringify({ sessions: [] })}\n`);
  writeFileSync(join(fitness, 'body-data.json'), `${JSON.stringify({ days: {} })}\n`);
  return vault;
}

const valueOf = (x) => (x && typeof x === 'object' && 'value' in x ? x.value : x);

/** The scratch vault's own notes (coach files it leaves out on purpose): about the vault, not the draft. */
const SCRATCH_NOTES = new Set(['coach-missing', 'missing']);

/** How well the draft fits the person: these findings counted on every row, 0 when absent. */
const FIT = ['time-over', 'ledger-blocked', 'equipment-missing', 'disliked-movement'];

/** A finding's weight: its items, at least one. */
const weight = (f) => Math.max(1, f.items?.length ?? 0);

/** One draft's scores from the check and the review (null when the review gave no numbers: those scores are null). */
function score(check, review) {
  const findings = (check.findings ?? []).filter((f) => !SCRATCH_NOTES.has(f.code));
  const errors = findings.filter((f) => f.level === 'error');
  const warnings = {};
  // A candidate may skip the Why this plan card (only the plan that is written needs one), so its warning isn't scored.
  for (const f of findings.filter((x) => x.level === 'warning' && x.code !== 'no-why-card')) warnings[f.code] = (warnings[f.code] ?? 0) + weight(f);
  // Open findings only, as the warnings are counted: an overridden item is information (and counts under overrides).
  const fit = Object.fromEntries(FIT.map((code) => [code, findings.filter((f) => f.code === code && f.level !== 'info').reduce((n, f) => n + weight(f), 0)]));
  const base = { errors: { count: errors.length, codes: [...new Set(errors.map((e) => e.code))] }, warnings, overrides: check.summary?.overridden ?? 0, fit };
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

/**
 * The share of a redesign's movements the current plan also holds (current),
 * the other way (currentInDraft) and the shared movements, from the engine's
 * overlap: there for every redesign, where check's similar-to-current only
 * speaks over the limit. All null when the athlete has no current plan.
 * The draft goes under a plain name in the scratch folder: --plans splits on
 * commas.
 */
function againstCurrent(redesign, file, draftText, vault, i) {
  if (!redesign) return { current: null, currentInDraft: null, shared: [] };
  const draft = join(scratch, `v${i}-draft.json`);
  writeFileSync(draft, draftText);
  const r = engine(['overlap', '--plans', draft, '--vault', vault]);
  const row = r.code === 0 ? r.json?.againstCurrent?.[0] : null;
  if (!row) return { current: null, currentInDraft: null, shared: [], error: failure(r).replaceAll(draft, file) };
  return { current: row.draftInCurrent, currentInDraft: row.currentInDraft, shared: row.shared };
}

const rows = [];
const drafts = [];
let failed = 0;
list(opts.drafts).forEach((file, i) => {
  const athlete = athleteOf(file);
  if (!athlete) {
    rows.push({ draft: file, athlete: null, error: `no athlete matches the name (athletes: ${athletes.map((a) => a.name).join(', ')})` });
    failed++;
    return;
  }
  const draftPath = join(resolve(opts.drafts), file);
  const text = readFileSync(draftPath, 'utf8');
  drafts.push({ file, athlete: athlete.name, text });
  const vault = vaultFor(athlete, text, i);
  const redesign = athlete.current !== null;
  const date = opts.date ?? athlete.input.today;
  const common = ['--vault', vault, '--plan', draftPath, ...(date ? ['--date', date] : [])];
  const check = engine(['check', ...common, ...(redesign ? ['--redesign'] : [])]);
  const review = engine(['review', ...common]);
  if (!check.json || !Array.isArray(check.json.findings)) {
    rows.push({ draft: file, athlete: athlete.name, error: `check gave no findings (exit ${check.code}): ${check.stderr.trim().split('\n')[0] ?? ''}` });
    failed++;
    return;
  }
  // A review that failed (an error exit: the draft unreadable reads as an empty plan) is said, never scored: its sets, minutes and pull to push are unknown.
  const reviewed = review.code === 0 && review.json?.volume ? review.json : null;
  const reviewError = reviewed ? null : failure(review);
  const overlap = againstCurrent(redesign, file, text, vault, i);
  rows.push({ draft: file, athlete: athlete.name, date, redesign, checkExit: check.code, ...(reviewError ? { reviewError } : {}), overlap, ...score(check.json, reviewed) });
});

const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * How much the drafts share, from one overlap run over every draft that reads
 * as a plan (JSON with a sessions object; the rest are left out and named).
 * Across athletes: each pair of drafts for different people, both ways, with
 * the mean and the largest share. Within an athlete: each pair of its
 * candidates. `over` lists the shares over the limit, one direction each
 * (a's movements mostly in b), as the engine's `similar` judges them.
 */
function diversity() {
  const plans = [];
  const skipped = [];
  for (const d of drafts) {
    let doc;
    try {
      doc = JSON.parse(d.text);
    } catch {
      doc = null;
    }
    if (isObj(doc) && isObj(doc.sessions)) plans.push(d);
    else skipped.push(d.file);
  }
  const empty = { limit: null, acrossAthletes: { mean: null, max: null, pairs: [], over: [] }, withinAthlete: [], skipped };
  if (!plans.length) return empty;
  // Each draft under a plain name in the scratch folder: --plans splits on commas.
  const dir = join(scratch, 'all');
  mkdirSync(dir, { recursive: true });
  const byPath = new Map();
  plans.forEach((d, k) => {
    const p = join(dir, `d${k}.json`);
    writeFileSync(p, d.text);
    byPath.set(p, d);
  });
  const r = engine(['overlap', '--plans', [...byPath.keys()].join(',')]);
  if (r.code !== 0 || !Array.isArray(r.json?.pairs)) return { ...empty, error: `overlap failed: ${failure(r)}` };
  const pairs = r.json.pairs.map((p) => ({ a: byPath.get(p.a), b: byPath.get(p.b), aInB: p.aInB, bInA: p.bInA, shared: p.shared }));
  const over = (r.json.similar ?? []).filter((s) => !s.current).map((s) => ({ a: byPath.get(s.a), b: byPath.get(s.b), share: s.share }));
  const names = (p) => ({ a: p.a.file, b: p.b.file });
  const across = pairs.filter((p) => p.a.athlete !== p.b.athlete);
  const shares = across.flatMap((p) => [p.aInB, p.bInA]).filter((v) => v !== null);
  return {
    limit: r.json.limit,
    acrossAthletes: {
      mean: shares.length ? r3(shares.reduce((s, v) => s + v, 0) / shares.length) : null,
      max: shares.length ? Math.max(...shares) : null,
      pairs: across.map((p) => ({ ...names(p), athletes: [p.a.athlete, p.b.athlete], aInB: p.aInB, bInA: p.bInA, shared: p.shared })),
      over: over.filter((s) => s.a.athlete !== s.b.athlete).map((s) => ({ ...names(s), share: s.share })),
    },
    withinAthlete: [...new Set(plans.map((d) => d.athlete))]
      .map((name) => ({
        athlete: name,
        pairs: pairs.filter((p) => p.a.athlete === name && p.b.athlete === name).map((p) => ({ ...names(p), aInB: p.aInB, bInA: p.bInA, shared: p.shared })),
        over: over.filter((s) => s.a.athlete === name && s.b.athlete === name).map((s) => ({ ...names(s), share: s.share })),
      }))
      .filter((w) => w.pairs.length),
    skipped,
  };
}

const div = diversity();
if (div.error) failed++;

if (opts.json) {
  console.log(JSON.stringify({ athletes: opts.athletes, engine: opts.engine, rows, diversity: div }, null, 2));
} else {
  const pct = (v) => (v === null || v === undefined ? '-' : `${Math.round(v * 100)}%`);
  const head = ['athlete', 'draft', 'errors', 'warnings by code', 'overrides', 'in current', 'fit', 'priority in band', 'regions met', 'over time', 'pull:push'];
  const cells = rows.map((r) =>
    r.error
      ? [r.athlete ?? '?', r.draft, `not scored: ${r.error}`, '', '', '', '', '', '', '', '']
      : [
          r.athlete,
          r.draft,
          r.errors.count ? `${r.errors.count} (${r.errors.codes.join(', ')})` : '0',
          Object.entries(r.warnings).map(([c, n]) => `${c} ${n}`).join(', ') || 'none',
          String(r.overrides),
          r.redesign ? (r.overlap.error ? '?' : pct(r.overlap.current)) : '-',
          Object.entries(r.fit).filter(([, n]) => n).map(([c, n]) => `${c} ${n}`).join(', ') || 'ok',
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

  console.log('');
  if (div.error) console.log(`diversity: not scored: ${div.error}`);
  else {
    console.log(`diversity: the share of one draft's movements another also holds, both ways${div.limit !== null ? ` (over ${pct(div.limit)} is over the limit)` : ''}`);
    const overText = (xs) => xs.map((s) => `${s.a} in ${s.b} ${pct(s.share)}`).join(', ');
    const across = div.acrossAthletes;
    if (!across.pairs.length) console.log('  across athletes: no pairs (drafts for one athlete only)');
    else {
      const top = across.pairs.find((p) => p.aInB === across.max || p.bInA === across.max);
      console.log(`  across athletes: ${across.pairs.length} pair${across.pairs.length === 1 ? '' : 's'}, mean ${pct(across.mean)}, max ${pct(across.max)} (${top.a} and ${top.b})`);
      if (across.over.length) console.log(`    over the limit: ${overText(across.over)}`);
    }
    for (const w of div.withinAthlete) {
      console.log(`  within ${w.athlete}:`);
      for (const p of w.pairs) console.log(`    ${p.a} and ${p.b}: ${pct(p.aInB)} / ${pct(p.bInA)}`);
      if (w.over.length) console.log(`    over the limit: ${overText(w.over)}`);
    }
    if (div.skipped.length) console.log(`  left out (not a readable plan): ${div.skipped.join(', ')}`);
  }
}
process.exit(failed ? 1 : 0);
