// The plan generator: from a schema-v1 profile to a schema-v1 program plus the
// data for the one-message proposal (planning.md, "The proposal"). Each step
// lives in its own module; this one runs them in order, assembles the program,
// applies the screening caps, and runs the checks. Pure and deterministic.

import { checkConcurrent, DAY_SOURCES, liftItem, type DaySource } from '../concurrent.ts';
import type { CatalogueEntry } from '../data/exercises.ts';
import { dayText } from '../dates.ts';
import { LADDER_BY_ID } from '../data/ladders.ts';
import { MAJOR_MUSCLES, MUSCLES } from '../data/muscles.ts';
import { deloadPrescription } from '../deload.ts';
import { deskBreaksFor } from '../desk-breaks.ts';
import { explain, joinNotes, type Result } from '../reason.ts';
import { REFERRAL } from '../data/red-flags.ts';
import { applyScreening, screenExercise, screeningCaps, type Prescription } from '../safety.ts';
import type { ExerciseSlot, IsoDate, Mesocycle, Phase, Program, SessionKind, SessionTemplate, Week, Weekday } from '../schema.ts';
import { validateProgram } from '../validate.ts';
import { checkVolume, plannedSetsPerMuscle, PULL_PUSH, pullPushSets, setEffort, volumeTier, type EffortContext, type PlannedSplit, type VolumeTier } from '../volume.ts';
import { conditioningPlan, plannedWeek, userLayoutDays, type ConditioningPlan } from './conditioning.ts';
import { buildContext, priorityOverRoom, toExercise, type PlanContext, type PlanInput, type PrioritySource } from './context.ts';
import { baseRir, DOSE, estimatedMinutes, fitTime, ladderFor, pairNotes, progressionRule, repRange, slotNote, warmUpMinutes, type BuiltSlot, type BuiltTemplate } from './dose.ts';
import { buildMacrocycle, type PhasePlan, type WeekPlan } from './macrocycle.ts';
import { calendar, calibrationPlan, preMortem, targets, type CalendarEvent, type Calibration, type PreMortemItem, type Target } from './schedule.ts';
import { pick, rankCandidates, type Pick } from './select.ts';
import { sizeWeek, type WeekSize } from './size.ts';
import { templateCandidates, type Role, type TemplateChoice } from './template.ts';
import { BANDS, fitVolume, type VolumeFit } from './volume-fit.ts';
import { compareTemplates, type CandidateFacts, type TemplateScore } from './compare.ts';
import { FAMILIES, familyFit, type FamilyFit, type FamilyId } from './families.ts';
import { personalization, type InputUse } from './audit.ts';
import type { LadderStart } from './self-check.ts';
import type { Reason } from '../reason.ts';

export interface ProposalSlot {
  exercise: string;
  name: string;
  sets: number;
  reps: string;
  rir: number;
  main: boolean;
  progression: string;
  /** A slot on a calisthenics ladder: the ladder, its starting level and that level's name. */
  ladder?: { id: string; level: number; name: string };
  note: string;
}

export interface ProposalSession {
  id: string;
  name: string;
  kind: SessionKind;
  estimatedMinutes: number | null;
  slots: ProposalSlot[];
}

export interface Check {
  id: string;
  passed: boolean;
  detail: string;
}

/** A ladder's starting level from the self-check, and where the plan uses it. */
export interface ProposalLadder extends LadderStart {
  used: boolean;
  /** Session ids with a slot on this ladder. */
  sessions: string[];
  reason: Reason;
}

/** One of rules.md's split families: whether the engine built it this time, its fit for this week and its costs. */
export interface ProposalFamily {
  family: FamilyId;
  name: string;
  structure: string;
  /** built: `plan` builds and scores it; partly: the engine builds a part of it; coach: the coach builds it (planning.md, step 1.4). */
  engine: 'built' | 'partly' | 'coach';
  /** This run's candidates in the family (template ids). */
  candidates: string[];
  fit: FamilyFit;
  costs: string[];
  evidence: string;
  note: string;
}

/**
 * What the coach should know beside the checks, each with its reason:
 * `priority-over-room`, more named priority muscles than the lifting days
 * have room for (all kept); `priority-short`, a priority muscle the fit could
 * not bring to its direct sets near failure, with what blocked it.
 */
export interface ProposalWarning {
  code: 'priority-over-room' | 'priority-short';
  muscles: string[];
  reason: Reason;
}

export interface Proposal {
  status: 'ok' | 'blocked' | 'checks-failed';
  why: string[];
  /** Beside the checks: named priority muscles past the week's room, a priority muscle's minimum not reached. */
  warnings: ProposalWarning[];
  /** "How your data shaped this plan": every profile input, the decision it drove or why it was left out. */
  personalization: InputUse[];
  /** The templates built and compared, the picked one first in `picked`, each scored with its reasons and its families' fit and costs. */
  templates: TemplateScore[];
  /** Every split family of rules.md's catalogue: built here, in part, or the coach's to build. */
  families: ProposalFamily[];
  /** The ladders' starting levels from the self-check. */
  ladders: ProposalLadder[];
  /** The priority muscles, each with why. */
  priority: { muscle: string; source: PrioritySource['source']; reason: Reason }[];
  /** Which muscle map the sets per muscle use: the vault's guide (as Pahlavan counts) or the catalogue's. */
  volumeMap: { source: 'vault' | 'catalogue'; fromVault: { exercise: string; guide: string }[]; fromCatalogue: string[] };
  template: { id: string; family: string; modifier: string; equipmentMode: string; experience: string; liftingDays: number; extraDays: number; minutes: number } | null;
  /** The week's days, each with where it came from (your logged weeks, your available days, the default layout), and why (`layout`). */
  week: { days: { weekday: Weekday; session: string; kind: 'lift' | 'cardio'; source: DaySource }[]; layout: Reason; minimumWeek: { sessions: number; minutes: number; content: string } } | null;
  phases: { id: string; name: string; goal: string; from: IsoDate; to: IsoDate; weeks: { index: number; start: IsoDate; kind: 'loading' | 'deload'; calibration: boolean; tests: boolean }[] }[];
  /** The first full loading week after calibration. */
  sessions: ProposalSession[];
  /** Each loading week of the first mesocycle: sets per muscle, their tiers, the split (direct, indirect, near failure, unknown effort) and pull to push. */
  volume: { week: number; layout: string[]; perWeek: Record<string, number>; split: Record<string, PlannedSplit>; tiers: Record<string, VolumeTier>; pullPush: { pull: number; push: number } }[];
  progression: { exercise: string; rule: string; step?: number; next?: string }[];
  calibration: Calibration | null;
  conditioning: ConditioningPlan[];
  calendar: CalendarEvent[];
  targets: Target[];
  preMortem: PreMortemItem[];
  warmUp: string[];
  checks: Check[];
}

