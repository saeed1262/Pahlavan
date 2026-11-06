// The body record's schedule (from the plan, or every N days with Habit
// Nudges' baseline rule), desk breaks (the times, the plan's routine and its
// times from plan-data.json, the generator's rule, the exporter), sitting
// time per day (every Mac, the running stretch, desk time's history) and the
// stand-up helpers around the ported step.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { readTracking } from '../src/adapters/vault/tracking-read.ts';
import { bodyRecordView, bodySchedule, partStatus, planOccurrences, resolveSchedule } from '../src/core/body-schedule.ts';
import { fixedOffsetClock, momentAt } from '../src/core/clock.ts';
import { deskBreaksFor, deskBreaksFromPlanData, deskRoutine, deskTimes, deskTimingFromPlanData, NUDGES_DESK_TIMING, planDeskBreaks } from '../src/core/desk-breaks.ts';
import { generatePlan } from '../src/core/plan/generate.ts';
import { toPlanData, type PlanData } from '../src/core/plan-data.ts';
import type { Profile, SittingLog } from '../src/core/schema.ts';
import { deskTimeHistory, sittingDays, sittingVerdict, stretchesOn, summarizeDay, unionStretches } from '../src/core/sitting.ts';
import { inStandHours, STAND_FRESH, standAnswer, standAskNow, standConfig, standMeeting, standProgress } from '../src/core/standup.ts';
import { validateProgram } from '../src/core/validate.ts';
import { buildHabitsScreen, suggestionDetail } from '../src/report/habits-screen.ts';
import { buildRoutine } from '../src/report/routine.ts';
import { buildDue, buildTracked } from '../src/report/tracking.ts';
import { fixtureFiles, fsIo, memoryIo, VAULT } from './helpers.ts';

const read = readVault(fsIo, VAULT, { asOf: '2026-04-12' });
const program = read.data.program;
const body = JSON.parse(readFileSync(join(VAULT, '3-Personal/Fitness/body-data.json'), 'utf8'));

describe('the body record from the plan', () => {
  it('lays the tape every second Sunday, photos at each deload week\'s end, tests in the phase-end deload week', () => {
    const occ = planOccurrences(program);
    assert.deepEqual(occ.tape.slice(0, 4), ['2026-03-15', '2026-03-29', '2026-04-12', '2026-04-26']);
    assert.deepEqual(occ.photos.slice(0, 3), ['2026-03-29', '2026-04-26', '2026-05-24']);
    assert.deepEqual(occ.tests.slice(0, 2), ['2026-04-25', '2026-06-20']);
  });

  it('a generated plan\'s test weeks (Week.tests) set the test dates', () => {
    const profile = JSON.parse(readFileSync(join(VAULT, '3-Personal/Fitness/Coach/profile.json'), 'utf8')) as Profile;
    const g = generatePlan({ profile, today: '2026-04-06', options: { start: '2026-04-06', weeks: 12 } }).value.program!;
    const flagged = g.macrocycle.phases.flatMap((p) => p.mesocycles.flatMap((m) => m.weeks)).filter((w) => w.tests).map((w) => w.start);
    assert.deepEqual(planOccurrences(g).tests, flagged.map((d) => new Date(Date.parse(d) + 5 * 86400000).toISOString().slice(0, 10)));
  });

  it('each part on a date: due until done or skipped, with what comes next', () => {
    const view = bodyRecordView(body, []);
    const rs = resolveSchedule({ schedule: 'plan' }, program, { tape: view.tape.at(-1)!, tests: view.tests.at(-1)! }, '2026-04-12');
    const sch = bodySchedule(rs, program, '2026-04-12', { hasTests: true, baselineSkipped: false });
    const tape = partStatus(sch.tape, view, {}, '2026-04-12');
    assert.deepEqual([tape.value.due, tape.value.occurrence, tape.value.inDays, tape.value.last], [true, '2026-04-12', 0, '2026-03-24']);
    assert.equal(tape.reason.rule, 'plan.calendar.tape');
    const photos = partStatus(sch.photos, view, {}, '2026-04-12');
    assert.deepEqual([photos.value.due, photos.value.occurrence, photos.value.schedule.afterCurrent], [true, '2026-03-29', '2026-04-26']);
    const skipped = partStatus(sch.photos, view, { 'photos:2026-03-29': '2026-03-29T08:00:00Z' }, '2026-04-12');
    assert.deepEqual([skipped.value.due, skipped.value.skipped, skipped.value.nextDate, skipped.value.inDays], [false, true, '2026-04-26', 14]);
    const folder = partStatus(sch.photos, bodyRecordView(body, ['2026-03-30']), {}, '2026-04-12');
    assert.equal(folder.value.done, true);
    const tests = partStatus(sch.tests, view, {}, '2026-04-12');
    assert.deepEqual([tests.value.due, tests.value.occurrence, tests.value.nextDate], [false, null, '2026-04-25']);
  });
});

