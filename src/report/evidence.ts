// `engine evidence`: the rules the coach designs from, as data. Each rule has
// its number (read from the constant the engine computes and checks with,
// never retyped, so the library and the engine cannot disagree), its grade
// on rules.md's scale, a short note and its sources. The plan check takes
// its warnings' grades from here (`checkGrade`), so a rule's grade is written
// once. Facts only: what the evidence says and what Pahlavan holds a plan
// to, never a choice for a particular person; the coach designs.
//
// Beside the rules: the muscle regions with the catalogue movements that bias
// each (in the one display order, catalogue.ts) and the regions the evidence
// does not support; how a finding is confirmed; and the standing rules a plan
// declares, each with the old default that stands in when it does not.

import { CALIBRATION } from '../core/calibration.ts';
import { CONCURRENT } from '../core/concurrent.ts';
import { EFFORT_TARGETS, GRADE_TEXT, GRADES, MAX_LOADING_RUN, REP_LIMITS, SOURCES, STRENGTH, TEMPO, type Grade, type Source } from '../core/data/evidence.ts';
import { CATALOGUE } from '../core/data/exercises.ts';
import { nearestText, REGIONS, UNSUPPORTED_REGIONS } from '../core/data/regions.ts';
import { DELOAD } from '../core/deload.ts';
import { EMPHASIS_FINDINGS, SELF_CHECK_FINDINGS } from '../core/findings.ts';
import { MISSED } from '../core/missed.ts';
import { CONDITIONING } from '../core/plan/conditioning.ts';
import { REST } from '../core/plan/dose.ts';
import { PROGRESSION } from '../core/progression.ts';
import { READINESS } from '../core/readiness.ts';
import { legacyLift, legacyRules, legacyRulesJson, LIFT_RULES, RULE_KINDS, RULE_PATHS, ruleText } from '../core/rules.ts';
import { LOAD_CAP, screeningCaps } from '../core/safety.ts';
import { PRIORITY_ROOM, PULL_PUSH, PULL_PUSH_GOAL, REGION_RULES, VOLUME } from '../core/volume.ts';
import { rankMovements } from './catalogue.ts';

export const TOPICS = [
  { id: 'volume', title: 'Weekly sets per muscle' },
  { id: 'effort', title: 'Effort: reps in reserve' },
  { id: 'load', title: 'Rep ranges, load and frequency' },
  { id: 'rest', title: 'Rest between sets' },
  { id: 'tempo', title: 'Tempo' },
  { id: 'order', title: 'Exercise order' },
  { id: 'range-of-motion', title: 'Range of motion and muscle length' },
  { id: 'exercise-choice', title: 'Exercise choice and variation' },
  { id: 'progression', title: 'Progression' },
  { id: 'light-weeks', title: 'Light weeks' },
  { id: 'calibration', title: 'The calibration week and missed time' },
  { id: 'concurrent', title: 'Concurrent training and cardio' },
  { id: 'activity', title: 'Weekly activity' },
  { id: 'regions', title: 'Muscle regions' },
  { id: 'findings', title: 'Findings and their confirmation' },
  { id: 'standing-rules', title: 'Standing rules a plan declares' },
] as const;
export type Topic = (typeof TOPICS)[number]['id'];
export const TOPIC_IDS: readonly Topic[] = TOPICS.map((t) => t.id);

type Range = readonly [number, number];
/** A number, a range, a few named numbers or ranges, a list, a word, or none (a rule without a number). */
export type EvidenceValue = number | Range | string | readonly string[] | { readonly [k: string]: number | Range | string | null } | null;

export interface EvidenceRule {
  id: string;
  topic: Topic;
  title: string;
  value: EvidenceValue;
  /** What the value counts ("sets a week", "RIR"); null without a number. */
  unit: string | null;
  grade: Grade;
  note: string;
  sources: readonly Source[];
  /** The engine constants the value is read from, by name, so a reader can find them. */
  engine?: readonly string[];
  /** The plan check's warnings that hold a plan to the rule (each takes this grade). */
  checks?: readonly string[];
  /** The number is the evidence library's own (data/evidence.ts, named in `engine`): no engine calculation or check uses it, and the coach designs to it. */
  libraryOnly?: true;
}

const S = SOURCES;
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const range = (r: readonly number[]): Range => [r[0]!, r[1]!];
const rirText = (r: Range) => `${r[0]}–${r[1]}`;

