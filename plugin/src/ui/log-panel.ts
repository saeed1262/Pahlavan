// The Log session panel: a side panel over Today, as signed off in
// mockups/log.html. It edits a LogForm (src/report/log-form.ts) in place;
// the view owns the form, the writer and the saving. The summary is the dry
// run: the exact entry buildLogEntry makes, which Save writes.

import { buildLogEntry, habitKey } from '../../../src/adapters/vault/log-write.ts';
import { MUSCLES } from '../../../src/core/data/muscles.ts';
import type { SessionMode } from '../../../src/core/variant.ts';
import { inputFromForm, topOf, type FormRow, type LogForm } from '../../../src/report/log-form.ts';
import type { GuideEntry } from '../../../src/report/dashboard.ts';
import { BODY, type Side } from './body-map.ts';
import { guideName, guidePanel } from './guide.ts';
import { h, icon, s, type Child } from './dom.ts';
import { fmt } from './format.ts';

type Obj = Record<string, unknown>;

export interface LogPanelState {
  summary: boolean;
  /** The row whose swap menu is open, or 'session' for the session menu. */
  menu: string | null;
  busy: boolean;
  error: string | null;
  already: Obj | null;
  /** A conflict: the session as the file has it now (null: deleted elsewhere). */
  conflict: { disk: Obj | null } | null;
  habitTicked: boolean | null;
  confirmDelete: boolean;
  /** The row whose movement guide is open. */
  guide?: string | null;
}

export interface LogPanelCtx {
  form: LogForm;
  state: LogPanelState;
  plan: unknown;
  log: unknown;
  today: string;
  onChange(): void;
  onClose(): void;
  /** A new log only: another session or version (rebuilt from the engine). */
  onRebuild(type: string, mode: SessionMode): void;
  /** Another date: a new log is rebuilt from that date's plan (an edit just moves). */
  onDate(date: string): void;
  onSave(force?: boolean): void;
  onDelete(): void;
  onEditExisting(entry: Obj): void;
  onUseDisk(entry: Obj): void;
  /** The movement guide for a name (plan-data's guide). */
  guide?(name: string): GuideEntry[];
}

export const freshPanelState = (): LogPanelState => ({ summary: false, menu: null, busy: false, error: null, already: null, conflict: null, habitTicked: null, confirmDelete: false });

