// The fresh-start rule: the cycle starts at the newest baseline note (else
// the first logged plan session's Monday, else nothing marks one); every
// Progress view counts from it by default and shows everything with "all";
// Today, the Plan and Check-in count from it too; readiness keeps its own
// rolling 28 days; and the Habits stats count from each item's start.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { readTracking } from '../src/adapters/vault/tracking-read.ts';
import { adherence, type Adherence } from '../src/core/adherence.ts';
import { adherenceSince, cycleStart, inScope, newestBaseline, scopeSince } from '../src/core/cycle.ts';
import { titleFor } from '../src/core/reason.ts';
import type { TrackedItem } from '../src/core/schema.ts';
import { summarizeDay, type SittingDay } from '../src/core/sitting.ts';
import { adherence30, dayCell, grid26, habitCheckinKey, sittingBars, streak, type HabitsView, type StatsContext } from '../src/core/tracking.ts';
import { cycleOf, logFrom, scopeInfo, withinCycle } from '../src/report/cycle.ts';
import { checkinWeek } from '../src/report/banners.ts';
import { buildBodyRecord, buildCheckin, buildPlan, buildProgress, buildProgressMore, buildToday } from '../src/report/index.ts';
import { ROOT } from './helpers.ts';

const VAULT = join(ROOT, 'test', 'fixtures', 'vault');
const FIT = join(VAULT, '3-Personal', 'Fitness');
const DATE = '2026-04-10'; // a Friday; the fixture's baselines are 2025-10-01 and 2026-02-23

/** The synthetic vault, with made-up extra baseline notes in the fitness folder (a fresh start). */
const io = (extra: string[] = []) => ({
  readText: (p: string) => (existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null),
  listDir: (p: string) => {
    if (!(existsSync(p) && statSync(p).isDirectory())) return null;
    const names = readdirSync(p);
    return p === FIT ? [...names, ...extra.map((d) => `Baseline - ${d}.md`)] : names;
  },
});
const vault = (extra: string[] = [], date = DATE) => readVault(io(extra), VAULT, { asOf: date });
type Plan = Extract<ReturnType<typeof buildPlan>, { templates: unknown }>;
const plan = (...args: Parameters<typeof buildPlan>) => buildPlan(...args) as Plan;

/** Every ISO date in the values a screen shows, skipping reasons, window bounds and before-the-cycle cells. */
function datesIn(x: unknown, out: string[] = [], key = ''): string[] {
  if (typeof x === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(x) && !/^(from|to|since|start|cycleStart|planStart|weekStart|until|nextOpens|yesterday)$/.test(key)) out.push(x);
    return out;
  }
  if (Array.isArray(x)) {
    for (const v of x) datesIn(v, out, key);
    return out;
  }
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    if (o['beforeCycle'] === true || o['beforeStart'] === true) return out;
    for (const [k, v] of Object.entries(o)) if (!['reason', 'reasons', 'sources', 'warnings', 'errors', 'cycle', 'adherenceReason', 'readiness'].includes(k)) datesIn(v, out, k);
  }
  return out;
}

