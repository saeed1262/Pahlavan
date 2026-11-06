// The card queue: which due card opens first, and the keys held back for a
// moment after they were answered here. Habit Nudges' order: "a reminder is
// for its time, it goes first", so cards with a set time (the morning
// check-in, the tape after it, the habit slots, "Did you train today?")
// come before the ones that can wait (repeating amounts and desk breaks,
// sitting time, photo day, the tests), the most overdue first among them.
// The stand-up is first of all: it can't be closed and its count is running.
// Pure.

import type { CardKind, DueCard } from '../../../src/core/nudges.ts';

/** Cards that fall due at a set time of day. */
export const TIMED: readonly CardKind[] = ['morning', 'tape', 'habits', 'train'];

const rank = (c: DueCard) => (c.kind === 'standup' ? 0 : TIMED.includes(c.kind) ? 1 : 2);

/**
 * The due cards in the order to open them: the stand-up; then the cards for
 * a set time, earliest first (ties keep the engine's order); then the rest
 * in the engine's order (by kind, then time).
 */
export function queueOrder(cards: readonly DueCard[]): DueCard[] {
  return cards
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || (rank(a.c) === 1 ? a.c.at - b.c.at : 0) || a.i - b.i)
    .map((x) => x.c);
}

/**
 * Keys answered or closed on this Mac, held back until a moment passes:
 * the answer is in Coach/nudges.json by then (read back), or, when that
 * write failed, the card waits as if snoozed instead of coming back every
 * minute.
 */
export class HeldKeys {
  private readonly until = new Map<string, number>();

  hold(key: string, untilMs: number): void {
    this.until.set(key, Math.max(untilMs, this.until.get(key) ?? 0));
  }

  held(key: string, nowMs: number): boolean {
    const t = this.until.get(key);
    if (t === undefined) return false;
    if (nowMs < t) return true;
    this.until.delete(key);
    return false;
  }

  release(key: string): void {
    this.until.delete(key);
  }

  /** The first due card not held back, in queue order. */
  next(cards: readonly DueCard[], nowMs: number, skip: ReadonlySet<string> = new Set()): DueCard | null {
    return queueOrder(cards).find((c) => !skip.has(c.key) && !this.held(c.key, nowMs)) ?? null;
  }
}

/** How long an answered card is held back on this Mac: long enough for the next look to read the answer. */
export const HOLD_MS = 2 * 60_000;
