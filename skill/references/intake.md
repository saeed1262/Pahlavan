# Intake: the fresh start

For a new athlete or a reset. It's the same for everyone, as a coach meeting
someone for the first time: talk, screen, then look at the body and how it
moves. The output is `<fitness>/Coach/Athlete profile.md` (format in
`formats.md`), with its Body assessment, plus Ledger entries, and next to them
their machine-readable twins `Coach/profile.json` and `Coach/ledger.json`
(schema v1, `formats.md`), which the engine's `plan` and `review` read.

## How to run it

1. **Fresh, for everyone.** Don't read old intake forms, logs, body data,
   daily notes or an earlier profile before or during the interview, and
   don't turn old facts into confirmations. Old data pulls the plan toward
   continuing what was done; a fresh start asks. (The one exception is the
   opt-in question at the end.)
2. **The order:** Round 1 screening, Round 2 basics and goals, Round 3
   success and the week, Round 4 constraints, equipment and tracking, Round 5
   body history and preferences, then the **body assessment** (photos and the
   movement self-check), then the history question.
3. **Ask in short rounds** of at most 4 questions. Screening is always
   round 1. Each question takes the form its answer needs (the question
   design below).
4. **Leave a field "unknown"** rather than adding a round for it. The
   Ledger follow-ups (Round 5) are the only extra questions.
5. **Show the profile as a short summary**, the Body assessment included,
   and write it on the user's yes, with the Ledger entries: the Markdown and
   the JSON together, the same facts in both. Check each JSON file with
   `node .claude/skills/fitness-coach/scripts/engine.cjs validate <file>
   --json` before saying it's written (fix and re-check on exit 1; read its
   `warnings` for free-text equipment or ids the engine doesn't know).
6. **The first tracked items** (`tracking.md`): its questions first (desk
   work, a standing desk, sleep and wake time, supplements and medicines; one
   round; the desk answer also goes into `profile.json` as `work`), the
   safety screen, then the proposal (at most 3 items, one message, one
   multi-select AskUserQuestion). Write them with **one `track apply`**
   (`tracking.md`, "The tracking file"): the accepted items (`add`, each with
   its Why and its linked habit), the declined ones (`decline`), the
   morning check-in at the user's time (`morning`), the body record following
   the plan (`bodyRecord: {"schedule": "plan"}`), and `bringOver: []` (a
   fresh start: nothing comes over from an older reminder plugin, and
   Pahlavan never offers it). After the selection, run it as a dry run and show its
   `results` (the items, the morning time, the body record, the fresh start)
   in one short list; `--write` on the yes, one question for the whole
   write. That write sets Pahlavan up; in a vault with the Habit Nudges
   plugin, it hands its health reminders over (the output's `handOver`
   note): say so in one line. If the user accepts no item, the bring-over
   record alone doesn't set Pahlavan up.
7. **The cycle's Baseline note** (`engine.cjs baseline`: `numbers.md`, "The
   baseline note: `baseline`"). The intake is a fresh start, and the cycle
   start, week 1, readiness's 14 mornings and every "This cycle" view count
   from the newest `<fitness>/Baseline - <date>.md`, so the intake
   writes it, dated the intake's day. Run `baseline --vault . --json --date
   <the intake's day>`; when `exists` is false, write its `text` to its
   `path` word for word, in the same yes as the profile (say the note's name
   in the summary). When `exists` is true, a note for that day is there
   already: write nothing. An older note stays as it is (it marks the cycle
   before; `previous` names it).
