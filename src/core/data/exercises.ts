// The exercise catalogue, written for this project (intended CC0): every
// movement the engine knows, from the strength patterns to calisthenics
// ladders, jumps, cardio, mobility, warm-up and balance work. Each entry: the
// movement pattern, the equipment it needs (all of it), the muscles it trains
// ({main, helps}, ids from data/muscles.ts), its abdominal-strain tag,
// whether it works one side at a time, a level, how it is loaded, and ordered
// easier and harder alternatives by id, each link listed both ways (a test
// checks). docs/exercise-library.md has the method, the conventions and the
// sources.
//
// Each entry also has its other common names (`aliases`, matched as its name
// is), the tools that can stand in for its defining one (`alsoWith`), what it
// asks of the body (`risk`, MOVEMENT_TAGS), its roles beyond the pattern
// (`uses`), whether it suits a hotel room (`hotel`) and its guide text
// (`guide`: the setup, the movement and the mistake to avoid).
//
// `regions` (ids from data/regions.ts) lists the parts of a muscle a movement
// biases, where training studies (or, for a heuristic region, the usual
// practice) show one. Region credit, beside the muscle's own sets: a set
// counts 1 for each listed region whose parent muscle is one of the
// movement's main muscles, and 0.5 when the parent only helps. A region's
// parent is always in main or helps (a test checks), so no region is
// credited from a muscle the movement does not train.
//
// `longLength` marks the versions that train a two-joint muscle at a long
// length where a training study compared them: the seated leg curl (hip bent)
// over the lying one (Maeo 2021), overhead triceps extensions over pushdowns
// (Maeo 2023), standing calf raises (knees straight) over seated ones for the
// gastrocnemius (Kinoshita 2023). Moderate taken together; a search ranks
// them first for that muscle, a display order and never a choice.
//
// Mobility and conditioning entries carry no muscles, so they are never
// counted as sets.

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
  'hip-abduction',
  'chest-fly',
  'jump',
  'conditioning',
  'mobility',
  'skill',
] as const;
export type Pattern = (typeof PATTERNS)[number];

/**
 * `rings` covers rings and suspension trainers (TRX); `parallel-bars` a dip
 * station, dip bars or sturdy parallettes; `trap-bar` a trap (hex) bar;
 * `sled` a push sled; `stability-ball` an exercise (Swiss) ball; `ab-wheel`
 * an ab roller; `pool` a swimming pool. `machine` covers every gym machine,
 * the cardio machines too, and `bench` a weight bench or a sturdy box that
 * takes a load or a landing. Furniture that only supports the body (a chair,
 * a stair, a counter, a wall, a door frame, a towel on a smooth floor) needs
 * nothing: `bodyweight`.
 */
export const EQUIPMENT = ['bodyweight', 'dumbbell', 'barbell', 'cable', 'machine', 'band', 'bench', 'pull-up-bar', 'kettlebell', 'rings', 'parallel-bars', 'trap-bar', 'sled', 'jump-rope', 'stability-ball', 'ab-wheel', 'pool'] as const;
export type Equipment = (typeof EQUIPMENT)[number];

export const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type Level = (typeof LEVELS)[number];

export type Load = 'external' | 'bodyweight' | 'timed' | 'cardio';
export type IapTag = 'low' | 'moderate' | 'high';

/**
 * What a movement asks of the body: `joint:` tags for a joint's position or
 * load (the schema's RiskTag form), `demand:` tags for the body as a whole.
 * They describe the movement and never name a condition. Facts for the coach
 * to weigh, not a ban: nothing screens on them yet (the Ledger screens the
 * abdominal-strain tag).
 */
export const MOVEMENT_TAGS = {
  'joint:neck-loaded': 'Load goes through the head or neck (handstand push-ups, dragon flags).',
  'joint:shoulder-overhead': 'The arms work above the head under load: presses, overhead holds and carries, pulldowns and pull-ups.',
  'joint:shoulder-hang': 'Body weight hangs from the hands (hangs, pull-ups, hanging raises, levers).',
  'joint:shoulder-extension': 'The upper arm is pulled far behind the body under load (dips, bench dips, muscle-ups, skin the cat).',
  'joint:wrist-extension': 'Body weight rests on bent-back wrists (hands-down push-ups and planks, handstands, crawling, the front rack).',
  'joint:grip-heavy': 'Heavy or long gripping (deadlifts, heavy rows, carries, hangs), which also loads the elbows and forearms.',
  'joint:spine-axial': 'A heavy load rests on the shoulders or overhead and presses down through the spine.',
  'joint:spine-flexion': 'The spine curls forward repeatedly or under load (crunches and other curl-ups).',
  'joint:spine-extension': 'The lower back arches against load or gravity (back extensions, prone lifts).',
  'joint:spine-rotation': 'The trunk turns against resistance (chops and other loaded rotation).',
  'joint:back-bent-over': 'The torso is tipped forward and unsupported while holding a load (hinges, bent-over rows and flies).',
  'joint:hip-deep-flexion': 'The hip bends deeply under load (deep squats, pistols, a deep leg press).',
  'joint:knee-deep-flexion': 'The knee bends well past a right angle under load (deep squats, pistols, hack squat, leg press, cossacks).',
  'joint:kneeling': 'Weight rests on a knee (half-kneeling work, kneeling stretches, Nordics).',
  'demand:impact': 'Jumping, hopping, running or landing.',
  'demand:inversion': 'The head goes below the hips or the heart (handstands, pike holds, skin the cat).',
  'demand:vigorous': 'Vigorous effort, about 6 METs or more for most adults (intervals, running, skipping, burpees, swings, sled pushes).',
  'demand:floor': 'Getting down to the floor and back up.',
  'demand:balance': 'A real balance challenge without support (single-leg standing work, arm balances, an unstable base).',
  'demand:supine': 'Lying on the back for the set.',
  'demand:prone': 'Lying face down for the set.',
} as const;
export type MovementTag = keyof typeof MOVEMENT_TAGS;

/** Roles a movement suits beyond its pattern. */
export const MOVEMENT_USES = {
  'warm-up': 'Suits the warm-up before a session.',
  'cool-down': 'Suits the easy end of a session.',
  posture: 'Part of the posture emphasis (upper back, neck, shoulders, chest opening).',
  balance: 'Balance training, for example the balance work every session at 65 and over.',
  'desk-break': 'Works standing or seated in work clothes during a desk break.',
} as const;
export type MovementUse = keyof typeof MOVEMENT_USES;

/** A movement's guide text: the setup, the movement, the mistake to avoid (a plan's guide entry has the same three). */
export interface MovementGuide {
  setup: string;
  do: string;
  avoid: string;
}

export interface CatalogueEntry {
  id: string;
  name: string;
  /** Other common names for the same movement, matched as its name is (catalogue-match.ts). A nearest-but-different movement is a synonym there instead. */
  aliases: string[];
  pattern: Pattern;
  /** Everything listed is needed; `bodyweight` needs nothing. The first item is the defining tool. */
  equipment: Equipment[];
  /** Tools that can stand in for the defining one with no change to the movement (a kettlebell for a goblet squat, a band for a cable face pull). */
  alsoWith: Equipment[];
  muscles: { main: string[]; helps: string[] };
  iap: IapTag;
  unilateral: boolean;
  level: Level;
  load: Load;
  /** Easier and harder alternatives, nearest first. */
  easier: string[];
  harder: string[];
  /** The muscle regions it biases (data/regions.ts); left out when it biases none. */
  regions?: string[];
  /**
   * The two-joint muscles, or their two-joint region, it loads at a long
   * length where a training study compared versions (muscle or region ids);
   * left out for the rest. Search results rank these first for that muscle.
   */
  longLength?: string[];
  /** What it asks of the body (MOVEMENT_TAGS); empty when nothing stands out. */
  risk: MovementTag[];
  /** Roles beyond the pattern (MOVEMENT_USES). */
  uses: MovementUse[];
  /**
   * Fits a hotel room: needs nothing beyond the travel kit (bodyweight,
   * dumbbells, a band; an `alsoWith` tool counts), room furniture or a
   * stairwell, is not advanced, and is quiet (no repeated jumping). Unsafe
   * furniture rules out the inverted row, the anchor the Nordic curls, the
   * room the swings and the handstand kick-up.
   */
  hotel: boolean;
  guide: MovementGuide;
}

type Opts = {
  uni?: boolean;
  load?: Load;
  easier?: string[];
  harder?: string[];
  regions?: string[];
  longLength?: string[];
  aliases?: string[];
  alsoWith?: Equipment[];
  risk?: MovementTag[];
  uses?: MovementUse[];
  hotel?: boolean;
  /** The setup, the movement, the mistake to avoid. */
  guide: [string, string, string];
};

function x(id: string, name: string, pattern: Pattern, equipment: Equipment[], main: string[], helps: string[], iap: IapTag, level: Level, o: Opts): CatalogueEntry {
  const [setup, doIt, avoid] = o.guide;
  return {
    id,
    name,
    aliases: o.aliases ?? [],
    pattern,
    equipment,
    alsoWith: o.alsoWith ?? [],
    muscles: { main, helps },
    iap,
    unilateral: o.uni ?? false,
    level,
    load: o.load ?? 'external',
    easier: o.easier ?? [],
    harder: o.harder ?? [],
    ...(o.regions ? { regions: o.regions } : {}),
    ...(o.longLength ? { longLength: o.longLength } : {}),
    risk: o.risk ?? [],
    uses: o.uses ?? [],
    hotel: o.hotel ?? false,
    guide: { setup, do: doIt, avoid },
  };
}

/**
 * Whether a movement can be done with this equipment at hand: everything it
 * lists, or an `alsoWith` tool in place of the defining one. `bodyweight`
 * needs nothing.
 */
export function usableWith(e: Pick<CatalogueEntry, 'equipment' | 'alsoWith'>, have: ReadonlySet<Equipment>): boolean {
  const ok = (q: Equipment) => q === 'bodyweight' || have.has(q);
  const rest = e.equipment.slice(1).every(ok);
  return rest && (ok(e.equipment[0]!) || e.alsoWith.some(ok));
}

const BW: Opts['load'] = 'bodyweight';

