// The writers, as pure merges from the text on disk: the body record (tape,
// tests, the photo index, a rest mark, floors in the morning fields) into
// body-data.json field by field; linked-habit ticks and amounts into
// habits-data.json; Coach/tracking.json, Coach/nudges.json and
// Coach/sitting.json with conflict detection and read-back checks; and the
// reader for them. Made-up data; the fixture files are read, never written.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { mergeDayMark, mergeMorning, mergePhotoIndex, mergeTape, mergeTests, morningFrom, photoPath, recordFrom, sipsArgs } from '../src/adapters/vault/body-write.ts';
import { habitsLanded, mergeHabitChanges } from '../src/adapters/vault/habits-write.ts';
import { habitKey } from '../src/adapters/vault/log-write.ts';
import { assembleTracking, nudgesSettingsPath, pahlavanSettingsPath, quietHoursFrom, readQuietHours, readTracking } from '../src/adapters/vault/tracking-read.ts';
import { landed, mergeNudges, mergeSitting, mergeTracking } from '../src/adapters/vault/tracking-write.ts';
import { readVault } from '../src/adapters/vault/read.ts';
import { answerCard } from '../src/core/nudges.ts';
import type { TrackedItem, Tracking } from '../src/core/schema.ts';
import { fsIo, memoryIo, fixtureFiles, VAULT } from './helpers.ts';

const FIT = join(VAULT, '3-Personal/Fitness');
const BODY = readFileSync(join(FIT, 'body-data.json'), 'utf8');
const HABITS = readFileSync(join(VAULT, '5-System/Data/habits-data.json'), 'utf8');
const TRACKING = readFileSync(join(FIT, 'Coach/tracking.json'), 'utf8');
const NUDGES = readFileSync(join(FIT, 'Coach/nudges.json'), 'utf8');
const SITTING = readFileSync(join(FIT, 'Coach/sitting.json'), 'utf8');
const j = (t: string) => JSON.parse(t);

