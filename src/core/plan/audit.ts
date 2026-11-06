// "How your data shaped this plan": every input the profile holds, the
// decision it drove, or why it was left out. "The default" is never a
// reason: an input with no effect says what it is used for instead. `used`
// is a claim the tests hold the generator to: change that input (and the
// inputs listed in `with`, which set the same decision) and the plan
// changes.

import { CATALOGUE_BY_ID } from '../data/exercises.ts';
import { explain, type Result } from '../reason.ts';
import { screeningDue } from '../safety.ts';
import type { Program } from '../schema.ts';
import type { Comparison } from './compare.ts';
import { cardioModes } from './conditioning.ts';
import type { PlanContext } from './context.ts';
import type { Proposal } from './generate.ts';
import { rankCandidates } from './select.ts';
import type { WeekSize } from './size.ts';
import type { TemplateChoice } from './template.ts';

export interface InputUse {
  /** The profile path (goals.<id>, emphasis.<kind>, selfCheck.<test>, ledger.<id>, ...). */
  input: string;
  value: string;
  /** True: it changed the plan. False: noted, with what it is for. */
  used: boolean;
  effect: string;
  /** Other inputs that set the same decision: either alone is enough. */
  with?: string[];
}

export interface AuditPlan {
  program: Program;
  proposal: Proposal;
  tpl: TemplateChoice;
  size: WeekSize;
  comparison: Comparison;
}

