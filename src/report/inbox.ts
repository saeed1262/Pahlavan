// The phone's inbox: the entries the iPhone's shortcuts send, each a new file
// in Coach/Inbox/ (through the vault's private GitHub repository, then the
// Macs' git pull), applied through the same merges Pahlavan's own screens use,
// so a phone entry can never write what a form couldn't: a session as the
// Log panel saves it (buildLogEntry, mergeLog, then the add-only Workout
// tick), ticks and amounts as Due today writes them (mergeTracking and the
// linked habits), the morning check-in as its card saves it
// (mergeMorning: steps and floors on the day before, checkedAt), and "Did you
// train today?" as its card answers it (the day's mark or the Workout tick,
// and the answer in Coach/nudges.json). Each entry applies, is there already
// (it moves on with nothing to write), or is refused with its reason and
// stays; a value on record is never written over. And phone.json, what the
// shortcuts read with one GET: today's items, the plan's sessions, the next
// one, the morning's fields. Pure: the caller lists, reads, writes and moves
// the files, and passes today in.

import { dayOfField, mergeDayMark, mergeMorning, morningFrom, type MorningChange, type MorningValues } from '../adapters/vault/body-write.ts';
import { readPlanData } from '../adapters/vault/convert.ts';
import { mergeHabitChanges, type HabitChange } from '../adapters/vault/habits-write.ts';
import { buildLogEntry, habitKey, liftUnit, mergeHabit, mergeLog } from '../adapters/vault/log-write.ts';
import { type VaultRead } from '../adapters/vault/read.ts';
import { type TrackingRead } from '../adapters/vault/tracking-read.ts';
import { mergeNudges, mergeTracking, type TrackingOp } from '../adapters/vault/tracking-write.ts';
import { parseTs, toTs } from '../core/clock.ts';
import { addDays, dayText, daysBetween, mondayOf, type IsoDate } from '../core/dates.ts';
import { MORNING_KEYS, MORNING_LIMITS, MORNING_QUESTIONS, MORNING_WORDS, YESTERDAY_KEYS } from '../core/morning.ts';
import type { NudgeChange } from '../core/nudges.ts';
import { INBOX_KINDS, INBOX_VERSION, TRAINED_ANSWERS, type InboxEntry, type InboxKind, type NudgeAnswer, type NudgeState, type TrackedItem, type Tracking, type TrainedAnswer } from '../core/schema.ts';
import { habitsView } from '../core/tracking.ts';
import { bodyUnitsOf, LB_PER_KG } from '../core/units.ts';
import { validateInboxEntry } from '../core/validate.ts';
import { CALENDAR, rotationNext } from './review.ts';
import { buildTrackDay, planTick } from './track-day.ts';
import { paths } from '../adapters/vault/layout.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------- the folder

/** The inbox's own files: what the phone reads, the refusals, and the folder applied entries move to. */
export const INBOX_FILES = { phone: 'phone.json', refused: 'refused.json', applied: 'applied' } as const;
/** The inbox (`paths().inbox`: one file per entry, sent by the phone) and its own files, in the vault's layout, read when used. */
export const INBOX_PATHS = {
  get dir(): string {
    return paths().inbox;
  },
  get phone(): string {
    return `${paths().inbox}/${INBOX_FILES.phone}`;
  },
  get refused(): string {
    return `${paths().inbox}/${INBOX_FILES.refused}`;
  },
  get applied(): string {
    return `${paths().inbox}/${INBOX_FILES.applied}`;
  },
};

/**
 * How far back an entry may go: an older day is logged in Pahlavan, where the
 * form shows what that day holds (Coach/nudges.json keeps 14 days as well).
 */
export const INBOX_DAYS = 14;

/** The name the shortcuts give an entry file: when it was sent (local time, no colons), then its kind. */
export const ENTRY_NAME = "<yyyy-MM-dd>T<HH-mm-ss>-<kind>.json";

/** The phone's name in Coach/nudges.json (an answer's `by`, where a Mac writes its own). */
export const PHONE_BY = 'phone';

/** An entry file: a .json file directly in the inbox, other than phone.json and refused.json. */
export function isEntryFile(name: string): boolean {
  return name.endsWith('.json') && !name.includes('/') && !name.startsWith('.') && name !== INBOX_FILES.phone && name !== INBOX_FILES.refused;
}

/** Where an applied entry goes, under the inbox: applied/<the month of the day it counts for>/<its file>. */
export const appliedPath = (date: IsoDate, file: string): string => `${INBOX_FILES.applied}/${date.slice(0, 7)}/${file}`;

// ---------------------------------------------------------------- the entries

export interface InboxFile {
  /** The file's name in the inbox. */
  file: string;
  text: string;
}

