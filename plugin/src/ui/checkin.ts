// The Check-in screen, as signed off in mockups/checkin.html: the banner (the
// week's check-ins on the ring), the morning check-in (pre-filled from
// body-data.json, Habit Nudges' values included), the Sunday check-in from
// `checkin template` (only the open questions) with "What the coach will
// save" as the dry run and the coach step after it (ui/coach.ts: save, then
// ask the coach), and the last coach letter. The report is the engine's
// buildCheckin; the answers live in the view's state, so a re-read does not
// lose them; the writes go through the view.

import { LIGHT_WEEK } from './terms.ts';
import { parseHours } from '../reminders/inputs.ts';
import { bodyFmt, type BodyUnits } from './units.ts';
import type { MorningConflict, MorningKey } from '../../../src/adapters/vault/body-write.ts';
import { MUSCLES } from '../../../src/core/data/muscles.ts';
import type { MorningReminder, SorenessLevel } from '../../../src/core/schema.ts';
import { sundayAction, type CheckinWeek } from '../../../src/report/banners.ts';
import { patternLines, recordFromAnswers, sundaySummary, TRIAGE_STEP, type AskItem, type CheckinScreen, type SundayAnswers } from '../../../src/report/checkin-screen.ts';
import { banner, bannerKicker, type BannerPhase, type RingSeg } from './banner.ts';
import { bodyRecordCard, morningBell, type BodyRecordContext, type MorningBellUi } from './body-record.ts';
import { coachNext } from './coach.ts';
import { BODY, type Side } from './body-map.ts';
import { h, icon, s, type Child } from './dom.ts';
import { addDays, clean, daysBetween, fmt } from './format.ts';
import { tip } from './progress.ts';

type Sunday = NonNullable<CheckinScreen['sunday']>;

export interface CheckinState {
  /** The day the state belongs to: a new day starts over. */
  date: string;
  morning: {
    values: Record<MorningKey, number | null>;
    baseline: Record<MorningKey, number | null>;
    sore: Record<string, SorenessLevel>;
    soreFrom: Record<string, SorenessLevel>;
    /** "I'm ill today", and as the file held it. */
    ill: boolean;
    illFrom: boolean;
    conflicts: MorningConflict[] | null;
    busy: boolean;
    error: string | null;
    dirty: boolean;
  };
  sunday: { date: string; answers: SundayAnswers; pick: string | null; busy: boolean; error: string | null; dirty: boolean; editSaved: boolean; warnings: string[] } | null;
}

export function freshCheckinState(m: CheckinScreen): CheckinState {
  return {
    date: m.date,
    morning: { values: { ...m.morning.values }, baseline: { ...m.morning.baseline }, sore: { ...m.morning.sore }, soreFrom: { ...m.morning.soreFrom }, ill: m.morning.illness, illFrom: m.morning.illness, conflicts: null, busy: false, error: null, dirty: false },
    sunday: m.sunday ? { date: m.sunday.date, answers: structuredClone(m.sunday.answers), pick: null, busy: false, error: null, dirty: false, editSaved: false, warnings: [] } : null,
  };
}

/**
 * The Food tab's light checks into the Sunday answers: a pattern line its
 * check met on most of the week's days starts as met, while the answers are
 * untouched and no record is saved for the week; the user's own answer stays.
 */
export function applyPatternChecks(st: CheckinState, m: CheckinScreen, checks: Readonly<Record<string, { met: true | null }>>): void {
  const ss = st.sunday;
  if (!ss || ss.dirty || !m.sunday || m.sunday.existing || ss.date !== m.sunday.date) return;
  for (const [id, x] of Object.entries(checks)) if (x.met && id in ss.answers.pattern && ss.answers.pattern[id] === null) ss.answers.pattern[id] = true;
}

/** A re-read keeps the answers being edited and takes the file's values for the rest. */
export function refreshCheckinState(st: CheckinState | null, m: CheckinScreen): CheckinState {
  const fresh = freshCheckinState(m);
  if (!st || st.date !== m.date) return fresh;
  return {
    date: m.date,
    morning: st.morning.dirty ? st.morning : fresh.morning,
    sunday: st.sunday && st.sunday.dirty && fresh.sunday && st.sunday.date === fresh.sunday.date ? st.sunday : fresh.sunday,
  };
}

/** What the Check-in banner needs besides the report: the phase's look and name, the week's check-ins and the next tape day. */
export interface CheckinHero {
  phase: BannerPhase;
  phaseOf: { index: number; name: string } | null;
  planWeek: number | null;
  phaseNo: number | null;
  week: CheckinWeek;
  /** The tape's next date by the engine's body-record schedule (tapeDay), or null. */
  tape: { date: string; due: boolean; text: string; source: 'plan' | 'fixed' } | null;
}

export interface CheckinContext {
  canWrite: boolean;
  hero: CheckinHero;
  onChange: () => void;
  onSaveMorning: (force?: boolean) => void;
  onSaveSunday: (record: Record<string, unknown>) => void;
  onOpenNote?: (path: string) => void;
  /** The Body record card (absent: the tracking files are not read here). */
  bodyRecord?: BodyRecordContext | null;
  /** The morning card's reminder time, set on the card (absent: not offered). */
  bell?: { current: MorningReminder | null; ui: MorningBellUi; canWrite: boolean; onSave(next: MorningReminder): void } | null;
  /** The profile's body units: the weight is shown and typed in them, saved in kg. */
  units?: BodyUnits;
  /** The pattern lines the Food tab's light checks counted this week: the days met of the week's, the days tapped, and a pre-fill. */
  patternChecks?: Readonly<Record<string, { met: true | null; days: number; of: number; tapped: number }>>;
  /** Copies the coach's command (after the save); absent: the command shows without Copy. */
  onCopy?: (text: string) => void;
}

// ---------------------------------------------------------------- small parts

const SORE_LABEL: Record<string, string> = {};
for (const m of MUSCLES) if (m.highlighter && !SORE_LABEL[m.highlighter]) SORE_LABEL[m.highlighter] = m.label;
/** The pain map takes the joints and the head too. */
const PAIN_LABEL: Record<string, string> = { ...SORE_LABEL, knees: 'Knees', ankles: 'Ankles', hands: 'Hands', feet: 'Feet', head: 'Head', neck: 'Neck', tibialis: 'Shins', adductors: 'Adductors' };
const NOT_MUSCLE = new Set(['head', 'hair', 'hands', 'feet', 'ankles', 'knees', 'neck']);

