// Progress's Habits section, as signed off in mockups/progress.html?sec=habits:
// one list of everything tracked, grouped (Supplements, Amounts and ticks, At
// the desk), each row with its source ("Suggested by your coach" with the
// Why, or "Added by you"), schedule, reminder, homepage link, streak, 30-day
// adherence and 26-week grid (sitting: 4 weeks of bars against the limit);
// the three tiles; the coach's suggestions as accept or dismiss chips; the
// Add / Edit form for all six kinds with pause and remove; a table view; the
// empty state; the one-time bring-over from Habit Nudges; and today's
// reminders in order. The numbers are the engine's (buildHabitsScreen);
// the form is src/report/item-form.ts; the view writes. Standard DOM only.

import type { Conflict } from '../../../src/adapters/vault/tracking-write.ts';
import type { DueToday } from '../../../src/core/nudges.ts';
import type { DeskStep, ItemKind, ItemSlot, ScheduleKind, Weekday } from '../../../src/core/schema.ts';
import { hm } from '../../../src/core/sitting.ts';
import type { DayCell } from '../../../src/core/tracking.ts';
import { KIND_LABEL } from '../../../src/report/habits-screen.ts';
import { AMOUNT_UNITS, DOSE_UNITS, OFTEN_LABEL, oftenChoices, WHEN_CHOICES, WHEN_LABEL, withKind, withWhen, type ItemForm } from '../../../src/report/item-form.ts';
import type { HabitsModel } from '../data-source.ts';
import { amountBar, sittingBar, standCount } from './due-today.ts';
import { h, icon, s, type Child } from './dom.ts';
import { addDays, fmt } from './format.ts';
import { table, tip } from './progress.ts';

type Row = HabitsModel['items'][number];
type Suggestion = HabitsModel['suggestions'][number];

export const KIND_ICON: Record<ItemKind, string> = { supplement: 'pill', amount: 'drop', tick: 'check', standup: 'stand', desk: 'monitor', sitting: 'clock' };
const KIND_HINT: Record<ItemKind, string> = {
  supplement: 'Something you take, with a dose: creatine, a multivitamin, magnesium.',
  amount: 'A daily target you add to through the day: water, steps, pages.',
  tick: 'Done or not: flossing, a skin routine, lights out on time.',
  standup: 'After a stretch of active sitting, a card asks you to stand for a while.',
  desk: 'A short routine at set times in the working day.',
  sitting: 'A daily limit on sitting, and on the longest stretch.',
};
const CELL_LABEL: Record<DayCell['state'], string> = { taken: 'Done', part: 'Part of the target', missed: 'Not done', open: 'Due, not done yet', off: 'Not scheduled', paused: 'Paused', none: 'Not started', future: 'Upcoming' };
const WD: { d: Weekday; l: string }[] = [{ d: 'mon', l: 'M' }, { d: 'tue', l: 'T' }, { d: 'wed', l: 'W' }, { d: 'thu', l: 'T' }, { d: 'fri', l: 'F' }, { d: 'sat', l: 'S' }, { d: 'sun', l: 'S' }];
const nfmt = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-GB') : String(Math.round(v * 100) / 100));
const cap = (x: string) => (x ? x[0]!.toUpperCase() + x.slice(1) : x);

/** The section's state, kept by the view across redraws. */
export interface HabitsUi {
  table: boolean;
  /** The form on the editor card: a new item, or the item being edited (`base`, as read when the edit began). */
  form: ItemForm;
  base: import('../../../src/core/schema.ts').TrackedItem | null;
  confirmRemove: boolean;
  busy: boolean;
  error: string | null;
  conflict: Conflict[] | null;
  /** The bring-over's ticks (null until first drawn: the offer's own), and "Not now" for this session. */
  bring: Set<string> | null;
  bringLater: boolean;
  /** Ids with a write on the way. */
  pending: Set<string>;
}

export interface HabitsContext {
  model: HabitsModel;
  /** Today's reminders (null without the reminder machinery). */
  due: DueToday | null;
  ui: HabitsUi;
  canWrite: boolean;
  /** Redraw after a change of the form or the toggles. */
  onChange: () => void;
  onSave: (force?: boolean) => void;
  onCancel: () => void;
  onEdit: (id: string) => void;
  onAdd: () => void;
  onPause: () => void;
  onResume: (id: string) => void;
  onRemove: () => void;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
  onBring: () => void;
  onBringLater: () => void;
  /** "Start fresh instead": the offer recorded as answered with nothing, so it does not come back. */
  onBringNever: () => void;
  onAmount: (id: string, delta: number) => void;
  /** "see the card": a reminder card by its key. */
  onOpenKey?: (key: string) => void;
  /** The live sitting minutes from this Mac (the list's sitting row follows them between reads). */
  sittingLive?: { minutes: number; longest: number } | null;
  /** A moment as local HH:MM (a tick's time, the morning's saved time). */
  clock?: (ms: number) => string;
}

let clockText: (ms: number) => string = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const at = (iso: string | null | undefined): string | null => (iso && !Number.isNaN(Date.parse(iso)) ? clockText(Date.parse(iso)) : null);

// ================================================================ the list

interface Cols {
  info: number;
  stat: number;
  gap: number;
  avail: number;
}
function cols(total: number): Cols {
  const info = total < 1060 ? 250 : 280;
  const stat = total < 1060 ? 150 : 170;
  const gap = 14;
  return { info, stat, gap, avail: Math.max(220, total - 46 - info - stat - 28 - 3 * gap) };
}

interface GridGeom {
  cell: number;
  gap: number;
  left: number;
  weeks: number;
  W: number;
  H: number;
}
function geom(avail: number, n: number): GridGeom {
  const weeks = Math.ceil(n / 7);
  const left = 24;
  const gap = 3;
  const cell = Math.max(6, Math.min(12, Math.floor((avail - left) / weeks) - gap));
  return { cell, gap, left, weeks, W: left + weeks * (cell + gap), H: 7 * (cell + gap) };
}

function cellTip(r: Row, c: DayCell): string {
  const counted = r.measure !== null;
  const lines: (string | null)[] = [counted && c.state === 'taken' ? 'Target met' : r.kind === 'sitting' && c.state === 'taken' ? 'Within both limits' : CELL_LABEL[c.state]];
  if (c.value !== undefined && r.measure) lines.push(`Logged: ${nfmt(c.value)} of ${nfmt(c.target ?? r.measure.target)} ${r.measure.unit}`);
  if (c.desk) lines.push(`${nfmt(c.desk)} of them at the desk, with Standing now on`);
  if (c.sitting) lines.push(`Sitting: ${hm(c.sitting.minutes)}, longest stretch ${c.sitting.longest} min`);
  if (c.at && (c.state === 'taken' || c.state === 'part') && at(c.at)) lines.push(`${r.measure ? 'Last added' : 'Ticked'} at ${at(c.at)}`);
  if (c.via && (c.state === 'taken' || c.state === 'part' || c.sitting)) lines.push(`From: ${c.via === 'habit' ? `the linked habit ${r.habitName ?? r.habit}` : c.via === 'desk-time' ? 'Habit Nudges’ desk time' : r.kind === 'standup' ? 'the stand-up cards' : r.kind === 'desk' ? 'the desk-break cards' : r.kind === 'sitting' ? 'keyboard and mouse activity' : 'a reminder card or Today'}`);
  if (c.state === 'off') lines.push(r.item.schedule.kind === 'training' ? 'Rest day' : 'Not one of its days');
  if (c.state === 'none') lines.push(`Before its start on ${fmt.day(r.countsFrom)}: not counted${r.habitName ? ', whatever the linked habit holds' : ''}`);
  return tip(fmt.wd(c.date), ...lines);
}

