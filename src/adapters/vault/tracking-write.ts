// The merges for Pahlavan's own Coach files, as pure functions from the
// text on disk to the text to write: Coach/tracking.json (items, their day
// records, suggestions, the check-in reminders), Coach/nudges.json (the
// reminder state every Mac shares) and Coach/sitting.json (each Mac's
// sitting stretches). Each changes only what it was asked to; a change
// someone else made since the caller read the file (the baseline) is a
// conflict unless forced; the result is validated before it is offered, and
// carries what must hold on read-back (`check`, for `landed`).

import { addDays, isIsoDate } from '../../core/dates.ts';
import { SCHEMA_VERSION, type IsoDate, type ItemDay, type ItemSuggestion, type NudgeEntry, type NudgeState, type SittingLog, type SittingStretch, type TrackedItem, type Tracking } from '../../core/schema.ts';
import { canWrite, validateNudges, validateSitting, validateTracking } from '../../core/validate.ts';
import type { NudgeChange } from '../../core/nudges.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const pretty = (o: unknown) => `${JSON.stringify(o, null, 2)}\n`;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const round2 = (n: number) => Math.round(n * 100) / 100;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A value that must hold at a path after the write (undefined: the path is gone). */
export interface Landed {
  path: string[];
  value: unknown;
}

/** The value at a path: object keys, and list entries by their id. */
function valueAt(doc: unknown, path: readonly string[]): unknown {
  let v: unknown = doc;
  for (const k of path) v = isObj(v) ? v[k] : Array.isArray(v) ? (v as unknown[]).find((x) => isObj(x) && x['id'] === k) : undefined;
  return v;
}

/** Whether the read-back text holds every checked value. */
export function landed(text: string | null, check: readonly Landed[]): boolean {
  if (text === null) return false;
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return false;
  }
  return check.every((c) => same(valueAt(doc, c.path), c.value));
}

export interface Conflict {
  what: string;
  disk: unknown;
  baseline: unknown;
  mine: unknown;
}

export type FileMerge<D> =
  | { result: 'merged'; text: string; doc: D; changed: string[]; check: Landed[] }
  | { result: 'unchanged' }
  | { result: 'conflict'; conflicts: Conflict[] }
  | { result: 'invalid'; errors: string[] }
  | { result: 'unreadable'; error: string };

function load(text: string | null, file: string, fresh: () => Obj): { doc: Obj } | { error: string } {
  if (text === null) return { doc: fresh() };
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { error: `${file} is not valid JSON (an unresolved git conflict?); nothing was written` };
  }
  if (!isObj(doc)) return { error: `${file} is not a JSON object` };
  const guard = canWrite(doc);
  if (!guard.value) return { error: `${file}: ${guard.reason.note}` };
  return { doc };
}

// ---------------------------------------------------------------- Coach/tracking.json

export type DayField = 'amount' | 'minutes' | 'count' | 'deskMinutes';

/**
 * A change to Coach/tracking.json. `put-item` adds an item (baseline null)
 * or replaces it (baseline: the item as read); `remove-item` takes it out
 * with its day records; `tick` sets or clears a day's done; `add` adds to a
 * day's amount, minutes, count or desk minutes (never below 0, never a
 * conflict); `set`
 * puts an exact value; `suggest` and `decide` keep the coach's suggestions;
 * `settings` sets the morning reminder, the body-record schedule or the
 * bring-over record.
 */
export type TrackingOp =
  | { op: 'put-item'; item: TrackedItem; baseline: TrackedItem | null }
  | { op: 'remove-item'; id: string; baseline: TrackedItem | null }
  | { op: 'tick'; item: string; date: IsoDate; done: boolean; at?: string }
  | { op: 'add'; item: string; date: IsoDate; field: DayField; delta: number; at?: string }
  | { op: 'set'; item: string; date: IsoDate; field: DayField; value: number | null; baseline: number | null; at?: string }
  | { op: 'suggest'; suggestion: ItemSuggestion }
  | { op: 'decide'; id: string; state: 'accepted' | 'dismissed'; on: IsoDate }
  | { op: 'settings'; key: 'morning' | 'bodyRecord' | 'bringOver'; value: unknown; baseline: unknown };

