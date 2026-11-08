// The Home tab, a port of the signed-off mockup (mockups/home.html): the
// banner with today's session and the week's ring, then Needs you, Food and
// habits, Progress in three small tiles, and Your tabs (a short guide to the
// other tabs, each with its status). Every card, row and tile leads
// to the tab with the detail; the view wires where each goes. Built from
// src/report/home.ts. Standard DOM only; no Obsidian API.

import type { Home, HomeGo, HomeNeed, HomeTab, HomeTile } from '../../../src/report/home.ts';
import { PAHLAVAN_LOGO_SRC } from '../brand-logo.ts';
import type { TodayModel } from '../data-source.ts';
import type { PhaseId } from '../phase.ts';
import { ring, type BannerOptions } from './banner.ts';
import { h, icon, s, type Child } from './dom.ts';
import { fmt } from './format.ts';
import { calmNotes } from './today.ts';

export interface HomeContext {
  phase: { id: PhaseId; isfahan: boolean };
  /** The week's ring, as Today's banner draws it; null without a plan. */
  ring: BannerOptions['ring'] | null;
  /** Opens the Log panel on today's session, as Today's Log session does. */
  onLog: () => void;
  onGo: (go: HomeGo) => void;
  /** The welcome card, under the banner until its five steps are done or it is hidden. */
  welcome?: HTMLElement | null;
  /** True on the first draw after Home is opened: the cards rise in and the rings fill (a redraw stays still). */
  intro?: boolean;
}

const link = (label: string, go: HomeGo, ctx: HomeContext): HTMLElement =>
  h('button', { class: 'pv-home-link', 'data-go': go, onclick: () => ctx.onGo(go) }, label, icon('next'));

function heroEl(m: Home, ctx: HomeContext): HTMLElement | null {
  const x = m.hero;
  if (!x) return null;
  const r = ctx.ring;
  return h('section', { class: `pv-hero pv-home-hero is-${ctx.phase.id}${ctx.phase.isfahan ? ' has-tile' : ''}`, 'data-home': 'hero' },
    h('div', { class: 'pv-hero-text' },
      // The brand row: the logo, the name in the serif, then the day.
      h('div', { class: 'pv-home-brand' },
        h('img', { class: 'pv-home-logo', src: PAHLAVAN_LOGO_SRC, alt: '', 'aria-hidden': 'true' }),
        h('span', { class: 'pv-home-brand-name' }, 'Pahlavan'),
        h('span', { class: 'pv-kicker' }, x.kicker)),
      h('h1', { class: 'pv-hero-title' }, x.title),
      h('div', { class: 'pv-hero-sub' }, x.sub),
      x.notes.length ? h('div', { class: 'pv-home-notes' }, x.notes.map((n) => h('div', { class: 'pv-home-note' }, icon(n.icon), h('span', {}, h('b', {}, n.lead), ` ${n.text}`)))) : null,
      h('div', { class: 'pv-hero-acts' },
        h('button', { class: 'pv-btn-go', onclick: () => ctx.onLog() }, icon('plus'), 'Log session'),
        h('button', { class: 'pv-btn-ghost', 'data-go': 'today', onclick: () => ctx.onGo('today') }, x.state === 'rest' ? 'Open Today' : 'See the workout', icon('next')),
      ),
    ),
    r ? h('div', { class: 'pv-hero-ring' },
      ring(r.segs, r.n, 'THIS WEEK', r.aria),
      h('div', { class: 'pv-home-ringline' }, x.ringLine),
    ) : null,
  );
}

