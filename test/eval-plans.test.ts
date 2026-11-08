// tools/eval-plans.mjs: the harness that scores coach-written draft plans
// for the made-up athletes (test/fixtures/athletes/), run with the built
// engine on its sample drafts (tools/eval-samples/): a clean one and one with
// a hard error; and on a copy of the beginner with priority muscles and a
// declared region, and a draft the review cannot read.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { builtEngine, ROOT } from './helpers.ts';

type Json = Record<string, any>;
const HARNESS = join(ROOT, 'tools', 'eval-plans.mjs');
const SAMPLES = join(ROOT, 'tools', 'eval-samples');
const scratch = mkdtempSync(join(tmpdir(), 'pahlavan-eval-test-'));
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));

const runHarness = (args: string[]) => spawnSync(process.execPath, [HARNESS, ...args, '--engine', builtEngine()], { encoding: 'utf8' });
const rowsOf = (r: { stdout: string }) => JSON.parse(r.stdout).rows as Json[];

describe('eval-plans: scoring coach-written drafts', () => {
  it('scores the sample drafts for their athlete: errors, warnings by code, overrides, bands, regions, time and pull to push', () => {
    const json = runHarness([SAMPLES, '--json']);
    assert.equal(json.status, 0, json.stderr);
    const rows = rowsOf(json);
    assert.deepEqual(rows.map((r) => r.draft), ['1-beginner-hard-error.json', '1-beginner.json']);
    const row = rows.find((r) => r.draft === '1-beginner.json')!;
    assert.deepEqual([row.athlete, row.date, row.checkExit, row.reviewError], ['1-beginner', '2026-11-04', 0, undefined]);
    assert.deepEqual(row.errors, { count: 0, codes: [] });
    assert.equal(typeof row.warnings, 'object');
    assert.equal(row.warnings['coach-missing'], undefined, 'the scratch vault\'s own notes are left out');
    assert.equal(row.overrides, 0);
    assert.deepEqual(row.time.sessions.map((s: Json) => [s.type, s.limit]), [['A', 45], ['B', 45]]);
    assert.deepEqual(row.time.over, []);
    assert.ok(row.pullPush.pull > row.pullPush.push, 'the Band Y Raise, outside the catalogue, counts as pulling by its guide muscles');
    // The hard error: check exits 1 and the row counts it; the draft is still scored, so the harness exits 0.
    const hard = rows.find((r) => r.draft === '1-beginner-hard-error.json')!;
    assert.deepEqual([hard.checkExit, hard.errors], [1, { count: 1, codes: ['screening-limit'] }]);
    const table = runHarness([SAMPLES]);
    assert.equal(table.status, 0, table.stderr);
    assert.match(table.stdout, /^athlete\s+\| draft\s+\| errors\s+\| warnings by code/);
    assert.match(table.stdout, /\n1-beginner \| 1-beginner\.json\s+\| 0 /);
    assert.match(table.stdout, /\n1-beginner \| 1-beginner-hard-error\.json \| 1 \(screening-limit\) /);
  });

  it('scores priority muscles in band and the region rules met, from the athlete\'s priority muscles and declared region', () => {
    const athletes = join(scratch, 'athletes');
    mkdirSync(athletes, { recursive: true });
    const a = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'athletes', '1-beginner.json'), 'utf8'));
    a.input.profile.priorityMuscles = ['glutes'];
    a.input.profile.priorityRegions = ['shoulders-side'];
    writeFileSync(join(athletes, '1-beginner.json'), JSON.stringify(a));
    const r = runHarness([SAMPLES, '--athletes', athletes, '--json']);
    assert.equal(r.status, 0, r.stderr);
    const row = rowsOf(r).find((x) => x.draft === '1-beginner.json')!;
    // The declared side delts make the shoulders a priority muscle too.
    assert.equal(row.priority.of, 2);
    assert.deepEqual(row.priority.muscles.map((m: string) => m.split(' ')[0]).sort(), ['glutes', 'shoulders']);
    // The side delts are held to 6 near failure, the front delts (a coverage region of the shoulders) to 4.
    assert.equal(row.regions.of, 2);
    assert.equal(row.regions.met + row.regions.short.length, row.regions.of);
    assert.ok(row.warnings['priority-under'] >= 1, JSON.stringify(row.warnings));
    const table = runHarness([SAMPLES, '--athletes', athletes]);
    assert.match(table.stdout, new RegExp(`\\n1-beginner \\| 1-beginner\\.json\\s+\\| 0 .*\\| ${row.priority.inBand}/2\\s+\\| ${row.regions.met}/2 `));
  });

  it('flags a draft the review cannot read instead of scoring it blank', () => {
    const drafts = join(scratch, 'drafts');
    mkdirSync(drafts, { recursive: true });
    writeFileSync(join(drafts, '1-beginner.json'), readFileSync(join(SAMPLES, '1-beginner.json'), 'utf8'));
    writeFileSync(join(drafts, '1-beginner-broken.json'), '{ "sessions": ');
    const r = runHarness([drafts, '--json']);
    assert.equal(r.status, 0, r.stderr);
    const broken = rowsOf(r).find((x) => x.draft === '1-beginner-broken.json')!;
    assert.match(broken.reviewError, /\(exit 1\)$/);
    assert.equal(broken.priority, null);
    assert.ok(broken.errors.count >= 1, 'check names the draft that is not JSON');
    const table = runHarness([drafts]);
    assert.match(table.stdout, /\n1-beginner \| 1-beginner-broken\.json \| \d+ \(json[^)]*\) .*\| review failed: .* is not valid JSON.*\(exit 1\) \| \?\s+\| \?\s+\| \?\n/);
  });
});
