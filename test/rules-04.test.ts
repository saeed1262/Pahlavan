// Engine 0.4.0: the one conversion rule, reason titles, names in notes, and
// the new rules (training load, soreness per muscle, session variants) on the
// synthetic fixtures in test/fixtures/rules/.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CATALOGUE_BY_ID } from '../src/core/data/exercises.ts';
import { e1rmTrend } from '../src/core/e1rm.ts';
import { exerciseHistory } from '../src/core/history.ts';
import { plannedEffort, sessionLoad, typicalMinutes, weekLoad } from '../src/core/load.ts';
import { nextTarget } from '../src/core/progression.ts';
import { titleFor } from '../src/core/reason.ts';
import { screenExercise } from '../src/core/safety.ts';
import type { DailyCheckin, Exercise, Session, SessionTemplate } from '../src/core/schema.ts';
import { soreDays, sorenessForSlot } from '../src/core/soreness.ts';
import { setInUnit, weightInUnit } from '../src/core/units.ts';
import { expressVariant, hotelVariant } from '../src/core/variant.ts';
import { validateCheckins } from '../src/core/validate.ts';
import { approx, ROOT, session, set, slot } from './helpers.ts';

type Json = Record<string, any>;
const fixture = (name: string): Json => JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'rules', `${name}.json`), 'utf8'));

describe('one conversion rule for a logged set', () => {
  it('keeps a same-unit weight and rounds a converted one to the exercise step', () => {
    assert.equal(weightInUnit(61, 'kg', { unit: 'kg', increment: 5 }), 61);
    assert.equal(weightInUnit(154, 'lb', { unit: 'kg', increment: 5 }), 70); // 69.85 kg
    assert.equal(weightInUnit(77, 'kg', { unit: 'lb', increment: 10 }), 170); // 169.76 lb
    assert.equal(weightInUnit(154, 'lb', { unit: 'kg' }), 69.9); // no step: 0.1, the snippets' rounding
    assert.deepEqual(setInUnit({ weight: 110, unit: 'lb', reps: 10 }, { unit: 'kg', increment: 5 }), { weight: 50, unit: 'kg', reps: 10, logged: { weight: 110, unit: 'lb' } });
  });

  it('gives the same value to the e1RM, the progression base and its reason', () => {
    const tops = [
      { date: '2026-03-02', weight: 65, unit: 'kg' as const, reps: 8 },
      { date: '2026-03-09', weight: 154, unit: 'lb' as const, reps: 8 },
    ];
    const t = e1rmTrend(tops, { unit: 'kg', increment: 5 }).value;
    assert.deepEqual(t.points.map((p) => [p.weight, p.logged]), [[65, { weight: 65, unit: 'kg' }], [70, { weight: 154, unit: 'lb' }]]);
    approx(t.points[1]!.e1rm, 70 * (1 + 8 / 30));
    const s = [session('2026-03-09', { logged: { rdl: [set(154, 8, 'lb')] }, slots: [slot('rdl', 3, 8, 10)] })];
    const r = nextTarget({ history: exerciseHistory(s, 'rdl'), exercise: { unit: 'kg', increment: 5 }, repRange: [8, 10], targetRir: 2 });
    assert.equal(r.reason.inputs['base'], 70);
    assert.deepEqual((r.reason.inputs['last'] as Json).sets, [{ weight: 70, unit: 'kg', reps: 8, logged: { weight: 154, unit: 'lb' } }]);
    assert.deepEqual([r.value.weight, r.value.unit, r.value.reps], [70, 'kg', 9]);
  });
});

describe('reason titles', () => {
  it('maps rule ids to plain titles by their longest prefix', () => {
    assert.equal(titleFor('progression.double'), 'Progression');
    assert.equal(titleFor('safety.ledger'), 'Injury limit');
    assert.equal(titleFor('safety.load-cap'), 'Load cap');
    assert.equal(titleFor('stall.triage.2'), 'Stall triage');
    assert.equal(titleFor('deload.prescription.standard'), 'Light-week sets');
    assert.equal(titleFor('readiness.trim'), 'Readiness');
    assert.equal(titleFor('variant.hotel'), 'Hotel swap');
    assert.equal(titleFor('nothing.known'), 'Rule');
  });

  it('lets a rule retitle its outcome: a capped target, a big jump, a unit flag', () => {
    const s = (date: string, w: number) => session(date, { logged: { db: [set(w, 12, 'lb')] }, slots: [slot('db', 3, 8, 12)] });
    const big = nextTarget({ history: exerciseHistory([s('2026-03-02', 20)], 'db'), exercise: { unit: 'lb', increment: 5 }, repRange: [8, 12], targetRir: 2 });
    assert.equal(big.reason.title, 'Big jump');
    const flag = e1rmTrend([{ date: '2026-03-02', weight: 50, unit: 'kg', reps: 5 }, { date: '2026-03-05', weight: 110, unit: 'kg', reps: 5 }], 'kg');
    assert.equal(flag.reason.title, 'Unit check');
  });
});

