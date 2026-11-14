// Tone.js sound engine with placeholder synths.
// Earth records play in the D major pentatonic key with reverb: in tune, warm and wide.
// Human records play outside the key, dry and harsh. Swap the synths for the
// GarageBand samples later (see README, "Sound files"), keeping the same channels.

import * as Tone from 'tone';
import { BPM, OUT_OF_KEY, SCALE, type RecordId } from '../config/records';

type Levels = Partial<Record<RecordId, number | null>>;

interface Channel {
  gain: Tone.Gain;
  base: number; // loudness at full intensity
  value: number; // latest 0-1 intensity
}

let started = false;
const channels = new Map<RecordId, Channel>();
let master: Tone.Gain;

const note = (i: number, octave: number) => `${SCALE[((i % SCALE.length) + SCALE.length) % SCALE.length]}${octave + Math.floor(i / SCALE.length)}`;

export async function startAudio() {
  if (started) return;
  await Tone.start();
  started = true;

  const transport = Tone.getTransport();
  transport.bpm.value = BPM;

  master = new Tone.Gain(1);
  const limiter = new Tone.Limiter(-1);
  master.chain(limiter, Tone.getDestination());

  const earthBus = new Tone.Gain(1);
  const reverb = new Tone.Reverb({ decay: 5, wet: 0.4 });
  earthBus.chain(reverb, master);
  const humanBus = new Tone.Gain(1).connect(master); // dry and close

  const channel = (id: RecordId, bus: Tone.Gain, base: number) => {
    const gain = new Tone.Gain(0).connect(bus);
    channels.set(id, { gain, base, value: 0 });
    return gain;
  };
  const value = (id: RecordId) => channels.get(id)?.value ?? 0;

  // Ocean: slow strings. Warmer water (higher value) picks higher notes.
  const strings = new Tone.PolySynth(Tone.AMSynth, {
    envelope: { attack: 0.8, decay: 0.3, sustain: 0.7, release: 2.5 },
  }).connect(channel('ocean', earthBus, 0.5));
  new Tone.Loop((time) => {
    const v = value('ocean');
    if (v <= 0.02 || Math.random() > 0.35 + v * 0.6) return;
    const i = Math.round(v * 8) + Math.floor(Math.random() * 3) - 1;
    strings.triggerAttackRelease(note(i, 3), '2n', time, 0.4 + v * 0.4);
  }, '4n').start(0);

  // Plants: a sustained choir-like pad that swells with greenness.
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fattriangle', count: 3, spread: 20 },
    envelope: { attack: 3, decay: 1, sustain: 0.9, release: 4 },
  }).connect(channel('plants', earthBus, 0.22));
  pad.triggerAttack(['D3', 'A3', 'F#4', 'B4']);

  // Rain: piano-like droplets. More rain, more notes.
  const drops = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sine' },
    envelope: { attack: 0.005, decay: 0.4, sustain: 0, release: 0.6 },
  }).connect(channel('rain', earthBus, 0.35));
  new Tone.Loop((time) => {
    const v = value('rain');
    if (Math.random() > v * 0.75) return;
    drops.triggerAttackRelease(note(Math.floor(Math.random() * 7), 5), '16n', time, 0.3 + Math.random() * 0.4);
  }, '16n').start(0);

  // NO2: a low distorted drone on a note outside the key.
  const droneFilter = new Tone.Filter(220, 'lowpass');
  const drone = new Tone.FMSynth({ harmonicity: 1.5, modulationIndex: 6 });
  drone.chain(new Tone.Distortion(0.5), droneFilter, channel('no2', humanBus, 0.45));
  drone.triggerAttack(OUT_OF_KEY);
  new Tone.Loop((time) => {
    droneFilter.frequency.rampTo(180 + value('no2') * 1400, 0.3, time);
  }, '16n').start(0);

  // Fires: crackling noise grains.
  const crackle = new Tone.NoiseSynth({
    noise: { type: 'brown' },
    envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.01 },
  }).chain(new Tone.Distortion(0.7), channel('fires', humanBus, 0.7));
  new Tone.Loop((time) => {
    const v = value('fires');
    if (Math.random() > v * 0.9) return;
    crackle.triggerAttackRelease(0.02 + Math.random() * 0.03, time + Math.random() * 0.05, 0.3 + Math.random() * 0.7);
  }, '32n').start(0);

  // Ocean plastic: glassy metallic clicks, out of key.
  const clicks = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.06, release: 0.02 },
    harmonicity: 7.1,
    modulationIndex: 20,
    resonance: 5200,
    octaves: 1.2,
  }).connect(channel('plastic', humanBus, 0.08));
  clicks.frequency.value = 1900;
  new Tone.Loop((time) => {
    const v = value('plastic');
    if (Math.random() > v * 0.6) return;
    clicks.triggerAttackRelease('32n', time, 0.2 + Math.random() * 0.5);
  }, '16n').start(0);

  transport.start();
}

/** Called about 20 times per second with each record's intensity (0-1, null = silent / no data). */
export function updateLevels(levels: Levels) {
  if (!started) return;
  for (const [id, ch] of channels) {
    const v = levels[id] ?? 0;
    ch.value = v;
    ch.gain.gain.rampTo(ch.base * Math.pow(v, 1.1), 0.15);
  }
}

/** Lowers the music while the microphone listens, so it doesn't hear itself. */
export function duck(on: boolean) {
  if (!started) return;
  master.gain.rampTo(on ? 0.2 : 1, 0.2);
}

export const isAudioStarted = () => started;
