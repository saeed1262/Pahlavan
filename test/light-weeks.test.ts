// The plan's light weeks, declared in plan-data.json (`rules.lightWeeks`),
// read the same everywhere: the program's weeks, the frozen snapshots, the
// review's week and targets, the session and the log form.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checklistLines, isDeloadDate } from '../src/adapters/vault/log-write.ts';
import { readVault } from '../src/adapters/vault/read.ts';
import { paths } from '../src/adapters/vault/layout.ts';
import type { PlanData } from '../src/core/plan-data.ts';
import { DELOAD_NOTE, nextTargetDash, planText } from '../src/report/dashboard.ts';
import { buildReview } from '../src/report/review.ts';
import { buildSession } from '../src/report/session.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

const PLAN = `v/${paths().plan}`;
const LIGHT = { weeks: [5, 10], sets: 'half', load: 0.85, rirAdd: 2 };

function vault(rules: Record<string, unknown> | null, asOf = '2026-04-12') {
  const f = fixtureFiles('v');
  const doc = JSON.parse(f[PLAN]!) as PlanData;
  if (rules) doc.rules = rules;
  f[PLAN] = `${JSON.stringify(doc, null, 2)}\n`;
  return { read: readVault(memoryIo(f, asOf), 'v', { asOf }), doc, log: JSON.parse(f[`v/${paths().log}`]!) as unknown };
}

describe('declared light weeks', () => {
  const { read, doc, log } = vault({ lightWeeks: LIGHT });
  const data = read.data;
  const weeks = data.program.macrocycle.phases.flatMap((p) => p.mesocycles.flatMap((m) => m.weeks.map((w) => ({ ...w, meso: m.id }))));

  it('set the program\'s week kinds: a mesocycle ends at each light week', () => {
    assert.deepEqual(weeks.slice(0, 11).map((w) => w.kind === 'deload'), [false, false, false, false, true, false, false, false, false, true, false]);
    assert.deepEqual(weeks.slice(0, 11).map((w) => w.meso), ['meso-1', 'meso-1', 'meso-1', 'meso-1', 'meso-1', 'meso-2', 'meso-2', 'meso-2', 'meso-2', 'meso-2', 'meso-3']);
    // Half the sets, rounded up, for every sets item.
    const a = weeks[4]!.sessions.find((t) => t.id === 'a')!;
    const loadingA = weeks[2]!.sessions.find((t) => t.id === 'a')!;
    assert.deepEqual(a.slots.filter((s) => !s.timed).map((s) => s.sets), loadingA.slots.filter((s) => !s.timed).map((s) => Math.ceil(s.sets / 2)));
  });

  it('freeze a session\'s plan week by the same calendar', () => {
    const wk4 = data.sessions.find((s) => s.date >= '2026-03-23' && s.date <= '2026-03-29' && s.plan)!;
    assert.deepEqual([wk4.plan!.weekKind, wk4.plan!.mesocycle, wk4.plan!.week], ['loading', 'meso-1', 4]);
  });

  it('give the review its week, its light-week targets by the rule, and no legacy comparison', () => {
    const r = buildReview(data, '2026-03-31');
    assert.deepEqual([r.week.planWeek, r.week.deload, r.week.mesocycle, r.week.weekInMesocycle, r.week.mesocycleWeeks], [5, true, 1, 5, 5]);
    assert.equal(r.deload!.value.deload, true);
    assert.equal(r.deloadPrescription, null);
    const lift = r.lifts.find((l) => l.next && (l.next.value as { action?: string } | null)?.action === 'deload')!;
    const t = lift.next!.value as { rir: number };
    assert.equal(lift.next!.reason.from?.kind, 'plan');
    assert.match(lift.next!.reason.note ?? '', /^The plan's rule: light weeks plan weeks 5 and 10: half the sets, about 15 % lighter, RIR \+2/);
    assert.match(lift.next!.reason.note ?? '', /about 15 % under the last loading session/);
    assert.ok(t.rir >= 2);
    const week4 = buildReview(data, '2026-03-24');
    assert.deepEqual([week4.week.deload, week4.week.deloadNext, week4.deload!.value.weeksToScheduled], [false, true, 1]);
  });

  it('give the session its light week, cited, and the log form its sets', () => {
    const s = buildSession(data, '2026-03-31', 'full');
    assert.ok('week' in s);
    assert.equal(s.week.deload, true);
    assert.match(s.week.lightWeek.text, /^The plan's rule: light weeks plan weeks 5 and 10/);
    const flag = s.flags.find((f) => f.rule === 'deload.decide')!;
    assert.match(flag.note ?? '', /^The plan's rule: light weeks plan weeks 5 and 10: half the sets, about 15 % lighter, RIR \+2; .* At the bottom of each range/);
    assert.equal(isDeloadDate(doc, log, '2026-03-31'), true);
    assert.equal(isDeloadDate(doc, log, '2026-03-25'), false);
    const lines = checklistLines(doc, 'A', false, true).filter((l) => !l.warmup);
    assert.ok(lines.some((l) => /^2 × /.test(l.sr)), lines.map((l) => l.sr).join(' | '));
  });

  it('give the copied plan the rule\'s light-week line and load', () => {
    const copy = planText({ plan: doc, log, date: '2026-03-31', type: 'A', express: false, deload: true, dayLabel: 'Tue', shortDay: (d) => d }).split('\n');
    assert.equal(copy[1], "Deload week: half the sets, about 15 % lighter, RIR +2 (the plan's rule).");
    assert.match(nextTargetDash(doc, log, 'Flat DB Bench Press', true)!.text, /about 15% under last time/);
    const legacy = vault(null);
    assert.equal(planText({ plan: legacy.doc, log: legacy.log, date: '2026-03-25', type: 'A', express: false, deload: true, dayLabel: 'Wed', shortDay: (d) => d }).split('\n')[1], DELOAD_NOTE);
  });

  it('the old default stays every 4th week, with the busy-week move and the comparison', () => {
    const legacy = vault(null).read.data;
    const r = buildReview(legacy, '2026-03-24');
    assert.deepEqual([r.week.deload, r.week.mesocycleWeeks], [true, 4]);
    assert.equal(r.deload!.reason.from?.kind, 'legacy-default');
    assert.notEqual(r.deloadPrescription, null);
  });
});
