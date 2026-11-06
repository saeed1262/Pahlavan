// Whether a tick may show a card now, and whether a card that opens also
// sends a macOS notification. Habit Nudges' rules: nothing while reminders
// are off or this Mac is turned off, while a card is already open or one of
// Isfahan's day cards is up, or while the Mac has had no keyboard or mouse
// input for a while (the card waits for the Mac you are actually at); here
// also nothing during the quiet hours. A card opens inside Obsidian either
// way; the notification is for when Obsidian is not the app in front. Pure.

import type { ReminderSettings } from '../settings.ts';
import { inQuietHours } from '../settings.ts';

/** A card waits while the Mac has been idle longer than this (Habit Nudges' "Wait while idle", 5 minutes in this vault). */
export const IDLE_WAIT_S = 5 * 60;

export interface GateInput {
  reminders: Pick<ReminderSettings, 'on' | 'quiet'>;
  /** "Remind on this Mac". */
  remindHere: boolean;
  /** Local "HH:MM" now. */
  time: string;
  /** A Pahlavan card is open already (one at a time). */
  cardOpen: boolean;
  /** One of Isfahan's day cards (the morning briefing) is open: a reminder waits for the next tick. */
  otherCard: boolean;
  /** A look is still running. */
  busy: boolean;
  /** Seconds since the last keyboard or mouse input anywhere on the Mac; null when unknown (counts as here). */
  idleS: number | null;
  /** Shown by hand (the reminder queue command): the idle wait does not apply. */
  byHand?: boolean;
}

export type GateWhy = 'off' | 'not-here' | 'quiet' | 'open' | 'other-card' | 'busy' | 'idle';
export type Gate = { go: true } | { go: false; why: GateWhy };

/** The checks in order; the first that fails says why. The idle check comes last (it is the only one that reads the Mac). */
export function tickGate(g: GateInput): Gate {
  if (!g.reminders.on) return { go: false, why: 'off' };
  if (!g.remindHere) return { go: false, why: 'not-here' };
  if (inQuietHours(g.reminders.quiet, g.time)) return { go: false, why: 'quiet' };
  if (g.busy) return { go: false, why: 'busy' };
  if (g.cardOpen) return { go: false, why: 'open' };
  if (g.otherCard) return { go: false, why: 'other-card' };
  if (!g.byHand && g.idleS !== null && g.idleS > IDLE_WAIT_S) return { go: false, why: 'idle' };
  return { go: true };
}

/**
 * The stand-up card's checks, every 30 seconds: as the tick's, without the
 * idle wait (the count itself starts over after time away, so a due stand-up
 * means you are there). `cardOpen`: another Pahlavan card is open; the
 * stand-up waits for it, as in Habit Nudges.
 */
export function standGate(g: Pick<GateInput, 'reminders' | 'remindHere' | 'time' | 'cardOpen' | 'otherCard'>): Gate {
  if (!g.reminders.on) return { go: false, why: 'off' };
  if (!g.remindHere) return { go: false, why: 'not-here' };
  if (inQuietHours(g.reminders.quiet, g.time)) return { go: false, why: 'quiet' };
  if (g.cardOpen) return { go: false, why: 'open' };
  if (g.otherCard) return { go: false, why: 'other-card' };
  return { go: true };
}

/**
 * A macOS notification goes with a card when notifications are on and
 * Obsidian is not the app in front (not focused, or hidden): the card is
 * already waiting inside Obsidian. Not for a card opened by hand.
 */
export function shouldNotify(o: { notifications: boolean; focused: boolean; visible: boolean; byHand: boolean }): boolean {
  return o.notifications && !o.byHand && (!o.focused || !o.visible);
}
