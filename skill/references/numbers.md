# Numbers from code

Every number the coach quotes comes from the Pahlavan engine, a CLI bundled in
this skill (`scripts/engine.cjs`, version in `scripts/VERSION`). It runs on any
machine with Node and needs nothing else. Run it from the vault root:

```bash
node .claude/skills/fitness-coach/scripts/engine.cjs review    --vault . --json [--date YYYY-MM-DD] [--plan <draft.json>] [--pretty]
node .claude/skills/fitness-coach/scripts/engine.cjs readiness --vault . --json [--date D]
node .claude/skills/fitness-coach/scripts/engine.cjs session   --vault . --json [--date D] [--mode full|express|hotel] [--type T] [--plan <draft.json>] [--freeze [--lift1 L] [--lift2 L] [--skip "<name>,<name>"]]
node .claude/skills/fitness-coach/scripts/engine.cjs next      --vault . --json --lift "<name or short name>" [--date D]
node .claude/skills/fitness-coach/scripts/engine.cjs check     --vault . --json [--plan <draft.json>] [--redesign] [--date D]
node .claude/skills/fitness-coach/scripts/engine.cjs plan-write --vault . --json --file <draft.json> [--redesign] [--date D] [--write]
node .claude/skills/fitness-coach/scripts/engine.cjs draft     --vault . --json
node .claude/skills/fitness-coach/scripts/engine.cjs overlap   --json --plans <a.json,b.json> [--vault .]
node .claude/skills/fitness-coach/scripts/engine.cjs evidence  --json [--topic volume|effort|load|rest|tempo|order|range-of-motion|exercise-choice|progression|light-weeks|readiness|calibration|concurrent|activity|regions|findings|standing-rules]
node .claude/skills/fitness-coach/scripts/engine.cjs catalogue --json [--pattern <pattern>] [--region <region>] [--muscle <muscle>] [--equipment <e1,e2>] [--level beginner|intermediate|advanced] [--query <text>] [--vault .] [--md]
node .claude/skills/fitness-coach/scripts/engine.cjs validate  <file> --json [--kind profile|program|session|checkin|body|ledger|tracking|nudges|sitting|eating|inbox|letter]
node .claude/skills/fitness-coach/scripts/engine.cjs checkin template --vault . --json [--date D] [--time HH:MM]
node .claude/skills/fitness-coach/scripts/engine.cjs checkin add --vault . --json --file <answers.json> [--write]
node .claude/skills/fitness-coach/scripts/engine.cjs tracked   --vault . --json [--date D]
node .claude/skills/fitness-coach/scripts/engine.cjs habits    --vault . --json [--date D] [--item <id>]
node .claude/skills/fitness-coach/scripts/engine.cjs due       --vault . --json [--date D] [--time HH:MM]
node .claude/skills/fitness-coach/scripts/engine.cjs bring-over --vault . --json [--date D]
node .claude/skills/fitness-coach/scripts/engine.cjs track <action> --vault . --json [...] [--write]
node .claude/skills/fitness-coach/scripts/engine.cjs track day --vault . --json --date D
node .claude/skills/fitness-coach/scripts/engine.cjs track tick --vault . --json --id <id[,id]> --date D [--done true|false] [--amount N] [--write]
node .claude/skills/fitness-coach/scripts/engine.cjs body      --vault . --json --file <record.json> [--replace] [--write]
node .claude/skills/fitness-coach/scripts/engine.cjs log add   --vault . --json --file <session.json> [--no-habit] [--write]
node .claude/skills/fitness-coach/scripts/engine.cjs log ladder --vault . --json --id <ladder> --level N --date D [--write]
node .claude/skills/fitness-coach/scripts/engine.cjs log fix   --vault . --json --date D --type T --lift lift1|lift2 [--label L] [--weight W] [--reps R] [--clear-planned] [--write]
node .claude/skills/fitness-coach/scripts/engine.cjs baseline  --vault . --json --date D
node .claude/skills/fitness-coach/scripts/engine.cjs food      --vault . --json [--date D]
node .claude/skills/fitness-coach/scripts/engine.cjs energy    --vault . --json --pal N [--rate R] [--meals N] [--date D]
node .claude/skills/fitness-coach/scripts/engine.cjs eating    --vault . --json --file <plan.json> [--replace] [--write]
node .claude/skills/fitness-coach/scripts/engine.cjs inbox     --vault . --json [--write] [--phone]
node .claude/skills/fitness-coach/scripts/engine.cjs folders   --vault . --json
```

- **Run each line directly, one command per call.** Each command is run as
  it stands above, in the shell, one per call, so the user sees what ran
  and what it said: never inside a script of the coach's (a node or Python
  file that runs the engine), never several in one call (SKILL.md house
  rule 22). `evidence` is asked by topic (`evidence --json --topic volume`);
  the whole library only when a design truly needs it.
