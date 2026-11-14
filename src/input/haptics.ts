// Controller vibration, designed to be read, not just felt.
//
// 1. You feel ONE record at a time: the record you have selected (D-pad left/right), or the
//    loudest playing record if the selected one is stopped. Summing six records into two
//    motors just made a blur.
// 2. Each record has its own rhythm, matching its sound. Earth records are smooth and
//    regular; humanity records are rough and irregular:
//      Ocean      slow swell, rising and falling with the waves     (strong motor)
//      Rain       light random drops, more drops = more rain          (light motor)
//      Lightning  sharp single strikes, more often = more lightning   (both motors)
//      Lights     soft flicker, faster = brighter                     (light motor)
//      CO2        low steady rumble, stronger = more emissions        (strong motor)
//      NOx        Geiger-counter clicks, faster = more pollution      (strong motor)
//    Strength and speed follow what's in view, under the probe, or under the scan needle,
//    so moving over a city or a storm makes the controller react.
// 3. Short cues confirm actions: two taps = record on, one soft tap = off, a long fade when
//    humanity is muted.

import { RECORDS, BPM, type RecordId } from '../config/records';
import { getState, type Level } from '../state/store';

type Pulse = [ms: number, strong: number, weak: number, gapAfter?: number];

const BEAT_MS = 60000 / BPM;
let busyUntil = 0; // while a cue or burst plays, the continuous pattern waits
let lastTick = 0;
let swellPhase = 0;

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

const chance = (perSecond: number, dt: number) => Math.random() < 1 - Math.exp(-perSecond * dt);

/** Called by the mixer about 20 times a second. */
export function hapticTick(mix: Partial<Record<RecordId, Level>>, now: number) {
  const dt = Math.min(0.2, (now - lastTick) / 1000);
  lastTick = now;
  if (now < busyUntil || !pad()) return;
  const id = feltRecord(mix);
  if (!id) return;
  const v = Math.min(1, mix[id]?.value ?? 0);
  if (v < 0.03) return;

  switch (id) {
    case 'ocean': {
      swellPhase += dt / ((BEAT_MS * 4) / 1000); // one wave every bar
      const wave = 0.5 - 0.5 * Math.cos(swellPhase * 2 * Math.PI);
      rumble(90, v * (0.15 + 0.7 * wave), v * 0.1 * wave);
      break;
    }
    case 'rain':
      if (chance(2 + 16 * v, dt)) rumble(28, 0, 0.35 + 0.45 * v);
      break;
    case 'lightning':
      if (chance(0.5 + 8 * v, dt)) play([[35, 0.9, 0.7]]);
      break;
    case 'lights':
      if (chance(1 + 10 * v, dt)) rumble(40, 0, 0.2 + 0.4 * v * Math.random());
      break;
    case 'co2':
      rumble(90, 0.15 + 0.6 * v, 0.05);
      break;
    case 'nox':
      if (chance(0.8 + 18 * v ** 1.2, dt)) rumble(22, 0.75 + 0.25 * v, 0.15);
      break;
  }
}

export const hapticPatternName: Record<RecordId, string> = {
  ocean: 'slow swell',
  rain: 'light drops',
  lightning: 'sharp strikes',
  lights: 'soft flicker',
  co2: 'low rumble',
  nox: 'Geiger-counter clicks',
};
