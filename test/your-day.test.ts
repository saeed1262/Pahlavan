// Your day (src/report/your-day.ts) on the synthetic vault (Fri 10 Apr, plan
// week 6) and made-up variations of it: each step's states (the morning
// check-in done with its time or open with its card's time; the session
// logged, open, ticked but not logged, a rest day from a mark or from the
// plan; the habits' count, what is open now and the next card, the after
// training items waiting for the session; the food step from the eating plan,
// from a protein item alone, and quiet with neither), the Sunday step from
// the coach steps (answer first, the command with Copy, done), the one step
// marked next, the count, and the lines in plain words.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { readTracking } from '../src/adapters/vault/tracking-read.ts';
import { momentAt } from '../src/core/clock.ts';
import { dueToday, type DueToday } from '../src/core/nudges.ts';
import { habitCheckinKey } from '../src/core/tracking.ts';
import { buildFood } from '../src/report/food.ts';
import { todayGlance } from '../src/report/glance.ts';
import { buildSession } from '../src/report/session.ts';
import { buildToday } from '../src/report/today.ts';
import { coachStepsOf, trainingToday } from '../src/report/index.ts';
import { yourDay, type DayStep, type YourDay } from '../src/report/your-day.ts';
import { applyFoodState } from './fixtures/food/food-state.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

const DATE = '2026-04-10';
const FIT = 'v/3-Personal/Fitness';
type Files = Record<string, string>;
const edit = (files: Files, path: string, fn: (d: any) => void) => {
  const d = JSON.parse(files[path]!);
  fn(d);
  files[path] = JSON.stringify(d);
};
/** Today's sessions out of the log, and the Workout tick with them (`tick`: keep the tick). */
const unlog = (files: Files, date = DATE, tick = false) => {
  edit(files, `${FIT}/fitness-log-data.json`, (d) => void (d.sessions = d.sessions.filter((s: { date: string }) => s.date !== date)));
  if (!tick) edit(files, 'v/5-System/Data/habits-data.json', (d) => void delete d.checkins[habitCheckinKey('workout', date)]);
};
const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/** The strip as the view builds it: Today's report, the session, Due today at `time` (the engine's own), the Food tab. */
function day(opts: { date?: string; time?: string; edit?: (f: Files) => void; due?: boolean; letter?: { path: string; text: string } | null; food?: boolean } = {}) {
  const date = opts.date ?? DATE;
  const files = fixtureFiles('v');
  opts.edit?.(files);
  const io = memoryIo(files, date);
  const read = readVault(io, 'v', { asOf: date });
  const tr = readTracking(io, 'v');
  const letter = opts.letter ?? null;
  const m = buildToday(read, date, 'full', 'v', {}, { letter });
  const session = buildSession(read.data, date, 'full');
  const due = opts.due === false ? null : dueToday({ now: momentAt(date, opts.time ?? '12:15', 0), tracking: tr.tracking, nudges: tr.nudges, body: tr.body, photoFolders: tr.photoFolders, habits: tr.habits, program: read.data.program, training: trainingToday(read.data, date), coach: coachStepsOf(read, date, letter).now?.value ?? null }).value;
  const food = opts.food === false ? null : buildFood(read, tr, date);
  const r = yourDay(m, { session, due, food, items: tr.tracking?.items ?? [], clock });
  return { r, m, session, due, v: r?.value as YourDay };
}
const step = (v: YourDay, id: DayStep['id']) => v.steps.find((s) => s.id === id)!;
const row = (s: DayStep) => [s.state, s.word, s.name, s.line, s.action ? (s.action.kind === 'copy' ? `copy ${s.action.command}` : s.action.label) : null];
/** Every visible word: no em-dash, no rule ids, the user's "light week". */
function plain(v: YourDay): void {
  for (const t of [v.kicker, v.count, ...v.steps.flatMap((s) => [s.word, s.name, s.line, s.action?.label ?? ''])]) {
    assert.doesNotMatch(t, /—/, t);
    assert.doesNotMatch(t, /deload/i, t);
    assert.doesNotMatch(t, /!/, t);
    assert.doesNotMatch(t, /\b(day|diet|coach|nudges|routine)\.[a-z]/, t);
  }
}