- **It only reads,** except these writes, each a dry run until `--write`
  (after the user's yes): `log add`, `log ladder` and `log fix --write`
  write `fitness-log-data.json` (`log.md`; `log add` also the day's Workout
  tick in the habit check-ins), `checkin add --write` writes `Coach/checkins.json`
  (`checkin.md`), `track ... --write` writes `Coach/tracking.json`
  (`tracking.md`; `track tick --write` also the linked habit in the habit
  check-ins file), `body --write` writes `body-data.json` (one
  date's morning fields, tape and tests; "The write path: `body`" below),
  `eating --write` writes `Coach/eating-plan.json` (the eating plan as
  data; "The eating plan" below), and `inbox --write` applies the phone's
  entries through the same merges and moves them ("The phone's inbox"
  below), and `plan-write --write` writes `plan-data.json` (the whole file,
  once the plan check finds no hard error; "The plan check" below), each
  those files and nothing else. Every other write is a propose-then-write
  step (`plan-files.md`).
- **It reads the check-in answers** (`Coach/checkins.json`) when they exist:
  confirmed sessions, recovery and joint aches, the triage steps the letters
  took, deload cancels, busy weeks, weeks trained at full load, reported RIR,
  and the profile's RIR calibration bias. Without the file, a warning says so.
- **JSON only**, compact unless `--pretty`. `--date` defaults to today; the
  week is the Monday-to-Sunday week holding the date, and nothing logged after
  the date is used.
- **Every rule comes as `{value, reason}`**, with `reason = {rule, title,
  inputs, threshold, note}`: `title` is the plain headline ("Progression",
  "Load cap", "Big jump", "Injury limit", "Readiness", "Soreness", "Unit
  check"). Quote the value with its source and use the note's wording: "bench
  e1RM +0.5 % over 3 sessions, inside the noise band (engine review)". Never
  redo the arithmetic.
- **One lift, one unit.** Every weight of a lift is in its own unit (its
  `lifts` entry, else `liftUnit`), with the weight as logged beside it
  (`logged: {weight, unit}`); a set logged in the other unit counts as the
  nearest weight that lift loads (rounded to its step). Quote the lift's unit,
  and the logged one only to explain a conversion.
- **Exit codes:** 0 ok; 1 the data has a problem (`errors` says what: a
  missing or invalid file); 2 a usage error (a wrong flag, an unknown lift
  name, one of the vault's own files given to `validate`; `errors` says
  which).
- **No plan yet** (a fresh vault after the intake, no `plan-data.json`):
  expected, not an error. `review`, `readiness`, `session`, `tracked`,
  `due`, `habits`, `bring-over`, `food`, `energy`, `checkin template`,
  `track day` and `catalogue --vault .` answer (exit 0) with a `no-plan`
  warning saying what waits for the plan (`energy`: nothing); `check` has
  nothing to check (a `no-plan` note, exit 0); `draft` is the same blank
  plan with a `no-plan` warning (a new plan starts there), and `overlap
  --vault .` compares the drafts with each other only (a `no-plan`
  warning); a draft works as on any vault (`review --plan`, `session
  --plan`, `check --plan`, `plan-write --file`). What needs the plan's own sessions, lifts
  or ladders is exit 1 with a `no-plan` error (and `review` gives no plan
  week, phase or mesocycle): `session --type` or
  `--freeze`, `next` for a lift never logged, `log ladder`, `log fix`.
  `log add` takes a custom session only.
- **`warnings`** are things the engine read around, never a crash: exercises
  not in its catalogue (no abdominal-strain tag), free-text equipment, a test
  result that isn't a number, values out of range, missing coach files,
  `muscle-tags-differ` (a guide entry whose `muscles` copy disagrees with the
  catalogue's tags, which are the ones that count: one item per entry, "Face
  Pull: guide main shoulders, upper-back | catalogue main upper-back, helps
  shoulders"), `muscle-tags-overridden` (for information: the entries that
  keep their own tags, each with its `override` reason),
  `muscle-tags-override-ignored` (an `override` that isn't a non-empty reason
  beside a main muscle: the catalogue's tags count) and
  `muscle-tags-uncounted` (a cardio or mobility entry for a movement the
  catalogue counts as strength work: not counted), `loads-unit-differs`
  (the profile's `loads` are in the other unit than these lifts: their real
  weights are converted to 0.1, so targets land on converted numbers; give
  the lift the gym's unit, or write the loads in the lift's), `unknown-region` and
  `unsupported-region` (a guide entry's `muscles.regions` value that isn't a
  region id, or names a region the evidence doesn't support: it counts
  nowhere; an unsupported one's item gives the nearest supported option and
  why, `formats.md`), `region-parent-missing` (a guide region whose muscle
  the entry doesn't tag in main or helps: it counts nowhere),
  `legacy-default` (the
  standing rules the plan leaves to Pahlavan's old default, one item per
  rule, and the lifts without a progression rule: write them at the next
  check-in, `formats.md`), `rules-invalid` (a rule written in a way
  Pahlavan can't read: the old default stands until it's fixed),
  `draft-plan` (the numbers come from the draft `--plan` names, not the
  plan as written), `no-plan` (no `plan-data.json` yet: what waits for
  one) and `version-differs`
  (`review` and `check`: Pahlavan in this vault carries another engine
  than this coach's, read from its `main.js`; the message says which is
  newer and what the user does: a newer Pahlavan, Update the coach in its
  settings; a newer coach, update Pahlavan from Community plugins).
  Mention the ones that touch the answer; `version-differs` always, once.
- **The self-check:** `scripts/selfcheck.mjs` runs every line of the block above (placeholders filled with safe values, `--write` dropped, so nothing is written), checks that the fields the next table names are in the output and that each command's flags match `--help`, and holds the docs to the engine's facts (`engine --version --json` gives `facts`: the calibration RIR, the volume tiers, the default light week, the region rules, plan-data's keys and every `unexpressible` kind, read from the engine's own constants); `npm run ship-skill` runs it after each ship, and each failure names what to fix. The same `facts` give `why`, what the plan's Why this plan card takes: `splitKinds` (each split family's `id` and the `label` Pahlavan shows) and `grades` (`plan-files.md`, "The Why this plan card").

## Which command answers which question

| Question | Command | Fields |
|---|---|---|
| Where the vault keeps the files (the fitness folder, the habit check-ins) | `folders` | `folders`, `source` (`settings`, `found`, `default`), `paths` (every file's path) |
| The week's numbers (the check-in, the letter) | `review --date <Sunday>` | all of the below |
| Next week's lift targets ("what should I lift next week") | `review --date <the Monday after>` | `lifts[].next`, `week.deload`, `temporaryChanges.due` |
| Sessions against target, 4 weeks | `review` | `adherence` |
| Readiness, should today be trimmed | `readiness` (or `review`'s `readiness`) | `latestScored`, `actions` |
| Today's session, as it should be done | `session [--mode express\|hotel]` | `items`, `flags`, `warmup`, `finisher` |
| Another of the plan's sessions today ("I want to do C today") | `session --type C` | `session`, `choices`, `items` |
| Training load, this week and next | `review` | `load` |
| Which muscles have been sore | `review` | `soreness` |
| How often each exercise was done as planned, skipped or swapped this cycle, and why; when it was last done | `review` | `exercises` (each row's `note` to quote; `last4` the last 4 weeks) |
| When a lift last rose this cycle (its last PR, as Progress marks it) | `review` | `lifts[].lastRise` (also on its `exercises` row) |
| Pain by exercise this cycle, rising or falling | `review` | `pain.byExercise` |
| One lift's target, e1RM and stall | `next --lift "<name>"` | `lift` |
| Weight pace against the goal | `review` | `weight.rate`, `weight.band` |
| Sets per muscle, planned and done | `review` | `volume` |
| Pulling against pushing sets (the posture emphasis's pull:push) | `review` (a draft: `review --plan <draft.json>`) | `volume.pullPush` |
| Is a deload due, after missed time what now | `review` | `deload`, `deloadPrescription`, `missed` |
| The standing rules the numbers follow (the plan's own, or the old default the plan leaves) | `review` | `rules`, `lifts[].progressionRule` |
| Is a plan, or a draft, inside the guardrails (hard errors stop a write; evidence warnings with their rule and grade; the overrides applied) | `check [--plan <draft.json>]` | `findings`, `summary` |
| A draft's numbers before it is written (sets per muscle, each session's minutes, the targets): what Pahlavan will show once it is | `review --plan <draft.json>` | `volume`, `time`, `lifts[].next`, `sources.plan` |
| A blank plan to design a new one from: each candidate of a new plan starts here, never from the plan as written (`planning.md`, step 1.4) | `draft` | `planData`, `from.carried`, `from.weekTarget` |
| How much plans share: the candidates against each other, and each against the plan as written (over half reads as an edit) | `overlap --plans <a.json,b.json> --vault .` | `pairs[].aInB`, `.bInA`, `.shared`, `againstCurrent`, `similar`, `limit` |
| Is a redesign inside the guardrails, and how much of the plan as written it keeps (its changes as information, the share kept warned over half) | `check --plan <draft.json> --redesign` | `findings`, `summary`, `redesign` |
| Write a draft plan, after the user's yes (the check again, the diff; a redesign with `--redesign`) | `plan-write --file <draft.json>` (then `--write`) | `result`, `diff`, `overrides`, `findings`, `written` |
| The rules a plan is designed from, as data: each rule's number (the engine's own), grade, note and sources, and the `check` warnings that hold a plan to it | `evidence` | `rules[].value`, `.grade`, `.note`, `.sources` |
| The muscle regions with their grades and the catalogue movements that bias each; the regions the evidence doesn't support, with the nearest supported option | `evidence --topic regions` | `regions.list[].movements`, `regions.unsupported[].nearest` |
| How a finding is confirmed, and where the answer goes | `evidence --topic findings` | `findings.answers`, `findings.selfCheck`, `findings.emphasis` |
| The standing rules a plan can declare, and the old default each falls back to | `evidence --topic standing-rules` | `standingRules.kinds[].legacyDefault`, `standingRules.lift` |
| Movements for a pattern, region, muscle, the equipment at hand or a level (options, never a choice), with their muscles, regions, strain tag, level, easier and harder versions, other names, demand tags and guide text; the ladders | `catalogue --region <region> --equipment <e1,e2>` | `movements[].muscles`, `.regions`, `.abdominalStrain`, `.easier`, `.harder`, `.aliases`, `.risk`, `.guide`, `.fit`, `ladders` |
| Is a coach file well formed (the engine's own kinds; the vault's own files are refused) | `validate <file>` | `kind`, `valid`, `errors` (`vaultFile` for a refused one) |
| What to ask at the check-in, and what's already known | `checkin template` | `record`, `ask`, `known` |
| Save the check-in's answers | `checkin add --file <f>` (then `--write`) | `results`, `written` |
| Protein a day for the goal, and the protein item's target | `review` (or `tracked`) | `weight.protein`, `weight.proteinFloorG` (`tracked`: `protein`) |
| What is tracked, the open suggestions, the morning time, the body record | `tracked` | `items`, `suggestions`, `morning`, `bodyRecord`, `deskBreaks`, `protein` |
| Which reminders Pahlavan's quiet hours hold (later, or never) | `tracked` (or `due`) | `quiet.held`, `items[].quiet` |
| An item's streak and 30-day adherence (the mesocycle review) | `habits [--item <id>]` | `items[].streak`, `.adherence`, `.grid`, `tiles` |
| Stand-up minutes from the card and at the desk (Standing now), 30 days | `habits --item <stand-up id>` | `items[].standing` |
| Sitting time against its limits, 4 weeks | `habits --item <sitting id>` | `items[].sitting` |
| Stand-up minutes (with the desk's share) or desk breaks done, a day for 4 weeks, against the day's target | `habits --item <stand-ups or desk-breaks id>` | `items[].bars` |
| What is due now and today | `due [--time HH:MM]` | `due.value.cards`, `today.value`, `quiet` |
| Add, accept or decline a tracked item; the morning card; the body record's schedule | `track <action>` (then `--write`) | `results`, `after`, `handOver`, `written` |
| One day's items, what is still open, the session and the morning (the daily wrap-up) | `track day --date D` | `items`, `open`, `notDue`, `training`, `morning` |
| Tick the day's supplements and ticks, or set an amount (the daily wrap-up) | `track tick --id <ids> --date D` (then `--write`) | `results`, `habitChanges`, `after`, `written` |
| Record measurements in the body log (the intake's weight, waist and tests, as the cycle's first entries) | `body --file <f>` (then `--write`) | `results`, `after`, `written` |
| A fresh start's Baseline note: its name, dates and text | `baseline --date <the intake's day>` | `path`, `exists`, `text`, `firstPhotos`, `firstTests` |
| The eating plan's numbers (the diet job): resting energy, maintenance at the activity factor, the goal energy for a rate or the goal's range, the floor and the 1 % a week limit, protein a day and a meal, fat and fiber, the figures as `eating-plan.json` keeps them | `energy --pal N [--rate R]` | `rmr`, `maintenanceKcal`, `target`, `refused`, `floor`, `belowFloor`, `protein`, `proteinRange`, `fatMinG`, `fiberMinG`, `eatingPlanFields` |
| The eating plan day to day, as Pahlavan's Food tab shows it: protein days, the planned protein, the waist and weight trend against the plan, the adjustment rule's status, the pattern | `food [--date D]` | `protein`, `trend`, `adjust`, `pattern`, `why` |
| The Food tab's plan in words, the day's timeline, the light checks | `food [--date D]` | `words`, `day`, `checks` |
| Is the adjustment rule due, and what does it say (a review date, a tape day) | `food --date D` | `adjust` (its note is the sentence to quote) |
| Save the eating plan as data, or a change to it | `eating --file <f>` (then `--write`) | `result`, `changed`, `plan`, `written` |

## `review`

| Field | What it is |
|---|---|
| `week` | `planWeek` (counted from the plan's `start` when plan-data has one, the week holding it being week 1, and null before it; else from the first logged plan session, as Pahlavan counts, and until the current cycle has a plan session, from the cycle start's Monday, so a fresh start is week 1 from its first day), `planStart` (week 1's Monday), `phase`, `mesocycle`, `weekInMesocycle`, `mesocycleWeeks` (to its light week; null after the plan's last listed one), `deload` (the plan's light weeks, `rules.lightWeeks`; every 4th plan week by default), `deloadNext` |
| `thisWeek` | The week's sessions (type, lifts, minutes, rating, skipped items, notes); `lifting` and `short` `{done, target}`, `custom`, `cardioMin`, `trainedTicks` and `proteinTicks` (the habit ticks) |
| `adherence` | The 4 complete weeks ending on the Sunday on or before the date: per week `lift`, `short`, `custom`, `days`, `habitDays`, `ticksWithoutLog`, `gaps {unlogged, missed, rest}`; `lifting` and `short` `{done, planned, pct}`; `meanSessionsPerWeek`, `meanTrainingDays`. A lower bound: ask about gaps first |
| `readiness` | This cycle's mornings only (`since`, the cycle start): `baseline` (`mornings` this cycle, `needed` 14, `building` until then, with the note to quote: "Building your baseline: n of 14"), `today` (the date's score), `latestScored` (date, R, S, band, z per signal, flags: `rhr-flag`, `hrv-flag`, `short-sleep`, `illness`), `last14` (the last 14 days with a readiness signal), `scoredDays`, `hrv` (the HRV note for the latest check-in: `flag` when HRV is 20% or more under its 28-day geometric mean that morning and the one before, `value`, `dayBefore`, `usual` and `limit` in ms, `days` of HRV in the baseline, `building` under 14; its note is the line to quote; a note only, never a change on its own), `actions` (`trim`, `early-deload`, `no-hard-training`, `no-tests`, each `active` with its note; `no-hard-training` on the RHR flag, illness, or the HRV note with the RHR flag or a low band, its inputs saying which; a stale check-in is named; nothing trims while the baseline builds). A morning is scored only with a card answer (energy, soreness or sleep quality) among its scored signals: sleep hours, resting HR and HRV alone leave it unscored |
| `weight` | `trend` (EWMA from the cycle start, the newest `Baseline - <date>.md`), `rate` (the least-squares slope over 28 days: `kgPerWeek`, `pctPerWeek`, or why not yet), `band` (the rate against the profile goal's band, or the roadmap's -0.25 to -0.5 kg/wk without a profile; `source` says which), `dashboard` (the old dashboard's 7-day trend and rate, for reference only), `protein` (the range by goal with its reason: lifting goals 1.6–2.2 g/kg, health-only or endurance 1.2–1.6, the upper half in a deficit, PROT-AGE's floor at 65+; `value.gPerKg`, `grams`, `targetG`), `proteinFloorG` (the range's floor at the trend weight: the protein item's target and the check-in's protein question), `tape` (this cycle), `last7` (sleep, steps, floors, resting HR: mean, days covered, through) |
| `lifts[]` | This week's main lifts, then every other lift with a logged top set: `unit`, `increment`, `repRange`, `last` top set, `sessions`; `e1rm` (Epley, best of 3, `change` over 3 sessions, `verdict` up / down / noise, `unitFlag` for a likely kg/lb mix-up with `ignored` older top sets); `lastRise` (this cycle's, from the cycle start: the latest e1RM above every earlier one since it, the last PR Progress marks at its default scope: `date`, `e1rm`, `sessionsSince`, `daysSince`; null with its reason when there is none this cycle yet, or no e1RM because reps + RIR is over 10 on every set; its note and `inputs.before` give the best e1RM before the cycle, as context); `stall` (`stalled`, or why not: progressing, an adherence question, too few sessions); `triage` (the four steps, `chosen` the one for this check-in) when stalled; `next` (action, weight, reps, RIR, with the load cap applied; with the profile's `loads` the weight is one the gym has: an increase the nearest real weight up, a lighter target the nearest one down, and at the heaviest action `hold` with one rep more, title `Load ceiling`, "the heaviest dumbbell here is 30 kg, so reps carry it"; when even the next real weight is over the cap, action `hold` with one rep more and the reason in the note; `realWeights` in its inputs gives the kit's lightest and heaviest); in a calibration week (plan week 1, or the 7 days from the first session back after 3+ weeks off) `next` is the calibrated target (action `calibrate` at the bottom of the range and RIR 3 or more: the last weight held, or the lighter ease-back one; after a restart only a weight found since coming back, else none), `heldProgression` what progression would have given, and `stall.status` is `calibration` (no stall feeds triage or the deload triggers); the e1RM trend starts at the latest calibration week; `returnAdjusted` in the first week back after 1-2 weeks off, except in plan week 1, where the lighter weight is already in `next`. `progressionRule` is the lift's rule (`lifts[name].progression`, else the old default's double progression); `next`'s note starts with that rule, the plan's or the default. Rule `target` gives action `target` with `targetMet`; under the plan's own rule an increase over the load-jump guide is reported (`loadCap.applied: false`), never capped. A stall the rule answers with a drop gives the lighter `next` and `stallReset` (what progression gave). Under `rules.stall.response: "report"` `triage` is null and `stallFacts` holds the facts for the coach (sleep, readiness, recovery, aches, the weight rate, weeks to the light week and the mesocycle end, the muscle's weekly sets) |
| `volume` | Every count uses one set of muscle tags: the catalogue's for a movement it knows, the guide's for one it doesn't or with a `muscles.override` reason, on plan-data's 14 groups with a main muscle never also a helper (`muscle-tags-differ` lists guide copies that disagree). `planned` (this week's plan, each session type weighted by target / types; `overSession` lists more than 8 direct sets for one muscle in a session; `notCounted`), `done` (the week's sessions, an estimate from the plan snapshots minus skipped items), `bands` (planned sets per muscle against the tiers: under 4, 4-10, 10-16, 16-20, over 20; `priority-low` for a priority muscle under 10), `doneTiers`, `pullPush` (the planned week's pulling against pushing sets, counted as `check` counts them: by movement pattern, or by main muscles for an exercise with none; `pull`, `push`, `ratio`, `target` 2 and `floor` 1.8 under the posture emphasis (null without it), `status` `ok`, `below`, `no-target` or `no-pushing`, `pulling` and `pushing` per exercise; its reason's note says how many sets would reach the floor), `regions` (every modelled muscle region, in `formats.md`'s order, each a reason object: `id`, `muscle`, `label`, `grade`, `coverage`, `roughGuide`, `declared` (the profile's `priorityRegions` and the regions of an `emphasis` row not declined), `priority` (its muscle a priority muscle, or the muscle of a declared region); the planned `sets`, `direct` (its muscle main: 1 a set), `indirect` (its muscle helping: half), `hardDirect` and `unknown` (the direct sets by effort); `done` `{sets, direct, indirect}`, the week's; `rule` `declared` (`min` 6, `counted` the direct sets near failure, an unknown effort counted), `coverage` (a priority muscle's coverage region: `min` 4, `counted` the direct sets) or null; `status` `ok`, `short` or `reported` (no rule: a muscle that isn't a priority, the heuristic and rough-guide regions, the upper chest); the reason's note is the target in words). `planned.value.regions` and `done.value.regions` are the tallies under it (left out when nothing biases a region); the muscles' own counts never change with them |
| `deload` | `planWeek`, `scheduled`, `weeksToScheduled` (null when the plan lists no light week ahead), `signals` (every early signal that fired: readiness low 5 days with a falling e1RM, stalls on 2+ main lifts, poor recovery; and a busy-week move), `triggers` (the signals acted on: all of them under the old default, none unless the plan's `rules.lightWeeks.early` is `"apply"`), `deload`. Under the plan's own light weeks no busy week moves one and no check-in cancels one: the coach edits the plan |
| `deloadPrescription` | Only under the old default, when a deload is this week or next: where Pahlavan's light week (2 sets) and rules.md's deload (half the sets, RIR +3) differ |
| `rules` | Each standing rule the review applied (`calibration`, `lightWeeks`, `tests`, `readiness`, `soreness`, `missed`, `stall`, `hotel`, `express`, and `lifts` by name): `source` (`plan`, or `legacy-default` where the plan sets none), `path` (where it's written in plan-data.json), `value`, `text` (the rule in words, as reasons cite it) |
| `missed` | The return protocol by the plan's `rules.missed` (else the old default): `continue`, `ease-back` (1-2 weeks off by default: the first week `loadFactor` lighter, 0.9x, and `rirAdd` more RIR, +1), `restart` (3+ weeks by default: mesocycle week 1 with a calibration week, or easing back when `rules.calibration.afterRestart` is false); days off and gap days ticked or marked |
| `nextInRotation` | The next lift and short session type |
| `concurrent` | The plan week on the user's real week (`concurrent.week`, rule `concurrent.week`: each session on the weekday the cycle's log shows it most often over 2 to 4 complete weeks, else the profile's `availability.fixedDays`, else the fixed layout, lift Mon, Tue, Thu, Fri and short Wed, Sat, Sun; `layout[].source` is `log`, `available` or `default`) and its flags: conditioning before lifting, hard leg intervals under 24 h before heavy legs, the same muscle hard two days running. A muscle trained hard two days running is flagged unless the second day is the lighter one for it; a set at RIR 4 or more is not hard (hard: a main lift or a compound pattern, not a hold). `backToBack` lists every such pair, allowed and flagged: `first`, `second`, `muscle`, `firstLoad` and `secondLoad` (each day's heaviest work for it as the reps its load allows, the bottom of the range plus RIR; null when a prescription is missing), `lighter` (true: allowed, a heavy day followed by its lighter day) and `suggestion`. A draft (`review --plan`) is checked with the same rule |
| `temporaryChanges` | `due` (until date on or before the date) and `active`; each with the session, item, reason and `wayBack` (the item a "Replaces" note names) |
| `ledger` | With `Coach/ledger.json`: this week's exercises the Ledger blocks, or allows with conditions, with swaps |
| `ladders`, `tests` | Each ladder's `level` and `since` (the day the logged level was set), with its reason; `from` says where the level comes from: `log`, `plan` (the plan's `startLevel` before any level is logged: `since` null) or `lowest` (neither: `level` 0, not set); `testShowsLevel` when this cycle's latest test is ahead of that level (only for ladders a plan session carries); `tests.value`, the latest value of each test from this cycle (its reason names tests before the cycle start, left out) |
| `load` | Training load (session RPE x minutes): `thisWeek` and `last4` (load, the daily loads, monotony, strain; unknown without a session RPE, or estimated from the check-in's effort) and `nextWeek` (each planned session's typical minutes x a planned effort, a heuristic) |
| `soreness` | `today` (the morning body map), `thisWeek` and `last4Weeks` (sore and mild days per muscle, for the mesocycle review's per-muscle feedback) |
| `time` | Each planned session's estimated minutes (warm-up, cardio from `sr`, each set's work and rest) against the profile's session lengths: `sessions`, `limits`, `over` (the types over; a `time-over` warning names them). Lifting days are checked but Pahlavan shows their logged length |
| `pain` | The week's pain reports, from the log's sessions (`pain`) and the Sunday check-in's joint aches, each with the pain rule's verdict (`fine` up to 3 of 10 that settles, `swap` over 3 or lingering, `professional` the same area 14+ days apart or worse, `ask` a log report with no severity given that didn't linger or persist: ask how bad it was); `worst`. One warning for any pain over 3 of 10 in the last 7 days. `byExercise` (rule `pain.trend`): the reports since the cycle start by exercise (a name matched to the plan's exercise by its id, plan name, short name or catalogue id), by area where none is named (the check-in's aches); each `{key, exercise, area, areas, reports, count, first, last, max, latest, direction, verdict, notGiven, painSkips}`: `direction` is the latest given severity against the one before it (`rising`, `falling`, `steady`, `single` under two given), `verdict` the worst of its reports, `painSkips` its skips for pain; a severity not given (`null`, `notGiven`) is never read as a number and is left out of `max` and `direction`. Pain comes from the structured field only: notes are never read for it |
| `skips` | The last 4 weeks' skipped items by exercise with their reasons (`checklist.why`: time, pain, equipment, energy) and `flags`: the same exercise skipped for pain twice (the pain rule's swap), for equipment twice (suggest a swap), time on 2 or more sessions of a week (with `time`'s minutes), energy on a low-readiness day (a note only); pain and equipment are one `skip-pain` and one `skip-equipment` warning. Hotel sessions (`thisWeek` sessions' `hotel`, `lifts[].hotel`) are left out of the e1RM trend, the stall check and `next`; a session logged with every set feeds each lift's best set to the trend and its logged RIR to `next` |
| `exercises` | Each exercise the plan held in the logged sessions (rule `exercises`), since the cycle start (`from`) and over the last 4 weeks inside it (`last4From`, `last4`): `planned` (in a session's frozen plan; an Express session's left-out items are not planned that day), `asPlanned`, `skipped {n, reasons}` (time, pain, equipment, energy, `none`), `swapped {n, why, to}` (`why`: `mine`, `ledger`, `soreness`, `hotel`, `unknown` for an older entry saved without one; `to`: what was done instead, `{name, n}`), `unrecorded` (an older entry with no checklist and none of its sets logged: done or skipped can't be told), `lastDone`, `note` (the row in words, to quote), and `lastRise` for a logged lift (as `lifts[]`). A swap counts for the exercise it replaced. `sessions`, `unrecordedSessions`, and `leftOut` (sessions with no saved exercise list, whose plan is today's) |
| `checkins` | What the check-in answers contribute: the file's state, the latest record, `fatigue` (recovery and joint aches), `recoveryTrigger`, `knownBusy`, `cancelledDeloadWeeks`, `trainedAtFullLoad`. Each lift's `triageStart` says where its triage resumed |

## The plan check: `check`, drafts and `plan-write`

The coach designs the plan; the engine calculates and checks it. Three
commands, in this order for every plan change (`plan-files.md`, step 3), on
a draft: a whole `plan-data.json` saved as a scratch file outside the vault,
read in place of the vault's through exactly the same reading.

- **`check [--plan <draft.json>]`**: the plan (or the draft) on the date
  against the guardrails. `findings`, each `{code, level, message, items,
  rule, grade, reason, override}`, errors first; `summary` `{errors,
  warnings, info, overridden, ok}`; the same findings in the envelope's
  `errors` (the hard ones) and `warnings` (the rest, each with its
  `level`). Exit 1 on a hard error. With no plan yet and no `--plan`,
  nothing to check: one `no-plan` note (information), exit 0. **It screens on `--date`** (default
  today): the Ledger's constraints active that day, the plan's temporary
  changes as they stand that day. A draft for the weeks after a constraint
  ends is checked with `--date` in those weeks.
- **`review --plan <draft.json>`** (and `session --plan`): the draft's
  numbers, what Pahlavan will show once it is written (sets per muscle and
  region, each session's minutes, the targets); `sources.plan` is
  `{file, draft: true}` and a `draft-plan` warning says so. A draft works
  the same on a vault with no `plan-data.json` yet (a first plan).
- **`plan-write --file <draft.json>`**: the draft checked as `check
  --plan` checks it (a hard error refuses it: `result: "refused"`, exit 1),
  `overrides` (the warnings an override turned into information, with the
  reason), and `diff`, key by key against `plan-data.json` as it is
  (`{path, change, before, after}`: `sessions.A["Face Pull"].sr` changed
  from "3 × 15" to "4 × 15", `lifts["Goblet Squat"]` added, `sessions.B`
  reordered). `result` `unchanged` writes nothing. With `--write`, after the
  user's yes: the whole file (the draft's keys in its order, two-space
  indent) through a temporary file renamed over it, read back.
- **`--redesign`** (on `check --plan <draft.json>` and `plan-write --file
  <draft.json>`): the draft is a redesign, a new plan in place of the one
  written rather than a change inside it (`planning.md`, "The order"). Its
  exercise changes against the plan as written are information
  (`redesign-changes`) in place of `exercise-change` warnings, and
  `similar-to-current` warns when over half of the draft's movements are
  in the plan as written (a heuristic; its items are the shared movements,
  so an override answers one, a main lift kept for its trend, or with no
  `item` all of them; how movements are matched: "A new plan from blank:
  `draft` and `overlap`" below). The output carries `redesign: true`.
  Nothing is stored in the plan: the switch goes on each run, and on
  `check` without `--plan` it is a usage error (exit 2).

| Level | What | Codes |
|---|---|---|
| `error` | Blocks a write; no override clears it | `ledger-blocked` (a movement an active Ledger constraint rules out, by id or abdominal-strain tag, with swaps), `screening-blocked`, `screening-limit` (the screen's RIR floor, full-body sessions, easy cardio only), `invalid-data` (an item with no name or `sr`, a field of the wrong type, an unknown item or lifts key, a session type the sessions don't hold, a malformed `overrides`), `plan-item-field`, `muscle-tags-duplicate` (a muscle in main and helps of an entry whose tags count), `unknown-ladder`, `rules-invalid`, `lift-entry`, `plan-data`, `until`, `no-lift-entry` (a logged lift with no `lifts` entry), `override-without-reason`, `why-shape` (the plan's `why`, the Why this plan card, can't be read as written: a wrong type, an unknown key, an unknown or repeated family, no `lead`, `date` or `split`, a reason without `title` or `text`, a bad `grade`; `plan-files.md`, "The Why this plan card"), and the plan, profile or Ledger file unreadable (`json`, `profile`, `ledger`) |
| `warning` | Evidence or the person's own limits; an override with a reason makes it information | `volume-below-minimum` (Moderate), `volume-over-cap` (H), `priority-under` and `priority-over` (the priority muscles, the profile's, declared regions' muscles and confirmed lagging areas, against 10–16, the minimum counting direct sets near failure; Moderate), `priority-room` (more of those priority muscles than the week has room for: 3 with 4 or more lifting days, 2 with 3, 1 with 2 or 30-minute sessions, at the profile's minutes, a priority trained only on the short sessions not counted (direct sets on a lifting day count); H: the coach proposes which come first with their reasons and the user confirms, the rest under Later priorities; at a check-in, raised once), `session-cap` (Weak), `rir-by-type` (H), `rep-range` (Strong), `rep-range-rir` (Moderate), `rest` (Moderate; core, skill and carry work aside), `rest-heavy` (Weak), `pull-push` (H), `no-light-week` (more than 6 loading weeks running; H), `time-over` (the profile's day lengths), `plan-rule` (the profile's `planRules`), `equipment-missing` (a catalogue movement the profile's `equipment` doesn't cover, a tool that stands in for the defining one counting and bodyweight always, cardio left out: a fact the profile states, no grade; swap it, add the tool to the profile, or an override says why it stays), `disliked-movement` (a movement on the profile's `preferences.dislikes`: a fact, no grade; swap it, or an override says why it stays), `step-not-in-gym` (a lift's `inc` the profile's `loads` can't make, a 1 kg step on 2 kg dumbbells or a 1.25 kg step on a bar whose smallest pair is 2.5 kg, with the nearest step the kit makes: a fact, no grade; set that `inc`, correct the loads, or an override says why it stays), `load-jump` (H), `exercise-change` (against the plan as written, with `--plan`, inside a mesocycle, main lifts inside a phase; Weak; with `--redesign`, `redesign-changes` information instead), `similar-to-current` (with `--plan` and `--redesign`: over half of the draft's movements also in the plan as written, its items the shared movements; H), `start-changed` (against the plan as written, with `--plan`: the draft drops or moves its `start`, which would restart plan week 1; a reset answers it with an override), `rir-differs` and `timed-differs` (a field its note or `sr` contradicts; RIR compared only when the note names one), `session-unlisted` (a session neither type list names: never shown or counted), `ladder-start` (a ladder item with no level in the log and no `startLevel` on its ladder: counted as the ladder's lowest level; formats.md, "A ladder's starting level"), `region-coverage` (a coverage region of a priority muscle, or of a declared region's muscle, under 4 direct sets a week; H), `region-declared-short` (a declared weak region under 6 direct sets near failure a week; H), each item with up to 5 options: catalogue movements that bias the region and fit the profile's equipment, the Ledger, the dislikes and the findings acting in full (a confirmed limited overhead reach leaves the overhead presses out), best first, "(in the plan)" where more sets would do; `no-why-card` (the plan has no `why`, the Why this plan card: a candidate still being compared may skip it, the plan that is written has it), `why-split-missing` (the split families the card names nowhere, listed: each family is picked, compared or left out), both with `why-shape` under rule `plan.why-card`; `no-why`, `week-override-in-note`, `logged-count`, `no-muscles`, `muscle-tags-differ`, and the adapter's other plan notes |
| `info` | Read around, or answered | `region-uncoverable` (a region short of its rule that no catalogue movement can cover with the equipment and the Ledger, with what ruled each out: not a failure), `redesign-changes` (with `--redesign`: the exercises a redesign changes against the plan as written, for the record), `muscle-tags-overridden`, `rir-in-note`, `timed-in-note`, `unknown-exercise`, `snapshot-rebuilt`, `legacy-default`, `ledger-conditions`, `draft-plan`, `override-unused`, and every warning an override answered (with `override`) |

- **What is checked:** the plan's ordinary loading week (not its light or
  calibration weeks, which derive from it), each session weighted by the
  weekly target as `review` weighs it, temporary changes as on the date. The
  log's and the body record's single-record notes stay `review`'s.
- **Overrides:** the plan's `overrides: [{code, item?, reason,
  decision?}]` (`formats.md`). One matching a warning's code (and its item,
  when it names one: a muscle by id or label, "A Face Pull", a session
  type) turns that warning, or that item, into information carrying the
  override; the rule and grade stay with it. It never applies to a hard
  error, an override without a reason is one, and one matching nothing is
  listed in `override-unused`.
- Quote a finding's `reason` and grade, never a range from memory.

## A new plan from blank: `draft` and `overlap`

A new plan is designed, not edited from the old one (`planning.md`, step
1.4): each candidate starts from a blank draft, and the engine measures how
much the candidates share with each other and with the plan as written
(the reconcile step, `planning.md`, step 1.7). Both only read.

- **`draft --vault . --json`**: `planData`, a blank plan in plan-data's key
  order: `liftTypes` and `shortTypes` empty, `sessions`, `lifts`, `guide`
  and `rules` empty, and `weekTarget` from the profile's days (its
  `availability.shortSessions.days` the short sessions, the rest lifting
  days; else 0 and 0). From the plan as written it carries only `start`
  (so the plan weeks keep counting), `liftUnit` (else the profile's
  `units.load`, else kg) and the desk breaks (`deskRoutine`,
  `deskTiming`): nothing about the training, and never its `why` (each
  candidate and every redesign starts without one; `no-why-card` on a
  candidate is expected). `from` says where each came
  from: `liftUnit` and `weekTarget` as `plan`, `profile` or `default`, and
  `carried`, the keys taken from the plan as written. With no plan yet it
  is the same blank plan, with a `no-plan` warning. The coach saves
  `planData` as each candidate's scratch file and designs into it.
- **`overlap --json --plans <a.json,b.json,...> [--vault .]`**: how much
  plans share, by movement. A movement is a session item that is not timed
  (cardio minutes, intervals) and not cardio in the catalogue; it is
  matched by one identity: the ladder's id for a ladder item (every level
  is one movement), else the catalogue's id (so a plan's `Flat DB Bench
  Press` and the catalogue's name for it are one movement), else the name
  as the catalogue match reads it (lowercased, "DB" read as dumbbell).
  Sets, reps and the day never count. `drafts[]` gives each file's
  `movements` (`id`, `name`, `source` `ladder`, `catalogue` or `name`, and
  the `sessions` that hold it) and `shape` (`liftDays`, `liftSessions`, and
  `sessions`, each with its `type`, `kind` and its items' movement
  `patterns` in order). `matrix` and `pairs[]`
  (`a`, `b`, `aInB`, `bInA`, `shared`) give the share of one plan's
  movements the other also holds, both ways: it is not symmetric (a small
  plan inside a big one is all shared one way and little the other). With
  `--vault .`, `current` is the plan as written and `againstCurrent[]`
  each draft against it (`draftInCurrent`, `currentInDraft`, `shared`);
  with no plan yet both are null, with a `no-plan` warning. `similar[]`
  lists each share over `limit` (over half, a rough guide: `evidence
  --topic exercise-choice`'s `choice.redesign-overlap`, a heuristic), one
  direction each (`a`, `b`, `share`), with `current` true for a draft
  against the plan as written. A file that isn't there, isn't JSON or
  holds no `sessions` object is exit 2, naming it.
- **What the shares are for:** two candidates over half against each other
  are one plan twice; a redesign over half against the plan as written
  reads as an edit of it. Each is answered with a change or a stated reason
  (`planning.md`, steps 1.4 and 1.7), and against the plan as written the
  share is information for the pick, never a score. `check --plan <draft>
  --redesign` gives the same share as its `similar-to-current` warning
  ("The plan check" above).

## The evidence library and the catalogue: `evidence`, `catalogue`

The coach designs the plan from these two and measures each draft with
`review --plan` and `check --plan` ("The plan check" above). Both only
read, and neither chooses anything for anyone.

**Ask `evidence` by topic.** The whole library is about 50 KB of JSON,
read whole only when a design truly needs all of it;
`--topic volume` (or `effort`, `regions`, `standing-rules`, ...) gives the
part a question needs (every output's `topics` says what each covers). Quote a rule's `value` with its `grade` and a source; never a range
from memory.

- **`evidence [--topic T]`**: the rules the coach designs from, as data.
  `rules[]`, each `{id, topic, title, value, unit, grade, note, sources,
  engine, checks, libraryOnly}`: `value` is the number the engine computes
  and checks with (a number, a `[lo, hi]` range, a few named numbers such as
  RIR by exercise type `{compound, isolation, strength}`, a list, a word, or
  null for a rule without one), read from the engine's own constant
  (`engine` names it), so it never differs from what `review` and `check`
  use; with `libraryOnly` it is the library's own number, which no engine
  calculation uses (the 80 % of 1RM, the tempo); `grade` is rules.md's
  scale (`strong`, `moderate`, `weak`, `heuristic`); `sources` are
  `{label, doi}` or `{label, url}`; `checks` names the `check` warnings
  that hold a plan to the rule, each carrying this grade. With no
  topic, or the topic named: `regions` (`list[]`, every modelled region
  `{id, muscle, label, grade, coverage, roughGuide, aliases, note, sources,
  movements}`, its `movements[]` the catalogue movements that bias it in
  `catalogue`'s order, each with its region `credit`, 1 when the region's
  muscle is a main muscle and 0.5 when it helps, and `longLength`; and
  `unsupported[]`, `{phrases, nearest, nearestText, why, sources}`),
  `findings` (the three `answers`, confirmed `true`, declined `false` and
  unconfirmed left out, with what each does; the self-check tests and the
  body-assessment kinds that are findings, and where each answer goes) and
  `standingRules` (each kind a plan declares, `{kind, path, legacyDefault,
  text}`, and the lift `progression` rules); else null. `topics` and
  `grades` say what each topic and grade covers. Quote a rule's value with
  its grade and a source; its rules.md row is the longer story.
- **`catalogue`**: the movements that fit every filter given. `--pattern`;
  `--region` (an id or another name, "side delts"; an unsupported one such
  as "inner chest" searches its nearest option, with an `unsupported-region`
  warning saying why); `--muscle` (main or helping, by id or label);
  `--equipment` (only movements needing nothing else, in the profile's
  words, comma-separated; a tool that stands in for the defining one, a
  kettlebell for a goblet squat's dumbbell, counts); `--query` (words in its
  name, other names, pattern, muscles or regions). `--level` (or the
  profile's `novice`) orders but removes nothing: a harder movement is
  marked. All 245 movements, the starter set and the exercise library
  (`docs/exercise-library.md` in the repository). `movements[]`:
  `{id, name, pattern, equipment, muscles {main, helps}, regions,
  longLength, abdominalStrain, level, load, unilateral, easier, harder,
  aliases, alsoWith, risk, uses, hotel, guide, fit}`: `alsoWith` the tools
  that stand in for the first of `equipment`; `risk` what it asks of the
  body (`joint:` and `demand:` tags, `vocabulary.risk` saying what each
  means: facts to weigh with the person, never a diagnosis, and nothing
  screens on them); `uses` its roles (`warm-up`, `cool-down`, `posture`,
  `balance`, `desk-break`); `hotel` whether it fits a hotel room; `guide`
  `{setup, do, avoid}`, its guide text; `fit` saying why it sits where it
  does (`query` `exact`, `name` or `other`; `role` `main` or `helps`;
  `longLength`; `aboveLevel`). The order is for display only (`order` says so): exact text
  matches, the muscle as main before helping, the versions that load a
  two-joint muscle long (the seated leg curl before the lying one, overhead
  triceps extensions before pushdowns, standing calf raises before seated
  ones for the calves), at or under the level, the most targeted, then
  catalogue order. `check`'s region options come in the same order.
  `ladders[]`: each ladder with a level among the results (all with no
  filter), each level with the catalogue movement it counts as: the four
  the self-check starts (`source` `engine`), the catalogue's 20 chains of
  movements along their harder links (`source` `catalogue`, not logged by
  level), and with `--vault .` the plan's own (`source` `plan`).
  `vocabulary`: the patterns, equipment ids and words, levels, muscles and
  regions the filters take, and the meanings of the `risk` tags and the
  `uses`. An unknown pattern, region, muscle or level is exit 2 naming
  the known ones; an unknown equipment word is left out with an
  `unknown-equipment` warning; no match is a `no-match` warning.
- **`catalogue --md`** adds `markdown`: the readable page (by pattern: each movement's muscles, regions, tools, level, easier and harder, setup, do and avoid; then the ladders and what each demand means), the whole catalogue with no filter, else the movements found. It's for the user: Pahlavan's command **Write the exercise catalogue** writes the same page into their fitness folder, so point them there rather than pasting it.
- **A movement outside the catalogue** counts like one in it once its
  guide entry gives `muscles` (and `regions` for the parts of a muscle it
  biases): sets per muscle and per region, the region rules, pull to push.
  `check` notes it as `unknown-exercise` (information: it has no
  abdominal-strain tag, so the Ledger screens it by name only) and warns
  only when its entry gives no muscles (`no-muscles`).

## `readiness`, `next`, `validate`

- **`session --freeze`** (with `--type`, `--date`, `--lift1`/`--lift2` for a swap's lift done, and `--skip "<line>,<line>"` for items not done): the exercise list and the checklist Pahlavan's Log panel would freeze into that day's log entry (`freeze.value.exercises`, `{name, sets, daySets}`: `daySets` the day's working sets of a strength item, after a readiness or soreness trim or in Express; `freeze.value.checklist`, `{done, total, skipped}`), read-only. `log add` writes both into the entry itself; a custom session has none (exit 2). A paired line is named "A + B", a ladder line by its plan item name.
- **`session`**: today's session for the Today screen. `session` (type,
  name, why: logged today, or next in the rotation for the day's kind:
  the weekday's in the default calendar, except a lifting weekday after
  two logged lifting days in a row, which is a short day while the week's
  short sessions aren't all done; its `why` names the two days), `mode`, `warmup`,
  `items` (each with `sets`, `repRange`, `rir`, the plan's `sr`, `target`
  in the lift's unit, `last` with `logged`, `replaces` for a swap, and
  `adjustments`: titled reasons for the temporary change, the Ledger,
  soreness, readiness, progression and the load cap, a unit check, the
  return after time off), `finisher`, `flags` (readiness, deload,
  calibration, missed time) and `plannedLoad` (heuristic). A timed item
  (cardio, intervals) has `timed`: its structure (`minutes`, its whole
  length, and for intervals `rounds`, `workMin`, `restMin`, `warmupMin`,
  `cooldownMin`) and `text`, the dose in words ("4 × 4 min hard, 3 min easy
  between · about 25 min"); its `sets` are its rounds, 1 for steady minutes,
  never minutes halved (the log's own count, `--freeze`'s `sets`, stays a
  set per 2 minutes). In a calibration week an interval item is easy steady
  minutes, the same total, with a `plan.calibration.cardio` adjustment and
  its line as the `cue`. Quote `timed.text` for the dose. `--mode express`:
  the plan's Express block; `--mode hotel`: bodyweight, light dumbbells and
  bands, each swap with its reason, a third of the sets on a trip of a week
  or more (a check-in's `knownBusy` travel). `--type T` picks another of the
  plan's sessions (`A`, `B`, `S1`, ...: its `liftTypes` and `shortTypes`),
  built the same way: `session.picked` is true, its `why` starts "Chosen by
  you", and `session.suggested` is the one the rotation would have given;
  `choices` lists every session with the suggested one marked. A type the
  plan doesn't have is exit 2, with the plan's types listed.
- **`readiness`**: `review`'s readiness section on its own (smaller output),
  plus `weekly`: the latest check-in's recovery and joint aches, and the
  recovery trigger.
- **`next --lift "<name>"`**: one lift as in `review`'s `lifts[]`, plus
  `deload` and `missed`. The name can be one of the plan's lifts, by its
  name (`Flat DB Bench Press`), its short name (`DB bench`: the short names
  are each entry's `short` in `plan-data.json`'s `lifts`,
  `lifts.<name>.short`) or the lowercase-dashed id (`flat-db-bench-press`),
  or a name actually logged. Nothing else answers: an accessory without a
  `lifts` entry (Face Pull) is not a `next` lift, nor is an old name of a
  renamed lift. A name that matches none is exit 2 (`errors[].code`
  `usage`), listing the known lifts. A lift with no logged top sets that
  is not in this week's plan comes with a `lift-not-in-plan` warning (its
  numbers are empty, not zero), naming this week's lifts in `items`.
- **`validate`**: the engine's own files (the `--kind` list above): `kind`
  (inferred unless `--kind`), `valid`, `errors`. The vault's own files are
  refused, not judged: `plan-data.json`, the log (`fitness-log-data.json`),
  `body-data.json`, `habits-data.json` and the work timer's log give exit
  2, `kind: null`, `valid: null`, `vaultFile` (the path) and an error coded
  `vault-file` naming the command that reads or writes it (plan-data:
  `review --vault .`, whose warnings say what it can't use; the body log:
  `body`). `--kind body` is the engine's own body schema, not the body
  record file `engine body` takes: check a record with a `body` dry run. `Coach/help.json` is Pahlavan's and has no kind (exit 1, "pass
  --kind"): leave it. A valid profile or program can still carry warnings:
  `unknown-region` (a `priorityRegions`, emphasis-row or exercise `regions`
  value that isn't a region id; an alias such as "side delts" names the id
  to use), `unsupported-region` (a region the evidence doesn't support,
  such as "inner chest", with the nearest supported option and why) and,
  for a program, `region-parent-missing` (an exercise's region whose muscle
  it doesn't tag in main or helps).
- **`checkin template`**: the check-in reviewing the week that ends on the
  Sunday on or before the date. `record` (the skeleton, or the saved record
  when `existing`), `ask` (the questions, each with `open`, `fields`,
  `options` mapped to values, and `known`), `known` (deloads, fatigue, the
  recovery trigger). **`checkin add`**: `dryRun`, `written`, `results` (per
  date: `added`, `updated` or `unchanged`, the merged record), `records`;
  exit 1 writes nothing.

## What is tracked: `tracked`, `habits`, `due`, `bring-over`

They read `Coach/tracking.json` (and Pahlavan's `nudges.json` and
`sitting.json`, the habit check-ins, the body log); without the file they say
nothing is tracked, calmly. `tracked` and `due` also read Pahlavan's quiet
hours: its settings (`.obsidian/plugins/pahlavan/data.json`), else the
default 22:30 to 07:00 (`sources.quietHours.source`: `settings` or
`default`).

- **`tracked`**: `exists`, `items[]` (each in words: `schedule`, `when`,
  `asks`, `reminder`, `start`, `paused`, `habit`, `source` with its text
  "Suggested by your coach" or "Added by you", `note`, `quiet` (its hold
  from `quiet.held`, else null), a desk-break item's `desk` and
  `deskReason` (its times and their source), and the item itself),
  `suggestions` (the open ones, with their Why), `morning`, `bodyRecord`
  (`setting`, and the tape, photos and tests each with `due`, `nextDate`,
  `last`, from the plan or every N days), `deskBreaks` (the plan's routine
  on its `deskTiming`, else the default timing (every 90 minutes, 10:00 to 15:00): `steps`, `every`, `from`,
  `to`, `minutes`, `days`), `quiet` (`hours` `{on, from, to, source}`, and
  `held`: each reminder whose card falls inside them, `{item, name, spans:
  [{from, to, shows}]}` with its reason; `shows` is when the card comes
  instead, the hours' end for an early-morning one, null for a late-evening
  one that never shows; `item` null is the morning check-in),
  `bringOver`, `protein` (the target each protein item is compared with,
  `compare {floorG, source}`: the eating plan's `protein.floorG` when there is
  one, else the engine's floor at today's trend; each item's `goal` and whether
  it `follows`, and a `note` naming `track protein` only without an eating plan).
- **`habits [--item <id>]`**: per item `streak` (days or sessions in a row,
  with its reason), `adherence` (done of due in the last 30 days, `pct`),
  `grid` (26 weeks, each day's state: taken, part, missed, open, off,
  paused; a stand-up cell with desk minutes also has `desk`), `today`;
  stand-up items `standing` (the last 30 days: `days` due and started,
  `minutes` stood, `prompted` from the stand-up card, `desk` at the desk
  with Standing now on, `deskDays` with any), sitting items `sitting` (the
  last 28 days:
  minutes, the longest stretch, `overLimit`, `overStretch`). `tiles`: the
  last 30 days across items, the longest streak, today's done of due.
- **`due [--time HH:MM]`**: `due.value.cards` (the reminder cards due at that
  moment, in order, each with its Why as a reason; the `coach` card from 18:00
  on a coach step's Sunday) and `today.value` (`coach`: the coach step while it is
  `due` or `late`, `answer-first` on its own Sunday, or `done` with the letter's date
  until the next Sunday; with `title`, `command` and `at`; Due
  today: the morning check-in, habits by slot, amounts, stand-ups with
  their `desk` minutes, sitting, desk breaks with their `times` and
  `next`, the body record, "Did you train?"), and `quiet` as in `tracked`.
  Inside quiet hours no card is due: `due.value.quiet` is true, `cards`
  empty, and the reason (`nudges.quiet`) says an early-morning card waits
  until they end and a late-evening one is skipped that day. This Mac's
  stand-up count and a sitting stretch still running are the plugin's, so
  not in it.
- **`bring-over`**: the one-time offer from the Habit Nudges plugin, read
  only (for a vault that has its data; elsewhere it offers nothing): the
  items it would propose and what stays. On a
  fresh start, `track fresh` records that nothing comes over instead.

## The write path: `track`

`track <action> --vault . --json [...]` writes `Coach/tracking.json` the
way Pahlavan's Habits screen does (`tracking.md`, "The tracking file", has
the item fields and examples). A dry run unless `--write`; with it, the file
is merged as it is on disk, validated, written whole and read back.

| Action | Takes | Does |
|---|---|---|
| `suggest` | `--file <items.json>` | Coach suggestions with their Why: accept or dismiss chips in Pahlavan. A tracked or dismissed item is skipped (`"again": true` for new data) |
| `add` | `--file <items.json>` | Items accepted in the conversation (the suggestion recorded accepted, the item from today); the user's own (no Why); an item's `id` with changed fields: a change from today, the old settings kept for the past. A sitting item whose limit is set or changed without a card time gets its card at the limit minus 30 (`add` and `suggest`; the result's note says so) |
| `decline` | `--file <items.json>` | Items declined in the conversation, kept as dismissed suggestions |
| `accept`, `dismiss` | `--id <id[,id]>` | As the chips do |
| `morning` | `--at HH:MM` or `--off` | The morning check-in's card |
| `body-record` | `--schedule plan`, or `--schedule fixed --tape-from D --tape-every N --tests-from D --tests-every N` | When the tape, photos and tests are due |
| `fresh` | | The bring-over recorded as empty (a fresh start: no offer) |
| `protein` | | The coach's protein item to the engine's target |
| `apply` | `--file <changes.json>` | Several at once, in one write: `{suggest, add, decline, accept, dismiss, morning, bodyRecord, bringOver, protein}` |
| `day` | `--date D` | Read only. Every item due that day (scheduled, started, not paused): `{id, name, kind, state, done, value, target, unit, desk, via, habit: {id, name, ticked, value}, tickable}` with one reason each (`tracking.day`; `desk`: a stand-up's minutes of `value` stood at the desk with Standing now on, null for the other kinds); `open` (the supplements, ticks and amounts not done); `notDue` (with why: `paused`, `off`, `none`, `future`); `training` (`logged`, `sessions`, `workoutTicked`, `planned`, `didYouTrain` `{answer, at, by}`, `mark`); `morning` (`on`, `at`, `done`, `checkedAt`, `answer`, `filled`) |
| `tick` | `--id <id[,id]> --date D`, `--done true\|false` or `--amount N` | The day's tick (supplements, ticks; `--done` alone is true) or total (amounts) into `tracking.json`, and the same on the linked habit in the habit check-ins file, both merged, written and read back in one go: `results` (`set` or `unchanged`, with a note), `ops`, `habitChanges`, `changed`, `after` (those items and `open` once written), `written`. Exit 1 writes nothing: an unknown id, `--amount` on a tick or `--done` on an amount, a stand-up, desk-break or sitting item (Pahlavan counts them), a date after today, a linked item with no `habits-data.json`. A paused or off-day item is ticked with a warning |

An items file holds one item, a list, or `{"items": [...]}`. The output:
`results` (per change: `added`, `updated`, `suggested`, `accepted`,
`dismissed`, `declined`, `set`, `recorded`, `skipped` or `unchanged`, with a
note), `changed`, `ops` (exactly what is written), `after` (what is tracked
once it is written, in words), `handOver` (`before`, `after`: whether
Pahlavan counts as set up, so a vault's Habit Nudges plugin steps aside, with a `note`),
`dryRun`, `written`. Exit 1 writes nothing: a coach item without its Why, an
unknown field, a new item named like a tracked one (pass its `id` to change
it), an unknown suggestion id, an invalid tracking file. `warnings`: a link
to a habit that does not exist, a protein item not linked to the
Protein habit, a change to the user's own item.

## The write path: `body`

`body --vault . --json --file <record.json> [--replace] [--write]` writes
one date's morning fields, tape and tests into `body-data.json` through the
same field-by-field merges as Pahlavan's forms (the record file's format is
in `formats.md`, "The body record file"). A dry run unless `--write`; with
it, the file is merged as it is on disk, written whole and each field read
back.

- **Only the given fields move.** Every other field, entry and day stays,
  Pahlavan's own and any other writer's included. `steps` and `floors` go on the
  day before (the day they count for), as the morning check-in files them.
  It never sets `checkedAt`, so the user's own morning check-in still asks.
- **Never over the user's entry.** A field that already holds another value
  for that date is a `conflict`: exit 1, nothing written, and the result
  names the field, what the file holds and what the record says. Ask the
  user; `--replace` writes over it on their yes. The same value is
  `unchanged` (no write).
- **The output:** `results` (per part, `morning`, `tape`, `tests`: `set`,
  `unchanged` or `conflict`, the `changed` fields, the `conflicts`, a
  `note`), `after` (the date's morning fields, tape and tests as the file
  holds them once written), `date`, `dryRun`, `written`, `replace`. Exit 1
  writes nothing: an unknown part or field, a value out of the forms' limits
  (weight 30 to 250 kg, the tape 40 to 200 cm, arm 15 to 70, the tests'
  ranges), a date after today, a conflict.

## The baseline note: `baseline`

`baseline --vault . --json --date D` gives the cycle's Baseline note for a
fresh start on the date (the intake's day), read only. **Always give
`--date`:** without it the engine uses today's date, not the cycle's
Baseline note, so on any later day it offers a new note for today. It
gives `path` (`<fitness>/Baseline - <date>.md`), `exists` (a note for that day
is there already: write nothing), `previous` (the newest note before it,
the cycle before; it stays), `weekOne` (week 1's Monday), `firstPhotos` (the
first light week's Sunday, or the first test week's when `rules.tests` lists
an earlier one), `firstTests` (phase 1's last Saturday, or the first listed
test week's) and
`text`, the note from the engine's template. The coach writes `text` to
`path` word for word on the user's yes (`intake.md`, step 7; `planning.md`
when the plan job comes first in a fresh start); the dates are the
engine's, so the coach does no date arithmetic.

## The eating plan's numbers: `energy`

`energy` is read only: the diet job's arithmetic (`diet.md`, section 3) from
the profile's basics (birth year, height, sex) and goals, the trend weight
from the cycle start (as `review` reads it) and, when there is one, the
eating plan's level and meals a day. The coach's choices go in as flags:

- `--pal N` (required): the activity factor from `diet.md`'s table, 1.40 to
  2.39 (a desk job plus 4 sessions a week is about 1.5–1.6). Without it, or
  outside the table, a usage error lists the table.
- `--rate R`: the weekly change as a signed fraction of body weight
  (`-0.0025` is −0.25 % a week), when the plan aims at a rate of its own.
  Without it, the most important goal (the one `review`'s `weight.band`
  names) gives a range, `target`'s `kcal` `[lo, hi]`, by `diet.md`'s Goal
  energy row: recomposition: maintenance to −250 kcal, gain: +200–300 kcal
  (`from` `goal`); fat loss and the other goals a loss from the band (about
  7,700 kcal per kg, `from` `band`), as is a goal the profile gives its own
  band. The fast end is never beyond 1 % of body weight a week.
- `--meals N`: meals a day; else the eating plan's `habits.meals`, else 3.

| Field | What it is |
|---|---|
| `inputs` | `sex` (null: not given), `age`, `heightCm`, `pal`, `rate`, `meals` and `mealsFrom` (`flag`, `eating plan` or `default`), `level` (the eating plan's, else null) |
| `weight` | The trend weight: `kg`, `date`, `weighIns`, `since` (the cycle start), with `review`'s `weight.trend` reason |
| `rmr` | `energy.resting`: resting energy by Mifflin-St Jeor, `kcal` and `constants` (`male` or `female`) |
| `maintenanceKcal` | `energy.maintenance`: `kcal` (resting × `pal`), `range` (±10 %, Frankenfield 2005: a starting point the weight trend corrects), `pal` |
| `target` | `energy.target`: `kcal` (one figure for `--rate`, the goal's `[lo, hi]` without it, null when refused; before the floor), `pctPerWeek`, `kgPerWeek` (the weekly change each end gives), `from` (`rate`, `goal` or `band`), `offsetKcal` (`goal`'s kcal a day from maintenance, else null), `band` (`lo`, `hi`, `source`), `inBand` (`--rate` inside the band; null without it), `clamped` (the range's fast end was beyond 1 % a week, so it starts at −1 %) |
| `refused` | `energy.refused`: true for a `--rate` that loses faster than 1 % of body weight a week. There is then no goal energy and no fat or fiber figure: use −0.01 or slower |
| `floor`, `belowFloor` | `energy.floor`: `kcal` (1,500 for men, 1,200 for women; the female floor when no sex is given), `below`, `targetKcal` (the target with the floor applied: what the plan uses), `rateAtFloor` (the weekly change eating at the floor gives, when the target is under it). Under the floor: the floor and a slower rate |
| `protein` | `energy.protein`: `gPerDay` and `gPerKg` (the engine's range, by goal), `floorG`, `perMealG` (0.4–0.55 g/kg), `meals`, `mealsFrom`, `perMealTotal` (what the meals give), `topUpG` (the snack or shake that reaches the floor; 0 when the meals do) |
| `proteinRange` | `review`'s `weight.protein`: the same range, with the reason to quote |
| `fatMinG`, `fiberMinG` | `energy.fat` (at least 20 % of energy) and `energy.fiber` (about 14 g per 1,000 kcal, at least 25 g), at the target with the floor applied: one figure, or `[lo, hi]` for a range |
| `light` | `energy.light` at the eating plan's Light level: only the protein and fiber figures are used. Null at the other levels, and before the eating plan is written |
| `eatingPlanFields` | The figures as `eating-plan.json` keeps them (`formats.md`): `basis`, `protein` (`floorG`, `rangeG`, `gPerKg`, `perMealG`), `fiber` (`g`, the figure that meets the rule anywhere in a range, and `per1000kcal`; left out when refused), `energy` (`maintenanceKcal`, and `targetKcal` for a range only: one rate gives one figure) |

- **`warnings`:** `no-sex` (the profile gives none: the female constants
  and the 1,200 floor are used, and the warning says what the male ones
  give), `rate-outside-band`, `roadmap-band` (no weight goal in the profile,
  so the range is the roadmap's band), `band-clamped`, `eating-invalid`.
- **Exit 1:** `no-basics` (no profile, or no birth year or height) or
  `no-weight` (no weigh-ins from the cycle start); `weight` and
  `proteinRange` still come when they can.
- Quote each figure with its note, never redo the sum. Whole kcal and grams
  are rounded half up from the unrounded figures before them, so an exact
  half can differ by 1 from a Python sum.

## The eating plan: `food` and `eating`

`food` is read only: what Pahlavan's Food tab draws
from `Coach/eating-plan.json` (`formats.md`), counted from the cycle start.
Without the file it says so calmly (`file.state` `missing`; the waist and
the weight trend still come); an invalid file is an error (exit 1).

| Field | What it is |
|---|---|
| `date`, `cycle`, `week` | The date; the cycle start with its reason; `{planWeek, phase}` (the phase's name, as the banners show it) |
| `file` | `{path, state}`: `ok`, `missing` or `invalid` |
| `plan`, `level` | The plan as the file holds it; `{id, label}` (`light` is "Hand portions") |
| `protein` | `floor` (`diet.protein`: the plan's floor and range, the engine's floor at today's trend and the Protein item's goal beside it, a note when they differ); `item` (`{id, name, habit, tickAt}`: the tracked item it ticks); `today` (`{date, state, via}`); `week` (`diet.protein-days`: Monday to Sunday, each day `ticked`, `unticked`, `open` (today), `future` or `before` (before the cycle or the item's start), with `via` `pahlavan` or `habit`; `ticked`, `soFar`); `weeks` (the cycle's weeks before this one: `n`, `from`, `ticked`, `days`, `checkin` the check-in's `proteinDays` for it); `planned` (`diet.meals`: `lo`, `hi`, `over` the floor, `meals` with their running total, `without` the day without the hardest meal and whether that is `under` the floor) |
| `trend` | `from`, `to` (the cycle start to the review date or today), `tapeDays` and `nextTapes` (the body record's schedule), `weight` (`trend` and `rate` as `review` computes them, `direction`: `diet.weight`, `early`, `in`, `below` or `above` the goal's band), `waist` (`diet.waist`: `points`, `first`, `last`, `changeCm`, `direction` `one`, `down`, `flat` (within `flatCm`) or `up`, `status` against the plan's direction) |
| `adjust` | `diet.adjust`, the plan's rule: `status` (`waiting`: the first check, or the one after a step, is ahead; `due`: its date came and its tape is not in; `checked`: decided on `checkedOn`'s tape), `step` (null: no change; else `less` or `back` with the plan's `then`), `why` (`before-first-check`, `waiting-after-step`, `tape-due`, `too-fast`, `short-span`, `creatine`, `flat-not-falling`, `no-rate`, `falling`, `waist-down`, `waist-up`), `next` (the next check, a tape day) and `before` (the tapes it reads), `span` (the weeks of tape read: `first`, `last`, `changeCm`, `spanDays`, `enough`, `flat`), `rate`, `trendKg`, `onePctKg`, `conditions` (`flat`, `notFalling`, `tooFast`), `creatine` (`{from, until, active}`), `wait` (the last step and until when). The note is the sentence to quote |
| `pattern` | `diet.pattern`: `sundays` (the cycle's last six), `lines` (`answers` per Sunday `true`, `false` or `null`, `met`, `answered`), `records` (each Sunday's check-in date) |
| `creatine` | The tracked creatine item: `{id, start, dose}` |
| `why` | Every number's Why by key (`floor`, `planned`, `meal-<id>`, `day-<date>`, `week-<n>`, `waist`, `rate`, `rule`, `check`, `pt-<id>-<Sunday>`, ...): `{title, rows, threshold, note, rule}`, as the tab's tooltip shows it |
| `notes` | Calm notes: `no-plan`, `invalid-plan`, `no-protein-item` |

`eating --vault . --json --file <plan.json> [--replace] [--write]` writes
the plan into `Coach/eating-plan.json`. The file can hold the whole plan or
only the parts that change: it is merged into the file as it is (objects key
by key, lists and values replaced, `null` removes a key); `--replace` writes
the given plan whole. `schemaVersion` is filled in when left out. A dry run
unless `--write`; with it, the file is re-read just before the write (a
change since merges again, once), written whole and read back.

- **The output:** `result` (`added`, `merged`, `replaced` or `unchanged`),
  `changed` (the dotted paths that differ), `plan` (the file as it would be
  written), `before`, `dryRun`, `written`.
- **`warnings`** (said, never blocking): `updated-unchanged` (the plan
  changed but `updated` did not), `review-past`, `protein-item` (no tracked
  Protein item, or its goal is not the plan's floor: set them together),
  `floor` (the floor is not the range's low end), `meals-under-floor` (the
  meals' rough protein adds up under the floor), `pattern-ids` (check-ins
  answered lines the plan no longer has).
- **Exit 1 writes nothing:** an invalid result (each error with its path),
  `updated` after today, a file of another schema version, an invalid or
  unreadable file without `--replace`.

## The phone's inbox: `inbox`

The user logs from the iPhone (Apple Shortcuts): each entry is one file in
`Coach/Inbox/`, `{"v": 1, "kind", "at", "date", ...}` with `kind` one of
`session` (`session: {type, lift1?, lift2?, durationMin?, express?, rating?,
notes?}`, a lift its top set `{weight, reps, unit?}`), `tick` (`ids`,
`done?`), `amount` (`id`, `add`), `morning` (`morning: {energy?, ...}`) and
`trained` (`answer`). `validate <entry.json>` checks one against the exact
format (kind `inbox`; Pahlavan's JSON Schema has it as `inboxEntry`); the
user's recipes are in Pahlavan's user guide, "Logging from the phone". Pahlavan imports them on its
own at each refresh; the coach needs this only for a day Pahlavan isn't open,
or to see why an entry was refused.

At the gym the user logs every set on the gym page (opened from the
shortcut; `phone.json`'s `gym` link holds the day's sessions): its Send is
one `session` entry at Every set (`"trackingLevel": "full"` with
`exerciseSets`, `swaps`, `skipped`, `skipWhy`, `cardioMin`, `cardioMode`), checked and saved
exactly as `log add` saves the same session, so a refused one says `log
add`'s own message. A swap is sent as the Log panel saves it: a swapped
logged lift `{name, planned, swapWhy?, weight, reps, unit}` (`planned` the
plan's lift, `swapWhy` one of mine, ledger, soreness, hotel), its sets
`{name, planned, sets}`, and any other swap in `swaps: [{from, to, why?}]`.
An entry without `trackingLevel` never takes those fields. Sent twice, the
second is `already`.

- `inbox --vault . --json` is read-only: what would apply (each entry's
  writes) and what would be refused, with its code (`invalid`, `future`,
  `too-old`, `unknown-type`, `unknown-item`, `not-started`, `already`,
  `conflict`) and reason. `--write` applies them through the same merges as
  Pahlavan, moves applied files to `Coach/Inbox/applied/<YYYY-MM>/` and
  rewrites `Coach/Inbox/refused.json`; after the user's yes, as every write.
- `inbox --phone [--write]` builds `Coach/Inbox/phone.json`, what the phone's
  shortcuts read (today's items, the sessions with their logged lifts, the
  gym page's link, the morning fields). Pahlavan keeps it current on its own.
- A refused entry is never forced in: show the user the reason; a conflict is
  the user's value against the phone's, and the user decides in Pahlavan.

## Not in the engine yet: snippets

One calculation is still a Python snippet: the water target (`tracking.md`,
"Amounts: water"). Run it from the vault root as `python3 - <<'EOF' … EOF`;
it only reads. The eating plan's energy and protein come from `energy` ("The
eating plan's numbers" above) and a draft plan's sets per muscle from
`review --plan <draft.json>` ("The plan check" above), never from a snippet.
