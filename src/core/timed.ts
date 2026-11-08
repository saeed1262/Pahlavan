// A timed item (cardio, intervals, timed skill work) as one structure, in
// minutes: plan-data's `timed` and ExerciseSlot.timed. Read from the field,
// else from the item's sets-and-reps and note as plans wrote them before
// the field ("22 min", "4 × 4 min hard, 3 min easy between"); counted the
// same way by the time estimate, the session and the calibration week; and
// said in words for Today, the log panel and the coach. Pure.

import type { TimedWork } from './schema.ts';

const TIMED_KEYS = ['minutes', 'rounds', 'workMin', 'restMin', 'warmupMin', 'cooldownMin'] as const;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * A `timed` value as written in a file: the structure when it is one (an
 * object of the six minute fields, with minutes, or rounds and workMin),
 * else null with what is wrong. Unknown keys starting with "_" are allowed,
 * as everywhere in the data.
 */
export function readTimed(raw: unknown): { timed: TimedWork | null; problems: string[] } {
  if (raw === undefined) return { timed: null, problems: [] };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { timed: null, problems: ['is not an object of minutes'] };
  const problems: string[] = [];
  const out: TimedWork = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('_')) continue;
    if (!(TIMED_KEYS as readonly string[]).includes(k)) {
      problems.push(`has an unknown key "${k}"`);
      continue;
    }
    const key = k as (typeof TIMED_KEYS)[number];
    const above = key === 'minutes' || key === 'workMin';
    if (!isNum(v) || (above ? v <= 0 : v < 0) || (key === 'rounds' && (!Number.isInteger(v) || v < 1))) {
      problems.push(`${key} is ${JSON.stringify(v)}, not ${key === 'rounds' ? 'a whole number of rounds' : above ? 'minutes above 0' : 'minutes'}`);
      continue;
    }
    out[key] = v;
  }
  if (!problems.length && out.minutes === undefined && (out.rounds === undefined || out.workMin === undefined)) problems.push('needs minutes, or rounds with workMin');
  return problems.length ? { timed: null, problems } : { timed: out, problems: [] };
}

const MIN = String.raw`(\d+(?:\.\d+)?)`;
/** "4 × 4 min hard, 3 min easy between" (× or x; the rest after a comma, "with", "and" or "/"; any words before "between"). */
const INTERVALS = new RegExp(String.raw`\b(\d+)\s*[×x]\s*${MIN}\s*min\b[^.;]*?(?:,|\bwith\b|\band\b|\/)\s*${MIN}\s*min\b[^.;]*?\bbetween\b`, 'i');
const WARMUP = new RegExp(String.raw`${MIN}\s*min(?:utes?)?\s+(?:easy\s+)?warm[- ]?up|warm[- ]?up\s*(?:of\s*)?${MIN}\s*min`, 'i');
const COOLDOWN = new RegExp(String.raw`${MIN}\s*min(?:utes?)?\s+(?:easy\s+)?cool[- ]?down|cool[- ]?down\s*(?:of\s*)?${MIN}\s*min`, 'i');

/**
 * A timed item from its sets-and-reps and note, as plans wrote them before
 * the `timed` field: its minutes from `sr` ("22 min", "5–10 min": the first
 * number), intervals from the note ("4 × 4 min hard, 3 min easy between"),
 * and a warm-up or cool-down the note gives minutes for. Null for sets
 * ("3 × 8", "3 sets"), rounds ("4 rounds, 40/20") and anything without
 * minutes.
 */
export function timedFromText(sr: string | undefined, note?: string): TimedWork | null {
  const s = String(sr ?? '');
  if (/^\s*\d+\s*[×x]/.test(s) || /\d+\s*(?:working\s+)?sets?\b/i.test(s) || /\d+\s*rounds?\b/i.test(s)) return null;
  const min = /(\d+(?:\.\d+)?)(?:\s*[–-]\s*\d+(?:\.\d+)?)?\s*min\b/.exec(s);
  const n = String(note ?? '');
  const iv = INTERVALS.exec(n);
  if (!min && !iv) return null;
  const out: TimedWork = {};
  if (min) out.minutes = Number(min[1]);
  if (iv) {
    out.rounds = Number(iv[1]);
    out.workMin = Number(iv[2]);
    out.restMin = Number(iv[3]);
    const w = WARMUP.exec(n);
    const c = COOLDOWN.exec(n);
    if (w) out.warmupMin = Number(w[1] ?? w[2]);
    if (c) out.cooldownMin = Number(c[1] ?? c[2]);
  }
  return out;
}

