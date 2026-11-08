// The coach's standing rules: reading them from plan-data.json, the old
// defaults that stand in for any the plan leaves out, the light-week
// calendar, and the rule in words as a reason cites it.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CALIBRATION } from '../src/core/calibration.ts';
import { DELOAD } from '../src/core/deload.ts';
import { MISSED } from '../src/core/missed.ts';
import { PROGRESSION } from '../src/core/progression.ts';
import { explain } from '../src/core/reason.ts';
import {
  cite,
  fromKind,
  isLightWeek,
  legacyItems,
  legacyRules,
  lightWeekAt,
  liftRuleText,
  nextLightWeek,
  phaseWeeks,
  planCalendar,
  readRules,
  ruleText,
  RULE_KINDS,
  weeksThrough,
} from '../src/core/rules.ts';
import { SORENESS } from '../src/core/soreness.ts';
import { ROOT } from './helpers.ts';

describe('the old defaults', () => {
  it('come from the constants the engine has always used', () => {
    const r = legacyRules();
    assert.deepEqual(r.lightWeeks, { every: DELOAD.every, weeks: null, sets: DELOAD.legacySets, load: DELOAD.legacyLoadFactor, rirAdd: PROGRESSION.deloadRirAdd, early: 'apply' });
    assert.deepEqual(r.calibration, { weeks: [1], rir: CALIBRATION.rir, cardio: 'easy', afterRestart: true });
    assert.deepEqual(r.soreness, { sore: { sets: -SORENESS.setsDrop, rir: SORENESS.rirAdd }, twoDays: 'easier' });
    assert.equal(r.missed.restartAfterWeeks, MISSED.restartAfterWeeks);
    assert.equal(r.missed.easeBackRir, MISSED.easeBackRirAdd);
    assert.equal(r.missed.easeBackDrop, 0.1);
    assert.deepEqual(r.readiness.low, { sets: -1, rir: 1 });
    assert.deepEqual([r.stall.response, r.hotel.swaps, r.hotel.longTripSets, r.express.short], ['triage', 'catalogue', 'third', 'half']);
  });

  it('stand for every kind of a plan that declares nothing, with no problems', () => {
    const r = readRules({ sessions: {}, lifts: { Squat: { lo: 6, hi: 10, inc: 5 } } });
    assert.deepEqual(r.rules, legacyRules());
    assert.ok(RULE_KINDS.every((k) => r.sources[k] === 'legacy-default'));
    assert.deepEqual(r.lifts['Squat'], { rule: { rule: 'double', onMiss: { after: 2, drop: 0.1 }, onStall: 'report' }, source: 'legacy-default' });
    assert.deepEqual(r.problems, []);
  });
});

