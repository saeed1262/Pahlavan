# Plan design

The `plan` job: from the Athlete profile to a written plan. This file
decides what the plan should be; `plan-files.md` is how it gets written;
`adhoc.md` covers short-notice changes. Rules and sources: `rules.md`.

## The engine drafts it, the coach makes it personal

Steps 1–10 below are coded in the engine's plan generator, except the
candidates it doesn't build (step 1). Run it first; the steps say what it
did and why, and the evidence behind each choice (`rules.md`). The engine's output is a draft, never the
reason: "it's the engine's default" or "the table says so" is not a reason
for any part of the plan. Before the proposal, two checks turn the draft into
this user's plan: the personalization audit and the volume check on the
vault's map (both below).

```bash
node .claude/skills/fitness-coach/scripts/engine.cjs plan --json \
  --profile <fitness>/Coach/profile.json --ledger <fitness>/Coach/ledger.json \
  --start <the plan's first Monday> --weeks 12|16|24 --vault . [--history]
```

- It needs `Coach/profile.json` (and reads `ledger.json`); without them,
  run `intake` first, which writes both.
- **A fresh start needs its Baseline note first.** The intake writes it
  (`intake.md`, step 7). When the plan job comes first in a fresh start (a
  new plan as a reset, with the profile kept), it writes the note instead,
  before the proposal: `baseline --vault . --json --date <today>`, and on
  the user's yes its `text` to its `path`, word for word (`exists` true: a
  note for the day is there; write nothing). A plan change inside a cycle
  (a swap, the next month) writes no note.
- `--vault .` carries the current `plan-data.json` over as the exporter's
  base and counts sets per muscle with the vault guide's muscles, the
  numbers Pahlavan shows. `--history` lets the logged history size the week,
  only when the profile records that the user opted in.
- `--start`: a mesocycle boundary of Pahlavan's week clock (step 3).
- The output: `program` (every week, session and slot) and `proposal`
  (`why`, `template`, `week` and the minimum week, `phases` with dates,
  `sessions`, `volume`, `progression`, `calibration`, `conditioning`,
  `calendar`, `targets`, `preMortem`, `warmUp`, `checks`). A failed check
  stays in the proposal with its reason; never hide it.
