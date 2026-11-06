# Numbers from code

Every number the coach quotes comes from the Pahlavan engine, a CLI bundled in
this skill (`scripts/engine.cjs`, version in `scripts/VERSION`). It runs on any
machine with Node and needs nothing else. Run it from the vault root:

```bash
node .claude/skills/fitness-coach/scripts/engine.cjs review    --vault . --json [--date YYYY-MM-DD] [--pretty]
node .claude/skills/fitness-coach/scripts/engine.cjs readiness --vault . --json [--date D]
node .claude/skills/fitness-coach/scripts/engine.cjs session   --vault . --json [--date D] [--mode full|express|hotel] [--type T] [--freeze [--lift1 L] [--lift2 L] [--skip "<name>,<name>"]]
node .claude/skills/fitness-coach/scripts/engine.cjs next      --vault . --json --lift "<name or short name>" [--date D]
node .claude/skills/fitness-coach/scripts/engine.cjs plan      --json --profile <fitness>/Coach/profile.json [--ledger <fitness>/Coach/ledger.json] [--start D] [--weeks 12|16|24] [--history] [--vault .] [--format engine|plan-data]
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
node .claude/skills/fitness-coach/scripts/engine.cjs eating    --vault . --json --file <plan.json> [--replace] [--write]
node .claude/skills/fitness-coach/scripts/engine.cjs inbox     --vault . --json [--write] [--phone]
node .claude/skills/fitness-coach/scripts/engine.cjs folders   --vault . --json
```

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
  below), each those files and nothing else. Every other write is a
  propose-then-write step (`plan-files.md`).
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
- **`warnings`** are things the engine read around, never a crash: exercises
  not in its catalogue (no abdominal-strain tag), free-text equipment, a test
  result that isn't a number, values out of range, missing coach files. Mention
  the ones that touch the answer.