export const CATALOGUE: readonly CatalogueEntry[] = [
  // squat
  // No hamstrings in any squat's helps: training studies measuring muscle size
  // find little or no hamstring growth from squats or the leg press (the
  // hamstrings barely change length in them), while deep squats do grow the
  // adductors, so the loaded deep squats and the leg press help the adductors.
  // Moderate: Kubo 2019, https://doi.org/10.1007/s00421-019-04181-y;
  // Plotkin 2023, https://doi.org/10.3389/fphys.2023.1279170.
  // Regions: squats, the leg press, split squats and lunges grow the vasti
  // but barely the rectus femoris; the leg extension grows the vasti about as
  // much as squats and the leg press do, and the rectus femoris besides
  // (Moderate: Ema 2013, Kubo 2019, Kinoshita 2026, Larsen 2025b).
  // The front squats and the hack squat are loaded deep squats (the adductors
  // help); the supported squat, the wall sit and the assisted pistol are not.
  // A movement plans used to name as a synonym of an older entry (the
  // assisted pistol as the box pistol, the chin-up as the pull-up) keeps that
  // entry's tags, so a plan's sets per muscle do not move.
  x('box-squat', 'Box squat (bodyweight, sit back to a box)', 'squat', ['bodyweight'], ['quads', 'glutes'], [], 'low', 'beginner', {
    load: BW, easier: ['supported-squat'], harder: ['bodyweight-squat', 'goblet-squat', 'heel-elevated-goblet-squat', 'leg-press'], regions: ['quads-vasti'],
    aliases: ['chair squat', 'sit to stand', 'chair stand'], uses: ['warm-up', 'balance'], hotel: true,
    guide: ['Stand in front of a box or chair, feet shoulder width; a higher box makes it easier.', 'Sit back until you touch the box lightly, then stand up.', 'Dropping onto the box, or rocking forward to get up.'],
  }),
  x('bodyweight-squat', 'Bodyweight squat', 'squat', ['bodyweight'], ['quads', 'glutes'], ['abs'], 'low', 'beginner', {
    load: BW, easier: ['box-squat', 'supported-squat'], harder: ['goblet-squat', 'box-pistol', 'assisted-pistol', 'snap-down'], regions: ['quads-vasti'],
    aliases: ['air squat'], risk: ['joint:hip-deep-flexion', 'joint:knee-deep-flexion'], uses: ['warm-up'], hotel: true,
    guide: ['Feet about shoulder width, toes turned out a little.', 'Sit down between the heels, chest proud, knees following the toes, then stand.', 'Knees caving in, or the heels lifting.'],
  }),
  x('heel-elevated-goblet-squat', 'Heel-elevated goblet squat', 'squat', ['dumbbell'], ['quads', 'glutes'], ['abs', 'upper-back'], 'moderate', 'beginner', {
    easier: ['box-squat'], harder: ['goblet-squat'], regions: ['quads-vasti'],
    aliases: ['heels elevated goblet squat'], alsoWith: ['kettlebell'], risk: ['joint:hip-deep-flexion', 'joint:knee-deep-flexion'], hotel: true,
    guide: ['Heels on a small plate or wedge, the weight held at the chest.', 'Sit deep with the torso upright, letting the knees travel forward freely, then stand.', 'Leaning forward, or the heels sliding off the wedge.'],
  }),
  x('goblet-squat', 'Goblet squat', 'squat', ['dumbbell'], ['quads', 'glutes'], ['abs', 'upper-back', 'adductors'], 'moderate', 'beginner', {
    easier: ['heel-elevated-goblet-squat', 'box-squat', 'bodyweight-squat', 'wall-sit'], harder: ['tempo-goblet-squat', 'back-squat', 'double-kb-front-squat', 'front-squat'], regions: ['quads-vasti'],
    aliases: ['kettlebell goblet squat', 'dumbbell goblet squat'], alsoWith: ['kettlebell'], risk: ['joint:hip-deep-flexion', 'joint:knee-deep-flexion'], hotel: true,
    guide: ['Hold the weight at the chest, elbows down.', 'Sit down between the knees, then drive up through the whole foot.', 'Rounding the back at the bottom, or the heels lifting.'],
  }),
  x('tempo-goblet-squat', 'Tempo goblet squat (3 s down)', 'squat', ['dumbbell'], ['quads', 'glutes'], ['abs', 'upper-back'], 'moderate', 'intermediate', {
    easier: ['goblet-squat'], harder: ['back-squat'], regions: ['quads-vasti'],
    aliases: ['slow goblet squat'], alsoWith: ['kettlebell'], risk: ['joint:hip-deep-flexion', 'joint:knee-deep-flexion'], hotel: true,
    guide: ['Weight held at the chest, feet shoulder width.', 'Count three seconds on the way down to the same depth every rep, then stand at normal speed.', 'Cutting the depth or the count short as the set gets hard.'],
  }),
  x('back-squat', 'Barbell back squat', 'squat', ['barbell'], ['quads', 'glutes'], ['lower-back', 'abs', 'adductors'], 'high', 'beginner', {
    easier: ['goblet-squat', 'leg-press', 'hack-squat', 'tempo-goblet-squat'], regions: ['quads-vasti'],
    aliases: ['barbell squat'], risk: ['joint:spine-axial', 'joint:hip-deep-flexion', 'joint:knee-deep-flexion'],
    guide: ['Bar on the upper back, hands snug, safety arms set just below your depth.', 'Take a big breath and brace, sit down, then rise with the hips and chest together.', 'The hips shooting up first so the chest tips forward.'],
  }),
  x('leg-press', 'Leg press', 'squat', ['machine'], ['quads', 'glutes'], ['adductors'], 'high', 'beginner', {
    easier: ['box-squat', 'leg-extension'], harder: ['back-squat', 'hack-squat'], regions: ['quads-vasti'],
    aliases: ['45 degree leg press', 'seated leg press'], risk: ['joint:hip-deep-flexion', 'joint:knee-deep-flexion'],
    guide: ['Feet flat on the platform, lower back on the pad.', 'Lower to the depth where the hips stay down, then press through the whole foot.', 'The hips curling off the pad at the bottom, or locking the knees hard at the top.'],
  }),
  x('leg-extension', 'Leg extension', 'squat', ['machine'], ['quads'], [], 'low', 'beginner', {
    harder: ['leg-press'], regions: ['quads-rf', 'quads-vasti'],
    aliases: ['quad extension', 'knee extension machine'],
    guide: ['Pad on the lower shin, knees lined up with the machine\'s pivot.', 'Lift to straight legs, pause, and lower slowly.', 'Swinging the weight up or letting the stack drop.'],
  }),
  x('box-pistol', 'Box pistol (one leg, down to a box)', 'squat', ['bodyweight'], ['quads', 'glutes'], ['abs'], 'low', 'intermediate', {
    uni: true, load: BW, easier: ['bodyweight-squat', 'assisted-pistol'], harder: ['pistol-squat', 'shrimp-squat'], regions: ['quads-vasti'],
    aliases: ['box pistol high box', 'box pistol low box', 'pistol to a box'], risk: ['demand:balance'], hotel: true,
    guide: ['Stand on one leg in front of a box, the other leg reaching forward.', 'Sit back to the box with control, then stand up on the one leg; lower the box over time.', 'Rocking back to get a start.'],
  }),
  x('supported-squat', 'Supported squat (holding a door frame or rail)', 'squat', ['bodyweight'], ['quads', 'glutes'], [], 'low', 'beginner', {
    load: BW, harder: ['box-squat', 'bodyweight-squat', 'wall-sit', 'stair-step-up'], regions: ['quads-vasti'],
    aliases: ['assisted squat', 'counterbalance squat'], uses: ['balance'], hotel: true,
    guide: ['Hold a door frame or rail lightly, just enough to stay steady.', 'Sit the hips back and down as far as feels easy, then push the floor away to stand.', 'Pulling yourself up with the arms.'],
  }),
  x('wall-sit', 'Wall sit', 'squat', ['bodyweight'], ['quads'], ['glutes'], 'low', 'beginner', {
    load: 'timed', easier: ['supported-squat'], harder: ['goblet-squat'], regions: ['quads-vasti'],
    aliases: ['wall squat hold'], hotel: true,
    guide: ['Back flat on the wall, feet a step in front.', 'Slide down only as low as your knees like and hold, breathing steadily.', 'Holding the breath.'],
  }),
  x('front-squat', 'Barbell front squat', 'squat', ['barbell'], ['quads', 'glutes'], ['upper-back', 'abs', 'adductors'], 'high', 'intermediate', {
    easier: ['goblet-squat', 'double-kb-front-squat'], regions: ['quads-vasti'],
    risk: ['joint:wrist-extension', 'joint:spine-axial', 'joint:hip-deep-flexion', 'joint:knee-deep-flexion'],
    guide: ['Bar resting on the front of the shoulders, elbows high.', 'Stay tall as you sit straight down, then drive up leading with the chest.', 'The elbows dropping, which tips the bar forward.'],
  }),
  x('double-kb-front-squat', 'Double kettlebell front squat', 'squat', ['kettlebell'], ['quads', 'glutes'], ['abs', 'upper-back', 'adductors'], 'moderate', 'intermediate', {
    easier: ['goblet-squat'], harder: ['front-squat'], regions: ['quads-vasti'],
    aliases: ['kettlebell front squat', 'double kettlebell squat'], risk: ['joint:hip-deep-flexion', 'joint:knee-deep-flexion'],
    guide: ['Bells resting in the crook of each arm, wrists straight.', 'Ribs down, sit between the heels, and stand with the elbows close.', 'Letting the bells pull the chest forward and the back round.'],
  }),
  x('hack-squat', 'Hack squat (machine)', 'squat', ['machine'], ['quads', 'glutes'], ['adductors'], 'high', 'beginner', {
    easier: ['leg-press'], harder: ['back-squat'], regions: ['quads-vasti'],
    aliases: ['machine hack squat'], risk: ['joint:hip-deep-flexion', 'joint:knee-deep-flexion'],
    guide: ['Back and hips on the pad, feet shoulder width on the platform.', 'Lower under control to a depth you own, then press through the whole foot.', 'The hips peeling off the pad, or bouncing out of the bottom.'],
  }),
  x('assisted-pistol', 'Assisted pistol (one leg, holding a post or rings)', 'squat', ['bodyweight'], ['quads', 'glutes'], ['abs'], 'low', 'intermediate', {
    uni: true, load: BW, easier: ['bodyweight-squat'], harder: ['box-pistol', 'shrimp-squat'], regions: ['quads-vasti'],
    aliases: ['assisted pistol squat', 'supported pistol'], risk: ['joint:hip-deep-flexion', 'joint:knee-deep-flexion'], hotel: true,
    guide: ['Stand on one leg holding a post or rings.', 'Sit down with the free leg reaching forward, using the hands only as much as you need, then stand.', 'The knee caving in; it tracks over the middle toes.'],
  }),

  // hinge
  // Bridges and hip thrusts help no hamstrings: the hip-thrust training study
  // found little hamstring growth, the knee bent keeping them short (Moderate:
  // Plotkin 2023, https://doi.org/10.3389/fphys.2023.1279170; Kubo 2019,
  // https://doi.org/10.1007/s00421-019-04181-y, for squats).
  // The Romanian deadlift and deadlift family help the forearms: the grip
  // holds the load every rep (a heuristic, no growth study).
  // Regions: Romanian deadlifts, deadlifts and back extensions load the
  // hamstrings at the hip; leg curls (seated, lying, on sliders) load them at
  // the knee. The seated curl, the hip bent stretching the long head, grew
  // the hamstrings more than the lying curl did, the long head and the
  // semimembranosus too, but the hip-extension region is for hinges, so it
  // counts at the knee only (Moderate: Maeo 2021, Maeo 2024, Bourne 2017);
  // bridges and hip thrusts train no hamstrings.
  // The slider curl holds the hips up in a bridge throughout, so the glutes
  // help (a heuristic, no growth study); it is the knee-flexion option with
  // no equipment, a towel on a smooth floor doing for sliders. It is hard for
  // a beginner (the hamstrings take the body's weight with the hips held up),
  // so it is intermediate, after the glute bridge; a machine curl is another
  // tool, neither its step down nor its next step, which is the Nordic
  // lowering. The ball curl holds the same bridge, so it is tagged alike.
  // The kettlebell's deadlift, swings and clean, the trap bar deadlift and the
  // kickstand RDL are hinges at the hip, gripping the load: the forearms help.
  x('glute-bridge', 'Glute bridge', 'hinge', ['bodyweight'], ['glutes'], [], 'low', 'beginner', {
    load: BW, harder: ['single-leg-glute-bridge', 'hip-thrust', 'db-rdl', 'back-extension', 'kb-deadlift', 'db-hip-thrust', 'stability-ball-leg-curl', 'slider-leg-curl'],
    aliases: ['bridge', 'hip bridge', 'floor bridge'], risk: ['demand:floor', 'demand:supine'], uses: ['warm-up'], hotel: true,
    guide: ['Lie on your back, feet flat, heels near the hips.', 'Squeeze the glutes to lift the hips, ribs down, and pause at the top.', 'Arching the lower back to get higher.'],
  }),
  x('single-leg-glute-bridge', 'Single-leg glute bridge', 'hinge', ['bodyweight'], ['glutes'], [], 'low', 'beginner', {
    uni: true, load: BW, easier: ['glute-bridge'], harder: ['hip-thrust'],
    aliases: ['one leg glute bridge'], risk: ['demand:floor', 'demand:supine'], hotel: true,
    guide: ['Lie on your back, one foot down, the other knee pulled in.', 'Push through the heel to lift the hips, and pause at the top.', 'The hips tilting to one side.'],
  }),
  x('hip-thrust', 'Barbell hip thrust', 'hinge', ['barbell', 'bench'], ['glutes'], [], 'moderate', 'intermediate', {
    easier: ['single-leg-glute-bridge', 'glute-bridge', 'db-hip-thrust'],
    aliases: ['glute thrust'], risk: ['demand:supine'],
    guide: ['Shoulder blades on the bench edge, bar padded across the hips.', 'Drive the hips up until the shins are vertical, chin tucked, and finish with the glutes.', 'Finishing with the lower back arched.'],
  }),
  x('db-rdl', 'Dumbbell Romanian deadlift', 'hinge', ['dumbbell'], ['hamstrings', 'glutes'], ['lower-back', 'forearms'], 'moderate', 'beginner', {
    easier: ['glute-bridge', 'kb-deadlift', 'hip-hinge-drill', 'seated-leg-curl', 'cable-pull-through', 'lying-leg-curl'], harder: ['rdl', 'single-leg-rdl', 'kickstand-rdl', 'deadlift'], regions: ['hamstrings-hip'],
    alsoWith: ['kettlebell'], risk: ['joint:back-bent-over'], hotel: true,
    guide: ['Stand tall, weights in front of the thighs.', 'Push the hips back with soft knees and a flat back, the weights sliding down the thighs; stand when the hamstrings stretch.', 'Rounding the back to reach lower.'],
  }),
  x('single-leg-rdl', 'Single-leg dumbbell RDL', 'hinge', ['dumbbell'], ['hamstrings', 'glutes'], ['lower-back', 'forearms'], 'low', 'intermediate', {
    uni: true, easier: ['db-rdl', 'kickstand-rdl'], regions: ['hamstrings-hip'],
    aliases: ['one leg rdl'], alsoWith: ['kettlebell'], risk: ['joint:back-bent-over', 'demand:balance'], uses: ['balance'], hotel: true,
    guide: ['Stand on one leg, a weight in the opposite hand; touch a wall with the free hand if needed.', 'Reach the free leg back as the chest lowers, hips square to the floor, then stand.', 'The hips opening toward the ceiling as you lower.'],
  }),
  x('rdl', 'Barbell Romanian deadlift', 'hinge', ['barbell'], ['hamstrings', 'glutes'], ['lower-back', 'forearms'], 'high', 'beginner', {
    easier: ['db-rdl', 'back-extension'], harder: ['deadlift'], regions: ['hamstrings-hip'],
    aliases: ['romanian deadlift', 'barbell rdl'], risk: ['joint:grip-heavy', 'joint:back-bent-over'],
    guide: ['Start standing, bar close to the legs.', 'Push the hips back with a long spine, the bar in contact with the thighs, then stand.', 'The bar drifting away from the legs, or the back rounding.'],
  }),
  x('deadlift', 'Barbell deadlift', 'hinge', ['barbell'], ['glutes', 'hamstrings'], ['lower-back', 'quads', 'upper-back', 'forearms'], 'high', 'intermediate', {
    easier: ['rdl', 'db-rdl', 'trap-bar-deadlift'], regions: ['hamstrings-hip'],
    aliases: ['conventional deadlift'], risk: ['joint:grip-heavy', 'joint:back-bent-over'],
    guide: ['Bar over the middle of the foot, shins close.', 'Pull the slack out, then push the floor away and lock out with the glutes.', 'Jerking the bar off the floor, or leaning back at the top.'],
  }),
  x('back-extension', '45-degree back extension', 'hinge', ['machine'], ['lower-back', 'glutes'], ['hamstrings'], 'low', 'beginner', {
    easier: ['glute-bridge', 'prone-back-extension'], harder: ['rdl'], regions: ['hamstrings-hip'],
    aliases: ['45 back extension', 'hyperextension', 'roman chair back extension'], risk: ['joint:spine-extension'],
    guide: ['Pad just below the hip bones, feet secured.', 'Hinge down, then rise until the body is straight, squeezing the glutes.', 'Over-arching the lower back at the top.'],
  }),
  x('seated-leg-curl', 'Seated leg curl', 'hinge', ['machine'], ['hamstrings'], [], 'low', 'beginner', {
    harder: ['db-rdl'], regions: ['hamstrings-knee'], longLength: ['hamstrings'],
    aliases: ['seated hamstring curl'],
    guide: ['Knees lined up with the machine\'s pivot, thigh pad snug.', 'Curl the heels down and back, then lower slowly.', 'Letting the weight snap back up.'],
  }),
  x('lying-leg-curl', 'Lying leg curl', 'hinge', ['machine'], ['hamstrings'], [], 'low', 'beginner', {
    harder: ['db-rdl'], regions: ['hamstrings-knee'],
    aliases: ['prone leg curl', 'lying hamstring curl'], risk: ['demand:prone'],
    guide: ['Lie face down, hips pressed into the pad, the roller above the heels.', 'Curl the heels toward the glutes, then lower over three seconds.', 'The hips lifting off the pad as you curl.'],
  }),
  x('slider-leg-curl', 'Slider leg curl (heels on sliders or a towel, hips up)', 'hinge', ['bodyweight'], ['hamstrings'], ['glutes'], 'low', 'intermediate', {
    load: BW, easier: ['glute-bridge', 'stability-ball-leg-curl'], harder: ['nordic-negative'], regions: ['hamstrings-knee'],
    aliases: ['towel leg curl', 'sliding leg curl'], risk: ['demand:floor', 'demand:supine'], hotel: true,
    guide: ['Lie on your back, heels on sliders or towels, hips lifted.', 'Slide the heels out slowly, then pull them back; do only the way out if the way back is too hard.', 'Letting the hips drop to the floor.'],
  }),
  x('hip-hinge-drill', 'Hip hinge drill (hands on hips, unloaded)', 'hinge', ['bodyweight'], ['hamstrings', 'glutes'], ['lower-back'], 'low', 'beginner', {
    load: BW, harder: ['kb-deadlift', 'db-rdl', 'cable-pull-through'], regions: ['hamstrings-hip'],
    aliases: ['dowel hinge', 'hip hinge'], uses: ['warm-up'], hotel: true,
    guide: ['Stand tall, hands on the hips, knees soft.', 'Push the hips back as if closing a door with them, shins nearly upright; stop when the backs of the legs stretch.', 'Bending at the waist instead of moving the hips back.'],
  }),
  x('kb-deadlift', 'Kettlebell deadlift', 'hinge', ['kettlebell'], ['glutes', 'hamstrings'], ['quads', 'lower-back', 'forearms'], 'moderate', 'beginner', {
    easier: ['hip-hinge-drill', 'glute-bridge'], harder: ['db-rdl', 'kb-swing', 'trap-bar-deadlift'], regions: ['hamstrings-hip'],
    aliases: ['dumbbell deadlift'], alsoWith: ['dumbbell'], risk: ['joint:back-bent-over'], hotel: true,
    guide: ['Bell between the feet, under the hips.', 'Hinge down with a long, flat back, grip the bell, and stand by squeezing the glutes.', 'Squatting the bell up, or leaning back at the top.'],
  }),
  x('trap-bar-deadlift', 'Trap bar deadlift', 'hinge', ['trap-bar'], ['glutes', 'quads', 'hamstrings'], ['lower-back', 'upper-back', 'forearms'], 'high', 'beginner', {
    easier: ['kb-deadlift'], harder: ['deadlift'], regions: ['hamstrings-hip'],
    aliases: ['hex bar deadlift', 'trap bar lift'], risk: ['joint:grip-heavy', 'joint:back-bent-over'],
    guide: ['Stand in the centre of the frame, handles by the ankles.', 'Grip, brace, then push the floor away, hips and shoulders rising together.', 'The hips rising before the shoulders.'],
  }),
  x('kb-swing', 'Kettlebell swing (two hands)', 'hinge', ['kettlebell'], ['glutes', 'hamstrings'], ['lower-back', 'forearms'], 'moderate', 'intermediate', {
    easier: ['kb-deadlift'], harder: ['single-arm-kb-swing'], regions: ['hamstrings-hip'],
    aliases: ['russian swing', 'dumbbell swing'], alsoWith: ['dumbbell'], risk: ['joint:back-bent-over', 'demand:vigorous'],
    guide: ['Bell a step in front, feet a little wider than the hips.', 'Hike the bell back high between the thighs, then snap the hips forward, the arms just guiding; stand tall and brace at the top.', 'Lifting the bell with the arms, or squatting the swing.'],
  }),
  x('single-arm-kb-swing', 'Single-arm kettlebell swing', 'hinge', ['kettlebell'], ['glutes', 'hamstrings'], ['obliques', 'forearms'], 'moderate', 'intermediate', {
    uni: true, easier: ['kb-swing'], harder: ['kb-clean'], regions: ['hamstrings-hip'],
    aliases: ['one arm swing', 'one arm kettlebell swing'], alsoWith: ['dumbbell'], risk: ['joint:back-bent-over', 'demand:vigorous'],
    guide: ['Same stance as the two-hand swing, the free hand out or on the hip.', 'Swing with the same hip snap, shoulders square.', 'Letting the bell twist the shoulders round.'],
  }),
  x('kb-clean', 'Kettlebell clean (one arm)', 'hinge', ['kettlebell'], ['glutes', 'hamstrings'], ['upper-back', 'forearms'], 'moderate', 'intermediate', {
    uni: true, easier: ['single-arm-kb-swing'], regions: ['hamstrings-hip'],
    aliases: ['single arm clean'], risk: ['joint:back-bent-over'],
    guide: ['Bell between the feet, one hand on the handle.', 'Swing it close to the body and let the hand slide around the handle so the bell lands softly in the rack, elbow tucked.', 'Letting the bell flip over and bang the forearm.'],
  }),
  x('db-hip-thrust', 'Dumbbell hip thrust (shoulders on a bench)', 'hinge', ['dumbbell', 'bench'], ['glutes'], [], 'moderate', 'beginner', {
    easier: ['glute-bridge'], harder: ['hip-thrust'],
    aliases: ['dumbbell glute thrust'], alsoWith: ['kettlebell'], risk: ['demand:supine'],
    guide: ['Shoulders on a bench, a dumbbell across the hip crease held in both hands.', 'Lift until the hips are level, chin tucked and ribs down, then pause.', 'Arching the lower back at the top.'],
  }),
  x('prone-back-extension', 'Prone back extension (face down on the floor)', 'hinge', ['bodyweight'], ['lower-back', 'glutes'], ['upper-back'], 'low', 'beginner', {
    load: BW, easier: ['bird-dog'], harder: ['back-extension'],
    aliases: ['superman', 'floor back extension'], risk: ['joint:spine-extension', 'demand:floor', 'demand:prone'], hotel: true,
    guide: ['Lie face down, arms by the sides or under the forehead.', 'Lift the chest and legs a few centimetres, neck long and eyes on the floor; lower slowly and rest between reps.', 'Craning the neck up, or lifting as high as you can.'],
  }),
  x('cable-pull-through', 'Cable pull-through', 'hinge', ['cable'], ['glutes', 'hamstrings'], ['lower-back'], 'low', 'beginner', {
    easier: ['hip-hinge-drill'], harder: ['db-rdl'], regions: ['hamstrings-hip'],
    aliases: ['pull through', 'band pull through'], alsoWith: ['band'], hotel: true,
    guide: ['Face away from a low cable, rope between the legs.', 'Let the hips go back until the arms are pulled through, then stand tall by driving the hips forward.', 'Squatting down, or pulling with the arms.'],
  }),
  x('kickstand-rdl', 'Kickstand Romanian deadlift (staggered stance)', 'hinge', ['dumbbell'], ['hamstrings', 'glutes'], ['lower-back', 'forearms'], 'moderate', 'beginner', {
    uni: true, easier: ['db-rdl'], harder: ['single-leg-rdl'], regions: ['hamstrings-hip'],
    aliases: ['b stance rdl', 'staggered rdl'], alsoWith: ['kettlebell'], risk: ['joint:back-bent-over'], hotel: true,
    guide: ['Back foot on its toes beside the front heel, used only for balance.', 'Most of the weight through the front heel, hinge until the front hamstring stretches, then stand.', 'Pushing off the back foot.'],
  }),
  x('stability-ball-leg-curl', 'Stability ball leg curl', 'hinge', ['stability-ball'], ['hamstrings'], ['glutes'], 'low', 'beginner', {
    easier: ['glute-bridge'], harder: ['slider-leg-curl'], regions: ['hamstrings-knee'],
    aliases: ['swiss ball hamstring curl', 'ball leg curl'], risk: ['demand:floor', 'demand:supine'],
    guide: ['Lie on your back, heels on the ball, and lift the hips into a bridge.', 'Roll the ball in without dropping the hips, then roll it out slowly.', 'The hips sagging as the ball rolls.'],
  }),
  x('nordic-negative', 'Nordic curl lowering (catch with the hands)', 'hinge', ['bodyweight'], ['hamstrings'], ['glutes'], 'low', 'intermediate', {
    load: BW, easier: ['slider-leg-curl'], harder: ['nordic-curl'], regions: ['hamstrings-knee'],
    aliases: ['nordic hamstring negative', 'eccentric nordic'], risk: ['joint:kneeling'],
    guide: ['Kneel on a pad with the ankles held down firmly.', 'Lean forward slowly with the hips straight, catch yourself with the hands, and push back up.', 'Bending at the hips to make it easier.'],
  }),
  x('nordic-curl', 'Nordic hamstring curl', 'hinge', ['bodyweight'], ['hamstrings'], ['glutes'], 'low', 'advanced', {
    load: BW, easier: ['nordic-negative'], regions: ['hamstrings-knee'],
    aliases: ['nordics'], risk: ['joint:kneeling'],
    guide: ['Kneel on a pad with the ankles held down firmly.', 'Lower as slowly as you can, hips straight, then pull back up with the hamstrings, a little push if needed.', 'Breaking at the hips on the way down.'],
  }),

  // lunge and single-leg
  // The lunges help the hamstrings (no training data either way); the lateral
  // lunge and the cossack squat, sitting to the side as in a squat, do not,
  // and the adductors are a main muscle. The balance holds and the heel-to-toe
  // walk train the abductors, as the single-leg balance hold does.
  x('split-squat', 'Split squat (bodyweight)', 'lunge', ['bodyweight'], ['quads', 'glutes'], ['hamstrings'], 'moderate', 'beginner', {
    uni: true, load: BW, easier: ['single-leg-stance'], harder: ['db-split-squat', 'reverse-lunge', 'step-up', 'forward-lunge'], regions: ['quads-vasti'],
    aliases: ['static lunge', 'bodyweight split squat'], hotel: true,
    guide: ['Long stance, back heel up, front foot flat.', 'Lower the back knee toward the floor, then stand.', 'The front heel lifting, or the front knee caving in.'],
  }),
  x('db-split-squat', 'Dumbbell split squat', 'lunge', ['dumbbell'], ['quads', 'glutes'], ['hamstrings'], 'moderate', 'beginner', {
    uni: true, easier: ['split-squat'], harder: ['bulgarian-split-squat'], regions: ['quads-vasti'],
    aliases: ['dumbbell static lunge'], alsoWith: ['kettlebell'], hotel: true,
    guide: ['Long stance, weights at the sides, shoulders down.', 'Go straight down and up like an elevator, most of the weight on the front leg.', 'Pushing off the back foot.'],
  }),
  x('bulgarian-split-squat', 'Rear-foot-elevated split squat', 'lunge', ['dumbbell', 'bench'], ['quads', 'glutes'], ['hamstrings', 'adductors'], 'moderate', 'intermediate', {
    uni: true, easier: ['db-split-squat', 'reverse-lunge', 'step-up', 'walking-lunge'], regions: ['quads-vasti'],
    aliases: ['rfess'], alsoWith: ['kettlebell'], risk: ['demand:balance'],
    guide: ['Back foot laces down on the bench, front foot far enough forward to sit straight down.', 'Lower until the back knee nears the floor, a slight forward lean is fine, then stand.', 'A front foot so close to the bench that the heel lifts.'],
  }),
  x('reverse-lunge', 'Dumbbell reverse lunge', 'lunge', ['dumbbell'], ['quads', 'glutes'], ['hamstrings', 'adductors'], 'moderate', 'beginner', {
    uni: true, easier: ['split-squat'], harder: ['bulgarian-split-squat', 'walking-lunge'], regions: ['quads-vasti'],
    aliases: ['backward lunge'], alsoWith: ['kettlebell'], hotel: true,
    guide: ['Stand tall, weights at the sides.', 'Step back long and soft so the back knee drops under the hip, then push through the front heel to return.', 'Stepping back so short that the front knee shoots forward.'],
  }),
  x('step-up', 'Dumbbell step-up', 'lunge', ['dumbbell', 'bench'], ['quads', 'glutes'], ['hamstrings'], 'low', 'beginner', {
    uni: true, easier: ['split-squat', 'stair-step-up'], harder: ['bulgarian-split-squat'], regions: ['quads-vasti'],
    aliases: ['box step up'], alsoWith: ['kettlebell'], risk: ['demand:balance'], uses: ['balance'],
    guide: ['A box about knee height or lower.', 'Push through the top foot only to stand up, then lower yourself slowly.', 'Pushing off the bottom foot.'],
  }),
  x('banded-side-walk', 'Banded side walk', 'lunge', ['band'], ['abductors'], ['glutes'], 'low', 'beginner', {
    easier: ['side-lying-hip-abduction'], harder: ['hip-abduction-machine'],
    aliases: ['monster walk', 'lateral band walk'], uses: ['warm-up'], hotel: true,
    guide: ['Band above the knees or at the ankles, half squat, toes forward.', 'Step wide and keep tension in the band.', 'Letting the feet snap together between steps.'],
  }),
  x('single-leg-stance', 'Single-leg balance hold', 'lunge', ['bodyweight'], ['abductors'], ['calves', 'glutes'], 'low', 'beginner', {
    uni: true, load: 'timed', easier: ['heel-to-toe-walk', 'tandem-stance'], harder: ['split-squat'],
    aliases: ['one leg stand', 'single leg balance'], risk: ['demand:balance'], uses: ['balance'], hotel: true,
    guide: ['Stand by a counter you can touch.', 'Lift one foot and hold, a soft knee on the standing leg; turn the head or close the eyes to make it harder.', 'Locking the standing knee.'],
  }),
  x('forward-lunge', 'Forward lunge (bodyweight)', 'lunge', ['bodyweight'], ['quads', 'glutes'], ['hamstrings', 'adductors'], 'low', 'beginner', {
    uni: true, load: BW, easier: ['split-squat'], harder: ['walking-lunge'], regions: ['quads-vasti'],
    aliases: ['front lunge', 'bodyweight lunge'], hotel: true,
    guide: ['Stand tall, feet hip width.', 'Step out long enough that the front shin stays fairly upright, drop the back knee straight down, then push off the front foot to come back.', 'A short step that drives the front knee far past the toes.'],
  }),
  x('walking-lunge', 'Dumbbell walking lunge', 'lunge', ['dumbbell'], ['quads', 'glutes'], ['hamstrings', 'adductors'], 'moderate', 'intermediate', {
    uni: true, easier: ['reverse-lunge', 'forward-lunge'], harder: ['bulgarian-split-squat'], regions: ['quads-vasti'],
    alsoWith: ['kettlebell'], risk: ['demand:balance'], hotel: true,
    guide: ['Tall torso, weights hanging still at the sides.', 'Step through and land heel first, lower the back knee, then bring the back foot through.', 'Rushing the steps; pause if you wobble, since balance beats speed.'],
  }),
  x('lateral-lunge', 'Lateral lunge (bodyweight)', 'lunge', ['bodyweight'], ['quads', 'glutes', 'adductors'], [], 'low', 'beginner', {
    uni: true, load: BW, harder: ['cossack-squat', 'skater-bound'], regions: ['quads-vasti'],
    aliases: ['side lunge'], uses: ['warm-up'], hotel: true,
    guide: ['Stand with the feet together.', 'Step wide and sit back into one hip, the other leg straight with the foot flat, then push back to the middle.', 'The bent knee caving in, or the straight leg\'s foot rolling up.'],
  }),
  x('cossack-squat', 'Cossack squat', 'lunge', ['bodyweight'], ['quads', 'glutes', 'adductors'], [], 'low', 'intermediate', {
    uni: true, load: BW, easier: ['lateral-lunge'], regions: ['quads-vasti'],
    aliases: ['cossack lunge'], risk: ['joint:hip-deep-flexion', 'joint:knee-deep-flexion'], hotel: true,
    guide: ['Wide stance; hold something in front for balance at first.', 'Sit deep to one side, the straight leg\'s toes turning up, then shift to the other side.', 'Rounding the back to get lower.'],
  }),
  x('stair-step-up', 'Step-up on a stair (bodyweight)', 'lunge', ['bodyweight'], ['quads', 'glutes'], ['calves'], 'low', 'beginner', {
    uni: true, load: BW, easier: ['supported-squat'], harder: ['step-up'], regions: ['quads-vasti'],
    aliases: ['bodyweight step up'], uses: ['balance'], hotel: true,
    guide: ['Stand at the bottom of a stair, holding the rail if you need it.', 'Whole foot on the step, push through the heel to stand up, then step down slowly with the other foot.', 'Pushing off the bottom foot.'],
  }),
  x('tandem-stance', 'Tandem stance (heel to toe, holding still)', 'lunge', ['bodyweight'], ['abductors'], ['calves'], 'low', 'beginner', {
    load: 'timed', harder: ['heel-to-toe-walk', 'single-leg-stance'],
    aliases: ['heel to toe stand', 'tandem stand'], risk: ['demand:balance'], uses: ['balance'], hotel: true,
    guide: ['Stand next to a counter you can touch.', 'Place one foot directly in front of the other and hold, eyes on a fixed point ahead.', 'Grabbing the counter before you need it.'],
  }),
  x('heel-to-toe-walk', 'Heel-to-toe walk', 'lunge', ['bodyweight'], ['abductors'], ['calves'], 'low', 'beginner', {
    load: 'timed', easier: ['tandem-stance'], harder: ['single-leg-stance'],
    aliases: ['tandem walk'], risk: ['demand:balance'], uses: ['balance', 'warm-up'], hotel: true,
    guide: ['Walk along a counter or wall.', 'Place the heel right in front of the other toes with each slow step, eyes ahead.', 'Looking down at the feet.'],
  }),

  // hip abduction
  // A pattern of its own: an abduction machine trains the abductors alone,
  // not the quads and glutes a lunge slot is for, so the plan builder's lunge
  // slots never take it. The glutes help, as in the banded side walk. The
  // side-lying leg raise trains them alone too.
  x('hip-abduction-machine', 'Hip abduction machine', 'hip-abduction', ['machine'], ['abductors'], ['glutes'], 'low', 'beginner', {
    easier: ['banded-side-walk'],
    aliases: ['seated hip abduction', 'abductor machine'],
    guide: ['Sit tall, hips against the back pad, pads outside the knees.', 'Press the knees out and pause, then return slowly.', 'Letting the stack slam between reps.'],
  }),
  x('side-lying-hip-abduction', 'Side-lying leg raise', 'hip-abduction', ['bodyweight'], ['abductors'], ['glutes'], 'low', 'beginner', {
    uni: true, load: BW, harder: ['banded-side-walk'],
    aliases: ['side leg raise'], risk: ['demand:floor'], hotel: true,
    guide: ['Lie on your side, bottom knee bent for support.', 'Lift the top leg slightly behind the body, toes pointing forward, then lower slowly.', 'Rolling back and turning the toes up toward the ceiling.'],
  }),

  // horizontal push
  // Regions: pressing grows the front delts (Weak: Lanza 2024, Larsen 2025a);
  // the incline press also leans on the upper chest (Weak: Chaves 2020).
  x('incline-push-up', 'Incline push-up (hands on a counter or bench)', 'horizontal-push', ['bodyweight'], ['chest'], ['triceps', 'shoulders'], 'low', 'beginner', {
    load: BW, easier: ['wall-push-up'], harder: ['push-up', 'knee-push-up', 'incline-db-press', 'pike-push-up'], regions: ['shoulders-front'],
    aliases: ['hands elevated push up', 'counter push up'], risk: ['joint:wrist-extension'], hotel: true,
    guide: ['Hands on a counter or bench, a little wider than the shoulders; the higher the hands, the easier it is.', 'Keep the body in one straight line, lower the chest to the edge, then push away.', 'The hips sagging or piking up.'],
  }),
  x('push-up', 'Push-up', 'horizontal-push', ['bodyweight'], ['chest'], ['triceps', 'shoulders', 'abs'], 'low', 'beginner', {
    load: BW, easier: ['incline-push-up', 'knee-push-up', 'band-chest-press', 'scapular-push-up'], harder: ['ring-push-up', 'decline-push-up', 'diamond-push-up', 'archer-push-up', 'planche-lean', 'db-bench', 'db-floor-press'], regions: ['shoulders-front'],
    aliases: ['floor push up', 'press up'], risk: ['joint:wrist-extension', 'demand:floor'], hotel: true,
    guide: ['Hands just outside the shoulders, body in a straight line.', 'Lower with the elbows angled back, chest and hips moving together, then push up.', 'The elbows flaring straight out, or the hips sagging.'],
  }),
  x('ring-push-up', 'Ring push-up', 'horizontal-push', ['rings'], ['chest'], ['triceps', 'shoulders', 'abs'], 'low', 'intermediate', {
    load: BW, easier: ['push-up'], harder: ['ring-dip'], regions: ['shoulders-front'],
    aliases: ['trx push up', 'suspension push up'],
    guide: ['Rings at ankle to knee height.', 'Lower with the rings held still and close to the body, then push up, turning the hands out a little at the top.', 'Letting the rings drift wide.'],
  }),
  x('ring-dip', 'Ring dip', 'horizontal-push', ['rings'], ['chest', 'triceps'], ['shoulders'], 'low', 'advanced', {
    load: BW, easier: ['ring-support-hold', 'ring-push-up', 'bench-dip', 'parallel-bar-dip'], harder: ['ring-muscle-up'], regions: ['shoulders-front'],
    aliases: ['ring dips'], risk: ['joint:shoulder-extension'],
    guide: ['Start from a steady support hold, arms locked.', 'Lower only as deep as you control, rings close to the body, then press back to straight arms.', 'Letting the rings drift wide, or dropping into the bottom.'],
  }),
  x('db-bench', 'Flat dumbbell bench press', 'horizontal-push', ['dumbbell', 'bench'], ['chest'], ['triceps', 'shoulders'], 'low', 'beginner', {
    easier: ['push-up', 'db-floor-press', 'incline-db-press', 'machine-chest-press'], harder: ['bench-press'], regions: ['shoulders-front'],
    aliases: ['dumbbell bench press', 'dumbbell chest press'], alsoWith: ['kettlebell'], risk: ['demand:supine'],
    guide: ['Lie on the bench, feet planted, shoulder blades pulled together.', 'Lower to the sides of the chest, then press up and slightly in.', 'Bouncing the weights off the chest, or the shoulders rolling forward.'],
  }),
  x('incline-db-press', 'Incline dumbbell press', 'horizontal-push', ['dumbbell', 'bench'], ['chest', 'shoulders'], ['triceps'], 'low', 'beginner', {
    easier: ['incline-push-up'], harder: ['db-bench', 'incline-bench-press'], regions: ['chest-upper', 'shoulders-front'],
    aliases: ['incline dumbbell bench press'],
    guide: ['Bench at a low incline, wrists stacked over the elbows.', 'Lower toward the upper chest, then press up.', 'Setting the bench so steep it becomes a shoulder press.'],
  }),
  x('bench-press', 'Barbell bench press', 'horizontal-push', ['barbell', 'bench'], ['chest'], ['triceps', 'shoulders'], 'moderate', 'beginner', {
    easier: ['db-bench', 'machine-chest-press'], regions: ['shoulders-front'],
    aliases: ['flat bench press', 'barbell bench'], risk: ['demand:supine'],
    guide: ['Eyes under the bar, feet planted; use a spotter or safety arms.', 'Lower to the lower chest with control, then press up.', 'Bouncing the bar off the chest, or the hips lifting.'],
  }),
  x('machine-chest-press', 'Machine chest press', 'horizontal-push', ['machine'], ['chest'], ['triceps', 'shoulders'], 'low', 'beginner', {
    easier: ['pec-deck'], harder: ['db-bench', 'bench-press'], regions: ['shoulders-front'],
    aliases: ['chest press', 'seated chest press'],
    guide: ['Seat set so the handles start at mid-chest height.', 'Press without the shoulders rolling forward, then return slowly.', 'Letting the stack crash between reps.'],
  }),
  x('wall-push-up', 'Wall push-up', 'horizontal-push', ['bodyweight'], ['chest'], ['triceps', 'shoulders'], 'low', 'beginner', {
    load: BW, harder: ['incline-push-up'], regions: ['shoulders-front'],
    aliases: ['wall press up'], risk: ['joint:wrist-extension'], uses: ['warm-up'], hotel: true,
    guide: ['Hands on the wall at chest height, feet a step back.', 'Keep the body in one straight line from head to heels, bring the chest to the wall, then push away.', 'The hips sagging or sticking out.'],
  }),
  x('knee-push-up', 'Knee push-up', 'horizontal-push', ['bodyweight'], ['chest'], ['triceps', 'shoulders', 'abs'], 'low', 'beginner', {
    load: BW, easier: ['incline-push-up'], harder: ['push-up'], regions: ['shoulders-front'],
    aliases: ['kneeling push up', 'box push up'], risk: ['joint:wrist-extension', 'joint:kneeling', 'demand:floor'], hotel: true,
    guide: ['Knees down, hands a little wider than the shoulders.', 'Keep a straight line from knees to head, lower the chest, then push up.', 'Dropping the head toward the floor instead of the chest.'],
  }),
  x('decline-push-up', 'Decline push-up (feet on a chair or step)', 'horizontal-push', ['bodyweight'], ['chest', 'shoulders'], ['triceps', 'abs'], 'low', 'intermediate', {
    load: BW, easier: ['push-up'], harder: ['archer-push-up'], regions: ['shoulders-front'],
    aliases: ['feet elevated push up'], risk: ['joint:wrist-extension', 'demand:floor'], hotel: true,
    guide: ['Feet up on a chair or step, hands under the shoulders or a bit wider.', 'Keep a straight line and lower until the chest nearly touches, then push up.', 'The hips sagging.'],
  }),
  x('archer-push-up', 'Archer push-up', 'horizontal-push', ['bodyweight'], ['chest'], ['triceps', 'shoulders', 'abs'], 'low', 'advanced', {
    uni: true, load: BW, easier: ['decline-push-up', 'push-up'], harder: ['one-arm-push-up'], regions: ['shoulders-front'],
    aliases: ['archer press up'], risk: ['joint:wrist-extension', 'demand:floor'],
    guide: ['Very wide hands, body in a straight line.', 'Shift over one arm as you lower while the other arm stays almost straight; alternate sides or finish one side first.', 'The hips twisting toward the working arm.'],
  }),
  x('one-arm-push-up', 'One-arm push-up', 'horizontal-push', ['bodyweight'], ['chest'], ['triceps', 'shoulders', 'obliques'], 'low', 'advanced', {
    uni: true, load: BW, easier: ['archer-push-up'], regions: ['shoulders-front'],
    aliases: ['single arm push up'], risk: ['joint:wrist-extension', 'demand:floor'],
    guide: ['Feet wide for a stable base, hand under the chest.', 'Lower with the elbow close to the side and press up, hips level.', 'Twisting the body up to finish the rep.'],
  }),
  x('db-floor-press', 'Dumbbell floor press', 'horizontal-push', ['dumbbell'], ['chest'], ['triceps', 'shoulders'], 'low', 'beginner', {
    easier: ['push-up', 'band-chest-press'], harder: ['db-bench'], regions: ['shoulders-front'],
    aliases: ['floor press'], alsoWith: ['kettlebell'], risk: ['demand:floor', 'demand:supine'], hotel: true,
    guide: ['Lie on the floor, knees bent, weights over the chest.', 'Lower until the upper arms touch the floor lightly, then press up and slightly in.', 'Bouncing the elbows off the floor.'],
  }),
  x('band-chest-press', 'Standing band chest press', 'horizontal-push', ['band'], ['chest'], ['triceps', 'shoulders'], 'low', 'beginner', {
    harder: ['db-floor-press', 'push-up'], regions: ['shoulders-front'],
    aliases: ['banded chest press', 'resistance band chest press'], hotel: true,
    guide: ['Band anchored behind you at chest height, staggered stance, trunk braced.', 'Press forward and slightly together, then return slowly.', 'Arching the back as the band pulls.'],
  }),
  x('incline-bench-press', 'Incline barbell bench press', 'horizontal-push', ['barbell', 'bench'], ['chest', 'shoulders'], ['triceps'], 'moderate', 'intermediate', {
    easier: ['incline-db-press'], regions: ['chest-upper', 'shoulders-front'],
    aliases: ['incline bench', 'incline barbell press'],
    guide: ['Bench at a low incline, shoulder blades pinned back and down.', 'Lower the bar to the upper chest, then press up.', 'Flaring the elbows straight out to the sides.'],
  }),
  x('negative-dip', 'Negative dip (slow lowering on bars)', 'horizontal-push', ['parallel-bars'], ['chest', 'triceps'], ['shoulders'], 'low', 'beginner', {
    load: BW, easier: ['parallel-bar-support-hold'], harder: ['parallel-bar-dip'], regions: ['shoulders-front'],
    aliases: ['eccentric dip', 'dip negative'], risk: ['joint:shoulder-extension'],
    guide: ['Jump or step to the top position on the bars.', 'Lower over three to five seconds, then step back up to the top.', 'Going deeper than the shoulders like.'],
  }),
  x('assisted-dip-machine', 'Machine-assisted dip', 'horizontal-push', ['machine'], ['chest', 'triceps'], ['shoulders'], 'low', 'beginner', {
    load: BW, harder: ['parallel-bar-dip'], regions: ['shoulders-front'],
    aliases: ['gravitron dip'], risk: ['joint:shoulder-extension'],
    guide: ['Set the counterweight; more makes it easier.', 'Lean slightly forward with the elbows back, lower to about upper arms level, then press.', 'Shrugging the shoulders up toward the ears.'],
  }),
  x('parallel-bar-dip', 'Parallel bar dip', 'horizontal-push', ['parallel-bars'], ['chest', 'triceps'], ['shoulders'], 'low', 'intermediate', {
    load: BW, easier: ['negative-dip', 'assisted-dip-machine', 'bench-dip', 'diamond-push-up'], harder: ['ring-dip', 'bar-muscle-up'], regions: ['shoulders-front'],
    aliases: ['dip', 'bar dip', 'chest dip'], risk: ['joint:shoulder-extension'],
    guide: ['Arms locked on the bars, shoulders down away from the ears.', 'Lower until the upper arms are about level, then press up to straight arms.', 'Dropping fast into the bottom of the dip.'],
  }),

  // chest fly
  // A pattern of its own, as hip abduction is: a fly isolates the chest (the
  // elbows stay fixed, so no triceps), so it never takes a pressing slot, a
  // main lift's above all. The front delts help (a heuristic, no growth
  // study). The pec deck biases no region: it grew both heads of the chest
  // evenly (Pinto 2025), and nor do the cable and dumbbell flies.
  x('pec-deck', 'Pec deck (machine fly)', 'chest-fly', ['machine'], ['chest'], ['shoulders'], 'low', 'beginner', {
    harder: ['machine-chest-press'],
    aliases: ['butterfly machine'],
    guide: ['Seat set so the handles are at chest height, back against the pad.', 'Bring the handles together in front with soft elbows, pause, then open slowly.', 'Letting the weight pull the arms back past a comfortable stretch.'],
  }),
  x('cable-fly', 'Cable chest fly', 'chest-fly', ['cable'], ['chest'], ['shoulders'], 'low', 'beginner', {
    harder: ['db-fly'],
    aliases: ['cable crossover', 'standing cable fly'],
    guide: ['Handles at shoulder height, a soft bend in the elbows kept fixed.', 'Bring the hands together in front as if hugging a wide tree, then open slowly.', 'Opening past a comfortable stretch, or bending the elbows to press.'],
  }),
  x('db-fly', 'Dumbbell chest fly', 'chest-fly', ['dumbbell', 'bench'], ['chest'], ['shoulders'], 'low', 'beginner', {
    easier: ['cable-fly'],
    aliases: ['flat fly'], risk: ['demand:supine'],
    guide: ['Lie on the bench with light weights over the chest, elbows softly bent; this is a stretch exercise.', 'Open the arms in a wide arc, then bring them back over the chest without clanking.', 'Going heavy or deep enough to strain the shoulders.'],
  }),

  // horizontal pull
  // Every row helps the forearms: the grip holds the load every rep (a
  // heuristic, no growth study), so a plan of rows and hinges does not show
  // its forearms as untrained.
  // Regions: rows load the mid-back (heuristic, a rough guide).
  x('inverted-row', 'Inverted row (under a sturdy table or low bar)', 'horizontal-pull', ['bodyweight'], ['lats', 'upper-back'], ['biceps', 'forearms'], 'low', 'beginner', {
    load: BW, easier: ['doorframe-row'], harder: ['ring-row'], regions: ['upper-back-mid'],
    aliases: ['bodyweight row', 'australian pull up', 'table row'], risk: ['demand:supine'],
    guide: ['A sturdy bar or table that will not tip, body straight, heels down.', 'Pull the chest up to the bar, then lower with control.', 'The hips sagging as you pull.'],
  }),
  x('ring-row', 'Ring row', 'horizontal-pull', ['rings'], ['lats', 'upper-back'], ['biceps', 'forearms'], 'low', 'beginner', {
    load: BW, easier: ['inverted-row'], harder: ['pull-up', 'feet-elevated-ring-row'], regions: ['upper-back-mid'],
    aliases: ['trx row', 'suspension row'],
    guide: ['Rings at waist height; walk the feet forward to make it harder.', 'Keep the body straight and drive the elbows back past the ribs.', 'Letting the hips sag.'],
  }),
  x('band-row', 'Band row', 'horizontal-pull', ['band'], ['lats', 'upper-back'], ['biceps', 'forearms'], 'low', 'beginner', {
    easier: ['doorframe-row'], harder: ['db-row'], regions: ['upper-back-mid'],
    aliases: ['banded row', 'resistance band row'], hotel: true,
    guide: ['Band anchored at chest height, sitting or standing tall.', 'Pull the hands to the ribs and squeeze the shoulder blades back.', 'Leaning back to move the band.'],
  }),
  x('db-row', 'One-arm dumbbell row', 'horizontal-pull', ['dumbbell', 'bench'], ['lats', 'upper-back'], ['biceps', 'forearms'], 'low', 'beginner', {
    uni: true, easier: ['chest-supported-db-row', 'band-row'], harder: ['barbell-row', 'renegade-row'], regions: ['upper-back-mid'],
    aliases: ['single arm dumbbell row'], alsoWith: ['kettlebell'],
    guide: ['Hand and knee on the bench, back flat.', 'Pull the elbow toward the hip, then lower to a full stretch.', 'Twisting the torso to lift the weight.'],
  }),
  x('chest-supported-db-row', 'Chest-supported dumbbell row', 'horizontal-pull', ['dumbbell', 'bench'], ['upper-back', 'lats'], ['biceps', 'shoulders', 'forearms'], 'low', 'beginner', {
    harder: ['db-row', 'bent-over-db-row'], regions: ['upper-back-mid'],
    aliases: ['incline dumbbell row', 'chest supported row'],
    guide: ['Chest on an incline bench, weights hanging.', 'Row both weights up together and pause with the shoulder blades squeezed.', 'Lifting the chest off the pad to heave the weights.'],
  }),
  x('barbell-row', 'Barbell row', 'horizontal-pull', ['barbell'], ['lats', 'upper-back'], ['biceps', 'lower-back', 'forearms'], 'moderate', 'intermediate', {
    easier: ['db-row', 'seated-cable-row', 'bent-over-db-row'], regions: ['upper-back-mid'],
    aliases: ['bent over row', 'barbell bent over row'], risk: ['joint:grip-heavy', 'joint:back-bent-over'],
    guide: ['Hinge to about 45 degrees and hold it, bar hanging at arm\'s length.', 'Pull the bar to the lower ribs, then lower with control.', 'Heaving with the hips, or standing up as you pull.'],
  }),
  x('seated-cable-row', 'Seated cable row', 'horizontal-pull', ['cable'], ['lats', 'upper-back'], ['biceps', 'forearms'], 'low', 'beginner', {
    easier: ['machine-row'], harder: ['barbell-row'], regions: ['upper-back-mid'],
    aliases: ['cable row', 'low row'],
    guide: ['Sit tall, slight knee bend.', 'Pull the handle to the belly, then let the shoulders reach forward on the return.', 'Rocking the torso back and forth.'],
  }),
  x('machine-row', 'Machine row', 'horizontal-pull', ['machine'], ['upper-back', 'lats'], ['biceps', 'forearms'], 'low', 'beginner', {
    harder: ['seated-cable-row'], regions: ['upper-back-mid'],
    aliases: ['seated machine row'],
    guide: ['Chest on the pad, seat set so the handles are at chest height.', 'Pull the elbows back, then return slowly.', 'Letting the weight yank the arms forward.'],
  }),
  x('doorframe-row', 'Door frame row (holding a solid frame)', 'horizontal-pull', ['bodyweight'], ['upper-back', 'lats'], ['biceps', 'forearms'], 'low', 'beginner', {
    uni: true, load: BW, harder: ['inverted-row', 'band-row'], regions: ['upper-back-mid'],
    aliases: ['doorway row'], hotel: true,
    guide: ['Grip a solid frame, never the door itself, feet close to the frame.', 'Lean back with straight arms, then pull the chest to the hand.', 'Using a door or anything that can swing or give.'],
  }),
  x('bent-over-db-row', 'Bent-over dumbbell row (two arms)', 'horizontal-pull', ['dumbbell'], ['lats', 'upper-back'], ['biceps', 'lower-back', 'forearms'], 'moderate', 'beginner', {
    easier: ['chest-supported-db-row'], harder: ['barbell-row'], regions: ['upper-back-mid'],
    aliases: ['dumbbell bent over row', 'two arm dumbbell row'], alsoWith: ['kettlebell'], risk: ['joint:back-bent-over'], hotel: true,
    guide: ['Hinge until the torso is about 45 degrees, weights hanging.', 'Pull the weights toward the hips, then lower with control.', 'Rocking the back to swing the weights up.'],
  }),
  x('renegade-row', 'Renegade row (plank row)', 'horizontal-pull', ['dumbbell'], ['lats', 'upper-back'], ['abs', 'obliques', 'biceps', 'forearms'], 'moderate', 'intermediate', {
    uni: true, easier: ['db-row', 'plank-shoulder-tap'], regions: ['upper-back-mid'],
    aliases: ['plank row'], risk: ['joint:wrist-extension', 'demand:floor'], hotel: true,
    guide: ['High plank on the dumbbells, feet wide, hips square to the floor.', 'Row one weight without twisting, and set it down quietly before the other side.', 'The hips rotating toward the ceiling as you row.'],
  }),
  x('feet-elevated-ring-row', 'Feet-elevated ring row', 'horizontal-pull', ['rings'], ['lats', 'upper-back'], ['biceps', 'forearms'], 'low', 'intermediate', {
    load: BW, easier: ['ring-row'], harder: ['tuck-front-lever'], regions: ['upper-back-mid'],
    aliases: ['feet elevated trx row', 'elevated inverted row'],
    guide: ['Feet on a box, body straight and level under the rings.', 'Pull the rings to the lower ribs, pause at the top, and lower slowly.', 'The hips sagging below the line.'],
  }),

  // vertical push
  // Regions: overhead presses grow the front delts and work the side delts,
  // the side by muscle activity (EMG) only, which caps it at Weak (Vigotsky
  // 2022); the landmine press, at an angle, is counted for the front only.
  x('pike-push-up', 'Pike push-up', 'vertical-push', ['bodyweight'], ['shoulders'], ['triceps', 'chest'], 'low', 'intermediate', {
    load: BW, easier: ['incline-push-up'], harder: ['wall-handstand', 'elevated-pike-push-up', 'box-pike-hold'], regions: ['shoulders-front', 'shoulders-side'],
    aliases: ['pike press'], risk: ['joint:shoulder-overhead', 'joint:wrist-extension', 'demand:inversion'], hotel: true,
    guide: ['Hips high, the body an upside-down V.', 'Lower the head toward the floor in front of the hands, then press back up through the shoulders.', 'Letting the hips drop so it becomes a push-up.'],
  }),
  x('db-shoulder-press', 'Seated dumbbell shoulder press', 'vertical-push', ['dumbbell', 'bench'], ['shoulders'], ['triceps'], 'low', 'beginner', {
    easier: ['landmine-press', 'machine-shoulder-press'], harder: ['overhead-press'], regions: ['shoulders-front', 'shoulders-side'],
    aliases: ['seated dumbbell press'], alsoWith: ['kettlebell'], risk: ['joint:shoulder-overhead'],
    guide: ['Back supported on an upright bench, weights at the shoulders.', 'Press up without the ribs flaring, then lower to about ear height.', 'Arching the back to finish the press.'],
  }),
  x('overhead-press', 'Standing barbell press', 'vertical-push', ['barbell'], ['shoulders'], ['triceps', 'upper-back', 'abs'], 'high', 'beginner', {
    easier: ['db-shoulder-press', 'landmine-press', 'standing-db-press'], regions: ['shoulders-front', 'shoulders-side'],
    aliases: ['military press', 'barbell overhead press', 'ohp', 'standing press'], risk: ['joint:shoulder-overhead', 'joint:spine-axial'],
    guide: ['Grip just outside the shoulders, bar at the collarbones.', 'Squeeze the glutes and press the bar up past the face, head through at the top.', 'Leaning back to push the bar up.'],
  }),
  x('landmine-press', 'Half-kneeling landmine press', 'vertical-push', ['barbell'], ['shoulders', 'chest'], ['triceps'], 'low', 'beginner', {
    uni: true, harder: ['db-shoulder-press', 'overhead-press', 'standing-db-press', 'kb-press'], regions: ['shoulders-front'],
    aliases: ['landmine shoulder press'], risk: ['joint:kneeling'],
    guide: ['Bar end in a corner or landmine holder, half kneeling.', 'Press up and forward along the arc, braced so the body does not twist.', 'Twisting the trunk to finish the press.'],
  }),
  x('machine-shoulder-press', 'Machine shoulder press', 'vertical-push', ['machine'], ['shoulders'], ['triceps'], 'low', 'beginner', {
    harder: ['db-shoulder-press'], regions: ['shoulders-front', 'shoulders-side'],
    aliases: ['seated machine press', 'shoulder press machine'], risk: ['joint:shoulder-overhead'],
    guide: ['Seat set so the handles start at the shoulders.', 'Press up without arching, then lower under control.', 'Arching the back off the pad.'],
  }),
  x('standing-db-press', 'Standing dumbbell overhead press', 'vertical-push', ['dumbbell'], ['shoulders'], ['triceps', 'upper-back', 'abs'], 'moderate', 'beginner', {
    easier: ['landmine-press', 'band-overhead-press'], harder: ['overhead-press'], regions: ['shoulders-front', 'shoulders-side'],
    aliases: ['dumbbell overhead press'], risk: ['joint:shoulder-overhead'], hotel: true,
    guide: ['Stand tall, weights at the shoulders, glutes squeezed and ribs down.', 'Press up and slightly back over the head, then lower to the shoulders under control.', 'Leaning back to push the weights up.'],
  }),
  x('kb-press', 'Single-arm kettlebell press', 'vertical-push', ['kettlebell'], ['shoulders'], ['triceps', 'obliques'], 'moderate', 'intermediate', {
    uni: true, easier: ['landmine-press'], regions: ['shoulders-front', 'shoulders-side'],
    aliases: ['kettlebell press', 'one arm overhead press'], alsoWith: ['dumbbell'], risk: ['joint:shoulder-overhead'], hotel: true,
    guide: ['Start from the rack, wrist straight, body tall.', 'Press up while the body stays square, until the biceps finishes near the ear.', 'Leaning away from the bell to finish.'],
  }),
  x('band-overhead-press', 'Band overhead press', 'vertical-push', ['band'], ['shoulders'], ['triceps'], 'low', 'beginner', {
    harder: ['standing-db-press'], regions: ['shoulders-front', 'shoulders-side'],
    aliases: ['banded shoulder press', 'resistance band shoulder press'], risk: ['joint:shoulder-overhead'], hotel: true,
    guide: ['Stand on the band, handles at the shoulders.', 'Press straight up, then come down slowly.', 'Leaning back as the band gets harder.'],
  }),
  x('elevated-pike-push-up', 'Elevated pike push-up (feet on a chair or box)', 'vertical-push', ['bodyweight'], ['shoulders'], ['triceps', 'chest'], 'low', 'intermediate', {
    load: BW, easier: ['pike-push-up'], harder: ['wall-handstand-push-up'], regions: ['shoulders-front', 'shoulders-side'],
    aliases: ['feet elevated pike push up'], risk: ['joint:shoulder-overhead', 'joint:wrist-extension', 'demand:inversion'], hotel: true,
    guide: ['Feet on a chair or box, hips high over the shoulders.', 'Lower the head in front of the hands, a small triangle, then push the floor away to finish.', 'The hips drifting down toward a push-up.'],
  }),
  x('wall-handstand-push-up', 'Wall handstand push-up', 'vertical-push', ['bodyweight'], ['shoulders'], ['triceps', 'upper-back'], 'low', 'advanced', {
    load: BW, easier: ['elevated-pike-push-up', 'wall-handstand'], regions: ['shoulders-front', 'shoulders-side'],
    aliases: ['handstand push up', 'hspu'], risk: ['joint:neck-loaded', 'joint:shoulder-overhead', 'joint:wrist-extension', 'demand:inversion'],
    guide: ['Kick up to a handstand with the back to the wall, a cushion under the head.', 'Lower slowly, head ahead of the hands, then press back to straight arms.', 'The elbows flaring wide, or dropping onto the head.'],
  }),

  // vertical pull
  // Pull-ups, chin-ups and the holds and steps around them help the forearms:
  // hanging from the bar, the grip holds the body every rep (a heuristic, no
  // growth study). A chin-up is tagged as a pull-up: the biceps work harder
  // by muscle activity, but no growth study separates them.
  x('band-pulldown', 'Band pulldown (anchored high)', 'vertical-pull', ['band'], ['lats'], ['biceps', 'upper-back'], 'low', 'beginner', {
    harder: ['lat-pulldown', 'straight-arm-pulldown'],
    aliases: ['banded lat pulldown'], risk: ['joint:shoulder-overhead'], hotel: true,
    guide: ['Anchor the band high, kneel or sit below it.', 'Pull the elbows down to the ribs, then let the arms rise slowly.', 'Leaning far back to pull.'],
  }),
  x('lat-pulldown', 'Lat pulldown', 'vertical-pull', ['machine'], ['lats'], ['biceps', 'upper-back'], 'low', 'beginner', {
    easier: ['band-pulldown', 'straight-arm-pulldown'], harder: ['assisted-pull-up', 'pull-up', 'assisted-pull-up-machine'],
    aliases: ['lat pull down', 'wide grip pulldown', 'cable pulldown'], risk: ['joint:shoulder-overhead'],
    guide: ['Thighs locked under the pad, grip a little wider than the shoulders.', 'Pull the bar to the upper chest, chest up, then let it rise with control.', 'Leaning far back, or pulling the bar behind the neck.'],
  }),
  x('dead-hang', 'Dead hang', 'vertical-pull', ['pull-up-bar'], ['forearms'], ['lats', 'upper-back'], 'low', 'beginner', {
    load: 'timed', harder: ['scapular-pull-up', 'skin-the-cat'],
    aliases: ['bar hang', 'passive hang'], risk: ['joint:shoulder-hang', 'joint:grip-heavy'],
    guide: ['Full grip on the bar, thumbs around it; the feet can stay on a box at first.', 'Hang and breathe, letting the shoulders open.', 'Dropping off the bar at the end instead of stepping down.'],
  }),
  x('scapular-pull-up', 'Scapular pull-up (hang, pull the shoulders down)', 'vertical-pull', ['pull-up-bar'], ['upper-back', 'lats'], [], 'low', 'beginner', {
    load: BW, easier: ['dead-hang'], harder: ['negative-pull-up', 'flexed-arm-hang', 'assisted-pull-up'],
    aliases: ['scap pull up', 'scapular shrug on bar'], risk: ['joint:shoulder-overhead', 'joint:shoulder-hang', 'joint:grip-heavy'],
    guide: ['Hang with straight arms.', 'Pull the shoulders down away from the ears, then let them rise, arms straight the whole time.', 'Bending the elbows to pull.'],
  }),
  x('negative-pull-up', 'Negative pull-up (slow lowering)', 'vertical-pull', ['pull-up-bar'], ['lats'], ['biceps', 'upper-back', 'forearms'], 'low', 'beginner', {
    load: BW, easier: ['scapular-pull-up', 'flexed-arm-hang'], harder: ['pull-up', 'chin-up'],
    aliases: ['eccentric pull up', 'pull up negative'], risk: ['joint:shoulder-overhead', 'joint:shoulder-hang', 'joint:grip-heavy'],
    guide: ['Step up to the top position, chin over the bar.', 'Lower over three to five seconds, then reset with the feet for each rep.', 'Dropping through the last part of the lowering.'],
  }),
  x('assisted-pull-up', 'Band-assisted pull-up', 'vertical-pull', ['pull-up-bar', 'band'], ['lats'], ['biceps', 'upper-back', 'forearms'], 'low', 'beginner', {
    load: BW, easier: ['scapular-pull-up', 'lat-pulldown'], harder: ['pull-up', 'chin-up'],
    risk: ['joint:shoulder-overhead', 'joint:shoulder-hang', 'joint:grip-heavy'],
    guide: ['Band looped over the bar, under a foot or knee; a thicker band helps more.', 'Pull until the chin clears the bar, then lower to straight arms.', 'Cutting the range short at the bottom.'],
  }),
  x('pull-up', 'Pull-up', 'vertical-pull', ['pull-up-bar'], ['lats'], ['biceps', 'upper-back', 'forearms'], 'low', 'intermediate', {
    load: BW, easier: ['negative-pull-up', 'assisted-pull-up', 'chin-up', 'ring-row', 'lat-pulldown', 'assisted-pull-up-machine'], harder: ['weighted-pull-up', 'chest-to-bar-pull-up', 'tuck-front-lever'],
    aliases: ['overhand pull up'], risk: ['joint:shoulder-overhead', 'joint:shoulder-hang', 'joint:grip-heavy'],
    guide: ['Grip a little wider than the shoulders, hanging from straight arms, shoulders down.', 'Pull until the chin clears the bar, then lower to straight arms.', 'Kicking or swinging to get the chin over.'],
  }),
  x('flexed-arm-hang', 'Flexed-arm hang (chin over the bar)', 'vertical-pull', ['pull-up-bar'], ['lats'], ['biceps', 'upper-back', 'forearms'], 'low', 'beginner', {
    load: 'timed', easier: ['scapular-pull-up'], harder: ['negative-pull-up'],
    aliases: ['top hold', 'chin over bar hold'], risk: ['joint:shoulder-overhead', 'joint:shoulder-hang', 'joint:grip-heavy'],
    guide: ['Step up so the chin starts over the bar.', 'Hold with the shoulders pulled down and the chest to the bar, then lower slowly.', 'Craning the neck to keep the chin up.'],
  }),
  x('chin-up', 'Chin-up (palms toward you)', 'vertical-pull', ['pull-up-bar'], ['lats'], ['biceps', 'upper-back', 'forearms'], 'low', 'intermediate', {
    load: BW, easier: ['negative-pull-up', 'assisted-pull-up'], harder: ['pull-up'],
    aliases: ['chinup', 'supinated pull up', 'underhand pull up'], risk: ['joint:shoulder-overhead', 'joint:shoulder-hang', 'joint:grip-heavy'],
    guide: ['Shoulder-width grip, palms facing you.', 'Start each rep from straight arms and pull the chest toward the bar, not just the chin.', 'Half reps that start from bent arms.'],
  }),
  x('weighted-pull-up', 'Weighted pull-up (belt, vest or backpack)', 'vertical-pull', ['pull-up-bar'], ['lats'], ['biceps', 'upper-back', 'forearms'], 'moderate', 'advanced', {
    easier: ['pull-up'],
    aliases: ['weighted chin up'], risk: ['joint:shoulder-overhead', 'joint:shoulder-hang', 'joint:grip-heavy'],
    guide: ['Add load in small steps on a belt, vest or backpack.', 'Pull through the same full range as the bodyweight pull-up.', 'Kicking; the weight stays still.'],
  }),
  x('chest-to-bar-pull-up', 'Chest-to-bar pull-up', 'vertical-pull', ['pull-up-bar'], ['lats', 'upper-back'], ['biceps', 'forearms'], 'low', 'advanced', {
    load: BW, easier: ['pull-up'], harder: ['bar-muscle-up', 'ring-muscle-up'],
    aliases: ['high pull up', 'chest to bar'], risk: ['joint:shoulder-overhead', 'joint:shoulder-hang', 'joint:grip-heavy'],
    guide: ['Grip a little wider than the shoulders.', 'Lean back slightly and drive the elbows down and back until the upper chest touches the bar.', 'Swinging to reach the bar.'],
  }),
  x('straight-arm-pulldown', 'Straight-arm pulldown', 'vertical-pull', ['cable'], ['lats'], ['upper-back'], 'low', 'beginner', {
    easier: ['band-pulldown'], harder: ['lat-pulldown'],
    aliases: ['straight arm lat pulldown', 'lat prayer'], alsoWith: ['band'], risk: ['joint:shoulder-overhead'], hotel: true,
    guide: ['Face the cable, arms long with a slight bend at the elbow.', 'Sweep the bar down to the thighs, ribs down, then let it rise slowly.', 'Arching the back, or bending the elbows to pull.'],
  }),
  x('assisted-pull-up-machine', 'Machine-assisted pull-up', 'vertical-pull', ['machine'], ['lats'], ['biceps', 'upper-back', 'forearms'], 'low', 'beginner', {
    load: BW, easier: ['lat-pulldown'], harder: ['pull-up'],
    aliases: ['gravitron'], risk: ['joint:shoulder-overhead', 'joint:shoulder-hang'],
    guide: ['Set the counterweight; more makes it easier.', 'Pull the elbows down to the ribs, then lower all the way to straight arms.', 'Cutting the range short at the bottom.'],
  }),

  // carry
  // Regions: the farmer carry's upper traps hold the load up (heuristic, a rough guide).
  x('farmer-carry', 'Farmer carry', 'carry', ['dumbbell'], ['forearms', 'upper-back'], ['abs', 'glutes'], 'high', 'beginner', {
    easier: ['suitcase-carry', 'db-shrug', 'goblet-carry'], regions: ['upper-back-traps'],
    aliases: ['farmers walk', 'farmer walk', 'farmers carry'], alsoWith: ['kettlebell', 'trap-bar'], risk: ['joint:grip-heavy'], hotel: true,
    guide: ['Heavy weights at the sides, standing tall, shoulders down.', 'Walk with short, steady steps.', 'The shoulders rounding forward, or the weights swinging.'],
  }),
  x('suitcase-carry', 'Suitcase carry (one hand)', 'carry', ['dumbbell'], ['obliques', 'forearms'], ['abs'], 'moderate', 'beginner', {
    uni: true, easier: ['pallof-press'], harder: ['farmer-carry', 'waiter-carry'],
    aliases: ['one arm farmer carry', 'single arm carry'], alsoWith: ['kettlebell'], risk: ['joint:grip-heavy'], hotel: true,
    guide: ['Weight in one hand only, standing tall.', 'Walk with steady steps, and switch hands each round.', 'Leaning toward or away from the weight.'],
  }),
  x('goblet-carry', 'Goblet carry (weight held at the chest)', 'carry', ['dumbbell'], ['abs', 'upper-back'], ['forearms', 'biceps'], 'moderate', 'beginner', {
    harder: ['farmer-carry', 'waiter-carry', 'sled-push'],
    aliases: ['front carry', 'goblet walk'], alsoWith: ['kettlebell'], hotel: true,
    guide: ['Hug the weight against the chest.', 'Walk tall with short, even steps, breathing behind the brace.', 'Leaning back to hold the weight.'],
  }),
  x('waiter-carry', 'Overhead carry (one arm, weight held up)', 'carry', ['dumbbell'], ['shoulders', 'obliques'], ['upper-back', 'triceps'], 'moderate', 'intermediate', {
    uni: true, easier: ['suitcase-carry', 'goblet-carry'],
    aliases: ['waiters walk', 'single arm overhead carry'], alsoWith: ['kettlebell'], risk: ['joint:shoulder-overhead'], hotel: true,
    guide: ['One arm locked straight, the weight over the shoulder.', 'Walk slowly, ribs down, and switch hands.', 'Leaning back, or the arm drifting forward.'],
  }),
  x('sled-push', 'Sled push', 'carry', ['sled'], ['quads', 'glutes'], ['calves', 'abs'], 'low', 'beginner', {
    easier: ['goblet-carry'],
    aliases: ['prowler push'], risk: ['demand:vigorous'],
    guide: ['Hands on the poles, arms straight or bent, leaning in.', 'Drive with short, powerful steps; a light load and a steady pace for conditioning.', 'Standing upright so the legs cannot push.'],
  }),

  // core
  x('dead-bug', 'Dead bug', 'core-anti-extension', ['bodyweight'], ['abs'], [], 'low', 'beginner', {
    load: BW, easier: ['breathing-90-90'], harder: ['hollow-hold', 'tuck-hollow-hold'],
    aliases: ['deadbug'], risk: ['demand:floor', 'demand:supine'], uses: ['warm-up'], hotel: true,
    guide: ['Lie on your back, arms up, knees over the hips, lower back gently on the floor.', 'Reach the opposite arm and leg out slowly, breathing out as you reach.', 'The lower back arching off the floor.'],
  }),
  x('plank', 'Front plank', 'core-anti-extension', ['bodyweight'], ['abs'], ['shoulders'], 'low', 'beginner', {
    load: 'timed', easier: ['incline-plank'], harder: ['hollow-hold', 'stability-ball-rollout', 'plank-shoulder-tap', 'foot-supported-l-sit'],
    aliases: ['forearm plank', 'elbow plank'], risk: ['demand:floor'], hotel: true,
    guide: ['Elbows under the shoulders, body straight.', 'Squeeze the glutes, ribs down, and breathe.', 'Letting the hips sag; stop the hold before they do.'],
  }),
  x('hollow-hold', 'Hollow body hold', 'core-anti-extension', ['bodyweight'], ['abs'], [], 'low', 'intermediate', {
    load: 'timed', easier: ['dead-bug', 'tuck-hollow-hold', 'plank'], harder: ['tuck-l-sit', 'dragon-flag', 'tuck-front-lever'],
    aliases: ['hollow hold arms by sides', 'hollow hold arms overhead'], risk: ['demand:floor', 'demand:supine'], hotel: true,
    guide: ['Lie on your back, lower back pressed to the floor.', 'Hold the arms and legs long and low; bend the knees if the back lifts.', 'The lower back lifting off the floor.'],
  }),
  x('incline-plank', 'Incline plank (hands on a bench or counter)', 'core-anti-extension', ['bodyweight'], ['abs'], ['shoulders'], 'low', 'beginner', {
    load: 'timed', easier: ['wrist-mobility'], harder: ['plank'],
    aliases: ['elevated plank', 'counter plank'], risk: ['joint:wrist-extension'], hotel: true,
    guide: ['Hands on a bench or counter; the higher the hands, the easier it is.', 'Hold a straight line from head to heels, glutes squeezed, breathing.', 'The hips sagging.'],
  }),
  x('tuck-hollow-hold', 'Tuck hollow hold', 'core-anti-extension', ['bodyweight'], ['abs'], [], 'low', 'beginner', {
    load: 'timed', easier: ['dead-bug'], harder: ['hollow-hold'],
    aliases: ['tucked hollow hold'], risk: ['demand:floor', 'demand:supine'], hotel: true,
    guide: ['Lie on your back, lower back pressed into the floor.', 'Pull the knees in, lift the shoulders just off the floor, and hold.', 'Holding on after the back starts to lift.'],
  }),
  x('stability-ball-rollout', 'Stability ball rollout', 'core-anti-extension', ['stability-ball'], ['abs'], ['lats', 'shoulders'], 'low', 'intermediate', {
    easier: ['plank'], harder: ['ab-wheel-rollout'],
    aliases: ['swiss ball rollout', 'ball rollout'], risk: ['joint:kneeling'],
    guide: ['Kneel with the forearms on the ball.', 'Roll out only as far as the back stays flat, then pull back with the abs.', 'The lower back sagging, or pulling back with the hips.'],
  }),
  x('ab-wheel-rollout', 'Ab wheel rollout (from the knees)', 'core-anti-extension', ['ab-wheel'], ['abs'], ['lats', 'shoulders'], 'moderate', 'intermediate', {
    easier: ['stability-ball-rollout'], harder: ['standing-ab-wheel-rollout'],
    aliases: ['ab roller', 'kneeling rollout', 'barbell rollout'], alsoWith: ['barbell'], risk: ['joint:kneeling'],
    guide: ['Kneel with the wheel under the shoulders, pelvis tucked slightly.', 'Roll out to a distance you can return from, arms long, then roll back.', 'The lower back sagging at the far end.'],
  }),
  x('standing-ab-wheel-rollout', 'Standing ab wheel rollout', 'core-anti-extension', ['ab-wheel'], ['abs'], ['lats', 'shoulders'], 'high', 'advanced', {
    easier: ['ab-wheel-rollout'],
    aliases: ['standing rollout'],
    guide: ['Stand with the wheel on the floor; a wall in front limits the range at first.', 'Roll out with the body rigid like a plank, then pull back.', 'Piking the hips first to get back up.'],
  }),
  x('bear-plank', 'Bear plank (knees hovering)', 'core-anti-extension', ['bodyweight'], ['abs'], ['shoulders', 'quads'], 'low', 'beginner', {
    load: 'timed', harder: ['bear-crawl', 'crow-pose'],
    aliases: ['bear hold', 'quadruped hover'], risk: ['joint:wrist-extension', 'demand:floor'], uses: ['warm-up'], hotel: true,
    guide: ['Hands under the shoulders, knees under the hips.', 'Lift the knees a few centimetres off the floor and hold, back flat as a table.', 'The hips rising, or the back rounding.'],
  }),
  x('bear-crawl', 'Bear crawl', 'core-anti-extension', ['bodyweight'], ['abs', 'shoulders'], ['quads', 'triceps'], 'low', 'intermediate', {
    load: 'timed', easier: ['bear-plank'],
    aliases: ['bear walk'], risk: ['joint:wrist-extension', 'demand:floor'], uses: ['warm-up'], hotel: true,
    guide: ['Hands under the shoulders, knees just off the floor.', 'Move opposite hand and foot together in small steps, hips level.', 'The hips swaying or rising high.'],
  }),
  x('dragon-flag', 'Dragon flag', 'core-anti-extension', ['bench'], ['abs'], ['lats', 'obliques'], 'high', 'advanced', {
    load: BW, easier: ['hollow-hold', 'lying-leg-raise'],
    aliases: ['dragon flag negative'], risk: ['joint:neck-loaded', 'demand:supine'],
    guide: ['Lie on a bench, gripping it behind the head.', 'Hold the body straight from the shoulders to the toes and lower slowly; start with the lowering only.', 'Bending at the hips, or rolling the load onto the neck.'],
  }),
  x('bird-dog', 'Bird dog', 'core-anti-rotation', ['bodyweight'], ['lower-back', 'abs'], ['glutes'], 'low', 'beginner', {
    load: BW, harder: ['side-plank', 'prone-back-extension'],
    aliases: ['quadruped arm and leg reach'], risk: ['joint:wrist-extension', 'joint:kneeling', 'demand:floor'], uses: ['warm-up'], hotel: true,
    guide: ['On hands and knees, back flat.', 'Reach the opposite arm and leg long, slowly, then switch.', 'The hips rocking or rotating as the leg lifts.'],
  }),
  x('side-plank', 'Side plank', 'core-anti-rotation', ['bodyweight'], ['obliques'], ['abs', 'abductors'], 'low', 'beginner', {
    load: 'timed', easier: ['bird-dog', 'knee-side-plank'], harder: ['pallof-press', 'copenhagen-plank', 'turkish-get-up'],
    aliases: ['side bridge'], risk: ['demand:floor'], hotel: true,
    guide: ['Elbow under the shoulder, legs stacked.', 'Push the hip up into a straight line from head to feet, and hold.', 'The hips sagging or rolling back.'],
  }),
  x('pallof-press', 'Cable Pallof press', 'core-anti-rotation', ['cable'], ['obliques', 'abs'], [], 'low', 'beginner', {
    easier: ['side-plank'], harder: ['suitcase-carry', 'cable-woodchop'],
    aliases: ['pallof', 'anti rotation press', 'band pallof press'], alsoWith: ['band'], hotel: true,
    guide: ['Stand side-on to the cable, feet hip width, the handle at the chest.', 'Press the handle straight out and hold, then bring it back.', 'Letting it turn you toward the cable.'],
  }),
  x('knee-side-plank', 'Side plank from the knees', 'core-anti-rotation', ['bodyweight'], ['obliques'], ['abs', 'abductors'], 'low', 'beginner', {
    load: 'timed', harder: ['side-plank'],
    aliases: ['short side plank', 'kneeling side plank'], risk: ['demand:floor'], hotel: true,
    guide: ['Elbow under the shoulder, knees bent behind you.', 'Lift the hips into a straight line, and hold.', 'Letting the hips sag.'],
  }),
  x('copenhagen-plank', 'Copenhagen side plank (top leg on a bench)', 'core-anti-rotation', ['bodyweight'], ['adductors', 'obliques'], ['abs'], 'low', 'intermediate', {
    load: 'timed', easier: ['side-plank'],
    aliases: ['copenhagen adductor plank', 'copenhagen'], risk: ['demand:floor'], hotel: true,
    guide: ['Side plank with the top leg on a bench; the knee on the bench is easier, the ankle harder.', 'Lift the bottom leg up to meet the bench and hold, building up with short holds.', 'Long holds before the short ones feel easy.'],
  }),
  x('plank-shoulder-tap', 'Plank shoulder tap', 'core-anti-rotation', ['bodyweight'], ['abs', 'obliques'], ['shoulders'], 'low', 'beginner', {
    load: BW, easier: ['plank'], harder: ['renegade-row'],
    aliases: ['shoulder taps'], risk: ['joint:wrist-extension', 'demand:floor'], hotel: true,
    guide: ['High plank, feet wide.', 'Tap the opposite shoulder slowly, hips still, as if a glass of water sat on your back.', 'The hips rocking side to side.'],
  }),
  x('cable-woodchop', 'Cable woodchop (high to low)', 'core-anti-rotation', ['cable'], ['obliques'], ['abs', 'shoulders'], 'low', 'intermediate', {
    easier: ['pallof-press'],
    aliases: ['woodchopper', 'cable chop', 'band woodchop'], alsoWith: ['band'], risk: ['joint:spine-rotation'], hotel: true,
    guide: ['Cable set high, side-on to the stack, arms long.', 'Turn through the upper back and hips together to pull low across the body, pivoting the back foot; control the return.', 'Pulling with the arms, or twisting from the lower back alone.'],
  }),
  x('turkish-get-up', 'Turkish get-up', 'core-anti-rotation', ['kettlebell'], ['shoulders', 'obliques'], ['abs', 'glutes', 'triceps'], 'moderate', 'intermediate', {
    uni: true, easier: ['side-plank'],
    aliases: ['get up', 'tgu'], alsoWith: ['dumbbell'], risk: ['joint:shoulder-overhead', 'joint:kneeling', 'demand:floor'], hotel: true,
    guide: ['Learn it with no weight, or a shoe balanced on the fist.', 'One step at a time, both up and down, eyes on the weight the whole time.', 'Rushing the steps, or the arm bending.'],
  }),
  x('reverse-crunch', 'Reverse crunch', 'core-flexion', ['bodyweight'], ['abs'], [], 'low', 'beginner', {
    load: BW, harder: ['hanging-knee-raise', 'lying-leg-raise', 'captains-chair-knee-raise'],
    aliases: ['lying knee tuck'], risk: ['joint:spine-flexion', 'demand:floor', 'demand:supine'], hotel: true,
    guide: ['Lie on your back, knees bent, hands by the sides.', 'Curl the hips off the floor toward the ribs, then lower slowly.', 'Swinging the legs to throw the hips up.'],
  }),
  x('hanging-knee-raise', 'Hanging knee raise', 'core-flexion', ['pull-up-bar'], ['abs'], ['forearms'], 'moderate', 'intermediate', {
    load: BW, easier: ['reverse-crunch', 'captains-chair-knee-raise'], harder: ['hanging-leg-raise'],
    aliases: ['hanging knee tuck'], risk: ['joint:shoulder-hang', 'joint:grip-heavy'],
    guide: ['Hang still from the bar, shoulders active.', 'Lift the knees and curl the pelvis up, then lower without swinging.', 'Swinging to get the knees up.'],
  }),
  x('crunch', 'Crunch', 'core-flexion', ['bodyweight'], ['abs'], ['obliques'], 'moderate', 'beginner', {
    load: BW, harder: ['cable-crunch'],
    aliases: ['curl up', 'abdominal crunch'], risk: ['joint:spine-flexion', 'demand:floor', 'demand:supine'], hotel: true,
    guide: ['Lie on your back, knees bent, hands across the chest or lightly at the temples.', 'Curl the ribs toward the pelvis, lifting the shoulders only.', 'Yanking the neck with the hands.'],
  }),
  x('cable-crunch', 'Kneeling cable crunch', 'core-flexion', ['cable'], ['abs'], ['obliques'], 'moderate', 'intermediate', {
    easier: ['crunch'],
    aliases: ['rope crunch'], risk: ['joint:spine-flexion', 'joint:kneeling'],
    guide: ['Kneel facing the cable, rope held by the head.', 'Curl the chest toward the knees, breathing out, while the hips stay still.', 'Sitting back to pull the weight with the hips.'],
  }),
  x('lying-leg-raise', 'Lying leg raise', 'core-flexion', ['bodyweight'], ['abs'], [], 'moderate', 'intermediate', {
    load: BW, easier: ['reverse-crunch'], harder: ['hanging-leg-raise', 'dragon-flag'],
    aliases: ['leg raise', 'supine leg raise'], risk: ['demand:floor', 'demand:supine'], hotel: true,
    guide: ['Lie on your back, hands under the hips if the back lifts; bent knees make it easier.', 'Lower the legs only as far as the back stays down, then lift them back up.', 'The lower back arching off the floor.'],
  }),
  x('captains-chair-knee-raise', 'Captain\'s chair knee raise', 'core-flexion', ['machine'], ['abs'], [], 'moderate', 'beginner', {
    load: BW, easier: ['reverse-crunch'], harder: ['hanging-knee-raise'],
    aliases: ['vertical knee raise', 'roman chair knee raise'],
    guide: ['Back against the pad, forearms resting on the arms of the chair.', 'Curl the knees up and the pelvis under, then lower slowly.', 'Swinging the legs up.'],
  }),
  x('hanging-leg-raise', 'Hanging leg raise', 'core-flexion', ['pull-up-bar'], ['abs'], ['forearms'], 'high', 'advanced', {
    load: BW, easier: ['hanging-knee-raise', 'lying-leg-raise'],
    aliases: ['hanging straight leg raise'], risk: ['joint:shoulder-hang', 'joint:grip-heavy'],
    guide: ['Hang from the bar, shoulders active.', 'Lift straight legs to hip height or higher, then lower slowly.', 'Swinging to get the legs up.'],
  }),

  // calves
  // Regions: a standing raise, knees straight (the machine calf raise is the
  // standing machine), grows the gastrocnemius and loads the soleus; the
  // seated raise, knees bent, slackens the gastrocnemius and loads only the
  // soleus (Weak: Kinoshita 2023).
  x('calf-raise', 'Standing calf raise (on a step)', 'calves', ['bodyweight'], ['calves'], [], 'low', 'beginner', {
    load: BW, harder: ['machine-calf-raise', 'seated-calf-raise', 'single-leg-calf-raise', 'pogo-hop'], regions: ['calves-gastroc', 'calves-soleus'], longLength: ['calves-gastroc'],
    aliases: ['step calf raise'], hotel: true,
    guide: ['Balls of the feet on a step edge, holding a rail for balance.', 'Lower to a full stretch, then rise high on the toes.', 'Bouncing through short reps.'],
  }),
  x('machine-calf-raise', 'Machine calf raise', 'calves', ['machine'], ['calves'], [], 'low', 'beginner', {
    easier: ['calf-raise'], regions: ['calves-gastroc', 'calves-soleus'], longLength: ['calves-gastroc'],
    aliases: ['standing calf machine', 'calf raise machine'], risk: ['joint:spine-axial'],
    guide: ['Shoulders under the pads, knees soft, balls of the feet on the edge.', 'Use the full range every rep, and pause at the top.', 'Bouncing through short reps.'],
  }),
  x('seated-calf-raise', 'Seated calf raise', 'calves', ['machine'], ['calves'], [], 'low', 'beginner', {
    easier: ['calf-raise'], regions: ['calves-soleus'],
    aliases: ['seated calf machine', 'seated dumbbell calf raise'], alsoWith: ['dumbbell'], hotel: true,
    guide: ['Seated, balls of the feet on the platform (at home, a plate or book), the pad or a weight on the thighs near the knees.', 'Lower to a full stretch, then rise high and pause at the top.', 'Bouncing through short reps.'],
  }),
  x('single-leg-calf-raise', 'Single-leg calf raise (on a step)', 'calves', ['bodyweight'], ['calves'], [], 'low', 'intermediate', {
    uni: true, load: BW, easier: ['calf-raise'], regions: ['calves-gastroc', 'calves-soleus'], longLength: ['calves-gastroc'],
    aliases: ['one leg calf raise'], uses: ['balance'], hotel: true,
    guide: ['One foot on a step edge, fingertips on a wall for balance.', 'Lower to a full stretch, rise high on the toes, and come down slowly.', 'Pushing up with the hand on the wall.'],
  }),
  x('heel-walk', 'Heel walk', 'calves', ['bodyweight'], ['tibialis'], [], 'low', 'beginner', {
    load: 'timed', harder: ['tibialis-raise'],
    aliases: ['walking on heels'], uses: ['warm-up'], hotel: true,
    guide: ['Near a wall, toes lifted.', 'Walk on the heels with short steps.', 'Carrying on through a shin cramp; stop and shake it out.'],
  }),
  x('tibialis-raise', 'Tibialis raise (back against a wall)', 'calves', ['bodyweight'], ['tibialis'], [], 'low', 'beginner', {
    load: BW, easier: ['heel-walk'],
    aliases: ['tib raise', 'toe raise'], hotel: true,
    guide: ['Lean back on a wall, feet a step out.', 'Pull the toes up as high as you can, then lower slowly.', 'Rocking off the wall to lift the toes.'],
  }),

  // arms
  // Regions: the overhead extensions, dumbbell or cable, grow the triceps
  // long head more than pushdowns do (Weak: Maeo 2023, which trained the
  // cable overhead extension).
  x('db-curl', 'Dumbbell curl', 'biceps', ['dumbbell'], ['biceps'], ['forearms'], 'low', 'beginner', {
    easier: ['band-curl'], harder: ['barbell-curl', 'incline-db-curl'],
    aliases: ['biceps curl', 'dumbbell biceps curl'], hotel: true,
    guide: ['Stand tall, elbows pinned at the sides.', 'Curl, turning the palms up, then lower all the way.', 'Swinging the body, or the elbows drifting forward.'],
  }),
  x('band-curl', 'Band curl', 'biceps', ['band'], ['biceps'], ['forearms'], 'low', 'beginner', {
    harder: ['db-curl', 'hammer-curl'],
    aliases: ['banded curl', 'resistance band curl'], hotel: true,
    guide: ['Stand on the band, elbows by the sides.', 'Curl up and squeeze, then lower slowly against the pull.', 'Letting the band snap the arms down.'],
  }),
  x('hammer-curl', 'Hammer curl', 'biceps', ['dumbbell'], ['biceps', 'forearms'], [], 'low', 'beginner', {
    easier: ['band-curl'],
    aliases: ['neutral grip curl'], hotel: true,
    guide: ['Thumbs up, as if holding hammers, elbows at the sides.', 'Curl up, then lower all the way.', 'Swinging the body.'],
  }),
  x('barbell-curl', 'Barbell curl', 'biceps', ['barbell'], ['biceps'], ['forearms'], 'low', 'beginner', {
    easier: ['db-curl'],
    aliases: ['ez bar curl', 'straight bar curl'],
    guide: ['Shoulder-width grip, standing tall.', 'Curl without leaning back, then lower all the way to straight arms.', 'Leaning back to swing the bar up.'],
  }),
  x('incline-db-curl', 'Incline dumbbell curl', 'biceps', ['dumbbell', 'bench'], ['biceps'], ['forearms'], 'low', 'intermediate', {
    easier: ['db-curl'],
    aliases: ['incline curl'],
    guide: ['Bench at about 45 degrees, arms hanging behind the body, light weights.', 'Curl without bringing the elbows forward, then lower to a full stretch.', 'Going heavy enough that the elbows swing forward.'],
  }),
  x('cable-pushdown', 'Cable triceps pushdown', 'triceps', ['cable'], ['triceps'], [], 'low', 'beginner', {
    easier: ['overhead-db-extension'], harder: ['cable-overhead-triceps-extension'],
    aliases: ['triceps pushdown', 'rope triceps pushdown', 'straight bar triceps pushdown', 'band pushdown'], alsoWith: ['band'], hotel: true,
    guide: ['Face the cable, elbows fixed at the sides.', 'Push down to straight arms, then let the forearms rise slowly.', 'The elbows drifting forward or flaring.'],
  }),
  x('overhead-db-extension', 'Overhead dumbbell triceps extension', 'triceps', ['dumbbell'], ['triceps'], [], 'low', 'beginner', {
    harder: ['cable-overhead-triceps-extension', 'cable-pushdown'], regions: ['triceps-long'], longLength: ['triceps-long'],
    aliases: ['overhead triceps extension'], alsoWith: ['kettlebell'], risk: ['joint:shoulder-overhead'], hotel: true,
    guide: ['One weight held in both hands overhead.', 'Elbows pointing forward, lower it behind the head, then straighten the arms.', 'Arching the back; the ribs stay down.'],
  }),
  x('cable-overhead-triceps-extension', 'Cable overhead triceps extension', 'triceps', ['cable'], ['triceps'], [], 'low', 'beginner', {
    easier: ['overhead-db-extension', 'cable-pushdown'], regions: ['triceps-long'], longLength: ['triceps-long'],
    alsoWith: ['band'], risk: ['joint:shoulder-overhead'], hotel: true,
    guide: ['Face away from a low cable, rope held behind the head, one foot forward.', 'Keep the elbows pointing forward and straighten the arms overhead, then lower to a full stretch.', 'The elbows flaring wide, or the back arching.'],
  }),
  x('bench-dip', 'Bench dip', 'triceps', ['bench'], ['triceps'], ['chest', 'shoulders'], 'low', 'beginner', {
    load: BW, harder: ['ring-dip', 'parallel-bar-dip', 'parallel-bar-support-hold'],
    aliases: ['chair dip', 'triceps dip on a bench'], risk: ['joint:shoulder-extension', 'joint:wrist-extension'],
    guide: ['Hands on the bench edge, hips close to it; bent knees make it easier.', 'Lower only until the upper arms are level, then press up.', 'Dropping lower than the shoulders like.'],
  }),
  x('diamond-push-up', 'Close-hand push-up (diamond)', 'triceps', ['bodyweight'], ['triceps'], ['chest', 'shoulders'], 'low', 'intermediate', {
    load: BW, easier: ['push-up'], harder: ['parallel-bar-dip'], regions: ['shoulders-front'],
    aliases: ['triangle push up'], risk: ['joint:wrist-extension', 'demand:floor'], hotel: true,
    guide: ['Hands close under the chest; knees down makes it easier.', 'Lower with the elbows brushing the ribs, then push up.', 'The elbows flaring out to the sides.'],
  }),
  x('lying-db-triceps-extension', 'Lying dumbbell triceps extension', 'triceps', ['dumbbell', 'bench'], ['triceps'], [], 'low', 'beginner', {
    harder: ['skull-crusher'],
    aliases: ['dumbbell skull crusher', 'lying dumbbell extension'], risk: ['demand:supine'],
    guide: ['Lie on a bench, upper arms pointing at the ceiling, fixed.', 'Lower the weights beside the head, then straighten the arms without locking hard.', 'The upper arms swinging back and forth.'],
  }),
  x('skull-crusher', 'Lying barbell triceps extension', 'triceps', ['barbell', 'bench'], ['triceps'], [], 'low', 'intermediate', {
    easier: ['lying-db-triceps-extension'],
    aliases: ['ez bar skull crusher'], risk: ['demand:supine'],
    guide: ['Lie on a bench; a curl bar is kinder to the wrists.', 'Lower the bar to the forehead or just behind with the elbows narrow, then straighten.', 'The elbows flaring wide.'],
  }),

  // rear delts, lateral raises, neck and upper back
  // Regions: reverse flys (dumbbell or machine), face pulls and pull-aparts
  // load the rear delts and the mid-back (both heuristic); lateral raises,
  // dumbbell, cable or band, grow the side delts (Weak: Lanza 2024, Larsen
  // 2025a), the band raise the option with neither dumbbells nor a cable.
  // Shrugs load the upper traps (heuristic, a rough guide). The shrug's grip
  // holds the dumbbells every rep, so the forearms help (a heuristic, as for
  // rows), and heavy dumbbells held standing strain the abdomen like a carry
  // without the walk: moderate.
  x('face-pull', 'Cable face pull', 'rear-delt', ['cable'], ['upper-back'], ['shoulders'], 'low', 'beginner', {
    easier: ['band-pull-apart', 'band-external-rotation'], regions: ['shoulders-rear', 'upper-back-mid'],
    aliases: ['rope face pull', 'band face pull'], alsoWith: ['band'], uses: ['posture'], hotel: true,
    guide: ['Rope at forehead height.', 'Pull toward the face with the hands apart, finishing with the elbows high and wide.', 'Leaning back or shrugging to move the weight.'],
  }),
  x('band-pull-apart', 'Band pull-apart', 'rear-delt', ['band'], ['upper-back'], ['shoulders'], 'low', 'beginner', {
    harder: ['face-pull', 'reverse-pec-deck', 'reverse-db-fly'], regions: ['shoulders-rear', 'upper-back-mid'],
    aliases: ['pull apart'], uses: ['posture', 'warm-up', 'desk-break'], hotel: true,
    guide: ['Arms straight in front at chest height, band in both hands.', 'Pull the band apart to the chest, shoulders down.', 'Shrugging the shoulders up.'],
  }),
  x('reverse-db-fly', 'Bent-over reverse dumbbell fly', 'rear-delt', ['dumbbell'], ['upper-back'], ['shoulders'], 'low', 'beginner', {
    easier: ['band-pull-apart', 'prone-t-raise', 'reverse-pec-deck'], regions: ['shoulders-rear', 'upper-back-mid'],
    aliases: ['rear delt fly', 'reverse fly', 'bent over rear delt raise'], risk: ['joint:back-bent-over'], uses: ['posture'], hotel: true,
    guide: ['Hinge forward, light weights hanging, elbows slightly bent.', 'Lift the arms out wide, pause, then lower slowly.', 'Swinging the weights up with the back.'],
  }),
  x('prone-t-raise', 'Prone T raise (face down, arms out)', 'rear-delt', ['bodyweight'], ['upper-back'], ['shoulders'], 'low', 'beginner', {
    load: BW, easier: ['wall-slide'], harder: ['reverse-db-fly', 'prone-y-raise'], regions: ['shoulders-rear', 'upper-back-mid'],
    aliases: ['prone t', 'lying t raise'], risk: ['demand:floor', 'demand:prone'], uses: ['posture'], hotel: true,
    guide: ['Lie face down, arms out in a T, thumbs up.', 'Lift the arms a few centimetres and squeeze between the shoulder blades.', 'Arching the neck or lower back to lift higher.'],
  }),
  x('reverse-pec-deck', 'Reverse pec deck (rear-delt machine)', 'rear-delt', ['machine'], ['upper-back'], ['shoulders'], 'low', 'beginner', {
    easier: ['band-pull-apart'], harder: ['reverse-db-fly'], regions: ['shoulders-rear', 'upper-back-mid'],
    aliases: ['reverse fly machine', 'rear delt machine'], uses: ['posture'],
    guide: ['Chest on the pad, arms straight ahead on the handles.', 'Sweep the arms out wide, leading with the elbows, then return slowly.', 'Shrugging, or leading with the hands.'],
  }),
  x('prone-y-raise', 'Prone Y raise (face down, arms overhead)', 'rear-delt', ['bodyweight'], ['upper-back'], ['shoulders'], 'low', 'beginner', {
    load: BW, easier: ['prone-t-raise'], regions: ['shoulders-rear', 'upper-back-mid'],
    aliases: ['prone y', 'lying y raise'], risk: ['demand:floor', 'demand:prone'], uses: ['posture'], hotel: true,
    guide: ['Lie face down, arms in a Y, thumbs up.', 'Lift the arms a few centimetres, neck long and forehead near the floor.', 'Arching the lower back to lift higher.'],
  }),
  x('band-external-rotation', 'Band external rotation (elbow at the side)', 'rear-delt', ['band'], ['shoulders'], ['upper-back'], 'low', 'beginner', {
    harder: ['face-pull'],
    aliases: ['shoulder external rotation', 'cable external rotation'], alsoWith: ['cable'], uses: ['warm-up', 'posture'], hotel: true,
    guide: ['Band at elbow height, a folded towel between the elbow and the side.', 'Turn the forearm out like a gate, then back: small, slow and light.', 'The elbow leaving the side.'],
  }),
  x('band-lateral-raise', 'Band lateral raise', 'lateral-raise', ['band'], ['shoulders'], [], 'low', 'beginner', {
    harder: ['db-lateral-raise', 'cable-lateral-raise'], regions: ['shoulders-side'],
    aliases: ['banded lateral raise'], hotel: true,
    guide: ['Stand on the band, arms by the sides.', 'Raise out to shoulder height, not higher, leading with the elbows.', 'Shrugging the shoulders as the band tightens.'],
  }),
  x('db-lateral-raise', 'Dumbbell lateral raise', 'lateral-raise', ['dumbbell'], ['shoulders'], [], 'low', 'beginner', {
    easier: ['band-lateral-raise'], harder: ['cable-lateral-raise'], regions: ['shoulders-side'],
    aliases: ['lateral raise', 'side raise', 'side lateral raise'], hotel: true,
    guide: ['Light weights at the sides, a slight bend in the elbows.', 'Raise out to shoulder height, leading with the elbows, then lower slowly.', 'Swinging the weights, or shrugging them up.'],
  }),
  x('cable-lateral-raise', 'Cable lateral raise', 'lateral-raise', ['cable'], ['shoulders'], [], 'low', 'beginner', {
    easier: ['db-lateral-raise', 'band-lateral-raise'], regions: ['shoulders-side'],
    aliases: ['single arm cable lateral raise'],
    guide: ['Cable low, across the body, the handle in the far hand.', 'Raise out to shoulder height, then come down slowly.', 'Leaning away to swing the weight.'],
  }),
  x('chin-tuck', 'Chin tuck hold', 'neck-upper-back', ['bodyweight'], ['neck'], [], 'low', 'beginner', {
    load: 'timed', easier: ['neck-side-stretch'], harder: ['neck-isometric'],
    aliases: ['chin tucks', 'neck retraction'], uses: ['posture', 'desk-break'], hotel: true,
    guide: ['Sit or stand tall, eyes level.', 'Slide the head straight back to make a double chin, hold a few seconds, then relax.', 'Nodding the head down instead of sliding it back.'],
  }),
  x('wall-slide', 'Wall slide', 'neck-upper-back', ['bodyweight'], ['upper-back'], ['shoulders'], 'low', 'beginner', {
    load: BW, easier: ['band-pass-through'], harder: ['prone-t-raise', 'scapular-push-up'],
    aliases: ['scapular wall slide', 'wall angel'], uses: ['posture', 'warm-up', 'desk-break'], hotel: true,
    guide: ['Forearms on the wall, a step out from it.', 'Slide the arms up while the ribs stay down, then pull them down by squeezing the shoulder blades.', 'Arching the back to get the arms higher.'],
  }),
  x('db-shrug', 'Dumbbell shrug', 'neck-upper-back', ['dumbbell'], ['upper-back'], ['forearms'], 'moderate', 'beginner', {
    harder: ['farmer-carry'], regions: ['upper-back-traps'],
    aliases: ['shrug', 'barbell shrug', 'trap bar shrug'], alsoWith: ['kettlebell', 'trap-bar', 'barbell'], risk: ['joint:grip-heavy'], hotel: true,
    guide: ['Stand tall, weights at the sides.', 'Lift the shoulders straight up toward the ears, pause, then lower fully.', 'Rolling the shoulders.'],
  }),
  x('neck-isometric', 'Neck isometric hold (hand pressing on the head)', 'neck-upper-back', ['bodyweight'], ['neck'], [], 'low', 'beginner', {
    load: 'timed', easier: ['chin-tuck'],
    aliases: ['neck isometrics', 'manual neck resistance'], uses: ['posture', 'desk-break'], hotel: true,
    guide: ['A hand on the head: front, back and each side.', 'Press the hand and head together gently, with no movement, at about half effort.', 'Pushing hard; this is not a strength test.'],
  }),
  x('scapular-push-up', 'Scapular push-up', 'neck-upper-back', ['bodyweight'], ['shoulders'], ['chest', 'upper-back'], 'low', 'beginner', {
    load: BW, easier: ['wall-slide'], harder: ['push-up'],
    aliases: ['scap push up', 'push up plus'], risk: ['joint:wrist-extension', 'demand:floor'], uses: ['warm-up', 'posture'], hotel: true,
    guide: ['High plank, or on the knees, arms straight the whole time.', 'Let the chest sink between the shoulder blades, then push the floor away to round the upper back.', 'Bending the elbows.'],
  }),

  // jump
  // Jumping, hopping and landing: power and bone loading with body weight.
  // The jumps that land in a squat are tagged and regioned as squats are (no
  // hamstrings, the vasti); the big jumps strain the abdomen most (a jump
  // gave more abdominal pressure than a cough in healthy adults; Cobb 2005).
  x('snap-down', 'Snap-down (fast drop to a landing)', 'jump', ['bodyweight'], ['quads', 'glutes'], ['calves'], 'moderate', 'beginner', {
    load: BW, easier: ['bodyweight-squat'], harder: ['pogo-hop', 'squat-jump'], regions: ['quads-vasti'],
    aliases: ['landing drill', 'drop to landing'], risk: ['demand:impact'],
    guide: ['Rise onto the toes, arms up.', 'Drop fast into a quarter squat and land quiet and still, knees over the toes.', 'Landing stiff-legged, or with the knees caving in.'],
  }),
  x('pogo-hop', 'Pogo hops (small ankle bounces)', 'jump', ['bodyweight'], ['calves'], ['quads'], 'moderate', 'beginner', {
    load: BW, easier: ['calf-raise', 'snap-down'], harder: ['squat-jump'],
    aliases: ['pogo jumps', 'ankle hops'], risk: ['demand:impact'],
    guide: ['Stand tall, ankles stiff.', 'Bounce off the balls of the feet with quick, quiet contacts, knees barely bending.', 'Landing heavy on the heels.'],
  }),
  x('squat-jump', 'Squat jump', 'jump', ['bodyweight'], ['quads', 'glutes'], ['calves'], 'high', 'intermediate', {
    load: BW, easier: ['snap-down', 'pogo-hop'], harder: ['box-jump'], regions: ['quads-vasti'],
    aliases: ['jump squat', 'vertical jump'], risk: ['demand:impact'],
    guide: ['Feet shoulder width.', 'Dip and jump straight up, land softly into the same quarter squat, and reset between reps.', 'Landing with straight legs, or the knees caving in.'],
  }),
  x('box-jump', 'Box jump (step down)', 'jump', ['bench'], ['quads', 'glutes'], ['calves'], 'high', 'intermediate', {
    load: BW, easier: ['squat-jump'], harder: ['skater-bound'], regions: ['quads-vasti'],
    aliases: ['jump onto a box'], risk: ['demand:impact'],
    guide: ['Pick a box you can land on easily.', 'Jump up and land softly in a squat, stand up, then step down.', 'Jumping down off the box.'],
  }),
  x('skater-bound', 'Skater bound (side-to-side jumps)', 'jump', ['bodyweight'], ['glutes', 'quads'], ['abductors', 'adductors', 'calves'], 'high', 'intermediate', {
    uni: true, load: BW, easier: ['lateral-lunge', 'box-jump'], regions: ['quads-vasti'],
    aliases: ['skater jump', 'lateral bound'], risk: ['demand:impact', 'demand:balance'],
    guide: ['Stand on one leg.', 'Push off sideways and land on the other leg, sticking it; start with small jumps and a pause.', 'Landing with the knee caving in.'],
  }),

  // conditioning
  // No muscles, as for mobility: effort is limited by breathing, not by a
  // muscle near failure, so these are never counted as sets (a burpee
  // included). The machines share `machine` with the gym's.
  x('brisk-walk', 'Brisk walk', 'conditioning', ['bodyweight'], [], [], 'low', 'beginner', {
    load: 'cardio', harder: ['hill-intervals-4x4', 'run-walk', 'stair-climb', 'swim', 'easy-run'],
    aliases: ['walk', 'walking', 'brisk walking', 'power walk'], uses: ['warm-up', 'cool-down', 'desk-break'], hotel: true,
    guide: ['A pace that warms you but lets you talk.', 'Walk with the arms swinging; add hills or minutes before speed.', 'Going so fast you cannot talk.'],
  }),
  x('easy-run', 'Easy run (zone 2)', 'conditioning', ['bodyweight'], [], [], 'low', 'beginner', {
    load: 'cardio', easier: ['brisk-walk', 'run-walk'], harder: ['hill-intervals-4x4'],
    aliases: ['jog', 'jogging', 'easy jog', 'running'], risk: ['demand:impact', 'demand:vigorous'], hotel: true,
    guide: ['A pace you could chat at; walk breaks are fine.', 'Run with short, quick steps, landing under the body.', 'Overstriding, or letting easy runs creep faster.'],
  }),
  x('zone2-bike', 'Easy bike (zone 2)', 'conditioning', ['machine'], [], [], 'low', 'beginner', {
    load: 'cardio', harder: ['bike-intervals-4x4'],
    aliases: ['zone 2 bike', 'easy cycling', 'stationary bike', 'cycling'], uses: ['warm-up', 'cool-down'],
    guide: ['Seat at hip height when standing next to the bike.', 'Pedal smoothly and steadily, easy enough to talk in full sentences.', 'Riding so hard you cannot talk.'],
  }),
  x('bike-intervals-4x4', 'Bike intervals, 4 x 4 min', 'conditioning', ['machine'], [], [], 'low', 'intermediate', {
    load: 'cardio', easier: ['zone2-bike', 'elliptical'],
    aliases: ['norwegian 4x4', '4x4 intervals', 'bike 4x4'], risk: ['demand:vigorous'],
    guide: ['Warm up for 10 minutes first.', 'Four minutes hard but steady, three easy, four times; hard means short sentences only.', 'Starting each interval so hard you cannot finish it.'],
  }),
  x('hill-intervals-4x4', 'Uphill walk or run intervals, 4 x 4 min', 'conditioning', ['bodyweight'], [], [], 'low', 'intermediate', {
    load: 'cardio', easier: ['brisk-walk', 'easy-run', 'stair-climb'],
    aliases: ['hill repeats', 'uphill intervals'], risk: ['demand:vigorous'], hotel: true,
    guide: ['A hill or a treadmill incline; walking fast uphill counts.', 'Four minutes hard uphill, three easy, four times.', 'Sprinting the start of each interval.'],
  }),
  x('run-walk', 'Run-walk (alternate short runs and walks)', 'conditioning', ['bodyweight'], [], [], 'low', 'beginner', {
    load: 'cardio', easier: ['brisk-walk'], harder: ['easy-run'],
    aliases: ['walk run', 'jog walk'], risk: ['demand:impact'], hotel: true,
    guide: ['Start with one minute of easy jogging, two of walking.', 'Repeat the pattern, adding running time week by week.', 'Letting the jogs get fast; keep every one easy.'],
  }),
  x('stair-climb', 'Stair climbing (stairs or a stair machine)', 'conditioning', ['bodyweight'], [], [], 'low', 'beginner', {
    load: 'cardio', easier: ['brisk-walk'], harder: ['hill-intervals-4x4'],
    aliases: ['stair machine', 'stairmaster', 'stairs'], hotel: true,
    guide: ['Hold the rail lightly, without leaning on it.', 'Climb with the whole foot on each step at a steady pace.', 'Hurrying down; walk down slowly, or take the lift if going down bothers the knees.'],
  }),
  x('rower-easy', 'Easy row (rowing machine)', 'conditioning', ['machine'], [], [], 'low', 'beginner', {
    load: 'cardio', harder: ['rower-intervals-4x4'],
    aliases: ['rowing machine', 'erg', 'indoor rowing'],
    guide: ['Feet strapped in, the handle held level.', 'Legs, then body, then arms, reversed on the way back, with long strokes at a moderate rate.', 'Pulling with the arms before the legs have pushed.'],
  }),
  x('rower-intervals-4x4', 'Rowing intervals, 4 x 4 min', 'conditioning', ['machine'], [], [], 'low', 'intermediate', {
    load: 'cardio', easier: ['rower-easy'],
    aliases: ['rowing 4x4', 'rower 4x4'], risk: ['demand:vigorous'],
    guide: ['Warm up with easy rowing first.', 'Four minutes hard but steady, three minutes easy, four times, with the same technique as easy rowing.', 'Rushing the stroke rate instead of pulling harder.'],
  }),
  x('elliptical', 'Elliptical trainer', 'conditioning', ['machine'], [], [], 'low', 'beginner', {
    load: 'cardio', harder: ['bike-intervals-4x4'],
    aliases: ['cross trainer', 'elliptical machine'],
    guide: ['Stand tall, hands light on the handles.', 'Move with smooth, even strides; add resistance before speed.', 'Leaning on the handles.'],
  }),
  x('swim', 'Swimming', 'conditioning', ['pool'], [], [], 'low', 'beginner', {
    load: 'cardio', easier: ['brisk-walk'],
    aliases: ['lap swimming', 'swim laps'],
    guide: ['Any stroke at an easy, steady pace.', 'Swim lengths, resting at the wall as needed; add lengths before speed.', 'Racing the first lengths.'],
  }),
  x('jump-rope', 'Jump rope', 'conditioning', ['jump-rope'], [], [], 'moderate', 'intermediate', {
    load: 'cardio', easier: ['jumping-jack'],
    aliases: ['skipping', 'skipping rope'], risk: ['demand:impact', 'demand:vigorous'],
    guide: ['A rope long enough that the handles reach the armpits.', 'Small, quiet hops on the balls of the feet, turning the rope with the wrists; short rounds with rests at first.', 'Jumping high, or turning the rope with the whole arm.'],
  }),
  x('burpee', 'Burpee', 'conditioning', ['bodyweight'], [], [], 'high', 'intermediate', {
    load: 'timed', easier: ['mountain-climber', 'shadow-boxing'],
    aliases: ['burpees'], risk: ['joint:wrist-extension', 'demand:impact', 'demand:vigorous', 'demand:floor'],
    guide: ['Stand with the feet hip width.', 'Hands down, step or jump the feet back and in, then stand or jump to finish; stepping is fine.', 'The hips sagging in the plank.'],
  }),
  x('mountain-climber', 'Mountain climber', 'conditioning', ['bodyweight'], [], [], 'low', 'beginner', {
    load: 'timed', easier: ['march-in-place'], harder: ['burpee'],
    aliases: ['mountain climbers'], risk: ['joint:wrist-extension', 'demand:vigorous', 'demand:floor'], hotel: true,
    guide: ['High plank, hips level.', 'Drive the knees toward the chest in turn; slow it down to make it a core drill.', 'The hips bouncing up and down.'],
  }),
  x('jumping-jack', 'Jumping jack', 'conditioning', ['bodyweight'], [], [], 'moderate', 'beginner', {
    load: 'timed', easier: ['march-in-place'], harder: ['jump-rope'],
    aliases: ['star jump', 'jumping jacks'], risk: ['demand:impact'], uses: ['warm-up'],
    guide: ['Stand tall, arms by the sides.', 'Jump the feet out as the arms rise, landing softly on the balls of the feet; step out instead for a low-impact version.', 'Landing heavy on the heels.'],
  }),
  x('march-in-place', 'Marching in place', 'conditioning', ['bodyweight'], [], [], 'low', 'beginner', {
    load: 'timed', harder: ['jumping-jack', 'mountain-climber', 'shadow-boxing'],
    aliases: ['marching', 'high knee march'], uses: ['warm-up'], hotel: true,
    guide: ['Stand tall; hold a chair back if balance is shaky.', 'Lift the knees to a comfortable height and swing the arms with the legs.', 'Leaning back as the knees come up.'],
  }),
  x('shadow-boxing', 'Shadow boxing', 'conditioning', ['bodyweight'], [], [], 'low', 'beginner', {
    load: 'timed', easier: ['march-in-place'], harder: ['burpee'],
    aliases: ['air boxing'], hotel: true,
    guide: ['Light on the feet, hands up.', 'Punch from the hips in rounds of two or three minutes.', 'Locking the elbows on the punches.'],
  }),

  // mobility
  x('ankle-mobility', 'Knee-to-wall ankle mobility', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', {
    load: 'timed', easier: ['calf-stretch'], harder: ['deep-squat-hold'],
    aliases: ['knee to wall', 'ankle rocks'], uses: ['warm-up'], hotel: true,
    guide: ['Foot a hand-length from the wall.', 'Push the knee toward the wall with the heel down; move the foot back as it gets easier.', 'The heel lifting off the floor.'],
  }),
  x('thoracic-extension', 'Thoracic extension over a bench or roller', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', {
    load: 'timed', easier: ['cat-cow'],
    aliases: ['foam roller thoracic extension', 'upper back extension over a roller'], risk: ['demand:floor'], uses: ['warm-up', 'posture', 'desk-break'], hotel: true,
    guide: ['A roller or bench edge under the upper back, hands supporting the head.', 'Arch gently over it, then move it up a few centimetres and repeat.', 'Arching from the lower back.'],
  }),
  x('chest-doorway-stretch', 'Doorway chest stretch', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', {
    load: 'timed', easier: ['cross-body-shoulder-stretch'],
    aliases: ['doorway pec stretch'], uses: ['cool-down', 'posture', 'desk-break'], hotel: true,
    guide: ['Forearm on the door frame, elbow at shoulder height.', 'Step through until the chest stretches, the shoulder down and back.', 'Pushing into a sharp or tingling stretch.'],
  }),
  x('lat-stretch', 'Kneeling lat stretch', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', {
    load: 'timed', easier: ['childs-pose'],
    aliases: ['bench lat stretch'], risk: ['joint:kneeling'], uses: ['cool-down', 'posture'], hotel: true,
    guide: ['Kneel, elbows on a bench, hands together.', 'Sit the hips back toward the heels and let the chest sink.', 'Bouncing to force the stretch.'],
  }),
  x('hip-flexor-stretch', 'Half-kneeling hip-flexor stretch', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', {
    load: 'timed', harder: ['lunge-rotation-reach', 'couch-stretch'],
    aliases: ['kneeling hip flexor stretch'], risk: ['joint:kneeling'], uses: ['cool-down', 'desk-break'], hotel: true,
    guide: ['Half kneeling, the back knee on a cushion.', 'Tuck the pelvis and squeeze the back glute, then shift forward a little, staying tall.', 'Arching the lower back to go further.'],
  }),
  x('cat-cow', 'Cat-cow (on hands and knees)', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', {
    load: BW, harder: ['thoracic-extension'],
    aliases: ['cat camel'], risk: ['joint:wrist-extension', 'joint:kneeling', 'demand:floor'], uses: ['warm-up'], hotel: true,
    guide: ['On hands and knees.', 'Round the back up slowly, then let it sag, one segment at a time, breathing with the movement.', 'Rushing through the range.'],
  }),
  x('lunge-rotation-reach', 'Lunge with rotation and reach', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', {
    load: BW, easier: ['hip-flexor-stretch', 'leg-swings'],
    aliases: ['world\'s greatest stretch', 'lunge with twist', 'spiderman lunge with reach'], risk: ['demand:floor'], uses: ['warm-up'], hotel: true,
    guide: ['Long lunge, the back knee down if needed.', 'Bring the inside elbow toward the front instep, then turn and reach the same arm to the ceiling.', 'The front knee caving in.'],
  }),
  x('open-book', 'Open book (side-lying chest rotation)', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', {
    load: BW, harder: ['seated-thoracic-rotation'],
    aliases: ['side lying thoracic rotation', 'book opener'], risk: ['demand:floor'], uses: ['warm-up', 'posture', 'cool-down'], hotel: true,
    guide: ['Lie on your side, knees bent and stacked, arms together in front.', 'Open the top arm across to the other side, eyes following the hand, then return.', 'The knees coming apart as you turn.'],
  }),
  x('seated-thoracic-rotation', 'Seated upper-back rotation', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', {
    load: BW, easier: ['open-book'],
    aliases: ['seated twist', 'chair rotation'], uses: ['desk-break', 'posture'], hotel: true,
    guide: ['Sit tall, arms crossed on the chest.', 'Turn the ribs while the knees stay still, breathing out at the end of the turn.', 'Twisting from the neck alone.'],
  }),
  x('hip-90-90', 'Hip 90-90 switch', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', {
    load: BW, easier: ['figure-four-stretch'], harder: ['deep-squat-hold'],
    aliases: ['90 90 hip switch', '90 90 stretch'], risk: ['demand:floor'], uses: ['warm-up'], hotel: true,
    guide: ['Sit with both knees bent to 90 degrees, one in front, hands behind for support.', 'Rotate the knees to the other side, then back.', 'Forcing the knees down.'],
  }),
  x('deep-squat-hold', 'Deep squat hold', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', {
    load: 'timed', easier: ['ankle-mobility', 'hip-90-90'],
    aliases: ['squat hold', 'resting squat'], risk: ['joint:hip-deep-flexion', 'joint:knee-deep-flexion'], uses: ['warm-up'], hotel: true,
    guide: ['Hold a door frame or post.', 'Sit between the feet with the heels down, breathing and letting the hips sink.', 'The heels lifting.'],
  }),
  x('hamstring-stretch', 'Standing hamstring stretch (heel on a step)', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', {
    load: 'timed', harder: ['inchworm'],
    uses: ['cool-down'], hotel: true,
    guide: ['Heel on a low step, knee nearly straight.', 'Hinge forward with a long back until you feel a gentle stretch.', 'Rounding the back to reach further; ease off if it tingles.'],
  }),
  x('couch-stretch', 'Couch stretch (rear foot up a wall or sofa)', 'mobility', ['bodyweight'], [], [], 'low', 'intermediate', {
    load: 'timed', easier: ['hip-flexor-stretch', 'quad-stretch'],
    aliases: ['rear foot elevated hip flexor stretch'], risk: ['joint:kneeling'], uses: ['cool-down'], hotel: true,
    guide: ['Back knee on a cushion, shin up the wall or sofa.', 'Squeeze the glute on that side, and stay tall.', 'Leaning forward, or arching the back.'],
  }),
  x('figure-four-stretch', 'Figure-four glute stretch', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', {
    load: 'timed', harder: ['hip-90-90'],
    aliases: ['figure 4 stretch', 'seated glute stretch'], uses: ['cool-down', 'desk-break'], hotel: true,
    guide: ['Ankle across the other knee, sitting or lying.', 'Lean the chest forward (lying, pull the leg in) and breathe slowly.', 'Pressing hard on the crossed knee.'],
  }),
  x('childs-pose', 'Child\'s pose (kneeling rest stretch)', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', {
    load: 'timed', harder: ['lat-stretch'],
    aliases: ['child pose', 'kneeling back stretch'], risk: ['joint:kneeling', 'demand:floor'], uses: ['cool-down'], hotel: true,
    guide: ['Knees wide, sit back toward the heels.', 'Reach the arms long in front, and breathe into the back.', 'Forcing the hips down.'],
  }),
  x('calf-stretch', 'Wall calf stretch', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', {
    load: 'timed', harder: ['ankle-mobility'],
    aliases: ['standing calf stretch'], uses: ['cool-down', 'desk-break'], hotel: true,
    guide: ['Hands on the wall, one foot back.', 'Back heel down, knee straight; bend the back knee to stretch lower down.', 'The back heel lifting.'],
  }),
  x('quad-stretch', 'Standing quad stretch', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', {
    load: 'timed', harder: ['couch-stretch'],
    aliases: ['quadriceps stretch'], uses: ['cool-down'], hotel: true,
    guide: ['Hold a wall; use a towel if you cannot reach the foot.', 'Pull one heel toward the glute, knees together and hips forward.', 'Arching the back.'],
  }),
  x('band-pass-through', 'Band pass-through (arms over and back)', 'mobility', ['band'], [], [], 'low', 'beginner', {
    load: BW, easier: ['arm-circles'], harder: ['wall-slide'],
    aliases: ['shoulder dislocate', 'stick pass through', 'towel pass through'], uses: ['warm-up', 'posture'], hotel: true,
    guide: ['Wide grip on a light band or towel.', 'Lift the arms over the head and behind, then back; widen the grip if the elbows bend.', 'Bending the elbows to force it.'],
  }),
  x('cross-body-shoulder-stretch', 'Cross-body shoulder stretch', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', {
    load: 'timed', harder: ['chest-doorway-stretch'],
    aliases: ['cross arm stretch', 'posterior shoulder stretch'], uses: ['cool-down', 'desk-break'], hotel: true,
    guide: ['Bring one arm across the chest.', 'Hold it above the elbow with the other hand, the shoulder down.', 'Pulling on the elbow joint itself.'],
  }),
  x('neck-side-stretch', 'Neck side stretch', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', {
    load: 'timed', harder: ['chin-tuck'],
    aliases: ['upper trap stretch', 'neck stretch'], uses: ['desk-break', 'cool-down'], hotel: true,
    guide: ['Sit tall, shoulders down.', 'Ear toward the shoulder, a gentle hand on the head; breathe and switch sides.', 'Pulling the head.'],
  }),
  x('wrist-mobility', 'Wrist warm-up (circles and rocks on the hands)', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', {
    load: BW, harder: ['incline-plank'],
    aliases: ['wrist circles', 'wrist rocks', 'wrist prep'], risk: ['joint:wrist-extension'], uses: ['warm-up', 'desk-break'], hotel: true,
    guide: ['On hands and knees, or standing.', 'Circle the wrists both ways, then rock gently forward and back on the hands; try the fingers pointing back too.', 'Rocking into sharp pain.'],
  }),
  x('leg-swings', 'Leg swings (front to back and side to side)', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', {
    load: BW, harder: ['lunge-rotation-reach'],
    aliases: ['leg swing'], uses: ['warm-up'], hotel: true,
    guide: ['Hold a wall and stand tall.', 'Swing one leg loosely front to back, then side to side, building the range: ten each way, each leg.', 'Forcing the range on the first swings.'],
  }),
  x('arm-circles', 'Arm circles', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', {
    load: BW, harder: ['band-pass-through'],
    aliases: ['shoulder circles'], uses: ['warm-up', 'desk-break'], hotel: true,
    guide: ['Stand tall, ribs down.', 'Small circles first, then bigger, in both directions.', 'Arching the back as the circles grow.'],
  }),
  x('inchworm', 'Inchworm (walk the hands out to a plank)', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', {
    load: BW, easier: ['hamstring-stretch'],
    aliases: ['walkout', 'hand walkout'], risk: ['joint:wrist-extension', 'demand:floor'], uses: ['warm-up'], hotel: true,
    guide: ['Stand tall, then fold forward and put the hands down; bend the knees if needed.', 'Walk the hands out to a plank, then walk the feet back up to the hands.', 'The hips sagging in the plank.'],
  }),
  x('breathing-90-90', 'Feet-on-wall breathing (lying, knees and hips at 90 degrees)', 'mobility', ['bodyweight'], [], [], 'low', 'beginner', {
    load: 'timed', harder: ['dead-bug'],
    aliases: ['90 90 breathing', 'crocodile breathing', 'diaphragmatic breathing'], risk: ['demand:floor', 'demand:supine'], uses: ['cool-down', 'posture'], hotel: true,
    guide: ['Lie on your back, feet on a wall, knees and hips bent to 90 degrees.', 'Breathe in through the nose into the sides of the ribs, then a long, slow breath out.', 'Arching the lower back as you breathe in.'],
  }),

  // calisthenics skills
  // Holds and balances bias no region (the wall handstand neither); the
  // handstand steps, the L-sits and the shrimp squat are tagged as the entry
  // plans used to name them by, as in the squats above.
  x('wall-handstand', 'Chest-to-wall handstand hold', 'skill', ['bodyweight'], ['shoulders'], ['triceps', 'abs'], 'low', 'intermediate', {
    load: 'timed', easier: ['pike-push-up', 'wall-walk', 'box-pike-hold'], harder: ['wall-handstand-push-up', 'handstand-kick-up'],
    aliases: ['chest to wall handstand', 'chest to wall balance', 'wall handstand hold'], risk: ['joint:shoulder-overhead', 'joint:wrist-extension', 'demand:inversion'], hotel: true,
    guide: ['Walk up facing the wall, chest close to it.', 'Arms locked, push tall through the shoulders, and hold.', 'Holding on until you tire; walk down first.'],
  }),
  x('tuck-l-sit', 'Tuck L-sit', 'skill', ['bodyweight'], ['abs'], ['triceps'], 'low', 'intermediate', {
    load: 'timed', easier: ['hollow-hold', 'foot-supported-l-sit'], harder: ['one-leg-l-sit'],
    aliases: ['tucked l sit'], risk: ['joint:wrist-extension'], hotel: true,
    guide: ['Hands on blocks, bars or the floor.', 'Press down, lift the hips and tuck the knees, shoulders pushed down.', 'Shrugging the shoulders up to the ears.'],
  }),
  x('ring-support-hold', 'Ring support hold', 'skill', ['rings'], ['triceps', 'chest'], ['shoulders', 'abs'], 'low', 'beginner', {
    load: 'timed', harder: ['ring-dip'],
    aliases: ['ring support', 'top of dip hold on rings'],
    guide: ['Arms locked, rings by the hips.', 'Turn the hands out a little and hold still, building to 30 seconds.', 'The rings drifting wide, or the elbows bending.'],
  }),
  x('pistol-squat', 'Pistol squat', 'skill', ['bodyweight'], ['quads', 'glutes'], ['abs'], 'low', 'advanced', {
    uni: true, load: BW, easier: ['box-pistol'], regions: ['quads-vasti'],
    aliases: ['pistol'], risk: ['joint:hip-deep-flexion', 'joint:knee-deep-flexion', 'demand:balance'],
    guide: ['Stand on one leg, the free leg reaching forward; a light weight held in front helps balance.', 'Sit all the way down under control, then stand.', 'Collapsing into the bottom, or the knee caving in.'],
  }),
  x('box-pike-hold', 'Pike hold on a box (feet up, hips over the hands)', 'skill', ['bodyweight'], ['shoulders'], ['triceps', 'abs'], 'low', 'intermediate', {
    load: 'timed', easier: ['pike-push-up'], harder: ['wall-walk', 'wall-handstand'],
    aliases: ['pike hold on a bench', 'elevated pike hold'], risk: ['joint:shoulder-overhead', 'joint:wrist-extension', 'demand:inversion'], hotel: true,
    guide: ['Feet on a sofa or box, walk the hands in.', 'Stack the hips over the shoulders and push tall through straight arms.', 'The hips drifting back behind the hands.'],
  }),
  x('wall-walk', 'Wall walk (walk the feet up the wall)', 'skill', ['bodyweight'], ['shoulders'], ['triceps', 'abs'], 'low', 'intermediate', {
    load: BW, easier: ['box-pike-hold'], harder: ['wall-handstand'],
    aliases: ['wall climb'], risk: ['joint:shoulder-overhead', 'joint:wrist-extension', 'demand:inversion'], hotel: true,
    guide: ['Start in a push-up with the feet at the wall.', 'Walk the feet up and the hands in, a little at a time, then walk back down the same way.', 'Dropping down at the end instead of walking.'],
  }),
  x('handstand-kick-up', 'Handstand kick-up and bail', 'skill', ['bodyweight'], ['shoulders'], ['triceps', 'abs'], 'low', 'intermediate', {
    load: BW, easier: ['wall-handstand'], harder: ['freestanding-handstand'],
    aliases: ['kick up and bail', 'kick up to handstand'], risk: ['joint:shoulder-overhead', 'joint:wrist-extension', 'demand:inversion'],
    guide: ['Clear space all around; learn the bail first: turn a hand and step out.', 'Kick up softly, aiming to stack, not to fly.', 'Kicking hard enough to go over.'],
  }),
  x('freestanding-handstand', 'Freestanding handstand', 'skill', ['bodyweight'], ['shoulders'], ['triceps', 'abs'], 'low', 'advanced', {
    load: 'timed', easier: ['handstand-kick-up'],
    aliases: ['free handstand', 'freestanding handstand hold'], risk: ['joint:shoulder-overhead', 'joint:wrist-extension', 'demand:inversion'],
    guide: ['Clear space, wrists warmed up.', 'Push the floor away, shoulders open, and balance with the fingers and palms; short, frequent practice.', 'Long sessions that tire the wrists.'],
  }),
  x('crow-pose', 'Crow pose (knees resting on the arms)', 'skill', ['bodyweight'], ['shoulders', 'abs'], ['triceps', 'forearms'], 'low', 'intermediate', {
    load: 'timed', easier: ['bear-plank'], harder: ['planche-lean'],
    aliases: ['crow'], risk: ['joint:wrist-extension', 'demand:balance'], hotel: true,
    guide: ['A cushion in front of the face, hands down shoulder width.', 'Knees on the backs of the upper arms, lean forward until the feet float.', 'Leaning forward faster than you can control.'],
  }),
  x('planche-lean', 'Planche lean', 'skill', ['bodyweight'], ['shoulders', 'chest'], ['abs', 'triceps'], 'low', 'intermediate', {
    load: 'timed', easier: ['push-up', 'crow-pose'], harder: ['tuck-planche'],
    aliases: ['pseudo planche lean'], risk: ['joint:wrist-extension', 'demand:floor'], hotel: true,
    guide: ['High plank, fingers turned out a little.', 'Lean the shoulders forward past the hands, arms straight and the upper back rounded.', 'Bending the elbows.'],
  }),
  x('tuck-planche', 'Tuck planche', 'skill', ['bodyweight'], ['shoulders', 'chest'], ['abs', 'triceps'], 'low', 'advanced', {
    load: 'timed', easier: ['planche-lean'],
    aliases: ['tucked planche'], risk: ['joint:wrist-extension'],
    guide: ['Hands on parallettes or the floor.', 'Lean until the feet lift with the knees tucked; hold a few seconds, and build sets.', 'Bending the elbows.'],
  }),
  x('foot-supported-l-sit', 'Foot-supported L-sit (heels on the floor)', 'skill', ['bodyweight'], ['abs'], ['triceps'], 'low', 'beginner', {
    load: 'timed', easier: ['plank'], harder: ['tuck-l-sit'],
    aliases: ['supported l sit', 'l sit heels down'], risk: ['joint:wrist-extension', 'demand:floor'], hotel: true,
    guide: ['Hands on blocks or the floor beside the hips.', 'Press down and lift the hips, heels staying down, shoulders pushed away from the ears.', 'Shrugging the shoulders up.'],
  }),
  x('one-leg-l-sit', 'One-leg L-sit', 'skill', ['bodyweight'], ['abs'], ['triceps'], 'low', 'intermediate', {
    load: 'timed', easier: ['tuck-l-sit'], harder: ['l-sit'],
    aliases: ['single leg l sit'], risk: ['joint:wrist-extension'], hotel: true,
    guide: ['Hands on blocks or bars, one leg tucked, the other straight.', 'Press down to lift, and hold with the toes of the straight leg pointed; switch legs each set.', 'Shrugging the shoulders up.'],
  }),
  x('l-sit', 'L-sit', 'skill', ['bodyweight'], ['abs'], ['triceps'], 'low', 'advanced', {
    load: 'timed', easier: ['one-leg-l-sit'],
    aliases: ['l sit hold', 'full l sit'], risk: ['joint:wrist-extension'],
    guide: ['Hands on bars, blocks or the floor.', 'Push down hard, and hold the legs straight and level with the hips.', 'Shrugging the shoulders up.'],
  }),
  x('parallel-bar-support-hold', 'Support hold on bars (top of the dip)', 'skill', ['parallel-bars'], ['triceps', 'chest'], ['shoulders', 'abs'], 'low', 'beginner', {
    load: 'timed', easier: ['bench-dip'], harder: ['negative-dip'],
    aliases: ['dip support hold', 'straight arm support'],
    guide: ['Arms locked on the bars, shoulders pushed down.', 'Hold still, legs together, building to 30 seconds before dips.', 'Sinking into the shoulders.'],
  }),
  x('tuck-front-lever', 'Tuck front lever', 'skill', ['pull-up-bar'], ['lats', 'abs'], ['upper-back', 'forearms'], 'moderate', 'advanced', {
    load: 'timed', easier: ['feet-elevated-ring-row', 'hollow-hold', 'pull-up'], harder: ['front-lever'],
    aliases: ['tucked front lever'], risk: ['joint:shoulder-hang', 'joint:grip-heavy'],
    guide: ['Hang from the bar, arms straight.', 'Pull the bar toward the hips with the knees tucked to the chest and the back level; short holds, quality over time.', 'Bending the arms to hold the shape.'],
  }),
  x('front-lever', 'Front lever', 'skill', ['pull-up-bar'], ['lats', 'abs'], ['upper-back', 'forearms', 'lower-back'], 'high', 'advanced', {
    load: 'timed', easier: ['tuck-front-lever'],
    aliases: ['full front lever'], risk: ['joint:shoulder-hang', 'joint:grip-heavy'],
    guide: ['Hang from the bar, arms locked; build through the tuck and straddle shapes first.', 'Hold the body straight and level, face up, shoulders pulled down.', 'Bending the arms or the hips.'],
  }),
  x('skin-the-cat', 'Skin the cat (rings or bar)', 'skill', ['rings'], ['lats', 'shoulders'], ['abs', 'biceps'], 'low', 'intermediate', {
    load: BW, easier: ['dead-hang'],
    aliases: ['skin the cat to german hang'], risk: ['joint:shoulder-hang', 'joint:shoulder-extension', 'joint:grip-heavy', 'demand:inversion'],
    guide: ['Hang from rings or a bar.', 'Tuck the knees and turn slowly upside down and through, only as far as the shoulders allow, then come back the same way.', 'Dropping into the bottom of the turn.'],
  }),
  x('bar-muscle-up', 'Bar muscle-up', 'skill', ['pull-up-bar'], ['lats', 'triceps'], ['chest', 'shoulders', 'biceps'], 'low', 'advanced', {
    load: BW, easier: ['chest-to-bar-pull-up', 'parallel-bar-dip'],
    aliases: ['muscle up'], risk: ['joint:shoulder-hang', 'joint:shoulder-extension', 'joint:grip-heavy'],
    guide: ['Grip just wider than the shoulders.', 'Pull high and fast toward the hips, lean the chest over the bar, then press out to straight arms.', 'Kipping wildly before the pull is strong enough.'],
  }),
  x('ring-muscle-up', 'Ring muscle-up', 'skill', ['rings'], ['lats', 'triceps'], ['chest', 'shoulders', 'biceps'], 'low', 'advanced', {
    load: BW, easier: ['ring-dip', 'chest-to-bar-pull-up'],
    risk: ['joint:shoulder-hang', 'joint:shoulder-extension', 'joint:grip-heavy'],
    guide: ['False grip: wrists over the rings.', 'Pull the rings to the chest, then turn over and press out to a ring support.', 'Losing the false grip as you pull.'],
  }),
  x('shrimp-squat', 'Shrimp squat (rear foot held behind)', 'skill', ['bodyweight'], ['quads', 'glutes'], ['abs'], 'low', 'advanced', {
    uni: true, load: BW, easier: ['box-pistol', 'assisted-pistol'], regions: ['quads-vasti'],
    aliases: ['shrimp', 'airborne lunge'], risk: ['joint:knee-deep-flexion', 'joint:kneeling', 'demand:balance'],
    guide: ['Stand on one leg holding the back foot behind you, a cushion under the knee.', 'Lower the back knee to the cushion, front heel down, leaning forward to balance, then stand.', 'The front heel lifting.'],
  }),
];

