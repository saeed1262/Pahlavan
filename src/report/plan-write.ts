// What `engine plan-write` shows before it writes a draft over plan-data.json:
// a key-level diff of the plan as written against the draft. Sessions are
// compared item by item (by name), the keyed objects (lifts, guide, rules,
// titles, ...) entry by entry, everything else as a whole. Pure: the CLI does
// the reading, the check and the write.

export interface PlanDiffEntry {
  /** Where: `weekTarget`, `lifts["Goblet Squat"]`, `sessions.A["Face Pull"].sr`, `sessions.A` (its order). */
  path: string;
  change: 'added' | 'removed' | 'changed' | 'reordered';
  /** The values, when both sides are plain values (text, numbers, true or false). */
  before?: string | number | boolean | null;
  after?: string | number | boolean | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPlain = (v: unknown): v is string | number | boolean | null => v === null || ['string', 'number', 'boolean'].includes(typeof v);

/** The same JSON value, objects compared key by key whatever their order. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  if (isObj(a) || isObj(b)) {
    if (!isObj(a) || !isObj(b)) return false;
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && sameJson(a[k], b[k]));
  }
  return a === b;
}

const keyPath = (parent: string, key: string) => (/^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`);
const union = (a: Obj, b: Obj) => [...Object.keys(b), ...Object.keys(a).filter((k) => !(k in b))];

function leaf(path: string, before: unknown, after: unknown): PlanDiffEntry {
  return { path, change: 'changed', ...(isPlain(before) && isPlain(after) ? { before, after } : {}) };
}

/** The entries of two keyed objects: each key added, removed or changed. */
function entries(path: string, before: Obj, after: Obj, out: PlanDiffEntry[], depth: number): void {
  for (const k of union(before, after)) {
    const p = keyPath(path, k);
    if (!(k in before)) out.push({ path: p, change: 'added' });
    else if (!(k in after)) out.push({ path: p, change: 'removed' });
    else if (!sameJson(before[k], after[k])) {
      if (depth > 0 && isObj(before[k]) && isObj(after[k])) entries(p, before[k], after[k], out, depth - 1);
      else out.push(leaf(p, before[k], after[k]));
    }
  }
}

/** A session's items by name (a repeated name numbered: "Face Pull #2"). */
function byName(list: unknown): Map<string, Obj> {
  const out = new Map<string, Obj>();
  for (const it of Array.isArray(list) ? list : []) {
    if (!isObj(it)) continue;
    const name = typeof it['name'] === 'string' ? it['name'] : '(no name)';
    let key = name;
    for (let n = 2; out.has(key); n++) key = `${name} #${n}`;
    out.set(key, it);
  }
  return out;
}

function sessions(before: Obj, after: Obj, out: PlanDiffEntry[]): void {
  for (const type of union(before, after)) {
    const p = keyPath('sessions', type);
    if (!(type in before)) {
      out.push({ path: p, change: 'added' });
      continue;
    }
    if (!(type in after)) {
      out.push({ path: p, change: 'removed' });
      continue;
    }
    if (sameJson(before[type], after[type])) continue;
    const b = byName(before[type]);
    const a = byName(after[type]);
    for (const name of [...a.keys(), ...[...b.keys()].filter((k) => !a.has(k))]) {
      const ip = keyPath(p, name);
      if (!b.has(name)) out.push({ path: ip, change: 'added' });
      else if (!a.has(name)) out.push({ path: ip, change: 'removed' });
      else entries(ip, b.get(name)!, a.get(name)!, out, 0);
    }
    const kept = [...a.keys()].filter((k) => b.has(k));
    if (kept.join('\n') !== [...b.keys()].filter((k) => a.has(k)).join('\n')) out.push({ path: p, change: 'reordered' });
  }
}

/** The plan as written against the draft, key by key; empty when they hold the same. */
export function planDiff(before: unknown, after: unknown): PlanDiffEntry[] {
  const out: PlanDiffEntry[] = [];
  const b = isObj(before) ? before : {};
  const a = isObj(after) ? after : {};
  for (const k of union(b, a)) {
    if (!(k in b)) out.push({ path: k, change: 'added' });
    else if (!(k in a)) out.push({ path: k, change: 'removed' });
    else if (sameJson(b[k], a[k])) continue;
    else if (k === 'sessions' && isObj(b[k]) && isObj(a[k])) sessions(b[k], a[k], out);
    else if (isObj(b[k]) && isObj(a[k])) entries(k, b[k], a[k], out, 0);
    else out.push(leaf(k, b[k], a[k]));
  }
  return out;
}
