# The exercise library

The engine's catalogue holds 244 movements: the 100 of the starter catalogue
and 144 from the exercise library, with every easier and harder option linked
both ways and guide text for each. All of it is in one place,
`src/core/data/exercises.ts`, and `engine catalogue` lists it for the coach.
The tests hold the rules on this page (`test/exercises.test.ts`,
`test/catalogue-tags.test.ts`), so a change that breaks one fails there.

| File | What |
|---|---|
| `src/core/data/exercises.ts` | The movements, the vocabulary (patterns, equipment, levels, demand tags, uses) and the starter set |
| `src/core/data/ladders.ts` | The four ladders the self-check starts, and the catalogue's 20 ladders |
| `src/adapters/vault/catalogue-match.ts` | Names to movements: names, ids, aliases, then synonyms for a nearby movement |
| `src/report/catalogue.ts` | `engine catalogue`: the search, its display order and the ladders |

## Method

1. **Start from the engine.** The library extended the engine's catalogue
   entry. Every existing id kept its engine fields (name, pattern, equipment,
   muscles, abdominal-strain tag, side, level, load, regions); its easier and
   harder lists only grew. A library entry for a movement the engine already
   had merged into it (the seated dumbbell calf raise into the seated calf
   raise, which now takes a dumbbell as a stand-in).
2. **Use the engine's vocabulary.** Patterns, equipment, levels and muscle ids
   are the engine's lists. The library added one pattern (`jump`) and seven
   tools (`parallel-bars`, `trap-bar`, `sled`, `jump-rope`, `stability-ball`,
   `ab-wheel`, `pool`), each with its words for a profile ("dip station",
   "hex bar", "swiss ball").
3. **Fill the gaps a wide population hits.** Older adults and new exercisers
   (supported squats, wall push-ups, balance work, step-ups on a stair),
   home training with only dumbbells, a kettlebell or bands, hotel rooms, gym
   machines, the calisthenics ladders, warm-ups, cool-downs, desk breaks, and
   the common cardio modes.
4. **Order the options by mechanics.** An easier option shortens the lever,
   widens or supports the base, shortens the range, takes load away or adds
   stability; a harder one does the reverse, or slows the tempo. Where
   numbers exist they set the order: for push-ups, hands on a high box load
   about 41 % of body mass, knees down about 49 %, a standard push-up about
   64 % and feet raised up to 74 % (Ebben et al. 2011). A progressive push-up
   ladder builds pressing strength (Kotarsky et al. 2018), which is the case
   for bodyweight ladders as real strength training.
5. **Tag muscles by the evidence.** Main muscles are the prime movers,
   helping muscles the meaningful synergists; when unsure, the helping list
   stays short. The 0.26 audit holds for every entry (below).
6. **Tag demands, not conditions.** The demand tags say what a movement asks
   of the body (weight on bent-back wrists, hanging, lying on the back,
   jumping). They never name an injury or a diagnosis, in line with the
   engine's wellness wording ("describe, never name a cause").
7. **Write everything new.** Every name, alias, cue and line of guide text is
   written for this project. Nothing is copied or adapted from a website,
   book or dataset (see "Licences").

## The shape

Every entry has every field (an empty list where there is nothing to say).

| Field | Meaning |
|---|---|
| `id` | Lowercase with dashes. Never changes once published: logs, plans and tests use it. |
| `name` | The display name. A parenthesis adds a hint and is ignored when matching names. |
| `aliases` | Other common names for the same movement, matched as its name is. Only true aliases: a nearest-but-different movement is a synonym in `catalogue-match.ts` instead. |
| `pattern` | The engine's slot pattern. |
| `equipment` | Everything needed; the first item is the defining tool. `bodyweight` needs nothing. |
| `alsoWith` | Tools that can stand in for the defining tool with no change to the movement (a kettlebell for a goblet squat, a band for a cable face pull). `engine catalogue --equipment` counts them. |
| `muscles` | `{main, helps}`, engine muscle ids. `main` counts a full set, `helps` half. Mobility and conditioning carry none, so they are never counted as sets. |
| `iap` | The abdominal-strain tag (`low`, `moderate`, `high`) the Ledger screens on. |
| `unilateral` | Works one side at a time (one leg, or one hand loaded). |
| `level` | `beginner`, `intermediate` or `advanced`: the training age it suits. |
| `load` | `external`, `bodyweight`, `timed` or `cardio`: logged as weight and reps, reps, seconds or minutes. |
| `easier`, `harder` | Ids of easier and harder options, nearest first; the starter entries keep their own links first. |
| `regions` | The muscle regions it biases (`data/regions.ts`), left out when it biases none. |
| `longLength` | The two-joint muscles or regions it loads long, where a training study compared versions. |
| `risk` | Demand tags (`MOVEMENT_TAGS`): what it asks of the body. Information only: nothing screens on them yet. |
| `uses` | Roles beyond the pattern: `warm-up`, `cool-down`, `posture`, `balance`, `desk-break`. |
| `hotel` | Fits a hotel room (the rule below). |
| `guide` | `{setup, do, avoid}`: the setup, the movement and the mistake to avoid, written from the library's coaching cues, the three a plan's guide entry has. |

