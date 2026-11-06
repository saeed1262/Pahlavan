// The in-plugin help's memory, and the screens': which one-time tips were
// seen and whether the welcome card is hidden; At a glance per tab (the
// visits counted, up to the 3 it starts open for, and the user's own open or
// fold), each section's fold the user chose (with the day, so a section with
// something due opens on a new day), and the Food tab's light checks per day
// (the last two weeks). Kept in a vault file (Coach/help.json) so both Macs
// share it, never in local storage. Each write reads the file as it is,
// applies its one change, writes it back and reads it back, one at a time,
// so the other Mac's choices (or its "Show the tips again") are never
// written over. Also the six tips' texts and where each one points, the
// user guide's places, and "When to talk to the coach" (the ? menu's panel).

import { COACH_COMMANDS } from '../../src/core/coach-steps.ts';
import type { AdapterLike } from './data-source.ts';
import type { MkdirAdapter } from './checkin-writer.ts';
import { paths } from '../../src/adapters/vault/layout.ts';


export type TipId = 'readiness' | 'why' | 'log' | 'due' | 'sunday' | 'cycle';
export type TipScreen = 'today' | 'checkin' | 'progress';

export interface Tip {
  id: TipId;
  screen: TipScreen;
  /** The element it points at (the first match on the screen); not drawn without one. */
  at: string;
  title: string;
  text: string;
}

/** The six tips, in the order they come, as signed off. */
export const TIPS: readonly Tip[] = [
  { id: 'readiness', screen: 'today', at: '.pv-readiness', title: 'Readiness', text: 'Readiness compares this morning with your own usual. For the first 14 mornings of a cycle it builds your baseline: train as planned. Only Low changes the session.' },
  { id: 'why', screen: 'today', at: '.pv-why-btn:not(.is-none)', title: 'Why', text: 'Every number has a reason. Why shows where a target, a swap or a trim comes from.' },
  { id: 'log', screen: 'today', at: '.pv-hero .pv-btn-go', title: 'Log session', text: 'After training, log here. Targets are filled in: change what differed, mark what you skipped, then Save session.' },
  { id: 'due', screen: 'today', at: '[data-live="due"]', title: 'Due today', text: 'What you track and the coach’s check-ins. Tick here or on the cards; the pencil opens Habits to add, change or pause items.' },
  { id: 'sunday', screen: 'checkin', at: '[data-card="sunday"]', title: 'The Sunday check-in', text: `On Sundays, answer the open questions here, then run ${COACH_COMMANDS.checkin} in Claude Code for your letter.` },
  { id: 'cycle', screen: 'progress', at: '.pv-range-seg', title: 'This cycle', text: 'Screens count from this cycle’s start. All shows earlier cycles; nothing is deleted.' },
];

/**
 * When to talk to the coach, in plain words: the steps on a schedule, each
 * with its command, and the times to ask on your own (the skill alone, then
 * say it in your own words; the coach works out the job).
 */
export const COACH_TIMES = {
  how: 'The coach runs in Claude Code. Start it in your vault, then type the command.',
  scheduled: [
    { when: 'Every Sunday, after you save the questions', what: 'The week’s letter: next week’s targets and what changes.', command: COACH_COMMANDS.checkin },
    { when: 'Each light week’s Sunday, and each phase end', what: 'The review: how the block went, and the plan for what comes next.', command: COACH_COMMANDS.review },
  ],
  ask: COACH_COMMANDS.ask,
  anytime: [
    'Pain or an injury',
    'Travel, a busy week or missed sessions',
    'Missing equipment, or a lift you can’t do',
    'A lift that stalled',
    'A new goal',
    'Starting or stopping tracking something',
    'A workout sheet to paste in',
    'Any question about your numbers',
  ],
} as const;

/** The tabs with At a glance and foldable sections. */
export type GlanceTab = 'today' | 'progress' | 'plan' | 'checkin' | 'food';
export const GLANCE_TABS: readonly GlanceTab[] = ['today', 'progress', 'plan', 'checkin', 'food'];
/** The panel starts open for a tab's first visits, then folds to its line. */
export const OPEN_VISITS = 3;
/** The light checks kept, in days before the newest change (a week to pre-fill, and the week before). */
export const CHECK_DAYS = 14;

/** A section's fold as the user chose it, and the day. */
export interface FoldChoice {
  folded: boolean;
  on: string;
}

export interface HelpState {
  schemaVersion: 1;
  /** Each tip seen, with the date. */
  tips: Partial<Record<TipId, string>>;
  /** The welcome card hidden on this date (null: shown until its five steps are done). */
  welcomeHidden: string | null;
  /** At a glance per tab: the visits counted (up to OPEN_VISITS) and the user's own open or fold (absent: by the visits). */
  glance?: Partial<Record<GlanceTab, { visits: number; open?: boolean }>>;
  /** Each section's fold the user chose, per tab, by section id (Progress's "<view>.<section>"). */
  folds?: Partial<Record<GlanceTab, Record<string, FoldChoice>>>;
  /** The Food tab's light checks per day: the slots tapped, by check id. */
  foodChecks?: Record<string, Record<string, number[]>>;
}

