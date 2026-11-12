// The gym page's model: the link's data read from the `#` part, the working
// state of one session (each set's weight, reps and RIR and its tick, a row
// skipped and why, a superset's parts each with their own sets, the start
// at the first tick, minutes, cardio minutes, notes, when it was sent, the
// rest running), the actions on it, and the session entry Send hands to the
// Pahlavan shortcut, as the Mac's Log panel turns its form into the log's
// input at Every set. Pure: no DOM; the clock is an argument.

import { gymFromHash, type GymData, type GymEntry, type GymEntryLift, type GymEntrySet, type GymKind, type GymPart, type GymRow, type GymSession, type GymSet, type GymSkipReason, type GymTarget } from '../../src/core/gym.ts';
import type { SwapReason } from '../../src/core/schema.ts';

export const NO_DATA = 'Open this page from the Pahlavan shortcut’s Gym item.';
/** The `#` part the Pahlavan shortcut's Gym item opens the page with: the day's sessions wait on the clipboard. */
export const PASTE_MARK = 'paste';
/** Where the page keeps the sessions it was last given (the link's `#` part), so a reload or a closed tab opens on them. */
export const DATA_KEY = 'pahlavan-gym-data';
export const LOAD_LEAD = 'The Gym item copied today’s sessions.';
export const LOAD_BUTTON = 'Load today’s session';
export const LOAD_HINT = 'If your phone asks, tap Paste.';
export const LOAD_FAILED = 'The clipboard doesn’t hold a gym session. Run the Gym item in the Pahlavan shortcut again, then tap Load.';
export const PAIN_LINE = 'Skip or swap it; if it persists, see a professional.';
export const SKIP_REASONS: readonly { id: GymSkipReason; label: string }[] = [
  { id: 'time', label: 'Time' },
  { id: 'pain', label: 'Pain' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'energy', label: 'Energy' },
];
/** The Log panel's word for each swap reason (its `SWAP_WORDS`, src/core/exercise-facts.ts). */
export const SWAP_LABELS: Readonly<Record<SwapReason, string>> = { mine: 'Your swap', ledger: 'Injury limit', soreness: 'Soreness', hotel: 'Hotel swap' };
/** Progress older than this many days is cleared from the phone. */
export const KEEP_DAYS = 3;
/** How long "Rest over" stays up after the countdown ends. */
export const REST_OVER_MS = 30_000;

export interface SetState {
  weight: number | null;
  /** Seconds on a timed row. */
  reps: number | null;
  rir: number | null;
  ticked: boolean;
}

export interface RowState {
  /** What the row is (its exercise, the plan's it replaces, its kind, a superset's parts): stored progress lands only on the same. */
  id: string;
  /** A strength row's sets (none for a superset, a warm-up or cardio). */
  sets: SetState[];
  /** A superset: each part's sets, in the row's `parts` order. */
  parts: SetState[][];
  /** A warm-up or cardio row's own tick. */
  ticked: boolean;
  skipped: boolean;
  why: GymSkipReason | null;
}

export interface RestState {
  key: string;
  /** When the rest ends (ms since the epoch). */
  until: number;
  seconds: number;
}

export interface GymState {
  v: 1;
  date: string;
  type: string;
  mode: 'full' | 'express';
  rows: Record<string, RowState>;
  /** The first tick (ms since the epoch): the session's start. */
  startedAt: number | null;
  /** Minutes as typed; null: from the first tick to Send. */
  minutes: number | null;
  /** The cardio row's minutes. */
  cardio: number;
  notes: string;
  sentAt: number | null;
  rest: RestState | null;
}

