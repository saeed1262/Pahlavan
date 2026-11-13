// The CLI's logic, kept free of Node APIs so it can be tested directly: the
// Node entry (engine.ts) passes the file system, today's date and the time
// in through `CliIo`. Every command prints JSON to stdout. The writes are
// `checkin add --write` (Coach/checkins.json, through
// `CliIo.writeCheckins`), `track ... --write` (Coach/tracking.json,
// through `CliIo.writeTracking`; `track tick` also the linked homepage
// habits, through `CliIo.writeHabits`), `body --write` (body-data.json,
// through `CliIo.writeBody`), `eating --write` (Coach/eating-plan.json,
// through `CliIo.writeEating`) and `inbox --write` (the phone's entries
// through the same files the plugin's writers merge, the log and
// Coach/nudges.json among them, then the move into Coach/Inbox/applied/ and
// Coach/Inbox/refused.json; `inbox --phone --write` Coach/Inbox/phone.json)
// and `plan-write --write` (plan-data.json, the whole file, once the plan
// check finds no hard error, through `CliIo.writePlan`); each is a dry run
// without --write. `review`, `session` and `check` read a draft in place of
// plan-data.json with --plan.
//
// Exit codes: 0 ok, 1 the data has problems, 2 a usage error.

import { readNewestLetter, readVault, joinPath, type DraftPlan, type ReadIo, type VaultRead } from '../adapters/vault/read.ts';
import { nudgesSettingsPath, pahlavanSettingsPath, readQuietHours, readTracking } from '../adapters/vault/tracking-read.ts';
import { landed, mergeTracking } from '../adapters/vault/tracking-write.ts';
import { habitsLanded, mergeHabitChanges } from '../adapters/vault/habits-write.ts';
import { habitsView } from '../core/tracking.ts';
import { buildTrackDay, planTick } from '../report/track-day.ts';
import { momentAt, toMinutes, toTs } from '../core/clock.ts';
import type { VaultWarning } from '../adapters/vault/convert.ts';
import { isIsoDate } from '../core/dates.ts';
import { CATALOGUE_BY_ID, type Level, type Pattern } from '../core/data/exercises.ts';
import { MUSCLE_IDS } from '../core/data/muscles.ts';
import { parentMissingText, REGION_IDS, regionProblems, regionsWithoutParent } from '../core/data/regions.ts';
import { normalizeEquipment } from '../core/plan/context.ts';
import { ITEM_KEYS, LIFT_KEYS, PLAN_DATA_KEYS, UNEXPRESSIBLE } from '../core/plan-data.ts';
import { WHY_GRADES } from '../core/plan-why.ts';
import { CALIBRATION } from '../core/calibration.ts';
import { legacyRules, RULE_KINDS } from '../core/rules.ts';
import { REGION_RULES, VOLUME } from '../core/volume.ts';
import { SCHEMA_VERSION, SPLIT_KINDS, SPLIT_LABELS, type Ledger, type Profile, type Program } from '../core/schema.ts';
import {
  validateBody,
  validateCheckinLog,
  validateCheckins,
  validateEatingPlan,
  validateLedger,
  validateLog,
  validateProfile,
  validateProgram,
  validateSession,
  validateNudges,
  validateSitting,
  validateTracking,
  validateInboxEntry,
  validateLetter,
  letterFields,
  LETTER_TYPES,
  type ValidationError,
} from '../core/validate.ts';
import { ENGINE_VERSION } from '../core/version.ts';
import { parseArgs } from './args.ts';
import { bodyLanded, planBody, readBodyInput } from '../report/body-add.ts';
import { addCheckins, buildTemplate, letterFocus, reviewedSunday } from '../report/checkin.ts';
import { envelope, sourcesOf } from '../report/envelope.ts';
import { buildNext, buildReadiness, buildReview, findingWarnings, findLift, knownLifts, painWarning, skipWarnings, timeWarning } from '../report/review.ts';
import { buildSession } from '../report/session.ts';
import { buildCheck, envelopeLists } from '../report/check.ts';
import { OVERLAP_WARN_ABOVE, overlapShare, overLimit, planMovements, planShape, sharedMovements, type Movement } from '../report/overlap.ts';
import { CatalogueQueryError, searchCatalogue, type CatalogueQuery } from '../report/catalogue.ts';
import { catalogueMarkdown } from '../report/catalogue-doc.ts';
import { buildEvidence, TOPIC_IDS, type Topic } from '../report/evidence.ts';
import { planDiff, sameJson } from '../report/plan-write.ts';
import { coachStepsOf } from '../report/checkin-screen.ts';
import { frozenList } from '../report/log-form.ts';
import { logAddEntry } from '../report/log-add.ts';
import { mergeFix, mergeHabit, mergeLadder, mergeLog, sessionKey } from '../adapters/vault/log-write.ts';
import { readChanges, planTrack, setUp, type TrackChanges } from '../report/track-write.ts';
import { buildBringOver, buildDue, buildHabitStats, buildTracked, proteinFor } from '../report/tracking.ts';
import { buildFood } from '../report/food.ts';
import { buildEnergy } from '../report/energy.ts';
import { energyFacts, ENERGY, palInTable, PAL_TABLE_TEXT } from '../core/energy.ts';
import { baselineNote } from '../report/baseline.ts';
import { eatingLanded, planEating } from '../report/eating-write.ts';
import { applyInbox, buildPhone, INBOX_FILES, INBOX_PATHS, INBOX_TEXT_KEYS, inboxTextPaths, isEntryFile, phoneText, refusedLine, refusedOf, refusedText, type InboxFile, type InboxTextKey, type InboxTexts } from '../report/inbox.ts';
import { folders, paths, resolveFolders, useFolders, type FoldersSource } from '../adapters/vault/layout.ts';
import { versionWarning } from '../adapters/vault/plugin-version.ts';

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CliIo extends ReadIo {
  /** Today's local date, YYYY-MM-DD. The only clock the engine reads. */
  today(): string;
  /** The local time now: minutes since midnight and the offset from UTC (minutes east), for due. */
  clock?(): { minutes: number; offsetMinutes: number };
  isDir(path: string): boolean;
  /** Writes the layout's Coach/checkins.json under `<root>` and nothing else (the folder is created if needed). */
  writeCheckins?(root: string, text: string): void;
  /** Writes the layout's Coach/tracking.json under `<root>` and nothing else (the folder is created if needed). */
  writeTracking?(root: string, text: string): void;
  /** Writes the layout's body-data.json under `<root>` and nothing else. */
  writeBody?(root: string, text: string): void;
  /** Writes the layout's habit check-ins file under `<root>` (an existing file only: a habits grid may own it). */
  writeHabits?(root: string, text: string): void;
  /** Writes the layout's Coach/eating-plan.json under `<root>` and nothing else (the folder is created if needed). */
  writeEating?(root: string, text: string): void;
  /** Writes the layout's fitness-log-data.json under `<root>` (the phone's sessions, as the Log panel merges them). */
  writeLog?(root: string, text: string): void;
  /** Writes the layout's Coach/nudges.json under `<root>` (the phone's answer to "Did you train today?"). */
  writeNudges?(root: string, text: string): void;
  /** Writes one of the inbox's own files, the layout's Coach/Inbox/<name> under `<root>` (refused.json, phone.json). */
  writeInbox?(root: string, name: 'refused.json' | 'phone.json', text: string): void;
  /** Moves an entry file in the layout's Coach/Inbox/ under `<root>` to its applied path under it (applied/<YYYY-MM>/<file>), making the folder. */
  moveInbox?(root: string, file: string, to: string): void;
  /** Writes the layout's plan-data.json under `<root>` (the whole file, `plan-write --write`). */
  writePlan?(root: string, text: string): void;
}

export const VERSION_LINE = `pahlavan engine ${ENGINE_VERSION} (schema v${SCHEMA_VERSION})`;

