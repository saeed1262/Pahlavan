# Plan files: how a plan change is written

The mechanics of every write to the plan, for the `plan` job (a designed plan,
an ad hoc change, the next month) and for changes accepted in `checkin` and
`review`. What the plan should be is decided in `planning.md`; this file is
only how it gets into the files. Swaps, a temporary change (an injury, a week
away), or the next month (its own recipe, below).

The plan lives in `plan-data.json` (in the fitness folder): Pahlavan's Plan
screen and Today read it. When `Coach/local.md` names notes made from the
plan and how to regenerate them, that runs after every change below; such
notes are never edited by hand.

## A change to the plan

1. Read `plan-data.json` and the part of `6-Month Roadmap.md` it touches.
2. Propose the change as a short list: which session, which item, what it
   becomes and why. The item's `note` ends with "Why: ..." (the reason in a
   line, `planning.md`); a changed item gets its reason updated too. A **new movement** also needs:
   - a `guide` entry (`setup`, `do`, `avoid`, `q`, and `muscles: {main,
     helps}` using the ids in `muscles`), or the Exercise Guide and the muscle
     map won't know it;
   - a `lifts` entry (`lo`, `hi`, `inc`, `db`) if it's one of the session's
     `logged` lifts, so Pahlavan and the engine can suggest its next weight:
     `inc` a step that exists in its unit, and `unit` only if that isn't
     `liftUnit`.
   **A temporary change** carries `until YYYY-MM-DD: <why>` at the start of the
   item's `note`; the weekly check-in finds it when the date has passed and
   proposes the way back (`checkin.md`).
   **A swap made for the user's preference** (a tool, an exercise they like or
   don't) also goes into the Athlete profile's Standing plan rules, with its
   date and its Decision, and into `Coach/profile.json` `preferences`
   (`likes`, `dislikes`) when the engine's catalogue has an id for it
   (`formats.md`); then `engine.cjs validate <fitness>/Coach/profile.json
   --kind profile --json`. Otherwise the next `engine plan` draft brings the
   old choice back.
3. On the user's yes, edit `plan-data.json` (keep its formatting and key
   order), then what `Coach/local.md` says runs after a plan change (if
   anything), and report the files written. A
   whole designed plan comes as an object from `engine plan --format
   plan-data --vault .` (`planning.md`): it keeps the keys and their order;
   write it after filling what its `unexpressible` list asks for. A ladder
   item is written as `"<Ladder> (your level)"` with its `ladder` id and is
   never one of the two logged lifts; its starting level goes into the log
   with `log ladder --id <id> --level <level> --date <D> --write` (`unexpressible`
   names the line under "ladder levels").
4. **The targets.** Every new or changed plan writes `targets` in
   `Coach/profile.json` (where Pahlavan's Progress and Plan screens read them;
   the fields in `formats.md`: `by`, `waistDropCm`, `weightDropKg`,
   `rhrDropBpm`, `stepsPerDay`, `sleepHours`, `tests`) together with the
   roadmap's Targets table, in the same yes, then validates the profile. A
   target the schema can't hold (the wall gap, cardio minutes) stays in the
   roadmap only.
5. A plan change gets its Decisions entry (`formats.md`).

## The next month

Each month covers four plan weeks and ends on a light week: month N is
plan weeks 4N−3 to 4N (Month 2 is weeks 5–8, Month 3 weeks 9–12). Take its
dates from `engine review` when building it, never from an earlier note or
cycle: week 1's Monday is `week.planStart`, so month N starts 4(N−1) weeks
later (worked out in the shell); `engine review --date <that Monday>` shows
`week.planWeek` 4N−3, and `--date` on the month's last Sunday shows the light
week (`week.deload` true). Build it when the current month's last week is over
(the check-in says when, and the `review` job comes first). Propose the whole
month as one list; on the user's yes:

1. **The roadmap.** Read the phase the new weeks fall in (`6-Month Roadmap.md`:
   the Phases table and that phase's bullets) and the Check-ins rows that land
   in them. Phases turn over at weeks 9 and 17, so Months 3 and 5 carry the
   bigger changes.
2. **`plan-data.json`**, through steps 2–3 above:
   - `sessions`: the phase's set, rep and round changes (`sr`). A logged lift
     whose rep range changes needs its `lifts` `lo`/`hi` changed too, or the
     next-weight suggestions keep the old range.
   - `weekTarget` (`lift`, `short`): only if the roadmap changes the week's
     cadence (it's 4 + 3 through week 24 in the current roadmap).
   - The light week is not a field: Pahlavan and `review` make every 4th
     plan week a light week (`week.deload`). `deloadS3` is
     what S3 becomes that week; change it only if the phase changes S3.
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
