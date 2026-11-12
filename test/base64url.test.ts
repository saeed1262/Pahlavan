// The gym link's codec: base64url of UTF-8, both ways, and what it refuses.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodeBase64url, encodeBase64url, utf8Bytes, utf8Text } from '../src/core/base64url.ts';
import { gymFromHash, gymLink, GYM_PAGE, type GymData } from '../src/core/gym.ts';

describe('base64url', () => {
  it('matches the RFC 4648 vectors, without padding', () => {
    const cases: [string, string][] = [['', ''], ['f', 'Zg'], ['fo', 'Zm8'], ['foo', 'Zm9v'], ['foob', 'Zm9vYg'], ['fooba', 'Zm9vYmE'], ['foobar', 'Zm9vYmFy']];
    for (const [text, b64] of cases) {
      assert.equal(encodeBase64url(text), b64);
      assert.equal(decodeBase64url(b64), text);
    }
  });

  it('round-trips names past ASCII (·, –, ×, emoji) and uses only the URL-safe alphabet', () => {
    const text = JSON.stringify({ name: 'Short 1 · Skills', sr: '3 × 5–8', note: 'Rest 🙂 2 min', fa: 'پهلوان' });
    const b64 = encodeBase64url(text);
    assert.match(b64, /^[A-Za-z0-9_-]*$/);
    assert.equal(decodeBase64url(b64), text);
  });

  it('reads padded and +/ base64 too', () => {
    assert.equal(decodeBase64url('Zm8='), 'fo');
    assert.equal(decodeBase64url(encodeBase64url('>>>???').replace(/-/g, '+').replace(/_/g, '/')), '>>>???');
  });

  it('refuses what is not base64 of UTF-8', () => {
    assert.equal(decodeBase64url('a'), null);
    assert.equal(decodeBase64url('Zm9v!'), null);
    assert.equal(utf8Text([0xc0, 0x80]), null, 'an overlong NUL');
    assert.equal(utf8Text([0xe2, 0x82]), null, 'cut short');
    assert.equal(utf8Text([0xed, 0xa0, 0x80]), null, 'a surrogate');
  });

  it('encodes UTF-8 as the standard does', () => {
    assert.deepEqual(utf8Bytes('·'), [0xc2, 0xb7]);
    assert.deepEqual(utf8Bytes('–'), [0xe2, 0x80, 0x93]);
    assert.deepEqual(utf8Bytes('🙂'), [0xf0, 0x9f, 0x99, 0x82]);
    assert.deepEqual(utf8Bytes('\ud800'), [0xef, 0xbf, 0xbd], 'a lone surrogate is U+FFFD');
  });
});

describe('the gym link', () => {
  const data: GymData = { v: 1, date: '2026-11-10', next: 'A', sessions: [{ type: 'A', name: 'Full Body A', kind: 'lift', mode: 'full', rows: [], cardio: 0, cardioMode: null, minutes: null }] };

  it('is the page, then the data after the #', () => {
    const link = gymLink(data);
    assert.ok(link.startsWith(`${GYM_PAGE}#`));
    assert.deepEqual(gymFromHash(link.slice(link.indexOf('#'))), data);
    assert.deepEqual(gymFromHash(link.slice(link.indexOf('#') + 1)), data);
  });

  it('leaves the null fields out of the link and puts them back when read', () => {
    const row = { key: '0:Push-up', line: null, name: 'Push-up', kind: 'reps' as const, sr: '3 × 10', sets: 3, range: [10, 10] as [number, number], rir: null, lift: null, unit: 'lb' as const, step: 5, rest: null, restText: null, target: { weight: null, reps: 10, rir: 2 }, note: null, last: null, planned: null, swap: null, rows: [{ weight: null, reps: 10, rir: null }] };
    const full: GymData = { ...data, next: null, sessions: [{ ...data.sessions[0]!, rows: [row] }] };
    const link = gymLink(full);
    assert.doesNotMatch(decodeBase64url(link.slice(link.indexOf('#') + 1))!, /null/);
    assert.deepEqual(gymFromHash(link.slice(link.indexOf('#'))), full);
  });

  it('reads nothing from a link of another version or a broken one', () => {
    assert.equal(gymFromHash(encodeBase64url(JSON.stringify({ ...data, v: 2 }))), null);
    assert.equal(gymFromHash(encodeBase64url('not json')), null);
    assert.equal(gymFromHash('%%%'), null);
  });
});
