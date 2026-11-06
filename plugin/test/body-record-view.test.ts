// Check-in's Body record card drawn in Node with the small fake DOM: where
// each part's schedule comes from reads in plain words, "from your plan"
// or, for every N days, "your own schedule" (never "until your reset").

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { readTracking } from '../../src/adapters/vault/tracking-read.ts';
import { buildBodyRecord } from '../../src/report/habits-screen.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';
import { bodyRecordCard } from '../src/ui/body-record.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';

installFakeDom();
const DATE = '2026-04-10';
const TRK = 'v/3-Personal/Fitness/Coach/tracking.json';

function card(fixed: boolean) {
  const files = fixtureFiles('v');
  if (fixed) {
    const t = JSON.parse(files[TRK]!);
    t.bodyRecord = { schedule: 'fixed', tapeFrom: '2026-03-24', tapeEvery: 14, testsFrom: '2026-03-21', testsEvery: 28 };
    files[TRK] = JSON.stringify(t);
  }
  const io = memoryIo(files, DATE);
  const model = buildBodyRecord(readVault(io, 'v', { asOf: DATE }), readTracking(io, 'v'), DATE);
  const el = bodyRecordCard({ model, ui: { edit: false, busy: false, error: null }, canWrite: true, onChange: () => {}, onOpen: () => {}, onSchedule: () => {} }) as unknown as FakeElement;
  return el;
}

describe('the Body record card', () => {
  it('says where each schedule comes from in plain words', () => {
    const plan = card(false).querySelectorAll('.pv-br-src').map(text);
    assert.ok(plan.length >= 3);
    assert.ok(plan.every((x) => x === 'from your plan'), plan.join(', '));
    const own = card(true).querySelectorAll('.pv-br-src').map(text);
    assert.ok(own.length >= 3);
    assert.ok(own.every((x) => x === 'your own schedule'), own.join(', '));
    assert.doesNotMatch(text(card(true)), /reset/i);
  });
});
