# Ad hoc: travel, a short day, another session, sick, pain, sore, missed weeks

Part of the `plan` job. A change longer than a day goes through
`plan-files.md` as an `until YYYY-MM-DD: <why>` temporary change, with a
Decision; a one-day change (Express, a scaled session) needs neither. Red
flags first, always (`intake.md`).

## Travelling

- About **a third of the usual volume, kept heavy**: same RIR, same main
  movements or their nearest equipment match. Strength holds over a short trip
  on that dose (Spiering 2021, `rules.md`).
- 2–3 short full-body sessions (20–30 min): a squat or lunge, a hinge, a
  press, a pull, one core move. Hotel gym: dumbbells or machines. Bodyweight
  only: the ladders (push-up, pull-up or inverted row on a table edge,
  single-leg squat, core), harder levels in place of load.
- **The session:** `engine.cjs session --vault . --json --mode hotel` gives
  the day's session with each movement pattern kept, using only bodyweight,
  light dumbbells and bands, every swap screened against the Ledger and
  given its reason. With lighter equipment it shifts the reps up and takes
  the RIR one lower (within the screening caps): closer to failure keeps the
  stimulus when the load can't. Record the trip as a `knownBusy` travel at
  the check-in (`checkins.json`): for a week or more away the session drops
  to about a third of the sets.
- Logged as `custom` with a label (`log.md`); the rotation resumes where it
  stopped. A week or more away: an `until` change, and the first week back
  follows the missed-time rule if training stopped.

## Short day

The Express version (`express` in `plan-data.json`: its warm-up, the two main
lifts at 2 working sets, 2 sets of the second, the face-pull finish; about
20 min), logged with `express: true`: `engine.cjs session --vault . --json
--mode express` prints it with the day's targets, readiness and soreness
applied. When a short day disappears, let it go; lifting comes first.

## Another session today

"I want to do C today": `engine.cjs session --vault . --json --type C`
(any of the plan's sessions: `A`, `B`, `S1`, ...) builds that session with
today's targets, readiness, soreness and the Ledger applied, as the
rotation's own pick would be; `session.suggested` names the one the rotation
had, and `--mode express` still works with it. A one-day change: no plan
write and no Decision. It is logged as that type (`log.md`), and never
stacked on another lifting session the same day (`rules.md`, "Missed time").

## Sick

The neck check **(H)**:
- Symptoms only above the neck (runny nose, sneezing, mild sore throat) and
  no fever → an easy session if they feel up to it: half the sets, RIR +3, or
  20–30 min Zone 2.
- Fever, body aches, chest symptoms or stomach illness → no training until a
  day after the fever is gone and the symptoms ease; then 1–2 easy sessions
  before normal loads.
- Resting HR 7+ bpm over baseline for 2 days (`numbers.md`, readiness) gets
  the same answer: no hard training.
- The day itself is recorded by the user: **I'm ill today** on the morning
  check-in (the Check-in screen or the morning card) saves `illness` for
  that day, and readiness's `no-hard-training` follows. The coach never
  writes it.

## Pain

1. Red flags first (`intake.md`): refer, stop.
2. Otherwise the **pain rule**: up to 3/10 during the exercise and settled by
   the next day → fine, carry on and note it.
3. More than that, or still there the next day → change the load, the range,
   or the exercise (a lower IAP tag, a pain-free variant), and keep training
   everything else.
4. Persisting (about 2 weeks) or getting worse → "see a professional"; the
   plan works around it meanwhile.
5. A Ledger entry either way (`formats.md`); a constraint lasting beyond the
   day becomes an `until` change. Describe; never diagnose or name a cause.
6. A logged pain with no severity (a pain skip whose slider wasn't moved):
   the engine's verdict is `ask`. Ask how bad it was, then apply the rule
   above; never assume a number.

## Sore or tired today

The readiness band (`numbers.md`) and the user's word: low → one set fewer
per exercise and RIR +1; normal soreness alone is no reason to skip. Under 6 h
of sleep: no tests or PRs that day. `engine.cjs session` applies both: the
readiness trim, and the morning body map's sore muscles (a sore main muscle:
one set fewer and RIR +1; sore two days running: a lighter variation; mildly
sore: a note), each with its reason.

## Missed weeks

Ask first whether it was unlogged. Then: one session missed → the next in the
rotation, never two in a day; 1–2 weeks off → first week back 5–10% lighter
and RIR +1; 3+ weeks off → restart the mesocycle with a calibration week. No
streak-shaming: say what's next, not what was lost.
