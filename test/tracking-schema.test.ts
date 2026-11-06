// The new files' schema: Coach/tracking.json, Coach/nudges.json and
// Coach/sitting.json (the made-up fixture files validate; each cross-field
// rule refuses what it should), and the program's desk breaks and the
// profile's desk-work answer.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { TrackedItem, Tracking } from '../src/core/schema.ts';
import { validateNudges, validateProfile, validateProgram, validateSitting, validateTracking } from '../src/core/validate.ts';
import { VAULT } from './helpers.ts';

const COACH = join(VAULT, '3-Personal', 'Fitness', 'Coach');
const read = (f: string) => JSON.parse(readFileSync(join(COACH, f), 'utf8'));
const TRACKING = read('tracking.json') as Tracking;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const msgs = (errs: { path: string; message: string }[]) => errs.map((e) => `${e.path}: ${e.message}`);

/** The fixture with one item replaced (by id) or changed in place. */
function withItem(id: string, edit: (x: TrackedItem) => void): Tracking {
  const t = clone(TRACKING);
  edit(t.items.find((x) => x.id === id)!);
  return t;
}

describe('Coach/tracking.json', () => {
  it('the made-up fixture validates, every kind and schedule in it', () => {
    assert.deepEqual(validateTracking(TRACKING), []);
    assert.deepEqual([...new Set(TRACKING.items.map((x) => x.kind))].sort(), ['amount', 'desk', 'sitting', 'standup', 'supplement', 'tick']);
  });

  it('needs the schema version, items and days; unknown keys are errors, "_" keys comments', () => {
    assert.match(msgs(validateTracking({ schemaVersion: 2, items: [], days: {} })).join(), /schemaVersion: expected schema version 1/);
    assert.match(msgs(validateTracking({ schemaVersion: 1, items: [] })).join(), /days: is required/);
    assert.match(msgs(validateTracking({ ...clone(TRACKING), extra: 1 })).join(), /extra: unknown key/);
    assert.deepEqual(validateTracking({ ...clone(TRACKING), _note: 'kept' }), []);
  });

  it('each kind needs its own settings and refuses another kind\'s', () => {
    assert.match(msgs(validateTracking(withItem('water', (x) => delete x.amount))).join(), /amount: is required for a amount item/);
    assert.match(msgs(validateTracking(withItem('creatine', (x) => (x.amount = { target: 1, unit: 'g' })))).join(), /amount: belongs to amount items only/);
    assert.match(msgs(validateTracking(withItem('flossing', (x) => (x.dose = '1')))).join(), /dose: belongs to supplements only/);
    assert.match(msgs(validateTracking(withItem('creatine', (x) => (x.goal = { amount: 5, unit: 'g' })))).join(), /goal: belongs to ticks only/);
    assert.match(msgs(validateTracking(withItem('stand-ups', (x) => (x.when = 'morning')))).join(), /a standup item has its own times/);
  });

  it('checks the reminder against the kind', () => {
    assert.match(msgs(validateTracking(withItem('creatine', (x) => (x.reminder = { at: '09:00', afterLog: true })))).join(), /needs either at or afterLog/);
    assert.match(msgs(validateTracking(withItem('creatine', (x) => (x.reminder = { afterLog: true })))).join(), /afterLog: needs when: training/);
    assert.match(msgs(validateTracking(withItem('water', (x) => (x.reminder = { every: 120, from: '09:00' })))).join(), /every needs from and to/);
    assert.match(msgs(validateTracking(withItem('water', (x) => (x.reminder = { every: 120, from: '21:00', to: '09:00' })))).join(), /reminder.to: is not after from/);
    assert.match(msgs(validateTracking(withItem('desk-breaks', (x) => (x.reminder = { at: '10:00' })))).join(), /a desk item has its own cards/);
    assert.match(msgs(validateTracking(withItem('sitting', (x) => (x.reminder = { at: '10:00' })))).join(), /reminder.at: does not apply to a sitting item/);
    assert.match(msgs(validateTracking(withItem('creatine', (x) => (x.reminder = { at: '9:00' })))).join(), /reminder.at: does not match/);
  });

  it('checks schedules: weekdays need days, every N days needs n; stand-ups, sitting and desk breaks run daily or on weekdays', () => {
    assert.match(msgs(validateTracking(withItem('creatine', (x) => (x.schedule = { kind: 'weekdays' })))).join(), /schedule.days: is required for weekdays/);
    assert.match(msgs(validateTracking(withItem('creatine', (x) => (x.schedule = { kind: 'every' })))).join(), /schedule.n: is required/);
    assert.match(msgs(validateTracking(withItem('creatine', (x) => (x.schedule = { kind: 'daily', n: 2 })))).join(), /n and from belong to every N days only/);
    assert.match(msgs(validateTracking(withItem('creatine', (x) => (x.schedule = { kind: 'weekdays', days: ['mon', 'mon'] })))).join(), /lists a day twice/);
    assert.match(msgs(validateTracking(withItem('stand-ups', (x) => (x.schedule = { kind: 'training' })))).join(), /runs every day or on chosen weekdays/);
    assert.deepEqual(validateTracking(withItem('creatine', (x) => (x.schedule = { kind: 'every', n: 2, from: '2026-03-03' }))), []);
  });

  it('checks pauses, earlier settings, the coach\'s reason and the stand-up hours', () => {
    assert.match(msgs(validateTracking(withItem('creatine', (x) => (x.pauses = [{ from: '2026-03-10' }, { from: '2026-03-20', to: '2026-03-25' }])))).join(), /only the last pause can be open/);
    assert.match(msgs(validateTracking(withItem('creatine', (x) => (x.pauses = [{ from: '2026-03-10', to: '2026-03-05' }])))).join(), /ends before it starts/);
    assert.match(msgs(validateTracking(withItem('creatine', (x) => (x.pauses = [{ from: '2026-03-10', to: '2026-03-15' }, { from: '2026-03-15' }])))).join(), /overlaps/);
    assert.match(msgs(validateTracking(withItem('water', (x) => (x.earlier = [{ until: '2026-03-15' }, { until: '2026-03-10' }])))).join(), /is not after the one before/);
    assert.match(msgs(validateTracking(withItem('creatine', (x) => delete x.source.why))).join(), /a coach suggestion needs its reason/);
    assert.match(msgs(validateTracking(withItem('stand-ups', (x) => (x.standup!.hours = ['17:30', '09:00'])))).join(), /from is not before to/);
  });

  it('the log names known items only, with the fields their kind keeps', () => {
    const t = clone(TRACKING);
    t.days['2026-04-10']!['ghost'] = { done: true };
    t.days['2026-04-10']!['water']!.done = true;
    t.days['2026-04-10']!['creatine']!.amount = 5;
    const m = msgs(validateTracking(t)).join('\n');
    assert.match(m, /days.2026-04-10.ghost: no item with the id ghost/);
    assert.match(m, /days.2026-04-10.water.done: does not apply to a amount item/);
    assert.match(m, /days.2026-04-10.creatine.amount: does not apply to a supplement item/);
    const desk = clone(TRACKING);
    desk.days['2026-04-10']!['stand-ups']!.deskMinutes = 20;
    assert.deepEqual(validateTracking(desk), [], 'a stand-up day keeps its desk minutes');
    desk.days['2026-04-10']!['water']!.deskMinutes = 10;
    assert.match(msgs(validateTracking(desk)).join(), /days.2026-04-10.water.deskMinutes: does not apply to a amount item/);
    desk.days['2026-04-10']!['stand-ups']!.deskMinutes = -5;
    assert.match(msgs(validateTracking(desk)).join(), /days.2026-04-10.stand-ups.deskMinutes: must be at least 0/);
    const bad = clone(TRACKING);
    (bad.days as Record<string, unknown>)['2026-02-30'] = { creatine: { done: true } };
    assert.match(msgs(validateTracking(bad)).join(), /2026-02-30: is not a real date/);
  });

  it('checks suggestions, duplicates and a fixed body-record schedule', () => {
    const t = clone(TRACKING);
    t.items.push(clone(t.items[0]!));
    t.suggestions![1]!.decided = undefined as never;
    delete t.suggestions![1]!.decided;
    t.bodyRecord = { schedule: 'fixed', tapeFrom: '2026-03-01' };
    const m = msgs(validateTracking(t)).join('\n');
    assert.match(m, /duplicate item id: creatine/);
    assert.match(m, /suggestions\[1\].decided: is required once accepted or dismissed/);
    assert.match(m, /bodyRecord.tapeEvery: is required for a fixed schedule/);
  });
});

