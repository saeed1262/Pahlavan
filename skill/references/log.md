# Log: a session, a ladder level, a fix

Logging from what the user says ("did A today, squat 65×5, bench 30×8") or a
pasted workout sheet. Pahlavan's Log screen and its reminder cards ("Did you
train today?") stay the way to do it by hand; writes here go through the
engine's `log` commands, which write exactly what Pahlavan's Log screen
writes. Each is a dry run until `--write`.

```bash
node .claude/skills/fitness-coach/scripts/engine.cjs log add --vault . --json --file <session.json> [--no-habit] [--write]   # one session, the dialog's shape; ticks the Workout habit
node .claude/skills/fitness-coach/scripts/engine.cjs log ladder --vault . --json --id <ladder> --level N --date D [--write]   # a ladder level
node .claude/skills/fitness-coach/scripts/engine.cjs log fix --vault . --json --date D --type T [--label L] --lift lift1|lift2 [--weight W] [--reps R] [--clear-planned] [--write]   # correct a logged top set, or drop an adopted swap's "planned"
```

Rules for this job:

- **Propose, then write.** Show the session first and write it after the
  user's yes. One question for a run, not one per session.
- **The session's date** is the training day (SKILL.md house rule 17):
  between 00:00 and about 04:00, the previous day unless the user says
  otherwise. Say it in the one-line proposal, and pass it to every write.
- **Don't invent sets, reps or weights.** If the user's message doesn't say
  it, ask, or leave the field as the dialog would (0 / null).
- **Never edit `fitness-log-data.json` by hand**; `add`, `ladder` and `fix`
  are the only writers here.
- Units: see SKILL.md, "The data".

## A session

The sources: the user's words, or a pasted workout sheet (its title gives
the session, the heaviest set of each logged lift is its top set; the
cardio minutes, rating and notes map across; "Express" sets `express:
true`; `Coach/local.md` may describe the vault's own sheet).

1. Work out the session type and its two **logged** lifts from `plan-data.json`
   (`logged: true` items of that session). A lift done instead of the planned
   one: `{"name": "<done>", "planned": "<plan's>", "swapWhy": "<reason>"}`,
   where the reason is why the user swapped it, when they say: `mine` (their
   own choice), `ledger` (a Ledger limit), `soreness` or `hotel` (the Hotel
   version). Leave `swapWhy` out when it isn't known; anything else is
   refused.
2. Write `<scratchpad>/session.json` with only what's known: `date` (the
   session's date, above), `type`
   (`custom` + `label` for anything off-plan), `lift1`/`lift2` as `{name,
   weight, reps, unit}` for lifting days, and any of `express`, `durationMin`,
   `cardioMin`, `cardioMode`, `rating`, `postureDrill`, `notes`, `skipped`
   (the plan's line names the user didn't do, as Pahlavan's Today names them;
   a pair is "A + B"), `skipWhy` (why a skipped line was skipped, when the
   user says: `{"<the line, as in skipped>": "time" | "pain" | "equipment" |
   "energy"}`; any other reason, or a line not in `skipped`, is refused),
   `swaps` (another item done in place of one that
   isn't a logged lift:
   `[{"from": "<plan's>", "to": "<done>", "why": "<reason>"}]`, `why` as
   `swapWhy` above, left out when not known) and `pain` (a pain or niggle
   the user reports with the session:
   `[{"area": "Knee", "severity": 4, "exercise": "<the movement>"}]`,
   `severity` 0 to 10, left out when the user doesn't say how bad: never a
   number they didn't give). `unit` is the one the user says ("60 lb", "40
   kg"); when they don't say, leave it out and `log add` uses the lift's
   unit in the plan.
   - **Every set** (the user gives each set, or a sheet lists them):
     `"trackingLevel": "full"` with `"exerciseSets": [{"name", "sets":
     [{"weight", "unit", "reps", "rir"}]}]`, one item per exercise done (each
     part of a pair is its own item). Only the sets done: never pad to the
     plan's count. `weight` is left out for a bodyweight or timed set (reps
     are then seconds), `rir` when the user doesn't say it. A swap names the
     plan's item as `"planned"`. `lift1`/`lift2` still carry each logged
     lift's heaviest set, and a logged lift with a top set needs its sets in
     `exerciseSets`. The weight goes up only when every set the day called
     for (a trimmed day's or Express's count) reached the top of the range,
     so fewer sets hold it.
