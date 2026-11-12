# Tracking: the daily habits the coach suggests

For the items Pahlavan tracks day to day, of six kinds: supplements (a dose),
amounts (water), ticks, stand-ups, sitting time and desk breaks. Nothing is
fixed: Pahlavan ships with no items, the coach proposes them from the intake
and the plan, each with a one-line Why, and the user accepts or dismisses
each one. This file says which items to suggest, to whom, with what numbers,
how to word the Why, when to revisit, and what stops a suggestion. (Not the
tracking level of `intake.md` Round 4: that is how much of each session gets
logged.)

**Scope: general wellness.** Habits for training, recovery and everyday
health. Never a treatment, never a diagnosis, no promises about a health
marker. Supplements are optional extras: the coach never sells one, names a
brand, links a shop, or brings one up again after a dismissal.

## Evidence grades

Every suggestion below carries one. Say it in the proposal when it is Weak
or (H), as `rules.md` does for heuristics.

| Grade | Means |
|---|---|
| **Strong** | Several good trials agree, or a guideline or position stand built on them |
| **Moderate** | Some trials, consistent cohort studies, or short-term measures (blood sugar after a meal, not disease) |
| **Weak** | Few or small trials, mixed results, or association only |
| **(H)** | A sensible default with no direct evidence |

## The rules

1. **Propose, the user decides.** Pahlavan shows each suggestion as an
   accept or dismiss chip with its Why. A dismissed item is logged as
   declined and not proposed again without new data (SKILL.md house rule 3).
   Each batch of suggestions gets one Decisions entry (`formats.md`): trigger,
   data, the items and their rules, expected effect, review date (the next
   mesocycle review).
2. **Few at a time (H).** At most 3 suggestions at intake, at most 1 new
   item at a check-in, and about 6 coach items active at once. New habits
   took a median of 66 days to become automatic, with a wide spread (Lally
   2010), and they form by repeating one action in one context (Gardner
   2012); a long list dilutes all of them.
3. **Tie each to a cue.** A slot next to something the user already does:
   creatine with breakfast, a glass of water at each stand-up, lights out
   after brushing teeth. If-then plans work (`rules.md`, adherence).
4. **Numbers from code** (SKILL.md house rule 1). Protein comes from the
   engine's range by goal (`engine review` `weight.protein`, the eating
   plan's target); water from the snippet below; stand-ups and sitting from the
   presets here (read off, no arithmetic); adherence from Pahlavan's stats or
   the engine. Never a number from memory.
5. **Food first, nothing sold.** Where food covers the need (protein, fish,
   nuts and greens for magnesium), say so first. A supplement's Why starts
   with "Optional." When the user asks how to choose a product: the studied
   form, third-party tested **(H)**. No brands.
6. **Screen first.** The safety screen below runs before any supplement or
   target, every time health changes.
7. **Wellness wording.** No fear, no disease, no "fix your posture", no
   body-shape talk. The user's own items ("Added by you") are theirs: the
   coach doesn't edit or remove them and comments only on safety (an upper
   limit, a medicine to check with a pharmacist).

## When the coach proposes

- **Intake:** after the profile is written, before offering `plan`: up to 3
  items from the intake answers (the router below).
- **Plan:** desk breaks (from the plan), and schedule changes that follow
  the week (an item on training days only).
- **Diet:** the protein item, with the eating plan.
- **Check-ins and reviews:** at most one new item, when the data shows a need
  (sleep under 7 h three weeks running, say), plus the revisit rules below.

**The proposal:** one message with a short table (item, kind, numbers,
schedule and slot, Why, grade), then one multi-select AskUserQuestion to
accept. Nothing is added before the yes. Then one write through the engine
("The tracking file" below): the accepted items with `add`, the others with
`decline`; or, when the user would rather decide in Pahlavan, all of them
with `suggest`.

## What to ask

Most answers are already in the profile (goals, training days, sex, age,
weight, screening, the Body assessment, the Ledger) and the eating plan (diet
pattern, the eating screen). Ask what's missing in one AskUserQuestion round
(at most 4 questions), at the intake's end or the first time an item needs it:

1. "On a work day, how many hours are you at a computer?" Under 4 / 4–6 /
   6–8 / More than 8. Other: "my job is on my feet".
2. "Do you have a standing or sit-stand desk?" Yes / No / I don't work at a
   desk.
3. "How long do you sleep on a normal night, and when do you wake?" (free
   text, e.g. "6.5 h, 6:30").
4. "Do you take any supplements or regular medicines?" No / Supplements
   (which?) / Medicines / Both. Medicines need no names: the answer only means
   "ask a pharmacist before any new supplement".

During the intake (a fresh start), sleep comes from this answer, not from old
body data. Later, the sleep numbers in `engine review` replace it.

## The safety screen

From screening Round 1 (`intake.md`), the eating screen (`diet.md`) and the
questions above. A flag removes or changes a suggestion; it never blocks the
user's own items.

| Flag | Effect |
|---|---|
| Under 18 | Not coached (`intake.md`) |
| Screening Blocked | No new suggestions; only what a clinician advises |
| Pregnant or breastfeeding | No supplement suggestions and no water target: their clinician's or midwife's. Ticks are fine |
| A kidney condition | No creatine, magnesium or water target; protein only from a clinician or renal dietitian |
| A heart or liver condition, a fluid limit from a clinician, or low blood sodium in the past | No water target |
| Eating-disorder history (any answer but No in `diet.md`) | No gram targets, no water target, no creatine **(H)**; ticks for sleep and the plan's routines only; `diet.md`'s referral |
| Regular medicines | Every supplement suggestion carries "ask a pharmacist first"; it starts after the user says it's checked **(H)** |
| Can't stand or walk easily | No stand-ups; desk breaks with seated moves **(H)** |

Each supplement suggestion also carries a short "skip it if" line, so the user
can screen privately for what the coach doesn't ask (bipolar disorder, kidney
stones, a condition that raises calcium).

**Referral wording** (own words, describe, never diagnose):
- Doctor: "That one's worth checking with your doctor first; I'll leave it off
  the list until you have."
- Pharmacist: "Since you take regular medicine, ask a pharmacist whether it
  goes with [item] before you start."
- Dietitian: `diet.md`'s wording.
- A red flag anywhere (`intake.md`) stops everything, as always.

## From the profile to the suggestions

