// The phone's inbox in the plugin. On each data refresh the entry files in
// Coach/Inbox/ (the phone's shortcuts send them to the vault's GitHub
// repository, obsidian-git pulls them in) are checked by the engine's pure
// applyInbox against the vault as it is, then written through the plugin's
// own writers, each with its re-read, read-back and conflict handling, as
// Pahlavan's screens write: LogWriter for a session (and the Workout tick),
// CheckinWriter for the morning check-in, ReminderWriter for ticks, amounts,
// the day's mark and the evening card's answer. An entry that applied, or
// was there already, moves to Coach/Inbox/applied/<YYYY-MM>/; a refused one
// stays, its reason in Coach/Inbox/refused.json, which both Macs read (the
// Data notes and Due today). Two Macs importing the same file: the one that
// comes second finds it gone (skipped) or refuses it as already there. And
// Coach/Inbox/phone.json, what the phone reads, written when it changes. No
// Obsidian import, no clock: the adapter and today come in.

import { readVaultAsync } from '../../src/adapters/vault/read.ts';
import { readTrackingAsync } from '../../src/adapters/vault/tracking-read.ts';
import type { IsoDate } from '../../src/core/schema.ts';
import { dayText } from '../../src/core/dates.ts';
import { MORNING_LIMITS } from '../../src/core/morning.ts';
import { applyInbox, buildPhone, INBOX_PATHS, INBOX_TEXT_KEYS, inboxTextPaths, isEntryFile, phoneText, readRefused, refusedOf, refusedText, type InboxApplied, type InboxCode, type InboxFile, type InboxTexts, type RefusedEntry } from '../../src/report/inbox.ts';
import type { CheckinWriter } from './checkin-writer.ts';
import { readerOf } from './data-source.ts';
import type { LogWriter } from './log-writer.ts';
import type { ReminderAdapter, ReminderWriter } from './reminders/writer.ts';
import { paths } from '../../src/adapters/vault/layout.ts';

/** What the importer needs from Obsidian's DataAdapter: the writers' reads and writes, and a rename for the move. */
export interface InboxAdapter extends ReminderAdapter {
  rename?(from: string, to: string): Promise<void>;
}

export interface InboxDeps {
  adapter: InboxAdapter;
  log: LogWriter;
  writer: ReminderWriter;
  checkin: CheckinWriter;
  /** The vault's config folder (Habit Nudges' settings, read for the reminders' view of the files). */
  configDir?: string;
}

export interface ImportSummary {
  /** Entry files in the inbox. */
  found: number;
  /** Applied, or there already: moved to applied/. */
  imported: InboxApplied[];
  /** Staying in the inbox, with their reasons (as refused.json lists them). */
  refused: RefusedEntry[];
  /** Files gone before they could be read or moved: the other Mac imported them first. */
  skipped: string[];
  /** What was saved with a note (a linked habit not ticked, a paused item ticked). */
  warnings: string[];
  /** Something in the vault changed (the reload and the sync follow). */
  wrote: boolean;
}

type WriteResult = { ok: true; wrote: boolean; warnings: string[] } | { ok: false; code: InboxCode; reason: string };

const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);

export class InboxImporter {
  private readonly deps: InboxDeps;
  private running = false;
  private again = false;

  constructor(deps: InboxDeps) {
    this.deps = deps;
  }

  private async read(path: string): Promise<string | null> {
    try {
      return (await this.deps.adapter.exists(path)) ? await this.deps.adapter.read(path) : null;
    } catch {
      return null; // gone between the look and the read
    }
  }

