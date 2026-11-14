import { create } from 'zustand';
import { FEATURED_YEAR, RECORDS, type RecordId } from '../config/records';
import type { LoadedData } from '../data/loader';

export interface MixEntry {
  value: number; // 0-1, what drives the instrument (already scaled by humanity for human records)
  raw: number; // 0-1, before humanity
  peak: number; // strongest cell in the listening area
}

export interface Focus {
  lat: number;
  lon: number;
  zoom: number; // 1 = whole planet
}

export interface Settings {
  highContrast: boolean;
  reducedMotion: boolean;
  vibration: number; // 0-1
  mono: boolean;
}

export interface AppState {
  data: LoadedData | null;
  loadError: string | null;
  audioOn: boolean;

  playing: Record<RecordId, boolean>;
  sideA: RecordId | null; // the record currently showing its EIC side
  selected: RecordId; // record under the keyboard/controller cursor

  year: number; // fractional while dragging
  dragging: boolean;
  month: number | null; // 0-11 when the year loop is running, null for yearly values
  autoplay: boolean;

  humanity: number; // 0-1
  lastHumanity: number;

  focus: Focus;
  mix: Partial<Record<RecordId, MixEntry | null>>;
  sideAValue: Partial<Record<RecordId, number>>;

  caption: string;
  announcement: string;
  listening: boolean;
  settings: Settings;
}

const allOff = Object.fromEntries(RECORDS.map((r) => [r.id, false])) as Record<RecordId, boolean>;

export const useStore = create<AppState>(() => ({
  data: null,
  loadError: null,
  audioOn: false,

  playing: { ...allOff },
  sideA: null,
  selected: 'ocean',

  year: FEATURED_YEAR,
  dragging: false,
  month: null,
  autoplay: false,

  humanity: 1,
  lastHumanity: 1,

  focus: { lat: 10, lon: 0, zoom: 1 },
  mix: {},
  sideAValue: {},

  caption: '',
  announcement: '',
  listening: false,
  settings: { highContrast: false, reducedMotion: false, vibration: 0.8, mono: false },
}));

export const getState = useStore.getState;
export const setState = useStore.setState;
