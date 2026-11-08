# File formats

Everything lives in `<fitness>/Coach/` (the fitness folder's Coach folder). Create the folder and a file
the first time a job needs it, from the skeletons below. Examples use
illustrative numbers: real entries take theirs from code and the user.

Common rules: dates `YYYY-MM-DD`; numbers carry their source; frontmatter
`tags: [fitness, coach]`; wikilinks to the files they cite
(`[[<fitness>/Coach/Decisions#2026-11-22 · Week resized to 4 sessions|decision]]`, the folder written out).
These are the user's own notes: the Ledger may name what a clinician named;
the coach still never adds a diagnosis of its own.

## `Athlete profile.md`

One file, edited in place. Every edit adds a line to History.

```markdown
---
type: athlete-profile
updated: 2026-11-01
screening: go            # go | go-ramped | conservative | blocked
screened: 2026-11-01     # re-screen by this date + 12 months, or when health changes
tracking: standard       # light | standard | full
tags: [fitness, coach]
---

# Athlete profile

## Basics
| Field | Value | Source |
|---|---|---|
| Age | 42 | intake, 2026-11-01 |
| Weight | 83.5 kg | intake, 2026-11-01 |
| Training age | 1–3 years | intake, 2026-11-01 |
| History used | starting weights only | intake, 2026-11-01 |

## Body assessment (2026-11-01)
Photos: `Progress Photos/2026-11-01/` (front, side, back, posture-closeup, move-squat-side, move-squat-front, move-overhead-side).

| Area | Seen | Confidence | Plan emphasis | Confirmed |
|---|---|---|---|---|
| Posture | Head forward, shoulders rounded | high | Pull:push about 2:1; face pulls, rear delts; chest stretch | yes: "my neck aches by the afternoon" |
| Movement | Heels lift at the bottom of the squat | medium | Heel-elevated goblet squat; ankle mobility | no: squats deep with the heels down (left out of the plan) |

## Screening
- **2026-11-01: Go.** Regular exerciser: yes. Known heart, metabolic or kidney condition: no. Warning signs: none. Other: none.
- Plan limits from it: none. Re-screen by 2027-11-01.

## Goals
| # | Goal | Importance | Confidence | Measure | Predicted by phase end |
|---|---|---|---|---|---|
| 1 | Recomposition | 9 | 7 | Waist (tape) | 93 → 90–91 cm by week 16 |
| 2 | Posture capacity | 8 | 6 | Wall test, side photo | 4 → 2 cm |

## Availability
- Stated: 4 days, 60 min, no fixed days, time varies.
- Actual, last 4 weeks (only when the user chose to use their history): 4.8 training days a week (numbers.md; gaps confirmed with the user).
- Planned: 4 sessions a week, Express as the floor.
- Known busy periods: (none yet)

## Equipment
Condo gym: dumbbells to <heaviest>, barbell and plates, cable machine, leg press, bench.

## Tracking level
Standard: the top set of the two logged lifts per lifting session. The coach can't see per-set effort; RIR comes from the check-in.

## Preferences
- Likes: …  Dislikes: …  Cardio: bike, incline walk.
- When a week goes badly: "I just miss it" → the minimum week and if-then plans.

## Standing plan rules
The user's own rules for every plan (sets, session structure, preferred tools, a load ceiling), one line each with its source and date; the plan job reads them first. The ones the engine can check also go in `profile.json` `planRules`, and `engine check` reports a plan that breaks one.

## Later priorities
Priority muscles the user named past this phase's room, in their order (`intake.md` Round 2, question 5; `planning.md` step 5): "Glutes (named 2026-11-05): for phase 2." The phase review offers the next one; it moves into `profile.json` `priorityMuscles` only on the user's yes.

## Movement self-check (2026-11-01)
| Test | Result | Starting point | Confirmed |
|---|---|---|---|
| Push-ups | 30 | Push-up ladder level 4 (deficit push-ups) | (a count: not asked) |
| Hang and pull | 40 s hang, 5 strict pull-ups | Pull-up ladder level 6: pull-ups as the main vertical pull | (a count: not asked) |
| Overhead reach | Ribs flare, lower back arches | Landmine or incline pressing; upper-back extension and a lat stretch in the warm-up | no: "pressing overhead doesn't hurt or arch my back" (overhead presses stay in; the warm-up lines stay) |

## RIR calibration
| Exercise | Date | Predicted RIR | Actual RIR | Bias |
|---|---|---|---|---|
| Cable Chest Press | 2026-11-19 | 2 | 4 | +2 (stops early) |

## History
- 2026-11-01: created at intake.
```

## `Ledger.md`

The body ledger: one section per injury or niggle, newest activity first.
Status is one of active, managing, resolved. A resolved entry stays: a
recurrence starts from its notes.

```markdown
---
type: body-ledger
updated: 2026-11-01
tags: [fitness, coach]
---

# Body ledger

## Shoulder (old rotator cuff issue)
- **Status:** managing (since 2026-07)
- **Dates:** old issue, named at the July 2026 intake; no flare-ups logged since.
- **What aggravates it:** strict barbell overhead pressing, dips (roadmap).
- **What helped:** band external rotation before pressing; neutral-grip dumbbell presses.
- **Plan constraints:** band external rotation in every pressing warm-up; neutral-grip DB presses, no dips; shoulder pain (not effort) stops the exercise.
- **Clinician:** not seen for it.
- **Log:**
  - 2026-11-01: entry created from the intake form and the roadmap's pressing rules.
```

## `profile.json` and `ledger.json` (for the engine)

The machine-readable twins of `Athlete profile.md` and the Ledger's
constraints, in the engine's schema v1. Written by `intake` together with the
Markdown, changed whenever it changes (a History line covers both), and
checked with `engine.cjs validate <file> --json` before saying they're
written. `engine plan` needs `profile.json`; `engine review` uses the profile's
goal band and priority muscles and screens the week's plan against the
Ledger. Without them the engine says so and falls back (the roadmap's weight
band, no Ledger screen). Plain JSON, two-space indent, no comments; keys
starting with `_` are allowed as notes.

```json
{
  "schemaVersion": 1,
  "units": { "load": "lb", "body": "kg" },
  "basics": { "birthYear": 1984, "heightCm": 182, "sex": "male" },
  "goals": [
    { "id": "recomp", "kind": "recomposition", "label": "Recomposition", "importance": 9, "confidence": 7, "measure": "waist (tape)" },
    { "id": "posture", "kind": "posture", "label": "Posture capacity", "importance": 8, "confidence": 6, "measure": "wall test" }
  ],
  "availability": { "daysPerWeek": 4, "minutesPerSession": 60 },
  "equipment": ["dumbbells", "barbell", "bench", "cable", "leg press"],
  "travelEquipment": ["bands", "pull-up bar"],
  "trackingLevel": "standard",
  "screening": { "outcome": "go", "date": "2026-11-01" },
  "emphasis": [
    { "area": "Posture", "seen": "Head forward, shoulders rounded", "confidence": "high", "confirmed": true,
      "emphasis": "Pull:push about 2:1; face pulls, rear delts; chest stretch", "kind": "forward-head-rounded-shoulders" }
  ],
  "priorityMuscles": ["glutes"],
  "experience": "intermediate",
  "preferences": { "likes": ["goblet-squat"], "dislikes": [], "cardio": ["zone2-bike"] },
  "useHistory": false,
  "planRules": { "setsPerExercise": 3, "liftSession": { "patterns": ["squat|lunge|hinge", "chest", "upper-back|lats", "shoulders"] }, "shortDayCore": true }
}
```

| Field | From the Athlete profile | Values |
|---|---|---|
| `units` | Equipment and the gym's plates | `load` and `body`: `kg` or `lb` |
| `basics` | Basics (age as `birthYear`) | optional; `sex`: `male` or `female` (leave it out for "prefer not to say") |
| `goals[]` | Goals, ranked | `kind`: `fat-loss`, `recomposition`, `gain`, `maintenance`, `strength`, `skill`, `posture`, `conditioning`, `health`; `importance` and `confidence` 0–10; optional `rateBand` `{unit: "pct" or "kg", lo, hi}` per week when the goal sets its own pace |
| `availability` | Availability | `daysPerWeek` 0–7, `minutesPerSession`; optional `fixedDays` (`mon`…`sun`), `busy` `[{from, to, note}]` |
| `equipment` | Equipment | words the engine knows: bodyweight, dumbbells, barbell (and plates), cable (machine), machines, leg press, bands, bench, pull-up bar, kettlebells, rings or TRX; anything else is reported as free text and not used |
| `trackingLevel` | Tracking level | `light`, `standard`, `full` |
| `screening` | Screening | `outcome`: `go`, `go-ramped`, `conservative`, `blocked`; `date` (re-screen by +12 months); optional `limits` |
| `emphasis[]` | Body assessment, one per row | `confidence`: `high`, `medium`, `low`; `kind` (the intake.md row): `forward-head-rounded-shoulders`, `overhead-limited`, `squat-heels-lift`, `knees-in`, `low-back-arch`, `asymmetry` (with `side`: `left` or `right`, the weaker), `lagging-area` (with `muscles`), `waist-fat`; `regions`: optional region ids, a part of the row's muscle the user named (`intake.md`, Round 2, question 5; never from the photos), declared weak like `priorityRegions` unless the row is declined; `confirmed`: the user's answer (`intake.md`, "Confirm each finding"), asked so that yes means the finding holds: yes is `true` and the plan acts on it; no is `false` and the plan leaves the row out; left out, not asked yet (see below) |
| `priorityMuscles` | Goals and lagging areas | muscle ids: `chest`, `shoulders`, `biceps`, `triceps`, `forearms`, `abs`, `obliques`, `upper-back`, `lats`, `lower-back`, `glutes`, `quads`, `hamstrings`, `calves` |
| `priorityRegions` | Regions the user declares weak (never diagnosed from photos) | optional; region ids (below). An `emphasis[]` row may name its own as `regions` (they count only when the row acts in full: confirmed, or any row in a profile that records no answers; a declined row, or one not answered yet in a profile that records answers, doesn't count). `review` reports each and `check` holds it to 6 direct sets near failure a week (`region-declared-short`); its muscle counts as a priority muscle everywhere (the 10–16 bands, the region rules, Progress and Plan) |
| `experience` | Training age, by how fast they progress | `novice`, `intermediate`, `advanced` |
| `preferences` | Preferences | exercise ids from the engine's catalogue (lowercase, dashes: `goblet-squat`, `zone2-bike`); an unknown id is a warning |
| `useHistory` | History used | `true` only when the user chose to use their history |
| `rirCalibration` | RIR calibration | `[{exercise, date, predicted, actual}]`, one per calibration set (`checkins.json` section) |
| `work` | `tracking.md`'s desk-work questions | `{desk: true or false, sittingHours?}`: hours at a computer on a work day; the plan proposes desk breaks for desk work |
| `targets` | The plan's targets (the roadmap's Targets table), written by every new or changed plan (`plan-files.md`, step 4) | `{by?, waistDropCm?, weightDropKg?, rhrDropBpm?, stepsPerDay?, sleepHours?, tests?}`: `by` the date they are for (the plan's last day when left out); the drops `[lo, hi]` from the cycle's first value; `stepsPerDay` and `sleepHours` a 7-day average to hold; `tests` `{"<test id>": n}` (`pushups`, `pullups`, `hollowS`, `handstandS`, `sidePlankS`). Pahlavan's Progress and Plan screens measure against them; what they can't hold (the wall gap) stays in the roadmap |
| `availability.shortSessions` | Availability: some days shorter | `{days, minutes}`: how many of the `daysPerWeek` are short and their minutes (`days` under `daysPerWeek`, `minutes` under `minutesPerSession`); lifting goes on the long days |
| `preferences.splits` | Preferences: splits liked or disliked before | `{likes?, dislikes?}`, each a list of `full-body`, `upper-lower`, `push-pull-legs`, `heavy-and-light-days`, `body-part`, `torso-limbs`, `upper-lower-full`, `specialization`, `hift`, `circuit`, `calisthenics` (`rules.md`'s split families); weighed in the coach's candidate comparison (`planning.md`, step 1) for the candidates of that kind; the generator's optional baseline also scores its own templates on them (an upper/lower/full template and push/pull/legs plus upper/lower count as `upper-lower` too, a minimum-dose one as `circuit`). Anything the kinds can't say stays in the Athlete profile's Preferences, in the user's words |
| `badWeek` | Preferences: when a week goes badly | `{usually: [...], note?}`: `skips-sessions`, `shortens-sessions`, `stops-for-a-while`, `travel`, `eats-off-plan`, `sleeps-badly`, and the answer in the user's words; it sets the split's skip risk and the pre-mortem's first risks |
| `selfCheck` | Movement self-check | The results with the date (below); the engine reads it for the ladders' starting levels and the exercise choices `intake.md` lists |
| `planRules` | Standing plan rules, the ones the engine can check | `{setsPerExercise?, liftSession?, shortDayCore?}`, each optional: `setsPerExercise` the working sets of every strength exercise with sets on a lifting day; `liftSession.patterns` what every lifting session holds, each entry a catalogue movement pattern (`squat`, `hinge`, `lunge`, `horizontal-push`, `horizontal-pull`, `vertical-push`, `vertical-pull`, `lateral-raise`, `rear-delt`, ...) or a muscle id (`chest`), alternatives joined by `\|` (`"squat\|lunge\|hinge"`: a leg exercise); `shortDayCore: true` a core exercise on every short day. `engine check` warns `plan-rule` for each break; the coach designs within them or states why not (an override) |

**`selfCheck`** holds the same facts as the Athlete profile's "Movement
self-check" table, one field per test; a test that was stopped (pain) or not
done is left out, never guessed:

```json
"selfCheck": {
  "date": "2026-11-01",
  "sitToStand": { "easy": true, "heelsDown": true },
  "pushUps": 30,
  "deadHangS": 40,
  "pullUps": 5,
  "coreHold": { "kind": "plank", "seconds": 60 },
  "hingeFlatBack": true,
  "overheadReach": { "clean": false, "ribFlare": true, "lowBackArch": true },
  "wallGapCm": 5,
  "balanceS": { "left": 30, "right": 30 },
  "confirmed": { "overheadReach": false }
}
```

| Field | Test | Values |
|---|---|---|
| `date` | the day of the tests | `YYYY-MM-DD`, required |
| `sitToStand` | Sit-to-stand | `easy` (true, or false for a struggle) and `heelsDown` (false when the heels lift) |
| `pushUps` | Push-ups | clean reps, 0 when none |
| `deadHangS`, `pullUps` | Hang and pull | the hang in seconds; strict pull-ups, 0 when none |
| `coreHold` | Plank or hollow hold | `kind`: `plank` or `hollow`; `seconds` |
| `hingeFlatBack` | Hinge | true when the back stays flat with the hands at the knees |
| `overheadReach` | Overhead reach | `clean`; when not clean, `ribFlare` and `lowBackArch` say what was seen |
| `wallGapCm` | Wall test | the gap behind the head, cm |
| `balanceS` | Balance | seconds `left` and `right` (the test stops at 30) |
| `confirmed` | The user's answer to each finding | per test whose result changes exercise choice (`sitToStand`, `hingeFlatBack`, `overheadReach`, `balanceS`), asked so that yes means the finding holds: yes is `true`, it holds and the plan acts on it; no is `false`, it doesn't and only its warm-up lines stay (above: pressing overhead doesn't hurt or arch the back, so overhead presses stay in); a test left out, not asked yet |

**A finding with no answer.** In a profile that records an answer anywhere
(a `selfCheck.confirmed` map, even empty, or `confirmed` on any row), a
finding left unanswered ranks its regression first and adds its warm-up,
nothing more: it rules no movement out, makes no priority muscle (a lagging
area) and sets no 2-to-1 pull to push (a posture goal's own floor still
applies). A profile with no answer anywhere was
written before the question: the engine applies its findings as before, and
`plan` and `review` warn `finding-unconfirmed` with the question to ask and
where the answer goes (`selfCheck.confirmed.<test>` or
`emphasis[<i>].confirmed`): yes is `true`, no is `false`.

`ledger.json` holds one constraint per Ledger entry that constrains the plan
(status active or managing); a resolved entry has none, or its `until` date
has passed.

```json
{
  "schemaVersion": 1,
  "constraints": [
    { "id": "abdominal-wall", "area": "abdomen", "noTags": ["abdomen-high"], "until": "2026-11-15",
      "note": "No high-strain lifts until the doctor's review." },
    { "id": "shoulder", "area": "shoulder", "noMovements": ["overhead-press"],
      "note": "No strict barbell overhead pressing; neutral-grip dumbbell presses." }
  ]
}
```

- `id`: unique, lowercase with dashes, named after the Ledger entry.
- `noTags`: abdominal-strain tags ruled out (`abdomen-high`,
  `abdomen-moderate`, `abdomen-low`, rules.md's IAP table) or `joint:<name>`.
  With `abdomen-high` ruled out, a moderate lift stays allowed with
  conditions (breathe out on the effort, RIR ≥ 2).
- `noMovements`: exercise ids: the engine catalogue's (`back-squat`,
  `deadlift`, `rdl`, `overhead-press`, `bench-press`, `leg-press`,
  `barbell-row`, `hip-thrust`, `farmer-carry`, `ring-dip`) or the plan's own
  (its names in lowercase with dashes, such as `barbell-back-squat`).
  `engine check` blocks any plan item that is one (`ledger-blocked`, a hard
  error); `review` and Today name it with its swaps, and the generator's
  baseline leaves it out.
- `until`: the last day it applies (inclusive); leave it out for an open one.

**The plan they make** comes out as `plan-data.json` (the coach designs it
and writes it through `engine plan-write`; `engine plan --format plan-data`
is an optional baseline to compare against, and exported with `--vault .`
it keeps the plan's names and unchanged items' "Why:" lines; its fields in
`planning.md`, "Mapping onto `plan-data.json`").
A generated plan carries `pair: true` on a superset's second item, done with
the item before it: both items rest "90 s after each pair" and their notes
say "Superset with X: a set of each, then rest." (`planning.md`, step 5).

**A plan item's `rir` and `timed`** carry what notes used to:
- `rir`: the reps in reserve, a number (`2`) or `[lo, hi]` for a range
  (`[1, 2]`). The slot's target is the low end; the effort rule reads the
  high end. Without it, the note's "RIR 2." or "RIR 1–2" is read, as in
  plans written before the field. The export writes the field, never a
  "RIR n." sentence in a note.
- `timed`: a timed item's minutes and structure, `{minutes?, rounds?,
  workMin?, restMin?, warmupMin?, cooldownMin?}`, every value in minutes;
  it needs `minutes`, or `rounds` with `workMin`. Steady cardio is `sr:
  "20 min"` alone (the field adds nothing). Intervals: `"timed": {"minutes":
  30, "rounds": 4, "workMin": 4, "restMin": 3}` is 4 × 4 min hard with 3 min
  easy between. Intervals take warm-up + rounds × work + (rounds − 1) ×
  rest + cool-down; with no warm-up or cool-down given, `minutes` is the
  whole item when longer (the easy time around them), never less than the
  intervals. Keep `sr` at the same total (`"30 min"`). Without the field,
  the minutes in `sr` and intervals the note describes ("4 × 4 min hard, 3
  min easy between", and warm-up or cool-down minutes when it gives them)
  are read.

A timed item's sets in the engine (`session`, the Plan screen) are its
rounds, 1 for steady minutes; the log keeps its own count of a timed line,
a set per 2 minutes (`exercises[].sets`), as before. In the calibration week
an interval item is easy steady cardio for the same minutes (rule
`plan.calibration.cardio`, `planning.md` section 8), with no week-1 text in
the note. A `rir` or `timed` that isn't well formed is read from the note
instead, with a `plan-item-field` warning in `review`.

**A guide entry's `muscles`** is `{main, helps}` (plan-data's 14 groups), or
`{main: [], helps: [], kind: "cardio" | "mobility", areas}` for an item
not counted in sets. For a movement the engine's catalogue knows (its name,
id or a common synonym), the catalogue's tags count and the entry's are a
copy the export keeps in step; `review` warns `muscle-tags-differ` while
they disagree. To keep an entry's own tags, add `override` with the reason,
a non-empty string, beside at least one main muscle: `"muscles": {"main":
["shoulders", "upper-back"], "helps": [], "override": "rear delts counted
as shoulders on purpose"}`. Its tags then count everywhere (Review,
Progress, Plan, the movement guide and `plan --vault`), the export leaves
them, and `review` lists it in `muscle-tags-overridden`. An override that
isn't a non-empty reason, or has no main muscle beside it, is ignored
(`muscle-tags-override-ignored`): the catalogue's tags count and the next
export replaces the copy, override included. An override counts in a new
plan only on the entry named like the catalogue movement; on a variant
key ("Goblet squat (heavy)") it counts for the items named by it. A
movement the catalogue doesn't know always counts with the entry's tags. A
`kind` entry is never counted, even for a movement the catalogue counts as
strength work (`muscle-tags-uncounted` names those).

**Muscle regions** are the parts of a muscle that training studies show
growing differently with the exercise. The ids, each its parent muscle's id
first: `quads-rf` (rectus femoris), `quads-vasti`, `hamstrings-hip`,
`hamstrings-knee`, `calves-gastroc`, `calves-soleus`, `triceps-long`,
`shoulders-front`, `shoulders-side`, `shoulders-rear` (heuristic),
`chest-upper`, and the rough-guide `upper-back-traps` and `upper-back-mid`.
A guide entry's `muscles` may carry `regions` (and so may a schema-v1
exercise's `muscles`), the regions the movement biases; each region's parent
muscle belongs in `main` or `helps`. They follow the muscles' rule: for a
movement the catalogue knows, the catalogue's regions count and the entry's
are a copy the export keeps in step (writing them into an entry that has
none); the entry's own count for a movement the catalogue doesn't know, or
beside an honoured `override`. A value that isn't a region id is warned
about and counts nowhere: `unknown-region`, or `unsupported-region` for the
popular ones the evidence doesn't support (inner or outer chest, lower
chest, the VMO or inner and outer quad, upper or lower lats, the biceps
heads or peak, upper or lower glutes), each with the nearest supported
option and why. A region whose muscle the entry doesn't tag in `main` or
`helps` counts nowhere either (`region-parent-missing`: add the muscle, or
remove the region). A set counts for a region 1 when its parent muscle is a
main muscle of the movement and half when the parent only helps, beside the
muscle's own sets, which regions never change (`numbers.md`, `review`'s
`volume.regions` and `check`'s region codes).

## The plan's standing rules (`plan-data.json`, for the engine)

The coach's decisions, written beside the plan in `plan-data.json`; the
engine only does each rule's arithmetic and cites the rule in its reasons.
The coach writes them with every plan and revises them at the check-ins. Every key is optional: a rule left out is Pahlavan's old default
(the values below), and `review` lists those in one `legacy-default`
warning. A kind written in a way Pahlavan can't read keeps the old default,
with a `rules-invalid` warning; unknown keys are listed and left out.

```json
{
  "rules": {
    "calibration": { "weeks": [1], "rir": 3, "cardio": "easy", "afterRestart": true },
    "lightWeeks": { "every": 4, "sets": 2, "load": 0.9, "rirAdd": 3, "early": "apply" },
    "tests": { "weeks": "phase-ends" },
    "readiness": { "low": { "sets": -1, "rir": 1 } },
    "soreness": { "sore": { "sets": -1, "rir": 1 }, "twoDays": "easier" },
    "missed": { "easeBackAfterWeeks": 1, "restartAfterWeeks": 3, "easeBackDrop": 0.1, "easeBackRir": 1 },
    "stall": { "response": "triage" },
    "hotel": { "swaps": "catalogue", "longTripSets": "third" }
  }
}
```

- `calibration`: the plan weeks that find working loads at `rir` (0 to 6),
  whether intervals that week are easy steady minutes (`"easy"`) or as
  planned (`"as-planned"`), and whether the first week back after a restart
  calibrates too; `"none"` for no calibration week. A calibration week on a
  light week stays a light week (`calibration-on-light-week` names it).
- `lightWeeks`: `every` N plan weeks (2 or more), or `weeks: [4, 8, 13]`
  (one of the two); a mesocycle ends at each light week and a phase is two.
  `sets` is every sets item's count that week (a number, or `"half"`),
  `load` the fraction of the last loading weight (0.5 to 1), `rirAdd` the
  RIR added (0 to 6). `early`: what
  an early signal does (low readiness with a falling e1RM, stalls on 2+ main
  lifts, poor recovery): `"apply"` makes the week light, `"offer"` reports
  it for the coach (the default once `lightWeeks` is written), `"none"`
  lists it only. Under the plan's own light weeks no busy week moves one and
  no check-in cancels one: the coach moves a light week by editing `weeks`.
- `tests`: the plan weeks with the fitness tests (at least one), or
  `"phase-ends"`.
- `readiness.low` and `soreness.sore`: a low-readiness day's or a sore main
  muscle's change, `{sets, rir}` (sets 0 or less, RIR added 0 to 6), or `"none"`
  (the whole kind as `"none"` too). `soreness.twoDays`: `"easier"` swaps to
  the easier variation after two sore days running, `"same"` doesn't.
- `missed`: the weeks off that ease back and that restart (whole weeks,
  easing back fewer than restarting), and the first week back's drop (a
  fraction up to 0.5) and added RIR. A restart without a
  calibration week (`calibration.afterRestart: false`) eases back instead.
- `stall.response`: `"triage"` (the ladder picks one step per check-in) or
  `"report"` (the facts only, in `lifts[].stallFacts`; the coach picks). The
  stall itself (2 % or less e1RM gain over 3 sessions at 80 % adherence) is
  one definition everywhere.
- `hotel`: `swaps` from the catalogue (its starter movements, the ones the
  Hotel version's ranking was built on) or `"skip"` a movement the travel
  kit can't do; a trip of a week or more at `"third"` of the sets or
  `"all"`.

A logged lift's rule sits in its `lifts` entry, beside its `lo`, `hi` and
`inc`: `"progression": {"rule": "double", "onMiss": {"after": 2, "drop":
0.1}, "onStall": "report"}`. `rule` is `double` (reps up inside lo–hi, then
+inc), `linear` (+inc every session each set reaches hi; reps stay at hi),
`hold` (reps only, no weight step) or `target` with `"target": {"weight":
60, "reps": 8, "rir": 2}` (the coach's numbers, held once met; `onMiss`
and `onStall` are not read with it). `onMiss`: so many sessions in a row
under lo, then that much lighter (a drop from 0.01 to 0.5), or `"hold"`.
`onStall`: `"report"`, or `{"drop": 0.1}` (a stall takes the next target
that much lighter, once: the stall check starts again from that session). The step is the coach's: an increase over the
load-jump guide (about 10 % a week, a heuristic) is reported, not capped.
A ladder stays the item's own `ladder`. Express on a short day is the
`express` block's `"short": "half"` (every item at half) or `"skip"`, not a
key of `rules`.

## The plan's overrides (`plan-data.json`, for `engine check`)

The coach's stated reasons for going outside an evidence range, beside the
plan in `plan-data.json`: each answers one warning `engine check` gives
(`numbers.md`, "The plan check"), by its code and, when it names one, its
item. The check shows the warning as information with the reason; it never
clears a hard error.

```json
{
  "overrides": [
    { "code": "volume-over-cap", "item": "upper-back", "reason": "Posture block: pull at twice push for this mesocycle.", "decision": "2026-11-07 · Upper back past the cap" },
    { "code": "rest", "item": "S1 Pallof Press", "reason": "Anti-rotation holds, not sets for size: 45 s is enough." }
  ]
}
```

- `code`: the finding's code (`volume-over-cap`, `rest`, `priority-over`,
  `time-over`, ...). Required.
- `item`: one item of the finding, as the check names it: a muscle (its id
  or label), a session item ("A Face Pull"), a session type ("S2"). Left
  out, the override answers the whole finding.
- `reason`: why, in a sentence the user would recognise. Required: an
  override without one is a hard error (`override-without-reason`).
- `decision`: the Decisions entry that records it (`formats.md`,
  `Decisions.md`), when there is one.

An override that matches nothing on the plan is listed in
`override-unused` (it can go). Unknown keys, or an entry with no code, are
`invalid-data`. The export keeps the list as written.

## The plan's start (`plan-data.json`)

The plan's first day, a top-level `"start": "2026-11-09"` (YYYY-MM-DD) in
`plan-data.json`, beside `phases` and `weeks`. The Monday-to-Sunday week
holding it is plan week 1 everywhere (Pahlavan's Today, Plan and top bar,
`review`'s `week`, the light weeks, the calibration week, the log's
snapshot), from the day the plan is written, whether a session has been
logged or not, and over the week the log or the baseline note would give.
Before that week no plan week holds a date (`review`'s `week.planWeek` is
null, `week.planStart` the start's Monday) and no session shows: `session`
and Today say "Your plan starts <its Monday>".

- **The coach writes it with a fresh start's or a reset's plan:** the date
  the user chose in the plan job's first step (`planning.md`, "The order").
  A phase review's next block, the next month and every change inside the
  plan keep the `start` the file has: `check --plan` and `plan-write` warn
  `start-changed` when a draft drops or moves it (a reset answers it with
  an override naming the reset).
- **`plan --start D`** writes it into a baseline export: the generator's
  week 1, the Monday of the week holding D, as `start` itself reads. Without
  `--start`, an export over the plan as written (`--vault .`) carries that
  plan's `start`; one with no plan to export over writes none.
- **Left out** (every plan before 0.26), week 1 is the first logged plan
  session's week, and until the cycle has one the cycle start's week, as
  before.
- **Not a date** (`"next Monday"`, a number), it is read around with a
  `plan-data` warning in `review` (the log's week 1 stands) and is a hard
  error in `check` and `plan-write`.

## A ladder's starting level (`plan-data.json`)

Each ladder in `plan-data.json`'s `ladders` may carry `"startLevel": N`,
the level this plan starts it at (1-based, as `log ladder --level`
counts), beside its `id`, `name` and `levels`:

```json
{
  "ladders": [
    { "id": "pullup", "name": "Pull-up", "startLevel": 6, "levels": [{ "name": "Dead hang" }, { "name": "Scapular pull-up" }, { "name": "Inverted row" }, { "name": "Negative pull-up" }, { "name": "Band-assisted pull-up" }, { "name": "Pull-up" }, { "name": "Weighted pull-up" }, { "name": "L-sit pull-up" }] }
  ]
}
```

A "your level" item (`"ladder": "pullup"`) counts as one level of its
ladder: in the weekly sets per muscle (`review`, `check`, Pahlavan's Plan
and Progress), the effort rule, the session's list and the exercises the
log freezes. The level is, in this order:

1. **The log's level** on the date (`log ladder`), whenever it holds one:
   a logged level wins over the start, a lower one too.
2. **The plan's `startLevel`**, before any level is logged: a draft read
   with `check --plan` or `review --plan`, and a new plan before its first
   logged level, count the level the plan means.
3. **The lowest level**, with neither: `review` and `check` warn
   `ladder-start` (each item, counted as level 1), since a plan that means
   pull-ups would read as dead hangs.

- **The coach writes it** on every ladder a new plan carries, at the
  self-check's level (`intake.md`, "The movement self-check"); a baseline
  export (`plan --format plan-data`) writes the self-check's level. The log
  still gets the level with `log ladder` on the plan's first day, in the
  same yes: the level history, the Skills card and the level moves start
  from the log.
- **Left out**, the item counts the log's level, else the lowest with the
  `ladder-start` warning.
- **Not one of the ladder's levels** (0, past the last level, `"6"`), it is
  read around with a `plan-data` warning in `review` and is a hard error in
  `check` and `plan-write`.

## `checkins.json` (the check-in answers, for the engine)

One record per check-in date: the Sunday check-in's answers as data.
`engine.cjs checkin template` prints the skeleton, `checkin add` (dry run,
then `--write` after the user's yes) validates and merges it by date. Never
edit the file by hand: a field left out of a later `add` keeps its value, and
the other records are always kept. `engine review` reads it (`checkin.md`).

```json
{
  "schemaVersion": 1,
  "checkins": [
    {
      "date": "2026-11-08",
      "weekStart": "2026-11-02",
      "confirmedUnlogged": [{ "date": "2026-11-04", "type": "S1" }],
      "restDays": ["2026-11-06"],
      "missedDays": [],
      "effort": 7,
      "jointAches": [{ "area": "left knee", "severity": 4, "exercise": "goblet-squat", "lingered": true }],
      "stress": 2,
      "recovery": 4,
      "reportedRir": { "Flat DB Bench Press": 2.5, "Leg Press": 4 },
      "proteinExtra": 1,
      "pattern": { "fish": true, "legumes": false, "red-meat": true, "veg": true, "fruit": false },
      "enjoyment": 4,
      "knownBusy": [{ "from": "2026-11-16", "to": "2026-11-20", "kind": "travel" }],
      "deload": { "trainedAtFullLoad": ["2026-10-19"] },
      "triage": [{ "lift": "Flat DB Bench Press", "step": 2, "date": "2026-11-08" }],
      "focusFollowed": true,
      "notes": "Slept better after moving the phone out of the bedroom.",
      "letter": "Fitness/Coach/Letters/2026-11-08.md"
    }
  ]
}
```

| Field | From (checkin.md) | Values |
|---|---|---|
| `date`, `weekStart` | the check-in | the check-in date and the reviewed week's Monday (required) |
| `confirmedUnlogged` | 1. Gaps | `[{date, type?}]`: sessions done but not logged; `type` the plan's session (`A`, `S1`), `lift`, `short` or `custom` |
| `restDays`, `missedDays` | 1. Gaps | dates that were planned rest, or missed sessions |
| `effort` | 2. Effort | easy 5, solid 7, hard 9, too much 10 |
| `jointAches` | 3. Pain | `[]` for none; each `{area, severity 0–10, exercise?, lingered?}`. Over 3/10 or lingering counts as a fatigue sign |
| `stress` | 4. Life | calm 1, normal 2, busy 4, crunch, travel or illness 5 |
| `recovery` | 5. Recovery | sore all week 1, often still sore 2, mostly 4, always 5 (2 or less is poor) |
| `reportedRir` | 6. Top-set RIR | one number, or `{"<lift>": n}`: 0–1 as 0.5, 2–3 as 2.5, 4, 5 or more as 5; left out for "didn't notice" |
| `proteinExtra` | 7. Protein | 0 to the unticked days: the days the answer adds to the protein ticks (read time adds the ticks, capped at the week's days). Records before engine 0.14.0 have `proteinDays` (ticks plus the answer's low end) and still read as saved |
| `pattern` | 11. The pattern (only with an eating plan that has one) | `{"<line id>": true \| false}`: met this week or not, by `eating-plan.json`'s pattern ids; a line left out when unsure. Only Pahlavan's Food tab reads it; no rule does |
| `enjoyment` | 8. Enjoyment | dreaded 1, meh 2, fine 4, a lot 5 |
| `knownBusy` | 9. Availability | `[{from, to, kind, sessions?, note?}]`, kind `travel`, `crunch` (busy, fewer days; `sessions` how many) or `other` |
| `focusFollowed`, `notes` | 10. Decisions, last question | the last letter's focus happened; anything worth keeping. The decisions themselves stay in `Decisions.md` |
| `deload.cancelled`, `deload.reason` | the coach (a deload due next week) | the user cancels the deload in the week after the check-in |
| `deload.trainedAtFullLoad` | the coach (the template asks) | Mondays of light weeks (deload weeks in the data) the user trained at full load: progression then uses those sessions |
| `triage` | the letter | `[{lift, step 1–4, date}]`: the step the letter applied; the next check-in starts one step later |
| `letter` | the letter | its path in the vault |
| `energy`, `sleepQuality` | not asked | 1–5, the morning check-in's scales, for weeks without daily check-ins |

`Athlete profile.md`'s RIR calibration table also goes into `profile.json` as
`"rirCalibration": [{"exercise": "cable-chest-press", "date": "2026-11-19",
"predicted": 2, "actual": 4}]` (exercise ids as for `preferences`). The bias
is actual minus predicted (+2: stops early), and the engine adds it to
reported or logged RIR for that exercise.

## `tracking.json` (what Pahlavan tracks)

The daily items (supplements, amounts, ticks, stand-ups, sitting time, desk
breaks), their day records, the coach's suggestions, the morning check-in's
time, the body record's schedule and the bring-over record. Pahlavan reads
and writes it (its Habits section, Due today, the reminder cards); the coach
writes it **only through `engine.cjs track`** (`tracking.md`, "The tracking
file": a dry run, then `--write` after the user's yes), which keeps the
screens' rules. Never by hand. `engine tracked` and `engine habits` read it
back.

```json
{
  "schemaVersion": 1,
  "items": [
    {
      "id": "creatine", "kind": "supplement", "name": "Creatine", "dose": "5 g",
      "schedule": { "kind": "daily" }, "when": "morning", "reminder": { "at": "08:00" }, "habit": "creatine",
      "start": "2026-11-03",
      "source": { "by": "coach", "why": "Optional. You lift 4 days a week for strength: 5 g a day (Kreider 2017).", "from": "intake", "on": "2026-11-03" }
    },
    {
      "id": "protein", "kind": "tick", "name": "Protein", "goal": { "amount": 134, "unit": "g" }, "means": "At least 134 g of protein",
      "schedule": { "kind": "daily" }, "when": "evening", "reminder": { "at": "21:00" }, "habit": "protein",
      "start": "2026-11-03", "source": { "by": "coach", "why": "Your eating plan: at least 134 g a day, 1.6 g/kg (Morton 2018).", "from": "eating plan", "on": "2026-11-03" }
    }
  ],
  "days": { "2026-11-03": { "creatine": { "done": true, "at": "2026-11-03T13:02:00.000Z" } } },
  "suggestions": [
    { "id": "lights-out", "on": "2026-11-03", "state": "open",
      "item": { "id": "lights-out", "kind": "tick", "name": "Lights out by 22:45", "when": "bedtime", "reminder": { "at": "22:15" },
                "schedule": { "kind": "weekdays", "days": ["sun", "mon", "tue", "wed", "thu"] }, "start": "2026-11-03",
                "source": { "by": "coach", "why": "About 6 h of sleep, waking at 6:45: lights out by 22:45 on work nights (Watson 2015).", "from": "intake" } } }
  ],
  "morning": { "on": true, "at": "07:00" },
  "bodyRecord": { "schedule": "plan" },
  "bringOver": { "on": "2026-11-03", "items": [] }
}
```

| Field | What | Values |
|---|---|---|
| `items[]` | What is tracked | `id` (lowercase, dashes), `kind` (`supplement`, `amount`, `tick`, `standup`, `sitting`, `desk`), `name`, `schedule` (`{kind: daily, training, rest, weekdays, every; days?, n?, from?}`), `start`, `source` (`{by: coach, why, from, on}` or `{by: user, on}`), and by kind: `when`, `whenDetail`, `reminder`, `dose`, `means`, `goal`, `amount`, `standup`, `sitting`, `desk`, `habit`, `note`; `pauses` and `earlier` (the settings until a change) are Pahlavan's history |
| `days` | Each day's record per item | `done` (supplements, ticks), `amount` (amounts), `minutes` and `count` (stand-ups, with `deskMinutes`: the part of `minutes` logged by Standing now at the desk, written by Pahlavan only; `minutes` and `count` hold both kinds of stand), `count` (desk breaks), `at` (the last change) |
| `suggestions[]` | The coach's suggestions | `{id, item, on, state: open, accepted or dismissed, decided}`: open ones are Pahlavan's chips; dismissed ones stay so they are not proposed again |
| `morning` | The morning check-in's card | `{on, at: "HH:MM"}` |
| `bodyRecord` | When the tape, photos and tests are due | `{schedule: "plan"}`, or `"fixed"` with `tapeFrom`, `tapeEvery`, `testsFrom`, `testsEvery` |
| `bringOver` | The one-time bring-over from the Habit Nudges plugin (a vault that has it) | `{on, items}`; `items: []` for a fresh start (the offer never shows) |

**A desk-break item** holds `desk: {followPlan, every, from, to, minutes,
steps?}`. With `followPlan` its routine, times and days come from the plan:
`plan-data.json`'s `deskRoutine` (the steps) on its `deskTiming`, `{every,
from, to, minutes?, days?}`: a break every `every` minutes (a whole number)
from `from`, each starting only while it ends by `to` (`HH:MM`), about
`minutes` each (5 when left out), on `days` (weekdays when left out). Every
90 minutes from 10:00 to 17:00 gives 10:00, 11:30, 13:00, 14:30 and 16:00.
Without `deskTiming`, the default timing: every 90 minutes, 10:00 to
15:00, weekdays. A bad `every`, `from` or `to` (or no break fitting between
them) is a `plan-data` warning and those usual times; a bad `minutes` or
`days` keeps that one's default. An item without `followPlan` keeps its own
times. The plan job sets `deskTiming` (`planning.md`, "Mapping onto
`plan-data.json`").

Once it holds at least one item, Pahlavan counts as set up (a vault's
Habit Nudges plugin then hands its health and fitness reminders over:
`tracking.md`, "The hand-over"). Beside it,
Pahlavan keeps `nudges.json` (which cards were answered, shared by both
Macs) and `sitting.json` (sitting stretches per day and Mac): Pahlavan's
own, read by `engine due` and `engine habits`, never written by the coach.
`help.json` is Pahlavan's too, and no engine command reads it: the tips
seen, the welcome card, and the screens' memory, shared by both Macs:
`glance` (At a glance per tab: the visits counted and the user's own open
or fold), `folds` (each section's fold, by tab and section id) and
`foodChecks` (the Food tab's light checks: the slots tapped per day, by
check id).

## The body record file (for `engine body`)

One date's measurements for `body-data.json`, written by `engine.cjs body
--file <record.json>` (a dry run, then `--write` after the user's yes;
`numbers.md`, "The write path: `body`"). The coach writes the body log only
this way, never by hand; the daily check-ins, the tape days and the test
days stay with Pahlavan's cards. Give only what was measured; leave the rest
out.

```json
{
  "date": "2026-11-02",
  "morning": { "weight": 83.5 },
  "tape": { "waist": 92 },
  "tests": { "pushups": 14, "pullups": 0, "hollowS": 28, "wallGapCm": 4 }
}
```

| Part | Fields (as `body-data.json` holds them) |
|---|---|
| `date` | The day it was measured, `YYYY-MM-DD`, not after today (required) |
| `morning` | `weight` (kg, one decimal), `sleepH`, `sleepQ`, `energy`, `soreness` (1 to 5), `rhr` (bpm), `steps`, `floors` (filed on the day before) |
| `tape` | `waist`, `hips`, `chest`, `arm` (cm; waist at the navel, relaxed) |
| `tests` | `pushups`, `pullups` (reps), `pullupLevel` (text, when 0 pull-ups: "negatives 3x3"), `hollowS`, `sidePlankS`, `handstandS` (seconds), `wallGapCm` (cm), `pistol` (text: "box 3") |

Convert to the file's units first (lb to kg, inches to cm). `null` clears a
field (a conflict when it holds a value, so `--replace` is needed).

## `Decisions.md`

The decision log, newest first. One entry per plan change, written once the
user says yes. A declined proposal gets a two-line entry (status declined, why)
so it isn't proposed again without new data.

```markdown
---
type: decision-log
tags: [fitness, coach]
---

# Decisions

## 2026-11-22 · Week resized to 4 sessions
- **Status:** accepted · **review:** 2026-12-20 · **outcome:** (filled at review)
- **Trigger:** weekly check-in, 4-week adherence.
- **Data:** 14/16 lifting and 3/12 short sessions over weeks 5–8 (numbers.md adherence, 2026-11-22); the user confirmed no unlogged short sessions.
- **Rule:** week sized to confirmed sessions + 1 within stated availability (planning.md, heuristic).
- **Change:** `weekTarget` lift 4, short 3 → lift 4, short 0; S1–S3 move to optional.
- **Expected effect:** ≥ 90% of planned sessions done over mesocycle 3.
- **Review:** 2026-12-20 (mesocycle 3 review): keep if ≥ 90%, else resize again.

## 2026-11-15 · Early light week declined
- **Status:** declined · readiness low 3 days, but the user felt fine and the e1RMs held.
```

The `**review:**` field and the `**Review:**` line start with the ISO date
(words may follow in brackets: `2026-11-29 (the first light week's
Sunday)`), never a date in words: the check-in finds the due entries by it.
`none` for an entry with nothing to review.

At review, replace "(filled at review)" with the result: `kept (93% done)`,
`adjusted (…)`, or `reverted (…)`, plus a dated line under it.

## `Letters/<YYYY-MM-DD>.md`

One file per check-in date (the Sunday of the week reviewed). A mesocycle or
phase review that falls that week **is** that week's letter.

```markdown
---
type: coach-letter       # coach-letter | mesocycle-review | phase-review
date: 2026-11-08
planWeek: 6
phase: 1 · Foundation
mesocycle: 2
readiness: normal        # smoothed band on the last scored day (numbers.md); `building` while the baseline builds
focus: lights out 22:45 on 5 nights
tags: [fitness, coach]
---

# Week 6 letter

| Sessions | Lifts | Weight trend | Sleep | Steps | Readiness |
|---|---|---|---|---|---|
| 4/4 lifting, 1/3 short | bench 50 → 55 lb; squat held | −0.14 kg/wk (−0.17%) | 5.9 h | 7,100 | normal |

The Weight trend cell gives the rate once `weight.rate` has one (14 days of weigh-ins); before that, the trend and "no rate yet" (`83.4 kg, no rate yet`), and Readiness reads "building, n of 14".

Sources: review 2026-11-08; numbers.md (adherence, weight slope, readiness, e1RM).

## What happened
Three to five lines: the week, lifts, skills, body; numbers with sources, the user's notes and the week's context.

## Next week's targets
| Lift | Target (review, coming week) |
|---|---|
| Flat DB Bench Press | 55 lb × 6 |

Ladders: pull-up stays at level 6; push-up due a move to level 4.

## What changes and why
1. **Bench to 55 lb.** Every set reached 8 at about 2 in reserve (top set, check-in) → double progression. [[…/Decisions#…|decision]]
2. *Declined:* an early light week (you felt fine; the e1RMs held).

## This week's focus
One concrete, checkable behaviour.

## One question for you
One question; next week's check-in asks for the answer.
```

**Mesocycle review** adds, above "What happened": `## Mesocycle <n> in numbers`
(adherence, e1RM per lift over 4 weeks, sets per muscle planned vs done, weight
and waist, readiness spread), `## Per-muscle volume` (muscle, feedback, change),
`## RIR calibration` (the set, the bias), `## Next month` (the proposal as
accepted), and a link to the `progress` job's report in `Progress Reports/`.

**Phase review** adds: `## Tests` (table: test, start of phase, now),
`## Predicted vs actual` (target, predicted, actual, verdict, why),
`## Retro` (keep, change, try; the pre-mortem's failure modes, which happened),
`## Experiments` (closed ones), `## Next phase` (the proposal as accepted).

## `Eating plan.md`

One file, edited in place (the `diet` job, `diet.md`). Every change adds a
History line and a Decision.

```markdown
---
type: eating-plan
updated: 2026-11-01
level: light             # light | standard | full
screened: 2026-11-01     # eating history and medical-diet questions
counting: allowed        # allowed | none (any eating-history answer but No)
review: 2026-11-22       # next adjustment check, 2-3 weeks out
tags: [fitness, coach]
---

# Eating plan

## Screening
- **2026-11-01:** eating history: no. Clinician diet or condition: none; a borderline cholesterol result, nothing prescribed: the general pattern, and the number stays with the clinician. Alcohol: none.

## Targets (numbers.md, 2026-11-01, trend weight 83.5 kg)
| What | Target |
|---|---|
| Protein | 134–184 g a day (`engine review` `weight.protein`: lifting goals, 1.6–2.2 g/kg); about 35–45 g a meal; a shake on short days |
| Portions per meal | 2 palms protein, 2 fists vegetables, 1–2 cupped hands carbs, 2 thumbs fats |
| Fiber | 30+ g a day |
| Energy (Standard/Full only) | 2,420 kcal a day for −0.25% a week |

## Why this plan

**Title:** Build muscle, lose a little fat
**Lead:** Eat about what you burn, keep protein high and let your hands set the portions.

1. **Eat about what you burn, protein high.** Lifting 4 days a week builds the muscle and protein feeds it: 134 g or more a day.
   *From your intake:* your goal is to build muscle and lose a little fat.
2. **Hands, not numbers.** A palm of protein, a fist of vegetables, a cupped hand of carbs, a thumb of fat.
   *You said:* following a diet exactly is hard.

## Meals
- **Prep (every other day, about 1 h):** …
- **Breakfast:** …  **Lunch:** …  **Dinner:** …  **Top-up:** …

## Meal ideas
One idea a day per meal in Pahlavan's Food tab ("Another idea" shows the rest).

### Lunch (12:30, the hardest meal)

**Hands:** 2 palms of protein (fish, chicken, lean lamb or beef), 2 fists of vegetables, 1 to 2 cupped hands of carbs, 2 thumbs of fat. About 45 g of protein.

| # | Idea | Counts for |
|---|---|---|
| 1 | Baked salmon, 2 palms, with a cupped hand or two of quinoa and roast broccoli | fish |

**If lunch is hard.** First choice: cook double at dinner and box half. Or one of these, in 5 minutes: …

## Tips

1. **Cook once, eat twice** (lunch). …

## Adjustment rule
Weight-trend slope against the goal's band; out of band two weekly readings → one step (one portion a day, or 100–200 kcal), then wait 2–3 weeks.

## Daily signal
Pahlavan's Protein item (`Coach/tracking.json`, linked to the Protein habit), ticked on days the target was reached; the Sunday check-in counts them.

## History
- 2026-11-01: created, Light level.
```

Why this plan, Meal ideas and Tips say in words what the twin below holds
as data: the title, lead and reasons are `goalLabel`, `summary` and `why`
(each reason's source line in italics); each meal's heading carries its
time (`at`) and tag, its Hands line the `foods` and `portions`, its ideas
table the `ideas` with what each counts for (`counts`), a lifting-day line
its `trainingNote`; "If lunch is hard" is `fallbacks`; the tips are `tips`,
each with what it helps in brackets.

## `eating-plan.json` (the eating plan, for the engine and Pahlavan's Food tab)

The machine-readable twin of `Eating plan.md`: its numbers, meals, hand
portions, fallbacks, pattern and adjustment rule, schema v1, and since
Pahlavan 0.7.0 the Food tab's words: the goal and approach, why this plan,
the user's day, each meal's time, foods and ideas, the light checks and the
tips. Pahlavan's Food tab draws it and `engine food` reads it (`numbers.md`,
"The eating plan").
The diet job writes it **only through `engine.cjs eating`** (`diet.md`,
"The plan as data": a dry run, then `--write` after the user's yes), in the
same run as the Markdown; never by hand. The words are the plan's own; the
protein numbers come from `engine review`'s `weight.protein`.

```json
{
  "schemaVersion": 1,
  "updated": "2026-11-02",
  "source": "Fitness/Coach/Eating plan.md",
  "level": "light",
  "screened": "2026-11-02",
  "counting": "allowed",
  "goal": "recomposition",
  "goalLabel": "Build muscle, lose a little fat",
  "summary": "Eat about what you burn, keep protein high and let your hands set the portions.",
  "why": [
    { "id": "maintenance", "icon": "target", "title": "Eat about what you burn, protein high",
      "text": "Lifting 4 days a week builds the muscle and protein feeds it: 134 g or more a day.",
      "source": { "kind": "intake", "field": "goal", "text": "your goal is to build muscle and lose a little fat" } },
    { "id": "heart", "icon": "heart", "title": "Heart-healthy foods",
      "text": "Fish twice a week, legumes 3 times, lean red meat at most twice, olive or canola oil over butter.",
      "source": { "kind": "said", "field": "health", "text": "your cholesterol is borderline", "aside": "The numbers stay with your doctor." } }
  ],
  "review": "2026-11-29",
  "basis": { "trendKg": 83.5, "date": "2026-11-02", "weighIns": 1 },
  "protein": { "floorG": 134, "rangeG": [134, 184], "gPerKg": [1.6, 2.2], "perMealG": [33, 46], "item": "protein", "tickAt": "21:00" },
  "fiber": { "g": 36, "per1000kcal": 14, "how": ["vegetables at 2 meals", "fruit twice a day", "legumes 3 times a week", "whole grains"] },
  "energy": { "maintenanceKcal": 2800 },
  "habits": { "meals": 3, "snacks": true, "cooking": "daily", "avoid": ["pork", "alcohol"] },
  "day": {
    "wake": "07:00", "work": ["09:00", "17:00"], "bed": "23:30",
    "training": { "lift": { "at": "17:30", "minutes": 60 }, "short": { "at": "17:30", "minutes": 30 } },
    "drinks": { "waterL": 2, "milkGlasses": 2, "coffees": [2, 3], "lastCoffee": "17:00" }
  },
  "meals": [
    { "id": "breakfast", "name": "Breakfast", "at": "07:30", "tag": "As now", "text": "Overnight oats with whey, made with milk or with a big spoon of Greek yogurt.", "proteinG": [40, 40],
      "ideas": [{ "text": "Oats, whey and milk with a grated apple, cinnamon and a few walnuts", "counts": ["fruit"] }] },
    { "id": "lunch", "name": "Lunch", "at": "12:30", "tag": "The hardest meal", "text": "Fish, chicken, lean lamb or beef, 2 palms, with vegetables, a cupped hand or two of rice, bread or potatoes, and olive oil, nuts or avocado.", "proteinG": [45, 45], "portions": "lunch",
      "foods": { "protein": "fish, chicken, lean lamb or beef", "veg": "salad or cooked", "carbs": "rice, bread or potatoes", "fat": "olive oil, nuts or avocado" },
      "ideas": [
        { "text": "Baked salmon, 2 palms, with a cupped hand or two of quinoa, roast broccoli and a few almonds", "counts": ["fish"] },
        { "text": "Lean lamb and chickpea stew with tomatoes and spinach, and a cupped hand or two of rice", "counts": ["red-meat", "legumes"] },
        { "text": "Grilled chicken, 2 palms, with brown rice and a big chopped salad in olive oil and lemon", "counts": [] }
      ] },
    { "id": "snack", "name": "Afternoon snack", "at": "16:00", "tag": "Top-up", "text": "Skyr or Greek yogurt, a glass of milk or a boiled egg or two, with fruit and a few nuts.", "proteinG": [10, 15],
      "trainingNote": { "lift": "A lifting day: have it 1 to 2 hours before you train." } }
  ],
  "portions": { "lunch": { "protein": [2, 2], "veg": [2, 2], "carbs": [1, 2], "fat": [2, 2] } },
  "groups": [
    { "id": "protein", "name": "Protein", "hand": "palm", "hands": ["palm", "palms"], "what": "Fish, chicken, lamb, eggs, lentils or chickpeas, cottage cheese" },
    { "id": "veg", "name": "Vegetables", "hand": "fist", "hands": ["fist", "fists"], "what": "Salad or cooked vegetables" },
    { "id": "carbs", "name": "Carbs", "hand": "cupped", "hands": ["cupped hand", "cupped hands"], "what": "Rice, bread or potatoes; whole grains for the fiber" },
    { "id": "fat", "name": "Fats", "hand": "thumb", "hands": ["thumb", "thumbs"], "what": "Olive oil, nuts or avocado" }
  ],
  "fallbacks": {
    "meal": "lunch",
    "first": { "name": "Cook double at dinner", "text": "Box half for the next day's lunch" },
    "quick": [{ "name": "A tuna or chickpea wrap", "text": "Tin, wrap, a handful of salad" }, { "name": "Skyr with fruit and nuts", "text": "No cooking at all" }],
    "minutes": 5
  },
  "today": { "optional": [{ "id": "fruit", "label": "Fruit twice", "slots": ["Once", "Twice"] }] },
  "tips": [
    { "id": "double", "icon": "history", "for": "lunch", "title": "Cook once, eat twice", "text": "Lunch is your hardest meal. Cook double at dinner and box half." },
    { "id": "loose", "icon": "fork", "for": "looseDay", "title": "Eating out, or a loose day", "text": "Pick the plate that looks most like your hands. Next meal, protein first and back to the template." }
  ],
  "pattern": [
    { "id": "fish", "name": "Fish", "target": "twice a week or more", "min": 2, "per": "week" },
    { "id": "legumes", "name": "Legumes", "target": "3 times a week", "min": 3, "per": "week" },
    { "id": "red-meat", "name": "Red meat", "target": "at most twice a week, lean lamb or beef", "max": 2, "per": "week" },
    { "id": "fruit", "name": "Fruit", "target": "twice a day", "min": 2, "per": "day" }
  ],
  "patternAlso": "Olive or canola oil over butter, nuts most days, little added sugar and salt.",
  "adjust": {
    "windowWeeks": 4,
    "flatCm": 0.5,
    "steps": [
      { "id": "less", "when": "Waist flat for 4 weeks and the trend not falling", "then": "One cupped hand of carbs less a day" },
      { "id": "back", "when": "Losing faster than 1 % of body weight a week", "then": "One cupped hand back", "pctPerWeek": -0.01 }
    ],
    "waitWeeks": [2, 3],
    "creatineKg": [1, 2],
    "looseDay": "Protein first at the next meal and back to the template; never skip a meal to make up for it."
  },
  "history": [{ "date": "2026-11-02", "note": "Created, Light level, from the user's day after the fresh intake." }]
}
```

| Field | What | Values |
|---|---|---|
| `schemaVersion`, `updated` | The schema and the plan's date (Eating plan.md's `updated`) | `1`; the day of the last change, not after today |
| `source` | The Markdown it mirrors | its path in the vault |
| `level` | How much the user counts (section 2 of `diet.md`) | `light`, `standard` or `full`; Pahlavan names Light "Hand portions" |
| `screened`, `counting` | The screen's date and outcome (Eating plan.md's frontmatter) | a date; `allowed` or `none` (any eating-history answer but No) |
| `goal` | The goal the plan serves: it sets the direction the Food tab and the rule read | a profile goal kind (`recomposition`, `fat-loss`, `gain`, `maintenance`, ...) |
| `review` | The next review: the adjustment rule's first check | a date, not before `updated` |
| `basis` | The trend weight the grams were set from | `{trendKg, date, weighIns}` (`engine review`'s trend; date not after `updated`) |
| `protein` | The day's protein | `floorG` (the Protein item is ticked at it; inside `rangeG`, and equal to the tracked item's goal), `rangeG` and `gPerKg` (`[lo, hi]`), `perMealG`, `item` (the tracked Protein item's id), `tickAt` (its card's time), `reason` (optional: `engine review`'s `weight.protein` reason as it was) |
| `fiber` | Fiber a day | `{g, per1000kcal?, how?}` (`how`: the plate's sources, in words) |
| `energy` | The coach's reference | `{maintenanceKcal, targetKcal?: [lo, hi]}`; shown only at the Standard and Full levels |
| `habits` | How the user eats | `{meals, snacks?, cooking?, avoid?}` |
| `goalLabel`, `summary` | The goal in plain words (the title of the Food tab's plan) and the approach in a sentence or two | text; without them the tab says the goal kind in words and a line from the level |
| `why[]` | Why this plan: three or so reasons | `{id, title, text, icon?, source?: {kind, text, field?, aside?}}`: `kind` `intake` ("From your intake") or `said` ("You said"), `text` the user's fact in your words, `field` what it came from (`goal`, `health`), `aside` a line under it; `icon` one of the tab's (`target`, `palm`, `heart`, `fish`, `box`, `fork`, `history`, `flame`, `clock`, ...); ids unique |
| `day` | The user's day, for the tab's timeline | `{wake?, work?: [from, to], bed?, training?: {lift?, short?}, drinks?}`: times `HH:MM`, `work` in order; `training.lift` and `.short` each `{at, minutes?}` (the session's time on that kind of day; the plan's rotation gives the kind); `drinks` `{waterL?, milkGlasses?, coffees?: [lo, hi], lastCoffee?}` |
| `meals[]` | Each meal | `{id, name, tag?, text, proteinG: [lo, hi], portions?, tip?, at?, foods?, ideas?, trainingNote?}`: `text` always (lunch and dinner keep theirs beside `portions`); `proteinG` is a rough figure (a guide at the Light level, never a count); `portions` names its key in `portions`; `tip` a one-line tip under the meal; `at` when it is eaten (`HH:MM`); `foods` the foods for each hand of its portions, by group id (`{"protein": "fish, chicken, lean lamb or beef"}`); `ideas` `[{text, counts?: [pattern ids]}]`, the tab showing one a day from `updated` and the rest a click away; `trainingNote` `{lift?, short?}`, a line for a lifting or short day |
| `today.optional[]` | The light checks on the Food tab's Today | `{id, label, slots: [text]}`: `id` a pattern line's; at least one slot; never a score or a tracked item: the taps (kept in `help.json`) only pre-fill the Sunday check-in's line of the same id, met when they reached the line's `min` on 5 of the week's days |
| `tips[]` | The coach's tips, three or four | `{id, title, text, icon?, for?}`: `for` what it helps (a meal id, `pattern`, `looseDay`); ids unique |
| `portions` | Hand portions per meal | `{"<meal key>": {"<group id>": [lo, hi]}}`, whole hands (`[1, 2]`: 1 to 2) |
| `groups[]` | The plate guide's food groups | `{id, name, hand, hands, what?}`: `hand` `palm`, `fist`, `cupped` or `thumb`; `hands` its words `[one, many]` |
| `fallbacks` | For the meal the plan calls hardest | `{meal, first?: {name, text}, quick: [{name, text}], minutes?}` (`meal`: a meal id; the timeline marks that meal) |
| `pattern[]` | The weekly pattern, answered at the Sunday check-in | `{id, name, target, min?, max?, per}`: `target` in words, `min` or `max` (one is required) a count, `per` `week` or `day` |
| `patternAlso` | The rest of the pattern | in words |
| `adjust` | The adjustment rule (`diet.md`, section 4) | `windowWeeks` (weeks of tape the waist must be flat over), `flatCm` (flat: within this of where those weeks started; 0.5, the tape's half-centimetre step), `steps[]` (`{id: less \| back, when, then, pctPerWeek?}`; `back`'s `pctPerWeek` is the rate that sets it off, -0.01 by default), `waitWeeks` (`[lo, hi]`: the next check waits at least `lo` weeks after a step), `creatineKg`, `creatineFrom` (else the tracked creatine item's start), `creatineWeeks` (how long its water counts, 4 by default), `looseDay`, `applied[]` (`{date, step, note?}`: each step taken, oldest first) |
| `history[]`, `note` | Eating plan.md's History lines; a free note | `{date, note}` |

Keys starting with `_` are comments. The engine also checks: `review` not
before `updated`; `basis.date` and `screened` not after it; the floor
inside `rangeG`; unique meal, group and pattern ids; a meal's `portions`
names a key of `portions`; the keys inside `portions` are group ids;
`fallbacks.meal` is a meal id; a pattern line has `min` or `max` (not
`min` above `max`); `adjust.applied` in date order; a meal's `foods` keys
are group ids, an idea's `counts` and a light check's `id` are pattern
line ids; reason, check and tip ids are unique. `engine validate <file>`
says so before a write. The Food tab's words are all optional: a plan
without them stays valid, and the tab draws what it holds.

## `Experiments/<YYYY-MM-DD> <slug>.md`

N-of-1 tests. The decision rule is fixed before the first data point and never
changed after.

```markdown
---
type: experiment
status: running          # planned | running | done | abandoned
start: 2026-11-23
end: 2026-12-20
tags: [fitness, coach]
---

# Lunchtime vs evening sessions

- **Question:** do lunchtime sessions go better than evening ones for me?
- **Measure:** session rating (1–10) and the logged lifts' e1RM (numbers.md).
- **Design:** alternate weeks (A = lunch, B = evening), 4 weeks, ABAB; everything else unchanged.
- **Decision rule:** lunch wins if its mean rating is ≥ 1 point higher **and** no e1RM falls outside the ±4% noise band in its weeks; otherwise no difference, choose by convenience.
- **Data:**

| Week | Condition | Sessions | Mean rating | e1RM notes |
|---|---|---|---|---|

- **Result:** (at the end, against the rule) · **Decision:** [[…/Decisions#…|link]]
```
