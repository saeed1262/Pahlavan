// The first Sunday check-in after a fresh start (0.14.0): the rehearsal's
// cases on made-up data. A cycle that starts on a Monday after earlier data
// (adherence, stalls and the light-week cancel count the cycle's weeks only;
// a test from before it shows no level), the Sunday protein question (its
// options from the unticked days, today left out while its evening tick is
// ahead, the answer stored additively), a saved record's answered questions,
// a day the check-in says was trained (the strip, "Did you train?", and the
// review once it is logged), the coach step once its letter is in, the
// protein item against the eating plan's floor, one rule for "morning
// check-in done", `validate` on a letter, and skipped lines for a session
// logged elsewhere. On the synthetic vault (plan from Mon 2 Mar 2026), with
// a fresh start on Mon 30 Mar where a case needs one.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { buildLogEntry } from '../src/adapters/vault/log-write.ts';
import { readVault } from '../src/adapters/vault/read.ts';
import { readTracking } from '../src/adapters/vault/tracking-read.ts';
import { run } from '../src/cli/cli.ts';
import { adherence } from '../src/core/adherence.ts';
import { dayMarks } from '../src/core/checkins.ts';
import { momentAt } from '../src/core/clock.ts';
import { addDays } from '../src/core/dates.ts';
import { proteinWeeks } from '../src/core/diet.ts';
import { isMorningDone } from '../src/core/morning.ts';
import { dueNow, dueToday } from '../src/core/nudges.ts';
import type { Session, SessionKind, TrackedItem } from '../src/core/schema.ts';
import { validateCheckinLog, validateLetter } from '../src/core/validate.ts';
import { checkinWeek } from '../src/report/banners.ts';
import { checkinGlance } from '../src/report/glance.ts';
import {
  answersFromRecord,
  buildCheckin,
  buildDue,
  buildProgress,
  buildProgressMore,
  buildReview,
  buildTemplate,
  buildToday,
  frozenList,
  inputFromForm,
  logFormFor,
  buildSession,
  recordFromAnswers,
  trainingToday,
} from '../src/report/index.ts';
import { buildTrackDay } from '../src/report/track-day.ts';
import { fixtureFiles, memoryIo, ROOT } from './helpers.ts';

type Files = Record<string, string>;
type Json = Record<string, any>;
const FIT = 'v/3-Personal/Fitness';
const LOG = `${FIT}/fitness-log-data.json`;
const BODY = `${FIT}/body-data.json`;
const CHECKINS = `${FIT}/Coach/checkins.json`;
const SUNDAY = '2026-04-12';
/** A fresh start on Mon 30 Mar: the weeks of March are the cycle before. */
const fresh = (f: Files) => void (f[`${FIT}/Baseline - 2026-03-30.md`] = '# Baseline\n');
const files = (...edits: ((f: Files) => void)[]) => {
  const f = fixtureFiles('v');
  for (const e of edits) e(f);
  return f;
};
const vault = (date: string, ...edits: ((f: Files) => void)[]) => {
  const io = memoryIo(files(...edits), date);
  return { read: readVault(io, 'v', { asOf: date }), tr: readTracking(io, 'v') };
};
const editJson = (f: Files, path: string, fn: (d: any) => void) => {
  const d = JSON.parse(f[path]!);
  fn(d);
  f[path] = JSON.stringify(d);
};
const record = (r: Json) => (f: Files) => void (f[CHECKINS] = JSON.stringify({ schemaVersion: 1, checkins: [r] }));
const s = (date: string, kind: SessionKind): Session => ({ id: `${date}-${kind}`, date, trackingLevel: 'light', exercises: [], plan: { weekKind: 'loading', template: kind, kind, slots: [] } });

// ---------------------------------------------------------------- 1. adherence counts the cycle's weeks

