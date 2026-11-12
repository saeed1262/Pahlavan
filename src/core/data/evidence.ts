// The evidence library's citations and the numbers the plan check holds that
// have no other home. One citation list for the engine: the sources
// skill/references/rules.md cites for each rule, and the muscle-region
// studies (data/regions.ts takes its sources from here). `engine evidence`
// (src/report/evidence.ts) pairs each rule with its number, read from the
// constant the engine computes with, its grade and these sources; a test
// checks every number against its constant and every source against
// rules.md, so the library cannot drift from the engine or the docs.

/** rules.md's grades: Strong, Moderate, Weak, and (H) a heuristic. */
export type Grade = 'strong' | 'moderate' | 'weak' | 'heuristic';

export const GRADES: readonly Grade[] = ['strong', 'moderate', 'weak', 'heuristic'];

/** What each grade means, as rules.md defines it. */
export const GRADE_TEXT: Readonly<Record<Grade, string>> = {
  strong: 'Consistent meta-analyses.',
  moderate: 'A meta-analysis, or several trials with some inconsistency.',
  weak: 'Few or small studies, mixed results, or a preprint.',
  heuristic: 'A sensible default with weak or no direct evidence: say so, and give its confidence.',
};

/** A study or guideline: its label as rules.md cites it, and its DOI (https://doi.org/<doi> opens it) or, without one, its URL. */
export interface Source {
  label: string;
  doi?: string;
  url?: string;
}

const doi = <L extends string, D extends string>(label: L, d: D) => ({ label, doi: d }) as const;
const url = <L extends string, U extends string>(label: L, u: U) => ({ label, url: u }) as const;

export const SOURCES = {
  // Plan structure, volume and frequency
  schoenfeld2019a: doi('Schoenfeld 2019a', '10.1080/02640414.2018.1555906'),
  ramosCampo2024: doi('Ramos-Campo 2024', '10.1519/JSC.0000000000004774'),
  schoenfeld2016: doi('Schoenfeld 2016', '10.1007/s40279-016-0543-8'),
  pelland2025: doi('Pelland 2025', '10.1007/s40279-025-02344-w'),
  pelland2025preprint: doi('Pelland 2025 (preprint, SportRxiv 460)', '10.51224/SRXIV.460'),
  grgic2018a: doi('Grgic 2018a', '10.1007/s40279-018-0872-x'),
  currier2023: doi('Currier 2023', '10.1136/bjsports-2023-106807'),
  acsm2026: doi('ACSM 2026', '10.1249/MSS.0000000000003897'),
  schoenfeld2017a: doi('Schoenfeld 2017a', '10.1080/02640414.2016.1210197'),
  bazValle2022: doi('Baz-Valle 2022', '10.2478/hukin-2022-0017'),
  schoenfeld2019b: doi('Schoenfeld 2019b', '10.1249/MSS.0000000000001764'),
  remmert2025: doi('Remmert 2025 (preprint)', '10.51224/SRXIV.537'),
  androulakisKorakakis2020: doi('Androulakis-Korakakis 2020', '10.1007/s40279-019-01236-0'),
  iversen2021: doi('Iversen 2021', '10.1007/s40279-021-01490-1'),
  spiering2021: doi('Spiering 2021', '10.1519/JSC.0000000000003964'),
  zhang2025: doi('Zhang 2025', '10.1007/s40279-025-02176-8'),
  kassiano2022: doi('Kassiano 2022', '10.1519/JSC.0000000000004258'),
  // Effort, load, rest, tempo, order, range of motion, exercise choice
  refalo2023: doi('Refalo 2023', '10.1007/s40279-022-01784-y'),
  grgic2022: doi('Grgic 2022', '10.1016/j.jshs.2021.01.007'),
  robinson2024: doi('Robinson 2024', '10.1007/s40279-024-02069-2'),
  halperin2022: doi('Halperin 2022', '10.1007/s40279-021-01559-x'),
  schoenfeld2017b: doi('Schoenfeld 2017b', '10.1519/JSC.0000000000002200'),
  lopez2021: doi('Lopez 2021', '10.1249/MSS.0000000000002585'),
  schoenfeld2021: doi('Schoenfeld 2021', '10.3390/sports9020032'),
  singer2024: doi('Singer 2024', '10.3389/fspor.2024.1429789'),
  grgic2018b: doi('Grgic 2018b', '10.1007/s40279-017-0788-x'),
  schoenfeld2015: doi('Schoenfeld 2015', '10.1007/s40279-015-0304-0'),
  nunes2021: doi('Nunes 2021', '10.1080/17461391.2020.1733672'),
  wolf2023: doi('Wolf 2023', '10.47206/ijsc.v3i1.182'),
  kassiano2023: doi('Kassiano 2023', '10.1519/JSC.0000000000004415'),
  pedrosa2022: doi('Pedrosa 2022', '10.1080/17461391.2021.1927199'),
  wolf2025: doi('Wolf 2025', '10.7717/peerj.18904'),
  haugen2023: doi('Haugen 2023', '10.1186/s13102-023-00713-4'),
  // Progression and light weeks
  plotkin2022: doi('Plotkin 2022', '10.7717/peerj.14142'),
  acsm2009: doi('ACSM 2009', '10.1249/MSS.0b013e3181915670'),
  rhea2003: doi('Rhea 2003', '10.1249/01.MSS.0000053727.63505.D4'),
  coleman2024: doi('Coleman 2024', '10.7717/peerj.16777'),
  bell2023: doi('Bell 2023', '10.1186/s40798-023-00633-0'),
  rogerson2024: doi('Rogerson 2024', '10.1186/s40798-024-00691-y'),
  // Readiness: the morning check-in and the watch's numbers
  saw2016: url('Saw 2016', 'https://bjsm.bmj.com/content/50/5/281'),
  craven2022: doi('Craven 2022', '10.1007/s40279-022-01706-y'),
  plews2013: doi('Plews 2013', '10.1007/s40279-013-0071-8'),
  buchheit2014: doi('Buchheit 2014', '10.3389/fphys.2014.00073'),
  manresaRocamora2021: doi('Manresa-Rocamora 2021', '10.3390/ijerph181910299'),
  // Concurrent training, cardio and activity
  schumann2022: doi('Schumann 2022', '10.1007/s40279-021-01587-7'),
  petre2021: doi('Petré 2021', '10.1007/s40279-021-01426-9'),
  eddens2018: doi('Eddens 2018', '10.1007/s40279-017-0784-1'),
  wilson2012: doi('Wilson 2012', '10.1519/JSC.0b013e31823a3e2d'),
  helgerud2007: doi('Helgerud 2007', '10.1249/mss.0b013e3180304570'),
  milanovic2015: doi('Milanović 2015', '10.1007/s40279-015-0365-0'),
  storoschuk2025: doi('Storoschuk 2025', '10.1007/s40279-025-02261-y'),
  ramosCampo2021: doi('Ramos-Campo 2021', '10.3390/biology10050377'),
  who2020: url('WHO 2020', 'https://www.who.int/publications/i/item/9789240015128'),
  bull2020: doi('Bull 2020', '10.1136/bjsports-2020-102955'),
  momma2022: doi('Momma 2022', '10.1136/bjsports-2021-105061'),
  // Posture and findings
  christensen2008: doi('Christensen 2008', '10.1016/j.jmpt.2008.10.004'),
  swain2020: doi('Swain 2020', '10.1016/j.jbiomech.2019.08.006'),
  // Muscle regions (MRI and ultrasound training studies; data/regions.ts)
  ema2013: doi('Ema 2013', '10.1007/s00421-013-2700-1'),
  kubo2019: doi('Kubo 2019', '10.1007/s00421-019-04181-y'),
  kinoshita2026: doi('Kinoshita 2026', '10.1249/MSS.0000000000003957'),
  larsen2025b: doi('Larsen 2025b', '10.1080/02640414.2024.2444713'),
  maeo2021: doi('Maeo 2021', '10.1249/mss.0000000000002523'),
  maeo2024: doi('Maeo 2024', '10.1249/mss.0000000000003490'),
  bourne2017: doi('Bourne 2017', '10.1136/bjsports-2016-096130'),
  plotkin2023: doi('Plotkin 2023', '10.3389/fphys.2023.1279170'),
  kinoshita2023: doi('Kinoshita 2023', '10.3389/fphys.2023.1272106'),
  maeo2023: doi('Maeo 2023', '10.1080/17461391.2022.2100279'),
  lanza2024: doi('Lanza 2024', '10.1016/j.jbmt.2024.07.054'),
  larsen2025a: doi('Larsen 2025a', '10.3389/fphys.2025.1611468'),
  vigotsky2022: doi('Vigotsky 2022', '10.1007/s40279-021-01619-2'),
  chaves2020: doi('Chaves 2020', '10.70252/fdnb1158'),
  pinto2025: doi('Pinto 2025', '10.1519/jsc.0000000000005045'),
  smith2009: doi('Smith 2009', '10.1080/09593980802686953'),
  costa2021: doi('Costa 2021', '10.1055/a-1308-3674'),
  fonseca2014: doi('Fonseca 2014', '10.1519/jsc.0000000000000539'),
  bazValle2019: doi('Baz-Valle 2019', '10.1371/journal.pone.0226989'),
  stokes2021: doi('Stokes 2021', '10.14814/phy2.14683'),
} as const satisfies Record<string, Source>;