describe('the body record into body-data.json', () => {
  const before = j(BODY);

  it('the tape, field by field: a new entry in date order, the other entries and lists untouched', () => {
    const r = mergeTape(BODY, '2026-03-10', { values: { waist: 95, arm: 33 }, baseline: {} });
    assert.equal(r.result, 'merged');
    if (r.result !== 'merged') return;
    const out = j(r.text);
    assert.deepEqual(out.tape.map((t: { date: string }) => t.date), ['2026-02-24', '2026-03-10', '2026-03-24']);
    assert.deepEqual(out.tape[1], { date: '2026-03-10', waist: 95, arm: 33 });
    for (const k of ['days', 'tests', 'photos', '_about']) assert.deepEqual(out[k], before[k]);
    assert.deepEqual(r.changed, ['waist', 'arm']);
  });

  it('changing one field keeps the others; a field someone changed since is a conflict; null clears; an empty entry goes', () => {
    const base = recordFrom(before, 'tape', '2026-03-24');
    const r = mergeTape(BODY, '2026-03-24', { values: { waist: 94 }, baseline: base });
    assert.equal(r.result === 'merged' && j(r.text).tape[1].hips, 97);
    const disk = j(BODY);
    disk.tape[1].waist = 94.2;
    const text = JSON.stringify(disk);
    assert.deepEqual(mergeTape(text, '2026-03-24', { values: { waist: 94 }, baseline: base }), { result: 'conflict', conflicts: [{ key: 'waist', disk: 94.2, baseline: 94.5, mine: 94 }] });
    assert.equal(mergeTape(text, '2026-03-24', { values: { waist: 94 }, baseline: base, force: true }).result, 'merged');
    const cleared = mergeTape(BODY, '2026-02-24', { values: { waist: null, hips: null, chest: null, arm: null }, baseline: recordFrom(before, 'tape', '2026-02-24') });
    assert.equal(cleared.result === 'merged' && j(cleared.text).tape.length, 1);
  });

  it('refuses values out of Habit Nudges\' limits, and leaves an unreadable file alone', () => {
    assert.deepEqual(mergeTape(BODY, '2026-03-10', { values: { arm: 90, neck: 40 } as never, baseline: {} }), { result: 'invalid', errors: ['Arm is between 15 and 70', 'neck is not a field here'] });
    assert.deepEqual(mergeTests(BODY, '2026-03-10', { values: { pushups: 12.5 }, baseline: {} }), { result: 'invalid', errors: ['Push-ups is a whole number'] });
    assert.equal(mergeTape('{"days": {', '2026-03-10', { values: { waist: 90 }, baseline: {} }).result, 'unreadable');
    assert.equal(mergeTape(null, '2026-03-10', { values: { waist: 90 }, baseline: {} }).result, 'merged', 'a missing file starts a new one');
  });

  it('the tests, numbers and the two free-text ones, kept with the entry\'s other results', () => {
    const r = mergeTests(BODY, '2026-03-07', { values: { pullups: 1, pullupLevel: 'negatives 3×3', wallGapCm: 4.5 }, baseline: recordFrom(before, 'tests', '2026-03-07') });
    assert.equal(r.result, 'merged');
    if (r.result === 'merged') assert.deepEqual(j(r.text).tests[0], { ...before.tests[0], pullups: 1, pullupLevel: 'negatives 3×3', wallGapCm: 4.5 });
  });

  it('the photo index: poses added in order after the ones there, removed ones out, unknown poses refused', () => {
    const r = mergePhotoIndex(BODY, '2026-02-24', ['posture-closeup', 'front']);
    assert.equal(r.result === 'merged' && JSON.stringify(j(r.text).photos[0].poses), JSON.stringify(['front', 'side', 'back', 'posture-closeup']));
    const n = mergePhotoIndex(BODY, '2026-04-12', ['side', 'front']);
    assert.equal(n.result === 'merged' && JSON.stringify(j(n.text).photos.at(-1)), JSON.stringify({ date: '2026-04-12', poses: ['side', 'front'] }));
    assert.equal(mergePhotoIndex(BODY, '2026-02-24', ['front']).result, 'unchanged');
    const gone = mergePhotoIndex(BODY, '2026-02-24', [], ['front', 'side', 'back']);
    assert.equal(gone.result === 'merged' && j(gone.text).photos.length, 0);
    assert.equal(mergePhotoIndex(BODY, '2026-02-24', ['selfie']).result, 'invalid');
    assert.equal(photoPath('2026-04-12', 'front'), '3-Personal/Fitness/Progress Photos/2026-04-12/front.jpeg');
    assert.deepEqual(sipsArgs('in.heic', 'out.jpeg'), ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '-Z', '1600', 'in.heic', '--out', 'out.jpeg']);
  });

  it('a rest mark on the day ("Did you train?": Rest day), read back as the day\'s mark', () => {
    const r = mergeDayMark(BODY, '2026-04-09', 'rest');
    assert.equal(r.result, 'merged');
    if (r.result !== 'merged') return;
    assert.deepEqual(j(r.text).days['2026-04-09'], { ...before.days['2026-04-09'], mark: 'rest' });
    const io = memoryIo({ ...fixtureFiles('v'), 'v/3-Personal/Fitness/body-data.json': r.text });
    assert.equal(readVault(io, 'v').data.checkins.daily.find((c) => c.date === '2026-04-09')!.mark, 'rest');
    assert.equal(mergeDayMark(r.text, '2026-04-09', 'rest').result, 'unchanged');
    assert.equal(mergeDayMark(r.text, '2026-04-09', null).result === 'merged', true);
  });

  it('floors join the morning fields, filed under yesterday like steps', () => {
    const base = morningFrom(before, '2026-04-10').values;
    const r = mergeMorning(BODY, '2026-04-10', { values: { floors: 7, steps: 9500 }, baseline: base });
    assert.equal(r.result, 'merged');
    if (r.result !== 'merged') return;
    const out = j(r.text);
    assert.deepEqual([out.days['2026-04-09'].floors, out.days['2026-04-09'].steps, out.days['2026-04-10'].floors], [7, 9500, 0]);
    assert.deepEqual(mergeMorning(BODY, '2026-04-10', { values: { floors: 501 }, baseline: base }), { result: 'invalid', errors: ['Floors yesterday is between 0 and 500'] });
  });
});

