// The phone's inbox, pure: the entry format and its validator (validate's
// `inbox` kind), applyInbox on an in-memory copy of the synthetic vault
// (all made up), every kind applied through the screens' own merges, every
// refusal with its reason, the order entries apply in, the same entry twice
// applying once, refused.json, and phone.json (what the shortcuts read).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { morningFrom } from '../src/adapters/vault/body-write.ts';
import { readVault } from '../src/adapters/vault/read.ts';
import { readTracking } from '../src/adapters/vault/tracking-read.ts';
import { habitCheckinKey } from '../src/core/tracking.ts';
import { validateInboxEntry } from '../src/core/validate.ts';
import {
  applyInbox,
  appliedPath,
  buildPhone,
  INBOX_TEXT_KEYS,
  inboxTextPaths,
  isEntryFile,
  phoneText,
  readInboxEntry,
  readRefused,
  refusedOf,
  refusedText,
  type InboxApplied,
  type InboxPlan,
  type InboxRefused,
  type InboxResult,
  type InboxTexts,
} from '../src/report/inbox.ts';
import { run } from '../src/cli/cli.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

type Json = Record<string, any>;
const TODAY = '2026-04-10';
const P = (k: keyof InboxTexts) => `v/${inboxTextPaths()[k]}`;
const files = (edit: (f: Record<string, string>) => void = () => {}) => {
  const f = fixtureFiles('v');
  edit(f);
  return f;
};
const edit = (f: Record<string, string>, path: string, fn: (doc: Json) => void) => {
  const doc = JSON.parse(f[path]!);
  fn(doc);
  f[path] = JSON.stringify(doc, null, 2);
};
const inbox = (f: Record<string, string>, applied: string[] = [], today = TODAY) => {
  const io = memoryIo(f, today);
  return { read: readVault(io, 'v', { asOf: today }), tracking: readTracking(io, 'v'), texts: Object.fromEntries(INBOX_TEXT_KEYS.map((k) => [k, f[P(k)] ?? null])) as InboxTexts, applied };
};
let n = 0;
/** An entry file: the phone's name for it, from the time sent and the kind. */
const file = (e: Json, name?: string) => ({ file: name ?? `${String(e['at']).slice(0, 19).replace(/:/g, '-')}-${String(e['kind'])}-${++n}.json`, text: JSON.stringify(e) });
const at = (hhmm: string, date = TODAY) => `${date}T${hhmm}:00-04:00`;
const plan = (f: Record<string, string>, entries: Json[], opts: { applied?: string[]; today?: string } = {}): InboxPlan => applyInbox(inbox(f, opts.applied, opts.today), entries.map((e) => (typeof e['file'] === 'string' && typeof e['text'] === 'string' ? (e as { file: string; text: string }) : file(e))), opts.today ?? TODAY);
const one = (f: Record<string, string>, e: Json, opts: { applied?: string[]; today?: string } = {}) => plan(f, [e], opts).results[0]!;
const ok = (r: InboxResult): InboxApplied => {
  assert.notEqual(r.status, 'refused', r.status === 'refused' ? `${r.code}: ${r.reason}` : '');
  return r as InboxApplied;
};
const no = (r: InboxResult, code: string, reason?: RegExp): InboxRefused => {
  assert.equal(r.status, 'refused', `expected a refusal (${code}), got ${r.status}`);
  const x = r as InboxRefused;
  assert.equal(x.code, code, x.reason);
  if (reason) assert.match(x.reason, reason);
  return x;
};
const json = (t: string | null) => JSON.parse(t!) as Json;
/** The evening card's answer an entry writes. */
const how = (r: InboxApplied) => (r.writes.nudges![0] as { set: { how?: string } }).set.how;

const session = (date: string, type: string, extra: Json = {}, time = '19:02') => ({ v: 1, kind: 'session', at: at(time, date), date, session: { type, ...extra } });
const A = (date: string, more: Json = {}) => session(date, 'A', { lift1: { weight: 55, reps: 10 }, lift2: { weight: 60, reps: 6 }, durationMin: 52, ...more });
const tick = (ids: string[], more: Json = {}, time = '09:30') => ({ v: 1, kind: 'tick', at: at(time), date: TODAY, ids, ...more });
const amount = (id: string, add: number, time = '12:00', date = TODAY) => ({ v: 1, kind: 'amount', at: at(time, date), date, id, add });
const morning = (date: string, fields: Json, time = '07:05') => ({ v: 1, kind: 'morning', at: at(time, date), date, morning: fields });
const trained = (date: string, answer: string, time = '20:15') => ({ v: 1, kind: 'trained', at: at(time, date), date, answer });

