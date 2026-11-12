// A body-assessment finding is a question before it acts (findings.ts): the
// confirmation rule itself, and where the coach reads the questions, the
// warnings of `engine review` on the synthetic vault.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { run } from '../src/cli/cli.ts';
import { activeEmphasis, appliedEmphasis, asksConfirmation, emphasisConfirmation, emphasisQuestion, findingUnconfirmed, mayRuleOut, selfCheckConfirmation } from '../src/core/findings.ts';
import { findingsToConfirm } from '../src/core/plan/self-check.ts';
import type { Emphasis, Profile } from '../src/core/schema.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

type Json = Record<string, any>;
const PROFILE = 'v/3-Personal/Fitness/Coach/profile.json';
const row = (kind: Emphasis['kind'], confirmed?: boolean): Emphasis => ({ area: 'Area', seen: 'Seen', confidence: 'medium', emphasis: 'Emphasis', kind, ...(confirmed === undefined ? {} : { confirmed }) });

describe('the confirmation rule', () => {
  it('reads each answer: true confirmed, false declined, left out not asked yet', () => {
    assert.equal(emphasisConfirmation(row('overhead-limited', true)), 'confirmed');
    assert.equal(emphasisConfirmation(row('overhead-limited', false)), 'declined');
    assert.equal(emphasisConfirmation(row('overhead-limited')), 'unconfirmed');
    const s = { date: '2026-11-02', confirmed: { overheadReach: false, balanceS: true } };
    assert.deepEqual((['overheadReach', 'balanceS', 'hingeFlatBack'] as const).map((t) => selfCheckConfirmation(s, t)), ['declined', 'confirmed', 'unconfirmed']);
    assert.equal(selfCheckConfirmation(undefined, 'sitToStand'), 'unconfirmed');
  });

  it('a profile asks once it records any answer, an empty self-check map or one body-assessment row', () => {
    assert.equal(asksConfirmation({ emphasis: [row('knees-in')] }), false);
    assert.equal(asksConfirmation({ emphasis: [], selfCheck: { date: '2026-11-02', confirmed: {} } }), true);
    assert.equal(asksConfirmation({ emphasis: [row('knees-in'), row('asymmetry', false)] }), true);
  });

  it('rules a movement out only when confirmed, or never asked in a profile from before the question', () => {
    assert.deepEqual([true, false].map((asks) => (['confirmed', 'declined', 'unconfirmed'] as const).map((c) => mayRuleOut(c, asks))), [[true, false, false], [true, false, true]]);
    assert.deepEqual(activeEmphasis([row('knees-in', false), row('asymmetry'), row('low-back-arch', true)]).map((e) => e.kind), ['asymmetry', 'low-back-arch']);
    // In full: confirmed rows, or every row of a profile from before the question.
    assert.deepEqual(appliedEmphasis({ emphasis: [row('knees-in', false), row('asymmetry'), row('low-back-arch', true)] }).map((e) => e.kind), ['low-back-arch']);
    assert.deepEqual(appliedEmphasis({ emphasis: [row('knees-in'), row('asymmetry')] }).map((e) => e.kind), ['knees-in', 'asymmetry']);
  });

  it('asks about every row the engine acts on, and says what happens until the answer is in', () => {
    assert.equal(emphasisQuestion(row('waist-fat')), null);
    assert.equal(emphasisQuestion({ ...row('knees-in'), kind: undefined }), null);
    assert.match(emphasisQuestion({ ...row('asymmetry'), side: 'left' })!, /^The body assessment noted "Seen"\. Does your left side feel weaker/);
    const f = { input: 'emphasis.overhead-limited', answer: 'emphasis[0].confirmed', question: 'Q?' };
    assert.match(findingUnconfirmed(f, false).reason.note!, /Ask: Q\? Yes: emphasis\[0\]\.confirmed true; no: emphasis\[0\]\.confirmed false\. Until profile\.json records the answer, Pahlavan applies it as before\.$/);
    assert.match(findingUnconfirmed(f, true).reason.note!, /it only ranks its regression first and adds its warm-up: it rules no movement out and sets no priority or pull-to-push aim\.$/);
    assert.equal(findingUnconfirmed(f, true).reason.rule, 'plan.finding-unconfirmed');
  });
});