export interface GeneratedPlan {
  program: Program | null;
  proposal: Proposal;
}

const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const LOWER_MAIN = new Set(['squat', 'hinge', 'lunge']);

/** How many of the boundaries 1..m rotated accessory slot i (alternate halves). */
const rotations = (i: number, m: number) => Array.from({ length: m }, (_, k) => k + 1).filter((k) => (i + k) % 2 === 0).length;

function emptyProposal(why: string[], checks: Check[]): Proposal {
  return { status: 'blocked', why, warnings: [], personalization: [], templates: [], families: [], ladders: [], priority: [], volumeMap: { source: 'catalogue', fromVault: [], fromCatalogue: [] }, template: null, week: null, phases: [], sessions: [], volume: [], progression: [], calibration: null, conditioning: [], calendar: [], targets: [], preMortem: [], warmUp: [], checks };
}

function warmUp(ctx: PlanContext): string[] {
  const out = ['5 min easy cardio'];
  const add = (id: string) => {
    const e = ctx.byId.get(id);
    if (e && e.equipment.every((q) => q === 'bodyweight' || ctx.equipment.has(q)) && !out.includes(e.name)) out.push(e.name);
  };
  if (ctx.emphasis.has('squat-heels-lift')) add('ankle-mobility');
  if (ctx.posture) ['thoracic-extension', 'chest-doorway-stretch', 'lat-stretch'].forEach(add);
  if (ctx.emphasis.has('overhead-limited')) ['thoracic-extension', 'lat-stretch'].forEach(add);
  if (ctx.emphasis.has('low-back-arch')) add('hip-flexor-stretch');
  if (ctx.emphasis.has('knees-in')) add('banded-side-walk');
  for (const e of ctx.selfCheck.effects) for (const id of e.value.warmUp ?? []) add(id);
  out.push('Two lighter ramp-up sets before each main lift');
  return out;
}

/** One candidate template built into a full program and proposal, with the facts the comparison scores. */
interface Candidate {
  tplR: Result<TemplateChoice>;
  program: Program;
  proposal: Proposal;
  facts: CandidateFacts;
}

const isLowerMain = (b: TemplateChoice['blueprints'][number]) => b.slots.some((s) => s.role === 'main' && LOWER_MAIN.has(s.pattern));

