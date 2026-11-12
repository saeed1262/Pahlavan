// The Check-in screen: the morning merge into body-data.json (shared with
// the Habit Nudges plugin), the Sunday answers as a check-in record through
// `checkin add`'s merge, the coach letter and the screen's report.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { dayOfField, mergeMorning, morningFrom, validateMorning } from '../src/adapters/vault/body-write.ts';
import { readVault } from '../src/adapters/vault/read.ts';
import { addCheckins, answersFromRecord, buildCheckin, buildTemplate, parseLetter, recordFromAnswers, sundaySummary } from '../src/report/index.ts';
import { ROOT } from './helpers.ts';

const VAULT = join(ROOT, 'test', 'fixtures', 'vault');
const BODY_TEXT = readFileSync(join(VAULT, '3-Personal/Fitness/body-data.json'), 'utf8');
const io = (over: Record<string, string> = {}) => ({
  readText: (p: string) => {
    for (const [k, v] of Object.entries(over)) if (p.endsWith(k)) return v;
    return existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null;
  },
  listDir: (p: string) => (existsSync(p) && statSync(p).isDirectory() ? readdirSync(p) : null),
});

describe('mergeMorning: the morning check-in into body-data.json', () => {
  const DATE = '2026-04-10';
  const before = JSON.parse(BODY_TEXT);
  const base = morningFrom(before, DATE).values;

  it('reads the day as Habit Nudges left it, with yesterday’s steps and floors', () => {
    assert.deepEqual(base, { energy: 2, soreness: 3, sleepQ: 2, sleepH: 5.5, rhr: 68, hrv: null, weight: 83.8, steps: 9184, floors: 4 });
    assert.equal(morningFrom(before, DATE).checkedAt, '2026-04-10T07:10:00.000Z');
    assert.equal(dayOfField('steps', DATE), '2026-04-09');
    assert.equal(dayOfField('floors', DATE), '2026-04-09');
  });

  it('changes only the fields the form changed: other days, Habit Nudges’ fields and the other lists stay', () => {
    const r = mergeMorning(BODY_TEXT, DATE, { values: { energy: 4, weight: 83.4 }, baseline: base });
    assert.equal(r.result, 'merged');
    if (r.result !== 'merged') return;
    assert.deepEqual(r.changed, ['energy', 'weight']);
    const out = JSON.parse(r.text);
    assert.deepEqual(out.days[DATE], { ...before.days[DATE], energy: 4, weight: 83.4 });
    assert.equal(out.days[DATE].checkedAt, '2026-04-10T07:10:00.000Z');
    assert.equal(out.days[DATE].floors, 0);
    for (const d of Object.keys(before.days)) if (d !== DATE) assert.deepEqual(out.days[d], before.days[d]);
    assert.deepEqual(Object.keys(out.days), Object.keys(before.days));
    for (const k of ['_about', 'tape', 'tests', 'photos']) assert.deepEqual(out[k], before[k]);
  });

  it('puts steps on yesterday, next to its floors, and clears a field set to empty', () => {
    const r = mergeMorning(BODY_TEXT, DATE, { values: { steps: 10200, rhr: null }, baseline: base });
    assert.equal(r.result, 'merged');
    if (r.result !== 'merged') return;
    const out = JSON.parse(r.text);
    assert.deepEqual(out.days['2026-04-09'], { ...before.days['2026-04-09'], steps: 10200 });
    assert.equal('rhr' in out.days[DATE], false);
    assert.equal(out.days[DATE].steps, before.days[DATE].steps);
  });

  it('merges sore muscles muscle by muscle, as the log panel does', () => {
    const r = mergeMorning(BODY_TEXT, DATE, { values: {}, baseline: base, sore: { quadriceps: null, hamstring: 'mild' } });
    assert.equal(r.result, 'merged');
    if (r.result !== 'merged') return;
    assert.deepEqual(JSON.parse(r.text).days[DATE].soreMuscles, { glutes: 'sore', hamstrings: 'mild' });
  });

  it('keeps what another writer saved since the form read the file, and flags a field both changed', () => {
    // Habit Nudges saved after the form opened: sleep and weight moved, checkedAt is new.
    const disk = JSON.parse(BODY_TEXT);
    disk.days[DATE] = { ...disk.days[DATE], sleepH: 6.2, weight: 83.6, checkedAt: '2026-04-10T07:40:00.000Z' };
    const text = JSON.stringify(disk, null, 2);
    const ok = mergeMorning(text, DATE, { values: { energy: 4 }, baseline: base });
    assert.equal(ok.result, 'merged');
    if (ok.result === 'merged') assert.deepEqual(JSON.parse(ok.text).days[DATE], { ...disk.days[DATE], energy: 4 });
    const clash = mergeMorning(text, DATE, { values: { weight: 83.0 }, baseline: base });
    assert.deepEqual(clash, { result: 'conflict', conflicts: [{ key: 'weight', disk: 83.6, baseline: 83.8, mine: 83.0 }] });
    const forced = mergeMorning(text, DATE, { values: { weight: 83.0 }, baseline: base, force: true });
    assert.equal(forced.result === 'merged' && JSON.parse(forced.text).days[DATE].weight, 83.0);
    // The same value on both sides is not a conflict.
    assert.equal(mergeMorning(text, DATE, { values: { weight: 83.6 }, baseline: base }).result, 'unchanged');
  });

  it('starts a new day (and a new file), refuses out-of-range values, leaves an unreadable file alone', () => {
    const r = mergeMorning(BODY_TEXT, '2026-04-12', { values: { energy: 3, sleepH: 7 }, baseline: {} });
    assert.equal(r.result === 'merged' && JSON.stringify(JSON.parse(r.text).days['2026-04-12']), JSON.stringify({ energy: 3, sleepH: 7 }));
    const fresh = mergeMorning(null, '2026-04-12', { values: { weight: 80 }, baseline: {} });
    assert.equal(fresh.result === 'merged' && fresh.text, JSON.stringify({ days: { '2026-04-12': { weight: 80 } } }, null, 2));
    assert.deepEqual(validateMorning({ energy: 6, rhr: 61.5, sleepH: 7.5 }), ['Energy is between 1 and 5', 'Resting HR is a whole number']);
    assert.equal(mergeMorning(BODY_TEXT, DATE, { values: { energy: 0 }, baseline: base }).result, 'invalid');
    assert.equal(mergeMorning('{', DATE, { values: { energy: 3 }, baseline: base }).result, 'unreadable');
    assert.equal(mergeMorning(BODY_TEXT, DATE, { values: { energy: 2 }, baseline: base }).result, 'unchanged');
  });

  it('HRV: a whole number of ms, 5 to 300, on the check-in day', () => {
    assert.deepEqual(validateMorning({ hrv: 4 }), ['HRV is between 5 and 300']);
    assert.deepEqual(validateMorning({ hrv: 52.5 }), ['HRV is a whole number']);
    const r = mergeMorning(BODY_TEXT, DATE, { values: { hrv: 52 }, baseline: base });
    assert.equal(r.result === 'merged' && JSON.parse(r.text).days[DATE].hrv, 52);
    assert.equal(r.result === 'merged' && morningFrom(JSON.parse(r.text), DATE).values.hrv, 52);
  });

  it('"I\'m ill today": a yes writes illness true on the day, a no takes it off, and it counts as a check-in save', () => {
    assert.equal(morningFrom(before, DATE).illness, false);
    const ill = mergeMorning(BODY_TEXT, '2026-04-12', { values: {}, baseline: {}, illness: true, checkedAt: '2026-04-12T07:05:00.000Z' });
    assert.equal(ill.result, 'merged');
    if (ill.result !== 'merged') return;
    assert.deepEqual([ill.illness, ill.stamped, ill.changed], [true, true, []]);
    const day = JSON.parse(ill.text).days['2026-04-12'];
    assert.deepEqual(day, { illness: true, checkedAt: '2026-04-12T07:05:00.000Z' });
    assert.equal(morningFrom(JSON.parse(ill.text), '2026-04-12').illness, true);
    // Asked again: nothing to write. A no takes the field off, never writing false.
    assert.equal(mergeMorning(ill.text, '2026-04-12', { values: {}, baseline: {}, illness: true }).result, 'unchanged');
    const well = mergeMorning(ill.text, '2026-04-12', { values: {}, baseline: {}, illness: false });
    assert.equal(well.result === 'merged' && 'illness' in JSON.parse(well.text).days['2026-04-12'], false);
    assert.equal(mergeMorning(BODY_TEXT, DATE, { values: {}, baseline: base, illness: false }).result, 'unchanged');
  });
});

