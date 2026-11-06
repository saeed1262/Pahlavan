// A minimal stand-in for the `obsidian` module, enough to open the real
// PahlavanView in a plain page: the preview harness bundles the view with
// this file in place of Obsidian (no jsdom; it runs in headless Chrome).

export class WorkspaceLeaf {
  app: unknown = {};
}

export class Component {
  private cleanups: (() => void)[] = [];
  register(cb: () => void): void {
    this.cleanups.push(cb);
  }
  registerDomEvent<K extends keyof DocumentEventMap>(el: Document | HTMLElement | Window, type: K, cb: (ev: DocumentEventMap[K]) => void): void {
    el.addEventListener(type, cb as EventListener);
    this.cleanups.push(() => el.removeEventListener(type, cb as EventListener));
  }
  registerInterval(id: number): number {
    this.cleanups.push(() => window.clearInterval(id));
    return id;
  }
  unload(): void {
    for (const cb of this.cleanups.splice(0)) cb();
  }
}

/** Like Obsidian's ItemView: a leaf container holding a header and the content element. */
export class ItemView extends Component {
  app: unknown;
  leaf: WorkspaceLeaf;
  containerEl: HTMLElement;
  contentEl: HTMLElement;
  constructor(leaf: WorkspaceLeaf) {
    super();
    this.leaf = leaf;
    this.app = leaf.app;
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'workspace-leaf-content';
    const header = document.createElement('div');
    header.className = 'view-header';
    this.contentEl = document.createElement('div');
    this.contentEl.className = 'view-content';
    this.containerEl.append(header, this.contentEl);
  }
  getViewType(): string {
    return '';
  }
  getDisplayText(): string {
    return '';
  }
  getIcon(): string {
    return '';
  }
  /** As Obsidian does: open() starts the view by calling onOpen(). A subclass field named `open` would shadow this, as it does in the app. */
  async open(): Promise<void> {
    await this.onOpen();
  }

  async onOpen(): Promise<void> {}
  async onClose(): Promise<void> {}
}

export class Plugin extends Component {}
export type TAbstractFile = { path: string };

// ---------------------------------------------------------------- settings
// Obsidian's settings tab and Setting rows, with the same element classes
// (setting-item, setting-item-info, checkbox-container, dropdown), so the
// plugin's Settings tab draws in the preview as it does in the app.

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
};

export type App = unknown;

export class PluginSettingTab {
  app: App;
  containerEl: HTMLElement;
  constructor(app: App, _plugin: unknown) {
    this.app = app;
    this.containerEl = el('div', 'vertical-tab-content');
  }
  display(): void {}
}

class ToggleComponent {
  toggleEl: HTMLElement;
  private value = false;
  private cb: ((v: boolean) => unknown) | null = null;
  constructor(parent: HTMLElement) {
    this.toggleEl = el('div', 'checkbox-container', parent);
    const input = el('input', '', this.toggleEl);
    input.type = 'checkbox';
    this.toggleEl.addEventListener('click', () => {
      this.setValue(!this.value);
      this.cb?.(this.value);
    });
  }
  setValue(v: boolean): this {
    this.value = v;
    this.toggleEl.classList.toggle('is-enabled', v);
    return this;
  }
  onChange(cb: (v: boolean) => unknown): this {
    this.cb = cb;
    return this;
  }
}

class DropdownComponent {
  selectEl: HTMLSelectElement;
  constructor(parent: HTMLElement) {
    this.selectEl = el('select', 'dropdown', parent);
  }
  addOption(value: string, label: string): this {
    const o = el('option', '', this.selectEl);
    o.value = value;
    o.textContent = label;
    return this;
  }
  setValue(v: string): this {
    this.selectEl.value = v;
    return this;
  }
  onChange(cb: (v: string) => unknown): this {
    this.selectEl.addEventListener('change', () => cb(this.selectEl.value));
    return this;
  }
}

class TextComponent {
  inputEl: HTMLInputElement;
  constructor(parent: HTMLElement) {
    this.inputEl = el('input', '', parent);
    this.inputEl.type = 'text';
  }
  setValue(v: string): this {
    this.inputEl.value = v;
    return this;
  }
  getValue(): string {
    return this.inputEl.value;
  }
  setPlaceholder(v: string): this {
    this.inputEl.placeholder = v;
    return this;
  }
  onChange(cb: (v: string) => unknown): this {
    this.inputEl.addEventListener('input', () => cb(this.inputEl.value));
    return this;
  }
}

