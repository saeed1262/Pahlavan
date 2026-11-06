// The dashboard ports against the dashboard's own functions (golden cases cut
// out of view.js and run on the fixture vault by tools/golden-dashboard.mjs),
// the For today rules, the plan text, the shared checklist record (with the
// way Isfahan's briefing reads it) and the small lists.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { mergeMorning, morningFrom } from '../src/adapters/vault/body-write.ts';
import { mergeTodayChecklist } from '../src/adapters/vault/log-write.ts';
import {
  checklistTargets, choiceFromChecklist, chosenChecklist, dashboardReminders, dashChecklist, followChoice, guideFor, levelsText, nextTargetDash, planLinks, planNoteDash, planText, recentSessions, recordsIn, sessionsThisMonth, todayChecklistOf, toggledChecklist,
} from '../src/report/index.ts';
import { ROOT } from './helpers.ts';

const FIT = join(ROOT, 'test', 'fixtures', 'vault', '3-Personal', 'Fitness');
const PLAN = JSON.parse(readFileSync(join(FIT, 'plan-data.json'), 'utf8'));
const LOG_TEXT = readFileSync(join(FIT, 'fitness-log-data.json'), 'utf8');
const LOG = JSON.parse(LOG_TEXT);
const G = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'golden', 'dashboard-golden.json'), 'utf8'));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe('the dashboard’s functions, against view.js (golden)', () => {
  it('exercisesFor: every session, Express and deload, line for line', () => {
    assert.ok(G.checklists.length >= 10);
    for (const c of G.checklists) {
      const mine = dashChecklist(PLAN, c.type, c.express, c.deload).map((l) => ({ name: l.name, sr: l.sr, ...(l.steps.length ? { steps: l.steps } : {}) }));
      assert.deepEqual(mine, c.lines, `${c.type} express ${c.express} deload ${c.deload}`);
    }
  });
  it('getTodayChecklist, toggleCheck and savePlanChoice: the same record, key for key', () => {
    for (const c of G.state) {
      const log: Record<string, unknown> = clone(LOG);
      if (c.start) log['todayChecklist'] = c.start;
      else delete log['todayChecklist'];
      c.ops.forEach(([op, type, express, arg]: [string, string, boolean, number | boolean], i: number) => {
        const length = dashChecklist(PLAN, type, express, false).length;
        assert.equal(length, c.lengths[`${type}|${express}`], `${c.name}: length`);
        log['todayChecklist'] = op === 'tick' ? toggledChecklist(log, G.today, type, express, length, arg as number) : chosenChecklist(log, G.today, type, express, length, Boolean(arg));
        assert.equal(JSON.stringify(log['todayChecklist']), JSON.stringify(c.after[i]), c.name);
      });
    }
  });
  it('nextTarget for every lift, deload on and off, at three points in the log', () => {
    for (const c of G.targets) {
      const log = { ...LOG, sessions: LOG.sessions.filter((s: { date: string }) => s.date <= c.cut) };
      assert.deepEqual(nextTargetDash(PLAN, log, c.name, c.deload), c.out, `${c.name} ${c.cut} ${c.deload}`);
    }
  });
  it('planNote for every note, before and after its until date', () => {
    for (const c of G.notes) assert.deepEqual(planNoteDash(PLAN, c.type, c.name, c.date), c.out, `${c.type} ${c.name} ${c.date}`);
  });
  it('recordsIn against the log before the entry', () => {
    for (const c of G.records) assert.deepEqual(recordsIn(c.entry, LOG, PLAN), c.out, c.name);
  });
  it('guideEntries: titles, works, setup, do, avoid and the video, ladders set and unset', () => {
    for (const c of G.guide) {
      const log = clone(LOG);
      if (c.unset) delete log.ladders;
      const mine = guideFor(PLAN, log, c.name).map((e) => ({ title: e.title, unset: e.unset, works: e.works, setup: e.setup, do: e.do, avoid: e.avoid, video: e.video.url }));
      assert.deepEqual(mine, c.out, c.name);
    }
    assert.ok(G.guide.some((c: { out: unknown[] }) => c.out.length > 0));
  });
});

