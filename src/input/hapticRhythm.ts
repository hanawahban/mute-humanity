// The rules for controller vibration, free of the browser so they can be tested.
//
// The controller follows the sound: it vibrates when a note plays, and only then. There is no
// metronome under it. It feels ONE record at a time (the one chosen with the D-pad, or the
// loudest), because six patterns at once blur into one buzz. Each record has its own feel,
// shaped like its sound:
//
//   Ocean      cello, long bowed notes     a slow swell in the big motor
//   Rain       flute, falling drops        light taps in the small motor
//   Lightning  violin, sharp strikes       a crisp crack in both motors, the firmest feel
//   Lights     synth pad sparkles          a quick double flicker in the small motor
//   CO2        deep synth drone            a low, soft hum in the big motor
//   NOx        gritty synth                a short stutter, like grit
//
// Louder notes are stronger; higher notes lean to the small motor, lower ones to the big one.
// Everything is kept gentle: nothing goes above MAX_MAGNITUDE, and pulses of one record are
// spaced at least MIN_GAP apart so fast passages don't turn into a continuous buzz.

export interface Pulse {
  ms: number;
  strong: number; // 0-1, the big low-frequency motor
  weak: number; // 0-1, the small high-frequency motor
}
export interface TimedPulse extends Pulse {
  delay: number; // seconds after the note starts
}
export type FeelId = 'ocean' | 'rain' | 'lightning' | 'lights' | 'co2' | 'nox';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Motors barely move below this; anything asked for is lifted to at least this, zero stays zero. */
export const MIN_MAGNITUDE = 0.12;
/** The ceiling: never harsh, even with the strength setting at 100%. */
export const MAX_MAGNITUDE = 0.62;
/** Shortest pulse the motors render. */
export const MIN_MS = 30;
/** Shortest time between two pulses of the same record, in seconds. */
export const MIN_GAP: Record<FeelId, number> = { ocean: 0.35, rain: 0.11, lightning: 0.15, lights: 0.16, co2: 0.5, nox: 0.25 };

/** A 0-1 strength as the motor gets it: lifted so it is felt, capped so it is never harsh. */
export function shape(m: number): number {
  const x = clamp01(m);
  return x < 0.02 ? 0 : MIN_MAGNITUDE + (MAX_MAGNITUDE - MIN_MAGNITUDE) * x;
}

const LOW = Math.log2(55); // A1
const HIGH = Math.log2(1760); // A6
/** 0 = lowest note we play, 1 = highest. */
export function pitchPosition(freq: number): number {
  return clamp01((Math.log2(Math.max(freq, 1)) - LOW) / (HIGH - LOW));
}

const p = (delay: number, ms: number, strong: number, weak: number): TimedPulse => ({ delay, ms, strong, weak });

/** Each record's feel at full strength, before velocity and pitch. */
const FEEL: Record<FeelId, TimedPulse[]> = {
  // rises and falls, like a bow stroke
  ocean: [p(0, 70, 0.35, 0.05), p(0.08, 80, 0.6, 0.08), p(0.17, 80, 0.45, 0.06), p(0.27, 90, 0.22, 0.03)],
  // one light tap per drop
  rain: [p(0, 32, 0, 0.42)],
  // a single crisp crack, the firmest feel
  lightning: [p(0, 45, 0.7, 0.85)],
  // two quick flickers
  lights: [p(0, 28, 0, 0.38), p(0.07, 28, 0, 0.24)],
  // a long, soft hum that fades
  co2: [p(0, 220, 0.42, 0), p(0.24, 180, 0.25, 0)],
  // three short grains
  nox: [p(0, 26, 0.12, 0.42), p(0.06, 26, 0.1, 0.36), p(0.12, 26, 0.08, 0.3)],
};

export const FEEL_NAME: Record<FeelId, string> = {
  ocean: 'a slow swell',
  rain: 'light taps',
  lightning: 'a sharp crack',
  lights: 'a flicker',
  co2: 'a low hum',
  nox: 'a gritty stutter',
};

/**
 * The pulses for one note of a record: its feel, scaled by how hard the note is played (and,
 * for humanity's records, by the humanity lever), tilted to the small motor for high notes.
 */
export function notePulses(id: FeelId, freq: number, velocity: number, scale = 1): TimedPulse[] {
  const v = clamp01(velocity) * clamp01(scale);
  if (v < 0.03) return [];
  const amount = 0.45 + 0.55 * v; // soft notes are still felt, loud ones more
  const x = pitchPosition(freq);
  const toStrong = 1.15 - 0.3 * x;
  const toWeak = 0.85 + 0.3 * x;
  return FEEL[id].map((q) => ({
    delay: q.delay,
    ms: Math.max(MIN_MS, q.ms),
    strong: clamp01(q.strong * amount * toStrong),
    weak: clamp01(q.weak * amount * toWeak),
  }));
}

/** Humanity's records follow the lever: half strength at 50%, nothing when our footprint is lightened. */
export function humanityScale(side: 'earth' | 'human', humanity: number): number {
  if (side === 'earth') return 1;
  return humanity < 0.03 ? 0 : clamp01(humanity);
}

/** Two pulses in the same 20 ms become one: the stronger of each motor, the longer length. */
export function mergePulse(a: Pulse, b: Pulse): Pulse {
  return { ms: Math.max(a.ms, b.ms), strong: Math.max(a.strong, b.strong), weak: Math.max(a.weak, b.weak) };
}

/** Pulses are grouped into 20 ms bins so a chord is one pulse, not three. */
export const binOf = (timeSeconds: number) => Math.round(timeSeconds * 50);
