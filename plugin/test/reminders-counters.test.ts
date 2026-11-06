// The counts each Mac keeps in memory, stepped every 30 seconds as the
// plugin steps them: the stand-up round (due after the sitting minutes, held
// by a call and by "Standing now", a finished stand as an event), the
// sitting stretch and what it writes (kept from a minute, rewritten every
// two, a short one taken out, split at midnight, carried on after a
// restart), a desk break's Done ending the stretch, and "Standing now"
// (sitting not counted; off at midnight and after a long gap).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fixedOffsetClock, momentAt } from '../../src/core/clock.ts';
import type { SittingLog, TrackedItem } from '../../src/core/schema.ts';
import { BREAK_CLICK_MS, SITTING_WRITE_MS, SittingCounter, sittingToday, StandCounter, StandingSwitch, STANDING_IDLE_OFF_MIN } from '../src/reminders/counters.ts';

const clock = fixedOffsetClock(0);
const T0 = momentAt('2026-04-10', '09:00', 0).ms;
const MIN = 60_000;
const STAND: TrackedItem = {
  id: 'stand-ups', kind: 'standup', name: 'Stand-ups', schedule: { kind: 'daily' }, start: '2026-03-02', source: { by: 'user' }, habit: 'stand',
  standup: { sitMinutes: 30, standMinutes: 20, snoozeMinutes: 10, targetMinutes: 120, pauseCalls: true, activeOnly: true, activeSeconds: 120, awayMinutes: 30, standAwayMinutes: 5 },
};

/** Steps every 30 s from `from` for `minutes`, with the idle seconds and call each step gets. */
function run(c: StandCounter, from: number, minutes: number, inp: (t: number) => { idleS: number; call: boolean | null; standingNow?: boolean }) {
  const events = [];
  for (let t = from; t < from + minutes * MIN; t += 30_000) events.push(...c.step([STAND], { now: t, ...inp(t) }));
  return events;
}

describe('StandCounter', () => {
  it('is due after 30 minutes at the keyboard, then a 20-minute stand finishes with its minutes', () => {
    const c = new StandCounter();
    run(c, T0, 30.5, () => ({ idleS: 3, call: false }));
    assert.equal(c.state('stand-ups').phase, 'due');
    c.answer('stand-ups', 'stand', T0 + 31 * MIN, 0);
    assert.equal(c.standing(), true);
    const ev = run(c, T0 + 31 * MIN, 20.5, () => ({ idleS: 5, call: false }));
    assert.deepEqual(ev.map((e) => [e.event, e.minutes]), [['finished', 20]]);
    assert.equal(c.state('stand-ups').phase, 'sitting');
  });

  it('a stand away from the desk counts: no keyboard or mouse for the whole stand, and it still finishes', () => {
    const c = new StandCounter();
    run(c, T0, 30.5, () => ({ idleS: 3, call: false }));
    c.answer('stand-ups', 'stand', T0 + 31 * MIN, 0);
    const ev = run(c, T0 + 31 * MIN, 20.5, (t) => ({ idleS: Math.round((t - T0 - 31 * MIN) / 1000) + 30, call: false }));
    assert.deepEqual(ev.map((e) => [e.event, e.minutes]), [['finished', 20]]);
  });

  it('a call holds the count and takes a due card down until it ends', () => {
    const c = new StandCounter();
    run(c, T0, 20, () => ({ idleS: 3, call: true }));
    assert.equal(c.state('stand-ups').satMs, 0);
    run(c, T0 + 20 * MIN, 30.5, () => ({ idleS: 3, call: false }));
    assert.equal(c.state('stand-ups').phase, 'due');
    run(c, T0 + 51 * MIN, 1, () => ({ idleS: 3, call: true }));
    assert.equal(c.state('stand-ups').phase, 'sitting');
  });

  it('"Standing now" counts: each stand’s worth of minutes at the desk is a desk stand, and no sitting minutes', () => {
    const c = new StandCounter();
    const ev = run(c, T0, 60, () => ({ idleS: 2, call: null, standingNow: true }));
    assert.deepEqual(ev.map((e) => [e.event, e.minutes]), [['desk', 20], ['desk', 20], ['desk', 20]]);
    assert.deepEqual({ phase: c.state('stand-ups').phase, sat: c.state('stand-ups').satMs, stood: c.state('stand-ups').stoodMs }, { phase: 'sitting', sat: 0, stood: 0 });
  });

  it('a desk stand starts the sitting count over; less than a stand at the desk holds the round and logs nothing', () => {
    const c = new StandCounter();
    run(c, T0, 20, () => ({ idleS: 3, call: false }));
    assert.equal(c.state('stand-ups').satMs, 20 * MIN);
    // 10 minutes standing at the desk, then sitting again: nothing logged, the 20 minutes sat still count.
    assert.deepEqual(run(c, T0 + 20 * MIN, 10, () => ({ idleS: 3, call: null, standingNow: true })), []);
    assert.equal(c.deskMs('stand-ups'), 10 * MIN);
    run(c, T0 + 30 * MIN, 0.5, () => ({ idleS: 3, call: false }));
    assert.equal(c.deskMs('stand-ups'), 0);
    assert.equal(c.state('stand-ups').satMs, 20.5 * MIN);
    // 20 minutes at the desk: a desk stand, and the round starts over from no minutes sat.
    const ev = run(c, T0 + 31 * MIN, 20, () => ({ idleS: 3, call: null, standingNow: true }));
    assert.deepEqual(ev.map((e) => e.event), ['desk']);
    assert.equal(c.state('stand-ups').satMs, 0);
    run(c, T0 + 51 * MIN, 29, () => ({ idleS: 3, call: false }));
    assert.equal(c.state('stand-ups').phase, 'sitting');
  });

  it('a stand already counting down goes on with "Standing now" switched on', () => {
    const c = new StandCounter();
    run(c, T0, 30.5, () => ({ idleS: 3, call: false }));
    c.answer('stand-ups', 'stand', T0 + 31 * MIN, 0);
    const ev = run(c, T0 + 31 * MIN, 20.5, () => ({ idleS: 3, call: null, standingNow: true }));
    assert.deepEqual(ev.map((e) => [e.event, e.minutes]), [['finished', 20]]);
  });

  it('one snooze per round; an item no longer counting starts over', () => {
    const c = new StandCounter();
    run(c, T0, 30.5, () => ({ idleS: 3, call: false }));
    const st = c.answer('stand-ups', 'snooze', T0 + 31 * MIN, 10);
    assert.deepEqual({ phase: st.phase, used: st.snoozeUsed }, { phase: 'sitting', used: true });
    c.step([], { now: T0 + 32 * MIN, idleS: 3, call: false });
    assert.equal(c.state('stand-ups').snoozeUsed, false);
  });
});

