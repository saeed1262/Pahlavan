// The reports (src/report) and the vault adapter must run in an Obsidian
// plugin as well as the Node CLI: no Node, Obsidian or DOM APIs, no clock.
// The CLI and the plugin produce their output from the same functions; this
// file checks the pieces the plugin adds (the async reader, the Today report).

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readVault, readVaultAsync } from '../src/adapters/vault/read.ts';
import { paths } from '../src/adapters/vault/layout.ts';
import { readinessInputs, readinessOn } from '../src/core/readiness.ts';
import { run } from '../src/cli/cli.ts';
import { buildReview, buildSession, buildToday, weekDays } from '../src/report/index.ts';
import { ROOT } from './helpers.ts';

const VAULT = join(ROOT, 'test', 'fixtures', 'vault');
const fsIo = {
  readText: (p: string) => (existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null),
  listDir: (p: string) => (existsSync(p) && statSync(p).isDirectory() ? readdirSync(p) : null),
};
const asyncIo = {
  readText: async (p: string) => fsIo.readText(p),
  listDir: async (p: string) => fsIo.listDir(p),
};
const DATE = '2026-04-10';

function sources(dir: string) {
  return readdirSync(join(ROOT, 'src', dir), { recursive: true })
    .filter((f) => String(f).endsWith('.ts'))
    .map((f) => ({ name: `${dir}/${f}`, text: readFileSync(join(ROOT, 'src', dir, String(f)), 'utf8') }));
}

