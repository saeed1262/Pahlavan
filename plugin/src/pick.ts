// The user's pick of session is remembered for one day: the settings keep
// the date with the type, and any other day reads as no pick.

export interface SessionPickSetting {
  date: string;
  type: string;
}

/** The picked session type for `date`, or null (no pick, or one from another day). */
export function pickFor(pick: SessionPickSetting | null | undefined, date: string): string | null {
  return pick && pick.date === date && pick.type ? pick.type : null;
}

/** The setting after choosing `type` on `date`; null (back to the suggestion) clears it. */
export function choosePick(type: string | null, date: string): SessionPickSetting | null {
  return type ? { date, type } : null;
}

/**
 * Today's swaps chosen on Today's chips, by the plan's item: remembered for
 * one day like the pick, and the Log panel starts with them.
 */
export interface SwapsSetting {
  date: string;
  by: Record<string, string>;
}

/** The swaps chosen for `date` (none from another day). */
export function swapsFor(s: SwapsSetting | null | undefined, date: string): Record<string, string> {
  return s && s.date === date ? { ...s.by } : {};
}

/** The setting after choosing `to` in place of the plan's `item` on `date`; null undoes it (no swaps left: null). */
export function chooseSwap(s: SwapsSetting | null | undefined, date: string, item: string, to: string | null): SwapsSetting | null {
  const by = swapsFor(s, date);
  if (to) by[item] = to;
  else delete by[item];
  return Object.keys(by).length ? { date, by } : null;
}
