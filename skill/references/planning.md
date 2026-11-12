# Plan design

The `plan` job: from the Athlete profile to a written plan. This file
decides what the plan should be; `plan-files.md` is how it gets written;
`adhoc.md` covers short-notice changes. Rules and sources: `rules.md`.

## The coach designs, the engine calculates and checks

The coach is the user's coach and designs every plan: the split, the
exercises, the variety and the rotation, the order, the interval formats,
the short days and the plan's standing rules, from the person (the intake
facts lead) and the evidence.

**Like a real coach, it keeps the overall plan in mind.** The roadmap (the
macrocycle, its phases with their aims and targets) is that plan. Each
phase, and each block inside it, is designed from three things: the
roadmap, the progress so far (the last block's or phase's results, from the
engine) and the user's goals and answers. A movement stays because the data
earns it (still progressing, liked, serving the next aim), and a change has
its reason from the data (a stall, pain, skips, boredom, a new aim). The
fixed rules here (main lifts kept for a phase, at most half the accessories
rotating, a region's movement kept for the phase) are defaults: the
evidence can override one, with the reason stated (`review.md`, the
mesocycle review's step 5 and the phase review's step 6).

The engine decides nothing about the plan. It does three jobs:

- **It calculates:** sets per muscle and per region, each session's
  minutes, the targets, the e1RM trend, readiness, the units.
- **It checks:** `check` holds a plan, or a draft, to the guardrails. A hard
  error (a movement the Ledger or the safety screen rules out, data
  Pahlavan can't read) stops a write and nothing clears it. Every evidence
  range is a warning with its rule, grade and reason, which the coach may go
  past by stating why (an override, with a Decision).
- **It holds the evidence library as data:** the graded rules
  (`evidence`) and the movements to choose from (`catalogue`).

| What the coach needs | Command (`numbers.md`) | What it gives |
|---|---|---|
| What the rules say | `evidence --topic <topic> --json` | Each rule's number (the one the engine checks with), grade, note and sources. Ask by topic (`volume`, `effort`, `load`, `rest`, `order`, `range-of-motion`, `exercise-choice`, `progression`, `light-weeks`, `readiness`, `calibration`, `concurrent`, `activity`, `regions`, `findings`, `standing-rules`, ...): the whole library is about 50 KB, read only when a design truly needs all of it |
| The options | `catalogue --pattern P --region R --muscle M --equipment <the profile's words> --json` | Movements with their muscles, regions, abdominal-strain tag, level, easier and harder versions and other names: options, never a choice |
| A blank plan to start each candidate from | `draft --vault . --json` | plan-data's keys in their order with no sessions, lifts, guide entries, rules or `why`; only `start`, `liftUnit` and the desk breaks carried from the plan as written |
| A candidate's numbers | `review --plan <draft> --vault . --json` | Sets per muscle and region (direct, half credit, near failure), each session's minutes, the targets, pull to push, the concurrent-training flags: what Pahlavan will show once it is written |
| A candidate against the guardrails | `check --plan <draft> --vault . --json` (a redesign: `--redesign`) | Hard errors, warnings with rule, grade and reason, the overrides applied |
| How much plans share | `overlap --json --plans <a>,<b>,<c> --vault .` | The share of each plan's movements the other holds, both ways, for each pair and against the plan as written; the shares over half |
| The write | `plan-write --file <draft> --vault . --json` (a redesign: `--redesign`) | The check again and the diff; `--write` after the yes (`plan-files.md`) |

- **Every number from a command run in this job.** A number in the
  proposal, a note, a Decision or a plan item is quoted from one of these
  runs, with the command named, never from memory or an earlier message
  (SKILL.md house rule 1).
- **Every engine call in the open.** Each command runs directly in the
  shell, one command per call, so the user sees what ran and what it said:
  never wrapped in a script of the coach's (a node or Python file that runs
  the engine on the candidates), never several in one call (SKILL.md house
  rule 22). Three candidates are one `draft` call, six measuring calls
  (`review --plan` and `check --plan` on each) and one `overlap` call on
  the three. The evidence comes by topic.
- **A first plan works on a fresh vault.** With no `plan-data.json` yet
  (right after the intake), `draft --vault .` gives the same blank plan (a
  `no-plan` warning says there was nothing to carry over), and `review
  --plan`, `check --plan`, `overlap` and `plan-write` read a draft all the
  same; the other commands answer with a `no-plan` warning.

## The order: questions, design, proposal, write

A new plan (a fresh start, a reset, a redesign, a phase review's next block)
goes in four steps, each finished before the next begins. **Step A is a hard
stop:** nothing is designed, measured or proposed until the user has
answered.

**A redesign** is a new plan in place of the running one rather than its
next block: a fresh start or a reset with a plan in the vault, or a new
plan the user asks for while one runs ("new plan", "this has gone stale").
A phase review's next block continues the running plan, designed as a
coach would: the roadmap's next phase and the last phase's results first,
then a keep or change verdict for each current movement with its reason
from the data, then candidates from blank with that keep list as an input
(`review.md`, Phase review, step 6). Every new plan is designed from blank
(step 1.4) and meets the plan as written's layout only at Reconcile (step
1.7; a phase review's verdicts read its movements before that, never its
split or sessions): old data pulls the plan toward continuing what was
done, so the coach asks the person instead (`intake.md`, "How to run it"),
and a movement continues only when its data earns it.

- **A. The open questions, in one message, then wait.** Everything the
  design needs from the user that the files don't settle, asked together
  (free text in plain text, real options with AskUserQuestion: SKILL.md
  house rule 15):
  1. **Each finding not answered yet**, as a yes or no question: a
     body-assessment row or a self-check result with no answer in the
     profile (`review --vault . --json`'s `finding-unconfirmed` warnings
     give each one's question; `intake.md`, "Confirm each finding").
  2. **The coach's priorities, decided again** (`intake.md`, "The coach's
     priorities"; step 5, "The priorities are the coach's confirmed
     list"). Right after the intake, with nothing new since its confirmed
     list, that list stands: say so in one line. Otherwise (a redesign, a
     phase review's next phase, new data since the date decided, or a
     profile whose priorities carry no reasons and no date: the user's own
     picks from before that step, read now as the user's wish) the coach
     decides them again from the current data: the newest progress report
     and photos, `review --vault . --json`'s sets per muscle
     (`volume.done`, `doneTiers`) and each lift's e1RM trend
     (`lifts[].e1rm`), the findings with their answers, pain (`review`'s
     `pain`, the Ledger), the goals in order and the user's wish (item 5
     asks whether it changed). It proposes the ranked list within the
     week's room (`evidence --topic volume`'s `volume.priority-room` for
     the lifting days the user gave), each priority and each change with
     its reason from that data, where the wish landed and why, and the one
     confirm question. When an answer in this message moves the list (a
     finding confirmed or declined in item 1, a new wish in item 5), the
     changed list is shown once more, with what moved and why, before step
     B. The list holds every effective priority muscle (the
     profile's, its declared regions' muscles and its confirmed lagging
     areas: the one list `check`'s `priority-room` counts). Past the room,
     the confirmed answer is recorded by where each one comes from: a
     profile priority moves from `priorityMuscles` to the Athlete profile's
     Later priorities; a declared region moves from `priorityRegions` to
     Later priorities too; a confirmed lagging area counts while its row
     stands, so the choice is recorded (when it waits: under Later
     priorities, and one override for `priority-room` giving the choice as
     its reason).
  3. **The start date, for a fresh start or a reset only:** the day plan
     week 1 begins, written as the plan's `start` (step 3, "The plan's
     start"). A phase review's next block keeps the plan's `start` (its
     weeks, light weeks and phases run on): there is nothing to ask.
  4. **The pre-mortem:** "Picture week 6: this plan has failed. Why?",
     starting from the bad-week answer ("Pre-mortem" below).
  5. **For a reset, a redesign or a phase review's next phase, what to
     keep and what to change**, in plain text: what do you want to keep,
     what do you want changed, what's boring or not working, what has
     changed in your situation (time, gym, work, how you feel), and whether
     what you care about most has changed (the wish for item 2, recorded
     with its new date). After a reset's intake, only what the intake
     didn't ask. The answers are the user's own: the old plan's split and
     exercises are not a preference unless the user names them. At a phase review they go into each
     movement's verdict beside the data (`review.md`, Phase review, step
     6).

  Then stop, and wait for the answers. They are recorded before step B, as
  `intake.md` step 6 records a finding's answer (step A's message says
  they will be): each finding's `confirmed`, and the confirmed priorities
  (`priorityMuscles` and `priorityRegions` in their order; in the Athlete
  profile's Priorities each with its reason and the date decided, the rest
  under Later priorities, and the wish with its date; the date and the
  wish in `profile.json`'s `_priorities` note); item 5's answers in the
  Athlete profile with the date asked (Preferences, and Availability or
  Equipment when the situation changed), and in `profile.json` where a
  field holds them (`preferences.likes` and `dislikes` by catalogue id,
  `preferences.splits`, `availability`, `equipment`); then `validate`, so
  step B's `review --plan` and `check --plan` read them. The start date and
  the user's failure modes go into the draft and the proposal.
- **B. Design and measure:** the candidates (step 1), built on the answers
  (and at a phase review on its keep list: `review.md`, Phase review, step
  6), each measured with `review --plan` and `check --plan` and scored;
  then the pick set beside the plan as written (step 1.7, "Reconcile").
- **C. The proposal and its yes** ("The proposal (one message)"). A change
  the user asks for is discussed and the proposal shown again; an answer
  that changes the design (a finding declined after all, another start date
  for a fresh start, a logged lift the user keeps at Reconcile) goes back to
  B for what it touches.
- **D. Write** ("Writing it"), on the yes only.

An ad hoc change (`adhoc.md`) or a change inside the plan (a swap, the next
month, `plan-files.md`) asks only what it needs and keeps the plan's
`start`.

## The gap-search rule

The coach designs from Pahlavan's own evidence library (`rules.md`,
`engine evidence`). The web is searched only for a gap the library doesn't
cover: a specific condition, sport or piece of equipment (a return to
running after a calf strain, a climber's pulling, a rowing machine).

- **Sources:** systematic reviews and meta-analyses with DOIs first; a
  trial only where no review exists. Each finding is graded on the library's
  scale (**Strong**, **Moderate**, **Weak**, **(H)**; `rules.md`).
  Marketing, blogs and forums are not evidence.
- **In the proposal:** the finding is labelled "outside the library", cited
  (authors, year, DOI) with its grade, and the user is asked before the plan
  relies on it.
- **Privacy:** never put personal or health details in a search query (no
  name, age, condition or injury history): search the general question
  ("calf strain return to running systematic review"), never the person.
- **The library:** a new finding is proposed for the library (one line in
  the proposal or the letter: "worth adding to Pahlavan's rules"), never
  added silently. `rules.md` and `engine evidence` change only through a
  Pahlavan release.

## Inputs

The intake facts lead: the plan starts from what the user said and showed,
then the evidence decides how to deliver it.

- `Coach/Athlete profile.md` and its twin `Coach/profile.json`: screening,
  goals in order with their measures, availability (days, minutes, short
  days, fixed days), equipment, tracking level, preferences (exercises,
  cardio modes, splits), the bad-week answer, the movement self-check, the
  RIR calibration, and the **Standing plan rules** (the user's own rules for
  any plan; the ones the engine can check are `profile.json` `planRules`).
  Without `profile.json`, run `intake` first, which writes it.
- **The Body assessment and the self-check, with the user's answers.** A
  finding the user confirmed shapes exercise choice and volume (pull to
  push, unilateral work, a lagging muscle, squat and overhead regressions);
  a declined one keeps its warm-up lines only; an unanswered one ranks its
  regression first and rules nothing out (`intake.md`, "Confirm each
  finding"; `evidence --topic findings`).
- **The coach's priorities:** the confirmed list in the Athlete profile's
  Priorities, each with its reason and the date decided, as
  `priorityMuscles`, and `priorityRegions` with the regions of a confirmed
  body-assessment row (`intake.md`, "The coach's priorities"); the user's
  wish beside them, one input. Decided again in step A, item 2, when the
  data has moved.
- `Coach/Ledger.md`: every entry with status active or managing is a
  constraint on exercise choice; `Coach/ledger.json` holds them for the
  engine, and `check` screens every draft against them.
- `engine review` (`numbers.md`): adherence (last 4 weeks), e1RM per lift,
  sets per muscle of the current plan, the weight trend. **After a fresh
  intake, only if the user chose to use their history** (the profile records
  it); otherwise the week is sized from the stated availability and
  starting weights come from the calibration week.
- The last two letters and open Decisions.
- **The plan as written, at Reconcile.** For a new plan, `plan-data.json`
  (what exists now, its standing rules included), the newest month note
  (when `Coach/local.md` names one) and, for a redesign, `6-Month
  Roadmap.md` are read at Reconcile (step 1.7), after the pick, never
  before the design: the profile, the Ledger, step A's answers, the letters
  and the Decisions come first, so the old plan's split, names and "Why:"
  lines don't become the new plan's. `engine review`'s numbers of the plan
  as written (its `volume`, its `lifts[]`) wait for Reconcile too, except
  for starting weights. A phase review's next block reads the roadmap first
  (its phases run on, step 3), then the last phase's results and each
  current movement for its verdict (`review.md`, Phase review, step 6):
  the movements and their data, while the plan's split, sessions and
  "Why:" lines still wait for Reconcile. A change inside the plan (a swap,
  the next month) reads the plan first (`plan-files.md`, "A change to the
  plan").
- The vault's notes for the coming weeks (`Coach/local.md` names them, such
  as daily notes), if the user opts in: known travel and crunch weeks
  (life-aware scheduling).
- **A fresh start needs its Baseline note first.** The intake writes it
  (`intake.md`, step 7). When the plan job comes first in a fresh start (a
  new plan as a reset, with the profile kept), it writes the note instead,
  before the proposal: `baseline --vault . --json --date <today>`, and on
  the user's yes its `text` to its `path`, word for word (`exists` true: a
  note for the day is there; write nothing). A plan change inside a cycle
  (a swap, the next month) writes no note.

## 1. Design the week from constraints

The split is a scheduling choice: at matched weekly sets per muscle, splits
and frequencies build the same muscle and strength (**Strong**,
[Schoenfeld 2019a](https://doi.org/10.1080/02640414.2018.1555906),
[Ramos-Campo 2024](https://doi.org/10.1519/JSC.0000000000004774)). So the week
starts from what the goals need, and the split is whichever family delivers
it best for this user. Rules, numbers and grades: `rules.md` ("Plan
structure", "Split families", "Goal modifiers") and `evidence --topic
volume`, `--topic load`.

1. **Screening.** Blocked: no plan. Conservative: full body only, RIR ≥ 4, no
   vigorous work, whatever the steps below say (its candidates are full-body
   variants that differ in days, dose and minutes). Go, ramped: the first
   mesocycle at RIR ≥ 3. `check` errors on a draft that breaks the screen's
   limits (`screening-limit`).
2. **The constraints, written down before any split:**
   - the weekly sets per muscle the goals need (step 5's tiers; a strength
     goal needs few sets) and the goal modifier's loading;
   - the per-session cap, about 8 direct sets per muscle (**Weak**): a muscle
     needing more than about 16 a week needs 2+ sessions;
   - 2+ exposures a week for each strength-goal lift (**Moderate**);
   - the time: planned sessions (step 2) × minutes, rest (step 5) and the
     warm-up included;
   - recovery: no muscle trained hard two days running **(H)**, unless the
     second day is the lighter one for it (a heavy day followed by its
     lighter day); a set at RIR 4 or more is not hard;
   - the bad-week answer: what a missed day costs each muscle **(H)**;
   - the cardio days and modes, and the concurrent rules (step 7);
   - equipment, the Ledger, the self-check, and training age by how fast
     they progress **(H)**; at 65+, start around RPE 5–6 **(H)**;
   - the Standing plan rules and `planRules`, split likes and dislikes,
     preferences;
   - the declared regions (the parts on the coach's confirmed priorities)
     and the coverage rule (step 4, "Regions").
   Novices have no lifting-day cap: 4 days with the rest as cardio, mobility
   or skill work is a recovery and time default **(H)**, overridden when the
   user wants more and the week fits.
3. **At least three candidates, designed by the coach**: genuinely
   different families from `rules.md` "Split families", at least one
   outside full body and upper/lower (heavy/light full body counts as full
   body here); A/B and A/B/C are one family. Each from a family whose Fits
   column the constraints meet, or with the mismatch named as a cost. Each
   is a whole plan: its days, sessions, exercises (step 4, from `catalogue`
   and the coach's own), sets × reps, RIR, rest, interval formats, short
   days, rotation and standing rules.
   **Every family not built gets one line:** why it doesn't fit this
   person, from its Fits and Costs columns set against this person's week
   and answers, never the columns copied ("push/pull/legs: it fits 3 or 6
   days; on your 4, each muscle gets one hard day a week, and a skipped day
   loses its whole week"). Concurrent (hybrid athlete) gets none: it is how
   the cardio fits into any plan, not a split. A family counts once, so
   Conservative screening's full-body variants are one family, and the
   other families' lines name the screen. These lines go into the
   proposal's item 1, the roadmap's "How your data shaped this plan", the
   Decision and the plan's Why this plan card ("Writing it").
4. **Write and measure each.** Each candidate is a whole `plan-data.json`
   saved as a scratch file outside the vault (`/tmp/plan-data.<candidate>.json`),
   never over the real file. **Each starts from `draft --vault . --json`'s
   `planData`**, a blank plan in plan-data's key order (no sessions, lifts,
   guide entries or rules; `start`, `liftUnit` and the desk breaks carried
   from the plan as written, `weekTarget` from the profile's days; on a
   vault with no plan yet the same, with a `no-plan` warning), **never from
   the current file**: it keeps the old plan's names, "Why:" lines and
   Why this plan card (`why`), and a candidate built on it comes out as an
   edit of the old plan. The draft never carries a `why`: a candidate
   being compared skips it (its `no-why-card` warning is expected), and
   only the pick gets one, before it is written ("Writing it"). Fill in `weekTarget`, `liftTypes`, `shortTypes`,
   `sessions`, `lifts`, `guide` and `rules`, and the other keys the plan
   needs (`titles`, `shortNames`, `focus`, `warmups`, `express`, `ladders`,
   ...) in their place in plan-data's key order (`engine --version
   --json`'s `facts.planData.keys`); `start` stays as the draft carries it,
   or for a fresh start or a reset is the date from step A. A `guide` entry
   with `muscles`
   for every movement (a movement the catalogue knows counts with the
   catalogue's tags; one outside it counts with its entry's `muscles` and
   `regions`, and counts nothing without them), and a `lifts` entry with its
   `progression` for every logged lift. (A change inside the running plan,
   the next month or a mesocycle review's next block, is a draft of the
   plan as written instead, `plan-files.md`, "A change to the plan",
   measured the same way.) **A phase review's candidates** start from
   `draft` too, with its keep list as an input (`review.md`, Phase review,
   step 6): each movement with a keep verdict goes into every candidate as
   decided, under its plan name with its `guide` entry (and its `lifts`
   entry for a logged lift, set for the next phase), its "Why:" line the
   verdict's reason; the rest of each candidate is designed fresh. Then
   run, on each:
   - `review --plan <draft> --vault . --json`: sets per muscle against the
     tiers (`volume.planned`, `volume.bands`), the direct sets near failure
     of each priority muscle, the regions (`volume.regions`), each session's
     minutes (`time`), pull to push (`volume.pullPush`), the
     concurrent-training flags (`concurrent`);
   - `check --plan <draft> --vault . --json`: a hard error rules the
     candidate out until it's fixed; each warning is fixed, named as a cost,
     or answered with an override and its reason ("Overrides and plan
     rules" below).

   Then, once on the three, `overlap --json --plans <a>,<b>,<c> --vault .`
   (`numbers.md`, "A new plan from blank: `draft` and `overlap`"): `pairs`
   gives each pair's shares both ways (`aInB`, `bInA`, with `shared`), and
   `similar` lists each share over half (`limit`, a rough guide **(H)**).
   Two candidates over half against each other (`current: false`) are one
   plan twice: change one until each is its own design, or say in the
   scoring table why the overlap stays (the equipment allows few movements,
   a Ledger entry leaves one squat, a phase review's keep list, in every
   candidate by decision). The same run's `againstCurrent` goes into step
   5's table.
5. **Score them** in one table, a row per candidate, on what the evidence
   supports (`rules.md`, "Plan structure", Scoring):
   - **the checks:** every muscle in its tier, no session over the cap,
     inside the minutes, pull:push, the regions' coverage, the plan rules,
     from each candidate's `check --plan` and `review --plan` runs; a failed
     check rules it out or is named;
   - **exposures** for each strength-goal lift (**Moderate**);
   - **heavy/light days** only for a trained lifter with a strength goal
     (**Moderate**, [Moesgaard 2022](https://doi.org/10.1007/s40279-021-01636-1));
     for a muscle goal or a novice they are a preference, scored only from
     `preferences.splits`;
   - heavy leg days next to key runs (**Moderate**); **skip risk** from the
     bad-week answer **(H)**; pulling in every session **(H)**; a novice's
     practice of each main lift (**Weak**); what Pahlavan can't express as a
     cost, not a veto;
   - **preference and fit** decide between candidates equal on the above
     (**Moderate**, [Teixeira 2024](https://doi.org/10.1186/s12966-024-01636-0)).
     No split is scored as better for muscle.
   - **the overlap with the current plan**, its own column from step 4's
     `overlap` run (`againstCurrent[].draftInCurrent`, the share of the
     candidate's movements also in the plan as written, and
     `currentInDraft`): information for the pick and the proposal, never a
     score. Keeping more of the old plan makes a candidate neither better
     nor worse; with no plan as written the column says so.
6. **The pick**, argued from the user's data with each deciding factor's
   evidence and grade (quoted from `evidence`), the numbers from its
   `review --plan` run. The pick's scratch file goes to Reconcile (step 7),
   then becomes the draft `plan-files.md` writes.
7. **Reconcile: the pick beside the plan as written.** Only now is
   `plan-data.json` read ("Inputs"; a phase review read its movements for
   the verdicts, never its layout); with no plan yet there is nothing to
   reconcile, and the pick goes to the proposal. The pick was designed
   without the plan as written's layout; this step sets the two side by
   side and changes the pick only by what the user chooses (a redesign). A
   phase review's next block decided its keeps before the design (the
   verdicts, `review.md`, Phase review, step 6), so here it shows them
   against the plan as written.
   - **How much it keeps:** `overlap --json --plans <pick> --vault .`:
     `againstCurrent[].draftInCurrent` (the share of the pick's movements
     also in the plan as written), `currentInDraft` (the share of the old
     plan the pick keeps) and `shared`. For a redesign, over half
     (`similar`, `current: true`) is a rough guide **(H)**: change the pick,
     or give the reason it keeps that much in the proposal. For a phase
     review's next block a high share is fine when each kept movement has
     its verdict's reason: the proposal quotes the share beside the
     verdicts.
   - **The logged lifts:** each lift the plan as written logs (its `lifts`
     entries) that the pick drops or could keep, one line each with its
     trade-off: its history (the sessions logged, the e1RM trend and the
     next target, from `next --lift "<name>"`) against what the pick's
     choice gives instead (its reason: the region it biases, the equipment,
     the user's answers, the change they asked for). A lift the pick
     already holds under another name (`shared` names it by its catalogue
     id) takes its logged name, with nothing to choose. For a redesign the
     user chooses in the proposal (item 1); a lift kept goes into the pick
     under its logged name (its history is matched by name: "Writing it",
     Names), with the `lifts` entry the pick gives it, and the pick is
     measured again (`review --plan`, `check --plan`, `overlap`). For a
     phase review's next block the verdicts decided already: a logged lift
     kept is in the pick under its logged name, and one dropped gets its
     line here with its verdict's reason and what replaces it.
   - **The calendar:** a fresh start or a reset begins a new week 1 (its
     `start` from step A), and a phase review's next block keeps the
     calendar. A redesign in the middle of a block (`review`'s
     `week.weekInMesocycle` past 1, outside a light week) is the coach's
     decision, with its reason in the proposal and the Decision: **keep the
     calendar** (the `start` as written, the light weeks, tests and phases
     where they fall, so the new plan's first block is the rest of this
     one), or **start a new block** (the `start` as written too, with the
     light weeks listed in `rules.lightWeeks.weeks`: the ones already past
     kept, so the mesocycle and phase counts stand, and the next ones
     counted from the week the redesign begins). Either way the week it
     begins can be a calibration week for the movements it brings in,
     listed in `rules.calibration.weeks` (step 8).
   - **The check:** `check --plan <pick> --vault . --json --redesign`. Its
     exercise changes are information (`redesign-changes`), and
     `similar-to-current` warns when over half is kept, its items the
     shared movements: answered by an override with its reason (one with
     no `item` for the whole share, one with an `item` for one kept
     movement, a main lift the user chose to keep for its trend), or the
     pick changes. The write is `plan-write --redesign` (`plan-files.md`,
     "A change to the plan", step 3). A phase review's next block is a
     change inside the plan that keeps the calendar, checked and written
     without `--redesign`: no `similar-to-current` warning comes, so its
     share is answered by the verdicts in the proposal, not an override,
     and on the light week's Sunday (`--date`), the phase's end,
     `exercise-change` raises nothing.

## 2. Size the week to reality

- **Planned sessions a week = the smaller of** the stated days and the last
  4 weeks' confirmed sessions + 1 **(H)**. "Confirmed" means after asking about
  every gap (logs undercount; `habit-days` in the adherence output often shows
  unlogged sessions).
- Minutes per session from the profile; when logged `durationMin` values run
  shorter than planned, plan to those and keep Express as the floor.
- Short sessions (`shortTypes`) are the first to drop when the week shrinks;
  lifting comes first.
- If the user wants more than the rule gives, plan the minimum week as the
  target and the extra as optional ("a 5th session when the week allows").
- **The minimum week and Express are a real dose:** about 4 hard sets per
  muscle a week in 2 short full-body sessions (supersets) holds strength and
  size, and is the bad-week plan (**Moderate**,
  [Iversen 2021](https://doi.org/10.1007/s40279-021-01490-1); `rules.md`,
  "The minimum week"). `express.short` says what Express does to a short
  day (formats.md, "The plan's standing rules").

## 3. Build the macrocycle

- **12–24 weeks, phases of two mesocycles** **(H)**; periodized plans help
  1RM a little (**Moderate**,
  [Moesgaard 2022](https://doi.org/10.1007/s40279-021-01636-1)).
- **The light weeks are the plan's own:** the coach writes
  `rules.lightWeeks` (every N weeks, or the weeks listed, with their sets,
  load and added RIR; `evidence --topic light-weeks`). A mesocycle ends at
  each light week and a phase is two mesocycles, so the light weeks set
  Pahlavan's mesocycles and phases. Every 4th week is a heuristic **(H)**: no
  trial supports a fixed timing for muscle, and surveyed athletes take one
  every 5.6 ± 2.3 weeks (**Weak**,
  [Coleman 2024](https://doi.org/10.7717/peerj.16777),
  [Rogerson 2024](https://doi.org/10.1186/s40798-024-00691-y)). Without the
  rule Pahlavan uses its default (every 4th week, 2 sets of everything, about
  10% lighter) with a `legacy-default` warning. `check` warns
  `no-light-week` past 6 loading weeks running.
- **The plan's start.** A fresh start's or a reset's plan carries `start`,
  the date the user chose in step A (formats.md, "The plan's start"): the
  Monday-to-Sunday week holding it is plan week 1 for Pahlavan, `review`
  and the calendar from the day the plan is written, logged session or not
  (`engine review`'s `week.planStart` is its Monday; before it
  `week.planWeek` is null and Today says when the plan starts). **A phase
  review's next block, the next month and every change inside the plan
  keep the `start` the file has**, so the weeks, the light weeks, the tests
  and the phases run on: `engine draft` carries it, and `check --plan`
  warns `start-changed` on a draft
  that drops or moves it. A reset is the one change that begins a new
  week 1 (its own
  calibration week): its draft's new `start` answers `start-changed` with
  an override naming the reset. A plan without a `start` counts from the
  first logged plan session (until the cycle has one, from the cycle
  start's week), as before, and its changes add none.
- **Phase sequence by goal (H):**
  - Recomposition or muscle: Foundation (calibrate, technique, efficient
    volume) → Build (priority muscles toward 10–16 sets, heavier main lifts)
    → Peak (highest volume the user recovers from, then tests).
  - Strength: accumulation (more sets, 6–10 reps) → intensification (3–6
    reps, fewer sets) → realization (heavy singles or tests, low volume).
  - Health: steady full-body phases; the change between phases is in
    conditioning and steps.
- **Life-aware (opt-in):** a known travel or crunch week within a week of a
  light week becomes the light week (`rules.lightWeeks.weeks` lists it); a
  crunch week elsewhere gets the minimum week. Say it in the proposal and
  the Decision.
- The plan's length is plan-data's `weeks` (without it, 24): Pahlavan's top
  bar reads "Week N of M" from it. Past the plan's last week it reads "Week
  N, after the plan's M". A macrocycle that runs past it needs a new cycle:
  a fresh start (a new `Baseline - <date>.md` from `engine.cjs baseline`,
  which begins the cycle, and a new plan whose `start` is its week 1). That
  is a separate piece of work to plan with the user, not part of this job.

## 4. Choose the exercises

The catalogue widens the choice; it never makes it. `catalogue --pattern`,
`--muscle`, `--region` and `--equipment` (in the profile's words) list the
options with their muscles, regions, abdominal-strain tag, level and easier
and harder versions, in a display order that is never a ranking for this
user. Its 245 movements reach past the gym lifts: calisthenics ladders,
jumps, cardio modes, mobility, warm-up, balance and desk-break drills. Each
says what it asks of the body (`risk`: weight on the wrists, hanging,
lying on the back, jumping), facts to weigh against what the person
reports, never a diagnosis; and each has guide text (`guide`) to start a new
movement's guide entry from. A movement outside the catalogue is as good as one in it once its
guide entry gives its `muscles` (and `regions`): it counts in every number,
and `check` notes it (`unknown-exercise`; the Ledger screens it by name
only).

- **The self-check sets the starting points** (`intake.md`, "The movement
  self-check", with its thresholds): each ladder's starting level (pull-up,
  push-up, core, single-leg); pull-ups as the main vertical pull at 3 or
  more strict reps, a lower level (negatives, band-assisted, scapular) beside
  the lat pulldown, or in its place where there is none; single-leg work when
  balance holds 30 s a side, split squats and a balance hold when it does
  not; the push-up and single-leg ladders where pressing or single-leg work
  is otherwise thin (no bench, loads or machines); box squats for a hard
  sit-to-stand, heel-elevated squats for heels that lift, hip thrusts and
  back extensions for a hinge that rounds, landmine or incline pressing for
  a reach that is not clean; nothing above a tested ladder level. Each
  applies as the user's answer to the finding says (confirmed, declined,
  unanswered: "Inputs" above).
- **Main lifts** (the session's 1–2 logged lifts): kept for the whole
  phase, by default.
- **Accessories:** rotate at mesocycle boundaries, at most half at a time,
  keeping the ones still progressing, by default (**Weak**,
  [Kassiano 2022](https://doi.org/10.1519/JSC.0000000000004258)). Variety
  is the coach's: planned variation changes where a muscle grows, random
  rotation doesn't help (**Moderate**, `rules.md`, "Planned variation").
  `check` warns `exercise-change` for a change inside a mesocycle, and for
  a main lift changed inside a phase.
- **These two are defaults for a running plan, not the decision:** the
  next month, a phase review's next block and every change inside the
  plan. Each movement gets a keep or change verdict from the block's data
  (`review.md`: the mesocycle review's step 5, the phase review's step 6),
  and the evidence can override a default with its reason stated (pain, a
  stall the triage ladder hasn't fixed, a movement often skipped or
  disliked, off the next phase's aim); a main lift changed inside a phase
  answers its `exercise-change` with an override whose reason is the
  verdict's. At a phase review the verdicts are an input to the design
  (the keep list, step 1.4), not a step at Reconcile. **A redesign sets
  them aside**, except for what Reconcile
  keeps (the logged lifts the user chooses to keep): `check --plan <draft>
  --redesign` lists its changes as information (`redesign-changes`) instead
  of `exercise-change` warnings, and measures how much it keeps
  (`similar-to-current`).
- **Screen every movement** against the Ledger (constraints and IAP tags in
  `rules.md`), the equipment, and the user's dislikes; `check` blocks what
  the Ledger or the screen rules out.
- **Pick by** equipment, the Ledger, liking and the lift the user wants
  strong: free weights and machines build equal strength and size
  (**Moderate**, [Haugen 2023](https://doi.org/10.1186/s13102-023-00713-4));
  for a two-joint muscle, the version that loads it long (the seated leg
  curl, overhead triceps extensions, standing calf raises; **Moderate**,
  `rules.md`, "Two-joint muscles long").
- **Order:** the goal's priority lift first (a strength-goal lift, or a
  priority muscle's main exercise; **Moderate**,
  [Nunes 2021](https://doi.org/10.1080/17461391.2020.1733672)); otherwise for
  safety and logistics.
- **Range of motion:** full, with the stretched position emphasised;
  lengthened partials only as an option (a load ceiling, a painful end
  range); never short-range partials as main work (**Moderate**,
  [Kassiano 2023](https://doi.org/10.1519/JSC.0000000000004415)).
- **Posture goal:** pulling sets at least equal to pushing sets **(H)**, with
  face pulls, rear-delt work or pull-aparts in every session; with a
  confirmed posture finding, about twice (`check`'s `pull-push`).
- **A new movement** needs a `guide` entry with `muscles: {main, helps}` (and
  `regions` for a movement outside the catalogue that biases one) and, if
  it's a logged lift, a `lifts` entry (`plan-files.md`, step 2). For a
  movement the catalogue knows, write the catalogue's tags: they are the
  ones that count.

### Regions

A priority muscle's whole sets can hide a part of it with no direct work
(side delts when every press is a bench press). The regions the evidence
supports, their grades and the movements that bias each are in `rules.md`,
"Regions", and `evidence --topic regions`.

- **Coverage (H):** each region of a priority muscle that is in the
  coverage rule gets at least 4 direct sets a week from a movement that
  biases it. `check --plan` warns `region-coverage` with up to 5 catalogue
  options that fit the equipment, the Ledger, the dislikes and what a
  confirmed finding rules out; a region nothing can cover is a note
  (`region-uncoverable`).
- **A declared region** (a part of a muscle on the coach's confirmed
  priorities: `priorityRegions`, or a confirmed row's `regions`) gets at least 6 direct sets near failure a week inside its
  muscle's 10–16 (`region-declared-short`), from a movement kept for the
  whole phase (planned variation, **Moderate**). That holds in a running
  plan unless its verdict is change (pain, the user's dislike); a phase
  review's verdict says whether it carries into the next phase, and a
  redesign picks the movement afresh, with Reconcile (step 1.7) saying
  whether the old one stays.
- **Never diagnosed.** A declared region is the coach's proposal, from
  the user's wish or from a goal or a confirmed finding it serves, and the
  user confirms it (`intake.md`, "The coach's priorities"); the coach never
  says a part lags, since no photo shows it (`rules.md`, "Regions",
  **Weak**).
- **An idea the evidence doesn't support** (inner chest, the VMO, upper
  lats, the biceps peak, lower glutes) is explained in one line with the
  nearest supported option (`evidence --topic regions`'s
  `regions.unsupported[]`: `why`, `nearestText`), never planned for. The
  user can still have a pec fly because they like it.

## 5. Reps, effort, rest and volume

Each number below is quoted from `evidence` (the topic in brackets) when
the proposal gives it.

- **Rep ranges** from the goal modifier (`rules.md`, "Goal modifiers";
  `load`): strength, main lifts at 80%+ of 1RM (about 1–6 reps); muscle, any
  range from about 6 to 30 reps near failure, picked by equipment, joints
  and liking (**Strong**,
  [Schoenfeld 2017b](https://doi.org/10.1519/JSC.0000000000002200)). Where
  one dumbbell step is over 10% of the load (light dumbbells, the lateral
  raise), widen the range (8–15).
- **RIR targets** (`effort`): compound 1–3, isolation and machines 0–2,
  strength work 2–4; Conservative ≥ 4; corrected by the user's calibration
  bias. Failure is optional, and never on heavy compounds (**Moderate**,
  [Refalo 2023](https://doi.org/10.1007/s40279-022-01784-y)). Each item's
  RIR goes in its `rir` field, never in its note.
- **Rest** (`rest`): at least 90 s, 2–3 min on heavy compound lifts and
  compound accessories at 6 reps or fewer; supersets of non-competing muscles
  when time is short (**Moderate**,
  [Singer 2024](https://doi.org/10.3389/fspor.2024.1429789)): a superset's
  second item has `pair: true`, both resting "90 s after each pair". `check`
  warns `rest` and `rest-heavy` (core, skill and carry work aside).
- **Sets per muscle a week** (`volume`): priority muscles (2–3, the
  coach's confirmed list) 10–16; the rest 5–10; none under 4; none over 20–24; at most 6–8
  direct sets for one muscle in one session. With the posture emphasis,
  upper back and lats may run past 16, up to the cap, to keep pull at about
  twice push; cardio doesn't lower them (step 7). Evidence: the tiers
  **Moderate** ([Pelland 2025](https://doi.org/10.1007/s40279-025-02344-w),
  tiers from its preprint); the cap **(H)**, for fatigue and time; the
  per-session limit **Weak** ([Remmert 2025](https://doi.org/10.51224/SRXIV.537),
  a preprint). The numbers come from `review --plan`, never by hand.
- **The priorities are the coach's confirmed list** (`intake.md`, "The
  coach's priorities"; decided again in step A, item 2): the muscles in
  `priorityMuscles`, in their order, keep the priority tier. The user's
  wish is one input to it, never the list by itself. A request heard later
  ("I want abs") is a new wish: the coach weighs it against the list's
  evidence and proposes where it lands, with its reason, for the user's
  yes (a change to the plan, `plan-files.md`, "A change to the plan").
  **When they won't fit the week** (each is 10 to 16 direct sets a week;
  with 3 or fewer lifting days or 30-minute sessions, 1 or 2 fit:
  `volume.priority-room`, **(H)**), the coach proposes which come first
  this phase, in step A before any design, each with its reason, and says
  the cost of keeping them all ("all N make every session longer"); only
  those go in `priorityMuscles`, the rest under the Athlete profile's
  **Later priorities** (the next phase review weighs them again; step A,
  item 2, says how each kind is parked). The same when `check --plan` warns
  `priority-room` on a draft: the effective priority muscles (the
  profile's, the declared regions' muscles and the confirmed lagging areas)
  are more than the week holds, and never silently kept.
  Keep more only when the user chooses longer sessions knowingly, with an
  override giving that reason; a priority trained only on the short
  sessions (abs and obliques on cardio-and-core days) doesn't use the
  lifting days' room, but one with direct sets on a lifting day does,
  whatever the short days add (a push-up item on a short day doesn't excuse
  a chest priority). A priority
  muscle's **minimum counts only direct sets taken near failure**: sets
  where it is a main muscle, at 0–3 RIR, holds at 75% or more of the user's
  tested best **(H)**, ladder items at the user's level. Half credit from
  compound lifts and easy holds doesn't fill it (`check`'s `priority-under`
  counts it that way). Abs are trained like any muscle: a loaded movement
  with a rep range and double progression (cable crunch, ab wheel, hanging
  knee raise), not only holds.
- **The goals' candidates (H):** where the coach starts when it weighs a
  goal (`intake.md`, "The coach's priorities"), not a list of its own. For
  a muscle or recomposition goal, the posture emphasis's muscles (upper
  back, lats) and then the large ones (quads, lats, chest, glutes), 3 for a
  first goal and 2 for a later one, and no more than the week has room for
  (3 with 4+ lifting days, 2 with 3, 1 with 2 or 30-minute sessions)
  **(H)**. The findings, the self-check, pain, the history and the wish then
  move them up, down or later. Each priority is named with its evidence in
  the audit, and the confirmed list is in `profile.json` `priorityMuscles`
  before step B (step A), so `check`, `review` and the screens hold them to
  the priority tier. A confirmed lagging area (`lagging-area`) is a
  priority muscle in every count already, and takes one of the list's
  places.
- **Strength goals:** add exposures (the lift twice a week) before sets
  (**Moderate**, [Pelland 2025](https://doi.org/10.1007/s40279-025-02344-w)).

## 6. Progression rule per lift

Each logged lift's rule is a standing rule in its `lifts` entry
(`progression`; formats.md, "The plan's standing rules"), beside `lo`, `hi`
and `inc`; the engine does its arithmetic and cites it.

- Double progression by default (`rule: "double"`): `lo`–`hi` and `inc` (a
  step that exists: +5 lb dumbbells, +10 lb cable and leg press stacks, +5 kg
  barbell or +2.5 kg with small plates). Adding reps matched adding load
  (**Moderate**, [Plotkin 2022](https://doi.org/10.7717/peerj.14142)).
- **The gym's real weights.** Each `inc` is a step the gym's kit makes, read
  from `profile.json` `loads` (`formats.md`, "`loads`"): the dumbbells' step,
  two of the smallest plate on a bar, the stack's step. `check` warns
  `step-not-in-gym` for one the kit can't make, with the step to set. At a
  plan run whose profile has no `loads`, ask once, in one question for the
  whole kit: "What weights does the gym have: the dumbbells from the
  lightest to the heaviest and the step, the bar and the smallest plate, the
  machine and cable steps, any kettlebells?" Write the answer into `loads`
  (and the Athlete profile's Equipment) on the user's yes; "I don't know"
  leaves it out, and the targets round to `inc` as before. With `loads`, every
  target the engine gives lands on a real weight, and at the heaviest the
  weight holds while reps carry the progression, so a lift near its kit's
  heaviest weight wants a wider rep range.
- The equipment sets the method (`rules.md`, Progression, "By equipment")
  **(H)**: `linear` for novice barbell lifts, `hold` at a load ceiling, a
  coach-set `target` where the coach wants a number.
- What a miss and a stall do (`onMiss`, `onStall`) is the coach's too.
- Calisthenics: the ladders (top of the range on every set, two sessions
  running → next level).
- Load-jump guide: one increment per lift per session **(H)**; about 10% a
  week at most ([ACSM 2009](https://doi.org/10.1249/MSS.0b013e3181915670)):
  under the lift's own rule a bigger step is reported (`check`'s
  `load-jump`), not capped.

## 7. Conditioning

- On non-lifting days, or 3+ hours after lifting, lifting first when they
  share a session; a 5–10 min easy finisher after lifting is fine. Cardio
  doesn't cost muscle or maximal strength; same-session work costs
  explosive and trained lower-body strength (**Strong**,
  [Schumann 2022](https://doi.org/10.1007/s40279-021-01587-7)).
  `review --plan`'s `concurrent` flags the draft's week on the user's real
  week.
- **In the user's own modes:** the conditioning days rotate the cardio the
  user chose (`preferences.cardio`), never one mode three times when they
  named several; at the short days' minutes when some days are shorter
  (`availability.shortSessions`). Easy cardio fills minutes for those who
  like it, not as a better intensity (**Weak**,
  [Storoschuk 2025](https://doi.org/10.1007/s40279-025-02261-y)); cycling or
  low-impact modes when legs are a priority.
- **Interval formats are the coach's.** One 4×4 interval session a week
  when screening allows vigorous work and a goal asks for conditioning or
  health, or the user chose intervals as a mode (**Moderate**,
  [Helgerud 2007](https://doi.org/10.1249/mss.0b013e3180304570)); never the
  day before a heavy lower-body day (the concurrent rule). The structure goes
  in the item's `timed` field (`{minutes, rounds, workMin, restMin}`), with
  `sr` at the same total; the engine counts its minutes from it.
- Weekly active minutes 150–300 (vigorous counts double;
  [Bull 2020](https://doi.org/10.1136/bjsports-2020-102955), WHO) and a step
  target that rises by phase **(H)** (`evidence --topic activity`).

## 8. Calibration week first

Week 1 of a new plan, and the first week after a 3+ week break: for every
weighted exercise, find a load that leaves 3 reps in reserve at the bottom
of its range; for each ladder, the level where the bottom of the range is
clean. No progression decisions and no stall checks that week **(H)**:
people misjudge the reps left by about 1
([Halperin 2022](https://doi.org/10.1007/s40279-021-01559-x)). The coach
writes it as the plan's `rules.calibration` (`evidence --topic
calibration`); the engine applies it: the week's strength items carry RIR 3
or more, `review`'s `lifts[].next` is the calibrated target (action
`calibrate` at the bottom of the range, holding the last weight) with what
progression would have given in `heldProgression`, and no stall is called.
A restart's calibration week runs 7 days from the first session back. Plan
week 1 is the Monday-to-Sunday week the plan starts in, so a plan started on
a Saturday calibrates for two days. Intervals that week are easy steady
cardio for the same minutes, "easy, conversational; the intervals start in
week 2" (`rules.calibration.cardio: "easy"`, **(H)**): the week's hard
efforts are the lifts being calibrated. Write plan-data's ordinary loading
week; never put the calibration RIR or a week-1 version ("Week 1: 22 min
easy instead") into its notes (`check` warns `week-override-in-note`).

## 9. Check-ins and tests

Write the schedule into the roadmap note's Check-ins table: weekly letter
(Sundays), the tape every second Sunday, photos on each light week's Sunday
(the `progress` job) and, when `rules.tests` lists weeks, on each test week's
Sunday too, tests at each phase's end (the plan's `rules.tests`; by default
the Saturday of the phase's last light week), the RIR calibration
set in each mesocycle's last loading week, the mesocycle review on each
light week's Sunday, the phase review at each phase's end, re-screening by
the profile's `screened` date + 12 months. Health markers stay on the user's
clinician's schedule; the roadmap only reminds.

**Every row says where it happens**: Pahlavan, or the exact command
(`/fitness-coach checkin` for the letter, `/fitness-coach review` for both
reviews, which replace that Sunday's letter), so the user always knows when
to talk to the coach. Under the table, one line of the any-time reasons
(pain or an injury, travel or missed sessions, missing equipment, a stalled
lift, a new goal, tracking something new, a question about the numbers).

## 10. Targets with predictions

For each goal, a target and a **predicted value** at the phase's end, with a
range (for example "waist 93 → 90–91 cm by week 16"; "bench e1RM +5–10%").
The phase review (`review.md`) scores predicted against actual, so every
target needs a number and the code that will measure it.

## Pre-mortem

Asked in step A, before any design: "Picture week 6: this plan has failed.
Why?"

1. The coach lists 3 likely failure modes from the data (for example: a
   7-session week against 4.8 actual training days; sleep under 6 h most
   nights; a known crunch month; logging friction; an active Ledger entry).
2. Ask the user for theirs, in plain text, in step A's one message; start
   from the bad-week answer in the profile ("you said a bad week means
   skipped sessions: anything else?"), and wait for the answer.
3. Each failure mode gets a countermeasure built into the plan in step B: a
   smaller minimum week, Express as the default on busy days, an if-then
   plan, a light week placed over the crunch week, a swap.

The pre-mortem goes into the roadmap note (its own section) and the Decision.

## The standing rules (with every plan)

The coach writes the plan's standing rules into the draft with the plan,
and revises them at the check-ins (`checkin.md`): `rules` (`calibration`,
`lightWeeks`, `tests`, `readiness`, `soreness`, `missed`, `stall`, `hotel`),
each logged lift's `progression`, and `express.short` (formats.md, "The
plan's standing rules"; `evidence --topic standing-rules` gives each kind
with the default it falls back to). The engine only does each rule's
arithmetic, and every target and adjustment it shows names the rule. A rule
left out is Pahlavan's old default, listed in `review`'s `legacy-default`
warning: write it rather than leave it to the default. Each rule is a
decision with its reason in the proposal (a light week every 5th week:
"your recovery answers held up over the last block; surveyed athletes take
one every 5.6 ± 2.3 weeks, Weak").

## Overrides and plan rules

- **Going outside an evidence range needs a stated reason.** When the plan
  goes past a `check` warning on purpose (upper back past the cap for a
  posture block, a 45-second rest on anti-rotation holds), the draft gets an
  override (`overrides: [{code, item, reason, decision}]`, formats.md, "The
  plan's overrides") with the reason in a sentence the user would
  recognise, and a Decisions entry. The check then shows the warning as
  information with the reason. An override never clears a hard error, and
  one without a reason is one.
- **The user's plan rules are kept.** The Standing plan rules in the Athlete
  profile come first in the design; the ones the engine can check are
  `profile.json` `planRules` (sets per exercise, what every lifting session
  holds, core on short days), and `check` warns `plan-rule` for each break.
  A break is fixed, or proposed with its reason for the user's yes (and an
  override once they agree).

## The personalization audit (before the proposal)

A table, every intake input against the decision it drove or why it was
left out. It is what makes the plan this user's, and the proposal's first
item comes from it. The coach writes it from the profile.

**Read the Athlete profile's Standing plan rules first** (sets per exercise,
the session structure, the tools the user prefers, a load ceiling, where the
core work goes, each with its source and date): each one is met in every
session, or the proposal names the rule it breaks and why, for the user's
yes.

| Input | Value | What it did in the plan | Evidence |
|---|---|---|---|
| each Standing plan rule | the rule, its date | met in every session, or the deviation, its reason and the user's yes | the user's rule; preference between equals **Moderate** |
| each self-check result | the number or the result, and the user's answer | a ladder level, an exercise in or out, a regression, a warm-up line | **(H)**, the thresholds |
| each Body-assessment row | what was seen, and the user's answer | its emphasis applied, declined (warm-ups only), or "no change; the tape measures it" | **(H)**, posture as capacity |
| each goal, in order, with its measure | kind, importance, confidence | the modifier, the phases, priority muscles, a target measured that way | the goal modifier's source and grade |
| each priority, in its order (the coach's confirmed list) | the muscle or region, the date decided, and the evidence it rests on: the finding, the self-check result, the goal, pain, the history or the wish (`intake.md`, "The coach's priorities") | its direct sets near failure (`review --plan`), the movement that serves it (for a region, the one that biases it), its place in the session | the priority tier **Moderate**; which muscles **(H)**; a region's grade (`rules.md`, "Regions") |
| the user's wish | the user's words, the date asked | where it landed (kept, ranked lower, later, or the nearest supported option) and why | the user's own answer |
| availability | days, minutes, short days, fixed days | the split, the session length, where conditioning goes | splits equal at matched sets **Strong** |
| preferences | exercises, cardio modes, splits, and a reset's or a redesign's keep-and-change answers, each the user's own answer with the date asked | ranked or left out, the conditioning modes, a comparison factor, what changed and what was kept | preference between equals **Moderate** |
| the bad-week answer | the user's words | the split's skip risk, the minimum week, the first pre-mortem risks | skip risk **(H)**; the minimum week **Moderate** |
| equipment, tracking level, screening, the Ledger | | what each allows or rules out | free weights equal machines **Moderate**; the safety rules |

The Evidence column is one clause: the source (`rules.md`) and its grade, or
**(H)**.

- **Every input gets a row.** "The default" or "the engine picked it" is
  never a reason. An input that changed nothing says what it is for ("age 42:
  under 65, no older-adult changes"; "fat at the waist: no change to
  exercise choice; the tape measures it").
- **Each Body-assessment row shows its effect** in the table; the Body
  assessment itself stays as written in the Athlete profile.
- **The preferences row is the user's answers**, from the intake's Round 5
  and step A's item 5, each with the date asked; never the shape of a
  previous plan (its split, its exercises) read as a preference. A
  movement the old plan held is a like only when the user said so.
- **At least three candidates compared** (step 1), the scoring table and
  the pick argued from the user's data right under it, then the splits
  left out, one line each (step 1.3).
- An input that should have changed the plan and didn't (a self-check
  result with no effect, a cardio mode never used) is a gap: fix the draft,
  or say why it stays.

## Measuring on the vault's map

Sets per muscle use one set of muscle tags everywhere (Review, Progress,
Plan, the movement guide, `check`): **a movement the engine's
catalogue knows counts with the catalogue's tags**, so a face pull counts as
upper back first and shoulders second, whatever the guide's copy says. The
guide's `muscles` count only for a movement the catalogue doesn't know, or
when the entry gives a reason to keep its own: `"override": "<why>"` inside
its `muscles`, beside at least one main muscle (`formats.md`; any other
override is ignored, with `muscle-tags-override-ignored`). Either way the
tags sit on plan-data's 14 groups (an engine muscle without a group, the
adductors for one, goes to the nearest), and a muscle in `main` never counts
again as a helper. `review` warns `muscle-tags-differ` for each guide entry
whose copy disagrees (as sets) and lists the overrides in
`muscle-tags-overridden`.

- **Every candidate and every hand edit is measured as a draft:**
  `review --plan <draft>` reads it exactly as the written file will be read,
  so its numbers are the ones Pahlavan will show once it is written.
- Every muscle inside its tier (priority 10–16, the rest 5–10, none under
  4, none over 20–24, at most 8 direct sets in a session), each priority
  muscle's minimum met by direct near-failure sets (step 5), the regions'
  coverage (step 4), pull:push against `volume.pullPush`'s target and
  floor (about 2:1 with the posture finding applied). A muscle outside its
  tier is fixed (a set moved, an exercise swapped) or named in the proposal
  with its reason and an override.

## The proposal (one message)

Step C, only after step A's answers ("The order" above): the proposal
builds on them and asks for its yes, not for what step A should have asked
(desk breaks keep their own question after the yes, item 14).

**A phase review's proposal opens with two sections before item 1**
(`review.md`, Phase review, step 6): **What the last phase taught us**
(the few findings that drove the verdicts and each change to the
priorities, each with its number and source) and **How the next phase
serves the long-term plan** (the next phase's aim and targets from the
roadmap, and how this design moves toward them and the week-24 targets).

**Each major decision** (the split, sets, effort, reps and load, rest,
exercises and order, range of motion, progression and the standing rules,
conditioning, the light week, the minimum week) **carries two short
clauses:** its reason from the user's data and its evidence with grade
("upper/lower: 4 free days of 60 min, and you liked it; splits are equal for
growth at matched sets, Strong").

1. **How your data shaped this plan:** the personalization audit's rows
   that drove decisions (the self-check, the Body assessment with the
   user's answers, the goals in order, the priorities each with its
   evidence and where the user's wish landed, the bad-week answer, the
   preferences), and the candidates compared (step 1) with why
   this one won, each number quoted from its `review --plan` or `check
   --plan` run with the command named; then **the splits left out**, one
   line for each family not built, on why it doesn't fit this person
   (step 1.3). A finding from outside the library
   is labelled so ("The gap-search rule"). **With a plan as written, what
   changes from your current plan and what's kept, and why** (step 1.7):
   the share of the new plan's movements also in the current one (`overlap`'s
   `draftInCurrent`, the command named) and, over half, its reason; for a
   redesign, each logged lift the plan drops or could keep with its
   trade-off, for the user to choose, and the calendar kept or a new block
   begun, with its reason; for a phase review, each current movement's
   keep or change verdict with its reason from the data.
2. Phase map: phases, mesocycles, light weeks, test weeks, with dates.
3. The week: sessions, minutes, days (if fixed), the minimum week.
4. Each session: main lifts and accessories, sets × reps, RIR, rest; each
   ladder item with its starting level; interval formats; **each exercise
   with its one-line Why** (the intake fact, Body-assessment row, goal or
   rule it comes from).
5. Sets per muscle and per region a week (`review --plan`) against the
   tiers and the coverage rule; any region in the user's wish that the
   evidence doesn't support, with the nearest option.
6. The standing rules: each lift's progression, the calibration week, the
   light weeks, what a low-readiness day, missed time and a stall do.
7. The overrides: each `check` warning the plan goes past, with its reason.
8. Conditioning and the step target.
9. Check-in and test schedule.
10. Targets with predicted values.
11. Pre-mortem: the failure modes (the coach's, and the user's from step A)
    and each one's countermeasure.
12. What gets written: the files below, and what's archived.
13. What Pahlavan can't express (from the limits below), and how the
    letters cover it.
14. Any tracked item the plan changes: `tracking.md` (written with `track`,
    step 6 below). **Desk breaks are not part of this yes:** for desk work
    only (`profile.json` `work.desk`), they get their own question after
    the plan's yes ("Desk breaks: a 5-minute routine every 90 minutes,
    10:00 to 17:00 on work days, fitted to your hours. Want them?": yes,
    other times, or no). On a no the plan has no `deskRoutine` and
    nothing is tracked.

Ask once. Changes are discussed and the proposal re-shown; nothing is
written before the yes.

## Writing it

On the yes, through `plan-files.md`, in its order:

1. `plan-data.json`, from the pick's draft: `check --plan` clean of hard
   errors, every warning fixed or overridden with its reason, `review
   --plan` giving the proposal's numbers, the diff from `plan-write` shown,
   then `plan-write --write` (a redesign's `check --plan` and `plan-write`
   with `--redesign`, step 1.7), and `check` once more on the plan as written
   (`plan-files.md`, step 3). Then what `Coach/local.md` says runs after a
   plan change ("A change to the plan").
   - **The start:** a fresh start's or a reset's draft has the date from
     step A; any other keeps the file's (formats.md, "The plan's start").
   - **Every item's `note` ends with "Why: ..."** (the proposal's line for
     it, under about 25 words), cardio and core items included: `check`
     warns `no-why` for any that lacks one. The user reads the reason
     wherever the item shows, so a plan never looks like a template.
   - **The plan's `why`, the Why this plan card:** before `plan-write`,
     the pick's draft gets the coach's reasons for the plan as a whole,
     which Pahlavan's Plan tab draws under the timeline (the last key,
     after `overrides`; its shape: `plan-files.md`, "The Why this plan
     card"). They are written to the person, in the coach's own voice
     ("you", "your": "your shoulders roll forward, so every session pulls
     before it pushes"), from the proposal's audit rows and comparison, and
     claim nothing the proposal didn't (every number the proposal's, from
     its `review --plan` run):
     - `date`: the day it is written;
     - `lead`: the plan in one breath, 1 to 3 sentences;
     - `reasons`: 3 to 7, each a `title` under about 8 words and a `text`
       under about 40, with its `grade` where the evidence has one
       (`strong`, `moderate`, `weak` or `heuristic`: the rules'
       **Strong**, **Moderate**, **Weak** and **(H)**), and none where the
       reason is the person's own (a Standing plan rule, their wish);
     - `split`: `picked`, the pick's family and why it won; `compared`,
       each other candidate's family and why it lost; `leftOut`, every
       other family with its line from step 1.3. Every family is named
       once: `check`'s `why-split-missing` lists any the card leaves out;
     - `decision`: the heading of step 5's Decision entry ("2026-11-09 ·
       Redesign").
     `check --plan` on the pick shows no `why-shape` (a hard error: the
     card can't be read as written) and no `no-why-card`, and the card's
     text is shown with `plan-write`'s diff. The candidates skip the card
     (step 1.4): only the plan that is written has it.
   - **Names:** in a running plan (the next month, a phase review's next
     block, a change), a movement the plan or the log already names keeps
     that name (`Flat DB Bench Press`, not the catalogue's `Flat dumbbell
     bench press`), with its existing `guide` entry, its `lifts` entry and
     the name the log holds. Never rename a logged lift: its history (e1RM,
     stalls, Pahlavan's Last) is matched by name. A redesign
     sets this aside except for what Reconcile keeps (step 1.7): a logged
     lift it keeps keeps its logged name, so its history still matches;
     every other movement has the name the coach gives it.
   - **Targets:** `Coach/profile.json` has `targets` for this plan
     (`plan-files.md`, step 4).
   - **Ladders:** each ladder the plan carries has its starting level as
     `"startLevel"` in the draft (formats.md, "A ladder's starting level"),
     so the draft's `check --plan` and `review --plan` count its items at
     that level, not the lowest (a pull-up ladder read as dead hangs
     undercounts the lats and biceps; `ladder-start` warns when one has no
     start). The same level goes into the log with `log ladder --id <id>
     --level <level> --date <the plan's first day> --write`, inside the
     same yes.
   The roadmap gets a **"How your data shaped this plan"** section (the
   personalization audit table with its Evidence column, the candidates
   compared and under them **The splits left out**, one line each from
   step 1.3, the weekly sets and any override with its reason), above "How
   the plan is built".
2. **The roadmap note** ("A new roadmap"): the current `6-Month Roadmap.md`
   archived, the new one written under the same file name with its section
   names kept and the pre-mortem added; the targets in `Coach/profile.json`
   `targets` with the roadmap's Targets table (`plan-files.md`, step 4).
3. The month note for the first four weeks (the next-month recipe), with the
   Week by week table showing the calibration week, the light week, tests
   and check-ins.
4. The training calendar, last (see the limits).
5. A Decision entry: trigger "intake" or "reset" or "redesign" or "phase
   review", the data, the rules applied, the overrides with their reasons,
   the expected effect, the review date (the first mesocycle review), and
   the splits left out, one line each (step 1.3); its heading is the
   card's `decision` (step 1). A
   redesign's also gives the overlap with the plan as written (`overlap`),
   the logged lifts kept or dropped as the user chose, and the calendar
   kept or a new block begun, with its reason. A phase review's gives each
   movement's verdict (kept or changed, with its reason) and the share
   kept (`overlap`).
6. **The tracked items**, one `track apply` (`tracking.md`, "The tracking
   file"; the dry run with the other writes, `--write` inside the same yes):
   - the desk-break item when the user said yes to desk breaks (step 14)
     and none is tracked:
     `{"kind": "desk", "name": "Desk breaks", "desk": {"followPlan": true},
     "why": "...", "from": "plan"}` (its routine follows the plan's
     `deskRoutine`, its times and days the plan's `deskTiming`); none when
     the plan has none;
   - what the plan changes on an item (training days only, say): the item's
     `id` with the new `schedule`, a change from today;
   - `bodyRecord: {"schedule": "plan"}` when it isn't set (the tape, photos
     and tests then follow this plan's calendar);
   - `bringOver: []` when nothing is recorded yet (a fresh start: Pahlavan's
     bring-over offer never shows).

## Mapping onto `plan-data.json`

| Plan decision | Field | Notes |
|---|---|---|
| Sessions a week | `weekTarget {lift, short}` | Session types rotate regardless of the count: 3 a week over A–D is fine |
| Session types | `liftTypes`, `shortTypes`, `titles`, `shortNames`, `focus` | Adding or removing a type touches every one of these; a session neither list names is never shown or counted (`check`'s `session-unlisted`) |
| Exercises | `sessions.<T>[]` items `{name, table, sr, rest, rir, timed, note, label, logged, ladder, pair}` | `logged: true` on exactly two items of each lifting session; `pair: true` on a superset's second item (done with the item before it) |
| Sets × reps | item `sr` (`"4 × 6–8"`, `"3 × 8/leg"`) | The light week's version comes from `rules.lightWeeks` |
| Cardio, intervals | item `sr` (`"20 min"`) and, for intervals, `timed` (`{"minutes": 30, "rounds": 4, "workMin": 4, "restMin": 3}`, `formats.md`) | `sr` at the same total; the engine's sets are the rounds; the calibration week makes intervals easy by `rules.calibration` |
| Rep range, step, progression | `lifts.<name> {lo, hi, inc, db, unit, progression}` | Logged lifts only; a changed range needs `lo`/`hi` changed too; `progression` is the lift's standing rule |
| RIR target | item `rir` (`2`, or `[1, 2]` for a range) | Not in the note: an old note's "RIR 2." is read only without the field. The user's calibration bias lives in the Athlete profile and `profile.json` (`rirCalibration`) |
| Standing rules | `rules {calibration, lightWeeks, tests, readiness, soreness, missed, stall, hotel}`, `express.short` | formats.md, "The plan's standing rules" |
| Going past a warning | `overrides [{code, item, reason, decision}]` | formats.md, "The plan's overrides" |
| Why this plan (the card on the Plan tab) | `why {date, lead, reasons, split, decision}`, the last key, after `overrides` | Written on the pick's draft before `plan-write` ("Writing it", step 1; the shape: `plan-files.md`, "The Why this plan card"); `engine draft` never carries it, and a change inside the plan keeps it, rewriting only the reasons the change touches |
| Temporary change | `until YYYY-MM-DD: <why>` at the start of the item's `note` | `review` lists it when due |
| Express (20 min) | `express` | Applies to every lifting session; `express.short` to a short day |
| Light-week S3 | `deloadS3` | What S3 becomes in a light week |
| Calisthenics | `ladders` (each with its `startLevel`), `laddersFor`, `ladderNote`, item `ladder` | `startLevel` is the level this plan starts the ladder at, counted until the log holds a level (formats.md, "A ladder's starting level"); levels move with `log ladder` (`log.md`) |
| Movement guide, muscles | `guide.<name> {setup, do, avoid, q, muscles}` | Required for any new movement; for a catalogue movement `muscles` is a copy of the catalogue's tags on plan-data's 14 groups (the adductors and abductors as glutes, the neck as upper back, the tibialis as calves; a helper already in `main` left out), unless it carries an `override` reason (`formats.md`); for a movement outside the catalogue its `muscles` and `regions` are the ones that count |
| Warm-ups, desk routine | `warmups`, `deskRoutine`, `deskTiming` | `deskTiming` `{every, from, to, minutes?, days?}` sets when the routine runs (`formats.md`, "`tracking.json`"), fitted to the user's working hours: for a 9-to-5, `{"every": 90, "from": "10:00", "to": "17:00"}` (10:00 to 16:00 at every 90 still stops at 14:30). Left out, Habit Nudges' 90 minutes, 10:00 to 15:00 apply. A bad value is a `plan-data` warning in `engine tracked` and `review`, and the usual times |
| Start date | `start` (YYYY-MM-DD) | The week holding it is plan week 1 (formats.md, "The plan's start"); a fresh start or a reset writes it; a phase review, the next month and any change keep it (`check`'s `start-changed` otherwise) |
| Phase names | `phases [{name, goal?}]`, in order | Optional; without it Pahlavan says "Phase 1"; keep it matching the roadmap's Phases table |
| Targets | `targets` in `Coach/profile.json` (`formats.md`) + the roadmap's Targets table | Together, on every new or changed plan; one the schema can't hold (the wall gap) stays in the roadmap |

## What Pahlavan can't express

`plan-data.json` holds one rotation of sessions and its rules. The standing
limits (`engine --version --json`'s `facts.unexpressible` names each kind
of thing it can't hold):

- **One rotation at a time.** Later months and phases (an accessory
  rotation, a new phase's rep ranges) are written when their month comes,
  through `plan-files.md`, "The next month"; the roadmap and the month notes
  carry the sequence.
- **Swaps have no field.** An item's alternatives (for a busy gym, a
  travel week) go in its note or the month plan; Hotel swaps come from the
  catalogue's starter movements by `rules.hotel`.
- **Targets exist for the logged lifts.** e1RM, stalls and next targets
  come for the lifts with a `lifts` entry (two logged a session);
  accessories progress by their range and the check-in.
- **What `Coach/local.md` names** (a calendar, a weekly review) may assume
  the week's shape; after a resize, say what reads against the old one.
