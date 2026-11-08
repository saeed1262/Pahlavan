// The plan's overrides (plan-data.json's top-level `overrides`): the coach's
// stated reasons for going outside an evidence range. `engine check` turns a
// warning an override matches into information, shown with its reason; an
// override never clears a hard error. Pure.

/** One override as the plan writes it. */
export interface PlanOverride {
  /** The finding's code it answers ("volume-over-cap", "rest"). */
  code: string;
  /** One of the finding's items (a muscle, "A Face Pull", a session type); without it, the whole finding. */
  item?: string;
  /** Why the plan goes outside the range, in the coach's words. Required: an override without one is a hard error. */
  reason: string;
  /** Where the decision is recorded (a Decisions.md entry, "2026-11-07 · Shoulders past the cap"). */
  decision?: string;
}

export const OVERRIDE_KEYS = ['code', 'item', 'reason', 'decision'] as const;

export interface ReadOverrides {
  /** The overrides usable as written (a code and a non-empty reason). */
  overrides: PlanOverride[];
  /** Entries with no reason (or a blank one), by position and code: each a hard error. */
  withoutReason: string[];
  /** What else is wrong with the list (not a list, an entry not an object, no code, a wrong type, an unknown key). */
  problems: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** The plan's `overrides` as written: the usable ones, the ones with no reason, and the problems. Absent: none. */
export function readOverrides(raw: unknown): ReadOverrides {
  const out: ReadOverrides = { overrides: [], withoutReason: [], problems: [] };
  if (raw === undefined) return out;
  if (!Array.isArray(raw)) {
    out.problems.push('overrides is not a list of {code, item?, reason, decision?}');
    return out;
  }
  raw.forEach((o, i) => {
    const at = `overrides[${i}]`;
    if (!isObj(o)) {
      out.problems.push(`${at} is not an object`);
      return;
    }
    const unknown = Object.keys(o).filter((k) => !k.startsWith('_') && !(OVERRIDE_KEYS as readonly string[]).includes(k));
    if (unknown.length) out.problems.push(`${at} has unknown key(s): ${unknown.join(', ')}`);
    if (!isText(o['code'])) {
      out.problems.push(`${at} has no code (the finding it answers)`);
      return;
    }
    for (const k of ['item', 'decision'] as const) if (o[k] !== undefined && typeof o[k] !== 'string') out.problems.push(`${at}.${k} is not text`);
    const code = o['code'].trim();
    if (!isText(o['reason'])) {
      out.withoutReason.push(`${at} (${code}${isText(o['item']) ? `: ${o['item'].trim()}` : ''})`);
      return;
    }
    out.overrides.push({
      code,
      ...(isText(o['item']) ? { item: o['item'].trim() } : {}),
      reason: o['reason'].trim(),
      ...(isText(o['decision']) ? { decision: o['decision'].trim() } : {}),
    });
  });
  return out;
}
