// What a card's inputs mean, as Habit Nudges read them: sleep as "7:20",
// "7h20" or "7.3"; a decimal comma; steps with thousands separators; the
// tape and the tests' text fields as text. Then the engine's own limits
// check them (validateMorning, validateRecord), so both plugins accept the
// same values. Pure.

import { MORNING_LIMITS, validateMorning, validateRecord, type MorningKey, type MorningValues, type RecordField, type RecordValues } from '../../../src/adapters/vault/body-write.ts';
import { CM_PER_IN, LB_PER_KG, METRIC, type BodyUnits } from '../../../src/core/units.ts';

/** "7:20", "7h20", "7h 20m" or "7.3" as hours (two decimals); null when it is none of those. */
export function parseHours(v: string): number | null {
  const t = String(v ?? '').trim().toLowerCase();
  if (!t) return null;
  const hm = /^(\d{1,2})\s*(?::|h)\s*(\d{1,2})?\s*m?$/.exec(t);
  if (hm) return Math.round((Number(hm[1]) + (Number(hm[2]) || 0) / 60) * 100) / 100;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** A number typed on a card: a decimal comma reads as a point; steps and floors drop thousands separators. */
export function parseNumber(v: string, opts: { thousands?: boolean } = {}): number | null {
  const t = String(v ?? '').trim();
  if (!t) return null;
  const n = Number(opts.thousands ? t.replace(/[\s,.'’]/g, '') : t.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * The morning card's fields into the values the morning writer takes
 * (empty is null), and what is wrong in words. Whole numbers where the
 * limits want them; sleep to two decimals, weight to one.
 */
export function morningValues(scales: Partial<Record<MorningKey, number | null>>, fields: Partial<Record<MorningKey, string>>, units: BodyUnits = METRIC): { values: MorningValues; errors: string[]; bad: MorningKey[] } {
  const values: MorningValues = { ...scales };
  const bad: MorningKey[] = [];
  for (const [k, raw] of Object.entries(fields) as [MorningKey, string][]) {
    const t = raw.trim();
    if (!t) {
      values[k] = null;
      continue;
    }
    const n = k === 'sleepH' ? parseHours(t) : parseNumber(t, { thousands: k === 'steps' || k === 'floors' });
    if (n === null) {
      bad.push(k);
      continue;
    }
    // A weight typed in lb is kept in kg, to 0.1.
    const v = k === 'weight' && units.weight === 'lb' ? n / LB_PER_KG : n;
    values[k] = MORNING_LIMITS[k].int ? Math.round(v) : round(v, k === 'sleepH' ? 2 : 1);
  }
  const w = MORNING_LIMITS.weight;
  const inLb = (m: string) => (units.weight === 'lb' && m.startsWith(`${w.label} is between`) ? `${w.label} is between ${Math.ceil(w.min * LB_PER_KG)} and ${Math.floor(w.max * LB_PER_KG)} lb` : m);
  const errors = [...bad.map((k) => `${MORNING_LIMITS[k].label} is not a number`), ...validateMorning(values).map(inLb)];
  for (const k of Object.keys(values) as MorningKey[]) {
    const v = values[k];
    const lim = MORNING_LIMITS[k];
    if (typeof v === 'number' && (v < lim.min || v > lim.max) && !bad.includes(k)) bad.push(k);
  }
  return { values, errors, bad };
}

/** The tape's or the tests' fields into values (numbers, or text for the text fields; empty is null). */
export function recordValues(fields0: readonly RecordField[], typed: Record<string, string>, units: BodyUnits = METRIC): { values: RecordValues; errors: string[]; bad: string[] } {
  // In inches: the cm fields read and are checked in inches (their limits inside the cm ones), then kept in cm, to 0.1.
  const inches = units.length === 'in';
  const fields = inches ? fields0.map((f) => (f.unit === 'cm' ? { ...f, unit: 'in', ...(f.min !== undefined ? { min: Math.ceil((f.min / CM_PER_IN) * 10) / 10 } : {}), ...(f.max !== undefined ? { max: Math.floor((f.max / CM_PER_IN) * 10) / 10 } : {}) } : f)) : fields0;
  const values: RecordValues = {};
  const bad: string[] = [];
  for (const f of fields) {
    const raw = typed[f.id];
    if (raw === undefined) continue;
    const t = raw.trim();
    if (!t) {
      values[f.id] = null;
      continue;
    }
    if (f.text) {
      values[f.id] = t;
      continue;
    }
    const n = parseNumber(t);
    if (n === null) {
      bad.push(f.id);
      continue;
    }
    values[f.id] = f.int ? Math.round(n) : round(n, 1);
  }
  const errors = [...bad.map((id) => `${fields.find((f) => f.id === id)!.label} is not a number`), ...validateRecord(fields, values)];
  for (const f of fields) {
    const v = values[f.id];
    if (typeof v === 'number' && ((f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max)) && !bad.includes(f.id)) bad.push(f.id);
  }
  if (inches) for (const f of fields) if (f.unit === 'in' && typeof values[f.id] === 'number') values[f.id] = round((values[f.id] as number) * CM_PER_IN, 1);
  return { values, errors, bad };
}

/** The value a card's field started with, in the same form (the baseline for the field-by-field merges). */
export function startValue(raw: string, f: Pick<RecordField, 'text'>): number | string | null {
  const t = raw.trim();
  if (!t) return null;
  if (f.text) return t;
  const n = Number(t);
  return Number.isFinite(n) ? n : t;
}
