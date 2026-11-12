// The plugin's Plan and Progress counts for a ladder item before any level
// is logged: a plan whose pull-up ladder declares startLevel 6 counts the
// item as pull-ups on both screens, as `engine review` does on the same
// files (the plugin reads through the same adapter and review). And the
// Skills card in that state, drawn in Node with the small fake DOM: the
// plan's start in words, Log this level writing it through the same write
// as the ▲ button, and ▲ and ▼ moving from the start.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readVault } from '../../src/adapters/vault/read.ts';
import { guideFor } from '../../src/report/dashboard.ts';
import { buildReview } from '../../src/report/review.ts';
import { PahlavanData } from '../src/data-source.ts';
import { LogWriter } from '../src/log-writer.ts';
import { guidePanel } from '../src/ui/guide.ts';
import { renderMore, type MoreContext } from '../src/ui/progress-more.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';
import { memVault, type MemVault } from './mem-vault.ts';

// Each test file runs in its own process, so the fake stays installed for this one.
installFakeDom();

const PLAN = '3-Personal/Fitness/plan-data.json';
const LOG = '3-Personal/Fitness/fitness-log-data.json';
const DATE = '2026-04-27';
const LEVELS = ['Dead hang', 'Scapular pull-up', 'Inverted row', 'Negative pull-up', 'Band-assisted pull-up', 'Pull-up', 'Weighted pull-up', 'L-sit pull-up'];

/** The synthetic vault with a pull-up ladder item in session A, the ladder starting at `startLevel` when given. */
function vault(startLevel?: number) {
  const v = memVault();
  const plan = v.json(PLAN);
  plan.ladders.push({ id: 'pullup', name: 'Pull-up', levels: LEVELS.map((name) => ({ name })), ...(startLevel ? { startLevel } : {}) });
  plan.laddersFor.A = ['pullup'];
  plan.sessions.A.splice(2, 0, { name: 'Pull-up (your level)', sr: '4 × 3–8', rir: 2, note: 'Why: the main vertical pull.', ladder: 'pullup' });
  v.files.set(PLAN, JSON.stringify(plan));
  return v;
}

const pick = (rows: { muscle: string; sets: number }[]) => Object.fromEntries(rows.filter((r) => ['biceps', 'lats', 'forearms'].includes(r.muscle)).map((r) => [r.muscle, r.sets]));

async function counts(startLevel?: number) {
  const v = vault(startLevel);
  const data = new PahlavanData(v.adapter);
  await data.load(DATE);
  const plan = data.plan(DATE) as { volume: { muscles: { muscle: string; sets: number }[] } };
  const progress = await data.progress(DATE);
  const io = { readText: (p: string) => v.files.get(p) ?? null, listDir: (p: string) => [...new Set([...v.files.keys()].filter((k) => k.startsWith(`${p}/`)).map((k) => k.slice(p.length + 1).split('/')[0]!))] };
  const review = buildReview(readVault(io, '', { asOf: DATE }).data, DATE).volume.planned.value.perWeek;
  return { plan: pick(plan.volume.muscles), progress: pick(progress.volume!.views.plan.muscles), review: { biceps: review['biceps'], lats: review['lats'], forearms: review['forearms'] } };
}

describe('the plugin: a ladder item before any level is logged', () => {
  it('counts the declared start on the Plan and Progress screens, as review does', async () => {
    const c = await counts(6);
    assert.deepEqual(c.plan, { biceps: 5.25, lats: 10.5, forearms: 7.5 });
    assert.deepEqual(c.progress, c.plan);
    assert.deepEqual(c.review, c.plan);
  });

  it('without a start, all three count the lowest level (a dead hang)', async () => {
    const c = await counts();
    assert.deepEqual(c.plan, { biceps: 2.25, lats: 7.5, forearms: 10.5 });
    assert.deepEqual(c.progress, c.plan);
    assert.deepEqual(c.review, c.plan);
  });
});

/** The Skills section for the vault as read on DATE, with the writes the card asks for going through the plugin's LogWriter. */
async function skillsCard(v: MemVault, moves: [string, number, string | undefined][] = []) {
  const data = new PahlavanData(v.adapter);
  await data.load(DATE);
  const writer = new LogWriter(v.adapter);
  const writes: Promise<unknown>[] = [];
  const ctx = {
    view: 'week', tables: new Set(), onView() {}, onTable() {}, sessionsView: 'weeks', onSessionsView() {}, health: 'rhr', onHealth() {},
    photo: { a: null, b: null, pose: 'front', mode: 'side', pos: 50, opacity: 50 }, onPhoto() {}, photoFiles: {}, resourcePath: null,
    // As the view's moveLadder does: the level into the log through LogWriter.saveLadder.
    onMoveLadder: (id: string, level: number, how?: 'start') => {
      moves.push([id, level, how]);
      writes.push(writer.saveLadder({ id, level, date: DATE, plan: data.current!.raw?.plan }));
    },
  } as unknown as MoreContext;
  const grid = new FakeElement('div');
  renderMore(grid as unknown as HTMLElement, 'skills', data.progressMore(DATE)!, 1200, ctx, () => null);
  const row = grid.querySelectorAll('.pv-sk-row').find((r) => text(r.querySelector('.pv-sk-name b')!) === 'Pull-up')!;
  assert.ok(row, 'the pull-up ladder has its row');
  const click = async (el: FakeElement | null | undefined) => {
    assert.ok(el, 'the button is there');
    for (const fn of el.listeners.get('click') ?? []) fn({ target: el });
    await Promise.all(writes.splice(0));
  };
  const button = (label: string) => row.querySelectorAll('button').find((b) => b.getAttribute('aria-label') === `Pull-up: ${label}` || text(b) === label);
  return { grid, row, click, button };
}
const pullups = (v: MemVault) => (JSON.parse(v.files.get(LOG)!) as { ladders: Record<string, unknown> }).ladders['pullup'];

