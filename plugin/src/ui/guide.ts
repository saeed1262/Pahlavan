// The movement guide panel, shared by Today, the Log panel, the Plan and
// Skills: plan-data's guide entry for an exercise or a ladder level (what it
// works, on a small body map; setup, the movement, the mistake to avoid; a
// video), as the dashboard's renderGuide shows it. Entries come from the
// engine's guideFor.

import type { GuideEntry } from '../../../src/report/dashboard.ts';
import { BODY, type Side } from './body-map.ts';
import { h, icon, s } from './dom.ts';

function miniMap(side: Side, main: Set<string>, helps: Set<string>): SVGElement {
  const parts: SVGElement[] = [s('path', { class: 'pv-bm-base', d: BODY.outline[side] })];
  for (const [slug, ds] of Object.entries(BODY[side])) {
    const cls = main.has(slug) ? 'pv-gd-m is-main' : helps.has(slug) ? 'pv-gd-m is-helps' : 'pv-bm-base';
    for (const d of ds) parts.push(s('path', { class: cls, d }));
  }
  parts.push(s('path', { class: 'pv-bm-outline', d: BODY.outline[side] }));
  return s('svg', { viewBox: BODY.viewBox[side], role: 'img', 'aria-label': `${side} of the body` }, parts);
}

/** The panel for one name's entries (a paired line or a part list gives several). Clicks inside stay inside. */
export function guidePanel(entries: readonly GuideEntry[]): HTMLElement {
  const box = h('div', { class: 'pv-guide', onclick: (ev: Event) => ev.stopPropagation() },
    entries.map((e) => {
      const main = new Set(e.main);
      const helps = new Set(e.helps);
      const hasMap = main.size + helps.size > 0;
      return h('div', { class: `pv-gd-item${hasMap ? ' has-map' : ''}` },
        hasMap ? h('div', { class: 'pv-gd-map', 'data-tip': `${e.title}|Darker: mainly works · lighter: helps` }, miniMap('front', main, helps), miniMap('back', main, helps)) : null,
        h('div', { class: 'pv-gd-text' },
          h('div', { class: 'pv-gd-title' }, e.title),
          e.unset ? h('div', { class: 'pv-gd-note' }, 'Level not set yet, so this is level 1. Set yours on Progress, Skills.') : null,
          ([['Works', e.works], ['Setup', e.setup], ['Do', e.do], ['Avoid', e.avoid]] as const).filter(([, v]) => v).map(([k, v]) => h('div', { class: 'pv-gd-line' }, h('span', { class: 'pv-gd-key' }, k), h('span', {}, v))),
          h('a', { class: 'pv-gd-video external-link', href: e.video.url, target: '_blank', rel: 'noopener' }, icon('play'), h('span', {}, e.video.label)),
        ),
      );
    }),
  );
  return box;
}

/** A name that opens its guide: the text with an info mark, a button when there is a guide. */
export function guideName(text: string, has: boolean, open: boolean, toggle: () => void, cls = ''): HTMLElement {
  if (!has) return h('span', { class: cls }, text);
  return h('button', { class: `pv-gd-name ${cls}${open ? ' is-open' : ''}`, 'aria-expanded': open ? 'true' : 'false', 'data-tip': 'How to do it|Setup, the movement, what to avoid, a video', onclick: (ev: Event) => { ev.stopPropagation(); toggle(); } }, text, icon('info'));
}