describe('the cycle start', () => {
  it('is the newest baseline note when there is one', () => {
    const r = cycleStart({ baselines: ['2026-02-23'], firstPlanSession: '2026-03-04', date: DATE });
    assert.deepEqual(r.value, { start: '2026-02-23', source: 'baseline' });
    assert.equal(r.reason.rule, 'cycle.start');
    assert.equal(titleFor(r.reason.rule), 'Cycle start');
    assert.match(r.reason.note!, /Mon 23 Feb, the date of the newest baseline note/);
    assert.equal(r.reason.inputs['note'], 'Baseline - 2026-02-23.md');
  });

  it('takes the newest of several, in any order, and says the older ones mark earlier cycles', () => {
    const r = cycleStart({ baselines: ['2026-02-23', '2025-10-01', 'not a date', '2026-03-30'], firstPlanSession: null, date: DATE });
    assert.deepEqual(r.value, { start: '2026-03-30', source: 'baseline' });
    assert.match(r.reason.note!, /2 older ones mark earlier cycles/);
    assert.deepEqual(r.reason.inputs['baselines'], ['2025-10-01', '2026-02-23', '2026-03-30']);
  });

  it('ignores a baseline dated after the day (a cycle that has not begun)', () => {
    assert.equal(cycleStart({ baselines: ['2026-02-23', '2026-05-04'], firstPlanSession: null, date: DATE }).value.start, '2026-02-23');
    assert.equal(newestBaseline(['2026-02-23', '2026-05-04']), '2026-05-04', 'without a date, the newest (the weight trend\'s start, unchanged)');
  });

  it('falls back to the Monday of the first logged plan session without a baseline note', () => {
    const r = cycleStart({ baselines: [], firstPlanSession: '2026-03-04', date: DATE });
    assert.deepEqual(r.value, { start: '2026-03-02', source: 'plan' });
    assert.match(r.reason.note!, /No baseline note: the cycle starts on Mon 2 Mar/);
  });

  it('marks no cycle without either: everything counts', () => {
    const r = cycleStart({ baselines: [], firstPlanSession: null, date: DATE });
    assert.deepEqual(r.value, { start: null, source: 'all' });
    assert.equal(scopeSince(r.value, 'cycle'), null);
    assert.equal(inScope('2020-01-01', null), true);
  });

  it('is the first day counted for "This cycle" and nothing for "All"', () => {
    const c = { start: '2026-03-23', source: 'baseline' as const };
    assert.equal(scopeSince(c, 'cycle'), '2026-03-23');
    assert.equal(scopeSince(c, 'all'), null);
    assert.deepEqual([inScope('2026-03-22', '2026-03-23'), inScope('2026-03-23', '2026-03-23')], [false, true]);
  });

  it('reads the vault: the newest baseline note, and the adapter keeps every one', () => {
    const r = vault(['2026-03-23']);
    assert.deepEqual(r.data.plan.baselines, ['2025-10-01', '2026-02-23', '2026-03-23']);
    assert.equal(r.data.plan.cycleStart, '2026-03-23', 'the weight trend starts there, as before');
    assert.deepEqual(cycleOf(r.data, DATE).value, { start: '2026-03-23', source: 'baseline' });
    // Without baseline notes: the first logged plan session's Monday.
    const none = vault();
    none.data.plan.baselines = [];
    assert.deepEqual(cycleOf(none.data, DATE).value, { start: none.data.plan.start, source: 'plan' });
  });
});

describe('adherence from the cycle start', () => {
  const sessions = [] as Parameters<typeof adherence>[0]['sessions'];
  const a: Adherence = adherence({ sessions, today: DATE, target: { lift: 3, short: 1 } }).value;

  it('keeps only the complete weeks on or after the start, summed again', () => {
    assert.deepEqual(a.weeks.map((w) => w.weekOf), ['2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30']);
    const r = adherenceSince(a, '2026-03-23');
    assert.deepEqual(r.value!.weeks.map((w) => w.weekOf), ['2026-03-23', '2026-03-30']);
    assert.deepEqual([r.value!.lifting.planned, r.value!.short.planned, r.value!.from], [6, 2, '2026-03-23']);
    assert.match(r.reason.note!, /2 complete weeks since the cycle began on Mon 23 Mar \(2 earlier left out\)/);
  });

  it('leaves a first week that started mid-cycle-week out, and is null before any complete week', () => {
    assert.equal(adherenceSince(a, '2026-03-25').value!.weeks.length, 1, 'the week of Wed 25 Mar is not complete in the cycle');
    const r = adherenceSince(a, '2026-04-06');
    assert.equal(r.value, null);
    assert.match(r.reason.note!, /No complete week since the cycle began on Mon 6 Apr yet/);
  });

  it('keeps all four weeks without a start', () => {
    assert.equal(adherenceSince(a, null).value, a);
  });
});

