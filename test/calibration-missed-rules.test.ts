// The plan's calibration and missed-time rules (`rules.calibration`,
// `rules.missed`): which weeks find working loads and at what RIR, and what
// the first week back does after time off.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { paths } from '../src/adapters/vault/layout.ts';
import { applyReturn, returnProtocol } from '../src/core/missed.ts';
import type { PlanData } from '../src/core/plan-data.ts';
import type { ProgressionTarget } from '../src/core/progression.ts';
import { buildReview } from '../src/report/review.ts';
import { buildSession } from '../src/report/session.ts';
import { fixtureFiles, memoryIo, session, set, slot } from './helpers.ts';

const PLAN = `v/${paths().plan}`;
const WEEK1 = '2026-03-04';

function vault(rules: Record<string, unknown>, asOf = WEEK1) {
  const f = fixtureFiles('v');
  const doc = JSON.parse(f[PLAN]!) as PlanData;
  doc.rules = rules;
  f[PLAN] = `${JSON.stringify(doc, null, 2)}\n`;
  return readVault(memoryIo(f, asOf), 'v', { asOf }).data;
}
const weeksOf = (d: ReturnType<typeof vault>) => d.program.macrocycle.phases.flatMap((p) => p.mesocycles.flatMap((m) => m.weeks));

describe('the plan\'s calibration rule', () => {
  it('"none": no calibration week, and week 1\'s targets progress as usual', () => {
    const d = vault({ calibration: 'none' });
    assert.equal(weeksOf(d).some((w) => w.calibration), false);
    const r = buildReview(d, WEEK1);
    assert.ok(r.lifts.every((l) => (l.next?.value as { action?: string } | null)?.action !== 'calibrate'));
    assert.ok(!buildSession(d, WEEK1, 'full').flags.some((f) => f.rule === 'plan.calibration'));
  });

  it('its weeks and its RIR: week 9 calibrates too, at RIR 4, and the rule is cited', () => {
    const d = vault({ calibration: { weeks: [1, 9], rir: 4 } });
    const ws = weeksOf(d);
    assert.deepEqual(ws.filter((w) => w.calibration).map((w) => w.start), [ws[0]!.start, ws[8]!.start]);
    for (const t of ws[8]!.sessions) for (const s of t.slots.filter((x) => (d.program.exercises[x.exercise]?.kind ?? 'strength') === 'strength')) assert.ok(s.rir >= 4, `${t.id} ${s.exercise}`);
    const s = buildSession(d, WEEK1, 'full');
    const flag = s.flags.find((f) => f.rule === 'plan.calibration')!;
    assert.match(flag.note ?? '', /^The plan's rule: calibration in plan weeks 1 and 9: find a load that leaves 4 reps in reserve/);
    const r = buildReview(d, WEEK1);
    const cal = r.lifts.find((l) => (l.next?.value as { action?: string } | null)?.action === 'calibrate')!;
    assert.ok((cal.next!.value as ProgressionTarget).rir >= 4);
    assert.equal(cal.next!.reason.from?.path, 'rules.calibration');
  });
});

describe('a calibration week on a light week', () => {
  it('the light week is kept, and a warning says which week does not calibrate', () => {
    const d = vault({ calibration: { weeks: [1, 4] } });
    assert.equal(weeksOf(d)[3]!.kind, 'deload');
    assert.equal(weeksOf(d)[3]!.calibration, undefined);
    assert.deepEqual(d.warnings.find((w) => w.code === 'calibration-on-light-week')!.items, ['plan week 4']);
  });
});

describe('the plan\'s missed-time rule', () => {
  const sq = slot('squat', 3, 5, 8, 2);
  const s = (date: string) => session(date, { logged: { squat: [set(60, 8)] }, slots: [sq] });
  const target: ProgressionTarget = { action: 'increase', weight: 62.5, unit: 'kg', reps: 5, rir: 2, assumedAllSets: true };

  it('its weeks set the protocol, its drop and RIR the first week back', () => {
    const rule = { easeBackAfterWeeks: 1, restartAfterWeeks: 4, easeBackDrop: 0.2, easeBackRir: 2, afterRestart: true };
    const p = returnProtocol({ sessions: [s('2026-03-02')], today: '2026-03-26', rule });
    assert.deepEqual([p.value.protocol, p.value.weeksOff, p.value.loadFactor, p.value.rirAdd], ['ease-back', 3, 0.8, 2]);
    assert.match(p.reason.note ?? '', /about 20 % lighter and RIR \+2/);
    const a = applyReturn(target, p.value, { unit: 'kg', increment: 2.5 }, '2026-03-26');
    assert.deepEqual([a.value.weight, a.value.rir], [50, 4]);
    // The old default restarts at 3 weeks off.
    assert.equal(returnProtocol({ sessions: [s('2026-03-02')], today: '2026-03-26' }).value.protocol, 'restart');
  });

  it('a restart without a calibration week eases back instead', () => {
    const rule = { easeBackAfterWeeks: 1, restartAfterWeeks: 3, easeBackDrop: 0.1, easeBackRir: 1, afterRestart: false };
    const p = returnProtocol({ sessions: [s('2026-03-02')], today: '2026-03-30', rule });
    assert.deepEqual([p.value.protocol, p.value.calibration, p.value.loadFactor, p.value.rirAdd], ['restart', false, 0.9, 1]);
    // With a calibration week after a restart, the plan's calibration RIR is the one said and applied.
    const cal = returnProtocol({ sessions: [s('2026-03-02')], today: '2026-03-30', rule: { ...rule, afterRestart: true, calibrationRir: 4 } });
    assert.match(cal.reason.note ?? '', /leaves 4 reps in reserve/);
    assert.equal(applyReturn(target, cal.value, { unit: 'kg', increment: 2.5, repRange: [5, 8] }, '2026-03-30', undefined, 4).value.rir, 4);
    const a = applyReturn(target, p.value, { unit: 'kg', increment: 2.5 }, '2026-03-30');
    assert.equal(a.value.action, 'ease-back');
  });
});
