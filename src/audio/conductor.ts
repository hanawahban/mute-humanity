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
import { play, setGain, type VoiceKey } from './engine';
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

/** Every 16th note: decide what to play. */
function tick(time: number) {
  const s = getState();
  const ids = audible(s);
  const st = step++ % 16;
  const b = viewBounds();

  if (s.mode === 'scan') {
    const x = (st + 0.5) / 16;
    Tone.getDraw().schedule(() => setState({ scanX: x }), time);
    const lon = b.west + x * b.lonSpan;
    for (const id of ids) {
      const rec = RECORD_BY_ID[id];
      const l = layers.get(id);
      if (!l?.ready) continue;
      const peaks = columnPeaks(l.grid, lon, b, rec.voice === 'drone' ? 1 : 2);
      const { steps } = RANGE[id];
      for (const p of peaks) {
        const dur = rec.voice === 'strikes' ? 0.15 : rec.voice === 'drone' ? '4n' : '8n';
        play(id, noteOf(rec, (1 - p.y) * (steps - 1)), dur, time, 0.3 + 0.7 * p.v, x * 2 - 1);
      }
      if (rec.second && l.second && st % 4 === 0) {
        const clouds = columnPeaks(l.second, lon, b, 1)[0];
        if (clouds) play(`${id}:2` as VoiceKey, noteOf(rec, (1 - clouds.y) * 4), '2n', time, 0.2 + 0.5 * clouds.v, x * 2 - 1);
      }
    }
    return;
  }
  if (s.scanX != null) Tone.getDraw().schedule(() => setState({ scanX: null }), time);

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

let startedConductor = false;
export function startConductor() {
  if (startedConductor) return;
  startedConductor = true;
  window.setInterval(analyse, 100);
  new Tone.Loop((time) => tick(time), '16n').start(0);
}
