// The Mac around Obsidian, ported from Habit Nudges: seconds since the last
// keyboard or mouse input (through ioreg), photo conversion with macOS's sips, the notification, and bringing Obsidian forward. Node
// and Electron are reached through Obsidian's own `require` at run time
// (never bundled), and every one of these fails soft: an unknown idle time
// is null (the caller decides: a reminder still shows, but sitting and
// stand-ups are not counted), a missing helper is "no call", a failed sips
// is "save the photo as it is". Nothing here needs the Habit Nudges plugin.

import { sipsArgs } from '../../../src/adapters/vault/body-write.ts';
import type { PhotoIn } from './writer.ts';

type Req = (id: string) => unknown;
/** Obsidian's desktop `require` (Node's, in Electron), or null in a browser. */
export function nodeRequire(): Req | null {
  const r = (window as unknown as { require?: Req }).require;
  return typeof r === 'function' ? r : null;
}

interface ChildProcess {
  execFile(file: string, args: string[], opts: { timeout: number; maxBuffer?: number }, cb: (err: Error | null, out: string) => void): void;
}
interface Fs {
  existsSync(p: string): boolean;
  mkdtempSync(p: string): string;
  writeFileSync(p: string, d: Uint8Array): void;
  readFileSync(p: string): Uint8Array & { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
  rmSync(p: string, o: { recursive: boolean; force: boolean }): void;
}
interface Path {
  join(...p: string[]): string;
  isAbsolute(p: string): boolean;
}
interface Os {
  tmpdir(): string;
  hostname(): string;
  homedir(): string;
}

function mod<T>(id: string): T | null {
  try {
    return (nodeRequire()?.(id) as T) ?? null;
  } catch {
    return null;
  }
}

interface ElectronWindow {
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  moveTop(): void;
  setAlwaysOnTop(on: boolean, level?: string): void;
  setVisibleOnAllWorkspaces(on: boolean, o?: Record<string, boolean>): void;
}
interface Remote {
  powerMonitor?: { getSystemIdleTime?(): number };
  getCurrentWindow?(): ElectronWindow;
  app?: { focus?(o?: { steal: boolean }): void };
}
function remote(): Remote | null {
  try {
    return (mod<{ remote?: Remote }>('electron')?.remote) ?? null;
  } catch {
    return null;
  }
}

/** The platform Obsidian runs on ("darwin" on a Mac), or null in a browser. */
export function platform(): string | null {
  const p = (window as unknown as { process?: { platform?: unknown } }).process?.platform;
  return typeof p === 'string' ? p : null;
}

/**
 * Seconds since the last keyboard or mouse input anywhere on the computer:
 * Electron's powerMonitor where the window can reach it, else macOS's
 * `ioreg` (HIDIdleTime). Null when it can't tell (another OS without the
 * powerMonitor, or the reading failed): the caller decides what unknown
 * means (a reminder still shows; sitting and stand-ups are not counted).
 */
export function systemIdleSeconds(): Promise<number | null> {
  const pm = remote()?.powerMonitor;
  if (pm && typeof pm.getSystemIdleTime === 'function') {
    try {
      const v = pm.getSystemIdleTime();
      if (typeof v === 'number' && Number.isFinite(v)) return Promise.resolve(v);
    } catch {
      // fall back to ioreg
    }
  }
  const cp = mod<ChildProcess>('child_process');
  if (!cp || platform() !== 'darwin') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      cp.execFile('/usr/sbin/ioreg', ['-c', 'IOHIDSystem'], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => resolve(err ? null : parseIoreg(String(out ?? ''))));
    } catch {
      resolve(null);
    }
  });
}

/** ioreg's HIDIdleTime (nanoseconds) as seconds; null when the output has none. */
export function parseIoreg(out: string): number | null {
  const m = /"HIDIdleTime"\s*=\s*(\d+)/.exec(out);
  return m ? Number(m[1]) / 1e9 : null;
}

/**
 * One photo as a JPEG at most 1600 px on its long side, through macOS's
 * sips (HEIC from an iPhone included); the original bytes, with their own
 * extension, when sips is not there or fails.
 */