export type HelpChange =
  | { op: 'seen'; tips: TipId[]; on: string }
  | { op: 'reset' }
  | { op: 'hide-welcome'; on: string }
  /** A visit to a tab: counted until OPEN_VISITS. */
  | { op: 'visit'; tab: GlanceTab }
  /** At a glance opened or folded by the user. */
  | { op: 'panel'; tab: GlanceTab; open: boolean }
  /** Sections folded (true) or opened (false) by the user: one, or all of a tab's (Open all, Fold all). */
  | { op: 'fold'; tab: GlanceTab; sections: Readonly<Record<string, boolean>>; on: string }
  /** A light check's slot tapped (on) or untapped on a day. */
  | { op: 'check'; date: string; id: string; slot: number; on: boolean };

export const FRESH_HELP: Readonly<HelpState> = { schemaVersion: 1, tips: {}, welcomeHidden: null };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const TIP_IDS = new Set<string>(TIPS.map((t) => t.id));
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SECTION_ID = /^[a-z0-9][a-z0-9.-]*$/;
const CHECK_ID = /^[a-z0-9][a-z0-9-]*$/;
const daysBefore = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) - n * 864e5).toISOString().slice(0, 10);

/** The file's text as help state; missing or unreadable reads as fresh (nothing seen). Only the known keys and well-formed values are kept. */
export function parseHelp(text: string | null): HelpState {
  if (!text) return { ...FRESH_HELP, tips: {} };
  try {
    const d = JSON.parse(text) as unknown;
    if (!isObj(d)) return { ...FRESH_HELP, tips: {} };
    const tips: Partial<Record<TipId, string>> = {};
    if (isObj(d['tips'])) for (const [k, v] of Object.entries(d['tips'])) if (TIP_IDS.has(k) && typeof v === 'string') tips[k as TipId] = v;
    const st: HelpState = { schemaVersion: 1, tips, welcomeHidden: typeof d['welcomeHidden'] === 'string' ? d['welcomeHidden'] : null };
    const glance: NonNullable<HelpState['glance']> = {};
    if (isObj(d['glance'])) {
      for (const t of GLANCE_TABS) {
        const g = d['glance'][t];
        if (!isObj(g)) continue;
        const visits = Number.isInteger(g['visits']) ? Math.max(0, Math.min(OPEN_VISITS, g['visits'] as number)) : 0;
        glance[t] = typeof g['open'] === 'boolean' ? { visits, open: g['open'] } : { visits };
      }
    }
    if (Object.keys(glance).length) st.glance = glance;
    const folds: NonNullable<HelpState['folds']> = {};
    if (isObj(d['folds'])) {
      for (const t of GLANCE_TABS) {
        const f = d['folds'][t];
        if (!isObj(f)) continue;
        const kept: Record<string, FoldChoice> = {};
        for (const [k, v] of Object.entries(f)) if (SECTION_ID.test(k) && isObj(v) && typeof v['folded'] === 'boolean' && typeof v['on'] === 'string' && DATE.test(v['on'])) kept[k] = { folded: v['folded'], on: v['on'] };
        if (Object.keys(kept).length) folds[t] = kept;
      }
    }
    if (Object.keys(folds).length) st.folds = folds;
    const checks: NonNullable<HelpState['foodChecks']> = {};
    if (isObj(d['foodChecks'])) {
      for (const [day, byId] of Object.entries(d['foodChecks'])) {
        if (!DATE.test(day) || !isObj(byId)) continue;
        const kept: Record<string, number[]> = {};
        for (const [id, slots] of Object.entries(byId)) {
          if (!CHECK_ID.test(id) || !Array.isArray(slots)) continue;
          const ok = [...new Set(slots.filter((x): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) < 10))].sort((a, b) => a - b);
          if (ok.length) kept[id] = ok;
        }
        if (Object.keys(kept).length) checks[day] = kept;
      }
    }
    if (Object.keys(checks).length) st.foodChecks = checks;
    return st;
  } catch {
    return { ...FRESH_HELP, tips: {} };
  }
}

