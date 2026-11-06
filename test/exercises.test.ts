import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATALOGUE, CATALOGUE_BY_ID, EQUIPMENT, LEVELS, PATTERNS } from '../src/core/data/exercises.ts';
import { MUSCLE_IDS } from '../src/core/data/muscles.ts';

describe('exercise catalogue', () => {
  it('holds 70-100 movements with unique ids', () => {
    assert.ok(CATALOGUE.length >= 70 && CATALOGUE.length <= 100, String(CATALOGUE.length));
    assert.equal(CATALOGUE_BY_ID.size, CATALOGUE.length);
    for (const e of CATALOGUE) assert.match(e.id, /^[a-z0-9][a-z0-9-]*$/, e.id);
  });

  it('uses known patterns, equipment, levels and muscles', () => {
    for (const e of CATALOGUE) {
      assert.ok((PATTERNS as readonly string[]).includes(e.pattern), e.id);
      assert.ok(e.equipment.length > 0 && e.equipment.every((q) => (EQUIPMENT as readonly string[]).includes(q)), e.id);
      assert.ok((LEVELS as readonly string[]).includes(e.level), e.id);
      for (const m of [...e.muscles.main, ...e.muscles.helps]) assert.ok(MUSCLE_IDS.includes(m), `${e.id}: ${m}`);
      if (e.load !== 'cardio' && e.pattern !== 'mobility') assert.ok(e.muscles.main.length > 0, `${e.id} has main muscles`);
    }
  });

  it('covers every pattern', () => {
    for (const p of PATTERNS) assert.ok(CATALOGUE.some((e) => e.pattern === p), p);
  });

  it('has alternatives that resolve and never point at themselves', () => {
    for (const e of CATALOGUE) {
      for (const a of [...e.easier, ...e.harder]) {
        assert.ok(CATALOGUE_BY_ID.has(a), `${e.id} -> ${a}`);
        assert.notEqual(a, e.id);
      }
    }
  });

  it('includes the regressions the body-assessment table names', () => {
    const named = ['heel-elevated-goblet-squat', 'box-squat', 'landmine-press', 'incline-db-press', 'incline-push-up', 'tempo-goblet-squat', 'split-squat', 'banded-side-walk', 'dead-bug', 'hollow-hold', 'glute-bridge', 'face-pull', 'reverse-db-fly', 'band-pull-apart', 'ankle-mobility', 'thoracic-extension', 'chest-doorway-stretch', 'lat-stretch', 'hip-flexor-stretch', 'single-leg-stance'];
    for (const id of named) assert.ok(CATALOGUE_BY_ID.has(id), id);
  });
});
