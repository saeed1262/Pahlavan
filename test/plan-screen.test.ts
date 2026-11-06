// The Plan screen's report: the vault plan's weeks, the decision log, busy
// weeks, the Ledger and temporary changes, templates, volume, targets, load
// and the calendar.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { buildPlan, parseDecisions, planCalendar } from '../src/report/index.ts';
import { ROOT } from './helpers.ts';

const VAULT = join(ROOT, 'test', 'fixtures', 'vault');
const DATE = '2026-04-10';
const io = (drop?: RegExp) => ({
  readText: (p: string) => (drop && drop.test(p) ? null : existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null),
  listDir: (p: string) => (existsSync(p) && statSync(p).isDirectory() ? readdirSync(p) : null),
});
const DECISIONS = readFileSync(join(ROOT, 'test', 'fixtures', 'decisions-sample.md'), 'utf8');

describe('parseDecisions', () => {
  it('reads the skill’s format, with the status line’s review and outcome', () => {
    const d = parseDecisions('# Decisions\n\n## 2026-11-22 · Week resized to 4 sessions\n- **Status:** accepted · **review:** 2026-12-20 · **outcome:** kept (93% done)\n- **Trigger:** weekly check-in, 4-week adherence.\n- **Rule:** week sized to confirmed sessions + 1.\n- **Change:** `weekTarget` lift 4, short 3 → lift 4, short 0.\n- **Expected effect:** ≥ 90% of planned sessions done.\n\n## 2026-11-15 · Early deload declined\n- **Status:** declined · readiness low 3 days\n\n## Notes without a date\n- not a decision\n');
    assert.deepEqual(d.map((x) => [x.date, x.title, x.status, x.review, x.outcome]), [['2026-11-15', 'Early deload declined', 'declined', null, null], ['2026-11-22', 'Week resized to 4 sessions', 'accepted', '2026-12-20', 'kept (93% done)']]);
    assert.equal(d[1]!.rule, 'week sized to confirmed sessions + 1.');
  });
  it('reads plain "- Field:" lines too, and leaves "(filled at review)" out', () => {
    const d = parseDecisions(DECISIONS);
    assert.equal(d.length, 4);
    assert.equal(d[0]!.review, '2026-04-26');
    assert.match(d[0]!.trigger!, /^Intake/);
    assert.equal(parseDecisions('## 2026-01-01 · X\n- **Status:** accepted · **review:** 2026-02-01 · **outcome:** (filled at review)')[0]!.outcome, null);
  });
});

describe('planCalendar', () => {
  it('puts the check-in on Sundays, tape every second week, photos at a mesocycle’s end, tests on the test week’s Saturday', () => {
    const w = (index: number, start: string, extra = {}) => ({ index, start, end: start.replace(/\d\d$/, (d) => String(Number(d) + 6).padStart(2, '0')), kind: 'loading', calibration: false, tests: false, phase: 1, meso: 1, weekInMeso: index, photos: false, ...extra });
    const ev = planCalendar([w(1, '2026-03-02'), w(2, '2026-03-09', { kind: 'deload', photos: true, tests: true })], [{ index: 1, to: '2026-03-15' }], '2026-09-30');
    assert.deepEqual(ev.map((e) => `${e.date} ${e.kind}`), ['2026-03-08 checkin', '2026-03-09 deload', '2026-03-14 tests', '2026-03-15 photos', '2026-03-15 tape', '2026-03-15 checkin', '2026-03-15 phase-review', '2026-09-30 rescreen']);
  });
});

type Built = Extract<ReturnType<typeof buildPlan>, { templates: unknown }>;

