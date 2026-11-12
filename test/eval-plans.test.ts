// tools/eval-plans.mjs: the harness that scores coach-written draft plans
// for the made-up athletes (test/fixtures/athletes/), run with the built
// engine on its sample drafts (tools/eval-samples/): for the beginner, a
// clean one and one with a hard error; for the desk athlete, who has a
// current plan, two redesigns, one copying it and one designed fresh. Also on
// a copy of the beginner with priority muscles and a declared region, a
// draft the review cannot read, and a redesign that misfits the person.

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
const ATHLETES = join(ROOT, 'test', 'fixtures', 'athletes');
const scratch = mkdtempSync(join(tmpdir(), 'pahlavan-eval-test-'));
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));

const runHarness = (args: string[]) => spawnSync(process.execPath, [HARNESS, ...args, '--engine', builtEngine()], { encoding: 'utf8' });
const rowsOf = (r: { stdout: string }) => JSON.parse(r.stdout).rows as Json[];
const athlete = (file: string) => JSON.parse(readFileSync(join(ATHLETES, file), 'utf8')) as Json;
const pct = (v: number) => `${Math.round(v * 100)}%`;
let sampled: { json: ReturnType<typeof runHarness>; table: ReturnType<typeof runHarness> } | null = null;
/** The samples scored once, as JSON and as the table, for the tests that read them as they are. */
const samples = () => (sampled ??= { json: runHarness([SAMPLES, '--json']), table: runHarness([SAMPLES]) });

