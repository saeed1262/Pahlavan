// The coach's write path into Coach/tracking.json (the CLI's `track`): the
// changes the fitness-coach skill asks for, turned into mergeTracking
// operations with the Habits screen's own functions (item-form.ts), so an
// item the coach adds looks exactly like one added or accepted on the
// screen: a new item takes the Add form's defaults for its kind, an
// accepted suggestion starts today or later with `source.on` today and the
// suggestion marked accepted, and an edit puts the settings in force
// through yesterday into the item's `earlier`. Pure: the file as read and
// today in, the operations and what each change does out. The CLI merges,
// writes and reads back.

import type { TrackingOp } from '../adapters/vault/tracking-write.ts';
import { toMinutes } from '../core/clock.ts';
import { isIsoDate, type IsoDate } from '../core/dates.ts';
import { isProteinItem, type ProteinTarget } from '../core/protein.ts';
import { ITEM_KINDS, ITEM_SLOTS, type BodyRecordSchedule, type ItemKind, type ItemSlot, type ItemSuggestion, type MorningReminder, type TrackedItem, type Tracking } from '../core/schema.ts';
import { validateTracking } from '../core/validate.ts';
import { hm } from '../core/sitting.ts';
import { acceptOps, bodyScheduleOps, dismissOps, earlierFor, itemFromForm, itemId, morningOps, newForm, withWhen } from './item-form.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * An item as the coach writes it: its kind and name, the Why for a coach
 * item, and any of a tracked item's fields; the rest takes the Add form's
 * defaults for the kind. `reminder: null` means no card. `by` is `coach`
 * when there is a Why, else `user` (the user's own, from the conversation).
 * `again` suggests a dismissed item once more (new data).
 */
export interface ItemInput {
  id?: string;
  kind: ItemKind;
  name: string;
  why?: string;
  from?: string;
  by?: 'coach' | 'user';
  again?: boolean;
  [field: string]: unknown;
}

/** One write: any of these, applied in this order. */
export interface TrackChanges {
  /** Coach suggestions: Pahlavan shows them as accept or dismiss chips with their Why. */
  suggest?: ItemInput[];
  /** Items the user accepted in the conversation (an id in use: a change to that item, from today). */
  add?: ItemInput[];
  /** Items the user declined in the conversation: kept as dismissed suggestions, so they are not proposed again. */
  decline?: ItemInput[];
  /** Suggestion ids to accept or dismiss, as the chips do. */
  accept?: string[];
  dismiss?: string[];
  /** The morning check-in's reminder; a missing field keeps its value (on defaults to true with a time). */
  morning?: { on?: boolean; at?: string };
  /** The body record's schedule: `plan`, or `fixed` with its four fields. */
  bodyRecord?: BodyRecordSchedule;
  /** The bring-over record: the ids brought over; `[]` when starting fresh (the screens' offer never shows). */
  bringOver?: string[];
  /** The protein item's gram target to the engine's (the floor of the protein range at the trend weight). */
  protein?: boolean;
}

export const CHANGE_KEYS = ['suggest', 'add', 'decline', 'accept', 'dismiss', 'morning', 'bodyRecord', 'bringOver', 'protein'] as const;
/** The ItemInput keys that are not a tracked item's fields. */
const INPUT_ONLY = ['why', 'from', 'by', 'again'];
/** A tracked item's fields an input may set (id, kind, name, source handled apart). */
const ITEM_FIELDS = ['schedule', 'start', 'when', 'whenDetail', 'reminder', 'habit', 'note', 'dose', 'means', 'goal', 'amount', 'standup', 'sitting', 'desk'] as const;
const CONFIG_FIELDS = ['amount', 'standup', 'sitting', 'desk'] as const;

export type TrackResultKind = 'added' | 'updated' | 'suggested' | 'accepted' | 'dismissed' | 'declined' | 'set' | 'recorded' | 'skipped' | 'unchanged';

export interface TrackResult {
  what: 'suggest' | 'add' | 'decline' | 'accept' | 'dismiss' | 'morning' | 'bodyRecord' | 'bringOver' | 'protein';
  id?: string;
  result: TrackResultKind;
  note: string;
}

export interface TrackMessage {
  code: string;
  message: string;
}

export interface TrackPlan {
  ops: TrackingOp[];
  results: TrackResult[];
  errors: TrackMessage[];
  warnings: TrackMessage[];
}

export interface TrackContext {
  /** Coach/tracking.json as read (null: not there yet). */
  tracking: Tracking | null;
  today: IsoDate;
  /** The engine's protein range at the trend weight (core/protein.ts), for the protein item. */
  protein: ProteinTarget | null;
  /** The linked habit ids (habits-data.json), when it exists: a link to another id is a warning. */
  habits: readonly string[] | null;
}

/**
 * Whether Pahlavan is set up in the vault: at least one item tracked. Habit Nudges steps aside from then on.
 * A recorded bring-over alone (a fresh start) doesn't count: with nothing tracked, the reminders would just stop.
 */
export const setUp = (t: Pick<Tracking, 'items'> | null | undefined): boolean => Boolean(t && t.items.length > 0);

/** A changes file as given: an object with the known keys, or a single item or a list (for suggest, add, decline). */
export function readChanges(v: unknown, as?: 'suggest' | 'add' | 'decline'): { changes: TrackChanges | null; errors: TrackMessage[] } {
  if (as) {
    const list = Array.isArray(v) ? v : isObj(v) && Array.isArray(v['items']) ? v['items'] : isObj(v) ? [v] : null;
    if (!list) return { changes: null, errors: [{ code: 'changes', message: `the file must hold an item, a list of items, or {"items": [...]}` }] };
    return { changes: { [as]: list as ItemInput[] }, errors: [] };
  }
  if (!isObj(v)) return { changes: null, errors: [{ code: 'changes', message: `the changes file must be an object with any of: ${CHANGE_KEYS.join(', ')}` }] };
  const unknown = Object.keys(v).filter((k) => !(CHANGE_KEYS as readonly string[]).includes(k) && !k.startsWith('_'));
  if (unknown.length) return { changes: null, errors: [{ code: 'changes', message: `unknown keys in the changes file: ${unknown.join(', ')} (known: ${CHANGE_KEYS.join(', ')})` }] };
  return { changes: v as TrackChanges, errors: [] };
}

/**
 * The operations for a set of changes, each with what it does. Errors stop
 * the write (nothing is written); a change that would do nothing new is
 * `unchanged`, one that must not happen (re-suggesting a dismissed item,
 * suggesting what is tracked) is `skipped` with a warning.
 */
export function planTrack(changes: TrackChanges, ctx: TrackContext): TrackPlan {
  const { today } = ctx;
  const ops: TrackingOp[] = [];
  const results: TrackResult[] = [];
  const errors: TrackMessage[] = [];
  const warnings: TrackMessage[] = [];
  const t = ctx.tracking;
  // A working copy, so later changes in the same file see the earlier ones.
  const items = new Map((t?.items ?? []).map((x) => [x.id, x]));
  const suggestions = new Map((t?.suggestions ?? []).map((s) => [s.id, s]));
  // A new item's id comes from its name (lowercase, dashes), so the same name finds the item
  // or its earlier suggestion (open, accepted or dismissed) instead of making a second one.
  const takenIds = (): string[] => [];
  const err = (code: string, message: string) => errors.push({ code, message });

  const lists = { suggest: changes.suggest, add: changes.add, decline: changes.decline } as const;
  for (const [k, v] of Object.entries(lists)) if (v !== undefined && !Array.isArray(v)) err('changes', `${k} must be a list of items`);
  for (const k of ['accept', 'dismiss', 'bringOver'] as const) {
    const v = changes[k];
    if (v !== undefined && !(Array.isArray(v) && v.every((x) => typeof x === 'string'))) err('changes', `${k} must be a list of ids`);
  }
  if (errors.length) return { ops, results, errors, warnings };

  // ---- suggest
  for (const [i, input] of (changes.suggest ?? []).entries()) {
    const built = buildItem(input, null, false, ctx, takenIds(), 'suggest', `suggest[${i}]`);
    if (built.errors.length) {
      errors.push(...built.errors);
      continue;
    }
    const item = built.item;
    if (items.has(item.id)) {
      warnings.push({ code: 'already-tracked', message: `${item.name} (${item.id}) is tracked already: not suggested.` });
      results.push({ what: 'suggest', id: item.id, result: 'skipped', note: 'already tracked' });
      continue;
    }
    const prev = suggestions.get(item.id) ?? [...suggestions.values()].find((s) => s.item.id === item.id && s.state === 'open');
    if (prev && prev.state === 'open') {
      const next: ItemSuggestion = { ...prev, item };
      if (same(prev, next)) results.push({ what: 'suggest', id: prev.id, result: 'unchanged', note: 'already suggested, as it is' });
      else {
        ops.push({ op: 'suggest', suggestion: next });
        suggestions.set(prev.id, next);
        results.push({ what: 'suggest', id: prev.id, result: 'updated', note: noted(`the open suggestion ${item.name} updated`, built.notes) });
      }
      continue;
    }
    const dismissed = [...suggestions.values()].find((s) => s.item.id === item.id && s.state === 'dismissed');
    if (dismissed && input.again !== true) {
      warnings.push({ code: 'dismissed', message: `${item.name} was dismissed on ${dismissed.decided ?? dismissed.on}: not suggested again without new data (pass "again": true when there is).` });
      results.push({ what: 'suggest', id: dismissed.id, result: 'skipped', note: `dismissed on ${dismissed.decided ?? dismissed.on}` });
      continue;
    }
    const sid = suggestions.has(item.id) ? itemId(item.id, [...suggestions.keys()]) : item.id;
    const sg: ItemSuggestion = { id: sid, item, on: today, state: 'open' };
    ops.push({ op: 'suggest', suggestion: sg });
    suggestions.set(sid, sg);
    results.push({ what: 'suggest', id: sid, result: 'suggested', note: noted(`${item.name}: a chip in Pahlavan's Habits with its Why`, built.notes) });
  }

  // ---- add (accepted in the conversation), or a change to an item
  for (const [i, input] of (changes.add ?? []).entries()) {
    const id = typeof input?.id === 'string' ? input.id : null;
    const base = id ? (items.get(id) ?? null) : null;
    const open = id && !base ? [...suggestions.values()].find((s) => s.state === 'open' && (s.id === id || s.item.id === id)) : undefined;
    const built = buildItem(input, base ?? (open ? open.item : null), base !== null, ctx, takenIds(), 'add', `add[${i}]`);
    if (built.errors.length) {
      errors.push(...built.errors);
      continue;
    }
    const item = built.item;
    if (!base && items.has(item.id)) {
      err('already-tracked', `add[${i}]: ${item.name} is tracked already as ${item.id} (${items.get(item.id)!.name}): pass "id": "${item.id}" to change it, or give it another name`);
      continue;
    }
    if (base) {
      if (same(base, item)) {
        results.push({ what: 'add', id: item.id, result: 'unchanged', note: `${item.name} is tracked as given` });
        continue;
      }
      if (base.source.by === 'user') warnings.push({ code: 'user-item', message: `${base.name} was added by the user: change it only when they asked to.` });
      ops.push({ op: 'put-item', item, baseline: base });
      items.set(item.id, item);
      results.push({ what: 'add', id: item.id, result: 'updated', note: noted(`${item.name} changed from today${item.earlier?.length !== base.earlier?.length ? '; the settings until yesterday stay with the past days' : ''}`, built.notes) });
      continue;
    }
    if (item.source.by === 'coach') {
      // As the Accept chip writes it: the suggestion marked accepted, the item from today.
      const sg: ItemSuggestion = open ? { ...open, item } : { id: suggestions.has(item.id) ? itemId(item.id, [...suggestions.keys()]) : item.id, item, on: today, state: 'open' };
      if (!open) ops.push({ op: 'suggest', suggestion: sg });
      const accepted = acceptOps(sg, { today, ids: [...items.keys()] });
      ops.push(...accepted);
      const put = accepted.find((o): o is Extract<TrackingOp, { op: 'put-item' }> => o.op === 'put-item')!;
      items.set(put.item.id, put.item);
      suggestions.set(sg.id, { ...sg, state: 'accepted', decided: today });
      results.push({ what: 'add', id: put.item.id, result: 'added', note: noted(`${put.item.name}, suggested by the coach and accepted today${open ? ' (its open suggestion accepted)' : ''}`, built.notes) });
    } else {
      ops.push({ op: 'put-item', item, baseline: null });
      items.set(item.id, item);
      results.push({ what: 'add', id: item.id, result: 'added', note: noted(`${item.name}, added by you`, built.notes) });
    }
  }

  // ---- decline (in the conversation)
  for (const [i, input] of (changes.decline ?? []).entries()) {
    const id = typeof input?.id === 'string' ? input.id : null;
    const open = [...suggestions.values()].find((s) => s.state === 'open' && id !== null && (s.id === id || s.item.id === id));
    if (open) {
      ops.push(...dismissOps(open, today));
      suggestions.set(open.id, { ...open, state: 'dismissed', decided: today });
      results.push({ what: 'decline', id: open.id, result: 'dismissed', note: `${open.item.name}: its open suggestion dismissed` });
      continue;
    }
    const built = buildItem(input, null, false, ctx, takenIds(), 'suggest', `decline[${i}]`);
    if (built.errors.length) {
      errors.push(...built.errors);
      continue;
    }
    const item = built.item;
    if (items.has(item.id)) {
      warnings.push({ code: 'already-tracked', message: `${item.name} (${item.id}) is tracked: declining a suggestion does not remove it (the user removes it in Pahlavan).` });
      results.push({ what: 'decline', id: item.id, result: 'skipped', note: 'tracked' });
      continue;
    }
    if ([...suggestions.values()].some((s) => s.item.id === item.id && s.state === 'dismissed')) {
      results.push({ what: 'decline', id: item.id, result: 'unchanged', note: 'dismissed already' });
      continue;
    }
    const sid = suggestions.has(item.id) ? itemId(item.id, [...suggestions.keys()]) : item.id;
    const sg: ItemSuggestion = { id: sid, item, on: today, state: 'dismissed', decided: today };
    ops.push({ op: 'suggest', suggestion: sg });
    suggestions.set(sid, sg);
    results.push({ what: 'decline', id: sid, result: 'declined', note: `${item.name}: kept as dismissed, not proposed again without new data` });
  }

  // ---- accept and dismiss by id
  const openIds = () => [...suggestions.values()].filter((s) => s.state === 'open').map((s) => s.id);
  for (const id of changes.accept ?? []) {
    const sg = suggestions.get(id);
    if (!sg) {
      err('unknown-suggestion', `no suggestion with the id ${id} (open: ${openIds().join(', ') || 'none'})`);
      continue;
    }
    if (sg.state === 'accepted') {
      results.push({ what: 'accept', id, result: 'unchanged', note: `accepted on ${sg.decided ?? sg.on}` });
      continue;
    }
    if (sg.state === 'dismissed') warnings.push({ code: 'was-dismissed', message: `${sg.item.name} was dismissed on ${sg.decided ?? sg.on}; accepting it now.` });
    const accepted = acceptOps(sg, { today, ids: [...items.keys()] });
    ops.push(...accepted);
    const put = accepted.find((o): o is Extract<TrackingOp, { op: 'put-item' }> => o.op === 'put-item')!;
    items.set(put.item.id, put.item);
    suggestions.set(id, { ...sg, state: 'accepted', decided: today });
    results.push({ what: 'accept', id, result: 'accepted', note: `${sg.item.name} added from ${put.item.start}${put.item.id !== sg.item.id ? ` as ${put.item.id}` : ''}` });
  }
  for (const id of changes.dismiss ?? []) {
    const sg = suggestions.get(id);
    if (!sg) {
      err('unknown-suggestion', `no suggestion with the id ${id} (open: ${openIds().join(', ') || 'none'})`);
      continue;
    }
    if (sg.state === 'dismissed') {
      results.push({ what: 'dismiss', id, result: 'unchanged', note: `dismissed on ${sg.decided ?? sg.on}` });
      continue;
    }
    if (sg.state === 'accepted') {
      err('accepted', `${sg.item.name} was accepted on ${sg.decided ?? sg.on} and is tracked: the user pauses or removes it in Pahlavan`);
      continue;
    }
    ops.push(...dismissOps(sg, today));
    suggestions.set(id, { ...sg, state: 'dismissed', decided: today });
    results.push({ what: 'dismiss', id, result: 'dismissed', note: `${sg.item.name}: dismissed, not proposed again without new data` });
  }

  // ---- the settings
  if (changes.morning !== undefined) {
    const m = changes.morning;
    const cur = t?.morning ?? null;
    if (!isObj(m) || Object.keys(m).some((k) => k !== 'on' && k !== 'at')) err('morning', 'morning takes {"on": true|false, "at": "HH:MM"}');
    else if (m.at !== undefined && (typeof m.at !== 'string' || toMinutes(m.at) === null)) err('morning', `morning.at must be a time as HH:MM, not ${JSON.stringify(m.at)}`);
    else if (m.on !== undefined && typeof m.on !== 'boolean') err('morning', 'morning.on must be true or false');
    else if (!cur && m.at === undefined) err('morning', 'the morning check-in has no time yet: give "at"');
    else {
      const next: MorningReminder = { on: m.on ?? (m.at !== undefined ? true : cur!.on), at: m.at ?? cur!.at };
      if (same(cur, next)) results.push({ what: 'morning', result: 'unchanged', note: morningText(next) });
      else {
        ops.push(...morningOps(next, cur));
        results.push({ what: 'morning', result: 'set', note: morningText(next) });
      }
    }
  }
  if (changes.bodyRecord !== undefined) {
    const b = changes.bodyRecord as unknown;
    const cur = t?.bodyRecord ?? null;
    const fields = ['tapeFrom', 'tapeEvery', 'testsFrom', 'testsEvery'] as const;
    if (!isObj(b) || (b['schedule'] !== 'plan' && b['schedule'] !== 'fixed')) err('bodyRecord', 'bodyRecord takes {"schedule": "plan"} or {"schedule": "fixed", "tapeFrom", "tapeEvery", "testsFrom", "testsEvery"}');
    else if (b['schedule'] === 'fixed' && fields.some((f) => b[f] === undefined)) err('bodyRecord', `a fixed schedule needs ${fields.join(', ')}`);
    else {
      // Switching to the plan keeps the fixed dates, as the Check-in screen's switch does.
      const next = (b['schedule'] === 'plan' ? { ...(cur ?? {}), ...b, schedule: 'plan' } : b) as unknown as BodyRecordSchedule;
      if (same(cur, next)) results.push({ what: 'bodyRecord', result: 'unchanged', note: bodyText(next) });
      else {
        ops.push(...bodyScheduleOps(next, cur));
        results.push({ what: 'bodyRecord', result: 'set', note: bodyText(next) });
      }
    }
  }
  if (changes.bringOver !== undefined) {
    const cur = t?.bringOver;
    if (cur) results.push({ what: 'bringOver', result: 'unchanged', note: `recorded on ${cur.on} (${cur.items.length ? cur.items.join(', ') : 'started fresh'}); the offer does not come back` });
    else {
      const missing = changes.bringOver.filter((id) => !items.has(id));
      if (missing.length) err('bringOver', `the bring-over names items that are not tracked: ${missing.join(', ')}`);
      else {
        ops.push({ op: 'settings', key: 'bringOver', value: { on: today, items: [...changes.bringOver] }, baseline: null });
        results.push({ what: 'bringOver', result: 'recorded', note: changes.bringOver.length ? `brought over: ${changes.bringOver.join(', ')}` : 'started fresh: nothing brought over, and the screens never offer it' });
      }
    }
  }
  if (changes.protein === true) {
    const p = [...items.values()].filter(isProteinItem);
    const target = ctx.protein?.targetG ?? null;
    if (!p.length) err('protein', 'no protein item is tracked: add one first (kind tick, name Protein)');
    else if (target === null) err('protein', 'no trend weight yet, so no gram target: weigh in first');
    for (const item of target === null ? [] : p) {
      const grams = target!;
      if (item.source.by === 'user') {
        warnings.push({ code: 'user-item', message: `${item.name} was added by the user: its target stays theirs (${item.goal ? `${item.goal.amount} ${item.goal.unit}` : 'none'}).` });
        results.push({ what: 'protein', id: item.id, result: 'skipped', note: 'added by the user' });
        continue;
      }
      const next = withProteinGoal(item, grams);
      if (same(item, next)) {
        results.push({ what: 'protein', id: item.id, result: 'unchanged', note: `${target} g a day already` });
        continue;
      }
      ops.push({ op: 'put-item', item: next, baseline: item });
      items.set(item.id, next);
      results.push({ what: 'protein', id: item.id, result: 'updated', note: `${item.goal ? `${item.goal.amount} g to ` : ''}${target} g a day (the protein range's floor at the trend weight)` });
    }
  }

  // Links to a linked habit that does not exist go nowhere; a protein item that is not linked
  // to the Protein habit is not counted by the Sunday check-in (it reads the homepage ticks).
  if (ctx.habits) {
    const seen = new Set<string>();
    for (const op of ops) {
      const it = op.op === 'put-item' ? op.item : op.op === 'suggest' ? op.suggestion.item : null;
      if (!it || seen.has(it.id)) continue;
      seen.add(it.id);
      if (it.habit && !ctx.habits.includes(it.habit)) warnings.push({ code: 'unknown-habit', message: `${it.name} links to the habit "${it.habit}", which habits-data.json does not list: its ticks go nowhere.` });
      if (!it.habit && isProteinItem(it) && ctx.habits.includes('protein')) warnings.push({ code: 'protein-unlinked', message: `${it.name} is not linked to the Protein habit: add "habit": "protein" so the habit check-ins and the Sunday check-in count its ticks.` });
    }
  }
  return { ops, results, errors, warnings };
}

/** A result's note with what else the change did (a sitting card that followed its limit). */
const noted = (note: string, extra: readonly string[]) => [note, ...extra].join('; ');
const morningText = (m: MorningReminder) => (m.on ? `the morning check-in at ${m.at}` : `the morning check-in off (its time ${m.at} kept)`);
const bodyText = (b: BodyRecordSchedule) => (b.schedule === 'plan' ? 'the tape, photos and tests follow the plan' : `tape and photos every ${b.tapeEvery} days from ${b.tapeFrom}, tests every ${b.testsEvery} from ${b.testsFrom}`);

/** The protein item with the gram target: the goal, and its "At least N g" wording when it had the usual one. */
export function withProteinGoal(item: TrackedItem, grams: number): TrackedItem {
  const next = { ...clone(item), goal: { amount: grams, unit: 'g' } };
  if (!item.means || /^At least \d+ g of protein$/.test(item.means) || item.means === 'Your protein target reached') next.means = `At least ${grams} g of protein`;
  return next;
}

/**
 * The tracked item an input describes. A new one starts from the Add form's
 * defaults for its kind (the slot's reminder time with it) and takes every
 * field given; one built on `base` (an open suggestion's item, or the item
 * itself for a change) starts from it and keeps its id and source. A change
 * (`edit`) also keeps the start and history and puts the earlier settings
 * into `earlier`. The protein item without a goal takes the engine's target.
 */
function buildItem(input: ItemInput, base: TrackedItem | null, edit: boolean, ctx: TrackContext, taken: readonly string[], mode: 'suggest' | 'add', path: string): { item: TrackedItem; errors: TrackMessage[]; notes: string[] } {
  const errors: TrackMessage[] = [];
  const bad = (message: string) => errors.push({ code: 'item', message: `${path}: ${message}` });
  const empty = { item: null as unknown as TrackedItem, errors, notes: [] };
  if (!isObj(input)) {
    bad('must be an object with kind and name');
    return empty;
  }
  const known = new Set<string>(['id', 'kind', 'name', ...INPUT_ONLY, ...ITEM_FIELDS]);
  const unknown = Object.keys(input).filter((k) => !known.has(k));
  if (unknown.length) bad(`unknown fields: ${unknown.join(', ')}`);
  const kind = (input.kind ?? base?.kind) as ItemKind;
  if (!ITEM_KINDS.includes(kind)) bad(`kind must be one of ${ITEM_KINDS.join(', ')}`);
  if (base && base.kind !== kind) bad(`${base.id} is a ${base.kind}: the kind stays once an item exists`);
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name && !base) bad('give it a name');
  if (input.why !== undefined && (typeof input.why !== 'string' || !input.why.trim())) bad('why must be a sentence');
  if (input.by !== undefined && input.by !== 'coach' && input.by !== 'user') bad('by must be coach or user');
  if (input.id !== undefined && (typeof input.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.id))) bad('id must be lowercase words joined by dashes');
  if (input.start !== undefined && !(typeof input.start === 'string' && isIsoDate(input.start))) bad('start must be a date as YYYY-MM-DD');
  const by = base ? base.source.by : (input.by ?? (input.why ? 'coach' : mode === 'suggest' ? 'coach' : 'user'));
  if (by === 'coach' && !base && !(typeof input.why === 'string' && input.why.trim())) bad('a coach item needs its why (one line: the data, the item and its number, the source)');
  if (errors.length) return empty;

  let item: TrackedItem;
  if (base) {
    item = clone(base);
    if (name) item.name = name;
  } else {
    let form = { ...newForm(kind, ctx.today), name };
    const when = input.when as ItemSlot;
    if (ITEM_SLOTS.includes(when) && when !== form.when) form = withWhen(form, when);
    item = itemFromForm(form, null, { today: ctx.today, ids: taken }).item;
    item.id = typeof input.id === 'string' ? input.id : itemId(name, taken);
    const source: TrackedItem['source'] = { by };
    if (by === 'coach') source.why = (input.why as string).trim();
    if (typeof input.from === 'string' && input.from.trim()) source.from = input.from.trim();
    if (mode !== 'suggest') source.on = ctx.today;
    item.source = source;
    item.start = ctx.today;
  }
  if (base && (input.why !== undefined || input.from !== undefined)) {
    if (base.source.by === 'coach' && typeof input.why === 'string') item.source.why = input.why.trim();
    if (typeof input.from === 'string') item.source.from = input.from.trim();
  }
  // Every field given wins; the kind's settings merge over the defaults (or the item as it is).
  for (const f of ITEM_FIELDS) {
    if (!(f in input)) continue;
    const v = input[f];
    if (f === 'start' && base) continue; // the start is set below
    if ((CONFIG_FIELDS as readonly string[]).includes(f) && isObj(v)) {
      (item as unknown as Obj)[f] = { ...((item as unknown as Obj)[f] as Obj | undefined), ...v };
    } else if (v === null || v === undefined) delete (item as unknown as Obj)[f];
    else (item as unknown as Obj)[f] = clone(v);
  }
  // A coach item starts today or later (as an accepted chip does); a user's own may start earlier (its history).
  // A change applies from today: the item keeps its start.
  if (!edit) {
    const start = typeof input.start === 'string' ? input.start : base ? base.start : ctx.today;
    item.start = by === 'coach' && start < ctx.today ? ctx.today : start;
    if (base && mode === 'add') item.source = { ...item.source, on: ctx.today };
  }
  if (!edit && isProteinItem(item) && item.goal === undefined) {
    const g = ctx.protein?.targetG ?? null;
    if (g !== null) Object.assign(item, withProteinGoal(item, g));
    else if (!item.means) item.means = 'Your protein target reached';
  }
  const notes = sittingCardFollows(input, base, item);
  if (edit && base) {
    const earlier = earlierFor(item, base, ctx.today);
    if (earlier.length) item.earlier = earlier;
    else delete item.earlier;
  }
  const v = validateTracking({ schemaVersion: 1, items: [item], days: {} } satisfies Tracking);
  for (const e of v) bad(`${e.path.replace(/^items\[0\]\.?/, '') || 'item'}: ${e.message}`);
  return { item, errors, notes };
}

