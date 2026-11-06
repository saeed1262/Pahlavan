// An in-memory vault for the reminder tests: the synthetic vault's files
// (test/fixtures/vault, all made up) copied into a Map, with the folders,
// binary writes and removes Obsidian's adapter has, and hooks that let a
// test change a file between the steps of a save (the other Mac, git).
// Nothing here touches a real vault.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ReminderAdapter } from '../src/reminders/writer.ts';
import { useFolders } from '../../src/adapters/vault/layout.ts';
import { FIXTURE_FOLDERS } from '../../test/helpers.ts';

// The fixture vault keeps its files in an older install's folders.
useFolders(FIXTURE_FOLDERS);

export const FIX = join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'vault');

export interface MemVault {
  adapter: ReminderAdapter;
  files: Map<string, string>;
  binaries: Map<string, ArrayBuffer>;
  folders: Set<string>;
  writes: { path: string; data: string }[];
  removed: string[];
  json<T = any>(path: string): T;
}

export function memVault(opts: { without?: (path: string) => boolean; onRead?: (path: string, n: number, v: MemVault) => void } = {}): MemVault {
  const files = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name !== 'expected.json') {
        const rel = relative(FIX, p);
        if (!opts.without?.(rel)) files.set(rel, readFileSync(p, 'utf8'));
      }
    }
  };
  walk(FIX);
  const binaries = new Map<string, ArrayBuffer>();
  const folders = new Set<string>();
  for (const f of files.keys()) {
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
  }
  const reads = new Map<string, number>();
  const v: MemVault = {
    files,
    binaries,
    folders,
    writes: [],
    removed: [],
    json: (path) => JSON.parse(files.get(path)!),
    adapter: {
      async exists(p) {
        return files.has(p) || binaries.has(p) || folders.has(p);
      },
      async read(p) {
        const n = (reads.get(p) ?? 0) + 1;
        reads.set(p, n);
        if (!files.has(p)) throw new Error(`ENOENT ${p}`);
        const text = files.get(p)!;
        opts.onRead?.(p, n, v);
        return text;
      },
      async list(p) {
        const inside = (k: string) => k.startsWith(`${p}/`) && !k.slice(p.length + 1).includes('/');
        return { files: [...files.keys(), ...binaries.keys()].filter(inside), folders: [...folders].filter(inside) };
      },
      async write(p, data) {
        const dir = p.slice(0, p.lastIndexOf('/'));
        if (dir && !folders.has(dir)) throw new Error(`ENOENT: no folder ${dir}`);
        v.writes.push({ path: p, data });
        files.set(p, data);
      },
      async writeBinary(p, data) {
        const dir = p.slice(0, p.lastIndexOf('/'));
        if (dir && !folders.has(dir)) throw new Error(`ENOENT: no folder ${dir}`);
        binaries.set(p, data);
      },
      async remove(p) {
        v.removed.push(p);
        files.delete(p);
        binaries.delete(p);
      },
      async mkdir(p) {
        folders.add(p);
      },
    },
  };
  return v;
}

export const bytes = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;
export const text = (b: ArrayBuffer | undefined): string => (b ? new TextDecoder().decode(b) : '');
