import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COACHING_FEATURES, gate, isEnabled, PRO_FEATURES, SAFETY_FEATURES, type CoachingFeature, type FeatureSet } from '../src/core/features.ts';
import { explain } from '../src/core/reason.ts';
import { checkRedFlags } from '../src/core/safety.ts';

describe('features', () => {
  it('enables everything by default', () => {
    for (const id of [...SAFETY_FEATURES, ...COACHING_FEATURES]) assert.equal(isEnabled({}, id), true, id);
  });

  it('locks a coaching feature and says why', () => {
    const f: FeatureSet = { locked: ['triage'] };
    assert.equal(isEnabled(f, 'triage'), false);
    const r = gate(f, 'triage', explain(42, 'stall.triage.1', {}));
    assert.equal(r.value, null);
    assert.equal(r.reason.rule, 'features.locked');
    assert.deepEqual(r.reason.inputs, { feature: 'triage', rule: 'stall.triage.1' });
    const open = explain(7, 'e1rm.trend', {});
    assert.equal(gate(f, 'e1rm', open), open);
  });

  it('never gates a safety feature, even if a caller lists one', () => {
    const sneaky = { locked: [...SAFETY_FEATURES] as unknown as CoachingFeature[] };
    for (const id of SAFETY_FEATURES) assert.equal(isEnabled(sneaky, id), true, id);
    const stop = checkRedFlags(['chest-pain']);
    assert.equal(gate(sneaky, 'safety.red-flags', stop), stop);
  });

  it('keeps every safety id out of every gated list', () => {
    const safety = new Set<string>(SAFETY_FEATURES);
    for (const id of PRO_FEATURES) assert.ok(!safety.has(id), id);
    for (const id of COACHING_FEATURES) assert.ok(!safety.has(id), id);
    assert.ok(SAFETY_FEATURES.every((id) => id.startsWith('safety.')));
  });
});
