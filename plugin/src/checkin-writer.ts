// The Check-in screen's writer: the morning check-in into body-data.json
// (field by field, shared with the Habit Nudges plugin) and the Sunday
// check-in into Coach/checkins.json (through `checkin add`'s merge). The
// merges are the engine's pure functions; this file only reads and writes,
// through the vault adapter passed in. Like the log writer: re-read just
// before the write (a change since the merge means merging again), read back
// after, one retry. No Obsidian import.

import { mergeMorning, morningFrom, type MorningChange, type MorningConflict, type MorningKey } from '../../src/adapters/vault/body-write.ts';
import type { VaultData } from '../../src/adapters/vault/convert.ts';
import type { IsoDate, WeeklyCheckin } from '../../src/core/schema.ts';
import { addCheckins, type AddResult } from '../../src/report/checkin.ts';
import type { WriteAdapter } from './log-writer.ts';
import { paths } from '../../src/adapters/vault/layout.ts';

export interface MkdirAdapter extends WriteAdapter {
  mkdir?(path: string): Promise<void>;
}

export type MorningOutcome =
  | { status: 'saved'; changed: MorningKey[]; sore: boolean; stamped?: boolean; retried: boolean }
  | { status: 'unchanged' }
  | { status: 'conflict'; conflicts: MorningConflict[] }
  | { status: 'failed'; error: string };

export type SundayOutcome =
  | { status: 'saved'; action: 'added' | 'updated' | 'unchanged'; warnings: AddResult['warnings']; retried: boolean }
  | { status: 'failed'; error: string };

const join = (root: string, p: string) => (root ? `${root.replace(/\/$/, '')}/${p}` : p);

export class CheckinWriter {
  private readonly adapter: MkdirAdapter;
  private readonly root: string;

  constructor(adapter: MkdirAdapter, root = '') {
    this.adapter = adapter;
    this.root = root;
  }

  private async read(path: string): Promise<string | null> {
    return (await this.adapter.exists(path)) ? this.adapter.read(path) : null;
  }

  /** The morning fields into body-data.json: only those the form changed; everyone else's fields and days stay. */
  async saveMorning(date: IsoDate, change: MorningChange): Promise<MorningOutcome> {
    const path = join(this.root, paths().body);
    // Landed: every changed field holds the new value (and the sore muscles, the levels asked for).
    const landed = (text: string | null, keys: MorningKey[]) => {
      if (text === null) return false;
      try {
        const doc = JSON.parse(text) as { days?: Record<string, { soreMuscles?: Record<string, string> }> };
        const now = morningFrom(doc, date).values;
        return keys.every((k) => now[k] === (change.values[k] ?? null));
      } catch {
        return false;
      }
    };
    let retried = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const base = await this.read(path);
      const m = mergeMorning(base, date, change);
      if (m.result === 'unchanged') return attempt ? { status: 'saved', changed: [], sore: false, retried } : { status: 'unchanged' };
      if (m.result === 'conflict') return { status: 'conflict', conflicts: m.conflicts };
      if (m.result === 'invalid') return { status: 'failed', error: m.errors.join('; ') };
      if (m.result === 'unreadable') return { status: 'failed', error: `${m.error}: fix it first; nothing was written` };
      if ((await this.read(path)) !== base) {
        retried = true;
        continue;
      }
      try {
        await this.adapter.write(path, m.text);
      } catch (e) {
        return { status: 'failed', error: `body-data.json could not be written: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (landed(await this.read(path), m.changed)) return { status: 'saved', changed: m.changed, sore: m.sore, ...(m.stamped ? { stamped: true } : {}), retried };
      retried = true;
    }
    return { status: 'failed', error: 'body-data.json kept changing while saving. Your answers are still in the form; save again in a moment.' };
  }

  /**
   * The Sunday record into Coach/checkins.json through `checkin add`'s merge
   * (validated, merged by date, every other record kept). The Coach folder is
   * made when it is missing.
   */
  async saveSunday(record: Record<string, unknown>, today: IsoDate, data: VaultData): Promise<SundayOutcome> {
    const path = join(this.root, paths().checkins);
    const date = String(record['date']);
    let retried = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const base = await this.read(path);
      const r = addCheckins({ existingText: base, answers: record, today, data });
      if (r.errors.length || !r.doc) return { status: 'failed', error: r.errors.map((e) => e.message).join('; ') || 'nothing to save' };
      const want = r.results.find((x) => x.date === date)!;
      if (want.action === 'unchanged') return { status: 'saved', action: 'unchanged', warnings: r.warnings, retried };
      if ((await this.read(path)) !== base) {
        retried = true;
        continue;
      }
      try {
        const dir = path.slice(0, path.lastIndexOf('/'));
        if (dir && !(await this.adapter.exists(dir)) && this.adapter.mkdir) await this.adapter.mkdir(dir);
        await this.adapter.write(path, `${JSON.stringify(r.doc, null, 2)}\n`);
      } catch (e) {
        return { status: 'failed', error: `Coach/checkins.json could not be written: ${e instanceof Error ? e.message : String(e)}` };
      }
      const back = await this.read(path);
      try {
        const rec = back ? (JSON.parse(back) as { checkins?: WeeklyCheckin[] }).checkins?.find((c) => c.date === date) : undefined;
        if (rec && JSON.stringify(rec) === JSON.stringify(want.record)) return { status: 'saved', action: want.action, warnings: r.warnings, retried };
      } catch {
        // read back as unreadable: try once more
      }
      retried = true;
    }
    return { status: 'failed', error: 'Coach/checkins.json kept changing while saving. Your answers are still in the form; save again in a moment.' };
  }
}
