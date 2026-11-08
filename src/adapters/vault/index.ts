// The read-only vault adapter: the dashboard's files into schema v1.

export * from './convert.ts';
export * from './read.ts';
export { matchCatalogue, normalizeName, NAME_SYNONYMS } from './catalogue-match.ts';
export { vaultMuscleMap } from './muscle-map.ts';
export { canonicalTags, type CanonicalTags, type TagSource } from './muscle-tags.ts';
