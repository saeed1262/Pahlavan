// The Plan screen, as signed off in mockups/plan.html: the banner (this
// mesocycle on the ring), the macrocycle timeline (phases, mesocycles, weeks,
// decisions, busy weeks, the Ledger and the plan's temporary changes), this
// mesocycle's templates, planned sets per muscle, the phase targets, the
// training load, what comes up (each Sunday's check-in naming the coach step
// after it, with its command) and the desk breaks. Every number comes from
// the engine's buildPlan (the desk breaks: buildDeskCard); this module lays
// it out, packed in two columns when the folds are known (At a glance, as
// mockups/glance-plan.html).

import { mesocycleWeeks } from '../../../src/report/banners.ts';
import type { buildPlan } from '../../../src/report/plan-screen.ts';
import { banner, bannerKicker, phaseLabel, phaseTitle, type BannerPhase, type RingSeg } from './banner.ts';
import { h, icon, iconGroup, s, type Child } from './dom.ts';
import { addDays, clean, daysBetween, fmt } from './format.ts';
import type { GuideEntry } from '../../../src/report/dashboard.ts';
import { guideName, guidePanel } from './guide.ts';
import { cardHead, niceTicks, scale, statusChip, table, tip, type ProgressContext } from './progress.ts';
import { regionAim, regionAimValue, regionTipLines } from './regions.ts';
import { deskCard, type DeskCardContext } from './desk-card.ts';
import { planWhyPanel } from './today.ts';
import { bodyFmt, type BodyUnits } from './units.ts';
import { MESOCYCLE, SHORT } from './terms.ts';
import { stepWords } from './coach.ts';
import { COACH_COMMANDS } from '../../../src/core/coach-steps.ts';
import { calibrationNote } from '../../../src/core/calibration.ts';
import { lightDoseText } from '../../../src/core/rules.ts';

/** The Plan's context: Progress's, plus the movement guide and the plan's notes. */
export interface PlanContext extends ProgressContext {
  /** Copies a command (the empty card's Copy); absent: the command shows without it. */
  onCopy?: (text: string) => void;
  guide?(name: string): GuideEntry[];
  openGuides?: Set<string>;
  onToggleGuide?: (key: string) => void;
  links?: { label: string; path: string; icon: string }[];
  onOpenNote?: (path: string) => void;
  hero: PlanHero;
  /** The Desk breaks card (absent: not drawn). */
  desk?: DeskCardContext | null;
  /** Which sessions' Why panels are open ("plan:<type>:<name>"), and the toggle. */
  openWhy?: Set<string>;
  onToggleWhy?: (key: string) => void;
  /** Which sections are folded (At a glance): given, a wide page packs them in two columns. */
  folded?: (id: string) => boolean;
}

/** What the Plan banner needs besides the report: the phase's look and name, and the plan's sessions a week. */
export interface PlanHero {
  phase: BannerPhase;
  phaseOf: { index: number; name: string } | null;
  weekTarget: { lift: number; short: number } | null;
}

export type PlanModel = ReturnType<typeof buildPlan>;
type Ok = Extract<PlanModel, { templates: unknown }>;

const inner = (w: number) => w - 46;
const range = (a: string, b: string) => (a === b ? fmt.day(a) : a.slice(5, 7) === b.slice(5, 7) ? `${+a.slice(8)} to ${fmt.day(b)}` : `${fmt.day(a)} to ${fmt.day(b)}`);
const card = (id: string | null, span: string, ctx: ProgressContext, head: HTMLElement, chart: Child, tbl: Child = null) =>
  h('section', { class: `pv-card ${span}${id && ctx.tables.has(id) ? ' is-table' : ''}`, 'data-sec': id }, head, h('div', { class: 'pv-chart-area' }, chart), tbl ? h('div', { class: 'pv-table-area' }, tbl) : null);
const headNoTable = (kicker: string, sub: string | null) => h('div', { class: 'pv-card-head' }, h('div', {}, h('div', { class: 'pv-kicker' }, kicker), sub ? h('div', { class: 'pv-card-sub' }, sub) : null));
const calm = (text: string) => h('p', { class: 'pv-calm' }, icon('info'), text);
const keySw = (cls: string, label: string, shape: 'week' | 'rect' | 'dec' = 'rect') => h('span', {}, s('svg', { viewBox: '0 0 16 12' }, shape === 'dec' ? s('rect', { class: cls, x: 4, y: 2, width: 8, height: 8, transform: 'rotate(45 8 6)' }) : s('rect', { class: cls, x: 1, y: shape === 'week' ? 1 : 2, width: 14, height: shape === 'week' ? 10 : 8, rx: shape === 'week' ? 3 : 2 })), label);

// ================================================================ timeline
/** A temporary change's timeline label: a swap reads "X in for Y"; any other "until" note names the item alone. */
export function temporaryLabel(t: { item: string; wayBack: string | null }): string {
  return t.wayBack ? `${t.item} in for ${t.wayBack}` : t.item;
}

/** A Ledger limit's ruled-out movements by name; one the engine does not recognise is marked, since it blocks nothing. */
export function ledgerMovements(movements: readonly { name: string; known: boolean }[]): string {
  return movements.map((x) => (x.known ? x.name : `${x.name} (not recognised)`)).join(', ');
}

