// A small stand-in for the browser's DOM, enough for the view's builders
// (ui/dom.ts) to draw a screen in Node: elements and text nodes, attributes,
// classes, style, listeners and simple selectors (tag, .class, [attr],
// [attr="v"], compound and descendant). No layout: sizes read as 0. Tests
// install it as `document` before drawing and read the tree back.

type Listener = (ev: unknown) => void;

export class FakeText {
  readonly nodeType = 3;
  parentNode: FakeElement | null = null;
  textContent: string;
  constructor(t: string) {
    this.textContent = t;
  }
  remove(): void {
    this.parentNode?.removeChild(this);
  }
}

type FakeNode = FakeElement | FakeText;

export class FakeElement {
  readonly nodeType = 1;
  readonly tagName: string;
  readonly namespaceURI: string | null;
  parentNode: FakeElement | null = null;
  childNodes: FakeNode[] = [];
  private attrs = new Map<string, string>();
  readonly listeners = new Map<string, Listener[]>();
  readonly style: Record<string, string> & { setProperty(k: string, v: string): void; removeProperty(k: string): void } = Object.assign(Object.create(null) as Record<string, string>, {
    setProperty(this: Record<string, string>, k: string, v: string) {
      this[k] = v;
    },
    removeProperty(this: Record<string, string>, k: string) {
      delete this[k];
    },
  });

  constructor(tag: string, ns: string | null = null) {
    this.tagName = tag.toUpperCase();
    this.namespaceURI = ns;
  }

