// Controller vibration that follows the sound (rules and feels in hapticRhythm.ts).
//
// 1. The controller feels ONE record at a time: the one chosen with the D-pad (or arrow keys),
//    or, if that one isn't playing, the loudest one you can hear. Each note it plays is felt
//    the moment it sounds, in that record's own feel (temperature swells, rain taps, lightning
//    cracks, lights flicker, CO2 hums, NOx stutters). Choosing a record plays its feel once,
//    so you learn which is which.
// 2. Humanity's records follow the lever: softer as it goes down, nothing when our footprint
//    is lightened, even if they are still switched on.
// 3. Short, gentle cues confirm actions: two taps = record on, one tap = off, a fade when our
//    footprint is lightened.
// Everything is capped (MAX_MAGNITUDE) so it is never harsh, and scaled by the strength setting.

import * as Tone from 'tone';
import { RECORDS, RECORD_BY_ID, type RecordId } from '../config/records';
import { audible, getState, type AppState, type Level } from '../state/store';
import { binOf, FEEL_NAME, humanityScale, MIN_GAP, MIN_MS, mergePulse, notePulses, shape, type Pulse as RhythmPulse } from './hapticRhythm';

type Pulse = [ms: number, strong: number, weak: number, gapAfter?: number];

let busyUntil = 0; // while a cue plays, notes wait

function pad(): Gamepad | null {
  for (const gp of navigator.getGamepads?.() ?? []) if (gp?.vibrationActuator) return gp;
  return null;
}

function rumble(ms: number, strong: number, weak: number) {
  const gp = pad();
  const k = getState().settings.vibration;
  if (!gp?.vibrationActuator || k <= 0) return;
  void gp.vibrationActuator
    .playEffect('dual-rumble', { startDelay: 0, duration: Math.max(ms, MIN_MS), strongMagnitude: shape(strong) * k, weakMagnitude: shape(weak) * k })
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
  on: [[40, 0.35, 0.2, 70], [50, 0.5, 0.25]],
  off: [[50, 0, 0.35]],
  select: [[25, 0, 0.25]],
  decade: [[35, 0.3, 0.15]],
  edge: [[110, 0.45, 0.3]],
  flip: [[30, 0.25, 0.25, 50], [30, 0.25, 0.25, 50], [30, 0.25, 0.25]],
  mute: [[120, 0.5, 0.3], [120, 0.35, 0.2], [120, 0.2, 0.12], [160, 0.08, 0.05]],
  unmute: [[120, 0.08, 0.05], [120, 0.2, 0.12], [120, 0.35, 0.2], [140, 0.5, 0.3]],
  dataStarts: [[40, 0.4, 0.2, 60], [40, 0.4, 0.2]],
};

const lastCue = new Map<Cue, number>();
export function cue(name: Cue) {
  const now = performance.now();
  if (now - (lastCue.get(name) ?? -1e9) < 350) return; // no machine-gun repeats
  lastCue.set(name, now);
  play(CUES[name]);
}

/** How strongly a record is heard right now: 0 when off, or when it is humanity's and the lever is down. */
function heard(s: AppState, id: RecordId): number {
  if (!audible(s).includes(id)) return 0;
  return humanityScale(RECORD_BY_ID[id].side, s.humanity);
}

/** The record the controller is feeling: the chosen one if you can hear it, else the loudest one you can. */
export function feltRecord(mix: Partial<Record<RecordId, Level>>, s: AppState = getState()): RecordId | null {
  if (heard(s, s.selected) > 0) return s.selected;
  let best: RecordId | null = null;
  let bestV = 0.02;
  for (const r of RECORDS) {
    const v = heard(s, r.id) * (mix[r.id]?.value ?? 0);
    if (v > bestV) {
      bestV = v;
      best = r.id;
    }
  }
  return best;
}

// ---------- notes: pulses are scheduled at the audio time they sound ----------
const pending = new Map<number, RhythmPulse>();
const lastNote = new Map<RecordId, number>(); // audio time of the last felt note, per record

/** Fire a pulse when its sound does (a plain timer: Tone's Draw pauses in background tabs). Pulses within 20 ms merge. */
function queue(time: number, q: RhythmPulse) {
  const bin = binOf(time);
  const had = pending.get(bin);
  pending.set(bin, had ? mergePulse(had, q) : q);
  if (had) return;
  const delay = Math.max(0, (time - Tone.getContext().currentTime) * 1000);
  window.setTimeout(() => {
    const p = pending.get(bin);
    pending.delete(bin);
    if (p && performance.now() >= busyUntil) rumble(p.ms, p.strong, p.weak);
  }, delay);
}

/** Called for every note the music plays: the felt record's notes are felt when they sound. */
export function hapticNote(key: string, note: string | number, velocity: number, time: number) {
  if (!(key in RECORD_BY_ID) || !pad()) return; // the harmony bed and the cloud pad stay silent
  const id = key as RecordId;
  const s = getState();
  if (!s.audioOn || id !== feltRecord(s.levels, s)) return;
  const scale = heard(s, id);
  if (scale <= 0) return;
  if (time - (lastNote.get(id) ?? -1e9) < MIN_GAP[id]) return; // fast passages: not a continuous buzz
  lastNote.set(id, time);
  const freq = Tone.Frequency(note).toFrequency();
  for (const p of notePulses(id, freq, velocity, scale)) queue(time + p.delay, p);
}

/** Play a record's feel once (when it is chosen), so you learn which is which. */
export function feelSample(id: RecordId) {
  if (!pad()) return;
  const pulses = notePulses(id, 440, 0.8);
  let last = 0;
  for (const p of pulses) {
    window.setTimeout(() => rumble(p.ms, p.strong, p.weak), p.delay * 1000);
    last = Math.max(last, p.delay * 1000 + p.ms);
  }
  busyUntil = performance.now() + last + 60;
}

export const hapticPatternName: Record<RecordId, string> = FEEL_NAME;
