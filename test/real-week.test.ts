// The concurrent check on the user's real week (concurrent.ts's weekLayout):
// each session on the weekday the log shows it done most often in the last 2
// to 4 complete weeks of the cycle (a tie going to the latest), else on the
// days the profile says the user trains, else on the default layout; a
// session never logged falls back on its own, and the reasons name the
// source. `review` lays the written plan (or a draft) on it.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { checkConcurrent, loggedWeekdays, weekLayout, type LoggedSession, type PlannedSession } from '../src/core/concurrent.ts';
import { addDays } from '../src/core/dates.ts';
import type { Exercise, Weekday } from '../src/core/schema.ts';
import { buildReview, CALENDAR } from '../src/report/review.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

/** Sessions of each id on its weekday offset (0 = Monday) in the weeks from these Mondays. */
const weeksOf = (mondays: string[], days: Record<string, number>): LoggedSession[] =>
  mondays.flatMap((m) => Object.entries(days).map(([id, d]) => ({ date: addDays(m, d), id })));
const MONDAYS = ['2026-03-16', '2026-03-23', '2026-03-30', '2026-04-06'];
const SUNDAY = '2026-04-12';
const WEEK = [
  { id: 'A', kind: 'lift' as const },
  { id: 'B', kind: 'lift' as const },
  { id: 'C', kind: 'lift' as const },
  { id: 'D', kind: 'lift' as const },
  { id: 'S1', kind: 'short' as const },
  { id: 'S2', kind: 'short' as const },
  { id: 'S3', kind: 'short' as const },
];
const FALLBACK = { lift: CALENDAR.liftDays, short: CALENDAR.shortDays, hours: CALENDAR.hours };
const days = (r: ReturnType<typeof weekLayout>) => Object.fromEntries(r.value.sessions.map((s) => [s.id, `${['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'][s.day]} ${s.source}`]));

describe('loggedWeekdays: the weekday each session was done most often', () => {
  it('reads the last 4 complete weeks: lifting on Mon, Wed, Fri, Sat', () => {
    const r = loggedWeekdays(weeksOf(MONDAYS, { A: 0, B: 2, C: 4, D: 5 }), SUNDAY);
    assert.deepEqual(r.weeks, MONDAYS);
    assert.deepEqual(r.days, { A: 0, B: 2, C: 4, D: 5 });
    assert.deepEqual(r.counts['C'], [0, 0, 0, 0, 4, 0, 0]);
  });

  it('a tie goes to the weekday it was done on last; the week in progress is not read', () => {
    const log = [...weeksOf(MONDAYS.slice(0, 2), { A: 0 }), ...weeksOf(MONDAYS.slice(2), { A: 1 }), { date: '2026-04-14', id: 'A' }, { date: '2026-04-15', id: 'A' }];
    assert.equal(loggedWeekdays(log, '2026-04-16').days['A'], 1, 'Mon twice, Tue twice: Tue is the latest; this week (Tue and Wed) not complete');
    const back = [...weeksOf(MONDAYS.slice(0, 2), { A: 1 }), ...weeksOf(MONDAYS.slice(2), { A: 0 })];
    assert.equal(loggedWeekdays(back, SUNDAY).days['A'], 0);
  });

  it('needs 2 complete weeks of the cycle; a week that began before the cycle start is left out', () => {
    const log = weeksOf(MONDAYS, { A: 0 });
    assert.deepEqual(loggedWeekdays(log, SUNDAY, '2026-03-30').weeks, ['2026-03-30', '2026-04-06']);
    assert.deepEqual(loggedWeekdays(log, SUNDAY, '2026-03-31'), { weeks: [], days: {}, counts: {} }, 'one complete week of the cycle: no days');
    assert.deepEqual(loggedWeekdays(log, '2026-04-11', '2026-03-30').weeks, [], 'on the Saturday, only the week of 30 Mar is complete');
  });
});

