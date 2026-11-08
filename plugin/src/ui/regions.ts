// Muscle regions in words, for the two screens that show them: the Progress
// body map (its tooltip and the Regions list beside it) and the Plan's Sets
// per muscle card (its region lines and tooltip). Every number is the
// engine's region row (src/report/progress.ts, RegionRow); this module only
// words it, so both screens say the same thing.

import type { RegionRow } from '../../../src/report/progress.ts';
import { fmt } from './format.ts';

export type { RegionRow };

/** A region short of its aim that no catalogue movement can cover with the person's equipment, Ledger and findings: not a shortfall to fix with these. */
/** A region short of its aim that no catalogue movement can cover: the equipment, the Ledger, the dislikes and the confirmed findings leave none. */
export const NO_OPTION = 'no option you can do now';

/** A heuristic region (no training study has measured it) is shown as a rough guide only. */
export const roughGuide = (r: Pick<RegionRow, 'grade' | 'roughGuide'>): boolean => r.roughGuide || r.grade === 'heuristic';

/** The region's name under its muscle's heading: "Hamstrings, hip extension" reads "Hip extension" under Hamstrings. */
export function regionName(r: Pick<RegionRow, 'label'>, muscle: string): string {
  const prefix = new RegExp(`^${muscle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[, ]+`, 'i');
  const short = r.label.replace(prefix, '');
  return short === r.label || !short ? r.label : short[0]!.toUpperCase() + short.slice(1);
}

/**
 * A region's weekly sets and, for one held to a rule, where it stands: "9",
 * "3.3 (0 direct)", "0, under 4", "7, ok". A declared region's rule counts
 * direct sets near failure, so when those differ from its direct sets both
 * show.
 */
export function regionValue(r: RegionRow): string {
  const sets = fmt.sets(r.sets);
  const detail = r.rule === 'declared' && r.counted !== null && r.counted !== r.direct
    ? ` (${fmt.sets(r.counted)} of ${fmt.sets(r.direct)} direct near failure)`
    : r.indirect > 0 ? ` (${fmt.sets(r.direct)} direct)` : '';
  const status = r.status === 'short' ? `, under ${r.min}` : r.status === 'uncoverable' ? `, ${NO_OPTION}` : r.status === 'ok' ? ', ok' : '';
  return `${sets}${detail}${status}`;
}

/** The tooltip's rows for a muscle's regions (data-tip lines): a heading, then each region and its sets, declared ones starred, heuristic ones a rough guide. */
export function regionTipLines(regions: readonly RegionRow[], muscle: string): string[] {
  if (!regions.length) return [];
  return ['§Regions', ...regions.map((r) => `${r.declared ? '★ ' : ''}${regionName(r, muscle)}${roughGuide(r) ? ' (rough guide)' : ''}\t${regionValue(r)}`)];
}

/**
 * A region held to a rule, its counted sets against its aim: "6 direct, aim
 * 6", "2 direct, under the aim of 6"; null for a region reported only.
 */
export function regionAimValue(r: RegionRow): string | null {
  if (r.rule === null || r.min === null || r.counted === null) return null;
  const counted = r.counted === r.direct ? `${fmt.sets(r.counted)} direct` : `${fmt.sets(r.counted)} of ${fmt.sets(r.direct)} direct near failure`;
  return `${counted}, ${r.status === 'short' ? `under the aim of ${r.min}` : r.status === 'uncoverable' ? `${NO_OPTION} (aim ${r.min})` : `aim ${r.min}`}`;
}

/** The same, named: "Side delts: 6 direct, aim 6". */
export function regionAim(r: RegionRow): string | null {
  const value = regionAimValue(r);
  return value === null ? null : `${r.label}: ${value}`;
}

/** The muscles a Regions list shows: each with a region that has sets or is held to a rule (a muscle with none is left out). */
export function musclesWithRegions<T extends { regions: readonly RegionRow[] }>(muscles: readonly T[]): T[] {
  return muscles.filter((m) => m.regions.some((r) => r.sets > 0 || r.status !== 'reported'));
}