describe('linked habits into habits-data.json', () => {
  it('ticks add "1" and untick removes it, keyed as the homepage grid keys them', () => {
    const r = mergeHabitChanges(HABITS, [{ habit: 'protein', date: '2026-04-10', tick: true }, { habit: 'protein', date: '2026-04-06', tick: false }]);
    assert.equal(r.result, 'merged');
    if (r.result !== 'merged') return;
    assert.deepEqual(r.changed, [{ key: 'hab-protein-2026-W15-4', from: null, to: '1' }, { key: 'hab-protein-2026-W15-0', from: '1', to: null }]);
    const out = j(r.text);
    assert.equal(out.checkins['hab-protein-2026-W15-4'], '1');
    assert.equal('hab-protein-2026-W15-0' in out.checkins, false);
    assert.deepEqual(out.habits, j(HABITS).habits);
    assert.ok(habitsLanded(r.text, r.changed));
    assert.equal(habitKey('2026-04-10'), 'hab-workout-2026-W15-4');
  });

  it('amounts as numbers: set exactly, or added as a delta onto what is there (never below 0)', () => {
    const a = mergeHabitChanges(HABITS, [{ habit: 'water', date: '2026-04-08', add: 250 }]);
    const disk = j(HABITS).checkins['hab-water-2026-W15-2'];
    assert.equal(a.result === 'merged' && j(a.text).checkins['hab-water-2026-W15-2'], String(Number(disk) + 250));
    const s = mergeHabitChanges(HABITS, [{ habit: 'water', date: '2026-04-10', value: 1250.555 }]);
    assert.equal(s.result === 'merged' && j(s.text).checkins['hab-water-2026-W15-4'], '1250.56');
    const neg = mergeHabitChanges(HABITS, [{ habit: 'water', date: '2026-04-10', add: -500 }]);
    assert.equal(neg.result === 'merged' && j(neg.text).checkins['hab-water-2026-W15-4'], '0');
  });

  it('skips an unknown habit or the wrong kind of change; starts a vault’s first file, never overwrites a broken one', () => {
    const r = mergeHabitChanges(HABITS, [{ habit: 'creatine', date: '2026-04-10', tick: true }, { habit: 'water', date: '2026-04-10', tick: true }, { habit: 'protein', date: '2026-04-10', add: 1 }]);
    assert.deepEqual(r, { result: 'unchanged', skipped: [{ habit: 'creatine', why: 'no habit "creatine" in habits-data.json' }, { habit: 'water', why: 'Water (mL) counts an amount, not a tick' }, { habit: 'protein', why: 'Protein is a tick, not an amount' }] });
    assert.equal(mergeHabitChanges(null, []).result, 'unchanged', 'no change: nothing to write, so no file is started');
    const first = mergeHabitChanges(null, [{ habit: 'protein', date: '2026-04-10', tick: true }]);
    assert.equal(first.result, 'merged');
    assert.deepEqual(JSON.parse((first as { text: string }).text).checkins, { 'hab-protein-2026-W15-4': '1' });
    assert.equal(mergeHabitChanges('<<<<<<< HEAD', []).result, 'unreadable');
    assert.equal(mergeHabitChanges('{"checkins": {}}', []).result, 'unreadable');
  });
});