describe('Your day: the strip on the synthetic vault', () => {
  it('the day’s steps in order, their states, the count and the kicker; the first not done is next', () => {
    const { r, v } = day();
    plain(v);
    assert.equal(v.kicker, 'Your day · Fri 10 Apr');
    assert.deepEqual(v.steps.map((s) => s.id), ['morning', 'session', 'habits', 'food']);
    assert.deepEqual(row(step(v, 'morning')), ['done', 'Done 07:10', 'Morning check-in', 'Readiness Watch', null]);
    // A custom session logged today: the day is trained, as "Did you train today?" reads it.
    assert.deepEqual(row(step(v, 'session')), ['done', 'Done', 'Session', 'Logged: Easy run, 30 min', null]);
    assert.equal(step(v, 'habits').state, 'next');
    assert.deepEqual([v.done, v.total, v.count, v.next], [2, 4, '2 of 4 done', 'habits']);
    assert.equal(v.steps.filter((s) => s.state === 'next').length, 1);
    assert.equal(r!.reason.rule, 'day.steps');
    for (const s of v.steps) assert.ok(s.reason.rule && s.reason.note, `${s.id} has its reason`);
  });

  it('no plan: no strip (Today has no screen then)', () => {
    const files = fixtureFiles('v');
    delete files[`${FIT}/plan-data.json`];
    const read = readVault(memoryIo(files, DATE), 'v', { asOf: DATE });
    const m = buildToday(read, DATE, 'full', 'v');
    assert.equal(yourDay(m, { session: null, due: null, food: null }), null);
  });

  it('At a glance lists it first, open, with its count and the next step', () => {
    const { m, session, due, v } = day();
    const g = todayGlance(m, { session, due, recent: [], totalSessions: 0, dashReminders: 0, day: v });
    const s = g.sections[0]!;
    assert.deepEqual([s.id, s.title, s.start], ['yourday', 'Your day', 'open']);
    assert.equal(s.status.map((x) => (typeof x === 'string' ? x : x.b)).join(''), '2 of 4 done · next: Habits');
    assert.ok(!todayGlance(m, { session, due, recent: [], totalSessions: 0, dashReminders: 0 }).sections.some((x) => x.id === 'yourday'), 'without the strip, no section');
  });
});

describe('Your day: the morning check-in', () => {
  // Not in: no checkedAt and none of the card's own questions answered (the watch's numbers stay; they are not a check-in).
  const morningOpen = (f: Files) => {
    edit(f, `${FIT}/body-data.json`, (d) => {
      for (const k of ['checkedAt', 'energy', 'soreness', 'sleepQ']) delete d.days[DATE][k];
    });
    edit(f, `${FIT}/Coach/nudges.json`, (d) => void delete d.days[DATE].morning);
  };
  it('not in yet, before its card: open with the card’s time, the Open action, and next', () => {
    const s = step(day({ edit: morningOpen, time: '07:00' }).v, 'morning');
    assert.deepEqual(row(s), ['next', 'Next', 'Morning check-in', 'A card at 07:30, about 30 seconds', 'Open']);
    assert.equal(s.action!.kind, 'morning');
    assert.match(s.reason.note!, /The card comes at 07:30\./);
  });
  it('after its card’s time: about 30 seconds, it feeds readiness', () => {
    assert.equal(step(day({ edit: morningOpen }).v, 'morning').line, 'About 30 seconds, it feeds readiness');
  });
  it('done without a clock: "Done"; without Due today, today’s readiness inputs decide', () => {
    const { m, session } = day();
    const v = yourDay(m, { session, due: null, food: null })!.value;
    assert.deepEqual([step(v, 'morning').state, step(v, 'morning').word], ['done', 'Done']);
    assert.deepEqual(v.steps.map((x) => x.id), ['morning', 'session'], 'no habits or food step without their reports');
  });
  it('while the baseline builds: "Readiness building, N of 14"', () => {
    // A fresh start on 3 Apr: this cycle has a week of mornings.
    const s = step(day({ edit: (f) => void (f[`${FIT}/Baseline - 2026-04-03.md`] = '# Baseline\n') }).v, 'morning');
    assert.match(s.line, /^Readiness building, \d+ of 14$/);
  });
});