/** One change on the state as it is now. "Show the tips again" clears every seen tip; the welcome card's, the panels' and the folds' choices stay. */
export function applyHelp(st: HelpState, ch: HelpChange): HelpState {
  if (ch.op === 'reset') return { ...st, tips: {} };
  if (ch.op === 'hide-welcome') return st.welcomeHidden ? st : { ...st, welcomeHidden: ch.on };
  if (ch.op === 'visit') {
    const g = st.glance?.[ch.tab] ?? { visits: 0 };
    if (g.visits >= OPEN_VISITS) return st;
    return { ...st, glance: { ...st.glance, [ch.tab]: { ...g, visits: g.visits + 1 } } };
  }
  if (ch.op === 'panel') {
    const g = st.glance?.[ch.tab] ?? { visits: 0 };
    return { ...st, glance: { ...st.glance, [ch.tab]: { ...g, open: ch.open } } };
  }
  if (ch.op === 'fold') {
    const cur = { ...(st.folds?.[ch.tab] ?? {}) };
    for (const [id, folded] of Object.entries(ch.sections)) if (SECTION_ID.test(id)) cur[id] = { folded, on: ch.on };
    return { ...st, folds: { ...st.folds, [ch.tab]: cur } };
  }
  if (ch.op === 'check') {
    // The last CHECK_DAYS days are kept: Sunday's pre-fill reads the week, nothing older.
    const from = daysBefore(ch.date, CHECK_DAYS);
    const all: Record<string, Record<string, number[]>> = {};
    for (const [d, v] of Object.entries(st.foodChecks ?? {})) if (d >= from) all[d] = v;
    const day = { ...(all[ch.date] ?? {}) };
    const slots = new Set(day[ch.id] ?? []);
    if (ch.on) slots.add(ch.slot);
    else slots.delete(ch.slot);
    if (slots.size) day[ch.id] = [...slots].sort((a, b) => a - b);
    else delete day[ch.id];
    if (Object.keys(day).length) all[ch.date] = day;
    else delete all[ch.date];
    const next: HelpState = { ...st };
    if (Object.keys(all).length) next.foodChecks = all;
    else delete next.foodChecks;
    return next;
  }
  const tips = { ...st.tips };
  for (const id of ch.tips) tips[id] ??= ch.on;
  return { ...st, tips };
}

/** How a section starts when the user has not chosen, as At a glance's specs say. */
export interface FoldSpec {
  id: string;
  start: 'open' | 'folded';
  due?: boolean;
}

/**
 * Whether a section is folded: the user's choice, else its starting state.
 * A section with something due starts open on a day the user has not
 * folded it: a fold from an earlier day gives way.
 */
export function sectionFolded(st: HelpState | null, tab: GlanceTab, sec: FoldSpec, today: string): boolean {
  const c = st?.folds?.[tab]?.[sec.id];
  if (c && !(sec.due && c.folded && c.on < today)) return c.folded;
  return sec.due ? false : sec.start === 'folded';
}

/** Whether At a glance is open: the user's own choice, else open on the tab's first visits (`early`). */
export function panelOpen(st: HelpState | null, tab: GlanceTab, early: boolean): boolean {
  return st?.glance?.[tab]?.open ?? early;
}

/** A visit is one of the first ones (the panel and the Food tab's plan start open) while fewer than OPEN_VISITS are counted. */
export function earlyVisit(st: HelpState | null, tab: GlanceTab): boolean {
  return (st?.glance?.[tab]?.visits ?? 0) < OPEN_VISITS;
}

/** The first tip not seen yet on a screen, among those whose element is drawn. */
export function nextTip(st: HelpState, screen: TipScreen, drawn: (sel: string) => boolean): Tip | null {
  return TIPS.find((t) => t.screen === screen && !st.tips[t.id] && drawn(t.at)) ?? null;
}

export class HelpStore {
  private readonly adapter: AdapterLike & MkdirAdapter;
  private readonly root: string;
  /** The changes one after another: a quick second click reads the file the first one wrote. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(adapter: AdapterLike & MkdirAdapter, root = '') {
    this.adapter = adapter;
    this.root = root.replace(/\/$/, '');
  }

  /** Coach/help.json in the vault's layout, read when used (the folder setting can change). */
  private get path(): string {
    return this.root ? `${this.root}/${paths().help}` : paths().help;
  }

  async read(): Promise<HelpState> {
    return parseHelp((await this.adapter.exists(this.path)) ? await this.adapter.read(this.path) : null);
  }

  /** The change on the file as it is now (read, apply, write when it differs, read back); the state after. */
  apply(ch: HelpChange): Promise<HelpState> {
    const run = this.queue.then(() => this.applyNow(ch));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async applyNow(ch: HelpChange): Promise<HelpState> {
    const text = (await this.adapter.exists(this.path)) ? await this.adapter.read(this.path) : null;
    const before = parseHelp(text);
    const after = applyHelp(before, ch);
    if (JSON.stringify(after) === JSON.stringify(before)) return after;
    const dir = this.path.slice(0, this.path.lastIndexOf('/'));
    if (this.adapter.mkdir && !(await this.adapter.exists(dir))) await this.adapter.mkdir(dir);
    await this.adapter.write(this.path, `${JSON.stringify(after, null, 2)}\n`);
    const back = await this.read();
    if (JSON.stringify(back) !== JSON.stringify(after)) throw new Error(`${paths().help} did not read back as written`);
    return back;
  }
}
