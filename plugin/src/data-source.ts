// The plugin's data source: the dashboard's files read through the vault's
// adapter, converted by the engine's pure adapter and assembled by the same
// report functions the CLI uses. No Obsidian import (the adapter is passed
// in), and no clock: the date comes from the caller.

import { newestLetterName, readVaultAsync, VAULT_FILE_KEYS, type AsyncReadIo, type VaultRead } from '../../src/adapters/vault/read.ts';
import { readTrackingAsync, type TrackingRead } from '../../src/adapters/vault/tracking-read.ts';
import type { Scope } from '../../src/core/cycle.ts';
import type { IsoDate } from '../../src/core/schema.ts';
import type { SessionMode } from '../../src/core/variant.ts';
import { buildBodyRecord, buildDeskCard, buildHabitsScreen } from '../../src/report/habits-screen.ts';
import { buildFood } from '../../src/report/food.ts';
import { INBOX_FILES, INBOX_PATHS, isEntryFile, readRefused, refusedLine, type RefusedEntry } from '../../src/report/inbox.ts';
import { buildCheckin, buildPlan, buildProgress, buildProgressMore, buildRoutine, buildSession, buildToday, type SessionPick } from '../../src/report/index.ts';
import { paths } from '../../src/adapters/vault/layout.ts';

/** The parts of Obsidian's DataAdapter the plugin reads with (read-only). */
export interface AdapterLike {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
}

export type TodayModel = ReturnType<typeof buildToday>;
export type SessionModel = ReturnType<typeof buildSession>;
export type ProgressModel = ReturnType<typeof buildProgress>;
export type ProgressMoreModel = ReturnType<typeof buildProgressMore>;
export type PlanModel = ReturnType<typeof buildPlan>;
export type CheckinModel = ReturnType<typeof buildCheckin>;
export type HabitsModel = ReturnType<typeof buildHabitsScreen>;
export type BodyRecordModel = ReturnType<typeof buildBodyRecord>;
export type DeskCardModel = ReturnType<typeof buildDeskCard>;
export type FoodModel = ReturnType<typeof buildFood>;
export type RoutineModel = ReturnType<typeof buildRoutine>;

/** The vault paths whose change means a re-read (the vault's layout, when called). */
export const watchedPaths = (): string[] => VAULT_FILE_KEYS.map((k) => paths()[k]);
/** A baseline note in the fitness folder. */
const isBaseline = (path: string): boolean => path.startsWith(`${paths().fitness}/`) && /^Baseline - \d{4}-\d{2}-\d{2}\.md$/.test(path.slice(paths().fitness.length + 1));
/** A coach letter: a note directly in Coach/Letters. The other coach Markdown the screens read is the decision log (`paths().decisions`). */
const isLetter = (path: string): boolean => path.startsWith(`${paths().letters}/`) && path.endsWith('.md') && !path.slice(paths().letters.length + 1).includes('/');

/**
 * Pahlavan's own Coach files that a change re-reads: what is tracked (an
 * item, a tick from the other Mac) and the reminder state (an answer).
 * Coach/sitting.json is not among them: it is written every 2 minutes while
 * someone sits, and the screens follow it through the reminders' onChange.
 */
export const watchedCoach = (): string[] => [paths().tracking, paths().nudges];

/**
 * The phone's inbox: an entry file arriving (obsidian-git's pull) imports it,
 * and the refusals changing (the other Mac's import) redraw. phone.json and
 * the applied/ folder are not watched: Pahlavan writes them itself.
 */
export function isInboxWatched(path: string): boolean {
  if (!path.startsWith(`${paths().inbox}/`)) return false;
  const name = path.slice(paths().inbox.length + 1);
  return isEntryFile(name) || name === INBOX_FILES.refused;
}

export function isWatched(path: string): boolean {
  return watchedPaths().includes(path) || watchedCoach().includes(path) || isBaseline(path) || path === paths().decisions || isLetter(path) || isInboxWatched(path);
}

/**
 * The newest coach letter: the latest `YYYY-MM-DD.md` in Coach/Letters (else
 * the last name in order), its path relative to the vault. The screens show
 * it, and the coach step after the Sunday check-in is done once one is dated
 * on or after that Sunday (the reminder machinery reads it too).
 */
export async function newestLetter(adapter: AdapterLike, root = ''): Promise<{ path: string; text: string } | null> {
  const base = root.replace(/\/$/, '');
  const dir = base ? `${base}/${paths().letters}` : paths().letters;
  if (!(await adapter.exists(dir))) return null;
  // The engine's own pick (the CLI's `due` reads the letters the same way).
  const path = newestLetterName((await adapter.list(dir)).files);
  if (!path) return null;
  const rel = base && path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path;
  return { path: rel, text: await adapter.read(path) };
}

