#!/usr/bin/env node
// The fitness-coach skill's self-check: the skill audit, automated. Run it
// from the vault root after each ship (npm run ship-skill runs it):
//
//   node .claude/skills/fitness-coach/scripts/selfcheck.mjs [--vault .] [--json] [--repo <pahlavan checkout>]
//
// 1. Every engine command in numbers.md's block runs (placeholders filled with
//    safe values, --write dropped) and gives JSON with ok, the fields the
//    "Which command answers which question" table names are in the output,
//    and each command's flags match the engine's --help.
// 2. Every ```json example in formats.md and numbers.md that is a whole
//    record of a kind the engine knows passes `engine validate` (a body
//    record file passes `engine body`, a dry run on an empty scratch vault).
// 3. Every section SKILL.md's "What each job reads" table names is a heading
//    in the file it names.
// 4. Every vault path the skill names exists, and every /command.
// 5. scripts/VERSION, the engine's --help header and (when the checkout
//    exists) the repo's src/core/version.ts agree.
// 6. The docs agree with the engine's facts (`engine --version --json`'s
//    `facts`, read from the constants it computes with): every calibration
//    RIR, volume tier, light-week default, region number and eating-plan
//    energy constant the docs quote; no "no field" claim names a field the
//    engine has; every `unexpressible` kind named exists; no Python block but
//    the allowlisted snippet (tracking.md's water: the engine replaces the
//    rest); and no engine output names a vault-only script (fitness_log.py,
//    gen-fitness-plan).
//
// A vault with no plan yet (a fresh vault after the intake) is expected: the
// commands answer with a no-plan warning, the draft runs (check --plan,
// review --plan, plan-write --file, session --plan --type) read the made-up
// sample plan beside this script (scripts/sample-plan.json), and what needs
// the plan's own sessions, lifts or ladders (log fix,
// log ladder, next, session --type or --freeze) must give its documented
// exit 1 with a no-plan error. So must `energy` without the profile's basics
// (no-basics) or without weigh-ins (no-weight).
//
// Read only: the engine never gets --write, scratch files go to os.tmpdir(),
// and the files the engine can write are hashed before and after the runs.
// Plain Node, no dependencies. Exit 0 when nothing fails (skips are fine),
// 1 when a check fails, 2 on a usage error.

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, homedir, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = 'usage: node .claude/skills/fitness-coach/scripts/selfcheck.mjs [--vault .] [--json] [--repo <pahlavan checkout>]';

// ---------- arguments and places ----------

const opts = { vault: '.', json: false, repo: join(homedir(), 'Projects', 'pahlavan') };
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--vault' || a === '--repo') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) usage(`${a} needs a path`);
      opts[a.slice(2)] = argv[++i];
    } else if (a === '--help' || a === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else usage(`unknown argument ${a}`);
  }
}
function usage(message) {
  console.error(`selfcheck: ${message}\n${USAGE}`);
  process.exit(2);
}

const SKILL = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const REFS = join(SKILL, 'references');
const ENGINE = join(SKILL, 'scripts', 'engine.cjs');
const VAULT = resolve(opts.vault);
if (!existsSync(ENGINE)) usage(`no engine at ${ENGINE}`);
// Where this vault keeps Pahlavan's files, as the engine reads them (Pahlavan's setting, else found).
const LAYOUT = (() => {
  try {
    return JSON.parse(execFileSync(process.execPath, [ENGINE, 'folders', '--vault', VAULT, '--json'], { encoding: 'utf8' })).paths;
  } catch {
    return null;
  }
})();
if (!LAYOUT) usage(`the engine could not read the folders of ${VAULT}: run from the vault root or pass --vault`);
const FITNESS = join(VAULT, LAYOUT.fitness);
const COACH = join(VAULT, LAYOUT.coach);
if (!existsSync(FITNESS)) usage(`${VAULT} has no fitness folder (${LAYOUT.fitness}): run from the vault root or pass --vault`);
// No plan yet (a fresh vault after the intake): expected, not a failure. The
// commands answer with a no-plan warning; the draft commands run on the
// made-up sample plan (SAMPLE_PLAN); what needs the plan's own sessions,
// lifts or ladders is held to its documented no-plan error.
const FRESH = !existsSync(join(VAULT, LAYOUT.plan));
const FRESH_NOTE = 'no plan yet (a fresh vault)';
// A small made-up plan (nobody's own) the draft commands read on a fresh vault.
const SAMPLE_PLAN = join(SKILL, 'scripts', 'sample-plan.json');

const read = (p) => readFileSync(p, 'utf8');
const readJson = (p) => {
  try {
    return JSON.parse(read(p));
  } catch {
    return null;
  }
};

// Local calendar dates, as the engine's own default --date.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const NOW = new Date();
const dayOffset = (n) => iso(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + n));
const TODAY = iso(NOW);
const LAST_SUNDAY = dayOffset(-NOW.getDay());
const NEXT_MONDAY = dayOffset((8 - NOW.getDay()) % 7 || 7);

const TMP = mkdtempSync(join(tmpdir(), 'fitness-coach-selfcheck-'));
const EMPTY_VAULT = join(TMP, 'empty-vault');
mkdirSync(EMPTY_VAULT);
const short = (s) => s.split(TMP).join('<tmp>');

// ---------- results ----------

const CHECKS = {
  1: 'commands',
  2: 'json examples',
  3: 'job sections',
  4: 'paths and /commands',
  5: 'version',
  6: 'docs vs engine facts',
};
const results = [];
const record = (check, status, what, reason) => results.push({ check, status, what, reason });

// ---------- the engine ----------

const MAX = Math.max(1, Math.min(8, availableParallelism?.() ?? 4));
let active = 0;
const queue = [];
function pump() {
  while (active < MAX && queue.length) {
    active++;
    queue.shift()().finally(() => {
      active--;
      pump();
    });
  }
}
const limit = (fn) =>
  new Promise((res, rej) => {
    queue.push(() => fn().then(res, rej));
    pump();
  });

function spawnEngine(args, cwd) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [ENGINE, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    child.stdout.on('data', (c) => out.push(c));
    child.stderr.on('data', (c) => err.push(c));
    child.on('error', (e) => done({ code: null, stdout: '', stderr: String(e), json: null }));
    child.on('close', (code) => {
      const stdout = Buffer.concat(out).toString('utf8');
      let json = null;
      try {
        json = JSON.parse(stdout);
      } catch {}
      done({ code, stdout, stderr: Buffer.concat(err).toString('utf8'), json });
    });
  });
}
const runs = new Map();
function engine(args, cwd = VAULT) {
  if (args.includes('--write')) throw new Error('selfcheck never passes --write');
  const key = JSON.stringify([cwd, args]);
  if (!runs.has(key)) runs.set(key, limit(() => spawnEngine(args, cwd)));
  return runs.get(key);
}
const firstError = (r) => {
  const e = r.json?.errors?.[0];
  if (e) return `${e.code ? `${e.code}: ` : ''}${e.message ?? JSON.stringify(e)}`;
  return (r.stderr || r.stdout).trim().split('\n')[0]?.slice(0, 200) ?? '';
};

// ---------- markdown ----------

// Fenced blocks with their language and the line their content starts on (1-based).
function fences(text) {
  const out = [];
  const lines = text.split('\n');
  let open = null;
  lines.forEach((line, i) => {
    const m = /^\s*(`{3,}|~{3,})\s*([\w-]*)/.exec(line);
    if (!open && m) open = { mark: m[1], lang: m[2], start: i + 2, lines: [] };
    else if (open && line.trim().startsWith(open.mark) && line.trim().replace(/[`~]/g, '') === '') {
      out.push({ lang: open.lang, start: open.start, text: open.lines.join('\n') });
      open = null;
    } else if (open) open.lines.push(line);
  });
  return out;
}
// The text with fenced blocks blanked (line numbers kept).
function prose(text) {
  const lines = text.split('\n');
  let open = null;
  return lines
    .map((line) => {
      const m = /^\s*(`{3,}|~{3,})/.exec(line);
      if (!open && m) {
        open = m[1];
        return '';
      }
      if (open) {
        if (line.trim().startsWith(open) && line.trim().replace(/[`~]/g, '') === '') open = null;
        return '';
      }
      return line;
    })
    .join('\n');
}
const headings = (text) =>
  prose(text)
    .split('\n')
    .map((l) => /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(l)?.[1])
    .filter(Boolean)
    .map((h) => h.replace(/\s+/g, ' ').trim());
