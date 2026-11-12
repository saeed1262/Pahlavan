// The Progress screen, built from the engine's Progress report: the banner
// (strength on the ring), sets per muscle on the body map, readiness over 28
// days, the consistency calendar, strength trends and the weight trend. A
// port of the signed-off mockup (mockups/progress.html). Every number comes
// from the report; this module only lays it out. Standard DOM only.

import { bodyFmt, type BodyUnits } from './units.ts';
import { SHORT } from './terms.ts';
import { strengthChange, weeksLogged } from '../../../src/report/banners.ts';
import type { tapeTrends } from '../../../src/report/progress-more.ts';
import type { ProgressModel } from '../data-source.ts';
import { banner, bannerKicker, type BannerPhase, type RingSeg } from './banner.ts';
import { BODY, type Side } from './body-map.ts';
import { h, icon, s, type Child } from './dom.ts';
import { addDays, clean, daysBetween, fmt } from './format.ts';
import { musclesWithRegions, regionName, regionTipLines, regionValue, roughGuide, type RegionRow } from './regions.ts';

export type VolumeView = 'week' | 'four' | 'plan';

export interface ProgressContext {
  view: VolumeView;
  /** What the user toggled open: a card shown as its table (by the card's id), and the body map's Regions list (REGIONS_OPEN). */
  tables: Set<string>;
  onView: (view: VolumeView) => void;
  onTable: (id: string) => void;
  /** The profile's body units (kg and cm without them): weights and lengths are shown in them. */
  units?: BodyUnits;
}

type Volume = NonNullable<ProgressModel['volume']>;
type Lift = ProgressModel['lifts'][number];

export const tip = (...lines: (string | false | null | undefined)[]) => lines.filter(Boolean).join('|');
const TIER_LABEL = ['None', 'Below 4', '4–10', '10–16', '16–20', 'Over 20'];
const TIER_INDEX: Record<string, number> = { 'below-minimum': 1, efficient: 2, priority: 3, high: 4, cap: 5 };
const tierOf = (m: { sets: number; tier: string }) => (m.sets <= 0 ? 0 : (TIER_INDEX[m.tier] ?? 1));
// Above the priority band shares the below amber (outside the band, not a
// problem yet) with the up arrow; only over the cap takes the red.
const STATUS = { below: ['below', 'Below target'], in: ['inTarget', 'In target'], above: ['over', 'Above the priority band'], over: ['over', 'Over target'] } as const;
type Status = keyof typeof STATUS;
const MIN_POINTS = 3;
/** The id in ProgressContext.tables that opens the body map's Regions list (folded to one line by default). */
export const REGIONS_OPEN = 'regions';

/** "N direct, M half credit from helping lifts": how a muscle's weekly sets count; null when the row has no split. */
export function splitLine(m: { direct?: number; indirect?: number }): string | null {
  if (m.direct === undefined || m.indirect === undefined) return null;
  return `${fmt.sets(m.direct)} direct, ${fmt.sets(m.indirect)} half credit from helping lifts`;
}

export function statusChip(st: Status | 'neutral', label: string, ic?: string): HTMLElement {
  const icn = ic ?? (st === 'neutral' ? 'info' : STATUS[st][0]);
  return h('span', { class: `pv-status is-${st}` }, icon(icn), label);
}

export function cardHead(id: string, kicker: string, sub: string | null, ctx: ProgressContext, tools: Child = null): HTMLElement {
  const on = ctx.tables.has(id);
  return h('div', { class: 'pv-card-head' },
    h('div', {}, h('div', { class: 'pv-kicker' }, kicker), sub ? h('div', { class: 'pv-card-sub' }, sub) : null),
    h('div', { class: 'pv-card-tools' }, tools, h('button', { class: `pv-btn-quiet${on ? ' is-on' : ''}`, onclick: () => ctx.onTable(id) }, icon(on ? 'chart' : 'table'), on ? 'Chart' : 'Table')),
  );
}

export function table(head: { t: string; r?: boolean }[], rows: Child[][]): HTMLElement {
  return h('div', { class: 'pv-tbl-wrap' }, h('table', { class: 'pv-tbl' },
    h('thead', {}, h('tr', {}, head.map((c) => h('th', { class: c.r ? 'r' : '' }, c.t)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, r.map((cell, i) => h('td', { class: head[i]?.r ? 'r' : '' }, cell))))),
  ));
}

function sparse(text: string): HTMLElement {
  return h('p', { class: 'pv-calm' }, icon('info'), text);
}

