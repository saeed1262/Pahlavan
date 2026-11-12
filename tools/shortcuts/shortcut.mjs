// A small builder for Apple Shortcuts files: unsigned XML plists, signed
// afterwards with `shortcuts sign` on a Mac signed into iCloud. Only the
// actions the Pahlavan shortcuts use.

import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const OBJ = '￼'; // the object replacement character an attachment stands on

const uuid = () => randomUUID().toUpperCase();

export const variable = (name) => ({ Type: 'Variable', VariableName: name });

export const out = (action, name) => ({ Type: 'ActionOutput', OutputUUID: action.WFWorkflowActionParameters.UUID, OutputName: name });

/** A WFTextTokenString from string parts and attachment objects. */
export function text(...parts) {
  let s = '';
  const att = {};
  for (const p of parts) {
    if (typeof p === 'string') s += p;
    else {
      att[`{${s.length}, 1}`] = p; // the range in UTF-16 units, as Shortcuts counts
      s += OBJ;
    }
  }
  return { Value: { string: s, attachmentsByRange: att }, WFSerializationType: 'WFTextTokenString' };
}

export const ref = (att) => ({ Value: att, WFSerializationType: 'WFTextTokenAttachment' });

export function action(ident, params = {}) {
  return { WFWorkflowActionIdentifier: `is.workflow.actions.${ident}`, WFWorkflowActionParameters: { UUID: uuid(), ...params } };
}

/** [[key, WFTextTokenString value]] as a dictionary field (headers, JSON body). */
export function dictField(items) {
  return {
    Value: { WFDictionaryFieldValueItems: items.map(([k, v]) => ({ WFItemType: 0, WFKey: text(k), WFValue: v })) },
    WFSerializationType: 'WFDictionaryFieldValue',
  };
}

export function runShortcut(name) {
  return action('runworkflow', {
    WFWorkflowName: name,
    WFShowWorkflow: false,
    WFWorkflow: { Value: { workflowName: name, isSelf: false }, WFSerializationType: 'WFWorkflowPickerValue' },
  });
}

export const setVar = (name, att) => action('setvariable', { WFVariableName: name, WFInput: ref(att) });

export const getValue = (key, att) => action('getvalueforkey', { WFDictionaryKey: key, WFGetDictionaryValueType: 'Value', WFInput: ref(att) });

// ---- the XML plist, as Python's plistlib.dump(..., fmt=FMT_XML) writes it:
// tab indents, keys sorted, empty containers as <dict/> and <array/>.

const HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n';

function escape(s) {
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s)) throw new Error("plist strings can't contain control characters");
  return s.replace(/\r\n?/g, '\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A JS value as an XML plist: objects, arrays, strings, booleans, numbers (integer when whole, else real). */
export function plist(root) {
  const lines = [];
  const put = (depth, line) => lines.push('\t'.repeat(depth) + line);
  const write = (v, depth) => {
    if (typeof v === 'string') put(depth, `<string>${escape(v)}</string>`);
    else if (v === true) put(depth, '<true/>');
    else if (v === false) put(depth, '<false/>');
    else if (typeof v === 'number' && Number.isInteger(v)) put(depth, `<integer>${v}</integer>`);
    else if (typeof v === 'number' && Number.isFinite(v)) put(depth, `<real>${v}</real>`);
    else if (Array.isArray(v)) {
      if (!v.length) return put(depth, '<array/>');
      put(depth, '<array>');
      for (const x of v) write(x, depth + 1);
      put(depth, '</array>');
    } else if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      // Keys sort as plistlib sorts them; they are ASCII here, so UTF-16 and code-point order agree.
      const keys = Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      if (!keys.length) return put(depth, '<dict/>');
      put(depth, '<dict>');
      for (const k of keys) {
        put(depth + 1, `<key>${escape(k)}</key>`);
        write(v[k], depth + 1);
      }
      put(depth, '</dict>');
    } else throw new TypeError(`no plist type for ${String(v)}`);
  };
  put(0, '<plist version="1.0">');
  write(root, 0);
  put(0, '</plist>');
  return HEADER + lines.join('\n') + '\n';
}