function needsEl(m: Home, ctx: HomeContext, wide: boolean): HTMLElement {
  const n = m.needs;
  return h('section', { class: `pv-card pv-home-needs${wide ? ' pv-home-wide' : ''}${n.items.length ? '' : ' is-calm'}`, 'data-home': 'needs' },
    h('div', { class: 'pv-home-head' }, h('span', { class: 'pv-kicker' }, 'Needs you'), n.items.length ? h('span', { class: 'pv-home-count' }, String(n.items.length + n.more)) : null),
    n.items.length
      ? h('ul', { class: 'pv-home-todo' }, n.items.map((it) => needRow(it, ctx)))
      : h('div', { class: 'pv-home-quiet' }, h('span', { class: 'pv-home-calm-mark' }, icon('check')), h('span', { class: 'tx' }, h('b', {}, n.empty), h('span', {}, 'You’re all caught up.'))),
    n.rest.length ? moreEl(n.rest, ctx) : null,
  );
}

function needRow(it: HomeNeed, ctx: HomeContext): HTMLElement {
  return h('li', {},
    h('button', { class: `pv-home-row is-${it.tone}`, 'data-go': it.go, 'data-need': it.id, onclick: () => ctx.onGo(it.go) },
      h('span', { class: 'ic' }, icon(it.icon)),
      h('span', { class: 'tx' }, h('b', {}, it.title), h('span', {}, it.line)),
      h('span', { class: 'go' }, icon('next')),
    ));
}

/** The items past the first three: hidden behind "Show N more" until clicked (a redraw folds them again). */
function moreEl(rest: readonly HomeNeed[], ctx: HomeContext): HTMLElement {
  const list = h('ul', { class: 'pv-home-todo pv-home-rest', hidden: true }, rest.map((it) => needRow(it, ctx)));
  const btn = h('button', { class: 'pv-home-link pv-home-more-n', 'data-k': 'home-more', onclick: () => { list.removeAttribute('hidden'); btn.remove(); } }, `Show ${rest.length} more`);
  return h('div', {}, list, btn);
}

function foodEl(m: Home, ctx: HomeContext): HTMLElement | null {
  const f = m.food;
  if (!f) return null;
  const p = f.protein;
  const hb = f.habits;
  return h('section', { class: 'pv-card', 'data-home': 'food' },
    h('div', { class: 'pv-home-head' }, h('span', { class: 'pv-kicker' }, 'Food and habits')),
    h('div', { class: 'pv-home-pair' },
      p ? h('div', { class: 'pv-home-kv' },
        h('span', { class: 'ic' }, icon('bowl')),
        h('span', { class: 'tx' }, h('b', {}, `${p.grams} g protein`), h('span', {}, p.line)),
        link('Food', 'food', ctx),
      ) : null,
      hb ? h('div', { class: 'pv-home-kv' },
        h('span', { class: 'ic' }, icon('check')),
        h('span', { class: 'tx' },
          h('b', {}, hb.done === hb.total ? `All ${hb.total} habits done` : `${hb.done} of ${hb.total} habits done`),
          h('span', {}, hb.line),
          h('span', { class: 'pv-home-dots', 'aria-hidden': 'true' }, Array.from({ length: Math.min(hb.total, 12) }, (_, k) => h('i', { class: k < hb.done ? 'on' : '' }))),
        ),
        link('Due today', 'due', ctx),
      ) : null,
    ),
  );
}

/** Each lift's way as an arrow, with its word for the tooltip. */
const VERDICT: Readonly<Record<string, { icon: string; word: string }>> = {
  up: { icon: 'up', word: 'Going up' },
  down: { icon: 'down', word: 'Going down' },
  flat: { icon: 'minus', word: 'Holding steady' },
  stalled: { icon: 'pause', word: 'Stopped going up' },
};

/** Strength's picture: one arrow per lift with a trend (eight at most, then "+N"). */
function marksEl(marks: NonNullable<HomeTile['marks']>): HTMLElement {
  return h('span', { class: 'pv-home-viz pv-home-marks' },
    marks.slice(0, 8).map((m) => h('span', { class: `pv-home-mark is-${m.verdict}`, 'data-tip': `${m.name}|${VERDICT[m.verdict]!.word}`, 'aria-label': `${m.name}: ${VERDICT[m.verdict]!.word}` }, icon(VERDICT[m.verdict]!.icon))),
    marks.length > 8 ? h('span', { class: 'pv-home-mark-more' }, `+${marks.length - 8}`) : null);
}