describe('Your day: the session', () => {
  it('planned and not logged: its name and minutes, Log session', () => {
    const { v } = day({ edit: (f) => unlog(f) });
    assert.deepEqual(row(step(v, 'session')), ['next', 'Next', 'Session B', 'Full Body B, about 60 min', 'Log session']);
    assert.equal(step(v, 'session').action!.kind, 'log');
  });
  it('the Workout habit ticked, nothing logged: still open, to log', () => {
    const s = step(day({ edit: (f) => unlog(f, DATE, true) }).v, 'session');
    assert.deepEqual([s.state, s.line, s.action!.label], ['next', 'Ticked as trained, not logged yet', 'Log session']);
  });
  it('a rest day marked: done, counted', () => {
    const { v } = day({ edit: (f) => { unlog(f); edit(f, `${FIT}/body-data.json`, (d) => void (d.days[DATE].mark = 'rest')); } });
    assert.deepEqual(row(step(v, 'session')), ['done', 'Rest', 'Rest day', 'Marked rest: nothing to log', null]);
    assert.equal(v.done, 2);
  });
  it('a day marked missed: closed for today', () => {
    const s = step(day({ edit: (f) => { unlog(f); edit(f, `${FIT}/body-data.json`, (d) => void (d.days[DATE].mark = 'missed')); } }).v, 'session');
    assert.deepEqual([s.state, s.word, s.line], ['done', 'Missed', 'Marked missed today']);
  });
  it('a rest day from the plan: no plan week holds the date (the week before the plan’s first)', () => {
    const date = '2026-02-23';
    const s = step(day({ date, due: false, food: false }).v, 'session');
    assert.deepEqual(row(s), ['done', 'Rest', 'Rest day', 'No session in your plan today', null]);
  });
});

describe('Your day: the habits', () => {
  it('done of the supplements, ticks and amounts due (the evening ones too), what is open now and the next card', () => {
    const { due, v } = day();
    const s = step(v, 'habits');
    assert.equal(s.name, `Habits: ${due!.habits.done} of ${due!.habits.total + due!.amounts.length}`);
    assert.equal(s.line, 'Multivitamin and protein shake open · next: water at 13:02');
    assert.equal(s.action!.kind, 'due');
  });
  it('an after-training item waits for the session: not open before one is logged', () => {
    const s = step(day({ edit: (f) => unlog(f) }).v, 'habits');
    assert.equal(s.line, 'Multivitamin open · next: water at 13:02');
    assert.deepEqual(s.reason.inputs['afterTraining'], ['protein shake']);
  });
  it('late in the evening: what is left at its card’s time', () => {
    assert.match(step(day({ time: '21:15' }).v, 'habits').line, / more open · next: magnesium and flossing at 21:30$/);
  });
  it('everything ticked: done', () => {
    const { v } = day({ edit: (f) => edit(f, `${FIT}/Coach/tracking.json`, (d) => {
      for (const it of d.items) {
        if (it.kind === 'supplement' || it.kind === 'tick') d.days[DATE][it.id] = { done: true };
        if (it.kind === 'amount') d.days[DATE][it.id] = { amount: it.amount.target };
      }
    }) });
    assert.deepEqual(row(step(v, 'habits')).slice(0, 4), ['done', 'Done', 'Habits: 7 of 7', 'Everything ticked today']);
    assert.equal(step(v, 'food').state, 'done', 'the protein item counts on the food step too');
    assert.deepEqual([v.count, v.next], ['4 of 4 done', null]);
  });
  it('nothing due today (every item paused): no habits step', () => {
    const { v } = day({ edit: (f) => edit(f, `${FIT}/Coach/tracking.json`, (d) => void d.items.forEach((x: { pauses?: unknown[] }) => (x.pauses = [{ from: '2026-04-01' }]))) });
    assert.ok(!v.steps.some((s) => s.id === 'habits'));
  });
});

