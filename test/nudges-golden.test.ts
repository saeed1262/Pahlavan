// The Habit Nudges ports against Habit Nudges' own helpers: the golden file
// written by tools/golden-nudges.mjs (its main.js internals on made-up
// inputs, in a fixed UTC-5 zone; each case holds its inputs and outputs),
// and, when main.js is on this machine, the same inputs run through it live
// (read only, the app module stubbed), so a change there shows up here.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fixedOffsetClock } from '../src/core/clock.ts';
import { periodStart } from '../src/core/body-schedule.ts';
import { splitName } from '../src/core/habit-import.ts';
import { sittingStep, type Stretch } from '../src/core/sitting.ts';
import { STAND_FRESH, standStep, type StandState, type StandStepConfig } from '../src/core/standup.ts';
import { habitCheckinKey, habitValue, isoWeekKey } from '../src/core/tracking.ts';
import { LIVE_VAULT, ROOT } from './helpers.ts';

type Json = Record<string, any>;
type Tick = { gapMs: number; idleS: number; meeting: boolean };
type DeskIn = { now: number; idleS: number; meeting: boolean; manual: boolean };
const G = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'golden', 'nudges-golden.json'), 'utf8')) as Json;
const UTC_MINUS_5 = fixedOffsetClock(-300);

type StepFn = (st: Json, inp: Json, cfg: Json) => { st: Json; event: string | null };
function runStand(step: StepFn, start: Json, ticks: Tick[]) {
  let st: Json = { ...STAND_FRESH, ...start };
  let now = G.t0 as number;
  return ticks.map((t) => {
    now += t.gapMs;
    const r = step(st, { now, ...t }, G.standCfg);
    st = r.st;
    return { st: r.st, event: r.event };
  });
}

describe('Habit Nudges ports, against its own helpers (golden)', () => {
  it('was generated from a main.js in the fixed zone', () => {
    assert.match(G.main, /^[0-9a-f]{16}$/);
    assert.equal(G.tz, 'Etc/GMT+5');
  });

  for (const c of G.stand as Json[]) {
    it(`standStep: ${c.name}`, () => {
      const port: StepFn = (st, inp, cfg) => standStep(st as Partial<StandState>, inp as never, cfg as StandStepConfig);
      assert.deepEqual(runStand(port, c.start, c.ticks), c.steps);
    });
  }

  for (const c of G.desk as Json[]) {
    it(`sittingStep as deskStep: ${c.name}`, () => {
      let st = c.start as Stretch | null;
      const out = (c.inputs as DeskIn[]).map((s) => {
        const r = sittingStep(st, { now: s.now, idleS: s.idleS, call: s.meeting, standing: s.manual }, { awayMinutes: G.deskCfg.idleMinutes }, UTC_MINUS_5);
        st = r.st;
        return r;
      });
      assert.deepEqual(out, c.steps);
    });
  }

  it('periodStart matches on every case', () => {
    for (const p of G.periods) assert.equal(periodStart(p.from, p.every, p.day), p.start, `${p.from} every ${p.every} on ${p.day}`);
  });

  it('the habit keys match the homepage\'s (isoWeekKey, checkinKey), across year ends', () => {
    for (const k of G.keys) {
      assert.equal(isoWeekKey(k.day), k.week, k.day);
      assert.equal(habitCheckinKey('water', k.day), k.key, k.day);
    }
  });

  it('splitName matches', () => {
    for (const n of G.names) assert.deepEqual(splitName(n.name), { label: n.label, unit: n.unit }, n.name);
  });

  it('a linked habit\'s value matches currentValue (a tick is any key, an amount its number)', () => {
    const habits = { habits: G.values.map((v: Json) => ({ id: v.id, type: v.type })), checkins: G.checkins };
    for (const v of G.values) assert.equal(habitValue(habits, v.id, '2026-04-10') ?? 0, v.value, v.id);
  });
});

const LIVE = LIVE_VAULT ? join(LIVE_VAULT, '.obsidian/plugins/habit-nudges/main.js') : '';

/** main.js's internals, the app module stubbed (read only; nothing in it runs against the vault). */
function liveInternals(): Json {
  const src = readFileSync(LIVE, 'utf8');
  class Stub {}
  const app = new Proxy({}, { get: (_, k) => (k === 'setIcon' || k === 'setTooltip' ? () => {} : Stub) });
  const mod: Json = { exports: {} };
  new Function('require', 'module', 'exports', src)((n: string) => {
    if (n === 'obsidian') return app;
    throw new Error(`main.js asked for ${n} while loading`);
  }, mod, mod['exports']);
  return mod['exports'].internals;
}

// Only on a machine with the vault; elsewhere the golden file stands alone.
if (existsSync(LIVE)) describe('Habit Nudges ports, against main.js itself (on this machine)', () => {
  it('main.js still behaves as the golden file says (else regenerate it)', () => {
    const I = liveInternals();
    for (const c of G.stand as Json[]) assert.deepEqual(runStand(I['standStep'], c.start, c.ticks), c.steps, c.name);
    for (const p of G.periods) {
      const [y, m, d] = (p.day as string).split('-').map(Number);
      assert.equal(I['periodStart'](p.from, p.every, new Date(y!, m! - 1, d!)), p.start);
    }
    for (const n of G.names) assert.deepEqual(I['splitName'](n.name), { label: n.label, unit: n.unit });
  });
});
