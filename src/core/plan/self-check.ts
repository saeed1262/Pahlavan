// The movement self-check as plan inputs (intake.md, "The movement
// self-check"): each ladder's starting level, and what each test result does
// to exercise choice. Every result returns a reason naming the test and its
// value; a test left out says so. The thresholds are heuristics (H): the
// calibration week (week 1) confirms each level, and the phase review
// repeats the tests. A result that is a finding (a struggled sit-to-stand,
// a rounded hinge, an overhead reach that is not clean, balance under 30 s)
// acts as the user answered it (findings.ts).

import { CATALOGUE_BY_ID, type Pattern } from '../data/exercises.ts';
import { LADDER_BY_ID, type Ladder } from '../data/ladders.ts';
import { emphasisConfirmation, emphasisQuestion, selfCheckConfirmation, type Confirmation, type FindingToConfirm, type SelfCheckFinding } from '../findings.ts';
import { explain, type Result } from '../reason.ts';
import type { Emphasis, Profile, SelfCheck } from '../schema.ts';

export const SELF_CHECK = {
  /** A dead hang this long or longer: the user can hang (pull-up regressions are on). */
  hangS: 20,
  /** A hang this long with no pull-up yet: negatives. */
  negativesHangS: 30,
  /** Strict pull-ups for the pull-up level (3 x 3-8); this many or more: weighted. */
  pullUpLevel: 3,
  weightedPullUps: 8,
  /** Push-ups: 1-10 floor, 11-24 tempo, 25 or more deficit. */
  pushUp: { floor: 1, tempo: 11, deficit: 25 },
  /** Plank seconds for the tuck hollow (30) and the hollow hold (60); hollow-hold seconds for arms by sides (20) and overhead (40). */
  plank: { tuck: 30, hollow: 60 },
  hollow: { bySides: 20, overhead: 40 },
  /** Single-leg balance a side: under this, split squats before single-leg RDLs and pistols. */
  balanceS: 30,
  /** Sides this many seconds apart: the shorter one is the weaker side. */
  sideGapS: 10,
} as const;

/** The weaker side by single-leg balance, when the sides are 10 s or more apart. */
export function weakSideOf(b: { left: number; right: number } | undefined): 'left' | 'right' | null {
  if (!b || Math.abs(b.left - b.right) < SELF_CHECK.sideGapS) return null;
  return b.left < b.right ? 'left' : 'right';
}

export type LadderId = Ladder['id'];

export interface LadderStart {
  id: LadderId;
  name: string;
  /** 1-based, or null when the test was not done. */
  level: number | null;
  levelName: string | null;
  /** The catalogue movement at that level. */
  exercise: string | null;
  /** The self-check field it came from. */
  input: string;
}

/** A self-check result's effect on exercise choice. */
export interface SelfCheckEffect {
  /** The self-check field, as profile.selfCheck.<field>. */
  input: string;
  value: string;
  /** Exercise ids ranked first in slots of these patterns. */
  prefer?: { patterns: Pattern[]; ids: string[] };
  /** Exercise ids left out. */
  exclude?: string[];
  /** Exercise ids allowed although their catalogue level is above the training age. */
  unlock?: string[];
  /** Warm-up lines added. */
  warmUp?: string[];
  /** Works like the body-assessment row of this kind. */
  asEmphasis?: Emphasis['kind'];
  /** The weaker side, for one-sided work. */
  weakSide?: 'left' | 'right';
  /** An extra accessory slot of this pattern, beside each session's main lift of that pattern (a pull-up regression beside the pulldown). */
  secondary?: { pattern: Pattern; id: string };
  /** Movements at a lower level of a ladder than the user's: a slot that would pick one takes `level` (the ladder's movement at the user's level) in the same pattern, else the next candidate. */
  belowLevel?: { ids: string[]; level: string };
  /** For a finding, the user's answer (selfCheck.confirmed): confirmed, declined (its warm-up lines only), or not asked yet. */
  confirmation?: Confirmation;
  note: string;
}