function buildCandidate(ctx: PlanContext, size: Result<WeekSize>, tplR: Result<TemplateChoice>, macro: ReturnType<typeof buildMacrocycle>['value']): Candidate {
  const tpl: TemplateChoice = tplR.value;
  // The days on the user's week: the log's (with the history), else the profile's, else the spread.
  const layout = userLayoutDays(ctx, tpl.liftingDays, tpl.extraDays);
  const days = layout.value;
  const sourceOf = (day: number): DaySource | undefined => {
    const i = days.lifting.indexOf(day);
    return i >= 0 ? days.sources.lifting[i] : days.sources.extra[days.extra.indexOf(day)];
  };
  const notes: string[] = [];
  const L = ctx.deloadEvery;

  // Step 4: main lifts per phase (screened at the phase start), accessories per mesocycle.
  // A lighter day's variation leaves out the heavy days' main lifts in its pattern (blueprints list heavy first).
  const mainsByPhase = macro.phases.map((p) => {
    const m = new Map<string, (Pick | null)[]>();
    const heavyMains = new Set<string>();
    for (const b of tpl.blueprints) {
      const used = new Set<string>();
      m.set(b.id, b.slots.map((s) => {
        if (s.role !== 'main') return null;
        const got = pick(ctx, s, p.from, s.variation ? new Set([...used, ...heavyMains]) : used, new Set(), s.variant ?? 0);
        if (got) {
          used.add(got.id);
          if (!s.variation) heavyMains.add(got.id);
        } else notes.push(`No exercise fits the ${s.pattern} main slot in ${b.id} with this equipment and screening.`);
        return got;
      }));
    }
    return m;
  });

  const mesoCount = ctx.weeks / L;
  // The effort rule (volume.ts): every generated slot has its RIR, so its sets are near failure at RIR 3
  // or less, unless the movement is below the user's tested ladder level. A priority muscle's minimum
  // counts those direct sets, in the fit and in the checks, in every week the plan may go near failure:
  // not under Conservative screening (RIR 4 or more) or in a 65+ lifter's first phase (about RPE 5-6),
  // where the total is held as before.
  const effortCtx: EffortContext = {
    holds: {},
    ladders: ctx.selfCheck.ladders.flatMap((r) => (r.value.level === null ? [] : [{ id: r.value.id, name: r.value.name, levels: LADDER_BY_ID.get(r.value.id)!.levels.map((l) => l.exercise), level: r.value.level }])),
  };
  const effortOf = (exercise: string, name: string, rir: number) => setEffort({ exercise, name, rir }, effortCtx);
  const nearFailure = (phase: number) => ctx.outcome !== 'conservative' && !(ctx.senior && phase === 0);
  /** A slot of blueprint b on this movement, its reps, RIR, progression and note as step 5 and 6 build them. */
  const slotFor = (b: TemplateChoice['blueprints'][number], entry: CatalogueEntry, s: { role: Role; fixed?: boolean; prefer?: string[] }, slotIndex: number, phase: number): BuiltSlot => {
    const ladder = ladderFor(ctx, entry);
    const prog = progressionRule(ctx, entry, s.role, { linear: b.reps?.linearMain !== null, ladder });
    const reps = repRange(ctx, entry, s.role, b.day, phase, { reps: b.reps, ladder });
    return {
      entry,
      role: s.role,
      fixed: s.fixed === true,
      pinned: (s.prefer?.length ?? 0) > 0,
      slotIndex,
      sets: tpl.minimumDose || entry.load === 'timed' ? DOSE.minSets : DOSE.minMainSets,
      repRange: reps,
      rir: baseRir(entry) + (b.day === 'light' ? (b.rirAdd ?? DOSE.lightRirAdd) : 0),
      progression: prog,
      note: slotNote(entry, s.role, prog, ladder, reps),
    };
  };
  /**
   * The movements that could take accessory slot s's place for a priority muscle short of its direct
   * sets near failure (volume-fit.ts's swap): every one that trains it as a main muscle and passes the
   * slot screening (equipment, level, dislikes, the Ledger at the mesocycle start, the self-check), not
   * already in the session nor one of the week's main lifts. The slot's own pattern first, then
   * movements with a rep range before holds (abs grow from load that goes up, planning.md), then those
   * that train fewer muscles, then each pattern's own ranking.
   */
  const swapsFor = (phase: number, start: IsoDate, mainIds: ReadonlySet<string>) => (t: BuiltTemplate, s: BuiltSlot, muscle: string): BuiltSlot[] => {
    const inSession = new Set(t.slots.map((x) => x.entry.id));
    const patterns = [...new Set(ctx.catalogue.filter((e) => e.muscles.main.includes(muscle)).map((e) => e.pattern))];
    const found: CatalogueEntry[] = [];
    for (const pattern of patterns) {
      const r = rankCandidates(ctx, { pattern, role: 'accessory' }, start, new Set([...inSession, ...mainIds, ...ctx.belowLevel.keys()]));
      if (!r || r.fallback) continue;
      for (const e of r.ranked) if (e.muscles.main.includes(muscle) && !found.includes(e)) found.push(e);
    }
    const key = (e: CatalogueEntry) => [e.pattern === s.entry.pattern ? 0 : 1, e.load === 'timed' ? 1 : 0, e.muscles.main.length];
    const sorted = found.map((e, i) => ({ e, i, k: key(e) })).sort((a, b) => a.k[0]! - b.k[0]! || a.k[1]! - b.k[1]! || a.k[2]! - b.k[2]! || a.i - b.i);
    return sorted.map(({ e }) => slotFor(t.blueprint, e, { role: 'accessory' }, s.slotIndex, phase));
  };
  /** The concurrent-training problems of a mesocycle's sessions in every week layout, as the `concurrent` check finds them. */
  const concurrentOf = (phase: number) => (templates: readonly BuiltTemplate[]): string[] =>
    tpl.rotation.flatMap((layout) => {
      const lifting = layout.map((id, i) => {
        const t = templates.find((x) => x.blueprint.id === id)!;
        const lifts = t.slots.filter((x) => ctx.exercises[x.entry.id]!.kind !== 'cardio' && ctx.exercises[x.entry.id]!.kind !== 'timed');
        return { day: days.lifting[i]!, id, lifts: lifts.map((x) => liftItem({ exercise: x.entry.id, sets: x.sets, repRange: x.repRange, rir: x.rir, ...(x.role === 'main' ? { main: true } : {}) }, ctx.exercises[x.entry.id])), finisher: t.finisher !== null };
      });
      const cardio = conditioningByPhase[phase]!.sessions.map((c) => ({ ...c, exercise: ctx.byId.get(c.exercise)?.name ?? c.exercise }));
      return checkConcurrent(plannedWeek(lifting, cardio, sourceOf), ctx.exercises).map((f) => `${f.value.flag}: ${f.value.sessions.join(', ')}`);
    });
  const builtByMeso: BuiltTemplate[][] = [];
  const fitsByMeso: VolumeFit[] = [];
  const conditioningByPhase: ConditioningPlan[] = [];
  for (let m = 0; m < mesoCount; m++) {
    const phase = Math.floor(m / 2);
    const start = macro.weeks[m * L]!.start;
    const mains = mainsByPhase[phase]!;
    const mainIds = new Set([...mains.values()].flat().filter((x): x is Pick => x !== null).map((x) => x.id));
    const avoid = new Set<string>();
    if (!conditioningByPhase[phase]) {
      // Lower-body days: a lower-body main lift, a lighter day's too, since the concurrent check
      // (shared with review) counts every hard lower-body lift as heavy legs.
      const heavyLower = days.lifting.filter((_, i) => {
        const id = tpl.rotation[0]![i % tpl.rotation[0]!.length]!;
        return isLowerMain(tpl.blueprints.find((x) => x.id === id)!);
      });
      conditioningByPhase[phase] = conditioningPlan(ctx, days, tpl.minutes, phase, macro.phases.length, heavyLower, size.value.shortMinutes).value;
    }
    const finisher = conditioningByPhase[phase]!.finisher;
    const built: BuiltTemplate[] = tpl.blueprints.map((b) => {
      const used = new Set([...(mains.get(b.id) ?? [])].filter((x): x is Pick => x !== null).map((x) => x.id));
      const slots: BuiltSlot[] = [];
      // Muscles with 6 or more direct sets planned in this session: another 3-set slot would pass 8.
      const crowded = () => {
        const d: Record<string, number> = {};
        for (const x of slots) for (const m of x.entry.muscles.main) d[m] = (d[m] ?? 0) + x.sets;
        return new Set(Object.keys(d).filter((m) => d[m]! >= 6));
      };
      b.slots.forEach((s, i) => {
        let got: Pick | null;
        if (s.role === 'main') got = mains.get(b.id)![i] ?? null;
        else {
          const pinned = (s.prefer?.length ?? 0) > 0;
          const offset = (s.variant ?? 0) + (pinned ? 0 : rotations(i, m));
          // Accessories avoid the week's main lifts, but another session's main lift in the
          // slot's own pattern beats falling back to a different pattern.
          const busy = crowded();
          const first = pick(ctx, s, start, new Set([...used, ...mainIds]), avoid, offset, busy);
          const reuse = !first || first.fallback ? pick(ctx, s, start, used, avoid, offset, busy) : null;
          got = reuse && !reuse.fallback ? reuse : (first ?? reuse);
          if (got) {
            used.add(got.id);
            avoid.add(got.id);
          }
        }
        if (!got) return;
        slots.push(slotFor(b, ctx.byId.get(got.id)!, s, i, phase));
      });
      const capacity = tpl.minutes - warmUpMinutes(tpl.minimumDose) - (finisher ? DOSE.finisherMinutes : 0);
      return fitTime({ blueprint: b, minimumDose: tpl.minimumDose, slots, finisher, capacity }).value;
    });
    const fit = fitVolume({
      templates: built,
      layouts: tpl.rotation,
      priority: ctx.priority,
      pullPush: ctx.pullPush,
      minimumDose: tpl.minimumDose,
      hybrid: ctx.modifier === 'hybrid',
      ...(nearFailure(phase) ? { hard: (s: BuiltSlot) => effortOf(s.entry.id, s.entry.name, s.rir).value.effort !== 'easy', swaps: swapsFor(phase, start, mainIds), concurrent: concurrentOf(phase) } : {}),
    }).value;
    builtByMeso.push(fit.templates);
    fitsByMeso.push(fit);
    for (const x of fit.swaps) {
      const name = (id: string) => ctx.byId.get(id)?.name ?? id;
      notes.push(`Mesocycle ${m + 1}: ${name(x.from)} in ${tpl.blueprints.find((b) => b.id === x.template)?.name ?? x.template} swapped for ${name(x.to)}, so ${MUSCLES.find((y) => y.id === x.muscle)?.label.toLowerCase() ?? x.muscle} reaches its 10 direct sets near failure (no set could be added without it).`);
    }
  }

  // Assemble the weeks.
  const toSlot = (s: BuiltSlot, w: WeekPlan): ExerciseSlot => {
    let rir = s.rir;
    if (s.progression?.rule === 'wave' && w.kind === 'loading') rir = Math.max(0, s.rir + 2 - w.weekInMeso);
    if (w.calibration) rir = Math.max(rir, DOSE.calibrationRir);
    if (ctx.senior && w.phase === 0) rir = Math.max(rir, DOSE.seniorRir);
    const slot: ExerciseSlot = { exercise: s.entry.id, sets: s.sets, repRange: s.repRange, rir };
    if (s.role === 'main') slot.main = true;
    if (s.pair) slot.pair = true;
    if (s.progression) slot.progression = s.progression;
    slot.note = w.calibration ? `Calibration week: find a load that leaves 3 in reserve at the bottom of the range. ${s.note}` : ctx.senior && w.phase >= 1 && s.role === 'main' ? `${s.note} Lift fast and controlled on the way up.` : s.note;
    return slot;
  };
  const exercisesUsed = new Set<string>();
  const programWeeks: { plan: WeekPlan; week: Week }[] = [];
  const screeningChanges: string[] = [];
  const screeningViolations: string[] = [];
  for (const w of macro.weeks) {
    const built = builtByMeso[w.meso]!;
    const layout = tpl.rotation[(w.index - 1) % tpl.rotation.length]!;
    const lifting: SessionTemplate[] = layout.map((id) => {
      const t = built.find((x) => x.blueprint.id === id)!;
      let slots = pairNotes(t.slots).map((s) => toSlot(s, w));
      if (w.kind === 'deload') {
        const d = deloadPrescription(slots, 'standard').value;
        slots = slots.map((s, i) => ({ ...s, sets: d[i]!.sets, rir: d[i]!.rir, note: `Deload: half the sets, RIR +3. ${s.note ?? ''}`.trim() }));
      }
      if (t.finisher) slots.push({ exercise: t.finisher, sets: 1, repRange: [1, 1], rir: 3, note: 'Finisher: 8 min easy (zone 2).' });
      return { id: t.blueprint.id, name: t.blueprint.name, kind: t.blueprint.kind, slots };
    });
    const cond = conditioningByPhase[w.phase]!;
    const cardio: SessionTemplate[] = cond.sessions.map((c) => ({
      id: `conditioning-${WEEKDAYS[c.day]}`,
      name: c.vigorous ? '4 x 4 intervals' : 'Easy conditioning',
      kind: 'cardio',
      slots: [{ exercise: c.exercise, sets: 1, repRange: [1, 1], rir: 3, note: c.vigorous ? `${c.minutes} min: 4 x 4 min hard (about 90-95 % of max heart rate), 3 min easy between.` : `${c.minutes} min easy (zone 2: you can talk in full sentences).` }],
    }));
    const pres: Prescription = {
      sessions: [...lifting, ...cardio],
      conditioning: cond.sessions.map((c) => ({ id: `conditioning-${WEEKDAYS[c.day]}`, minutes: c.minutes, vigorous: c.vigorous })),
      maxTests: w.tests && screeningCaps(ctx.outcome, { firstMesocycle: w.meso === 0 }).value.maxTests,
      calibrationToFailure: w.weekInMeso === L - 1 && screeningCaps(ctx.outcome, { firstMesocycle: w.meso === 0 }).value.calibrationToFailure,
    };
    const screened = applyScreening(pres, ctx.outcome, { exercises: ctx.exercises, firstMesocycle: w.meso === 0 }).value;
    screened.changes.forEach((c) => screeningChanges.push(`week ${w.index}: ${c}`));
    screened.violations.forEach((v) => screeningViolations.push(`week ${w.index}: ${v}`));
    const sessions = screened.prescription?.sessions ?? pres.sessions;
    sessions.forEach((t) => t.slots.forEach((s) => exercisesUsed.add(s.exercise)));
    const week: Week = { index: w.weekInMeso, kind: w.kind, start: w.start, sessions };
    if (w.calibration) week.calibration = true;
    if (w.tests) week.tests = true;
    programWeeks.push({ plan: w, week });
  }

  const exercises = Object.fromEntries([...exercisesUsed].sort().map((id) => [id, toExercise(ctx.byId.get(id)!, ctx.unit)]));
  const phases: Phase[] = macro.phases.map((p) => ({
    id: p.id,
    name: p.name,
    goal: p.goal,
    mesocycles: p.mesos.map((m): Mesocycle => ({ id: `meso-${m + 1}`, name: `Mesocycle ${m + 1}`, weeks: programWeeks.filter((x) => x.plan.meso === m).map((x) => x.week) })),
  }));
  const program: Program = {
    schemaVersion: 1,
    id: `plan-${ctx.start}`,
    name: `${tpl.id}, ${ctx.weeks} weeks from ${ctx.start}`,
    exercises,
    macrocycle: { id: 'macro-1', name: macro.phases.map((p) => p.name).join(', '), start: ctx.start, phases },
  };
  if (ctx.priority.length) program.priorityMuscles = [...ctx.priority];
  // Desk breaks for desk work (the intake's answer); none otherwise.
  const desk = deskBreaksFor(ctx.profile).value;
  if (desk) program.deskBreaks = desk;

  // Checks.
  const checks: Check[] = [];
  const check = (id: string, problems: string[], ok: string) => checks.push({ id, passed: problems.length === 0, detail: problems.length ? problems.join('; ') : ok });
  check('screening', screeningViolations, screeningChanges.length ? `Caps applied: ${screeningChanges.length} change(s).` : `Within the ${ctx.outcome} caps.`);

  const volProblems: string[] = [];
  const ratioProblems: string[] = [];
  const volume: Proposal['volume'] = [];
  const muscles = [...new Set([...MAJOR_MUSCLES, ...ctx.priority])];
  for (const { plan: w, week } of programWeeks) {
    if (w.kind !== 'loading') continue;
    const lift = week.sessions.filter((t) => t.kind === 'lift');
    const pv = plannedSetsPerMuscle(lift, exercises, { effort: (s) => effortOf(s.exercise, exercises[s.exercise]?.name ?? s.exercise, s.rir) }).value;
    for (const c of checkVolume(pv.perWeek, { muscles, priority: ctx.priority, ...(nearFailure(w.phase) ? { split: pv.split } : {}) })) {
      // A priority muscle over 16 is reported once, by the line below.
      if (c.value.status !== 'ok' && c.value.status !== 'priority-high') {
        const under = c.value.status === 'priority-direct-under' ? `, ${(c.value.hardDirect ?? 0) + (c.value.unknown ?? 0)} direct near failure` : '';
        volProblems.push(`week ${w.index} ${c.value.muscle} ${c.value.sets} (${c.value.status}${under})`);
      }
      const postureMuscle = ctx.pullPush?.why === 'finding' && (c.value.muscle === 'upper-back' || c.value.muscle === 'lats');
      // Where the minimum counts direct sets near failure, a priority muscle tops out at 16, or at the
      // minimum plus the half credit from its helping lifts when that is more, at most 20 (volume-fit.ts).
      const top = nearFailure(w.phase) ? Math.max(BANDS.priority[1], Math.min(BANDS.cap, BANDS.priority[0] + (pv.split[c.value.muscle]?.indirect ?? 0))) : BANDS.priority[1];
      if (c.value.priority && c.value.sets > top + 1e-9 && !postureMuscle) volProblems.push(`week ${w.index} ${c.value.muscle} ${c.value.sets} (over ${top === BANDS.priority[1] ? '16' : `${top}, the minimum of 10 plus its half credit,`} for a priority muscle)`);
    }
    for (const [m, v] of Object.entries(pv.perWeek)) if (v > 20) volProblems.push(`week ${w.index} ${m} ${v} (over 20)`);
    pv.overSession.forEach((o) => volProblems.push(`week ${w.index} ${o.template} ${o.muscle} ${o.sets} direct sets in one session`));
    // The same count review reports (volume.ts's pullPushSets).
    const { pull, push, status } = pullPushSets(lift, exercises, { aim: ctx.pullPush }).value;
    if (status === 'below') ratioProblems.push(`week ${w.index}: pull ${pull} / push ${push}`);
    if (w.meso === 0) {
      volume.push({ week: w.index, layout: lift.map((t) => t.id), perWeek: pv.perWeek, split: pv.split, tiers: Object.fromEntries(muscles.map((m) => [m, volumeTier(pv.perWeek[m] ?? 0)])), pullPush: { pull, push } });
    }
  }
  check('volume', volProblems, `Every loading week inside the bands (major muscles 4+, priority 10-16${ctx.outcome !== 'conservative' ? ' with at least 10 direct sets near failure, past 16 only by the half credit on top of those 10' : ''}${ctx.posture ? ', the posture emphasis\'s upper back and lats up to 20' : ''}, nothing over 20, at most 8 direct sets per session).`);
  if (ctx.pullPush) check('pull-push', ratioProblems, `Pull at least ${ctx.pullPush.floor} times push in every loading week (${ctx.pullPush.why === 'finding' ? 'the posture finding' : 'the posture goal'}).`);

  const concurrentProblems: string[] = [];
  for (const p of macro.phases) {
    const w = programWeeks.find((x) => x.plan.phase === p.index && x.plan.kind === 'loading' && !x.plan.calibration) ?? programWeeks.find((x) => x.plan.phase === p.index)!;
    // The same lifting items `review` builds (concurrent.ts's liftItem): a lighter day is told by its loads, not its name.
    const liftingDays = w.week.sessions.filter((t) => t.kind === 'lift').map((t, i) => ({
      day: days.lifting[i]!,
      id: t.id,
      lifts: t.slots.filter((s) => exercises[s.exercise]!.kind !== 'cardio' && exercises[s.exercise]!.kind !== 'timed').map((s) => liftItem(s, exercises[s.exercise])),
      finisher: t.slots.some((s) => exercises[s.exercise]!.kind === 'cardio'),
    }));
    // Each problem with its reason's note: the suggestion, then the days and where they came from.
    for (const f of checkConcurrent(plannedWeek(liftingDays, conditioningByPhase[p.index]!.sessions.map((c) => ({ ...c, exercise: ctx.byId.get(c.exercise)?.name ?? c.exercise })), sourceOf), exercises)) concurrentProblems.push(`${p.id}: ${f.reason.note ?? f.value.suggestion}`);
  }
  const weekSources = [...new Set([...days.sources.lifting, ...days.sources.extra])].map((s) => DAY_SOURCES[s]);
  check('concurrent', concurrentProblems, `Conditioning placement passes the concurrent-training checks, on ${weekSources.length > 1 ? `${weekSources.slice(0, -1).join(', ')} and ${weekSources.at(-1)}` : weekSources[0]}.`);

  check('schema', validateProgram(program).map((e) => `${e.path}: ${e.message}`), 'The program validates against schema v1.');
  const missingKit = Object.keys(exercises).filter((id) => !ctx.byId.get(id)!.equipment.every((q) => q === 'bodyweight' || ctx.equipment.has(q)));
  check('equipment', missingKit.map((id) => `${ctx.byId.get(id)!.name} needs equipment not listed`), 'Every exercise uses listed equipment.');
  const blocked: string[] = [];
  for (const { plan: w, week } of programWeeks) {
    for (const t of week.sessions) for (const s of t.slots) {
      if (!screenExercise(s.exercise, ctx.ledger, w.start, ctx.exercises).value.allowed) blocked.push(`week ${w.index} ${ctx.byId.get(s.exercise)?.name ?? s.exercise}`);
    }
  }
  check('ledger', [...new Set(blocked)], 'No exercise is blocked by the Ledger in the weeks it appears.');
  const slow = builtByMeso.flat().filter((t) => estimatedMinutes(t) > tpl.minutes).map((t) => `${t.blueprint.id} ${estimatedMinutes(t)} min`);
  check('time', [...new Set(slow)], `Every session fits ${tpl.minutes} min.`);
  const drift: string[] = [];
  for (const p of macro.phases) {
    const ws = programWeeks.filter((x) => x.plan.phase === p.index);
    for (const b of tpl.blueprints) {
      const seen = new Set(ws.flatMap((x) => x.week.sessions.filter((t) => t.id === b.id).flatMap((t) => t.slots.filter((s) => s.main).map((s) => s.exercise))));
      const mains = (mainsByPhase[p.index]!.get(b.id) ?? []).filter((x): x is Pick => x !== null).length;
      if (seen.size > mains) drift.push(`${p.id} ${b.id}: ${[...seen].map((x) => ctx.byId.get(x)?.name ?? x).join(', ')}`);
    }
  }
  check('main-lifts', drift, 'Main lifts are constant within each phase.');

  const cal = calibrationPlan(ctx).value;
  const tgts = targets(ctx, macro.phases, conditioningByPhase[0]!.steps).value;
  const firstLoading = programWeeks.find((x) => x.plan.kind === 'loading' && !x.plan.calibration) ?? programWeeks[0]!;
  const sessionsOut: ProposalSession[] = [];
  for (const t of firstLoading.week.sessions) {
    if (sessionsOut.some((x) => x.id === t.id)) continue;
    const b = builtByMeso[firstLoading.plan.meso]!.find((x) => x.blueprint.id === t.id);
    sessionsOut.push({
      id: t.id,
      name: t.name,
      kind: t.kind,
      estimatedMinutes: b ? estimatedMinutes(b) : null,
      slots: t.slots.map((s) => ({
        exercise: s.exercise,
        name: ctx.byId.get(s.exercise)!.name,
        sets: s.sets,
        reps: s.repRange[0] === 1 && s.repRange[1] === 1 ? 'hold or time' : s.repRange[0] === s.repRange[1] ? `${s.repRange[0]}` : `${s.repRange[0]}-${s.repRange[1]}`,
        rir: s.rir,
        main: s.main === true,
        progression: s.progression?.rule ?? 'none',
        ...(s.progression?.ladder && s.progression.level ? { ladder: { id: s.progression.ladder, level: s.progression.level, name: LADDER_BY_ID.get(s.progression.ladder)?.levels[s.progression.level - 1]?.name ?? '' } } : {}),
        note: s.note ?? '',
      })),
    });
  }
  const layoutWeek = tpl.rotation[0]!;
  const warnings: ProposalWarning[] = [];
  // The week's room against the named priority muscles: a priority the plan trains on its short sessions does not count.
  const shortTrained = [...new Set(firstLoading.week.sessions.filter((t) => t.kind !== 'lift').flatMap((t) => t.slots.flatMap((x) => exercises[x.exercise]?.kind === 'cardio' ? [] : (exercises[x.exercise]?.muscles?.main ?? []))))];
  const room = priorityOverRoom(ctx.prioritySources, ctx.priorityRoom, shortTrained, { liftingDays: tpl.liftingDays, minutes: tpl.minutes });
  if (room) warnings.push({ code: 'priority-over-room', muscles: room.value.counted, reason: room.reason });
  // A priority muscle the fit left short, once, from the first mesocycle it is short in.
  const shortSeen = new Set<string>();
  fitsByMeso.forEach((f, m) => {
    for (const x of f.shortfalls) {
      if (shortSeen.has(x.muscle)) continue;
      shortSeen.add(x.muscle);
      const mesos = fitsByMeso.flatMap((g, k) => (g.shortfalls.some((y) => y.muscle === x.muscle) ? [k + 1] : []));
      const r = explain(x, 'plan.priority-short', { muscle: x.muscle, have: x.have, mesocycles: mesos, ...(f.swaps.length ? { swaps: f.swaps.map((y) => `${y.template}/${y.from} -> ${y.to}`) } : {}) }, {
        title: 'Priority minimum',
        threshold: { priorityDirect: x.need, hardRir: 3 },
        note: `${MUSCLES.find((y) => y.id === x.muscle)?.label ?? x.muscle}: ${x.have} direct sets near failure a week in mesocycle ${m + 1}${mesos.length > 1 ? ` (short in mesocycles ${mesos.join(', ')})` : ''}, under the ${x.need} a priority muscle needs; ${x.blocked.join('; ')}.`,
      });
      warnings.push({ code: 'priority-short', muscles: [x.muscle], reason: r.reason });
    }
  });
  const proposal: Proposal = {
    status: checks.every((c) => c.passed) ? 'ok' : 'checks-failed',
    why: [size.reason.note ?? '', tplR.reason.note ?? '', ...notes].filter(Boolean),
    warnings,
    personalization: [],
    templates: [],
    families: [],
    ladders: [],
    priority: [],
    volumeMap: { source: 'catalogue', fromVault: [], fromCatalogue: [] },
    template: { id: tpl.id, family: tpl.family, modifier: ctx.modifier, equipmentMode: ctx.equipmentMode, experience: ctx.experience, liftingDays: tpl.liftingDays, extraDays: tpl.extraDays, minutes: tpl.minutes },
    week: {
      days: [
        ...days.lifting.map((d, i) => ({ weekday: WEEKDAYS[d]!, session: layoutWeek[i % layoutWeek.length]!, kind: 'lift' as const, source: days.sources.lifting[i]! })),
        ...conditioningByPhase[0]!.sessions.map((c) => ({ weekday: WEEKDAYS[c.day]!, session: `conditioning-${WEEKDAYS[c.day]}`, kind: 'cardio' as const, source: sourceOf(c.day) ?? ('default' as const) })),
      ].sort((a, b) => WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday)),
      layout: layout.reason,
      minimumWeek: { sessions: tpl.liftingDays, minutes: 20, content: "Express: each session's main lifts at 2 working sets; accessories and conditioning optional." },
    },
    phases: macro.phases.map((p: PhasePlan) => ({
      id: p.id,
      name: p.name,
      goal: p.goal,
      from: p.from,
      to: p.to,
      weeks: macro.weeks.filter((w) => w.phase === p.index).map((w) => ({ index: w.index, start: w.start, kind: w.kind, calibration: w.calibration, tests: w.tests })),
    })),
    sessions: sessionsOut,
    volume,
    progression: [...new Map(programWeeks.filter((x) => x.plan.phase === 0).flatMap((x) => x.week.sessions.flatMap((t) => t.slots.filter((s) => s.main && s.progression).map((s) => [s.exercise, { exercise: s.exercise, ...s.progression! }] as const)))).values()],
    calibration: cal,
    conditioning: conditioningByPhase,
    calendar: calendar(ctx, macro.weeks, macro.phases).value,
    targets: tgts,
    preMortem: preMortem(ctx, tpl.liftingDays, tpl.minimumDose, size.value.confirmed, tpl.family).value,
    warmUp: warmUp(ctx),
    checks,
  };

  // What the comparison scores: how often each main lift comes round, the longest session, liked movements placed, heavy leg days.
  const meso0 = builtByMeso[0]!;
  const freq: Record<string, number> = {};
  for (const layout of tpl.rotation) for (const id of layout) for (const x of meso0.find((t) => t.blueprint.id === id)?.slots ?? []) if (x.role === 'main') freq[x.entry.id] = (freq[x.entry.id] ?? 0) + 1 / tpl.rotation.length;
  const mains = Object.values(freq);
  const facts: CandidateFacts = {
    mainFrequency: mains.length ? mains.reduce((a, b) => a + b, 0) / mains.length : 0,
    longest: Math.max(0, ...builtByMeso.flat().map((t) => estimatedMinutes(t))),
    likedPlaced: [...ctx.likes].filter((id) => id in exercises),
    heavyLegDays: tpl.rotation[0]!.filter((id) => {
      const b = tpl.blueprints.find((x) => x.id === id)!;
      return b.day !== 'light' && isLowerMain(b);
    }).length,
    checks,
  };
  return { tplR, program, proposal, facts };
}