describe('reading the rules', () => {
  it('reads each kind the plan writes, the rest staying the old default', () => {
    const r = readRules({
      rules: {
        calibration: 'none',
        lightWeeks: { weeks: [4, 8, 13], sets: 'half', load: 0.85, rirAdd: 2 },
        tests: { weeks: [8, 16] },
        readiness: 'none',
        soreness: { sore: { sets: 0, rir: 1 }, twoDays: 'same' },
        stall: { response: 'report' },
      },
      express: { short: 'skip' },
    });
    assert.deepEqual(r.rules.calibration.weeks, []);
    assert.equal(r.rules.calibration.afterRestart, false);
    assert.deepEqual(r.rules.lightWeeks, { every: null, weeks: [4, 8, 13], sets: 'half', load: 0.85, rirAdd: 2, early: 'offer' });
    assert.deepEqual(r.rules.tests.weeks, [8, 16]);
    assert.equal(r.rules.readiness.low, null);
    assert.deepEqual(r.rules.soreness, { sore: { sets: 0, rir: 1 }, twoDays: 'same' });
    assert.equal(r.rules.stall.response, 'report');
    assert.equal(r.rules.express.short, 'skip');
    assert.equal(r.sources.missed, 'legacy-default');
    assert.equal(r.sources.hotel, 'legacy-default');
    assert.equal(r.sources.lightWeeks, 'plan');
    assert.deepEqual(r.problems, []);
  });

  it('applies an early light week only when the plan says so', () => {
    assert.equal(readRules({ rules: { lightWeeks: { every: 5 } } }).rules.lightWeeks.early, 'offer');
    assert.equal(readRules({ rules: { lightWeeks: { every: 5, early: 'apply' } } }).rules.lightWeeks.early, 'apply');
  });

  it('falls back to the old default for a kind it cannot read, and lists every problem', () => {
    const r = readRules({ rules: { lightWeeks: { every: 1 }, missed: { easeBackAfterWeeks: 3, restartAfterWeeks: 3 }, hotel: { swaps: 'catalogue', wifi: true }, deloads: {} } });
    assert.equal(r.sources.lightWeeks, 'legacy-default');
    assert.deepEqual(r.rules.lightWeeks, legacyRules().lightWeeks);
    assert.equal(r.sources.missed, 'legacy-default');
    // An unknown key is a problem; the kind's known keys are still read.
    assert.equal(r.sources.hotel, 'plan');
    assert.deepEqual(r.problems.map((p) => p.path), ['rules.deloads', 'rules.lightWeeks.every', 'rules.missed', 'rules.hotel.wifi']);
  });

  it('reads a lift\'s progression, and the old default for one it cannot read', () => {
    const r = readRules({
      lifts: {
        Bench: { lo: 8, hi: 12, inc: 5, progression: { rule: 'linear', onMiss: 'hold', onStall: { drop: 0.1 } } },
        Row: { lo: 8, hi: 12, inc: 5, progression: { rule: 'target', target: { weight: 60, reps: 8, rir: 2 } } },
        Squat: { lo: 6, hi: 10, inc: 5, progression: { rule: 'ladder' } },
        Curl: { lo: 10, hi: 15, inc: 5, progression: { rule: 'target' } },
      },
    });
    assert.deepEqual(r.lifts['Bench'], { rule: { rule: 'linear', onMiss: 'hold', onStall: { drop: 0.1 } }, source: 'plan' });
    assert.deepEqual(r.lifts['Row']!.rule.target, { weight: 60, reps: 8, rir: 2 });
    assert.equal(r.lifts['Squat']!.source, 'legacy-default');
    assert.equal(r.lifts['Curl']!.source, 'legacy-default');
    assert.deepEqual(r.problems.map((p) => p.path), ['lifts["Squat"].progression.rule', 'lifts["Curl"].progression.target']);
  });
});

describe('reading the rules: what is said back', () => {
  it('a target\'s onMiss and onStall are not read; empty test weeks and rules.express are refused with where to look', () => {
    const r = readRules({
      rules: { tests: { weeks: [] }, express: { short: 'skip' } },
      lifts: { Row: { lo: 8, hi: 12, inc: 5, progression: { rule: 'target', target: { weight: 60, reps: 8, rir: 2 }, onMiss: 'hold' } } },
    });
    assert.equal(r.lifts['Row']!.source, 'plan', 'the target itself is read');
    assert.equal(r.sources.tests, 'legacy-default');
    assert.deepEqual(r.problems.map((x) => x.path), ['rules.express', 'rules.tests.weeks', 'lifts["Row"].progression.onMiss']);
    assert.match(r.problems[0]!.message, /express\.short/);
  });
});

describe('the light-week calendar', () => {
  const legacy = legacyRules().lightWeeks;

  it('every 4th week reads exactly as the fixed calendar always did', () => {
    for (let w = 1; w <= 60; w++) {
      const at = lightWeekAt(legacy, w);
      assert.deepEqual(
        [at.light, at.lightNext, at.mesocycle, at.weekInMesocycle, at.phase, at.weeksToMesocycleEnd, at.mesocycleWeeks],
        [w % 4 === 0, w % 4 === 3, Math.floor((w - 1) / 4) + 1, ((w - 1) % 4) + 1, Math.floor((w - 1) / 8) + 1, 4 - (((w - 1) % 4) + 1), 4],
        `week ${w}`,
      );
      assert.equal(weeksThrough(legacy, 24, w), Math.max(24, Math.ceil(w / 8) * 8), `weeks through ${w}`);
    }
    assert.deepEqual(phaseWeeks(legacy, 3), { first: 17, last: 24 });
  });

  it('a listed calendar ends a mesocycle at each light week; phases stay two mesocycles', () => {
    const lw = { every: null, weeks: [4, 8, 13] };
    assert.deepEqual(planCalendar(lw, 16).map((p) => p.map((m) => m.weeks)), [[[1, 2, 3, 4], [5, 6, 7, 8]], [[9, 10, 11, 12, 13], [14, 15, 16]]]);
    assert.deepEqual(lightWeekAt(lw, 10), { planWeek: 10, light: false, lightNext: false, mesocycle: 3, weekInMesocycle: 2, mesocycleWeeks: 5, phase: 2, weeksToMesocycleEnd: 3 });
    assert.equal(lightWeekAt(lw, 15).weeksToMesocycleEnd, null);
    assert.equal(nextLightWeek(lw, 14), null);
    assert.deepEqual([isLightWeek(lw, 13), isLightWeek(lw, 12)], [true, false]);
    assert.deepEqual(phaseWeeks(lw, 2), { first: 9, last: null });
  });

});