describe('Coach/tracking.json', () => {
  const doc = j(TRACKING) as Tracking;
  const creatine = doc.items.find((x) => x.id === 'creatine')!;

  it('a tick, an amount added, an exact value; the log tidies an empty record away; read-back checks', () => {
    const r = mergeTracking(TRACKING, [
      { op: 'tick', item: 'multivitamin', date: '2026-04-10', done: true, at: '2026-04-10T09:30:00.000Z' },
      { op: 'add', item: 'water', date: '2026-04-10', field: 'amount', delta: 250, at: '2026-04-10T12:20:00.000Z' },
      { op: 'set', item: 'stand-ups', date: '2026-04-10', field: 'minutes', value: 100, baseline: 80 },
      { op: 'tick', item: 'creatine', date: '2026-04-09', done: false },
    ]);
    assert.equal(r.result, 'merged');
    if (r.result !== 'merged') return;
    assert.deepEqual(r.doc.days['2026-04-10']!['multivitamin'], { done: true, at: '2026-04-10T09:30:00.000Z' });
    assert.deepEqual(r.doc.days['2026-04-10']!['water'], { amount: 1500, at: '2026-04-10T12:20:00.000Z' });
    assert.equal(r.doc.days['2026-04-10']!['stand-ups']!.minutes, 100);
    assert.equal('creatine' in r.doc.days['2026-04-09']!, false);
    assert.ok(landed(r.text, r.check));
    assert.equal(landed(TRACKING, r.check), false);
    assert.ok(r.text.endsWith('}\n'));
  });

  it('a desk stand: its minutes into minutes and deskMinutes, a stand into count; desk minutes only on a stand-up item', () => {
    const stand = (field: 'minutes' | 'count' | 'deskMinutes', delta: number, item = 'stand-ups') => ({ op: 'add' as const, item, date: '2026-04-10', field, delta, at: '2026-04-10T14:00:00.000Z' });
    const r = mergeTracking(TRACKING, [stand('minutes', 20), stand('count', 1), stand('deskMinutes', 20)]);
    assert.equal(r.result, 'merged');
    if (r.result !== 'merged') return;
    assert.deepEqual(r.doc.days['2026-04-10']!['stand-ups'], { minutes: 100, count: 5, deskMinutes: 20, at: '2026-04-10T14:00:00.000Z' });
    assert.ok(landed(r.text, r.check));
    const again = mergeTracking(r.text, [stand('deskMinutes', 20)]);
    assert.equal(again.result === 'merged' && again.doc.days['2026-04-10']!['stand-ups']!.deskMinutes, 40);
    const wrong = mergeTracking(TRACKING, [stand('deskMinutes', 20, 'desk-breaks')]);
    assert.equal(wrong.result, 'invalid');
    assert.match(JSON.stringify(wrong), /days.2026-04-10.desk-breaks.deskMinutes: does not apply to a desk item/);
  });

  it('an exact value someone else changed is a conflict; a delta never is', () => {
    const r = mergeTracking(TRACKING, [{ op: 'set', item: 'water', date: '2026-04-10', field: 'amount', value: 2000, baseline: 1000 }]);
    assert.deepEqual(r, { result: 'conflict', conflicts: [{ what: 'water amount on 2026-04-10', disk: 1250, baseline: 1000, mine: 2000 }] });
    assert.equal(mergeTracking(TRACKING, [{ op: 'set', item: 'water', date: '2026-04-10', field: 'amount', value: 2000, baseline: 1000 }], { force: true }).result, 'merged');
  });

  it('items: added, changed against the baseline, removed with their records; the result is validated', () => {
    const fresh: TrackedItem = { id: 'zinc', kind: 'supplement', name: 'Zinc', dose: '15 mg', when: 'evening', schedule: { kind: 'daily' }, reminder: { at: '21:30' }, start: '2026-04-11', source: { by: 'user', on: '2026-04-11' } };
    const add = mergeTracking(TRACKING, [{ op: 'put-item', item: fresh, baseline: null }]);
    assert.equal(add.result === 'merged' && add.doc.items.at(-1)!.id, 'zinc');
    const changed = { ...creatine, dose: '3 g' };
    assert.equal(mergeTracking(TRACKING, [{ op: 'put-item', item: changed, baseline: creatine }]).result, 'merged');
    assert.equal(mergeTracking(TRACKING, [{ op: 'put-item', item: changed, baseline: { ...creatine, dose: '4 g' } }]).result, 'conflict');
    assert.equal(mergeTracking(TRACKING, [{ op: 'put-item', item: changed, baseline: null }]).result, 'conflict', 'adding an id that exists');
    const gone = mergeTracking(TRACKING, [{ op: 'remove-item', id: 'water', baseline: doc.items.find((x) => x.id === 'water')! }]);
    assert.equal(gone.result, 'merged');
    if (gone.result === 'merged') assert.ok(Object.values(gone.doc.days).every((d) => !('water' in d)));
    const bad = mergeTracking(TRACKING, [{ op: 'put-item', item: { ...fresh, kind: 'amount' }, baseline: null }]);
    assert.equal(bad.result, 'invalid');
    assert.deepEqual(mergeTracking(TRACKING, [{ op: 'tick', item: 'ghost', date: '2026-04-10', done: true }]), { result: 'invalid', errors: ['no item with the id ghost'] });
  });

  it('suggestions accepted or dismissed, the settings, a missing file, another schema version', () => {
    const acc = mergeTracking(TRACKING, [{ op: 'decide', id: 'lights-out', state: 'accepted', on: '2026-04-11' }, { op: 'put-item', item: { ...doc.suggestions![0]!.item, source: { ...doc.suggestions![0]!.item.source, on: '2026-04-11' } }, baseline: null }]);
    assert.equal(acc.result, 'merged');
    if (acc.result === 'merged') assert.deepEqual([acc.doc.suggestions![0]!.state, acc.doc.suggestions![0]!.decided, acc.doc.items.at(-1)!.id], ['accepted', '2026-04-11', 'lights-out']);
    const set = mergeTracking(TRACKING, [{ op: 'settings', key: 'morning', value: { on: true, at: '07:00' }, baseline: { on: true, at: '07:30' } }]);
    assert.equal(set.result === 'merged' && set.doc.morning!.at, '07:00');
    assert.equal(mergeTracking(TRACKING, [{ op: 'settings', key: 'morning', value: { on: true, at: '07:00' }, baseline: { on: false, at: '07:30' } }]).result, 'conflict');
    const created = mergeTracking(null, [{ op: 'settings', key: 'bodyRecord', value: { schedule: 'fixed', tapeFrom: '2026-09-30', tapeEvery: 14, testsFrom: '2026-10-21', testsEvery: 28 }, baseline: null }]);
    assert.equal(created.result === 'merged' && created.doc.schemaVersion, 1);
    assert.match(String((mergeTracking('{"schemaVersion": 2, "items": [], "days": {}}', []) as { error?: string }).error), /refusing to write: the file is schema 2/);
    assert.equal(mergeTracking(TRACKING, [{ op: 'tick', item: 'creatine', date: '2026-04-10', done: true }]).result, 'unchanged');
  });
});

