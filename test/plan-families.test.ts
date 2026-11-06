// The split families (rules.md, "Split families"): the candidates `plan`
// builds for each week, each flagged with its family's fit and costs, the
// families left to the coach, the split preferences' vocabulary, and the
// heavy/light scoring (a point only for a trained lifter with a strength goal).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { compareTemplates } from '../src/core/plan/compare.ts';
import { buildContext, type PlanInput } from '../src/core/plan/context.ts';
import { FAMILIES, familyFit } from '../src/core/plan/families.ts';
import { generatePlan, planCandidates } from '../src/core/plan/generate.ts';
import { templateCandidates } from '../src/core/plan/template.ts';
import { SPLIT_KINDS, type Profile } from '../src/core/schema.ts';
import { validateProfile } from '../src/core/validate.ts';
import { ROOT } from './helpers.ts';

const profile = (p: Partial<Profile> = {}): Profile => ({
  schemaVersion: 1,
  units: { load: 'kg', body: 'kg' },
  goals: [{ id: 'g', kind: 'recomposition', label: 'Recomposition', importance: 8, confidence: 7 }],
  availability: { daysPerWeek: 4, minutesPerSession: 60 },
  equipment: ['dumbbells', 'barbell', 'bench', 'cable', 'machine', 'pull-up bar'],
  trackingLevel: 'standard',
  screening: { outcome: 'go', date: '2026-03-01' },
  emphasis: [],
  experience: 'novice',
  ...p,
});
const ctxOf = (p: Partial<Profile> = {}) => buildContext({ profile: profile(p), today: '2026-04-01' });
const strength = [{ id: 's', kind: 'strength' as const, label: 'Get strong', importance: 9, confidence: 8 }];
const ids = (days: number, minutes: number, p: Partial<Profile> = {}) => templateCandidates(ctxOf(p), days, minutes).map((c) => c.value.id);

describe('the family catalogue', () => {
  it('holds rules.md\'s twelve families, each built, built in part or left to the coach', () => {
    assert.deepEqual(FAMILIES.map((f) => f.id), ['full-body', 'upper-lower', 'push-pull-legs', 'body-part', 'torso-limbs', 'upper-lower-full', 'heavy-light', 'specialization', 'concurrent', 'hift', 'circuit', 'calisthenics']);
    assert.deepEqual(FAMILIES.filter((f) => f.engine === 'coach').map((f) => f.id), ['specialization', 'hift']);
    assert.deepEqual(FAMILIES.filter((f) => f.engine === 'partly').map((f) => f.id), ['concurrent', 'circuit', 'calisthenics']);
    for (const f of FAMILIES) {
      assert.ok(f.costs.length > 0 && f.evidence, f.id);
      if (f.engine !== 'built') assert.ok(f.engineNote, `${f.id}: what the engine does about it`);
    }
  });

  it('judges a family\'s Fits column against the person and the week: what it meets and misses', () => {
    const fb = familyFit('full-body', ctxOf({ badWeek: { usually: ['skips-sessions'] } }), { days: 3, minutes: 45 });
    assert.deepEqual([fb.fits, fb.misses], [true, []]);
    assert.deepEqual(fb.meets, ['2-3 days (this week 3)', '30-60 min (45)', 'a novice', 'high skip risk (the bad-week answer)']);
    assert.deepEqual(familyFit('full-body', ctxOf(), { days: 4, minutes: 60 }).misses, ['2-3 days (this week 4)']);
    const bp = familyFit('body-part', ctxOf(), { days: 4, minutes: 60 });
    assert.equal(bp.fits, false);
    assert.deepEqual(bp.misses, ['a trained lifter (intermediate or advanced)', 'likes a body-part split (preferences.splits)']);
    assert.ok(familyFit('torso-limbs', ctxOf({ priorityMuscles: ['biceps'] }), { days: 4, minutes: 60 }).fits, 'an arm emphasis');
    assert.deepEqual(familyFit('heavy-light', ctxOf({ experience: 'intermediate', goals: strength }), { days: 4, minutes: 60 }).misses, []);
    assert.deepEqual(familyFit('push-pull-legs', ctxOf({ experience: 'advanced' }), { days: 6, minutes: 60 }).misses, []);
  });
});