| From the profile | Consider |
|---|---|
| Strength, muscle, recomposition or calisthenics goal, lifting 2+ days a week | Creatine; protein (the eating plan) |
| Fat loss with lifting | Protein, upper half of the range |
| Age 65+ | Protein (the eating plan); water (thirst fades with age) |
| 6+ h a day at a computer | Sitting time and stand-ups |
| 4–6 h at a computer | Stand-ups, the short-day preset |
| Desk work plus a posture emphasis, a desk ache in the Ledger, or the posture goal | Desk breaks (from the plan) |
| Sleep under 7 h, or bedtimes all over the place | Lights-out tick; a caffeine cut-off if caffeine comes after midday |
| Drinks little, long or hot sessions, an endurance goal | Water |
| Vegan | A word on B12; creatine (lower stores, larger effect) |
| Little winter sun at a high latitude, mostly indoors, skin mostly covered, 75+ | A word on vitamin D at the national amount |
| Already takes supplements | Track them as the user's own; the safety screen only |

**Order when more than 3 apply (H):** protein (once the eating plan exists),
then creatine, the sleep tick, stand-ups and sitting, desk breaks (offered
with the plan, as their own question), water. Strongest evidence and largest effect for the goal
first.

## Supplements

### Creatine: suggest when it fits

- **Who:** a strength, muscle, recomposition or calisthenics goal, lifting
  at least 2 days a week. It works for women and older adults too (Chilibeck
  2017). Vegetarians and vegans start with lower stores and tend to gain more
  (Kreider 2017). Not proposed for health-only or endurance-only goals
  without lifting **(H)**; fine if the user asks.
- **Numbers:** creatine monohydrate (the form studied), **3–5 g a day**,
  every day including rest days, any time; with a meal if the stomach
  complains. No loading by default: 3–5 g a day fills the stores in about 3–4
  weeks; a loading week (about 20 g a day in four doses for 5–7 days) fills
  them faster, with more stomach upset and a quicker jump on the scale
  (Kreider 2017). For a large body, 0.1 g per kg a day is the alternative
  (Antonio 2021). Schedule: every day; slot: a meal the user never skips.
- **Evidence:** strength and training performance with lifting, **Strong**
  (Kreider 2017); lean mass, **Moderate** (Chilibeck 2017); extra muscle
  size beyond training alone, small and **Weak** (Burke 2023). Safety at
  these doses in healthy adults, **Strong**: no kidney harm in trials
  (Kreider 2017; de Souza e Silva 2019), and no sign of hair loss (Antonio
  2021; Lak 2025, a 12-week trial in men).
