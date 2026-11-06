// The morning card's quick sore-areas pick: the areas start from this
// morning's sore muscles in the body log (an area shows its sorest muscle),
// a tap goes none, mild, sore, and Save sends each changed area's muscles,
// so marking a sore muscle no longer needs the Check-in screen.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { soreAreas, SORE_AREAS, type CardView } from '../src/reminders/card-model.ts';
import type { CardAnswer } from '../src/reminders/machine.ts';
import { CardController } from '../src/ui/cards.ts';
import { METRIC } from '../../src/core/units.ts';
import { FakeElement, installFakeDom } from './fake-dom.ts';

installFakeDom();

describe('the quick sore pick', () => {
  it('reads this morning’s sore muscles (ids or body-map slugs) into the areas', () => {
    const body = { days: { '2026-04-12': { soreMuscles: { quadriceps: 'mild', biceps: 'sore', triceps: 'mild' } } } };
    const a = soreAreas(body, '2026-04-12');
    assert.deepEqual(a.map((x) => x.id), SORE_AREAS.map((x) => x.id));
    assert.equal(a.find((x) => x.id === 'quads')!.level, 'mild');
    assert.equal(a.find((x) => x.id === 'arms')!.level, 'sore', 'the sorest muscle of the area');
    assert.equal(a.find((x) => x.id === 'chest')!.level, null);
    assert.ok(soreAreas({}, '2026-04-12').every((x) => x.level === null));
  });

  it('a tap goes none, mild, sore, none; Save sends only the changed areas’ muscles', async () => {
    const sore = soreAreas({ days: { '2026-04-12': { soreMuscles: { glutes: 'mild' } } } }, '2026-04-12');
    const view: CardView = { key: 'morning', kind: 'morning', date: '2026-04-12', manual: false, icon: 'clipboard', kicker: 'Morning check-in', title: 'Sunday 12 April', sub: '', primary: 'Save', skip: null, snooze: null, skipPeriod: null, closable: true, why: { note: '', rule: 'coach.morning-checkin' }, notify: { title: '', body: '' }, units: METRIC, body: { kind: 'morning', scales: [], fields: [], tape: null, sore } };
    const sent: CardAnswer[] = [];
    const c = new CardController(view, { answer: async (a) => void sent.push(a), close: () => {} });
    const el = c.el as unknown as FakeElement;
    const chip = (id: string) => el.querySelector(`[data-area="${id}"]`)!;
    const tap = (id: string) => { for (const fn of chip(id).listeners.get('click') ?? []) fn({ target: chip(id) }); };
    tap('quads');
    tap('quads'); // mild, then sore
    tap('glutes');
    tap('glutes'); // mild to sore, then cleared
    tap('chest');
    tap('chest');
    tap('chest'); // back to none: no change
    assert.ok(chip('quads').classList.contains('is-sore'));
    const save = el.querySelectorAll('button').find((b) => b.textContent.includes('Save'))!;
    for (const fn of save.listeners.get('click') ?? []) await fn({ target: save });
    await new Promise((r) => setTimeout(r, 10));
    const a = sent.find((x) => x.do === 'save') as Extract<CardAnswer, { do: 'save' }> | undefined;
    assert.ok(a, 'saved');
    assert.equal(a!.payload.kind, 'morning');
    assert.deepEqual((a!.payload as { sore?: unknown }).sore, { quads: 'sore', glutes: null });
  });
});
