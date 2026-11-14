import { create } from 'zustand';
import { RECORDS, type RecordId } from '../config/records';

export interface Focus {
  lat: number;
  lon: number;
  zoom: number; // 1 = whole planet
}

export type Mode = 'listen' | 'scan' | 'probe';

/** What a record is "saying" right now, for meters, captions and vibration. */
export interface Level {
  value: number; // 0-1 after the humanity lever (human records)
  raw: number; // 0-1 before the lever
  coverage: number; // share of the view with something in it
  second?: number; // the second part (clouds), 0-1
}

export type SourceStatus = 'loading' | 'real' | 'placeholder' | 'missing';

export interface Settings {
  highContrast: boolean;
  reducedMotion: boolean;
  vibration: number; // 0-1
  captions: boolean;
  narrate: boolean; // speak the story aloud
}

export interface AppState {
  audioOn: boolean;
  playing: Record<RecordId, boolean>;
  order: RecordId[]; // records in the order they were turned on (last = on top of the map)
  selected: RecordId; // under the keyboard/controller cursor, and what the controller feels
  solo: RecordId | null;
  mode: Mode;
  humanity: number; // 0-1
  lastHumanity: number;
  focus: Focus;
  probe: { lat: number; lon: number };
  scanX: number | null; // 0-1 across the view while the needle runs
  levels: Partial<Record<RecordId, Level>>;
  probeValues: Partial<Record<RecordId, number | null>>;
  sources: Record<RecordId, SourceStatus>;
  progress: Partial<Record<RecordId, number>>; // 0-1 through each record's own time period
  story: { running: boolean; step: number };
  caption: string;
  announcement: string;
  listening: boolean;
  settings: Settings;
  controller: string | null;
  helpOpen: boolean;
}

const each = <T,>(v: T) => Object.fromEntries(RECORDS.map((r) => [r.id, v])) as Record<RecordId, T>;

export const useStore = create<AppState>(() => ({
  audioOn: false,
  playing: each(false),
  order: [],
  selected: 'ocean',
  solo: null,
  mode: 'listen',
  humanity: 1,
  lastHumanity: 1,
  focus: { lat: 15, lon: 20, zoom: 1 },
  probe: { lat: 26, lon: 50.5 },
  scanX: null,
  levels: {},
  probeValues: {},
  sources: each<SourceStatus>('loading'),
  progress: {},
  story: { running: false, step: 0 },
  caption: '',
  announcement: '',
  listening: false,
  settings: {
    highContrast: false,
    reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    vibration: 0.8,
    captions: true,
    narrate: true,
  },
  controller: null,
  helpOpen: false,
}));

export const getState = useStore.getState;
export const setState = useStore.setState;

/** Records you can hear: playing, and the solo one if solo is on. */
export function audible(s: AppState = getState()): RecordId[] {
  if (s.solo) return s.playing[s.solo] ? [s.solo] : [];
  return RECORDS.filter((r) => s.playing[r.id]).map((r) => r.id);
}

/** Records drawn on the map: all audible ones (the shader makes every layer's background transparent). */
export function visible(s: AppState = getState()): RecordId[] {
  return audible(s);
}
