// Muscle ids. Session 1's ids are kept (they match the vault's plan data); each
// maps to the closest slug of the MIT react-native-body-highlighter body map.
// The parts of a muscle that train differently (a muscle's regions) are in
// data/regions.ts; a muscle's `area` here is only upper body, lower body or core.

export type BodyArea = 'upper' | 'lower' | 'core';

export interface Muscle {
  id: string;
  label: string;
  area: BodyArea;
  /** The body-highlighter slug drawn for this muscle. */
  highlighter: string;
}

export const MUSCLES: readonly Muscle[] = [
  { id: 'chest', label: 'Chest', area: 'upper', highlighter: 'chest' },
  { id: 'shoulders', label: 'Shoulders', area: 'upper', highlighter: 'deltoids' },
  { id: 'biceps', label: 'Biceps', area: 'upper', highlighter: 'biceps' },
  { id: 'triceps', label: 'Triceps', area: 'upper', highlighter: 'triceps' },
  { id: 'forearms', label: 'Forearms', area: 'upper', highlighter: 'forearm' },
  { id: 'upper-back', label: 'Upper back', area: 'upper', highlighter: 'trapezius' },
  { id: 'lats', label: 'Lats', area: 'upper', highlighter: 'upper-back' },
  { id: 'neck', label: 'Neck', area: 'upper', highlighter: 'neck' },
  { id: 'abs', label: 'Abs', area: 'core', highlighter: 'abs' },
  { id: 'obliques', label: 'Obliques', area: 'core', highlighter: 'obliques' },
  { id: 'lower-back', label: 'Lower back', area: 'core', highlighter: 'lower-back' },
  { id: 'glutes', label: 'Glutes', area: 'lower', highlighter: 'gluteal' },
  { id: 'quads', label: 'Quads', area: 'lower', highlighter: 'quadriceps' },
  { id: 'hamstrings', label: 'Hamstrings', area: 'lower', highlighter: 'hamstring' },
  { id: 'calves', label: 'Calves', area: 'lower', highlighter: 'calves' },
  { id: 'adductors', label: 'Adductors', area: 'lower', highlighter: 'adductors' },
  { id: 'abductors', label: 'Abductors', area: 'lower', highlighter: 'gluteal' },
  { id: 'tibialis', label: 'Shins', area: 'lower', highlighter: 'tibialis' },
];

export const MUSCLE_IDS: readonly string[] = MUSCLES.map((m) => m.id);
export const LOWER_BODY: readonly string[] = MUSCLES.filter((m) => m.area === 'lower').map((m) => m.id);
export const UPPER_BODY: readonly string[] = MUSCLES.filter((m) => m.area === 'upper' && m.id !== 'neck').map((m) => m.id);

/** Muscles every lifting plan should reach (the minimum-dose floor applies to these). */
export const MAJOR_MUSCLES: readonly string[] = ['chest', 'shoulders', 'upper-back', 'lats', 'quads', 'glutes', 'hamstrings', 'abs'];
