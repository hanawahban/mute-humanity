// Sound engine: the team's 10 recorded instruments, pitch-shifted by Tone.js samplers.
// Earth records go through a reverb bus (wide, warm). Humanity records go through a dry bus
// with a little grit. Each record has its own channel (volume + left/right position), so the
// humanity lever, solo and the meters work per record.

import * as Tone from 'tone';
import { BPM, INSTRUMENT_NOTES, RECORDS, type InstrumentId, type RecordId } from '../config/records';

export type VoiceKey = RecordId | `${RecordId}:2` | 'bed' | 'sub';

interface Channel {
  sampler: Tone.Sampler;
  panner: Tone.Panner;
  gain: Tone.Gain;
}

let started = false;
const channels = new Map<VoiceKey, Channel>();
let master: Tone.Gain;
let intro: Tone.Player | null = null;
let reverb: Tone.Reverb | null = null;
/** Count of notes per channel, for testing in development. */
export const notesPlayed: Record<string, number> = {};
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__notes = notesPlayed;

const url = (id: InstrumentId) => `/sounds/${id}.mp3`;

function makeChannel(instrument: InstrumentId, bus: Tone.ToneAudioNode, opts: { attack: number; release: number; lowpass?: number }) {
  const gain = new Tone.Gain(0).connect(bus);
  const out: Tone.ToneAudioNode = opts.lowpass ? new Tone.Filter({ frequency: opts.lowpass, type: 'lowpass', rolloff: -24 }).connect(gain) : gain;
  const panner = new Tone.Panner(0).connect(out);
  const sampler = new Tone.Sampler({
    urls: { [INSTRUMENT_NOTES[instrument]]: url(instrument) },
    attack: opts.attack,
    release: opts.release,
  }).connect(panner);
  return { sampler, panner, gain };
}

export async function startAudio() {
  if (started) return;
  // A bigger safety buffer: notes are scheduled 0.25 s ahead, so a busy main thread (decoding
  // video frames, drawing the map) can't make the audio stutter.
  Tone.setContext(new Tone.Context({ latencyHint: 'playback', lookAhead: 0.25 }));
  await Tone.start();
  started = true;
  Tone.getTransport().bpm.value = BPM;

  master = new Tone.Gain(0.9);
  master.chain(new Tone.Compressor({ threshold: -20, ratio: 3, attack: 0.02, release: 0.3 }), new Tone.Limiter(-1), Tone.getDestination());

  // Earth: a big warm hall plus a soft echo, so it feels wide and alive.
  reverb = new Tone.Reverb({ decay: 7, preDelay: 0.03, wet: 0.42 });
  const echo = new Tone.PingPongDelay({ delayTime: '8n.', feedback: 0.22, wet: 0.16 });
  const earthBus = new Tone.Gain(1).chain(echo, reverb, master);
  // Humanity: dry, close and a little rough.
  grit = new Tone.Distortion({ distortion: 0.15, wet: 0.2 });
  const humanBus = new Tone.Gain(1).chain(grit, new Tone.Reverb({ decay: 1.2, wet: 0.12 }), master);

  for (const rec of RECORDS) {
    const bus = rec.side === 'earth' ? earthBus : humanBus;
    const env = rec.voice === 'strikes' ? { attack: 0.002, release: 0.4 }
      : rec.voice === 'drops' ? { attack: 0.01, release: 0.8 }
        : rec.voice === 'drone' ? { attack: 1, release: 3.5 }
          : { attack: 0.3, release: 2.2 };
    channels.set(rec.id, makeChannel(rec.instrument, bus, env));
    if (rec.second) channels.set(`${rec.id}:2`, makeChannel(rec.second.instrument, bus, { attack: 1.5, release: 4 }));
  }
  // The harmony under everything: viola chords and a deep cello root, changing every two bars.
  // Only traditional instruments live on the Earth bus: the synths belong to humanity.
  channels.set('bed', makeChannel('viola', earthBus, { attack: 2, release: 5 }));
  channels.set('sub', makeChannel('cello', earthBus, { attack: 2, release: 5 }));
  intro = new Tone.Player({ url: url('all'), volume: -10 }).connect(reverb);
  await Tone.loaded();
  Tone.getTransport().start('+0.05');
}

/** Play one note on a record's instrument. */
export function play(key: VoiceKey, note: string | number, duration: Tone.Unit.Time, time: number, velocity: number, pan?: number) {
  const ch = channels.get(key);
  if (!ch || !ch.sampler.loaded) return;
  // a touch of human timing and touch, so it doesn't sound mechanical
  const t = time + Math.random() * 0.012;
  const vel = Math.max(0.05, Math.min(1, velocity * (0.92 + Math.random() * 0.16)));
  // glide the pan instead of jumping it: a jump moves every note still ringing and clicks
  if (pan != null) ch.panner.pan.linearRampTo(Math.max(-1, Math.min(1, pan)), 0.04, t);
  ch.sampler.triggerAttackRelease(note, duration, t, vel);
  if (import.meta.env.DEV) notesPlayed[key] = (notesPlayed[key] ?? 0) + 1;
}

/** Channel volume (0-1), smoothed. */
const lastGain = new Map<VoiceKey, number>();
const holdUntil = new Map<VoiceKey, number>();
export function setGain(key: VoiceKey, v: number, time?: number) {
  if ((holdUntil.get(key) ?? 0) > performance.now()) return; // a preview note is sounding
  const ch = channels.get(key);
  const g = Math.max(0, Math.min(1.2, v));
  // only when it really changes: re-scheduling ramps ten times a second piles up automation
  if (!ch || Math.abs((lastGain.get(key) ?? -1) - g) < 0.01) return;
  lastGain.set(key, g);
  ch.gain.gain.rampTo(g, 0.25, time);
}

/** Play one note on a record's instrument even if the record is off (the How it works view). */
export function previewNote(key: VoiceKey, note: string | number, level: number) {
  const ch = channels.get(key);
  if (!ch) return;
  const now = Tone.now();
  ch.gain.gain.cancelScheduledValues(now);
  ch.gain.gain.setValueAtTime(level, now);
  holdUntil.set(key, performance.now() + 2500);
  lastGain.delete(key); // so the mix takes the channel back afterwards
  play(key, note, '2n', now + 0.02, 0.8, 0);
}

let grit: Tone.Distortion | null = null;
/** Make humanity harsher (the story's "hear us over everything" moment). 0 = normal. */
export function setHarsh(amount: number) {
  if (!grit) return;
  grit.wet.rampTo(0.2 + 0.4 * amount, 2);
  grit.distortion = 0.15 + 0.35 * amount;
}

export function releaseAll(key: VoiceKey) {
  channels.get(key)?.sampler.releaseAll();
}

/** The full-band chord the team recorded, as a welcome. */
export function playIntro() {
  if (intro?.loaded) intro.start();
}

/** More space when humanity is muted: the planet opens up. */
export function setSpace(amount: number, time?: number) {
  if (reverb) reverb.wet.rampTo(0.42 + 0.25 * amount, 1.5, time);
}

/** Turn the music down while the microphone listens. */
export function duck(on: boolean, level = 0.15) {
  if (master) master.gain.rampTo(on ? level : 0.9, on ? 0.4 : 1.2);
}

export const isStarted = () => started;

/** How long the speakers lag behind the audio clock, so visuals can line up with what you hear. */
export function outputLatency(): number {
  const raw = Tone.getContext().rawContext as AudioContext;
  return (raw.outputLatency || raw.baseLatency || 0) as number;
}
