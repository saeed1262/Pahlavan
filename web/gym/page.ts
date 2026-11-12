// The gym page on the phone: the session the link gives (every set
// prefilled), a card per exercise, a tick per set, an edit for its weight,
// reps and RIR, Skip with a reason, the rest counting down after a tick, and
// Send, which hands the session entry to the Pahlavan shortcut. The day's
// sessions come after the `#`, or, opened by the shortcut's Gym item (`#paste`),
// from the clipboard at a tap on Load: the shortcut can't hand a link that
// long to the browser whole. They are kept on the phone, and progress by date,
// session and mode, so a reload or a closed tab picks up where it was. The
// page sends nothing anywhere itself: what it sends goes out only through the
// shortcut.

import { gymSendUrl, type GymData, type GymKind, type GymRow } from '../../src/core/gym.ts';
import {
  autoMinutes,
  canTick,
  clockWords,
  countdown,
  DATA_KEY,
  dayWords,
  editSet,
  entryOf,
  hasExpress,
  hasSets,
  isRecent,
  isStrength,
  isSuperset,
  kindOf,
  lastWords,
  LOAD_BUTTON,
  LOAD_FAILED,
  LOAD_HINT,
  LOAD_LEAD,
  localDate,
  markSent,
  NO_DATA,
  num,
  openingSession,
  PAIN_LINE,
  PASTE_MARK,
  pickSession,
  readHash,
  readPasted,
  REST_OVER_MS,
  restoreState,
  rowDone,
  rowWords,
  sessionChoices,
  setCardio,
  setCounts,
  setMinutes,
  setNotes,
  setsOf,
  setWhy,
  setWords,
  SKIP_REASONS,
  skipRow,
  staleKeys,
  stateKey,
  stopRest,
  swapWords,
  tickRow,
  tickSet,
  unskipRow,
  viewKey,
  type GymState,
  type SetRef,
  type SetState,
} from './model.ts';

/** The phone's storage, as much of it as the page uses (`localStorage`, or a stand-in in the tests). */
export interface GymStorage {
  readonly length: number;
  key(i: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface GymEnv {
  /** The page's `#` part. */
  hash: string;
  /** null when the browser gives none (some private modes). */
  storage: GymStorage | null;
  now(): number;
  /** Opens a link: the Send's `shortcuts://` one. */
  open(url: string): void;
  /** The clipboard's text (asked for in a tap); none where the browser can't read it, and then the page offers a box to paste into. */
  paste?: () => Promise<string>;
  /** Drops the `#` part from the page's address, so a reload opens on the kept sessions. */
  settle?: () => void;
  /** Runs `fn` every `ms`; returns the stop. */
  every(fn: () => void, ms: number): () => void;
}

export interface GymApp {
  /** Redraws the clock (the rest, the minutes) now: the page came back into view. */
  refresh(): void;
  stop(): void;
}

// ---------------------------------------------------------------- a tiny DOM builder

type Child = Node | string | null | undefined | false | readonly Child[];
type Attrs = Record<string, string | number | boolean | null | undefined | ((ev: Event) => void)>;

function add(el: Element, kids: readonly Child[]): void {
  for (const c of kids) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) add(el, c);
    else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : (c as Node));
  }
}

/** An element: `on*` attributes are listeners, `value` is the field's value, `true` an empty attribute. */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') (el as unknown as { value: string }).value = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  add(el, kids);
  return el;
}

// ---------------------------------------------------------------- storage, every call guarded

function load(store: GymStorage | null, key: string): unknown {
  try {
    const text = store?.getItem(key);
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
}
function keep(store: GymStorage | null, key: string, value: unknown): void {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {
    // Full or refused (a private window): the page works on without it.
  }
}
function sweep(store: GymStorage | null, today: string): void {
  try {
    if (!store) return;
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k !== null) keys.push(k);
    }
    for (const k of staleKeys(keys, today)) store.removeItem(k);
  } catch {
    // Nothing to clear, or not allowed to.
  }
}

// ---------------------------------------------------------------- numbers typed on the phone

/** A typed number (a comma for the decimal point too): null when empty, undefined when it isn't one. */
function typed(text: string): number | null | undefined {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) && v >= 0 ? v : undefined;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Draws the page into `root`: the sessions after the `#`; with `#paste`, the
 * Load step for the clipboard's; with no `#` part, the sessions kept on the
 * phone if they are recent, else the Load step.
 */
