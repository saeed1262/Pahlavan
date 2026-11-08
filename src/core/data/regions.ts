// Muscle regions: the parts of a muscle that training studies (muscle size
// measured by MRI or ultrasound) show growing differently with the exercise.
// Only the regions with that support are modelled, each with its evidence
// grade and sources; no region has a meta-analysis of its own, so none is
// Strong. Popular ideas without support (inner chest, VMO targeting, upper
// lats) are in UNSUPPORTED_REGIONS with the reason and the nearest supported
// option, so the coach and `validate` can explain them instead of modelling
// them. The upper back's two regions are heuristic, a rough guide only.
//
// A region's id starts with its parent muscle's id (data/muscles.ts). A
// region is declarable (profile.priorityRegions, an emphasis row's regions);
// `coverage` marks the ones the coverage rule checks for a priority muscle.
// A weak region is declared by the person, never diagnosed: no validated way
// spots a lagging region from photos or a tape (Stokes 2021).

import { SOURCES } from './evidence.ts';
import { MUSCLES } from './muscles.ts';

export type RegionGrade = 'moderate' | 'weak' | 'heuristic';

export interface RegionSource {
  label: string;
  /** The bare DOI (https://doi.org/<doi> opens it). */
  doi: string;
}

export interface MuscleRegion {
  /** `<muscle id>-<part>`, e.g. `shoulders-side`. */
  id: string;
  /** The parent muscle's id (data/muscles.ts). */
  muscle: string;
  label: string;
  grade: RegionGrade;
  /** The training studies behind it; empty for a heuristic region. */
  sources: RegionSource[];
  /** In the coverage rule: a priority muscle's coverage regions each get direct work. */
  coverage: boolean;
  /** A heuristic region shown as a rough guide only. */
  roughGuide?: boolean;
  /** Other names a person may use for it (matched by explainRegion). */
  aliases: string[];
  note: string;
}

/** A region people ask for that the evidence does not support, the nearest supported option, and why. */
export interface UnsupportedRegion {
  /** The ways people name it (matched by explainRegion, case and plurals aside). */
  phrases: string[];
  /** The nearest supported option: a region id, or a muscle id for the muscle as a whole. */
  nearest: string;
  why: string;
  sources: RegionSource[];
}

// The sources, from the engine's one citation list (data/evidence.ts).
const {
  ema2013: EMA_2013,
  kubo2019: KUBO_2019,
  kinoshita2026: KINOSHITA_2026,
  larsen2025b: LARSEN_2025B,
  maeo2021: MAEO_2021,
  maeo2024: MAEO_2024,
  bourne2017: BOURNE_2017,
  plotkin2023: PLOTKIN_2023,
  kinoshita2023: KINOSHITA_2023,
  maeo2023: MAEO_2023,
  lanza2024: LANZA_2024,
  larsen2025a: LARSEN_2025A,
  vigotsky2022: VIGOTSKY_2022,
  chaves2020: CHAVES_2020,
  pinto2025: PINTO_2025,
  smith2009: SMITH_2009,
} = SOURCES;

const QUADS = [EMA_2013, KUBO_2019, KINOSHITA_2026, LARSEN_2025B];
const HAMSTRINGS = [MAEO_2021, MAEO_2024, BOURNE_2017, PLOTKIN_2023];
const DELTS = [LANZA_2024, LARSEN_2025A];