describe('weekLayout: the log, else the available days, else the default layout', () => {
  it('a log where the lifting days are Mon, Wed, Fri, Sat', () => {
    const r = weekLayout({ sessions: WEEK, log: weeksOf(MONDAYS, { A: 0, B: 2, C: 4, D: 5, S1: 1, S2: 3, S3: 6 }), date: SUNDAY, fallback: FALLBACK });
    assert.deepEqual(days(r), { A: 'mon log', B: 'wed log', C: 'fri log', D: 'sat log', S1: 'tue log', S2: 'thu log', S3: 'sun log' });
    assert.deepEqual(r.value.sources, ['log']);
    assert.equal(r.reason.rule, 'concurrent.week');
    assert.match(r.reason.note ?? '', /^The week: A Mon, B Wed, C Fri, D Sat, S1 Tue, S2 Thu and S3 Sun \(your logged weeks\)\. /);
    assert.match(r.reason.note ?? '', /the weekday each was done on most often in the 4 complete weeks from Mon 16 Mar/);
    assert.ok(r.value.sessions.every((s) => s.hour === undefined), 'the log gives no start time');
  });

  it('a partial log: a session never logged falls back on its own', () => {
    const log = weeksOf(MONDAYS, { A: 0, B: 2 });
    const r = weekLayout({ sessions: WEEK, log, date: SUNDAY, fallback: FALLBACK });
    // C and D take the default lifting days left (Tue, Thu); the short days left are Sat and Sun, then Fri.
    assert.deepEqual(days(r), { A: 'mon log', B: 'wed log', C: 'tue default', D: 'thu default', S1: 'sat default', S2: 'sun default', S3: 'fri default' });
    assert.deepEqual(r.value.sources, ['log', 'default']);
    assert.match(r.reason.note ?? '', /A Mon and B Wed \(your logged weeks\); C Tue, D Thu, S1 Sat, S2 Sun and S3 Fri \(the default layout\)/);
    assert.match(r.reason.note ?? '', /C, D, S1, S2 and S3 not logged in them/);
    assert.match(r.reason.note ?? '', /The profile does not say which days you train\./);
    assert.equal(r.value.sessions.find((s) => s.id === 'C')!.hour, 17, 'a default day keeps the calendar hour');

    const avail = weekLayout({ sessions: WEEK, log, date: SUNDAY, available: ['mon', 'wed', 'fri', 'sat'], fallback: FALLBACK });
    assert.deepEqual(days(avail), { A: 'mon log', B: 'wed log', C: 'fri available', D: 'sat available', S1: 'sun default', S2: 'tue default', S3: 'thu default' });
    assert.match(avail.reason.note ?? '', /C Fri and D Sat \(your available days\)/);
    assert.match(avail.reason.note ?? '', /S1, S2 and S3: no free day left among the days you train \(Mon, Wed, Fri and Sat\)/);
  });

  it('no log: the available days, else the default layout as before', () => {
    const none = weekLayout({ sessions: WEEK, log: [], date: SUNDAY, fallback: FALLBACK });
    assert.deepEqual(days(none), { A: 'mon default', B: 'tue default', C: 'thu default', D: 'fri default', S1: 'wed default', S2: 'sat default', S3: 'sun default' });
    assert.deepEqual(none.value.sessions.map((s) => s.hour), [17, 17, 17, 17, 17, 10, 10]);
    assert.match(none.reason.note ?? '', /No session of the week was logged in the 4 complete weeks from Mon 16 Mar/);
    const early = weekLayout({ sessions: WEEK, date: SUNDAY, since: '2026-04-06', fallback: FALLBACK });
    assert.match(early.reason.note ?? '', /Fewer than 2 complete weeks since the cycle began on Mon 6 Apr, so the log does not set the days\./);
    const avail = weekLayout({ sessions: WEEK, date: SUNDAY, available: ['tue', 'thu', 'sat', 'sun', 'mon', 'wed', 'fri'], fallback: FALLBACK });
    assert.deepEqual(days(avail), { A: 'mon available', B: 'tue available', C: 'wed available', D: 'thu available', S1: 'fri available', S2: 'sat available', S3: 'sun available' });
    assert.deepEqual(avail.value.sources, ['available']);
  });

  it('a fifth lifting session takes a free day; one is left unplaced only when every day is taken', () => {
    const five = [...WEEK.slice(0, 4), { id: 'E', kind: 'lift' as const }, ...WEEK.slice(4, 6)];
    const r = weekLayout({ sessions: five, date: SUNDAY, fallback: FALLBACK });
    assert.deepEqual(days(r), { A: 'mon default', B: 'tue default', C: 'thu default', D: 'fri default', E: 'sun default', S1: 'wed default', S2: 'sat default' }, 'the others keep their days');
    assert.deepEqual(r.value.unplaced, []);
    const eight = weekLayout({ sessions: [...WEEK, { id: 'E', kind: 'lift' as const }], date: SUNDAY, fallback: FALLBACK });
    assert.deepEqual(eight.value.unplaced, ['E']);
    assert.match(eight.reason.note ?? '', /E: no free day left, so not checked\./);
  });
});

describe('the flags name where their days came from', () => {
  const EX: Record<string, Exercise> = { bench: { name: 'Bench', unit: 'kg', increment: 2.5, pattern: 'horizontal-push', muscles: { main: ['chest'], helps: [] } } };
  const lift = { kind: 'lift' as const, exercise: 'bench', repRange: [6, 8] as [number, number], rir: 2 };
  it('adds the days and their sources to the reason, not to the suggestion', () => {
    const week: PlannedSession[] = [{ id: 'A', day: 0, source: 'log', items: [lift] }, { id: 'B', day: 1, source: 'default', hour: 17, items: [lift] }];
    const [f] = checkConcurrent(week, EX);
    assert.equal(f!.value.flag, 'same-muscle-back-to-back');
    assert.doesNotMatch(f!.value.suggestion, /Days:/);
    assert.match(f!.reason.note ?? '', /Days: A Mon \(your logged weeks\); B Tue \(the default layout\)\.$/);
    assert.deepEqual(f!.reason.inputs['days'], [{ session: 'A', day: 'mon', source: 'log' }, { session: 'B', day: 'tue', source: 'default' }]);
    const [plain] = checkConcurrent(week.map(({ source: _, ...s }) => s), EX);
    assert.equal(plain!.reason.note, plain!.value.suggestion, 'no source: the reason as before');
  });
});

