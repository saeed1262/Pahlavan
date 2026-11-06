// The weekly check-in answers as rule inputs: the scenario fixtures in
// test/fixtures/checkins/ (made up), the helpers, and the check-in log's shape.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { adherence } from '../src/core/adherence.ts';
import {
  busyPeriods,
  cancelState,
  fatigueFrom,
  fullLoadWeeks,
  jointAchesOf,
  recoveryTrigger,
  reportedRirFor,
  rirBiasFor,
  triageStart,
  weekStartOf,
} from '../src/core/checkins.ts';
import { decideDeload } from '../src/core/deload.ts';
import { exerciseHistory } from '../src/core/history.ts';
import { nextTarget } from '../src/core/progression.ts';
import type { RirCalibration, Session, WeeklyCheckin } from '../src/core/schema.ts';
import { triageLadder, type TriageInput } from '../src/core/stall.ts';
import { validateCheckinLog, validateCheckins, validateProfile } from '../src/core/validate.ts';
import { ROOT } from './helpers.ts';

type Json = Record<string, any>;
const DIR = join(ROOT, 'test', 'fixtures', 'checkins');
const scenarios: Json[] = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')));
const scenario = (name: string) => scenarios.find((s) => s.name === name)!;

function deloadFor(records: WeeklyCheckin[], programStart: string, today: string) {
  const c = cancelState(records, today);
  return decideDeload({
    programStart,
    today,
    recoveryTrigger: recoveryTrigger(records, today).value,
    busy: busyPeriods(records, today),
    cancelled: c.cancelled,
    previousCancelled: c.previousCancelled,
  });
}

describe('check-in scenarios: the fixtures are valid', () => {
  for (const s of scenarios) {
    it(s.name, () => {
      assert.deepEqual(validateCheckinLog({ schemaVersion: 1, checkins: s.checkins }), []);
      assert.ok(s.about.length > 20);
    });
  }
});

describe('check-in scenarios: deloads', () => {
  for (const name of ['a-deload-cancelled', 'b-busy-week-moves-deload', 'c-poor-recovery-early-deload']) {
    const s = scenario(name);
    for (const c of s.cases) {
      it(`${name} on ${c.today}`, () => {
        assert.deepEqual(deloadFor(s.checkins, s.programStart, c.today).value, c.expected);
      });
    }
  }

  it('a-deload-cancelled: the cancel is the user\'s, and a second scheduled one in a row is refused', () => {
    const s = scenario('a-deload-cancelled');
    assert.match(deloadFor(s.checkins, s.programStart, '2026-03-23').reason.note ?? '', /Cancelled by the user/);
    assert.match(deloadFor(s.checkins, s.programStart, '2026-04-20').reason.note ?? '', /Cancel not applied/);
  });

  it('b-busy-week-moves-deload: the reasons name the move', () => {
    const s = scenario('b-busy-week-moves-deload');
    assert.match(deloadFor(s.checkins, s.programStart, '2026-03-16').reason.note ?? '', /moved here from week 4, to fall on the travel week/);
    assert.match(deloadFor(s.checkins, s.programStart, '2026-03-23').reason.note ?? '', /moved to week 3/);
  });

  it('c-poor-recovery-early-deload: mild aches or check-ins two weeks apart do not trigger it', () => {
    const s = scenario('c-poor-recovery-early-deload');
    assert.equal(recoveryTrigger(s.variants.mildAches, '2026-03-16').value, false);
    assert.equal(recoveryTrigger(s.variants.notRunning, '2026-03-16').value, false);
    assert.equal(recoveryTrigger(s.checkins, '2026-03-30').value, false); // the latest check-in is over a week old
    assert.match(recoveryTrigger(s.checkins, '2026-03-16').reason.note ?? '', /two check-ins running/);
  });
});

