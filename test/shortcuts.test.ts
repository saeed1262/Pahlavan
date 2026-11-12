// The phone shortcuts (tools/shortcuts/build.mjs): both files build, with the
// action counts the README's import notes were checked against, every action
// output a step refers to exists, and no token is written into either file.
// And the gym page's parts of Pahlavan: the input branch that sends the page's
// session, the Gym item that opens the page, and number unquoting that leaves
// the page's JSON as it came.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';
import { GYM_PAGE, GYM_SEND, gymSendUrl, type GymEntry } from '../src/core/gym.ts';

const ROOT = join(import.meta.dirname, '..');
const FILES = { 'Pahlavan.shortcut': 315, 'Health to Pahlavan.shortcut': 121 };

/** A plist as the builder writes it (dict, array, string, integer, real, true, false), read back. */
function parsePlist(xml: string): any {
  const tokens = [...xml.matchAll(/<(\/?)(dict|array|key|string|integer|real|true|false)(\/?)>([^<]*)/g)];
  const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  let i = 0;
  const closing = () => tokens[i]![1] === '/';
  const value = (): any => {
    const [, , tag, self, body = ''] = tokens[i++]!;
    if (tag === 'true' || tag === 'false') return tag === 'true';
    if (tag === 'string' || tag === 'integer' || tag === 'real') {
      i++; // its closing tag
      return tag === 'string' ? unescape(body) : Number(body);
    }
    if (tag === 'array') {
      const a: any[] = [];
      if (self) return a;
      while (!closing()) a.push(value());
      i++; // </array>
      return a;
    }
    if (tag === 'dict') {
      const o: Record<string, any> = {};
      if (self) return o;
      while (!closing()) {
        const key = unescape(tokens[i]![4] ?? '');
        i += 2; // <key> and </key>
        o[key] = value();
      }
      i++; // </dict>
      return o;
    }
    throw new Error(`unexpected <${tag}>`);
  };
  return value();
}

interface Act { WFWorkflowActionIdentifier: string; WFWorkflowActionParameters: Record<string, any> }
const kind = (a: Act) => a.WFWorkflowActionIdentifier.replace('is.workflow.actions.', '');
const params = (a: Act) => a.WFWorkflowActionParameters;
/** The attachment an action's WFInput (or an If's) holds. */
const inputOf = (a: Act) => params(a)['WFInput']?.Variable?.Value ?? params(a)['WFInput']?.Value;