/** Which set: a row's own (`part` null) or a superset part's. */
export interface SetRef {
  key: string;
  part: number | null;
  i: number;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const KINDS: readonly GymKind[] = ['warmup', 'load', 'reps', 'timed', 'cardio'];
const STRENGTH: readonly GymKind[] = ['load', 'reps', 'timed'];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A kind with sets, saved as an exercise's sets: loaded, bodyweight reps, timed. */
export const isStrength = (k: GymKind): boolean => STRENGTH.includes(k);
/** A superset row: its parts carry the sets. */
export const isSuperset = (r: GymRow): r is GymRow & { parts: GymPart[] } => Array.isArray(r.parts) && r.parts.length > 0;
/** A row ticked set by set (a strength row or a superset); a warm-up or cardio row has its own tick. */
export const hasSets = (r: GymRow): boolean => isSuperset(r) || isStrength(r.kind);
export const isReason = (v: unknown): v is GymSkipReason => SKIP_REASONS.some((r) => r.id === v);

// ---------------------------------------------------------------- the link

function isRow(v: unknown): v is GymRow {
  if (!isObj(v)) return false;
  if (typeof v['key'] !== 'string' || typeof v['name'] !== 'string' || !KINDS.includes(v['kind'] as GymKind) || !Array.isArray(v['rows'])) return false;
  if (v['parts'] !== undefined && !(Array.isArray(v['parts']) && v['parts'].every((p) => isObj(p) && typeof p['name'] === 'string' && KINDS.includes(p['kind'] as GymKind) && Array.isArray(p['rows'])))) return false;
  return true;
}
const isSession = (v: unknown): v is GymSession => isObj(v) && typeof v['type'] === 'string' && typeof v['name'] === 'string' && Array.isArray(v['rows']) && v['rows'].every(isRow);

/** The link's data from the page's `#` part; null when it is missing, broken or of another version. */
export function readHash(hash: string): GymData | null {
  const d = gymFromHash(hash);
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !d.sessions.length || !d.sessions.every(isSession)) return null;
  return d;
}

/** A gym link, or its `#` part, as pasted (spaces and line breaks dropped): its data and the part to keep; null when it holds no sessions. */
export function readPasted(text: string): { data: GymData; payload: string } | null {
  const t = text.replace(/\s+/g, '');
  const payload = t.slice(t.indexOf('#') + 1);
  const data = payload ? readHash(payload) : null;
  return data ? { data, payload } : null;
}

/**
 * Sessions kept on the phone that open without asking: those of the phone's
 * today or the day either side of it (past midnight, the Mac's day can still
 * be yesterday's). Older ones wait for a new Load.
 */
export const isRecent = (date: string, today: string): boolean => Math.abs(dayNumber(today) - dayNumber(date)) <= 1;

/** The sessions to pick from, one per type (its Full name), the day's next first. */
export function sessionChoices(d: GymData): { type: string; name: string; next: boolean }[] {
  const out: { type: string; name: string; next: boolean }[] = [];
  for (const s of d.sessions) {
    if (out.some((x) => x.type === s.type)) continue;
    const name = (d.sessions.find((x) => x.type === s.type && x.mode === 'full') ?? s).name;
    out.push({ type: s.type, name, next: s.type === d.next });
  }
  return [...out.filter((x) => x.next), ...out.filter((x) => !x.next)];
}

/** A session by type and mode; the type's other mode when it has no such variant; null for an unknown type. */
export function pickSession(d: GymData, type: string, mode: 'full' | 'express'): GymSession | null {
  return d.sessions.find((s) => s.type === type && s.mode === mode) ?? d.sessions.find((s) => s.type === type) ?? null;
}

/** A type with both a Full and an Express session. */
export const hasExpress = (d: GymData, type: string): boolean => d.sessions.some((s) => s.type === type && s.mode === 'express') && d.sessions.some((s) => s.type === type && s.mode === 'full');

/** The session the page opens on: the one last shown that day, else the day's next (Full), else the first. */
export function openingSession(d: GymData, view: unknown = null): GymSession {
  if (isObj(view) && typeof view['type'] === 'string' && (view['mode'] === 'full' || view['mode'] === 'express')) {
    const s = d.sessions.find((x) => x.type === view['type'] && x.mode === view['mode']);
    if (s) return s;
  }
  return (d.next !== null ? pickSession(d, d.next, 'full') : null) ?? d.sessions[0]!;
}

// ---------------------------------------------------------------- the working state

