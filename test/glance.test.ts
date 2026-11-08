// At a glance and the foldable sections (src/report/glance.ts) on the
// synthetic vault and the Food tab's states (made up): each tab's summary
// of two or three lines and its sections with a plain line and a one-line
// status, in plain words (no em-dash, "light week" never "deload"), and
// the states they start in, as the user set them: Today's session, Due
// today and For today open, Readiness only when it changes the session;
// Progress's Overview with Strength trends, Weight trend and Consistency
// open; the Plan's This mesocycle and Coming up; Check-in's due parts;
// Food's day and Today, the plan on the first visits, How it's going folded.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { readTracking } from '../src/adapters/vault/tracking-read.ts';
import type { DueToday } from '../src/core/nudges.ts';
import { strengthChange } from '../src/report/banners.ts';
import { buildCheckin } from '../src/report/checkin-screen.ts';
import { buildFood } from '../src/report/food.ts';
import { checkinGlance, foodGlance, moreSections, overviewSections, planGlance, progressSums, todayGlance, type Glance, type Run } from '../src/report/glance.ts';
import { buildPlan } from '../src/report/plan-screen.ts';
import { buildProgress } from '../src/report/progress.ts';
import { buildSession } from '../src/report/session.ts';
import { buildToday } from '../src/report/today.ts';
import { applyFoodState, type FoodState } from './fixtures/food/food-state.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

const DATE = '2026-04-10';
const read = (date = DATE, edit: (f: Record<string, string>) => void = () => {}) => {
  const files = fixtureFiles('v');
  edit(files);
  return readVault(memoryIo(files, date), 'v', { asOf: date });
};
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const words = (rs: readonly Run[]) => rs.map((r) => (typeof r === 'string' ? r : r.b)).join('');
const starts = (g: Glance) => Object.fromEntries(g.sections.map((s) => [s.id, s.start]));
/** Every line in plain words: no em-dash, the user's "light week", no rule ids. */
function plain(g: Glance): void {
  const all = [...g.sums.map((x) => words(x.text)), ...g.sections.flatMap((s) => [s.title, s.line, words(s.status)])];
  for (const t of all) {
    assert.doesNotMatch(t, /—/, t);
    assert.doesNotMatch(t, /deload/i, t);
    assert.doesNotMatch(t, /\b(diet|readiness|safety|plan)\.[a-z]/, t);
  }
  assert.ok(g.sums.length >= 2 && g.sums.length <= 3, `${g.sums.length} summary lines`);
}
const due = (over: Partial<DueToday> = {}): DueToday => ({
  date: DATE,
  now: '12:15',
  morning: { on: true, at: '07:30', done: true, checkedAt: '2026-04-10T07:10:00.000Z' },
  habits: { slots: [{ key: '09:00', time: '09:00', items: [{ id: 'creatine', name: 'Creatine', kind: 'supplement', done: true, later: false }, { id: 'multi', name: 'Multivitamin', kind: 'supplement', done: false, later: false }] }, { key: '21:30', time: '21:30', items: [{ id: 'floss', name: 'Flossing', kind: 'tick', done: false, later: true }] }], done: 1, total: 3 },
  amounts: [{ id: 'water', name: 'Water', value: 1250, target: 2500, unit: 'mL', met: false, next: '13:02' }],
  standups: [],
  sitting: [],
  desk: [{ id: 'desk', name: 'Desk breaks', done: 2, total: 4, times: ['10:00', '11:30', '13:00', '14:30'], next: '13:00' }],
  body: [],
  train: { on: true, at: '20:00', needed: false },
  coach: null,
  ...over,
});