export const HELP = `${VERSION_LINE}

Usage: engine <command> [options]          (run from the vault root: --vault .)

Commands (each prints JSON to stdout, with every rule's reason):
  review    --vault <path> [--date YYYY-MM-DD] [--plan <file>]
            The week holding the date (default today): adherence over 4 weeks,
            readiness and its actions, the weight trend and rate band, per
            lift the e1RM trend, stall verdict, triage and next target (load
            cap applied, on the gym's real weights when the profile lists its
            loads), sets per muscle against the bands, deload status,
            the missed-time protocol, the concurrent-training check (on the
            weekdays the log shows, else the profile's days), due
            temporary changes, ladders, tests, each session's minutes as
            planned against the profile's day lengths, the week's pain from
            the log and the check-in with the pain rule (and the cycle's by
            exercise, with its direction), each planned exercise's facts
            this cycle (done as planned, skipped and swapped with their
            reasons, the last day done, a lift's last rise this cycle), and
            the warnings (version-differs: Pahlavan in the vault carries
            another engine than this one, with which is newer and what to
            update).
            --plan reads a draft (a whole plan-data.json) in place of the
            vault's, through the same reading: the numbers the draft would
            give once written (sources.plan names it, a draft-plan warning).
  readiness --vault <path> [--date D]
  session   --vault <path> [--date D] [--mode full|express|hotel] [--type T]
            [--plan <file>]
            Today's session as the Today screen shows it: the session logged
            today, or the next in the rotation; --type picks another of the
            plan's sessions (A, B, S1, ...), built the same way and marked as
            your choice. Each lift's target in its own unit; readiness trims,
            soreness, the Ledger screen with swaps, the load cap and big
            jumps, the warm-up and finisher; every adjustment with its reason
            and title. express: the plan's Express block (a short day: every
            item at half); hotel: what the profile's travelEquipment lists,
            else bodyweight, light dumbbells and bands. --plan: a draft's
            session, as review reads one.
  session   --vault <path> --type T --freeze [--date D] [--mode full|express]
            [--lift1 "<name>"] [--lift2 "<name>"] [--skip "<name>,<name>"]
            Read only: the exercise list a log entry freezes for that session
            and date (freeze.value.exercises), exactly as Pahlavan's Log panel
            writes it, for a session logged elsewhere (log add); the
            logged lifts as the entry names them, a swap (the lift done, by
            name) with the plan's as "planned"; and the entry's checklist
            (freeze.value.checklist: done, total, skipped), the --skip lines
            marked skipped as the Log panel marks them (a line by its name, or
            its item's name that day; a paired line as a whole).
  next      --vault <path> --lift "<name>" [--date D]
            One lift: plan-data's (by name, short name or id) or one logged
            by that name; a lift renamed in the plan answers to its new name.
            No top sets and not in this week's plan: a warning says so.
  check     --vault <path> [--plan <file>] [--redesign] [--date D]
            The plan check on the date: the plan (or the draft --plan names,
            read in place of plan-data.json) against the guardrails. findings,
            each {code, level, message, items, rule, grade, reason}: hard
            errors no override clears (a movement the Ledger or the safety
            screen rules out, data Pahlavan cannot read as written, a logged
            lift with no lifts entry, an override with no reason); evidence
            warnings with their rule and grade (sets per muscle against the
            tiers, a priority muscle's 10-16, the weekly and per-session caps,
            RIR by exercise type, rep ranges and rest, pull to push under the
            posture emphasis, a light week in every mesocycle, the profile's
            day lengths and plan rules, load jumps, exercises changed inside a
            mesocycle against the plan as written, "Why:" lines, week changes
            in notes); facts the profile states (a movement its equipment does
            not cover, one it dislikes, a lift step its loads cannot make);
            and information. --redesign, with
            --plan: the draft is a new plan, not a change inside this one, so
            its exercise changes are information (redesign-changes), and a
            draft holding more than half of the written plan's movements
            warns (similar-to-current, the shared movements as its items).
            The plan's overrides ({code, item, reason, decision}) turn a
            matched warning into information with its reason. A
            version-differs warning (as review's) is about the vault, not the
            plan. summary counts each level. Exit 1 on a hard error.
  plan-write --vault <path> --file <draft.json> [--redesign] [--date D]
            [--write]
            The coach's write path into plan-data.json: the draft (a whole
            plan) checked as check checks a draft (--redesign as check's),
            refused on a hard error; its warnings and the overrides applied; a
            key-level diff against plan-data.json as it is. With --write the
            whole file is written (a temporary file renamed over it) and read
            back. A dry run unless --write.
  draft     --vault <path>
            A blank plan to design a new one from, as a redesign starts:
            planData, plan-data.json's keys in their order with no sessions,
            lifts, guide entries or rules. Only start, liftUnit and the desk
            breaks (deskRoutine, deskTiming) come from the plan as written;
            weekTarget from the profile's days (else 0), liftUnit from the
            profile when the plan has none (else kg). from says where each
            came from. No plan yet: the same, with a no-plan warning. Read
            only.
  overlap   --plans <a.json,b.json> [--vault <path>]
            How much plans share, read only. drafts: each file's movements
            (each item not timed and not cardio, by one identity: a ladder's
            id, else the catalogue's id, else the name normalized) and shape
            (lifting days, lifting sessions, each session's pattern order).
            matrix and pairs: the share of one plan's movements the other also
            holds, both ways (not symmetric). --vault adds the plan as written
            (current) and each draft against it (againstCurrent). similar:
            each share over the limit (over half), one direction each.
  evidence  [--topic volume|effort|load|rest|tempo|order|range-of-motion|exercise-choice|progression|light-weeks|readiness|calibration|concurrent|activity|regions|findings|standing-rules]
            The evidence library the coach designs from, as data, read only:
            each rule with its number (read from the constant the engine
            computes with), its grade (strong, moderate, weak, heuristic), a
            short note, its sources (label and DOI or URL) and the check
            warnings that hold a plan to it; the muscle regions with the
            catalogue movements that bias each, and the regions the evidence
            does not support with the nearest supported option; how a finding
            is confirmed; the standing rules a plan declares, with the old
            default each falls back to. Facts, never a choice for anyone.
            --topic gives one part.
  catalogue [--pattern P] [--region R] [--muscle M] [--equipment e1,e2]
            [--level beginner|intermediate|advanced] [--query <text>]
            [--vault <path>] [--md]
            The movement catalogue searched, read only: each movement that
            fits every filter given (its pattern; a region it biases, by id or
            another name, an unsupported one searching its nearest option; a
            muscle it trains, main or helping; nothing beyond the equipment
            listed, in the profile's words, a tool that stands in counting;
            text in its names) with its muscles, regions, abdominal-strain
            tag, level, easier and harder versions, other names, stand-in
            tools, demand tags, uses, hotel fit and guide text. The order is
            for display only: exact text matches, the muscle as main over
            helping, versions loading a two-joint muscle long, at or under
            --level (which removes nothing; the profile's novice reads as
            beginner), the most targeted, catalogue order. The ladders whose
            levels are among the results (all with no filter): the
            self-check's four and the catalogue's own; --vault adds the
            plan's own ladders. --md adds "markdown": the readable page (by
            pattern, each movement's muscles, regions, tools, level, easier
            and harder, setup, do and avoid; the ladders; what each demand
            means), the whole catalogue with no filter, as
            docs/exercise-catalogue.md and Pahlavan's catalogue note have it.
  validate  <file> [--kind profile|program|session|checkin|body|ledger|tracking|nudges|sitting|eating|inbox|letter]
            The engine's own files. The vault's (plan-data.json, the log,
            body-data.json, habits-data.json, the work timer's) are not
            judged: exit 2, saying what reads or checks each. A coach letter
            (Coach/Letters/YYYY-MM-DD.md, kind letter): the frontmatter
            Pahlavan reads (type, date, focus). Other Markdown: exit 2.
  tracked   --vault <path> [--date D]
            What is tracked (Coach/tracking.json): each item's kind, schedule,
            what it asks for, its reminder, source and linked habit; the
            coach's open suggestions; the morning check-in's time; the body
            record's schedule (tape, photos, tests: due, next, from the plan
            or every N days); the plan's desk breaks; each reminder that
            Pahlavan's quiet hours hold (later, or never), with its reason.
  due       --vault <path> [--date D] [--time HH:MM]
            The reminder cards due at that moment (default now), each with
            its Why, snooze choices and skip, as the plugin offers them (minus
            this Mac's stand-up count and a sitting stretch still running),
            and the Due today summary: habits done, amounts, stand-ups,
            sitting, desk breaks, the body record, "Did you train?", and the
            coach step after the Sunday check-in while it is due or late (on
            its Sunday while the answers wait), with its command; "Ask the
            coach" is a card from 18:00. No card inside Pahlavan's quiet hours
            (its data.json, else 22:30 to 07:00), and every reminder they
            hold, the 18:00 card included, with its reason.
  habits    --vault <path> [--date D] [--item <id>]
            Each item's streak, 30-day adherence and 26-week grid (sitting:
            the last 4 weeks against its limits), and the three tiles.
  bring-over --vault <path> [--date D]
            The one-time offer from Habit Nudges (its data.json and the
            linked habits) as proposed items, read only; what stays.
  checkin template --vault <path> [--date D] [--time HH:MM]
            A skeleton for the check-in reviewing the week that ends on the
            Sunday on or before D, pre-filled with what the data already says
            (gaps to confirm, protein ticks, stalled lifts and their triage
            step, a deload due next week, dashboard deload weeks to ask about),
            and checkin.md's questions with their answer-to-value mapping.
            The protein question counts the protein item's ticks and asks
            about the unticked days, leaving the Sunday out while its tick is
            still ahead (now, or --time on D). With a saved record for that
            Sunday, the questions it answers are answered, not open.
  checkin add --vault <path> --file <answers.json> [--write]
            Validates the answers and merges them by date into
            Coach/checkins.json (other records are kept). A dry run unless
            --write.
  track <action> --vault <path> [...] [--write]
            The coach's write path into Coach/tracking.json, as Pahlavan's
            Habits screen writes it (merged with the file as it is, validated,
            read back). A dry run unless --write. Actions:
              suggest --file <items.json>   coach suggestions, each with its why:
                                            accept or dismiss chips in Pahlavan
              add     --file <items.json>   items the user accepted in the
                                            conversation (an id in use: a change
                                            to that item, from today)
              decline --file <items.json>   items the user declined: kept as
                                            dismissed, not proposed again
              accept  --id <id[,id]>        accept suggestions, as the chip does
              dismiss --id <id[,id]>        dismiss suggestions
              morning --at HH:MM | --off    the morning check-in's reminder
              body-record --schedule plan   the tape, photos and tests follow
                          | --schedule fixed --tape-from D --tape-every N
                            --tests-from D --tests-every N
              fresh                         record the bring-over as empty
                                            (starting fresh: no offer shows)
              protein                       the protein item's gram target to
                                            the engine's (the protein range's
                                            floor at the trend weight)
              apply   --file <changes.json> several at once, in one write:
                                            {suggest, add, decline, accept,
                                            dismiss, morning, bodyRecord,
                                            bringOver, protein}
              day     [--date D]            read only: each item due that day
                                            with its state and linked homepage
                                            habit, the ids still open, the
                                            session, "Did you train today?" and
                                            a rest mark, the morning check-in
              tick    --id <id[,id]> [--date D] [--done true|false]
                      [--amount N]          the day's tick (supplements, ticks)
                                            or total (amounts) into
                                            Coach/tracking.json and the linked
                                            habit in habits-data.json
  body      --vault <path> --file <record.json> [--replace] [--write]
            The coach's write path into body-data.json: one date's morning
            fields, tape and tests ({date, morning, tape, tests}), through
            the same field-by-field merges as Pahlavan's forms (steps and
            floors on the day before, every other field and day kept), read
            back. A field that holds another value already is a conflict
            and nothing is written, unless --replace. A dry run unless
            --write.

  log add   --vault <path> --file <session.json> [--no-habit] [--write]
  log ladder --vault <path> --id <ladder> --level N [--date D] [--write]
  log fix   --vault <path> --date D --type T --lift lift1|lift2 [--label L]
            [--weight W] [--reps R] [--clear-planned] [--write]
            The coach's writes into fitness-log-data.json, as Pahlavan's Log
            panel makes them: add a session ({date, type, label, lift1, lift2,
            express, durationMin, cardioMin, cardioMode, rating, notes,
            swaps, skipped, skipWhy}: the plan's checks, its exercise list and
            checklist frozen, then the day's Workout habit ticked); a ladder
            level; a logged lift's weight, reps or "planned" corrected.
            "skipWhy": {<a skipped line>: time | pain | equipment | energy},
            the line named as in "skipped": into the checklist's "why".
            Every set: "trackingLevel": "full" with "exerciseSets":
            [{name, planned?, sets: [{weight, unit, reps, rir}]}], each name
            an item of the session (a swap names the plan's as "planned"),
            reps a whole number 0 or more, weight 0 or more (left out for
            bodyweight), RIR 0 to 10; only the sets done.
            Merged with the file as it is and read back. A dry run unless
            --write.

  folders   --vault <path>
            Where the vault keeps Pahlavan's files: the folders (Pahlavan's
            setting, else found the way the plugin finds them on its first
            start) with where they came from (settings, found, default), the
            settings file, and every file's path. Read only.

  baseline  --vault <path> [--date D]
            The cycle's baseline note for a fresh start on the date (the
            intake's day), read only: its path, whether it is there already,
            the note before it, week 1's Monday, the first photo Sunday and
            test Saturday, and the note's text from the template, for the
            coach to write word for word when it is not there.
  food      --vault <path> [--date D]
            The eating plan day to day, as Pahlavan's Food tab shows it
            (Coach/eating-plan.json), read only: the protein floor and
            today's tick, the meals' rough protein against the floor, the
            week's protein days and the cycle's weeks before it, the waist
            and the weight trend against the plan's direction, the
            adjustment rule (no change, or the step, with the next check),
            the weekly pattern from the Sunday check-ins, and every
            number's Why. Counts from the cycle start.
  energy    --vault <path> --pal N [--rate R] [--meals N] [--date D]
            The eating plan's numbers for the diet job, read only, from the
            profile's basics and goals and the trend weight from the cycle
            start: resting energy (Mifflin-St Jeor), maintenance at the
            activity factor --pal (diet.md's table: 1.40-1.69 sedentary or
            light, 1.70-1.99 active, 2.00-2.39 vigorous), the goal energy for
            --rate (the weekly change as a fraction of body weight: -0.0025
            is -0.25 %) or, without it, the most important goal's range
            (recomposition: maintenance to -250 kcal; gain: +200 to +300
            kcal; a loss from its band); a rate faster than 1 % a week
            refused; the floor (1,500 kcal a day for men, 1,200 for women;
            with no sex given, the female constants); protein a day (the
            engine's range) and a meal (--meals, else the eating plan's,
            else 3); the fat and fiber minimums; and the figures as
            Coach/eating-plan.json keeps them. At the eating plan's Light
            level only protein and fiber count.
  eating    --vault <path> --file <plan.json> [--replace] [--write]
            The coach's write path into Coach/eating-plan.json: the plan
            (or the part that changes) merged into the file as it is
            (objects key by key, lists and values replaced, null removes a
            key), or the whole file with --replace; validated, read back.
            A dry run unless --write.
  inbox     --vault <path> [--write]
            The phone's entries in Coach/Inbox/ (sessions, ticks, amounts,
            the morning check-in, "Did you train today?"), each checked and
            applied through the same merges as Pahlavan's own screens: what
            would apply, what is there already, and what is refused with its
            reason (a day after today or more than 14 days back, an id not
            tracked, a session logged already, a value on record that
            differs). A dry run unless --write, which writes the files,
            moves each applied entry to Coach/Inbox/applied/<YYYY-MM>/ and
            rewrites Coach/Inbox/refused.json; refused entries stay.
  inbox     --vault <path> --phone [--write]
            Coach/Inbox/phone.json, what the phone's shortcuts read: today's
            items (open or done), the plan's sessions with their logged
            lifts, the next in the rotation, the morning check-in's fields
            with their limits. Written only with --write, and only when it
            changes.

Options:
  --pretty    indented JSON
  --json      accepted for clarity; JSON is the only output
  --version   the engine and schema versions
  --help      this help

Exit codes: 0 ok, 1 the data has problems, 2 a usage error.
The CLI only reads, except log --write (the log; log add also the Workout
habit's tick), checkin add --write (Coach/checkins.json), track --write
(Coach/tracking.json; track tick also habits-data.json's linked habits),
body --write (body-data.json), eating --write (Coach/eating-plan.json),
inbox --write (the phone's entries into the log, body-data.json,
habits-data.json, Coach/tracking.json and Coach/nudges.json, and the
inbox's own files) and plan-write --write (plan-data.json). The other
writes stay with the plugin and the skill's propose-then-write steps.
`;

class Usage extends Error {}
class DataError extends Error {}

const COMMAND_FLAGS: Record<string, readonly string[]> = {
  review: ['vault', 'date', 'plan'],
  readiness: ['vault', 'date'],
  next: ['vault', 'lift', 'date'],
  evidence: ['topic'],
  catalogue: ['pattern', 'region', 'muscle', 'equipment', 'level', 'query', 'vault', 'md'],
  validate: ['kind'],
  checkin: ['vault', 'date', 'time', 'file', 'write'],
  session: ['vault', 'date', 'mode', 'type', 'freeze', 'lift1', 'lift2', 'skip', 'plan'],
  check: ['vault', 'plan', 'redesign', 'date'],
  'plan-write': ['vault', 'file', 'redesign', 'date', 'write'],
  draft: ['vault'],
  overlap: ['plans', 'vault'],
  tracked: ['vault', 'date'],
  due: ['vault', 'date', 'time'],
  habits: ['vault', 'date', 'item'],
  'bring-over': ['vault', 'date'],
  track: ['vault', 'file', 'id', 'at', 'off', 'schedule', 'tape-from', 'tape-every', 'tests-from', 'tests-every', 'write', 'date', 'done', 'amount'],
  body: ['vault', 'file', 'replace', 'write'],
  log: ['vault', 'file', 'no-habit', 'write', 'id', 'level', 'date', 'type', 'label', 'lift', 'weight', 'reps', 'clear-planned'],
  food: ['vault', 'date'],
  energy: ['vault', 'date', 'pal', 'rate', 'meals'],
  baseline: ['vault', 'date'],
  folders: ['vault'],
  eating: ['vault', 'file', 'replace', 'write'],
  inbox: ['vault', 'write', 'phone'],
};
const GLOBAL_FLAGS = ['pretty', 'json', 'help', 'version'];

/** Commands that were removed, each with what takes its place: still an unknown command, with that said. */
const REMOVED_COMMANDS: Readonly<Record<string, string>> = {
  plan: '`plan` was removed in 0.28.1: a new plan starts from `engine draft`',
};

function out(value: unknown, pretty: boolean, code: number): CliResult {
  return { code, stdout: `${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`, stderr: '' };
}


function readJson(io: CliIo, path: string, what: string): unknown {
  const text = io.readText(path);
  if (text === null) throw new Usage(`${what} not found: ${path}`);
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    throw new DataError(`${path} is not valid JSON: ${(e as Error).message}`);
  }
}

/**
 * No plan-data.json yet (a new user after the intake): a command that answers
 * without a plan drops the read's missing-plan error and says so with a calm
 * `no-plan` warning naming what waits for the plan. Null when the plan (or a
 * draft in its place) was read.
 */
function noPlanYet(read: VaultRead, waits: string): VaultWarning | null {
  if (read.files.plan !== 'missing') return null;
  const file = paths().plan;
  read.data.errors = read.data.errors.filter((e) => !(e.code === 'missing' && e.message.startsWith(`${file} `)));
  return { code: 'no-plan', message: `There is no plan yet (${file}): ${waits}` };
}

/** What review, readiness, session and next leave out on a vault with no plan yet. */
const NO_PLAN_WAITS: Readonly<Record<string, string>> = {
  review: 'readiness, the weight trend, the body record and the log are read; the plan\'s own numbers (sets per muscle, the targets, the plan weeks) wait for one.',
  readiness: 'readiness needs none; what it trims is the plan\'s sessions, once there is one.',
  session: 'there is no session to show until there is one.',
  next: 'a lift\'s targets follow the plan\'s rep ranges and rules, so they wait for one.',
};

function dateFlag(flags: Record<string, string | true>, name: string, io: CliIo): string {
  const v = flags[name];
  if (v === undefined) return io.today();
  if (v === true || !isIsoDate(v)) throw new Usage(`--${name} must be a date as YYYY-MM-DD`);
  return v;
}

