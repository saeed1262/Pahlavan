// Dates and numbers as the view writes them ("Fri 10 Apr", "70 kg", "−0.91").
// ISO dates are parsed as UTC days, as the engine does.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const at = (iso: string) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));

export const fmt = {
  day: (d: string) => `${at(d).getUTCDate()} ${MONTHS[at(d).getUTCMonth()]}`,
  dayLong: (d: string) => `${DAYS_LONG[at(d).getUTCDay()]} ${at(d).getUTCDate()} ${MONTHS_LONG[at(d).getUTCMonth()]}`,
  wd: (d: string) => `${DAYS[at(d).getUTCDay()]} ${at(d).getUTCDate()} ${MONTHS[at(d).getUTCMonth()]}`,
  dow: (d: string) => DAYS[at(d).getUTCDay()]!,
  /** A signed number with a true minus sign. */
  signed: (v: number, dp = 2) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(dp),
  num: (v: number, dp = 1) => String(Math.round(v * 10 ** dp) / 10 ** dp),
  w: (w: number, unit: string) => `${Math.round(w * 100) / 100} ${unit}`,
  /** Fractional sets to one decimal (6.25 reads 6.3). */
  sets: (v: number) => String(Math.round(v * 10) / 10),
  month: (d: string) => MONTHS[at(d).getUTCMonth()]!,
};

/** The plan's titles use em-dashes ("Full Body A — Squat"); the view writes a middle dot instead. */
export const clean = (text: string | null | undefined): string => (text == null ? '' : String(text).replace(/\s*—\s*/g, ' · '));

export function addDays(iso: string, n: number): string {
  return new Date(at(iso).getTime() + n * 864e5).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((at(b).getTime() - at(a).getTime()) / 864e5);
}

/** The top bar's week: "Week 6 of 24" from the plan's length, or past its end "Week 26, after the plan's 24". */
export function weekOfText(week: number, weeks: number | null | undefined): string {
  if (!weeks) return `Week ${week}`;
  return week <= weeks ? `Week ${week} of ${weeks}` : `Week ${week}, after the plan’s ${weeks}`;
}