export interface SelfCheckPlan {
  date: string | null;
  ladders: Result<LadderStart>[];
  effects: Result<SelfCheckEffect>[];
}

const level = (id: LadderId, n: number | null, input: string): LadderStart => {
  const l = LADDER_BY_ID.get(id)!;
  const lv = n === null ? null : l.levels[n - 1]!;
  return { id, name: l.name, level: n, levelName: lv?.name ?? null, exercise: lv?.exercise ?? null, input };
};

function pullUpStart(s: SelfCheck): Result<LadderStart> {
  const { pullUps, deadHangS } = s;
  const inputs = { pullUps: pullUps ?? null, deadHangS: deadHangS ?? null };
  const say = (n: number | null, input: string, note: string) => explain(level('pullup', n, input), 'plan.self-check.pullup', inputs, { threshold: { hangS: SELF_CHECK.hangS, negativesHangS: SELF_CHECK.negativesHangS, pullUpLevel: SELF_CHECK.pullUpLevel, weightedPullUps: SELF_CHECK.weightedPullUps }, note });
  if (pullUps !== undefined && pullUps >= SELF_CHECK.weightedPullUps) return say(7, 'pullUps', `${pullUps} strict pull-ups: past the pull-up level's top (3 x 8), so the pull-up ladder starts at level 7 (weighted pull-ups).`);
  if (pullUps !== undefined && pullUps >= SELF_CHECK.pullUpLevel) return say(6, 'pullUps', `${pullUps} strict pull-ups: the pull-up ladder starts at level 6 (pull-ups, sets of 3-8).`);
  if (pullUps !== undefined && pullUps >= 1) return say(5, 'pullUps', `${pullUps} strict pull-up${pullUps > 1 ? 's' : ''}: not yet sets of 3, so the pull-up ladder starts at level 5 (band-assisted pull-ups).`);
  if (deadHangS === undefined) return say(null, 'pullUps', pullUps === 0 ? 'No pull-up yet and no hang time: the calibration week finds the pull-up level.' : 'Hang and pull not tested: the calibration week finds the pull-up level.');
  if (deadHangS >= SELF_CHECK.negativesHangS) return say(4, 'deadHangS', `No strict pull-up yet but a ${deadHangS} s hang: the pull-up ladder starts at level 4 (negative pull-ups).`);
  if (deadHangS >= SELF_CHECK.hangS) return say(2, 'deadHangS', `No strict pull-up yet and a ${deadHangS} s hang: the pull-up ladder starts at level 2 (scapular pull-ups).`);
  return say(1, 'deadHangS', `A ${deadHangS} s hang, under ${SELF_CHECK.hangS} s: the pull-up ladder starts at level 1 (dead hangs) and rows and pulldowns carry the pulling.`);
}

function pushUpStart(s: SelfCheck): Result<LadderStart> {
  const n = s.pushUps;
  const t = SELF_CHECK.pushUp;
  const lv = n === undefined ? null : n < t.floor ? 1 : n < t.tempo ? 2 : n < t.deficit ? 3 : 4;
  const names = ['', 'incline push-ups', 'floor push-ups', 'tempo push-ups, 3 s down', 'deficit push-ups'];
  return explain(level('pushup', lv, 'pushUps'), 'plan.self-check.pushup', { pushUps: n ?? null }, {
    threshold: t,
    note: n === undefined ? 'Push-ups not tested: the calibration week finds the push-up level.' : `${n} push-up${n === 1 ? '' : 's'}: the push-up ladder starts at level ${lv} (${names[lv!]}).`,
  });
}