- **Say with it:** 1–2 kg on the scale in the first weeks is water, not fat
  (`diet.md`: don't step down for it). Creatine raises blood creatinine, a
  kidney test marker: tell the doctor before a blood test (Antonio 2021).
- **Skip it if** (in the item's note): kidney disease or reduced kidney
  function; diabetes or high blood pressure without a doctor's okay **(H:
  kidney risk factors)**; pregnant or breastfeeding (not studied enough);
  bipolar disorder (in one small study both bipolar patients switched to
  mania, Roitman 2007); regular medicines (pharmacist first).
- **Why:** "Optional. You lift 4 days a week for strength: 5 g of creatine a
  day adds a little to every block (Kreider 2017)."
- **Revisit:** no cycling needed. Pause when lifting stops for 4 weeks or
  more **(H)**; stop and refer on a new kidney diagnosis, a pregnancy, or new
  medicines.

### Protein: the eating plan's daily target

- **One item** (the build brief, decision 3): the eating plan's daily gram
  target, ticked on days it's reached; the Sunday check-in counts those days.
  Food first; a shake is a convenience, not a requirement.
- **No eating plan yet:** offer the `diet` job instead of a number. Its
  screen (eating history, medical diets) runs first, and the target comes from
  `engine energy` (`numbers.md`, "The eating plan's numbers: `energy`").
- **The ranges behind it** (the engine's protein tiers, `engine review`
  `weight.protein`, each with its reason): lifting goals (any goal but health
  or conditioning) 1.6–2.2 g per kg of trend weight a day, **Strong** (Morton
  2018; the ISSN gives 1.4–2.0, Jäger 2017); health-only or endurance goals
  1.2–1.6, **Moderate** for the range (Thomas 2016 gives 1.2–2.0 for
  athletes), its edges **(H)**; in an energy deficit, the upper half of the
  tier (1.9–2.2, or 1.4–1.6), **Moderate** (Jäger 2017); 65+, at least
  1.0–1.2 and at least 1.2 when training, **Moderate** (Bauer 2013), which
  both tiers already meet. The item is ticked at the range's floor.
- **Light eating level:** the item keeps the gram target; its note gives the
  palms per meal from the eating plan, and the tick means the palms were met.
- **Schedule:** every day, with an evening reminder to tick it **(H)**.
- **Safety:** with kidney disease, no target from the coach: protein is
  limited there (KDIGO 2024: about 0.8 g/kg in later stages, and no more than
  1.3 g/kg when the disease may progress), so it goes to the doctor or a renal
  dietitian. In healthy kidneys, higher protein didn't change kidney function
  in trials, **Moderate** (Devries 2018). Eating-disorder history: no gram
  target (`diet.md`: no counting).
- **Why:** "Your eating plan's target: at least 150 g a day, 1.8 g/kg, to
  build on your training (Morton 2018)." Both numbers from the engine's
  range, as the eating plan states them.
- **The item:** a tick named Protein, linked to the Protein habit
  (`"habit": "protein"`) so the Sunday check-in counts its days; added
  without a `goal`, it takes the engine's target ("The tracking file").
- **Revisit:** when the eating plan changes (trend weight, goal). Adherence
  under 50% at a mesocycle review: ask about the hardest meal and use
  `diet.md`'s templates.

### A word, not a suggestion: vitamin D and B12

The coach mentions these when the trigger applies, quoting the public advice
where the user lives, and adds an item only if the user then wants to track
it. The dose is the national one, never the coach's own.

- **Vitamin D.** Triggers: little sun on the skin in autumn and winter at a
  high latitude, mostly indoors, skin mostly covered, darker skin at a high
  latitude, vegan, 75+. The advice: in the UK, consider 10 µg (400 IU) a day
  in autumn and winter (SACN 2016); in the US and Canada, 600 IU (15 µg) a
  day from food and supplements up to 70 and 800 IU (20 µg) after (IOM 2011).
  Never above that without a clinician, never above 4,000 IU (100 µg) a day.
  No testing advice: that's the doctor's call, and routine testing isn't
  advised for healthy adults (Demay 2024). Evidence: preventing low levels in
  people at risk, **Moderate**; strength, performance or disease prevention in
  people who already have enough, **Weak to none** (Manson 2019; Demay 2024).
  Skip it if: kidney disease, kidney stones, a condition that raises calcium,
  or regular medicines (doctor or pharmacist).
- **Vitamin B12.** Trigger: vegan, or mostly plant-based without fortified
  foods. Vegans need a reliable B12 source, fortified foods or a supplement,
  **Strong** (Melina 2016). The pharmacist suggests the dose; products differ
  a lot.

### Not suggested: track them if the user adds them

| Item | What the evidence says | If the user takes it |
|---|---|---|
| Omega-3 (fish oil) | Little or no effect on deaths or heart events, **Strong** (Abdelhamid 2020); soreness, strength, recovery, **Weak**; more atrial fibrillation in trials, more so above 1 g a day (Gencer 2021) | Track it. Food first: fish twice a week (`diet.md`). Blood thinners or a heart-rhythm condition: pharmacist or doctor |
| Magnesium | Sleep: three small trials, about 17 min faster to fall asleep, low certainty, **Weak** (Mah & Pitre 2021); cramps: no clear benefit (Garrison 2020) | Track it. Supplements at or under 350 mg a day (NIH ODS; some countries set lower); loose stools mean too much. Kidney disease: doctor first. Some antibiotics and bone medicines: pharmacist, for timing |
| Multivitamin | Not enough evidence for preventing heart disease or cancer; beta-carotene and vitamin E advised against for that (USPSTF 2022) | Track it. Several products together can pass an upper limit (vitamin D, iron): pharmacist |
| Anything else (fat burners, boosters, stimulant pre-workouts, high-dose vitamins) | Not recommended (`diet.md`) | Track it with no Why. A stimulant late in the day: the caffeine cut-off below |

## Amounts: water

- **Who:** the user says they drink little or forget at work; dark urine most
  days; sessions of 60 minutes or more, hot sessions, heavy sweating, an
  endurance goal; 65+ (thirst fades with age, Volkert 2019); or the user asks.
  Not as a fat-loss tool: the coach makes no weight claim for water.
- **Numbers** (the snippet): the reference is **2.0 L of drinks a day for
  men, 1.6 L for women**, 1.8 L when sex isn't given. These come from Europe's
  total water amounts (2.5 L and 2.0 L from all sources, about 80% from drinks;
  EFSA 2010, Volkert 2019). A large body raises it at about 25 mL per kg
  **(H)**. Training days add about 0.5 L per hour of training, 0.75 L in heat
  **(H)**, within ACSM's usual 0.4–0.8 L an hour (ACSM 2007). Pahlavan holds
  one daily target: use the base, and put the training-day amount in the note.
- **Quick amounts:** the user's own glass and bottle (often 250 and 500 mL).
- **Reminders (H):** every 2 hours in waking hours until the target is met,
  none in the last 2 hours before bed.
- **Adjust after two weeks (H):** pale straw urine most of the day and little
  thirst, keep; dark most days, +250 mL; forcing it, or up at night to pee,
  −250 mL or drink earlier in the day.
- **Evidence:** the reference amounts are what healthy people drink, not
  proven needs, **Moderate** (NASEM 2005: thirst guides most healthy people;
  Armstrong & Johnson 2018: needs change day to day). A daily target improving
  health in healthy adults, **Weak**. Losing over 2% of body weight in a
  session hurts endurance performance, **Moderate** (ACSM 2007).
- **Safety:** the screen's water flags (heart, kidney or liver condition, a
  fluid limit, low blood sodium, pregnancy or breastfeeding, eating-disorder
  history): no target from the coach. Never a target over 4 L a day, or one
  that needs more than about 1 L in an hour **(H)**. In long endurance events,
  drink to thirst; drinking far beyond it is the main cause of low blood sodium
  in sport (Hew-Butler 2015).
- **Why:** "You said you drink little at work: 2.1 L a day, a glass at each
  stand-up (EFSA 2010)."
- **Revisit:** at a mesocycle review, with the season (summer heat), and when
  the training changes (a longer or hotter block).

```python
SEX, W = "male", 83.5          # Athlete profile ("male", "female" or None); trend weight in kg (engine review)
TRAIN_MIN, HOT = 60, False     # a typical session in minutes (0: no training); heat or heavy sweating
ref = {"male": 2.0, "female": 1.6}.get(SEX, 1.8)    # drinks a day, L (EFSA 2010, Volkert 2019)
base = min(max(ref, 0.025 * W), 3.5)                # a large body raises it, about 25 mL/kg (H); capped
extra = TRAIN_MIN / 60 * (0.75 if HOT else 0.5)     # per training hour (H; ACSM 2007's 0.4-0.8 L/h)
q = lambda x: round(x, 1)                           # to the nearest 100 mL
print(f"daily target {q(base):.2f} L; training days about {q(base + extra):.2f} L (for the note)")
```

Other amounts (fruit and vegetable portions, fiber) only when the eating plan
names them and its level counts them.

## Ticks

### Lights out by a set time

- **Who:** sleep under 7 h on average (the question above at intake, `engine
  review` after), bedtimes that move around, or readiness often low from
  sleep.
- **Numbers:** ask the usual wake time; lights out about 8 hours before it,
  since 7 h asleep needs a little more in bed **(H)**. If that is far from now,
  start 30 minutes earlier than the current bedtime and move 15–30 minutes a
  week **(H)**. Every night, or work nights; a reminder 30 minutes before.
  Shift workers: the window follows the shift, not the clock **(H)**.
- **Evidence:** adults need 7 h or more, **Strong** (Watson 2015, a consensus
  on consistent data); regular times help (Ross 2020); a tick lengthening
  sleep, **Weak (H)**.
- **Safety:** loud snoring with pauses or gasping, sleepiness in the day
  despite enough time in bed, or trouble sleeping most nights for 3 months:
  "worth raising with a doctor". The tick can still help.
- **Why:** "Sleep averaged 6.1 h over 4 weeks (engine review): lights out by
  22:45 on work nights (Watson 2015)."
- **Revisit:** 7 h or more on most nights for 8 weeks: offer to turn off the
  reminder, keep the tick, or drop it.

### Caffeine cut-off