export const REGIONS: readonly MuscleRegion[] = [
  {
    id: 'quads-rf',
    muscle: 'quads',
    label: 'Rectus femoris',
    grade: 'moderate',
    sources: QUADS,
    coverage: true,
    aliases: ['rectus femoris', 'rf'],
    note: 'The rectus femoris crosses the hip as well as the knee: leg extensions grow it (more so leaning back), while squats and the leg press barely do.',
  },
  {
    id: 'quads-vasti',
    muscle: 'quads',
    label: 'Vasti',
    grade: 'moderate',
    sources: QUADS,
    coverage: true,
    aliases: ['vasti', 'vastus muscles'],
    note: 'The three vasti cross only the knee and grow together: squats, the leg press, lunges and leg extensions grow them about alike.',
  },
  {
    id: 'hamstrings-hip',
    muscle: 'hamstrings',
    label: 'Hamstrings, hip extension',
    grade: 'moderate',
    sources: HAMSTRINGS,
    coverage: true,
    aliases: ['hamstrings hip extension', 'hip extension hamstrings', 'hamstrings at the hip'],
    note: 'Hip-extension work (Romanian deadlifts, back extensions) grows the long head of the biceps femoris and the semimembranosus most, and a seated leg curl, hip bent, grew them too; squats and hip thrusts give the hamstrings little.',
  },
  {
    id: 'hamstrings-knee',
    muscle: 'hamstrings',
    label: 'Hamstrings, knee flexion',
    grade: 'moderate',
    sources: HAMSTRINGS,
    coverage: true,
    aliases: ['hamstrings knee flexion', 'knee flexion hamstrings', 'hamstrings at the knee'],
    note: 'Knee-flexion work (leg curls, Nordics) grows the semitendinosus and the short head most; a seated curl, hip bent, grew the hamstrings more than a lying one.',
  },
  {
    id: 'calves-gastroc',
    muscle: 'calves',
    label: 'Gastrocnemius',
    grade: 'weak',
    sources: [KINOSHITA_2023],
    coverage: true,
    aliases: ['gastrocnemius', 'gastroc'],
    note: 'The gastrocnemius crosses the knee: standing calf raises (knees straight) grow it, seated raises do not.',
  },
  {
    id: 'calves-soleus',
    muscle: 'calves',
    label: 'Soleus',
    grade: 'weak',
    sources: [KINOSHITA_2023],
    coverage: true,
    aliases: ['soleus'],
    note: 'The soleus crosses only the ankle, so the knee angle matters less: standing and seated calf raises both load it.',
  },
  {
    id: 'triceps-long',
    muscle: 'triceps',
    label: 'Triceps long head',
    grade: 'weak',
    sources: [MAEO_2023],
    coverage: true,
    aliases: ['triceps long head', 'long head triceps', 'long head of the triceps'],
    note: 'The long head crosses the shoulder: overhead extensions, arm up and the long head stretched, grew it more than pushdowns.',
  },
  {
    id: 'shoulders-front',
    muscle: 'shoulders',
    label: 'Front delts',
    grade: 'weak',
    sources: DELTS,
    coverage: true,
    aliases: ['front delts', 'anterior delts', 'anterior deltoid', 'front shoulders'],
    note: 'Pressing, flat or overhead, grows the front delts.',
  },
  {
    id: 'shoulders-side',
    muscle: 'shoulders',
    label: 'Side delts',
    grade: 'weak',
    sources: [...DELTS, VIGOTSKY_2022],
    coverage: true,
    aliases: ['side delts', 'lateral delts', 'lateral deltoid', 'middle delts', 'medial delts', 'side shoulders'],
    note: 'The side delts grew least with bench pressing; lateral raises grow them. Overhead presses work them by muscle activity (EMG) only, which caps that claim at Weak.',
  },
  {
    id: 'shoulders-rear',
    muscle: 'shoulders',
    label: 'Rear delts',
    grade: 'heuristic',
    sources: [],
    coverage: false,
    aliases: ['rear delts', 'posterior delts', 'posterior deltoid', 'rear shoulders'],
    note: 'No training study has measured the rear delts; reverse flys and face pulls are the usual choice (a heuristic).',
  },
  {
    id: 'chest-upper',
    muscle: 'chest',
    label: 'Upper chest',
    grade: 'weak',
    sources: [CHAVES_2020, PINTO_2025],
    coverage: false,
    aliases: ['upper chest', 'upper pecs', 'clavicular pec', 'clavicular head'],
    note: 'Incline pressing beat flat at one of three chest sites: a weak lead, so it can be declared but is not in the coverage check.',
  },
  {
    id: 'upper-back-traps',
    muscle: 'upper-back',
    label: 'Upper traps',
    grade: 'heuristic',
    sources: [],
    coverage: false,
    roughGuide: true,
    aliases: ['upper traps', 'traps', 'upper trapezius'],
    note: 'A rough guide: shrugs and carries load the upper traps. No training study has measured it.',
  },
  {
    id: 'upper-back-mid',
    muscle: 'upper-back',
    label: 'Mid-back',
    grade: 'heuristic',
    sources: [],
    coverage: false,
    roughGuide: true,
    aliases: ['mid back', 'middle back', 'rhomboids', 'middle traps', 'mid traps', 'lower traps'],
    note: 'A rough guide: rows, reverse flys and face pulls load the rhomboids and the middle and lower traps. No training study has measured it.',
  },
];

export const REGION_IDS: readonly string[] = REGIONS.map((r) => r.id);

export const REGIONS_BY_ID: ReadonlyMap<string, MuscleRegion> = new Map(REGIONS.map((r) => [r.id, r]));

/** A muscle's modelled regions, in REGIONS order (none for most muscles). */
export function regionsOf(muscle: string): MuscleRegion[] {
  return REGIONS.filter((r) => r.muscle === muscle);
}