/** The Add form's sitting card (330 minutes) sits this far before its default limit (360). */
const SITTING_CARD_BEFORE = 30;

/**
 * A sitting item's card follows its limit: when the input sets the limit
 * (a new item) or changes it, and gives no `reminder.atMinutes`, the card
 * comes 30 minutes before the limit, the stretch card as it was (on by
 * default). A given card time, or `reminder: null` (no card), wins; an item
 * whose reminder is off keeps it off. What moved, for the result's note.
 */
function sittingCardFollows(input: ItemInput, base: TrackedItem | null, item: TrackedItem): string[] {
  const limit = item.sitting?.limitMinutes;
  const given = input['reminder'];
  const set = item.kind === 'sitting' && isObj(input['sitting']) && input['sitting']['limitMinutes'] !== undefined;
  if (!set || typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit === base?.sitting?.limitMinutes) return [];
  if (given === null || (isObj(given) && given['atMinutes'] !== undefined)) return [];
  if (!item.reminder) return [`no sitting card: its reminder is off (give "reminder" to turn it on)`];
  const at = Math.max(1, limit - SITTING_CARD_BEFORE);
  item.reminder = { atMinutes: at, stretch: item.reminder.stretch ?? true };
  return [`its card at ${hm(at)} of ${hm(limit)}, ${SITTING_CARD_BEFORE} minutes before the limit`];
}
