// A timed item read from plan-data's fields, not its note: an interval item's
// sets are its rounds with the structure (`timed`) beside them, never its
// minutes halved ("sets: 11" for 22 minutes); the time estimate counts the
// warm-up, the rounds, the easy minutes between and the cool-down; and in
// the calibration week the intervals are easy steady minutes by rule
// (plan.calibration.cardio), with no week-1 text in the note. An item
// written before the fields (minutes in its sr, the intervals in its note)
// is read the same way. The log keeps its own count of a timed line (a set
// per 2 minutes), written and read back as before.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildLogEntry } from '../src/adapters/vault/log-write.ts';
import { readVault } from '../src/adapters/vault/read.ts';
import { planText } from '../src/report/dashboard.ts';
import { calibrateTimed, calibrateTimedSlot, calibrationCardioNote } from '../src/core/calibration.ts';
import { halfTimed, timedFromText, timedMinutes, timedText } from '../src/core/timed.ts';
import { buildPlan, buildReview, buildSession, inputFromForm, logFormFor } from '../src/report/index.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

type Json = Record<string, any>;
const PLAN = 'v/3-Personal/Fitness/plan-data.json';
const LOG = 'v/3-Personal/Fitness/fitness-log-data.json';
const WEEK_1 = '2026-03-07'; // the synthetic plan starts on Monday 2 March: its calibration week
const LATER = '2026-04-10'; // plan week 6, a loading week

/** The structure as fields: 3 min warm-up, 4 × 4 min hard with 3 min easy between, 2 min cool-down (30 min); a note with no week-1 text. */
const FIELDS = { name: 'Bike intervals, 4 x 4 min', table: 'Bike intervals', sr: '30 min', rest: '—', timed: { minutes: 30, rounds: 4, workMin: 4, restMin: 3, warmupMin: 3, cooldownMin: 2 }, note: 'Hard on the work, easy between. Why: conditioning.', label: 'Intervals' };
/** As plans wrote it before the fields: the minutes in sr (which disagree with the note), the intervals in the note. */
const OLD = { name: 'Uphill walk or run intervals, 4 x 4 min', table: 'Uphill intervals', sr: '22 min', rest: '—', note: '4 × 4 min hard, 3 min easy between, warm-up and cool-down easy. Why: you chose intervals.', label: 'Intervals' };

/** The synthetic vault with a short session S2 of one interval item. */
function vault(item: Json, date: string, edit?: (f: Record<string, string>) => void) {
  const f = fixtureFiles('v');
  const doc = JSON.parse(f[PLAN]!);
  doc.shortTypes = ['S1', 'S2', 'S3'];
  doc.titles = { ...doc.titles, S2: 'Intervals' };
  doc.sessions.S2 = [item];
  f[PLAN] = `${JSON.stringify(doc, null, 2)}\n`;
  edit?.(f);
  return { files: f, read: readVault(memoryIo(f, date), 'v', { asOf: date }) };
}
const s2 = (item: Json, date: string, mode: 'full' | 'express' = 'full') => {
  const s = buildSession(vault(item, date).read.data, date, mode, { type: 'S2' });
  assert.equal(s.session?.type, 'S2');
  return s.items[0]!;
};

