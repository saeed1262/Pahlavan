// The plugin's writer: a session into fitness-log-data.json, the Workout
// tick into habits-data.json, the day's sore muscles into body-data.json.
// The merges are the engine's pure functions (src/adapters/vault/log-write);
// this file only reads and writes, through the vault adapter passed in.
//
// The log is merged against the file as it is at save time, re-read just
// before writing (a change since the merge means merging again), and read
// back after: if the session is not there, one more merge and write. Other
// writers (the old dashboard, a log script, the coach, the Isfahan plugin) can have
// written in between; their sessions and keys are kept. No Obsidian import.

import { habitKey, mergeHabit, mergeLadder, mergeLog, mergeSoreMuscles, mergeTodayChecklist, sessionKey, type MergeOptions } from '../../src/adapters/vault/log-write.ts';
import type { IsoDate, SorenessLevel } from '../../src/core/schema.ts';
import type { AdapterLike } from './data-source.ts';
import { paths } from '../../src/adapters/vault/layout.ts';

type Obj = Record<string, unknown>;

/** The parts of Obsidian's DataAdapter the writer uses. */
export interface WriteAdapter extends AdapterLike {
  write(path: string, data: string): Promise<void>;
}

export interface SaveRequest {
  mode: MergeOptions['mode'];
  /** The session entry (null to delete). */
  entry: Obj | null;
  original?: MergeOptions['original'];
  force?: boolean;
  /** The session's date: the habit's day and the sore muscles' day. */
  date: IsoDate;
  /** Sore muscles that changed (engine ids; null clears one). */
  sore?: Readonly<Record<string, SorenessLevel | null>>;
  /** The plan and Today's date: a session saved for that day also sets Today's ticks. */
  ticks?: MergeOptions['ticks'];
}

export type SaveOutcome =
  | { status: 'saved'; result: 'added' | 'updated' | 'deleted'; habit: 'ticked' | 'already' | 'skipped' | 'failed'; habitKey: string; sore: 'merged' | 'unchanged' | 'skipped' | 'failed'; retried: boolean }
  | { status: 'already'; existing: Obj }
  | { status: 'conflict'; disk: Obj | null }
  | { status: 'failed'; error: string };

const join = (root: string, p: string) => (root ? `${root.replace(/\/$/, '')}/${p}` : p);

export class LogWriter {
  private readonly adapter: WriteAdapter;
  private readonly root: string;

  constructor(adapter: WriteAdapter, root = '') {
    this.adapter = adapter;
    this.root = root;
  }

  private path(key: 'log' | 'habits' | 'body'): string {
    return join(this.root, paths()[key]);
  }

  private async read(path: string): Promise<string | null> {
    return (await this.adapter.exists(path)) ? this.adapter.read(path) : null;
  }

  /** The log as it is on disk now, parsed (null when there is none or it does not parse). */
  async readLog(): Promise<Obj | null> {
    const t = await this.read(this.path('log'));
    if (t === null) return null;
    try {
      const v = JSON.parse(t) as unknown;
      return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : null;
    } catch {
      return null;
    }
  }

  /** Whether the day's Workout is ticked already (for the summary). */
  async habitTicked(date: IsoDate): Promise<boolean | null> {
    const t = await this.read(this.path('habits'));
    if (t === null) return null;
    try {
      const doc = JSON.parse(t) as { checkins?: Record<string, string> };
      return doc.checkins?.[habitKey(date)] === '1';
    } catch {
      return null;
    }
  }

