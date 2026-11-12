// Intervals are hard conditioning in review's concurrent check, whichever
// way the plan writes them: the item's `timed` field, the intervals its note
// describes, a cardio item the guide names or a timed item it does not, and
// an interval finisher on a lifting day. So "never the day before a heavy
// lower-body day" (planning.md, Conditioning) is checked on the written plan.
// Steady cardio stays easy, and so does the calibration week, where the
// intervals are easy steady minutes by rule.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { buildReview } from '../src/report/review.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

type Json = Record<string, any>;
const PLAN = 'v/3-Personal/Fitness/plan-data.json';
const LOG = 'v/3-Personal/Fitness/fitness-log-data.json';
const PROFILE = 'v/3-Personal/Fitness/Coach/profile.json';
const WEEK_1 = '2026-03-07'; // the plan starts on Monday 2 March: its calibration week
const LATER = '2026-04-10'; // plan week 6, a loading week

/** The structure as fields: 4 × 4 min hard with 3 min easy between, 30 min in all. */
const FIELDS = { name: 'Bike intervals, 4 x 4 min', table: 'Bike intervals', sr: '30 min', rest: '—', timed: { minutes: 30, rounds: 4, workMin: 4, restMin: 3 }, note: 'Hard on the work, easy between.' };
/** As plans wrote it before the field: the minutes in sr, the intervals in the note. */
const NOTE_ONLY = { name: 'Uphill walk or run intervals, 4 x 4 min', table: 'Uphill intervals', sr: '22 min', rest: '—', note: '4 × 4 min hard, 3 min easy between, warm-up and cool-down easy.' };
const STEADY = { name: 'Easy bike', table: 'Easy bike', sr: '20 min', rest: '—', note: 'Easy.' };

/**
 * The synthetic vault with one short session S2 of these items, no log, and
 * the profile's training days Mon, Tue and Sun: A on Monday, B (Romanian
 * deadlift, split squat) on Tuesday, S2 on Sunday, the day before A's squat.
 */
function concurrent(date: string, s2: Json[], edit?: (plan: Json) => void) {
  const f = fixtureFiles('v');
  const plan = JSON.parse(f[PLAN]!);
  plan.start = '2026-03-02';
  plan.shortTypes = ['S2'];
  plan.titles = { ...plan.titles, S2: 'Conditioning' };
  plan.sessions.S2 = s2;
  edit?.(plan);
  f[PLAN] = JSON.stringify(plan);
  const log = JSON.parse(f[LOG]!);
  log.sessions = [];
  f[LOG] = JSON.stringify(log);
  const profile = JSON.parse(f[PROFILE]!);
  profile.availability.fixedDays = ['mon', 'tue', 'sun'];
  f[PROFILE] = JSON.stringify(profile);
  const { data } = readVault(memoryIo(f, date), 'v', { asOf: date });
  return { data, concurrent: buildReview(data, date).concurrent };
}
const intervalFlags = (c: ReturnType<typeof concurrent>['concurrent']) => c.flags.filter((x) => x.value.flag === 'intervals-before-heavy-legs').map((x) => x.value.sessions);
const cardioGuide = (name: string) => (plan: Json) => {
  plan.guide[name] = { setup: 'Bike.', do: 'Hard, then easy.', avoid: 'Sprinting.', q: 'intervals', muscles: { main: [], helps: [], kind: 'cardio' } };
};

describe('review: intervals are hard work in the concurrent check', () => {
  it('lays the week on the profile’s days: A Monday, B Tuesday, S2 Sunday', () => {
    const { concurrent: c } = concurrent(LATER, [STEADY]);
    assert.deepEqual(c.layout.map((l) => `${l.session} ${l.day} ${l.source}`), ['A mon available', 'B tue available', 'S2 sun available']);
    assert.deepEqual(intervalFlags(c), [], 'steady cardio is easy');
  });

  it('intervals in the timed field, a timed item the guide does not name: flagged the day before a heavy lower-body day', () => {
    const { data, concurrent: c } = concurrent(LATER, [FIELDS]);
    assert.equal(data.program.exercises['bike-intervals-4-x-4-min']?.kind, 'timed');
    assert.deepEqual(intervalFlags(c), [['S2', 'A']]);
    const f = c.flags.find((x) => x.value.flag === 'intervals-before-heavy-legs')!;
    assert.match(f.value.suggestion, /^Hard leg intervals in S2 come less than a day before the heavy lower-body day A/);
  });

  it('intervals only in the note (the minutes in sr): the same', () => {
    const { data, concurrent: c } = concurrent(LATER, [NOTE_ONLY]);
    assert.equal(data.program.exercises['uphill-walk-or-run-intervals-4-x-4-min']?.kind, 'timed');
    assert.deepEqual(intervalFlags(c), [['S2', 'A']]);
  });

  it('a cardio item from the guide: the same as intervals, easy as steady minutes', () => {
    const hard = concurrent(LATER, [FIELDS], cardioGuide(FIELDS.name));
    assert.equal(hard.data.program.exercises['bike-intervals-4-x-4-min']?.kind, 'cardio');
    assert.deepEqual(intervalFlags(hard.concurrent), [['S2', 'A']]);
    const steady = concurrent(LATER, [STEADY], cardioGuide(STEADY.name));
    assert.equal(steady.data.program.exercises['easy-bike']?.kind, 'cardio');
    assert.deepEqual(intervalFlags(steady.concurrent), []);
  });

  it('the calibration week: the intervals are easy steady minutes, so no flag', () => {
    for (const item of [FIELDS, NOTE_ONLY]) {
      const { concurrent: c } = concurrent(WEEK_1, [item]);
      assert.deepEqual(c.layout.map((l) => `${l.session} ${l.day}`), ['A mon', 'B tue', 'S2 sun']);
      assert.deepEqual(intervalFlags(c), [], item.name);
    }
  });

  it('an interval finisher on a lifting day counts, after the lifting; easy in the calibration week', () => {
    const fin = { ...FIELDS, name: 'Zone 2 finisher', sr: '12 min', timed: { rounds: 3, workMin: 2, restMin: 2, warmupMin: 1, cooldownMin: 1 } };
    const withFinisher = (plan: Json) => {
      plan.sessions.A = plan.sessions.A.map((i: Json) => (i.name === 'Zone 2 finisher' ? fin : i));
    };
    const { data, concurrent: c } = concurrent(LATER, [STEADY], withFinisher);
    assert.equal(data.program.exercises['zone-2-finisher']?.kind, 'cardio');
    // A on Monday, B's Romanian deadlift and split squat on Tuesday.
    assert.deepEqual(intervalFlags(c), [['A', 'B']]);
    assert.ok(!c.flags.some((x) => x.value.flag === 'conditioning-before-lifting'), 'after the lifting is fine');
    assert.deepEqual(intervalFlags(concurrent(WEEK_1, [STEADY], withFinisher).concurrent), []);
  });
});