describe('the timed structure, counted and said', () => {
  it('reads intervals from an old note, its warm-up and cool-down when the note gives minutes; never from sets or rounds', () => {
    assert.deepEqual(timedFromText('22 min', OLD.note), { minutes: 22, rounds: 4, workMin: 4, restMin: 3 });
    assert.deepEqual(timedFromText('35 min', '5 min warm-up, then 4 x 4 min hard, 3 min easy between; cool-down 5 min.'), { minutes: 35, rounds: 4, workMin: 4, restMin: 3, warmupMin: 5, cooldownMin: 5 });
    assert.deepEqual(timedFromText('20 min', 'Easy.'), { minutes: 20 });
    assert.equal(timedFromText('3 × 8–12', 'RIR 2.'), null);
    assert.equal(timedFromText('4 rounds, 40/20', '4 rounds × (40 s on / 20 s off per move) = 8 min.'), null);
  });

  it('warm-up + rounds × work + (rounds − 1) × rest + cool-down; with neither given, the item’s minutes when they hold more', () => {
    assert.equal(timedMinutes(FIELDS.timed), 30);
    assert.equal(timedMinutes({ rounds: 4, workMin: 4, restMin: 3 }), 25);
    assert.equal(timedMinutes({ minutes: 22, rounds: 4, workMin: 4, restMin: 3 }), 25, 'never less than the intervals');
    assert.equal(timedMinutes({ minutes: 30, rounds: 4, workMin: 4, restMin: 3 }), 30, 'the easy time around them');
    assert.equal(timedMinutes({ minutes: 20 }), 20);
    assert.equal(timedText(FIELDS.timed), '3 min easy warm-up, 4 × 4 min hard, 3 min easy between, 2 min easy cool-down · about 30 min');
    assert.equal(timedText({ minutes: 30, rounds: 4, workMin: 4, restMin: 3 }), '4 × 4 min hard, 3 min easy between, easy before and after · about 30 min');
    assert.equal(timedText({ minutes: 20 }), '20 min');
    assert.deepEqual(halfTimed(FIELDS.timed), { minutes: 15, rounds: 2, workMin: 4, restMin: 3, warmupMin: 2, cooldownMin: 1 });
  });

  it('the calibration rule: intervals become easy steady minutes, the same total; steady minutes and sets are left alone', () => {
    const c = calibrateTimed(FIELDS.timed)!;
    assert.deepEqual(c.value, { minutes: 30 });
    assert.equal(c.reason.rule, 'plan.calibration.cardio');
    assert.equal(c.reason.note, 'Calibration week: 30 min easy, conversational; the intervals start in week 2 (planned: 3 min easy warm-up, 4 × 4 min hard, 3 min easy between, 2 min easy cool-down · about 30 min).');
    assert.equal(calibrateTimed({ minutes: 20 }), null);
    assert.equal(calibrateTimed(undefined), null);
    assert.match(calibrateTimed(FIELDS.timed, 'restart')!.reason.note!, /^Calibration week \(back after time off\): 30 min easy, conversational; the intervals come back next week/);
    const slot = { exercise: 'x', sets: 4, repRange: [1, 1] as [number, number], rir: 3, timed: FIELDS.timed };
    assert.deepEqual(calibrateTimedSlot(slot), { ...slot, sets: 1, timed: { minutes: 30 }, note: 'Calibration week: 30 min easy, conversational; the intervals start in week 2.' });
    const steady = { ...slot, sets: 1, timed: { minutes: 20 } };
    assert.equal(calibrateTimedSlot(steady), steady);
  });
});

describe('session: sets are the rounds, with the structure beside them', () => {
  it('fields: 4 sets for 4 rounds, the structure in words, the plan’s sr', () => {
    const it = s2(FIELDS, LATER);
    assert.equal(it.sets, 4);
    assert.equal(it.sr, '30 min');
    assert.deepEqual(it.timed, { ...FIELDS.timed, text: '3 min easy warm-up, 4 × 4 min hard, 3 min easy between, 2 min easy cool-down · about 30 min' });
    assert.ok(!it.adjustments.some((a) => a.rule === 'plan.calibration.cardio'));
  });

  it('an old item: 4 sets, not 11, and its intervals counted at 25 minutes (its "22 min" is less than they take)', () => {
    const it = s2(OLD, LATER);
    assert.equal(it.sets, 4);
    assert.deepEqual(it.timed, { minutes: 25, rounds: 4, workMin: 4, restMin: 3, text: '4 × 4 min hard, 3 min easy between · about 25 min' });
    assert.equal(it.cue, '4 × 4 min hard, 3 min easy between, warm-up and cool-down easy.');
  });

  it('the time estimate counts the intervals (review, the session’s planned minutes)', () => {
    const { read } = vault(FIELDS, LATER);
    const t = buildReview(read.data, LATER).time.sessions.find((x) => x.type === 'S2')!;
    // The plan's short warm-up line ("1 min jumping jacks") and the item's 30 minutes.
    assert.equal(t.estimate.value.minutes, 31);
    assert.deepEqual(t.estimate.value.items.map((x) => [x.minutes, x.how]), [[30, '3 min easy warm-up, 4 × 4 min hard, 3 min easy between, 2 min easy cool-down']]);
    const old = buildReview(vault(OLD, LATER).read.data, LATER).time.sessions.find((x) => x.type === 'S2')!;
    assert.equal(old.estimate.value.items[0]!.minutes, 25);
    assert.match(old.estimate.reason.note!, /25 min of Uphill walk or run intervals, 4 x 4 min \(4 × 4 min hard, 3 min easy between\)/);
  });

  it('Express halves the rounds and keeps the work and rest', () => {
    const it = s2(FIELDS, LATER, 'express');
    assert.equal(it.sets, 2);
    assert.equal(it.timed!.text, '2 min easy warm-up, 2 × 4 min hard, 3 min easy between, 1 min easy cool-down · about 14 min');
    assert.equal(it.sr, '14 min');
    assert.match(it.adjustments.find((a) => a.rule === 'variant.express')!.note!, /^2 min easy warm-up, 2 × 4 min hard.* instead of 3 min easy warm-up, 4 × 4 min hard/);
  });

  it('the Plan screen: the slot’s sets are its rounds, with the structure', () => {
    const { read } = vault(FIELDS, LATER);
    const p = buildPlan(read, LATER) as Json;
    const slot = p.templates.find((t: Json) => t.type === 'S2').slots[0];
    assert.deepEqual([slot.sets, slot.sr, slot.timed.text], [4, '30 min', '3 min easy warm-up, 4 × 4 min hard, 3 min easy between, 2 min easy cool-down · about 30 min']);
  });
});

