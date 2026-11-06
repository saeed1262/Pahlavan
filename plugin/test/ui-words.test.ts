// Words that must not reach the screens. The fitness dashboard was archived:
// Pahlavan's text never sends the user to it or explains itself by it. The
// coach skill's own files (adhoc.md, checkin.md, ...) are internal: a
// screen never cites them. A source guard over the screens' and cards'
// string literals (comments and imports aside), and the engine's text that
// the screens show (the Sunday check-in's questions and notes, the hotel
// session's reasons).

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { buildSession } from '../../src/report/session.ts';
import { buildTemplate } from '../../src/report/checkin.ts';
import { fixtureFiles, memoryIo } from '../../test/helpers.ts';

const SRC = new URL('../src/', import.meta.url).pathname;
/** The coach skill's reference files: names for the coach, not the user. */
const SKILL_FILE = /\b(?:adhoc|checkin|rules|numbers|planning|intake|tracking|formats|plan-files|progress|review|diet|log|ask)\.md\b|\bSKILL\.md\b/;
const FILES = [...readdirSync(`${SRC}ui`).filter((f) => f.endsWith('.ts')).map((f) => `ui/${f}`), 'reminders/card-model.ts', 'settings-tab.ts'];

/** The string and template literals of a source file, without its comments and import lines. */
export function literals(src: string): string[] {
  const code = src
    .replace(/\/\*[^]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(import|export \{|\/\/)/.test(l))
    .map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n');
  return [...code.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map((m) => m[0]);
}

describe('words the screens never show', () => {
  it('no screen or card text mentions the archived dashboard', () => {
    let n = 0;
    for (const f of FILES) {
      for (const lit of literals(readFileSync(SRC + f, 'utf8'))) {
        n++;
        assert.doesNotMatch(lit, /\bdashboard\b(?!\.ts)/i, `${f}: ${lit.slice(0, 120)}`);
        assert.doesNotMatch(lit, SKILL_FILE, `${f}: ${lit.slice(0, 120)}`);
      }
    }
    assert.ok(n > 500, `read ${n} literals`);
  });

  it('the Sunday check-in’s deload question speaks of the plan', () => {
    const src = readFileSync(new URL('../../src/report/checkin.ts', import.meta.url).pathname, 'utf8');
    assert.match(src, /question: `The plan counted \$\{/);
    assert.doesNotMatch(src, /The dashboard counted/);
  });

  it('the engine’s text the screens show cites no skill file', () => {
    const files = fixtureFiles('v');
    // A known week-long trip, so the hotel session scales to a third.
    files['v/3-Personal/Fitness/Coach/checkins.json'] = JSON.stringify({ schemaVersion: 1, checkins: [{ date: '2026-04-05', weekStart: '2026-03-30', knownBusy: [{ from: '2026-04-06', to: '2026-04-14', kind: 'travel', note: 'Work trip' }] }] });
    const read = readVault(memoryIo(files, '2026-04-12'), 'v', { asOf: '2026-04-12' });
    const sunday = buildTemplate(read.data, '2026-04-12', null);
    const hotel = buildSession(read.data, '2026-04-10', 'hotel');
    // What Check-in draws from the template: every question, the pain, recovery and availability notes, the deload's condition.
    const shown: unknown[] = [];
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) return o.forEach(walk);
      if (!o || typeof o !== 'object') return;
      const q = o as { topic?: string; question?: string; answer?: string; known?: { cancelOnlyIf?: string } };
      if (q.topic) shown.push(q.question, ['pain', 'recovery', 'availability'].includes(q.topic) ? q.answer : null, q.known?.cancelOnlyIf);
      Object.values(o).forEach(walk);
    };
    walk(sunday);
    assert.ok(shown.some((x) => typeof x === 'string' && x.includes('the pain rule')), 'the pain note is read');
    const text = JSON.stringify({ shown, flags: hotel.flags.map((f) => f.note), why: hotel.items.flatMap((i) => i.adjustments.map((a) => a.note)) });
    assert.match(text, /a third/, 'the long trip’s reasons are there');
    assert.doesNotMatch(text, SKILL_FILE);
  });

  it('one photo rule everywhere: each light week’s Sunday, the tape every second Sunday', () => {
    const WRONG = /every two weeks, with the photos|photo day comes with the tape|photos? (?:come )?with the tape|at the end of each deload week/i;
    const sources = [...FILES.map((f) => SRC + f), new URL('../../src/report/progress-more.ts', import.meta.url).pathname, new URL('../../src/core/body-schedule.ts', import.meta.url).pathname];
    for (const p of sources) for (const lit of literals(readFileSync(p, 'utf8'))) assert.doesNotMatch(lit, WRONG, `${p}: ${lit.slice(0, 120)}`);
    const sched = readFileSync(new URL('../../src/core/body-schedule.ts', import.meta.url).pathname, 'utf8');
    assert.match(sched, /tape: 'Every second Sunday'/);
    assert.match(sched, /photos: 'Each light week’s Sunday'/);
  });

  it('Pahlavan says light week: no deload in the screens’ words, and the dashboard’s ported words are renamed on the way', async () => {
    const DELOAD = /\bDeload\b|\b(?:a|the|early|next|scheduled|its) deload\b|\bdeload (?:week|sets|loads)\b/;
    for (const f of FILES) for (const lit of literals(readFileSync(SRC + f, 'utf8'))) assert.doesNotMatch(lit, DELOAD, `${f}: ${lit.slice(0, 120)}`);
    const { lightWords, MESOCYCLE, SHORT } = await import('../src/ui/terms.ts');
    assert.equal(lightWords('Deload every 4th week (weeks 4, 8)'), 'Light week every 4th week (weeks 4, 8)');
    assert.equal(lightWords('Deload week: 2 sets of everything'), 'Light week: 2 sets of everything');
    assert.equal(lightWords('deload 70 lb × 8'), 'light week 70 lb × 8');
    assert.match(MESOCYCLE, /4-week block/);
    assert.match(SHORT, /shorter days/);
    // The engine's words the screens show.
    const files = fixtureFiles('v');
    const read = readVault(memoryIo(files, '2026-03-26'), 'v', { asOf: '2026-03-26' });
    const s = buildSession(read.data, '2026-03-26', 'full');
    const flag = s.flags.find((x) => x.rule === 'deload.decide');
    assert.ok(flag, 'plan week 4 is a light week');
    assert.equal(flag!.title, 'Light week');
    assert.match(flag!.note!, /^Two sets of everything, about 10 % lighter/);
  });
});
