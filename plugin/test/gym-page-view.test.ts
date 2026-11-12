// The gym page drawn in Node with the small fake DOM, on the made-up sample
// day: a swap's line, a tick (and the rest it starts), an edit with ± a
// step, a tick on a set with nothing to save opening its editor, Skip with a
// reason (Pain's line), progress restored from the phone's storage (old days
// cleared, a storage that refuses everything still fine), the session and
// Express switch, a broken link, Send's link to the shortcut, and the Load
// step: `#paste` reads the clipboard at a tap, the sessions kept for a reload,
// a clipboard without them, and the box to paste into.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { encodeBase64url } from '../../src/core/base64url.ts';
import { GYM_PAGE, GYM_SEND, type GymEntry } from '../../src/core/gym.ts';
import { DATA_KEY, LOAD_BUTTON, LOAD_FAILED, LOAD_LEAD, NO_DATA, PAIN_LINE } from '../../web/gym/model.ts';
import { mountGym, type GymStorage } from '../../web/gym/page.ts';
import { SAMPLE } from '../../web/gym/sample.ts';
import { FakeElement, installFakeDom, text } from './fake-dom.ts';

installFakeDom();
const HASH = `#${encodeBase64url(JSON.stringify(SAMPLE))}`;
// The sample's day, 18:00 on the phone (local time, so the test reads the same in any zone).
const T0 = new Date(2026, 10, 10, 18, 0, 0).getTime();
const SQUAT = '1:Barbell Back Squat';
const BENCH = '3:Dumbbell Bench Press';

function memoryStorage(): GymStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}

/** The page mounted on a fake root, with a clock to move, the links it opened, and taps and typing. */
function page(opts: { storage?: GymStorage | null; hash?: string; paste?: () => Promise<string>; now?: number } = {}) {
  let clock = opts.now ?? T0;
  let timer: (() => void) | null = null;
  const opened: string[] = [];
  let settled = 0;
  const storage = opts.storage === undefined ? memoryStorage() : opts.storage;
  const root = new FakeElement('main');
  const app = mountGym(root as unknown as HTMLElement, {
    hash: opts.hash ?? HASH,
    storage,
    now: () => clock,
    open: (url) => void opened.push(url),
    every: (fn) => {
      timer = fn;
      return () => (timer = null);
    },
    ...(opts.paste ? { paste: opts.paste } : {}),
    settle: () => void settled++,
  });
  const scope = (key?: string) => {
    if (!key) return root;
    const s = root.querySelectorAll('section').find((x) => x.getAttribute('data-key') === key);
    assert.ok(s, `the card ${key}`);
    return s;
  };
  const button = (label: string, key?: string) => {
    const b = scope(key).querySelectorAll('button').find((x) => x.getAttribute('aria-label') === label || (!x.hasAttribute('aria-label') && text(x) === label));
    assert.ok(b, `the button "${label}"${key ? ` in ${key}` : ''}`);
    return b;
  };
  const click = (label: string, key?: string) => {
    const b = button(label, key);
    for (const fn of b.listeners.get('click') ?? []) fn({ target: b, preventDefault() {}, stopPropagation() {} });
  };
  const field = (label: string, key?: string) => {
    const f = scope(key).querySelectorAll('input, textarea, select').find((x) => x.getAttribute('aria-label') === label);
    assert.ok(f, `the field "${label}"`);
    return f as FakeElement & { value: string };
  };
  const type = (label: string, value: string, key?: string) => {
    const f = field(label, key);
    f.value = value;
    for (const fn of f.listeners.get('input') ?? []) fn({ target: f });
  };
  const rest = () => root.querySelector('.rest')!;
  const later = (ms: number) => {
    clock += ms;
    timer?.();
  };
  const sent = (n = 0): GymEntry => {
    const url = opened[n]!;
    assert.ok(url.startsWith(GYM_SEND), url);
    return JSON.parse(decodeURIComponent(url.slice(GYM_SEND.length))) as GymEntry;
  };
  return { root, app, storage, opened, button, click, field, type, rest, later, sent, scope, settled: () => settled };
}

