// Your routine (src/report/routine.ts) on the synthetic vault (Fri 10 Apr,
// plan week 6) and made-up variations: the Every day rows in the day's order
// (the morning card's time, a look at Today, each tracked item by its
// reminder time with close times in one row, the interval and desk kinds by
// the days they run, after training, "Did you train?", Any time last), the
// Sundays (the check-in and the letter, the tape on the plan's schedule),
// every four weeks (the light week, the phase end with its tests), a body
// record on its own schedule, no plan, and every line in plain words.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { readTracking } from '../src/adapters/vault/tracking-read.ts';
import { COACH_COMMANDS } from '../src/core/coach-steps.ts';
import { buildRoutine, CLOSE_MINUTES, ROUTINE_INTRO, type Routine, type RoutineRow } from '../src/report/routine.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

const DATE = '2026-04-10';
const TRK = 'v/3-Personal/Fitness/Coach/tracking.json';
type Files = Record<string, string>;
const editTracking = (f: Files, fn: (d: any) => void) => {
  const d = JSON.parse(f[TRK]!);
  fn(d);
  f[TRK] = JSON.stringify(d);
};
const item = (d: any, id: string) => d.items.find((x: { id: string }) => x.id === id);

function routine(opts: { date?: string; edit?: (f: Files) => void; didYouTrain?: { on: boolean; at: string } } = {}) {
  const date = opts.date ?? DATE;
  const files = fixtureFiles('v');
  opts.edit?.(files);
  const io = memoryIo(files, date);
  const r = buildRoutine(readVault(io, 'v', { asOf: date }), readTracking(io, 'v'), date, opts.didYouTrain ? { didYouTrain: opts.didYouTrain } : {});
  return r;
}
const rows = (v: Routine, id: string) => v.groups.find((g) => g.id === id)?.rows ?? [];
/** A row as the panel reads it: time · what [command] [next] · where. */
const line = (x: RoutineRow) => `${x.time} · ${x.what}${x.command ? ` ${x.command}` : ''}${x.next ? `${x.command ? '.' : ''} ${x.next}` : ''} · ${x.where}`;

describe('Your routine on the synthetic vault', () => {
  const r = routine();
  const v = r.value;

  it('the title, the intro and three groups', () => {
    assert.equal(v.title, 'Your routine');
    assert.equal(v.intro, ROUTINE_INTRO);
    assert.equal(v.intro, 'About five minutes a day in Pahlavan, plus the session. It changes when your plan or your items change.');
    assert.deepEqual(v.groups.map((g) => [g.id, g.title]), [['daily', 'Every day'], ['sunday', 'Sundays'], ['weeks', 'Every four weeks']]);
    assert.equal(r.reason.rule, 'routine');
  });

  it('every day, in the day’s order: each item by its card’s time, the interval and desk kinds by their days, the paused fish oil left out', () => {
    assert.deepEqual(rows(v, 'daily').map(line), [
      '07:30 · Morning check-in: energy, soreness, sleep, and the numbers from your watch or phone if you have them · Card',
      'Then · Look at Today: Readiness, and the session it adjusted for you · Today',
      '09:00 · Creatine 5 g, multivitamin 1 tablet · Card',
      'Through the day · Water every 2 h, the sitting card at 5 h 30 · Card',
      'Work days · Stand-ups, desk breaks 10:00 to 14:30 (from your plan) · Card',
      'After training · Log the session: the two logged lifts’ top sets and the minutes · Log session',
      'After training · Protein shake 30 g (training days) · Card',
      '20:00 · Protein · Card',
      '20:00 · Did you train? Only if nothing is logged · Card',
      '21:30 · Magnesium 300 mg, flossing · Card',
    ]);
    assert.deepEqual(rows(v, 'daily')[2]!.items, ['creatine', 'multivitamin']);
  });

  it('Sundays: the week’s questions and the letter’s command; the tape every second Sunday with its next date', () => {
    assert.deepEqual(rows(v, 'sunday').map(line), [
      `Every Sunday · The week’s questions, then ask the coach for the letter ${COACH_COMMANDS.checkin} · Check-in`,
      // The fixture's tape of Sun 29 Mar is not on record: still due, as Due today says.
      'Every second Sunday · The tape. Due since Sun 29 Mar · Body record',
    ]);
  });

  it('every four weeks: the next light week with the photos and the review, the phase end’s tests and review', () => {
    assert.deepEqual(rows(v, 'weeks').map(line), [
      `Light week · Lighter sessions; on its Sunday the photos, then ${COACH_COMMANDS.review}. Next: Mon 20 Apr to Sun 26 Apr · Plan`,
      `Phase end · The tests on Saturday, the review on Sunday: ${COACH_COMMANDS.review}. Next: Sat 25 Apr and Sun 26 Apr · Body record`,
    ]);
  });

  it('in plain words, each row with its reason', () => {
    for (const x of v.groups.flatMap((g) => g.rows)) {
      for (const t of [x.time, x.what, x.next ?? '']) {
        assert.doesNotMatch(t, /—|!/, t);
        assert.doesNotMatch(t, /deload/i, t);
        assert.doesNotMatch(t, /\broutine\.[a-z]/, t);
      }
      assert.match(x.reason.rule, /^routine\./);
      assert.ok(x.reason.note, `${x.time} has a note`);
    }
    // Nothing assumes the phone: the user types the numbers.
    assert.doesNotMatch(JSON.stringify(v), /shortcut|import|automation/i);
  });
});