/** A ladder's use in a program: the session templates with a slot on it. */
function ladderSessions(program: Program, id: string): string[] {
  const out = new Set<string>();
  for (const ph of program.macrocycle.phases) for (const m of ph.mesocycles) for (const w of m.weeks) for (const t of w.sessions) if (t.slots.some((s) => s.progression?.ladder === id)) out.add(t.id);
  return [...out].sort();
}

/** rules.md's split families for this week: the candidates built in each, its fit and costs, and what is left to the coach. */
function splitFamilies(ctx: PlanContext, rows: readonly TemplateScore[], week: { days: number; minutes: number }): ProposalFamily[] {
  return FAMILIES.map((f) => {
    const candidates = rows.filter((r) => r.families.includes(f.id)).map((r) => r.id);
    const built = candidates.length ? `Built and scored here: ${candidates.join(', ')}.` : '';
    const note = {
      built: built || `Not among the candidates for ${week.days} lifting day(s) of ${week.minutes} min${ctx.outcome === 'conservative' || ctx.modifier === 'health' ? ' (full body only for this screening or goal)' : ''}.`,
      partly: joinNotes(f.engineNote, built, 'The rest of it is the coach\'s, as a scratch plan-data (planning.md, step 1.4).') ?? '',
      coach: joinNotes(f.engineNote, 'The coach builds it as a scratch plan-data and scores it beside these (planning.md, step 1.4).') ?? '',
    }[f.engine];
    return { family: f.id, name: f.name, structure: f.structure, engine: f.engine, candidates, fit: familyFit(f.id, ctx, week), costs: [...f.costs], evidence: f.evidence, note };
  });
}

