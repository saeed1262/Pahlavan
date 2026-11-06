// A starter exercise catalogue, written for this project (intended CC0).
// Each entry: the movement pattern, the equipment it needs (all of it), the
// muscles it trains ({main, helps}, ids from data/muscles.ts), its
// abdominal-strain tag, whether it works one side at a time, a level, how it
// is loaded, and ordered easier and harder alternatives by id.

export const PATTERNS = [
  'squat',
  'hinge',
  'lunge',
  'horizontal-push',
  'horizontal-pull',
  'vertical-push',
  'vertical-pull',
  'carry',
  'core-anti-extension',
  'core-anti-rotation',
  'core-flexion',
  'calves',
  'biceps',
  'triceps',
  'rear-delt',
  'lateral-raise',
  'neck-upper-back',
  'conditioning',
  'mobility',
  'skill',
] as const;
export type Pattern = (typeof PATTERNS)[number];

/** `rings` covers rings and suspension trainers (TRX). */
export const EQUIPMENT = ['bodyweight', 'dumbbell', 'barbell', 'cable', 'machine', 'band', 'bench', 'pull-up-bar', 'kettlebell', 'rings'] as const;
export type Equipment = (typeof EQUIPMENT)[number];

export const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type Level = (typeof LEVELS)[number];

export type Load = 'external' | 'bodyweight' | 'timed' | 'cardio';
export type IapTag = 'low' | 'moderate' | 'high';

export interface CatalogueEntry {
  id: string;
  name: string;
  pattern: Pattern;
  /** Everything listed is needed; `bodyweight` needs nothing. The first item is the defining tool. */
  equipment: Equipment[];
  muscles: { main: string[]; helps: string[] };
  iap: IapTag;
  unilateral: boolean;
  level: Level;
  load: Load;
  /** Easier and harder alternatives, nearest first. */
  easier: string[];
  harder: string[];
}

type Opts = { uni?: boolean; load?: Load; easier?: string[]; harder?: string[] };

function x(
  id: string,
  name: string,
  pattern: Pattern,
  equipment: Equipment[],
  main: string[],
  helps: string[],
  iap: IapTag,
  level: Level,
  o: Opts = {},
): CatalogueEntry {
  return { id, name, pattern, equipment, muscles: { main, helps }, iap, unilateral: o.uni ?? false, level, load: o.load ?? 'external', easier: o.easier ?? [], harder: o.harder ?? [] };
}

const BW: Opts['load'] = 'bodyweight';

