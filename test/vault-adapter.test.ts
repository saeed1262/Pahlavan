// The vault adapter on the synthetic vault (test/fixtures/vault) and on small
// in-memory variations of it.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fromVault, isoWeekDate, ladderStatus, planWeekOf, type VaultFiles } from '../src/adapters/vault/convert.ts';
import { matchCatalogue, normalizeName } from '../src/adapters/vault/catalogue-match.ts';
import { readVault } from '../src/adapters/vault/read.ts';
import { paths } from '../src/adapters/vault/layout.ts';
import type { SlotExtras } from '../src/core/plan-data.ts';
import type { ExerciseSlot, Session } from '../src/core/schema.ts';
import { validateBody, validateCheckins, validateProgram, validateSession } from '../src/core/validate.ts';
import { fixtureFiles, fsIo, memoryIo, VAULT } from './helpers.ts';

const read = (asOf = '2026-04-12') => readVault(fsIo, VAULT, { asOf });
const { data } = read();
const session = (date: string, type?: string): Session => data.sessions.find((s) => s.date === date && (!type || s.template === type))!;
const slotOf = (s: Session, exercise: string) => s.plan!.slots.find((x) => x.exercise === exercise);
const codes = (ws: { code: string }[]) => ws.map((w) => w.code);

function files(edit: (f: Record<string, unknown>) => void = () => {}): VaultFiles {
  const raw = fixtureFiles('v');
  const f: Record<string, unknown> = {
    plan: JSON.parse(raw[`v/${paths().plan}`]!),
    log: JSON.parse(raw[`v/${paths().log}`]!),
    body: JSON.parse(raw[`v/${paths().body}`]!),
    habits: JSON.parse(raw[`v/${paths().habits}`]!),
    baselines: ['2026-02-23'],
  };
  edit(f);
  return f as unknown as VaultFiles;
}

describe('vault adapter: reading the files', () => {
  it('reads every file of the synthetic vault without errors', () => {
    const r = read();
    assert.deepEqual(r.files, { plan: 'found', log: 'found', body: 'found', habits: 'found', profile: 'found', ledger: 'found', checkins: 'missing', eating: 'missing' });
    assert.deepEqual(r.data.errors, []);
    assert.deepEqual(r.data.coach, { profile: 'ok', ledger: 'ok', checkins: 'missing', eating: 'missing' });
    assert.equal(r.data.plan.cycleStart, '2026-02-23');
    assert.equal(r.data.plan.start, '2026-03-02');
  });

  it('turns unknowns into warnings, never crashes', () => {
    assert.deepEqual(codes(data.warnings), [
      'checkins-missing',
      'snapshot-rebuilt',
      'unknown-exercise',
      'bad-value',
      'unknown-field',
      'bad-habit-key',
      'test-not-number',
      'free-text-equipment',
      'unknown-preference',
      'unknown-movement',
    ]);
    const w = (c: string) => data.warnings.find((x) => x.code === c)!.items;
    assert.deepEqual(w('unknown-exercise'), ['Band External Rotation']);
    assert.deepEqual(w('free-text-equipment'), ['rowing machine']);
    assert.deepEqual(w('test-not-number'), ['2026-03-07 pistol: "box 4"']);
    assert.deepEqual(w('unknown-movement'), ['shoulder: ring-dip-unknown']);
  });

  it('produces valid schema v1', () => {
    assert.deepEqual(validateProgram(data.program), []);
    assert.deepEqual(validateCheckins(data.checkins), []);
    assert.deepEqual(validateBody(data.body), []);
    for (const s of data.sessions) assert.deepEqual(validateSession(s), [], s.id);
  });

  it('reports a missing plan-data.json or invalid JSON as errors', () => {
    const missing = readVault(memoryIo({}), 'v');
    assert.equal(missing.files.plan, 'missing');
    assert.deepEqual(codes(missing.data.errors), ['missing']);
    const raw = fixtureFiles('v');
    raw[`v/${paths().body}`] = '{ not json';
    const bad = readVault(memoryIo(raw), 'v', { asOf: '2026-04-12' });
    assert.deepEqual(codes(bad.data.errors), ['json']);
    assert.match(bad.data.errors[0]!.message, /body-data\.json is not valid JSON/);
  });

  it('says when the coach files do not exist yet', () => {
    const raw = fixtureFiles('v');
    delete raw[`v/${paths().profile}`];
    delete raw[`v/${paths().ledger}`];
    const r = readVault(memoryIo(raw), 'v', { asOf: '2026-04-12' });
    assert.deepEqual(r.data.coach, { profile: 'missing', ledger: 'missing', checkins: 'missing', eating: 'missing' });
    assert.equal(r.data.profile, null);
    assert.equal(r.data.warnings.filter((w) => w.code === 'coach-missing').length, 2);
    assert.deepEqual(r.data.errors, []);
  });

  it('reports invalid coach files as errors', () => {
    const r = fromVault(files((f) => {
      f['profile'] = { schemaVersion: 1, goals: [] };
      f['ledger'] = { schemaVersion: 2, constraints: [] };
    }));
    assert.deepEqual(r.coach, { profile: 'invalid', ledger: 'invalid', checkins: 'missing', eating: 'missing' });
    assert.ok(r.errors.some((e) => e.code === 'profile' && /availability: is required/.test(e.message)));
    assert.ok(r.errors.some((e) => e.code === 'ledger' && /schema version 1/.test(e.message)));
  });
});

