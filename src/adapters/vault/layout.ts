// Where a vault keeps Pahlavan's files. Every path comes from one fitness
// folder (a new vault's is `Fitness`), with two files that may live elsewhere:
// the habit check-ins (a vault's habits grid may own them) and Habit Nudges'
// work timer, when the vault has one. The folders are the plugin's setting
// (`folders` in its data.json); a vault without the setting is searched for
// its plan, so an install from before the setting keeps its folders.
//
// One layout at a time: the CLI sets it at the start of a command, the
// plugin when it loads (each vault runs its own copy of the plugin), the
// tests in their helper. Everything else reads `paths()` when it needs a path.

export interface Folders {
  /** The fitness folder, relative to the vault root (a new vault: `Fitness`). */
  fitness: string;
  /** The habit check-ins file, when not `<fitness>/habits-data.json`. */
  habits?: string;
  /** Habit Nudges' work timer file, when the vault has one. */
  workTimer?: string;
}

export const DEFAULT_FOLDERS: Folders = { fitness: 'Fitness' };

/** Every file and folder Pahlavan reads or writes, relative to the vault root. */
export interface Layout {
  fitness: string;
  plan: string;
  log: string;
  body: string;
  habits: string;
  coach: string;
  profile: string;
  ledger: string;
  checkins: string;
  eating: string;
  tracking: string;
  nudges: string;
  sitting: string;
  help: string;
  decisions: string;
  letters: string;
  inbox: string;
  photos: string;
  guide: string;
  sessionHistory: string;
  /** Habit Nudges' work timer, or null when the vault has none. */
  workTimer: string | null;
}

const clean = (p: string | undefined): string => (p ?? '').trim().replace(/^\/+|\/+$/g, '');

/** The layout of a vault with these folders. */
export function layoutOf(f: Folders): Layout {
  const fit = clean(f.fitness) || DEFAULT_FOLDERS.fitness;
  const coach = `${fit}/Coach`;
  return {
    fitness: fit,
    plan: `${fit}/plan-data.json`,
    log: `${fit}/fitness-log-data.json`,
    body: `${fit}/body-data.json`,
    habits: clean(f.habits) || `${fit}/habits-data.json`,
    coach,
    profile: `${coach}/profile.json`,
    ledger: `${coach}/ledger.json`,
    checkins: `${coach}/checkins.json`,
    eating: `${coach}/eating-plan.json`,
    tracking: `${coach}/tracking.json`,
    nudges: `${coach}/nudges.json`,
    sitting: `${coach}/sitting.json`,
    help: `${coach}/help.json`,
    decisions: `${coach}/Decisions.md`,
    letters: `${coach}/Letters`,
    inbox: `${coach}/Inbox`,
    photos: `${fit}/Progress Photos`,
    guide: `${fit}/Pahlavan guide.md`,
    sessionHistory: `${fit}/Session History.md`,
    workTimer: clean(f.workTimer) || null,
  };
}

let current: Layout = layoutOf(DEFAULT_FOLDERS);
let currentFolders: Folders = DEFAULT_FOLDERS;

/** Sets the layout in use (the CLI per command, the plugin on load and when the setting changes). */
export function useFolders(f: Folders): Layout {
  currentFolders = { ...f };
  current = layoutOf(f);
  return current;
}

/** The layout in use. */
export function paths(): Layout {
  return current;
}

/** The folders the layout in use came from. */
export function folders(): Folders {
  return { ...currentFolders };
}

/** The folders in the plugin's parsed data.json (`folders.fitness` a non-empty string), else null. Pure. */
export function foldersOf(raw: unknown): Folders | null {
  const f = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)['folders'] : undefined;
  if (typeof f !== 'object' || f === null) return null;
  const o = f as Record<string, unknown>;
  if (typeof o['fitness'] !== 'string' || !clean(o['fitness'])) return null;
  const out: Folders = { fitness: clean(o['fitness']) };
  if (typeof o['habits'] === 'string' && clean(o['habits'])) out.habits = clean(o['habits']);
  if (typeof o['workTimer'] === 'string' && clean(o['workTimer'])) out.workTimer = clean(o['workTimer']);
  return out;
}