describe('the rule in words', () => {
  it('says each kind and each lift rule, and cites where it came from', () => {
    const r = legacyRules();
    assert.equal(ruleText('lightWeeks', r), 'light weeks every 4th plan week: 2 sets of everything, about 10 % lighter, RIR +3; an early light week applied on a trigger');
    assert.equal(ruleText('readiness', r), 'a low-readiness day takes one set off and 1 more RIR');
    assert.equal(liftRuleText({ rule: 'double', onMiss: { after: 2, drop: 0.1 }, onStall: 'report' }, { lo: 8, hi: 12, inc: 5, unit: 'lb' }), 'double progression on 8-12, +5 lb once every set reaches 12; 2 sessions in a row under 8 -> about 10 % lighter');
    assert.equal(cite('plan', 'x'), "The plan's rule: x.");
    assert.equal(cite('legacy-default', 'x.'), "Pahlavan's default (the plan sets none): x.");
    const from = fromKind(readRules({ rules: { stall: { response: 'report' } } }), 'stall');
    assert.deepEqual([from.kind, from.path], ['plan', 'rules.stall']);
  });

  it('a reason that cites a rule leads its note with the rule', () => {
    const from = { kind: 'plan' as const, path: 'rules.readiness', text: "The plan's rule: readiness changes nothing in the session." };
    const r = explain(1, 'readiness.trim', {}, { note: 'Readiness is low.', from });
    assert.equal(r.reason.note, "The plan's rule: readiness changes nothing in the session. Readiness is low.");
    assert.deepEqual(r.reason.from, from);
    assert.equal(explain(1, 'readiness.trim', {}).reason.from, undefined);
  });

  it('lists what the plan leaves to the old default, for the legacy-default warning', () => {
    const items = legacyItems(readRules({ rules: { lightWeeks: { every: 4 } }, express: { short: 'half' }, lifts: { Squat: { lo: 6, hi: 10, inc: 5 }, Bench: { lo: 8, hi: 12, inc: 5, progression: { rule: 'double' } } } }));
    assert.ok(!items.some((i) => i.startsWith('rules.lightWeeks') || i.startsWith('express.short')));
    assert.ok(items.some((i) => i.startsWith('rules.readiness: a low-readiness day')));
    assert.equal(items.at(-1), 'lifts without a progression rule: Squat (double progression; 2 sessions under lo -> 10 % lighter)');
  });
});

// One light-week calendar: a screen counting "every 4th week" on its own
// would disagree with a plan that declares other light weeks.
describe('one source for the light-week calendar', () => {
  const sources = ['src', join('plugin', 'src')].flatMap((dir) =>
    readdirSync(join(ROOT, dir), { recursive: true })
      .filter((f) => f.endsWith('.ts') && join(dir, f) !== join('src', 'core', 'rules.ts'))
      .map((f) => ({ name: join(dir, f), text: readFileSync(join(ROOT, dir, f), 'utf8') })),
  );

  it('no week arithmetic modulo 4, 8 or DELOAD.every outside rules.ts', () => {
    assert.ok(sources.length >= 50);
    const banned = [/%\s*(?:4|8)\b/, /%\s*DELOAD\.every\b/, /\/\s*[48]\)\s*[+*]\s*[148]\b/, /DELOAD\.every\s*\*/, /\*\s*[48]\s*\+\s*1\b/];
    for (const { name, text } of sources) for (const re of banned) assert.doesNotMatch(text, re, `${name} counts light weeks itself (${re}): use rules.ts`);
  });
});