function freshSets(x: { kind: GymKind; sets: number; target: GymTarget | null; rows: GymSet[] }): SetState[] {
  if (x.rows.length) return x.rows.map((s) => ({ weight: isNum(s.weight) ? s.weight : null, reps: isNum(s.reps) ? s.reps : null, rir: isNum(s.rir) ? s.rir : null, ticked: false }));
  const t = x.target;
  return Array.from({ length: Math.max(1, x.sets) }, () => ({ weight: x.kind === 'load' ? (t?.weight ?? null) : null, reps: t?.reps ?? null, rir: null, ticked: false }));
}

/** A row's identity: a swap made or undone since its progress was stored gives another, so that progress isn't laid on it. */
export const rowId = (r: GymRow): string => JSON.stringify([r.name, r.planned ?? null, r.kind, (r.parts ?? []).map((p) => [p.name, p.planned ?? null, p.kind])]);

function freshRow(r: GymRow): RowState {
  return {
    id: rowId(r),
    sets: !isSuperset(r) && isStrength(r.kind) ? freshSets(r) : [],
    parts: isSuperset(r) ? r.parts.map(freshSets) : [],
    ticked: false,
    skipped: false,
    why: null,
  };
}

/** A session's state before anything is done: every set as the link prefills it, none ticked. */
export function freshState(date: string, s: GymSession): GymState {
  return { v: 1, date, type: s.type, mode: s.mode, rows: Object.fromEntries(s.rows.map((r) => [r.key, freshRow(r)])), startedAt: null, minutes: null, cardio: isNum(s.cardio) && s.cardio >= 0 ? Math.round(s.cardio) : 0, notes: '', sentAt: null, rest: null };
}

/** A stored number back: a number of at least 0, null, or (anything else) the fallback. */
const stored = (v: unknown, fallback: number | null): number | null => (v === null ? null : isNum(v) && v >= 0 ? v : fallback);

function mergeSets(fresh: SetState[], raw: unknown): SetState[] {
  return fresh.map((f, i) => {
    const o = Array.isArray(raw) ? (raw[i] as unknown) : undefined;
    return isObj(o) ? { weight: stored(o['weight'], f.weight), reps: stored(o['reps'], f.reps), rir: stored(o['rir'], f.rir), ticked: o['ticked'] === true } : f;
  });
}

/**
 * A session's state as the phone stored it, laid on the session the link
 * gives now: each row's stored sets by its key and position (a set the
 * link no longer has is dropped, a new one starts fresh), when the row is
 * still the same exercise (`rowId`: a swap since starts it fresh); anything
 * else, or a state of another day or session, starts fresh.
 */
export function restoreState(date: string, s: GymSession, raw: unknown): GymState {
  const fresh = freshState(date, s);
  if (!isObj(raw) || raw['v'] !== 1 || raw['date'] !== date || raw['type'] !== s.type || raw['mode'] !== s.mode) return fresh;
  const rows = isObj(raw['rows']) ? raw['rows'] : {};
  for (const r of s.rows) {
    const o = rows[r.key];
    const f = fresh.rows[r.key]!;
    if (!isObj(o) || o['id'] !== f.id) continue;
    f.sets = mergeSets(f.sets, o['sets']);
    f.parts = f.parts.map((p, i) => mergeSets(p, Array.isArray(o['parts']) ? o['parts'][i] : undefined));
    f.ticked = o['ticked'] === true;
    f.skipped = o['skipped'] === true;
    f.why = f.skipped && isReason(o['why']) ? o['why'] : null;
  }
  const rest = raw['rest'];
  return {
    ...fresh,
    startedAt: isNum(raw['startedAt']) ? raw['startedAt'] : null,
    minutes: isNum(raw['minutes']) ? clamp(Math.round(raw['minutes']), 1, 600) : null,
    cardio: isNum(raw['cardio']) && raw['cardio'] >= 0 ? Math.round(raw['cardio']) : fresh.cardio,
    notes: typeof raw['notes'] === 'string' ? raw['notes'] : '',
    sentAt: isNum(raw['sentAt']) ? raw['sentAt'] : null,
    rest: isObj(rest) && typeof rest['key'] === 'string' && rest['key'] in fresh.rows && isNum(rest['until']) && isNum(rest['seconds']) ? { key: rest['key'], until: rest['until'], seconds: rest['seconds'] } : null,
  };
}

