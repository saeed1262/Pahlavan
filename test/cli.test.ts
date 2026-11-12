// The CLI: its logic through `run` with an in-memory vault, then the built
// dist/engine.cjs spawned on the synthetic vault (test/fixtures/vault), whose
// numbers must match the numbers.md snippets (expected.json, computed outside
// this code base) except for the differences the README documents.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { engineFacts, HELP, run, VERSION_LINE } from '../src/cli/cli.ts';
import { CALIBRATION } from '../src/core/calibration.ts';
import { DELOAD } from '../src/core/deload.ts';
import { ITEM_KEYS, PLAN_DATA_KEYS, UNEXPRESSIBLE } from '../src/core/plan-data.ts';
import { REGION_RULES, VOLUME } from '../src/core/volume.ts';
import { readinessSeries } from '../src/core/readiness.ts';
import { SCHEMA_VERSION } from '../src/core/schema.ts';
import { ENGINE_VERSION } from '../src/core/version.ts';
import { approx, builtEngine, FIXTURE_FOLDERS, fixtureFiles, memoryIo, ROOT, VAULT } from './helpers.ts';

const PROFILE = join(VAULT, '3-Personal', 'Fitness', 'Coach', 'profile.json');
/** The profile inside the in-memory vault (`mem()`'s files). */
const PROFILE_V = 'v/3-Personal/Fitness/Coach/profile.json';
const LEDGER = join(VAULT, '3-Personal', 'Fitness', 'Coach', 'ledger.json');
const expected = JSON.parse(readFileSync(join(VAULT, 'expected.json'), 'utf8'));

type Json = Record<string, any>;
const parse = (r: { stdout: string }) => JSON.parse(r.stdout) as Json;
const mem = (edit: (f: Record<string, string>) => void = () => {}) => {
  const f = fixtureFiles('v');
  edit(f);
  return memoryIo(f);
};

describe('cli: version and help', () => {
  it('keeps the engine version equal to package.json, and the plugin\'s manifest.json with them', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
    assert.equal(ENGINE_VERSION, pkg.version);
    assert.equal(SCHEMA_VERSION, 1);
    // The plugin's banner names both ("Pahlavan <manifest> (engine <package>)"): one release carries one version.
    const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')) as { version: string };
    assert.equal(manifest.version, pkg.version);
  });

  it('prints the engine and schema versions, as text or JSON', () => {
    assert.deepEqual(run(['--version']), { code: 0, stdout: `pahlavan engine ${ENGINE_VERSION} (schema v1)\n`, stderr: '' });
    assert.equal(run(['-v']).stdout, `${VERSION_LINE}\n`);
    const v = parse(run(['--version', '--json']));
    assert.deepEqual([v.engine, v.schema], [ENGINE_VERSION, 1]);
  });

  it('gives the facts the coach\'s docs quote with --version --json, from the engine\'s own constants', () => {
    const { facts } = parse(run(['--version', '--json']));
    assert.deepEqual(facts, engineFacts());
    assert.equal(facts.calibration.rir, CALIBRATION.rir);
    assert.deepEqual([facts.volume.minimum, facts.volume.efficient, facts.volume.priority, facts.volume.cap], [VOLUME.bands.minimum, [...VOLUME.bands.efficient], [...VOLUME.bands.priority], [...VOLUME.bands.cap]]);
    assert.deepEqual(facts.lightWeeks, { every: DELOAD.every, sets: DELOAD.legacySets, load: DELOAD.legacyLoadFactor, rirAdd: DELOAD.rirAdd });
    assert.deepEqual(facts.regions, { ...REGION_RULES });
    assert.deepEqual(facts.planData.itemKeys, [...ITEM_KEYS]);
    assert.ok(facts.planData.itemKeys.includes('rir') && facts.planData.itemKeys.includes('timed'));
    assert.ok(facts.planData.keys.includes('rules') && facts.planData.keys.includes('overrides'));
    assert.ok(facts.planData.ruleKinds.includes('lightWeeks') && !(facts.planData.ruleKinds as string[]).includes('express'));
    assert.deepEqual(facts.unexpressible, [...UNEXPRESSIBLE]);
    assert.ok(facts.unexpressible.includes('why lines'));
  });

  it('prints help with no arguments, --help, or a command and --help', () => {
    assert.equal(run([]).stdout, HELP);
    assert.equal(run(['--help']).code, 0);
    assert.equal(run(['review', '--help']).stdout, HELP);
    for (const c of ['review', 'readiness', 'next', 'draft', 'plan-write', 'validate', '--pretty', 'Exit codes']) assert.ok(HELP.includes(c), c);
    assert.doesNotMatch(HELP, /^  plan  /m, 'plan was removed: no entry of its own');
  });
});

describe('cli: usage errors exit 2, with JSON on stdout', () => {
  const io = mem();
  const cases: [string[], RegExp][] = [
    [['frobnicate'], /unknown command: frobnicate/],
    [['review'], /--vault <path> is required/],
    [['review', '--vault', 'nowhere'], /no such folder: nowhere/],
    [['review', '--vault', 'v', '--date', '2026-13-01'], /--date must be a date/],
    [['review', '--vault', 'v', '--lift', 'x'], /review does not take --lift/],
    [['review', '--vault'], /--vault needs a value/],
    [['readiness', '--vault', 'v', 'extra'], /takes no positional arguments/],
    [['next', '--vault', 'v'], /next needs --lift/],
    [['next', '--vault', 'v', '--lift', 'Curl'], /no lift named "Curl"; known lifts: Barbell Back Squat, Goblet Squat/],
    [['plan'], /unknown command: plan \(`plan` was removed in 0\.28\.1: a new plan starts from `engine draft`\)/],
    [['plan', '--profile', 'p.json', '--format', 'plan-data'], /unknown command: plan \(`plan` was removed in 0\.28\.1: a new plan starts from `engine draft`\)/],
    [['validate'], /validate takes one file/],
    [['validate', 'v/x.json', '--kind', 'diary'], /--kind must be one of/],
    [['--bogus'], /unknown arguments/],
    [['check', '--vault', 'v', '--redesign'], /--redesign goes with --plan <draft\.json>/],
    [['draft'], /--vault <path> is required/],
    [['draft', '--vault', 'v', '--plan', 'v/x.json'], /draft does not take --plan/],
    [['overlap'], /overlap needs --plans <a\.json,b\.json,\.\.\.>/],
    [['overlap', '--plans', ','], /overlap needs --plans/],
    [['overlap', '--plans', 'v/3-Personal/Fitness/plan-data.json,v/nowhere.json'], /--plans: file not found: v\/nowhere\.json/],
    [['overlap', '--plans', 'v/3-Personal/Fitness/Baseline - 2025-10-01.md'], /--plans: v\/3-Personal\/Fitness\/Baseline - 2025-10-01\.md is not valid JSON/],
    [['overlap', '--plans', 'v/3-Personal/Fitness/body-data.json'], /is not a plan \(no "sessions" object\)/],
    [['overlap', '--plans', 'v/3-Personal/Fitness/plan-data.json', '--vault', 'nowhere'], /no such folder: nowhere/],
  ];
  for (const [argv, re] of cases) {
    it(argv.join(' ') || '(none)', () => {
      const r = run(argv, io);
      assert.equal(r.code, 2);
      const j = parse(r);
      assert.equal(j.ok, false);
      assert.match(j.errors[0].message, re);
      assert.match(r.stderr, re);
    });
  }

  it('needs file access for the commands', () => {
    assert.equal(run(['review', '--vault', 'v']).code, 2);
  });

  it('plan: removed, an unknown command that names engine draft, with or without file access', () => {
    for (const r of [run(['plan', '--profile', PROFILE_V, '--vault', 'v'], io), run(['plan'])]) {
      assert.equal(r.code, 2);
      const j = parse(r);
      assert.deepEqual([j.command, j.ok, j.errors[0].code], ['plan', false, 'usage']);
      assert.equal(j.errors[0].message, 'unknown command: plan (`plan` was removed in 0.28.1: a new plan starts from `engine draft`)');
      assert.match(r.stderr, /^engine: unknown command: plan \(`plan` was removed in 0\.28\.1: a new plan starts from `engine draft`\)\nRun "engine --help" for the commands\.\n$/);
    }
    assert.match(run(['frobnicate'], io).stderr, /^engine: unknown command: frobnicate\n/, 'other unknown commands as before');
  });
});

describe('cli: a vault with no plan yet (a new user after the intake)', () => {
  const PLAN_FILE = 'v/3-Personal/Fitness/plan-data.json';
  const draftText = fixtureFiles('v')[PLAN_FILE]!;
  // Without a plan the folder search has nothing to find, so Pahlavan's setting names the fixture's folders (as a real vault's settings do).
  const fresh = () =>
    mem((f) => {
      delete f[PLAN_FILE];
      f['v/.obsidian/plugins/pahlavan/data.json'] = JSON.stringify({ folders: FIXTURE_FOLDERS });
      f['v/draft.json'] = draftText;
      f['v/session.json'] = JSON.stringify({ date: '2026-04-12', type: 'custom', label: 'Easy run', durationMin: 30 });
    });
  const noPlan = (j: Json): Json | undefined => (j.warnings as Json[]).find((w) => w.code === 'no-plan');

  it('review, readiness, session, the tracked items, food, the check-in template and the day still answer, with a no-plan warning', () => {
    const io = fresh();
    for (const argv of [['review'], ['readiness'], ['session'], ['tracked'], ['due', '--time', '12:00'], ['habits'], ['bring-over'], ['food'], ['checkin', 'template'], ['track', 'day']]) {
      const r = run([...argv, '--vault', 'v', '--json', ...(argv[0] === 'track' ? [] : ['--date', '2026-04-12'])], io);
      assert.equal(r.code, 0, `${argv.join(' ')}: ${r.stdout.slice(0, 300)}`);
      const j = parse(r);
      assert.equal(j.ok, true, argv.join(' '));
      assert.ok(noPlan(j), `${argv.join(' ')} says there is no plan yet`);
      assert.ok(!(j.errors as Json[]).some((e) => e.code === 'missing'), argv.join(' '));
    }
    const session = parse(run(['session', '--vault', 'v', '--date', '2026-04-12'], io));
    assert.deepEqual([session.session, session.items], [null, []]);
    // No plan weeks without a plan, whatever the log and the baseline note say (as food gives none).
    const review = parse(run(['review', '--vault', 'v', '--date', '2026-08-30'], io));
    assert.deepEqual([review.week.planStart, review.week.planWeek, review.week.phase, review.week.mesocycle], [null, null, null, null]);
    assert.ok(!(review.warnings as Json[]).some((w) => w.code === 'past-plan-end'));
    const next = parse(run(['next', '--vault', 'v', '--lift', 'Goblet Squat', '--date', '2026-04-12'], io));
    assert.equal(next.ok, true);
    assert.ok(noPlan(next));
  });

  it('draft: the same blank plan, with a no-plan warning; the unit and the week from the profile', () => {
    const r = run(['draft', '--vault', 'v'], fresh());
    assert.equal(r.code, 0, r.stdout);
    const j = parse(r);
    assert.equal(j.ok, true);
    assert.match(noPlan(j)!.message, /^There is no plan yet \(3-Personal\/Fitness\/plan-data\.json\): the draft starts blank either way/);
    assert.deepEqual(j.planData, { weekTarget: { lift: 4, short: 0 }, liftTypes: [], shortTypes: [], sessions: {}, liftUnit: 'lb', lifts: {}, guide: {}, rules: {} });
    assert.deepEqual(j.from, { liftUnit: 'profile', weekTarget: 'profile', carried: [] });
    // A profile's shorter days are the short sessions; days that make no sense are no week target.
    const shorter = fresh();
    const withShort = { ...shorter, readText: (p: string) => (p === PROFILE_V ? JSON.stringify({ ...JSON.parse(shorter.readText(p)!), availability: { daysPerWeek: 5, minutesPerSession: 60, shortSessions: { days: 2, minutes: 30 } } }) : shorter.readText(p)) };
    assert.deepEqual(parse(run(['draft', '--vault', 'v'], withShort)).planData.weekTarget, { lift: 3, short: 2 });
    const odd = { ...shorter, readText: (p: string) => (p === PROFILE_V ? JSON.stringify({ ...JSON.parse(shorter.readText(p)!), availability: { daysPerWeek: 3, minutesPerSession: 60, shortSessions: { days: 4, minutes: 30 } } }) : shorter.readText(p)) };
    const oddDraft = parse(run(['draft', '--vault', 'v'], odd));
    assert.deepEqual([oddDraft.planData.weekTarget, oddDraft.from.weekTarget], [{ lift: 0, short: 0 }, 'default']);
  });

  it('check without a draft has nothing to check: a no-plan note, exit 0', () => {
    const r = run(['check', '--vault', 'v', '--date', '2026-04-20'], fresh());
    assert.equal(r.code, 0, r.stdout);
    const j = parse(r);
    assert.deepEqual(j.findings.map((f: Json) => [f.code, f.level]), [['no-plan', 'info']]);
    assert.equal(j.summary.ok, true);
  });

  it('measures, checks and writes a draft: review --plan, session --plan, check --plan, plan-write --file', () => {
    const files: Record<string, string> = {};
    const base = fresh();
    for (const argv of [['review', '--plan', 'v/draft.json'], ['session', '--plan', 'v/draft.json'], ['check', '--plan', 'v/draft.json']]) {
      const r = run([...argv, '--vault', 'v', '--date', '2026-04-20'], base);
      assert.equal(r.code, 0, `${argv.join(' ')}: ${r.stdout.slice(0, 300)}`);
      assert.ok((parse(r).warnings as Json[]).some((w) => w.code === 'draft-plan'), argv.join(' '));
    }
    const dry = parse(run(['plan-write', '--vault', 'v', '--file', 'v/draft.json', '--date', '2026-04-20'], base));
    assert.deepEqual([dry.result, dry.written], ['changed', false]);
    assert.ok(dry.diff.length > 0 && dry.diff.every((d: Json) => d.change === 'added'), 'every key is new');
    const io = { ...base, readText: (p: string) => files[p] ?? base.readText(p), writePlan: (_root: string, text: string) => void (files[PLAN_FILE] = text) };
    const wet = run(['plan-write', '--vault', 'v', '--file', 'v/draft.json', '--date', '2026-04-20', '--write'], io);
    assert.deepEqual([wet.code, parse(wet).written], [0, true]);
    assert.deepEqual(JSON.parse(files[PLAN_FILE]!), JSON.parse(draftText));
  });

  it('refuses what needs the plan with a no-plan error: picking a session, a lift\'s targets, a ladder level', () => {
    const io = fresh();
    const cases: [string[], RegExp][] = [
      [['session', '--type', 'A'], /no plan sessions to pick from/],
      [['session', '--freeze', '--type', 'A'], /no plan sessions to freeze/],
      [['next', '--lift', 'Curl'], /no lift named "Curl" was logged/],
      [['log', 'ladder', '--id', 'pullup', '--level', '2', '--date', '2026-04-12'], /log ladder needs the plan/],
    ];
    for (const [argv, re] of cases) {
      const r = run([...argv, '--vault', 'v'], io);
      assert.equal(r.code, 1, argv.join(' '));
      const e = parse(r).errors[0];
      assert.equal(e.code, 'no-plan', argv.join(' '));
      assert.match(e.message, re);
    }
  });

  it('logs a custom session before the first plan, saying only a custom one can be', () => {
    const r = run(['log', 'add', '--vault', 'v', '--file', 'v/session.json'], fresh());
    assert.equal(r.code, 0, r.stdout);
    const j = parse(r);
    assert.deepEqual([j.result, j.session.type], ['added', 'custom']);
    assert.match(noPlan(j)!.message, /only a custom session can be logged/);
    const io = fresh();
    const planned = run(['log', 'add', '--vault', 'v', '--file', 'v/s2.json'], { ...io, readText: (p: string) => (p === 'v/s2.json' ? JSON.stringify({ date: '2026-04-12', type: 'A' }) : io.readText(p)) });
    assert.equal(parse(planned).errors[0].code, 'invalid');
  });
});