**Equipment conventions.** Furniture that only supports the body (a chair, a
stair, a bed, a counter, a wall, a door frame, a towel on a smooth floor)
counts as `bodyweight`, as the inverted row under a sturdy table always has.
`bench` means a weight bench or a sturdy box that takes a load or a landing.
A landmine is a `barbell` in a corner, a curl bar is a `barbell`, `rings`
covers suspension trainers, and `machine` covers every gym machine including
cardio machines. Band versions of free-weight lifts (curl, lateral raise,
press) are their own entries, because a band's resistance rises through the
rep; band versions of cable lifts use `alsoWith`, because a band anchored at
the cable's height gives the same line of pull.

**Abdominal-strain tags** follow the engine's choices: heavy barbell lifts,
the hack squat and the longest-lever core work are `high`; dumbbell and
kettlebell compounds, swings, crunches and leg raises are `moderate`;
machines, isolation work, holds, mobility and easy cardio are `low`. Squats,
deadlifts and the leg press produce the highest pressures in lifting (Blazek
et al. 2019), and a jump produced more abdominal pressure than a cough in
healthy adults (Cobb et al. 2005), so the big jumps and burpees are `high`
and small hops `moderate`. These are judgements and want a review.

**The hotel rule.** `hotel` is true when the movement needs nothing beyond
the travel kit (bodyweight, dumbbells, a band; an `alsoWith` tool counts),
room furniture or a stairwell, is not advanced, and is quiet enough for a
room (no repeated jumping). Walks and runs from the hotel door count. Set
false by hand: the inverted row (hotel furniture is rarely safe to hang
under), Nordic curls (need an anchor), swings (space, a weight that can fly),
the handstand kick-up (needs room to bail). A test holds the equipment and
level half of the rule.

## Muscles and regions

The 0.26 evidence audit holds for every entry, and `test/catalogue-tags.test.ts`
checks it:

- **No hamstrings on squats, the leg press, bridges or hip thrusts**, nor on
  the jumps that land in a squat: training studies find little or no
  hamstring growth from them (Kubo 2019, Plotkin 2023). The lunges keep the
  hamstrings (no training data either way); the lateral lunge and the
  cossack squat, which sit to the side as a squat does, do not.
- **The adductors help the loaded deep squats and the leg press** (the back,
  goblet, front and double-kettlebell front squats, the hack squat), and
  nothing unloaded or part-range.
- **The forearms help every row and every loaded hinge** (the Romanian
  deadlifts and deadlifts, the kettlebell's deadlift, swings and clean, the
  trap bar deadlift), pull-ups, chin-ups and the holds around them, and the
  dumbbell shrug: the grip holds the load every rep (a heuristic).
- **A name that was a synonym keeps its tags.** Sixteen names a plan may use
  were synonyms of a nearby entry until the catalogue had the movement itself
  (a chin-up was read as a pull-up, a walking lunge as the reverse lunge, an
  L-sit as the tuck L-sit, the handstand steps as the wall handstand). They
  now match their own entry, tagged as the one they were read as, so a
  plan's sets per muscle do not move.

Every movement that biases a modelled region carries it, by its family:
squats and lunges driven by the quads the vasti; presses the front delts
(incline presses the upper chest too, overhead presses the side delts too);
rows the mid-back; hinges the hamstrings at the hip and curls at the knee;
standing calf raises the gastrocnemius and soleus. Flies, holds and
balances bias none, as the pec deck and the wall handstand do.

