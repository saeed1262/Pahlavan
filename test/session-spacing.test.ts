// The day's kind after two lifting days in a row. A lifting weekday is a short
// day when the two days before it each have a logged lifting session, the plan
// has short sessions and the week's short sessions aren't all done: the
// default week never has three lifting days running. Otherwise the weekday's
// kind in the default calendar, as before. Today, the reminders, the gym page
// and phone.json all read it (buildSession, nextOfDay).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { dayKindOn, nextOfDay } from '../src/report/review.ts';
import { buildSession } from '../src/report/session.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

const LOG = 'v/3-Personal/Fitness/fitness-log-data.json';
const PLAN = 'v/3-Personal/Fitness/plan-data.json';
// A lifting weekday in the default calendar (Mon, Tue, Thu, Fri). The fixture's
// log ends on Sat 11 Apr with B, so the next lift is A; its last short session
// is S1 (7 Apr), so the next short one is S3. The plan wants 1 short a week.
const THU = '2026-04-16';

type Entry = { date: string; type: string; express?: boolean };

/** The fixture with these sessions added to its log, each a copy of the fixture's own entry of that type. */
function vaultWith(extra: Entry[], date = THU, plan?: (p: { shortTypes: string[]; weekTarget: { short: number } }) => void) {
  const files = fixtureFiles();
  const log = JSON.parse(files[LOG]!) as { sessions: Record<string, unknown>[] };
  const model = (type: string) => JSON.parse(JSON.stringify([...log.sessions].reverse().find((s) => s['type'] === type)!)) as Record<string, unknown>;
  log.sessions.push(...extra.map((e) => ({ ...model(e.type), date: e.date, ...(e.express ? { express: true } : {}) })));
  files[LOG] = JSON.stringify(log);
  if (plan) {
    const p = JSON.parse(files[PLAN]!);
    plan(p);
    files[PLAN] = JSON.stringify(p);
  }
  return readVault(memoryIo(files, date), 'v', { asOf: date }).data;
}

describe('a lifting weekday after two lifting days in a row', () => {
  it('is a short day: the next short session, with the two days in its reason', () => {
    const data = vaultWith([{ date: '2026-04-14', type: 'A' }, { date: '2026-04-15', type: 'B' }]);
    assert.deepEqual(dayKindOn(data, THU), { kind: 'short', weekdayKind: 'lift', spacedAfter: { dates: ['2026-04-14', '2026-04-15'] } });
    const s = buildSession(data, THU, 'full').session!;
    assert.deepEqual([s.type, s.kind, s.picked], ['S3', 'short', false]);
    assert.equal(s.why, "Next in the short-session rotation: you lifted on Tuesday and Wednesday, and your plan's week never has three lifting days in a row.");
  });

  it('counts an Express session as lifting', () => {
    const data = vaultWith([{ date: '2026-04-14', type: 'A', express: true }, { date: '2026-04-15', type: 'B' }]);
    assert.equal(dayKindOn(data, THU).kind, 'short');
  });

  it('stays a lifting day once the week’s short sessions are done', () => {
    const data = vaultWith([{ date: '2026-04-13', type: 'S1' }, { date: '2026-04-14', type: 'A' }, { date: '2026-04-15', type: 'B' }]);
    assert.deepEqual(dayKindOn(data, THU), { kind: 'lift', weekdayKind: 'lift', spacedAfter: null });
    const s = buildSession(data, THU, 'full').session!;
    assert.deepEqual([s.type, s.kind], ['A', 'lift']);
    assert.equal(s.why, 'Next in the lifting rotation; the training calendar has a lifting day on Thursday.');
  });

  it('a plan with no short sessions keeps lifting', () => {
    const data = vaultWith([{ date: '2026-04-14', type: 'A' }, { date: '2026-04-15', type: 'B' }], THU, (p) => {
      p.shortTypes = [];
      p.weekTarget.short = 0;
    });
    assert.equal(dayKindOn(data, THU).kind, 'lift');
    assert.equal(buildSession(data, THU, 'full').session!.kind, 'lift');
  });
});

describe('the weekday rule stands otherwise', () => {
  it('one lifting day before it', () => {
    const data = vaultWith([{ date: '2026-04-15', type: 'B' }]);
    assert.deepEqual(dayKindOn(data, THU), { kind: 'lift', weekdayKind: 'lift', spacedAfter: null });
    assert.equal(buildSession(data, THU, 'full').session!.type, 'A');
  });

  it('a custom session is not a lifting day', () => {
    const data = vaultWith([{ date: '2026-04-14', type: 'A' }, { date: '2026-04-15', type: 'custom' }]);
    assert.equal(dayKindOn(data, THU).kind, 'lift');
    assert.equal(buildSession(data, THU, 'full').session!.type, 'B');
  });

  it('a short weekday stays short', () => {
    const wed = '2026-04-15';
    const data = vaultWith([{ date: '2026-04-13', type: 'A' }, { date: '2026-04-14', type: 'B' }], wed);
    assert.deepEqual(dayKindOn(data, wed), { kind: 'short', weekdayKind: 'short', spacedAfter: null });
  });

  it('a session logged today is the day’s session', () => {
    const data = vaultWith([{ date: '2026-04-14', type: 'A' }, { date: '2026-04-15', type: 'B' }, { date: THU, type: 'A' }]);
    const s = buildSession(data, THU, 'full').session!;
    assert.deepEqual([s.type, s.logged], ['A', true]);
    assert.match(s.why, /^Logged today/);
  });
});

describe('nextOfDay (phone.json and the gym page)', () => {
  it('follows the same rule', () => {
    assert.equal(nextOfDay(vaultWith([{ date: '2026-04-14', type: 'A' }, { date: '2026-04-15', type: 'B' }]), THU), 'S3');
    assert.equal(nextOfDay(vaultWith([{ date: '2026-04-15', type: 'B' }]), THU), 'A');
  });
});
