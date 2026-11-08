# Plan files: how a plan change is written

The mechanics of every write to the plan, for the `plan` job (a designed plan,
an ad hoc change, the next month) and for changes accepted in `checkin` and
`review`. What the plan should be is decided in `planning.md`; this file is
only how it gets into the files. Swaps, a temporary change (an injury, a week
away), or the next month (its own recipe, below).

The plan lives in `plan-data.json` (in the fitness folder): Pahlavan's Plan
screen and Today read it. It is written only through `engine plan-write`,
after the plan check (step 3), never by hand. When `Coach/local.md` names
notes made from the plan and how to regenerate them, that runs after every
change below; such notes are never edited by hand.

## A change to the plan

1. Read `plan-data.json` and the part of `6-Month Roadmap.md` it touches.
2. Propose the change as a short list: which session, which item, what it
   becomes and why. The item's `note` ends with "Why: ..." (the reason in a
   line, `planning.md`); a changed item gets its reason updated too. A **new movement** also needs:
   - a `guide` entry (`setup`, `do`, `avoid`, `q`, and `muscles: {main,
     helps}` using the ids in `muscles`), or the Exercise Guide and the muscle
     map won't know it; for a catalogue movement, its `guide` in `engine
     catalogue` is a starting point for `setup`, `do` and `avoid`, in the
     plan's own words;
   - a `lifts` entry (`lo`, `hi`, `inc`, `db`, `progression`) if it's one of
     the session's `logged` lifts, so Pahlavan and the engine can suggest its
     next weight: `inc` a step that exists in its unit, `unit` only if that
     isn't `liftUnit`, and `progression` the lift's standing rule
     (`formats.md`, "The plan's standing rules"; without it, the default's
     double progression and a `legacy-default` warning).
   **A temporary change** carries `until YYYY-MM-DD: <why>` at the start of the
   item's `note`; the weekly check-in finds it when the date has passed and
   proposes the way back (`checkin.md`).
   **A swap made for the user's preference** (a tool, an exercise they like or
   don't) also goes into the Athlete profile's Standing plan rules, with its
   date and its Decision, and into `Coach/profile.json` `preferences`
   (`likes`, `dislikes`) when the engine's catalogue has an id for it
   (`formats.md`); then `engine.cjs validate <fitness>/Coach/profile.json
   --kind profile --json`. The next plan's design starts from them, so the
   old choice doesn't come back (nor in `engine plan`'s baseline, which
   reads `preferences`).
3. **Write it through the check.** The change goes into a draft: the
   whole `plan-data.json` with the change made (its keys in their order),
   saved as a scratch file outside the vault, never over the real file, with
   the plan's standing rules written or revised in the same draft (`rules`, a
   lift's `progression`; `formats.md`, "The plan's standing rules"). Then
   (`numbers.md`, "The plan check"):
   1. `check --plan <draft> --vault . --json`. A hard error (`level:
      "error"`: a movement the Ledger or the screen rules out, data Pahlavan
      can't read, a logged lift with no `lifts` entry) stops the write: fix
      the draft and check again. It screens on `--date` (default today): a
      draft for the weeks after a Ledger constraint ends takes `--date` in
      those weeks, here and in step 4. Each warning carries its rule, grade and
      reason: change the draft, or, when the plan goes outside the range on
      purpose, add an override with the reason to the draft (`overrides:
      [{code, item, reason, decision}]`, `formats.md`) and a Decisions entry.
      An override needs a reason and never clears a hard error.
   2. `review --plan <draft> --vault . --json`: the draft's numbers as
      Pahlavan will show them (sets per muscle, each session's minutes, the
      targets); every number the proposal quotes comes from this run.
   3. Show the user the change (step 2's list), the warnings and the
      overrides with their reasons, and the dry run's `diff` (`plan-write
      --file <draft> --vault . --json`): what changes, key by key.
   4. On the user's yes, `plan-write --file <draft> --vault . --json
      --write`: it checks the draft again (a hard error refuses it), writes
      the whole file and reads it back. Then `check --vault . --json` once
      more, on the plan as written: a hard error there stops the job until
      it's fixed (SKILL.md house rule 20). Then what `Coach/local.md` says
      runs after a plan change (if anything), and report the files written.
   A whole designed plan is the pick's draft (`planning.md`, step 1),
   written the same way: a fresh start's or a reset's with its new `start`
   (formats.md, "The plan's start"), every other change (a swap, the next
   month, a phase review's next block) keeping the `start` the file has
   (`check --plan` warns `start-changed` otherwise). On a vault with no
   `plan-data.json` yet (a first plan), every step here works on the draft:
   `check --plan`, `review --plan`, and `plan-write`, whose diff lists every
   key as added. A baseline from `engine plan --format plan-data
   --vault .` keeps plan-data's keys and their order, the plan's names and
   the "Why:" lines of unchanged items; fill what its `unexpressible` list
   asks for (guide text, `why lines`) before it is a draft. A ladder
   item is written as `"<Ladder> (your level)"` with its `ladder` id and is
   never one of the two logged lifts. Its ladder in `ladders` carries the
   level this plan starts it at as `"startLevel": N` (formats.md, "A
   ladder's starting level"; a baseline export writes it), so `check
   --plan` and `review --plan` count the item at that level before the log
   holds one; without it they count the lowest level and warn
   `ladder-start`. The starting level also goes into the log with `log
   ladder --id <id> --level <level> --date <D> --write` (`unexpressible`
   names the line under "ladder levels"), where the level history starts.
4. **The targets.** Every new or changed plan writes `targets` in
   `Coach/profile.json` (where Pahlavan's Progress and Plan screens read them;
   the fields in `formats.md`: `by`, `waistDropCm`, `weightDropKg`,
   `rhrDropBpm`, `stepsPerDay`, `sleepHours`, `tests`) together with the
   roadmap's Targets table, in the same yes, then validates the profile. A
   target the schema can't hold (the wall gap, cardio minutes) stays in the
   roadmap only.
5. A plan change gets its Decisions entry (`formats.md`).

## The next month

Each month is one mesocycle and ends on a light week (`rules.lightWeeks`;
with light weeks every 4th week, month N is plan weeks 4N−3 to 4N). Take its
dates from `engine review` when building it, never from an earlier note or
cycle: week 1's Monday is `week.planStart` (the Monday of the plan's
`start` when it has one), `engine review --date <a
Monday>` shows its `week.planWeek`, `week.mesocycle` and
`week.mesocycleWeeks` (the weeks to its light week), and `--date` on the
month's last Sunday shows the light week (`week.deload` true). Build it when the current month's last week is over
(the check-in says when, and the `review` job comes first). Propose the whole
month as one list; on the user's yes:

1. **The roadmap.** Read the phase the new weeks fall in (`6-Month Roadmap.md`:
   the Phases table and that phase's bullets) and the Check-ins rows that land
   in them. A month that starts a new phase (the one after every second
   light week: weeks 9 and 17 with light weeks every 4th week) carries the
   bigger changes.
2. **`plan-data.json`**, through steps 2–3 above:
   - `sessions`: the phase's set, rep and round changes (`sr`). A logged lift
     whose rep range changes needs its `lifts` `lo`/`hi` changed too, or the
     next-weight suggestions keep the old range.
   - `weekTarget` (`lift`, `short`): only if the roadmap changes the week's
     cadence (say, from 4 lifting and 3 short sessions to 3 and 2).
   - The light weeks are the plan's `rules.lightWeeks` (formats.md, "The
     plan's standing rules"; `review`'s `week.deload`): a light week moves,
     or its shape changes, by editing it in the draft. `deloadS3` is what S3
     becomes that week; change it only if the phase changes S3.
   - The standing rules the review revised (a lift's `progression`, the
     stall response, the light weeks) go into the same draft.
   - Temporary notes: settle the due ones first (the check-in's way back) and
     carry the rest with their `until` dates.
3. **Notes made from the plan** for a new month (a month note, a calendar):
   what `Coach/local.md` names, in its order.
4. **The roadmap's links,** when it links a month's notes: point them at the
   new month's (by hand, with approval).
5. **Archive what the month replaces** (an old month note) in the fitness
   folder's `_archive/<YYYY-MM of its first day>/`, with a `README.md`
   saying what's there and when it was archived (a README already there gets
   a line added). **Never overwrite a file in
   `_archive/`:** an earlier cycle's note of the same name may be there; if
   the name exists, stop and ask the user.

## A new roadmap (a designed plan or a reset)

1. Archive the current `6-Month Roadmap.md` in `_archive/<YYYY-MM>/` with the
   README (the month of its first day, never over an existing file: step 5
   above).
2. Write the new roadmap under the **same file name**: Pahlavan's Plan screen
   links it, and the check-in and the progress job read it by that name. Keep
   its section names (the Phases table, each phase's bullets with a `Steps:`
   number, Check-ins, Targets at week 24), since `checkin.md` and
   `progress.md` read them. Add the pre-mortem section.
3. The targets go in `Coach/profile.json` `targets` with the roadmap's
   Targets table (step 4 above).
4. Then what `Coach/local.md` names for a new month, if anything.
