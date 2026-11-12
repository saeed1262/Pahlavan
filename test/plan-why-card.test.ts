// The Why this plan card (plan-data.json's `why`, src/core/plan-why.ts): what
// the reader keeps and refuses, the screen's view with each family's label,
// the three check codes on a draft and on the plan as written, `draft` never
// carrying it, the Plan screen's model holding it, and the version facts.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { run } from '../src/cli/cli.ts';
import { planWhyView, readPlanWhy } from '../src/core/plan-why.ts';
import { SPLIT_KINDS } from '../src/core/schema.ts';
import { buildCheck, type CheckReport } from '../src/report/check.ts';
import { buildPlan } from '../src/report/plan-screen.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

type Json = Record<string, any>;
const PLAN = 'v/3-Personal/Fitness/plan-data.json';
const DATE = '2026-04-20';

/** A whole card: every family accounted for. */
function card(): Json {
  return {
    date: '2026-04-06',
    lead: 'This plan is built around your upper back: you pull twice as much as you push.',
    reasons: [
      { title: 'Upper back comes first', text: 'Your shoulders roll forward, so every lifting day opens with a pull.', grade: 'heuristic' },
      { title: 'Four days of an hour', text: 'The week you said you have.', grade: 'strong' },
      { title: 'Chest waits', text: 'You asked for it too; it comes back at the phase 1 review.' },
    ],
    split: {
      picked: { family: 'full-body', why: 'A skipped day costs each muscle a quarter of its week.' },
      compared: [{ family: 'upper-lower', why: 'A missed day hits half your body.' }, { family: 'torso-limbs', why: 'No pulling on the limbs days.' }],
      leftOut: SPLIT_KINDS.filter((k) => !['full-body', 'upper-lower', 'torso-limbs'].includes(k)).map((family) => ({ family, why: `Not for your week (${family}).` })),
    },
    decision: '2026-04-06 · Redesign',
  };
}

const withWhy = (why: unknown) => ({ why });