describe('scoping the data', () => {
  it('drops everything dated before the start, and starts the weight trend there; "all" keeps it all', () => {
    const r = vault();
    const s = withinCycle(r.data, '2026-03-23');
    assert.ok(r.data.sessions.some((x) => x.date < '2026-03-23'), 'the fixture has data before');
    for (const xs of [s.sessions, s.checkins.daily, s.body.weights, s.body.tape, s.body.tests, s.body.photos]) assert.ok(xs.every((x) => x.date >= '2026-03-23'));
    assert.ok(s.sessions.length > 0 && s.checkins.daily.length > 0, 'and keeps what came after');
    assert.equal(s.plan.cycleStart, '2026-03-23');
    assert.equal(s.program, r.data.program, 'the plan stays');
    const all = withinCycle(r.data, null);
    assert.equal(all.sessions, r.data.sessions);
    assert.equal(all.plan.cycleStart, null, 'All: the weight trend takes every weigh-in');
  });

  it('trims the dashboard log to the cycle for the month count, the recent list and the record notice', () => {
    const log = { sessions: [{ date: '2026-03-20', type: 'A' }, { date: '2026-03-24', type: 'B' }], ladders: { pullup: [] } };
    assert.deepEqual(logFrom(log, '2026-03-23'), { sessions: [{ date: '2026-03-24', type: 'B' }], ladders: { pullup: [] } });
    assert.equal(logFrom(log, null), log);
    assert.equal(logFrom(null, '2026-03-23'), null);
  });
});

