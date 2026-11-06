// Shared test helpers: fixture loading, approximate numbers, small builders.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  Body,
  Checkins,
  DailyCheckin,
  ExerciseSlot,
  LoggedSet,
  Log,
  Profile,
  Program,
  Session,
  TrackingLevel,
  Unit,
  WeekKind,
} from '../src/core/schema.ts';
import { useFolders, type Folders } from '../src/adapters/vault/layout.ts';

export const ROOT = join(import.meta.dirname, '..');

/**
 * A real vault to compare against, for the tests that check a port against
 * its original (Habit Nudges' main.js, a calendar script): PAHLAVAN_LIVE_VAULT,
 * or the path in a git-ignored `.live-vault` file at the repository's root.
 * Null without either; those tests then skip their live part.
 */
export const LIVE_VAULT: string | null = process.env['PAHLAVAN_LIVE_VAULT'] || (existsSync(join(ROOT, '.live-vault')) ? readFileSync(join(ROOT, '.live-vault'), 'utf8').trim() || null : null);

/**
 * The synthetic vault's folders: a fitness folder two folders down, with the
 * habit check-ins and Habit Nudges' work timer elsewhere, as an older install
 * kept them. Every test that imports this helper reads and writes in this
 * layout; a test of another layout sets its own with `useFolders`.
 */
export const FIXTURE_FOLDERS: Folders = { fitness: '3-Personal/Fitness', habits: '5-System/Data/habits-data.json', workTimer: '5-System/Data/work-timer-data.json' };
useFolders(FIXTURE_FOLDERS);

let built: string | null = null;
/**
 * The CLI built once for this test process, into its own temp folder: the
 * test runner runs files in parallel, and two of them rebuilding dist/ at
 * once used to delete the engine under the other ("Cannot find module").
 */
export function builtEngine(): string {
  if (built) return built;
  const tmp = mkdtempSync(join(tmpdir(), 'pahlavan-engine-'));
  process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
  const dir = join(tmp, 'dist');
  const b = spawnSync(process.execPath, [join(ROOT, 'tools', 'build.mjs'), '--out', dir], { encoding: 'utf8', cwd: ROOT });
  assert.equal(b.status, 0, b.stderr);
  built = join(dir, 'engine.cjs');
  return built;
}

export function approx(actual: number | null | undefined, expected: number, tol = 1e-6, label = ''): void {
  assert.equal(typeof actual, 'number', `${label}: expected a number, got ${String(actual)}`);
  assert.ok(Math.abs((actual as number) - expected) <= tol, `${label}: ${actual} is not within ${tol} of ${expected}`);
}