const kb = (k: string) => ({ 'data-k': k });
function pill(label: string, on: boolean, onclick: () => void, k: string): HTMLElement {
  return h('button', { class: `pv-pill${on ? ' is-on' : ''}`, 'aria-pressed': on ? 'true' : 'false', onclick, ...kb(k) }, label);
}
const calm = (text: string) => h('p', { class: 'pv-calm' }, icon('info'), text);

function q(n: number, title: Child, body: Child, opt: { known?: Child; prefilled?: boolean; note?: string | null; open?: boolean } = {}): HTMLElement {
  return h('div', { class: `pv-q${opt.open ? ' is-open-q' : ''}` },
    h('div', { class: 'pv-q-head' }, h('span', { class: 'pv-q-n' }, String(n)), h('div', {}, h('div', { class: 'pv-q-title' }, title), opt.known ? h('div', { class: 'pv-q-known' }, icon('history'), h('span', {}, opt.known)) : null), opt.prefilled ? h('span', { class: 'pv-tag' }, 'Pre-filled') : null),
    h('div', { class: 'pv-q-body' }, body),
    opt.note ? h('div', { class: 'pv-q-note' }, opt.note) : null,
  );
}

function figure(side: Side, mode: 'sore' | 'pain', marked: (slug: string) => string | null, tap: (slug: string, label: string) => void): HTMLElement {
  const parts: SVGElement[] = [s('path', { class: 'pv-bm-base', d: BODY.outline[side] })];
  for (const [slug, ds] of Object.entries(BODY[side])) {
    const label = mode === 'sore' ? (NOT_MUSCLE.has(slug) ? undefined : SORE_LABEL[slug]) : slug === 'hair' ? undefined : PAIN_LABEL[slug];
    const v = label ? marked(slug) : null;
    for (const d of ds) {
      const p = s('path', { class: label ? `pv-ci-tap${v ? ` is-${v}` : ''}` : 'pv-bm-base', d, ...(label ? { 'data-tip': `${label}|${mode === 'sore' ? 'Tap: none, mild, sore' : 'Tap to mark or clear'}`, role: 'button', 'aria-label': `${label}: ${v ?? (mode === 'sore' ? 'not sore' : 'no pain')}` } : {}) });
      if (label) p.addEventListener('click', () => tap(slug, label));
      parts.push(p);
    }
  }
  parts.push(s('path', { class: 'pv-bm-outline', d: BODY.outline[side] }));
  return h('div', { class: 'pv-figure' }, s('svg', { viewBox: BODY.viewBox[side], role: 'img', 'aria-label': `${side} of the body` }, parts), h('div', { class: 'pv-figure-cap' }, side === 'front' ? 'Front' : 'Back'));
}

const time = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// ---------------------------------------------------------------- morning

const SCALES: { key: MorningKey; label: string; lo: string; hi: string }[] = [
  { key: 'energy', label: 'Energy', lo: 'Flat', hi: 'Great' },
  { key: 'soreness', label: 'Soreness', lo: 'None', hi: 'Very sore' },
  { key: 'sleepQ', label: 'Sleep quality', lo: 'Poor', hi: 'Great' },
];
const FIELDS: { key: MorningKey; label: string; unit: string; step: number }[] = [
  { key: 'sleepH', label: 'Sleep', unit: 'h', step: 0.1 },
  { key: 'rhr', label: 'Resting HR', unit: 'bpm', step: 1 },
  { key: 'hrv', label: 'HRV', unit: 'ms', step: 1 },
  { key: 'weight', label: 'Weight', unit: 'kg', step: 0.1 },
  { key: 'steps', label: 'Steps yesterday', unit: '', step: 100 },
  { key: 'floors', label: 'Floors yesterday', unit: '', step: 1 },
];
const LABEL: Record<MorningKey, string> = { energy: 'Energy', soreness: 'Soreness', sleepQ: 'Sleep quality', sleepH: 'Sleep', rhr: 'Resting HR', hrv: 'HRV', weight: 'Weight', steps: 'Steps yesterday', floors: 'Floors yesterday' };
const show = (v: number | null) => (v === null ? 'empty' : String(v));

function morningChanges(st: CheckinState): { fields: MorningKey[]; sore: string[]; ill: boolean } {
  const m = st.morning;
  const fields = (Object.keys(m.values) as MorningKey[]).filter((k) => m.values[k] !== m.baseline[k]);
  const sore = [...new Set([...Object.keys(m.sore), ...Object.keys(m.soreFrom)])].filter((k) => (m.sore[k] ?? null) !== (m.soreFrom[k] ?? null));
  return { fields, sore, ill: (m.ill ?? false) !== (m.illFrom ?? false) };
}

