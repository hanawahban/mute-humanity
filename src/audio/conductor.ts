// The conductor turns what's in the EIC frames into notes, on a 16th-note grid at 80 BPM so
// everything stays musical. Three ways to listen:
//
//   Listen  what's on screen: each record's average, peak and spread in the view drive its
//           instrument while its video plays through its own time period.
//   Scan    the videos pause and a needle sweeps the view left to right in one bar. Every bright
//           point it crosses plays a note: higher on screen = higher pitch, stronger = louder,
//           left/right = stereo.
//   Probe   the value under the probe (mouse, arrow keys, controller stick) plays on every beat.
//
// Earth records use A major pentatonic (the key of the team's recordings); humanity records
// use notes that clash with it.

import * as Tone from 'tone';
import { RECORDS, RECORD_BY_ID, type RecordDef, type RecordId } from '../config/records';
import { audible, getState, setState, type Level } from '../state/store';
import { columnPeaks, layers, sample, valueAt, viewStats } from '../eic/layers';
import { viewBounds, latLonToScreen } from '../map/camera';
import { play, setGain, setSpace, type VoiceKey } from './engine';
import { hapticTick } from '../input/haptics';
import { describeNow } from '../state/actions';

const EARTH = [0, 2, 4, 7, 9]; // A B C# E F#
const HUMAN = [1, 6, 8, 10]; // A# D# F G: out of key

/** Lowest note (MIDI) and how many scale steps each instrument uses, kept near its recorded pitch. */
const RANGE: Record<RecordId, { root: number; steps: number; from?: number }> = {
  ocean: { root: 45, steps: 10 }, // cello, A2 up two octaves
  rain: { root: 69, steps: 8 }, // flute, around A4-A5
  lightning: { root: 69, steps: 8, from: 3 }, // violin, from E5
  lights: { root: 69, steps: 6 }, // clarinet
  co2: { root: 33, steps: 3, from: 2 }, // synth drone, low
  nox: { root: 69, steps: 6 }, // oboe
};
const BASE_GAIN: Record<RecordId, number> = { ocean: 0.75, rain: 0.6, lightning: 0.55, lights: 0.5, co2: 0.8, nox: 0.6 };
const CLOUD_GAIN = 0.35;