// The lines under a heading, to the next heading of the same or a higher level.
function section(text, title) {
  const lines = prose(text).split('\n');
  const at = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/^#+\s+/, '').trim().startsWith(title));
  if (at < 0) return null;
  const level = /^#+/.exec(lines[at])[0].length;
  const end = lines.findIndex((l, i) => i > at && /^#{1,6}\s/.test(l) && /^#+/.exec(l)[0].length <= level);
  return lines.slice(at + 1, end < 0 ? undefined : end);
}
// A markdown table's body rows as cells ("\|" kept as "|").
function tableRows(lines, firstHeader) {
  const out = [];
  let inTable = false;
  for (const line of lines) {
    if (!line.trim().startsWith('|')) {
      if (inTable) break;
      continue;
    }
    const cells = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split(/(?<!\\)\|/)
      .map((c) => c.trim().replace(/\\\|/g, '|'));
    if (!inTable) {
      if (cells[0] === firstHeader) inTable = true;
      continue;
    }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    out.push(cells);
  }
  return out;
}
const spans = (s) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
// Drop parenthesised asides (nested parens included).
function dropParens(s) {
  let out = '';
  let depth = 0;
  for (const c of s) {
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (!depth) out += c;
  }
  return out;
}

// ---------- doc command lines ----------

// "review --vault . --json [--date D] [--pretty]" → words, positional, required and optional flag groups.
function tokenize(s) {
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) i++;
    else if (c === '[') {
      let depth = 1;
      let j = i + 1;
      while (j < s.length && depth) {
        if (s[j] === '[') depth++;
        else if (s[j] === ']') depth--;
        j++;
      }
      toks.push({ group: s.slice(i + 1, j - 1) });
      i = j;
    } else if (c === '"') {
      const j = s.indexOf('"', i + 1);
      toks.push({ word: s.slice(i + 1, j < 0 ? s.length : j) });
      i = j < 0 ? s.length : j + 1;
    } else if (c === '<') {
      const j = s.indexOf('>', i);
      toks.push({ word: s.slice(i, j < 0 ? s.length : j + 1) });
      i = j < 0 ? s.length : j + 1;
    } else {
      let j = i;
      while (j < s.length && !/\s/.test(s[j])) j++;
      toks.push({ word: s.slice(i, j) });
      i = j;
    }
  }
  return toks;
}
const isFlag = (t) => t?.word?.startsWith('--');
function flagPairs(toks) {
  const pairs = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.word === '...') pairs.push({ flag: '...' });
    else if (isFlag(t)) {
      const next = toks[i + 1];
      if (next?.word !== undefined && !isFlag(next) && next.word !== '...') {
        pairs.push({ flag: t.word, value: next.word });
        i++;
      } else pairs.push({ flag: t.word });
    }
  }
  return pairs;
}
function parseCommand(s, subcommands) {
  const toks = tokenize(s.replace(/\\\|/g, '|'));
  const cmd = { words: [], positional: [], required: [], optional: [] };
  let i = 0;
  while (i < toks.length && toks[i].word !== undefined && !isFlag(toks[i])) {
    const w = toks[i].word;
    if (cmd.words.length === 0 || (cmd.words.length === 1 && subcommands.has(cmd.words[0]))) cmd.words.push(w);
    else cmd.positional.push(w);
    i++;
  }
  const rest = toks.slice(i);
  const top = [];
  for (const t of rest) {
    if (t.group !== undefined) cmd.optional.push(flagPairs(tokenize(t.group)));
    else top.push(t);
  }
  cmd.required = flagPairs(top);
  return cmd;
}
const flagsOf = (text) => new Set([...text.matchAll(/--[a-z][a-z-]*/g)].map((m) => m[0]));
// The values a flag lists (`--mode full|express|hotel`); a lone word after a
// flag is left out, since in --help it is as often the description's first word.
function enumsOf(text) {
  const out = new Map();
  for (const m of text.replace(/\\\|/g, '|').matchAll(/(--[a-z][a-z-]*)\s+([a-z0-9][a-z0-9-]*(?:\|[a-z0-9][a-z0-9-]*)+)(?=[\s\]`]|$)/g)) {
    const vals = m[2].split('|');
    if (!out.has(m[1])) out.set(m[1], new Set());
    for (const v of vals) out.get(m[1]).add(v);
  }
  return out;
}
const GLOBAL_FLAGS = new Set(['--json', '--pretty', '--help', '--version']);
const isEnum = (v) => typeof v === 'string' && v.includes('|') && v.split('|').every((x) => /^[a-z0-9][a-z0-9-]*$/.test(x));
const cmdKey = (cmd) => cmd.words.join(' ');

// ---------- the engine's --help ----------

function parseHelp(text) {
  const lines = text.split('\n');
  const from = lines.findIndex((l) => /^Commands\b/.test(l));
  const to = lines.findIndex((l) => /^Options:/.test(l));
  const sections = new Map();
  let cur = null;
  for (const line of lines.slice(from + 1, to < 0 ? undefined : to)) {
    const m = /^ {2}([a-z][a-z-]*)(?: ([a-z]+|<action>))?(?=\s|$)(.*)$/.exec(line);
    if (m) {
      const key = m[2] && m[2] !== '<action>' ? `${m[1]} ${m[2]}` : m[1];
      cur = sections.get(key) ?? { key, actions: m[2] === '<action>', usage: [], lines: [] };
      sections.set(key, cur);
      cur.usage.push(m[3]);
      cur.lines.push(m[3]);
    } else if (cur) cur.lines.push(line);
  }
  // track's actions: the lines at 14 spaces under "Actions:", with their continuations.
  for (const s of sections.values()) {
    if (!s.actions) continue;
    s.actionLines = new Map();
    let inActions = false;
    let act = null;
    for (const line of s.lines) {
      if (/Actions:/.test(line)) {
        inActions = true;
        continue;
      }
      if (!inActions) continue;
      const m = /^ {14}([a-z][a-z-]*)(?=\s|$)(.*)$/.exec(line);
      if (m) {
        act = m[1];
        s.actionLines.set(act, [m[2]]);
      } else if (act && /^ {15,}/.test(line)) s.actionLines.get(act).push(line);
    }
  }
  return sections;
}

// ---------- the vault's facts, for safe values ----------

async function vaultContext() {
  const plan = readJson(join(VAULT, LAYOUT.plan)) ?? {};
  const liftTypes = plan.liftTypes ?? [];
  const types = [...liftTypes, ...(plan.shortTypes ?? [])];
  let lift = null;
  for (const t of liftTypes) {
    const it = (plan.sessions?.[t] ?? []).find((x) => x.logged);
    if (it) {
      lift = { name: it.name, short: plan.lifts?.[it.name]?.short ?? null };
      break;
    }
  }
  const [tracked, day, template] = await Promise.all([
    engine(['tracked', '--vault', '.', '--json', '--date', TODAY]),
    engine(['track', 'day', '--vault', '.', '--json', '--date', TODAY]),
    engine(['checkin', 'template', '--vault', '.', '--json', '--date', TODAY]),
  ]);
  const items = (tracked.json?.items ?? []).map((i) => i.item ?? i).filter((i) => i?.id);
  // log fix's target: the newest logged session with a logged lift (fixed to its own values, so a dry run changes nothing).
  const sessions = readJson(join(FITNESS, 'fitness-log-data.json'))?.sessions ?? [];
  const fix = [...sessions].reverse().find((x) => x?.lift1 && typeof x.lift1 === 'object') ?? null;
  const dayItems = (day.json?.items ?? []).map((i) => i.value ?? i);
  // energy needs the profile's birth year and height, and a trend weight (tracked's protein has no grams without one).
  const basics = readJson(join(VAULT, LAYOUT.profile))?.basics ?? {};
  const noBasics = typeof basics.birthYear !== 'number' || typeof basics.heightCm !== 'number';
  const noWeight = tracked.json?.protein?.value ? tracked.json.protein.value.grams === null : false;
  const ctx = {
    types,
    draftTypes: [],
    lift,
    loggedOf: (type) => (plan.sessions?.[type] ?? []).filter((x) => x.logged).map((x) => x.name),
    items: items.map((i) => i.id),
    itemOfKind: (k) => items.find((i) => i.kind === k)?.id ?? null,
    suggestions: (tracked.json?.suggestions ?? []).map((s) => s.id ?? s.value?.id).filter(Boolean),
    morningAt: tracked.json?.morning?.at ?? '07:30',
    tickDone: dayItems.filter((i) => i.tickable === 'done').map((i) => i.id),
    tickAmount: dayItems.filter((i) => i.tickable === 'amount').map((i) => i.id),
    files: {},
    ladder: (plan.ladders ?? [])[0]?.id ?? null,
    fix,
    energyMissing: noBasics
      ? { code: 1, error: 'no-basics', why: 'the profile has no birth year or height' }
      : noWeight
        ? { code: 1, error: 'no-weight', why: 'no weigh-ins from the cycle start' }
        : null,
  };

  // The example files, all in os.tmpdir().
  const write = (name, value) => {
    const p = join(TMP, name);
    writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`);
    return p;
  };
  ctx.files.answers = write('answers.json', {
    date: template.json?.date ?? LAST_SUNDAY,
    weekStart: template.json?.weekStart ?? dayOffset(-NOW.getDay() - 6),
    recovery: 4,
  });
  // Today's weight as the file holds it (unchanged), else a value inside the forms' limits.
  const body = readJson(join(FITNESS, 'body-data.json'));
  const weight = body?.days?.[TODAY]?.weight ?? 80;
  ctx.files.record = write('record.json', { date: TODAY, morning: { weight } });
  // A custom session: always valid, and a dry run never writes it.
  ctx.files.session = write('session.json', { date: TODAY, type: 'custom', label: 'Selfcheck probe', durationMin: 1 });
  // The vault's own eating plan (merged or replaced, unchanged), else the formats.md example.
  const eating = readJson(join(COACH, 'eating-plan.json')) ?? exampleOfKind('eating');
  ctx.files.plan = eating ? write('plan.json', eating) : null;
  ctx.files.items = write('items.json', {
    kind: 'tick',
    name: 'Selfcheck probe',
    why: 'A probe from the skill self-check: a dry run, never written.',
    from: 'selfcheck',
  });
  ctx.files.changes = write('changes.json', { morning: { at: ctx.morningAt }, bodyRecord: { schedule: 'plan' } });
  // The vault's own plan as a draft (check --plan, review --plan, plan-write): unchanged, so plan-write finds nothing to write.
  // A fresh vault's draft is the made-up sample plan shipped beside this script.
  if (!FRESH) ctx.files.draft = readJson(join(VAULT, LAYOUT.plan)) ? write('draft.json', plan) : null; // an unreadable plan-data.json has no draft to stand for it
  else {
    const sample = readJson(SAMPLE_PLAN);
    const ok = sample && typeof sample === 'object' && sample.sessions && typeof sample.sessions === 'object';
    ctx.files.draft = ok ? write('draft.json', sample) : null;
    ctx.draftTypes = ok ? [...(sample.liftTypes ?? []), ...(sample.shortTypes ?? [])] : [];
    record(1, ok ? 'pass' : 'fail', 'scripts/sample-plan.json (no plan yet)', ok ? 'a plan with sessions: the draft the plan-check runs read' : `${existsSync(SAMPLE_PLAN) ? 'not a plan (JSON with a sessions object)' : 'missing'}: the draft runs have nothing to read`);
  }
  // A blank plan, as `draft` gives one, for overlap's second file.
  ctx.files.blank = write('blank.json', { weekTarget: { lift: 0, short: 0 }, liftTypes: [], shortTypes: [], sessions: {}, liftUnit: 'kg', lifts: {}, guide: {}, rules: {} });
  return ctx;
}

// The JSON examples of formats.md and numbers.md (check 2 judges them; the eating example is a fallback file).
const EXAMPLE_FILES = ['formats.md', 'numbers.md'];
const examples = EXAMPLE_FILES.flatMap((f) =>
  fences(read(join(REFS, f)))
    .filter((b) => b.lang === 'json')
    .map((b) => {
      let value;
      try {
        value = JSON.parse(b.text);
      } catch (e) {
        value = undefined;
      }
      return { file: f, line: b.start - 1, text: b.text, value }; // the fence's line
    }),
);
function exampleOfKind(kind) {
  if (kind === 'eating') return examples.find((e) => e.value?.schemaVersion && e.value?.meals)?.value ?? null;
  return null;
}

// ---------- check 1: the commands ----------

class Skip extends Error {}
class Unfillable extends Error {}

// The values that stand in for a placeholder; more than one gives one run each.
function fill(pair, where, ctx) {
  const { flag, value } = pair;
  // The plan check and plan-write exit 1 on the plan's own hard errors (judge passes those, naming them).
  if ((where.key === 'check' || where.key === 'plan-write') && !where.expect) where.expect = { code: 0, findings: true };
  if (value === undefined) return [[flag]];
  // log fix's --lift picks its lift below (the expectation follows that lift).
  if (isEnum(value) && !(where.key === 'log fix' && flag === '--lift')) return [[flag, value.split('|')[0]]];
  const placeholder = /^<.*>$/.test(value) || /^(?:[A-Z]|N|D|T|HH:MM|YYYY-MM-DD)$/.test(value);
  // No plan yet: what needs the plan's sessions, lifts or ladders gives the documented no-plan error (argvs sets the expectation).
  if (where.noPlan) {
    if (flag === '--date') return [[flag, TODAY]];
    if (flag === '--type') return [[flag, 'A']];
    if (flag === '--label' || flag === '--lift1' || flag === '--lift2' || flag === '--skip') return [[]];
    if (flag === '--lift') return [[flag, where.key === 'log fix' ? value.split('|')[0] : 'Selfcheck probe lift']];
    if (flag === '--id') return [[flag, 'selfcheck-probe']];
    if (flag === '--level') return [[flag, '1']];
    if (flag === '--weight' || flag === '--reps') return [[flag, '0']];
  }
  if (where.key === 'log fix' && !where.noPlan) {
    const t = ctx.fix;
    if (!t) throw new Skip('no logged session with a logged lift');
    // Nothing to change: the documented exit 1.
    if (!['--weight', '--reps', '--clear-planned'].some((f) => where.flags.has(f))) where.expect = { code: 1, error: 'invalid', why: 'a fix needs --weight, --reps or --clear-planned' };
    if (flag === '--date') return [[flag, t.date]];
    if (flag === '--type') return [[flag, t.type]];
    if (flag === '--label') return t.label ? [[flag, t.label]] : [[]];
    if (flag === '--lift') {
      where.lift = value.split('|')[0];
      const li = t[where.lift];
      // --clear-planned on a lift without "planned", or on a swap the plan has not adopted: the documented exit 1s.
      if (where.flags.has('--clear-planned') && li && typeof li === 'object') {
        if (!li.planned) where.expect = { code: 1, error: 'invalid', why: 'the lift has no "planned" to clear' };
        else if (ctx.loggedOf(t.type)[where.lift === 'lift2' ? 1 : 0] !== li.name) where.expect = { code: 1, error: 'invalid', why: 'the plan has not adopted the swap, so "planned" stays' };
      }
      return [[flag, where.lift]];
    }
    const li = (where.lift && t[where.lift] && typeof t[where.lift] === 'object' ? t[where.lift] : null) ?? t.lift1;
    if (flag === '--weight') return [[flag, String(li.weight ?? 0)]];
    if (flag === '--reps') return [[flag, String(li.reps ?? 0)]];
  }
  if (where.key === 'log ladder' && flag === '--id') {
    if (!ctx.ladder) throw new Skip('plan-data.json has no ladder');
    return [[flag, ctx.ladder]];
  }
  if (flag === '--level' && where.key === 'log ladder') return [[flag, '1']];
  if (flag === '--type') {
    // A fresh vault: a draft's session with --plan.
    const types = FRESH && where.flags.has('--plan') ? ctx.draftTypes : ctx.types;
    return [[flag, types.includes(value) ? value : (types[0] ?? 'A')]];
  }
  if (!placeholder) return [[flag, value]];
  switch (flag) {
    case '--date':
    case '--tape-from':
    case '--tests-from':
      return [[flag, /sunday/i.test(value) ? LAST_SUNDAY : /monday/i.test(value) ? NEXT_MONDAY : TODAY]];
    case '--tape-every':
    case '--tests-every':
      return [[flag, '14']];
    case '--amount':
      return [[flag, '250']];
    case '--time':
      return [[flag, '12:00']];
    case '--at':
      return [[flag, ctx.morningAt]];
    case '--lift': {
      if (!ctx.lift) throw new Skip('plan-data.json has no logged lift');
      const out = [[flag, ctx.lift.name]];
      if (/short/.test(value) && ctx.lift.short) out.push([flag, ctx.lift.short]);
      return out;
    }
    case '--item': {
      const id = /stand/.test(value) ? ctx.itemOfKind('standup') : /sitting/.test(value) ? ctx.itemOfKind('sitting') : ctx.items[0];
      if (!id) throw new Skip(`no tracked item for ${value}`);
      return [[flag, id]];
    }
    case '--id': {
      if (where.sub === 'tick') {
        const ids = where.flags.has('--amount') ? ctx.tickAmount : ctx.tickDone;
        if (!ids.length) throw new Skip(`no ${where.flags.has('--amount') ? 'amount' : 'tick'} item open today`);
        return [[flag, (/\[,/.test(value) ? ids.slice(0, 2) : ids.slice(0, 1)).join(',')]];
      }
      if (where.sub === 'accept' || where.sub === 'dismiss') {
        // No open suggestion: the documented exit 1 for an unknown suggestion id.
        if (!ctx.suggestions.length) {
          where.expect = { code: 1, error: 'unknown-suggestion', why: 'no open suggestion, so the documented exit 1 for an unknown id' };
          return [[flag, 'selfcheck-no-such-suggestion']];
        }
        return [[flag, ctx.suggestions[0]]];
      }
      break;
    }
    case '--plan': {
      if (!ctx.files.draft) throw new Skip(FRESH ? `${FRESH_NOTE}, and no sample plan to read` : 'plan-data.json is not valid JSON: no draft to read');
      return [[flag, ctx.files.draft]];
    }
    // overlap compares plan files: the draft and a blank one (no movements, so its shares are null).
    case '--plans': {
      if (!ctx.files.draft) throw new Skip(FRESH ? `${FRESH_NOTE}, and no sample plan to compare` : 'plan-data.json is not valid JSON: no draft to compare');
      return [[flag, `${ctx.files.draft},${ctx.files.blank}`]];
    }
    case '--file': {
      const file = { 'checkin add': 'answers', body: 'record', eating: 'plan', 'log add': 'session', 'track suggest': 'items', 'track add': 'items', 'track decline': 'items', 'track apply': 'changes', 'plan-write': 'draft' }[
        where.key
      ];
      if (file && ctx.files[file]) return [[flag, ctx.files[file]]];
      if (file) throw new Skip(`no example ${file} file`);
      break;
    }
    // catalogue's filters: values that meet in the catalogue (the seated, lying and slider leg curls), so every form finds movements.
    case '--pattern':
      return [[flag, 'hinge']];
    case '--region':
      return [[flag, 'hamstrings-knee']];
    case '--muscle':
      return [[flag, 'hamstrings']];
    case '--equipment':
      return [[flag, 'machine,band']];
    case '--query':
      return [[flag, 'leg curl']];
    // energy's judgment calls: an activity factor from diet.md's table, a rate inside the 1 % limit, three meals.
    case '--pal':
      return [[flag, '1.5']];
    case '--rate':
      return [[flag, '-0.0025']];
    case '--meals':
      return [[flag, '3']];
  }
  throw new Unfillable(`no safe value for ${flag} ${value}: teach selfcheck.mjs`);
}

// The runs one doc form gives: everything required; everything (the alternatives
// apart); each alternative left out; each other value of an enumeration.
function forms(cmd, exclusive) {
  const req = cmd.required.filter((p) => p.flag !== '...');
  const optional = cmd.optional.map((g) => g.filter((p) => p.flag !== '--write' && p.flag !== '...')).filter((g) => g.length);
  const ex = (a, b) => exclusive.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  const full = [...req];
  const left = [];
  for (const g of optional) {
    if (g.some((p) => full.some((q) => ex(p.flag, q.flag)))) left.push(g);
    else full.push(...g);
  }
  const list = [req, full];
  for (const g of left) list.push([...full.filter((q) => !g.some((p) => ex(p.flag, q.flag))), ...g]);
  for (const p of full) if (isEnum(p.value)) for (const v of p.value.split('|').slice(1)) list.push(full.map((q) => (q === p ? { ...q, value: v } : q)));
  return list;
}

// Every argv a form gives (a placeholder with alternatives multiplies it).
function argvs(cmd, pairs, ctx) {
  const where = { key: cmdKey(cmd), sub: cmd.words[1], flags: new Set(pairs.map((p) => p.flag)) };
  // No plan yet (and no draft in its place): the commands that need the plan's own sessions, lifts or ladders exit 1 with no-plan (numbers.md, "No plan yet").
  const needsPlan =
    where.key === 'log fix' ||
    where.key === 'log ladder' ||
    where.key === 'next' ||
    (where.key === 'session' && !where.flags.has('--plan') && (where.flags.has('--type') || where.flags.has('--freeze')));
  if (FRESH && needsPlan) {
    where.noPlan = true;
    where.expect = { code: 1, error: 'no-plan', why: `${FRESH_NOTE}: ${where.key} needs the plan` };
  }
  // energy without the profile's age and height, or without a weigh-in: its documented exit 1.
  if (where.key === 'energy' && ctx.energyMissing) where.expect = ctx.energyMissing;
  let out = [[...cmd.words, ...cmd.positional]];
  for (const p of pairs) {
    const alts = fill(p, where, ctx);
    out = out.flatMap((a) => alts.map((alt) => [...a, ...alt]));
  }
  return { list: out, expect: where.expect };
}

function judge(r, expect = { code: 0 }) {
  if (!r.json || typeof r.json !== 'object') return ['fail', `no JSON on stdout (exit ${r.code}): ${firstError(r)}`];
  if (r.json.written === true) return ['fail', 'it wrote without --write'];
  if (r.json.dryRun === false) return ['fail', 'not a dry run without --write'];
  // The plan check exits 1 on the plan's hard errors: the command works, the plan needs them fixed.
  const hard = expect.findings && r.code === 1 && Array.isArray(r.json.findings) ? [...new Set(r.json.findings.filter((x) => x.level === 'error').map((x) => x.code))] : [];
  if (hard.length) return ['pass', `exit 1 on the plan's hard errors (${hard.join(', ')}): the check works, the plan needs them fixed`];
  if (r.code !== expect.code) return ['fail', `exit ${r.code}, expected ${expect.code}: ${firstError(r)}`];
  if (expect.code === 0 && r.json.ok !== true) return ['fail', `exit 0 but ok is ${r.json.ok}: ${firstError(r)}`];
  if (expect.error && !(r.json.errors ?? []).some((e) => e.code === expect.error)) return ['fail', `exit ${r.code} without the ${expect.error} error: ${firstError(r)}`];
  if (expect.code !== 0) return ['pass', `exit ${r.code} with ${expect.error ?? 'its error'} (${expect.why})`];
  return ['pass', `exit 0, ok${r.json.dryRun === true ? ', a dry run' : ''}`];
}

// Does the output hold this field path? `a.b`, `a[]` (the first element), a
// rule's `{value, reason}` looked through.
function hasPath(obj, path) {
  let cur = obj;
  for (const raw of path.split('.')) {
    const list = raw.endsWith('[]');
    const key = list ? raw.slice(0, -2) : raw;
    if (cur == null || typeof cur !== 'object') return { ok: false };
    if (key in cur) cur = cur[key];
    else if (cur.value && typeof cur.value === 'object' && key in cur.value) cur = cur.value[key];
    else return { ok: false };
    if (list) {
      if (!Array.isArray(cur)) return { ok: false };
      if (!cur.length) return { ok: true, note: `${key} is empty here` };
      cur = cur[0];
    }
  }
  return { ok: true };
}

// The files the engine can write (its --write targets), to prove a run wrote none.
function writeTargets() {
  const files = [
    join(COACH, 'checkins.json'),
    join(COACH, 'tracking.json'),
    join(COACH, 'eating-plan.json'),
    join(COACH, 'nudges.json'),
    join(FITNESS, 'body-data.json'),
    join(FITNESS, 'fitness-log-data.json'),
    join(FITNESS, 'plan-data.json'),
    join(VAULT, LAYOUT.habits),
  ];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else files.push(join(d, e.name));
    }
  };
  walk(join(COACH, 'Inbox'));
  const out = new Map();
  for (const f of files) out.set(relative(VAULT, f), existsSync(f) ? createHash('sha256').update(readFileSync(f)).digest('hex') : null);
  return out;
}

