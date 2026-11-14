// The six records. Each one is a NASA Earth Information Center (EIC) visualization that is a
// flat map of the whole Earth, so they all line up on one shared map. Earth records play in
// tune (A major pentatonic, the key of the team's instruments); humanity records play out of
// key. Each record keeps its own time period: they line up in place, not in date.

export type RecordId = 'ocean' | 'rain' | 'lightning' | 'lights' | 'co2' | 'nox';
export type Side = 'earth' | 'human';
export type InstrumentId = 'cello' | 'clarinet' | 'flute' | 'oboe' | 'synth1' | 'synth2' | 'synth3' | 'viola' | 'violin' | 'all';

/** How a pixel's colour becomes a 0-1 value. */
export type Decode =
  | { kind: 'colorbar'; stops: Array<[r: number, g: number, b: number, v: number]>; maxDistance?: number }
  | { kind: 'bright'; floor: number } // brightness above a dark background
  | { kind: 'warm' } // warm-coloured data (yellow to red) drawn over a natural-colour base map
  | { kind: 'precip' }; // white clouds + coloured rain

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
  colour: string; // record label colour in the dock
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
  /** Pixels that don't match the colour key: "nodata" (land under the ocean layer) or "zero" (no pollution, no rain). */
  empty: 'nodata' | 'zero';
  /** Part of the frame that is the map, as fractions [x0, y0, x1, y1]. Titles and colour bars sit outside it. */
  area: [number, number, number, number];
  key: string; // keyboard number
}

export const RECORDS: RecordDef[] = [
  {
    id: 'ocean',
    name: 'Ocean',
    short: 'Ocean',
    side: 'earth',
    colour: '#3fa3c9',
    svs: 3912,
    eicTitle: 'Global Sea Surface Currents and Temperature',
    period: 'Mar 2007 – Mar 2008',
    shows: 'Ocean surface currents, coloured by water temperature: blue is 0 °C, green 10 to 20 °C, yellow about 25 °C and red 32 °C.',
    hear: 'A cello. Warmer water plays higher notes.',
    kind: 'movie',
    // From the SVS colour bar: blue 0 C, green 10-20 C, yellow ~25 C, red 32 C.
    decode: { kind: 'colorbar', stops: [[20, 40, 160, 0], [30, 150, 90, 0.3], [140, 200, 60, 0.6], [250, 220, 40, 0.78], [220, 30, 20, 1]] },
    instrument: 'cello',
    voice: 'sustain',
    empty: 'nodata',
    area: [0, 0, 1, 1],
    key: '1',
  },
  {
    id: 'rain',
    name: 'Rain and clouds',
    short: 'Rain',
    side: 'earth',
    colour: '#7aa8ff',
    svs: 5149,
    eicTitle: 'GEOS-FP Precipitation and Clouds',
    period: 'Recent days (NASA weather model)',
    shows: "Rain and snow over clouds, from NASA's GEOS-FP weather model. Thicker clouds are whiter.",
    hear: 'A flute for rain, more rain is more notes. A soft synth pad for clouds.',
    kind: 'movie',
    decode: { kind: 'precip' },
    instrument: 'flute',
    voice: 'drops',
    second: { instrument: 'synth1', voice: 'sustain', label: 'clouds' },
    empty: 'zero',
    area: [0, 0, 1, 1],
    key: '2',
  },
  {
    id: 'lightning',
    name: 'Lightning',
    short: 'Lightning',
    side: 'earth',
    colour: '#e8f0ff',
    svs: 5011,
    eicTitle: 'Lightning Events Detected from the International Space Station (ISS) 2017-2023',
    period: '2017 – 2023',
    shows: 'Lightning seen by a sensor on the International Space Station, which covers the Earth between about 55° north and south.',
    hear: 'A violin. Every flash is a sharp note.',
    kind: 'movie',
    decode: { kind: 'bright', floor: 0.45 },
    instrument: 'violin',
    voice: 'strikes',
    empty: 'zero',
    area: [0, 0, 1, 1],
    key: '3',
  },
  {
    id: 'lights',
    name: 'City lights',
    short: 'Lights',
    side: 'human',
    colour: '#ffd27a',
    svs: 5475,
    eicTitle: 'Change in Night Lights between 2012 and 2023',
    period: '2012 – 2023',
    shows: 'Night lights seen from space each year, then the change: purple where there is more light, orange where there is less.',
    hear: 'A clarinet, out of key. Brighter places play more notes.',
    kind: 'movie',
    decode: { kind: 'bright', floor: 0.12 },
    instrument: 'clarinet',
    voice: 'drops',
    empty: 'zero',
    area: [0, 0, 1, 1],
    key: '4',
  },
  {
    id: 'co2',
    name: 'Carbon emissions',
    short: 'CO₂',
    side: 'human',
    colour: '#ff9a3c',
    svs: 5121,
    eicTitle: 'ODIAC: a map of human made carbon dioxide emissions',
    period: 'December 2021',
    shows: 'Carbon dioxide released by people, mostly from burning fossil fuels, in December 2021 (ODIAC).',
    hear: 'A low synth drone, out of key. More emissions make it thicker and louder.',
    kind: 'still',
    decode: { kind: 'bright', floor: 0.12 },
    instrument: 'synth3',
    voice: 'drone',
    empty: 'zero',
    area: [0, 0, 1, 1],
    key: '5',
  },
  {
    id: 'nox',
    name: 'Traffic and industry (NOx)',
    short: 'NOx',
    side: 'human',
    colour: '#f0642c',
    svs: 5154,
    eicTitle: 'Nitrogen Oxides (NOx)',
    period: 'Recent days (NASA air-quality model)',
    shows: 'Nitrogen oxides near the ground, from traffic, industry and power plants, from NASA’s GEOS-CF model.',
    hear: 'An oboe, out of key. More pollution is louder and harsher.',
    kind: 'movie',
    decode: { kind: 'warm' },
    instrument: 'oboe',
    voice: 'sustain',
    empty: 'zero',
    area: [0, 0, 1, 1],
    key: '6',
  },
];

export const RECORD_BY_ID = Object.fromEntries(RECORDS.map((r) => [r.id, r])) as Record<RecordId, RecordDef>;

/** The base note each recording was played at (measured from the team's WAV files). */
export const INSTRUMENT_NOTES: Record<InstrumentId, string> = {
  cello: 'A2', clarinet: 'E5', flute: 'B4', oboe: 'A4', synth1: 'C#4', synth2: 'A1', synth3: 'A2', viola: 'C#4', violin: 'E5', all: 'A3',
};

export const BPM = 80;
/** Earth: A major pentatonic, the key the instruments were recorded in. */
export const EARTH_SCALE = ['A', 'B', 'C#', 'E', 'F#'];
/** Humanity: notes that clash with A major. */
export const HUMAN_SCALE = ['A#', 'D#', 'F', 'G'];