describe('adherence: only the cycle’s weeks count', () => {
  // October on record with nothing logged, then a perfect week from Mon 2 Nov: lifting Mon, Tue, Thu, Fri; short Wed, Sat, Sun.
  const week = (mon: string) => [...[0, 1, 3, 4].map((d) => s(addDays(mon, d), 'lift')), ...[2, 5, 6].map((d) => s(addDays(mon, d), 'short'))];
  const target = { lift: 4, short: 3 };

  it('on the first Sunday: 1 of 4 weeks, 100 %, and the reason says how many weeks it covers', () => {
    const before = adherence({ sessions: week('2026-11-02'), today: '2026-11-08', target }).value;
    assert.deepEqual([before.from, before.lifting], ['2026-10-12', { done: 4, planned: 16, pct: 0.25 }], 'the 4 weeks whatever the cycle, as 0.13.0 counted them');
    const a = adherence({ sessions: week('2026-11-02'), today: '2026-11-08', target, since: '2026-11-02' });
    assert.deepEqual([a.value.from, a.value.to, a.value.weeks.length], ['2026-11-02', '2026-11-08', 1]);
    assert.deepEqual([a.value.lifting, a.value.short], [{ done: 4, planned: 4, pct: 1 }, { done: 3, planned: 3, pct: 1 }]);
    assert.match(a.reason.note!, /^Lifting 4\/4 = 100 %, short 3\/3 = 100 %\. 1 of 4 weeks, the cycle started Mon 2 Nov: the weeks before it are not counted\./);
    assert.deepEqual([a.reason.inputs['since'], a.reason.inputs['weeks'], a.reason.inputs['dropped']], ['2026-11-02', 1, 3]);
  });

  it('a perfect week 2 is 100 %, not 50 %: "2 of 4 weeks"', () => {
    const sessions = [...week('2026-11-02'), ...week('2026-11-09')];
    assert.equal(adherence({ sessions, today: '2026-11-15', target }).value.lifting.pct, 0.5);
    const a = adherence({ sessions, today: '2026-11-15', target, since: '2026-11-02' });
    assert.deepEqual(a.value.lifting, { done: 8, planned: 8, pct: 1 });
    assert.match(a.reason.note!, /2 of 4 weeks, the cycle started Mon 2 Nov/);
  });

  it('inside the first week: no complete week yet, no percentage', () => {
    const a = adherence({ sessions: week('2026-11-02').slice(0, 2), today: '2026-11-04', target, since: '2026-11-02' });
    assert.deepEqual([a.value.weeks.length, a.value.lifting.pct, a.value.meanSessionsPerWeek], [0, null, 0]);
    assert.match(a.reason.note!, /^No complete week since the cycle started Mon 2 Nov yet: adherence counts from its first full week\./);
  });

  it('review: the stall gate reads the cycle’s figure (a lift held back by the old cycle’s gaps is a stall now)', () => {
    // Before the fresh start only the A sessions were logged: over 4 weeks, 8 of 12; over the cycle's 2, 6 of 6.
    const onlyA = (f: Files) => editJson(f, LOG, (l) => void (l.sessions = l.sessions.filter((x: Json) => x.date >= '2026-03-30' || x.type === 'A')));
    const old = buildReview(vault(SUNDAY, onlyA).read.data, SUNDAY);
    const now = buildReview(vault(SUNDAY, onlyA, fresh).read.data, SUNDAY);
    const bench = (r: typeof old) => r.lifts.find((l) => l.name === 'Flat DB Bench Press')!;
    assert.deepEqual([old.adherence.value.lifting.pct, bench(old).stall.value.status], [8 / 12, 'adherence']);
    assert.deepEqual([now.adherence.value.lifting, bench(now).stall.value.status], [{ done: 6, planned: 6, pct: 1 }, 'stalled']);
    assert.equal(bench(now).stall.reason.inputs['adherence'], 1);
  });

  it('the light-week cancel question reads the cycle’s figure too', () => {
    // Sun 19 Apr: the week after is plan week 8, a light week; the cycle has 3 complete weeks.
    const { read } = vault('2026-04-19', fresh);
    const t = buildTemplate(read.data, '2026-04-19', null);
    const q = t.ask.find((a) => a.topic === 'deload') as Json;
    const review = buildReview(read.data, '2026-04-19');
    assert.equal(review.adherence.value.weeks.length, 3);
    assert.equal(q.known.adherence, review.adherence.value.lifting.pct);
  });

  it('Progress: This cycle shows the cycle’s weeks, All the last 4 whatever the cycle', () => {
    const { read } = vault(SUNDAY, fresh);
    const cycle = buildProgress(read, SUNDAY, 'v', { scope: 'cycle' });
    const all = buildProgress(read, SUNDAY, 'v', { scope: 'all' });
    assert.equal(cycle.calendar!.adherence!.weeks.length, 2);
    assert.equal(all.calendar!.adherence!.weeks.length, 4);
  });
});

// ---------------------------------------------------------------- 2 and 3. the Sunday protein question

