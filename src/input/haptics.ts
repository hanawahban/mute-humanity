// Controller vibration, designed to be felt in time with the music.
//
// 1. You feel ONE record at a time: the record you have selected (D-pad left/right), or the
//    loudest playing record if the selected one is stopped. Summing six records into two
//    motors just made a blur.
// 2. The pad follows the same 16th-note clock as the notes (rules in hapticRhythm.ts):
//      notes   every note of that record pulses the pad the moment it sounds: low notes in the
//              big motor, high notes in the small one, held notes with a fading tail
//      beats   each record also has a pattern locked to the beat, so it is felt between notes:
//                Ocean      swells on beats 1 and 3
//                CO2        thumps like a kick drum
//                NOx        clicks on the 16ths, denser with more pollution
//                Lights     sparkles on the off-beats
//                Rain, Lightning  no beat pattern: their notes are the rhythm
//    Strength follows what's in view, under the probe, or under the scan needle, so moving
//    over a city or a storm makes the controller react.
// 3. Short cues confirm actions: two taps = record on, one soft tap = off, a long fade when
//    our footprint is lightened.

import * as Tone from 'tone';
import { RECORDS, RECORD_BY_ID, type RecordId } from '../config/records';
import { getState, type Level } from '../state/store';
import { binOf, mergePulse, notePulses, stepPulse, type Pulse as RhythmPulse } from './hapticRhythm';

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
    .playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: Math.min(1, strong * k), weakMagnitude: Math.min(1, weak * k) })
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

/** Fire a pulse when its sound does (Tone's Draw runs callbacks at the audio time). Pulses within 20 ms merge. */
function queue(time: number, p: RhythmPulse) {
  const bin = binOf(time);
  const had = pending.get(bin);
  pending.set(bin, had ? mergePulse(had, p) : p);
  if (had) return;
  Tone.getDraw().schedule(() => {
    const q = pending.get(bin);
    pending.delete(bin);
    if (q && performance.now() >= busyUntil) rumble(q.ms, q.strong, q.weak);
  }, time);
}

/** Called on every 16th note (step 0-15 of the bar) with its audio time: the beat-locked pattern. */
export function hapticStep(step: number, time: number) {
  if (!pad()) return;
  const { levels } = getState();
  const id = feltRecord(levels);
  if (!id) return;
  const p = stepPulse(id, step, Math.min(1, levels[id]?.value ?? 0));
  if (p) queue(time, p);
}

/** Called for every note played: the felt record's notes pulse the pad when they sound. */
export function hapticNote(key: string, note: string | number, velocity: number, time: number) {
  if (key !== feltRecord(getState().levels) || !pad()) return; // 'rain:2' (clouds), the bed and other records stay silent
  const freq = Tone.Frequency(note).toFrequency();
  for (const p of notePulses(RECORD_BY_ID[key as RecordId].voice, freq, velocity)) queue(time + p.delay, p);
}

export const hapticPatternName: Record<RecordId, string> = {
  ocean: 'swell on the beat',
  rain: 'drops on the notes',
  lightning: 'strikes on the flashes',
  lights: 'off-beat sparkle',
  co2: 'kick-drum thump',
  nox: 'rhythmic clicks',
};