function gridSvg(r: Row, g: GridGeom): SVGElement {
  const svg = s('svg', { class: 'pv-sg', width: g.W, height: g.H, viewBox: `0 0 ${g.W} ${g.H}`, role: 'img', 'aria-label': `${r.name}: 26 weeks` });
  ['Mon', '', 'Wed', '', 'Fri', '', ''].forEach((t, i) => t && svg.append(s('text', { class: 'pv-ax', x: 0, y: i * (g.cell + g.gap) + g.cell - 2 }, t)));
  r.grid.cells.forEach((c, i) => {
    const cx = g.left + Math.floor(i / 7) * (g.cell + g.gap);
    const cy = (i % 7) * (g.cell + g.gap);
    svg.append(s('rect', { class: `pv-sg-cell is-${c.state}`, x: cx + 0.5, y: cy + 0.5, width: g.cell - 1, height: g.cell - 1, rx: 2.5, 'data-tip': cellTip(r, c) }));
    if (c.date === r.today.date) svg.append(s('rect', { class: 'pv-cal-today', x: cx - 1.5, y: cy - 1.5, width: g.cell + 3, height: g.cell + 3, rx: 4 }));
  });
  return svg;
}

function monthsHead(from: string, g: GridGeom): SVGElement {
  const svg = s('svg', { class: 'pv-sg-months', width: g.W, height: 14, viewBox: `0 0 ${g.W} 14` });
  let last = '';
  for (let wk = 0; wk < g.weeks; wk++) {
    const mo = fmt.month(addDays(from, wk * 7));
    if (mo !== last) {
      svg.append(s('text', { class: 'pv-ax', x: g.left + wk * (g.cell + g.gap), y: 10 }, mo.toUpperCase()));
      last = mo;
    }
  }
  return svg;
}

/** Sitting's chart: the last 4 weeks as daily bars against the limit (one hue; a day over a limit gets a mark). */
function sittingChart(r: Row, W: number, H: number): HTMLElement {
  const sit = r.sitting!;
  const days = sit.bars;
  const left = 24;
  const top = 8;
  const bottom = 14;
  const ih = H - top - bottom;
  const max = Math.max(9 * 60, ...days.map((d) => d.minutes), sit.limit + 60);
  const y = (m: number) => top + ih - (Math.min(m, max) / max) * ih;
  const bw = (W - left) / days.length;
  const svg = s('svg', { class: 'pv-sg pv-sit-chart', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Sitting a day, last 4 weeks, against the ${hm(sit.limit)} limit` });
  for (const hh of [0, 3, 6, 9]) if (hh * 60 <= max) svg.append(s('text', { class: 'pv-ax', x: 0, y: y(hh * 60) + 3 }, `${hh} h`));
  days.forEach((d, i) => {
    const x0 = left + i * bw + 1;
    const w = Math.max(3, bw - 2);
    if (d.beforeStart) {
      // Before the item's start nothing is counted or drawn, not even the work timer's desk time.
      svg.append(s('rect', { class: 'pv-sit-col is-before', x: x0, y: y(0) - 2, width: w, height: 2, rx: 1, 'data-tip': tip(fmt.wd(d.date), `Before its start on ${fmt.day(r.countsFrom)}`, 'Not counted') }));
      if (i % 7 === 0) svg.append(s('text', { class: 'pv-ax', x: x0, y: H - 2 }, fmt.day(d.date)));
      return;
    }
    const h0 = Math.max(2, y(0) - y(d.minutes));
    const foot = [d.overLimit ? `Over the ${hm(sit.limit)} limit` : '', d.overStretch ? `A stretch over ${sit.stretchMax} min` : ''].filter(Boolean).join(' · ') || 'Within both limits';
    const src = d.source === 'desk-time' ? 'From Habit Nudges’ desk time' : d.source === 'none' ? 'Nothing counted' : '';
    svg.append(s('path', { class: `pv-sit-col${d.today ? ' is-today' : ''}`, d: `M${x0},${y(0)}v${-(h0 - Math.min(3, h0 / 2))}a3,3 0 0 1 3,-3h${Math.max(0, w - 6)}a3,3 0 0 1 3,3v${h0 - Math.min(3, h0 / 2)}z`, 'data-tip': tip(`${fmt.wd(d.date)}${d.today ? ', so far' : ''}`, `Sitting: ${hm(d.minutes)}`, `Longest stretch: ${d.longest} min`, foot, src) }));
    if (d.overLimit || d.overStretch) svg.append(s('path', { class: 'pv-sit-mark', d: `M${x0 + w / 2 - 3},${y(d.minutes) - 4}l3,-5l3,5z` }));
    if (i % 7 === 0) svg.append(s('text', { class: 'pv-ax', x: x0, y: H - 2 }, fmt.day(d.date)));
  });
  svg.append(s('line', { class: 'pv-sit-limit', x1: left, x2: W, y1: y(sit.limit), y2: y(sit.limit) }));
  return h('div', {}, svg, h('div', { class: 'pv-sit-note pv-faint' }, 'Last 4 weeks · ', h('span', { class: 'pv-sit-key' }, h('i', {}), 'a day'), h('span', { class: 'pv-sit-key is-line' }, h('i', {}), `${hm(sit.limit)} limit`), h('span', { class: 'pv-sit-key is-mark' }, h('i', {}), 'over a limit')));
}

/** A column's outline from the baseline up, its top corners rounded (as the sitting chart's). */
const colPath = (x: number, base: number, hgt: number, w: number, round: boolean): string => {
  const r = round ? Math.min(3, hgt / 2, w / 2) : 0;
  return `M${x},${base}v${-(hgt - r)}${r ? `a${r},${r} 0 0 1 ${r},${-r}` : ''}h${Math.max(0, w - 2 * r)}${r ? `a${r},${r} 0 0 1 ${r},${r}` : ''}v${hgt - r}z`;
};

/**
 * Stand-ups' and desk breaks' chart, the sitting chart's sibling: the last 4
 * weeks as a bar a day against the day's target (dashed). A stand-up bar is
 * split, the minutes at the desk darker at the bottom and the rest above, a
 * 2 px gap between; a desk-break bar is the breaks done. Each day's hover
 * target is its whole column.
 */
export function measureChart(r: Row, W: number, H: number): HTMLElement {
  const days = r.bars!;
  const stand = r.kind === 'standup';
  const left = 24;
  const top = 8;
  const bottom = 14;
  const ih = H - top - bottom;
  const peak = Math.max(1, ...days.map((d) => Math.max(d.value, d.target ?? 0)));
  const step = stand ? (peak <= 60 ? 30 : peak <= 240 ? 60 : 120) : Math.max(1, Math.ceil(peak / 2));
  const max = Math.ceil(peak / step) * step;
  const y = (v: number) => top + ih - (Math.min(v, max) / max) * ih;
  const bw = (W - left) / days.length;
  const anyDesk = stand && days.some((d) => (d.desk ?? 0) > 0);
  const target = r.measure?.target ?? null;
  const axis = (v: number) => (v === 0 ? '0' : !stand ? String(v) : v % 60 === 0 ? `${v / 60} h` : `${v} min`);
  const what = stand ? `Minutes standing a day, last 4 weeks${target ? `, against the ${target} min target` : ''}` : 'Desk breaks done a day, last 4 weeks, against the breaks planned';
  const svg = s('svg', { class: 'pv-sg pv-ms-chart', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${r.name}: ${what}` });
  for (let v = 0; v <= max; v += step) svg.append(s('text', { class: 'pv-ax', x: 0, y: y(v) + 3 }, axis(v)));
  days.forEach((d, i) => {
    const x0 = left + i * bw + 1;
    const w = Math.max(3, bw - 2);
    if (i % 7 === 0) svg.append(s('text', { class: 'pv-ax', x: x0, y: H - 2 }, fmt.day(d.date)));
    let lines: string[];
    if (d.beforeStart) {
      svg.append(s('rect', { class: 'pv-sit-col is-before', x: x0, y: y(0) - 2, width: w, height: 2, rx: 1 }));
      lines = [`Before its start on ${fmt.day(r.countsFrom)}`, 'Not counted'];
    } else {
      const today = d.today ? ' is-today' : '';
      const desk = stand ? Math.min(d.desk ?? 0, d.value) : 0;
      const rest = d.value - desk;
      const hDesk = desk > 0 ? Math.max(2, y(0) - y(desk)) : 0;
      const hAll = d.value > 0 ? Math.max(2, y(0) - y(d.value)) : 0;
      if (hDesk > 0) svg.append(s('path', { class: `pv-ms-desk${today}`, d: colPath(x0, y(0), hDesk, w, rest <= 0) }));
      // The rest sits on the desk's part with a 2 px gap of the surface between them.
      const gap = hDesk > 0 ? 2 : 0;
      const hRest = hAll - hDesk - gap;
      if (rest > 0 && hRest > 0) svg.append(s('path', { class: `${stand ? 'pv-ms-away' : 'pv-ms-col'}${today}`, d: colPath(x0, y(0) - hDesk - gap, hRest, w, true) }));
      if (d.target !== null) svg.append(s('line', { class: 'pv-sit-limit', x1: x0 - 1, x2: x0 + w + 1, y1: y(d.target), y2: y(d.target) }));
      const so = d.today ? ' so far' : '';
      lines = stand
        ? [`${d.value} min standing${so}${d.target !== null ? ` (target ${d.target})` : ''}`, d.count !== null ? `${d.count} stand-up${d.count === 1 ? '' : 's'}${desk > 0 ? `, ${desk} min at the desk` : ''}` : desk > 0 ? `${desk} min at the desk` : null].filter((x): x is string => Boolean(x))
        : [d.target !== null ? `${d.value} of ${d.target} breaks${so}` : `${d.value} breaks${so}`, d.target === null ? 'Not due that day' : ''].filter(Boolean);
    }
    // The hover target: the day's whole column, wider and taller than its bar.
    svg.append(s('rect', { class: 'pv-ms-hit', x: left + i * bw, y: top, width: bw, height: ih, 'data-tip': tip(fmt.wd(d.date), ...lines) }));
  });
  const key = (cls: string, label: string) => h('span', { class: `pv-sit-key ${cls}` }, h('i', {}), label);
  return h('div', {}, svg, h('div', { class: 'pv-sit-note pv-faint' }, 'Last 4 weeks · ',
    stand ? [anyDesk ? key('is-desk', 'at the desk') : null, key('is-away', anyDesk ? 'away from it' : 'minutes standing')] : key('is-break', 'breaks done'),
    key('is-line', stand ? `${target ?? ''} min target`.trim() : 'planned')));
}