describe('Coach/nudges.json', () => {
  it('the made-up fixture validates', () => assert.deepEqual(validateNudges(read('nudges.json')), []));

  it('knows the reminder keys and the skip keys', () => {
    const ok = { schemaVersion: 1, days: { '2026-04-10': { morning: {}, tape: {}, photos: {}, tests: {}, train: {}, 'slot:09:00': {}, 'slot:after-log': {}, 'amount:water': {}, 'desk:desk-breaks': {}, 'sitting:sitting': {}, 'sitting:sitting:stretch': { for: '2026-04-10T09:00:00.000Z' }, 'standup:stand-ups': {} } }, skipped: { 'tests:baseline': '2026-04-10T09:00:00Z', 'photos:2026-04-12': '2026-04-12T09:00:00.000Z' } };
    assert.deepEqual(validateNudges(ok), []);
    const m = msgs(validateNudges({ schemaVersion: 1, days: { '2026-04-10': { lunch: {}, 'slot:9:00': {} } }, skipped: { 'weight:2026-04-10': '2026-04-10T09:00:00Z' } })).join('\n');
    assert.match(m, /lunch: key does not match/);
    assert.match(m, /slot:9:00: key does not match/);
    assert.match(m, /weight:2026-04-10: key does not match/);
  });

  it('answers are from the list and moments are UTC timestamps', () => {
    const m = msgs(validateNudges({ schemaVersion: 1, days: { '2026-04-10': { morning: { how: 'maybe', at: '2026-04-10 07:10' } } } })).join('\n');
    assert.match(m, /how: expected one of: done, skipped, later, logged, rest, not-today/);
    assert.match(m, /at: does not match/);
  });
});