describe('the entry format (validate\'s inbox kind)', () => {
  it('accepts each kind as the plan writes it', () => {
    for (const e of [A('2026-04-09'), session('2026-04-09', 'S1'), tick(['creatine']), tick(['creatine'], { done: false }), amount('water', 250), amount('water', -250), morning(TODAY, { energy: 4, sleepH: 7.3, steps: 8000, weight: 184, weightUnit: 'lb' }), trained(TODAY, 'rest')]) {
      assert.deepEqual(validateInboxEntry(e), [], JSON.stringify(e));
    }
    // UTC times are fine too; keys starting with _ are comments.
    assert.deepEqual(validateInboxEntry({ ...trained(TODAY, 'missed'), at: '2026-04-10T23:59:59.123Z', _from: 'Shortcuts' }), []);
  });

  it('says what is wrong, with the path', () => {
    const msg = (v: unknown) => validateInboxEntry(v).map((e) => `${e.path}: ${e.message}`);
    assert.deepEqual(msg([]), ['(root): expected an entry object: {"v": 1, "kind", "at", "date", ...}']);
    assert.deepEqual(msg({ v: 2, kind: 'water', at: at('08:00'), date: TODAY }), ['v: expected entry version 1, found 2', 'kind: expected one of: session, tick, amount, morning, trained']);
    assert.deepEqual(msg({ v: 1, at: at('08:00'), date: TODAY }), ['kind: is required: one of session, tick, amount, morning, trained']);
    assert.deepEqual(msg({ ...tick(['creatine']), v: '1' }), ['v: expected entry version 1, found "1"']);
    assert.deepEqual(msg({ ...tick(['creatine']), at: '2026-04-10 09:30' }), ['at: does not match /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d{1,3})?)?(Z|[+-]\\d{2}:\\d{2})$/']);
    assert.deepEqual(msg({ ...tick(['creatine']), at: '2026-02-31T09:30:00Z' }), ['at: is not a real moment']);
    assert.deepEqual(msg({ ...tick(['creatine']), date: '2026-4-10' }), ['date: expected a date as YYYY-MM-DD']);
    assert.deepEqual(msg(tick([])), ['ids: needs at least 1 item(s)']);
    assert.deepEqual(msg(tick(['creatine', 'Creatine'])), ['ids[1]: does not match /^[a-z0-9][a-z0-9-]*$/']);
    assert.deepEqual(msg(tick(['creatine', 'creatine'])), ['ids: lists creatine twice']);
    assert.deepEqual(msg(amount('water', 0)), ['add: is 0: an amount to add is more than 0 (or less, to take some off)']);
    assert.deepEqual(msg({ ...amount('water', 250), ids: ['water'] }), ['ids: unknown key']);
    assert.deepEqual(msg(session('2026-04-09', 'A', { rating: 11, lift1: { weight: 50, reps: 8.5 } })), ['session.rating: must be at most 10', 'session.lift1.reps: expected a whole number']);
    assert.deepEqual(msg({ v: 1, kind: 'session', at: at('19:00'), date: TODAY, session: {} }), ['session.type: is required']);
    assert.deepEqual(msg(morning(TODAY, {})), ['morning: holds no field: give any of energy, soreness, sleepQ, sleepH, rhr, hrv, weight, steps, floors']);
    assert.deepEqual(msg(morning(TODAY, { energy: 6, rhr: 52.5, steps: -1 })), ['morning.energy: must be at most 5', 'morning.rhr: expected a whole number', 'morning.steps: must be at least 0']);
    assert.deepEqual(msg(morning(TODAY, { hrv: 4 })), ['morning.hrv: must be at least 5']);
    assert.deepEqual(msg(morning(TODAY, { hrv: 48.5 })), ['morning.hrv: expected a whole number']);
    assert.deepEqual(msg(morning(TODAY, { rhr: 55, hrv: 48 })), []);
    assert.deepEqual(msg(morning(TODAY, { weight: 600, weightUnit: 'lb' })), ['morning.weight: is between 30 and 250 kg (66 and 551 lb)']);
    assert.deepEqual(msg(morning(TODAY, { energy: 3, weightUnit: 'lb' })), ['morning.weightUnit: goes with a weight']);
    assert.deepEqual(msg(trained(TODAY, 'yes')), ['answer: expected one of: trained, rest, missed']);
  });

  it('readInboxEntry keeps the kind and date of an invalid entry for the refusal, and names bad JSON', () => {
    assert.deepEqual(readInboxEntry(JSON.stringify(morning(TODAY, { energy: 9 }))), { error: 'morning.energy: must be at most 5', kind: 'morning', date: TODAY });
    const bad = readInboxEntry('{"v": 1, "kind": ');
    assert.ok('error' in bad && /^not valid JSON/.test(bad.error));
  });

  it('entry files are the .json files in the inbox, apart from its own two', () => {
    assert.deepEqual(['2026-04-10T19-02-00-session.json', 'phone.json', 'refused.json', 'applied', 'notes.md', '.DS_Store', '.2026.json'].filter(isEntryFile), ['2026-04-10T19-02-00-session.json']);
    assert.equal(appliedPath('2026-04-09', 'x.json'), 'applied/2026-04/x.json');
  });
});