  async save(req: SaveRequest): Promise<SaveOutcome> {
    const opts: MergeOptions = { mode: req.mode, original: req.original ?? null, force: req.force ?? false, ticks: req.ticks ?? null };
    const key = req.entry ? sessionKey(req.entry) : null;
    const json = req.entry ? JSON.stringify(req.entry) : null;
    // Did the write land? The session is there as written (or gone, for a delete).
    const landed = (text: string | null) => {
      if (text === null) return false;
      try {
        const list = (JSON.parse(text) as { sessions?: Obj[] }).sessions ?? [];
        if (req.mode === 'delete') return !list.some((s) => sessionKey(s) === req.original!.key && JSON.stringify(s) === req.original!.json);
        return list.some((s) => sessionKey(s) === key && JSON.stringify(s) === json);
      } catch {
        return false;
      }
    };
    const logPath = this.path('log');
    let retried = false;
    let result: 'added' | 'updated' | 'deleted' | null = null;
    for (let attempt = 0; attempt < 2 && result === null; attempt++) {
      const base = await this.read(logPath);
      // A retry after a write that did not land: the session is there now (someone kept it), so it is saved.
      if (attempt > 0 && landed(base)) {
        result = req.mode === 'add' ? 'added' : req.mode === 'delete' ? 'deleted' : 'updated';
        break;
      }
      const m = mergeLog(base, req.entry, opts);
      if (m.result === 'already') return { status: 'already', existing: m.existing };
      if (m.result === 'conflict') return { status: 'conflict', disk: m.disk };
      if (m.result === 'unreadable') return { status: 'failed', error: m.error };
      const again = await this.read(logPath);
      if (again !== base) {
        retried = true;
        continue;
      }
      try {
        await this.adapter.write(logPath, m.text);
      } catch (e) {
        return { status: 'failed', error: `fitness-log-data.json could not be written: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (landed(await this.read(logPath))) result = m.result;
      else retried = true;
    }
    if (result === null) return { status: 'failed', error: 'fitness-log-data.json kept changing while saving. Nothing of yours was lost from the form; save again in a moment.' };

    const habit: 'ticked' | 'already' | 'skipped' | 'failed' = req.mode !== 'delete' ? await this.tickWorkout(req.date) : 'skipped';
    let sore: 'merged' | 'unchanged' | 'skipped' | 'failed' = 'skipped';
    if (req.sore && Object.keys(req.sore).length) {
      try {
        const b = mergeSoreMuscles(await this.read(this.path('body')), req.date, req.sore);
        if (b.result === 'merged') {
          await this.adapter.write(this.path('body'), b.text);
          sore = 'merged';
        } else sore = b.result === 'unchanged' ? 'unchanged' : 'failed';
      } catch {
        sore = 'failed';
      }
    }
    return { status: 'saved', result, habit, habitKey: habitKey(req.date), sore, retried };
  }

  /**
   * The add-only Workout tick in habits-data.json for a date, as a saved
   * session ticks it (and "Trained" from the phone's "Did you train today?"):
   * never unticks; a missing or unreadable file is left alone ("failed").
   */
  async tickWorkout(date: IsoDate): Promise<'ticked' | 'already' | 'failed'> {
    try {
      const h = mergeHabit(await this.read(this.path('habits')), date);
      if (h.result !== 'ticked') return h.result === 'already' ? 'already' : 'failed';
      await this.adapter.write(this.path('habits'), h.text);
      return 'ticked';
    } catch {
      return 'failed';
    }
  }

  /**
   * Today's checklist record (`todayChecklist`) into fitness-log-data.json,
   * as the dashboard's saveChecklist writes it: `next` builds the record from
   * the one on disk (a tick made in the dashboard since is kept); sessions
   * and ladders stay. Re-read before the write, read back after, one retry.
   */
  async saveChecklist(next: (log: Obj) => Obj): Promise<{ status: 'saved' | 'unchanged'; checklist: Obj | null } | { status: 'failed'; error: string }> {
    const logPath = this.path('log');
    for (let attempt = 0; attempt < 2; attempt++) {
      const base = await this.read(logPath);
      const m = mergeTodayChecklist(base, next);
      if (m.result === 'unreadable') return { status: 'failed', error: m.error };
      if (m.result === 'unchanged') return { status: 'unchanged', checklist: null };
      if ((await this.read(logPath)) !== base) continue;
      try {
        await this.adapter.write(logPath, m.text);
      } catch (e) {
        return { status: 'failed', error: `fitness-log-data.json could not be written: ${e instanceof Error ? e.message : String(e)}` };
      }
      const back = await this.read(logPath);
      try {
        if (back && JSON.stringify((JSON.parse(back) as Obj)['todayChecklist']) === JSON.stringify(m.checklist)) return { status: 'saved', checklist: m.checklist };
      } catch {
        // unreadable after the write: one more try
      }
    }
    return { status: 'failed', error: 'fitness-log-data.json kept changing while saving the checklist. Try again in a moment.' };
  }

  /**
   * A ladder level into fitness-log-data.json's `ladders`, as `engine log
   * ladder --id ID --level N --date D` writes it (mergeLadder): re-read before the
   * write, read back after, one retry. The ladder's levels come from the plan.
   */
  async saveLadder(req: { id: string; level: number; date: IsoDate; plan: unknown }): Promise<{ status: 'set' | 'already'; name: string } | { status: 'failed'; error: string }> {
    const logPath = this.path('log');
    const landed = (text: string | null) => {
      if (text === null) return false;
      try {
        const hist = (JSON.parse(text) as { ladders?: Record<string, { level: number; date: string }[]> }).ladders?.[req.id] ?? [];
        return hist.at(-1)?.level === req.level;
      } catch {
        return false;
      }
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const base = await this.read(logPath);
      const m = mergeLadder(base, req.plan, req.id, req.level, req.date);
      if (m.result === 'invalid' || m.result === 'unreadable') return { status: 'failed', error: m.error };
      if (m.result === 'already') return { status: 'already', name: m.name };
      if ((await this.read(logPath)) !== base) continue;
      try {
        await this.adapter.write(logPath, m.text);
      } catch (e) {
        return { status: 'failed', error: `fitness-log-data.json could not be written: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (landed(await this.read(logPath))) return { status: 'set', name: m.name };
    }
    return { status: 'failed', error: 'fitness-log-data.json kept changing while saving the level. Try again in a moment.' };
  }
}
