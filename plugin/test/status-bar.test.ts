// The status bar item: the stand-up count beside the standing-desk switch,
// the switch hidden while the stand-up counts its standing down (it would
// read "Sitting" while you stand), back when the countdown ends; with the
// switch on, the minutes to the next desk stand.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderStatus } from '../src/ui/status.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';

installFakeDom();

type Phase = 'sitting' | 'due' | 'standing';
const stand = (phase: Phase, deskLeft: number | null = null) => ({ id: 'stand', name: 'Stand-ups', phase, satMinutes: 20, sitLeft: 10, standLeft: 11, snoozeAvailable: false, inHours: true, deskLeft });
const draw = (phase: Phase | null, on: boolean) => {
  const el = new FakeElement('div');
  renderStatus(el as unknown as HTMLElement, { stand: phase ? [stand(phase, on && phase !== 'standing' ? 9 : null)] : [], standing: { on } as never, sitting: true, onStanding: () => {} } as never);
  return el;
};

describe('the status bar', () => {
  it('while the stand-up counts its standing down: only the countdown, no "Sitting"', () => {
    const el = draw('standing', false);
    assert.equal(text(el), 'Standing, 11 min left');
    assert.equal(el.querySelectorAll('.pv-sb-standing').length, 0);
  });

  it('the switch is back otherwise, and kept during the countdown when it is on', () => {
    assert.match(text(draw('sitting', false)), /^Stand in 10 minSitting$/);
    assert.match(text(draw('due', false)), /^Stand up nowSitting$/);
    assert.equal(text(draw('standing', true).querySelector('.pv-sb-standing')!), 'Standing now');
    assert.equal(text(draw(null, false)), 'Sitting');
  });

  it('with "Standing now" on, the stand-up shows the minutes to the next desk stand, not a sitting countdown', () => {
    assert.equal(text(draw('sitting', true)), 'Stand logged in 9 minStanding now');
    assert.equal(text(draw('due', true)), 'Stand logged in 9 minStanding now');
    assert.match(text(draw('standing', true)), /^Standing, 11 min left/);
  });
});
