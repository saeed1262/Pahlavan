// Local time for the reminder rules, without reading a clock or a time zone.
// The caller (the plugin, or the CLI's Node entry) turns the real clock into
// a `Moment`: the local date, the minutes since local midnight and the epoch
// milliseconds. Times of day are "HH:MM" strings; moments in files are ISO
// timestamps in UTC. A local day boundary is the caller's too: a `DayClock`
// says where the local day holding a moment starts.

import { addDays, type IsoDate } from './dates.ts';

/** Now, as the caller's clock reads it: the local date, minutes since local midnight (with seconds as a fraction), and epoch ms. */
export interface Moment {
  date: IsoDate;
  minutes: number;
  ms: number;
}

/** Where local days start and which local date a moment falls on (the plugin passes the Mac's own). */
export interface DayClock {
  /** The epoch ms of the local midnight that starts the day holding `ms`. */
  dayStart(ms: number): number;
  /** The local date holding `ms`. */
  dayOf(ms: number): IsoDate;
}

const DAY_MS = 86_400_000;
const HHMM = /^(\d{1,2}):(\d{2})$/;

/** "09:30" as minutes since midnight; null when it is not a time. */
export function toMinutes(hhmm: string | undefined | null): number | null {
  const m = HHMM.exec(String(hhmm ?? ''));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Minutes since midnight as "HH:MM" (whole minutes, rounded down). */
export function hhmm(minutes: number): string {
  const m = Math.floor(minutes);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** The epoch ms of a local time today, from `now` (exact unless a clock change falls between the two). */
export function msAt(now: Moment, minutes: number): number {
  return now.ms + (minutes - now.minutes) * 60_000;
}

/** The local minutes of a moment today, from `now` (the inverse of msAt). */
export function minutesAt(now: Moment, ms: number): number {
  return now.minutes + (ms - now.ms) / 60_000;
}

/** A timestamp as epoch ms; null when it does not parse. */
export function parseTs(ts: string | undefined | null): number | null {
  if (typeof ts !== 'string') return null;
  const v = Date.parse(ts);
  return Number.isFinite(v) ? v : null;
}

/** Epoch ms as the ISO timestamp the files hold. */
export function toTs(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * A clock for a fixed offset from UTC (minutes east, so UTC-5 is -300): the
 * tests' and the CLI's stand-in for a real time zone. The plugin passes the
 * Mac's own, which follows daylight saving.
 */
export function fixedOffsetClock(offsetMinutes: number): DayClock {
  const off = offsetMinutes * 60_000;
  return {
    dayStart: (ms) => Math.floor((ms + off) / DAY_MS) * DAY_MS - off,
    dayOf: (ms) => new Date(Math.floor((ms + off) / DAY_MS) * DAY_MS).toISOString().slice(0, 10),
  };
}

/** The moment at a local date and time on a fixed-offset clock. */
export function momentAt(date: IsoDate, time: string | number, offsetMinutes = 0): Moment {
  const minutes = typeof time === 'number' ? time : (toMinutes(time) ?? 0);
  const midnight = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return { date, minutes, ms: midnight + minutes * 60_000 - offsetMinutes * 60_000 };
}

/** The day before a date. */
export const yesterday = (date: IsoDate): IsoDate => addDays(date, -1);