## Coverage

244 entries: 164 beginner, 61 intermediate, 19 advanced; 138 hotel-friendly;
33 one side at a time; 412 aliases.

| Pattern | Beginner | Intermediate | Advanced | Total | Hotel |
|---|---:|---:|---:|---:|---:|
| squat | 10 | 5 | 0 | 15 | 9 |
| hinge | 15 | 8 | 1 | 24 | 10 |
| lunge (single-leg and balance) | 11 | 3 | 0 | 14 | 12 |
| horizontal-push | 12 | 4 | 3 | 19 | 7 |
| horizontal-pull | 9 | 3 | 0 | 12 | 4 |
| vertical-push | 6 | 3 | 1 | 10 | 5 |
| vertical-pull | 9 | 2 | 2 | 13 | 2 |
| carry | 4 | 1 | 0 | 5 | 4 |
| core-anti-extension | 5 | 4 | 2 | 11 | 7 |
| core-anti-rotation | 5 | 3 | 0 | 8 | 8 |
| core-flexion | 3 | 3 | 1 | 7 | 3 |
| calves (and shins) | 5 | 1 | 0 | 6 | 5 |
| biceps | 4 | 1 | 0 | 5 | 3 |
| triceps | 5 | 2 | 0 | 7 | 4 |
| rear-delt | 7 | 0 | 0 | 7 | 6 |
| lateral-raise | 3 | 0 | 0 | 3 | 2 |
| neck-upper-back | 5 | 0 | 0 | 5 | 5 |
| hip-abduction | 2 | 0 | 0 | 2 | 1 |
| chest-fly | 3 | 0 | 0 | 3 | 0 |
| jump | 2 | 3 | 0 | 5 | 0 |
| conditioning | 12 | 5 | 0 | 17 | 8 |
| mobility | 24 | 1 | 0 | 25 | 25 |
| skill | 3 | 9 | 9 | 21 | 8 |

| Tool | Defining tool of | Usable with (incl. `alsoWith` and second items) |
|---|---:|---:|
| bodyweight (incl. furniture) | 112 | 112 |
| dumbbell | 34 | 40 |
| kettlebell | 7 | 30 |
| barbell | 12 | 14 |
| trap bar | 1 | 3 |
| machine (incl. cardio machines) | 23 | 23 |
| cable | 11 | 12 |
| band | 10 | 18 |
| bench | 3 | 18 |
| pull-up bar | 14 | 14 |
| rings or suspension trainer | 7 | 7 |
| parallel bars | 3 | 3 |
| stability ball, ab wheel, sled, jump rope, pool | 7 | 7 |