function vaultRoot(flags: Record<string, string | true>, io: CliIo): string {
  const v = flags['vault'];
  if (typeof v !== 'string') throw new Usage('--vault <path> is required (the vault root; "." from inside it)');
  if (!io.isDir(v)) throw new Usage(`--vault: no such folder: ${v}`);
  // Where this vault keeps the files: Pahlavan's setting, else the same search the plugin makes on its first load.
  const children = (dir: string) => {
    const at = dir === '' ? v : joinPath(v, dir);
    const names = io.listDir(at);
    if (names === null) return null;
    const folders = names.filter((n) => io.isDir(joinPath(at, n)));
    return { files: names.filter((n) => !folders.includes(n)), folders };
  };
  const r = resolveFolders(io.readText(joinPath(v, pahlavanSettingsPath(CONFIG_DIR))), children);
  useFolders(r.folders);
  foldersSource = r.source;
  return v;
}

/** Where the last vault command's folders came from (`vaultRoot` sets it). */
let foldersSource: FoldersSource = 'default';

// ---------------------------------------------------------------- validate

const KINDS = ['profile', 'program', 'session', 'checkin', 'body', 'ledger', 'tracking', 'nudges', 'sitting', 'eating', 'inbox', 'letter'] as const;
type Kind = (typeof KINDS)[number];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The vault's own files, which none of validate's kinds describes (the
 * kinds are the engine's schema-v1 files): each would read as invalid
 * against any kind, so validate names it and what reads or checks it
 * instead. Told apart by the file's name or its shape; a file with a
 * `schemaVersion` is the engine's, whatever its name.
 */
/** The vault's own files `validate` recognizes, at the vault's layout (built when called: the layout is set per command). */
const vaultFiles = (): readonly { path: string; what: string; checks: string; shape: (o: Obj) => boolean }[] => [
  {
    path: paths().plan,
    what: "the vault's training plan",
    checks: '`review --vault <vault>` reads it with the log and gives what it cannot use as warnings and errors; `check --plan <draft>` checks a draft of it, and `plan-write` writes it',
    shape: (o) => Array.isArray(o['liftTypes']) || Array.isArray(o['shortTypes']) || (isObj(o['guide']) && isObj(o['lifts'])),
  },
  {
    path: paths().workTimer ?? 'work-timer-data.json',
    what: "the work timer's log of desk time",
    checks: '`habits` and `due` read it for sitting time; Pahlavan never writes it',
    shape: (o) => 'pomodoro' in o || 'timerMode' in o,
  },
  {
    path: paths().log,
    what: "the vault's training log (`engine log` and Pahlavan's Log panel write it)",
    checks: '`review --vault <vault>` reads it with the plan; a session it cannot read is a warning there',
    shape: (o) => 'todayChecklist' in o || (Array.isArray(o['sessions']) && o['sessions'].some((s) => isObj(s) && ('lift1' in s || 'lift2' in s || (typeof s['type'] === 'string' && !('trackingLevel' in s))))),
  },
  {
    path: paths().body,
    what: "the vault's body record (morning check-ins, weigh-ins, tape, tests and photos)",
    checks: '`review --vault <vault>` and `due` read it (a value out of range is a warning there); `body --file <record.json>` writes it, checking each field it merges',
    shape: (o) => isObj(o['days']) && !('items' in o) && !('weights' in o),
  },
  {
    path: paths().habits,
    what: 'the habit check-ins (a habits page may own them)',
    checks: "`review --vault <vault>` reads its Workout and Protein ticks; `track tick --write` ticks an item's linked habit",
    shape: (o) => Array.isArray(o['habits']) && isObj(o['checkins']),
  },
  {
    path: INBOX_PATHS.phone,
    what: "Pahlavan's summary of today for the phone's shortcuts",
    checks: '`inbox --phone` builds it (`--write` writes it), and the plugin rewrites it after each change; an entry the phone sends is checked with `validate <entry.json>` (kind inbox)',
    shape: (o) => isObj(o['inbox']) && Array.isArray(o['open']),
  },
  {
    path: INBOX_PATHS.refused,
    what: "the phone's refused entries with their reasons",
    checks: '`inbox --vault <vault>` lists the refusals again (each run rewrites the file); each entry is checked with `validate <entry.json>` (kind inbox)',
    shape: (o) => Array.isArray(o['refused']) && !('kind' in o),
  },
];

/** Which of the vault's own files this is, by its name, else its shape; null for the engine's files. */
function vaultFileOf(file: string, v: unknown): ReturnType<typeof vaultFiles>[number] | null {
  if (!isObj(v) || 'schemaVersion' in v) return null;
  const name = file.split(/[\\/]/).pop();
  const all = vaultFiles();
  return all.find((f) => f.path.split('/').pop() === name) ?? all.find((f) => f.shape(v)) ?? null;
}

function inferKind(v: unknown): Kind | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  // A phone entry: `v` and `kind`, no schemaVersion.
  if ('v' in o && 'kind' in o && !('schemaVersion' in o)) return 'inbox';
  if ('macrocycle' in o) return 'program';
  if ('meals' in o && 'protein' in o) return 'eating';
  if ('items' in o && 'days' in o) return 'tracking';
  if ('skipped' in o) return 'nudges';
  if ('days' in o && 'schemaVersion' in o && typeof o['days'] === 'object' && o['days'] !== null) {
    const first = Object.values(o['days'] as Record<string, unknown>).map((d): unknown => (typeof d === 'object' && d !== null ? Object.values(d)[0] : undefined)).find((x) => x !== undefined);
    if (Array.isArray(first)) return 'sitting';
    if (first !== undefined) return 'nudges';
  }
  if ('goals' in o || 'availability' in o) return 'profile';
  if ('constraints' in o) return 'ledger';
  if ('daily' in o || 'weekly' in o || 'checkins' in o) return 'checkin';
  if ('weights' in o || 'tape' in o) return 'body';
  if ('sessions' in o || 'trackingLevel' in o) return 'session';
  return null;
}

function validateAs(kind: Kind, v: unknown): { errors: ValidationError[]; shape: string } {
  switch (kind) {
    case 'profile':
      return { errors: validateProfile(v), shape: 'profile' };
    case 'program':
      return { errors: validateProgram(v), shape: 'program' };
    case 'session': {
      const isLog = typeof v === 'object' && v !== null && 'sessions' in v;
      return isLog ? { errors: validateLog(v), shape: 'log' } : { errors: validateSession(v), shape: 'session' };
    }
    case 'checkin': {
      const isLog = typeof v === 'object' && v !== null && 'checkins' in v;
      return isLog ? { errors: validateCheckinLog(v), shape: 'checkinLog' } : { errors: validateCheckins(v), shape: 'checkins' };
    }
    case 'body':
      return { errors: validateBody(v), shape: 'body' };
    case 'ledger':
      return { errors: validateLedger(v), shape: 'ledger' };
    case 'tracking':
      return { errors: validateTracking(v), shape: 'tracking' };
    case 'nudges':
      return { errors: validateNudges(v), shape: 'nudges' };
    case 'sitting':
      return { errors: validateSitting(v), shape: 'sittingLog' };
    case 'eating':
      return { errors: validateEatingPlan(v), shape: 'eatingPlan' };
    case 'inbox':
      return { errors: validateInboxEntry(v), shape: 'inboxEntry' };
    case 'letter':
      return { errors: typeof v === 'string' ? validateLetter(v) : [{ path: '(root)', message: 'a letter is a Markdown file with a frontmatter block, not JSON' }], shape: 'letter' };
  }
}

/**
 * A coach letter (Markdown): the frontmatter Pahlavan reads. Taken as a
 * letter with --kind letter, in a Letters folder, or with a letter's type
 * in its frontmatter; any other Markdown is not a file validate checks.
 */
function validateMarkdown(file: string, kindFlag: string | true | undefined, io: CliIo, pretty: boolean): CliResult {
  const text = io.readText(file);
  if (text === null) throw new Usage(`file not found: ${file}`);
  const f = letterFields(text);
  const isLetter = kindFlag === 'letter' || /(^|[\\/])Letters[\\/][^\\/]+\.md$/i.test(file) || (f.type !== null && (LETTER_TYPES as readonly string[]).includes(f.type));
  if (!isLetter) {
    const message = `${file} is a Markdown note, not a file validate checks: its kinds are the engine's JSON files and the coach's letters (Coach/Letters/YYYY-MM-DD.md, or --kind letter).`;
    return { ...out(envelope('validate', { file, kind: null, valid: null }, [], [{ code: 'markdown', message }]), pretty, 2), stderr: `engine: ${message}\n` };
  }
  const errors = validateLetter(text).map((e) => ({ code: 'schema', message: `${e.path}: ${e.message}` }));
  // The file name's date and the frontmatter's: Pahlavan reads the frontmatter's (the file name's only without one).
  const named = /(\d{4}-\d{2}-\d{2})\.md$/i.exec(file)?.[1] ?? null;
  const warnings = !errors.length && named && f.date !== named ? [{ code: 'letter-date', message: `The frontmatter's date (${f.date}) is not the file name's (${named}): Pahlavan reads the frontmatter's.` }] : [];
  return out(envelope('validate', { file, kind: 'letter', shape: 'letter', valid: errors.length === 0, inferred: kindFlag === undefined, letter: { type: f.type, date: f.date, focus: f.focus } }, warnings, errors), pretty, errors.length ? 1 : 0);
}

/** What a valid profile, program or Ledger holds that the engine cannot use: free text, unknown ids. */
function semanticWarnings(kind: Kind, v: unknown): VaultWarning[] {
  const out: VaultWarning[] = [];
  const list = (code: string, message: string, items: string[]) => {
    if (items.length) out.push({ code, message, items });
  };
  // Region values that are not region ids: unknown ones (an alias names its id), and unsupported ones with the nearest supported option and why.
  const regions = (where: string, values: string[]) => {
    const p = regionProblems(values);
    list('unknown-region', `${where} that are not region ids. The regions are ${REGION_IDS.join(', ')}.`, p.unknown);
    list('unsupported-region', `${where} that the evidence does not support: not modelled. Each gives the nearest supported option and why.`, p.unsupported);
  };
  if (kind === 'profile') {
    const p = v as Profile;
    list('free-text-equipment', 'Equipment the engine does not recognise (free text): not used to choose exercises.', normalizeEquipment(p.equipment).unknown);
    const ids = [...(p.preferences?.likes ?? []), ...(p.preferences?.dislikes ?? []), ...(p.preferences?.cardio ?? [])];
    list('unknown-preference', 'Preference ids that are not in the engine catalogue.', ids.filter((id) => !CATALOGUE_BY_ID.has(id)));
    const muscles = [...(p.priorityMuscles ?? []), ...p.emphasis.flatMap((e) => e.muscles ?? [])];
    list('unknown-muscle', 'Muscle ids the engine does not know.', muscles.filter((m) => !MUSCLE_IDS.includes(m)));
    list('emphasis-without-kind', 'Body-assessment rows without a kind: the engine cannot act on them.', p.emphasis.filter((e) => !e.kind).map((e) => e.area));
    regions('Priority regions and body-assessment regions', [...(p.priorityRegions ?? []), ...p.emphasis.flatMap((e) => e.regions ?? [])]);
  }
  if (kind === 'program') {
    const p = v as Program;
    regions('Exercise muscle regions', Object.values(p.exercises).flatMap((e) => e.muscles?.regions ?? []));
    const orphans = Object.entries(p.exercises).flatMap(([id, e]) => (e.muscles ? regionsWithoutParent(e.muscles).map((r) => `${id}: ${parentMissingText(r)}`) : []));
    list('region-parent-missing', 'Exercise muscle regions whose muscle the exercise does not tag in main or helps: a set of it counts no credit for them. Add the muscle, or remove the region.', orphans);
  }
  if (kind === 'tracking') {
    const t = v as { items: { id: string; kind: string; reminder?: unknown; schedule: { kind: string } }[] };
    list('no-reminder', 'Items without a reminder: no card, only Today lists them.', t.items.filter((x) => ['supplement', 'tick', 'amount', 'sitting'].includes(x.kind) && !x.reminder).map((x) => x.id));
  }
  if (kind === 'ledger') {
    const l = v as Ledger;
    const ids = l.constraints.flatMap((c) => (c.noMovements ?? []).map((m) => `${c.id}: ${m}`));
    list('not-catalogue-movement', 'Movements that are not engine catalogue ids: `review` and `check` match them against the plan\'s own exercise ids.', ids.filter((x) => !CATALOGUE_BY_ID.has(x.split(': ')[1]!)));
  }
  return out;
}

function cmdValidate(positionals: string[], flags: Record<string, string | true>, io: CliIo, pretty: boolean): CliResult {
  if (positionals.length !== 1) throw new Usage('validate takes one file');
  const file = positionals[0]!;
  const kindFlag = flags['kind'];
  if (kindFlag !== undefined && (kindFlag === true || !(KINDS as readonly string[]).includes(kindFlag))) throw new Usage(`--kind must be one of: ${KINDS.join(', ')}`);
  // Markdown (a coach letter) is read as text, not JSON.
  if (kindFlag === 'letter' || (kindFlag === undefined && /\.md$/i.test(file))) return validateMarkdown(file, kindFlag, io, pretty);
  const v = readJson(io, file, 'file');
  // The vault's own files are not judged against a kind, given or inferred (exit 2: the wrong command for the file).
  const own = vaultFileOf(file, v);
  if (own) {
    const message = `${file} is ${own.what}, not a file validate checks: its kinds are the engine's own files, and ${own.path.split('/').pop()} would read as invalid against any of them. ${own.checks}.`;
    return { ...out(envelope('validate', { file, kind: null, valid: null, vaultFile: own.path }, [], [{ code: 'vault-file', message }]), pretty, 2), stderr: `engine: ${message}\n` };
  }
  const kind = (kindFlag as Kind | undefined) ?? inferKind(v);
  if (!kind) {
    return out(envelope('validate', { file, kind: null, valid: false }, [], [{ code: 'kind', message: 'Could not tell what the file is; pass --kind.' }]), pretty, 1);
  }
  const { errors, shape } = validateAs(kind, v);
  const errs = errors.map((e) => ({ code: 'schema', message: `${e.path}: ${e.message}` }));
  const warnings = errors.length ? [] : semanticWarnings(kind, v);
  return out(envelope('validate', { file, kind, shape, valid: errors.length === 0, inferred: kindFlag === undefined }, warnings, errs), pretty, errors.length ? 1 : 0);
}

// ---------------------------------------------------------------- drafts, check and plan-write

/** The draft --plan names (a whole plan-data.json), read in place of the vault's; undefined without the flag. */
function draftFlag(flags: Record<string, string | true>, io: CliIo): DraftPlan | undefined {
  const file = flags['plan'];
  if (file === undefined) return undefined;
  if (typeof file !== 'string' || !file.trim()) throw new Usage('--plan needs a file: a draft plan-data.json');
  const text = io.readText(file);
  if (text === null) throw new Usage(`--plan: file not found: ${file}`);
  return { text, file };
}

