// Soreness per muscle, from the morning body map (DailyCheckin.soreMuscles):
// for today's session, an exercise whose main muscle is sore gets one set
// fewer and RIR +1, or a lighter swap when that muscle has been sore two days
// running; a mildly sore muscle only adds a note. The count of sore days per
// muscle feeds the per-muscle volume feedback at the mesocycle review.

import { MUSCLES } from './data/muscles.ts';
import { addDays } from './dates.ts';
import { explain, joinNotes, type Result } from './reason.ts';
import type { DailyCheckin, Exercise, ExerciseSlot, IsoDate, SorenessLevel } from './schema.ts';

export const SORENESS = {
  /** Sore on this many days running, today included, calls for a lighter swap. */
  swapAfterDays: 2,
  setsDrop: 1,
  rirAdd: 1,
} as const;

const label = (m: string) => MUSCLES.find((x) => x.id === m)?.label ?? m;
const list = (ms: readonly string[]) => ms.map(label).join(', ');

/** The sore muscles on a date's check-in, or {} when that day has no body map. */
export function soreOn(daily: readonly DailyCheckin[], date: IsoDate): Record<string, SorenessLevel> {
  return daily.find((d) => d.date === date)?.soreMuscles ?? {};
}

export type SorenessAction = 'none' | 'note' | 'trim' | 'swap';

export interface SorenessAdjustment {
  action: SorenessAction;
  /** Main muscles of the exercise that are sore today, with their level. */
  muscles: Record<string, SorenessLevel>;
  exercise: string;
  sets: number;
  rir: number;
}

/**
 * Today's adjustment for one slot. `lighter` is an easier variation the
 * caller found (equipment and Ledger checked); without one, a muscle sore two
 * days running gets the trim instead.
 */
export function sorenessForSlot(
  slot: ExerciseSlot,
  exercises: Readonly<Record<string, Exercise>>,
  daily: readonly DailyCheckin[],
  date: IsoDate,
  opts: { lighter?: { id: string; name: string } | null; name?: (id: string) => string } = {},
): Result<SorenessAdjustment> {
  const today = soreOn(daily, date);
  const yesterday = soreOn(daily, addDays(date, -1));
  const main = exercises[slot.exercise]?.muscles?.main ?? [];
  const hit: Record<string, SorenessLevel> = {};
  for (const m of main) if (today[m]) hit[m] = today[m]!;
  const sore = Object.keys(hit).filter((m) => hit[m] === 'sore');
  const mild = Object.keys(hit).filter((m) => hit[m] === 'mild');
  const running = sore.filter((m) => yesterday[m] === 'sore');
  const name = opts.name?.(slot.exercise) ?? exercises[slot.exercise]?.name ?? slot.exercise;
  const base = { muscles: hit, exercise: slot.exercise, sets: slot.sets, rir: slot.rir };
  const inputs = { date, exercise: slot.exercise, mainMuscles: main, today, yesterday };
  const threshold = { swapAfterDays: SORENESS.swapAfterDays, setsDrop: SORENESS.setsDrop, rirAdd: SORENESS.rirAdd };
  if (running.length && opts.lighter) {
    return explain<SorenessAdjustment>({ ...base, action: 'swap', exercise: opts.lighter.id }, 'soreness.swap', inputs, {
      threshold,
      note: `${list(running)} sore two days running: ${opts.lighter.name} in place of ${name} today, same sets and RIR.`,
    });
  }
  if (sore.length) {
    const sets = Math.max(1, slot.sets - SORENESS.setsDrop);
    return explain<SorenessAdjustment>({ ...base, action: 'trim', sets, rir: slot.rir + SORENESS.rirAdd }, 'soreness.trim', inputs, {
      threshold,
      note: joinNotes(
        `${list(sore)} sore today: ${name} at ${sets} set(s), RIR ${slot.rir + SORENESS.rirAdd}.`,
        running.length > 0 && 'Sore two days running, but no lighter variation passes the equipment and Ledger checks: trimmed instead.',
      ),
    });
  }
  if (mild.length) {
    return explain<SorenessAdjustment>({ ...base, action: 'note' }, 'soreness.note', inputs, {
      threshold,
      note: `${list(mild)} mildly sore: ${name} as planned; ease off if it hurts rather than tires (the pain rule).`,
    });
  }
  return explain<SorenessAdjustment>({ ...base, action: 'none' }, 'soreness.none', inputs, { threshold });
}

/** Sore days per muscle between two dates (inclusive), by level: the mesocycle review's per-muscle input. */
export function soreDays(daily: readonly DailyCheckin[], from: IsoDate, to: IsoDate): Result<Record<string, { mild: number; sore: number }>> {
  const out: Record<string, { mild: number; sore: number }> = {};
  let days = 0;
  for (const d of daily) {
    if (d.date < from || d.date > to || !d.soreMuscles) continue;
    days++;
    for (const [m, level] of Object.entries(d.soreMuscles)) {
      out[m] ??= { mild: 0, sore: 0 };
      out[m]![level]++;
    }
  }
  const worst = Object.entries(out).sort((a, b) => b[1].sore - a[1].sore || b[1].mild - a[1].mild)[0];
  return explain(out, 'soreness.days', { from, to, bodyMapDays: days }, {
    note: days === 0 ? 'No body-map check-ins in the range.' : worst ? `${days} body-map check-in(s); the most often sore: ${label(worst[0])} (${worst[1].sore} sore, ${worst[1].mild} mild).` : `${days} body-map check-in(s), nothing sore.`,
  });
}