  get children(): FakeElement[] {
    return this.childNodes.filter((c): c is FakeElement => c instanceof FakeElement);
  }
  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(t: string) {
    this.replaceChildren(new FakeText(t));
  }
  get className(): string {
    return this.attrs.get('class') ?? '';
  }
  set className(v: string) {
    this.attrs.set('class', v);
  }
  get classList() {
    const get = () => this.className.split(/\s+/).filter(Boolean);
    const set = (xs: string[]) => (this.className = xs.join(' '));
    return {
      add: (...c: string[]) => set([...new Set([...get(), ...c])]),
      remove: (...c: string[]) => set(get().filter((x) => !c.includes(x))),
      toggle: (c: string, on?: boolean) => {
        const has = get().includes(c);
        const want = on ?? !has;
        if (want && !has) set([...get(), c]);
        if (!want && has) set(get().filter((x) => x !== c));
        return want;
      },
      contains: (c: string) => get().includes(c),
    };
  }
  get dataset(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of this.attrs) if (k.startsWith('data-')) out[k.slice(5).replace(/-(\w)/g, (_, c: string) => c.toUpperCase())] = v;
    return out;
  }
  readonly clientWidth = 0;
  readonly clientHeight = 0;
  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }

  setAttribute(k: string, v: string): void {
    this.attrs.set(k, String(v));
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }
  hasAttribute(k: string): boolean {
    return this.attrs.has(k);
  }
  removeAttribute(k: string): void {
    this.attrs.delete(k);
  }
  toggleAttribute(k: string, force?: boolean): boolean {
    const on = force ?? !this.attrs.has(k);
    if (on) this.attrs.set(k, '');
    else this.attrs.delete(k);
    return on;
  }
  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((x) => x !== fn));
  }
  appendChild<T extends FakeNode>(c: T): T {
    c.parentNode?.removeChild(c);
    c.parentNode = this;
    this.childNodes.push(c);
    return c;
  }
  append(...cs: (FakeNode | string)[]): void {
    for (const c of cs) this.appendChild(typeof c === 'string' ? new FakeText(c) : c);
  }
  prepend(...cs: (FakeNode | string)[]): void {
    const nodes = cs.map((c) => (typeof c === 'string' ? new FakeText(c) : c));
    for (const n of nodes) {
      n.parentNode?.removeChild(n);
      n.parentNode = this;
    }
    this.childNodes.unshift(...nodes);
  }
  removeChild(c: FakeNode): void {
    this.childNodes = this.childNodes.filter((x) => x !== c);
    c.parentNode = null;
  }
  insertBefore<T extends FakeNode>(c: T, ref: FakeNode | null): T {
    c.parentNode?.removeChild(c);
    c.parentNode = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(c);
    else this.childNodes.splice(i, 0, c);
    return c;
  }
  /** A copy with its attributes and, when deep, its children (listeners stay behind, as in the DOM). */
  cloneNode(deep = false): FakeElement {
    const c = new FakeElement(this.tagName.toLowerCase(), this.namespaceURI);
    for (const [k, v] of this.attrs) c.setAttribute(k, v);
    if (deep) for (const n of this.childNodes) c.appendChild(n instanceof FakeElement ? n.cloneNode(true) : new FakeText(n.textContent));
    return c;
  }
  replaceChildren(...cs: (FakeNode | string)[]): void {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    this.append(...cs);
  }
  remove(): void {
    this.parentNode?.removeChild(this);
  }
  contains(other: FakeNode | null): boolean {
    for (let n: FakeNode | FakeElement | null = other; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  closest(sel: string): FakeElement | null {
    for (let n: FakeElement | null = this; n; n = n.parentNode) if (matches(n, sel)) return n;
    return null;
  }
  matches(sel: string): boolean {
    return matches(this, sel);
  }
  querySelectorAll(sel: string): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (el: FakeElement) => {
      for (const c of el.children) {
        if (sel.split(',').some((s) => matchesChain(c, s.trim(), this))) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel: string): FakeElement | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  focus(): void {}
  blur(): void {}
}

/** One compound selector: tag, .class, [attr] and [attr="v"] parts. */
function matches(el: FakeElement, sel: string): boolean {
  const re = /([a-zA-Z][\w-]*)|\.([\w-]+)|\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/g;
  let m: RegExpExecArray | null;
  let any = false;
  while ((m = re.exec(sel))) {
    any = true;
    if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
    if (m[2] && !el.classList.contains(m[2])) return false;
    if (m[3] && (!el.hasAttribute(m[3]) || (m[4] !== undefined && el.getAttribute(m[3]) !== m[4]))) return false;
  }
  return any;
}

/** A descendant chain ("a .b c"): the last part matches the element, the others an ancestor each, inside `root`. */
function matchesChain(el: FakeElement, sel: string, root: FakeElement): boolean {
  const parts = sel.split(/\s+/).filter(Boolean);
  if (!matches(el, parts.at(-1)!)) return false;
  let i = parts.length - 2;
  for (let n = el.parentNode; n && n !== root && i >= 0; n = n.parentNode) if (matches(n, parts[i]!)) i--;
  return i < 0;
}

/** Installs the fake as the global `document` (and a few window bits); returns a function that restores what was there. */
export function installFakeDom(): () => void {
  const g = globalThis as Record<string, unknown>;
  const names = ['document', 'window', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'Text'] as const;
  const before = Object.fromEntries(names.map((n) => [n, g[n]]));
  // The builders check `instanceof HTMLElement` (and Node): the fake answers for all of them.
  for (const n of ['HTMLElement', 'SVGElement', 'Element'] as const) g[n] = FakeElement;
  g['Text'] = FakeText;
  g['Node'] = class {
    static [Symbol.hasInstance](x: unknown) {
      return x instanceof FakeElement || x instanceof FakeText;
    }
  };
  g['document'] = {
    createElement: (tag: string) => new FakeElement(tag),
    createElementNS: (ns: string, tag: string) => new FakeElement(tag, ns),
    createTextNode: (t: string) => new FakeText(t),
    body: new FakeElement('body'),
  };
  if (!g['window']) g['window'] = { innerWidth: 1440, innerHeight: 900, addEventListener() {}, removeEventListener() {} };
  return () => {
    for (const n of names) g[n] = before[n];
  };
}

/** The element's visible text, words joined by single spaces. */
export const text = (el: FakeElement | FakeText): string => el.textContent.replace(/\s+/g, ' ').trim();