describe('Your day: the food', () => {
  it('no eating plan, a protein item: its target, open; ticked, done', () => {
    assert.deepEqual(row(step(day().v, 'food')), ['open', 'Open', 'Food', 'Protein: 134 g target, open', 'Open Food']);
    const ticked = step(day({ edit: (f) => edit(f, `${FIT}/Coach/tracking.json`, (d) => void (d.days[DATE].protein = { done: true })) }).v, 'food');
    assert.deepEqual([ticked.state, ticked.line], ['done', 'Protein ticked']);
  });
  it('no eating plan and no protein item: quiet, not counted', () => {
    const { v } = day({ edit: (f) => edit(f, `${FIT}/Coach/tracking.json`, (d) => void (d.items = d.items.filter((x: { id: string }) => x.id !== 'protein'))) });
    const s = step(v, 'food');
    assert.deepEqual(row(s), ['quiet', 'No plan yet', 'Food', 'No eating plan yet', 'Open Food']);
    assert.equal(v.total, 3, 'the quiet step is not counted');
    assert.match(s.reason.note!, /Not counted/);
  });
  it('a protein item paused, no eating plan: quiet too', () => {
    const { v } = day({ edit: (f) => edit(f, `${FIT}/Coach/tracking.json`, (d) => void (d.items.find((x: { id: string }) => x.id === 'protein').pauses = [{ from: '2026-03-02' }])) });
    assert.deepEqual([step(v, 'food').state, step(v, 'food').line], ['quiet', 'No eating plan yet']);
  });
  it('the eating plan’s day: the plan’s floor, open, then ticked', () => {
    const today = '2026-11-02';
    const v = day({ date: today, edit: (f) => void applyFoodState(f, 'early', 'v') }).v;
    assert.deepEqual(row(step(v, 'food')).slice(0, 4), ['open', 'Open', 'Food', 'Protein: 134 g target, open']);
    const done = day({ date: today, edit: (f) => { applyFoodState(f, 'early', 'v'); edit(f, `${FIT}/Coach/tracking.json`, (d) => void (d.days[today] = { ...(d.days[today] ?? {}), protein: { done: true } })); } }).v;
    assert.equal(step(done, 'food').line, 'Protein ticked');
  });
});

describe('Your day: the Sunday step', () => {
  const SUN = '2026-04-12';
  const saved = (f: Files) => void (f[`${FIT}/Coach/checkins.json`] = JSON.stringify({ schemaVersion: 1, checkins: [{ date: SUN, weekStart: '2026-04-06' }] }));
  it('on a coach step’s Sunday, the answers not saved: Open check-in', () => {
    const { v } = day({ date: SUN });
    assert.deepEqual(row(step(v, 'sunday')), ['open', 'Open', 'Sunday check-in', 'Then ask the coach for the week’s letter', 'Open check-in']);
    assert.equal(v.total, 5);
    assert.equal(step(v, 'sunday').reason.rule, 'coach.now');
  });
  it('saved, no letter yet: the command with Copy', () => {
    const s = step(day({ date: SUN, edit: saved }).v, 'sunday');
    assert.deepEqual(row(s), ['open', 'Open', 'Sunday check-in', 'Saved: ask the coach for the week’s letter', 'copy /fitness-coach checkin']);
  });
  it('the letter in: done', () => {
    const s = step(day({ date: SUN, edit: saved, letter: { path: '3-Personal/Fitness/Coach/Letters/2026-04-12.md', text: '---\ndate: 2026-04-12\n---\n\n# Week 6\n' } }).v, 'sunday');
    assert.deepEqual([s.state, s.word, s.line], ['done', 'Done', 'The coach’s letter of Sun 12 Apr is in.']);
  });
  it('the phase review’s Sunday names the review', () => {
    const s = step(day({ date: '2026-04-26' }).v, 'sunday');
    assert.equal(s.line, 'Then ask the coach for the phase review');
  });
  it('not on a weekday, even while the step is still to do', () => {
    assert.ok(!day({ date: '2026-04-13', edit: saved }).v.steps.some((s) => s.id === 'sunday'));
  });
});
