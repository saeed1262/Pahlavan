// Each planned exercise's facts over a span, from the log: how often it was
// planned, done as planned, skipped (with the Log panel's reasons), swapped
// (with the swap's reason and what was done in its place), and not recorded
// (an older entry with no checklist, so done or skipped can't be told), with
// the last day it was done. An exercise is the plan's: a swap counts for the
// exercise it replaced (the plan's name, which the adapter keeps on the
// slot), and an Express session's left-out items were not planned that day
// (its frozen list holds only its block). Pure: the dates are inputs.

import { dayText, type IsoDate } from './dates.ts';
import { exerciseId } from './plan-data.ts';
import { explain, joinNotes, titleFor, type Result } from './reason.ts';
import { SKIP_REASONS, SWAP_REASONS, type ExerciseSlot, type Session, type SkipReason, type SwapReason } from './schema.ts';

/** The Log panel's word for each swap reason: the reason's title on the row ("Injury limit"), or the row's own "Your swap". */
export const SWAP_WORDS: Readonly<Record<SwapReason, string>> = {
  mine: 'Your swap',
  ledger: titleFor('safety.ledger'),
  soreness: titleFor('soreness'),
  hotel: titleFor('variant.hotel'),
};

/**
 * A swap's reason as the log keeps it, from a reason (mine, ledger,
 * soreness, hotel) or the Log panel's word for one ("Your swap", "Injury
 * limit", "Soreness", "Hotel swap"), in any case. Null for none: nothing, or
 * the bare "Swap" an edit shows for a swap saved without a reason. Undefined
 * for anything else.
 */
export function swapReasonOf(v: unknown): SwapReason | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim().toLowerCase();
  if (!t || t === 'swap') return null;
  return SWAP_REASONS.find((r) => r === t || SWAP_WORDS[r].toLowerCase() === t);
}

/** A slot as the adapter reads it: the exercise done, with the plan's name and the swap's reason when another was done in its place. */
type FactSlot = ExerciseSlot & { _planned?: string; _swapWhy?: SwapReason };

export interface FactTally {
  /** Times in a session's plan (its frozen exercise list). */
  planned: number;
  /** Done as planned: not skipped or swapped, in a session that recorded its checklist (or with its own sets logged). */
  asPlanned: number;
  /** Skipped, by the Log panel's reason (`none`: no reason given). */
  skipped: { n: number; reasons: Record<SkipReason | 'none', number> };
  /** Done as another, by the swap's reason (`unknown`: an older entry, saved without one), and what was done in its place. */
  swapped: { n: number; why: Record<SwapReason | 'unknown', number>; to: { name: string; n: number }[] };
  /** In an older entry with no checklist and none of its sets logged: done or skipped can't be told. */
  unrecorded: number;
}

export interface ExerciseFact extends FactTally {
  id: string;
  name: string;
  /** The last day it was done (its own sets logged, or done as planned in a session with its checklist), up to the span's end; null when never. */
  lastDone: IsoDate | null;
  /** The same counts over the last 4 weeks. */
  last4: FactTally;
  /** The row in words, to quote. */
  note: string;
}

export interface ExerciseFacts {
  /** The span: its first day (null: every session) and last, and where the last 4 weeks begin. */
  from: IsoDate | null;
  to: IsoDate;
  last4From: IsoDate;
  /** Sessions in the span with a plan, and how many of them are older entries with no checklist. */
  sessions: number;
  unrecordedSessions: number;
  /** Sessions with no saved exercise list, left out: their plan is today's, rebuilt, not that day's. */
  leftOut: number;
  exercises: ExerciseFact[];
}

export interface FactOptions {
  from: IsoDate | null;
  to: IsoDate;
  last4From: IsoDate;
  /** Whether a session recorded what was done and skipped (a checklist); the default: every session did. */
  recorded?: (s: Session) => boolean;
  /** An exercise's display name (the default: the plan's name a swap keeps, else the id). */
  nameOf?: (id: string) => string | null;
}

const tally = (): FactTally => ({
  planned: 0,
  asPlanned: 0,
  skipped: { n: 0, reasons: { ...Object.fromEntries(SKIP_REASONS.map((r) => [r, 0])), none: 0 } as FactTally['skipped']['reasons'] },
  swapped: { n: 0, why: { ...Object.fromEntries(SWAP_REASONS.map((r) => [r, 0])), unknown: 0 } as FactTally['swapped']['why'], to: [] },
  unrecorded: 0,
});

const SWAP_SAID: Readonly<Record<SwapReason | 'unknown', string>> = { mine: 'your swap', ledger: 'the Ledger', soreness: 'soreness', hotel: 'the Hotel version', unknown: 'reason not saved' };
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const counts = <K extends string>(r: Record<K, number>, word: (k: K) => string) =>
  (Object.entries(r) as [K, number][]).filter(([, n]) => n > 0).map(([k, n]) => `${word(k)} ${n}`).join(', ');

