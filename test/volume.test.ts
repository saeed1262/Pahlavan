import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { REGION_IDS } from '../src/core/data/regions.ts';
import type { Exercise, ExerciseSlot } from '../src/core/schema.ts';
import { checkRegions, checkVolume, declaredRegions, plannedSetsPerMuscle, REGION_RULES, regionCredit, regionPriority, setEffort, setsPerMuscle, VOLUME, volumeTier, type PlannedSplit } from '../src/core/volume.ts';
import { fixtureFiles, memoryIo, session, set, slot } from './helpers.ts';

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

describe('muscle regions: the region tally', () => {
  // Region credit: 1 a set when the region's muscle is main, 0.5 when it helps, nothing otherwise.
  const RX: Record<string, Exercise> = {
    ...EX,
    // quads-vasti from a main muscle; hamstrings-hip from a helping one; an unknown id and a duplicate counted never and once.
    squat: { ...EX['squat']!, muscles: { main: ['quads', 'glutes'], helps: ['hamstrings'], regions: ['quads-vasti', 'hamstrings-hip', 'quads-vmo', 'quads-vasti'] } },
    legExt: { name: 'Leg extension', unit: 'kg', increment: 5, muscles: { main: ['quads'], helps: [], regions: ['quads-rf', 'quads-vasti'] } },
    // chest-upper from the main chest, shoulders-front at half credit, calves-soleus from a muscle the bench does not train: none.
    bench: { ...EX['bench']!, muscles: { main: ['chest'], helps: ['triceps', 'shoulders'], regions: ['chest-upper', 'shoulders-front', 'calves-soleus'] } },
  };
  const strip = (ex: Record<string, Exercise>) => Object.fromEntries(Object.entries(ex).map(([k, v]) => [k, v.muscles ? { ...v, muscles: { main: v.muscles.main, helps: v.muscles.helps } } : v]));

  it('regionCredit: 1 a set for a main parent, 0.5 for a helping one, none for an unknown id or an untrained parent', () => {
    assert.deepEqual(regionCredit(RX['squat']!.muscles), [['quads-vasti', 1], ['hamstrings-hip', 0.5]]);
    assert.deepEqual(regionCredit(RX['bench']!.muscles), [['chest-upper', 1], ['shoulders-front', 0.5]]);
    assert.deepEqual(regionCredit({ main: ['quads'], helps: [] }), []);
    assert.deepEqual(regionCredit(undefined), []);
  });

  it('setsPerMuscle tallies each region by the credit, per week, beside unchanged muscle totals', () => {
    const s = [session('2026-03-17', { level: 'full', logged: { squat: [set(60, 5), set(60, 5)], legExt: [set(30, 12)] } }), session('2026-03-24', { level: 'full', logged: { bench: [set(40, 8), set(40, 8)] } })];
    const r = setsPerMuscle(s, RX, '2026-03-16', '2026-03-29').value;
    assert.deepEqual(r.regions, {
      'quads-vasti': { direct: 1.5, indirect: 0 },
      'hamstrings-hip': { direct: 0, indirect: 0.5 },
      'quads-rf': { direct: 0.5, indirect: 0 },
      'chest-upper': { direct: 1, indirect: 0 },
      'shoulders-front': { direct: 0, indirect: 0.5 },
    });
    const { regions: _r, ...muscles } = r;
    assert.equal(JSON.stringify(muscles), JSON.stringify(setsPerMuscle(s, strip(RX), '2026-03-16', '2026-03-29').value), 'the muscles\' tally byte for byte');
  });

  it('a tally with no region credit keeps its old shape (no regions key)', () => {
    const s = session('2026-03-24', { level: 'full', logged: { squat: [set(60, 5)] } });
    assert.equal('regions' in setsPerMuscle([s], EX, '2026-03-23', '2026-03-29').value, false);
    assert.equal('regions' in plannedSetsPerMuscle([{ id: 'a', name: 'A', kind: 'lift', slots: [slot('bench', 3, 5, 8)] }], EX).value, false);
  });

  it('plannedSetsPerMuscle weighs region sets as the muscles\' and splits the direct ones by effort', () => {
    const t1 = { id: 'a', name: 'A', kind: 'lift' as const, slots: [slot('squat', 4, 5, 8, 2), slot('legExt', 3, 10, 15, 5)] };
    const t2 = { id: 'b', name: 'B', kind: 'lift' as const, slots: [slot('bench', 3, 5, 8)] };
    const effort = (x: ExerciseSlot) => setEffort({ exercise: x.exercise, rir: x.exercise === 'bench' ? null : x.rir }, { holds: {}, ladders: [] });
    const r = plannedSetsPerMuscle([t1, t2], RX, { weights: { a: 1.5, b: 1 }, effort }).value;
    assert.deepEqual(r.regions, {
      // The squat at RIR 2 is near failure, the leg extension at RIR 5 is not.
      'quads-vasti': { direct: 10.5, indirect: 0, hardDirect: 6, unknown: 0 },
      'hamstrings-hip': { direct: 0, indirect: 3, hardDirect: 0, unknown: 0 },
      'quads-rf': { direct: 4.5, indirect: 0, hardDirect: 0, unknown: 0 },
      // The bench gives no RIR: unknown effort, counted as near failure by the rules.
      'chest-upper': { direct: 3, indirect: 0, hardDirect: 0, unknown: 3 },
      'shoulders-front': { direct: 0, indirect: 1.5, hardDirect: 0, unknown: 0 },
    });
    const { regions: _r, ...muscles } = r;
    const plain = plannedSetsPerMuscle([t1, t2], strip(RX), { weights: { a: 1.5, b: 1 }, effort }).value;
    assert.equal(JSON.stringify(muscles), JSON.stringify(plain), 'the muscles\' tally byte for byte');
    assert.deepEqual(r.perWeek, { quads: 10.5, glutes: 6, hamstrings: 3, chest: 3, triceps: 1.5, shoulders: 1.5 });
  });

  it('the fixture vault\'s muscle totals, planned and done, are byte for byte what they were without regions', () => {
    const data = readVault(memoryIo(fixtureFiles('v')), 'v', { asOf: '2026-04-12' }).data;
    const week = data.program.macrocycle.phases[0]!.mesocycles[0]!.weeks[1]!;
    const withRegions = plannedSetsPerMuscle(week.sessions, data.program.exercises).value;
    assert.ok(withRegions.regions && Object.keys(withRegions.regions).length > 0, 'the fixture\'s catalogue movements bias regions');
    const { regions: _p, ...planned } = withRegions;
    assert.equal(JSON.stringify(planned), JSON.stringify(plannedSetsPerMuscle(week.sessions, strip(data.program.exercises)).value));
    const done = setsPerMuscle(data.sessions, data.program.exercises, '2026-03-02', '2026-04-12').value;
    assert.ok(done.regions && Object.keys(done.regions).length > 0, 'the logged weeks bias regions too');
    const { regions: _d, ...doneMuscles } = done;
    assert.equal(JSON.stringify(doneMuscles), JSON.stringify(setsPerMuscle(data.sessions, strip(data.program.exercises), '2026-03-02', '2026-04-12').value));
  });

});

