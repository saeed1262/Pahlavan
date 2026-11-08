import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canWrite,
  validateBody,
  validateCheckins,
  validateLog,
  validateProfile,
  validateProgram,
  validateSession,
} from '../src/core/validate.ts';

const profile = () => ({
  schemaVersion: 1,
  units: { load: 'kg', body: 'kg' },
  goals: [{ id: 'g1', kind: 'fat-loss', label: 'Lose fat', importance: 8, confidence: 7 }],
  availability: { daysPerWeek: 3, minutesPerSession: 45 },
  equipment: ['dumbbells'],
  trackingLevel: 'standard',
  screening: { outcome: 'go', date: '2026-03-01' },
  emphasis: [],
});

const program = () => ({
  schemaVersion: 1,
  id: 'p1',
  name: 'Plan',
  exercises: { squat: { name: 'Squat', unit: 'kg', increment: 2.5, muscles: { main: ['quads'], helps: [] } }, plank: { name: 'Plank', kind: 'timed' } },
  macrocycle: {
    id: 'm1',
    name: 'Macro',
    start: '2026-03-02',
    phases: [{ id: 'ph1', name: 'Base', mesocycles: [{ id: 'me1', name: 'Meso', weeks: [{ index: 1, kind: 'loading', start: '2026-03-02', sessions: [{ id: 'a', name: 'A', kind: 'lift', slots: [{ exercise: 'squat', sets: 3, repRange: [5, 8], rir: 2, risk: ['abdomen-high', 'joint:knee'], until: { until: '2026-03-20', reason: 'knee', sets: 2 } }] }] }] }] }],
  },
});

const session = () => ({ id: 's1', date: '2026-03-02', trackingLevel: 'full', exercises: [{ exercise: 'squat', sets: [{ weight: 60, unit: 'kg', reps: 5, rir: 2, pain: false }] }], minutes: 50, rpe: 7 });

const paths = (errors: { path: string }[]) => errors.map((e) => e.path);