/** Compares numbers approximately and everything else exactly, recursively. */
export function near(actual: unknown, expected: unknown, label = 'value', tol = 1e-6): void {
  if (typeof expected === 'number') return approx(actual as number, expected, tol, label);
  if (expected === null || typeof expected !== 'object') return assert.equal(actual, expected, label);
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${label}: expected a list`);
    assert.equal((actual as unknown[]).length, expected.length, `${label}: length`);
    expected.forEach((x, i) => near((actual as unknown[])[i], x, `${label}[${i}]`, tol));
    return;
  }
  assert.ok(actual !== null && typeof actual === 'object', `${label}: expected an object`);
  const a = actual as Record<string, unknown>;
  const e = expected as Record<string, unknown>;
  assert.deepEqual(Object.keys(a).sort(), Object.keys(e).sort(), `${label}: keys`);
  for (const k of Object.keys(e)) near(a[k], e[k], `${label}.${k}`, tol);
}

// ---------------------------------------------------------------- fixtures

export interface Fixture {
  name: string;
  about: string;
  today: string;
  data: { profile?: Profile; program?: Program; logs?: Log[]; checkins?: Checkins; body?: Body; inputs?: Record<string, unknown> };
  expected: Record<string, unknown>;
}

export function loadFixtures(): Fixture[] {
  const dir = join(ROOT, 'test', 'fixtures');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Fixture);
}

export const sessionsOf = (f: Fixture): Session[] => (f.data.logs ?? []).flatMap((l) => l.sessions);

// ---------------------------------------------------------------- builders

export const set = (weight: number, reps: number, unit: Unit = 'kg', rir?: number): LoggedSet =>
  rir === undefined ? { weight, unit, reps } : { weight, unit, reps, rir };

export const slot = (exercise: string, sets: number, lo: number, hi: number, rir = 2): ExerciseSlot => ({
  exercise,
  sets,
  repRange: [lo, hi],
  rir,
});

export function session(
  date: string,
  opts: {
    level?: TrackingLevel;
    logged?: Record<string, LoggedSet[]>;
    slots?: ExerciseSlot[];
    weekKind?: WeekKind;
    skipped?: string[];
  } = {},
): Session {
  const s: Session = {
    id: `${date}-s`,
    date,
    trackingLevel: opts.level ?? 'standard',
    exercises: Object.entries(opts.logged ?? {}).map(([exercise, sets]) => ({ exercise, sets })),
  };
  if (opts.slots) s.plan = { weekKind: opts.weekKind ?? 'loading', template: 't', slots: opts.slots };
  if (opts.skipped) s.skipped = opts.skipped;
  return s;
}

/** Consecutive daily check-ins from `start`, one per value row. */
export function days(start: string, rows: Omit<DailyCheckin, 'date'>[]): DailyCheckin[] {
  const base = Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, Number(start.slice(8, 10)));
  return rows.map((r, i) => ({ date: new Date(base + i * 86_400_000).toISOString().slice(0, 10), ...r }));
}

// ---------------------------------------------------------------- the vault fixture

export const VAULT = join(ROOT, 'test', 'fixtures', 'vault');

/** Reads real files (the synthetic vault), read-only. */
export const fsIo = {
  readText: (p: string): string | null => (existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null),
  listDir: (p: string): string[] | null => (existsSync(p) && statSync(p).isDirectory() ? readdirSync(p) : null),
  isDir: (p: string): boolean => existsSync(p) && statSync(p).isDirectory(),
  today: (): string => '2026-04-12',
};

/** An in-memory vault: paths to file text; folders are implied by the paths. */
export function memoryIo(files: Record<string, string>, today = '2026-04-12') {
  const norm = (p: string) => p.replace(/^\.\//, '').replace(/\/+$/, '');
  return {
    readText: (p: string): string | null => files[norm(p)] ?? null,
    listDir: (p: string): string[] | null => {
      const dir = norm(p);
      const names = Object.keys(files).filter((f) => f.startsWith(`${dir}/`)).map((f) => f.slice(dir.length + 1).split('/')[0]!);
      return names.length ? [...new Set(names)] : null;
    },
    isDir: (p: string): boolean => p === '.' || Object.keys(files).some((f) => f.startsWith(`${norm(p)}/`)),
    today: (): string => today,
  };
}

/** The fixture's files with made-up "Why:" lines on a few of the plan's notes (the plan's own reasons). */
export function fixtureWithWhy(root = 'v'): Record<string, string> {
  const files = fixtureFiles(root);
  const path = `${root}/3-Personal/Fitness/plan-data.json`;
  const plan = JSON.parse(files[path]!);
  const add = (type: string, name: string, why: string) => {
    const it = plan.sessions[type].find((x: { name: string }) => x.name === name);
    it.note = `${it.note ? `${it.note} ` : ''}Why: ${why}`;
  };
  add('B', 'Romanian Deadlift', 'the main hinge, for the hamstrings and the back.');
  add('B', 'Zone 2 finisher', 'easy minutes toward the cardio goal.');
  add('A', 'Goblet Squat', 'the knee tolerates it while the back squat waits.');
  files[path] = JSON.stringify(plan);
  return files;
}

/** The fixture's files as a map for memoryIo, under `root`. */
export function fixtureFiles(root = 'v'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of readdirSync(VAULT, { recursive: true })) {
    const p = join(VAULT, rel);
    if (statSync(p).isFile()) out[`${root}/${rel}`] = readFileSync(p, 'utf8');
  }
  return out;
}