describe('the body record every N days', () => {
  it('continues Habit Nudges\' dates: tape and photos every 14 days, tests every 28', () => {
    const rs = resolveSchedule({ schedule: 'fixed', tapeFrom: '2026-09-30', tapeEvery: 14, testsFrom: '2026-10-21', testsEvery: 28 }, program, { tape: null, tests: null }, '2026-11-02');
    const sch = bodySchedule(rs, program, '2026-11-02', { hasTests: true, baselineSkipped: false });
    assert.deepEqual([sch.tape.current, sch.tape.next, sch.photos.current, sch.tests.current, sch.tests.next], ['2026-10-28', '2026-11-11', '2026-10-28', '2026-10-21', '2026-11-18']);
    assert.equal(sch.tape.reason.rule, 'settings.body-record');
    assert.equal(sch.tape.text, 'Every 14 days from Wed 30 Sep');
  });

  it('with no tests on record the first ones are the baseline, due now, until skipped', () => {
    const rs = resolveSchedule(null, null, { tape: '2026-03-24', tests: null }, '2026-04-12');
    assert.equal(rs.source, 'fixed');
    assert.equal(rs.tapeFrom, '2026-03-24');
    const sch = bodySchedule(rs, null, '2026-04-12', { hasTests: false, baselineSkipped: false });
    assert.equal(sch.tests.current, 'baseline');
    const st = partStatus(sch.tests, bodyRecordView({ tests: [] }), {}, '2026-04-12');
    assert.deepEqual([st.value.due, st.value.nextDate], [true, '2026-04-12']);
    assert.equal(bodySchedule(rs, null, '2026-04-12', { hasTests: false, baselineSkipped: true }).tests.current, '2026-04-12');
  });

  it('set to follow the plan without one: every N days, and says so', () => {
    const rs = resolveSchedule({ schedule: 'plan' }, null, { tape: null, tests: null }, '2026-04-12');
    assert.equal(rs.source, 'fixed');
    assert.match(rs.note!, /no plan/);
  });
});