describe('cli: data problems exit 1', () => {
  it('a file that is not valid JSON', () => {
    const r = run(['review', '--vault', 'v', '--date', '2026-04-12'], mem((f) => (f['v/3-Personal/Fitness/fitness-log-data.json'] = '{')));
    assert.equal(r.code, 1);
    assert.equal(parse(r).errors[0].code, 'json');
  });
});

describe('cli: missing coach files', () => {
  const io = mem((f) => {
    delete f['v/3-Personal/Fitness/Coach/profile.json'];
    delete f['v/3-Personal/Fitness/Coach/ledger.json'];
  });

  it('review still runs, says so, and uses the roadmap band without a profile', () => {
    const r = run(['review', '--vault', 'v', '--date', '2026-04-12'], io);
    assert.equal(r.code, 0);
    const j = parse(r);
    assert.deepEqual(j.sources.coach, { profile: 'missing', ledger: 'missing', checkins: 'missing', eating: 'missing' });
    assert.equal(j.warnings.filter((w: Json) => w.code === 'coach-missing').length, 2);
    assert.match(j.weight.band.source, /roadmap \(no Coach\/profile\.json yet\)/);
    assert.deepEqual(j.weight.band.value.band, { unit: 'kg', lo: -0.5, hi: -0.25 });
    assert.equal(j.ledger, null);
  });
});

