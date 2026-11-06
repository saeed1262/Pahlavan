// Muscle ids. Session 1's ids are kept (they match the vault's plan data); each
// maps to the closest slug of the MIT react-native-body-highlighter body map.

export type Region = 'upper' | 'lower' | 'core';

export interface Muscle {
  id: string;
  label: string;
  region: Region;
  /** The body-highlighter slug drawn for this muscle. */
  highlighter: string;
}

export const MUSCLES: readonly Muscle[] = [
  { id: 'chest', label: 'Chest', region: 'upper', highlighter: 'chest' },
  { id: 'shoulders', label: 'Shoulders', region: 'upper', highlighter: 'deltoids' },
  { id: 'biceps', label: 'Biceps', region: 'upper', highlighter: 'biceps' },
  { id: 'triceps', label: 'Triceps', region: 'upper', highlighter: 'triceps' },
  { id: 'forearms', label: 'Forearms', region: 'upper', highlighter: 'forearm' },
  { id: 'upper-back', label: 'Upper back', region: 'upper', highlighter: 'trapezius' },
  { id: 'lats', label: 'Lats', region: 'upper', highlighter: 'upper-back' },
  { id: 'neck', label: 'Neck', region: 'upper', highlighter: 'neck' },
  { id: 'abs', label: 'Abs', region: 'core', highlighter: 'abs' },
  { id: 'obliques', label: 'Obliques', region: 'core', highlighter: 'obliques' },
  { id: 'lower-back', label: 'Lower back', region: 'core', highlighter: 'lower-back' },
  { id: 'glutes', label: 'Glutes', region: 'lower', highlighter: 'gluteal' },
  { id: 'quads', label: 'Quads', region: 'lower', highlighter: 'quadriceps' },
  { id: 'hamstrings', label: 'Hamstrings', region: 'lower', highlighter: 'hamstring' },
  { id: 'calves', label: 'Calves', region: 'lower', highlighter: 'calves' },
  { id: 'adductors', label: 'Adductors', region: 'lower', highlighter: 'adductors' },
  { id: 'abductors', label: 'Abductors', region: 'lower', highlighter: 'gluteal' },
  { id: 'tibialis', label: 'Shins', region: 'lower', highlighter: 'tibialis' },
];

export const MUSCLE_IDS: readonly string[] = MUSCLES.map((m) => m.id);
export const LOWER_BODY: readonly string[] = MUSCLES.filter((m) => m.region === 'lower').map((m) => m.id);
export const UPPER_BODY: readonly string[] = MUSCLES.filter((m) => m.region === 'upper' && m.id !== 'neck').map((m) => m.id);

/** Muscles every lifting plan should reach (the minimum-dose floor applies to these). */
export const MAJOR_MUSCLES: readonly string[] = ['chest', 'shoulders', 'upper-back', 'lats', 'quads', 'glutes', 'hamstrings', 'abs'];