/**
 * `input`: the shortcut reads Shortcut Input (a URL scheme's text, a Run Shortcut's input). Its
 * types stay empty, so it still isn't in the share sheet; with no input it runs as from the home screen.
 */
export function save(path, actions, { color = 4282601983, glyph = 59511, input = false } = {}) {
  const wf = {
    WFWorkflowClientVersion: '2607.0.5',
    WFWorkflowClientRelease: '2.2.2',
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowMinimumClientVersionString: '900',
    WFWorkflowIcon: { WFWorkflowIconStartColor: color, WFWorkflowIconGlyphNumber: glyph },
    WFWorkflowTypes: [],
    WFQuickActionSurfaces: [],
    WFWorkflowHasShortcutInputVariables: input,
    WFWorkflowHasOutputFallback: false,
    WFWorkflowInputContentItemClasses: [
      'WFAppStoreAppContentItem', 'WFArticleContentItem', 'WFContactContentItem', 'WFDateContentItem',
      'WFEmailAddressContentItem', 'WFGenericFileContentItem', 'WFImageContentItem', 'WFiTunesProductContentItem',
      'WFLocationContentItem', 'WFDCMapsLinkContentItem', 'WFAVAssetContentItem', 'WFPDFContentItem',
      'WFPhoneNumberContentItem', 'WFRichTextContentItem', 'WFSafariWebPageContentItem', 'WFStringContentItem',
      'WFURLContentItem',
    ],
    WFWorkflowOutputContentItemClasses: [],
    WFWorkflowImportQuestions: [],
    WFWorkflowActions: actions,
  };
  writeFileSync(path, plist(wf), 'utf8');
}

// ---- control flow and the other actions the menu uses
// Only the two conditions without a comparison value: an If's "is" or "contains" value is lost on
// import (the editor shows "Please choose a value"), so comparisons go through Flow.ifMatch.
export const HAS = 100;
export const HAS_NOT = 101;

export const REPEAT_ITEM = { Type: 'Variable', VariableName: 'Repeat Item' };

/** Shortcut Input: what the shortcut was run with, or nothing (then "has any value" is false). */
export const SHORTCUT_INPUT = { Type: 'ExtensionInput' };

/** A string as a WFTextTokenString; a token string passes through. */
const textOf = (p) => (typeof p === 'string' ? text(p) : p);
/** An array of text parts, or a single part, as a WFTextTokenString. */
const partsOf = (p) => (Array.isArray(p) ? text(...p) : text(p));

/** Show Alert with its Cancel button: OK goes on, Cancel stops the shortcut. Title and message are each a string or a token string. */
export const alert = (title, message) =>
  action('alert', { WFAlertActionTitle: textOf(title), WFAlertActionMessage: textOf(message), WFAlertActionCancelButtonShown: true });

/** Open URLs, on an attachment that holds a link (or its text). */
export const openUrl = (att) => action('openurl', { WFInput: ref(att), 'Show-WFInput': true });
/** Copy to Clipboard, on this phone only (not handed to a nearby Mac). */
export const copyToClipboard = (att) => action('setclipboard', { WFInput: ref(att), WFLocalOnly: true });
/** A URL action: the address typed in. Its output is "URL". */
export const urlAction = (address) => action('url', { WFURLActionURL: text(address) });

/** Collects actions; if/menu/repeat open groups that end() closes. */
export class Flow {
  a = [];
  stack = [];

  add(act) {
    this.a.push(act);
    return act;
  }

  text(...parts) {
    return this.add(action('gettext', { WFTextActionText: text(...parts) }));
  }

  /** A Text action whose output goes into a variable. */
  textAs(name, ...parts) {
    const t = this.text(...parts);
    this.set(name, out(t, 'Text'));
    return t;
  }

  set(name, att) {
    return this.add(setVar(name, att));
  }