/** Every rule of the library, in topic order. */
export function evidenceRules(): EvidenceRule[] {
  const legacy = legacyLift();
  const miss = legacy.onMiss === 'hold' ? null : legacy.onMiss;
  const conservativeRir = screeningCaps('conservative').value.minRir;
  const longLength = CATALOGUE.filter((e) => e.longLength?.length).map((e) => e.id);
  return [
    // ---------------------------------------------------------------- volume
    {
      id: 'volume.counting',
      topic: 'volume',
      title: 'How sets count',
      value: { direct: 1, indirect: VOLUME.indirect },
      unit: 'sets credited per set done',
      grade: 'heuristic',
      note: `A set counts 1 for each main muscle (direct) and ${VOLUME.indirect} for each helping muscle (indirect): the convention Pelland 2025 counted with, an assumption.`,
      sources: [S.pelland2025],
      engine: ['VOLUME.indirect'],
    },
    {
      id: 'volume.dose-response',
      topic: 'volume',
      title: 'More sets, more growth, with diminishing returns',
      value: null,
      unit: null,
      grade: 'strong',
      note: 'Growth rises with weekly sets, with diminishing returns and no clear plateau (about +0.37 % per weekly set); strength needs few sets. The shape is Strong, the tier numbers Moderate.',
      sources: [S.pelland2025, S.schoenfeld2017a, S.bazValle2022, S.schoenfeld2019b, S.acsm2026],
    },
    {
      id: 'volume.minimum',
      topic: 'volume',
      title: 'Minimum dose',
      value: VOLUME.minimum,
      unit: 'sets a week',
      grade: 'moderate',
      note: 'The minimum effective dose: maintenance, and the floor for any muscle.',
      sources: [S.pelland2025, S.pelland2025preprint, S.acsm2026],
      engine: ['VOLUME.minimum', 'VOLUME.bands.minimum'],
      checks: ['volume-below-minimum'],
    },
    {
      id: 'volume.efficient',
      topic: 'volume',
      title: 'Efficient tier',
      value: range(VOLUME.bands.efficient),
      unit: 'sets a week',
      grade: 'moderate',
      note: 'Most muscles, most of the time: the most growth per set. Per-person needs are unknown up front, so a plan starts here and the mesocycle review moves a muscle about 2 sets (H).',
      sources: [S.pelland2025, S.pelland2025preprint],
      engine: ['VOLUME.bands.efficient'],
    },
    {
      id: 'volume.priority',
      topic: 'volume',
      title: 'Priority tier',
      value: range(VOLUME.bands.priority),
      unit: 'sets a week',
      grade: 'moderate',
      note: `For up to 2–3 priority muscles a phase (which muscles: H). Its minimum of ${VOLUME.efficientTop} counts direct sets taken near failure (RIR 0–${VOLUME.hardRir}): half credit and easy sets do not fill it; a hold counts at ${Math.round(VOLUME.holdShare * 100)} % or more of the tested best (H). With the posture emphasis, upper back and lats may run to the cap.`,
      sources: [S.pelland2025, S.pelland2025preprint, S.schoenfeld2017a],
      engine: ['VOLUME.bands.priority', 'VOLUME.efficientTop', 'VOLUME.priorityTop', 'VOLUME.hardRir', 'VOLUME.holdShare'],
      checks: ['priority-under', 'priority-over'],
    },
    {
      id: 'volume.priority-room',
      topic: 'volume',
      title: 'How many priority muscles fit',
      value: { fourDays: PRIORITY_ROOM.fourDays, threeDays: PRIORITY_ROOM.threeDays, twoDaysOr30Min: PRIORITY_ROOM.twoDaysOr30Min },
      unit: 'priority muscles a phase, by lifting days a week',
      grade: 'heuristic',
      note: `Up to 2–3 priority muscles a phase, each at ${VOLUME.efficientTop}–${VOLUME.priorityTop} weekly sets: ${PRIORITY_ROOM.fourDays} with 4 or more lifting days, ${PRIORITY_ROOM.threeDays} with 3, ${PRIORITY_ROOM.twoDaysOr30Min} with 2 or fewer or ${PRIORITY_ROOM.shortSessionMinutes}-minute sessions. A priority trained on the short sessions (abs and obliques on a cardio-and-core day) uses none of the lifting days' room. Past it, the user picks which come first and the rest wait under Later priorities.`,
      sources: [],
      engine: ['PRIORITY_ROOM'],
      checks: ['priority-room'],
    },
    {
      id: 'volume.cap',
      topic: 'volume',
      title: 'Weekly cap',
      value: range(VOLUME.bands.cap),
      unit: 'sets a week',
      grade: 'heuristic',
      note: `Never planned above ${VOLUME.highTop} a week, for fatigue and time rather than as a ceiling on growth (few studies go past about 25 sets); above it only as a short deliberate block.`,
      sources: [S.pelland2025, S.bazValle2022],
      engine: ['VOLUME.bands.cap', 'VOLUME.highTop'],
      checks: ['volume-over-cap'],
    },
    {
      id: 'volume.per-session',
      topic: 'volume',
      title: 'Per-session cap',
      value: VOLUME.perSessionDirectMax,
      unit: 'direct sets per muscle in one session',
      grade: 'weak',
      note: `Past about ${VOLUME.perSessionDirectMax} direct sets for one muscle in one session more sets were unlikely to add a detectable effect (one preprint): a muscle needing more than about ${VOLUME.perSessionDirectMax * 2} a week needs 2 or more sessions.`,
      sources: [S.remmert2025],
      engine: ['VOLUME.perSessionDirectMax'],
      checks: ['session-cap'],
    },
    {
      id: 'volume.minimum-week',
      topic: 'volume',
      title: 'The minimum week',
      value: VOLUME.minimum,
      unit: 'hard sets per muscle a week',
      grade: 'moderate',
      note: '2 short full-body sessions with supersets for a bad week, Express or a maintenance dose: one set 1–3 times a week near failure still raised trained men\'s squat and bench, and size and strength held for up to 32 weeks on 1 session and 1 set per exercise when the load was kept.',
      sources: [S.androulakisKorakakis2020, S.iversen2021, S.spiering2021, S.zhang2025],
      engine: ['VOLUME.minimum'],
    },
    {
      id: 'volume.pull-push',
      topic: 'volume',
      title: 'Pulling against pushing',
      value: { finding: PULL_PUSH.target, findingFloor: PULL_PUSH.floor, goal: PULL_PUSH_GOAL.target, goalFloor: PULL_PUSH_GOAL.floor },
      unit: 'pulling sets per pushing set',
      grade: 'heuristic',
      note: `Pulling at least equal to pushing. With a confirmed forward-head, rounded-shoulders finding about ${PULL_PUSH.target} to 1 (at least ${PULL_PUSH.floor}); with a posture goal about ${PULL_PUSH_GOAL.target} to 1 (at least ${PULL_PUSH_GOAL.floor}).`,
      sources: [],
      engine: ['PULL_PUSH', 'PULL_PUSH_GOAL'],
      checks: ['pull-push'],
    },
    // ---------------------------------------------------------------- effort
    {
      id: 'effort.near-failure',
      topic: 'effort',
      title: 'Near failure for muscle',
      value: [0, VOLUME.hardRir],
      unit: 'RIR',
      grade: 'strong',
      note: `For muscle, sets taken near failure; a set at RIR ${VOLUME.hardRir} or less counts as hard (the priority minimum, the hard-set counts).`,
      sources: [S.schoenfeld2017b, S.schoenfeld2021, S.refalo2023, S.acsm2026],
      engine: ['VOLUME.hardRir', 'CONCURRENT.hardRir'],
    },
    {
      id: 'effort.failure',
      topic: 'effort',
      title: 'Failure is optional',
      value: null,
      unit: null,
      grade: 'moderate',
      note: 'Sets to failure gave at most a trivial edge for muscle and equal strength; growth improves closer to failure while strength stays flat across RIR. Failure only on machines and isolation lifts, never on heavy compounds or under a Conservative screen.',
      sources: [S.refalo2023, S.grgic2022, S.robinson2024],
    },
    {
      id: 'effort.rir-by-type',
      topic: 'effort',
      title: 'RIR by exercise type',
      value: { compound: range(EFFORT_TARGETS.compound), isolation: range(EFFORT_TARGETS.isolation), strength: range(EFFORT_TARGETS.strength) },
      unit: 'RIR',
      grade: 'heuristic',
      note: `Compound lifts ${rirText(EFFORT_TARGETS.compound)}, isolation and machine work ${rirText(EFFORT_TARGETS.isolation)}, heavy strength work (a compound at ${EFFORT_TARGETS.strengthRepsMax} reps or fewer) ${rirText(EFFORT_TARGETS.strength)}. The targets by type are a heuristic on the Moderate evidence above.`,
      sources: [S.refalo2023, S.halperin2022],
      engine: ['EFFORT_TARGETS'],
      checks: ['rir-by-type'],
    },
    {
      id: 'effort.conservative',
      topic: 'effort',
      title: 'Under a Conservative screen',
      value: conservativeRir,
      unit: 'RIR at least',
      grade: 'heuristic',
      note: `Every set at RIR ${conservativeRir} or more (about RPE 6), full-body sessions only, no vigorous work and no max tests: a safety limit the check holds as a hard error, not evidence to weigh.`,
      sources: [],
      engine: ['screeningCaps'],
    },
    {
      id: 'effort.unreliable',
      topic: 'effort',
      title: 'An RIR too light to judge',
      value: PROGRESSION.unreliableRir,
      unit: 'RIR or more',
      grade: 'heuristic',
      note: `A logged or reported RIR of ${PROGRESSION.unreliableRir} or more is unreliable: the set was too light to judge, so the next session moves closer to the target.`,
      sources: [S.halperin2022],
      engine: ['PROGRESSION.unreliableRir'],
    },
    {
      id: 'effort.rir-accuracy',
      topic: 'effort',
      title: 'RIR is judged poorly at high reps',
      value: REP_LIMITS.rirRepsMax,
      unit: 'reps at most for a set gauged by RIR',
      grade: 'moderate',
      note: `RIR accuracy is better near failure and worse above about 12 reps (people underpredict the reps left by about 1): sets gauged by RIR stay at about ${REP_LIMITS.rirRepsMax} reps or fewer.`,
      sources: [S.halperin2022],
      engine: ['REP_LIMITS.rirRepsMax'],
      checks: ['rep-range-rir'],
    },
    // ---------------------------------------------------------------- load
    {
      id: 'load.size-reps',
      topic: 'load',
      title: 'Rep ranges for muscle',
      value: range(REP_LIMITS.sizeReps),
      unit: 'reps a set, near failure',
      grade: 'strong',
      note: `Loads from 30 to 100 % of 1RM build equal size when taken near failure, so the rep range follows equipment, joints and liking; past about ${REP_LIMITS.repsMax} reps the studies run out.`,
      sources: [S.schoenfeld2017b, S.schoenfeld2021, S.lopez2021, S.currier2023],
      engine: ['REP_LIMITS.sizeReps', 'REP_LIMITS.repsMax'],
      checks: ['rep-range'],
    },
    {
      id: 'load.strength',
      topic: 'load',
      title: 'Load for strength',
      value: { percentOf1RM: STRENGTH.percentOf1RM, reps: [1, EFFORT_TARGETS.strengthRepsMax] },
      unit: '% of 1RM at least; reps a set',
      grade: 'strong',
      note: `Main lifts at ${STRENGTH.percentOf1RM} % of 1RM or more (about 1–${EFFORT_TARGETS.strengthRepsMax} reps) win for 1RM; strength gains little past about 4 weekly sets, so spare time goes to exposures or to muscle volume (Moderate).`,
      sources: [S.lopez2021, S.currier2023, S.acsm2026, S.pelland2025],
      engine: ['STRENGTH.percentOf1RM', 'EFFORT_TARGETS.strengthRepsMax'],
      libraryOnly: true,
    },
    {
      id: 'load.strength-frequency',
      topic: 'load',
      title: 'Exposures for strength',
      value: STRENGTH.exposuresPerWeek,
      unit: 'exposures a week per strength-goal lift, at least',
      grade: 'moderate',
      note: 'Strength rises with frequency beyond volume, with diminishing returns (an estimated 12.7 % gain at 1 weekly session, 17.3 % at 2, flatter after). For muscle, frequency is a scheduling choice at matched sets (Strong).',
      sources: [S.pelland2025, S.grgic2018a, S.currier2023, S.schoenfeld2019a, S.ramosCampo2024, S.schoenfeld2016],
      engine: ['STRENGTH.exposuresPerWeek'],
      libraryOnly: true,
    },
    // ---------------------------------------------------------------- rest
    {
      id: 'rest.between-sets',
      topic: 'rest',
      title: 'Rest between sets',
      value: REST.sets.minutes * 60,
      unit: 'seconds at least',
      grade: 'moderate',
      note: `At least ${REST.sets.text} between sets: past it size gains show no clear difference, under it they are smaller. Core, skill and carry work is not held to it.`,
      sources: [S.singer2024, S.grgic2018b],
      engine: ['REST.sets'],
      checks: ['rest'],
    },
    {
      id: 'rest.heavy',
      topic: 'rest',
      title: 'Rest on heavy compound lifts',
      value: range(REST.heavy.range),
      unit: 'minutes',
      grade: 'weak',
      note: `${REST.heavy.text} on heavy compound lifts (a main lift under 10 reps, a compound accessory at ${EFFORT_TARGETS.strengthRepsMax} or fewer): trained lifters likely need more than ${REST.heavy.minutes} min between heavy sets for strength.`,
      sources: [S.singer2024, S.grgic2018b],
      engine: ['REST.heavy'],
      checks: ['rest-heavy'],
    },
    {
      id: 'rest.superset',
      topic: 'rest',
      title: 'Supersets',
      value: REST.pair.minutes * 60,
      unit: 'seconds after each pair',
      grade: 'moderate',
      note: `Supersets of non-competing muscles, when time is the limit, keep the volume load and the long-term gains; rest ${REST.pair.text}.`,
      sources: [S.zhang2025],
      engine: ['REST.pair'],
    },
    // ---------------------------------------------------------------- tempo
    {
      id: 'tempo.speed',
      topic: 'tempo',
      title: 'Rep speed',
      value: range(TEMPO.similarSeconds),
      unit: 'seconds a rep',
      grade: 'moderate',
      note: `Rep speed matters little for size: ${TEMPO.similarSeconds[0]} to ${TEMPO.similarSeconds[1]} s a rep gives similar growth; very slow reps (over ${TEMPO.slowerThanSeconds} s) do worse.`,
      sources: [S.schoenfeld2015],
      engine: ['TEMPO.similarSeconds', 'TEMPO.slowerThanSeconds'],
      libraryOnly: true,
    },
    {
      id: 'tempo.default',
      topic: 'tempo',
      title: 'The default tempo',
      value: range(TEMPO.lowerSeconds),
      unit: 'seconds lowering',
      grade: 'heuristic',
      note: `Lower under control in about ${TEMPO.lowerSeconds[0]} to ${TEMPO.lowerSeconds[1]} s, no bounce at the bottom, lift with intent; a pause only where a note asks for one (the stretch on isolation lifts).`,
      sources: [],
      engine: ['TEMPO.lowerSeconds'],
      libraryOnly: true,
    },
    // ---------------------------------------------------------------- order
    {
      id: 'order.priority-first',
      topic: 'order',
      title: 'The priority lift first',
      value: null,
      unit: null,
      grade: 'moderate',
      note: 'The goal\'s priority lift first (a strength-goal lift, or a priority muscle\'s main exercise): strength gains are largest in the exercises done first, and size is unaffected by order. Otherwise order for safety and logistics.',
      sources: [S.nunes2021],
    },
    // ---------------------------------------------------------------- range of motion
    {
      id: 'rom.full',
      topic: 'range-of-motion',
      title: 'Full range of motion',
      value: null,
      unit: null,
      grade: 'moderate',
      note: 'Full range of motion with the lengthened (stretched) position emphasised; never short-range partials as main work.',
      sources: [S.wolf2023, S.kassiano2023, S.pedrosa2022, S.wolf2025],
    },
    {
      id: 'rom.lengthened-partials',
      topic: 'range-of-motion',
      title: 'Lengthened partials',
      value: null,
      unit: null,
      grade: 'weak',
      note: 'Partials at the lengthened end are an option where a full range is out (a load ceiling, a painful end range).',
      sources: [S.wolf2023, S.kassiano2023, S.pedrosa2022, S.wolf2025],
    },
    {
      id: 'rom.two-joint-long',
      topic: 'range-of-motion',
      title: 'Two-joint muscles at a long length',
      value: longLength,
      unit: 'catalogue movements that load one long',
      grade: 'moderate',
      note: 'Two-joint muscles grow more when trained at a long length: the seated leg curl (hip bent) over the lying one for the hamstrings, overhead triceps extensions over pushdowns for the long head, standing calf raises (knees straight) over seated ones for the gastrocnemius, and, for the rectus femoris, the leg extension with a reclined seat where the machine allows (a setting, so no catalogue movement is marked for it). `catalogue` ranks the marked versions first for their muscle.',
      sources: [S.maeo2021, S.maeo2023, S.kinoshita2023, S.larsen2025b],
      engine: ['CatalogueEntry.longLength'],
    },
    // ---------------------------------------------------------------- exercise choice
    {
      id: 'choice.mode',
      topic: 'exercise-choice',
      title: 'Free weights or machines',
      value: null,
      unit: null,
      grade: 'moderate',
      note: 'Free weights and machines build equal strength and size, specific to the mode trained: choose by equipment, the Ledger, liking and the lift the person wants strong. The time-efficient core is a squat or leg press, an upper pull and an upper push.',
      sources: [S.haugen2023, S.iversen2021],
    },
    {
      id: 'choice.exercise-changes',
      topic: 'exercise-choice',
      title: 'When exercises change',
      value: null,
      unit: null,
      grade: 'weak',
      note: 'Exercises change only at mesocycle boundaries, main lifts are kept for a whole phase, and at most half the accessories rotate at a time: frequent random rotation may hurt (8 studies, all young men).',
      sources: [S.kassiano2022],
      checks: ['exercise-change'],
    },
    {
      id: 'choice.planned-variation',
      topic: 'exercise-choice',
      title: 'Planned variation',
      value: null,
      unit: null,
      grade: 'moderate',
      note: 'Planned variation changes where a muscle grows, not how much, and random variation does not help: a movement chosen to bias a region is kept for the whole phase.',
      sources: [S.costa2021, S.fonseca2014, S.kassiano2022, S.bazValle2019],
    },
    // ---------------------------------------------------------------- progression
    {
      id: 'progression.double',
      topic: 'progression',
      title: 'Double progression',
      value: null,
      unit: null,
      grade: 'moderate',
      note: 'All sets at the top of the range at the target RIR, then the next increment and back to the bottom of the range: adding reps at a fixed load matched adding load. The old default for a lift with no progression rule.',
      sources: [S.plotkin2022],
      engine: ['legacyLift'],
    },
    {
      id: 'progression.misses',
      topic: 'progression',
      title: 'Under the range',
      value: { after: miss?.after ?? null, drop: range(PROGRESSION.lighterBand), defaultDrop: r6(1 - PROGRESSION.lighterFactor) },
      unit: 'sessions in a row under the range; fraction lighter',
      grade: 'heuristic',
      note: `A top set under the bottom of the range holds the weight; ${miss?.after ?? 2} sessions in a row under it go ${Math.round(PROGRESSION.lighterBand[0] * 100)}–${Math.round(PROGRESSION.lighterBand[1] * 100)} % lighter (the default ${Math.round((1 - PROGRESSION.lighterFactor) * 100)} %), rounded to the lift's step.`,
      sources: [],
      engine: ['PROGRESSION.lighterFactor', 'PROGRESSION.lighterBand', 'legacyLift'],
    },
    {
      id: 'progression.linear',
      topic: 'progression',
      title: 'Linear progression for novices',
      value: null,
      unit: null,
      grade: 'weak',
      note: 'Novices: simple plans, frequent practice of the main lifts and load up every successful session (rule linear, or a lifts entry with lo = hi). Untrained lifters gained most near 60 % of 1RM and 3 days a week per muscle, trained ones near 80 % and 2 days. A load ceiling calls for double progression instead.',
      sources: [S.rhea2003, S.acsm2009, S.pelland2025],
    },
    {
      id: 'progression.load-jump',
      topic: 'progression',
      title: 'Load-jump cap',
      value: { perSession: LOAD_CAP.perSession, maxWeekFraction: LOAD_CAP.maxWeekFraction, windowDays: LOAD_CAP.windowDays },
      unit: 'increments a session; fraction over the span of days',
      grade: 'heuristic',
      note: `At most ${LOAD_CAP.perSession} increment per lift per session and about ${Math.round(LOAD_CAP.maxWeekFraction * 100)} % in ${LOAD_CAP.windowDays} days (the consensus step is 2–10 % once 1–2 reps over the target). Under the plan's own rule an increase over it is reported, never capped; where one dumbbell step is over 10 % of the load, a wider range lets reps carry the progress.`,
      sources: [S.acsm2009],
      engine: ['LOAD_CAP'],
      checks: ['load-jump'],
    },
    {
      id: 'progression.by-equipment',
      topic: 'progression',
      title: 'Progression by equipment',
      value: null,
      unit: null,
      grade: 'heuristic',
      note: 'Bodyweight progresses by leverage, range, tempo and reps (the ladders); dumbbells by double progression, going one-sided when the heaviest gets light; a full gym allows barbell linear progression for novices.',
      sources: [],
    },
    // ---------------------------------------------------------------- light weeks
    {
      id: 'light-weeks.timing',
      topic: 'light-weeks',
      title: 'When light weeks come',
      value: { every: DELOAD.every, maxLoadingRun: MAX_LOADING_RUN },
      unit: 'plan weeks',
      grade: 'heuristic',
      note: `No evidence-based timing: surveyed strength and physique athletes deload every 5.6 ± 2.3 weeks, and a week off midway through a 9-week trial gave no extra muscle. Pahlavan's old default is every ${DELOAD.every}th plan week; a plan never runs more than ${MAX_LOADING_RUN} loading weeks without one.`,
      sources: [S.coleman2024, S.bell2023, S.rogerson2024],
      engine: ['DELOAD.every', 'MAX_LOADING_RUN'],
      checks: ['no-light-week'],
    },
    {
      id: 'light-weeks.shape',
      topic: 'light-weeks',
      title: 'What a light week is',
      value: { sets: 'half', rirAdd: DELOAD.rirAdd },
      unit: 'sets; RIR added',
      grade: 'weak',
      note: `Half the sets, RIR +${DELOAD.rirAdd}, the same exercises and frequency, never a full week off: it manages fatigue rather than driving growth. Pahlavan's old default light week is ${DELOAD.legacySets} sets of everything about ${Math.round((1 - DELOAD.legacyLoadFactor) * 100)} % lighter, RIR +${PROGRESSION.deloadRirAdd}.`,
      sources: [S.coleman2024, S.bell2023, S.rogerson2024],
      engine: ['DELOAD.rirAdd', 'DELOAD.legacySets', 'DELOAD.legacyLoadFactor', 'PROGRESSION.deloadRirAdd'],
    },
    {
      id: 'light-weeks.early',
      topic: 'light-weeks',
      title: 'Early light-week signals',
      value: { lowReadinessDays: READINESS.lowRunDays, stalledMainLifts: DELOAD.stalledMainLifts },
      unit: 'days of low readiness running; main lifts stalled in a week',
      grade: 'heuristic',
      note: `Signals for an early light week: low readiness ${READINESS.lowRunDays} days running with a falling e1RM, stalls on ${DELOAD.stalledMainLifts} or more main lifts, two check-ins running with poor recovery and joint aches. Reported as facts; applied only when the plan's rules.lightWeeks.early says so.`,
      sources: [],
      engine: ['READINESS.lowRunDays', 'DELOAD.stalledMainLifts'],
    },
    // ---------------------------------------------------------------- calibration and missed time
    {
      id: 'calibration.rir',
      topic: 'calibration',
      title: 'The calibration week',
      value: CALIBRATION.rir,
      unit: 'RIR',
      grade: 'heuristic',
      note: `Plan week 1, and the first week back after a restart, find each working load at ${CALIBRATION.rir} reps in reserve at the bottom of the range; nothing progresses or stalls until the week after. People misjudge the reps left by about one, so ${CALIBRATION.rir} keeps a misjudged first set away from failure.`,
      sources: [S.halperin2022],
      engine: ['CALIBRATION.rir'],
    },
    {
      id: 'calibration.cardio',
      topic: 'calibration',
      title: 'Intervals in the calibration week',
      value: CALIBRATION.cardio,
      unit: 'intensity',
      grade: 'heuristic',
      note: 'Intervals in the calibration week are easy steady cardio for the same minutes; the intervals start in week 2.',
      sources: [],
      engine: ['CALIBRATION.cardio'],
    },
    {
      id: 'calibration.missed-time',
      topic: 'calibration',
      title: 'After missed time',
      value: { easeBackDrop: r6(1 - MISSED.easeBackLoadFactor), easeBackRirAdd: MISSED.easeBackRirAdd, restartAfterWeeks: MISSED.restartAfterWeeks },
      unit: 'fraction lighter; RIR added; weeks off',
      grade: 'heuristic',
      note: `One session missed: shift the week, never two in a day. 1–${MISSED.restartAfterWeeks - 1} weeks off: the first week back about ${Math.round((1 - MISSED.easeBackLoadFactor) * 100)} % lighter and RIR +${MISSED.easeBackRirAdd}. ${MISSED.restartAfterWeeks}+ weeks: restart the mesocycle with a calibration week. Strength holds through short breaks.`,
      sources: [S.spiering2021],
      engine: ['MISSED.easeBackLoadFactor', 'MISSED.easeBackRirAdd', 'MISSED.restartAfterWeeks'],
    },
    {
      id: 'calibration.rir-bias',
      topic: 'calibration',
      title: 'The RIR calibration set',
      value: null,
      unit: null,
      grade: 'heuristic',
      note: 'Once a mesocycle (its last loading week), one set to technical failure on a machine, dumbbell or isolation lift (never a heavy barbell squat or deadlift, never a lift under a Ledger constraint): the bias, predicted minus actual reps in reserve, is kept per exercise and corrects later targets.',
      sources: [],
    },
    // ---------------------------------------------------------------- concurrent training and cardio
    {
      id: 'concurrent.interference',
      topic: 'concurrent',
      title: 'Cardio and lifting together',
      value: null,
      unit: null,
      grade: 'strong',
      note: 'Across 43 studies, adding aerobic training to lifting did not reduce muscle size or maximal strength but cut explosive strength, more in the same session; interference grows with the endurance work\'s frequency and duration, and with running more than cycling. Cardio does not lower the lifting sets.',
      sources: [S.schumann2022, S.petre2021, S.wilson2012],
    },
    {
      id: 'concurrent.placement',
      topic: 'concurrent',
      title: 'Placement',
      value: { apartHours: CONCURRENT.apartHours, warmUpMinutes: CONCURRENT.warmUpMinutes },
      unit: 'hours after lifting at least; minutes of easy cardio before lifting',
      grade: 'moderate',
      note: `Conditioning on non-lifting days, or ${CONCURRENT.apartHours}+ h after lifting; lift first when they share a session (it preserved lower-body strength). A trained lifter chasing lower-body strength: separate days. Up to ${CONCURRENT.warmUpMinutes} min of easy cardio before lifting is a warm-up.`,
      sources: [S.schumann2022, S.eddens2018],
      engine: ['CONCURRENT.apartHours', 'CONCURRENT.warmUpMinutes'],
    },
    {
      id: 'concurrent.mode',
      topic: 'concurrent',
      title: 'Cardio mode',
      value: null,
      unit: null,
      grade: 'moderate',
      note: 'Cycling or another low-impact mode when legs are a priority: running interferes more.',
      sources: [S.wilson2012, S.schumann2022],
    },
    {
      id: 'concurrent.legs',
      topic: 'concurrent',
      title: 'Heavy legs and key runs',
      value: CONCURRENT.legGapHours,
      unit: 'hours apart at least',
      grade: 'heuristic',
      note: `Heavy leg days at least ${CONCURRENT.legGapHours} h away from key runs or intervals.`,
      sources: [],
      engine: ['CONCURRENT.legGapHours'],
    },
    {
      id: 'concurrent.intervals',
      topic: 'concurrent',
      title: 'The 4 × 4 intervals',
      value: { rounds: CONDITIONING.intervals.rounds, workMin: CONDITIONING.intervals.workMin, restMin: CONDITIONING.intervals.restMin, sessionMinutes: CONDITIONING.intervalsMinutes },
      unit: 'rounds; minutes',
      grade: 'moderate',
      note: `One session a week: ${CONDITIONING.intervals.rounds} × ${CONDITIONING.intervals.workMin} min hard (about 90–95 % of max heart rate), ${CONDITIONING.intervals.restMin} min easy between. Intervals raise VO2max a little more than continuous work (about 1.2 mL/kg/min).`,
      sources: [S.helgerud2007, S.milanovic2015],
      engine: ['CONDITIONING.intervals', 'CONDITIONING.intervalsMinutes'],
    },
    {
      id: 'concurrent.easy-cardio',
      topic: 'concurrent',
      title: 'Easy cardio',
      value: null,
      unit: null,
      grade: 'weak',
      note: 'Easy cardio fills minutes for those who like it, not as a better intensity: Zone 2 as the optimal intensity is not supported. 5–10 min easy after lifting is fine (H).',
      sources: [S.storoschuk2025],
    },
    {
      id: 'concurrent.circuits',
      topic: 'concurrent',
      title: 'Circuits',
      value: null,
      unit: null,
      grade: 'moderate',
      note: 'When time is short and both goals count, circuits improve VO2max, muscle and fat mass a little.',
      sources: [S.ramosCampo2021],
    },
    // ---------------------------------------------------------------- activity
    {
      id: 'activity.weekly-minutes',
      topic: 'activity',
      title: 'Active minutes a week',
      value: range(CONDITIONING.activeMinutes),
      unit: 'active minutes a week (vigorous minutes count double)',
      grade: 'moderate',
      note: `${CONDITIONING.activeMinutes[0]}–${CONDITIONING.activeMinutes[1]} active minutes a week (or half as many vigorous), with muscle strengthening on 2 or more days; balance work at 65+.`,
      sources: [S.who2020, S.bull2020],
      engine: ['CONDITIONING.activeMinutes'],
    },
    {
      id: 'activity.strength-and-health',
      topic: 'activity',
      title: 'Muscle strengthening and health',
      value: null,
      unit: null,
      grade: 'moderate',
      note: '30–60 min a week of muscle strengthening goes with a 10–20 % lower mortality risk in cohort studies.',
      sources: [S.momma2022],
    },
    {
      id: 'activity.steps',
      topic: 'activity',
      title: 'Daily steps',
      value: { start: CONDITIONING.steps.base, startActiveGoal: CONDITIONING.steps.active, perPhase: CONDITIONING.steps.perPhase, max: CONDITIONING.steps.max },
      unit: 'steps a day',
      grade: 'heuristic',
      note: `Build toward 8–10k a day by phase: ${CONDITIONING.steps.base.toLocaleString('en-US')} to start (${CONDITIONING.steps.active.toLocaleString('en-US')} with an active goal), ${CONDITIONING.steps.perPhase.toLocaleString('en-US')} more each phase, at most ${CONDITIONING.steps.max.toLocaleString('en-US')}.`,
      sources: [],
      engine: ['CONDITIONING.steps'],
    },
    // ---------------------------------------------------------------- regions
    {
      id: 'regions.credit',
      topic: 'regions',
      title: 'How region sets count',
      value: { direct: 1, indirect: VOLUME.indirect },
      unit: 'region sets credited per set done',
      grade: 'heuristic',
      note: `A set counts 1 for each region the movement biases whose muscle is a main muscle of it, and ${VOLUME.indirect} when the muscle only helps; the muscles' own counts never change with it.`,
      sources: [],
      engine: ['VOLUME.indirect', 'regionCredit'],
    },
    {
      id: 'regions.coverage',
      topic: 'regions',
      title: 'Coverage of a priority muscle\'s regions',
      value: REGION_RULES.coverage,
      unit: 'direct region sets a week',
      grade: 'heuristic',
      note: `A muscle grows unevenly with the exercise, so a priority muscle's whole sets can hide a region with no direct work: each of its coverage regions (the regions below with coverage true) gets at least ${REGION_RULES.coverage} direct sets a week from a movement that biases it.`,
      sources: [],
      engine: ['REGION_RULES.coverage'],
      checks: ['region-coverage'],
    },
    {
      id: 'regions.declared',
      topic: 'regions',
      title: 'A region declared weak',
      value: REGION_RULES.declared,
      unit: 'direct region sets near failure a week',
      grade: 'heuristic',
      note: `A region the person declares weak (the profile's priorityRegions, or the regions of a body-assessment row that acts in full: confirmed, or in a profile from before the question) gets at least ${REGION_RULES.declared} direct sets near failure a week from movements that bias it, inside its muscle's ${VOLUME.bands.priority[0]}–${VOLUME.bands.priority[1]}; its muscle's coverage regions are then held too.`,
      sources: [],
      engine: ['REGION_RULES.declared'],
      checks: ['region-declared-short'],
    },
    {
      id: 'regions.emg-cap',
      topic: 'regions',
      title: 'Muscle activity alone',
      value: null,
      unit: null,
      grade: 'weak',
      note: 'A claim resting on muscle activity (EMG) alone, without a training study measuring growth, is graded Weak at most (overhead presses and the side delts, for one).',
      sources: [S.vigotsky2022],
    },
    // ---------------------------------------------------------------- findings
    {
      id: 'findings.confirmation',
      topic: 'findings',
      title: 'A finding is a question first',
      value: null,
      unit: null,
      grade: 'heuristic',
      note: 'A photo or self-check finding is a question for the person, never a diagnosis: yes acts on it in full, no keeps its warm-ups only, and an unanswered one in a profile that records answers is a preference that rules nothing out.',
      sources: [],
    },
    {
      id: 'findings.weak-regions',
      topic: 'findings',
      title: 'Weak regions are declared, not diagnosed',
      value: null,
      unit: null,
      grade: 'weak',
      note: 'Only imaging measures a region reliably: no validated way spots a lagging region from photos or a tape, so a weak region is the person\'s word and photos only prompt the question.',
      sources: [S.stokes2021],
    },
    {
      id: 'findings.posture-capacity',
      topic: 'findings',
      title: 'Posture as capacity',
      value: null,
      unit: null,
      grade: 'weak',
      note: 'Posture alone predicts pain poorly: posture work builds capacity (upper-back strength, thoracic mobility, overhead range), measured by capacity tests and the side photo, and never promises pain relief.',
      sources: [S.christensen2008, S.swain2020],
    },
  ];
}