describe('the gym page', () => {
  it('draws the day: the session, its date, the sets to do, a card per row', () => {
    const p = page();
    assert.equal(text(p.root.querySelector('h1')!), 'Full Body A');
    assert.equal(text(p.root.querySelector('.date')!), 'Tue 10 Nov · about 60 min');
    assert.equal(text(p.root.querySelector('.count')!), '0 of 15 sets');
    assert.deepEqual(p.root.querySelectorAll('section h2').map(text), ['Warm-up', 'Barbell Back Squat', 'Pull-up', 'Dumbbell Floor Press', 'Face Pull + Band External Rotation', 'Side Plank', 'Zone 2 bike']);
    assert.equal(text(p.scope(SQUAT).querySelector('.sub')!), '3 × 5–8 @ RIR 2 · rest 3 min · last 115 lb × 6');
    assert.equal(text(p.scope(BENCH).querySelector('.note')!), 'Pick a weight for 8–10 reps at RIR 3');
    assert.equal(p.rest().hasAttribute('hidden'), true, 'no rest yet');
  });

  it('a swap: under the exercise\'s name, the plan\'s one it stands in for and why; a superset part\'s under the part', () => {
    const p = page();
    assert.equal(text(p.scope(BENCH).querySelector('.swap')!), 'In place of Dumbbell Bench Press · Injury limit');
    assert.deepEqual(p.root.querySelectorAll('.swap').length, 1, 'only the swapped row');
    // A part done as another, with no reason given: the line without one, on the part, not the row.
    const pair = '4:Face Pull + Band External Rotation';
    const data = { ...SAMPLE, sessions: SAMPLE.sessions.map((s, i) => (i !== 0 ? s : { ...s, rows: s.rows.map((r) => (r.key !== pair ? r : { ...r, parts: r.parts!.map((x, k) => (k === 1 ? { ...x, name: 'Cable External Rotation', planned: 'Band External Rotation', swap: null } : x)) })) })) };
    const q = page({ hash: `#${encodeBase64url(JSON.stringify(data))}` });
    assert.deepEqual(q.scope(pair).querySelectorAll('.part .swap').map(text), ['In place of Band External Rotation']);
    assert.deepEqual(q.scope(pair).querySelectorAll('h3').map(text), ['Face Pull · last 30 lb × 12', 'Cable External Rotation · last 15 reps']);
    q.click('Cable External Rotation, set 1 done', pair);
    q.click('Send to Pahlavan');
    assert.deepEqual(q.sent().swaps, [{ from: 'Dumbbell Bench Press', to: 'Dumbbell Floor Press', why: 'ledger' }, { from: 'Band External Rotation', to: 'Cable External Rotation' }]);
  });

  it('a tick: the set ticked, the count, and the row\'s rest counting down', () => {
    const p = page();
    p.click('Set 1 done', SQUAT);
    const tick = p.button('Set 1 done', SQUAT);
    assert.equal(tick.getAttribute('aria-pressed'), 'true');
    assert.equal(text(tick), '✓');
    assert.equal(text(p.root.querySelector('.count')!), '1 of 15 sets');
    assert.equal(p.rest().hasAttribute('hidden'), false);
    assert.equal(text(p.rest().querySelector('.what')!), 'Rest · Barbell Back Squat');
    assert.equal(text(p.rest().querySelector('b')!), '3:00');
    p.later(42_000);
    assert.equal(text(p.rest().querySelector('b')!), '2:18');
    p.later(140_000);
    assert.equal(text(p.rest().querySelector('.what')!), 'Rest over · Barbell Back Squat');
    p.later(30_000);
    assert.equal(p.rest().hasAttribute('hidden'), true, 'gone a while after it ends');
    // A warm-up has no rest: its tick starts none.
    p.click('Warm-up done', '0:Warm-up');
    assert.equal(p.rest().hasAttribute('hidden'), true);
  });

  it('an edit: ± a step on the weight, the reps and RIR typed, the set\'s line following without a redraw', () => {
    const p = page();
    p.click('Edit set 1', SQUAT);
    const weight = p.field('Weight (lb)', SQUAT);
    assert.equal(weight.getAttribute('inputmode'), 'decimal');
    assert.equal(p.field('Reps', SQUAT).getAttribute('inputmode'), 'numeric');
    p.click('More weight (lb)', SQUAT);
    assert.equal(weight.value, '125');
    p.type('Reps', '5', SQUAT);
    p.type('RIR', '2', SQUAT);
    assert.equal(text(p.scope(SQUAT).querySelector('.val')!), '125 lb × 5 · RIR 2');
    assert.equal(p.field('Weight (lb)', SQUAT), weight, 'the same field: the keyboard stays up');
    p.click('Set 1 done', SQUAT);
    p.click('Send to Pahlavan');
    assert.deepEqual(p.sent().exerciseSets, [{ name: 'Barbell Back Squat', sets: [{ weight: 125, unit: 'lb', reps: 5, rir: 2 }] }]);
  });

  it('a tick on a set with nothing to save yet opens its editor instead', () => {
    const p = page();
    p.click('Set 1 done', BENCH);
    assert.equal(p.button('Set 1 done', BENCH).getAttribute('aria-pressed'), 'false');
    p.type('Weight (lb)', '45', BENCH);
    p.click('Set 1 done', BENCH);
    assert.equal(p.button('Set 1 done', BENCH).getAttribute('aria-pressed'), 'true');
  });

  it('Skip: four reasons, Pain\'s line, sent as the line skipped and why; Undo brings it back', () => {
    const p = page();
    p.click('Skip Dumbbell Floor Press', BENCH);
    assert.deepEqual(p.scope(BENCH).querySelectorAll('.chips button').map(text), ['Time', 'Pain', 'Equipment', 'Energy']);
    assert.ok(!text(p.scope(BENCH)).includes(PAIN_LINE));
    p.click('Pain', BENCH);
    assert.equal(p.button('Pain', BENCH).getAttribute('aria-pressed'), 'true');
    assert.ok(text(p.scope(BENCH)).includes(PAIN_LINE));
    assert.equal(text(p.root.querySelector('.count')!), '0 of 12 sets', 'a skipped row\'s sets are not counted');
    p.click('Send to Pahlavan');
    assert.deepEqual(p.sent().skipWhy, { 'Dumbbell Bench Press': 'pain' });
    p.click('Undo', BENCH);
    assert.equal(p.scope(BENCH).querySelectorAll('.set').length, 3);
  });

  it('restores progress from the phone\'s storage, and clears days more than 3 old', () => {
    const storage = memoryStorage();
    storage.setItem('pahlavan-gym:2026-11-01:A:full', '{}');
    storage.setItem('pahlavan-gym:2026-11-08:A:full', '{}');
    const p = page({ storage });
    assert.ok(!storage.map.has('pahlavan-gym:2026-11-01:A:full'));
    assert.ok(storage.map.has('pahlavan-gym:2026-11-08:A:full'));
    p.click('Set 1 done', SQUAT);
    p.click('Skip Side Plank', '5:Side Plank');
    p.type('Notes', 'left knee fine');
    p.click('Express');
    p.click('Set 2 done', SQUAT);
    p.app.stop();
    const again = page({ storage });
    assert.equal(text(again.root.querySelector('h1')!), 'Full Body A · Express', 'the session last shown');
    assert.equal(again.button('Set 2 done', SQUAT).getAttribute('aria-pressed'), 'true');
    again.click('Express');
    assert.equal(again.button('Set 1 done', SQUAT).getAttribute('aria-pressed'), 'true');
    assert.ok(again.scope('5:Side Plank').classList.contains('skipped'));
    assert.equal(again.field('Notes').value, 'left knee fine');
  });

  it('works without storage, or with one that refuses every call (a private window)', () => {
    const refuse = () => {
      throw new Error('SecurityError');
    };
    const broken: GymStorage = { get length(): number { return refuse(); }, key: refuse, getItem: refuse, setItem: refuse, removeItem: refuse };
    for (const storage of [null, broken]) {
      const p = page({ storage });
      p.click('Set 1 done', SQUAT);
      assert.equal(p.button('Set 1 done', SQUAT).getAttribute('aria-pressed'), 'true');
    }
  });

  it('switches session: the next first, Express where the session has one', () => {
    const p = page();
    const pick = p.field('Session');
    assert.deepEqual(pick.querySelectorAll('option').map(text), ['Full Body A · next', 'Short 1 · Skills']);
    p.click('Express');
    assert.equal(text(p.root.querySelector('h1')!), 'Full Body A · Express');
    assert.equal(p.button('Express').getAttribute('aria-pressed'), 'true');
    const sel = p.field('Session');
    sel.value = 'S1';
    for (const fn of sel.listeners.get('change') ?? []) fn({ target: sel });
    assert.equal(text(p.root.querySelector('h1')!), 'Short 1 · Skills');
    assert.equal(p.root.querySelectorAll('button').some((b) => text(b) === 'Express'), false, 'no Express variant');
  });

  it('a missing or broken link, nothing kept: the plain message, then Load (or the box to paste into)', () => {
    for (const hash of ['', '#', '#not-a-gym-link']) {
      const p = page({ hash, paste: async () => '' });
      assert.equal(text(p.root.querySelector('.lead')!), NO_DATA);
      assert.ok(p.button(LOAD_BUTTON));
      assert.equal(p.root.querySelector('.paste')!.hasAttribute('hidden'), true, 'the box waits until Load fails');
      // A browser that can't read the clipboard: the box straight away.
      const q = page({ hash });
      assert.equal(q.root.querySelectorAll('button').length, 0);
      assert.equal(q.root.querySelector('.paste')!.hasAttribute('hidden'), false);
    }
  });

  it('Send: the shortcut\'s link with the session entry, then "Sent at" and send again', () => {
    const p = page();
    p.click('Warm-up done', '0:Warm-up');
    p.click('Set 1 done', SQUAT);
    p.click('Set 1 done', '2:Pull-up');
    p.click('Zone 2 bike done', '6:Zone 2 finisher');
    p.type('Cardio minutes', '20', '6:Zone 2 finisher');
    p.later(47 * 60_000);
    assert.equal(p.field('Minutes').getAttribute('placeholder'), '47', 'the minutes so far');
    p.click('Send to Pahlavan');
    assert.equal(p.opened.length, 1);
    const e = p.sent();
    assert.equal(e.type, 'A');
    assert.deepEqual(e.lift1, { weight: 120, reps: 6, unit: 'lb' });
    assert.deepEqual(e.lift2, { weight: 0, reps: 7, unit: 'lb' });
    assert.equal(e.durationMin, 47);
    assert.equal(e.cardioMin, 20);
    assert.equal(e.trackingLevel, 'full');
    assert.deepEqual(e.skipped, ['Dumbbell Bench Press', 'Face Pull + Band External Rotation', 'Side Plank']);
    assert.equal(e._say, 'A · 2 sets · 3 skipped');
    const again = p.button('Sent at 18:47 · send again');
    p.type('Minutes', '50');
    p.later(60_000);
    for (const fn of again.listeners.get('click') ?? []) fn({ target: again });
    assert.equal(p.opened.length, 2);
    assert.equal(p.sent(1).durationMin, 50, 'typed minutes win');
    assert.ok(p.button('Sent at 18:48 · send again'));
  });

  describe('the Load step (#paste: the sessions wait on the clipboard)', () => {
    const LINK = `${GYM_PAGE}${HASH}`;
    const settle = () => new Promise((r) => setTimeout(r, 0));

    it('Load reads the clipboard (the whole link, a line break and all), opens the sessions, keeps them and drops the # part', async () => {
      let asked = 0;
      const p = page({ hash: '#paste', paste: async () => (asked++, `${LINK}\n`) });
      assert.equal(text(p.root.querySelector('.lead')!), LOAD_LEAD);
      assert.equal(asked, 0, 'nothing read before the tap');
      p.click(LOAD_BUTTON);
      await settle();
      assert.equal(asked, 1);
      assert.equal(text(p.root.querySelector('h1')!), 'Full Body A');
      assert.equal(JSON.parse(p.storage!.getItem(DATA_KEY)!), HASH.slice(1), 'the link\'s # part kept');
      assert.equal(p.settled(), 1, 'the address loses #paste');
    });

    it('the # part alone works too', async () => {
      const p = page({ hash: '#paste', paste: async () => HASH });
      p.click(LOAD_BUTTON);
      await settle();
      assert.equal(text(p.root.querySelector('h1')!), 'Full Body A');
    });

    it('a reload with no # part opens the kept sessions, progress and all; #paste asks again, the kept ones offered', async () => {
      const storage = memoryStorage();
      const first = page({ storage, hash: '#paste', paste: async () => LINK });
      first.click(LOAD_BUTTON);
      await settle();
      first.click('Set 1 done', SQUAT);
      const reload = page({ storage, hash: '' });
      assert.equal(text(reload.root.querySelector('h1')!), 'Full Body A');
      assert.equal(text(reload.root.querySelector('.count')!), '1 of 15 sets');
      const again = page({ storage, hash: '#paste', paste: async () => LINK });
      assert.equal(text(again.root.querySelector('.lead')!), LOAD_LEAD);
      again.click('Open Tue 10 Nov’s sessions instead');
      assert.equal(text(again.root.querySelector('h1')!), 'Full Body A');
      assert.equal(again.settled(), 1);
    });

    it('kept sessions a day old still open (past midnight); two days old wait for Load', () => {
      const storage = memoryStorage();
      storage.setItem(DATA_KEY, JSON.stringify(HASH.slice(1)));
      const day = 864e5;
      assert.equal(text(page({ storage, hash: '', now: T0 + day }).root.querySelector('h1')!), 'Full Body A');
      const old = page({ storage, hash: '', now: T0 + 2 * day, paste: async () => '' });
      assert.equal(text(old.root.querySelector('.lead')!), NO_DATA);
      assert.ok(old.button('Open Tue 10 Nov’s sessions instead'));
    });

    it('a clipboard without a session, or a paste refused: says so and shows the box; a link pasted there opens', async () => {
      for (const paste of [async () => 'hello', async () => Promise.reject(new Error('NotAllowedError'))]) {
        const p = page({ hash: '#paste', paste });
        p.click(LOAD_BUTTON);
        await settle();
        assert.equal(text(p.root.querySelector('.load-msg')!), LOAD_FAILED);
        assert.equal(p.root.querySelector('.paste')!.hasAttribute('hidden'), false);
        p.type('Paste the gym link', 'not it');
        assert.equal(p.root.querySelector('h1'), null);
        p.type('Paste the gym link', LINK);
        assert.equal(text(p.root.querySelector('h1')!), 'Full Body A');
        assert.equal(p.settled(), 1);
      }
    });

    it('a link with its # part keeps it too', () => {
      const p = page();
      assert.equal(JSON.parse(p.storage!.getItem(DATA_KEY)!), HASH.slice(1));
      assert.equal(p.settled(), 0, 'its address is left as it is');
    });
  });
});
