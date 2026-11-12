// The Today screen, built from the engine's Today report: the banner, Your
// day (ui/your-day.ts, the day's steps at the top), the readiness card,
// "Ask the coach" while the step after the Sunday check-in
// is due or still to do (ui/coach.ts), Due today (built by
// ui/due-today.ts), today's session, the reminders, the week and the recent
// sessions (a card of its own, so it folds). A port of the signed-off mockup (mockups/today.html); each card
// carries its section id (`data-sec`) for At a glance and its fold. Standard
// DOM only; the view passes in the callbacks, so this module needs no
// Obsidian API.

import { lightDoseText, type Adjustment } from '../../../src/core/rules.ts';
import { readinessKey, trimWords, type ReadinessBandKey, type ReadinessInput } from '../../../src/core/readiness.ts';
import type { Reason } from '../../../src/core/reason.ts';
import type { SessionMode } from '../../../src/core/variant.ts';
import type { ChecklistLine } from '../../../src/adapters/vault/log-write.ts';
import type { checklistTargets, DashReminder, GuideEntry, recentSessions } from '../../../src/report/dashboard.ts';
import type { SessionModel, TodayModel } from '../data-source.ts';
import { guideName, guidePanel } from './guide.ts';
import { coachCard } from './coach.ts';
import type { PhaseId } from '../phase.ts';
import { arcPath, banner, bannerKicker, type BannerOptions } from './banner.ts';
import { h, icon, s, type Child } from './dom.ts';
import { addDays, clean, fmt } from './format.ts';
import { LIGHT_WEEK, lightWords, MESOCYCLE, SHORT } from './terms.ts';
import { paths } from '../../../src/adapters/vault/layout.ts';

export interface TodayContext {
  mode: SessionMode;
  session: SessionModel | null;
  phase: { id: PhaseId; isfahan: boolean };
  open: Set<string>;
  /** Today's pick of session (a plan session type), or null for the suggestion. */
  pick: string | null;
  onMode: (mode: SessionMode) => void;
  /** Choose a session for today; null goes back to the suggestion. */
  onPick: (type: string | null) => void;
  onToggleWhy: (id: string) => void;
  /** Opens the Log panel for today's session (the pick, if any). */
  onLog: () => void;
  /** Opens the Log panel on a logged session, to edit it. */
  onEditSession(date: string, s: { type: string; label?: string }): void;
  /** Today's checklist (its lines and ticks, kept in the log's todayChecklist); null when nothing is planned. */
  checklist?: { lines: (ChecklistLine & { steps: string[] })[]; checked: boolean[]; targets: ReturnType<typeof checklistTargets>; canTick: boolean } | null;
  onTick?: (i: number) => void;
  /** The movement guide for a name, and which guides are open. */
  guide?(name: string): GuideEntry[];
  openGuides?: Set<string>;
  onToggleGuide?: (key: string) => void;
  /** Copies today's plan as plain text. */
  onCopy?: () => void;
  month?: { name: string; count: number };
  recent?: ReturnType<typeof recentSessions>;
  totalSessions?: number;
  /** The dashboard's For today rules that Pahlavan adds to its own (pressing, lifting days left, short sessions to go). */
  dashReminders?: DashReminder[];
  onOpenNote?: (path: string) => void;
  /** The vault has a Session History note (the link to it shows only then). */
  historyNote?: boolean;
  /** The Due today card (ui/due-today.ts), drawn under Readiness; absent without the reminder machinery. */
  dueCard?: HTMLElement | null;
  /** The welcome card (ui/help.ts), drawn under the banner until its five steps are done or it is hidden. */
  welcome?: HTMLElement | null;
  /** Your day (ui/your-day.ts), the strip at the top, right under the banner (At a glance goes under it). */
  yourDay?: HTMLElement | null;
  /** Today's swaps chosen on the chips, by the plan's item; the Log panel starts with them. */
  swaps?: Readonly<Record<string, string>>;
  /** Chooses a swap for the plan's item today (null undoes it); absent: the chips are read only. */
  onSwap?: (item: string, to: string | null) => void;
  /** Copies a coach command ("Ask the coach"); absent: the command shows without Copy. */
  onCopyCommand?: (text: string) => void;
}

type Review = NonNullable<TodayModel['review']>;
type Item = SessionModel['items'][number];

const tip = (...lines: (string | false | null | undefined)[]) => lines.filter(Boolean).join('|');

// ---------------------------------------------------------------- banner
function hero(m: TodayModel, r: Review, ctx: TodayContext): HTMLElement {
  const w = r.week;
  const tw = r.thisWeek;
  const last = [...m.week].reverse().flatMap((d) => d.sessions.map((x) => ({ ...x, date: d.date })))[0];
  const lastName = last ? (last.label ?? last.name) : null;
  const lastWhen = last ? (last.date === m.date ? 'today' : fmt.dow(last.date)) : '';
  return banner({
    phase: ctx.phase,
    kicker: bannerKicker(w.planWeek, m.phase, w.phase),
    title: 'Today',
    sub: `${fmt.dayLong(m.date)} · Mesocycle ${w.mesocycle}, week ${w.weekInMesocycle}${w.mesocycleWeeks ? ` of ${w.mesocycleWeeks}` : ''}${w.deload ? ' · light week' : ''}`,
    subTip: tip('Mesocycle', MESOCYCLE, w.deload ? `${LIGHT_WEEK}. ${clean(r.rules.lightWeeks.text)}` : null),
    chips: [
      { sw: 'lift', label: 'Lifting', value: `${tw.lifting.done}/${tw.lifting.target}`, tip: tip('Lifting sessions', `${tw.lifting.done} of ${tw.lifting.target} this week`) },
      { sw: 'short', label: 'Short', value: `${tw.short.done}/${tw.short.target}`, tip: tip('Short sessions', `${tw.short.done} of ${tw.short.target} this week`, SHORT) },
      { icon: 'pulse', label: 'Cardio', value: `${tw.cardioMin} min` },
      lastName ? { icon: 'history', label: 'Last session', value: `${clean(lastName)}, ${lastWhen}` } : null,
      ctx.month ? { icon: 'calendar', label: ctx.month.name, value: `${ctx.month.count} session${ctx.month.count === 1 ? '' : 's'}` } : null,
    ],
    action: h('button', { class: 'pv-btn-go', onclick: () => ctx.onLog() }, icon('plus'), 'Log session'),
    ring: weekRing(m, r),
    key: [{ kind: 'lift', label: 'Lifting' }, { kind: 'short', label: 'Short' }],
  });
}