describe('vault adapter: sessions', () => {
  it('turns lift1 and lift2 into top sets at Standard tracking, in their logged or plan unit', () => {
    const s = session('2026-03-04');
    assert.equal(s.trackingLevel, 'standard');
    assert.deepEqual(s.exercises, [
      { exercise: 'romanian-deadlift', sets: [{ weight: 60, unit: 'kg', reps: 8 }] }, // no unit: the lift's own unit (kg)
      { exercise: 'seated-cable-row', sets: [{ weight: 100, unit: 'lb', reps: 10 }] }, // no unit, no lift unit: liftUnit
    ]);
    assert.deepEqual(session('2026-04-06').exercises[0], { exercise: 'romanian-deadlift', sets: [{ weight: 154, unit: 'lb', reps: 8 }] });
  });

  it('leaves 0 x 0 lifts unlogged but keeps their swap in the snapshot', () => {
    const s = session('2026-03-20');
    assert.deepEqual(s.exercises.map((x) => x.exercise), ['seated-cable-row']);
    const slot = slotOf(s, 'hamstring-curl') as ExerciseSlot & { _planned?: string };
    assert.equal(slot._planned, 'Romanian Deadlift');
    assert.equal(slot.main, true);
    assert.equal(slotOf(s, 'romanian-deadlift'), undefined);
  });

  it('applies swaps to the snapshot, as the dashboard counts them', () => {
    const s = session('2026-04-11');
    assert.ok(slotOf(s, 'db-walking-lunge'));
    assert.equal(slotOf(s, 'bulgarian-split-squat'), undefined);
  });

  it('freezes the plan snapshot with the week kind, the template kind and Express', () => {
    assert.equal(session('2026-03-18').plan!.kind, 'express');
    assert.deepEqual(session('2026-03-18').plan!.slots.map((x) => [x.exercise, x.sets]), [
      ['warm-up-band-external-rotation-dislocates', 2], // the dashboard's setsOf("3 min")
      ['goblet-squat', 2],
      ['flat-db-bench-press', 2],
      ['face-pull', 2],
    ]);
    const deload = session('2026-03-23');
    assert.equal(deload.plan!.weekKind, 'deload');
    assert.equal(slotOf(deload, 'goblet-squat')!.sets, 2);
    assert.deepEqual([deload.plan!.phase, deload.plan!.mesocycle, deload.plan!.week], ['phase-1', 'meso-1', 4]);
    assert.equal(session('2026-03-03').plan!.kind, 'short');
    assert.equal(session('2026-03-03').trackingLevel, 'light');
  });

  it('maps skipped checklist lines to exercises, both parts of a paired line, and ignores the warm-up', () => {
    assert.deepEqual(session('2026-04-08').skipped, ['face-pull', 'band-external-rotation']);
    assert.equal(session('2026-03-30').skipped, undefined);
  });

  it('rebuilds a missing snapshot from the plan and says so', () => {
    const s = session('2026-03-31');
    assert.deepEqual(s.plan!.slots.map((x) => x.exercise), ['circuit-squat-jump-burpee', 'cool-down-walk-or-bike']);
  });

  it('keeps custom sessions without a plan, and the dashboard-only fields under _vault', () => {
    const s = session('2026-03-06');
    assert.equal(s.plan, undefined);
    assert.equal(s.template, undefined);
    assert.equal(s.minutes, 15);
    assert.deepEqual((s as Session & { _vault: unknown })._vault, { type: 'custom', label: 'Abs at home', rating: 8, cardioMode: 'bike' });
    assert.equal(s.id, '2026-03-06-custom-abs-at-home');
  });

  it('counts plan weeks from the first logged plan session (the dashboard clock)', () => {
    assert.equal(planWeekOf('2026-03-02', '2026-03-08'), 1);
    assert.equal(planWeekOf('2026-03-02', '2026-03-23'), 4);
    assert.equal(planWeekOf('2026-03-04', '2026-04-12'), 6);
  });
});