describe('cli: Pahlavan in the vault on another version than this coach (version-differs)', () => {
  const PLUGIN = 'v/.obsidian/plugins/pahlavan';
  const banner = (plugin: string, eng: string) => `// Pahlavan ${plugin} (engine ${eng}) | Elastic License 2.0 | Saeed Ghorbani\n"use strict";\n`;
  /** The fixture with the coach skill set up, and Pahlavan's main.js (and manifest) when given. */
  const vault = (main: string | null, manifest: string | null = null, coach = true) => mem((f) => {
    if (coach) f['v/.claude/skills/fitness-coach/SKILL.md'] = '# coach';
    if (main !== null) f[`${PLUGIN}/main.js`] = main;
    if (manifest !== null) f[`${PLUGIN}/manifest.json`] = manifest;
  });
  /** A version older, and one newer, than this engine's. */
  const OLDER = '0.0.0';
  const NEWER = `${Number(ENGINE_VERSION.split('.')[0]) + 1}.0.0`;
  const reviewOf = (io: ReturnType<typeof mem>) => parse(run(['review', '--vault', 'v', '--date', '2026-04-12'], io));
  const checkOf = (io: ReturnType<typeof mem>) => run(['check', '--vault', 'v', '--date', '2026-04-12'], io);
  const differs = (j: Json) => (j.warnings as Json[]).filter((w) => w.code === 'version-differs');

  it('a newer Pahlavan: review and check say both versions, that Pahlavan\'s is newer, and to update the coach', () => {
    const io = vault(banner(NEWER, NEWER));
    const r = run(['review', '--vault', 'v', '--date', '2026-04-12'], io);
    assert.equal(r.code, run(['review', '--vault', 'v', '--date', '2026-04-12'], mem()).code, 'the exit code is the data\'s, as without it');
    const w = differs(parse(r));
    assert.equal(w.length, 1);
    assert.equal(w[0]!.message, `Pahlavan ${NEWER} in this vault carries engine ${NEWER}; this coach runs engine ${ENGINE_VERSION}. Pahlavan's is newer: press Update the coach in Pahlavan's settings, Coach (or run the command "Set up the coach"), then start the coach again.`);
    assert.doesNotMatch(w[0]!.message, /—/);
    const c = checkOf(io);
    assert.equal(c.code, checkOf(mem()).code, 'never blocks: the exit code is the plan\'s');
    const j = parse(c);
    const f = (j.findings as Json[]).find((x) => x.code === 'version-differs');
    assert.deepEqual([f?.level, f?.grade, f?.items], ['warning', undefined, [w[0]!.message]], 'a fact, not evidence: no grade');
    assert.match(f!.message, /not the plan: it does not block a plan write/);
    assert.equal(differs(j).length, 1, 'in the envelope\'s warnings too');
    assert.equal(j.summary.warnings, parse(checkOf(mem())).summary.warnings + 1);
  });

  it('a newer coach: update Pahlavan from Community plugins; without a banner, the manifest\'s version', () => {
    const w = differs(reviewOf(vault(banner(OLDER, OLDER))));
    assert.equal(w.length, 1);
    assert.equal(w[0]!.message, `Pahlavan ${OLDER} in this vault carries engine ${OLDER}; this coach runs engine ${ENGINE_VERSION}. This coach is newer: update Pahlavan from Community plugins (Pahlavan never writes its older copy over a newer coach).`);
    const fromManifest = differs(reviewOf(vault('"use strict";\n', JSON.stringify({ id: 'pahlavan', version: OLDER }))));
    assert.equal(fromManifest.length, 1);
    assert.ok(fromManifest[0]!.message.startsWith(`Pahlavan in this vault is version ${OLDER} (its manifest.json; main.js names no engine); this coach runs engine ${ENGINE_VERSION}. This coach is newer`), fromManifest[0]!.message);
    // The banner wins over the manifest.
    assert.equal(differs(reviewOf(vault(banner(ENGINE_VERSION, ENGINE_VERSION), JSON.stringify({ version: OLDER })))).length, 0);
  });

  it('silent at the same version, with no Pahlavan folder, with no coach in the vault, or with nothing to read', () => {
    const silent: [string, ReturnType<typeof mem>][] = [
      ['the same version', vault(banner(ENGINE_VERSION, ENGINE_VERSION))],
      ['no plugin folder', vault(null)],
      ['no coach in the vault', vault(banner(NEWER, NEWER), null, false)],
      ['no banner, no manifest', vault('"use strict";\n')],
      ['a manifest that is not JSON', vault(null, '{')],
      ['the fixture as it is', mem()],
    ];
    for (const [what, io] of silent) {
      assert.equal(differs(reviewOf(io)).length, 0, `review: ${what}`);
      assert.equal(differs(parse(checkOf(io))).length, 0, `check: ${what}`);
    }
  });

  it('the built engine reads them from disk, on a temp copy of the synthetic vault', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pahlavan-version-'));
    try {
      cpSync(VAULT, tmp, { recursive: true });
      mkdirSync(join(tmp, '.claude', 'skills', 'fitness-coach'), { recursive: true });
      writeFileSync(join(tmp, '.claude', 'skills', 'fitness-coach', 'SKILL.md'), '# coach\n');
      mkdirSync(join(tmp, '.obsidian', 'plugins', 'pahlavan'), { recursive: true });
      writeFileSync(join(tmp, '.obsidian', 'plugins', 'pahlavan', 'main.js'), banner(NEWER, NEWER));
      for (const cmd of ['review', 'check']) {
        const j = parse(engine([cmd, '--vault', tmp, '--date', '2026-04-12']));
        assert.equal(differs(j).length, 1, cmd);
        // check frames it as a fact beside the plan, the detail its item; review gives the detail as the message.
        const w = differs(j)[0]!;
        assert.match(cmd === 'check' ? w.items[0] : w.message, /Pahlavan's is newer/, cmd);
      }
      writeFileSync(join(tmp, '.obsidian', 'plugins', 'pahlavan', 'main.js'), banner(ENGINE_VERSION, ENGINE_VERSION));
      for (const cmd of ['review', 'check']) assert.equal(differs(parse(engine([cmd, '--vault', tmp, '--date', '2026-04-12']))).length, 0, cmd);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('cli: next answers for the plan\'s lifts and the logged ones', () => {
  const PLAN = 'v/3-Personal/Fitness/plan-data.json';
  const LOG = 'v/3-Personal/Fitness/fitness-log-data.json';
  // Bench renamed in the plan: the guide still has the old name, and the last A logs it as planned.
  const io = mem((f) => {
    const plan = JSON.parse(f[PLAN]!);
    plan.guide['Barbell bench press'] = { ...plan.guide['Flat DB Bench Press'] };
    f[PLAN] = JSON.stringify(plan);
    const log = JSON.parse(f[LOG]!);
    log.sessions.find((s: Json) => s.date === '2026-04-08').lift2.planned = 'Barbell bench press';
    // A lift the plan never had, logged once by name.
    log.sessions.find((s: Json) => s.date === '2026-04-11').lift2 = { name: 'Incline DB Press', weight: 40, reps: 10 };
    f[LOG] = JSON.stringify(log);
  });
  const next = (lift: string, date = '2026-04-12') => run(['next', '--vault', 'v', '--lift', lift, '--date', date], io);

  it('a name only the guide or a log\'s planned still holds does not resolve: exit 2 with the known lifts', () => {
    for (const name of ['Barbell bench press', 'Face Pull']) {
      const r = next(name);
      assert.equal(r.code, 2, name);
      assert.match(parse(r).errors[0].message, new RegExp(`no lift named "${name}"; known lifts: Barbell Back Squat, Goblet Squat, Flat DB Bench Press, Romanian Deadlift, Seated Cable Row, Incline DB Press$`));
    }
  });

  it('the plan\'s name, short name and id, in any case, and a logged name still resolve', () => {
    for (const name of ['Flat DB Bench Press', 'flat db bench press', 'Bench', 'flat-db-bench-press']) {
      const r = next(name);
      assert.equal(r.code, 0, name);
      const j = parse(r);
      assert.deepEqual([j.lift.exercise, j.lift.sessions, j.lift.inPlanThisWeek], ['flat-db-bench-press', 8, true], name);
      assert.ok(!j.warnings.some((w: Json) => w.code === 'lift-not-in-plan'), name);
    }
    const j = parse(next('incline db press'));
    assert.deepEqual([j.lift.name, j.lift.sessions, j.lift.inPlanThisWeek], ['Incline DB Press', 1, false]);
    assert.ok(!j.warnings.some((w: Json) => w.code === 'lift-not-in-plan'), 'it has a top set');
  });

  it('a lift with no top sets that is not in this week\'s plan says so and names the plan\'s lifts', () => {
    const j = parse(next('Squat'));
    assert.deepEqual([j.lift.exercise, j.lift.sessions, j.lift.inPlanThisWeek], ['barbell-back-squat', 0, false]);
    const w = j.warnings.find((x: Json) => x.code === 'lift-not-in-plan');
    assert.match(w.message, /^Barbell Back Squat has no logged top sets by Sun 12 Apr and is not in this week's plan, so there is nothing to answer from\. This week's lifts: Goblet Squat, Flat DB Bench Press, Romanian Deadlift, Seated Cable Row\.$/);
    assert.deepEqual(w.items, ['Goblet Squat', 'Flat DB Bench Press', 'Romanian Deadlift', 'Seated Cable Row']);
    // A logged lift before its first top set.
    assert.ok(parse(next('Incline DB Press', '2026-04-10')).warnings.some((x: Json) => x.code === 'lift-not-in-plan'));
  });
});

describe('cli: validate', () => {
  const io = mem((f) => {
    f['v/bad-ledger.json'] = JSON.stringify({ schemaVersion: 1, constraints: [{ id: 'a' }, { id: 'a' }] });
    f['v/unknown.json'] = '{"hello": 1}';
  });

  it('infers the kind and validates', () => {
    const j = parse(run(['validate', 'v/3-Personal/Fitness/Coach/profile.json'], io));
    assert.deepEqual([j.kind, j.valid, j.inferred, j.ok], ['profile', true, true, true]);
    assert.equal(parse(run(['validate', 'v/3-Personal/Fitness/Coach/ledger.json', '--kind', 'ledger'], io)).valid, true);
  });

  it('warns about free text and ids the engine cannot use in a valid file', () => {
    const p = parse(run(['validate', 'v/3-Personal/Fitness/Coach/profile.json'], io));
    assert.deepEqual(p.warnings.map((w: Json) => [w.code, w.items]), [
      ['free-text-equipment', ['rowing machine']],
      ['unknown-preference', ['burpee-unknown']],
    ]);
    const l = parse(run(['validate', 'v/3-Personal/Fitness/Coach/ledger.json'], io));
    assert.deepEqual(l.warnings.map((w: Json) => [w.code, w.items]), [['not-catalogue-movement', ['shoulder: ring-dip-unknown']]]);
  });

  it('exits 1 with the errors for an invalid file, or one it cannot tell', () => {
    const r = run(['validate', 'v/bad-ledger.json'], io);
    assert.equal(r.code, 1);
    assert.match(parse(r).errors[0].message, /duplicate constraint id: a/);
    assert.equal(run(['validate', 'v/unknown.json'], io).code, 1);
    assert.equal(run(['validate', 'v/unknown.json', '--kind', 'program'], io).code, 1);
  });

  it('the vault\'s own files are named, with what reads them, never judged against a kind (exit 2)', () => {
    const cases: [string, string[], RegExp][] = [
      ['3-Personal/Fitness/body-data.json', ['--kind', 'body'], /is the vault's body record .*`body --file <record\.json>` writes it/],
      ['3-Personal/Fitness/body-data.json', [], /would read as invalid against any of them/],
      ['3-Personal/Fitness/plan-data.json', [], /is the vault's training plan, .*`review --vault <vault>` reads it with the log/],
      ['3-Personal/Fitness/plan-data.json', ['--kind', 'program'], /training plan/],
      ['3-Personal/Fitness/fitness-log-data.json', [], /is the vault's training log .*`review --vault <vault>` reads it with the plan/],
      ['5-System/Data/habits-data.json', ['--kind', 'checkin'], /is the habit check-ins .*`track tick --write`/],
      ['5-System/Data/work-timer-data.json', [], /is the work timer's log of desk time/],
    ];
    for (const [path, flags, re] of cases) {
      const r = run(['validate', `v/${path}`, ...flags], io);
      assert.equal(r.code, 2, path);
      const j = parse(r);
      assert.deepEqual([j.kind, j.valid, j.vaultFile, j.ok, j.errors[0].code], [null, null, path, false, 'vault-file'], path);
      assert.match(j.errors[0].message, re, path);
      assert.match(r.stderr, re, path);
    }
  });

  it('a renamed copy of a vault file is told by its shape; a file with a schemaVersion is the engine\'s, whatever its name', () => {
    const copies = mem((f) => {
      f['v/plan-copy.json'] = f['v/3-Personal/Fitness/plan-data.json']!;
      f['v/log-copy.json'] = f['v/3-Personal/Fitness/fitness-log-data.json']!;
      f['v/body-copy.json'] = f['v/3-Personal/Fitness/body-data.json']!;
      f['v/habits-copy.json'] = f['v/5-System/Data/habits-data.json']!;
      f['v/body-data.json'] = f['v/3-Personal/Fitness/Coach/ledger.json']!;
    });
    const named = ['plan-copy', 'log-copy', 'body-copy', 'habits-copy'].map((n) => parse(run(['validate', `v/${n}.json`], copies)).vaultFile);
    assert.deepEqual(named, ['3-Personal/Fitness/plan-data.json', '3-Personal/Fitness/fitness-log-data.json', '3-Personal/Fitness/body-data.json', '5-System/Data/habits-data.json']);
    const ledger = run(['validate', 'v/body-data.json'], copies);
    assert.deepEqual([ledger.code, parse(ledger).kind, parse(ledger).valid], [0, 'ledger', true]);
  });
});

// ---------------------------------------------------------------- the built engine

function engine(args: string[], cwd = ROOT) {
  const r = spawnSync(process.execPath, [builtEngine(), ...args], { encoding: 'utf8', cwd });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

function snapshot(dir: string): string {
  return readdirSync(dir, { recursive: true })
    .sort()
    .map((f) => {
      const p = join(dir, f);
      const s = statSync(p);
      return s.isFile() ? `${f}:${s.size}:${s.mtimeMs}:${readFileSync(p, 'utf8').length}` : f;
    })
    .join('\n');
}

describe('cli: the built engine on the synthetic vault', () => {
  let review: Json;
  let before0 = '';

  before(() => {
    builtEngine();
    before0 = snapshot(VAULT);
    const r = engine(['review', '--vault', 'test/fixtures/vault', '--date', '2026-04-12', '--json']);
    assert.equal(r.code, 0, r.stderr);
    review = parse(r);
  });

  it('runs --version and --help', () => {
    assert.equal(engine(['--version']).stdout, `${VERSION_LINE}\n`);
    assert.equal(engine(['--help']).code, 0);
  });

  it('prints compact JSON, or indented with --pretty', () => {
    const compact = engine(['readiness', '--vault', 'test/fixtures/vault', '--date', '2026-04-12']).stdout;
    const pretty = engine(['readiness', '--vault', 'test/fixtures/vault', '--date', '2026-04-12', '--pretty']).stdout;
    assert.equal(compact.trim().split('\n').length, 1);
    assert.ok(pretty.split('\n').length > 50);
    assert.deepEqual(JSON.parse(compact), JSON.parse(pretty));
  });

  it('runs from the vault root with --vault .', () => {
    const r = engine(['readiness', '--vault', '.', '--date', '2026-04-12'], VAULT);
    assert.equal(r.code, 0);
    assert.equal(parse(r).sources.vault, '.');
  });

  it('gives the review its sections, the reasons and the warnings', () => {
    for (const k of ['week', 'thisWeek', 'adherence', 'readiness', 'weight', 'lifts', 'volume', 'deload', 'missed', 'concurrent', 'temporaryChanges', 'ledger', 'ladders', 'tests', 'time', 'pain', 'warnings', 'errors']) {
      assert.ok(k in review, k);
    }
    assert.equal(review.adherence.reason.rule, 'adherence.weeks');
    assert.equal(review.lifts[0].next.reason.rule, 'progression.double');
    assert.deepEqual(review.errors, []);
    assert.deepEqual(review.week, { from: '2026-04-06', to: '2026-04-12', planStart: '2026-03-02', planWeek: 6, planWeeks: 24, phase: 1, mesocycle: 2, weekInMesocycle: 2, mesocycleWeeks: 4, deload: false, deloadNext: false });
    assert.deepEqual(Object.keys(review.rules), ['calibration', 'lightWeeks', 'tests', 'readiness', 'soreness', 'missed', 'stall', 'hotel', 'express', 'lifts']);
    assert.equal(review.lifts[0].progressionRule.source, 'legacy-default');
    assert.match(review.lifts[0].next.reason.note, /^Pahlavan's default \(the plan sets none\): double progression on /);
    assert.deepEqual([review.rules.lightWeeks.source, review.rules.lightWeeks.path], ['legacy-default', 'rules.lightWeeks']);
    assert.match(review.rules.lightWeeks.text, /^Pahlavan's default \(the plan sets none\): light weeks every 4th plan week/);
  });

  it('matches the snippets: 4-week adherence', () => {
    const a = review.adherence.value;
    const s = expected.snippets.adherence;
    assert.deepEqual(a.weeks.map((w: Json) => ({ weekOf: w.weekOf, lift: w.lift, short: w.short, custom: w.custom, days: w.days, habitDays: w.habitDays })), s.weeks);
    assert.deepEqual([a.lifting.done, a.lifting.planned, a.short.done, a.short.planned], [s.lifting.done, s.lifting.planned, s.short.done, s.short.planned]);
    approx(a.meanSessionsPerWeek, s.meanSessionsPerWeek);
    approx(a.meanTrainingDays, s.meanTrainingDays);
    assert.deepEqual(a.gaps, { unlogged: 2, missed: 0, rest: 0 }); // week 4: one lifting and one short session short
  });

  it('matches the snippets: readiness R, S and flags, day by day (the recipe on every morning, as the snippet reads them)', () => {
    // The snippet reads every morning on record; the review reads the cycle's only (the next test).
    const io = { readText: (p: string) => { try { return readFileSync(p, 'utf8'); } catch { return null; } }, listDir: (p: string) => { try { return readdirSync(p); } catch { return null; } } };
    const daily = readVault(io, VAULT, { asOf: '2026-04-12' }).data.checkins.daily;
    const series = readinessSeries(daily, '2026-04-12');
    const rows = new Map(series.slice(-14).map((d) => [d.date, { ...d, flags: [d.rhrFlag && 'rhr-flag', d.shortSleep && 'short-sleep'].filter(Boolean) as string[] }]));
    for (const d of expected.snippets.readiness.days) {
      const e = rows.get(d.date) as Json;
      assert.ok(e, d.date);
      if (d.r === null) assert.equal(e.r, null);
      else {
        approx(e.r, d.r, 1e-9, `${d.date} r`);
        approx(e.s, d.s, 1e-9, `${d.date} s`);
      }
      assert.equal(e.flags.includes('rhr-flag'), d.rhrFlag, `${d.date} rhr`);
      assert.equal(e.flags.includes('short-sleep'), d.shortSleep, `${d.date} sleep`);
    }
    assert.equal(series.filter((d) => d.r !== null).length, expected.snippets.readiness.scored);
  });

  it('the review reads this cycle’s mornings only: the recipe from the cycle start (23 Feb), the baseline built', () => {
    const io = { readText: (p: string) => { try { return readFileSync(p, 'utf8'); } catch { return null; } }, listDir: (p: string) => { try { return readdirSync(p); } catch { return null; } } };
    const daily = readVault(io, VAULT, { asOf: '2026-04-12' }).data.checkins.daily;
    const cycle = readinessSeries(daily, '2026-04-12', { since: '2026-02-23' });
    assert.equal(review.readiness.since, '2026-02-23');
    assert.deepEqual(review.readiness.last14.map((d: Json) => [d.date, d.r, d.s, d.band]), cycle.slice(-14).map((d) => [d.date, d.r, d.s, d.band]));
    assert.equal(review.readiness.scoredDays, cycle.filter((d) => d.r !== null).length);
    assert.ok(review.readiness.scoredDays < expected.snippets.readiness.scored, 'the three mornings before the cycle no longer count');
    assert.equal(review.readiness.baseline.value.building, false);
    const acts = Object.fromEntries(review.readiness.actions.map((a: Json) => [a.value.action, a.value.active]));
    assert.deepEqual(acts, { trim: true, 'early-deload': false, 'no-hard-training': true, 'no-tests': false });
  });

  it('matches the snippets: the weight trend, slope and rate', () => {
    const s = expected.snippets.weight;
    approx(review.weight.rate.value.kgPerWeek, s.slopeKgPerWeek, 1e-12);
    approx(review.weight.rate.value.pctPerWeek, s.pctPerWeek, 1e-12);
    approx(review.weight.trend.value.latest.trend, s.trend, 1e-12);
    assert.equal(review.weight.trend.value.weighIns, s.weighIns);
    assert.equal(review.weight.rate.value.spanDays, s.spanDays);
    assert.equal(review.weight.rate.value.weighIns, s.windowWeighIns);
    assert.equal(review.weight.proteinFloorG, s.proteinFloor);
    assert.equal(review.weight.band.source, 'profile goal recomp (recomposition)');
    assert.equal(review.weight.band.value.status, 'in');
  });

  it('matches the snippets: e1RM, unit flags, stalls and two misses per lift', () => {
    const lifts = new Map(review.lifts.map((l: Json) => [l.name, l]));
    for (const [name, s] of Object.entries(expected.snippets.e1rm) as [string, Json][]) {
      const l = lifts.get(name) as Json;
      const t = l.e1rm.value;
      assert.equal(l.unit, s.unit, name);
      assert.equal(t.sessions, s.sessions, name);
      assert.equal(t.ignored, s.cut, name);
      assert.equal(t.points.length, s.points, name);
      approx(t.best, s.best, 1e-9, `${name} best`);
      if (s.change === null) assert.equal(t.change, null);
      else approx(t.change, s.change, 1e-12, `${name} change`);
      assert.deepEqual(t.unitFlag ? [t.unitFlag.from.date, t.unitFlag.to.date] : null, s.flag, name);
      assert.equal(l.next.value.action === 'lighter', s.twoMisses, `${name} two misses`);
    }
    const bench = lifts.get('Flat DB Bench Press') as Json;
    assert.equal(bench.stall.value.status, 'stalled');
    assert.equal(bench.triage.length, 4);
    assert.equal(bench.triage.find((t: Json) => t.value.chosen).value.id, 'check-basics');
  });

  it('matches fitness_log.py review: next targets, except where two misses call for a lighter weight', () => {
    const lifts = new Map(review.lifts.map((l: Json) => [l.name, l]));
    for (const [name, f] of Object.entries(expected.fitnessLogReview.lifts) as [string, Json][]) {
      const l = lifts.get(name) as Json | undefined;
      if (!f.last) {
        assert.ok(!l || l.next.value.action === 'start', name);
        continue;
      }
      const n = l!.next.value;
      if (name === 'Flat DB Bench Press') assert.deepEqual([n.action, n.weight, n.reps], ['lighter', 55, 6]); // the dashboard says 60 x 6
      else assert.deepEqual([n.weight, n.reps], [f.next.weight, f.next.reps], name);
    }
  });

  it('matches fitness_log.py review: the week, the 7-day averages, the dashboard\'s weight rate, ladders', () => {
    const f = expected.fitnessLogReview;
    assert.deepEqual([review.thisWeek.lifting, review.thisWeek.short, review.thisWeek.custom, review.thisWeek.cardioMin], [f.adherence.lifting, f.adherence.short, f.adherence.custom, f.adherence.cardioMin]);
    for (const [k, fk] of [['sleepH', 'sleep7'], ['steps', 'steps7'], ['floors', 'floors7'], ['rhr', 'rhr7']]) assert.deepEqual(review.weight.last7[k!], f.body[fk!], k);
    assert.deepEqual([review.weight.dashboard.value.trend, review.weight.dashboard.value.ratePerWeek], [f.body.weightTrend, f.body.ratePerWeek]);
    assert.deepEqual(review.ladders.map((l: Json) => ({ id: l.id, level: l.level, since: l.since, testShowsLevel: l.testShowsLevel ?? null })), f.ladders);
    assert.deepEqual(review.temporaryChanges.due, f.dueTemporaryChanges);
  });

  it('differs from the snippets on planned sets exactly by the catalogue\'s tags (target / types weighting)', () => {
    // The snippets count with the guide's muscles; review counts a catalogue movement with the catalogue's. With A and B
    // weighted 1.5 and S1 0.5: the goblet squat (4 sets) helps no hamstrings (-3); the face pull (3) helps the shoulders
    // instead of training them (-2.25), the seated cable row (3) and the side plank (3) do not help them (-2.25 each);
    // the Bulgarian split squat (3) does not help the abs (-2.25); the dead bug (3, in S1) does not help the obliques (-0.75).
    const diff: Record<string, number> = { hamstrings: -3, shoulders: -6.75, abs: -2.25, obliques: -0.75 };
    const p = review.volume.planned.value.perWeek;
    for (const m of new Set([...Object.keys(p), ...Object.keys(expected.snippets.volume.planned)])) {
      approx(p[m] ?? 0, (expected.snippets.volume.planned[m] ?? 0) + (diff[m] ?? 0), 1e-9, m);
    }
    assert.deepEqual(review.volume.planned.reason.inputs.weights, { a: 1.5, b: 1.5, s1: 0.5, s3: 0.5 });
  });

  it('differs from the snippets on done sets exactly by the documented choices and the catalogue\'s tags', () => {
    // A timed "6 min" handstand is not counted (3 sets: shoulders 3, triceps, upper back, abs 1.5);
    // the skipped paired line drops face pulls (3) and band external rotation (2);
    // the Bulgarian split squat was swapped for walking lunges (abs -1.5, calves +1.5).
    // The catalogue's tags: the goblet squat helps no hamstrings (-2); the seated cable row and the side plank help no
    // shoulders (-3 each); the Bulgarian split squat helps no abs (-1.5); the walking lunge (the catalogue's reverse lunge)
    // helps no calves (-1.5); the dead bug helps no obliques (-1.5).
    const diff: Record<string, number> = { shoulders: -14, triceps: -1.5, 'upper-back': -5.5, abs: -4.5, calves: 0, hamstrings: -2, obliques: -1.5 };
    const d = review.volume.done.value.perWeek;
    for (const m of new Set([...Object.keys(d), ...Object.keys(expected.snippets.volume.done)])) {
      approx(d[m] ?? 0, (expected.snippets.volume.done[m] ?? 0) + (diff[m] ?? 0), 1e-9, m);
    }
    assert.equal(review.volume.done.value.sessions, expected.snippets.volume.doneSessions);
  });

  it('gives deload status, the missed-time protocol, the concurrent check, the Ledger screen and the due changes', () => {
    assert.deepEqual([review.deload.value.planWeek, review.deload.value.weeksToScheduled, review.deload.value.deload], [6, 2, false]);
    assert.equal(review.missed.value.protocol, 'continue');
    assert.deepEqual(review.nextInRotation, { lift: 'A', short: 'S3' });
    assert.ok(review.concurrent.flags.length > 0);
    // The week as the log has it (A most often on Wednesday, a tie with Monday going to the latest), with no start hour.
    assert.deepEqual(review.concurrent.layout[0], { session: 'A', day: 'wed', source: 'log' });
    assert.match(review.concurrent.week.reason.note, /your logged weeks/);
    const flagged = review.ledger.flagged.map((x: Json) => [x.name, x.value.allowed]);
    assert.deepEqual(flagged, [['Goblet Squat', true], ['Romanian Deadlift', false], ['Bulgarian Split Squat', true]]);
    assert.equal(review.temporaryChanges.active[0].wayBack, 'Barbell Back Squat');
    const later = parse(engine(['review', '--vault', 'test/fixtures/vault', '--date', '2026-04-20']));
    assert.deepEqual(later.temporaryChanges.due.map((c: Json) => [c.session, c.item, c.wayBack]), [['A', 'Goblet Squat', 'Barbell Back Squat']]);
    assert.equal(later.deload.value.deload, true);
    assert.ok(later.deloadPrescription.value.differences.length > 0);
  });

  it('answers readiness and next', () => {
    const r = parse(engine(['readiness', '--vault', 'test/fixtures/vault', '--date', '2026-04-12']));
    assert.equal(r.latestScored.date, '2026-04-11');
    assert.equal(r.latestScored.band, 'low');
    const n = engine(['next', '--vault', 'test/fixtures/vault', '--lift', 'bench', '--date', '2026-04-12']);
    assert.equal(n.code, 0);
    const j = parse(n);
    assert.equal(j.lift.name, 'Flat DB Bench Press');
    assert.deepEqual([j.lift.next.value.action, j.lift.next.value.weight], ['lighter', 55]);
    assert.equal(engine(['next', '--vault', 'test/fixtures/vault', '--lift', 'Curl']).code, 2);
  });

  it('validates the vault\'s own files', () => {
    assert.equal(engine(['validate', PROFILE]).code, 0);
    assert.equal(engine(['validate', LEDGER]).code, 0);
    assert.equal(engine(['validate', join(VAULT, 'expected.json')]).code, 1);
    assert.equal(engine(['validate', join(VAULT, '3-Personal', 'Fitness', 'body-data.json'), '--kind', 'body']).code, 2);
  });

  it('never writes: the vault is unchanged after every command', () => {
    assert.equal(snapshot(VAULT), before0);
  });
});

describe('the skill\'s selfcheck: the docs against the engine\'s facts', () => {
  // The real skill and the built engine in a copy of the made-up vault, with its docs changed to contradict the engine.
  it('fails a number that differs from the engine, a "no field" claim for a field it has, an unknown kind and a Python block', () => {
    const vault = mkdtempSync(join(tmpdir(), 'pahlavan-facts-'));
    try {
      cpSync(VAULT, vault, { recursive: true });
      const skill = join(vault, '.claude', 'skills', 'fitness-coach');
      cpSync(join(ROOT, 'skill'), skill, { recursive: true });
      cpSync(builtEngine(), join(skill, 'scripts', 'engine.cjs'));
      writeFileSync(join(skill, 'scripts', 'VERSION'), `engine ${ENGINE_VERSION}\nschema ${SCHEMA_VERSION}\n`);
      const selfcheck = () => {
        const r = spawnSync(process.execPath, [join(skill, 'scripts', 'selfcheck.mjs'), '--vault', vault, '--repo', ROOT, '--json'], { encoding: 'utf8', cwd: vault });
        return { code: r.status, out: JSON.parse(r.stdout) as { failed: number; results: { check: number; status: string; what: string; reason: string }[] } };
      };
      const clean = selfcheck();
      assert.equal(clean.code, 0, JSON.stringify(clean.out.results.filter((x) => x.status === 'fail')));
      assert.ok(clean.out.results.some((x) => x.check === 6 && x.status === 'pass' && x.what === 'engine output'));
      // energy runs on the made-up vault, and the one Python block left is tracking.md's water snippet.
      assert.ok(clean.out.results.some((x) => x.check === 1 && x.status === 'pass' && /^engine\.cjs energy /.test(x.what)));
      assert.deepEqual(clean.out.results.filter((x) => x.check === 6 && /the allowlisted/.test(x.reason)).map((x) => x.reason), ['the allowlisted "Amounts: water" snippet']);

      const planning = join(skill, 'references', 'planning.md');
      const text = readFileSync(planning, 'utf8');
      writeFileSync(
        planning,
        `${text
          .replace('priority 10–16, the rest 5–10', 'priority 10–15, the rest 5–10')
          .replace('find a load that leaves 3 reps in reserve', 'find a load that leaves 2 reps in reserve')
          .replace('uses its default (every 4th week', 'uses its default (every 5th week')}
## A coach's own rule

A plan may set its own light weeks:

\`\`\`json
{ "rules": { "lightWeeks": { "every": 5, "sets": "half", "rirAdd": 3 } } }
\`\`\`

## A wrong section

In the calibration week every lift is taken to 2 reps in reserve. The RIR is not a field. A baseline lists \`unexpressible\` kinds such as \`made up kind\`.

\`\`\`python
print("a weekly sets count")
\`\`\`
`,
      );
      // The eating plan's floor and recomposition's goal energy, said otherwise in diet.md.
      const diet = join(skill, 'references', 'diet.md');
      writeFileSync(diet, readFileSync(diet, 'utf8').replace('1,500 kcal a day for men, 1,200 for women', '1,500 kcal a day for men, 1,000 for women').replace('recomposition: maintenance to −250 kcal', 'recomposition: maintenance to −300 kcal'));
      const bad = selfcheck();
      assert.equal(bad.code, 1);
      const fails = bad.out.results.filter((x) => x.check === 6 && x.status === 'fail').map((x) => x.reason);
      assert.ok(fails.some((f) => /the energy floors is \[1500,1200\] in the engine, the text says \[1500,1000\]/.test(f)), fails.join('\n'));
      assert.ok(fails.some((f) => /recomposition's goal energy is 250 in the engine, the text says 300/.test(f)), fails.join('\n'));
      assert.ok(fails.some((f) => /the priority tier is \[10,16\] in the engine, the text says \[10,15\]/.test(f)), fails.join('\n'));
      assert.ok(fails.some((f) => /the calibration RIR is 3 in the engine, the text says 2/.test(f)));
      assert.ok(fails.some((f) => /says there is no field, but the engine has `rir`/.test(f)));
      assert.ok(fails.some((f) => /names the unexpressible kind `made up kind`/.test(f)));
      assert.ok(fails.some((f) => /a Python block under "A wrong section"/.test(f)));
      // A number under a heading that names its subject, and the default's timing, are caught, at the line that says them.
      const at = (re: RegExp) => bad.out.results.find((x) => x.check === 6 && x.status === 'fail' && re.test(x.reason))?.what;
      const lineOf = (needle: string) => `references/planning.md:${readFileSync(planning, 'utf8').split('\n').findIndex((l) => l.includes(needle)) + 1}`;
      assert.equal(at(/the calibration RIR is 3 in the engine, the text says 2: "…[^"]*leaves 2 reps/), lineOf('leaves 2 reps in reserve'));
      assert.equal(at(/the default light-week timing is 4 in the engine, the text says 5/), lineOf('its default (every 5th week'));
      // An example of a coach's own rule isn't held to the default.
      assert.ok(!fails.some((f) => /\(JSON\)/.test(f)), fails.join('\n'));
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });

  it('on a vault with no plan yet, runs the draft commands on the made-up sample plan the skill ships', () => {
    const vault = mkdtempSync(join(tmpdir(), 'pahlavan-fresh-'));
    try {
      cpSync(VAULT, vault, { recursive: true });
      rmSync(join(vault, '3-Personal', 'Fitness', 'plan-data.json'));
      // Without a plan the folder search has nothing to find: Pahlavan's setting names the folders, as a real vault's does.
      mkdirSync(join(vault, '.obsidian', 'plugins', 'pahlavan'), { recursive: true });
      writeFileSync(join(vault, '.obsidian', 'plugins', 'pahlavan', 'data.json'), JSON.stringify({ folders: FIXTURE_FOLDERS }));
      const skill = join(vault, '.claude', 'skills', 'fitness-coach');
      cpSync(join(ROOT, 'skill'), skill, { recursive: true });
      cpSync(builtEngine(), join(skill, 'scripts', 'engine.cjs'));
      writeFileSync(join(skill, 'scripts', 'VERSION'), `engine ${ENGINE_VERSION}\nschema ${SCHEMA_VERSION}\n`);
      const r = spawnSync(process.execPath, [join(skill, 'scripts', 'selfcheck.mjs'), '--vault', vault, '--repo', ROOT, '--json'], { encoding: 'utf8', cwd: vault });
      const out = JSON.parse(r.stdout) as { fresh: boolean; results: { check: number; status: string; what: string; reason: string }[] };
      assert.equal(r.status, 0, JSON.stringify(out.results.filter((x) => x.status === 'fail')));
      assert.equal(out.fresh, true);
      assert.ok(out.results.some((x) => x.check === 1 && x.status === 'pass' && x.what === 'scripts/sample-plan.json (no plan yet)'));
      const ran = (re: RegExp) => out.results.some((x) => x.check === 1 && x.status === 'pass' && re.test(x.what));
      for (const re of [/^engine\.cjs check .*--plan <tmp>\/draft\.json/, /^engine\.cjs review .*--plan <tmp>\/draft\.json/, /^engine\.cjs plan-write .*--file <tmp>\/draft\.json/, /^engine\.cjs session .*--type A --plan <tmp>\/draft\.json/]) assert.ok(ran(re), String(re));
      assert.ok(!out.results.some((x) => / plan --/.test(x.what)), 'nothing runs the removed plan command');
      // The sample is a whole plan: two lifting sessions and a short one, checked with no hard error.
      const sample = JSON.parse(readFileSync(join(ROOT, 'skill', 'scripts', 'sample-plan.json'), 'utf8')) as Json;
      assert.deepEqual([sample.liftTypes, sample.shortTypes], [['A', 'B'], ['S1']]);
      const c = engine(['check', '--vault', vault, '--plan', join(ROOT, 'skill', 'scripts', 'sample-plan.json'), '--json']);
      assert.equal(c.code, 0, c.stdout.slice(0, 400));
      assert.deepEqual(parse(c).findings.filter((f: Json) => f.level === 'error'), []);
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });
});

describe('ship-skill', () => {
  it('builds and copies the engine with a VERSION file into a skill folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pahlavan-skill-'));
    try {
      writeFileSync(join(dir, 'SKILL.md'), '# a skill\n');
      const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'ship-skill.mjs'), dir], { encoding: 'utf8', cwd: ROOT });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(readFileSync(join(dir, 'scripts', 'VERSION'), 'utf8'), `engine ${ENGINE_VERSION}\nschema ${SCHEMA_VERSION}\n`);
      const v = spawnSync(process.execPath, [join(dir, 'scripts', 'engine.cjs'), '--version'], { encoding: 'utf8', cwd: dir });
      assert.equal(v.stdout, `${VERSION_LINE}\n`);
      // The built engine's plan check ran on the made-up vault first, as expected on both dates.
      assert.match(r.stdout, /engine check on test\/fixtures\/vault: as expected on 2026-04-20 \(no errors\) and 2026-04-12 \(ledger-blocked\)/);
      const bad = spawnSync(process.execPath, [join(ROOT, 'tools', 'ship-skill.mjs'), join(dir, 'scripts')], { encoding: 'utf8', cwd: ROOT });
      assert.equal(bad.status, 2);
      assert.match(bad.stderr, /not a skill folder/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs the skill\'s selfcheck against the vault that holds it, fails with it, and skips it on --no-check', () => {
    const vault = mkdtempSync(join(tmpdir(), 'pahlavan-vault-'));
    const source = mkdtempSync(join(tmpdir(), 'pahlavan-skill-'));
    try {
      const skill = join(vault, '.claude', 'skills', 'fitness-coach');
      mkdirSync(join(skill, 'scripts'), { recursive: true });
      writeFileSync(join(skill, 'SKILL.md'), '# a skill\n');
      // The skill to install (--from): a stub selfcheck that records how it was
      // run (and whether it ran in the vault), and exits with the code in the
      // "exit" file beside it once installed.
      mkdirSync(join(source, 'scripts'), { recursive: true });
      writeFileSync(join(source, 'SKILL.md'), '# a skill\n');
      writeFileSync(
        join(source, 'scripts', 'selfcheck.mjs'),
        [
          "import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';",
          'const argv = process.argv.slice(2);',
          'const inVault = realpathSync(process.cwd()) === realpathSync(argv[1]);',
          "writeFileSync(new URL('./ran.json', import.meta.url), JSON.stringify({ argv, inVault }));",
          "console.log('stub selfcheck: 1 passed, 0 failed');",
          "const exit = new URL('./exit', import.meta.url);",
          "process.exit(existsSync(exit) ? Number(readFileSync(exit, 'utf8')) : 0);",
        ].join('\n'),
      );
      const ship = (args: string[]) => spawnSync(process.execPath, [join(ROOT, 'tools', 'ship-skill.mjs'), '--from', source, ...args], { encoding: 'utf8', cwd: ROOT });
      const ran = join(skill, 'scripts', 'ran.json');

      const ok = ship([skill]);
      assert.equal(ok.status, 0, ok.stderr);
      assert.match(ok.stdout, /stub selfcheck: 1 passed/);
      assert.ok(existsSync(join(skill, 'scripts', 'engine.cjs')));
      const call = JSON.parse(readFileSync(ran, 'utf8')) as { argv: string[]; inVault: boolean };
      assert.deepEqual(call.argv.slice(0, 3), ['--vault', vault, '--repo']);
      assert.equal(call.argv[3]?.replace(/\/$/, ''), ROOT.replace(/\/$/, ''));
      assert.equal(call.inVault, true);

      writeFileSync(join(skill, 'scripts', 'exit'), '1');
      const failed = ship([skill]);
      assert.equal(failed.status, 1);
      assert.match(failed.stderr, /selfcheck failed/);

      rmSync(ran);
      const skipped = ship(['--no-check', skill]);
      assert.equal(skipped.status, 0, skipped.stderr);
      assert.match(skipped.stdout, /selfcheck skipped \(--no-check\)/);
      assert.equal(existsSync(ran), false);

      assert.equal(ship([skill, '--nope']).status, 2);
    } finally {
      rmSync(vault, { recursive: true, force: true });
      rmSync(source, { recursive: true, force: true });
    }
  });
});

describe('cli: checkin, usage and logic', () => {
  it('needs template or add, and the right flags', () => {
    const io = mem();
    for (const [argv, re] of [
      [['checkin', '--vault', 'v'], /checkin takes "template" or "add"/],
      [['checkin', 'list', '--vault', 'v'], /checkin takes "template" or "add"/],
      [['checkin', 'template', '--vault', 'v', '--write'], /checkin template does not take --write/],
      [['checkin', 'add', '--vault', 'v', '--date', '2026-04-12'], /checkin add does not take --date/],
      [['checkin', 'add', '--vault', 'v'], /checkin add needs --file/],
      [['checkin', 'add', '--vault', 'v', '--file', 'nope.json'], /answers file not found/],
    ] as [string[], RegExp][]) {
      const r = run(argv, io);
      assert.equal(r.code, 2, argv.join(' '));
      assert.match(parse(r).errors[0].message, re);
    }
  });

  it('refuses --write without a writer, and an invalid existing log', () => {
    const answers = JSON.stringify({ date: '2026-04-12', weekStart: '2026-04-06', recovery: 4 });
    const io = mem((f) => (f['v/a.json'] = answers));
    assert.match(parse(run(['checkin', 'add', '--vault', 'v', '--file', 'v/a.json', '--write'], io)).errors[0].message, /cannot write/);
    const bad = mem((f) => {
      f['v/a.json'] = answers;
      f['v/3-Personal/Fitness/Coach/checkins.json'] = JSON.stringify({ schemaVersion: 1, checkins: [{ date: '2026-03-01' }] });
    });
    const writes: string[] = [];
    const r = run(['checkin', 'add', '--vault', 'v', '--file', 'v/a.json', '--write'], { ...bad, writeCheckins: (_root: string, text: string) => writes.push(text) });
    assert.equal(r.code, 1);
    assert.match(parse(r).errors[0].message, /fix it first/);
    assert.deepEqual(writes, []);
  });

  it('drops unanswered fields, merges by date field by field, and keeps the other records', () => {
    const writes: string[] = [];
    const files = fixtureFiles('v');
    files['v/one.json'] = JSON.stringify({ record: { date: '2026-04-05', weekStart: '2026-03-30', recovery: 3, effort: null, deload: { cancelled: null, trainedAtFullLoad: [] } } });
    files['v/two.json'] = JSON.stringify({ date: '2026-04-12', weekStart: '2026-04-06', recovery: 4, stress: null });
    files['v/three.json'] = JSON.stringify({ date: '2026-04-05', weekStart: '2026-03-30', focusFollowed: true });
    const io = { ...memoryIo(files), writeCheckins: (_root: string, text: string) => {
      writes.push(text);
      files['v/3-Personal/Fitness/Coach/checkins.json'] = text;
    } };
    const add = (f: string) => parse(run(['checkin', 'add', '--vault', 'v', '--file', f, '--write'], io));
    assert.deepEqual(add('v/one.json').results[0].record, { date: '2026-04-05', weekStart: '2026-03-30', recovery: 3 });
    assert.equal(add('v/two.json').records, 2);
    const third = add('v/three.json');
    assert.equal(third.results[0].action, 'updated');
    assert.deepEqual(third.results[0].record, { date: '2026-04-05', weekStart: '2026-03-30', recovery: 3, focusFollowed: true });
    const log = JSON.parse(writes.at(-1)!);
    assert.deepEqual(log.checkins.map((c: Json) => c.date), ['2026-04-05', '2026-04-12']);
    assert.equal(add('v/three.json').results[0].action, 'unchanged');
  });

  it('warns about lifts and weeks the engine cannot use', () => {
    const io = mem((f) => (f['v/a.json'] = JSON.stringify({ date: '2026-04-12', weekStart: '2026-04-06', triage: [{ lift: 'Curl', step: 1, date: '2026-04-12' }], deload: { trainedAtFullLoad: ['2026-03-30'], cancelled: true } })));
    const j = parse(run(['checkin', 'add', '--vault', 'v', '--file', 'v/a.json'], io));
    assert.deepEqual(j.warnings.map((w: Json) => w.code), ['unknown-lift', 'not-a-deload-week', 'nothing-to-cancel']);
    assert.equal(j.dryRun, true);
  });
});

describe('cli: checkin on a temp copy of the synthetic vault (the built engine)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pahlavan-vault-'));
  const vault = join(tmp, 'vault');
  const answersDir = mkdtempSync(join(tmpdir(), 'pahlavan-answers-'));
  const LOG = join(vault, '3-Personal', 'Fitness', 'Coach', 'checkins.json');
  let baseline = '';

  before(() => {
    builtEngine();
    cpSync(VAULT, vault, { recursive: true });
    baseline = snapshot(vault);
    writeFileSync(join(answersDir, 'week5.json'), JSON.stringify({ date: '2026-04-05', weekStart: '2026-03-30', recovery: 2, jointAches: [{ area: 'knee', severity: 5, exercise: 'goblet-squat' }] }));
    writeFileSync(join(answersDir, 'week6.json'), JSON.stringify({
      date: '2026-04-12',
      weekStart: '2026-04-06',
      confirmedUnlogged: [{ date: '2026-04-09', type: 'A' }],
      restDays: [],
      missedDays: [],
      effort: 7,
      jointAches: [{ area: 'knee', severity: 4, lingered: true }],
      stress: 2,
      recovery: 2,
      reportedRir: 2.5,
      proteinDays: 5,
      enjoyment: 4,
      knownBusy: [{ from: '2026-04-13', to: '2026-04-17', kind: 'travel' }],
      deload: { cancelled: null, reason: null, trainedAtFullLoad: ['2026-03-23'] },
      triage: [{ lift: 'Flat DB Bench Press', step: 2, date: '2026-04-12' }],
      focusFollowed: null,
      notes: null,
      letter: '3-Personal/Fitness/Coach/Letters/2026-04-12.md',
    }));
    writeFileSync(join(answersDir, 'bad.json'), JSON.stringify({ date: '2026-04-12', weekStart: '2026-04-06', recovery: 9 }));
    writeFileSync(join(answersDir, 'future.json'), JSON.stringify({ date: '2099-01-04', weekStart: '2098-12-29' }));
  });

  it('prints a template pre-filled with what the data knows', () => {
    const r = engine(['checkin', 'template', '--vault', vault, '--date', '2026-04-12']);
    assert.equal(r.code, 0, r.stderr);
    const j = parse(r);
    assert.deepEqual([j.date, j.weekStart, j.existing], ['2026-04-12', '2026-04-06', false]);
    assert.deepEqual(j.record.triage, [{ lift: 'Flat DB Bench Press', step: 1, date: '2026-04-12' }]);
    const topics = j.ask.map((a: Json) => a.topic);
    assert.deepEqual(topics, ['gaps', 'effort', 'pain', 'life', 'recovery', 'rir', 'protein', 'enjoyment', 'availability', 'decisions', 'full-load', 'triage']);
    const gaps = j.ask[0].known;
    assert.deepEqual(gaps.tickedNotLogged, ['2026-04-09']);
    assert.deepEqual(j.ask.find((a: Json) => a.topic === 'full-load').known.weeks, [{ weekStart: '2026-03-23', planWeek: 4, sessions: ['2026-03-23', '2026-03-25'] }]);
    assert.equal(j.ask.find((a: Json) => a.topic === 'protein').known.proteinTicks, 4);
    assert.equal(snapshot(vault), baseline);
  });

  it('a dry run writes nothing', () => {
    const r = engine(['checkin', 'add', '--vault', vault, '--file', join(answersDir, 'week6.json')]);
    assert.equal(r.code, 0, r.stderr);
    const j = parse(r);
    assert.deepEqual([j.dryRun, j.written, j.results[0].action, j.records], [true, false, 'added', 1]);
    assert.equal(snapshot(vault), baseline);
  });

  it('--write writes Coach/checkins.json and touches no other file', () => {
    for (const f of ['week5.json', 'week6.json']) {
      const r = engine(['checkin', 'add', '--vault', vault, '--file', join(answersDir, f), '--write']);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(parse(r).written, true);
    }
    const after = snapshot(vault).split('\n');
    const was = baseline.split('\n');
    const added = after.filter((l) => !was.includes(l));
    const gone = was.filter((l) => !after.includes(l));
    assert.deepEqual(gone, []);
    assert.deepEqual(added.map((l) => l.split(':')[0]), ['3-Personal/Fitness/Coach', '3-Personal/Fitness/Coach/checkins.json'].filter((p) => !was.some((w) => w === p)));
    const log = JSON.parse(readFileSync(LOG, 'utf8'));
    assert.deepEqual(log.checkins.map((c: Json) => c.date), ['2026-04-05', '2026-04-12']);
    assert.equal(log.checkins[1].focusFollowed, undefined); // nulls dropped
    assert.equal(engine(['validate', LOG]).code, 0);
  });

  it('refuses invalid answers and future dates, writing nothing', () => {
    const now = snapshot(vault);
    const bad = engine(['checkin', 'add', '--vault', vault, '--file', join(answersDir, 'bad.json'), '--write']);
    assert.equal(bad.code, 1);
    assert.match(parse(bad).errors[0].message, /recovery: must be at most 5/);
    const future = engine(['checkin', 'add', '--vault', vault, '--file', join(answersDir, 'future.json'), '--write']);
    assert.equal(future.code, 1);
    assert.match(parse(future).errors[0].message, /after today/);
    assert.equal(snapshot(vault), now);
  });

  it('review reads the answers: confirmed sessions, triage resuming, full-load weeks, reported RIR', () => {
    const j = parse(engine(['review', '--vault', vault, '--date', '2026-04-12']));
    assert.deepEqual(j.sources.coach, { profile: 'ok', ledger: 'ok', checkins: 'ok', eating: 'missing' });
    assert.ok(!j.warnings.some((w: Json) => w.code === 'checkins-missing'));
    assert.equal(j.adherence.value.weeks[3].confirmedUnlogged, 1);
    const bench = j.lifts.find((l: Json) => l.name === 'Flat DB Bench Press');
    assert.equal(bench.triageStart.value.startAt, 3);
    assert.equal(bench.triage.find((t: Json) => t.value.chosen).value.step, 3);
    const goblet = j.lifts.find((l: Json) => l.name === 'Goblet Squat');
    assert.deepEqual(goblet.next.reason.inputs.fullLoadSessions, ['2026-03-23']);
    const rdl = j.lifts.find((l: Json) => l.name === 'Romanian Deadlift');
    assert.deepEqual(rdl.next.reason.inputs.reportedRir, { rir: 2.5, checkin: '2026-04-12' });
    assert.equal(j.checkins.records, 2);
    assert.equal(j.checkins.fatigue.value.poorRecovery, true);
  });

  it('review moves the deload onto the busy week and offers the recovery trigger', () => {
    const j = parse(engine(['review', '--vault', vault, '--date', '2026-04-13']));
    assert.deepEqual([j.deload.value.planWeek, j.deload.value.deload], [7, true]);
    assert.deepEqual(j.deload.value.triggers, ['recovery', 'busy-week']);
    assert.deepEqual([j.deload.value.move.from, j.deload.value.move.to], [8, 7]);
    const r = parse(engine(['readiness', '--vault', vault, '--date', '2026-04-13']));
    assert.equal(r.weekly.recoveryTrigger.value, true);
  });

  it('session runs from the built engine and writes nothing', () => {
    const now = snapshot(vault);
    for (const mode of ['full', 'express', 'hotel']) {
      const r = engine(['session', '--vault', vault, '--date', '2026-04-13', '--mode', mode]);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(parse(r).mode, mode);
    }
    // The frozen exercise list for a session logged elsewhere: read only too.
    const f = engine(['session', '--vault', vault, '--date', '2026-04-08', '--type', 'A', '--freeze', '--lift2', 'Incline DB Press']);
    assert.equal(f.code, 0, f.stderr);
    assert.equal(parse(f).freeze.value.lift2.name, 'Incline DB Press');
    assert.equal(snapshot(vault), now);
  });

  it('cleans up', () => {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(answersDir, { recursive: true, force: true });
  });
});

describe('cli: check, drafts and plan-write (the built engine)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pahlavan-plan-write-'));
  const vault = join(tmp, 'vault');
  const planFile = join(vault, '3-Personal', 'Fitness', 'plan-data.json');
  const DATE = '2026-04-20';
  const draftOf = (edit: (doc: Json) => void, name: string) => {
    const doc = JSON.parse(readFileSync(join(VAULT, '3-Personal', 'Fitness', 'plan-data.json'), 'utf8')) as Json;
    edit(doc);
    const file = join(tmp, name);
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    return { doc, file };
  };
  const faceSets = (doc: Json) => {
    doc.sessions.A.find((i: Json) => i.name === 'Face Pull').sr = '4 × 15';
    doc.overrides = [{ code: 'rest', reason: 'The accessories are supersetted in practice.' }];
  };

  before(() => {
    builtEngine();
    cpSync(VAULT, vault, { recursive: true });
  });

  it('check on the fixture vault: its findings, exit 0, and each in the envelope\'s warnings', () => {
    const r = engine(['check', '--vault', 'test/fixtures/vault', '--date', DATE, '--json']);
    assert.equal(r.code, 0, r.stderr);
    const j = parse(r);
    assert.deepEqual(j.findings.map((f: Json) => `${f.level} ${f.code}`), [
      'warning muscle-tags-differ',
      'warning free-text-equipment',
      'warning unknown-preference',
      'warning unknown-movement',
      'warning volume-below-minimum',
      'warning priority-over',
      'warning rest',
      'warning no-why',
      'info snapshot-rebuilt',
      'info legacy-default',
      'info rir-in-note',
    ]);
    assert.deepEqual(j.summary, { errors: 0, warnings: 8, info: 3, overridden: 0, ok: true });
    assert.deepEqual(j.errors, []);
    assert.deepEqual(j.warnings.map((w: Json) => `${w.level} ${w.code}`), j.findings.map((f: Json) => `${f.level} ${f.code}`));
    assert.equal(j.sources.plan, undefined, 'the plan as written, not a draft');
  });

  it('check exits 1 on a hard error: the RDL while the abdominal constraint holds', () => {
    const r = engine(['check', '--vault', 'test/fixtures/vault', '--date', '2026-04-12', '--json']);
    assert.equal(r.code, 1);
    const j = parse(r);
    assert.equal(j.ok, false);
    assert.deepEqual(j.errors.map((e: Json) => e.code), ['ledger-blocked']);
    assert.equal(j.summary.errors, 1);
  });

  it('refuses a draft file that is not there, and --plan where a command does not take it (exit 2)', () => {
    assert.equal(engine(['check', '--vault', 'test/fixtures/vault', '--plan', join(tmp, 'nowhere.json')]).code, 2);
    assert.equal(engine(['review', '--vault', 'test/fixtures/vault', '--plan', join(tmp, 'nowhere.json')]).code, 2);
    assert.match(parse(engine(['readiness', '--vault', 'test/fixtures/vault', '--plan', 'x.json'])).errors[0].message, /readiness does not take --plan/);
    assert.match(parse(engine(['plan-write', '--vault', vault])).errors[0].message, /plan-write needs --file/);
  });

  it('review --plan on a draft equals review once plan-write --write has written it (session too)', () => {
    const { doc, file } = draftOf(faceSets, 'draft.json');
    const before = readFileSync(planFile, 'utf8');
    const viaDraft = parse(engine(['review', '--vault', vault, '--plan', file, '--date', DATE]));
    const sessionDraft = parse(engine(['session', '--vault', vault, '--plan', file, '--date', '2026-04-23', '--type', 'A']));
    assert.deepEqual(viaDraft.sources.plan, { file, draft: true });
    assert.ok(viaDraft.warnings.some((w: Json) => w.code === 'draft-plan'));
    // The dry run: the check, the overrides applied, the diff; nothing written.
    const dry = engine(['plan-write', '--vault', vault, '--file', file, '--date', DATE]);
    assert.equal(dry.code, 0, dry.stderr);
    const d = parse(dry);
    assert.deepEqual([d.dryRun, d.written, d.result], [true, false, 'changed']);
    assert.deepEqual(d.diff, [
      { path: 'sessions.A["Face Pull"].sr', change: 'changed', before: '3 × 15', after: '4 × 15' },
      { path: 'overrides', change: 'added' },
    ]);
    assert.deepEqual(d.overrides.map((o: Json) => o.code), ['rest']);
    assert.equal(readFileSync(planFile, 'utf8'), before);
    // The write: the whole file, read back.
    const wet = engine(['plan-write', '--vault', vault, '--file', file, '--date', DATE, '--write']);
    assert.equal(wet.code, 0, wet.stderr);
    assert.equal(parse(wet).written, true);
    assert.equal(readFileSync(planFile, 'utf8'), `${JSON.stringify(doc, null, 2)}\n`);
    const strip = (j: Json) => {
      const { sources: _s, warnings, ...rest } = j;
      return { ...rest, warnings: warnings.filter((w: Json) => w.code !== 'draft-plan') };
    };
    assert.deepEqual(strip(parse(engine(['review', '--vault', vault, '--date', DATE]))), strip(viaDraft));
    assert.deepEqual(strip(parse(engine(['session', '--vault', vault, '--date', '2026-04-23', '--type', 'A']))), strip(sessionDraft));
    // Checked again after the write: the override holds, and the same draft again changes nothing.
    const after = parse(engine(['check', '--vault', vault, '--date', DATE]));
    assert.equal(after.findings.find((f: Json) => f.code === 'rest').level, 'info');
    const again = parse(engine(['plan-write', '--vault', vault, '--file', file, '--date', DATE, '--write']));
    assert.deepEqual([again.result, again.written, again.diff], ['unchanged', false, []]);
  });

  it('draft: a blank plan in plan-data\'s key order, carrying only the unit, the desk breaks and the start; check --plan reads it', () => {
    const r = engine(['draft', '--vault', 'test/fixtures/vault', '--json']);
    assert.equal(r.code, 0, r.stderr);
    const j = parse(r);
    const written = JSON.parse(readFileSync(planFile, 'utf8')) as Json;
    assert.deepEqual(j.planData, { weekTarget: { lift: 4, short: 0 }, liftTypes: [], shortTypes: [], sessions: {}, liftUnit: 'lb', lifts: {}, guide: {}, deskRoutine: written.deskRoutine, rules: {} });
    assert.deepEqual(Object.keys(j.planData), PLAN_DATA_KEYS.filter((k) => k in j.planData), 'plan-data\'s key order');
    assert.deepEqual(j.from, { liftUnit: 'plan', weekTarget: 'profile', carried: ['liftUnit', 'deskRoutine'] });
    assert.deepEqual([j.warnings, j.errors], [[], []]);
    // The plan's start, when it has one, is carried (so the plan weeks keep counting); nothing else of the training is.
    const started = mkdtempSync(join(tmpdir(), 'pahlavan-draft-'));
    try {
      cpSync(VAULT, started, { recursive: true });
      writeFileSync(join(started, '3-Personal', 'Fitness', 'plan-data.json'), JSON.stringify({ ...written, start: '2026-03-02', deskTiming: { everyMin: 60 }, weeks: 16 }));
      const s = parse(engine(['draft', '--vault', started, '--json']));
      assert.deepEqual([s.planData.start, s.planData.deskTiming, s.planData.weeks, s.from.carried], ['2026-03-02', { everyMin: 60 }, undefined, ['liftUnit', 'deskRoutine', 'deskTiming', 'start']]);
      assert.deepEqual(Object.keys(s.planData).slice(-4), ['deskRoutine', 'deskTiming', 'start', 'rules']);
    } finally {
      rmSync(started, { recursive: true, force: true });
    }
    // The plan check reads the draft as plan-data.json: no plan-data error, no hard error.
    const file = join(tmp, 'blank.json');
    writeFileSync(file, `${JSON.stringify(j.planData, null, 2)}\n`);
    const c = engine(['check', '--vault', 'test/fixtures/vault', '--plan', file, '--date', DATE, '--json']);
    assert.equal(c.code, 0, c.stdout.slice(0, 400));
    const checked = parse(c);
    assert.deepEqual(checked.errors, []);
    assert.ok(!checked.findings.some((f: Json) => f.code === 'plan-data' || f.code === 'invalid-data'), checked.findings.map((f: Json) => f.code).join(', '));
    assert.ok(checked.findings.some((f: Json) => f.code === 'draft-plan'));
  });

  it('overlap: each plan\'s movements and shape, the shares both ways, each against the plan as written, and what is over half', () => {
    const swapped = draftOf((doc) => {
      doc.sessions.A.find((i: Json) => i.name === 'Face Pull').name = 'Reverse Fly';
      doc.sessions.B.find((i: Json) => i.name === 'Seated Cable Row').name = 'Chest-Supported Row';
    }, 'swapped.json');
    const other = draftOf((doc) => {
      doc.sessions = { A: [{ name: 'Back Squat', sr: '3 × 5' }, { name: 'Dumbbell bench press', sr: '3 × 8' }], B: [{ name: 'Deadlift', sr: '3 × 5' }, { name: 'Lat Pulldown', sr: '3 × 10' }] };
      doc.shortTypes = [];
    }, 'other.json');
    const blank = draftOf((doc) => {
      doc.sessions = {};
      doc.liftTypes = [];
      doc.shortTypes = [];
    }, 'blank-overlap.json');
    const r = engine(['overlap', '--plans', [swapped.file, other.file, blank.file].join(','), '--vault', 'test/fixtures/vault', '--json']);
    assert.equal(r.code, 0, r.stderr);
    const j = parse(r);
    assert.deepEqual([j.command, j.ok, j.limit], ['overlap', true, 0.5]);
    assert.deepEqual(j.drafts.map((d: Json) => [d.file, d.movements.length]), [[swapped.file, 11], [other.file, 4], [blank.file, 0]]);
    assert.deepEqual(j.drafts[1].movements.map((m: Json) => [m.id, m.name, m.source, m.sessions]), [['back-squat', 'Back Squat', 'catalogue', ['A']], ['db-bench', 'Dumbbell bench press', 'catalogue', ['A']], ['deadlift', 'Deadlift', 'catalogue', ['B']], ['lat-pulldown', 'Lat Pulldown', 'catalogue', ['B']]]);
    assert.deepEqual(j.drafts[1].shape, { liftDays: 3, liftSessions: 2, sessions: [{ type: 'A', kind: 'lift', patterns: ['squat', 'horizontal-push'] }, { type: 'B', kind: 'lift', patterns: ['hinge', 'vertical-pull'] }] });
    // matrix[i][j]: the share of plan i's movements plan j also holds (rounded to 3 places); a plan with none has no share.
    assert.deepEqual(j.matrix, [[1, 0.091, 0], [0.25, 1, 0], [null, null, null]]);
    assert.deepEqual(j.pairs.map((p: Json) => [p.aInB, p.bInA, p.shared]), [[0.091, 0.25, ['db-bench']], [0, null, []], [0, null, []]]);
    assert.equal(j.current.file, '3-Personal/Fitness/plan-data.json');
    assert.deepEqual(j.againstCurrent.map((x: Json) => [x.draft, x.draftInCurrent, x.currentInDraft, x.shared.length]), [[swapped.file, 0.818, 0.818, 9], [other.file, 0.25, 0.091, 1], [blank.file, null, 0, 0]]);
    // Over half, one direction each: the swapped draft keeps 9 of the plan's 11 movements.
    assert.deepEqual(j.similar, [{ a: swapped.file, b: '3-Personal/Fitness/plan-data.json', share: 0.818, current: true }]);
    // Without --vault: the drafts against each other only.
    const bare = parse(engine(['overlap', '--plans', `${swapped.file},${planFile}`, '--json']));
    assert.deepEqual([bare.current, bare.againstCurrent, bare.vault], [null, null, undefined]);
    assert.deepEqual(bare.similar.map((x: Json) => [x.share, x.current]), [[0.818, false], [0.818, false]]);
  });

  it('check --plan --redesign: the changes are information, a draft much like the plan as written warns; plan-write --redesign checks the same', () => {
    // Two accessories swapped (a logged lift renamed would need its lifts entry).
    const { file } = draftOf((doc) => {
      doc.sessions.A.find((i: Json) => i.name === 'Face Pull').name = 'Reverse Fly';
      doc.sessions.B.find((i: Json) => i.name === 'Bulgarian Split Squat').name = 'Reverse Lunge';
    }, 'redesign.json');
    // Plan week 10: week 2 of mesocycle 3, where an accessory change is an exercise-change warning.
    const at = '2026-05-04';
    const plain = parse(engine(['check', '--vault', 'test/fixtures/vault', '--plan', file, '--date', at, '--json']));
    assert.ok(plain.findings.some((f: Json) => f.code === 'exercise-change' && f.level === 'warning'));
    assert.ok(!plain.findings.some((f: Json) => f.code === 'similar-to-current' || f.code === 'redesign-changes'));
    assert.equal(plain.redesign, undefined);
    const r = engine(['check', '--vault', 'test/fixtures/vault', '--plan', file, '--redesign', '--date', at, '--json']);
    assert.equal(r.code, 0, r.stdout.slice(0, 400));
    const j = parse(r);
    assert.equal(j.redesign, true);
    const of = (code: string) => j.findings.find((f: Json) => f.code === code);
    assert.equal(of('exercise-change'), undefined);
    assert.equal(of('redesign-changes').level, 'info');
    assert.deepEqual([of('similar-to-current').level, of('similar-to-current').grade, of('similar-to-current').message], ['warning', 'heuristic', '82% of the draft\'s movements (9 of 11) are in the plan as written (over half).']);
    assert.ok(j.warnings.some((w: Json) => w.code === 'similar-to-current'));
    // plan-write --redesign: the same check, a dry run, nothing persisted in the draft.
    const before = readFileSync(planFile, 'utf8');
    const w = engine(['plan-write', '--vault', vault, '--file', file, '--redesign', '--date', at]);
    assert.equal(w.code, 0, w.stdout.slice(0, 400));
    const pw = parse(w);
    assert.deepEqual([pw.redesign, pw.dryRun, pw.written, pw.result], [true, true, false, 'changed']);
    assert.ok(pw.findings.some((f: Json) => f.code === 'similar-to-current') && pw.findings.some((f: Json) => f.code === 'redesign-changes'));
    assert.ok(!pw.diff.some((d: Json) => /redesign/.test(d.path)));
    assert.equal(readFileSync(planFile, 'utf8'), before);
    const plainWrite = parse(engine(['plan-write', '--vault', vault, '--file', file, '--date', at]));
    assert.equal(plainWrite.redesign, undefined);
    assert.ok(plainWrite.findings.some((f: Json) => f.code === 'exercise-change'));
  });

  it('plan-write refuses a draft with a hard error, --write or not, and writes nothing', () => {
    const { file } = draftOf((doc) => {
      doc.sessions.B.find((i: Json) => i.name === 'Bulgarian Split Squat').logged = true;
    }, 'bad-draft.json');
    const before = readFileSync(planFile, 'utf8');
    const r = engine(['plan-write', '--vault', vault, '--file', file, '--date', DATE, '--write']);
    assert.equal(r.code, 1);
    const j = parse(r);
    assert.deepEqual([j.result, j.written, j.errors.map((e: Json) => e.code)], ['refused', false, ['no-lift-entry']]);
    assert.equal(readFileSync(planFile, 'utf8'), before);
  });

  it('cleans up', () => {
    rmSync(tmp, { recursive: true, force: true });
  });
});

describe('cli: plan-write re-checks and reads back (in memory)', () => {
  const PLAN = 'v/3-Personal/Fitness/plan-data.json';
  const argv = ['plan-write', '--vault', 'v', '--file', 'draft.json', '--date', '2026-04-20', '--write'];
  const setup = () => {
    const files = fixtureFiles('v');
    const doc = JSON.parse(files[PLAN]!) as Json;
    doc.sessions.A.find((i: Json) => i.name === 'Face Pull').sr = '4 × 15';
    files['draft.json'] = JSON.stringify(doc);
    return { files, base: memoryIo(files, '2026-04-20') };
  };

  it('checks and diffs again when plan-data.json changes after the check, then stops as busy, writing nothing', () => {
    const { files, base } = setup();
    let reads = 0;
    let writes = 0;
    const io = {
      ...base,
      // Another writer (Pahlavan, a sync) changes the plan between every read.
      readText: (path: string) => {
        if (path !== PLAN) return base.readText(path);
        reads++;
        return JSON.stringify({ ...JSON.parse(files[PLAN]!), _edited: reads });
      },
      writePlan: () => {
        writes++;
      },
    };
    const r = run(argv, io);
    assert.equal(r.code, 1);
    const j = parse(r);
    assert.deepEqual([j.written, j.errors.map((e: Json) => e.code)], [false, ['busy']]);
    assert.equal(writes, 0);
    assert.equal(reads, 6, 'two rounds, each reading the plan for the diff, the draft\'s reading and the check before writing');
  });

  it('says so when plan-data.json does not read back as written', () => {
    const { files, base } = setup();
    const before = files[PLAN];
    const io = { ...base, writePlan: (_root: string, text: string) => void (files[PLAN] = `${text.trimEnd()} `) };
    const r = run(argv, io);
    assert.equal(r.code, 1);
    const j = parse(r);
    assert.deepEqual([j.written, j.errors.map((e: Json) => e.code)], [false, ['read-back']]);
    assert.notEqual(files[PLAN], before, 'it wrote once');
    // Written as it should be, it reads back.
    const ok = setup();
    const good = run(argv, { ...ok.base, writePlan: (_root: string, text: string) => void (ok.files[PLAN] = text) });
    assert.deepEqual([good.code, parse(good).written], [0, true]);
  });
});

describe('cli: engine 0.4.0 outputs (in memory, on the synthetic vault)', () => {
  const io = mem();
  const j = (argv: string[], i = io) => {
    const r = run(argv, i);
    assert.equal(r.code, 0, r.stdout);
    return parse(r);
  };
  const reasons = (v: unknown, out: Json[] = []): Json[] => {
    if (Array.isArray(v)) v.forEach((x) => reasons(x, out));
    else if (v && typeof v === 'object') {
      if (typeof (v as Json).rule === 'string' && 'inputs' in (v as Json)) out.push(v as Json);
      Object.values(v).forEach((x) => reasons(x, out));
    }
    return out;
  };

  it('gives every lift-related weight in the exercise\'s unit, with the logged original beside it', () => {
    const r = j(['review', '--vault', 'v', '--date', '2026-04-06']);
    const rdl = r.lifts.find((l: Json) => l.name === 'Romanian Deadlift');
    assert.deepEqual(rdl.last, { date: '2026-04-06', weight: 70, unit: 'kg', reps: 8, logged: { weight: 154, unit: 'lb' } });
    assert.deepEqual(r.thisWeek.sessions[0].lifts[0], { exercise: 'romanian-deadlift', name: 'Romanian Deadlift', weight: 70, unit: 'kg', reps: 8, logged: { weight: 154, unit: 'lb' } });
    assert.deepEqual(rdl.e1rm.value.points.at(-1).logged, { weight: 154, unit: 'lb' });
    assert.equal(rdl.e1rm.value.points.at(-1).weight, 70);
    assert.deepEqual(rdl.next.reason.inputs.last.sets, [{ weight: 70, unit: 'kg', reps: 8, logged: { weight: 154, unit: 'lb' } }]);
    const t = j(['checkin', 'template', '--vault', 'v', '--date', '2026-04-12']);
    const tops = t.ask.find((a: Json) => a.topic === 'rir').known.topSets;
    assert.deepEqual(tops[0], { date: '2026-04-06', lift: 'Romanian Deadlift', weight: 70, unit: 'kg', reps: 8, atTopOfRange: false });
  });

  it('titles every reason in review, session and the template', () => {
    const all = [
      ...reasons(j(['review', '--vault', 'v', '--date', '2026-04-12'])),
      ...reasons(j(['session', '--vault', 'v', '--date', '2026-04-10'])),
      ...reasons(j(['session', '--vault', 'v', '--date', '2026-04-10', '--mode', 'hotel'])),
      ...reasons(j(['checkin', 'template', '--vault', 'v', '--date', '2026-04-12'])),
    ];
    assert.ok(all.length > 50);
    const untitled = [...new Set(all.filter((x) => typeof x.title !== 'string' || !x.title || x.title === 'Rule').map((x) => x.rule))];
    assert.deepEqual(untitled, []);
  });

  it('writes the template\'s questions for people, numbered as they appear', () => {
    const t = j(['checkin', 'template', '--vault', 'v', '--date', '2026-04-12']);
    assert.equal(t.ask[0].question, 'The log shows Full Body B on Mon 6 Apr, Short 1 · Skills on Tue 7 Apr, Full Body A on Wed 8 Apr, Easy run on Fri 10 Apr and Full Body B on Sat 11 Apr. Anything you did that isn\'t logged?');
    assert.deepEqual(t.ask.map((a: Json) => a.n), t.ask.map((_: Json, i: number) => i + 1));
    assert.deepEqual(t.ask.filter((a: Json) => a.checkinMd).map((a: Json) => a.checkinMd), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const a of t.ask) {
      assert.doesNotMatch(a.question, /\d{4}-\d{2}-\d{2}/, a.topic);
      assert.doesNotMatch(a.question, / x /, a.topic);
    }
    assert.match(t.ask.find((a: Json) => a.topic === 'full-load').question, /week 4 \(from Mon 23 Mar\)/);
  });

  it('session: the next in the rotation, the Ledger swap, targets in the lift\'s unit, warm-up and finisher', () => {
    const s = j(['session', '--vault', 'v', '--date', '2026-04-10']);
    assert.deepEqual([s.session.type, s.session.name, s.session.logged, s.mode], ['B', 'Full Body B', false, 'full']);
    assert.match(s.session.why, /Next in the lifting rotation; the training calendar has a lifting day on Friday/);
    assert.equal(s.warmup, '3 min bike · band external rotation');
    assert.deepEqual(s.finisher, { exercise: 'zone-2-finisher', name: 'Zone 2 finisher', sr: '5–10 min', timed: { minutes: 5, text: '5 min' } });
    const rdl = s.items[0];
    assert.deepEqual([rdl.exercise, rdl.replaces], ['single-leg-rdl', { exercise: 'romanian-deadlift', name: 'Romanian Deadlift' }]);
    assert.equal(rdl.adjustments[0].title, 'Injury limit');
    const row = s.items[1];
    assert.deepEqual(row.target, { weight: 115, unit: 'lb', reps: 11, rir: 2, action: 'add-reps' });
    assert.deepEqual(row.adjustments.map((a: Json) => a.title), ['Progression', 'Unit check']);
    assert.equal(row.sr, '3 × 10–12');
    assert.deepEqual(s.flags.map((f: Json) => f.title), ['Readiness']);
    assert.deepEqual([s.plannedLoad.minutes, s.plannedLoad.rpe, s.plannedLoad.load], [60, 7.5, 450]);
  });

  it('session --mode express and hotel', () => {
    const e = j(['session', '--vault', 'v', '--date', '2026-04-10', '--mode', 'express']);
    assert.deepEqual(e.items.map((i: Json) => [i.name, i.sets]), [['Single-leg dumbbell RDL', 1], ['Seated Cable Row', 2]]); // glutes sore on 10 Apr: one set fewer
    assert.deepEqual(e.finisher, { exercise: 'face-pull', name: 'Face Pull', sets: 2, repRange: [15, 15], sr: '2 × 15' });
    assert.equal(e.warmup, 'band external rotation + dislocates');
    const h = j(['session', '--vault', 'v', '--date', '2026-04-10', '--mode', 'hotel']);
    assert.deepEqual(h.items.map((i: Json) => i.name), ['Dumbbell Romanian deadlift', 'Band row', 'Dumbbell split squat', 'Side Plank']);
    const db = h.items[0];
    assert.deepEqual(db.adjustments.map((a: Json) => a.title), ['Hotel swap', 'Injury limit', 'Soreness', 'Progression']); // allowed with the abdominal conditions
    assert.match(h.items[1].adjustments.at(-1).note, /pick a band/);
    assert.equal(run(['session', '--vault', 'v', '--mode', 'gym'], io).code, 2);
  });

  it('session --type: the user’s pick, built the same way; an unknown type is a usage error', () => {
    const a = j(['session', '--vault', 'v', '--date', '2026-04-10', '--type', 'A']);
    assert.deepEqual([a.session.type, a.session.picked, a.session.suggested.type], ['A', true, 'B']);
    assert.equal(a.session.why, 'Chosen by you; the rotation suggested Full Body B.');
    assert.deepEqual(a.flags.map((f: Json) => f.title), ['Readiness']);
    const ae = j(['session', '--vault', 'v', '--date', '2026-04-10', '--type', 'A', '--mode', 'express']);
    assert.deepEqual([ae.mode, ae.session.type], ['express', 'A']);
    const r = run(['session', '--vault', 'v', '--date', '2026-04-10', '--type', 'Z'], io);
    assert.equal(r.code, 2);
    assert.match(r.stdout, /--type must be one of the plan's sessions: A, B, S1, S3/);
  });

  it('session: soreness two days running swaps to a lighter variation; low readiness trims', () => {
    const sore = mem((f) => {
      const p = 'v/3-Personal/Fitness/body-data.json';
      const b = JSON.parse(f[p]!);
      b.days['2026-04-12'] = { soreMuscles: { glutes: 'sore' } };
      b.days['2026-04-13'] = { soreMuscles: { glutes: 'sore', chest: 'mild' } };
      f[p] = JSON.stringify(b);
    });
    const s = j(['session', '--vault', 'v', '--date', '2026-04-13'], sore);
    assert.equal(s.session.type, 'A');
    const squat = s.items[0];
    assert.deepEqual([squat.exercise, squat.replaces.name], ['heel-elevated-goblet-squat', 'Goblet Squat']);
    assert.deepEqual(squat.adjustments.map((a: Json) => a.title), ['Temporary change', 'Injury limit', 'Soreness', 'Readiness', 'Progression']);
    assert.match(squat.adjustments[2].note, /^Pahlavan's default \(the plan sets none\): a sore main muscle's exercise takes one set off and 1 more RIR; .* Glutes sore two days running: Heel-elevated goblet squat in place of Goblet Squat today/);
    assert.equal(squat.adjustments[2].from.path, 'rules.soreness');
    const bench = s.items[1];
    assert.deepEqual([bench.sets, bench.rir], [2, 3]); // readiness low (11 Apr): one set fewer, RIR +1
    assert.deepEqual(bench.adjustments.map((a: Json) => a.title), ['Soreness', 'Readiness', 'Progression', 'Effort today']);
    assert.match(bench.adjustments[0].note, /Chest mildly sore/);
    assert.deepEqual([bench.target.weight, bench.target.rir], [55, 3]);
  });

  it('review: training load this week, the 4 before and next week planned; soreness per muscle', () => {
    const r = j(['review', '--vault', 'v', '--date', '2026-04-12']);
    const w = r.load.thisWeek.value;
    assert.deepEqual([w.load, w.daily], [1890, [450, 360, 480, 0, 120, 480, 0]]);
    approx(w.monotony, 1.2135597524338357, 1e-12);
    assert.equal(r.load.thisWeek.reason.title, 'Training load');
    assert.deepEqual(r.load.last4.map((x: Json) => x.value.load), [null, null, null, null]);
    const n = r.load.nextWeek.value;
    // A short day's minutes as planned, from its items (1-min warm-up, 4 rounds of 2 moves at 40/20, a 3-min cool-down), not its logged 20.
    assert.deepEqual(n.sessions.map((p: Json) => [p.name, p.minutes, p.rpe, p.load]), [['Full Body A', 60, 8, 480], ['Full Body B', 60, 7.5, 450], ['Full Body A', 60, 8, 480], ['Short 3 · Conditioning', 12, 8, 96]]);
    assert.equal(n.load, 1506);
    assert.deepEqual(r.soreness.thisWeek.value, { glutes: { mild: 0, sore: 2 }, quads: { mild: 1, sore: 0 }, hamstrings: { mild: 1, sore: 0 } });
    assert.deepEqual(r.soreness.today, {});
  });
});
