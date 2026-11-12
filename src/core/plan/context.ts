// Equipment words, a catalogue entry as a schema exercise and its load step,
// and the movements a person's findings rule out: what the catalogue search,
// the plan check, the vault adapter, the session and the Hotel swaps share.

import type { CatalogueEntry, Equipment } from '../data/exercises.ts';
import { LOWER_BODY } from '../data/muscles.ts';
import { activeEmphasis, asksConfirmation, emphasisConfirmation, mayRuleOut, SELF_CHECK_FINDINGS } from '../findings.ts';
import { OVERHEAD_PRESSES, selfCheckPlan } from './self-check.ts';
import type { Exercise, Profile, Unit } from '../schema.ts';

const SYNONYMS: Record<string, Equipment> = {
  bodyweight: 'bodyweight',
  dumbbell: 'dumbbell',
  dumbbells: 'dumbbell',
  barbell: 'barbell',
  'barbell and plates': 'barbell',
  cable: 'cable',
  cables: 'cable',
  'cable machine': 'cable',
  machine: 'machine',
  machines: 'machine',
  'leg press': 'machine',
  band: 'band',
  bands: 'band',
  'resistance bands': 'band',
  bench: 'bench',
  'pull-up bar': 'pull-up-bar',
  'pull-up-bar': 'pull-up-bar',
  'pullup bar': 'pull-up-bar',
  kettlebell: 'kettlebell',
  kettlebells: 'kettlebell',
  rings: 'rings',
  trx: 'rings',
  'suspension trainer': 'rings',
  'parallel bars': 'parallel-bars',
  'parallel-bars': 'parallel-bars',
  'dip station': 'parallel-bars',
  'dip bars': 'parallel-bars',
  parallettes: 'parallel-bars',
  'trap bar': 'trap-bar',
  'trap-bar': 'trap-bar',
  'hex bar': 'trap-bar',
  sled: 'sled',
  prowler: 'sled',
  'jump rope': 'jump-rope',
  'jump-rope': 'jump-rope',
  'skipping rope': 'jump-rope',
  'stability ball': 'stability-ball',
  'stability-ball': 'stability-ball',
  'swiss ball': 'stability-ball',
  'exercise ball': 'stability-ball',
  'ab wheel': 'ab-wheel',
  'ab-wheel': 'ab-wheel',
  'ab roller': 'ab-wheel',
  pool: 'pool',
  'swimming pool': 'pool',
};

/** The equipment words a profile (and `engine catalogue --equipment`) may use, each read as one of the catalogue's equipment ids. */
export const EQUIPMENT_WORDS: readonly string[] = Object.keys(SYNONYMS);

export function normalizeEquipment(items: readonly string[]): { equipment: Set<Equipment>; unknown: string[] } {
  const equipment = new Set<Equipment>(['bodyweight']);
  const unknown: string[] = [];
  for (const raw of items) {
    const tag = SYNONYMS[raw.trim().toLowerCase()];
    if (tag) equipment.add(tag);
    else unknown.push(raw);
  }
  return { equipment, unknown };
}

/** The load step for an exercise in the user's unit (planning.md step 6: steps that exist). */
export function incrementFor(entry: CatalogueEntry, unit: Unit): number {
  const tool = entry.equipment[0];
  const lower = entry.muscles.main.some((m) => LOWER_BODY.includes(m));
  if (tool === 'barbell') return unit === 'kg' ? (lower ? 5 : 2.5) : lower ? 10 : 5;
  if (tool === 'cable' || tool === 'machine') return unit === 'kg' ? 5 : 10;
  if (tool === 'kettlebell') return unit === 'kg' ? 4 : 10;
  return unit === 'kg' ? 2.5 : 5;
}

/** A catalogue entry as a schema v1 exercise. */
export function toExercise(entry: CatalogueEntry, unit: Unit): Exercise {
  const kind = entry.load === 'cardio' ? 'cardio' : entry.pattern === 'mobility' ? 'mobility' : entry.load === 'timed' ? 'timed' : 'strength';
  const ex: Exercise = { name: entry.name, pattern: entry.pattern, kind, risk: [`abdomen-${entry.iap}`], equipment: entry.equipment.join(', ') };
  if (entry.muscles.main.length || entry.muscles.helps.length) {
    ex.muscles = { main: [...entry.muscles.main], helps: [...entry.muscles.helps] };
    if (entry.regions?.length) ex.muscles.regions = [...entry.regions];
  }
  if (kind === 'strength') {
    ex.unit = unit;
    ex.increment = incrementFor(entry, unit);
  }
  return ex;
}

/**
 * The movements a person's findings rule out, each with its reason: each
 * self-check finding's exclusions (the sit-to-stand, the hinge, the overhead
 * reach, balance) and a limited overhead range the photos showed, each only
 * when it acts in full (findings.ts: confirmed, or never asked in a profile
 * from before the question). The plan check's region options leave them out.
 * The findings' own exclusions do not depend on the kit.
 */
export function findingExclusions(profile: Pick<Profile, 'selfCheck' | 'emphasis'>): Map<string, string> {
  const asks = asksConfirmation(profile);
  const list = selfCheckPlan(profile.selfCheck, { bar: false, loadedPress: false, loadedSingleLeg: false, pulldown: false }, asks).effects;
  const out = new Map<string, string>();
  for (const e of list) {
    if (!(SELF_CHECK_FINDINGS as readonly string[]).includes(e.value.input)) continue;
    for (const id of e.value.exclude ?? []) if (!out.has(id)) out.set(id, e.value.note);
  }
  for (const e of activeEmphasis(profile.emphasis)) {
    if (e.kind !== 'overhead-limited' || !mayRuleOut(emphasisConfirmation(e), asks)) continue;
    for (const id of OVERHEAD_PRESSES) if (!out.has(id)) out.set(id, `The body assessment saw a limited overhead range (${e.seen}): pure overhead pressing waits until the reach improves.`);
  }
  return out;
}