export const CATALOGUE: readonly CatalogueEntry[] = [
  // squat
  x('box-squat', 'Box squat (bodyweight, sit back to a box)', 'squat', ['bodyweight'], ['quads', 'glutes'], ['hamstrings'], 'low', 'beginner', { load: BW, harder: ['bodyweight-squat', 'goblet-squat'] }),
  x('bodyweight-squat', 'Bodyweight squat', 'squat', ['bodyweight'], ['quads', 'glutes'], ['hamstrings', 'abs'], 'low', 'beginner', { load: BW, easier: ['box-squat'], harder: ['goblet-squat', 'box-pistol'] }),
  x('heel-elevated-goblet-squat', 'Heel-elevated goblet squat', 'squat', ['dumbbell'], ['quads', 'glutes'], ['abs', 'upper-back'], 'moderate', 'beginner', { easier: ['box-squat'], harder: ['goblet-squat'] }),
  x('goblet-squat', 'Goblet squat', 'squat', ['dumbbell'], ['quads', 'glutes'], ['abs', 'upper-back', 'hamstrings'], 'moderate', 'beginner', { easier: ['heel-elevated-goblet-squat', 'box-squat'], harder: ['tempo-goblet-squat', 'back-squat'] }),
  x('tempo-goblet-squat', 'Tempo goblet squat (3 s down)', 'squat', ['dumbbell'], ['quads', 'glutes'], ['abs', 'upper-back'], 'moderate', 'intermediate', { easier: ['goblet-squat'], harder: ['back-squat'] }),
  x('back-squat', 'Barbell back squat', 'squat', ['barbell'], ['quads', 'glutes'], ['hamstrings', 'lower-back', 'abs'], 'high', 'beginner', { easier: ['goblet-squat', 'leg-press'] }),
  x('leg-press', 'Leg press', 'squat', ['machine'], ['quads', 'glutes'], ['hamstrings'], 'high', 'beginner', { easier: ['box-squat'], harder: ['back-squat'] }),
  x('leg-extension', 'Leg extension', 'squat', ['machine'], ['quads'], [], 'low', 'beginner', { harder: ['leg-press'] }),
  x('box-pistol', 'Box pistol (one leg, down to a box)', 'squat', ['bodyweight'], ['quads', 'glutes'], ['abs'], 'low', 'intermediate', { uni: true, load: BW, easier: ['bodyweight-squat'], harder: ['pistol-squat'] }),

  // hinge
  x('glute-bridge', 'Glute bridge', 'hinge', ['bodyweight'], ['glutes'], ['hamstrings'], 'low', 'beginner', { load: BW, harder: ['single-leg-glute-bridge', 'hip-thrust'] }),
  x('single-leg-glute-bridge', 'Single-leg glute bridge', 'hinge', ['bodyweight'], ['glutes'], ['hamstrings'], 'low', 'beginner', { uni: true, load: BW, easier: ['glute-bridge'], harder: ['hip-thrust'] }),
  x('hip-thrust', 'Barbell hip thrust', 'hinge', ['barbell', 'bench'], ['glutes'], ['hamstrings'], 'moderate', 'intermediate', { easier: ['single-leg-glute-bridge', 'glute-bridge'] }),
  x('db-rdl', 'Dumbbell Romanian deadlift', 'hinge', ['dumbbell'], ['hamstrings', 'glutes'], ['lower-back'], 'moderate', 'beginner', { easier: ['glute-bridge'], harder: ['rdl', 'single-leg-rdl'] }),
  x('single-leg-rdl', 'Single-leg dumbbell RDL', 'hinge', ['dumbbell'], ['hamstrings', 'glutes'], ['lower-back'], 'low', 'intermediate', { uni: true, easier: ['db-rdl'] }),
  x('rdl', 'Barbell Romanian deadlift', 'hinge', ['barbell'], ['hamstrings', 'glutes'], ['lower-back'], 'high', 'beginner', { easier: ['db-rdl'], harder: ['deadlift'] }),
  x('deadlift', 'Barbell deadlift', 'hinge', ['barbell'], ['glutes', 'hamstrings'], ['lower-back', 'quads', 'upper-back', 'forearms'], 'high', 'intermediate', { easier: ['rdl', 'db-rdl'] }),
  x('back-extension', '45-degree back extension', 'hinge', ['machine'], ['lower-back', 'glutes'], ['hamstrings'], 'low', 'beginner', { easier: ['glute-bridge'], harder: ['rdl'] }),
  x('seated-leg-curl', 'Seated leg curl', 'hinge', ['machine'], ['hamstrings'], [], 'low', 'beginner', { harder: ['db-rdl'] }),

  // lunge and single-leg
  x('split-squat', 'Split squat (bodyweight)', 'lunge', ['bodyweight'], ['quads', 'glutes'], ['hamstrings'], 'moderate', 'beginner', { uni: true, load: BW, harder: ['db-split-squat'] }),
  x('db-split-squat', 'Dumbbell split squat', 'lunge', ['dumbbell'], ['quads', 'glutes'], ['hamstrings'], 'moderate', 'beginner', { uni: true, easier: ['split-squat'], harder: ['bulgarian-split-squat'] }),
  x('bulgarian-split-squat', 'Rear-foot-elevated split squat', 'lunge', ['dumbbell', 'bench'], ['quads', 'glutes'], ['hamstrings', 'adductors'], 'moderate', 'intermediate', { uni: true, easier: ['db-split-squat'] }),
  x('reverse-lunge', 'Dumbbell reverse lunge', 'lunge', ['dumbbell'], ['quads', 'glutes'], ['hamstrings', 'adductors'], 'moderate', 'beginner', { uni: true, easier: ['split-squat'], harder: ['bulgarian-split-squat'] }),
  x('step-up', 'Dumbbell step-up', 'lunge', ['dumbbell', 'bench'], ['quads', 'glutes'], ['hamstrings'], 'low', 'beginner', { uni: true, easier: ['split-squat'], harder: ['bulgarian-split-squat'] }),
  x('banded-side-walk', 'Banded side walk', 'lunge', ['band'], ['abductors'], ['glutes'], 'low', 'beginner', {}),
  x('single-leg-stance', 'Single-leg balance hold', 'lunge', ['bodyweight'], ['abductors'], ['calves', 'glutes'], 'low', 'beginner', { uni: true, load: 'timed', harder: ['split-squat'] }),

  // horizontal push
  x('incline-push-up', 'Incline push-up (hands on a counter or bench)', 'horizontal-push', ['bodyweight'], ['chest'], ['triceps', 'shoulders'], 'low', 'beginner', { load: BW, harder: ['push-up'] }),
  x('push-up', 'Push-up', 'horizontal-push', ['bodyweight'], ['chest'], ['triceps', 'shoulders', 'abs'], 'low', 'beginner', { load: BW, easier: ['incline-push-up'], harder: ['ring-push-up'] }),
  x('ring-push-up', 'Ring push-up', 'horizontal-push', ['rings'], ['chest'], ['triceps', 'shoulders', 'abs'], 'low', 'intermediate', { load: BW, easier: ['push-up'], harder: ['ring-dip'] }),
  x('ring-dip', 'Ring dip', 'horizontal-push', ['rings'], ['chest', 'triceps'], ['shoulders'], 'low', 'advanced', { load: BW, easier: ['ring-support-hold', 'ring-push-up'] }),
  x('db-bench', 'Flat dumbbell bench press', 'horizontal-push', ['dumbbell', 'bench'], ['chest'], ['triceps', 'shoulders'], 'low', 'beginner', { easier: ['push-up'], harder: ['bench-press'] }),
  x('incline-db-press', 'Incline dumbbell press', 'horizontal-push', ['dumbbell', 'bench'], ['chest', 'shoulders'], ['triceps'], 'low', 'beginner', { easier: ['incline-push-up'], harder: ['db-bench'] }),
  x('bench-press', 'Barbell bench press', 'horizontal-push', ['barbell', 'bench'], ['chest'], ['triceps', 'shoulders'], 'moderate', 'beginner', { easier: ['db-bench', 'machine-chest-press'] }),
  x('machine-chest-press', 'Machine chest press', 'horizontal-push', ['machine'], ['chest'], ['triceps', 'shoulders'], 'low', 'beginner', { harder: ['db-bench'] }),

  // horizontal pull
  x('inverted-row', 'Inverted row (under a sturdy table or low bar)', 'horizontal-pull', ['bodyweight'], ['lats', 'upper-back'], ['biceps'], 'low', 'beginner', { load: BW, harder: ['ring-row'] }),
  x('ring-row', 'Ring row', 'horizontal-pull', ['rings'], ['lats', 'upper-back'], ['biceps'], 'low', 'beginner', { load: BW, easier: ['inverted-row'], harder: ['pull-up'] }),
  x('band-row', 'Band row', 'horizontal-pull', ['band'], ['lats', 'upper-back'], ['biceps'], 'low', 'beginner', { harder: ['db-row'] }),
  x('db-row', 'One-arm dumbbell row', 'horizontal-pull', ['dumbbell', 'bench'], ['lats', 'upper-back'], ['biceps'], 'low', 'beginner', { uni: true, easier: ['chest-supported-db-row'], harder: ['barbell-row'] }),
  x('chest-supported-db-row', 'Chest-supported dumbbell row', 'horizontal-pull', ['dumbbell', 'bench'], ['upper-back', 'lats'], ['biceps', 'shoulders'], 'low', 'beginner', { harder: ['db-row'] }),
  x('barbell-row', 'Barbell row', 'horizontal-pull', ['barbell'], ['lats', 'upper-back'], ['biceps', 'lower-back'], 'moderate', 'intermediate', { easier: ['db-row'] }),
  x('seated-cable-row', 'Seated cable row', 'horizontal-pull', ['cable'], ['lats', 'upper-back'], ['biceps'], 'low', 'beginner', { harder: ['barbell-row'] }),
  x('machine-row', 'Machine row', 'horizontal-pull', ['machine'], ['upper-back', 'lats'], ['biceps'], 'low', 'beginner', { harder: ['seated-cable-row'] }),

  // vertical push
  x('pike-push-up', 'Pike push-up', 'vertical-push', ['bodyweight'], ['shoulders'], ['triceps', 'chest'], 'low', 'intermediate', { load: BW, easier: ['incline-push-up'], harder: ['wall-handstand'] }),
  x('db-shoulder-press', 'Seated dumbbell shoulder press', 'vertical-push', ['dumbbell', 'bench'], ['shoulders'], ['triceps'], 'low', 'beginner', { easier: ['landmine-press'], harder: ['overhead-press'] }),
  x('overhead-press', 'Standing barbell press', 'vertical-push', ['barbell'], ['shoulders'], ['triceps', 'upper-back', 'abs'], 'high', 'beginner', { easier: ['db-shoulder-press', 'landmine-press'] }),
  x('landmine-press', 'Half-kneeling landmine press', 'vertical-push', ['barbell'], ['shoulders', 'chest'], ['triceps'], 'low', 'beginner', { uni: true, harder: ['db-shoulder-press'] }),
  x('machine-shoulder-press', 'Machine shoulder press', 'vertical-push', ['machine'], ['shoulders'], ['triceps'], 'low', 'beginner', { harder: ['db-shoulder-press'] }),

  // vertical pull
  x('band-pulldown', 'Band pulldown (anchored high)', 'vertical-pull', ['band'], ['lats'], ['biceps', 'upper-back'], 'low', 'beginner', { harder: ['lat-pulldown'] }),
  x('lat-pulldown', 'Lat pulldown', 'vertical-pull', ['machine'], ['lats'], ['biceps', 'upper-back'], 'low', 'beginner', { harder: ['assisted-pull-up', 'pull-up'] }),
  x('dead-hang', 'Dead hang', 'vertical-pull', ['pull-up-bar'], ['forearms'], ['lats', 'upper-back'], 'low', 'beginner', { load: 'timed', harder: ['scapular-pull-up'] }),
  x('scapular-pull-up', 'Scapular pull-up (hang, pull the shoulders down)', 'vertical-pull', ['pull-up-bar'], ['upper-back', 'lats'], [], 'low', 'beginner', { load: BW, easier: ['dead-hang'], harder: ['negative-pull-up'] }),
  x('negative-pull-up', 'Negative pull-up (slow lowering)', 'vertical-pull', ['pull-up-bar'], ['lats'], ['biceps', 'upper-back'], 'low', 'beginner', { load: BW, easier: ['scapular-pull-up'], harder: ['pull-up'] }),
  x('assisted-pull-up', 'Band-assisted pull-up', 'vertical-pull', ['pull-up-bar', 'band'], ['lats'], ['biceps', 'upper-back'], 'low', 'beginner', { load: BW, easier: ['scapular-pull-up'], harder: ['pull-up'] }),
  x('pull-up', 'Pull-up', 'vertical-pull', ['pull-up-bar'], ['lats'], ['biceps', 'upper-back'], 'low', 'intermediate', { load: BW, easier: ['negative-pull-up', 'assisted-pull-up'], harder: [] }),

  // carry
  x('farmer-carry', 'Farmer carry', 'carry', ['dumbbell'], ['forearms', 'upper-back'], ['abs', 'glutes'], 'high', 'beginner', { easier: ['suitcase-carry'] }),
  x('suitcase-carry', 'Suitcase carry (one hand)', 'carry', ['dumbbell'], ['obliques', 'forearms'], ['abs'], 'moderate', 'beginner', { uni: true, harder: ['farmer-carry'] }),

  // core
  x('dead-bug', 'Dead bug', 'core-anti-extension', ['bodyweight'], ['abs'], [], 'low', 'beginner', { load: BW, harder: ['hollow-hold'] }),
  x('plank', 'Front plank', 'core-anti-extension', ['bodyweight'], ['abs'], ['shoulders'], 'low', 'beginner', { load: 'timed', harder: ['hollow-hold'] }),
  x('hollow-hold', 'Hollow body hold', 'core-anti-extension', ['bodyweight'], ['abs'], [], 'low', 'intermediate', { load: 'timed', easier: ['dead-bug'], harder: ['tuck-l-sit'] }),
  x('bird-dog', 'Bird dog', 'core-anti-rotation', ['bodyweight'], ['lower-back', 'abs'], ['glutes'], 'low', 'beginner', { load: BW, harder: ['side-plank'] }),
  x('side-plank', 'Side plank', 'core-anti-rotation', ['bodyweight'], ['obliques'], ['abs', 'abductors'], 'low', 'beginner', { load: 'timed', easier: ['bird-dog'], harder: ['pallof-press'] }),
  x('pallof-press', 'Cable Pallof press', 'core-anti-rotation', ['cable'], ['obliques', 'abs'], [], 'low', 'beginner', { easier: ['side-plank'], harder: ['suitcase-carry'] }),
  x('reverse-crunch', 'Reverse crunch', 'core-flexion', ['bodyweight'], ['abs'], [], 'low', 'beginner', { load: BW, harder: ['hanging-knee-raise'] }),
  x('hanging-knee-raise', 'Hanging knee raise', 'core-flexion', ['pull-up-bar'], ['abs'], ['forearms'], 'moderate', 'intermediate', { load: BW, easier: ['reverse-crunch'] }),

  // calves
  x('calf-raise', 'Standing calf raise (on a step)', 'calves', ['bodyweight'], ['calves'], [], 'low', 'beginner', { load: BW, harder: ['machine-calf-raise'] }),
  x('machine-calf-raise', 'Machine calf raise', 'calves', ['machine'], ['calves'], [], 'low', 'beginner', { easier: ['calf-raise'] }),

  // arms
  x('db-curl', 'Dumbbell curl', 'biceps', ['dumbbell'], ['biceps'], ['forearms'], 'low', 'beginner', {}),
  x('cable-pushdown', 'Cable triceps pushdown', 'triceps', ['cable'], ['triceps'], [], 'low', 'beginner', { easier: ['overhead-db-extension'] }),
  x('overhead-db-extension', 'Overhead dumbbell triceps extension', 'triceps', ['dumbbell'], ['triceps'], [], 'low', 'beginner', { harder: ['cable-pushdown'] }),
  x('bench-dip', 'Bench dip', 'triceps', ['bench'], ['triceps'], ['chest', 'shoulders'], 'low', 'beginner', { load: BW, harder: ['ring-dip'] }),

  // rear delts, lateral raises, neck and upper back
  x('face-pull', 'Cable face pull', 'rear-delt', ['cable'], ['upper-back'], ['shoulders'], 'low', 'beginner', { easier: ['band-pull-apart'] }),
  x('band-pull-apart', 'Band pull-apart', 'rear-delt', ['band'], ['upper-back'], ['shoulders'], 'low', 'beginner', { harder: ['face-pull'] }),
  x('reverse-db-fly', 'Bent-over reverse dumbbell fly', 'rear-delt', ['dumbbell'], ['upper-back'], ['shoulders'], 'low', 'beginner', { easier: ['band-pull-apart'] }),
  x('prone-t-raise', 'Prone T raise (face down, arms out)', 'rear-delt', ['bodyweight'], ['upper-back'], ['shoulders'], 'low', 'beginner', { load: BW, harder: ['reverse-db-fly'] }),
  x('db-lateral-raise', 'Dumbbell lateral raise', 'lateral-raise', ['dumbbell'], ['shoulders'], [], 'low', 'beginner', { harder: ['cable-lateral-raise'] }),
  x('cable-lateral-raise', 'Cable lateral raise', 'lateral-raise', ['cable'], ['shoulders'], [], 'low', 'beginner', { easier: ['db-lateral-raise'] }),
  x('chin-tuck', 'Chin tuck hold', 'neck-upper-back', ['bodyweight'], ['neck'], [], 'low', 'beginner', { load: 'timed' }),
  x('wall-slide', 'Wall slide', 'neck-upper-back', ['bodyweight'], ['upper-back'], ['shoulders'], 'low', 'beginner', { load: BW, harder: ['prone-t-raise'] }),

  // conditioning
  x('brisk-walk', 'Brisk walk', 'conditioning', ['bodyweight'], [], [], 'low', 'beginner', { load: 'cardio' }),
  x('easy-run', 'Easy run (zone 2)', 'conditioning', ['bodyweight'], [], [], 'low', 'beginner', { load: 'cardio', easier: ['brisk-walk'], harder: ['hill-intervals-4x4'] }),
  x('zone2-bike', 'Easy bike (zone 2)', 'conditioning', ['machine'], [], [], 'low', 'beginner', { load: 'cardio', harder: ['bike-intervals-4x4'] }),
  x('bike-intervals-4x4', 'Bike intervals, 4 x 4 min', 'conditioning', ['machine'], [], [], 'low', 'intermediate', { load: 'cardio', easier: ['zone2-bike'] }),
  x('hill-intervals-4x4', 'Uphill walk or run intervals, 4 x 4 min', 'conditioning', ['bodyweight'], [], [], 'low', 'intermediate', { load: 'cardio', easier: ['brisk-walk'] }),

  // mobility
  x('ankle-mobility', 'Knee-to-wall ankle mobility', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', { load: 'timed' }),
  x('thoracic-extension', 'Thoracic extension over a bench or roller', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', { load: 'timed' }),
  x('chest-doorway-stretch', 'Doorway chest stretch', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', { load: 'timed' }),
  x('lat-stretch', 'Kneeling lat stretch', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', { load: 'timed' }),
  x('hip-flexor-stretch', 'Half-kneeling hip-flexor stretch', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', { load: 'timed' }),

  // calisthenics skills
  x('wall-handstand', 'Chest-to-wall handstand hold', 'skill', ['bodyweight'], ['shoulders'], ['triceps', 'abs'], 'low', 'intermediate', { load: 'timed', easier: ['pike-push-up'] }),
  x('tuck-l-sit', 'Tuck L-sit', 'skill', ['bodyweight'], ['abs'], ['triceps'], 'low', 'intermediate', { load: 'timed', easier: ['hollow-hold'] }),
  x('ring-support-hold', 'Ring support hold', 'skill', ['rings'], ['triceps', 'chest'], ['shoulders', 'abs'], 'low', 'beginner', { load: 'timed', harder: ['ring-dip'] }),
  x('pistol-squat', 'Pistol squat', 'skill', ['bodyweight'], ['quads', 'glutes'], ['abs'], 'low', 'advanced', { uni: true, load: BW, easier: ['box-pistol'] }),
];

export const CATALOGUE_BY_ID: ReadonlyMap<string, CatalogueEntry> = new Map(CATALOGUE.map((e) => [e.id, e]));
