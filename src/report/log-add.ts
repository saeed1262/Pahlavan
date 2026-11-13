// `engine log add`'s session entry, shared with the phone's inbox (a session
// sent at Every set): the input's every-set shape checked, the entry built
// by the log writer (the original log script's checks and fields), and for a
// planned session its checklist and exercise list frozen as the Log panel's
// save writes them, the skipped lines marked with their reasons, every
// set's exercise checked against the session's items. Pure: today comes in.

import { buildLogEntry, type LogInput } from '../adapters/vault/log-write.ts';
import type { VaultRead } from '../adapters/vault/read.ts';
import { dayText, type IsoDate } from '../core/dates.ts';
import { exerciseId } from '../core/plan-data.ts';
import { SKIP_REASONS } from '../core/schema.ts';
import { frozenList } from './log-form.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `log add`'s input: the log writer's, with the checklist lines skipped by name and why each was. */
export type LogAddInput = LogInput & { skipped?: unknown; skipWhy?: unknown };

/**
 * `log add`'s every-set fields, checked before the entry is built: the
 * tracking "standard" or "full", `exerciseSets` (only with "full", and
 * "full" only with it) a list of {name, planned?, sets}, each set's reps a
 * whole number 0 or more, its weight 0 or more (left out for bodyweight),
 * its unit lb or kg, its RIR 0 to 10. Null when it is fine, else what is
 * wrong.
 */
export function everySetShape(input: Obj): string | null {
  const t = input['trackingLevel'];
  if (t !== undefined && t !== null && t !== 'standard' && t !== 'full') return `"trackingLevel" is "standard" or "full", not ${JSON.stringify(t)}`;
  const xs = input['exerciseSets'];
  if (xs === undefined || xs === null) return t === 'full' ? '"trackingLevel": "full" needs "exerciseSets", every exercise\'s sets: [{"name", "sets": [{"weight", "reps", "rir"}]}]' : null;
  if (t !== 'full') return '"exerciseSets" needs "trackingLevel": "full"';
  if (!Array.isArray(xs)) return '"exerciseSets" is a list: [{"name", "sets": [{"weight", "reps", "rir"}]}]';
  for (const [i, x] of xs.entries()) {
    if (!isObj(x) || typeof x['name'] !== 'string' || !x['name'].trim()) return `exerciseSets item ${i + 1} needs a "name"`;
    const name = x['name'].trim();
    const pl = x['planned'];
    if (pl !== undefined && pl !== null && (typeof pl !== 'string' || !pl.trim())) return `${name}: "planned" names the plan's exercise it replaces`;
    if (!Array.isArray(x['sets'])) return `${name}: "sets" is a list of sets, [{"weight", "reps", "rir"}]`;
    for (const [j, y] of (x['sets'] as unknown[]).entries()) {
      const at = `${name}, set ${j + 1}`;
      if (!isObj(y)) return `${at}: a set is {"weight", "unit", "reps", "rir"}`;
      const r = y['reps'];
      if (typeof r !== 'number' || !Number.isInteger(r) || r < 0) return `${at}: reps is a whole number, 0 or more`;
      const w = y['weight'];
      if (w !== undefined && w !== null && (typeof w !== 'number' || !Number.isFinite(w) || w < 0)) return `${at}: weight is a number, 0 or more (left out for bodyweight)`;
      const u = y['unit'];
      if (u !== undefined && u !== null && u !== 'lb' && u !== 'kg') return `${at}: unit is lb or kg`;
      const rir = y['rir'];
      if (rir !== undefined && rir !== null && (typeof rir !== 'number' || !Number.isFinite(rir) || rir < 0 || rir > 10)) return `${at}: RIR is 0 to 10`;
    }
  }
  return null;
}

/**
 * `log add`'s every-set names against the session: each exercise is one of
 * the plan's items that day (the frozen list, the plan's own names, a
 * ladder's level), a lift or swap the entry names, or a swap that names the
 * plan's item as `planned`. A logged lift with a top set has its sets in
 * the list too: at "full" every set is listed, its heaviest the top set.
 * Null when they match, else what is wrong.
 */
