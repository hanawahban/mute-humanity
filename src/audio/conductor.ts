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
// Everything plays A, B, C# and E, leaning on A and E, over a held A: the sound of the team's
// full arrangement (all.mp3, measured in pipeline/audio_tools/analyze_all.py). Earth records
// use traditional instruments. Humanity records are the same notes on synths that now and then
// bend off the key and drift a few cents out of tune as the humanity lever goes up (harmony.ts).

import * as Tone from 'tone';
import { RECORDS, RECORD_BY_ID, type RecordDef, type RecordId } from '../config/records';
import { audible, getState, setState, type Level } from '../state/store';
import { columnPeaks, layers, sample, valueAt, viewStats } from '../eic/layers';
import { viewBounds, latLonToScreen } from '../map/camera';
import { outputLatency, play, previewNote, setGain, setSpace, type VoiceKey } from './engine';
import { bend, clamp01, detuneCents, dragSixteenths, settle } from './harmony';
import { hapticStep } from '../input/haptics';
import { describeNow } from '../state/actions';

const EARTH = [0, 2, 4, 7]; // A B C# E: the notes that carry 96% of all.mp3. Both sides start from these

/** Lowest note (MIDI) and how many scale steps each instrument uses, kept near its recorded pitch. */
const RANGE: Record<RecordId, { root: number; steps: number; from?: number }> = {
  ocean: { root: 45, steps: 8 }, // cello, A2 up two octaves
  rain: { root: 69, steps: 6 }, // flute, A4 to B5
  lightning: { root: 69, steps: 6, from: 3 }, // violin, from E5
  lights: { root: 69, steps: 5 }, // bright synth (synth1, recorded C#4), A4 to A5
  co2: { root: 33, steps: 4 }, // deep synth drone (synth2, recorded A1): the low A, and the E above it
  nox: { root: 45, steps: 6 }, // gritty synth (synth3, recorded A2), A2 to B3
};
// Levels matched to how loud each recording is on its own (the synths are quieter than the winds).
const BASE_GAIN: Record<RecordId, number> = { ocean: 0.75, rain: 0.6, lightning: 0.55, lights: 0.45, co2: 0.45, nox: 0.6 };
const CLOUD_GAIN = 0.35;
/** The story turns humanity up for one moment, so you feel how much it clashes. */
let humanBoost = 1;
export function setHumanBoost(v: number) {
  humanBoost = v;
}

/** How far humanity pulls the music off course: 0 = in tune, 1 = at its most disruptive. */
const humanTension = () => clamp01(getState().humanity * humanBoost);

/**
 * The note for a value. Both sides use A, B, C# and E and lean toward A and E, as the team's
 * arrangement (all.mp3) does. Human notes are then (live) now and then bent to one of the
 * arrangement's own out-of-key notes and detuned a few cents, in proportion to the humanity
 * lever. Not live = the clean note.
 */
function noteOf(rec: RecordDef, degree: number, live = true): string | number {
  const { root, steps, from = 0 } = RANGE[rec.id];
  const d = Math.max(0, Math.min(steps - 1, Math.round(degree))) + from;
  let midi = root + 12 * Math.floor(d / EARTH.length) + EARTH[d % EARTH.length];
  if (live) midi = settle(midi);
  if (rec.side === 'human' && live) {
    const t = humanTension();
    midi = bend(midi, t);
    const cents = detuneCents(t);
    if (cents) return Tone.Frequency(midi + cents / 100, 'midi').toFrequency(); // fractional MIDI = out of tune
  }
  return Tone.Frequency(midi, 'midi').toNote();
}

/** Human notes drag a little behind the beat as tension rises; Earth stays exactly on it. */
const late = (rec: RecordDef, time: number) => (rec.side === 'human' ? time + dragSixteenths(humanTension()) * SIXTEENTH() : time);

