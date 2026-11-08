import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ledgerMovements, temporaryLabel } from '../src/ui/plan.ts';
import { bannerKicker, phaseLabel, phaseTitle } from '../src/ui/banner.ts';

describe('plan timeline: temporary-change labels', () => {
  it('a swap reads "X in for Y"', () => {
    assert.equal(temporaryLabel({ item: 'Goblet Squat', wayBack: 'Barbell Back Squat' }), 'Goblet Squat in for Barbell Back Squat');
  });
  it('an "until" note that is not a swap names the item alone, never "in for null"', () => {
    assert.equal(temporaryLabel({ item: 'Barbell Back Squat', wayBack: null }), 'Barbell Back Squat');
  });
});

describe('plan timeline: the Ledger’s movements', () => {
  it('names each ruled-out movement and marks one the engine does not recognise', () => {
    assert.equal(ledgerMovements([{ name: 'Standing barbell press', known: true }, { name: 'Ring dip unknown', known: false }]), 'Standing barbell press, Ring dip unknown (not recognised)');
    assert.equal(ledgerMovements([]), '');
  });
});

describe('phase names', () => {
  it('the banners\' kicker names the phase by its own name, else by number', () => {
    assert.equal(bannerKicker(1, { index: 1, name: 'Foundation' }), 'Pahlavan · Week 1 · Foundation');
    assert.equal(bannerKicker(9, { index: 2, name: 'Phase 2' }), 'Pahlavan · Week 9 · Phase 2');
    assert.equal(bannerKicker(null, null, 3), 'Pahlavan · Phase 3');
    assert.equal(phaseLabel(2, ''), 'Phase 2');
  });
  it('the Plan screen titles a phase with its number and name, or the number alone', () => {
    assert.equal(phaseTitle(1, 'Foundation'), 'Phase 1 · Foundation');
    assert.equal(phaseTitle(2, 'Phase 2'), 'Phase 2');
    assert.equal(phaseTitle(3, null), 'Phase 3');
  });
});


describe('the top bar’s week', () => {
  it('reads the plan’s length, and says so past its end', async () => {
    const { weekOfText } = await import('../src/ui/format.ts');
    assert.equal(weekOfText(6, 24), 'Week 6 of 24');
    assert.equal(weekOfText(6, 16), 'Week 6 of 16');
    assert.equal(weekOfText(17, 16), 'Week 17, after the plan’s 16');
    assert.equal(weekOfText(3, null), 'Week 3');
  });
});