describe('Progress counts from the cycle start by default', () => {
  const read = vault(['2026-03-23']);
  const p = buildProgress(read, DATE);
  const all = buildProgress(read, DATE, '', { scope: 'all' });

  it('says which range and from when', () => {
    assert.deepEqual([p.cycle.scope, p.cycle.start, p.cycle.since, p.cycle.source], ['cycle', '2026-03-23', '2026-03-23', 'baseline']);
    assert.deepEqual([all.cycle.scope, all.cycle.since], ['all', null]);
  });

  it('shows nothing from before it: the calendar, strength, weight, sets per muscle', () => {
    const shown = datesIn({ volume: p.volume, calendar: p.calendar, lifts: p.lifts, weight: p.weight });
    assert.ok(shown.length > 0);
    assert.deepEqual(shown.filter((d) => d < '2026-03-23'), []);
    // All shows the earlier data.
    assert.ok(datesIn({ calendar: all.calendar, lifts: all.lifts, weight: all.weight }).some((d) => d < '2026-03-23'));
  });

  it('greys the calendar before the cycle and counts its complete weeks only', () => {
    const before = p.calendar!.days.filter((d) => d.beforeCycle);
    assert.ok(before.length > 0 && before.every((d) => d.date < '2026-03-23' && d.state === 'none' && !d.sessions.length));
    assert.ok(p.calendar!.days.filter((d) => !d.beforeCycle).every((d) => d.date >= '2026-03-23'));
    assert.deepEqual(p.calendar!.adherence!.weeks.map((w) => w.weekOf), ['2026-03-23', '2026-03-30']);
    assert.equal(all.calendar!.adherence!.weeks.length, 4);
    assert.equal(p.calendar!.firstEntry! >= '2026-03-23', true);
  });

  it('starts strength trends and the weight trend at the cycle', () => {
    assert.ok(p.lifts.every((l) => l.sets.every((s) => s.date >= '2026-03-23')));
    assert.equal(p.weight!.since, '2026-03-23');
    assert.ok(p.weight!.points[0]!.date >= '2026-03-23');
    assert.ok(all.weight!.points[0]!.date < '2026-02-23', 'All: every weigh-in, earlier cycles too');
  });

  it('clips the 4-week sets to the cycle, averaged over at least a week', () => {
    assert.equal(p.volume!.views.four.from, '2026-03-23');
    assert.equal(p.volume!.views.four.label, 'This cycle');
    assert.equal(all.volume!.views.four.label, '4 weeks');
    const fresh = buildProgress(vault(['2026-04-08']), DATE);
    assert.equal(fresh.volume!.views.four.from, '2026-04-08');
    assert.match(fresh.volume!.views.four.note!, /as one week/);
  });

  it('reads readiness from this cycle’s mornings in both ranges: the chart starts at the cycle, the first score after 14 mornings', () => {
    assert.deepEqual(p.readiness, all.readiness, 'the range switch does not change readiness');
    assert.deepEqual([p.readiness!.from, p.readiness!.since], ['2026-03-23', '2026-03-23'], 'the chart starts at the cycle, not 28 days back');
    assert.match(p.readiness!.note, /^This cycle's mornings only, since Mon 23 Mar/);
    // 14 mornings from 23 Mar to 6 Apr (none on the 29th): the 15th, on 7 Apr, is the first scored.
    assert.equal(p.readiness!.baseline.value.building, false);
    assert.equal(p.readiness!.points[0]!.date, '2026-04-07');
    // A fresher cycle is still building: no score, and the note says how far.
    const fresh = buildProgress(vault(['2026-04-01']), DATE);
    assert.deepEqual(fresh.readiness!.points, []);
    assert.deepEqual([fresh.readiness!.baseline.value.building, fresh.readiness!.baseline.value.mornings], [true, 10]);
    assert.equal(fresh.notes.find((n) => n.code === 'no-readiness')!.text, 'Building your baseline: 10 of 14 morning check-ins this cycle; train as planned meanwhile.');
  });

  it('is unchanged by the default when the cycle started before the data (the fixture as it is)', () => {
    const r = vault();
    const d = buildProgress(r, DATE);
    assert.equal(d.cycle.since, '2026-02-23');
    assert.deepEqual(d.lifts.map((l) => l.sets.length), buildProgress(r, DATE, '', { scope: 'all' }).lifts.map((l) => l.sets.length));
  });
});

describe('Training, Body, Health and Skills count from the cycle start by default', () => {
  const read = vault(['2026-03-23']);
  const m = buildProgressMore(read, DATE);
  const all = buildProgressMore(read, DATE, '', { scope: 'all' });

  it('shows nothing from before it in any section', () => {
    const shown = datesIn({ training: m.training, body: m.body, health: m.health, skills: m.skills });
    assert.ok(shown.length > 0);
    assert.deepEqual(shown.filter((d) => d < '2026-03-23'), []);
    assert.ok(datesIn({ training: all.training, body: all.body, health: all.health, skills: all.skills }).some((d) => d < '2026-03-23'));
  });

  it('counts records, "since start" changes and buckets from the cycle', () => {
    for (const l of m.training!.lifts) assert.ok(l.records.sets.every((s) => s.date >= '2026-03-23'));
    assert.ok(m.training!.weeks.every((w) => w.to >= '2026-03-23'), 'plan weeks before the cycle are left out');
    assert.ok(m.training!.weeks.length < all.training!.weeks.length);
    assert.ok(m.training!.months.every((b) => b.to >= '2026-03-23'));
    assert.equal(m.body!.cycleStart, '2026-03-23');
    assert.ok(m.body!.tape.measures.every((x) => x.first!.date >= '2026-03-23'));
    assert.ok(m.health!.rhr!.firstDate >= '2026-03-23', 'resting HR "since the first week" is the cycle\'s first week');
    assert.ok(all.health!.rhr!.firstDate < '2026-03-23');
  });

  it('keeps each ladder\'s level and hides the dates reached before the cycle', () => {
    const l = m.skills!.ladders;
    assert.deepEqual(l.map((x) => x.level), all.skills!.ladders.map((x) => x.level), 'the level is where you are now');
    assert.ok(l.every((x) => !x.since || x.since >= '2026-03-23'));
    assert.ok(l.every((x) => x.path.every((p) => !p.reached || p.reached >= '2026-03-23')));
    assert.ok(m.skills!.ladders.every((x) => x.tests.every((t) => t.date >= '2026-03-23')));
  });

  it('says "this cycle" in its calm notes, and not with "all"', () => {
    const fresh = buildProgressMore(vault(['2026-04-10']), DATE);
    assert.ok(fresh.notes.some((n) => n.code === 'no-tape' && /this cycle/.test(n.text)));
    assert.ok(fresh.notes.some((n) => n.code === 'no-lifts' && /this cycle/.test(n.text)));
    assert.ok(buildProgressMore(vault(['2026-04-10']), DATE, '', { scope: 'all' }).notes.every((n) => !/this cycle/.test(n.text)));
  });
});

describe('Today, the Plan and Check-in count from the cycle start', () => {
  it('Today: the week strip marks the days before a cycle begun mid-week, whatever they hold', () => {
    const t = buildToday(vault(['2026-04-08']), DATE, 'full');
    assert.deepEqual(t.week.map((d) => [d.date, d.beforeCycle === true, d.state]).slice(0, 3), [['2026-04-06', true, 'none'], ['2026-04-07', true, 'none'], ['2026-04-08', false, t.week[2]!.state]]);
    assert.ok(t.week.filter((d) => d.beforeCycle).every((d) => !d.sessions.length));
    assert.equal(t.cycle.start, '2026-04-08');
    assert.ok(buildToday(vault(), DATE, 'full').week.every((d) => !d.beforeCycle));
  });

  it('Plan: the adherence row, the load of the weeks before, the targets and the decision log', () => {
    const decisions = '# Decisions\n\n## 2026-03-01 · Old plan\n\n- **Change:** an old change\n\n## 2026-03-24 · New plan\n\n- **Change:** the reset\n';
    const p = plan(vault(['2026-03-23']), DATE, { decisions });
    assert.equal(p.cycle.since, '2026-03-23');
    assert.deepEqual(p.decisions.map((d) => d.date), ['2026-03-24']);
    assert.deepEqual([p.targets.standing.adherence!.weeks, p.targets.standing.adherence!.planned], [2, 2 * vault().data.plan.weekTarget.lift]);
    assert.ok(p.load.weeks.every((w) => w.to >= '2026-03-23'));
    assert.ok(p.load.weeks.length < plan(vault(), DATE, { decisions }).load.weeks.length);
    assert.ok(plan(vault(['2026-04-06']), DATE).targets.standing.adherence === null, 'no complete week in the cycle yet');
  });

  it('Check-in: no Sunday check-in for a week that ended before the cycle began', () => {
    const c = buildCheckin(vault(['2026-04-06']), DATE, null);
    assert.equal(c.sunday, null);
    const n = c.notes.find((x) => x.code === 'sunday-before-cycle')!;
    assert.match(n.text, /The first Sunday check-in of this cycle opens Sun 12 Apr: last week ended before the cycle began on Mon 6 Apr/);
    assert.notEqual(buildCheckin(vault(), DATE, null).sunday, null, 'the fixture\'s own week is in its cycle');
  });

  it('Check-in: a week the cycle began in asks only about its days from the start', () => {
    // The week of 30 Mar to 5 Apr, with a cycle begun on Fri 3 Apr: Thu 2 Apr (nothing logged) is not asked about.
    const c = buildCheckin(vault(['2026-04-03'], '2026-04-05'), '2026-04-05', null);
    const gaps = c.sunday!.template.ask.find((a) => a.topic === 'gaps') as { question: string; known: { tickedNotLogged: string[]; noSessionNoTick: string[] } };
    assert.deepEqual(gaps.known.noSessionNoTick, ['2026-04-04', '2026-04-05']);
    assert.doesNotMatch(gaps.question, /Mon 30 Mar|Tue 31 Mar|Wed 1 Apr/, 'the sessions before the start are not listed');
    const whole = buildCheckin(vault([], '2026-04-05'), '2026-04-05', null).sunday!.template.ask.find((a) => a.topic === 'gaps') as typeof gaps;
    assert.deepEqual(whole.known.noSessionNoTick, ['2026-04-02', '2026-04-04', '2026-04-05'], 'without the fresh start, the whole week');
  });

  it('Check-in: a letter from before the cycle is not shown and its question not asked', () => {
    const letter = { path: '3-Personal/Fitness/Coach/Letters/2026-04-05.md', text: '# Week letter\n\n## Focus\n\nSleep by 23:00.\n' };
    const before = buildCheckin(vault(['2026-04-06']), DATE, letter);
    assert.equal(before.letter, null);
    assert.ok(before.notes.some((n) => n.code === 'no-letter' && /this cycle/.test(n.text)));
    assert.notEqual(buildCheckin(vault(), DATE, letter).letter, null);
  });

  it('Check-in: the banner counts this week\'s mornings from a cycle begun mid-week', () => {
    const w = checkinWeek(vault(['2026-04-08']), DATE);
    assert.deepEqual(w.mornings.filter((d) => d.before).map((d) => d.date), ['2026-04-06', '2026-04-07']);
    assert.deepEqual([w.morningsSoFar, w.total], [3, 6]);
    assert.equal(checkinWeek(vault(), DATE).total, 8);
  });

  it('Check-in: the body record\'s last entry is this cycle\'s (the schedule is unchanged)', () => {
    const tr = readTracking(io(['2026-03-25']), VAULT);
    const b = buildBodyRecord(vault(['2026-03-25']), tr, DATE);
    const tape = b.parts.find((x) => x.part === 'tape')!;
    const plain = buildBodyRecord(vault(), readTracking(io(), VAULT), DATE);
    assert.equal(plain.parts.find((x) => x.part === 'tape')!.last!.date, '2026-03-24');
    assert.equal(tape.last, null, 'the 24 Mar tape is the cycle before');
    assert.deepEqual([tape.nextDate, tape.due], [plain.parts.find((x) => x.part === 'tape')!.nextDate, plain.parts.find((x) => x.part === 'tape')!.due]);
    assert.equal(b.fixed.tapeFrom, DATE, 'a fixed schedule offered from today, not from the earlier tape');
  });

  it('every screen\'s scope rule on the same read agrees on the start', () => {
    const r = vault(['2026-03-23']);
    assert.deepEqual([scopeInfo(r.data, DATE).since, buildToday(r, DATE, 'full').cycle.since, plan(r, DATE).cycle.since, buildProgressMore(r, DATE).cycle.since], ['2026-03-23', '2026-03-23', '2026-03-23', '2026-03-23']);
  });
});

describe('Habits count from each item\'s start', () => {
  const TODAY = '2026-04-10';
  const item: TrackedItem = { id: 'floss', kind: 'tick', name: 'Flossing', schedule: { kind: 'daily' }, start: '2026-04-06', source: { by: 'user' }, habit: 'floss' };
  // The linked habit ticked every day of the four weeks before the item began, and on 7 and 9 Apr after.
  const checkins: Record<string, string> = {};
  for (let i = 1; i <= 28; i++) checkins[habitCheckinKey('floss', new Date(Date.UTC(2026, 3, 6 - i)).toISOString().slice(0, 10))] = '1';
  for (const d of ['2026-04-07', '2026-04-09']) checkins[habitCheckinKey('floss', d)] = '1';
  const habits: HabitsView = { habits: [{ id: 'floss', type: 'boolean' }], checkins };
  const ctx: StatsContext = { tracking: { days: {} }, habits, training: { logged: new Set(), today: TODAY } };

  it('reads a linked tick before the start as not started', () => {
    assert.deepEqual(dayCell(item, '2026-04-05', ctx), { date: '2026-04-05', state: 'none' });
    assert.equal(dayCell(item, '2026-04-07', ctx).state, 'taken');
    assert.equal(dayCell(item, '2026-04-07', ctx).via, 'habit', 'ticks after the start still come from the linked habit');
  });

  it('leaves the earlier ticks out of the streak and the 30 days', () => {
    const s = streak(item, ctx);
    assert.equal(s.value, 1, 'only 9 Apr in a row: 8 Apr broke it, the days before the start never count');
    assert.match(s.reason.note!, /counted from its start \(Mon 6 Apr\)/);
    const a = adherence30(item, ctx);
    assert.deepEqual([a.value.done, a.value.due], [2, 4], '6 to 9 Apr due; today is open');
    assert.match(a.reason.note!, /since its start \(Mon 6 Apr\)/);
  });

  it('draws every grid day before the start as not started', () => {
    const g = grid26(item, ctx);
    const before = g.cells.filter((c) => c.date < '2026-04-06');
    assert.ok(before.length > 150 && before.every((c) => c.state === 'none' && c.via === undefined));
  });

  it('draws no sitting before the start, not even the work timer\'s desk time', () => {
    const sit: TrackedItem = { id: 'sit', kind: 'sitting', name: 'Sitting', schedule: { kind: 'daily' }, start: '2026-04-06', source: { by: 'user' }, sitting: { limitMinutes: 360, stretchMaxMinutes: 45, awayMinutes: 5 } };
    const day = (date: string, source: 'pahlavan' | 'desk-time'): SittingDay => ({ ...summarizeDay(date, [{ start: Date.UTC(2026, 3, 1), end: Date.UTC(2026, 3, 1) + 420 * 60000 }], 'pahlavan'), source });
    const sitting = new Map<string, SittingDay>([['2026-04-03', day('2026-04-03', 'desk-time')], ['2026-04-08', day('2026-04-08', 'pahlavan')]]);
    const bars = sittingBars(sit, { ...ctx, sitting });
    assert.deepEqual(bars.find((b) => b.date === '2026-04-03'), { date: '2026-04-03', minutes: 0, longest: 0, overLimit: false, overStretch: false, today: false, beforeStart: true, source: 'none' });
    assert.deepEqual([bars.find((b) => b.date === '2026-04-08')!.minutes, bars.find((b) => b.date === '2026-04-08')!.beforeStart], [420, false]);
    assert.equal(bars.filter((b) => b.beforeStart).length, 28 - 5);
  });
});