export function mergeTracking(text: string | null, ops: readonly TrackingOp[], opts: { force?: boolean } = {}): FileMerge<Tracking> {
  const r = load(text, 'Coach/tracking.json', () => ({ schemaVersion: SCHEMA_VERSION, items: [], days: {} }));
  if ('error' in r) return { result: 'unreadable', error: r.error };
  const doc = r.doc as unknown as Tracking & Obj;
  if (!Array.isArray(doc.items)) doc.items = [];
  if (!isObj(doc.days)) doc.days = {};
  const conflicts: Conflict[] = [];
  const errors: string[] = [];
  const changed: string[] = [];
  const check: Landed[] = [];
  const clash = (what: string, disk: unknown, baseline: unknown, mine: unknown) => {
    if (!same(disk, baseline) && !same(disk, mine)) conflicts.push({ what, disk: disk ?? null, baseline: baseline ?? null, mine: mine ?? null });
  };
  const dayOf = (item: string, date: IsoDate): ItemDay => {
    const d = (doc.days[date] ??= {});
    return (d[item] ??= {});
  };
  const tidy = (item: string, date: IsoDate) => {
    const d = doc.days[date];
    if (!d) return;
    const e = d[item];
    if (e && Object.keys(e).filter((k) => k !== 'at').length === 0) delete d[item];
    if (!Object.keys(d).length) delete doc.days[date];
  };
  const known = (id: string) => doc.items.some((x) => x.id === id);

  for (const op of ops) {
    switch (op.op) {
      case 'put-item': {
        const i = doc.items.findIndex((x) => x.id === op.item.id);
        const disk = i >= 0 ? doc.items[i] : null;
        if (same(disk, op.item)) break;
        clash(`item ${op.item.id}`, disk, op.baseline, op.item);
        // A copy: a later operation in the same merge must not change the caller's object.
        const item = clone(op.item);
        if (i >= 0) doc.items[i] = item;
        else doc.items.push(item);
        changed.push(`item ${op.item.id}`);
        check.push({ path: ['items', op.item.id], value: op.item });
        break;
      }
      case 'remove-item': {
        const i = doc.items.findIndex((x) => x.id === op.id);
        if (i < 0) break;
        clash(`item ${op.id}`, doc.items[i], op.baseline, null);
        doc.items.splice(i, 1);
        for (const date of Object.keys(doc.days)) {
          delete doc.days[date]![op.id];
          if (!Object.keys(doc.days[date]!).length) delete doc.days[date];
        }
        changed.push(`removed ${op.id}`);
        check.push({ path: ['items', op.id], value: undefined });
        break;
      }
      case 'tick':
      case 'add':
      case 'set': {
        if (!known(op.item)) {
          errors.push(`no item with the id ${op.item}`);
          break;
        }
        if (!isIsoDate(op.date)) {
          errors.push(`${op.date} is not a date`);
          break;
        }
        const e = dayOf(op.item, op.date);
        const before = JSON.stringify(e);
        if (op.op === 'tick') {
          if (op.done) e.done = true;
          else delete e.done;
          check.push({ path: ['days', op.date, op.item, 'done'], value: op.done ? true : undefined });
        } else if (op.op === 'add') {
          if (!Number.isFinite(op.delta)) {
            errors.push('the amount to add is not a number');
            break;
          }
          e[op.field] = Math.max(0, round2((e[op.field] ?? 0) + op.delta));
          check.push({ path: ['days', op.date, op.item, op.field], value: e[op.field] });
        } else {
          clash(`${op.item} ${op.field} on ${op.date}`, e[op.field] ?? null, op.baseline, op.value);
          if (op.value === null) delete e[op.field];
          else e[op.field] = op.value;
          check.push({ path: ['days', op.date, op.item, op.field], value: op.value ?? undefined });
        }
        if (JSON.stringify(e) !== before) {
          if (op.at) e.at = op.at;
          changed.push(`${op.item} on ${op.date}`);
        }
        tidy(op.item, op.date);
        break;
      }
      case 'suggest': {
        const list = (doc.suggestions ??= []);
        const i = list.findIndex((x) => x.id === op.suggestion.id);
        if (i >= 0 && same(list[i], op.suggestion)) break;
        const sg = clone(op.suggestion);
        if (i >= 0) list[i] = sg;
        else list.push(sg);
        changed.push(`suggestion ${op.suggestion.id}`);
        check.push({ path: ['suggestions', op.suggestion.id], value: op.suggestion });
        break;
      }
      case 'decide': {
        const sg = (doc.suggestions ?? []).find((x) => x.id === op.id);
        if (!sg) {
          errors.push(`no suggestion with the id ${op.id}`);
          break;
        }
        if (sg.state === op.state) break;
        sg.state = op.state;
        sg.decided = op.on;
        changed.push(`suggestion ${op.id} ${op.state}`);
        check.push({ path: ['suggestions', op.id, 'state'], value: op.state });
        break;
      }
      case 'settings': {
        const disk = doc[op.key];
        if (same(disk, op.value)) break;
        clash(op.key, disk, op.baseline, op.value);
        if (op.value === null || op.value === undefined) delete doc[op.key];
        else (doc as Obj)[op.key] = op.value;
        changed.push(op.key);
        check.push({ path: [op.key], value: op.value ?? undefined });
        break;
      }
    }
  }
  if (errors.length) return { result: 'invalid', errors };
  if (conflicts.length && !opts.force) return { result: 'conflict', conflicts };
  if (!changed.length) return { result: 'unchanged' };
  const v = validateTracking(doc);
  if (v.length) return { result: 'invalid', errors: v.map((e) => `${e.path}: ${e.message}`) };
  // What must read back is each touched path as the whole merge left it (a suggestion added
  // and then accepted in the same merge reads back accepted).
  const final = check.map((c) => {
    const v = valueAt(doc, c.path);
    return { path: c.path, value: v === undefined ? undefined : clone(v) };
  });
  return { result: 'merged', text: pretty(doc), doc, changed, check: final };
}

