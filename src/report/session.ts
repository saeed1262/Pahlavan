// The session command: today's session as the Today screen shows it. The
// session the user picked, else the one logged today, else the next in the
// rotation for the calendar's day; then, in order, the variant (full, express, hotel), the Ledger screen,
// soreness, readiness, and each lift's target in its own unit (the load cap,
// a deload week and the return after missed time already applied). Every
// adjustment carries its reason and title. Each row also carries the plan's
// rest, its superset pair (numbered as the month plan numbers it, 4a and 4b)
// and the note's form cue; a timed item its structure (`timed`, with its
// rounds as `sets`), intervals in a calibration week as easy steady minutes.
// Pure: the date is an input.

import { type VaultData } from '../adapters/vault/convert.ts';
import { calibrateTimed, calibrationCardioNote, calibrationNote } from '../core/calibration.ts';
import { busyPeriods } from '../core/checkins.ts';
import { CATALOGUE_BY_ID, type CatalogueEntry } from '../core/data/exercises.ts';
import { dayText, daysBetween, mondayOf } from '../core/dates.ts';
import { plannedEffort, typicalMinutes } from '../core/load.ts';
import { toExercise } from '../core/plan/context.ts';
import { effectiveSlot, weekAt } from '../core/plan.ts';
import { itemTimed, noteCue, numberRows, parseNote, restOf, type SlotExtras } from '../core/plan-data.ts';
import { explain, type Reason } from '../core/reason.ts';
import { fromKind, lightDoseText } from '../core/rules.ts';
import { screenExercise, screeningCaps } from '../core/safety.ts';
import type { Exercise, ExerciseSlot, IsoDate, RepRange, SessionTemplate, TimedWork } from '../core/schema.ts';
import { halfTimed, timedMinutes, timedSets, timedView, type TimedView } from '../core/timed.ts';
import { sorenessForSlot } from '../core/soreness.ts';
import { expressVariant, halveSr, hotelVariant, shortExpressVariant, travelEquipment, type SessionMode, type VariantSlot } from '../core/variant.ts';
import { buildReview, CALENDAR, calibrationOf, context, ledgerConstraints, nameOf, sessionLabel } from './review.ts';

export interface SessionItem {
  exercise: string;
  name: string;
  sets: number;
  repRange: RepRange;
  rir: number;
  main: boolean;
  /** The plan's own sets-and-reps text ("4 × 8–10", "4 rounds, 40/20"), for an item done as planned. */
  sr?: string;
  /**
   * A timed item: its minutes and structure as done today (Express halves
   * it; intervals in a calibration week are easy steady minutes), `minutes`
   * its whole length and `text` in words ("4 × 4 min hard, 3 min easy
   * between · about 25 min"). `sets` is then its rounds, 1 for steady minutes.
   */
  timed?: TimedView;
  /** The plan's exercise this one replaces today. */
  replaces?: { exercise: string; name: string };
  /** The plan's line for this item, as plan-data names it ("Handstand (your level)"): the log's checklist uses it. */
  planName?: string;
  unavailable?: boolean;
  /** The weight to aim for, in the exercise's own unit; null when the engine has no load to start from. */
  target: { weight: number | null; unit: string; reps: number; rir: number; action: string } | null;
  /** The last logged top set, in the exercise's unit, with the weight as logged. */
  last: unknown;
  /**
   * The plan's own reason for the item: "Why: ..." in its plan-data note.
   * `of` names the planned exercise when today's item replaces it (a swap
   * keeps the reason the slot is in the plan).
   */
  planWhy?: { text: string; of?: string };
  /** The row's number as the month plan numbers it: "1", "2", and a superset's two rows "4a" and "4b". */
  num: string;
  /** The plan's rest for the item ("2–3 min", "90 s after each pair"); absent when it gives none. */
  rest?: string;
  /**
   * A superset: this row and the other are done back to back (a set of each,
   * then the rest). `group` is their number, `label` this row's ("4a").
   */
  pair?: { group: number; label: string; with: { exercise: string; name: string } };
  /**
   * The form cue from the plan's note: the note before its "Why:", without
   * what the row shows elsewhere (RIR, progression, the superset sentence, a
   * temporary change). Absent when nothing is left, and for a swap (the cue
   * is the planned exercise's).
   */
  cue?: string;
  adjustments: Reason[];
}


/** The user's own choice of session for the day: a plan session type ("A", "S3"). */
export interface SessionPick {
  type?: string | null;
}