function coreStart(s: SelfCheck): Result<LadderStart> {
  const c = s.coreHold;
  let lv: number | null = null;
  if (c?.kind === 'plank') lv = c.seconds < SELF_CHECK.plank.tuck ? 1 : c.seconds < SELF_CHECK.plank.hollow ? 2 : 3;
  if (c?.kind === 'hollow') lv = c.seconds < SELF_CHECK.hollow.bySides ? 2 : c.seconds < SELF_CHECK.hollow.overhead ? 3 : 4;
  const names = ['', 'dead bugs', 'tuck hollow holds', 'hollow holds, arms by the sides', 'hollow holds, arms overhead'];
  return explain(level('hollow', lv, 'coreHold'), 'plan.self-check.core', { coreHold: c ?? null }, {
    threshold: { plank: SELF_CHECK.plank, hollow: SELF_CHECK.hollow },
    note: !c ? 'Plank or hollow hold not tested: the calibration week finds the core level.' : `A ${c.seconds} s ${c.kind === 'plank' ? 'plank' : 'hollow hold'}: the core ladder starts at level ${lv} (${names[lv!]}).`,
  });
}

function legsStart(s: SelfCheck): Result<LadderStart> {
  const b = s.balanceS;
  const st = s.sitToStand;
  let lv: number | null = null;
  let note = 'Balance not tested: the calibration week finds the single-leg level.';
  if (b) {
    const low = Math.min(b.left, b.right);
    if (low < SELF_CHECK.balanceS) {
      lv = 1;
      note = `Balance ${b.left} s left and ${b.right} s right, under ${SELF_CHECK.balanceS} s on one side: the single-leg ladder starts at level 1 (split squats, both feet down).`;
    } else if (st?.easy) {
      lv = 3;
      note = `Balance ${SELF_CHECK.balanceS} s each side and an easy sit-to-stand: the single-leg ladder starts at level 3 (box pistols to a high box).`;
    } else {
      lv = 2;
      note = `Balance ${SELF_CHECK.balanceS} s each side${st ? ' but a hard sit-to-stand' : ''}: the single-leg ladder starts at level 2 (rear-foot-elevated split squats).`;
    }
  }
  return explain(level('legs', lv, 'balanceS'), 'plan.self-check.legs', { balanceS: b ?? null, sitToStand: st ?? null }, { threshold: { balanceS: SELF_CHECK.balanceS }, note });
}

/** Pressing without the arms fully overhead, ranked first in the vertical-push slots when overhead range is limited. */
export const OVERHEAD_FREE = ['landmine-press', 'incline-db-press', 'incline-push-up'];
/**
 * Pure overhead pressing and the handstand work, left out when a limited
 * overhead range is confirmed (or never asked in a profile from before the
 * question). The catalogue's later presses and handstand steps come after the
 * starter ones.
 */
export const OVERHEAD_PRESSES = ['overhead-press', 'db-shoulder-press', 'machine-shoulder-press', 'pike-push-up', 'wall-handstand', 'standing-db-press', 'kb-press', 'band-overhead-press', 'elevated-pike-push-up', 'wall-handstand-push-up', 'box-pike-hold', 'wall-walk', 'handstand-kick-up', 'freestanding-handstand'];
const patternOf = (id: string) => CATALOGUE_BY_ID.get(id)?.pattern;
/** The loaded hinges a rounded back waits on: the Romanian deadlifts and deadlifts, then the catalogue's later ones (the kettlebell's swings and clean among them). The unloaded hinge drill stays, to learn the hinge. */
const RDL_FAMILY = ['rdl', 'db-rdl', 'single-leg-rdl', 'deadlift', 'kickstand-rdl', 'kb-deadlift', 'trap-bar-deadlift', 'kb-swing', 'single-arm-kb-swing', 'kb-clean'];
/** Single-leg work that needs real balance, after split squats when balance is short; the catalogue's shrimp squat and skater bound after the starter ones. */
const SINGLE_LEG_HARD = ['single-leg-rdl', 'box-pistol', 'pistol-squat', 'bulgarian-split-squat', 'shrimp-squat', 'skater-bound'];

/** What the equipment allows, for the ladders: a pull-up bar, loaded pressing, loaded single-leg work. */
export interface LadderKit {
  bar: boolean;
  loadedPress: boolean;
  loadedSingleLeg: boolean;
  /** A lat pulldown (machine or cable): low pull-up levels go beside it, not in its place. */
  pulldown: boolean;
}

