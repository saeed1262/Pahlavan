// The Log panel's form rebuilt from the plan when its session, version or
// date changes. A new date takes that date's plan: its session (the one the
// user chose stays; the suggestion follows the date, and so does the
// "Something else" a day without a plan opened on, until it has a label),
// its exercises, the deload sets and the ladder levels as they stood that
// day; a session already logged that day opens as an edit of it. What the
// user typed stays where the new form has the same field: the session's
// answers, and each row's done or skipped, its swap, its top set and its
// sets, by the checklist line; a value still as the form started (the
// plan's minutes, today's ticks) gives way to the new form's. Pure: `read`
// is the files as read for the form's (new) date, so its ladder levels are
// that day's.

import { sessionKey } from '../../src/adapters/vault/log-write.ts';
import type { VaultRead } from '../../src/adapters/vault/read.ts';
import type { IsoDate } from '../../src/core/schema.ts';
import type { SessionMode } from '../../src/core/variant.ts';
import { blankSet, customLogForm, logFormFor, logFormFromEntry, type FormRow, type LogForm } from '../../src/report/log-form.ts';
import { buildSession } from '../../src/report/session.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The session logged on `date` as `type` (a custom one by its label), or null. */
export function loggedEntry(read: VaultRead, date: IsoDate, type: string, label: string | null = null): Obj | null {
  const log = read.raw?.log;
  const list = isObj(log) && Array.isArray(log['sessions']) ? (log['sessions'] as unknown[]) : [];
  const key = sessionKey({ date, type, label: type === 'custom' ? label : undefined });
  return (list.find((s) => isObj(s) && sessionKey(s) === key) as Obj | undefined) ?? null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What the user set, kept across a rebuild: the session's own answers
 * (RPE, notes, pain, tracking), the fields the plan fills in only when the
 * user changed them from the form's start (minutes, cardio, its mode,
 * rating, posture), and each row's changes on the new form's row for the
 * same checklist line. The sore muscles only on the same date: they belong
 * to that day's body record.
 */
function carry(from: LogForm, to: LogForm, sameDay: boolean): LogForm {
  to.rpe = from.rpe;
  to.notes = from.notes;
  to.painOn = from.painOn;
  to.pain = from.pain;
  to.tracking = from.tracking;
  if (sameDay) to.sore = from.sore;
  const start = from.start;
  if (!start) return to;
  if (from.minutes !== start.minutes) to.minutes = from.minutes;
  if (from.cardio !== start.cardio) to.cardio = from.cardio;
  if (from.cardioMode !== start.cardioMode) to.cardioMode = from.cardioMode;
  if (from.rating !== start.rating) to.rating = from.rating;
  if (from.posture !== start.posture) to.posture = from.posture;
  for (const r of from.rows) {
    const was = start.rows[r.key];
    const into = to.rows.find((x) => (r.line !== null ? x.line === r.line : x.line === null && x.name === r.name));
    if (was && into) carryRow(r, was, into);
  }
  return to;
}

/** One row's changes from its start onto the new form's row: done or skipped and why, the user's swap, the top set and every set (for the same exercise). */
function carryRow(r: FormRow, was: NonNullable<LogForm['start']>['rows'][string], into: FormRow): void {
  if (r.done !== was.done || r.why !== was.why) {
    into.done = r.done;
    into.why = r.why;
  }
  if (r.name !== was.name || r.planned !== was.planned) {
    // The user's swap, or its undo, as the row's Swap menu sets it: a logged lift starts blank.
    into.name = r.name;
    into.planned = r.planned;
    into.swapWhy = r.swapWhy;
    if (into.lift !== null && r.swapWhy === 'Your swap') Object.assign(into, { target: null, top: { weight: null, reps: null }, targetNote: 'New to the log: enter what you used.' });
    // The new form's sets are the planned exercise's: a swap starts them blank, as the Swap menu does.
    if (r.swapWhy === 'Your swap') into.rows = into.rows.map(blankSet);
  }
  if (into.name !== r.name) return;
  if (!same(r.top, was.top)) into.top = { ...r.top };
  // Every set, once one holds a value or a tick the user gave (the panel fills empty ones from the top set).
  const given = (rows: FormRow['rows']) => rows.some((x) => x.weight !== null || x.reps !== null || x.rir !== null || x.done);
  if (!same(r.rows, was.rows) && given(r.rows)) into.rows = r.rows.map((x) => ({ ...x }));
  // A superset's parts, the same way, part by part.
  if (r.split && into.split) {
    for (const p of r.split) {
      const wasP = was.split?.find((x) => x.name === p.name);
      const intoP = into.split.find((x) => x.name === p.name);
      if (intoP && !same(p.rows, wasP?.rows) && given(p.rows)) intoP.rows = p.rows.map((x) => ({ ...x }));
    }
  }
}

/**
 * The form after a change of session (`type`), version (`mode`) or `date`.
 * An edit keeps what was logged: its date can move (Save then moves the
 * session) and nothing is rebuilt. Null when the plan has no such session
 * for the date and nothing else fits (the form then stays as it is).
 */
export function rebuildForm(read: VaultRead, form: LogForm, change: { type?: string; mode?: SessionMode; date?: IsoDate }): LogForm | null {
  const date = change.date ?? form.date;
  const newDay = date !== form.date;
  if (form.edit) return newDay ? { ...form, date } : null;
  const mode = change.mode ?? form.mode;
  // On a new date the user's own choice stays; the suggestion follows the date, and so does
  // "Something else" on a day with no suggestion and no label yet (the panel opened on it).
  const fallback = form.type === 'custom' && form.suggested === null && !(form.label ?? '').trim();
  const chosen = change.type ?? (newDay && (form.type === form.suggested || fallback) ? null : form.type);
  const day = newDay ? buildSession(read.data, date, 'full', {}) : null;
  const choices = day?.session ? day.choices : form.choices;
  const suggested = day ? (day.session?.type ?? null) : form.suggested;
  if (chosen === 'custom') {
    const label = form.type === 'custom' ? (form.label ?? '') : '';
    const logged = newDay && label ? loggedEntry(read, date, 'custom', label) : null;
    return logged ? logFormFromEntry(read, logged) : carry(form, customLogForm(read, date, label, choices, suggested), !newDay);
  }
  const sess = buildSession(read.data, date, mode, chosen ? { type: chosen } : {});
  const next = sess.session ? logFormFor(read, sess, date) : null;
  if (!next) return newDay ? carry(form, customLogForm(read, date, '', choices, suggested), false) : null;
  if (newDay) {
    const logged = loggedEntry(read, date, next.type);
    if (logged) return logFormFromEntry(read, logged);
  }
  return carry(form, next, !newDay);
}