/** "8-10", or "12" when the range has one value. */
const repsText = (r: RepRange) => (r[0] === r[1] ? `${r[0]}` : `${r[0]}-${r[1]}`);
/** "easy, conversational." reads "Easy, conversational.". */
const sentence = (t: string) => (t ? t[0]!.toUpperCase() + t.slice(1) : t);

export function buildSession(data: VaultData, date: IsoDate, mode: SessionMode, pick: SessionPick = {}) {
  const ctx = context(data, date);
  const review = buildReview(data, date);
  const week = weekAt(data.program, date);
  const flags: Reason[] = [];

  // Which session: today's logged one, else the next in the rotation for the calendar's day.
  const loggedToday = ctx.sessions.filter((s) => s.date === date && (s.plan?.template ?? s.template));
  const weekday = daysBetween(mondayOf(date), date);
  const liftDay = (CALENDAR.liftDays as readonly number[]).includes(weekday) || !data.plan.types.some((t) => t.kind === 'short');
  const nextType = liftDay ? review.nextInRotation.lift : review.nextInRotation.short;
  const templateOf = (tp: string) => data.plan.types.find((t) => t.template === tp);
  const loggedType = loggedToday.length ? templateOf(loggedToday.at(-1)!.plan?.template ?? loggedToday.at(-1)!.template!) : undefined;
  const suggested = loggedType ?? data.plan.types.find((t) => t.type === nextType);

  // The user's pick: any session type in the plan, built the same way. A pick of
  // the suggestion itself is no pick; an unknown one, or one this week's plan
  // does not hold, falls back to the suggestion with a calm note.
  const wanted = pick.type ? data.plan.types.find((t) => t.type === pick.type) : undefined;
  let pickNote: string | null = null;
  if (pick.type && !wanted) pickNote = `No session "${pick.type}" in the plan (it has ${data.plan.types.map((t) => t.type).join(', ')}); showing the suggested session.`;
  else if (wanted && !week?.sessions.some((t) => t.id === wanted.template)) pickNote = `${wanted.label} is not in this week's plan; showing the suggested session.`;
  const picked = Boolean(wanted && !pickNote && wanted.type !== suggested?.type);
  const type = picked ? wanted : suggested;
  const template = type ? week?.sessions.find((t) => t.id === type.template) : undefined;
  if (!type || !template) {
    // Before the plan's start week: say when it begins (Today's session card shows the note).
    const ahead = data.plan.start && date < data.plan.start ? data.plan.start : null;
    const note = ahead ? `Your plan starts ${dayText(ahead)}: no planned session before then.` : 'No planned session for this date (no plan week holds it, or the plan has no sessions).';
    return { date, mode, session: null, choices: [], items: [], finisher: null, warmup: null, flags, note, ...(ahead ? { planStarts: ahead } : {}), ...(pickNote ? { pickNote } : {}) };
  }
  const loggedThis = loggedToday.some((s) => (s.plan?.template ?? s.template) === type.template);
  const suggestionWhy = loggedType
    ? `Logged today (${loggedToday.map((s) => sessionLabel(ctx, s)).join(', ')}).`
    : `Next in the ${liftDay ? 'lifting' : 'short-session'} rotation; the training calendar has a ${liftDay ? 'lifting' : 'short'} day on ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][weekday]}.`;
  const why = picked
    ? `Chosen by you; ${!suggested ? 'the rotation has no suggestion today' : loggedType ? `logged today: ${suggested.label}` : `the rotation suggested ${suggested.label}`}.`
    : suggestionWhy;
  // A timed item starts from its structure as the plan writes it (the item's `timed`, else its sr and note), with
  // its rounds as sets: the calibration week's easy minutes are applied below, with their reason.
  const plannedTimed = (s: ExerciseSlot): ExerciseSlot => {
    const own = (s as ExerciseSlot & SlotExtras)._item;
    const t: TimedWork | null = own ? itemTimed(own) : (s.timed ?? null);
    return t ? { ...s, timed: t, sets: timedSets(t) } : s;
  };
  const tpl: SessionTemplate = { ...template, slots: template.slots.map((s) => plannedTimed(effectiveSlot(s, date).value)) };

  // Exercises the session may use: the program's, plus the catalogue's (for swaps).
  const all: Record<string, Exercise> = { ...data.program.exercises };
  const unit = data.plan.liftUnit;
  const catalogueOf = (id: string): CatalogueEntry | null => CATALOGUE_BY_ID.get(id) ?? (data.catalogueMatch[id] ? (CATALOGUE_BY_ID.get(data.catalogueMatch[id]) ?? null) : null);
  const addCatalogue = (id: string) => {
    const e = CATALOGUE_BY_ID.get(id);
    if (e && !all[id]) all[id] = toExercise(e, unit);
  };
  for (const e of CATALOGUE_BY_ID.values()) addCatalogue(e.id);
  const name = (id: string) => (data.program.exercises[id] ? nameOf(ctx, id) : (CATALOGUE_BY_ID.get(id)?.name ?? id));
  const constraints = ledgerConstraints(data);
  // Hotel: what the profile says travel usually offers, else bodyweight, light dumbbells and bands (its swaps and the lighter variations for soreness).
  const travelKit = travelEquipment(data.profile);

  // The finisher: the plan's trailing cardio item (Express: its own finisher).
  const kindOf = (id: string) => all[id]?.kind ?? 'strength';
  let body = tpl.slots;
  let finisherSlot: ExerciseSlot | null = null;
  if (body.length && kindOf(body.at(-1)!.exercise) === 'cardio') {
    finisherSlot = body.at(-1)!;
    body = body.slice(0, -1);
  }

  // 1. The variant.
  let slots: VariantSlot[];
  let warmup = tpl.kind === 'lift' || tpl.kind === 'express' ? data.plan.warmups.lift : data.plan.warmups.short;
  let variantReason: Reason | null = null;
  const srOf = (s: ExerciseSlot) => (s as ExerciseSlot & SlotExtras)._item?.sr ?? null;
  if (mode === 'express' && tpl.kind === 'short') {
    // A short day keeps its items and its own finisher, each at half.
    const r = shortExpressVariant({ ...tpl, slots: body }, srOf, { rule: data.rules.rules.express, from: fromKind(data.rules, 'express') });
    slots = r.value.slots;
    variantReason = r.reason;
    if (data.rules.rules.express.short === 'skip') finisherSlot = null;
    else if (finisherSlot) {
      const f = finisherSlot as ExerciseSlot & SlotExtras;
      const fsr = srOf(f);
      finisherSlot = { ...f, sets: Math.max(1, Math.ceil(f.sets / 2)), ...(f.timed ? { timed: halfTimed(f.timed) } : {}), ...(f._item ? { _item: { ...f._item, ...(fsr ? { sr: halveSr(fsr) } : {}) } } : {}) };
    }
  } else if (mode === 'express') {
    const block = data.plan.express ? { warmup: data.plan.express.warmup ?? undefined, mainSets: data.plan.express.mainSets, secondSets: data.plan.express.secondSets, ...(data.plan.express.finish ? { finish: { exercise: data.plan.express.finish.exercise, sets: data.plan.express.finish.sets, repRange: data.plan.express.finish.repRange } } : {}) } : null;
    const r = expressVariant({ ...tpl, slots: body }, block);
    slots = r.value.slots;
    variantReason = r.reason;
    if (r.value.warmup) warmup = r.value.warmup;
    finisherSlot = null;
    if (block?.finish) {
      const f = slots.pop()!;
      finisherSlot = f;
    }
  } else if (mode === 'hotel') {
    const travel = busyPeriods(ctx.records, date).find((b) => b.kind === 'travel' && b.from <= date && date <= b.to);
    const tripDays = travel ? daysBetween(travel.from, travel.to) + 1 : null;
    const caps = data.profile ? screeningCaps(data.profile.screening.outcome).value : null;
    const r = hotelVariant({ template: { ...tpl, slots: body }, exercises: data.program.exercises, catalogueOf, ledger: constraints, date, unit, tripDays, capMinRir: caps?.minRir ?? null, travel: travelKit, rule: data.rules.rules.hotel, from: fromKind(data.rules, 'hotel') });
    slots = r.value.slots;
    variantReason = r.reason;
  } else {
    slots = body.map((s) => ({ ...s, reasons: [] }));
  }
  if (variantReason) flags.push(variantReason);

  // A calibration week: plan week 1's slots already carry the calibration RIR; a restart's first week takes it here.
  // Intervals that week are easy steady minutes (plan.calibration.cardio), from the plan's structure either way.
  // The calibration rule: the plan's (its RIR, whether intervals turn easy), else the old default.
  const calRule = data.rules.rules.calibration;
  const calFrom = fromKind(data.rules, 'calibration');
  const sorenessFrom = fromKind(data.rules, 'soreness');
  const calibration = calibrationOf(ctx, review.missed.value);
  const calibrating = calibration !== null;
  const calibrateCardio = (t: TimedWork | undefined) => (calibration && t && calRule.cardio === 'easy' ? calibrateTimed(t, calibration) : null);
  const plannedRir = (exercise: string, r: number) => (calibrating && kindOf(exercise) === 'strength' ? Math.max(r, calRule.rir) : r);
  const planned = new Map(template.slots.map((s) => [s.exercise, s]));
  // Where each row's plan line sits in the plan's session, for the superset pairs.
  const planAt: number[] = [];
  const built: Omit<SessionItem, 'num'>[] = slots.map((v) => {
    const adjustments: Reason[] = [...v.reasons];
    // A temporary change in force: its reason and the way back.
    const own = planned.get(v.exercise);
    const planSlot = own ?? (v.replaces ? planned.get(v.replaces) : undefined);
    planAt.push(planSlot ? template.slots.indexOf(planSlot) : -1);
    if (own?.until && date <= own.until.until) adjustments.push(effectiveSlot(own, date).reason);
    let exercise = v.exercise;
    let replaces = v.replaces ? { exercise: v.replaces, name: name(v.replaces) } : undefined;
    let sets = v.sets;
    let rir = plannedRir(v.exercise, v.rir);
    let trimmed = false;
    // A timed item's minutes are its dose: its rounds are its sets, and readiness never trims them.
    const easy = calibrateCardio(v.timed);
    const timed = easy ? easy.value : v.timed;
    if (easy) adjustments.push(easy.reason);
    if (timed) sets = timedSets(timed);

    // 2. The Ledger: swap a blocked planned exercise; keep the conditions of an allowed one (hotel swaps too).
    if (constraints.length) {
      const sc = screenExercise(exercise, constraints, date, all, v.swaps ? { swaps: v.swaps } : {});
      if (!sc.value.allowed && !v.replaces && sc.value.swaps[0]) {
        replaces = { exercise, name: name(exercise) };
        exercise = sc.value.swaps[0];
        adjustments.push(sc.reason);
      } else if (!sc.value.allowed || sc.value.conditions.length) adjustments.push(sc.reason);
    }

    // 3. Soreness: a lighter variation for a muscle sore two days running, else one set fewer.
    const entry = catalogueOf(exercise);
    const lighterId = entry?.easier.find((id) => {
      const e = CATALOGUE_BY_ID.get(id);
      if (!e) return false;
      if (mode === 'hotel' && !e.equipment.every((q) => travelKit.equipment.includes(q))) return false;
      return !constraints.length || screenExercise(id, constraints, date, all).value.allowed;
    });
    const so = sorenessForSlot({ ...v, exercise, sets, rir }, all, ctx.daily, date, { lighter: lighterId ? { id: lighterId, name: name(lighterId) } : null, name, rule: data.rules.rules.soreness, from: sorenessFrom });
    if (so.value.action !== 'none') adjustments.push(so.reason);
    if (so.value.action === 'swap') {
      replaces ??= { exercise, name: name(exercise) };
      exercise = so.value.exercise;
    } else if (so.value.action === 'trim') {
      sets = so.value.sets;
      rir = so.value.rir;
      trimmed = true;
    }

    // 4. Readiness: low on the smoothed score, the plan's change (the old default: one set fewer and RIR +1), not on
    // top of a soreness trim. Under a rule of none, trim is never active.
    const trim = review.readiness.actions.find((a) => a.value.action === 'trim');
    const low = data.rules.rules.readiness.low;
    if (trim?.value.active && low && !timed) {
      if (!trimmed) {
        sets = Math.max(1, sets + low.sets);
        rir += low.rir;
      }
      adjustments.push(trim.reason);
    }

    // 5. The target, in the exercise's own unit, for a planned exercise with a logged history.
    const lift = !replaces ? review.lifts.find((l) => l.exercise === exercise) : undefined;
    let target: SessionItem['target'] = null;
    if (lift?.next?.value && typeof lift.next.value === 'object') {
      const n = ((lift.returnAdjusted?.value ?? lift.next.value) as { weight: number | null; unit: string; reps: number; rir: number; action: string });
      // A calibrated target's RIR is the item's too, so the row and its target say the same.
      if (n.action === 'calibrate') rir = Math.max(rir, n.rir);
      target = { weight: n.weight, unit: n.unit, reps: n.reps, rir: Math.max(n.rir, rir), action: n.action };
      adjustments.push(lift.next.reason);
      if (lift.returnAdjusted) adjustments.push(lift.returnAdjusted.reason);
      if (rir > n.rir && n.weight !== null) {
        adjustments.push(explain(rir, 'readiness.trim', { exercise, targetRir: n.rir, rir }, { title: 'Effort today', note: `RIR ${rir} today instead of ${n.rir}: keep ${n.weight} ${n.unit} if the reps still fit at RIR ${rir}, else take a step off.` }).reason);
      }
      if (lift.e1rm.value.unitFlag) adjustments.push(lift.e1rm.reason);
    } else if (replaces && kindOf(exercise) === 'strength') {
      const c = CATALOGUE_BY_ID.get(exercise);
      const reps = repsText(v.repRange);
      adjustments.push(explain(null, 'progression.start', { exercise, replaces: replaces.exercise }, {
        title: 'Progression',
        note: c?.load === 'bodyweight' || c?.load === 'timed'
          ? `${name(exercise)}: bodyweight, ${reps} reps at RIR ${rir}.`
          : c?.equipment[0] === 'band'
            ? `${name(exercise)}: pick a band that leaves ${rir} in reserve at ${reps} reps.`
            : `${name(exercise)}: no logged loads; pick a weight for ${reps} reps at RIR ${rir}.`,
      }).reason);
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- needed: TypeScript 7, this project's compiler, rejects the line without it (the linter's TypeScript 5 reads the type differently)
    const item = (own as (ExerciseSlot & SlotExtras) | undefined)?._item;
    // The plan's own line for this item (a hotel swap keeps the line it replaces): the log's checklist names it.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- needed: TypeScript 7, this project's compiler, rejects the line without it (the linter's TypeScript 5 reads the type differently)
    const planItem = item ?? (v.replaces ? (planned.get(v.replaces) as (ExerciseSlot & SlotExtras) | undefined)?._item : undefined);
    const asPlanned = !replaces && own && sets === own.sets && rir === plannedRir(own.exercise, own.rir) && v.repRange === own.repRange;
    const planWhy = parseNote(planItem?.note).why;
    // The rest belongs to the slot (a swap keeps it); the form cue to the planned exercise, so a swap has none.
    const rest = restOf(planItem);
    // The calibration week's intervals: their own line in place of the note's (which describes the intervals).
    const cue = replaces ? null : easy ? sentence(`${calibrationCardioNote(calibration!)}.`) : noteCue(planItem?.note);
    const view = timed ? timedView(timed) : null;
    return {
      exercise,
      name: name(exercise),
      sets,
      repRange: v.repRange,
      rir,
      main: v.main === true,
      ...(easy ? { sr: `${timedMinutes(timed)} min` } : v.sr ? { sr: v.sr } : asPlanned && item?.sr ? { sr: item.sr } : {}),
      ...(view ? { timed: view } : {}),
      ...(planItem?.name ? { planName: planItem.name } : {}),
      ...(replaces ? { replaces } : {}),
      ...(v.unavailable ? { unavailable: true } : {}),
      target,
      last: lift?.last ?? null,
      ...(planWhy ? { planWhy: { text: planWhy, ...(replaces ? { of: replaces.name } : {}) } } : {}),
      ...(rest ? { rest } : {}),
      ...(cue ? { cue } : {}),
      adjustments,
    };
  });

  // The numbers and the supersets, as the month plan has them: a row is the second of a pair when its plan
  // line has `pair` and the row before it is the plan line before it (Express, which drops one, breaks it).
  const pairedAt = (i: number) => i >= 0 && (template.slots[i] as ExerciseSlot & SlotExtras)._item?.pair === true;
  const rows = numberRows(built.map((_, k) => k > 0 && pairedAt(planAt[k]!) && planAt[k - 1]! >= 0 && planAt[k] === planAt[k - 1]! + 1));
  const items: SessionItem[] = built.map(({ adjustments, ...it }, k) => {
    const r = rows[k]!;
    const other = r.part === 'a' ? built[k + 1] : r.part === 'b' ? built[k - 1] : undefined;
    return { num: r.num, ...it, ...(other ? { pair: { group: r.group, label: r.num, with: { exercise: other.exercise, name: other.name } } } : {}), adjustments };
  });

  // Session-level flags: readiness, the deload week, the calibration week, missed time.
  for (const a of review.readiness.actions) if (a.value.action !== 'trim' && a.value.active) flags.push(a.reason);
  // The light week as the plan's rule (or the old default) has it.
  const lw = data.rules.rules.lightWeeks;
  const lightFrom = fromKind(data.rules, 'lightWeeks');
  if (week?.kind === 'deload') flags.push(explain(true, 'deload.decide', { week: week.start }, { title: 'Light week', note: 'At the bottom of each range, so your body catches up (what the rules call a deload).', from: lightFrom }).reason);
  // The rule's own words (calFrom) already say what the week does: no second note repeating them.
  if (week?.calibration) flags.push(explain(true, 'plan.calibration', { week: week.start }, { title: 'Calibration week', from: calFrom }).reason);
  if (review.missed.value.protocol !== 'continue' && review.missed.value.protocol !== 'start') flags.push(review.missed.reason);

  // The finisher (intervals as easy minutes in a calibration week) and the session's planned load (heuristic).
  const finisherWhy = finisherSlot ? parseNote((finisherSlot as ExerciseSlot & SlotExtras)._item?.note).why : null;
  const finisherEasy = calibrateCardio(finisherSlot?.timed);
  if (finisherEasy) flags.push(finisherEasy.reason);
  const finisherTimed = finisherSlot ? timedView(finisherEasy?.value ?? finisherSlot.timed) : null;
  const finisher = finisherSlot
    ? {
      exercise: finisherSlot.exercise,
      name: name(finisherSlot.exercise),
      // The plan's line; a light week's copy of the slot has none, so a timed finisher says its minutes.
      sr: finisherEasy ? `${finisherEasy.value.minutes} min` : (finisherSlot as ExerciseSlot & SlotExtras)._item?.sr ?? (finisherSlot.timed ? `${timedMinutes(finisherSlot.timed)} min` : mode === 'express' && data.plan.express?.finish ? data.plan.express.finish.sr : `${finisherSlot.sets} × ${finisherSlot.repRange[0]}`),
      ...(finisherTimed ? { timed: finisherTimed } : {}),
      ...(finisherWhy ? { planWhy: { text: finisherWhy } } : {}),
    }
    : null;
  // A lifting day's minutes: its typical logged length; a short day's: as planned, from its items, with its time check.
  const time = tpl.kind === 'short' ? (review.time.sessions.find((s) => s.type === type.type) ?? null) : null;
  const usual = time ? time.estimate.value.minutes : typicalMinutes(data.sessions, type.template, date);
  const skippedShort = mode === 'express' && tpl.kind === 'short' && data.rules.rules.express.short === 'skip';
  const minutes = skippedShort ? 0 : mode === 'express' ? (tpl.kind === 'short' ? Math.max(10, Math.round((usual ?? 30) / 2)) : 20) : usual;
  // A short day Express skips (the plan's rule) has no session, so no planned effort either.
  const effort = skippedShort
    ? explain(0, 'load.planned-effort', { template: tpl.id, kind: tpl.kind, skipped: true }, { note: 'Express on a short day skips it today (the plan\'s rule): no session, so no planned effort.' })
    : plannedEffort({ ...tpl, name: type.label }, data.program.exercises, { deload: week?.kind === 'deload' });

  return {
    date,
    mode,
    session: {
      type: type.type,
      name: type.label,
      template: type.template,
      kind: tpl.kind,
      logged: loggedThis,
      why,
      /** True when the user chose this session over the suggestion. */
      picked,
      /** What the engine would show without a pick: the session logged today, else the rotation's next. */
      suggested: suggested ? { type: suggested.type, name: suggested.label, kind: suggested.kind, why: suggestionWhy } : null,
    },
    /** Every session in the plan, for a picker: the suggestion first. */
    choices: [...data.plan.types].sort((a, b) => Number(b.type === suggested?.type) - Number(a.type === suggested?.type)).map((t) => ({ type: t.type, name: t.label, kind: t.kind, suggested: t.type === suggested?.type })),
    ...(pickNote ? { pickNote } : {}),
    week: {
      planWeek: review.week.planWeek,
      deload: week?.kind === 'deload',
      calibration: week?.calibration === true,
      /** What a light week does, as the plan's rule (or the old default) says it. */
      lightWeek: { text: lightFrom.text, dose: lightDoseText(lw), source: lightFrom.kind },
    },
    warmup,
    items,
    finisher,
    flags,
    plannedLoad: {
      minutes,
      rpe: effort.value,
      load: minutes === null ? null : minutes * effort.value,
      reason: effort.reason,
      /** A short day as planned (not Express): its estimate from its items, its time check against the profile's short days, and its typical logged length beside them. */
      ...(time && mode !== 'express' ? { estimate: time.estimate, time: time.check, typical: typicalMinutes(data.sessions, type.template, date) } : {}),
    },
  };
}

