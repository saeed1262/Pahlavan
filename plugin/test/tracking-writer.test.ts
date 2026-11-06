// The Habits section's writer against an in-memory copy of the synthetic
// vault (all made up): an item added, edited against what the form read
// (a conflict when the other Mac changed it), forced, removed, the folder
// made on the first write, and one retry when the file changes mid-save.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TrackedItem, Tracking } from '../../src/core/schema.ts';
import { acceptOps, formFromItem, itemFromForm, newForm, pausedItem, saveOps } from '../../src/report/item-form.ts';
import { TrackingWriter } from '../src/tracking-writer.ts';
import { memVault } from './mem-vault.ts';

const TR = '3-Personal/Fitness/Coach/tracking.json';
const DATE = '2026-04-10';

describe('TrackingWriter', () => {
  it('adds an item, reading it back', async () => {
    const v = memVault();
    const ids = v.json<Tracking>(TR).items.map((x) => x.id);
    const { item } = itemFromForm({ ...newForm('tick', DATE), name: 'Stretch', means: '10 minutes' }, null, { today: DATE, ids });
    const out = await new TrackingWriter(v.adapter).apply(saveOps(item, null));
    assert.equal(out.status, 'saved');
    assert.deepEqual(v.json<Tracking>(TR).items.at(-1), item);
    assert.equal(v.writes.length, 1);
    // The same again changes nothing.
    assert.deepEqual(await new TrackingWriter(v.adapter).apply(saveOps(item, null)), { status: 'unchanged' });
  });

  it('makes the Coach folder and the file when neither exists', async () => {
    const v = memVault({ without: (p) => p.startsWith('3-Personal/Fitness/Coach/') });
    v.folders.delete('3-Personal/Fitness/Coach');
    const { item } = itemFromForm({ ...newForm('supplement', DATE), name: 'Creatine', doseAmount: '5', doseUnit: 'g' }, null, { today: DATE, ids: [] });
    const out = await new TrackingWriter(v.adapter).apply(saveOps(item, null));
    assert.equal(out.status, 'saved');
    assert.deepEqual(v.json<Tracking>(TR).items, [item]);
  });

  it('calls a change made elsewhere since the form read it a conflict, and keeps mine when forced', async () => {
    const v = memVault();
    const base = v.json<Tracking>(TR).items.find((x) => x.id === 'water')!;
    // The other Mac changes the target meanwhile.
    const t = v.json<Tracking>(TR);
    t.items.find((x) => x.id === 'water')!.amount!.target = 2800;
    v.files.set(TR, JSON.stringify(t, null, 2));
    const mine = itemFromForm({ ...formFromItem(base, DATE), target: 3000 }, base, { today: DATE, ids: [] }).item;
    const w = new TrackingWriter(v.adapter);
    const out = await w.apply(saveOps(mine, base));
    assert.equal(out.status, 'conflict');
    assert.equal(v.json<Tracking>(TR).items.find((x) => x.id === 'water')!.amount!.target, 2800);
    assert.equal((await w.apply(saveOps(mine, base), { force: true })).status, 'saved');
    assert.equal(v.json<Tracking>(TR).items.find((x) => x.id === 'water')!.amount!.target, 3000);
  });

  it('removes an item with its day records', async () => {
    const v = memVault();
    const base = v.json<Tracking>(TR).items.find((x) => x.id === 'creatine')!;
    const out = await new TrackingWriter(v.adapter).apply([{ op: 'remove-item', id: 'creatine', baseline: base }]);
    assert.equal(out.status, 'saved');
    const t = v.json<Tracking>(TR);
    assert.ok(!t.items.some((x) => x.id === 'creatine'));
    assert.ok(Object.values(t.days).every((d) => !('creatine' in d)));
  });

  it('pauses and accepts a suggestion in one write each', async () => {
    const v = memVault();
    const t = v.json<Tracking>(TR);
    const c = t.items.find((x) => x.id === 'creatine') as TrackedItem;
    const w = new TrackingWriter(v.adapter);
    assert.equal((await w.apply(saveOps(pausedItem(c, DATE), c))).status, 'saved');
    assert.deepEqual(v.json<Tracking>(TR).items.find((x) => x.id === 'creatine')!.pauses, [{ from: DATE }]);
    const s = t.suggestions!.find((x) => x.id === 'lights-out')!;
    assert.equal((await w.apply(acceptOps(s, { today: DATE, ids: t.items.map((x) => x.id) }))).status, 'saved');
    assert.equal(v.json<Tracking>(TR).suggestions!.find((x) => x.id === 'lights-out')!.state, 'accepted');
    assert.equal(v.writes.length, 2);
  });

  it('merges again when the file changes between the merge and the write', async () => {
    let bumped = false;
    const v = memVault({
      onRead: (p, n, vault) => {
        // Right after the first read (the merge's base): the other Mac ticks something.
        if (p === TR && n === 1 && !bumped) {
          bumped = true;
          const t = JSON.parse(vault.files.get(TR)!) as Tracking;
          t.days['2026-04-10']!['flossing'] = { done: true };
          vault.files.set(TR, JSON.stringify(t, null, 2));
        }
      },
    });
    const ids = v.json<Tracking>(TR).items.map((x) => x.id);
    const { item } = itemFromForm({ ...newForm('tick', DATE), name: 'Stretch' }, null, { today: DATE, ids });
    const out = await new TrackingWriter(v.adapter).apply(saveOps(item, null));
    assert.deepEqual(out.status, 'saved');
    assert.equal((out as { retried: boolean }).retried, true);
    const t = v.json<Tracking>(TR);
    assert.equal(t.days['2026-04-10']!['flossing']!.done, true);
    assert.ok(t.items.some((x) => x.id === 'stretch'));
  });

  it('writes nothing over an invalid file', async () => {
    const v = memVault();
    v.files.set(TR, '{ not json');
    const out = await new TrackingWriter(v.adapter).apply(saveOps(itemFromForm({ ...newForm('tick', DATE), name: 'X' }, null, { today: DATE, ids: [] }).item, null));
    assert.equal(out.status, 'failed');
    assert.equal(v.writes.length, 0);
  });
});
