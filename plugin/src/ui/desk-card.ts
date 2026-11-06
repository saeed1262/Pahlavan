// The Plan's Desk breaks card, as signed off in mockups/plan.html: the
// plan's routine (its steps), how often, the hours and the days on a small
// day line, its Why with the rule, and "Change in Habits"; or "No desk
// breaks in this plan" (with the item's own routine when one runs). From
// buildDeskCard; standard DOM only.

import { hhmm, toMinutes } from '../../../src/core/clock.ts';
import type { DeskCardModel } from '../data-source.ts';
import { h, icon, s } from './dom.ts';
import { fmt } from './format.ts';
import { tip } from './progress.ts';

export interface DeskCardContext {
  model: DeskCardModel;
  /** Progress, Habits, with the desk-break item's form open (or the Add form for a new one). */
  onChange(itemId: string | null): void;
}

/** The working day as a line, 08:00 to 18:00 (wider, by whole 2 hours, for a window outside it): the window shaded, a dot per break. */
export function dayLine(times: readonly string[], from: string, to: string, minutes: number, width = 360): SVGElement {
  const lo = Math.min(480, Math.floor((toMinutes(from) ?? 480) / 120) * 120);
  const hi = Math.max(1080, Math.ceil((toMinutes(to) ?? 1080) / 120) * 120);
  const x = (t: string) => 10 + (((toMinutes(t) ?? lo) - lo) / (hi - lo)) * (width - 20);
  const axis: string[] = [];
  for (let m = lo; m <= hi; m += 120) axis.push(hhmm(m));
  return s('svg', { class: 'pv-desk-day', viewBox: `0 0 ${width} 46`, width, height: 46, role: 'img', 'aria-label': `Desk breaks at ${times.join(', ')}` },
    s('rect', { class: 'pv-desk-win', x: x(from), y: 10, width: Math.max(0, x(to) - x(from)), height: 14, rx: 4 }),
    s('line', { class: 'pv-desk-axis', x1: 10, x2: width - 10, y1: 17, y2: 17 }),
    times.map((t, i) => s('circle', { class: 'pv-desk-dot', cx: x(t), cy: 17, r: 5, 'data-tip': tip(`Break ${i + 1} of ${times.length}`, `${t}, about ${minutes} minutes`) })),
    axis.map((t) => s('text', { class: 'pv-ax', x: x(t), y: 42, 'text-anchor': 'middle' }, t)),
  );
}

export function deskCard(ctx: DeskCardContext): HTMLElement {
  const m = ctx.model;
  const p = m.plan;
  const item = m.item;
  const change = h('button', { class: 'pv-btn-quiet', onclick: () => ctx.onChange(item?.id ?? null), 'data-k': 'desk-change' }, icon('pencil'), item ? 'Change in Habits' : 'Add in Habits');
  if (!p) {
    const own = item?.own;
    return h('section', { class: 'pv-card pv-span-12', 'data-card': 'desk', 'data-sec': 'desk' },
      h('div', { class: 'pv-card-head' }, h('div', {}, h('div', { class: 'pv-kicker' }, 'Desk breaks'), h('div', { class: 'pv-card-sub' }, 'Short posture breaks during the working day')), h('div', { class: 'pv-card-tools' }, change)),
      h('div', { class: 'pv-desk-none' }, icon('monitor'), h('div', {},
        h('b', {}, 'No desk breaks in this plan'),
        h('p', {}, own
          ? `Your own desk breaks run from Habits until a plan has them: ${own.steps.length} steps, every ${own.every} min from ${own.from} to ${own.to} (${own.times.length} a day).`
          : 'The coach adds them to a plan for desk work, from the intake and the photo assessment. You can still add them yourself in Progress, Habits.'),
      )),
    );
  }
  const sub = item
    ? `Proposed by this plan, ${item.followPlan ? `accepted into your Habits on ${fmt.day(item.accepted)}` : 'in your Habits with your own times'} · a reminder card at each break, ${p.daysText === 'every day' ? 'every day' : `on ${p.daysText}`}${item.paused ? ` · paused since ${fmt.day(item.paused)}` : ''}`
    : 'Proposed by this plan; add them in Habits to get a reminder card at each break';
  return h('section', { class: 'pv-card pv-span-12', 'data-card': 'desk', 'data-sec': 'desk' },
    h('div', { class: 'pv-card-head' }, h('div', {}, h('div', { class: 'pv-kicker' }, 'Desk breaks'), h('div', { class: 'pv-card-sub' }, sub)), h('div', { class: 'pv-card-tools' }, change)),
    h('div', { class: 'pv-desk-grid' },
      h('div', { class: 'pv-desk-when' },
        h('div', { class: 'pv-desk-stats' },
          h('div', {}, h('b', {}, `Every ${p.every} min`), h('span', {}, 'between breaks')),
          h('div', {}, h('b', {}, `${p.from} to ${p.to}`), h('span', {}, p.daysText)),
          h('div', {}, h('b', {}, `${p.times.length} a day`), h('span', {}, `about ${p.minutes} min each`))),
        dayLine(p.times, p.from, p.to, p.minutes),
        h('div', { class: 'pv-chart-key' },
          h('span', {}, s('svg', { viewBox: '0 0 16 12' }, s('rect', { class: 'pv-desk-win', x: 1, y: 1, width: 14, height: 10, rx: 2 })), 'Working window'),
          h('span', {}, s('svg', { viewBox: '0 0 12 12' }, s('circle', { class: 'pv-desk-dot', cx: 6, cy: 6, r: 4 })), 'A break')),
      ),
      h('ol', { class: 'pv-desk-steps' }, p.steps.map((x) => h('li', {}, h('div', { class: 'pv-desk-step' }, h('b', {}, x.name), h('span', {}, x.dose)), x.how ? h('div', { class: 'pv-faint' }, x.how) : null))),
      h('div', { class: 'pv-desk-why', 'data-rule': m.reason.rule },
        h('div', { class: 'pv-lt-h', 'data-tip': `Why|Rule ${m.reason.rule}` }, 'Why'),
        p.why.length ? h('ul', {}, p.why.map((w) => h('li', {}, icon('right'), h('span', {}, w.what, w.from ? [' ', h('em', {}, `(${w.from})`)] : null)))) : h('p', { class: 'pv-faint' }, m.reason.note ?? ''),
        h('div', { class: 'pv-faint pv-desk-change' }, 'The routine and its times change with the plan while “Follow the plan” is on; a new plan can drop the breaks.'),
      ),
    ),
  );
}
