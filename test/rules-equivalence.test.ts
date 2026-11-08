// The old defaults written into plan-data.json as the plan's own rules give
// the same numbers as a plan that declares nothing. The differences allowed
// are the ones the rules decide on purpose:
// - who the rule belongs to: `from.kind`, the citation leading each note,
//   each rule's `source` and words, and the warnings (`legacy-default`);
// - the load-jump guide reported, not applied, under the plan's own step
//   (the weights here are the same: the guide only flags a big jump);
// - what only the old default does: its deload comparison for the letter,
//   the busy-week move and the check-in's question to cancel a light week.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { paths } from '../src/adapters/vault/layout.ts';
import type { PlanData } from '../src/core/plan-data.ts';
import { legacyLift, legacyRulesJson, RULE_KINDS } from '../src/core/rules.ts';
import { buildTemplate } from '../src/report/checkin.ts';
import { buildReview } from '../src/report/review.ts';
import { buildSession } from '../src/report/session.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

const PLAN = `v/${paths().plan}`;

function vault(explicit: boolean, asOf: string) {
  const f = fixtureFiles('v');
  if (explicit) {
    const doc = JSON.parse(f[PLAN]!) as PlanData;
    doc.rules = legacyRulesJson();
    doc.express = { ...doc.express, short: 'half' };
    for (const k of Object.keys(doc.lifts)) doc.lifts[k] = { ...doc.lifts[k]!, progression: legacyLift() };
    f[PLAN] = `${JSON.stringify(doc, null, 2)}\n`;
  }
  return readVault(memoryIo(f, asOf), 'v', { asOf }).data;
}

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Everything but who a rule belongs to, and the load-jump guide's wording (its weight stays). */
function norm(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(norm);
  if (!isObj(x)) return x;
  const from = isObj(x['from']) ? (x['from'] as { text: string }) : null;
  const guided = isObj(x['inputs']) && isObj((x['inputs'] as J)['loadCap']);
  const out: J = {};
  for (const [k, v] of Object.entries(x)) {
    if (k === 'from' || k === 'warnings') continue;
    // A rule's own `source` (the review's rules, a lift's progressionRule, the session's light week).
    if (k === 'source' && (v === 'legacy-default' || (v === 'plan' && ('path' in x || 'dose' in x)))) continue;
    if (k === 'text' && typeof v === 'string' && /^(The plan's rule|Pahlavan's default \(the plan sets none\)): /.test(v)) continue;
    if (k === 'rule' && typeof v === 'string' && /^(The plan's rule|Pahlavan's default)/.test(v)) continue;
    if (guided && (k === 'title' || k === 'note')) continue;
    if (k === 'note' && typeof v === 'string' && from && v.startsWith(from.text)) {
      out[k] = v.slice(from.text.length).trim();
      continue;
    }
    out[k] = norm(v);
  }
  if (guided) delete ((out['inputs'] as J)['loadCap'] as J)['applied'];
  return out;
}

/** The check-in without what only the old default asks: the busy-week move and the question to cancel a light week. */
function template(t: ReturnType<typeof buildTemplate>) {
  return { ...t, ask: t.ask.filter((q) => q.topic !== 'deload').map((q) => (q.fields.includes('knownBusy') ? { ...q, answer: undefined } : q)) };
}

describe('the old defaults, written as the plan\'s rules, give the same numbers', () => {
  // Week 1 (calibration), the week before a light week, the light week, a big jump, a stall.
  for (const date of ['2026-03-04', '2026-03-22', '2026-03-25', '2026-04-03', '2026-04-08', '2026-04-12']) {
    it(`on ${date}: review, session (full, Express, Hotel) and the check-in template`, () => {
      const legacy = vault(false, date);
      const declared = vault(true, date);
      assert.ok(RULE_KINDS.every((k) => declared.rules.sources[k] === 'plan'));
      assert.ok(Object.values(declared.rules.lifts).every((l) => l.source === 'plan'));
      assert.deepEqual(declared.rules.problems, []);
      assert.ok(!declared.warnings.some((w) => w.code === 'legacy-default' || w.code === 'rules-invalid'));
      assert.ok(legacy.warnings.some((w) => w.code === 'legacy-default'));

      const a = buildReview(legacy, date);
      const b = buildReview(declared, date);
      assert.equal(b.deloadPrescription, null, 'the comparison with rules.md is the old default\'s alone');
      assert.deepEqual(norm({ ...b, deloadPrescription: null }), norm({ ...a, deloadPrescription: null }));
      for (const l of b.lifts) {
        const other = a.lifts.find((x) => x.exercise === l.exercise)!;
        assert.deepEqual(l.next?.value, other.next?.value, `${l.name}: the same target`);
      }
      for (const mode of ['full', 'express', 'hotel'] as const) {
        assert.deepEqual(norm(buildSession(declared, date, mode)), norm(buildSession(legacy, date, mode)), mode);
      }
      assert.deepEqual(norm(template(buildTemplate(declared, date, null))), norm(template(buildTemplate(legacy, date, null))));
    });
  }

  it('a big jump: the plan\'s step reports the guide where the old default retitles the target; the weight is the same', () => {
    const a = buildReview(vault(false, '2026-04-03'), '2026-04-03').lifts.find((l) => l.name === 'Seated Cable Row')!;
    const b = buildReview(vault(true, '2026-04-03'), '2026-04-03').lifts.find((l) => l.name === 'Seated Cable Row')!;
    assert.equal(a.next!.reason.title, 'Big jump');
    assert.equal((b.next!.reason.inputs['loadCap'] as { applied: boolean }).applied, false);
    assert.deepEqual(b.next!.value, a.next!.value);
  });
});