/** One segment per planned session this week, filled when done (Today's banner and Home's). */
export function weekRing(m: TodayModel, r: Review): BannerOptions['ring'] {
  const tw = r.thisWeek;
  const done = m.week.flatMap((d) => d.sessions.map((x) => ({ ...x, date: d.date })));
  const lifts = done.filter((x) => x.kind === 'lift');
  const shorts = done.filter((x) => x.kind === 'short');
  const segs: { kind: 'lift' | 'short'; s: (typeof done)[number] | null; i: number }[] = [];
  for (let i = 0; i < tw.lifting.target; i++) segs.push({ kind: 'lift', s: lifts[i] ?? null, i });
  for (let i = 0; i < tw.short.target; i++) segs.push({ kind: 'short', s: shorts[i] ?? null, i });
  const filled = segs.filter((x) => x.s).length;
  const next = r.nextInRotation;
  return {
    segs: segs.map((x) => {
      const label = x.kind === 'lift' ? `Lifting ${x.i + 1} of ${tw.lifting.target}` : `Short ${x.i + 1} of ${tw.short.target}`;
      const what = x.s ? `${clean(x.s.label ?? x.s.name)}, ${fmt.wd(x.s.date)}` : x.kind === 'lift' && next.lift ? `Open: ${next.lift} is next` : 'Open';
      return { kind: x.s ? x.kind : 'empty', tip: tip(label, what) };
    }),
    n: `${filled}/${segs.length}`,
    label: 'SESSIONS',
    aria: `${filled} of ${segs.length} sessions done this week`,
  };
}

// ---------------------------------------------------------------- readiness
const BANDS = [
  { id: 'low', lo: -2, hi: -1, label: 'Low' },
  { id: 'watch', lo: -1, hi: -0.5, label: 'Watch' },
  { id: 'normal', lo: -0.5, hi: 0.5, label: 'Normal' },
  { id: 'good', lo: 0.5, hi: 2, label: 'Good' },
] as const;
const BAND_STATUS: Record<string, [string, string]> = { low: ['over', 'alert'], watch: ['below', 'alert'], normal: ['in', 'inTarget'], good: ['in', 'inTarget'], unscored: ['neutral', 'info'] };
const ACTION_WORDS: Record<string, string> = {
  'early-deload': 'Offer an early light week',
  'no-hard-training': 'No hard training: easy Zone 2 or mobility at most',
  'no-tests': 'Train as planned, but no tests or PR attempts',
};
/** Each input's row: its words, icon and unit, and the bar's ends (HRV's around your own usual: people differ too much for one scale). */
const SIGNAL: Record<string, { label: string; icon: string; scale: [number, number] | ((x: ReadinessInput) => [number, number]); unit: (v: number) => string; log?: true }> = {
  energy: { label: 'Energy', icon: 'zap', scale: [1, 5], unit: (v) => `${fmt.num(v)}/5` },
  soreness: { label: 'Soreness', icon: 'body', scale: [1, 5], unit: (v) => `${fmt.num(v)}/5` },
  sleepQ: { label: 'Sleep quality', icon: 'star', scale: [1, 5], unit: (v) => `${fmt.num(v)}/5` },
  sleepH: { label: 'Sleep', icon: 'bed', scale: [4, 9], unit: (v) => `${fmt.num(v)} h` },
  rhr: { label: 'Resting HR', icon: 'pulse', scale: [48, 72], unit: (v) => `${fmt.num(v, 0)} bpm` },
  hrv: { label: 'HRV', icon: 'heart', scale: (x) => { const c = x.mean ?? x.value ?? 60; return [c * 0.5, c * 1.5]; }, unit: (v) => `${fmt.num(v, 0)} ms`, log: true },
};
const SIGNAL_ORDER = ['energy', 'soreness', 'sleepQ', 'sleepH', 'rhr', 'hrv'];

function statusChip(st: string, ic: string, label: string): HTMLElement {
  return h('span', { class: `pv-status is-${st}` }, icon(ic), label);
}

function gauge(score: number, band: string): SVGElement {
  const cx = 150;
  const cy = 142;
  const r = 112;
  const ang = (v: number) => 180 - ((Math.max(-2, Math.min(2, v)) + 2) / 4) * 180;
  const st = BAND_STATUS[band]?.[0] ?? 'neutral';
  const a = ang(score);
  return s('svg', { class: 'pv-gauge', viewBox: '0 0 300 160', role: 'img', 'aria-label': `Readiness ${fmt.signed(score)}, ${band}` },
    BANDS.map((b) => {
      const mid = (ang(b.lo) + ang(b.hi)) / 2;
      const lx = cx + (r + 17) * Math.cos((mid * Math.PI) / 180);
      const ly = cy - (r + 17) * Math.sin((mid * Math.PI) / 180);
      return [
        s('path', { class: `pv-gauge-band is-${b.id}${b.id === band ? '' : ' is-dim'}`, d: arcPath(cx, cy, r, ang(b.lo) - (b.lo > -2 ? 1 : 0), ang(b.hi) + (b.hi < 2 ? 1 : 0)) }),
        s('text', { class: 'pv-gauge-tick', x: lx.toFixed(1), y: (ly + 3).toFixed(1), 'text-anchor': mid > 100 ? 'end' : mid < 80 ? 'start' : 'middle' }, b.label),
      ];
    }),
    [-1, -0.5, 0.5].map((v) => {
      const t = ang(v);
      return s('text', { class: 'pv-gauge-tick', x: (cx + (r - 17) * Math.cos((t * Math.PI) / 180)).toFixed(1), y: (cy - (r - 17) * Math.sin((t * Math.PI) / 180) + 3).toFixed(1), 'text-anchor': 'middle' }, v === 0.5 ? '0.5' : fmt.signed(v, v % 1 ? 1 : 0));
    }),
    s('text', { class: 'pv-gauge-tick', x: cx - r, y: cy + 16, 'text-anchor': 'middle' }, '−2'),
    s('text', { class: 'pv-gauge-tick', x: cx + r, y: cy + 16, 'text-anchor': 'middle' }, '+2'),
    s('circle', { class: `pv-gauge-dot is-${st}`, cx: (cx + r * Math.cos((a * Math.PI) / 180)).toFixed(1), cy: (cy - r * Math.sin((a * Math.PI) / 180)).toFixed(1), r: 7.5 }),
    s('text', { class: 'pv-gauge-value', x: cx, y: cy - 12 }, fmt.signed(score)),
  );
}

