// A redraw keeps the reader's place, drawn in Node with the small fake DOM:
// Today is rebuilt with a guide opened far down the session, and the page,
// which (as a browser does) drops to the top when its children are replaced,
// ends where it was; the focused control is found again by its data-k.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { buildToday } from '../../src/report/index.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';
import { keepPlace } from '../src/ui/scroll.ts';
import { renderToday, type TodayContext } from '../src/ui/today.ts';
import { FakeElement, installFakeDom } from './fake-dom.ts';

installFakeDom();
(globalThis as { CSS?: { escape(s: string): string } }).CSS ??= { escape: (s: string) => s };
const DATE = '2026-04-10';
const read = readVault(memoryIo(fixtureFiles('v'), DATE), 'v', { asOf: DATE });

/** A scrolling pane holding the page; replacing the page's children scrolls it to the top. */
function pane() {
  const scroller = new FakeElement('div') as FakeElement & { scrollTop: number; ownerDocument?: { activeElement: FakeElement | null } };
  const page = new FakeElement('div');
  scroller.append(page);
  scroller.scrollTop = 0;
  const replace = page.replaceChildren.bind(page);
  page.replaceChildren = (...cs) => { scroller.scrollTop = 0; replace(...cs); };
  return { scroller, page };
}

function drawToday(page: FakeElement, openGuides: Set<string>, onToggleGuide: (key: string) => void) {
  const m = buildToday(read, DATE, 'full', 'v');
  const ctx: TodayContext = { mode: 'full', session: m.session, phase: { id: 'workday', isfahan: false }, open: new Set(), pick: null, onMode: () => {}, onPick: () => {}, onToggleWhy: () => {}, onLog: () => {}, onEditSession: () => {}, guide: () => [{ title: 'Face Pull', works: 'Upper back', setup: 'Rope at eye height', do: 'Pull to the eyes', avoid: 'Shrugging', main: [], helps: [], video: { url: 'https://example.com', label: 'Video' } }] as never, openGuides, onToggleGuide };
  renderToday(page as unknown as HTMLElement, m, ctx);
}

describe('a redraw keeps the reader’s place', () => {
  it('Today: a guide opened far down keeps the scroll where it was, and its panel opens', () => {
    const { scroller, page } = pane();
    const open = new Set<string>();
    const redraw = () => keepPlace(scroller as unknown as HTMLElement, page as unknown as HTMLElement, () => drawToday(page, open, toggle));
    const toggle = (key: string) => { if (open.has(key)) open.delete(key); else open.add(key); redraw(); };
    redraw();
    scroller.scrollTop = 640;
    const btn = page.querySelector('.pv-gd-name');
    assert.ok(btn, 'a How to do it button on the session');
    for (const fn of btn!.listeners.get('click') ?? []) fn({ stopPropagation: () => {} });
    assert.equal(open.size, 1, 'the guide is open');
    assert.ok(page.querySelector('.pv-guide'), 'its panel is drawn');
    assert.equal(scroller.scrollTop, 640, 'the page stays where the guide was opened');
  });

  it('without it the same redraw lands at the top (what the screen did before)', () => {
    const { scroller, page } = pane();
    drawToday(page, new Set(), () => {});
    scroller.scrollTop = 640;
    drawToday(page, new Set(['today:x']), () => {});
    assert.equal(scroller.scrollTop, 0);
  });

  it('the focused control is found again by its data-k', () => {
    const { scroller, page } = pane();
    const focused: string[] = [];
    const draw = () => {
      const b = new FakeElement('button');
      b.setAttribute('data-k', 'standing');
      b.focus = () => void focused.push('standing');
      page.replaceChildren(b);
    };
    draw();
    scroller.ownerDocument = { activeElement: page.querySelector('[data-k="standing"]') };
    keepPlace(scroller as unknown as HTMLElement, page as unknown as HTMLElement, draw);
    assert.deepEqual(focused, ['standing']);
  });
});