/** A linear scale with its inverse. */
export function scale(d0: number, d1: number, r0: number, r1: number) {
  const f = (v: number) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
  return f;
}
export function niceTicks(lo: number, hi: number, n = 4): number[] {
  const step0 = (hi - lo || 1) / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
const ms = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const path = (pts: [number, number][]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');

/** The crosshair and highlighted point for a line chart: the hit area's tooltip follows the nearest point. */
function hover<T extends { date: string }>(hit: SVGElement, svg: SVGElement, list: T[], x: (d: string) => number, y: (p: T) => number, text: (p: T) => string): void {
  const cross = s('line', { class: 'pv-c-cross', x1: 0, x2: 0, y1: hit.getAttribute('y') ?? 0, y2: Number(hit.getAttribute('y')) + Number(hit.getAttribute('height')) });
  const hot = s('circle', { class: 'pv-c-hot', r: 4.5, cx: 0, cy: 0 });
  svg.insertBefore(cross, hit);
  svg.insertBefore(hot, hit);
  hit.addEventListener('mousemove', (ev) => {
    const box = (svg as SVGSVGElement).getBoundingClientRect();
    const vb = (svg as SVGSVGElement).viewBox.baseVal;
    const px = ((ev).clientX - box.left) * (vb.width / box.width);
    let best = list[0]!;
    for (const p of list) if (Math.abs(x(p.date) - px) < Math.abs(x(best.date) - px)) best = p;
    cross.setAttribute('x1', String(x(best.date)));
    cross.setAttribute('x2', String(x(best.date)));
    hot.setAttribute('cx', String(x(best.date)));
    hot.setAttribute('cy', String(y(best)));
    cross.classList.add('is-on');
    hot.classList.add('is-on');
    hit.setAttribute('data-tip', text(best));
  });
  hit.addEventListener('mouseleave', () => {
    cross.classList.remove('is-on');
    hot.classList.remove('is-on');
  });
}

// ================================================================ body map
function figure(side: Side, v: Volume, view: VolumeView): HTMLElement {
  const muscles = v.views[view].muscles;
  const bySlug = new Map(muscles.map((m) => [v.labels[m.muscle]?.slug ?? m.muscle, m]));
  const parts: SVGElement[] = [s('path', { class: 'pv-bm-base', d: BODY.outline[side] })];
  const muscleParts: SVGElement[] = [];
  for (const [slug, ds] of Object.entries(BODY[side])) {
    const m = bySlug.get(slug);
    if (!m) {
      for (const d of ds) parts.push(s('path', { class: 'pv-bm-base', d }));
      continue;
    }
    const label = v.labels[m.muscle]?.label ?? m.muscle;
    const top = (v.topExercises[m.muscle] ?? []).map((x) => `${clean(x.name)} ${fmt.sets(x.sets)}`).join(', ');
    const text = tip(label, `${fmt.sets(m.sets)} sets a week (${v.views[view].label.toLowerCase()})`, splitLine(m), `Band ${TIER_LABEL[tierOf(m)]}`, `Target ${m.priority ? 'priority muscle, 10–16' : 'at least 4'}`, STATUS[m.status][1], top && `Top, planned sets: ${top}`, ...regionTipLines(m.regions, label));
    for (const d of ds) muscleParts.push(s('path', { class: `pv-bm-muscle is-${tierOf(m)}`, 'data-muscle': m.muscle, 'data-tip': text, d }));
  }
  const svg = s('svg', { viewBox: BODY.viewBox[side], role: 'img', 'aria-label': `${side} of the body, muscles shaded by weekly sets` }, parts, muscleParts, s('path', { class: 'pv-bm-outline', d: BODY.outline[side] }));
  return h('div', { class: 'pv-figure' }, svg, h('div', { class: 'pv-figure-cap' }, side === 'front' ? 'Front' : 'Back'));
}

/**
 * The body map's Regions list, in the side column: each muscle with a region
 * that has sets or is held to a rule, its regions' weekly sets, a chip for a
 * region held to a rule (under or ok), declared ones starred and heuristic
 * ones marked a rough guide. Folded to one line (its count of regions under)
 * until opened, so the card keeps its height.
 */
function regionsList(view: Volume['views'][VolumeView], v: Volume, ctx: ProgressContext): HTMLElement | null {
  const groups = musclesWithRegions(view.muscles);
  if (!groups.length) return null;
  const all = groups.flatMap((g) => g.regions);
  const under = all.filter((r) => r.status === 'short').length;
  const noOption = all.filter((r) => r.status === 'uncoverable').length;
  const ruled = all.filter((r) => r.status !== 'reported').length;
  const open = ctx.tables.has(REGIONS_OPEN);
  const summary = under ? `${under} under` : noOption ? `${noOption} with no option` : ruled ? 'on target' : `${groups.length} muscle${groups.length === 1 ? '' : 's'}`;
  // Its tooltip: the sets and their split, the evidence, and the engine's note on the rule it is held to.
  const row = (r: RegionRow, muscle: string) => h('li', { class: `pv-bm-reg${r.declared ? ' is-declared' : ''}`, 'data-region': r.id, 'data-tip': tip(`${r.label}${r.declared ? ' (declared weak)' : ''}`, `${fmt.sets(r.sets)} sets a week (${view.label.toLowerCase()})`, splitLine(r), roughGuide(r) ? 'A rough guide: no training study has measured it' : `Evidence: ${r.grade}`, r.note ? clean(r.note) : null) },
    // The star is drawn only (aria-hidden): the words say it to a screen reader.
    h('span', { class: 'pv-bm-reg-name' }, r.declared ? icon('star', 'pv-bm-reg-star') : null, regionName(r, muscle), r.declared ? h('span', { class: 'pv-vh' }, ' (declared weak)') : null, roughGuide(r) ? h('small', {}, 'rough guide') : null),
    r.status === 'reported' ? h('i', {}) : r.status === 'uncoverable' ? statusChip('neutral', 'No option') : statusChip(r.status === 'short' ? 'below' : 'in', r.status === 'short' ? 'Under' : 'OK'),
    // The sets at the right edge, as the lists above have them.
    h('span', { class: 'pv-bm-reg-sets' }, fmt.sets(r.sets)),
  );
  return h('div', { class: `pv-bm-regions${open ? ' is-open' : ''}` },
    h('button', { class: 'pv-bm-regions-head', 'aria-expanded': open ? 'true' : 'false', 'data-k': 'bm-regions', onclick: () => ctx.onTable(REGIONS_OPEN) },
      h('span', { class: 'pv-bm-regions-title' }, 'Regions'), h('span', { class: `pv-bm-regions-sum${under ? ' is-under' : ''}` }, summary), icon('chevron')),
    open ? [
      groups.map((g) => {
        const label = v.labels[g.muscle]?.label ?? g.muscle;
        return h('div', { class: 'pv-bm-reg-group' }, h('div', { class: 'pv-bm-reg-muscle' }, label), h('ul', {}, g.regions.map((r) => row(r, label))));
      }),
      h('p', { class: 'pv-bm-reg-key' }, ruled ? `Under or OK against the aim: 4 direct sets a week for a priority muscle’s region, 6 near failure for one you declared weak (★).${noOption ? ' No option: nothing in the catalogue that biases it fits your equipment, so it is not a shortfall to fix with that.' : ''}` : 'The sets a week each region got. A priority muscle’s regions, and any you declare weak, get an aim.'),
    ] : null,
  );
}

function bodyMap(m: ProgressModel, ctx: ProgressContext): HTMLElement {
  const v = m.volume!;
  const view = v.views[ctx.view];
  const lab = (id: string) => v.labels[id]?.label ?? id;
  const below = view.muscles.filter((x) => x.status === 'below').sort((a, b) => a.sets - b.sets);
  const above = view.muscles.filter((x) => x.status === 'above').sort((a, b) => b.sets - a.sets);
  const over = view.muscles.filter((x) => x.status === 'over');
  const inT = view.muscles.filter((x) => x.status === 'in');
  const sub = ctx.view === 'week' && view.from ? `${fmt.wd(view.from)} to ${fmt.wd(m.date)}, so far` : ctx.view === 'four' && view.from ? `An average week, ${fmt.day(view.from)} to ${fmt.day(m.date)}` : `Week ${m.week?.planWeek ?? ''} as planned`;
  const seg = h('div', { class: 'pv-seg' }, (['week', 'four', 'plan'] as const).map((k) => h('button', { class: ctx.view === k ? 'is-on' : '', onclick: () => ctx.onView(k) }, v.views[k].label)));
  const figs = h('div', { class: 'pv-figures' }, figure('front', v, ctx.view), figure('back', v, ctx.view));
  figs.addEventListener('mouseover', (ev) => {
    const id = (ev.target as Element).getAttribute?.('data-muscle');
    figs.classList.toggle('is-hovering', Boolean(id));
    figs.querySelectorAll('.pv-bm-muscle').forEach((p) => p.classList.toggle('is-hot', p.getAttribute('data-muscle') === id));
  });
  figs.addEventListener('mouseleave', () => figs.classList.remove('is-hovering'));
  const list = (items: typeof below, st: Status) => h('ul', {}, items.map((x) => h('li', {}, statusChip(st, lab(x.muscle)), h('span', {}, fmt.sets(x.sets)))));
  // The table's Regions column says what the list and the tooltip say: each region of a muscle that has one with sets or a rule.
  const shown = new Set(musclesWithRegions(view.muscles).map((x) => x.muscle));
  const regionsCell = (x: (typeof view.muscles)[number]) => shown.has(x.muscle) ? x.regions.map((r) => `${r.declared ? '★ ' : ''}${regionName(r, lab(x.muscle))}${roughGuide(r) ? ' (rough guide)' : ''} ${regionValue(r)}`).join('; ') : '';
  const table_ = table([{ t: 'Muscle' }, { t: 'Sets a week', r: true }, { t: 'Band' }, { t: 'Status' }, { t: 'Regions' }, { t: 'Top exercises (planned sets)' }],
    view.muscles.map((x) => [`${lab(x.muscle)}${x.priority ? ' (priority)' : ''}`, fmt.sets(x.sets), TIER_LABEL[tierOf(x)]!, STATUS[x.status][1], h('span', { class: 'pv-faint' }, regionsCell(x)), h('span', { class: 'pv-faint' }, (v.topExercises[x.muscle] ?? []).map((t) => `${clean(t.name)} ${fmt.sets(t.sets)}`).join(', '))]));
  return h('section', { class: `pv-card pv-span-7${ctx.tables.has('body') ? ' is-table' : ''}`, 'data-sec': 'sets' },
    cardHead('body', 'Weekly sets per muscle', sub, ctx, seg),
    h('div', { class: 'pv-chart-area' },
      h('div', { class: 'pv-bodymap' },
        h('div', {}, figs,
          h('div', { class: 'pv-ramp-legend' }, h('span', { class: 'title' }, 'Sets a week'), [0, 1, 2, 3, 4, 5].map((i) => h('span', {}, h('i', { class: `is-${i}` }), TIER_LABEL[i]))),
          h('div', { class: 'pv-status-legend' }, h('span', { class: 'title' }, 'Status'), (['below', 'in', 'above', 'over'] as const).map((k) => h('span', { class: `is-${k}` }, icon(STATUS[k][0]), STATUS[k][1]))),
        ),
        h('div', { class: 'pv-bm-side' },
          h('h4', {}, 'Below target'), below.length ? list(below, 'below') : h('p', {}, 'None.'),
          above.length ? [h('h4', {}, 'Above the priority band'), list(above, 'above')] : null,
          h('h4', {}, 'Over target'), over.length ? list(over, 'over') : h('p', {}, 'None.'),
          h('h4', {}, 'In target'), h('p', {}, inT.length ? `${inT.map((x) => lab(x.muscle)).join(', ')}.` : 'None.'),
          regionsList(view, v, ctx),
        ),
      ),
      view.note ? h('div', { class: 'pv-bm-note' }, `${clean(view.note).split('. ')[0]!.replace(/\.$/, '')}.`) : null,
    ),
    h('div', { class: 'pv-table-area' }, table_),
  );
}

// ================================================================ readiness
function readiness(m: ProgressModel, width: number, ctx: ProgressContext): HTMLElement {
  const r = m.readiness!;
  const pts = r.points;
  // This cycle's mornings only, in either range: the chart starts at the cycle when that is less than 28 days back.
  const cut = r.since !== null && r.from === r.since;
  const head = cardHead('ready', cut ? 'Readiness, this cycle' : 'Readiness, 28 days', `The line is your readiness smoothed over 3 days; each dot is one morning on its own. 0 is your usual${cut ? `, from this cycle’s mornings since ${fmt.day(r.since!)}` : ''}`, ctx);
  const tbl = table([{ t: 'Date' }, { t: 'That morning', r: true }, { t: 'Smoothed', r: true }, { t: 'Band' }], [...pts].reverse().map((d) => [fmt.wd(d.date), fmt.signed(d.r), fmt.signed(d.s), d.band]));
  if (pts.length < MIN_POINTS) {
    const b = r.baseline.value;
    const text = b.building
      ? `Building your baseline: ${Math.min(b.mornings, b.needed)} of ${b.needed} morning check-ins this cycle. Train as planned meanwhile; the chart starts after the 14th.`
      : `${pts.length} scored check-in${pts.length === 1 ? '' : 's'} ${cut ? 'this cycle' : 'in the last 28 days'}: the line starts at ${MIN_POINTS}.`;
    return h('section', { class: `pv-card${ctx.tables.has('ready') ? ' is-table' : ''}`, 'data-sec': 'ready' }, head, h('div', { class: 'pv-chart-area' }, sparse(text)), h('div', { class: 'pv-table-area' }, tbl));
  }
  const W = width - 46;
  const H = 190;
  const mg = { l: 30, r: 54, t: 12, b: 22 };
  const x = (d: string) => scale(ms(r.from), ms(r.to), mg.l, W - mg.r)(ms(d));
  const y = scale(-2, 1.25, H - mg.b, mg.t);
  const yc = (v: number) => y(Math.max(-2, Math.min(1.25, v)));
  const svg = s('svg', { class: 'pv-chart', width: W, height: H, viewBox: `0 0 ${W} ${H}` },
    s('rect', { class: 'pv-c-band', x: mg.l, y: y(r.bands.good), width: W - mg.r - mg.l, height: y(r.bands.normal) - y(r.bands.good) }),
    s('text', { class: 'pv-c-label', x: W - mg.r + 6, y: y(0) + 3 }, 'Normal'),
    s('line', { class: 'pv-c-threshold', x1: mg.l, x2: W - mg.r, y1: y(r.bands.watch), y2: y(r.bands.watch) }),
    s('text', { class: 'pv-c-label', x: W - mg.r + 6, y: y((r.bands.normal + r.bands.watch) / 2) + 3 }, 'Watch'),
    s('text', { class: 'pv-c-label', x: W - mg.r + 6, y: y(-1.5) + 3 }, 'Low'),
    [-2, -1, 0, 1].map((t) => s('text', { class: 'pv-ax end', x: mg.l - 6, y: y(t) + 3 }, t > 0 ? `+${t}` : t < 0 ? `−${-t}` : '0')),
    s('line', { class: 'pv-grid', x1: mg.l, x2: W - mg.r, y1: y(0), y2: y(0) }),
    [0, 7, 14, 21].filter((k) => addDays(r.from, k) <= r.to).map((k) => s('text', { class: 'pv-ax mid', x: x(addDays(r.from, k)), y: H - 6 }, fmt.day(addDays(r.from, k)))),
    s('line', { class: 'pv-base', x1: mg.l, x2: W - mg.r, y1: H - mg.b, y2: H - mg.b }),
    pts.map((p) => s('circle', { class: 'pv-c-raw', cx: x(p.date), cy: yc(p.r), r: 2.4 })),
    s('path', { class: 'pv-c-line', d: path(pts.map((p) => [x(p.date), yc(p.s)])) }),
  );
  const last = pts.at(-1)!;
  svg.append(
    s('circle', { class: 'pv-c-end', cx: x(last.date), cy: yc(last.s), r: 4.5 }),
    s('text', { class: 'pv-c-label strong', x: x(last.date) - 8, y: yc(last.s) + 16, 'text-anchor': 'end' }, fmt.signed(last.s)),
  );
  const hit = s('rect', { class: 'pv-c-hit', x: mg.l, y: mg.t, width: W - mg.r - mg.l, height: H - mg.b - mg.t });
  svg.append(hit);
  hover(hit, svg, pts, x, (p) => yc(p.s), (p) => tip(fmt.wd(p.date), `Smoothed over 3 days: ${fmt.signed(p.s)}`, `That morning on its own: ${fmt.signed(p.r)}`, `Band: ${p.band}`, p.flags.length ? p.flags.map((f) => ({ 'short-sleep': 'slept under 6 h', 'rhr-flag': 'resting HR flag', 'hrv-flag': 'HRV low two mornings', illness: 'illness' })[f] ?? f).join(', ') : ''));
  return h('section', { class: `pv-card${ctx.tables.has('ready') ? ' is-table' : ''}`, 'data-sec': 'ready' }, head, h('div', { class: 'pv-chart-area' }, svg), h('div', { class: 'pv-table-area' }, tbl));
}

// ================================================================ consistency
const DAY_LABEL: Record<string, string> = { trained: 'Trained', rest: 'Rest', unlogged: 'Not logged', missed: 'Missed', none: 'No entry', future: 'Upcoming' };

/** Which full weeks the adherence counts, in words: "the last 4 full weeks", "this cycle’s 2 full weeks". */
export function fullWeeksText(m: Pick<ProgressModel, 'calendar'>): string {
  const n = m.calendar?.adherence?.weeks.length ?? 0;
  return m.calendar?.since ? `this cycle’s ${n === 1 ? 'first full week' : `${n} full weeks`}` : `the last ${n} full weeks`;
}

function consistency(m: ProgressModel, width: number, ctx: ProgressContext): HTMLElement {
  const c = m.calendar!;
  const a = c.adherence;
  const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)} %`);
  const sub = a
    ? `${c.weeks.length} weeks · ${fullWeeksText(m)}: lifting ${a.lifting.done} of ${a.lifting.planned} (${pct(a.lifting.pct)}), short ${a.short.done} of ${a.short.planned} (${pct(a.short.pct)})`
    : `${c.weeks.length} weeks · no full week in this cycle yet (since ${fmt.day(c.since ?? m.date)})`;
  const W = width - 46;
  const left = 26;
  const top = 16;
  const gap = 3;
  const weeks = c.weeks.length;
  const cell = Math.max(9, Math.min(16, Math.floor((W - left) / weeks) - gap));
  const H = top + 7 * (cell + gap) + 18;
  const svg = s('svg', { class: 'pv-cal', width: W, height: H, viewBox: `0 0 ${W} ${H}` },
    s('defs', {}, s('pattern', { id: 'pv-hatch', width: 4, height: 4, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, s('rect', { width: 4, height: 4, class: 'pv-hatch-bg' }), s('line', { x1: 0, y1: 0, x2: 0, y2: 4, class: 'pv-hatch-line' }))),
    ['Mon', '', 'Wed', '', 'Fri', '', ''].map((t, i) => (t ? s('text', { class: 'pv-ax', x: 0, y: top + i * (cell + gap) + cell - 2 }, t) : null)),
  );
  let lastMonth = '';
  let dataStartX: number | null = null;
  let cycleStartX: number | null = null;
  c.days.forEach((d, i) => {
    const wk = Math.floor(i / 7);
    const dy = i % 7;
    const cx = left + wk * (cell + gap);
    const cy = top + dy * (cell + gap);
    if (dy === 0) {
      const mo = fmt.month(d.date);
      if (mo !== lastMonth) {
        svg.append(s('text', { class: 'pv-ax', x: cx, y: top - 5 }, mo));
        lastMonth = mo;
      }
    }
    if (!d.beforeData && dataStartX === null) dataStartX = cx;
    if (!d.beforeCycle && cycleStartX === null) cycleStartX = cx;
    const what = d.sessions.length ? `: ${d.sessions.map(clean).join(', ')}` : '';
    const why = d.beforeCycle ? `Before this cycle (it began ${fmt.day(c.since!)}): All shows it.` : d.state === 'unlogged' ? (d.confirmed ? 'Your Sunday check-in says you trained. No session is logged yet.' : 'Workout ticked, no session logged.') : d.state === 'none' ? (d.beforeData ? 'Before the log began.' : 'Nothing logged, ticked or marked: not counted as rest or missed.') : '';
    svg.append(s('rect', { class: `pv-cal-cell is-${d.state}${d.beforeData || d.beforeCycle ? ' is-before' : ''}`, x: cx + 0.5, y: cy + 0.5, width: cell - 1, height: cell - 1, rx: 3, 'data-tip': tip(fmt.wd(d.date), d.beforeCycle ? 'Before this cycle' : `${DAY_LABEL[d.state]}${what}`, why) }));
    if (d.state === 'unlogged') svg.append(s('circle', { class: 'pv-cal-dot', cx: cx + cell / 2, cy: cy + cell / 2, r: 1.6 }));
    if (d.today) svg.append(s('rect', { class: 'pv-cal-today', x: cx - 1.5, y: cy - 1.5, width: cell + 3, height: cell + 3, rx: 4.5 }));
  });
  const yb = top + 7 * (cell + gap) + 4;
  if (c.since && cycleStartX !== null && cycleStartX > left) {
    // The cycle's first week: everything before it stays blank until All is chosen.
    const x0 = Math.min(cycleStartX, W - 130);
    svg.append(s('text', { class: 'pv-ax', x: x0, y: yb + 10 }, `This cycle from ${fmt.day(c.since)}`));
  } else if (c.firstEntry && dataStartX !== null && dataStartX > left) {
    svg.append(s('text', { class: 'pv-ax', x: left, y: yb + 10 }, `No entries before ${fmt.day(c.firstEntry)}`));
  }
  const sw = (st: string) => s('svg', { viewBox: '0 0 12 12' }, s('rect', { class: `pv-cal-cell is-${st}`, x: 0.5, y: 0.5, width: 11, height: 11, rx: 3 }), st === 'unlogged' ? s('circle', { class: 'pv-cal-dot', cx: 6, cy: 6, r: 1.5 }) : null);
  const tbl = table([{ t: 'Week of' }, { t: 'Trained', r: true }, { t: 'Rest', r: true }, { t: 'Not logged', r: true }, { t: 'Missed', r: true }, { t: 'No entry', r: true }],
    [...c.weeks].filter((w) => !w.beforeCycle).reverse().map((w) => [`${fmt.day(w.from)}${w.beforeData ? ' (before the log)' : ''}`, String(w.trained), String(w.rest), String(w.unlogged), String(w.missed), String(w.none)]));
  return h('section', { class: `pv-card${ctx.tables.has('cal') ? ' is-table' : ''}`, 'data-sec': 'consistency' },
    cardHead('cal', 'Consistency', sub, ctx),
    h('div', { class: 'pv-chart-area' }, svg, h('div', { class: 'pv-cal-legend' }, ['trained', 'rest', 'unlogged', 'missed', 'none'].map((st) => h('span', {}, sw(st), DAY_LABEL[st])))),
    h('div', { class: 'pv-table-area' }, tbl),
  );
}

// ================================================================ strength
const VERDICT: Record<string, [string, string, string]> = {
  up: ['in', 'up', 'Up'], down: ['over', 'down', 'Down'], flat: ['neutral', 'right', 'Flat'], stalled: ['below', 'pause', 'Stalled'], units: ['below', 'alert', 'Check units'], 'too-few': ['neutral', 'info', 'Too few sessions'],
};

function liftChart(l: Lift, w: number, domain: [string, string]): SVGElement {
  const H = 150;
  const mg = { l: 34, r: 10, t: 16, b: 20 };
  const plotted = l.sets.filter((p) => p.e1rm !== null);
  const vals = plotted.map((p) => p.e1rm!);
  if (l.noise) vals.push(l.noise.lo, l.noise.hi);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = (hi - lo) * 0.12 || 2;
  lo -= pad;
  hi += pad;
  const x = (d: string) => scale(ms(domain[0]), ms(domain[1]), mg.l, w - mg.r)(ms(d));
  const y = scale(lo, hi, H - mg.b, mg.t);
  const svg = s('svg', { class: 'pv-chart', width: w, height: H, viewBox: `0 0 ${w} ${H}` });
  for (const d of l.deloadWeeks) {
    if (d.from > domain[1] || d.to < domain[0]) continue;
    const x0 = Math.max(mg.l, x(d.from));
    const x1 = Math.min(w - mg.r, x(addDays(d.to, 1)));
    svg.append(s('rect', { class: 'pv-c-wash', x: x0, y: mg.t, width: x1 - x0, height: H - mg.b - mg.t }), s('text', { class: 'pv-c-label', x: (x0 + x1) / 2, y: mg.t - 4, 'text-anchor': 'middle' }, 'Light week'));
  }
  for (const t of niceTicks(lo, hi, 3)) svg.append(s('line', { class: 'pv-grid', x1: mg.l, x2: w - mg.r, y1: y(t), y2: y(t) }), s('text', { class: 'pv-ax end', x: mg.l - 6, y: y(t) + 3 }, String(t)));
  if (l.noise) svg.append(s('rect', { class: 'pv-c-band', x: mg.l, y: y(l.noise.hi), width: w - mg.r - mg.l, height: y(l.noise.lo) - y(l.noise.hi) }));
  const span = daysBetween(domain[0], domain[1]);
  const step = Math.max(7, Math.ceil(span / 3 / 7) * 7);
  for (let d = domain[0]; d <= domain[1]; d = addDays(d, step)) svg.append(s('text', { class: 'pv-ax mid', x: x(d), y: H - 5 }, fmt.day(d)));
  svg.append(s('line', { class: 'pv-base', x1: mg.l, x2: w - mg.r, y1: H - mg.b, y2: H - mg.b }));
  for (const p of plotted) svg.append(s('circle', { class: p.used ? 'pv-c-raw' : 'pv-c-raw-out', cx: x(p.date), cy: y(p.e1rm!), r: 3.2 }));
  const line = l.sets.filter((p) => p.best !== null);
  if (line.length > 1) svg.append(s('path', { class: 'pv-c-line', d: path(line.map((p) => [x(p.date), y(p.best!)])) }));
  const prs = l.sets.filter((p) => p.pr && p.e1rm !== null);
  for (const p of prs) svg.append(s('rect', { class: 'pv-c-pr', x: x(p.date) - 3.5, y: y(p.e1rm!) - 3.5, width: 7, height: 7, transform: `rotate(45 ${x(p.date)} ${y(p.e1rm!)})` }));
  const lastPr = prs.at(-1);
  if (lastPr) {
    const cx = x(lastPr.date);
    const end = cx > w - 40;
    svg.append(s('text', { class: 'pv-c-label', x: end ? cx + 4 : cx, y: y(lastPr.e1rm!) - 9, 'text-anchor': end ? 'end' : 'middle' }, 'PR'));
  }
  if (l.unitFlag) {
    const fx = x(l.unitFlag.from.date);
    svg.append(s('line', { class: 'pv-c-flagline', x1: fx, x2: fx, y1: mg.t, y2: H - mg.b }), s('text', { class: 'pv-c-label', x: fx + 4, y: H - mg.b - 5 }, `${l.unitFlag.from.weight} ${l.unit}?`));
  }
  const lb = line.at(-1);
  if (lb) svg.append(s('circle', { class: 'pv-c-end', cx: x(lb.date), cy: y(lb.best!), r: 4 }));
  const hit = s('rect', { class: 'pv-c-hit', x: mg.l, y: mg.t, width: w - mg.r - mg.l, height: H - mg.b - mg.t });
  svg.append(hit);
  hover(hit, svg, plotted, x, (p) => y(p.e1rm!), (p) => tip(`${clean(l.name)} · ${fmt.wd(p.date)}`, p.top ? `Best set ${fmt.w(p.weight, p.unit)} × ${p.reps} (top set ${fmt.w(p.top.weight, p.unit)} × ${p.top.reps})` : `Top set ${fmt.w(p.weight, p.unit)} × ${p.reps}`, p.logged.unit !== p.unit || p.logged.weight !== p.weight ? `Logged as ${fmt.w(p.logged.weight, p.logged.unit)}` : '', `e1RM ${fmt.num(p.e1rm!)} ${l.unit}`, p.best !== null && `Best of the last 3: ${fmt.num(p.best)} ${l.unit}`, !p.used && 'Left out: before the unit flag', p.pr && 'A PR'));
  return svg;
}

function strength(m: ProgressModel, width: number, ctx: ProgressContext): HTMLElement {
  const lifts = m.lifts;
  const head = cardHead('strength', 'Strength trends', `Estimated one-rep max from each session’s top set (Epley; with every set logged, its best set), per logged lift${m.cycle.since ? `, since ${fmt.day(m.cycle.since)}` : ''}`, ctx);
  if (!lifts.length) return h('section', { class: 'pv-card pv-span-12', 'data-sec': 'strength' }, head, sparse('No logged top sets yet: strength trends start with the first logged lift.'));
  const inner = width - 46;
  const cols = inner < 1014 ? 2 : Math.min(4, lifts.length);
  const colW = Math.floor(inner / cols) - (cols >= 4 ? 32 : 16);
  const all = lifts.flatMap((l) => l.sets.map((p) => p.date)).sort();
  const domain: [string, string] = [all[0]!, m.date];
  const cells = lifts.map((l) => {
    const [st, ic, label] = VERDICT[l.verdict] ?? VERDICT['too-few']!;
    const plotted = l.sets.filter((p) => p.e1rm !== null).length;
    const val = l.latest !== null ? [h('b', {}, `${fmt.num(l.latest)} ${l.unit}`), ` e1RM${l.change !== null ? `, ${fmt.signed(l.change * 100, 1)} %` : ''}`] : ['No e1RM yet'];
    const foot = [l.unitFlag ? clean(l.reason.note ?? '').split('; ask')[0] + '; ask which is right.' : clean(l.stall.note ?? ''), l.hotel ? clean(l.hotel) : ''].filter(Boolean).join(' ');
    return h('div', { class: 'pv-mult' },
      h('div', { class: 'pv-mult-head' }, h('div', {}, h('div', { class: 'pv-mult-name' }, clean(l.name)), h('div', { class: 'pv-mult-val' }, val)), statusChip(st as 'in', label, ic)),
      plotted >= MIN_POINTS ? liftChart(l, colW, domain) : sparse(`${plotted} top set${plotted === 1 ? '' : 's'} with an e1RM: the chart starts at ${MIN_POINTS}.`),
      h('div', { class: 'pv-mult-foot' }, foot),
    );
  });
  const key = (cls: string, shape: string, label: string) => {
    const svg = s('svg', { viewBox: '0 0 18 12' });
    if (shape === 'dot') svg.append(s('circle', { cx: 9, cy: 6, r: 3.2, class: cls }));
    if (shape === 'line') svg.append(s('path', { d: 'M1 6h16', class: cls }));
    if (shape === 'pr') svg.append(s('rect', { x: 5, y: 2, width: 8, height: 8, class: cls, transform: 'rotate(45 9 6)' }));
    if (shape === 'box') svg.append(s('rect', { x: 0, y: 1, width: 18, height: 10, rx: 2, class: cls }));
    if (shape === 'vline') svg.append(s('path', { d: 'M9 0v12', class: cls }));
    return h('span', {}, svg, label);
  };
  const rows: Child[][] = [];
  for (const l of lifts) {
    rows.push([h('b', {}, `${clean(l.name)} (${l.unit})`), '', '', '', '']);
    for (const p of l.sets) rows.push([fmt.wd(p.date), [`${fmt.w(p.weight, p.unit)} × ${p.reps}`, p.logged.unit !== p.unit ? h('span', { class: 'pv-faint' }, ` (logged ${fmt.w(p.logged.weight, p.logged.unit)})`) : null], p.e1rm !== null ? p.e1rm.toFixed(1) : '–', p.best !== null ? p.best.toFixed(1) : '–', h('span', { class: 'pv-faint' }, [!p.used && 'Left out (before the unit flag)', p.used && p.e1rm === null && 'Over 10 reps: no e1RM', p.top && `Best set by e1RM (top set ${fmt.w(p.top.weight, p.unit)} × ${p.top.reps})`, p.pr && 'PR'].filter(Boolean).join(' '))]);
  }
  return h('section', { class: `pv-card pv-span-12${ctx.tables.has('strength') ? ' is-table' : ''}`, 'data-sec': 'strength' },
    head,
    h('div', { class: 'pv-chart-area' },
      h('div', { class: `pv-multiples is-${cols}` }, cells),
      h('div', { class: 'pv-chart-key' },
        key('pv-c-raw', 'dot', 'Top set e1RM'), key('pv-c-line', 'line', 'Best of the last 3'), key('pv-c-pr', 'pr', 'PR'),
        key('pv-c-band', 'box', `±${Math.round((lifts[0]!.noise?.pct ?? 0.04) * 100)} % noise band around the latest`), key('pv-c-wash', 'box', 'Light week'),
        key('pv-c-raw-out', 'dot', 'Left out by the engine'), key('pv-c-flagline', 'vline', 'Unit flag'),
      ),
    ),
    h('div', { class: 'pv-table-area' }, table([{ t: 'Date' }, { t: 'Top set' }, { t: 'e1RM', r: true }, { t: 'Best of 3', r: true }, { t: 'Note' }], rows)),
  );
}

// ================================================================ weight
function weight(m: ProgressModel, width: number, ctx: ProgressContext): HTMLElement {
  // In the body unit: every kg value of the section converted (a % band stays as it is).
  const F = bodyFmt(ctx.units);
  const U = F.w;
  const w0 = m.weight!;
  const band0 = w0.band;
  const wt = {
    ...w0,
    points: w0.points.map((p) => ({ ...p, weight: F.wv(p.weight), trend: F.wv(p.trend) })),
    rate: w0.rate ? { ...w0.rate, kgPerWeek: F.wv(w0.rate.kgPerWeek), trend: F.wv(w0.rate.trend) } : null,
    band: band0 ? (band0.unit === 'pct' ? band0 : { ...band0, lo: F.wv(band0.lo), hi: F.wv(band0.hi) }) : null,
    wedge: w0.wedge ? { ...w0.wedge, trend: F.wv(w0.wedge.trend), loPerWeek: F.wv(w0.wedge.loPerWeek), hiPerWeek: F.wv(w0.wedge.hiPerWeek) } : null,
    projection: w0.projection ? { ...w0.projection, fromTrend: F.wv(w0.projection.fromTrend), toTrend: F.wv(w0.projection.toTrend) } : null,
    goal: { ...w0.goal, weight: w0.goal.weight === null ? null : F.wv(w0.goal.weight) },
  };
  const pts = wt.points;
  const since = wt.since ?? pts[0]?.date ?? m.date;
  const head = cardHead('weight', 'Weight trend', `Daily weigh-ins and the smoothed trend (EWMA, α 0.1) since ${fmt.day(since)}`, ctx);
  const tbl = table([{ t: 'Date' }, { t: `Weigh-in (${U})`, r: true }, { t: `Trend (${U})`, r: true }], [...pts].reverse().map((p) => [fmt.wd(p.date), p.weight.toFixed(1), p.trend.toFixed(2)]));
  if (pts.length < MIN_POINTS) {
    return h('section', { class: `pv-card pv-span-12${ctx.tables.has('weight') ? ' is-table' : ''}`, 'data-sec': 'weight' }, head, h('div', { class: 'pv-chart-area' }, sparse(`${pts.length} weigh-in${pts.length === 1 ? '' : 's'} since ${fmt.day(since)}: the trend starts at ${MIN_POINTS}.`)), h('div', { class: 'pv-table-area' }, tbl));
  }
  const last = pts.at(-1)!;
  const rate = wt.rate;
  const band = wt.band;
  const bandText = band ? (band.unit === 'pct' ? `${fmt.signed(band.lo * 100, 1)} to ${fmt.signed(band.hi * 100, 1).replace(/^[+−]?0\.0$/, '0')} % a week` : `${fmt.signed(band.lo)} to ${fmt.signed(band.hi)} ${U} a week`) : '';
  const stStatus = band?.status === 'in' ? 'in' : 'below';
  const stats = h('div', { class: 'pv-stats' },
    h('div', {}, h('div', { class: 'pv-stat-v' }, fmt.num(last.trend), h('small', {}, U)), h('div', { class: 'pv-stat-l' }, `Trend, ${fmt.day(last.date)}`)),
    rate ? h('div', {}, h('div', { class: 'pv-stat-v' }, fmt.signed(rate.kgPerWeek), h('small', {}, `${U} a week`)), h('div', { class: 'pv-stat-l' }, `Slope over the last ${rate.spanDays} days`)) : h('div', {}, h('div', { class: 'pv-stat-v' }, '–'), h('div', { class: 'pv-stat-l' }, clean(wt.rateNote ?? 'No rate yet'))),
    rate ? h('div', {}, h('div', { class: 'pv-stat-v' }, fmt.signed(rate.pctPerWeek * 100), h('small', {}, '% a week')), h('div', { class: 'pv-stat-l' }, band ? statusChip(stStatus, band.status === 'in' ? 'In the goal band' : band.status === 'below' ? 'Faster than the band' : 'Slower than the band') : 'No goal band')) : null,
    h('div', {}, h('div', { class: 'pv-stat-v is-quiet' }, wt.goal.date ? fmt.day(wt.goal.date) : 'No goal date'), h('div', { class: 'pv-stat-l' }, wt.goal.date ? `${wt.goal.weight === null ? '' : fmt.num(wt.goal.weight)} ${U} at this rate` : 'No goal weight in the profile')),
  );
  const W = width - 46;
  const H = 230;
  const mg = { l: 40, r: 16, t: 14, b: 22 };
  const end = wt.projection?.to ?? last.date;
  const wedgeAt = (d: string, perWeek: number) => (wt.wedge ? wt.wedge.trend + perWeek * (daysBetween(wt.wedge.from, d) / 7) : 0);
  const vals = pts.flatMap((p) => [p.weight, p.trend]);
  if (wt.projection) vals.push(wt.projection.toTrend);
  if (wt.wedge) vals.push(wedgeAt(end, wt.wedge.loPerWeek), wedgeAt(end, wt.wedge.hiPerWeek));
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 || 0.5;
  lo -= pad;
  hi += pad;
  const x = (d: string) => scale(ms(pts[0]!.date), ms(end), mg.l, W - mg.r)(ms(d));
  const y = scale(lo, hi, H - mg.b, mg.t);
  const svg = s('svg', { class: 'pv-chart', width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  for (const t of niceTicks(lo, hi, 4)) svg.append(s('line', { class: 'pv-grid', x1: mg.l, x2: W - mg.r, y1: y(t), y2: y(t) }), s('text', { class: 'pv-ax end', x: mg.l - 6, y: y(t) + 3 }, t.toFixed(1)));
  const span = daysBetween(pts[0]!.date, end);
  const step = Math.max(7, Math.ceil(span / 5 / 7) * 7);
  for (let d = pts[0]!.date; d <= end; d = addDays(d, step)) svg.append(s('text', { class: 'pv-ax mid', x: x(d), y: H - 6 }, fmt.day(d)));
  svg.append(s('line', { class: 'pv-base', x1: mg.l, x2: W - mg.r, y1: H - mg.b, y2: H - mg.b }));
  if (wt.projection) svg.append(s('line', { class: 'pv-c-threshold', x1: x(last.date), x2: x(last.date), y1: mg.t, y2: H - mg.b }), s('text', { class: 'pv-c-label', x: x(last.date) + 6, y: mg.t + 10 }, 'Next 3 weeks'));
  if (wt.wedge) {
    const a: [number, number] = [x(wt.wedge.from), y(wt.wedge.trend)];
    const b: [number, number] = [x(end), y(wedgeAt(end, wt.wedge.hiPerWeek))];
    const c: [number, number] = [x(end), y(wedgeAt(end, wt.wedge.loPerWeek))];
    svg.append(s('path', { class: 'pv-c-wedge', d: `${path([a, b, c])}Z` }), s('path', { class: 'pv-c-wedge-edge', d: path([a, b]) }), s('path', { class: 'pv-c-wedge-edge', d: path([a, c]) }));
    if (band?.unit === 'pct') {
      svg.append(
        s('text', { class: 'pv-c-label', x: x(end) - 6, y: b[1] - 6, 'text-anchor': 'end' }, `${fmt.signed(band.hi * 100, 1).replace(/^[+−]?0\.0$/, '0')} % a week`),
        s('text', { class: 'pv-c-label', x: x(end) - 6, y: c[1] + 13, 'text-anchor': 'end' }, `${fmt.signed(band.lo * 100, 1)} % a week`),
      );
    }
  }
  for (const p of pts) svg.append(s('circle', { class: 'pv-c-raw', cx: x(p.date), cy: y(p.weight), r: 2.6 }));
  svg.append(s('path', { class: 'pv-c-line', d: path(pts.map((p) => [x(p.date), y(p.trend)])) }));
  if (wt.projection) svg.append(s('path', { class: 'pv-c-proj', d: path([[x(wt.projection.from), y(wt.projection.fromTrend)], [x(wt.projection.to), y(wt.projection.toTrend)]]) }));
  svg.append(s('circle', { class: 'pv-c-end', cx: x(last.date), cy: y(last.trend), r: 4.5 }), s('text', { class: 'pv-c-label strong', x: x(last.date) - 8, y: y(last.trend) - 10, 'text-anchor': 'end' }, `${fmt.num(last.trend)} ${U}`));
  const hit = s('rect', { class: 'pv-c-hit', x: mg.l, y: mg.t, width: Math.max(10, x(last.date) - mg.l), height: H - mg.b - mg.t });
  svg.append(hit);
  hover(hit, svg, pts, x, (p) => y(p.trend), (p) => tip(fmt.wd(p.date), `Weigh-in ${p.weight.toFixed(1)} ${U}`, `Trend ${p.trend.toFixed(2)} ${U}`));
  const keyItem = (cls: string, shape: string, label: string) => {
    const k = s('svg', { viewBox: '0 0 18 12' });
    if (shape === 'dot') k.append(s('circle', { cx: 9, cy: 6, r: 2.6, class: cls }));
    if (shape === 'line') k.append(s('path', { d: 'M1 6h16', class: cls }));
    if (shape === 'wedge') k.append(s('path', { d: 'M1 10L17 2v9z', class: cls }));
    return h('span', {}, k, label);
  };
  return h('section', { class: `pv-card pv-span-12${ctx.tables.has('weight') ? ' is-table' : ''}`, 'data-sec': 'weight' },
    head,
    h('div', { class: 'pv-chart-area' }, stats, svg,
      h('div', { class: 'pv-chart-key' }, keyItem('pv-c-raw', 'dot', 'Weigh-in'), keyItem('pv-c-line', 'line', 'Trend'), wt.projection ? keyItem('pv-c-proj', 'line', 'At the current rate') : null, band ? keyItem('pv-c-wedge', 'wedge', `Goal pace: ${bandText}, from the ${clean(band.source)}`) : null),
    ),
    h('div', { class: 'pv-table-area' }, tbl),
  );
}

// ================================================================ the page
/** A vault with no plan yet (a first run): the plain lead that stands for "No plan found (…plan-data.json)". */
export const FIRST_RUN_NOTE = 'Nothing to chart yet: Progress fills in as you train. Start from the welcome card on Today: set up the coach, run the intake, then get your plan.';

/** The notes, the first run's in plain words. */
export const firstRunNotes = <T extends { code: string; text: string }>(notes: readonly T[]): T[] => notes.map((n) => (n.code === 'no-plan' ? { ...n, text: FIRST_RUN_NOTE } : n));

function calmNotes(m: ProgressModel): HTMLElement | null {
  const notes = firstRunNotes(m.notes);
  return notes.length ? h('div', { class: 'pv-notes' }, notes.map((n) => h('div', { class: 'pv-note' }, icon('info'), h('span', {}, n.text)))) : null;
}

/** Builds the whole Progress screen into `root` (its children are replaced); `root` must be in the page, for its width. */
/**
 * Builds the Progress screen into `root`. `opts.nav` sits under the title (the
 * section nav); `opts.section` draws another section's cards in place of the
 * five Overview cards.
 */
// ================================================================ banner
type TapeMeasure = ReturnType<typeof tapeTrends>['measures'][number];

/** What the Progress banner needs besides the report: the phase's look and name, and the cycle's waist (the Body section's tape). */
export interface ProgressHero {
  phase: BannerPhase;
  phaseOf: { index: number; name: string } | null;
  waist: TapeMeasure | null;
  /** The body units (the context's, when drawn by renderProgress). */
  units?: BodyUnits;
}

/** Today's banner: the ring is strength, one segment per logged lift, lit when its e1RM is up more than 2 % since its first session. */
function hero(m: ProgressModel, o: ProgressHero): HTMLElement {
  const st = strengthChange(m.lifts);
  const segs: RingSeg[] = st.lifts.map((l) => ({
    kind: l.up ? 'lift' : 'empty',
    tip: tip(l.name, l.change !== null
      ? `e1RM ${Math.round(l.first!)} to ${Math.round(l.last!)} ${l.unit}, ${fmt.signed(l.change * 100, 0)} %`
      : l.unitFlag ? `Check units: ${l.sessions} qualifying session${l.sessions === 1 ? '' : 's'} since the unit flag, not in the average` : `${l.sessions} qualifying session${l.sessions === 1 ? '' : 's'}: no change yet, not in the average`),
  }));
  const mean = st.mean;
  const rate = m.weight?.rate ?? null;
  const latest = m.weight?.points.at(-1) ?? null;
  const w = o.waist;
  // The body unit: the weight converted, the waist (stored in cm) in cm or inches.
  const F = bodyFmt(o.units);
  const wUnit = F.l;
  const L = (cm: number) => F.len(cm);
  const a = m.calendar?.adherence ?? null;
  const first = m.calendar?.firstEntry ?? null;
  const weeks = weeksLogged(first, m.date);
  return banner({
    phase: o.phase,
    kicker: bannerKicker(m.week?.planWeek, o.phaseOf, m.week?.phase),
    title: 'Progress',
    sub: `Through ${fmt.dayLong(m.date)}${first ? ` · ${weeks} week${weeks === 1 ? '' : 's'} logged since ${fmt.day(first)}` : ''}`,
    chips: [
      rate ? { icon: 'trend', label: 'Weight trend', value: `${F.wv(rate.trend).toFixed(1)} ${F.w}, ${fmt.signed(F.wv(rate.kgPerWeek), 2)} a week`, tip: tip('Weight trend', latest && `${F.wv(rate.trend).toFixed(2)} ${F.w} through ${fmt.day(latest.date)}`, `Slope over ${rate.spanDays} days, ${rate.weighIns} weigh-ins`) }
        : latest ? { icon: 'trend', label: 'Weight trend', value: `${F.wv(latest.trend).toFixed(1)} ${F.w}`, tip: tip('Weight trend', `${F.wv(latest.trend).toFixed(2)} ${F.w} through ${fmt.day(latest.date)}`, 'Too few weigh-ins for a slope yet') } : null,
      w && w.last ? (w.change !== null && w.first
        ? { icon: 'tape', label: 'Waist', value: `${fmt.signed(F.lv(w.change), 1)} ${wUnit}`, tip: tip('Waist', `${L(w.first.value)} ${wUnit} on ${fmt.day(w.first.date)}`, `${L(w.last.value)} ${wUnit} on ${fmt.day(w.last.date)}`) }
        : { icon: 'tape', label: 'Waist', value: `${L(w.last.value)} ${wUnit}`, tip: tip('Waist', `${L(w.last.value)} ${wUnit} on ${fmt.day(w.last.date)}`, 'One tape day so far: the change needs a second') }) : null,
      a ? { sw: 'lift', label: 'Lifting', value: `${a.lifting.done} of ${a.lifting.planned}`, tip: tip('Lifting sessions', `${a.lifting.done} of ${a.lifting.planned} planned, ${fullWeeksText(m)}`) } : null,
      a ? { sw: 'short', label: 'Short', value: `${a.short.done} of ${a.short.planned}`, tip: tip('Short sessions', `${a.short.done} of ${a.short.planned} planned, ${fullWeeksText(m)}`, SHORT) } : null,
    ],
    ring: {
      segs: segs.length ? segs : [{ kind: 'empty', tip: tip('Strength', 'No logged lifts yet') }],
      n: mean === null ? '–' : `${fmt.signed(mean * 100, 0)}%`,
      label: 'STRENGTH',
      aria: mean === null ? 'Strength: no e1RM change yet' : `Strength: e1RM ${fmt.signed(mean * 100, 0)} % on average across ${st.counted} lift${st.counted === 1 ? '' : 's'}`,
    },
    key: [{ kind: 'lift', label: 'e1RM up' }, { kind: 'empty', label: st.lifts.some((l) => l.down) ? 'Flat or down' : 'Flat' }],
  });
}

export function renderProgress(root: HTMLElement, m: ProgressModel, ctx: ProgressContext, opts: { hero: ProgressHero; nav?: HTMLElement; section?: (grid: HTMLElement, total: number) => void }): void {
  root.replaceChildren();
  root.append(hero(m, { ...opts.hero, ...(ctx.units ? { units: ctx.units } : {}) }));
  if (opts.nav) root.append(opts.nav);
  if (opts.section) {
    const grid = h('div', { class: 'pv-prog-grid' });
    root.append(grid);
    opts.section(grid, grid.clientWidth || root.clientWidth || 1000);
    return;
  }
  const notes = calmNotes(m);
  if (notes) root.append(notes);
  if (!m.volume || !m.readiness || !m.calendar || !m.weight) return;
  const grid = h('div', { class: 'pv-prog-grid' });
  root.append(grid);
  const total = grid.clientWidth || root.clientWidth || 1000;
  const narrow = total < 760;
  const gap = 18;
  const col = (total - 11 * gap) / 12;
  const w5 = narrow ? total : col * 5 + gap * 4;
  grid.append(
    bodyMap(m, ctx),
    h('div', { class: 'pv-span-5 pv-stack' }, readiness(m, w5, ctx), consistency(m, w5, ctx)),
    strength(m, total, ctx),
    weight(m, total, ctx),
  );
}