export const UNSUPPORTED_REGIONS: readonly UnsupportedRegion[] = [
  {
    phrases: ['inner chest', 'outer chest', 'inner pecs', 'outer pecs'],
    nearest: 'chest',
    why: 'A pec deck grew both heads of the chest evenly (Pinto 2025), and no training study shows an exercise growing the inner or outer chest on its own: train the chest as a whole.',
    sources: [PINTO_2025],
  },
  {
    phrases: ['lower chest', 'lower pecs'],
    nearest: 'chest',
    why: 'No training study shows an exercise (decline presses or dips included) growing the lower chest more than the rest: train the chest as a whole.',
    sources: [],
  },
  {
    phrases: ['vmo', 'vastus medialis', 'vastus medialis oblique', 'vastus lateralis', 'inner quad', 'outer quad', 'quad sweep', 'teardrop'],
    nearest: 'quads-vasti',
    why: 'The vasti grow together: no stance, foot position or exercise targets the inner or outer quad, even in muscle-activity (EMG) studies (Smith 2009). Squats, the leg press and lunges train the vasti as a whole.',
    sources: [SMITH_2009],
  },
  {
    phrases: ['upper lats', 'lower lats'],
    nearest: 'lats',
    why: 'No training study has measured upper and lower lat growth apart (one trial is registered, not yet enrolling): train the lats as a whole.',
    sources: [],
  },
  {
    // Each names the biceps: the hamstrings have a short head too.
    phrases: ['biceps peak', 'long head biceps', 'biceps long head', 'long head of the biceps', 'biceps short head', 'short head biceps', 'short head of the biceps', 'inner biceps', 'outer biceps'],
    nearest: 'biceps',
    why: 'No training study shows a reliable way to grow one head of the biceps, or its peak, more than the rest: train the biceps as a whole.',
    sources: [],
  },
  {
    phrases: ['upper glutes', 'lower glutes', 'glute shelf'],
    nearest: 'glutes',
    why: 'Hip thrusts and squats grew the upper, middle and lower glutes about alike (Plotkin 2023), and no exercise is shown to target one part: train the glutes as a whole.',
    sources: [PLOTKIN_2023],
  },
];

/**
 * A phrase as explainRegion compares it: lowercase, accents and symbols
 * dropped, words single-spaced, a leading article dropped ("the upper
 * chest"), a plural's trailing s dropped from each word ("Side Delts" and
 * "side-delt" read the same).
 */
function normalize(phrase: string): string {
  return phrase
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(?:the|a|an) /, '')
    .split(' ')
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ');
}

export type RegionExplanation = { kind: 'region'; region: MuscleRegion } | { kind: 'unsupported'; entry: UnsupportedRegion };

/**
 * What a person's name for a part of a muscle is: a modelled region (by its
 * id, label or another common name), an unsupported one with the nearest
 * supported option and why, or null when it is neither.
 */
export function explainRegion(phrase: string): RegionExplanation | null {
  const n = normalize(phrase);
  if (!n) return null;
  const region = REGIONS.find((r) => [r.id, r.label, ...r.aliases].some((x) => normalize(x) === n));
  if (region) return { kind: 'region', region };
  const entry = UNSUPPORTED_REGIONS.find((u) => u.phrases.some((x) => normalize(x) === n));
  return entry ? { kind: 'unsupported', entry } : null;
}

/** The nearest supported option, in words: a region's label and id, or "the chest as a whole". */
export function nearestText(entry: UnsupportedRegion): string {
  const region = REGIONS_BY_ID.get(entry.nearest);
  if (region) return `${region.label.toLowerCase()} (${region.id})`;
  const muscle = MUSCLES.find((m) => m.id === entry.nearest);
  return `the ${(muscle?.label ?? entry.nearest).toLowerCase()} as a whole`;
}

/** "quads-rf (no quads in main or helps)": a region whose parent muscle the entry or exercise does not tag, as the warning lists it. */
export function parentMissingText(region: string): string {
  return `${region} (no ${REGIONS_BY_ID.get(region)?.muscle ?? 'parent muscle'} in main or helps)`;
}

/** Region ids among `regions` whose parent muscle is not in these muscle tags (a set of them counts no region credit). */
export function regionsWithoutParent(tags: { main: readonly string[]; helps: readonly string[]; regions?: readonly string[] }): string[] {
  return [...new Set(tags.regions ?? [])].filter((r) => {
    const region = REGIONS_BY_ID.get(r);
    return region !== undefined && !tags.main.includes(region.muscle) && !tags.helps.includes(region.muscle);
  });
}

/**
 * Declared or tagged region values the engine cannot use: `unknown` ones (no
 * region id, an alias named with the id it stands for) and `unsupported`
 * ones (with the nearest supported option and why). Values that are region
 * ids are fine and left out.
 */
export function regionProblems(values: readonly string[]): { unknown: string[]; unsupported: string[] } {
  const unknown: string[] = [];
  const unsupported: string[] = [];
  for (const v of values) {
    if (REGION_IDS.includes(v)) continue;
    const e = explainRegion(v);
    if (e?.kind === 'unsupported') {
      const item = `${v}: nearest ${nearestText(e.entry)}. ${e.entry.why}`;
      if (!unsupported.includes(item)) unsupported.push(item);
    } else {
      const item = e?.kind === 'region' ? `${v} (use the id ${e.region.id})` : v;
      if (!unknown.includes(item)) unknown.push(item);
    }
  }
  return { unknown, unsupported };
}
