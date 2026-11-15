// Run: node --test tests/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { binOf, mergePulse, noteMotors, notePulses, pitchPosition, stepPulse } from '../src/input/hapticRhythm.ts';

const rng = (seed) => { let s = seed; return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); };

test('low notes use the big motor, high notes the small one', () => {
  const low = noteMotors(110, 0.8), high = noteMotors(1318, 0.8);
  assert.ok(low.strong > low.weak, 'A2 should rumble');
  assert.ok(high.weak > high.strong, 'E6 should buzz');
  assert.ok(pitchPosition(55) < pitchPosition(440) && pitchPosition(440) < pitchPosition(1760));
});

test('harder notes pulse harder, and everything stays within 0-1', () => {
  for (const f of [55, 110, 220, 440, 880, 1760, 2400]) {
    const soft = noteMotors(f, 0.1), hard = noteMotors(f, 1);
    assert.ok(hard.strong >= soft.strong && hard.weak >= soft.weak);
    for (const v of [...Object.values(hard), ...Object.values(soft)]) assert.ok(v >= 0 && v <= 1);
  }
});

test('held notes get a fading tail, strikes are single and sharp', () => {
  const held = notePulses('sustain', 220, 0.9);
  assert.ok(held.length >= 2 && held[1].strong < held[0].strong && held[2].strong < held[1].strong);
  assert.ok(held.every((p, i) => i === 0 || p.delay > held[i - 1].delay));
  const strike = notePulses('strikes', 880, 0.9);
  assert.equal(strike.length, 1);
  assert.ok(strike[0].ms <= 35 && strike[0].strong > 0 && strike[0].weak > 0);
});

test('ocean swells on the beats, heaviest on beat 1, and nothing in between', () => {
  const beats = [0, 4, 8, 12].map((s) => stepPulse('ocean', s, 0.8));
  assert.ok(beats.every(Boolean));
  assert.ok(beats[0].strong > beats[2].strong && beats[2].strong > beats[1].strong && beats[1].strong > beats[3].strong);
  for (let s = 0; s < 16; s++) if (s % 4) assert.equal(stepPulse('ocean', s, 0.8), null);
});

test('CO2 thumps like a kick drum on the beats', () => {
  for (let s = 0; s < 16; s++) assert.equal(stepPulse('co2', s, 0.7) !== null, s % 4 === 0);
  assert.ok(stepPulse('co2', 0, 0.7).strong > stepPulse('co2', 4, 0.7).strong);
});

test('NOx clicks fall on the 16th-note grid and get denser with pollution', () => {
  const count = (level) => { const r = rng(9); let n = 0; for (let i = 0; i < 4000; i++) if (stepPulse('nox', i % 16, level, r)) n++; return n; };
  assert.ok(count(0.9) > 2 * count(0.1));
});

test('city lights sparkle only on the off-beats; rain and lightning leave the beat to their notes', () => {
  const r = rng(4);
  for (let i = 0; i < 2000; i++) { const s = i % 16; if (stepPulse('lights', s, 1, r)) assert.equal(s % 4, 2); }
  for (const id of ['rain', 'lightning']) for (let s = 0; s < 16; s++) assert.equal(stepPulse(id, s, 1), null);
});

test('silence below the threshold', () => {
  for (const id of ['ocean', 'co2', 'nox', 'lights']) for (let s = 0; s < 16; s++) assert.equal(stepPulse(id, s, 0.01), null);
});

test('a beat and a note in the same 20 ms merge into one pulse', () => {
  assert.equal(binOf(1.001), binOf(1.009));
  assert.notEqual(binOf(1.0), binOf(1.05));
  assert.deepEqual(mergePulse({ ms: 30, strong: 0.2, weak: 0.9 }, { ms: 90, strong: 0.7, weak: 0.1 }), { ms: 90, strong: 0.7, weak: 0.9 });
});