describe('review: the written plan on the user’s week', () => {
  const PLAN = 'v/3-Personal/Fitness/plan-data.json';
  const LOG = 'v/3-Personal/Fitness/fitness-log-data.json';
  const PROFILE = 'v/3-Personal/Fitness/Coach/profile.json';
  /** The synthetic vault with four lifting types (C and D copy A and B) and a log of these sessions from Mon 2 Mar. */
  const vault = (logDays: Record<string, number>, opts: { fixedDays?: Weekday[] } = {}) => {
    const f = fixtureFiles('v');
    const plan = JSON.parse(f[PLAN]!);
    plan.liftTypes = ['A', 'B', 'C', 'D'];
    plan.weekTarget = { lift: 4, short: 2 };
    plan.sessions.C = plan.sessions.A;
    plan.sessions.D = plan.sessions.B;
    plan.titles.C = 'Full Body C';
    plan.titles.D = 'Full Body D';
    f[PLAN] = JSON.stringify(plan);
    const log = JSON.parse(f[LOG]!);
    log.sessions = weeksOf(['2026-03-02', '2026-03-09', ...MONDAYS], logDays).filter((s) => s.date <= SUNDAY).map((s) => ({ date: s.date, type: s.id, durationMin: 45 }));
    f[LOG] = JSON.stringify(log);
    if (opts.fixedDays) {
      const p = JSON.parse(f[PROFILE]!);
      p.availability.fixedDays = opts.fixedDays;
      f[PROFILE] = JSON.stringify(p);
    }
    return buildReview(readVault(memoryIo(f, SUNDAY), 'v', { asOf: SUNDAY }).data, SUNDAY).concurrent;
  };
  const layout = (c: ReturnType<typeof vault>) => Object.fromEntries(c.layout.map((l) => [l.session, `${l.day} ${l.source}`]));

  it('lifting Mon, Wed, Fri, Sat in the log: the checks run on those days', () => {
    const c = vault({ A: 0, B: 2, C: 4, D: 5, S1: 1, S3: 6 });
    assert.deepEqual(layout(c), { A: 'mon log', B: 'wed log', C: 'fri log', D: 'sat log', S1: 'tue log', S3: 'sun log' });
    assert.match(c.note ?? '', /your logged weeks/);
    assert.doesNotMatch(c.note ?? '', /fixed week/);
    assert.ok(c.flags.length > 0);
    for (const f of [...c.flags, ...c.backToBack]) assert.match(f.reason.note ?? '', /Days: .*\(your logged weeks\)\.$/);
    // S3's conditioning circuit on Sunday is under a day before A's squat on Monday: flagged on the real
    // week, not on the default layout (S3 on Saturday at 10:00, 55 h before).
    const intervals = c.flags.find((f) => f.value.flag === 'intervals-before-heavy-legs');
    assert.deepEqual(intervals?.value.sessions, ['S3', 'A']);
    assert.match(intervals!.reason.note ?? '', /Days: S3 Sun and A Mon \(your logged weeks\)\./);
    assert.equal(vault({}).flags.filter((f) => f.value.flag === 'intervals-before-heavy-legs').length, 0);
    // C and D back to back on Friday and Saturday; A and B two days apart.
    assert.ok(c.flags.some((f) => f.value.sessions.join('>') === 'C>D'));
    assert.ok(c.backToBack.every((b) => `${b.value.first}>${b.value.second}` !== 'A>B'));
  });

  it('a partial log: the sessions never logged on the profile’s days, then the default layout', () => {
    const c = vault({ A: 0, B: 2 }, { fixedDays: ['mon', 'wed', 'fri', 'sat'] });
    assert.deepEqual(layout(c), { A: 'mon log', B: 'wed log', C: 'fri available', D: 'sat available', S1: 'sun default', S3: 'tue default' });
    assert.match(c.week.reason.note ?? '', /C, D, S1 and S3 not logged in them/);
    assert.match(c.note ?? '', /Its start times are the training calendar's: 17:30 on weekdays/);
  });

  it('no log in the cycle: the default layout, as before', () => {
    const c = vault({});
    assert.deepEqual(c.layout, [
      { session: 'A', day: 'mon', hour: 17, source: 'default' },
      { session: 'B', day: 'tue', hour: 17, source: 'default' },
      { session: 'C', day: 'thu', hour: 17, source: 'default' },
      { session: 'D', day: 'fri', hour: 17, source: 'default' },
      { session: 'S1', day: 'wed', hour: 17, source: 'default' },
      { session: 'S3', day: 'sat', hour: 10, source: 'default' },
    ]);
    assert.match(c.week.reason.note ?? '', /\(the default layout\)/);
  });
});
