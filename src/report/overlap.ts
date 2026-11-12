// How much two plans share: the movements each holds, by one identity, and
// the share of one plan's movements the other also holds. A redesign is
// meant to start from a blank plan; one that keeps most of the old plan's
// movements reads as an edit of it, so `check --plan <draft> --redesign`
// warns (similar-to-current) and `engine overlap` compares drafts with each
// other and with the plan as written. Read from the plan file as written
// (plan-data.json's shape), with no vault: a draft is compared before it is
// anywhere. Pure.
//
// A movement is any session item that is not timed (its `timed` field, or
// minutes in its sr or intervals in its note, as Pahlavan reads every timed
// item: itemTimed) and is not cardio in the catalogue. Its identity: the ladder's id
// for a ladder item (every level is one movement), else the catalogue
// entry's id (so "Flat DB Bench Press" and "Dumbbell bench press" are one),
// else the name normalized as the catalogue match reads it.

import { matchCatalogue, normalizeName } from '../adapters/vault/catalogue-match.ts';
import type { Pattern } from '../core/data/exercises.ts';
import { itemTimed } from '../core/plan-data.ts';

/** The share of a redesign's movements the plan as written may also hold before it warns: over half. */
export const OVERLAP_WARN_ABOVE = 0.5;

export type MovementSource = 'ladder' | 'catalogue' | 'name';

export interface Movement {
  /** The identity two plans are compared by: a ladder id, a catalogue id, or the normalized name. */
  id: string;
  /** The name as the plan first writes it. */
  name: string;
  /** Where the identity came from. */
  source: MovementSource;
  /** The session types that hold it, in the plan's order. */
  sessions: string[];
}

export interface SessionShape {
  type: string;
  /** Which list names the session; null when neither does (Pahlavan never shows it). */
  kind: 'lift' | 'short' | null;
  /** Each item's movement pattern, in order: the catalogue's, null for a movement it does not know. */
  patterns: (Pattern | null)[];
}

export interface PlanShape {
  /** Lifting days a week (weekTarget.lift); null when the plan gives none. */
  liftDays: number | null;
  /** How many lifting session types the plan has (liftTypes). */
  liftSessions: number;
  sessions: SessionShape[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Each session's named items as written, in the plan's order. */
function sessionItems(raw: unknown): { type: string; items: Obj[] }[] {
  const sessions = isObj(raw) && isObj(raw['sessions']) ? raw['sessions'] : {};
  return Object.entries(sessions).map(([type, list]) => ({
    type,
    items: (Array.isArray(list) ? list : []).filter((x): x is Obj => isObj(x) && typeof x['name'] === 'string' && x['name'].trim() !== ''),
  }));
}

type ItemLike = { name: string; sr?: unknown; note?: unknown; ladder?: unknown; timed?: unknown };

/** An item's identity, or null when it is not a movement (timed, or cardio in the catalogue). */
export function movementOf(item: ItemLike): { id: string; source: MovementSource } | null {
  const text = (v: unknown) => (typeof v === 'string' ? v : undefined);
  if ((item.timed !== undefined && item.timed !== null) || itemTimed({ sr: text(item.sr), note: text(item.note) })) return null;
  const entry = matchCatalogue(item.name);
  if (entry?.load === 'cardio') return null;
  if (typeof item.ladder === 'string' && item.ladder.trim()) return { id: item.ladder.trim(), source: 'ladder' };
  if (entry) return { id: entry.id, source: 'catalogue' };
  const n = normalizeName(item.name);
  return n ? { id: n, source: 'name' } : null;
}

/** A plan's movements, each once, in the order the plan first holds them. */
export function planMovements(raw: unknown): Movement[] {
  const out = new Map<string, Movement>();
  for (const { type, items } of sessionItems(raw)) {
    for (const it of items) {
      const m = movementOf(it as ItemLike);
      if (!m) continue;
      const had = out.get(m.id);
      if (had) {
        if (!had.sessions.includes(type)) had.sessions.push(type);
      } else out.set(m.id, { id: m.id, name: String(it['name']), source: m.source, sessions: [type] });
    }
  }
  return [...out.values()];
}

const idsOf = (xs: readonly Movement[] | ReadonlySet<string>): ReadonlySet<string> => (xs instanceof Set ? xs : new Set((xs as readonly Movement[]).map((m) => m.id)));

/**
 * The share of a's movements that b also holds, |A ∩ B| / |A|; null when a
 * has none. Not symmetric: a small plan inside a big one is all shared one
 * way and little the other.
 */
export function overlapShare(a: readonly Movement[] | ReadonlySet<string>, b: readonly Movement[] | ReadonlySet<string>): number | null {
  const A = idsOf(a);
  if (!A.size) return null;
  const B = idsOf(b);
  let n = 0;
  for (const id of A) if (B.has(id)) n++;
  return n / A.size;
}

/** a's movements that b also holds, in a's order. */
export function sharedMovements(a: readonly Movement[], b: readonly Movement[] | ReadonlySet<string>): Movement[] {
  const B = idsOf(b);
  return a.filter((m) => B.has(m.id));
}

/** Over the limit (more than OVERLAP_WARN_ABOVE of the movements shared); null shares never are. */
export const overLimit = (share: number | null): boolean => share !== null && share > OVERLAP_WARN_ABOVE;

/** The limit in words, for a message: "half", else a percentage. */
export const limitText = (): string => (OVERLAP_WARN_ABOVE === 0.5 ? 'half' : `${Math.round(OVERLAP_WARN_ABOVE * 100)}%`);

/** A share as a whole percentage. */
export const percent = (share: number): string => `${Math.round(share * 100)}%`;

/** A plan's shape: its lifting days, its lifting session count and each session's pattern order. */
export function planShape(raw: unknown): PlanShape {
  const r = isObj(raw) ? raw : {};
  const wt = isObj(r['weekTarget']) ? r['weekTarget'] : {};
  const lift = new Set(strings(r['liftTypes']));
  const short = new Set(strings(r['shortTypes']));
  const ladders = (Array.isArray(r['ladders']) ? r['ladders'] : []).filter(isObj);
  // A ladder item's name ("Pull-up (your level)") may not match the catalogue: its ladder's levels may.
  const patternOf = (it: Obj): Pattern | null => {
    const direct = matchCatalogue(String(it['name']));
    if (direct) return direct.pattern;
    const ladder = ladders.find((l) => l['id'] === it['ladder']);
    for (const lv of Array.isArray(ladder?.['levels']) ? ladder['levels'] : []) {
      const e = isObj(lv) && typeof lv['name'] === 'string' ? matchCatalogue(lv['name']) : null;
      if (e) return e.pattern;
    }
    return null;
  };
  return {
    liftDays: typeof wt['lift'] === 'number' && Number.isFinite(wt['lift']) ? wt['lift'] : null,
    liftSessions: lift.size,
    sessions: sessionItems(raw).map(({ type, items }) => ({ type, kind: lift.has(type) ? 'lift' : short.has(type) ? 'short' : null, patterns: items.map(patternOf) })),
  };
}