/** The files the merges run on, as they are on disk (null: missing). */
export type InboxTexts = Record<'log' | 'body' | 'habits' | 'tracking' | 'nudges', string | null>;
export type InboxTextKey = keyof InboxTexts;
/** Each text's file, under the vault root (the vault's layout, when called). */
export const inboxTextPaths = (): Record<InboxTextKey, string> => ({ log: paths().log, body: paths().body, habits: paths().habits, tracking: paths().tracking, nudges: paths().nudges });
export const INBOX_TEXT_KEYS: readonly InboxTextKey[] = ['log', 'body', 'habits', 'tracking', 'nudges'];

export interface InboxRead {
  /** The vault as read (the plan, its sessions and rotation, the program, the log as parsed). */
  read: VaultRead;
  /** What the reminders read (what is tracked, the files' states). */
  tracking: TrackingRead;
  /** The files the merges run on, as they are now. */
  texts: InboxTexts;
  /** The applied entries there already, as paths under the inbox ("applied/2026-11/<file>"). */
  applied: readonly string[];
}

/** What an entry writes, as the existing writers take it. */
export interface InboxWrites {
  /** A session for fitness-log-data.json (mergeLog's add); the log writer ticks the Workout habit after it. */
  session?: Obj;
  /** Ticks and amounts for Coach/tracking.json (mergeTracking), as Due today writes them. */
  tracking?: TrackingOp[];
  /** The same on the linked habits in habits-data.json (mergeHabitChanges). */
  habits?: HabitChange[];
  /** The morning check-in's fields for body-data.json (mergeMorning), with checkedAt. */
  morning?: MorningChange;
  /** "Did you train today?": the day's mark in body-data.json (mergeDayMark). */
  mark?: 'rest' | 'missed';
  /** "Trained": the add-only Workout tick in habits-data.json (mergeHabit), as a logged session ticks it. */
  workout?: true;
  /** The evening card's answer in Coach/nudges.json (mergeNudges). */
  nudges?: NudgeChange[];
}

/** Why an entry stays in the inbox. `failed` is the writer's (a file that could not be written); the rest are the plan's. */
export type InboxCode = 'invalid' | 'unknown-type' | 'unknown-item' | 'not-started' | 'future' | 'too-old' | 'already' | 'conflict' | 'unreadable' | 'failed';

interface ResultHead {
  file: string;
  kind: InboxKind | null;
  date: IsoDate | null;
  at: string | null;
}

/** An entry that applies (`apply`: something to write) or is there already (`unchanged`); both move to `moveTo`. */
export interface InboxApplied extends ResultHead {
  kind: InboxKind;
  date: IsoDate;
  at: string;
  status: 'apply' | 'unchanged';
  writes: InboxWrites;
  moveTo: string;
  note: string;
  warnings: string[];
}

/** An entry that stays in the inbox, with its reason. */
export interface InboxRefused extends ResultHead {
  status: 'refused';
  code: InboxCode;
  reason: string;
}

export type InboxResult = InboxApplied | InboxRefused;

export interface InboxPlan {
  /** Every entry, in the order it applies (unreadable ones first, then by the time sent). */
  results: InboxResult[];
  /** The files once every entry applied. */
  texts: InboxTexts;
  /** The texts that change. */
  changed: InboxTextKey[];
}

/** An entry file's text, checked: the entry, or what is wrong (with its kind and date when those can be read). */
export function readInboxEntry(text: string): { entry: InboxEntry } | { error: string; kind: InboxKind | null; date: IsoDate | null } {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (e) {
    return { error: `not valid JSON (${e instanceof Error ? e.message : String(e)})`, kind: null, date: null };
  }
  const errors = validateInboxEntry(raw);
  if (!errors.length) return { entry: raw as InboxEntry };
  const o = isObj(raw) ? raw : {};
  const kind = (INBOX_KINDS as readonly unknown[]).includes(o['kind']) ? (o['kind'] as InboxKind) : null;
  const date = typeof o['date'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o['date']) ? o['date'] : null;
  return { error: errors.slice(0, 6).map((e) => `${e.path}: ${e.message}`).join('; '), kind, date };
}

/** The moment an entry was sent, in UTC as the Coach files hold moments: what its writes carry, so two Macs write the same. */
const sentAt = (e: InboxEntry): string => toTs(parseTs(e.at)!);

/** Key order does not make two entries different. */
function canonical(v: unknown): string {
  const walk = (x: unknown): unknown => (Array.isArray(x) ? x.map(walk) : isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, walk(x[k])])) : x);
  return JSON.stringify(walk(v));
}

const parseText = (t: string | null): unknown => {
  if (t === null) return null;
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return undefined;
  }
};
const unreadable = (path: string) => `${path} is not valid JSON (an unresolved git conflict?): nothing was written`;
const list = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

