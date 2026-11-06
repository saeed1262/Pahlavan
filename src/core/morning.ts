// The morning check-in's fields, their limits and their words, in one place
// for every writer and checker: the Check-in screen's and the morning card's
// merge (adapters/vault/body-write.ts re-exports them), the phone's morning
// entry (validate.ts) and what the phone's shortcuts read (phone.json). The
// limits are Habit Nudges', so both plugins accept the same values.

/** The fields, in the card's order. */
export const MORNING_KEYS = ['energy', 'soreness', 'sleepQ', 'sleepH', 'rhr', 'weight', 'steps', 'floors'] as const;
export type MorningKey = (typeof MORNING_KEYS)[number];

/** Habit Nudges' limits for the same fields, so both writers accept the same values. Weight is in kg, as body-data.json holds it. */
export const MORNING_LIMITS: Record<MorningKey, { min: number; max: number; int: boolean; label: string }> = {
  energy: { min: 1, max: 5, int: true, label: 'Energy' },
  soreness: { min: 1, max: 5, int: true, label: 'Soreness' },
  sleepQ: { min: 1, max: 5, int: true, label: 'Sleep quality' },
  sleepH: { min: 0, max: 16, int: false, label: 'Sleep' },
  rhr: { min: 30, max: 120, int: true, label: 'Resting HR' },
  weight: { min: 30, max: 250, int: false, label: 'Weight' },
  steps: { min: 0, max: 100000, int: true, label: 'Steps yesterday' },
  floors: { min: 0, max: 500, int: true, label: 'Floors yesterday' },
};

/** The morning card's own questions: Health's numbers (sleep hours, resting HR, weight, steps) can come from elsewhere. */
export const MORNING_QUESTIONS = ['energy', 'soreness', 'sleepQ'] as const satisfies readonly MorningKey[];

/**
 * The morning check-in is done for a day (body-data.json's day entry) when
 * its `checkedAt` is set or one of the card's own questions (energy,
 * soreness, sleep quality) is answered; numbers alone, from the phone's
 * Health entry or the coach's `body`, are not a check-in (0.9.1's rule).
 * Due today, the morning card, Check-in's At a glance, the banner's week and
 * the phone's summary all read this one rule.
 */
export function isMorningDone(day: unknown): boolean {
  if (typeof day !== 'object' || day === null || Array.isArray(day)) return false;
  const d = day as Record<string, unknown>;
  return (typeof d['checkedAt'] === 'string' && d['checkedAt'] !== '') || MORNING_QUESTIONS.some((k) => typeof d[k] === 'number');
}

/** The fields filed under the day before: a day's steps and floors are only complete once it's over. */
export const YESTERDAY_KEYS: readonly MorningKey[] = ['steps', 'floors'];

/** What each field reads in, and the scales' two ends, as the morning card words them. */
export const MORNING_WORDS: Record<MorningKey, { unit?: string; lo?: string; hi?: string }> = {
  energy: { lo: 'Flat', hi: 'Great' },
  soreness: { lo: 'None', hi: 'Very sore' },
  sleepQ: { lo: 'Poor', hi: 'Great' },
  sleepH: { unit: 'h' },
  rhr: { unit: 'bpm' },
  weight: { unit: 'kg' },
  steps: {},
  floors: {},
};
