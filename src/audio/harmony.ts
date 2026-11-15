// The harmony rules, kept free of Tone.js so they can be tested on their own.
//
// The reference is the team's full arrangement, all.mp3 (measured with
// pipeline/audio_tools/analyze_all.py). It does not move: for all 14 seconds it sits on one
// A major sound with A held in the bass. 96% of its energy is four notes, A 35%, E 30%,
// B 16%, C# 15% (Asus2 / A add9), and only 2% is outside the key: A# 0.8, F 0.5, G 0.4,
// C 0.2, D# 0.1. So:
//
//   Earth     plays only A, B, C# and E, leaning on A and E the way the arrangement does
//   humanity  plays the same notes, and very rarely bends one slightly off the key, nearly
//             always to the mildest note available: the flat 7th (G) that the arrangement
//             itself uses over its A in the last bars, or the flat 3rd (C), the "blue" notes
//
//   tension 0   humanity blends in completely
//   tension 0.5 about one human note in 680 is bent
//   tension 1   about one in 285, and at most 1.5 cents out of tune (below what the ear
//               notices): almost no edge in an otherwise settled sound

/** Semitones above A for the notes of A major. */
const ANCHORS = [0, 7]; // A and E: 65% of all.mp3's energy
/**
 * How willing we are to bend to each out-of-key note when a note has a choice: the mild blue notes
 * (G is the flat 7th, C the flat 3rd) far above the grating ones (F, A# and D# rub against A, E or C#).
 */
const OUT_OF_KEY_WEIGHT: Record<number, number> = { 10: 1, 3: 0.45, 8: 0.04, 1: 0.03, 6: 0.015 }; // G, C, F, A#, D#

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
  return 0.0015 * t + 0.002 * t ** 1.5; // 0 at 0, ~0.0015 at 0.5, 0.0035 at 1
}

/**
 * Push a MIDI note up to three semitones off the key, to an out-of-key note it can reach,
 * nearly always a mild one (G or C) when there is a choice. Returns the note unchanged when it is not bent.
 * `rnd` gives a number in [0, 1), so tests can fix it.
 */
export function bend(midi: number, tension: number, rnd: () => number = Math.random): number {
  if (rnd() >= bendChance(tension)) return midi;
  const options = [-3, -2, -1, 1, 2, 3].map((d) => ({ d, w: OUT_OF_KEY_WEIGHT[pitchClass(midi + d)] ?? 0 })).filter((o) => o.w > 0);
  if (!options.length) return midi;
  let r = rnd() * options.reduce((sum, o) => sum + o.w, 0);
  for (const o of options) if ((r -= o.w) < 0) return midi + o.d;
  return midi + options[options.length - 1].d;
}

/** How far out of tune a human synth drifts, in cents (100 = a semitone). */
export function detuneCents(tension: number, rnd: () => number = Math.random): number {
  const t = clamp01(tension);
  return (rnd() * 2 - 1) * 1.5 * t ** 1.3 + 0; // + 0 turns -0 into 0
}

/** How late (in 16ths) a human note drags behind the beat. Nature stays on the grid. */
export function dragSixteenths(tension: number, rnd: () => number = Math.random): number {
  return clamp01(tension) * 0.04 * rnd();
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