describe('Coach/nudges.json', () => {
  const today = '2026-04-10';

  it('an answer, a snooze, the repeating clock and a skipped occurrence, through answerCard', () => {
    const now = Date.parse('2026-04-10T12:20:00Z');
    const changes = [
      ...answerCard({ key: 'slot:after-log', kind: 'habits', date: today }, 'done', now, { by: 'Work Mac' }),
      ...answerCard({ key: 'amount:water', kind: 'amount', date: today }, 'done', now),
      ...answerCard({ key: 'tape', kind: 'tape', date: today, skipPeriod: { key: 'tape:2026-03-29', next: '2026-04-12' } }, 'skip-period', now),
    ];
    const r = mergeNudges(NUDGES, changes, { today });
    assert.equal(r.result, 'merged');
    if (r.result !== 'merged') return;
    assert.deepEqual(r.doc.days[today]!['slot:after-log'], { how: 'done', at: '2026-04-10T12:20:00.000Z', by: 'Work Mac' });
    assert.equal(r.doc.days[today]!['amount:water']!.lastAt, '2026-04-10T12:20:00.000Z');
    assert.equal(r.doc.skipped!['tape:2026-03-29'], '2026-04-10T12:20:00.000Z');
    assert.ok(landed(r.text, r.check));
  });

  it('the other Mac answered first: the same answer is "already", another is a conflict, a snooze over it is dropped', () => {
    const same = mergeNudges(NUDGES, [{ date: today, key: 'slot:09:00', set: { how: 'done', at: '2026-04-10T09:30:00.000Z' } }], { today });
    assert.deepEqual(same, { result: 'unchanged', already: ['slot:09:00'] });
    const other = mergeNudges(NUDGES, [{ date: today, key: 'slot:09:00', set: { how: 'skipped', at: '2026-04-10T09:30:00.000Z' } }], { today });
    assert.deepEqual(other, { result: 'conflict', conflicts: [{ what: 'slot:09:00 on 2026-04-10', disk: 'done', baseline: null, mine: 'skipped' }] });
    const snooze = mergeNudges(NUDGES, [{ date: today, key: 'morning', set: { snoozedUntil: '2026-04-10T08:00:00.000Z' } }], { today });
    assert.deepEqual(snooze, { result: 'unchanged', already: ['morning'] });
    const older = mergeNudges(NUDGES, [{ date: today, key: 'desk:desk-breaks', set: { lastAt: '2026-04-10T10:00:00.000Z' } }], { today });
    assert.deepEqual(older, { result: 'unchanged', already: [] }, 'the later last-break time is kept');
  });

  it('a new sitting stretch answers again; old days and old skips are pruned', () => {
    const n = j(NUDGES);
    n.days[today]['sitting:sitting:stretch'] = { how: 'done', at: '2026-04-10T09:00:00.000Z', for: '2026-04-10T08:05:00.000Z' };
    const r = mergeNudges(JSON.stringify(n), [{ date: today, key: 'sitting:sitting:stretch', set: { how: 'done', at: '2026-04-10T11:00:00.000Z', for: '2026-04-10T10:00:00.000Z' } }], { today });
    assert.equal(r.result === 'merged' && r.doc.days[today]!['sitting:sitting:stretch']!.for, '2026-04-10T10:00:00.000Z');
    const later = mergeNudges(NUDGES, [], { today: '2026-04-30' });
    assert.equal(later.result, 'merged');
    if (later.result === 'merged') assert.deepEqual(Object.keys(later.doc.days), []);
    const muchLater = mergeNudges(NUDGES, [], { today: '2026-09-01' });
    assert.equal(muchLater.result === 'merged' && Object.keys(muchLater.doc.skipped!).length, 0);
  });
});