describe('the Sunday check-in: answers to a record, through checkin add', () => {
  const SUN = '2026-04-12';
  const read = readVault(io(), VAULT, { asOf: SUN });
  const t = buildTemplate(read.data, SUN, null);
  const open = { ...t, ask: t.ask.filter((a) => a.open) };

  it('starts blank with the template’s pre-fills', () => {
    const a = answersFromRecord(open);
    assert.deepEqual(a.gaps, { '2026-04-09': { choice: null, session: '' }, '2026-04-12': { choice: null, session: '' } });
    assert.deepEqual([a.effort, a.pain.option, a.rir, a.protein, a.focus], [null, null, undefined, null, null]);
    assert.deepEqual(a.fullLoad, { '2026-03-23': null });
    assert.deepEqual(a.triage, { 'Flat DB Bench Press': 1 });
    const s = sundaySummary(open, a);
    assert.ok(s.open.includes('Effort'));
  });

  const filled = () => {
    const a = answersFromRecord(open);
    a.gaps['2026-04-09'] = { choice: 'trained', session: 'S3' };
    a.gaps['2026-04-12'] = { choice: 'rest', session: '' };
    a.effort = 7;
    a.pain = { option: 1, areas: [{ area: 'knees', severity: 2 }] };
    a.stress = 4;
    a.recovery = 4;
    a.rir = 2.5;
    a.protein = 2;
    a.enjoyment = 4;
    a.busy = { option: 1, from: '2026-05-04', to: '2026-05-10', sessions: null, note: 'Work trip' };
    a.focus = false;
    a.notes = '  Slept badly midweek. ';
    a.fullLoad['2026-03-23'] = true;
    return a;
  };

  it('becomes the record checkin add merges: added, valid, nothing left open', () => {
    const a = filled();
    const record = recordFromAnswers(open, a);
    const r = addCheckins({ existingText: null, answers: record, today: SUN, data: read.data });
    assert.deepEqual(r.errors, []);
    assert.equal(r.results[0]!.action, 'added');
    const saved = r.doc!.checkins[0]!;
    assert.deepEqual(saved.confirmedUnlogged, [{ date: '2026-04-09', type: 'S3' }]);
    assert.deepEqual([saved.restDays, saved.missedDays], [['2026-04-12'], []]);
    assert.deepEqual(saved.jointAches, [{ area: 'knees', severity: 2 }]);
    // The protein answer is saved as it was given (proteinExtra): the ticks are counted when read.
    assert.deepEqual([saved.effort, saved.stress, saved.recovery, saved.reportedRir, saved.proteinExtra, saved.proteinDays, saved.enjoyment, saved.focusFollowed], [7, 4, 4, 2.5, 2, undefined, 4, false]);
    assert.deepEqual(saved.knownBusy, [{ from: '2026-05-04', to: '2026-05-10', kind: 'travel', note: 'Work trip' }]);
    assert.deepEqual(saved.deload, { trainedAtFullLoad: ['2026-03-23'] });
    assert.deepEqual(saved.triage, [{ lift: 'Flat DB Bench Press', step: 1, date: SUN }]);
    assert.equal(saved.notes, 'Slept badly midweek.');
    assert.equal(saved.letter, '3-Personal/Fitness/Coach/Letters/2026-04-12.md');
    assert.deepEqual(sundaySummary(open, a).open, []);
  });

  it('reads a saved record back to the same answers, and an edit updates only what changed', () => {
    const a = filled();
    const first = addCheckins({ existingText: null, answers: recordFromAnswers(open, a), today: SUN, data: read.data });
    const text = `${JSON.stringify(first.doc, null, 2)}\n`;
    const again = readVault(io({ 'Coach/checkins.json': text }), VAULT, { asOf: SUN });
    const t2 = buildTemplate(again.data, SUN, null);
    assert.equal(t2.existing, true);
    // The screen shows the open questions and those the record answers (to edit).
    const shown = { ...t2, ask: t2.ask.filter((x) => x.open || x.answered) };
    const a2 = answersFromRecord(shown);
    assert.deepEqual(a2.gaps, a.gaps);
    // The full-load week is answered, so the template no longer asks; the record keeps it.
    assert.deepEqual([a2.effort, a2.pain, a2.rir, a2.protein, a2.focus, a2.fullLoad, a2.triage], [7, { option: 1, areas: [{ area: 'knees', severity: 2 }] }, 2.5, 2, false, {}, { 'Flat DB Bench Press': 1 }]);
    a2.effort = 9;
    const upd = addCheckins({ existingText: text, answers: recordFromAnswers(shown, a2), today: SUN, data: again.data });
    assert.equal(upd.results[0]!.action, 'updated');
    assert.equal(upd.doc!.checkins[0]!.effort, 9);
    assert.deepEqual(upd.doc!.checkins[0]!.knownBusy, first.doc!.checkins[0]!.knownBusy);
    assert.deepEqual(upd.doc!.checkins[0]!.deload, { trainedAtFullLoad: ['2026-03-23'] });
    // Unanswered stays unanswered: an existing value is kept, not cleared.
    a2.recovery = null;
    const kept = addCheckins({ existingText: text, answers: recordFromAnswers(shown, a2), today: SUN, data: again.data });
    assert.equal(kept.doc!.checkins[0]!.recovery, 4);
  });

  it('keeps the other records in checkins.json', () => {
    const other = { schemaVersion: 1, checkins: [{ date: '2026-04-05', weekStart: '2026-03-30', effort: 5, letter: '3-Personal/Fitness/Coach/Letters/2026-04-05.md' }] };
    const r = addCheckins({ existingText: JSON.stringify(other), answers: recordFromAnswers(open, filled()), today: SUN, data: read.data });
    assert.deepEqual(r.doc!.checkins.map((c) => c.date), ['2026-04-05', SUN]);
    assert.deepEqual(r.doc!.checkins[0], other.checkins[0]);
  });
});

