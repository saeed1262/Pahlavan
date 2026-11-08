# Check-in: the weekly review and the letter (Sundays, or on request)

One flow: what the data already says, a check-in under 5 minutes for the
user, their answers saved as data, the week's numbers, the decisions, and a
letter in the vault. The questions only ask what the data can't say.

**Mid-week, only next week's numbers** ("what should I lift next week"): run
the coming week's `engine review` (step 4: `--date` the Monday after the
training day, SKILL.md house rule 17, so past midnight it is the previous
day's week) and give its lift targets, ladder moves and any due `until`
changes in chat; stop there. The full check-in stays on Sunday.

**First, the plan check.** Every check-in starts with `check --vault .
--json --date <the template's date>` (`numbers.md`, "The plan check"). A
hard error (a Ledger constraint that started this week, the safety screen,
data Pahlavan can't read) comes first: say it, and fix the plan through
`plan-files.md` before anything else is proposed. Its warnings (a region
short of its sets, a session over the profile's minutes, a plan rule broken)
feed the decision rules below, and `legacy-default` lists the standing rules
still to write.

**`priority-room` is raised once.** A plan written before the check (or one
that kept its priorities knowingly) gives it every Sunday. Say it in one
letter, with the choice: which priorities come first (the rest under the
Athlete profile's Later priorities, as `planning.md`, "The order", step A
item 2, records each kind), or one override with its reason if the user
keeps them all. Either way it then waits for the phase review; it is not
repeated week after week without new data (a priority added, the week
resized, a lagging area confirmed), as a declined proposal is not (SKILL.md
house rule 3).

**The standing rules.** The Sunday check-in is where the coach revises the
plan's standing rules (`rules`, a lift's `progression`; formats.md, "The plan's standing rules") when the
week's facts call for it, and writes any rule `review`'s `legacy-default`
warning lists; a light week moves by editing `rules.lightWeeks`, and a stall
under `"report"` gets the response the coach picks from `lifts[].stallFacts`.
A revised rule is a plan change: a draft, `check --plan`, the user's yes,
`plan-write` (`plan-files.md`, step 3), with its Decision.

**Before the first check-in of a cycle.** The template reviews the week that
ends on the Sunday on or before the date, so before a cycle's first Sunday it
reviews the previous cycle's week. When its `weekStart` is before the cycle start
(`engine review`'s `week.planStart`), there is nothing of this cycle to
review: answer in `ask` or mid-week mode and say when the first check-in
comes (the Sunday that ends plan week 1: `week.planStart` plus 6 days). With
no letter in `Coach/Letters/` yet, the first check-in runs as usual and skips
what reads the last letter (its focus, its question, `focusFollowed`).

```bash
node .claude/skills/fitness-coach/scripts/engine.cjs check --vault . --json --date <D>                     # first: the plan check
node .claude/skills/fitness-coach/scripts/engine.cjs checkin template --vault . --json [--date D]          # step 1
node .claude/skills/fitness-coach/scripts/engine.cjs checkin add --vault . --json --file <answers.json>    # step 3: a dry run
node .claude/skills/fitness-coach/scripts/engine.cjs checkin add --vault . --json --file <answers.json> --write   # after the user's yes
node .claude/skills/fitness-coach/scripts/engine.cjs review --vault . --json --date <D>                    # step 4
node .claude/skills/fitness-coach/scripts/engine.cjs food --vault . --json --date <D>                      # step 4: the eating plan's side
```

## 1. The template: what's known, what's open

Today is the training day (SKILL.md house rule 17), passed as `--date`.
`checkin template` covers the week that ends on the Sunday on or before the
date (the week reviewed; `--date` for another). It prints:

- `record`: the skeleton to fill (`formats.md`, `checkins.json`), with the
  date, the week, the letter's path, and the triage step the engine chose
  for each stalled lift already in. `existing: true` means this check-in was
  saved before: the record holds its answers, to correct or complete.
- `ask`: checkin.md's questions and the engine's own (deload, full-load
  weeks, triage). **Match each to this file's questions by `topic`** (or
  `checkinMd`, its number here), **never by `n`**: `n` is only the
  template's order, and the pattern question comes in at `n` 8 with no
  `checkinMd`, so every `n` after it is one above this file's number. Each
  comes with `open`, the `fields` it fills, the
  `options` and the value each one becomes, and what the data already says
  (`known`): the logged sessions and the shortfall, days ticked as trained
  with no session (`tickedNotLogged`, likely unlogged), days with neither,
  protein ticks, the week's top sets, the last check-in's recovery and aches,
  the next deload week, the last letter's focus; with an eating plan that
  has a pattern, the pattern question (topic `pattern`) and its `lines`.
- `known`: the deload this week and next, fatigue, the recovery trigger.

Ask only the questions with `open: true`, and drop any the data or the
user's notes already answer. **With `existing: true`** (the usual case: the
user saved the questions in Pahlavan's Check-in screen first), skip step 3's
rounds and ask only what's still `open`: the template marks the saved ones
`answered: true`, `open: false`.

## 2. Read what the numbers can't show

- The week's sessions yourself: a rating, a note, skipped checklist items, a
  value that looks like a typo (65 reps of RDL) or the other unit.
- The week's notes `Coach/local.md` names (daily notes, a weekly note):
  travel, illness, crunch, sleep.
- The last letter (its focus and its question); `Decisions.md` entries whose
  review date has come (the ISO date the `**review:**` field starts with, on
  or before the check-in date; `formats.md`); active Ledger entries;
  `Eating plan.md` if it exists.

## 3. The questions, and saving the answers

8–11 questions in at most 3 AskUserQuestion rounds (4 per round), the open
ones only, and fold in the answer to last week's question. Each answer
becomes the value `ask[].options` gives it.

**Round 1: the week**
1. **Gaps.** "The log shows <sessions, dates>. Anything you did that isn't
   logged?" That's all / I did more (what) / The rest were rest days.
   → `confirmedUnlogged` `[{date, type}]`, `restDays`, `missedDays`. Start
   from `known.tickedNotLogged`. Unlogged sessions the user describes can be
   logged now (`log.md`); a session logged that way is not also confirmed.
   A day already in the saved record's `confirmedUnlogged`: offer to log it
   (`log.md`), and once it's logged, send `confirmedUnlogged` without that day
   in step 7's `checkin add`.
2. **Effort.** "How hard did the week's training feel overall?" Easy (5 or
   less of 10) / Solid (6–7) / Hard (8–9) / Too much (10). → `effort`.
3. **Pain.** "Any pain or niggle?" None / Mild, gone by the next day (3/10
   or less) / Lingered or over 3/10 (where, what movement) / Something new
   (describe). → `jointAches` (`[]` for none).
4. **Life.** "How was the week outside training?" Calm / Normal / Busy /
   Crunch, travel or illness. → `stress`.

**Round 2: recovery and effort**
5. **Recovery.** "Recovered by the next session?" Always / Mostly / Often
   still sore / Sore all week. → `recovery`.
6. **Top-set RIR.** "On your logged top sets, how many more clean reps were
   left?" 0–1 / 2–3 / 4 / 5 or more (too light to judge) / Didn't notice.
   → `reportedRir` (one number, or per lift when they differ; leave it out
   for "didn't notice").
7. **Protein.** Only for unticked days (`known.proteinTicks`): "On how many
   days did you reach about <the eating plan's floor, `eating-plan.json`'s
   `protein.floorG`; without a plan, the protein floor> g of protein?"
   The options run from 0 to the number of unticked days (the template
   words the question with that number, and leaves today out while its
   protein tick is still ahead; pass `--time` with the template).
   → `proteinExtra` (the answer: days beyond the ticks; readers add the ticks
   at read time, so a later tick counts once). Older records keep `proteinDays`.
8. **Enjoyment.** "How much did you look forward to sessions?" A lot /
   Fine / Meh / Dreaded them. → `enjoyment`.

**Round 3: next week, and the pattern**
9. **Availability.** "Anything different next week?" Normal / Travel /
   Busy, fewer days (how many) / Unsure. → `knownBusy`. Ask about the weeks
   next to the coming light week (`known.nextDeloadWeek`) too: a busy week
   there becomes the light week.
10. **Due decisions and last week's question.** One question per due
    Decision ("The 4-session week was due for review: keep it?"), and last
    letter's question if it wasn't answered. Did the last focus happen? →
    `focusFollowed`; anything else worth keeping → `notes`.
11. **The pattern** (only when `ask` lists topic `pattern`: an eating plan
    with a pattern). One question, a tap per line, met this week or not:
    "The eating plan's pattern, the week just gone: which lines did you
    meet?" As AskUserQuestion, a multi-select of the `lines` (each option
    the line's name and target; selected = met, not selected = not met).
    A question takes at most 4 options, so 5 or more lines go as two
    multi-selects in this round (the weekly lines, the daily lines). →
    `pattern` `{"<line id>": true | false}`; leave out a line the user is
    unsure of. Display only: Pahlavan's Food tab shows the answers, no rule
    reads them.

The template has no `checkinMd` number for the pattern (it is the engine's
own question, numbered 11 here). The engine's own, when `ask` lists them,
asked as light weeks: a light week next week, keep or cancel (→
`deload.cancelled` and `reason`; checkin.md's cancel conditions are in
`known`); a past light week with logged loads, trained at full load or as a
light week (→ its Monday in `deload.trainedAtFullLoad`).

A red flag in any answer stops the check-in (`intake.md`, red flags). Pain
over 3/10 or lingering goes to the pain rule (`adhoc.md`) and the Ledger.

**Save the answers.** Write the filled `record` to a scratch file (unanswered
fields can stay `null`: they're dropped), show it to the user in a few lines,
run `checkin add` without `--write` (it validates, merges by date and prints
the record it would save), and on the user's yes run it again with
`--write`. It writes only `Coach/checkins.json`, keeps every other record,
and a field left out keeps its saved value. Exit 1 means nothing was written:
fix the answers and run it again.

## 4. Numbers

Now run the engine's `review` twice (`numbers.md` lists its fields); it reads
the saved answers. `review --date D` covers the Monday-to-Sunday week holding
D, and uses nothing logged after D:

- **The week reviewed:** `--date <the template's date>`.
- **The coming week:** `--date <the Monday after>`. Its `week.planWeek`,
  `deload`, `lifts[].next` (with that week's deload rule and the load cap)
  and `temporaryChanges.due` are the ones the check-in plans with.

Between them they give: the plan week and whether next week is a deload
(`week`, `deload`, with the check-in's cancel, triggers and busy-week move);
sessions against the week's targets (`thisWeek`) and over 4 weeks
(`adherence`: confirmed sessions close gaps first, the rest split unlogged,
missed and rest); readiness over the last 14 scored days and its actions
(`readiness`); the weight trend, the slope against the goal's band, the
7-day sleep, steps, floors and resting-HR averages (`weight`); every logged
lift's last top set, e1RM trend, stall verdict and triage step (from where
the last letter left off), and next target (`lifts`); sets per muscle planned
and done against the tiers (`volume`); the missed-time protocol (`missed`);
the concurrent-training check (`concurrent`); each ladder's level and the
level its latest test shows (`ladders`); temporary plan changes, due and
active (`temporaryChanges`); what the answers changed (`checkins`); and the
`warnings`.

With an eating plan, run `food --date <the template's date>` too (the food
side, `numbers.md`, "The eating plan"): the week's protein days and the
weeks before them (`protein.week`, `protein.weeks`, beside the check-in's
`proteinExtra`), the waist and the weight trend against the plan's direction
(`trend`), the adjustment rule's status (`adjust`: on the review date or a
tape day once its tape is in, the check, with no change or the step, its
reason and the next check) and the pattern's answers (`pattern`).

## 5. Readiness score

Exact recipe, computed by the engine (`review`'s `readiness`, or `engine
readiness`; thresholds are heuristics):

- **Signals** for day *d*, from `body-data.json` `days`: `sleepH`, `sleepQ`,
  `energy` (sign +1), `rhr`, `soreness` (sign −1: higher is worse).
- **Baseline** for signal *k* on day *d*: its values on days *d*−28 … *d*−1
  of the current cycle (from the newest `Baseline - <date>.md`; the mornings
  before a fresh start never count). Needs **n ≥ 14**, else *k* is unscored
  on *d*. So a new cycle has no score until it holds 14 morning check-ins
  (`readiness.baseline`: "Building your baseline: n of 14"): train as
  planned meanwhile; the first score comes with the check-in after the 14th.
- **z** = sign × (x − mean) / max(sd, floor), sample sd; floor 0.5 for
  `sleepH` and the 1–5 scales, 2 bpm for `rhr`. Clipped to **[−2.5, +2.5]**.
- **Daily score R** = mean of the scored z values; needs **≥ 3** signals.
- **Smoothed S** = 0.5 × R + 0.5 × S(previous scored day), a 3-day EWMA
  (α = 2 / (3 + 1)); re-seeded with R after a gap of more than 3 days.
- **Bands on S:** ≥ +0.5 good; −0.5 to +0.5 normal; −1.0 to −0.5 watch;
  ≤ −1.0 low.
- **Flags:** RHR ≥ baseline mean + 7 bpm on two consecutive days; `sleepH`
  under 6.

Not enough history: while `readiness.baseline.value.building`, quote its
note ("Building your baseline: 6 of 14 morning check-ins this cycle; train
as planned meanwhile"); otherwise say "readiness not scored yet (needs 14
days per signal)". Use the check-in answers instead either way.

## 6. Decision rules

Apply in this order; the letter carries at most **three** changes and **one**
focus. Every accepted change gets a Decision entry.

1. **Plan ended** (only when the coming week's `week.planWeek` is past the last
   week in the month note's header, e.g. `Weeks 5–8` in `Month 2 Plan.md`):
   say so first, that nothing is planned for that week yet, and run the
   `review` job (`review.md`: the mesocycle or phase review), which builds the
   next month through `plan`, before the rest, since next week's targets
   depend on it.
2. **Due temporary changes** (only when `temporaryChanges.due` lists any):
   each item with its session, its `until` date and the proposed way back
   (`wayBack`, from its "Replaces" note).
   A note that only adjusts the item: drop its `until …: <why>` clause and
   keep the item's own note. A note that says `Replaces <item>`: restore
   that item as it was (name, `sr`, note, `lifts` entry; the old version is
   in `plan-data.json`'s git history). If the reason hasn't cleared, propose
   a new `until` date instead. Check the Ledger before restoring a high-IAP
   lift.
3. **Due Decisions** (step 2: the `**review:**` ISO date on or before the
   check-in date): compare the expected effect with what happened (code),
   then record the outcome: kept, adjusted or reverted.
4. **Missed time** (after asking about gaps; `missed`, and `lifts[].returnAdjusted`
   in the first week back after 1–2 weeks off; in plan week 1 the lighter
   weight is already in `lifts[].next`): one session missed → next in the
   rotation, no stacking; longer, the plan's `rules.missed` (`review`'s
   `missed` applies it, and its `rules.missed` says whether it is the plan's
   or the default, `legacy-default`). The default: 1–2 weeks off → first week
   back 5–10% lighter and RIR +1; 3+ weeks off → restart the mesocycle with a
   calibration week (7 days from the first session back; its `lifts[].next`
   is already the calibrated target).
5. **Readiness** (`readiness.actions`; a stale check-in is named in the note):
   low on the latest smoothed score → this week's sessions change by the
   plan's `rules.readiness.low` (the default, `legacy-default`: one set fewer
   and RIR +1) until it's back to watch or better; RHR flag or
   illness → no hard training until RHR is back under baseline + 7; sleep
   under 6 h the night before → no tests or PRs.
6. **Progression** per logged lift, from the coming week's `lifts[].next` and
   the RIR answer: `next` follows the lift's `progression` (its note names
   the rule, the plan's or the default, `legacy-default`). Under the default:
   top of the range at the target RIR → `next` as given (the load cap is
   already applied; a "big jump" note means start at the bottom of the
   range); under the bottom of the range → hold; two misses → `next` says
   `lighter` (about 10 %, rounded to `inc`); a lift's own `onMiss` and
   `onStall` change the last two. Reported RIR of 5+ → the top set was too
   light, add a rep or the increment next time. A note that names
   deload-week sessions it did not use: ask whether that week was trained at
   full load (the template asks it). Reported RIR from the check-in and the
   profile's RIR calibration bias are already in `next` when its note says
   so. Lifts that stalled for two sessions or more are named.
   **After the calibration week** (plan week 1, `week.planWeek` 1): no
   progression decisions; the week found the weights, so the letter lists each
   lift's first top set and the targets `next` gives for week 2, and a lift
   with no top set yet gets "pick a weight that leaves the target RIR, and log it".
7. **Stalls** (`lifts[].stall`: ≤ 2% over 3 sessions, adherence ≥ 80%): the
   triage ladder in `rules.md` (`lifts[].triage`, the `chosen` step), one
   step per week, starting one step after the last recorded one
   (`lifts[].triageStart`); recovery and joint aches from the check-in feed
   its fatigue test. Under the plan's `rules.stall.response: "report"`
   there is no engine step: the coach picks the response from
   `lifts[].stallFacts` and says why.
8. **Skills:** ladders behind their tests (`ladders[].testShowsLevel`; only
   ladders a plan session carries, and only tests from this cycle: the engine
   leaves the others out), and
   ladders due a move (the top of the reps on every set, two sessions running).
9. **Deload triggers (early),** all computed in `deload.triggers`: low
   readiness 5 days running with a falling e1RM (`readiness`); stalls on 2+
   main lifts (`stalls`); 2 check-ins running with poor recovery and joint
   aches (`recovery`, **(H)**); a known crunch or travel week next to the
   scheduled deload, which moves the deload onto it (`busy-week`, with
   `deload.move`). Offer it as an early light week; the user decides.
   **Under the plan's own light weeks** (`rules.lightWeeks`, `review`'s
   `rules.lightWeeks.source` `plan`) the signals are facts
   (`deload.signals`): an early, moved or cancelled light week is an edit of
   `rules.lightWeeks.weeks` through `plan-files.md`, with its Decision.
   **Under the old default** (`legacy-default`), cancelling a scheduled
   deload: only if readiness is normal or better, nothing is stalled,
   adherence ≥ 80%, and the last mesocycle had one; the user's cancel is
   saved as `deload.cancelled` in the check-in, and the engine refuses a
   second scheduled cancel in a row. Better still, write the plan's own
   `rules.lightWeeks` at this check-in.
10. **Adherence:** under 70% of planned sessions two weeks running (after
    gaps are confirmed) → propose resizing the week. `adherence` counts only
    the cycle's weeks (its note says how many of the 4, "1 of 4 weeks, the
    cycle started Mon 2 Nov"), so early in a cycle quote it with that. Then (`planning.md`, sizing
    rule, a Decision); never respond with more sessions.
11. **Body:** weight pace only once there's a week of weigh-ins: the slope
    against the goal's band (`engine review`'s `weight.rate` and
    `weight.band`); act only after two weekly readings out of band (food changes: `diet.md`, step
    rules). **Food:** with an eating plan, quote `food`'s `adjust` note. A
    step (`adjust.step`) is one proposed change: applied through `diet.md`
    (both files in one run, `engine eating`), with a Decision entry; no
    change means the portions stay. Sleep against 7 h. Steps against the current phase's target: the
    number in the `Steps:` bullet of the phase the reviewed week's `planWeek`
    falls in (`6-Month Roadmap.md`, its Phases table and that phase's
    bullets). Read it there each time; it rises by phase, so never use a
    fixed number.
    **Skips** (`skips.flags`): a pain or equipment flag is that week's swap
    proposal for the exercise (the pain rule, `adhoc.md`); a time flag points at
    `review.time` (the session too long for the user's week).
12. **Conditioning:** active minutes (`thisWeek.cardioMin`, intervals counted
    double) against the current phase's cardio target in `6-Month Roadmap.md`
    (its Targets table), read each time as rule 11 reads steps; 150–300 a week
    only when the roadmap has none. `concurrent.flags` checks the plan week on the user's
    real week (the log's weekdays once 2 complete weeks are in, `concurrent.week` says the
    source) (hard leg intervals under 24 h before heavy legs, conditioning
    before lifting, a muscle hard two days running): raise one only when it
    matches how the user actually trains. A heavy day followed by its
    lighter day is allowed (`concurrent.backToBack` lists each pair with
    `lighter`), so a back-to-back flag means the second day isn't the
    lighter one for that muscle: its heaviest work for it is a load no
    lighter than the day before's, or a prescription is missing.

Each rule that fires becomes an observation with its so-what and action, or
is dropped. Pick the **one focus** from the change most likely to move the
top goal.

## 7. Propose, apply, write

1. Show the proposed changes in one list (due temporary changes first, then
   at most three for next week: a weight, a swap, a light-week reminder, a session
   to add on a quiet day), each with its reason. Ask once which to make.
2. Apply them: plan changes through `plan-files.md`; ladder moves with
   `log ladder`; a corrected top set with `log fix` once
   the user gives the real value (never edit `fitness-log-data.json` by hand;
   `log.md`). Pahlavan picks up an edit made there even if it was open.
   Decisions entries for the accepted changes, two-line entries for declined
   ones. Then complete the check-in record with what the letter decided: the
   triage step it applies to each stalled lift (`triage`), a deload cancel
   (`deload`), and the letter's path (`letter`), through `checkin add`
   (dry run, then `--write`, part of the same yes).
3. Write the letter to `Coach/Letters/<the Sunday>.md` (format in
   `formats.md`), with the outcome of each proposal. Voice: plain, direct,
   second person, like the user's coach who knows their week.
   - **What happened:** 3–5 lines covering the week (sessions against
     target), lifts (progressed, stalled), skills and body, numbers with
     sources, the user's own notes and daily-note context. Sessions logged
     are "logged", never "missed", unless the user said so.
   - **Next week's targets:** each logged lift's target from the coming
     week's `engine review`, and ladder moves.
   - **What changes and why:** at most 3, each "change → because (data) →
     rule" with its Decision link. Declined proposals listed as declined.
   - **This week's focus:** one behaviour, concrete and checkable ("lights out
     22:45 on 5 nights", not "sleep more").
   - **One question for you:** something the coach needs and the data can't
     show; next week's check-in asks for the answer.
4. Tell the user in three lines: the headline, the focus, the link
   (`obsidian://open?vault=<the vault folder's name, URL-encoded>&file=<URL-encoded path without .md>`).