const rowOf = (s: GymSession, key: string): GymRow | undefined => s.rows.find((r) => r.key === key);
/** A row's sets, or one superset part's. */
export const setsOf = (rs: RowState, part: number | null): SetState[] | undefined => (part === null ? rs.sets : rs.parts[part]);
/** The kind of a row's sets, or of one superset part's. */
export const kindOf = (r: GymRow, part: number | null): GymKind => (part === null ? r.kind : (r.parts?.[part]?.kind ?? r.kind));
/** A set can be ticked once it has its reps (seconds), and a loaded set its weight: a ticked set is saved as shown. */
export const canTick = (kind: GymKind, s: SetState): boolean => s.reps !== null && (kind !== 'load' || s.weight !== null);
const counts = (kind: GymKind, s: SetState): boolean => s.ticked && canTick(kind, s);
/** A row's ticked sets that are saved: its own, or each strength part's. */
const tickedOf = (kind: GymKind, sets: readonly SetState[]) => sets.filter((s) => counts(kind, s));

function cloneRow(r: RowState): RowState {
  return { ...r, sets: r.sets.map((s) => ({ ...s })), parts: r.parts.map((p) => p.map((s) => ({ ...s }))) };
}
function withRow(st: GymState, key: string, fn: (r: RowState) => void): GymState {
  const rs = st.rows[key];
  if (!rs) return st;
  const c = cloneRow(rs);
  fn(c);
  return { ...st, rows: { ...st.rows, [key]: c } };
}

/** The last strength part of a superset: its set ends a round, so its tick starts the rest. */
const lastPart = (r: GymRow): number => (isSuperset(r) ? r.parts.reduce((a, p, i) => (isStrength(p.kind) ? i : a), r.parts.length - 1) : -1);

/** After a tick: the session starts (if it hadn't), and the row's rest runs (a superset's after its round). */
function afterTick(st: GymState, r: GymRow, part: number | null, now: number): GymState {
  const rests = r.rest !== null && r.rest > 0 && (part === null || part === lastPart(r));
  return { ...st, startedAt: st.startedAt ?? now, rest: rests ? { key: r.key, until: now + r.rest! * 1000, seconds: r.rest! } : st.rest };
}

/** Ticks a set, or unticks it. A set without its reps (or a loaded set without its weight) is not ticked. */
export function tickSet(s: GymSession, st: GymState, ref: SetRef, now: number): GymState {
  const r = rowOf(s, ref.key);
  const set = st.rows[ref.key] ? setsOf(st.rows[ref.key]!, ref.part)?.[ref.i] : undefined;
  if (!r || !set) return st;
  const on = !set.ticked;
  if (on && !canTick(kindOf(r, ref.part), set)) return st;
  const next = withRow(st, ref.key, (x) => {
    setsOf(x, ref.part)![ref.i]!.ticked = on;
  });
  return on ? afterTick(next, r, ref.part, now) : next;
}

/** A warm-up or cardio row's own tick, on or off. */
export function tickRow(s: GymSession, st: GymState, key: string, now: number): GymState {
  const r = rowOf(s, key);
  const rs = st.rows[key];
  if (!r || !rs) return st;
  const on = !rs.ticked;
  const next = withRow(st, key, (x) => {
    x.ticked = on;
  });
  return on ? afterTick(next, r, null, now) : next;
}

/** A set's weight, reps (seconds) or RIR changed; a ticked set left without what a tick needs is unticked. */
export function editSet(s: GymSession, st: GymState, ref: SetRef, patch: Partial<Pick<SetState, 'weight' | 'reps' | 'rir'>>): GymState {
  const r = rowOf(s, ref.key);
  if (!r) return st;
  const kind = kindOf(r, ref.part);
  return withRow(st, ref.key, (x) => {
    const sets = setsOf(x, ref.part);
    const set = sets?.[ref.i];
    if (!sets || !set) return;
    const before = { weight: set.weight, reps: set.reps };
    if (patch.weight !== undefined) set.weight = patch.weight === null ? null : Math.max(0, Math.round(patch.weight * 100) / 100);
    if (patch.reps !== undefined) set.reps = patch.reps === null ? null : Math.max(0, Math.round(patch.reps));
    if (patch.rir !== undefined) set.rir = patch.rir === null ? null : clamp(Math.round(patch.rir), 0, 10);
    if (set.ticked && !canTick(kind, set)) set.ticked = false;
    // The sets after it that aren't ticked follow its weight and reps while they are blank or still as it was: an
    // exercise with nothing to start from is typed once, and a heavier first set carries on. Only what was typed is copied.
    for (const later of sets.slice(ref.i + 1)) {
      if (later.ticked) continue;
      const blank = later.weight === null && later.reps === null;
      if (!blank && (later.weight !== before.weight || later.reps !== before.reps)) continue;
      later.weight = set.weight;
      later.reps = set.reps;
    }
  });
}

