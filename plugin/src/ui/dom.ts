// Small DOM builders for the view: elements, SVG and icons, without markup
// strings. Standard DOM only, on Obsidian's `activeDocument` (the focused
// window's, for popouts), so the same code runs in Obsidian, in the static
// preview harness and in the tests, which both define `activeDocument`.

import { ICONS } from './icons.ts';

export type Child = Node | string | number | null | undefined | false | readonly Child[];
type AttrValue = string | number | boolean | null | undefined | ((ev: Event) => void);
export type Attrs = Record<string, AttrValue>;

const SVG_NS = 'http://www.w3.org/2000/svg';

function append(el: Element, children: readonly Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (typeof c === 'string' || typeof c === 'number') el.appendChild(activeDocument.createTextNode(String(c)));
    else el.appendChild(c as Node);
  }
}

function setAttrs(el: Element, attrs: Attrs | undefined): void {
  if (!attrs) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

/** An HTML element with attributes (`onclick`: a listener; `class`, `data-*`, `aria-*`: attributes) and children. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = activeDocument.createElement(tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

/** An SVG element. */
export function s(tag: string, attrs?: Attrs, ...children: Child[]): SVGElement {
  const el = activeDocument.createElementNS(SVG_NS, tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

/** One of the view's icons, 24-unit grid, stroked in the text colour. */
export function icon(name: string, cls?: string): SVGSVGElement {
  const svg = s('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: cls }) as SVGSVGElement;
  for (const [tag, a] of ICONS[name] ?? []) svg.appendChild(s(tag, a));
  return svg;
}

/** The icon's parts inside an existing SVG, translated and scaled (for icons drawn inside a chart). */
export function iconGroup(name: string, transform: string, cls?: string): SVGElement {
  const g = s('g', { transform, class: cls });
  for (const [tag, a] of ICONS[name] ?? []) g.appendChild(s(tag, { ...a, fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return g;
}

/**
 * Puts a `position: fixed` element at viewport coordinates. An ancestor with
 * containment, a transform or a filter becomes the containing block of fixed
 * descendants (Obsidian 1.15 gives every pane `contain: strict`), which
 * shifts them by that ancestor's offset; so place, measure where it landed,
 * and take the difference off. A hidden element (no layout) is placed as is.
 */
export function placeFixed(el: HTMLElement, left: number, top: number): void {
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  if (!el.getClientRects().length) return;
  const got = el.getBoundingClientRect();
  const dx = got.left - left;
  const dy = got.top - top;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
  el.style.left = `${left - dx}px`;
  el.style.top = `${top - dy}px`;
}