/** A self-check result that is a finding, with the question to ask before the plan acts on it. */
export interface SelfCheckFindingInfo {
  test: SelfCheckFinding;
  question: string;
}

/** The results that are findings (the ones that change exercise choice beyond a ladder level), each with its question: yes means the finding holds (confirmed: true). */
export function selfCheckFindings(s: SelfCheck | undefined): SelfCheckFindingInfo[] {
  if (!s) return [];
  const out: SelfCheckFindingInfo[] = [];
  const st = s.sitToStand;
  if (st && !st.easy) out.push({ test: 'sitToStand', question: 'Your sit-to-stand was a struggle. Is a loaded squat below knee height painful or unsteady for you?' });
  else if (st && !st.heelsDown) out.push({ test: 'sitToStand', question: 'Your heels lifted in the sit-to-stand. Do they come up when you squat deep?' });
  if (s.hingeFlatBack === false) out.push({ test: 'hingeFlatBack', question: 'Your back rounded before your hands reached your knees in the hinge test. Does your back round or ache in Romanian deadlifts?' });
  const oh = s.overheadReach;
  if (oh && !oh.clean) {
    const seen = [oh.ribFlare && 'rib flare', oh.lowBackArch && 'your lower back arching'].filter(Boolean).join(' and ');
    out.push({ test: 'overheadReach', question: `${seen ? `Your overhead reach showed ${seen}` : 'Your overhead reach was not clean'}. Does pressing overhead hurt, or make your lower back arch?` });
  }
  const b = s.balanceS;
  if (b && Math.min(b.left, b.right) < SELF_CHECK.balanceS) out.push({ test: 'balanceS', question: `Your single-leg balance was under ${SELF_CHECK.balanceS} s on one side (${b.left} s left, ${b.right} s right). Do one-leg exercises, such as split squats or single-leg Romanian deadlifts, feel unsteady?` });
  return out;
}

/** Every finding the profile has no answer for (self-check results and the body-assessment rows the engine acts on), with its question. */
export function findingsToConfirm(profile: Pick<Profile, 'emphasis' | 'selfCheck'>): FindingToConfirm[] {
  const out: FindingToConfirm[] = [];
  for (const f of selfCheckFindings(profile.selfCheck)) {
    if (selfCheckConfirmation(profile.selfCheck, f.test) === 'unconfirmed') out.push({ input: `selfCheck.${f.test}`, answer: `selfCheck.confirmed.${f.test}`, question: f.question });
  }
  profile.emphasis.forEach((e, i) => {
    const question = emphasisQuestion(e);
    if (question && emphasisConfirmation(e) === 'unconfirmed') out.push({ input: `emphasis.${e.kind}`, answer: `emphasis[${i}].confirmed`, question });
  });
  return out;
}

/** Each finding's test, in words. */
export const FINDING_LABEL: Record<SelfCheckFinding, string> = { sitToStand: 'Sit-to-stand', hingeFlatBack: 'The hinge', overheadReach: 'The overhead reach', balanceS: 'Balance' };

/**
 * What each test result does to the plan, with its reason. `asks`: the
 * profile records an answer to some finding (findings.ts), so a finding with
 * no answer is a preference and warm-ups only.
 */
