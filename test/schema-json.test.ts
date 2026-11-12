// The hand-written JSON Schema must agree with validate.ts: the same object
// shapes, the same required keys, the same properties and the same enums.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  CONFIDENCE,
  DAY_MARKS,
  EMPHASIS_KINDS,
  EXERCISE_KINDS,
  EXPERIENCE,
  GOAL_KINDS,
  SCHEMA_VERSION,
  SCREENING_OUTCOMES,
  SESSION_KINDS,
  TRACKING_LEVELS,
  UNITS,
  WEEKDAYS,
  WEEK_KINDS,
  PROGRESSION_RULES,
  BUSY_KINDS,
  SORENESS_LEVELS,
  ITEM_KINDS,
  ITEM_SLOTS,
  SCHEDULE_KINDS,
  SUGGESTION_STATES,
  NUDGE_ANSWERS,
  BAD_WEEK_KINDS,
  SPLIT_KINDS,
  EATING_LEVELS,
  COUNTING,
  HAND_KINDS,
  PATTERN_PERIODS,
  ADJUST_STEPS,
  REASON_SOURCES,
  INBOX_KINDS,
  TRAINED_ANSWERS,
  SKIP_REASONS,
  SWAP_REASONS,
} from '../src/core/schema.ts';
import { PATTERNS } from '../src/core/data/exercises.ts';
import { SHAPE_KEYS } from '../src/core/validate.ts';
import { ROOT } from './helpers.ts';

interface Def {
  type?: string;
  required?: string[];
  properties?: Record<string, unknown>;
  additionalProperties?: unknown;
  patternProperties?: Record<string, unknown>;
  enum?: string[];
  const?: unknown;
}

const schema = JSON.parse(readFileSync(join(ROOT, 'schema', 'pahlavan.v1.schema.json'), 'utf8')) as {
  $schema: string;
  anyOf: { $ref: string }[];
  $defs: Record<string, Def>;
};
const sorted = (x: readonly string[]) => [...x].sort();

