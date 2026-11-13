// The reminder cards' writer: every write goes through one of the engine's
// pure merges (session 1's writers) and only reads and writes here, through
// the vault adapter passed in. As the log and check-in writers do: re-read
// just before the write (a change since the merge means merging again),
// read back after, one retry; the Coach folder is made on the first write.
// No Obsidian import.
//
//   Coach/nudges.json    mergeNudges     answers, snoozes, skips (both Macs)
//   Coach/tracking.json  mergeTracking   ticks, amounts, stand-ups, desk breaks
//   Coach/sitting.json   mergeSitting    this Mac's sitting stretches
//   habits-data.json     mergeHabitChanges  the linked habits
//   body-data.json       mergeTape, mergeTests, mergePhotoIndex, mergeDayMark
//   Progress Photos/<date>/<pose>.jpeg   the photos (sips, else as they are)

import { mergeDayMark, mergePhotoIndex, mergeTape, mergeTests, photoPath, POSES, type RecordChange, type RecordConflict } from '../../../src/adapters/vault/body-write.ts';
import { habitsLanded, mergeHabitChanges, type HabitChange } from '../../../src/adapters/vault/habits-write.ts';
import { landed, mergeNudges, mergeSitting, mergeTracking, type Conflict, type SittingChange, type TrackingOp } from '../../../src/adapters/vault/tracking-write.ts';
import type { NudgeChange } from '../../../src/core/nudges.ts';
import type { IsoDate } from '../../../src/core/schema.ts';
import type { MkdirAdapter } from '../checkin-writer.ts';
import { paths } from '../../../src/adapters/vault/layout.ts';

/** What the writer needs from Obsidian's DataAdapter (photos: binary writes and removing an old pose file). */
export interface ReminderAdapter extends MkdirAdapter {
  writeBinary?(path: string, data: ArrayBuffer): Promise<void>;
  remove?(path: string): Promise<void>;
}

export type WriteOutcome =
  | { status: 'saved'; changed: string[]; retried: boolean }
  | { status: 'unchanged' }
  | { status: 'conflict'; conflicts: Conflict[] }
  | { status: 'failed'; error: string };

export type NudgeOutcome =
  | { status: 'saved'; already: string[]; retried: boolean }
  | { status: 'unchanged'; already: string[] }
  | { status: 'conflict'; conflicts: Conflict[] }
  | { status: 'failed'; error: string };

export type HabitOutcome = { status: 'saved' | 'unchanged'; skipped: { habit: string; why: string }[] } | { status: 'failed'; error: string };

export type RecordOutcome = { status: 'saved'; changed: string[] } | { status: 'unchanged' } | { status: 'conflict'; conflicts: RecordConflict[] } | { status: 'failed'; error: string };

/** A photo chosen on the card: the pose, the file's own name (for its extension) and its bytes. */
export interface PhotoIn {
  pose: string;
  name: string;
  data: ArrayBuffer;
}

/** One photo converted for saving: JPEG from sips, or the original bytes with their extension when sips is not there. */
export type PhotoConvert = (p: PhotoIn) => Promise<{ data: ArrayBuffer; ext: string }>;

export type PhotoOutcome = { status: 'saved'; saved: { pose: string; path: string }[]; index: 'merged' | 'unchanged' } | { status: 'failed'; error: string; saved: { pose: string; path: string }[] };

const join = (root: string, p: string) => (root ? `${root.replace(/\/$/, '')}/${p}` : p);
const KEPT = 'Your answers are still on the card; try again in a moment.';

export class ReminderWriter {
  private readonly adapter: ReminderAdapter;
  private readonly root: string;

  constructor(adapter: ReminderAdapter, root = '') {
    this.adapter = adapter;
    this.root = root;
  }

  private path(p: string): string {
    return join(this.root, p);
  }

  private async read(path: string): Promise<string | null> {
    return (await this.adapter.exists(path)) ? this.adapter.read(path) : null;
  }

  /** The folder holding a file. */
  private async ensureDir(path: string): Promise<void> {
    await this.ensureFolder(path.slice(0, path.lastIndexOf('/')));
  }