describe('the For today rules R1, R3 and R3b', () => {
  const base = { plan: PLAN, deload: false };
  it('R1: a pressing day, band external rotation first; after a session, the next lifting day', () => {
    // Wed 8 Apr has A logged; the focus becomes the next lifting day (B), which has no pressing.
    const upTo8 = { ...LOG, sessions: LOG.sessions.filter((s: { date: string }) => s.date <= '2026-04-08') };
    const r = dashboardReminders({ ...base, log: upTo8, date: '2026-04-08', focusType: 'A' });
    assert.ok(!r.some((x) => x.id === 'pressing'));
    // With B logged since, the next lifting day is A again, which presses.
    const later = dashboardReminders({ ...base, log: LOG, date: '2026-04-10', focusType: 'S3' });
    assert.equal(later.find((x) => x.id === 'pressing')!.text, 'The next lifting day has pressing (Flat DB Bench Press): band external rotation first.');
    const before = { ...LOG, sessions: LOG.sessions.filter((s: { date: string }) => s.date < '2026-04-08') };
    const a = dashboardReminders({ ...base, log: before, date: '2026-04-08', focusType: 'A' });
    assert.equal(a.find((x) => x.id === 'pressing')!.text, 'Today has pressing (Flat DB Bench Press): band external rotation first.');
  });
  it('R3: more lifting days to do than days left; R3b: short sessions to go, or on Sunday how many', () => {
    const empty = { ...LOG, sessions: LOG.sessions.filter((s: { date: string }) => s.date < '2026-04-06') };
    const sat = dashboardReminders({ ...base, log: empty, date: '2026-04-11', focusType: 'S1' });
    assert.deepEqual(sat.find((x) => x.id === 'lifting-gap'), { id: 'lifting-gap', icon: 'clock', warn: true, text: '3 lifting days still to do with 2 days left: an Express lift (20 min) beats skipping.', rule: 'Short on time? Express beats skipping. Lifting before short days' });
    const mon = dashboardReminders({ ...base, log: empty, date: '2026-04-06', focusType: 'B' });
    assert.equal(mon.find((x) => x.id === 'short-gap')!.text, '1 short session to go this week, after the lifting days.');
    const lifted = { ...LOG, sessions: LOG.sessions.filter((s: { date: string; type: string }) => s.date < '2026-04-12' && s.type !== 'S1') };
    const sun = dashboardReminders({ ...base, log: lifted, date: '2026-04-12', focusType: 'S1' });
    assert.equal(sun.find((x) => x.id === 'short-gap')!.text, 'Short sessions came to 0 of 1 this week.');
    const lastDay = dashboardReminders({ ...base, log: empty, date: '2026-04-12', focusType: 'A' });
    assert.equal(lastDay.find((x) => x.id === 'lifting-gap')!.text, '3 lifting days still to do with 1 day left: an Express lift (20 min) beats skipping.');
  });
});

describe('planText', () => {
  it('writes the plan as the dashboard copies it', () => {
    const t = planText({ plan: PLAN, log: LOG, date: '2026-04-10', type: 'A', express: false, deload: false, dayLabel: 'Friday 10 April', shortDay: (d) => `${+d.slice(8)} Apr` });
    const lines = t.split('\n');
    assert.equal(lines[0], `${PLAN.titles.A} · Friday 10 April`);
    assert.equal(lines[1], '');
    assert.equal(lines[2], '1. Warm-up: 6 min');
    assert.ok(lines.some((l) => /^ {3}- /.test(l)), 'the warm-up steps');
    assert.ok(lines.some((l) => l.includes('until 19 Apr')), 'the temporary change in the goblet squat’s place');
    assert.ok(lines.some((l) => /^ {3}next \d/.test(l)), 'a main lift’s next target');
    const s1 = planText({ plan: PLAN, log: LOG, date: '2026-04-10', type: 'S1', express: false, deload: true, dayLabel: 'Friday 10 April', shortDay: (d) => d });
    assert.equal(s1.split('\n')[1], 'Deload week: 2 sets of everything, about 10% lighter. S3 is 20 min easy Zone 2 + abs.');
    assert.equal(s1.split('\n').at(-1), levelsText(PLAN, LOG, 'S1'));
    assert.match(levelsText(PLAN, LOG, 'S1'), /^Your levels: .+ L3 · .+ · .+ L2 · .+$/);
  });
});