export const CATALOGUE_BY_ID: ReadonlyMap<string, CatalogueEntry> = new Map(CATALOGUE.map((e) => [e.id, e]));

/**
 * The starter movements: the 100 the catalogue held before the exercise
 * library joined it. The plan generator (an optional baseline; the coach
 * designs from the whole catalogue) and the Hotel version's automatic swaps
 * choose from these, so their output stays as it was: their rankings were
 * tuned on this set. A link from one of them to a newer movement is skipped
 * there, as it is not among the candidates.
 */
export const STARTER_IDS: ReadonlySet<string> = new Set([
  'box-squat', 'bodyweight-squat', 'heel-elevated-goblet-squat', 'goblet-squat', 'tempo-goblet-squat', 'back-squat', 'leg-press', 'leg-extension', 'box-pistol',
  'glute-bridge', 'single-leg-glute-bridge', 'hip-thrust', 'db-rdl', 'single-leg-rdl', 'rdl', 'deadlift', 'back-extension', 'seated-leg-curl', 'lying-leg-curl', 'slider-leg-curl',
  'split-squat', 'db-split-squat', 'bulgarian-split-squat', 'reverse-lunge', 'step-up', 'banded-side-walk', 'single-leg-stance', 'hip-abduction-machine',
  'incline-push-up', 'push-up', 'ring-push-up', 'ring-dip', 'db-bench', 'incline-db-press', 'bench-press', 'machine-chest-press', 'pec-deck',
  'inverted-row', 'ring-row', 'band-row', 'db-row', 'chest-supported-db-row', 'barbell-row', 'seated-cable-row', 'machine-row',
  'pike-push-up', 'db-shoulder-press', 'overhead-press', 'landmine-press', 'machine-shoulder-press',
  'band-pulldown', 'lat-pulldown', 'dead-hang', 'scapular-pull-up', 'negative-pull-up', 'assisted-pull-up', 'pull-up',
  'farmer-carry', 'suitcase-carry', 'dead-bug', 'plank', 'hollow-hold', 'bird-dog', 'side-plank', 'pallof-press', 'reverse-crunch', 'hanging-knee-raise',
  'calf-raise', 'machine-calf-raise', 'seated-calf-raise', 'db-curl', 'cable-pushdown', 'overhead-db-extension', 'cable-overhead-triceps-extension', 'bench-dip',
  'face-pull', 'band-pull-apart', 'reverse-db-fly', 'prone-t-raise', 'reverse-pec-deck', 'band-lateral-raise', 'db-lateral-raise', 'cable-lateral-raise',
  'chin-tuck', 'wall-slide', 'db-shrug', 'brisk-walk', 'easy-run', 'zone2-bike', 'bike-intervals-4x4', 'hill-intervals-4x4',
  'ankle-mobility', 'thoracic-extension', 'chest-doorway-stretch', 'lat-stretch', 'hip-flexor-stretch', 'wall-handstand', 'tuck-l-sit', 'ring-support-hold', 'pistol-squat',
]);

export const STARTER_CATALOGUE: readonly CatalogueEntry[] = CATALOGUE.filter((e) => STARTER_IDS.has(e.id));