export function selfCheckPlan(s: SelfCheck | undefined, kit: LadderKit, asks = s?.confirmed !== undefined): SelfCheckPlan {
  if (!s) return { date: null, ladders: [], effects: [] };
  const ladders = [pullUpStart(s), pushUpStart(s), coreStart(s), legsStart(s)];
  const effects: Result<SelfCheckEffect>[] = [];
  const add = (e: SelfCheckEffect, inputs: Record<string, unknown>) => effects.push(explain(e, `plan.self-check.${e.input}`, inputs, { note: e.note }));
  // A finding acts as the user answered it: confirmed (or never asked, in a profile from before the
  // question) in full; declined, its warm-up lines only; not asked yet in a profile that asks, the
  // `soft` note's preferences and warm-ups, with nothing ruled out.
  const finding = (e: SelfCheckEffect, soft: string, inputs: Record<string, unknown>) => {
    const test = e.input as SelfCheckFinding;
    const c = selfCheckConfirmation(s, test);
    const path = `selfCheck.confirmed.${test}`;
    if (c === 'declined') {
      add({ input: e.input, value: e.value, ...(e.warmUp ? { warmUp: e.warmUp } : {}), confirmation: c, note: `${FINDING_LABEL[test]} (${e.value}): you said it does not hold (${path}: false), so it changes no exercise${e.warmUp ? '; only its warm-up lines stay' : ''}.` }, { ...inputs, confirmed: false });
    } else if (c === 'unconfirmed' && asks) {
      const preference: SelfCheckEffect = { ...e, confirmation: c, note: `${soft} Not confirmed with you yet (${path}).` };
      delete preference.exclude;
      add(preference, { ...inputs, confirmed: null });
    } else add({ ...e, confirmation: c }, c === 'confirmed' ? { ...inputs, confirmed: true } : inputs);
  };

  const st = s.sitToStand;
  if (st) {
    const value = `${st.easy ? 'easy' : 'a struggle'}, heels ${st.heelsDown ? 'down' : 'lifting'}`;
    if (!st.easy) finding({ input: 'sitToStand', value, prefer: { patterns: ['squat'], ids: ['box-squat', 'goblet-squat'] }, exclude: ['back-squat'], note: 'Sit-to-stand was a struggle: box squats and light goblet squats first; the barbell squat waits for the phase review\'s re-test.' }, 'Sit-to-stand was a struggle: box squats and light goblet squats ranked first; the barbell squat is not ruled out.', { sitToStand: st });
    else if (!st.heelsDown) finding({ input: 'sitToStand', value, prefer: { patterns: ['squat'], ids: ['heel-elevated-goblet-squat', 'box-squat'] }, warmUp: ['ankle-mobility'], asEmphasis: 'squat-heels-lift', note: 'Sit-to-stand easy but the heels lift: heel-elevated goblet squats and ankle mobility in the warm-up.' }, 'Sit-to-stand easy but the heels lift: heel-elevated goblet squats ranked first and ankle mobility in the warm-up; nothing is ruled out.', { sitToStand: st });
    else add({ input: 'sitToStand', value, note: 'Sit-to-stand easy with the heels down: loaded squats as normal.' }, { sitToStand: st });
  }
  if (s.hingeFlatBack !== undefined) {
    if (s.hingeFlatBack) add({ input: 'hingeFlatBack', value: 'flat back to the knees', note: 'The hinge keeps a flat back to the knees: the Romanian deadlift pattern is fine.' }, { hingeFlatBack: true });
    else finding({ input: 'hingeFlatBack', value: 'the back rounds before the knees', prefer: { patterns: ['hinge'], ids: ['hip-thrust', 'back-extension', 'glute-bridge'] }, exclude: RDL_FAMILY, note: 'The back rounds before the hands reach the knees: hip thrusts, back extensions and glute bridges first; Romanian deadlifts wait for the re-test.' }, 'The back rounds before the hands reach the knees: hip thrusts, back extensions and glute bridges ranked first; Romanian deadlifts are not ruled out.', { hingeFlatBack: false });
  }
  const oh = s.overheadReach;
  if (oh) {
    const value = oh.clean ? 'clean' : [oh.ribFlare && 'ribs flaring', oh.lowBackArch && 'lower back arching'].filter(Boolean).join(' and ') || 'not clean';
    if (oh.clean) add({ input: 'overheadReach', value, note: 'A clean overhead reach: overhead pressing is fine.' }, { overheadReach: oh });
    else finding({ input: 'overheadReach', value, prefer: { patterns: ['vertical-push'], ids: OVERHEAD_FREE }, exclude: OVERHEAD_PRESSES, asEmphasis: 'overhead-limited', warmUp: ['thoracic-extension', 'lat-stretch'], note: `Overhead reach with the ${value}: landmine or incline pressing instead of overhead pressing, upper-back extension and a lat stretch in the warm-up; the overhead reach is re-tested at the phase review.` }, `Overhead reach with the ${value}: landmine or incline pressing ranked first, upper-back extension and a lat stretch in the warm-up; overhead pressing is not ruled out.`, { overheadReach: oh });
  }
  const b = s.balanceS;
  if (b) {
    const low = Math.min(b.left, b.right);
    const value = `${b.left} s left, ${b.right} s right`;
    if (low < SELF_CHECK.balanceS) finding({ input: 'balanceS', value, prefer: { patterns: ['lunge'], ids: ['split-squat', 'db-split-squat'] }, exclude: SINGLE_LEG_HARD, warmUp: ['single-leg-stance'], note: `Balance under ${SELF_CHECK.balanceS} s on one side: a balance hold in the warm-up, and split squats (both feet down) before single-leg Romanian deadlifts, rear-foot-elevated split squats and pistols.` }, `Balance under ${SELF_CHECK.balanceS} s on one side: a balance hold in the warm-up and split squats (both feet down) ranked first; single-leg Romanian deadlifts, rear-foot-elevated split squats and pistols are not ruled out.`, { balanceS: b });
    else add({ input: 'balanceS', value, unlock: st?.easy ? ['bulgarian-split-squat', 'single-leg-rdl', 'box-pistol'] : ['bulgarian-split-squat'], prefer: { patterns: ['lunge'], ids: ['bulgarian-split-squat', 'reverse-lunge', 'step-up'] }, note: `Balance ${SELF_CHECK.balanceS} s each side: single-leg work (rear-foot-elevated split squats${st?.easy ? ', single-leg Romanian deadlifts and box pistols' : ''}) is in from week 1.` }, { balanceS: b });
    // The weaker side comes from the same balance result: a declined balance finding drops it too.
    const weak = weakSideOf(b);
    const declined = low < SELF_CHECK.balanceS && selfCheckConfirmation(s, 'balanceS') === 'declined';
    if (weak && !declined) add({ input: 'balanceS', value, weakSide: weak, note: `Balance ${b.left} s left and ${b.right} s right: the ${weak} side is weaker, so one-sided work starts with it and matches its reps.` }, { balanceS: b, gapS: SELF_CHECK.sideGapS });
  }
  const pull = ladders[0]!.value;
  if (pull.level !== null) {
    const v = `${s.pullUps ?? 'not tested'} strict pull-ups, ${s.deadHangS ?? 'not tested'} s hang`;
    if (!kit.bar) add({ input: pull.input, value: v, note: `Pull-up ladder level ${pull.level}, but no pull-up bar is listed: rows and pulldowns carry the pulling; the level is kept for when a bar is there.` }, { level: pull.level, bar: false });
    else if (pull.level >= 6) add({ input: pull.input, value: v, prefer: { patterns: ['vertical-pull'], ids: ['pull-up'] }, unlock: ['pull-up'], note: `Pull-ups (the ladder's level ${pull.level}) as the main vertical pull.` }, { level: pull.level });
    else if (pull.level >= 2 && kit.pulldown) add({ input: pull.input, value: v, secondary: { pattern: 'vertical-pull', id: pull.exercise! }, note: `${pull.levelName} (the ladder's level ${pull.level}) as a second pull beside the lat pulldown, until strict pull-ups come.` }, { level: pull.level, pulldown: true });
    else if (pull.level >= 2) add({ input: pull.input, value: v, prefer: { patterns: ['vertical-pull'], ids: [pull.exercise!] }, note: `${pull.levelName} (the ladder's level ${pull.level}) as the vertical pull: no pulldown with this equipment.` }, { level: pull.level, pulldown: false });
    else add({ input: pull.input, value: v, warmUp: ['dead-hang'], note: 'A short hang: dead hangs in the warm-up (the ladder\'s level 1); rows and pulldowns carry the pulling until the hang reaches 20 s.' }, { level: pull.level });
  }
  // Movements above a tested level, in the level's own pattern, wait (0 push-ups: no floor push-ups yet).
  for (const r of ladders) {
    const st = r.value;
    if (st.level === null) continue;
    const l = LADDER_BY_ID.get(st.id)!;
    const below = new Set(l.levels.slice(0, st.level).map((x) => x.exercise));
    const above = [...new Set(l.levels.slice(st.level).map((x) => x.exercise))].filter((id) => !below.has(id) && patternOf(id) === patternOf(st.exercise!));
    if (above.length) add({ input: st.input, value: `${st.name} ladder level ${st.level}`, exclude: above, note: `Above the tested ${st.name.toLowerCase()} level (${st.level}, ${st.levelName}): ${above.join(', ')} wait for the ladder.` }, { ladder: st.id, level: st.level });
  }
  // Movements below a tested level never take a slot: at the user's level they are not near failure
  // (volume.ts's effort rule, by the movement's highest level on the ladder). A slot that would pick one
  // takes the ladder's movement at the level in its place (select.ts), or a loaded movement. Without a
  // pull-up bar the pull-up ladder cannot be done at its level, so its lower levels (inverted rows) stay.
  for (const r of ladders) {
    const st = r.value;
    if (st.level === null || (st.id === 'pullup' && !kit.bar)) continue;
    const ids = LADDER_BY_ID.get(st.id)!.levels.map((x) => x.exercise);
    const lower = [...new Set(ids)].filter((id) => ids.lastIndexOf(id) + 1 < st.level!);
    if (lower.length) add({ input: st.input, value: `${st.name} ladder level ${st.level}`, belowLevel: { ids: lower, level: st.exercise! }, note: `Below the tested ${st.name.toLowerCase()} level (${st.level}, ${st.levelName}): ${lower.join(', ')} never take a slot, since at your level they are not near failure; ${st.exercise} (the ladder at your level) or a loaded movement does.` }, { ladder: st.id, level: st.level });
  }
  const core = ladders[2]!.value;
  if (core.level !== null) {
    add({ input: 'coreHold', value: `${s.coreHold!.seconds} s ${s.coreHold!.kind}`, prefer: { patterns: ['core-anti-extension'], ids: [core.exercise!] }, unlock: core.level >= 2 ? ['hollow-hold'] : [], note: `${core.levelName} (the core ladder's level ${core.level}) in the anti-extension core slots.` }, { level: core.level });
  }
  const push = ladders[1]!.value;
  if (push.level !== null) {
    if (!kit.loadedPress) add({ input: 'pushUps', value: `${s.pushUps}`, prefer: { patterns: ['horizontal-push'], ids: [push.exercise!] }, note: `No bench press, dumbbell press or machine press with this equipment: the push-up ladder (level ${push.level}, ${push.levelName}) carries the pressing.` }, { pushUps: s.pushUps, loadedPress: false });
    else add({ input: 'pushUps', value: `${s.pushUps}`, note: `Pressing is covered by loaded presses; the push-up ladder's level ${push.level} (${push.levelName}) is kept for travel days (the hotel variant).` }, { pushUps: s.pushUps, loadedPress: true });
  }
  const legs = ladders[3]!.value;
  if (legs.level !== null && !kit.loadedSingleLeg) {
    add({ input: 'balanceS', value: `${s.balanceS!.left} s left, ${s.balanceS!.right} s right`, prefer: { patterns: ['lunge'], ids: [legs.exercise!, 'box-pistol', 'split-squat'] }, unlock: legs.level >= 3 ? ['box-pistol'] : [], note: `No loaded single-leg work with this equipment: the single-leg ladder (level ${legs.level}, ${legs.levelName}) in the lunge slots.` }, { level: legs.level, loadedSingleLeg: false });
  }
  if (s.wallGapCm !== undefined) {
    add({ input: 'wallGapCm', value: `${s.wallGapCm} cm`, note: `Wall test ${s.wallGapCm} cm: the posture baseline the wall-gap target starts from, re-measured at each phase review.` }, { wallGapCm: s.wallGapCm });
  }
  return { date: s.date, ladders, effects };
}
