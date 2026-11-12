// The plan's start: plan-data's optional `start` (a date) makes the
// Monday-to-Sunday week holding it plan week 1, before and over the log's
// first plan session and the baseline note. Without it, week 1 comes from the
// log as before. The coach writes it with a fresh start or a reset, and
// `engine draft` carries it over; the check holds a bad one as a hard error.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { isDeloadDate } from '../src/adapters/vault/log-write.ts';
import { planStartOf, PLAN_DATA_KEYS } from '../src/core/plan-data.ts';
import { buildCheck } from '../src/report/check.ts';
import { buildReview } from '../src/report/index.ts';
import { buildSession } from '../src/report/session.ts';
import { cycleOf } from '../src/report/cycle.ts';
import { run } from '../src/cli/cli.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

const PLAN = 'v/3-Personal/Fitness/plan-data.json';
type Json = Record<string, any>;

function vault(start: unknown, asOf: string) {
  const files = fixtureFiles('v');
  const p = JSON.parse(files[PLAN]!);
  if (start === undefined) delete p.start;
  else p.start = start;
  files[PLAN] = JSON.stringify(p);
  return { files, read: readVault(memoryIo(files, asOf), 'v', { asOf }) };
}
const week = (start: unknown, date: string) => buildReview(vault(start, date).read.data, date).week;

