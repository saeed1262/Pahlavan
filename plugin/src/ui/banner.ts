// The banner every screen opens with, Today's markup shared: the kicker, the
// serif title, a date or period line, the stat chips, an optional action and
// the ring with its key. Always a dark panel, tinted by the phase (the view
// re-themes `.pv-hero` when Isfahan or the hour moves the phase). Standard
// DOM only.

import type { PhaseId } from '../phase.ts';
import { h, icon, s, type Child } from './dom.ts';
import { clean } from './format.ts';

export interface BannerPhase {
  id: PhaseId;
  isfahan: boolean;
}

export interface BannerChip {
  label: string;
  value: string;
  /** A colour swatch from the ring (instead of an icon). */
  sw?: 'lift' | 'short';
  icon?: string;
  /** Tooltip lines joined with "|". */
  tip?: string;
}

/** One ring segment: lift and short take the ring's two colours; now is drawn thicker, future fainter. */
export interface RingSeg {
  kind: 'lift' | 'short' | 'empty';
  now?: boolean;
  future?: boolean;
  tip?: string;
}

export interface BannerOptions {
  phase: BannerPhase;
  kicker: string;
  title: string;
  sub: string;
  /** A tooltip on the line under the title (a plain word for "mesocycle"). */
  subTip?: string;
  chips: readonly (BannerChip | null | false)[];
  action?: Child;
  ring: { segs: readonly RingSeg[]; n: string; label: string; aria: string };
  key: readonly { kind: 'lift' | 'short' | 'empty'; label: string }[];
}

/**
 * A phase as the banners name it: its own name when the plan gives one
 * ("Foundation", from plan-data's `phases`), else "Phase 1".
 */
export function phaseLabel(index: number | null | undefined, name: string | null | undefined): string {
  const nm = clean(name).trim();
  if (nm) return nm;
  return index ? `Phase ${index}` : '';
}

/** A phase's full title on the Plan screen: "Phase 1 · Foundation", or "Phase 1" without a name. */
export function phaseTitle(index: number, name: string | null | undefined): string {
  const nm = clean(name).trim();
  return nm && nm.toLowerCase() !== `phase ${index}` ? `Phase ${index} · ${nm}` : `Phase ${index}`;
}

/** The kicker: "Pahlavan · Week 6 · Phase 1"; the week and the phase are left out when unknown. */
export function bannerKicker(planWeek: number | null | undefined, phase: { index: number; name: string } | null | undefined, phaseNo?: number | null): string {
  return ['Pahlavan', planWeek ? `Week ${planWeek}` : '', phaseLabel(phase?.index ?? phaseNo, phase?.name)].filter(Boolean).join(' · ');
}

export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number) => [cx + r * Math.cos((a * Math.PI) / 180), cy - r * Math.sin((a * Math.PI) / 180)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M${x0!.toFixed(2)},${y0!.toFixed(2)}A${r},${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 < a0 ? 1 : 0} ${x1!.toFixed(2)},${y1!.toFixed(2)}`;
}

/** Today's ring geometry: the segments clockwise from the top, a number and a label inside. */
export function ring(segs: readonly RingSeg[], n: string, label: string, aria: string): SVGElement {
  const cx = 78;
  const cy = 78;
  const count = Math.max(1, segs.length);
  const span = 360 / count;
  const gap = segs.length > 1 ? 7 : 0;
  return s('svg', { viewBox: '0 0 156 156', role: 'img', 'aria-label': aria },
    s('circle', { class: 'pv-medallion', cx, cy, r: 74 }),
    segs.map((x, k) => {
      // A single segment is the whole ring, short of closing (an arc cannot end where it starts).
      const a1 = segs.length > 1 ? 90 - (k + 1) * span + gap / 2 : 90 - 359.9;
      const cls = `pv-ring-seg is-${x.kind}${x.now ? ' is-now' : ''}${x.future ? ' is-future' : ''}`;
      return s('path', { class: cls, d: arcPath(cx, cy, 60, 90 - k * span - gap / 2, a1), 'data-tip': x.tip });
    }),
    s('text', { class: 'pv-ring-n', x: cx, y: cy + 6 }, n),
    s('text', { class: 'pv-ring-l', x: cx, y: cy + 24 }, label),
  );
}

function chip(c: BannerChip): HTMLElement {
  return h('span', { class: 'pv-hero-chip', 'data-tip': c.tip }, c.sw ? h('i', { class: `sw ${c.sw}` }) : c.icon ? icon(c.icon) : null, `${c.label} `, h('b', {}, c.value));
}

export function banner(o: BannerOptions): HTMLElement {
  return h('section', { class: `pv-hero is-${o.phase.id}${o.phase.isfahan ? ' has-tile' : ''}` },
    h('div', { class: 'pv-hero-text' },
      h('div', { class: 'pv-kicker' }, o.kicker),
      h('h1', { class: 'pv-hero-title' }, o.title),
      h('div', { class: 'pv-hero-sub', ...(o.subTip ? { 'data-tip': o.subTip } : {}) }, o.sub),
      h('div', { class: 'pv-hero-chips' }, o.chips.filter((c): c is BannerChip => Boolean(c)).map(chip)),
      o.action ? h('div', { class: 'pv-hero-acts' }, o.action) : null,
    ),
    h('div', { class: 'pv-hero-ring' }, ring(o.ring.segs, o.ring.n, o.ring.label, o.ring.aria),
      o.key.length ? h('div', { class: 'pv-ring-key' }, o.key.map((k) => h('span', {}, h('i', { class: k.kind }), k.label))) : null,
    ),
  );
}
