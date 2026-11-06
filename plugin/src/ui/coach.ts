// The coach's next step on the screens, from the engine's coach steps
// (core/coach-steps.ts): the command to run in Claude Code in a code chip
// with its Copy button; Today's "Ask the coach" card, drawn while the step
// after the Sunday check-in is due (its Sunday, the answers saved) or still
// to do (after it, no letter yet); and the Sunday check-in's line under its
// Save ("Save your answers, then ask the coach", "Next: ask the coach").
// Standard DOM only; the view passes the copy.

import type { CoachNow } from '../../../src/core/coach-steps.ts';
import type { Result } from '../../../src/core/reason.ts';
import { h, icon, type Child } from './dom.ts';
import { fmt } from './format.ts';

/** "the week’s letter", "the mesocycle review", "the phase review": the step after "ask the coach for". */
export const stepWords = (s: { kind: string; title: string }): string => (s.kind === 'letter' ? 'the week’s letter' : `the ${s.title.toLowerCase()}`);

/** The command in a code chip, with Copy when the view can copy. */
export function commandChip(command: string, onCopy?: (text: string) => void): HTMLElement {
  return h('span', { class: 'pv-cmd' },
    h('code', {}, command),
    onCopy ? h('button', { class: 'pv-btn-quiet pv-cmd-copy', 'aria-label': `Copy ${command}`, 'data-tip': 'Copy|Then paste it in Claude Code, started in your vault', 'data-k': 'copy-command', onclick: () => onCopy(command) }, icon('copy'), 'Copy') : null);
}

/** Today's "Ask the coach" card; null unless the step is due or still to do. */
export function coachCard(now: Result<CoachNow> | null, onCopy?: (text: string) => void): HTMLElement | null {
  const c = now?.value;
  if (!now || !c || (c.state !== 'due' && c.state !== 'late')) return null;
  return h('section', { class: 'pv-card pv-coach', 'data-sec': 'coach', 'data-card': 'coach', 'data-rule': now.reason.rule, 'data-state': c.state },
    h('div', { class: 'pv-card-head' }, h('div', {},
      h('div', { class: 'pv-kicker' }, 'Ask the coach'),
      h('h3', { class: 'pv-card-title' }, c.title),
      h('div', { class: 'pv-card-sub' }, c.state === 'due' ? 'Today, after the Sunday check-in' : `Still to do since ${fmt.wd(c.date)}: no letter yet`))),
    h('p', { class: 'pv-coach-why' }, c.line),
    h('div', { class: 'pv-coach-run' }, h('span', { class: 'pv-faint' }, 'In Claude Code:'), commandChip(c.command, onCopy)),
  );
}

/**
 * The Sunday check-in's coach line: before the save, "Save your answers,
 * then ask the coach: <command>"; after it, "Next: ask the coach" with the
 * command and Copy; once the letter is in, that it is. Null without a step.
 */
export function coachNext(now: Result<CoachNow> | null, onCopy?: (text: string) => void): HTMLElement | null {
  const c = now?.value;
  if (!now || !c) return null;
  let body: Child[];
  if (c.state === 'answer-first') body = [icon('mail'), h('span', {}, 'Save your answers, then ask the coach: '), commandChip(c.command)];
  else if (c.state === 'done') body = [icon('check'), h('span', { class: 'pv-faint' }, c.line)];
  else body = [icon('mail'), h('span', {}, h('b', {}, 'Next: ask the coach'), ` for ${stepWords(c)}. `), commandChip(c.command, onCopy)];
  return h('div', { class: `pv-coach-next is-${c.state}`, 'data-coach': c.state, 'data-rule': now.reason.rule }, body);
}
