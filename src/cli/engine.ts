// The Node entry for dist/engine.cjs: the only file that touches `process`, the
// file system or the clock. It reads, and writes files at the vault's layout:
// Coach/checkins.json, Coach/tracking.json, body-data.json, (track tick's and
// log add's habit ticks) habits-data.json, Coach/eating-plan.json and (log,
// and the phone's inbox) fitness-log-data.json; for the inbox also
// Coach/nudges.json, and inside Coach/Inbox/ its refused.json and phone.json
// and the moves to applied/.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { INBOX_FILES, isEntryFile } from '../report/inbox.ts';
import { run, type CliIo, type CliResult } from './cli.ts';
import { paths } from '../adapters/vault/layout.ts';

const pad = (n: number) => String(n).padStart(2, '0');

const io: CliIo = {
  today() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  },
  clock() {
    const d = new Date();
    return { minutes: d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60, offsetMinutes: -d.getTimezoneOffset() };
  },
  readText(path) {
    return existsSync(path) && statSync(path).isFile() ? readFileSync(path, 'utf8') : null;
  },
  listDir(path) {
    return existsSync(path) && statSync(path).isDirectory() ? readdirSync(path) : null;
  },
  isDir(path) {
    return existsSync(path) && statSync(path).isDirectory();
  },
  // The CLI's writes: the check-in log, the tracking file and the body log, at their fixed places in the vault.
  writeCheckins(root, text) {
    writeAtomic(join(root, paths().checkins), text);
  },
  writeTracking(root, text) {
    writeAtomic(join(root, paths().tracking), text);
  },
  writeBody(root, text) {
    writeAtomic(join(root, paths().body), text);
  },
  writeEating(root, text) {
    writeAtomic(join(root, paths().eating), text);
  },
  writeHabits(root, text) {
    // The habit check-ins: an existing file merged, or a vault's first one (the merges start it with Workout and Protein).
    writeAtomic(join(root, paths().habits), text);
  },
  writeLog(root, text) {
    writeAtomic(join(root, paths().log), text);
  },
  writeNudges(root, text) {
    writeAtomic(join(root, paths().nudges), text);
  },
  writeInbox(root, name, text) {
    if (name !== INBOX_FILES.refused && name !== INBOX_FILES.phone) throw new Error(`not one of the inbox's own files: ${name}`);
    writeAtomic(join(root, paths().inbox, name), text);
  },
  moveInbox(root, file, to) {
    // Only an entry file in the inbox, only into applied/<YYYY-MM>/ under it, never over another file.
    if (!isEntryFile(file) || !/^applied\/\d{4}-\d{2}\/[^/]+\.json$/.test(to) || to.split('/').pop() !== file) throw new Error(`not an inbox move: ${file} to ${to}`);
    const from = join(root, paths().inbox, file);
    const dest = join(root, paths().inbox, to);
    if (existsSync(dest)) throw new Error(`${paths().inbox}/${to} exists already`);
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(from, dest);
  },
};

/** A temporary file renamed over the old one (the folder made if needed), then read back. */
function writeAtomic(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = join(dirname(file), `.${file.split('/').pop()}.${process.pid}.tmp`);
  writeFileSync(tmp, text);
  renameSync(tmp, file);
  if (readFileSync(file, 'utf8') !== text) throw new Error(`read-back of ${file} differs from what was written`);
}

let result: CliResult;
try {
  result = run(process.argv.slice(2), io);
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  result = { code: 1, stdout: `${JSON.stringify({ ok: false, errors: [{ code: 'internal', message }] })}\n`, stderr: `engine: internal error: ${message}\n` };
}
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.code;