describe('At a glance: Today', () => {
  const r = read();
  const m = buildToday(r, DATE, 'full', 'v');
  const session = buildSession(r.data, DATE, 'full');
  const g = (x: Partial<Parameters<typeof todayGlance>[1]> = {}) => todayGlance(m, { session, due: due(), recent: [{ name: 'Easy run', date: DATE }], totalSessions: 23, dashReminders: 1, ...x });

  it('the summary: the session, what is still open, readiness', () => {
    const G = g();
    plain(G);
    assert.deepEqual(G.sums.map((x) => x.icon), ['dumbbell', 'pill', 'pulse']);
    assert.match(words(G.sums[0]!.text), /^Full Body B, about \d+ min: .+ in place of Romanian Deadlift\.$/);
    assert.equal(G.sums[0]!.flag, true, 'a swap for the Ledger is flagged');
    assert.equal(words(G.sums[1]!.text), '2 habits still open: Multivitamin, then 1 at 21:30.');
    assert.match(words(g({ due: due({ morning: { on: true, at: '07:30', done: false, checkedAt: null } }) }).sums[1]!.text), /^Morning check-in not done yet: about 30 seconds; 2 habits open too\.$/);
  });

  it('the sections in their starting states: the session, Due today and For today open; This week and Recent folded', () => {
    const G = g();
    assert.deepEqual(G.sections.map((s) => s.id), ['readiness', 'due', 'fortoday', 'session', 'week', 'recent']);
    const st = starts(G);
    assert.deepEqual([st['session'], st['due'], st['fortoday'], st['week'], st['recent']], ['open', 'open', 'open', 'folded', 'folded']);
    assert.match(words(G.sections.find((s) => s.id === 'week')!.status), /^Lifting \d of \d, short \d of \d/);
    assert.equal(words(G.sections.find((s) => s.id === 'recent')!.status), 'Easy run, Fri 10 Apr · 23 sessions on record');
    assert.equal(words(G.sections.find((s) => s.id === 'due')!.status), '1 of 3 habits done · water 1,250 of 2,500 mL · desk break at 13:00');
    assert.equal(G.sections.find((s) => s.id === 'due')!.due, true, 'a habit open now: due, so it opens on a new day');
    assert.equal(g({ due: due({ habits: { slots: [], done: 0, total: 0 } }) }).sections.find((s) => s.id === 'due')!.due, false);
    assert.ok(!g({ due: null }).sections.some((s) => s.id === 'due'), 'no reminder machinery: no Due today');
  });

  it('readiness opens by itself only when it changes the session and its baseline is complete', () => {
    const rs = g().sections.find((s) => s.id === 'readiness')!;
    assert.equal(rs.start, 'folded');
    assert.ok(!rs.due);
    const trim = clone(m);
    const acts = trim.review!.readiness.actions as { value: { action: string; active: boolean } }[];
    acts.push({ ...clone(acts[0]!), value: { ...acts[0]!.value, action: 'trim', active: true } });
    const open = todayGlance(trim, { session, due: due(), recent: [], totalSessions: 0, dashReminders: 0 }).sections.find((s) => s.id === 'readiness')!;
    assert.deepEqual([open.start, open.due], ['open', true]);
    assert.match(words(open.status), /one set fewer on the top sets, RIR \+1/);
    const building = clone(trim);
    Object.assign(building.review!.readiness.baseline.value, { building: true, mornings: 3, needed: 14 });
    assert.equal(todayGlance(building, { session, due: null, recent: [], totalSessions: 0, dashReminders: 0 }).sections.find((s) => s.id === 'readiness')!.start, 'folded', 'while the baseline builds it stays folded');
  });

  it('Ask the coach: a section of its own, open, only while the step is due or still to do', () => {
    assert.ok(!g().sections.some((s) => s.id === 'coach'), 'last Sunday’s answers not saved: nothing to ask yet');
    const sunday = '2026-04-26';
    const rs = read(sunday, (f) => void (f['v/3-Personal/Fitness/Coach/checkins.json'] = JSON.stringify({ schemaVersion: 1, checkins: [{ date: sunday, weekStart: '2026-04-20' }] })));
    const ms = buildToday(rs, sunday, 'full', 'v');
    const G = todayGlance(ms, { session: buildSession(rs.data, sunday, 'full'), due: null, recent: [], totalSessions: 0, dashReminders: 0 });
    plain(G);
    const c = G.sections.find((x) => x.id === 'coach')!;
    assert.deepEqual([c.start, c.due, c.title, words(c.status)], ['open', true, 'Ask the coach', 'Phase review · run /fitness-coach review']);
    const next = buildToday(rs, '2026-04-28', 'full', 'v');
    assert.equal(words(todayGlance(next, { session: null, due: null, recent: [], totalSessions: 0, dashReminders: 0 }).sections.find((x) => x.id === 'coach')!.status), 'Phase review · still to do since 26 Apr: run /fitness-coach review');
    const done = buildToday(rs, sunday, 'full', 'v', {}, { letter: { path: '3-Personal/Fitness/Coach/Letters/2026-04-26.md', text: '---\ntype: phase-review\ndate: 2026-04-26\n---\n' } });
    assert.ok(!todayGlance(done, { session: null, due: null, recent: [], totalSessions: 0, dashReminders: 0 }).sections.some((x) => x.id === 'coach'), 'the letter is in');
  });
});

