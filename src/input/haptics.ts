// Controller vibration, designed to be felt in time with the music.
//
// 1. The pad never goes quiet while music plays: a pulse on every beat, heaviest on beat 1,
//    stronger with how much is going on (intensity). When it gets busy, off-beat ticks join.
// 2. Every note of every playing record pulses the pad the moment it sounds (rules in
//    hapticRhythm.ts): low notes in the big motor, high notes in the small one, harder notes
//    stronger, held notes with a fading tail. The record you have selected (D-pad left/right),
//    or the loudest one, counts most, and also has its own texture on the beat grid:
//      Ocean      swells on beats 1 and 3
//      CO2        thumps like a kick drum
//      NOx        clicks on the 16ths, denser with more pollution
//      Lights     sparkles on the off-beats
//    Strength follows what's in view, under the probe, or under the scan needle, so moving
//    over a city or a storm makes the controller react.
//    Every pulse is lifted to a strength and length the motors can actually produce.
// 3. Short cues confirm actions: two taps = record on, one soft tap = off, a long fade when
//    our footprint is lightened.

import * as Tone from 'tone';
import { RECORDS, RECORD_BY_ID, type RecordId } from '../config/records';
import { audible, getState, type Level } from '../state/store';
import { beatPulse, binOf, intensityOf, lift, MIN_MS, mergePulse, notePulses, stepPulse, type Pulse as RhythmPulse } from './hapticRhythm';

type Pulse = [ms: number, strong: number, weak: number, gapAfter?: number];

let busyUntil = 0; // while a cue plays, the rhythm waits

function pad(): Gamepad | null {
  for (const gp of navigator.getGamepads?.() ?? []) if (gp?.vibrationActuator) return gp;
  return null;
}

function rumble(ms: number, strong: number, weak: number) {
  const gp = pad();
  const k = getState().settings.vibration;
  if (!gp?.vibrationActuator || k <= 0) return;
  void gp.vibrationActuator
    // lifted so the motors respond at all, then scaled by the strength setting
    .playEffect('dual-rumble', { startDelay: 0, duration: Math.max(ms, MIN_MS), strongMagnitude: Math.min(1, lift(strong) * k), weakMagnitude: Math.min(1, lift(weak) * k) })
    .catch(() => undefined);
}

function play(pulses: Pulse[]) {
  if (!pad()) return;
  let t = 0;
  for (const [ms, s, w, gap = 0] of pulses) {
    window.setTimeout(() => rumble(ms, s, w), t);
    t += ms + gap;
  }
  busyUntil = performance.now() + t + 30;
}

export type Cue = 'on' | 'off' | 'select' | 'decade' | 'edge' | 'mute' | 'unmute' | 'flip' | 'dataStarts';

const CUES: Record<Cue, Pulse[]> = {
  on: [[45, 0.55, 0.3, 70], [60, 0.85, 0.4]],
  off: [[60, 0, 0.45]],
  select: [[25, 0, 0.3]],
  decade: [[35, 0.5, 0.2]],
  edge: [[140, 0.8, 0.5]],
  flip: [[30, 0.4, 0.4, 50], [30, 0.4, 0.4, 50], [30, 0.4, 0.4]],
  mute: [[120, 0.9, 0.6], [120, 0.6, 0.4], [120, 0.35, 0.2], [160, 0.15, 0.08]],
  unmute: [[120, 0.15, 0.08], [120, 0.35, 0.2], [120, 0.6, 0.4], [140, 0.9, 0.6]],
  dataStarts: [[40, 0.7, 0.3, 60], [40, 0.7, 0.3]],
};

const lastCue = new Map<Cue, number>();
export function cue(name: Cue) {
  const now = performance.now();
  if (now - (lastCue.get(name) ?? -1e9) < 350) return; // no machine-gun repeats
  lastCue.set(name, now);
  play(CUES[name]);
}

/** The record the controller is "listening" to. */
export function feltRecord(mix: Partial<Record<RecordId, Level>>): RecordId | null {
  const { selected, playing } = getState();
  if (playing[selected] && (mix[selected]?.value ?? 0) > 0.02) return selected;
  let best: RecordId | null = null;
  let bestV = 0.02;
  for (const r of RECORDS) {
    const v = playing[r.id] ? mix[r.id]?.value ?? 0 : 0;
    if (v > bestV) {
      bestV = v;
      best = r.id;
    }
  }
  return best;
}

// ---------- rhythm: pulses are scheduled at the audio time they belong to ----------
const pending = new Map<number, RhythmPulse>();
/** Even a quiet mix is felt: the beat never drops below this intensity while records play. */
const BASELINE = 0.15;

/**
 * Fire a pulse when its sound does. A plain timer, not Tone's Draw: Draw pauses in background tabs
 * and drops events that come late, which made the pad go quiet. Pulses within 20 ms merge.
 */
function queue(time: number, p: RhythmPulse) {
  const bin = binOf(time);
  const had = pending.get(bin);
  pending.set(bin, had ? mergePulse(had, p) : p);
  if (had) return;
  const delay = Math.max(0, (time - Tone.getContext().currentTime) * 1000);
  window.setTimeout(() => {
    const q = pending.get(bin);
    pending.delete(bin);
    if (q && performance.now() >= busyUntil) rumble(q.ms, q.strong, q.weak);
  }, delay);
}

/** Called on every 16th note (step 0-15 of the bar) with its audio time: the always-on beat plus the felt record's texture. */
export function hapticStep(step: number, time: number) {
  if (!pad()) return;
  const s = getState();
  const ids = audible(s);
  if (!s.audioOn || !ids.length) return;
  const value = (id: RecordId) => Math.min(1, s.levels[id]?.value ?? 0);
  const beat = beatPulse(step, Math.max(BASELINE, intensityOf(ids.map(value))));
  if (beat) queue(time, beat);
  const felt = feltRecord(s.levels);
  const texture = felt && stepPulse(felt, step, value(felt));
  if (texture) queue(time, texture);
}

/** Called for every note played: every playing record's notes pulse the pad when they sound. */
export function hapticNote(key: string, note: string | number, velocity: number, time: number) {
  if (!(key in RECORD_BY_ID) || !pad()) return; // the bed, the cloud pad ('rain:2') and the like stay silent
  const id = key as RecordId;
  const s = getState();
  if (!s.audioOn || !audible(s).includes(id)) return;
  const weight = id === feltRecord(s.levels) ? 1 : 0.65; // the record you are feeling counts most
  const freq = Tone.Frequency(note).toFrequency();
  for (const p of notePulses(RECORD_BY_ID[id].voice, freq, velocity * weight)) queue(time + p.delay, p);
}

export const hapticPatternName: Record<RecordId, string> = {
  ocean: 'beat with a swell',
  rain: 'beat with drops',
  lightning: 'beat with strikes',
  lights: 'beat with off-beat sparkle',
  co2: 'beat with a kick-drum thump',
  nox: 'beat with rhythmic clicks',
};