describe('muscle regions: the region rules', () => {
  const planned = (o: Record<string, Partial<PlannedSplit>>): Record<string, PlannedSplit> =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { direct: 0, indirect: 0, hardDirect: 0, unknown: 0, ...v }]));

  it('holds a priority muscle\'s coverage regions to 4 direct sets, a declared region to 6 near failure, and reports the rest', () => {
    const rows = checkRegions(planned({ 'quads-rf': { direct: 3, hardDirect: 3 }, 'quads-vasti': { direct: 9, indirect: 1, hardDirect: 9 }, 'shoulders-side': { direct: 6, hardDirect: 4, unknown: 1 }, 'upper-back-mid': { direct: 2 } }), {
      priority: ['quads', 'upper-back'],
      declared: ['shoulders-side'],
      done: { 'quads-vasti': { direct: 3, indirect: 0.5 } },
    });
    assert.deepEqual(rows.map((r) => r.value.id), REGION_IDS);
    const by = Object.fromEntries(rows.map((r) => [r.value.id, r]));
    assert.deepEqual([by['quads-rf']!.value.rule, by['quads-rf']!.value.min, by['quads-rf']!.value.counted, by['quads-rf']!.value.status], ['coverage', 4, 3, 'short']);
    assert.deepEqual([by['quads-vasti']!.value.sets, by['quads-vasti']!.value.status, by['quads-vasti']!.value.done], [10, 'ok', { sets: 3.5, direct: 3, indirect: 0.5 }]);
    // Declared: direct near failure, an unknown effort counted; the parent counts as a priority muscle only through `priority`.
    assert.deepEqual([by['shoulders-side']!.value.rule, by['shoulders-side']!.value.min, by['shoulders-side']!.value.counted, by['shoulders-side']!.value.status, by['shoulders-side']!.value.declared], ['declared', 6, 5, 'short', true]);
    assert.match(by['shoulders-side']!.reason.note!, /^Side delts: 5 direct sets near failure a week \(1 of unknown effort, counted\), under the 6 a declared weak region gets/);
    // A rough-guide region of a priority muscle, and a coverage region of a muscle that is not one: reported only.
    assert.deepEqual([by['upper-back-mid']!.value.rule, by['upper-back-mid']!.value.status, by['upper-back-mid']!.value.roughGuide], [null, 'reported', true]);
    assert.match(by['upper-back-mid']!.reason.note!, /rough guide only/);
    assert.deepEqual([by['hamstrings-hip']!.value.rule, by['hamstrings-hip']!.value.status], [null, 'reported']);
    assert.equal(by['quads-rf']!.reason.rule, 'volume.regions');
    assert.deepEqual(by['quads-rf']!.reason.threshold, { coverage: 4, declared: 6, hardRir: 3, direct: 1, indirect: 0.5 });
  });

  it('a declared region is held to 6 even outside the coverage rule (the upper chest, a rough-guide region)', () => {
    const rows = checkRegions(planned({ 'chest-upper': { direct: 6, hardDirect: 6 } }), { declared: ['chest-upper', 'upper-back-traps'], priority: regionPriority([], ['chest-upper', 'upper-back-traps']) });
    const by = Object.fromEntries(rows.map((r) => [r.value.id, r.value]));
    assert.deepEqual([by['chest-upper']!.status, by['upper-back-traps']!.status, by['upper-back-traps']!.counted], ['ok', 'short', 0]);
  });

  it('declaredRegions: priorityRegions and the regions of the body-assessment rows that act in full, region ids only, once each', () => {
    const profile = {
      priorityRegions: ['shoulders-side', 'inner chest'],
      emphasis: [
        { area: 'Quads', seen: 'x', confidence: 'medium' as const, emphasis: 'x', regions: ['quads-rf', 'shoulders-side'], confirmed: true },
        { area: 'Calves', seen: 'x', confidence: 'medium' as const, emphasis: 'x', regions: ['calves-soleus'], confirmed: false },
        // Not answered yet in a profile that records answers: it doesn't act.
        { area: 'Triceps', seen: 'x', confidence: 'medium' as const, emphasis: 'x', regions: ['triceps-long'] },
      ],
    };
    assert.deepEqual(declaredRegions(profile), ['shoulders-side', 'quads-rf']);
    assert.deepEqual(declaredRegions(null), []);
    // A profile that records no answers anywhere: every row acts, as before confirmations existed.
    assert.deepEqual(declaredRegions({ emphasis: [{ area: 'Triceps', seen: 'x', confidence: 'medium' as const, emphasis: 'x', regions: ['triceps-long'] }] }), ['triceps-long']);
    assert.deepEqual(regionPriority(['quads'], ['shoulders-side', 'quads-rf']), ['quads', 'shoulders']);
    assert.deepEqual(REGION_RULES, { coverage: 4, declared: 6 });
  });
});
