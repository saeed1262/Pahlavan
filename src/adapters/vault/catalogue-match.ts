// Matches a free-text exercise name (as a plan file writes it) to the engine's
// starter catalogue, so a vault exercise gets the catalogue's movement pattern,
// abdominal-strain tag and equipment. No match is a warning, never a guess.

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
 * the nearest catalogue entry (the same pattern, abdominal-strain tag and main
 * muscles). Generic exercise vocabulary, not anyone's plan.
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
  'face pull': 'face-pull',
  'hip thrust': 'hip-thrust',
  'hamstring curl': 'seated-leg-curl',
  'leg curl': 'seated-leg-curl',
  'lying leg curl': 'seated-leg-curl',
  'triceps pushdown': 'cable-pushdown',
  'rope triceps pushdown': 'cable-pushdown',
  'straight bar triceps pushdown': 'cable-pushdown',
  'cable chest press': 'machine-chest-press',
  'chest press': 'machine-chest-press',
  'walking lunge': 'reverse-lunge',
  'dumbbell walking lunge': 'reverse-lunge',
  lunge: 'reverse-lunge',
  'hammer curl': 'db-curl',
  'cable curl': 'db-curl',
  'biceps curl': 'db-curl',
  'floor push up': 'push-up',
  'tempo push up': 'push-up',
  'deficit push up': 'push-up',
  'archer push up': 'push-up',
  'elevated pike push up': 'pike-push-up',
  'band assisted pull up': 'assisted-pull-up',
  'weighted pull up': 'pull-up',
  'l sit pull up': 'pull-up',
  chinup: 'pull-up',
  'chin up': 'pull-up',
  'box pistol high box': 'box-pistol',
  'box pistol low box': 'box-pistol',
  'assisted pistol': 'box-pistol',
  pistol: 'pistol-squat',
  'weighted pistol': 'pistol-squat',
  'shrimp squat': 'pistol-squat',
  'tuck hollow hold': 'hollow-hold',
  'hollow hold arms by sides': 'hollow-hold',
  'hollow hold arms overhead': 'hollow-hold',
  'hollow rocks': 'hollow-hold',
  'one leg l sit': 'tuck-l-sit',
  'l sit': 'tuck-l-sit',
  'chest to wall handstand': 'wall-handstand',
  'chest to wall balance': 'wall-handstand',
  'pike hold on a bench': 'wall-handstand',
  'wall walk': 'wall-handstand',
  'kick up and bail': 'wall-handstand',
  'freestanding handstand': 'wall-handstand',
  'freestanding handstand 15 s': 'wall-handstand',
  'zone 2 finisher': 'zone2-bike',
  'easy zone 2 bike or walk': 'zone2-bike',
  'cool down walk or bike': 'brisk-walk',
  walk: 'brisk-walk',
  'doorway chest stretch': 'chest-doorway-stretch',
  'single leg glute bridge': 'single-leg-glute-bridge',
};

const BY_NAME: ReadonlyMap<string, CatalogueEntry> = (() => {
  const m = new Map<string, CatalogueEntry>();
  for (const e of CATALOGUE) {
    m.set(normalizeName(e.name), e);
    m.set(normalizeName(e.id.replace(/-/g, ' ')), e);
  }
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
