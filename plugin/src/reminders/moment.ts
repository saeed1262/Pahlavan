// The Mac's own clock for the reminder rules: the engine takes a `Moment`
// (the local date, minutes since local midnight, epoch ms) and a `DayClock`
// (where a local day starts), never a clock of its own. This file turns a
// JavaScript Date into those, in the Mac's time zone (daylight saving
// included), and gives this Mac a name for Coach/sitting.json and the
// answers' `by`. No Obsidian import.

import type { DayClock, Moment } from '../../../src/core/clock.ts';
import { MAC_NAME } from '../../../src/core/validate.ts';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Now (or `ms`) as the reminder rules read it, on this Mac's clock. */
export function localMoment(ms: number = Date.now()): Moment {
  const d = new Date(ms);
  return { date: ymd(d), minutes: d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60, ms };
}

/** Local days on this Mac: a day starts at its real local midnight. */
export const localClock: DayClock = {
  dayStart(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  },
  dayOf(ms) {
    return ymd(new Date(ms));
  },
};

/** "HH:MM" of a moment on this Mac's clock. */
export function localTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * A name for this Mac that fits Coach/sitting.json's pattern: the host name
 * without ".local", other characters dropped, at most 64 long. "This Mac"
 * when nothing usable is left.
 */
export function macName(raw: string | null | undefined): string {
  const base = String(raw ?? '').trim().replace(/\.local$/i, '').replace(/[^A-Za-z0-9 ._-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[^A-Za-z0-9]+/, '').slice(0, 64).trim();
  return MAC_NAME.test(base) ? base : 'This Mac';
}
