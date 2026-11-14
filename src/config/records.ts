export type RecordId = 'ocean' | 'plants' | 'rain' | 'no2' | 'fires' | 'plastic';
export type Side = 'earth' | 'human';

export interface RecordDef {
  id: RecordId;
  name: string;
  side: Side;
  layer: string; // data layer id in index.json
  colour: string; // the record label; matches its map colours
  instrument: string; // spoken and captioned
  motor: 'strong' | 'weak'; // controller motor
  eic: { title: string; svsId: number; clip: string; note?: string };
}

export const RECORDS: RecordDef[] = [
  {
    id: 'ocean', name: 'Ocean', side: 'earth', layer: 'ocean', colour: '#3fa3c9',
    instrument: 'ocean strings', motor: 'strong',
    eic: { title: 'Sea Surface Currents and Temperature', svsId: 3912, clip: '/eic/ocean/clip.mp4' },
  },
  {
    id: 'plants', name: 'Plants', side: 'earth', layer: 'plants', colour: '#6fb23f',
    instrument: 'plant choir', motor: 'strong',
    eic: { title: 'GEDI Forest Height', svsId: 4950, clip: '/eic/plants/clip.mp4', note: 'Related: forest height, not greenness' },
  },
  {
    id: 'rain', name: 'Rain', side: 'earth', layer: 'rain', colour: '#6a8cf5',
    instrument: 'rain piano', motor: 'weak',
    eic: { title: 'A 3D View of an Atmospheric River', svsId: 4960, clip: '/eic/rain/clip.mp4', note: 'Related: moisture, not rainfall' },
  },
  {
    id: 'no2', name: 'NO2', side: 'human', layer: 'no2', colour: '#f0642c',
    instrument: 'NO2 drone', motor: 'strong',
    eic: { title: 'Air Quality Model Runs', svsId: 5533, clip: '/eic/no2/clip.mp4' },
  },
  {
    id: 'fires', name: 'Fires', side: 'human', layer: 'fires', colour: '#ffb020',
    instrument: 'fire crackle', motor: 'weak',
    eic: { title: 'GEOS Aerosols', svsId: 5669, clip: '/eic/fires/clip.mp4' },
  },
  {
    id: 'plastic', name: 'Ocean plastic', side: 'human', layer: 'plastic', colour: '#d8f3ff',
    instrument: 'plastic clicks', motor: 'weak',
    eic: { title: 'Perpetual Ocean 2', svsId: 5425, clip: '/eic/plastic/clip.mp4', note: 'The currents that gather plastic, not plastic itself' },
  },
];

export const RECORD_BY_ID = Object.fromEntries(RECORDS.map((r) => [r.id, r])) as Record<RecordId, RecordDef>;

export const YEAR_MIN = 1950;
export const YEAR_MAX = 2026;
export const FEATURED_YEAR = 2019;

// Music
export const BPM = 80;
export const SCALE = ['D', 'E', 'F#', 'A', 'B']; // D major pentatonic: Earth plays in tune
export const OUT_OF_KEY = 'G#1'; // tritone below the key: humanity's drone
