# Plan files: how a plan change is written

The mechanics of every write to the plan, for the `plan` job (a designed plan,
an ad hoc change, the next month, the Why this plan card) and for changes
accepted in `checkin` and `review`. What the plan should be is decided in
`planning.md`; this file is only how it gets into the files. Swaps, a
temporary change (an injury, a week away), the next month or the card (each
of the last two its own recipe, below).

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
   old choice doesn't come back.
   **The plan's `why` stays** (the Why this plan card, "The Why this plan
   card" below): the change rewrites each reason it touches (one about the
   movement swapped, the week resized, the split changed), in the same
   voice, with the card's `date` set to the day of the change; every other
   reason stays word for word, and a change that touches none (most
   temporary changes) leaves the card as it is. A plan with no `why` yet
   gets `no-why-card` from `check --plan`: the change doesn't wait for it,
   and the coach offers the card after it.
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
   (`check --plan` warns `start-changed` otherwise). **A redesign** (a new
   plan in place of the running one: `planning.md`, "The order") is checked
   and written with `--redesign`: `check --plan <draft> --vault . --json
   --redesign` in step 1, `plan-write --file <draft> --vault . --json
   --redesign` for the diff and, on the yes, the same with `--write`. Its
   exercise changes are then information (`redesign-changes`), and
   `similar-to-current` warns when over half of its movements are in the
   plan as written, answered at Reconcile (`planning.md`, step 1.7). On a
   vault with no `plan-data.json` yet (a first plan), every step here works
   on the draft: `check --plan`, `review --plan`, and `plan-write`, whose
   diff lists every key as added. A new plan (a fresh start, a reset, a
   redesign, a phase review's next phase) starts from `engine draft`'s
   blank plan (`planning.md`, step 1.4); a change inside the plan (a swap,
   the next month) is the plan as written with the change made. A ladder
   item is written as `"<Ladder> (your level)"` with its `ladder` id and is
   never one of the two logged lifts. Its ladder in `ladders` carries the
   level this plan starts it at as `"startLevel": N` (formats.md, "A
   ladder's starting level"), so `check
   --plan` and `review --plan` count the item at that level before the log
   holds one; without it they count the lowest level and warn
   `ladder-start`. The starting level also goes into the log with `log
   ladder --id <id> --level <level> --date <D> --write`, where the level
   history starts.
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
   the Phases table and that phase's bullets: its aim, emphasis and targets)
   and the Check-ins rows that land in them; the month is designed from
   that phase, the block just reviewed and the user's goals. A month that
   starts a new phase (the one after every second light week: weeks 9 and
   17 with light weeks every 4th week) is the phase review's next phase,
   designed from blank with its keep list (`review.md`, Phase review, step
   6), then written through steps 2–3 above and the rest of this recipe.
2. **`plan-data.json`**, through steps 2–3 above:
   - `sessions`: the phase's set, rep and round changes (`sr`). A logged lift
     whose rep range changes needs its `lifts` `lo`/`hi` changed too, or the
     next-weight suggestions keep the old range.
   - The exercises, by the review's verdicts (`review.md`, Mesocycle review,
     step 5): each accessory kept or changed for its reason from the block's
     data, not a fixed share (at most half is the default where the data is
     silent); main lifts stay within the phase unless the data says
     otherwise (pain, a stall the triage ladder hasn't fixed), and such a
     change carries an `exercise-change` override with that reason. A
     movement brought in is a new movement (step 2 above: its `guide`, and
     its `lifts` entry if logged).
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

## The Why this plan card

The plan's reasons as a whole, in `plan-data.json`'s `why`: Pahlavan's
Plan tab draws them as the **Why this plan** card under the timeline (the
lead, each reason with its grade, the split picked, the families compared,
and the splits left out, folded, with links to the roadmap and the
Decision). Every new plan gets its card when it is written (`planning.md`,
"Writing it", step 1), and a change keeps it ("A change to the plan", step
2). This section is its shape, and the recipe for `/fitness-coach plan
why`: a plan with no `why` (the card says the coach hasn't written the
plan's reasons yet and shows that command, with Copy; `check` warns
`no-why-card`), or one gone stale (a reason the plan no longer bears out).

```json
{
  "why": {
    "date": "2026-11-09",
    "lead": "Four full-body days of about an hour, built around your upper back, lats and shoulders, with a light week every fourth week.",
    "reasons": [
      { "title": "Upper back, lats and shoulders come first", "text": "We decided them together on 9 Nov from your photos and your wish. They get 15 to 18 sets a week, most of them hard and direct.", "grade": "moderate" },
      { "title": "Three sets of every exercise", "text": "Your own rule, and every session keeps it." }
    ],
    "split": {
      "picked": { "family": "full-body", "why": "Your 4 days of an hour fit it, and a missed day costs each muscle only part of its week, which matters in your busy weeks." },
      "compared": [
        { "family": "upper-lower", "why": "As good on paper, but two heavy leg days, and a skipped day hits half your body." },
        { "family": "torso-limbs", "why": "Its limbs day ran past your hour." }
      ],
      "leftOut": [
        { "family": "push-pull-legs", "why": "Fits 3 or 6 days. On your 4, each muscle gets one hard day a week, and a skipped day loses its whole week." }
      ]
    },
    "decision": "2026-11-09 · Redesign"
  }
}
```

(The example's `leftOut` shows one family; a card lists every family not
built, eight in this example.)

- `date` (YYYY-MM-DD, required): the day the card was written or last
  changed.
- `lead` (required): the plan in one breath.
- `reasons` (at least one; 3 to 7 by `planning.md`, "Writing it"): each
  `{title, text, grade?}`, `title` and `text` required, `grade` one of
  `strong`, `moderate`, `weak`, `heuristic` (the rules' **Strong**,
  **Moderate**, **Weak**, **(H)**), left out where the reason is the
  person's own.
- `split` (required): `picked`, one `{family, why}`; `compared`, the
  other candidates built and measured, each `{family, why}` (why it
  lost); `leftOut`, every other family, each `{family, why}` (why it
  doesn't fit this person, `planning.md`, step 1.3). Each family once, by
  its id (the ids `profile.json`'s `preferences.splits` uses; `engine
  --version --json`'s `facts.why.splitKinds` lists each with the label
  Pahlavan shows):

  | `rules.md` "Split families" | `family` |
  |---|---|
  | Full body | `full-body` |
  | Upper/lower | `upper-lower` |
  | Push/pull/legs | `push-pull-legs` |
  | Heavy/light full body | `heavy-and-light-days` |
  | Body-part split | `body-part` |
  | Torso/limbs | `torso-limbs` |
  | Upper/lower/full | `upper-lower-full` |
  | Specialization block | `specialization` |
  | CrossFit-style (HIFT) | `hift` |
  | Circuit or minimalist | `circuit` |
  | Calisthenics skill blocks | `calisthenics` |

  Concurrent (hybrid athlete) has no id: it is how the cardio fits into
  any plan, not a split.
- `decision` (optional): the heading of the Decisions entry that wrote the
  plan.
- A key starting with `_` is ignored (a note for the coach).

`check` reads the card on the plan and on a draft (`numbers.md`, "The
plan check"): `why-shape` is a hard error (it can't be read as written: a
wrong type, an unknown key, an unknown or repeated family, no `lead`,
`date` or `split`, a reason without `title` or `text`, a bad `grade`),
`no-why-card` warns when the plan has none, and `why-split-missing` lists
the families the card names nowhere. `engine draft` never carries a `why`.

**`/fitness-coach plan why`**, in order:

1. **Read what the plan already says**, never designing it again: the
   roadmap's "How your data shaped this plan" (the audit table, the
   candidates compared and why the pick won), the plan's Decision in
   `Coach/Decisions.md` (the entry that wrote it: trigger intake, reset,
   redesign or phase review) and the Decisions since it (each change the
   plan has had), the Athlete profile's Priorities (each with its reason
   and the date decided) and its confirmed findings (the Body assessment
   and the self-check, with the user's answers), and `plan-data.json`. Then `review --vault . --json` for the plan's
   numbers: a number on the card is quoted from it (the sets a week,
   `volume`), never copied from the roadmap (SKILL.md house rule 1).
2. **Write the card** as `planning.md`'s "Writing it" says (step 1, "The
   plan's `why`"): to the person, in the coach's voice, the lead, 3 to 7
   reasons with their grades, the split, and `decision` the Decision's
   heading. It claims nothing these files don't: a reason they don't bear
   out is left out, never made up. `compared` holds the candidates the
   roadmap names; when it names none, `picked`'s `why` says so, and the
   card names no candidate that was never built.
3. **The splits left out, where they're missing.** A plan written before
   the card has no line for the families it didn't build. The coach writes
   one for each (`planning.md`, step 1.3: `rules.md` "Split families",
   its Fits and Costs set against this person's week and answers) for the
   card's `leftOut`, and adds the same lines where they're missing: to
   the roadmap's "How your data shaped this plan" (as **The splits left
   out**, under the candidates compared), and to the plan's Decision (a
   dated line under the entry, as a review's outcome gets one: "**The
   splits left out** (added 2026-11-10): ...").
4. **Show it first:** the card's text as the Plan tab will show it (the
   lead, each reason with its grade, the split picked, the families
   compared, the splits left out) and the lines for the roadmap and the
   Decision. One yes for all of it.
5. **On the yes:**
   1. A draft: the plan as written (the whole `plan-data.json`, its keys in
      their order) with `why` added as the last key, or replaced for a
      stale one, saved as a scratch file outside the vault.
   2. `check --plan <draft> --vault . --json`: no `why-shape`, no
      `why-split-missing`, no `no-why-card`. A hard error the plan as
      written already has stops this job, as any (SKILL.md house rule 20);
      its warnings are the plan's, and the card leaves them as they were.
   3. `plan-write --file <draft> --vault . --json`: its `diff` changes
      `why` and nothing else. Then the same with `--write`, and `check
      --vault . --json` once more on the plan as written.
   4. The lines from step 3, in the roadmap and the Decision.
6. **No Decision of its own.** The card writes down reasons the plan
   already had and changes nothing it does (no session, item, rule or
   date), so it is not a plan change (`formats.md`, "`Decisions.md`": one
   entry per plan change) and gets no entry; the plan's Decision only
   gains the splits-left-out lines (step 3). A diff that changes anything
   beside `why` is a plan change: stop, and write it through "A change to
   the plan", with its Decision.