export function mountGym(root: HTMLElement, env: GymEnv): GymApp {
  let app: GymApp | null = null;
  const show = (d: GymData, payload: string | null) => {
    if (payload !== null) keep(env.storage, DATA_KEY, payload);
    app?.stop();
    app = mountSession(root, env, d);
  };
  const hash = env.hash.replace(/^#/, '');
  const marked = hash === PASTE_MARK;
  const linked = hash && !marked ? readHash(hash) : null;
  const stored = load(env.storage, DATA_KEY);
  const kept = typeof stored === 'string' ? readHash(stored) : null;
  if (linked) show(linked, hash);
  else if (!marked && kept && isRecent(kept.date, localDate(env.now()))) show(kept, null);
  else loadStep();
  return { refresh: () => app?.refresh(), stop: () => app?.stop() };

  /** The Load step: one tap reads the clipboard (the phone may ask to allow the paste); a box to paste into where that can't. */
  function loadStep(): void {
    const msg = h('p', { class: 'load-msg', role: 'status' });
    const box = h('textarea', { rows: 3, autocomplete: 'off', 'aria-label': 'Paste the gym link', placeholder: 'Paste here' });
    const boxWrap = h('label', { class: 'notes paste', hidden: env.paste ? true : undefined }, h('span', {}, 'Or paste it here'), box);
    const take = (text: string): boolean => {
      const got = readPasted(text);
      if (!got) return false;
      show(got.data, got.payload);
      env.settle?.();
      return true;
    };
    const failed = () => {
      msg.textContent = LOAD_FAILED;
      boxWrap.toggleAttribute('hidden', false);
    };
    box.addEventListener('input', () => {
      if (!take(box.value)) msg.textContent = LOAD_FAILED;
    });
    const paste = env.paste;
    root.replaceChildren(h('section', { class: 'load' },
      h('p', { class: 'lead' }, marked ? LOAD_LEAD : NO_DATA),
      paste ? h('button', { class: 'send', onclick: () => void paste().then((t) => { if (!take(t)) failed(); }, failed) }, LOAD_BUTTON) : null,
      paste ? h('p', { class: 'hint' }, LOAD_HINT) : null,
      msg,
      boxWrap,
      kept ? h('button', { class: 'link', onclick: () => { show(kept, null); env.settle?.(); } }, `Open ${dayWords(kept.date)}’s sessions instead`) : null,
    ));
  }
}

/**
 * Draws the day's sessions into `root`. Ticks, skips and switches redraw it;
 * typing in a field changes only what reads it, so the keyboard stays up
 * from one field to the next.
 */
function mountSession(root: HTMLElement, env: GymEnv, d: GymData): GymApp {
  sweep(env.storage, localDate(env.now()));
  let session = openingSession(d, load(env.storage, viewKey(d.date)));
  let st = restoreState(d.date, session, load(env.storage, stateKey(d.date, session.type, session.mode)));
  let editing: SetRef | null = null;

  // What the clock and the fields change in place.
  let restBar: HTMLElement | null = null;
  let restWhat: HTMLElement | null = null;
  let restTime: HTMLElement | null = null;
  let minutesField: HTMLInputElement | null = null;
  let countEl: HTMLElement | null = null;

  const save = () => keep(env.storage, stateKey(d.date, st.type, st.mode), st);
  const update = (next: GymState) => {
    st = next;
    save();
    draw();
  };
  const quiet = (next: GymState) => {
    st = next;
    save();
  };

  function switchTo(type: string, mode: 'full' | 'express'): void {
    const s = pickSession(d, type, mode);
    if (!s || s === session) return;
    session = s;
    st = restoreState(d.date, s, load(env.storage, stateKey(d.date, s.type, s.mode)));
    editing = null;
    keep(env.storage, viewKey(d.date), { type: s.type, mode: s.mode });
    draw();
  }

  const countText = () => {
    const c = setCounts(session, st);
    return c.total ? `${c.done} of ${c.total} sets` : '';
  };

  function header(): HTMLElement {
    const choices = sessionChoices(d);
    const pick = h('select', { class: 'pick', 'aria-label': 'Session' }, choices.map((c) => h('option', { value: c.type, selected: c.type === session.type }, c.next ? `${c.name} · next` : c.name)));
    pick.addEventListener('change', () => switchTo(pick.value, 'full'));
    const express = session.mode === 'express';
    countEl = h('span', { class: 'count' }, countText());
    return h('header', { class: 'top' },
      h('div', { class: 'top-row' }, h('h1', {}, session.name), countEl),
      h('div', { class: 'date' }, [dayWords(d.date), session.minutes ? `about ${session.minutes} min` : null].filter(Boolean).join(' · ')),
      choices.length > 1 || hasExpress(d, session.type)
        ? h('div', { class: 'switch' },
          choices.length > 1 ? h('label', { class: 'pick-wrap' }, pick) : null,
          hasExpress(d, session.type) ? h('button', { class: `chip${express ? ' on' : ''}`, 'aria-pressed': String(express), onclick: () => switchTo(session.type, express ? 'full' : 'express') }, 'Express') : null)
        : null,
    );
  }

  /** The editor under a set: weight with ± a step (a loaded set), reps or seconds with ±, RIR. */
  function editor(ref: SetRef, kind: GymKind, unit: string, step: number, refresh: () => void): HTMLElement {
    const cur = () => setsOf(st.rows[ref.key]!, ref.part)![ref.i]!;
    const field = (label: string, value: number | null, mode: 'decimal' | 'numeric', delta: number | null, set: (v: number | null) => void) => {
      const input = h('input', { class: 'num', type: 'text', inputmode: mode, ...(mode === 'numeric' ? { pattern: '[0-9]*' } : {}), autocomplete: 'off', enterkeyhint: 'done', 'aria-label': label, placeholder: delta === null ? 'optional' : '', value: value === null ? '' : num(value) });
      input.addEventListener('input', () => {
        const v = typed(input.value);
        if (v !== undefined) set(v);
      });
      const bump = (sign: 1 | -1) => {
        const v = Math.max(0, Math.round(((typed(input.value) ?? 0) + sign * delta!) * 100) / 100);
        input.value = num(v);
        set(v);
      };
      return h('div', { class: 'field' }, h('span', {}, label),
        delta === null ? input : h('div', { class: 'stepper' },
          h('button', { class: 'step', 'aria-label': `Less ${label.toLowerCase()}`, onclick: () => bump(-1) }, '−'),
          input,
          h('button', { class: 'step', 'aria-label': `More ${label.toLowerCase()}`, onclick: () => bump(1) }, '+')));
    };
    const edit = (patch: Partial<Pick<SetState, 'weight' | 'reps' | 'rir'>>) => {
      quiet(editSet(session, st, ref, patch));
      refresh();
    };
    const s = cur();
    return h('div', { class: 'editor' },
      kind === 'load' ? field(`Weight (${unit})`, s.weight, 'decimal', step, (v) => edit({ weight: v })) : null,
      field(kind === 'timed' ? 'Seconds' : 'Reps', s.reps, 'numeric', kind === 'timed' ? 5 : 1, (v) => edit({ reps: v })),
      field('RIR', s.rir, 'numeric', null, (v) => edit({ rir: v })),
      h('button', { class: 'close', onclick: () => { editing = null; draw(); } }, 'Close'),
    );
  }

  /** One set: its tick (the set's number until it is ticked), what it is, and edit. */
  function setLine(r: GymRow, part: number | null, i: number, name: string | null): Child {
    const kind = kindOf(r, part);
    const p = part === null ? null : r.parts![part]!;
    const unit = p ? p.unit : r.unit;
    const step = p ? p.step : r.step;
    const ref: SetRef = { key: r.key, part, i };
    const label = `${name ? `${name}, set` : 'Set'} ${i + 1}`;
    const open = editing !== null && editing.key === r.key && editing.part === part && editing.i === i;
    const val = h('span', { class: 'val' });
    const tick = h('button', { class: 'tick', 'aria-label': `${label} done` });
    const line = h('div', { class: 'set' }, tick, val);
    const paint = () => {
      const x = setsOf(st.rows[r.key]!, part)![i]!;
      val.replaceChildren();
      add(val, [setWords(kind, unit, x), x.rir !== null ? h('span', { class: 'rir' }, ` · RIR ${x.rir}`) : null]);
      tick.className = `tick${x.ticked ? ' on' : ''}`;
      tick.setAttribute('aria-pressed', String(x.ticked));
      tick.textContent = x.ticked ? '✓' : String(i + 1);
      line.className = `set${x.ticked ? ' on' : ''}`;
      if (countEl) countEl.textContent = countText();
    };
    paint();
    tick.addEventListener('click', () => {
      const x = setsOf(st.rows[r.key]!, part)![i]!;
      // Nothing to save yet (no reps, or a loaded set with no weight): the editor opens instead.
      if (!x.ticked && !canTick(kind, x)) {
        editing = ref;
        draw();
        // Straight to the missing number (in the tap, so the phone's keyboard comes up).
        Array.from(root.querySelectorAll<HTMLInputElement>('.editor input')).find((f) => f.value === '')?.focus();
        return;
      }
      update(tickSet(session, st, ref, env.now()));
    });
    line.appendChild(h('button', { class: 'edit', 'aria-expanded': String(open), 'aria-label': `Edit ${label.toLowerCase()}`, onclick: () => { editing = open ? null : ref; draw(); } }, open ? 'close' : 'edit'));
    return [line, open ? editor(ref, kind, unit, step, paint) : null];
  }

  function card(r: GymRow): HTMLElement {
    const rs = st.rows[r.key]!;
    if (rs.skipped) {
      return h('section', { class: 'card skipped', 'data-key': r.key },
        h('div', { class: 'card-head' }, h('h2', {}, r.name), h('span', { class: 'tag' }, 'Skipped'), h('button', { class: 'link', onclick: () => update(unskipRow(st, r.key)) }, 'Undo')),
        r.line !== null
          ? h('div', { class: 'chips', role: 'group', 'aria-label': `Why ${r.name} was skipped` },
            SKIP_REASONS.map((x) => h('button', { class: `chip${rs.why === x.id ? ' on' : ''}`, 'aria-pressed': String(rs.why === x.id), onclick: () => update(setWhy(st, r.key, x.id)) }, x.label)))
          : null,
        rs.why === 'pain' ? h('p', { class: 'pain' }, PAIN_LINE) : null,
      );
    }
    const tags = [r.finisher ? h('span', { class: 'tag' }, 'Finisher') : null, isSuperset(r) ? h('span', { class: 'tag' }, 'Superset') : null];
    let body: Child;
    if (isSuperset(r)) {
      body = r.parts.map((p, k) => (isStrength(p.kind) ? h('div', { class: 'part' },
        h('h3', {}, p.name, p.last ? h('span', { class: 'muted' }, ` · ${lastWords(p.last, p.kind)}`) : null),
        swapWords(p) ? h('div', { class: 'swap' }, swapWords(p)) : null,
        (rs.parts[k] ?? []).map((_, i) => setLine(r, k, i, p.name))) : null));
    } else if (hasSets(r)) {
      body = rs.sets.map((_, i) => setLine(r, null, i, null));
    } else {
      // A warm-up or cardio row: one tick; cardio has its minutes.
      const cardio = r.kind === 'cardio';
      const minutes = cardio ? h('input', { class: 'num', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', enterkeyhint: 'done', 'aria-label': 'Cardio minutes', value: String(st.cardio) }) : null;
      minutes?.addEventListener('input', () => {
        const v = typed(minutes.value);
        if (v !== undefined) quiet(setCardio(st, v));
      });
      body = h('div', { class: `set${rs.ticked ? ' on' : ''}` },
        h('button', { class: `tick${rs.ticked ? ' on' : ''}`, 'aria-pressed': String(rs.ticked), 'aria-label': `${r.name} done`, onclick: () => update(tickRow(session, st, r.key, env.now())) }, '✓'),
        h('span', { class: 'val' }, rs.ticked ? 'Done' : 'Tick when done'),
        minutes ? h('label', { class: 'mins' }, minutes, h('span', {}, 'min')) : null);
    }
    return h('section', { class: `card${rowDone(r, rs) ? ' done' : ''}`, 'data-key': r.key },
      h('div', { class: 'card-head' }, h('h2', {}, r.name), tags, h('button', { class: 'link', 'aria-label': `Skip ${r.name}`, onclick: () => { if (editing?.key === r.key) editing = null; update(skipRow(st, r.key)); } }, 'Skip')),
      // A swap: the plan's exercise it stands in for, and why (a superset's are on its parts).
      !isSuperset(r) && swapWords(r) ? h('div', { class: 'swap' }, swapWords(r)) : null,
      rowWords(r) ? h('div', { class: 'sub' }, rowWords(r)) : null,
      r.note ? h('div', { class: 'note' }, cap(r.note)) : null,
      body,
    );
  }

  function footer(): Child {
    minutesField = h('input', { class: 'num', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', enterkeyhint: 'done', 'aria-label': 'Minutes', value: st.minutes === null ? '' : String(st.minutes) });
    const mf = minutesField;
    mf.addEventListener('input', () => {
      const v = typed(mf.value);
      if (v !== undefined) quiet(setMinutes(st, v === 0 ? null : v));
    });
    const notes = h('textarea', { rows: 3, 'aria-label': 'Notes', placeholder: 'How it went, anything to remember', value: st.notes });
    notes.addEventListener('input', () => quiet(setNotes(st, notes.value)));
    const sent = st.sentAt !== null;
    return [
      h('section', { class: 'card end' },
        h('div', { class: 'field' }, h('span', {}, 'Minutes'), mf),
        h('p', { class: 'hint' }, 'From your first tick to Send; type to change it.'),
        h('label', { class: 'notes' }, h('span', {}, 'Notes'), notes)),
      h('button', { class: `send${sent ? ' sent' : ''}`, onclick: send }, sent ? `Sent at ${clockWords(st.sentAt!)} · send again` : 'Send to Pahlavan'),
    ];
  }

  function send(): void {
    const now = env.now();
    st = markSent(st, now);
    save();
    env.open(gymSendUrl(entryOf(session, st)));
    draw();
  }

  /** The clock's part of the page: the rest bar and the minutes so far. */
  function clock(): void {
    const now = env.now();
    if (restBar && restWhat && restTime) {
      const rest = st.rest;
      const left = rest ? Math.ceil((rest.until - now) / 1000) : 0;
      const show = rest !== null && now - rest.until < REST_OVER_MS;
      restBar.toggleAttribute('hidden', !show);
      if (rest && show) {
        const name = session.rows.find((r) => r.key === rest.key)?.name ?? '';
        restBar.className = `rest${left > 0 ? '' : ' over'}`;
        restWhat.textContent = left > 0 ? `Rest · ${name}` : `Rest over · ${name}`;
        restTime.textContent = countdown(Math.min(left, rest.seconds));
      }
    }
    if (minutesField) minutesField.setAttribute('placeholder', String(autoMinutes(st, now) ?? '–'));
  }

  function draw(): void {
    restWhat = h('span', { class: 'what' });
    restTime = h('b', {});
    restBar = h('div', { class: 'rest', role: 'timer', hidden: true }, restWhat, restTime, h('button', { class: 'x', 'aria-label': 'Stop the rest timer', onclick: () => update(stopRest(st)) }, '×'));
    root.replaceChildren();
    add(root, [header(), session.rows.map(card), footer(), restBar]);
    clock();
  }

  draw();
  const stop = env.every(clock, 1000);
  return { refresh: clock, stop };
}

// ---------------------------------------------------------------- in the browser

/** Keeps the screen on while the page is open (where the browser allows it). */
async function wake(): Promise<void> {
  try {
    const lock = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<unknown> } }).wakeLock;
    await lock?.request('screen');
  } catch {
    // Not supported, or refused (low battery): the page works without it.
  }
}

function start(): void {
  const root = document.getElementById('gym');
  if (!root) return;
  let storage: GymStorage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  let app: GymApp | null = null;
  const run = () => {
    app?.stop();
    app = mountGym(root, {
      hash: location.hash,
      storage,
      now: () => Date.now(),
      open: (url) => {
        location.href = url;
      },
      paste: navigator.clipboard?.readText ? () => navigator.clipboard.readText() : undefined,
      settle: () => {
        try {
          history.replaceState(null, '', location.pathname + location.search);
        } catch {
          // Not allowed (a file: page in some browsers): a reload shows the Load step again.
        }
      },
      every: (fn, ms) => {
        const id = setInterval(fn, ms);
        return () => clearInterval(id);
      },
    });
  };
  run();
  window.addEventListener('hashchange', run);
  void wake();
  // The lock goes when the page is hidden; take it again on the way back, and catch the clock up.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void wake();
    app?.refresh();
  });
}

if (typeof document !== 'undefined' && typeof location !== 'undefined') start();