  private async ensureFolder(dir: string): Promise<void> {
    if (!dir || (await this.adapter.exists(dir))) return;
    if (!this.adapter.mkdir) return;
    // Made one level at a time: Obsidian's adapter makes parents too, a plain one may not.
    const parts = dir.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const d = parts.slice(0, i).join('/');
      if (!(await this.adapter.exists(d))) await this.adapter.mkdir(d);
    }
  }

  /**
   * One file through a merge: re-read before the write, read back after,
   * one retry. `merge` returns the text to write and what must hold after,
   * or a result that ends the save.
   */
  private async through<R>(file: string, merge: (text: string | null) => { write: string; check: (back: string | null) => boolean; done: R } | { end: R }, failed: (error: string) => R): Promise<R> {
    const path = this.path(file);
    for (let attempt = 0; attempt < 2; attempt++) {
      const base = await this.read(path);
      const m = merge(base);
      if ('end' in m) return m.end;
      if ((await this.read(path)) !== base) continue;
      try {
        await this.ensureDir(path);
        await this.adapter.write(path, m.write);
      } catch (e) {
        return failed(`${file.slice(file.lastIndexOf('/') + 1)} could not be written: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (m.check(await this.read(path))) return m.done;
    }
    return failed(`${file.slice(file.lastIndexOf('/') + 1)} kept changing while saving. ${KEPT}`);
  }

  /** Answers, snoozes and skips into Coach/nudges.json; `already`: the other Mac had answered those the same way. */
  async nudges(changes: readonly NudgeChange[], today: IsoDate): Promise<NudgeOutcome> {
    if (!changes.length) return { status: 'unchanged', already: [] };
    let retried = false;
    let first = true;
    return this.through<NudgeOutcome>(paths().nudges, (text) => {
      if (!first) retried = true;
      first = false;
      const m = mergeNudges(text, changes, { today });
      if (m.result === 'unchanged') return { end: { status: 'unchanged', already: m.already } };
      if (m.result === 'conflict') return { end: { status: 'conflict', conflicts: m.conflicts } };
      if (m.result === 'invalid') return { end: { status: 'failed', error: `Coach/nudges.json: ${m.errors.join('; ')}` } };
      if (m.result === 'unreadable') return { end: { status: 'failed', error: `${m.error}: fix it first; nothing was written` } };
      return { write: m.text, check: (back) => landed(back, m.check), done: { status: 'saved', already: m.already, retried } };
    }, (error) => ({ status: 'failed', error }));
  }

  /** Ticks, amounts, stand-ups and desk breaks (and the coach's suggestions) into Coach/tracking.json. */
  async tracking(ops: readonly TrackingOp[]): Promise<WriteOutcome> {
    if (!ops.length) return { status: 'unchanged' };
    let retried = false;
    let first = true;
    return this.through<WriteOutcome>(paths().tracking, (text) => {
      if (!first) retried = true;
      first = false;
      const m = mergeTracking(text, ops);
      if (m.result === 'unchanged') return { end: { status: 'unchanged' } };
      if (m.result === 'conflict') return { end: { status: 'conflict', conflicts: m.conflicts } };
      if (m.result === 'invalid') return { end: { status: 'failed', error: `Coach/tracking.json: ${m.errors.join('; ')}` } };
      if (m.result === 'unreadable') return { end: { status: 'failed', error: `${m.error}: fix it first; nothing was written` } };
      return { write: m.text, check: (back) => landed(back, m.check), done: { status: 'saved', changed: m.changed, retried } };
    }, (error) => ({ status: 'failed', error }));
  }

  /** This Mac's sitting stretches into Coach/sitting.json. */
  async sitting(mac: string, changes: readonly SittingChange[]): Promise<WriteOutcome> {
    if (!changes.length) return { status: 'unchanged' };
    return this.through<WriteOutcome>(paths().sitting, (text) => {
      const m = mergeSitting(text, mac, changes);
      if (m.result === 'unchanged') return { end: { status: 'unchanged' } };
      if (m.result === 'conflict') return { end: { status: 'conflict', conflicts: m.conflicts } };
      if (m.result === 'invalid') return { end: { status: 'failed', error: `Coach/sitting.json: ${m.errors.join('; ')}` } };
      if (m.result === 'unreadable') return { end: { status: 'failed', error: m.error } };
      return { write: m.text, check: (back) => landed(back, m.check), done: { status: 'saved', changed: m.changed, retried: false } };
    }, (error) => ({ status: 'failed', error }));
  }

  /** Ticks and amounts into the linked habits. A missing habits-data.json is never made (the homepage owns it). */
  async habits(changes: readonly HabitChange[]): Promise<HabitOutcome> {
    if (!changes.length) return { status: 'unchanged', skipped: [] };
    return this.through<HabitOutcome>(paths().habits, (text) => {
      const m = mergeHabitChanges(text, changes);
      if (m.result === 'unreadable') return { end: { status: 'failed', error: m.error } };
      if (m.result === 'unchanged') return { end: { status: 'unchanged', skipped: m.skipped } };
      return { write: m.text, check: (back) => habitsLanded(back, m.changed), done: { status: 'saved', skipped: m.skipped } };
    }, (error) => ({ status: 'failed', error }));
  }

  /** The tape or the tests for a date into body-data.json, field by field. */
  async record(list: 'tape' | 'tests', date: IsoDate, change: RecordChange): Promise<RecordOutcome> {
    return this.through<RecordOutcome>(paths().body, (text) => {
      const m = list === 'tape' ? mergeTape(text, date, change) : mergeTests(text, date, change);
      if (m.result === 'unchanged') return { end: { status: 'unchanged' } };
      if (m.result === 'conflict') return { end: { status: 'conflict', conflicts: m.conflicts } };
      if (m.result === 'invalid') return { end: { status: 'failed', error: m.errors.join('; ') } };
      if (m.result === 'unreadable') return { end: { status: 'failed', error: `${m.error}: fix it first; nothing was written` } };
      const want = m.entry;
      const check = (back: string | null) => {
        try {
          const arr = (JSON.parse(back ?? 'null') as Record<string, unknown> | null)?.[list];
          const items: unknown[] = Array.isArray(arr) ? arr : [];
          const e = items.find((x) => typeof x === 'object' && x !== null && (x as { date?: unknown }).date === date);
          return JSON.stringify(e ?? null) === JSON.stringify(want);
        } catch {
          return false;
        }
      };
      return { write: m.text, check, done: { status: 'saved', changed: m.changed } };
    }, (error) => ({ status: 'failed', error }));
  }

  /** "Rest day" on "Did you train today?": the day's mark in body-data.json. */
  async dayMark(date: IsoDate, mark: 'rest' | 'missed' | null): Promise<RecordOutcome> {
    return this.through<RecordOutcome>(paths().body, (text) => {
      const m = mergeDayMark(text, date, mark);
      if (m.result === 'unchanged') return { end: { status: 'unchanged' } };
      if (m.result === 'unreadable') return { end: { status: 'failed', error: m.error } };
      const check = (back: string | null) => {
        try {
          return ((JSON.parse(back ?? 'null') as { days?: Record<string, { mark?: unknown }> } | null)?.days?.[date]?.mark ?? null) === mark;
        } catch {
          return false;
        }
      };
      return { write: m.text, check, done: { status: 'saved', changed: ['mark'] } };
    }, (error) => ({ status: 'failed', error }));
  }

  /**
   * Progress photos for a date: each converted (sips: JPEG, 1600 px on the
   * long side; HEIC from an iPhone included) and saved as
   * `Progress Photos/<date>/<pose>.<ext>`, replacing that pose's earlier file
   * (another extension included); then the date's poses into the photo
   * index. A pose that could not be saved is not indexed.
   */
  async photos(date: IsoDate, chosen: readonly PhotoIn[], convert: PhotoConvert): Promise<PhotoOutcome> {
    const saved: { pose: string; path: string }[] = [];
    const known: readonly string[] = POSES.map((p) => p.id);
    const order = [...chosen].filter((p) => known.includes(p.pose)).sort((a, b) => known.indexOf(a.pose) - known.indexOf(b.pose));
    if (!order.length) return { status: 'failed', error: 'No photo to save.', saved };
    if (!this.adapter.writeBinary) return { status: 'failed', error: 'This vault cannot save images from here.', saved };
    const dir = this.path(`${paths().photos}/${date}`);
    try {
      await this.ensureFolder(dir);
    } catch (e) {
      return { status: 'failed', error: `The photo folder could not be made: ${e instanceof Error ? e.message : String(e)}`, saved };
    }
    for (const p of order) {
      try {
        const { data, ext } = await convert(p);
        const path = this.path(photoPath(date, p.pose, ext));
        if (this.adapter.remove && (await this.adapter.exists(dir))) {
          for (const old of (await this.adapter.list(dir)).files) {
            const name = old.slice(old.lastIndexOf('/') + 1);
            if (name.replace(/\.[^.]+$/, '') === p.pose && old !== path) await this.adapter.remove(old);
          }
        }
        await this.adapter.writeBinary(path, data);
        saved.push({ pose: p.pose, path });
      } catch (e) {
        return { status: 'failed', error: `The ${p.pose} photo could not be saved: ${e instanceof Error ? e.message : String(e)}`, saved };
      }
    }
    const poses = saved.map((s) => s.pose);
    const idx = await this.through<{ ok: true; index: 'merged' | 'unchanged' } | { ok: false; error: string }>(paths().body, (text) => {
      const m = mergePhotoIndex(text, date, poses);
      if (m.result === 'unchanged') return { end: { ok: true, index: 'unchanged' } };
      if (m.result === 'invalid') return { end: { ok: false, error: m.errors.join('; ') } };
      if (m.result === 'unreadable') return { end: { ok: false, error: m.error } };
      const check = (back: string | null) => {
        try {
          const list = (JSON.parse(back ?? 'null') as { photos?: { date?: string; poses?: string[] }[] } | null)?.photos ?? [];
          const e = list.find((x) => x.date === date);
          return poses.every((p) => e?.poses?.includes(p));
        } catch {
          return false;
        }
      };
      return { write: m.text, check, done: { ok: true, index: 'merged' } };
    }, (error) => ({ ok: false, error }));
    if (!idx.ok) return { status: 'failed', error: `The photos are saved, but the photo index was not: ${idx.error}`, saved };
    return { status: 'saved', saved, index: idx.index };
  }
}