export async function convertPhoto(p: PhotoIn): Promise<{ data: ArrayBuffer; ext: string }> {
  const asIs = () => ({ data: p.data, ext: ((/\.([a-z0-9]+)$/i.exec(p.name) ?? [])[1] ?? 'jpeg').toLowerCase() });
  const fs = mod<Fs>('fs');
  const os = mod<Os>('os');
  const path = mod<Path>('path');
  const cp = mod<ChildProcess>('child_process');
  if (!fs || !os || !path || !cp || !fs.existsSync('/usr/bin/sips')) return asIs();
  let dir: string | null = null;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pahlavan-photo-'));
    const src = path.join(dir, `in${(/\.[a-z0-9]+$/i.exec(p.name) ?? ['.jpg'])[0]}`);
    const out = path.join(dir, 'out.jpeg');
    fs.writeFileSync(src, new Uint8Array(p.data));
    await new Promise<void>((resolve, reject) => cp.execFile('/usr/bin/sips', sipsArgs(src, out), { timeout: 30_000 }, (err) => (err ? reject(err) : resolve())));
    const res = fs.readFileSync(out);
    return { data: res.buffer.slice(res.byteOffset, res.byteOffset + res.byteLength), ext: 'jpeg' };
  } catch (e) {
    console.warn('[Pahlavan] the photo could not be converted; saving it as it is', e);
    return asIs();
  } finally {
    if (dir) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // a temporary folder left behind is harmless
      }
    }
  }
}

/** This Mac's host name, for its name in Coach/sitting.json. */
export function hostName(): string | null {
  try {
    return mod<Os>('os')?.hostname() ?? null;
  } catch {
    return null;
  }
}

/** This Mac's home folder, or null. */
export function homeDir(): string | null {
  try {
    return mod<Os>('os')?.homedir() ?? null;
  } catch {
    return null;
  }
}

/** A program's output (stdout), or null when it doesn't run or fails: the coach setup asks `node --version` with it. */
export function runProgram(file: string, args: string[]): Promise<string | null> {
  const cp = mod<ChildProcess>('child_process');
  if (!cp) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      cp.execFile(file, args, { timeout: 5000 }, (err, out) => resolve(err ? null : String(out ?? '')));
    } catch {
      resolve(null);
    }
  });
}

/** Obsidian's window to the front (from a notification's click). */
export function focusObsidian(): void {
  try {
    const win = remote()?.getCurrentWindow?.();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return;
    }
  } catch {
    // no remote module
  }
  window.focus();
}

/**
 * While the stand-up card is up, Obsidian's window floats above every app
 * and on every desktop (back from the Dock if it was minimized); false lets
 * it go. Without Electron's remote module the card still shows, inside
 * Obsidian only.
 */
export function holdObsidianFront(on: boolean): void {
  try {
    const r = remote();
    const win = r?.getCurrentWindow?.();
    if (!win) {
      if (on) window.focus();
      return;
    }
    if (on) {
      if (win.isMinimized()) win.restore();
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
      win.setAlwaysOnTop(true, 'screen-saver');
      win.show();
      win.moveTop();
      win.focus();
      r?.app?.focus?.({ steal: true });
    } else {
      win.setAlwaysOnTop(false);
      win.setVisibleOnAllWorkspaces(false, { skipTransformProcessType: true });
    }
  } catch {
    if (on) window.focus();
  }
}

/** A macOS notification (Obsidian asks macOS for permission once); the click runs `onClick`. */
export function notifyMac(title: string, body: string, onClick: () => void): void {
  try {
    const N = (window as unknown as { Notification?: new (t: string, o: { body: string }) => { onclick: (() => void) | null } }).Notification;
    if (!N) return;
    const n = new N(title, { body });
    n.onclick = () => onClick();
  } catch {
    // notifications unavailable
  }
}

/** Two soft notes when a stand is done (Habit Nudges' chime). */
export function chime(): void {
  try {
    const Ctx = (window as unknown as { AudioContext?: new () => AudioContext }).AudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    for (const [f, at] of [[660, 0], [880, 0.2]] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.7);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 0.75);
    }
    window.setTimeout(() => void ctx.close(), 1500);
  } catch {
    // no audio
  }
}