/** plan-data.json as written (parsed), or undefined when it is missing or not JSON: what a draft is compared with. */
function writtenPlan(io: CliIo, root: string): { text: string | null; doc: unknown } {
  const text = io.readText(joinPath(root, paths().plan));
  if (text === null) return { text, doc: undefined };
  try {
    return { text, doc: JSON.parse(text) as unknown };
  } catch {
    return { text, doc: undefined };
  }
}

/** The plan check: the plan, or the draft --plan names, on the date. Read only. */
function cmdCheck(flags: Record<string, string | true>, io: CliIo, pretty: boolean): CliResult {
  const root = vaultRoot(flags, io);
  const date = dateFlag(flags, 'date', io);
  const draft = draftFlag(flags, io);
  // A redesign is a draft judged against the plan as written: the plan as written against itself says nothing.
  const redesign = flags['redesign'] === true;
  if (redesign && !draft) throw new Usage('--redesign goes with --plan <draft.json>: a redesign is a draft, judged against the plan as written');
  const read = readVault(io, root, { asOf: date, ...(draft ? { plan: draft } : {}) });
  // A draft's exercise changes are judged against the plan as written.
  const previous = draft ? writtenPlan(io, root).doc : undefined;
  // Pahlavan in the vault on another version than this coach: a warning beside the plan's findings.
  const version = versionWarning(io, root, CONFIG_DIR, ENGINE_VERSION);
  const report = buildCheck(read, date, { ...(previous !== undefined ? { previous } : {}), ...(redesign ? { redesign } : {}), ...(version ? { outside: [version] } : {}) });
  const lists = envelopeLists(report);
  return out(envelope('check', { date, ...(redesign ? { redesign } : {}), sources: sourcesOf(read, root), findings: report.findings, summary: report.summary }, lists.warnings, lists.errors), pretty, report.summary.ok ? 0 : 1);
}

/**
 * The coach's write path into plan-data.json: the draft checked as `check
 * --plan` checks it (a hard error refuses it), the warnings and overrides,
 * and a key-level diff against the file as it is; a dry run unless --write.
 * The write re-reads the file first (a change since the check checks and
 * diffs again, once), writes the whole file and reads it back.
 */
function cmdPlanWrite(flags: Record<string, string | true>, io: CliIo, pretty: boolean): CliResult {
  const root = vaultRoot(flags, io);
  const fileFlag = flags['file'];
  if (typeof fileFlag !== 'string') throw new Usage('plan-write needs --file <draft.json>: the whole plan, as plan-data.json holds it');
  const write = flags['write'] === true;
  if (write && !io.writePlan) throw new Usage('this engine cannot write (no plan writer)');
  const date = dateFlag(flags, 'date', io);
  const redesign = flags['redesign'] === true;
  const text = io.readText(fileFlag);
  if (text === null) throw new Usage(`draft not found: ${fileFlag}`);
  const file = paths().plan;
  const path = joinPath(root, file);
  const base = { action: 'write', file, draft: fileFlag, date, ...(redesign ? { redesign } : {}), dryRun: !write, written: false };
  let doc: unknown;
  try {
    doc = JSON.parse(text) as unknown;
  } catch {
    doc = undefined; // the check reports the draft's JSON as a hard error
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const written = writtenPlan(io, root);
    const read = readVault(io, root, { asOf: date, plan: { text, file: fileFlag } });
    const report = buildCheck(read, date, { ...(written.doc !== undefined ? { previous: written.doc } : {}), ...(redesign ? { redesign } : {}) });
    const lists = envelopeLists(report);
    const unchanged = written.doc !== undefined && sameJson(written.doc, doc);
    const overrides = report.findings.filter((x) => x.override).map((x) => ({ code: x.code, items: x.items, reason: x.override!.reason, ...(x.override!.decision ? { decision: x.override!.decision } : {}) }));
    const payload = {
      ...base,
      result: !report.summary.ok ? 'refused' : unchanged ? 'unchanged' : 'changed',
      sources: sourcesOf(read, root),
      diff: doc === undefined ? [] : planDiff(written.doc, doc),
      overrides,
      findings: report.findings,
      summary: report.summary,
    };
    if (!report.summary.ok) return out(envelope('plan-write', payload, lists.warnings, lists.errors), pretty, 1);
    if (!write || unchanged) return out(envelope('plan-write', payload, lists.warnings, []), pretty, 0);
    if (io.readText(path) !== written.text) continue; // changed since the check: check and diff again
    const next = `${JSON.stringify(doc, null, 2)}\n`;
    io.writePlan!(root, next);
    if (io.readText(path) !== next) return out(envelope('plan-write', payload, lists.warnings, [{ code: 'read-back', message: `${file} did not read back as written: check it before running again` }]), pretty, 1);
    return out(envelope('plan-write', { ...payload, written: true }, lists.warnings, []), pretty, 0);
  }
  return out(envelope('plan-write', { ...base, result: null }, [], [{ code: 'busy', message: `${file} kept changing while checking: run it again in a moment` }]), pretty, 1);
}

// ---------------------------------------------------------------- draft and overlap: a redesign starts blank

/** What a blank draft takes from the plan as written: its unit, the desk breaks (not training) and its first day. */
const DRAFT_CARRIED = ['liftUnit', 'deskRoutine', 'deskTiming', 'start'] as const;

/**
 * A blank plan to design from: plan-data's keys in their order, every list
 * and object empty, so a redesign is designed rather than edited from the
 * plan as written. Only the unit, the desk breaks and `start` (so the plan
 * weeks keep counting) are carried; weekTarget comes from the profile's
 * days. Read only.
 */
function cmdDraft(flags: Record<string, string | true>, io: CliIo, pretty: boolean): CliResult {
  const root = vaultRoot(flags, io);
  const read = readVault(io, root, { asOf: io.today() });
  const warnings: VaultWarning[] = [];
  const none = noPlanYet(read, 'the draft starts blank either way, with nothing carried over.');
  if (none) warnings.push(none);
  const written = writtenPlan(io, root);
  if (written.text !== null && !isObj(written.doc)) warnings.push({ code: 'json', message: `${paths().plan} is not a JSON object: nothing is carried over from it.` });
  const plan = isObj(written.doc) ? written.doc : {};
  const profile = read.data.profile;
  if (read.files.profile === 'found' && !profile) warnings.push({ code: 'profile', message: `${paths().profile} could not be read: weekTarget is 0 and the unit is the plan's, else kg.` });
  const unit = (v: unknown) => (v === 'kg' || v === 'lb' ? v : null);
  const liftUnit = unit(plan['liftUnit']) ?? unit(profile?.units?.load) ?? 'kg';
  // The profile's days: the shorter ones (availability.shortSessions) are the short sessions, the rest lifting days.
  const days = profile?.availability?.daysPerWeek;
  const shortDays = profile?.availability?.shortSessions?.days ?? 0;
  const sensible = Number.isInteger(days) && days! >= 1 && days! <= 7 && Number.isInteger(shortDays) && shortDays >= 0 && shortDays <= days!;
  const carried = DRAFT_CARRIED.filter((k) => plan[k] !== undefined && (k !== 'liftUnit' || unit(plan[k]) !== null));
  const parts: Record<string, unknown> = {
    weekTarget: sensible ? { lift: days! - shortDays, short: shortDays } : { lift: 0, short: 0 },
    liftTypes: [],
    shortTypes: [],
    sessions: {},
    liftUnit,
    lifts: {},
    guide: {},
    ...Object.fromEntries(carried.filter((k) => k !== 'liftUnit').map((k) => [k, plan[k]])),
    rules: {},
  };
  const planData = Object.fromEntries((PLAN_DATA_KEYS as readonly string[]).filter((k) => k in parts).map((k) => [k, parts[k]]));
  const from = {
    liftUnit: unit(plan['liftUnit']) ? 'plan' : unit(profile?.units?.load) ? 'profile' : 'default',
    weekTarget: sensible ? 'profile' : 'default',
    carried: [...carried],
  };
  return out(envelope('draft', { sources: sourcesOf(read, root), planData, from }, warnings, []), pretty, 0);
}

/** A plan file for overlap: found, JSON, and a plan (a sessions object); else a usage error naming it. */
function overlapPlan(io: CliIo, file: string): Record<string, unknown> {
  const text = io.readText(file);
  if (text === null) throw new Usage(`--plans: file not found: ${file}`);
  let doc: unknown;
  try {
    doc = JSON.parse(text) as unknown;
  } catch {
    throw new Usage(`--plans: ${file} is not valid JSON`);
  }
  if (!isObj(doc) || !isObj(doc['sessions'])) throw new Usage(`--plans: ${file} is not a plan (no "sessions" object)`);
  return doc;
}

const r3 = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 1000);
const idList = (xs: readonly Movement[]) => xs.map((m) => m.id);

/**
 * How much plans share (overlap.ts): each draft's movements and shape, the
 * share of each one's movements the other holds, both ways, and with
 * --vault each against the plan as written. Read only.
 */
function cmdOverlap(flags: Record<string, string | true>, io: CliIo, pretty: boolean): CliResult {
  const v = flags['plans'];
  const files = typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : [];
  if (!files.length) throw new Usage('overlap needs --plans <a.json,b.json,...>: the plan files to compare, comma-separated');
  const drafts = files.map((file) => {
    const doc = overlapPlan(io, file);
    return { file, movements: planMovements(doc), shape: planShape(doc) };
  });
  const warnings: VaultWarning[] = [];
  let current: { file: string; movements: Movement[]; shape: ReturnType<typeof planShape> } | null = null;
  let vault: string | null = null;
  if (flags['vault'] !== undefined) {
    vault = vaultRoot(flags, io);
    const written = writtenPlan(io, vault);
    if (written.text === null) warnings.push({ code: 'no-plan', message: `There is no plan yet (${paths().plan}): the drafts are compared with each other only.` });
    else if (!isObj(written.doc) || !isObj(written.doc['sessions'])) warnings.push({ code: 'plan-data', message: `${paths().plan} is not a plan Pahlavan can read (not JSON, or no "sessions" object): the drafts are compared with each other only.` });
    else current = { file: paths().plan, movements: planMovements(written.doc), shape: planShape(written.doc) };
  }
  const matrix = drafts.map((a) => drafts.map((b) => r3(overlapShare(a.movements, b.movements))));
  const pairs = drafts.flatMap((a, i) => drafts.slice(i + 1).map((b) => ({ a: a.file, b: b.file, aInB: r3(overlapShare(a.movements, b.movements)), bInA: r3(overlapShare(b.movements, a.movements)), shared: idList(sharedMovements(a.movements, b.movements)) })));
  const againstCurrent = current
    ? drafts.map((d) => ({ draft: d.file, draftInCurrent: r3(overlapShare(d.movements, current.movements)), currentInDraft: r3(overlapShare(current.movements, d.movements)), shared: idList(sharedMovements(d.movements, current.movements)) }))
    : null;
  // Each share over the limit, one direction each: a's movements mostly in b. Against the plan as written, the draft's share (as check --redesign warns).
  const similar: { a: string; b: string; share: number; current: boolean }[] = [];
  drafts.forEach((a, i) =>
    drafts.forEach((b, j) => {
      const share = overlapShare(a.movements, b.movements);
      if (i !== j && overLimit(share)) similar.push({ a: a.file, b: b.file, share: r3(share)!, current: false });
    }),
  );
  if (current) for (const d of drafts) {
    const share = overlapShare(d.movements, current.movements);
    if (overLimit(share)) similar.push({ a: d.file, b: current.file, share: r3(share)!, current: true });
  }
  return out(envelope('overlap', { ...(vault !== null ? { vault } : {}), limit: OVERLAP_WARN_ABOVE, drafts, matrix, pairs, current, againstCurrent, similar }, warnings, []), pretty, 0);
}

// ---------------------------------------------------------------- the evidence library and the catalogue

/** The evidence library, whole or one topic. Read only, no vault. */
function cmdEvidence(flags: Record<string, string | true>, pretty: boolean): CliResult {
  const t = flags['topic'];
  if (t !== undefined && (typeof t !== 'string' || !(TOPIC_IDS as readonly string[]).includes(t))) throw new Usage(`--topic must be one of ${TOPIC_IDS.join(', ')}`);
  return out(envelope('evidence', buildEvidence((t as Topic | undefined) ?? null), [], []), pretty, 0);
}

/** The catalogue searched; --vault adds the plan's own ladders. Read only. */
function cmdCatalogue(flags: Record<string, string | true>, io: CliIo, pretty: boolean): CliResult {
  const text = (name: string): string | undefined => {
    const v = flags[name];
    if (v === undefined) return undefined;
    if (v === true || !v.trim()) throw new Usage(`--${name} needs a value`);
    return v.trim();
  };
  const query: CatalogueQuery = {};
  const pattern = text('pattern');
  if (pattern !== undefined) query.pattern = pattern as Pattern;
  const region = text('region');
  if (region !== undefined) query.region = region;
  const muscle = text('muscle');
  if (muscle !== undefined) query.muscle = muscle;
  const equipment = text('equipment');
  if (equipment !== undefined) query.equipment = equipment.split(',').map((x) => x.trim()).filter(Boolean);
  const level = text('level');
  if (level !== undefined) query.level = level as Level;
  const q = text('query');
  if (q !== undefined) query.query = q;
  const warnings: VaultWarning[] = [];
  let planLadders: unknown;
  if (flags['vault'] !== undefined) {
    const root = vaultRoot(flags, io);
    const plan = writtenPlan(io, root);
    if (plan.text === null) warnings.push({ code: 'no-plan', message: `There is no plan yet (${paths().plan}): the plan's own ladders are left out.` });
    else if (plan.doc === undefined) warnings.push({ code: 'json', message: `${paths().plan} is not valid JSON: the plan's own ladders are left out.` });
    else planLadders = (plan.doc as Record<string, unknown>)['ladders'];
  }
  let result: ReturnType<typeof searchCatalogue>;
  try {
    result = searchCatalogue(query, { planLadders });
  } catch (e) {
    if (e instanceof CatalogueQueryError) throw new Usage(e.message);
    throw e;
  }
  const { notes, ...payload } = result;
  // --md adds the readable page (docs/exercise-catalogue.md, Pahlavan's catalogue note): the whole catalogue with no filter, else the movements found.
  const unfiltered = Object.values(result.filters).every((v) => v === null);
  const md = flags['md'] === true ? { markdown: catalogueMarkdown(unfiltered ? {} : { ids: result.movements.map((m) => m.id) }) } : {};
  return out(envelope('catalogue', { ...payload, ...md }, [...warnings, ...notes], []), pretty, 0);
}

