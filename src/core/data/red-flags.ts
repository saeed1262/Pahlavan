// Red flags and screening warning signs, copied from the fitness-coach skill's
// intake.md. Wellness wording: each entry describes what a person reports and
// never names a cause or a condition.

export type RedFlagSeverity = 'emergency' | 'stop-and-refer';

export interface RedFlag {
  id: string;
  text: string;
  severity: RedFlagSeverity;
}

/** The 9 warning signs asked at screening. Any one blocks training until a clinician clears it. */
export const WARNING_SIGNS: readonly { id: string; text: string }[] = [
  { id: 'chest-discomfort', text: 'Pain, pressure or discomfort in the chest, neck, jaw or arms, at rest or when active' },
  { id: 'breathless-light-effort', text: 'Shortness of breath at rest or with light effort' },
  { id: 'dizziness-fainting', text: 'Dizziness, light-headedness or fainting' },
  { id: 'breathless-lying-flat', text: 'Breathlessness when lying flat, or waking at night short of breath' },
  { id: 'swollen-ankles', text: 'Swollen ankles' },
  { id: 'irregular-heartbeat', text: 'A racing, pounding or irregular heartbeat' },
  { id: 'leg-pain-walking', text: 'Pain or cramping in the calves or legs when walking, easing with rest' },
  { id: 'heart-murmur', text: "A heart murmur you've been told about" },
  { id: 'unusual-tiredness', text: 'Unusual tiredness or breathlessness in everyday activities' },
];

/** Call emergency services now. */
const EMERGENCY: readonly Omit<RedFlag, 'severity'>[] = [
  { id: 'chest-pain', text: 'Chest pain, pressure or tightness, especially spreading to the arm, jaw, neck or back, or with sweating, nausea or breathlessness' },
  { id: 'fainting-with-exercise', text: 'Fainting or near-fainting during or after exercise' },
  { id: 'sudden-breathlessness', text: 'Sudden severe shortness of breath' },
  { id: 'sudden-weakness-speech-vision', text: 'Sudden weakness or numbness of the face, an arm or a leg, trouble speaking, or sudden loss of vision' },
  { id: 'sudden-severe-headache', text: 'A sudden, severe headache unlike any before' },
  { id: 'stuck-belly-groin-bulge', text: "A painful, firm bulge in the belly or groin that won't go back in, especially with nausea or vomiting" },
  { id: 'saddle-numbness-or-control', text: 'Numbness around the groin or buttocks, or loss of bladder or bowel control' },
  { id: 'muscle-pain-dark-urine', text: 'Severe muscle pain and swelling with dark (cola-coloured) urine after hard training' },
];

/** Stop training (that area, or entirely) and see a clinician before going on. */
const STOP_AND_REFER: readonly Omit<RedFlag, 'severity'>[] = [
  { id: 'new-warning-sign', text: 'Any of the 9 screening warning signs, new' },
  { id: 'racing-heartbeat', text: 'A racing or irregular heartbeat, at rest or in training' },
  { id: 'one-calf-swollen', text: 'One calf painful, swollen, warm or red' },
  { id: 'spreading-numbness', text: 'Numbness, tingling or weakness spreading down an arm or a leg' },
  { id: 'night-pain', text: 'Pain at night that no position eases, or with fever or unexplained weight loss' },
  { id: 'fever-body-aches', text: "Fever or body aches (no training at all until they're gone)" },
  { id: 'joint-gave-way', text: 'A joint that gave way, locked, or swelled quickly after an injury; a pop with immediate pain or weakness' },
  { id: 'pain-over-5', text: 'Pain over 5/10, or pain getting worse session after session' },
  { id: 'head-knock', text: 'A head knock followed by headache, dizziness, confusion or sickness' },
  { id: 'abdominal-site-change', text: 'A bulge, pressure or new pain at a known abdominal-wall site' },
];

/** Every red flag: the emergency list, the stop-and-refer list, and the warning signs (stop and refer when new). */
export const RED_FLAGS: readonly RedFlag[] = [
  ...EMERGENCY.map((f) => ({ ...f, severity: 'emergency' as const })),
  ...STOP_AND_REFER.map((f) => ({ ...f, severity: 'stop-and-refer' as const })),
  ...WARNING_SIGNS.map((f) => ({ ...f, severity: 'stop-and-refer' as const })),
];

export const REFERRAL = {
  emergency: 'Call emergency services now.',
  stop: 'Stop training (that area, or entirely) and see a clinician before going on.',
  plan: "That's something to check with a doctor before we plan training. I'll keep logging going, and we'll pick up the plan once you're cleared.",
  describe: 'Describe what was reported; never name a cause.',
} as const;
