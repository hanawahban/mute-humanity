// The harmony rules, kept free of Tone.js so they can be tested on their own.
//
// The reference is the team's full arrangement, all.mp3 (measured with
// pipeline/audio_tools/analyze_all.py). It does not move: for all 14 seconds it sits on one
// A major sound with A held in the bass. 96% of its energy is four notes, A 35%, E 30%,
// B 16%, C# 15% (Asus2 / A add9), and only 2% is outside the key: A# 0.8, F 0.5, G 0.4,
// C 0.2, D# 0.1. So:
//
//   Earth     plays only A, B, C# and E, leaning on A and E the way the arrangement does
//   humanity  plays the same notes, and only now and then bends one off the key, to the
//             arrangement's own out-of-key notes, favouring the ones it uses most (A#, F, G)
//
//   tension 0   humanity blends in completely
//   tension 0.5 about one human note in thirty is bent
//   tension 1   about one in twelve is bent, a few cents out of tune: a hint of friction in
//               an otherwise settled sound

/** Semitones above A for the notes of A major. */
const ANCHORS = [0, 7]; // A and E: 65% of all.mp3's energy
/** How common each out-of-key note is in all.mp3 (energy, in % of the whole): the weights when a note has a choice. */
const OUT_OF_KEY_WEIGHT: Record<number, number> = { 1: 0.8, 8: 0.5, 10: 0.4, 3: 0.2, 6: 0.1 }; // A#, F, G, C, D#

const mod12 = (n: number) => ((n % 12) + 12) % 12;
/** Semitones above A (0-11) for a MIDI note: A4 = 69. */
const pitchClass = (midi: number) => mod12(midi - 69);

/**
 * Lean a note toward A or E: with probability `strength` it moves to the nearest one (B down
 * to A, C# up to E). With a uniform spread over A, B, C#, E and strength 0.35, A and E carry
 * 67% of the notes and B and C# the other 33%, the same split as the arrangement (65 / 31).
 */
export function settle(midi: number, strength = 0.35, rnd: () => number = Math.random): number {
  if (ANCHORS.includes(pitchClass(midi)) || rnd() >= strength) return midi;
  for (const d of [-1, 1, -2, 2, -3, 3, -4, 4]) if (ANCHORS.includes(pitchClass(midi + d))) return midi + d;
  return midi;
}

/** Chance that a human note is bent off the key at this tension (0-1). */
export function bendChance(tension: number): number {
  const t = clamp01(tension);
  return 0.03 * t + 0.05 * t ** 1.5; // 0 at 0, ~0.03 at 0.5, 0.08 at 1
}

/**
 * Push a MIDI note one or two semitones off the key, to one of the arrangement's own
 * out-of-key notes that it can reach, favouring the ones all.mp3 uses most (A# and F over D#). Returns the note unchanged when it is not bent.
 * `rnd` gives a number in [0, 1), so tests can fix it.
 */
export function bend(midi: number, tension: number, rnd: () => number = Math.random): number {
  if (rnd() >= bendChance(tension)) return midi;
  const options = [-2, -1, 1, 2].map((d) => ({ d, w: OUT_OF_KEY_WEIGHT[pitchClass(midi + d)] ?? 0 })).filter((o) => o.w > 0);
  if (!options.length) return midi;
  let r = rnd() * options.reduce((sum, o) => sum + o.w, 0);
  for (const o of options) if ((r -= o.w) < 0) return midi + o.d;
  return midi + options[options.length - 1].d;
}

/** How far out of tune a human synth drifts, in cents (100 = a semitone). */
export function detuneCents(tension: number, rnd: () => number = Math.random): number {
  const t = clamp01(tension);
  return (rnd() * 2 - 1) * 9 * t ** 1.3 + 0; // + 0 turns -0 into 0
}

/** How late (in 16ths) a human note drags behind the beat. Nature stays on the grid. */
export function dragSixteenths(tension: number, rnd: () => number = Math.random): number {
  return clamp01(tension) * 0.15 * rnd();
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