// ---------------------------------------------------------------- checkin

function cmdCheckinTemplate(flags: Record<string, string | true>, io: CliIo, pretty: boolean): CliResult {
  const root = vaultRoot(flags, io);
  const date = dateFlag(flags, 'date', io);
  const read = readVault(io, root, { asOf: date });
  const { data } = read;
  const sources = sourcesOf(read, root);
  const none = noPlanYet(read, 'the Sunday check-in reviews the plan\'s week, so it waits for one (the template below has no plan sessions to ask about).');
  if (none) data.warnings.unshift(none);
  const t0 = flags['time'];
  if (t0 !== undefined && (t0 === true || toMinutes(t0) === null)) throw new Usage('--time must be a time as HH:MM');
  // The last letter before this check-in (the template leaves out this Sunday's own).
  const last = [...data.checkins.weekly].reverse().find((w) => w.letter && (w.date ?? '') < reviewedSunday(date));
  const lastLetter = last?.letter ? { path: last.letter, focus: letterFocus(io.readText(joinPath(root, last.letter))) } : null;
  // Now: --time on the date, else the clock today (the Sunday's protein tick may still be ahead).
  const clock = io.clock?.() ?? { minutes: 12 * 60, offsetMinutes: 0 };
  const now = typeof t0 === 'string' ? { date, minutes: toMinutes(t0)! } : { date: io.today(), minutes: clock.minutes };
  const tr = readTracking(io, root, { configDir: CONFIG_DIR });
  const t = buildTemplate(data, date, lastLetter, { now, tracking: tr });
  return out(envelope('checkin', { action: 'template', sources, file: paths().checkins, ...t }, data.warnings, data.errors), pretty, data.errors.length ? 1 : 0);
}

function cmdCheckinAdd(flags: Record<string, string | true>, io: CliIo, pretty: boolean): CliResult {
  const root = vaultRoot(flags, io);
  const file = flags['file'];
  if (typeof file !== 'string') throw new Usage('checkin add needs --file <answers.json>');
  const write = flags['write'] === true;
  if (write && !io.writeCheckins) throw new Usage('this engine cannot write (no checkins writer)');
  const answers = readJson(io, file, 'answers file');
  const today = io.today();
  const read = readVault(io, root, { asOf: today });
  const none = noPlanYet(read, 'the answers are saved as they are; the plan\'s weeks wait for one.');
  // Problems elsewhere in the vault do not block the check-in log; its own do (addCheckins checks it).
  const elsewhere = [...(none ? [none] : []), ...read.data.errors.filter((e) => e.code !== 'checkins').map((e) => ({ code: 'elsewhere', message: e.message }))];
  const existingText = io.readText(joinPath(root, paths().checkins));
  const r = addCheckins({ existingText, answers, today, data: read.data });
  const payload = { action: 'add', file: paths().checkins, dryRun: !write, written: false, results: r.results, records: r.doc?.checkins.length ?? null };
  const warnings = [...elsewhere, ...r.warnings];
  if (r.errors.length || !r.doc) return out(envelope('checkin', payload, warnings, r.errors), pretty, 1);
  if (write) {
    io.writeCheckins!(root, `${JSON.stringify(r.doc, null, 2)}\n`);
    payload.written = true;
  }
  return out(envelope('checkin', payload, warnings, []), pretty, 0);
}

// ---------------------------------------------------------------- tracked, due, habits, bring-over

/** The vault's config folder, where Habit Nudges keeps its data.json (the app's default name). */
const CONFIG_DIR = '.obsidian';

function cmdTracking(command: 'tracked' | 'due' | 'habits' | 'bring-over', flags: Record<string, string | true>, io: CliIo, pretty: boolean): CliResult {
  const root = vaultRoot(flags, io);
  const date = dateFlag(flags, 'date', io);
  const read = readVault(io, root, { asOf: date });
  const none = noPlanYet(read, 'what follows the plan (its training days, the body record on the plan\'s calendar, the plan\'s desk breaks) waits for one.');
  const tr = readTracking(io, root, { configDir: CONFIG_DIR });
  const sources = { ...sourcesOf(read, root), tracking: tr.files };
  const warnings = [...(none ? [none] : []), ...read.data.warnings, ...tr.warnings];
  const errors = [...read.data.errors, ...tr.errors];
  const code = errors.length ? 1 : 0;
  // The plugin's quiet hours (its data.json, else its defaults): due holds every card in them, as Pahlavan does;
  // with them its "Did you train today?" setting, the card's time in due and in the held list.
  const quiet = command === 'tracked' || command === 'due' ? readQuietHours(io, root, CONFIG_DIR) : null;
  const quietSources = quiet ? { quietHours: { file: pahlavanSettingsPath(CONFIG_DIR), source: quiet.hours.source } } : {};
  if (quiet) warnings.push(...quiet.warnings);
  if (command === 'tracked') return out(envelope('tracked', { sources: { ...sources, ...quietSources }, ...buildTracked(read.data, tr, date, { quiet: quiet!.hours, didYouTrain: quiet!.didYouTrain }) }, warnings, errors), pretty, code);
  if (command === 'habits') {
    const item = flags['item'];
    if (item !== undefined && (typeof item !== 'string' || !(tr.tracking?.items ?? []).some((x) => x.id === item))) {
      throw new Usage(`--item must be a tracked item's id: ${(tr.tracking?.items ?? []).map((x) => x.id).join(', ') || '(nothing is tracked)'}`);
    }
    const clock = io.clock?.() ?? { minutes: 12 * 60, offsetMinutes: 0 };
    return out(envelope('habits', { sources, ...buildHabitStats(read.data, tr, date, { ...(typeof item === 'string' ? { item } : {}), offsetMinutes: clock.offsetMinutes }) }, warnings, errors), pretty, code);
  }
  if (command === 'bring-over') return out(envelope('bring-over', { sources, file: nudgesSettingsPath(CONFIG_DIR), ...buildBringOver(read.data, tr, date) }, warnings, errors), pretty, code);
  const t = flags['time'];
  if (t !== undefined && (t === true || toMinutes(t) === null)) throw new Usage('--time must be a time as HH:MM');
  const clock = io.clock?.() ?? { minutes: 12 * 60, offsetMinutes: 0 };
  const minutes = typeof t === 'string' ? toMinutes(t)! : clock.minutes;
  const now = momentAt(date, minutes, clock.offsetMinutes);
  // The coach step after the Sunday check-in, from the newest letter, as the plugin's reminders read it.
  const letter = readNewestLetter(io, root);
  const coach = coachStepsOf(read, date, letter).now?.value ?? null;
  return out(envelope('due', { sources: { ...sources, ...quietSources, letter: letter?.path ?? null }, ...buildDue(read.data, tr, now, { offsetMinutes: clock.offsetMinutes, quiet: quiet!.hours, settings: { didYouTrain: quiet!.didYouTrain }, coach }) }, warnings, errors), pretty, code);
}

// ---------------------------------------------------------------- track (the coach's write path)

const TRACK_ACTIONS = ['suggest', 'add', 'decline', 'accept', 'dismiss', 'morning', 'body-record', 'fresh', 'protein', 'apply', 'day', 'tick'] as const;
type TrackAction = (typeof TRACK_ACTIONS)[number];
const TRACK_FLAGS: Record<TrackAction, readonly string[]> = {
  suggest: ['file'],
  add: ['file'],
  decline: ['file'],
  apply: ['file'],
  accept: ['id'],
  dismiss: ['id'],
  morning: ['at', 'off'],
  'body-record': ['schedule', 'tape-from', 'tape-every', 'tests-from', 'tests-every'],
  fresh: [],
  protein: [],
  day: ['date'],
  tick: ['id', 'date', 'done', 'amount'],
};

/** The changes an action asks for, from its flags or its file. */
function trackChanges(action: TrackAction, flags: Record<string, string | true>, io: CliIo): { changes: TrackChanges | null; errors: VaultWarning[] } {
  switch (action) {
    case 'day':
    case 'tick':
      throw new Usage(`track ${action} runs on its own`);
    case 'suggest':
    case 'add':
    case 'decline':
    case 'apply': {
      const file = flags['file'];
      if (typeof file !== 'string') throw new Usage(`track ${action} needs --file <${action === 'apply' ? 'changes' : 'items'}.json>`);
      return readChanges(readJson(io, file, `${action} file`), action === 'apply' ? undefined : action);
    }
    case 'accept':
    case 'dismiss': {
      const id = flags['id'];
      if (typeof id !== 'string' || !id.trim()) throw new Usage(`track ${action} needs --id <suggestion id> (several: a,b)`);
      return { changes: { [action]: id.split(',').map((x) => x.trim()).filter(Boolean) }, errors: [] };
    }
    case 'morning': {
      const at = flags['at'];
      const off = flags['off'] === true;
      if (at === undefined && !off) throw new Usage('track morning needs --at HH:MM or --off');
      if (at !== undefined && (typeof at !== 'string' || toMinutes(at) === null)) throw new Usage('--at must be a time as HH:MM');
      return { changes: { morning: { ...(typeof at === 'string' ? { at } : {}), ...(off ? { on: false } : {}) } }, errors: [] };
    }
    case 'body-record': {
      const schedule = flags['schedule'];
      if (schedule !== 'plan' && schedule !== 'fixed') throw new Usage('track body-record needs --schedule plan or --schedule fixed');
      const fixed = ['tape-from', 'tape-every', 'tests-from', 'tests-every'];
      if (schedule === 'plan') {
        const extra = fixed.filter((f) => f in flags);
        if (extra.length) throw new Usage(`--schedule plan takes none of ${extra.map((f) => `--${f}`).join(', ')}`);
        return { changes: { bodyRecord: { schedule: 'plan' } }, errors: [] };
      }
      const missing = fixed.filter((f) => typeof flags[f] !== 'string');
      if (missing.length) throw new Usage(`--schedule fixed needs ${missing.map((f) => `--${f}`).join(', ')}`);
      for (const f of ['tape-from', 'tests-from']) if (!isIsoDate(flags[f])) throw new Usage(`--${f} must be a date as YYYY-MM-DD`);
      const n = (f: string) => {
        const v = Number(flags[f]);
        if (!Number.isInteger(v) || v < 1) throw new Usage(`--${f} must be a whole number of days`);
        return v;
      };
      return { changes: { bodyRecord: { schedule: 'fixed', tapeFrom: flags['tape-from'] as string, tapeEvery: n('tape-every'), testsFrom: flags['tests-from'] as string, testsEvery: n('tests-every') } }, errors: [] };
    }
    case 'fresh':
      return { changes: { bringOver: [] }, errors: [] };
    case 'protein':
      return { changes: { protein: true }, errors: [] };
  }
}

/**
 * The coach's write path: the changes into Coach/tracking.json through the
 * Habits screen's operations and session 1's merge, a dry run unless
 * --write. The write re-reads the file first (a change since the merge
 * merges again, once), writes it whole and reads it back.
 */
function cmdTrack(action: TrackAction, flags: Record<string, string | true>, io: CliIo, pretty: boolean): CliResult {
  const root = vaultRoot(flags, io);
  const write = flags['write'] === true;
  if (write && !io.writeTracking) throw new Usage('this engine cannot write (no tracking writer)');
  const today = io.today();
  const file = paths().tracking;
  const base = { action, file, today, dryRun: !write, written: false };
  const { changes, errors: readErrors } = trackChanges(action, flags, io);
  if (!changes) return out(envelope('track', { ...base, results: [] }, [], readErrors), pretty, 1);
  const read = readVault(io, root, { asOf: today });
  // Tracking needs no plan: a missing one is said only where a change waits for it (the body record on the plan's calendar).
  const none = noPlanYet(read, 'the body record waits for one.');
  const elsewhere = read.data.errors.map((e) => ({ code: 'elsewhere', message: e.message }));
  const path = joinPath(root, file);
  for (let attempt = 0; attempt < 2; attempt++) {
    const tr = readTracking(io, root, { configDir: CONFIG_DIR });
    if (tr.files.tracking === 'invalid') return out(envelope('track', { ...base, results: [] }, elsewhere, tr.errors), pretty, 1);
    const plan = planTrack(changes, { tracking: tr.tracking, today, protein: proteinFor(read.data, today).value, habits: tr.habits ? tr.habits.habits.map((h) => h.id) : null });
    const warnings = [...elsewhere, ...tr.warnings, ...plan.warnings];
    if (changes.bodyRecord?.schedule === 'plan' && none) warnings.push(none);
    const payload = (extra: Record<string, unknown>) => ({ ...base, results: plan.results, ...extra });
    if (plan.errors.length) return out(envelope('track', payload({}), warnings, plan.errors), pretty, 1);
    const text = io.readText(path);
    const m = mergeTracking(text, plan.ops);
    if (m.result === 'unreadable') return out(envelope('track', payload({}), warnings, [{ code: 'tracking', message: m.error }]), pretty, 1);
    if (m.result === 'invalid') return out(envelope('track', payload({}), warnings, m.errors.map((e) => ({ code: 'invalid', message: e }))), pretty, 1);
    if (m.result === 'conflict') return out(envelope('track', payload({ conflicts: m.conflicts }), warnings, [{ code: 'conflict', message: `${file} changed while merging: run it again` }]), pretty, 1);
    const after = m.result === 'merged' ? m.doc : tr.tracking;
    const summary = buildTracked(read.data, { ...tr, tracking: after, files: { ...tr.files, tracking: after ? 'found' : 'missing' } }, today);
    const handOver = { before: setUp(tr.tracking), after: setUp(after), note: handOverNote(setUp(tr.tracking), setUp(after)) };
    const report = payload({
      changed: m.result === 'merged' ? m.changed : [],
      ops: plan.ops,
      after: { items: summary.items.map(({ item: _item, ...rest }) => rest), suggestions: summary.suggestions, morning: summary.morning, bodyRecord: summary.bodyRecord.setting, bringOver: summary.bringOver },
      handOver,
    });
    if (m.result === 'unchanged' || !write) return out(envelope('track', report, warnings, []), pretty, 0);
    if (io.readText(path) !== text) continue; // changed since the merge: merge again
    io.writeTracking!(root, m.text);
    if (!landed(io.readText(path), m.check)) return out(envelope('track', report, warnings, [{ code: 'read-back', message: `${file} did not read back as written: check it before running again` }]), pretty, 1);
    return out(envelope('track', { ...report, written: true }, warnings, []), pretty, 0);
  }
  return out(envelope('track', { ...base, results: [] }, elsewhere, [{ code: 'busy', message: `${file} kept changing while merging: run it again in a moment` }]), pretty, 1);
}