type Step = { writes: InboxWrites; note: string; warnings: string[] } | { code: InboxCode; reason: string };

/**
 * The inbox's entries against the vault as it is: per entry, what it writes
 * (as the writers' own operations), that it is there already, or why it is
 * refused. Entries apply in the order they were sent, each on the files as
 * the ones before left them, so a later entry builds on an earlier one and a
 * second copy finds the first. Refused: an unreadable or invalid entry, a day
 * after today or more than 14 days back, a session not in the plan, an item
 * not tracked (or of another kind), a session already logged for that date
 * and type, an entry imported before (its applied/ file is there) or sent
 * twice, an amount already counted (its day's last change carries this
 * entry's time), and a value on record that differs (a conflict). A value
 * that is there already is never refused: the entry moves on with nothing to
 * write, so the same entry twice applies once.
 */
export function applyInbox(input: InboxRead, files: readonly InboxFile[], today: IsoDate): InboxPlan {
  const texts: InboxTexts = { ...input.texts };
  const results: InboxResult[] = [];
  const valid: { file: string; entry: InboxEntry }[] = [];
  for (const f of [...files].sort((a, b) => a.file.localeCompare(b.file))) {
    const r = readInboxEntry(f.text);
    if ('error' in r) results.push({ file: f.file, kind: r.kind, date: r.date, at: null, status: 'refused', code: 'invalid', reason: r.error });
    else valid.push({ file: f.file, entry: r.entry });
  }
  valid.sort((a, b) => parseTs(a.entry.at)! - parseTs(b.entry.at)! || a.file.localeCompare(b.file));
  const first = new Map<string, string>();
  for (const { file, entry } of valid) {
    const key = canonical(entry);
    const twin = first.get(key) ?? null;
    if (!twin) first.set(key, file);
    results.push(applyOne(input, texts, file, entry, today, twin));
  }
  return { results, texts, changed: INBOX_TEXT_KEYS.filter((k) => texts[k] !== input.texts[k]) };
}

function applyOne(input: InboxRead, texts: InboxTexts, file: string, e: InboxEntry, today: IsoDate, twin: string | null): InboxResult {
  const head = { file, kind: e.kind, date: e.date, at: e.at };
  const refuse = (code: InboxCode, reason: string): InboxRefused => ({ ...head, status: 'refused', code, reason });
  const day = `${dayText(e.date)} (${e.date})`;
  if (e.date > today) return refuse('future', `${day} is after today: the entry imports on the day itself`);
  if (e.date < addDays(today, -INBOX_DAYS)) return refuse('too-old', `${day} is more than ${INBOX_DAYS} days back: log it in Pahlavan, where the form shows what that day holds`);
  const moveTo = appliedPath(e.date, file);
  if (input.applied.includes(moveTo)) return refuse('already', `imported before (${paths().inbox}/${moveTo}): this copy is not applied again, so delete it`);
  if (twin) return refuse('already', `the same entry as ${twin}, which applies once: delete this copy`);
  let step: Step;
  switch (e.kind) {
    case 'session':
      step = sessionStep(input, texts, e, today);
      break;
    case 'tick':
      step = tickStep(input, texts, e, today);
      break;
    case 'amount':
      step = amountStep(input, texts, e);
      break;
    case 'morning':
      step = morningStep(texts, e);
      break;
    case 'trained':
      step = trainedStep(texts, e, today);
      break;
  }
  if ('code' in step) return refuse(step.code, step.reason);
  const status = Object.keys(step.writes).length ? 'apply' : 'unchanged';
  return { ...head, status, writes: step.writes, moveTo, note: step.note, warnings: step.warnings };
}

// ---------------------------------------------------------------- a session (the Log panel's save)

