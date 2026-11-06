import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays, dayNumber, daysBetween, isIsoDate, mondayOf, weekOf } from '../src/core/dates.ts';

describe('dates', () => {
  it('accepts only real YYYY-MM-DD dates', () => {
    assert.equal(isIsoDate('2026-03-02'), true);
    assert.equal(isIsoDate('2028-02-29'), true);
    assert.equal(isIsoDate('2026-02-29'), false);
    assert.equal(isIsoDate('2026-13-01'), false);
    assert.equal(isIsoDate('2026-3-02'), false);
    assert.equal(isIsoDate('2026-03-02T00:00:00Z'), false);
    assert.equal(isIsoDate(20260302), false);
    assert.equal(isIsoDate('0099-01-01'), false);
  });

  it('counts days without time zones', () => {
    assert.equal(daysBetween('2026-03-01', '2026-03-29'), 28);
    assert.equal(daysBetween('2026-03-29', '2026-03-01'), -28);
    assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
    // Across the March clock change in Europe and North America: still whole days.
    assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2);
    assert.equal(daysBetween('2026-10-24', '2026-10-26'), 2);
    assert.equal(dayNumber('1970-01-02'), 1);
  });

  it('adds days across months and years', () => {
    assert.equal(addDays('2026-02-28', 1), '2026-03-01');
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  });

  it('finds the Monday-to-Sunday week', () => {
    assert.equal(mondayOf('2026-11-01'), '2026-10-26'); // a Sunday
    assert.equal(mondayOf('2026-10-26'), '2026-10-26'); // a Monday
    assert.deepEqual(weekOf('2026-03-25'), { from: '2026-03-23', to: '2026-03-29' });
  });

  it('throws on malformed dates', () => {
    assert.throws(() => dayNumber('yesterday'), RangeError);
  });
});