/** Skips a row (its ticks are kept, and come back with an undo), with a reason or none; its rest stops. */
export function skipRow(st: GymState, key: string, why: GymSkipReason | null = null): GymState {
  const next = withRow(st, key, (x) => {
    x.skipped = true;
    x.why = why;
  });
  return next.rest?.key === key ? { ...next, rest: null } : next;
}

/** A skipped row's reason: chosen, or tapped again to clear it. */
export function setWhy(st: GymState, key: string, why: GymSkipReason): GymState {
  return withRow(st, key, (x) => {
    if (x.skipped) x.why = x.why === why ? null : why;
  });
}

export function unskipRow(st: GymState, key: string): GymState {
  return withRow(st, key, (x) => {
    x.skipped = false;
    x.why = null;
  });
}

/** Minutes as typed (1–600); null goes back to the time from the first tick. */
export const setMinutes = (st: GymState, v: number | null): GymState => ({ ...st, minutes: v === null ? null : clamp(Math.round(v), 1, 600) });
export const setCardio = (st: GymState, v: number | null): GymState => ({ ...st, cardio: v === null ? 0 : clamp(Math.round(v), 0, 600) });
export const setNotes = (st: GymState, notes: string): GymState => ({ ...st, notes });
export const markSent = (st: GymState, now: number): GymState => ({ ...st, sentAt: now });
export const stopRest = (st: GymState): GymState => ({ ...st, rest: null });

// ---------------------------------------------------------------- what it adds up to

/** Done: not skipped, and a set ticked (any superset part's counts); a warm-up or cardio row by its own tick. */
export function rowDone(r: GymRow, rs: RowState | undefined): boolean {
  if (!rs || rs.skipped) return false;
  if (isSuperset(r)) return r.parts.some((p, i) => isStrength(p.kind) && tickedOf(p.kind, rs.parts[i] ?? []).length > 0);
  if (isStrength(r.kind)) return tickedOf(r.kind, rs.sets).length > 0;
  return rs.ticked;
}

/** The header's "n of m sets": the ticked sets of the rows not skipped, of all their sets. */
export function setCounts(s: GymSession, st: GymState): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const r of s.rows) {
    const rs = st.rows[r.key];
    if (!rs || rs.skipped) continue;
    const groups: [GymKind, SetState[]][] = isSuperset(r) ? r.parts.map((p, i): [GymKind, SetState[]] => [p.kind, rs.parts[i] ?? []]).filter(([k]) => isStrength(k)) : isStrength(r.kind) ? [[r.kind, rs.sets]] : [];
    for (const [k, sets] of groups) {
      total += sets.length;
      done += tickedOf(k, sets).length;
    }
  }
  return { done, total };
}

/** The minutes from the first tick to `now`, as the log keeps them (1–600); null before the first tick. */
export const autoMinutes = (st: GymState, now: number): number | null => (st.startedAt === null ? null : clamp(Math.round((now - st.startedAt) / 60_000), 1, 600));

/** The top set: the heaviest ticked set, then the most reps (as the Log panel's `topOf` at Every set). */
function topOf(sets: readonly SetState[]): { weight: number; reps: number } {
  if (!sets.length) return { weight: 0, reps: 0 };
  const t = sets.reduce((a, b) => ((b.weight ?? 0) > (a.weight ?? 0) || ((b.weight ?? 0) === (a.weight ?? 0) && (b.reps ?? 0) > (a.reps ?? 0)) ? b : a));
  return { weight: t.weight ?? 0, reps: t.reps ?? 0 };
}