function sessionStep(input: InboxRead, texts: InboxTexts, e: Extract<InboxEntry, { kind: 'session' }>, today: IsoDate): Step {
  const plan = input.read.raw?.plan;
  const pd = readPlanData(plan);
  const s = e.session;
  if (!pd) return { code: 'unknown-type', reason: 'there is no plan to log a session against (plan-data.json)' };
  const types = [...pd.liftTypes, ...pd.shortTypes];
  if (!types.includes(s.type)) return { code: 'unknown-type', reason: `${s.type} is not one of the plan's sessions (${types.join(', ')})` };
  const name = input.read.data.plan.types.find((t) => t.type === s.type)?.label ?? s.type;
  const lifting = pd.liftTypes.includes(s.type);
  // The two logged lifts take the plan's names; the phone sends their top sets in order.
  const logged = lifting ? (pd.sessions[s.type] ?? []).filter((x) => x.logged).map((x) => x.name).slice(0, 2) : [];
  const given = [s.lift1, s.lift2] as const;
  const missing = logged.map((n, i) => (given[i] ? null : `lift${i + 1} (${n})`)).filter((x): x is string => x !== null);
  if (missing.length) return { code: 'invalid', reason: `${name} logs its top sets for ${logged.map((n, i) => `lift${i + 1}, ${n}`).join(' and ')}: the entry has no ${list(missing)}` };
  const lift = (i: 0 | 1) => {
    const li = given[i];
    if (!li) return null;
    return { name: logged[i] ?? '', weight: li.weight, reps: li.reps, ...(li.unit ? { unit: li.unit } : {}) };
  };
  const log = parseText(texts.log);
  if (log === undefined) return { code: 'unreadable', reason: unreadable(paths().log) };
  const built = buildLogEntry(
    { date: e.date, type: s.type, ...(lifting || s.lift1 || s.lift2 ? { lift1: lift(0), lift2: lift(1) } : {}), ...(s.express ? { express: true } : {}), durationMin: s.durationMin ?? null, rating: s.rating ?? null, notes: s.notes ?? '' },
    { plan, log, today },
  );
  if (!built.ok) return { code: 'invalid', reason: built.error };
  const m = mergeLog(texts.log, built.entry, { mode: 'add' });
  if (m.result === 'already') return { code: 'already', reason: `${name} is logged on ${dayText(e.date)} already: the log keeps that one (open it in Pahlavan to change it), so delete this entry` };
  if (m.result === 'unreadable') return { code: 'unreadable', reason: `${m.error}: nothing was written` };
  if (m.result === 'conflict') return { code: 'conflict', reason: `the log changed while this entry was read: it is tried again on the next refresh` };
  texts.log = m.text;
  const h = mergeHabit(texts.habits, e.date);
  if (h.result === 'ticked') texts.habits = h.text;
  const tops = [built.entry['lift1'], built.entry['lift2']].filter(isObj).map((l) => `${String(l['name'])} ${String(l['weight'])} ${String(l['unit'])} x ${String(l['reps'])}`);
  return {
    writes: { session: built.entry },
    note: `${name}${built.entry['express'] ? ' (Express)' : ''} on ${dayText(e.date)}${tops.length ? `: ${tops.join(', ')}` : ''}${h.result === 'ticked' ? ', and the Workout habit ticked' : ''}.`,
    warnings: [],
  };
}

// ---------------------------------------------------------------- ticks and amounts (Due today's writes)

/** What is tracked, on the files as the entries before left them. */
function trackingNow(input: InboxRead, texts: InboxTexts): TrackingRead | { error: string } {
  const tr = input.tracking;
  if (tr.files.tracking === 'invalid') return { error: `${tr.errors.find((x) => /tracking/.test(x.message))?.message ?? `${paths().tracking} is invalid`}: fix it first; nothing was written` };
  const tracking = parseText(texts.tracking);
  if (tracking === undefined) return { error: unreadable(paths().tracking) };
  const nudges = parseText(texts.nudges);
  return { ...tr, tracking: (tracking ?? null) as Tracking | null, habits: habitsView(parseText(texts.habits) ?? null), body: parseText(texts.body) ?? null, nudges: (nudges ?? null) as NudgeState | null };
}

const KIND_WORD: Record<TrackedItem['kind'], string> = { supplement: 'supplement', tick: 'tick', amount: 'amount', standup: 'stand-up item', sitting: 'sitting item', desk: 'desk-break item' };

/** Why an item is not the entry's kind: an amount is sent as an amount, a tick as a tick, and the counted ones not at all. */
function wrongKind(item: TrackedItem, want: 'tick' | 'amount'): string {
  if (item.kind === 'amount') return `${item.name} is an amount: send it as an amount entry`;
  if (item.kind === 'supplement' || item.kind === 'tick') return `${item.name} is a ${KIND_WORD[item.kind]}: send it as a tick entry`;
  return `${item.name} is a ${KIND_WORD[item.kind]}: Pahlavan counts it on each Mac, so it is not ${want === 'tick' ? 'ticked' : 'added to'} from the phone`;
}

/** The tracking ops merged into the texts (and the linked habits after them, a failure there a warning, as Due today's write treats it). */
function mergeDay(texts: InboxTexts, ops: TrackingOp[], habits: HabitChange[], warnings: string[]): { writes: InboxWrites; doc: Tracking | null } | { code: InboxCode; reason: string } {
  const t = mergeTracking(texts.tracking, ops);
  if (t.result === 'unreadable') return { code: 'unreadable', reason: t.error };
  if (t.result === 'invalid') return { code: 'invalid', reason: `Coach/tracking.json would not be valid: ${t.errors.join('; ')}` };
  if (t.result === 'conflict') return { code: 'conflict', reason: `Coach/tracking.json holds another value: ${t.conflicts.map((c) => c.what).join(', ')}` };
  const writes: InboxWrites = { tracking: ops };
  let doc: Tracking | null = null;
  if (t.result === 'merged') {
    texts.tracking = t.text;
    doc = t.doc;
  }
  if (habits.length) {
    const h = mergeHabitChanges(texts.habits, habits);
    if (h.result === 'unreadable') warnings.push(`the linked habit was not changed: ${h.error}`);
    else {
      for (const s of h.skipped) warnings.push(`the ${s.habit} habit was skipped: ${s.why}`);
      if (h.result === 'merged') texts.habits = h.text;
      writes.habits = habits;
    }
  }
  return { writes, doc };
}