function rowNote(name: string, t: FactTally, lastDone: IsoDate | null): string {
  const parts = [
    `planned ${times(t.planned)}`,
    `done as planned ${t.asPlanned}`,
    t.skipped.n > 0 && `skipped ${t.skipped.n} (${counts(t.skipped.reasons, (k) => (k === 'none' ? 'no reason' : k))})`,
    t.swapped.n > 0 && `swapped ${t.swapped.n} (${counts(t.swapped.why, (k) => SWAP_SAID[k])}; for ${t.swapped.to.map((x) => `${x.name}${x.n > 1 ? ` ${x.n}` : ''}`).join(', ')})`,
    t.unrecorded > 0 && `${t.unrecorded} not recorded (an older entry with no checklist)`,
  ].filter((x): x is string => Boolean(x));
  return `${name}: ${parts.join(', ')}; ${lastDone ? `last done ${dayText(lastDone)}` : 'no day recorded as done yet'}.`;
}

/**
 * Every exercise the plan held in the span's sessions, from their frozen
 * plan (`Session.plan`): planned, done as planned, skipped, swapped and not
 * recorded, over the span and its last 4 weeks, and the last day it was
 * done. Rows come most skipped or swapped first. A session whose plan was
 * rebuilt from today's (no saved exercise list) is left out and counted.
 */
export function exerciseFacts(sessions: readonly Session[], opts: FactOptions): Result<ExerciseFacts> {
  const recorded = opts.recorded ?? (() => true);
  const rebuilt = (s: Session) => Boolean((s.plan as { _rebuilt?: true } | undefined)?._rebuilt);
  const upTo = [...sessions].filter((s) => s.date <= opts.to).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const inSpan = upTo.filter((s) => s.plan && (opts.from === null || s.date >= opts.from));
  const used = inSpan.filter((s) => !rebuilt(s));
  const logged = (s: Session, id: string) => s.exercises.some((x) => x.exercise === id && x.sets.length > 0);
  const rows = new Map<string, { id: string; name: string; all: FactTally; last4: FactTally }>();
  for (const s of used) {
    const rec = recorded(s);
    for (const slot of s.plan!.slots as FactSlot[]) {
      const id = slot._planned ? exerciseId(slot._planned) : slot.exercise;
      const row = rows.get(id) ?? { id, name: opts.nameOf?.(id) ?? slot._planned ?? id, all: tally(), last4: tally() };
      rows.set(id, row);
      const skipped = (s.skipped ?? []).includes(slot.exercise);
      for (const t of s.date >= opts.last4From ? [row.all, row.last4] : [row.all]) {
        t.planned++;
        if (skipped) {
          t.skipped.n++;
          t.skipped.reasons[s.skipWhy?.[slot.exercise] ?? 'none']++;
        } else if (slot._planned) {
          // A Hotel session's swap saved without a reason is the Hotel version's.
          t.swapped.n++;
          t.swapped.why[slot._swapWhy ?? (s.hotel ? 'hotel' : 'unknown')]++;
          const to = opts.nameOf?.(slot.exercise) ?? slot.exercise;
          const had = t.swapped.to.find((x) => x.name === to);
          if (had) had.n++;
          else t.swapped.to.push({ name: to, n: 1 });
        } else if (rec || logged(s, slot.exercise)) t.asPlanned++;
        else t.unrecorded++;
      }
    }
  }
  // Done: its own sets logged, or a slot for it not skipped in a session with its checklist (never a rebuilt plan's).
  const doneOn = (s: Session, id: string) => logged(s, id) || (!rebuilt(s) && recorded(s) && (s.plan?.slots ?? []).some((x) => x.exercise === id && !(s.skipped ?? []).includes(id)));
  const out: ExerciseFact[] = [...rows.values()].map((r) => {
    for (const t of [r.all, r.last4]) t.swapped.to.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    const lastDone = upTo.filter((s) => doneOn(s, r.id)).at(-1)?.date ?? null;
    return { id: r.id, name: r.name, ...r.all, lastDone, last4: r.last4, note: rowNote(r.name, r.all, lastDone) };
  });
  out.sort((a, b) => b.skipped.n + b.swapped.n - (a.skipped.n + a.swapped.n) || b.planned - a.planned || a.name.localeCompare(b.name));
  const unrecordedSessions = used.filter((s) => !recorded(s)).length;
  const leftOut = inSpan.length - used.length;
  const skips = out.reduce((n, x) => n + x.skipped.n, 0);
  const swaps = out.reduce((n, x) => n + x.swapped.n, 0);
  const value: ExerciseFacts = { from: opts.from, to: opts.to, last4From: opts.last4From, sessions: used.length, unrecordedSessions, leftOut, exercises: out };
  return explain(value, 'exercises', { from: opts.from, to: opts.to, last4From: opts.last4From, sessions: used.length, unrecordedSessions, leftOut }, {
    note: joinNotes(
      `${opts.from ? `Since ${dayText(opts.from)}` : 'Every logged session'} to ${dayText(opts.to)}: ${used.length} session${used.length === 1 ? '' : 's'} with a plan, ${out.length} exercise${out.length === 1 ? '' : 's'} in them, skipped ${skips} and swapped ${swaps} in all; the last 4 weeks from ${dayText(opts.last4From)}.`,
      unrecordedSessions > 0 && `${unrecordedSessions === 1 ? '1 of the sessions is an older entry' : `${unrecordedSessions} of the sessions are older entries`} with no checklist: ${unrecordedSessions === 1 ? 'its' : 'their'} items count as not recorded, unless their sets were logged.`,
      leftOut > 0 && `${leftOut} session${leftOut === 1 ? '' : 's'} with no saved exercise list left out: ${leftOut === 1 ? 'its plan is' : 'their plan is'} today's, not that day's.`,
    ),
  });
}
