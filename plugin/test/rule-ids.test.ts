// Rule ids ("plan.calendar.tape", "coach.morning-checkin") are internal: the
// screens and the cards keep them on the element (data-rule) or in a hover
// tooltip, never in the text. A source guard over the UI modules, and the
// cards' own text on the synthetic vault.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { readTracking } from '../../src/adapters/vault/tracking-read.ts';
import { momentAt } from '../../src/core/clock.ts';
import { bodyParts, dueNow } from '../../src/core/nudges.ts';
import { trainingToday } from '../../src/report/tracking.ts';
import { cardView } from '../src/reminders/card-model.ts';
import { FIX } from './mem-vault.ts';

const UI = new URL('../src/ui/', import.meta.url).pathname;
const RULE_ID = /\b(diet|plan|coach|day|routine|readiness|safety|progression|soreness|habits|nudges|cycle|variant|deload|stall|volume|weight|e1rm|missed|checkin|settings|load|protein|adherence|concurrent|units|schema|features)\.[a-z][a-z0-9-]*\b/;

describe('rule ids stay out of the visible text', () => {
  it('no UI module draws a reason’s rule as a child or after a "Rule" label', () => {
    for (const f of readdirSync(UI).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(UI + f, 'utf8');
      // A child argument that is just `<something>.rule`: `, a.reason.rule)`.
      assert.doesNotMatch(src, /,\s*(?:[\w$!?]+\.)+rule\s*\)/, `${f} draws a rule id as text`);
      assert.doesNotMatch(src, /h\('code'[^)]*\.rule\b/, `${f} draws a rule id in a code element`);
      assert.doesNotMatch(src, /h\('div', \{ class: 'pv-(?:why-)?rule' \}/, `${f} draws the old rule line`);
    }
  });

  it('every card’s text (kicker, title, line under it, Why, notification) is free of rule ids', () => {
    const io = { readText: (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null), listDir: (p: string) => (existsSync(p) ? readdirSync(p) : null) };
    const vault = readVault(io, FIX, { asOf: '2026-04-10' });
    const tr = readTracking(io, FIX);
    let n = 0;
    for (const [date, time] of [['2026-04-10', '15:40'], ['2026-04-10', '21:35'], ['2026-04-12', '07:35'], ['2026-04-10', '10:30']] as const) {
      const now = momentAt(date, time, 0);
      const input = { now, tracking: tr.tracking, nudges: tr.nudges, body: tr.body, photoFolders: tr.photoFolders, habits: tr.habits, program: vault.data.program, training: trainingToday(vault.data, date), settings: { quiet: null } };
      const parts = bodyParts(input, date);
      for (const c of dueNow(input).value.cards) {
        const v = cardView(c, { now, tracking: tr.tracking, habits: tr.habits, body: tr.body, program: vault.data.program, parts: { tape: parts.tape.value, photos: parts.photos.value, tests: parts.tests.value } });
        const text = JSON.stringify({ kicker: v.kicker, title: v.title, sub: v.sub, why: v.why.note, notify: v.notify, body: v.body });
        assert.doesNotMatch(text, RULE_ID, `${c.key}: ${text.slice(0, 160)}`);
        assert.match(v.why.rule, RULE_ID, 'the rule id is still on the view, for the data attribute');
        n++;
      }
    }
    assert.ok(n >= 5, `checked ${n} cards`);
  });
});