const entrySets = (kind: GymKind, unit: 'lb' | 'kg', sets: readonly SetState[]): GymEntrySet[] =>
  tickedOf(kind, sets).map((s) => ({ weight: kind === 'load' ? s.weight : null, unit: kind === 'load' ? unit : null, reps: s.reps!, rir: s.rir }));

/** A swap's planned item, as an entry names it (a link from before swaps has none). */
const plannedOf = (x: { planned?: string | null }): { planned?: string } => (x.planned ? { planned: x.planned } : {});

/**
 * The session entry Send hands to the shortcut, as the Log panel's
 * `inputFromForm` builds it at Every set: the logged lifts' top sets (0 × 0
 * when none is ticked; a swapped lift named, with the plan's as `planned`
 * and the swap's reason), each done row's ticked sets (a superset's parts
 * each by its own name, a swap's with the plan's item as `planned`), every
 * other swap (a row's, each superset part's), the checklist lines not done
 * and the reasons given, Express, the minutes (typed, else from the first
 * tick to `now`), the cardio row's minutes when it is done, the notes, and
 * the shortcut's question.
 */
export function entryOf(s: GymSession, st: GymState, now: number | null = st.sentAt): GymEntry {
  const done = (r: GymRow) => rowDone(r, st.rows[r.key]);
  const lift = (i: 0 | 1): GymEntryLift | undefined => {
    const r = s.rows.find((x) => x.lift === i);
    if (!r || s.kind !== 'lift') return undefined;
    const rs = st.rows[r.key];
    const sets = !rs || !done(r) ? [] : isSuperset(r) ? r.parts.flatMap((p, k) => (isStrength(p.kind) ? tickedOf(p.kind, rs.parts[k] ?? []) : [])) : tickedOf(r.kind, rs.sets);
    return { ...(r.planned ? { name: r.name, planned: r.planned, ...(r.swap ? { swapWhy: r.swap } : {}) } : {}), ...topOf(sets), unit: r.unit };
  };
  const exerciseSets = s.rows
    .filter(done)
    .flatMap((r) => {
      const rs = st.rows[r.key]!;
      if (isSuperset(r)) return r.parts.flatMap((p, k) => (isStrength(p.kind) ? [{ name: p.name, ...plannedOf(p), sets: entrySets(p.kind, p.unit, rs.parts[k] ?? []) }] : []));
      return isStrength(r.kind) ? [{ name: r.name, ...plannedOf(r), sets: entrySets(r.kind, r.unit, rs.sets) }] : [];
    })
    .filter((x) => x.sets.length);
  // Every swap but the logged lifts' (they carry their own): a checklist row's, and each superset part's, in the list's order.
  const swaps = s.rows
    .flatMap((r): (GymRow | GymPart)[] => (isSuperset(r) ? r.parts.filter((p) => p.planned) : r.planned && r.lift === null && r.line !== null ? [r] : []))
    .map((x) => ({ from: x.planned!, to: x.name, ...(x.swap ? { why: x.swap } : {}) }));
  const notDone = s.rows.filter((r) => r.line !== null && !done(r));
  const skipped = notDone.map((r) => r.line!);
  const why: Record<string, GymSkipReason> = {};
  for (const r of notDone) {
    const rs = st.rows[r.key];
    if (rs?.skipped && rs.why) why[r.line!] = rs.why;
  }
  const cardioRows = s.rows.filter((r) => r.kind === 'cardio');
  const minutes = st.minutes ?? (now === null ? null : autoMinutes(st, now));
  const express = s.kind === 'lift' && s.mode === 'express';
  const n = exerciseSets.reduce((a, x) => a + x.sets.length, 0);
  const l1 = lift(0);
  const l2 = lift(1);
  const notes = st.notes.trim();
  return {
    type: s.type,
    ...(l1 ? { lift1: l1 } : {}),
    ...(l2 ? { lift2: l2 } : {}),
    ...(express ? { express: true as const } : {}),
    ...(minutes !== null ? { durationMin: minutes } : {}),
    ...(cardioRows.length ? { cardioMin: cardioRows.some(done) ? st.cardio : 0 } : {}),
    // The plan's mode with the minutes, as the Log panel starts it, so Progress counts them by mode.
    ...(cardioRows.length && cardioRows.some(done) && st.cardio > 0 && s.cardioMode ? { cardioMode: s.cardioMode } : {}),
    ...(notes ? { notes } : {}),
    trackingLevel: 'full',
    exerciseSets,
    ...(swaps.length ? { swaps } : {}),
    ...(skipped.length ? { skipped } : {}),
    ...(Object.keys(why).length ? { skipWhy: why } : {}),
    _say: `${s.type}${express ? ' Express' : ''} · ${n} ${n === 1 ? 'set' : 'sets'}${skipped.length ? ` · ${skipped.length} skipped` : ''}`,
  };
}