let gradeByCheck: ReadonlyMap<string, Grade> | null = null;

/** The grade a plan-check warning carries: the grade of the rule that lists it. */
export function checkGrade(code: string): Grade {
  gradeByCheck ??= new Map(evidenceRules().flatMap((r) => (r.checks ?? []).map((c) => [c, r.grade] as const)));
  const grade = gradeByCheck.get(code);
  if (!grade) throw new Error(`no evidence rule lists the check ${code}`);
  return grade;
}

/** The regions: each modelled one with its grade, sources and the catalogue movements that bias it; the unsupported ones with the nearest supported option and why. */
function regionsSection() {
  return {
    list: REGIONS.map((r) => ({
      id: r.id,
      muscle: r.muscle,
      label: r.label,
      grade: r.grade,
      coverage: r.coverage,
      roughGuide: r.roughGuide ?? false,
      aliases: [...r.aliases],
      note: r.note,
      sources: r.sources,
      movements: rankMovements(CATALOGUE.filter((e) => (e.regions ?? []).includes(r.id)), { region: r.id }).map((x) => ({
        id: x.entry.id,
        name: x.entry.name,
        // Full region credit when the region's muscle is a main muscle of the movement, half when it helps.
        credit: x.fit.role === 'main' ? 1 : VOLUME.indirect,
        ...(x.fit.longLength ? { longLength: true } : {}),
      })),
    })),
    unsupported: UNSUPPORTED_REGIONS.map((u) => ({ phrases: [...u.phrases], nearest: u.nearest, nearestText: nearestText(u), why: u.why, sources: u.sources })),
  };
}

