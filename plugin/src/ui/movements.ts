// The Movements tab: every movement Pahlavan knows, searched as you type and
// filtered by group, muscle, level and your own equipment. A name opens its
// guide (the body map, the setup, the movement, the mistake to avoid, a
// video search); its easier and harder steps, and each ladder's steps, jump
// to that movement. Typing redraws only the results, so the search box and
// its caret stay as they are; a filter or a jump redraws the tab through the
// view, which keeps the scroll and the focus (keepPlace). The report is the
// engine's buildMovements. Standard DOM only.

import type { LadderRow, MovementGroup, MovementLink, MovementRow, MovementsQuery, MovementsScreen } from '../../../src/report/movements-screen.ts';
import { h, icon, type Child } from './dom.ts';
import { guideName, guidePanel } from './guide.ts';

/** What the tab holds between draws (the view keeps it; nothing is saved). */
export interface MovementsUi {
  /** The search box and the filters. */
  query: MovementsQuery;
  /** The movements whose guide is open, by id. */
  open: Set<string>;
  /** A movement to bring into view after the next draw (a step followed), or null. */
  reveal: string | null;
}

export const freshMovementsUi = (): MovementsUi => ({ query: {}, open: new Set(), reveal: null });

export interface MovementsContext {
  ui: MovementsUi;
  /** The tab for a query, from the files as last read (the results as you type). */
  build(q: MovementsQuery): MovementsScreen;
  /** Draw the tab again: a filter changed or a step was followed. */
  onChange(): void;
  /** How long typing waits before the results follow, in ms (0: at once). */
  delay?: number;
}

const kb = (k: string) => ({ 'data-k': k });

/** An easier, harder or ladder step followed: the filters cleared, the search set to it, its guide open, brought into view. */
export function followStep(ui: MovementsUi, to: { id: string; search: string }): void {
  ui.query = { text: to.search };
  ui.open.add(to.id);
  ui.reveal = to.id;
}

/** The control that has the focus, by its data-k (a redraw puts it back). */
function focusedKey(el: HTMLElement): string | null {
  const active = el.ownerDocument?.activeElement as HTMLElement | null | undefined;
  return active && el.contains(active) ? active.getAttribute?.('data-k') ?? null : null;
}

/** Builds the Movements tab into `root` (its children are replaced). */
export function renderMovements(root: HTMLElement, m: MovementsScreen, ctx: MovementsContext): void {
  const ui = ctx.ui;
  let current = m;
  let timer: number | null = null;
  const results = h('div', { class: 'pv-mv-results', 'data-mv': 'results' });
  const clearAll = () => {
    ui.query = {};
    ctx.onChange();
  };
  const toggle = (id: string) => {
    if (ui.open.has(id)) ui.open.delete(id);
    else ui.open.add(id);
    update(false);
  };
  /** The results again (for the query as it is now when it changed), the focused control found again. */
  const update = (rebuild: boolean) => {
    if (rebuild) current = ctx.build(ui.query);
    const k = focusedKey(results);
    const next = h('div', {}, resultsParts(current, ctx, toggle, clearAll));
    results.replaceChildren(...Array.from(next.childNodes));
    if (k) results.querySelector<HTMLElement>(`[data-k="${CSS.escape(k)}"]`)?.focus({ preventScroll: true });
  };

  const input = h('input', { type: 'text', class: 'pv-mv-input', value: ui.query.text ?? '', placeholder: 'Search: squat, row, glutes, band…', 'aria-label': 'Search the movements', autocomplete: 'off', spellcheck: 'false', ...kb('mv-search') });
  const clear = h('button', { class: 'pv-icon-btn pv-mv-clear', 'aria-label': 'Clear the words', hidden: !(ui.query.text ?? '').trim(), ...kb('mv-search-x') }, icon('x'));
  const typed = (now: boolean) => {
    ui.query = { ...ui.query, text: input.value };
    clear.toggleAttribute('hidden', !input.value.trim());
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    const wait = ctx.delay ?? 150;
    if (now || wait <= 0) update(true);
    else timer = window.setTimeout(() => {
      timer = null;
      update(true);
    }, wait);
  };
  input.addEventListener('input', () => typed(false));
  // Enter shows the results at once, without the typing pause.
  input.addEventListener('keydown', (ev: Event) => {
    if ((ev as KeyboardEvent).key === 'Enter') typed(true);
  });
  clear.addEventListener('click', () => {
    input.value = '';
    typed(true);
    input.focus();
  });

  const set = (part: Partial<MovementsQuery>) => {
    ui.query = { ...ui.query, ...part };
    ctx.onChange();
  };
  const select = (k: string, label: string, all: string, options: readonly { id: string; label: string }[], value: string | null, onSet: (v: string | null) => void) => {
    const el = h('select', { class: 'pv-sel pv-mv-sel', 'aria-label': label, ...kb(k) },
      h('option', { value: '', ...(value ? {} : { selected: true }) }, all),
      options.map((o) => h('option', { value: o.id, ...(o.id === value ? { selected: true } : {}) }, o.label)));
    el.addEventListener('change', () => onSet(el.value || null));
    return el;
  };
  const q = m.query;
  const levels = [{ id: null, label: 'Any level' }, ...m.options.levels] as const;
  const listed = m.equipment.listed;
  const filters = h('div', { class: 'pv-mv-filters' },
    select('mv-pattern', 'Movement group', 'Every group', m.options.patterns.map((p) => ({ id: p.id, label: `${p.label} (${p.count})` })), q.pattern, (v) => set({ pattern: v })),
    select('mv-muscle', 'Muscle', 'Every muscle', m.options.muscles, q.muscle, (v) => set({ muscle: v })),
    h('div', { class: 'pv-seg pv-mv-levels', role: 'group', 'aria-label': 'Level' },
      levels.map((o) => h('button', { class: o.id === q.level ? 'is-on' : '', 'aria-pressed': o.id === q.level ? 'true' : 'false', onclick: () => set({ level: o.id }), ...kb(`mv-level-${o.id ?? 'any'}`) }, o.label))),
    h('button', {
      class: `pv-mv-mine${q.mine ? ' is-on' : ''}`,
      'aria-pressed': q.mine ? 'true' : 'false',
      disabled: !listed,
      'data-tip': listed ? 'My equipment|Only what your profile’s equipment covers|A tool that stands in counts' : 'My equipment|Your profile lists no equipment yet|The coach records it at the intake',
      onclick: () => set({ mine: !q.mine }),
      ...kb('mv-mine'),
    }, icon(q.mine ? 'check' : 'dumbbell'), 'My equipment'),
  );

  root.replaceChildren(
    h('header', { class: 'pv-mv-head' },
      h('div', { class: 'pv-kicker' }, 'The catalogue'),
      h('h1', { class: 'pv-serif-title' }, 'Movements'),
      h('p', { class: 'pv-mv-intro' }, 'Every movement Pahlavan knows: what it works, how to do it, and its easier and harder steps.')),
    h('section', { class: 'pv-card pv-mv-search' }, h('div', { class: 'pv-field-in pv-mv-box' }, icon('search'), input, clear), filters),
    results,
  );
  update(false);
}