const SIT = { awayMinutes: 5 };
const steps = (s: SittingCounter, from: number, minutes: number, idle: (t: number) => number, extra: { call?: boolean; standing?: boolean } = {}) => {
  const out = [];
  for (let t = from; t < from + minutes * MIN; t += 30_000) out.push(...s.step({ now: t, idleS: idle(t), call: extra.call ?? false, standing: extra.standing ?? false }, SIT, clock));
  return out;
};

describe('SittingCounter', () => {
  it('writes a stretch once it is a minute long, then every two minutes, under its start', () => {
    const s = new SittingCounter();
    const w = steps(s, T0, 6, () => 1);
    const puts = w.flatMap((c) => c.put ?? []);
    assert.equal(puts.length, 3, 'at about 1, 3 and 5 minutes');
    assert.ok(puts.every((p) => p.start === puts[0]!.start));
    assert.equal(w[0]!.date, '2026-04-10');
    assert.deepEqual(w[0]!.baseline, { [puts[0]!.start]: null });
    assert.deepEqual(w[1]!.baseline, { [puts[0]!.start]: puts[0]!.end }, 'the baseline is what this Mac wrote last');
    assert.ok(SITTING_WRITE_MS === 2 * MIN);
  });

  it('time away ends a stretch at its last input; one under a minute is taken out again', () => {
    const s = new SittingCounter();
    let w = steps(s, T0, 3, () => 1);
    w = steps(s, T0 + 3 * MIN, 6, (t) => (t - (T0 + 3 * MIN)) / 1000 + 1);
    const closed = w.filter((c) => c.put).at(-1)!.put![0]!;
    assert.ok(Date.parse(closed.end) <= T0 + 3 * MIN, 'ends at the last input');
    assert.equal(s.live(), null);

    const short = new SittingCounter();
    const a = steps(short, T0, 1.5, () => 1);
    assert.equal(a.flatMap((c) => c.put ?? []).length, 1);
    const b = short.step({ now: T0 + 1.5 * MIN, idleS: 0, call: false, standing: true }, SIT, clock);
    // 1.5 minutes is kept: closing writes its final end.
    assert.equal(b[0]!.put!.length, 1);
    const tiny = new SittingCounter();
    tiny.step({ now: T0, idleS: 0, call: false, standing: false }, SIT, clock);
    const gone = tiny.step({ now: T0 + 20_000, idleS: 0, call: false, standing: true }, SIT, clock);
    assert.deepEqual(gone, [], 'under a minute and never written: nothing to take out');
  });

  it('splits a stretch at local midnight, each part on its own day', () => {
    const s = new SittingCounter();
    const late = momentAt('2026-04-10', '23:50', 0).ms;
    const w = steps(s, late, 20, () => 1);
    const dates = new Set(w.map((c) => c.date));
    assert.deepEqual([...dates].sort(), ['2026-04-10', '2026-04-11']);
    const first = w.filter((c) => c.date === '2026-04-10').at(-1)!.put![0]!;
    assert.equal(first.end, new Date(momentAt('2026-04-11', '00:00', 0).ms - 1).toISOString());
  });

  it('carries on from this Mac’s last stretch after a restart, when it ended within the away limit', () => {
    const log: SittingLog = { schemaVersion: 1, days: { '2026-04-10': { 'Work Mac': [{ start: '2026-04-10T08:05:00.000Z', end: '2026-04-10T08:58:00.000Z' }] } } };
    const s = new SittingCounter();
    assert.equal(s.resume(log, 'Work Mac', momentAt('2026-04-10', '09:00', 0).ms, SIT, clock), true);
    assert.equal(s.live()!.start, Date.parse('2026-04-10T08:05:00.000Z'));
    assert.equal(s.resume(log, 'Work Mac', momentAt('2026-04-10', '09:00', 0).ms, SIT, clock), false, 'once');
    const stale = new SittingCounter();
    assert.equal(stale.resume(log, 'Work Mac', momentAt('2026-04-10', '09:30', 0).ms, SIT, clock), false);
  });

  it('a desk break’s Done ends the stretch, as time away does; the next waits for input after the click', () => {
    const s = new SittingCounter();
    steps(s, T0, 40, () => 2);
    const stretch = s.live()!;
    const done = T0 + 40 * MIN;
    const w = s.breakNow(done, clock);
    assert.equal(w.length, 1);
    assert.equal(w[0]!.put![0]!.start, new Date(stretch.start).toISOString());
    assert.ok(Date.parse(w[0]!.put![0]!.end) <= done);
    assert.equal(s.live(), null);
    // The routine: no keyboard since the click (idle grows from it); no stretch opens, the break is not sitting.
    const during = steps(s, done + 30_000, 4, (t) => (t - done) / 1000);
    assert.deepEqual(during, []);
    assert.equal(s.live(), null);
    // Back at the keyboard: a new stretch from the first input after the break.
    const back = done + 5 * MIN;
    s.step({ now: back, idleS: 1, call: false, standing: false }, SIT, clock);
    assert.equal(s.live()!.start, back - 1000);
    // The click itself, seen as input right after Done, does not start one either.
    const s2 = new SittingCounter();
    steps(s2, T0, 10, () => 2);
    s2.breakNow(T0 + 10 * MIN, clock);
    s2.step({ now: T0 + 10 * MIN + 20_000, idleS: (20_000 - BREAK_CLICK_MS + 1000) / 1000, call: false, standing: false }, SIT, clock);
    assert.equal(s2.live(), null);
  });

  it('"Standing now" (standing) ends the stretch and counts nothing while on', () => {
    const s = new SittingCounter();
    steps(s, T0, 10, () => 1);
    const w = steps(s, T0 + 10 * MIN, 30, () => 1, { standing: true });
    assert.equal(w.length, 1, 'the closing write only');
    assert.equal(s.live(), null);
  });

  it('today’s sitting joins every Mac with this one’s running stretch in full', () => {
    const log: SittingLog = { schemaVersion: 1, days: { '2026-04-10': { 'Work Mac': [{ start: '2026-04-10T08:00:00.000Z', end: '2026-04-10T09:00:00.000Z' }], 'Home Mac': [{ start: '2026-04-10T08:30:00.000Z', end: '2026-04-10T09:30:00.000Z' }] } } };
    const live = { start: Date.parse('2026-04-10T10:00:00.000Z'), end: Date.parse('2026-04-10T10:50:00.000Z') };
    const r = sittingToday(log, '2026-04-10', 'Work Mac', live);
    assert.deepEqual({ minutes: r.today.minutes, longest: r.today.longest, current: r.current?.minutes }, { minutes: 140, longest: 90, current: 50 });
  });
});