describe('the plugin\'s Skills card: a ladder the plan starts at level 6, nothing logged', () => {
  it('says the level is the plan\'s start, not logged yet, and offers Log this level', async () => {
    const { row, grid } = await skillsCard(vault(6));
    assert.equal(text(row.querySelector('.pv-sk-sub')!), 'Level 6 of 8 · Pull-up · the plan’s start, not logged yet');
    assert.equal(text(row.querySelector('.pv-sk-log')!), 'Log this level');
    assert.ok(row.querySelector('.pv-sk-node.is-progress'), 'the path is in progress at the start');
    assert.equal(text(row.querySelectorAll('.pv-sk-node.is-progress')[0]!.querySelector('.pv-sk-lbl')!), 'Pull-up');
    // The table says the same.
    const tr = grid.querySelectorAll('tr').map(text).find((r) => r.startsWith('Pull-up'))!;
    assert.match(tr, /^Pull-up6Pull-upThe plan’s start, not logged yet/);
    assert.doesNotMatch(text(grid), /—/);
  });

  it('Log this level writes the start as the first logged level, through the same write as ▲', async () => {
    const v = vault(6);
    const moves: [string, number, string | undefined][] = [];
    const { click, button } = await skillsCard(v, moves);
    assert.equal(pullups(v), undefined, 'nothing logged on the ladder yet');
    await click(button('Log this level'));
    assert.deepEqual(moves, [['pullup', 6, 'start']]);
    assert.deepEqual(pullups(v), [{ level: 6, date: DATE }]);
    // Read again, the level is the log's: since the day, no button.
    const after = await skillsCard(v);
    assert.equal(text(after.row.querySelector('.pv-sk-sub')!), 'Level 6 of 8 · Pull-up · since 27 Apr');
    assert.equal(after.row.querySelector('.pv-sk-log'), null);
    // Then ▲ moves from the logged level.
    await after.click(after.button('up a level'));
    assert.deepEqual(pullups(v), [{ level: 6, date: DATE }, { level: 7, date: DATE }]);
  });

  it('▲ and ▼ move from the start before it is logged: 7 and 5', async () => {
    const up = vault(6);
    const a = await skillsCard(up);
    assert.match(a.button('up a level')!.getAttribute('data-tip')!, /^Up a level\|From the plan’s start$/);
    await a.click(a.button('up a level'));
    assert.deepEqual(pullups(up), [{ level: 7, date: DATE }]);
    const down = vault(6);
    const b = await skillsCard(down);
    await b.click(b.button('down a level'));
    assert.deepEqual(pullups(down), [{ level: 5, date: DATE }]);
  });

  it('without a start: Level not set, no Log this level, ▲ sets level 1', async () => {
    const v = vault();
    const { row, click, button } = await skillsCard(v);
    assert.equal(text(row.querySelector('.pv-sk-sub')!), 'Level not set · tap ▲');
    assert.equal(row.querySelector('.pv-sk-log'), null);
    assert.equal(button('up a level')!.getAttribute('data-tip'), 'Set level 1');
    await click(button('up a level'));
    assert.deepEqual(pullups(v), [{ level: 1, date: DATE }]);
  });
});

describe('the movement guide of a ladder item at the plan\'s start', () => {
  it('says it is the plan\'s starting level, not that the level is unset', () => {
    const v = vault(6);
    const plan = v.json(PLAN);
    for (const name of LEVELS) plan.guide[name] = { setup: 'Set up.', do: 'Do it.', avoid: 'Avoid that.', muscles: { main: ['lats'], helps: ['biceps'] } };
    const log = v.json(LOG);
    const note = (p: unknown) => text((guidePanel(guideFor(p, log, 'Pull-up (your level)')) as unknown as FakeElement).querySelector('.pv-gd-note')!);
    assert.equal(note(plan), 'The plan’s starting level, not logged yet. Log it on Progress, Skills.');
    const none = { ...plan, ladders: plan.ladders.map((l: { id: string; startLevel?: number }) => (l.id === 'pullup' ? { ...l, startLevel: undefined } : l)) };
    assert.equal(note(none), 'Level not set yet, so this is level 1. Set yours on Progress, Skills.');
  });
});