/** The count, the notes, the groups (or the calm empty state) and the ladders. */
function resultsParts(m: MovementsScreen, ctx: MovementsContext, toggle: (id: string) => void, clearAll: () => void): Child[] {
  const head = m.count
    ? h('div', { class: 'pv-mv-count' }, h('span', {}, m.countText), m.filtered ? h('button', { class: 'pv-link-btn', onclick: clearAll, ...kb('mv-clear-all') }, 'Clear the search') : null)
    : null;
  const notes = m.notes.length ? h('div', { class: 'pv-notes pv-mv-notes' }, m.notes.map((n) => h('div', { class: 'pv-note', 'data-note': n.code }, icon('info'), h('span', {}, n.text)))) : null;
  const main = m.count ? m.groups.map((g) => groupCard(g, ctx, toggle)) : emptyCard(clearAll);
  const side = m.ladders.length ? laddersCard(m, ctx) : null;
  return [head, notes, h('div', { class: `pv-mv-layout${side ? '' : ' is-single'}` }, h('div', { class: 'pv-mv-main' }, main), side ? h('aside', { class: 'pv-mv-side' }, side) : null)];
}

function emptyCard(clearAll: () => void): HTMLElement {
  return h('section', { class: 'pv-card pv-mv-empty', 'data-mv': 'empty' },
    h('div', { class: 'pv-mv-empty-t' }, icon('search'),
      h('div', {}, h('b', {}, 'No movement matches'), h('p', {}, 'Try fewer words, another name for it, or a muscle such as glutes.'))),
    h('button', { class: 'pv-btn-primary', onclick: clearAll, ...kb('mv-clear') }, icon('x'), 'Clear the search'));
}

function groupCard(g: MovementGroup, ctx: MovementsContext, toggle: (id: string) => void): HTMLElement {
  return h('section', { class: 'pv-card pv-mv-group', 'data-mv-group': g.pattern },
    h('div', { class: 'pv-card-head' }, h('div', { class: 'pv-kicker' }, g.title), h('span', { class: 'pv-mv-n' }, String(g.rows.length))),
    h('ul', { class: 'pv-mv-list' }, g.rows.map((r) => rowEl(r, ctx, toggle))));
}