const list = (xs: readonly string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** Every exercise id in the program's weeks. */
function usedIds(program: Program): Set<string> {
  const out = new Set<string>();
  for (const ph of program.macrocycle.phases) for (const m of ph.mesocycles) for (const w of m.weeks) for (const t of w.sessions) for (const s of t.slots) out.add(s.exercise);
  return out;
}

/** Whether `id` would rank first in one of the template's slots if the given context change were undone. */
function wouldLead(ctx: PlanContext, tpl: TemplateChoice, id: string): string | null {
  for (const b of tpl.blueprints) {
    for (const s of b.slots) {
      const r = rankCandidates(ctx, s, ctx.start, new Set());
      if (r && r.ranked[0]?.id === id) return s.pattern;
    }
  }
  return null;
}

export function personalization(ctx: PlanContext, plan: AuditPlan): Result<InputUse[]> {
  const p = ctx.profile;
  const out: InputUse[] = [];
  const add = (u: InputUse) => out.push(u);
  const ids = usedIds(plan.program);
  const name = (id: string) => ctx.byId.get(id)?.name ?? id;
  const pm = plan.proposal.preMortem;
  const inPreMortem = (path: string) => pm.some((x) => x.from.split(' ').includes(path));
  const tpl = plan.tpl;
  const picked = plan.comparison.rows[plan.comparison.picked]!;

  // Units and basics.
  add({ input: 'units.load', value: p.units.load, used: true, effect: `Loads and steps in ${p.units.load} (${p.units.load === 'kg' ? '2.5 kg dumbbell steps, 5 kg barbell lower-body steps' : '5 lb dumbbell steps, 10 lb barbell lower-body steps'}).` });
  add({ input: 'units.body', value: p.units.body, used: false, effect: `Body weight in ${p.units.body}: for the weight trend and the eating plan, not the training plan.` });
  if (p.basics?.birthYear !== undefined) {
    add(ctx.senior
      ? { input: 'basics.birthYear', value: `${p.basics.birthYear} (age ${ctx.age})`, used: true, effect: `Age ${ctx.age}: RIR 4 or more in phase 1, balance work every session, no intervals in phase 1, fast lifting from week 9.` }
      : { input: 'basics.birthYear', value: `${p.basics.birthYear} (age ${ctx.age})`, used: false, effect: `Age ${ctx.age}: under 65, so no older-adult changes; the self-check and screening set the starting points.` });
  }
  if (p.basics?.heightCm !== undefined) add({ input: 'basics.heightCm', value: `${p.basics.heightCm} cm`, used: false, effect: 'For the energy estimate in the eating plan, not the training plan.' });
  if (p.basics?.sex !== undefined) add({ input: 'basics.sex', value: p.basics.sex, used: false, effect: 'For the energy estimate and strength references, not exercise choice.' });

  // Goals, in their order.
  ctx.goals.forEach((g, i) => {
    const t = plan.proposal.targets.find((x) => x.goal === g.id);
    const phases = plan.proposal.phases.map((x) => x.name).join(', ');
    const parts = [
      i === 0 && `goal 1 sets the ${ctx.modifier} modifier (${{ strength: '3-6 reps on the main lifts', muscle: '6-15 reps', health: 'full body, active minutes and steps', skill: 'a skill block each session', hybrid: '4-8 sets per muscle' }[ctx.modifier]}) and the phases (${phases})`,
      ctx.prioritySources.some((x) => x.value.source === 'goal' || x.value.source === 'posture') && ['recomposition', 'gain'].includes(g.kind) && ctx.goals.findIndex((x) => ['recomposition', 'gain'].includes(x.kind)) === i && `the priority muscles come from it (${list(ctx.priority)})`,
      g.kind === 'posture' && (ctx.pullPush?.why === 'finding' ? 'the posture emphasis: pull at least 1.8 times push (the body assessment saw it) and rear-delt work every session' : 'the posture emphasis: pull at least equal to push and rear-delt work every session (no forward-head, rounded-shoulders finding, so not 2 to 1)'),
      (g.kind === 'conditioning' || g.kind === 'health') && plan.proposal.conditioning[0]?.intervalsAllowed && 'one interval session a week',
      t && `the phase-1 target: ${t.measure}${t.baseline !== undefined ? ` from ${t.baseline}` : ''}, ${t.predicted[0]} to ${t.predicted[1]} ${t.unit} by ${t.by}`,
    ].filter((x): x is string => typeof x === 'string');
    add({ input: `goals.${g.id}`, value: `${g.kind}, "${g.label}", importance ${g.importance} (rank ${i + 1})`, used: true, effect: `${parts.join('; ')}.`.replace(/^./, (c) => c.toUpperCase()) });
    if (g.measure !== undefined) add({ input: `goals.${g.id}.measure`, value: g.measure, used: true, effect: `The phase-1 target is measured as the profile says: ${g.measure}.` });
    add(g.confidence < 7 && inPreMortem(`goals.${g.id}.confidence`)
      ? { input: `goals.${g.id}.confidence`, value: `${g.confidence}`, used: true, effect: 'Under 7: a pre-mortem risk, with the minimum week as the target until it is a 7.' }
      : { input: `goals.${g.id}.confidence`, value: `${g.confidence}`, used: false, effect: g.confidence < 7 ? 'Under 7, but the pre-mortem already holds three more specific risks; ask what would make it a 7.' : 'Confident (7 or more): no change to the ask.' });
  });

  // Availability.
  const a = p.availability;
  const extra = tpl.extraDays;
  add({ input: 'availability.daysPerWeek', value: `${a.daysPerWeek}`, used: true, effect: `${a.daysPerWeek} days: ${tpl.liftingDays} lifting${extra ? ` and ${extra} conditioning` : ''} (${picked.label}).` });
  add({ input: 'availability.minutesPerSession', value: `${a.minutesPerSession} min`, used: true, effect: `${a.minutesPerSession} min sessions: the ${tpl.band} band, ${tpl.minimumDose ? '4 exercises as supersets' : `${Math.max(...tpl.blueprints.map((b) => b.slots.length))} exercises at most`}; the longest session is about ${picked.longestSession} min.` });
  if (a.shortSessions) add({ input: 'availability.shortSessions', value: `${a.shortSessions.days} x ${a.shortSessions.minutes} min`, used: true, effect: `Lifting on the long days; the short days carry conditioning at ${plan.size.shortMinutes} min.` });
  if (a.fixedDays?.length) add({ input: 'availability.fixedDays', value: a.fixedDays.join(', '), used: true, effect: `Lifting on ${plan.proposal.week!.days.filter((d) => d.kind === 'lift').map((d) => d.weekday).join(', ')}.` });
  if (a.busy?.length) add(inPreMortem('availability.busy') ? { input: 'availability.busy', value: a.busy.map((b) => `${b.from} to ${b.to}`).join(', '), used: true, effect: 'A pre-mortem risk: the minimum week then, or the deload moved onto it.' } : { input: 'availability.busy', value: a.busy.map((b) => `${b.from} to ${b.to}`).join(', '), used: false, effect: 'Before the plan starts, or outside the top pre-mortem risks: the coach places it in the letters.' });
  if (a.note !== undefined) add({ input: 'availability.note', value: a.note, used: false, effect: 'Free text: the coach reads it; the engine uses the numbers.' });

  // Equipment, tracking, screening.
  add({ input: 'equipment', value: p.equipment.join(', ') || 'bodyweight only', used: true, effect: `${{ gym: 'A full gym', dumbbell: 'Dumbbells', machines: 'Machines and cables', calisthenics: 'Bodyweight with a bar or rings', bodyweight: 'Bodyweight only' }[ctx.equipmentMode]}: every exercise uses listed equipment${ctx.unknownEquipment.length ? `; not recognised, so not used: ${list(ctx.unknownEquipment)}` : ''}.` });
  add({ input: 'trackingLevel', value: p.trackingLevel, used: true, effect: `The pre-mortem's logging line: ${pm.find((x) => x.from === 'trackingLevel')?.countermeasure ?? ''}` });
  add({ input: 'screening.outcome', value: p.screening.outcome, used: true, effect: { go: 'Go: no extra limits; intervals, tests and the RIR calibration set are allowed.', 'go-ramped': 'Go, ramped: the first mesocycle at RIR 3 or more, no vigorous work or max tests yet.', conservative: 'Conservative: full body only, at most 3 lifting days, RIR 4 or more, no vigorous work.', blocked: 'Blocked: no plan.' }[p.screening.outcome] });
  add({ input: 'screening.date', value: p.screening.date, used: true, effect: `Re-screening on the calendar by ${String(screeningDue(p.screening.date, ctx.start).reason.inputs['due'])}.` });
  if (p.screening.limits?.length) add({ input: 'screening.limits', value: p.screening.limits.join('; '), used: false, effect: 'Free text: the coach applies them, and turns each into a Ledger constraint when it names movements.' });

  // The body assessment.
  for (const e of p.emphasis) {
    const key = `emphasis.${e.kind ?? e.area}`;
    const withSc = e.kind && ctx.selfCheckEmphasis.has(e.kind) ? ctx.selfCheck.effects.filter((x) => x.value.asEmphasis === e.kind).map((x) => `selfCheck.${x.value.input}`) : [];
    const postureGoal = ctx.goals.filter((g) => g.kind === 'posture').map((g) => `goals.${g.id}`);
    const base = { input: key, value: `${e.seen} (${e.confidence} confidence)` };
    switch (e.kind) {
      case 'forward-head-rounded-shoulders': {
        const v = plan.proposal.volume[0];
        add({ ...base, used: true, effect: `Pull at least 1.8 times push (${v ? `${v.pullPush.pull} pull to ${v.pullPush.push} push sets in week ${v.week}` : 'every week'}), rear-delt work in every session, chest and lat stretches in the warm-up.`, ...(postureGoal.length ? { with: postureGoal } : {}) });
        break;
      }
      case 'overhead-limited': {
        const presses = [...ids].filter((id) => ctx.byId.get(id)?.pattern === 'vertical-push').map(name);
        add({ ...base, used: true, effect: `No overhead pressing until the reach improves: ${presses.length ? list(presses) : 'incline pressing'} instead; upper-back extension and a lat stretch in the warm-up.`, ...(withSc.length ? { with: withSc } : {}) });
        break;
      }
      case 'squat-heels-lift':
        add({ ...base, used: true, effect: 'Heel-elevated goblet squats or box squats first, ankle mobility in the warm-up.', ...(withSc.length ? { with: withSc } : {}) });
        break;
      case 'knees-in':
        add({ ...base, used: true, effect: 'Tempo goblet squats and split squats ranked first, banded side walks in the warm-up.' });
        break;
      case 'low-back-arch':
        add({ ...base, used: true, effect: 'Dead bugs and hollow holds in the core slots, glute work in the hinge accessories, a hip-flexor stretch in the warm-up.' });
        break;
      case 'asymmetry':
        add({ ...base, used: true, effect: `One-sided work ranked first, the ${e.side ?? 'weaker'} side first.` });
        break;
      case 'lagging-area':
        add({ ...base, used: (e.muscles ?? []).some((m) => ctx.priority.includes(m)), effect: `Priority muscles: ${list((e.muscles ?? []).filter((m) => ctx.priority.includes(m)))} (10-16 sets a week).` });
        break;
      case 'waist-fat':
        add({ ...base, used: false, effect: 'No change to exercise choice; the tape measures it.' });
        break;
      default:
        add({ ...base, used: false, effect: 'No kind: the engine cannot act on it; the coach applies the emphasis by hand.' });
    }
  }

  // Priority muscles, training age, preferences.
  if (p.priorityMuscles?.length) add({ input: 'priorityMuscles', value: p.priorityMuscles.join(', '), used: true, effect: `Priority muscles fitted to 10-16 sets a week: ${list(ctx.priority)}.` });
  if (p.experience !== undefined) {
    const rules = [...new Set(plan.proposal.progression.map((x) => x.rule))];
    add({ input: 'experience', value: p.experience, used: true, effect: `${p.experience}: ${rules.length ? `${list(rules)} progression on the main lifts` : 'the progression rules'}; ${picked.factors.find((f) => f.factor === 'training-age')?.note ?? ''}` });
  }
  const likes = p.preferences?.likes ?? [];
  if (likes.length) {
    const placed = likes.filter((id) => ids.has(id));
    add(placed.length ? { input: 'preferences.likes', value: likes.join(', '), used: true, effect: `Ranked first in their slots: ${list(placed.map(name))} in the plan.` } : { input: 'preferences.likes', value: likes.join(', '), used: false, effect: 'Not in any slot this plan has, or ruled out by equipment, level or the Ledger.' });
  }
  const dislikes = p.preferences?.dislikes ?? [];
  if (dislikes.length) {
    const freed = { ...ctx, dislikes: new Set<string>() };
    const led = dislikes.map((id) => ({ id, pattern: wouldLead(freed, tpl, id) })).filter((x) => x.pattern);
    add(led.length ? { input: 'preferences.dislikes', value: dislikes.join(', '), used: true, effect: `Left out: ${list(led.map((x) => `${name(x.id)} (it would lead the ${x.pattern} slot)`))}.` } : { input: 'preferences.dislikes', value: dislikes.join(', '), used: false, effect: 'Left out, though none would have led a slot of this plan.' });
  }
  const cardio = p.preferences?.cardio ?? [];
  if (cardio.length) {
    const cond = plan.proposal.conditioning.flatMap((c) => c.sessions);
    const fin = plan.proposal.conditioning.map((c) => c.finisher).filter((x): x is string => x !== null);
    const usedModes = [...new Set([...cond.map((x) => x.exercise), ...fin])].filter((id) => cardio.includes(id));
    // The same plan without the preference: the equipment's default modes, and intervals only when a goal asks for them.
    const fb = cardioModes(ctx).fallback;
    const asDefault = cond.every((x) => x.exercise === (x.vigorous ? fb.intervals : fb.easy)) && fin.every((x) => x === fb.easy);
    const goalsWant = ctx.goalKinds.has('conditioning') || ctx.goalKinds.has('health');
    const intervalsFromPrefs = !goalsWant && cardio.some((x) => x.includes('interval')) && plan.proposal.conditioning.some((c) => c.intervalsAllowed);
    const value = cardio.join(', ');
    if (!usedModes.length) add({ input: 'preferences.cardio', value, used: false, effect: 'No conditioning day or finisher this week, or no chosen mode fits the equipment.' });
    else if (asDefault && !intervalsFromPrefs) add({ input: 'preferences.cardio', value, used: false, effect: `The chosen modes are what the equipment gives anyway (${list(usedModes.map(name))}).` });
    else add({ input: 'preferences.cardio', value, used: true, effect: `The conditioning rotates the chosen modes: ${list(usedModes.map(name))}${intervalsFromPrefs ? '; intervals because they are a chosen mode' : ''}.` });
  }
  const splits = p.preferences?.splits;
  if (splits && ((splits.likes?.length ?? 0) > 0 || (splits.dislikes?.length ?? 0) > 0)) {
    const without = plan.comparison.pickWithout['preferences'];
    const value = [splits.likes?.length && `likes ${splits.likes.join(', ')}`, splits.dislikes?.length && `dislikes ${splits.dislikes.join(', ')}`].filter(Boolean).join('; ');
    add(without !== picked.id ? { input: 'preferences.splits', value, used: true, effect: `Scored in the comparison: it decided the pick (${picked.label}; without it, ${plan.comparison.rows.find((r) => r.id === without)?.label}).` } : { input: 'preferences.splits', value, used: false, effect: `Scored in the comparison; the pick (${picked.label}) is the same without it.` });
  }
  const loggedDays = (plan.proposal.week?.days ?? []).filter((d) => d.source === 'log').map((d) => d.weekday);
  if (p.useHistory !== undefined) add(ctx.history ? { input: 'useHistory', value: 'yes', used: true, effect: `The week sized from the logged history (${plan.size.confirmed?.toFixed(1)} confirmed sessions a week)${loggedDays.length ? `; ${loggedDays.join(', ')} from your logged weeks` : ''}.` } : { input: 'useHistory', value: p.useHistory ? 'yes, but no history given' : 'no', used: false, effect: p.useHistory ? 'Opted in, but the plan ran without the log (pass --history --vault).' : 'A clean start: the stated availability sizes the week and the calibration week finds the loads.' });
  if (p.rirCalibration?.length) add({ input: 'rirCalibration', value: `${p.rirCalibration.length} set(s)`, used: false, effect: 'The RIR bias is applied by review and the check-in letters, not the plan\'s targets.' });
  if (p.targets) add({ input: 'targets', value: 'week-24 targets', used: false, effect: 'Progress measures the plan against them; the plan\'s own phase targets are predictions.' });
  if (p.work) add({ input: 'work', value: p.work.desk ? `desk work, ${p.work.sittingHours ?? '?'} h` : 'no desk work', used: true, effect: plan.program.deskBreaks ? `Desk breaks every ${plan.program.deskBreaks.every} min, ${plan.program.deskBreaks.from} to ${plan.program.deskBreaks.to}.` : 'No desk work: no desk breaks.' });
  if (p.badWeek) {
    const fromPm = inPreMortem('badWeek');
    const skip = plan.comparison.pickWithout['skip-risk'] !== picked.id;
    const parts = [skip && `it decided the split (without the skip risk: ${plan.comparison.rows.find((r) => r.id === plan.comparison.pickWithout['skip-risk'])?.label})`, fromPm && 'the pre-mortem\'s first risks and their countermeasures', !fromPm && !skip && 'scored for skip risk; no countermeasure beyond the minimum week'].filter((x): x is string => typeof x === 'string');
    const effect = `${parts.join('; ')}.`;
    add({ input: 'badWeek', value: `${p.badWeek.usually.join(', ')}${p.badWeek.note ? `: "${p.badWeek.note}"` : ''}`, used: fromPm || skip, effect: effect.charAt(0).toUpperCase() + effect.slice(1) });
  }

  // The self-check.
  const sc = p.selfCheck;
  if (sc) {
    add({ input: 'selfCheck.date', value: sc.date, used: false, effect: 'When the tests were done; the phase review repeats them.' });
    const ladderBy = new Map(plan.proposal.ladders.map((l) => [l.input, l]));
    const effects = ctx.selfCheck.effects.map((e) => e.value);
    const tests: (keyof typeof sc)[] = ['sitToStand', 'pushUps', 'deadHangS', 'pullUps', 'coreHold', 'hingeFlatBack', 'overheadReach', 'wallGapCm', 'balanceS'];
    for (const t of tests) {
      if (sc[t] === undefined) continue;
      const own = effects.filter((e) => e.input === t);
      const lad = ladderBy.get(t);
      const changes = own.filter((e) => e.prefer || e.exclude?.length || e.unlock?.length || e.warmUp?.length || e.asEmphasis || e.weakSide);
      const value = own[0]?.value ?? JSON.stringify(sc[t]);
      const notes = [...own.map((e) => e.note), lad && lad.level !== null && `${lad.name} ladder from level ${lad.level} (${lad.levelName})${lad.used ? ` in ${list(lad.sessions)}` : ''}.`].filter((x): x is string => typeof x === 'string');
      // The sit-to-stand also picks the single-leg ladder's level when balance holds 30 s.
      const legs = plan.proposal.ladders.find((l) => l.id === 'legs');
      const legsUse = t === 'sitToStand' && legs?.level !== null && legs?.level !== 1 && legs !== undefined;
      if (legsUse) notes.push(`With balance at 30 s, it sets the single-leg ladder's level (${legs!.level}).`);
      const wallUse = t === 'wallGapCm' && plan.proposal.targets.some((x) => x.baseline !== undefined);
      const withSc = own.flatMap((e) => (e.asEmphasis ? p.emphasis.filter((x) => x.kind === e.asEmphasis).map((x) => `emphasis.${x.kind}`) : []));
      const used = changes.length > 0 || (lad !== undefined && lad.level !== null) || legsUse || wallUse;
      const effect = notes.length ? notes.join(' ') : t === 'deadHangS' ? 'The pull-ups set the pull-up level; the hang confirms it.' : 'Recorded; no change to exercise choice.';
      add({ input: `selfCheck.${t}`, value, used: t === 'wallGapCm' ? wallUse : used, effect: t === 'wallGapCm' && !wallUse ? `${sc.wallGapCm} cm: no posture goal, so a baseline for the phase review only.` : effect, ...(withSc.length ? { with: withSc } : {}) });
    }
  }

  // The Ledger.
  for (const c of ctx.ledger) {
    if (c.until !== undefined && c.until < ctx.start) {
      add({ input: `ledger.${c.id}`, value: c.note ?? c.id, used: false, effect: `Ended ${c.until}, before the plan starts.` });
      continue;
    }
    const freed = { ...ctx, ledger: ctx.ledger.filter((x) => x !== c) };
    const blocked = [...new Set(tpl.blueprints.flatMap((b) => b.slots.map((s) => rankCandidates(freed, s, ctx.start, new Set())?.ranked[0]?.id).filter((id): id is string => id !== undefined)))].filter((id) => {
      const e = CATALOGUE_BY_ID.get(id);
      return e && !rankCandidates(ctx, { pattern: e.pattern, role: 'accessory' }, ctx.start, new Set())?.ranked.some((x) => x.id === id);
    });
    add(blocked.length ? { input: `ledger.${c.id}`, value: c.note ?? c.id, used: true, effect: `Keeps ${list(blocked.map(name))} out${c.until ? ` until ${c.until}` : ''}; the nearest allowed movement takes each slot.` } : { input: `ledger.${c.id}`, value: c.note ?? c.id, used: false, effect: 'Screened every week; none of its movements would have been picked here.' });
  }
  return explain(out, 'plan.personalization', { inputs: out.length, used: out.filter((x) => x.used).length }, {
    note: `${out.filter((x) => x.used).length} of ${out.length} inputs shaped the plan; the rest say what they are for.`,
  });
}