describe('Your routine: the rows follow the user’s own items and times', () => {
  it('close times share a row ("21:00 to 22:00"); one more than an hour after the row’s first starts a new one', () => {
    const v = routine({ edit: (f) => editTracking(f, (d) => {
      item(d, 'protein').reminder.at = '21:00';
      item(d, 'magnesium').reminder.at = '22:00';
      item(d, 'flossing').reminder.at = '22:00';
      item(d, 'creatine').reminder.at = '07:45';
    }) }).value;
    const daily = rows(v, 'daily').map(line);
    assert.ok(daily.includes('21:00 to 22:00 · Protein, magnesium 300 mg, flossing · Card'), daily.join('\n'));
    assert.ok(daily.includes('07:45 · Creatine 5 g · Card') && daily.includes('09:00 · Multivitamin 1 tablet · Card'), '75 minutes apart: two rows');
    assert.equal(CLOSE_MINUTES, 60);
  });

  it('a name with a capital inside stays as it is, the others in lower case after the first', () => {
    const v = routine({ edit: (f) => editTracking(f, (d) => void (item(d, 'multivitamin').name = 'Vitamin D3')) }).value;
    assert.equal(rows(v, 'daily')[2]!.what, 'Creatine 5 g, Vitamin D3 1 tablet');
  });

  it('items without a reminder time go last, under Any time, ticked on Today', () => {
    const v = routine({ edit: (f) => editTracking(f, (d) => void delete item(d, 'magnesium').reminder) }).value;
    assert.equal(line(rows(v, 'daily').at(-1)!), 'Any time · Magnesium 300 mg · Today');
  });

  it('every interval and desk item on the same days shares one row (the mockup’s "Work day")', () => {
    const v = routine({ edit: (f) => editTracking(f, (d) => {
      for (const id of ['water', 'sitting']) item(d, id).schedule = { kind: 'weekdays', days: ['mon', 'tue', 'wed', 'thu', 'fri'] };
    }) }).value;
    assert.ok(rows(v, 'daily').map(line).includes('Work days · Water every 2 h, stand-ups, desk breaks 10:00 to 14:30 (from your plan), the sitting card at 5 h 30 · Card'));
  });

  it('the morning card off: in the morning, on Check-in; "Did you train?" at its own time, or not at all when off', () => {
    const off = routine({ edit: (f) => editTracking(f, (d) => void (d.morning = { on: false, at: '07:30' })), didYouTrain: { on: true, at: '21:00' } }).value;
    assert.deepEqual([rows(off, 'daily')[0]!.time, rows(off, 'daily')[0]!.where], ['Morning', 'Check-in']);
    assert.ok(rows(off, 'daily').map(line).includes('21:00 · Did you train? Only if nothing is logged · Card'));
    assert.ok(!rows(routine({ didYouTrain: { on: false, at: '20:00' } }).value, 'daily').some((x) => x.time === '20:00' && x.what.startsWith('Did you train')));
  });

  it('in a light week: "Now, until" its Sunday', () => {
    const v = routine({ date: '2026-04-22' }).value;
    assert.equal(rows(v, 'weeks')[0]!.next, 'Now, until Sun 26 Apr');
    assert.equal(rows(v, 'weeks')[1]!.next, 'Next: Sat 25 Apr and Sun 26 Apr');
  });

  it('the body record on its own schedule: the tape and photos, and the tests, every N days; the plan’s rows say so', () => {
    const v = routine({ edit: (f) => editTracking(f, (d) => void (d.bodyRecord = { schedule: 'fixed', tapeFrom: '2026-03-24', tapeEvery: 14, testsFrom: '2026-03-21', testsEvery: 28 })) }).value;
    assert.deepEqual(rows(v, 'own').map(line), ['Every 14 days · The tape and the photos. Due since Tue 7 Apr · Body record', 'Every 28 days · The tests. Due since Sat 21 Mar · Body record']);
    const later = routine({ edit: (f) => editTracking(f, (d) => void (d.bodyRecord = { schedule: 'fixed', tapeFrom: '2026-04-14', tapeEvery: 14, testsFrom: '2026-04-18', testsEvery: 28 })) }).value;
    assert.deepEqual(rows(later, 'own').map((x) => x.next), ['Next: Tue 14 Apr', 'Next: Sat 18 Apr']);
    assert.deepEqual(rows(v, 'sunday').map((x) => x.time), ['Every Sunday'], 'no tape row on Sundays');
    assert.equal(rows(v, 'weeks')[0]!.what, 'Lighter sessions; on its Sunday the check-in, then');
    assert.deepEqual([rows(v, 'weeks')[1]!.what, rows(v, 'weeks')[1]!.where], ['The review on Sunday:', 'Check-in']);
  });

  it('no plan: the day’s items and the morning, no session, Sunday or light-week rows', () => {
    const v = routine({ edit: (f) => void delete f['v/3-Personal/Fitness/plan-data.json'] }).value;
    assert.deepEqual(v.groups.map((g) => g.id), ['daily', 'own']);
    const daily = rows(v, 'daily');
    assert.ok(!daily.some((x) => x.time === 'Then' || x.where === 'Log session' || x.what.startsWith('Did you train')), daily.map(line).join('\n'));
    assert.ok(daily.some((x) => x.what === 'Protein shake 30 g (training days)'), 'an after-training item keeps its row');
  });

  it('nothing tracked (every item paused): the morning and the session rows only', () => {
    const v = routine({ edit: (f) => editTracking(f, (d) => void d.items.forEach((x: { pauses?: unknown[] }) => (x.pauses = [{ from: '2026-04-01' }]))) }).value;
    assert.deepEqual(rows(v, 'daily').map((x) => x.time), ['07:30', 'Then', 'After training', '20:00']);
  });
});
