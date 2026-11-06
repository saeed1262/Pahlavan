// The coach's write path into Coach/eating-plan.json (`engine eating`): the
// plan the diet job wrote next to Eating plan.md, merged into the file as
// it is (or replacing it), validated, and read back. No Node APIs: the CLI
// passes the texts in and does the one write itself. Merging: a plain
// object merges key by key, a list or a value replaces, null removes the
// key; `replace` takes the given plan whole.

import type { VaultData, VaultWarning } from '../adapters/vault/convert.ts';
import { plannedProtein } from '../core/diet.ts';
import { isProteinItem } from '../core/protein.ts';
import { SCHEMA_VERSION, type EatingPlan, type IsoDate, type TrackedItem, type Tracking } from '../core/schema.ts';
import { canWrite, validateEatingPlan } from '../core/validate.ts';
import { withProteinGoal } from './track-write.ts';

/** The file's keys in the order it writes them (the Markdown's order: the goal and its reasons, the targets, the day and its meals, the plate, the tips, the pattern, the rule). */
export const EATING_ORDER = ['schemaVersion', 'updated', 'source', 'level', 'screened', 'counting', 'goal', 'goalLabel', 'summary', 'why', 'review', 'basis', 'protein', 'fiber', 'energy', 'habits', 'day', 'meals', 'portions', 'groups', 'today', 'fallbacks', 'tips', 'pattern', 'patternAlso', 'adjust', 'history', 'note'] as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `base` with `over` merged in: objects key by key, lists and values replaced, null removing the key. */
export function mergeDeep(base: unknown, over: unknown): unknown {
  if (!isObj(base) || !isObj(over)) return over;
  const out: Obj = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === null) delete out[k];
    else out[k] = isObj(v) && isObj(out[k]) ? mergeDeep(out[k], v) : v;
  }
  return out;
}

/** The plan's keys in the file's order; keys it does not know (comments such as `_about`) after them. */
export function orderedPlan(p: Obj): Obj {
  const out: Obj = {};
  for (const k of EATING_ORDER) if (p[k] !== undefined) out[k] = p[k];
  for (const k of Object.keys(p)) if (!(k in out) && p[k] !== undefined) out[k] = p[k];
  return out;
}

