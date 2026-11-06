// Reads the vault's fitness files through a small I/O interface (the CLI's
// Node entry supplies it; tests pass an in-memory one). Read-only: the
// interface has no write method.

import { fromVault, type VaultData, type VaultFiles, type VaultOptions, type VaultWarning } from './convert.ts';
import { paths } from './layout.ts';

export interface ReadIo {
  /** The file's text, or null when it does not exist. */
  readText(path: string): string | null;
  /** The names in a folder, or null when it does not exist. */
  listDir(path: string): string[] | null;
}

/** The files the adapter reads; each one's path is the vault's layout's (`paths()`). */
export type VaultFileKey = 'plan' | 'log' | 'body' | 'habits' | 'profile' | 'ledger' | 'checkins' | 'eating';

export const joinPath = (root: string, rel: string): string => (root === '' || root === '.' ? rel : `${root.replace(/\/+$/, '')}/${rel}`);

export interface VaultRead {
  data: VaultData;
  /** Each file and whether it was found. */
  files: Record<VaultFileKey, 'found' | 'missing'>;
  /** Each file as parsed JSON, before conversion (the log writer needs plan-data and the log as they are). */
  raw?: Partial<Record<VaultFileKey, unknown>>;
}

/** The files the adapter reads, in order. */
export const VAULT_FILE_KEYS: readonly VaultFileKey[] = ['plan', 'log', 'body', 'habits', 'profile', 'ledger', 'checkins', 'eating'];

/** An asynchronous reader (the plugin reads through its vault adapter). Read-only, like `ReadIo`. */
export interface AsyncReadIo {
  readText(path: string): Promise<string | null>;
  listDir(path: string): Promise<string[] | null>;
}

/**
 * The files' texts (null: missing) and the names in the fitness folder into
 * schema v1. Pure: both readers end here, so the CLI and the plugin get the
 * same data from the same texts.
 */
export function assembleVault(texts: Readonly<Partial<Record<VaultFileKey, string | null>>>, fitnessNames: readonly string[] | null, root: string, opts: VaultOptions = {}): VaultRead {
  const errors: VaultWarning[] = [];
  const warnings: VaultWarning[] = [];
  const found = {} as Record<VaultFileKey, 'found' | 'missing'>;
  const load = (key: VaultFileKey): unknown => {
    const path = paths()[key];
    const text = texts[key] ?? null;
    found[key] = text === null ? 'missing' : 'found';
    if (text === null) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch (e) {
      errors.push({ code: 'json', message: `${path} is not valid JSON: ${(e as Error).message}` });
      return undefined;
    }
  };
  const files: VaultFiles = { plan: load('plan') };
  for (const key of ['log', 'body', 'habits', 'profile', 'ledger', 'checkins', 'eating'] as const) {
    const v = load(key);
    if (v !== undefined) files[key] = v;
  }
  if (found.plan === 'missing') errors.push({ code: 'missing', message: `${paths().plan} was not found under ${root}.` });
  for (const key of ['log', 'body', 'habits'] as const) {
    if (found[key] === 'missing') warnings.push({ code: 'missing', message: `${paths()[key]} was not found; read as empty.` });
  }
  const names = fitnessNames ?? [];
  files.baselines = names.map((n) => /^Baseline - (\d{4}-\d{2}-\d{2})\.md$/.exec(n)?.[1]).filter((d): d is string => d !== undefined);

  const data = files.plan === undefined && found.plan === 'missing' ? fromVault({ ...files, plan: {} }, opts) : fromVault(files, opts);
  if (found.plan === 'missing') data.errors = data.errors.filter((e) => e.code !== 'plan-data');
  data.errors.unshift(...errors);
  data.warnings.unshift(...warnings);
  const raw: Partial<Record<VaultFileKey, unknown>> = {};
  for (const key of VAULT_FILE_KEYS) if (files[key as keyof VaultFiles] !== undefined) raw[key] = files[key as keyof VaultFiles];
  return { data, files: found, raw };
}


/** The newest letter among a folder's names: the latest date in a `.md` name (else the last name in order); null without one. */
export function newestLetterName(names: readonly string[]): string | null {
  const dateOf = (n: string) => /(\d{4}-\d{2}-\d{2})[^/]*\.md$/.exec(n)?.[1] ?? '';
  const md = names.filter((n) => n.endsWith('.md')).sort((a, b) => {
    const da = dateOf(a);
    const db = dateOf(b);
    return da === db ? (a < b ? -1 : 1) : da < db ? -1 : 1;
  });
  return md.at(-1) ?? null;
}

/** The newest coach letter (Coach/Letters): its path relative to the vault and its text; null without one. The CLI's `due` reads it for the coach step, as the plugin does. */
export function readNewestLetter(io: ReadIo, root: string): { path: string; text: string } | null {
  const dir = paths().letters;
  const name = newestLetterName(io.listDir(joinPath(root, dir)) ?? []);
  const path = name ? `${dir}/${name}` : null;
  const text = path ? io.readText(joinPath(root, path)) : null;
  return path && text !== null ? { path, text } : null;
}

/** Reads and converts the vault at `root`. A missing plan-data.json is an error; the other files may be missing. */
export function readVault(io: ReadIo, root: string, opts: VaultOptions = {}): VaultRead {
  const texts: Partial<Record<VaultFileKey, string | null>> = {};
  for (const key of VAULT_FILE_KEYS) texts[key] = io.readText(joinPath(root, paths()[key]));
  return assembleVault(texts, io.listDir(joinPath(root, paths().fitness)), root, opts);
}

/** `readVault` through an asynchronous reader: the same files, the same assembly. */
export async function readVaultAsync(io: AsyncReadIo, root: string, opts: VaultOptions = {}): Promise<VaultRead> {
  const texts: Partial<Record<VaultFileKey, string | null>> = {};
  const entries = await Promise.all(VAULT_FILE_KEYS.map(async (key) => [key, await io.readText(joinPath(root, paths()[key]))] as const));
  for (const [key, text] of entries) texts[key] = text;
  return assembleVault(texts, await io.listDir(joinPath(root, paths().fitness)), root, opts);
}