describe('validate', () => {
  it('accepts valid documents', () => {
    assert.deepEqual(validateProfile(profile()), []);
    assert.deepEqual(validateProgram(program()), []);
    assert.deepEqual(validateSession(session()), []);
    assert.deepEqual(validateLog({ schemaVersion: 1, month: '2026-03', sessions: [session()] }), []);
    assert.deepEqual(validateCheckins({ schemaVersion: 1, daily: [{ date: '2026-03-02', sleepH: 7, rhr: 55 }], weekly: [{ weekOf: '2026-03-02', recovery: 3 }] }), []);
    assert.deepEqual(validateBody({ schemaVersion: 1, weights: [{ date: '2026-03-02', weight: 80, unit: 'kg' }], tape: [], tests: [], photos: [] }), []);
  });

  it('rejects another schema version', () => {
    const errors = validateProfile({ ...profile(), schemaVersion: 2 });
    assert.deepEqual(errors, [{ path: 'schemaVersion', message: 'expected schema version 1, found 2' }]);
  });

  it('reports missing and unknown keys, but allows "_" comments', () => {
    const { goals: _goals, ...noGoals } = profile();
    assert.deepEqual(paths(validateProfile(noGoals)), ['goals']);
    assert.deepEqual(paths(validateProfile({ ...profile(), colour: 'red' })), ['colour']);
    assert.deepEqual(validateProfile({ ...profile(), _about: 'notes' }), []);
  });

  it('checks values: dates, enums, ranges, rep ranges, risk tags', () => {
    const p = profile();
    p.screening.date = '2026-02-30';
    p.goals[0]!.importance = 11;
    p.trackingLevel = 'everything';
    assert.deepEqual(paths(validateProfile(p)).sort(), ['goals[0].importance', 'screening.date', 'trackingLevel']);

    const g = program();
    const s = g.macrocycle.phases[0]!.mesocycles[0]!.weeks[0]!.sessions[0]!.slots[0]!;
    s.repRange = [8, 5];
    s.risk = ['strains-everything' as 'abdomen-high'];
    const errors = validateProgram(g);
    assert.match(errors.map((e) => e.message).join(' | '), /low end is above the high end/);
    assert.match(errors.map((e) => e.message).join(' | '), /joint:<name>/);
  });

  it('checks a slot\'s timed structure: minutes, or rounds with workMin, and nothing else', () => {
    const g = program();
    const slot = g.macrocycle.phases[0]!.mesocycles[0]!.weeks[0]!.sessions[0]!.slots[0] as unknown as Record<string, unknown>;
    slot['timed'] = { minutes: 30, rounds: 4, workMin: 4, restMin: 3, warmupMin: 3, cooldownMin: 2 };
    assert.deepEqual(validateProgram(g), []);
    const errors = () => validateProgram(g).map((e) => `${e.path.replace(/^.*slots/, 'slots')}: ${e.message}`).sort();
    slot['timed'] = { rounds: 4 };
    assert.deepEqual(errors(), ['slots[0].timed: needs minutes, or rounds with workMin']);
    slot['timed'] = { minutes: 0, laps: 2 };
    assert.deepEqual(errors(), ['slots[0].timed.laps: unknown key', 'slots[0].timed.minutes: must be above 0']);
  });

  it('requires a unit and an increment for strength exercises only', () => {
    const g = program() as { exercises: Record<string, unknown> };
    g.exercises['row'] = { name: 'Row' };
    assert.match(validateProgram(g).map((e) => e.message).join(), /needs a unit and an increment/);
  });

  it('cross-checks exercise ids in the program', () => {
    const g = program();
    g.macrocycle.phases[0]!.mesocycles[0]!.weeks[0]!.sessions[0]!.slots[0]!.exercise = 'deadlift';
    assert.match(validateProgram(g)[0]!.message, /unknown exercise id: deadlift/);
  });

  it('keeps sessions consistent with their file and level', () => {
    const outside = validateLog({ schemaVersion: 1, month: '2026-04', sessions: [session()] });
    assert.match(outside[0]!.message, /outside the file's month/);
    const dup = validateLog({ schemaVersion: 1, month: '2026-03', sessions: [session(), session()] });
    assert.match(dup[0]!.message, /duplicate session id/);
    const light = validateSession({ ...session(), trackingLevel: 'light' });
    assert.match(light[0]!.message, /Light-level session logs no sets/);
    const badSet = validateSession({ ...session(), exercises: [{ exercise: 'squat', sets: [{ weight: -1, unit: 'stone', reps: 5.5 }] }] });
    assert.deepEqual(paths(badSet).sort(), ['exercises[0].sets[0].reps', 'exercises[0].sets[0].unit', 'exercises[0].sets[0].weight']);
  });

  it('checks check-ins and body records', () => {
    const c = validateCheckins({ schemaVersion: 1, daily: [{ date: '2026-03-02', sleepQ: 6 }, { date: '2026-03-02' }], weekly: [{ weekOf: '2026-03-03' }] });
    assert.deepEqual(paths(c), ['daily[0].sleepQ']);
    const c2 = validateCheckins({ schemaVersion: 1, daily: [{ date: '2026-03-02' }, { date: '2026-03-02' }], weekly: [{ weekOf: '2026-03-03' }] });
    assert.deepEqual(c2.map((e) => e.message), ['duplicate date: 2026-03-02', 'must be a Monday']);
    const b = validateBody({ schemaVersion: 1, weights: [{ date: '2026-03-02', weight: 0, unit: 'kg' }], tape: [{ date: '2026-03-02', unit: 'mm' }], tests: [], photos: [{ date: '2026-03-02', poses: [] }] });
    assert.deepEqual(paths(b).sort(), ['photos[0].poses', 'tape[0].unit', 'weights[0].weight']);
  });

  it('rejects non-objects at the root', () => {
    assert.deepEqual(validateBody(null), [{ path: '(root)', message: 'expected an object' }]);
    assert.deepEqual(validateLog([]), [{ path: '(root)', message: 'expected an object' }]);
  });

  it('guards writes on the schema version', () => {
    assert.equal(canWrite({ schemaVersion: 1 }).value, true);
    const old = canWrite({ schemaVersion: 0 });
    assert.equal(old.value, false);
    assert.equal(old.reason.rule, 'schema.write-guard');
    assert.match(old.reason.note ?? '', /refusing to write/);
    assert.equal(canWrite('not a document').value, false);
  });
});

describe('profile: the self-check, the bad-week answer, short days and split preferences', () => {
  const full = () => ({
    ...profile(),
    availability: { daysPerWeek: 5, minutesPerSession: 60, shortSessions: { days: 2, minutes: 30 } },
    preferences: { splits: { likes: ['full-body'], dislikes: ['push-pull-legs'] } },
    badWeek: { usually: ['skips-sessions'], note: 'I skip it' },
    selfCheck: {
      date: '2026-11-02',
      sitToStand: { easy: true, heelsDown: true },
      pushUps: 30,
      deadHangS: 40,
      pullUps: 5,
      coreHold: { kind: 'plank', seconds: 60 },
      hingeFlatBack: true,
      overheadReach: { clean: false, ribFlare: true, lowBackArch: true },
      wallGapCm: 5,
      balanceS: { left: 30, right: 30 },
    },
  });

  it('accepts every field', () => {
    assert.deepEqual(validateProfile(full()), []);
  });

  it('rejects bad values with their paths', () => {
    const p = full() as Record<string, any>;
    p['selfCheck'].pushUps = 2.5;
    p['selfCheck'].coreHold = { kind: 'side-plank', seconds: 30 };
    p['selfCheck'].overheadReach = { clean: true, ribFlare: true };
    p['selfCheck'].extra = 1;
    p['badWeek'].usually = ['naps'];
    p['preferences'].splits.likes = ['bro-split'];
    p['availability'].shortSessions = { days: 5, minutes: 60 };
    assert.deepEqual(paths(validateProfile(p)).sort(), [
      'availability.shortSessions.days',
      'availability.shortSessions.minutes',
      'badWeek.usually[0]',
      'preferences.splits.likes[0]',
      'selfCheck.coreHold.kind',
      'selfCheck.extra',
      'selfCheck.overheadReach',
      'selfCheck.pushUps',
    ]);
  });

  it('needs the self-check date', () => {
    const p = full() as Record<string, any>;
    delete p['selfCheck'].date;
    assert.deepEqual(paths(validateProfile(p)), ['selfCheck.date']);
  });

  it('takes the user\'s answers to the findings: per self-check test and per body-assessment row, true or false', () => {
    const p = full() as Record<string, any>;
    p['selfCheck'].confirmed = { sitToStand: true, hingeFlatBack: false, overheadReach: false, balanceS: true, _note: 'asked on 2026-11-02' };
    p['emphasis'] = [{ area: 'Overhead', seen: 'Ribs flare', confidence: 'medium', emphasis: 'Landmine pressing', kind: 'overhead-limited', confirmed: false }];
    assert.deepEqual(validateProfile(p), []);
    p['selfCheck'].confirmed = {};
    assert.deepEqual(validateProfile(p), [], 'an empty map: nothing asked yet');
  });

  it('rejects an answer that is not true or false, and a test with no finding to confirm', () => {
    const p = full() as Record<string, any>;
    p['selfCheck'].confirmed = { overheadReach: 'yes', pushUps: true };
    p['emphasis'] = [{ area: 'Overhead', seen: 'Ribs flare', confidence: 'medium', emphasis: 'Landmine pressing', confirmed: 1 }];
    assert.deepEqual(paths(validateProfile(p)).sort(), ['emphasis[0].confirmed', 'selfCheck.confirmed.overheadReach', 'selfCheck.confirmed.pushUps']);
    p['selfCheck'].confirmed = true;
    p['emphasis'] = [];
    assert.deepEqual(paths(validateProfile(p)), ['selfCheck.confirmed']);
  });
});