describe('the Sunday protein question', () => {
  // The synthetic week of 6 Apr: protein ticked Mon, Tue, Wed and Sat; the item's tick is at 20:00.
  const template = (minutes: number | null, ...edits: ((f: Files) => void)[]) => {
    const { read, tr } = vault(SUNDAY, ...edits);
    return buildTemplate(read.data, SUNDAY, null, { now: minutes === null ? null : { date: SUNDAY, minutes }, tracking: tr });
  };
  const protein = (t: ReturnType<typeof template>) => t.ask.find((a) => a.topic === 'protein') as Json;

  it('3 unticked days: the options are 0, 1, 2 and 3 exactly', () => {
    const q = protein(template(21 * 60));
    assert.equal(q.question, "On how many of the 3 unticked days did you reach about 134 g of protein (or the Eating plan's target)?");
    assert.deepEqual(q.options, [0, 1, 2, 3].map((v) => ({ option: String(v), value: v })));
    assert.deepEqual([q.known.proteinTicks, q.known.unticked, q.fields], [4, ['2026-04-09', '2026-04-10', SUNDAY], ['proteinExtra']]);
  });

  it('the Sunday’s evening tick still ahead: today is left out, and the question says so', () => {
    const q = protein(template(18 * 60 + 30));
    assert.equal(q.question, "On how many of the 2 unticked days before today did you reach about 134 g of protein (or the Eating plan's target)?");
    assert.deepEqual(q.options.map((o: Json) => o.value), [0, 1, 2]);
    assert.deepEqual(q.known.today, { leftOut: true, tickAt: '20:00' });
    assert.match(q.answer, /^proteinExtra = the answer, 0 to 2: .* so a tick that comes later \(today's, at 20:00\) is not counted twice\.$/);
    assert.equal(protein(template(null)).known.unticked.length, 3, 'without a time (a later day), the Sunday counts');
  });

  it('every day ticked: nothing to ask', () => {
    const allTicked = (f: Files) => editJson(f, `v/5-System/Data/habits-data.json`, (h) => {
      for (const d of [3, 4, 6]) h.checkins[`hab-protein-2026-W15-${d}`] = '1';
    });
    const q = protein(template(21 * 60, allTicked));
    assert.deepEqual([q.open, q.answered, q.options], [false, false, [{ option: '0', value: 0 }]]);
    // A saved answer from earlier in the day does not bring it back: a question that does not apply is neither open nor answered.
    const saved = protein(template(21 * 60, allTicked, record({ date: SUNDAY, weekStart: '2026-04-06', proteinExtra: 1 })));
    assert.deepEqual([saved.open, saved.answered], [false, false]);
  });

  it('the answer is stored additively: a tick after it counts once', () => {
    const t = template(18 * 60 + 30);
    const a = answersFromRecord(t);
    a.protein = 1;
    const r = recordFromAnswers(t, a);
    assert.deepEqual([r['proteinExtra'], 'proteinDays' in r ? r['proteinDays'] : undefined], [1, undefined]);
    // Monday: the week's protein days are its ticks as they are now, plus the answer.
    const item = vault(SUNDAY).tr.tracking!.items.find((x) => x.id === 'protein') as TrackedItem;
    const weeks = (ticks: string[], rec: Json) => proteinWeeks({ item, tracking: { days: Object.fromEntries(ticks.map((d) => [d, { protein: { done: true } }])) }, habits: null, date: '2026-04-13', since: '2026-03-30', checkins: [{ date: SUNDAY, weekStart: '2026-04-06', ...rec }] }).value.at(-1)!;
    const before = ['2026-04-06', '2026-04-07', '2026-04-08', '2026-04-11'];
    assert.deepEqual([weeks(before, { proteinExtra: 1 }).ticked, weeks(before, { proteinExtra: 1 }).checkin], [4, 5]);
    // The Sunday's tick at 20:05: 5 ticked, 6 days in all, not the 4 + 1 the answer said, nor 7.
    assert.deepEqual([weeks([...before, SUNDAY], { proteinExtra: 1 }).ticked, weeks([...before, SUNDAY], { proteinExtra: 1 }).checkin], [5, 6]);
    // A record from before 0.14.0 still reads: its total as saved.
    assert.equal(weeks([...before, SUNDAY], { proteinDays: 4 }).checkin, 4);
    assert.equal(weeks(['2026-04-06', '2026-04-07', '2026-04-08', '2026-04-09', '2026-04-10', '2026-04-11', SUNDAY], { proteinExtra: 3 }).checkin, 7, 'never more than the week’s days');
  });

  it('proteinExtra: a whole number from 0 to 7 (validate.ts and the JSON Schema)', () => {
    const log = (x: unknown) => ({ schemaVersion: 1, checkins: [{ date: SUNDAY, weekStart: '2026-04-06', proteinExtra: x }] });
    assert.deepEqual(validateCheckinLog(log(2)), []);
    assert.equal(validateCheckinLog(log(8))[0]!.path, 'checkins[0].proteinExtra');
    assert.equal(validateCheckinLog(log(1.5))[0]!.message, 'expected a whole number');
  });

  it('the CLI: --time on the date, else the clock today', () => {
    const cli = (...argv: string[]) => JSON.parse(run(['checkin', 'template', '--vault', 'v', ...argv], memoryIo(files(), SUNDAY)).stdout) as Json;
    const q = (o: Json) => o.ask.find((a: Json) => a.topic === 'protein');
    assert.match(q(cli('--date', SUNDAY, '--time', '18:30')).question, /of the 2 unticked days before today/);
    assert.match(q(cli('--date', SUNDAY, '--time', '20:30')).question, /of the 3 unticked days did/);
    const io = { ...memoryIo(files(), SUNDAY), clock: () => ({ minutes: 19 * 60, offsetMinutes: 0 }) };
    assert.match(q(JSON.parse(run(['checkin', 'template', '--vault', 'v'], io).stdout)).question, /before today/);
    const late = { ...memoryIo(files(), '2026-04-13'), clock: () => ({ minutes: 9 * 60, offsetMinutes: 0 }) };
    assert.match(q(JSON.parse(run(['checkin', 'template', '--vault', 'v', '--date', SUNDAY], late).stdout)).question, /of the 3 unticked days did/, 'on Monday the Sunday is over');
  });

  it('the Check-in screen asks the same, with now and what is tracked', () => {
    const { read, tr } = vault(SUNDAY);
    const c = buildCheckin(read, SUNDAY, null, { minutes: 18 * 60 + 30, tracking: tr });
    const q = c.sunday!.template.ask.find((a) => a.topic === 'protein') as Json;
    assert.deepEqual(q.options.map((o: Json) => o.value), [0, 1, 2]);
    assert.equal(c.sunday!.proteinFloorG, 134);
  });
});

// ---------------------------------------------------------------- 4. a saved record's questions are answered

describe('the template with a saved record', () => {
  // Saved on Sunday: the gap days answered (Thu 9 Apr rest, Sun 12 Apr missed), effort, the week outside training and protein; not yet recovery, pain or the rest.
  const some = record({ date: SUNDAY, weekStart: '2026-04-06', confirmedUnlogged: [], restDays: ['2026-04-09'], missedDays: [SUNDAY], effort: 7, stress: 2, proteinExtra: 1, knownBusy: [] });

  it('a question whose fields the record fills is answered, not open; a null field keeps it open', () => {
    const { read, tr } = vault(SUNDAY, some);
    const t = buildTemplate(read.data, SUNDAY, null, { now: { date: SUNDAY, minutes: 21 * 60 }, tracking: tr });
    assert.equal(t.existing, true);
    const by = Object.fromEntries(t.ask.map((a) => [a.topic, [a.open, a.answered]]));
    assert.deepEqual(by['gaps'], [false, true]);
    assert.deepEqual(by['effort'], [false, true]);
    assert.deepEqual(by['life'], [false, true]);
    assert.deepEqual(by['protein'], [false, true]);
    assert.deepEqual(by['recovery'], [true, false]);
    assert.deepEqual(by['pain'], [true, false]);
    assert.deepEqual(by['enjoyment'], [true, false]);
    // An empty knownBusy is the skeleton's default as well as "Normal": still asked.
    assert.deepEqual(by['availability'], [true, false]);
  });

  it('without a record nothing is answered; a gap day left open keeps the gaps question open', () => {
    const { read } = vault(SUNDAY);
    assert.ok(buildTemplate(read.data, SUNDAY, null).ask.every((a) => a.answered === false));
    const half = record({ date: SUNDAY, weekStart: '2026-04-06', restDays: ['2026-04-09'], effort: 7 });
    const t = buildTemplate(vault(SUNDAY, half).read.data, SUNDAY, null);
    assert.deepEqual([t.ask.find((a) => a.topic === 'gaps')!.open, t.ask.find((a) => a.topic === 'effort')!.open], [true, false]);
  });

  it('the Check-in screen still shows the answered questions, to edit, with their answers', () => {
    const { read, tr } = vault(SUNDAY, some);
    const c = buildCheckin(read, SUNDAY, null, { minutes: 21 * 60, tracking: tr });
    const topics = c.sunday!.template.ask.map((a) => a.topic);
    for (const t of ['gaps', 'effort', 'life', 'protein', 'recovery']) assert.ok(topics.includes(t), t);
    assert.deepEqual([c.sunday!.answers.effort, c.sunday!.answers.stress, c.sunday!.answers.protein, c.sunday!.answers.recovery], [7, 2, 1, null]);
  });

  it('a letter dated on or after the Sunday is not "the last letter" its question asks about', () => {
    const { read } = vault(SUNDAY);
    const own = buildTemplate(read.data, SUNDAY, { path: `${FIT}/Coach/Letters/${SUNDAY}.md`, focus: 'Sleep by 23:00' });
    const last = buildTemplate(read.data, SUNDAY, { path: `${FIT}/Coach/Letters/2026-04-05.md`, focus: 'Sleep by 23:00' });
    const k = (t: typeof own) => (t.ask.find((a) => a.topic === 'decisions') as Json).known.lastLetter;
    assert.deepEqual([k(own), k(last)?.focus], [null, 'Sleep by 23:00']);
  });
});

// ---------------------------------------------------------------- 5. "trained, not logged" reaches the strip, the card and the review

describe('a day the Sunday check-in says was trained', () => {
  // Sun 12 Apr: S3 done but not logged, the Workout not ticked; the check-in at 18:30 says "trained, not logged".
  const confirmed = record({ date: SUNDAY, weekStart: '2026-04-06', confirmedUnlogged: [{ date: SUNDAY, type: 'S3' }], restDays: [], missedDays: [] });
  const logged = (f: Files) => editJson(f, LOG, (l) => void l.sessions.push({ date: SUNDAY, type: 'S3', lift1: null, lift2: null, durationMin: 25, cardioMin: 25, cardioMode: 'walk', rating: null, postureDrill: false, notes: '' }));
  const strip = (...edits: ((f: Files) => void)[]) => buildToday(vault(SUNDAY, ...edits).read, SUNDAY, 'full', 'v').week.find((d) => d.date === SUNDAY)!;
  const train = (time: string, ...edits: ((f: Files) => void)[]) => {
    const { read, tr } = vault(SUNDAY, ...edits);
    const d = buildDue(read.data, tr, momentAt(SUNDAY, time, 0));
    return { card: d.due.value.cards.some((c) => c.kind === 'train'), needed: d.today.value.train.needed };
  };

  it('Today’s strip: trained, not logged (not "No entry"); trained once it is logged', () => {
    assert.equal(strip().state, 'none');
    assert.deepEqual([strip(confirmed).state, strip(confirmed).confirmed], ['unlogged', true]);
    assert.deepEqual([strip(confirmed, logged).state, strip(confirmed, logged).confirmed], ['trained', undefined]);
  });

  it('the 20:00 "Did you train?" card does not ask; nor on a day the check-in marks rest or missed', () => {
    assert.deepEqual(train('20:05'), { card: true, needed: true });
    assert.deepEqual(train('20:05', confirmed), { card: false, needed: false });
    assert.deepEqual(train('20:05', record({ date: SUNDAY, weekStart: '2026-04-06', missedDays: [SUNDAY] })), { card: false, needed: false });
    assert.deepEqual(train('20:05', record({ date: SUNDAY, weekStart: '2026-04-06', restDays: [SUNDAY] })), { card: false, needed: false });
    const t = trainingToday(vault(SUNDAY, confirmed).read.data, SUNDAY);
    assert.deepEqual([t.confirmedTrained, t.missedMarked, t.restMarked], [true, false, false]);
  });

  it('the review counts it as done but not logged only while nothing is logged on it', () => {
    const open = buildReview(vault(SUNDAY, confirmed).read.data, SUNDAY).adherence;
    assert.equal(open.value.weeks.at(-1)!.confirmedUnlogged, 1);
    assert.match(open.reason.note!, /1 session\(s\) the check-ins confirm as done but not logged/);
    const done = buildReview(vault(SUNDAY, confirmed, logged).read.data, SUNDAY).adherence;
    assert.equal(done.value.weeks.at(-1)!.confirmedUnlogged, 0);
    assert.doesNotMatch(done.reason.note!, /confirm as done but not logged/);
  });

  it('dayMarks: the day’s own mark first, then the check-in’s', () => {
    const marks = dayMarks([{ date: '2026-04-09', mark: 'rest' }], [{ date: SUNDAY, missedDays: ['2026-04-09', '2026-04-10'], confirmedUnlogged: [{ date: SUNDAY }] }], SUNDAY);
    assert.deepEqual([marks('2026-04-09'), marks('2026-04-10'), marks(SUNDAY), marks('2026-04-11')], [{ mark: 'rest' }, { mark: 'missed' }, { confirmed: true }, undefined]);
    assert.equal(dayMarks([], [{ date: SUNDAY, missedDays: ['2026-04-10'] }], '2026-04-11')('2026-04-10'), undefined, 'a check-in dated after the day asked about is not read yet');
  });
});

// ---------------------------------------------------------------- 6. the coach step once its letter is in

describe('due: the coach step stays, done, until the next Sunday', () => {
  const LETTER = `${FIT}/Coach/Letters/${SUNDAY}.md`;
  const saved = (f: Files) => {
    record({ date: SUNDAY, weekStart: '2026-04-06', effort: 7 })(f);
    f[LETTER] = `---\ntype: coach-letter\ndate: ${SUNDAY}\nfocus: Protein at breakfast\n---\n\n# Week 6 letter\n`;
  };
  const due = (date: string, time: string) => JSON.parse(run(['due', '--vault', 'v', '--date', date, '--time', time], memoryIo(files(saved), date)).stdout) as Json;

  for (const [date, time] of [[SUNDAY, '21:00'], ['2026-04-13', '09:00'], ['2026-04-18', '18:30']] as const) {
    it(`${date} ${time}: done, with the letter’s date, no card time and no card`, () => {
      const d = due(date, time);
      const c = d.today.value.coach;
      assert.deepEqual([c.state, c.date, c.letter, c.at], ['done', SUNDAY, SUNDAY, null]);
      assert.match(c.reason.note, /^The coach’s letter of Sun 12 Apr is in: the step after your answers for Sun 12 Apr is done, and no card comes\. The next step follows the Sunday check-in of Sun 19 Apr\.$/);
      assert.ok(!d.due.value.cards.some((x: Json) => x.kind === 'coach'));
    });
  }

  it('the next Sunday’s step takes over: answer first', () => {
    assert.deepEqual([due('2026-04-19', '09:00').today.value.coach.state, due('2026-04-19', '09:00').today.value.coach.date], ['answer-first', '2026-04-19']);
  });
});

// ---------------------------------------------------------------- 7. tracked against the eating plan

describe('tracked: the protein item against the eating plan’s floor', () => {
  const PLAN = `${FIT}/Coach/eating-plan.json`;
  // The Food mockup's plan, its floor set (the synthetic Protein item asks for 134 g).
  const withPlan = (floorG: number) => (f: Files) => {
    const p = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'food', 'eating-plan.json'), 'utf8'));
    p.protein = { ...p.protein, floorG, rangeG: [floorG, 184] };
    f[PLAN] = JSON.stringify(p);
  };
  const tracked = (...edits: ((f: Files) => void)[]) => (JSON.parse(run(['tracked', '--vault', 'v', '--date', '2026-04-10'], memoryIo(files(...edits), '2026-04-10')).stdout) as Json).protein;

  it('with a plan: compared with its floor, and no `track protein` hint', () => {
    const t = tracked(withPlan(134));
    assert.deepEqual([t.compare, t.items[0].follows], [{ floorG: 134, source: 'eating-plan' }, true]);
    assert.equal(t.note, "The protein item follows the eating plan's floor (134 g a day).");
    const off = tracked(withPlan(140));
    assert.deepEqual([off.items[0].follows, off.compare.floorG], [false, 140]);
    assert.doesNotMatch(off.note, /track protein/);
    assert.match(off.note, /^The eating plan's floor is 140 g a day \(Coach\/eating-plan\.json\); protein says 134\./);
  });

  it('without a plan: the engine’s target, as before', () => {
    const t = tracked();
    assert.equal(t.compare.source, 'engine');
    assert.equal(t.compare.floorG, t.value.targetG);
  });
});

