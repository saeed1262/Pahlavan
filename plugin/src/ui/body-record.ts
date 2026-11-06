// Check-in's Body record card, as signed off in mockups/checkin.html: the
// tape, the progress photos and the fitness tests, each with its next date,
// its last entry and where its schedule comes from ("from your plan", or
// "your own schedule" for every N days), and a button that opens the same
// form as its reminder card; the Schedule switch between the plan and every
// N days from a start date. Also the morning check-in's reminder time, set
// on its own card. From buildBodyRecord; standard DOM only.

import type { BodyRecordSchedule, MorningReminder } from '../../../src/core/schema.ts';
import { inDaysText } from '../../../src/report/habits-screen.ts';
import type { BodyRecordModel } from '../data-source.ts';
import { h, icon } from './dom.ts';
import { fmt } from './format.ts';
import { tip } from './progress.ts';

/** The card's state, kept by the view: the schedule editor open, a write on the way, its error. */
export interface BodyRecordUi {
  edit: boolean;
  busy: boolean;
  error: string | null;
}

export interface BodyRecordContext {
  model: BodyRecordModel;
  ui: BodyRecordUi;
  canWrite: boolean;
  onChange: () => void;
  /** Opens the part's card (the tape, photos or tests form). */
  onOpen: (part: 'tape' | 'photos' | 'tests') => void;
  onSchedule: (next: BodyRecordSchedule) => void;
}

const ICON = { tape: 'tape', photos: 'camera', tests: 'flag' } as const;
const BUTTON = { tape: ['plus', 'Add the tape'], photos: ['upload', 'Add photos'], tests: ['plus', 'Enter the tests'] } as const;
const kb = (k: string) => ({ 'data-k': k });

export function bodyRecordCard(ctx: BodyRecordContext): HTMLElement {
  const m = ctx.model;
  const ui = ctx.ui;
  const plan = m.source === 'plan';
  const srcPill = h('span', { class: `pv-br-src is-${m.source}` }, plan ? 'from your plan' : 'your own schedule');
  const tiles = m.parts.map((p) => {
    const soon = p.due || (p.inDays !== null && p.inDays <= 3);
    const dueWord = p.due ? (p.nextDate && p.nextDate < m.date ? `Due since ${fmt.day(p.nextDate)}` : 'Due today') : p.inDays === 0 ? 'Due today' : `Due ${inDaysText(m.date, p.nextDate!)}`;
    return h('div', { class: `pv-br-tile${p.due ? ' is-due' : ''}` },
      h('div', { class: 'pv-br-head' }, h('span', { class: 'pv-rem-icon' }, icon(ICON[p.part])), h('b', {}, p.title), soon && p.nextDate ? h('span', { class: `pv-status is-${p.due ? 'below' : 'neutral'}` }, icon('clock'), dueWord) : null),
      h('dl', { class: 'pv-br-dl' },
        h('dt', {}, 'Next'), h('dd', {}, p.nextDate ? [h('b', {}, fmt.wd(p.nextDate)), ' ', h('span', { class: 'pv-faint' }, inDaysText(m.date, p.nextDate))] : h('span', { class: 'pv-faint' }, 'None left in this plan')),
        h('dt', {}, 'Last'), h('dd', {}, p.last ? [fmt.wd(p.last.date), p.last.text ? h('span', { class: 'pv-faint' }, ` · ${p.last.text}`) : null] : h('span', { class: 'pv-faint' }, 'None yet')),
        h('dt', {}, 'When'), h('dd', { 'data-tip': tip(p.title, p.reason.note ?? null, p.skipped ? 'This round was skipped' : null) }, p.schedule.text, ' ', srcPill.cloneNode(true)),
      ),
      h('button', { class: 'pv-btn-quiet', onclick: () => ctx.onOpen(p.part), ...kb(`br-${p.part}`) }, icon(BUTTON[p.part][0]), BUTTON[p.part][1]),
    );
  });
  const fx = m.fixed;
  const fixedRow = (label: string, every: number, from: string, set: (every: number, from: string) => void, k: string) => {
    const n = h('input', { type: 'number', min: 1, value: every, disabled: plan || !ctx.canWrite || ui.busy, 'aria-label': `${label} every`, ...kb(`${k}-n`) });
    const d = h('input', { type: 'date', value: from, disabled: plan || !ctx.canWrite || ui.busy, 'aria-label': `${label} from`, ...kb(`${k}-from`) });
    const commit = () => {
      const v = Math.round(Number(n.value));
      if (v >= 1 && /^\d{4}-\d{2}-\d{2}$/.test(d.value)) set(v, d.value);
    };
    n.addEventListener('change', commit);
    d.addEventListener('change', commit);
    return h('div', { class: `pv-br-sched-row${plan ? ' is-off' : ''}` }, h('span', { class: 'pv-faint' }, `${label} every`), h('span', { class: 'pv-field-in pv-sf-n' }, n, h('em', {}, 'days')), h('span', { class: 'pv-faint' }, 'from'), h('span', { class: 'pv-field-in pv-sf-date' }, d));
  };
  const fixed = (over: Partial<BodyRecordSchedule>): BodyRecordSchedule => ({ schedule: 'fixed', tapeFrom: fx.tapeFrom, tapeEvery: fx.tapeEvery, testsFrom: fx.testsFrom, testsEvery: fx.testsEvery, ...over });
  const editor = ui.edit
    ? h('div', { class: 'pv-br-sched' },
        h('div', { class: 'pv-sf-label' }, 'When they’re due'),
        h('div', { class: 'pv-seg' },
          h('button', { class: plan ? 'is-on' : '', disabled: !m.hasPlan || !ctx.canWrite || ui.busy, ...(m.hasPlan ? {} : { 'data-tip': tip('From the plan', 'There is no plan yet') }), onclick: () => !plan && ctx.onSchedule({ ...(m.setting ?? fixed({})), schedule: 'plan' }), ...kb('br-plan') }, 'From the plan'),
          h('button', { class: plan ? '' : 'is-on', disabled: !ctx.canWrite || ui.busy, onclick: () => plan && ctx.onSchedule(fixed({})), ...kb('br-fixed') }, 'Every N days')),
        fixedRow('Tape and photos', fx.tapeEvery, fx.tapeFrom, (every, from) => ctx.onSchedule(fixed({ tapeEvery: every, tapeFrom: from })), 'br-tape'),
        fixedRow('Tests', fx.testsEvery, fx.testsFrom, (every, from) => ctx.onSchedule(fixed({ testsEvery: every, testsFrom: from })), 'br-tests'),
        h('div', { class: 'pv-sf-hint' }, icon('info'), h('span', {}, 'From the plan: the tape every second Sunday, photos on each light week’s Sunday, tests at each phase end. Before there’s a plan, every N days.')),
        ui.error ? h('div', { class: 'pv-ci-error' }, ui.error) : null,
      )
    : null;
  return h('section', { class: 'pv-card', 'data-card': 'body-record', 'data-sec': 'body' },
    h('div', { class: 'pv-card-head' },
      h('div', {}, h('div', { class: 'pv-kicker' }, 'Body record'), h('h3', { class: 'pv-card-title' }, 'Tape, photos and tests'), h('div', { class: 'pv-card-sub' }, plan ? 'When each is due comes from your plan; each opens the same form as its reminder card' : 'Every N days from a start date until your plan sets them; each opens the same form as its reminder card')),
      h('div', { class: 'pv-card-tools' }, h('button', { class: `pv-btn-quiet${ui.edit ? ' is-on' : ''}`, onclick: () => { ui.edit = !ui.edit; ctx.onChange(); }, ...kb('br-sched') }, icon('calendar'), 'Schedule')),
    ),
    editor,
    h('div', { class: 'pv-br-grid' }, tiles),
    h('div', { class: 'pv-foot-note' }, icon('info'), 'Saved to body-data.json and the dated folders under Progress Photos, field by field, the files Habit Nudges writes too.'),
  );
}

