// `engine evidence`: the graded rules as data. Every number is read from the
// engine constant it describes, every warning of the plan check takes the
// grade of the rule that lists it, and every source is mirrored from
// rules.md (or the region data), so the library cannot drift.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { run } from '../src/cli/cli.ts';
import { CALIBRATION } from '../src/core/calibration.ts';
import { CONCURRENT } from '../src/core/concurrent.ts';
import { EFFORT_TARGETS, MAX_LOADING_RUN, REP_LIMITS, SOURCES, STRENGTH, TEMPO } from '../src/core/data/evidence.ts';
import { CATALOGUE, CATALOGUE_BY_ID } from '../src/core/data/exercises.ts';
import { REGION_IDS, REGIONS, UNSUPPORTED_REGIONS } from '../src/core/data/regions.ts';
import { DELOAD } from '../src/core/deload.ts';
import { MISSED } from '../src/core/missed.ts';
import { CONDITIONING } from '../src/core/plan/conditioning.ts';
import { REST } from '../src/core/plan/dose.ts';
import { PROGRESSION } from '../src/core/progression.ts';
import { READINESS } from '../src/core/readiness.ts';
import { legacyLift, legacyRules, legacyRulesJson, RULE_KINDS } from '../src/core/rules.ts';
import { LOAD_CAP, screeningCaps } from '../src/core/safety.ts';
import { PRIORITY_ROOM, PULL_PUSH, PULL_PUSH_GOAL, REGION_RULES, VOLUME } from '../src/core/volume.ts';
import { buildCheck, type CheckReport } from '../src/report/check.ts';
import { buildEvidence, checkGrade, evidenceRules, TOPIC_IDS } from '../src/report/evidence.ts';
import { OVERLAP_WARN_ABOVE } from '../src/report/overlap.ts';
import { fixtureFiles, memoryIo, ROOT } from './helpers.ts';

type Json = Record<string, any>;
const PLAN = 'v/3-Personal/Fitness/plan-data.json';
const PROFILE = 'v/3-Personal/Fitness/Coach/profile.json';
const LEDGER = 'v/3-Personal/Fitness/Coach/ledger.json';
/** After the fixture's abdominal constraint ends: no hard error. */
const CLEAN = '2026-04-20';

function vault(edit: (plan: Json, profile: Json, ledger: Json) => void, date = CLEAN) {
  const files = fixtureFiles('v');
  const plan = JSON.parse(files[PLAN]!);
  const profile = JSON.parse(files[PROFILE]!);
  const ledger = JSON.parse(files[LEDGER]!);
  edit(plan, profile, ledger);
  files[PLAN] = JSON.stringify(plan);
  files[PROFILE] = JSON.stringify(profile);
  files[LEDGER] = JSON.stringify(ledger);
  return readVault(memoryIo(files), 'v', { asOf: date });
}
const check = (edit: (plan: Json, profile: Json, ledger: Json) => void, date = CLEAN): CheckReport => buildCheck(vault(edit, date), date);
const parse = (r: { stdout: string }) => JSON.parse(r.stdout) as Json;
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const itemOf = (plan: Json, type: string, name: string) => plan.sessions[type].find((i: Json) => i.name === name);
const rule = (id: string) => {
  const r = evidenceRules().find((x) => x.id === id);
  assert.ok(r, `no evidence rule ${id}`);
  return r;
};