// ---------------------------------------------------------------- 8. tests from before the cycle

describe('tests: this cycle’s only', () => {
  it('the 7 Mar test before a 30 Mar fresh start counts nowhere, and the reason says so', () => {
    const r = buildReview(vault(SUNDAY, fresh).read.data, SUNDAY);
    assert.deepEqual(r.tests.value, {});
    assert.match(r.tests.reason.note!, /The test of Sat 7 Mar came before this cycle and does not count/);
    for (const l of r.ladders) {
      assert.equal(l.test, undefined, l.id);
      assert.equal(l.testShowsLevel, undefined, l.id);
      assert.match(l.reason.note!, /Its latest test \(Sat 7 Mar\) is from before this cycle began on Mon 30 Mar: it does not count\./);
    }
  });

  it('in the cycle the test counts; only a ladder a plan session carries gets testShowsLevel', () => {
    // 10 Mar: the push-up ladder at level 1, the test's 12 push-ups show level 2.
    const on = '2026-03-10';
    const carried = buildReview(vault(on).read.data, on).ladders.find((l) => l.id === 'pushup')!;
    assert.deepEqual([carried.test?.value, carried.testShowsLevel], [12, { level: 2, name: 'Floor push-up' }]);
    const noPushups = (f: Files) => editJson(f, `${FIT}/plan-data.json`, (p) => void (p.sessions.S1 = p.sessions.S1.filter((i: Json) => i.ladder !== 'pushup')));
    const loose = buildReview(vault(on, noPushups).read.data, on).ladders.find((l) => l.id === 'pushup')!;
    assert.deepEqual([loose.test?.value, loose.testShowsLevel], [12, undefined]);
    assert.match(loose.reason.note!, /No plan session carries this ladder, so the test moves nothing\./);
  });

  it('Progress’s Skills: the hint follows the cycle in the All view too', () => {
    const { read } = vault(SUNDAY, fresh);
    const skills = buildProgressMore(read, SUNDAY, 'v', { scope: 'all' }).skills as Json;
    assert.ok(skills.ladders.every((l: Json) => l.testShowsLevel === null));
  });
});