describe('check-in scenarios: progression', () => {
  it('d-full-load-week: trainedAtFullLoad makes the deload-week session a loading one', () => {
    const s = scenario('d-full-load-week');
    const history = exerciseHistory(s.sessions as Session[], 'cable-chest-press');
    const base = { history, exercise: s.exercise, repRange: s.repRange, targetRir: s.targetRir, date: s.today };
    const without = nextTarget(base);
    assert.deepEqual([without.value.action, without.value.weight, without.value.reps], [s.expected.without.action, s.expected.without.weight, s.expected.without.reps]);
    assert.deepEqual(without.reason.inputs['deloadSessionsNotUsed'], s.expected.without.deloadSessionsNotUsed);
    const withIt = nextTarget({ ...base, fullLoadWeeks: fullLoadWeeks(s.checkins, s.today) });
    assert.deepEqual([withIt.value.action, withIt.value.weight, withIt.value.reps], [s.expected.with.action, s.expected.with.weight, s.expected.with.reps]);
    assert.deepEqual(withIt.reason.inputs['fullLoadSessions'], s.expected.with.fullLoadSessions);
    assert.match(withIt.reason.note ?? '', /trained at full load: counted as loading/);
    assert.equal(withIt.reason.inputs['deloadSessionsNotUsed'], undefined);
  });

  it('f-rir-calibration-bias: reported RIR holds the weight, the calibration bias corrects it', () => {
    const s = scenario('f-rir-calibration-bias');
    const aliases = ['cable-chest-press', 'Cable Chest Press'];
    const history = exerciseHistory(s.sessions as Session[], 'cable-chest-press');
    const reported = reportedRirFor(s.checkins, aliases, '2026-03-26')!;
    assert.deepEqual(reported, { rir: 1, checkin: '2026-03-29', perLift: true });
    const base = { history, exercise: s.exercise, repRange: s.repRange, targetRir: s.targetRir, date: s.today, reportedRir: { rir: reported.rir, checkin: reported.checkin } };
    const held = nextTarget(base);
    assert.deepEqual([held.value.action, held.value.weight, held.value.reps], [s.expected.reportedOnly.action, s.expected.reportedOnly.weight, s.expected.reportedOnly.reps]);
    assert.match(held.reason.note ?? '', /check-in reported RIR 1/);
    const bias = rirBiasFor(s.profile.rirCalibration as RirCalibration[], aliases, s.today)!;
    assert.equal(bias.bias, s.expected.withBias.bias);
    const up = nextTarget({ ...base, rirBias: { bias: bias.bias, date: bias.entry.date } });
    assert.deepEqual([up.value.action, up.value.weight, up.value.reps], [s.expected.withBias.action, s.expected.withBias.weight, s.expected.withBias.reps]);
    assert.match(up.reason.note ?? '', /calibration bias \+2 \(calibration of 2026-03-20\): 1 -> 3/);
    assert.deepEqual(reportedRirFor(s.checkins, aliases, '2026-03-20'), null); // not in the reviewed week
  });
});

describe('check-in scenarios: triage', () => {
  const s = scenario('e-triage-step-3');
  for (const c of s.cases) {
    it(`e-triage-step-3 on ${c.today}`, () => {
      const start = triageStart(s.checkins, s.lift, c.today).value;
      assert.equal(start.startAt, c.expected.startAt);
      const f = fatigueFrom(s.checkins, c.today).value;
      const steps = triageLadder('Flat DB Bench Press', { ...(s.input as TriageInput), recovery: f.recovery, jointAches: f.jointAches, startAt: start.startAt });
      assert.equal(steps.find((x) => x.value.chosen)!.value.step, c.expected.chosen);
    });
  }

  it('starts at step 1 without a record, and caps at step 4', () => {
    assert.equal(triageStart([], ['bench'], '2026-03-29').value.startAt, 1);
    const four: WeeklyCheckin[] = [{ date: '2026-03-22', weekStart: '2026-03-16', triage: [{ lift: 'bench', step: 4, date: '2026-03-22' }] }];
    assert.equal(triageStart(four, ['bench'], '2026-03-29').value.startAt, 4);
  });
});

describe('check-in helpers', () => {
  it('reads fatigue from the latest check-in within a week', () => {
    const recs: WeeklyCheckin[] = [{ date: '2026-03-15', weekStart: '2026-03-09', recovery: 2, jointAches: [{ area: 'knee', severity: 6 }] }];
    assert.deepEqual(fatigueFrom(recs, '2026-03-16').value, { from: '2026-03-15', recovery: 2, poorRecovery: true, jointAches: true });
    assert.equal(fatigueFrom(recs, '2026-03-25').value.from, null);
    assert.equal(fatigueFrom([], '2026-03-16').value.recovery, null);
  });

  it('reads first-v1 records: weekOf, jointAches true or false, rir per exercise', () => {
    const old: WeeklyCheckin = { weekOf: '2026-03-02', jointAches: true, rir: { 'db-bench': 3 } };
    assert.equal(weekStartOf(old), '2026-03-02');
    assert.equal(jointAchesOf(old).fatigue, true);
    assert.equal(jointAchesOf({ weekOf: '2026-03-02', jointAches: false }).fatigue, false);
    assert.deepEqual(reportedRirFor([old], ['db-bench'], '2026-03-04'), { rir: 3, checkin: '2026-03-08', perLift: true });
  });

  it('feeds adherence through the records (the shortfall split)', () => {
    const r = adherence({
      sessions: [],
      today: '2026-03-08',
      target: { lift: 2, short: 0 },
      weekly: [{ date: '2026-03-08', weekStart: '2026-03-02', confirmedUnlogged: [{ date: '2026-03-03' }], missedDays: ['2026-03-05'] }],
    }).value;
    assert.deepEqual(r.weeks[3]!.gaps, { unlogged: 0, missed: 1, rest: 0 });
  });
});

