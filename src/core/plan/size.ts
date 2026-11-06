// Step 2: size the week to reality (planning.md). Planned training days are
// the stated days, or with opted-in history the smaller of the stated days
// and the last 4 weeks' confirmed sessions + 1. Two weeks running under 70 %
// of the old target resize it, never upward.

import { adherence } from '../adherence.ts';
import { explain, joinNotes, type Result } from '../reason.ts';
import type { PlanContext } from './context.ts';

export const SIZING = { resizeBelow: 0.7, resizeWeeks: 2, extraOverConfirmed: 1 } as const;

export interface WeekSize {
  stated: number;
  /** Training days a week after sizing (lifting plus any extra days). */
  days: number;
  minutes: number;
  /** Confirmed sessions a week over the last 4 weeks (logged plus confirmed unlogged), when history is used. */
  confirmed: number | null;
  resized: boolean;
  /** The profile's short days: lifting goes on the long days (`longDays`), conditioning on the short ones. */
  shortMinutes: number | null;
  longDays: number;
}

export function sizeWeek(ctx: PlanContext): Result<WeekSize> {
  const stated = Math.min(7, ctx.profile.availability.daysPerWeek);
  const minutes = ctx.profile.availability.minutesPerSession;
  const short = ctx.profile.availability.shortSessions;
  const rule = 'plan.size';
  const shortOf = (days: number) => {
    if (!short) return { shortMinutes: null, longDays: days };
    const shortDays = Math.min(short.days, Math.max(0, days - 1));
    return { shortMinutes: short.minutes, longDays: days - shortDays };
  };
  const shortNote = (days: number) => {
    if (!short) return undefined;
    const s = shortOf(days);
    return `${days - s.longDays} of the ${days} days are ${short.minutes} min (the profile's short days): lifting goes on the ${s.longDays} long day(s) of ${minutes} min, conditioning on the short ones.`;
  };
  if (!ctx.history) {
    return explain<WeekSize>({ stated, days: stated, minutes, confirmed: null, resized: false, ...shortOf(stated) }, rule, { stated, minutes, history: false, shortSessions: short ?? null }, {
      note: joinNotes(`${stated} days of ${minutes} min, from the stated availability${ctx.profile.useHistory ? ' (no history given)' : ' (history not used)'}.`, shortNote(stated)),
    });
  }
  const h = ctx.history;
  const target = h.previousTarget ?? { lift: stated, short: 0 };
  const a = adherence({ sessions: h.sessions, today: ctx.today, target, daily: h.daily ?? [], weekly: h.weekly ?? [] }).value;
  const perWeek = a.weeks.map((w) => w.lift + w.short + w.custom + w.confirmedUnlogged);
  const confirmed = perWeek.reduce((x, y) => x + y, 0) / perWeek.length;
  const sized = Math.min(stated, Math.floor(confirmed + 0.5) + SIZING.extraOverConfirmed);
  const planned = target.lift + target.short;
  const lastTwo = perWeek.slice(-SIZING.resizeWeeks);
  const resized = planned > 0 && lastTwo.every((n) => n / planned < SIZING.resizeBelow);
  const days = Math.max(1, resized ? Math.min(sized, planned) : sized);
  return explain<WeekSize>(
    { stated, days, minutes, confirmed, resized, ...shortOf(days) },
    rule,
    { stated, minutes, confirmedPerWeek: perWeek, previousTarget: target, shortSessions: short ?? null },
    {
      threshold: { extraOverConfirmed: SIZING.extraOverConfirmed, resizeBelow: SIZING.resizeBelow, resizeWeeks: SIZING.resizeWeeks },
      note: joinNotes(
        `Confirmed sessions over the last 4 weeks: ${confirmed.toFixed(2)} a week; planned = min(${stated} stated, ${Math.floor(confirmed + 0.5)} + 1) = ${sized}.`,
        resized && `Two weeks running under 70 % of the ${planned}-session target: resize to ${days}, never more sessions.`,
        shortNote(days),
      ),
    },
  );
}