describe('the candidates for each week', () => {
  it('builds torso/limbs, the upper/lower/full hybrid and a body-part split at 4 days', () => {
    assert.deepEqual(ids(4, 60), ['upper-lower-x2', 'full-body-ab-x2', 'full-body-abcd', 'torso-limbs-x2', 'upper-lower-full-x4', 'body-part-x4']);
  });
  it('builds upper/lower/full, push/pull/legs once each and upper/lower rotating at 3 days; upper/lower once each at 2', () => {
    assert.deepEqual(ids(3, 60).slice(2), ['upper-lower-full-x3', 'push-pull-legs-x1', 'upper-lower-rotating']);
    assert.deepEqual(ids(2, 60).at(-1), 'upper-lower-x1');
  });
  it('builds push/pull/legs plus upper/lower, U/L/U/L/F and a body-part split at 5 days, push/pull/legs twice at 6', () => {
    const t = { experience: 'intermediate' as const };
    assert.deepEqual(ids(5, 60, t), ['upper-lower-push-pull-legs', 'upper-lower-x2', 'upper-lower-full-x5', 'body-part-x5']);
    assert.ok(ids(6, 60, t).includes('push-pull-legs-x2'));
    const five = templateCandidates(ctxOf(t), 5, 60).find((c) => c.value.id === 'upper-lower-full-x5')!.value;
    assert.deepEqual(five.rotation, [['upper', 'lower', 'upper', 'lower', 'full-light']]);
  });
  it('keeps the minimum-dose templates for short sessions, and full body only for a health goal or Conservative screening', () => {
    assert.deepEqual(ids(4, 30), ['upper-lower-minimum', 'full-body-abcd-minimum']);
    for (const p of [{ goals: [{ id: 'h', kind: 'health' as const, label: 'Health', importance: 9, confidence: 8 }] }, { screening: { outcome: 'conservative' as const, date: '2026-03-01' } }]) {
      const fam = new Set(templateCandidates(ctxOf(p), 4, 60).map((c) => c.value.family));
      assert.deepEqual([...fam], ['full-body']);
    }
  });
  it('ends each upper/lower/full hybrid on the lighter day after a day that shares its muscles: no back-to-back flag', () => {
    const cands = planCandidates({ profile: profile(), today: '2026-04-01' });
    const hybrid = cands.find((c) => c.template.id === 'upper-lower-full-x4')!;
    assert.ok(hybrid.proposal.checks.find((c) => c.id === 'concurrent')!.passed);
    const five = planCandidates({ profile: profile({ experience: 'intermediate', availability: { daysPerWeek: 5, minutesPerSession: 60 } }), today: '2026-04-01' }).find((c) => c.template.id === 'upper-lower-full-x5')!;
    assert.ok(five.proposal.checks.find((c) => c.id === 'concurrent')!.passed);
  });
  it('shows what a body-part split costs: once a week leaves a priority muscle short (the per-session cap) until a swap trains it on a second day', () => {
    const bp = planCandidates({ profile: profile({ priorityMuscles: ['lats', 'upper-back'] }), today: '2026-04-01' }).find((c) => c.template.id === 'body-part-x4')!;
    // The back day alone holds lats under 10 direct sets near failure: an accessory on the shoulders and arms day trains them too, and the proposal says so.
    assert.ok(bp.proposal.why.some((w) => /^Mesocycle 1: .+ in Shoulders and arms swapped for Negative pull-up \(slow lowering\), so lats reaches its 10 direct sets near failure/.test(w)), bp.proposal.why.join('\n'));
    assert.ok(bp.proposal.checks.find((c) => c.id === 'volume')!.passed);
    assert.ok(bp.proposal.volume.every((v) => v.split['lats']!.hardDirect >= 10));
  });
});

describe('the proposal: each candidate\'s families, fit and costs, and the coach\'s families', () => {
  const athlete = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'athletes', '2-desk-recomp.json'), 'utf8')) as { input: PlanInput };
  const p = generatePlan(athlete.input).value.proposal;

  it('flags each row with its families\' fit and costs (flags, not points)', () => {
    const abcd = p.templates.find((t) => t.id === 'full-body-abcd')!;
    assert.deepEqual(abcd.families, ['full-body', 'heavy-light']);
    assert.deepEqual(abcd.fit.map((f) => [f.family, f.fits]), [['full-body', false], ['heavy-light', false]]);
    assert.ok(abcd.fit[1]!.misses.includes('a strength goal'));
    assert.ok(abcd.costs.includes('Heavy days tire') && abcd.costs.includes('Legs every session'));
    assert.deepEqual(p.templates.find((t) => t.id === 'torso-limbs-x2')!.costs, ['A long limbs day']);
  });

  it('lists every family: the ones built here, and the ones the coach builds', () => {
    assert.equal(p.families.length, FAMILIES.length);
    const by = (id: string) => p.families.find((f) => f.family === id)!;
    assert.deepEqual(by('heavy-light').candidates, ['full-body-abcd']);
    assert.deepEqual(by('push-pull-legs').candidates, []);
    assert.match(by('push-pull-legs').note, /Not among the candidates for 4 lifting day\(s\) of 60 min/);
    assert.match(by('specialization').note, /The coach builds it as a scratch plan-data/);
    assert.match(by('concurrent').note, /The rest of it is the coach's/);
    assert.ok(p.why.some((w) => /Split families the engine does not build.*Specialization block, CrossFit-style \(HIFT\); in part: Concurrent/.test(w)));
  });
});

