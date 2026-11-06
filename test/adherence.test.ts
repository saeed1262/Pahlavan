import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adherence, sessionKind } from '../src/core/adherence.ts';
import type { Session, SessionKind } from '../src/core/schema.ts';

const s = (date: string, kind?: SessionKind): Session => {
  const x: Session = { id: `${date}-${kind ?? 'custom'}`, date, trackingLevel: 'light', exercises: [] };
  if (kind) x.plan = { weekKind: 'loading', template: kind, kind, slots: [] };
  return x;
};

describe('adherence', () => {
  it('covers the 4 complete weeks ending on the Sunday on or before today', () => {
    const sun = adherence({ sessions: [], today: '2026-03-29', target: { lift: 3, short: 0 } }).value;
    assert.deepEqual([sun.from, sun.to], ['2026-03-02', '2026-03-29']);
    const wed = adherence({ sessions: [], today: '2026-04-01', target: { lift: 3, short: 0 } }).value;
    assert.deepEqual([wed.from, wed.to], ['2026-03-02', '2026-03-29']);
    const mon = adherence({ sessions: [], today: '2026-03-30', target: { lift: 3, short: 0 } }).value;
    assert.equal(mon.to, '2026-03-29');
  });

  it('counts by kind: lift and express as lifting, short and cardio as short, no plan as custom', () => {
    assert.equal(sessionKind(s('2026-03-02', 'express')), 'lift');
    assert.equal(sessionKind(s('2026-03-02', 'cardio')), 'short');
    assert.equal(sessionKind(s('2026-03-02')), 'custom');
    const r = adherence({
      sessions: [s('2026-03-02', 'lift'), s('2026-03-02', 'short'), s('2026-03-04', 'express'), s('2026-03-07'), s('2026-03-30', 'lift')],
      today: '2026-03-29',
      target: { lift: 2, short: 1 },
    }).value;
    assert.deepEqual([r.weeks[0]!.lift, r.weeks[0]!.short, r.weeks[0]!.custom, r.weeks[0]!.days], [2, 1, 1, 3]);
    assert.deepEqual(r.lifting, { done: 2, planned: 8, pct: 0.25 });
    assert.deepEqual(r.short, { done: 1, planned: 4, pct: 0.25 });
    assert.equal(r.meanSessionsPerWeek, 1);
    assert.equal(r.meanTrainingDays, 0.75);
  });

  it('looks the kind up in the program when the snapshot has none', () => {
    const x: Session = { id: 'a', date: '2026-03-02', trackingLevel: 'light', exercises: [], template: 'b' };
    const program = { schemaVersion: 1 as const, id: 'p', name: 'P', exercises: {}, macrocycle: { id: 'm', name: 'M', start: '2026-03-02', phases: [{ id: 'f', name: 'F', mesocycles: [{ id: 'x', name: 'X', weeks: [{ index: 1, kind: 'loading' as const, start: '2026-03-02', sessions: [{ id: 'b', name: 'B', kind: 'short' as const, slots: [] }] }] }] }] } };
    assert.equal(sessionKind(x, program), 'short');
    assert.equal(sessionKind(x), 'custom');
  });

  it('counts a gap as unlogged unless the day is marked rest or missed', () => {
    const r = adherence({
      sessions: [s('2026-03-02', 'lift')],
      today: '2026-03-08',
      target: { lift: 4, short: 0 },
      daily: [
        { date: '2026-03-02', mark: 'missed', trained: true }, // a logged day: neither a gap nor an unlogged tick
        { date: '2026-03-03', mark: 'missed' },
        { date: '2026-03-04', mark: 'rest' },
        { date: '2026-03-05', trained: true },
      ],
      weekly: [{ weekOf: '2026-03-02', unloggedSessions: 1 }],
    });
    const w = r.value.weeks[3]!;
    assert.deepEqual(w.gaps, { unlogged: 0, missed: 1, rest: 1 }); // the confirmed session closes one of the 3
    assert.equal(w.habitDays, 2);
    assert.equal(w.ticksWithoutLog, 1);
    assert.equal(w.confirmedUnlogged, 1);
    assert.match(r.reason.note ?? '', /lower bound/);
    assert.match(r.reason.note ?? '', /confirm as done but not logged/);
  });

  it('reads check-in records: confirmed sessions by kind, rest and missed days', () => {
    const r = adherence({
      sessions: [s('2026-03-02', 'lift')],
      today: '2026-03-08',
      target: { lift: 3, short: 2 },
      weekly: [{ date: '2026-03-08', weekStart: '2026-03-02', confirmedUnlogged: [{ date: '2026-03-04', type: 'short' }, { date: '2026-03-05', type: 'custom' }], restDays: ['2026-03-04', '2026-03-06'], missedDays: ['2026-03-07'] }],
    });
    const w = r.value.weeks[3]!;
    assert.equal(w.confirmedUnlogged, 2);
    // lift short by 2, short by 2; the short session confirmed closes one; a custom one closes none.
    // 3 left: missed 1 (03-07), rest 1 (03-06; 03-04 had the confirmed session), unknown 1.
    assert.deepEqual(w.gaps, { unlogged: 1, missed: 1, rest: 1 });
    assert.equal(r.value.lifting.done, 1); // the percentages stay logged-only
  });

  it('caps the marks at the shortfall', () => {
    const daily = ['2026-03-03', '2026-03-04', '2026-03-05'].map((date) => ({ date, mark: 'missed' as const }));
    const r = adherence({ sessions: [s('2026-03-02', 'lift')], today: '2026-03-08', target: { lift: 2, short: 0 }, daily }).value;
    assert.deepEqual(r.weeks[3]!.gaps, { unlogged: 0, missed: 1, rest: 0 });
  });

  it('has no short percentage without a short target', () => {
    assert.equal(adherence({ sessions: [], today: '2026-03-29', target: { lift: 3, short: 0 } }).value.short.pct, null);
  });
});