let gradientId = 0;

/** Body weight's picture: the trend line over a soft fill, the latest point a dot at the right end. */
function areaEl(points: readonly number[], range?: readonly [number, number]): HTMLElement | null {
  if (points.length < 2) return null;
  const lo = range ? range[0] : Math.min(...points);
  const hi = range ? range[1] : Math.max(...points);
  const span = hi - lo || 1;
  const ys = points.map((v) => 34 - ((v - lo) / span) * 28);
  const xy = ys.map((y, i) => `${((i / (points.length - 1)) * 120).toFixed(1)},${y.toFixed(1)}`).join(' ');
  const id = `pv-home-fill-${++gradientId}`;
  // Two layers: the line and its fill stretch with the tile; the dot sits in a square box at the right edge, so it stays round.
  return h('span', { class: 'pv-home-viz pv-home-area', 'aria-hidden': 'true' },
    s('svg', { class: 'line', viewBox: '0 0 120 40', preserveAspectRatio: 'none' },
      s('defs', {}, s('linearGradient', { id, x1: '0', y1: '0', x2: '0', y2: '1' }, s('stop', { offset: '0', class: 'from' }), s('stop', { offset: '1', class: 'to' }))),
      s('polygon', { points: `0,40 ${xy} 120,40`, fill: `url(#${id})` }),
      s('polyline', { points: xy })),
    s('svg', { class: 'end', viewBox: '0 0 40 40', preserveAspectRatio: 'xMaxYMid meet' }, s('circle', { cx: '35.5', cy: ys.at(-1)!.toFixed(1), r: '4' })));
}

/** Showing up's picture: a bar per full week, its height the share of the planned lifting sessions done. */
function barsEl(weeks: readonly number[]): HTMLElement | null {
  if (!weeks.length) return null;
  const w = 10;
  return h('span', { class: 'pv-home-viz pv-home-bars', 'aria-hidden': 'true' },
    // Each week a fixed 16px wide (the box stops at the tile's width), so four weeks are not four slabs.
    s('svg', { viewBox: `0 0 ${weeks.length * w} 40`, width: String(weeks.length * 16), preserveAspectRatio: 'none' },
      weeks.map((v, i) => {
        const hgt = Math.max(2, v * 36);
        return s('rect', { x: String(i * w + 2), y: (40 - hgt).toFixed(1), width: String(w - 4), height: hgt.toFixed(1), class: v >= 1 ? 'is-full' : v > 0 ? 'is-part' : 'is-none' });
      })));
}

/** The cycle's share as a small ring in the tile's corner, like the banner's. */
function shareRing(share: number): SVGElement {
  return s('svg', { class: 'pv-home-ring', viewBox: '0 0 44 44', 'aria-hidden': 'true' },
    s('circle', { class: 'track', cx: '22', cy: '22', r: '17' }),
    s('circle', { class: 'arc', cx: '22', cy: '22', r: '17', pathLength: '100', 'stroke-dasharray': `${Math.round(share * 100)} 100`, transform: 'rotate(-90 22 22)' }));
}

function tileEl(t: HomeTile, ctx: HomeContext): HTMLElement {
  const viz = t.id === 'strength' && t.marks?.length ? marksEl(t.marks) : t.id === 'consistency' && t.weeks?.length ? barsEl(t.weeks) : areaEl(t.spark, t.range);
  return h('button', { class: `pv-home-tile is-${t.id}`, 'data-go': 'progress', 'data-tile': t.id, onclick: () => ctx.onGo('progress') },
    h('span', { class: 'lb' }, t.label),
    t.big ? h('span', { class: 'big' }, t.big.value, ' ', h('small', {}, t.big.unit)) : h('span', { class: 'big is-none' }, 'Not yet'),
    viz ?? h('span', { class: 'pv-home-viz is-empty' }),
    h('span', { class: 'line' }, t.line),
    t.id === 'consistency' && t.share !== undefined ? shareRing(t.share) : null,
  );
}

