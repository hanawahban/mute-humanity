// The six records. Each one is a NASA Earth Information Center (EIC) visualization that is a
// flat map of the whole Earth, so they all line up on one shared map. Earth records play in
// tune (A, B, C# and E over a held A, like the team's all.mp3). Humanity records play the same
// notes and now and then bend one off the key (see audio/harmony.ts), a hint of friction
// without becoming noise. Earth records use only the traditional instruments, humanity records only the synths.
// Each record keeps its own time period: they line up in place, not in date.

import type { KeyMode } from '../map/gl';

export type RecordId = 'ocean' | 'rain' | 'lightning' | 'lights' | 'co2' | 'nox';
export type Side = 'earth' | 'human';
export type InstrumentId = 'cello' | 'clarinet' | 'flute' | 'oboe' | 'synth1' | 'synth2' | 'synth3' | 'viola' | 'violin' | 'all';

/** How a pixel's color becomes a 0-1 value. */
export type Decode =
  | { kind: 'colorbar'; stops: Array<[r: number, g: number, b: number, v: number]>; maxDistance?: number }
  | { kind: 'bright'; floor: number } // brightness above a dark background
  | { kind: 'colorful' } // colored marks over gray or black (lightning flashes)
  | { kind: 'warm' } // warm-colored data (yellow to red) drawn over a natural-color base map
  | { kind: 'precip' }; // white clouds + colored rain

/** How the values become music in Listen mode. */
export type Voice =
  | 'sustain' // long notes, pitch follows the average value
  | 'drops' // short notes, how many follows the value (rain, lights)
  | 'strikes' // sharp hits on the brightest points (lightning)
  | 'drone'; // low held note, gets thicker and louder

export interface RecordDef {
  id: RecordId;
  name: string;
  short: string; // 1-2 words for small labels
  side: Side;
  color: string; // record label color in the dock
  svs: number;
  eicTitle: string;
  period: string; // the real time period of the visualization
  shows: string; // one plain sentence: what the picture shows
  hear: string; // one plain sentence: what you hear
  kind: 'movie' | 'still';
  decode: Decode;
  instrument: InstrumentId;
  voice: Voice;
  /** Second instrument for a second part of the picture (clouds under the rain). */
  second?: { instrument: InstrumentId; voice: Voice; label: string };
  /** The map key: what low and high look like and mean. */
  /** Only pixels with this tint are data (for keys that run through one color). */
  tint?: 'green';
  /**
   * Only this part of the color key counts (0-1 along the key). NOx's key is logarithmic, so
   * almost all land sits in its upper half; only the top of it is real pollution worth a note.
   */
  contrast?: [number, number];
  scale: { low: string; high: string; colors: string[]; lightBar?: boolean };
  /** Pixels that don't match the color key: "nodata" (land under the ocean layer) or "zero" (no pollution, no rain). */
  empty: 'nodata' | 'zero';
  /** How the map shader hides this layer's background, so all layers can be stacked. */
  keying: KeyMode;
  keyingPlaceholder?: KeyMode;
  /** Logos and date stamps burned into the real frames, as fractions [x0, y0, x1, y1]: ignored for sound and hidden on the map. */
  masks?: Array<[number, number, number, number]>;
  /** Match colors by hue only (for maps whose colors are dimmed, like the ocean flow lines). */
  matchHue?: boolean;
  boost?: number;
  /** Part of the frame that is the map, as fractions [x0, y0, x1, y1]. Titles and color bars sit outside it. */
  area: [number, number, number, number];
  key: string; // keyboard number
}

