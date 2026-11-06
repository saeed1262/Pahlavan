# Progress: photos and the dated check-in report

For new progress photos, "progress check", "check my progress", "fitness
check-in", or how training and body composition are trending over weeks. Also
run by the `review` job at each mesocycle and phase end (it reads this
report rather than redoing it).

Turn the current state of the Fitness folder into a dated, comparison-rich
check-in report at `<fitness>/Progress Reports/<YYYY-MM-DD> Check-In.md`.

The core promise: **every data source below is either reflected in the report
or explicitly named in its "Data gaps" section.** Nothing silently skipped.

## Step 1: resolve dates and photo sets

- Today via `date +%Y-%m-%d`, then the training-day rule (SKILL.md house
  rule 17); never assume from context.
- Photo sets: list `<fitness>/Progress Photos/`. The newest dated
  folder is the **current** set, the one before it the **previous** set, and
  the **baseline** is the first set dated on or after the current cycle's
  baseline note (the newest `Baseline - <date>.md` in `<fitness>/`,
  found with `ls`). Sets older than that belong to an earlier cycle
  (archived under `_archive/<YYYY-MM>/`): ignore them, and never use one as
  the previous set.
- A set can hold copies of older photos; the baseline note says so (cycle
  3's `2026-11-02` front, side and back are copies of the `2026-10-13`
  photos). Date a copied pose by when it was taken, not by its folder, for
  the interval rules (Gotchas, "Photos ≠ data at short intervals").
- Previous reports: list `<fitness>/Progress Reports/` (create the
  folder if missing). If a report for today already exists, this run **updates
  it in place** (propose the replacement), never a duplicate file.

## Step 2: rename raw photos first

If the current set still has camera names (`IMG_*.jpeg`), view each image and
rename to the pose convention before anything else: `front.jpeg`, `side.jpeg`,
`back.jpeg`, `posture-closeup.jpeg` (match the poses of the previous set:
full front, side profile, back view, closer front/torso). Movement photos
from an intake or phase review are named `move-squat-side.jpeg`,
`move-squat-front.jpeg`, `move-overhead-side.jpeg`, `move-hinge-side.jpeg`
(`intake.md`, the body assessment). They're compared only with the previous
`move-*` set, at phase reviews, never in the pose-by-pose grid or the photo
index.

## Step 3: gather every data source

Read all of these. This checklist is the report's completeness contract:

1. **`<fitness>/body-data.json`**: the body log the morning
   check-in pop-up writes. `days` (per date: `weight` kg, `sleepH`,
   `rhr` resting HR, `steps` and `floors` for that whole day, and `energy` / `soreness` /
   `sleepQ` 1–5), `tape` (waist, hips, chest, arm in cm), `tests` (the
   calisthenics and posture tests, incl. `wallGapCm`) and `photos`. When each
   is due comes from `engine tracked`'s `bodyRecord` (Step 5), never a fixed
   cadence. Report weight as the **7-day trend** (daily weigh-ins are noisy)
   with its weekly rate against `engine review`'s weight band (`weight.rate`
   and `weight.band`, the profile goal's band, `rules.md`), and 7-day
   averages for sleep, resting HR, steps and floors. Other records the
   vault keeps by hand (a blood-work table) are in `Coach/local.md`.