function progressEl(m: Home, ctx: HomeContext): HTMLElement | null {
  const p = m.progress;
  if (!p) return null;
  return h('section', { class: 'pv-card pv-home-wide', 'data-home': 'progress' },
    h('div', { class: 'pv-home-head' }, h('span', { class: 'pv-kicker' }, p.since ? `Progress · since ${fmt.day(p.since)}` : 'Progress')),
    h('p', { class: 'pv-home-lead' }, h('b', {}, p.lead), p.after ? ` ${p.after}` : ''),
    h('div', { class: 'pv-home-tiles' }, p.tiles.map((t) => tileEl(t, ctx))),
    h('div', { class: 'pv-home-more' }, link('All of it in Progress', 'progress', ctx)),
  );
}

/** Each tab's icon, as the tab bar draws it. */
const TAB_ICON: Readonly<Record<HomeTab['id'], string>> = { today: 'sun', progress: 'trend', plan: 'layers', checkin: 'clipboard', food: 'bowl' };

function tabEl(t: HomeTab, ctx: HomeContext): HTMLElement {
  return h('button', { class: `pv-home-tab is-tab-${t.id}${t.tone ? ` is-${t.tone}` : ''}`, 'data-go': t.id, 'data-tab': t.id, 'aria-label': `${t.label}: ${t.does}. Now: ${t.now}`, onclick: () => ctx.onGo(t.id) },
    h('span', { class: 'top' }, h('span', { class: 'ic' }, icon(TAB_ICON[t.id])), h('span', { class: 'go' }, icon('next'))),
    h('b', { class: 'nm' }, t.label),
    h('span', { class: 'does' }, t.does),
    h('span', { class: 'now' }, h('i', { class: 'dot', 'aria-hidden': 'true' }), h('span', {}, t.now)),
  );
}

/** Your tabs: what each tab is for and where it stands, one click away. */
function tabsEl(m: Home, ctx: HomeContext): HTMLElement | null {
  if (!m.tabs.length) return null;
  return h('section', { class: 'pv-card pv-home-wide pv-home-tabs-card', 'data-home': 'tabs' },
    h('div', { class: 'pv-home-head' }, h('span', { class: 'pv-kicker' }, 'Your tabs'), h('span', { class: 'pv-home-count' }, 'Where to find everything')),
    h('div', { class: 'pv-home-tabs' }, m.tabs.map((t) => tabEl(t, ctx))),
  );
}

/** Builds the Home tab into `root` (its children are replaced). */
export function renderHome(root: HTMLElement, m: Home, today: TodayModel, ctx: HomeContext): void {
  root.replaceChildren();
  if (!m.hero) {
    // No plan yet (a first run): the welcome card leads, as on Today.
    root.append(h('div', { class: 'pv-empty' }, h('div', { class: 'pv-kicker' }, 'Pahlavan'), h('h1', { class: 'pv-serif-title' }, 'Home'), ctx.welcome ? null : calmNotes(today)), ctx.welcome ?? '');
    return;
  }
  const food = foodEl(m, ctx);
  // The first draw after Home opens rises in; a redraw (a tick, a refresh) comes without the class, so it stays still.
  // The class sits on Home's own wrapper, not on the page every tab shares.
  root.append(h('div', { class: `pv-home${ctx.intro ? ' pv-home-intro' : ''}` },
    heroEl(m, ctx) ?? '',
    ctx.welcome ?? '',
    // Without a Food and habits card, Needs you takes the whole row; with nothing needing the user, it takes less room and Food and habits more.
    h('div', { class: `pv-home-grid${food && !m.needs.items.length ? ' is-calm' : ''}` }, needsEl(m, ctx, food === null), food ?? '', progressEl(m, ctx) ?? '', tabsEl(m, ctx) ?? ''),
  ));
}