function inputRow(x: ReadinessInput): HTMLElement {
  const meta = SIGNAL[x.signal]!;
  const [lo, hi] = typeof meta.scale === 'function' ? meta.scale(x) : meta.scale;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  const verdict = x.z === null ? 'usual' : x.z <= -1 ? 'worse' : x.z >= 1 ? 'better' : 'usual';
  const word = x.z === null ? 'Not scored' : { worse: 'Worse', better: 'Better', usual: 'Usual' }[verdict];
  // The usual range: mean ± SD, or for HRV (scored on its log) the range itself in ms.
  const usual = x.mean !== null && x.sd !== null && (meta.log && x.range ? `Usual: ${meta.unit(x.range[0])} to ${meta.unit(x.range[1])} (previous ${x.days} days)` : `Usual: ${meta.unit(x.mean)} ± ${fmt.num(x.sd)} (previous ${x.days} days)`);
  const bar = h('div', { class: 'pv-ibar', 'data-tip': tip(meta.label, x.value !== null && `Today: ${meta.unit(x.value)}`, usual, x.z !== null && `z ${fmt.signed(x.z)} (${x.better} is better)`) });
  if (x.mean !== null && x.sd !== null) {
    const [r0, r1] = x.range ?? [x.mean - x.sd, x.mean + x.sd];
    const b0 = pct(r0);
    const b1 = pct(r1);
    bar.append(h('span', { class: 'pv-ib-band', style: `left:${b0}%;width:${Math.max(2, b1 - b0)}%` }), h('span', { class: 'pv-ib-mean', style: `left:${pct(x.mean)}%` }));
  }
  if (x.value !== null) bar.append(h('span', { class: `pv-ib-dot is-${verdict}`, style: `left:${pct(x.value)}%` }));
  return h('li', { class: 'pv-input-row' },
    h('span', { class: 'pv-input-name' }, icon(meta.icon), meta.label),
    bar,
    h('span', { class: 'pv-input-val' }, h('b', {}, x.value === null ? '–' : meta.unit(x.value)), h('small', {}, word)),
  );
}

/** How the score works in one line, then each band with what it does to the session; today's band marked. */
function readinessHow(band: string | null, low: Adjustment | null): HTMLElement {
  const key = readinessKey(low).value;
  const edge = (b: ReadinessBandKey) => (b.from === null ? `${fmt.signed(b.to!, 1)} or less` : b.to === null ? `${fmt.signed(b.from, 1)} or more` : `${fmt.signed(b.from, 1)} to ${fmt.signed(b.to, 1)}`);
  return h('div', { class: 'pv-rd-how' },
    h('p', {}, h('b', {}, 'How this works. '), key.how),
    h('ul', { class: 'pv-rd-bands', 'aria-label': 'What each band does to the session' }, key.bands.map((b) =>
      h('li', { class: `is-${b.band}${b.band === band ? ' is-on' : ''}` },
        h('i', {}),
        h('b', {}, b.label),
        h('span', { class: 'pv-rd-edge' }, edge(b)),
        h('span', { class: 'pv-rd-effect' }, b.effect),
      ))),
  );
}

function readinessCard(m: TodayModel, r: Review): HTMLElement {
  const today = r.readiness.today.value;
  const latest = r.readiness.latestScored as { date: string; r: number; s: number; band: string } | null;
  const scored = today.band !== 'unscored' ? { date: today.date, r: today.r!, s: today.s!, band: today.band } : latest;
  const card = h('section', { class: 'pv-card pv-readiness', 'data-sec': 'readiness' },
    h('div', { class: 'pv-card-head' }, h('div', {}, h('div', { class: 'pv-kicker' }, 'Readiness'), h('div', { class: 'pv-card-sub' }, scored && scored.date !== m.date ? `The latest check-in, ${fmt.wd(scored.date)}` : `Morning check-in · ${fmt.wd(m.date)}`))),
  );
  const base = r.readiness.baseline.value;
  if (!scored && base.building) {
    // A fresh cycle: no score until 14 morning check-ins, so nothing changes the session meanwhile.
    const n = Math.min(base.mornings, base.needed);
    card.append(
      h('div', { class: 'pv-rd-build', 'data-rule': r.readiness.baseline.reason.rule },
        h('div', { class: 'pv-rd-build-t' }, 'Building your baseline'),
        h('div', { class: 'pv-rd-build-n' }, h('b', {}, `${n} of ${base.needed}`), ' morning check-ins this cycle'),
        h('div', { class: 'pv-rd-build-bar', role: 'img', 'aria-label': `${n} of ${base.needed} morning check-ins` }, Array.from({ length: base.needed }, (_, i) => h('i', { class: i < n ? 'is-on' : '' }))),
        h('p', {}, n >= base.needed ? 'The baseline is built: your next check-in gets the first score.' : 'Each morning this cycle adds to your usual. After 14, every morning is scored against this cycle’s own.'),
      ),
    );
    readinessActionsInto(card, r);
    return card;
  }
  if (!scored) {
    card.append(h('p', { class: 'pv-calm' }, icon('info'), 'No scored check-in yet: readiness needs 3 signals with 14 days of history.'));
    return card;
  }
  const [st, ic] = BAND_STATUS[scored.band] ?? ['neutral', 'info'];
  const label = BANDS.find((b) => b.id === scored.band)?.label ?? 'Not scored';
  card.append(
    gauge(scored.s, scored.band),
    h('div', { class: 'pv-gauge-label' }, statusChip(st, ic, label)),
    h('div', { class: 'pv-gauge-sub' }, `Smoothed over 3 days. ${scored.date === m.date ? 'This morning' : `${fmt.wd(scored.date)}`} on its own: ${fmt.signed(scored.r)}`),
  );
  const inputs = SIGNAL_ORDER.map((k) => m.inputs.find((x) => x.signal === k)).filter((x): x is ReadinessInput => Boolean(x));
  if (inputs.length) {
    card.append(
      h('ul', { class: 'pv-inputs' }, inputs.map(inputRow)),
      h('div', { class: 'pv-inputs-key' }, h('span', {}, h('i', {}), 'Your usual range'), h('span', {}, h('i', { class: 'dot is-worse' }), 'Worse'), h('span', {}, h('i', { class: 'dot is-usual' }), 'Usual'), h('span', {}, h('i', { class: 'dot is-better' }), 'Better')),
    );
  } else card.append(h('p', { class: 'pv-calm' }, icon('info'), 'The inputs appear after this morning’s check-in.'));
  card.append(readinessHow(scored.band, r.rules.readiness.value.low));
  readinessActionsInto(card, r);
  return card;
}