describe('the plan’s start', () => {
  it('reads plan-data’s start as week 1’s Monday; absent is null, a bad one a problem', () => {
    assert.deepEqual(planStartOf({ start: '2026-04-15' }), { monday: '2026-04-13', problem: null });
    assert.deepEqual(planStartOf({ start: '2026-04-13' }).monday, '2026-04-13');
    assert.deepEqual(planStartOf({}), { monday: null, problem: null });
    assert.deepEqual(planStartOf(null), { monday: null, problem: null });
    for (const bad of ['next Monday', '2026-13-01', 20260413]) {
      const r = planStartOf({ start: bad });
      assert.equal(r.monday, null);
      assert.match(r.problem!, /not a date as YYYY-MM-DD: the plan weeks count from the first logged plan session/);
    }
    assert.ok((PLAN_DATA_KEYS as readonly string[]).includes('start'));
  });

  it('without it, week 1 is the first logged plan session’s week, as before', () => {
    const w = week(undefined, '2026-04-12');
    assert.deepEqual([w.planStart, w.planWeek], ['2026-03-02', 6]);
  });

  it('defines plan week 1 when present, over the log’s first plan session', () => {
    // A Wednesday start: its week (from Monday 6 Apr) is week 1, though sessions were logged from 2 Mar.
    let w = week('2026-04-08', '2026-04-12');
    assert.deepEqual([w.planStart, w.planWeek], ['2026-04-06', 1]);
    w = week('2026-04-08', '2026-04-20');
    assert.deepEqual([w.planStart, w.planWeek], ['2026-04-06', 3]);
    // Earlier than the log's first plan session, it counts from there too.
    w = week('2026-02-23', '2026-04-12');
    assert.deepEqual([w.planStart, w.planWeek], ['2026-02-23', 7]);
  });

  it('has no plan week before the start: the plan has not begun', () => {
    const w = week('2026-04-20', '2026-04-12');
    assert.equal(w.planStart, '2026-04-20');
    assert.equal(w.planWeek, null);
  });

  it('counts the log writer’s light weeks from it too', () => {
    const { files } = vault('2026-04-08', '2026-04-12');
    const plan = JSON.parse(files[PLAN]!);
    const log = JSON.parse(files['v/3-Personal/Fitness/fitness-log-data.json']!);
    // The fixture's light weeks are every 4th: plan week 4 from 6 Apr is the week of 27 Apr.
    assert.equal(isDeloadDate(plan, log, '2026-04-29'), true);
    assert.equal(isDeloadDate(plan, log, '2026-04-22'), false);
    delete plan.start;
    // From the log's first plan session (2 Mar), the week of 27 Apr is week 9, a loading week.
    assert.equal(isDeloadDate(plan, log, '2026-04-29'), false);
  });

  it('a start that is not a date: review reads around it, the check refuses it', () => {
    const { read } = vault('soon', '2026-04-20');
    assert.ok(read.data.warnings.some((w) => w.code === 'plan-data' && /start is "soon"/.test(w.message)));
    assert.equal(read.data.plan.start, '2026-03-02', 'the log’s week 1 stands');
    const check = buildCheck(read, '2026-04-20');
    const f = check.findings.find((x) => x.code === 'plan-data')!;
    assert.equal(f.level, 'error');
    assert.ok(f.items.some((x) => /start is "soon"/.test(x)));
    assert.equal(check.summary.ok, false);
  });

  it('start-changed: a draft that drops or changes the written plan’s start (overridable for a reset)', () => {
    const { files } = vault('2026-03-02', '2026-04-20');
    const draft = (start: unknown, overrides?: unknown[]) => {
      const p = JSON.parse(files[PLAN]!);
      if (start === undefined) delete p.start;
      else p.start = start;
      if (overrides) p.overrides = overrides;
      return { text: JSON.stringify(p), file: 'draft.json' };
    };
    const previous = JSON.parse(files[PLAN]!);
    const at = (d: { text: string; file: string }) => buildCheck(readVault(memoryIo(files, '2026-04-20'), 'v', { asOf: '2026-04-20', plan: d }), '2026-04-20', { previous });
    const changed = at(draft('2026-04-20')).findings.find((f) => f.code === 'start-changed')!;
    assert.equal(changed.level, 'warning');
    assert.deepEqual(changed.items, ['start 2026-03-02 changed to 2026-04-20']);
    assert.match(changed.reason!, /only a fresh start or a reset begins a new week 1/);
    assert.deepEqual(at(draft(undefined)).findings.find((f) => f.code === 'start-changed')!.items, ['start 2026-03-02 dropped: the plan weeks would count from the log again']);
    assert.equal(at(draft('2026-03-02')).findings.find((f) => f.code === 'start-changed'), undefined);
    const reset = at(draft('2026-04-20', [{ code: 'start-changed', reason: 'A reset after six weeks away: a new week 1.' }])).findings.find((f) => f.code === 'start-changed')!;
    assert.deepEqual([reset.level, reset.override!.reason], ['info', 'A reset after six weeks away: a new week 1.']);
    // A written plan without a start: a draft that adds one is no change of week 1 to warn about.
    const legacy = vault(undefined, '2026-04-20').files;
    const prevLegacy = JSON.parse(legacy[PLAN]!);
    const p = { ...prevLegacy, start: '2026-04-20' };
    const r = buildCheck(readVault(memoryIo(legacy, '2026-04-20'), 'v', { asOf: '2026-04-20', plan: { text: JSON.stringify(p), file: 'd.json' } }), '2026-04-20', { previous: prevLegacy });
    assert.equal(r.findings.find((f) => f.code === 'start-changed'), undefined);
  });

  it('plan-write warns start-changed too, and writes on (a warning, not a refusal)', () => {
    const { files } = vault('2026-03-02', '2026-04-20');
    const p = JSON.parse(files[PLAN]!);
    p.start = '2026-04-22';
    files['v/draft.json'] = JSON.stringify(p);
    const j = JSON.parse(run(['plan-write', '--vault', 'v', '--file', 'v/draft.json', '--date', '2026-04-20'], memoryIo(files, '2026-04-20')).stdout);
    assert.ok(j.findings.some((f: Json) => f.code === 'start-changed' && f.level === 'warning'));
    assert.notEqual(j.result, 'refused');
  });

  it('says when the plan starts on Today before its start week; food and review give no plan week before it', () => {
    const { read } = vault('2026-04-22', '2026-04-12');
    const s = buildSession(read.data, '2026-04-12', 'full');
    assert.equal(s.session, null);
    assert.equal(s.note, 'Your plan starts Mon 20 Apr: no planned session before then.');
    assert.equal((s as { planStarts?: string }).planStarts, '2026-04-20');
    const files = vault('2026-05-06', '2026-04-12').files;
    const food = JSON.parse(run(['food', '--vault', 'v', '--date', '2026-04-12'], memoryIo(files)).stdout);
    assert.equal(food.week.planWeek, null);
  });

  it('names the plan’s start as the source of a cycle with no baseline note', () => {
    const files = fixtureFiles('v');
    for (const k of Object.keys(files)) if (/Baseline - /.test(k)) delete files[k];
    const p = JSON.parse(files[PLAN]!);
    p.start = '2026-03-04';
    files[PLAN] = JSON.stringify(p);
    const read = readVault(memoryIo(files), 'v', { asOf: '2026-04-12' });
    assert.match(cycleOf(read.data, '2026-04-12').reason.note!, /the Monday of the plan's start \(plan-data's `start`\)/);
    delete p.start;
    files[PLAN] = JSON.stringify(p);
    assert.match(cycleOf(readVault(memoryIo(files), 'v', { asOf: '2026-04-12' }).data, '2026-04-12').reason.note!, /the Monday of the first logged plan session/);
  });
});
