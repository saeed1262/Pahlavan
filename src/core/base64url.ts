// Base64url (RFC 4648 §5, no padding) of a text's UTF-8 bytes, and back: the
// gym page's link carries its data after the `#` in it, and the phone's
// shortcut opens that link as it is, so it holds only A-Z, a-z, 0-9, - and _
// (nothing to escape twice). UTF-8 by hand, with no global encoder, so the
// engine, the plugin (desktop and mobile) and the page share one codec. Pure.

const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** A text's UTF-8 bytes (a lone surrogate becomes U+FFFD, as a browser's encoder does). */
export function utf8Bytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      } else c = 0xfffd;
    } else if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

/** UTF-8 bytes as text; null when they aren't UTF-8. */
export function utf8Text(bytes: readonly number[]): string | null {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    const n = b < 0x80 ? 0 : b >= 0xc2 && b < 0xe0 ? 1 : b >= 0xe0 && b < 0xf0 ? 2 : b >= 0xf0 && b < 0xf5 ? 3 : -1;
    if (n < 0 || i + n >= bytes.length) return null;
    let c = n === 0 ? b : b & (0x3f >> n);
    for (let k = 1; k <= n; k++) {
      const x = bytes[i + k];
      if (x === undefined || (x & 0xc0) !== 0x80) return null;
      c = (c << 6) | (x & 63);
    }
    // Overlong forms, surrogates and code points past U+10FFFF are not UTF-8.
    if ((n === 2 && c < 0x800) || (n === 3 && (c < 0x10000 || c > 0x10ffff)) || (c >= 0xd800 && c <= 0xdfff)) return null;
    out += String.fromCodePoint(c);
    i += n + 1;
  }
  return out;
}

/** A text as base64url of its UTF-8 bytes, without padding. */
export function encodeBase64url(text: string): string {
  const b = utf8Bytes(text);
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i]! << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += ABC[(n >> 18) & 63]! + ABC[(n >> 12) & 63]!;
    if (i + 1 < b.length) out += ABC[(n >> 6) & 63]!;
    if (i + 2 < b.length) out += ABC[n & 63]!;
  }
  return out;
}

/** Base64url (padding and the +/ alphabet accepted too) back to its text; null when it isn't base64 of UTF-8. */
export function decodeBase64url(s: string): string | null {
  const clean = s.trim().replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  if (!/^[A-Za-z0-9_-]*$/.test(clean) || (clean.length & 3) === 1) return null;
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c = [0, 1, 2, 3].map((k) => (i + k < clean.length ? ABC.indexOf(clean[i + k]!) : 0));
    const n = (c[0]! << 18) | (c[1]! << 12) | (c[2]! << 6) | c[3]!;
    bytes.push((n >> 16) & 255);
    if (i + 2 < clean.length) bytes.push((n >> 8) & 255);
    if (i + 3 < clean.length) bytes.push(n & 255);
  }
  return utf8Text(bytes);
}