/** The active readiness actions (the safety ones stay on while the baseline builds), else "Train as planned"; the HRV note when it is on alone. */
function readinessActionsInto(card: HTMLElement, r: Review): void {
  const active = r.readiness.actions.filter((a) => a.value.active);
  // HRV low two mornings running is a note: it changes the session only with the resting-HR flag or a low score,
  // and then the no-hard-training action says so itself.
  const hrv = r.readiness.hrv;
  if (hrv?.value.flag && !active.some((a) => a.value.action === 'no-hard-training')) {
    card.append(h('div', { class: 'pv-action is-quiet', 'data-rule': hrv.reason.rule }, icon('heart'), h('div', {}, h('b', { 'data-tip': `${hrv.reason.title}|Rule ${hrv.reason.rule}` }, 'HRV low two mornings running'), clean(hrv.reason.note))));
  }
  if (active.length) {
    for (const a of active) {
      // A low day's change in words from the plan's rule (or the old default); the note leads with the rule itself.
      const low = r.rules.readiness.value.low;
      const words = a.value.action === 'trim' && low ? `Keep top sets, ${trimWords(low).replace(' per exercise', '')}` : ACTION_WORDS[a.value.action];
      card.append(h('div', { class: 'pv-action', 'data-rule': a.reason.rule }, icon('alert'), h('div', {}, h('b', { 'data-tip': `${a.reason.title}|Rule ${a.reason.rule}` }, words ?? a.reason.title), clean(a.reason.note))));
    }
  } else card.append(h('div', { class: 'pv-action is-quiet' }, icon('inTarget'), h('div', {}, h('b', {}, 'No change today'), 'Train as planned.')));
}

// ---------------------------------------------------------------- for today
function reminders(m: TodayModel, r: Review, ctx: TodayContext): HTMLElement {
  const items: { icon: string; tone: string; lead: string; text: string; rule?: string }[] = [];
  // The dashboard's own rules, word for word, with the standing reminder they come from on hover.
  for (const d of ctx.dashReminders ?? []) items.push({ icon: d.icon, tone: d.warn ? 'below' : '', lead: '', text: lightWords(d.text), rule: d.rule });
  for (const l of r.lifts) {
    if (!l.stall?.value.stalled) continue;
    const step = (l.triage ?? []).find((t) => t.value.chosen);
    const ch = l.stall.value.change;
    // The plan's stall rule: a triage step, or the facts with the response left to the coach.
    const then = step ? ` Triage step ${step.value.step}: ${clean(step.value.suggestion)}` : l.stallFacts ? ' Your coach picks the response at the check-in.' : '';
    items.push({ icon: 'alert', tone: 'below', lead: `${l.short ?? l.name} has stalled`, text: `(e1RM ${ch === null ? '' : `${fmt.signed(ch * 100, 1)} % `}over 3 sessions).${then}`, rule: (l.stallFacts ?? step)?.reason.from?.text ?? r.rules.stall.text });
  }
  const sleep = r.weight.last7.sleepH;
  if (sleep && sleep.value < 7) items.push({ icon: 'moon', tone: 'below', lead: `Sleep ${fmt.num(sleep.value)} h a night`, text: `over the last ${sleep.days} days, under 7\u00a0h.` });
  const d = r.deload?.value;
  // What a light week does, as the plan's rule (or the old default) says it.
  const dose = lightDoseText(r.rules.lightWeeks.value);
  if (d && !d.deload && d.weeksToScheduled && r.week.planWeek !== null && r.week.planStart) {
    const weekNo = r.week.planWeek + d.weeksToScheduled;
    const from = addDays(r.week.planStart, (weekNo - 1) * 7);
    items.push({ icon: 'deload', tone: '', lead: `Light week in ${d.weeksToScheduled} week${d.weeksToScheduled === 1 ? '' : 's'}`, text: `from ${fmt.wd(from)}, plan week\u00a0${weekNo}: ${dose}.`, rule: r.rules.lightWeeks.text });
  } else if (d?.deload) items.push({ icon: 'deload', tone: '', lead: 'Light week', text: `${dose}, so your body catches up.`, rule: r.rules.lightWeeks.text });
  for (const t of [...r.temporaryChanges.due, ...r.temporaryChanges.active]) {
    items.push({ icon: 'clock', tone: t.due ? 'below' : '', lead: `${t.item} until ${fmt.day(t.until)}`, text: `in ${t.session}: ${clean(t.reason)}.` });
  }
  return h('section', { class: 'pv-card', 'data-sec': 'fortoday' },
    h('div', { class: 'pv-card-head' }, h('div', { class: 'pv-kicker' }, 'For today')),
    items.length
      ? h('ul', { class: 'pv-remind' }, items.slice(0, 6).map((x) => h('li', { class: 'pv-rem', ...(x.rule ? { 'data-tip': `From the rule|${x.rule}` } : {}) }, h('span', { class: `pv-rem-icon${x.tone ? ` is-${x.tone}` : ''}` }, icon(x.icon)), h('div', {}, x.lead ? [h('b', {}, x.lead), ' '] : null, h('span', { class: 'pv-rem-text' }, x.text)))))
      : h('p', { class: 'pv-calm' }, icon('inTarget'), 'Nothing to watch today.'),
  );
}

// ---------------------------------------------------------------- session
function repsOf(item: Item): string {
  return item.repRange[0] === item.repRange[1] ? `${item.repRange[0]}` : `${item.repRange[0]}–${item.repRange[1]}`;
}

function targetText(item: Item): Child[] {
  // Intervals in words: "4 × 4 min hard, 3 min easy between · about 25 min" (a calibration week's easy minutes are its sr).
  if ((item.timed?.rounds ?? 0) >= 2) return [clean(item.timed!.text)];
  const t = item.target;
  if (t && t.weight !== null) return [`${fmt.w(t.weight, t.unit)} × ${t.reps} `, h('span', { class: 'at' }, `@ RIR ${t.rir}`)];
  // A calibration week's target with no weight yet: find one for the bottom of the range.
  if (t && t.action === 'calibrate') return [`${item.sets} × ${t.reps} `, h('span', { class: 'at' }, `@ RIR ${t.rir}`)];
  const sr = clean(item.sr ?? '');
  if (sr && /s\/side|min|rounds|\bs\b/.test(sr)) return [sr];
  if (sr) return [`${sr} `, h('span', { class: 'at' }, `@ RIR ${item.rir}`)];
  return [`${item.sets} × ${repsOf(item)} `, h('span', { class: 'at' }, `@ RIR ${item.rir}`)];
}

/** The review's Ledger screen for an exercise in the session's type: its swaps (by name) and conditions. */
function ledgerFor(r: Review, type: string, exercise: string): { swaps: string[]; conditions: string[]; until: string | null } | null {
  const f = r.ledger?.flagged.find((x) => x.session === type && x.value.exercise === exercise);
  if (!f) return null;
  const note = f.reason.note ?? '';
  const swaps = (/Swaps: (.*)\.$/.exec(note)?.[1] ?? '').split(', ').filter(Boolean);
  return { swaps, conditions: f.value.conditions, until: f.value.blockedUntil ?? null };
}

