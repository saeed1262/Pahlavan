// The welcome card's five first steps, each read from the files: the
// intake (Coach/profile.json), the plan (plan-data.json), and this cycle's
// first morning check-in, logged session and Sunday check-in. The intake's
// own first entries (weight, tape) are not a morning check-in.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { titleFor } from '../src/core/reason.ts';
import { welcomeSteps } from '../src/report/welcome.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

const DATE = '2026-04-10';
const steps = (files: Record<string, string>, date = DATE) => welcomeSteps(readVault(memoryIo(files, date), 'v', { asOf: date }), date);
const done = (w: ReturnType<typeof steps>) => w.value.steps.filter((s) => s.done).map((s) => s.id);

describe('the welcome card’s first steps', () => {
  it('on the synthetic vault: intake, plan, a morning and a session; no Sunday check-in yet', () => {
    const w = steps(fixtureFiles('v'));
    assert.deepEqual(done(w), ['intake', 'plan', 'morning', 'session']);
    assert.equal(w.value.done, 4);
    assert.equal(w.value.complete, false);
    assert.equal(w.reason.rule, 'help.welcome');
    assert.equal(titleFor(w.reason.rule), 'Getting started');
    assert.deepEqual(w.value.steps.map((s) => s.title), ['Run the intake', 'Get your plan', 'Answer your first morning check-in', 'Log your first session', 'Do your first Sunday check-in']);
  });

  it('a Sunday check-in this cycle completes it', () => {
    const files = fixtureFiles('v');
    files['v/3-Personal/Fitness/Coach/checkins.json'] = JSON.stringify({ schemaVersion: 1, checkins: [{ date: '2026-04-05', weekStart: '2026-03-30', effort: 7 }] });
    assert.equal(steps(files).value.complete, true);
  });

  it('a fresh start counts from its baseline: the intake’s weight is not a morning check-in', () => {
    const files = fixtureFiles('v');
    files['v/3-Personal/Fitness/Baseline - 2026-04-13.md'] = '# Baseline (made up)\n';
    const body = JSON.parse(files['v/3-Personal/Fitness/body-data.json']!);
    body.days['2026-04-13'] = { weight: 80.1 };
    files['v/3-Personal/Fitness/body-data.json'] = JSON.stringify(body);
    assert.deepEqual(done(steps(files, '2026-04-13')), ['intake', 'plan']);
    body.days['2026-04-14'] = { energy: 4, sleepH: 7.5 };
    files['v/3-Personal/Fitness/body-data.json'] = JSON.stringify(body);
    assert.deepEqual(done(steps(files, '2026-04-14')), ['intake', 'plan', 'morning']);
  });

  it('a new vault: nothing done', () => {
    const files = fixtureFiles('v');
    for (const k of Object.keys(files)) if (/Coach\/profile\.json|plan-data\.json|fitness-log-data\.json|body-data\.json/.test(k)) delete files[k];
    assert.deepEqual(done(steps(files)), []);
  });
});