8. **The cycle's first entries** (`engine.cjs body`: `numbers.md`, "The
   write path: `body`"; the record file in `formats.md`). The intake's
   measurements go into the body log as the new cycle's first entries, so
   Pahlavan's Body record and Progress start from them instead of "not
   yet". One record dated the intake's day (the day of the new `Baseline -
   <date>.md`, step 7): Round 2's morning weight (`morning.weight`, kg) and waist at
   the navel (`tape.waist`, cm). One record dated the self-check's day
   (the same record when it is the same day): its results as the tests a
   phase review repeats, where they are the same test: push-ups
   (`tests.pushups`), strict pull-ups (`tests.pullups`), the hollow hold
   (`tests.hollowS`; a plank is not that test, so it stays out) and the
   wall test (`tests.wallGapCm`). The sit-to-stand, the hang, the hinge,
   the overhead reach and the balance stand have no test of their own and
   stay in the profile; the side plank, handstand and pistol wait for the
   first test day. A number the user didn't give, or a test they stopped,
   is left out, never guessed. Run it as a dry run, show its `results` in
   one short list (what goes in, for which day), and `--write` on the yes.
   A `conflict` means the body log holds another number for that day
   already (a morning check-in saved first): show both, ask which stands,
   and `--replace` only on the user's word.
9. Offer the `plan` job.

### Question design

- **Free-text answers are asked in plain text**, not with AskUserQuestion:
  numbers (age, weight, push-ups, seconds), names (equipment, injuries,
  exercises), a sentence (what success looks like). Group a round's
  free-text questions in one short numbered message and let the user answer
  in one reply.
- **Option questions offer real answers only:** ranges ("30–60 min"),
  presets (the tracking levels), yes or no, a status (gone / managing /
  active). Use AskUserQuestion for these, 2–4 options each, multi-select
  where more than one can be true.
- **Never an option whose only job is to point at Other** ("I'll type it,
  choose Other", "Yes (which?)", "pick this, then I'll ask"). If the answer
  needs words, the question is a plain-text one. Other stays available for
  the user's own answer; it is never the designed path.
- A round may mix the two: the option questions in one AskUserQuestion, the
  free-text ones in plain text in the same message.
- Rounds stay short: at most 4 questions, and a field the user doesn't know
  is left "unknown" rather than asked again.

**A reset** is a fresh start too: move the current `Coach/Athlete profile.md`,
`Coach/Ledger.md`, `Coach/profile.json` and `Coach/ledger.json` to
`Coach/_archive/<YYYY-MM-DD>/` with a one-line `README.md` saying why, then
run the intake as for a new athlete. The old plan stays until `plan` replaces
it. `Coach/tracking.json` stays too: its items carry on, and the coach
revisits them against the new profile (`tracking.md`, "Revisit and stop")
instead of proposing them again.

**The history question (last, opt-in).** If the vault has training history
(`fitness-log-data.json`, `body-data.json` tests), ask once: "You have
training history here. Use it for starting weights, so the calibration week
is shorter, or start clean?" Use it for starting weights only, never to
change an answer the user gave. Record the choice in the profile.

### Adapting follow-ups

- **A red-flag answer** anywhere: stop the interview, give the referral
  wording (below), record the screening outcome as Blocked. No plan talk.
- **Vague answer** ("it varies"): one follow-up with concrete options
  ("Most weeks: 2 / 3 / 4 / 5+ days").
- **Confidence under 7** on a goal: "What would make it a 7?" Design around
  the answer (fewer days, shorter sessions, a different goal order).
- **Any injury or pain mention:** the Ledger follow-ups (Round 5) for it, now.
- **Pain during a self-check test:** stop that test, Ledger entry, pain rule.

## Round 1: screening

Own wording implementing the ACSM pre-participation logic (Riebe et al. 2015).
Ask all four at once.

1. **Regular exercise.** "Over the last 3 months, have you done planned
   exercise at least 3 days a week, about 30 minutes at a time, at a moderate
   effort or more?" Yes / No.
2. **Known conditions.** "Has a doctor ever told you that you have a heart
   condition, a metabolic condition (for example a blood-sugar condition), or a
   kidney condition?" No / Yes, and a clinician cleared me for vigorous
   exercise in the last 12 months / Yes, not cleared. (The three answers are
   the outcome table's rows. On a yes, ask which condition in plain text.)
3. **Warning signs.** "In the last few months, have you had any of these?"
   (multi-select, plus None):
   1. Pain, pressure or discomfort in the chest, neck, jaw or arms, at rest or when active
   2. Shortness of breath at rest or with light effort
   3. Dizziness, light-headedness or fainting
   4. Breathlessness when lying flat, or waking at night short of breath
   5. Swollen ankles
   6. A racing, pounding or irregular heartbeat
   7. Pain or cramping in the calves or legs when walking, easing with rest
   8. A heart murmur you've been told about
   9. Unusual tiredness or breathlessness in everyday activities
4. **The rest.** "Any of these apply?" (multi-select, plus None): under 18;
   pregnant or within a year after giving birth; a new diagnosis, medication,
   surgery or injury since the last screening.

### Outcome

| Regular exerciser | Known condition | Warning sign | Outcome |
|---|---|---|---|
| any | any | yes | **Blocked**: stop exercise, see a clinician before training again |
| yes | no | no | **Go** |
| yes | yes, cleared for vigorous exercise in the last 12 months | no | **Go** |
| yes | yes, not cleared | no | **Conservative** until cleared for vigorous exercise |
| no | no | no | **Go, ramped**: light to moderate effort (RIR ≥ 3) for the first mesocycle |
| no | yes | no | **Blocked** until cleared; then Conservative |

Under 18: not coached. Pregnant or postpartum: referred to their clinician;
Blocked for plan design until they're cleared, then Conservative unless the
clinician says otherwise. A new diagnosis, medication, surgery or injury:
re-run this round.

- **Go:** the normal plan.
- **Conservative:** full body only, effort capped around RPE 6 (RIR ≥ 4), no
  vigorous work (no intervals, no max tests, no calibration sets to failure).
- **Blocked:** logging only. No plan, no progression advice. Re-screen when
  they're cleared.

Offer the [PAR-Q+](https://eparmedx.com/) as a further self-check (link it;
it's copyrighted and must be used unchanged). Re-screen every 12 months or
when health changes; the profile's `screened` date says when.

**Referral wording** (wellness wording: describe, never diagnose): "That's
something to check with a doctor before we plan training. I'll keep logging
going, and we'll pick up the plan once you're cleared." For an urgent sign,
lead with the urgent line below.

## Red flags: stop and refer

These stop coaching for the session, whenever they come up (intake, check-in,
ad hoc). Describe what the user said; never name a cause.

**Call emergency services now:**
- Chest pain, pressure or tightness, especially spreading to the arm, jaw,
  neck or back, or with sweating, nausea or breathlessness
- Fainting or near-fainting during or after exercise
- Sudden severe shortness of breath
- Sudden weakness or numbness of the face, an arm or a leg, trouble speaking,
  or sudden loss of vision
- A sudden, severe headache unlike any before
- A painful, firm bulge in the belly or groin that won't go back in,
  especially with nausea or vomiting
- Numbness around the groin or buttocks, or loss of bladder or bowel control
- Severe muscle pain and swelling with dark (cola-coloured) urine after hard
  training

**Stop training (that area, or entirely) and see a clinician before going on:**
- Any of the 9 warning signs above, new
- A racing or irregular heartbeat, at rest or in training
- One calf painful, swollen, warm or red
- Numbness, tingling or weakness spreading down an arm or a leg
- Pain at night that no position eases, or with fever or unexplained weight loss
- Fever or body aches (no training at all until they're gone)
- A joint that gave way, locked, or swelled quickly after an injury; a pop
  with immediate pain or weakness
- Pain over 5/10, or pain getting worse session after session
- A head knock followed by headache, dizziness, confusion or sickness
- A bulge, pressure or new pain at a known abdominal-wall site

Everything else that hurts goes through the **pain rule** (`rules.md`):
up to 3/10 that settles by the next day is fine; otherwise change the load,
range or exercise; persisting means "see a professional".

## Round 2: basics and goals

1. "Sex?" Male / Female / Prefer not to say. (For the energy estimate and
   strength references only.)
2. "Age, height, morning weight, and your waist at the navel if you can
   measure it?" (plain text; kg or lb, cm or in). The unit they answer in
   is the profile's `units.body` (lb: Pahlavan shows and takes weight in lb
   and lengths in inches; kg: kg and cm); the files
   keep kg and cm, so convert what you write (`body`'s record, the
   profile's numbers).
3. "Which goals matter for the next 6 months? Pick up to 3." Options
   (multi-select): build strength; build muscle; lose fat; recomposition
   (leaner at the same weight); health and longevity; conditioning or
   endurance; calisthenics skills; posture and mobility capacity. Other: a
   sport or event. Then ask the order if more than one.
4. "For each goal, how important is it (0–10), and how confident are you
   that you'll do what it takes (0–10)?" (plain text: "goal: importance /
   confidence"). The order matters: goal 1 sets the plan's goal modifier, and
   a muscle or recomposition goal sets the priority muscles when the profile
   names none (`planning.md`, step 5).
5. With a muscle, recomposition or calisthenics goal: "Is there a muscle or
   a look you care most about? Up to 3, the most important first."
   Options (multi-select): abs; arms; chest; shoulders; back; glutes; legs;
   none in particular. **Each pick is one priority muscle, one engine id**:
   abs, chest, shoulders and glutes map straight; for back, legs and arms
   ask which part in one more question (back: upper back, for rows and
   posture, or lats, for width and pull-ups; legs: quads or hamstrings;
   arms: biceps or triceps), so "back" never becomes two priorities. **More
   than 3 picked, or more than the week has room for** (`planning.md`
   step 5): ask the user to rank them, keep the top ones (up to the room)
   in `profile.json` `priorityMuscles` in that order, and write the rest in
   the Athlete profile as **Later priorities** (a later phase can take
   them); never write past the room. Each priority muscle needs 10 to 16
   direct sets a week, so every extra one makes each session longer. A request heard anywhere else in
   the intake ("I want abs", "more arms") is the same answer: a priority
   muscle, never a note. A look ("visible abs", "a six pack") also gets one
   honest line in the summary: it is mostly body fat, so the goal's measure
   is the waist and the photos, and the priority muscle makes the abs
   bigger and stronger underneath.

## Round 3: success and the week

1. "What would success look like at the end, in something you could
   measure? And is there a date or event it has to be ready for?" (plain
   text). Examples: a waist number, a number of strict pull-ups, a lift at a
   weight, a walk or run without stopping. The measure goes into the goal's
   `measure`; the plan's targets are measured that way.
2. "On a normal week, how many days can you train, and how long is each
   session, warm-up included? If some days are shorter than others, say how
   many and how long." (plain text). The days and the longest session go
   into `availability`; shorter days go into `availability.shortSessions`.
   The long days carry the lifting and the short days the conditioning.

## Round 4: constraints, equipment, tracking

1. "Anything fixed: days that never work, travel or crunch periods you
   already know about? Say which, or none." (plain text).
2. "Where do you train, and with what? List the equipment, and the heaviest
   dumbbell." (plain text). The heaviest dumbbell decides when dumbbell lifts
   need wider rep ranges. Then: "When you travel, what's usually there?"
   (multi-select): nothing, just bodyweight; a hotel gym with dumbbells (and a
   bench?); bands I pack; a pull-up or door-frame bar; kettlebells; machines or
   cables; a full gym; I don't travel. The picks go into `profile.json`
   `travelEquipment` in `equipment`'s words (`[]` for bodyweight only; left out
   for "I don't travel"): Pahlavan's Hotel version uses it.
3. "How long have you trained consistently?" Never / under a year / 1–3
   years / more than 3 years. (A first read of training age; the plan
   confirms it by how fast the user progresses.)
4. "How much logging will you put up with?" (the tracking levels):
   - **Light:** session done, minutes, how hard it felt (1–10)
   - **Standard:** the top set of each main lift
   - **Full:** every set, with reps in reserve
   Never push a higher level. Each level's limits on what the coach can see
   are stated in the profile.

## Round 5: body history and preferences

1. "Any injuries, niggles, surgeries or pain, now or in the past, that still
   affect how you train? Name them, or say none." (plain text).
2. "Exercises you enjoy, and ones you'd rather never do? And any way of
   splitting the week you liked or disliked before (full body, upper/lower,
   push/pull/legs, a body-part split, heavier and lighter days, or another)?"
   (plain text). The splits go into `preferences.splits` with the kinds in
   `formats.md` (eleven, from `full-body` to `calisthenics`), which the
   candidate comparison scores; one that matches no kind stays in the
   profile's Preferences, in the user's words.
3. "Cardio you'll actually do?" (multi-select) Bike / Walking or incline
   walk / Running / Intervals or circuits (a sport, or anything else, is the
   user's own answer in Other). Every mode chosen goes into
   `preferences.cardio`: the conditioning days rotate them.
4. "When a week goes badly, what usually happens?" (multi-select) I skip
   sessions / I cut sessions short / One miss turns into a week or more off /
   Travel or work throws it off (food or sleep going off, or anything else,
   is the user's own answer in Other). The answer shapes the split (skip
   risk), the minimum week and the if-then plans; it goes into `badWeek`
   (`usually` as `skips-sessions`, `shortens-sessions`, `stops-for-a-while`,
   `travel`, `eats-off-plan`, `sleeps-badly`, and `note` in the user's
   words).

**Ledger follow-ups**, for each injury, niggle or surgery named: its status
as one option question (gone / managing / active), and the rest in plain
text in the same message:

1. When did it start?
2. What makes it worse (movements, loads, positions)?
3. What has helped (exercises, rest, treatment)?
4. Has a clinician seen it, and did they set any limits or clear it?

Each answer becomes a `Ledger.md` entry with its plan constraints (format in
`formats.md`); a constraint names movements or tags, e.g. "no high-IAP lifts
until cleared", and the same constraint goes into `ledger.json` (tags such as
`abdomen-high`, movement ids, an `until` date).

## The body assessment

A coach looks before planning: posture, the balance between the two sides,
which areas lag, and how the person moves. The plan's emphasis comes from
here as much as from the answers.

### 1. Before asking

Say what the photos are for and how they're handled, in two lines:
- They stay in the vault, in `<fitness>/Progress Photos/<YYYY-MM-DD>/`.
  To look at them, the coach sends them to the AI model for this
  conversation, as with anything it reads.
- Fitted clothing (shorts; a fitted top or none: the user's choice).

The user can decline. Then say what the plan can't account for (posture and
balance emphasis), and rely on the movement self-check.

### 2. The photo protocol

The same every time, so later sets compare:
- Phone at chest height, about 2.5–3 m away, portrait, the whole body in
  frame; plain background; even light from the front; a timer or a helper.
- Stand relaxed, feet hip-width, arms by the sides, eyes ahead. Don't pose
  or brace.

| File | What |
|---|---|
| `front.jpeg` | Full front |
| `side.jpeg` | Full side profile (left side to the camera) |
| `back.jpeg` | Full back |
| `posture-closeup.jpeg` | Closer front, torso and head |
| `move-squat-side.jpeg` | Bottom of a bodyweight squat, arms forward, from the side |
| `move-squat-front.jpeg` | The same, from the front |
| `move-overhead-side.jpeg` | Standing, both arms straight overhead, from the side |

The first four are the progress set (`progress.md` compares them pose by
pose). The `move-*` photos are taken at intake and at each phase review only.
The user drops the photos in the folder under any names; rename them as in
`progress.md` Step 2, plus the `move-*` names.

### 3. Look and record

View every photo (the Read tool) and write the profile's **Body assessment**:
what is visible, never a diagnosis, with a confidence for each (high /
medium / low: angle, light, clothing). Nothing about looks.

- **Posture:** head forward of the shoulders; shoulders rounded forward or
  raised; upper-back rounding; pelvis tilted (a deep low-back arch, or a flat
  one); knees and feet (knees in, feet turned out).
- **Balance:** one shoulder or hip higher, a shift to one side, one side
  visibly bigger.
- **Development:** areas that lag behind the rest (upper back against chest,
  legs against upper body, and so on).
- **Where fat is carried:** described (waist, hips, upper body), never a
  body-fat percentage.
- **Movement:** squat depth, heels lifting, knees travelling in, torso lean;
  overhead, arms short of vertical, ribs flaring, the low back arching.

### 4. From what's seen to the plan's emphasis

Each observation gets an emphasis, written in the Body assessment and used
by `planning.md`. These are heuristics **(H)**: photo-based posture
correction has weak evidence (Slater 2019, `rules.md`), so the aim is
capacity and balance, never "fixing" posture.

| Seen | Plan emphasis |
|---|---|
| Head forward, shoulders rounded, upper back rounded | More pulling than pushing (about 2:1 sets): rows, face pulls, rear delts; chest and lat stretching |
| Arms short of vertical overhead, or ribs flaring | Landmine or incline pressing until overhead range improves; upper-back extension and lat mobility |
| Heels lift or the torso pitches forward in the squat | Heel-elevated goblet squat; ankle mobility; box squat to depth |
| Knees travel in | Tempo squats and split squats; hip abductor work |
| Deep low-back arch | Dead bugs, hollow holds, glute work; hip-flexor stretching |
| One side bigger or higher | Unilateral work, weaker side first, matching reps |
| An area lags | +2–4 weekly sets for it, within the volume caps |
| Fat carried at the waist | No change to exercise choice; the tape measures the outcome |

### 5. The movement self-check

Five minutes, at home or the gym, results typed back in plain text. Stop any
test that hurts (Ledger, pain rule); a stopped test is left out, never
guessed.

| Test | How | Result → starting point (H) |
|---|---|---|
| Sit-to-stand | Squat to a knee-height box or chair, 5 slow reps, arms crossed | Easy and heels down → loaded squats; heels lift → heel-elevated goblet squat, ankle mobility; struggled → box squat or light goblet squat, no barbell squat yet |
| Push-ups | Max clean reps, chest to a fist's height, body straight | Push-up ladder: 0 → level 1 (incline); 1–10 → level 2 (floor); 11–24 → level 3 (tempo); 25+ → level 4 (deficit). Nothing above the level yet; used for pressing when there is no bench, dumbbell or machine press, else kept for travel days |
| Hang and pull | Dead hang (s), then strict pull-ups | Pull-up ladder: 8+ pull-ups → level 7 (weighted); 3–7 → level 6 (pull-ups, the main vertical pull); 1–2 → level 5 (band-assisted); none with a 30 s+ hang → level 4 (negatives); none with a 20–29 s hang → level 2 (scapular); a hang under 20 s → level 1 (dead hangs in the warm-up). Levels 2–5 go beside the lat pulldown when there is one |
| Plank or hollow hold | Seconds, lower back down | Core ladder: plank under 30 s → level 1 (dead bug), 30–59 s → level 2 (tuck hollow), 60 s+ → level 3; hollow hold under 20 s → level 2, 20–39 s → level 3, 40 s+ → level 4 |
| Hinge | Hands slide down the thighs with a flat back; dowel on the back (head, upper back, tailbone in contact) | Flat back to the knees → RDL pattern; can't keep it → hip thrust, back extension and glute bridge first, no RDLs yet |
| Overhead reach | Back and head on a wall, arms straight up: thumbs touch the wall without the lower back arching? | Clean → overhead pressing; ribs flare or the lower back arches → landmine or incline pressing, upper-back extension and a lat stretch, overhead range as a capacity goal |
| Wall test | Heels, hips and shoulders on a wall: the gap behind the head (cm) | Same measure as `tests[].wallGapCm`; the posture capacity baseline the wall-gap target starts from |
| Balance | Single-leg stand, eyes open, 30 s each side | Under 30 s on a side → single-leg ladder level 1 (split squats, both feet down), a balance hold in the warm-up, no single-leg RDLs or pistols yet; 30 s each side → single-leg work from week 1 (level 3 with an easy sit-to-stand, else 2); sides 10 s or more apart → the shorter side is the weaker one |

**Where the results go.** The table above goes into the Athlete profile's
"Movement self-check" section, with the date, and the same results into
`profile.json` as `selfCheck` (`formats.md`); `engine plan` sets each
ladder's starting level and the choices above from it, with a reason for
each.

The first week of the plan is the calibration week (`planning.md`); the
assessment only picks where it starts. It is repeated at each phase review
with the same protocol. The results that are also the phase review's tests
(push-ups, pull-ups, the hollow hold, the wall test) go into the body log
at the end of the intake (step 8 of "How to run it"), so the first test day
has numbers to compare with.

## Profile checklist (every field filled or "unknown")

Basics (sex, age, height, weight, waist); screening (answers, outcome, date,
re-screen due); training age; goals ranked with importance, confidence,
measure, date; availability (days, minutes, shorter days, fixed
constraints); equipment; tracking level; preferences (exercises, cardio
modes, splits liked or disliked); the bad-week answer; Body assessment
(date, photos, observations with confidence, emphasis) or "declined";
movement self-check results; Ledger entries written; the history choice;
RIR calibration (empty until the first mesocycle review). `profile.json` and
`ledger.json` written to match and validated by the engine.