// ---------------------------------------------------------------- body (the coach's write path into body-data.json)

/**
 * One date's morning fields, tape and tests into body-data.json through the
 * forms' merges, a dry run unless --write. The write re-reads the file first
 * (a change since the merge merges again, once), writes it whole and reads
 * each field back.
 */
function cmdBody(flags: Record<string, string | true>, io: CliIo, pretty: boolean): CliResult {
  const root = vaultRoot(flags, io);
  const fileFlag = flags['file'];
  if (typeof fileFlag !== 'string') throw new Usage('body needs --file <record.json>: {"date": "YYYY-MM-DD", "morning": {...}, "tape": {...}, "tests": {...}}');
  const write = flags['write'] === true;
  const replace = flags['replace'] === true;
  if (write && !io.writeBody) throw new Usage('this engine cannot write (no body writer)');
  const today = io.today();
  const file = paths().body;
  const base = { action: 'add', file, today, dryRun: !write, written: false, replace };
  const { input, errors: inputErrors } = readBodyInput(readJson(io, fileFlag, 'record file'), today);
  if (!input) return out(envelope('body', { ...base, results: [] }, [], inputErrors), pretty, 1);
  const path = joinPath(root, file);
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = io.readText(path);
    const plan = planBody(text, input, { replace });
    const report = { ...base, date: input.date, results: plan.results, after: plan.after };
    if (plan.errors.length) return out(envelope('body', report, plan.warnings, plan.errors), pretty, 1);
    if (plan.text === null || !write) return out(envelope('body', report, plan.warnings, []), pretty, 0);
    if (io.readText(path) !== text) continue; // changed since the merge: merge again
    io.writeBody!(root, plan.text);
    if (!bodyLanded(io.readText(path), input, plan)) return out(envelope('body', report, plan.warnings, [{ code: 'read-back', message: `${file} did not read back as written: check it before running again` }]), pretty, 1);
    return out(envelope('body', { ...report, written: true }, plan.warnings, []), pretty, 0);
  }
  return out(envelope('body', { ...base, results: [] }, [], [{ code: 'busy', message: `${file} kept changing while merging: run it again in a moment` }]), pretty, 1);
}

// ---------------------------------------------------------------- log: a session, a ladder level, a fixed top set

const LOG_ACTIONS = ['add', 'ladder', 'fix'] as const;
type LogAction = (typeof LOG_ACTIONS)[number];

/**
 * The coach's writes into fitness-log-data.json, as Pahlavan's Log panel
 * makes them (and the original log script did before): `add` a session (its checks,
 * its frozen exercise list and checklist, then the Workout habit's tick),
 * `ladder` a level, `fix` a logged lift. Each merges with the file as it is,
 * reads back, and is a dry run unless --write.
 */
function cmdLog(action: LogAction, flags: Record<string, string | true>, io: CliIo, pretty: boolean): CliResult {
  const root = vaultRoot(flags, io);
  const write = flags['write'] === true;
  if (write && !io.writeLog) throw new Usage('this engine cannot write (no log writer)');
  const today = io.today();
  const file = paths().log;
  const path = joinPath(root, file);
  const read = readVault(io, root, { asOf: today });
  const base = { action, file, today, dryRun: !write, written: false };
  // Before the first plan only a custom session can be logged (as Pahlavan's Log panel offers "Something else"); a ladder level or a fix needs the plan.
  const none = noPlanYet(read, action === 'add' ? 'only a custom session can be logged until there is one.' : `log ${action} needs the plan (its ladders and logged lifts).`);
  if (none && action !== 'add') return out(envelope('log', base, read.data.warnings, [none]), pretty, 1);
  const notes = none ? [none] : [];
  const plan = read.raw?.plan;
  const fail = (code: string, message: string, extra: Obj = {}) => out(envelope('log', { ...base, ...extra }, notes, [{ code, message }]), pretty, 1);
  const busy = () => fail('busy', `${file} kept changing while merging: run it again in a moment`);
  const lastSaved = (text: string | null, check: (doc: Obj) => boolean) => {
    try {
      const doc = JSON.parse(text ?? 'null') as unknown;
      return typeof doc === 'object' && doc !== null && check(doc as Obj);
    } catch {
      return false;
    }
  };

  if (action === 'add') {
    const fileFlag = flags['file'];
    if (typeof fileFlag !== 'string') throw new Usage('log add needs --file <session.json>: {"date", "type", "lift1", "lift2", "durationMin", ..., "skipped": [<line names>]}');
    const raw = readJson(io, fileFlag, 'session file');
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('invalid', 'the session file must hold one object');
    // The entry as the Log panel's save writes it: its checks, its frozen checklist and exercise list.
    const added = logAddEntry(read, raw, today);
    if (!added.ok) return fail('invalid', added.error);
    const entry = added.entry;
    const key = sessionKey(entry);
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = io.readText(path);
      const m = mergeLog(text, entry, { mode: 'add', ticks: { plan, today } });
      if (m.result === 'unreadable') return fail('unreadable', m.error);
      if (m.result === 'already') return out(envelope('log', { ...base, result: 'already', session: m.existing }, notes, []), pretty, 0);
      if (m.result !== 'added') return fail('invalid', `unexpected merge result: ${m.result}`);
      const report = { ...base, result: 'added', session: entry };
      if (!write) return out(envelope('log', report, notes, []), pretty, 0);
      if (io.readText(path) !== text) continue;
      io.writeLog!(root, m.text);
      if (!lastSaved(io.readText(path), (doc) => Array.isArray(doc['sessions']) && (doc['sessions'] as Obj[]).some((x) => sessionKey(x) === key && JSON.stringify(x) === JSON.stringify(entry)))) {
        return fail('read-back', `${file} did not read back as written: check it before running again`, { result: 'added', session: entry });
      }
      // The Workout habit's tick for the day, add-only (never unticks), unless --no-habit.
      let habit: string | null = null;
      if (flags['no-habit'] !== true) {
        const h = mergeHabit(io.readText(joinPath(root, paths().habits)), entry['date'] as string);
        if (h.result === 'ticked' && io.writeHabits) {
          try {
            io.writeHabits(root, h.text);
            habit = 'ticked';
          } catch (e) {
            habit = `not ticked: ${(e as Error).message}`;
          }
        } else habit = h.result === 'already' ? 'already ticked' : `habits file unreadable: not ticked`;
      }
      return out(envelope('log', { ...report, written: true, ...(habit ? { habit } : {}) }, notes, []), pretty, 0);
    }
    return busy();
  }

  if (action === 'ladder') {
    const id = flags['id'];
    if (typeof id !== 'string' || !id.trim()) throw new Usage('log ladder needs --id <ladder> --level <n> [--date D]');
    const level = Number(flags['level']);
    if (!Number.isInteger(level)) throw new Usage('--level takes the level number, 1 or more');
    const date = dateFlag(flags, 'date', io);
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = io.readText(path);
      const m = mergeLadder(text, plan, id.trim(), level, date);
      if (m.result === 'invalid') return fail('invalid', m.error);
      if (m.result === 'unreadable') return fail('unreadable', m.error);
      const report = { ...base, result: m.result, ladder: m.ladder, level: m.level, name: m.name, date };
      if (m.result === 'already' || !write) return out(envelope('log', report, [], []), pretty, 0);
      if (io.readText(path) !== text) continue;
      io.writeLog!(root, m.text);
      if (!lastSaved(io.readText(path), (doc) => {
        const hist = typeof doc['ladders'] === 'object' && doc['ladders'] !== null ? (doc['ladders'] as Obj)[m.ladder] : null;
        const last = Array.isArray(hist) ? (hist.at(-1) as Obj | undefined) : undefined;
        return last?.['level'] === level && last?.['date'] === date;
      })) return fail('read-back', `${file} did not read back as written: check it before running again`, report);
      return out(envelope('log', { ...report, written: true }, [], []), pretty, 0);
    }
    return busy();
  }

  // fix
  const date = flags['date'];
  const type = flags['type'];
  const lift = flags['lift'];
  if (typeof date !== 'string' || !isIsoDate(date) || typeof type !== 'string' || (lift !== 'lift1' && lift !== 'lift2')) throw new Usage('log fix needs --date YYYY-MM-DD --type T --lift lift1|lift2 [--label L] [--weight W] [--reps R] [--clear-planned]');
  const num = (k: string, whole: boolean) => {
    const v = flags[k];
    if (v === undefined) return null;
    const n = Number(v);
    if (v === true || !Number.isFinite(n) || (whole && !Number.isInteger(n))) throw new Usage(`--${k} takes ${whole ? 'a whole number' : 'a number'}`);
    return n;
  };
  const label = typeof flags['label'] === 'string' ? flags['label'] : null;
  const req = { date, type, label, lift, weight: num('weight', false), reps: num('reps', true), clearPlanned: flags['clear-planned'] === true } as const;
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = io.readText(path);
    const m = mergeFix(text, plan, req);
    if (m.result === 'invalid') return fail('invalid', m.error);
    if (m.result === 'unreadable') return fail('unreadable', m.error);
    const report = { ...base, result: m.result, date, type, ...(label ? { label } : {}), lift, changed: m.changed, before: m.before, after: m.after };
    if (m.result === 'already' || !write) return out(envelope('log', report, [], []), pretty, 0);
    if (io.readText(path) !== text) continue;
    io.writeLog!(root, m.text);
    const key = `${date}|${type}|${label ?? ''}`;
    if (!lastSaved(io.readText(path), (doc) => Array.isArray(doc['sessions']) && (doc['sessions'] as Obj[]).some((x) => sessionKey(x) === key && JSON.stringify(x[lift]) === JSON.stringify(m.after)))) {
      return fail('read-back', `${file} did not read back as written: check it before running again`, report);
    }
    return out(envelope('log', { ...report, written: true }, [], []), pretty, 0);
  }
  return busy();
}

// ---------------------------------------------------------------- folders

/** Where the vault keeps Pahlavan's files: the folders, where they came from, and every path from them. Read only. */
function cmdFolders(flags: Record<string, string | true>, io: CliIo, pretty: boolean): CliResult {
  vaultRoot(flags, io);
  return out(envelope('folders', { folders: folders(), source: foldersSource, settings: pahlavanSettingsPath(CONFIG_DIR), paths: paths() }, [], []), pretty, 0);
}

// ---------------------------------------------------------------- the baseline note (a fresh start)

/** The cycle's baseline note for a fresh start on the date: path, dates and text. Read only. */
function cmdBaseline(flags: Record<string, string | true>, io: CliIo, pretty: boolean): CliResult {
  const root = vaultRoot(flags, io);
  const date = dateFlag(flags, 'date', io);
  const read = readVault(io, root, { asOf: date });
  const note = baselineNote(date, read.data.plan.baselines ?? [], read.data.rules.rules.lightWeeks, read.data.rules.rules.tests.weeks);
  return out(envelope('baseline', { date, ...note.value, reason: note.reason }, [], []), pretty, 0);
}

// ---------------------------------------------------------------- food and eating (the eating plan)

/** The eating plan day to day, as the Food tab shows it. Read only. */
function cmdFood(flags: Record<string, string | true>, io: CliIo, pretty: boolean): CliResult {
  const root = vaultRoot(flags, io);
  const date = dateFlag(flags, 'date', io);
  const read = readVault(io, root, { asOf: date });
  const none = noPlanYet(read, 'the plan weeks and the day\'s session wait for one.');
  const tr = readTracking(io, root, { configDir: CONFIG_DIR });
  const f = buildFood(read, tr, date);
  // The eating plan's own problems are the command's; the other files' only say what they touch.
  const elsewhere = [...read.data.errors.filter((e) => e.code !== 'eating'), ...tr.errors].map((e) => ({ code: 'elsewhere', message: e.message }));
  return out({ ...f, sources: { ...sourcesOf(read, root), tracking: tr.files }, warnings: [...(none ? [none] : []), ...f.warnings, ...elsewhere] }, pretty, f.errors.length ? 1 : 0);
}

/** A number flag's value, or null when it isn't given; `what` says what it takes. */
function numberFlag(flags: Record<string, string | true>, name: string, what: string): number | null {
  const v = flags[name];
  if (v === undefined) return null;
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) throw new Usage(`--${name} takes ${what}`);
  return n;
}

/**
 * The eating plan's numbers for the diet job: resting energy, maintenance
 * at the coach's activity factor, the goal energy (the coach's rate, else
 * the goal's band), the floor, protein a meal, fat and fiber. Read only.
 */
function cmdEnergy(flags: Record<string, string | true>, io: CliIo, pretty: boolean): CliResult {
  const root = vaultRoot(flags, io);
  const date = dateFlag(flags, 'date', io);
  const palWhat = `the activity factor from diet.md's table: ${PAL_TABLE_TEXT}`;
  const pal = numberFlag(flags, 'pal', palWhat);
  if (pal === null) throw new Usage(`energy needs --pal N, ${palWhat}`);
  if (!palInTable(pal)) throw new Usage(`--pal must be from ${ENERGY.pal.min.toFixed(2)} to ${ENERGY.pal.max.toFixed(2)}, diet.md's table: ${PAL_TABLE_TEXT}`);
  const rateWhat = 'the weekly change as a fraction of body weight, from -0.05 to 0.05 (-0.0025 is -0.25 % a week)';
  const rate = numberFlag(flags, 'rate', rateWhat);
  if (rate !== null && Math.abs(rate) > 0.05) throw new Usage(`--rate takes ${rateWhat}`);
  const meals = numberFlag(flags, 'meals', 'the meals a day, a whole number from 1 to 8');
  if (meals !== null && (!Number.isInteger(meals) || meals < 1 || meals > 8)) throw new Usage('--meals takes the meals a day, a whole number from 1 to 8');
  const read = readVault(io, root, { asOf: date });
  const none = noPlanYet(read, 'the energy estimate needs none (it reads the profile, the weigh-ins and the eating plan).');
  const e = buildEnergy(read, date, { pal, rate, meals });
  // The profile's and the body record's problems are the command's; the other files' only say what they touch.
  const own = [paths().profile, paths().body];
  const isOwn = (x: VaultWarning) => x.code === 'profile' || x.code === 'body' || (x.code === 'json' && own.some((p) => x.message.startsWith(`${p} `)));
  const elsewhere = read.data.errors.filter((x) => !isOwn(x)).map((x) => ({ code: 'elsewhere', message: x.message }));
  const errors = [...read.data.errors.filter(isOwn), ...e.errors];
  return out(envelope('energy', { sources: sourcesOf(read, root), ...e.payload }, [...(none ? [none] : []), ...e.warnings, ...elsewhere], errors), pretty, errors.length ? 1 : 0);
}