describe('buildPlan', () => {
  const r = buildPlan(readVault(io(), VAULT, { asOf: DATE }), DATE, { decisions: DECISIONS }) as Built;
  it('lays out the 24 weeks with calibration, deloads and the phase tests, and finds today', () => {
    assert.equal(r.weeks.length, 24);
    assert.deepEqual(r.now, { index: 6, phase: 1, meso: 2 });
    assert.deepEqual(r.weeks.filter((w) => w.calibration).map((w) => w.index), [1]);
    assert.deepEqual(r.weeks.filter((w) => w.kind === 'deload').map((w) => w.index), [4, 8, 12, 16, 20, 24]);
    assert.deepEqual(r.weeks.filter((w) => w.tests).map((w) => w.index), [8, 16, 24]);
    assert.deepEqual([r.phases.length, r.mesocycles.length], [3, 6]);
  });
  it('carries the decisions, the Ledger, the temporary changes and this week’s templates', () => {
    assert.equal(r.decisions.length, 4);
    assert.deepEqual(r.ledger.map((l) => [l.id, l.until]), [['abdominal-wall', '2026-04-19'], ['shoulder', null]]);
    assert.deepEqual(r.temporary.map((t) => [t.item, t.until]), [['Goblet Squat', '2026-04-19']]);
    assert.deepEqual(r.templates.map((t) => t.type), ['A', 'B', 'S1', 'S3']);
    const rdl = r.templates.find((t) => t.type === 'B')!.slots.find((s) => s.exercise === 'romanian-deadlift')!;
    assert.equal(rdl.ledger!.allowed, false);
  });
  it('gives planned sets per muscle, the generator’s phase targets on the profile, the load and what comes up', () => {
    assert.ok(r.volume!.muscles.length > 10);
    assert.deepEqual(r.targets!.generated!.map((t) => [t.measure, t.by]), [['waist (tape)', '2026-04-26'], ['wall gap', '2026-04-26']]);
    // Next week's short day at its minutes as planned (12, from its items), the lifting days at their typical logged 60.
    assert.equal(r.load!.next.load, 1476);
    assert.deepEqual(r.load!.next.daily.reduce((a, v) => a + v, 0), 1476);
    assert.deepEqual(r.upcoming!.slice(0, 5).map((u) => `${u.date} ${u.kind}`), ['2026-04-12 tape', '2026-04-12 checkin', '2026-04-19 checkin', '2026-04-19 ledger-end', '2026-04-19 change-end']);
    assert.deepEqual(r.notes, []);
  });
  it('keeps the known part of next week’s load when a planned session has no minutes, and leaves monotony unknown', () => {
    const noMinutes = (type: string) => (p: string) => {
      const text = readFileSync(p, 'utf8');
      if (!p.endsWith('fitness-log-data.json')) return text;
      const log = JSON.parse(text) as { sessions: { type?: string; durationMin?: number }[] };
      for (const s of log.sessions) if (s.type === type) delete s.durationMin;
      return JSON.stringify(log);
    };
    const base = io();
    const without = (type: string) => buildPlan(readVault({ ...base, readText: (p: string) => (base.readText(p) == null ? null : noMinutes(type)(p)) }, VAULT, { asOf: DATE }), DATE, { decisions: null }) as Built;
    // A lifting day with no logged minutes has none planned: both Full Body B sessions are unknown.
    const v = without('B');
    assert.deepEqual([v.load!.next.load, v.load!.next.knownLoad, v.load!.next.unknown, v.load!.nextMonotony], [null, 576, 2, null]);
    // A short day has its minutes as planned, logged or not.
    assert.deepEqual([without('S3').load!.next.knownLoad, without('S3').load!.next.unknown], [1476, 0]);
    assert.deepEqual([r.load!.next.knownLoad, r.load!.next.unknown], [1476, 0]);
  });
  it('says so calmly without a decision log, a profile or a Ledger', () => {
    const bare = buildPlan(readVault(io(/Coach\//), VAULT, { asOf: DATE }), DATE, { decisions: null }) as Built;
    assert.deepEqual(bare.notes.map((n) => n.code), ['no-decisions', 'no-ledger', 'no-profile']);
    assert.equal(bare.targets!.generated, null);
    assert.ok(bare.temporary!.length === 1);
  });
});