const PAIN_AREAS = ['Lower back', 'Knee', 'Shoulder', 'Elbow', 'Wrist', 'Hip', 'Neck', 'Abdominal wall'];
const CARDIO_MODES = ['bike', 'walk', 'row', 'run', 'intervals'];
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const SKIP_WHY = ['Time', 'Pain', 'Equipment', 'Energy'];
const RPE_WORD = ['', 'Very easy', 'Easy', 'Easy', 'Moderate', 'Moderate', 'Somewhat hard', 'Hard', 'Hard', 'Very hard', 'Max'];
// A slug's label: the first muscle the engine maps to it (glutes, not the abductors that share it).
const SLUG_LABEL: Record<string, string> = {};
for (const m of MUSCLES) if (m.highlighter && !SLUG_LABEL[m.highlighter]) SLUG_LABEL[m.highlighter] = m.label;
const range = (r: [number, number] | null) => (r ? (r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`) : 'reps');

/** The entry Save would write, or why it cannot be saved yet. */
export function previewEntry(ctx: Pick<LogPanelCtx, 'form' | 'plan' | 'log' | 'today'>) {
  return buildLogEntry(inputFromForm(ctx.form), { plan: ctx.plan, log: ctx.log, today: ctx.today, original: ctx.form.original?.entry ?? null });
}

function seg(opts: [string, Child][], on: string, click: (v: string) => void, attrs: Record<string, string> = {}): HTMLElement {
  return h('div', { class: 'pv-seg pv-lg-seg', role: 'group', ...attrs }, opts.map(([v, l]) => h('button', { class: v === on ? 'is-on' : '', 'aria-pressed': v === on ? 'true' : 'false', onclick: () => click(v) }, l)));
}

function stepper(value: number | null, unit: string, label: string, ph: string, set: (v: number | null) => void, step: number, changedFrom?: number | null): Child[] {
  const input = h('input', { class: 'pv-lg-stp-in', inputmode: 'decimal', value: value ?? '', placeholder: ph, 'aria-label': label }) as HTMLInputElement;
  input.addEventListener('change', () => set(input.value.trim() === '' ? null : Number(input.value)));
  const bump = (d: number) => set(Math.max(0, Math.round(((value ?? 0) + d * step) * 10) / 10));
  return [
    h('span', { class: `pv-lg-stp${changedFrom != null ? ' is-changed' : ''}` },
      h('button', { class: 'pv-lg-stp-b', 'aria-label': `Less ${label.toLowerCase()}`, onclick: () => bump(-1) }, icon('minus')),
      input,
      h('button', { class: 'pv-lg-stp-b', 'aria-label': `More ${label.toLowerCase()}`, onclick: () => bump(1) }, icon('plus')),
      unit ? h('em', {}, unit) : null),
    changedFrom != null ? h('span', { class: 'pv-lg-was' }, `was ${changedFrom}`) : null,
  ];
}

function row(r: FormRow, n: number, ctx: LogPanelCtx): HTMLElement {
  const f = ctx.form;
  const st = ctx.state;
  const change = () => ctx.onChange();
  const orig = f.original?.entry;
  const origLift = orig && r.lift !== null ? (orig[r.lift === 0 ? 'lift1' : 'lift2'] as Obj | null) : null;
  const was = (k: 'weight' | 'reps') => (origLift && origLift[k] !== r.top[k] ? (origLift[k] as number) : null);
  const head = h('div', { class: 'pv-lg-item-head' },
    h('span', { class: 'pv-lg-n' }, String(n + 1)),
    h('div', { class: 'pv-lg-name' },
      h('div', { class: 'pv-lg-name-line' }, (() => {
        const entries = ctx.guide ? (ctx.guide(r.name).length ? ctx.guide(r.name) : ctx.guide(r.planned ?? r.line ?? r.name)) : [];
        return guideName(r.name, entries.length > 0, st.guide === r.key, () => { st.guide = st.guide === r.key ? null : r.key; change(); }, 'pv-lg-gd');
      })(), r.lift !== null ? h('span', { class: 'pv-lg-tag' }, 'Logged lift') : null, r.kind === 'cardio' ? h('span', { class: 'pv-lg-tag' }, 'Finisher') : null,
      // A paired checklist line is a superset: its two exercises back to back, a set of each.
      r.parts.length > 1 ? h('span', { class: 'pv-lg-tag', 'data-tip': 'Superset|A set of each, back to back, then rest' }, 'Superset') : null),
      r.planned ? h('div', { class: 'pv-lg-repl' }, icon('swap'), `in place of ${r.planned}`, h('span', { class: 'pv-lg-why-tag' }, r.swapWhy ?? 'Swap'), r.swapWhy === 'Your swap' ? h('button', { class: 'pv-lg-link', onclick: () => { r.name = r.planned!; r.planned = null; r.swapWhy = null; change(); } }, 'Undo') : null) : null,
      h('div', { class: 'pv-lg-dose' }, r.sr, r.target && r.target.weight !== null ? [' · target ', h('b', {}, `${fmt.w(r.target.weight, r.unit)} × ${r.target.reps}`), ` @ RIR ${r.target.rir}`] : r.rir !== null && (r.kind === 'load' || r.kind === 'reps') && !/RIR/.test(r.sr) ? ` @ RIR ${r.rir}` : null),
    ),
    r.kind === 'warmup' && !r.line ? null : seg([['1', [icon('check'), 'Done']], ['0', 'Skipped']], r.done ? '1' : '0', (v) => { r.done = v === '1'; if (r.done) r.why = null; change(); }, { 'aria-label': `${r.name}: done or skipped` }),
  );
  if (!r.done) {
    return h('li', { class: 'pv-lg-item is-skipped' }, head,
      h('div', { class: 'pv-lg-skip' }, h('span', {}, 'Why? ', h('i', {}, '(optional)')),
        h('div', { class: 'pv-lg-pills' }, SKIP_WHY.map((w) => h('button', { class: `pv-lg-pill${r.why === w.toLowerCase() ? ' is-on' : ''}`, onclick: () => { r.why = r.why === w.toLowerCase() ? null : w.toLowerCase(); if (w === 'Pain') { f.painOn = true; f.pain.during = r.name; } change(); } }, w)))));
  }
  let body: Child = null;
  if (f.tracking === 'standard' && r.lift !== null) {
    const same = r.target && r.target.weight !== null && r.top.weight === r.target.weight && r.top.reps === r.target.reps;
    body = [
      h('div', { class: 'pv-lg-top' },
        h('span', { class: 'pv-lg-lbl' }, 'Top set'),
        stepper(r.top.weight, r.unit, 'Top-set weight', 'weight', (v) => { r.top.weight = v; change(); }, r.step, was('weight')),
        h('span', { class: 'pv-lg-x' }, '×'),
        stepper(r.top.reps, 'reps', 'Reps', range(r.repRange), (v) => { r.top.reps = v === null ? null : Math.round(v); change(); }, 1, was('reps')),
        r.target && r.target.weight !== null ? h('button', { class: `pv-lg-same${same ? ' is-on' : ''}`, onclick: () => { r.top = { weight: r.target!.weight, reps: r.target!.reps }; change(); } }, same ? [icon('check'), 'Same as target'] : 'Same as target') : null,
      ),
      r.top.weight === null && r.targetNote ? h('div', { class: 'pv-lg-hint' }, icon('info'), r.targetNote.charAt(0).toUpperCase() + r.targetNote.slice(1)) : null,
    ];
  } else if (f.tracking === 'full' && r.parts.length <= 1 && (r.kind === 'load' || r.kind === 'reps' || r.kind === 'timed')) {
    if (!r.rows.length) r.rows = Array.from({ length: Math.max(1, r.sets) }, () => ({ weight: r.top.weight, reps: r.top.reps, rir: null }));
    const timed = r.kind === 'timed';
    const noLoad = r.kind !== 'load';
    const top = r.lift !== null ? topOf(r, 'full') : null;
    body = h('div', { class: 'pv-lg-sets' },
      h('div', { class: 'pv-lg-sets-head' }, h('span', {}, 'Set'), h('span', {}, noLoad ? '' : `Weight (${r.unit})`), h('span', {}, timed ? 'Seconds' : 'Reps'), h('span', {}, 'RIR ', h('i', {}, '(optional)'))),
      r.rows.map((x, j) => h('div', { class: 'pv-lg-set' },
        h('span', { class: 'pv-lg-set-n' }, String(j + 1)),
        h('span', {}, noLoad ? h('span', { class: 'pv-lg-bw' }, 'Bodyweight') : stepper(x.weight, '', `Set ${j + 1} weight`, '–', (v) => { x.weight = v; change(); }, r.step)),
        h('span', {}, stepper(x.reps, '', `Set ${j + 1} ${timed ? 'seconds' : 'reps'}`, '–', (v) => { x.reps = v === null ? null : Math.round(v); change(); }, timed ? 5 : 1)),
        h('span', { class: 'pv-lg-rir' }, [0, 1, 2, 3, 4].map((v) => h('button', { class: `pv-lg-rir-b${x.rir === v ? ' is-on' : ''}`, 'aria-label': `RIR ${v === 4 ? '4 or more' : v}`, onclick: () => { x.rir = x.rir === v ? null : v; change(); } }, v === 4 ? '4+' : String(v)))),
      )),
      h('div', { class: 'pv-lg-sets-foot' },
        h('button', { class: 'pv-lg-link', onclick: () => { const l = r.rows.at(-1); r.rows.push({ weight: l?.weight ?? null, reps: l?.reps ?? null, rir: null }); change(); } }, icon('plus'), 'Add a set'),
        r.rows.length > 1 ? h('button', { class: 'pv-lg-link', onclick: () => { r.rows.pop(); change(); } }, icon('minus'), 'Remove the last') : null,
        r.target && r.target.weight !== null ? h('button', { class: 'pv-lg-link', onclick: () => { r.rows = r.rows.map((x) => ({ ...x, weight: r.target!.weight, reps: r.target!.reps })); change(); } }, 'Every set as the target') : null,
        top && top.reps ? h('span', { class: 'pv-faint' }, `Top set ${top.weight != null ? fmt.w(top.weight, r.unit) : 'bodyweight'} × ${top.reps}: the logged lift`) : null,
      ),
    );
  }
  const menuOpen = st.menu === r.key;
  const foot = r.kind === 'warmup' || r.kind === 'cardio' || r.parts.length > 1 ? null : h('div', { class: 'pv-lg-item-foot' },
    h('span', { class: 'pv-lg-swap-wrap' },
      h('button', { class: 'pv-lg-link', 'aria-haspopup': 'menu', 'aria-expanded': menuOpen ? 'true' : 'false', onclick: (ev: Event) => { ev.stopPropagation(); st.menu = menuOpen ? null : r.key; change(); } }, icon('swap'), r.swapWhy === 'Your swap' ? 'Change the swap' : 'Swap'),
      menuOpen ? h('div', { class: 'pv-lg-menu', role: 'menu', 'aria-label': `Swap ${r.planned ?? r.name}` },
        h('div', { class: 'pv-lg-menu-head' }, `Swap ${r.planned ?? r.name} for`),
        (r.swaps.length ? r.swaps : []).map((o) => h('button', { class: 'pv-lg-menu-item', role: 'menuitem', onclick: () => { if (!r.planned) r.planned = r.parts[0] ?? r.name; r.name = o; r.swapWhy = 'Your swap'; if (r.lift !== null) { r.target = null; r.top = { weight: null, reps: null }; r.targetNote = 'New to the log: enter what you used.'; } st.menu = null; change(); } }, h('span', {}, o))),
        r.swaps.length ? null : h('div', { class: 'pv-lg-menu-empty' }, 'No catalogue alternatives that the Ledger allows.'),
      ) : null,
    ),
    r.last ? h('span', { class: 'pv-faint' }, `Last ${fmt.w(r.last.weight, r.last.unit)} × ${r.last.reps} · ${fmt.wd(r.last.date)}`) : null,
  );
  const gEntries = st.guide === r.key && ctx.guide ? (ctx.guide(r.name).length ? ctx.guide(r.name) : ctx.guide(r.planned ?? r.line ?? r.name)) : [];
  return h('li', { class: `pv-lg-item${r.planned ? ' is-swapped' : ''}` }, head, gEntries.length ? guidePanel(gEntries) : null, body, foot);
}

function figure(side: Side, f: LogForm, change: () => void): HTMLElement {
  const parts: SVGElement[] = [s('path', { class: 'pv-bm-base', d: BODY.outline[side] })];
  for (const [slug, ds] of Object.entries(BODY[side])) {
    const label = SLUG_LABEL[slug];
    const v = f.sore[slug];
    for (const d of ds) {
      const p = s('path', { class: label ? `pv-lg-tap${v ? ` is-${v}` : ''}` : 'pv-bm-base', d, ...(label ? { 'data-tip': `${label}|Tap: none, mild, sore`, role: 'button', 'aria-label': `${label}: ${v ?? 'not sore'}` } : {}) });
      if (label) p.addEventListener('click', () => { const next = { undefined: 'mild', mild: 'sore', sore: undefined } as Record<string, 'mild' | 'sore' | undefined>; const n = next[String(f.sore[slug])]; if (n) f.sore[slug] = n; else delete f.sore[slug]; change(); });
      parts.push(p);
    }
  }
  parts.push(s('path', { class: 'pv-bm-outline', d: BODY.outline[side] }));
  return h('div', { class: 'pv-figure' }, s('svg', { viewBox: BODY.viewBox[side], role: 'img', 'aria-label': `${side} of the body: tap a sore muscle` }, parts), h('div', { class: 'pv-figure-cap' }, side === 'front' ? 'Front' : 'Back'));
}

function summary(ctx: LogPanelCtx): HTMLElement {
  const f = ctx.form;
  const st = ctx.state;
  const r = previewEntry(ctx);
  const items: [string, Child][] = [];
  if (!r.ok) items.push(['Not yet', h('span', { class: 'pv-lg-warn' }, r.error)]);
  else {
    const e = r.entry;
    const lifts = [e['lift1'], e['lift2']].filter(Boolean) as Obj[];
    items.push(['Session', [h('b', {}, f.typeName), `, ${fmt.wd(f.date)} · ${f.type === 'custom' ? 'outside the plan' : e['express'] ? 'Express' : e['hotel'] ? 'Hotel' : f.mode === 'express' ? 'Express (saved as the short session itself: the log marks Express on lifting days only)' : 'full session'}`]]);
    if (lifts.length) items.push(['Top sets', lifts.map((l, i) => [i ? h('br') : null, `${String(l['name'])} `, !l['weight'] && !l['reps'] ? h('span', { class: 'pv-lg-warn' }, 'not entered (saved as not logged, 0 × 0)') : h('b', {}, `${l['weight'] ? fmt.w(l['weight'] as number, String(l['unit'])) : 'bodyweight'} × ${String(l['reps'])}`), l['planned'] ? h('span', { class: 'pv-faint' }, ` (for ${String(l['planned'])})`) : null])]);
    const ck = e['checklist'] as { done: number; total: number; skipped: string[]; why?: Record<string, string> } | undefined;
    if (ck) items.push(['Done', `${ck.done} of ${ck.total}${ck.skipped.length ? `; skipped ${ck.skipped.map((n) => `${n}${ck.why?.[n] ? ` (${ck.why[n]})` : ''}`).join(', ')}` : ''}`]);
    const sw = f.rows.filter((x) => x.planned);
    if (sw.length) items.push(['Swaps', sw.map((x, i) => [i ? h('br') : null, `${x.planned} → ${x.name}`])]);
    if (e['trackingLevel'] === 'full') {
      const xs = (e['exerciseSets'] as { sets: { rir?: number }[] }[]) ?? [];
      items.push(['Every set', `${xs.reduce((a, x) => a + x.sets.length, 0)} sets across ${xs.length} exercises, RIR on ${xs.reduce((a, x) => a + x.sets.filter((y) => y.rir !== undefined).length, 0)}`]);
    }
    const rpe = e['sessionRpe'] as number | undefined;
    const mins = e['durationMin'] as number | null;
    items.push(['Effort', rpe ? [`session RPE `, h('b', {}, String(rpe)), ` · ${mins ?? '–'} min${mins ? ` · load ${rpe * mins}` : ''}`] : [h('span', { class: 'pv-lg-warn' }, 'no session RPE'), ` · ${mins ?? '–'} min`]]);
    items.push(['Cardio', e['cardioMin'] ? `${String(e['cardioMin'])} min${e['cardioMode'] ? `, ${String(e['cardioMode'])}` : ''}` : 'none']);
    const pain = e['pain'] as { area: string; severity: number; exercise?: string }[] | undefined;
    if (pain) items.push(['Pain', `${pain[0]!.area} ${pain[0]!.severity}/10${pain[0]!.exercise ? `, during ${pain[0]!.exercise}` : ''}`]);
    if (!f.edit) {
      const sore = Object.entries(f.sore);
      items.push(['Sore', sore.length ? [sore.map(([k, v]) => `${SLUG_LABEL[k] ?? k} (${v})`).join(', '), h('span', { class: 'pv-faint' }, ` to the body record for ${fmt.wd(f.date)}`)] : 'none']);
    }
  }
  const changes: string[] = [];
  if (f.edit && r.ok && f.original) {
    const o = f.original.entry;
    for (const k of ['lift1', 'lift2'] as const) {
      const a = o[k] as Obj | null;
      const b = r.entry[k] as Obj | null;
      if (a && b) for (const x of ['name', 'weight', 'reps', 'unit']) if (a[x] !== b[x]) changes.push(`${String(b['name'])} ${x} ${String(a[x])} → ${String(b[x])}`);
    }
    for (const k of ['durationMin', 'cardioMin', 'cardioMode', 'rating', 'notes', 'sessionRpe'] as const) if ((o[k] ?? null) !== (r.entry[k] ?? null)) changes.push(`${k} ${String(o[k] ?? '–')} → ${String(r.entry[k] ?? '–')}`);
  }
  return h('div', { class: 'pv-lg-sum', role: 'region', 'aria-label': 'What will be saved' },
    h('div', { class: 'pv-lg-sum-head' },
      h('div', {}, h('div', { class: 'pv-kicker' }, 'What will be saved'), h('div', { class: 'pv-lg-sum-sub' }, f.edit ? 'Replaces this session in ' : 'One new session in ', h('code', {}, 'fitness-log-data.json'))),
      h('button', { class: 'pv-btn-quiet', onclick: () => { st.summary = false; ctx.onChange(); } }, icon('chevron'), 'Hide'),
    ),
    changes.length ? h('div', { class: 'pv-lg-changes' }, icon('history'), h('span', {}, h('b', {}, 'Changed: '), changes.join('; '))) : null,
    h('dl', { class: 'pv-lg-sum-list' }, items.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    h('div', { class: 'pv-lg-sum-also' },
      f.edit ? null : h('span', {}, icon('check'), `Workout habit, ${fmt.wd(f.date)}: ${st.habitTicked === true ? 'already ticked' : st.habitTicked === false ? 'ticked on save' : 'the habits file was not found; not ticked'} `, h('code', {}, habitKey(f.date))),
      h('span', {}, icon('shield'), `Checked against the file again on Save: sessions written elsewhere since you opened this are kept${f.edit ? '; if this one changed elsewhere, you choose' : ''}.`),
    ),
    r.ok ? h('details', { class: 'pv-lg-json' }, h('summary', {}, 'The exact entry (JSON)'), h('pre', {}, JSON.stringify(r.entry, null, 2))) : null,
  );
}

function sessionField(ctx: LogPanelCtx): HTMLElement {
  const f = ctx.form;
  const st = ctx.state;
  const open = st.menu === 'session';
  return h('label', { class: 'pv-lg-field pv-lg-field-grow' }, h('span', {}, 'Session'),
    h('span', { class: 'pv-lg-swap-wrap' },
      h('button', { class: 'pv-lg-pick', 'aria-haspopup': 'menu', disabled: f.edit, onclick: (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); st.menu = open ? null : 'session'; ctx.onChange(); } }, f.type === 'custom' ? 'Something else' : f.typeName, !f.edit && f.type === f.suggested ? h('span', { class: 'pv-lg-tag' }, 'Suggested') : null, f.edit ? null : icon('chevron')),
      open ? h('div', { class: 'pv-lg-menu', role: 'menu' },
        f.choices.map((c) => h('button', { class: `pv-lg-menu-item${c.type === f.type ? ' is-hot' : ''}`, role: 'menuitem', onclick: () => { st.menu = null; ctx.onRebuild(c.type, f.mode); } }, h('span', {}, c.name.replace(/\s*—\s*/g, ' · ')), h('span', { class: 'pv-faint' }, `${c.kind === 'lift' ? 'Lifting' : 'Short'}${c.suggested ? ' · suggested' : ''}`))),
        // A session outside the plan, as the dashboard's dialog logs it: type "custom" with a label.
        h('button', { class: `pv-lg-menu-item${f.type === 'custom' ? ' is-hot' : ''}`, role: 'menuitem', onclick: () => { st.menu = null; ctx.onRebuild('custom', 'full'); } }, h('span', {}, 'Something else'), h('span', { class: 'pv-faint' }, 'Outside the plan: a label, minutes, cardio')),
      ) : null,
    ));
}

/** The custom session's label (required, as fitness_log.py add asks); typing does not redraw, so the focus stays. */
function labelField(ctx: LogPanelCtx): HTMLElement {
  const f = ctx.form;
  const input = h('input', { class: 'pv-lg-label', type: 'text', value: f.label ?? '', placeholder: 'Easy hike, yoga, a match…', 'aria-label': 'What it was', disabled: f.edit }) as HTMLInputElement;
  input.addEventListener('input', () => {
    f.label = input.value;
    f.typeName = input.value.trim() || 'Something else';
    const title = input.closest('.pv-lg')?.querySelector('.pv-lg-title');
    if (title) title.textContent = f.typeName;
  });
  input.addEventListener('change', () => ctx.onChange());
  return h('label', { class: 'pv-lg-field pv-lg-field-grow' }, h('span', {}, 'What it was'), input);
}

/** Builds the panel into `layer` (its children are replaced; the body keeps its scroll). */
export function renderLogPanel(layer: HTMLElement, ctx: LogPanelCtx): void {
  const f = ctx.form;
  const st = ctx.state;
  const change = () => ctx.onChange();
  const keepScroll = layer.querySelector('.pv-lg-body')?.scrollTop ?? 0;
  const picked = !f.edit && f.suggested !== null && f.type !== f.suggested;
  const swaps = f.rows.filter((r) => r.planned).length;
  const footLine = [f.rows.some((r) => r.line) ? `${f.rows.filter((r) => r.done && r.line).length} of ${f.rows.filter((r) => r.line).length} done` : null, swaps ? `${swaps} swap${swaps === 1 ? '' : 's'}` : null, f.rpe ? `RPE ${f.rpe}` : 'RPE not set', f.minutes ? `${f.minutes} min` : null].filter(Boolean).join(' · ');
  const strengthRows = f.rows.filter((r) => r.kind === 'load' || r.kind === 'reps' || r.kind === 'timed');

  const head = h('header', { class: 'pv-lg-head' },
    h('div', {},
      h('div', { class: 'pv-kicker' }, f.edit ? 'Edit session' : 'Log session'),
      h('h2', { class: 'pv-lg-title', id: 'pv-lg-title' }, f.typeName),
      h('div', { class: 'pv-lg-sub' }, f.edit ? `Logged ${fmt.wd(f.date)} · change what you need, then save` : f.type === 'custom' ? 'Outside the plan · what it was, how long and how hard' : `${f.date === ctx.today ? 'From today’s session' : `From the session for ${fmt.wd(f.date)}`}${picked ? ', your pick' : ''} · targets filled in, change what differed`),
    ),
    h('button', { class: 'pv-lg-close', 'aria-label': 'Close', onclick: () => ctx.onClose() }, icon('x')),
  );
  const dateInput = h('input', { class: 'pv-lg-date', type: 'date', value: f.date, max: ctx.today, 'aria-label': 'Date' }) as HTMLInputElement;
  dateInput.addEventListener('change', () => { if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput.value) && dateInput.value !== f.date) ctx.onDate(dateInput.value); });
  const what = h('section', { class: 'pv-lg-sec pv-lg-what' },
    h('label', { class: 'pv-lg-field' }, h('span', {}, 'Date'), h('span', { class: 'pv-lg-pick is-date' }, icon('calendar'), fmt.wd(f.date), f.date === ctx.today ? h('em', {}, 'today') : null, dateInput)),
    sessionField(ctx),
    f.type === 'custom' ? labelField(ctx) : h('div', { class: 'pv-lg-field' }, h('span', {}, 'Version'), seg([['full', 'Full'], ['express', 'Express'], ['hotel', 'Hotel']], f.mode, (v) => { if (f.edit) { f.mode = v as SessionMode; change(); } else ctx.onRebuild(f.type, v as SessionMode); })),
  );
  const exercises = f.type === 'custom' ? null : h('section', { class: 'pv-lg-sec' },
    h('div', { class: 'pv-lg-sec-head' }, h('h3', {}, 'Exercises'), h('div', { class: 'pv-lg-track' }, h('span', {}, 'Tracking'), seg([['standard', 'Standard'], ['full', 'Every set']], f.tracking, (v) => { f.tracking = v as 'standard' | 'full'; change(); }))),
    h('p', { class: 'pv-lg-note' }, f.tracking === 'standard' ? (f.lifting ? 'Standard: the top set of the two logged lifts; tick the rest done or skipped.' : 'A short day logs no weights: tick each item done or skipped.') : 'Every set: weight, reps and, if you like, reps in reserve. The heaviest set of each logged lift is its top set.'),
    f.fromTicks && !f.edit ? h('div', { class: 'pv-lg-hint is-ticks' }, icon('check'), `From your ticks on Today: ${f.fromTicks.done} done, ${f.fromTicks.skipped} skipped. Change any row that differs.`) : null,
    f.rows.length ? h('ol', { class: 'pv-lg-list' }, f.rows.map((r, n) => row(r, n, ctx))) : h('p', { class: 'pv-calm' }, icon('info'), 'A session outside the plan: no exercises to tick.'),
    f.tracking === 'full' && !strengthRows.length ? h('p', { class: 'pv-lg-note' }, 'Nothing here takes sets.') : null,
  );
  const rpeTaps = h('div', { class: 'pv-lg-rpe-taps', role: 'radiogroup', 'aria-label': 'Session RPE' },
    Array.from({ length: 10 }, (_, i) => i + 1).map((v) => h('button', { class: `pv-lg-tap-n${f.rpe === v ? ' is-on' : ''}${f.plannedRpe && Math.round(f.plannedRpe) === v && f.rpe !== v ? ' is-planned' : ''}`, role: 'radio', 'aria-checked': f.rpe === v ? 'true' : 'false', onclick: () => { f.rpe = v; change(); } }, String(v))));
  const effort = h('section', { class: 'pv-lg-sec' },
    h('div', { class: 'pv-lg-sec-head' }, h('h3', {}, 'Effort and time')),
    h('div', { class: 'pv-lg-rpe' },
      h('div', { class: 'pv-lg-rpe-q' }, h('b', {}, 'How hard was the whole session?'), ' ', h('span', { class: 'pv-faint' }, `Session RPE, 1 to 10${f.plannedRpe ? ` · planned ${fmt.num(f.plannedRpe)}` : ''}`)),
      rpeTaps,
      h('div', { class: 'pv-lg-rpe-scale' }, h('span', {}, 'Very easy'), h('span', {}, 'Moderate'), h('span', {}, 'Hard'), h('span', {}, 'Max')),
      h('div', { class: 'pv-lg-rpe-read' }, f.rpe ? [h('b', {}, `${f.rpe} · ${RPE_WORD[f.rpe]}`), f.minutes ? h('span', { class: 'pv-faint' }, ` training load ${f.rpe} × ${f.minutes} min = ${f.rpe * f.minutes}`) : null] : h('span', { class: 'pv-faint' }, 'Needed for the training load (RPE × minutes); one tap.')),
    ),
    h('div', { class: 'pv-lg-time' },
      h('label', { class: 'pv-lg-field' }, h('span', {}, 'Session length'), stepper(f.minutes, 'min', 'Session length', '60', (v) => { f.minutes = v; change(); }, 5)),
      h('label', { class: 'pv-lg-field' }, h('span', {}, 'Cardio'), stepper(f.cardio, 'min', 'Cardio minutes', '0', (v) => { f.cardio = v ?? 0; change(); }, 1)),
    ),
    h('div', { class: 'pv-lg-field' }, h('span', {}, 'Cardio mode'), h('div', { class: 'pv-lg-pills' },
      // The log's own words stay as they are ("Stairs"); a pill writes lower case, as the dashboard's default does.
      f.cardioMode && !CARDIO_MODES.includes(f.cardioMode.toLowerCase()) ? h('button', { class: 'pv-lg-pill is-on', onclick: () => { f.cardioMode = null; change(); } }, f.cardioMode) : null,
      CARDIO_MODES.map((m) => h('button', { class: `pv-lg-pill${f.cardioMode?.toLowerCase() === m ? ' is-on' : ''}`, onclick: () => { f.cardioMode = f.cardioMode?.toLowerCase() === m ? null : m; change(); } }, cap(m))))),
  );
  const sev = h('input', { type: 'range', min: 0, max: 10, value: f.pain.severity, 'aria-label': 'Pain, 0 to 10' }) as HTMLInputElement;
  const sevOut = h('b', {}, `${f.pain.severity}/10`);
  sev.addEventListener('input', () => { f.pain.severity = Number(sev.value); sevOut.textContent = `${f.pain.severity}/10`; });
  const soreList = Object.entries(f.sore);
  const notes = h('textarea', { class: 'pv-lg-ta', placeholder: 'Anything worth remembering: how a lift felt, the gym, sleep.' }) as HTMLTextAreaElement;
  notes.value = f.notes;
  notes.addEventListener('input', () => { f.notes = notes.value; });
  const posture = h('input', { type: 'checkbox' }) as HTMLInputElement;
  posture.checked = f.posture;
  posture.addEventListener('change', () => { f.posture = posture.checked; });
  const went = h('section', { class: 'pv-lg-sec' },
    h('div', { class: 'pv-lg-sec-head' }, h('h3', {}, 'How it went ', h('i', {}, 'optional'))),
    h('div', { class: 'pv-lg-field' }, h('span', {}, 'Any pain or niggle?'), seg([['0', 'No'], ['1', 'Yes']], f.painOn ? '1' : '0', (v) => { f.painOn = v === '1'; change(); })),
    f.painOn ? h('div', { class: 'pv-lg-pain' },
      h('div', { class: 'pv-lg-field' }, h('span', {}, 'Where'), h('div', { class: 'pv-lg-pills' }, PAIN_AREAS.map((a) => h('button', { class: `pv-lg-pill${f.pain.area === a ? ' is-on' : ''}`, onclick: () => { f.pain.area = a; change(); } }, a)))),
      h('div', { class: 'pv-lg-sev' }, h('span', {}, 'How bad'), sev, sevOut),
      h('div', { class: 'pv-lg-field' }, h('span', {}, 'During'), h('div', { class: 'pv-lg-pills' }, strengthRows.map((r) => h('button', { class: `pv-lg-pill${f.pain.during === r.name ? ' is-on' : ''}`, onclick: () => { f.pain.during = f.pain.during === r.name ? null : r.name; change(); } }, r.name)))),
      h('div', { class: 'pv-lg-hint' }, icon('shield'), 'Saved with the session. The coach asks about it and adds it to the Ledger if it comes back.'),
    ) : null,
    f.edit ? null : h('div', { class: 'pv-lg-sore' },
      h('div', { class: 'pv-figures is-small' }, figure('front', f, change), figure('back', f, change)),
      h('div', { class: 'pv-lg-sore-side' },
        h('div', { class: 'pv-lg-field' }, h('span', {}, 'Sore muscles')),
        h('div', { class: 'pv-lg-sore-legend' }, h('span', {}, h('i', { class: 'is-none' }), 'None'), h('span', {}, h('i', { class: 'is-mild' }), 'Mild'), h('span', {}, h('i', { class: 'is-sore' }), 'Sore')),
        soreList.length ? h('ul', { class: 'pv-lg-sore-list' }, soreList.map(([k, v]) => h('li', {}, h('span', {}, SLUG_LABEL[k] ?? k), h('span', { class: `pv-lg-tag ${v === 'sore' ? 'is-bad' : 'is-warn'}` }, v === 'sore' ? 'Sore' : 'Mild')))) : h('p', { class: 'pv-faint' }, 'None marked.'),
        h('p', { class: 'pv-lg-note' }, `${Object.keys(f.soreFrom).length ? 'From this morning’s check-in. ' : ''}Saved to the body record for ${fmt.wd(f.date)}, where the morning check-in keeps it; only the muscles you change.`),
      ),
    ),
    h('div', { class: 'pv-lg-field' }, h('span', {}, 'Session rating ', h('i', {}, '1 to 10, how it went')), h('div', { class: 'pv-lg-rate' }, Array.from({ length: 10 }, (_, i) => i + 1).map((v) => h('button', { class: `pv-lg-rate-b${f.rating === v ? ' is-on' : ''}`, onclick: () => { f.rating = f.rating === v ? null : v; change(); } }, String(v))))),
    h('label', { class: 'pv-lg-check' }, posture, h('span', {}, 'Desk posture routine done today')),
    h('label', { class: 'pv-lg-field' }, h('span', {}, 'Notes'), notes),
  );

  const banner: Child = st.already
    ? h('div', { class: 'pv-lg-banner' }, icon('info'), h('span', {}, `${f.typeName} is already logged for ${fmt.wd(f.date)}.`), h('button', { class: 'pv-btn-quiet', onclick: () => ctx.onEditExisting(st.already!) }, icon('pencil'), 'Edit that one'))
    : st.conflict
      ? h('div', { class: 'pv-lg-banner is-conflict' }, icon('alert'),
        h('div', { class: 'pv-lg-conflict' },
          h('b', {}, st.conflict.disk ? 'This session changed in another window since you opened it.' : 'This session was deleted in another window since you opened it.'),
          st.conflict.disk ? h('div', { class: 'pv-lg-conflict-cols' },
            h('div', {}, h('div', { class: 'pv-kicker' }, 'In the file now'), h('pre', {}, JSON.stringify(st.conflict.disk, null, 2))),
            h('div', {}, h('div', { class: 'pv-kicker' }, 'Yours'), h('pre', {}, (() => { const r = previewEntry(ctx); return r.ok ? JSON.stringify(r.entry, null, 2) : r.error; })())),
          ) : null,
          h('div', { class: 'pv-lg-conflict-acts' },
            h('button', { class: 'pv-btn-quiet', onclick: () => ctx.onSave(true) }, 'Keep mine'),
            st.conflict.disk ? h('button', { class: 'pv-btn-quiet', onclick: () => ctx.onUseDisk(st.conflict!.disk!) }, 'Use the file’s, and edit that') : null,
          )))
      : st.error ? h('div', { class: 'pv-lg-banner is-error' }, icon('alert'), h('span', {}, st.error)) : null;

  const foot = h('footer', { class: 'pv-lg-foot' },
    h('div', { class: 'pv-lg-foot-l' },
      f.edit ? (st.confirmDelete
        ? h('span', { class: 'pv-lg-confirm' }, 'Delete this session? ', h('button', { class: 'pv-lg-del', onclick: () => ctx.onDelete() }, 'Delete'), h('button', { class: 'pv-lg-link', onclick: () => { st.confirmDelete = false; change(); } }, 'Keep it'))
        : h('button', { class: 'pv-lg-del', onclick: () => { st.confirmDelete = true; change(); } }, icon('x'), 'Delete session')) : null,
      h('button', { class: `pv-lg-sumbtn${st.summary ? ' is-on' : ''}`, 'aria-expanded': st.summary ? 'true' : 'false', onclick: () => { st.summary = !st.summary; change(); } }, icon('chevron'), 'What will be saved'),
      h('span', { class: 'pv-lg-foot-line' }, footLine),
    ),
    h('button', { class: 'pv-lg-save', disabled: st.busy, onclick: () => ctx.onSave(false) }, icon('save'), st.busy ? 'Saving…' : f.edit ? 'Save changes' : 'Save session'),
  );

  const panel = h('aside', { class: `pv-lg${st.summary ? ' has-sum' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pv-lg-title' },
    head,
    h('div', { class: 'pv-lg-body' }, banner, what, exercises, effort, went),
    st.summary ? summary(ctx) : null,
    foot,
  );
  panel.addEventListener('click', (ev) => {
    if (st.menu && !(ev.target as Element).closest('.pv-lg-menu, .pv-lg-swap-wrap')) { st.menu = null; change(); }
  });
  layer.replaceChildren(h('div', { class: 'pv-lg-scrim', onclick: () => ctx.onClose() }), panel);
  const body = layer.querySelector('.pv-lg-body');
  if (body) body.scrollTop = keepScroll;
}
