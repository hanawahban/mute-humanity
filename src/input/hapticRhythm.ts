// The rhythm rules for controller vibration, free of the browser so they can be tested.
//
// Vibration now follows the music instead of rolling dice. Two things drive it, both on the
// same 16th-note clock the notes use (80 BPM, 16 steps to a bar):
//
//   notes   every note of the record you are feeling pulses the pad at the moment it sounds.
//           Low notes go to the big (strong) motor, high notes to the small (weak) motor,
//           harder notes pulse harder, held notes get a short fading tail.
//   beats   each record also has a rhythm locked to the beat grid, so it is felt even
//           between notes: ocean swells on beats 1 and 3, CO2 thumps like a kick drum,
//           NOx clicks on the 16ths, city lights sparkle on the off-beats.

export interface Pulse {
  ms: number;
  strong: number; // 0-1, the big low-frequency motor
  weak: number; // 0-1, the small high-frequency motor
}
export interface TimedPulse extends Pulse {
  delay: number; // seconds after the note starts
}
export type Voice = 'sustain' | 'drops' | 'strikes' | 'drone';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const LOW = Math.log2(55); // A1
const HIGH = Math.log2(1760); // A6

/** 0 = lowest note we play, 1 = highest. */
export function pitchPosition(freq: number): number {
  return clamp01((Math.log2(Math.max(freq, 1)) - LOW) / (HIGH - LOW));
}

/** Which motors a note uses: low notes rumble, high notes buzz, harder notes are stronger. */
export function noteMotors(freq: number, velocity: number): { strong: number; weak: number } {
  const x = pitchPosition(freq);
  const power = 0.3 + 0.7 * clamp01(velocity);
  return {
    strong: clamp01(power * (1 - x) ** 0.7),
    weak: clamp01(power * (0.25 + 0.75 * x)),
  };
}

/** The pulses for one note: a hit at the note's start, plus a fading tail for held notes. */
export function notePulses(voice: Voice, freq: number, velocity: number): TimedPulse[] {
  const m = noteMotors(freq, velocity);
  switch (voice) {
    case 'strikes':
      return [{ delay: 0, ms: 30, strong: Math.max(m.strong, 0.5), weak: Math.max(m.weak, 0.6) }]; // sharp: both motors
    case 'drops':
      return [{ delay: 0, ms: 34, strong: m.strong * 0.5, weak: m.weak }];
    case 'sustain':
      return [
        { delay: 0, ms: 80, ...m },
        { delay: 0.11, ms: 70, strong: m.strong * 0.45, weak: m.weak * 0.45 },
        { delay: 0.21, ms: 60, strong: m.strong * 0.2, weak: m.weak * 0.2 },
      ];
    case 'drone':
      return [
        { delay: 0, ms: 140, ...m },
        { delay: 0.19, ms: 110, strong: m.strong * 0.5, weak: m.weak * 0.5 },
      ];
  }
}

/** How strongly each beat of the bar is felt (beat 1 is the heaviest). */
const SWELL = [1, 0.45, 0.75, 0.4];
const KICK = [1, 0.5, 0.7, 0.5];

/**
 * The beat-locked pattern for a record at 16th step `step` (0-15) of the bar, or null for
 * silence. `level` is how loud the record is right now (0-1). Rain and lightning have no
 * beat pattern: their notes are the rhythm.
 */
export function stepPulse(id: string, step: number, level: number, rnd: () => number = Math.random): Pulse | null {
  const v = clamp01(level);
  if (v < 0.03) return null;
  const beat = Math.floor(step / 4) % 4;
  const sub = step % 4; // 0 = on the beat, 2 = the "and", 1 and 3 = the 16ths between
  switch (id) {
    case 'ocean':
      return sub === 0 ? { ms: 90, strong: v * (0.2 + 0.65 * SWELL[beat]), weak: v * 0.1 * SWELL[beat] } : null;
    case 'co2':
      return sub === 0 ? { ms: 70, strong: (0.2 + 0.6 * v) * KICK[beat], weak: 0.05 } : null;
    case 'nox': {
      const p = 0.1 + 0.75 * v ** 1.2;
      if (rnd() >= p) return null;
      return { ms: 22, strong: (sub === 0 ? 1 : 0.7) * (0.6 + 0.35 * v), weak: 0.15 };
    }
    case 'lights':
      return sub === 2 && rnd() < 0.25 + 0.7 * v ? { ms: 40, strong: 0, weak: 0.2 + 0.4 * v * rnd() } : null;
    default:
      return null;
  }
}

/** Two pulses in the same 20 ms become one: the stronger of each motor, the longer length. */
export function mergePulse(a: Pulse, b: Pulse): Pulse {
  return { ms: Math.max(a.ms, b.ms), strong: Math.max(a.strong, b.strong), weak: Math.max(a.weak, b.weak) };
}

/** Pulses are grouped into 20 ms bins so a chord or a beat plus a note is one pulse, not three. */
export const binOf = (timeSeconds: number) => Math.round(timeSeconds * 50);
