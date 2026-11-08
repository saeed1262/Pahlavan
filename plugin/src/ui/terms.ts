// The plan's words in plain language, where the screens use them: a tooltip
// line beside "Mesocycle", "Short" and "Light week". Pahlavan says "light
// week" for what the rules call a deload.

/** A mesocycle: the plan's block of weeks that ends in a light week. */
export const MESOCYCLE = 'A mesocycle is a block of normal weeks that ends in a light week (4 weeks unless your plan says otherwise)';
/** The plan's shorter sessions beside the lifting ones. */
export const SHORT = 'Short sessions are the plan’s shorter days (skills, mobility or conditioning) between the lifting days';
/** The light week (the rules' deload): what it does is the plan's rule, which the screens quote beside it. */
export const LIGHT_WEEK = 'A light week: fewer sets and a lighter load, so your body catches up; your plan says which weeks and how light';

/**
 * The dashboard's own words, ported word for word (its reminders and its
 * copied plan), with Pahlavan's word for the deload: "Deload week" and
 * "Deload" read "Light week", "deload" reads "light week".
 */
export function lightWords(text: string): string {
  return text.replace(/\bDeload week\b/g, 'Light week').replace(/\bDeload\b/g, 'Light week').replace(/\bdeload week\b/g, 'light week').replace(/\bdeload\b/g, 'light week');
}