- The proposal also has `personalization` (every profile input
  with the decision it drove, or what it is for), `templates` (every
  candidate the engine built and scored, the pick and each factor's points
  and reason, with its families' fit and costs as flags; step 1 says what it
  doesn't build), `families` (all twelve split families: built here, in
  part, or the coach's),
  `ladders` (each ladder's starting level from the self-check, and where the
  plan uses it), `priority` (each priority muscle and why) and `volumeMap`
  (whose muscle tags the volume uses).
- The coach still owns the judgment: the user's own failure modes for the
  pre-mortem, life-aware deload placement, and any change to the engine's
  pick (with its reason in the Decision).
- On the user's yes, the same command with `--format plan-data --vault .`
  gives the `plan-data.json` object to write (`planData`) and what it can't
  hold (`unexpressible`, listed in the proposal's item 12); the write follows
  `plan-files.md`.

## Inputs

- `Coach/Athlete profile.md` (screening, goals, availability, equipment,
  tracking level, preferences, the Standing plan rules, self-check, RIR
  calibration) and its twin `Coach/profile.json`, which the engine reads.
  The Standing plan rules are the user's own and the engine doesn't know
  them: the audit below starts from them.
- **The profile's Body assessment:** every emphasis in it shapes exercise
  choice and volume (pull-to-push ratio, unilateral work, lagging areas,
  squat and overhead regressions), within the caps in step 5.
- `Coach/Ledger.md`: every entry with status active or managing is a
  constraint on exercise choice; `Coach/ledger.json` holds them for the
  engine.
- `engine review` (`numbers.md`): adherence (last 4 weeks), e1RM per lift,
  sets per muscle of the current plan, weight trend. **After a fresh intake, only if the user
  chose to use their history** (the profile records it); otherwise the week
  is sized from the stated availability and starting weights come from the
  calibration week.
- `plan-data.json` (what exists now), `6-Month Roadmap.md`, the last two
  letters and open Decisions (and the newest month note, when
  `Coach/local.md` names one).
- The vault's notes for the coming weeks (`Coach/local.md` names them, such
  as daily notes), if the user opts in: known travel and crunch weeks
  (life-aware scheduling).

## 1. Design the week from constraints

The split is a scheduling choice: at matched weekly sets per muscle, splits
and frequencies build the same muscle and strength (**Strong**,
[Schoenfeld 2019a](https://doi.org/10.1080/02640414.2018.1555906),
[Ramos-Campo 2024](https://doi.org/10.1519/JSC.0000000000004774)). So the week
starts from what the goals need, and the split is whichever family delivers
it best for this user. Rules, numbers and grades: `rules.md` ("Plan
structure", "Split families", "Goal modifiers").

1. **Screening.** Blocked: no plan. Conservative: full body only, RIR ≥ 4, no
   vigorous work, whatever the steps below say (its candidates are full-body
   variants that differ in days, dose and minutes). Go, ramped: the first
   mesocycle at RIR ≥ 3.
2. **The constraints, written down before any split:**
   - the weekly sets per muscle the goals need (step 5's tiers; a strength
     goal needs few sets) and the goal modifier's loading;
   - the per-session cap, about 8 direct sets per muscle (**Weak**): a muscle
     needing more than about 16 a week needs 2+ sessions;
   - 2+ exposures a week for each strength-goal lift (**Moderate**);
   - the time: planned sessions (step 2) × minutes, rest (step 5) and the
     warm-up included;
   - recovery: no muscle trained hard two days running **(H)**, unless the
     second day is the lighter one for it (a heavy day followed by its
     lighter day); a set at RIR 4 or more is not hard;
   - the bad-week answer: what a missed day costs each muscle **(H)**;
   - the cardio days and modes, and the concurrent rules (step 7);
   - equipment, the Ledger, the self-check, and training age by how fast
     they progress **(H)**; at 65+, start around RPE 5–6 **(H)**;
   - the Standing plan rules, split likes and dislikes, preferences.
   Novices have no lifting-day cap: 4 days with the rest as cardio, mobility
   or skill work is a recovery and time default **(H)**, overridden when the
   user wants more and the week fits.
3. **At least three candidates**, genuinely different families from
   `rules.md` "Split families", at least one outside full body and
   upper/lower (heavy/light full body counts as full body here); A/B and
   A/B/C are one family. Each from a
   family whose Fits column the constraints meet, or with the mismatch named
   as a cost (for the engine's, `templates[].fit` lists each family's
   `meets` and `misses`); each with its days, sessions, exercises (step 4),
   sets × reps and minutes.
4. **Build and check each.** The engine's draft builds and scores the
   families `rules.md` "Split families" lists for the week's lifting days:
   beside the full-body variants, upper/lower once each at 2; upper/lower/full,
   push/pull/legs once each and upper/lower rotating at 3; upper/lower twice,
   torso/limbs, upper/lower plus a full-body pair (the second lighter) and a
   body-part split at 4; push/pull/legs plus upper/lower, U/L/U/L/F and a
   body-part split at 5; push/pull/legs plus upper/lower, push/pull/legs
   twice and a body-part split at 6; at 5–6 (a trained lifter: a novice
   lifts on 4 days at most), also 4 lifting days with the rest as
   conditioning;
   only the minimum-dose templates at 30 min or less. `proposal.templates`
   scores those, each row with its `families`, their `fit` and their `costs`
   as flags, not points. `proposal.families` lists all twelve families: the
   candidates built in each, its fit for this week, and the ones left to the
   coach (the specialization block, HIFT) or built only in part (concurrent
   training, circuits, calisthenics skill blocks; its `note` says which
   part), also named in `proposal.why`.
   The coach builds every other candidate as a scratch plan-data
   (`/tmp/plan-data.<candidate>.json`: the engine's printed `planData` with
   `sessions`, `liftTypes`, `titles`, `shortNames`, `focus`, `weekTarget` and
   `lifts` changed, and a `guide` entry with `muscles` for every new
   movement, else it counts zero) and runs the volume check (below) on it.
   Never write the real `plan-data.json` for a candidate.
5. **Score them** in one table, a row per candidate, on what the evidence
   supports (`rules.md`, "Plan structure", Scoring):
   - **the checks:** every muscle in its tier, no session over the cap,
     inside the minutes, pull:push; a failed check rules it out or is named;
   - **exposures** for each strength-goal lift (**Moderate**);
   - **heavy/light days** only for a trained lifter with a strength goal
     (**Moderate**, [Moesgaard 2022](https://doi.org/10.1007/s40279-021-01636-1)),
     as the engine scores them; for a muscle goal or a novice they are a
     preference, scored only from `preferences.splits`;
   - heavy leg days next to key runs (**Moderate**); **skip risk** from the
     bad-week answer **(H)**; pulling in every session **(H)**; a novice's
     practice of each main lift (**Weak**); what Pahlavan can't express (the
     calendar's 4 + 3 layout) as a cost, not a veto;
   - **preference and fit** decide between candidates equal on the above
     (**Moderate**, [Teixeira 2024](https://doi.org/10.1186/s12966-024-01636-0)).
     No split is scored as better for muscle.
6. **The pick**, argued from the user's data with each deciding factor's
   evidence. Check the engine's scores against what the profile can't hold
   (a split liked in conversation, not yet in `preferences.splits`). A pick
   other than the engine's goes in the Decision with its reason and is
   written from its scratch copy ("Writing it").

## 2. Size the week to reality

- **Planned sessions a week = the smaller of** the stated days and the last
  4 weeks' confirmed sessions + 1 **(H)**. "Confirmed" means after asking about
  every gap (logs undercount; `habit-days` in the adherence output often shows
  unlogged sessions).
- Minutes per session from the profile; when logged `durationMin` values run
  shorter than planned, plan to those and keep Express as the floor.
- Short sessions (`shortTypes`) are the first to drop when the week shrinks;
  lifting comes first (today's roadmap rule).
- If the user wants more than the rule gives, plan the minimum week as the
  target and the extra as optional ("a 5th session when the week allows").
- **The minimum week and Express are a real dose:** about 4 hard sets per
  muscle a week in 2 short full-body sessions (supersets) holds strength and
  size, and is the bad-week plan (**Moderate**,
  [Iversen 2021](https://doi.org/10.1007/s40279-021-01490-1); `rules.md`,
  "The minimum week").

## 3. Build the macrocycle

- **12–24 weeks, phases of two mesocycles** (3 loading weeks + 1 deload = 4
  weeks; a phase = 8 weeks) **(H)**; periodized plans help 1RM a little
  (**Moderate**, [Moesgaard 2022](https://doi.org/10.1007/s40279-021-01636-1)).
- **Align to Pahlavan's week clock.** Pahlavan, `review` and the
  calendar count plan weeks from the first logged plan session (`engine
  review`'s `week.planStart`; for example, cycle 3's week 1 began
  2026-11-02), deload every 4th week, and flip phases at weeks 8, 16 and 24.
  So a new plan starts on a mesocycle boundary (plan weeks 1, 5, 9, 13, …),
  and phases start at weeks 1, 9 and 17. A reset mid-mesocycle runs the
  current plan (or a temporary `until` change) to the next boundary.
- **The light week every 4th week is a heuristic (H)**, kept as the default
  because the engine and Pahlavan run it: no trial supports a fixed timing
  for muscle, and surveyed athletes take one every 5.6 ± 2.3 weeks (**Weak**,
  [Coleman 2024](https://doi.org/10.7717/peerj.16777),
  [Rogerson 2024](https://doi.org/10.1186/s40798-024-00691-y)). The check-in
  or review may skip one when no trigger is met, or move it onto a busy
  week, with a Decision (`rules.md`, "Deloads").
- **Phase sequence by goal (H):**
  - Recomposition or muscle: Foundation (calibrate, technique, efficient
    volume) → Build (priority muscles toward 10–16 sets, heavier main lifts)
    → Peak (highest volume the user recovers from, then tests).
  - Strength: accumulation (more sets, 6–10 reps) → intensification (3–6
    reps, fewer sets) → realization (heavy singles or tests, low volume).
  - Health: steady full-body phases; the change between phases is in
    conditioning and steps.
- **Life-aware (opt-in):** a known travel or crunch week within a week of a
  scheduled deload becomes the deload; a crunch week elsewhere gets the
  minimum week. Today's tooling can't move the deload (see the limits below):
  say it in the letter and the Decision.
- The plan's length is plan-data's `weeks` (`plan --format plan-data` writes
  it; without it, 24): Pahlavan's top bar reads "Week N of M" from it. Past
  the plan's last week it reads "Week N, after the plan's M". A macrocycle
  that runs past it needs a new cycle (a new `Baseline - <date>.md` from
  `engine.cjs baseline`, the log
  archived so the week clock restarts, as in September 2026). That is a
  separate piece of work to plan with the user, not part of this job.

## 4. Choose the exercises

- **The self-check sets the starting points** (`intake.md`, "The movement
  self-check", with its thresholds): each ladder's starting level (pull-up,
  push-up, core, single-leg); pull-ups as the main vertical pull at 3 or
  more strict reps, a lower level (negatives, band-assisted, scapular) beside
  the lat pulldown, or in its place where there is none; single-leg work when
  balance holds 30 s a side, split squats and a balance hold when it does
  not; the push-up and single-leg ladders where pressing or single-leg work
  is otherwise thin (no bench, loads or machines); box squats for a hard
  sit-to-stand, heel-elevated squats for heels that lift, hip thrusts and
  back extensions for a hinge that rounds, no overhead pressing for a reach
  that is not clean; nothing above a tested ladder level. The engine does
  this from `selfCheck` (`proposal.ladders`, and each slot's `ladder`).
- **Main lifts** (the session's 1–2 logged lifts): kept for the whole phase.
- **Accessories:** rotate at mesocycle boundaries, at most half at a time,
  keeping the ones still progressing (**Weak**,
  [Kassiano 2022](https://doi.org/10.1519/JSC.0000000000004258)).
- **Screen every movement** against the Ledger (constraints and IAP tags in
  `rules.md`), the equipment, and the user's dislikes.
- **Pick by** equipment, the Ledger, liking and the lift the user wants
  strong: free weights and machines build equal strength and size
  (**Moderate**, [Haugen 2023](https://doi.org/10.1186/s13102-023-00713-4));
  prefer versions that load the muscle long (**Weak**,
  [Maeo 2021](https://doi.org/10.1249/MSS.0000000000002523)).
- **Order:** the goal's priority lift first (a strength-goal lift, or a
  priority muscle's main exercise; **Moderate**,
  [Nunes 2021](https://doi.org/10.1080/17461391.2020.1733672)); otherwise for
  safety and logistics.
- **Range of motion:** full, with the stretched position emphasised;
  lengthened partials only as an option (a load ceiling, a painful end
  range); never short-range partials as main work (**Moderate**,
  [Kassiano 2023](https://doi.org/10.1519/JSC.0000000000004415)).
- **Posture goal:** pulling sets at least equal to pushing sets **(H)**, with
  face pulls, rear-delt work or pull-aparts in every session, as now.
- **A new movement** needs a `guide` entry with `muscles: {main, helps}` and,
  if it's a logged lift, a `lifts` entry (`plan-files.md`, step 2).

## 5. Reps, effort, rest and volume

- **Rep ranges** from the goal modifier (`rules.md`, "Goal modifiers"):
  strength, main lifts at 80%+ of 1RM (about 1–6 reps); muscle, any range
  from about 6 to 30 reps near failure, picked by equipment, joints and
  liking (**Strong**,
  [Schoenfeld 2017b](https://doi.org/10.1519/JSC.0000000000002200)). Where
  one dumbbell step is over 10% of the load (light dumbbells, the lateral
  raise), widen the range (8–15).
- **RIR targets:** compound 1–3, isolation and machines 0–2, strength work
  2–4; Conservative ≥ 4; corrected by the user's calibration bias. Failure
  is optional, and never on heavy compounds (**Moderate**,
  [Refalo 2023](https://doi.org/10.1007/s40279-022-01784-y)).
- **Rest:** at least 90 s, 2–3 min on heavy compound lifts; supersets of
  non-competing muscles when time is short (**Moderate**,
  [Singer 2024](https://doi.org/10.3389/fspor.2024.1429789)). The draft
  follows the rule: 2–3 min on main lifts (90 s when the range starts at 10
  reps or more, a lighter day's) and on compound accessories at 6 reps or
  fewer, 90 s on every other set, holds included. When a session wouldn't fit
  its minutes with those rests, it pairs accessories of non-competing muscles
  as supersets before cutting any set (plan-data's `pair` on the second
  item, both items resting "90 s after each pair"); minimum-dose sessions
  always pair theirs. The pre-write check still checks it.
- **Sets per muscle a week:** priority muscles (2–3, from the goals) 10–16;
  the rest 5–10; none under 4; none over 20–24; at most 6–8 direct sets for
  one muscle in one session. With the posture emphasis, upper back and lats
  may run past 16, up to the cap, to keep pull at about twice push; cardio
  doesn't lower them (step 7). Evidence: the tiers **Moderate**
  ([Pelland 2025](https://doi.org/10.1007/s40279-025-02344-w), tiers from its
  preprint); the cap **(H)**, for fatigue and time; the per-session limit
  **Weak** ([Remmert 2025](https://doi.org/10.51224/SRXIV.537), a preprint).
  The proposal's numbers come from code, on the vault's map (the volume
  check below), never by hand.
- **Priority muscles the user named come first** (`intake.md` Round 2,
  question 5, or a request later: "I want abs"): they go into
  `priorityMuscles` and keep the priority tier. The engine keeps every listed
  priority (from 0.15.0): more than the week's room below gives a
  `priority-over-room` warning, never a silent drop. **On that warning, ask
  before proposing:** which come first this phase (up to the room), in one
  question that says the cost ("each priority muscle is 10 to 16 direct
  sets a week: all N make every session longer"); write only those in
  `priorityMuscles`, the rest under the Athlete profile's **Later
  priorities** (the next phase review offers them). Keep more than the room
  only when the user chooses longer sessions knowingly,
  and a priority trained on the short sessions (abs and obliques on
  cardio-and-core days) doesn't use the lifting days' room. A priority muscle's **minimum counts only direct sets taken near
  failure**: sets where it is a main muscle, at 0–3 RIR, holds at 75% or
  more of the user's tested best **(H)**, ladder items at the user's level.
  Half-credit from compound lifts and easy holds don't fill it (engine
  0.11.0's `priority-direct-under` check; the proposal shows the direct
  near-failure count beside the total). The fit swaps a free accessory or
  core slot for a direct one to reach it, names each swap in `why`, and warns
  `priority-short` with what blocked it when it can't. No slot is picked
  below the user's ladder level (a lower level becomes the ladder at the
  user's level). Abs are trained like any muscle:
  a loaded movement with a rep range and double progression (cable crunch,
  ab wheel, hanging knee raise), not only holds.
- **Priority muscles from the goals:** when the profile names none and a
  goal is muscle or recomposition, the posture emphasis's muscles (upper
  back, lats) and then the large ones (quads, lats, chest, glutes), 3 for a
  first goal and 2 for a later one, and no more than the week has room for
  (3 with 4+ lifting days, 2 with 3, 1 with 2 or 30-minute sessions) **(H)**.
  The engine derives them (`proposal.priority`, each with its reason).
- **Strength goals:** add exposures (the lift twice a week) before sets
  (**Moderate**, [Pelland 2025](https://doi.org/10.1007/s40279-025-02344-w)).

## 6. Progression rule per lift

- Double progression by default: `lifts` `lo`–`hi` and `inc` (a step that
  exists: +5 lb dumbbells, +10 lb cable and leg press stacks, +5 kg barbell
  or +2.5 kg with small plates). Adding reps matched adding load
  (**Moderate**, [Plotkin 2022](https://doi.org/10.7717/peerj.14142)).
- The equipment sets the method (`rules.md`, Progression, "By equipment")
  **(H)**.
- Linear progression for novice barbell lifts: `lo` = `hi` (double
  progression then adds `inc` every session the reps are made).
- Calisthenics: the ladders (top of the range on every set, two sessions
  running → next level).
- Load-jump cap: one increment per lift per session **(H)**; about 10% a
  week at most ([ACSM 2009](https://doi.org/10.1249/MSS.0b013e3181915670)).

## 7. Conditioning

- On non-lifting days, or 3+ hours after lifting, lifting first when they
  share a session; a 5–10 min easy finisher after lifting is fine. Cardio
  doesn't cost muscle or maximal strength; same-session work costs
  explosive and trained lower-body strength (**Strong**,
  [Schumann 2022](https://doi.org/10.1007/s40279-021-01587-7)).
- **In the user's own modes:** the conditioning days rotate the cardio the
  user chose (`preferences.cardio`), never one mode three times when they
  named several; at the short days' minutes when some days are shorter
  (`availability.shortSessions`). Easy cardio fills minutes for those who
  like it, not as a better intensity (**Weak**,
  [Storoschuk 2025](https://doi.org/10.1007/s40279-025-02261-y)); cycling or
  low-impact modes when legs are a priority.
- One 4×4 interval session a week when screening allows vigorous work and a
  goal asks for conditioning or health, or the user chose intervals as a
  mode; never the day before a heavy lower-body day (the concurrent rule).
  The engine places it (**Moderate**,
  [Helgerud 2007](https://doi.org/10.1249/mss.0b013e3180304570)).
- Weekly active minutes 150–300 (vigorous counts double;
  [Bull 2020](https://doi.org/10.1136/bjsports-2020-102955), WHO) and a step
  target that rises by phase (today: 6,000 → 7,000 → 8,000 a day) **(H)**.

## 8. Calibration week first

Week 1 of a new plan, and the first week after a 3+ week break: for every
weighted exercise, find a load that leaves 2–3 reps in reserve at the bottom
of its range; for each ladder, the level where the bottom of the range is
clean. No progression decisions and no stall checks that week **(H)**:
people misjudge the reps left by about 1
([Halperin 2022](https://doi.org/10.1007/s40279-021-01559-x)).

## 9. Check-ins and tests

Write the schedule into the roadmap note's Check-ins table: weekly letter
(Sundays), the tape every second Sunday, photos on each light week's Sunday
(the `progress` job), tests at each phase's end (the Saturday of its light
week), the RIR calibration set in each mesocycle's last loading
week, the mesocycle review on each light week's Sunday, the phase review at
each phase's end, re-screening by the profile's `screened` date + 12 months.
Health markers stay on the user's clinician's schedule; the roadmap only
reminds.

**Every row says where it happens**: Pahlavan, or the exact command
(`/fitness-coach checkin` for the letter, `/fitness-coach review` for both
reviews, which replace that Sunday's letter), so the user always knows when
to talk to the coach. Under the table, one line of the any-time reasons
(pain or an injury, travel or missed sessions, missing equipment, a stalled
lift, a new goal, tracking something new, a question about the numbers).

## 10. Targets with predictions

For each goal, a target and a **predicted value** at the phase's end, with a
range (for example "waist 93 → 90–91 cm by week 16"; "bench e1RM +5–10%").
The phase review (`review.md`) scores predicted against actual, so every target needs a number and
the code that will measure it.

## Pre-mortem

Before the proposal goes out: "It's week 6 and this plan has failed. Why?"

1. The coach lists 3 likely failure modes from the data (for example: a
   7-session week against 4.8 actual training days; sleep under 6 h most
   nights; a known crunch month; logging friction; an active Ledger entry).
2. Ask the user for theirs, in plain text; start from the bad-week answer
   in the profile ("you said a bad week means skipped sessions: anything
   else?").
3. Each failure mode gets a countermeasure built into the plan: a smaller
   minimum week, Express as the default on busy days, an if-then plan, a
   light week placed over the crunch week, a swap.

The pre-mortem goes into the roadmap note (its own section) and the Decision.

## The personalization audit (before the proposal)

A table, every intake input against the decision it drove or why it was
left out. It is what makes the plan this user's, and the proposal's first
item comes from it.

**Read the Athlete profile's Standing plan rules first** (sets per exercise,
the session structure, the tools the user prefers, a load ceiling, where the
core work goes, each with its source and date). The engine's draft doesn't
know them (it can give a barbell press or 2-set accessories), so the draft
is changed to meet each one, or the proposal names the rule it breaks and
why, for the user's yes.

| Input | Value | What it did in the plan | Evidence |
|---|---|---|---|
| each Standing plan rule | the rule, its date | met in every session, or the deviation, its reason and the user's yes | the user's rule; preference between equals **Moderate** |
| each self-check result | the number or the result | a ladder level, an exercise in or out, a regression, a warm-up line | **(H)**, the thresholds |
| each Body-assessment row | what was seen | its emphasis applied, or "no change; the tape measures it" | **(H)**, posture as capacity |
| each goal, in order, with its measure | kind, importance, confidence | the modifier, the phases, priority muscles, a target measured that way | the goal modifier's source and grade |
| availability | days, minutes, short days, fixed days | the split, the session length, where conditioning goes | splits equal at matched sets **Strong** |
| preferences | exercises, cardio modes, splits | ranked or left out, the conditioning modes, a comparison factor | preference between equals **Moderate** |
| the bad-week answer | the user's words | the split's skip risk, the minimum week, the first pre-mortem risks | skip risk **(H)**; the minimum week **Moderate** |
| equipment, tracking level, screening, the Ledger | | what each allows or rules out | free weights equal machines **Moderate**; the safety rules |

The Evidence column is one clause: the source (`rules.md`) and its grade, or
**(H)**.

- **Every input gets a row.** "The default" or "the engine picked it" is
  never a reason. An input that changed nothing says what it is for ("age 42:
  under 65, no older-adult changes"; "fat at the waist: no change to
  exercise choice; the tape measures it").
- **Each Body-assessment row shows its effect** in the table; the Body
  assessment itself stays as written in the Athlete profile.
- **At least three candidates compared** (step 1), the scoring table and
  the pick argued from the user's data right under it.
- The engine fills most of it: `proposal.personalization` has one entry
  per input (`input`, `value`, `used`, `effect`, and `with` for inputs that
  set the same decision) and `proposal.templates` its own candidates. Read
  both, check them against the Athlete profile (anything the profile says
  that the JSON can't hold), and add those rows, the Evidence column and the
  coach-built candidates by hand.
- An input that should have changed the plan and didn't (a self-check
  result with no effect, a cardio mode never used) is a gap: fix the draft,
  or say why it stays.

## The volume check on the vault's map (before the proposal)

Pahlavan counts sets per muscle with the vault guide's `muscles`, which can
differ from the engine catalogue's (rear-delt work counted as shoulders, for
one). Check the draft on the vault's map, against the tiers in step 5, and
fix it before showing it:

- **With `--vault .`**, `proposal.volume` is already on the vault's map
  (`proposal.volumeMap.source` is `vault`; `fromCatalogue` lists the
  movements the guide has no entry for, counted with the catalogue's tags
  and written into the guide on export).
- **For any hand edit of the draft, and every candidate the coach built
  (step 1):** save the proposed `plan-data.json` as a scratch copy (never
  over the real file) and count it with `numbers.md`'s scratch-plan snippet
  (`PLAN` set to that copy), which counts as `engine review` does.
- Every muscle inside its tier (priority 10–16, the rest 5–10, none under
  4, none over 20–24, at most 8 direct sets in a session), each priority
  muscle's minimum met by direct near-failure sets (step 5), pull:push at
  about 2:1 with the posture emphasis (the draft aims for 2 and its
  `pull-push` check holds at least 1.8 in each loading week,
  `proposal.volume[].pullPush`; `engine review`'s `volume.pullPush` counts
  the written plan the same way). A muscle outside its tier is fixed
  (a set moved, an exercise swapped) or named in the proposal with its
  reason.

## The proposal (one message)

**Each major decision** (the split, sets, effort, reps and load, rest,
exercises and order, range of motion, progression, conditioning, the light
week, the minimum week) **carries two short clauses:** its reason from the
user's data and its evidence with grade ("upper/lower: 4 free days of 60
min, and you liked it; splits are equal for growth at matched sets,
Strong").

1. **How your data shaped this plan:** the personalization audit's rows
   that drove decisions (the self-check, the Body assessment, the goals in
   order, the bad-week answer, the preferences), and the candidates compared
   (step 1) with why this one won, numbers from code.
2. Phase map: phases, mesocycles, light weeks, test weeks, with dates.
3. The week: sessions, minutes, days (if fixed), the minimum week.
4. Each session: main lifts and accessories, sets × reps, RIR, rest; each
   ladder item with its starting level; **each exercise with its one-line
   Why** (the intake fact, Body-assessment row, goal or rule it comes from).
5. Sets per muscle a week on the vault's map (computed) against the tiers.
6. Progression rules; the calibration week.
7. Conditioning and the step target.
8. Check-in and test schedule.
9. Targets with predicted values.
10. Pre-mortem and countermeasures.
11. What gets written: the files below, and what's archived.
12. What Pahlavan can't express (from the limits below), and how the
    letters cover it.
13. Any tracked item the plan changes: `tracking.md` (written with `track`,
    step 6 below). **Desk breaks are not part of this yes:** for desk work
    only (`profile.json` `work.desk`), they get their own question after
    the plan's yes ("Desk breaks: a 5-minute routine every 90 minutes,
    10:00 to 17:00 on work days, fitted to your hours. Want them?": yes,
    other times, or no). On a no the plan has no `deskRoutine` and
    nothing is tracked.

Ask once. Changes are discussed and the proposal re-shown; nothing is
written before the yes.

## Writing it

On the yes, through `plan-files.md`, in its order:

1. `plan-data.json`: `engine plan … --format plan-data --vault .` gives the
   object, with plan-data's keys in their order and the current file's
   warm-ups, ladders and guide text carried over. A coach-built pick (step
   1) is its scratch copy, which started from that object. Fill what
   `unexpressible` asks for (guide text for new movements, Express, the
   deload S3), run the pre-write check below, show the diff against the
   current file, write it as two-space JSON, then what `Coach/local.md`
   says runs after a plan change ("A change to the plan").
   **Every item's `note` ends with "Why: ..."** (the proposal's line for it,
   under about 25 words), cardio and core items included; check none is
   missing before writing. The user reads the reason wherever the item
   shows, so a plan never looks like a template.
   **The pre-write check**, on the object before it is written (fix it, or
   name the deviation in the proposal):
   - **Sets:** every exercise's `sr` follows the Standing plan rules (now:
     3 sets for every lifting-session exercise).
   - **Structure:** each session holds what the rules ask (now: each
     lifting session a leg, a chest, a back and a shoulder exercise and one
     extra; the core work on the cardio days).
   - **Rest:** every item's `rest` follows step 5 (2–3 min on main and
     heavy compound lifts, at least 90 s otherwise); a superset's second
     item has `pair`, and the two are non-competing muscles. The draft
     writes it so; a hand edit or a coach-built candidate can break it.
   - **Names:** the engine's catalogue names differ from the vault's
     (`Flat dumbbell bench press` is the vault's `Flat DB Bench Press`,
     `Single-leg dumbbell RDL` is `Single-Leg DB RDL`, `One-arm dumbbell
     row` is `One-Arm DB Row`). Map each item to its existing `guide` name,
     and each logged lift to its `lifts` name and the name the log holds.
     Never rename a logged lift: its history (e1RM, stalls, Pahlavan's
     Last) is matched by name.
   - **Why:** every `note` ends with "Why: ..." (above).
   - **Targets:** `Coach/profile.json` has `targets` for this plan
     (`plan-files.md`, step 4).
   The roadmap gets a **"How your data shaped this plan"** section (the
   personalization audit table with its Evidence column, the candidates
   compared, the weekly sets and any deviation with its reason), above "How
   the plan is built".
   Each ladder's starting level goes into the log with `log ladder --id
   <id> --level <level> --date <the plan's first day> --write` (`unexpressible` lists
   the line under "ladder levels"), inside the same yes.
2. **The roadmap note** ("A new roadmap"): the current `6-Month Roadmap.md`
   archived, the new one written under the same file name with its section
   names kept and the pre-mortem added; the targets in `Coach/profile.json`
   `targets` with the roadmap's Targets table (`plan-files.md`, step 4).
3. The month note for the first four weeks (the next-month recipe), with the
   Week by week table showing the calibration week, the light week, tests
   and check-ins.
4. The training calendar, last (see the limits).
5. A Decision entry: trigger "intake" or "reset" or "phase review", the data,
   the rules applied, the expected effect, the review date (the first
   mesocycle review).
6. **The tracked items**, one `track apply` (`tracking.md`, "The tracking
   file"; the dry run with the other writes, `--write` inside the same yes):
   - the desk-break item when the user said yes to desk breaks (step 13)
     and none is tracked:
     `{"kind": "desk", "name": "Desk breaks", "desk": {"followPlan": true},
     "why": "...", "from": "plan"}` (its routine follows the plan's
     `deskRoutine`, its times and days the plan's `deskTiming`); none when
     the plan has none;
   - what the plan changes on an item (training days only, say): the item's
     `id` with the new `schedule`, a change from today;
   - `bodyRecord: {"schedule": "plan"}` when it isn't set (the tape, photos
     and tests then follow this plan's calendar);
   - `bringOver: []` when nothing is recorded yet (a fresh start: Pahlavan's
     bring-over offer never shows).

## Mapping onto `plan-data.json`

| Plan decision | Field | Notes |
|---|---|---|
| Sessions a week | `weekTarget {lift, short}` | Session types rotate regardless of the count: 3 a week over A–D is fine |
| Session types | `liftTypes`, `shortTypes`, `titles`, `shortNames`, `focus` | Adding or removing a type touches every one of these |
| Exercises | `sessions.<T>[]` items `{name, table, sr, rest, note, label, logged, ladder, pair}` | `logged: true` on exactly two items of each lifting session; `pair: true` on a superset's second item (done with the item before it) |
| Sets × reps | item `sr` (`"4 × 6–8"`, `"3 × 8/leg"`) | The deload version is derived (see limits) |
| Rep range, step | `lifts.<name> {lo, hi, inc, db, unit}` | Logged lifts only; a changed range needs `lo`/`hi` changed too |
| RIR target | item `note` (`"RIR 2."`) | No field yet |
| Temporary change | `until YYYY-MM-DD: <why>` at the start of the item's `note` | `review` lists it when due |
| Express (20 min) | `express` | Applies to every lifting session |
| Deload S3 | `deloadS3` | What S3 becomes in a deload week |
| Calisthenics | `ladders`, `laddersFor`, `ladderNote`, item `ladder` | Levels move with `log ladder` (`log.md`) |
| Movement guide, muscles | `guide.<name> {setup, do, avoid, q, muscles}` | Required for any new movement |
| Warm-ups, desk routine | `warmups`, `deskRoutine`, `deskTiming` | `deskTiming` `{every, from, to, minutes?, days?}` sets when the routine runs (`formats.md`, "`tracking.json`"), fitted to the user's working hours: for a 9-to-5, `{"every": 90, "from": "10:00", "to": "17:00"}` (10:00 to 16:00 at every 90 still stops at 14:30). `engine plan --format plan-data` writes the generator's, always Habit Nudges' 90 minutes, 10:00 to 15:00, so change it to the user's hours; left out, those times apply. A bad value is a `plan-data` warning in `engine tracked` and `review`, and the usual times |
| Phase names | `phases [{name, goal?}]`, in order (phase 1 is plan weeks 1 to 8, then 9 to 16, 17 to 24) | Optional; `engine plan --format plan-data` writes the generator's names; without it Pahlavan says "Phase 1"; keep it matching the roadmap's Phases table |
| Targets | `targets` in `Coach/profile.json` (`formats.md`) + the roadmap's Targets table | Together, on every new or changed plan; one the schema can't hold (the wall gap) stays in the roadmap |

## What Pahlavan can't express

`engine plan --format plan-data` lists, for each plan, what it couldn't write
(`unexpressible`); the standing limits:

- **The generator's short days are cardio only,** and its catalogue has no
  cable crunch or ab wheel rollout: abs on cardio-and-core days and those
  loaded ab movements are the coach's to add by hand (a scratch copy, the
  volume check, then `plan-data.json`), as the owner's plan has them.

- **RIR targets** have no field in `plan-data.json`: they live in the item
  `note`; the user's calibration bias lives in the Athlete profile and
  `profile.json` (`rirCalibration`).
- **The rules read the top set only.** Pahlavan's Log can store every set
  with its RIR (Tracking: Every set, `exerciseSets`) and a session's pain
  (`pain`), but the engine reads only the two logged lifts' top sets: e1RM
  uses reps alone, RIR comes from the check-in (`reportedRir`) and pain from
  its pain answer, and e1RM, stalls and next targets exist only for the
  logged lifts.
- **Light-week timing is fixed**: every 4th plan week from the first logged
  plan session, in Pahlavan's Today session and Plan screen, the month note
  and the calendar. An early, moved or cancelled light week can't be set in
  `plan-data.json` (a check-in's cancel or busy-week move reaches only
  `engine review`'s numbers); the letter gives that week's numbers and the
  Decision records it.
- **Light-week shape**: Pahlavan sets every exercise to 2 sets and about 10%
  lighter, not half the sets and RIR +3. Accept it (close for 3–4-set
  exercises); say so in the letter when a 5-set exercise is involved.
- **Phases are 8 weeks** (plan weeks 1–8, 9–16, 17–24) in Pahlavan and
  `review`; plan phases on that clock.
- **What `Coach/local.md` names** (a calendar, a weekly review) may assume
  the week's shape; after a resize, say what reads against the old one.