// ---------------------------------------------------------------- Coach/nudges.json

/** Days kept in Coach/nudges.json (Habit Nudges kept 7), and skipped body-record occurrences (it kept 120). */
export const NUDGE_KEEP_DAYS = 14;
export const SKIP_KEEP_DAYS = 120;

/** As FileMerge, with `already`: the reminders another Mac had already answered the same way. */
export type NudgeMerge =
  | { result: 'merged'; text: string; doc: NudgeState; changed: string[]; check: Landed[]; already: string[] }
  | { result: 'unchanged'; already: string[] }
  | { result: 'conflict'; conflicts: Conflict[] }
  | { result: 'invalid'; errors: string[] }
  | { result: 'unreadable'; error: string };

/**
 * Coach/nudges.json with the answers, snoozes and skips merged in. An answer
 * is never overwritten: when another Mac already answered the same reminder
 * (for the same stretch) the same way, it is `already`; a different answer
 * is a conflict unless forced; a snooze over an answer is dropped. The last
 * card's time keeps the later one. Days older than `keepDays` before today,
 * and skips older than 120 days, are pruned.
 */
export function mergeNudges(text: string | null, changes: readonly NudgeChange[], opts: { today: IsoDate; keepDays?: number; force?: boolean }): NudgeMerge {
  const r = load(text, 'Coach/nudges.json', () => ({ schemaVersion: SCHEMA_VERSION, days: {} }));
  if ('error' in r) return { result: 'unreadable', error: r.error };
  const doc = r.doc as unknown as NudgeState & Obj;
  if (!isObj(doc.days)) doc.days = {};
  const conflicts: Conflict[] = [];
  const changed: string[] = [];
  const check: Landed[] = [];
  const already: string[] = [];
  for (const c of changes) {
    if ('skip' in c) {
      const skipped = (doc.skipped ??= {});
      if (skipped[c.skip] !== undefined) continue;
      skipped[c.skip] = c.at;
      changed.push(`skipped ${c.skip}`);
      check.push({ path: ['skipped', c.skip], value: c.at });
      continue;
    }
    const day = (doc.days[c.date] ??= {});
    const disk: NudgeEntry = day[c.key] ?? {};
    const next: NudgeEntry = { ...disk };
    const sameSubject = (disk.for ?? null) === (c.set.for ?? disk.for ?? null);
    if (c.set.how !== undefined) {
      if (disk.how !== undefined && sameSubject && !opts.force) {
        if (disk.how === c.set.how) {
          already.push(c.key);
          continue;
        }
        conflicts.push({ what: `${c.key} on ${c.date}`, disk: disk.how, baseline: null, mine: c.set.how });
        continue;
      }
      next.how = c.set.how;
      for (const k of ['at', 'by', 'for'] as const) {
        if (c.set[k] !== undefined) next[k] = c.set[k];
        else delete next[k];
      }
      delete next.snoozedUntil;
    }
    if (c.set.snoozedUntil !== undefined) {
      if (next.how !== undefined && c.set.how === undefined && sameSubject) already.push(c.key);
      else next.snoozedUntil = c.set.snoozedUntil;
    }
    if (c.set.lastAt !== undefined) {
      const a = Date.parse(next.lastAt ?? '') || 0;
      if (Date.parse(c.set.lastAt) > a) next.lastAt = c.set.lastAt;
      if (c.set.by !== undefined && c.set.how === undefined) next.by = c.set.by;
    }
    if (same(next, disk)) {
      if (!Object.keys(day).length) delete doc.days[c.date];
      continue;
    }
    day[c.key] = next;
    changed.push(`${c.key} on ${c.date}`);
    check.push({ path: ['days', c.date, c.key], value: next });
  }
  if (conflicts.length) return { result: 'conflict', conflicts };
  // Prune old days and skips.
  const cutoff = addDays(opts.today, -(opts.keepDays ?? NUDGE_KEEP_DAYS));
  let pruned = false;
  for (const d of Object.keys(doc.days)) {
    if (d < cutoff || !Object.keys(doc.days[d]!).length) {
      delete doc.days[d];
      pruned = true;
    }
  }
  const skipCut = addDays(opts.today, -SKIP_KEEP_DAYS);
  for (const k of Object.keys(doc.skipped ?? {})) {
    const d = k.split(':')[1]!;
    if (d !== 'baseline' && d < skipCut) {
      delete doc.skipped![k];
      pruned = true;
    }
  }
  if (!changed.length && !pruned) return { result: 'unchanged', already };
  const v = validateNudges(doc);
  if (v.length) return { result: 'invalid', errors: v.map((e) => `${e.path}: ${e.message}`) };
  return { result: 'merged', text: pretty(doc), doc, changed: changed.length ? changed : ['pruned'], check, already };
}

