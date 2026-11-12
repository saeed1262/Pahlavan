// Builds the Try it demo: plugin/preview/dist/demo/index.html (or `--out <dir>`), one
// self-contained page with the preview harness built in demo mode (__DEMO__),
// the made-up vault, the harness's and the plugin's styles and the Cormorant
// face all inline (plugin/preview/demo.html is the template). It loads nothing
// else and sends nothing anywhere: its CSP refuses every request.
//
// At a release, `npm run build-demo -- --out docs/demo` puts it where GitHub
// Pages serves the repository's docs/ folder (saeed1262.github.io/pahlavan/demo/).

import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { PREVIEW_BUILD, fixtureScript, previewFiles } from './preview-files.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STYLE = '<!--demo-style-->';
const SCRIPT = '<!--demo-script-->';
const FONT = 'fonts/cormorant-garamond-latin-600-normal.woff2';

/** Inside a <script> or a <style>, "</script" or "</style" would end it early. */
const inline = (tag, text) => `<${tag}>${text.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`)}</${tag}>`;

/**
 * Files in the made-up vault that git doesn't track: the page would publish them though a clean
 * checkout has none. Checked only where `root` is a repository's top (the public check's copy has no
 * repository yet, and holds the tracked files only).
 */
function untrackedFixtures(root) {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (realpathSync(top) !== realpathSync(root)) return [];
    return execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', 'test/fixtures/vault'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/** The demo page's HTML, built in memory (the test reads it the same way). */
export async function buildDemo(root = ROOT) {
  const loose = untrackedFixtures(root);
  if (loose.length) throw new Error(`files in the made-up vault that git doesn't track would be published: ${loose.join(', ')} (commit or remove them)`);
  const template = readFileSync(join(root, 'plugin/preview/demo.html'), 'utf8');
  for (const mark of [STYLE, SCRIPT, '{{date}}']) if (!template.includes(mark)) throw new Error(`plugin/preview/demo.html has no ${mark}`);
  const { PREVIEW_TODAY, demoDateLabel } = await import(pathToFileURL(join(root, 'plugin/preview/demo-options.ts')).href);

  const result = await build({ ...PREVIEW_BUILD, absWorkingDir: root, write: false, minify: true, define: { __DEMO__: 'true' } });
  const js = result.outputFiles[0].text.trim();

  // The harness's look, with its font as data (the page may load nothing), then the plugin's own styles.
  const previewCss = readFileSync(join(root, 'plugin/preview/preview.css'), 'utf8');
  if (!previewCss.includes(`url("${FONT}")`)) throw new Error(`plugin/preview/preview.css no longer loads ${FONT}`);
  const font = readFileSync(join(root, 'plugin/preview', FONT)).toString('base64');
  // The font's licence travels with it (SIL Open Font License 1.1, condition 2).
  const licence = readFileSync(join(root, 'plugin/preview/fonts/OFL.txt'), 'utf8').replace(/\*\//g, '* /');
  const css = `/*\n${licence}*/\n${previewCss.replace(`url("${FONT}")`, `url("data:font/woff2;base64,${font}")`)}`;
  const pluginCss = readFileSync(join(root, 'plugin/styles.css'), 'utf8');

  // The date first, in the template alone, so nothing inlined after it is touched.
  return template
    .replaceAll('{{date}}', () => demoDateLabel(PREVIEW_TODAY))
    .replace(STYLE, () => `${inline('style', css)}\n${inline('style', pluginCss)}`)
    .replace(SCRIPT, () => `${inline('script', fixtureScript(previewFiles(root)))}\n${inline('script', js)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const i = process.argv.indexOf('--out');
  if (i > 0 && !process.argv[i + 1]) throw new Error('--out needs a folder, such as docs/demo');
  // Beside the preview's own build by default: the engine's build empties dist/ (and the tests run it).
  const dir = resolve(ROOT, i > 0 ? process.argv[i + 1] : 'plugin/preview/dist/demo');
  const html = await buildDemo();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  console.log(`built ${join(dir, 'index.html')} (${kb(Buffer.byteLength(html))}, ${kb(gzipSync(html).length)} gzipped)`);
}