/** The adapter as the engine's reader: a missing file reads as null, a folder lists its file names. */
export function readerOf(adapter: AdapterLike): AsyncReadIo {
  return {
    async readText(path) {
      return (await adapter.exists(path)) ? adapter.read(path) : null;
    },
    async listDir(path) {
      if (!(await adapter.exists(path))) return null;
      const { files } = await adapter.list(path);
      return files.map((f) => f.slice(f.lastIndexOf('/') + 1));
    },
  };
}

export class PahlavanData {
  private read: VaultRead | null = null;
  private readDate: IsoDate | null = null;
  private tr: TrackingRead | null = null;
  private readonly adapter: AdapterLike;
  private readonly root: string;
  private readonly configDir: string | undefined;

  /** `configDir`: the vault's config folder, where Habit Nudges' settings are read for the bring-over (read only). */
  constructor(adapter: AdapterLike, root = '', opts: { configDir?: string } = {}) {
    this.adapter = adapter;
    this.root = root;
    this.configDir = opts.configDir;
  }

  /** Reads every source file again (the ladder levels are taken as of `date`). */
  async load(date: IsoDate): Promise<VaultRead> {
    const io = readerOf(this.adapter);
    const [read, tr] = await Promise.all([readVaultAsync(io, this.root, { asOf: date }), readTrackingAsync(io, this.root, this.configDir ? { configDir: this.configDir } : {})]);
    this.read = read;
    this.tr = tr;
    this.readDate = date;
    this.decisions = await readerOf(this.adapter).readText(this.at(paths().decisions));
    this.letter = await newestLetter(this.adapter, this.root);
    const fit = this.at(paths().fitness);
    this.files = (await this.adapter.exists(fit)) ? (await this.adapter.list(fit)).files : [];
    this.refused = readRefused(await readerOf(this.adapter).readText(this.at(INBOX_PATHS.refused)));
    return this.read;
  }

  private refused: RefusedEntry[] = [];
  /** The phone's entries the import refused, as Coach/Inbox/refused.json lists them (Due today and the Data notes). */
  get inboxRefused(): readonly RefusedEntry[] {
    return this.refused;
  }

  private files: string[] = [];
  /** The file names in the fitness folder, as last read (the plan's notes). */
  get fitnessFiles(): readonly string[] {
    return this.files;
  }

  private decisions: string | null = null;
  private letter: { path: string; text: string } | null = null;

  /** What is tracked and reminded, as last read (Coach/tracking.json, nudges.json, sitting.json and the files they lean on). */
  get tracking(): TrackingRead | null {
    return this.tr;
  }

  /**
   * Progress's Habits section: every item in words with its stats, the
   * tiles, the open suggestions and the one-time bring-over. `offsetMinutes`
   * is the local zone (east of UTC), for the work timer's desk-time history.
   */
  habits(date: IsoDate, opts: { offsetMinutes?: number } = {}): HabitsModel | null {
    return this.read && this.tr ? buildHabitsScreen(this.read, this.tr, date, opts) : null;
  }

  /** Check-in's Body record card: the tape, photos and tests, each with its last entry, next date and schedule. */
  bodyRecord(date: IsoDate): BodyRecordModel | null {
    return this.read && this.tr ? buildBodyRecord(this.read, this.tr, date) : null;
  }

  /** The Plan's Desk breaks card: the plan's routine, and the desk-break item that follows it. */
  deskCard(date: IsoDate): DeskCardModel | null {
    return this.read ? buildDeskCard(this.read, this.tr, date) : null;
  }

  /** The Food tab for `date`: the eating plan (Coach/eating-plan.json) with the protein item's days, the tape and the weight trend; the day's kind follows Today's pick. */
  food(date: IsoDate, pick: SessionPick = {}): FoodModel | null {
    return this.read ? buildFood(this.read, this.tr, date, { pick }) : null;
  }

  /**
   * The ? menu's Your routine for `date`, from the data already read: the
   * plan, what is tracked with its card times, the body record's schedule,
   * and the Settings tab's "Did you train today?" (on, and its time).
   */
  routine(date: IsoDate, didYouTrain?: { on: boolean; at: string }): RoutineModel | null {
    return this.read ? buildRoutine(this.read, this.tr, date, didYouTrain ? { didYouTrain } : {}) : null;
  }

