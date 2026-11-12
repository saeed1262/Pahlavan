// The rest of Progress, behind the section nav: Training, Body, Health and
// Skills, as signed off in mockups/progress.html. Every number comes from
// the engine's buildProgressMore; this module lays it out. Photos are the
// vault's own images (through Obsidian's resource paths); the preview, which
// has none, draws the body-map outline in their place. Standard DOM only.

import { bodyFmt, type BodyUnits } from './units.ts';
import type { Scope } from '../../../src/core/cycle.ts';
import type { ScopeInfo } from '../../../src/report/cycle.ts';
import type { buildProgressMore } from '../../../src/report/progress-more.ts';
import { READINESS } from '../../../src/core/readiness.ts';
import { guideName, guidePanel } from './guide.ts';
import { BODY } from './body-map.ts';
import { h, icon, s, type Child } from './dom.ts';
import { clean, fmt } from './format.ts';
import { cardHead, niceTicks, path, scale, statusChip, table, tip, type ProgressContext } from './progress.ts';
import { firstRunNotes } from './progress.ts';

export type MoreModel = ReturnType<typeof buildProgressMore>;
type Training = NonNullable<MoreModel['training']>;
type BodyM = NonNullable<MoreModel['body']>;
type Health = NonNullable<MoreModel['health']>;
type Skills = NonNullable<MoreModel['skills']>;

export type ProgressSection = 'overview' | 'training' | 'body' | 'health' | 'skills' | 'habits';
export const SECTIONS: readonly [ProgressSection, string][] = [['overview', 'Overview'], ['training', 'Training'], ['body', 'Body'], ['health', 'Health'], ['skills', 'Skills'], ['habits', 'Habits']];

/** A photo set's files by pose ("front": path), found in its folder. */
export type PhotoFiles = Record<string, Record<string, string>>;

export interface MoreContext extends ProgressContext {
  sessionsView: 'weeks' | 'months';
  onSessionsView: (v: 'weeks' | 'months') => void;
  health: 'rhr' | 'sleep' | 'steps';
  onHealth: (k: 'rhr' | 'sleep' | 'steps') => void;
  photo: { a: string | null; b: string | null; pose: string; mode: 'side' | 'slider' | 'overlay'; pos: number; opacity: number };
  onPhoto: () => void;
  photoFiles: PhotoFiles;
  /** The image's URL for a vault path (null in the preview: placeholder figures). */
  resourcePath: ((p: string) => string) | null;
  /** A ladder's level written to the log (▲, ▼, Move to level N); `start`: Log this level, the plan's start as the first logged level. */
  onMoveLadder?: (id: string, level: number, how?: 'start') => void;
  /** The movement guide for a ladder level, and which are open. */
  guide?(name: string): import('../../../src/report/dashboard.ts').GuideEntry[];
  openGuides?: Set<string>;
  onToggleGuide?: (key: string) => void;
}

const inner = (w: number) => w - 46;
const signed = (v: number, dp = 1) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(dp);
const hm = (x: number) => `${Math.floor(x)}:${String(Math.round((x % 1) * 60)).padStart(2, '0')}`;
const thousands = (v: number) => Math.round(v).toLocaleString('en-GB');
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const notesFor = (m: MoreModel, section: string) => m.notes.filter((n) => n.section === section || n.section === 'all');
const card = (id: string, span: string, ctx: ProgressContext, head: HTMLElement, chart: Child, tbl: Child) =>
  h('section', { class: `pv-card ${span}${ctx.tables.has(id) ? ' is-table' : ''}`, 'data-sec': id }, head, h('div', { class: 'pv-chart-area' }, chart), h('div', { class: 'pv-table-area' }, tbl));
const calm = (text: string) => h('p', { class: 'pv-calm' }, icon('info'), text);
const key = (...items: Child[]) => h('div', { class: 'pv-chart-key' }, items);
const keyItem = (mark: SVGElement | HTMLElement, label: string) => h('span', {}, mark, label);
const sw = (cls: string, shape: 'rect' | 'circle' | 'line' = 'rect') => s('svg', { viewBox: '0 0 18 12' }, shape === 'rect' ? s('rect', { class: cls, x: 2, y: 1, width: 14, height: 10, rx: 2 }) : shape === 'circle' ? s('circle', { class: cls, cx: 9, cy: 6, r: 4 }) : s('line', { class: cls, x1: 0, x2: 18, y1: 6, y2: 6 }));

// ================================================================ the nav
/** The open view's range, for the switch beside the nav: this cycle (from its start) or all. */
export interface RangeSwitch {
  scope: Scope;
  cycle: ScopeInfo;
  onScope: (next: Scope) => void;
}

/** What a range covers, in words: "This cycle, since 2 Nov", "All, earlier cycles too". */
export function rangeText(scope: Scope, cycle: Pick<ScopeInfo, 'start' | 'source'>): string {
  if (!cycle.start) return 'All data, no cycle start yet';
  return scope === 'cycle' ? `This cycle, since ${fmt.day(cycle.start)}` : 'All, earlier cycles too';
}

function rangeSwitch(current: ProgressSection, r: RangeSwitch): HTMLElement {
  const c = r.cycle;
  if (current === 'habits') return h('div', { class: 'pv-range', 'data-k': 'range' }, h('span', { class: 'pv-range-t', 'data-tip': tip('Habits', 'Each item counts from its own start; a linked habit’s earlier ticks are not counted') }, icon('info'), 'From each item’s start'));
  const label = h('span', { class: 'pv-range-t', 'data-tip': tip(c.start ? 'This cycle' : 'All data', c.reason.note ?? null, c.start ? 'All shows the earlier data too; nothing is deleted' : null) }, icon('calendar'), rangeText(r.scope, c));
  if (!c.start) return h('div', { class: 'pv-range', 'data-k': 'range' }, label);
  const btn = (k: Scope, text: string) => h('button', { class: r.scope === k ? 'is-on' : '', 'aria-pressed': r.scope === k ? 'true' : 'false', onclick: () => r.scope !== k && r.onScope(k), 'data-k': `range-${k}` }, text);
  return h('div', { class: 'pv-range', 'data-k': 'range' }, label, h('div', { class: 'pv-seg pv-range-seg', role: 'group', 'aria-label': 'Range' }, btn('cycle', 'This cycle'), btn('all', 'All')));
}

export function sectionNav(current: ProgressSection, m: MoreModel | null, onSection: (s: ProgressSection) => void, range?: RangeSwitch): HTMLElement {
  const fresh = m?.training?.lifts.some((l) => l.records.isNew) ?? false;
  return h('nav', { class: 'pv-sec-nav', 'aria-label': 'Progress sections' },
    SECTIONS.map(([k, l]) => h('button', { class: current === k ? 'is-on' : '', 'aria-current': current === k ? 'page' : 'false', onclick: () => onSection(k) }, l, k === 'training' && fresh ? h('i', { class: 'pv-sec-dot', 'aria-label': 'a record in the last 14 days' }) : null)),
    range ? rangeSwitch(current, range) : null);
}

