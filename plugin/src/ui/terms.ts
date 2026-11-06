// The plan's words in plain language, where the screens use them: a tooltip
// line beside "Mesocycle", "Short" and "Light week". Pahlavan says "light
// week" for what the rules call a deload.

/** A mesocycle: the plan's 4-week block. */
export const MESOCYCLE = 'A mesocycle is a 4-week block: three normal weeks, then a light week';
/** The plan's shorter sessions beside the lifting ones. */
export const SHORT = 'Short sessions are the plan’s shorter days (skills, mobility or conditioning) between the lifting days';
/** The light week (the rules' deload). */
export const LIGHT_WEEK = 'A light week: two sets of everything, about 10 % lighter, so your body catches up; every fourth week';

/**
 * The dashboard's own words, ported word for word (its reminders and its
 * copied plan), with Pahlavan's word for the deload: "Deload week" and
 * "Deload" read "Light week", "deload" reads "light week".
 */
export function lightWords(text: string): string {
  return text.replace(/\bDeload week\b/g, 'Light week').replace(/\bDeload\b/g, 'Light week').replace(/\bdeload week\b/g, 'light week').replace(/\bdeload\b/g, 'light week');
}
