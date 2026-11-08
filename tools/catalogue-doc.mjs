// Writes docs/exercise-catalogue.md from the built engine's catalogue page
// (`engine catalogue --md`), so the repository's copy is the engine's own.
//   npm run catalogue-doc
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = JSON.parse(execFileSync('node', [join(root, 'dist/engine.cjs'), 'catalogue', '--json', '--md'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
writeFileSync(join(root, 'docs/exercise-catalogue.md'), out.markdown);
console.log(`wrote docs/exercise-catalogue.md (${out.count} movements)`);
