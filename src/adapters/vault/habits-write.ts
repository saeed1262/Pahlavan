// A tracked item's ticks and amounts into its linked habit, in
// habits-data.json: the same keys the homepage grid reads and writes
// (hab-<id>-<ISO year>-W<week>-<day, 0 = Monday>), the same values ("1" for
// a tick; the amount as a number, written as the grid writes it). Only the
// changed keys move; every other key, habit and setting stays. Amounts can
// be added as deltas, so water logged on the other Mac meanwhile is kept
// (as Habit Nudges does). Pure: the plugin reads and writes the file.

import { isIsoDate } from '../../core/dates.ts';
import type { IsoDate } from '../../core/schema.ts';
import { habitCheckinKey } from '../../core/tracking.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const pretty = (o: unknown) => JSON.stringify(o, null, 2);
const round2 = (n: number) => Math.round(n * 100) / 100;

export { habitCheckinKey };

/** A tick (true sets "1", false removes it), an amount to set (null removes it), or an amount to add (a delta, never below 0). */
export type HabitChange =
  | { habit: string; date: IsoDate; tick: boolean }
  | { habit: string; date: IsoDate; value: number | null }
  | { habit: string; date: IsoDate; add: number };

export type HabitMerge =
  | { result: 'merged'; text: string; changed: { key: string; from: string | null; to: string | null }[]; skipped: { habit: string; why: string }[] }
  | { result: 'unchanged'; skipped: { habit: string; why: string }[] }
  | { result: 'unreadable'; error: string };

/**
 * habits-data.json with the changes applied. A habit the file does not list,
 * or a tick for an amount habit (and the other way round), is skipped with
 * the reason; the rest still apply. A missing or unreadable file is never
 * created or overwritten: the homepage owns it.
 */
/**
 * A vault's first habits-data.json (it had none: no habits page made one):
 * the two habits Pahlavan and the engine read, Workout (a session's tick)
 * and Protein (the eating plan's tick), with no check-ins yet.
 */
export const FRESH_HABITS = { habits: [{ id: 'workout', name: 'Workout', type: 'binary', max: 1 }, { id: 'protein', name: 'Protein', type: 'binary', max: 1 }], checkins: {} } as const;

/** The file's text, or a fresh one when the vault has none (never in place of a file that is there). */
export const habitsTextOr = (text: string | null): string => text ?? JSON.stringify(FRESH_HABITS);

export function mergeHabitChanges(text: string | null, changes: readonly HabitChange[]): HabitMerge {
  let doc: unknown;
  try {
    doc = JSON.parse(habitsTextOr(text));
  } catch {
    return { result: 'unreadable', error: 'habits-data.json is not valid JSON (an unresolved git conflict?)' };
  }
  if (!isObj(doc) || !Array.isArray(doc['habits'])) return { result: 'unreadable', error: 'habits-data.json has no habits list' };
  const habits = (doc['habits'] as unknown[]).filter(isObj);
  const checkins = isObj(doc['checkins']) ? doc['checkins'] : (doc['checkins'] = {});
  const changed: { key: string; from: string | null; to: string | null }[] = [];
  const skipped: { habit: string; why: string }[] = [];
  for (const c of changes) {
    const def = habits.find((h) => h['id'] === c.habit);
    if (!def) {
      skipped.push({ habit: c.habit, why: `no habit "${c.habit}" in habits-data.json` });
      continue;
    }
    if (!isIsoDate(c.date)) {
      skipped.push({ habit: c.habit, why: `${c.date} is not a date` });
      continue;
    }
    const numeric = def['type'] === 'numeric';
    const key = habitCheckinKey(c.habit, c.date);
    const from = checkins[key] === undefined || checkins[key] === null ? null : String(checkins[key]);
    let to: string | null;
    if ('tick' in c) {
      if (numeric) {
        skipped.push({ habit: c.habit, why: `${String(def['name'] ?? c.habit)} counts an amount, not a tick` });
        continue;
      }
      to = c.tick ? '1' : null;
    } else {
      if (!numeric) {
        skipped.push({ habit: c.habit, why: `${String(def['name'] ?? c.habit)} is a tick, not an amount` });
        continue;
      }
      if ('add' in c) {
        if (!Number.isFinite(c.add)) {
          skipped.push({ habit: c.habit, why: 'the amount to add is not a number' });
          continue;
        }
        to = String(Math.max(0, round2((parseFloat(from ?? '0') || 0) + c.add)));
      } else {
        if (c.value !== null && (!Number.isFinite(c.value) || c.value < 0)) {
          skipped.push({ habit: c.habit, why: 'the amount is not a number of 0 or more' });
          continue;
        }
        to = c.value === null ? null : String(round2(c.value));
      }
    }
    if (from === to) continue;
    if (to === null) delete checkins[key];
    else checkins[key] = to;
    changed.push({ key, from, to });
  }
  if (!changed.length) return { result: 'unchanged', skipped };
  return { result: 'merged', text: pretty(doc), changed, skipped };
}

/** Whether the read-back file holds what the merge wrote (each changed key at its new value). */
export function habitsLanded(text: string | null, changed: readonly { key: string; to: string | null }[]): boolean {
  if (text === null) return false;
  try {
    const doc = JSON.parse(text) as { checkins?: Record<string, unknown> };
    return changed.every((c) => (doc.checkins?.[c.key] === undefined ? null : String(doc.checkins[c.key])) === c.to);
  } catch {
    return false;
  }
}