describe('desk breaks', () => {
  it('break times: from the start, every N minutes, while a break still fits', () => {
    assert.deepEqual(deskTimes({ every: 90, from: '10:00', to: '15:00', minutes: 5 }), ['10:00', '11:30', '13:00', '14:30']);
    assert.deepEqual(deskTimes({ every: 60, from: '09:00', to: '11:00', minutes: 5 }), ['09:00', '10:00']);
  });

  it('this vault\'s plan: plan-data\'s deskRoutine on Habit Nudges\' timing, the how-to from the guide', () => {
    const d = program.deskBreaks!;
    assert.deepEqual(d, { steps: [{ name: 'Doorway chest stretch', dose: '2 × 30 s', how: d.steps[0]!.how }], every: 90, from: '10:00', to: '15:00', minutes: 5, days: ['mon', 'tue', 'wed', 'thu', 'fri'] });
    assert.deepEqual(validateProgram({ ...program, _planData: undefined }), []);
    assert.equal(deskBreaksFromPlanData([], {}), null);
    assert.equal(deskBreaksFromPlanData([{ name: 'chin tuck', dose: '×10' }], { 'Chin Tuck': { do: 'Glide back.' } })!.steps[0]!.how, 'Glide back.');
  });

  it('an item that follows the plan takes its routine; one that doesn\'t, its own', () => {
    const item = { id: 'desk', desk: { followPlan: true, every: 60, from: '09:00', to: '12:00', minutes: 5 } };
    const r = deskRoutine(item, program);
    assert.deepEqual([r.value.source, r.value.every, r.value.times.length], ['plan', 90, 4]);
    assert.match(r.reason.note!, /From your plan: every 90 min from 10:00 to 15:00 on weekdays/);
    const own = deskRoutine({ ...item, desk: { ...item.desk, followPlan: false } }, program);
    assert.deepEqual([own.value.source, own.value.times], ['item', ['09:00', '10:00', '11:00']]);
    assert.equal(own.value.steps.length, 5);
    assert.match(deskRoutine(item, null).reason.note!, /No desk breaks in this plan/);
    assert.match(planDeskBreaks(null).reason.note!, /No desk breaks in this plan/);
  });

  it('the generator proposes them for desk work only, and the exporter writes the routine', () => {
    const profile = JSON.parse(readFileSync(join(VAULT, '3-Personal/Fitness/Coach/profile.json'), 'utf8')) as Profile;
    assert.equal(deskBreaksFor(profile).value, null);
    const desk: Profile = { ...profile, work: { desk: true, sittingHours: 8 }, emphasis: [{ area: 'Posture', seen: 'Forward head and rounded shoulders', confidence: 'medium', emphasis: 'Upper back', kind: 'forward-head-rounded-shoulders' }] };
    const d = deskBreaksFor(desk);
    assert.deepEqual(d.value!.why, [{ what: 'Desk job, about 8 hours seated', from: 'intake' }, { what: 'Forward head and rounded shoulders', from: 'the body assessment' }]);
    assert.equal(d.value!.steps[2]!.name, profile.equipment.some((e) => /band/i.test(e)) ? 'Band Pull-Apart' : 'Wall slides');
    const g = generatePlan({ profile: desk, today: '2026-04-06', options: { start: '2026-04-06', weeks: 12 } }).value.program!;
    assert.deepEqual(g.deskBreaks, d.value);
    assert.deepEqual(validateProgram(g), []);
    const pd = toPlanData(g, { date: '2026-04-13' }).value;
    assert.deepEqual(pd.planData.deskRoutine, d.value!.steps.map((s) => ({ name: s.name, dose: s.dose })));
    assert.deepEqual(pd.planData.deskTiming, { every: 90, from: '10:00', to: '15:00', minutes: 5, days: ['mon', 'tue', 'wed', 'thu', 'fri'] });
    assert.deepEqual(Object.keys(pd.planData).slice(Object.keys(pd.planData).indexOf('deskRoutine'), Object.keys(pd.planData).indexOf('deskRoutine') + 2), ['deskRoutine', 'deskTiming']);
    assert.ok(!pd.unexpressible.some((u) => u.what === 'desk-break times'), 'the times have a field now');
    assert.ok(pd.unexpressible.some((u) => u.what === 'desk-break reasons'));
    assert.equal(generatePlan({ profile, today: '2026-04-06', options: { start: '2026-04-06', weeks: 12 } }).value.program!.deskBreaks, undefined);
  });
});

