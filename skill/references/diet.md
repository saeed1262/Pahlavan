# Diet: the eating plan

For "diet", "meal plan", "what should I eat", "protein", or a weight trend out
of its band. Output: `<fitness>/Coach/Eating plan.md` and its
machine-readable twin `Coach/eating-plan.json` (formats in `formats.md`),
which Pahlavan's Food tab draws (section 9). The daily signal is Pahlavan's protein item (one tick with
the day's gram target, in `Coach/tracking.json`), linked to the
Protein habit so its ticks land in the habit check-ins file
(`hab-protein-<ISO year>-W<week>-<0=Mon>`), where the check-in counts them.
How the item is added and kept on target: `tracking.md` (Protein, and "The
tracking file").

**Scope: general wellness.** Food for training, energy and general health.
Never a diet to treat or manage a condition, never a diagnosis, no promises
about any health marker. **(H)** marks a heuristic.

## 1. Screen first (one round, before any numbers)

1. **Eating history** (own wording, informed by the SCOFF questions, Morgan
   1999): "Have you ever had a hard time with food or eating: strict dieting
   you couldn't stop, bingeing, making yourself sick, or worry about food or
   weight that took over? Or been treated for an eating disorder?" No / Yes,
   in the past / Yes, now / Prefer not to say.
   **Any answer but No** → **no counting**: the Light level without calorie
   or weight-loss targets, no rate band, no weigh-in emphasis, and the
   referral: "A doctor or a registered dietitian is the right person to set
   food targets with you; I'll keep to training and general eating habits."
   (In Canada, [NEDIC](https://nedic.ca/) has a helpline.)
2. **Medical diets:** "Has a clinician given you a diet, or is food part of
   managing a condition (cholesterol or other blood lipids, blood sugar,
   blood pressure, kidneys, digestion, a food allergy), or are you pregnant or
   breastfeeding?" No / Yes, a clinician manages it / Only a borderline
   result at a check-up, nothing prescribed / Pregnant or breastfeeding.
   **Managed by a clinician, or pregnant or breastfeeding** → the general
   pattern (section 5) and protein only; targets for that condition go to the
   clinician or a registered dietitian. **Only a borderline result** (a lipid
   or blood-sugar number flagged, nothing prescribed) → the general
   heart-healthy pattern, framed as general health; the number and what to
   do about it stay the clinician's, and never a target "to lower
   cholesterol". Ask this every time: an earlier answer, form or cycle is
   never assumed to still hold.
3. Under 18: not coached on food.

Record the outcome and date in the eating plan; re-ask when health changes.

## 2. The level (like tracking levels)

| Level | The user does | The coach sets |
|---|---|---|
| **Light** | No counting: hand portions, protein at each meal, meal templates | Portions per meal, protein per meal in palms; portions steered by the weight trend |
| **Standard** | Counts protein and calories (labels or an app) | Calories a day, protein a day |
| **Full** | Counts all macros | Calories, protein, fat, carbs, fiber |

Ask the level, never assume it (section 8, step 3): "How much do you want
to count: nothing (hand portions and meal templates), protein and calories,
or every macro?" **Light is the default and the first option; never push a
higher level.** A user who picks a higher level can drop back at any
review. Pahlavan's Food tab names the Light level "Hand portions" (the
training plan's light weeks are something else); say it the same way.

## 3. The numbers (code: `engine energy`)

`engine energy --pal <factor>` computes them, carbs apart (`numbers.md`,
"The eating plan's numbers: `energy`"): the activity factor is the coach's
pick from the table below, the rest comes from the profile, the trend
weight, the goal (or `--rate`) and the meals a day. Quote each figure with
its note.

| Number | Rule | Source |
|---|---|---|
| Protein a day | By goal, per kg of trend weight (the engine's tiers, `engine review` `weight.protein`): lifting goals 1.6–2.2 g; health-only or endurance goals 1.2–1.6 g **(H)** for the edges; in an energy deficit the upper half of the tier (1.9–2.2, or 1.4–1.6); at 65+ never under 1.0–1.2 (1.2 when training), which both tiers meet. The protein item is ticked at the range's floor | [Morton 2018](https://bjsm.bmj.com/content/52/6/376), [Schoenfeld & Aragon 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC5828430/), [Jäger 2017](https://doi.org/10.1186/s12970-017-0177-8), [Thomas 2016](https://doi.org/10.1016/j.jand.2015.12.006), [Bauer 2013](https://doi.org/10.1016/j.jamda.2013.05.021) |
| Protein a meal | About 0.4 g/kg (up to 0.55) a meal; with 3 meals, add a protein snack or shake to reach the day's target | [Schoenfeld & Aragon 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC5828430/) |
| Resting energy | Mifflin-St Jeor: 10 × kg + 6.25 × cm − 5 × age + 5 (men) or − 161 (women) | [Mifflin 1990](https://pubmed.ncbi.nlm.nih.gov/2305711/) |
| Its accuracy | Within ±10% for most people, not all: a starting point only | [Frankenfield 2005](https://pubmed.ncbi.nlm.nih.gov/15883556/) |
| Activity factor | × 1.40–1.69 sedentary or light, 1.70–1.99 active, 2.00–2.39 vigorous; a desk job plus 4 sessions a week ≈ 1.5–1.6 **(H)** | [FAO/WHO/UNU 2004](https://www.fao.org/3/y5686e/y5686e00.htm) |
| Goal energy | Loss: the deficit for the goal's rate band (about 7,700 kcal per kg, a rough rule **(H)**); recomposition: maintenance to −250 kcal **(H)**; gain: +200–300 kcal **(H)** | `rules.md` bands |
| Fat | At least 20% of energy | [Thomas 2016](https://doi.org/10.1016/j.jand.2015.12.006) |
| Carbs | The rest (Full level) | |
| Fiber | 25–29 g a day or more (about 14 g per 1,000 kcal) | [Reynolds 2019](https://doi.org/10.1016/S0140-6736(18)31809-9) |

**Safety floors (never crossed):**
- Never below about **1,500 kcal a day for men, 1,200 for women** without a
  clinician (the low end of the
  [AHA/ACC/TOS 2013](https://acc.org/Latest-in-Cardiology/Journal-Scans/2014/07/10/16/17/2013-AHA-ACC-TOS-Guideline-for-the-Management-of-Overweight)
  ranges); if the band needs less, slow the rate instead (`energy`'s
  `floor`: the floor applied, and the rate it gives).
- Never a very-low-calorie plan (about 800 kcal a day or less is a medically
  supervised diet, [NIDDK](https://www.niddk.nih.gov/Dictionary/V/very-low-calorie-diet)).
- Never a loss rate beyond **1% of body weight a week** (`energy` refuses a
  faster `--rate`).
- No meal skipping or fasting protocols as a prescription.

## 4. Adjusting from the trend

- The starting estimate is a guess; the **weight-trend slope** (`numbers.md`,
  14–28 days) against the goal's band (`rules.md`) is the truth. Recomposition
  is judged by waist (tape) and e1RM trends as well.
- **Out of band for two weekly readings** → one step, then wait **2–3 weeks**
  before the next (no step more often):
  - Light: one portion a day (a cupped hand of carbs or a thumb of fats),
    never protein or vegetables.
  - Standard / Full: 100–200 kcal a day, from carbs or fats; protein stays.
- Losing faster than 1% a week → a step up, even inside a loss goal (protect
  strength). Recomposition: waist flat 4 weeks and the trend not falling → a
  step down (protein first on the plate, a slightly smaller carb portion).
- Creatine started recently: expect 1–2 kg of water on the scale in the first
  weeks; don't step down for it.
- Every step is a Decision entry (trigger, data, rule, expected effect, review
  date 2–3 weeks out).

**The plan's own rule is computed by the engine:** `engine food`'s `adjust`
(rule `diet.adjust`) reads the plan's `adjust` block, the tape and the
weight trend from the cycle start. It gives no change, or the step with its
reason, and the next check date: quote its note, never redo it. The first
check is the plan's review date, once that day's tape is in; after it, each
tape day. Flat is within ±0.5 cm (`flatCm`, the tape's half-centimetre step)
over the rule's 4 weeks of tape; creatine's water takes no step in its first
4 weeks (from the tracked creatine item's start, or `adjust.creatineFrom`).
A step taken is recorded in `adjust.applied` (`{date, step: less | back}`)
and the changed portion in `portions` (and the meal's text): the rule then
waits the low end of `waitWeeks` (2 weeks) and reads its weeks of tape from
the step on.

## 5. The general pattern (everyone, every level)

Heart-healthy eating in wellness terms, from the
[AHA 2021 dietary guidance](https://www.acc.org/latest-in-cardiology/ten-points-to-remember/2021/11/23/19/45/2021-dietary-guidance-to-improve)
(general health, not treatment):
- Plenty of vegetables and fruit, in variety (fresh, frozen or canned).
- Mostly whole grains; legumes several times a week.
- Protein from legumes, nuts, fish (2+ meals a week), poultry, lean or
  low-fat dairy; processed meat rarely.
- Liquid plant oils (olive, canola) over butter and tropical oils.
- Minimally processed food over ultra-processed; little added sugar; little
  added salt.
- Alcohol: none is needed. Ask, once and without judgment: "Do you drink
  alcohol, and about how many drinks in a normal week?" None: leave it out
  of the plan. Some: no change unless the user wants one; as general
  information, less is better for health and for recovery from training
  ([Canada's Guidance on Alcohol and Health, 2023](https://www.ccsa.ca/canadas-guidance-alcohol-and-health)),
  and the eating plan notes the answer.

## 6. Light level: hand portions and templates

**Per meal** (a starting point, adjusted by size, hunger and the trend;
[Precision Nutrition hand-portion guide](https://assets.precisionnutrition.com/2020/06/Handout-Hand-portion-guide.pdf)):

| Food | Measure | Men | Women |
|---|---|---|---|
| Protein | Palm (about 20–30 g protein) | 2 | 1 |
| Vegetables | Fist | 2 | 1 |
| Carbs | Cupped hand | 1–2 | 1 |
| Fats | Thumb | 2 | 1 |

Check the palms against the protein-per-meal number from code (2 palms ≈
40–60 g); add a protein snack or shake when 3 meals fall short.

**Templates for home cooking, 3 meals a day, about 1 hour of prep every
other day.** Ask what the user usually cooks first and adapt these to it.

- **Prep block (every other day, about 1 h):** one protein in bulk (chicken
  thighs or breast, lean ground meat, a fish tray bake, lentils or beans, a
  dozen boiled eggs), one starch (rice, potatoes, whole-grain pasta, bulgur),
  one tray of roasted vegetables, plus raw vegetables washed. Two days of
  lunches boxed.
- **Breakfast (5 min):** Greek yogurt or skyr, or eggs, or a shake + oats or
  whole-grain bread + fruit.
- **Lunch (boxed):** 2 palms protein, 2 fists vegetables, 1–2 cupped hands
  starch, 1–2 thumbs fat (olive oil, nuts, avocado).
- **Dinner (the home-cooked meal):** the same plate, protein served first; a
  stew or rice dish gets an extra palm of protein or a side of yogurt, and a
  fist of salad or vegetables.
- **Protein top-up:** a shake, skyr or milk when the day is short.
- **Fiber:** vegetables at 2 meals, fruit twice a day, legumes 3 times a week,
  whole grains by default.

## 7. Supplements (the basics only)

- **Protein powder:** a convenient food for the protein target, not required;
  choose third-party tested products **(H)**.
- **Creatine monohydrate:** 3–5 g a day, any time
  ([Kreider 2017](https://pmc.ncbi.nlm.nih.gov/articles/PMC5469049/));
  well studied in healthy adults; with any kidney condition, ask a clinician
  first. Scale weight rises 1–2 kg early (water).
- **Anything else** (fat burners, boosters, high-dose vitamins): the coach
  doesn't recommend them; vitamins and the rest are the user's and their
  clinician's call.

## 8. The job

1. Read: the Athlete profile (goal, weight, age, height, sex), the weight
   trend and slope (`numbers.md`), protein habit ticks (4 weeks), an
   existing `Eating plan.md` from this cycle, and `engine food` for what its
   twin shows (the protein days, the trend against the plan, the
   adjustment rule's status). Never an old intake form
   (such as an `Intake Form.md`) or an earlier cycle's notes: what they said about
   counting, health results or drinking is asked again.
2. Screen (section 1). Stop at the referral if it applies.
3. Ask, at most 2 AskUserQuestion rounds: the level (Light first, the
   default); alcohol (section 5); what a normal day of eating and cooking
   looks like; foods liked and disliked; appetite and the hardest meal of
   the day; prep time and meals a day. Then the times, in plain text
   (SKILL.md house rule 15): "When do you usually eat each meal, and when
   do you train on a lifting day and on a short day?" (the wake, work and
   bed times too when the profile and `tracking.md`'s answers don't have them;
   what they drink in a day, the last coffee included, if not said). They
   set the Food tab's day (section 9).
4. Compute with `engine energy --pal <factor>` (section 3's table; `--meals`
   the meals a day they said; `--rate` only when the plan aims at a rate
   the goal doesn't give): maintenance, the goal energy (the goal's range
   from the Goal energy row, or one figure for `--rate`), the floor, protein
   a day and a meal with the top-up, fat and fiber. Its `proteinRange` is
   `engine review`'s `weight.protein` (its note is the reason to quote). At
   the Light level only protein and fiber are used (`light`). Never propose
   a `refused` rate (−0.01 or slower instead) or a target under the floor
   (the plan takes `floor`'s `targetKcal`, a slower rate).
5. Propose the plan in one message: the level, the daily targets (or
   portions), why this plan (each reason with its source), the day with
   each meal's time, the meal templates and their ideas, the protein
   top-up, fiber, the pattern, the tips, the adjustment rule and the first
   review date.
6. On yes: write `Coach/Eating plan.md` and `Coach/eating-plan.json`
   (section 9: through `engine eating`, a dry run, then `--write`, part of
   the same yes; never by hand), log the Decision; the check-in's protein
   question then asks at the plan's floor. Then the protein item,
   through the engine (`tracking.md`, "The tracking file"; a dry run, then
   `--write`): a new one with `track add` (a tick named Protein, `"habit":
   "protein"`, an evening card; its gram target comes from the engine), or
   `track protein` when the target moved. No item for an eating-disorder
   answer (no gram targets).

## 9. The plan as data (`eating-plan.json`)

Pahlavan's Food tab and `engine food` read `Coach/eating-plan.json`, the
Markdown's twin (fields in `formats.md`). Build it from the agreed plan:

- **The words are the plan's own:** the meals and their texts, the tags
  ("As now", "The hardest meal", "Top-up"), the fallbacks, the pattern's
  targets, the adjustment rule's steps, the reasons, the ideas and the
  tips, as Eating plan.md says them.
- **The Food tab's words** (all optional since Pahlavan 0.7.0, written in
  the same run): `goalLabel` (the goal in plain words) and `summary` (the
  approach in a sentence or two); `why`, three or so reasons, each with its
  `source` (`intake` for an intake fact, `said` for the user's own words,
  an `aside` for a line under it: "The numbers stay with your doctor");
  `day` from step 3's times (wake, work, bed, the session's time on a
  lifting and a short day, the drinks); each meal's `at`, `foods` (the
  food for each hand of its portions, by group id) and `ideas`, and a
  `trainingNote` where a lifting or short day changes it (a snack before
  the session); `today.optional`, one or two light checks, each named by a
  pattern line's id; `tips`, three or four, each with what it helps. Lunch
  and dinner keep their `text` and `portions`; the hardest meal is
  `fallbacks.meal`.
- **Meal ideas are chosen for the nutrition, not a theme:** each reaches
  its meal's rough protein (`proteinG`, from the palms) on the meal's hand
  portions, from what the user eats and cooks and never a food they leave
  out, and its `counts` names the pattern lines it serves, so a week of
  ideas meets the pattern (fish twice, legumes, red meat at most twice).
  Everyday dishes, no cuisine theme unless the user asks for one; about
  seven a meal, one a day for a week **(H)**.
- **The numbers come from code:** `basis`, `protein` (`floorG` the range's
  floor, `rangeG`, `gPerKg`, `perMealG`), `fiber` and `energy` from
  `engine energy`'s `eatingPlanFields`, as they are; `protein.reason` is its
  `proteinRange` reason (`engine review`'s `weight.protein`); each meal's
  rough protein (`proteinG`, `[lo, hi]`) from the template's palms.
- **`protein.item`** is the tracked Protein item's id, its floor equal to
  the item's goal (`track protein` or `track add` keeps them together).
- **The pattern:** one line per weekly or daily target, each with an `id`,
  `min` or `max` and `per` (`week` or `day`); the rest in `patternAlso`.
  Where the user eats red meat, its line is `red-meat` (lean lamb or beef,
  at most twice a week: `max: 2`), not one meat's name. The Sunday
  check-in asks it, a tap per line (`checkin.md`).
- **Eating plan.md keeps matching sections:** Why this plan, Meal ideas
  (per meal: its time, the Hands line, the ideas with what each counts
  for, the fallbacks under the hardest meal) and Tips (`formats.md`).
- **Check it:** `engine validate <file>`, then `engine food` (with the file
  in place after the write) to see what the Food tab will show: `words`
  (the goal, the summary and the reasons), `day` (the timeline: each
  meal, the session by the plan's rotation, the drinks) and `checks`.

```bash
node .claude/skills/fitness-coach/scripts/engine.cjs eating --vault . --json --file <plan.json>           # a dry run: result, changed, plan, warnings
node .claude/skills/fitness-coach/scripts/engine.cjs eating --vault . --json --file <plan.json> --write   # after the user's yes
node .claude/skills/fitness-coach/scripts/engine.cjs food --vault . --json [--date D]                     # what the Food tab shows
```

`eating` validates, merges the given parts into the file as it is (objects
key by key, lists and values replaced, `null` removes a key) or replaces it
with `--replace`, and reads it back; exit 1 writes nothing. **Every change
to the plan goes to both files in the same run:** a step of the adjustment
rule, a new review date, a meal, a portion. The Markdown is edited in place
with its History line; the JSON gets only the parts that change, with
`updated` set to the day (and the `history` line), through `engine eating`.
A list is replaced whole, so a change to one meal's ideas sends the whole
`meals` list, every meal with its fields.