// ---------------------------------------------------------------- the phone's storage

export const STORE_PREFIX = 'pahlavan-gym:';
/** Where a session's progress is kept: by the link's date, the session's type and its mode. */
export const stateKey = (date: string, type: string, mode: 'full' | 'express'): string => `${STORE_PREFIX}${date}:${type}:${mode}`;
/** The session last shown that day. */
export const viewKey = (date: string): string => `${STORE_PREFIX}${date}:view`;

const dayNumber = (iso: string): number => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5;

/** The page's keys to clear: those of a day more than `KEEP_DAYS` before today (or with no readable day). */
export function staleKeys(keys: readonly string[], today: string): string[] {
  return keys.filter((k) => {
    if (!k.startsWith(STORE_PREFIX)) return false;
    const day = k.slice(STORE_PREFIX.length, STORE_PREFIX.length + 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(dayNumber(day))) return true;
    return dayNumber(today) - dayNumber(day) > KEEP_DAYS;
  });
}

// ---------------------------------------------------------------- words

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "Tue 10 Nov", from an ISO date. */
export function dayWords(iso: string): string {
  const d = new Date(dayNumber(iso) * 864e5);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
/** The phone's local date of a moment, as an ISO date. */
export const localDate = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** "19:02", the phone's local time. */
export const clockWords = (ms: number): string => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** A countdown: "1:42". */
export const countdown = (sec: number): string => `${Math.floor(Math.max(0, sec) / 60)}:${pad(Math.max(0, sec) % 60)}`;
export const num = (v: number): string => String(Math.round(v * 100) / 100);
export const weightWords = (w: number, unit: string): string => `${num(w)} ${unit}`;

/** A set as its row reads: "120 lb × 6", "7 reps", "30 s" (the RIR apart). */
export function setWords(kind: GymKind, unit: string, s: Pick<SetState, 'weight' | 'reps'>): string {
  const reps = s.reps === null ? '–' : String(s.reps);
  if (kind === 'load') return `${s.weight === null ? '–' : num(s.weight)} ${unit} × ${reps}`;
  return kind === 'timed' ? `${reps} s` : `${reps} reps`;
}

/** Last time: "last 115 lb × 6", or its reps (seconds) without a weight. */
export function lastWords(last: NonNullable<GymRow['last']>, kind: GymKind): string {
  return `last ${last.weight ? `${weightWords(last.weight, last.unit)} × ${last.reps}` : kind === 'timed' ? `${last.reps} s` : `${last.reps} reps`}`;
}

/** A swapped exercise's line under its name: "In place of Romanian Deadlift · Injury limit" (no reason when none was given); null as planned. */
export function swapWords(x: { planned?: string | null; swap?: SwapReason | null }): string | null {
  if (!x.planned) return null;
  const why = x.swap ? SWAP_LABELS[x.swap] : undefined;
  return `In place of ${x.planned}${why ? ` · ${why}` : ''}`;
}

/** A card's line under its name: "3 × 5–8 @ RIR 2 · rest 3 min · last 115 lb × 6". */
export function rowWords(r: GymRow): string {
  const rir = r.rir !== null && (r.kind === 'load' || r.kind === 'reps') && !isSuperset(r) && !/RIR/.test(r.sr) ? ` @ RIR ${r.rir}` : '';
  return [r.sr ? `${r.sr}${rir}` : null, r.restText ? `rest ${r.restText}` : null, r.last ? lastWords(r.last, r.kind) : null].filter(Boolean).join(' · ');
}
