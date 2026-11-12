# Review: the mesocycle and phase reviews

The block reviews. Each one is that week's check-in (it runs the check-in's
numbers, questions and decision rules from `checkin.md` too) and is written as
that week's letter, with the extra sections in `formats.md`.

## Mesocycle review

The check-in that closes a light week (the plan's `rules.lightWeeks`;
plan weeks 4, 8, 12, … by default). What is due that week (the tape,
photos, and the tests at a phase's end) comes from `engine tracked`'s
`bodyRecord` (`--date` the light week's Sunday), never a fixed cadence; the
review then designs the block that starts the next day. At a phase's end
(every second light week) the phase review below replaces it.

0. **The plan check** (`check --vault . --json --date <the light week's
   Sunday>`), as every check-in starts (`checkin.md`): a hard error first;
   its warnings (region gaps, sets outside the tiers, a plan rule broken)
   are inputs to step 5.

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
   After the rounds, one question in plain text for step 5's verdicts
   (at a phase review, step A's item 5 asks it instead): which exercises do
   you want kept, and which gone (boring, awkward, painful, often skipped)?
3. **RIR calibration:** ask for the calibration set's result (planned in the
   last loading week): predicted RIR, reps done past it (the actual RIR).
   Bias = actual − predicted (+2: the user stops 2 reps early), into the
   Athlete profile's RIR calibration table and `profile.json`'s
   `rirCalibration` (`formats.md`); the engine then corrects that exercise's
   reported or logged RIR by it.
4. **Progress report:** tape if it's due, then the `progress` job
   (`progress.md`: photos renamed, every source read, the dated report).
   Read that report's numbers and verdicts into the review; don't redo them.
5. **Decide, coach-first:** the coach designs the next block from the
   roadmap's phase the new weeks fall in (its aim and targets:
   `plan-files.md`, "The next month", step 1), steps 1–4, the evidence
   (`evidence --topic volume`, `exercise-choice`, `regions`, ...) and the
   options (`catalogue`): volume per muscle, the exercises (below),
   rep-range changes, RIR targets corrected for bias, and the standing rules
   revised (each lift's progression, the stall response, the next light
   week).
   - **A verdict for each accessory, from the block's data**, one line each
     with its reason and its source: **keep** (still progressing, by the
     user's account or the log, a logged lift's `lastRise`; liked; its
     muscle's step 2 answer *worked, recovered in time*; the region it
     biases still a priority) or **change** (skipped or swapped often:
     `review`'s `exercises`, each exercise's skips with their reasons and
     swaps with theirs over the block, `last4`, its row's `note` to quote; a
     swap for the Hotel version or soreness says nothing against the
     movement, the user's own swap or the Ledger's may; a joint ache in step
     2, or pain on it in `review`'s `pain.byExercise`, rising or falling, or
     the check-ins' joint aches; boring or disliked, in step 2's question;
     its muscle *barely worked* where a better option fits). A swap's reason
     is recorded from 0.28.1: an older entry's is `unknown` and an older
     entry with no checklist is `unrecorded`, so a verdict that rests on
     those says so. How many change follows from the verdicts, not from a
     fixed share. Where the data says nothing either way, the defaults stand
     (`rules.md`, "Exercise changes", **Weak**): at most half the
     accessories change, and a region-biasing movement stays for the phase
     (planned variation, **Moderate**). A change past a default says why.
   - **Main lifts stay within the phase** unless the data says otherwise:
     pain on the lift (a pain report, a joint ache, a new Ledger entry), or
     a stall the triage ladder's earlier steps haven't fixed
     (`lifts[].stall`, and `lifts[].triage` with its `chosen` step at the
     variation; under `rules.stall.response: "report"`, the coach's call
     from `lifts[].stallFacts`). Such a change is proposed with that reason:
     `check --plan` warns `exercise-change` for it (main lifts stay for a
     phase), answered by an override (`code` `exercise-change`, `item` the
     lift) whose reason is the verdict's, with its Decision.
   - **The priorities stay for the phase** (the coach's confirmed list,
     `intake.md`, "The coach's priorities") unless pain or a red flag says
     otherwise. Pain on a priority's movements (`review`'s
     `pain.byExercise`, a joint ache in step 2, a new Ledger entry): the
     coach decides them again as a phase review does (below) and proposes
     the change with its reason, for the user's yes. A red flag stops the
     review first (`intake.md`, "Red flags: stop and refer"); the
     priorities are decided again once the user is cleared.
   It goes into a draft, measured with `review --plan` and `check --plan`
   (`planning.md`, step 1.4): every number in the proposal from those runs,
   and any warning gone past with its override and reason.