describe('the calibration week: intervals as easy steady minutes, by rule', () => {
  for (const [label, item, minutes] of [['fields', FIELDS, 30], ['an old note-only item', OLD, 25]] as const) {
    it(`${label}: one easy block of ${minutes} min, the rule’s line as the cue, no week-1 text needed`, () => {
      assert.doesNotMatch(item.note, /week 1|calibration/i);
      const it = s2(item, WEEK_1);
      assert.equal(it.sets, 1);
      assert.equal(it.sr, `${minutes} min`);
      assert.deepEqual(it.timed, { minutes, text: `${minutes} min` });
      assert.equal(it.cue, `${calibrationCardioNote()[0]!.toUpperCase()}${calibrationCardioNote().slice(1)}.`);
      assert.equal(it.cue, 'Easy, conversational; the intervals start in week 2.');
      const r = it.adjustments.find((a) => a.rule === 'plan.calibration.cardio')!;
      assert.equal(r.title, 'Calibration week');
      assert.match(r.note!, new RegExp(`^Calibration week: ${minutes} min easy, conversational; the intervals start in week 2 \\(planned: `));
    });
  }

  it('the first week back after 3+ weeks off: easy too, the intervals back the week after', () => {
    const date = '2026-05-06';
    const { read } = vault(FIELDS, date, (f) => {
      const log = JSON.parse(f[LOG]!);
      log.sessions.push({ date: '2026-05-04', type: 'B', lift1: { name: 'Romanian Deadlift', weight: 50, reps: 8, unit: 'kg' }, lift2: { name: 'Seated Cable Row', weight: 90, reps: 8, unit: 'lb' } });
      f[LOG] = JSON.stringify(log);
    });
    const it = buildSession(read.data, date, 'full', { type: 'S2' }).items[0]!;
    assert.deepEqual([it.sets, it.sr, it.cue], [1, '30 min', 'Easy, conversational; the intervals come back next week.']);
    assert.match(it.adjustments.find((a) => a.rule === 'plan.calibration.cardio')!.note!, /^Calibration week \(back after time off\): 30 min easy/);
  });

  it('Express in week 1: the easy minutes at half', () => {
    const it = s2(FIELDS, WEEK_1, 'express');
    assert.deepEqual([it.sets, it.sr, it.timed!.minutes], [1, '14 min', 14]);
    assert.ok(it.adjustments.some((a) => a.rule === 'plan.calibration.cardio'));
  });

  it('the Plan screen’s week 1 has the easy minutes too', () => {
    const { read } = vault(FIELDS, WEEK_1);
    const p = buildPlan(read, WEEK_1) as Json;
    const slot = p.templates.find((t: Json) => t.type === 'S2').slots[0];
    assert.deepEqual([slot.sets, slot.sr, slot.timed.text], [1, '30 min', '30 min']);
  });

  it('steady cardio and a lifting day’s finisher stay as planned', () => {
    const steady = s2({ ...OLD, sr: '20 min', note: 'Easy. Why: base.' }, WEEK_1);
    assert.deepEqual([steady.sets, steady.sr, steady.timed!.minutes], [1, '20 min', 20]);
    assert.ok(!steady.adjustments.some((a) => a.rule === 'plan.calibration.cardio'));
    const lift = buildSession(vault(FIELDS, WEEK_1).read.data, WEEK_1, 'full', { type: 'A' });
    assert.deepEqual(lift.finisher, { exercise: 'zone-2-finisher', name: 'Zone 2 finisher', sr: '5–10 min', timed: { minutes: 5, text: '5 min' } });
    assert.ok(!lift.flags.some((f) => f.rule === 'plan.calibration.cardio'));
    assert.ok(lift.flags.some((f) => f.rule === 'plan.calibration'));
    // A light week's finisher says its minutes, not a set count.
    const light = buildSession(vault(FIELDS, '2026-03-27').read.data, '2026-03-27', 'full', { type: 'A' });
    assert.equal('week' in light && light.week.deload, true);
    assert.deepEqual([light.finisher!.sr, light.finisher!.timed], ['5 min', { minutes: 5, text: '5 min' }]);
  });

  it('an interval finisher on a lifting day is easy that week too, said in the session’s flags', () => {
    const fin = { ...FIELDS, name: 'Zone 2 finisher', sr: '12 min', timed: { rounds: 3, workMin: 2, restMin: 2, warmupMin: 1, cooldownMin: 1 } };
    const { read } = vault(FIELDS, WEEK_1, (f) => {
      const doc = JSON.parse(f[PLAN]!);
      doc.sessions.A = doc.sessions.A.map((i: Json) => (i.name === 'Zone 2 finisher' ? fin : i));
      f[PLAN] = `${JSON.stringify(doc, null, 2)}\n`;
    });
    const lift = buildSession(read.data, WEEK_1, 'full', { type: 'A' });
    assert.deepEqual([lift.finisher!.sr, lift.finisher!.timed], ['12 min', { minutes: 12, text: '12 min' }]);
    assert.ok(lift.flags.some((f) => f.rule === 'plan.calibration.cardio'));
  });
});