describe('At a glance: Progress and the Plan', () => {
  const r = read();
  const pm = buildProgress(r, DATE, 'v');
  const today = buildToday(r, DATE, 'full', 'v');
  const x = { today, waist: null, units: { weight: 'kg', length: 'cm' }, wv: (v: number) => v, lv: (v: number) => v };

  it('Progress: the week, the weight trend, strength; Overview with Strength, Weight and Consistency open', () => {
    const sums = progressSums(pm, x, strengthChange(pm.lifts));
    const secs = overviewSections(pm, x);
    plain({ sums, sections: secs });
    assert.match(words(sums[0]!.text), /^Week 6 of 24 · \d of \d lifting sessions/);
    assert.deepEqual(secs.map((s) => [s.id, s.start]), [['sets', 'folded'], ['ready', 'folded'], ['consistency', 'open'], ['strength', 'open'], ['weight', 'open']]);
    assert.match(words(secs[0]!.status), /^\d+ below target so far this week, /);
    const waist = { first: { date: '2026-02-24', value: 96 }, last: { date: '2026-04-07', value: 93.6 }, change: -2.4 };
    assert.equal(words(progressSums(pm, { ...x, waist }, strengthChange(pm.lifts))[1]!.text), 'Waist 93.6 cm, down 2.4 cm since 24 Feb.');
  });

  it('Progress’s other views: each card as drawn, open, its status the line under its title', () => {
    const secs = moreSections('training', [{ id: 'records', title: 'Records and milestones', sub: 'Each lift’s best top set: heavier, or the same weight for more reps' }, { id: 'odd', title: 'Odd', sub: 'First part. Second part.' }]);
    assert.deepEqual(secs.map((s) => [s.id, s.start, s.line, words(s.status)]), [
      ['training.records', 'open', 'Each lift’s best top sets and the milestones reached', 'Each lift’s best top set: heavier, or the same weight for more reps'],
      ['training.odd', 'open', 'First part', 'First part. Second part.'],
    ]);
  });

  it('the Plan: This mesocycle and Coming up open, the rest folded; the light week in plain words', () => {
    const plan = buildPlan(r, DATE, {}, 'v');
    const G = planGlance(plan, { weekTarget: { lift: 3, short: 1 }, targets: { ok: 4, total: 5, others: [{ name: 'Wall gap', status: 'Not measured yet' }] }, desk: '4 a day, every 90 min from 10:00 to 15:00, weekdays', links: 6 });
    plain(G);
    assert.deepEqual(G.sections.map((s) => [s.id, s.start]), [['timeline', 'folded'], ['meso', 'open'], ['vol', 'folded'], ['upcoming', 'open'], ['load', 'folded'], ['targets', 'folded'], ['rules', 'folded'], ['minweek', 'folded'], ['desk', 'folded'], ['notes', 'folded']]);
    assert.equal(G.sections[0]!.title, 'The plan, 24 weeks');
    assert.equal(words(G.sections.find((s) => s.id === 'rules')!.status), '0 of 14 set by your coach · the rest use Pahlavan’s default');
    assert.match(words(G.sums[2]!.text), /^Next: the light week, Mon 20 Apr; phase tests Sat 25 Apr\.$/);
    // Coming up names the coach step after the first Sunday's check-in.
    assert.equal(words(G.sections.find((s) => s.id === 'upcoming')!.status), 'Tape and Sunday check-in Sun 12 Apr, in 2 days · then the week’s letter: /fitness-coach checkin');
    const end = planGlance(buildPlan(read('2026-04-20'), '2026-04-20', {}, 'v'), { weekTarget: null, targets: null, desk: null, links: 0 });
    assert.equal(words(end.sections.find((s) => s.id === 'upcoming')!.status), 'Phase tests Sat 25 Apr, in 5 days', 'the first date has no check-in');
    const sun = planGlance(buildPlan(read('2026-04-25'), '2026-04-25', {}, 'v'), { weekTarget: null, targets: null, desk: null, links: 0 });
    assert.equal(words(sun.sections.find((s) => s.id === 'upcoming')!.status), 'Progress photos, Tape and Sunday check-in Sun 26 Apr, tomorrow · then the phase review: /fitness-coach review', 'the phase review is named once');
    assert.equal(words(G.sections.find((s) => s.id === 'targets')!.status), '4 of 5 on track or in the band · wall gap: not measured yet');
    assert.ok(!planGlance(plan, { weekTarget: null, targets: null, desk: null, links: 0 }).sections.some((s) => ['desk', 'notes'].includes(s.id)), 'no card, no row');
  });
});