/** Every candidate template built in full (planning.md's table first), before the comparison picks one. */
export function planCandidates(input: PlanInput): { template: TemplateChoice; program: Program; proposal: Proposal }[] {
  const ctx = buildContext(input);
  if (!screeningCaps(ctx.outcome, { firstMesocycle: true }).value.prescribe) return [];
  const size = sizeWeek(ctx);
  const macro = buildMacrocycle(ctx).value;
  return templateCandidates(ctx, size.value.days, size.value.minutes, size.value.longDays).map((c) => {
    const b = buildCandidate(ctx, size, c, macro);
    return { template: b.tplR.value, program: b.program, proposal: b.proposal };
  });
}

export function generatePlan(input: PlanInput): Result<GeneratedPlan> {
  const ctx = buildContext(input);
  const rule = 'plan.generate';
  const caps0 = screeningCaps(ctx.outcome, { firstMesocycle: true });
  if (!caps0.value.prescribe) {
    const why = [`Screening outcome is blocked (${ctx.profile.screening.date}): logging only, no plan and no progression advice.`, REFERRAL.plan];
    return explain<GeneratedPlan>({ program: null, proposal: emptyProposal(why, [{ id: 'screening', passed: false, detail: 'Blocked: no prescription.' }]) }, rule, { outcome: ctx.outcome, start: ctx.start }, {
      note: why.join(' '),
    });
  }

  const size = sizeWeek(ctx);
  const macro = buildMacrocycle(ctx).value;
  const built = templateCandidates(ctx, size.value.days, size.value.minutes, size.value.longDays).map((c) => buildCandidate(ctx, size, c, macro));
  const comparison = compareTemplates(ctx, built.map((b) => ({ tpl: b.tplR.value, facts: b.facts })));
  const picked = built[comparison.value.picked]!;
  const { program } = picked;
  const tpl = picked.tplR.value;
  const proposal: Proposal = { ...picked.proposal };
  proposal.templates = comparison.value.rows;
  proposal.families = splitFamilies(ctx, comparison.value.rows, { days: built[0]!.tplR.value.liftingDays, minutes: size.value.minutes });
  const coach = proposal.families.filter((f) => f.engine === 'coach').map((f) => f.name);
  const partly = proposal.families.filter((f) => f.engine === 'partly').map((f) => f.name);
  const familiesLine = `Split families the engine does not build, for the coach to build and score beside these (planning.md, step 1.4): ${coach.join(', ')}; in part: ${partly.join(', ')}.`;
  proposal.why = [proposal.why[0] ?? '', comparison.reason.note ?? '', familiesLine, ...proposal.why.slice(1)].filter(Boolean);
  proposal.ladders = ctx.selfCheck.ladders.map((r) => {
    const sessions = ladderSessions(program, r.value.id);
    return { ...r.value, used: sessions.length > 0, sessions, reason: r.reason };
  });
  proposal.priority = ctx.prioritySources.map((r) => ({ muscle: r.value.muscle, source: r.value.source, reason: r.reason }));
  const usedIds = Object.keys(program.exercises).filter((id) => ctx.byId.get(id)!.load !== 'cardio' && ctx.byId.get(id)!.pattern !== 'mobility');
  proposal.volumeMap = ctx.muscleMap
    ? { source: 'vault', fromVault: usedIds.filter((id) => ctx.muscleMap![id]).map((id) => ({ exercise: id, guide: ctx.muscleMap![id]!.guide })), fromCatalogue: usedIds.filter((id) => !ctx.muscleMap![id]) }
    : { source: 'catalogue', fromVault: [], fromCatalogue: usedIds };
  proposal.personalization = personalization(ctx, { program, proposal, tpl, size: size.value, comparison: comparison.value }).value;
  const failed = proposal.checks.filter((c) => !c.passed).map((c) => c.id);
  return explain<GeneratedPlan>({ program, proposal }, rule, { start: ctx.start, weeks: ctx.weeks, template: tpl.id, compared: built.map((b) => b.tplR.value.id), outcome: ctx.outcome, status: proposal.status }, {
    note: joinNotes(`${tpl.id}: ${tpl.liftingDays} lifting day(s) of ${tpl.minutes} min, ${ctx.weeks} weeks from ${dayText(ctx.start)}.`, failed.length > 0 && `Failed checks: ${failed.join(', ')}.`),
  });
}
