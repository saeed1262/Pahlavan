// Protein a day by goal (core/protein.ts): the tiers from the skill's
// tracking.md and diet.md, the upper half in a deficit, PROT-AGE's floor at
// 65+, and the protein item's gram target following it in the review, the
// bring-over and Due today's item. Made-up people.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { run } from '../src/cli/cli.ts';
import { isProteinItem, proteinForProfile, proteinTarget } from '../src/core/protein.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

type Json = Record<string, any>;
const g = (kind: string, importance = 8) => ({ kind: kind as never, importance });

describe('proteinTarget', () => {
  it('lifting goals: 1.6-2.2 g/kg, the item ticked at the floor', () => {
    const r = proteinTarget({ goals: [g('recomposition', 9), g('posture', 7)], weightKg: 83.5 });
    assert.deepEqual(r.value, { tier: 'lifting', deficit: false, gPerKg: [1.6, 2.2], floorGPerKg: 1.6, grams: [134, 184], targetG: 134 });
    assert.equal(r.reason.title, 'Protein');
    assert.match(r.reason.note!, /^Lifting goals \(recomposition, posture\): 1.6-2.2 g\/kg a day \(Morton 2018; Jäger 2017\)\. At 83.5 kg: 134-184 g a day; the protein item is ticked on days with at least 134 g\.$/);
  });

  it('in a deficit (the weight goal\'s band losing), the upper half: 1.9-2.2', () => {
    const r = proteinTarget({ goals: [g('fat-loss', 9), g('strength', 6)], weightKg: 90 });
    assert.deepEqual([r.value.deficit, r.value.gPerKg, r.value.grams, r.value.targetG], [true, [1.9, 2.2], [171, 198], 171]);
    assert.match(r.reason.note!, /In an energy deficit \(the fat-loss goal's band\), the upper half: 1.9-2.2 g\/kg \(Jäger 2017\)/);
    // The most important goal with a band decides: gain over fat loss is no deficit.
    assert.equal(proteinTarget({ goals: [g('gain', 9), g('fat-loss', 3)] }).value.deficit, false);
    // A goal's own band, and the eating plan's word, override the kind's.
    assert.equal(proteinTarget({ goals: [{ kind: 'maintenance', importance: 5, rateBand: { unit: 'kg', lo: -0.5, hi: -0.25 } }] }).value.deficit, true);
    assert.equal(proteinTarget({ goals: [g('fat-loss')], deficit: false }).value.floorGPerKg, 1.6);
  });

  it('health-only or endurance goals: 1.2-1.6, and 1.4-1.6 in a deficit', () => {
    assert.deepEqual(proteinTarget({ goals: [g('health'), g('conditioning')], weightKg: 70 }).value, { tier: 'health', deficit: false, gPerKg: [1.2, 1.6], floorGPerKg: 1.2, grams: [84, 112], targetG: 84 });
    assert.deepEqual(proteinTarget({ goals: [g('health')], deficit: true, weightKg: 70 }).value.gPerKg, [1.4, 1.6]);
    // One lifting goal beside health lifts the tier.
    assert.equal(proteinTarget({ goals: [g('health', 9), g('strength', 3)] }).value.tier, 'lifting');
  });

  it('at 65+, never under PROT-AGE\'s floor (the tiers already meet it), and says so', () => {
    const r = proteinTarget({ goals: [g('health')], age: 70, weightKg: 65 });
    assert.equal(r.value.floorGPerKg, 1.2);
    assert.match(r.reason.note!, /At 70, at least 1.2 g\/kg when training \(Bauer 2013\), which the range already meets\./);
    assert.match(proteinTarget({ goals: [g('health')], age: 70, training: false }).reason.note!, /at least 1 g\/kg \(Bauer 2013\)/);
    assert.doesNotMatch(proteinTarget({ goals: [g('health')], age: 64 }).reason.note!, /Bauer/);
  });

  it('no goals: the lifting range; no trend weight: no grams', () => {
    const r = proteinTarget({ goals: [] });
    assert.deepEqual([r.value.tier, r.value.grams, r.value.targetG], ['lifting', null, null]);
    assert.match(r.reason.note!, /No goals yet, so the lifting range.*No trend weight yet, so no grams/);
  });

  it('a profile: its goals and age from the birth year on the date', () => {
    const r = proteinForProfile({ goals: [{ id: 'h', kind: 'health', label: 'Health', importance: 8, confidence: 7 }], basics: { birthYear: 1958 } }, 70, '2026-04-10');
    assert.deepEqual([r.reason.inputs['age'], r.value.targetG], [68, 84]);
    assert.equal(proteinForProfile(null, 80, '2026-04-10').value.targetG, 128);
  });

  it('the protein item: a tick named Protein, with the id protein, or linked to the Protein habit', () => {
    assert.deepEqual(
      [{ id: 'protein', kind: 'tick', name: 'P' }, { id: 'x', kind: 'tick', name: 'Protein (150 g)' }, { id: 'y', kind: 'tick', name: 'Eat', habit: 'protein' }, { id: 'protein', kind: 'supplement', name: 'Protein shake' }].map((x) => isProteinItem(x as never)),
      [true, true, true, false],
    );
  });
});

describe('the protein item follows the tier', () => {
  const fatLoss = (f: Record<string, string>) => {
    const k = 'v/3-Personal/Fitness/Coach/profile.json';
    const p = JSON.parse(f[k]!);
    p.goals = [{ id: 'cut', kind: 'fat-loss', label: 'Fat loss', importance: 9, confidence: 7 }];
    f[k] = JSON.stringify(p);
  };
  const cli = (argv: string[], edit: (f: Record<string, string>) => void = () => {}) => {
    const f = fixtureFiles('v');
    edit(f);
    return JSON.parse(run(argv, { ...memoryIo(f, '2026-04-10'), clock: () => ({ minutes: 13 * 60, offsetMinutes: 0 }) }).stdout) as Json;
  };

  it('review: weight.protein with its reason, and proteinFloorG its floor (the fixture\'s recomposition: 1.6, as the snippet)', () => {
    const w = cli(['review', '--vault', 'v', '--date', '2026-04-10']).weight;
    assert.deepEqual([w.protein.value.tier, w.protein.value.gPerKg, w.proteinFloorG], ['lifting', [1.6, 2.2], w.protein.value.targetG]);
    const cut = cli(['review', '--vault', 'v', '--date', '2026-04-10'], fatLoss).weight;
    assert.deepEqual([cut.protein.value.gPerKg, cut.proteinFloorG], [[1.9, 2.2], Math.round(1.9 * cut.trend.value.latest.trend)]);
  });

  it('the bring-over\'s protein item and the check-in question take the tier\'s floor', () => {
    const cut = cli(['bring-over', '--vault', 'v', '--date', '2026-04-10'], (f) => {
      fatLoss(f);
      delete f['v/3-Personal/Fitness/Coach/tracking.json'];
    });
    const p = cut.offer.value.items.find((x: Json) => x.item.id === 'protein').item;
    const floor = cli(['review', '--vault', 'v', '--date', '2026-04-10'], fatLoss).weight.proteinFloorG;
    assert.deepEqual(p.goal, { amount: floor, unit: 'g' });
    const q = cli(['checkin', 'template', '--vault', 'v', '--date', '2026-04-12'], fatLoss).ask.find((a: Json) => a.topic === 'protein');
    assert.match(q.question, new RegExp(`about ${floor} g of protein`));
  });

  it('tracked shows the engine\'s target beside the protein item, and whether the item follows it', () => {
    const t = cli(['tracked', '--vault', 'v', '--date', '2026-04-10']);
    assert.deepEqual([t.protein.value.targetG, t.protein.items], [134, [{ id: 'protein', goal: 134, follows: true, by: 'coach' }]]);
    const cut = cli(['tracked', '--vault', 'v', '--date', '2026-04-10'], fatLoss);
    assert.deepEqual(cut.protein.items[0].follows, false);
    assert.match(cut.protein.note, /track protein/);
  });
});
