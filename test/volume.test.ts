import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Exercise } from '../src/core/schema.ts';
import { checkVolume, plannedSetsPerMuscle, setsPerMuscle, volumeTier } from '../src/core/volume.ts';
import { session, set, slot } from './helpers.ts';

const EX: Record<string, Exercise> = {
  squat: { name: 'Squat', unit: 'kg', increment: 2.5, muscles: { main: ['quads', 'glutes'], helps: ['hamstrings'] } },
  bench: { name: 'Bench', unit: 'kg', increment: 2.5, muscles: { main: ['chest'], helps: ['triceps', 'shoulders'] } },
  plank: { name: 'Plank', kind: 'timed' },
  mystery: { name: 'Untagged lift', unit: 'kg', increment: 2.5 },
};

describe('volume tiers', () => {
  it('uses the snippet tier edges', () => {
    const cases: [number, string][] = [[0, 'below-minimum'], [3.5, 'below-minimum'], [4, 'efficient'], [10, 'efficient'], [10.5, 'priority'], [16, 'priority'], [16.5, 'high'], [20, 'high'], [20.5, 'cap']];
    for (const [v, t] of cases) assert.equal(volumeTier(v), t, String(v));
  });
});

describe('setsPerMuscle', () => {
  it('returns nothing for an empty log', () => {
    const r = setsPerMuscle([], EX, '2026-03-23', '2026-03-29');
    assert.deepEqual(r.value.perWeek, {});
    assert.equal(r.value.sessions, 0);
    assert.equal(r.value.estimated, false);
  });

  it('counts logged sets at Full tracking: direct 1, indirect 0.5', () => {
    const s = session('2026-03-24', { level: 'full', logged: { squat: [set(60, 5), set(60, 5), set(60, 5)], bench: [set(40, 8), set(40, 8)] } });
    const r = setsPerMuscle([s], EX, '2026-03-23', '2026-03-29');
    assert.deepEqual(r.value.total, { quads: 3, glutes: 3, hamstrings: 1.5, chest: 2, triceps: 1, shoulders: 1 });
    assert.equal(r.value.estimated, false);
    assert.equal(r.reason.rule, 'volume.weekly');
  });

  it('estimates Standard sessions from the plan snapshot minus skipped items', () => {
    const s = session('2026-03-24', { logged: { squat: [set(60, 5)] }, slots: [slot('squat', 3, 5, 8), slot('bench', 3, 5, 8)], skipped: ['bench'] });
    const r = setsPerMuscle([s], EX, '2026-03-23', '2026-03-29');
    assert.deepEqual(r.value.total, { quads: 3, glutes: 3, hamstrings: 1.5 });
    assert.equal(r.value.estimated, true);
    assert.match(r.reason.note ?? '', /Estimated/);
  });

  it('leaves out sessions outside the range (inclusive ends)', () => {
    const a = session('2026-03-22', { level: 'full', logged: { bench: [set(40, 8)] } });
    const b = session('2026-03-23', { level: 'full', logged: { bench: [set(40, 8)] } });
    const c = session('2026-03-29', { level: 'full', logged: { bench: [set(40, 8)] } });
    const d = session('2026-03-30', { level: 'full', logged: { bench: [set(40, 8)] } });
    assert.equal(setsPerMuscle([a, b, c, d], EX, '2026-03-23', '2026-03-29').value.total['chest'], 2);
  });

  it('averages a longer range per week', () => {
    const s = [session('2026-03-17', { level: 'full', logged: { bench: [set(40, 8), set(40, 8)] } }), session('2026-03-24', { level: 'full', logged: { bench: [set(40, 8), set(40, 8)] } })];
    const r = setsPerMuscle(s, EX, '2026-03-16', '2026-03-29');
    assert.equal(r.value.weeks, 2);
    assert.equal(r.value.total['chest'], 4);
    assert.equal(r.value.perWeek['chest'], 2);
  });

  it('skips timed items quietly and reports untagged lifts', () => {
    const s = session('2026-03-24', { level: 'full', logged: { plank: [set(0, 1)], mystery: [set(50, 5)], unknown: [set(10, 5)] } });
    const r = setsPerMuscle([s], EX, '2026-03-23', '2026-03-29');
    assert.deepEqual(r.value.total, {});
    assert.deepEqual(r.value.notCounted, ['mystery', 'unknown']);
  });

  it('cannot count a session with neither logged sets nor a snapshot', () => {
    const r = setsPerMuscle([session('2026-03-24', { level: 'light' })], EX, '2026-03-23', '2026-03-29');
    assert.equal(r.value.sessions, 0);
    assert.match(r.reason.note ?? '', /neither logged sets nor a plan snapshot/);
  });

  it('refuses an empty range', () => {
    assert.throws(() => setsPerMuscle([], EX, '2026-03-29', '2026-03-23'), RangeError);
  });
});

describe('plannedSetsPerMuscle', () => {
  it('sums a week of templates and flags more than 8 direct sets in one session', () => {
    const t1 = { id: 'a', name: 'A', kind: 'lift' as const, slots: [slot('squat', 5, 5, 8), slot('squat', 4, 8, 12)] };
    const t2 = { id: 'b', name: 'B', kind: 'lift' as const, slots: [slot('bench', 3, 5, 8)] };
    const r = plannedSetsPerMuscle([t1, t2], EX);
    assert.deepEqual(r.value.perWeek, { quads: 9, glutes: 9, hamstrings: 4.5, chest: 3, triceps: 1.5, shoulders: 1.5 });
    assert.deepEqual(r.value.overSession, [{ template: 'a', muscle: 'quads', sets: 9 }, { template: 'a', muscle: 'glutes', sets: 9 }]);
  });
});

describe('checkVolume', () => {
  it('reports each muscle against the bands, zeros included', () => {
    const r = checkVolume({ chest: 8, quads: 22, lats: 12 }, { muscles: ['chest', 'quads', 'lats', 'calves'], priority: ['chest'] });
    assert.deepEqual(r.map((x) => [x.value.muscle, x.value.tier, x.value.status]), [
      ['chest', 'efficient', 'priority-low'],
      ['quads', 'cap', 'at-cap'],
      ['lats', 'priority', 'ok'],
      ['calves', 'below-minimum', 'below-minimum'],
    ]);
    assert.equal(r[0]!.reason.rule, 'volume.bands');
    assert.deepEqual((r[0]!.reason.threshold as { minimum: number }).minimum, 4);
  });
});

describe('the priority band', () => {
  it('reads a priority muscle over 16 but at or under the cap as above its band', () => {
    const r = checkVolume({ glutes: 17.25, quads: 17.25, hamstrings: 20, lats: 21 }, { priority: ['glutes', 'hamstrings', 'lats'] });
    const st = Object.fromEntries(r.map((x) => [x.value.muscle, x.value.status]));
    assert.deepEqual(st, { glutes: 'priority-high', quads: 'ok', hamstrings: 'priority-high', lats: 'at-cap' });
    assert.match(r[0]!.reason.note ?? '', /above the priority tier \(10-16\)/);
  });
  it('keeps 16 itself inside the band', () => {
    assert.equal(checkVolume({ glutes: 16 }, { priority: ['glutes'] })[0]!.value.status, 'ok');
  });
});