// ---------------------------------------------------------------- 9. one rule for "morning check-in done"

describe('the morning check-in: one rule', () => {
  // The day's body record as given, and no answer to the morning card in nudges.json (the fixture's says done).
  const day = (d: Json) => (f: Files) => {
    editJson(f, BODY, (b) => void (b.days['2026-04-10'] = d));
    editJson(f, `${FIT}/Coach/nudges.json`, (n) => void delete n.days['2026-04-10'].morning);
  };
  const signals = (d: Json) => {
    const { read, tr } = vault('2026-04-10', day(d));
    const due = buildDue(read.data, tr, momentAt('2026-04-10', '10:00', 0));
    const c = buildCheckin(read, '2026-04-10', null);
    const g = checkinGlance(c, { body: null, due: due.today.value } as never);
    const line = (g.sums[0]!.text as (string | { b: string })[]).map((r) => (typeof r === 'string' ? r : r.b)).join('');
    const week = checkinWeek(read, '2026-04-10').mornings.find((m) => m.date === '2026-04-10')!.done;
    const phone = buildTrackDay(read.data, tr, '2026-04-10').morning.value.done;
    return { due: due.today.value.morning.done, card: due.due.value.cards.some((x) => x.kind === 'morning'), glance: /done/.test(line) && !/not done/.test(line), week, phone };
  };

  it('isMorningDone: checkedAt, or energy, soreness or sleep quality answered; numbers alone are not', () => {
    assert.deepEqual([{ checkedAt: '2026-04-10T07:10:00Z' }, { energy: 3 }, { soreness: 2 }, { sleepQ: 4 }, { sleepH: 7, rhr: 60, weight: 83 }, { steps: 9000 }, null].map(isMorningDone), [true, true, true, true, false, false, false]);
  });

  it('written by engine body (the answers, no checkedAt): done everywhere, no card', () => {
    assert.deepEqual(signals({ energy: 4, soreness: 2, sleepQ: 4, sleepH: 7, rhr: 61, weight: 83.2 }), { due: true, card: false, glance: true, week: true, phone: true });
  });

  it('Health’s numbers only: not done anywhere, the card still asks', () => {
    assert.deepEqual(signals({ sleepH: 7, rhr: 61, weight: 83.2, steps: 9000 }), { due: false, card: true, glance: false, week: false, phone: false });
  });
});