  /** The Check-in screen for `date`, from the data already read (the newest letter, and what is tracked); `minutes`: now, for the Sunday's protein tick. */
  checkin(date: IsoDate, opts: { minutes?: number } = {}): CheckinModel | null {
    return this.read ? buildCheckin(this.read, date, this.letter, { ...opts, tracking: this.tr }) : null;
  }
  private at(p: string): string {
    return this.root ? `${this.root.replace(/\/$/, '')}/${p}` : p;
  }

  /** The Plan screen for `date`, from the data already read (and Coach/Decisions.md, and the newest letter for the coach step). */
  plan(date: IsoDate): PlanModel | null {
    return this.read ? buildPlan(this.read, date, { decisions: this.decisions, letter: this.letter }, this.root) : null;
  }

  /**
   * The files as of another date, for the Log panel on another day: the
   * ladder levels as they stood that day (the reader resolves them at read
   * time). Today's read stays as it is; the same date reuses it.
   */
  async readAsOf(date: IsoDate): Promise<VaultRead> {
    if (this.read && this.readDate === date) return this.read;
    return readVaultAsync(readerOf(this.adapter), this.root, { asOf: date });
  }

  get loaded(): boolean {
    return this.read !== null;
  }

  /** The files as last read (the Log panel builds its form from them). */
  get current(): VaultRead | null {
    return this.read;
  }

  /**
   * The Today report for `date` (with the user's pick of session, if any);
   * reads first when nothing is loaded or the date moved on. Each phone entry
   * the import refused is a Data note (`phone`), with its file and reason.
   */
  async today(date: IsoDate, mode: SessionMode, pick: SessionPick = {}): Promise<TodayModel> {
    if (!this.read || this.readDate !== date) await this.load(date);
    const m = buildToday(this.read!, date, mode, this.root, pick, { letter: this.letter });
    return this.refused.length ? { ...m, warnings: [...m.warnings, ...this.refused.map((r) => ({ code: 'phone', message: refusedLine(r) }))] } : m;
  }

  /** The Progress report for `date`, from the cycle start (or everything, `all`); reads first when nothing is loaded or the date moved on. */
  async progress(date: IsoDate, scope: Scope = 'cycle'): Promise<ProgressModel> {
    if (!this.read || this.readDate !== date) await this.load(date);
    return buildProgress(this.read!, date, this.root, { scope });
  }

  /** The Progress report from the data already read (null before the first read): a view switched to another range redraws at once. */
  progressNow(date: IsoDate, scope: Scope): ProgressModel | null {
    return this.read ? buildProgress(this.read, date, this.root, { scope }) : null;
  }

  /** Training, Body, Health and Skills for `date`, from the cycle start (or everything, `all`), from the data already read. */
  progressMore(date: IsoDate, scope: Scope = 'cycle'): ProgressMoreModel | null {
    return this.read ? buildProgressMore(this.read, date, this.root, { scope }) : null;
  }

  /**
   * Each photo set's image files by pose (the file's name, lower case:
   * "front"), from its folder: the sets in body-data.json's index, and any
   * other dated folder under Progress Photos (the dashboard shows those too).
   * Read-only.
   */
  async photoFiles(sets: readonly { date: string; folder: string }[]): Promise<Record<string, Record<string, string>>> {
    const out: Record<string, Record<string, string>> = {};
    const base = `${this.root ? `${this.root.replace(/\/$/, '')}/` : ''}${paths().fitness}/Progress Photos`;
    const all = [...sets];
    if (await this.adapter.exists(base)) {
      for (const d of (await this.adapter.list(base)).folders) {
        const date = d.slice(d.lastIndexOf('/') + 1);
        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && !all.some((x) => x.date === date)) all.push({ date, folder: `Progress Photos/${date}/` });
      }
    }
    for (const set of all) {
      const dir = `${this.root ? `${this.root.replace(/\/$/, '')}/` : ''}${paths().fitness}/${set.folder.replace(/\/$/, '')}`;
      if (!(await this.adapter.exists(dir))) continue;
      const files: Record<string, string> = {};
      for (const f of (await this.adapter.list(dir)).files) {
        if (!/\.(jpe?g|png|webp|gif|heic)$/i.test(f)) continue;
        files[f.slice(f.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '').toLowerCase()] = f;
      }
      if (Object.keys(files).length) out[set.date] = files;
    }
    return out;
  }

  /** Today's session in another mode or another pick, from the data already read. */
  session(date: IsoDate, mode: SessionMode, pick: SessionPick = {}): SessionModel | null {
    if (!this.read || this.read.files.plan === 'missing') return null;
    return buildSession(this.read.data, date, mode, pick);
  }
}