describe('desk breaks on the plan\'s times (plan-data\'s deskTiming)', () => {
  const PLAN = 'v/3-Personal/Fitness/plan-data.json';
  const NINE_TO_FIVE = { every: 90, from: '09:00', to: '17:00' };
  const files = (timing: unknown, edit: (p: Record<string, unknown>) => void = () => {}) => {
    const f = fixtureFiles('v');
    const p = JSON.parse(f[PLAN]!) as Record<string, unknown>;
    if (timing !== undefined) p['deskTiming'] = timing;
    edit(p);
    f[PLAN] = JSON.stringify(p, null, 2);
    return f;
  };
  const vault = (f: Record<string, string>, date = '2026-04-10') => readVault(memoryIo(f, date), 'v', { asOf: date });

  it('reads the times, with a warning for each part it cannot use; left out, Habit Nudges\' times', () => {
    assert.deepEqual(deskTimingFromPlanData(undefined), { timing: {}, warnings: [] });
    assert.deepEqual(deskTimingFromPlanData({ ...NINE_TO_FIVE, minutes: 4, days: ['fri', 'mon'] }), { timing: { every: 90, from: '09:00', to: '17:00', minutes: 4, days: ['mon', 'fri'] }, warnings: [] });
    const bad = deskTimingFromPlanData({ every: 0, from: '9:00', to: '17:00' });
    assert.deepEqual(bad.timing, {});
    assert.match(bad.warnings[0]!, /deskTiming: every is 0, not a whole number of minutes; from is "9:00", not HH:MM\. The desk breaks run on the usual times \(every 90 min from 10:00 to 15:00\)/);
    assert.match(deskTimingFromPlanData({ every: 60, from: '12:00', to: '12:03' }).warnings[0]!, /12:00 to 12:03 holds no break/);
    assert.match(deskTimingFromPlanData({ every: 60, from: '15:00', to: '09:00' }).warnings[0]!, /15:00 to 09:00 holds no break/);
    const parts = deskTimingFromPlanData({ ...NINE_TO_FIVE, minutes: 'five', days: ['monday'] });
    assert.deepEqual(parts.timing, NINE_TO_FIVE, 'a bad minutes or days keeps only that default');
    assert.equal(parts.warnings.length, 2);
    assert.match(deskTimingFromPlanData([90]).warnings[0]!, /is not \{every, from, to\}/);
    assert.deepEqual(deskBreaksFromPlanData([{ name: 'Walk', dose: '1 min' }], {}, {})!.every, NUDGES_DESK_TIMING.every);
  });

  it('a 9-to-5 plan: breaks to 16:30, and the item that follows the plan runs on them, not its own times', () => {
    const read = vault(files(NINE_TO_FIVE));
    const d = read.data.program.deskBreaks!;
    assert.deepEqual([d.every, d.from, d.to, d.minutes, d.days], [90, '09:00', '17:00', 5, ['mon', 'tue', 'wed', 'thu', 'fri']]);
    assert.deepEqual(deskTimes(d), ['09:00', '10:30', '12:00', '13:30', '15:00', '16:30']);
    assert.ok(!read.data.warnings.some((w) => /deskTiming/.test(w.message)));
    const item = { id: 'desk-breaks', desk: { followPlan: true, every: 90, from: '10:00', to: '15:00', minutes: 5 } };
    const r = deskRoutine(item, read.data.program);
    assert.deepEqual([r.value.source, r.value.times.at(-1), r.value.from, r.value.to], ['plan', '16:30', '09:00', '17:00']);
    assert.match(r.reason.note!, /From your plan: every 90 min from 09:00 to 17:00 on weekdays/);
    const own = deskRoutine({ ...item, desk: { ...item.desk, followPlan: false } }, read.data.program);
    assert.deepEqual(own.value.times, ['10:00', '11:30', '13:00', '14:30'], 'an item with its own times keeps them');
    assert.deepEqual(planDeskBreaks(read.data.program).reason.note, '7 steps, about 5 min, every 90 min from 09:00 to 17:00 on weekdays; 6 a day.'.replace('7 steps', `${d.steps.length} steps`));
    assert.deepEqual(validateProgram({ ...read.data.program, _planData: undefined }), []);
  });

  it('the plan\'s days and break length; a bad deskTiming is a data note and the usual times', () => {
    const read = vault(files({ every: 60, from: '08:30', to: '12:00', minutes: 10, days: ['tue', 'thu'] }));
    const d = read.data.program.deskBreaks!;
    assert.deepEqual([deskTimes(d), d.days], [['08:30', '09:30', '10:30', '11:30'], ['tue', 'thu']], 'the 11:30 break still ends by 12:00');
    assert.match(planDeskBreaks(read.data.program).reason.note!, /about 10 min, every 60 min from 08:30 to 12:00 on Tue, Thu; 4 a day/);
    const bad = vault(files({ every: 90, from: '09:00' }));
    assert.deepEqual([bad.data.program.deskBreaks!.from, bad.data.program.deskBreaks!.to], ['10:00', '15:00']);
    assert.ok(bad.data.warnings.some((w) => w.code === 'plan-data' && /deskTiming: to is null, not HH:MM/.test(w.message)));
    const none = vault(files(NINE_TO_FIVE, (p) => delete p['deskRoutine']));
    assert.equal(none.data.program.deskBreaks, undefined);
    assert.ok(none.data.warnings.some((w) => /a deskTiming but no deskRoutine steps/.test(w.message)));
  });

  it('tracked and due follow the plan\'s times: after a 15:00 break, the 16:30 one is due, and Due today counts six', () => {
    // The day's last break answered at 15:00 (made up here).
    const answered = (f: Record<string, string>) => {
      const n = JSON.parse(f['v/3-Personal/Fitness/Coach/nudges.json']!);
      n.days['2026-04-10']['desk:desk-breaks'] = { lastAt: '2026-04-10T15:00:00.000Z', by: 'Work Mac' };
      f['v/3-Personal/Fitness/Coach/nudges.json'] = JSON.stringify(n);
      return f;
    };
    const due = (f: Record<string, string>) => buildDue(vault(f).data, readTracking(memoryIo(f, '2026-04-10'), 'v'), momentAt('2026-04-10', '16:35', 0));
    const f = answered(files(NINE_TO_FIVE));
    const desk = buildTracked(vault(f).data, readTracking(memoryIo(f, '2026-04-10'), 'v'), '2026-04-10').items.find((x) => x.id === 'desk-breaks')!;
    assert.deepEqual([desk.when, desk.desk!.source, desk.desk!.times.length], ['09:00 to 17:00, from your plan', 'plan', 6]);
    const late = due(f);
    assert.ok(late.due.value.cards.some((c) => c.key === 'desk:desk-breaks'), 'a card after 15:00, inside the plan\'s window');
    assert.deepEqual(late.today.value.desk.map((x) => [x.total, x.times.at(-1), x.next]), [[6, '16:30', '16:30']]);
    const usual = due(answered(fixtureFiles('v')));
    assert.ok(!usual.due.value.cards.some((c) => c.key === 'desk:desk-breaks'), 'without deskTiming the last break is 14:30, as before');
    assert.deepEqual(usual.today.value.desk.map((x) => [x.total, x.next]), [[4, null]]);
  });

  it('an item that follows the plan shows the plan\'s hours, not its own stale ones, and says so: tracked, Habits, the routine', () => {
    // The item keeps 10:00 to 15:00 of its own (Habit Nudges' times); the plan's deskTiming runs to 16:30.
    const TRACKING = 'v/3-Personal/Fitness/Coach/tracking.json';
    const f = files({ every: 90, from: '10:00', to: '16:30' });
    const before = f[TRACKING];
    const read = vault(f);
    const tr = readTracking(memoryIo(f, '2026-04-10'), 'v');
    assert.deepEqual(tr.tracking!.items.find((x) => x.id === 'desk-breaks')!.desk, { followPlan: true, every: 90, from: '10:00', to: '15:00', minutes: 5 });
    const t = buildTracked(read.data, tr, '2026-04-10').items.find((x) => x.id === 'desk-breaks')!;
    assert.deepEqual([t.when, t.asks], ['10:00 to 16:30, from your plan', 'about 5 min, every 90 min, 10:00 to 16:30, from your plan']);
    const h = buildHabitsScreen(read, tr, '2026-04-10').items.find((x) => x.id === 'desk-breaks')!;
    assert.deepEqual([h.when, h.desk], ['10:00 to 16:30, from your plan', { every: 90, from: '10:00', to: '16:30', times: ['10:00', '11:30', '13:00', '14:30', '16:00'], source: 'plan' }]);
    const row = buildRoutine(read, tr, '2026-04-10').value.groups.flatMap((g) => g.rows).find((r) => r.items?.includes('desk-breaks'))!;
    assert.match(row.what, /desk breaks 10:00 to 16:00 \(from your plan\)/);
    assert.match(row.reason.note!, / Desk breaks: from your plan, every 90 min from 10:00 to 16:30\.$/);
    // A desk-break suggestion that follows the plan reads the same.
    const sg = { ...tr.tracking!.items.find((x) => x.id === 'desk-breaks')!, id: 'posture-breaks', name: 'Posture breaks' };
    assert.equal(suggestionDetail(sg, read.data.program), 'about 5 min, every 90 min, 10:00 to 16:30, from your plan');
    assert.equal(f[TRACKING], before, 'the user\'s file is read, never rewritten');

    // Its own times: shown as they are, with nothing about the plan.
    const own = (x: Record<string, string>) => {
      const doc = JSON.parse(x[TRACKING]!);
      doc.items.find((i: { id: string }) => i.id === 'desk-breaks').desk.followPlan = false;
      x[TRACKING] = JSON.stringify(doc);
      return x;
    };
    const g = own(files({ every: 90, from: '10:00', to: '16:30' }));
    const ownRead = vault(g);
    const ownTr = readTracking(memoryIo(g, '2026-04-10'), 'v');
    const o = buildTracked(ownRead.data, ownTr, '2026-04-10').items.find((x) => x.id === 'desk-breaks')!;
    assert.deepEqual([o.when, o.asks], ['10:00 to 15:00', 'about 5 min, every 90 min, 10:00 to 15:00']);
    assert.equal(buildHabitsScreen(ownRead, ownTr, '2026-04-10').items.find((x) => x.id === 'desk-breaks')!.when, '10:00 to 15:00');
    const ownRow = buildRoutine(ownRead, ownTr, '2026-04-10').value.groups.flatMap((x) => x.rows).find((r) => r.items?.includes('desk-breaks'))!;
    assert.match(ownRow.what, /desk breaks 10:00 to 14:30(,|$)/);
    assert.doesNotMatch(`${ownRow.what} ${ownRow.reason.note}`, /from your plan/);
  });

  it('the exporter keeps a vault plan\'s deskTiming where it was; a generated plan\'s reads back the same', () => {
    const f = files({ ...NINE_TO_FIVE, days: ['mon', 'tue', 'wed', 'thu'] });
    const read = vault(f);
    const out = toPlanData(read.data.program, { date: '2026-04-10' }).value.planData;
    assert.deepEqual(out.deskTiming, { ...NINE_TO_FIVE, days: ['mon', 'tue', 'wed', 'thu'] });
    assert.deepEqual(Object.keys(out), Object.keys(JSON.parse(f[PLAN]!)));
    const profile = JSON.parse(readFileSync(join(VAULT, '3-Personal/Fitness/Coach/profile.json'), 'utf8')) as Profile;
    const g = generatePlan({ profile: { ...profile, work: { desk: true, sittingHours: 8 } }, today: '2026-04-06', options: { start: '2026-04-06', weeks: 12 } }).value.program!;
    const gen = toPlanData(g, { date: '2026-04-13' }).value.planData;
    const back = vault(files(undefined, (p) => Object.assign(p, { deskRoutine: gen.deskRoutine, deskTiming: gen.deskTiming })));
    const { why: _why, ...timed } = g.deskBreaks!;
    assert.deepEqual({ ...back.data.program.deskBreaks!, steps: timed.steps }, timed);
    // A generated plan without desk breaks carries the base file's, as it does its routine.
    const base = { ...(JSON.parse(f[PLAN]!) as PlanData) };
    assert.deepEqual(toPlanData(generatePlan({ profile, today: '2026-04-06', options: { start: '2026-04-06', weeks: 12 } }).value.program!, { base }).value.planData.deskTiming, base.deskTiming);
  });
});

