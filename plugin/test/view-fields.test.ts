// Guards against a field on the view shadowing one of Obsidian's View or
// Component members. A field named `open` once replaced View.open(), which
// Obsidian calls to start the view, so the tab stayed blank with no error.
// The reminder card's Modal gets the same check against Modal's members.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const RESERVED = [
  'app', 'leaf', 'containerEl', 'contentEl', 'navigation', 'icon', 'scope', 'allowNoFile',
  'open', 'close', 'onOpen', 'onClose', 'load', 'unload', 'onload', 'onunload',
  'register', 'registerEvent', 'registerInterval', 'registerDomEvent', 'addChild', 'removeChild',
  'getState', 'setState', 'getEphemeralState', 'setEphemeralState', 'getViewType', 'getDisplayText',
  'getIcon', 'onResize', 'onPaneMenu', 'addAction', 'requestSaveLayout',
];

test('no PahlavanView field shadows an Obsidian View member', () => {
  const src = readFileSync(new URL('../src/view.ts', import.meta.url).pathname, 'utf8');
  const fields = [...src.matchAll(/^\s+(?:private|protected|public)\s+(?:readonly\s+)?([A-Za-z_]\w*)\s*(?::|=)/gm)].map((m) => m[1]);
  assert.ok(fields.length > 0, 'found the view fields');
  const clashes = fields.filter((f) => RESERVED.includes(f!));
  assert.deepEqual(clashes, []);
});

const MODAL_RESERVED = [
  'app', 'scope', 'containerEl', 'modalEl', 'titleEl', 'contentEl', 'shouldRestoreSelection', 'shouldAnimate',
  'open', 'close', 'onOpen', 'onClose', 'setTitle', 'setContent', 'setCloseCallback', 'bgEl', 'bgOpacity', 'closeButtonEl',
];

test('no CardModal field shadows an Obsidian Modal member', () => {
  const src = readFileSync(new URL('../src/card-modal.ts', import.meta.url).pathname, 'utf8');
  const fields = [...src.matchAll(/^\s+(?:private|protected|public)\s+(?:readonly\s+)?([A-Za-z_]\w*)\s*(?::|=)/gm)].map((m) => m[1]);
  assert.ok(fields.length > 0, 'found the modal fields');
  assert.deepEqual(fields.filter((f) => MODAL_RESERVED.includes(f!)), []);
});
