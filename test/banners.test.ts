// The banners' numbers on Progress, Plan and Check-in, on the synthetic
// vault: the average strength change (a lift without a change stays out of
// it), the mesocycle's weeks, the week's check-ins, the tape pill (the
// engine's body-record schedule) and
// the Check-in banner's action for the Sunday check-in's state.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { readTracking } from '../src/adapters/vault/tracking-read.ts';
import { checkinWeek, mesocycleWeeks, strengthChange, sundayAction, tapeDay, weeksLogged } from '../src/report/banners.ts';
import { buildCheckin, buildPlan, buildProgress } from '../src/report/index.ts';
import { approx, ROOT } from './helpers.ts';

const VAULT = join(ROOT, 'test', 'fixtures', 'vault');
const BODY = '3-Personal/Fitness/body-data.json';
const CHECKINS = '3-Personal/Fitness/Coach/checkins.json';
const io = (over: Record<string, string> = {}) => ({
  readText: (p: string) => {
    for (const [k, v] of Object.entries(over)) if (p.endsWith(k)) return v;
    return existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null;
  },
  listDir: (p: string) => (existsSync(p) && statSync(p).isDirectory() ? readdirSync(p) : null),
});
const DATE = '2026-04-10';
const read = readVault(io(), VAULT, { asOf: DATE });

describe('strengthChange: the Progress ring', () => {
  const p = buildProgress(read, DATE, VAULT);
  const st = strengthChange(p.lifts);

  it('takes each lift from its first to its latest smoothed e1RM', () => {
    const squat = st.lifts.find((l) => l.name === 'Goblet Squat')!;
    approx(squat.first, 53.33, 0.01, 'first');
    approx(squat.last, 71.5, 0.01, 'last');
    approx(squat.change, 71.5 / 53.33 - 1, 0.001, 'change');
    assert.equal(squat.up, true);
  });

  it('leaves a lift with one qualifying session out of the average, not counted as flat', () => {
    const row = st.lifts.find((l) => l.name === 'Seated Cable Row')!;
    assert.equal(row.change, null);
    assert.equal(row.unitFlag, true);
    assert.equal(row.up, false);
    assert.equal(st.counted, 3);
    approx(st.mean, (71.5 / 53.33 + 70 / 63.33 + 88.67 / 76 - 3) / 3, 0.001, 'mean');
  });

  it('marks up and down only past the 2 % stall line, and has no mean without a change', () => {
    const lift = (bests: number[]) => ({ name: 'X', unit: 'kg', unitFlag: null, sets: bests.map((b, i) => ({ date: `2026-03-0${i + 1}`, used: true, best: b })) });
    const out = strengthChange([lift([100, 101.5]), lift([100, 95]), lift([100])] as never);
    assert.deepEqual(out.lifts.map((l) => [l.up, l.down]), [[false, false], [false, true], [false, false]]);
    assert.equal(out.counted, 2);
    assert.equal(strengthChange([]).mean, null);
  });
});

describe('weeksLogged', () => {
  it('counts the Monday-to-Sunday weeks from the first entry to the date, both included', () => {
    assert.equal(weeksLogged('2026-03-02', DATE), 6);
    assert.equal(weeksLogged('2026-04-08', DATE), 1);
    assert.equal(weeksLogged(null, DATE), 0);
  });
});

describe('mesocycleWeeks: the Plan ring', () => {
  const pl = buildPlan(read, DATE, {}, VAULT);
  const now = 'now' in pl ? pl.now : null;

  it('is this mesocycle, each week past, this week or to come, the deload last', () => {
    const ws = mesocycleWeeks(pl.weeks, now);
    assert.deepEqual(ws.map((w) => [w.index, w.state, w.kind]), [[5, 'past', 'loading'], [6, 'now', 'loading'], [7, 'future', 'loading'], [8, 'future', 'deload']]);
  });

  it('is empty outside the plan weeks', () => {
    assert.deepEqual(mesocycleWeeks(pl.weeks, null), []);
  });
});

