// The harmony rules, kept free of Tone.js so they can be tested on their own.
//
// The idea: nature sings in tune (A major pentatonic) and humanity is the same tune pushed
// off course. Humans are not a different song, they bend the song that is already there.
//
//   tension 0   humanity plays the Earth's notes, in tune: it blends in
//   tension 0.5 about one human note in eleven is bent to a note that is not in the key
//   tension 1   about one in five is bent, and the synths drift a little out of tune: you
//               feel the disturbance, but four notes in five are still the Earth's, so it
//               stays music and never turns jarring

/** Semitones above A for the notes of A major (the key of the team's recordings). */
const IN_KEY = new Set([0, 2, 4, 5, 7, 9, 11]);
/** Out-of-key notes that are mild "blue notes" (flat 3rd and flat 7th), as opposed to harsh ones. */
const BLUE = new Set([3, 10]);

const mod12 = (n: number) => ((n % 12) + 12) % 12;
/** Semitones above A (0-11) for a MIDI note: A4 = 69. */
const pitchClass = (midi: number) => mod12(midi - 69);

/** Chance that a human note is bent off the key at this tension (0-1). */
export function bendChance(tension: number): number {
  const t = clamp01(tension);
  return 0.06 * t + 0.16 * t ** 1.5; // 0 at 0, ~0.09 at 0.5, 0.22 at 1
}

/**
 * Push a MIDI note one or two semitones off the key. Mild blue notes (C, G) are preferred at low
 * tension; the harsh ones (A#, D#, F) take over as tension rises. Returns the note unchanged when
 * it is not bent. `rnd` gives a number in [0, 1), so tests can fix it.
 */
export function bend(midi: number, tension: number, rnd: () => number = Math.random): number {
  const t = clamp01(tension);
  if (rnd() >= bendChance(t)) return midi;
  // every way to move one or two semitones that ends outside the key
  const options = [-2, -1, 1, 2].filter((d) => !IN_KEY.has(pitchClass(midi + d)));
  if (!options.length) return midi;
  const mild = options.filter((d) => BLUE.has(pitchClass(midi + d)));
  const pool = mild.length && rnd() > 0.6 * t ? mild : options; // mostly the mild blue notes, even at full tension
  return midi + pool[Math.floor(rnd() * pool.length)];
}

/** How far out of tune a human synth drifts, in cents (100 = a semitone). Zero below a little tension. */
export function detuneCents(tension: number, rnd: () => number = Math.random): number {
  const t = clamp01(tension);
  return (rnd() * 2 - 1) * 14 * t ** 1.3 + 0; // + 0 turns -0 into 0
}

/** How late (in 16ths) a human note drags behind the beat. Nature stays on the grid. */
export function dragSixteenths(tension: number, rnd: () => number = Math.random): number {
  return clamp01(tension) * 0.15 * rnd();
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
