// Today's "Your day" strip, as signed off for 0.13.0: under the banner and
// above At a glance, the day's steps with Pahlavan in one row (they wrap on
// a narrow pane), each with its icon, its status word in its colour (done,
// next, open; a quiet step faint), its name, one line and at most one
// action; the step that comes next has the accent border. From the
// engine's yourDay (src/report/your-day.ts); it folds like Today's other
// sections (`data-sec`) and is redrawn with Due today (`data-live`).
// Standard DOM only; the view passes the callbacks.

import type { Result } from '../../../src/core/reason.ts';
import type { DayAction, DayStep, YourDay } from '../../../src/report/your-day.ts';
import { commandChip } from './coach.ts';
import { h, icon } from './dom.ts';
import { tip } from './progress.ts';

export interface YourDayContext {
  day: Result<YourDay>;
  /** Opens the morning card. */
  onMorning(): void;
  /** Opens the Log panel on today's session. */
  onLog(): void;
  /** Goes to Due today. */
  onDue(): void;
  onFood(): void;
  onCheckin(): void;
  /** Copies a coach command; absent: the command shows without Copy. */
  onCopyCommand?(text: string): void;
}

function actionEl(a: DayAction, step: DayStep, ctx: YourDayContext): HTMLElement {
  if (a.kind === 'copy') return commandChip(a.command, ctx.onCopyCommand);
  const run = { morning: ctx.onMorning, log: ctx.onLog, due: ctx.onDue, food: ctx.onFood, checkin: ctx.onCheckin }[a.kind];
  return h('button', { class: a.kind === 'log' ? 'pv-btn-primary pv-yd-act' : 'pv-btn-quiet pv-yd-act', 'data-k': `yd-${step.id}`, onclick: () => run() }, a.kind === 'log' ? icon('plus') : null, a.label);
}

/** The strip (the view leaves it out when the engine has no day: without a plan). */
export function yourDayStrip(ctx: YourDayContext): HTMLElement {
  const d = ctx.day.value;
  return h('section', { class: 'pv-card pv-yd', 'data-sec': 'yourday', 'data-live': 'yourday', 'data-rule': ctx.day.reason.rule, 'aria-label': `${d.kicker}, ${d.count}` },
    h('div', { class: 'pv-yd-head' },
      h('span', { class: 'pv-kicker' }, d.kicker),
      h('span', { class: 'pv-yd-count', 'data-tip': tip('Your day', ctx.day.reason.note) }, d.count)),
    h('ol', { class: 'pv-yd-steps' }, d.steps.map((s) => h('li', { class: `pv-yd-step is-${s.state}`, 'data-step': s.id, 'data-state': s.state, 'data-rule': s.reason.rule },
      h('div', { class: 'pv-yd-top' },
        h('span', { class: 'pv-yd-icon' }, icon(s.icon)),
        h('span', { class: 'pv-yd-word', 'data-tip': tip(s.name, s.reason.note) }, s.state === 'done' ? icon('check') : null, s.word)),
      h('b', { class: 'pv-yd-name' }, s.name),
      h('span', { class: 'pv-yd-line' }, s.line),
      s.action ? h('div', { class: 'pv-yd-foot' }, actionEl(s.action, s, ctx)) : null,
    ))),
  );
}