The patterns follow common coaching taxonomies (squat, hinge, lunge, push and
pull in two planes, carry, and the trunk's anti-movement families). Two
placements are the engine's and are kept: side planks and one-hand carries
sit in the anti-rotation and carry slots, although most taxonomies call them
anti-lateral-flexion; and `lunge` holds single-leg and balance work. Chops
and the Turkish get-up go in anti-rotation (rotary stability). Leg curls stay
in `hinge` and leg extensions in `squat`, as the engine has them; flies are
`chest-fly` and the side-lying leg raise `hip-abduction`, the isolation
patterns 0.26 added.

Left out on purpose: the upright row and behind-the-neck presses (both raise
the arm into positions linked to shoulder pain in lifters; Kolber et al.
2010, Schoenfeld et al. 2011), sit-ups, good mornings, the Olympic lifts and
medicine-ball work. Each has a safer or simpler entry that covers its job.

## How regressions and progressions chain

- **Two-way.** If B is in A's `harder`, A is in B's `easier`.
- **Never a circle.** Following `harder` links never returns to the start.
- **Levels go the right way.** An easier option is never at a higher level
  and a harder one never at a lower level. The one exception is the
  engine's own link from the tempo goblet squat (intermediate) to the back
  squat (beginner), kept as it was (open question 2).
- **Related.** Linked entries share the pattern or a muscle, unless one side
  is a mobility drill leading into the movement it prepares (wrist warm-up to
  an incline plank).
- **Always a way down.** Every entry has at least one link, and every entry
  above beginner has an easier option. The tops of ladders (a one-arm
  push-up, a front lever, the barbell lifts) have no harder entry: they
  progress by load, reps or tempo through the engine's progression rules.
- **For isolation lifts** "easier" means lighter, more stable or more
  forgiving (a band curl), and "harder" a longer stretch or less support (the
  incline curl). A machine curl is another tool beside the slider curl,
  neither its step down nor its next step.

The catalogue's 20 ladders (`CATALOGUE_LADDERS`) name chains a coach can show
as steps; each step lists the next as harder. `engine catalogue` gives them
beside the self-check's four (`source: "catalogue"`), each level the catalogue
movement it is. Unlike the four, they are not logged by level.

| Ladder | Steps |
|---|---|
| Push-up | wall, incline, knees, floor, decline, archer, one-arm |
| Pull-up | dead hang, scapular pull-up, flexed-arm hang, negative, chin-up, pull-up, weighted |
| Muscle-up | pull-up, chest-to-bar, bar muscle-up |
| Bodyweight row | door frame, inverted, ring row, feet-elevated ring row, tuck front lever, front lever |
| Dip | bench dip, bar support hold, negative dip, bar dip, ring dip |
| Single-leg squat | supported squat, bodyweight squat, assisted pistol, box pistol, pistol |
| Handstand | pike push-up, pike hold on a box, wall walk, chest-to-wall handstand, kick-up, freestanding |
| Handstand push-up | pike push-up, elevated pike push-up, wall handstand push-up |
| L-sit | foot-supported, tuck, one-leg, full |
| Planche | push-up, planche lean, tuck planche |
| Hollow body | dead bug, tuck hollow, hollow hold |
| Plank to rollout | incline plank, plank, ball rollout, kneeling ab wheel, standing ab wheel |
| Side plank | from the knees, full, Copenhagen |
| Hinge to deadlift | hinge drill, kettlebell deadlift, dumbbell RDL, barbell RDL, deadlift |
| Kettlebell ballistics | deadlift, two-hand swing, one-arm swing, clean |
| Hamstring curl | ball curl, slider curl, Nordic lowering, Nordic curl |
| Balance | tandem stance, heel-to-toe walk, single-leg stance |
| Loaded squat | box squat, goblet squat, back squat |
| Jump and land | snap-down, squat jump, box jump, skater bound |
| Walk to run | brisk walk, run-walk, easy run, hill intervals |

The balance ladder follows the falls-prevention evidence: balance and
functional exercise lowers the rate of falls in people over 60 by about a
quarter (Sherrington et al. 2019).

## Names

A plan's name for a movement matches an entry by its name, its id or one of
its aliases; a synonym (`NAME_SYNONYMS`) reaches the nearest entry that
trains the same muscles when the catalogue has no entry of its own (a tempo
push-up as the push-up, a cable curl as the dumbbell curl). A synonym is read
first, so a test holds that none is another entry's own name or alias: a
movement the catalogue has answers to its own name. No two entries share a
name, an id or an alias.

## Demand tags

| Tag | The movement asks for | Entries |
|---|---|---:|
| `joint:neck-loaded` | Load through the head or neck | 2 |
| `joint:shoulder-overhead` | Arms working above the head under load | 30 |
| `joint:shoulder-hang` | Body weight hanging from the hands | 17 |
| `joint:shoulder-extension` | The upper arm far behind the body under load | 8 |
| `joint:wrist-extension` | Body weight on bent-back wrists | 37 |
| `joint:grip-heavy` | Heavy or long gripping (also loads elbows and forearms) | 23 |
| `joint:spine-axial` | A heavy load on the shoulders or overhead | 4 |
| `joint:spine-flexion` | Repeated or loaded curling of the spine | 3 |
| `joint:spine-extension` | The lower back arching against load | 2 |
| `joint:spine-rotation` | The trunk turning against resistance | 1 |
| `joint:back-bent-over` | Holding a load with the torso tipped forward, unsupported | 13 |
| `joint:hip-deep-flexion` | A deep hip bend under load | 13 |
| `joint:knee-deep-flexion` | The knee well past a right angle under load | 14 |
| `joint:kneeling` | Weight on a knee | 15 |
| `demand:impact` | Jumping, hopping, running or landing | 10 |
| `demand:inversion` | Head below the hips or heart | 9 |
| `demand:vigorous` | About 6 METs or more for most adults | 10 |
| `demand:floor` | Getting down to the floor and back up | 44 |
| `demand:balance` | A real balance challenge without support | 12 |
| `demand:supine` | Lying on the back for the set | 21 |
| `demand:prone` | Lying face down for the set | 4 |

A tag is a demand to weigh, not a ban. Deep squats, for example, do not
appear to raise the risk to the passive tissues of healthy knees (Hartmann et
al. 2013): the knee tag exists for the person who reports that deep bending
hurts. Tags do not predict injury either; even a full movement screen's score
does not (Moran et al. 2017).

`engine catalogue` lists each movement's tags with their meanings
(`vocabulary.risk`); nothing screens on them yet. Wiring them in, once a
physiotherapist has reviewed them (open question 4), would take:

1. **The Ledger.** `LedgerConstraint.noTags` takes `RiskTag` values, which
   already allow `joint:<name>`, and `screenExercise` blocks any exercise
   whose `risk` holds a ruled-out tag. The missing step is `toExercise`
   copying the entry's tags next to its `abdomen-*` tag, and `RiskTag` taking
   `demand:<name>`.
2. **Check-in aches to tags.** A check-in's `jointAches[].area` would map to
   the tags for that area (wrist: `wrist-extension`; elbow: `grip-heavy`;
   shoulder: `shoulder-overhead`, `shoulder-hang`, `shoulder-extension`;
   neck: `neck-loaded`; lower back: `back-bent-over`, `spine-axial`,
   `spine-flexion`; hip: `hip-deep-flexion`; knee: `knee-deep-flexion`,
   `kneeling`, `impact`), a temporary Ledger constraint with swaps from the
   catalogue. Pain over 5/10 or getting worse stays a red flag that stops and
   refers; a tag swap never replaces that.
3. **Screening outcomes.** `demand:vigorous` could replace `conditioning.ts`'s
   test for "interval" in an id, which would wrongly let an easy run through.
4. **Age 65 and over, new exercisers.** `uses: balance` gives a pool for the
   balance work every session; `demand:floor` and `demand:balance` let a
   choice prefer standing, supported options for someone who finds the floor
   or one-leg standing hard (Giangregorio et al. 2014). Getting up from the
   floor is worth training on purpose, so the floor tag should rank, not
   exclude.
5. **Pregnancy and postpartum** stay blocked until cleared, then
   Conservative, as now. The supine, prone, impact, inversion and balance
   tags are there for a clinician-reviewed rule, not for the engine to invent
   one.

## What reads the library

- **`engine catalogue`** lists all 244 with every field and filters them by
  pattern, region, muscle, equipment (a stand-in tool counts), level and
  text; `engine evidence --topic regions` and the plan check's region options
  draw on all of them, leaving out what a confirmed finding rules out (the
  findings' lists name the new overhead presses, loaded hinges and hard
  single-leg moves too).
- **Plan names** match all of them (names, ids, aliases), so their tags count
  in every screen and number.
- **The plan generator and the Hotel version's swaps** choose from the 100
  starter movements (`STARTER_IDS`): their rankings were tuned on that set,
  and their output stays as it was. The generator is an optional baseline;
  the coach designs from the whole catalogue.
- **Not read yet:** the demand tags (above), `alsoWith` outside the
  catalogue search (the plan builder, the Log panel and the Hotel version
  check the listed equipment), `hotel` (the Hotel version checks the travel
  kit) and `uses`.

## Licences

Nothing in the catalogue comes from a dataset. Only licence files, READMEs,
issue threads and licence metadata were read; no exercise text was opened for
reuse.

| Source | Licence | Could it be used, and on what terms |
|---|---|---|
| free-exercise-db (yuhonas) | The Unlicense (public-domain dedication) for the repository | The text and JSON are dedicated to the public domain, so they could legally be reused, but the project is a reworking of wrkout/exercises.json and the origin of its descriptions is not documented. **Do not use the images**: the maintainer says he does not know where they came from, and users report matches with commercial sites (issues #2 and #13). Safest use: a checklist of exercise names to spot gaps, since bare names are not protected text. |
| wrkout/exercises.json | The Unlicense | The same data upstream. Its contributing guide says the images were scraped from the internet and advises against using them commercially; a reverse image search in issue #305 points to a commercial site. Same advice as above. |
| wger | Code: AGPL-3.0-or-later. Exercise data: Creative Commons per entry. Documentation: CC-BY-SA-4.0. | wger's licence list holds CC-BY-SA 3, CC-BY 4, CC-BY-SA 4, CC0 and ODbL. In the first 200 exercises from its API, 118 were CC-BY-SA 3, 64 CC-BY-SA 4 and 18 CC0. CC0 entries could be reused freely. CC-BY and CC-BY-SA entries need attribution, and share-alike requires adapted text to carry the same licence, which does not suit a product that may be sold unless that part is released openly. Images carry their own per-image licences. The AGPL code should not be mixed into the plugin. |
| react-native-body-highlighter | MIT | Already used for the body map (engine README, third-party notice). Unaffected. |

Exercise names themselves ("goblet squat", "Pallof press") are ordinary
vocabulary and are used freely; where a common name is a coined label
("world's greatest stretch") it appears only as an alias, under a
descriptive name of our own. This is a practical reading, not legal advice;
a review before a paid release is worth it, including whether EU database
rights affect anyone copying a dataset wholesale (nothing here was copied).
The catalogue is marked "intended CC0"; whether the whole library is
released the same way is open question 6.

## Open questions

1. **Cardio machines** share `machine` with the leg press, so someone who
   owns a rower would be offered gym machines. Split out `bike`, `rower`,
   `treadmill` and so on?
2. **Tempo goblet squat** is intermediate while its harder option, the back
   squat, is beginner. Make the tempo squat beginner, or the back squat
   intermediate?
3. **Hotel gyms** often have a bench, a treadmill or a bike, which the travel
   kit leaves out. Add a `hotelGym` flag, or widen the kit? And should the
   Hotel version read `hotel` and choose from the whole catalogue? Its
   ranking (the variation furthest along its progression first) picks a
   renegade row for a barbell row once every link is in, so it needs a
   better tie-break first.
4. **Clinical review.** The demand tags, the abdominal-strain judgements for
   jumps and levers, and the area-to-tag mapping should be reviewed by a
   physiotherapist before they gate anything. Who signs off the rule that
   reads `demand:supine` and the other tags in pregnancy?
5. **Mobility targets.** Mobility entries carry no muscles, so the coach
   cannot pick "a stretch for tight hips" from data. Add a `targets` field
   that is never counted as volume? The check-in's `JointAche.area` is free
   text too; a fixed list of areas would make the mapping above exact.
6. **The licence of this library.** The starter catalogue is "intended CC0".
   Release the full library the same way, or keep it under the product's
   licence because it may be sold?
7. **Guide text in the plugin.** The movement guide shows a plan's own guide
   entries; it could fall back to the catalogue's for a movement whose entry
   has no text. In which languages?

## Sources

Exercise science:

- Ebben WP, Wurm B, VanderZanden TL et al. Kinetic analysis of several
  variations of push-ups. J Strength Cond Res 2011;25(10):2891-2894. Also in
  the ISBS proceedings: https://ojs.ub.uni-konstanz.de/cpa/article/view/4457
- Kotarsky CJ, Christensen BK, Miller JS, Hackney KJ. Effect of progressive
  calisthenic push-up training on muscle strength and thickness. J Strength
  Cond Res 2018;32(3):651-659. https://pubmed.ncbi.nlm.nih.gov/29466268/
- Kubo 2019 and Plotkin 2023, the 0.26 tag audit's sources, as the engine
  cites them (`data/evidence.ts`): https://doi.org/10.1007/s00421-019-04181-y
  and https://doi.org/10.3389/fphys.2023.1279170
- Blazek D, Stastny P, Maszczyk A et al. Systematic review of intra-abdominal
  and intrathoracic pressures initiated by the Valsalva manoeuvre during
  high-intensity resistance exercises. Biol Sport 2019;36(4):373-386.
  https://doaj.org/article/95188fd23ce340ca9179dcdf129de1d3
- Hackett DA, Chow CM. The Valsalva maneuver: its effect on intra-abdominal
  pressure and safety issues during resistance exercise. J Strength Cond Res
  2013. https://pubmed.ncbi.nlm.nih.gov/23222073/
- Cobb WS, Burns JM, Kercher KW et al. Normal intraabdominal pressure in
  healthy adults. J Surg Res 2005;129:231-235.
  https://pubmed.ncbi.nlm.nih.gov/16140336
- Hartmann H, Wirth K, Klusemann M. Analysis of the load on the knee joint and
  vertebral column with changes in squatting depth and weight load. Sports Med
  2013;43(10):993-1008. https://pubmed.ncbi.nlm.nih.gov/23821469/
- Kolber MJ, Beekhuizen KS, Cheng MS, Hellman MA. Shoulder injuries
  attributed to resistance training: a brief review. J Strength Cond Res
  2010;24(6):1696-1704. https://nsuworks.nova.edu/hpd_pt_facarticles/179/
- Schoenfeld BJ, Kolber MJ, Haimes JE. The upright row: implications for
  preventing subacromial impingement. Strength Cond J 2011;33(5):25-28.
- Behm DG, Blazevich AJ, Kay AD, McHugh M. Acute effects of muscle stretching
  on physical performance, range of motion, and injury incidence in healthy
  active individuals: a systematic review. Appl Physiol Nutr Metab
  2016;41(1):1-11. https://nectar.northampton.ac.uk/id/eprint/8154/ (why
  warm-ups here are dynamic and static stretches sit in the cool-down or stay
  short)
- Sherrington C, Fairhall NJ, Wallbank GK et al. Exercise for preventing falls
  in older people living in the community. Cochrane Database Syst Rev 2019;
  CD012424. https://pmc.ncbi.nlm.nih.gov/articles/PMC6944800
- Giangregorio LM, Papaioannou A, Macintyre NJ et al. Too Fit To Fracture:
  exercise recommendations for individuals with osteoporosis or osteoporotic
  vertebral fracture. Osteoporos Int 2014;25(3):821-835.
  https://experts.mcmaster.ca/scholarly-works/180760
- Watson SL, Weeks BK, Weis LJ et al. High-intensity resistance and impact
  training improves bone mineral density and physical function in
  postmenopausal women with osteopenia and osteoporosis: the LIFTMOR trial.
  J Bone Miner Res 2018;33(2):211-220.
  https://academic.oup.com/jbmr/article/33/2/211/7605709 (why the library
  keeps jumps and heavy lifting available rather than tagging them away)