describe('the shared checklist record', () => {
  it('merges into the log, keeping sessions, ladders and the key order', () => {
    const r = mergeTodayChecklist(LOG_TEXT, (log) => toggledChecklist(log, '2026-04-10', 'B', false, dashChecklist(PLAN, 'B', false, false).length, 1) as unknown as Record<string, unknown>);
    assert.equal(r.result, 'saved');
    if (r.result !== 'saved') return;
    const out = JSON.parse(r.text);
    assert.deepEqual(out.sessions, LOG.sessions);
    assert.deepEqual(out.ladders, LOG.ladders);
    assert.deepEqual(out.todayChecklist, { date: '2026-04-10', type: 'B', express: false, checked: [false, true, false, false, false, false] });
    // A tick made elsewhere since is kept: the next tick builds on the record on disk.
    const again = mergeTodayChecklist(r.text, (log) => toggledChecklist(log, '2026-04-10', 'B', false, 6, 3) as unknown as Record<string, unknown>);
    assert.deepEqual(again.result === 'saved' && JSON.parse(again.text).todayChecklist.checked, [false, true, false, true, false, false]);
    assert.equal(mergeTodayChecklist(r.text, (log) => log['todayChecklist'] as Record<string, unknown>).result, 'unchanged');
    assert.equal(mergeTodayChecklist('{', () => ({})).result, 'unreadable');
  });
  it('is what Isfahan’s briefing reads: a pick in Pahlavan is its next session', () => {
    // briefing.js trainingData: tc.date === today && tc.picked && plan.titles[tc.type] ? tc.type : next(plan.liftTypes)
    const isfahanNext = (log: { todayChecklist?: { date: string; type: string; picked?: boolean }; sessions: { date: string; type: string }[] }, today: string) => {
      const sessions = [...log.sessions].sort((a, b) => a.date.localeCompare(b.date));
      const next = (types: string[]) => { const done = sessions.filter((s) => types.includes(s.type)); return done.length ? types[(types.indexOf(done.at(-1)!.type) + 1) % types.length] : types[0]; };
      const tc = log.todayChecklist;
      return tc && tc.date === today && tc.picked && PLAN.titles[tc.type] ? tc.type : next(PLAN.liftTypes);
    };
    const picked = mergeTodayChecklist(LOG_TEXT, (log) => chosenChecklist(log, '2026-04-10', 'S3', false, dashChecklist(PLAN, 'S3', false, false).length, true) as unknown as Record<string, unknown>);
    assert.ok(picked.result === 'saved');
    if (picked.result !== 'saved') return;
    assert.equal(isfahanNext(JSON.parse(picked.text), '2026-04-10'), 'S3');
    assert.equal(isfahanNext(JSON.parse(picked.text), '2026-04-11'), 'A');
    const unpicked = mergeTodayChecklist(LOG_TEXT, (log) => chosenChecklist(log, '2026-04-10', 'S3', false, 4, false) as unknown as Record<string, unknown>);
    assert.ok(unpicked.result === 'saved' && isfahanNext(JSON.parse(unpicked.text), '2026-04-10') === 'A');
  });
  it('is read back as today’s choice: a pick or a short day wins; an unpicked lifting day sets only Express', () => {
    const at = (tc: object) => choiceFromChecklist({ ...LOG, todayChecklist: tc }, PLAN, '2026-04-10');
    assert.deepEqual(followChoice(at({ date: '2026-04-10', type: 'S1', express: false, checked: [], picked: true }), PLAN.shortTypes, 'B'), { type: 'S1', express: false });
    assert.deepEqual(followChoice(at({ date: '2026-04-10', type: 'S3', express: false, checked: [] }), PLAN.shortTypes, 'B'), { type: 'S3', express: false });
    assert.deepEqual(followChoice(at({ date: '2026-04-10', type: 'B', express: true, checked: [] }), PLAN.shortTypes, 'B'), { type: null, express: true });
    assert.deepEqual(followChoice(at({ date: '2026-04-10', type: 'A', express: true, checked: [] }), PLAN.shortTypes, 'B'), { type: null, express: null });
    assert.equal(at({ date: '2026-04-09', type: 'S1', checked: [], picked: true }), null);
    assert.equal(at({ date: '2026-04-10', type: 'Z9', checked: [], picked: true }), null);
    assert.equal(todayChecklistOf({}, '2026-04-10', 'A', false, 3).checked.length, 3);
  });
  it('maps each checklist line to a row of today’s session', () => {
    const lines = dashChecklist(PLAN, 'A', false, false);
    const items = [{ name: 'Goblet Squat' }, { name: 'Flat DB Bench Press' }, { name: 'Face Pull' }, { name: 'Band External Rotation' }];
    const t = checklistTargets(lines, items, 'Zone 2 finisher');
    assert.equal(t[0]!.kind, 'warmup');
    assert.deepEqual(t.slice(1).map((x) => (x.kind === 'item' ? x.index : x.kind)), lines.slice(1).map((l) => (l.parts.includes('Zone 2 finisher') ? 'finisher' : items.findIndex((i) => i.name === l.parts[0]))));
  });
});

