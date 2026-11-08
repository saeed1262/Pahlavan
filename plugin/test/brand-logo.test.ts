// The logo Home's banner draws is the published one, byte for byte.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';
import { PAHLAVAN_LOGO_SRC, PAHLAVAN_LOGO_SVG } from '../src/brand-logo.ts';

it('the banner’s logo is docs/images/brand/logo.svg, as an image source', () => {
  assert.equal(PAHLAVAN_LOGO_SVG, readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'images', 'brand', 'logo.svg'), 'utf8'));
  assert.ok(PAHLAVAN_LOGO_SRC.startsWith('data:image/svg+xml;utf8,%3Csvg'));
});
