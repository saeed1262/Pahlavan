// The movement catalogue as a readable Markdown page: the repository's
// docs/exercise-catalogue.md and the note Pahlavan writes into a vault
// ("Write the exercise catalogue") both come from this one function, so
// neither can drift from the engine. Pure: the catalogue data in, the text
// out; the caller adds the version line when it has one.

import { CATALOGUE, MOVEMENT_TAGS, MOVEMENT_USES, PATTERNS, type CatalogueEntry, type Pattern } from '../core/data/exercises.ts';
import { searchCatalogue, vocabulary } from './catalogue.ts';

/** Each pattern's section title, in plain words (this page and the Movements tab). */
export const PATTERN_TITLE: Readonly<Record<string, string>> = {
  squat: 'Squat',
  hinge: 'Hinge',
  lunge: 'Lunge and single leg',
  'horizontal-push': 'Horizontal push',
  'horizontal-pull': 'Rows',
  'vertical-push': 'Overhead press',
  'vertical-pull': 'Vertical pull',
  carry: 'Carries',
  'core-anti-extension': 'Core: bracing',
  'core-anti-rotation': 'Core: resisting rotation',
  'core-flexion': 'Core: crunching',
  calves: 'Calves',
  biceps: 'Biceps',
  triceps: 'Triceps',
  'rear-delt': 'Rear delts',
  'lateral-raise': 'Side delts',
  'neck-upper-back': 'Neck and upper back',
  'hip-abduction': 'Hip abduction',
  'chest-fly': 'Chest fly',
  jump: 'Jumps',
  conditioning: 'Conditioning',
  mobility: 'Mobility',
  skill: 'Skills',
};

/** How a movement is loaded, in plain words. */
export const LOAD_WORDS: Readonly<Record<CatalogueEntry['load'], string>> = { external: 'added weight', bodyweight: 'bodyweight', timed: 'a hold for time', cardio: 'cardio' };
/** A movement's level, in plain words. */
export const LEVEL_WORDS: Readonly<Record<CatalogueEntry['level'], string>> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };

const words = (id: string) => id.replace(/^(joint|demand):/, '').replace(/-/g, ' ');
const sentence = (t: string) => (t.endsWith('.') ? t : `${t}.`);

export interface CatalogueDocOptions {
  /** A line under the title, such as "Written by Pahlavan 0.27.0 on 2026-11-08." (the vault note has one; the repository's copy does not, so it changes only with the catalogue). */
  stamp?: string;
  /** Only these movements (a search's results), in catalogue order; absent: the whole catalogue. */
  ids?: readonly string[];
}

