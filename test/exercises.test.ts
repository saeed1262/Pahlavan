import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { NAME_SYNONYMS, ownNames } from '../src/adapters/vault/catalogue-match.ts';
import { CATALOGUE, CATALOGUE_BY_ID, EQUIPMENT, LEVELS, MOVEMENT_TAGS, MOVEMENT_USES, PATTERNS, STARTER_CATALOGUE, STARTER_IDS, usableWith, type Equipment } from '../src/core/data/exercises.ts';
import { CATALOGUE_LADDERS } from '../src/core/data/ladders.ts';
import { MUSCLE_IDS } from '../src/core/data/muscles.ts';
import { REGIONS_BY_ID } from '../src/core/data/regions.ts';
import type { Exercise, LedgerConstraint, SessionTemplate } from '../src/core/schema.ts';
import { hotelVariant, VARIANT } from '../src/core/variant.ts';
import { ROOT } from './helpers.ts';

describe('exercise catalogue', () => {
  it('holds 200-260 movements with unique ids', () => {
    assert.ok(CATALOGUE.length >= 200 && CATALOGUE.length <= 260, String(CATALOGUE.length));
    assert.equal(CATALOGUE_BY_ID.size, CATALOGUE.length);
    for (const e of CATALOGUE) assert.match(e.id, /^[a-z0-9][a-z0-9-]*$/, e.id);
  });

  it('uses known patterns, equipment, levels and muscles', () => {
    for (const e of CATALOGUE) {
      assert.ok((PATTERNS as readonly string[]).includes(e.pattern), e.id);
      assert.ok(e.equipment.length > 0 && e.equipment.every((q) => (EQUIPMENT as readonly string[]).includes(q)), e.id);
      assert.ok((LEVELS as readonly string[]).includes(e.level), e.id);
      for (const m of [...e.muscles.main, ...e.muscles.helps]) assert.ok(MUSCLE_IDS.includes(m), `${e.id}: ${m}`);
      // Mobility and conditioning carry no muscles (never counted as sets); every other movement has a main muscle.
      if (e.pattern === 'mobility' || e.pattern === 'conditioning') assert.deepEqual(e.muscles, { main: [], helps: [] }, e.id);
      else assert.ok(e.muscles.main.length > 0, `${e.id} has main muscles`);
    }
  });

  it('tags only regions it knows, each once, with the region\'s parent a main or helping muscle (region credit needs it)', () => {
    for (const e of CATALOGUE) {
      if (e.regions === undefined) continue;
      assert.ok(e.regions.length > 0, `${e.id}: left out when it biases none`);
      assert.equal(new Set(e.regions).size, e.regions.length, e.id);
      for (const r of e.regions) {
        const region = REGIONS_BY_ID.get(r);
        assert.ok(region, `${e.id}: ${r}`);
        assert.ok([...e.muscles.main, ...e.muscles.helps].includes(region.muscle), `${e.id}: ${r} needs ${region.muscle} in main or helps`);
      }
    }
  });

  it('tags the region each kind of movement biases', () => {
    const regionsOf = (id: string) => CATALOGUE.find((e) => e.id === id)?.regions ?? [];
    // The leg extension grows the vasti about as much as squats do, and the rectus femoris besides.
    assert.deepEqual(regionsOf('leg-extension'), ['quads-rf', 'quads-vasti']);
    for (const id of ['back-squat', 'goblet-squat', 'leg-press', 'bulgarian-split-squat', 'reverse-lunge']) assert.deepEqual(regionsOf(id), ['quads-vasti'], id);
    for (const id of ['rdl', 'db-rdl', 'deadlift', 'back-extension']) assert.deepEqual(regionsOf(id), ['hamstrings-hip'], id);
    // Every leg curl counts at the knee only: the hip-extension region is for hinges, whatever the hip angle.
    for (const id of ['seated-leg-curl', 'lying-leg-curl', 'slider-leg-curl']) assert.deepEqual(regionsOf(id), ['hamstrings-knee'], id);
    assert.deepEqual(regionsOf('calf-raise'), ['calves-gastroc', 'calves-soleus']);
    // Knees bent, the gastrocnemius is slack: the seated raise loads the soleus only.
    assert.deepEqual(regionsOf('seated-calf-raise'), ['calves-soleus']);
    for (const id of ['overhead-db-extension', 'cable-overhead-triceps-extension']) assert.deepEqual(regionsOf(id), ['triceps-long'], id);
    assert.deepEqual(regionsOf('cable-pushdown'), [], 'pushdowns grow the long head less');
    for (const id of ['bench-press', 'db-bench', 'push-up']) assert.deepEqual(regionsOf(id), ['shoulders-front'], id);
    assert.deepEqual(regionsOf('incline-db-press'), ['chest-upper', 'shoulders-front']);
    // A pec deck grew both heads of the chest evenly (Pinto 2025).
    assert.deepEqual(regionsOf('pec-deck'), []);
    for (const id of ['overhead-press', 'db-shoulder-press']) assert.deepEqual(regionsOf(id), ['shoulders-front', 'shoulders-side'], id);
    for (const id of ['db-lateral-raise', 'cable-lateral-raise', 'band-lateral-raise']) assert.deepEqual(regionsOf(id), ['shoulders-side'], id);
    for (const id of ['face-pull', 'band-pull-apart', 'reverse-db-fly', 'reverse-pec-deck']) assert.deepEqual(regionsOf(id), ['shoulders-rear', 'upper-back-mid'], id);
    for (const id of ['db-row', 'seated-cable-row', 'inverted-row']) assert.deepEqual(regionsOf(id), ['upper-back-mid'], id);
    for (const id of ['db-shrug', 'farmer-carry']) assert.deepEqual(regionsOf(id), ['upper-back-traps'], id);
    for (const id of ['hip-thrust', 'glute-bridge', 'lat-pulldown', 'pull-up', 'db-curl', 'plank', 'hip-abduction-machine']) assert.deepEqual(regionsOf(id), [], id);
    for (const e of CATALOGUE.filter((x) => x.load === 'cardio' || x.pattern === 'mobility' || x.pattern === 'conditioning')) assert.equal(e.regions, undefined, e.id);
  });

  it('tags the later movements by the same rules as their families', () => {
    const regionsOf = (id: string) => CATALOGUE_BY_ID.get(id)!.regions ?? [];
    const of = (pattern: string) => CATALOGUE.filter((e) => e.pattern === pattern);
    // Every squat and lunge driven by the quads biases the vasti; the leg extension the rectus femoris too.
    for (const e of [...of('squat'), ...of('lunge')].filter((x) => x.muscles.main.includes('quads') && x.id !== 'leg-extension')) assert.deepEqual(e.regions, ['quads-vasti'], e.id);
    // Every press biases the front delts, the incline presses the upper chest too; the overhead presses the side delts too (the landmine press, at an angle, the front only).
    for (const e of of('horizontal-push')) assert.deepEqual(e.regions, e.id.startsWith('incline-') && e.id !== 'incline-push-up' ? ['chest-upper', 'shoulders-front'] : ['shoulders-front'], e.id);
    for (const e of of('vertical-push')) assert.deepEqual(e.regions, e.id === 'landmine-press' ? ['shoulders-front'] : ['shoulders-front', 'shoulders-side'], e.id);
    // Every row loads the mid-back; flies bias no region, as the pec deck does.
    for (const e of of('horizontal-pull')) assert.deepEqual(e.regions, ['upper-back-mid'], e.id);
    for (const e of of('chest-fly')) assert.equal(e.regions, undefined, e.id);
    // Hinges at the hip, curls at the knee.
    for (const id of ['kb-deadlift', 'trap-bar-deadlift', 'kickstand-rdl', 'kb-swing', 'single-arm-kb-swing', 'kb-clean', 'cable-pull-through', 'hip-hinge-drill']) assert.deepEqual(regionsOf(id), ['hamstrings-hip'], id);
    for (const id of ['stability-ball-leg-curl', 'nordic-negative', 'nordic-curl']) assert.deepEqual(regionsOf(id), ['hamstrings-knee'], id);
    // A standing raise on one leg is a standing raise: both calf regions, the gastrocnemius long.
    assert.deepEqual([regionsOf('single-leg-calf-raise'), CATALOGUE_BY_ID.get('single-leg-calf-raise')!.longLength], [['calves-gastroc', 'calves-soleus'], ['calves-gastroc']]);
    assert.deepEqual(regionsOf('prone-y-raise'), ['shoulders-rear', 'upper-back-mid']);
    // The squat-shaped jumps bias the vasti as squats do; the handstand holds, like the wall handstand, bias none.
    for (const id of ['snap-down', 'squat-jump', 'box-jump', 'skater-bound', 'shrimp-squat']) assert.deepEqual(regionsOf(id), ['quads-vasti'], id);
    for (const id of ['box-pike-hold', 'wall-walk', 'freestanding-handstand', 'l-sit', 'band-external-rotation', 'sled-push', 'pogo-hop']) assert.deepEqual(regionsOf(id), [], id);
  });

  it('covers every pattern', () => {
    for (const p of PATTERNS) assert.ok(CATALOGUE.some((e) => e.pattern === p), p);
  });

  it('has alternatives that resolve and never point at themselves', () => {
    for (const e of CATALOGUE) {
      for (const a of [...e.easier, ...e.harder]) {
        assert.ok(CATALOGUE_BY_ID.has(a), `${e.id} -> ${a}`);
        assert.notEqual(a, e.id);
      }
    }
  });

  it('links each added movement into its chain, and its neighbours back to it', () => {
    const e = (id: string) => {
      const x = CATALOGUE_BY_ID.get(id);
      assert.ok(x, id);
      return x;
    };
    const added = ['lying-leg-curl', 'slider-leg-curl', 'seated-calf-raise', 'band-lateral-raise', 'reverse-pec-deck', 'cable-overhead-triceps-extension', 'pec-deck', 'hip-abduction-machine', 'db-shrug'];
    for (const id of added) assert.ok(e(id).easier.length + e(id).harder.length > 0, `${id} has an alternative`);
    // [easier, harder]: each pair links both ways.
    const pairs: [string, string][] = [
      ['band-lateral-raise', 'db-lateral-raise'],
      ['band-lateral-raise', 'cable-lateral-raise'],
      ['calf-raise', 'seated-calf-raise'],
      ['overhead-db-extension', 'cable-overhead-triceps-extension'],
      ['cable-pushdown', 'cable-overhead-triceps-extension'],
      ['band-pull-apart', 'reverse-pec-deck'],
      ['banded-side-walk', 'hip-abduction-machine'],
      ['db-shrug', 'farmer-carry'],
    ];
    for (const [lo, hi] of pairs) {
      assert.ok(e(lo).harder.includes(hi), `${lo} harder ${hi}`);
      assert.ok(e(hi).easier.includes(lo), `${hi} easier ${lo}`);
    }
    // Nearest first: the cable overhead extension is the dumbbell one on a cable.
    assert.equal(e('overhead-db-extension').harder[0], 'cable-overhead-triceps-extension');
    // A neighbour's first alternative, the one progression and soreness use, stays.
    assert.equal(e('calf-raise').harder[0], 'machine-calf-raise');
    assert.equal(e('farmer-carry').easier[0], 'suitcase-carry');
    // Machine isolation leads to the compound for the same muscle, as the leg extension does.
    assert.deepEqual([e('pec-deck').harder, e('lying-leg-curl').harder], [['machine-chest-press'], ['db-rdl']]);
    // The slider curl starts from the bridge (or the ball curl) and leads to the Nordic lowering, a
    // bodyweight knee curl; a machine curl is another tool, neither its step down nor its next step.
    assert.deepEqual([e('slider-leg-curl').easier, e('slider-leg-curl').harder], [['glute-bridge', 'stability-ball-leg-curl'], ['nordic-negative']]);
    for (const id of ['seated-leg-curl', 'lying-leg-curl']) assert.ok(![...e(id).easier, ...e(id).harder].includes('slider-leg-curl'), id);
  });

  it('has the options the added movements are for', () => {
    // Hamstrings at the knee with no equipment, past a beginner's level.
    const slider = CATALOGUE_BY_ID.get('slider-leg-curl')!;
    assert.deepEqual([slider.equipment, slider.level, slider.load, slider.regions], [['bodyweight'], 'intermediate', 'bodyweight', ['hamstrings-knee']]);
    // Side delts with neither dumbbells nor a cable.
    assert.ok(CATALOGUE.some((x) => x.regions?.includes('shoulders-side') && x.pattern === 'lateral-raise' && x.equipment.every((q) => q === 'band')));
    // An abduction machine is not single-leg work: its own pattern, so no lunge slot takes it.
    assert.equal(CATALOGUE_BY_ID.get('hip-abduction-machine')!.pattern, 'hip-abduction');
    assert.ok(CATALOGUE.filter((x) => x.pattern === 'lunge' && x.equipment[0] === 'machine').length === 0);
  });

  it('includes the regressions the body-assessment table names', () => {
    const named = ['heel-elevated-goblet-squat', 'box-squat', 'landmine-press', 'incline-db-press', 'incline-push-up', 'tempo-goblet-squat', 'split-squat', 'banded-side-walk', 'dead-bug', 'hollow-hold', 'glute-bridge', 'face-pull', 'reverse-db-fly', 'band-pull-apart', 'ankle-mobility', 'thoracic-extension', 'chest-doorway-stretch', 'lat-stretch', 'hip-flexor-stretch', 'single-leg-stance'];
    for (const id of named) assert.ok(CATALOGUE_BY_ID.has(id), id);
  });
});