describe('check-in log: the shape', () => {
  const ok: WeeklyCheckin = {
    date: '2026-03-22',
    weekStart: '2026-03-16',
    recovery: 4,
    effort: 7,
    stress: 2,
    enjoyment: 4,
    jointAches: [{ area: 'knee', severity: 2 }],
    reportedRir: { 'Flat DB Bench Press': 2.5 },
    proteinDays: 5,
    confirmedUnlogged: [{ date: '2026-03-19', type: 'S1' }],
    restDays: ['2026-03-20'],
    missedDays: [],
    deload: { trainedAtFullLoad: ['2026-03-16'] },
    triage: [{ lift: 'bench', step: 2, date: '2026-03-22' }],
    knownBusy: [{ from: '2026-03-30', to: '2026-04-03', kind: 'travel' }],
    focusFollowed: true,
    notes: 'Good week.',
    letter: '3-Personal/Fitness/Coach/Letters/2026-03-22.md',
  };

  it('accepts a full record, and the first-v1 weekly shape still validates', () => {
    assert.deepEqual(validateCheckinLog({ schemaVersion: 1, checkins: [ok] }), []);
    assert.deepEqual(validateCheckinLog({ schemaVersion: 1, checkins: [{ ...ok, reportedRir: 2 }] }), []);
    assert.deepEqual(validateCheckins({ schemaVersion: 1, daily: [], weekly: [{ weekOf: '2026-03-02', recovery: 3, jointAches: false, rir: { 'db-bench': 2 }, unloggedSessions: 1 }] }), []);
  });

  it('refuses what does not fit', () => {
    const msgs = (c: unknown) => validateCheckinLog({ schemaVersion: 1, checkins: [c] }).map((e) => `${e.path}: ${e.message}`);
    assert.deepEqual(msgs({ ...ok, weekStart: '2026-03-17' }), ['checkins[0].weekStart: must be a Monday']);
    assert.deepEqual(msgs({ weekStart: '2026-03-16' }), ['checkins[0].date: is required']);
    assert.deepEqual(msgs({ date: '2026-03-15', weekStart: '2026-03-16' }), ['checkins[0].date: is before the week it reviews']);
    assert.deepEqual(msgs({ ...ok, restDays: ['2026-03-23'] }), ['checkins[0].restDays[0]: is after the check-in date']);
    assert.deepEqual(msgs({ ...ok, deload: { trainedAtFullLoad: ['2026-03-17'] } }), ['checkins[0].deload.trainedAtFullLoad[0]: must be a Monday']);
    assert.deepEqual(msgs({ ...ok, recovery: 6 }), ['checkins[0].recovery: must be at most 5']);
    assert.deepEqual(msgs({ ...ok, triage: [{ lift: 'bench', step: 5, date: '2026-03-22' }] }), ['checkins[0].triage[0].step: must be at most 4']);
    assert.deepEqual(msgs({ ...ok, knownBusy: [{ from: '2026-04-03', to: '2026-03-30', kind: 'travel' }] }), ['checkins[0].knownBusy[0]: from is after to']);
    assert.deepEqual(msgs({ ...ok, knownBusy: [{ from: '2026-03-30', to: '2026-04-03', kind: 'holiday' }] }), ['checkins[0].knownBusy[0].kind: expected one of: travel, crunch, other']);
    assert.deepEqual(msgs({ ...ok, jointAches: [{ area: 'knee', severity: 11 }] }), ['checkins[0].jointAches[0].severity: must be at most 10']);
    const dup = validateCheckinLog({ schemaVersion: 1, checkins: [ok, ok] });
    assert.deepEqual(dup.map((e) => e.message), ['duplicate check-in date: 2026-03-22']);
  });

  it('adds the RIR calibration table to the profile', () => {
    const profile = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'vault', '3-Personal', 'Fitness', 'Coach', 'profile.json'), 'utf8'));
    assert.deepEqual(validateProfile({ ...profile, rirCalibration: [{ exercise: 'cable-chest-press', date: '2026-03-20', predicted: 2, actual: 4 }] }), []);
    assert.equal(validateProfile({ ...profile, rirCalibration: [{ exercise: 'Cable Chest Press', date: '2026-03-20', predicted: 2, actual: 4 }] }).length, 1);
  });
});