function morningCard(c: CheckinScreen, st: CheckinState, ctx: CheckinContext): HTMLElement {
  const m = st.morning;
  const mm = c.morning;
  const change = () => {
    m.dirty = true;
    m.conflicts = null;
    m.error = null;
    ctx.onChange();
  };
  const changes = morningChanges(st);
  const n = changes.fields.length + changes.sore.length + (changes.ill ? 1 : 0);
  const at = mm.checkedAt ? time(mm.checkedAt) : null;
  // checkedAt is written by Habit Nudges and, since 0.5.0, by Pahlavan's own first save of the day.
  const sub = mm.checkedAt ? `Checked in${at ? ` at ${at}` : ''} · edit any answer here` : mm.filled ? 'Filled in for today · edit any answer here' : 'About 30 seconds · feeds today’s readiness';
  const save = h('button', { class: 'pv-btn-primary', disabled: !ctx.canWrite || m.busy || n === 0, onclick: () => ctx.onSaveMorning(false), ...kb('m-save') }, icon('check'), m.busy ? 'Saving…' : 'Save');

  const taps = SCALES.map((sc) => h('div', { class: 'pv-tap-row' },
    h('span', { class: 'pv-tap-label' }, sc.label),
    h('div', { class: 'pv-tap5', role: 'radiogroup', 'aria-label': sc.label }, [1, 2, 3, 4, 5].map((v) => h('button', { class: `pv-tap${m.values[sc.key] === v ? ' is-on' : ''}`, role: 'radio', 'aria-checked': m.values[sc.key] === v ? 'true' : 'false', 'aria-label': `${sc.label} ${v}`, onclick: () => { m.values[sc.key] = m.values[sc.key] === v ? null : v; change(); }, ...kb(`m-${sc.key}-${v}`) }, String(v)))),
    h('span', { class: 'pv-tap-anchor' }, `${sc.lo} to ${sc.hi}`),
  ));
  // A sick day: one tap, saved as the day's illness, and readiness stops hard training that day.
  const ill = h('div', { class: 'pv-tap-row' },
    h('span', { class: 'pv-tap-label' }, 'Illness'),
    h('div', { class: 'pv-pills' }, pill('I’m ill today', m.ill, () => { m.ill = !m.ill; change(); }, 'm-ill')),
    h('span', { class: 'pv-tap-anchor' }, m.ill ? 'No hard training today' : 'Tap on a sick day'),
  );
  // The weight in the body unit: shown converted, typed in it, kept in kg (to 0.1).
  const F = bodyFmt(ctx.units);
  const shownOf = (k: MorningKey, v: number | null) => (v === null || v === undefined ? v : k === 'weight' ? F.wt(v) : v);
  const fields = FIELDS.map((f) => {
    const unit = f.key === 'weight' ? F.w : f.unit;
    // Sleep reads as the card reads it: "7:20", "7h20" or "7.3" (a text field, so the colon types).
    const sleep = f.key === 'sleepH';
    const input = h('input', { type: sleep ? 'text' : 'number', ...(sleep ? { placeholder: '7:20 or 7.3' } : { step: f.step }), inputmode: 'decimal', value: shownOf(f.key, m.values[f.key] ?? null) ?? '', 'aria-label': f.label, ...kb(`m-${f.key}`) });
    input.addEventListener('change', () => {
      const t = input.value.trim();
      const v = t === '' ? null : sleep ? parseHours(t) : Number(t);
      if (t !== '' && (v === null || !Number.isFinite(v))) {
        // The wrapper is marked too: its border shows it (a class, not :has(), which the directory's review warns about).
        input.classList.add('is-bad');
        input.closest('.pv-field-in')?.classList.add('is-bad');
        input.setAttribute('aria-invalid', 'true');
        return;
      }
      input.classList.remove('is-bad');
      input.closest('.pv-field-in')?.classList.remove('is-bad');
      input.removeAttribute('aria-invalid');
      m.values[f.key] = v === null ? null : f.key === 'weight' ? Math.round(F.kg(v) * 10) / 10 : v;
      change();
    });
    return h('label', { class: 'pv-field', ...(f.key === 'steps' || f.key === 'floors' ? { 'data-tip': `${f.label}|${fmt.wd(mm.yesterday)}’s total, saved on that day (as Habit Nudges does)` } : {}) }, h('span', {}, f.label), h('span', { class: 'pv-field-in' }, input, unit ? h('em', {}, unit) : null));
  });

  const marked = Object.entries(m.sore).filter(([, v]) => v);
  const trains = new Set(mm.trains);
  const overlap = marked.filter(([slug]) => trains.has(slug));
  const tapSore = (slug: string) => {
    const next = { undefined: 'mild', mild: 'sore', sore: undefined } as Record<string, SorenessLevel | undefined>;
    const v = next[String(m.sore[slug])];
    if (v) m.sore[slug] = v;
    else delete m.sore[slug];
    change();
  };
  const sore = h('div', { class: 'pv-mc-sore' },
    h('div', { class: 'pv-figures is-small' }, figure('front', 'sore', (x) => m.sore[x] ?? null, tapSore), figure('back', 'sore', (x) => m.sore[x] ?? null, tapSore)),
    h('div', { class: 'pv-mc-sore-side' },
      h('h4', {}, 'Sore muscles'),
      h('p', { class: 'pv-muted' }, 'Tap a muscle: none, mild, sore.'),
      h('div', { class: 'pv-lg-sore-legend' }, h('span', {}, h('i', { class: 'is-none' }), 'None'), h('span', {}, h('i', { class: 'is-mild' }), 'Mild'), h('span', {}, h('i', { class: 'is-sore' }), 'Sore')),
      h('ul', { class: 'pv-lg-sore-list' }, marked.length ? marked.map(([slug, v]) => h('li', {}, h('span', {}, SORE_LABEL[slug] ?? slug), h('span', { class: `pv-status is-${v === 'sore' ? 'over' : 'below'}` }, icon('alert'), v === 'sore' ? 'Sore' : 'Mild'))) : h('li', { class: 'pv-faint' }, 'Nothing marked')),
      h('div', { class: 'pv-sore-note' }, mm.sessionName ? (overlap.length ? `Today’s session (${clean(mm.sessionName)}) trains ${overlap.map(([slug, v]) => `${(SORE_LABEL[slug] ?? slug).toLowerCase()} (${v})`).join(', ')}: a sore muscle trims its sets on Today.` : `Nothing marked that today’s session (${clean(mm.sessionName)}) trains.`) : 'No planned session today.'),
    ),
  );

  const pending = n ? `To save: ${[...changes.fields.map((k) => `${k === 'hrv' ? LABEL[k] : LABEL[k].toLowerCase()} ${show(shownOf(k, m.baseline[k] ?? null))} to ${show(shownOf(k, m.values[k] ?? null))}`), ...(changes.sore.length ? [`${changes.sore.length} sore muscle${changes.sore.length === 1 ? '' : 's'}`] : []), ...(changes.ill ? [m.ill ? 'ill today' : 'not ill today'] : [])].join(', ')}.` : 'Nothing changed yet.';
  const conflict = m.conflicts?.length
    ? h('div', { class: 'pv-lg-banner is-conflict' }, icon('alert'),
        h('span', {}, `Saved elsewhere since this form opened (Habit Nudges, most likely): ${m.conflicts.map((x) => `${LABEL[x.key]} is ${show(x.disk)} there, ${show(x.mine)} here`).join('; ')}.`),
        h('button', { class: 'pv-btn-quiet', onclick: () => { for (const x of m.conflicts!) { m.values[x.key] = x.disk; m.baseline[x.key] = x.disk; } m.conflicts = null; ctx.onChange(); }, ...kb('m-keep') }, 'Keep theirs'),
        h('button', { class: 'pv-btn-quiet', onclick: () => ctx.onSaveMorning(true), ...kb('m-force') }, 'Save mine'))
    : null;
  return h('section', { class: 'pv-card', 'data-sec': 'morning' },
    h('div', { class: 'pv-card-head' }, h('div', {}, h('div', { class: 'pv-kicker' }, 'Morning check-in'), h('h3', { class: 'pv-card-title' }, fmt.dayLong(mm.date)), h('div', { class: 'pv-card-sub' }, sub)), h('div', { class: 'pv-card-tools' }, ctx.bell ? morningBell({ ...ctx.bell, onChange: ctx.onChange }) : null, save)),
    h('div', { class: 'pv-mc-taps' }, taps, ill),
    h('div', { class: 'pv-mc-fields' }, fields),
    sore,
    h('div', { class: 'pv-mc-foot' }, h('span', { class: n ? '' : 'pv-faint' }, pending), m.error ? h('span', { class: 'pv-ci-error' }, m.error) : null),
    conflict,
    ctx.canWrite ? null : calm('This view cannot write body-data.json.'),
  );
}