describe('readPlanWhy', () => {
  it('reads a whole card, with nothing missing and no problem', () => {
    const r = readPlanWhy(withWhy(card()));
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.missing, []);
    assert.equal(r.present, true);
    assert.equal(r.why?.lead, 'This plan is built around your upper back: you pull twice as much as you push.');
    assert.equal(r.why?.reasons.length, 3);
    assert.equal(r.why?.reasons[2]!.grade, undefined, 'a reason with no grade keeps none');
    assert.equal(r.why?.split.leftOut.length, SPLIT_KINDS.length - 3);
    assert.equal(r.why?.decision, '2026-04-06 · Redesign');
  });

  it('a plan with no why: nothing, and no problem (check says no-why-card instead)', () => {
    assert.deepEqual(readPlanWhy({}), { why: null, present: false, problems: [], missing: [] });
    assert.deepEqual(readPlanWhy(undefined), { why: null, present: false, problems: [], missing: [] });
  });

  it('names the families it accounts for nowhere, in SPLIT_KINDS order', () => {
    const c = card();
    c['split'].leftOut = c['split'].leftOut.filter((f: Json) => !['push-pull-legs', 'body-part'].includes(f['family']));
    const r = readPlanWhy(withWhy(c));
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.missing, ['push-pull-legs', 'body-part']);
  });

  const broken: [string, (c: Json) => void, RegExp][] = [
    ['an unknown key', (c) => (c['tone'] = 'warm'), /why has unknown key\(s\): tone/],
    ['no date', (c) => delete c['date'], /why\.date is not a YYYY-MM-DD date/],
    ['a bad date', (c) => (c['date'] = '9 Nov'), /why\.date is not a YYYY-MM-DD date/],
    ['no lead', (c) => (c['lead'] = ' '), /why\.lead is missing/],
    ['no reasons', (c) => (c['reasons'] = []), /why\.reasons is not a list/],
    ['a reason with no text', (c) => (c['reasons'][1] = { title: 'Only a title' }), /why\.reasons\[1\] needs a title and a text/],
    ['a bad grade', (c) => (c['reasons'][0].grade = 'Moderate'), /why\.reasons\[0\]\.grade is not one of strong, moderate, weak, heuristic/],
    ['an unknown reason key', (c) => (c['reasons'][0].source = 'x'), /why\.reasons\[0\] has unknown key\(s\): source/],
    ['no split', (c) => delete c['split'], /why\.split is missing/],
    ['no family picked', (c) => delete c['split'].picked, /why\.split\.picked is not \{family, why\}/],
    ['an unknown family', (c) => (c['split'].compared[0].family = 'bro-split'), /why\.split\.compared\[0\]\.family is not a split family/],
    ['a family with no why', (c) => (c['split'].leftOut[0].why = ''), /why\.split\.leftOut\[0\] \(push-pull-legs\) has no why/],
    ['a family twice', (c) => c['split'].leftOut.push({ family: 'upper-lower', why: 'Again.' }), /why\.split names upper-lower more than once/],
    ['compared not a list', (c) => (c['split'].compared = { family: 'upper-lower' }), /why\.split\.compared is not a list/],
    ['a decision that is not text', (c) => (c['decision'] = 3), /why\.decision is not text/],
  ];
  for (const [name, edit, re] of broken) {
    it(`a problem: ${name}`, () => {
      const c = card();
      edit(c);
      const r = readPlanWhy(withWhy(c));
      assert.ok(r.problems.some((p) => re.test(p)), r.problems.join('\n'));
    });
  }

  it('a why that is not an object is one problem, and nothing to show', () => {
    const r = readPlanWhy(withWhy('Because.'));
    assert.equal(r.why, null);
    assert.equal(r.problems.length, 1);
  });

  it('keys starting with _ are notes, never unknown', () => {
    const c = card();
    c['_note'] = 'written after the yes';
    c['reasons'][0]._src = 'audit row 3';
    assert.deepEqual(readPlanWhy(withWhy(c)).problems, []);
  });

  it('shows what it can: a reason with no text is left out, a bad grade is dropped from its reason, the rest stays', () => {
    const c = card();
    c['reasons'][1] = { title: 'No text' };
    c['reasons'][0].grade = 'Moderate';
    const r = readPlanWhy(withWhy(c));
    assert.deepEqual(r.why?.reasons.map((x) => [x.title, x.grade ?? null]), [['Upper back comes first', null], ['Chest waits', null]]);
    assert.equal(r.problems.length, 2);
  });

  it('a family named again is a problem and shown once, where it was first named', () => {
    const c = card();
    c['split'].compared.push({ family: 'full-body', why: 'Again.' });
    const r = readPlanWhy(withWhy(c));
    assert.ok(r.problems.includes('why.split names full-body more than once'), r.problems.join('\n'));
    assert.deepEqual(r.why?.split.compared.map((f) => f.family), ['upper-lower', 'torso-limbs']);
    assert.equal(r.why?.split.picked.family, 'full-body');
  });

  it('a family line with no why is its own problem, never a missing family too', () => {
    const c = card();
    c['split'].leftOut.find((f: Json) => f['family'] === 'hift').why = '';
    const r = readPlanWhy(withWhy(c));
    assert.deepEqual(r.problems, ['why.split.leftOut[5] (hift) has no why']);
    assert.deepEqual(r.missing, []);
  });

  it('nothing to show without a lead or a family picked', () => {
    const a = card();
    delete a['lead'];
    assert.equal(readPlanWhy(withWhy(a)).why, null);
    const b = card();
    delete b['split'].picked;
    assert.equal(readPlanWhy(withWhy(b)).why, null);
  });
});

describe('planWhyView', () => {
  it('gives each family its label, and null for what is not there', () => {
    const v = planWhyView(readPlanWhy(withWhy(card())))!;
    assert.deepEqual(v.split.picked, { family: 'full-body', label: 'Full body', why: 'A skipped day costs each muscle a quarter of its week.' });
    assert.equal(v.split.compared[0]!.label, 'Upper/lower');
    assert.equal(v.split.leftOut.find((f) => f.family === 'hift')!.label, 'CrossFit-style (HIFT)');
    assert.equal(v.split.leftOut.find((f) => f.family === 'heavy-and-light-days')!.label, 'Heavy/light full body', 'as rules.md names it');
    assert.equal(v.reasons[2]!.grade, null);
    assert.equal(v.date, '2026-04-06');
    assert.equal(planWhyView(readPlanWhy({})), null);
  });
});

// ---------------------------------------------------------------- check, draft and the Plan screen on the fixture vault