/** A long list of swaps in a note is cut to the first four, with the count of the rest. */
function shortNote(note: string): string {
  return note.replace(/Swaps: ([^.]*)\.$/, (_, list: string) => {
    const all = list.split(', ');
    return all.length > 4 ? `Swaps: ${all.slice(0, 4).join(', ')} and ${all.length - 4} more.` : `Swaps: ${list}.`;
  });
}

/** "your squat is deep" reads "Your squat is deep": the plan's notes start lower case. */
const sentence = (t: string) => (t ? t[0]!.toUpperCase() + t.slice(1) : t);

/** The plan's rest as the row says it: "rest 2–3 min", "rest 90 s after each pair". */
const restWords = (rest: string) => (/^rest\b/i.test(rest) ? clean(rest) : `rest ${clean(rest)}`);

/** A superset's two names in the order they are done: this row's and its partner's. */
function pairNames(item: Item): [string, string] {
  const p = item.pair!;
  return p.label.endsWith('a') ? [clean(item.name), clean(p.with.name)] : [clean(p.with.name), clean(item.name)];
}

/** The plan's own reason for an item ("Why: ..." in its plan-data note), above the engine's adjustments. */
export function planWhyPanel(why: { text: string; of?: string }): HTMLElement {
  return h('div', { class: 'pv-why is-plan' }, h('div', { class: 'pv-why-title' }, why.of ? `From the plan, for ${clean(why.of)}` : 'From the plan'), h('div', {}, sentence(clean(why.text))));
}

function whyPanel(a: Reason): HTMLElement {
  // The rule id stays out of the text: on the panel, and in the title's tooltip.
  return h('div', { class: 'pv-why', 'data-rule': a.rule }, h('div', { class: 'pv-why-title', 'data-tip': `${a.title ?? 'Reason'}|Rule ${a.rule}` }, a.title ?? 'Reason'), h('div', {}, shortNote(clean(a.note ?? ''))));
}

/** A session's short name for the week strip: "Short 1 · Skills" reads "S1 · Skills". */
function shortName(x: { type: string; name: string; label?: string }): string {
  if (x.label) return clean(x.label);
  const name = clean(x.name);
  return name.includes('\u00b7') && name.length > 12 ? `${x.type} \u00b7 ${name.split('\u00b7').pop()!.trim()}` : name;
}

/** The tick for checklist line `i` (kept in the log's todayChecklist). */
function tick(i: number, label: string, ctx: TodayContext): HTMLElement | null {
  const ck = ctx.checklist;
  if (!ck || i < 0) return null;
  const on = Boolean(ck.checked[i]);
  return h('button', { class: `pv-tick${on ? ' is-on' : ''}`, role: 'checkbox', 'aria-checked': on ? 'true' : 'false', 'aria-label': `${label}: ${on ? 'done' : 'not done yet'}`, disabled: !ck.canTick, 'data-tip': ck.canTick ? `${label}|${on ? 'Ticked for today · click to untick' : 'Click when done'}` : undefined, onclick: () => ctx.onTick?.(i) }, on ? icon('check') : null);
}
const lineFor = (ctx: TodayContext, kind: 'warmup' | 'finisher' | number) => (ctx.checklist ? ctx.checklist.targets.findIndex((x) => (typeof kind === 'number' ? x.kind === 'item' && x.index === kind : x.kind === kind)) : -1);
function guideOf(ctx: TodayContext, scope: string, name: string): { has: boolean; open: boolean; toggle: () => void; panel: () => HTMLElement | null } {
  const entries = ctx.guide ? ctx.guide(name) : [];
  const key = `${scope}:${name}`;
  const open = Boolean(ctx.openGuides?.has(key)) && entries.length > 0;
  return { has: entries.length > 0, open, toggle: () => ctx.onToggleGuide?.(key), panel: () => (open ? guidePanel(entries) : null) };
}

