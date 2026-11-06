// The Habits section's writer: item edits (add, edit, pause, resume, remove),
// the coach's suggestions (accept, dismiss), the one-time bring-over, the
// morning check-in's reminder time and the body-record schedule, all into
// Coach/tracking.json through session 1's mergeTracking. The merges are the
// engine's pure functions (src/report/item-form.ts builds the operations);
// this file only reads and writes, through the vault adapter passed in.
// Like the check-in writer: re-read just before the write (a change since
// the merge means merging again), read back after, one retry; the Coach
// folder is made on the first write. A change made elsewhere since the form
// read the file is a conflict to choose (force: keep mine). No Obsidian
// import.

import { landed, mergeTracking, type Conflict, type TrackingOp } from '../../src/adapters/vault/tracking-write.ts';
import type { MkdirAdapter } from './checkin-writer.ts';
import { paths } from '../../src/adapters/vault/layout.ts';

export type TrackingOutcome =
  | { status: 'saved'; changed: string[]; retried: boolean }
  | { status: 'unchanged' }
  | { status: 'conflict'; conflicts: Conflict[] }
  | { status: 'failed'; error: string };

const join = (root: string, p: string) => (root ? `${root.replace(/\/$/, '')}/${p}` : p);

export class TrackingWriter {
  private readonly adapter: MkdirAdapter;
  private readonly root: string;

  constructor(adapter: MkdirAdapter, root = '') {
    this.adapter = adapter;
    this.root = root;
  }

  private async read(path: string): Promise<string | null> {
    return (await this.adapter.exists(path)) ? this.adapter.read(path) : null;
  }

  private async ensureDir(path: string): Promise<void> {
    const dir = path.slice(0, path.lastIndexOf('/'));
    if (!dir || (await this.adapter.exists(dir)) || !this.adapter.mkdir) return;
    const parts = dir.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const d = parts.slice(0, i).join('/');
      if (!(await this.adapter.exists(d))) await this.adapter.mkdir(d);
    }
  }

  /** The operations into Coach/tracking.json: merged against the file as it is, written, read back. */
  async apply(ops: readonly TrackingOp[], opts: { force?: boolean } = {}): Promise<TrackingOutcome> {
    if (!ops.length) return { status: 'unchanged' };
    const path = join(this.root, paths().tracking);
    let retried = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const base = await this.read(path);
      const m = mergeTracking(base, ops, opts);
      if (m.result === 'unchanged') return attempt ? { status: 'saved', changed: [], retried } : { status: 'unchanged' };
      if (m.result === 'conflict') return { status: 'conflict', conflicts: m.conflicts };
      if (m.result === 'invalid') return { status: 'failed', error: `Coach/tracking.json: ${m.errors.join('; ')}` };
      if (m.result === 'unreadable') return { status: 'failed', error: `${m.error}: fix it first; nothing was written` };
      if ((await this.read(path)) !== base) {
        retried = true;
        continue;
      }
      try {
        await this.ensureDir(path);
        await this.adapter.write(path, m.text);
      } catch (e) {
        return { status: 'failed', error: `Coach/tracking.json could not be written: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (landed(await this.read(path), m.check)) return { status: 'saved', changed: m.changed, retried };
      retried = true;
    }
    return { status: 'failed', error: 'Coach/tracking.json kept changing while saving. Your changes are still in the form; save again in a moment.' };
  }
}