describe('phone shortcuts', () => {
  let out = '';
  let stdout = '';
  const read = (name: string) => readFileSync(join(out, name), 'utf8');

  before(() => {
    out = mkdtempSync(join(tmpdir(), 'pahlavan-shortcuts-'));
    process.on('exit', () => rmSync(out, { recursive: true, force: true }));
    const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'shortcuts', 'build.mjs'),
      '--repo', 'someone/vault', '--inbox', '/3-Personal/Fitness/Coach/Inbox/', '--out', out], { encoding: 'utf8', cwd: ROOT });
    assert.equal(r.status, 0, r.stderr);
    stdout = r.stdout;
  });

  it('writes the two files as XML plists', () => {
    assert.deepEqual(readdirSync(out).sort(), Object.keys(FILES).sort());
    for (const name of Object.keys(FILES)) {
      const xml = read(name);
      assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist'), name);
      assert.ok(xml.endsWith('</dict>\n</plist>\n'), name);
    }
  });

  it('has the expected number of actions in each', () => {
    for (const [name, count] of Object.entries(FILES)) {
      assert.equal(read(name).split('<key>WFWorkflowActionIdentifier</key>').length - 1, count, name);
      assert.match(stdout, new RegExp(`${name} \\(${count} actions, `));
    }
  });

  it('points every request at the inbox folder', () => {
    const xml = read('Pahlavan.shortcut');
    assert.ok(xml.includes('<string>https://api.github.com/repos/someone/vault/contents/3-Personal/Fitness/Coach/Inbox/phone.json</string>'));
    assert.doesNotMatch(xml, /Inbox\/\/|contents\/\//);
  });

  it('refers only to action outputs that exist, and closes every group it opens', () => {
    const ids = (xml: string, key: string) => [...xml.matchAll(new RegExp(`<key>${key}</key>\\n\\t*<string>([0-9A-F-]{36})</string>`, 'g'))].map((m) => m[1]);
    for (const name of Object.keys(FILES)) {
      const xml = read(name);
      const actions = new Set(ids(xml, 'UUID'));
      assert.equal(actions.size, FILES[name as keyof typeof FILES], `${name}: one UUID per action`);
      for (const u of ids(xml, 'OutputUUID')) assert.ok(actions.has(u), `${name}: output of a missing action ${u}`);
      const groups = new Map<string, number>();
      for (const g of ids(xml, 'GroupingIdentifier')) groups.set(g!, (groups.get(g!) ?? 0) + 1);
      assert.ok(groups.size > 0, `${name}: no groups found`);
      for (const [g, n] of groups) assert.ok(n >= 2, `${name}: group ${g} is never closed`);
    }
  });

  it('holds no token', () => {
    for (const name of Object.keys(FILES)) assert.doesNotMatch(read(name), /github_pat|ghp_/, name);
  });

  // ---- the gym page

  const pahlavan = () => parsePlist(read('Pahlavan.shortcut')) as { WFWorkflowActions: Act[]; WFWorkflowTypes: unknown[]; WFWorkflowHasShortcutInputVariables: boolean };
  /** The If, Otherwise and End of a group, by the opening action's index. */
  const groupOf = (acts: Act[], start: number) => {
    const g = params(acts[start]!)['GroupingIdentifier'];
    const at = (mode: number) => acts.findIndex((a) => params(a)['GroupingIdentifier'] === g && params(a)['WFControlFlowMode'] === mode);
    return { otherwise: at(1), end: at(2) };
  };

  it('takes Shortcut Input, and stays out of the share sheet', () => {
    const wf = pahlavan();
    assert.equal(wf.WFWorkflowHasShortcutInputVariables, true);
    assert.deepEqual(wf.WFWorkflowTypes, []);
    const health = parsePlist(read('Health to Pahlavan.shortcut'));
    assert.equal(health.WFWorkflowHasShortcutInputVariables, false);
    assert.deepEqual(health.WFWorkflowTypes, []);
  });

  it('with input, asks once with the page\'s words and sends the session as it came', () => {
    const acts = pahlavan().WFWorkflowActions;
    const start = acts.findIndex((a) => kind(a) === 'conditional' && params(a)['WFControlFlowMode'] === 0 && inputOf(a)?.Type === 'ExtensionInput');
    assert.ok(start > 0, 'an If on Shortcut Input');
    assert.equal(params(acts[start]!)['WFCondition'], 100, 'has any value');
    // After the token and the dates, before phone.json is read
    assert.equal(kind(acts[0]!), 'runworkflow');
    assert.equal(acts.filter((a) => kind(a) === 'runworkflow').length, 1, 'one Run Shortcut, at the top');
    assert.ok(acts.slice(start).every((a) => kind(a) !== 'format.date'), 'the dates come first');
    const { otherwise, end } = groupOf(acts, start);
    assert.ok(start < otherwise && otherwise < end);

    const branch = acts.slice(start + 1, otherwise);
    assert.deepEqual(branch.map(kind), ['detect.dictionary', 'getvalueforkey', 'alert', 'gettext', 'setvariable', 'gettext', 'setvariable']);
    const [detect, say, alert, entry, setEntry, kindText, setKind] = branch as [Act, Act, Act, Act, Act, Act, Act];
    assert.equal(inputOf(detect).Type, 'ExtensionInput');
    assert.equal(params(say)['WFDictionaryKey'], '_say');
    assert.equal(inputOf(say).OutputUUID, params(detect)['UUID']);
    assert.equal(params(alert)['WFAlertActionTitle'].Value.string, 'Send to Pahlavan?');
    assert.equal(params(alert)['WFAlertActionCancelButtonShown'], true, 'Cancel stops the shortcut');
    assert.equal(params(alert)['WFAlertActionMessage'].Value.attachmentsByRange['{0, 1}'].OutputUUID, params(say)['UUID']);
    const tokens = params(entry)['WFTextActionText'].Value;
    assert.equal(tokens.string, '{"v":1,"at":"\ufffc","date":"\ufffc","kind":"session","session":\ufffc}');
    assert.deepEqual(Object.values(tokens.attachmentsByRange), [{ Type: 'Variable', VariableName: 'At' }, { Type: 'Variable', VariableName: 'Day' }, { Type: 'ExtensionInput' }]);
    assert.equal(params(setEntry)['WFVariableName'], 'Entry');
    assert.equal(params(kindText)['WFTextActionText'].Value.string, 'session');
    assert.equal(params(setKind)['WFVariableName'], 'Kind');

    // Otherwise: phone.json and the menu; after the If, the send both reach
    const get = acts.findIndex((a) => kind(a) === 'downloadurl' && params(a)['WFHTTPMethod'] === 'GET');
    const menu = acts.findIndex((a) => kind(a) === 'choosefrommenu' && params(a)['WFMenuPrompt']?.Value?.string === 'Pahlavan');
    assert.ok(otherwise < get && get < menu && menu < end, 'the GET and the menu are the Otherwise');
    assert.deepEqual(acts.slice(end + 1, end + 4).map(kind), ['text.replace', 'text.replace', 'setvariable']);
    const put = acts.findIndex((a) => kind(a) === 'downloadurl' && params(a)['WFHTTPMethod'] === 'PUT');
    assert.ok(put > end);
  });

  it('puts Gym first in the menu: phone.json\'s gym link goes on the clipboard, and the page opens with #paste', () => {
    const acts = pahlavan().WFWorkflowActions;
    const menu = acts.findIndex((a) => kind(a) === 'choosefrommenu' && params(a)['WFMenuPrompt']?.Value?.string === 'Pahlavan');
    const titles = ['Gym', 'Water', 'Tick habits', 'Log a session', 'Did you train?', 'Morning check-in'];
    assert.deepEqual(params(acts[menu]!)['WFMenuItems'], titles);
    const g = params(acts[menu]!)['GroupingIdentifier'];
    const items = acts.flatMap((a, i) => (params(a)['GroupingIdentifier'] === g && params(a)['WFControlFlowMode'] === 1 ? [i] : []));
    assert.deepEqual(items.map((i) => params(acts[i]!)['WFMenuItemTitle']), titles);

    const gym = acts.slice(items[0]! + 1, items[1]!);
    const value = gym.find((a) => kind(a) === 'getvalueforkey' && params(a)['WFDictionaryKey'] === 'gym');
    assert.ok(value, 'gets gym from Phone');
    assert.deepEqual(inputOf(value), { Type: 'Variable', VariableName: 'Phone' });
    const copy = gym.findIndex((a) => kind(a) === 'setclipboard');
    assert.ok(copy >= 0, 'copies the link');
    assert.equal(inputOf(gym[copy]!).OutputUUID, params(value)['UUID'], 'Copy to Clipboard is fed the gym value');
    assert.equal(params(gym[copy]!)['WFLocalOnly'], true, 'on this phone only');
    const url = gym.findIndex((a) => kind(a) === 'url');
    assert.equal(params(gym[url]!)['WFURLActionURL'].Value.string, `${GYM_PAGE}#paste`, 'the page, marked to load from the clipboard');
    const open = gym.flatMap((a, i) => (kind(a) === 'openurl' ? [i] : []));
    assert.equal(open.length, 1);
    assert.equal(inputOf(gym[open[0]!]!).OutputUUID, params(gym[url]!)['UUID'], 'Open URLs is fed the page\'s address, never the long link');
    assert.ok(copy < url && url < open[0]!, 'copied before the page opens');
    assert.ok(gym.some((a) => kind(a) === 'notification' && params(a)['WFNotificationActionBody'].Value.string === 'No gym page yet: open Pahlavan on your Mac first'));
    assert.equal(kind(gym.at(-1)!), 'exit', 'Gym sends nothing: it stops after opening the page');
    assert.equal(gym.filter((a) => kind(a) === 'exit').length, 2, 'and stops when there is no link');
  });

  it('unquotes only the numbers the shortcut quoted: the page\'s JSON passes through unchanged', () => {
    const replaces = pahlavan().WFWorkflowActions.filter((a) => kind(a) === 'text.replace');
    assert.equal(replaces.length, 2);
    // ICU (Shortcuts) and JS agree on this subset: groups, \s, \d, a class, $n in the replacement.
    const unquote = (s: string) => replaces.reduce((t, a) => t.replace(new RegExp(params(a)['WFReplaceTextFind'], 'g'), params(a)['WFReplaceTextReplace']), s);
    const head = '{"v":1,"at":"2026-11-10T07:30:00-05:00","date":"2026-11-10",';

    // The menu's own entries: quoted numbers, a decimal comma or point, a minus
    const menu = unquote(`${head}"kind":"session","session":{"type":"A","lift1":{"weight":"82,5","reps":"5"},"lift2":{"weight":"60","reps":"8"},"durationMin":"45","express":true}}`);
    assert.deepEqual(JSON.parse(menu).session, { type: 'A', lift1: { weight: 82.5, reps: 5 }, lift2: { weight: 60, reps: 8 }, durationMin: 45, express: true });
    assert.deepEqual(JSON.parse(unquote(`${head}"kind":"amount","id":"water","add":"-250"}`)).add, -250);
    assert.deepEqual(JSON.parse(unquote(`${head}"kind":"morning","morning":{"energy":"3","sleepH":"7.5"}}`)).morning, { energy: 3, sleepH: 7.5 });

    // The page's session, as its Send hands it over: numbers and nulls unquoted, a note with quotes and commas
    const session: GymEntry = {
      type: 'A',
      lift1: { name: 'Front Squat', planned: 'Back Squat', swapWhy: 'mine', weight: 82.5, reps: 5, unit: 'kg' },
      lift2: { weight: 60, reps: 8 },
      durationMin: 52,
      notes: 'Bar felt "heavy", 2,5 kg plates; next "reps":"5","weight":"82,5" {"rir":"2"} \\"',
      trackingLevel: 'full',
      exerciseSets: [
        { name: 'Front Squat', planned: 'Back Squat', sets: [{ weight: 82.5, unit: 'kg', reps: 5, rir: 2 }, { weight: 82.5, unit: 'kg', reps: 5, rir: null }] },
        { name: 'Push-up "weight"', sets: [{ weight: null, unit: null, reps: 12 }] },
      ],
      swaps: [{ from: 'Face Pull', to: 'Band "Pull-apart", 2', why: 'hotel' }],
      skipped: ['Face Pull + Band External Rotation'],
      skipWhy: { 'Face Pull + Band External Rotation': 'time', 'x"reps': 'pain' },
      _say: 'A · 12 sets',
    };
    const input = decodeURIComponent(gymSendUrl(session).slice(GYM_SEND.length));
    const page = `${head}"kind":"session","session":${input}}`;
    assert.equal(unquote(page), page);
    assert.deepEqual(JSON.parse(unquote(page)).session, session);
  });
});
