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
import { HELP, run, VERSION_LINE } from '../src/cli/cli.ts';
import { readinessSeries } from '../src/core/readiness.ts';
import { SCHEMA_VERSION } from '../src/core/schema.ts';
import { ENGINE_VERSION } from '../src/core/version.ts';
import { approx, builtEngine, fixtureFiles, memoryIo, ROOT, VAULT } from './helpers.ts';

const PROFILE = join(VAULT, '3-Personal', 'Fitness', 'Coach', 'profile.json');
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
  it('keeps the engine version equal to package.json', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
    assert.equal(ENGINE_VERSION, pkg.version);
    assert.equal(SCHEMA_VERSION, 1);
  });

  it('prints the engine and schema versions, as text or JSON', () => {
    assert.deepEqual(run(['--version']), { code: 0, stdout: `pahlavan engine ${ENGINE_VERSION} (schema v1)\n`, stderr: '' });
    assert.equal(run(['-v']).stdout, `${VERSION_LINE}\n`);
    assert.deepEqual(parse(run(['--version', '--json'])), { engine: ENGINE_VERSION, schema: 1 });
  });

  it('prints help with no arguments, --help, or a command and --help', () => {
    assert.equal(run([]).stdout, HELP);
    assert.equal(run(['--help']).code, 0);
    assert.equal(run(['review', '--help']).stdout, HELP);
    for (const c of ['review', 'readiness', 'next', 'plan', 'validate', '--pretty', 'Exit codes']) assert.ok(HELP.includes(c), c);
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
    [['plan'], /plan needs --profile/],
    [['plan', '--profile', 'p.json', '--weeks', '10'], /--weeks must be 12, 16 or 24/],
    [['plan', '--profile', 'p.json', '--format', 'csv'], /--format must be engine or plan-data/],
    [['plan', '--profile', 'p.json', '--history'], /--history needs --vault/],
    [['plan', '--profile', 'missing.json'], /profile not found: missing\.json/],
    [['validate'], /validate takes one file/],
    [['validate', 'v/x.json', '--kind', 'diary'], /--kind must be one of/],
    [['--bogus'], /unknown arguments/],
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
});

describe('cli: data problems exit 1', () => {
  it('a vault without plan-data.json', () => {
    const r = run(['review', '--vault', 'v'], memoryIo({ 'v/3-Personal/Fitness/body-data.json': '{}' }));
    assert.equal(r.code, 1);
    assert.equal(parse(r).errors[0].code, 'missing');
  });

  it('a file that is not valid JSON', () => {
    const r = run(['review', '--vault', 'v', '--date', '2026-04-12'], mem((f) => (f['v/3-Personal/Fitness/fitness-log-data.json'] = '{')));
    assert.equal(r.code, 1);
    assert.equal(parse(r).errors[0].code, 'json');
  });

  it('an invalid profile for plan', () => {
    const r = run(['plan', '--profile', 'v/p.json'], mem((f) => (f['v/p.json'] = '{"schemaVersion": 1}')));
    assert.equal(r.code, 1);
    assert.ok(parse(r).errors.every((e: Json) => e.code === 'profile'));
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

  it('plan reports the missing profile', () => {
    const r = run(['plan', '--profile', 'v/3-Personal/Fitness/Coach/profile.json'], io);
    assert.equal(r.code, 2);
    assert.match(parse(r).errors[0].message, /profile not found/);
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
    assert.deepEqual(review.week, { from: '2026-04-06', to: '2026-04-12', planStart: '2026-03-02', planWeek: 6, planWeeks: 24, phase: 1, mesocycle: 2, weekInMesocycle: 2, deload: false, deloadNext: false });
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

  it('matches the snippets: planned sets per muscle (target / types weighting)', () => {
    const p = review.volume.planned.value.perWeek;
    for (const [m, v] of Object.entries(expected.snippets.volume.planned) as [string, number][]) approx(p[m], v, 1e-9, m);
    assert.deepEqual(review.volume.planned.reason.inputs.weights, { a: 1.5, b: 1.5, s1: 0.5, s3: 0.5 });
  });

  it('differs from the snippets on done sets exactly by the documented choices', () => {
    // A timed "6 min" handstand is not counted (3 sets: shoulders 3, triceps, upper back, abs 1.5);
    // the skipped paired line drops face pulls (3) and band external rotation (2);
    // the Bulgarian split squat was swapped for walking lunges (abs -1.5, calves +1.5).
    const diff: Record<string, number> = { shoulders: -8, triceps: -1.5, 'upper-back': -5.5, abs: -3, calves: 1.5 };
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

  it('plans from the profile, as the engine program or as plan-data', () => {
    const e = engine(['plan', '--profile', PROFILE, '--ledger', LEDGER, '--start', '2026-04-13', '--weeks', '12']);
    assert.equal(e.code, 0, e.stderr);
    const j = parse(e);
    assert.equal(j.program.macrocycle.start, '2026-04-13');
    assert.equal(j.program.macrocycle.phases.length, 2);
    assert.ok(Array.isArray(j.proposal.checks));
    const p = engine(['plan', '--profile', PROFILE, '--start', '2026-04-13', '--history', '--vault', 'test/fixtures/vault', '--format', 'plan-data']);
    assert.equal(p.code, 0, p.stderr);
    const pd = parse(p);
    assert.deepEqual(Object.keys(pd.planData).slice(0, 4), ['_about', 'weekTarget', 'liftTypes', 'shortTypes']);
    assert.deepEqual(pd.planData.ladders, JSON.parse(readFileSync(join(VAULT, '3-Personal', 'Fitness', 'plan-data.json'), 'utf8')).ladders);
    assert.ok(pd.unexpressible.some((u: Json) => u.what === 'RIR targets'));
  });

  it('counts the plan\'s sets per muscle on the vault\'s map, as review will count them', () => {
    const args = ['plan', '--profile', PROFILE, '--start', '2026-04-13', '--weeks', '12', '--vault', 'test/fixtures/vault'];
    const e = parse(engine(args));
    assert.equal(e.proposal.volumeMap.source, 'vault');
    assert.ok(e.proposal.volumeMap.fromVault.some((x: Json) => x.exercise === 'goblet-squat' && x.guide === 'Goblet Squat'));
    // Write the exported plan into a copy of the vault and let review count its planned week.
    const pd = parse(engine([...args, '--format', 'plan-data']));
    const tmp = mkdtempSync(join(tmpdir(), 'pahlavan-vaultmap-'));
    try {
      cpSync(VAULT, tmp, { recursive: true });
      writeFileSync(join(tmp, '3-Personal', 'Fitness', 'plan-data.json'), JSON.stringify(pd.planData, null, 2));
      const review = parse(engine(['review', '--vault', tmp, '--date', '2026-04-14']));
      assert.equal(review.volume.weekKind, 'loading');
      const proposed = e.proposal.volume.find((v: Json) => v.week === pd.week.index).perWeek as Record<string, number>;
      const counted = review.volume.planned.value.perWeek as Record<string, number>;
      for (const m of new Set([...Object.keys(proposed), ...Object.keys(counted)])) approx(counted[m] ?? 0, proposed[m] ?? 0, 1e-9, m);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
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
    assert.deepEqual(s.finisher, { exercise: 'zone-2-finisher', name: 'Zone 2 finisher', sr: '5–10 min' });
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
    assert.deepEqual(e.finisher, { exercise: 'face-pull', name: 'Face Pull', sr: '2 × 15' });
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
    assert.match(squat.adjustments[2].note, /^Glutes sore two days running: Heel-elevated goblet squat in place of Goblet Squat today/);
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