/**
 * The eating plan into Coach/eating-plan.json: merged into the file as it
 * is (or replacing it with --replace), validated, a dry run unless --write.
 * The write re-reads the file first (a change since the merge merges again,
 * once), writes it whole and reads it back.
 */
function cmdEating(flags: Record<string, string | true>, io: CliIo, pretty: boolean): CliResult {
  const root = vaultRoot(flags, io);
  const fileFlag = flags['file'];
  if (typeof fileFlag !== 'string') throw new Usage('eating needs --file <plan.json>: the eating plan, or the part of it that changes');
  const write = flags['write'] === true;
  const replace = flags['replace'] === true;
  if (write && !io.writeEating) throw new Usage('this engine cannot write (no eating-plan writer)');
  const today = io.today();
  const file = paths().eating;
  const base = { action: replace ? 'replace' : 'merge', file, today, dryRun: !write, written: false, replace };
  const given = readJson(io, fileFlag, 'plan file');
  const path = joinPath(root, file);
  const read = readVault(io, root, { asOf: today });
  const tr = readTracking(io, root, { configDir: CONFIG_DIR });
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = io.readText(path);
    const plan = planEating({ existingText: text, given, replace, today, data: read.data, tracking: tr.tracking });
    const report = { ...base, result: plan.action, changed: plan.changed, plan: plan.doc, before: plan.before };
    if (plan.errors.length || !plan.doc) return out(envelope('eating', report, plan.warnings, plan.errors), pretty, 1);
    if (plan.text === null || !write) return out(envelope('eating', report, plan.warnings, []), pretty, 0);
    if (io.readText(path) !== text) continue; // changed since the merge: merge again
    io.writeEating!(root, plan.text);
    if (!eatingLanded(io.readText(path), plan.doc)) return out(envelope('eating', report, plan.warnings, [{ code: 'read-back', message: `${file} did not read back as written: check it before running again` }]), pretty, 1);
    return out(envelope('eating', { ...report, written: true }, plan.warnings, []), pretty, 0);
  }
  return out(envelope('eating', { ...base, result: null }, [], [{ code: 'busy', message: `${file} kept changing while merging: run it again in a moment` }]), pretty, 1);
}

// ---------------------------------------------------------------- track day and track tick (the daily wrap-up)

/** One date as the daily wrap-up reads it: the items due with their states, the session, the evening answer, the morning. Read only. */
function cmdTrackDay(flags: Record<string, string | true>, io: CliIo, pretty: boolean): CliResult {
  if (flags['write'] !== undefined) throw new Usage('track day only reads: it takes no --write (track tick writes)');
  const root = vaultRoot(flags, io);
  const date = dateFlag(flags, 'date', io);
  const read = readVault(io, root, { asOf: date });
  const none = noPlanYet(read, 'the day\'s planned session waits for one.');
  const tr = readTracking(io, root, { configDir: CONFIG_DIR });
  const errors = [...read.data.errors.map((e) => ({ code: 'elsewhere', message: e.message })), ...tr.errors];
  return out(envelope('track', { action: 'day', ...buildTrackDay(read.data, tr, date) }, [...(none ? [none] : []), ...read.data.warnings, ...tr.warnings], errors), pretty, tr.errors.length ? 1 : 0);
}

/**
 * Ticks and amounts for one date, as Pahlavan's Due today writes them: the
 * item's day in Coach/tracking.json and the linked habit in
 * habits-data.json, a dry run unless --write. Both files are merged as they
 * are, re-read just before writing (a change since merges again, once) and
 * read back. A habit change that cannot be written (no habits-data.json)
 * stops the whole write, so Pahlavan and the homepage never disagree.
 */
function cmdTrackTick(flags: Record<string, string | true>, io: CliIo, pretty: boolean): CliResult {
  const root = vaultRoot(flags, io);
  const write = flags['write'] === true;
  if (write && (!io.writeTracking || !io.writeHabits)) throw new Usage('this engine cannot write (no tracking or habits writer)');
  const idFlag = flags['id'];
  if (typeof idFlag !== 'string' || !idFlag.trim()) throw new Usage('track tick needs --id <item id> (several: a,b)');
  const ids = [...new Set(idFlag.split(',').map((x) => x.trim()).filter(Boolean))];
  const doneFlag = flags['done'];
  if (doneFlag !== undefined && doneFlag !== true && doneFlag !== 'true' && doneFlag !== 'false') throw new Usage('--done takes true or false');
  const done = doneFlag === undefined ? undefined : doneFlag !== 'false';
  const amountFlag = flags['amount'];
  const amount = amountFlag === undefined ? undefined : Number(amountFlag);
  if (amount !== undefined && (typeof amountFlag !== 'string' || !amountFlag.trim() || !Number.isFinite(amount))) throw new Usage('--amount must be a number (the day\'s total)');
  const today = io.today();
  const date = dateFlag(flags, 'date', io);
  const clock = io.clock?.();
  const at = clock ? toTs(momentAt(today, clock.minutes, clock.offsetMinutes).ms) : undefined;
  const read = readVault(io, root, { asOf: date });
  const trackingPath = joinPath(root, paths().tracking);
  const habitsPath = joinPath(root, paths().habits);
  const base = { action: 'tick', date, ids, dryRun: !write, written: false };
  for (let attempt = 0; attempt < 2; attempt++) {
    const tr = readTracking(io, root, { configDir: CONFIG_DIR });
    if (tr.files.tracking !== 'found') return out(envelope('track', { ...base, results: [] }, tr.warnings, tr.files.tracking === 'missing' ? [{ code: 'tracking', message: 'No Coach/tracking.json: nothing is tracked to tick' }] : tr.errors), pretty, 1);
    const plan = planTick(read.data, tr, { ids, date, ...(done !== undefined ? { done } : {}), ...(amount !== undefined ? { amount } : {}), ...(at ? { at } : {}) }, today);
    const warnings = [...plan.warnings];
    const payload = (extra: Record<string, unknown>) => ({ ...base, results: plan.results, ...extra });
    if (plan.errors.length) return out(envelope('track', payload({}), warnings, plan.errors), pretty, 1);
    const tText = io.readText(trackingPath);
    const hText = io.readText(habitsPath);
    const t = plan.ops.length ? mergeTracking(tText, plan.ops) : ({ result: 'unchanged' } as const);
    if (t.result === 'unreadable') return out(envelope('track', payload({}), warnings, [{ code: 'tracking', message: t.error }]), pretty, 1);
    if (t.result === 'invalid') return out(envelope('track', payload({}), warnings, t.errors.map((e) => ({ code: 'invalid', message: e }))), pretty, 1);
    if (t.result === 'conflict') return out(envelope('track', payload({ conflicts: t.conflicts }), warnings, [{ code: 'conflict', message: `${paths().tracking} changed while merging: run it again` }]), pretty, 1);
    const h = plan.habits.length ? mergeHabitChanges(hText, plan.habits) : ({ result: 'unchanged', skipped: [] } as const);
    if (h.result === 'unreadable') return out(envelope('track', payload({}), warnings, [{ code: 'habits', message: `${h.error}: the linked habit could not be ticked, so nothing is written` }]), pretty, 1);
    for (const sk of h.skipped) warnings.push({ code: 'habit-skipped', message: `The ${sk.habit} habit was skipped: ${sk.why}` });
    const tAfter = t.result === 'merged' ? t.doc : tr.tracking;
    const hAfter = h.result === 'merged' ? habitsView(JSON.parse(h.text)) : tr.habits;
    const after = buildTrackDay(read.data, { ...tr, tracking: tAfter, habits: hAfter }, date);
    const report = payload({
      changed: { tracking: t.result === 'merged' ? t.changed : [], habits: h.result === 'merged' ? h.changed : [] },
      ops: plan.ops,
      habitChanges: plan.habits,
      after: { items: after.items.filter((x) => ids.includes(x.value.id)), open: after.open },
    });
    if ((t.result === 'unchanged' && h.result === 'unchanged') || !write) return out(envelope('track', report, warnings, []), pretty, 0);
    if (io.readText(trackingPath) !== tText || io.readText(habitsPath) !== hText) continue; // changed since the merge: merge again
    if (t.result === 'merged') {
      io.writeTracking!(root, t.text);
      if (!landed(io.readText(trackingPath), t.check)) return out(envelope('track', report, warnings, [{ code: 'read-back', message: `${paths().tracking} did not read back as written: check it before running again` }]), pretty, 1);
    }
    if (h.result === 'merged') {
      io.writeHabits!(root, h.text);
      if (!habitsLanded(io.readText(habitsPath), h.changed)) return out(envelope('track', { ...report, written: t.result === 'merged' }, warnings, [{ code: 'read-back', message: `${paths().habits} did not read back as written: check it before running again` }]), pretty, 1);
    }
    return out(envelope('track', { ...report, written: true }, warnings, []), pretty, 0);
  }
  return out(envelope('track', { ...base, results: [] }, [], [{ code: 'busy', message: 'Coach/tracking.json or habits-data.json kept changing while merging: run it again in a moment' }]), pretty, 1);
}

// ---------------------------------------------------------------- inbox (the phone's entries)

/** Each text's writer: the file it is, at its fixed place. */
const TEXT_WRITER: Record<InboxTextKey, keyof CliIo> = { log: 'writeLog', body: 'writeBody', habits: 'writeHabits', tracking: 'writeTracking', nudges: 'writeNudges' };

/** The inbox's entry files with their texts, and the applied entries already there (paths under the inbox). */
function inboxFiles(io: CliIo, root: string): { files: InboxFile[]; applied: string[] } {
  const dir = joinPath(root, paths().inbox);
  const files: InboxFile[] = [];
  for (const name of (io.listDir(dir) ?? []).filter(isEntryFile).sort()) {
    const text = io.readText(`${dir}/${name}`);
    if (text !== null) files.push({ file: name, text });
  }
  const appliedDir = joinPath(root, INBOX_PATHS.applied);
  const applied: string[] = [];
  for (const month of io.listDir(appliedDir) ?? []) for (const name of io.listDir(`${appliedDir}/${month}`) ?? []) applied.push(`${INBOX_FILES.applied}/${month}/${name}`);
  return { files, applied };
}

const readTexts = (io: CliIo, root: string): InboxTexts => Object.fromEntries(INBOX_TEXT_KEYS.map((k) => [k, io.readText(joinPath(root, inboxTextPaths()[k]))])) as InboxTexts;

/**
 * The phone's entries: each checked and applied (on the files as they are,
 * in the order sent) through the same merges as Pahlavan's screens, a dry
 * run unless --write. The write re-reads every file first (a change since
 * the merge merges again, once), writes each changed file whole and reads it
 * back, then moves the applied entries to applied/<YYYY-MM>/ and rewrites
 * refused.json. Refused entries stay where they are; a refusal is the
 * entry's outcome, not the command's error.
 */
function cmdInbox(flags: Record<string, string | true>, io: CliIo, pretty: boolean): CliResult {
  const root = vaultRoot(flags, io);
  const write = flags['write'] === true;
  if (write && (INBOX_TEXT_KEYS.some((k) => !io[TEXT_WRITER[k]]) || !io.writeInbox || !io.moveInbox)) throw new Usage('this engine cannot write (no inbox writers)');
  const today = io.today();
  const base = { action: 'import', dir: paths().inbox, today, dryRun: !write, written: false };
  const refusedPath = joinPath(root, INBOX_PATHS.refused);
  for (let attempt = 0; attempt < 2; attempt++) {
    const { files, applied } = inboxFiles(io, root);
    const read = readVault(io, root, { asOf: today });
    const tr = readTracking(io, root, { configDir: CONFIG_DIR });
    const texts = readTexts(io, root);
    const plan = applyInbox({ read, tracking: tr, texts, applied }, files, today);
    const refused = refusedOf(plan.results);
    const moves = plan.results.flatMap((r) => (r.status === 'refused' ? [] : [{ from: r.file, to: r.moveTo }]));
    // refused.json is rewritten each run; with no entries and no file, there is nothing to say.
    const refusedWas = io.readText(refusedPath);
    const refusedNext = files.length || refusedWas !== null ? refusedText(refused) : null;
    const count = (s: string) => plan.results.filter((r) => r.status === s).length;
    const report = {
      ...base,
      counts: { files: files.length, apply: count('apply'), unchanged: count('unchanged'), refused: refused.length },
      entries: plan.results,
      changed: plan.changed.map((k) => inboxTextPaths()[k]),
      moves,
      refused,
    };
    const warnings = refused.map((r) => ({ code: 'refused', message: refusedLine(r) }));
    if (!write || (!plan.changed.length && !moves.length && refusedNext === refusedWas)) return out(envelope('inbox', report, warnings, []), pretty, 0);
    if (INBOX_TEXT_KEYS.some((k) => io.readText(joinPath(root, inboxTextPaths()[k])) !== texts[k])) continue; // changed since the merge: merge again
    for (const k of plan.changed) {
      const text = plan.texts[k]!;
      (io[TEXT_WRITER[k]] as (root: string, text: string) => void)(root, text);
      if (io.readText(joinPath(root, inboxTextPaths()[k])) !== text) return out(envelope('inbox', report, warnings, [{ code: 'read-back', message: `${inboxTextPaths()[k]} did not read back as written: check it before running again` }]), pretty, 1);
    }
    for (const m of moves) io.moveInbox!(root, m.from, m.to);
    if (refusedNext !== null && refusedNext !== refusedWas) io.writeInbox!(root, 'refused.json', refusedNext);
    return out(envelope('inbox', { ...report, written: true }, warnings, []), pretty, 0);
  }
  return out(envelope('inbox', { ...base, entries: [] }, [], [{ code: 'busy', message: 'the vault\'s files kept changing while merging the inbox: run it again in a moment' }]), pretty, 1);
}