/** The morning card's reminder: the time it pops up on each Mac with reminders on, set here. */
export interface MorningBellUi {
  open: boolean;
  on: boolean;
  at: string;
  busy: boolean;
}

export function morningBell(o: { current: MorningReminder | null; ui: MorningBellUi; canWrite: boolean; onChange(): void; onSave(next: MorningReminder): void }): HTMLElement {
  const cur = o.current;
  const ui = o.ui;
  const label = cur?.on ? cur.at : 'Off';
  const btn = h('button', { class: `pv-btn-quiet${ui.open ? ' is-on' : ''}`, onclick: () => { ui.open = !ui.open; ui.on = cur?.on ?? true; ui.at = cur?.at ?? '07:30'; o.onChange(); }, 'data-tip': tip('Reminder', cur?.on ? `A card at ${cur.at} on each Mac with reminders on` : 'No morning card', 'Click to change the time'), ...kb('m-bell') }, icon('bell'), label);
  if (!ui.open) return h('span', { class: 'pv-bell' }, btn);
  const time = h('input', { type: 'time', value: ui.at, disabled: !ui.on, 'aria-label': 'Reminder time', ...kb('m-bell-at') });
  time.addEventListener('input', () => { ui.at = time.value; });
  return h('span', { class: 'pv-bell' }, btn,
    h('div', { class: 'pv-bell-pop', role: 'dialog', 'aria-label': 'The morning reminder' },
      h('div', { class: 'pv-bell-row' }, h('button', { class: `pv-sw${ui.on ? ' is-on' : ''}`, role: 'switch', 'aria-checked': ui.on ? 'true' : 'false', 'aria-label': 'Morning reminder', onclick: () => { ui.on = !ui.on; o.onChange(); }, ...kb('m-bell-on') }), h('span', {}, ui.on ? 'A card at' : 'No card'), h('span', { class: `pv-field-in pv-sf-time${ui.on ? '' : ' is-off'}` }, time)),
      h('div', { class: 'pv-faint' }, 'On each Mac with reminders on, until 21:00; on a tape day the tape joins it.'),
      h('div', { class: 'pv-bell-acts' }, h('button', { class: 'pv-btn-quiet', onclick: () => { ui.open = false; o.onChange(); }, ...kb('m-bell-cancel') }, 'Cancel'), h('button', { class: 'pv-btn-primary is-small', disabled: !o.canWrite || ui.busy || (ui.on && !/^\d{2}:\d{2}$/.test(ui.at)), onclick: () => o.onSave({ on: ui.on, at: /^\d{2}:\d{2}$/.test(ui.at) ? ui.at : (cur?.at ?? '07:30') }), ...kb('m-bell-save') }, icon('check'), 'Save')),
    ));
}
