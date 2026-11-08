// The Progress report on the synthetic vault: the five cards' data, the
// calendar's rule for days with nothing logged, ticked or marked, no goal
// date without a goal weight, and each muscle's direct and half-credit sets
// and its regions in every view.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { readinessSeries } from '../src/core/readiness.ts';
import { buildProgress, buildReview, CALENDAR_WEEKS, dayStateOf, volumeStatus } from '../src/report/index.ts';
import { fixtureFiles, memoryIo, ROOT } from './helpers.ts';

const VAULT = join(ROOT, 'test', 'fixtures', 'vault');
const fsIo = {
  readText: (p: string) => (existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null),
  listDir: (p: string) => (existsSync(p) && statSync(p).isDirectory() ? readdirSync(p) : null),
};
const DATE = '2026-04-10';
const read = readVault(fsIo, VAULT, { asOf: DATE });
const p = buildProgress(read, DATE, VAULT);
const review = buildReview(read.data, DATE);

describe('buildProgress', () => {
  it('builds every card without errors', () => {
    assert.equal(p.command, 'progress');
    assert.equal(p.ok, true);
    assert.ok(p.volume && p.readiness && p.calendar && p.weight);
    assert.deepEqual(p.notes, []);
  });

  it('gives sets per muscle for this week, 4 weeks and the plan, with band statuses', () => {
    const v = p.volume!;
    assert.deepEqual(Object.keys(v.views), ['week', 'four', 'plan']);
    const plan = v.views.plan.muscles;
    assert.equal(plan.length, read.data.plan.muscles.length);
    for (const m of plan) assert.equal(m.sets, Math.round((review.volume.planned.value.perWeek[m.muscle] ?? 0) * 100) / 100, m.muscle);
    assert.equal(v.views.week.muscles.find((m) => m.muscle === 'biceps')!.status, 'below');
    assert.equal(v.views.plan.muscles.find((m) => m.muscle === 'glutes')!.priority, true);
    assert.ok(v.topExercises['glutes']!.length > 0);
    assert.equal(v.labels['lats']!.slug, 'upper-back');
  });

  it('maps the band statuses', () => {
    assert.deepEqual(['below-minimum', 'priority-low', 'ok', 'priority-high', 'at-cap'].map(volumeStatus), ['below', 'below', 'in', 'above', 'over']);
  });

  it('reads a priority muscle over 16 but under the cap as above its band', () => {
    const glutes = p.volume!.views.plan.muscles.find((m) => m.muscle === 'glutes')!;
    assert.ok(glutes.sets > 16 && glutes.sets <= 20, String(glutes.sets));
    assert.equal(glutes.status, 'above');
    assert.match(glutes.note ?? '', /above the priority tier/);
  });

  it('gives 28 days of readiness from the engine’s series', () => {
    const r = p.readiness!;
    const series = readinessSeries(read.data.checkins.daily, DATE).filter((d) => d.date >= r.from && d.r !== null);
    assert.equal(r.points.length, series.length);
    assert.equal(r.points.at(-1)!.band, 'watch');
    assert.deepEqual(r.bands, { good: 0.5, normal: -0.5, watch: -1 });
  });

  it('lays out 26 weeks of days, Monday to Sunday', () => {
    const c = p.calendar!;
    assert.equal(c.days.length, CALENDAR_WEEKS * 7);
    assert.equal(c.weeks.length, CALENDAR_WEEKS);
    assert.equal(c.to, '2026-04-12');
    assert.equal(c.firstEntry, '2026-03-02');
    const at = (d: string) => c.days.find((x) => x.date === d)!;
    assert.equal(at('2026-04-09').state, 'unlogged');
    assert.equal(at('2026-04-10').state, 'trained');
    assert.equal(at('2026-04-11').state, 'future');
    assert.ok(at('2026-01-05').beforeData);
  });

  it('never calls a day with nothing logged, ticked or marked rest or missed', () => {
    const c = p.calendar!;
    const quiet = c.days.filter((d) => d.date >= '2026-03-02' && d.date <= DATE && d.sessions.length === 0 && d.state !== 'unlogged');
    assert.ok(quiet.length > 0);
    for (const d of quiet) assert.equal(d.state, 'none', d.date);
    assert.equal(dayStateOf('2026-04-01', DATE, 0, undefined), 'none');
    assert.equal(dayStateOf('2026-04-01', DATE, 0, { mark: 'rest' }), 'rest');
    assert.equal(dayStateOf('2026-04-01', DATE, 0, { trained: true }), 'unlogged');
  });

  it('gives each logged lift its e1RM points in its own unit, with the trend’s noise band and verdict', () => {
    const rdl = p.lifts.find((l) => l.exercise === 'romanian-deadlift')!;
    assert.equal(rdl.unit, 'kg');
    const converted = rdl.sets.find((s) => s.logged.unit === 'lb')!;
    assert.equal(converted.unit, 'kg');
    assert.equal(converted.weight, 70);
    assert.equal(converted.logged.weight, 154);
    assert.equal(rdl.verdict, 'up');
    assert.ok(rdl.noise && Math.abs(rdl.noise.hi / rdl.latest! - 1.04) < 1e-3);
    const bench = p.lifts.find((l) => l.exercise === 'flat-db-bench-press')!;
    assert.equal(bench.verdict, 'stalled');
    assert.ok(bench.sets.some((s) => s.pr));
    assert.deepEqual(bench.deloadWeeks, [{ from: '2026-03-23', to: '2026-03-29' }]);
  });

  it('keeps the sets before a unit flag, out of the trend', () => {
    const row = p.lifts.find((l) => l.exercise === 'seated-cable-row')!;
    assert.equal(row.verdict, 'units');
    assert.ok(row.unitFlag);
    assert.equal(row.sets.filter((s) => !s.used).length, review.lifts.find((l) => l.exercise === 'seated-cable-row')!.e1rm.value.ignored);
    assert.ok(row.sets.every((s) => s.used || s.best === null));
  });

  it('gives the weight trend, rate and goal band, and no goal date without a goal weight', () => {
    const w = p.weight!;
    assert.equal(w.points.length, 44);
    assert.equal(w.band!.unit, 'pct');
    assert.equal(w.band!.status, 'in');
    assert.ok(w.wedge && w.wedge.hiPerWeek === 0 && w.wedge.loPerWeek < 0);
    assert.ok(w.projection && w.projection.to === '2026-05-01');
    assert.equal(w.goal.weight, null);
    assert.equal(w.goal.date, null);
  });

  it('stays calm without a plan', () => {
    const empty = buildProgress(readVault({ readText: () => null, listDir: () => null }, 'v'), DATE);
    assert.equal(empty.volume, null);
    assert.deepEqual(empty.lifts, []);
    assert.ok(empty.notes.some((n) => n.code === 'no-plan'));
  });
});

