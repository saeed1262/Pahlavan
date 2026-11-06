// The status bar item: the stand-up count on this Mac ("Stand in 12 min",
// "Stand up now", "Standing, 18 min left"; Habit Nudges showed the same)
// and the "Standing now" switch for a standing desk, a click toggling it
// (hidden while the stand-up counts its standing down, unless it is on;
// while it is on, the stand-up shows the minutes to the next desk stand).
// Shown only while a stand-up or sitting-time item counts today. Standard
// DOM only.

import type { StandingNow } from '../reminders/counters.ts';
import type { StandStatus } from '../reminders/machine.ts';
import { h, icon } from './dom.ts';

export interface StatusInput {
  stand: readonly StandStatus[];
  standing: StandingNow;
  /** A sitting-time item counts today (on a computer that reads keyboard and mouse activity). */
  sitting: boolean;
  onStanding(): void;
}

/** The stand-up part's text and tooltip. */
export function standText(s: StandStatus): { text: string; tip: string } {
  if (s.phase === 'standing') return { text: `Standing, ${s.standLeft} min left`, tip: `${s.name}: about ${s.standLeft} minutes of standing to go.` };
  if (s.phase === 'due') return { text: 'Stand up now', tip: `${s.name}: time to stand.` };
  return { text: `Stand in ${s.sitLeft} min`, tip: `${s.name}: after about ${s.sitLeft} more minutes at the keyboard or mouse. Calls and time away don't count.` };
}

/** The stand-up part while "Standing now" is on: the minutes to the next desk stand. */
export function deskText(s: StandStatus): { text: string; tip: string } {
  const left = s.deskLeft ?? null;
  return {
    text: left !== null ? `Stand logged in ${left} min` : 'Standing at the desk',
    tip: `${s.name}: standing at the desk counts. Each stand's worth of minutes is logged as a stand, and the sitting count starts over.`,
  };
}

export function renderStatus(el: HTMLElement, s: StatusInput): void {
  const stand = s.stand.find((x) => x.inHours) ?? null;
  const show = stand !== null || s.sitting;
  el.toggleAttribute('hidden', !show);
  el.style.display = show ? '' : 'none';
  if (!show) {
    el.replaceChildren();
    return;
  }
  const parts: HTMLElement[] = [];
  if (stand) {
    // With "Standing now" on, the desk time counts toward the next stand instead of a sitting countdown.
    const desk = s.standing.on && stand.phase !== 'standing';
    const t = desk ? deskText(stand) : standText(stand);
    parts.push(h('span', { class: `pv-sb-stand is-${desk ? 'desk' : stand.phase}`, 'aria-label': t.tip, title: t.tip }, icon('clock'), t.text));
  }
  const on = s.standing.on;
  // During the stand-up's countdown you are standing and sitting time is not counted, so the switch's "Sitting" would contradict it; it comes back when the countdown ends (kept while on, so it can be turned off).
  if (stand?.phase === 'standing' && !on) {
    el.replaceChildren(...parts);
    return;
  }
  const tip = on ? 'Standing now: sitting time is not counted. Click when you sit again.' : 'Standing at the desk? Click so typing standing does not count as sitting.';
  parts.push(h('span', { class: `pv-sb-standing${on ? ' is-on' : ''}`, role: 'button', 'aria-pressed': on ? 'true' : 'false', 'aria-label': tip, title: tip, onclick: () => s.onStanding() }, icon('stand'), on ? 'Standing now' : 'Sitting'));
  el.replaceChildren(...parts);
}
