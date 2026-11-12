// The Movements tab's report: the whole catalogue in groups by pattern with
// plain titles, the search as you type ("row" gives the rows), the muscle,
// level and pattern filters, "My equipment" from the profile, the plan's
// movements and ladders marked, each movement's guide on the body map, and
// a filter the catalogue doesn't know as a note, never an error. It also
// works with no plan and no profile.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../src/adapters/vault/read.ts';
import { CATALOGUE, CATALOGUE_BY_ID, PATTERNS, usableWith } from '../src/core/data/exercises.ts';
import { normalizeEquipment } from '../src/core/plan/context.ts';
import { buildMovements, planLevelsOf, planNamesOf, plainName, type MovementsOptions, type MovementsScreen } from '../src/report/movements-screen.ts';
import { fixtureFiles, memoryIo } from './helpers.ts';

const DATE = '2026-04-10';
const read = readVault(memoryIo(fixtureFiles('v'), DATE), 'v', { asOf: DATE });
const plan = read.raw?.plan as { ladders?: unknown } | undefined;
const OPTS: MovementsOptions = {
  planLadders: plan?.ladders,
  planNames: planNamesOf(read.raw?.plan, read.raw?.log),
  planLevels: planLevelsOf(read.raw?.plan, read.raw?.log),
  equipment: read.data.profile?.equipment ?? null,
};
const rows = (m: MovementsScreen) => m.groups.flatMap((g) => g.rows);