describe('buildProgress: the direct and half-credit split, and the regions', () => {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  /** The fixture with a region declared weak (made up): the vasti. */
  /** The fixture with regions declared weak; with a machine too unless `machines` is false (the leg extension is the rectus femoris's only option). */
  const declared = (regions: string[], machines = true) => {
    const files = fixtureFiles('v');
    const at = 'v/3-Personal/Fitness/Coach/profile.json';
    const profile = JSON.parse(files[at]!);
    files[at] = JSON.stringify({ ...profile, priorityRegions: regions, equipment: machines ? [...profile.equipment, 'machines'] : profile.equipment });
    return buildProgress(readVault(memoryIo(files, DATE), 'v', { asOf: DATE }), DATE).volume!;
  };

  it('gives every view each muscle\'s direct and half-credit sets, adding up to its total', () => {
    for (const k of ['week', 'four', 'plan'] as const) {
      for (const m of p.volume!.views[k].muscles) {
        assert.ok(m.direct !== undefined && m.indirect !== undefined, `${k} ${m.muscle}`);
        assert.ok(Math.abs(m.direct + m.indirect - m.sets) < 0.02, `${k} ${m.muscle}: ${m.direct} + ${m.indirect} vs ${m.sets}`);
      }
    }
    // This week's split is the week's own tally; the plan's is the planned split, with its effort.
    const week = p.volume!.views.week.muscles.find((m) => m.muscle === 'shoulders')!;
    assert.deepEqual([week.direct, week.indirect], [r2(review.volume.done.value.split['shoulders']!.direct), r2(review.volume.done.value.split['shoulders']!.indirect)]);
    assert.ok(week.indirect! > 0);
    assert.equal(week.hardDirect, undefined, 'a done view is not split by effort');
    assert.notEqual(p.volume!.views.plan.muscles.find((m) => m.muscle === 'glutes')!.hardDirect, undefined);
  });

  it('gives each muscle its modelled regions in order, and none to a muscle without', () => {
    const plan = p.volume!.views.plan.muscles;
    const of = (muscle: string) => plan.find((m) => m.muscle === muscle)!.regions;
    assert.deepEqual(of('shoulders').map((r) => r.id), ['shoulders-front', 'shoulders-side', 'shoulders-rear']);
    assert.deepEqual(of('biceps'), []);
    assert.equal(of('shoulders')[2]!.grade, 'heuristic');
    assert.ok(of('upper-back').every((r) => r.roughGuide));
    // The plan's regions are the review's own rows, what `check` reports.
    for (const r of review.volume.regions) {
      const row = of(r.value.muscle).find((x) => x.id === r.value.id)!;
      assert.deepEqual([row.sets, row.direct, row.indirect, row.status], [r.value.sets, r.value.direct, r.value.indirect, r.value.status], r.value.id);
    }
    // No priority muscle has a region here and none is declared: every region is reported only.
    assert.ok(plan.flatMap((m) => m.regions).every((r) => r.rule === null && r.status === 'reported'));
    const week = p.volume!.views.week.muscles.find((m) => m.muscle === 'quads')!.regions.find((r) => r.id === 'quads-vasti')!;
    assert.equal(week.sets, r2(review.volume.done.value.regions!['quads-vasti']!.direct));
  });

  it('holds a declared region to 6 and its muscle\'s coverage regions to 4, in every view', () => {
    const v = declared(['quads-vasti']);
    for (const k of ['week', 'four', 'plan'] as const) {
      const quads = v.views[k].muscles.find((m) => m.muscle === 'quads')!.regions;
      const [rf, vasti] = quads;
      assert.equal(vasti!.declared, true, k);
      assert.equal(vasti!.rule, 'declared');
      assert.equal(vasti!.min, 6);
      assert.equal(vasti!.status, 'ok', `${k}: ${vasti!.counted}`);
      // The declared region makes the quads a priority for the region rules: the rectus femoris, with no leg extension, falls short.
      assert.deepEqual([rf!.rule, rf!.min, rf!.counted, rf!.status], ['coverage', 4, 0, 'short'], k);
      assert.match(rf!.note ?? '', /under the 4 direct sets/);
      // The hamstrings are not a priority: reported only.
      assert.ok(v.views[k].muscles.find((m) => m.muscle === 'hamstrings')!.regions.every((r) => r.rule === null));
    }
    // The fixture's logged sets give no RIR and its items none either: of unknown effort, counted as the rule counts them.
    const week = v.views.week.muscles.find((m) => m.muscle === 'quads')!.regions[1]!;
    assert.equal(week.counted, week.direct);
    assert.match(week.note ?? '', /of unknown effort, counted/);
  });

  it('a declared region with no work in the plan is short of its 6', () => {
    const side = declared(['shoulders-side']).views.plan.muscles.find((m) => m.muscle === 'shoulders')!.regions.find((r) => r.id === 'shoulders-side')!;
    assert.deepEqual([side.declared, side.counted, side.min, side.status], [true, 0, 6, 'short']);
  });
});