function vaultWith(edit: (plan: Json) => void) {
  const files = fixtureFiles('v');
  const plan = JSON.parse(files[PLAN]!) as Json;
  edit(plan);
  files[PLAN] = JSON.stringify(plan);
  return files;
}
const checkOf = (edit: (plan: Json) => void): CheckReport => buildCheck(readVault(memoryIo(vaultWith(edit)), 'v', { asOf: DATE }), DATE);
const finding = (r: CheckReport, code: string) => r.findings.find((f) => f.code === code);
const texts = (f: { items: unknown[] } | undefined) => (f?.items ?? []).map((x) => (typeof x === 'string' ? x : (x as { text: string }).text));

describe('check: the Why this plan card', () => {
  it('the fixture plan carries a whole card: none of the three codes', () => {
    const r = checkOf(() => {});
    for (const code of ['no-why-card', 'why-split-missing', 'why-shape']) assert.equal(finding(r, code), undefined, code);
  });

  it('no-why-card: a warning on a plan with none', () => {
    const f = finding(checkOf((p) => delete p['why']), 'no-why-card');
    assert.equal(f?.level, 'warning');
    assert.equal(f?.rule, 'plan.why-card');
  });

  it('why-split-missing: a warning naming each family left unaccounted for', () => {
    const r = checkOf((p) => {
      p['why'] = card();
      p['why'].split.leftOut = p['why'].split.leftOut.filter((f: Json) => f['family'] !== 'push-pull-legs');
    });
    const f = finding(r, 'why-split-missing');
    assert.equal(f?.level, 'warning');
    assert.deepEqual(texts(f), ['Push/pull/legs (push-pull-legs)']);
  });

  it('why-shape: a hard error that blocks the write', () => {
    const r = checkOf((p) => {
      p['why'] = card();
      p['why'].split.compared[0].family = 'bro-split';
    });
    const f = finding(r, 'why-shape');
    assert.equal(f?.level, 'error');
    assert.ok(texts(f).some((t) => /not a split family/.test(t)), texts(f).join('\n'));
  });

  it('the same codes on a draft (check --plan)', () => {
    const files = vaultWith((p) => (p['why'] = card()));
    const draft = JSON.parse(files[PLAN]!) as Json;
    draft['why'].lead = '';
    files['v/draft.json'] = JSON.stringify(draft);
    const r = run(['check', '--vault', 'v', '--plan', 'v/draft.json', '--date', DATE, '--json'], memoryIo(files, DATE) as never);
    const body = JSON.parse(r.stdout) as Json;
    const shape = (body['findings'] as Json[]).find((f) => f['code'] === 'why-shape');
    assert.equal(shape?.['level'], 'error', r.stdout.slice(0, 400));
  });
});

describe('draft, the Plan screen and the version facts', () => {
  it('draft never carries the plan as written\'s why', () => {
    const r = run(['draft', '--vault', 'v', '--json'], memoryIo(vaultWith((p) => (p['why'] = card())), DATE) as never);
    assert.equal(r.code, 0, r.stdout);
    const planData = (JSON.parse(r.stdout) as Json)['planData'] as Json;
    assert.equal('why' in planData, false);
  });

  it('the Plan screen holds the card with its labels; null without one, and says when one can\'t be read', () => {
    const screen = (edit: (p: Json) => void) => buildPlan(readVault(memoryIo(vaultWith(edit)), 'v', { asOf: DATE }), DATE) as Json;
    const m = screen((p) => (p['why'] = card()));
    assert.equal(m['why'].split.picked.label, 'Full body');
    assert.equal(m['why'].reasons.length, 3);
    assert.equal(m['whyUnreadable'], false);
    const none = screen((p) => delete p['why']);
    assert.deepEqual([none['why'], none['whyUnreadable']], [null, false]);
    const broken = screen((p) => (p['why'] = { ...card(), lead: '' }));
    assert.deepEqual([broken['why'], broken['whyUnreadable']], [null, true]);
  });

  it('the version facts list every family with its label, and the grades; why is plan-data\'s last key', () => {
    const r = run(['--version', '--json'], memoryIo({}, DATE) as never);
    const facts = (JSON.parse(r.stdout) as Json)['facts'] as Json;
    assert.deepEqual(facts['why'].splitKinds.map((x: Json) => x['id']), [...SPLIT_KINDS]);
    assert.equal(facts['why'].splitKinds[0].label, 'Full body');
    assert.deepEqual(facts['why'].grades, ['strong', 'moderate', 'weak', 'heuristic']);
    assert.equal((facts['planData'].keys as string[]).at(-1), 'why');
  });
});