export const RECORDS: RecordDef[] = [
  {
    id: 'ocean',
    name: 'Ocean',
    short: 'Ocean',
    side: 'earth',
    color: '#3fa3c9',
    svs: 3912,
    eicTitle: 'Global Sea Surface Currents and Temperature',
    period: 'Mar 2007 – Mar 2008',
    shows: 'Ocean surface currents, colored by water temperature from 0 °C (deep blue) to 32 °C (orange). We use calmer colors than the original rainbow so the land stays easy to see.',
    hear: 'A cello. Warmer water plays higher notes.',
    kind: 'movie',
    // From the SVS color bar: blue 0 C, green 10-20 C, yellow ~25 C, red 32 C.
    decode: { kind: 'colorbar', stops: [[20, 40, 160, 0], [30, 150, 90, 0.3], [140, 200, 60, 0.6], [250, 220, 40, 0.78], [220, 30, 20, 1]] },
    instrument: 'cello',
    voice: 'sustain',
    scale: { low: '0 °C', high: '32 °C', colors: ['#1d3557', '#2a6f97', '#61a5c2', '#d9cba0', '#cf9a68', '#b9745a'] },
    empty: 'nodata',
    keying: 'ocean', // re-colored from the rainbow to a calmer cold-to-warm palette
    keyingPlaceholder: 'ocean',
    masks: [[0, 0.895, 0.175, 1]], // color bar burned into the frame
    matchHue: true,
    area: [0, 0, 1, 1],
    key: '1',
  },
  {
    id: 'rain',
    name: 'Rain and clouds',
    short: 'Rain',
    side: 'earth',
    color: '#7aa8ff',
    svs: 5149,
    eicTitle: 'GEOS-FP Precipitation and Clouds',
    period: 'Recent days (NASA weather model)',
    shows: "Rain and snow over clouds, from NASA's GEOS-FP weather model: green is light rain, then blue, purple, red and yellow for very heavy rain. Thicker clouds are whiter.",
    hear: 'A flute for rain, more rain is more notes. A soft clarinet pad for clouds.',
    kind: 'movie',
    decode: { kind: 'precip' },
    instrument: 'flute',
    voice: 'drops',
    second: { instrument: 'clarinet', voice: 'sustain', label: 'clouds' },
    scale: { low: 'light rain', high: 'very heavy', colors: ['#22c55e', '#3b82f6', '#22d3ee', '#a855f7', '#991b1b', '#ef4444', '#f97316', '#facc15'] },
    empty: 'zero',
    keying: 'precip',
    masks: [[0, 0, 0.175, 0.078], [0, 0.895, 0.25, 1]], // NASA/GMAO logo and date stamp
    area: [0, 0, 1, 1],
    key: '2',
  },
  {
    id: 'lightning',
    name: 'Lightning',
    short: 'Lightning',
    side: 'earth',
    color: '#e8f0ff',
    svs: 5011,
    eicTitle: 'Lightning Events Detected from the International Space Station (ISS) 2017-2023',
    period: '2017 – 2023',
    shows: 'Lightning seen by a sensor on the International Space Station, which covers the Earth between about 55° north and south.',
    hear: 'A violin. Every flash is a sharp note.',
    kind: 'movie',
    decode: { kind: 'colorful' },
    instrument: 'violin',
    voice: 'strikes',
    scale: { low: 'none', high: 'many flashes', colors: ['#2a2a2a', '#8a7a20', '#ffe14d'] },
    empty: 'zero',
    keying: 'saturated', // yellow flashes over gray land
    keyingPlaceholder: 'bright',
    boost: 1.4,
    area: [0, 0, 1, 1],
    key: '3',
  },
  {
    id: 'lights',
    name: 'City lights',
    short: 'Lights',
    side: 'human',
    color: '#ffd27a',
    svs: 5475,
    eicTitle: 'Change in Night Lights between 2012 and 2023',
    period: '2012 – 2023',
    shows: 'Night lights seen from space each year, then the change: purple where there is more light, orange where there is less.',
    hear: 'A bright synth. Brighter places play more notes, and some drift off the key.',
    kind: 'movie',
    decode: { kind: 'bright', floor: 0.33 },
    instrument: 'synth1',
    voice: 'drops',
    scale: { low: 'dark', high: 'bright', colors: ['#1a1a1a', '#8a6a2a', '#ffe9a8'] },
    empty: 'zero',
    keying: 'bright',
    masks: [[0, 0.486, 1, 0.524]], // year labels across the middle of the frame
    boost: 1.2,
    area: [0, 0, 1, 1],
    key: '4',
  },
  {
    id: 'co2',
    name: 'Carbon emissions',
    short: 'CO₂',
    side: 'human',
    color: '#ff9a3c',
    svs: 5121,
    eicTitle: 'ODIAC: a map of human made carbon dioxide emissions',
    period: 'December 2021',
    shows: 'Carbon dioxide released by people, mostly from burning fossil fuels, in December 2021 (ODIAC).',
    hear: 'A deep synth drone. More emissions make it thicker and louder, and it grinds against the Earth.',
    kind: 'still',
    decode: { kind: 'bright', floor: 0.12 },
    instrument: 'synth2',
    voice: 'drone',
    scale: { low: 'low', high: 'high', colors: ['#2b0a00', '#b33a00', '#ff7a1a', '#fff2a0'] },
    empty: 'zero',
    keying: 'bright',
    area: [0, 0, 1, 1],
    key: '5',
  },
  {
    id: 'nox',
    name: 'Traffic and industry (NOx)',
    short: 'NOx',
    side: 'human',
    color: '#f0642c',
    svs: 5154,
    eicTitle: 'Nitrogen Oxides (NOx)',
    period: 'Recent days (NASA air-quality model)',
    shows: 'Nitrogen oxides near the ground, from traffic, industry and power plants (NASA GEOS-CF model). Shown here as dark smog: darker is more pollution.',
    hear: 'A gritty synth. More pollution is louder and rougher.',
    kind: 'movie',
    decode: { kind: 'warm' },
    tint: 'green',
    contrast: [0.6, 0.95],
    instrument: 'synth3',
    voice: 'sustain',
    scale: { low: 'clean', high: 'polluted', colors: ['rgba(107,94,84,0)', '#6b5e54', '#1c1714'], lightBar: true },
    empty: 'zero',
    keying: 'darkgreen',
    keyingPlaceholder: 'warm',
    masks: [[0, 0, 0.175, 0.078], [0, 0.895, 0.25, 1]], // NASA/GMAO logo and date stamp
    area: [0, 0, 1, 1],
    key: '6',
  },
];

export const RECORD_BY_ID = Object.fromEntries(RECORDS.map((r) => [r.id, r])) as Record<RecordId, RecordDef>;

/** The base note each recording was played at (measured from the team's WAV files). */
export const INSTRUMENT_NOTES: Record<InstrumentId, string> = {
  cello: 'A2', clarinet: 'E5', flute: 'B4', oboe: 'A4', synth1: 'C#4', synth2: 'A1', synth3: 'A2', viola: 'C#4', violin: 'E5', all: 'A3',
};

export const INSTRUMENT_NAMES: Record<InstrumentId, string> = {
  cello: 'Cello', clarinet: 'Clarinet', flute: 'Flute', oboe: 'Oboe', synth1: 'Synth pad', synth2: 'Deep synth', synth3: 'Synth drone', viola: 'Viola', violin: 'Violin', all: 'Full band',
};

export const BPM = 80;
/** Both sides: A, B, C# and E, the four notes that carry 96% of the team's arrangement (all.mp3). */
export const EARTH_SCALE = ['A', 'B', 'C#', 'E'];
/** The out-of-key notes humanity very rarely bends to, mildest and most common first (G and C are blue notes). */
export const HUMAN_SCALE = ['G', 'C', 'F', 'A#', 'D#'];