describe('names, not ids, in notes', () => {
  it('names the Ledger swaps', () => {
    const ex = Object.fromEntries(['back-squat', 'goblet-squat', 'leg-press', 'box-squat'].map((id) => [id, { name: CATALOGUE_BY_ID.get(id)!.name, unit: 'kg' as const, increment: 2.5, muscles: CATALOGUE_BY_ID.get(id)!.muscles, risk: [`abdomen-${CATALOGUE_BY_ID.get(id)!.iap}` as const] }]));
    const r = screenExercise('back-squat', [{ id: 'abdominal-wall', noTags: ['abdomen-high'] }], '2026-03-10', ex);
    assert.match(r.reason.note ?? '', /Swaps: Box squat \(bodyweight, sit back to a box\), Goblet squat\./);
    assert.doesNotMatch(r.reason.note ?? '', /goblet-squat/);
    assert.ok((r.value.swaps as string[]).includes('goblet-squat')); // ids stay in the value
  });

  it('names the ladder\'s next variation', () => {
    const s = [session('2026-03-02', { level: 'full', logged: { 'push-up': [set(0, 12), set(0, 12)] }, slots: [slot('push-up', 2, 8, 12)] })];
    const r = nextTarget({ history: exerciseHistory(s, 'push-up'), exercise: { unit: 'kg', increment: 2.5 }, repRange: [8, 12], targetRir: 2, rule: { rule: 'ladder', next: 'ring-push-up' }, exerciseName: (id) => CATALOGUE_BY_ID.get(id)?.name ?? id });
    assert.match(r.reason.note ?? '', /move to Ring push-up/);
    assert.equal(r.reason.inputs['next'], 'ring-push-up');
  });
});

describe('training load (Foster)', () => {
  const f = fixture('load-foster');
  const sessions = f.sessions as Session[];
  it('session load is RPE x minutes', () => {
    for (const [id, load] of Object.entries(f.expected.sessionLoads)) assert.equal(sessionLoad(sessions.find((s) => s.id === id)!).value.load, load, id);
  });

  it('a week: load, monotony and strain over 7 days, rest days 0', () => {
    const w = weekLoad(sessions.map((s) => sessionLoad(s).value), f.expected.week1.from).value;
    assert.deepEqual(w.daily, f.expected.week1.daily);
    assert.equal(w.load, f.expected.week1.load);
    approx(w.monotony, f.expected.week1.monotony, 1e-12);
    approx(w.strain, f.expected.week1.strain, 1e-9);
  });

  it('no RPE: unknown, unless the check-in effort stands in as an estimate', () => {
    const w = weekLoad(sessions.map((s) => sessionLoad(s).value), f.expected.week2.from);
    assert.deepEqual([w.value.load, w.value.knownLoad, w.value.unknownSessions], [f.expected.week2.load, f.expected.week2.knownLoad, f.expected.week2.unknownSessions]);
    assert.match(w.reason.note ?? '', /load is unknown/);
    const est = weekLoad(sessions.map((s) => sessionLoad(s, { effort: 6 }).value), f.expected.week2.from).value;
    assert.deepEqual([est.load, est.estimatedSessions], [f.expected.week2WithEffort.load, f.expected.week2WithEffort.estimatedSessions]);
    assert.match(sessionLoad(sessions.find((s) => s.id === 's7')!, { effort: 6 }).reason.note ?? '', /check-in effort \(6\/10\) stands in, an estimate/);
  });

  it('typical minutes and a planned effort, a heuristic', () => {
    assert.equal(typicalMinutes(sessions, 'a', '2026-03-06'), f.expected.typicalMinutesA);
    const ex: Record<string, Exercise> = {
      sq: { name: 'Squat', unit: 'kg', increment: 2.5 },
      bench: { name: 'Bench', unit: 'kg', increment: 2.5 },
      circuit: { name: 'Circuit', kind: 'circuit' },
      bike: { name: 'Bike', kind: 'cardio' },
      dead: { name: 'Dead bug', unit: 'kg', increment: 2.5 },
    };
    const t = (id: string, kind: SessionTemplate['kind'], slots: SessionTemplate['slots']): SessionTemplate => ({ id, name: id, kind, slots });
    const lift = t('a', 'lift', [{ ...slot('sq', 3, 5, 8, 2), main: true }, { ...slot('bench', 3, 6, 10, 3), main: true }]);
    const e = f.expected.plannedEffort;
    assert.equal(plannedEffort(lift, ex).value, e.lift);
    assert.equal(plannedEffort(lift, ex, { deload: true }).value, e.liftDeload);
    assert.equal(plannedEffort(t('s3', 'short', [slot('circuit', 1, 1, 1)]), ex).value, e.circuit);
    assert.equal(plannedEffort(t('c', 'cardio', [slot('bike', 1, 1, 1)]), ex).value, e.cardio);
    assert.equal(plannedEffort(t('s1', 'short', [slot('dead', 3, 8, 8)]), ex).value, e.short);
    assert.match(plannedEffort(lift, ex).reason.note ?? '', /A heuristic/);
  });
});