describe('parseLetter', () => {
  const LETTER = `---\ntype: coach-letter       # coach-letter | mesocycle-review\ndate: 2026-04-05\nplanWeek: 5\nfocus: lights out by 23:00 on 5 nights\n---\n\n# Week 5 letter\n\n| Sessions | Lifts |\n|---|---|\n| 3/3 | bench held |\n\n## What happened\nThree **lifting** sessions and the short one. [[3-Personal/Fitness/Coach/Decisions#x|decision]]\n\n## What changes and why\n1. **Bench to 55 lb.** Every set reached 8.\n\n## This week's focus\nLights out by 23:00.\n\n## One question for you\nWas that 50 kg?\n`;
  it('reads the frontmatter, the title and the sections as plain text', () => {
    const l = parseLetter('3-Personal/Fitness/Coach/Letters/2026-04-05.md', LETTER);
    assert.deepEqual([l.date, l.kind, l.title, l.focus], ['2026-04-05', 'coach-letter', 'Week 5 letter', 'lights out by 23:00 on 5 nights']);
    assert.deepEqual(l.sections.map((s) => s.heading), ['What happened', 'What changes and why', "This week's focus", 'One question for you']);
    assert.equal(l.sections[0]!.text, 'Three lifting sessions and the short one. decision');
    assert.equal(l.sections[1]!.text, '1. Bench to 55 lb. Every set reached 8.');
  });
  it('takes the date from the file name without frontmatter', () => {
    assert.equal(parseLetter('x/Letters/2026-03-29.md', '# Week 4\n\n## What happened\nFine.').date, '2026-03-29');
  });
});