describe('sitting time per day', () => {
  const log = JSON.parse(readFileSync(join(VAULT, '3-Personal/Fitness/Coach/sitting.json'), 'utf8')) as SittingLog;
  const timer = JSON.parse(readFileSync(join(VAULT, '5-System/Data/work-timer-data.json'), 'utf8'));

  it('joins every Mac\'s stretches (an overlap counts once) and finds the longest', () => {
    const d = summarizeDay('2026-04-10', stretchesOn(log, '2026-04-10'), 'pahlavan');
    // 47 + 101 + 50 minutes on the work Mac; the home Mac's 10:30-10:50 overlaps 09:00-10:41, so that one runs to 10:50.
    assert.deepEqual(d, { date: '2026-04-10', minutes: 207, longest: 110, stretches: 3, source: 'pahlavan' });
    assert.deepEqual(unionStretches([{ start: 0, end: 10 }, { start: 5, end: 20 }, { start: 30, end: 40 }]), [{ start: 0, end: 20 }, { start: 30, end: 40 }]);
  });

  it('counts the stretch running now in full, in place of its last written copy', () => {
    const live = { mac: 'Work Mac', stretch: { start: Date.parse('2026-04-10T11:10:00.000Z'), end: Date.parse('2026-04-10T12:30:00.000Z') } };
    assert.equal(summarizeDay('2026-04-10', stretchesOn(log, '2026-04-10', live), 'pahlavan').minutes, 237);
  });

  it('desk time\'s history fills the days Pahlavan did not count (its auto sessions only, a minute or more)', () => {
    const history = deskTimeHistory(timer, fixedOffsetClock(0));
    assert.deepEqual([...history.keys()], ['2026-03-30', '2026-03-31', '2026-04-06']);
    const days = sittingDays(log, history, '2026-03-30', '2026-04-06');
    assert.deepEqual(days.map((d) => [d.date, d.minutes, d.source]), [
      ['2026-03-30', 480, 'desk-time'],
      ['2026-03-31', 40, 'desk-time'],
      ['2026-04-01', 0, 'none'],
      ['2026-04-02', 0, 'none'],
      ['2026-04-03', 0, 'none'],
      ['2026-04-04', 0, 'none'],
      ['2026-04-05', 0, 'none'],
      ['2026-04-06', 420, 'pahlavan'],
    ]);
  });

  it('a day against the limits, with the reason', () => {
    const v = sittingVerdict({ date: '2026-04-09', minutes: 390, longest: 50, stretches: 4, source: 'pahlavan' }, { limitMinutes: 360, stretchMaxMinutes: 45, awayMinutes: 5 });
    assert.deepEqual(v.value, { overLimit: true, overStretch: true, over: 2 });
    assert.match(v.reason.note!, /Over the 6 h limit; a stretch over 45 min/);
  });
});