- **Who:** sleep problems with caffeine after midday, or a stimulant
  pre-workout before evening sessions.
- **Numbers:** a cup of coffee at least about 9 hours before bed, a standard
  pre-workout serve at least about 13 hours before (Gardiner 2023: 8.8 h and
  13.2 h). Counted back from the lights-out time.
- **Evidence:** caffeine cut sleep by about 45 minutes a night, **Moderate**
  (Gardiner 2023, 24 studies, many in the lab).
- **Why:** "Coffee at 16:00 and lights out at 23:00: last coffee by 14:00
  (Gardiner 2023)."

### The user's own ticks

Flossing, a skin routine and the like sit outside training, food and
recovery: the coach doesn't propose them. It tracks them as the user's, with
no Why, and leaves the advice to the dentist or the doctor.

## Desk work: sitting time, stand-ups, desk breaks

| Work-day computer time | Suggest |
|---|---|
| Under 4 h, or a job on their feet | None of the three |
| 4–6 h | Stand-ups, the short-day preset |
| 6 h or more | Stand-ups and sitting time |
| Desk work and a posture emphasis (Body assessment), a desk ache (Ledger), or the posture goal | Desk breaks, from the plan |
| Can't stand or walk easily | No stand-ups; desk breaks with seated moves **(H)** |

**The bigger lever for heavy sitters is activity.** About 60–75 minutes a day
of moderate activity seemed to remove the higher death risk of sitting 8 h or
more in pooled cohorts (Ekelund 2016, observational), and WHO advises doing
more than the minimum when sitting a lot (Bull 2020). So check the plan has
its 150–300 active minutes and a step target (`rules.md`) before adding desk
items.

**With both stand-ups and desk breaks on,** set the desk-break interval to a
multiple of the stand-up's sitting minutes (30 and 90), so they land together
and one break serves both **(H)**.

### Sitting time (a daily limit and a longest-stretch limit)

- **What Pahlavan counts:** keyboard and mouse activity per Mac, merged by
  day; time away (a call without typing included) ends a stretch (the build
  brief, decision 10; calls are not detected). Time with Standing now on and a running stand-up are not
  sitting. So it counts seated computer time, not the car or the couch, and a
  work computer without Pahlavan isn't counted: say so.
- **Who:** 6 h or more at a computer on work days, or the user asks.
- **Numbers (H):**
  - Daily limit: the user's usual work-day computer time (their estimate,
    then two weeks measured), rounded up to the half hour. At each mesocycle
    review, if they stayed under it on most work days, 30 minutes lower, never
    below what the job needs (ask once).
  - Longest stretch: 60 minutes to start, then 45, then 30, one step per
    mesocycle review when met on most days. The trials broke sitting every
    20–30 minutes (Dunstan 2012; Duran 2023), and longer unbroken stretches
    went with higher death rates in cohort data (Diaz 2017).
  - For context, the guideline for all sitting is 8 h or less a day, with no
    more than 3 h of screens for leisure (Ross 2020: a strong recommendation
    on very low-quality evidence); WHO set no number (Bull 2020).
- **Evidence:** a lot of sitting goes with worse health, **Moderate**
  (consistent cohorts: Ekelund 2016, Diaz 2017); cutting sitting at work
  improving health, unproven, **Weak** (Shrestha 2018); the limits, **(H)**.
- **Why:** "About 8 h at the computer on work days: the limits show long days
  and stretches over an hour (Diaz 2017)."
- **Safety:** none of its own: it's a measure. No streak talk about it.

### Stand-ups (sit N minutes, then stand M; daily target in minutes)

- **Who:** 4 h or more a day at a computer, able to stand and walk.
- **Presets** (read off; the daily target is in minutes, the build brief's
  decision 4):

| Preset | Sit N | Up M | Daily target |
|---|---|---|---|
| Full desk day (6 h+), no standing desk | 30 | 5, walking | 40 min (8 breaks) |
| Short desk day (4–6 h) | 30 | 5, walking | 20 min (4 breaks) |
| Standing desk | 30 | 10–20, standing work with some movement | 60 min (its revisit rule is below: desk standing counts) |
| Deep-focus work (30 min feels too often) | 45–60 | 5, walking | 30 min |

- **Why walking:** walking breaks lowered blood sugar and insulin after meals
  more than standing breaks did (Buffey 2022); of the doses tested, only 5
  minutes every 30 lowered blood sugar, while every dose helped blood
  pressure (Duran 2023); 2 minutes every 20 also worked (Dunstan 2012). The
  120-minute cap is the first step of an expert statement (Buckley 2015).
- **Not static standing:** two hours of standing computer work raised
  discomfort everywhere and slowed reaction time (Baker 2018), and the expert
  statement advises against long static standing (Buckley 2015). Standing bouts
  of 20 minutes or less, shifting and moving **(H)**.