describe('vault adapter: the program', () => {
  const week = data.program.macrocycle.phases[0]!.mesocycles[0]!.weeks[1]!;
  const tpl = (id: string) => week.sessions.find((t) => t.id === id)!;

  it('builds templates from the sessions in rotation order, with plan-data types kept', () => {
    assert.deepEqual(week.sessions.map((t) => [t.id, t.kind, (t as typeof t & { _type: string })._type]), [
      ['a', 'lift', 'A'],
      ['b', 'lift', 'B'],
      ['s1', 'short', 'S1'],
      ['s3', 'short', 'S3'],
    ]);
    assert.equal(tpl('a').name, 'Full Body A — Squat');
    assert.deepEqual(data.plan.weekTarget, { lift: 3, short: 1 });
  });

  it('takes the rep range, increment and unit of a logged lift from lifts', () => {
    const goblet = tpl('a').slots[0]!;
    assert.deepEqual([goblet.exercise, goblet.sets, goblet.repRange, goblet.rir, goblet.main], ['goblet-squat', 4, [8, 10], 2, true]);
    assert.deepEqual(goblet.progression, { rule: 'double' });
    const rdl = data.program.exercises['romanian-deadlift']!;
    assert.deepEqual([rdl.unit, rdl.increment], ['kg', 5]);
    assert.deepEqual([data.program.exercises['seated-cable-row']!.unit, data.program.exercises['seated-cable-row']!.increment], ['lb', 10]);
    assert.equal(tpl('b').slots[0]!.rir, 3); // "RIR 3." in the note
  });

  it('reads an until note as a temporary change, with the item it replaces', () => {
    assert.deepEqual(tpl('a').slots[0]!.until, {
      until: '2026-04-19',
      reason: 'knee niggle, easing; the back squat returns after it',
      note: 'Replaces Barbell Back Squat.',
    });
  });

  it('uses the ladder level as of the date, with the next level as the ladder rule', () => {
    const push = tpl('s1').slots[1]!;
    assert.equal(push.exercise, 'floor-push-up');
    assert.deepEqual(push.progression, { rule: 'ladder', next: 'tempo-push-up' });
    const early = readVault(fsIo, VAULT, { asOf: '2026-03-10' }).data.program.macrocycle.phases[0]!.mesocycles[0]!.weeks[0]!;
    assert.equal(early.sessions.find((t) => t.id === 's1')!.slots[1]!.exercise, 'incline-push-up');
  });

  it('marks rounds and minutes items as circuits and timed work, not counted, and keeps cardio and mobility kinds', () => {
    const ex = data.program.exercises;
    assert.equal(ex['circuit-squat-jump-burpee']!.kind, 'circuit');
    assert.equal(ex['circuit-squat-jump-burpee']!.muscles, undefined);
    assert.equal(ex['chest-to-wall-handstand']!.kind, 'timed');
    assert.equal(ex['pike-hold-on-a-bench']!.kind, 'timed'); // every level of a "6 min" ladder
    assert.equal(ex['zone-2-finisher']!.kind, 'cardio');
    assert.equal(ex['doorway-chest-stretch']!.kind, 'mobility');
    assert.deepEqual(ex['side-plank']!.muscles, { main: ['obliques'], helps: ['abs', 'shoulders', 'glutes'] }); // "3 x 20-40 s" has sets
  });

  it('maps guide muscles to engine ids, dropping unknown ones with a warning', () => {
    const r = fromVault(files((f) => {
      const g = (f['plan'] as { guide: Record<string, { muscles: { main: string[] } }> }).guide;
      g['Face Pull']!.muscles.main = ['shoulders', 'rear-delts'];
    }));
    assert.deepEqual(r.program.exercises['face-pull']!.muscles!.main, ['shoulders']);
    assert.deepEqual(r.warnings.find((w) => w.code === 'unknown-muscle')!.items, ['Face Pull: rear-delts']);
  });

  it('runs plan weeks from week 1 in phases of two 4-week mesocycles, deloading every 4th week as the dashboard does', () => {
    const weeks = data.program.macrocycle.phases.flatMap((p) => p.mesocycles.flatMap((m) => m.weeks));
    assert.equal(weeks.length, 24);
    assert.equal(data.program.macrocycle.start, '2026-03-02');
    assert.deepEqual(weeks.filter((w) => w.kind === 'deload').map((w) => w.start).slice(0, 2), ['2026-03-23', '2026-04-20']);
    assert.equal(weeks[0]!.calibration, true);
    const d = weeks[3]!.sessions;
    assert.deepEqual(d.find((t) => t.id === 'a')!.slots.map((s) => s.sets), [2, 2, 2, 2, 3]);
    assert.deepEqual(d.find((t) => t.id === 's3')!.slots.map((s) => s.exercise), ['easy-zone-2-bike-or-walk']);
  });

  it('keeps each item, its derived values and plan-data\'s other keys for the exporter', () => {
    const s = tpl('a').slots[0] as ExerciseSlot & SlotExtras;
    assert.equal(s._item!.table, 'Goblet Squat');
    assert.deepEqual(s._derived, { exercise: 'goblet-squat', sets: 4, repRange: [8, 10], rir: 2, until: '2026-04-19' });
    const extras = (data.program as typeof data.program & { _planData: { top: Record<string, unknown>; liftsOrder: string[] } })._planData;
    assert.deepEqual(extras.liftsOrder, ['Barbell Back Squat', 'Goblet Squat', 'Flat DB Bench Press', 'Romanian Deadlift', 'Seated Cable Row']);
    assert.equal(extras.top['ladderNote'], 'Handstand levels are attempts, not sets.');
  });

  it('extends the program past week 24 when the date needs it, with a warning', () => {
    const late = fromVault(files(), { asOf: '2026-09-01' });
    assert.equal(late.program.macrocycle.phases.length, 4);
    assert.ok(late.warnings.some((w) => w.code === 'past-plan-end'));
  });

  it('matches common exercise names to the catalogue for strain tags and patterns', () => {
    assert.equal(matchCatalogue('Romanian Deadlift')?.id, 'rdl');
    assert.equal(matchCatalogue('Flat DB Bench Press')?.id, 'db-bench');
    assert.equal(matchCatalogue('Bulgarian Split Squat')?.id, 'bulgarian-split-squat');
    assert.equal(matchCatalogue('Seated Cable Row')?.id, 'seated-cable-row');
    assert.equal(matchCatalogue('Band External Rotation'), null);
    assert.equal(normalizeName('45° Back Extension (DB)'), '45 back extension');
    assert.deepEqual(data.program.exercises['romanian-deadlift']!.risk, ['abdomen-high']);
    assert.equal(data.program.exercises['romanian-deadlift']!.pattern, 'hinge');
    assert.equal(data.catalogueMatch['goblet-squat'], 'goblet-squat');
  });
});