2. **`<fitness>/fitness-log-data.json`**: the `sessions` array. Read
   EVERY field, not just the lifts: `date`, `type`, `lift1`/`lift2` (name /
   weight / reps), `cardioMin` + `cardioMode` (score against the plan's
   finisher minimum), `durationMin`, `rating`, `checklist` (which warm-up
   items were **skipped**; flag any skipped rotator-cuff item on a pressing
   day), `postureDrill`, and `notes` (they change comparability: a lift done
   with DBs instead of barbell isn't the same lift). Also check
   `todayChecklist` for an in-progress session. Flag half-logged sessions
   (no rating, or no cardio minutes on a day with a finisher). A missing
   `checklist` is not a gap: sessions logged before Pahlavan's Log panel
   (or the engine's `log add`) froze one don't carry it.
   Compute per-lift progression from the
   first *comparable* session (`numbers.md`, e1RM, flags likely kg/lb
   mix-ups).
3. **The habit check-ins** (`habits-data.json`; `engine.cjs folders`'s `paths.habits`): checkins for workout, protein, creatine,
   water over the window since the previous check. Key format is
   `hab-<id>-<YYYY>-W<ISO week>-<day index, 0 = Monday>`, week **not**
   zero-padded. **Print one live key and confirm the format matches before
   computing**; it has drifted before. Compare water against its `max`
   (target) from the habit definition, not a remembered number.
4. **Photos**: view all poses of current, previous, AND baseline sets.
5. **The current phase plan** (the newest `Month <N> Plan.md`): session
   cadence target and phase intent, and **`6-Month Roadmap.md`**: the
   current phase's targets (waist, steps) to score against.
6. **The current baseline note** (newest `Baseline - <date>.md`, found with
   `ls`): starting numbers and the coach's-read flags (posture etc.) to
   re-assess each time.
7. **The previous check-in report**, if any: its "Advice" items get a
   followed-up-or-not line in the new report.
8. **`<fitness>/Coach/`**, when it exists: active `Ledger.md` entries
   (they lead the Fix list), the latest letter's focus, and `Eating plan.md`'s
   level and targets.

## Step 4: ask for fresh measurements if missing

If `body-data.json` has no weight within ±2 days of today, or `engine
tracked`'s `bodyRecord` shows a tape, photo or test day due and not done,
ask for the numbers before writing (morning, waist at the navel, same
conditions as baseline). If provided, write them through the engine, never
by hand: a record file (`formats.md`, "The body record file", with the date
they were measured), `engine.cjs body --vault . --json --file <record.json>`
as a dry run, then the same with `--write` after the user's yes. That's the
only data file this job edits besides the report. If declined, proceed, and
list what's missing under Data gaps.

## Step 5: analyze

- **Measurements**: baseline → previous → now, with deltas. Interpret the
  *pattern* (flat weight + shrinking waist = recomp signal; note that
  starting creatine masks fat loss on the scale).
- **Lifts**: per-lift table with progression and honest framing (early jumps
  are partly calibration).
- **Consistency**: sessions/week vs the plan's target; protein/creatine/water
  adherence with actual counts, not vibes.
- **Photos, pose by pose**: compare current against previous AND baseline.
  Be honest about noise: sub-2-week visual change is mostly lighting and
  residual pump (check whether a session was logged the day before the
  photos). Re-assess the baseline posture flags. Note photo-quality issues
  that hurt comparability (lighting, framing drift, eyes-down side shots).
- **Due items**: the tape, photos and tests from `engine tracked`'s
  `bodyRecord` (each part's `due`, `last` and `nextDate`, on the plan's
  calendar), never a fixed cadence; phase-target checkpoints from the
  roadmap.

All numbers through code (`numbers.md` or a snippet run in the shell).

## Step 6: write the report

**The canonical layout example is the previous report in
`Progress Reports/` (first one: `2026-07-21 Check-In.md`); match its depth
and structure.** This is a full standing record meant to be re-read months
later, not a summary. Frontmatter: `tags: [fitness, check-in]`,
`cssclasses: [fitness-tracker]`, `date:`. Required sections, in order:

1. **TL;DR**: `> [!tip]` callout: trend verdict, standout, main gaps.
2. **Measurements**: table: baseline / previous / now / deltas, plus an
   interpretation paragraph (pattern, not numbers restated; note
   confounders like a creatine start; compare against phase targets).
3. **Session log**: one row per session since previous check: date, type,
   both lifts, cardio min+mode, duration, rating, warm-up done/skipped,
   posture drill. Follow with bullet observations (rotation adherence,
   low-rated sessions, half-logged sessions, in-progress session).
4. **Lifts**: per-lift table: first *comparable* → now, with trend notes;
   distinguish calibration jumps from real strength expression.
5. **Daily habit grid**: one row per day: workout, protein, creatine,
   water (mL), other supplement habits. Mark pre-tracking days `·`. Follow
   with adherence bullets (counts and averages vs targets, not vibes).
6. **Phase scorecard**: one row per current-phase target from the roadmap
   with status and a 🟢/🟡/🔴/⚪ verdict.
7. **Photos**: comparison grid (rows = sets, cols = poses; escape embed
   pipes: `![[…\|220]]`), then a pose-by-pose table (baseline read / now /
   verdict), then a **posture re-assessment** against each baseline
   coach's-read flag.
8. **Coach's read**: `> [!success] Keep doing`, `> [!warning] Fix` (in
   priority order, injury-risk items first), `> [!info] Watch`.
9. **Projection to next check**: realistic ranges for measurements and
   lifts, plus the process wins to aim for.
10. **Data gaps & due items**: checklist with due dates; include filled
    items as `- [x]` for the record. End with the **next check date** (the
    first `nextDate` in `engine tracked`'s `bodyRecord`: the tape, photos or
    tests) and the reminder to run `/fitness-coach progress`.

Completion criterion: every Step 3 source appears in the report body or in
Data gaps, every section above is present, and every table cell is filled
or explicitly marked with the placeholder dash the earlier reports use (the
em-dash character, U+2014).

## Step 7: confirm

One short message: link to the report, the headline verdict, and the next
check date. Don't re-paste the report content.

## Gotchas

- **Never edit** the baseline note, the phase plans, or the roadmap in this
  job: they're its fixed yardsticks (the `plan` job changes them, after a
  yes). Only the report and (Step 4, through `engine body`) the
  measurements in `body-data.json` are written.
- **Don't invent numbers.** No estimated body-fat %, no guessed measurements;
  a photo cannot produce a number.
- **Photos ≠ data at short intervals.** Under about 4 weeks, lead with
  measured numbers and treat photo differences as hints; say so in the report.
- **Habit keys**: verify the live key format before counting (Step 3.3);
  a habit's id may itself start with `hab-` (keys then read `hab-hab-…`).
- **Idempotent**: re-running on the same day updates today's report, never
  creates a second one.