describe('StandingSwitch', () => {
  const at = (t: string, d = '2026-04-10') => momentAt(d, t, 0).ms;

  it('turns on and off, and keeps when it was turned on for local storage', () => {
    const s = new StandingSwitch(null, at('10:00'), clock);
    assert.deepEqual(s.state, { on: false, since: null });
    s.set(true, at('10:05'));
    assert.deepEqual(s.state, { on: true, since: at('10:05') });
    assert.equal(s.saved, String(at('10:05')));
    s.set(false, at('10:30'));
    assert.equal(s.saved, '');
  });

  it('comes back on after a restart the same day, off on another', () => {
    assert.equal(new StandingSwitch(String(at('10:05')), at('11:00'), clock).state.on, true);
    assert.equal(new StandingSwitch(String(at('10:05')), at('08:00', '2026-04-11'), clock).state.on, false);
    assert.equal(new StandingSwitch('junk', at('11:00'), clock).state.on, false);
  });

  it('turns itself off at local midnight and after half an hour without input (or the Mac asleep)', () => {
    const s = new StandingSwitch(null, at('10:00'), clock);
    s.set(true, at('10:00'));
    assert.equal(s.check({ now: at('10:30'), idleS: 60, gapMs: 30_000 }, clock), false);
    assert.equal(s.check({ now: at('10:31'), idleS: STANDING_IDLE_OFF_MIN * 60, gapMs: 30_000 }, clock), true);
    assert.equal(s.state.on, false);
    s.set(true, at('11:00'));
    assert.equal(s.check({ now: at('12:00'), idleS: 1, gapMs: 31 * MIN }, clock), true, 'asleep');
    s.set(true, at('23:50'));
    assert.equal(s.check({ now: at('00:00', '2026-04-11'), idleS: 1, gapMs: 30_000 }, clock), true, 'midnight');
  });
});