/** Every note a record can play, low to high (for the How it works view). */
export function notesFor(id: RecordId): string[] {
  const rec = RECORD_BY_ID[id];
  return Array.from({ length: RANGE[id].steps }, (_, i) => noteOf(rec, i, false) as string);
}
/** The note a value (0-1 along the color key) becomes. */
export function noteIndexFor(id: RecordId, v: number) {
  return Math.round(clamp01(v) * (RANGE[id].steps - 1));
}
/** Play that value's note on the record's instrument. */
export function previewValue(id: RecordId, v: number) {
  previewNote(id, notesFor(id)[noteIndexFor(id, v)], BASE_GAIN[id]);
}
let stats: Partial<Record<RecordId, ReturnType<typeof viewStats>>> = {};
let step = 0;
let lastCaption = 0;
let lastProgress = 0;
let lastRead = 0;

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
function analyze() {
  const s = getState();
  const now = performance.now();
  const ids = audible(s);
  const b = viewBounds();
  const levels: Partial<Record<RecordId, Level>> = {};
  const probeValues: Partial<Record<RecordId, number | null>> = {};
  stats = {};
  // Reading a video frame back from the GPU is the slowest thing we do, so only one layer is
  // read per tick (the one read longest ago); the others use their last reading. Stills are read once.
  // ...and at most four times a second: the maps change slowly, the main thread is precious.
  const due = now - lastRead < 250 ? undefined : ids
    .map((id) => layers.get(id))
    .filter((l) => l?.ready && (l.rec.kind === 'movie' || !l.sampledAt))
    .sort((a, c) => a!.sampledAt - c!.sampledAt)[0]?.rec.id;
  if (due) lastRead = now;

  for (const rec of RECORDS) {
    const layer = layers.get(rec.id);
    const v = layer?.el instanceof HTMLVideoElement ? layer.el : null;
    const shouldPlay = s.audioOn && s.screen === 'map' && !s.paused && s.playing[rec.id] && s.mode !== 'scan';
    if (v && shouldPlay && v.paused) void v.play().catch(() => undefined);
    if (v && !shouldPlay && !v.paused) v.pause();

    const on = ids.includes(rec.id);
    const scale = rec.side === 'human' ? s.humanity * humanBoost : 1;
    setGain(rec.id, on ? BASE_GAIN[rec.id] * scale : 0);
    if (rec.second) setGain(`${rec.id}:2`, on ? CLOUD_GAIN * scale : 0);
    if (!on) continue;

    const cached = layers.get(rec.id);
    const l = rec.id === due || !cached?.sampledAt ? sample(rec.id, 0) : cached;
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
const SIXTEENTH = () => Tone.Time('16n').toSeconds();

/** One sweep of the needle takes this many 16th notes: 48 = three bars, about 9 seconds. */
export const SWEEP = 48;
let scanStep = 0;

/** Where the needle is right now, 0-1 across the view: smooth, from the audio clock, and lined up with what you hear. */
export function scanNeedle(): number | null {
  if (getState().mode !== 'scan' || !barStart) return null;
  const x = (audioNow() - barStart) / (SWEEP * SIXTEENTH());
  return x < 0 ? x + 1 : x > 1 ? x - 1 : x;
}

export interface Hit {
  x: number; // 0-1 across the view
  y: number; // 0-1 down the view
  color: string;
  v: number;
  at: number; // audio time the note sounds
}
/** Notes the needle has triggered, for the flashes on the map. */
export const hits: Hit[] = [];
export const audioNow = () => Tone.getContext().currentTime - outputLatency();

/** Every 16th note: decide what to play. */
function tick(time: number) {
  const s = getState();
  if (s.screen !== 'map' || s.paused) return; // the jukebox screen, or paused: silence
  const ids = audible(s);
  const st = step++ % 16;
  hapticStep(st, time); // the beat-locked vibration pattern, on the same clock as the notes
  const b = viewBounds();

  if (s.mode === 'scan') {
    if (!barStart) scanStep = 0;
    const ss = scanStep++ % SWEEP;
    if (ss === 0) barStart = time; // start of this sweep
    const x0 = ss / SWEEP;
    const sixteenth = SIXTEENTH();
    // Columns the needle crosses during this 16th; each strong point plays exactly when the needle reaches it.
    const cols = Math.max(1, Math.round((b.lonSpan * 2) / SWEEP)); // grid columns crossed in one 16th (half-degree grid)
    for (const id of ids) {
      const rec = RECORD_BY_ID[id];
      const l = layers.get(id);
      if (!l?.ready) continue;
      const found: Array<{ x: number; y: number; v: number }> = [];
      for (let c = 0; c < cols; c++) {
        const x = x0 + (c + 0.5) / cols / SWEEP;
        for (const p of columnPeaks(l.grid, b.west + x * b.lonSpan, b, 2)) found.push({ x, y: p.y, v: p.v });
      }
      // the ocean fills the whole map, so it plays one note every 8th; sparse layers play what they have
      if (rec.empty === 'nodata' && ss % 2 === 1) continue;
      const max = rec.empty === 'nodata' || rec.voice === 'drone' ? 1 : rec.voice === 'strikes' ? 3 : 2;
      const { steps } = RANGE[id];
      const humanScale = rec.side === 'human' ? s.humanity : 1;
      for (const p of found.sort((a, c) => c.v - a.v).slice(0, max)) {
        const at = time + (p.x - x0) * SWEEP * sixteenth;
        const dur = rec.voice === 'strikes' ? 0.2 : rec.voice === 'drone' ? '4n' : '8n';
        play(id, noteOf(rec, (1 - p.y) * (steps - 1)), dur, at, 0.3 + 0.7 * p.v, p.x * 2 - 1);
        if (humanScale > 0.05) hits.push({ x: p.x, y: p.y, color: rec.color, v: p.v * humanScale, at });
      }
      if (rec.second && l.second && ss % 4 === 0) {
        const clouds = columnPeaks(l.second, b.west + (x0 + 0.5 / SWEEP) * b.lonSpan, b, 1)[0];
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
      play(id, noteOf(rec, v * (RANGE[id].steps - 1)), rec.voice === 'strikes' ? 0.15 : '4n', late(rec, time), 0.3 + 0.6 * v, pan);
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
        if (st % 8 === 0 && level > 0.03) play(id, noteOf(rec, pitch), '2n', late(rec, time), 0.35 + 0.55 * level, sst.pan * 0.6);
        break;
      case 'drops':
        if (Math.random() < level * 0.85) {
          const deg = pitch + (Math.random() - 0.3) * 3;
          play(id, noteOf(rec, deg), '8n', late(rec, time), 0.25 + 0.5 * Math.random() * (0.4 + level), sst.pan * 0.5 + (Math.random() - 0.5) * 0.5);
        }
        break;
      case 'strikes':
        if (Math.random() < level * 0.6) {
          play(id, noteOf(rec, Math.random() * (steps - 1)), 0.15, late(rec, time), 0.6 + 0.4 * Math.random(), sst.pan * 0.5 + (Math.random() - 0.5) * 0.6);
        }
        break;
      case 'drone':
        if (st === 0 && level > 0.02) {
          play(id, noteOf(rec, 0), '1m', late(rec, time), 0.3 + 0.6 * level); // the low A
          if (level > 0.45) play(id, noteOf(rec, steps - 1), '1m', late(rec, time), 0.2 + 0.5 * level); // and the E above it: an open fifth
        }
        break;
    }
    if (rec.second && st === 0 && sst.second > 0.02) {
      const v = clamp01(sst.second * 3);
      play(`${id}:2` as VoiceKey, 'A4', '1m', time, 0.15 + 0.5 * v);
      play(`${id}:2` as VoiceKey, 'E5', '1m', time, 0.1 + 0.4 * v);
    }
  }
}

// ---------- the harmony bed ----------
// The team's full arrangement (all.mp3) does not change chords: it stays on one A major sound
// for its whole length, with A held in the bass. The bed does the same: a cello A underneath
// and viola voicings of that one chord (Asus2, A, A add9, A maj7) that change every two bars.
// It swells as humanity is turned down: the planet opens up. No synths: they are humanity's.
const VOICINGS = [
  ['A3', 'E4', 'B4'], // Asus2
  ['A3', 'C#4', 'E4'], // A
  ['A3', 'C#4', 'E4', 'B4'], // A add9
  ['A3', 'C#4', 'E4', 'G#4'], // A maj7
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
  for (const n of VOICINGS[(bar / 2) % VOICINGS.length]) play('bed', n, '2m', time, 0.35);
  play('sub', 'A2', '2m', time, 0.5); // the held A
}

let startedConductor = false;
export function startConductor() {
  if (startedConductor) return;
  startedConductor = true;
  window.setInterval(analyze, 100);
  new Tone.Loop((time) => tick(time), '16n').start(0);
}

export const debugClock = () => ({ sixteenth: SIXTEENTH(), barStart, now: Tone.getContext().currentTime, bpm: Tone.getTransport().bpm.value });