function row(item: Item, k: number, r: Review, sess: SessionModel, ctx: TodayContext): HTMLElement {
  const id = `${k}:${item.exercise}`;
  // The guide of what is done today (a swap's own), else of the planned exercise.
  const own = guideOf(ctx, 'today', item.name);
  const guide = own.has ? own : guideOf(ctx, 'today', item.planName ?? item.replaces?.name ?? item.name);
  const ledgerReason = item.adjustments.find((a) => a.rule === 'safety.ledger');
  // Ruled out: the Ledger screened the planned exercise this one replaces (a hotel swap's own screen only adds conditions).
  const screened = (ledgerReason?.inputs as { exercise?: string } | undefined)?.exercise;
  const blocked = Boolean(item.replaces && ledgerReason && screened === item.replaces.exercise);
  const open = ctx.open.has(id);
  const last = item.last as { date: string; weight: number; unit: string; reps: number; logged?: { weight: number; unit: string } } | null;
  const converted = last?.logged && (last.logged.unit !== last.unit || last.logged.weight !== last.weight);
  const type = sess.session?.type ?? '';
  let flag: Child = null;
  if (blocked && item.replaces) {
    const l = ledgerFor(r, type, item.replaces.exercise);
    const inSession = new Set(sess.items.map((x) => x.name));
    const planItem = item.planName ?? item.replaces.name;
    const chosen = ctx.swaps?.[planItem] ?? null;
    const others = (l?.swaps ?? []).filter((n) => !inSession.has(n) && n !== item.name).slice(0, 2);
    if (chosen && !others.includes(chosen)) others.unshift(chosen);
    // A chip is today's swap: the Log panel starts with it; the chosen one again undoes it.
    flag = h('div', { class: 'pv-ex-flag' },
      statusChip('over', 'shield', `${item.replaces.name} ruled out${l?.until ? ` through ${fmt.day(l.until)}` : ''}`),
      others.length ? [h('span', {}, 'Other swaps:'), others.map((n) => {
        const on = chosen === n;
        return h('button', { class: `pv-swap-chip${on ? ' is-on' : ''}`, disabled: !ctx.onSwap, 'aria-pressed': on ? 'true' : 'false', 'data-swap': n, 'data-tip': tip(n, on ? 'Your swap today: the Log panel starts with it' : `Do it today in place of ${clean(item.name)}: the Log panel starts with it`, on ? 'Click again to undo' : null), onclick: () => ctx.onSwap?.(planItem, on ? null : n) }, icon(on ? 'check' : 'swap'), n);
      })] : null,
    );
  } else if (ledgerReason) {
    const l = ledgerFor(r, type, item.exercise);
    const text = l?.conditions.length ? l.conditions.map((c) => c[0]!.toUpperCase() + c.slice(1)).join(' · ') : clean(ledgerReason.note ?? '');
    flag = h('div', { class: 'pv-ex-cond' }, icon('shield'), h('span', {}, text));
  }
  // A superset's rows: the first joins the next ("4a"), the second the one before ("4b"); its tick is the pair's.
  const next = sess.items[k + 1];
  const joinsNext = Boolean(item.pair && next?.pair && next.pair.group === item.pair.group && next.pair.label.endsWith('b'));
  const joinsPrev = Boolean(item.pair?.label.endsWith('b'));
  const names = item.pair ? pairNames(item) : null;
  const meta: Child[] = [
    item.unavailable ? 'Not available today' : item.target ? `${item.sets} sets` : null,
    item.pair ? h('span', { class: 'pv-ex-pair' }, 'with ', h('b', {}, clean(item.pair.with.name))) : null,
    item.rest ? h('span', { class: 'pv-ex-rest' }, restWords(item.rest)) : null,
  ].filter(Boolean);
  return h('li', { class: `pv-ex${item.unavailable ? ' is-unavailable' : ''}${joinsNext ? ' is-pair-a' : ''}${joinsPrev ? ' is-pair-b' : ''}` },
    h('div', { class: 'pv-ex-main' },
      h('span', { class: `pv-ex-num${item.pair ? ' is-pair' : ''}`, 'data-tip': names ? tip('Superset', `${names[0]}, then ${names[1]}: a set of each, then rest`) : undefined }, item.num ?? String(k + 1)),
      h('div', { class: 'pv-ex-body' },
        h('div', { class: 'pv-ex-line1' }, h('span', { class: 'pv-ex-name' }, guideName(clean(item.name), guide.has, guide.open, guide.toggle), item.replaces ? h('small', {}, `in place of ${clean(item.replaces.name)}`) : null), h('span', { class: 'pv-ex-target' }, targetText(item))),
        h('div', { class: 'pv-ex-line2' },
          h('span', { class: 'pv-ex-meta' }, meta.map((x, i) => (i ? [' · ', x] : x))),
          last ? h('span', { class: 'pv-last', 'data-tip': converted ? tip('Last top set', `Logged as ${fmt.w(last.logged!.weight, last.logged!.unit)} × ${last.reps}`, `Shown in ${last.unit}, the exercise’s unit, rounded to its step.`) : undefined }, 'Last ', h('b', {}, `${fmt.w(last.weight, last.unit)} × ${last.reps}`), ` · ${fmt.wd(last.date)}`) : null,
        ),
        item.cue ? h('div', { class: 'pv-ex-cue' }, sentence(clean(item.cue))) : null,
        flag,
      ),
      h('div', { class: 'pv-ex-tools' },
        h('button', { class: `pv-why-btn${open ? ' is-open' : ''}${item.adjustments.length || item.planWhy ? '' : ' is-none'}`, 'aria-expanded': open ? 'true' : 'false', onclick: () => ctx.onToggleWhy(id) }, 'Why', icon('chevron')),
        tick(lineFor(ctx, k), joinsNext && names ? `${names[0]} + ${names[1]}` : clean(item.name), ctx) ?? (ctx.checklist ? h('span', { class: 'pv-tick-gap', 'aria-hidden': 'true' }) : null),
      ),
    ),
    guide.panel(),
    open && item.planWhy ? planWhyPanel(item.planWhy) : null,
    open ? item.adjustments.map(whyPanel) : null,
  );
}

const KIND_LABEL: Record<string, string> = { lift: 'Lifting', short: 'Short session', express: 'Express', custom: 'Session' };
/** "Full Body A · Squat" to "Full Body A", for the one-line pick note. */
const headName = (name: string) => clean(name).split(' · ')[0]!;