/**
 * Reps in reserve by exercise type (rules.md, "Effort"; the targets by type
 * are a heuristic): compound lifts 1-3, isolation and machine work 0-2, heavy
 * strength work (a compound at `strengthRepsMax` reps or fewer) 2-4. The plan
 * check holds each item to its type's range.
 */
export const EFFORT_TARGETS = {
  compound: [1, 3],
  isolation: [0, 2],
  strength: [2, 4],
  /** A compound whose rep range tops out at this or fewer is heavy strength work. */
  strengthRepsMax: 6,
} as const;

/**
 * Rep ranges the check holds (rules.md, "Load" and "Effort"): size studies
 * cover loads to about `repsMax` reps taken near failure, and RIR is judged
 * poorly past about `rirRepsMax` reps.
 */
export const REP_LIMITS = {
  /** Muscle: about 6 to 30 reps near failure build equal size (30 to 100 % of 1RM). */
  sizeReps: [6, 30],
  repsMax: 30,
  rirRepsMax: 15,
} as const;

/**
 * Strength (rules.md, "Goal modifiers" and "Plan structure"): main lifts at
 * 80 % of 1RM or more (Strong), each strength-goal lift trained 2 or more
 * times a week (Moderate). The library's own numbers: no engine calculation
 * or check uses them; the coach designs to them.
 */
export const STRENGTH = { percentOf1RM: 80, exposuresPerWeek: 2 } as const;

/** The longest run of loading weeks between light weeks a plan may have: two mesocycles of three (H). */
export const MAX_LOADING_RUN = 6;

/** Rep speed (rules.md, "Tempo"): 0.5 to 8 s a rep grows muscle alike (Moderate); the plan's default lowers in 2 to 3 s (H). The library's own numbers: no engine calculation uses them. */
export const TEMPO = {
  similarSeconds: [0.5, 8],
  slowerThanSeconds: 10,
  lowerSeconds: [2, 3],
} as const;
