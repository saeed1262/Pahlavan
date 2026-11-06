# Review: the mesocycle and phase reviews

The block reviews. Each one is that week's check-in (it runs the check-in's
numbers, questions and decision rules from `checkin.md` too) and is written as
that week's letter, with the extra sections in `formats.md`.

## Mesocycle review

The check-in that closes a deload week (plan weeks 4, 8, 12, …). What is due
that week (the tape, photos, and the tests at a phase's end) comes from
`engine tracked`'s `bodyRecord` (`--date` the light week's Sunday), never a
fixed cadence; the review then builds the month that starts the next day. At
plan weeks 8, 16 and 24 the phase review below replaces it.

1. **Numbers** (`engine review --date <the deload week's Sunday>`,
   `numbers.md`): 4-week adherence (`adherence`); e1RM per lift over the
   mesocycle (`lifts[].e1rm`, its points by date); sets per muscle planned vs
   done (`volume`, one `review` per week of the mesocycle for done); weight
   slope and waist (`weight.rate`, `weight.tape`); readiness distribution
   (share of watch and low days: `engine readiness --date` on the Sunday and
   14 days before it, together 28 days of `last14`); the mesocycle's check-in
   answers in `Coach/checkins.json` (recovery, effort, enjoyment, joint
   aches, week by week).
2. **Per-muscle feedback**, one AskUserQuestion per round of up to 4 muscle
   groups (priority muscles first): "Over these 4 weeks, <muscle> work felt:"
   - *Barely worked* (no pump, never sore) → +2 sets a week
   - *Worked, recovered in time* → hold, or +1 for a priority muscle under 16
   - *Still sore at the next session, or performance dropped* → −2 sets
   - *Joint ache* → swap the exercise (Ledger check), sets unchanged
   Within the caps: never under 4, never over 20–24, ≤ 8 direct sets in one
   session.
3. **RIR calibration:** ask for the calibration set's result (planned in the
   last loading week): predicted RIR, reps done past it (the actual RIR).
   Bias = actual − predicted (+2: the user stops 2 reps early), into the
   Athlete profile's RIR calibration table and `profile.json`'s
   `rirCalibration` (`formats.md`); the engine then corrects that exercise's
   reported or logged RIR by it.
4. **Progress report:** tape if it's due, then the `progress` job
   (`progress.md`: photos renamed, every source read, the dated report).
   Read that report's numbers and verdicts into the review; don't redo them.
5. **Decide:** volume per muscle, accessory rotation (main lifts stay in the
   phase, at most half the accessories change), rep-range changes, RIR targets
   corrected for bias.
6. **Write** the review as that week's letter (`type: mesocycle-review`),
   propose the next month as one list, and on yes build it through
   `plan-files.md` ("The next month"); Decisions for each change.

## Phase review

At the end of each phase (plan weeks 8, 16, 24), in place of that week's
mesocycle review (it includes steps 1–5 above).

1. **Tests:** the roadmap's tests (push-ups, pull-ups, hollow, side plank,
   handstand, wall test, pistol, resting HR) under test conditions (not after
   under 6 h of sleep), and the `progress` job's report.
   **Repeat the body assessment** (`intake.md`, same photo protocol, the
   `move-*` photos included): compare each observation with the last one,
   and update the profile's Body assessment and its emphasis.
2. **Predicted vs actual:** one row per target in the phase proposal or the
   roadmap: predicted, actual (`engine review` or the test), verdict (hit,
   within range, missed), and why.
3. **Retro:** keep / change / try, checked against the phase's pre-mortem:
   which failure modes happened, did the countermeasures work.
4. **Experiments:** close any that ended (result against the pre-set rule).
5. **Ledger, screening, eating plan:** update Ledger statuses; re-screen if
   12 months have passed or health changed; check the eating plan against the
   phase's goal (`diet.md`).
6. **Next phase** through the `plan` job (`planning.md`: `engine plan`, a new
   pre-mortem, the proposal, the write through `plan-files.md` with `--format
   plan-data`). Write the review as that week's letter (`type: phase-review`).

Week 24 ends the current roadmap's cycle: the next macrocycle needs a new
cycle start (`planning.md`, "Build the macrocycle"); plan it with the user.