/** Coach/Inbox/phone.json for today, a dry run unless --write (written only when it changes, then read back). */
function cmdInboxPhone(flags: Record<string, string | true>, io: CliIo, pretty: boolean): CliResult {
  const root = vaultRoot(flags, io);
  const write = flags['write'] === true;
  if (write && !io.writeInbox) throw new Usage('this engine cannot write (no inbox writer)');
  const today = io.today();
  const read = readVault(io, root, { asOf: today });
  const none = noPlanYet(read, 'the phone lists the plan\'s sessions once there is one.');
  const tr = readTracking(io, root, { configDir: CONFIG_DIR });
  const phone = buildPhone(read, tr, today);
  const text = phoneText(phone);
  const path = joinPath(root, INBOX_PATHS.phone);
  const unchanged = io.readText(path) === text;
  const report = { action: 'phone', file: INBOX_PATHS.phone, today, dryRun: !write, written: false, unchanged, phone };
  const elsewhere = [...(none ? [none] : []), ...[...read.data.errors, ...tr.errors].map((e) => ({ code: 'elsewhere', message: e.message }))];
  if (!write || unchanged) return out(envelope('inbox', report, elsewhere, []), pretty, 0);
  io.writeInbox!(root, 'phone.json', text);
  if (io.readText(path) !== text) return out(envelope('inbox', report, elsewhere, [{ code: 'read-back', message: `${INBOX_PATHS.phone} did not read back as written: check it before running again` }]), pretty, 1);
  return out(envelope('inbox', { ...report, written: true }, elsewhere, []), pretty, 0);
}

function handOverNote(before: boolean, after: boolean): string {
  if (before) return 'Pahlavan was set up in this vault already: Habit Nudges has handed its health and fitness reminders over.';
  if (after) return 'Pahlavan is set up from this write: Habit Nudges stops its body check-in, water, stand-ups and desk breaks, and its check-ins stop asking about the health and fitness habits (its settings tab lists them).';
  return 'Pahlavan is not set up yet (no item tracked): Habit Nudges keeps its reminders.';
}

// ---------------------------------------------------------------- run

/**
 * The numbers and names the coach's docs quote, read from the constants the
 * engine computes with: `--version --json` gives them, and the skill's
 * self-check fails a ship whose docs say otherwise.
 */
export function engineFacts() {
  const lw = legacyRules().lightWeeks;
  return {
    calibration: { rir: CALIBRATION.rir },
    volume: {
      minimum: VOLUME.bands.minimum,
      efficient: [...VOLUME.bands.efficient],
      priority: [...VOLUME.bands.priority],
      cap: [...VOLUME.bands.cap],
      perSessionDirect: VOLUME.perSessionDirectMax,
      indirect: VOLUME.indirect,
    },
    /** Pahlavan's light week when the plan sets no rule (`rules.lightWeeks`). */
    lightWeeks: { every: lw.every, sets: lw.sets, load: lw.load, rirAdd: lw.rirAdd },
    regions: { coverage: REGION_RULES.coverage, declared: REGION_RULES.declared },
    planData: {
      keys: [...PLAN_DATA_KEYS],
      itemKeys: [...ITEM_KEYS],
      liftKeys: [...LIFT_KEYS],
      /** The kinds `rules` holds (Express on a short day is `express.short`). */
      ruleKinds: RULE_KINDS.filter((k) => k !== 'express'),
    },
    /** The Why this plan card (plan-data's `why`, plan-why.ts): every split family it accounts for, with its label, and the evidence grades a reason may carry. */
    why: { splitKinds: SPLIT_KINDS.map((id) => ({ id, label: SPLIT_LABELS[id] })), grades: [...WHY_GRADES] },
    /** Every kind of thing plan-data can't hold (plan-data.ts, UNEXPRESSIBLE): the coach's docs name only these. */
    unexpressible: [...UNEXPRESSIBLE],
    /** A redesign's limit: over this share of its movements also in the plan as written warns (similar-to-current). */
    redesign: { overlapWarnAbove: OVERLAP_WARN_ABOVE },
    /** The eating plan's energy constants (`energy`): Mifflin-St Jeor, the activity factors, the floors, the 1 % limit, protein a meal, fat and fiber. */
    energy: energyFacts(),
  };
}

export function run(argv: readonly string[], io?: CliIo): CliResult {
  const args = parseArgs(argv);
  const pretty = args.flags['pretty'] === true;
  const usage = (message: string): CliResult => ({
    code: 2,
    stdout: `${JSON.stringify({ command: args.command, engine: ENGINE_VERSION, schema: SCHEMA_VERSION, ok: false, errors: [{ code: 'usage', message }] }, null, pretty ? 2 : undefined)}\n`,
    stderr: `engine: ${message}\nRun "engine --help" for the commands.\n`,
  });

  if (args.errors.length) return usage(args.errors.join('; '));
  if (args.command === null) {
    const flags = Object.keys(args.flags).filter((f) => f !== 'pretty' && f !== 'json');
    if (args.flags['version'] === true && flags.length === 1) {
      return args.flags['json'] === true ? out({ engine: ENGINE_VERSION, schema: SCHEMA_VERSION, facts: engineFacts() }, pretty, 0) : { code: 0, stdout: `${VERSION_LINE}\n`, stderr: '' };
    }
    if (flags.length === 0 || (args.flags['help'] === true && flags.length === 1)) return { code: 0, stdout: HELP, stderr: '' };
    return usage(`unknown arguments: ${argv.join(' ')}`);
  }
  const allowed = COMMAND_FLAGS[args.command];
  if (!allowed) {
    const removed = Object.hasOwn(REMOVED_COMMANDS, args.command) ? REMOVED_COMMANDS[args.command] : undefined;
    return usage(`unknown command: ${args.command}${removed ? ` (${removed})` : ''}`);
  }
  if (args.flags['help'] === true) return { code: 0, stdout: HELP, stderr: '' };
  const unknown = Object.keys(args.flags).filter((f) => !allowed.includes(f) && !GLOBAL_FLAGS.includes(f));
  if (unknown.length) return usage(`${args.command} does not take ${unknown.map((f) => `--${f}`).join(', ')}`);
  if (args.command === 'checkin') {
    if (args.positionals.length !== 1 || !['template', 'add'].includes(args.positionals[0]!)) return usage('checkin takes "template" or "add"');
    const sub = args.positionals[0]!;
    const wrong = sub === 'template' ? ['file', 'write'].filter((f) => f in args.flags) : ['date'].filter((f) => f in args.flags);
    if (wrong.length) return usage(`checkin ${sub} does not take ${wrong.map((f) => `--${f}`).join(', ')}`);
  } else if (args.command === 'track') {
    const action = args.positionals[0];
    if (args.positionals.length !== 1 || !(TRACK_ACTIONS as readonly string[]).includes(action!)) return usage(`track takes one of: ${TRACK_ACTIONS.join(', ')}`);
    const allowedHere = ['vault', 'write', ...TRACK_FLAGS[action as TrackAction]];
    const wrong = Object.keys(args.flags).filter((f) => !allowedHere.includes(f) && !GLOBAL_FLAGS.includes(f));
    if (wrong.length) return usage(`track ${action} does not take ${wrong.map((f) => `--${f}`).join(', ')}`);
  } else if (args.command === 'log') {
    if (args.positionals.length !== 1 || !(LOG_ACTIONS as readonly string[]).includes(args.positionals[0]!)) return usage(`log takes one of: ${LOG_ACTIONS.join(', ')}`);
  } else if (args.command !== 'validate' && args.positionals.length) return usage(`${args.command} takes no positional arguments: ${args.positionals.join(' ')}`);
  if (!io) return usage('this command needs file access (run the built engine.cjs)');

  try {
    switch (args.command) {
      case 'validate':
        return cmdValidate(args.positionals, args.flags, io, pretty);
      case 'check':
        return cmdCheck(args.flags, io, pretty);
      case 'plan-write':
        return cmdPlanWrite(args.flags, io, pretty);
      case 'draft':
        return cmdDraft(args.flags, io, pretty);
      case 'overlap':
        return cmdOverlap(args.flags, io, pretty);
      case 'evidence':
        return cmdEvidence(args.flags, pretty);
      case 'catalogue':
        return cmdCatalogue(args.flags, io, pretty);
      case 'checkin':
        return args.positionals[0] === 'template' ? cmdCheckinTemplate(args.flags, io, pretty) : cmdCheckinAdd(args.flags, io, pretty);
      case 'tracked':
      case 'due':
      case 'habits':
      case 'bring-over':
        return cmdTracking(args.command, args.flags, io, pretty);
      case 'track':
        if (args.positionals[0] === 'day') return cmdTrackDay(args.flags, io, pretty);
        if (args.positionals[0] === 'tick') return cmdTrackTick(args.flags, io, pretty);
        return cmdTrack(args.positionals[0] as TrackAction, args.flags, io, pretty);
      case 'body':
        return cmdBody(args.flags, io, pretty);
      case 'log':
        return cmdLog(args.positionals[0] as LogAction, args.flags, io, pretty);
      case 'food':
        return cmdFood(args.flags, io, pretty);
      case 'energy':
        return cmdEnergy(args.flags, io, pretty);
      case 'folders':
        return cmdFolders(args.flags, io, pretty);
      case 'baseline':
        return cmdBaseline(args.flags, io, pretty);
      case 'eating':
        return cmdEating(args.flags, io, pretty);
      case 'inbox':
        return args.flags['phone'] === true ? cmdInboxPhone(args.flags, io, pretty) : cmdInbox(args.flags, io, pretty);
      default: {
        const root = vaultRoot(args.flags, io);
        const date = dateFlag(args.flags, 'date', io);
        if (args.command === 'next' && (typeof args.flags['lift'] !== 'string' || !args.flags['lift'].trim())) return usage('next needs --lift "<name>"');
        // review and session take a draft (--plan) through the same reading as plan-data.json.
        const draft = draftFlag(args.flags, io);
        const read = readVault(io, root, { asOf: date, ...(draft ? { plan: draft } : {}) });
        // A fresh vault (no plan yet) still answers: readiness, the body record and the log; the plan's own numbers wait for one.
        const none = noPlanYet(read, NO_PLAN_WAITS[args.command] ?? 'the plan\'s numbers wait for one.');
        const { data } = read;
        if (none) data.warnings.unshift(none);
        const sources = sourcesOf(read, root);
        const code = data.errors.length ? 1 : 0;
        if (args.command === 'review') {
          // The review's own warnings: a session over its day's length, a pain over 3 of 10 in the last week, exercises skipped for pain or equipment twice in 4 weeks, each once, each finding not confirmed with the user, and Pahlavan in the vault on another version than this coach.
          const review = buildReview(data, date);
          const own = [...[timeWarning(review.time), painWarning(data, date)].filter((w): w is VaultWarning => w !== null), ...skipWarnings(review.skips), ...findingWarnings(data), ...[versionWarning(io, root, CONFIG_DIR, ENGINE_VERSION)].filter((w): w is VaultWarning => w !== null)];
          return out(envelope('review', { sources, ...review }, [...data.warnings, ...own], data.errors), pretty, code);
        }
        if (args.command === 'readiness') return out(envelope('readiness', { sources, ...buildReadiness(data, date) }, data.warnings, data.errors), pretty, code);
        if (args.command === 'session') {
          const mode = args.flags['mode'] ?? 'full';
          if (mode !== 'full' && mode !== 'express' && mode !== 'hotel') return usage('--mode must be full, express or hotel');
          const type = args.flags['type'];
          // No plan yet: no session to pick or freeze (a data state, not a wrong flag).
          if (none && (type !== undefined || args.flags['freeze'] === true)) return out(envelope('session', { sources }, data.warnings, [{ code: 'no-plan', message: `There is no plan yet (${paths().plan}): there are no plan sessions to ${args.flags['freeze'] === true ? 'freeze' : 'pick from'} until there is one.` }]), pretty, 1);
          if (type !== undefined && (typeof type !== 'string' || !data.plan.types.some((t) => t.type === type))) return usage(`--type must be one of the plan's sessions: ${data.plan.types.map((t) => t.type).join(', ')}`);
          if (args.flags['freeze'] === true) {
            // The exercise list a log entry freezes, as the Log panel's save writes it (for a session logged elsewhere).
            if (typeof type !== 'string') return usage(`session --freeze needs --type, one of the plan's sessions: ${data.plan.types.map((t) => t.type).join(', ')}`);
            const name = (k: 'lift1' | 'lift2') => {
              const v = args.flags[k];
              if (v === true || (typeof v === 'string' && !v.trim())) throw new Usage(`--${k} takes the lift done, by name`);
              return typeof v === 'string' ? v.trim() : null;
            };
            const skip = args.flags['skip'];
            if (skip === true || (typeof skip === 'string' && !skip.trim())) throw new Usage('--skip takes the lines skipped, by name: "<name>,<name>"');
            // Split at every comma; the list rejoins the pieces of a name that has one.
            const r = frozenList(read, { date, type, mode, lifts: [name('lift1'), name('lift2')], ...(typeof skip === 'string' ? { skip: skip.split(',') } : {}) }, io.today());
            if (!r.ok) return usage(`session --freeze: ${r.error}`);
            return out(envelope('session', { sources, freeze: r.list }, data.warnings, data.errors), pretty, code);
          }
          if (args.flags['lift1'] !== undefined || args.flags['lift2'] !== undefined || args.flags['skip'] !== undefined) return usage('--lift1, --lift2 and --skip go with --freeze');
          return out(envelope('session', { sources, ...buildSession(data, date, mode, { type: type ?? null }) }, data.warnings, data.errors), pretty, code);
        }
        const query = args.flags['lift'] as string;
        const exercise = findLift(data, query);
        if (!exercise && none) return out(envelope('next', { sources }, data.warnings, [{ code: 'no-plan', message: `There is no plan yet (${paths().plan}) and no lift named "${query}" was logged: ${NO_PLAN_WAITS['next']}` }]), pretty, 1);
        if (!exercise) return usage(`no lift named "${query}"; known lifts: ${knownLifts(data).join(', ')}`);
        const { warnings: liftWarnings, ...next } = buildNext(data, date, exercise);
        return out(envelope('next', { sources, ...next }, [...data.warnings, ...liftWarnings], data.errors), pretty, code);
      }
    }
  } catch (e) {
    if (e instanceof Usage) return usage(e.message);
    if (e instanceof DataError) return out(envelope(args.command, {}, [], [{ code: 'data', message: e.message }]), pretty, 1);
    throw e;
  }
}
