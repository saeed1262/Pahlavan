// The in-plugin help, as signed off with batch 2: the "?" at the right of
// the tab bar (User guide, Show the tips again, When to talk to the coach
// and, since 0.13.0, Your routine, each of the last two a small panel of
// its own), the welcome card on Today
// (the five first steps ticked from the files, Open the guide, Show me
// around, Hide), and a one-time tip's bubble beside its element (Got it,
// Skip the tips). Standard DOM only; the view places the bubble and keeps
// the state.

import type { Result } from '../../../src/core/reason.ts';
import type { Routine } from '../../../src/report/routine.ts';
import type { Welcome } from '../../../src/report/welcome.ts';
import { COACH_TIMES, type Tip } from '../help.ts';
import { h, icon } from './dom.ts';
import { tip } from './progress.ts';
import { commandChip } from './coach.ts';

export interface HelpMenuContext {
  onGuide(): void;
  onTips(): void;
  /** Your routine from the files as last read (built when it opens, so it follows the plan and the items); absent: not offered. */
  routine?(): Result<Routine> | null;
}

/** "Your routine": the day, the Sundays and every four weeks, each row its time, what and where. */
export function routinePanel(r: Result<Routine> | null, onClose?: () => void): HTMLElement {
  const v = r?.value ?? null;
  return h('div', { class: 'pv-help-routine', role: 'dialog', 'aria-label': 'Your routine', 'data-help': 'routine', ...(r ? { 'data-rule': r.reason.rule } : {}) },
    h('div', { class: 'pv-kicker' }, 'Your routine'),
    v ? [
      h('p', { class: 'pv-faint' }, v.intro),
      v.groups.map((g) => [
        h('div', { class: 'pv-hc-h' }, g.title),
        h('ul', { class: 'pv-hr-list', 'data-group': g.id }, g.rows.map((x) => h('li', { 'data-rule': x.reason.rule, 'data-tip': tip(x.time, x.reason.note) },
          h('b', { class: 'pv-hr-time' }, x.time),
          h('span', { class: 'pv-hr-what' }, x.what, x.command ? [' ', h('code', {}, x.command)] : null, x.next ? `${x.command ? '.' : ''} ${x.next}` : null),
          h('span', { class: 'pv-hr-where' }, x.where)))),
      ]),
    ] : h('p', { class: 'pv-faint' }, 'Reading your files…'),
    onClose ? h('div', { class: 'pv-tipbox-foot' }, h('button', { class: 'pv-btn-primary', 'data-k': 'help-routine-close', onclick: () => onClose() }, 'Got it')) : null,
  );
}

/** "When to talk to the coach": the steps on a schedule with their commands, and the times to ask on your own. */
export function coachTimes(onClose?: () => void): HTMLElement {
  const t = COACH_TIMES;
  return h('div', { class: 'pv-help-coach', role: 'dialog', 'aria-label': 'When to talk to the coach', 'data-help': 'coach' },
    h('div', { class: 'pv-kicker' }, 'When to talk to the coach'),
    h('p', { class: 'pv-faint' }, t.how),
    h('div', { class: 'pv-hc-h' }, 'On a schedule'),
    h('ul', { class: 'pv-hc-list' }, t.scheduled.map((x) => h('li', {}, h('b', {}, x.when), h('span', {}, x.what), h('code', {}, x.command)))),
    h('div', { class: 'pv-hc-h' }, 'Any time, in your own words'),
    h('p', {}, 'Type ', h('code', {}, t.ask), ' and say what’s going on:'),
    h('ul', { class: 'pv-hc-any' }, t.anytime.map((x) => h('li', {}, x))),
    onClose ? h('div', { class: 'pv-tipbox-foot' }, h('button', { class: 'pv-btn-primary', 'data-k': 'help-coach-close', onclick: () => onClose() }, 'Got it')) : null,
  );
}