/** Intervals: two or more rounds of timed hard work (the rest between is easy). */
export function isIntervals(t: TimedWork | null | undefined): t is TimedWork & { rounds: number; workMin: number } {
  return Boolean(t && t.rounds !== undefined && t.rounds >= 2 && t.workMin !== undefined && t.workMin > 0);
}

/** Intervals' hard work and the easy minutes between: rounds × work + (rounds − 1) × rest. */
function core(t: TimedWork & { rounds: number; workMin: number }): number {
  return t.rounds * t.workMin + (t.rounds - 1) * (t.restMin ?? 0);
}

/**
 * The minutes a timed item takes. Intervals: warm-up + rounds × work +
 * (rounds − 1) × rest + cool-down; with no warm-up or cool-down given, the
 * item's `minutes` when longer (the easy time around the intervals), never
 * less than the intervals themselves. Steady work: its minutes. Null with
 * neither.
 */
export function timedMinutes(t: TimedWork | null | undefined): number | null {
  if (!t) return null;
  if (t.rounds !== undefined && t.workMin !== undefined) {
    const c = core(t as TimedWork & { rounds: number; workMin: number });
    if (t.warmupMin !== undefined || t.cooldownMin !== undefined) return r2((t.warmupMin ?? 0) + c + (t.cooldownMin ?? 0));
    return r2(Math.max(c, t.minutes ?? 0));
  }
  return t.minutes ?? null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const num = (v: number) => String(r2(v));

/**
 * The structure in words: "4 × 4 min hard, 3 min easy between · about 25
 * min", with a warm-up and cool-down when given ("5 min easy warm-up, ...,
 * 5 min easy cool-down") or "easy before and after" when the item's minutes
 * hold more than the intervals; steady work is its minutes ("20 min").
 */
export function timedText(t: TimedWork): string {
  const total = timedMinutes(t);
  if (!isIntervals(t)) return total === null ? '' : `${num(total)} min`;
  const parts = [`${t.rounds} × ${num(t.workMin)} min hard`];
  if (t.restMin) parts.push(`${num(t.restMin)} min easy between`);
  if (t.warmupMin) parts.unshift(`${num(t.warmupMin)} min easy warm-up`);
  if (t.cooldownMin) parts.push(`${num(t.cooldownMin)} min easy cool-down`);
  if (t.warmupMin === undefined && t.cooldownMin === undefined && (t.minutes ?? 0) > core(t)) parts.push('easy before and after');
  return `${parts.join(', ')} · about ${num(total!)} min`;
}

/** A timed item as screens show it: the structure, `minutes` its whole length, and `text` in words. */
export interface TimedView extends TimedWork {
  minutes: number;
  text: string;
}

export function timedView(t: TimedWork | null | undefined): TimedView | null {
  const minutes = timedMinutes(t);
  return t && minutes !== null ? { ...t, minutes, text: timedText(t) } : null;
}

const half = (n: number) => Math.max(1, Math.ceil(n / 2));

/**
 * Half a timed item (Express on a short day): intervals at half their
 * rounds (rounded up) with the same work and rest, half the warm-up,
 * cool-down and minutes; steady work at half its minutes (rounded up).
 */
export function halfTimed(t: TimedWork): TimedWork {
  const out: TimedWork = { ...t };
  if (t.rounds !== undefined) out.rounds = half(t.rounds);
  if (t.minutes !== undefined) out.minutes = half(t.minutes);
  if (t.warmupMin) out.warmupMin = Math.ceil(t.warmupMin / 2);
  if (t.cooldownMin) out.cooldownMin = Math.ceil(t.cooldownMin / 2);
  return out;
}

/** The same structure (the same fields with the same minutes). */
export function sameTimed(a: TimedWork | null | undefined, b: TimedWork | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return TIMED_KEYS.every((k) => a[k] === b[k]);
}

/** A timed item's sets: its rounds, else 1 (its minutes are not sets). */
export function timedSets(t: TimedWork): number {
  return t.rounds ?? 1;
}