describe('the Movements tab: the catalogue in groups', () => {
  it('with nothing asked, every movement in its pattern group, in the catalogue’s group order, with plain titles', () => {
    const m = buildMovements({}, OPTS);
    assert.equal(m.total, CATALOGUE.length);
    assert.equal(m.count, CATALOGUE.length);
    assert.equal(m.filtered, false);
    assert.equal(m.countText, `${CATALOGUE.length} movements in ${PATTERNS.length} groups`);
    assert.deepEqual(m.groups.map((g) => g.pattern), [...PATTERNS]);
    assert.equal(m.groups.find((g) => g.pattern === 'horizontal-pull')!.title, 'Rows');
    assert.equal(m.groups.find((g) => g.pattern === 'core-anti-extension')!.title, 'Core: bracing');
    for (const g of m.groups) for (const r of g.rows) assert.equal(r.pattern, g.pattern);
    assert.equal(new Set(rows(m).map((r) => r.id)).size, CATALOGUE.length);
  });

  it('a row in plain words: level, load, tools and stand-ins, what it works, its easier and harder steps', () => {
    const goblet = rows(buildMovements({}, OPTS)).find((r) => r.id === 'goblet-squat')!;
    const e = CATALOGUE_BY_ID.get('goblet-squat')!;
    assert.equal(goblet.levelText, { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' }[e.level]);
    assert.equal(goblet.loadText, 'added weight');
    assert.equal(goblet.equipmentText, 'Dumbbell');
    assert.equal(goblet.alsoWithText, 'kettlebell');
    assert.match(goblet.works, /^Quads, glutes/);
    assert.deepEqual(goblet.easier.map((x) => x.id), e.easier);
    assert.deepEqual(goblet.harder.map((x) => x.id), e.harder);
    for (const l of [...goblet.easier, ...goblet.harder]) assert.equal(l.name, CATALOGUE_BY_ID.get(l.id)!.name);
    const bw = rows(buildMovements({}, OPTS)).find((r) => r.id === 'bodyweight-squat')!;
    assert.equal(bw.equipmentText, 'No equipment');
  });

  it('each movement’s guide: its own setup, do and avoid, its muscles on the body map, a video search by its plain name', () => {
    const r = rows(buildMovements({}, OPTS)).find((x) => x.id === 'inverted-row')!;
    const e = CATALOGUE_BY_ID.get('inverted-row')!;
    assert.equal(r.guide.title, e.name);
    assert.equal(r.guide.setup, e.guide.setup);
    assert.equal(r.guide.do, e.guide.do);
    assert.equal(r.guide.avoid, e.guide.avoid);
    // Lats and upper back as main muscles on the body-map slugs, the helpers lighter.
    assert.deepEqual(r.guide.main, ['upper-back', 'trapezius']);
    assert.ok(r.guide.helps.includes('biceps') && r.guide.helps.includes('forearm'));
    assert.equal(r.guide.video.checked, false);
    assert.equal(r.guide.video.label, 'Search YouTube: Inverted row');
    assert.match(r.guide.video.url, /^https:\/\/www\.youtube\.com\/results\?search_query=Inverted%20row$/);
    // Every movement has a guide with all three lines.
    for (const x of rows(buildMovements({}, OPTS))) assert.ok(x.guide.setup && x.guide.do && x.guide.avoid, x.id);
  });

  it('a cardio or mobility movement without muscles says so in place of the muscles', () => {
    const all = rows(buildMovements({}, OPTS));
    const mob = all.find((r) => r.pattern === 'mobility' && !CATALOGUE_BY_ID.get(r.id)!.muscles.main.length)!;
    assert.equal(mob.works, 'Mobility');
    assert.deepEqual(mob.guide.main, []);
  });
});

describe('the Movements tab: search and filters', () => {
  it('search "row" gives the rows first, every result matching the words', () => {
    const m = buildMovements({ text: 'row' }, OPTS);
    assert.equal(m.filtered, true);
    assert.equal(m.groups[0]!.pattern, 'horizontal-pull');
    assert.ok(m.groups[0]!.rows.length >= 10);
    assert.ok(m.count < m.total);
    assert.equal(m.countText, `${m.count} of ${m.total} movements`);
    for (const r of rows(m)) assert.ok(/row/i.test(r.name) || r.aka.some((a) => /row/i.test(a)) || r.pattern === 'horizontal-pull' || /rowing/i.test(r.name), r.name);
    assert.ok(rows(m).some((r) => r.id === 'inverted-row'));
  });

  it('blank or spaces only is no search', () => {
    assert.equal(buildMovements({ text: '   ' }, OPTS).count, CATALOGUE.length);
    assert.equal(buildMovements({ text: '   ' }, OPTS).filtered, false);
  });

  it('a muscle filter keeps the movements that train it (main or helping), main first', () => {
    const m = buildMovements({ muscle: 'glutes' }, OPTS);
    const ids = rows(m).map((r) => r.id);
    assert.ok(ids.length > 10);
    for (const id of ids) {
      const e = CATALOGUE_BY_ID.get(id)!;
      assert.ok(e.muscles.main.includes('glutes') || e.muscles.helps.includes('glutes'), id);
    }
    // The label works as the id does.
    assert.deepEqual(rows(buildMovements({ muscle: 'Glutes' }, OPTS)).map((r) => r.id), ids);
    assert.ok(CATALOGUE_BY_ID.get(m.groups[0]!.rows[0]!.id)!.muscles.main.includes('glutes'));
    assert.equal(m.query.muscle, 'glutes');
  });

  it('a pattern filter keeps one group; a level filter keeps that level only', () => {
    const p = buildMovements({ pattern: 'vertical-pull' }, OPTS);
    assert.deepEqual(p.groups.map((g) => g.pattern), ['vertical-pull']);
    assert.equal(p.count, CATALOGUE.filter((e) => e.pattern === 'vertical-pull').length);
    const l = buildMovements({ level: 'beginner' }, OPTS);
    assert.ok(l.count > 0 && l.count < l.total);
    for (const r of rows(l)) assert.equal(r.level, 'beginner');
    // The profile's "novice" reads as beginner.
    assert.equal(buildMovements({ level: 'novice' }, OPTS).count, l.count);
  });

  it('the filter choices: every group with its size, every muscle, the three levels', () => {
    const o = buildMovements({}, OPTS).options;
    assert.deepEqual(o.patterns.map((p) => p.id), [...PATTERNS]);
    assert.equal(o.patterns.reduce((n, p) => n + p.count, 0), CATALOGUE.length);
    assert.equal(o.patterns.find((p) => p.id === 'horizontal-pull')!.label, 'Rows');
    assert.ok(o.muscles.some((x) => x.id === 'upper-back' && x.label === 'Upper back'));
    assert.deepEqual(o.levels.map((x) => x.label), ['Beginner', 'Intermediate', 'Advanced']);
  });

  it('nothing matches: no groups, no ladders, a plain count line', () => {
    const m = buildMovements({ text: 'zzzz' }, OPTS);
    assert.equal(m.count, 0);
    assert.deepEqual(m.groups, []);
    assert.deepEqual(m.ladders, []);
    assert.equal(m.countText, 'No movement matches');
  });
});

describe('the Movements tab: your equipment and your plan', () => {
  it('each row says whether your equipment covers it, and what it needs when not', () => {
    const have = normalizeEquipment(OPTS.equipment!).equipment;
    for (const r of rows(buildMovements({}, OPTS))) {
      assert.equal(r.withYours, usableWith(CATALOGUE_BY_ID.get(r.id)!, have), r.id);
      assert.equal(r.needs.length === 0, r.withYours, r.id);
    }
    const ring = rows(buildMovements({}, OPTS)).find((r) => r.id === 'ring-row')!;
    assert.equal(ring.withYours, false);
    assert.deepEqual(ring.needs, ['rings']);
  });

  it('"My equipment" narrows the list to what the profile covers, and names the words it doesn’t know', () => {
    const all = buildMovements({}, OPTS);
    const mine = buildMovements({ mine: true }, OPTS);
    assert.equal(mine.query.mine, true);
    assert.ok(mine.count > 0 && mine.count < all.count);
    for (const r of rows(mine)) assert.equal(r.withYours, true, r.id);
    assert.equal(mine.count, rows(all).filter((r) => r.withYours).length);
    // The fixture's profile lists a "rowing machine", a word Pahlavan doesn't know.
    assert.deepEqual(mine.equipment, { listed: true, unknown: ['rowing machine'] });
    assert.match(mine.notes.find((n) => n.code === 'unknown-equipment')!.text, /rowing machine/);
    // With the search too.
    const rowsMine = buildMovements({ text: 'row', mine: true }, OPTS);
    assert.ok(rowsMine.count < buildMovements({ text: 'row' }, OPTS).count);
  });

  it('the plan’s movements are marked, a ladder item at its level and a combined line piece by piece', () => {
    const marked = rows(buildMovements({}, OPTS)).filter((r) => r.inPlan).map((r) => r.id);
    // Goblet Squat and Seated Cable Row by name; Floor push-up is the push-up ladder's level now; the circuit's burpee.
    for (const id of ['goblet-squat', 'seated-cable-row', 'push-up', 'burpee', 'squat-jump']) assert.ok(marked.includes(id), id);
    assert.ok(!marked.includes('back-squat'), 'a guide entry the sessions don’t name is not in the plan');
  });

  it('the ladders: the plan’s own first with the level you are on, then the self-check’s, then the catalogue’s', () => {
    const m = buildMovements({}, OPTS);
    const sources = m.ladders.map((l) => l.source);
    assert.deepEqual([...new Set(sources)], ['plan', 'engine', 'catalogue']);
    assert.equal(new Set(m.ladders.map((l) => l.key)).size, m.ladders.length);
    const push = m.ladders.find((l) => l.key === 'plan:pushup')!;
    assert.equal(push.sourceText, 'Your plan');
    const now = push.steps.filter((s) => s.now);
    assert.equal(now.length, 1);
    assert.equal(now[0]!.level, OPTS.planLevels!['pushup']);
    assert.ok(push.steps.every((s) => !s.inPlan), 'the plan’s own ladder marks the level, not every step');
    // On the catalogue's, the steps your plan trains.
    const cat = m.ladders.find((l) => l.key === 'catalogue:push-up')!;
    assert.ok(cat.steps.find((s) => s.id === 'push-up')!.inPlan);
    assert.equal(cat.steps.find((s) => s.id === 'wall-push-up')!.search, plainName(CATALOGUE_BY_ID.get('wall-push-up')!.name));
  });

  it('each ladder once, each with its own title: the plan’s copy of a self-check ladder stays, a second name gets its range', () => {
    const m = buildMovements({}, OPTS);
    const titles = m.ladders.map((l) => l.title.toLowerCase());
    assert.equal(new Set(titles).size, titles.length, 'no two ladders share a title');
    // The plan's push-up ladder is the self-check's (its levels word for word): shown once, as the plan's.
    assert.ok(m.ladders.some((l) => l.key === 'plan:pushup'));
    assert.ok(!m.ladders.some((l) => l.key === 'engine:pushup'));
    assert.ok(m.ladders.some((l) => l.key === 'engine:pullup'), 'a self-check ladder the plan lacks stays');
    assert.equal(m.ladders.find((l) => l.key === 'plan:pushup')!.title, 'Push-up');
    assert.equal(m.ladders.find((l) => l.key === 'engine:pullup')!.title, 'Pull-up');
    assert.equal(m.ladders.find((l) => l.key === 'catalogue:push-up')!.title, 'Push-up: wall push-up to one-arm push-up');
    assert.equal(m.ladders.find((l) => l.key === 'catalogue:pull-up')!.title, 'Pull-up: dead hang to weighted pull-up');
    // A name used once keeps it.
    assert.equal(m.ladders.find((l) => l.key === 'catalogue:dip')!.title, 'Dip');
    // Without a plan the self-check's push-up shows, and the catalogue's still has its range.
    const bare = buildMovements({}, {});
    assert.ok(bare.ladders.some((l) => l.key === 'engine:pushup' && l.title === 'Push-up'));
    assert.equal(new Set(bare.ladders.map((l) => l.title)).size, bare.ladders.length);
    // A plan ladder with other levels is another ladder: both show, under their own titles.
    const own = buildMovements({}, { planLadders: [{ id: 'pushup', name: 'Push-up', levels: [{ name: 'Knee push-up' }, { name: 'Diamond push-up' }] }] });
    assert.ok(own.ladders.some((l) => l.key === 'engine:pushup'));
    assert.equal(new Set(own.ladders.map((l) => l.title)).size, own.ladders.length);
    // A search keeps each ladder's title.
    assert.equal(buildMovements({ text: 'wall push-up' }, OPTS).ladders.find((l) => l.key === 'catalogue:push-up')!.title, 'Push-up: wall push-up to one-arm push-up');
  });

  it('filtered, only the ladders with a step among the results', () => {
    const m = buildMovements({ text: 'pull-up' }, OPTS);
    const ids = new Set(rows(m).map((r) => r.id));
    assert.ok(m.ladders.length > 0);
    for (const l of m.ladders) assert.ok(l.steps.some((s) => s.id !== null && ids.has(s.id)), l.key);
    assert.ok(!m.ladders.some((l) => l.key === 'catalogue:balance'));
  });
});

describe('the Movements tab never throws on the query', () => {
  it('an unknown pattern, muscle or level is left out with a note', () => {
    const m = buildMovements({ pattern: 'juggling', muscle: 'spleen', level: 'expert', text: 'squat' }, OPTS);
    assert.deepEqual(m.notes.map((n) => n.code), ['unknown-pattern', 'unknown-muscle', 'unknown-level']);
    assert.deepEqual(m.query, { text: 'squat', pattern: null, muscle: null, level: null, mine: false });
    assert.equal(m.count, buildMovements({ text: 'squat' }, OPTS).count);
    assert.match(m.notes[0]!.text, /juggling/);
  });

  it('no plan and no profile: the whole catalogue, nothing marked, My equipment off with a note', () => {
    const bare = buildMovements({}, {});
    assert.equal(bare.count, CATALOGUE.length);
    assert.ok(rows(bare).every((r) => !r.inPlan && r.withYours === null && r.needs.length === 0));
    assert.deepEqual(bare.equipment, { listed: false, unknown: [] });
    assert.ok(bare.ladders.every((l) => l.source !== 'plan'));
    const mine = buildMovements({ mine: true }, { equipment: null });
    assert.equal(mine.count, CATALOGUE.length);
    assert.equal(mine.query.mine, false);
    assert.deepEqual(mine.notes.map((n) => n.code), ['no-equipment']);
  });

  it('an empty equipment list is bodyweight only, not no list', () => {
    const m = buildMovements({ mine: true }, { equipment: [] });
    assert.equal(m.equipment.listed, true);
    for (const r of rows(m)) assert.equal(r.equipmentText, 'No equipment', r.id);
  });

  it('a plan file that is not what it should be reads as no plan', () => {
    assert.deepEqual(planNamesOf(null, null), []);
    assert.deepEqual(planNamesOf({ sessions: 'A', ladders: 3 }, 'x'), []);
    assert.deepEqual(planLevelsOf({ ladders: [{ id: 7 }, 'x'] }, null), {});
    assert.equal(buildMovements({}, { planLadders: 'nope', planNames: ['Nothing like it'] }).count, CATALOGUE.length);
  });
});