function originLine(r: Row): HTMLElement {
  const coach = r.source.by === 'coach';
  return h('span', { class: `pv-origin is-${r.source.by}`, ...(coach ? { 'data-tip': tip('Suggested by your coach', r.source.why ? `Why: ${r.source.why}` : null, r.source.on ? `Accepted ${fmt.day(r.source.on)}` : null) } : {}) }, icon(coach ? 'review' : 'plus'), r.source.text);
}

function habRow(r: Row, c: Cols, g: GridGeom, ctx: HabitsContext): HTMLElement {
  const paused = r.paused !== null;
  const unitWord = r.streak.unit;
  const met = r.kind === 'sitting' ? ' within limits' : r.measure ? ' at target' : '';
  const pct = r.adherence.pct === null ? null : Math.round(r.adherence.pct * 100);
  const stat = paused
    ? h('div', { class: 'pv-sup-paused' }, h('span', { class: 'pv-status is-neutral' }, icon('pause'), 'Paused'), h('div', { class: 'pv-faint' }, `since ${fmt.day(r.paused!)}`), h('button', { class: 'pv-btn-quiet', disabled: !ctx.canWrite || ctx.ui.pending.has(r.id), onclick: () => ctx.onResume(r.id), 'data-k': `resume-${r.id}` }, 'Resume'))
    : h('div', { class: 'pv-sup-stat' },
        h('div', { class: 'pv-sup-streak', 'data-tip': tip('Streak', r.streak.reason.note ?? null) }, icon('flame'), h('b', {}, String(r.streak.value)), h('span', {}, `${unitWord} in a row${met}`)),
        h('div', { class: 'pv-sup-adh', 'data-tip': tip('Last 30 days', `${met ? cap(met.trim()) : 'Done'}: ${r.adherence.done} of ${r.adherence.due} ${unitWord} due`, pct !== null ? `Rate: ${pct} %` : 'Not due yet', r.item.schedule.kind === 'training' ? 'Due only on training days' : r.item.schedule.kind === 'weekdays' ? 'Due on its weekdays only' : null) },
          h('div', { class: 'pv-sup-bar' }, h('i', { style: `width:${pct ?? 0}%` })), h('span', {}, h('b', {}, pct === null ? '–' : `${pct} %`), ' of 30 days')));
  const live = r.kind === 'sitting' && ctx.sittingLive ? ctx.sittingLive : r.sitting?.today ?? null;
  const today = r.kind === 'sitting' && live
    ? h('div', { 'data-live': 'sitting-row' }, sittingBar({ minutes: live.minutes, longest: live.longest, limit: r.sitting!.limit, stretchMax: r.sitting!.stretchMax }))
    : r.measure && !paused
      ? amountBar({ value: r.measure.value, target: r.measure.target, unit: r.measure.unit, quick: r.kind === 'amount' ? r.measure.quick : [], id: r.id, left: false, busy: !ctx.canWrite || ctx.ui.pending.has(r.id), onAdd: ctx.onAmount })
      : null;
  const vis = r.kind === 'sitting' ? sittingChart(r, Math.min(c.avail, g.W), g.H + 20) : r.bars ? measureChart(r, Math.min(c.avail, g.W), g.H + 20) : gridSvg(r, g);
  return h('div', { class: `pv-sup-row${paused ? ' is-paused' : ''}`, 'data-item': r.id },
    h('div', { class: 'pv-sup-info' },
      h('div', { class: 'pv-sup-name' }, h('b', {}, r.name), r.name !== KIND_LABEL[r.kind] ? h('span', { class: 'pv-kind-tag' }, KIND_LABEL[r.kind]) : null, r.dose ? h('span', { class: 'pv-sup-dose' }, r.dose) : null),
      h('div', { class: 'pv-sup-sched' }, `${r.schedule} · ${r.when}${r.kind !== 'supplement' && r.kind !== 'tick' ? ` · ${r.asks}` : r.kind === 'tick' && r.asks ? ` · ${r.asks}` : ''}`),
      today,
      h('div', { class: 'pv-sup-meta' }, h('span', {}, icon('bell'), r.reminder), r.habitName ? h('span', { class: 'pv-tag', 'data-tip': tip(`Linked: ${r.habitName}`, 'Ticks also go to the linked habit grid', `Its ticks count here from this item’s start, ${fmt.day(r.countsFrom)}; earlier ones are not counted`) }, icon('link'), r.habitName) : null),
      h('div', { class: 'pv-sup-meta' }, originLine(r)),
    ),
    h('div', { class: 'pv-sup-grid' }, vis),
    stat,
    h('button', { class: 'pv-icon-btn pv-sup-edit', onclick: () => ctx.onEdit(r.id), 'aria-label': `Edit ${r.name}`, 'data-tip': tip(`Edit ${r.name}`, 'Its form opens below'), 'data-k': `edit-${r.id}` }, icon('pencil')),
  );
}

function suggestionChip(x: Suggestion, ctx: HabitsContext): HTMLElement {
  const busy = !ctx.canWrite || ctx.ui.pending.has(`s:${x.id}`);
  return h('div', { class: 'pv-sg-chip' },
    h('span', { class: 'pv-rem-icon' }, icon(KIND_ICON[x.kind])),
    h('div', { class: 'pv-sg-chip-t' }, h('b', {}, x.name), ' ', h('span', { class: 'pv-kind-tag' }, KIND_LABEL[x.kind]), h('div', { class: 'pv-faint' }, x.detail), x.why ? h('div', { class: 'pv-sg-why' }, icon('review'), h('span', {}, x.why)) : null),
    h('div', { class: 'pv-sg-chip-a' },
      h('button', { class: 'pv-btn-primary is-small', disabled: busy, onclick: () => ctx.onAccept(x.id), 'data-k': `accept-${x.id}` }, icon('check'), 'Accept'),
      h('button', { class: 'pv-btn-quiet', disabled: busy, onclick: () => ctx.onDismiss(x.id), 'data-k': `dismiss-${x.id}` }, 'Dismiss')),
  );
}