describe('Coach/sitting.json', () => {
  it('a Mac updates its running stretch by its start and adds new ones; the other Mac\'s stay', () => {
    const r = mergeSitting(SITTING, 'Work Mac', [{ date: '2026-04-10', put: [{ start: '2026-04-10T11:10:00.000Z', end: '2026-04-10T12:30:00.000Z' }, { start: '2026-04-10T13:00:00.000Z', end: '2026-04-10T13:20:00.000Z' }] }]);
    assert.equal(r.result, 'merged');
    if (r.result !== 'merged') return;
    assert.deepEqual(r.doc.days['2026-04-10']!['Work Mac']!.slice(-2), [{ start: '2026-04-10T11:10:00.000Z', end: '2026-04-10T12:30:00.000Z' }, { start: '2026-04-10T13:00:00.000Z', end: '2026-04-10T13:20:00.000Z' }]);
    assert.deepEqual(r.doc.days['2026-04-10']!['Home Mac'], j(SITTING).days['2026-04-10']['Home Mac']);
    assert.ok(landed(r.text, r.check));
  });

  it('removes a short stretch; an empty day goes; a list changed under the same name is a conflict; overlaps are refused', () => {
    const r = mergeSitting(SITTING, 'Home Mac', [{ date: '2026-04-07', remove: ['2026-04-07T19:00:00.000Z'] }]);
    assert.equal(r.result === 'merged' && 'Home Mac' in r.doc.days['2026-04-07']!, false);
    const c = mergeSitting(SITTING, 'Work Mac', [{ date: '2026-04-10', put: [{ start: '2026-04-10T11:10:00.000Z', end: '2026-04-10T12:30:00.000Z' }], baseline: { '2026-04-10T11:10:00.000Z': '2026-04-10T11:40:00.000Z' } }]);
    assert.equal(c.result, 'conflict');
    const o = mergeSitting(SITTING, 'Work Mac', [{ date: '2026-04-10', put: [{ start: '2026-04-10T09:30:00.000Z', end: '2026-04-10T09:45:00.000Z' }] }]);
    assert.equal(o.result, 'invalid');
    assert.equal(mergeSitting(null, 'Work Mac', [{ date: '2026-04-10', put: [{ start: '2026-04-10T09:30:00.000Z', end: '2026-04-10T09:45:00.000Z' }] }]).result, 'merged');
  });
});