describe('applyInbox: a session, as the Log panel saves it', () => {
  it('logs a lifting session with the plan\'s lift names and units, the Workout tick after it', () => {
    const f = files((x) => edit(x, P('habits'), (h) => delete h['checkins'][habitCheckinKey('workout', '2026-04-09')]));
    const p = plan(f, [A('2026-04-09')]);
    const r = ok(p.results[0]!);
    assert.equal(r.status, 'apply');
    assert.equal(r.moveTo, `applied/2026-04/${r.file}`);
    const e = r.writes.session!;
    assert.deepEqual([e['date'], e['type'], e['lift1'], e['lift2'], e['durationMin'], e['rating'], e['notes']], ['2026-04-09', 'A', { name: 'Goblet Squat', weight: 55, reps: 10, unit: 'lb' }, { name: 'Flat DB Bench Press', weight: 60, reps: 6, unit: 'lb' }, 52, null, '']);
    assert.ok(Array.isArray(e['exercises']) && (e['exercises'] as unknown[]).length > 2, 'the plan snapshot, as the Log panel freezes it');
    assert.equal(r.note, 'Full Body A on Thu 9 Apr: Goblet Squat 55 lb x 10, Flat DB Bench Press 60 lb x 6, and the Workout habit ticked.');
    assert.deepEqual(p.changed, ['log', 'habits']);
    assert.ok(json(p.texts.log).sessions.some((s: Json) => s.date === '2026-04-09' && s.type === 'A'));
    assert.equal(json(p.texts.habits).checkins[habitCheckinKey('workout', '2026-04-09')], '1');
  });

  it('takes a lift\'s own unit from the plan, a unit sent, Express, rating and notes', () => {
    const r = ok(one(files(), session('2026-04-09', 'B', { lift1: { weight: 72.5, reps: 8 }, lift2: { weight: 50, reps: 12, unit: 'kg' }, express: true, rating: 8, notes: ' felt strong ' })));
    const e = r.writes.session!;
    assert.deepEqual([e['lift1'], e['lift2'], e['express'], e['rating'], e['notes']], [{ name: 'Romanian Deadlift', weight: 72.5, reps: 8, unit: 'kg' }, { name: 'Seated Cable Row', weight: 50, reps: 12, unit: 'kg' }, true, 8, 'felt strong']);
    assert.match(r.note, /^Full Body B \(Express\) on Thu 9 Apr/);
  });

  it('logs a short session with no lifts', () => {
    const r = ok(one(files(), session('2026-04-09', 'S3', { durationMin: 25 })));
    assert.deepEqual([r.writes.session!['type'], r.writes.session!['lift1'], r.writes.session!['durationMin']], ['S3', null, 25]);
  });

  it('refuses a session the plan does not hold, missing lifts, lifts on a short day, Express on a short day', () => {
    no(one(files(), session('2026-04-09', 'C')), 'unknown-type', /^C is not one of the plan's sessions \(A, B, S1, S3\)$/);
    no(one(files(), session('2026-04-09', 'A', { lift1: { weight: 55, reps: 10 } })), 'invalid', /^Full Body A logs its top sets for lift1, Goblet Squat and lift2, Flat DB Bench Press: the entry has no lift2 \(Flat DB Bench Press\)$/);
    no(one(files(), session('2026-04-09', 'S1', { lift1: { weight: 55, reps: 10 } })), 'invalid', /^a S1 session has no logged lifts$/);
    no(one(files(), session('2026-04-09', 'S1', { express: true })), 'invalid', /^only a lifting session can be Express$/);
    no(one(files((x) => delete x['v/3-Personal/Fitness/plan-data.json']), A('2026-04-09')), 'unknown-type', /no plan/);
  });

  it('refuses a session already logged for that date and type ("already"), and an unreadable log', () => {
    no(one(files(), A('2026-04-08')), 'already', /^Full Body A is logged on Wed 8 Apr already: the log keeps that one \(open it in Pahlavan to change it\), so delete this entry$/);
    no(one(files((x) => (x[P('log')] = '{"sessions": [')), A('2026-04-09')), 'unreadable', /fitness-log-data.json is not valid JSON/);
  });
});

describe('applyInbox: a session at Every set (the gym page\'s), as log add saves it', () => {
  // What the gym page sends for A: every set by exercise (each part of the pair its own), a line skipped and why.
  const GYM = {
    lift1: { weight: 55, reps: 10 },
    lift2: { weight: 60, reps: 6, unit: 'lb' },
    durationMin: 52,
    cardioMin: 8,
    notes: 'gym page',
    trackingLevel: 'full',
    exerciseSets: [
      { name: 'Goblet Squat', sets: [{ weight: 55, unit: 'lb', reps: 10, rir: 2 }, { weight: 55, unit: 'lb', reps: 10, rir: null }, { weight: 55, unit: 'lb', reps: 9 }] },
      { name: 'Flat DB Bench Press', sets: [{ weight: 60, unit: 'lb', reps: 6, rir: 1 }, { weight: 60, unit: 'lb', reps: 6 }] },
      { name: 'Face Pull', sets: [{ weight: 30, unit: 'lb', reps: 15 }] },
      { name: 'Band External Rotation', sets: [{ weight: null, unit: null, reps: 15, rir: null }] },
    ],
    skipped: ['Zone 2 finisher'],
    skipWhy: { 'Zone 2 finisher': 'time' },
    _say: 'A · 7 sets',
  };
  const gym = (more: Json = {}, time = '19:02') => session(TODAY, 'A', { ...GYM, ...more }, time);
  const LOG_PATH = P('log');
  /** The same session through `engine log add --write`: its lifts named, everything else as the page sent it. */
  const logAdd = (f: Record<string, string>, more: Json = {}) => {
    const { _say: _s, lift1, lift2, ...rest } = { ...GYM, ...more };
    f['v/s.json'] = JSON.stringify({ date: TODAY, type: 'A', lift1: { name: 'Goblet Squat', ...lift1 }, lift2: { name: 'Flat DB Bench Press', ...lift2 }, ...rest });
    const io = { ...memoryIo(f, TODAY), writeLog: (_r: string, t: string) => void (f[LOG_PATH] = t), writeHabits: (_r: string, t: string) => void (f[P('habits')] = t) };
    const r = run(['log', 'add', '--file', 'v/s.json', '--vault', 'v', '--write'], io as never);
    assert.equal(r.code, 0, r.stdout);
    return JSON.parse(r.stdout) as Json;
  };

  it('is a valid entry, `_say` and all', () => {
    assert.deepEqual(validateInboxEntry(gym()), []);
  });

  it('gives the same log entry as log add, and the same log file (Today\'s ticks too)', () => {
    const viaCli = files();
    const out = logAdd(viaCli);
    const p = plan(files(), [gym()]);
    const r = ok(p.results[0]!);
    assert.deepEqual(r.writes.session, out['session']);
    assert.equal(p.texts.log, viaCli[LOG_PATH]);
    const e = r.writes.session!;
    assert.deepEqual([e['trackingLevel'], e['cardioMin'], e['checklist']], ['full', 8, { done: 4, total: 5, skipped: ['Zone 2 finisher'], why: { 'Zone 2 finisher': 'time' } }]);
    assert.deepEqual((e['exerciseSets'] as Json[]).map((x) => [x['name'], x['sets'].length]), [['Goblet Squat', 3], ['Flat DB Bench Press', 2], ['Face Pull', 1], ['Band External Rotation', 1]]);
    assert.deepEqual(json(p.texts.log).todayChecklist, { date: TODAY, type: 'A', express: false, checked: [true, true, true, true, false], picked: false });
    assert.equal(r.writes.sessionTicks, true);
    assert.equal(r.note, 'Full Body A on Fri 10 Apr: 7 sets, Goblet Squat 55 lb x 10, Flat DB Bench Press 60 lb x 6.');
  });

  it('refuses what log add refuses, with its message, and what the format does not take', () => {
    const sets = (x: Json[]) => gym({ exerciseSets: [...GYM.exerciseSets, ...x] });
    no(one(files(), sets([{ name: 'Back Squat', sets: [{ weight: 60, unit: 'lb', reps: 5 }] }])), 'invalid', /^Back Squat is not an item of A on Fri 10 Apr \(a swap names the plan's item as "planned"\); its items: /);
    no(one(files(), gym({ exerciseSets: [{ name: 'Goblet Squat', sets: [{ weight: 55, reps: 2.5 }] }] })), 'invalid', /^session\.exerciseSets\[0\]\.sets\[0\]\.reps: expected a whole number$/);
    no(one(files(), gym({ exerciseSets: [{ name: 'Goblet Squat', sets: [{ weight: 55, reps: 10, rir: 11 }] }] })), 'invalid', /^session\.exerciseSets\[0\]\.sets\[0\]\.rir: must be at most 10$/);
    no(one(files(), gym({ skipWhy: { 'Zone 2 finisher': 'tired' } })), 'invalid', /^session\.skipWhy\.Zone 2 finisher: expected one of: time, pain, equipment, energy$/);
    no(one(files(), gym({ skipWhy: { 'Goblet Squat': 'pain' } })), 'invalid', /^"skipWhy" gives a reason for "Goblet Squat", which is not skipped: a reason goes with a line in "skipped"$/);
    no(one(files(), gym({ skipped: ['Burpees'], skipWhy: {} })), 'invalid', /^"Burpees" is not a line of A on Fri 10 Apr/);
    no(one(files(), gym({ exerciseSets: GYM.exerciseSets.slice(1) })), 'invalid', /^lift1 Goblet Squat has a top set but no sets in "exerciseSets"/);
    no(one(files(), gym({ exerciseSets: undefined })), 'invalid', /^"trackingLevel": "full" needs "exerciseSets"/);
    no(one(files(), gym({ trackingLevel: 'standard' })), 'invalid', /^session\.trackingLevel: expected one of: full$/);
    no(one(files(), gym({ cardioMin: 601 })), 'invalid', /^session\.cardioMin: must be at most 600$/);
    // The Every set fields go with trackingLevel: an entry without it is the old one, which never takes them.
    no(one(files(), session(TODAY, 'A', { lift1: GYM.lift1, lift2: GYM.lift2, skipped: ['Zone 2 finisher'] })), 'invalid', /^session\.skipped: goes with "trackingLevel": "full"/);
    // Still the phone's own checks first: its logged lifts.
    no(one(files(), gym({ lift2: undefined })), 'invalid', /the entry has no lift2 \(Flat DB Bench Press\)$/);
  });

  // A swap as the Log panel sends it: the lift done named, the plan's as `planned`; a superset part's in `swaps` and on its sets.
  const SWAPPED = {
    lift1: { name: 'Front Squat', planned: 'Goblet Squat', swapWhy: 'soreness', weight: 75, reps: 8 },
    exerciseSets: [
      { name: 'Front Squat', planned: 'Goblet Squat', sets: [{ weight: 75, unit: 'lb', reps: 8 }, { weight: 70, unit: 'lb', reps: 8 }] },
      ...GYM.exerciseSets.slice(1, 3),
      { name: 'Cable External Rotation', planned: 'Band External Rotation', sets: [{ weight: 10, unit: 'lb', reps: 15 }] },
    ],
    swaps: [{ from: 'Band External Rotation', to: 'Cable External Rotation', why: 'mine' }],
  };

  it('takes a swap as log add does: a lift done in the plan\'s place with its reason, and the other swaps', () => {
    assert.deepEqual(validateInboxEntry(gym(SWAPPED)), []);
    const viaCli = files();
    const out = logAdd(viaCli, SWAPPED);
    const p = plan(files(), [gym(SWAPPED)]);
    const r = ok(p.results[0]!);
    assert.deepEqual(r.writes.session, out['session']);
    assert.equal(p.texts.log, viaCli[LOG_PATH]);
    const e = r.writes.session! as Json;
    assert.deepEqual([e['lift1']['name'], e['lift1']['planned'], e['lift1']['swapWhy']], ['Front Squat', 'Goblet Squat', 'soreness']);
    assert.deepEqual(e['swaps'], [{ from: 'Band External Rotation', to: 'Cable External Rotation', why: 'mine' }]);
    assert.deepEqual((e['exerciseSets'] as Json[]).map((x) => [x['name'], x['planned'] ?? null]), [['Front Squat', 'Goblet Squat'], ['Flat DB Bench Press', null], ['Face Pull', null], ['Cable External Rotation', 'Band External Rotation']]);
  });

  it('refuses a swapped lift that is not the plan\'s logged item, and the swap fields the format does not take', () => {
    // log add's own check: the plan's logged item is the lift's `planned` (or its name, without one).
    no(one(files(), gym({ ...SWAPPED, lift1: { ...SWAPPED.lift1, planned: 'Flat DB Bench Press' } })), 'invalid', /^lift1 of A is Goblet Squat; got 'Front Squat' planned as 'Flat DB Bench Press'$/);
    no(one(files(), gym({ ...SWAPPED, lift1: { name: 'Front Squat', weight: 75, reps: 8 } })), 'invalid', /^lift1 of A is Goblet Squat; got 'Front Squat'$/);
    const msg = (more: Json) => validateInboxEntry(gym(more)).map((x) => `${x.path}: ${x.message}`);
    assert.deepEqual(msg({ lift1: { planned: 'Goblet Squat', weight: 55, reps: 10 } }), ['session.lift1.planned: goes with "name": a swap names the lift done and the plan\'s it replaces']);
    assert.deepEqual(msg({ lift1: { ...GYM.lift1, swapWhy: 'mine' } }), ['session.lift1.swapWhy: goes with "planned": a swap\'s reason']);
    assert.deepEqual(msg({ lift1: { ...SWAPPED.lift1, swapWhy: 'Injury limit' } }), ['session.lift1.swapWhy: expected one of: mine, ledger, soreness, hotel']);
    assert.deepEqual(msg({ swaps: [{ from: 'Band External Rotation', why: 'equipment' }] }), ['session.swaps[0].to: is required', 'session.swaps[0].why: expected one of: mine, ledger, soreness, hotel']);
  });

  it('refuses the swap fields on an entry without trackingLevel (the old one never took them) rather than drop them', () => {
    const old = session(TODAY, 'A', { lift1: SWAPPED.lift1, lift2: GYM.lift2, swaps: SWAPPED.swaps });
    assert.deepEqual(validateInboxEntry(old).map((x) => `${x.path}: ${x.message}`), [
      'session.swaps: goes with "trackingLevel": "full" (a session logged at Every set)',
      'session.lift1.name: goes with "trackingLevel": "full" (a session logged at Every set)',
      'session.lift1.planned: goes with "trackingLevel": "full" (a session logged at Every set)',
      'session.lift1.swapWhy: goes with "trackingLevel": "full" (a session logged at Every set)',
    ]);
    no(one(files(), session(TODAY, 'A', { lift1: { name: 'Goblet Squat', weight: 55, reps: 10 }, lift2: GYM.lift2 })), 'invalid', /^session\.lift1\.name: goes with "trackingLevel": "full"/);
  });

  it('a resend (the same session sent again) is there already: the log keeps the first', () => {
    const p = plan(files(), [gym()]);
    const f = files((x) => (x[P('log')] = p.texts.log!));
    no(one(f, gym({}, '19:05')), 'already', /^Full Body A is logged on Fri 10 Apr already/);
    // In the same run too: the later copy finds the first.
    const both = plan(files(), [gym(), gym({}, '19:05')]);
    ok(both.results[0]!);
    no(both.results[1]!, 'already', /^Full Body A is logged on Fri 10 Apr already/);
  });

  it('an entry without trackingLevel keeps the old path: no checklist, no Today\'s ticks', () => {
    const p = plan(files(), [session(TODAY, 'A', { lift1: GYM.lift1, lift2: GYM.lift2, durationMin: 52 })]);
    const r = ok(p.results[0]!);
    assert.deepEqual(Object.keys(r.writes), ['session']);
    assert.deepEqual([r.writes.session!['checklist'], r.writes.session!['trackingLevel'], r.writes.session!['exerciseSets']], [undefined, undefined, undefined]);
    assert.deepEqual(json(p.texts.log).todayChecklist, json(files()[P('log')]!).todayChecklist);
    assert.equal(r.note, 'Full Body A on Fri 10 Apr: Goblet Squat 55 lb x 10, Flat DB Bench Press 60 lb x 6.');
  });
});

describe('applyInbox: ticks and amounts, as Due today writes them', () => {
  it('ticks with the time sent, the linked habit with them; one already done is left as it is', () => {
    const p = plan(files(), [tick(['multivitamin', 'protein', 'creatine'])]);
    const r = ok(p.results[0]!);
    assert.deepEqual(r.writes.tracking, [
      { op: 'tick', item: 'multivitamin', date: TODAY, done: true, at: '2026-04-10T13:30:00.000Z' },
      { op: 'tick', item: 'protein', date: TODAY, done: true, at: '2026-04-10T13:30:00.000Z' },
    ]);
    assert.deepEqual(r.writes.habits, [{ habit: 'protein', date: TODAY, tick: true }]);
    assert.match(r.note, /Creatine is done on 2026-04-10 already/);
    const t = json(p.texts.tracking).days[TODAY];
    assert.deepEqual([t.multivitamin, t.protein], [{ done: true, at: '2026-04-10T13:30:00.000Z' }, { done: true, at: '2026-04-10T13:30:00.000Z' }]);
    assert.equal(json(p.texts.habits).checkins[habitCheckinKey('protein', TODAY)], '1');
  });

  it('a tick there already moves on with nothing to write; done false unticks', () => {
    const same = ok(one(files(), tick(['creatine'])));
    assert.deepEqual([same.status, same.writes], ['unchanged', {}]);
    const off = ok(one(files(), tick(['creatine'], { done: false })));
    assert.deepEqual(off.writes.tracking, [{ op: 'tick', item: 'creatine', date: TODAY, done: false, at: '2026-04-10T13:30:00.000Z' }]);
  });

  it('refuses unknown ids, an amount or a counted item sent as a tick, an item not started; a paused one is ticked with a warning', () => {
    no(one(files(), tick(['creatin', 'zinc'])), 'unknown-item', /^creatin and zinc are not tracked \(the ticks: creatine, multivitamin, shake, fish-oil, magnesium, protein, flossing\)$/);
    no(one(files(), tick(['water'])), 'invalid', /^Water is an amount: send it as an amount entry$/);
    no(one(files(), tick(['stand-ups'])), 'invalid', /Pahlavan counts it on each Mac, so it is not ticked from the phone/);
    no(one(files((x) => edit(x, P('tracking'), (t) => (t.items.find((i: Json) => i.id === 'flossing').start = '2026-04-11'))), tick(['flossing'])), 'not-started', /^Flossing starts 2026-04-11: 2026-04-10 is before it$/);
    const paused = ok(one(files(), tick(['fish-oil'])));
    assert.deepEqual(paused.warnings, ['Fish oil is paused on 2026-04-10; ticked anyway, as asked']);
    no(one(files((x) => delete x[P('tracking')]), tick(['creatine'])), 'unknown-item', /nothing is tracked yet/);
    no(one(files((x) => (x[P('tracking')] = '{"schemaVersion": 1, "items": [{}], "days": {}}')), tick(['creatine'])), 'unreadable', /Coach\/tracking.json is invalid.*fix it first/);
  });

  it('adds an amount to the day, and the same to the linked habit', () => {
    const p = plan(files(), [amount('water', 250)]);
    const r = ok(p.results[0]!);
    assert.deepEqual(r.writes.tracking, [{ op: 'add', item: 'water', date: TODAY, field: 'amount', delta: 250, at: '2026-04-10T16:00:00.000Z' }]);
    assert.deepEqual(r.writes.habits, [{ habit: 'water', date: TODAY, add: 250 }]);
    assert.equal(r.note, 'Water: +250 mL on Fri 10 Apr, 1500 of 2500 mL now, and the same on the Water (mL) habit.');
    assert.equal(json(p.texts.tracking).days[TODAY].water.amount, 1500);
    assert.equal(json(p.texts.habits).checkins[habitCheckinKey('water', TODAY)], '250');
  });

  it('refuses an unknown amount, a tick sent as an amount', () => {
    no(one(files(), amount('juice', 250)), 'unknown-item', /^juice is not tracked \(the amounts: water\)$/);
    no(one(files(), amount('creatine', 1)), 'invalid', /^Creatine is a supplement: send it as a tick entry$/);
  });
});

describe('applyInbox: the morning check-in, as its card saves it', () => {
  const day = '2026-04-12';
  const fresh = () => files((x) => edit(x, P('body'), (b) => {
    delete b.days[day];
    delete b.days['2026-04-11'].steps;
  }));

  it('writes the fields on their days (steps and floors on the day before), checkedAt from the time sent, the weight in kg', () => {
    const p = plan(fresh(), [morning(day, { energy: 4, soreness: 2, sleepQ: 3, sleepH: 7.3, rhr: 55, hrv: 48, weight: 183.9, weightUnit: 'lb', steps: 10450, floors: 6 })], { today: day });
    const r = ok(p.results[0]!);
    assert.deepEqual(r.writes.morning, { values: { energy: 4, soreness: 2, sleepQ: 3, sleepH: 7.3, rhr: 55, hrv: 48, weight: 83.4, steps: 10450, floors: 6 }, baseline: {}, checkedAt: '2026-04-12T11:05:00.000Z' });
    const body = json(p.texts.body);
    assert.deepEqual(morningFrom(body, day).values, { energy: 4, soreness: 2, sleepQ: 3, sleepH: 7.3, rhr: 55, hrv: 48, weight: 83.4, steps: 10450, floors: 6 });
    assert.equal(body.days[day].checkedAt, '2026-04-12T11:05:00.000Z');
    assert.equal(body.days['2026-04-11'].steps, 10450);
    assert.match(r.note, /^The morning check-in for Sun 12 Apr: Energy, Soreness, Sleep quality, Sleep, Resting HR, HRV, Weight, Steps yesterday, Floors yesterday \(Steps yesterday and Floors yesterday on Sat 11 Apr, the day they count for\)\.$/);
  });

  it('the same values again move on with nothing to write; another value on record is a conflict, nothing written', () => {
    const same = ok(one(files(), morning(TODAY, { energy: 2, rhr: 68 })));
    assert.deepEqual([same.status, same.writes], ['unchanged', {}]);
    const c = no(one(files(), morning(TODAY, { energy: 4, rhr: 68, steps: 9000 })), 'conflict');
    assert.equal(c.reason, 'Energy on Fri 10 Apr is 2 in body-data.json, the phone says 4; Steps yesterday on Thu 9 Apr is 9184 in body-data.json, the phone says 9000: nothing was written (change it on the Check-in screen if the phone\'s is right, then delete this entry)');
  });

  it('Health numbers alone (steps, resting HR) fill their fields and leave the check-in open for the card', () => {
    const p = plan(fresh(), [morning(day, { rhr: 58, steps: 9120 })], { today: day });
    const r = ok(p.results[0]!);
    assert.equal(r.writes.morning!.checkedAt, undefined);
    const body = json(p.texts.body);
    assert.equal(body.days[day].rhr, 58);
    assert.equal(body.days['2026-04-11'].steps, 9120);
    assert.equal(body.days[day].checkedAt, undefined, 'the card still asks energy, soreness and sleep quality');
    // One of the card's own questions makes it done.
    const q = plan(fresh(), [morning(day, { sleepQ: 4, rhr: 58 })], { today: day });
    assert.equal(json(q.texts.body).days[day].checkedAt, '2026-04-12T11:05:00.000Z');
  });

  it('keeps the checkedAt already there', () => {
    const p = plan(files((x) => edit(x, P('body'), (b) => delete b.days[TODAY].energy)), [morning(TODAY, { energy: 2 })]);
    ok(p.results[0]!);
    assert.equal(json(p.texts.body).days[TODAY].checkedAt, '2026-04-10T07:10:00.000Z');
  });
});

describe('applyInbox: "Did you train today?", as its card answers it', () => {
  const free = '2026-04-05'; // a Sunday: nothing logged, ticked, marked or answered
  it('rest and missed: the day\'s mark and the card\'s answer', () => {
    const p = plan(files(), [trained(free, 'rest')]);
    const r = ok(p.results[0]!);
    assert.deepEqual(r.writes, { mark: 'rest', nudges: [{ date: free, key: 'train', set: { how: 'rest', at: '2026-04-06T00:15:00.000Z', by: 'phone' } }] });
    assert.equal(r.note, 'Sun 5 Apr, a rest day: marked rest and "Did you train today?" answered Rest day.');
    assert.equal(json(p.texts.body).days[free].mark, 'rest');
    assert.equal(json(p.texts.nudges).days[free].train.how, 'rest');
    const m = ok(one(files(), trained(free, 'missed')));
    assert.deepEqual([m.writes.mark, how(m)], ['missed', 'not-today']);
  });

  it('trained: the Workout tick and the card\'s answer; a logged session is trained already', () => {
    const r = ok(one(files(), trained(free, 'trained')));
    assert.deepEqual([r.writes.workout, how(r), r.writes.mark], [true, 'logged', undefined]);
    const logged = ok(one(files(), trained('2026-04-08', 'trained')));
    assert.deepEqual([logged.status, logged.note], ['unchanged', 'A session is logged on Wed 8 Apr: it counts as trained already.']);
  });

  it('never writes over what the day holds: a session, the Workout tick, another mark or another answer', () => {
    no(one(files(), trained('2026-04-08', 'rest')), 'conflict', /^a session is logged on Wed 8 Apr, the phone says rest: nothing was written$/);
    no(one(files(), trained('2026-04-09', 'missed')), 'conflict', /answered Log session on the Mac, the phone says missed/);
    const marked = files((x) => edit(x, P('body'), (b) => (b.days[free] = { mark: 'rest' })));
    no(one(marked, trained(free, 'trained')), 'conflict', /^Sun 5 Apr is marked rest, the phone says trained/);
    no(one(marked, trained(free, 'missed')), 'conflict', /^Sun 5 Apr is marked rest, the phone says missed/);
    const ticked = files((x) => edit(x, P('habits'), (h) => (h.checkins[habitCheckinKey('workout', free)] = '1')));
    no(one(ticked, trained(free, 'rest')), 'conflict', /^the Workout habit is ticked on Sun 5 Apr/);
  });

  it('the same answer on record moves on with nothing to write', () => {
    const f = files((x) => {
      edit(x, P('body'), (b) => (b.days[free] = { mark: 'rest' }));
      edit(x, P('nudges'), (nd) => (nd.days[free] = { train: { how: 'rest', at: '2026-04-05T20:00:00.000Z', by: 'Work Mac' } }));
    });
    const r = ok(one(f, trained(free, 'rest')));
    assert.deepEqual([r.status, r.note], ['unchanged', 'Sun 5 Apr is a rest day on record already.']);
  });
});

describe('applyInbox: the day, copies and the order', () => {
  it('refuses a day after today, and one more than 14 days back ("log it in Pahlavan"); 14 days back applies', () => {
    no(one(files(), tick(['multivitamin'], { date: '2026-04-11' })), 'future', /^Sat 11 Apr \(2026-04-11\) is after today: the entry imports on the day itself$/);
    no(one(files(), trained('2026-03-26', 'rest')), 'too-old', /^Thu 26 Mar \(2026-03-26\) is more than 14 days back: log it in Pahlavan, where the form shows what that day holds$/);
    ok(one(files(), trained('2026-03-27', 'rest')));
  });

  it('refuses an unreadable entry file, with its name', () => {
    const p = plan(files(), [{ file: 'broken.json', text: '{"v": 1,' }, { file: 'odd.json', text: JSON.stringify({ ...tick(['creatine']), v: 3 }) }]);
    no(p.results[0]!, 'invalid', /^not valid JSON/);
    const odd = no(p.results[1]!, 'invalid', /^v: expected entry version 1, found 3$/);
    assert.deepEqual([odd.kind, odd.date], ['tick', TODAY]);
  });

  it('applies the same entry once: a second copy, an entry imported before, an amount counted already', () => {
    const e = amount('water', 250);
    const p = plan(files(), [file(e, 'a.json'), file(e, 'b.json')]);
    ok(p.results[0]!);
    no(p.results[1]!, 'already', /^the same entry as a.json, which applies once: delete this copy$/);
    assert.equal(json(p.texts.tracking).days[TODAY].water.amount, 1500);
    // Imported before: its applied/ file is there.
    no(one(files(), file(e, 'a.json'), { applied: ['applied/2026-04/a.json'] }), 'already', /^imported before \(3-Personal\/Fitness\/Coach\/Inbox\/applied\/2026-04\/a.json\)/);
    // On the files as the first import left them, under another name: the day's last change carries its time.
    const after = files((x) => {
      for (const k of p.changed) x[P(k)] = p.texts[k]!;
    });
    no(one(after, file(e, 'c.json')), 'already', /^Water on Fri 10 Apr was last changed by this entry \(sent 2026-04-10T12:00:00-04:00\): it is counted already/);
    // Two amounts sent at different times both count.
    const two = plan(files(), [amount('water', 250, '12:00'), amount('water', 500, '12:30')]);
    assert.equal(json(two.texts.tracking).days[TODAY].water.amount, 2000);
  });

  it('applying the whole inbox again on what it wrote changes nothing', () => {
    const entries = [A('2026-04-09'), tick(['multivitamin', 'protein']), morning('2026-04-12', { energy: 4 }), trained('2026-04-05', 'rest'), amount('water', 250)].map((e) => file(e));
    const f = files((x) => edit(x, P('body'), (b) => delete b.days['2026-04-12']));
    const first = applyInbox(inbox(f, [], '2026-04-12'), entries, '2026-04-12');
    assert.deepEqual(first.results.map((r) => r.status), ['apply', 'apply', 'apply', 'apply', 'apply']);
    for (const k of first.changed) f[P(k)] = first.texts[k]!;
    const again = applyInbox(inbox(f, [], '2026-04-12'), entries, '2026-04-12');
    assert.deepEqual(again.changed, []);
    // In the order sent: the rest day, the session (logged already), the ticks, the water (counted already), the morning.
    assert.deepEqual(again.results.map((r) => (r.status === 'refused' ? r.code : r.status)), ['unchanged', 'already', 'unchanged', 'already', 'unchanged']);
  });

  it('applies in the order sent (not by file name), each on what the ones before left', () => {
    const early = morning('2026-04-12', { energy: 4 }, '07:00');
    const late = morning('2026-04-12', { energy: 3 }, '07:30');
    const f = files((x) => edit(x, P('body'), (b) => delete b.days['2026-04-12']));
    const p = applyInbox(inbox(f, [], '2026-04-12'), [file(late, 'a-late.json'), file(early, 'z-early.json')], '2026-04-12');
    assert.deepEqual(p.results.map((r) => r.file), ['z-early.json', 'a-late.json']);
    ok(p.results[0]!);
    no(p.results[1]!, 'conflict', /^Energy on Sun 12 Apr is 4 in body-data.json, the phone says 3/);
  });
});

describe('refused.json', () => {
  it('lists each refusal by file with its date, kind, code and reason; the same refusals give the same text', () => {
    const p = plan(files(), [file(A('2026-04-08'), 'b.json'), file(tick(['zinc']), 'a.json'), file(tick(['multivitamin']), 'c.json')]);
    const list = refusedOf(p.results);
    assert.deepEqual(list.map((r) => [r.file, r.date, r.kind, r.code]), [['a.json', TODAY, 'tick', 'unknown-item'], ['b.json', '2026-04-08', 'session', 'already']]);
    const text = refusedText(list);
    assert.equal(text, refusedText(refusedOf(plan(files(), [file(A('2026-04-08'), 'b.json'), file(tick(['zinc']), 'a.json')]).results)));
    assert.deepEqual(JSON.parse(text).v, 1);
    assert.deepEqual(readRefused(text), list);
    assert.deepEqual([readRefused(null), readRefused('{oops'), readRefused('{"refused": [{"file": 1}]}')], [[], [], []]);
  });
});

describe('phone.json', () => {
  const phone = (f = files(), date = TODAY) => {
    const io = memoryIo(f, date);
    return buildPhone(readVault(io, 'v', { asOf: date }), readTracking(io, 'v'), date);
  };

  it('today\'s items with what is open, the plan\'s sessions with their logged lifts, the next, the morning\'s fields', () => {
    const p = phone();
    assert.deepEqual([p.v, p.date], [1, TODAY]);
    assert.deepEqual(p.items.find((x) => x.id === 'creatine'), { id: 'creatine', name: 'Creatine', kind: 'supplement', dose: '5 g', done: true });
    assert.deepEqual(p.items.find((x) => x.id === 'water'), { id: 'water', name: 'Water', kind: 'amount', unit: 'mL', value: 1250, target: 2500, quick: [250, 500], done: false });
    assert.deepEqual(p.items.find((x) => x.id === 'protein'), { id: 'protein', name: 'Protein', kind: 'tick', done: false });
    assert.ok(!p.items.some((x) => x.id === 'fish-oil' || x.id === 'stand-ups'), 'paused and counted items are not the phone\'s');
    assert.deepEqual(p.open, ['multivitamin', 'shake', 'magnesium', 'protein', 'flossing', 'water']);
    assert.deepEqual(p.sessions.map((s) => [s.type, s.name, s.kind, s.express]), [['A', 'Full Body A', 'lift', true], ['B', 'Full Body B', 'lift', true], ['S1', 'Short 1 · Skills', 'short', false], ['S3', 'Short 3 · Conditioning', 'short', false]]);
    assert.deepEqual(p.sessions[1]!.lifts, [
      { slot: 'lift1', name: 'Romanian Deadlift', unit: 'kg', last: { date: '2026-04-11', weight: 70, reps: 8, unit: 'kg' } },
      { slot: 'lift2', name: 'Seated Cable Row', unit: 'lb', last: { date: '2026-04-11', weight: 120, reps: 10, unit: 'lb' } },
    ]);
    assert.deepEqual(p.sessions[2]!.lifts, []);
    // Friday is a lifting day on the calendar; A was the last lift logged by then.
    assert.deepEqual(p.next, { type: 'B', name: 'Full Body B', kind: 'lift' });
    assert.deepEqual(p.logged, ['custom']);
    assert.equal(p.morning.done, true);
    assert.deepEqual(p.morning.fields.map((x) => [x.id, x.day, x.value]), [['energy', 'today', 2], ['soreness', 'today', 3], ['sleepQ', 'today', 2], ['sleepH', 'today', 5.5], ['rhr', 'today', 68], ['hrv', 'today', null], ['weight', 'today', 83.8], ['steps', 'yesterday', 9184], ['floors', 'yesterday', 4]]);
    assert.deepEqual(p.morning.fields[0], { id: 'energy', label: 'Energy', min: 1, max: 5, whole: true, lo: 'Flat', hi: 'Great', day: 'today', value: 2 });
    assert.deepEqual(p.morning.fields[6], { id: 'weight', label: 'Weight', min: 30, max: 250, whole: false, unit: 'kg', day: 'today', value: 83.8 });
    assert.deepEqual(p.trained, { answers: ['trained', 'rest', 'missed'], logged: true, workout: true, mark: null, answer: null });
    assert.deepEqual(p.inbox, { dir: '3-Personal/Fitness/Coach/Inbox', name: '<yyyy-MM-dd>T<HH-mm-ss>-<kind>.json', v: 1, kinds: ['session', 'tick', 'amount', 'morning', 'trained'], days: 14 });
  });

  it('is the same text for the same vault (no clock in it), and follows a tick', () => {
    assert.equal(phoneText(phone()), phoneText(phone()));
    const ticked = phone(files((x) => edit(x, P('tracking'), (t) => (t.days[TODAY].multivitamin = { done: true }))));
    assert.ok(!ticked.open.includes('multivitamin'));
    assert.match(phoneText(ticked), /\n$/);
  });

  it('without a plan or anything tracked: no sessions, no items', () => {
    const p = phone(files((x) => {
      delete x['v/3-Personal/Fitness/plan-data.json'];
      delete x[P('tracking')];
    }));
    assert.deepEqual([p.items, p.open, p.sessions, p.next], [[], [], [], null]);
  });
});