/** The folders in the plugin's data.json text, else null (no file, not JSON, no setting). Pure. */
export function foldersFrom(settingsText: string | null): Folders | null {
  if (settingsText === null) return null;
  try {
    return foldersOf(JSON.parse(settingsText) as unknown);
  } catch {
    return null;
  }
}

/** A folder's files and subfolders (names), or null when it is not a folder. */
export type Children = (dir: string) => { files: string[]; folders: string[] } | null;
export type AsyncChildren = (dir: string) => Promise<{ files: string[]; folders: string[] } | null>;

const PLAN = 'plan-data.json';
const HABITS = 'habits-data.json';
const TIMER = 'work-timer-data.json';
/** How deep the search goes: a fitness folder kept two folders down (`Personal/Fitness`) is found. */
const DEPTH = 3;

const skip = (name: string) => name.startsWith('.') || name === 'node_modules';
const under = (dir: string, name: string) => (dir === '' ? name : `${dir}/${name}`);

/** What the search found, as folders: the plan's folder (else the default), the habits and work timer files when found. */
function chosen(plan: string | null, habits: string[], timer: string | null): Folders {
  const fitness = plan ?? DEFAULT_FOLDERS.fitness;
  const out: Folders = { fitness };
  // The habits file beside the plan is the default anyway; one elsewhere is named.
  const own = `${fitness}/${HABITS}`;
  const elsewhere = habits.find((h) => h !== own);
  if (!habits.includes(own) && elsewhere) out.habits = elsewhere;
  if (timer) out.workTimer = timer;
  return out;
}

/**
 * Looks for the folders in a vault without the setting: the default folder
 * when it holds a plan, else the first folder holding plan-data.json (in
 * name order, up to three folders deep, dot folders left out); the habit
 * check-ins and the work timer files wherever they are found. Nothing found:
 * the default folder.
 */
export function findFolders(children: Children): Folders {
  if (children(DEFAULT_FOLDERS.fitness)?.files.includes(PLAN)) return chosen(DEFAULT_FOLDERS.fitness, findAll(children, HABITS), findAll(children, TIMER)[0] ?? null);
  return chosen(findAll(children, PLAN)[0]?.replace(/\/[^/]+$/, '') ?? null, findAll(children, HABITS), findAll(children, TIMER)[0] ?? null);
}

/** Every path of a file by that name, breadth first, in name order. */
function findAll(children: Children, name: string): string[] {
  const out: string[] = [];
  let level = [''];
  for (let depth = 0; depth <= DEPTH && level.length; depth++) {
    const next: string[] = [];
    for (const dir of level) {
      const c = children(dir);
      if (!c) continue;
      if (dir !== '' && c.files.includes(name)) out.push(under(dir, name));
      for (const f of [...c.folders].sort()) if (!skip(f)) next.push(under(dir, f));
    }
    level = next;
  }
  return out;
}

/** `findFolders` through an asynchronous lister (the plugin's vault adapter). */
export async function findFoldersAsync(children: AsyncChildren): Promise<Folders> {
  const seen = new Map<string, { files: string[]; folders: string[] } | null>();
  // Read the tree once (to the search's depth), then search it as the sync version does.
  let level = [''];
  for (let depth = 0; depth <= DEPTH && level.length; depth++) {
    const next: string[] = [];
    for (const dir of level) {
      const c = await children(dir);
      seen.set(dir, c);
      if (c) for (const f of c.folders) if (!skip(f)) next.push(under(dir, f));
    }
    level = next;
  }
  if (!seen.has(DEFAULT_FOLDERS.fitness)) seen.set(DEFAULT_FOLDERS.fitness, await children(DEFAULT_FOLDERS.fitness));
  return findFolders((dir) => seen.get(dir) ?? null);
}

/** Where the folders come from: the setting, the search, or (nothing found) the default. */
export type FoldersSource = 'settings' | 'found' | 'default';

/** The vault's folders: the setting in the plugin's data.json text, else the search. */
export function resolveFolders(settingsText: string | null, children: Children): { folders: Folders; source: FoldersSource } {
  const set = foldersFrom(settingsText);
  if (set) return { folders: set, source: 'settings' };
  const found = findFolders(children);
  const plan = children(found.fitness)?.files.includes(PLAN) ?? false;
  return { folders: found, source: plan || found.habits || found.workTimer ? 'found' : 'default' };
}