describe('reading the tracking files', () => {
  it('reads the fixture: the three Coach files, the body record, the habits, the photo folders, the timer', () => {
    const tr = readTracking(fsIo, VAULT, { configDir: '.obsidian' });
    assert.deepEqual(tr.files, { tracking: 'found', nudges: 'found', sitting: 'found', body: 'found', habits: 'found', nudgesSettings: 'found', workTimer: 'found' });
    assert.equal(tr.tracking!.items.length, 11);
    assert.deepEqual(tr.errors, []);
    assert.equal(nudgesSettingsPath('.obsidian/'), '.obsidian/plugins/habit-nudges/data.json');
    assert.equal(readTracking(fsIo, VAULT).files.nudgesSettings, 'missing', 'only with the config folder');
  });

  it('an invalid or unreadable Coach file is an error and reads as nothing; a link to an unknown habit warns', () => {
    const t = j(TRACKING);
    t.items[0].habit = 'creatine';
    const tr = assembleTracking({ tracking: JSON.stringify(t), nudges: '{', sitting: '{"schemaVersion": 1, "days": []}', habits: HABITS }, null);
    assert.equal(tr.tracking!.items[0]!.habit, 'creatine');
    assert.deepEqual(tr.warnings.map((w) => w.code), ['unknown-habit']);
    assert.deepEqual([tr.files.nudges, tr.files.sitting, tr.nudges, tr.sitting], ['invalid', 'invalid', null, null]);
    assert.deepEqual(tr.errors.map((e) => e.code), ['json', 'sitting']);
  });

  it('Pahlavan\'s quiet hours: its data.json under the config folder, field by field as the plugin loads it, else its defaults', () => {
    const at = (reminders: unknown) => quietHoursFrom(JSON.stringify({ version: 2, reminders })).hours;
    assert.deepEqual(quietHoursFrom(null), { hours: { on: true, from: '22:30', to: '07:00', source: 'default' }, didYouTrain: { on: true, at: '20:00' }, warnings: [] });
    // "Did you train today?" with them, field by field too.
    const train = (reminders: unknown) => quietHoursFrom(JSON.stringify({ version: 2, reminders })).didYouTrain;
    assert.deepEqual([train({ didYouTrain: false, didYouTrainAt: '21:15' }), train({ didYouTrainAt: '9:00' }), train(null)], [{ on: false, at: '21:15' }, { on: true, at: '20:00' }, { on: true, at: '20:00' }]);
    assert.deepEqual(at({ quiet: { on: false, from: '23:00', to: '06:30' } }), { on: false, from: '23:00', to: '06:30', source: 'settings' });
    assert.deepEqual(at({ quiet: { from: '21:00' } }), { on: true, from: '21:00', to: '07:00', source: 'settings' });
    assert.deepEqual(at({ quiet: { on: 'yes', from: '25:00', to: '7:00' } }), { on: true, from: '22:30', to: '07:00', source: 'settings' });
    assert.deepEqual(at(null), { on: true, from: '22:30', to: '07:00', source: 'settings' });
    const bad = quietHoursFrom('{');
    assert.deepEqual([bad.hours.source, bad.warnings.map((w) => w.code)], ['default', ['json']]);
    assert.equal(pahlavanSettingsPath('.obsidian/'), '.obsidian/plugins/pahlavan/data.json');
    const files = { 'v/.obsidian/plugins/pahlavan/data.json': JSON.stringify({ reminders: { quiet: { on: true, from: '22:00', to: '06:00' } } }) };
    assert.deepEqual(readQuietHours(memoryIo(files), 'v', '.obsidian').hours, { on: true, from: '22:00', to: '06:00', source: 'settings' });
    assert.equal(readQuietHours(fsIo, VAULT, '.obsidian').hours.source, 'default', 'the fixture has no Pahlavan data.json');
  });
});
