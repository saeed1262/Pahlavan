// The view's tooltip: any element with data-tip="Title|line|line" shows it on
// hover. One element, positioned near the pointer and kept on screen. A line
// with a tab is a row (a label on the left, its value on the right), a line
// starting with "§" a small heading ("Threshold"), one starting with "¶" a
// note under the rows: the Food tab's Why (whyTip) uses all three.

import { h, placeFixed } from './dom.ts';

/** A Why as data-tip text: the title, the input rows, the threshold's rows under their heading, the note. */
export function whyTip(w: { title: string; rows: readonly (readonly [string, string])[]; threshold: readonly (readonly [string, string])[]; note: string } | null | undefined): string | undefined {
  if (!w) return undefined;
  const safe = (s: string) => s.replace(/[|\t]/g, ' ');
  return [
    safe(w.title),
    ...w.rows.map(([k, v]) => `${safe(k)}\t${safe(v)}`),
    ...(w.threshold.length ? ['§Threshold', ...w.threshold.map(([k, v]) => `${safe(k)}\t${safe(v)}`)] : []),
    ...(w.note ? [`¶${safe(w.note)}`] : []),
  ].join('|');
}

function line(text: string): HTMLElement {
  if (text.startsWith('§')) return h('div', { class: 'pv-tip-h' }, text.slice(1));
  if (text.startsWith('¶')) return h('div', { class: 'pv-tip-note' }, text.slice(1));
  const tab = text.indexOf('\t');
  if (tab >= 0) return h('div', { class: 'pv-tip-row' }, h('span', {}, text.slice(0, tab)), h('span', {}, text.slice(tab + 1)));
  return h('div', {}, text);
}

export function attachTooltip(root: HTMLElement): () => void {
  const tipEl = h('div', { class: 'pv-tip', role: 'tooltip' });
  root.appendChild(tipEl);
  const hide = () => tipEl.classList.remove('is-on');
  const move = (ev: MouseEvent) => {
    const target = (ev.target as Element | null)?.closest?.('[data-tip]');
    if (!target || !root.contains(target)) return hide();
    const [title, ...rest] = (target.getAttribute('data-tip') ?? '').split('|');
    tipEl.replaceChildren(h('div', { class: 'pv-tip-title' }, title ?? ''), ...rest.map(line));
    tipEl.classList.add('is-on');
    const pad = 14;
    const r = tipEl.getBoundingClientRect();
    // Kept inside the pane as well as the window: the pane clips what crosses its edge.
    const box = root.getBoundingClientRect();
    const minX = Math.max(0, box.left) + 8;
    const minY = Math.max(0, box.top) + 8;
    const maxX = Math.min(window.innerWidth, box.right || window.innerWidth) - 8;
    const maxY = Math.min(window.innerHeight, box.bottom || window.innerHeight) - 8;
    let x = ev.clientX + pad;
    let y = ev.clientY + pad;
    if (x + r.width > maxX) x = ev.clientX - r.width - pad;
    if (y + r.height > maxY) y = ev.clientY - r.height - pad;
    placeFixed(tipEl, Math.max(minX, x), Math.max(minY, y));
  };
  root.addEventListener('mousemove', move);
  root.addEventListener('mouseleave', hide);
  return () => {
    root.removeEventListener('mousemove', move);
    root.removeEventListener('mouseleave', hide);
    tipEl.remove();
  };
}
