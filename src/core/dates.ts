// Calendar dates are ISO `YYYY-MM-DD` strings. Day arithmetic runs on UTC day
// numbers, so no time zone or clock ever enters a result. "Today" is always an
// argument, never read here.

export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** True for a real calendar date in `YYYY-MM-DD` form (years 1000-9999). */
export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string') return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1000) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Whole days since 1970-01-01. Throws on a malformed date. */
export function dayNumber(date: IsoDate): number {
  if (!isIsoDate(date)) throw new RangeError(`not an ISO date (YYYY-MM-DD): ${String(date)}`);
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / DAY_MS;
}

/** `to` minus `from`, in days. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return dayNumber(to) - dayNumber(from);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** The Monday on or before the date. */
export function mondayOf(date: IsoDate): IsoDate {
  const weekday = (new Date(dayNumber(date) * DAY_MS).getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(date, -weekday);
}

/** The Monday-to-Sunday week holding the date. */
export function weekOf(date: IsoDate): { from: IsoDate; to: IsoDate } {
  const from = mondayOf(date);
  return { from, to: addDays(from, 6) };
}

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A date for people, in every note and question: "Mon 6 Apr". ISO dates stay in inputs and values. */
export function dayText(date: IsoDate): string {
  return `${WD[daysBetween(mondayOf(date), date)]} ${Number(date.slice(8, 10))} ${MO[Number(date.slice(5, 7)) - 1]}`;
}