function tickStep(input: InboxRead, texts: InboxTexts, e: Extract<InboxEntry, { kind: 'tick' }>, today: IsoDate): Step {
  const tr = trackingNow(input, texts);
  if ('error' in tr) return { code: 'unreadable', reason: tr.error };
  const items = tr.tracking?.items ?? [];
  if (!tr.tracking) return { code: 'unknown-item', reason: `nothing is tracked yet (no ${paths().tracking}): ${list(e.ids)} can't be ticked` };
  const unknown = e.ids.filter((id) => !items.some((x) => x.id === id));
  const ticks = items.filter((x) => x.kind === 'supplement' || x.kind === 'tick').map((x) => x.id);
  if (unknown.length) return { code: 'unknown-item', reason: `${list(unknown)} ${unknown.length === 1 ? 'is' : 'are'} not tracked (the ticks: ${ticks.join(', ') || 'none'})` };
  const wrong = e.ids.map((id) => items.find((x) => x.id === id)!).filter((x) => x.kind !== 'supplement' && x.kind !== 'tick');
  if (wrong.length) return { code: 'invalid', reason: wrong.map((x) => wrongKind(x, 'tick')).join('; ') };
  const p = planTick(input.read.data, tr, { ids: e.ids, date: e.date, done: e.done ?? true, at: sentAt(e) }, today);
  if (p.errors.length) return { code: p.errors.some((x) => x.code === 'not-started') ? 'not-started' : 'invalid', reason: p.errors.map((x) => x.message).join('; ') };
  const warnings = p.warnings.map((w) => w.message);
  const note = p.results.map((r) => r.note).join(' ');
  if (!p.ops.length && !p.habits.length) return { writes: {}, note, warnings };
  const m = mergeDay(texts, p.ops, p.habits, warnings);
  if ('code' in m) return m;
  return { writes: m.writes, note, warnings };
}

function amountStep(input: InboxRead, texts: InboxTexts, e: Extract<InboxEntry, { kind: 'amount' }>): Step {
  const tr = trackingNow(input, texts);
  if ('error' in tr) return { code: 'unreadable', reason: tr.error };
  if (!tr.tracking) return { code: 'unknown-item', reason: `nothing is tracked yet (no ${paths().tracking}): ${e.id} can't be added to` };
  const items = tr.tracking.items;
  const item = items.find((x) => x.id === e.id);
  if (!item) return { code: 'unknown-item', reason: `${e.id} is not tracked (the amounts: ${items.filter((x) => x.kind === 'amount').map((x) => x.id).join(', ') || 'none'})` };
  if (item.kind !== 'amount') return { code: 'invalid', reason: wrongKind(item, 'amount') };
  const off = buildTrackDay(input.read.data, tr, e.date).notDue.find((x) => x.id === e.id);
  if (off && (off.schedule === 'none' || off.schedule === 'future')) return { code: 'not-started', reason: `${item.name} starts ${item.start}: ${e.date} is before it` };
  const at = sentAt(e);
  // The day's last change carries the time of the entry that made it: this one counted already.
  if (tr.tracking.days[e.date]?.[e.id]?.at === at) return { code: 'already', reason: `${item.name} on ${dayText(e.date)} was last changed by this entry (sent ${e.at}): it is counted already, so delete this copy` };
  const warnings = off ? [`${item.name} is ${off.schedule === 'paused' ? 'paused' : 'not scheduled'} on ${e.date}; added anyway, as sent`] : [];
  const ops: TrackingOp[] = [{ op: 'add', item: e.id, date: e.date, field: 'amount', delta: e.add, at }];
  const habits: HabitChange[] = item.habit ? [{ habit: item.habit, date: e.date, add: e.add }] : [];
  const m = mergeDay(texts, ops, habits, warnings);
  if ('code' in m) return m;
  const total = m.doc?.days[e.date]?.[e.id]?.amount ?? 0;
  const unit = item.amount?.unit ?? '';
  const habitName = item.habit ? (tr.habits?.habits.find((h) => h.id === item.habit)?.name ?? item.habit) : null;
  return {
    writes: m.writes,
    note: `${item.name}: ${e.add > 0 ? '+' : ''}${e.add} ${unit} on ${dayText(e.date)}, ${total} of ${item.amount?.target ?? '?'} ${unit} now${habitName && m.writes.habits ? `, and the same on the ${habitName} habit` : ''}.`,
    warnings,
  };
}