// ================================================================ training
function records(t: Training, width: number, ctx: MoreContext): HTMLElement {
  const narrow = width < 640;
  const W = narrow ? inner(width) : Math.max(120, Math.min(260, inner(width) - 470));
  const start = t.lifts.flatMap((l) => l.records.sets.map((x) => x.date)).sort()[0];
  const end = t.lifts.flatMap((l) => l.records.sets.map((x) => x.date)).sort().at(-1);
  const x = start && end ? scale(ms(start), ms(end), 6, W - 6) : null;
  const rows = t.lifts.map((l) => {
    const r = l.records;
    if (!r.best) return h('div', { class: 'pv-rec-row' }, h('div', { class: 'pv-rec-name' }, l.name), h('div', { class: 'pv-faint' }, 'No counted top set yet'));
    const ms_ = r.milestones!;
    const strip = x ? s('svg', { class: 'pv-chart pv-rec-strip', viewBox: `0 0 ${W} 26`, style: `width:${W}px;height:26px`, role: 'img', 'aria-label': `Top sets of ${l.name}, records filled` },
      s('line', { class: 'pv-base', x1: 0, x2: W, y1: 13, y2: 13 }),
      r.sets.map((st) => s('circle', { class: st.record ? 'pv-rec-pr' : st.used === false ? 'pv-rec-out' : 'pv-rec-set', cx: x(ms(st.date)).toFixed(1), cy: 13, r: st.record ? 5 : 3.2, 'data-tip': tip(fmt.wd(st.date), `Top set ${fmt.w(st.weight, l.unit)} × ${st.reps}`, st.e1rm !== null ? `e1RM ${fmt.num(st.e1rm)} ${l.unit}` : null, st.record ? 'A record: beats every earlier set' : st.used === false ? 'Left out: before the unit check' : null) })),
    ) : null;
    return h('div', { class: 'pv-rec-row' },
      h('div', { class: 'pv-rec-name' }, l.name, h('div', { class: 'pv-rec-sub' }, `${r.sets.length} sets · ${r.records.length} record${r.records.length === 1 ? '' : 's'}`)),
      h('div', { class: 'pv-rec-best' }, h('div', { class: 'pv-rec-best-top' }, h('b', {}, `${fmt.w(r.best.weight, l.unit)} × ${r.best.reps}`), r.isNew ? h('span', { class: 'pv-rec-new' }, 'New') : null), h('div', { class: 'pv-rec-sub' }, fmt.wd(r.best.date)), r.bestE1rm ? h('div', { class: 'pv-rec-sub' }, `best e1RM ${fmt.num(r.bestE1rm.value)} ${l.unit}`) : null),
      h('div', { class: 'pv-rec-ms', 'data-tip': tip('Milestones', `Round numbers by ${fmt.num(ms_.step)} ${l.unit}`, l.stepFromPlan ? 'The lift’s step in plan-data' : 'No step in plan-data: 10 lb or 5 kg') }, ms_.done.map((v) => h('span', { class: 'pv-ms is-done' }, icon('check'), String(v))), h('span', { class: 'pv-ms is-next' }, `${ms_.next} next · ${fmt.num(ms_.toGo)} ${l.unit} to go`)),
      h('div', { class: 'pv-rec-tl' }, strip),
    );
  });
  const rowsT = t.lifts.flatMap((l) => l.records.sets.map((st) => [l.name, fmt.wd(st.date), `${fmt.w(st.weight, l.unit)} × ${st.reps}`, st.e1rm !== null ? `${fmt.num(st.e1rm)} ${l.unit}` : '–', st.record ? 'Record' : st.used === false ? 'Left out' : ''] as Child[]));
  return card('records', 'pv-span-7', ctx, cardHead('records', 'Records and milestones', 'Each lift’s best top set: heavier, or the same weight for more reps', ctx),
    t.lifts.length ? [h('div', { class: 'pv-rec' }, rows), key(keyItem(sw('pv-rec-set', 'circle'), 'Top set'), keyItem(sw('pv-rec-pr', 'circle'), 'Record'), keyItem(h('span', { class: 'pv-ms is-done' }, icon('check'), '60'), 'Round number reached'), keyItem(h('span', { class: 'pv-ms is-next' }, '65 next'), 'The next, by the lift’s step'))] : calm('No logged top sets yet: records start with the first logged lift.'),
    table([{ t: 'Lift' }, { t: 'Date' }, { t: 'Top set', r: true }, { t: 'e1RM', r: true }, { t: '' }], rowsT));
}

// Every lift: each name on its own line (the card is the narrow column, so
// "Barbell bench press" never breaks), the last set under it, the spark and
// the change at the right across both lines; the key at the foot says what
// the change column's marks mean, with no numbers that could read as data.
function everyLift(t: Training, ctx: MoreContext): HTMLElement {
  const W = 104;
  const H = 30;
  const rows = t.lifts.map((l) => {
    const pts = l.points;
    const last = pts.at(-1);
    const ch = l.change;
    const cls = ch.change === null || !ch.called ? 'is-flat' : ch.change > 0 ? 'is-up' : 'is-down';
    let spark: Child = null;
    if (pts.length >= 2) {
      const ys = pts.map((p) => p.e1rm);
      const x = scale(ms(pts[0]!.date), ms(pts.at(-1)!.date), 3, W - 3);
      const y = scale(Math.min(...ys), Math.max(...ys), H - 4, 4);
      const xy = pts.map((p) => [x(ms(p.date)), y(p.e1rm)] as [number, number]);
      spark = s('svg', { class: 'pv-chart pv-ev-spark', viewBox: `0 0 ${W} ${H}`, style: `width:${W}px;height:${H}px`, role: 'img', 'aria-label': `e1RM of ${l.name}` }, s('path', { class: 'pv-c-line', d: path(xy) }), xy.map((p, i) => s('circle', { class: i === xy.length - 1 ? 'pv-c-end' : 'pv-ev-dot', cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: i === xy.length - 1 ? 3 : 2.2, 'data-tip': tip(fmt.wd(pts[i]!.date), `Top set ${fmt.w(pts[i]!.weight, l.unit)} × ${pts[i]!.reps}`, `e1RM ${fmt.num(pts[i]!.e1rm)} ${l.unit}`) })));
    }
    return h('div', { class: 'pv-ev-row' },
      h('div', { class: 'pv-ev-name' }, l.name),
      h('div', { class: 'pv-ev-last' }, last ? [h('b', {}, `${fmt.w(last.weight, l.unit)} × ${last.reps}`), h('span', { class: 'pv-faint' }, ` · ${fmt.wd(last.date)}`)] : h('span', { class: 'pv-faint' }, 'No counted set')),
      spark ?? h('span', {}),
      h('div', { class: `pv-ev-d ${cls}`, 'data-tip': ch.change === null ? tip('Too few sets', `${ch.sets} after the calibration week`, 'The change needs two') : tip('e1RM change', `${signed(ch.change, 1)} ${l.unit} over ${ch.sets} sets after week 1`, ch.called ? '' : 'Not called yet: three sets needed') }, ch.change === null ? '–' : `${signed(ch.change, 0)} ${l.unit}`),
    );
  });
  const notLogged = t.notLogged.map((n) => h('div', { class: 'pv-ev-row' }, h('div', { class: 'pv-ev-name' }, n), h('div', { class: 'pv-ev-last pv-faint' }, 'Not logged yet'), h('span', {}), h('div', { class: 'pv-ev-d is-flat' }, '–')));
  return card('every', 'pv-span-5', ctx, cardHead('every', 'Every lift', 'Estimated 1RM per session; the change counts from after the calibration week', ctx),
    [h('div', { class: 'pv-ev' }, rows, notLogged), key(
      h('span', { class: 'pv-key-title' }, 'The change since week 1'),
      keyItem(h('span', { class: 'pv-ev-k is-up', 'aria-hidden': 'true' }, '↑'), 'up over 3 or more sets'),
      keyItem(h('span', { class: 'pv-ev-k is-down', 'aria-hidden': 'true' }, '↓'), 'down over 3 or more sets'),
      keyItem(h('span', { class: 'pv-ev-k is-flat', 'aria-hidden': 'true' }, '±'), 'no arrow: under 3 sets, not called yet'),
      keyItem(h('span', { class: 'pv-ev-k is-flat', 'aria-hidden': 'true' }, '–'), 'nothing to compare yet'),
    )],
    table([{ t: 'Lift' }, { t: 'Sets', r: true }, { t: 'e1RM, first to last', r: true }, { t: 'Change after week 1', r: true }], t.lifts.map((l) => [l.name, String(l.points.length), l.points.length ? `${fmt.num(l.points[0]!.e1rm)} → ${fmt.num(l.points.at(-1)!.e1rm)} ${l.unit}` : '–', l.change.change === null ? '–' : `${signed(l.change.change)} ${l.unit}`])));
}