// ---------------------------------------------------------------- 10. validate on a letter

describe('validate: a coach letter', () => {
  const PATH = `${FIT}/Coach/Letters/${SUNDAY}.md`;
  const check = (text: string, path = PATH, ...flags: string[]) => {
    const r = run(['validate', path, ...flags], memoryIo({ [path]: text }, SUNDAY));
    return { code: r.code, out: JSON.parse(r.stdout) as Json };
  };
  const good = `---\ntype: coach-letter\ndate: ${SUNDAY}\nplanWeek: 6\nreadiness: watch   # one note\nfocus: Protein at breakfast, every day\n---\n\n# Week 6 letter\n`;

  it('the frontmatter Pahlavan reads: valid', () => {
    const { code, out } = check(good);
    assert.equal(code, 0);
    assert.deepEqual([out.kind, out.shape, out.valid, out.inferred], ['letter', 'letter', true, true]);
    assert.deepEqual(out.letter, { type: 'coach-letter', date: SUNDAY, focus: 'Protein at breakfast, every day' });
  });

  it('a wrong type, a bad date, no focus, no frontmatter: each an error naming the field', () => {
    assert.deepEqual(validateLetter(good.replace('coach-letter', 'letter')).map((e) => e.path), ['type']);
    assert.deepEqual(validateLetter(good.replace(SUNDAY, '2026-02-30')).map((e) => e.path), ['date']);
    assert.deepEqual(validateLetter(good.replace(/^focus:.*\n/m, '')).map((e) => e.path), ['focus']);
    assert.deepEqual(validateLetter('# Week 6 letter\n').map((e) => e.path), ['frontmatter']);
    const { code, out } = check(good.replace(/^focus:.*\n/m, ''));
    assert.deepEqual([code, out.valid, out.errors[0].message], [1, false, "focus: is required: the week's one focus, on one line"]);
  });

  it('a date that is not the file name’s: a warning (Pahlavan reads the frontmatter’s)', () => {
    const { code, out } = check(good.replace(`date: ${SUNDAY}`, 'date: 2026-04-13'));
    assert.deepEqual([code, out.warnings[0].code], [0, 'letter-date']);
  });

  it('other Markdown is not a file validate checks (exit 2); --kind letter takes any file as a letter', () => {
    const note = check('# Decisions\n', `${FIT}/Coach/Decisions.md`);
    assert.deepEqual([note.code, note.out.errors[0].code], [2, 'markdown']);
    const forced = check('# Decisions\n', `${FIT}/Coach/Decisions.md`, '--kind', 'letter');
    assert.deepEqual([forced.code, forced.out.errors[0].message], [1, 'frontmatter: missing: a letter starts with a --- block holding its type, date and focus']);
    const review = check(good.replace('coach-letter', 'mesocycle-review'), `${FIT}/review.md`);
    assert.deepEqual([review.code, review.out.kind], [0, 'letter'], 'a letter type in the frontmatter makes it a letter anywhere');
  });
});

