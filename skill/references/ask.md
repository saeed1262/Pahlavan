# Ask: questions about the training data and the archive

"Am I on pace?", "why is my bench down?", "when did squats last feel this
good, and what else was going on?"

1. **Find the sources:** `fitness-log-data.json` (sessions, notes, ratings),
   `body-data.json`, `engine review` for this week's figures (`--date` for
   another week; `next --lift` for one lift), `Coach/checkins.json` for what
   the user answered at past check-ins (recovery, aches, effort, gaps,
   busy weeks; read it, never edit it), the vault's own notes
   `Coach/local.md` names (daily notes: `grep` them for the terms and dates),
   `Coach/` letters, decisions, Ledger and eating plan, `Progress Reports/`,
   and `_archive/<YYYY-MM>/` for older cycles (their lifts may predate stored
   units).
2. **Numbers through code** (the engine's `review`, `readiness` or `next`,
   `numbers.md`; a short read-only snippet in the shell for anything else),
   never from memory or an earlier message. Quote the rule's note.
3. **Answer with the numbers and where they come from:** "Bench: 54 × 10 on
   09-30, then 50 × 10 on 10-07 (fitness-log-data.json)". Cite dates and
   files for context too ("sleep that night from body-data.json").
4. **Say plainly when the data can't answer it** (one weigh-in can't give a
   pace), and that logs undercount training.
5. **Don't write anything** unless the answer turns into another job (`log`,
   `plan`, `checkin`); then say so and switch.