function timeline(m: Ok, width: number, ctx: ProgressContext): HTMLElement {
  const W = inner(width);
  const weeks = m.weeks;
  const start = weeks[0]!.start;
  const left = 92;
  const wk = (W - left - 14) / weeks.length;
  const x = (d: string) => left + (daysBetween(start, d) / 7) * wk;
  const xEnd = left + weeks.length * wk;
  const spans = [...m.ledger.map((c) => {
    const unknown = c.movements.filter((x) => !x.known);
    return { kind: 'ledger' as const, label: `${c.area}: ${c.noTags.length ? 'no high-strain lifts' : c.movements.length ? `no ${ledgerMovements(c.movements)}` : 'limit'}`, until: c.until, tip: tip(`Ledger · ${c.area}`, c.noTags.length ? `Ruled out: ${c.noTags.join(', ')}` : c.movements.length ? `Ruled out: ${ledgerMovements(c.movements)}` : null, unknown.length ? `Not recognised (neither an engine movement nor one of the plan’s), so it rules out nothing: ${unknown.map((x) => x.id).join(', ')}` : null, c.note, c.until ? `Until ${fmt.wd(c.until)}` : 'No end date', 'In force before the plan began (the Ledger keeps no start date)') };
  }),
    ...m.temporary.map((t) => ({ kind: 'change' as const, label: temporaryLabel(t), until: t.until, tip: tip(`Temporary change · ${t.session}`, t.wayBack ? `${t.item} in place of ${t.wayBack}` : null, clean(t.reason), `Until ${fmt.wd(t.until)}`, 'From the plan’s "until" note') }))];
  const Y = { today: 2, phase: 22, meso: 58, weeks: 84, num: 132, month: 148, dec: 172, busy: 200, ledger: 228 };
  const H = Y.ledger + 22 * Math.max(1, spans.length) + 4;
  const out: Child[] = [];
  const lane = (y: number, t: string, tipText?: string) => out.push(s('text', { class: 'pv-lane-label', x: 0, y, ...(tipText ? { 'data-tip': tipText } : {}) }, t));
  out.push(s('defs', {}, s('pattern', { id: 'pvBusyHatch', width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, s('rect', { width: 5, height: 5, class: 'pv-hatch-bg' }), s('line', { x1: 0, y1: 0, x2: 0, y2: 5, class: 'pv-hatch-line' }))));
  lane(Y.phase + 19, 'Phases');
  for (const ph of m.phases) {
    const x0 = x(ph.from) + 1;
    const x1 = x(addDays(ph.to, 1)) - 2;
    const title = phaseTitle(ph.index, ph.name);
    out.push(s('rect', { class: `pv-tl-phase${m.now?.phase === ph.index ? ' is-now' : ''}`, x: x0, y: Y.phase, width: x1 - x0, height: 28, rx: 7, 'data-tip': tip(title, range(ph.from, ph.to), ph.goal ? clean(ph.goal) : null) }), s('text', { class: 'pv-tl-phase-t', x: x0 + 10, y: Y.phase + 18 }, title));
  }
  lane(Y.meso + 13, 'Mesocycles', tip('Mesocycles', MESOCYCLE));
  const today = m.date;
  const tx = x(today) + wk / 14;
  const mesoTexts: Child[] = [];
  for (const mc of m.mesocycles) {
    const x0 = x(mc.from) + 1;
    const x1 = x(addDays(mc.to, 1)) - 2;
    out.push(s('rect', { class: `pv-tl-meso${m.now?.meso === mc.index ? ' is-now' : ''}`, x: x0, y: Y.meso, width: x1 - x0, height: 18, rx: 5, 'data-tip': tip(`Mesocycle ${mc.index}`, range(mc.from, mc.to)) }));
    mesoTexts.push(s('text', { class: 'pv-tl-meso-t', x: (x0 + x1) / 2, y: Y.meso + 13 }, `Mesocycle ${mc.index}`));
  }
  if (today >= start && today <= weeks.at(-1)!.end) out.push(s('line', { class: 'pv-tl-today', x1: tx, x2: tx, y1: Y.today + 14, y2: H - 6 }));
  out.push(...mesoTexts);
  lane(Y.weeks + 21, 'Weeks');
  // Each week's Sunday: the coach step after its check-in.
  const stepOf = new Map((m.coach?.steps ?? []).map((x) => [x.value.date, x.value] as const));
  for (const w of weeks) {
    const x0 = x(w.start) + 1.5;
    const cw = wk - 3;
    const when = w.end < today ? 'is-past' : m.now?.index === w.index ? 'is-now' : 'is-future';
    const st = stepOf.get(w.end);
    out.push(s('rect', { class: `pv-tl-week is-${w.kind}${w.calibration ? ' is-calibration' : ''} ${when}`, x: x0, y: Y.weeks, width: cw, height: 34, rx: 4, 'data-tip': tip(`Week ${w.index} · ${range(w.start, w.end)}`, [w.kind === 'deload' ? 'Light week' : 'Loading', w.calibration && 'calibration', w.tests && 'tests'].filter(Boolean).join(', '), `${phaseTitle(w.phase, m.phases.find((p) => p.index === w.phase)?.name)}, mesocycle ${w.meso}, week ${w.weekInMeso}`, w.calibration ? `Calibration: ${calibrationNote(m.rules.calibration.value.rir)}` : null, w.tests ? clean(m.rules.tests.text) : null, st ? `Sunday: ${st.title} · ${st.command}` : null) }));
    const letter = w.calibration ? 'C' : w.kind === 'deload' ? 'L' : '';
    if (letter) out.push(s('text', { class: `pv-tl-letter ${when}`, x: x0 + (w.tests ? cw / 2 - 6 : cw / 2), y: Y.weeks + 21 }, letter));
    if (w.tests) out.push(iconGroup('flag', `translate(${x0 + cw / 2 + 1},${Y.weeks + 11}) scale(0.5)`, `pv-tl-flag ${when}`));
    out.push(s('text', { class: 'pv-ax mid', x: x0 + cw / 2, y: Y.num }, String(w.index)));
  }
  // A label per month; the plan's first month gives way when the next one starts within a few days.
  const months: string[] = [];
  for (let d = start; d <= weeks.at(-1)!.end; d = addDays(d, 1)) if (!months.length || d.slice(0, 7) !== months.at(-1)!.slice(0, 7)) months.push(d);
  months.forEach((d, i) => {
    const next = months[i + 1];
    if (next && x(next) - x(d) < 30) return;
    out.push(s('line', { class: 'pv-grid', x1: x(d), x2: x(d), y1: Y.month - 9, y2: Y.month + 2 }), s('text', { class: 'pv-ax', x: x(d) + 4, y: Y.month }, fmt.month(d)));
  });
  lane(Y.dec + 4, 'Decisions');
  out.push(s('line', { class: 'pv-lane-line', x1: left, x2: xEnd, y1: Y.dec, y2: Y.dec }));
  for (const d of m.decisions) {
    if (d.date < start || d.date > weeks.at(-1)!.end) continue;
    const cx = x(d.date) + wk / 14;
    out.push(s('rect', { class: `pv-tl-dec${d.status === 'declined' ? ' is-declined' : ''}`, x: cx - 5, y: Y.dec - 5, width: 10, height: 10, transform: `rotate(45 ${cx} ${Y.dec})`, 'data-tip': tip(`${fmt.wd(d.date)} · ${d.title}`, d.status ? `Status: ${d.status}` : null, d.trigger ? `Trigger: ${d.trigger}` : null, d.rule ? `Rule: ${d.rule}` : null, d.change ? `Change: ${d.change}` : null, d.effect ? `Expected: ${d.effect}` : null, d.review ? `Review: ${fmt.wd(d.review)}` : null, d.outcome ? `Outcome: ${d.outcome}` : null) }));
  }
  lane(Y.busy + 4, 'Busy weeks');
  out.push(s('line', { class: 'pv-lane-line', x1: left, x2: xEnd, y1: Y.busy, y2: Y.busy }));
  for (const b of m.busy) {
    const x0 = Math.max(left, x(b.from));
    const x1 = Math.min(xEnd, x(addDays(b.to, 1)));
    if (x1 <= x0) continue;
    out.push(s('rect', { class: 'pv-tl-busy', x: x0 + 1, y: Y.busy - 7, width: x1 - x0 - 2, height: 14, rx: 4, 'data-tip': tip(clean(b.label), range(b.from, b.to), b.kind === 'travel' ? 'Travel, from a check-in' : 'Busy, from a check-in') }));
    const text = clean(b.label).split(',')[0]!;
    out.push(xEnd - x1 > text.length * 5.6 + 8 ? s('text', { class: 'pv-c-label', x: x1 + 6, y: Y.busy + 4 }, text) : s('text', { class: 'pv-c-label', x: x0 - 6, y: Y.busy + 4, 'text-anchor': 'end' }, text));
  }
  lane(Y.ledger + 4, 'Limits');
  spans.forEach((c, i) => {
    const y = Y.ledger + i * 22;
    const x0 = left + 1;
    const x1 = c.until ? Math.min(xEnd, x(addDays(c.until, 1))) : xEnd;
    out.push(s('rect', { class: `pv-tl-ledger${c.kind === 'change' ? ' is-change' : ''}`, x: x0, y: y - 7, width: Math.max(4, x1 - x0 - 1), height: 14, rx: 4, 'data-tip': c.tip }));
    if (!c.until) out.push(s('path', { class: 'pv-tl-ledger-arrow', d: `M${xEnd - 1},${y - 5} l6,5 l-6,5z` }));
    out.push(s('text', { class: 'pv-tl-ledger-t', x: x0 + 8, y: y + 4 }, `${clean(c.label)} · ${c.until ? `until ${fmt.day(c.until)}` : 'no end date'}`));
  });
  if (!spans.length) out.push(s('text', { class: 'pv-c-label', x: left, y: Y.ledger + 4 }, 'None: no Ledger limits or temporary changes'));
  if (today >= start && today <= weeks.at(-1)!.end) out.push(s('rect', { class: 'pv-tl-today-pill', x: tx - 23, y: Y.today, width: 46, height: 15, rx: 7.5 }), s('text', { class: 'pv-tl-today-t', x: tx, y: Y.today + 11 }, 'Today'));
  const rows = weeks.map((w) => {
    const st = stepOf.get(w.end);
    const ev = [
      // The reviews: the weekly letter is every Sunday, so only these are named here.
      ...(st && st.kind !== 'letter' ? [`${st.title} · ${st.command}`] : []),
      ...m.decisions.filter((d) => d.date >= w.start && d.date <= w.end).map((d) => `Decision: ${d.title}`),
      ...m.busy.filter((b) => b.from <= w.end && b.to >= w.start).map((b) => `Busy: ${clean(b.label)}`),
      ...spans.filter((c) => c.until && c.until >= w.start && c.until <= w.end).map((c) => `Ends: ${clean(c.label)}`),
    ];
    return [`${w.index}${m.now?.index === w.index ? ' (now)' : ''}`, range(w.start, w.end), String(w.phase), String(w.meso), [w.kind === 'deload' ? 'Light week' : 'Loading', w.calibration && 'calibration', w.tests && 'tests'].filter(Boolean).join(', '), h('span', { class: 'pv-faint' }, ev.join('; '))] as Child[];
  });
  const phase = m.phases.find((p) => p.index === m.now?.phase);
  return card('timeline', 'pv-span-12', ctx, cardHead('timeline', `The plan, ${weeks.length} weeks`, phase ? `${phaseTitle(phase.index, phase.name)}${phase.goal ? `: ${clean(phase.goal)}` : ''}. Week ${m.now?.index} of ${weeks.length}.` : `From ${fmt.day(start)}`, ctx),
    [s('svg', { class: 'pv-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'The plan, week by week' }, out),
      h('div', { class: 'pv-chart-key' }, keySw('pv-tl-week is-loading is-past', 'Loading', 'week'), keySw('pv-tl-week is-deload is-past', 'Light week', 'week'), keySw('pv-tl-week is-loading is-calibration is-past', 'Calibration', 'week'), keySw('pv-tl-week is-loading is-future', 'Ahead', 'week'), h('span', {}, icon('flag'), 'Tests'), keySw('pv-tl-dec', 'Decision', 'dec'), keySw('pv-tl-busy', 'Busy week'), keySw('pv-tl-ledger', 'Ledger limit'), keySw('pv-tl-ledger is-change', 'Temporary change'))],
    table([{ t: 'Week' }, { t: 'Dates' }, { t: 'Phase' }, { t: 'Meso', r: true }, { t: 'Kind' }, { t: 'Events' }], rows));
}

// ================================================================ this mesocycle
function sessions(m: Ok, ctx: PlanContext): HTMLElement {
  const meso = m.mesocycles.find((x) => x.index === m.now?.meso);
  const mw = m.weeks.filter((w) => w.meso === m.now?.meso);
  const strip = h('div', { class: 'pv-meso-strip' }, mw.map((w) => h('span', { class: `pv-meso-wk${m.now?.index === w.index ? ' is-now' : ''}${w.end < m.date ? ' is-past' : ''}` }, h('b', {}, `Week ${w.index}`), ` ${range(w.start, w.end)} · ${w.kind === 'deload' ? 'light' : 'loading'}${w.tests ? ', tests' : ''}`)));
  const dose = (sl: Ok['templates'][number]['slots'][number]): Child => {
    // Intervals in words ("4 × 4 min hard, 3 min easy between · about 25 min").
    if (sl.timed && (sl.timed.rounds ?? 0) >= 2) return clean(sl.timed.text);
    const sr = clean(sl.sr ?? '');
    if (sr && !/^\d+\s*×\s*\d/.test(sr)) return sr;
    if (sr && /s\/side|min|rounds/.test(sr)) return sr;
    const reps = sl.repRange[0] === sl.repRange[1] ? `${sl.repRange[0]}` : `${sl.repRange[0]}–${sl.repRange[1]}`;
    return [`${sl.sets} × ${reps} `, h('span', { class: 'at' }, `@ RIR ${sl.rir}`)];
  };
  // A short day's minutes as planned, and a flag when they run over the profile's short day.
  const minutes = (t: Ok['templates'][number]): Child => {
    if (!('minutes' in t) || !t.minutes) return null;
    const { estimate, check } = t.minutes;
    const over = check.value.over ?? 0;
    return [
      h('span', { class: 'pv-tpl-min', 'data-tip': tip('Session length', clean(estimate.reason.note ?? '')) }, `about ${estimate.value.minutes} min`),
      over > 0 ? h('span', { class: 'pv-tag is-warn', 'data-rule': check.reason.rule, 'data-tip': tip(`Over your ${check.value.limit}-minute short day`, clean(check.reason.note ?? '')) }, `${over} min over`) : null,
    ];
  };
  // Each session in its own panel, headed by its letter; lifting days and short days in groups of their own.
  const block = (t: Ok['templates'][number]) => h('div', { class: 'pv-tpl' },
    h('div', { class: 'pv-tpl-head' }, h('span', { class: 'pv-tpl-badge' }, t.type), h('span', { class: 'pv-tpl-name' }, clean(t.name)), minutes(t)),
    h('ul', { class: 'pv-tpl-list' }, t.slots.map((sl) => {
      const tags: Child[] = [];
      // A one-number range (3 × 6) moves a step every session it is made: linear, whatever the rule's name.
      const linear = sl.progression?.rule === 'linear' || (sl.progression?.rule === 'double' && sl.repRange[0] === sl.repRange[1]);
      if (linear) tags.push(h('span', { class: 'pv-tag', 'data-tip': tip('Linear progression', 'Every rep of every set made: one load step next session. A rep short: hold.') }, 'linear'));
      else if (sl.progression?.rule === 'double') tags.push(h('span', { class: 'pv-tag', 'data-tip': tip('Double progression', 'All sets at the top of the range: add the load step, back to the bottom. A set under the bottom: hold.') }, 'double'));
      if (sl.progression?.rule === 'ladder') tags.push(h('span', { class: 'pv-tag', 'data-tip': tip('Ladder', 'The next harder variation instead of more load') }, 'ladder'));
      if (sl.until) tags.push(h('span', { class: 'pv-tag is-warn', 'data-tip': tip(`In for ${sl.until.exerciseName ?? 'the planned lift'} until ${fmt.wd(sl.until.until)}`, clean(sl.until.reason)) }, `until ${fmt.day(sl.until.until)}`));
      if (sl.ledger && !sl.ledger.allowed) tags.push(h('span', { class: 'pv-tag is-bad', 'data-tip': tip('Ledger', clean(sl.ledger.note ?? '').replace(/Swaps:.*$/, '').trim()) }, 'Ledger: ruled out'));
      else if (sl.ledger?.conditions.length) tags.push(h('span', { class: 'pv-tag', 'data-tip': tip('Ledger conditions', ...sl.ledger.conditions) }, 'Ledger: conditions'));
      const entries = ctx.guide ? ctx.guide(sl.name) : [];
      const key = `plan:${t.type}:${sl.name}`;
      const open = Boolean(ctx.openGuides?.has(key)) && entries.length > 0;
      // The plan's own reason for the item, behind a Why at the end of its tags.
      const whyOpen = Boolean(sl.why) && Boolean(ctx.openWhy?.has(key));
      if (sl.why) tags.push(h('button', { class: `pv-tag pv-tag-why${whyOpen ? ' is-open' : ''}`, 'aria-expanded': whyOpen ? 'true' : 'false', disabled: !ctx.onToggleWhy, onclick: () => ctx.onToggleWhy?.(key) }, 'Why', icon('chevron')));
      return h('li', {}, h('div', { class: 'pv-tpl-row' }, guideName(clean(sl.name), entries.length > 0, open, () => ctx.onToggleGuide?.(key), 'pv-tpl-ex'), h('span', { class: 'pv-tpl-dose' }, dose(sl))), tags.length ? h('div', { class: 'pv-tpl-tags' }, tags) : null, open ? guidePanel(entries) : null, whyOpen && sl.why ? planWhyPanel({ text: sl.why }) : null);
    })),
  );
  const groups = ([['lift', 'Lifting days'], ['short', 'Short days']] as const).map(([kind, label]) => {
    const ts = m.templates.filter((t) => (t.kind === 'lift') === (kind === 'lift'));
    return ts.length ? h('div', { class: `pv-tpl-group is-${kind}` }, h('div', { class: 'pv-tpl-group-h' }, label), h('div', { class: 'pv-tpl-grid' }, ts.map(block))) : null;
  });
  return h('section', { class: 'pv-card pv-span-8', 'data-sec': 'meso' }, headNoTable('This mesocycle', meso ? `Mesocycle ${meso.index}: ${range(meso.from, meso.to)}, ${mesoWords(m, meso.index)} The sessions as planned this week.` : 'The session templates as planned this week.'), m.templates.length ? [strip, ...groups] : calm('No sessions planned this week.'));
}

// ================================================================ planned sets
type VolumeRow = NonNullable<Ok['volume']>['muscles'][number];

/** A priority muscle's direct sets near failure, the part its minimum counts: "12 direct, near failure" (and those of unknown effort); null without the plan's split. */
export function directLine(b: Pick<VolumeRow, 'priority' | 'hardDirect' | 'unknown'>): string | null {
  if (!b.priority || b.hardDirect === undefined) return null;
  return `${fmt.sets(b.hardDirect)} direct, near failure${b.unknown ? `, ${fmt.sets(b.unknown)} of unknown effort` : ''}`;
}

/** A row's declared regions with their aim ("Side delts: 6 direct, aim 6"), each drawn on its own line under the row. */
const declaredLines = (b: VolumeRow) => b.regions.filter((r) => r.declared).map((r) => ({ r, text: regionAim(r) })).filter((x): x is { r: VolumeRow['regions'][number]; text: string } => x.text !== null);

function volume(m: Ok, width: number, ctx: ProgressContext): HTMLElement {
  const v = m.volume;
  const bands = [...v.muscles].sort((a, b) => b.sets - a.sets);
  const W = inner(width);
  const lab = 92;
  const val = 54;
  const x = scale(0, 24, lab, W - val);
  const rowH = 22;
  // A priority row has a second line, the card's full width: the total beside its direct sets near failure;
  // a region declared weak has a line of its own under its muscle's row.
  const subH = 13;
  const top = 18;
  const heights = bands.map((b) => rowH + ((directLine(b) ? 1 : 0) + declaredLines(b).length) * subH);
  const H = top + heights.reduce((a, n) => a + n, 0) + 4;
  const out: Child[] = [];
  for (const [a, b, c] of [[0, 4, 'z-low'], [4, 10, 'z-a'], [10, 16, 'z-b'], [16, 20, 'z-a'], [20, 24, 'z-high']] as const) out.push(s('rect', { class: `pv-vz ${c}`, x: x(a), y: top - 4, width: x(b) - x(a), height: H - top }));
  for (const t of [4, 10, 16, 20]) out.push(s('text', { class: 'pv-ax mid', x: x(t), y: top - 7 }, String(t)));
  const label = (b: VolumeRow) => (b.directUnder ? 'Too few direct sets near failure' : b.status === 'below' ? 'Below target' : b.status === 'above' ? 'Above the priority band' : b.status === 'over' ? 'Over target' : 'In target');
  let y = top;
  bands.forEach((b, i) => {
    const name = v.labels[b.muscle]?.label ?? b.muscle;
    const direct = directLine(b);
    if (b.priority) out.push(s('rect', { class: 'pv-vz-priority', x: x(10), y: y + 2, width: x(16) - x(10), height: rowH - 6, rx: 3 }));
    out.push(s('text', { class: 'pv-vlabel', x: 0, y: y + 13 }, `${name}${b.priority ? ' *' : ''}`));
    const w = Math.max(2, x(Math.min(24, b.sets)) - x(0));
    const split = b.direct !== undefined ? `${fmt.sets(b.direct ?? 0)} direct, ${fmt.sets(b.indirect ?? 0)} from helping (half credit)` : null;
    out.push(s('path', { class: 'pv-vbar', 'data-muscle': b.muscle, d: `M${x(0)},${y + 6}h${Math.max(0, w - 4)}a4,4 0 0 1 4,4v0a4,4 0 0 1 -4,4h${-Math.max(0, w - 4)}z`, 'data-tip': tip(`${name}${b.priority ? ' (priority)' : ''}`, `${fmt.sets(b.sets)} planned sets a week`, split, direct, label(b), b.note ? clean(b.note) : null, ...regionTipLines(b.regions, name)) }));
    out.push(s('text', { class: 'pv-vval', x: W - val + 8, y: y + 13 }, fmt.sets(b.sets)));
    if (b.status !== 'in') out.push(iconGroup(b.status === 'below' ? 'below' : 'over', `translate(${W - 16},${y + 3}) scale(0.58)`, `pv-vst is-${b.status === 'above' ? 'below' : b.status}`));
    let sy = y + rowH + 6;
    if (direct) {
      out.push(s('text', { class: `pv-vsub${b.directUnder ? ' is-under' : ''}`, x: 0, y: sy }, `${fmt.sets(b.sets)} · ${direct}${b.directUnder ? ': under 10' : ''}`));
      sy += subH;
    }
    for (const { r, text } of declaredLines(b)) {
      out.push(s('text', { class: `pv-vsub pv-vsub-region${r.status === 'short' ? ' is-under' : ''}`, 'data-region': r.id, x: 0, y: sy, 'data-tip': tip(`${r.label} (declared weak)`, r.note ? clean(r.note) : null) }, text));
      sy += subH;
    }
    y += heights[i]!;
  });
  const aim = bands.flatMap(declaredLines)[0]?.r.min ?? null;
  return card('vol', 'pv-span-4', ctx, cardHead('vol', 'Sets per muscle', 'Planned, a week, against the bands', ctx),
    [s('svg', { class: 'pv-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Planned sets per muscle' }, out), h('div', { class: 'pv-chart-key' }, keySw('pv-vz z-low', 'Under 4: below the minimum'), keySw('pv-vz-priority', '* Priority muscle, 10–16, at least 10 of them direct and near failure'), aim !== null ? h('span', {}, `A region you declared weak has its own line: ${aim} direct sets near failure a week`) : null), pullPushLine(v.pullPush)],
    table([{ t: 'Muscle' }, { t: 'Sets a week', r: true }, { t: 'Status' }], bands.flatMap((b) => {
      const direct = directLine(b);
      return [
        [`${v.labels[b.muscle]?.label ?? b.muscle}${b.priority ? ' (priority)' : ''}`, direct ? `${fmt.sets(b.sets)} · ${direct}` : fmt.sets(b.sets), label(b)],
        ...declaredLines(b).map(({ r }) => [`${r.label} (declared weak)`, regionAimValue(r) ?? '', r.status === 'short' ? 'Under its aim' : r.status === 'uncoverable' ? 'No option you can do now' : 'Meets its aim']),
      ];
    })));
}

/** The planned week's pulling against pushing sets, under the chart: against the posture emphasis's ratio when the profile has it. */
export function pullPushLine(pp: NonNullable<Ok['volume']>['pullPush'] | undefined): HTMLElement | null {
  if (!pp) return null;
  const sets = `${fmt.sets(pp.pull)} pulling to ${fmt.sets(pp.push)} pushing sets a week${pp.ratio !== null ? ` (${pp.ratio} to 1)` : ''}`;
  const text = {
    ok: `Pull to push: ${sets}. The posture emphasis asks for about ${pp.target} to 1, at least ${pp.floor}.`,
    below: `Pull to push: ${sets}, under the ${pp.floor} the posture emphasis asks for (about ${pp.target} to 1).`,
    'no-target': `Pull to push: ${sets}. No target without a posture emphasis.`,
    'no-pushing': `Pull to push: ${sets}.`,
  }[pp.status];
  const mark = pp.status === 'ok' ? 'inTarget' : pp.status === 'below' ? 'below' : 'info';
  return h('div', { class: `pv-note pv-pull-push is-${pp.status}`, 'data-card': 'pull-push', 'data-rule': pp.rule, 'data-tip': tip('Pull to push', pp.note ? clean(pp.note) : null) }, icon(mark), h('span', {}, text));
}

// ================================================================ targets
interface TRow { name: string; sub: string; heuristic?: boolean; unit: string; base?: number | null; baseWhen?: string | null; lo?: number; hi?: number; by?: string | null; cur?: number | null; curWhen?: string | null; status: ['in' | 'below' | 'neutral', string]; dom?: [number, number]; predictedText?: string; curText?: string; f?: (v: number) => string; note?: string }
function targetRows(m: Ok, units?: BodyUnits): TRow[] {
  const t = m.targets;
  const st = t.standing;
  const rows: TRow[] = [];
  // Waist (cm) and weight (kg) rows in the body units: the values scale, so differences convert the same way.
  const F = bodyFmt(units);
  const cv = (unit: string): ((v: number) => number) | null => (unit === 'cm' ? F.lv : unit === 'kg' ? F.wv : null);
  const lab = (unit: string) => (unit === 'cm' ? F.l : unit === 'kg' ? F.w : unit);
  const num = (unit: string, v: number) => { const f = cv(unit); return f ? Math.round(f(v) * 10) / 10 : v; };
  for (const p of t.profile ?? []) {
    if (p.kind === 'drop') rows.push({ name: p.label, sub: 'The profile’s target, a drop from the cycle’s start', unit: p.unit, base: p.base ?? null, lo: p.base != null ? p.base - p.hi! : undefined, hi: p.base != null ? p.base - p.lo! : undefined, cur: p.cur, status: p.status === 'met' ? ['in', 'Met'] : p.status === 'on-the-way' ? ['in', 'On the way'] : p.status === 'no-data' ? ['neutral', 'No data yet'] : ['below', 'Not yet'], dom: p.base != null ? [p.base - p.hi! * 1.3, p.base + p.hi! * 0.3] : undefined, predictedText: `−${num(p.unit, p.lo!)} to −${num(p.unit, p.hi!)} ${lab(p.unit)}` });
  }
  if (st.rate) rows.push({ name: 'Weight rate', sub: 'The goal band, from the profile goal', unit: st.rate.unit === 'pct' ? '% a week' : `${F.w} a week`, lo: st.rate.unit === 'pct' ? st.rate.lo : F.wv(st.rate.lo), hi: st.rate.unit === 'pct' ? st.rate.hi : F.wv(st.rate.hi), cur: st.rate.pct, curWhen: m.date, status: st.rate.status === 'in' ? ['in', 'In the band'] : ['below', 'Out of the band'], dom: [Math.min(st.rate.lo, st.rate.pct) - 0.5, Math.max(st.rate.hi, st.rate.pct) + 0.5], f: (v) => fmt.signed(v) });
  if (st.adherence) rows.push({ name: 'Lifting sessions', sub: m.cycle.since ? `This cycle’s ${st.adherence.weeks === 1 ? 'first full week' : `${st.adherence.weeks} full weeks`}, against the week’s target` : 'The last 4 full weeks, against the week’s target', unit: '%', lo: 80, hi: 100, cur: st.adherence.pct, curWhen: st.adherence.to, status: st.adherence.pct >= 80 ? ['in', 'On track'] : ['below', 'Behind'], dom: [50, 100], f: (v) => `${Math.round(v)}`, predictedText: '80 % or more', curText: `${st.adherence.done} of ${st.adherence.planned} (${Math.round(st.adherence.pct)} %)` });
  // The rows built in cm and kg, in the body units (their own unit label too); the % and count rows stay.
  for (const r of rows) {
    const f = cv(r.unit);
    if (!f) continue;
    r.unit = lab(r.unit);
    for (const k of ['base', 'lo', 'hi', 'cur'] as const) if (typeof r[k] === 'number') r[k] = f(r[k]);
    if (r.dom) r.dom = [f(r.dom[0]), f(r.dom[1])];
  }
  for (const p of st.priority) rows.push({ name: `${m.volume.labels[p.muscle]?.label ?? p.muscle} sets a week`, sub: 'Priority muscle, average of the last 4 weeks', unit: 'sets', lo: 10, hi: 16, cur: p.sets, curWhen: m.date, status: p.status === 'in' ? ['in', 'In the band'] : p.status === 'above' ? ['below', 'Above the band'] : ['below', 'Below the band'], dom: [0, 24], f: (v) => fmt.sets(v) });
  return rows;
}
function miniRange(r: TRow): Child {
  if (r.lo === undefined || r.hi === undefined || !r.dom) return h('span', { class: 'pv-faint pv-tg-note' }, r.note ?? 'Nothing to draw yet');
  const W = 180;
  const H = 26;
  const x = scale(r.dom[0], r.dom[1], 6, W - 6);
  const lo = Math.min(r.lo, r.hi);
  const hi = Math.max(r.lo, r.hi);
  return s('svg', { class: 'pv-tg-svg', viewBox: `0 0 ${W} ${H}`, style: `width:${W}px;height:${H}px` },
    s('line', { class: 'pv-base', x1: 6, x2: W - 6, y1: H / 2, y2: H / 2 }),
    s('rect', { class: 'pv-tg-range', x: x(lo), y: H / 2 - 6, width: Math.max(2, x(hi) - x(lo)), height: 12, rx: 4 }),
    r.base != null ? s('line', { class: 'pv-tg-base', x1: x(r.base), x2: x(r.base), y1: H / 2 - 8, y2: H / 2 + 8 }) : null,
    r.cur != null ? s('circle', { class: `pv-tg-cur is-${r.status[0]}`, cx: Math.max(6, Math.min(W - 6, x(r.cur))), cy: H / 2, r: 5 }) : null,
  );
}
function targets(m: Ok, ctx: ProgressContext): HTMLElement {
  const rows = targetRows(m, ctx.units);
  const f = (r: TRow, v: number | null | undefined) => (v == null ? '–' : r.f ? r.f(v) : fmt.num(v));
  const phase = m.phases.find((p) => p.index === m.now?.phase);
  const noProfile = !m.targets.profile;
  const lines = rows.map((r) => h('div', { class: 'pv-tg-row' },
    h('div', { class: 'pv-tg-name' }, h('b', {}, r.name), r.heuristic ? h('span', { class: 'pv-tag is-heur' }, 'Heuristic') : null, h('div', { class: 'pv-tg-sub' }, r.sub)),
    h('div', { class: 'pv-tg-num' }, h('span', { class: 'pv-tg-l' }, 'Baseline'), r.base != null ? [`${f(r, r.base)} ${r.unit}`, r.baseWhen ? h('small', {}, fmt.day(r.baseWhen)) : null] : h('span', { class: 'pv-faint' }, '–')),
    h('div', { class: 'pv-tg-num' }, h('span', { class: 'pv-tg-l' }, r.by ? `Predicted by ${fmt.day(r.by)}` : 'Target'), r.predictedText ?? `${f(r, r.lo)} to ${f(r, r.hi)} ${r.unit}`),
    h('div', { class: 'pv-tg-num' }, h('span', { class: 'pv-tg-l' }, 'Current'), r.curText ?? (r.cur != null ? [`${f(r, r.cur)} ${r.unit}`, r.curWhen ? h('small', {}, fmt.day(r.curWhen)) : null] : h('span', { class: 'pv-faint' }, '–'))),
    h('div', { class: 'pv-tg-chart' }, miniRange(r)),
    h('div', { class: 'pv-tg-st' }, statusChip(r.status[0], r.status[1])),
  ));
  return card('targets', 'pv-span-12', ctx, cardHead('targets', phase ? `${phaseTitle(phase.index, phase.name)} targets` : 'Targets', phase ? `${phaseLabel(phase.index, phase.name)} ends ${fmt.day(phase.to)}. The targets are the ones your coach set in the profile.` : null, ctx),
    [h('div', { class: 'pv-tg' }, lines), noProfile ? calm('No coach profile yet: the phase targets come from the intake (/fitness-coach intake). The rows above come from the log.') : null,
      h('div', { class: 'pv-chart-key' }, keySw('pv-tg-range', 'Predicted range or target band'), h('span', {}, s('svg', { viewBox: '0 0 18 12' }, s('line', { class: 'pv-tg-base', x1: 9, x2: 9, y1: 0, y2: 12 })), 'Baseline'), h('span', {}, s('svg', { viewBox: '0 0 18 12' }, s('circle', { class: 'pv-tg-cur is-neutral', cx: 9, cy: 6, r: 4.5 })), 'Current'))],
    table([{ t: 'Target' }, { t: 'Baseline', r: true }, { t: 'Predicted or target' }, { t: 'Current', r: true }, { t: 'Status' }], rows.map((r) => [`${r.name}${r.heuristic ? ' (heuristic)' : ''}`, r.base != null ? `${f(r, r.base)} ${r.unit}` : '–', `${r.predictedText ?? `${f(r, r.lo)} to ${f(r, r.hi)} ${r.unit}`}${r.by ? ` by ${fmt.day(r.by)}` : ''}`, r.curText ?? (r.cur != null ? `${f(r, r.cur)} ${r.unit}` : '–'), r.status[1]])));
}

// ================================================================ standing rules
/**
 * The standing rules the plan's numbers follow: each kind and each logged
 * lift, the plan's own rule in words, or "default" where the coach has not
 * set one yet (Pahlavan then uses its old default, said beside it).
 */
function rulesCard(m: Ok, ctx: ProgressContext): HTMLElement {
  const KIND_LABEL: Record<string, string> = { calibration: 'Calibration', lightWeeks: 'Light weeks', tests: 'Tests', readiness: 'Low readiness', soreness: 'Soreness', missed: 'Time off', stall: 'Stalls', hotel: 'Hotel', express: 'Express, short days' };
  const { lifts, ...kinds } = m.rules;
  const rows = [
    ...Object.entries(kinds).map(([k, r]) => ({ label: KIND_LABEL[k] ?? k, r })),
    ...Object.entries(lifts).map(([name, r]) => ({ label: name, r })),
  ];
  const ownText = (r: { source: string; text: string }) => clean(r.text.replace(/^(The plan's rule|Pahlavan's default \(the plan sets none\)): /, ''));
  const set = rows.filter((x) => x.r.source === 'plan').length;
  return card('rules', 'pv-span-12', ctx, cardHead('rules', 'Standing rules', set === rows.length ? 'Your coach set every rule your numbers follow.' : `Your coach has set ${set} of ${rows.length}; the rest use Pahlavan's default until the next check-in.`, ctx),
    h('ul', { class: 'pv-rules' }, rows.map((x) => h('li', { class: `pv-rule is-${x.r.source}`, 'data-tip': tip(x.label, x.r.path) },
      h('b', {}, x.label),
      x.r.source === 'plan' ? null : h('span', { class: 'pv-tag is-heur' }, 'default: your coach hasn’t set this'),
      h('span', { class: 'pv-rule-text' }, ownText(x.r)),
    ))),
    table([{ t: 'Rule' }, { t: 'From' }, { t: 'What it does' }], rows.map((x) => [x.label, x.r.source === 'plan' ? 'Your plan' : 'Default', ownText(x.r)])));
}

// ================================================================ load
function load(m: Ok, width: number, ctx: ProgressContext): HTMLElement {
  const L = m.load;
  const groups = [...L.weeks.map((w) => ({ label: w.current ? 'This week' : fmt.day(w.from), from: w.from, daily: w.daily, total: w.load, mono: w.current ? null : w.monotony, planned: false, unknown: w.unknown, future: w.current ? Array.from({ length: 7 }, (_, d) => addDays(w.from, d) > m.date) : Array(7).fill(false) as boolean[], tips: Array.from({ length: 7 }, (_, d) => w.sessions.filter((x) => x.date === addDays(w.from, d)).map((x) => `${x.minutes ?? '?'} min × RPE ${x.rpe ?? '?'} = ${x.load ?? 'unknown'}`)) })),
    { label: 'Next week', from: L.next.from, daily: L.next.daily, total: L.next.knownLoad, mono: L.nextMonotony, planned: true, unknown: L.next.unknown, future: Array(7).fill(false) as boolean[], tips: Array.from({ length: 7 }, (_, d) => L.next.sessions.filter((x) => x.day === d).map((x) => `${clean(x.name)}: ${x.minutes ?? '?'} min × RPE ${fmt.num(x.rpe)} = ${x.load ?? '?'}`)) }];
  const W = inner(width);
  const H = 204;
  const mm = { l: 40, r: 8, t: 12, b: 64 };
  const max = Math.max(1, ...groups.flatMap((g) => g.daily));
  const y = scale(0, max * 1.1, H - mm.b, mm.t);
  const groupW = (W - mm.l - mm.r) / groups.length;
  const bw = Math.max(4, Math.min(14, (groupW - 24) / 7 - 3));
  const out: Child[] = [];
  for (const t of niceTicks(0, max * 1.1, 3)) out.push(s('line', { class: 'pv-grid', x1: mm.l, x2: W - mm.r, y1: y(t), y2: y(t) }), s('text', { class: 'pv-ax end', x: mm.l - 6, y: y(t) + 3 }, String(t)));
  groups.forEach((g, gi) => {
    const gx = mm.l + gi * groupW + 10;
    g.daily.forEach((v, di) => {
      const bx = gx + di * (bw + 3);
      const date = addDays(g.from, di);
      const t = tip(`${fmt.wd(date)}${g.planned ? ' (planned)' : ''}`, g.future[di] ? 'Not yet' : g.tips[di]!.length ? g.tips[di]!.join('|') : 'No session');
      if (v > 0) {
        const hh = y(0) - y(v);
        out.push(s('path', { class: g.planned ? 'pv-ld-plan' : 'pv-ld-bar', d: `M${bx},${y(0)}v${-(Math.max(0, hh - 4))}a4,4 0 0 1 4,-4h${Math.max(0, bw - 8)}a4,4 0 0 1 4,4v${Math.max(0, hh - 4)}z`, 'data-tip': t }));
      } else out.push(s('rect', { class: `pv-ld-zero${g.future[di] ? ' is-future' : ''}`, x: bx, y: y(0) - 2, width: bw, height: 2, 'data-tip': t }));
      out.push(s('text', { class: 'pv-ax mid', x: bx + bw / 2, y: y(0) + 12 }, 'MTWTFSS'[di]));
    });
    const cx = gx + (7 * (bw + 3)) / 2 - 1.5;
    // Three short lines per week: a group is under 100 px wide at 1100, so the long forms live in the table.
    const third = g.unknown ? `${g.unknown} without ${g.planned ? 'minutes' : 'RPE'}` : g.mono != null ? `Monotony ${g.mono.toFixed(1)}` : '';
    out.push(s('text', { class: 'pv-c-label strong', x: cx, y: H - 36, 'text-anchor': 'middle' }, g.label), s('text', { class: 'pv-c-label', x: cx, y: H - 21, 'text-anchor': 'middle' }, `Load ${Math.round(g.total).toLocaleString('en-GB')}`), third ? s('text', { class: 'pv-c-label', x: cx, y: H - 7, 'text-anchor': 'middle' }, third) : null);
  });
  const unknown = L.weeks.reduce((a, w) => a + w.unknown, 0);
  return card('load', 'pv-span-7', ctx, cardHead('load', 'Training load', 'Next week as planned, beside the last 4 weeks. Load is session RPE × minutes; monotony is the week’s mean daily load over its spread (above 2 is high).', ctx),
    [h('div', { class: 'pv-stats' }, h('div', {}, h('div', { class: 'pv-stat-v' }, `${L.next.unknown ? 'At least ' : ''}${Math.round(L.next.knownLoad).toLocaleString('en-GB')}`), h('div', { class: 'pv-stat-l' }, L.next.unknown ? `Next week, planned; ${L.next.unknown} session${L.next.unknown === 1 ? '' : 's'} without minutes` : 'Next week, planned')), L.nextMonotony != null ? h('div', {}, h('div', { class: 'pv-stat-v' }, L.nextMonotony.toFixed(1)), h('div', { class: 'pv-stat-l' }, 'Monotony, planned')) : null),
      s('svg', { class: 'pv-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Training load per day' }, out),
      h('div', { class: 'pv-chart-key' }, keySw('pv-ld-bar', 'Logged'), keySw('pv-ld-plan', 'Planned')),
      h('div', { class: 'pv-foot-note' }, `Next week’s effort is a heuristic from the plan.${unknown ? ` ${unknown} logged session${unknown === 1 ? '' : 's'} have no session RPE and count as unknown; the Log panel records it.` : ''}`)],
    table([{ t: 'Week' }, { t: 'Load', r: true }, { t: 'Monotony', r: true }, { t: 'Unknown sessions', r: true }], groups.map((g) => [g.planned ? `Next week, from ${fmt.day(g.from)}` : `Week of ${fmt.day(g.from)}${g.label === 'This week' ? ' (so far)' : ''}`, String(Math.round(g.total)), g.mono != null ? g.mono.toFixed(2) : '–', String(g.unknown)])));
}

// ================================================================ coming up
const EVENT: Record<string, [string, string, string]> = {
  tape: ['tape', 'Tape', 'Waist, hips, chest and arm'],
  checkin: ['clipboard', 'Sunday check-in', 'The week in a few questions'],
  deload: ['deload', 'Light week', 'Lighter sessions, as the plan\'s rule says'],
  tests: ['flag', 'Phase tests', 'Push-ups, wall gap and the other tests'],
  photos: ['camera', 'Progress photos', 'Front, side and back, same light'],
  'phase-review': ['history', 'Phase review', 'The phase ends; the next one is planned'],
  rescreen: ['shield', 'Re-screening', 'The yearly safety screen'],
  'ledger-end': ['shield', 'Ledger limit ends', 'Re-screen the lifts, back in at light-week loads'],
  'change-end': ['clock', 'Temporary change ends', ''],
};
/** A mesocycle in words from its weeks on the plan's light-week calendar: "a 4-week block of three normal weeks and a light week." */
function mesoWords(m: Ok, index: number): string {
  const ws = m.weeks.filter((w) => w.meso === index);
  const light = ws.filter((w) => w.kind === 'deload').length;
  const normal = ws.length - light;
  const n = (k: number) => (['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'][k] ?? String(k));
  return `a ${ws.length}-week block of ${n(normal)} normal week${normal === 1 ? '' : 's'}${light ? ` and ${light === 1 ? 'a' : n(light)} light week${light === 1 ? '' : 's'}` : ' (no light week: the plan lists none here)'}.`;
}

/** What a light week does, as the plan's rule (or the old default) says it: "2 sets of everything, about 10 % lighter, RIR +3". */
const lightDose = (m: Ok) => {
  const t = lightDoseText(m.rules.lightWeeks.value);
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Coming up: each Sunday's check-in names the coach step after it and its command; the phase review says what it plans. */
function upcoming(m: Ok): HTMLElement {
  const items = m.upcoming.map((u) => {
    const e = EVENT[u.kind] ?? ['calendar', u.kind, ''];
    const x = u as { item?: string; wayBack?: string; coach?: { kind: string; title: string; command: string; nextCycle: boolean } };
    const c = x.coach;
    const sub: Child = u.kind === 'change-end' ? `${x.wayBack} returns`
      : u.kind === 'checkin' && c ? [`Then ${stepWords(c)}: `, h('code', {}, c.command)]
        : u.kind === 'phase-review' && c?.nextCycle ? 'The plan ends; the next cycle is planned'
          : u.kind === 'deload' ? lightDose(m) : e[2];
    return { date: u.date, ic: e[0], title: u.kind === 'change-end' ? `${x.item} change ends` : u.kind === 'ledger-end' ? `Ledger limit ends: ${x.item}` : e[1], sub };
  });
  const shown = items.slice(0, 8);
  let last = '';
  const list = shown.map((it) => {
    const head = it.date !== last ? h('div', { class: 'pv-up-date' }, h('b', {}, `${fmt.dow(it.date)} ${+it.date.slice(8)}`), ` ${fmt.month(it.date)} `, h('span', {}, `in ${daysBetween(m.date, it.date)} days`)) : null;
    last = it.date;
    return [head, h('div', { class: 'pv-up-item' }, h('span', { class: 'pv-rem-icon' }, icon(it.ic)), h('div', {}, h('b', {}, it.title), it.sub ? h('div', { class: 'pv-tg-sub' }, it.sub) : null))];
  });
  const phase = m.phases.find((p) => p.index === m.now?.phase);
  return h('section', { class: 'pv-card pv-span-5', 'data-sec': 'upcoming' }, headNoTable('Coming up', phase ? `To the end of phase ${phase.index}, ${fmt.day(phase.to)}` : null),
    items.length ? [h('div', { class: 'pv-up' }, list), items.length > shown.length ? h('div', { class: 'pv-foot-note' }, `And ${items.length - shown.length} more by ${fmt.day(phase?.to ?? items.at(-1)!.date)}.`) : null] : calm('Nothing scheduled before the phase ends.'));
}

// ================================================================ banner
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** Today's banner: the ring is this mesocycle, one segment per week, the deload in its own colour, this week drawn thicker and the weeks to come fainter. */
function hero(m: PlanModel, o: PlanHero): HTMLElement {
  const weeks = m.weeks ?? [];
  const phases = m.phases ?? [];
  const now = 'now' in m ? m.now : null;
  const meso = mesocycleWeeks(weeks, now);
  const cur = meso.find((w) => w.state === 'now') ?? null;
  const ph = now ? phases.find((p) => p.index === now.phase) ?? null : null;
  const phWeeks = now ? weeks.filter((w) => w.phase === now.phase) : [];
  const deload = now ? meso.find((w) => w.kind === 'deload' && w.state !== 'past') ?? weeks.find((w) => w.kind === 'deload' && w.index > now.index) ?? null : null;
  const tests = 'upcoming' in m ? (m.upcoming ?? []).find((u) => u.kind === 'tests') ?? null : null;
  const lengths = new Set(phases.map((p) => weeks.filter((w) => w.phase === p.index).length));
  const phaseText = phases.length ? ` · ${phases.length} phase${phases.length === 1 ? '' : 's'}${lengths.size === 1 ? ` of ${[...lengths][0]} weeks` : ''}` : '';
  const span = weeks.length ? `${weeks.length} weeks from ${fmt.day(weeks[0]!.start)}${phaseText}` : 'No plan weeks yet';
  const segs: RingSeg[] = meso.map((w) => ({
    kind: w.kind === 'deload' ? 'short' : 'lift',
    now: w.state === 'now',
    future: w.state === 'future',
    tip: tip(`Week ${w.index} of the plan`, `${range(w.start, w.end)}, ${w.kind === 'deload' ? 'light week' : w.calibration ? 'calibration' : 'loading'}${w.state === 'now' ? ' (this week)' : ''}`),
  }));
  const t = o.weekTarget;
  return banner({
    phase: o.phase,
    kicker: bannerKicker(now?.index, o.phaseOf, now?.phase),
    title: 'Plan',
    sub: now && cur ? `Mesocycle ${now.meso}, week ${cur.weekInMeso} of ${meso.length} · ${span}` : span,
    ...(now && cur ? { subTip: tip('Mesocycle', MESOCYCLE) } : {}),
    chips: [
      now && ph ? { icon: 'layers', label: 'Phase', value: `${now.phase} of ${phases.length}, week ${phWeeks.findIndex((w) => w.index === now.index) + 1} of ${phWeeks.length}`, tip: tip(`${phaseTitle(ph.index, ph.name)}${ph.goal ? `: ${clean(ph.goal)}` : ''}`, range(ph.from, ph.to)) } : null,
      deload ? { icon: 'deload', label: 'Light week', value: deload.index === now?.index ? 'this week' : fmt.wd(deload.start), tip: tip('Light week', `${range(deload.start, deload.end)}: ${lowerFirst(lightDose(m as Ok))}`, `${clean((m as Ok).rules.lightWeeks.text)} So your body catches up.`) } : null,
      t ? { sw: 'lift', label: 'A week', value: `${t.lift} lifting + ${t.short} short`, tip: tip('Sessions a week', 'The plan’s weekly target', SHORT, 'minimumWeek' in m && m.minimumWeek?.value ? `The minimum week: ${m.minimumWeek.value.sessions} Express sessions` : null) } : null,
      tests ? { icon: 'flag', label: 'Phase tests', value: fmt.wd(tests.date), tip: tip('Phase tests', `${clean((m as Ok).rules.tests.text)} ${EVENT['tests']![2]}.`) } : null,
    ],
    ring: cur
      ? { segs, n: `${cur.weekInMeso}/${meso.length}`, label: 'WEEK', aria: `Week ${cur.weekInMeso} of ${meso.length} in mesocycle ${now!.meso}` }
      : { segs: [{ kind: 'empty', tip: tip('This week', 'Outside the plan’s weeks') }], n: '–', label: 'WEEK', aria: 'Outside the plan’s weeks' },
    key: [{ kind: 'lift', label: 'Loading' }, { kind: 'short', label: 'Light week' }],
  });
}

/** Builds the Plan screen into `root` (its children are replaced). */
export function renderPlan(root: HTMLElement, m: PlanModel, ctx: PlanContext): void {
  root.replaceChildren();
  const weeks = m.weeks ?? [];
  root.append(hero(m, ctx.hero));
  // No plan yet (a first run): the card says what the coach does and gives the command, instead of the "No plan found" note.
  const noPlan = m.notes.some((n) => n.code === 'no-plan');
  const notes = m.notes.filter((n) => n.code !== 'no-plan');
  if (notes.length) root.append(h('div', { class: 'pv-notes' }, notes.map((n) => h('div', { class: 'pv-note' }, icon('info'), h('span', {}, n.text)))));
  if (noPlan) root.append(noPlanCard(ctx));
  if (!weeks.length || !('templates' in m)) return;
  const ok = m;
  const grid = h('div', { class: 'pv-prog-grid' });
  root.append(grid);
  const total = grid.clientWidth || root.clientWidth || 1000;
  const narrow = total < 760;
  const gap = 18;
  const col = (total - 11 * gap) / 12;
  const span = (n: number) => (narrow ? total : col * n + gap * (n - 1));
  const folded = ctx.folded;
  const mw = minimumCard(ok);
  const wide = [targets(ok, ctx), rulesCard(ok, ctx), mw, ctx.desk ? deskCard(ctx.desk) : null, ctx.links?.length ? planNotes(ctx) : null].filter((c): c is HTMLElement => c !== null);
  if (!folded || narrow) {
    grid.append(timeline(ok, span(12), ctx), sessions(ok, ctx), volume(ok, span(4), ctx), wide[0]!, load(ok, span(7), ctx), upcoming(ok), ...wide.slice(1));
    return;
  }
  // Packed, as mockups/glance-plan.html: This mesocycle and the load on the left, the sets and what comes up on the
  // right, so the open cards sit side by side; a full-width card folded to its bar joins the left column, opened it
  // goes under the columns.
  const isFolded = (c: HTMLElement) => folded(c.getAttribute('data-sec') ?? '');
  grid.append(
    timeline(ok, span(12), ctx),
    h('div', { class: 'pv-span-8 pv-stack pv-col' }, sessions(ok, ctx), load(ok, span(8), ctx), wide.filter(isFolded)),
    h('div', { class: 'pv-span-4 pv-stack pv-col' }, volume(ok, span(4), ctx), upcoming(ok)),
    ...wide.filter((c) => !isFolded(c)),
  );
}

export { targetRows };

/** No plan yet: what the coach does, the command with Copy, and what this tab shows once there is one. */
function noPlanCard(ctx: PlanContext): HTMLElement {
  const soon: [string, string, string][] = [
    ['calendar', 'Your weeks', 'The phases, the light weeks and the tests, week by week'],
    ['dumbbell', 'Each session', 'Its exercises, sets and rest, and why each one is there'],
    ['layers', 'Sets per muscle', 'Each week’s work against the bands the research gives'],
    ['clock', 'The minimum week', 'The least that keeps a bad week on track'],
  ];
  return h('section', { class: 'pv-card', 'data-card': 'no-plan' },
    h('div', { class: 'pv-fd-empty' },
      h('div', { class: 'pv-fd-empty-t' }, icon('calendar'),
        h('div', {}, h('b', {}, 'No plan yet'), h('p', {}, 'Run ', h('code', {}, COACH_COMMANDS.plan), ' in Claude Code, started in this vault, after the intake (', h('code', {}, COACH_COMMANDS.intake), '). The coach compares a few plans built from your week, your equipment and your goals, and writes the one you pick. This tab draws it from there.')),
        ctx.onCopy ? h('button', { class: 'pv-btn-primary', onclick: () => ctx.onCopy!(COACH_COMMANDS.plan), 'data-k': 'plan-copy' }, icon('clipboard'), 'Copy the command') : null),
      h('div', { class: 'pv-fd-soon' }, soon.map(([i, t, x]) => h('div', {}, h('span', { class: 'pv-rem-icon' }, icon(i)), h('div', {}, h('b', {}, t), h('span', {}, x))))),
    ),
  );
}

/** The minimum week: the least that keeps a bad week on track, from the plan's lifting days and its Express. */
function minimumCard(m: Ok): HTMLElement | null {
  const mw = m.minimumWeek;
  if (!mw?.value) return null;
  return h('section', { class: 'pv-card pv-span-12 pv-minweek', 'data-card': 'minimum-week', 'data-sec': 'minweek', 'data-rule': mw.reason.rule },
    headNoTable('The minimum week', 'For a bad week: the least that keeps you on track'),
    h('div', { class: 'pv-minweek-row' },
      h('span', { class: 'pv-rem-icon' }, icon('clock')),
      h('div', {}, h('b', {}, `${mw.value.sessions} × Express`), h('span', {}, ` ${mw.value.text}`), h('div', { class: 'pv-faint' }, 'It beats skipping the week. On Today, Express rebuilds the session; for travel, Hotel. For a longer stretch, tell the coach.'))),
  );
}

/** "The plan" card: the plan's notes in the vault, as the dashboard lists them. */
function planNotes(ctx: PlanContext): HTMLElement {
  return h('section', { class: 'pv-card pv-span-12 pv-plan-notes', 'data-sec': 'notes' },
    headNoTable('The plan', 'The notes behind it, in the vault'),
    h('div', { class: 'pv-links' }, ctx.links!.map((l) => h('button', { class: 'pv-link-row', disabled: !ctx.onOpenNote, onclick: () => ctx.onOpenNote?.(l.path), 'data-tip': `${l.label}|${l.path}` }, icon(l.icon), h('span', {}, l.label), icon('right')))),
  );
}
