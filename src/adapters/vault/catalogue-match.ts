// Matches a free-text exercise name (as a plan file writes it) to the engine's
// catalogue, so a vault exercise gets the catalogue's movement pattern,
// abdominal-strain tag and equipment. A name matches an entry by its name, its
// id, one of its aliases (data/exercises.ts) or a synonym below. No match is a
// warning, never a guess.

import { CATALOGUE, CATALOGUE_BY_ID, type CatalogueEntry } from '../../core/data/exercises.ts';

/** Lowercase words, "db" read as dumbbell, punctuation and degrees dropped. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bdb\b/g, 'dumbbell')
    .replace(/\bbb\b/g, 'barbell')
    .replace(/\bpullup\b/g, 'pull up')
    .replace(/\bpushup\b/g, 'push up')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Common gym names that differ from the catalogue's own names, normalized, to
 * the catalogue entry for the same movement, or for the nearest one that
 * trains the same muscles (a tempo push-up, a cable curl). The entry gives
 * the pattern, the abdominal-strain tag and the muscle tags that count
 * (muscle-tags.ts), so a synonym must train the same muscles: a variant that
 * trains materially different ones (a thruster's press on top of a front
 * squat) is left out, and its guide entry's tags count. A synonym is checked
 * before the names, so none may be another entry's own name or alias (a test
 * checks): a movement the catalogue has answers to its own name. Generic
 * exercise vocabulary, not anyone's plan.
 */
export const NAME_SYNONYMS: Readonly<Record<string, string>> = {
  'barbell back squat': 'back-squat',
  'back squat': 'back-squat',
  'barbell squat': 'back-squat',
  'flat dumbbell bench press': 'db-bench',
  'dumbbell bench press': 'db-bench',
  'dumbbell bench': 'db-bench',
  'barbell bench press': 'bench-press',
  'bench press': 'bench-press',
  'conventional deadlift': 'deadlift',
  'barbell deadlift': 'deadlift',
  deadlift: 'deadlift',
  'romanian deadlift': 'rdl',
  'barbell romanian deadlift': 'rdl',
  rdl: 'rdl',
  'dumbbell romanian deadlift': 'db-rdl',
  'dumbbell rdl': 'db-rdl',
  'single leg dumbbell rdl': 'single-leg-rdl',
  'single leg rdl': 'single-leg-rdl',
  '45 back extension': 'back-extension',
  'back extension': 'back-extension',
  'dumbbell shoulder press': 'db-shoulder-press',
  'seated dumbbell press': 'db-shoulder-press',
  'overhead press': 'overhead-press',
  'one arm dumbbell row': 'db-row',
  'dumbbell row': 'db-row',
  'chest supported dumbbell row': 'chest-supported-db-row',
  'rear delt fly': 'reverse-db-fly',
  'reverse fly': 'reverse-db-fly',
  'rear delt machine': 'reverse-pec-deck',
  'rear delt machine fly': 'reverse-pec-deck',
  'machine reverse fly': 'reverse-pec-deck',
  'reverse machine fly': 'reverse-pec-deck',
  'face pull': 'face-pull',
  'banded lateral raise': 'band-lateral-raise',
  shrug: 'db-shrug',
  'hip thrust': 'hip-thrust',
  'hip abduction': 'hip-abduction-machine',
  'seated hip abduction': 'hip-abduction-machine',
  'machine hip abduction': 'hip-abduction-machine',
  'abductor machine': 'hip-abduction-machine',
  'hip abductor machine': 'hip-abduction-machine',
  'hamstring curl': 'seated-leg-curl',
  'leg curl': 'seated-leg-curl',
  'lying leg curl': 'lying-leg-curl',
  'lying hamstring curl': 'lying-leg-curl',
  'prone leg curl': 'lying-leg-curl',
  'slider hamstring curl': 'slider-leg-curl',
  'sliding leg curl': 'slider-leg-curl',
  'towel leg curl': 'slider-leg-curl',
  'triceps pushdown': 'cable-pushdown',
  'rope triceps pushdown': 'cable-pushdown',
  'straight bar triceps pushdown': 'cable-pushdown',
  'overhead cable triceps extension': 'cable-overhead-triceps-extension',
  'overhead cable extension': 'cable-overhead-triceps-extension',
  'cable overhead extension': 'cable-overhead-triceps-extension',
  'rope overhead triceps extension': 'cable-overhead-triceps-extension',
  'overhead rope triceps extension': 'cable-overhead-triceps-extension',
  'cable chest press': 'machine-chest-press',
  'chest press': 'machine-chest-press',
  'machine fly': 'pec-deck',
  'machine chest fly': 'pec-deck',
  'pec deck fly': 'pec-deck',
  lunge: 'reverse-lunge',
  'cable curl': 'db-curl',
  'biceps curl': 'db-curl',
  'floor push up': 'push-up',
  'tempo push up': 'push-up',
  'deficit push up': 'push-up',
  'band assisted pull up': 'assisted-pull-up',
  'box pistol high box': 'box-pistol',
  'box pistol low box': 'box-pistol',
  pistol: 'pistol-squat',
  'weighted pistol': 'pistol-squat',
  'hollow hold arms by sides': 'hollow-hold',
  'hollow hold arms overhead': 'hollow-hold',
  'hollow rocks': 'hollow-hold',
  'chest to wall handstand': 'wall-handstand',
  'chest to wall balance': 'wall-handstand',
  'freestanding handstand 15 s': 'freestanding-handstand',
  'zone 2 finisher': 'zone2-bike',
  'easy zone 2 bike or walk': 'zone2-bike',
  'cool down walk or bike': 'brisk-walk',
  walk: 'brisk-walk',
  'doorway chest stretch': 'chest-doorway-stretch',
  'single leg glute bridge': 'single-leg-glute-bridge',
};

/** Each entry's own names, normalized: its name, its id with spaces, and its aliases. */
export function ownNames(e: CatalogueEntry): string[] {
  return [...new Set([e.name, e.id.replace(/-/g, ' '), ...e.aliases].map(normalizeName))];
}

const BY_NAME: ReadonlyMap<string, CatalogueEntry> = (() => {
  const m = new Map<string, CatalogueEntry>();
  for (const e of CATALOGUE) for (const n of ownNames(e)) m.set(n, e);
  return m;
})();

/** The catalogue entry for a name, or null. */
export function matchCatalogue(name: string): CatalogueEntry | null {
  const n = normalizeName(name);
  if (!n) return null;
  const synonym = NAME_SYNONYMS[n];
  if (synonym) return CATALOGUE_BY_ID.get(synonym) ?? null;
  return BY_NAME.get(n) ?? null;
}