describe('eval-plans: scoring coach-written drafts', () => {
  it('scores the sample drafts for their athlete: errors, warnings by code, overrides, fit, bands, regions, time and pull to push', () => {
    const { json, table } = samples();
    assert.equal(json.status, 0, json.stderr);
    const rows = rowsOf(json);
    assert.deepEqual(rows.map((r) => r.draft), ['1-beginner-hard-error.json', '1-beginner.json', '2-desk-recomp-copy.json', '2-desk-recomp-fresh.json']);
    const row = rows.find((r) => r.draft === '1-beginner.json')!;
    assert.deepEqual([row.athlete, row.date, row.redesign, row.checkExit, row.reviewError], ['1-beginner', '2026-11-04', false, 0, undefined]);
    assert.deepEqual(row.errors, { count: 0, codes: [] });
    assert.equal(typeof row.warnings, 'object');
    assert.equal(row.warnings['coach-missing'], undefined, 'the scratch vault\'s own notes are left out');
    assert.equal(row.overrides, 0);
    // The beginner has no current plan: the draft is the plan, and nothing is kept from one.
    assert.deepEqual(row.overlap, { current: null, currentInDraft: null, shared: [] });
    // The fit counts are on every row, 0 when the check found none.
    for (const r of rows) assert.deepEqual(Object.keys(r.fit), ['time-over', 'ledger-blocked', 'equipment-missing', 'disliked-movement'], r.draft);
    assert.deepEqual(row.fit, { 'time-over': 0, 'ledger-blocked': 0, 'equipment-missing': 0, 'disliked-movement': 0 });
    assert.deepEqual(row.time.sessions.map((s: Json) => [s.type, s.limit]), [['A', 45], ['B', 45]]);
    assert.deepEqual(row.time.over, []);
    assert.ok(row.pullPush.pull > row.pullPush.push, 'the Band Y Raise, outside the catalogue, counts as pulling by its guide muscles');
    // The hard error: check exits 1 and the row counts it; the draft is still scored, so the harness exits 0.
    const hard = rows.find((r) => r.draft === '1-beginner-hard-error.json')!;
    assert.deepEqual([hard.checkExit, hard.errors], [1, { count: 1, codes: ['screening-limit'] }]);
    assert.equal(table.status, 0, table.stderr);
    assert.match(table.stdout, /^athlete\s+\| draft\s+\| errors\s+\| warnings by code\s+\| overrides \| in current \| fit\s+\| priority in band/);
    assert.match(table.stdout, /\n1-beginner\s+\| 1-beginner\.json\s+\| 0 .*\| 0\s+\| -\s+\| ok\s+\| /);
    assert.match(table.stdout, /\n1-beginner\s+\| 1-beginner-hard-error\.json \| 1 \(screening-limit\) /);
  });

  it('scores a redesign against the athlete\'s current plan: the copy flagged with most of it kept, the fresh design not', () => {
    const { json, table } = samples();
    assert.equal(json.status, 0, json.stderr);
    const rows = rowsOf(json);
    const copy = rows.find((r) => r.draft === '2-desk-recomp-copy.json')!;
    const fresh = rows.find((r) => r.draft === '2-desk-recomp-fresh.json')!;
    for (const r of [copy, fresh]) {
      assert.deepEqual([r.athlete, r.redesign, r.checkExit, r.errors.count], ['2-desk-recomp', true, 0, 0], r.draft);
      assert.equal(r.warnings['exercise-change'], undefined, `${r.draft}: a redesign's changes are not warned about`);
    }
    // The copy renames a few lifts ("Back Squat" for "Barbell back squat"): the same movements, so check warns.
    assert.ok(copy.warnings['similar-to-current'] >= 1, JSON.stringify(copy.warnings));
    assert.ok(copy.overlap.current >= 0.9, String(copy.overlap.current));
    assert.ok(copy.overlap.shared.includes('back-squat'));
    // The fresh design (upper/lower, other lifts) keeps the pull-up ladder and the landmine press, and no warning.
    assert.equal(fresh.warnings['similar-to-current'], undefined, JSON.stringify(fresh.warnings));
    assert.ok(fresh.overlap.current <= 0.2, String(fresh.overlap.current));
    assert.deepEqual([...fresh.overlap.shared].sort(), ['landmine-press', 'pullup']);
    // The review reads the draft, not the current plan's A to D.
    assert.deepEqual(fresh.time.sessions.map((s: Json) => s.type), ['U1', 'L1', 'U2', 'L2', 'S1', 'S2', 'S3']);
    assert.deepEqual(fresh.fit, { 'time-over': 0, 'ledger-blocked': 0, 'equipment-missing': 0, 'disliked-movement': 0 });
    assert.match(table.stdout, new RegExp(`\\n2-desk-recomp \\| 2-desk-recomp-copy\\.json\\s+\\| 0\\s+\\| similar-to-current \\d+\\s+\\| 0\\s+\\| ${pct(copy.overlap.current)}\\s+\\| ok `));
    assert.match(table.stdout, new RegExp(`\\n2-desk-recomp \\| 2-desk-recomp-fresh\\.json\\s+\\| 0\\s+\\| none\\s+\\| 0\\s+\\| ${pct(fresh.overlap.current)}\\s+\\| ok `));
  });

  it('counts the fit findings: a session over time, a movement the Ledger blocks, one the equipment lacks, one disliked', () => {
    const athletes = join(scratch, 'fit-athletes');
    const drafts = join(scratch, 'fit-drafts');
    mkdirSync(athletes, { recursive: true });
    mkdirSync(drafts, { recursive: true });
    const a = athlete('2-desk-recomp.json');
    a.input.profile.preferences.dislikes = ['leg-extension'];
    a.input.profile.equipment = a.input.profile.equipment.filter((e: string) => e !== 'cable');
    a.input.options = { ledger: [{ id: 'left-knee', area: 'knee', noMovements: ['step-up'], note: 'Left knee: no step-ups for now' }] };
    writeFileSync(join(athletes, '2-desk-recomp.json'), JSON.stringify(a));
    const d = JSON.parse(readFileSync(join(SAMPLES, '2-desk-recomp-fresh.json'), 'utf8'));
    d.sessions.S1[0].sr = '40 min';
    writeFileSync(join(drafts, '2-desk-recomp-misfit.json'), JSON.stringify(d));
    const r = runHarness([drafts, '--athletes', athletes, '--json']);
    assert.equal(r.status, 0, r.stderr);
    const row = rowsOf(r)[0]!;
    // S1 runs 40 minutes of 30, L2's step-up is ruled out, U2's cable fly needs a cable, L2's leg extension is disliked.
    assert.deepEqual(row.fit, { 'time-over': 1, 'ledger-blocked': 1, 'equipment-missing': 1, 'disliked-movement': 1 });
    assert.deepEqual([row.checkExit, row.errors], [1, { count: 1, codes: ['ledger-blocked'] }]);
    const table = runHarness([drafts, '--athletes', athletes]);
    assert.match(table.stdout, /\| time-over 1, ledger-blocked 1, equipment-missing 1, disliked-movement 1 \|/);
  });

  it('scores how diverse the drafts are: low shares across athletes, each athlete\'s candidates pair by pair', () => {
    const { json, table } = samples();
    // Pairs over the limit are a score, not a failure.
    assert.equal(json.status, 0, json.stderr);
    const d = JSON.parse(json.stdout).diversity as Json;
    assert.equal(d.limit, 0.5);
    // Different people, different plans: two beginner drafts against two desk drafts, both ways.
    const across = d.acrossAthletes;
    assert.equal(across.pairs.length, 4);
    assert.ok(across.pairs.every((p: Json) => p.athletes[0] !== p.athletes[1]));
    assert.equal(typeof across.mean, 'number');
    assert.ok(across.mean <= across.max && across.max <= 0.5, `${across.mean} ${across.max}`);
    assert.deepEqual(across.over, []);
    assert.deepEqual(d.withinAthlete.map((w: Json) => w.athlete), ['1-beginner', '2-desk-recomp']);
    // The desk athlete's two candidates share little: the copy is the old plan, the fresh one is not.
    const desk = d.withinAthlete.find((w: Json) => w.athlete === '2-desk-recomp');
    assert.deepEqual(desk.pairs.map((p: Json) => [p.a, p.b]), [['2-desk-recomp-copy.json', '2-desk-recomp-fresh.json']]);
    assert.ok(desk.pairs[0].aInB < 0.5 && desk.pairs[0].bInA < 0.5, JSON.stringify(desk.pairs[0]));
    assert.deepEqual(desk.over, []);
    // The beginner's two samples differ in one RIR: the same movements, over the limit both ways, each named.
    const beginner = d.withinAthlete.find((w: Json) => w.athlete === '1-beginner');
    assert.deepEqual(beginner.over, [
      { a: '1-beginner-hard-error.json', b: '1-beginner.json', share: 1 },
      { a: '1-beginner.json', b: '1-beginner-hard-error.json', share: 1 },
    ]);
    assert.deepEqual(d.skipped, []);
    assert.match(table.stdout, new RegExp(`\\n\\ndiversity: .*\\(over 50% is over the limit\\)\\n  across athletes: 4 pairs, mean ${pct(across.mean)}, max ${pct(across.max)} \\(`));
    assert.match(table.stdout, new RegExp(`\\n  within 2-desk-recomp:\\n    2-desk-recomp-copy\\.json and 2-desk-recomp-fresh\\.json: ${pct(desk.pairs[0].aInB)} / ${pct(desk.pairs[0].bInA)}\\n`));
    assert.match(table.stdout, /\n  within 1-beginner:\n    1-beginner-hard-error\.json and 1-beginner\.json: 100% \/ 100%\n    over the limit: 1-beginner-hard-error\.json in 1-beginner\.json 100%, 1-beginner\.json in 1-beginner-hard-error\.json 100%\n/);
  });

  it('scores priority muscles in band and the region rules met, from the athlete\'s priority muscles and declared region', () => {
    const athletes = join(scratch, 'athletes');
    mkdirSync(athletes, { recursive: true });
    const a = athlete('1-beginner.json');
    a.input.profile.priorityMuscles = ['glutes'];
    a.input.profile.priorityRegions = ['shoulders-side'];
    writeFileSync(join(athletes, '1-beginner.json'), JSON.stringify(a));
    // The beginner's samples only: this folder of athletes has no one else.
    const drafts = join(scratch, 'beginner-drafts');
    mkdirSync(drafts, { recursive: true });
    for (const f of ['1-beginner.json', '1-beginner-hard-error.json']) writeFileSync(join(drafts, f), readFileSync(join(SAMPLES, f), 'utf8'));
    const r = runHarness([drafts, '--athletes', athletes, '--json']);
    assert.equal(r.status, 0, r.stderr);
    const row = rowsOf(r).find((x) => x.draft === '1-beginner.json')!;
    // The declared side delts make the shoulders a priority muscle too.
    assert.equal(row.priority.of, 2);
    assert.deepEqual(row.priority.muscles.map((m: string) => m.split(' ')[0]).sort(), ['glutes', 'shoulders']);
    // The side delts are held to 6 near failure, the front delts (a coverage region of the shoulders) to 4.
    assert.equal(row.regions.of, 2);
    assert.equal(row.regions.met + row.regions.short.length, row.regions.of);
    assert.ok(row.warnings['priority-under'] >= 1, JSON.stringify(row.warnings));
    const table = runHarness([drafts, '--athletes', athletes]);
    assert.match(table.stdout, new RegExp(`\\n1-beginner\\s+\\| 1-beginner\\.json\\s+\\| 0 .*\\| ${row.priority.inBand}/2\\s+\\| ${row.regions.met}/2 `));
  });

  it('flags a draft the review cannot read instead of scoring it blank, and leaves it out of the diversity', () => {
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
    const d = JSON.parse(r.stdout).diversity as Json;
    assert.deepEqual([d.skipped, d.withinAthlete, d.acrossAthletes.pairs], [['1-beginner-broken.json'], [], []]);
    const table = runHarness([drafts]);
    assert.match(table.stdout, /\n1-beginner \| 1-beginner-broken\.json \| \d+ \(json[^)]*\) .*\| review failed: .* is not valid JSON.*\(exit 1\) \| \?\s+\| \?\s+\| \?\n/);
    assert.match(table.stdout, /\n  left out \(not a readable plan\): 1-beginner-broken\.json\n/);
  });
});