function suggestions(list: readonly Suggestion[], title: string, sub: string, ctx: HabitsContext): HTMLElement | null {
  if (!list.length) return null;
  return h('div', { class: 'pv-sg-box' },
    h('div', { class: 'pv-sg-box-h' }, h('div', { class: 'pv-due-h' }, icon('review'), title), h('div', { class: 'pv-card-sub' }, sub)),
    h('div', { class: 'pv-sg-chips' }, list.map((x) => suggestionChip(x, ctx))));
}

function listCard(total: number, ctx: HabitsContext): HTMLElement {
  const m = ctx.model;
  const c = cols(total);
  const g = geom(c.avail, m.items[0]?.grid.cells.length ?? 182);
  const t = m.tiles;
  const sw = (st: string) => s('svg', { viewBox: '0 0 12 12' }, s('rect', { class: `pv-sg-cell is-${st}`, x: 0.5, y: 0.5, width: 11, height: 11, rx: 2.5 }));
  const on = ctx.ui.table;
  const rows = m.items.map((r) => [
    r.name, KIND_LABEL[r.kind], r.kind === 'supplement' ? (r.dose ?? '–') : r.asks || '–', `${r.schedule}, ${r.when}`, r.reminder,
    r.paused ? '–' : String(r.streak.value), r.adherence.pct === null ? '–' : `${Math.round(r.adherence.pct * 100)} %`,
    r.source.by === 'coach' ? 'Coach' : 'You', r.habitName ?? '–', r.paused ? `Paused since ${fmt.day(r.paused)}` : 'Active',
  ] as Child[]);
  const due = ctx.due;
  return h('section', { class: `pv-card pv-span-12${on ? ' is-table' : ''}`, 'data-card': 'habits', 'data-sec': 'habits' },
    h('div', { class: 'pv-card-head' },
      h('div', {}, h('div', { class: 'pv-kicker' }, 'Habits'), h('div', { class: 'pv-card-sub' }, `What you track: ${m.items.length} item${m.items.length === 1 ? '' : 's'}, ${m.counts.coach} suggested by your coach and ${m.counts.user} added by you. Ticks come from the reminder cards and Today`)),
      h('div', { class: 'pv-card-tools' },
        h('button', { class: 'pv-btn-primary', onclick: () => ctx.onAdd(), 'data-k': 'hab-add' }, icon('plus'), 'Add an item'),
        h('button', { class: `pv-btn-quiet${on ? ' is-on' : ''}`, onclick: () => { ctx.ui.table = !on; ctx.onChange(); }, 'data-k': 'hab-table' }, icon(on ? 'chart' : 'table'), on ? 'Chart' : 'Table')),
    ),
    suggestions(m.suggestions, 'Your coach suggests', 'New since your last letter; accept to add it, or dismiss', ctx),
    h('div', { class: 'pv-sup-tiles' },
      h('div', { class: 'pv-sup-tile' }, h('span', {}, 'Last 30 days'), h('b', {}, t.last30.pct === null ? '–' : `${Math.round(t.last30.pct * 100)} %`), h('em', {}, `${t.last30.done} of ${t.last30.due} done, across ${t.last30.active} active item${t.last30.active === 1 ? '' : 's'}`)),
      h('div', { class: 'pv-sup-tile' }, h('span', {}, 'Longest streak now'), h('b', {}, String(t.longest.days)), h('em', {}, t.longest.name ? `${t.longest.name}, ${m.items.find((x) => x.id === t.longest.item)?.streak.unit ?? 'days'} in a row` : 'Nothing in a row yet')),
      h('div', { class: 'pv-sup-tile' }, h('span', {}, 'Today'), h('b', {}, `${t.today.done} of ${t.today.due}`), h('em', {}, `done so far${due ? ` · ${due.now}` : ''}`)),
    ),
    h('div', { class: 'pv-chart-area' },
      h('div', { class: 'pv-sup-headrow' }, h('span', {}, 'Item'), h('span', { class: 'pv-sup-headgrid' }, m.items[0] ? monthsHead(m.items[0].grid.from, g) : null), h('span', {}, 'Streak · 30 days')),
      m.groups.map((gr) => [h('div', { class: 'pv-sup-group' }, gr.label), h('div', { class: 'pv-sup-list' }, gr.items.map((r) => habRow(r, c, g, ctx)))]),
      h('div', { class: 'pv-cal-legend' },
        h('span', {}, sw('taken'), 'Done (counted items: target met; sitting: within limits)'),
        h('span', {}, sw('part'), 'Half the target or more (sitting: one limit over)'),
        h('span', {}, sw('missed'), 'Not done'), h('span', {}, sw('off'), 'Not scheduled'), h('span', {}, sw('paused'), 'Paused'), h('span', {}, sw('none'), 'Not started'),
        h('span', {}, s('svg', { viewBox: '0 0 12 12' }, s('rect', { class: 'pv-cal-today', x: 1, y: 1, width: 10, height: 10, rx: 3 })), 'Today')),
    ),
    h('div', { class: 'pv-table-area' }, table([{ t: 'Item' }, { t: 'Kind' }, { t: 'Dose or target' }, { t: 'When' }, { t: 'Reminder' }, { t: 'Streak', r: true }, { t: '30 days', r: true }, { t: 'Added by' }, { t: 'Homepage habit' }, { t: 'Status' }], rows)),
    h('div', { class: 'pv-foot-note' }, icon('info'), 'Each item counts from its own start: a linked habit’s earlier ticks are not counted, and the days before read Not started. Sitting time is your keyboard and mouse activity (on a day it did not count, Habit Nudges’ desk time, read only).'),
  );
}

function emptyCard(ctx: HabitsContext): HTMLElement {
  return h('section', { class: 'pv-card pv-span-12', 'data-card': 'habits' },
    h('div', { class: 'pv-card-head' }, h('div', {}, h('div', { class: 'pv-kicker' }, 'Habits'), h('div', { class: 'pv-card-sub' }, 'What Pahlavan tracks and reminds you about is yours to choose'))),
    h('div', { class: 'pv-hab-empty' },
      h('div', { class: 'pv-hab-empty-t' }, icon('layers'), h('div', {}, h('b', {}, 'Nothing tracked yet'), h('p', {}, 'Add what you want tracked and reminded: a supplement, water, stand-ups, desk breaks, sitting time, anything you tick. Or take your coach’s suggestions below.')),
        h('button', { class: 'pv-btn-primary', onclick: () => ctx.onAdd(), 'data-k': 'hab-add' }, icon('plus'), 'Add an item')),
      suggestions(ctx.model.suggestions, 'Your coach suggests', 'From your intake and your plans; each says why. Accept to add it with these settings, change it after.', ctx),
    ),
  );
}

// ================================================================ the bring-over