- **The self-check:** `scripts/selfcheck.mjs` runs every line of the block above (placeholders filled with safe values, `--write` dropped, so nothing is written), checks that the fields the next table names are in the output and that each command's flags match `--help`; `npm run ship-skill` runs it after each ship, and each failure names what to fix.

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
| One lift's target, e1RM and stall | `next --lift "<name>"` | `lift` |
| Weight pace against the goal | `review` | `weight.rate`, `weight.band` |
| Sets per muscle, planned and done | `review` | `volume` |
| Pulling against pushing sets (the posture emphasis's pull:push) | `review` (a draft: `plan`) | `volume.pullPush` (`proposal.volume[].pullPush`) |
| Is a deload due, after missed time what now | `review` | `deload`, `deloadPrescription`, `missed` |
| A new plan and its proposal | `plan` | `program`, `proposal` |
| How the profile shaped a new plan, the candidates the engine built and compared (`planning.md`, step 1, adds the coach's), the ladders' starting levels | `plan` | `proposal.personalization`, `proposal.templates`, `proposal.ladders`, `proposal.priority` |
| A new plan's sets per muscle as Pahlavan counts them | `plan --vault .` | `proposal.volume`, `proposal.volumeMap` |
| The plan as `plan-data.json` | `plan --format plan-data --vault .` | `planData`, `unexpressible` |
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
| The eating plan day to day, as Pahlavan's Food tab shows it: protein days, the planned protein, the waist and weight trend against the plan, the adjustment rule's status, the pattern | `food [--date D]` | `protein`, `trend`, `adjust`, `pattern`, `why` |
| The Food tab's plan in words, the day's timeline, the light checks | `food [--date D]` | `words`, `day`, `checks` |
| Is the adjustment rule due, and what does it say (a review date, a tape day) | `food --date D` | `adjust` (its note is the sentence to quote) |
| Save the eating plan as data, or a change to it | `eating --file <f>` (then `--write`) | `result`, `changed`, `plan`, `written` |

## `review`

| Field | What it is |
|---|---|
| `week` | `planWeek` (counted from the first logged plan session, as Pahlavan counts; until the current cycle has a plan session, from the cycle start's Monday, so a fresh start is week 1 from its first day), `phase`, `mesocycle`, `weekInMesocycle`, `deload` (every 4th plan week), `deloadNext` |
| `thisWeek` | The week's sessions (type, lifts, minutes, rating, skipped items, notes); `lifting` and `short` `{done, target}`, `custom`, `cardioMin`, `trainedTicks` and `proteinTicks` (the habit ticks) |
| `adherence` | The 4 complete weeks ending on the Sunday on or before the date: per week `lift`, `short`, `custom`, `days`, `habitDays`, `ticksWithoutLog`, `gaps {unlogged, missed, rest}`; `lifting` and `short` `{done, planned, pct}`; `meanSessionsPerWeek`, `meanTrainingDays`. A lower bound: ask about gaps first |
| `readiness` | This cycle's mornings only (`since`, the cycle start): `baseline` (`mornings` this cycle, `needed` 14, `building` until then, with the note to quote: "Building your baseline: n of 14"), `today` (the date's score), `latestScored` (date, R, S, band, z per signal, flags), `last14` (the last 14 days with a readiness signal), `scoredDays`, `actions` (`trim`, `early-deload`, `no-hard-training`, `no-tests`, each `active` with its note; a stale check-in is named; nothing trims while the baseline builds) |
| `weight` | `trend` (EWMA from the cycle start, the newest `Baseline - <date>.md`), `rate` (the least-squares slope over 28 days: `kgPerWeek`, `pctPerWeek`, or why not yet), `band` (the rate against the profile goal's band, or the roadmap's -0.25 to -0.5 kg/wk without a profile; `source` says which), `dashboard` (the old dashboard's 7-day trend and rate, for reference only), `protein` (the range by goal with its reason: lifting goals 1.6–2.2 g/kg, health-only or endurance 1.2–1.6, the upper half in a deficit, PROT-AGE's floor at 65+; `value.gPerKg`, `grams`, `targetG`), `proteinFloorG` (the range's floor at the trend weight: the protein item's target and the check-in's protein question), `tape` (this cycle), `last7` (sleep, steps, floors, resting HR: mean, days covered, through) |
| `lifts[]` | This week's main lifts, then every other lift with a logged top set: `unit`, `increment`, `repRange`, `last` top set, `sessions`; `e1rm` (Epley, best of 3, `change` over 3 sessions, `verdict` up / down / noise, `unitFlag` for a likely kg/lb mix-up with `ignored` older top sets); `stall` (`stalled`, or why not: progressing, an adherence question, too few sessions); `triage` (the four steps, `chosen` the one for this check-in) when stalled; `next` (action, weight, reps, RIR, with the load cap applied); `returnAdjusted` in the first week back after missed time |
| `volume` | `planned` (this week's plan, each session type weighted by target / types; `overSession` lists more than 8 direct sets for one muscle in a session; `notCounted`), `done` (the week's sessions, an estimate from the plan snapshots minus skipped items), `bands` (planned sets per muscle against the tiers: under 4, 4-10, 10-16, 16-20, over 20; `priority-low` for a priority muscle under 10), `doneTiers`, `pullPush` (the planned week's pulling against pushing sets, counted as `plan` counts them: by movement pattern, or by main muscles for an exercise with none; `pull`, `push`, `ratio`, `target` 2 and `floor` 1.8 under the posture emphasis (null without it), `status` `ok`, `below`, `no-target` or `no-pushing`, `pulling` and `pushing` per exercise; its reason's note says how many sets would reach the floor) |
| `deload` | `planWeek`, `scheduled`, `weeksToScheduled`, `triggers` (readiness low 5 days with a falling e1RM; stalls on 2+ main lifts), `deload` |
| `deloadPrescription` | When a deload is this week or next: where Pahlavan's light week (2 sets) and rules.md's deload (half the sets, RIR +3) differ |
| `missed` | The return protocol: `continue`, `ease-back` (1-2 weeks off: 0.9x and RIR +1 for the first week), `restart` (3+ weeks: mesocycle week 1 with calibration); days off and gap days ticked or marked |
| `nextInRotation` | The next lift and short session type |
| `concurrent` | The plan week on the user's real week (`concurrent.week`, rule `concurrent.week`: each session on the weekday the cycle's log shows it most often over 2 to 4 complete weeks, else the profile's `availability.fixedDays`, else the fixed layout, lift Mon, Tue, Thu, Fri and short Wed, Sat, Sun; `layout[].source` is `log`, `available` or `default`) and its flags: conditioning before lifting, hard leg intervals under 24 h before heavy legs, the same muscle hard two days running. A muscle trained hard two days running is flagged unless the second day is the lighter one for it; a set at RIR 4 or more is not hard (hard: a main lift or a compound pattern, not a hold). `backToBack` lists every such pair, allowed and flagged: `first`, `second`, `muscle`, `firstLoad` and `secondLoad` (each day's heaviest work for it as the reps its load allows, the bottom of the range plus RIR; null when a prescription is missing), `lighter` (true: allowed, a heavy day followed by its lighter day) and `suggestion`. `plan` checks its draft with the same rule |
| `temporaryChanges` | `due` (until date on or before the date) and `active`; each with the session, item, reason and `wayBack` (the item a "Replaces" note names) |
| `ledger` | With `Coach/ledger.json`: this week's exercises the Ledger blocks, or allows with conditions, with swaps |
| `ladders`, `tests` | Each ladder's level and since when, with its reason, and `testShowsLevel` when this cycle's latest test is ahead (only for ladders a plan session carries); `tests.value`, the latest value of each test from this cycle (its reason names tests before the cycle start, left out) |
| `load` | Training load (session RPE x minutes): `thisWeek` and `last4` (load, the daily loads, monotony, strain; unknown without a session RPE, or estimated from the check-in's effort) and `nextWeek` (each planned session's typical minutes x a planned effort, a heuristic) |
| `soreness` | `today` (the morning body map), `thisWeek` and `last4Weeks` (sore and mild days per muscle, for the mesocycle review's per-muscle feedback) |
| `time` | Each planned session's estimated minutes (warm-up, cardio from `sr`, each set's work and rest) against the profile's session lengths: `sessions`, `limits`, `over` (the types over; a `time-over` warning names them). Lifting days are checked but Pahlavan shows their logged length |
| `pain` | The week's pain reports, from the log's sessions (`pain`) and the Sunday check-in's joint aches, each with the pain rule's verdict (`fine` up to 3 of 10 that settles, `swap` over 3 or lingering, `professional` the same area 14+ days apart or worse); `worst`. One warning for any pain over 3 of 10 in the last 7 days |
| `skips` | The last 4 weeks' skipped items by exercise with their reasons (`checklist.why`: time, pain, equipment, energy) and `flags`: the same exercise skipped for pain twice (the pain rule's swap), for equipment twice (suggest a swap), time on 2 or more sessions of a week (with `time`'s minutes), energy on a low-readiness day (a note only); pain and equipment are one `skip-pain` and one `skip-equipment` warning. Hotel sessions (`thisWeek` sessions' `hotel`, `lifts[].hotel`) are left out of the e1RM trend, the stall check and `next`; a session logged with every set feeds each lift's best set to the trend and its logged RIR to `next` |
| `checkins` | What the check-in answers contribute: the file's state, the latest record, `fatigue` (recovery and joint aches), `recoveryTrigger`, `knownBusy`, `cancelledDeloadWeeks`, `trainedAtFullLoad`. Each lift's `triageStart` says where its triage resumed |

## `readiness`, `next`, `plan`, `validate`

- **`session --freeze`** (with `--type`, `--date`, `--lift1`/`--lift2` for a swap's lift done, and `--skip "<line>,<line>"` for items not done): the exercise list and the checklist Pahlavan's Log panel would freeze into that day's log entry (`freeze.value.exercises`, `{name, sets}`; `freeze.value.checklist`, `{done, total, skipped}`), read-only. `log add` writes both into the entry itself; a custom session has none (exit 2). A paired line is named "A + B", a ladder line by its plan item name.
- **`session`**: today's session for the Today screen. `session` (type,
  name, why: logged today or next in the rotation), `mode`, `warmup`,
  `items` (each with `sets`, `repRange`, `rir`, the plan's `sr`, `target`
  in the lift's unit, `last` with `logged`, `replaces` for a swap, and
  `adjustments`: titled reasons for the temporary change, the Ledger,
  soreness, readiness, progression and the load cap, a unit check, the
  return after time off), `finisher`, `flags` (readiness, deload,
  calibration, missed time) and `plannedLoad` (heuristic). `--mode express`:
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
- **`plan`**: needs `Coach/profile.json`. `program` (schema v1: phases,
  mesocycles, weeks, sessions, slots with sets, rep range, RIR, progression,
  and `pair` on a superset's second slot) and `proposal` (`why`, `template`,
  `week` and the minimum week, `phases` with dates, `sessions` (a lifting
  slot's `note` starts with its rest), `volume` per loading week of the first
  mesocycle (with its `pullPush`, `{pull, push}`), `progression`, `calibration`, `conditioning`, `calendar`, `targets`,
  `preMortem`, `warmUp`, `checks` with each failed check's detail). With
  `--history --vault .` the log sizes the week, only if the profile opted in.
  The proposal also has:
  - `personalization`: one entry per profile input (`input` such as
    `selfCheck.pullUps`, `goals.<id>`, `emphasis.<kind>`, `ledger.<id>`;
    `value`; `used`: true when it changed the plan, false when it is noted
    with what it is for; `effect`, the sentence to quote; `with`: inputs that
    set the same decision). The source of the proposal's "How your data
    shaped this plan".
  - `templates`: every template built and compared (`id`, `label`,
    `family`, `families`, `fit`, `costs`, `picked`, `score`, `factors` with
    `factor`, `points` and `note`, `failedChecks`, `liftingDays`,
    `minutes`, `longestSession`, `mainLiftsPerWeek`); the pick's reasons
    are also the second line of `why`. The points are heuristics that order
    the options; quote the notes, not the points. `families` are every
    family the template belongs to (its split, `heavy-light` for heavier
    and lighter days, `circuit` for a minimum-dose week); `fit` is each
    one's Fits column (`rules.md`, "Split families") against the profile
    and the week (`fits`, `meets`, `misses`) and `costs` their Costs, as
    flags, not points.
  - `families`: all twelve split families of `rules.md`'s catalogue
    (`family`, `name`, `structure`, `engine`: `built`, `partly` or
    `coach`; `candidates`, this run's templates in it; `fit` for this week;
    `costs`, `evidence`, `note`: what the engine builds of a partly-built
    family, or that the coach builds it). The coach's and the partly-built
    ones are also named in a line of `why`.
  - `ladders`: per ladder (`pullup`, `pushup`, `hollow`, `legs`) the
    starting `level` and `levelName` from the self-check (null when not
    tested), `used` and the `sessions` that carry it, with its `reason`. A
    session slot on a ladder carries `ladder` (`id`, `level`, `name`).
  - `priority`: each priority muscle with its `source` (`profile`,
    `lagging-area`, `goal`, `posture`) and `reason`.
  - `volumeMap`: `source` (`vault` with `--vault .`, else `catalogue`),
    `fromVault` (each movement and the guide entry its muscles came from)
    and `fromCatalogue`. With `vault`, `volume` is counted as `engine
    review` will count the written plan.
  - `preMortem` entries carry `from`, the profile input each came from.
  `--format plan-data` returns `planData` (plan-data.json's keys in its order,
  with the current file's warm-ups, ladders and guide text carried over by
  `--vault .`; each item's `rest` by the rest rule, `planning.md` step 5,
  and a superset's second item with `pair: true`, both resting "90 s after
  each pair" with "Superset with X: a set of each, then rest." in their
  notes; a generated plan's `phases` names and its length in `weeks`,
  and its desk breaks as `deskRoutine` and `deskTiming`: the generator's
  default timing is every 90 minutes, 10:00 to 15:00, whatever the
  user's working hours, so the plan job fits it, `planning.md`) and
  `unexpressible` (what plan-data can't hold: later phases, RIR in notes,
  the deload shape, the calibration week, new guide text, the desk breaks'
  reasons).
- **`validate`**: the engine's own files (the `--kind` list above): `kind`
  (inferred unless `--kind`), `valid`, `errors`. The vault's own files are
  refused, not judged: `plan-data.json`, the log (`fitness-log-data.json`),
  `body-data.json`, `habits-data.json` and the work timer's log give exit
  2, `kind: null`, `valid: null`, `vaultFile` (the path) and an error coded
  `vault-file` naming the command that reads or writes it (plan-data:
  `review --vault .`, whose warnings say what it can't use; the body log:
  `body`). `--kind body` is the engine's own body schema, not the body
  record file `engine body` takes: check a record with a `body` dry run. `Coach/help.json` is Pahlavan's and has no kind (exit 1, "pass
  --kind"): leave it.
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
first light week's Sunday), `firstTests` (phase 1's last Saturday) and
`text`, the note from the engine's template. The coach writes `text` to
`path` word for word on the user's yes (`intake.md`, step 7; `planning.md`
when the plan job comes first in a fresh start); the dates are the
engine's, so the coach does no date arithmetic.

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
`Coach/Inbox/` (`session`, `tick`, `amount`, `morning`, `trained`; the format
is in Pahlavan's development notes (`docs/development.md`), "The phone's inbox", and the user's recipes in
Pahlavan's user guide, "Logging from the phone"). Pahlavan imports them on its own at
each refresh; the coach needs this only for a day Pahlavan isn't open, or to
see why an entry was refused.

- `inbox --vault . --json` is read-only: what would apply (each entry's
  writes) and what would be refused, with its code (`invalid`, `future`,
  `too-old`, `unknown-type`, `unknown-item`, `not-started`, `already`,
  `conflict`) and reason. `--write` applies them through the same merges as
  Pahlavan, moves applied files to `Coach/Inbox/applied/<YYYY-MM>/` and
  rewrites `Coach/Inbox/refused.json`; after the user's yes, as every write.
- `inbox --phone [--write]` builds `Coach/Inbox/phone.json`, what the phone's
  shortcuts read (today's items, the sessions with their logged lifts, the
  morning fields). Pahlavan keeps it current on its own.
- A refused entry is never forced in: show the user the reason; a conflict is
  the user's value against the phone's, and the user decides in Pahlavan.

## Not in the engine yet: snippets

Run from the vault root as `python3 - <<'EOF' … EOF`. They only read.

### Planned sets for a plan change that isn't written yet

The engine reads the written `plan-data.json`, and `plan`'s proposal has its
own `volume` (on the vault's map with `--vault .`). For a change not
written yet (a swap, the next month, a hand edit of the draft), save the proposed
`plan-data.json` as a scratch copy (never over the real file) and point
`PLAN` at it: it counts as `engine review` does.

```python
import json, re
from pathlib import Path
PLAN = Path("/tmp/plan-data.proposed.json")      # the scratch copy
plan = json.loads(PLAN.read_text())
FIT = Path("Fitness")                              # the fitness folder: `engine.cjs folders` prints it
log = json.loads((FIT / "fitness-log-data.json").read_text())
G, lad = plan["guide"], {l["id"]: l for l in plan["ladders"]}
def muscles(n):
    return (G.get(n) or {}).get("muscles") or {}
def name(it):
    h = log.get("ladders", {}).get(it.get("ladder"), [])
    return lad[it["ladder"]]["levels"][h[-1]["level"] - 1]["name"] if it.get("ladder") and h else it["name"]
sets = lambda sr: int(m.group(1)) if (m := re.match(r"\s*(\d+)\s*×", sr)) else 0
tot, over = {}, []
for kind, types in (("lift", plan["liftTypes"]), ("short", plan["shortTypes"])):
    for t in types:
        direct = {}
        for it in plan["sessions"][t]:
            m, n, k = muscles(name(it)), sets(it["sr"]), plan["weekTarget"][kind] / len(types)
            for g in m.get("main", []):
                tot[g] = tot.get(g, 0) + n * k
                direct[g] = direct.get(g, 0) + n
            for g in m.get("helps", []):
                tot[g] = tot.get(g, 0) + 0.5 * n * k
        over += [f"{t} {g} {v}" for g, v in direct.items() if v > 8]
tier = lambda v: "under 4" if v < 4 else "4-10" if v <= 10 else "10-16" if v <= 16 else "16-20" if v <= 20 else "over 20"
for g in plan["muscles"]:
    print(f"{g:<13} {tot.get(g, 0):>6.1f}  {tier(tot.get(g, 0))}")
print("more than 8 direct sets in a session:", ", ".join(over) or "none")
```

### Energy and protein

For the `diet` job (`diet.md`). Set the four inputs from the Athlete profile
and the goal's band; the trend weight is `review`'s `weight.trend` (latest).
The protein range is the engine's (`review` `weight.protein`, by goal; set
`P_LO` and `P_HI` from its `value.gPerKg`), never this snippet's own. Light
level uses only the protein and fiber lines.

```python
SEX, AGE, HEIGHT_CM = "male", 42, 182     # from the Athlete profile
W = 83.5                                  # trend weight, kg: engine review weight.trend.value.latest.trend
PAL = 1.5                                 # activity factor (diet.md)
RATE = -0.0025                            # target change a week, fraction of body weight (rules.md band)
MEALS = 3
P_LO, P_HI = 1.6, 2.2                     # engine review weight.protein.value.gPerKg (the range by goal)
rmr = 10 * W + 6.25 * HEIGHT_CM - 5 * AGE + (5 if SEX == "male" else -161)
tdee, floor = rmr * PAL, (1500 if SEX == "male" else 1200)
kcal = tdee + RATE * W * 7700 / 7         # about 7,700 kcal per kg of change (rough)
print(f"trend weight {W:.1f} kg; resting {rmr:.0f} kcal; maintenance about {tdee:.0f} kcal (x{PAL}, +-10% or more)")
print(f"protein {P_LO * W:.0f}-{P_HI * W:.0f} g a day (the engine's range); per meal {0.4 * W:.0f}-{0.55 * W:.0f} g; "
      f"{MEALS} meals give {MEALS * 0.4 * W:.0f}-{MEALS * 0.55 * W:.0f} g (top up the rest)")
if RATE < -0.01:
    print("RATE beyond 1% a week: not allowed; use -0.01 or slower")
print(f"goal energy {kcal:.0f} kcal a day for {RATE:+.2%} a week ({RATE * W:+.2f} kg)"
      + (f"; BELOW THE FLOOR {floor}: use {floor} and a slower rate" if kcal < floor else ""))
print(f"fat at least {0.2 * max(kcal, floor) / 9:.0f} g; fiber at least {max(25, 14 * max(kcal, floor) / 1000):.0f} g")
```