6. **Write** the review as that week's letter (`type: mesocycle-review`),
   propose the next block as one list (each movement kept or changed with
   its reason from the data, each change with its evidence grade), and on
   yes build it through `plan-files.md` ("The next month", written with
   `plan-write`); Decisions for each change. The next block is a draft of
   the plan as written, so it keeps the plan's `why` (the Why this plan
   card) unless a reason changes: a reason the block's changes touch is
   rewritten, with the card's `date` (`plan-files.md`, "A change to the
   plan", step 2).

## Phase review

At the end of each phase (every second light week: plan weeks 8, 16, 24
by default), in place of that week's mesocycle review (it includes steps
0–4 above; step 6 below designs the next phase in place of step 5).

1. **Tests:** the roadmap's tests (push-ups, pull-ups, hollow, side plank,
   handstand, wall test, pistol, resting HR) under test conditions (not after
   under 6 h of sleep), and the `progress` job's report.
   **Repeat the body assessment** (`intake.md`, same photo protocol, the
   `move-*` photos included): compare each observation with the last one,
   update the profile's Body assessment and its emphasis, and confirm each
   new or changed finding with the user (`intake.md`, "Confirm each
   finding").
2. **Predicted vs actual:** one row per target in the phase proposal or the
   roadmap: predicted, actual (`engine review` or the test), verdict (hit,
   within range, missed), and why.
3. **Retro:** keep / change / try, checked against the phase's pre-mortem:
   which failure modes happened, did the countermeasures work.
4. **Experiments:** close any that ended (result against the pre-set rule).
5. **Ledger, screening, eating plan:** update Ledger statuses; re-screen if
   12 months have passed or health changed; check the eating plan against the
   phase's goal (`diet.md`).
6. **Next phase, designed like a coach** through the `plan` job
   (`planning.md`, "The order"): from the roadmap, the last phase's results
   and the user's goals. Step A's questions come first, in one message, then
   wait (its item 5 asks what to keep and what to change and whether the
   wish changed, item 2 decides the priorities again as below, item 4 the
   new pre-mortem).

   **The priorities for the next phase** are decided again in step A's
   item 2 (`intake.md`, "The coach's priorities"), from this review's
   progress, beside the movements' keep and change verdicts: the photos
   and the progress report (the mesocycle review's step 4: what grew and
   what still lags against the baseline), the tape, each lift's e1RM
   (`lifts[].e1rm`) and the sets per muscle done (`volume.done`, one
   `review` per week, the mesocycle review's step 1), the repeated body
   assessment's findings with their answers (step 1 above), pain
   (`review`'s `pain`, the Ledger), the goals and the next phase's aim, and
   the user's wish. A priority that came up (its muscle grew, its finding
   eased) can step back and free its place; one still behind stays; a
   Later priority moves up when the evidence or the wish now leads it.
   Each change has its reason in the proposal's "What the last phase
   taught us", and the verdicts below read the confirmed list (a
   region-biasing movement stays while its region is a priority).

   Then, in this order:
   1. **Read two things first.**
      - **The roadmap's next phase** (`6-Month Roadmap.md`: the Phases
        table, that phase's bullets, the Targets): its aim (Build after
        Foundation: `planning.md`, step 3, "Phase sequence by goal"), its
        emphasis, its targets, and where the macrocycle is heading (the
        phases after it, the week-24 targets, `profile.json` `targets`).
      - **The last phase's results, from the engine:** `review --vault .
        --json --date <D>` on each of the phase's two light-week Sundays,
        so each run's 4 weeks are one mesocycle: `lifts[].e1rm` (its
        `change`, `verdict` and points by date) and `lifts[].stall` (with
        `triage`, or `stallFacts` under `rules.stall.response: "report"`);
        `volume.planned` against `volume.done` (one `review` per week for
        done, as the mesocycle review's step 1) and `volume.regions` (each
        region's `status`); `weight.rate` against `weight.band` (the goal's
        band); `adherence.lifting` and `adherence.short` (sessions done
        against planned); `skips` (by exercise, with each skip's reason)
        and its `flags`; readiness (`readiness --date`, as there); pain
        from the log and the check-ins (`review`'s `pain`,
        `checkins.fatigue`, and the joint aches week by week in
        `Coach/checkins.json`); and the targets scored against their
        predictions (step 2 above), with the tests (step 1 above). Beside
        them, the per-muscle answers and the RIR bias (the
        mesocycle review's steps 2 and 3), the user's answers to step A's
        keep and change questions, and the retro (step 3 above).
   2. **A verdict for each current movement,** the logged lifts first, one
      line each with its reason from that data (the number and the command,
      or the user's words): **keep** (still progressing, liked, serving the
      next phase's aim: a strength-goal lift going into heavier work, a
      region still a priority) or **change** (stalled, skipped or swapped
      often, painful, boring, or off the next phase's aim). The movements
      are the plan as written's, read here for their names and data only;
      its split, sessions and "Why:" lines are not the next plan's start.
      **Skips and swaps:** `exercises` counts each movement since the cycle
      start (`exercises.value.from`): planned, done as planned, skipped with
      the reasons, swapped with the swap's reason (the user's own, the
      Ledger, soreness, the Hotel version) and what was done instead, the
      last day done, and `lastRise` for a logged lift; its `last4` the last
      4 weeks, and `skips` each mesocycle's skipped lines (one run per
      light-week Sunday, above). When the cycle began before the phase, the
      cycle figure covers more than the phase: say so, or use the
      mesocycles' runs. An older entry's swap reason is `unknown`, and an
      older entry with no checklist counts as `unrecorded`: a verdict that
      rests on those says so, with the dates from the log or the user's
      word. Pain by movement is `pain.byExercise`, with its direction. **The
      defaults, where the data is silent:** a main lift still progressing
      stays, at most half the accessories change, and a region-biasing
      movement stays while its region is a priority (`rules.md`, "Exercise
      changes", **Weak**; "Planned variation", **Moderate**). A verdict past
      a default (a progressing main lift changed for the next phase's aim,
      most accessories changed)
      states its reason.
   3. **The candidates, from a blank `engine draft`, with the keep list as
      an input** (`planning.md`, step 1.4): each kept movement goes into
      every candidate as decided, under its plan name (a logged lift keeps
      its logged name, so its history still matches), with its `guide`
      entry, its `lifts` entry for a logged lift (the range, step and
      `progression` set for the next phase) and a "Why:" line giving its
      verdict's reason. The rest of each candidate is designed fresh from
      the next phase's aim, the evidence and the catalogue; each is measured
      with `review --plan` and `check --plan`, the three with `overlap`.
   4. **Reconcile** (`planning.md`, step 1.7): `overlap --json --plans
      <pick> --vault .` gives the share the pick keeps. A high share is
      fine when each kept movement has its earned reason, and the proposal
      quotes the share beside the verdicts. A phase review keeps the
      calendar and the plan's `start` (its weeks run on from the last: no
      new week 1, no calibration week; `check --plan` warns `start-changed`
      on a draft that moves it), so it is checked and written without
      `--redesign`: no `similar-to-current` warning comes, and none needs an
      override. Checked on the light week's Sunday (`--date`), the phase's
      end, `exercise-change` raises nothing either.
   5. **The proposal opens with "What the last phase taught us"**: the few
      findings that drove the verdicts and each change to the priorities,
      each with its number and source ("bench e1RM 53 → 71 lb from the
      phase's first point to its last, `review`'s `lifts[].e1rm`"; "face
      pulls skipped on 3 sessions of the last block, 2 for pain, `review`'s
      `skips`"; "glutes step back from the priorities: the back photo shows
      them caught up, and arms, your wish, take the place"). Then **"How
      the next phase serves the long-term plan"**: the next phase's aim and
      targets from the roadmap, and how this design moves toward them and
      the week-24 targets. Then the plan job's proposal (`planning.md`, "The
      proposal"), with the standing rules and the new pre-mortem, and on the
      yes the write through `plan-files.md` with `plan-write`; `engine
      plan` only as an optional baseline. The pick's draft started from
      `engine draft`, so it has no `why`: the next phase gets a fresh Why
      this plan card, written as `planning.md`'s "Writing it" says (step 1:
      from this proposal, "What the last phase taught us" included, with
      the candidates compared, the splits left out and `decision` the
      heading of the phase review's Decision), never the last phase's card
      carried over.
   Write the review as that week's letter (`type: phase-review`).

Week 24 ends the current roadmap's cycle: the next macrocycle needs a new
cycle start (`planning.md`, "Build the macrocycle"); plan it with the user.