describe('every question: yes means the finding holds (confirmed: true)', () => {
  // A finding of every kind the engine asks about: seven body-assessment rows, the five self-check results.
  const all = (sitToStand: { easy: boolean; heelsDown: boolean }): Pick<Profile, 'emphasis' | 'selfCheck'> => ({
    emphasis: [
      { ...row('forward-head-rounded-shoulders'), seen: 'Head forward' },
      { ...row('overhead-limited'), seen: 'Ribs flare overhead' },
      { ...row('squat-heels-lift'), seen: 'Heels lift' },
      { ...row('knees-in'), seen: 'Knees in' },
      { ...row('low-back-arch'), seen: 'Deep low-back curve' },
      { ...row('asymmetry'), seen: 'Right shoulder higher', side: 'left' },
      { ...row('lagging-area'), area: 'Upper back', seen: 'Upper back lags the chest', muscles: ['upper-back'] },
    ],
    selfCheck: { date: '2026-11-02', sitToStand, hingeFlatBack: false, overheadReach: { clean: false, ribFlare: true, lowBackArch: true }, balanceS: { left: 30, right: 18 } },
  });
  const questions = [...findingsToConfirm(all({ easy: false, heelsDown: true })), ...findingsToConfirm(all({ easy: true, heelsDown: false })).filter((f) => f.input === 'selfCheck.sitToStand')];

  it('asks each finding as the finding itself: a yes says it holds', () => {
    // Each read by hand: answering yes describes the finding, so it goes in as true.
    assert.deepEqual(questions.map((f) => [f.input, f.question]), [
      ['selfCheck.sitToStand', 'Your sit-to-stand was a struggle. Is a loaded squat below knee height painful or unsteady for you?'],
      ['selfCheck.hingeFlatBack', 'Your back rounded before your hands reached your knees in the hinge test. Does your back round or ache in Romanian deadlifts?'],
      ['selfCheck.overheadReach', 'Your overhead reach showed rib flare and your lower back arching. Does pressing overhead hurt, or make your lower back arch?'],
      ['selfCheck.balanceS', 'Your single-leg balance was under 30 s on one side (30 s left, 18 s right). Do one-leg exercises, such as split squats or single-leg Romanian deadlifts, feel unsteady?'],
      ['emphasis.forward-head-rounded-shoulders', 'The body assessment noted "Head forward". Do your shoulders round forward or your head drift forward when you sit or stand relaxed?'],
      ['emphasis.overhead-limited', 'The body assessment noted "Ribs flare overhead". Does pressing overhead hurt, or make your lower back arch?'],
      ['emphasis.squat-heels-lift', 'The body assessment noted "Heels lift". Do your heels come up when you squat deep?'],
      ['emphasis.knees-in', 'The body assessment noted "Knees in". Do your knees travel in when you squat or step down?'],
      ['emphasis.low-back-arch', 'The body assessment noted "Deep low-back curve". Does your lower back arch deeply when you stand or brace, or ache after standing?'],
      ['emphasis.asymmetry', 'The body assessment noted "Right shoulder higher". Does your left side feel weaker or less steady than the other in one-sided work?'],
      ['emphasis.lagging-area', 'The body assessment noted "Upper back lags the chest". Do you want upper back brought up as a priority (10 to 16 sets a week)?'],
      ['selfCheck.sitToStand', 'Your heels lifted in the sit-to-stand. Do they come up when you squat deep?'],
    ]);
  });

  it('asks nothing whose yes would mean the finding is gone', () => {
    for (const f of questions) {
      assert.match(f.question, /\?$/, f.input);
      assert.doesNotMatch(f.question, /\bwithout\b|\bno (back )?pain\b|flat back and|\bcan you\b|\bwithout pain\b|\bfine\b|\bclean(ly)?\?/i, `${f.input}: a yes must say the finding holds`);
    }
  });

  it('prints the mapping in every warning: yes is true, no is false', () => {
    for (const f of questions) for (const asks of [true, false]) assert.ok(findingUnconfirmed(f, asks).reason.note!.includes(`Ask: ${f.question} Yes: ${f.answer} true; no: ${f.answer} false.`), f.input);
  });
});

describe('the coach reads the questions in the warnings', () => {
  const withProfile = (edit: (p: Profile) => void) => {
    const f = fixtureFiles('v');
    const p = JSON.parse(f[PROFILE]!) as Profile;
    edit(p);
    f[PROFILE] = JSON.stringify(p);
    return memoryIo(f);
  };
  const review = (edit: (p: Profile) => void = () => {}) => JSON.parse(run(['review', '--vault', 'v', '--date', '2026-04-12'], withProfile(edit)).stdout) as Json;
  const asked = (r: Json) => (r['warnings'] as Json[]).filter((w) => w['code'] === 'finding-unconfirmed');

  it('review: one warning for the posture finding the profile has not answered, with its question', () => {
    const r = review();
    assert.deepEqual(asked(r).map((w) => w['items']), [['emphasis.forward-head-rounded-shoulders']]);
    assert.match(asked(r)[0]!['message'], /Ask: The body assessment noted "Head forward, shoulders rounded"\. Do your shoulders round forward/);
    assert.equal(r['volume']['pullPush']['value']['target'], 2, 'applied as before: pull twice push');
  });

  it('review: answered, no warning; declined, the posture goal alone sets the aim', () => {
    const yes = review((p) => { p.emphasis[0]!.confirmed = true; });
    assert.deepEqual(asked(yes), []);
    assert.equal(yes['volume']['pullPush']['value']['target'], 2);
    const no = review((p) => { p.emphasis[0]!.confirmed = false; });
    assert.deepEqual(asked(no), []);
    assert.equal(no['volume']['pullPush']['value']['target'], 1.2, 'pull at least equal to push for the posture goal, not 2 to 1');
  });
});