describe('the log keeps its own count of a timed line', () => {
  it('a saved session writes the item as a set per 2 minutes, and the log reads back', () => {
    const { files, read } = vault(OLD, LATER);
    const form = logFormFor(read, buildSession(read.data, LATER, 'full', { type: 'S2' }), LATER)!;
    const entry = buildLogEntry(inputFromForm(form), { plan: read.raw!.plan, log: read.raw!.log, today: LATER });
    assert.ok(entry.ok, !entry.ok ? entry.error : '');
    assert.deepEqual(entry.entry['exercises'], [{ name: OLD.name, sets: 11 }]);
    // Merged into the log and read again: the snapshot keeps the log's count, and the session still builds.
    const log = JSON.parse(files[LOG]!);
    log.sessions.push(entry.entry);
    const again = readVault(memoryIo({ ...files, [LOG]: JSON.stringify(log) }, LATER), 'v', { asOf: LATER });
    const logged = again.data.sessions.find((s) => s.date === LATER && s.plan?.template === 's2')!;
    assert.deepEqual(logged.plan!.slots.map((x) => x.sets), [11]);
    assert.equal(buildSession(again.data, LATER, 'full', { type: 'S2' }).items[0]!.sets, 4);
  });

  it('Today’s copied plan says the intervals in words, and the week-1 easy version with its line', () => {
    const copy = (date: string) => {
      const { read } = vault(OLD, date);
      const session = buildSession(read.data, date, 'full', { type: 'S2' });
      return planText({ plan: read.raw!.plan, log: read.raw!.log, date, type: 'S2', express: false, deload: false, dayLabel: date, shortDay: (d) => d, session }).split('\n');
    };
    assert.ok(copy(LATER).includes(`2. ${OLD.name}: 4 × 4 min hard, 3 min easy between · about 25 min`));
    const first = copy(WEEK_1);
    const at = first.indexOf(`2. ${OLD.name}: 25 min`);
    assert.ok(at > 0, first.join('\n'));
    assert.equal(first[at + 1], '   Easy, conversational; the intervals start in week 2.');
  });

  it('the log panel says the structure in words, and the week-1 easy version with its line', () => {
    const later = vault(OLD, LATER).read;
    const row = logFormFor(later, buildSession(later.data, LATER, 'full', { type: 'S2' }), LATER)!.rows.find((r) => r.name === OLD.name)!;
    assert.deepEqual(row.timed, { text: '4 × 4 min hard, 3 min easy between · about 25 min', note: null });
    const first = vault(OLD, WEEK_1).read;
    const easy = logFormFor(first, buildSession(first.data, WEEK_1, 'full', { type: 'S2' }), WEEK_1)!.rows.find((r) => r.name === OLD.name)!;
    assert.deepEqual(easy.timed, { text: '25 min', note: 'Easy, conversational; the intervals start in week 2.' });
  });
});