3. `log add --file <file>` (a dry run), show the user the session in one
   line with its date ("A on Mon 2026-11-02: ..."), then run it again with
   `--write` on their yes. The output's `session` is the entry; `habit`
   says whether the day's Workout habit was ticked.
   - **Exit 1**: the input is wrong (a lift that isn't the session's, a
     custom without a label, a skipped line the plan doesn't have, an
     `exerciseSets` name that isn't the session's item, reps that aren't a
     whole number, an RIR over 10…); the error says what. Nothing was
     written.
   - `"result": "already"`: that date and type are logged; offer to edit it in
     Pahlavan instead.
4. A ladder level that moved in the session (the plan's rule: the top of the
   reps on every set, two sessions in a row): `log ladder --id <id> --level
   <n> --date <the session's date>`.

Pahlavan re-reads the log when the file changes, so a session added here
shows there even if it was already open. `log add` freezes the session's
`exercises` list and its `checklist` (done, total, skipped, and `why` from
`skipWhy`) as Pahlavan's Save
does, so a later plan change doesn't rewrite what this session planned; a
custom session has no checklist. Each strength item also keeps the day's
working sets (`daySets`: one fewer on a readiness or soreness trim,
Express's own), from the engine's session for that date and version. A session dated today also ticks Today's
circles (every line but the skipped ones), as Pahlavan's Save does.

Coach checks while logging (say them in the same one-line confirmation, don't
block the log):

- A logged lift that an active `Coach/Ledger.md` entry rules out (for
  example a high-IAP lift during an abdominal-wall window): note it, ask how
  it felt, add a line to that Ledger entry.
- Pain the user reports: into `pain` (above), then the pain rule
  (`adhoc.md`) and a Ledger entry. The engine reads pain from `pain` only,
  never from the notes.
- A value that looks like a typo or the other unit (65 reps of RDL; 70 when
  the last top set was 30): ask before writing.

## A ladder level

`log ladder --id <id> --level <n> --date YYYY-MM-DD [--write]`. The ids are
`plan-data.json`'s `ladders` (`id`), the level numbers their `levels` in
order (Pahlavan's Progress, Skills shows them). It answers `already` when
that level is already the ladder's latest. Always pass `--date` (the
training day): without it the engine uses the calendar day.

## A corrected top set, or an adopted swap

`log fix --date D --type T [--label L] --lift lift1|lift2 [--weight W]
[--reps R] [--clear-planned] [--write]`, once the user gives the real value. It changes weight and reps only (not the unit): a top set
logged in the wrong unit is fixed by giving the weight in the lift's unit.
Pahlavan picks up an edit made here even if it was open.

- **`--clear-planned`** removes the lift's `planned` field once the plan has
  adopted that swap (a lift logged as `{"name": "<done>", "planned":
  "<plan's>"}`, and `<done>` is now the plan's own lift), so the log no
  longer records it as a swap. It goes alone or with `--weight` and `--reps`.
  It refuses (exit 1, nothing written) when the lift has no `planned`, or
  when its name isn't the session's logged lift in `plan-data.json` (`lift1`
  the session's first `logged: true` item, `lift2` the second), the check
  `log add` makes.
- **The output:** `result` (`fixed`, or `already` when nothing changes),
  `date`, `type` (and `label` when given), `lift`, `changed` (the fields
  that changed), `before`, `after`, `dryRun`, `written`. The one-line confirmation
  names its `date`, `type` and `lift`.

## Elsewhere

- **`Coach/local.md`** may name another command that logs the day (a daily
  review); it uses this job's commands and session rules.
- **Pahlavan** stays the place to tick the checklist, edit or delete a
  session, and move a ladder by hand.