describe('checkinWeek: the Check-in ring', () => {
  it('counts the mornings saved so far and the Sunday one still to come', () => {
    const wk = checkinWeek(read, DATE);
    assert.equal(wk.from, '2026-04-06');
    assert.equal(wk.to, '2026-04-12');
    assert.deepEqual(wk.mornings.map((d) => d.done), [true, true, true, true, true, false, false]);
    assert.equal(wk.morningsSoFar, 5);
    assert.deepEqual([wk.sunday.done, wk.sunday.future], [false, true]);
    assert.deepEqual([wk.done, wk.total], [5, 8]);
  });

  it('takes the Sunday one from the week’s record, and a morning only from checkedAt or its own answers', () => {
    const body = JSON.parse(readFileSync(join(VAULT, BODY), 'utf8'));
    body.days['2026-04-07'] = { weight: 83.7, steps: 7718 };
    body.days['2026-04-08'] = { energy: 3 };
    const r = readVault(io({ [BODY]: JSON.stringify(body), [CHECKINS]: JSON.stringify({ schemaVersion: 1, checkins: [{ date: '2026-04-12', weekStart: '2026-04-06' }] }) }), VAULT, { asOf: '2026-04-12' });
    const wk = checkinWeek(r, '2026-04-12');
    assert.deepEqual(wk.mornings.map((d) => d.done), [true, false, true, true, true, true, false]);
    assert.deepEqual([wk.sunday.done, wk.sunday.future, wk.sunday.savedOn], [true, false, '2026-04-12']);
    assert.equal(wk.done, 6);
  });
});

describe('tapeDay: the Check-in banner\'s Tape pill', () => {
  const tr = (over: Record<string, string> = {}) => readTracking(io(over), VAULT);
  const TRACKING = '3-Personal/Fitness/Coach/tracking.json';
  const withSchedule = (bodyRecord: unknown) => {
    const t = JSON.parse(readFileSync(join(VAULT, TRACKING), 'utf8'));
    t.bodyRecord = bodyRecord;
    return { [TRACKING]: JSON.stringify(t) };
  };
  it('follows the plan\'s tape days, due until a tape entry on or after the occurrence', () => {
    // Plan week 4's Sunday (29 Mar) has no tape on or after it: still due.
    assert.deepEqual(tapeDay(read, tr(), DATE), { date: '2026-03-29', due: true, text: 'Every second Sunday', source: 'plan' });
    const body = JSON.parse(readFileSync(join(VAULT, BODY), 'utf8'));
    body.tape.push({ date: '2026-04-07', waist: 93.6 });
    const done = { [BODY]: JSON.stringify(body) };
    assert.deepEqual(tapeDay(readVault(io(done), VAULT, { asOf: DATE }), tr(done), DATE), { date: '2026-04-12', due: false, text: 'Every second Sunday', source: 'plan' });
  });
  it('reads every N days from the start date when Coach/tracking.json sets it, not the plan calendar', () => {
    const fixed = withSchedule({ schedule: 'fixed', tapeFrom: '2026-03-24', tapeEvery: 14, testsFrom: '2026-03-21', testsEvery: 28 });
    // 24 Mar has its tape; the next occurrence is 7 Apr, and nothing is on record after it.
    assert.deepEqual(tapeDay(read, tr(fixed), DATE), { date: '2026-04-07', due: true, text: 'Every 14 days from Tue 24 Mar', source: 'fixed' });
    assert.equal(tapeDay(read, tr(fixed), '2026-03-25')!.date, '2026-04-07');
  });
  it('works without the tracking files (the plan\'s schedule)', () => {
    assert.equal(tapeDay(read, null, DATE)!.source, 'plan');
  });
});

describe('sundayAction: the Check-in banner\'s button', () => {
  const saved = JSON.stringify({ schemaVersion: 1, checkins: [{ date: '2026-04-05', weekStart: '2026-03-30' }] });
  const at = (date: string, over: Record<string, string> = {}) => {
    const r = readVault(io(over), VAULT, { asOf: date });
    return buildCheckin(r, date, null).sunday!.status;
  };

  it('finishes last Sunday\'s check-in on a weekday while it is unsaved', () => {
    const status = at(DATE);
    assert.equal(status, 'late');
    assert.deepEqual(sundayAction(status), { kind: 'finish', primary: true, label: 'Finish last Sunday’s check-in' });
  });

  it('is the quiet "opens Sun" on a weekday once last Sunday\'s is saved', () => {
    const status = at(DATE, { [CHECKINS]: saved });
    assert.equal(status, 'saved');
    assert.deepEqual(sundayAction(status), { kind: 'opens', primary: false, label: 'Sunday check-in opens Sun' });
  });

  it('starts the check-in on a Sunday, and is quiet once it is saved that day', () => {
    const status = at('2026-04-12', { [CHECKINS]: saved });
    assert.equal(status, 'open');
    assert.deepEqual(sundayAction(status), { kind: 'start', primary: true, label: 'Start the Sunday check-in' });
    const edit = at('2026-04-12', { [CHECKINS]: JSON.stringify({ schemaVersion: 1, checkins: [{ date: '2026-04-12', weekStart: '2026-04-06' }] }) });
    assert.equal(edit, 'edit');
    assert.deepEqual(sundayAction(edit), { kind: 'saved', primary: false, label: 'Sunday check-in saved' });
  });
});