async function checkCommands(help) {
  const numbers = read(join(REFS, 'numbers.md'));
  const subcommands = new Set([...help.keys()].filter((k) => k.includes(' ')).map((k) => k.split(' ')[0]));
  for (const s of help.values()) if (s.actions) subcommands.add(s.key);

  // The block's lines.
  const lines = fences(numbers)
    .flatMap((b) => b.text.split('\n'))
    .map((l) => /^\s*node\s+\S*engine\.cjs\s+(.*?)\s*(?:#.*)?$/.exec(l)?.[1])
    .filter(Boolean);
  if (!lines.length) {
    record(1, 'fail', 'numbers.md', 'no `node .claude/skills/fitness-coach/scripts/engine.cjs` lines in its code blocks');
    return;
  }
  const docs = lines.map((l) => ({ line: l, cmd: parseCommand(l, subcommands) }));

  // The track table: each action, what it takes (the "or"s are alternatives).
  const trackRows = tableRows(section(numbers, 'The write path: `track`') ?? [], 'Action');
  const trackActions = new Map();
  const exclusive = [];
  for (const [actionCell, takes = ''] of trackRows) {
    const groups = [];
    const parts = takes.split(/(`[^`]*`)/);
    let sep = '';
    for (const part of parts) {
      if (/^`[^`]*`$/.test(part)) {
        const text = part.slice(1, -1);
        if (groups.length && /\bor\b/.test(sep)) groups[groups.length - 1].push(text);
        else groups.push([text]);
        sep = '';
      } else sep += part;
    }
    // Alternatives exclude each other by the flags only one of them has (`--done` or `--amount`).
    for (const g of groups)
      for (let i = 0; i < g.length; i++)
        for (let j = i + 1; j < g.length; j++) {
          const fi = flagsOf(g[i]);
          const fj = flagsOf(g[j]);
          for (const a of fi) for (const b of fj) if (!fj.has(a) && !fi.has(b)) exclusive.push([a, b]);
        }
    // The cartesian product of the groups: each a set of args for the action.
    let combos = [''];
    for (const g of groups) combos = combos.flatMap((c) => g.map((alt) => `${c} ${alt}`));
    for (const name of spans(actionCell)) trackActions.set(name, { takes, combos });
  }

  const ctx = await vaultContext();
  const before = writeTargets();
  const jobs = [];
  const seen = new Set();
  const runForms = (label, cmd, pairsList) => {
    for (const pairs of pairsList) {
      let built;
      try {
        built = argvs(cmd, pairs, ctx);
      } catch (e) {
        if (e instanceof Skip || e instanceof Unfillable) {
          record(1, e instanceof Skip ? 'skip' : 'fail', `${label}: ${[...cmd.words, ...pairs.map((p) => p.flag)].join(' ')}`, e.message);
          continue;
        }
        throw e;
      }
      for (const argv of built.list) {
        const key = JSON.stringify(argv);
        if (seen.has(key)) continue;
        seen.add(key);
        jobs.push(
          engine(argv).then((r) => {
            const [status, reason] = judge(r, built.expect);
            record(1, status, `engine.cjs ${short(argv.join(' '))}`, reason);
          }),
        );
      }
    }
  };

  for (const { line, cmd } of docs) {
    const key = cmdKey(cmd);
    if (cmd.words[0] === 'track' && cmd.words[1] === '<action>') {
      // The template line: one run set per action in the track table (an
      // action with its own line in the block runs there, with the table's forms too).
      for (const [name, { combos }] of trackActions) {
        if (docs.some((d) => d.cmd.words[0] === 'track' && d.cmd.words[1] === name)) continue;
        for (const c of combos) {
          const sub = parseCommand(`track ${name} ${line.replace(/^track\s+<action>\s*/, '').replace(/\[\.\.\.\]/, '')} ${c}`, subcommands);
          runForms(`track ${name}`, sub, forms(sub, exclusive));
        }
      }
      continue;
    }
    if (cmd.words[0] === 'track' && trackActions.has(cmd.words[1])) {
      // An action with its own line: that line's forms, and the table's alternatives.
      const list = forms(cmd, exclusive);
      for (const c of trackActions.get(cmd.words[1]).combos) {
        const sub = parseCommand(`track ${cmd.words[1]} --vault . --json ${c}`, subcommands);
        list.push(...forms(sub, exclusive));
      }
      runForms(key, cmd, list);
      continue;
    }
    if (key === 'validate') {
      validateRuns(cmd, ctx, jobs);
      continue;
    }
    runForms(key, cmd, forms(cmd, exclusive));
  }

  // The question table: each row's command, its fields in the output.
  const rows = tableRows(section(numbers, 'Which command answers which question') ?? [], 'Question');
  for (const [question, commandCell = '', fieldsCell = ''] of rows) {
    const first = spans(commandCell)[0];
    if (!first) continue;
    let row = parseCommand(first, subcommands);
    if (row.words[0] === 'track' && row.words[1] === '<action>') row = { ...row, words: ['track', 'add'] };
    // The block's line for it (a track action: its own line, else the template line).
    const baseCmd =
      docs.find((d) => cmdKey(d.cmd) === cmdKey(row))?.cmd ??
      (row.words[0] === 'track' ? docs.find((d) => d.cmd.words[0] === 'track' && d.cmd.words[1] === '<action>')?.cmd : null);
    if (!baseCmd) {
      record(1, 'fail', `table: ${first}`, 'not a command of numbers.md\'s block');
      continue;
    }
    // The block's required flags, then the row's own (its optional ones included),
    // then for a track action what the track table says it takes.
    const rowPairs = [...row.required, ...row.optional.flat()].filter((p) => p.flag !== '--write' && p.flag !== '...');
    const pairs = [...baseCmd.required.filter((p) => p.flag !== '...' && !rowPairs.some((q) => q.flag === p.flag)), ...rowPairs];
    const takes = row.words[0] === 'track' ? trackActions.get(row.words[1])?.combos?.[0] : null;
    if (takes) pairs.push(...parseCommand(`x ${takes}`, new Set()).required.filter((p) => !pairs.some((q) => q.flag === p.flag)));
    const cmd = { ...row, positional: row.positional.length ? row.positional : baseCmd.positional };
    if (cmd.words[0] === 'validate') cmd.positional = [LAYOUT.profile];
    let fields = spans(dropParens(fieldsCell));
    // ".adherence" continues the list before it ("items[].streak, .adherence").
    let lastList = '';
    fields = fields.map((f) => {
      if (f.startsWith('.')) return `${lastList}${f}`;
      const m = /^(.*\[\])/.exec(f);
      if (m) lastList = m[1];
      return f;
    });
    let built;
    try {
      built = argvs(cmd, pairs, ctx);
    } catch (e) {
      if (e instanceof Skip || e instanceof Unfillable) {
        record(1, e instanceof Skip ? 'skip' : 'fail', `table: ${first}`, e.message);
        continue;
      }
      throw e;
    }
    const argv = built.list[0];
    jobs.push(
      engine(argv).then((r) => {
        const [status, reason] = judge(r, built.expect);
        if (status !== 'pass') return record(1, status, `table "${question.slice(0, 50)}": engine.cjs ${short(argv.join(' '))}`, reason);
        if (!fields.length) return record(1, 'pass', `table: ${first}`, 'runs (no fields named)');
        // A documented error (no plan yet, say): its fields come with what it waits for.
        if (built.expect && built.expect.code !== 0) return record(1, 'pass', `table: ${first}`, `${reason}; ${fields.join(', ')} wait for it`);
        const missing = [];
        const notes = [];
        for (const f of fields) {
          const h = hasPath(r.json, f);
          if (!h.ok) missing.push(f);
          else if (h.note) notes.push(h.note);
        }
        const what = `table: ${first} → ${fields.join(', ')}`;
        if (missing.length) record(1, 'fail', what, `not in the output of engine.cjs ${short(argv.join(' '))}: ${missing.join(', ')}`);
        else record(1, 'pass', what, `in the output${notes.length ? ` (${notes.join('; ')})` : ''}`);
      }),
    );
  }

  await Promise.all(jobs);
  const after = writeTargets();
  const changed = [...after.keys()].filter((k) => before.get(k) !== after.get(k));
  const n = runs.size;
  if (changed.length) record(1, 'fail', 'no writes', `changed during the runs: ${changed.join(', ')} (the engine, or Pahlavan if Obsidian is open: run again to tell)`);
  else record(1, 'pass', 'no writes', `the engine's ${after.size} write targets are unchanged after ${n} runs`);

  checkHelpFlags(help, docs, trackActions);
}

// validate <file>: the vault's coach files pass (kind inferred, then given), and the
// documented refusals: the vault's own files exit 2 with vaultFile, help.json exit 1.
function validateRuns(cmd, ctx, jobs) {
  const KIND = { 'profile.json': 'profile', 'ledger.json': 'ledger', 'checkins.json': 'checkin', 'tracking.json': 'tracking', 'eating-plan.json': 'eating', 'nudges.json': 'nudges', 'sitting.json': 'sitting' };
  const kinds = new Set((cmd.optional.flat().find((p) => p.flag === '--kind')?.value ?? '').split('|'));
  for (const [name, kind] of Object.entries(KIND)) {
    const rel = `${LAYOUT.coach}/${name}`;
    if (!existsSync(join(VAULT, rel))) continue;
    jobs.push(
      engine(['validate', rel, '--json']).then((r) => {
        let [status, reason] = judge(r);
        if (status === 'pass' && r.json.valid !== true) [status, reason] = ['fail', `valid is ${r.json.valid}: ${firstError(r)}`];
        if (status === 'pass' && r.json.kind !== kind) [status, reason] = ['fail', `inferred as ${r.json.kind}, not ${kind}`];
        if (status === 'pass') reason = `${reason}, valid as ${kind}`;
        else if (/schema|invalid/.test(reason)) reason += ' (the vault\'s file, not the doc)';
        record(1, status, `engine.cjs validate ${rel} --json`, reason);
      }),
    );
    if (!kinds.has(kind)) {
      record(1, 'fail', `validate --kind ${kind}`, `numbers.md's --kind list lacks ${kind} (${rel} is one)`);
      continue;
    }
    jobs.push(
      engine(['validate', rel, '--json', '--kind', kind]).then((r) => {
        const [status, reason] = judge(r);
        record(1, status === 'pass' && r.json.valid !== true ? 'fail' : status, `engine.cjs validate ${rel} --json --kind ${kind}`, reason);
      }),
    );
  }
  const refused = [LAYOUT.plan, LAYOUT.log, LAYOUT.body, LAYOUT.habits, LAYOUT.workTimer].filter(Boolean);
  for (const rel of refused) {
    if (!existsSync(join(VAULT, rel))) continue;
    jobs.push(
      engine(['validate', rel, '--json']).then((r) => {
        const ok = r.code === 2 && r.json?.vaultFile && r.json.kind === null && r.json.valid === null && (r.json.errors ?? []).some((e) => e.code === 'vault-file');
        record(1, ok ? 'pass' : 'fail', `engine.cjs validate ${rel} --json`, ok ? 'exit 2, refused as the vault\'s own file (as documented)' : `expected exit 2 with vaultFile and a vault-file error; got exit ${r.code}: ${firstError(r)}`);
      }),
    );
  }
  if (existsSync(join(COACH, 'help.json'))) {
    jobs.push(
      engine(['validate', LAYOUT.help, '--json']).then((r) => {
        const ok = r.code === 1 && /pass --kind/.test(firstError(r));
        record(1, ok ? 'pass' : 'fail', `engine.cjs validate ${LAYOUT.help} --json`, ok ? 'exit 1, "pass --kind" (as documented)' : `expected exit 1 "pass --kind"; got exit ${r.code}: ${firstError(r)}`);
      }),
    );
  }
}

// Each command's flags in numbers.md against its section of --help.
function checkHelpFlags(help, docs, trackActions) {
  const doc = new Map();
  const addDoc = (key, text) => {
    const d = doc.get(key) ?? { text: '' };
    d.text += ` ${text}`;
    doc.set(key, d);
  };
  for (const { line, cmd } of docs) {
    if (cmd.words[0] === 'track') addDoc(cmd.words[1] === '<action>' ? 'track' : `track ${cmd.words[1]}`, line.replace(/^track\s+\S+/, ''));
    else addDoc(cmdKey(cmd), line);
  }
  for (const [name, { takes }] of trackActions) addDoc(`track ${name}`, takes);

  const compare = (what, docText, helpText, drop = new Set()) => {
    const df = new Set([...flagsOf(docText)].filter((f) => !GLOBAL_FLAGS.has(f) && !drop.has(f)));
    const hf = new Set([...flagsOf(helpText)].filter((f) => !GLOBAL_FLAGS.has(f) && !drop.has(f)));
    const problems = [];
    const onlyDoc = [...df].filter((f) => !hf.has(f));
    const onlyHelp = [...hf].filter((f) => !df.has(f));
    if (onlyDoc.length) problems.push(`numbers.md has ${onlyDoc.join(', ')}; --help doesn't`);
    if (onlyHelp.length) problems.push(`--help has ${onlyHelp.join(', ')}; numbers.md doesn't`);
    const de = enumsOf(docText);
    const he = enumsOf(helpText);
    for (const [flag, hv] of he) {
      const dv = de.get(flag);
      if (!dv) continue;
      const lacks = [...hv].filter((v) => !dv.has(v));
      const extra = [...dv].filter((v) => !hv.has(v));
      if (lacks.length) problems.push(`${flag}: --help also takes ${lacks.join(', ')}; numbers.md's list doesn't`);
      if (extra.length) problems.push(`${flag}: numbers.md's list has ${extra.join(', ')}; --help doesn't`);
    }
    if (problems.length) record(1, 'fail', `--help vs numbers.md: ${what}`, problems.join('; '));
    else record(1, 'pass', `--help vs numbers.md: ${what}`, `flags match (${[...df].join(' ') || 'none'})`);
  };

  for (const [key, s] of help) {
    if (s.actions) {
      const common = s.usage.join(' ');
      compare(key, doc.get(key)?.text ?? '', common);
      const actionsDoc = [...doc.keys()].filter((k) => k.startsWith(`${key} `)).map((k) => k.slice(key.length + 1));
      const actionsHelp = [...s.actionLines.keys()];
      const missing = actionsHelp.filter((a) => !actionsDoc.includes(a));
      const extra = actionsDoc.filter((a) => !actionsHelp.includes(a));
      if (missing.length || extra.length)
        record(1, 'fail', `--help vs numbers.md: ${key} actions`, [missing.length && `--help has ${missing.join(', ')}; numbers.md doesn't`, extra.length && `numbers.md has ${extra.join(', ')}; --help doesn't`].filter(Boolean).join('; '));
      else record(1, 'pass', `--help vs numbers.md: ${key} actions`, `the same ${actionsHelp.length} actions`);
      const commonFlags = flagsOf(common);
      for (const a of actionsHelp) if (actionsDoc.includes(a)) compare(`${key} ${a}`, doc.get(`${key} ${a}`).text, s.actionLines.get(a).join(' '), commonFlags);
      continue;
    }
    if (!doc.has(key)) {
      record(1, 'fail', `--help vs numbers.md: ${key}`, `--help has the command ${key}; numbers.md's block doesn't`);
      continue;
    }
    compare(key, doc.get(key).text, s.lines.join(' '));
  }
  for (const key of doc.keys()) {
    const top = key.startsWith('track ') ? 'track' : key;
    if (!help.has(top)) record(1, 'fail', `--help vs numbers.md: ${key}`, `numbers.md has the command ${key}; --help doesn't`);
  }
}

// ---------- check 2: the JSON examples ----------

async function checkExamples() {
  let skipped = 0;
  const jobs = examples.map(async (ex, i) => {
    const what = `${ex.file}:${ex.line}`;
    if (ex.value === undefined || ex.value === null || typeof ex.value !== 'object' || Array.isArray(ex.value)) {
      skipped++;
      return record(2, 'skip', what, 'a fragment, not a whole JSON document');
    }
    const p = join(TMP, `example-${i}.json`);
    writeFileSync(p, ex.text);
    const r = await engine(['validate', p, '--json']);
    if (r.json?.kind == null) {
      skipped++;
      return record(2, 'skip', what, `not a whole record of a kind validate knows (${firstError(r)})`);
    }
    // engine validate's body kind is its own file; a {date, morning, tape, tests} record goes to engine body.
    if (r.json.kind === 'body' && ex.value.schemaVersion === undefined && typeof ex.value.date === 'string') {
      const b = await engine(['body', '--vault', '.', '--json', '--file', p], EMPTY_VAULT);
      const [status, reason] = judge(b);
      return record(2, status, `${what} (the body record file)`, status === 'pass' ? 'passes engine body (a dry run on an empty scratch vault)' : `engine body: ${reason}`);
    }
    if (r.code === 0 && r.json.valid === true) return record(2, 'pass', `${what} (${r.json.kind})`, 'valid');
    const errs = (r.json.errors ?? []).slice(0, 3).map((e) => e.message).join('; ');
    record(2, 'fail', `${what} (${r.json.kind})`, `engine validate: ${errs || firstError(r)}`);
  });
  await Promise.all(jobs);
  return skipped;
}

// ---------- check 3: the sections the job table names ----------

function checkSections() {
  const skill = read(join(SKILL, 'SKILL.md'));
  const rows = tableRows(section(skill, 'What each job reads') ?? [], 'Job');
  if (!rows.length) return record(3, 'fail', 'SKILL.md', 'no "What each job reads" table');
  // "file\0section\0parent" → jobs; a quoted name in parentheses is a part of
  // the section before it ("The tracking file" ("How an item gets there")).
  const cited = new Map();
  for (const [job, ...cells] of rows) {
    for (const cell of cells) {
      let file = null;
      let depth = 0;
      let parent = '';
      for (const m of cell.matchAll(/"([^"]+)"|([A-Za-z0-9_-]+\.md)|([()])/g)) {
        if (m[3]) depth = Math.max(0, depth + (m[3] === '(' ? 1 : -1));
        else if (m[2]) file = m[2];
        else if (file) {
          const key = [file, m[1], depth ? parent : ''].join('\0');
          if (!depth) parent = m[1];
          if (!cited.has(key)) cited.set(key, []);
          cited.get(key).push(job.replace(/`/g, ''));
        }
      }
    }
  }
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  // A heading, or one with its subtitle or heuristic mark after it ("The baseline
  // note: `baseline`", "`checkins.json` (the check-in answers, ...)", "Readiness **(H: thresholds)**").
  const findHeading = (hs, want) => hs.find((h) => h === want) ?? hs.find((h) => [':', ' (', ' **('].some((s) => h.startsWith(`${want}${s}`)));
  for (const [key, jobs] of cited) {
    const [file, title, parent] = key.split('\0');
    const what = parent ? `${file} "${parent}" ("${title}")` : `${file} "${title}"`;
    const by = [...new Set(jobs)].join(', ');
    const p = join(REFS, file);
    if (!existsSync(p)) {
      record(3, 'fail', what, `references/${file} does not exist (cited by ${by})`);
      continue;
    }
    const text = read(p);
    const want = norm(title);
    if (!parent) {
      const h = findHeading(headings(text), want);
      if (!h) record(3, 'fail', what, `no such heading in references/${file} (cited by ${by})`);
      else record(3, 'pass', what, h === want ? 'a heading' : `the heading "${h}"`);
      continue;
    }
    // A part: a heading or a bold lead ("**How an item gets there.**") inside the parent's section.
    const ph = findHeading(headings(text), norm(parent));
    const lines = ph ? section(text, ph) : null;
    if (!lines) {
      record(3, 'fail', what, `no heading "${parent}" in references/${file} to hold "${title}" (cited by ${by})`);
      continue;
    }
    const inner = lines.map((l) => /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(l)?.[1]).filter(Boolean).map(norm);
    const lead = lines.find((l) => norm(l).startsWith(`**${want}.**`) || norm(l).startsWith(`**${want}**`) || norm(l).startsWith(`**${want}:**`));
    const h = findHeading(inner, want);
    if (h) record(3, 'pass', what, `a heading inside "${ph}"`);
    else if (lead) record(3, 'pass', what, `a bold lead inside "${ph}"`);
    else record(3, 'fail', what, `no heading or bold lead "${title}" inside "${ph}" in references/${file} (cited by ${by})`);
  }
}

// ---------- check 4: the paths and /commands ----------

// What a fresh vault doesn't have yet: the coach's notes and folders its jobs
// write, a vault's own optional local.md, and Pahlavan's settings file (made
// on the plugin's first start). A missing one is skipped, never a failure.
const MADE_LATER = new Set(['local.md', 'Athlete profile.md', 'Ledger.md', 'Decisions.md', 'Eating plan.md', 'Letters', 'Experiments', 'Progress Photos', 'Progress Reports', 'data.json', '6-Month Roadmap.md']);
const madeLater = (p) => MADE_LATER.has(p.replace(/\/+$/, '').split('/').pop());

function checkPaths() {
  const docs = [join(SKILL, 'SKILL.md'), ...readdirSync(REFS).filter((f) => f.endsWith('.md')).map((f) => join(REFS, f))];
  const PREFIX = /(?:^|[\s"'(=])((?:<fitness>|\.obsidian|\.claude)\/[^`]*)/;
  const paths = new Map(); // path → first place
  const commands = new Map();
  let skipped = 0;
  const addPath = (candidate, where) => {
    // A command's arguments are not the path.
    const p = candidate
      .replace(/\s+/g, ' ')
      .split(/\s(?:--?[a-z]|\[|\||&&|;)/i)[0]
      .replace(/[)"'.,;:]+$/, '')
      .trim();
    // `<fitness>` is the vault's fitness folder.
    const real = p.replace(/^<fitness>\//, `${LAYOUT.fitness}/`);
    if (!paths.has(real)) paths.set(real, where);
  };
  for (const file of docs) {
    const text = read(file);
    const name = relative(SKILL, file);
    const body = prose(text);
    for (const s of spans(body)) {
      const m = PREFIX.exec(` ${s}`);
      if (m) addPath(m[1], name);
    }
    // The commands' code blocks too; a json or markdown block is an example, its paths illustrations.
    for (const b of fences(text)) {
      if (/^(json|markdown|md)$/i.test(b.lang)) continue;
      const re = /"((?:<fitness>|\.obsidian|\.claude)\/[^"]+)"|'((?:<fitness>|\.obsidian|\.claude)\/[^']+)'|(?:^|[\s(=])((?:<fitness>|\.obsidian|\.claude)\/[^\s"')\]`]+)/g;
      for (const m of b.text.matchAll(re)) addPath(m[1] ?? m[2] ?? m[3], `${name} (code)`);
    }
    for (const m of body.matchAll(/(?<![\w./:~-])\/([a-z][a-z0-9-]*)(?![\w/.-])/g)) if (!commands.has(m[1])) commands.set(m[1], name);
  }
  const done = new Set();
  const pass = (p, where) => {
    if (done.has(p)) return;
    done.add(p);
    record(4, 'pass', p, `exists (${where})`);
  };
  for (const [p, where] of paths) {
    if (existsSync(join(VAULT, p))) {
      pass(p, where);
      continue;
    }
    // A script and its arguments ("fitness_log.py ladder <id> <level>"): the first word is the path.
    const firstWord = p.split(' ')[0];
    if (firstWord !== p && existsSync(join(VAULT, firstWord))) pass(firstWord, where);
    else if (/[<>*?{}]|YYYY/.test(p)) skipped++; // a placeholder or a glob, not a path to check
    else if (madeLater(p)) skipped++; // a file a job writes, or a vault's own optional one: not there yet in a fresh vault
    else record(4, 'fail', p, `not in the vault (named in ${where})`);
  }
  const home = homedir();
  const places = (n) => [
    join(home, '.claude', 'commands', `${n}.md`),
    join(VAULT, '.claude', 'commands', `${n}.md`),
    join(VAULT, '.claude', 'skills', n, 'SKILL.md'),
    join(home, '.claude', 'skills', n, 'SKILL.md'),
    join(home, '.agents', 'skills', n, 'SKILL.md'),
  ];
  for (const [n, where] of commands) {
    const found = places(n).find((p) => existsSync(p));
    if (found) record(4, 'pass', `/${n}`, `${found.replace(home, '~')}`);
    else record(4, 'fail', `/${n}`, `no command or skill named ${n} in ~/.claude/commands, ~/.claude/skills, ~/.agents/skills or the vault's .claude/ (named in ${where})`);
  }
  return skipped;
}

// ---------- check 5: the version ----------

function checkVersion(helpText) {
  const file = existsSync(join(SKILL, 'scripts', 'VERSION')) ? read(join(SKILL, 'scripts', 'VERSION')) : '';
  const fv = /^engine\s+(\S+)/m.exec(file)?.[1];
  const fs = /^schema\s+(\S+)/m.exec(file)?.[1];
  const hm = /pahlavan engine (\S+) \(schema v(\d+)\)/.exec(helpText);
  if (!fv) record(5, 'fail', 'scripts/VERSION', 'no "engine <version>" line');
  else if (!hm) record(5, 'fail', 'engine.cjs --help', 'no "pahlavan engine <version> (schema v<n>)" header');
  else if (fv !== hm[1] || fs !== hm[2]) record(5, 'fail', 'scripts/VERSION vs --help', `VERSION says engine ${fv}, schema ${fs}; --help says ${hm[1]}, schema ${hm[2]}`);
  else record(5, 'pass', 'scripts/VERSION vs --help', `engine ${fv}, schema ${fs}`);
  const versionTs = join(opts.repo, 'src', 'core', 'version.ts');
  if (!existsSync(versionTs)) return record(5, 'skip', 'the repo\'s src/core/version.ts', `no checkout at ${opts.repo}`);
  const rv = /ENGINE_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(read(versionTs))?.[1];
  if (!rv) record(5, 'fail', versionTs, 'no ENGINE_VERSION');
  else if (rv !== fv) record(5, 'fail', 'scripts/VERSION vs the repo', `VERSION says ${fv}; ${versionTs.replace(homedir(), '~')} says ${rv} (ship again: npm run ship-skill)`);
  else record(5, 'pass', 'scripts/VERSION vs the repo', `${rv} in ${versionTs.replace(homedir(), '~')}`);
}

// ---------- check 6: the docs against the engine's facts ----------

// The skill's own text: SKILL.md and every reference file.
function skillDocs() {
  const files = [['SKILL.md', join(SKILL, 'SKILL.md')]];
  for (const f of readdirSync(REFS).filter((x) => x.endsWith('.md')).sort()) files.push([`references/${f}`, join(REFS, f)]);
  return files.map(([name, path]) => ({ name, text: read(path) }));
}

// Prose as sentences: fenced blocks dropped, each paragraph, list item and
// table row joined onto one line, then split at sentence ends. Each sentence
// keeps the heading it sits under and maps a place in it back to its line.
function sentences(text) {
  const out = [];
  let block = [];
  let heading = '';
  const flush = () => {
    if (!block.length) return;
    let joined = '';
    const starts = [];
    for (const b of block) {
      if (joined) joined += ' ';
      starts.push([joined.length, b.line]);
      joined += b.text.replace(/\s+/g, ' ');
    }
    const lineAt = (off) => starts.reduce((l, [o, ln]) => (o <= off ? ln : l), starts[0][1]);
    let from = 0;
    const parts = [];
    for (const m of joined.matchAll(/(?<=[.!?](?:\*\*)?)\s+(?=[A-Z*`"(])/g)) {
      parts.push([from, joined.slice(from, m.index)]);
      from = m.index + m[0].length;
    }
    parts.push([from, joined.slice(from)]);
    for (const [off, part] of parts) if (part.trim()) out.push({ line: lineAt(off), text: part, heading, lineOf: (i) => lineAt(off + i) });
    block = [];
  };
  prose(text)
    .split('\n')
    .forEach((line, i) => {
      const t = line.trim();
      const opens = !t || /^(#{1,6}\s|[-*]\s|\d+\.\s|\|)/.test(t);
      if (opens) flush();
      if (/^#{1,6}\s/.test(t)) heading = t.replace(/^#+\s+/, '');
      if (t) {
        block.push({ line: i + 1, text: t });
        if (t.startsWith('|') || t.startsWith('#')) flush();
      }
    });
  flush();
  return out;
}

// A range of whole numbers, not a decimal, a "12–18+" or one counting minutes, reps, weeks or a load.
const RANGE = /(?<![\d.])\b(\d+)\s*(?:–|-|to)\s*(\d+)\b(?![.\d+])(?!\s*(?:%|min\b|reps?\b|s\b|weeks?\b|kg\b|lb\b|direct sets))/g;
const inRange = (n, lo, hi) => n >= lo && n <= hi;
// Every match of the patterns in a sentence: its value and where it is.
const hits = (text, res, value) => res.flatMap((re) => [...text.matchAll(re)].map((m) => ({ got: value(m), at: m.index })));
const ranges = (text, keep) => hits(text, [RANGE], (m) => [Number(m[1]), Number(m[2])]).filter((h) => keep(...h.got));

// The doc rules: each finds the numbers a sentence quotes for one fact (`when`
// sees the sentence and the heading above it).
function numberRules(facts) {
  const v = facts.volume;
  const lw = facts.lightWeeks;
  const lighter = Math.round((1 - lw.load) * 100);
  const notBias = (t) => !/\bbias\b|calibration set|rirCalibration/i.test(t);
  return [
    {
      what: 'the calibration RIR',
      want: facts.calibration.rir,
      when: (s) => (/calibrat/i.test(s.text) || /calibrat/i.test(s.heading)) && notBias(s.text),
      find: (t) => hits(t, [/\b(\d+) reps? in reserve/g, /(?<![+\d])\bRIR (?:≥ ?|of )?(\d+)\b(?!\s*[–-])/g], (m) => Number(m[1])),
    },
    {
      what: 'the priority tier',
      want: v.priority,
      when: (s) => /priorit/i.test(s.text),
      find: (t) => ranges(t, (lo, hi) => inRange(lo, 8, 12) && inRange(hi, 12, 20) && !(lo === v.efficient[1] && hi === v.efficient[1])),
    },
    {
      what: 'the efficient tier',
      want: v.efficient,
      when: (s) => /\b(?:the rest|efficient)\b/i.test(s.text) && /\bsets?\b|tier/i.test(s.text),
      find: (t) => ranges(t, (lo, hi) => inRange(lo, 4, 6) && inRange(hi, 8, 12)),
    },
    {
      what: 'the cap',
      want: v.cap,
      when: (s) => /\b(?:cap|over|above)\b/i.test(s.text),
      find: (t) => ranges(t, (lo, hi) => inRange(lo, 18, 22) && inRange(hi, 22, 28)),
    },
    {
      what: 'the minimum dose',
      want: v.minimum,
      when: () => true,
      find: (t) => hits(t, [/\b(?:none|never|no muscle)\s+under\s+(\d+)\b(?![.\d–-])/gi], (m) => Number(m[1])),
    },
    {
      what: 'the tier edges',
      want: [v.minimum, v.minimum, v.efficient[1], v.efficient[1], v.priority[1], v.priority[1], v.cap[0], v.cap[0]],
      when: () => true,
      find: (t) => hits(t, [/under (\d+), (\d+)-(\d+), (\d+)-(\d+), (\d+)-(\d+), over (\d+)/g], (m) => m.slice(1).map(Number)),
    },
    {
      what: 'the per-session cap',
      want: v.perSessionDirect,
      when: (s) => /session/i.test(s.text),
      find: (t) => hits(t, [/(?:at most|≤|more than|past about|about)\s*(?:\d+\s*[–-]\s*)?(\d+)\s+direct sets/g], (m) => Number(m[1])),
    },
    {
      what: 'the default light week\'s sets',
      want: lw.sets,
      when: () => true,
      find: (t) => hits(t, [/\b(\d+) sets of everything/g], (m) => Number(m[1])),
    },
    {
      what: 'the default light week\'s load',
      want: lighter,
      when: (s) => /light[- ]?weeks?|deload|sets of everything/i.test(s.text) || /light week|deload/i.test(s.heading),
      find: (t) => hits(t, [/about (\d+) ?% lighter/g], (m) => Number(m[1])),
    },
    {
      what: 'the default light-week timing',
      want: lw.every,
      when: (s) => /default/i.test(s.text) && (/light[- ]?weeks?|deload|lighter|sets of everything/i.test(s.text) || /light week|deload/i.test(s.heading)),
      find: (t) => hits(t, [/every (\d+)(?:st|nd|rd|th) (?:plan )?weeks?/gi], (m) => Number(m[1])),
    },
    {
      what: 'the light week\'s added RIR',
      want: lw.rirAdd,
      when: (s) => /light week|deload|half the sets/i.test(s.text),
      find: (t) => hits(t, [/RIR \+(\d+)/g, /target \+ (\d+)/g], (m) => Number(m[1])),
    },
    {
      what: 'the region coverage rule',
      want: facts.regions.coverage,
      when: (s) => /region|coverage/i.test(s.text),
      find: (t) => hits(t, [/at least (\d+) direct sets a week/g], (m) => Number(m[1])),
    },
    {
      what: 'a declared region\'s sets',
      want: facts.regions.declared,
      when: (s) => /region|declared/i.test(s.text),
      find: (t) => hits(t, [/\b(\d+) direct sets near failure/g], (m) => Number(m[1])),
    },
    ...energyRules(facts.energy),
  ];
}

// The eating plan's energy constants (`energy`), each in the words diet.md
// and numbers.md say it; an engine without them in its facts has none to hold.
function energyRules(e) {
  if (!e) return [];
  const num = (s) => Number(s.replace(/,/g, ''));
  const always = () => true;
  return [
    {
      what: 'the Mifflin-St Jeor constants',
      want: [e.mifflin.perKg, e.mifflin.perCm, -e.mifflin.perYear, e.mifflin.male, -e.mifflin.female],
      when: always,
      find: (t) => hits(t, [/(\d+) × kg \+ (\d+(?:\.\d+)?) × cm − (\d+) × age \+ (\d+) \(men\) or − (\d+) \(women\)/g], (m) => m.slice(1).map(Number)),
    },
    {
      what: 'the estimate\'s accuracy',
      want: Math.round(e.accuracy * 100),
      when: always,
      find: (t) => hits(t, [/±(\d+) ?% for most people/g], (m) => Number(m[1])),
    },
    {
      what: 'the activity factors',
      want: e.pal.levels.flatMap((l) => l.range),
      when: always,
      find: (t) => hits(t, [/(\d\.\d{2})[–-](\d\.\d{2}) sedentary or light, (\d\.\d{2})[–-](\d\.\d{2}) active, (\d\.\d{2})[–-](\d\.\d{2}) vigorous/g], (m) => m.slice(1).map(Number)),
    },
    {
      what: 'the kcal per kg of change',
      want: e.kcalPerKg,
      when: always,
      find: (t) => hits(t, [/about (\d{1,2},\d{3}) kcal per kg/g], (m) => num(m[1])),
    },
    ...(e.goalKcal
      ? [
          {
            what: 'recomposition\'s goal energy',
            want: -e.goalKcal.recomposition[0],
            when: always,
            find: (t) => hits(t, [/recomposition:? maintenance (?:down )?to [−-](\d+) kcal/gi], (m) => Number(m[1])),
          },
          {
            what: 'gain\'s goal energy',
            want: [...e.goalKcal.gain],
            when: always,
            find: (t) => hits(t, [/gain:? \+(\d+)\s*(?:–|-|to \+?)\s*(\d+) kcal/gi], (m) => [Number(m[1]), Number(m[2])]),
          },
        ]
      : []),
    {
      what: 'the energy floors',
      want: [e.floorKcal.male, e.floorKcal.female],
      when: always,
      find: (t) => hits(t, [/\b(\d,\d{3})(?: kcal(?: a day)?)? for men, (\d,\d{3}) for women/g], (m) => [num(m[1]), num(m[2])]),
    },
    {
      what: 'the loss limit',
      want: Math.round(-e.maxLossPctPerWeek * 100),
      when: always,
      find: (t) => hits(t, [/(?:beyond|faster than) \**(\d+) ?% of body weight a week/g], (m) => Number(m[1])),
    },
    {
      what: 'protein a meal',
      want: [...e.perMealGPerKg],
      when: always,
      find: (t) => hits(t, [/about (0\.\d+) g\/kg \(up to (0\.\d+)\)/gi, /about (0\.\d+) g\/kg a meal, up to (0\.\d+)/gi], (m) => [Number(m[1]), Number(m[2])]),
    },
    {
      what: 'the fat minimum',
      want: Math.round(e.fat.minShare * 100),
      when: always,
      find: (t) => hits(t, [/at least (\d+) ?% of energy/gi], (m) => Number(m[1])),
    },
    {
      what: 'the fiber rule',
      want: e.fiber.per1000kcal,
      when: always,
      find: (t) => hits(t, [/about (\d+) g per 1,000 kcal/g], (m) => Number(m[1])),
    },
    {
      what: 'the fiber minimum',
      want: e.fiber.minG,
      when: (s) => /fiber/i.test(s.text),
      find: (t) => hits(t, [/\b(\d+)(?:[–-]\d+)? g a day or more/g, /\bat least (\d+) g\b/g], (m) => Number(m[1])),
    },
  ];
}

// The JSON examples' numbers, in an example the prose above it calls the
// default (the standing rules' example is the old default; an example of a
// coach's own rule may hold any valid value).
function jsonRules(facts) {
  const lw = facts.lightWeeks;
  return [
    { what: 'the calibration RIR (JSON)', re: /"calibration":\s*\{[^}]*?"rir":\s*(\d+(?:\.\d+)?)/g, want: facts.calibration.rir },
    { what: 'the light week\'s timing (JSON)', re: /"lightWeeks":\s*\{[^}]*?"every":\s*(\d+(?:\.\d+)?)/g, want: lw.every },
    { what: 'the light week\'s sets (JSON)', re: /"lightWeeks":\s*\{[^}]*?"sets":\s*(\d+(?:\.\d+)?)/g, want: lw.sets },
    { what: 'the light week\'s load (JSON)', re: /"lightWeeks":\s*\{[^}]*?"load":\s*(\d+(?:\.\d+)?)/g, want: lw.load },
    { what: 'the light week\'s added RIR (JSON)', re: /"lightWeeks":\s*\{[^}]*?"rirAdd":\s*(\d+(?:\.\d+)?)/g, want: lw.rirAdd },
  ];
}
// The prose just above a fenced block (back to the heading or block before it).
function introOf(text, fence) {
  const lines = text.split('\n');
  const out = [];
  for (let i = fence.start - 3; i >= 0; i--) {
    const t = lines[i].trim();
    if (/^#{1,6}\s/.test(t) || /^(`{3,}|~{3,})/.test(t)) break;
    out.unshift(t);
  }
  return out.join(' ');
}

// Words a "no field" claim may use for a field the engine has.
const FIELD_WORDS = [
  [/\bRIR\b(?! wave)|reps in reserve/i, 'rir'],
  [/interval structure|\bintervals\b/i, 'timed'],
  [/\blight[- ]weeks?\b|\bdeloads?\b/i, 'lightWeeks'],
  [/calibration week/i, 'calibration'],
  [/\btest weeks?\b/i, 'tests'],
  [/\bprogression rule/i, 'progression'],
  [/\boverrides?\b/i, 'overrides'],
  [/\bphase names\b/i, 'phases'],
  [/\bstanding rules\b/i, 'rules'],
];
const NO_FIELD = /\b(?:is|are) not a field\b|\bha(?:s|ve) no field\b|\bno field for\b|\bcan'?t be set in `?plan-data|\bcannot be set in `?plan-data/i;

// A backticked phrase starting with one of these is a command line, not an unexpressible kind.
const COMMAND_WORDS = new Set(['npm', 'node', 'engine', 'plan-write', 'draft', 'overlap', 'review', 'check', 'catalogue', 'evidence', 'log', 'track', 'checkin', 'validate', 'session', 'body', 'eating', 'inbox', 'folders', 'baseline', 'food', 'tracked', 'habits', 'due', 'next', 'readiness', 'bring-over', 'energy']);

// The Python blocks the engine doesn't replace yet, by file and the heading above them.
const PYTHON_ALLOWED = [['references/tracking.md', 'Amounts: water']];

async function checkFacts() {
  const v = await engine(['--version', '--json']);
  const facts = v.json?.facts;
  if (!facts) return record(6, 'fail', 'engine.cjs --version --json', 'no `facts` in its output: ship an engine of 0.26 or later (npm run ship-skill)');
  record(6, 'pass', 'engine.cjs --version --json', `facts: ${Object.keys(facts).join(', ')}`);
  const docs = skillDocs();

  // Numbers in prose, and in the JSON examples.
  const rules = numberRules(facts);
  const seen = new Map(rules.map((r) => [r.what, 0]));
  for (const { name, text } of docs) {
    for (const s of sentences(text)) {
      for (const r of rules) {
        if (!r.when(s)) continue;
        for (const { got, at } of r.find(s.text)) {
          seen.set(r.what, seen.get(r.what) + 1);
          const near = s.text.slice(Math.max(0, at - 50), at + 70);
          if (JSON.stringify(got) !== JSON.stringify(r.want)) record(6, 'fail', `${name}:${s.lineOf(at)}`, `${r.what} is ${JSON.stringify(r.want)} in the engine, the text says ${JSON.stringify(got)}: "…${near}…"`);
        }
      }
    }
    for (const f of fences(text).filter((x) => /default/i.test(introOf(text, x)))) {
      for (const r of jsonRules(facts)) {
        for (const m of f.text.matchAll(r.re)) {
          seen.set(r.what, (seen.get(r.what) ?? 0) + 1);
          const line = f.start + (f.text.slice(0, m.index).match(/\n/g)?.length ?? 0);
          if (Number(m[1]) !== r.want) record(6, 'fail', `${name}:${line}`, `${r.what} is ${r.want} in the engine, the example of the default says ${m[1]}`);
        }
      }
    }
  }
  for (const [what, n] of seen) record(6, 'pass', `numbers: ${what}`, n ? `${n} mention(s) checked` : 'not quoted');

  // "No field" claims, and the unexpressible kinds the docs name.
  const keys = new Set([...facts.planData.keys, ...facts.planData.itemKeys, ...facts.planData.liftKeys, ...facts.planData.ruleKinds]);
  const kinds = new Set(facts.unexpressible);
  let claims = 0;
  let named = 0;
  for (const { name, text } of docs) {
    for (const s of sentences(text)) {
      if (NO_FIELD.test(s.text)) {
        claims++;
        const ids = [...spans(s.text).map((x) => x.replace(/^.*\./, '')), ...FIELD_WORDS.filter(([re]) => re.test(s.text)).map(([, k]) => k)];
        const has = [...new Set(ids)].filter((k) => keys.has(k));
        if (has.length) record(6, 'fail', `${name}:${s.lineOf(NO_FIELD.exec(s.text)?.index ?? 0)}`, `says there is no field, but the engine has ${has.map((k) => `\`${k}\``).join(', ')}: "${s.text.slice(0, 120)}"`);
      }
      if (s.text.includes('`unexpressible`')) {
        for (const k of spans(s.text).filter((x) => / /.test(x) && !x.includes('--') && /^[A-Za-z][A-Za-z' -]*$/.test(x) && !COMMAND_WORDS.has(x.split(' ')[0]))) {
          named++;
          if (!kinds.has(k)) record(6, 'fail', `${name}:${s.lineOf(Math.max(0, s.text.indexOf(`\`${k}\``)))}`, `names the unexpressible kind \`${k}\`, which the engine never lists (it lists: ${[...kinds].join(', ')})`);
        }
      }
    }
  }
  record(6, 'pass', '"no field" claims', `${claims} checked against the engine's plan-data keys`);
  record(6, 'pass', 'unexpressible kinds', `${named} named, checked against the engine's list`);

  // Python blocks.
  for (const { name, text } of docs) {
    const lines = prose(text).split('\n');
    for (const f of fences(text).filter((x) => x.lang === 'python')) {
      const above = lines.slice(0, f.start - 1).reverse().find((l) => /^#{1,6}\s/.test(l));
      const heading = above ? above.replace(/^#+\s+/, '').trim() : '';
      const ok = PYTHON_ALLOWED.some(([file, h]) => file === name && heading.startsWith(h));
      record(6, ok ? 'pass' : 'fail', `${name}:${f.start}`, ok ? `the allowlisted "${heading}" snippet` : `a Python block under "${heading}": the engine has the command for it, or it goes into PYTHON_ALLOWED with a reason`);
    }
  }

  // Engine output naming a vault-only script (every run this self-check made).
  // A vault's own words carried through (its plan file's `_about` note, say)
  // are its own: only the engine's text counts, so those strings come out first.
  const SCRIPT = /fitness_log\.py|gen-fitness-plan/;
  const echoed = vaultPlanStrings().filter((s) => SCRIPT.test(s));
  const engineText = (t) => echoed.reduce((acc, s) => acc.split(JSON.stringify(s).slice(1, -1)).join('').split(s).join(''), t);
  const all = await Promise.all([...runs.entries()].map(async ([key, p]) => [JSON.parse(key)[1], await p]));
  const named2 = all.filter(([, r]) => SCRIPT.test(engineText(`${r.stdout}\n${r.stderr}`)));
  if (named2.length) for (const [args] of named2) record(6, 'fail', `engine.cjs ${args.join(' ')}`, 'its output names a vault-only script (fitness_log.py or gen-fitness-plan): the engine\'s own command does that work');
  else record(6, 'pass', 'engine output', `${all.length} runs name no vault-only script`);
}

/** Every string value in the vault's own plan file (none when it can't be found or read). */
function vaultPlanStrings() {
  try {
    const folders = JSON.parse(execFileSync('node', [ENGINE, 'folders', '--vault', VAULT, '--json'], { encoding: 'utf8' }));
    const rel = folders?.paths?.plan;
    if (typeof rel !== 'string') return [];
    const out = [];
    const walk = (v) => {
      if (typeof v === 'string') out.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(JSON.parse(readFileSync(resolve(VAULT, rel), 'utf8')));
    return out;
  } catch {
    return [];
  }
}

// ---------- run ----------

async function main() {
  const helpRun = await engine(['--help']);
  const helpText = helpRun.stdout;
  if (helpRun.code !== 0 || !/Commands/.test(helpText)) {
    record(1, 'fail', 'engine.cjs --help', `exit ${helpRun.code}: ${firstError(helpRun)}`);
  }
  const help = parseHelp(helpText);
  const notes = {};
  await checkCommands(help);
  notes[2] = await checkExamples();
  checkSections();
  notes[4] = checkPaths();
  checkVersion(helpText);
  await checkFacts();

  const count = (list, s) => list.filter((r) => r.status === s).length;
  const passed = count(results, 'pass');
  const failed = count(results, 'fail');
  const skipped = count(results, 'skip');
  const version = /pahlavan engine (\S+)/.exec(helpText)?.[1] ?? '?';
  if (opts.json) {
    const out = { ok: failed === 0, engine: version, vault: VAULT, date: TODAY, fresh: FRESH, passed, failed, skipped, engineRuns: runs.size, results };
    console.log(JSON.stringify(out, null, 2));
  } else {
    const lines = [`fitness-coach selfcheck: ${passed} passed, ${failed} failed, ${skipped} skipped (engine ${version}, ${runs.size} engine runs, ${TODAY})`];
    if (FRESH) lines.push(`  ${FRESH_NOTE}: the commands answer with a no-plan warning, the draft runs read the made-up sample plan, and what needs the plan's sessions, lifts or ladders is held to its documented no-plan error`);
    for (const [n, name] of Object.entries(CHECKS)) {
      const mine = results.filter((r) => r.check === Number(n));
      const extra = n === '2' ? ` (${notes[2]} not whole records)` : n === '4' && notes[4] ? ` (${notes[4]} placeholder paths not checked)` : '';
      lines.push(`  ${n} ${name.padEnd(20)} ${count(mine, 'pass')} passed, ${count(mine, 'fail')} failed, ${count(mine, 'skip')} skipped${extra}`);
    }
    const fails = results.filter((r) => r.status === 'fail');
    if (fails.length) {
      lines.push('Failed:');
      for (const r of fails) lines.push(`  [${r.check}] ${r.what}: ${r.reason}`);
    }
    console.log(lines.join('\n'));
  }
  return failed === 0 ? 0 : 1;
}

let code = 1;
try {
  code = await main();
} catch (e) {
  console.error(`selfcheck: crashed: ${e.stack ?? e}`);
  code = 1;
} finally {
  rmSync(TMP, { recursive: true, force: true });
}
process.exit(code);