describe('At a glance: Check-in', () => {
  const body = (inDays: number) => [{ part: 'tape', title: 'Tape', due: false, nextDate: '2026-04-12', inDays }, { part: 'tests', title: 'Fitness tests', due: false, nextDate: '2026-04-25', inDays: 15 }];

  const saved = (f: Record<string, string>) => void (f['v/3-Personal/Fitness/Coach/checkins.json'] = JSON.stringify({ schemaVersion: 1, checkins: [{ date: '2026-04-05', weekStart: '2026-03-30' }] }));
  /** Last Sunday's letter: the coach step after its check-in is done. */
  const LETTER = { path: '3-Personal/Fitness/Coach/Letters/2026-04-05.md', text: '---\ntype: coach-letter\ndate: 2026-04-05\n---\n\n# Week 5 letter\n' };

  it('a weekday with the morning done: the morning folded, the body record open within 3 days, the Sunday check-in and the letter folded', () => {
    const G = checkinGlance(buildCheckin(read(DATE, saved), DATE, LETTER), { body: body(2) });
    plain(G);
    assert.deepEqual(G.sections.map((s) => [s.id, s.start]), [['morning', 'folded'], ['body', 'open'], ['sunday', 'folded'], ['letter', 'folded']]);
    assert.equal(words(G.sums[1]!.text), 'The Sunday check-in opens Sun 12 Apr, in 2 days.');
    assert.equal(G.sections.find((s) => s.id === 'body')!.due, true);
    assert.equal(words(G.sums[2]!.text), 'Next: tape Sun 12 Apr, fitness tests 25 Apr.');
    assert.equal(checkinGlance(buildCheckin(read(), DATE, null), { body: body(5) }).sections.find((s) => s.id === 'body')!.start, 'folded');
  });

  it('saved, and no letter yet: the Sunday line says to ask the coach, and the section opens', () => {
    const G = checkinGlance(buildCheckin(read(DATE, saved), DATE, null), { body: null });
    plain(G);
    assert.equal(words(G.sums[1]!.text), 'The check-in of Sun 5 Apr is saved. Next, ask the coach for the week’s letter: /fitness-coach checkin.');
    assert.equal(G.sums[1]!.flag, true);
    const sun = (f: Record<string, string>) => void (f['v/3-Personal/Fitness/Coach/checkins.json'] = JSON.stringify({ schemaVersion: 1, checkins: [{ date: '2026-04-12', weekStart: '2026-04-06' }] }));
    assert.equal(words(checkinGlance(buildCheckin(read('2026-04-12', sun), '2026-04-12', null), { body: null }).sums[1]!.text), 'The Sunday check-in is saved. Next, ask the coach for the week’s letter: /fitness-coach checkin.');
    const s = G.sections.find((x) => x.id === 'sunday')!;
    assert.deepEqual([s.start, s.due], ['open', true]);
    assert.match(words(s.status), /next, ask the coach: \/fitness-coach checkin$/);
  });

  it('last Sunday’s check-in not saved yet: it needs action, so it opens', () => {
    const late = checkinGlance(buildCheckin(read(), DATE, null), { body: null });
    const s = late.sections.find((x) => x.id === 'sunday')!;
    assert.deepEqual([s.start, s.due], ['open', true]);
    assert.match(words(s.status), /^Not saved yet, the week of 30 Mar/);
  });

  it('a morning not done opens it; a Sunday opens the Sunday check-in', () => {
    const noMorning = read(DATE, (f) => {
      const p = 'v/3-Personal/Fitness/body-data.json';
      const b = JSON.parse(f[p]!);
      b.days[DATE] = {};
      f[p] = JSON.stringify(b);
    });
    const m = checkinGlance(buildCheckin(noMorning, DATE, null), { body: null }).sections.find((s) => s.id === 'morning')!;
    assert.deepEqual([m.start, m.due, words(m.status)], ['open', true, 'Not done yet · about 30 seconds']);
    const sunday = checkinGlance(buildCheckin(read('2026-04-12'), '2026-04-12', null), { body: null });
    assert.equal(sunday.sections.find((s) => s.id === 'sunday')!.start, 'open');
    assert.ok(!sunday.sections.some((s) => s.id === 'body'), 'no body record read here: no row');
  });
});