describe('evidence: the library is the engine\'s own numbers', () => {
  it('quotes every number from the engine constant it describes', () => {
    const cases: [string, unknown][] = [
      ['volume.counting', { direct: 1, indirect: VOLUME.indirect }],
      ['volume.minimum', VOLUME.minimum],
      ['volume.efficient', [...VOLUME.bands.efficient]],
      ['volume.priority', [VOLUME.efficientTop, VOLUME.priorityTop]],
      ['volume.priority-room', { fourDays: PRIORITY_ROOM.fourDays, threeDays: PRIORITY_ROOM.threeDays, twoDaysOr30Min: PRIORITY_ROOM.twoDaysOr30Min }],
      ['volume.cap', [VOLUME.highTop, VOLUME.bands.cap[1]]],
      ['volume.per-session', VOLUME.perSessionDirectMax],
      ['volume.minimum-week', VOLUME.minimum],
      ['volume.pull-push', { finding: PULL_PUSH.target, findingFloor: PULL_PUSH.floor, goal: PULL_PUSH_GOAL.target, goalFloor: PULL_PUSH_GOAL.floor }],
      ['effort.near-failure', [0, VOLUME.hardRir]],
      ['effort.rir-by-type', { compound: [...EFFORT_TARGETS.compound], isolation: [...EFFORT_TARGETS.isolation], strength: [...EFFORT_TARGETS.strength] }],
      ['effort.conservative', screeningCaps('conservative').value.minRir],
      ['effort.unreliable', PROGRESSION.unreliableRir],
      ['effort.rir-accuracy', REP_LIMITS.rirRepsMax],
      ['load.size-reps', [REP_LIMITS.sizeReps[0], REP_LIMITS.repsMax]],
      ['rest.between-sets', REST.sets.minutes * 60],
      ['rest.heavy', [REST.heavy.minutes, REST.heavy.range[1]]],
      ['rest.superset', REST.pair.minutes * 60],
      ['tempo.speed', [...TEMPO.similarSeconds]],
      ['tempo.default', [...TEMPO.lowerSeconds]],
      ['progression.load-jump', { perSession: LOAD_CAP.perSession, maxWeekFraction: LOAD_CAP.maxWeekFraction, windowDays: LOAD_CAP.windowDays }],
      ['progression.misses', { after: (legacyLift().onMiss as { after: number }).after, drop: [...PROGRESSION.lighterBand], defaultDrop: r6(1 - PROGRESSION.lighterFactor) }],
      ['light-weeks.timing', { every: DELOAD.every, maxLoadingRun: MAX_LOADING_RUN }],
      ['light-weeks.shape', { sets: 'half', rirAdd: DELOAD.rirAdd }],
      ['light-weeks.early', { lowReadinessDays: READINESS.lowRunDays, stalledMainLifts: DELOAD.stalledMainLifts }],
      ['readiness.score', { baselineDays: READINESS.baselineDays, minBaseline: READINESS.minBaseline, clip: READINESS.clip, minSignals: READINESS.minSignals, alpha: READINESS.alpha, reseedAfterDays: READINESS.reseedAfterDays, hrvFloorLn: READINESS.hrvFloorLn }],
      ['readiness.bands', { good: READINESS.bands.good, normal: [READINESS.bands.normal, READINESS.bands.good], watch: [READINESS.bands.watch, READINESS.bands.normal], low: READINESS.bands.watch }],
      ['readiness.rhr-flag', READINESS.rhrFlagBpm],
      ['readiness.short-sleep', READINESS.shortSleepH],
      ['readiness.hrv-flag', READINESS.hrvFlagPct],
      ['calibration.rir', CALIBRATION.rir],
      ['calibration.cardio', CALIBRATION.cardio],
      ['calibration.missed-time', { easeBackDrop: r6(1 - MISSED.easeBackLoadFactor), easeBackRirAdd: MISSED.easeBackRirAdd, restartAfterWeeks: MISSED.restartAfterWeeks }],
      ['load.strength', { percentOf1RM: STRENGTH.percentOf1RM, reps: [1, EFFORT_TARGETS.strengthRepsMax] }],
      ['load.strength-frequency', STRENGTH.exposuresPerWeek],
      ['concurrent.placement', { apartHours: CONCURRENT.apartHours, warmUpMinutes: CONCURRENT.warmUpMinutes }],
      ['concurrent.legs', CONCURRENT.legGapHours],
      ['concurrent.intervals', { ...CONDITIONING.intervals, sessionMinutes: CONDITIONING.intervalsMinutes }],
      ['activity.weekly-minutes', [...CONDITIONING.activeMinutes]],
      ['activity.steps', { start: CONDITIONING.steps.base, startActiveGoal: CONDITIONING.steps.active, perPhase: CONDITIONING.steps.perPhase, max: CONDITIONING.steps.max }],
      ['regions.credit', { direct: 1, indirect: VOLUME.indirect }],
      ['regions.coverage', REGION_RULES.coverage],
      ['regions.declared', REGION_RULES.declared],
      ['rom.two-joint-long', CATALOGUE.filter((e) => e.longLength?.length).map((e) => e.id)],
      ['choice.redesign-overlap', OVERLAP_WARN_ABOVE],
    ];
    for (const [id, expected] of cases) assert.deepEqual(rule(id).value, expected, id);
    // Every rule with a number is in the list above, and names the constant it is read from.
    const covered = new Set(cases.map(([id]) => id));
    for (const r of evidenceRules().filter((x) => x.value !== null)) {
      assert.ok(covered.has(r.id), `${r.id} has a number the test does not check`);
      assert.ok(r.engine?.length, `${r.id} names no constant`);
    }
    // The library's own numbers (no engine calculation uses them) say so, and name a library constant.
    const libraryOnly = evidenceRules().filter((r) => r.libraryOnly).map((r) => r.id);
    assert.deepEqual(libraryOnly, ['load.strength', 'load.strength-frequency', 'tempo.speed', 'tempo.default']);
    for (const id of libraryOnly) assert.ok(rule(id).engine!.some((e) => /^(STRENGTH|TEMPO)\./.test(e)), id);
    // The constants that say one thing twice agree.
    assert.equal(DELOAD.rirAdd, PROGRESSION.deloadRirAdd);
    assert.deepEqual([...VOLUME.bands.priority], [VOLUME.efficientTop, VOLUME.priorityTop]);
    assert.equal(VOLUME.bands.cap[0], VOLUME.highTop);
    assert.equal(REST.heavy.text, `${REST.heavy.range[0]}-${REST.heavy.range[1]} min`);
    assert.equal(REST.heavy.minutes, REST.heavy.range[0]);
    assert.equal(legacyRules().calibration.rir, CALIBRATION.rir);
    assert.equal(legacyRules().missed.restartAfterWeeks, MISSED.restartAfterWeeks);
  });

  it('readiness: each rule a heuristic, the HRV note honest about its studies', () => {
    const rd = evidenceRules().filter((r) => r.topic === 'readiness');
    assert.deepEqual(rd.map((r) => r.id), ['readiness.score', 'readiness.bands', 'readiness.rhr-flag', 'readiness.short-sleep', 'readiness.hrv-flag']);
    assert.ok(rd.every((r) => r.grade === 'heuristic'));
    const hrv = rule('readiness.hrv-flag');
    assert.deepEqual(hrv.sources.map((x) => x.label), ['Plews 2013', 'Buchheit 2014', 'Manresa-Rocamora 2021']);
    assert.match(hrv.note, /endurance studies with rMSSD, Apple reports SDNN, and for lifting the threshold is a rough guide/);
    assert.match(hrv.note, /not a number from these papers/);
    assert.deepEqual(rule('readiness.score').sources.map((x) => x.label), ['Saw 2016', 'Buchheit 2014']);
    assert.deepEqual(rule('readiness.rhr-flag').sources.map((x) => x.label), ['Buchheit 2014']);
    assert.match(rule('readiness.rhr-flag').note, /The 7 bpm line is the coach's own rough guide, not a number from that study\./);
    assert.match(rule('readiness.score').note, /The recipe and its numbers are Pahlavan's own\./);
    assert.deepEqual(rule('readiness.short-sleep').sources.map((x) => x.label), ['Craven 2022']);
    for (const r of rd) assert.ok(!r.note.includes('\u2014'), `${r.id}: no em-dash`);
  });

  it('gives each plan-check warning the grade of the one rule that lists it', () => {
    const listed = evidenceRules().flatMap((r) => (r.checks ?? []).map((c) => [c, r.id] as const));
    assert.equal(new Set(listed.map(([c]) => c)).size, listed.length, 'a check code is listed by one rule only');
    for (const r of evidenceRules()) for (const c of r.checks ?? []) assert.equal(checkGrade(c), r.grade, c);
    assert.throws(() => checkGrade('no-such-check'), /no evidence rule lists the check no-such-check/);
    // A plan breaking many rules at once: each graded finding carries its rule's grade.
    const r = check((p, pr) => {
      Object.assign(itemOf(p, 'B', 'Seated Cable Row'), { sr: '9 × 15–20', rir: 1 });
      Object.assign(itemOf(p, 'A', 'Face Pull'), { rir: 3, rest: '90 s' });
      Object.assign(itemOf(p, 'A', 'Flat DB Bench Press'), { rir: 0, rest: '90 s' });
      p.sessions.B.push({ name: 'Band Pull-Apart', sr: '2 × 25–35', rest: '90 s', note: 'Why: posture.' });
      p.rules = { lightWeeks: { weeks: [4, 12] } };
      pr.priorityMuscles = ['glutes', 'chest', 'quads'];
      pr.equipment.push('machines');
    }, '2026-04-14');
    const graded = r.findings.filter((f) => f.grade);
    const codes = new Set(graded.map((f) => f.code));
    for (const c of ['volume-over-cap', 'session-cap', 'priority-under', 'priority-over', 'rir-by-type', 'rep-range', 'rep-range-rir', 'rest-heavy', 'no-light-week', 'region-coverage']) assert.ok(codes.has(c), `the scenario raises ${c}`);
    for (const f of graded) assert.equal(f.grade, checkGrade(f.code), f.code);
  });

  it('mirrors every source: each rule\'s and each region\'s sources are in rules.md', () => {
    const rulesMd = readFileSync(join(ROOT, 'skill', 'references', 'rules.md'), 'utf8').toLowerCase();
    for (const r of evidenceRules()) {
      for (const s of r.sources) {
        const key = (s.doi ?? s.url ?? '').toLowerCase();
        assert.ok(key, `${r.id}: ${s.label} has neither a DOI nor a URL`);
        assert.ok(rulesMd.includes(key), `${r.id}: ${s.label} (${key}) is not in rules.md`);
      }
    }
    // The region data's sources too: rules.md's Regions section cites every one.
    for (const s of [...REGIONS.flatMap((r) => r.sources), ...UNSUPPORTED_REGIONS.flatMap((u) => u.sources)]) {
      assert.ok(rulesMd.includes(s.doi.toLowerCase()), `${s.label} (${s.doi}) is not in rules.md`);
    }
  });

  it('has one id per rule, a known topic and grade, a note, and sources for every graded rule but the heuristics', () => {
    const all = evidenceRules();
    assert.equal(new Set(all.map((r) => r.id)).size, all.length);
    for (const r of all) {
      assert.ok(TOPIC_IDS.includes(r.topic), r.id);
      assert.ok(['strong', 'moderate', 'weak', 'heuristic'].includes(r.grade), r.id);
      assert.ok(r.note.length > 20, r.id);
      if (r.grade !== 'heuristic') assert.ok(r.sources.length > 0, `${r.id} is ${r.grade} with no source`);
      assert.equal(r.value === null, r.unit === null, `${r.id}: a unit goes with a value`);
    }
    // Every topic but the standing rules (a section of its own) has rules.
    for (const t of TOPIC_IDS.filter((x) => x !== 'standing-rules')) assert.ok(all.some((r) => r.topic === t), t);
  });

  it('lists every region with the catalogue movements that bias it, in the display order, and the unsupported ones with their nearest option', () => {
    const e = buildEvidence('regions');
    assert.ok(e.rules.every((r) => r.topic === 'regions'));
    assert.equal(e.findings, null);
    assert.equal(e.standingRules, null);
    assert.deepEqual(e.regions!.list.map((r) => r.id), REGION_IDS);
    const of = (id: string) => e.regions!.list.find((r) => r.id === id)!;
    assert.deepEqual(of('hamstrings-knee').movements.map((m) => m.id), ['seated-leg-curl', 'lying-leg-curl', 'slider-leg-curl', 'stability-ball-leg-curl', 'nordic-negative', 'nordic-curl']);
    assert.equal(of('hamstrings-knee').movements[0]!.longLength, true);
    assert.deepEqual(of('calves-gastroc').movements.map((m) => m.id), ['calf-raise', 'machine-calf-raise', 'single-leg-calf-raise']);
    // The back extension helps the hamstrings: half region credit.
    assert.equal(of('hamstrings-hip').movements.find((m) => m.id === 'back-extension')!.credit, VOLUME.indirect);
    assert.equal(of('upper-back-mid').roughGuide, true);
    for (const r of e.regions!.list) for (const m of r.movements) assert.ok(CATALOGUE_BY_ID.get(m.id)!.regions!.includes(r.id));
    const inner = e.regions!.unsupported.find((u) => u.phrases.includes('inner chest'))!;
    assert.deepEqual([inner.nearest, inner.nearestText], ['chest', 'the chest as a whole']);
  });

  it('says how a finding is confirmed, and gives each standing rule with its old default', () => {
    const e = buildEvidence();
    assert.deepEqual(e.findings!.answers.map((a) => [a.answer, a.value]), [['confirmed', true], ['declined', false], ['unconfirmed', null]]);
    assert.ok(e.findings!.selfCheck.some((s) => s.answer === 'selfCheck.confirmed.overheadReach'));
    assert.ok(e.findings!.emphasis.some((s) => s.kind === 'overhead-limited'));
    const kinds = e.standingRules!.kinds;
    assert.deepEqual(kinds.map((k) => k.kind), [...RULE_KINDS]);
    assert.deepEqual(kinds.find((k) => k.kind === 'lightWeeks')!.legacyDefault, legacyRulesJson()['lightWeeks']);
    assert.equal(kinds.find((k) => k.kind === 'express')!.legacyDefault, 'half');
    assert.deepEqual(e.standingRules!.lift.rules, ['double', 'linear', 'hold', 'target']);
  });
});

describe('cli: evidence', () => {
  const io = memoryIo(fixtureFiles('v'));

  it('evidence: the library, or one topic; an unknown topic is a usage error', () => {
    const all = run(['evidence', '--json'], io);
    assert.equal(all.code, 0);
    const j = parse(all);
    assert.deepEqual([j.command, j.ok, j.topic], ['evidence', true, null]);
    assert.ok(j.rules.length > 40 && j.regions && j.findings && j.standingRules);
    const one = parse(run(['evidence', '--json', '--topic', 'rest'], io));
    assert.deepEqual(one.rules.map((r: Json) => r.id), ['rest.between-sets', 'rest.heavy', 'rest.superset']);
    const bad = run(['evidence', '--topic', 'sleep'], io);
    assert.equal(bad.code, 2);
    assert.match(parse(bad).errors[0].message, /--topic must be one of volume, effort/);
  });
});