// ---------------------------------------------------------------- 11. skipped lines for a session logged elsewhere

describe('session --freeze --skip: the checklist as the Log panel writes it', () => {
  const TODAY = '2026-04-10';
  const at = (date: string, ...edits: ((f: Files) => void)[]) => readVault(memoryIo(files(...edits), TODAY), 'v', { asOf: date });
  /** The checklist the Log panel's save writes for a new log of that session with those lines skipped. */
  const panel = (date: string, type: string, skipped: string[]) => {
    const r = at(date);
    const form = logFormFor(r, buildSession(r.data, date, 'full', { type }), date)!;
    for (const row of form.rows) if (row.line && skipped.includes(row.line)) row.done = false;
    const e = buildLogEntry(inputFromForm(form), { plan: r.raw?.plan, log: r.raw?.log, today: TODAY });
    assert.ok(e.ok);
    return e.entry['checklist'];
  };

  it('nothing skipped: every line done, as a new log from the panel', () => {
    const f = frozenList(at('2026-04-09'), { date: '2026-04-09', type: 'A', mode: 'full' }, TODAY);
    assert.ok(f.ok);
    assert.deepEqual(f.list.value.checklist, panel('2026-04-09', 'A', []));
    assert.deepEqual(f.list.value.checklist, { done: 5, total: 5, skipped: [] });
  });

  it('the lines named are skipped, word for word as the panel skips them (a paired line as a whole)', () => {
    const f = frozenList(at('2026-04-09'), { date: '2026-04-09', type: 'A', mode: 'full', skip: ['Zone 2 finisher', 'Face Pull + Band External Rotation'] }, TODAY);
    assert.ok(f.ok);
    assert.deepEqual(f.list.value.checklist, panel('2026-04-09', 'A', ['Face Pull + Band External Rotation', 'Zone 2 finisher']));
    assert.deepEqual(f.list.value.checklist.skipped, ['Face Pull + Band External Rotation', 'Zone 2 finisher'], 'in the checklist’s order');
    assert.equal(f.list.value.exercises.length, 5, 'the exercise list keeps every plan line');
  });

  it('a ladder’s line by its level that day; one half of a pair, or a name that is no line, is refused', () => {
    // S1 on 7 Apr: "Handstand (your level)" is the chest-to-wall handstand that day; the push-up ladder is paired with the dead bug.
    const f = frozenList(at('2026-04-07'), { date: '2026-04-07', type: 'S1', mode: 'full', skip: ['chest-to-wall handstand'] }, TODAY);
    assert.ok(f.ok);
    assert.deepEqual(f.list.value.checklist.skipped, ['Handstand (your level)']);
    const pair = frozenList(at('2026-04-07'), { date: '2026-04-07', type: 'S1', mode: 'full', skip: ['Floor push-up'] }, TODAY);
    assert.ok(!pair.ok && /^"Floor push-up" is one part of the paired line "Push-up \(your level\) \+ Dead Bug": the Log panel skips a paired line as a whole, so name the line$/.test(pair.error), JSON.stringify(pair));
    const half = frozenList(at('2026-04-09'), { date: '2026-04-09', type: 'A', mode: 'full', skip: ['Face Pull'] }, TODAY);
    assert.ok(!half.ok && /is one part of the paired line "Face Pull \+ Band External Rotation"/.test(half.error));
    const none = frozenList(at('2026-04-09'), { date: '2026-04-09', type: 'A', mode: 'full', skip: ['Plank'] }, TODAY);
    assert.ok(!none.ok && /^"Plank" is not a line of A on Thu 9 Apr; its lines: Warm-up; Goblet Squat;/.test(none.error));
  });

  it('the CLI: --skip "<name>,<name>", a name with a comma kept whole; the adapter reads the skips back', () => {
    const withComma = (f: Files) => editJson(f, `${FIT}/plan-data.json`, (p) => void (p.sessions.A[0].name = 'Goblet Squat, heels up'));
    const r = run(['session', '--vault', 'v', '--freeze', '--type', 'A', '--date', '2026-04-09', '--skip', 'Goblet Squat, heels up,Zone 2 finisher'], memoryIo(files(withComma), TODAY));
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout) as Json;
    assert.deepEqual(out.freeze.value.checklist, { done: 3, total: 5, skipped: ['Goblet Squat, heels up', 'Zone 2 finisher'] });
    assert.match(out.freeze.reason.note, /The entry's `checklist` as the Log panel writes it: 3 of 5 lines done, skipped: Goblet Squat, heels up; Zone 2 finisher\./);
    const bad = run(['session', '--vault', 'v', '--type', 'A', '--skip', 'Zone 2 finisher'], memoryIo(files(), TODAY));
    assert.match(bad.stderr, /--lift1, --lift2 and --skip go with --freeze/);
  });

  it('a skipped ladder line reads back as that day’s level skipped', () => {
    // S1 on 7 Apr logged by the coach with its frozen list and the panel's checklist, the ladder line skipped.
    const f = frozenList(at('2026-04-07'), { date: '2026-04-07', type: 'S1', mode: 'full', skip: ['Handstand (your level)'] }, TODAY);
    assert.ok(f.ok);
    const entry = { date: '2026-04-07', type: 'S1', lift1: null, lift2: null, durationMin: 15, cardioMin: 0, cardioMode: '', rating: null, postureDrill: false, notes: '', checklist: f.list.value.checklist, exercises: f.list.value.exercises };
    const r = at(TODAY, (x) => editJson(x, LOG, (l) => void (l.sessions = [...l.sessions.filter((s: Json) => s.date !== '2026-04-07'), entry])));
    const s7 = r.data.sessions.find((s) => s.date === '2026-04-07')!;
    const level = f.list.value.exercises[0]!.name;
    assert.ok(s7.skipped?.length === 1 && r.data.program.exercises[s7.skipped[0]!]?.name === level, `${JSON.stringify(s7.skipped)} is ${level}`);
  });
});

// The due rules on their own: a day the check-in says was trained, with no session logged.
describe('dueNow and dueToday: the check-in’s days', () => {
  it('confirmedTrained or missedMarked: no "Did you train?" and nothing needed', () => {
    const base = { now: momentAt(SUNDAY, '20:10', 0), tracking: null, nudges: null, body: null, habits: null, program: null };
    for (const t of [{ confirmedTrained: true }, { missedMarked: true }, {}]) {
      const training = { logged: new Set<string>(), plannedToday: true, ...t };
      const asks = Object.keys(t).length === 0;
      assert.equal(dueNow({ ...base, training }).value.cards.some((c) => c.kind === 'train'), asks, JSON.stringify(t));
      assert.equal(dueToday({ ...base, training }).value.train.needed, asks, JSON.stringify(t));
    }
  });
});