// ---------------------------------------------------------------- the morning check-in (its card's save)

// The morning card's own questions (core/morning.ts): an entry with none of them only fills its numbers.

function morningStep(texts: InboxTexts, e: Extract<InboxEntry, { kind: 'morning' }>): Step {
  const values: MorningValues = {};
  for (const k of MORNING_KEYS) {
    const v = e.morning[k];
    if (v === undefined) continue;
    // body-data.json holds kg, to 0.1 as the forms save it.
    values[k] = k === 'weight' && e.morning.weightUnit === 'lb' ? Math.round((v / LB_PER_KG) * 10) / 10 : v;
  }
  // Only the card's own questions make the check-in done: Health's numbers alone (steps, resting HR, sleep,
  // weight) fill their fields and leave the card to ask energy, soreness and sleep quality.
  const asked = MORNING_QUESTIONS.some((k) => e.morning[k] !== undefined);
  const change: MorningChange = { values, baseline: {}, ...(asked ? { checkedAt: sentAt(e) } : {}) };
  const m = mergeMorning(texts.body, e.date, change);
  const label = (k: (typeof MORNING_KEYS)[number]) => MORNING_LIMITS[k].label;
  switch (m.result) {
    case 'invalid':
      return { code: 'invalid', reason: m.errors.join('; ') };
    case 'unreadable':
      return { code: 'unreadable', reason: `${m.error}: nothing was written` };
    case 'conflict':
      return {
        code: 'conflict',
        reason: `${m.conflicts.map((c) => `${label(c.key)} on ${dayText(dayOfField(c.key, e.date))} is ${String(c.disk)} in body-data.json, the phone says ${String(c.mine)}`).join('; ')}: nothing was written (change it on the Check-in screen if the phone's is right, then delete this entry)`,
      };
    case 'unchanged':
      return { writes: {}, note: `body-data.json holds these morning fields for ${dayText(e.date)} already.`, warnings: [] };
    case 'merged': {
      texts.body = m.text;
      const later = m.changed.filter((k) => YESTERDAY_KEYS.includes(k));
      return {
        writes: { morning: change },
        note: `The morning check-in for ${dayText(e.date)}: ${m.changed.map(label).join(', ')}${later.length ? ` (${later.map(label).join(' and ')} on ${dayText(addDays(e.date, -1))}, the day they count for)` : ''}.`,
        warnings: [],
      };
    }
  }
}

// ---------------------------------------------------------------- "Did you train today?" (its card's answers)

/** The evening card's answer for each phone answer: Log session, Rest day, Not today. */
export const TRAINED_HOW: Record<TrainedAnswer, NudgeAnswer> = { trained: 'logged', rest: 'rest', missed: 'not-today' };
const HOW_WORDS: Partial<Record<NudgeAnswer, string>> = { logged: 'Log session', rest: 'Rest day', 'not-today': 'Not today' };