function sessions(t: Training, width: number, ctx: MoreContext): HTMLElement {
  const weeks = ctx.sessionsView === 'weeks';
  const W = inner(width);
  const H = 210;
  const m = { l: 30, r: 10, t: 16, b: 40 };
  const target = t.target.lift + t.target.short;
  const data = (weeks ? t.weeks : t.months) as (Training['months'][number] & { n?: number; deload?: boolean })[];
  const totalOf = (d: (typeof data)[number]) => d.total + (weeks ? 0 : d.unlogged);
  const max = Math.max(target + 1, ...data.map(totalOf)) + (weeks ? 0 : 2);
  const y = scale(0, max, H - m.b, m.t);
  const bw = (W - m.l - m.r) / Math.max(1, data.length);
  const out: Child[] = [];
  for (const v of niceTicks(0, max, 4)) out.push(s('line', { class: 'pv-grid', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }), s('text', { class: 'pv-ax end', x: m.l - 6, y: y(v) + 3 }, String(v)));
  data.forEach((d, i) => {
    const x0 = m.l + i * bw + bw * 0.2;
    const w = bw * 0.6;
    if (d.future) out.push(s('rect', { class: 'pv-ss-future', x: x0, y: y(target), width: w, height: y(0) - y(target), rx: 3 }));
    else {
      let acc = 0;
      for (const [k, v] of [['lift', d.lift], ['short', d.short], ['custom', d.custom], ['unlogged', weeks ? 0 : d.unlogged]] as const) {
        if (!v) continue;
        out.push(s('rect', { class: `pv-ss-${k}${d.current ? ' is-now' : ''}`, x: x0, y: y(acc + v), width: w, height: Math.max(1, y(acc) - y(acc + v) - 1), rx: 2 }));
        acc += v;
      }
      if (totalOf(d)) out.push(s('text', { class: 'pv-c-label strong', 'text-anchor': 'middle', x: x0 + w / 2, y: y(totalOf(d)) - 5 }, String(totalOf(d))));
    }
    const label = weeks ? d.key : fmt.month(d.from);
    const sub = weeks ? (d.deload ? 'light' : fmt.day(d.from)) : d.from.slice(0, 4);
    const title = weeks ? `Week ${d.n} · ${fmt.day(d.from)} to ${fmt.day(d.to)}` : `${fmt.month(d.from)} ${d.from.slice(0, 4)}`;
    out.push(s('rect', { class: 'pv-c-hit', x: m.l + i * bw, y: m.t, width: bw, height: H - m.t - 6, 'data-tip': tip(title, weeks ? `Lifting ${d.lift} of ${t.target.lift}` : `Lifting ${d.lift}`, weeks ? `Short ${d.short} of ${t.target.short}` : `Short ${d.short}`, `Other ${d.custom}`, !weeks && d.unlogged ? `Trained, type not logged ${d.unlogged}` : null, d.future ? 'To come' : d.current ? 'So far' : weeks && d.deload ? 'Light week' : null) }));
    out.push(s('text', { class: `pv-ax mid${d.current ? ' is-now' : ''}`, x: x0 + w / 2, y: H - m.b + 15 }, label), s('text', { class: 'pv-ax mid', x: x0 + w / 2, y: H - m.b + 27 }, sub));
  });
  if (weeks) out.push(s('line', { class: 'pv-ss-target', x1: m.l, x2: W - m.r, y1: y(target), y2: y(target) }), s('text', { class: 'pv-c-label', x: W - m.r, y: y(target) - 5, 'text-anchor': 'end' }, `target ${target}`));
  const done = t.weeks.filter((d) => !d.future && !d.current);
  const met = done.filter((d) => d.lift >= t.target.lift && d.short >= t.target.short).length;
  const cur = t.weeks.find((d) => d.current);
  const stats = weeks
    ? h('div', { class: 'pv-stats' }, h('div', {}, h('div', { class: 'pv-stat-v' }, String(met), h('small', {}, `of ${done.length}`)), h('div', { class: 'pv-stat-l' }, `full weeks on plan (${t.target.lift} lifting, ${t.target.short} short)`)), cur ? h('div', {}, h('div', { class: 'pv-stat-v' }, String(cur.total), h('small', {}, 'so far')), h('div', { class: 'pv-stat-l' }, `this week, ${cur.key}`)) : null, h('div', {}, h('div', { class: 'pv-stat-v' }, String(t.months.at(-1)?.total ?? 0)), h('div', { class: 'pv-stat-l' }, `sessions in ${fmt.month(t.months.at(-1)?.from ?? '2026-01-01')}`)))
    : h('div', { class: 'pv-stats' }, h('div', {}, h('div', { class: 'pv-stat-v' }, String(t.months.reduce((a, d) => a + d.total, 0))), h('div', { class: 'pv-stat-l' }, 'sessions in six months')), h('div', {}, h('div', { class: 'pv-stat-v' }, String(t.months.reduce((a, d) => a + d.unlogged, 0))), h('div', { class: 'pv-stat-l' }, 'days ticked with no session logged')));
  const seg = h('div', { class: 'pv-seg' }, (['weeks', 'months'] as const).map((k) => h('button', { class: ctx.sessionsView === k ? 'is-on' : '', onclick: () => ctx.onSessionsView(k) }, k === 'weeks' ? 'Weeks' : 'Months')));
  const chart = data.length ? [stats, s('svg', { class: 'pv-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Sessions per ${weeks ? 'week' : 'month'} by kind` }, out),
    key(keyItem(sw('pv-ss-lift'), 'Lifting'), keyItem(sw('pv-ss-short'), 'Short'), keyItem(sw('pv-ss-custom'), 'Other (a run, a class)'), weeks ? keyItem(sw('pv-ss-future'), 'To come') : keyItem(sw('pv-ss-unlogged'), 'Trained, type not logged'), weeks ? keyItem(sw('pv-ss-target', 'line'), 'Target') : null)] : calm('No plan weeks yet: they start with the first logged plan session.');
  return card('sessions', 'pv-span-7', ctx, cardHead('sessions', 'Sessions', weeks ? 'This phase’s eight weeks: lifting, short and other sessions against the week’s target' : 'Six months; days with the Workout tick but no session logged count separately', ctx, seg), chart,
    table([{ t: weeks ? 'Week' : 'Month' }, { t: 'Lifting', r: true }, { t: 'Short', r: true }, { t: 'Other', r: true }, ...(weeks ? [] : [{ t: 'Ticked, no log', r: true }]), { t: 'Total', r: true }], data.map((d) => [weeks ? `${d.key} · ${fmt.day(d.from)}` : `${fmt.month(d.from)} ${d.from.slice(0, 4)}`, d.future ? '–' : String(d.lift), d.future ? '–' : String(d.short), d.future ? '–' : String(d.custom), ...(weeks ? [] : [String(d.unlogged)]), d.future ? '–' : String(d.total)])));
}

function cardio(t: Training, width: number, ctx: MoreContext): HTMLElement {
  const W = inner(width);
  const H = 170;
  const m = { l: 30, r: 8, t: 14, b: 34 };
  const data = t.cardio;
  const max = Math.max(30, ...data.map((d) => d.minutes)) * 1.12;
  const y = scale(0, max, H - m.b, m.t);
  const bw = (W - m.l - m.r) / Math.max(1, data.length);
  const out: Child[] = [];
  for (const v of niceTicks(0, max, 3)) out.push(s('line', { class: 'pv-grid', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }), s('text', { class: 'pv-ax end', x: m.l - 6, y: y(v) + 3 }, String(v)));
  data.forEach((d, i) => {
    const x0 = m.l + i * bw + bw * 0.22;
    const w = bw * 0.56;
    if (d.future) out.push(s('rect', { class: 'pv-ss-future', x: x0, y: y(0) - 2, width: w, height: 2, rx: 1 }));
    else if (d.minutes) out.push(s('rect', { class: `pv-cd-bar${d.current ? ' is-now' : ''}`, x: x0, y: y(d.minutes), width: w, height: y(0) - y(d.minutes), rx: 2 }), s('text', { class: 'pv-c-label strong', 'text-anchor': 'middle', x: x0 + w / 2, y: y(d.minutes) - 5 }, String(d.minutes)));
    out.push(s('rect', { class: 'pv-c-hit', x: m.l + i * bw, y: m.t, width: bw, height: H - m.t, 'data-tip': tip(`${d.key} · ${fmt.day(d.from)}`, `${d.minutes} min in ${d.sessions} session${d.sessions === 1 ? '' : 's'}`, ...Object.entries(d.modes).map(([k, v]) => `${k}: ${v} min`), d.future ? 'To come' : d.current ? 'So far' : null) }));
    out.push(s('text', { class: `pv-ax mid${d.current ? ' is-now' : ''}`, x: x0 + w / 2, y: H - m.b + 15 }, d.key));
  });
  const full = data.filter((d) => !d.future && !d.current);
  const avg = full.length ? full.reduce((a, d) => a + d.minutes, 0) / full.length : null;
  const modes: Record<string, number> = {};
  for (const d of data) for (const [k, v] of Object.entries(d.modes)) modes[k] = (modes[k] ?? 0) + v;
  const cur = data.find((d) => d.current);
  return card('cardio', 'pv-span-5', ctx, cardHead('cardio', 'Cardio minutes', 'Logged with the sessions (finishers, runs, intervals), per plan week', ctx),
    data.length ? [
      h('div', { class: 'pv-stats' }, avg !== null ? h('div', {}, h('div', { class: 'pv-stat-v' }, String(Math.round(avg)), h('small', {}, 'min')), h('div', { class: 'pv-stat-l' }, 'a week, full weeks')) : null, cur ? h('div', {}, h('div', { class: 'pv-stat-v' }, String(cur.minutes), h('small', {}, 'min')), h('div', { class: 'pv-stat-l' }, 'this week, so far')) : null),
      s('svg', { class: 'pv-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Cardio minutes per week' }, out),
      h('div', { class: 'pv-cd-note' }, icon('info'), h('span', {}, t.activeMinutes ? `The plan’s conditioning target is ${t.activeMinutes[0]} to ${t.activeMinutes[1]} active minutes a week, walking included; logged cardio is the part done in sessions.` : 'Logged cardio is the part done in sessions.', Object.keys(modes).length ? ` By mode: ${Object.entries(modes).map(([k, v]) => `${k} ${v} min`).join(', ')}.` : '')),
    ] : calm('No plan weeks yet.'),
    table([{ t: 'Week' }, { t: 'Minutes', r: true }, { t: 'By mode' }], data.map((d) => [`${d.key} · ${fmt.day(d.from)}`, d.future ? '–' : String(d.minutes), Object.entries(d.modes).map(([k, v]) => `${k} ${v}`).join(', ')])));
}

// ================================================================ body
function tape(b: BodyM, width: number, ctx: MoreContext): HTMLElement {
  const W = inner(width);
  const narrow = width < 760;
  const waist = b.tape.measures.find((x) => x.key === 'waist');
  const others = b.tape.measures.filter((x) => x.key !== 'waist');
  const bigW = narrow || !others.length ? W : Math.round(W * 0.56);
  let big: Child = calm(b.cycleStart ? 'No tape days yet this cycle.' : 'No tape days yet.');
  if (waist && waist.points.length) {
    const H = 220;
    const m = { l: 34, r: 12, t: 14, b: 26 };
    const vs = waist.points.map((p) => p.value);
    const lo = Math.min(...vs) - 0.8;
    const hi = Math.max(...vs) + 0.8;
    const x0 = ms(waist.points[0]!.date);
    const x1 = Math.max(ms(waist.points.at(-1)!.date), x0 + 864e5 * 14);
    const x = scale(x0, x1, m.l + 8, bigW - m.r - 8);
    const y = scale(lo, hi, H - m.b, m.t);
    const out: Child[] = [];
    for (const v of niceTicks(lo, hi, 4)) out.push(s('line', { class: 'pv-grid', x1: m.l, x2: bigW - m.r, y1: y(v), y2: y(v) }), s('text', { class: 'pv-ax end', x: m.l - 6, y: y(v) + 3 }, String(v)));
    if (waist.points.length > 1) out.push(s('path', { class: 'pv-c-line', d: path(waist.points.map((p) => [x(ms(p.date)), y(p.value)] as [number, number])) }));
    waist.points.forEach((p) => out.push(s('circle', { class: 'pv-c-end', cx: x(ms(p.date)), cy: y(p.value), r: 4, 'data-tip': tip(fmt.wd(p.date), `Waist ${p.value} ${p.unit}`, waist.first ? `Since the first: ${signed(p.value - waist.first.value)} ${p.unit}` : null) })));
    out.push(s('text', { class: 'pv-ax', x: m.l, y: H - 8 }, fmt.day(waist.points[0]!.date)), s('text', { class: 'pv-ax end', x: bigW - m.r, y: H - 8 }, fmt.day(waist.points.at(-1)!.date)));
    big = s('svg', { class: 'pv-chart pv-tp-big', viewBox: `0 0 ${bigW} ${H}`, style: `width:${bigW}px`, role: 'img', 'aria-label': 'Waist over time' }, out);
  }
  const smallW = narrow ? Math.floor((W - 28) / Math.max(1, others.length)) : W - bigW - 28;
  const smalls = others.map((mm) => {
    const vs = mm.points.map((p) => p.value);
    const xs = scale(ms(mm.points[0]!.date), Math.max(ms(mm.points.at(-1)!.date), ms(mm.points[0]!.date) + 864e5), 4, smallW - 4);
    const ys = scale(Math.min(...vs) - 0.8, Math.max(...vs) + 0.8, 38, 4);
    return h('div', { class: 'pv-tp-small' },
      h('div', { class: 'pv-tp-small-head' }, h('span', {}, mm.label), h('span', {}, h('b', {}, `${mm.last!.value} ${mm.last!.unit}`), mm.change !== null ? h('span', { class: 'pv-faint' }, ` ${signed(mm.change)}`) : null)),
      s('svg', { class: 'pv-chart pv-tp-small-chart', viewBox: `0 0 ${smallW} 42`, preserveAspectRatio: 'none', role: 'img', 'aria-label': `${mm.label} over time` }, mm.points.length > 1 ? s('path', { class: 'pv-c-line is-thin', d: path(mm.points.map((p) => [xs(ms(p.date)), ys(p.value)] as [number, number])) }) : null, mm.points.map((p) => s('circle', { class: 'pv-c-end', cx: xs(ms(p.date)), cy: ys(p.value), r: 3, 'data-tip': tip(fmt.wd(p.date), `${mm.label} ${p.value} ${p.unit}`) }))),
    );
  });
  const last = waist?.last;
  const stats = waist && last ? h('div', { class: 'pv-stats' }, h('div', {}, h('div', { class: 'pv-stat-v' }, String(last.value), h('small', {}, last.unit)), h('div', { class: 'pv-stat-l' }, `waist, ${fmt.day(last.date)}`)), waist.change !== null ? h('div', {}, h('div', { class: 'pv-stat-v' }, signed(waist.change), h('small', {}, last.unit)), h('div', { class: 'pv-stat-l' }, `since ${fmt.day(waist.first!.date)}`)) : null) : null;
  const all = [...new Set(b.tape.measures.flatMap((x) => x.points.map((p) => p.date)))].sort();
  return card('tape', 'pv-span-7', ctx, cardHead('tape', 'Tape', 'Every second Sunday. Waist is the recomposition goal’s measure', ctx),
    b.tape.days ? [stats, h('div', { class: `pv-tp-grid${narrow ? ' is-narrow' : ''}` }, big, others.length ? h('div', { class: 'pv-tp-smalls' }, smalls) : null), b.tape.days === 1 ? calm('One tape day so far: the trends need a second.') : null] : calm('No tape days yet this cycle: the trends start with the first one.'),
    table([{ t: 'Date' }, ...b.tape.measures.map((x) => ({ t: x.label, r: true }))], all.map((d) => [fmt.wd(d), ...b.tape.measures.map((x) => { const p = x.points.find((q) => q.date === d); return p ? `${p.value} ${p.unit}` : '–'; })])));
}

function targets(b: BodyM, width: number, ctx: MoreContext): HTMLElement {
  const W = Math.max(160, inner(width) - 10);
  const label = { met: ['in', 'Met'], 'on-the-way': ['in', 'On the way'], 'not-yet': ['below', 'Not yet'], 'at-goal': ['in', 'At the goal'], under: ['below', 'Under'], 'no-data': ['neutral', 'No data yet'] } as const;
  const rows = b.targets.map((r) => {
    let bar: SVGElement;
    let now: string;
    let goal: string;
    if (r.kind === 'drop') {
      const x = scale(0, r.hi! * 1.15, 0, W);
      const f = Math.max(0, Math.min(r.hi! * 1.15, r.drop ?? 0));
      now = r.cur === null ? '–' : `${signed(-(r.drop ?? 0))} ${r.unit}`;
      goal = `−${r.lo} to −${r.hi} ${r.unit}`;
      bar = s('svg', { class: 'pv-chart pv-tb', viewBox: `0 0 ${W} 18`, role: 'img', 'aria-label': `${r.label}: ${now} of ${goal}` },
        s('rect', { class: 'pv-tb-track', x: 0, y: 5, width: W, height: 8, rx: 4 }),
        s('rect', { class: 'pv-tb-band', x: x(r.lo!), y: 2, width: x(r.hi!) - x(r.lo!), height: 14, rx: 3 }),
        f > 0 ? s('rect', { class: 'pv-tb-fill', x: 0, y: 5, width: x(f), height: 8, rx: 4 }) : null,
        s('rect', { class: 'pv-c-hit', x: 0, y: 0, width: W, height: 18, 'data-tip': tip(r.label, `Now ${now}`, `Target ${goal}`, r.base !== null && r.base !== undefined ? `From ${fmt.num(r.base)} to ${fmt.num(r.cur ?? r.base)} ${r.unit}` : null) }));
    } else {
      const g = r.goal!;
      const x = scale(0, g * 1.3, 0, W);
      now = r.cur === null ? '–' : r.key === 'sleep' ? `${hm(r.cur)} h` : thousands(r.cur);
      goal = r.key === 'sleep' ? `${hm(g)} h` : thousands(g);
      bar = s('svg', { class: 'pv-chart pv-tb', viewBox: `0 0 ${W} 18`, role: 'img', 'aria-label': `${r.label}: ${now} against ${goal}` },
        s('rect', { class: 'pv-tb-track', x: 0, y: 5, width: W, height: 8, rx: 4 }),
        r.cur !== null ? s('rect', { class: `pv-tb-fill${r.cur < g ? ' is-short' : ''}`, x: 0, y: 5, width: x(Math.min(r.cur, g * 1.3)), height: 8, rx: 4 }) : null,
        s('line', { class: 'pv-tb-goal', x1: x(g), x2: x(g), y1: 0, y2: 18 }),
        s('rect', { class: 'pv-c-hit', x: 0, y: 0, width: W, height: 18, 'data-tip': tip(r.label, `7-day average ${now}${r.days !== undefined && r.days < 7 ? ` (${r.days} of 7 days)` : ''}`, `Goal ${goal}`, r.source === 'plan' ? 'The plan’s steps for this phase' : r.source === 'engine' ? 'The engine’s 7 h' : 'From the profile') }));
    }
    const st = label[r.status];
    return h('div', { class: 'pv-tg2-row' }, h('div', { class: 'pv-tg2-top' }, h('b', {}, r.label), h('span', { class: 'pv-tg2-val' }, now, h('span', { class: 'pv-faint' }, ` · goal ${goal}`)), statusChip(st[0], st[1])), bar,
      h('div', { class: 'pv-tg2-note' }, r.kind === 'drop' ? 'From the cycle’s first value' : `7-day average${r.days !== undefined && r.days < 7 ? `, ${r.days} of 7 days` : ''} · ${r.source === 'plan' ? 'the plan’s steps for this phase' : r.source === 'engine' ? 'the engine’s 7 h' : 'the profile’s goal'}`));
  });
  return card('targets', 'pv-span-5', ctx, cardHead('targets', b.targetsBy ? `Targets by ${fmt.day(b.targetsBy)}` : 'Targets', `Body measures from ${b.cycleStart ? `the cycle’s start, ${fmt.day(b.cycleStart)}` : 'the first entry on record'}; watch numbers as a 7-day average`, ctx),
    [h('div', { class: 'pv-tg2' }, rows), key(keyItem(sw('pv-tb-band'), 'Target range'), keyItem(sw('pv-tb-fill'), 'So far'), keyItem(sw('pv-tb-goal', 'line'), 'Goal to hold')), b.targets.every((r) => r.kind === 'level') ? calm('No body targets in the profile yet ("targets" in Coach/profile.json): steps and sleep use the plan’s and the engine’s goals.') : null],
    table([{ t: 'Target' }, { t: 'Now', r: true }, { t: 'Goal' }, { t: 'Status' }, { t: 'Source' }], b.targets.map((r) => [r.label, r.cur === null ? '–' : r.kind === 'drop' ? `${signed(-(r.drop ?? 0))} ${r.unit}` : fmt.num(r.cur), r.kind === 'drop' ? `−${r.lo} to −${r.hi} ${r.unit}` : fmt.num(r.goal!), label[r.status][1], r.source])));
}

export const POSES: [string, string][] = [['front', 'Front'], ['side', 'Side'], ['back', 'Back'], ['posture-closeup', 'Close-up']];

/** Every photo set's date, oldest first: the index's sets and the dated folders it does not list (the keys step through these). */
export function photoSetDates(photos: readonly { date: string }[], files: PhotoFiles): string[] {
  return [...new Set([...photos.map((x) => x.date), ...Object.keys(files)])].sort();
}
function placeholder(pose: string, cls: string): SVGElement {
  if (pose === 'side') return s('svg', { class: `pv-ph-fig ${cls}`, viewBox: '0 0 120 300', 'aria-hidden': 'true' }, s('circle', { cx: 60, cy: 30, r: 17 }), s('path', { d: 'M52 50 C40 60 40 92 44 128 C46 150 48 160 47 176 L44 280 L58 282 L62 186 L66 282 L80 280 L76 176 C78 150 82 128 80 96 C79 72 74 58 66 50 Z' }));
  const side = pose === 'back' ? 'back' : 'front';
  const vb = BODY.viewBox[side].split(' ').map(Number);
  const box = pose === 'posture-closeup' ? `${vb[0]! + 190} ${vb[1]! + 60} 344 300` : BODY.viewBox[side];
  return s('svg', { class: `pv-ph-fig ${cls}`, viewBox: box, 'aria-hidden': 'true' }, s('path', { d: BODY.outline[side] }));
}
function photos(b: BodyM, ctx: MoreContext): HTMLElement {
  // The index's sets, and any dated folder with images the index does not list.
  const sets = [...b.photos.map((x) => ({ ...x, indexed: true })), ...Object.entries(ctx.photoFiles).filter(([d]) => !b.photos.some((x) => x.date === d)).map(([date, files]) => ({ date, poses: Object.keys(files), folder: `Progress Photos/${date}/`, indexed: false }))].sort((x, y) => (x.date < y.date ? -1 : 1));
  const folderOnly = sets.filter((x) => !x.indexed).length;
  const P = ctx.photo;
  const a = sets.find((x) => x.date === P.a) ?? sets[0];
  const bb = sets.find((x) => x.date === P.b) ?? sets.at(-1);
  const img = (date: string, pose: string, cls: string): Child => {
    const f = ctx.photoFiles[date]?.[pose];
    if (f && ctx.resourcePath) return h('img', { class: `pv-ph-img ${cls}`, src: ctx.resourcePath(f), alt: `${pose} photo, ${fmt.wd(date)}`, loading: 'lazy' });
    const listed = sets.find((x) => x.date === date)?.poses.includes(pose);
    if (!listed) return null;
    return ctx.resourcePath ? h('div', { class: 'pv-ph-missing' }, `The ${pose} photo of ${fmt.day(date)} is listed but not found in its folder`) : placeholder(pose, cls);
  };
  const missing = (date: string) => h('div', { class: 'pv-ph-missing' }, `No ${POSES.find((p) => p[0] === P.pose)?.[1].toLowerCase()} photo on ${fmt.day(date)}`);
  let compare: Child = null;
  if (a && bb && a.date !== bb.date) {
    const A = img(a.date, P.pose, 'is-a');
    const B = img(bb.date, P.pose, 'is-b');
    let stage: HTMLElement;
    if (P.mode === 'side') stage = h('div', { class: 'pv-ph-stage is-side' }, h('div', { class: 'pv-ph-col' }, A ?? missing(a.date), h('span', { class: 'pv-ph-cap is-a' }, `Before · ${fmt.day(a.date)}`)), h('div', { class: 'pv-ph-col' }, B ?? missing(bb.date), h('span', { class: 'pv-ph-cap is-b' }, `After · ${fmt.day(bb.date)}`)));
    else if (!A || !B) stage = h('div', { class: 'pv-ph-stage' }, missing(!A ? a.date : bb.date));
    else {
      const top = h('div', { class: 'pv-ph-layer is-top', style: P.mode === 'slider' ? `clip-path: inset(0 0 0 ${P.pos}%)` : `opacity:${P.opacity / 100}` }, B);
      const handle = P.mode === 'slider' ? h('div', { class: 'pv-ph-handle', style: `left:${P.pos}%` }, h('span', {}, icon('swap'))) : null;
      stage = h('div', { class: `pv-ph-stage is-${P.mode}` }, h('div', { class: 'pv-ph-layer' }, A), top, handle, h('span', { class: 'pv-ph-cap is-a pv-ph-cap-l' }, `Before · ${fmt.day(a.date)}`), h('span', { class: 'pv-ph-cap is-b pv-ph-cap-r' }, `After · ${fmt.day(bb.date)}`));
      if (P.mode === 'slider') {
        let drag = false;
        const move = (ev: PointerEvent) => { const r = stage.getBoundingClientRect(); P.pos = Math.round(Math.max(0, Math.min(100, ((ev.clientX - r.left) / r.width) * 100))); top.style.clipPath = `inset(0 0 0 ${P.pos}%)`; if (handle) handle.style.left = `${P.pos}%`; };
        stage.addEventListener('pointerdown', (ev) => { drag = true; stage.setPointerCapture(ev.pointerId); move(ev); });
        stage.addEventListener('pointermove', (ev) => { if (drag) move(ev); });
        stage.addEventListener('pointerup', () => { drag = false; });
      }
    }
    const range = P.mode === 'side' ? null : (() => {
      const r = h('input', { type: 'range', min: 0, max: 100, value: P.mode === 'slider' ? P.pos : P.opacity, 'aria-label': P.mode === 'slider' ? 'Slider position' : 'After photo opacity' });
      r.addEventListener('input', () => { if (P.mode === 'slider') P.pos = Number(r.value); else P.opacity = Number(r.value); const t = stage.querySelector<HTMLElement>('.pv-ph-layer.is-top'); if (t) { if (P.mode === 'slider') t.style.clipPath = `inset(0 0 0 ${P.pos}%)`; else t.style.opacity = String(P.opacity / 100); } const hd = stage.querySelector<HTMLElement>('.pv-ph-handle'); if (hd) hd.style.left = `${P.pos}%`; });
      return h('label', { class: 'pv-ph-ctl' }, r, h('span', {}, P.mode === 'slider' ? 'Drag across the photo' : 'Fade between the two'));
    })();
    const pick = (k: 'a' | 'b') => h('div', { class: 'pv-ph-pick' }, h('span', { class: `pv-ph-cap is-${k}` }, k === 'a' ? 'Before' : 'After'), h('div', { class: 'pv-lg-pills' }, sets.map((x) => h('button', { class: `pv-lg-pill${(k === 'a' ? a.date : bb.date) === x.date ? ' is-on' : ''}`, onclick: () => { P[k] = x.date; ctx.onPhoto(); } }, fmt.day(x.date)))));
    compare = h('div', { class: 'pv-ph-compare' },
      h('div', { class: 'pv-ph-bar' }, pick('a'), pick('b')),
      h('div', { class: 'pv-ph-bar' }, h('div', { class: 'pv-seg' }, POSES.map(([k, l]) => h('button', { class: P.pose === k ? 'is-on' : '', onclick: () => { P.pose = k; ctx.onPhoto(); } }, l))), h('div', { class: 'pv-seg' }, ([['side', 'Side by side'], ['slider', 'Slider'], ['overlay', 'Overlay']] as const).map(([k, l]) => h('button', { class: P.mode === k ? 'is-on' : '', onclick: () => { P.mode = k; ctx.onPhoto(); } }, l)))),
      stage, range,
      h('div', { class: 'pv-ph-foot' }, `${Math.abs(Math.round((ms(bb.date) - ms(a.date)) / 864e5))} days apart · ← → step the after photo · 1–4 pose`),
    );
  }
  const grid = sets.length ? h('div', { class: 'pv-ph-grid', style: `grid-template-columns: 78px repeat(${sets.length}, minmax(0, ${sets.length < 4 ? '180px' : '1fr'}))` },
    h('div', {}), sets.map((x) => h('div', { class: `pv-ph-gh${a && x.date === a.date ? ' is-a' : ''}${bb && x.date === bb.date ? ' is-b' : ''}` }, h('b', {}, fmt.day(x.date)), h('span', {}, x.indexed ? x.date.slice(0, 4) : 'folder only'))),
    POSES.map(([k, l]) => [h('div', { class: 'pv-ph-gl' }, l), sets.map((x) => {
      const thumb = x.poses.includes(k) ? img(x.date, k, 'is-thumb') : null;
      return thumb ? h('button', { class: `pv-ph-cell${P.pose === k && bb && x.date === bb.date ? ' is-on' : ''}`, 'data-tip': tip(`${l} · ${fmt.wd(x.date)}`, 'Click: compare this one as After'), onclick: () => { P.b = x.date; P.pose = k; if (P.a === x.date) P.a = sets[0]!.date; ctx.onPhoto(); } }, thumb) : h('div', { class: 'pv-ph-cell is-none' }, '–');
    })]),
  ) : null;
  return card('photos', 'pv-span-12', ctx, cardHead('photos', 'Progress photos', `${sets.length} set${sets.length === 1 ? '' : 's'}${folderOnly ? `, ${folderOnly} found in the photo folder but not in body-data.json’s index` : ''}. Compare two dates pose by pose, or scan the grid`, ctx),
    sets.length ? [h('div', { class: `pv-ph${compare ? '' : ' is-grid-only'}` }, compare, grid), sets.length === 1 ? calm('One photo set so far: comparing starts with the second.') : null, ctx.resourcePath ? null : calm('The preview has no photos: the body-map outline stands in for them.')] : calm(`No photo sets yet: photos come on ${b.photoDays}.`),
    table([{ t: 'Set' }, ...POSES.map(([, l]) => ({ t: l }))], sets.map((x) => [fmt.wd(x.date), ...POSES.map(([k]) => (x.poses.includes(k) ? (ctx.photoFiles[x.date]?.[k] ? 'Yes' : 'Listed') : '–'))])));
}

// ================================================================ health
const HEALTH = {
  rhr: { label: 'Resting HR', unit: 'bpm', better: 'lower', fmt: (v: number) => String(Math.round(v)) },
  sleep: { label: 'Sleep', unit: 'h', better: 'higher', fmt: (v: number) => hm(v) },
  steps: { label: 'Steps', unit: '', better: 'higher', fmt: (v: number) => thousands(v) },
} as const;
function healthTile(k: 'rhr' | 'sleep' | 'steps', hm_: Health, width: number, ctx: MoreContext): HTMLElement {
  const H = HEALTH[k];
  const series = k === 'sleep' ? hm_.sleep : k === 'steps' ? hm_.steps : hm_.rhr;
  const goal = k === 'sleep' ? hm_.goals.sleepH : k === 'steps' ? hm_.goals.steps : hm_.goals.rhr;
  const sel = ctx.health === k;
  const base = h('section', { class: `pv-card pv-span-4 pv-ht${sel ? ' is-sel' : ''}`, role: 'button', tabindex: '0', 'aria-pressed': sel ? 'true' : 'false', onclick: () => ctx.onHealth(k) });
  if (!series) {
    base.append(h('div', { class: 'pv-ht-top' }, h('span', { class: 'pv-kicker' }, H.label)), calm('No readings yet.'));
    return base;
  }
  const ok = goal === null ? null : k === 'rhr' ? series.avg7 <= goal : series.avg7 >= goal;
  const last30 = series.series.filter((p) => (ms(series.last) - ms(p.date)) / 864e5 < 30);
  const W = inner(width);
  const hh = 44;
  const vs = last30.map((p) => p.value).concat(goal !== null ? [goal] : []);
  const x = scale(ms(last30[0]!.date), Math.max(ms(last30.at(-1)!.date), ms(last30[0]!.date) + 864e5), 3, W - 3);
  const y = scale(Math.min(...vs), Math.max(...vs) + (Math.max(...vs) === Math.min(...vs) ? 1 : 0), hh - 4, 4);
  const sub = k === 'rhr' ? `${signed(series.avg7 - series.firstWeek, 0)} bpm since the first week` : goal === null ? '' : ok ? (k === 'sleep' ? 'at the goal' : `${thousands(series.avg7 - goal)} over the goal`) : k === 'sleep' ? `${hm(goal - series.avg7)} short of ${hm(goal)} h` : `${thousands(goal - series.avg7)} under the goal`;
  const floors = k === 'steps' && hm_.floors ? ` · ${Math.round(hm_.floors.avg7)} floors a day` : '';
  base.setAttribute('data-tip', tip(`${H.label}, 7-day average`, `Average ${H.fmt(series.avg7)}${H.unit ? ` ${H.unit}` : ''}`, `Days in it ${series.n7} of 7`, `First week ${H.fmt(series.firstWeek)}${H.unit ? ` ${H.unit}` : ''}`, goal !== null ? `Goal ${k === 'rhr' ? `${Math.round(goal)} bpm or lower` : H.fmt(goal)}` : 'No goal in the profile', 'Click to chart it below'));
  base.append(
    h('div', { class: 'pv-ht-top' }, h('span', { class: 'pv-kicker' }, H.label), ok === null ? statusChip('neutral', 'No goal set') : ok ? statusChip('in', 'At the goal') : k === 'rhr' ? statusChip('above', 'Above the goal') : statusChip('below', 'Under the goal')),
    h('div', { class: 'pv-ht-v' }, H.fmt(series.avg7), h('small', {}, H.unit)),
    h('div', { class: 'pv-ht-sub' }, ['7-day average', sub, goal !== null ? `goal ${k === 'rhr' ? `${Math.round(goal)} bpm or lower` : H.fmt(goal)}` : null].filter(Boolean).join(' · '), series.n7 < 7 ? ` · ${series.n7} of 7 days` : '', floors),
    s('svg', { class: 'pv-chart pv-ht-spark', viewBox: `0 0 ${W} ${hh}`, role: 'img', 'aria-label': `${H.label}, 30 days` },
      goal !== null ? s('line', { class: 'pv-ht-goal', x1: 0, x2: W, y1: y(goal), y2: y(goal) }) : null,
      last30.map((p) => s('circle', { class: 'pv-c-raw', cx: x(ms(p.date)), cy: y(p.value), r: 2 })),
      last30.length > 1 ? s('path', { class: 'pv-c-line', d: path(last30.map((p) => [x(ms(p.date)), y(p.avg7)] as [number, number])) }) : null,
      s('circle', { class: 'pv-c-end', cx: x(ms(last30.at(-1)!.date)), cy: y(last30.at(-1)!.avg7), r: 3 }),
    ),
    h('div', { class: 'pv-ht-foot' }, '30 days: daily dots, the 7-day line, the goal dashed'),
  );
  return base;
}
/** The smallest y span the daily chart draws: one flat reading would otherwise fill it with hundredths. */
const HEALTH_MIN_SPAN = { rhr: 6, sleep: 1, steps: 2000 } as const;

function healthDetail(hm_: Health, width: number, ctx: MoreContext, base: { mean: number; sd: number; days: number } | null): HTMLElement {
  const k = ctx.health;
  const H = HEALTH[k];
  const series = k === 'sleep' ? hm_.sleep : k === 'steps' ? hm_.steps : hm_.rhr;
  const goal = k === 'sleep' ? hm_.goals.sleepH : k === 'steps' ? hm_.goals.steps : hm_.goals.rhr;
  const seg = h('div', { class: 'pv-seg' }, (['rhr', 'sleep', 'steps'] as const).map((kk) => h('button', { class: k === kk ? 'is-on' : '', onclick: () => ctx.onHealth(kk) }, HEALTH[kk].label)));
  if (!series) return card('health', 'pv-span-12', ctx, cardHead('health', `${H.label}, every day`, null, ctx, seg), calm('No readings yet.'), null);
  const W = inner(width);
  const Hh = 230;
  const m = { l: 44, r: 14, t: 14, b: 28 };
  // The usual range only once readiness has its baseline (14 mornings), as Today's readiness says; the y range always holds it.
  const baseline = base && base.days >= READINESS.minBaseline ? base : null;
  const vs = series.series.map((p) => p.value).concat(goal !== null ? [goal] : [], baseline ? [baseline.mean - baseline.sd, baseline.mean + baseline.sd] : []);
  let lo = Math.min(...vs);
  let hi = Math.max(...vs);
  const short = HEALTH_MIN_SPAN[k] - (hi - lo);
  if (short > 0) {
    lo -= short / 2;
    hi += short / 2;
  }
  const pad = (hi - lo) * 0.08;
  const x = scale(ms(series.series[0]!.date), Math.max(ms(series.last), ms(series.series[0]!.date) + 864e5), m.l, W - m.r);
  const y = scale(lo - pad, hi + pad, Hh - m.b, m.t);
  const out: Child[] = [];
  for (const v of niceTicks(lo - pad, hi + pad, 4)) out.push(s('line', { class: 'pv-grid', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }), s('text', { class: 'pv-ax end', x: m.l - 6, y: y(v) + 3 }, k === 'steps' ? thousands(v) : k === 'sleep' ? hm(v) : String(v)));
  if (baseline) out.push(s('rect', { class: 'pv-c-band', x: m.l, y: y(baseline.mean + baseline.sd), width: W - m.l - m.r, height: Math.max(1, y(baseline.mean - baseline.sd) - y(baseline.mean + baseline.sd)) }), s('text', { class: 'pv-c-label', x: m.l + 6, y: y(baseline.mean + baseline.sd) - 4 }, 'your usual range, 28 days'));
  if (goal !== null) out.push(s('line', { class: 'pv-ht-goal', x1: m.l, x2: W - m.r, y1: y(goal), y2: y(goal) }), s('text', { class: 'pv-c-label strong', x: W - m.r, y: y(goal) - 5, 'text-anchor': 'end' }, `goal ${k === 'rhr' ? `${Math.round(goal)} bpm` : H.fmt(goal)}`));
  for (const p of series.series) out.push(s('circle', { class: 'pv-c-raw', cx: x(ms(p.date)), cy: y(p.value), r: 2.6, 'data-tip': tip(fmt.wd(p.date), `${H.label} ${H.fmt(p.value)}${H.unit ? ` ${H.unit}` : ''}`, `7-day average ${H.fmt(p.avg7)}${p.n < 7 ? ` (${p.n} of 7 days)` : ''}`) }));
  if (series.series.length > 1) out.push(s('path', { class: 'pv-c-line', d: path(series.series.map((p) => [x(ms(p.date)), y(p.avg7)] as [number, number])) }));
  out.push(s('text', { class: 'pv-ax', x: m.l, y: Hh - 8 }, fmt.day(series.series[0]!.date)), s('text', { class: 'pv-ax end', x: W - m.r, y: Hh - 8 }, fmt.day(series.last)));
  return card('health', 'pv-span-12', ctx, cardHead('health', `${H.label}, every day`, `Since ${fmt.day(series.series[0]!.date)}, from the morning check-in; ${H.better} is better`, ctx, seg),
    [s('svg', { class: 'pv-chart', viewBox: `0 0 ${W} ${Hh}`, role: 'img', 'aria-label': `${H.label} per day` }, out), key(keyItem(sw('pv-c-raw', 'circle'), 'A day'), keyItem(sw('pv-c-line', 'line'), '7-day average'), goal !== null ? keyItem(sw('pv-ht-goal', 'line'), 'Goal') : null, baseline ? keyItem(sw('pv-c-band'), 'Your usual range (readiness baseline)') : null)],
    table([{ t: 'Day' }, { t: H.label, r: true }, { t: '7-day average', r: true }], [...series.series].reverse().map((p) => [fmt.wd(p.date), H.fmt(p.value), `${H.fmt(p.avg7)}${p.n < 7 ? ` (${p.n} d)` : ''}`])));
}

// ================================================================ skills
const TEST_LABEL: Record<string, (v: number) => string> = { pushups: (v) => `${v} reps`, pullups: (v) => `${v} rep${v === 1 ? '' : 's'}`, hollowS: (v) => `${v} s`, handstandS: (v) => `${v} s at the wall`, sidePlankS: (v) => `${v} s` };
const testText = (f: string, v: number) => (TEST_LABEL[f] ?? ((x: number) => String(x)))(v);
const TEST_NAME: Record<string, string> = { pushups: 'Push-ups', pullups: 'Pull-ups', hollowS: 'Hollow hold', handstandS: 'Handstand, wall', sidePlankS: 'Side plank' };
function testCell(field: string | null, tests: { date: string; value: number }[], goal: number | null): HTMLElement {
  const last = tests.at(-1);
  const tw = 110;
  let spark: Child = null;
  if (last && tests.length) {
    const tx = scale(0, Math.max(1, tests.length - 1), 6, tw - 6);
    const ty = scale(0, Math.max(goal ?? 0, ...tests.map((t) => t.value), 1), 26, 4);
    spark = s('svg', { class: 'pv-chart pv-sk-spark', viewBox: `0 0 ${tw} 30`, style: `width:${tw}px;height:30px`, role: 'img', 'aria-label': 'Tests over time' }, goal !== null ? s('line', { class: 'pv-ht-goal', x1: 0, x2: tw, y1: ty(goal), y2: ty(goal) }) : null, tests.length > 1 ? s('path', { class: 'pv-c-line is-thin', d: path(tests.map((t, i) => [tx(i), ty(t.value)] as [number, number])) }) : null, tests.map((t, i) => s('circle', { class: 'pv-c-end', cx: tx(i), cy: ty(t.value), r: 3, 'data-tip': tip(fmt.wd(t.date), `Test ${testText(field ?? '', t.value)}`, goal !== null ? `Goal ${testText(field ?? '', goal)}` : 'No goal in the profile') })));
  }
  const met = last && goal !== null && last.value >= goal;
  return h('div', { class: 'pv-sk-test' },
    h('div', { class: 'pv-sk-test-top' }, h('span', {}, last ? ['Test ', h('b', {}, testText(field ?? '', last.value)), ` · ${fmt.day(last.date)}`] : 'No test yet'), last && goal !== null ? statusChip(met ? 'in' : 'neutral', met ? 'Goal met' : `${Math.round(Math.min(1, last.value / goal) * 100)} %`, met ? 'inTarget' : 'info') : null),
    h('div', { class: 'pv-sk-test-mid' }, spark, h('span', { class: 'pv-sk-goal' }, goal !== null ? `goal ${testText(field ?? '', goal).replace(' at the wall', '')}` : 'no goal set')),
  );
}
function skills(sk: Skills, ctx: MoreContext): HTMLElement {
  const stateLabel = { mastered: 'Mastered', progress: 'In progress', unlocked: 'Next: unlocked', locked: 'Locked' };
  const rows = sk.ladders.map((l) => {
    const gKey = `skills:${l.id}`;
    const entries = l.levelName && ctx.guide ? ctx.guide(l.levelName) : [];
    const gOpen = Boolean(ctx.openGuides?.has(gKey)) && entries.length > 0;
    // Before any level is logged the card shows the plan's start (startLevel); ▲ and ▼ move from it.
    const planStart = l.from === 'plan';
    // The dashboard's ▲ and ▼: one level up, or down as a correction, written as `engine log ladder` writes it.
    const moves = ctx.onMoveLadder ? h('div', { class: 'pv-sk-moves' },
      h('button', { class: 'pv-sk-move', 'aria-label': `${l.name}: down a level`, 'data-tip': planStart ? 'Down a level|A correction to the plan’s start' : 'Down a level|A correction', disabled: l.level <= 1, onclick: () => ctx.onMoveLadder!(l.id, l.level - 1) }, icon('down')),
      h('button', { class: 'pv-sk-move', 'aria-label': `${l.name}: up a level`, 'data-tip': planStart ? 'Up a level|From the plan’s start' : l.level ? 'Up a level' : 'Set level 1', disabled: l.level >= l.path.length, onclick: () => ctx.onMoveLadder!(l.id, l.level + 1) }, icon('up'))) : null;
    // One tap writes the plan's start as the first logged level, through the same write as ▲.
    const logStart = planStart && ctx.onMoveLadder ? h('div', { class: 'pv-sk-log' }, h('button', { class: 'pv-btn-quiet', 'data-tip': `Log level ${l.level}|Starts the level history at the plan’s start`, onclick: () => ctx.onMoveLadder!(l.id, l.level, 'start') }, icon('check'), 'Log this level')) : null;
    return h('div', { class: `pv-sk-row${l.testShowsLevel ? ' has-hint' : ''}${gOpen ? ' has-guide' : ''}` },
    h('div', { class: 'pv-sk-name' }, h('div', { class: 'pv-sk-name-top' }, h('b', {}, l.name), moves), h('div', { class: 'pv-sk-sub' }, l.level ? [`Level ${l.level} of ${l.path.length} · `, guideName(clean(l.levelName ?? ''), entries.length > 0, gOpen, () => ctx.onToggleGuide?.(gKey), 'pv-sk-level'), l.since ? ` · since ${fmt.day(l.since)}` : planStart ? ' · the plan’s start, not logged yet' : ''] : 'Level not set · tap ▲'), logStart),
    h('ol', { class: 'pv-sk-path', 'aria-label': `${l.name} levels` }, l.path.map((p) => h('li', { class: `pv-sk-node is-${p.state}`, 'data-tip': tip(`L${p.n} · ${clean(p.name)}`, stateLabel[p.state], p.reached ? `Reached ${fmt.wd(p.reached)}` : null, p.state === 'unlocked' ? 'Move up after the top of the reps on every set, two sessions in a row' : null) }, h('span', { class: 'pv-sk-dot' }, p.state === 'mastered' ? icon('check') : p.state === 'locked' ? icon('lock') : String(p.n)), h('span', { class: 'pv-sk-lbl' }, clean(p.name))))),
    testCell(l.test, l.tests, l.goal),
    l.testShowsLevel ? h('div', { class: 'pv-sk-hint' }, icon('alert'), h('span', {}, `The latest test is ahead of the ladder: it shows level ${l.testShowsLevel.level}, ${clean(l.testShowsLevel.name)}.`),
      // The level moves as `engine log ladder` writes it (the dashboard's ▲).
      ctx.onMoveLadder ? h('button', { class: 'pv-btn-quiet', onclick: () => ctx.onMoveLadder!(l.id, l.testShowsLevel!.level) }, icon('up'), `Move to level ${l.testShowsLevel.level}`) : null) : null,
    gOpen ? h('div', { class: 'pv-sk-guide' }, guidePanel(entries)) : null,
  );
  });
  const tested = sk.testedOnly.map((t) => h('div', { class: 'pv-sk-row' }, h('div', { class: 'pv-sk-name' }, h('b', {}, TEST_NAME[t.test] ?? t.test), h('div', { class: 'pv-sk-sub' }, 'Tested only')), h('div', { class: 'pv-sk-path is-none' }, 'No ladder in the plan'), testCell(t.test, t.tests, t.goal)));
  const legend = key(...(['mastered', 'progress', 'unlocked', 'locked'] as const).map((st) => h('span', { class: `pv-sk-key is-${st}` }, h('span', { class: 'pv-sk-dot' }, st === 'mastered' ? icon('check') : st === 'locked' ? icon('lock') : ''), stateLabel[st])), keyItem(sw('pv-ht-goal', 'line'), 'Test goal'));
  return card('skills', 'pv-span-12', ctx, cardHead('skills', 'Skills', 'Each calisthenics ladder as a path of levels, beside its latest test and goal. Move up after the top of the reps on every set, two sessions in a row', ctx),
    sk.ladders.length || sk.testedOnly.length ? [h('div', { class: 'pv-sk' }, rows, tested), legend] : calm('No ladders or tests yet.'),
    table([{ t: 'Skill' }, { t: 'Level', r: true }, { t: 'Level name' }, { t: 'Since' }, { t: 'Latest test' }, { t: 'Goal' }], [
      ...sk.ladders.map((l) => [l.name, l.level ? String(l.level) : '–', l.levelName ? clean(l.levelName) : '–', l.since ? fmt.day(l.since) : l.from === 'plan' ? 'The plan’s start, not logged yet' : '–', l.tests.at(-1) ? `${testText(l.test ?? '', l.tests.at(-1)!.value)}, ${fmt.day(l.tests.at(-1)!.date)}` : '–', l.goal !== null ? testText(l.test ?? '', l.goal) : '–'] as Child[]),
      ...sk.testedOnly.map((t) => [TEST_NAME[t.test] ?? t.test, '–', '–', '–', t.tests.at(-1) ? `${testText(t.test, t.tests.at(-1)!.value)}, ${fmt.day(t.tests.at(-1)!.date)}` : '–', t.goal !== null ? testText(t.test, t.goal) : '–'] as Child[]),
    ]));
}

// ================================================================ the section
/**
 * A two-column card layout as two independent columns (a 7 and a 5), so a
 * short card never leaves a gap beside a tall one. Each card keeps its place
 * in the reading order as `order`: on a narrow pane the columns dissolve
 * (CSS `display: contents`) and the cards read in that order, one under the
 * other, as they did in rows.
 */
function columns(cards: readonly (readonly [HTMLElement, 'left' | 'right'])[]): HTMLElement[] {
  const left = h('div', { class: 'pv-span-7 pv-stack pv-col' });
  const right = h('div', { class: 'pv-span-5 pv-stack pv-col' });
  cards.forEach(([c, side], i) => {
    c.style.order = String(i + 1);
    (side === 'left' ? left : right).append(c);
  });
  return [left, right];
}

/** Builds a section's cards into `grid` (its children are replaced). */
/**
 * The Body section in the profile's body units: the tape (stored in cm) and
 * the kg and cm target rows, converted to one decimal. Metric is returned as
 * it is.
 */
export function bodyIn(b: BodyM, units: BodyUnits | undefined): BodyM {
  const F = bodyFmt(units);
  if (F.w === 'kg' && F.l === 'cm') return b;
  const d1 = (n: number) => Math.round(n * 10) / 10;
  const cm = (v: number) => d1(F.lv(v));
  const pt = <P extends { value: number; unit?: string }>(p: P): P => (p.unit === 'cm' || p.unit === undefined ? { ...p, value: cm(p.value), unit: F.l } : p);
  const measures = b.tape.measures.map((x) => ({ ...x, points: x.points.map(pt), first: x.first ? pt(x.first) : null, last: x.last ? pt(x.last) : null, change: x.change === null ? null : cm(x.change) }));
  const conv = (unit: string) => (unit === 'cm' ? (v: number) => cm(v) : unit === 'kg' ? (v: number) => d1(F.wv(v)) : null);
  const targets = b.targets.map((r) => {
    const f = conv(r.unit);
    if (!f) return r;
    const n = (v: number | null | undefined) => (v === null || v === undefined ? v : f(v));
    return { ...r, unit: r.unit === 'cm' ? F.l : F.w, ...(r.lo !== undefined ? { lo: f(r.lo) } : {}), ...(r.hi !== undefined ? { hi: f(r.hi) } : {}), ...(r.goal !== undefined ? { goal: f(r.goal) } : {}), base: n(r.base) ?? null, cur: n(r.cur) ?? null, ...(r.drop !== undefined ? { drop: n(r.drop) ?? null } : {}) };
  });
  return { ...b, tape: { ...b.tape, measures }, targets };
}

export function renderMore(grid: HTMLElement, section: ProgressSection, m: MoreModel, total: number, ctx: MoreContext, baseline: (k: string) => { mean: number; sd: number; days: number } | null): void {
  const narrow = total < 760;
  const gap = 18;
  const col = (total - 11 * gap) / 12;
  const w = (n: number) => (narrow ? total : col * n + gap * (n - 1));
  const notes = firstRunNotes(notesFor(m, section).filter((n) => !['one-photo-set', 'no-photos', 'no-targets', 'one-tape'].includes(n.code)));
  const head = notes.length ? h('div', { class: 'pv-notes pv-span-12' }, notes.map((n) => h('div', { class: 'pv-note' }, icon('info'), h('span', {}, n.text)))) : null;
  const cards: Child[] = [];
  if (section === 'training' && m.training) cards.push(...columns([[records(m.training, w(7), ctx), 'left'], [everyLift(m.training, ctx), 'right'], [sessions(m.training, w(7), ctx), 'left'], [cardio(m.training, w(5), ctx), 'right']]));
  if (section === 'body' && m.body) {
    const b = bodyIn(m.body, ctx.units);
    cards.push(...columns([[tape(b, w(7), ctx), 'left'], [targets(b, w(5), ctx), 'right']]), photos(b, ctx));
  }
  if (section === 'health' && m.health) cards.push(...(['rhr', 'sleep', 'steps'] as const).map((k) => healthTile(k, m.health, w(4), ctx)), healthDetail(m.health, w(12), ctx, baseline(ctx.health === 'sleep' ? 'sleepH' : ctx.health)));
  if (section === 'skills' && m.skills) cards.push(skills(m.skills, ctx));
  grid.replaceChildren(...[head, ...cards].filter((c): c is HTMLElement => c instanceof HTMLElement));
}