  private async ensureFolder(dir: string): Promise<void> {
    const a = this.deps.adapter;
    if (!dir || (await a.exists(dir)) || !a.mkdir) return;
    const parts = dir.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const d = parts.slice(0, i).join('/');
      if (!(await a.exists(d))) await a.mkdir(d);
    }
  }

  /**
   * Imports what the inbox holds; null when there is no inbox. A run asked
   * for while one is going runs once more after it (a file pulled in
   * meanwhile is not left waiting for the next change).
   */
  async run(today: IsoDate): Promise<ImportSummary | null> {
    if (this.running) {
      this.again = true;
      return null;
    }
    this.running = true;
    try {
      let out = await this.once(today);
      while (this.again) {
        this.again = false;
        const next = await this.once(today);
        if (next && out) out = { found: next.found, imported: [...out.imported, ...next.imported], refused: next.refused, skipped: [...out.skipped, ...next.skipped], warnings: [...out.warnings, ...next.warnings], wrote: out.wrote || next.wrote };
        else out = next ?? out;
      }
      return out;
    } finally {
      this.running = false;
    }
  }

  private async once(today: IsoDate): Promise<ImportSummary | null> {
    const a = this.deps.adapter;
    if (!(await a.exists(paths().inbox))) return null;
    const names = (await a.list(paths().inbox)).files.map(nameOf).filter(isEntryFile).sort();
    const refusedWas = await this.read(INBOX_PATHS.refused);
    const summary: ImportSummary = { found: names.length, imported: [], refused: [], skipped: [], warnings: [], wrote: false };
    if (!names.length) {
      // Nothing to import: the refusals deleted since come off the list (once).
      if (refusedWas !== null && readRefused(refusedWas).length) summary.wrote = await this.writeRefused([], refusedWas);
      return summary;
    }
    const files: InboxFile[] = [];
    for (const n of names) {
      const text = await this.read(`${paths().inbox}/${n}`);
      if (text === null) summary.skipped.push(n);
      else files.push({ file: n, text });
    }
    const io = readerOf(a);
    const [read, tracking] = await Promise.all([readVaultAsync(io, '', { asOf: today }), readTrackingAsync(io, '', this.deps.configDir ? { configDir: this.deps.configDir } : {})]);
    const texts = Object.fromEntries(await Promise.all(INBOX_TEXT_KEYS.map(async (k) => [k, await this.read(inboxTextPaths()[k])] as const))) as InboxTexts;
    const plan = applyInbox({ read, tracking, texts, applied: await this.applied() }, files, today);
    const refused = refusedOf(plan.results);
    for (const r of plan.results) {
      if (r.status === 'refused') continue;
      const w = r.status === 'apply' ? await this.write(r, today, read.raw?.plan) : ({ ok: true, wrote: false, warnings: [] } as const);
      if (!w.ok) {
        refused.push({ file: r.file, date: r.date, kind: r.kind, code: w.code, reason: w.reason });
        continue;
      }
      summary.wrote ||= w.wrote;
      summary.warnings.push(...[...r.warnings, ...w.warnings].map((x) => `${r.file}: ${x}`));
      try {
        if ((await this.move(r.file, r.moveTo)) === 'gone') summary.skipped.push(r.file);
        else {
          summary.imported.push(r);
          summary.wrote = true;
        }
      } catch (e) {
        // Saved, but not moved: the next refresh finds it there already (or refuses the copy).
        summary.warnings.push(`${r.file}: saved, but not moved to ${INBOX_PATHS.dir}/${r.moveTo} (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    summary.refused = refused.sort((x, y) => x.file.localeCompare(y.file));
    if (await this.writeRefused(summary.refused, refusedWas)) summary.wrote = true;
    return summary;
  }

  /** The applied entries there already, as paths under the inbox (applied/<YYYY-MM>/<file>). */
  private async applied(): Promise<string[]> {
    const a = this.deps.adapter;
    if (!(await a.exists(INBOX_PATHS.applied))) return [];
    const out: string[] = [];
    for (const month of (await a.list(INBOX_PATHS.applied)).folders) {
      for (const f of (await a.list(month)).files) out.push(`applied/${nameOf(month)}/${nameOf(f)}`);
    }
    return out;
  }

  /** refused.json when it changes (the same refusals are the same text, so both Macs leave it alone). */
  private async writeRefused(list: readonly RefusedEntry[], was: string | null): Promise<boolean> {
    const next = refusedText(list);
    if (next === was) return false;
    await this.ensureFolder(paths().inbox);
    await this.deps.adapter.write(INBOX_PATHS.refused, next);
    return true;
  }

  /**
   * One entry's writes through the writers, the evening answer before the
   * day's mark (an answer the other Mac gave stops it), the Pahlavan record
   * before the linked habit (a habit that can't be ticked is a note, as
   * Due today treats it). A conflict or a failed write keeps the entry in the
   * inbox with its reason; it is tried again on the next refresh. A session
   * sent at Every set also sets Today's ticks (`plan`, as read), as the
   * engine's merge set them.
   */
  private async write(r: InboxApplied, today: IsoDate, plan: unknown): Promise<WriteResult> {
    const w = r.writes;
    const warnings: string[] = [];
    let wrote = false;
    const fail = (code: InboxCode, reason: string): WriteResult => ({ ok: false, code, reason });
    const day = dayText(r.date);
    if (w.session) {
      const s = await this.deps.log.save({ mode: 'add', entry: w.session, date: r.date, ...(w.sessionTicks ? { ticks: { plan, today } } : {}) });
      if (s.status === 'already') return fail('already', `a session of that type was logged on ${day} meanwhile: the log keeps that one, so delete this entry`);
      if (s.status === 'conflict') return fail('conflict', `the log changed while importing: tried again on the next refresh`);
      if (s.status === 'failed') return fail('failed', s.error);
      wrote = true;
    }
    if (w.morning) {
      const m = await this.deps.checkin.saveMorning(r.date, w.morning);
      if (m.status === 'conflict') return fail('conflict', `${m.conflicts.map((c) => `${MORNING_LIMITS[c.key].label} is ${String(c.disk)} in body-data.json, the phone says ${String(c.mine)}`).join('; ')}: nothing was written`);
      if (m.status === 'failed') return fail('failed', m.error);
      if (m.status === 'saved') wrote = true;
    }
    if (w.nudges) {
      const n = await this.deps.writer.nudges(w.nudges, today);
      if (n.status === 'conflict') return fail('conflict', `"Did you train today?" for ${day} was answered ${String(n.conflicts[0]?.disk)} on the Mac meanwhile: nothing more was written`);
      if (n.status === 'failed') return fail('failed', n.error);
      if (n.status === 'saved') wrote = true;
    }
    if (w.mark) {
      const m = await this.deps.writer.dayMark(r.date, w.mark);
      if (m.status === 'failed') return fail('failed', m.error);
      if (m.status === 'saved') wrote = true;
    }
    if (w.workout) {
      const h = await this.deps.log.tickWorkout(r.date);
      if (h === 'failed') warnings.push('the Workout habit could not be ticked (no habits-data.json?)');
      if (h === 'ticked') wrote = true;
    }
    if (w.tracking) {
      const t = await this.deps.writer.tracking(w.tracking);
      if (t.status === 'conflict') return fail('conflict', `Coach/tracking.json changed in a way that clashes (${t.conflicts.map((c) => c.what).join(', ')}): tried again on the next refresh`);
      if (t.status === 'failed') return fail('failed', t.error);
      if (t.status === 'saved') wrote = true;
    }
    if (w.habits) {
      const h = await this.deps.writer.habits(w.habits);
      if (h.status === 'failed') warnings.push(`saved, but the linked habit was not changed (${h.error})`);
      else {
        for (const s of h.skipped) warnings.push(`the ${s.habit} habit was skipped: ${s.why}`);
        if (h.status === 'saved') wrote = true;
      }
    }
    return { ok: true, wrote, warnings };
  }

  /**
   * An entry file to applied/<YYYY-MM>/, made as needed. Gone already: the
   * other Mac moved it (its pull took it away). The same entry there
   * already: this copy comes out.
   */
  private async move(file: string, to: string): Promise<'moved' | 'gone'> {
    const a = this.deps.adapter;
    const from = `${paths().inbox}/${file}`;
    const dest = `${paths().inbox}/${to}`;
    const text = await this.read(from);
    if (text === null) return 'gone';
    await this.ensureFolder(dest.slice(0, dest.lastIndexOf('/')));
    if (await a.exists(dest)) {
      if ((await this.read(dest)) !== text) throw new Error(`${dest} holds another entry`);
      if (a.remove) await a.remove(from);
      return 'moved';
    }
    if (a.rename) await a.rename(from, dest);
    else {
      await a.write(dest, text);
      if ((await this.read(dest)) !== text) throw new Error(`${dest} did not read back as written`);
      if (a.remove) await a.remove(from);
    }
    return 'moved';
  }

  /**
   * Coach/Inbox/phone.json for today, when it changes: what the phone's
   * shortcuts read. Not written in a vault with neither a plan nor anything
   * tracked (there is nothing for the phone to show).
   */
  async writePhone(today: IsoDate): Promise<'written' | 'unchanged' | 'skipped'> {
    const io = readerOf(this.deps.adapter);
    const [read, tracking] = await Promise.all([readVaultAsync(io, '', { asOf: today }), readTrackingAsync(io, '', this.deps.configDir ? { configDir: this.deps.configDir } : {})]);
    if (read.files.plan === 'missing' && tracking.files.tracking !== 'found') return 'skipped';
    const text = phoneText(buildPhone(read, tracking, today));
    if ((await this.read(INBOX_PATHS.phone)) === text) return 'unchanged';
    await this.ensureFolder(paths().inbox);
    await this.deps.adapter.write(INBOX_PATHS.phone, text);
    return 'written';
  }
}

/** The notice after an import: one line, the entries imported, and how many need a look. */
export function importNotice(s: ImportSummary): string | null {
  const n = s.imported.length;
  const r = s.refused.length;
  if (!n) return null;
  return `Pahlavan: ${n} phone ${n === 1 ? 'entry' : 'entries'} imported${r ? `; ${r} ${r === 1 ? 'needs' : 'need'} a look on Today` : ''}.`;
}