describe('JSON Schema', () => {
  it('parses as draft 2020-12 with the eleven documents and the phone\'s entry at the root', () => {
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.deepEqual(schema.anyOf.map((r) => r.$ref), ['profile', 'program', 'log', 'checkins', 'body', 'ledger', 'checkinLog', 'tracking', 'nudges', 'sittingLog', 'eatingPlan', 'inboxEntry'].map((n) => `#/$defs/${n}`));
    assert.equal(schema.$defs['schemaVersion']!.const, SCHEMA_VERSION);
  });

  it('has exactly the validator\'s object shapes', () => {
    const objects = Object.entries(schema.$defs).filter(([, d]) => d.type === 'object' && d.properties).map(([n]) => n);
    assert.deepEqual(sorted(objects), sorted(Object.keys(SHAPE_KEYS)));
  });

  for (const [name, keys] of Object.entries(SHAPE_KEYS)) {
    it(`${name}: same required keys and properties, closed to other keys`, () => {
      const d = schema.$defs[name]!;
      assert.deepEqual(sorted(d.required ?? []), sorted(keys.required), 'required');
      assert.deepEqual(sorted(Object.keys(d.properties ?? {})), sorted([...keys.required, ...keys.optional]), 'properties');
      assert.equal(d.additionalProperties, false);
      assert.deepEqual(d.patternProperties, { '^_': true });
    });
  }

  it('uses the same enums as schema.ts', () => {
    const enums: Record<string, readonly string[]> = {
      unit: UNITS,
      trackingLevel: TRACKING_LEVELS,
      screeningOutcome: SCREENING_OUTCOMES,
      goalKind: GOAL_KINDS,
      confidence: CONFIDENCE,
      weekday: WEEKDAYS,
      exerciseKind: EXERCISE_KINDS,
      sessionKind: SESSION_KINDS,
      weekKind: WEEK_KINDS,
      dayMark: DAY_MARKS,
      experience: EXPERIENCE,
      emphasisKind: EMPHASIS_KINDS,
      pattern: PATTERNS,
      progressionRule: PROGRESSION_RULES,
      busyKind: BUSY_KINDS,
      sorenessLevel: SORENESS_LEVELS,
      itemKind: ITEM_KINDS,
      itemSlot: ITEM_SLOTS,
      scheduleKind: SCHEDULE_KINDS,
      suggestionState: SUGGESTION_STATES,
      nudgeAnswer: NUDGE_ANSWERS,
      badWeekKind: BAD_WEEK_KINDS,
      splitKind: SPLIT_KINDS,
      eatingLevel: EATING_LEVELS,
      counting: COUNTING,
      handKind: HAND_KINDS,
      patternPeriod: PATTERN_PERIODS,
      adjustStepId: ADJUST_STEPS,
      reasonSourceKind: REASON_SOURCES,
      trainedAnswer: TRAINED_ANSWERS,
      skipReason: SKIP_REASONS,
      swapReason: SWAP_REASONS,
    };
    for (const [name, values] of Object.entries(enums)) assert.deepEqual(schema.$defs[name]!.enum, [...values], name);
  });

  it('takes the answers to the findings as true or false: per body-assessment row, and per self-check test with a finding', async () => {
    const { SELF_CHECK_FINDINGS } = await import('../src/core/findings.ts');
    assert.deepEqual(schema.$defs['emphasis']!.properties!['confirmed'], { type: 'boolean', description: (schema.$defs['emphasis']!.properties!['confirmed'] as { description: string }).description });
    assert.deepEqual(schema.$defs['selfCheck']!.properties!['confirmed'], { $ref: '#/$defs/selfCheckConfirmed' });
    const answers = schema.$defs['selfCheckConfirmed']!;
    assert.deepEqual(Object.keys(answers.properties!), [...SELF_CHECK_FINDINGS]);
    for (const k of SELF_CHECK_FINDINGS) assert.deepEqual(answers.properties![k], { type: 'boolean' }, k);
    for (const k of SELF_CHECK_FINDINGS) assert.ok(k in schema.$defs['selfCheck']!.properties!, `${k} is a self-check test`);
  });

  it('uses the validator\'s key patterns for nudges and sitting', async () => {
    const { NUDGE_KEY, SKIP_KEY, MAC_NAME } = await import('../src/core/validate.ts');
    const days = (schema.$defs['nudges']!.properties!['days'] as Def).patternProperties!;
    const inner = Object.values(days)[0] as Def;
    assert.deepEqual(Object.keys(inner.patternProperties!), [NUDGE_KEY.source]);
    assert.deepEqual(Object.keys((schema.$defs['nudges']!.properties!['skipped'] as Def).patternProperties!), [SKIP_KEY.source]);
    const macs = Object.values((schema.$defs['sittingLog']!.properties!['days'] as Def).patternProperties!)[0] as Def;
    assert.deepEqual(Object.keys(macs.patternProperties!), [MAC_NAME.source]);
  });

  it('gives the phone\'s entry one shape per kind, each with the version and its kind as constants, and the validator\'s time pattern', async () => {
    const { INBOX_AT } = await import('../src/core/validate.ts');
    const shapes = (schema.$defs['inboxEntry'] as Def & { oneOf: { $ref: string }[] }).oneOf.map((r) => schema.$defs[r.$ref.slice(8)]!);
    assert.deepEqual(shapes.map((d) => (d.properties!['kind'] as Def).const), [...INBOX_KINDS]);
    for (const d of shapes) assert.equal((d.properties!['v'] as Def).const, 1);
    assert.equal((schema.$defs['inboxAt'] as Def & { pattern: string }).pattern, INBOX_AT.source);
  });

  it('resolves every $ref', () => {
    const refs = JSON.stringify(schema).match(/"#\/\$defs\/[A-Za-z0-9]+"/g) ?? [];
    for (const r of refs) assert.ok(r.slice(9, -1) in schema.$defs, r);
  });
});