describe('buildCheckin', () => {
  it('pre-fills the morning from body-data, finds what today trains, and opens the late Sunday check-in on a weekday', () => {
    const read = readVault(io(), VAULT, { asOf: '2026-04-10' });
    const c = buildCheckin(read, '2026-04-10', null);
    assert.deepEqual(c.morning.values, { energy: 2, soreness: 3, sleepQ: 2, sleepH: 5.5, rhr: 68, hrv: null, weight: 83.8, steps: 9184, floors: 4 });
    assert.deepEqual(c.morning.sore, { gluteal: 'sore', quadriceps: 'mild' });
    assert.equal(c.morning.filled, true);
    assert.ok(c.morning.trains.includes('gluteal'));
    assert.equal(c.sunday!.status, 'late');
    assert.equal(c.sunday!.date, '2026-04-05');
    assert.ok(c.sunday!.template.ask.every((a) => a.open));
    assert.deepEqual(c.notes.map((n) => n.code), ['no-letter']);
  });
  it('on a Sunday: open, then edit once saved; on the next weekday: saved, with the next date', () => {
    const SUN = '2026-04-12';
    const read = readVault(io(), VAULT, { asOf: SUN });
    assert.equal(buildCheckin(read, SUN, null).sunday!.status, 'open');
    const t = buildTemplate(read.data, SUN, null);
    const rec = recordFromAnswers(t, { ...answersFromRecord(t), effort: 7 });
    const text = JSON.stringify(addCheckins({ existingText: null, answers: rec, today: SUN, data: read.data }).doc);
    const saved = readVault(io({ 'Coach/checkins.json': text }), VAULT, { asOf: SUN });
    assert.equal(buildCheckin(saved, SUN, null).sunday!.status, 'edit');
    const mon = buildCheckin(readVault(io({ 'Coach/checkins.json': text }), VAULT, { asOf: '2026-04-13' }), '2026-04-13', null);
    assert.deepEqual([mon.sunday!.status, mon.sunday!.date, mon.sunday!.nextOpens], ['saved', SUN, '2026-04-19']);
  });
  it('carries the last letter, parsed', () => {
    const read = readVault(io(), VAULT, { asOf: '2026-04-10' });
    const c = buildCheckin(read, '2026-04-10', { path: '3-Personal/Fitness/Coach/Letters/2026-04-05.md', text: '---\nfocus: sleep\n---\n# Week 5\n## What happened\nGood week.' });
    assert.equal(c.letter!.focus, 'sleep');
    assert.deepEqual(c.notes, []);
  });
});