describe('the morning check-in marks the day checked in', () => {
  const body = readFileSync(join(FIT, 'body-data.json'), 'utf8');
  it('sets checkedAt only when the day has none, in Habit Nudges’ format', () => {
    const fresh = mergeMorning(body, '2026-04-12', { values: { energy: 3 }, baseline: {}, checkedAt: '2026-04-12T06:55:01.123Z' });
    assert.ok(fresh.result === 'merged' && fresh.stamped);
    if (fresh.result === 'merged') assert.equal(JSON.parse(fresh.text).days['2026-04-12'].checkedAt, '2026-04-12T06:55:01.123Z');
    const base = morningFrom(JSON.parse(body), '2026-04-10').values;
    const kept = mergeMorning(body, '2026-04-10', { values: { energy: 4 }, baseline: base, checkedAt: '2026-04-10T09:00:00.000Z' });
    assert.ok(kept.result === 'merged' && !kept.stamped);
    if (kept.result === 'merged') assert.equal(JSON.parse(kept.text).days['2026-04-10'].checkedAt, '2026-04-10T07:10:00.000Z');
    // Steps alone still mark today, as Habit Nudges' save does.
    const steps = mergeMorning(body, '2026-04-12', { values: { steps: 9000 }, baseline: {}, checkedAt: '2026-04-12T07:00:00.000Z' });
    assert.ok(steps.result === 'merged' && JSON.parse(steps.text).days['2026-04-12'].checkedAt === '2026-04-12T07:00:00.000Z');
    assert.equal(mergeMorning(body, '2026-04-10', { values: { energy: 2 }, baseline: base, checkedAt: 'x' }).result, 'unchanged');
  });
});

describe('the small lists', () => {
  it('counts this month’s sessions, lists the last four, and the plan’s notes', () => {
    assert.equal(sessionsThisMonth(LOG, '2026-04-10'), LOG.sessions.filter((s: { date: string }) => s.date >= '2026-04-01' && s.date <= '2026-04-10').length);
    const r = recentSessions(LOG, PLAN);
    assert.equal(r.length, 4);
    assert.ok(r[0]!.date >= r[1]!.date && r[1]!.date >= r[3]!.date);
    assert.equal(r.find((x) => x.type === 'custom')?.name ?? 'Easy run', 'Easy run');
    // A lifting session reads as the plan's title, as This week shows it; a plan without titles falls back to "Full Body A".
    const lift = r.find((x) => x.type === 'A' || x.type === 'B');
    if (lift) assert.equal(lift.name.replace(/ · Express$/, ''), PLAN.titles[lift.type]);
    const untitled = recentSessions({ sessions: [{ date: '2026-04-01', type: 'A' }] }, { ...PLAN, titles: undefined });
    assert.equal(untitled[0]!.name, 'Full Body A');
    assert.equal(recentSessions({ sessions: [{ date: '2026-04-01', type: 'A', express: true }] }, PLAN)[0]!.name, `${PLAN.titles.A} · Express`);
    const links = planLinks(['3-Personal/Fitness/6-Month Roadmap.md', '3-Personal/Fitness/Month 2 Plan.md', '3-Personal/Fitness/Month 3 Plan.md', '3-Personal/Fitness/Exercise Guide.md', '3-Personal/Fitness/Baseline - 2026-03-01.md', '3-Personal/Fitness/Baseline - 2026-09-30.md', '3-Personal/Fitness/Session History.md']);
    assert.deepEqual(links.map((l) => l.label), ['6-Month Roadmap', 'Month 3 Plan', 'Exercise Guide', 'Session History', 'Baseline (day 1)']);
    assert.equal(links.find((l) => l.label.startsWith('Baseline'))!.path, '3-Personal/Fitness/Baseline - 2026-09-30.md');
  });
});