/** The quiet "Change session" control: every session in the plan, the suggestion first. */
function sessionPicker(sess: SessionModel, ctx: TodayContext): HTMLElement | null {
  const current = sess.session;
  if (!current || !sess.choices.length) return null;
  const wrap = h('div', { class: 'pv-picker' });
  const doc = () => wrap.ownerDocument;
  let btn: HTMLElement;
  const close = () => {
    wrap.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    doc().removeEventListener('mousedown', outside, true);
    doc().removeEventListener('keydown', onKey, true);
  };
  const outside = (e: Event) => {
    if (!wrap.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    close();
    btn.focus();
  };
  const choose = (type: string | null) => {
    close();
    ctx.onPick(type);
  };
  btn = h('button', {
    class: 'pv-btn-quiet pv-picker-btn',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    onclick: () => {
      if (wrap.classList.contains('is-open')) return close();
      wrap.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
      doc().addEventListener('mousedown', outside, true);
      doc().addEventListener('keydown', onKey, true);
    },
  }, icon('swap'), 'Change session', icon('chevron'));
  const rows = sess.choices.map((c) => {
    const on = c.type === current.type;
    return h('button', { class: `pv-menu-item${on ? ' is-on' : ''}`, role: 'menuitemradio', 'aria-checked': on ? 'true' : 'false', onclick: () => choose(c.suggested ? null : c.type) },
      h('span', { class: 'pv-menu-check' }, on ? icon('check') : null),
      h('span', { class: 'pv-menu-name' }, clean(c.name)),
      h('span', { class: 'pv-menu-kind' }, KIND_LABEL[c.kind] ?? c.kind),
      c.suggested ? h('span', { class: 'pv-menu-tag' }, 'Suggested') : null,
    );
  });
  const back = ctx.pick ? [h('div', { class: 'pv-menu-sep', role: 'separator' }), h('button', { class: 'pv-menu-item is-back', role: 'menuitem', onclick: () => choose(null) }, h('span', { class: 'pv-menu-check' }, icon('history')), h('span', { class: 'pv-menu-name' }, 'Back to the suggestion'))] : [];
  wrap.append(btn, h('div', { class: 'pv-menu', role: 'menu', 'aria-label': 'Sessions in the plan' }, h('div', { class: 'pv-menu-head' }, 'Sessions in the plan'), rows, back));
  return wrap;
}

function sessionCard(m: TodayModel, r: Review, ctx: TodayContext): HTMLElement {
  const sess = ctx.session;
  const seg = h('div', { class: 'pv-seg', role: 'tablist', 'aria-label': 'Session length' },
    (['full', 'express', 'hotel'] as const).map((k) => h('button', { class: ctx.mode === k ? 'is-on' : '', role: 'tab', 'aria-selected': ctx.mode === k ? 'true' : 'false', onclick: () => ctx.onMode(k) }, k[0]!.toUpperCase() + k.slice(1))),
  );
  if (!sess || !sess.session) {
    return h('section', { class: 'pv-card pv-session', 'data-sec': 'session' }, h('div', { class: 'pv-card-head' }, h('div', {}, h('div', { class: 'pv-kicker' }, 'Today’s session')), seg), h('p', { class: 'pv-calm' }, icon('info'), (sess as { note?: string } | null)?.note ?? 'No planned session for today.'));
  }
  const pl = sess.plannedLoad as { minutes: number | null; rpe: number; time?: { value: { over: number | null; limit: number | null }; reason: { note?: string } } } | undefined;
  const doneToday = m.week.find((d) => d.today)?.sessions ?? [];
  const picked = sess.session.picked;
  // A short day as planned says when it runs over the profile's short day (the time check's reason in the tip).
  const over = pl?.time?.value.over ?? 0;
  const meta = [sess.session.logged ? 'Logged today' : picked ? null : 'Next in the rotation', pl?.minutes ? `about ${Math.round(pl.minutes)} min${over > 0 ? `, ${over} over your ${pl.time!.value.limit}-minute short day` : ''}` : null, pl ? `planned effort ${fmt.num(pl.rpe)}/10` : null].filter(Boolean).join(' · ');
  const flags = sess.flags.filter((f) => !f.rule.startsWith('readiness.'));
  return h('section', { class: 'pv-card pv-session', 'data-sec': 'session' },
    h('div', { class: 'pv-card-head' },
      h('div', {},
        h('div', { class: 'pv-kicker' }, 'Today’s session'),
        h('div', { class: 'pv-session-title-row' }, h('h2', { class: 'pv-session-title' }, clean(sess.session.name)), sessionPicker(sess, ctx), ctx.onCopy ? h('button', { class: 'pv-copy-btn', 'aria-label': 'Copy today’s plan', 'data-tip': 'Copy today’s plan|As plain text, to paste into a note on your phone', onclick: () => ctx.onCopy!() }, icon('copy')) : null),
        picked && sess.session.suggested ? h('div', { class: 'pv-session-pick' }, icon('swap'), `You chose ${headName(sess.session.name)} · suggested: ${headName(sess.session.suggested.name)}`) : null,
        h('div', { class: 'pv-session-meta', 'data-tip': tip('Why this session', clean(sess.session.why), over > 0 && clean(pl!.time!.reason.note ?? '')) }, meta),
        doneToday.length ? h('div', { class: 'pv-session-done' }, icon('check'), doneToday.map((x, i) => [i ? ', ' : '', h('button', { class: 'pv-link', 'data-tip': tip(clean(x.label ?? x.name), 'Logged today', 'Click to edit it'), onclick: () => ctx.onEditSession(m.date, x) }, clean(x.label ?? x.name))]), ' logged today') : null,
      ),
      seg,
    ),
    flags.map((f) => h('div', { class: 'pv-lite is-flag' }, icon('info'), h('span', {}, h('b', {}, f.title ?? 'Note'), `\u00a0 ${clean(f.note ?? '')}`))),
    sess.warmup || lineFor(ctx, 'warmup') >= 0 ? h('div', { class: 'pv-lite' }, icon('flame'), h('span', {}, h('b', {}, 'Warm-up'), `\u00a0 ${clean(sess.warmup ?? ctx.checklist?.lines[lineFor(ctx, 'warmup')]?.steps.join(' · ') ?? '')}`), tick(lineFor(ctx, 'warmup'), 'Warm-up', ctx)) : null,
    h('ol', { class: 'pv-ex-list' }, sess.items.map((it, k) => row(it, k, r, sess, ctx))),
    sess.finisher ? finisherRow(sess.finisher, ctx) : null,
    checklistFoot(ctx),
  );
}

/** The finisher's line, with the plan's Why when its note has one. */
function finisherRow(f: NonNullable<SessionModel['finisher']>, ctx: TodayContext): Child[] {
  const why = f.planWhy ?? null;
  const id = `finisher:${f.exercise}`;
  const open = Boolean(why) && ctx.open.has(id);
  return [
    h('div', { class: 'pv-lite' }, icon('pulse'), h('span', {}, h('b', {}, 'Finisher'), `\u{a0} ${clean(f.name)}`), h('span', { class: 'pv-lite-r' }, clean(f.sr)),
      why ? h('button', { class: `pv-why-btn${open ? ' is-open' : ''}`, 'aria-expanded': open ? 'true' : 'false', onclick: () => ctx.onToggleWhy(id) }, 'Why', icon('chevron')) : null,
      tick(lineFor(ctx, 'finisher'), clean(f.name), ctx)),
    open && why ? planWhyPanel(why) : null,
  ];
}

/** Checklist lines today's rows do not show (the dashboard's list can differ from the engine's), and the count. */
function checklistFoot(ctx: TodayContext): HTMLElement | null {
  const ck = ctx.checklist;
  if (!ck || !ck.lines.length) return null;
  const extra = ck.lines.map((l, i) => ({ l, i })).filter(({ i }) => ck.targets[i]?.kind === 'none');
  const done = ck.checked.filter(Boolean).length;
  return h('div', { class: 'pv-ck-foot' },
    extra.length ? h('div', { class: 'pv-ck-extra' }, h('span', { class: 'pv-faint' }, 'Also on the checklist'), extra.map(({ l, i }) => h('span', { class: 'pv-ck-line' }, tick(i, clean(l.name), ctx), h('span', {}, clean(l.name)), h('span', { class: 'pv-faint' }, clean(l.sr))))) : null,
    h('div', { class: 'pv-faint' }, `${done} of ${ck.lines.length} ticked today`),
  );
}

// ---------------------------------------------------------------- the week
function weekStrip(m: TodayModel, r: Review, ctx: TodayContext): HTMLElement {
  const next = (r.nextInRotation as { lift: string | null }).lift;
  // Today's pick replaces the rotation's "up next" on today's cell.
  const picked = ctx.session?.session?.picked ? ctx.session.session.type : null;
  const days = m.week.map((d) => {
    // A day with nothing logged, ticked or marked is unknown: logs undercount
    // training, so it is never drawn as rest or missed.
    const label = { trained: d.sessions.map(shortName).join(', '), unlogged: d.confirmed ? 'Trained, not logged' : 'Not logged', rest: 'Rest', missed: 'Missed', none: d.today ? 'Today' : 'No entry', future: 'Upcoming' }[d.state];
    const ic = { trained: 'check', rest: 'minus', none: '', unlogged: 'question', missed: 'x', future: '' }[d.state];
    const mark = d.state;
    const why = d.beforeCycle ? 'Before this cycle: not counted.' : d.state === 'unlogged' ? (d.confirmed ? 'Your Sunday check-in says you trained. No session is logged yet.' : 'Workout ticked, no session logged.') : d.state === 'none' ? 'Nothing logged, ticked or marked yet. Not counted as rest or missed; the Sunday check-in asks.' : '';
    const editable = d.state === 'trained' && d.sessions.length > 0;
    const cell = h('div', { class: `pv-day${d.today ? ' is-today' : ''}${d.state === 'future' ? ' is-future' : ''}${editable ? ' is-editable' : ''}`, 'data-tip': tip(fmt.wd(d.date), label, why, editable ? 'Click to edit the logged session' : ''), ...(editable ? { role: 'button', tabindex: '0' } : {}) },
      h('span', { class: `pv-day-mark is-${mark}` }, ic ? icon(ic) : null),
      h('span', { class: 'pv-day-text' },
        h('span', { class: 'pv-day-name' }, fmt.dow(d.date), h('span', {}, String(+d.date.slice(8)))),
        h('span', { class: `pv-day-what${d.state === 'future' ? ' is-quiet' : ''}` }, label),
        d.today && (picked || next) ? h('span', { class: 'pv-day-next' }, picked ? `${picked} picked` : `${next} up next`) : null,
      ),
    );
    if (editable) {
      // One session edits straight away; two or more open a small menu.
      const open = (ev: Event) => {
        if ((ev.target as Element).closest('.pv-menu')) return;
        if (d.sessions.length === 1) return ctx.onEditSession(d.date, d.sessions[0]!);
        const was = cell.querySelector('.pv-menu');
        if (was) return was.remove();
        cell.append(h('div', { class: 'pv-menu pv-day-menu', role: 'menu' }, h('div', { class: 'pv-menu-head' }, `Edit ${fmt.wd(d.date)}`), d.sessions.map((x) => h('button', { class: 'pv-menu-item', role: 'menuitem', onclick: () => ctx.onEditSession(d.date, x) }, h('span', { class: 'pv-menu-check' }, icon('pencil')), h('span', { class: 'pv-menu-name' }, clean(x.label ?? x.name))))));
      };
      cell.addEventListener('click', open);
      cell.addEventListener('keydown', (ev) => { if ((ev).key === 'Enter') open(ev); });
    }
    return cell;
  });
  const lg = (st: string, ic: string, label: string) => h('span', {}, h('span', { class: `pv-day-mark is-${st}` }, ic ? icon(ic) : null), label);
  return h('section', { class: 'pv-card pv-week', 'data-sec': 'week' },
    h('div', { class: 'pv-week-head' }, h('div', { class: 'pv-kicker' }, 'This week'), h('div', { class: 'pv-legend' }, lg('trained', 'check', 'Trained'), lg('rest', 'minus', 'Rest'), lg('unlogged', 'question', 'Not logged'), lg('missed', 'x', 'Missed'), lg('none', '', 'No entry'))),
    h('div', { class: 'pv-days' }, days),
  );
}

/** The last 4 sessions, newest first, each opening the Log panel to edit it; and the full history. A card of its own, so it folds. */
function recentList(ctx: TodayContext): HTMLElement | null {
  const rec = ctx.recent ?? [];
  if (!rec.length) return null;
  return h('section', { class: 'pv-card pv-recent', 'data-sec': 'recent' },
    h('div', { class: 'pv-recent-head' }, h('span', { class: 'pv-kicker' }, 'Recent'),
      ctx.onOpenNote && ctx.historyNote ? h('button', { class: 'pv-link', onclick: () => ctx.onOpenNote!(paths().sessionHistory), 'data-tip': 'Session History|Every session, newest first (the vault’s Session History note)' }, `History: all ${ctx.totalSessions ?? rec.length} sessions`, icon('right')) : null),
    h('ul', {}, rec.map((x) => h('li', {},
      h('button', { class: 'pv-recent-row', onclick: () => ctx.onEditSession(x.date, { type: x.type, ...(x.label ? { label: x.label } : {}) }), 'data-tip': `${clean(x.name)}|${fmt.wd(x.date)} · click to edit` },
        h('span', { class: 'pv-recent-name' }, clean(x.name)),
        h('span', { class: 'pv-faint' }, fmt.wd(x.date)),
        x.check ? h('span', { class: `pv-recent-check${x.check.done >= x.check.total ? ' is-full' : ''}` }, `${x.check.done}/${x.check.total}`) : h('span', {}),
        h('span', { class: 'pv-faint pv-recent-min' }, [x.minutes ? `${x.minutes}m` : null, x.cardio ? `${x.cardio}m cardio` : null].filter(Boolean).join(' · ')),
      )))),
  );
}

// ---------------------------------------------------------------- notes
export function calmNotes(m: TodayModel): HTMLElement | null {
  if (!m.notes.length) return null;
  return h('div', { class: 'pv-notes' }, m.notes.map((n) => h('div', { class: 'pv-note' }, icon('info'), h('span', {}, n.text))));
}

function dataNotes(m: TodayModel): HTMLElement | null {
  const all = [...m.errors.map((e) => ({ ...e, error: true })), ...m.warnings.map((w) => ({ ...w, error: false }))];
  if (!all.length) return null;
  return h('details', { class: 'pv-data-notes' },
    h('summary', {}, `Data notes (${all.length})`),
    h('ul', {}, all.map((w) => h('li', { class: w.error ? 'is-error' : '' }, h('code', {}, w.code), ' ', clean(w.message), (w as { items?: unknown[] }).items?.length ? h('span', { class: 'pv-faint' }, ` ${(w as { items: unknown[] }).items.slice(0, 6).join('; ')}${(w as { items: unknown[] }).items.length > 6 ? ' …' : ''}`) : null))),
  );
}

/** Builds the whole Today screen into `root` (its children are replaced). */
export function renderToday(root: HTMLElement, m: TodayModel, ctx: TodayContext): void {
  root.replaceChildren();
  const r = m.review;
  if (!r) {
    // A vault with no plan yet (a first run): the welcome card leads; its notes repeat what the card's steps say, so they show only without it.
    root.append(h('div', { class: 'pv-empty' }, h('div', { class: 'pv-kicker' }, 'Pahlavan'), h('h1', { class: 'pv-serif-title' }, 'Today'), ctx.welcome ? null : calmNotes(m)), ctx.welcome ?? '', dataNotes(m) ?? '');
    return;
  }
  root.append(
    hero(m, r, ctx),
    ctx.yourDay ?? '',
    ctx.welcome ?? '',
    calmNotes(m) ?? '',
    h('div', { class: 'pv-today-grid' },
      h('div', { class: 'pv-today-side' }, readinessCard(m, r), coachCard(m.coach.now, ctx.onCopyCommand), ctx.dueCard ?? null, reminders(m, r, ctx)),
      h('div', { class: 'pv-today-main' }, sessionCard(m, r, ctx), weekStrip(m, r, ctx), recentList(ctx)),
    ),
    dataNotes(m) ?? '',
  );
}
