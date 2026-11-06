// The banner's phase: Isfahan's class on <body> when the plugin is on (it
// follows a pinned phase too), else the hour, with the same table as the
// fitness dashboard's view.js (and Isfahan's own phases).

export type PhaseId = 'dawn' | 'workday' | 'evening' | 'night';

export const PHASES: readonly { id: PhaseId; from: number; to: number }[] = [
  { id: 'dawn', from: 6, to: 10 },
  { id: 'workday', from: 10, to: 15 },
  { id: 'evening', from: 15, to: 18 },
  { id: 'night', from: 18, to: 6 },
];

export function phaseByHour(hour: number): PhaseId {
  return PHASES.find((p) => (p.from < p.to ? hour >= p.from && hour < p.to : hour >= p.from || hour < p.to))!.id;
}

/** The phase from the body's classes, else from the hour. */
export function phaseNow(classes: { contains(name: string): boolean }, hour: number): { id: PhaseId; isfahan: boolean } {
  const pinned = PHASES.find((p) => classes.contains(`isfahan-${p.id}`));
  return pinned ? { id: pinned.id, isfahan: classes.contains('isfahan') } : { id: phaseByHour(hour), isfahan: false };
}