function rowEl(r: MovementRow, ctx: MovementsContext, toggle: (id: string) => void): HTMLElement {
  const open = ctx.ui.open.has(r.id);
  const name = guideName(r.name, true, open, () => toggle(r.id), 'pv-mv-name');
  name.setAttribute('data-k', `mv-g-${r.id}`);
  const follow = (l: MovementLink) => {
    followStep(ctx.ui, l);
    ctx.onChange();
  };
  // The short name (the full one is the tooltip); the comma between them is drawn inside each link, so a wrapped line never starts with one.
  const steps = (label: string, links: readonly MovementLink[]) => (links.length
    ? h('span', { class: 'pv-mv-step-line' }, h('span', { class: 'pv-mv-step-k' }, label),
      links.map((l) => h('button', { class: 'pv-link-btn pv-mv-step', 'data-tip': `${l.name}|Show this one`, onclick: () => follow(l), ...kb(`mv-step-${r.id}-${l.id}`) }, l.search)))
    : null);
  const meta = [`${r.equipmentText}${r.alsoWithText ? ` (or ${r.alsoWithText})` : ''}`, r.loadText === 'a hold for time' ? 'held for time' : null, r.oneSide ? 'one side at a time' : null].filter(Boolean).join(' · ');
  return h('li', { class: `pv-mv-row${open ? ' is-open' : ''}${r.inPlan ? ' is-plan' : ''}`, 'data-mv-id': r.id },
    h('div', { class: 'pv-mv-top' }, name,
      h('span', { class: 'pv-mv-tags' },
        r.inPlan ? h('span', { class: 'pv-tag pv-mv-plan', 'data-tip': 'In your plan|One of your sessions trains it' }, 'In your plan') : null,
        h('span', { class: `pv-tag pv-mv-lvl is-${r.level}` }, h('i', {}), h('i', {}), h('i', {}), r.levelText))),
    r.works ? h('div', { class: 'pv-mv-works' }, r.works) : null,
    h('div', { class: 'pv-mv-meta' }, h('span', {}, meta), r.needs.length ? h('span', { class: 'pv-mv-needs', 'data-tip': 'Not in your equipment|Your profile’s equipment doesn’t cover it' }, `Needs ${r.needs.join(' and ')}`) : null),
    r.easier.length || r.harder.length ? h('div', { class: 'pv-mv-links' }, steps('Easier', r.easier), steps('Harder', r.harder)) : null,
    open ? [r.aka.length ? h('div', { class: 'pv-mv-aka' }, `Also called ${r.aka.join(', ')}`) : null, guidePanel([r.guide])] : null,
  );
}

function laddersCard(m: MovementsScreen, ctx: MovementsContext): HTMLElement {
  const step = (l: LadderRow, st: LadderRow['steps'][number]) => {
    const tip = [st.name, st.detail, st.now ? 'Your level now' : st.inPlan ? 'In your plan' : null, st.id ? 'Click: show this one' : 'Not in the catalogue'].filter(Boolean).join('|');
    const cls = `pv-mv-chip${st.now ? ' is-now' : ''}${st.inPlan ? ' is-plan' : ''}`;
    const inner = [h('span', { class: 'pv-mv-chip-n' }, String(st.level)), h('span', {}, st.short)];
    if (!st.id || !st.search) return h('span', { class: `${cls} is-off`, 'data-tip': tip }, inner);
    const to = { id: st.id, search: st.search };
    return h('button', { class: cls, 'data-tip': tip, onclick: () => { followStep(ctx.ui, to); ctx.onChange(); }, ...kb(`mv-ld-${l.key}-${st.level}`) }, inner);
  };
  return h('section', { class: 'pv-card pv-mv-ladders', 'data-mv': 'ladders' },
    h('div', { class: 'pv-card-head' }, h('div', {}, h('div', { class: 'pv-kicker' }, 'Ladders'), h('div', { class: 'pv-card-sub' }, m.filtered ? 'The ladders with these movements, easiest first.' : 'Each goes from easiest to hardest. Click a step to see it.'))),
    h('div', { class: 'pv-mv-ladder-list' }, m.ladders.map((l) => h('div', { class: `pv-mv-ladder${l.source === 'plan' ? ' is-plan' : ''}`, 'data-ladder': l.key },
      h('div', { class: 'pv-mv-ladder-head' }, h('b', {}, l.title), h('span', { class: `pv-tag pv-mv-src is-${l.source}` }, l.sourceText)),
      h('ol', { class: 'pv-mv-chain' }, l.steps.map((st) => h('li', {}, step(l, st))))))),
    h('p', { class: 'pv-mv-legend' }, 'Your plan: the ladders your sessions train, with the level you’re on. Self-check: the four the intake starts. Catalogue: more ways up through the movements.'),
  );
}