- Riebe D, Franklin BA, Thompson PD et al. Updating ACSM's recommendations for
  exercise preparticipation health screening. Med Sci Sports Exerc
  2015;47(11):2473-2479. https://digitalcommons.uri.edu/kinesiology_facpubs/180
- ACOG Committee Opinion No. 804: Physical activity and exercise during
  pregnancy and the postpartum period. Obstet Gynecol 2020;135(4):e178-e188.
  https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2020/04/physical-activity-and-exercise-during-pregnancy-and-the-postpartum-period
- Moran RW, Schneiders AG, Mason J, Sullivan SJ. Do Functional Movement Screen
  (FMS) composite scores predict subsequent injury? A systematic review with
  meta-analysis. Br J Sports Med 2017;51(23):1661-1669.
  https://bjsm.bmj.com/content/51/23/1661
- Bull FC, Al-Ansari SS, Biddle S et al. World Health Organization 2020
  guidelines on physical activity and sedentary behaviour. Br J Sports Med
  2020;54:1451-1462. https://bjsm.bmj.com/content/54/24/1451 (the 6 MET line
  for vigorous effort)
- Science for Sport. Basic movement patterns.
  https://www.scienceforsport.com/basic-movement-patterns/

Licences:

- free-exercise-db: https://github.com/yuhonas/free-exercise-db (licence and
  README), issues https://github.com/yuhonas/free-exercise-db/issues/2 and
  https://github.com/yuhonas/free-exercise-db/issues/13
- wrkout/exercises.json: https://github.com/wrkout/exercises.json (licence,
  README, CONTRIBUTING), issue https://github.com/wrkout/exercises.json/issues/305
- wger: https://github.com/wger-project/wger (README, "License"), licence list
  https://wger.de/api/v2/license/ and exercise metadata
  https://wger.de/api/v2/exerciseinfo/