/** The dotted paths where two plans differ (a list counts as one value). */
export function changedPaths(a: unknown, b: unknown, path = ''): string[] {
  if (isObj(a) && isObj(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    return keys.flatMap((k) => changedPaths(a[k], b[k], path ? `${path}.${k}` : k));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [path || '(root)'];
}

export interface EatingWriteInput {
  /** The file as it is now (null: none yet). */
  existingText: string | null;
  /** The plan or the part of it to merge (the file the coach wrote). */
  given: unknown;
  /** Take the given plan whole instead of merging it into the file. */
  replace: boolean;
  today: IsoDate;
  /** The vault as read, for the warnings (the protein item, the check-ins' pattern answers). */
  data?: Pick<VaultData, 'checkins'> | null;
  tracking?: Tracking | null;
}

export interface EatingWritePlan {
  errors: VaultWarning[];
  warnings: VaultWarning[];
  /** added: no file before; merged or replaced: the file changes; unchanged: it holds this already. */
  action: 'added' | 'merged' | 'replaced' | 'unchanged' | null;
  changed: string[];
  before: EatingPlan | null;
  doc: EatingPlan | null;
  /** What to write (two-space JSON and a newline); null when nothing changes or on an error. */
  text: string | null;
}

/**
 * The plan to write: the given plan merged into the file (or replacing it
 * with `replace`, or as the first plan when there is none), with
 * `schemaVersion` filled in, validated, and the warnings the coach should
 * see before the user's yes.
 */
export function planEating(input: EatingWriteInput): EatingWritePlan {
  const errors: VaultWarning[] = [];
  const warnings: VaultWarning[] = [];
  const fail = (code: string, message: string): EatingWritePlan => ({ errors: [...errors, { code, message }], warnings, action: null, changed: [], before: null, doc: null, text: null });
  if (!isObj(input.given)) return fail('eating', 'The plan file holds no object: give the eating plan (or the part to change) as a JSON object.');

  let before: Obj | null = null;
  if (input.existingText !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.existingText);
    } catch (e) {
      if (!input.replace) return fail('eating', `Coach/eating-plan.json is not valid JSON (${(e as Error).message}): fix it, or write the whole plan with --replace.`);
    }
    if (parsed !== undefined) {
      const guard = canWrite(parsed);
      if (!guard.value) return fail('eating', `Coach/eating-plan.json: ${guard.reason.note}`);
      const errs = validateEatingPlan(parsed);
      if (errs.length && !input.replace) return { ...fail('eating', 'Coach/eating-plan.json is not valid: fix it, or write the whole plan with --replace.'), errors: errs.map((e) => ({ code: 'eating', message: `Coach/eating-plan.json ${e.path}: ${e.message}` })) };
      if (!errs.length) before = parsed as Obj;
    }
  }

  const merged = input.replace || !before ? { ...input.given } : (mergeDeep(before, input.given) as Obj);
  if (merged['schemaVersion'] === undefined) merged['schemaVersion'] = SCHEMA_VERSION;
  const doc = orderedPlan(merged);
  const errs = validateEatingPlan(doc);
  if (errs.length) return { errors: errs.map((e) => ({ code: 'schema', message: `${before && !input.replace ? 'the merged plan' : 'the plan'} ${e.path}: ${e.message}` })), warnings, action: null, changed: [], before: before as EatingPlan | null, doc: null, text: null };
  const plan = doc as unknown as EatingPlan;
  if (plan.updated > input.today) return fail('eating', `The plan's date (updated ${plan.updated}) is after today (${input.today}).`);

  const changed = before ? changedPaths(before, doc) : Object.keys(doc);
  const action: EatingWritePlan['action'] = !before ? 'added' : !changed.length ? 'unchanged' : input.replace ? 'replaced' : 'merged';

  // What the coach should see before the yes.
  const b = before as EatingPlan | null;
  if (b && changed.length && !changed.includes('updated')) warnings.push({ code: 'updated-unchanged', message: `The plan changed but updated still reads ${b.updated}: set it to the day of the change, as Eating plan.md's.` });
  if (plan.review < input.today) warnings.push({ code: 'review-past', message: `The review date ${plan.review} is before today: set the next one.` });
  const items = input.tracking?.items ?? [];
  const item = plan.protein.item ? items.find((x) => x.id === plan.protein.item) : items.find((x) => isProteinItem(x));
  if (plan.protein.item && !item) warnings.push({ code: 'protein-item', message: `protein.item is ${plan.protein.item}, which Coach/tracking.json does not track: add it with \`track add\`, so the days can be ticked.` });
  else if (!item) warnings.push({ code: 'protein-item', message: 'No protein item is tracked: add one with `track add` (a tick named Protein, linked to the Protein habit).' });
  else if (item.goal?.amount !== plan.protein.floorG) {
    // The item is ticked at the plan's floor (as tracked.protein compares it), never at the engine's floor at the trend weight.
    const floor = plan.protein.floorG;
    const asks = item.goal ? `asks for ${item.goal.amount} ${item.goal.unit}` : 'has no gram goal';
    const user = item.source.by === 'user' ? ` ${item.name} was added by the user: change it only when they ask to.` : '';
    warnings.push({ code: 'protein-item', message: `The ${item.name} item ${asks}; it should match the eating plan's floor of ${floor} g. Set it with \`track add --file <file> --write\`, the file holding ${JSON.stringify(floorChange(item, floor))}.${user}` });
  }
  if (plan.protein.floorG !== plan.protein.rangeG[0]) warnings.push({ code: 'floor', message: `The floor (${plan.protein.floorG} g) is not the range's low end (${plan.protein.rangeG[0]} g).` });
  const sum = plannedProtein(plan).value;
  if (sum.lo < plan.protein.floorG) warnings.push({ code: 'meals-under-floor', message: `The meals' rough protein adds up to about ${sum.lo} g, under the floor of ${plan.protein.floorG} g.` });
  const ids = new Set((plan.pattern ?? []).map((x) => x.id));
  const answered = [...new Set((input.data?.checkins.weekly ?? []).flatMap((w) => Object.keys(w.pattern ?? {})))].filter((k) => !ids.has(k));
  if (answered.length) warnings.push({ code: 'pattern-ids', message: 'Check-ins answered pattern lines this plan no longer has; the Food tab shows only the plan\'s lines.', items: answered });

  return { errors, warnings, action, changed, before: b, doc: plan, text: action === 'unchanged' ? null : `${JSON.stringify(doc, null, 2)}\n` };
}

/**
 * The change that sets the protein item to the eating plan's floor, as
 * `track add` takes it: the item's id and its goal, and the "At least N g"
 * wording too when it has the usual one (as `withProteinGoal` writes it).
 */
export function floorChange(item: TrackedItem, floorG: number): { id: string; goal: { amount: number; unit: string }; means?: string } {
  const next = withProteinGoal(item, floorG);
  return { id: item.id, goal: next.goal!, ...(next.means !== item.means ? { means: next.means! } : {}) };
}

/** Whether the file reads back as the plan written. */
export function eatingLanded(text: string | null, doc: EatingPlan): boolean {
  if (text === null) return false;
  try {
    return JSON.stringify(JSON.parse(text)) === JSON.stringify(doc) && validateEatingPlan(JSON.parse(text)).length === 0;
  } catch {
    return false;
  }
}