describe('exercise catalogue: every entry complete, and linked both ways', () => {
  const LEVEL: Record<string, number> = { beginner: 0, intermediate: 1, advanced: 2 };
  const EM_DASH = String.fromCharCode(0x2014);

  it('gives every entry its other names, stand-in tools, demand tags, roles and guide text', () => {
    for (const e of CATALOGUE) {
      assert.equal(new Set(e.aliases).size, e.aliases.length, e.id);
      for (const a of e.aliases) assert.ok(a.trim() && !a.includes(EM_DASH), `${e.id}: "${a}"`);
      assert.ok(e.alsoWith.every((q) => (EQUIPMENT as readonly string[]).includes(q)), e.id);
      assert.ok(!e.alsoWith.includes(e.equipment[0]!), `${e.id}: alsoWith repeats the defining tool`);
      for (const t of e.risk) assert.ok(t in MOVEMENT_TAGS, `${e.id}: ${t}`);
      for (const u of e.uses) assert.ok(u in MOVEMENT_USES, `${e.id}: ${u}`);
      assert.equal(new Set(e.risk).size, e.risk.length, e.id);
      for (const k of ['setup', 'do', 'avoid'] as const) {
        const t = e.guide[k];
        assert.match(t, /^[A-Z0-9][^]*[.]$/, `${e.id} ${k}: a sentence`);
        assert.ok(t.length <= 160 && !t.includes(EM_DASH), `${e.id} ${k}`);
      }
    }
  });

  it('links each movement both ways: B harder than A means A easier than B', () => {
    for (const e of CATALOGUE) {
      for (const t of e.harder) assert.ok(CATALOGUE_BY_ID.get(t)!.easier.includes(e.id), `${e.id} harder ${t}, but ${t} does not list it as easier`);
      for (const t of e.easier) assert.ok(CATALOGUE_BY_ID.get(t)!.harder.includes(e.id), `${e.id} easier ${t}, but ${t} does not list it as harder`);
      assert.ok(!e.easier.some((t) => e.harder.includes(t)), `${e.id}: a movement both easier and harder`);
      assert.equal(new Set([...e.easier, ...e.harder]).size, e.easier.length + e.harder.length, e.id);
    }
  });

  it('never links a harder movement at a lower level, nor an easier one at a higher level', () => {
    // The tempo goblet squat (intermediate) leads to the back squat (a beginner lift loaded light): kept as it was, an open question.
    const known = new Set(['tempo-goblet-squat back-squat']);
    for (const e of CATALOGUE) {
      for (const t of e.harder) if (!known.has(`${e.id} ${t}`)) assert.ok(LEVEL[CATALOGUE_BY_ID.get(t)!.level]! >= LEVEL[e.level]!, `${e.id} (${e.level}) harder ${t}`);
      for (const t of e.easier) if (!known.has(`${t} ${e.id}`)) assert.ok(LEVEL[CATALOGUE_BY_ID.get(t)!.level]! <= LEVEL[e.level]!, `${e.id} (${e.level}) easier ${t}`);
    }
  });

  it('never comes back round: following harder links from a movement never returns to it', () => {
    const state = new Map<string, 1 | 2>();
    const visit = (id: string, path: string[]) => {
      state.set(id, 1);
      for (const h of CATALOGUE_BY_ID.get(id)!.harder) {
        assert.notEqual(state.get(h), 1, `a circle: ${[...path, id, h].join(' > ')}`);
        if (!state.has(h)) visit(h, [...path, id]);
      }
      state.set(id, 2);
    };
    for (const e of CATALOGUE) if (!state.has(e.id)) visit(e.id, []);
  });

  it('links related movements only: the same pattern or a shared muscle, or a mobility drill leading into the movement it prepares', () => {
    const trained = (id: string) => new Set([...CATALOGUE_BY_ID.get(id)!.muscles.main, ...CATALOGUE_BY_ID.get(id)!.muscles.helps]);
    for (const e of CATALOGUE) {
      for (const t of [...e.easier, ...e.harder]) {
        const o = CATALOGUE_BY_ID.get(t)!;
        const related = e.pattern === o.pattern || e.pattern === 'mobility' || o.pattern === 'mobility' || [...trained(e.id)].some((m) => trained(t).has(m));
        assert.ok(related, `${e.id} - ${t}`);
      }
    }
  });

  it('gives every movement a way to change, and every movement above beginner a way down', () => {
    for (const e of CATALOGUE) {
      assert.ok(e.easier.length + e.harder.length > 0, e.id);
      if (e.level !== 'beginner') assert.ok(e.easier.length > 0, `${e.id} (${e.level}) has no easier option`);
    }
  });

  it('marks a movement hotel-friendly only when the travel kit, or a tool that stands in, is enough and it is not advanced', () => {
    const kit = new Set<Equipment>(VARIANT.hotelEquipment);
    for (const e of CATALOGUE.filter((x) => x.hotel)) {
      assert.ok(usableWith(e, kit), `${e.id} needs ${e.equipment.join(' and ')}`);
      assert.notEqual(e.level, 'advanced', e.id);
    }
    // Set by hand: unsafe furniture, an anchor, room to swing or to bail, and repeated jumping rule these out.
    for (const id of ['inverted-row', 'nordic-curl', 'kb-swing', 'handstand-kick-up', 'squat-jump', 'burpee']) assert.equal(CATALOGUE_BY_ID.get(id)!.hotel, false, id);
    // A stand-in tool counts: the kettlebell press with a dumbbell.
    assert.equal(CATALOGUE_BY_ID.get('kb-press')!.hotel, true);
  });

  it('gives each movement names of its own: no name, id or alias shared, and no synonym standing in for another movement\'s own name', () => {
    const owner = new Map<string, string>();
    for (const e of CATALOGUE) {
      for (const n of ownNames(e)) {
        assert.ok(n, `${e.id}: a name that normalizes to nothing`);
        const prev = owner.get(n);
        assert.ok(!prev || prev === e.id, `"${n}" is a name of ${prev} and ${e.id}`);
        owner.set(n, e.id);
      }
    }
    for (const [name, id] of Object.entries(NAME_SYNONYMS)) {
      const own = owner.get(name);
      assert.ok(!own || own === id, `the synonym "${name}" points at ${id}, but it is ${own}'s own name`);
    }
  });

  it('chains each catalogue ladder along the harder links, easiest first', () => {
    assert.equal(new Set(CATALOGUE_LADDERS.map((l) => l.id)).size, CATALOGUE_LADDERS.length);
    for (const l of CATALOGUE_LADDERS) {
      assert.ok(l.steps.length >= 2, l.id);
      l.steps.forEach((s, i) => {
        assert.ok(CATALOGUE_BY_ID.has(s), `${l.id}: ${s}`);
        const next = l.steps[i + 1];
        if (next) assert.ok(CATALOGUE_BY_ID.get(s)!.harder.includes(next), `${l.id}: ${s} does not list ${next} as harder`);
      });
    }
  });

  it('keeps the Hotel version\'s swaps on the starter movements', () => {
    assert.equal(STARTER_IDS.size, 100);
    for (const id of STARTER_IDS) assert.ok(CATALOGUE_BY_ID.has(id), id);
    assert.deepEqual(STARTER_CATALOGUE.map((e) => e.id), CATALOGUE.filter((e) => STARTER_IDS.has(e.id)).map((e) => e.id));
    const f = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'rules', 'variants.json'), 'utf8')) as { template: SessionTemplate; exercises: Record<string, Exercise>; ledger: LedgerConstraint[]; date: string };
    const r = hotelVariant({ template: f.template, exercises: f.exercises, catalogueOf: (id) => CATALOGUE_BY_ID.get(id) ?? null, ledger: f.ledger, date: f.date, unit: 'kg' });
    const swapped = r.value.slots.filter((s, i) => s.exercise !== f.template.slots[i]!.exercise);
    assert.ok(swapped.length > 0, 'the fixture\'s gym session needs swaps');
    for (const s of swapped) assert.ok(STARTER_IDS.has(s.exercise), s.exercise);
  });
});