function bringCard(ctx: HabitsContext): HTMLElement | null {
  const b = ctx.model.bringOver;
  if (!b || ctx.ui.bringLater) return null;
  const ui = ctx.ui;
  if (!ui.bring) ui.bring = new Set(b.items.filter((x) => x.checked).map((x) => x.id));
  const n = b.items.filter((x) => !x.already && ui.bring!.has(x.id)).length;
  const toggle = (id: string) => {
    if (ui.bring!.has(id)) ui.bring!.delete(id);
    else ui.bring!.add(id);
    ctx.onChange();
  };
  return h('section', { class: 'pv-card pv-span-12 pv-bring', 'data-card': 'bring' },
    h('div', { class: 'pv-card-head' },
      h('div', {}, h('div', { class: 'pv-kicker' }, 'Bring over from Habit Nudges'), h('h3', { class: 'pv-card-title' }, 'What you track there today'), h('div', { class: 'pv-card-sub' }, 'Once: tick what Pahlavan should take over. Each keeps its linked habit and its history. It also turns on the morning check-in and keeps the body record’s every-N-days dates until your plan sets them.')),
      h('div', { class: 'pv-card-tools' },
        h('button', { class: 'pv-btn-quiet', onclick: () => ctx.onBringLater(), 'data-k': 'bring-later' }, 'Not now'),
        h('button', { class: 'pv-btn-primary', disabled: !ctx.canWrite || ui.busy || n === 0, onclick: () => ctx.onBring(), 'data-k': 'bring-go' }, icon('check'), ui.busy ? 'Bringing over…' : `Bring over ${n}`)),
    ),
    h('ul', { class: 'pv-bring-list' }, b.items.map((x) => {
      const onTick = ui.bring!.has(x.id) && !x.already;
      return h('li', { class: x.already ? 'is-already' : '' },
        h('button', { class: `pv-ntick${onTick ? ' is-on' : ''}`, disabled: x.already, 'aria-pressed': onTick ? 'true' : 'false', 'aria-label': x.name, onclick: () => toggle(x.id), 'data-k': `bring-${x.id}` }, onTick ? icon('check') : null),
        h('span', { class: 'pv-rem-icon' }, icon(KIND_ICON[x.kind])),
        h('div', {}, h('b', {}, x.name), ' ', h('span', { class: 'pv-kind-tag' }, KIND_LABEL[x.kind]), h('div', { class: 'pv-faint' }, x.already ? 'Pahlavan tracks it already' : x.detail)),
        x.habitName ? h('span', { class: 'pv-tag' }, icon('link'), x.habitName) : h('span', {}),
        x.coachToo && !x.already ? h('span', { class: 'pv-bring-also' }, 'your coach suggests it too') : null,
      );
    })),
    h('div', { class: 'pv-foot-note' }, icon('info'), h('span', {}, `Habit Nudges keeps the word cards, the plan reminders and the work timer; Pahlavan reads your activity for sitting time but never writes the work timer.${b.left.length ? ` Staying there: ${b.left.map((x) => `${x.name} (${x.why.replace(/\.$/, '').toLowerCase()})`).join('; ')}.` : ''} Not now asks again next time; once you’ve brought anything over, it doesn’t ask again.`, ' ', h('button', { class: 'pv-link-btn', disabled: !ctx.canWrite || ui.busy, onclick: () => ctx.onBringNever(), 'data-k': 'bring-never' }, 'Start fresh instead'), '.')),
  );
}

// ================================================================ the form

