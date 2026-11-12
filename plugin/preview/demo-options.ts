// The Try it demo's options. tools/build-demo.mjs builds the preview harness
// with __DEMO__ on; the harness then starts from the demo's own defaults and
// reads only the tab and the look from the link, so a shared link can't switch
// on the harness's render-only states (a reminder card, a fresh vault, a
// fixed date). Pure, so the tests can read it without a page.

/** The made-up athlete's day: the harness's date, and the one the demo's bar names. */
export const PREVIEW_TODAY = '2026-04-10';

/** The tabs a demo link may open (the view's Section ids). */
export const DEMO_TABS = ['home', 'today', 'progress', 'plan', 'checkin', 'food', 'movements'] as const;

/**
 * The harness's options for the demo: the rich made-up data, Obsidian's own
 * look in the visitor's light or dark (or the Isfahan look), and the tab.
 * Anything else in the link is ignored.
 */
export function demoParams(search: string, prefersDark: boolean): Record<string, string> {
  const from = queryOf(search);
  const mode = from.get('mode');
  const dark = mode === 'dark' || (mode !== 'light' && prefersDark);
  const isfahan = from.get('isfahan') === '1';
  const p: Record<string, string> = { rich: '1', isfahan: isfahan ? '1' : '0', mode: dark ? 'dark' : 'light' };
  // The Isfahan look draws dark at night and light in the working day.
  if (isfahan) p['phase'] = dark ? 'night' : 'workday';
  const tab = from.get('tab');
  if (tab && (DEMO_TABS as readonly string[]).includes(tab)) p['tab'] = tab;
  return p;
}

/** A link's query as URLSearchParams reads it (the first of a repeated key wins); a part that won't decode is skipped. */
function queryOf(search: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of search.replace(/^\?/, '').split('&')) {
    const at = part.indexOf('=');
    try {
      const key = decodeURIComponent((at < 0 ? part : part.slice(0, at)).replace(/\+/g, ' '));
      const value = at < 0 ? '' : decodeURIComponent(part.slice(at + 1).replace(/\+/g, ' '));
      if (key && !out.has(key)) out.set(key, value);
    } catch {
      // A malformed escape (a stray %): left out, as nothing in it is a demo option.
    }
  }
  return out;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Fri 10 Apr 2026": how the demo's bar names a YYYY-MM-DD date. */
export function demoDateLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * The demo's eating plan: the Food tab's made-up plan (test/fixtures/food, a
 * fresh cycle from Mon 2 Nov 2026 with its review on Sun 29 Nov) moved onto
 * the demo athlete's cycle, from Mon 30 Mar 2026 with its review on Sun 26 Apr,
 * so the Food tab on the demo's date shows a plan in its second week. A date
 * the map doesn't name fails the build rather than slip through unmoved.
 */
export const DEMO_FOOD_DATES: Record<string, string> = { '2026-11-02': '2026-03-30', '2026-11-29': '2026-04-26' };

export function demoEatingPlan(plan: unknown): string {
  const text = JSON.stringify(plan, null, 2);
  const left = [...text.matchAll(/\b20\d\d-\d\d-\d\d\b/g)].map((m) => m[0]).filter((d) => !(d in DEMO_FOOD_DATES));
  if (left.length) throw new Error(`the eating plan has dates the demo doesn't move: ${[...new Set(left)].join(', ')}`);
  return text.replace(/\b20\d\d-\d\d-\d\d\b/g, (d) => DEMO_FOOD_DATES[d]!);
}

/** What the demo says where Obsidian would open a note. */
export function openNoteNotice(path: string): string {
  const name = (path.split('/').pop() ?? path).replace(/\.md$/, '');
  return `In Obsidian, this opens the note "${name}".`;
}
