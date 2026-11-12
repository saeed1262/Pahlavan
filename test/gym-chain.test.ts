// The gym page end to end, on the fixture vault: phone.json's link, read by
// the page's model, every set ticked (or a line skipped), the entry it sends,
// wrapped as the shortcut wraps it, then imported by the inbox. Every
// session and mode the link carries is imported, and A's log entry is the
// one `engine log add` writes from the same input.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { readTracking } from '../src/adapters/vault/tracking-read.ts';
import type { GymEntry, GymSession } from '../src/core/gym.ts';
import { validateInboxEntry } from '../src/core/validate.ts';
import { run } from '../src/cli/cli.ts';
import { applyInbox, buildPhone, INBOX_TEXT_KEYS, inboxTextPaths, type InboxApplied, type InboxTexts } from '../src/report/inbox.ts';
import { editSet, entryOf, freshState, hasSets, isSuperset, readHash, skipRow, tickRow, tickSet, type GymState } from '../web/gym/model.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

type Json = Record<string, any>;
const TODAY = '2026-04-10';
const P = (k: keyof InboxTexts) => `v/${inboxTextPaths()[k]}`;
const NOW = Date.parse(`${TODAY}T18:00:00-04:00`);

const readOf = (f: Record<string, string>) => {
  const io = memoryIo(f, TODAY);
  return { io, read: readVault(io, 'v', { asOf: TODAY }), tracking: readTracking(io, 'v') };
};

/** The day's gym data, as the page reads it from phone.json's link. */
function gymDay(f: Record<string, string>) {
  const { read, tracking } = readOf(f);
  const link = buildPhone(read, tracking, TODAY).gym;
  assert.ok(link, 'phone.json has a gym link');
  const d = readHash(link.slice(link.indexOf('#')));
  assert.ok(d, 'the page reads it');
  return d;
}

/** Every set ticked (one with nothing in it gets the range's low end, and 20 on a loaded set), every warm-up and cardio row ticked. */
function tickAll(s: GymSession, start: GymState): GymState {
  let st = start;
  let t = NOW;
  for (const r of s.rows) {
    if (!hasSets(r)) {
      st = tickRow(s, st, r.key, (t += 60_000));
      continue;
    }
    const parts = isSuperset(r) ? r.parts.map((p, i) => ({ part: i as number | null, kind: p.kind, n: p.rows.length, lo: p.range?.[0] ?? 10 })) : [{ part: null, kind: r.kind, n: r.rows.length, lo: r.range?.[0] ?? 10 }];
    for (const p of parts) {
      for (let i = 0; i < p.n; i++) {
        const ref = { key: r.key, part: p.part, i };
        const rs = st.rows[r.key]!;
        const set = (p.part === null ? rs.sets : rs.parts[p.part]!)[i]!;
        if (set.reps === null) st = editSet(s, st, ref, { reps: p.lo });
        if (p.kind === 'load' && set.weight === null) st = editSet(s, st, ref, { weight: 20 });
        st = tickSet(s, st, ref, (t += 90_000));
      }
    }
  }
  return st;
}

/** The entry as the shortcut saves it: the page's session inside the inbox's envelope. */
const wrap = (session: GymEntry, time = '19:02') => ({ v: 1, kind: 'session', at: `${TODAY}T${time}:00-04:00`, date: TODAY, session });

function importOne(f: Record<string, string>, e: Json) {
  const { read, tracking } = readOf(f);
  const texts = Object.fromEntries(INBOX_TEXT_KEYS.map((k) => [k, f[P(k)] ?? null])) as InboxTexts;
  const plan = applyInbox({ read, tracking, texts, applied: [] }, [{ file: `${TODAY}T19-02-00-session.json`, text: JSON.stringify(e) }], TODAY);
  return { plan, result: plan.results[0]! };
}