/** The "?" button and its small menu; the menu (or a panel) closes on a choice, a click outside or Escape. */
export function helpMenu(ctx: HelpMenuContext): HTMLElement {
  const wrap = h('div', { class: 'pv-help' });
  // The menu's own window (a popout has its own document).
  const doc = (): Document | undefined => wrap.ownerDocument ?? undefined;
  let btn: HTMLElement;
  const close = () => {
    wrap.classList.remove('is-open', 'is-coach', 'is-routine');
    btn.setAttribute('aria-expanded', 'false');
    doc()?.removeEventListener('mousedown', outside, true);
    doc()?.removeEventListener('keydown', onKey, true);
  };
  const outside = (e: Event) => {
    if (!wrap.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  btn = h('button', {
    class: 'pv-help-btn',
    'aria-label': 'Help',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    'data-k': 'help',
    onclick: () => {
      if (wrap.classList.contains('is-open') || wrap.classList.contains('is-coach') || wrap.classList.contains('is-routine')) return close();
      show('is-open');
    },
  }, icon('question'));
  const show = (cls: 'is-open' | 'is-coach' | 'is-routine') => {
    wrap.classList.add(cls);
    btn.setAttribute('aria-expanded', 'true');
    doc()?.addEventListener('mousedown', outside, true);
    doc()?.addEventListener('keydown', onKey, true);
  };
  const item = (label: string, ic: string, fn: () => void, k: string) => h('button', { class: 'pv-menu-item', role: 'menuitem', 'data-k': k, onclick: () => { close(); fn(); } }, h('span', { class: 'pv-menu-check' }, icon(ic)), h('span', { class: 'pv-menu-name' }, label));
  // Your routine is built each time it opens, from the files as last read.
  let routine: HTMLElement | null = null;
  const openRoutine = () => {
    routine?.remove();
    routine = routinePanel(ctx.routine?.() ?? null, close);
    wrap.append(routine);
    show('is-routine');
  };
  wrap.append(btn, h('div', { class: 'pv-menu pv-help-menu', role: 'menu', 'aria-label': 'Help' },
    item('User guide', 'info', ctx.onGuide, 'help-guide'),
    item('Show the tips again', 'history', ctx.onTips, 'help-tips'),
    item('When to talk to the coach', 'mail', () => show('is-coach'), 'help-coach'),
    ctx.routine ? item('Your routine', 'calendar', openRoutine, 'help-routine') : null,
  ), coachTimes(close));
  return wrap;
}

export interface WelcomeContext {
  welcome: Welcome;
  onGuide(): void;
  onTour(): void;
  onHide(): void;
  /** The coach skill in this vault, as the first step: 'checking' until Pahlavan has looked; `node` false when Node 18 or later wasn't found. */
  coach?: { state: 'checking' | 'missing' | 'old' | 'ok'; node: boolean | null; onSetUp(): void };
  /** Copies a step's command (the chips' Copy); absent: the command shows without it. */
  onCopy?(text: string): void;
}

/** The safety line: the welcome card, the settings and the README say it the same way. */
export const SAFETY_LINE = 'Pahlavan is a general fitness tool for adults 18 and over, not medical advice. If you have a health condition, check with a doctor before you start, and stop any exercise that hurts.';
/** The beta line, in the settings and the README. */
export const BETA_LINE = 'Pahlavan is a free beta: I use it every day, and it may still change. Bug reports and ideas are welcome on GitHub.';

/** The welcome card at the top of Today: five steps, each ticked from the files; hidden any time, gone when all are done. */
export function welcomeCard(ctx: WelcomeContext): HTMLElement {
  const w = ctx.welcome;
  const coach = ctx.coach ?? null;
  const coachDone = coach?.state === 'ok';
  // The coach comes first: the intake and the plan run in it.
  const total = w.steps.length + (coach ? 1 : 0);
  const done = w.done + (coachDone ? 1 : 0);
  const next = coach && !coachDone ? null : w.steps.find((s) => !s.done);
  const coachStep = coach
    ? h('li', { class: `${coachDone ? 'is-done' : 'is-next'}`, 'data-step': 'coach' },
      h('span', { class: 'pv-welcome-mark', 'aria-label': coachDone ? 'done' : 'to do' }, coachDone ? icon('check') : '1'),
      h('div', {},
        h('b', {}, 'Set up the coach'),
        h('span', { class: 'pv-faint' }, coachDone
          ? 'It’s in this vault: /fitness-coach in Claude Code'
          : 'The coach is a Claude Code skill: this writes it into the vault, then you talk to it in Claude Code'),
        coach.node === false ? h('span', { class: 'pv-welcome-warn' }, icon('info'), 'It needs Node 18 or later: install it from nodejs.org.') : null,
        !coachDone && coach.state !== 'checking'
          ? h('button', { class: 'pv-btn-primary pv-welcome-act', onclick: () => coach.onSetUp(), 'data-k': 'welcome-coach' }, coach.state === 'old' ? 'Update the coach' : 'Set up the coach')
          : null))
    : null;
  return h('section', { class: 'pv-card pv-welcome', 'data-card': 'welcome' },
    h('div', { class: 'pv-card-head' },
      h('div', {},
        h('div', { class: 'pv-kicker' }, 'Getting started'),
        h('h2', { class: 'pv-welcome-title' }, 'Welcome to Pahlavan'),
        h('div', { class: 'pv-card-sub' }, `${done} of ${total} first steps done · each one ticks itself from your files`)),
      h('button', { class: 'pv-btn-quiet', onclick: () => ctx.onHide(), 'data-k': 'welcome-hide' }, 'Hide')),
    h('ol', { class: 'pv-welcome-steps' }, coachStep, w.steps.map((s, i) => h('li', { class: `${s.done ? 'is-done' : ''}${s === next ? ' is-next' : ''}`, 'data-step': s.id },
      h('span', { class: 'pv-welcome-mark', 'aria-label': s.done ? 'done' : 'to do' }, s.done ? icon('check') : String(i + 1 + (coach ? 1 : 0))),
      h('div', {}, h('b', {}, s.title), h('span', { class: 'pv-faint' }, s.how), s.command && !s.done ? commandChip(s.command, ctx.onCopy) : null),
    ))),
    h('p', { class: 'pv-welcome-safety', 'data-k': 'welcome-safety' }, icon('shield'), h('span', {}, SAFETY_LINE)),
    h('div', { class: 'pv-welcome-foot' },
      h('button', { class: 'pv-btn-primary', onclick: () => ctx.onGuide(), 'data-k': 'welcome-guide' }, icon('info'), 'Open the guide'),
      h('button', { class: 'pv-btn-quiet', onclick: () => ctx.onTour(), 'data-k': 'welcome-tour' }, icon('right'), 'Show me around')),
  );
}

export interface TipContext {
  tip: Tip;
  /** Its place among the tips not seen yet (1-based) and how many there are. */
  n: number;
  total: number;
  onGot(): void;
  onSkip(): void;
}

/** One tip's bubble; the view puts it beside the tip's element. */
export function tipBubble(ctx: TipContext): HTMLElement {
  return h('div', { class: 'pv-tipbox', role: 'dialog', 'aria-label': `Tip: ${ctx.tip.title}`, 'data-tip-id': ctx.tip.id },
    h('div', { class: 'pv-tipbox-head' }, h('span', { class: 'pv-kicker' }, `Tip ${ctx.n} of ${ctx.total}`), h('b', {}, ctx.tip.title)),
    h('p', {}, ctx.tip.text),
    h('div', { class: 'pv-tipbox-foot' },
      h('button', { class: 'pv-btn-quiet', onclick: () => ctx.onSkip(), 'data-k': 'tip-skip' }, 'Skip the tips'),
      h('button', { class: 'pv-btn-primary', onclick: () => ctx.onGot(), 'data-k': 'tip-got' }, 'Got it')),
  );
}