function trainedStep(texts: InboxTexts, e: Extract<InboxEntry, { kind: 'trained' }>, today: IsoDate): Step {
  const log = parseText(texts.log);
  const body = parseText(texts.body);
  const nudges = parseText(texts.nudges);
  if (log === undefined) return { code: 'unreadable', reason: unreadable(paths().log) };
  if (body === undefined) return { code: 'unreadable', reason: unreadable(paths().body) };
  if (nudges === undefined) return { code: 'unreadable', reason: unreadable(paths().nudges) };
  const day = dayText(e.date);
  const sessions = isObj(log) && Array.isArray(log['sessions']) ? (log['sessions'] as unknown[]).filter((s) => isObj(s) && s['date'] === e.date) : [];
  const days = isObj(body) && isObj(body['days']) ? body['days'] : {};
  const markRaw = isObj(days[e.date]) ? (days[e.date] as Obj)['mark'] : undefined;
  const mark = markRaw === 'rest' || markRaw === 'missed' ? markRaw : null;
  const habits = habitsView(parseText(texts.habits) ?? null);
  const workout = habits?.checkins[habitKey(e.date)] === '1';
  const card = (nudges as NudgeState | null)?.days?.[e.date]?.['train']?.how ?? null;
  const how = TRAINED_HOW[e.answer];
  if (card !== null && card !== how) return { code: 'conflict', reason: `"Did you train today?" for ${day} was answered ${HOW_WORDS[card] ?? card} on the Mac, the phone says ${e.answer}: nothing was written` };
  const warnings: string[] = [];
  const writes: InboxWrites = {};
  if (e.answer === 'trained') {
    if (mark) return { code: 'conflict', reason: `${day} is marked ${mark}, the phone says trained: nothing was written (clear the mark in Pahlavan if you trained)` };
    if (sessions.length) return { writes: {}, note: `A session is logged on ${day}: it counts as trained already.`, warnings };
    if (!workout) {
      const h = mergeHabit(texts.habits, e.date);
      if (h.result === 'ticked') {
        texts.habits = h.text;
        writes.workout = true;
      } else if (h.result === 'unreadable') warnings.push(`the Workout habit was not ticked: ${h.error}`);
    }
  } else {
    if (sessions.length) return { code: 'conflict', reason: `a session is logged on ${day}, the phone says ${e.answer}: nothing was written` };
    if (workout) return { code: 'conflict', reason: `the Workout habit is ticked on ${day}, the phone says ${e.answer}: nothing was written` };
    if (mark && mark !== e.answer) return { code: 'conflict', reason: `${day} is marked ${mark}, the phone says ${e.answer}: nothing was written` };
    const mk = mergeDayMark(texts.body, e.date, e.answer);
    if (mk.result === 'unreadable') return { code: 'unreadable', reason: `${mk.error}: nothing was written` };
    if (mk.result === 'merged') {
      texts.body = mk.text;
      writes.mark = e.answer;
    }
  }
  const changes: NudgeChange[] = [{ date: e.date, key: 'train', set: { how, at: sentAt(e), by: PHONE_BY } }];
  const n = mergeNudges(texts.nudges, changes, { today });
  if (n.result === 'unreadable') return { code: 'unreadable', reason: `${n.error}` };
  if (n.result === 'invalid') return { code: 'invalid', reason: `Coach/nudges.json would not be valid: ${n.errors.join('; ')}` };
  if (n.result === 'conflict') return { code: 'conflict', reason: `"Did you train today?" for ${day} has another answer on the Mac: nothing was written` };
  if (n.result === 'merged' && n.changed.some((c) => c.startsWith('train '))) {
    texts.nudges = n.text;
    writes.nudges = changes;
  }
  const said = e.answer === 'trained' ? 'trained' : e.answer === 'rest' ? 'a rest day' : 'missed';
  const what = [writes.mark ? `marked ${e.answer}` : null, writes.workout ? 'the Workout habit ticked' : null, writes.nudges ? `"Did you train today?" answered ${HOW_WORDS[how]}` : null].filter(Boolean);
  return { writes, note: what.length ? `${day}, ${said}: ${list(what as string[])}.` : `${day} is ${said} on record already.`, warnings };
}

// ---------------------------------------------------------------- refused.json

/** One refused entry, as refused.json lists it (both Macs read it: the Data notes and Due today). */
export interface RefusedEntry {
  file: string;
  /** The day it counts for, when the entry says so. */
  date: IsoDate | null;
  kind: InboxKind | null;
  code: InboxCode;
  reason: string;
}