describe('At a glance: Food', () => {
  const food = (s: FoodState, plan: 'day' | 'plain' = 'day') => {
    const files = fixtureFiles('v');
    const { today } = applyFoodState(files, s, 'v', plan);
    const io = memoryIo(files, today);
    return buildFood(readVault(io, 'v', { asOf: today }), readTracking(io, 'v'), today);
  };

  it('the day and Today open, the tips open, How it’s going folded; Your plan in a minute open on the first visits only', () => {
    const G = foodGlance(food('early'), { early: true });
    plain(G);
    assert.deepEqual(G.sections.map((s) => [s.id, s.start]), [['plan', 'open'], ['day', 'open'], ['today', 'open'], ['tips', 'open'], ['going', 'folded']]);
    assert.equal(starts(foodGlance(food('early'), { early: false }))['plan'], 'folded');
    assert.deepEqual(G.sums.map((x) => words(x.text)), [
      'Protein 134 g or more: 0 of 7 days ticked this week, today open.',
      'Monday, a lifting day: lift at 17:30, about 150 g of protein planned over 5 meals.',
      'Next check Sun 29 Nov: the tape and the weight trend decide, never one day.',
    ]);
    assert.equal(words(G.sections.find((s) => s.id === 'going')!.status), 'Week 1, too early to judge · next check 29 Nov');
    assert.equal(words(G.sections.find((s) => s.id === 'plan')!.status), 'Build muscle, lose a little fat · 134 g protein · about 2,800 kcal');
  });

  it('four weeks on: the short Sunday, the check’s outcome; the schema 1 plan has no tips row; no plan, no sections', () => {
    const G = foodGlance(food('later'), { early: false });
    assert.match(words(G.sums[1]!.text), /^Sunday, a short day: the short session at 17:30, /);
    assert.equal(words(G.sections.find((s) => s.id === 'going')!.status), 'Checked today: no change · next check 13 Dec');
    assert.ok(!foodGlance(food('early', 'plain'), { early: true }).sections.some((s) => s.id === 'tips'));
    const none = foodGlance(food('empty'), { early: true });
    assert.deepEqual([none.sections.length, words(none.sums[0]!.text)], [0, 'No eating plan yet: run /fitness-coach diet to make one.']);
  });
});