// ---------------------------------------------------------------- sunday

const ask = (sun: Sunday, topic: string): (AskItem & { options?: { option: string; value: unknown }[]; known?: Record<string, unknown> | null; answer?: string }) | undefined => sun.template.ask.find((a) => a.topic === topic);

function sundayCard(c: CheckinScreen, sun: Sunday, st: CheckinState, ctx: CheckinContext): HTMLElement {
  const ss = st.sunday!;
  const a = ss.answers;
  const t = sun.template;
  const sessionName = (type: string) => sun.sessionTypes.find((x) => x.type === type)?.name.replace(/\s*—\s*/g, ' · ') ?? type;
  const change = () => {
    ss.dirty = true;
    ss.error = null;
    ctx.onChange();
  };
  const title = `The week of ${fmt.day(sun.weekStart)} to ${fmt.day(sun.date)}`;

  if (sun.status === 'saved' && !ss.editSaved) {
    const sum = sundaySummary(t, a, sessionName);
    return h('section', { class: 'pv-card', 'data-card': 'sunday', 'data-sec': 'sunday' },
      h('div', { class: 'pv-card-head' }, h('div', {}, h('div', { class: 'pv-kicker' }, 'Sunday check-in'), h('h3', { class: 'pv-card-title' }, title), h('div', { class: 'pv-card-sub' }, `Saved for ${fmt.dayLong(sun.date)} · the next one opens on ${fmt.dayLong(sun.nextOpens)}`)),
        h('div', { class: 'pv-card-tools' }, h('button', { class: 'pv-btn-quiet', disabled: !ctx.canWrite, onclick: () => { ss.editSaved = true; ctx.onChange(); }, ...kb('s-change') }, icon('pencil'), 'Change the answers'))),
      h('ul', { class: 'pv-sum-list' }, sum.items.map((x) => h('li', {}, icon('check'), h('span', {}, x)))),
      coachNext(c.coach.now, ctx.onCopy),
    );
  }

  const qs: Child[] = [];
  let n = 0;
  const num = () => ++n;
  const opts = (topic: string) => (ask(sun, topic)?.options ?? []);
  const pills = (topic: string, value: number | null, set: (v: number | null) => void) =>
    h('div', { class: 'pv-pills' }, opts(topic).map((o) => pill(o.option, value === o.value, () => { set(value === o.value ? null : (o.value as number)); change(); }, `s-${topic}-${String(o.value)}`)));

  const gapsQ = ask(sun, 'gaps');
  if (gapsQ) {
    const k = (gapsQ.known ?? {}) as { lifting?: { done: number; target: number }; short?: { done: number; target: number }; tickedNotLogged?: string[] };
    const rows = Object.entries(a.gaps).sort(([x], [y]) => (x < y ? -1 : 1)).map(([d, g]) => {
      const why = (k.tickedNotLogged ?? []).includes(d) ? 'Workout ticked, nothing logged' : 'Nothing logged or ticked';
      const choice = (val: 'trained' | 'rest' | 'missed', label: string) => pill(label, g.choice === val, () => { g.choice = g.choice === val ? null : val; change(); }, `s-gap-${d}-${val}`);
      const sel = g.choice === 'trained' ? h('select', { class: 'pv-sel', 'aria-label': `Which session on ${fmt.wd(d)}`, onchange: (ev: Event) => { g.session = (ev.target as HTMLSelectElement).value; change(); }, ...kb(`s-gap-${d}-sel`) },
        h('option', { value: '' }, 'Which session?'), sun.sessionTypes.map((x) => h('option', { value: x.type, selected: g.session === x.type }, x.type === 'custom' ? x.name : `${x.type} · ${x.name.replace(/\s*—\s*/g, ' · ')}`))) : null;
      return h('div', { class: 'pv-gap-row' }, h('div', { class: 'pv-gap-day' }, h('b', {}, fmt.wd(d)), h('span', {}, why)), h('div', { class: 'pv-pills' }, choice('trained', 'Trained, not logged'), choice('rest', 'Rest'), choice('missed', 'Missed')), sel);
    });
    const logLine = gapsQ.question.split(/\.\s+Anything/)[0];
    qs.push(q(num(), 'Anything you did that isn’t logged?', rows.length ? rows : h('p', { class: 'pv-faint' }, 'Every day of the week is logged or ticked.'), { known: `${clean(logLine)}. Lifting ${k.lifting?.done ?? 0} of ${k.lifting?.target ?? 0}, short ${k.short?.done ?? 0} of ${k.short?.target ?? 0}.`, prefilled: true }));
  }
  if (ask(sun, 'effort')) qs.push(q(num(), 'How hard did the week’s training feel overall?', pills('effort', a.effort, (v) => (a.effort = v))));
  const painQ = ask(sun, 'pain');
  if (painQ) {
    const areaOf = (label: string) => a.pain.areas.find((x) => x.area.toLowerCase() === label.toLowerCase());
    const tapPain = (_slug: string, label: string) => {
      const i = a.pain.areas.findIndex((x) => x.area.toLowerCase() === label.toLowerCase());
      if (i >= 0) a.pain.areas.splice(i, 1);
      else a.pain.areas.push({ area: label.toLowerCase(), severity: a.pain.option === 2 ? 5 : 2 });
      change();
    };
    const body = h('div', {},
      h('div', { class: 'pv-pills' }, (painQ.options ?? []).map((o, i) => pill(o.option, a.pain.option === i, () => { a.pain.option = a.pain.option === i ? null : i; if (i === 0) a.pain.areas = []; change(); }, `s-pain-${i}`))),
      a.pain.option && a.pain.option > 0 ? h('div', { class: 'pv-pain-wrap' },
        h('div', { class: 'pv-figures is-small' }, figure('front', 'pain', (x) => (areaOf(PAIN_LABEL[x] ?? x) ? 'pain' : null), tapPain), figure('back', 'pain', (x) => (areaOf(PAIN_LABEL[x] ?? x) ? 'pain' : null), tapPain)),
        h('div', { class: 'pv-pain-side' }, h('h4', {}, 'Where, and how bad'),
          a.pain.areas.length ? a.pain.areas.map((x, i) => {
            const out = h('b', {}, `${x.severity}/10`);
            const range = h('input', { type: 'range', min: 0, max: 10, step: 1, value: x.severity, 'aria-label': `${x.area}, 0 to 10`, ...kb(`s-sev-${i}`) });
            range.addEventListener('input', () => { x.severity = Number(range.value); out.textContent = `${x.severity}/10`; ss.dirty = true; refresh(); });
            return h('div', { class: 'pv-sev-row' }, h('span', {}, x.area.charAt(0).toUpperCase() + x.area.slice(1)), range, out);
          }) : h('p', { class: 'pv-faint' }, 'Tap where it hurts.')),
      ) : null,
    );
    // What the week's logs already say ("Logged: knee 4 of 10 during Barbell Back Squat, Tue."), as the other questions show theirs.
    const logged = (painQ.known ?? {})['line'];
    qs.push(q(num(), 'Any pain or niggle?', body, { ...(typeof logged === 'string' ? { known: clean(logged) } : {}), note: painQ.answer ? clean(painQ.answer) : null }));
  }
  if (ask(sun, 'life')) qs.push(q(num(), 'How was the week outside training?', pills('life', a.stress, (v) => (a.stress = v))));
  if (ask(sun, 'recovery')) qs.push(q(num(), 'Recovered by the next session?', pills('recovery', a.recovery, (v) => (a.recovery = v)), { note: ask(sun, 'recovery')!.answer ? clean(ask(sun, 'recovery')!.answer) : null }));
  const rirQ = ask(sun, 'rir');
  if (rirQ) {
    const top = ((rirQ.known ?? {}) as { topSets?: { date: string; lift: string; weight: number; unit: string; reps: number }[] }).topSets ?? [];
    const by = new Map<string, typeof top>();
    for (const x of top) by.set(x.lift, [...(by.get(x.lift) ?? []), x]);
    const list = h('ul', { class: 'pv-rir-list' }, [...by].map(([lift, xs]) => h('li', {}, h('span', {}, lift), h('span', {}, xs.map((x) => `${x.weight} ${x.unit} × ${x.reps} ${fmt.wd(x.date).slice(0, 3)}`).join(', ')))));
    const rirPills = h('div', { class: 'pv-pills' }, (rirQ.options ?? []).map((o) => pill(o.option, a.rir === o.value, () => { a.rir = a.rir === o.value ? undefined : (o.value as number | null); change(); }, `s-rir-${String(o.value)}`)));
    qs.push(q(num(), 'On your logged top sets, how many more clean reps were left?', [list, rirPills], { known: 'The week’s top sets, in each lift’s own unit. One answer for all; it matters most where a set reached the top of its range.', prefilled: true }));
  }
  const protQ = ask(sun, 'protein');
  if (protQ) {
    const k = (protQ.known ?? {}) as { proteinTicks?: number; unticked?: string[]; today?: { tickAt: string | null } };
    const ticks = Number(k.proteinTicks ?? 0);
    const other = k.unticked?.length ?? 7 - ticks;
    // Today waits for its own tick while that is still ahead; the answer covers the days before it.
    const later = k.today ? ` Today’s tick${k.today.tickAt ? ` at ${k.today.tickAt}` : ''} still counts when it comes.` : '';
    qs.push(q(num(), `You ticked protein on ${ticks} day${ticks === 1 ? '' : 's'}. On how many of the other ${other}${k.today ? ' before today' : ''} did you reach about ${sun.proteinFloorG ?? 'your'} g?`, pills('protein', a.protein, (v) => (a.protein = v)), { known: `${ticks} protein tick${ticks === 1 ? '' : 's'} this week${later ? `.${later}` : ''}`, prefilled: true }));
  }
  const patQ = ask(sun, 'pattern');
  if (patQ) {
    // One question, a tap per line: met this week or not (the Food tab shows the answers).
    const rows = patternLines(t).map((l) => {
      const v = a.pattern[l.id] ?? null;
      const choice = (val: boolean, label: string) => pill(label, v === val, () => { a.pattern[l.id] = v === val ? null : val; change(); }, `s-pt-${l.id}-${val ? 'y' : 'n'}`);
      const ck = ctx.patternChecks?.[l.id];
      // Only a line the checks were tapped for this week says so.
      const from = ck?.tapped ? h('span', { class: 'pv-faint' }, `Your light checks: met on ${ck.days} of ${ck.of} days${ck.met ? ', pre-filled' : ''}`) : null;
      return h('div', { class: 'pv-gap-row' }, h('div', { class: 'pv-gap-day' }, h('b', {}, l.name), h('span', {}, l.target), from), h('div', { class: 'pv-pills' }, choice(true, 'Met'), choice(false, 'Not met')));
    });
    const prefilled = Object.values(ctx.patternChecks ?? {}).some((x) => x.met);
    qs.push(q(num(), 'The eating plan’s pattern this week: met or not?', rows, { known: 'One tap per line. Leave a line open when you are not sure; the Food tab shows the answers.', ...(prefilled ? { prefilled: true } : {}) }));
  }
  if (ask(sun, 'enjoyment')) qs.push(q(num(), 'How much did you look forward to sessions?', pills('enjoyment', a.enjoyment, (v) => (a.enjoyment = v))));
  const availQ = ask(sun, 'availability');
  if (availQ) {
    const known = (availQ.known ?? {}) as { nextDeloadWeek?: string | null; alreadyKnown?: { from: string; to: string; kind: string; note?: string }[] };
    const b = a.busy;
    const start = addDays(sun.date, 1);
    const grid: Child[] = [h('span', {}), ...['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => h('span', { class: 'pv-rp-dow' }, d))];
    for (let w = 0; w < 6; w++) {
      const ws = addDays(start, w * 7);
      const deload = ws === known.nextDeloadWeek;
      grid.push(h('span', { class: 'pv-rp-wk' }, fmt.day(ws), deload ? h('em', { 'data-tip': LIGHT_WEEK }, 'Light') : null));
      for (let d = 0; d < 7; d++) {
        const day = addDays(ws, d);
        const inR = b.from && b.to && day >= b.from && day <= b.to;
        const end = day === b.from || day === b.to;
        grid.push(h('button', { class: `pv-rp-day${inR ? ' is-in' : ''}${end ? ' is-end' : ''}${deload ? ' is-deload' : ''}`, 'aria-label': fmt.wd(day), onclick: () => {
          if (!ss.pick) { ss.pick = day; b.from = day; b.to = null; } else { const [x, y] = [ss.pick, day].sort(); b.from = x!; b.to = y!; ss.pick = null; }
          change();
        }, ...kb(`s-day-${day}`) }, String(+day.slice(8))));
      }
    }
    const picker = b.option === 1 || b.option === 2 ? h('div', { class: 'pv-rp' },
      h('div', { class: 'pv-rp-head' }, h('b', {}, b.from && b.to ? `${fmt.wd(b.from)} to ${fmt.wd(b.to)}` : b.from ? `From ${fmt.wd(b.from)}: tap the last day` : 'Tap the first and the last day'), h('span', { class: 'pv-faint' }, 'Two taps set the range')),
      h('div', { class: 'pv-rp-grid' }, grid)) : null;
    const already = (known.alreadyKnown ?? []).length ? h('div', { class: 'pv-q-sub' }, `Already noted: ${(known.alreadyKnown ?? []).map((x) => `${x.note ? `${x.note}, ` : ''}${fmt.wd(x.from)} to ${fmt.wd(x.to)}`).join('; ')}.`) : null;
    qs.push(q(num(), 'Anything different in the weeks ahead?', [h('div', { class: 'pv-pills' }, (availQ.options ?? []).map((o, i) => pill(o.option, b.option === i, () => { b.option = b.option === i ? null : i; if (i !== 1 && i !== 2) { b.from = null; b.to = null; ss.pick = null; } change(); }, `s-avail-${i}`))), picker, already],
      { note: availQ.answer ? clean(availQ.answer).replace(/\(from [^)]*\)/, known.nextDeloadWeek ? `(from ${fmt.wd(known.nextDeloadWeek)})` : '') : null }));
  }
  const decQ = ask(sun, 'decisions');
  if (decQ) {
    const focus = c.letter?.focus ?? null;
    const question = c.letter?.sections.find((x) => /question/i.test(x.heading))?.text ?? null;
    const notes = h('textarea', { class: 'pv-ta', placeholder: question ? 'Your answer, and anything worth keeping, in a line' : 'Anything worth keeping for the coach, in a line', 'aria-label': 'Notes for the coach', ...kb('s-notes') });
    notes.value = a.notes;
    notes.addEventListener('input', () => { a.notes = notes.value; ss.dirty = true; refresh(); });
    qs.push(q(num(), focus ? `Last letter’s focus: ${focus}. Followed?` : 'Anything for the coach?', [
      focus ? h('div', { class: 'pv-pills' }, pill('Yes', a.focus === true, () => { a.focus = a.focus === true ? null : true; change(); }, 's-focus-yes'), pill('No', a.focus === false, () => { a.focus = a.focus === false ? null : false; change(); }, 's-focus-no')) : null,
      question ? h('div', { class: 'pv-q-sub' }, `And its question: ${question}`) : null,
      notes,
    ], { known: c.letter ? `From the letter of ${c.letter.date ? fmt.wd(c.letter.date) : 'last week'}. The decisions due stay in Decisions.md.` : 'No letter yet, so no focus to check.' }));
  }
  const delQ = ask(sun, 'deload');
  if (delQ) {
    const reason = h('input', { class: 'pv-ci-text', type: 'text', placeholder: 'Why, in a few words', value: a.deload.reason, 'aria-label': 'Why cancel the light week', ...kb('s-del-reason') });
    reason.addEventListener('input', () => { a.deload.reason = reason.value; ss.dirty = true; refresh(); });
    const k = (delQ.known ?? {}) as { cancelOnlyIf?: string };
    qs.push(q(num(), clean(delQ.question), [h('div', { class: 'pv-pills' }, pill('Keep it', a.deload.cancelled === false, () => { a.deload.cancelled = a.deload.cancelled === false ? null : false; change(); }, 's-del-keep'), pill('Cancel it', a.deload.cancelled === true, () => { a.deload.cancelled = a.deload.cancelled === true ? null : true; change(); }, 's-del-cancel')), a.deload.cancelled ? reason : null],
      { note: k.cancelOnlyIf ? `Cancel only if ${k.cancelOnlyIf}.` : null, open: a.deload.cancelled === null }));
  }
  const flQ = ask(sun, 'full-load');
  if (flQ) {
    const weeks = ((flQ.known ?? {}) as { weeks?: { weekStart: string; planWeek: number }[] }).weeks ?? [];
    for (const w of weeks) {
      const v = a.fullLoad[w.weekStart] ?? null;
      qs.push(q(num(), `The plan counted week ${w.planWeek} (from ${fmt.day(w.weekStart)}) as a light week, and loads were logged for it. Was it trained at full load?`,
        h('div', { class: 'pv-pills' }, pill('Yes, full load', v === true, () => { a.fullLoad[w.weekStart] = v === true ? null : true; change(); }, `s-fl-${w.weekStart}-y`), pill('No, it was a light week', v === false, () => { a.fullLoad[w.weekStart] = v === false ? null : false; change(); }, `s-fl-${w.weekStart}-n`)),
        { open: v === null, note: 'Yes: progression treats those sessions as loading sessions.' }));
    }
  }
  const trQ = ask(sun, 'triage');
  if (trQ) {
    const stalled = ((trQ.known ?? {}) as { stalled?: { lift: string; step: number | null; suggestion: string | null; facts?: unknown }[] }).stalled ?? [];
    for (const x of stalled) {
      const sel = h('select', { class: 'pv-sel', 'aria-label': `${x.lift}: triage step`, onchange: (ev: Event) => { a.triage[x.lift] = Number((ev.target as HTMLSelectElement).value); change(); }, ...kb(`s-tr-${x.lift}`) },
        [0, 1, 2, 3, 4].map((v) => h('option', { value: v, selected: (a.triage[x.lift] ?? 0) === v }, v ? TRIAGE_STEP[v] : 'No step on record')));
      // The plan's stall rule gives a step (the triage ladder), or reports the facts and leaves the response to the coach.
      const sub = x.step ? `The plan's stall rule gives step ${x.step}${x.suggestion ? `: ${clean(x.suggestion)}` : ''}` : x.facts ? 'Your coach picks the response at the check-in; record the step the letter applies, if any' : null;
      qs.push(q(num(), `${x.lift} has stalled: the triage step`, [sub ? h('div', { class: 'pv-q-sub' }, sub) : null, sel], { prefilled: !x.facts, note: 'The step the letter applies, kept on record; the next check-in starts one step later.' }));
    }
  }

  const sumBox = h('div', { class: 'pv-sum' });
  const refresh = () => sumBox.replaceChildren(...h('div', {}, summaryParts(c, sun, st, ctx, sessionName)).childNodes);
  refresh();
  const sub = sun.status === 'late' ? `Last Sunday’s check-in, not saved yet · ${fmt.dayLong(sun.date)}` : sun.status === 'edit' || sun.status === 'saved' ? `Saved for ${fmt.dayLong(sun.date)} · change any answer and save again` : `Today · built from your log by the engine · only the open questions`;
  return h('section', { class: 'pv-card', 'data-card': 'sunday', 'data-sec': 'sunday' },
    h('div', { class: 'pv-card-head' }, h('div', {}, h('div', { class: 'pv-kicker' }, 'Sunday check-in'), h('h3', { class: 'pv-card-title' }, title), h('div', { class: 'pv-card-sub' }, sub))),
    h('div', { class: 'pv-qs' }, qs.length ? qs : calm('No open questions this week.')),
    sumBox,
  );
}

function summaryParts(c: CheckinScreen, sun: Sunday, st: CheckinState, ctx: CheckinContext, sessionName: (t: string) => string): Child[] {
  const ss = st.sunday!;
  const sum = sundaySummary(sun.template, ss.answers, sessionName);
  const record = recordFromAnswers(sun.template, ss.answers);
  return [
    h('div', { class: 'pv-sum-head' },
      h('div', {}, h('div', { class: 'pv-kicker' }, 'What the coach will save'), h('div', { class: 'pv-card-sub' }, `${sun.existing ? 'Updates the record' : 'Adds a record'} for ${fmt.dayLong(sun.date)} in Coach/checkins.json, when you save. The coach writes the week’s letter from it.`)),
      h('button', { class: 'pv-btn-primary', disabled: !ctx.canWrite || ss.busy, onclick: () => ctx.onSaveSunday(record), ...kb('s-save') }, icon('save'), ss.busy ? 'Saving…' : 'Save')),
    // The coach step after it: save first, then the command (with Copy once saved).
    coachNext(c.coach.now, ctx.onCopy),
    sum.items.length ? h('ul', { class: 'pv-sum-list' }, sum.items.map((x) => h('li', {}, icon('check'), h('span', {}, x)))) : h('p', { class: 'pv-faint' }, 'Nothing answered yet.'),
    sum.open.length ? h('div', { class: 'pv-sum-open' }, h('b', {}, 'Still open: '), `${sum.open.join('; ')}. Open answers are left out; you can save now and add them later.`) : null,
    ss.warnings.length ? h('div', { class: 'pv-sum-open' }, h('b', {}, 'The engine notes: '), ss.warnings.join(' ')) : null,
    ss.error ? h('div', { class: 'pv-ci-error' }, ss.error) : null,
    ctx.canWrite ? null : calm('This view cannot write Coach/checkins.json.'),
  ];
}

// ---------------------------------------------------------------- letter

const KIND: Record<string, string> = { 'coach-letter': 'Last letter', 'mesocycle-review': 'Last letter · mesocycle review', 'phase-review': 'Last letter · phase review' };
const SHOWN = [/what happened/i, /what changes/i, /focus/i, /question/i];

function letterCard(c: CheckinScreen, ctx: CheckinContext): HTMLElement {
  const l = c.letter;
  if (!l) {
    return h('aside', { class: 'pv-card pv-letter', 'data-sec': 'letter' }, h('div', { class: 'pv-kicker' }, 'Last letter'), h('h3', { class: 'pv-card-title' }, 'No letter yet'),
      h('p', { class: 'pv-muted' }, 'The coach writes one after each Sunday check-in, into Coach/Letters: what happened, what changes and why, one focus and one question back. It shows here.'));
  }
  const shown = SHOWN.map((re) => l.sections.find((x) => re.test(x.heading))).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const rest = l.sections.filter((x) => !shown.includes(x)).map((x) => x.heading);
  return h('aside', { class: 'pv-card pv-letter', 'data-sec': 'letter' },
    h('div', { class: 'pv-kicker' }, KIND[l.kind] ?? 'Last letter'),
    h('h3', { class: 'pv-card-title' }, l.date ? fmt.dayLong(l.date) : (l.title ?? 'Letter')),
    h('div', { class: 'pv-card-sub' }, l.title && l.date ? `${l.title}, after the check-in for the week of ${fmt.day(addDays(l.date, -6))}` : l.path),
    // A paragraph per blank-line block; a numbered or bulleted line is its own paragraph.
    shown.map((x) => h('div', { class: 'pv-lt-part' }, h('div', { class: 'pv-lt-h' }, x.heading), x.text.split(/\n\n+|\n(?=\s*(?:\d+\.|[-*])\s)/).map((p) => h('p', {}, p.replace(/\n/g, ' ').trim())))),
    !shown.some((x) => /focus/i.test(x.heading)) && l.focus ? h('div', { class: 'pv-lt-part' }, h('div', { class: 'pv-lt-h' }, 'One focus'), h('p', {}, l.focus)) : null,
    h('div', { class: 'pv-lt-foot' }, icon('mail'), h('span', {}, rest.length ? `Also in the letter: ${rest.join(', ')}.` : 'The next letter follows Sunday’s check-in.'),
      ctx.onOpenNote ? h('button', { class: 'pv-btn-quiet', onclick: () => ctx.onOpenNote!(l.path), ...kb('l-open') }, 'Open') : null),
  );
}

// ---------------------------------------------------------------- page

// ---------------------------------------------------------------- banner

const range = (a: string, b: string) => (a.slice(5, 7) === b.slice(5, 7) ? `${+a.slice(8)} to ${fmt.day(b)}` : `${fmt.day(a)} to ${fmt.day(b)}`);

const ACTION_ICON = { start: 'clipboard', finish: 'clipboard', saved: 'check', opens: 'clock' } as const;

/**
 * Today's banner: the ring is this week's check-ins, one segment per morning
 * and one for Sunday's. The action (sundayAction) starts the Sunday
 * check-in on a Sunday, finishes last Sunday's while it is unsaved, else is
 * the quiet "opens Sun"; each scrolls to the Sunday card.
 */
function hero(c: CheckinScreen, o: CheckinHero, toSunday: () => void): HTMLElement {
  const wk = o.week;
  const sun = c.sunday;
  const segs: RingSeg[] = [
    ...wk.mornings.map((d): RingSeg => ({ kind: d.done ? 'lift' : 'empty', tip: tip('Morning check-in', `${fmt.wd(d.date)}${d.before ? ', before this cycle' : d.future ? ', to come' : d.done ? ', saved' : ', not saved'}`) })),
    { kind: wk.sunday.done ? 'short' : 'empty', tip: tip('Sunday check-in', wk.sunday.done ? `Saved for ${fmt.wd(wk.to)}` : wk.sunday.future ? `Opens ${fmt.wd(wk.to)}` : `${fmt.wd(wk.to)}, not saved yet`) },
  ];
  const until = daysBetween(c.date, wk.to);
  const sundayValue = wk.sunday.done ? 'saved' : until <= 0 ? 'today' : `in ${until} day${until === 1 ? '' : 's'}`;
  const letter = c.letter?.date ? c.letter : null;
  const act = sun ? sundayAction(sun.status) : null;
  const action = act ? h('button', { class: act.primary ? 'pv-btn-go' : 'pv-btn-ghost', onclick: toSunday, 'data-k': 'hero-sunday' }, icon(ACTION_ICON[act.kind]), act.label) : null;
  return banner({
    phase: o.phase,
    kicker: bannerKicker(o.planWeek, o.phaseOf, o.phaseNo),
    title: 'Check-in',
    sub: `The week of ${range(wk.from, wk.to)} · the morning one feeds today’s readiness; the Sunday one, the week’s letter`,
    chips: [
      { sw: 'lift', label: 'Mornings', value: `${wk.morningsDone} of ${wk.morningsSoFar} so far`, tip: tip('Morning check-ins', `${wk.morningsDone} saved this week, Monday to today`) },
      { sw: 'short', label: 'Sunday check-in', value: sundayValue, tip: tip('Sunday check-in', wk.sunday.done ? `Saved for ${fmt.dayLong(wk.to)}` : `${until <= 0 ? 'Open today' : `Opens ${fmt.dayLong(wk.to)}`}, built from your log`) },
      letter ? { icon: 'mail', label: 'Last letter', value: fmt.wd(letter.date!), tip: tip('Last letter', letter.title ? clean(letter.title) : null, `After the check-in for the week of ${fmt.day(addDays(letter.date!, -6))}`) } : null,
      o.tape ? { icon: 'tape', label: 'Tape', value: o.tape.due && o.tape.date < c.date ? 'due' : o.tape.date === c.date ? 'today' : fmt.wd(o.tape.date), tip: tip('Tape', o.tape.due && o.tape.date < c.date ? `Due since ${fmt.wd(o.tape.date)}` : null, `${o.tape.text}, ${o.tape.source === 'plan' ? 'from your plan' : 'your own schedule'}`) } : null,
    ],
    action,
    ring: { segs, n: `${wk.done}/${wk.total}`, label: 'CHECK-INS', aria: `${wk.done} of ${wk.total} check-ins this week` },
    key: [{ kind: 'lift', label: 'Morning' }, { kind: 'short', label: 'Sunday' }],
  });
}

/** Builds the Check-in screen into `root` (its children are replaced). */
export function renderCheckin(root: HTMLElement, c: CheckinScreen, st: CheckinState, ctx: CheckinContext): void {
  const toSunday = () => root.querySelector<HTMLElement>('[data-card="sunday"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  root.replaceChildren(...h('div', {},
    hero(c, ctx.hero, toSunday),
    c.notes.filter((x) => x.code !== 'no-letter').length ? h('div', { class: 'pv-notes' }, c.notes.filter((x) => x.code !== 'no-letter').map((x) => h('div', { class: 'pv-note' }, icon('info'), h('span', {}, x.text)))) : null,
    h('div', { class: 'pv-prog-grid' },
      h('div', { class: 'pv-span-8 pv-stack' }, morningCard(c, st, ctx), ctx.bodyRecord ? bodyRecordCard(ctx.bodyRecord) : null, c.sunday && st.sunday ? sundayCard(c, c.sunday, st, ctx) : null),
      h('div', { class: 'pv-span-4 pv-stack pv-letter-col' }, letterCard(c, ctx)),
    ),
  ).childNodes);
}