/** The refused entries, by file name. */
export function refusedOf(results: readonly InboxResult[]): RefusedEntry[] {
  return results
    .filter((r): r is InboxRefused => r.status === 'refused')
    .map((r) => ({ file: r.file, date: r.date, kind: r.kind, code: r.code, reason: r.reason }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

/** refused.json's text: rewritten each run, the same text for the same refusals (no clock), so two Macs write it alike. */
export function refusedText(entries: readonly RefusedEntry[]): string {
  return `${JSON.stringify({ v: INBOX_VERSION, refused: entries }, null, 2)}\n`;
}

/** refused.json as read (an unreadable file reads as none). */
export function readRefused(text: string | null): RefusedEntry[] {
  const v = parseText(text);
  if (!isObj(v) || !Array.isArray(v['refused'])) return [];
  return (v['refused'] as unknown[]).filter((x): x is RefusedEntry => isObj(x) && typeof x['file'] === 'string' && typeof x['reason'] === 'string').map((x) => ({
    file: x.file,
    date: typeof x.date === 'string' ? x.date : null,
    kind: (INBOX_KINDS as readonly unknown[]).includes(x.kind) ? x.kind : null,
    code: typeof x.code === 'string' ? x.code : 'invalid',
    reason: x.reason,
  }));
}

/** A refused entry in words, for the Data notes and Due today. */
export const refusedLine = (r: RefusedEntry): string => `${r.file}: ${r.reason}`;

// ---------------------------------------------------------------- phone.json (what the shortcuts read)

/** The last top set logged for a lift (as lift1 or lift2, by its name or its planned name), from the log as read. */
function lastTop(log: unknown, name: string): { date: IsoDate; weight: number; reps: number; unit: string } | null {
  const sessions = isObj(log) && Array.isArray(log['sessions']) ? (log['sessions'] as unknown[]).filter(isObj) : [];
  let best: { date: IsoDate; weight: number; reps: number; unit: string } | null = null;
  for (const s of sessions) {
    for (const k of ['lift1', 'lift2']) {
      const l = s[k];
      if (!isObj(l) || (l['name'] !== name && l['planned'] !== name)) continue;
      const w = l['weight'];
      const r = l['reps'];
      if (typeof w !== 'number' || typeof r !== 'number' || (w === 0 && r === 0) || typeof s['date'] !== 'string') continue;
      if (!best || s['date'] >= best.date) best = { date: s['date'], weight: w, reps: r, unit: String(l['unit'] ?? '') };
    }
  }
  return best;
}

/**
 * Coach/Inbox/phone.json for a date: what the phone's shortcuts read with
 * one GET. Today's items the phone can log (supplements and ticks, done or
 * not, and the amounts with their totals) with `open`, the ones not done; the
 * plan's sessions (type, name, the two logged lifts with their units and last
 * top sets, whether Express is there); the rotation's next session for the
 * calendar's day; the sessions logged today; the morning check-in's fields
 * with their limits, words and today's values; the evening answers; and the
 * entry format. No clock in it, so the same vault gives the same file on
 * both Macs.
 */
export function buildPhone(read: VaultRead, tr: TrackingRead, date: IsoDate) {
  const data = read.data;
  const day = buildTrackDay(data, tr, date);
  const tracked = tr.tracking?.items ?? [];
  const items = day.items
    .map((x) => x.value)
    .filter((x) => x.kind === 'supplement' || x.kind === 'tick' || x.kind === 'amount')
    .map((x) => {
      const it = tracked.find((i) => i.id === x.id);
      if (x.kind === 'amount') return { id: x.id, name: x.name, kind: x.kind, unit: x.unit ?? '', value: x.value ?? 0, target: x.target ?? 0, quick: it?.amount?.quick ?? [], done: x.done };
      return { id: x.id, name: x.name, kind: x.kind, ...(it?.dose ? { dose: it.dose } : {}), done: x.done };
    });
  const plan = read.raw?.plan;
  const pd = readPlanData(plan);
  const log = read.raw?.log;
  const sessions = pd
    ? data.plan.types.map((t) => {
        const lifting = t.kind === 'lift';
        const lifts = lifting ? (pd.sessions[t.type] ?? []).filter((x) => x.logged).slice(0, 2) : [];
        return {
          type: t.type,
          name: t.label,
          kind: t.kind,
          express: lifting && data.plan.express !== null,
          lifts: lifts.map((x, i) => ({ slot: `lift${i + 1}`, name: x.name, unit: String(liftUnit(plan as Obj, x.name) ?? data.plan.liftUnit), last: lastTop(log, x.name) })),
        };
      })
    : [];
  // The rotation's next for the calendar's day, as Today suggests it (even once today's is logged: the one after it).
  const weekday = daysBetween(mondayOf(date), date);
  const liftDay = (CALENDAR.liftDays as readonly number[]).includes(weekday) || !data.plan.types.some((t) => t.kind === 'short');
  const rot = sessions.length ? rotationNext(data, date) : { lift: null, short: null };
  const nextType = (liftDay ? rot.lift : rot.short) ?? rot.lift ?? rot.short;
  const nextSession = sessions.find((s) => s.type === nextType) ?? null;
  const values = morningFrom(tr.body, date).values;
  const training = day.training.value;
  return {
    v: INBOX_VERSION,
    date,
    items,
    open: day.open,
    sessions,
    next: nextSession ? { type: nextSession.type, name: nextSession.name, kind: nextSession.kind } : null,
    logged: training.sessions.map((s) => s.type),
    morning: {
      done: day.morning.value.done,
      weightUnit: bodyUnitsOf(data.profile).value.weight,
      fields: MORNING_KEYS.map((k) => ({
        id: k,
        label: MORNING_LIMITS[k].label,
        min: MORNING_LIMITS[k].min,
        max: MORNING_LIMITS[k].max,
        whole: MORNING_LIMITS[k].int,
        ...MORNING_WORDS[k],
        day: YESTERDAY_KEYS.includes(k) ? 'yesterday' : 'today',
        value: values[k],
      })),
    },
    trained: { answers: TRAINED_ANSWERS, logged: training.logged, workout: training.workoutTicked, mark: training.mark, answer: training.didYouTrain?.answer ?? null },
    inbox: { dir: paths().inbox, name: ENTRY_NAME, v: INBOX_VERSION, kinds: INBOX_KINDS, days: INBOX_DAYS },
  };
}

export type PhoneFile = ReturnType<typeof buildPhone>;

/** phone.json's text. */
export const phoneText = (p: PhoneFile): string => `${JSON.stringify(p, null, 2)}\n`;