describe('stand-up helpers', () => {
  const c = { sitMinutes: 30, standMinutes: 20, snoozeMinutes: 10, targetMinutes: 120, hours: ['09:00', '17:30'] as [string, string], pauseCalls: true, activeOnly: true, activeSeconds: 120, awayMinutes: 30, standAwayMinutes: 5 };

  it('maps the item to the step\'s settings; "count only while active" off counts until away resets', () => {
    assert.deepEqual(standConfig(c), { sitMinutes: 30, standMinutes: 20, activeSeconds: 120, awayMinutes: 30, standAwayMinutes: 5, countAway: true });
    assert.equal(standConfig({ ...c, activeOnly: false }).activeSeconds, 1800);
    assert.equal(standMeeting(c, true), true);
    assert.equal(standMeeting({ ...c, pauseCalls: false }, true), false);
    assert.equal(standMeeting(c, null), false);
  });

  it('a stand away from the desk counts: no input and a sleeping Mac still run its minutes (Habit Nudges’ rule abandons it)', async () => {
    const { standStep } = await import('../src/core/standup.ts');
    const cfg = standConfig(c);
    const T = Date.UTC(2026, 3, 10, 10);
    let st = { phase: 'standing' as const, satMs: 0, stoodMs: 0, snoozedUntil: 0, snoozeUsed: false };
    // Ten minutes away from the keyboard: still standing, ten minutes counted.
    let r = standStep(st, { now: T + 10 * 60_000, gapMs: 30_000, idleS: 600, meeting: false }, cfg);
    assert.equal(r.event, null);
    st = { ...r.st, stoodMs: 10 * 60_000 } as typeof st;
    // The Mac asleep for 15 minutes: the gap counts, and the stand is done.
    r = standStep(st, { now: T + 25 * 60_000, gapMs: 15 * 60_000, idleS: 900, meeting: false }, cfg);
    assert.equal(r.event, 'finished');
    // Habit Nudges' own rule, for the golden port: five minutes without input ends it uncounted.
    assert.equal(standStep({ phase: 'standing' }, { now: T, gapMs: 30_000, idleS: 301, meeting: false }, { ...cfg, countAway: false }).event, 'abandoned');
  });

  it('runs inside its hours only (all day without them)', () => {
    assert.equal(inStandHours(c, momentAt('2026-04-10', '08:59')), false);
    assert.equal(inStandHours(c, momentAt('2026-04-10', '09:00')), true);
    assert.equal(inStandHours(c, momentAt('2026-04-10', '17:30')), false);
    assert.equal(inStandHours({ ...c, hours: undefined }, momentAt('2026-04-10', '23:00')), true);
  });

  it('answers: stand now, the one snooze, ask me now; the progress', () => {
    const due = { ...STAND_FRESH, phase: 'due' as const, satMs: 30 * 60000 };
    assert.deepEqual(standAnswer(due, 'stand', 1000, 10), { ...due, phase: 'standing', stoodMs: 0 });
    assert.deepEqual(standAnswer(due, 'snooze', 1000, 10), { ...due, phase: 'sitting', snoozeUsed: true, snoozedUntil: 601000 });
    assert.deepEqual(standAskNow({ ...STAND_FRESH, satMs: 60000 }, c), { ...STAND_FRESH, phase: 'due', satMs: 1800000 });
    assert.deepEqual(standProgress({ ...STAND_FRESH, satMs: 12 * 60000 }, c), { phase: 'sitting', satMinutes: 12, sitLeft: 18, standLeft: null, snoozeAvailable: true });
    assert.equal(standProgress({ ...STAND_FRESH, phase: 'standing', stoodMs: 19.5 * 60000 }, c).standLeft, 1);
  });
});