describe('split preferences: rules.md\'s families as the vocabulary', () => {
  it('adds the families to the four kinds, and the validator takes them and nothing else', () => {
    assert.deepEqual(SPLIT_KINDS.slice(0, 4), ['full-body', 'upper-lower', 'push-pull-legs', 'heavy-and-light-days']);
    for (const k of ['body-part', 'torso-limbs', 'upper-lower-full', 'specialization', 'hift', 'circuit', 'calisthenics']) assert.ok((SPLIT_KINDS as readonly string[]).includes(k), k);
    assert.deepEqual(validateProfile(profile({ preferences: { splits: { likes: ['torso-limbs', 'hift'], dislikes: ['body-part'] } } })), []);
    assert.equal(validateProfile({ ...profile(), preferences: { splits: { likes: ['bro-split'] } } } as unknown as Profile)[0]!.path, 'preferences.splits.likes[0]');
  });

  it('scores a liked or disliked family on its candidates', () => {
    const ctx = ctxOf({ preferences: { splits: { likes: ['torso-limbs'], dislikes: ['body-part'] } } });
    const tpls = templateCandidates(ctx, 4, 60).map((c) => c.value);
    const facts = { mainFrequency: 1, longest: 50, likedPlaced: [], heavyLegDays: 2, checks: [] };
    const c = compareTemplates(ctx, tpls.map((tpl) => ({ tpl, facts }))).value;
    const pref = (id: string) => c.rows.find((r) => r.id === id)!.factors.find((f) => f.factor === 'preferences')!.points;
    assert.equal(pref('torso-limbs-x2'), 2);
    assert.equal(pref('body-part-x4'), -3);
    assert.equal(pref('upper-lower-x2'), 0);
    assert.equal(c.rows[c.picked]!.id, 'torso-limbs-x2');
  });
});

describe('heavier and lighter days: a point only for a trained lifter with a strength goal', () => {
  const score = (p: Partial<Profile>) => {
    const ctx = ctxOf(p);
    const tpls = templateCandidates(ctx, 4, 60).map((c) => c.value);
    const facts = { mainFrequency: 1, longest: 50, likedPlaced: [], heavyLegDays: 2, checks: [] };
    const rows = compareTemplates(ctx, tpls.map((tpl) => ({ tpl, facts }))).value.rows;
    const abcd = rows.find((r) => r.id === 'full-body-abcd')!;
    return (f: string) => abcd.factors.find((x) => x.factor === f)!;
  };

  it('a muscle goal: a preference, never a score (Moesgaard 2022)', () => {
    for (const experience of ['novice', 'intermediate'] as const) {
      const f = score({ experience });
      assert.equal(f('goal').points, 0, experience);
      assert.match(f('goal').note, /a preference for goal 1, "Recomposition".*never a score.*preferences\.splits scores it/);
      assert.equal(f('training-age').points, 0, `${experience}: no training-age point for heavy/light days`);
    }
  });

  it('a strength goal: +2 for an intermediate or advanced lifter, nothing for a novice', () => {
    assert.equal(score({ experience: 'intermediate', goals: strength })('goal').points, 2);
    assert.match(score({ experience: 'advanced', goals: strength })('goal').note, /trained lifters \(Moesgaard 2022, Moderate\)/);
    const novice = score({ experience: 'novice', goals: strength })('goal');
    assert.equal(novice.points, 0);
    assert.match(novice.note, /only in trained lifters .* a preference, scored from preferences\.splits/);
  });

  it('liked heavy and light days score through the preferences', () => {
    assert.equal(score({ preferences: { splits: { likes: ['heavy-and-light-days'] } } })('preferences').points, 2);
  });
});