describe('vault adapter: body, habits and the coach files', () => {
  it('turns body days into daily check-ins and weigh-ins, kg', () => {
    const c = data.checkins.daily.find((d) => d.date === '2026-04-10')!;
    assert.deepEqual(Object.keys(c).sort(), ['date', 'energy', 'floors', 'rhr', 'sleepH', 'sleepQ', 'soreMuscles', 'soreness', 'steps', 'trained']);
    assert.deepEqual(c.soreMuscles, { glutes: 'sore', quads: 'mild' }); // the body map's slug quadriceps is the muscle quads
    assert.equal(data.checkins.daily.find((d) => d.date === '2026-04-11')!.protein, true);
    assert.equal(data.body.weights[0]!.date, '2026-02-20');
    assert.equal(data.body.weights[0]!.unit, 'kg');
    assert.equal(data.body.weights.length, 48);
  });

  it('drops out-of-range and null values with a warning, never the whole day', () => {
    const d = data.checkins.daily.find((x) => x.date === '2026-03-22')!;
    assert.equal(d.steps, undefined);
    assert.equal(typeof d.sleepH, 'number');
    assert.equal(data.checkins.daily.find((x) => x.date === '2026-03-23')!.rhr, undefined);
    const r = fromVault(files((f) => {
      ((f['body'] as { days: Record<string, Record<string, unknown>> }).days['2026-03-02']!)['energy'] = 7;
    }));
    assert.deepEqual(r.warnings.find((w) => w.code === 'bad-value')!.items, ['2026-03-02 energy: 7', '2026-03-22 steps: -50']);
  });

  it('reads workout and protein ticks by ISO week into trained and protein', () => {
    const tick = data.checkins.daily.find((x) => x.date === '2026-04-09')!;
    assert.equal(tick.trained, true);
    assert.equal(data.checkins.daily.find((x) => x.date === '2026-04-05')!.trained, undefined); // "0" is not a tick
    assert.equal(data.checkins.daily.filter((x) => x.protein).length, 5);
    assert.equal(isoWeekDate(2026, 53, 4), '2027-01-01');
    assert.equal(isoWeekDate(2025, 53, 0), null);
    assert.equal(isoWeekDate(2027, 1, 0), '2027-01-04');
    assert.equal(isoWeekDate(2026, 15, 3), '2026-04-09');
  });

  it('keeps tape in cm, numeric tests and the photo index', () => {
    assert.deepEqual(data.body.tape[0], { date: '2026-02-24', unit: 'cm', waist: 96, hips: 98, chest: 101, arm: 33 });
    assert.deepEqual(data.body.tests[0], { date: '2026-03-07', results: { pushups: 12, pullups: 0, hollowS: 25, handstandS: 10 } });
    assert.deepEqual(data.body.photos[0], { date: '2026-02-24', poses: ['front', 'side', 'back'], folder: 'Progress Photos/2026-02-24/' });
  });

  it('reports ladder levels and what a test shows, as of a date', () => {
    assert.deepEqual(ladderStatus(data, '2026-04-12').map((l) => [l.id, l.level, l.levelName, l.testShowsLevel ?? null]), [
      ['pushup', 2, 'Floor push-up', null],
      ['handstand', 3, 'Chest-to-wall handstand', null],
    ]);
    assert.deepEqual(ladderStatus(data, '2026-03-10')[0]!.testShowsLevel, { level: 2, name: 'Floor push-up' });
  });

  it('reads the profile and the Ledger as schema v1', () => {
    assert.equal(data.profile!.goals[0]!.kind, 'recomposition');
    assert.equal(data.ledger!.constraints[0]!.until, '2026-04-19');
  });
});