describe('soreness per muscle', () => {
  const f = fixture('soreness');
  for (const [i, c] of (f.cases as Json[]).entries()) {
    it(`case ${i + 1}: ${c.slot.exercise}, ${c.expected.action}`, () => {
      const r = sorenessForSlot(c.slot, f.exercises, f.daily, f.date, { lighter: c.lighter });
      const { muscles: _m, ...v } = r.value;
      assert.deepEqual(v, c.expected);
      assert.equal(r.reason.title, 'Soreness');
    });
  }

  it('names the muscles in its notes', () => {
    const r = sorenessForSlot(f.cases[1].slot, f.exercises, f.daily, f.date);
    assert.match(r.reason.note ?? '', /^Glutes sore today: Goblet Squat at 3 set\(s\), RIR 3\./);
  });

  it('counts sore days per muscle for the mesocycle review', () => {
    assert.deepEqual(soreDays(f.daily, f.soreDays.from, f.soreDays.to).value, f.soreDays.expected);
  });

  it('is in the schema: muscle ids, mild or sore', () => {
    assert.deepEqual(validateCheckins({ schemaVersion: 1, daily: f.daily as DailyCheckin[], weekly: [] }), []);
    assert.equal(validateCheckins({ schemaVersion: 1, daily: [{ date: '2026-03-10', soreMuscles: { glutes: 'very' } }], weekly: [] }).length, 1);
  });
});

describe('session variants', () => {
  const f = fixture('variants');
  const catalogueOf = (id: string) => CATALOGUE_BY_ID.get(id) ?? null;
  const hotel = (extra: Json = {}) => hotelVariant({ template: f.template, exercises: f.exercises, catalogueOf, ledger: f.ledger, date: f.date, unit: 'kg', ...extra });

  it('express: the plan\'s block, or the main lifts at 2 sets', () => {
    const withBlock = expressVariant(f.template, f.express.block).value;
    assert.deepEqual(withBlock.slots.map((s) => [s.exercise, s.sets]), f.express.withBlock);
    assert.equal(withBlock.warmup, 'band work');
    assert.deepEqual(expressVariant(f.template, null).value.slots.map((s) => [s.exercise, s.sets]), f.express.withoutBlock);
    assert.equal(expressVariant(f.template, null).reason.title, 'Express');
  });

  it('hotel: each pattern kept with bodyweight, dumbbells or a band, reps up, RIR one lower', () => {
    const r = hotel({ tripDays: f.hotel.shortTrip.tripDays });
    assert.deepEqual(r.value.slots.map((s) => [s.exercise, s.sets, s.repRange, s.rir]), f.hotel.shortTrip.slots);
    assert.deepEqual(r.value.slots.filter((s) => s.replaces).map((s) => s.replaces), ['back-squat', 'db-bench', 'seated-cable-row', 'lat-pulldown']);
    const squat = r.value.slots[0]!.reasons[0]!;
    assert.equal(squat.title, 'Hotel swap');
    assert.match(squat.note ?? '', /Goblet squat in place of Barbell back squat: the same squat pattern with dumbbell; 8-12 reps at RIR 1/);
    assert.equal(r.value.volumeScaled, false);
  });

  it('hotel: a trip of a week or more scales each exercise to a third of its sets', () => {
    const r = hotel({ tripDays: f.hotel.longTrip.tripDays });
    assert.deepEqual(r.value.slots.map((s) => s.sets), f.hotel.longTrip.sets);
    assert.equal(r.value.volumeScaled, true);
    assert.match(r.reason.note ?? '', /a third of the usual volume/);
  });

  it('hotel: the screening caps\' RIR floor holds', () => {
    assert.deepEqual(hotel({ capMinRir: f.hotel.conservative.capMinRir }).value.slots.map((s) => s.rir), f.hotel.conservative.rir);
  });

  it('hotel: every swap passes the Ledger screen, and a pattern with no option says so', () => {
    const noHigh = hotel({ ledger: [{ id: 'x', noTags: ['abdomen-high', 'abdomen-moderate'] }] }).value.slots[0]!;
    assert.equal(noHigh.exercise, 'bodyweight-squat'); // the dumbbell squats are moderate strain; the furthest bodyweight variation
    const none = hotel({ template: { ...f.template, slots: [{ exercise: 'farmer', sets: 3, repRange: [8, 8], rir: 2 }] }, exercises: { farmer: { name: 'Sled push', unit: 'kg', increment: 5, pattern: 'carry' } }, ledger: [{ id: 'x', noTags: ['abdomen-high', 'abdomen-moderate'] }] }).value.slots[0]!;
    assert.equal(none.unavailable, true);
    assert.match(none.reasons[0]!.note ?? '', /no carry option/);
  });
});