- **Standing now** (Pahlavan 0.6.12, for a standing desk): while the switch
  is on, each `standMinutes` of desk standing (15 with the usual settings) is
  logged as a stand, quietly (its minutes, the count and the linked
  habit), and the sitting count starts over; less than a stand when it goes
  off isn't logged, and the count goes on where it was. So desk standing
  fills the daily target by itself (Decisions, "Standing at the desk counts
  toward the stand-ups"). Since Pahlavan 0.7.2 the day's record also keeps
  those minutes apart (`deskMinutes`, Pahlavan's own write; `minutes` and
  `count` still hold both kinds of stand), so `engine habits`'s `standing`
  and `track day`'s `desk` say how much of the target came from the desk.
- **Evidence:** the short-term benefit of walking breaks, **Moderate** (small
  crossover trials, mostly in people with overweight: Buffey 2022); long-term
  health benefit, **Weak**; the targets, **(H)**.
- **Safety:** light-headed on standing: stand more slowly, sit if needed;
  fainting is a red flag (`intake.md`). Leg swelling, varicose veins, or foot,
  knee or back pain when standing: shorter standing, more walking. Pregnancy:
  shorter standing bouts, the clinician's advice.
- **Why:** "About 8 h at the computer on work days: 5 minutes walking every 30
  minutes helped blood sugar after meals in trials (Duran 2023)."
- **Revisit:** at a mesocycle review, the stand-ups' minutes per day (`engine
  habits`). For a standing-desk user, a met target can be static standing at
  the desk (Standing now), so it is no reason for +30: read `engine habits
  --item <stand-up id>`'s `standing` (the last 30 days: `prompted` minutes
  from the stand-up card, `desk` minutes at the desk, `deskDays`) instead of
  asking. If desk standing fills the target on most days, the target or the
  desk breaks get the next look, as movement (walking stand-ups, a
  desk-break move), not more static standing (the Decision above); a target
  never goes past the 120-minute cap. Days from before Pahlavan 0.7.2 have
  no split (all their minutes read as `prompted`): ask only about those.
  Adherence low: a longer N (45) or a shorter M before dropping it.

### Desk breaks (a short routine every N minutes inside a work window)

- **From the plan** (the build brief, decision 9), **offered, never
  assumed:** for desk work, the plan job asks about them as their own
  question after the plan's yes (`planning.md`, the proposal's item 14): the
  routine, how often, the hours and days, or none ("No desk breaks in this
  plan"); the item (`followPlan`) follows the plan's `deskRoutine` (the
  steps) and `deskTiming` (how often, the hours, the days: `planning.md`,
  "Mapping onto `plan-data.json`"), and a change goes through the `plan`
  job with a Decision. The plan sets the times, fitted to the user's
  working hours; a plan without `deskTiming` runs on the default timing
  (every 90 minutes, 10:00 to 15:00, weekdays), which leaves a 9-to-5
  afternoon without a break after 14:30. `engine tracked`'s `deskBreaks`
  shows the times in force.
- **Who:** the desk-work table above.
- **Numbers (H):** 2–5 minutes, 3–5 moves; every 90 minutes (60–120) inside
  the work window, on work days. The window runs from about an hour after
  work starts to its end, and a break starts only while it ends by `to`:
  for a 9-to-5, 10:00 to 17:00, which gives 10:00, 11:30, 13:00, 14:30 and
  16:00 (10:00 to 16:00 still stops at 14:30). Break frequency made no clear
  difference to aches in healthy workers, on low-quality evidence (Luger
  2019), and short breaks gave small gains in energy and fatigue
  (Albulescu 2022), so the timing is a default, not a finding.
- **Content:** at least one band strengthening move (pull-aparts, external
  rotations, lateral raises): neck and shoulder strengthening at work reduced
  neck pain in office workers who had it, **Moderate** (Chen 2018), and 2
  minutes a day of band lateral raises was enough in one trial (Andersen
  2011). Then 1–2 mobility moves from the Body assessment's emphasis
  (`intake.md`): head forward or shoulders rounded, chin tucks, a doorway chest
  stretch, thoracic extension over the chair back; overhead range short, wall
  slides and a lat stretch; a deep low-back arch, a standing hip-flexor stretch
  and glute squeezes. End with a 1-minute walk. Mobility moves, **Weak or
  (H)**. Framed as capacity, never as fixing posture (`rules.md`, posture as
  capacity).
- **Safety:** the pain rule (`rules.md`): a move over 3/10 is skipped or
  swapped; numbness or tingling down an arm is a red flag (`intake.md`).
  Ledger constraints apply to desk moves too.
- **Why:** "Head forward in your side photo and 9 h desk days: 3 minutes of
  band and mobility work every 90 minutes builds upper-back capacity (Chen
  2018)."
- **Revisit:** at each phase review, with the Body assessment redone; on a new
  job or work pattern.

## The Why

One line, under about 25 words **(H)**, in three parts, like the engine's
reasons (rule, inputs, threshold, note):
1. The user's own data, with where it came from (intake, `engine review`, the
   Body assessment, the eating plan).
2. The item and its number.
3. The short source in brackets.

Supplements start with "Optional." Numbers come from code or the presets.
Never fear ("sitting is the new smoking"), never a disease claim, never a
promise about a test result, never "fix your posture".

## Revisit and stop

| When | What the coach does |
|---|---|
| A suggestion is dismissed | Logged as declined; not proposed again without new data |
| Sunday check-in | Only items with a review date due, or one the user raises; the week's one focus may be an item |
| Mesocycle review (each light week's close) | Each coach item's 30-day adherence (Pahlavan's stats); the steps for stand-ups, sitting limits and the sleep window; under 50%, one question: keep it, make it smaller, move it to another cue, or drop it **(H)** |
| Phase review | The whole list against the profile, the plan and the redone Body assessment: drop what no longer fits, add at most one |
| Met on most days for 8 weeks | Offer to turn the reminder off and keep the item, or drop it **(H)** |
| The trigger is gone (a job on their feet, sleep at 7 h+, lifting stopped) | Offer to drop or re-size it |
| Health changes (new diagnosis, medicine, pregnancy, injury) or re-screening | The safety screen again for every item; pause flagged supplements and say why; the user decides about their own items |

Missed days get the next step, never a tally (`rules.md`, no streaks), even
though Pahlavan shows streaks.

## The tracking file

Everything tracked lives in `<fitness>/Coach/tracking.json`
(schema v1; the full format is in `formats.md`). Pahlavan reads it for its
Habits section, Due today and the reminder cards; the user changes it on the
Habits screen. **The coach writes it only through the engine's `track`
commands** (`numbers.md`), which merge with the file as it is, validate the
result, write it whole and read it back: never by hand, never a guessed
shape. Each is a dry run until `--write`: show the user what it will do (its
`results` and `after`), then run it again with `--write` on the yes.

```bash
node .claude/skills/fitness-coach/scripts/engine.cjs track apply   --vault . --json --file <changes.json> [--write]   # several changes, one write
node .claude/skills/fitness-coach/scripts/engine.cjs track suggest --vault . --json --file <items.json> [--write]     # chips in Pahlavan
node .claude/skills/fitness-coach/scripts/engine.cjs track add     --vault . --json --file <items.json> [--write]     # accepted in the conversation
node .claude/skills/fitness-coach/scripts/engine.cjs track decline --vault . --json --file <items.json> [--write]     # declined in the conversation
node .claude/skills/fitness-coach/scripts/engine.cjs track accept  --vault . --json --id <id[,id]> [--write]
node .claude/skills/fitness-coach/scripts/engine.cjs track dismiss --vault . --json --id <id[,id]> [--write]
node .claude/skills/fitness-coach/scripts/engine.cjs track morning --vault . --json --at 07:00 [--write]              # or --off
node .claude/skills/fitness-coach/scripts/engine.cjs track body-record --vault . --json --schedule plan [--write]
node .claude/skills/fitness-coach/scripts/engine.cjs track fresh   --vault . --json [--write]                         # nothing brought over
node .claude/skills/fitness-coach/scripts/engine.cjs track protein --vault . --json [--write]                         # the protein item to the engine's target
node .claude/skills/fitness-coach/scripts/engine.cjs track day     --vault . --json --date D                          # read only: the day's items, what is open
node .claude/skills/fitness-coach/scripts/engine.cjs track tick    --vault . --json --id <id[,id]> --date D [--done true|false] [--amount N] [--write]
```

**How an item gets there.**
- **Accepted in the conversation** (the proposal's AskUserQuestion): `add`.
  It is written as Pahlavan's Accept chip writes it: the suggestion recorded
  as accepted today, the item starting today, "Suggested by your coach" with
  its Why.
- **Declined in the conversation:** `decline`. Kept as a dismissed
  suggestion, so `suggest` skips it later ("not proposed again without new
  data"); `"again": true` suggests it once more when there is new data.
- **To decide in Pahlavan** (the user would rather look first, or a
  check-in's one new item): `suggest`. It shows as an accept or dismiss chip
  with its Why in the Habits section; `accept` and `dismiss` do the same as
  the chips, by the suggestion's id.
- **The user's own item from the conversation** ("track my flossing"): `add`
  without a Why. It reads "Added by you"; the coach comments on it only for
  safety (the rules above).
- **A change to an item** (a new target, training days only): `add` with the
  item's `id` and only the fields that change. It applies from today: the
  settings until yesterday stay with the past days, as Pahlavan's Edit form
  does. The kind never changes. Change a user's own item only when they ask.

**An item as the coach writes it:** `kind` (`supplement`, `amount`, `tick`,
`standup`, `sitting`, `desk`), `name`, and for a coach item `why` (the one
line from "The Why" above) and `from` (`intake`, `plan`, `eating plan`,
`checkin`, `letter`). Everything else is optional and takes Pahlavan's Add
form defaults for the kind: every day (stand-ups, sitting and desk breaks:
weekdays), a card at the slot's time (morning 09:00, midday 12:30, evening
21:00, bedtime 22:30), the presets' fields filled in. **A reminder's time
must fall outside Pahlavan's quiet hours** (Settings, 22:30 to 07:00 by
default): no card shows inside them; one due in the early morning waits
until they end, and one due late in the evening is skipped that day, so it
never shows. A bedtime item goes at 22:00 or earlier unless the user has
moved quiet hours (the bedtime slot's 22:30 sits exactly at their start:
give it `reminder: {at: "22:00"}`). The engine flags every reminder they
hold, from Pahlavan's own settings (else the default): `engine tracked`'s
`quiet.held` and each item's `quiet` (its card times inside the hours and
when each `shows` instead, null for never). Check it after every write that
sets a time, and move an item it flags. The fields, when the item needs
them:

| Field | For | Example |
|---|---|---|
| `id` | the id to use or change (lowercase, dashes); left out, it comes from the name | `"creatine"` |
| `schedule` | `{kind: daily \| training \| rest \| weekdays \| every, days?, n?}` | `{"kind": "weekdays", "days": ["mon", "tue", "wed", "thu", "fri"]}` |
| `when`, `whenDetail` | supplements, ticks, amounts: `morning`, `midday`, `evening`, `bedtime`, `training` (`before` or `after`), `time`, `day` (amounts through the day) | `"when": "evening"` |
| `reminder` | `{at}`, `{afterLog: true}` (after a logged session), amounts `{every, from, to}`, sitting `{atMinutes, stretch}`; `null` for no card | `{"at": "08:00"}` |
| `dose` | supplements | `"5 g"` |
| `means`, `goal` | ticks: what done means; a number with it | `"goal": {"amount": 150, "unit": "g"}` |
| `amount` | amounts: `{target, unit, quick}` | `{"target": 2100, "unit": "mL", "quick": [250, 500]}` |
| `standup` | `{sitMinutes, standMinutes, targetMinutes, hours}` and the rest of the stand settings | `{"sitMinutes": 30, "standMinutes": 20, "targetMinutes": 60}` |
| `sitting` | `{limitMinutes, stretchMaxMinutes, awayMinutes}`; the daily-limit card goes 30 minutes before the limit: when the limit is set or changed without a card time, `track add` and `suggest` move it there themselves (the result's note: "its card at 7 h 30 of 8 h, 30 minutes before the limit"; a given `reminder.atMinutes` or `reminder: null` wins, and a card that is off stays off). Check the dry run's note says limit − 30 | `{"limitMinutes": 480, "stretchMaxMinutes": 60}`, the card then at 450 |
| `desk` | `{followPlan, every, from, to, minutes}`; with `followPlan` the routine, times and days come from the plan (`deskRoutine` on its `deskTiming`) | `{"followPlan": true}` |
| `habit` | the habit it ticks too in the habit check-ins file (`paths.habits`, `habits[].id`: read it, never guess) | `"protein"` |
| `note`, `start` | free text (the "skip it if" line); a later first day | |

**Link to the habit** when the habit check-ins file has one for the item
(protein, creatine, water, stand, the supplements): the ticks then go there
too, its past ticks feed Pahlavan's stats, and the Sunday check-in counts
the protein days from it. `track` warns about a protein item left unlinked.

**The protein item** is a tick named Protein. Added without a `goal`, it
takes the engine's target: the floor of `engine review`'s `weight.protein`
range at the trend weight (`numbers.md`). When the eating plan or the trend
weight moves it, `engine tracked` says so (`protein.items[].follows`) and
`track protein` moves the coach's item to it (never the user's own).

**One write at the intake's end** (`intake.md`), `track apply` with:

```json
{
  "add": [
    { "kind": "supplement", "name": "Creatine", "dose": "5 g", "when": "morning", "reminder": { "at": "08:00" }, "habit": "creatine",
      "why": "Optional. You lift 4 days a week for strength: 5 g a day adds a little to every block (Kreider 2017).", "from": "intake",
      "note": "Skip it if: kidney disease or reduced kidney function; diabetes or high blood pressure without a doctor's okay; pregnant or breastfeeding; bipolar disorder; regular medicines (pharmacist first)." },
    { "kind": "standup", "name": "Stand-ups", "standup": { "sitMinutes": 30, "standMinutes": 20, "targetMinutes": 60 }, "habit": "stand",
      "why": "About 8 h at the computer and a standing desk: 20 minutes up every 30 (Duran 2023).", "from": "intake" }
  ],
  "decline": [
    { "kind": "amount", "name": "Water", "amount": { "target": 2100, "unit": "mL" }, "why": "You said you drink little at work: 2.1 L a day (EFSA 2010).", "from": "intake" }
  ],
  "morning": { "at": "07:00" },
  "bodyRecord": { "schedule": "plan" },
  "bringOver": []
}
```

- `morning`: the morning check-in's card, at the time the user wakes plus a
  little (they set it on Pahlavan's Check-in card later). `{"on": false}`
  turns the card off and keeps the time.
- `bodyRecord: {"schedule": "plan"}`: the tape, photos and tests follow the
  plan's calendar (the tape every second Sunday, photos on each light week's
  Sunday, tests at phase ends). `fixed` with `tapeFrom`, `tapeEvery`, `testsFrom`,
  `testsEvery` is every N days instead.
- `bringOver: []`: a fresh start. Nothing comes over from an older reminder
  plugin (Habit Nudges, in a vault that has it), and Pahlavan's one-time
  "Bring over" offer never shows.

**The hand-over** (only in a vault with the Habit Nudges plugin). Once
`tracking.json` holds at least one item, Pahlavan counts as set up in the
vault (`track`'s `handOver` says
when a write does it) and Habit Nudges steps aside: no more body check-in,
tape, photos or tests, water card, stand-ups or desk breaks there, and its
check-ins stop asking about the health and fitness habits (its settings tab
lists them). Reading, flashcards, words, the plan's ⏰ reminders and desk time
stay in Habit Nudges. Only a tracked item sets Pahlavan up: the bring-over
record alone (a fresh start with nothing accepted) only stops the offer, and
Habit Nudges keeps its reminders. Write it in the same `apply` as the first
accepted items.

**Reading it back.**
- `engine tracked`: every item in words (schedule, when, what it asks for,
  reminder, source, linked habit, pause), the open suggestions, the
  morning time, the body record and the plan's desk breaks, the protein
  target beside the protein item, and the reminders quiet hours hold
  (`quiet`).
- `engine habits [--item <id>]`: each item's streak, 30-day adherence (done
  of due, with its reason) and 26-week grid; sitting time as 4 weeks of bars
  against its limits. The mesocycle review's numbers come from here.
- `engine due`: what is due now and today.
- `engine track day --date D`: one day as the daily wrap-up reads it:
  every item due that day with its `state` (`done`, `not done`, `counted`
  for sitting), the amount so far and the target (a stand-up's `desk`
  minutes of it), its kind, its linked
  habit and whether that habit is ticked, `open` (the
  supplements, ticks and amounts still not done: ask only about these),
  whether a session is logged, the "Did you train today?" answer and a
  rest mark, and the morning check-in. Read only.

**Ticking a day** (a daily wrap-up, when `Coach/local.md` names one): `engine track tick --id
<id[,id]> --date D` (D the training day, SKILL.md house rule 17; always
given) with `--done` (supplements and ticks; `--done false`
unticks) or `--amount N` (an amount's total for the day, not an addition),
a dry run until `--write`. It writes the item's day in `tracking.json` and
the same tick or amount on its linked habit in the habit check-ins file,
as Pahlavan's Due today does, so Pahlavan's stats and any other view of that
file agree; never tick the habit check-ins directly for an item Pahlavan tracks.
Stand-ups, desk breaks and sitting time are counted by Pahlavan on each
Mac and are not ticked. An unknown id or the wrong flag for a kind writes
nothing; with no habit check-ins file, a linked item writes nothing either.
- The source shows as "Suggested by your coach" (with the Why on hover),
  "Added by you", or "Added by you, from Habit Nudges" for a brought-over
  item.
- `engine validate <fitness>/Coach/tracking.json --json` checks the
  file; Pahlavan's own `nudges.json`, `sitting.json` and `help.json` beside
  it are never the coach's to write.

## Sources

- ACSM 2007: Sawka MN et al. Exercise and fluid replacement (ACSM position stand). https://pubmed.ncbi.nlm.nih.gov/17277604/
- Abdelhamid 2020: Abdelhamid AS et al. Omega-3 fatty acids for the primary and secondary prevention of cardiovascular disease (Cochrane). https://doi.org/10.1002/14651858.CD003177.pub5
- Albulescu 2022: Albulescu P et al. "Give me a break!" A systematic review and meta-analysis on the efficacy of micro-breaks. https://doi.org/10.1371/journal.pone.0272460
- Andersen 2011: Andersen LL et al. Effectiveness of small daily amounts of progressive resistance training for frequent neck/shoulder pain: randomised controlled trial. https://www.ucviden.dk/en/publications/effectiveness-of-small-daily-amounts-of-progressive-resistance-tr/
- Antonio 2021: Antonio J et al. Common questions and misconceptions about creatine supplementation. https://pmc.ncbi.nlm.nih.gov/articles/PMC7871530/
- Armstrong & Johnson 2018: Water intake, water balance, and the elusive daily water requirement. https://pmc.ncbi.nlm.nih.gov/articles/PMC6315424/
- Baker 2018: Baker R et al. A detailed description of the short-term musculoskeletal and cognitive effects of prolonged standing for office computer work. https://pure.amsterdamumc.nl/en/publications/a-detailed-description-of-the-short-term-musculoskeletal-and-cogn/
- Bauer 2013: Bauer J et al. Evidence-based recommendations for optimal dietary protein intake in older people (PROT-AGE). https://doi.org/10.1016/j.jamda.2013.05.021
- Buckley 2015: Buckley JP et al. The sedentary office: an expert statement on the growing case for change. https://bjsm.bmj.com/content/49/21/1357
- Buffey 2022: Buffey AJ et al. The acute effects of interrupting prolonged sitting time with standing and light-intensity walking on biomarkers of cardiometabolic health. https://pubmed.ncbi.nlm.nih.gov/35147898/
- Bull 2020: Bull FC et al. World Health Organization 2020 guidelines on physical activity and sedentary behaviour. https://bjsm.bmj.com/content/54/24/1451
- Burke 2023: Burke R et al. Creatine supplementation combined with resistance training on regional measures of muscle hypertrophy: a meta-analysis. https://pubmed.ncbi.nlm.nih.gov/37432300/
- Chen 2018: Chen X et al. Workplace-based interventions for neck pain in office workers: systematic review and meta-analysis. https://research-repository.griffith.edu.au/items/32398aae-fcdb-496c-8ef5-b23db68ad6a3
- Chilibeck 2017: Chilibeck PD et al. Creatine during resistance training on lean tissue mass and strength in older adults: a meta-analysis. https://pmc.ncbi.nlm.nih.gov/articles/PMC5679696/
- de Souza e Silva 2019: Effects of creatine supplementation on renal function: a systematic review and meta-analysis. https://pubmed.ncbi.nlm.nih.gov/31375416/
- Demay 2024: Demay MB et al. Vitamin D for the prevention of disease: an Endocrine Society clinical practice guideline. https://doi.org/10.1210/clinem/dgae290
- Devries 2018: Devries MC et al. Changes in kidney function do not differ between healthy adults consuming higher- compared with lower- or normal-protein diets. https://doi.org/10.1093/jn/nxy197
- Diaz 2017: Diaz KM et al. Patterns of sedentary behavior and mortality in US middle-aged and older adults. https://doi.org/10.7326/M17-0212
- Dunstan 2012: Dunstan DW et al. Breaking up prolonged sitting reduces postprandial glucose and insulin responses. https://doi.org/10.2337/dc11-1931
- Duran 2023: Duran AT et al. Breaking up prolonged sitting to improve cardiometabolic risk: dose-response analysis of a randomized crossover trial. https://doi.org/10.1249/MSS.0000000000003109
- EFSA 2010: EFSA NDA Panel. Scientific opinion on dietary reference values for water. https://doi.org/10.2903/j.efsa.2010.1459
- Ekelund 2016: Ekelund U et al. Does physical activity attenuate, or even eliminate, the detrimental association of sitting time with mortality? https://doi.org/10.1016/S0140-6736(16)30370-1
- Gardiner 2023: Gardiner C et al. The effect of caffeine on subsequent sleep: a systematic review and meta-analysis. https://doi.org/10.1016/j.smrv.2023.101764
- Gardner 2012: Gardner B et al. Making health habitual: the psychology of habit formation and general practice. https://doi.org/10.3399/bjgp12X659466
- Garrison 2020: Garrison SR et al. Magnesium for skeletal muscle cramps (Cochrane). https://doi.org/10.1002/14651858.CD009402.pub3
- Gencer 2021: Gencer B et al. Long-term marine omega-3 supplementation and the risk of atrial fibrillation in randomized trials. https://doi.org/10.1161/CIRCULATIONAHA.121.055654
- Hew-Butler 2015: Hew-Butler T et al. Statement of the 3rd International Exercise-Associated Hyponatremia Consensus Development Conference. https://bjsm.bmj.com/content/49/22/1432
- IOM 2011: Ross AC et al. The 2011 report on dietary reference intakes for calcium and vitamin D from the Institute of Medicine. https://pmc.ncbi.nlm.nih.gov/articles/PMC3046611/
- Jäger 2017: Jäger R et al. International Society of Sports Nutrition position stand: protein and exercise. https://doi.org/10.1186/s12970-017-0177-8
- KDIGO 2024: KDIGO CKD Work Group. KDIGO 2024 clinical practice guideline for the evaluation and management of chronic kidney disease. https://doi.org/10.1016/j.kint.2023.10.018
- Kreider 2017: Kreider RB et al. ISSN position stand: safety and efficacy of creatine supplementation in exercise, sport, and medicine. https://pmc.ncbi.nlm.nih.gov/articles/PMC5469049/
- Lak 2025: Lak M et al. Does creatine cause hair loss? A 12-week randomized controlled trial. https://doi.org/10.1080/15502783.2025.2495229
- Lally 2010: Lally P et al. How are habits formed: modelling habit formation in the real world. https://doi.org/10.1002/ejsp.674
- Luger 2019: Luger T et al. Work-break schedules for preventing musculoskeletal symptoms and disorders in healthy workers (Cochrane). https://doi.org/10.1002/14651858.CD012886.pub2
- Mah & Pitre 2021: Oral magnesium supplementation for insomnia in older adults: a systematic review and meta-analysis. https://pmc.ncbi.nlm.nih.gov/articles/PMC8053283/
- Manson 2019: Manson JE et al. Vitamin D supplements and prevention of cancer and cardiovascular disease (VITAL). https://doi.org/10.1056/NEJMoa1809944
- Melina 2016: Melina V et al. Position of the Academy of Nutrition and Dietetics: vegetarian diets. https://pubmed.ncbi.nlm.nih.gov/27886704/
- Morton 2018: Morton RW et al. Protein supplementation and resistance training-induced gains in muscle mass and strength: a meta-analysis. https://bjsm.bmj.com/content/52/6/376
- NASEM 2005: Dietary Reference Intakes for water, potassium, sodium, chloride, and sulfate. https://doi.org/10.17226/10925
- NIH ODS: Magnesium fact sheet for health professionals. https://ods.od.nih.gov/factsheets/Magnesium-HealthProfessional/
- Roitman 2007: Roitman S et al. Creatine monohydrate in resistant depression: a preliminary study. https://pubmed.ncbi.nlm.nih.gov/17988366/
- Ross 2020: Ross R et al. Canadian 24-Hour Movement Guidelines for Adults aged 18–64 years and adults aged 65 years or older. https://doi.org/10.1139/apnm-2020-0467
- SACN 2016: Scientific Advisory Committee on Nutrition. Vitamin D and health. https://assets.publishing.service.gov.uk/media/5a804e36ed915d74e622dafa/SACN_Vitamin_D_and_Health_report.pdf
- Shrestha 2018: Shrestha N et al. Workplace interventions for reducing sitting at work (Cochrane). https://doi.org/10.1002/14651858.CD010912.pub4
- Thomas 2016: Thomas DT, Erdman KA, Burke LM. Position of the Academy of Nutrition and Dietetics, Dietitians of Canada, and the American College of Sports Medicine: nutrition and athletic performance. https://doi.org/10.1016/j.jand.2015.12.006
- USPSTF 2022: Vitamin, mineral, and multivitamin supplementation to prevent cardiovascular disease and cancer. https://doi.org/10.1001/jama.2022.8970
- Volkert 2019: Volkert D et al. ESPEN guideline on clinical nutrition and hydration in geriatrics. https://doi.org/10.1016/j.clnu.2018.05.024
- Watson 2015: Watson NF et al. Recommended amount of sleep for a healthy adult (AASM and SRS consensus). https://pmc.ncbi.nlm.nih.gov/articles/PMC4434546/
