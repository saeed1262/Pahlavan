# The rules (evidence base)

The coach's rules in one place, with where each comes from. The plan-design
rules (plan structure, split families, goal modifiers, volume, effort, load,
rest, order, range of motion, progression, light weeks, concurrent training)
were checked against 62 sources, each one opened, on 2026-11-03.

**Grades:** **Strong** (consistent meta-analyses), **Moderate** (a
meta-analysis, or several trials with some inconsistency), **Weak** (few or
small studies, mixed results, or a preprint), **(H)** a heuristic: a sensible
default with weak or no direct evidence. Say so when a decision rests on a
heuristic, and give its confidence. The plan's proposal gives each major
decision its evidence and grade (`planning.md`, "The proposal").

Weak spots to be honest about: per-person volume landmarks and the 0.5 weight
for indirect sets are assumptions; Pelland 2025's tier numbers come from its
open preprint (the published tables are paywalled); the per-session cap rests
on one preprint; readiness thresholds are heuristics; light-week timing has no
evidence-based schedule; RIR is less accurate above 12 reps.

## Plan structure

| Rule | Detail | Source |
|---|---|---|
| Split | A scheduling choice, designed from the constraints (`planning.md`, step 1). At matched weekly sets per muscle, training it 1, 2 or 3+ days a week, split or full body, gives the same growth and strength; without matching, 2 days beat 1 because the extra day adds sets | [Schoenfeld 2019a](https://doi.org/10.1080/02640414.2018.1555906), [Ramos-Campo 2024](https://doi.org/10.1519/JSC.0000000000004774), [Schoenfeld 2016](https://doi.org/10.1007/s40279-016-0543-8) · **Strong** (hypertrophy) |
| Frequency for strength | Each strength-goal lift 2+ exposures a week: strength rises with frequency beyond volume, with diminishing returns (an estimated 12.7% gain at 1 weekly session, 17.3% at 2, flatter after; from Pelland 2025's preprint). An older meta-analysis found no effect at matched volume | [Pelland 2025](https://doi.org/10.1007/s40279-025-02344-w), [Grgic 2018a](https://doi.org/10.1007/s40279-018-0872-x), [Currier 2023](https://doi.org/10.1136/bjsports-2023-106807) · **Moderate** |
| Candidates | At least three families from "Split families" below, at least one outside full body and upper/lower, each built and checked | `planning.md`, step 1 |
| Scoring | The checks (every muscle in its tier, no session over the cap, inside the minutes); exposures per strength-goal lift **Moderate**; heavy/light days for a trained lifter with a strength goal only **Moderate**; heavy leg days next to key runs **Moderate**; skip risk from the bad-week answer **(H)**; pulling in every session for the posture emphasis **(H)**; a novice's practice of each main lift **Weak**. Preference and fit decide between options equal on these **Moderate** ("Adherence techniques"). A split is never scored as better for muscle | The rows of this table |
| Novice lifting days **(H)** | Up to 4 lifting days for a novice, extra days as cardio, mobility or skill work: a recovery and time default, overridable. No study caps novice frequency: 1 and more than 5 days a week are equal at matched volume, and the old novice advice rested on 3 studies | [ACSM 2026](https://doi.org/10.1249/MSS.0000000000003897) |
| Training age **(H)** | By how fast they progress: session to session = novice; week to week = intermediate; needs whole blocks = advanced | No source |
| Macrocycle | 12–24 weeks, in phases of two mesocycles (the lengths **(H)**: Pahlavan's clock). Periodized plans beat non-periodized ones a little for 1RM (ES 0.31), with no effect on muscle size | [Moesgaard 2022](https://doi.org/10.1007/s40279-021-01636-1), [ACSM 2026](https://doi.org/10.1249/MSS.0000000000003897) · **Moderate** (1RM) |
| Mesocycle | 3 loading weeks + 1 light week (deload); its timing: "Deloads" | **(H)** |
| Undulation (heavy/light days) | Each main lift heavy once and lighter once a week (four full-body days: a heavy pair at 5–8 reps and a lighter pair at 10–15 with variations, a lighter day after each heavy one). An advantage only for a trained lifter with a strength goal: undulating beat linear only in trained people (ES 0.61), and periodization added nothing for muscle. For a muscle goal it is a preference, never a score | [Moesgaard 2022](https://doi.org/10.1007/s40279-021-01636-1) · **Moderate** (trained strength) |
| Exercise changes | Only at mesocycle boundaries; main lifts kept for a whole phase; rotate at most half the accessories at a time. Systematic variation helps regional growth and strength; frequent random rotation may hurt (8 studies, all young men) | [Kassiano 2022](https://doi.org/10.1519/JSC.0000000000004258) · **Weak** |

## Split families

The families the plan's candidates come from (`planning.md`, step 1). At
matched weekly sets they build the same muscle ("equivalence" below:
[Schoenfeld 2019a](https://doi.org/10.1080/02640414.2018.1555906),
[Ramos-Campo 2024](https://doi.org/10.1519/JSC.0000000000004774), **Strong**),
so what separates them is cost: exposures per muscle, sets per session,
fatigue, skip risk and interference. The engine's `plan` draft builds and
scores, beside the full-body variants (heavy/light among them), by lifting
days: at 2, upper/lower once each; at 3, upper/lower/full, push/pull/legs once
each and upper/lower rotating; at 4, upper/lower twice, torso/limbs,
upper/lower plus a full-body pair (the second day lighter) and a body-part
split; at 5, push/pull/legs plus upper/lower, U/L/U/L/F and a body-part split;
at 6, push/pull/legs plus upper/lower, push/pull/legs twice and a body-part
split. At 5–6 days (a trained lifter: a novice lifts on 4 days at most) it
also builds 4 lifting days with the rest as conditioning;
sessions of 30 min or less get only the minimum-dose templates. The
specialization block and HIFT are the coach's to build; concurrent training,
circuits and calisthenics skill blocks the engine builds only in part
(`proposal.families` says which part). Each candidate's row carries its
families' fit against the Fits column below (`templates[].fit`: what the week
and the person meet and miss) and their Costs (`templates[].costs`), as flags,
not points: the points are the Scoring row above.

| Family | Structure | Fits | Costs | Evidence |
|---|---|---|---|---|
| Full body | All major muscles each session; A/B or A/B/C, 2–4 days | 2–3 days, 30–60 min, novices, health, high skip risk; the only family for Conservative screening | Many exercises a session at high volume; legs every session | Equivalence **Strong**; the skip-risk edge **(H)** (a missed day costs each muscle part of its week) |
| Upper/lower | U/L/U/L, or U/L rotating over 2–3 days | 4 days, 45–75 min, intermediate, muscle or strength | Two heavy leg days; a missed day hits half the body | Equivalence **Strong**; 2 exposures for strength **Moderate** |
| Push/pull/legs | 3 days (each once), 6 days (each twice), or push, pull, legs, upper, lower over 5 | 3 days: likes splits, a low-priority phase; 6 days: trained, time-rich, likes daily training; the hybrid for 5-day weeks | 3 days = once a week per muscle (little strength practice, many sets per session); 6 days = time, recovery and skip cost | No direct trials; equivalence only; the structure **(H)** |
| Body-part split | 1–2 muscle groups a day, each once a week, 4–6 days | Trained, muscle goal, likes it, low skip risk | Once a week; a muscle's sets likely past the per-session cap; a missed day loses a muscle's week | Equivalence **Moderate** (few trained trials); the cap **Weak** |
| Torso/limbs | Chest, back, shoulders / legs, arms | 4 days, arm emphasis | A long limbs day | **(H)** (equivalence by volume) |
| Upper/lower/full | U/L/F (3 days), U/L/U/L/F (5) | 3 or 5 days, a split's focus with fewer days | About twice a week, uneven per muscle | **(H)** |
| Heavy/light full body | Each main lift heavy once and light or varied once a week, 3–4 days | Trained, strength or strength + muscle | Heavy days tire; more to plan | **Moderate** for trained strength, none for muscle |
| Specialization block | 1–2 priority muscles at 12–18+ sets, trained first; the rest at maintenance, for 4–8 weeks | Trained, a clear lagging muscle | Fatigue concentrated; maintenance holds only if load is kept | Local dose-response **Moderate**, maintenance dose **Weak**, order **Moderate**; the block itself **(H)** |
| Concurrent (hybrid athlete) | 2–4 lifting days plus endurance; 3 h+ apart or lift first | Endurance and strength goals | Small interference; explosive and trained lower-body strength most at risk; time | **Strong**/**Moderate** ("Concurrent training and cardio") |
| CrossFit-style (HIFT) | Mixed lifts, gymnastics and conditioning at high intensity, varied daily | Likes variety or groups, general fitness | Specific lifts hard to progress; injury rate like weightlifting's; fatigue unpredictable | **Weak** |
| Circuit or minimalist | Stations with short rest; or 1–2 sessions of a few multi-joint lifts, about 4 sets per muscle a week | 30 min or less, bad weeks, health, fat loss with fitness | Less maximal strength; low volume per muscle | **Moderate** |
| Calisthenics skill blocks | Leverage ladders (push-up, pull-up, single-leg), skill work early in the session | No equipment, skill goals, travel | Load hard to measure; leverage steps can be large | **Weak** (progressive push-ups matched the bench press in small trials); the structure **(H)** |

Sources: 2 exposures for strength [Pelland 2025](https://doi.org/10.1007/s40279-025-02344-w);
the per-session cap [Remmert 2025](https://doi.org/10.51224/SRXIV.537) (preprint);
heavy/light [Moesgaard 2022](https://doi.org/10.1007/s40279-021-01636-1);
specialization [Spiering 2021](https://doi.org/10.1519/JSC.0000000000003964), [Nunes 2021](https://doi.org/10.1080/17461391.2020.1733672);
HIFT [Claudino 2018](https://doi.org/10.1186/s40798-018-0124-5), [Wang 2025](https://doi.org/10.1186/s12889-025-21538-5), [Rodríguez 2022](https://doi.org/10.1080/00913847.2020.1864675);
circuits and minimalist [Ramos-Campo 2021](https://doi.org/10.3390/biology10050377), [Muñoz-Martínez 2017](https://doi.org/10.1007/s40279-017-0773-4), [Iversen 2021](https://doi.org/10.1007/s40279-021-01490-1), [Androulakis-Korakakis 2020](https://doi.org/10.1007/s40279-019-01236-0);
calisthenics [Kotarsky 2018](https://doi.org/10.1519/JSC.0000000000002345), [Kikuchi 2017](https://doi.org/10.1016/j.jesf.2017.06.003).

## Goal modifiers

Goal 1 sets the modifier (`intake.md`, round 2).

| Goal | What the plan does | Source |
|---|---|---|
| Strength | Main lifts heavy, at 80%+ of 1RM (about 1–6 reps; the engine writes 3–6); each lift 2+ exposures a week; few sets (strength gains little past about 4 weekly sets), so spare time goes to exposures or to muscle volume | [Lopez 2021](https://doi.org/10.1249/MSS.0000000000002585), [Currier 2023](https://doi.org/10.1136/bjsports-2023-106807), [ACSM 2026](https://doi.org/10.1249/MSS.0000000000003897), [Pelland 2025](https://doi.org/10.1007/s40279-025-02344-w) · **Strong** (load), **Moderate** (frequency, sets) |
| Muscle | Any range from about 6 to 30 reps taken near failure (0–3 RIR, failure optional), chosen by equipment, joints and liking (the engine's 6–15 is a default); sets by the tiers in "Volume" (10+ a week enhances growth) | [Schoenfeld 2017b](https://doi.org/10.1519/JSC.0000000000002200), [Schoenfeld 2021](https://doi.org/10.3390/sports9020032), [Refalo 2023](https://doi.org/10.1007/s40279-022-01784-y), [ACSM 2026](https://doi.org/10.1249/MSS.0000000000003897) · **Strong** |
| Fat loss | The muscle modifier plus a step target | No source opened · **(H)** |
| Health and longevity | 2–3 full-body days plus 150–300 active minutes a week (or 75–150 vigorous); balance work at 65+. 30–60 min a week of muscle strengthening goes with a 10–20% lower mortality risk in cohorts | [Bull 2020](https://doi.org/10.1136/bjsports-2020-102955) (WHO 2020), [Momma 2022](https://doi.org/10.1136/bjsports-2021-105061) · **Moderate** |
| Hybrid endurance | Lifting by the muscle or strength modifier, its sets not cut for the running: adding aerobic training didn't reduce muscle size or maximal strength. Heavy legs away from key runs ("Concurrent training and cardio"); fewer sets only when time runs short **(H)** | [Schumann 2022](https://doi.org/10.1007/s40279-021-01587-7), [Wilson 2012](https://doi.org/10.1519/JSC.0b013e31823a3e2d) · **Strong** |
| Calisthenics | Skill blocks with leverage ladders (the vault's `ladders`), skill work early in the session | [Kotarsky 2018](https://doi.org/10.1519/JSC.0000000000002345), [Kikuchi 2017](https://doi.org/10.1016/j.jesf.2017.06.003) · **Weak**; the block structure **(H)** |
| Age 65+ | Start around RPE 5–6; add fast (explosive) lifting after 4–8 weeks | No source opened · **(H)** |

## Volume: weekly fractional sets per muscle

Direct set = 1 (the muscle is a prime mover), indirect = 0.5 **(H: the 0.5
weight, the convention Pelland 2025 counted with)**. Growth rises with weekly
sets, with diminishing returns and no clear plateau (about +0.37% per weekly
set); strength needs few sets. **Strong** (the shape), **Moderate** (the tier
numbers).

| Tier | Sets/week | Use |
|---|---|---|
| Minimum dose | 4 | Maintenance; the floor for any muscle (the minimum effective dose) |
| Efficient | 5–10 | Most muscles, most of the time (the most growth per set) |
| Priority | 10–16 | Up to 2–3 priority muscles per phase: the ones the user names first, then from a muscle or recomposition goal **(H: which muscles)**. The minimum is met by **direct sets taken near failure** (0–3 RIR, the "Muscle" row above): half-credit from compound lifts and easy work don't fill it; a hold counts when it is at least 75% of the user's tested best **(H: the 75%)**, a ladder item when it is at the user's level. With the posture emphasis, upper back and lats may run to the cap to keep pull at about twice push |
| Cap **(H)** | 20–24 | Never planned above. Returns keep falling with no clear plateau and few studies go past about 25 sets, so the cap is for fatigue and time, not a ceiling on growth. Above 20 only as a short deliberate block (a specialization block) |
| Per session **(Weak)** | ≤ 6–8 direct sets per muscle | Past about 8 direct sets in one session, more sets were unlikely to add a detectable effect (one preprint): a muscle needing more than about 16 a week needs 2+ sessions |
| Strength | More exposures (frequency), not more sets | Strength gains little past about 4 weekly sets |

Sources: [Pelland 2025](https://doi.org/10.1007/s40279-025-02344-w) (the tier
numbers and frequency estimates are from its open preprint,
[SportRxiv 460](https://doi.org/10.51224/SRXIV.460)),
[Schoenfeld 2017a](https://doi.org/10.1080/02640414.2016.1210197),
[Baz-Valle 2022](https://doi.org/10.2478/hukin-2022-0017),
[Schoenfeld 2019b](https://doi.org/10.1249/MSS.0000000000001764),
[ACSM 2026](https://doi.org/10.1249/MSS.0000000000003897); the per-session row
only, [Remmert 2025](https://doi.org/10.51224/SRXIV.537) (a preprint, not peer
reviewed).
Per-person landmarks (how much *this* person needs) are unknown up front:
start in the efficient tier and let the mesocycle review move it ±2 sets **(H)**.

**The minimum week** (the bad-week week, Express, a health plan on its own,
and the maintenance dose inside a specialization block): 2 short full-body
sessions, about 4 hard sets per muscle a week, supersets. In trained men, one
set 1–3 times a week near failure still raised the squat and bench; strength
and size held for up to 32 weeks on 1 session and 1 set per exercise when the
load was kept (older adults: about 2 sessions of 2–3 sets). **Moderate**.
Sources: [Androulakis-Korakakis 2020](https://doi.org/10.1007/s40279-019-01236-0),
[Iversen 2021](https://doi.org/10.1007/s40279-021-01490-1),
[Spiering 2021](https://doi.org/10.1519/JSC.0000000000003964),
[Zhang 2025](https://doi.org/10.1007/s40279-025-02176-8) (supersets).

## Effort: reps in reserve (RIR)

| Exercise type | Target RIR |
|---|---|
| Compound lifts | 1–3 |
| Isolation and machines | 0–2 |
| Strength work (heavy, ≤ 6 reps) | 2–4 |
| Conservative screening outcome | ≥ 4 (about RPE 6) |
| Deload | target + 3 |

- **Failure is optional.** Sets to failure gave at most a trivial edge for
  muscle (none for momentary failure) and equal strength; growth improves
  closer to failure while strength stays flat across RIR. Failure only on
  machines and isolation lifts, never on heavy compounds or with a
  Conservative screening. **Moderate**; the targets by exercise type **(H)**.
- A logged or reported RIR of **5 or more** is unreliable: the set was too
  light to judge. Push the next session closer to the target.
- RIR accuracy is better close to failure and worse **above 12 reps**: people
  underpredict the reps left by about 1. Sets gauged by RIR stay at about 15
  reps or fewer; the calibration corrects the bias.
- **Calibration:** once per mesocycle (its last loading week), one set to
  technical failure on a machine, dumbbell or isolation lift (never a heavy
  barbell squat or deadlift, never a lift with an active Ledger constraint).
  The user says the RIR they'd have predicted at the target reps; reps done
  beyond it are the actual RIR. Bias = predicted − actual, stored per exercise
  in the Athlete profile and used to correct targets ("RIR 2" for someone with
  a +2 bias is "feels like 4 left").

Sources: [Refalo 2023](https://doi.org/10.1007/s40279-022-01784-y), [Grgic 2022](https://doi.org/10.1016/j.jshs.2021.01.007), [Robinson 2024](https://doi.org/10.1007/s40279-024-02069-2), [Halperin 2022](https://doi.org/10.1007/s40279-021-01559-x), [ACSM 2026](https://doi.org/10.1249/MSS.0000000000003897).

## Load, rest, order and range of motion

| Rule | Detail | Source |
|---|---|---|
| Load | Strength: main lifts at 80%+ of 1RM, which wins for 1RM. Muscle: loads from 30 to 100% of 1RM build equal size when taken near failure, so the rep range follows equipment, joints and liking | [Schoenfeld 2017b](https://doi.org/10.1519/JSC.0000000000002200), [Lopez 2021](https://doi.org/10.1249/MSS.0000000000002585), [Schoenfeld 2021](https://doi.org/10.3390/sports9020032), [Currier 2023](https://doi.org/10.1136/bjsports-2023-106807) · **Strong** |
| Rest | At least 90 s between sets (past 90 s, no clear difference for size); 2–3 min on heavy compound lifts (trained lifters likely need over 2 min for strength). Supersets of non-competing muscles when time is the limit: they keep the volume load and the long-term gains | [Singer 2024](https://doi.org/10.3389/fspor.2024.1429789), [Grgic 2018b](https://doi.org/10.1007/s40279-017-0788-x), [Zhang 2025](https://doi.org/10.1007/s40279-025-02176-8) · **Moderate** (size), **Weak** (strength) |
| Tempo | Rep speed matters little for size: 0.5 to 8 s per rep gives similar growth; very slow reps (over 10 s) do worse. The plan's default: lower under control in about 2 to 3 s, no bouncing at the bottom, lift with intent; a pause only where a note asks for one (the stretch on isolation lifts) | [Schoenfeld 2015](https://doi.org/10.1007/s40279-015-0304-0) · **Moderate** (size); the 2 to 3 s default **(H)** |
| Order | The goal's priority lift first (a strength-goal lift, or a priority muscle's main exercise): strength gains are largest in the exercises done first, and size is unaffected by order. Otherwise order for safety and logistics | [Nunes 2021](https://doi.org/10.1080/17461391.2020.1733672) · **Moderate** |
| Range of motion | Full range of motion, with the lengthened (stretched) position emphasised; lengthened partials as an option (a load ceiling, a painful end range); never short-range partials as main work | [Wolf 2023](https://doi.org/10.47206/ijsc.v3i1.182), [Kassiano 2023](https://doi.org/10.1519/JSC.0000000000004415), [Pedrosa 2022](https://doi.org/10.1080/17461391.2021.1927199), [Wolf 2025](https://doi.org/10.7717/peerj.18904) · **Moderate** (full ROM), **Weak** (lengthened partials) |
| Exercise choice | By equipment, the Ledger, liking and the lift the user wants strong: free weights and machines build equal strength and size, specific to the mode trained **Moderate**. Prefer versions that load the muscle long (a seated leg curl over a lying one) **Weak**. The time-efficient core: a squat or leg press, an upper pull, an upper push | [Haugen 2023](https://doi.org/10.1186/s13102-023-00713-4), [Maeo 2021](https://doi.org/10.1249/MSS.0000000000002523), [Iversen 2021](https://doi.org/10.1007/s40279-021-01490-1) |

## Progression

| Rule | Detail |
|---|---|
| Double progression | All sets at the top of the range at the target RIR → next increment, back to the bottom of the range. Adding reps at a fixed load matched adding load **(Moderate)** |
| Below the range | Top set under the bottom of the range → hold the weight |
| Two misses | Two sessions in a row under the bottom → 5–10% lighter, rounded to the lift's step |
| Big steps | Where one dumbbell step is over 10% of the load, widen the range (e.g. 8–15) so reps carry the progress |
| Load ceiling | A load ceiling (the heaviest weight available, such as the gym's heaviest dumbbell) calls for a rep range with double progression, not linear steps: once the load tops out, reps carry the progress |
| Linear (novices) | Load up every successful session; in `plan-data.json`, a `lifts` entry with `lo` = `hi` |
| By equipment **(H)** | Bodyweight progresses by leverage, range, tempo and reps; dumbbells by double progression, going unilateral when the heaviest dumbbell gets light; a full gym allows barbell linear progression for novices |
| Novices and trained **(Weak)** | Novices: simple plans and frequent practice of the main lifts (untrained lifters gained most near 60% of 1RM and 3 days a week per muscle, trained ones near 80% and 2 days) |
| Load-jump cap | At most one increment per lift per session **(H)**; never more than about 10% a week on any lift (the consensus step is 2–10% once 1–2 reps over the target) |

Sources: [Plotkin 2022](https://doi.org/10.7717/peerj.14142), [ACSM 2009](https://doi.org/10.1249/MSS.0b013e3181915670), [Rhea 2003](https://doi.org/10.1249/01.MSS.0000053727.63505.D4), [Pelland 2025](https://doi.org/10.1007/s40279-025-02344-w). With Standard
tracking only the top set is logged, so "all sets" is the top set plus the
user's word in the check-in.

## Strength trend: estimated 1RM (e1RM)

- Epley: **e1RM = weight × (1 + n / 30)**, n = reps + RIR (reps alone when RIR
  isn't logged, which is today's case). Only when n ≤ 10.
- Smooth with the **best of the last 3 sessions**.
- Changes under **±4%** are noise.
- Compare each exercise only with itself (a goblet squat is not a back squat;
  a swap is a different series).
- Above 10 reps: no e1RM; judge by load at the same reps.

Sources: [Reynolds 2006](https://www.unm.edu/~rrobergs/478RMStrengthPrediction.pdf), [Grgic 2020](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7367986/). Code: `numbers.md`.

## Stalls

**Detection:** e1RM gain of 2% or less over 3 sessions, with at least 80% of
planned sessions done in that span. Below 80%, it's an adherence question, not
a stall.

**Triage ladder** (one step per check-in, in order; stop at the first that applies):

1. Check sleep, food (protein, deficit size) and readiness. If one is off, fix that; no plan change.
2. Deload early, if the scheduled one is 2+ weeks away.
3. Change the rep range or the variation (preferably at the mesocycle boundary).
4. Move that muscle's volume 2 sets: down if recovery is poor, up if recovery is good and it's at 10 sets or fewer.

Source: [SBS on plateaus](https://www.strongerbyscience.com/thoughts-on-breaking-plateaus-cn/).

## Readiness **(H: thresholds)**

| Part | Rule |
|---|---|
| Signals | `sleepH`, `sleepQ`, `energy`, `rhr` (inverted), `soreness` (inverted) from `body-data.json` |
| Baseline | Each signal against its own previous 28 days of the current cycle (a fresh start builds it again); needs ≥ 14 entries, else unscored, so no score until the cycle holds 14 morning check-ins (train as planned meanwhile) |
| Score | z-score per signal, clipped to ±2.5 (sd floored: 0.5 for hours and 1–5 scales, 2 bpm for RHR); daily score = mean of ≥ 3 signals |
| Smoothing | 3-day EWMA (α 0.5); act on the smoothed score, never on one day |
| Bands | ≥ +0.5 good · −0.5 to +0.5 normal · −1.0 to −0.5 watch · ≤ −1.0 low |
| Low | One set fewer per exercise and RIR +1 that day |
| Low 5 days running + falling e1RM | Offer an early deload |
| RHR 7+ bpm over baseline 2 days running, or illness | No hard training (easy Zone 2 or mobility at most) |
| Under 6 h of sleep | No tests or PR attempts that day |

Sources: [Saw 2016](https://bjsm.bmj.com/content/50/5/281) (subjective measures track load better than objective ones), [Craven 2022](https://doi.org/10.1007/s40279-022-01706-y). Recipe and code: `checkin.md`, `numbers.md`.

## Deloads

The light week manages fatigue; it doesn't drive growth. No evidence-based
timing exists: in one trial (trained lifters, 9 weeks) a full week off midway
gave no extra muscle and slightly less lower-body strength; a Delphi
consensus defines deloading but gives no timing; surveyed strength and
physique athletes deload every 5.6 ± 2.3 weeks for about 6 days, cutting
volume and effort and keeping frequency and exercises. **Weak** (mostly H).

| Rule | Detail |
|---|---|
| Default **(H)** | Every 4th plan week (weeks 4, 8, 12, …): the schedule the engine, Pahlavan and the calendar run, inside the surveyed range |
| Early | When a trigger fires (`checkin.md`, deload triggers): low readiness 5 days running with a falling e1RM; stalls on 2+ main lifts; 2 check-ins running with poor recovery and joint aches **(H)** |
| Skipped or moved | When no trigger is met, the check-in or the review may skip a scheduled light week (`deload.cancelled`, on `checkin.md`'s cancel conditions) or move it onto a known busy or travel week (`busy-week`); the user decides and a Decision records it. Never two mesocycles running without one **(H)** |
| Shape | Half the sets, RIR +3, same exercises and frequency, never a full week off |
| Pahlavan's light week | 2 sets of everything and about 10% lighter (the same idea for 3–4-set exercises); its screens keep the fixed week whatever the check-in decides (see `planning.md`, limits) |

Sources: [Coleman 2024](https://doi.org/10.7717/peerj.16777), [Bell 2023](https://doi.org/10.1186/s40798-023-00633-0), [Rogerson 2024](https://doi.org/10.1186/s40798-024-00691-y).

## Missed time

| Gap | Rule |
|---|---|
| One session | Shift the week (the next session in the rotation); never stack two in a day |
| 1–2 weeks | First week back 5–10% lighter and RIR +1 |
| 3+ weeks | Restart the mesocycle (a calibration-style first week) |
| Always | Ask whether it was unlogged first. No streak-shaming: say what's next, not what was lost |

Sources: [Lally 2010](https://www.surrey.ac.uk/news/does-it-really-take-66-days-form-habit-we-asked-expert-dr-pippa-lally) (one missed day didn't derail habit formation), [Spiering 2021](https://pubmed.ncbi.nlm.nih.gov/33629972/) (strength holds through short breaks).

## Concurrent training and cardio

Across 43 studies, adding aerobic training to lifting didn't reduce muscle
size (SMD −0.01) or maximal strength (−0.06) but cut explosive strength
(−0.28), more when both were in the same session. Trained lifters lost
lower-body 1RM only with same-session training. Interference grows with the
endurance work's frequency and duration, and with running more than cycling.
So cardio doesn't lower the lifting sets; placement protects explosive and
lower-body strength. **Strong** (overall), **Moderate** (the moderators).

| Rule | Detail |
|---|---|
| Placement | Conditioning on non-lifting days, or 3+ h after lifting; lift first when they share a session (lifting first preserved lower-body strength) **(Moderate)**. A trained lifter chasing lower-body strength: separate days |
| Mode | Cycling or other low-impact modes when legs are a priority (running interferes more) **(Moderate)** |
| Short finishers | 5–10 min easy Zone 2 after lifting is fine (low interference) **(H)** |
| Intervals | One 4×4 session a week: 4 × 4 min hard (about 90–95% of max heart rate), 3 min easy between. Intervals raise VO2max a little more than continuous work (about 1.2 mL/kg/min) **(Moderate)** |
| Easy cardio | Fills minutes for those who like it, not as a better intensity: Zone 2 as the optimal intensity is not supported **(Weak)** |
| Circuits | When time is short and both goals count: VO2max, muscle and fat mass all improve a little **(Moderate)** |
| Legs | Keep heavy leg days away from key runs or intervals (24 h+) **(H)** |
| Weekly target | 150–300 active minutes (vigorous minutes count double) |
| Steps **(H)** | Build toward 8–10k a day, by phase |

Sources: [Schumann 2022](https://doi.org/10.1007/s40279-021-01587-7), [Petré 2021](https://doi.org/10.1007/s40279-021-01426-9), [Eddens 2018](https://doi.org/10.1007/s40279-017-0784-1), [Wilson 2012](https://doi.org/10.1519/JSC.0b013e31823a3e2d), [Helgerud 2007](https://doi.org/10.1249/mss.0b013e3180304570), [Milanović 2015](https://doi.org/10.1007/s40279-015-0365-0), [Storoschuk 2025](https://doi.org/10.1007/s40279-025-02261-y), [Ramos-Campo 2021](https://doi.org/10.3390/biology10050377), [WHO 2020](https://www.who.int/publications/i/item/9789240015128) ([Bull 2020](https://doi.org/10.1136/bjsports-2020-102955)).

## Body weight and food

| Rule | Detail |
|---|---|
| Trend | EWMA α 0.1 a day over weigh-ins; never judge a single weigh-in |
| Rate | Least-squares slope of the trend over the last 14–28 days, as kg/week and % of body weight a week |
| Fat loss band | −0.5 to −1.0% a week |
| Recomposition band **(H)** | 0 to −0.5% a week; judged by waist and strength trends, not the scale |
| Gain band | +0.25 to +0.5% a week |
| Maintenance **(H)** | within ±0.25% a week |
| Act | Only after 2 weekly readings out of band; one change at a time |
| Protein | ≥ 1.6 g per kg of trend weight a day (benefit tops out around 2.2) |

Food targets, levels, floors and adjustment steps: `diet.md`.
Sources: [Hacker's Diet](https://fourmilab.ch/hackdiet/www/subsection1_4_1_0_8.html), [Helms 2014](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4033492/), [Morton 2018](https://bjsm.bmj.com/content/52/6/376).
Quote `engine review`'s slope and band for the weight's rate.

## Tests and check-in cadence **(H: the cadence)**

| What | When | Conditions |
|---|---|---|
| Weekly check-in and letter | Sundays | |
| Weight | Daily if the user likes, trend only | Morning, after the bathroom |
| Tape (waist, hips, chest, arm) | Every second Sunday | Waist at the navel, relaxed, after breathing out |
| Calisthenics and posture tests | Each phase end, the Saturday of its light week | Not after < 6 h of sleep; same order and rest each time |
| Photos | Each light week's Sunday, via the `progress` job | Same light, distance, poses |
| e1RM | Every logged session | Code only |
| RIR calibration set | Last loading week of each mesocycle | See Effort |
| Re-screening | Every 12 months, or when health changes | `intake.md` |
| Health markers the user's clinician tracks | On the clinician's schedule; the coach only reminds | |

The tape, photo and test dates themselves come from `engine tracked`'s
`bodyRecord` (the plan's calendar, with each part's `nextDate`).

## Adherence techniques

| Technique | How the coach uses it | Source |
|---|---|---|
| A plan that fits | Size the week to the last 4 weeks' confirmed sessions + 1 at most, within stated availability **(H)** | The plan note's "Ideas no app has"; the vault's own log |
| Preference between equals | Where the options are equal for results (the split, the load range, equipment, exercise order for muscle), the user's liking decides; score candidates on liking, fit to the real week and the cost of a missed day. Intensity set from the person's preference gave 77% more sessions in one trial; fit, enjoyment and a place in daily life drive adherence **(Moderate)** | [Teixeira 2024](https://doi.org/10.1186/s12966-024-01636-0), [Rhodes 2015](https://doi.org/10.1007/s12160-015-9704-5), [Collado-Mateo 2021](https://doi.org/10.3390/ijerph18042023), [Rhodes 2017](https://doi.org/10.1136/bjsports-2016-096950) |
| Minimum session | Express (20 min) instead of skipping; a short day can go, lifting stays. The dose: "The minimum week" under Volume | Today's roadmap |
| If-then plans | One "if X, then Y" per known obstacle, from the pre-mortem ("if a meeting runs late, Express at home"); d = 0.65 on goal attainment across 94 tests **(Strong)** | [Gollwitzer & Sheeran 2006](https://doi.org/10.1016/S0065-2601%2806%2938002-1) |
| Importance and confidence rulers | 0–10 for each goal; under 7 confidence → ask what would make it a 7 and shrink the ask | Motivational interviewing (Miller & Rollnick) |
| Less logging | Ask for the least data that answers the question; tracking level is the user's choice | The plan note's "Tracking levels" |
| No streaks | Missed time gets the next step, never a tally | [Lally 2010](https://www.surrey.ac.uk/news/does-it-really-take-66-days-form-habit-we-asked-expert-dr-pippa-lally) |

## Pain, injuries and safety

| Rule | Detail | Source |
|---|---|---|
| Red flags | Stop and refer (list in `intake.md`) | [HerniaSurge 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC5809582) and general clinical practice |
| Pain rule | Up to 3/10 during the exercise, settled by the next day → fine. Otherwise change the load, range or exercise. Persisting → see a professional | Stricter than the tendon pain-monitoring model (Silbernagel 2007 allows 5/10) **(H)** |
| Never diagnose | Describe what the user reports; never name a cause or condition | Wellness wording (plan note, "Public release") |
| Ledger screen | Every new plan and every swap is checked against `Ledger.md` constraints | Plan note, "Ideas no app has" |

### Intra-abdominal pressure (IAP) risk tags **(H: the tiers)**

Heavy lifting with a held breath (Valsalva) produces the highest abdominal
pressures ([Blazek 2019](https://termedia.pl/Systematic-review-of-intra-abdominal-and-intrathoracic-r-npressures-initiated-by-the-Valsalva-manoeuvre-during-r-nhigh-intensity-resistance-exercises,78,38043,0,0.html)).
In this vault the tag is plain ("strains the abdomen"); the user's own Ledger
can name the reason.

| Tag | Examples | With an active abdominal-wall entry in the Ledger |
|---|---|---|
| High | Barbell back squat, deadlift, heavy RDL, standing barbell press, heavy leg press, heavy carries, anything near failure with a held breath | Out until a clinician clears it; back in at deload loads |
| Moderate | Goblet squat, DB RDL, lunges, split squats, hip thrust, hanging leg raises | Allowed, breathe out on the effort, RIR ≥ 2 |
| Low | Seated machines, cables, DB presses on a bench, isolation work, back extension | Allowed |

Any pain, pressure or bulge at the site, not effort, stops the set.

### Posture as capacity

Frame posture work as building capacity (upper-back strength, thoracic
mobility, overhead range), not as fixing a bad posture; posture alone predicts
pain poorly: 54 studies showed no strong link between the spine's curves and
pain ([Christensen 2008](https://doi.org/10.1016/j.jmpt.2008.10.004)), and the
links found between posture and low back pain aren't shown to be causal
([Swain 2020](https://doi.org/10.1016/j.jbiomech.2019.08.006)) **(Weak:** the
studies are mostly low quality**)**.
Pulling volume at least equal to pushing volume **(H)**. Measure it by capacity
tests (the wall gap, `wallGapCm`, and overhead reach) and the side photo, never
promise pain relief.

## Screening outcomes

ACSM pre-participation logic in the coach's own words; questions and table in
`intake.md`. **Go** (normal plan), **Conservative** (full body only, effort
capped around RPE 6 / RIR ≥ 4, no vigorous work, no max tests), **Blocked**
(logging only until a clinician clears them). 18+ only; pregnancy and
postpartum are referred. Re-screen every 12 months or when health changes.
Sources: [ACSM algorithm summary](https://open-exam-prep.com/study-guides/acsm-cpt/chapter-2-health-screening/preparticipation-screening-algorithm),
[PAR-Q+](https://eparmedx.com/) (linked, never embedded: it's copyrighted and
must be used unchanged).