export function everySetNames(read: VaultRead, entry: Obj, frozen: readonly { name: string }[]): string | null {
  const xs = Array.isArray(entry['exerciseSets']) ? (entry['exerciseSets'] as { name: string; planned?: string }[]) : [];
  if (!xs.length) return null;
  const type = String(entry['type']);
  const plan = read.raw?.plan;
  const items = isObj(plan) && isObj(plan['sessions']) && Array.isArray(plan['sessions'][type]) ? (plan['sessions'][type] as unknown[]).filter(isObj).map((x) => String(x['name'])) : [];
  const planned = new Set([...frozen.map((x) => x.name), ...items].map(exerciseId));
  const lifts = (['lift1', 'lift2'] as const).map((k) => entry[k]).filter(isObj);
  const done = new Set([...lifts.map((l) => String(l['name'])), ...(Array.isArray(entry['swaps']) ? (entry['swaps'] as Obj[]).filter(isObj).map((x) => String(x['to'])) : [])].map(exerciseId));
  for (const x of xs) {
    if (x.planned) {
      if (!planned.has(exerciseId(x.planned))) return `${x.name}: "planned" ${x.planned} is not an item of ${type} on ${dayText(String(entry['date']))}; its items: ${frozen.map((f) => f.name).join('; ')}`;
    } else if (!planned.has(exerciseId(x.name)) && !done.has(exerciseId(x.name))) {
      return `${x.name} is not an item of ${type} on ${dayText(String(entry['date']))} (a swap names the plan's item as "planned"); its items: ${frozen.map((f) => f.name).join('; ')}`;
    }
  }
  const listed = new Set(xs.map((x) => exerciseId(x.name)));
  for (const k of ['lift1', 'lift2'] as const) {
    const l = entry[k];
    if (isObj(l) && (Number(l['weight']) > 0 || Number(l['reps']) > 0) && !listed.has(exerciseId(String(l['name'])))) return `${k} ${String(l['name'])} has a top set but no sets in "exerciseSets": at "full" every set is listed there, the heaviest is the top set`;
  }
  return null;
}

/**
 * `skipWhy`'s shape: by a skipped line's name, why it was skipped (time,
 * pain, equipment or energy, the Log panel's reasons). Null when it is fine
 * (or not given), else what is wrong.
 */
function skipWhyShape(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (!isObj(v)) return `"skipWhy" gives each skipped line's reason by its name: {"<line>": "${SKIP_REASONS.join('" | "')}"}`;
  for (const [k, r] of Object.entries(v)) {
    if (typeof r !== 'string' || !(SKIP_REASONS as readonly string[]).includes(r)) return `"skipWhy" for ${k} is ${JSON.stringify(r)}: a skip's reason is ${SKIP_REASONS.slice(0, -1).join(', ')} or ${SKIP_REASONS.at(-1)}`;
  }
  return null;
}

/**
 * The session entry `log add` writes, as the Log panel's save writes it:
 * the every-set fields checked, `buildLogEntry`'s entry (the script's
 * checks, with its messages), then for a planned session the checklist
 * (its lines, the skipped ones marked, each with its reason from
 * `skipWhy`) and the exercise list frozen from the plan as it reads that
 * day, and every set's exercise one of the session's. An error says what is
 * wrong; nothing is merged here.
 */
export function logAddEntry(read: VaultRead, input: LogAddInput, today: IsoDate): { ok: true; entry: Obj } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  const shape = everySetShape(input as Obj);
  if (shape) return fail(shape);
  const built = buildLogEntry(input, { plan: read.raw?.plan, log: read.raw?.log, today });
  if (!built.ok) return built;
  let entry = built.entry;
  const why = skipWhyShape(input.skipWhy);
  if (why) return fail(why);
  const reasons = (input.skipWhy ?? {}) as Record<string, string>;
  // The checklist the Log panel saves with a planned session: its lines, the skipped ones marked (a custom session has none).
  if (entry['type'] !== 'custom') {
    const skipped = input.skipped;
    if (skipped !== undefined && (!Array.isArray(skipped) || !skipped.every((x) => typeof x === 'string'))) return fail('"skipped" lists the checklist lines skipped, by name');
    const swapOf = (l: unknown) => (typeof l === 'object' && l !== null && (l as Obj)['planned'] ? String((l as Obj)['name']) : null);
    const fz = frozenList(read, { date: String(entry['date']), type: String(entry['type']), mode: entry['express'] ? 'express' : entry['hotel'] ? 'hotel' : 'full', lifts: [swapOf(entry['lift1']), swapOf(entry['lift2'])], skip: skipped ?? [], why: reasons }, today);
    if (!fz.ok) return fz;
    const names = everySetNames(read, entry, fz.list.value.exercises);
    if (names) return fail(names);
    const checklist = (fz.list.value as unknown as Obj)['checklist'];
    if (checklist) {
      // The exercise list as the Log panel's save freezes it: the same list, with the day's working sets.
      const { exercises, ...rest } = entry;
      entry = { ...rest, checklist, ...(exercises !== undefined ? { exercises: fz.list.value.exercises } : {}) };
    }
  } else if (Object.keys(reasons).length) return fail('"skipWhy" goes with a planned session\'s skipped lines: a custom session has no checklist');
  return { ok: true, entry };
}