/** How a finding is confirmed, and where each answer goes. */
function findingsSection() {
  return {
    answers: [
      { answer: 'confirmed', value: true, effect: 'The finding holds: the plan acts on it in full (it may rule movements out, set a pull-to-push aim, make a priority muscle).' },
      { answer: 'declined', value: false, effect: 'It does not hold: a self-check result keeps only its warm-up lines; a body-assessment row is left out.' },
      { answer: 'unconfirmed', value: null, effect: 'Not asked yet. In a profile that records an answer anywhere: a preference and warm-ups only, ruling no movement out. In a profile from before the question: the old behaviour, with a finding-unconfirmed warning carrying the question.' },
    ],
    selfCheck: SELF_CHECK_FINDINGS.map((t) => ({ test: t, answer: `selfCheck.confirmed.${t}` })),
    emphasis: EMPHASIS_FINDINGS.map((k) => ({ kind: k, answer: 'emphasis[].confirmed' })),
  };
}

/** The standing rules a plan declares in plan-data.json, each with the old default that stands in (and a legacy-default warning) when it does not. */
function standingRulesSection() {
  const legacy = legacyRules();
  const json = legacyRulesJson();
  return {
    note: 'The coach declares each rule in plan-data.json; a kind left out runs on the old default below, and a legacy-default warning asks for it.',
    kinds: RULE_KINDS.map((k) => ({ kind: k, path: RULE_PATHS[k], legacyDefault: k === 'express' ? legacy.express.short : json[k], text: ruleText(k, legacy) })),
    lift: { path: 'lifts["<name>"].progression', rules: [...LIFT_RULES], legacyDefault: legacyLift() },
  };
}

/** The library, whole or for one topic. */
export function buildEvidence(topic: Topic | null = null) {
  const on = (t: Topic) => topic === null || topic === t;
  return {
    topic,
    topics: TOPICS.map((t) => ({ ...t })),
    grades: GRADES.map((g) => ({ grade: g, means: GRADE_TEXT[g] })),
    note: 'Facts from Pahlavan\'s evidence library: what the evidence says and what the plan check holds a plan to, each with its grade and sources. Not a recommendation for any one person: the coach designs, and a stated reason (an override) may take a plan outside an evidence range.',
    rules: evidenceRules().filter((r) => on(r.topic)),
    regions: on('regions') ? regionsSection() : null,
    findings: on('findings') ? findingsSection() : null,
    standingRules: on('standing-rules') ? standingRulesSection() : null,
  };
}