describe('the gym page, from phone.json to the log', () => {
  const d = gymDay(fixtureFiles('v'));

  it('carries every plan session, each lifting one in full and Express', () => {
    assert.ok(d.sessions.length >= 4);
    for (const s of d.sessions.filter((x) => x.kind === 'lift')) assert.ok(d.sessions.some((x) => x.type === s.type && x.mode === (s.mode === 'full' ? 'express' : 'full')), `${s.type} has both modes`);
  });

  for (const s of d.sessions) {
    it(`imports ${s.type} (${s.mode}) with every set ticked`, () => {
      const f = fixtureFiles('v');
      const entry = entryOf(s, tickAll(s, freshState(d.date, s)), NOW + 3_600_000);
      const e = wrap(entry);
      assert.deepEqual(validateInboxEntry(e), [], 'a valid entry');
      const { result } = importOne(f, e);
      assert.notEqual(result.status, 'refused', result.status === 'refused' ? `${result.code}: ${result.reason}` : '');
      const log = (result as InboxApplied).writes.session! as Json;
      assert.equal(log['type'], s.type);
      assert.equal(log['trackingLevel'], 'full');
      assert.equal(Boolean(log['express']), s.mode === 'express' && s.kind === 'lift');
      const sets = (log['exerciseSets'] as Json[]).reduce((n, x) => n + (x['sets'] as unknown[]).length, 0);
      const ticked = entry.exerciseSets.reduce((n, x) => n + x.sets.length, 0);
      assert.equal(sets, ticked, 'every ticked set is in the log');
      if (log['checklist']) assert.deepEqual(log['checklist']['skipped'], [], 'nothing skipped');
    });
  }

  it("writes A's log entry exactly as `engine log add` does from the same input, a skipped line and its reason too", () => {
    const s = d.sessions.find((x) => x.type === 'A' && x.mode === 'full')!;
    const last = s.rows.filter((r) => r.line !== null).at(-1)!;
    let st = tickAll(s, freshState(d.date, s));
    st = skipRow(st, last.key, 'time');
    const entry = entryOf(s, st, NOW + 3_600_000);
    assert.deepEqual(entry.skipped, [last.line]);
    assert.deepEqual(entry.skipWhy, { [last.line!]: 'time' });

    const viaInbox = importOne(fixtureFiles('v'), wrap(entry));
    const got = (viaInbox.result as InboxApplied).writes.session!;

    const f = fixtureFiles('v');
    const planData = JSON.parse(f['v/3-Personal/Fitness/plan-data.json']!) as Json;
    const logged = (planData['sessions']['A'] as Json[]).filter((x) => x['logged']).map((x) => String(x['name']));
    const { _say: _s, lift1, lift2, ...rest } = entry;
    f['v/s.json'] = JSON.stringify({ date: TODAY, ...rest, ...(lift1 ? { lift1: { name: logged[0], ...lift1 } } : {}), ...(lift2 ? { lift2: { name: logged[1], ...lift2 } } : {}) });
    const io = { ...memoryIo(f, TODAY), writeLog: (_r: string, t: string) => void (f[P('log')] = t), writeHabits: (_r: string, t: string) => void (f[P('habits')] = t) };
    const r = run(['log', 'add', '--file', 'v/s.json', '--vault', 'v', '--write'], io as never);
    assert.equal(r.code, 0, r.stdout);
    assert.deepEqual(got, (JSON.parse(r.stdout) as Json)['session']);
    assert.equal(viaInbox.plan.texts.log, f[P('log')], 'the same log file');
  });

  it("writes B's log entry, its swapped lift and all, exactly as `engine log add` does from the same input", () => {
    // On 10 Apr the engine does Single-leg dumbbell RDL in place of B's Romanian Deadlift (a logged lift), for the Ledger's limit.
    const s = d.sessions.find((x) => x.type === 'B' && x.mode === 'full')!;
    const swapped = s.rows.find((r) => r.lift === 0)!;
    assert.deepEqual([swapped.name, swapped.planned, swapped.swap], ['Single-leg dumbbell RDL', 'Romanian Deadlift', 'ledger']);
    const entry = entryOf(s, tickAll(s, freshState(d.date, s)), NOW + 3_600_000);
    assert.deepEqual([entry.lift1?.name, entry.lift1?.planned, entry.lift1?.swapWhy], ['Single-leg dumbbell RDL', 'Romanian Deadlift', 'ledger']);
    assert.equal(entry.lift2?.name, undefined, 'a lift done as planned is named by the plan');
    assert.equal(entry.exerciseSets.find((x) => x.name === 'Single-leg dumbbell RDL')?.planned, 'Romanian Deadlift');
    assert.equal(entry.swaps, undefined, "the logged lift's swap is its own, not in swaps");

    const viaInbox = importOne(fixtureFiles('v'), wrap(entry));
    assert.notEqual(viaInbox.result.status, 'refused', viaInbox.result.status === 'refused' ? viaInbox.result.reason : '');
    const got = (viaInbox.result as InboxApplied).writes.session!;
    assert.deepEqual(got['lift1'], { name: 'Single-leg dumbbell RDL', planned: 'Romanian Deadlift', swapWhy: 'ledger', weight: entry.lift1!.weight, reps: entry.lift1!.reps, unit: entry.lift1!.unit });

    const f = fixtureFiles('v');
    const planData = JSON.parse(f['v/3-Personal/Fitness/plan-data.json']!) as Json;
    const logged = (planData['sessions']['B'] as Json[]).filter((x) => x['logged']).map((x) => String(x['name']));
    const { _say: _s, lift1, lift2, ...rest } = entry;
    f['v/s.json'] = JSON.stringify({ date: TODAY, ...rest, ...(lift1 ? { lift1: { name: logged[0], ...lift1 } } : {}), ...(lift2 ? { lift2: { name: logged[1], ...lift2 } } : {}) });
    const io = { ...memoryIo(f, TODAY), writeLog: (_r: string, t: string) => void (f[P('log')] = t), writeHabits: (_r: string, t: string) => void (f[P('habits')] = t) };
    const r = run(['log', 'add', '--file', 'v/s.json', '--vault', 'v', '--write'], io as never);
    assert.equal(r.code, 0, r.stdout);
    assert.deepEqual(got, (JSON.parse(r.stdout) as Json)['session']);
    assert.equal(viaInbox.plan.texts.log, f[P('log')], 'the same log file');
  });

  it('a second Send of the same session is refused as logged already', () => {
    const s = d.sessions.find((x) => x.type === 'A' && x.mode === 'full')!;
    const e = wrap(entryOf(s, tickAll(s, freshState(d.date, s)), NOW + 3_600_000));
    const first = importOne(fixtureFiles('v'), e);
    const f = fixtureFiles('v');
    f[P('log')] = first.plan.texts.log!;
    const again = importOne(f, wrap(e.session, '19:05'));
    assert.equal(again.result.status, 'refused');
    assert.equal(again.result.status === 'refused' ? again.result.code : null, 'already');
  });
});
