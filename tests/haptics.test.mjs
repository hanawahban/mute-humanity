// Run: node --test tests/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FEEL_NAME, MAX_MAGNITUDE, MIN_GAP, binOf, humanityScale, mergePulse, notePulses, pitchPosition, shape } from '../src/input/hapticRhythm.ts';

const IDS = ['temperature', 'rain', 'lightning', 'lights', 'co2', 'nox'];
const peak = (ps) => Math.max(...ps.map((p) => Math.max(p.strong, p.weak)));
const total = (ps) => ps.reduce((t, p) => t + p.ms * (p.strong + p.weak), 0);
const motor = (ps) => ps.reduce((t, p) => t + p.strong, 0) / (ps.reduce((t, p) => t + p.strong + p.weak, 0) || 1); // 1 = all big motor
const length = (ps) => Math.max(...ps.map((p) => p.delay * 1000 + p.ms));

test('every record has its own feel: no two share the same shape', () => {
  const sig = (id) => {
    const ps = notePulses(id, 440, 0.8);
    return `${ps.length}|${Math.round(motor(ps) * 10)}|${Math.round(length(ps) / 40)}`;
  };
  const seen = new Set(IDS.map(sig));
  assert.equal(seen.size, IDS.length, [...IDS.map((id) => `${id}:${sig(id)}`)].join(' '));
  for (const id of IDS) assert.ok(FEEL_NAME[id]);
});

test('the feels match the sounds', () => {
  const at = (id) => notePulses(id, 440, 0.8);
  assert.ok(motor(at('temperature')) > 0.7 && at('temperature').length >= 3, 'temperature swells in the big motor');
  assert.ok(motor(at('co2')) > 0.9 && length(at('co2')) >= 300, 'CO2 is a long low hum');
  assert.ok(motor(at('rain')) < 0.1 && at('rain').length === 1, 'rain is a single light tap');
  assert.ok(motor(at('lights')) < 0.1 && at('lights').length === 2, 'lights flicker twice');
  assert.ok(at('nox').length === 3 && at('nox').every((p) => p.ms <= 30), 'NOx stutters');
  assert.equal(at('lightning').length, 1, 'lightning is one crack');
  for (const id of IDS) if (id !== 'lightning') assert.ok(peak(at('lightning')) > peak(at(id)), `lightning is firmer than ${id}`);
});

test('never harsh: shaped strength stays under the ceiling, zero stays zero', () => {
  assert.equal(shape(0), 0);
  assert.ok(shape(0.05) > 0, 'a faint pulse is still felt');
  assert.ok(Math.abs(shape(1) - MAX_MAGNITUDE) < 1e-9);
  assert.ok(MAX_MAGNITUDE <= 0.65);
  for (const id of IDS) for (const f of [55, 220, 880, 1760]) for (const p of notePulses(id, f, 1)) {
    assert.ok(shape(p.strong) <= MAX_MAGNITUDE && shape(p.weak) <= MAX_MAGNITUDE);
  }
});

test('louder notes are felt more, soft ones still a little', () => {
  for (const id of IDS) {
    const soft = total(notePulses(id, 440, 0.2)), loud = total(notePulses(id, 440, 1));
    assert.ok(loud > soft && soft > 0, id);
  }
});

test('high notes lean to the small motor, low notes to the big one', () => {
  assert.ok(pitchPosition(55) < pitchPosition(440) && pitchPosition(440) < pitchPosition(1760));
  const low = notePulses('lightning', 110, 0.8)[0], high = notePulses('lightning', 1760, 0.8)[0];
  assert.ok(low.strong > high.strong && high.weak > low.weak);
});

test("humanity's records go quiet when our footprint is lightened, and follow the lever", () => {
  assert.equal(humanityScale('earth', 0), 1, 'Earth is never muted by the lever');
  assert.equal(humanityScale('human', 0), 0);
  for (const id of ['lights', 'co2', 'nox']) {
    assert.equal(notePulses(id, 440, 0.9, humanityScale('human', 0)).length, 0, `${id} muted`);
    assert.ok(total(notePulses(id, 440, 0.9, humanityScale('human', 0.5))) < total(notePulses(id, 440, 0.9, 1)), `${id} at 50%`);
  }
});

test('every record has a minimum gap, fast ones shorter', () => {
  for (const id of IDS) assert.ok(MIN_GAP[id] >= 0.1, id);
  assert.ok(MIN_GAP.rain < MIN_GAP.co2);
});

test('a chord in the same 20 ms merges into one pulse', () => {
  assert.equal(binOf(1.001), binOf(1.009));
  assert.notEqual(binOf(1.0), binOf(1.05));
  assert.deepEqual(mergePulse({ ms: 30, strong: 0.2, weak: 0.9 }, { ms: 90, strong: 0.7, weak: 0.1 }), { ms: 90, strong: 0.7, weak: 0.9 });
});
