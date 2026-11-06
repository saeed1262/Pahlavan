// The coach's write path into body-data.json (`body`): one date's morning
// fields, tape and tests, so the intake records its measurements as the
// cycle's first entries. Through the plugin's own merges (mergeMorning,
// mergeTape, mergeTests), so the file reads exactly as if Pahlavan's forms
// had saved it: only the given fields move, steps and floors go on the day
// before, every other field, entry and day stays. A field that already holds
// another value is a conflict (nothing is written) unless `replace`: the
// coach never writes over the user's own entry without saying so. Pure: the
// CLI reads and writes the file.

import {
  mergeMorning,
  mergeTape,
  mergeTests,
  MORNING_KEYS,
  morningFrom,
  recordFrom,
  TAPE_FIELDS,
  TEST_FIELDS,
  YESTERDAY_KEYS,
  type MorningKey,
  type MorningValues,
  type RecordField,
  type RecordValue,
  type RecordValues,
} from '../adapters/vault/body-write.ts';
import { addDays, isIsoDate, type IsoDate } from '../core/dates.ts';

export const BODY_PARTS = ['morning', 'tape', 'tests'] as const;
export type BodyPartName = (typeof BODY_PARTS)[number];

export interface BodyInput {
  date: IsoDate;
  morning?: MorningValues;
  tape?: RecordValues;
  tests?: RecordValues;
}

export interface BodyMessage {
  code: string;
  message: string;
}

export interface BodyConflict {
  field: string;
  /** What body-data.json holds now. */
  disk: number | string | null;
  /** What the record would write. */
  mine: number | string | null;
}

export interface BodyPartResult {
  part: BodyPartName;
  /** set: fields change; unchanged: the file holds them already; conflict: a field holds another value (nothing is written). */
  result: 'set' | 'unchanged' | 'conflict';
  changed: string[];
  conflicts: BodyConflict[];
  note: string;
}