describe('report and adapter purity', () => {
  const files = [...sources('report'), ...sources('adapters')];

  it('finds the report and adapter files', () => {
    assert.ok(files.some((f) => f.name.startsWith('report/')));
    assert.ok(files.some((f) => f.name.startsWith('adapters/')));
  });

  it('mentions no Node, file system, Obsidian or DOM APIs', () => {
    for (const { name, text } of files) {
      for (const re of [/node:/i, /\bfs\b/i, /obsidian/i, /\bdocument\b/i, /\bwindow\b/i]) assert.doesNotMatch(text, re, `${name} matches ${re}`);
    }
  });

  it('imports only the core, the adapters and the reports', () => {
    for (const { name, text } of files) {
      for (const m of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1]!;
        assert.match(spec, /^\.{1,2}\//, `${name} imports a package: ${spec}`);
        assert.doesNotMatch(spec, /\/cli\//, `${name} imports the CLI: ${spec}`);
      }
      assert.doesNotMatch(text, /\bimport\s*\(|\brequire\s*\(/, `${name} loads modules dynamically`);
    }
  });

  it('never reads the clock, randomness, the process or globals', () => {
    for (const { name, text } of files) {
      for (const re of [/Date\.now/, /new Date\(\s*\)/, /Math\.random/, /\bprocess\b/, /globalThis/, /\bfetch\s*\(/]) assert.doesNotMatch(text, re, `${name} matches ${re}`);
    }
  });
});

describe('readinessInputs', () => {
  const { data } = readVault(fsIo, VAULT, { asOf: DATE });

  it('reproduces the score’s z for every signal', () => {
    const inputs = readinessInputs(data.checkins.daily, DATE);
    const z = readinessOn(data.checkins.daily, DATE).value.z as Record<string, number>;
    assert.equal(inputs.length, 5);
    for (const x of inputs) {
      assert.ok(x.days >= 14, `${x.signal} has a baseline`);
      assert.ok(Math.abs((x.z ?? NaN) - z[x.signal]!) < 1e-12, `${x.signal}: ${x.z} vs ${z[x.signal]}`);
    }
    const rhr = inputs.find((x) => x.signal === 'rhr')!;
    assert.equal(rhr.value, 68);
    assert.equal(rhr.better, 'lower');
  });

  it('is empty on a day without a morning check-in', () => {
    assert.deepEqual(readinessInputs(data.checkins.daily, '2026-04-12'), []);
  });
});

describe('readVaultAsync', () => {
  it('gives the same data as readVault', async () => {
    const a = readVault(fsIo, VAULT, { asOf: DATE });
    const b = await readVaultAsync(asyncIo, VAULT, { asOf: DATE });
    assert.deepEqual(b, a);
  });

  it('reports missing files the same way', async () => {
    const empty = { readText: async () => null, listDir: async () => null };
    const b = await readVaultAsync(empty, 'v');
    assert.equal(b.files.plan, 'missing');
    assert.ok(b.data.errors.some((e) => e.message.includes(paths().plan)));
  });
});

describe('the CLI and the reports agree', () => {
  const read = readVault(fsIo, VAULT, { asOf: DATE });
  const cli = (cmd: string[]) => JSON.parse(run([...cmd, '--vault', VAULT, '--date', DATE], { ...fsIo, today: () => DATE, isDir: (p) => fsIo.listDir(p) !== null }).stdout);

  it('review is buildReview', () => {
    const out = cli(['review']);
    const { command, engine, schema, ok, sources, warnings, errors, ...rest } = out;
    assert.equal(command, 'review');
    assert.deepEqual(rest, JSON.parse(JSON.stringify(buildReview(read.data, DATE))));
  });

  it('session is buildSession, in every mode', () => {
    for (const mode of ['full', 'express', 'hotel'] as const) {
      const out = cli(['session', '--mode', mode]);
      const { command, engine, schema, ok, sources, warnings, errors, ...rest } = out;
      assert.deepEqual(rest, JSON.parse(JSON.stringify(buildSession(read.data, DATE, mode))), mode);
    }
  });
});

describe('buildToday', () => {
  const read = readVault(fsIo, VAULT, { asOf: DATE });
  const t = buildToday(read, DATE, 'full', VAULT);

  it('holds the review, the session, the inputs and the week', () => {
    assert.equal(t.command, 'today');
    assert.equal(t.ok, true);
    assert.equal(t.review!.week.planWeek, 6);
    assert.equal(t.session!.session!.type, 'B');
    assert.equal(t.inputs.length, 5);
    assert.deepEqual(t.phase, { index: 1, name: 'Phase 1' });
  });

  it('marks the week’s days', () => {
    const states = t.week.map((d) => `${d.date.slice(8)}:${d.state}`);
    assert.deepEqual(states, ['06:trained', '07:trained', '08:trained', '09:unlogged', '10:trained', '11:future', '12:future']);
    assert.ok(t.week[4]!.today);
    assert.equal(t.week[4]!.sessions[0]!.label, 'Easy run');
  });

  it('notes the missing check-in answers, calmly', () => {
    assert.ok(t.notes.some((n) => n.code === 'no-checkins'));
    assert.ok(!t.notes.some((n) => n.code === 'no-checkin-today'));
  });

  it('notes a day without a morning check-in', () => {
    const later = buildToday(readVault(fsIo, VAULT, { asOf: '2026-04-12' }), '2026-04-12', 'full');
    const n = later.notes.find((x) => x.code === 'no-checkin-today');
    assert.ok(n);
    assert.match(n.text, /Sat 11 Apr/); // a date for people, never ISO
  });

  it('after a fresh start, readiness builds its baseline from the cycle’s mornings: no score, the inputs from the cycle only', () => {
    const r = readVault(fsIo, VAULT, { asOf: DATE });
    // A made-up newer baseline note on 1 April: the cycle holds 10 mornings by the 10th.
    const fresh = { ...r, data: { ...r.data, plan: { ...r.data.plan, baselines: [...(r.data.plan.baselines ?? []), '2026-04-01'] } } };
    const t2 = buildToday(fresh, DATE, 'full');
    const rd = t2.review!.readiness;
    assert.deepEqual([rd.since, rd.baseline.value.mornings, rd.baseline.value.building, rd.latestScored, rd.today.value.band], ['2026-04-01', 10, true, null, 'unscored']);
    assert.ok(rd.actions.every((a) => a.value.action !== 'trim' || !a.value.active));
    assert.ok(t2.inputs.every((x) => x.days <= 9), 'the usual range is the cycle’s previous mornings');
    assert.ok(!t2.notes.some((n) => n.code === 'no-checkin-today'), 'the card says it; no note beside it');
    const s2 = buildSession(fresh.data, DATE, 'full');
    assert.ok(s2.items.every((it) => !it.adjustments.some((a) => a.rule === 'readiness.trim')), 'the session is not trimmed while the baseline builds');
  });

  it('stays calm without a plan', () => {
    const empty = buildToday(readVault({ readText: () => null, listDir: () => null }, 'v'), DATE, 'full');
    assert.equal(empty.review, null);
    assert.equal(empty.session, null);
    assert.ok(empty.notes.some((n) => n.code === 'no-plan'));
  });

  it('weekDays reads marks and ticks', () => {
    const data = { ...read.data, checkins: { ...read.data.checkins, daily: [...read.data.checkins.daily, { date: '2026-04-09', mark: 'missed' as const }] } };
    const days = weekDays(data, t.review!, DATE);
    assert.equal(days[3]!.state, 'missed');
  });
});