describe('Coach/sitting.json', () => {
  it('the made-up fixture validates', () => assert.deepEqual(validateSitting(read('sitting.json')), []));

  it('refuses a stretch ending before it starts or overlapping the one before, and odd Mac names', () => {
    const m = msgs(validateSitting({
      schemaVersion: 1,
      days: {
        '2026-04-10': {
          'Work Mac': [{ start: '2026-04-10T09:00:00Z', end: '2026-04-10T08:00:00Z' }],
          'Home Mac': [{ start: '2026-04-10T09:00:00Z', end: '2026-04-10T10:00:00Z' }, { start: '2026-04-10T09:30:00.000Z', end: '2026-04-10T11:00:00Z' }],
        },
      },
    })).join('\n');
    assert.match(m, /Work Mac\[0\]: ends before it starts/);
    assert.match(m, /Home Mac\[1\]: starts before the stretch before it ends/);
    assert.match(msgs(validateSitting({ schemaVersion: 1, days: { '2026-04-10': { '../x': [] } } })).join(), /\.\.\/x: key does not match/);
  });
});

describe('desk breaks in the program, desk work in the profile', () => {
  it('checks the desk breaks\' shape and the profile\'s answer', () => {
    const base = { schemaVersion: 1, id: 'p', name: 'P', exercises: {}, macrocycle: { id: 'm', name: 'M', start: '2026-03-02', phases: [{ id: 'ph', name: 'Ph', mesocycles: [{ id: 'me', name: 'Me', weeks: [{ index: 1, kind: 'loading', start: '2026-03-02', sessions: [] }] }] }] } };
    const desk = { steps: [{ name: 'Chin tuck', dose: '×10' }], every: 90, from: '10:00', to: '15:00', minutes: 5, days: ['mon'], why: [{ what: 'Desk job', from: 'intake' }] };
    assert.deepEqual(validateProgram({ ...base, deskBreaks: desk }), []);
    assert.match(msgs(validateProgram({ ...base, deskBreaks: { ...desk, steps: [], from: '10' } })).join('\n'), /steps: needs at least 1[\s\S]*from: does not match/);
    const profile = JSON.parse(readFileSync(join(COACH, 'profile.json'), 'utf8'));
    assert.deepEqual(validateProfile({ ...profile, work: { desk: true, sittingHours: 8 } }), []);
    assert.match(msgs(validateProfile({ ...profile, work: { sittingHours: 30 } })).join('\n'), /work.desk: is required[\s\S]*sittingHours: must be at most 24/);
  });
});
