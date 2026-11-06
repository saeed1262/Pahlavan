// At a glance and the foldable sections, as signed off in
// mockups/glance-*.html: the panel under a tab's banner (a slim surface,
// quieter than the cards: the summary beside "What's on this tab", one row
// per section that scrolls to it and opens it, Open all and Fold all, and
// its own fold to one line), and the fold on a section's card (a chevron in
// its corner; folded, the card is one line: its name and a status in plain
// words). The lines come from src/report/glance.ts; the view keeps what was
// opened and folded (Coach/help.json) and passes the handlers. Standard DOM
// only.

import type { GlanceLine, Run } from '../../../src/report/glance.ts';
import { h, icon, type Child } from './dom.ts';

export const runs = (xs: readonly Run[]): Child[] => xs.map((r) => (typeof r === 'string' ? r : h('b', {}, r.b)));

export interface PanelRow {
  id: string;
  title: string;
  line: string;
  folded: boolean;
}

export interface PanelContext {
  sums: readonly GlanceLine[];
  rows: readonly PanelRow[];
  open: boolean;
  /** "What's on this tab", or "What's on Overview" on Progress. */
  heading: string;
  /** Progress's other views, a click away. */
  views?: { label: string; items: readonly { id: string; label: string; line: string }[]; onView(id: string): void } | null;
  onPanel: (open: boolean) => void;
  onAll: (fold: boolean) => void;
  onGo: (id: string) => void;
}

/** The panel; folded, it is the kicker and the first summary line, and a click anywhere opens it. */
export function glancePanel(ctx: PanelContext): HTMLElement {
  const open = ctx.open;
  const first = ctx.sums[0];
  const head = h('div', { class: 'pv-gl-head' },
    h('span', { class: 'pv-kicker' }, 'At a glance'),
    !open && first ? h('span', { class: 'pv-gl-first' }, runs(first.text)) : null,
    h('div', { class: 'pv-gl-tools' },
      open && ctx.rows.length ? [
        h('button', { class: 'pv-gl-act', 'data-k': 'gl-open-all', onclick: () => ctx.onAll(false) }, 'Open all'),
        h('button', { class: 'pv-gl-act', 'data-k': 'gl-fold-all', onclick: () => ctx.onAll(true) }, 'Fold all'),
        h('span', { class: 'pv-gl-sep', 'aria-hidden': 'true' }),
      ] : null,
      h('button', {
        class: 'pv-gl-chev',
        'aria-expanded': open ? 'true' : 'false',
        'aria-label': open ? 'Fold At a glance to one line' : 'Open At a glance',
        'data-tip': open ? 'Fold to one line|Kept for this tab, on both Macs' : 'Open|The summary and what’s on this tab',
        'data-k': 'gl-panel',
        onclick: (ev: Event) => {
          ev.stopPropagation();
          ctx.onPanel(!open);
        },
      }, icon('chevron'))),
  );
  const body = open ? h('div', { class: 'pv-gl-body' },
    h('ul', { class: 'pv-gl-sum' }, ctx.sums.map((x) => h('li', { class: x.flag ? 'is-flag' : '' }, icon(x.icon), h('span', {}, runs(x.text))))),
    ctx.rows.length || ctx.views ? h('div', { class: 'pv-gl-map' },
      ctx.rows.length ? [
        h('div', { class: 'pv-gl-map-h' }, ctx.heading),
        h('ul', { class: 'pv-gl-rows' }, ctx.rows.map((r) => h('li', {}, h('button', { class: 'pv-gl-row', 'data-k': `gl-go-${r.id}`, 'data-go': r.id, 'data-tip': `Go to ${r.title}${r.folded ? '|It opens when you get there' : ''}`, onclick: () => ctx.onGo(r.id) }, h('b', {}, r.title), h('span', {}, r.line), h('em', {}, r.folded ? 'folded' : ''))))),
      ] : null,
      ctx.views ? h('div', { class: 'pv-gl-views' }, h('span', {}, ctx.views.label), ctx.views.items.map((v) => h('button', { class: 'pv-gl-view', 'data-k': `gl-view-${v.id}`, 'data-tip': `${v.label}|${v.line}`, onclick: () => ctx.views!.onView(v.id) }, v.label))) : null,
    ) : null,
  ) : null;
  const panel = h('section', { class: `pv-gl-panel ${open ? 'is-open' : 'is-folded'}`, 'aria-label': 'At a glance', 'data-glance': '' }, head, body);
  if (!open) panel.addEventListener('click', () => ctx.onPanel(true));
  return panel;
}

export interface FoldOptions {
  id: string;
  /** The section's name, as its kicker reads. */
  title: string;
  status: readonly Run[];
  folded: boolean;
  /** Folds (true) or opens (false) the section. */
  onToggle: (fold: boolean) => void;
}

/**
 * Makes a section's card foldable: the corner chevron folds it; folded, the
 * card shows only its bar (the name and the status), which opens it. Drawn
 * again on the same card, the old bar and chevron go first.
 */
export function foldCard(card: HTMLElement, o: FoldOptions): void {
  for (const el of [...card.children]) if (el.classList.contains('pv-fold-bar') || el.classList.contains('pv-fold-btn')) el.remove();
  card.classList.add('pv-fold-card');
  card.classList.toggle('is-folded', o.folded);
  card.setAttribute('data-folded', o.folded ? 'true' : 'false');
  const bar = h('button', { class: 'pv-fold-bar', 'aria-expanded': 'false', 'aria-label': `Open ${o.title}`, 'data-k': `fold-open-${o.id}`, onclick: () => o.onToggle(false) },
    h('span', { class: 'pv-fold-h' }, h('span', { class: 'pv-kicker' }, o.title), h('span', { class: 'pv-fold-st' }, runs(o.status)), h('span', { class: 'pv-fold-chev' }, icon('chevron'))));
  const btn = h('button', { class: 'pv-fold-btn', 'aria-expanded': 'true', 'aria-label': `Fold ${o.title} to one line`, 'data-tip': 'Fold to one line|Kept on both Macs', 'data-k': `fold-${o.id}`, onclick: () => o.onToggle(true) }, icon('chevron'));
  card.prepend(bar, btn);
}

/** A card reached from the panel lights up once. */
export function flash(card: HTMLElement): void {
  card.classList.remove('is-flash');
  void card.offsetWidth;
  card.classList.add('is-flash');
  window.setTimeout(() => card.classList.remove('is-flash'), 1200);
}