/** The whole catalogue, grouped by pattern, then the ladders and what each demand tag means. */
export function catalogueMarkdown(opts: CatalogueDocOptions = {}): string {
  const vocab = vocabulary();
  const muscle = new Map(vocab.muscles.map((m) => [m.id, m.label.toLowerCase()]));
  const region = new Map(vocab.regions.map((r) => [r.id, r.label.toLowerCase()]));
  const byId = new Map(CATALOGUE.map((e) => [e.id, e]));
  const wanted = opts.ids ? new Set(opts.ids) : null;
  const shown = wanted ? CATALOGUE.filter((e) => wanted.has(e.id)) : CATALOGUE;
  const groups = (PATTERNS as readonly Pattern[]).map((p) => ({ pattern: p, items: shown.filter((e) => e.pattern === p) })).filter((g) => g.items.length);
  const names = (ids: readonly string[]) => ids.map((id) => byId.get(id)?.name ?? id).join(', ');
  const tool = (ids: readonly string[]) => ids.map((t) => t.replace(/-/g, ' ')).join(' and ');

  const out: string[] = [];
  out.push('# Exercise catalogue', '');
  if (opts.stamp) out.push(`*${opts.stamp}*`, '');
  out.push(
    wanted
      ? `${shown.length} of the ${CATALOGUE.length} movements Pahlavan knows, the ones that fit the search, each with the muscles it trains, how to do it and what to avoid. Generated from Pahlavan's engine: don't edit it by hand.`
      : `The movements Pahlavan knows: ${CATALOGUE.length} of them in ${groups.length} groups, each with the muscles it trains, how to do it and what to avoid. The coach chooses from these, and any of them can go in your plan. This page is generated from Pahlavan's engine, so it matches the version it came with: don't edit it by hand.`,
    '',
    'How to read an entry:',
    '',
    '- **Muscles:** the main ones count a full set each in your weekly sets; the helping ones count half.',
    '- **Regions:** the part of a muscle it biases (the side delts, the upper chest), where the evidence supports one.',
    '- **Easier** and **Harder:** the nearest step down or up.',
    '- **Asks of the body:** what it demands, such as load overhead, impact or a deep knee bend. The coach weighs these against your screening; [the list at the end](#what-each-demand-means) says what each means.',
    '- **Abdominal strain:** low, moderate or high, as Pahlavan screens movements after an injury.',
    '',
    `Groups: ${groups.map((g) => `${PATTERN_TITLE[g.pattern] ?? words(g.pattern)} (${g.items.length})`).join(', ')}.`,
    '',
  );

  for (const g of groups) {
    out.push(`## ${PATTERN_TITLE[g.pattern] ?? words(g.pattern)}`, '');
    for (const e of g.items) {
      const tools = e.equipment.includes('bodyweight') && e.equipment.length === 1 ? 'no equipment' : tool(e.equipment.filter((t) => t !== 'bodyweight'));
      const head = [LEVEL_WORDS[e.level], `${tools}${e.alsoWith.length ? ` (or ${tool(e.alsoWith)})` : ''}`, LOAD_WORDS[e.load], e.unilateral ? 'one side at a time' : null, `abdominal strain ${e.iap}`].filter(Boolean).join(' · ');
      out.push(`### ${e.name}`, '', head, '');
      const main = e.muscles.main.map((m) => muscle.get(m) ?? m);
      const helps = e.muscles.helps.map((m) => muscle.get(m) ?? m);
      if (main.length || helps.length) out.push(`- **Muscles:** ${main.length ? main.join(', ') : 'none counted'}${helps.length ? `; helping: ${helps.join(', ')}` : ''}`);
      if (e.regions?.length) out.push(`- **Regions:** ${e.regions.map((r) => region.get(r) ?? r).join(', ')}`);
      const steps = [e.easier.length ? `**Easier:** ${names(e.easier)}.` : null, e.harder.length ? `**Harder:** ${names(e.harder)}.` : null].filter(Boolean);
      if (steps.length) out.push(`- ${steps.join(' ')}`);
      out.push(`- **Setup:** ${sentence(e.guide.setup)}`, `- **Do:** ${sentence(e.guide.do)}`, `- **Avoid:** ${sentence(e.guide.avoid)}`);
      if (e.aliases.length) out.push(`- **Also called:** ${e.aliases.join(', ')}`);
      const extra = [e.risk.length ? `**Asks of the body:** ${e.risk.map(words).join(', ')}` : null, e.uses.length ? `**Suits:** ${e.uses.map(words).join(', ')}` : null, e.hotel ? 'fits a hotel room' : null].filter(Boolean);
      if (extra.length) out.push(`- ${extra.join(' · ')}`);
      out.push('');
    }
  }

  // The ladders: all of them for the whole catalogue; for a search, those with a level among its movements.
  const ladders = searchCatalogue({}).ladders.filter((l) => l.source !== 'plan' && (!wanted || l.levels.some((x) => x.exercise !== null && wanted.has(x.exercise))));
  if (ladders.length) out.push('## Ladders', '', 'Step-by-step progressions, easiest first. The four marked "by level" are the ones Pahlavan tracks by level (your plan names the level you are at); the rest are chains of catalogue movements, each a step harder than the last.', '');
  for (const l of ladders) {
    out.push(`### ${l.name}${l.source === 'engine' ? ' (by level)' : ''}`, '');
    // "Counts as" only where the level's name is not already the movement's (a weighted pull-up counts as a pull-up).
    const counts = (x: { name: string; exerciseName: string | null }) => (x.exerciseName && !x.exerciseName.toLowerCase().startsWith(x.name.toLowerCase()) ? `: counts as ${x.exerciseName}` : '');
    l.levels.forEach((x) => out.push(`${x.level}. ${x.name}${x.detail ? ` (${x.detail})` : ''}${counts(x)}`));
    out.push('');
  }

  out.push('## What each demand means', '');
  for (const [id, text] of Object.entries(MOVEMENT_TAGS)) out.push(`- **${words(id)}:** ${text}`);
  out.push('', 'And the roles a movement can suit:', '');
  for (const [id, text] of Object.entries(MOVEMENT_USES)) out.push(`- **${words(id)}:** ${text}`);
  out.push('');
  return out.join('\n');
}