// ---------------------------------------------------------------- Coach/sitting.json

/** One Mac's change to one day: stretches to add or update (matched by start), stretches to remove (by start). */
export interface SittingChange {
  date: IsoDate;
  put?: SittingStretch[];
  remove?: string[];
  /** The stretches' ends as this Mac last wrote them, by start: one changed on disk since is a conflict. */
  baseline?: Record<string, string | null>;
}

/**
 * Coach/sitting.json with this Mac's stretches changed: only `mac`'s lists
 * on the given days move, kept in start order; every other Mac and day
 * stays. Each Mac writes only its own, so the Macs never conflict; a list
 * changed on disk under the same Mac's name (two Macs given one name) is.
 */
export function mergeSitting(text: string | null, mac: string, changes: readonly SittingChange[], opts: { force?: boolean } = {}): FileMerge<SittingLog> {
  const r = load(text, 'Coach/sitting.json', () => ({ schemaVersion: SCHEMA_VERSION, days: {} }));
  if ('error' in r) return { result: 'unreadable', error: r.error };
  const doc = r.doc as unknown as SittingLog & Obj;
  if (!isObj(doc.days)) doc.days = {};
  const conflicts: Conflict[] = [];
  const changed: string[] = [];
  const check: Landed[] = [];
  for (const c of changes) {
    const day = (doc.days[c.date] ??= {});
    const list: SittingStretch[] = [...(day[mac] ?? [])];
    const before = JSON.stringify(list);
    for (const s of c.put ?? []) {
      const i = list.findIndex((x) => x.start === s.start);
      if (c.baseline && s.start in c.baseline) {
        const disk = i >= 0 ? list[i]!.end : null;
        if (disk !== c.baseline[s.start] && disk !== s.end) conflicts.push({ what: `${mac} ${c.date} ${s.start}`, disk, baseline: c.baseline[s.start], mine: s.end });
      }
      if (i >= 0) list[i] = { start: s.start, end: s.end };
      else list.push({ start: s.start, end: s.end });
    }
    for (const start of c.remove ?? []) {
      const i = list.findIndex((x) => x.start === start);
      if (i >= 0) list.splice(i, 1);
    }
    list.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    if (JSON.stringify(list) === before) {
      if (!Object.keys(day).length) delete doc.days[c.date];
      continue;
    }
    if (list.length) day[mac] = list;
    else delete day[mac];
    if (!Object.keys(day).length) delete doc.days[c.date];
    changed.push(`${mac} on ${c.date}`);
    check.push({ path: ['days', c.date, mac], value: list.length ? list : undefined });
  }
  if (conflicts.length && !opts.force) return { result: 'conflict', conflicts };
  if (!changed.length) return { result: 'unchanged' };
  const v = validateSitting(doc);
  if (v.length) return { result: 'invalid', errors: v.map((e) => `${e.path}: ${e.message}`) };
  return { result: 'merged', text: pretty(doc), doc, changed, check };
}