const kb = (k: string) => ({ 'data-k': k });
function sw(on: boolean, label: string, onclick: () => void, k: string): HTMLElement {
  return h('button', { class: `pv-sw${on ? ' is-on' : ''}`, role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': label, onclick, ...kb(k) });
}
function numIn(value: number, unit: string, set: (v: number) => void, k: string, opt: { step?: number; disabled?: boolean } = {}): HTMLElement {
  const input = h('input', { type: 'number', value: Number.isFinite(value) ? value : '', step: opt.step ?? 1, min: 0, disabled: opt.disabled, 'aria-label': unit, ...kb(k) });
  input.addEventListener('input', () => set(input.value.trim() === '' ? NaN : Number(input.value)));
  return h('span', { class: `pv-field-in pv-sf-n${opt.disabled ? ' is-off' : ''}` }, input, h('em', {}, unit));
}
function timeIn(value: string, set: (v: string) => void, k: string, opt: { disabled?: boolean } = {}): HTMLElement {
  const input = h('input', { type: 'time', value, disabled: opt.disabled, ...kb(k) });
  input.addEventListener('input', () => set(input.value));
  return h('span', { class: `pv-field-in pv-sf-time${opt.disabled ? ' is-off' : ''}` }, input);
}
function textIn(value: string, set: (v: string) => void, k: string, placeholder = '', cls = ''): HTMLElement {
  const input = h('input', { type: 'text', value, placeholder, ...kb(k) });
  input.addEventListener('input', () => set(input.value));
  return h('span', { class: `pv-field-in${cls ? ` ${cls}` : ''}` }, input);
}
function select(options: readonly { value: string; label: string }[], value: string, set: (v: string) => void, k: string, cls = 'pv-sel'): HTMLElement {
  const el = h('select', { class: cls, ...kb(k) }, options.map((o) => h('option', { value: o.value, ...(o.value === value ? { selected: true } : {}) }, o.label)));
  el.addEventListener('change', () => set(el.value));
  return el;
}
const hint = (ic: string, ...text: Child[]) => h('div', { class: 'pv-sf-hint' }, icon(ic), h('span', {}, text));

function stepsEditor(f: ItemForm, ctx: HabitsContext): HTMLElement {
  const redraw = () => ctx.onChange();
  return h('div', { class: 'pv-sf-steps-edit' },
    h('ol', { class: 'pv-sf-steps' }, f.steps.map((st: DeskStep, i) => h('li', {},
      textIn(st.name, (v) => { f.steps[i] = { ...f.steps[i]!, name: v }; }, `step-name-${i}`, 'A movement'),
      textIn(st.dose, (v) => { f.steps[i] = { ...f.steps[i]!, dose: v }; }, `step-dose-${i}`, '×10, 30 s', 'is-dose'),
      h('button', { class: 'pv-icon-btn', 'aria-label': `Remove ${st.name || 'this step'}`, onclick: () => { f.steps.splice(i, 1); redraw(); }, ...kb(`step-x-${i}`) }, icon('x')),
    ))),
    h('button', { class: 'pv-btn-quiet', onclick: () => { f.steps.push({ name: '', dose: '' }); redraw(); }, ...kb('step-add') }, icon('plus'), 'Add a step'),
  );
}

function kindSettings(f: ItemForm, ctx: HabitsContext): HTMLElement | null {
  const redraw = () => ctx.onChange();
  if (f.kind === 'standup') {
    return h('div', { class: 'pv-sf-q' }, h('div', { class: 'pv-sf-label' }, 'Stand-ups'),
      h('div', { class: 'pv-sf-line' }, 'Sit for', numIn(f.sit, 'min', (v) => { f.sit = v; }, 'f-sit'), 'of active use, then stand for', numIn(f.stand, 'min', (v) => { f.stand = v; }, 'f-stand')),
      h('div', { class: 'pv-sf-line' }, 'Snooze', numIn(f.snooze, 'min', (v) => { f.snooze = v; }, 'f-snooze'), '· aim for', numIn(f.standTarget, 'min', (v) => { f.standTarget = v; }, 'f-target'), 'standing a day'),
      h('div', { class: 'pv-sf-line' }, 'Between', timeIn(f.hoursFrom, (v) => { f.hoursFrom = v; }, 'f-h0'), 'and', timeIn(f.hoursTo, (v) => { f.hoursTo = v; }, 'f-h1'), h('span', { class: 'pv-faint' }, '(empty: all day)')),
      h('div', { class: 'pv-sf-opt' }, sw(f.activeOnly, 'Count only while active', () => { f.activeOnly = !f.activeOnly; redraw(); }, 'f-active'),
        h('div', {}, h('b', {}, 'Count only while active'), h('div', { class: 'pv-faint' }, 'Keyboard or mouse in the last ', numIn(f.activeSeconds, 's', (v) => { f.activeSeconds = v; }, 'f-activesec'), '; time away over ', numIn(f.away, 'min', (v) => { f.away = v; }, 'f-away'), ' resets the count.'))),
      hint('info', 'The card can’t be closed, only started or snoozed. Standing minutes go to the linked habit, when there is one.'),
    );
  }
  if (f.kind === 'desk') {
    const plan = ctx.model.planDesk;
    const follow = f.followPlan && plan !== null;
    return h('div', { class: 'pv-sf-q' }, h('div', { class: 'pv-sf-label' }, 'Desk breaks'),
      h('div', { class: 'pv-sf-opt' }, sw(f.followPlan, 'Follow the plan', () => { f.followPlan = !f.followPlan; redraw(); }, 'f-follow'),
        h('div', {}, h('b', {}, 'Follow the plan'), h('div', { class: 'pv-faint' }, plan ? 'The routine and the times come from your plan and change with it. Off: they stay as you set them.' : 'Your plan has no desk breaks yet: these times and steps apply until it has.'))),
      h('div', { class: `pv-sf-line${follow ? ' is-off' : ''}` }, 'Every', numIn(follow ? plan.every : f.deskEvery, 'min', (v) => { f.deskEvery = v; }, 'f-every', { disabled: follow }), 'from', timeIn(follow ? plan.from : f.deskFrom, (v) => { f.deskFrom = v; }, 'f-dfrom', { disabled: follow }), 'to', timeIn(follow ? plan.to : f.deskTo, (v) => { f.deskTo = v; }, 'f-dto', { disabled: follow })),
      follow
        ? [h('ol', { class: 'pv-sf-steps is-off' }, plan.steps.map((x) => h('li', {}, h('b', {}, x.name), ' ', h('span', { class: 'pv-faint' }, x.dose)))), hint('layers', `From your plan: ${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'}, about ${plan.minutes} minutes.`)]
        : stepsEditor(f, ctx),
    );
  }
  if (f.kind === 'sitting') {
    return h('div', { class: 'pv-sf-q' }, h('div', { class: 'pv-sf-label' }, 'Sitting time'),
      h('div', { class: 'pv-sf-line' }, 'Under', numIn(Math.round((f.limitMinutes / 60) * 10) / 10, 'h', (v) => { f.limitMinutes = Math.round(v * 60); }, 'f-limit', { step: 0.5 }), 'a day · no stretch over', numIn(f.stretchMax, 'min', (v) => { f.stretchMax = v; }, 'f-stretch')),
      h('div', { class: 'pv-sf-line' }, 'Time away over', numIn(f.awayEnds, 'min', (v) => { f.awayEnds = v; }, 'f-awayends'), 'ends a stretch'),
      hint('info', 'Counted from keyboard and mouse activity on a Mac. Pahlavan only reads the activity.'),
    );
  }
  return null;
}

function reminderControl(f: ItemForm, ctx: HabitsContext): Child {
  const redraw = () => ctx.onChange();
  if (f.kind === 'standup' || f.kind === 'desk') return h('span', { class: 'pv-faint' }, f.kind === 'standup' ? 'The stand-up card is the reminder.' : 'A card at each break.');
  if (f.kind === 'sitting') {
    const atText = `${Math.floor(f.limitAt / 60)}:${String(f.limitAt % 60).padStart(2, '0')}`;
    const input = h('input', { type: 'text', value: atText, 'aria-label': 'Hours of sitting', ...kb('f-limitat') });
    input.addEventListener('input', () => {
      const m = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(input.value.trim());
      if (m) f.limitAt = Number(m[1]) * 60 + Number(m[2] ?? 0);
    });
    return [sw(f.limitRemind, 'Reminder', () => { f.limitRemind = !f.limitRemind; redraw(); }, 'f-remind'),
      f.limitRemind ? [h('span', { class: 'pv-faint' }, 'a card at'), h('span', { class: 'pv-field-in pv-sf-n' }, input, h('em', {}, 'h')), h('span', { class: 'pv-faint' }, `of sitting, and when a stretch reaches ${f.stretchMax} min`)] : h('span', { class: 'pv-faint' }, 'No card; Today shows it')];
  }
  const toggle = sw(f.remind, 'Reminder', () => { f.remind = !f.remind; redraw(); }, 'f-remind');
  if (!f.remind) return [toggle, h('span', { class: 'pv-faint' }, 'No card; tick it on Today')];
  if (f.kind === 'amount' && f.when === 'day') return [toggle, h('span', { class: 'pv-sf-every' }, h('span', { class: 'pv-faint' }, 'every'), numIn(f.every, 'min', (v) => { f.every = v; }, 'f-revery'), h('span', { class: 'pv-faint' }, 'from'), timeIn(f.from, (v) => { f.from = v; }, 'f-rfrom'), h('span', { class: 'pv-faint' }, 'to'), timeIn(f.to, (v) => { f.to = v; }, 'f-rto'), h('span', { class: 'pv-faint' }, 'until the target'))];
  if (f.when === 'training' && f.kind !== 'amount') {
    return [toggle, select([{ value: 'after', label: 'When I log a session' }, { value: 'time', label: 'At a set time' }], f.afterLog ? 'after' : 'time', (v) => { f.afterLog = v === 'after'; redraw(); }, 'f-rkind'), f.afterLog ? null : timeIn(f.remindAt, (v) => { f.remindAt = v; }, 'f-rat')];
  }
  return [toggle, timeIn(f.remindAt, (v) => { f.remindAt = v; }, 'f-rat'), h('span', { class: 'pv-faint' }, `on one card with the other items at that time`)];
}

function editorCard(ctx: HabitsContext): HTMLElement {
  const ui = ctx.ui;
  const f = ui.form;
  const m = ctx.model;
  const redraw = () => ctx.onChange();
  const simple = f.kind === 'supplement' || f.kind === 'amount' || f.kind === 'tick';
  const editing = f.id !== null;
  const base = ui.base;
  const kindSeg = h('div', { class: 'pv-seg pv-sf-kind' }, (Object.keys(KIND_LABEL) as ItemKind[]).map((k) => h('button', { class: f.kind === k ? 'is-on' : '', disabled: editing && f.kind !== k, ...(editing && f.kind !== k ? { 'data-tip': tip('The kind stays', 'An item keeps its kind and its history; add a new item for another kind') } : {}), onclick: () => { ui.form = withKind(f, k); redraw(); }, ...kb(`kind-${k}`) }, icon(KIND_ICON[k]), KIND_LABEL[k])));
  const what = f.kind === 'supplement'
    ? h('div', { class: 'pv-field' }, h('span', {}, 'Dose'), h('div', { class: 'pv-sf-dose' }, textIn(f.doseAmount, (v) => { f.doseAmount = v; }, 'f-dose', '5'), select([...new Set([...DOSE_UNITS, f.doseUnit])].map((u) => ({ value: u, label: u })), f.doseUnit, (v) => { f.doseUnit = v; }, 'f-doseunit')))
    : f.kind === 'amount'
      ? h('div', { class: 'pv-field' }, h('span', {}, 'Daily target'), h('div', { class: 'pv-sf-dose' }, h('span', { class: 'pv-field-in' }, (() => { const i = h('input', { type: 'number', value: f.target, min: 0, ...kb('f-amt') }); i.addEventListener('input', () => { f.target = Number(i.value); }); return i; })()), select([...new Set([...AMOUNT_UNITS, f.unit])].map((u) => ({ value: u, label: u })), f.unit, (v) => { f.unit = v; redraw(); }, 'f-unit')))
      : f.kind === 'tick'
        ? h('div', { class: 'pv-field' }, h('span', {}, 'Done means ', h('em', { class: 'pv-sf-vault' }, 'optional')), textIn(f.means, (v) => { f.means = v; }, 'f-means', 'e.g. all teeth'))
        : h('div', {});
  const nameIn = textIn(f.name, (v) => {
    f.name = v;
    const t = ctx.ui.form === f ? activeDocument.querySelector('[data-card="editor"] .pv-card-title') : null;
    if (t) t.textContent = v || 'New item';
  }, 'f-name', { amount: 'e.g. Water', tick: 'e.g. Flossing', supplement: 'e.g. Creatine', standup: 'Stand-ups', desk: 'Desk breaks', sitting: 'Sitting time' }[f.kind]);
  const quick = f.kind === 'amount'
    ? h('div', { class: 'pv-sf-q' }, h('div', { class: 'pv-sf-label' }, 'Quick amounts ', h('span', { class: 'pv-faint' }, '(the buttons on its card)')),
        h('div', { class: 'pv-sf-chips' }, f.quick.map((q, i) => h('span', { class: 'pv-sf-chip' }, `+${nfmt(q)} ${f.unit}`, h('button', { class: 'pv-icon-btn', 'aria-label': `Remove ${q}`, onclick: () => { f.quick.splice(i, 1); redraw(); }, ...kb(`quick-x-${q}`) }, icon('x')))),
          (() => {
            const i = h('input', { type: 'number', min: 0, placeholder: 'amount', 'aria-label': 'A quick amount', ...kb('quick-in') });
            const add = () => { const v = Number(i.value); if (v > 0 && !f.quick.includes(v)) { f.quick.push(v); f.quick.sort((a, b) => a - b); redraw(); } };
            i.addEventListener('keydown', (ev) => { if ((ev).key === 'Enter') add(); });
            return [h('span', { class: 'pv-field-in pv-sf-n' }, i, h('em', {}, f.unit)), h('button', { class: 'pv-btn-quiet', onclick: add, ...kb('quick-add') }, icon('plus'), 'Add')];
          })()))
    : null;
  const whenQ = simple
    ? h('div', { class: 'pv-sf-q' }, h('div', { class: 'pv-sf-label' }, 'When'),
        h('div', { class: 'pv-pills' }, WHEN_CHOICES[f.kind as 'supplement'].map((k: ItemSlot) => h('button', { class: `pv-pill${f.when === k ? ' is-on' : ''}`, onclick: () => { ui.form = withWhen(f, k); redraw(); }, ...kb(`when-${k}`) }, WHEN_LABEL[k]))),
        f.when === 'training' ? h('div', { class: 'pv-sf-sub' }, h('span', { class: 'pv-faint' }, 'The session:'), h('div', { class: 'pv-seg' }, (['before', 'after'] as const).map((k) => h('button', { class: f.whenDetail === k ? 'is-on' : '', onclick: () => { f.whenDetail = k; redraw(); }, ...kb(`wd-${k}`) }, k === 'before' ? 'Before' : 'After')))) : null,
        f.when === 'time' ? h('div', { class: 'pv-sf-sub' }, h('span', { class: 'pv-faint' }, 'At'), timeIn(f.remindAt, (v) => { f.remindAt = v; }, 'f-at')) : null)
    : null;
  const oftenQ = h('div', { class: 'pv-sf-q' }, h('div', { class: 'pv-sf-label' }, 'How often'),
    h('div', { class: 'pv-pills' }, oftenChoices(f.kind).map((k: ScheduleKind) => h('button', { class: `pv-pill${f.often === k ? ' is-on' : ''}`, onclick: () => { f.often = k; redraw(); }, ...kb(`often-${k}`) }, OFTEN_LABEL[k]))),
    f.often === 'weekdays' ? h('div', { class: 'pv-sf-sub pv-sf-wd' }, WD.map((x) => h('button', { class: `pv-tap${f.days.includes(x.d) ? ' is-on' : ''}`, 'aria-pressed': f.days.includes(x.d) ? 'true' : 'false', 'aria-label': x.d, onclick: () => { f.days = f.days.includes(x.d) ? f.days.filter((d) => d !== x.d) : [...f.days, x.d]; redraw(); }, ...kb(`day-${x.d}`) }, x.l))) : null,
    f.often === 'every' ? h('div', { class: 'pv-sf-sub' }, h('span', { class: 'pv-faint' }, 'Every'), numIn(f.n, 'days', (v) => { f.n = v; }, 'f-n')) : null,
    f.often === 'training' ? hint('info', 'Training days are the days you log a session (or have one planned, for a reminder before it).') : null);
  const linkable = m.homepage !== null && ['supplement', 'amount', 'tick', 'standup'].includes(f.kind);
  const habitName = f.habit ? (m.homepage?.find((x) => x.id === f.habit)?.name ?? f.habit) : null;
  const origin = editing && base
    ? base.source.by === 'coach'
      ? h('div', { class: 'pv-sf-origin is-coach' }, icon('review'), h('div', {}, h('b', {}, 'Suggested by your coach'), base.source.why ? h('span', {}, base.source.why) : null))
      : h('div', { class: 'pv-sf-origin' }, icon('plus'), h('div', {}, h('b', {}, 'Added by you'), base.source.from ? h('span', {}, `Brought over from ${base.source.from}`) : null))
    : null;
  const paused = base ? (base.pauses ?? []).some((p) => p.from <= m.date && (!p.to || p.to >= m.date)) : false;
  const banner = ui.conflict?.length
    ? h('div', { class: 'pv-lg-banner is-conflict' }, icon('alert'), h('span', {}, 'Changed elsewhere since this form opened (the other Mac, or the coach): saving now would replace that change.'),
        h('button', { class: 'pv-btn-quiet', onclick: () => ctx.onCancel(), ...kb('f-keep') }, 'Keep theirs'), h('button', { class: 'pv-btn-quiet', onclick: () => ctx.onSave(true), ...kb('f-force') }, 'Save mine'))
    : ui.error ? h('div', { class: 'pv-lg-banner is-error' }, icon('alert'), h('span', {}, ui.error)) : null;
  return h('section', { class: 'pv-card pv-span-7', 'data-card': 'editor' },
    h('div', { class: 'pv-card-head' },
      h('div', {}, h('div', { class: 'pv-kicker' }, editing ? 'Edit item' : 'Add an item'), h('h3', { class: 'pv-card-title' }, f.name || 'New item'), h('div', { class: 'pv-card-sub' }, editing ? 'Changes apply from today; past days stay as they are' : 'It joins today’s reminders at its time')),
      h('div', { class: 'pv-card-tools' }, h('button', { class: 'pv-btn-quiet', onclick: () => ctx.onCancel(), ...kb('f-cancel') }, 'Cancel'), h('button', { class: 'pv-btn-primary', disabled: !ctx.canWrite || ui.busy, onclick: () => ctx.onSave(false), ...kb('f-save') }, icon('check'), ui.busy ? 'Saving…' : 'Save')),
    ),
    banner,
    h('div', { class: 'pv-sf' },
      origin,
      h('div', { class: 'pv-sf-q pv-sf-first' }, h('div', { class: 'pv-sf-label' }, 'Kind'), kindSeg, hint('info', KIND_HINT[f.kind])),
      h('div', { class: 'pv-sf-row pv-sf-2' }, h('label', { class: 'pv-field' }, h('span', {}, 'Name'), nameIn), what),
      quick,
      kindSettings(f, ctx),
      whenQ,
      oftenQ,
      h('div', { class: 'pv-sf-q' }, h('div', { class: 'pv-sf-label' }, 'Reminder'), h('div', { class: 'pv-sf-remind' }, reminderControl(f, ctx))),
      h('div', { class: 'pv-sf-row pv-sf-2' },
        h('label', { class: 'pv-field' }, h('span', {}, 'Start date'), (() => { const i = h('input', { type: 'date', value: f.start, ...kb('f-start') }); i.addEventListener('input', () => { f.start = i.value; }); return h('span', { class: 'pv-field-in' }, i); })()),
        linkable ? h('label', { class: 'pv-field' }, h('span', {}, 'Linked habit ', h('em', { class: 'pv-sf-vault' }, 'this vault')), select([{ value: '', label: 'Not linked' }, ...m.homepage!.map((x) => ({ value: x.id, label: x.name }))], f.habit, (v) => { f.habit = v; redraw(); }, 'f-habit', 'pv-sel pv-sf-sel')) : h('div', {}),
      ),
      linkable ? hint('link', habitName ? ['Ticks also go to the linked habit ', h('b', {}, habitName), '; its ticks count here from this item’s start, not before.'] : 'Not linked: only Pahlavan keeps its ticks.') : null,
      h('label', { class: 'pv-field' }, h('span', {}, 'Note'), (() => { const t = h('textarea', { class: 'pv-ta', rows: 2, placeholder: 'Anything to remember: with food, before bed…', ...kb('f-note') }, f.note); t.addEventListener('input', () => { f.note = t.value; }); return t; })()),
      editing
        ? h('div', { class: 'pv-sf-foot' },
            ui.confirmRemove
              ? [h('span', { class: 'pv-sf-confirm' }, icon('alert'), `Remove ${base?.name ?? 'it'} and its history? Its ticks in Pahlavan go; a linked habit keeps its own.`), h('button', { class: 'pv-btn-quiet pv-sf-del', disabled: !ctx.canWrite || ui.busy, onclick: () => ctx.onRemove(), ...kb('f-remove-yes') }, icon('x'), 'Remove it'), h('button', { class: 'pv-btn-quiet', onclick: () => { ui.confirmRemove = false; redraw(); }, ...kb('f-remove-no') }, 'Keep it')]
              : [h('button', { class: 'pv-btn-quiet', disabled: !ctx.canWrite || ui.busy, onclick: () => (paused && base ? ctx.onResume(base.id) : ctx.onPause()), ...kb('f-pause') }, icon(paused ? 'play' : 'pause'), paused ? 'Resume it' : 'Pause it'), h('button', { class: 'pv-btn-quiet pv-sf-del', disabled: !ctx.canWrite, onclick: () => { ui.confirmRemove = true; redraw(); }, ...kb('f-remove') }, icon('x'), 'Remove'), h('span', { class: 'pv-faint' }, 'Pausing keeps its history; removing asks first.')])
        : null,
    ),
  );
}

// ================================================================ today's reminders

interface Slot {
  t: string;
  order: string;
  ic: string;
  title: string;
  sub: string;
  state: 'done' | 'open' | 'later' | 'skip' | 'paused';
  key: string | null;
  link?: string;
}

/** Today's reminders, in order: what pops up when. */
export function todayCard(ctx: HabitsContext): HTMLElement {
  if (ctx.clock) clockText = ctx.clock;
  const d = ctx.due;
  const m = ctx.model;
  const rows: Slot[] = [];
  if (d) {
    const now = d.now;
    if (d.morning.on || d.morning.done) {
      const saved = at(d.morning.checkedAt);
      rows.push({ t: d.morning.at ?? saved ?? '–', order: d.morning.at ?? saved ?? '06:00', ic: 'clipboard', title: 'Morning check-in', sub: d.morning.done ? `Saved${saved ? ` at ${saved}` : ''}` : 'About 30 seconds', state: d.morning.done ? 'done' : (d.morning.at ?? '') > now ? 'later' : 'open', key: 'morning' });
    }
    for (const sl of d.habits.slots) {
      const items = sl.items;
      const first = m.items.find((x) => x.id === items[0]?.id);
      const label = sl.key === 'after-log' ? 'After the session' : first?.item.when && first.item.when !== 'time' ? `${WHEN_LABEL[first.item.when]} items` : 'Items';
      const done = items.every((x) => x.done);
      const some = items.some((x) => x.done);
      rows.push({ t: sl.time ?? (sl.key === 'after-log' ? 'After' : 'Any'), order: sl.time ?? (sl.key === 'after-log' ? '17:00' : '12:00'), ic: 'pill', title: label, sub: items.map((x) => x.name).join(', '), state: done ? 'done' : some ? 'open' : sl.time && sl.time > now ? 'later' : sl.key === 'after-log' ? 'later' : 'open', key: sl.time ? `slot:${sl.time}` : sl.key === 'after-log' ? 'slot:after-log' : null });
    }
    for (const a of d.amounts) {
      const it = m.items.find((x) => x.id === a.id)?.item;
      const r = it?.reminder;
      const from = r?.from ?? r?.at ?? null;
      rows.push({ t: from ? `${from}${r?.every ? '+' : ''}` : '–', order: from ?? '12:00', ic: 'drop', title: a.name, sub: `${r?.every ? `Every ${r.every % 60 === 0 ? `${r.every / 60} h` : `${r.every} min`} until ${nfmt(a.target)} ${a.unit}` : `${nfmt(a.target)} ${a.unit} a day`} · ${a.met ? 'target met' : `next ${a.next ?? 'none'}`}`, state: a.met ? 'done' : 'open', key: `amount:${a.id}` });
    }
    for (const x of d.desk) {
      // The routine's window as it runs (the plan's when the item follows it), as the row's "10:00 to 16:30".
      const row = m.items.find((i) => i.id === x.id);
      const to = row?.desk?.to ?? x.times.at(-1);
      const every = row?.desk?.every;
      rows.push({ t: x.times[0] ? `${x.times[0]}+` : '–', order: x.times[0] ?? '10:00', ic: 'monitor', title: x.name, sub: `${x.times.length > 1 && every ? `Every ${every} min to ${to}` : x.times.join(', ')} · ${x.done} of ${x.total}`, state: x.done >= x.total ? 'done' : 'open', key: `desk:${x.id}` });
    }
    for (const x of d.standups) rows.push({ t: 'Sitting', order: '10:30', ic: 'stand', title: x.name, sub: `After ${x.sitMinutes} min of active sitting · ${standCount(x.count)}`, state: x.minutes >= x.target ? 'done' : 'open', key: `standup:${x.id}`, link: 'ask me now' });
    for (const x of d.sitting) {
      const it = m.items.find((i) => i.id === x.id)?.item;
      const at = it?.reminder?.atMinutes;
      rows.push({ t: 'Limit', order: '15:30', ic: 'clock', title: x.name, sub: `${at ? `A card at ${hm(at)} of ${hm(x.limit)}` : `Under ${hm(x.limit)}`} · now ${hm(x.minutes)}`, state: x.overLimit ? 'open' : 'later', key: `sitting:${x.id}` });
    }
    rows.push({ t: d.train.at, order: d.train.at, ic: 'dumbbell', title: 'Did you train today?', sub: !d.train.on ? 'Off in the Settings tab' : d.train.needed ? 'Only when nothing is logged by then' : 'Only when nothing is logged by then · not today', state: d.train.needed && d.train.on ? (now >= d.train.at ? 'open' : 'later') : 'skip', key: d.train.needed ? 'train' : null });
  }
  rows.sort((a, b) => a.order.localeCompare(b.order));
  const paused = m.items.filter((x) => x.paused);
  const status = (r: Slot): Child => r.state === 'done' ? h('span', { class: 'pv-status is-in' }, icon('check'), 'Done') : r.state === 'open' ? h('span', { class: 'pv-status is-neutral' }, icon('clock'), 'Open') : r.state === 'skip' ? h('span', { class: 'pv-faint' }, 'not needed') : h('span', { class: 'pv-faint' }, 'later');
  return h('section', { class: 'pv-card pv-span-5', 'data-card': 'today', 'data-live': 'reminders', 'data-sec': 'reminders' },
    h('div', { class: 'pv-card-head' }, h('div', {}, h('div', { class: 'pv-kicker' }, 'Today’s reminders'), h('div', { class: 'pv-card-sub' }, 'One card per time slot; water, stand-ups and desk breaks repeat through the day'))),
    !d ? h('p', { class: 'pv-calm' }, icon('info'), 'The reminder cards are not running in this window.') : null,
    h('ul', { class: 'pv-slot-list' },
      rows.map((r) => h('li', { class: r.state === 'skip' ? 'is-paused' : '' },
        h('div', { class: 'pv-slot-t' }, h('b', {}, r.t)),
        h('div', { class: 'pv-slot-items' },
          h('div', {}, h('span', {}, icon(r.ic), h('b', {}, r.title)), status(r)),
          h('div', { class: 'pv-faint pv-slot-sub' }, r.sub, r.key && ctx.onOpenKey ? [' · ', h('button', { class: 'pv-link-btn', onclick: () => ctx.onOpenKey!(r.key!), ...kb(`see-${r.key}`) }, r.link ?? 'see the card')] : null),
        ))),
      paused.map((x) => h('li', { class: 'is-paused' }, h('div', { class: 'pv-slot-t' }, h('b', {}, x.item.reminder?.at ?? '–')), h('div', { class: 'pv-slot-items' }, h('div', {}, h('span', {}, icon('pause'), h('b', {}, x.name)), h('span', { class: 'pv-faint' }, 'paused'))))),
    ),
  );
}

// ================================================================ the section

/** Builds the Habits section's cards into the Progress grid (its children are replaced). */
export function renderHabits(grid: HTMLElement, total: number, ctx: HabitsContext): void {
  const m = ctx.model;
  if (ctx.clock) clockText = ctx.clock;
  const errors = m.errors.length ? h('div', { class: 'pv-notes pv-span-12' }, m.errors.map((e) => h('div', { class: 'pv-note is-error' }, icon('alert'), h('span', {}, e.message)))) : null;
  grid.replaceChildren(...[
    errors,
    m.items.length ? listCard(total, ctx) : emptyCard(ctx),
    bringCard(ctx),
    editorCard(ctx),
    todayCard(ctx),
  ].filter((x): x is HTMLElement => x !== null));
}
