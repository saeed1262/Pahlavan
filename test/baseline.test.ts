// The cycle's baseline note for a fresh start: the coach writes it from the
// engine's template, word for word, so the cycle start, week 1, readiness's
// 14 mornings and "This cycle" have their date from day one. The engine
// works out the note's dates: week 1's Monday, the first light week's photo
// Sunday and phase 1's test Saturday. Read only.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { run } from '../src/cli/cli.ts';
import { cycleStart } from '../src/core/cycle.ts';
import { titleFor } from '../src/core/reason.ts';
import { legacyRules } from '../src/core/rules.ts';
import { baselineNote } from '../src/report/baseline.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

describe('the baseline note', () => {
  it('dates a Monday fresh start: week 1, the photo Sunday of week 4, the test Saturday of week 8', () => {
    const r = baselineNote('2026-11-02', []);
    assert.equal(r.value.path, '3-Personal/Fitness/Baseline - 2026-11-02.md');
    assert.deepEqual([r.value.exists, r.value.previous, r.value.weekOne, r.value.firstPhotos, r.value.firstTests], [false, null, '2026-11-02', '2026-11-29', '2026-12-26']);
    assert.equal(r.reason.rule, 'cycle.baseline-note');
    assert.notEqual(titleFor(r.reason.rule), 'Rule');
    assert.match(r.reason.note!, /week 1 is the week of Mon 2 Nov/);
  });

  it('counts week 1 from the Monday of an intake mid-week, and names the note before', () => {
    const r = baselineNote('2026-11-04', ['2026-09-30', '2025-10-01', 'not a date']);
    assert.deepEqual([r.value.weekOne, r.value.firstPhotos, r.value.firstTests, r.value.previous], ['2026-11-02', '2026-11-29', '2026-12-26', '2026-09-30']);
    assert.match(r.reason.note!, /The note of Wed 30 Sep stays/);
  });

  it('writes the template with the date, the photo and test days, and no personal data or em-dashes', () => {
    const { text } = baselineNote('2026-11-02', []).value;
    assert.match(text, /^# Baseline · 2026-11-02\n/);
    assert.match(text, /const start = "2026-11-02";/);
    assert.match(text, /`Progress Photos\/2026-11-02\/`/);
    assert.match(text, /first light week's Sunday \(Sun 29 Nov\), then on each light week's Sunday/);
    assert.match(text, /end of phase 1 \(Sat 26 Dec, in the light week\)/);
    for (const h of ['## 1. Body', '## 2. Photos', '## 3. Fitness tests', '## 4. Strength']) assert.ok(text.includes(h), h);
    assert.doesNotMatch(text, /—/);
    assert.doesNotMatch(text, /cholesterol|83\.5|92 cm/);
  });

  it('with the plan’s own test weeks: the first photos on the earlier of the first light week and the first test week, then on each of both', () => {
    const lw = legacyRules().lightWeeks;
    // Plan week 6 comes after the first light week: the photos' first Sunday stays week 4's.
    const later = baselineNote('2026-11-02', [], lw, [6, 12]).value;
    assert.deepEqual([later.firstPhotos, later.firstTests], ['2026-11-29', '2026-12-12']);
    assert.match(later.text, /first light week's Sunday \(Sun 29 Nov\), then on each light week's Sunday and each test week's\.\n/);
    assert.match(later.text, /The first tests come in plan week 6 \(Sat 12 Dec\); the intake's movement self-check/);
    // Plan week 2 comes first: its Sunday is the first photo set.
    const early = baselineNote('2026-11-02', [], lw, [2, 12]);
    assert.deepEqual([early.value.firstPhotos, early.value.firstTests], ['2026-11-15', '2026-11-14']);
    assert.match(early.value.text, /first test week's Sunday \(Sun 15 Nov\), then on each light week's Sunday and each test week's\./);
    assert.match(early.reason.note!, /the first photo set the test week's Sunday Sun 15 Nov, the first tests plan week 2's Saturday Sat 14 Nov\./);
    // Test weeks at the phase ends read as the default; on light weeks only, they add no photo day.
    assert.equal(baselineNote('2026-11-02', [], lw, [8, 16, 24]).value.text, baselineNote('2026-11-02', []).value.text);
    const onLight = baselineNote('2026-11-02', [], lw, [4, 12]).value;
    assert.equal(onLight.firstPhotos, '2026-11-29');
    assert.match(onLight.text, /then on each light week's Sunday\.\n/);
    assert.doesNotMatch(later.text + early.value.text, /—/);
  });

  it('a note written from it starts the cycle on its date', () => {
    const { value } = baselineNote('2026-11-02', []);
    const files = fixtureFiles('v');
    files[`v/${value.path}`] = value.text;
    const read = readVault(memoryIo(files, '2026-11-03'), 'v', { asOf: '2026-11-03' });
    const c = cycleStart({ baselines: read.data.plan.baselines, firstPlanSession: read.data.plan.start, date: '2026-11-03' });
    assert.deepEqual(c.value, { start: '2026-11-02', source: 'baseline' });
  });

  it('the CLI: baseline --date prints it, and says when the note is there already', () => {
    const io = memoryIo(fixtureFiles('v'), '2026-11-02');
    const fresh = JSON.parse(run(['baseline', '--vault', 'v', '--date', '2026-11-02'], io).stdout);
    assert.equal(fresh.command, 'baseline');
    assert.deepEqual([fresh.exists, fresh.previous, fresh.firstPhotos], [false, '2026-02-23', '2026-11-29']);
    assert.match(fresh.text, /^# Baseline · 2026-11-02/);
    const there = run(['baseline', '--vault', 'v', '--date', '2026-02-23'], io);
    assert.equal(there.code, 0);
    assert.equal(JSON.parse(there.stdout).exists, true);
    assert.equal(run(['baseline', '--vault', 'v', '--date', 'soon'], io).code, 2);
  });
});
