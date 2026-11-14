// Sound engine: the team's 10 recorded instruments, pitch-shifted by Tone.js samplers.
// Earth records go through a reverb bus (wide, warm). Humanity records go through a dry bus
// with a little grit. Each record has its own channel (volume + left/right position), so the
// humanity lever, solo and the meters work per record.

import * as Tone from 'tone';
import { BPM, INSTRUMENT_NOTES, RECORDS, type InstrumentId, type RecordId } from '../config/records';

export type VoiceKey = RecordId | `${RecordId}:2`;

interface Channel {
  sampler: Tone.Sampler;
  panner: Tone.Panner;
  gain: Tone.Gain;
}

let started = false;
const channels = new Map<VoiceKey, Channel>();
let master: Tone.Gain;
let intro: Tone.Player | null = null;
/** Count of notes per channel, for testing in development. */
export const notesPlayed: Record<string, number> = {};
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__notes = notesPlayed;

const url = (id: InstrumentId) => `/sounds/${id}.mp3`;

function makeChannel(instrument: InstrumentId, bus: Tone.ToneAudioNode, opts: { attack: number; release: number }) {
  const gain = new Tone.Gain(0).connect(bus);
  const panner = new Tone.Panner(0).connect(gain);
  const sampler = new Tone.Sampler({
    urls: { [INSTRUMENT_NOTES[instrument]]: url(instrument) },
    attack: opts.attack,
    release: opts.release,
  }).connect(panner);
  return { sampler, panner, gain };
}

export async function startAudio() {
  if (started) return;
  await Tone.start();
  started = true;
  Tone.getTransport().bpm.value = BPM;

  master = new Tone.Gain(0.9);
  master.chain(new Tone.Limiter(-1), Tone.getDestination());

  const reverb = new Tone.Reverb({ decay: 4.5, wet: 0.38 });
  const earthBus = new Tone.Gain(1).chain(reverb, master);
  const grit = new Tone.Distortion({ distortion: 0.25, wet: 0.35 });
  const humanBus = new Tone.Gain(1).chain(grit, master);

  for (const rec of RECORDS) {
    const bus = rec.side === 'earth' ? earthBus : humanBus;
    const env = rec.voice === 'strikes' ? { attack: 0.002, release: 0.25 }
      : rec.voice === 'drops' ? { attack: 0.01, release: 0.5 }
        : rec.voice === 'drone' ? { attack: 0.8, release: 3 }
          : { attack: 0.25, release: 1.6 };
    channels.set(rec.id, makeChannel(rec.instrument, bus, env));
    if (rec.second) channels.set(`${rec.id}:2`, makeChannel(rec.second.instrument, bus, { attack: 1.2, release: 3 }));
  }
  intro = new Tone.Player({ url: url('all'), volume: -10 }).connect(reverb);
  await Tone.loaded();
  Tone.getTransport().start('+0.05');
}

/** Play one note on a record's instrument. */
export function play(key: VoiceKey, note: string, duration: Tone.Unit.Time, time: number, velocity: number, pan?: number) {
  const ch = channels.get(key);
  if (!ch || !ch.sampler.loaded) return;
  if (pan != null) ch.panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), time);
  ch.sampler.triggerAttackRelease(note, duration, time, Math.max(0.05, Math.min(1, velocity)));
  if (import.meta.env.DEV) notesPlayed[key] = (notesPlayed[key] ?? 0) + 1;
}

/** Channel volume (0-1), smoothed. */
export function setGain(key: VoiceKey, v: number) {
  const ch = channels.get(key);
  if (ch) ch.gain.gain.rampTo(Math.max(0, Math.min(1.2, v)), 0.2);
}

export function releaseAll(key: VoiceKey) {
  channels.get(key)?.sampler.releaseAll();
}

/** The full-band chord the team recorded, as a welcome. */
export function playIntro() {
  if (intro?.loaded) intro.start();
}

/** Turn the music down while the microphone listens. */
export function duck(on: boolean) {
  if (master) master.gain.rampTo(on ? 0.15 : 0.9, 0.2);
}

export const isStarted = () => started;