  append(name, att) {
    return this.add(action('appendvariable', { WFVariableName: name, WFInput: ref(att) }));
  }

  value(key, att, varName = null, kind = 'Value') {
    const g = this.add(action('getvalueforkey', { WFDictionaryKey: key, WFGetDictionaryValueType: kind, WFInput: ref(att) }));
    if (varName) this.set(varName, out(g, 'Dictionary Value'));
    return g;
  }

  if(cond, att, string = null) {
    const g = uuid();
    this.stack.push(['conditional', g]);
    const p = { GroupingIdentifier: g, WFControlFlowMode: 0, WFCondition: cond, WFInput: { Type: 'Variable', Variable: ref(att) } };
    if (string !== null) p.WFConditionalActionString = textOf(string);
    return this.add(action('conditional', p));
  }

  otherwise() {
    const [kind, g] = this.stack.at(-1) ?? [];
    if (kind !== 'conditional') throw new Error(`otherwise() inside ${kind}`);
    return this.add(action('conditional', { GroupingIdentifier: g, WFControlFlowMode: 1 }));
  }

  menu(prompt, items) {
    const g = uuid();
    this.stack.push(['choosefrommenu', g]);
    return this.add(action('choosefrommenu', { GroupingIdentifier: g, WFControlFlowMode: 0, WFMenuPrompt: textOf(prompt), WFMenuItems: [...items] }));
  }

  item(title) {
    const [kind, g] = this.stack.at(-1) ?? [];
    if (kind !== 'choosefrommenu') throw new Error(`item() inside ${kind}`);
    return this.add(action('choosefrommenu', { GroupingIdentifier: g, WFControlFlowMode: 1, WFMenuItemTitle: title }));
  }

  repeat(att) {
    const g = uuid();
    this.stack.push(['repeat.each', g]);
    return this.add(action('repeat.each', { GroupingIdentifier: g, WFControlFlowMode: 0, WFInput: ref(att) }));
  }

  end() {
    if (!this.stack.length) throw new Error('end() with no open group');
    const [kind, g] = this.stack.pop();
    return this.add(action(kind, { GroupingIdentifier: g, WFControlFlowMode: 2 }));
  }

  /** A notification; title and body are each a string or an array of text parts. */
  notify(title, body) {
    return this.add(action('notification', { WFNotificationActionTitle: partsOf(title), WFNotificationActionBody: partsOf(body) }));
  }

  stop() {
    return this.add(action('exit'));
  }

  askNumber(prompt, varName, { default: answer = null, decimals = false, negatives = false } = {}) {
    const p = { WFAskActionPrompt: partsOf(prompt), WFInputType: 'Number', WFAskActionAllowsDecimalNumbers: decimals, WFAskActionAllowsNegativeNumbers: negatives };
    if (answer !== null) p.WFAskActionDefaultAnswer = text(answer);
    const q = this.add(action('ask', p));
    this.set(varName, out(q, 'Provided Input'));
    return q;
  }

  fmtDate(att, fmt, varName) {
    const f = this.add(action('format.date', { WFDateFormatStyle: 'Custom', WFDateFormat: fmt, WFDate: text(att) }));
    this.set(varName, out(f, 'Formatted Date'));
    return f;
  }

  /** If the text matches the regex (Match Text, then has a value): no comparison value to lose on import. */
  ifMatch(att, ...pattern) {
    return this.#match(att, pattern, HAS);
  }

  /** If the text doesn't match the regex (Match Text, then has no value). */
  ifNotMatch(att, ...pattern) {
    return this.#match(att, pattern, HAS_NOT);
  }

  #match(att, pattern, cond) {
    const m = this.add(action('text.match', { text: text(att), WFMatchTextPattern: text(...pattern), WFMatchTextCaseSensitive: true }));
    return this.if(cond, out(m, 'Matches'));
  }

  /** The actions, once every group is closed. */
  done() {
    if (this.stack.length) throw new Error(`unclosed groups: ${this.stack.map(([k]) => k).join(', ')}`);
    return this.a;
  }
}
