// placeFixed: a fixed element lands at the viewport coordinates asked for,
// also when an ancestor (an Obsidian 1.15 pane's `contain: strict`) is its
// containing block and offsets it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeFixed } from '../src/ui/dom.ts';

/** A fixed element whose containing block sits at (ox, oy) in the viewport; hidden has no layout. */
function fixedIn(ox: number, oy: number, hidden = false) {
  const style: Record<string, string> = {};
  const px = (v: string | undefined) => Number.parseFloat(v ?? '0');
  return {
    style,
    getClientRects: () => (hidden ? [] : [{}]),
    getBoundingClientRect: () => (hidden ? { left: 0, top: 0 } : { left: ox + px(style.left), top: oy + px(style.top) }),
  } as unknown as HTMLElement & { style: Record<string, string> };
}

test('placeFixed: no containing block, placed as asked', () => {
  const el = fixedIn(0, 0);
  placeFixed(el, 120, 40);
  assert.equal(el.style.left, '120px');
  assert.equal(el.style.top, '40px');
});

test('placeFixed: an offset containing block is taken off, so the element lands where asked', () => {
  const el = fixedIn(56, 52);
  placeFixed(el, 56, 52);
  assert.deepEqual(el.getBoundingClientRect(), { left: 56, top: 52 });
  // Placing again starts over, never adding the correction twice.
  placeFixed(el, 300, 90);
  assert.deepEqual(el.getBoundingClientRect(), { left: 300, top: 90 });
});

test('placeFixed: a hidden element (no layout) is placed as is', () => {
  const el = fixedIn(56, 52, true);
  placeFixed(el, 56, 52);
  assert.equal(el.style.left, '56px');
  assert.equal(el.style.top, '52px');
});