class ButtonComponent {
  buttonEl: HTMLButtonElement;
  constructor(parent: HTMLElement) {
    this.buttonEl = el('button', '', parent);
  }
  setButtonText(t: string): this {
    this.buttonEl.textContent = t;
    return this;
  }
  setCta(): this {
    this.buttonEl.classList.add('mod-cta');
    return this;
  }
  setDisabled(v: boolean): this {
    this.buttonEl.disabled = v;
    return this;
  }
  onClick(cb: () => unknown): this {
    this.buttonEl.addEventListener('click', () => void cb());
    return this;
  }
}

/** A notice: logged in the preview (Obsidian shows a toast). */
export class Notice {
  constructor(message: string) {
    console.info(`Notice: ${message}`);
  }
}

export class Setting {
  settingEl: HTMLElement;
  infoEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;
  constructor(containerEl: HTMLElement) {
    this.settingEl = el('div', 'setting-item', containerEl);
    this.infoEl = el('div', 'setting-item-info', this.settingEl);
    this.nameEl = el('div', 'setting-item-name', this.infoEl);
    this.descEl = el('div', 'setting-item-description', this.infoEl);
    this.controlEl = el('div', 'setting-item-control', this.settingEl);
  }
  setName(name: string): this {
    this.nameEl.textContent = name;
    return this;
  }
  setDesc(desc: string): this {
    this.descEl.textContent = desc;
    return this;
  }
  setHeading(): this {
    this.settingEl.classList.add('setting-item-heading');
    return this;
  }
  addToggle(cb: (c: ToggleComponent) => unknown): this {
    cb(new ToggleComponent(this.controlEl));
    return this;
  }
  addDropdown(cb: (c: DropdownComponent) => unknown): this {
    cb(new DropdownComponent(this.controlEl));
    return this;
  }
  addButton(cb: (c: ButtonComponent) => unknown): this {
    cb(new ButtonComponent(this.controlEl));
    return this;
  }
  addText(cb: (c: TextComponent) => unknown): this {
    cb(new TextComponent(this.controlEl));
    return this;
  }
}

// ---------------------------------------------------------------- modals
// Obsidian's Modal as 1.15 builds it: a .modal-container on <body> holding
// .modal-bg and the .modal (the × as .modal-header-button, a .modal-header
// with the title, the content), Esc and a click on the background calling
// close(). The reminder cards open in one.

export class Scope {
  private keys: { key: string; fn: (ev: KeyboardEvent) => boolean | void }[] = [];
  register(_mods: string[], key: string, fn: (ev: KeyboardEvent) => boolean | void): void {
    this.keys.push({ key, fn });
  }
  handle(ev: KeyboardEvent): void {
    for (const k of this.keys) if (k.key === ev.key && k.fn(ev) === false) ev.preventDefault();
  }
}

export class Modal {
  app: App;
  scope = new Scope();
  containerEl: HTMLElement;
  modalEl: HTMLElement;
  titleEl: HTMLElement;
  contentEl: HTMLElement;
  private keyHandler = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') this.close();
    else this.scope.handle(ev);
  };
  constructor(app: App) {
    this.app = app;
    this.containerEl = el('div', 'modal-container mod-dim');
    const bg = el('div', 'modal-bg', this.containerEl);
    bg.addEventListener('click', () => this.close());
    this.modalEl = el('div', 'modal', this.containerEl);
    const x = el('div', 'modal-header-button mod-raised clickable-icon', this.modalEl);
    x.textContent = '×';
    x.addEventListener('click', () => this.close());
    this.titleEl = el('div', 'modal-title', el('div', 'modal-header', this.modalEl));
    this.contentEl = el('div', 'modal-content', this.modalEl);
  }
  open(): void {
    document.body.appendChild(this.containerEl);
    document.addEventListener('keydown', this.keyHandler);
    this.onOpen();
  }
  close(): void {
    document.removeEventListener('keydown', this.keyHandler);
    this.containerEl.remove();
    this.onClose();
  }
  onOpen(): void {}
  onClose(): void {}
}