function noteOf(rec: RecordDef, degree: number): string {
  const { root, steps, from = 0 } = RANGE[rec.id];
  const scale = rec.side === 'earth' ? EARTH : HUMAN;
  const d = Math.max(0, Math.min(steps - 1, Math.round(degree))) + from;
  const midi = root + 12 * Math.floor(d / scale.length) + scale[d % scale.length];
  return Tone.Frequency(midi, 'midi').toNote();
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
let stats: Partial<Record<RecordId, ReturnType<typeof viewStats>>> = {};
let step = 0;
let lastCaption = 0;
let lastProgress = 0;

/**
 * One loudness number per record. Dense layers (the ocean covers everything) use the average.
 * Sparse layers (cities, storms, pollution) are mostly empty, so they use how strong their
 * hotspots are and how much of the view they cover.
 */
function levelFrom(rec: RecordDef, s: ReturnType<typeof viewStats>) {
  if (rec.empty === 'nodata') return clamp01(0.7 * s.mean + 0.2 * s.peak + 0.2 * s.coverage);
  return clamp01(0.5 * s.hot + 0.5 * Math.sqrt(s.coverage / 0.06));
}
/** Which note (0-1 up the scale): warmer water, or stronger hotspots, play higher. */
function pitchFrom(rec: RecordDef, s: ReturnType<typeof viewStats>) {
  return rec.empty === 'nodata' ? clamp01(0.7 * s.mean + 0.3 * s.peak) : clamp01(s.hot);
}

/** Every 100 ms: read frames, update levels, play/pause videos, gains, vibration, captions. */
function analyse() {
  const s = getState();
  const now = performance.now();
  const ids = audible(s);
  const b = viewBounds();
  const levels: Partial<Record<RecordId, Level>> = {};
  const probeValues: Partial<Record<RecordId, number | null>> = {};
  stats = {};

  for (const rec of RECORDS) {
    const layer = layers.get(rec.id);
    const v = layer?.el instanceof HTMLVideoElement ? layer.el : null;
    const shouldPlay = s.audioOn && s.playing[rec.id] && s.mode !== 'scan';
    if (v && shouldPlay && v.paused) void v.play().catch(() => undefined);
    if (v && !shouldPlay && !v.paused) v.pause();

    const on = ids.includes(rec.id);
    const scale = rec.side === 'human' ? s.humanity : 1;
    setGain(rec.id, on ? BASE_GAIN[rec.id] * scale : 0);
    if (rec.second) setGain(`${rec.id}:2`, on ? CLOUD_GAIN * scale : 0);
    if (!on) continue;

    const l = sample(rec.id);
    if (!l) continue;
    const st = viewStats(l.grid, b, l.second);
    stats[rec.id] = st;
    let raw = levelFrom(rec, st);
    if (s.mode === 'probe') {
      const pv = valueAt(l.grid, s.probe.lat, s.probe.lon);
      probeValues[rec.id] = pv;
      raw = pv ?? 0;
    }
    levels[rec.id] = { raw, value: raw * scale, coverage: st.coverage, second: st.second };
  }
  setState({ levels, probeValues });
  hapticTick(levels, now);

  if (now - lastProgress > 500) {
    lastProgress = now;
    const progress: Partial<Record<RecordId, number>> = {};
    for (const [id, l] of layers) if (l.el instanceof HTMLVideoElement && l.el.duration) progress[id] = l.el.currentTime / l.el.duration;
    setState({ progress });
  }
  if (now - lastCaption > 1500 && !s.story.running) {
    lastCaption = now;
    setState({ caption: describeNow() });
  }
}

// ---------- scan needle and note flashes (read by the map every animation frame) ----------
let barStart = 0; // audio time when the current scan bar started
const BAR = () => Tone.Time('1m').toSeconds();
const SIXTEENTH = () => Tone.Time('16n').toSeconds();

/** Where the needle is right now, 0-1 across the view (smooth, from the audio clock). */
export function scanNeedle(): number | null {
  if (getState().mode !== 'scan' || !barStart) return null;
  const x = (Tone.getContext().currentTime - barStart) / BAR();
  return x < 0 ? x + 1 : x > 1 ? x - 1 : x;
}

export interface Hit {
  x: number; // 0-1 across the view
  y: number; // 0-1 down the view
  colour: string;
  v: number;
  at: number; // audio time the note sounds
}
/** Notes the needle has triggered, for the flashes on the map. */
export const hits: Hit[] = [];
export const audioNow = () => Tone.getContext().currentTime;

/** Every 16th note: decide what to play. */
function tick(time: number) {
  const s = getState();
  const ids = audible(s);
  const st = step++ % 16;
  const b = viewBounds();

  if (s.mode === 'scan') {
    if (st === 0) barStart = time;
    else if (!barStart) barStart = time - st * SIXTEENTH();
    const x0 = st / 16;
    const sixteenth = SIXTEENTH();
    // Columns the needle crosses during this 16th; each strong point plays exactly when the needle reaches it.
    const cols = Math.max(1, Math.round((b.lonSpan * 2) / 16)); // grid columns crossed in one 16th (half-degree grid)
    for (const id of ids) {
      const rec = RECORD_BY_ID[id];
      const l = layers.get(id);
      if (!l?.ready) continue;
      const found: Array<{ x: number; y: number; v: number }> = [];
      for (let c = 0; c < cols; c++) {
        const x = x0 + (c + 0.5) / cols / 16;
        for (const p of columnPeaks(l.grid, b.west + x * b.lonSpan, b, 2)) found.push({ x, y: p.y, v: p.v });
      }
      // the ocean fills the whole map, so it plays one note every 8th; sparse layers play what they have
      if (rec.empty === 'nodata' && st % 2 === 1) continue;
      const max = rec.empty === 'nodata' || rec.voice === 'drone' ? 1 : rec.voice === 'strikes' ? 3 : 2;
      const { steps } = RANGE[id];
      const humanScale = rec.side === 'human' ? s.humanity : 1;
      for (const p of found.sort((a, c) => c.v - a.v).slice(0, max)) {
        const at = time + (p.x - x0) * 16 * sixteenth;
        const dur = rec.voice === 'strikes' ? 0.2 : rec.voice === 'drone' ? '4n' : '8n';
        play(id, noteOf(rec, (1 - p.y) * (steps - 1)), dur, at, 0.3 + 0.7 * p.v, p.x * 2 - 1);
        if (humanScale > 0.05) hits.push({ x: p.x, y: p.y, colour: rec.colour, v: p.v * humanScale, at });
      }
      if (rec.second && l.second && st % 4 === 0) {
        const clouds = columnPeaks(l.second, b.west + (x0 + 1 / 32) * b.lonSpan, b, 1)[0];
        if (clouds) play(`${id}:2` as VoiceKey, noteOf(rec, (1 - clouds.y) * 4), '2n', time, 0.2 + 0.5 * clouds.v, x0 * 2 - 1);
      }
    }
    while (hits.length > 160) hits.shift();
    bed(time, st, ids, s.humanity);
    return;
  }
  barStart = 0;
  if (s.scanX != null) Tone.getDraw().schedule(() => setState({ scanX: null }), time);
  bed(time, st, ids, s.humanity);

  if (s.mode === 'probe') {
    if (st % 4 !== 0) return;
    const p = latLonToScreen(s.probe.lat, s.probe.lon);
    const pan = Math.max(-1, Math.min(1, (p.x / Math.max(1, window.innerWidth)) * 2 - 1));
    for (const id of ids) {
      const v = s.probeValues[id];
      if (v == null || v < 0.03) continue;
      const rec = RECORD_BY_ID[id];
      play(id, noteOf(rec, v * (RANGE[id].steps - 1)), rec.voice === 'strikes' ? 0.15 : '4n', time, 0.3 + 0.6 * v, pan);
    }
    return;
  }

  // Listen
  for (const id of ids) {
    const rec = RECORD_BY_ID[id];
    const sst = stats[id];
    if (!sst) continue;
    const level = levelFrom(rec, sst);
    const { steps } = RANGE[id];
    const pitch = pitchFrom(rec, sst) * (steps - 1);
    switch (rec.voice) {
      case 'sustain':
        if (st % 8 === 0 && level > 0.03) play(id, noteOf(rec, pitch), '2n', time, 0.35 + 0.55 * level, sst.pan * 0.6);
        break;
      case 'drops':
        if (Math.random() < level * 0.85) {
          const deg = pitch + (Math.random() - 0.3) * 3;
          play(id, noteOf(rec, deg), '8n', time, 0.25 + 0.5 * Math.random() * (0.4 + level), sst.pan * 0.5 + (Math.random() - 0.5) * 0.5);
        }
        break;
      case 'strikes':
        if (Math.random() < level * 0.6) {
          play(id, noteOf(rec, Math.random() * (steps - 1)), 0.15, time, 0.6 + 0.4 * Math.random(), sst.pan * 0.5 + (Math.random() - 0.5) * 0.6);
        }
        break;
      case 'drone':
        if (st === 0 && level > 0.02) {
          play(id, noteOf(rec, 0), '1m', time, 0.3 + 0.6 * level);
          if (level > 0.45) play(id, noteOf(rec, 1), '1m', time, 0.2 + 0.5 * level);
        }
        break;
    }
    if (rec.second && st === 0 && sst.second > 0.02) {
      const v = clamp01(sst.second * 3);
      play(`${id}:2` as VoiceKey, 'A3', '1m', time, 0.15 + 0.5 * v);
      play(`${id}:2` as VoiceKey, 'E4', '1m', time, 0.1 + 0.4 * v);
    }
  }
}

// ---------- the harmony bed ----------
// A slow chord progression in A major under the Earth records (viola chords, deep synth root),
// changing every two bars. It swells when humanity is muted: the planet opens up.
const CHORDS: Array<{ root: string; notes: string[] }> = [
  { root: 'A1', notes: ['A3', 'C#4', 'E4'] },
  { root: 'F#1', notes: ['F#3', 'A3', 'C#4'] },
  { root: 'D2', notes: ['D3', 'F#3', 'A3'] },
  { root: 'E2', notes: ['E3', 'G#3', 'B3'] },
];
let barCount = 0;
function bed(time: number, st: number, ids: RecordId[], humanity: number) {
  if (st !== 0) return;
  const bar = barCount++;
  const earth = ids.filter((id) => RECORD_BY_ID[id].side === 'earth').length;
  const gain = earth ? 0.18 + 0.05 * earth + 0.3 * (1 - humanity) : 0;
  setGain('bed', gain, time);
  setGain('sub', earth ? 0.3 + 0.35 * (1 - humanity) : 0, time);
  setSpace(1 - humanity, time);
  if (!earth || bar % 2 !== 0) return;
  const chord = CHORDS[(bar / 2) % CHORDS.length];
  for (const n of chord.notes) play('bed', n, '2m', time, 0.35);
  play('sub', chord.root, '2m', time, 0.5);
}

let startedConductor = false;
export function startConductor() {
  if (startedConductor) return;
  startedConductor = true;
  window.setInterval(analyse, 100);
  new Tone.Loop((time) => tick(time), '16n').start(0);
}

export const debugClock = () => ({ bar: BAR(), sixteenth: SIXTEENTH(), barStart, now: Tone.getContext().currentTime, bpm: Tone.getTransport().bpm.value });