export interface BodyPlan {
  results: BodyPartResult[];
  errors: BodyMessage[];
  warnings: BodyMessage[];
  /** The file to write; null when nothing changes or something stops the write. */
  text: string | null;
  /** The date's morning fields, tape and tests once written (as the file would hold them). */
  after: { morning: Record<MorningKey, number | null>; tape: Record<string, RecordValue>; tests: Record<string, RecordValue> };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const FIELDS: Record<'tape' | 'tests', readonly RecordField[]> = { tape: TAPE_FIELDS, tests: TEST_FIELDS };

/**
 * The record file into a body input: `{date, morning?, tape?, tests?}`, each
 * part an object of its fields (a number, text for the two text tests, or
 * null to clear one). Unknown parts or fields, a missing date or one after
 * today are errors.
 */
export function readBodyInput(raw: unknown, today: IsoDate): { input: BodyInput | null; errors: BodyMessage[] } {
  const errors: BodyMessage[] = [];
  if (!isObj(raw)) return { input: null, errors: [{ code: 'record', message: `the record file must be an object: {date, ${BODY_PARTS.join(', ')}}` }] };
  const unknown = Object.keys(raw).filter((k) => k !== 'date' && !(BODY_PARTS as readonly string[]).includes(k) && !k.startsWith('_'));
  if (unknown.length) errors.push({ code: 'record', message: `unknown keys in the record file: ${unknown.join(', ')} (known: date, ${BODY_PARTS.join(', ')})` });
  const date = raw['date'];
  if (typeof date !== 'string' || !isIsoDate(date)) errors.push({ code: 'record', message: 'the record needs its "date" as YYYY-MM-DD (the day it was measured)' });
  else if (date > today) errors.push({ code: 'record', message: `the record's date ${date} is after today (${today})` });
  const parts = BODY_PARTS.filter((p) => raw[p] !== undefined);
  if (!parts.length) errors.push({ code: 'record', message: `the record holds nothing to write: give any of ${BODY_PARTS.join(', ')}` });
  for (const p of parts) {
    const v = raw[p];
    if (!isObj(v)) {
      errors.push({ code: 'record', message: `"${p}" must be an object of its fields` });
      continue;
    }
    const known = p === 'morning' ? (MORNING_KEYS as readonly string[]) : FIELDS[p].map((f) => f.id);
    const bad = Object.keys(v).filter((k) => !known.includes(k));
    if (bad.length) errors.push({ code: 'record', message: `"${p}" has unknown fields: ${bad.join(', ')} (known: ${known.join(', ')})` });
    if (!Object.keys(v).length) errors.push({ code: 'record', message: `"${p}" is empty` });
  }
  if (errors.length) return { input: null, errors };
  return { input: { date: date as IsoDate, ...Object.fromEntries(parts.map((p) => [p, raw[p]])) }, errors: [] };
}

const show = (v: unknown) => (v === null || v === undefined ? 'nothing' : String(v));

/**
 * The record merged into body-data.json as it is (`text`, null when the file
 * does not exist yet): the morning fields, then the tape, then the tests,
 * each through its merge. A field the file holds with another value is a
 * conflict unless `replace`; a conflict or an invalid value writes nothing.
 */
export function planBody(text: string | null, input: BodyInput, opts: { replace?: boolean } = {}): BodyPlan {
  const results: BodyPartResult[] = [];
  const errors: BodyMessage[] = [];
  const warnings: BodyMessage[] = [];
  const force = opts.replace === true;
  let doc: unknown = null;
  if (text !== null) {
    try {
      doc = JSON.parse(text);
    } catch {
      doc = undefined;
    }
  }
  let cur = text;
  const { date } = input;

  if (input.morning) {
    const values = input.morning;
    // The record expects each field empty: what is there already is the baseline only when it matches.
    const disk = morningFrom(doc ?? null, date).values;
    const keys = MORNING_KEYS.filter((k) => values[k] !== undefined);
    const conflicts: BodyConflict[] = keys.filter((k) => disk[k] !== null && disk[k] !== (values[k] ?? null)).map((k) => ({ field: k, disk: disk[k], mine: values[k] ?? null }));
    const m = mergeMorning(cur, date, { values, baseline: {}, force });
    if (m.result === 'invalid') errors.push(...m.errors.map((e) => ({ code: 'invalid', message: `morning: ${e}` })));
    else if (m.result === 'unreadable') errors.push({ code: 'body', message: m.error });
    else if (m.result === 'conflict') results.push({ part: 'morning', result: 'conflict', changed: [], conflicts, note: conflictNote('morning', date, conflicts) });
    else if (m.result === 'unchanged') results.push({ part: 'morning', result: 'unchanged', changed: [], conflicts: [], note: `body-data.json holds these morning fields for ${date} already.` });
    else {
      cur = m.text;
      const yesterday = m.changed.filter((k) => YESTERDAY_KEYS.includes(k));
      results.push({
        part: 'morning',
        result: 'set',
        changed: m.changed,
        conflicts: force ? conflicts : [],
        note: `${m.changed.join(', ')} on ${date}${yesterday.length ? ` (${yesterday.join(' and ')} on ${addDays(date, -1)}, the day they count for, as the morning check-in files them)` : ''}${force && conflicts.length ? `; replaced ${conflicts.map((c) => `${c.field} ${show(c.disk)}`).join(', ')}` : ''}.`,
      });
    }
  }

  for (const part of ['tape', 'tests'] as const) {
    const values = input[part];
    if (!values) continue;
    const disk = recordFrom(doc ?? null, part, date);
    const conflicts: BodyConflict[] = Object.keys(values).filter((k) => disk[k] !== undefined && disk[k] !== (values[k] ?? null)).map((k) => ({ field: k, disk: disk[k] ?? null, mine: values[k] ?? null }));
    const merge = part === 'tape' ? mergeTape : mergeTests;
    const m = merge(cur, date, { values, baseline: {}, force });
    if (m.result === 'invalid') errors.push(...m.errors.map((e) => ({ code: 'invalid', message: `${part}: ${e}` })));
    else if (m.result === 'unreadable') errors.push({ code: 'body', message: m.error });
    else if (m.result === 'conflict') results.push({ part, result: 'conflict', changed: [], conflicts, note: conflictNote(part, date, conflicts) });
    else if (m.result === 'unchanged') results.push({ part, result: 'unchanged', changed: [], conflicts: [], note: `body-data.json holds this ${part === 'tape' ? 'tape' : 'test'} entry for ${date} already.` });
    else {
      cur = m.text;
      results.push({ part, result: 'set', changed: m.changed, conflicts: force ? conflicts : [], note: `${part === 'tape' ? 'The tape' : 'The tests'} on ${date}: ${m.changed.join(', ')}${force && conflicts.length ? `; replaced ${conflicts.map((c) => `${c.field} ${show(c.disk)}`).join(', ')}` : ''}.` });
    }
  }

  const blocked = errors.length > 0 || results.some((r) => r.result === 'conflict');
  if (results.some((r) => r.result === 'conflict')) errors.push({ code: 'conflict', message: 'a field holds another value already: nothing is written (check with the user, then --replace to write over it)' });
  const changed = results.some((r) => r.result === 'set');
  const finalDoc = (() => {
    try {
      return cur === null ? null : (JSON.parse(cur) as unknown);
    } catch {
      return null;
    }
  })();
  const shown = blocked ? doc ?? null : finalDoc;
  return {
    results,
    errors,
    warnings,
    text: blocked || !changed ? null : cur,
    after: { morning: morningFrom(shown, date).values, tape: recordFrom(shown, 'tape', date), tests: recordFrom(shown, 'tests', date) },
  };
}

function conflictNote(part: BodyPartName, date: IsoDate, conflicts: BodyConflict[]): string {
  return `${part === 'morning' ? 'The morning fields' : part === 'tape' ? 'The tape' : 'The tests'} for ${date} hold other values: ${conflicts.map((c) => `${c.field} is ${show(c.disk)}, the record says ${show(c.mine)}`).join('; ')}.`;
}

/** Every field the plan set reads back from `back` as the record gave it (the CLI's read-back check). */
export function bodyLanded(back: string | null, input: BodyInput, plan: BodyPlan): boolean {
  if (back === null) return false;
  let doc: unknown;
  try {
    doc = JSON.parse(back);
  } catch {
    return false;
  }
  for (const r of plan.results) {
    if (r.result !== 'set') continue;
    if (r.part === 'morning') {
      const now = morningFrom(doc, input.date).values;
      if (!r.changed.every((k) => now[k as MorningKey] === (input.morning?.[k as MorningKey] ?? null))) return false;
    } else {
      const now = recordFrom(doc, r.part, input.date);
      const given: RecordValues = (r.part === 'tape' ? input.tape : input.tests) ?? {};
      if (!r.changed.every((k) => (now[k] ?? null) === (given[k] ?? null))) return false;
    }
  }
  return true;
}
