// The Progress report on the synthetic vault: the five cards' data, the
// calendar's rule for days with nothing logged, ticked or marked, and no
// goal date without a goal weight.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { readinessSeries } from '../src/core/readiness.ts';
import { buildProgress, buildReview, CALENDAR_WEEKS, dayStateOf, volumeStatus } from '../src/report/index.ts';
import { ROOT } from './helpers.ts';

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
