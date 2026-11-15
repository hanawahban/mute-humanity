// Run: node --test tests/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bend, bendChance, detuneCents, dragSixteenths, settle, tension } from '../src/audio/harmony.ts';

const IN_KEY = new Set([0, 2, 4, 5, 7, 9, 11]);
const pc = (m) => (((m - 69) % 12) + 12) % 12;
// a seeded random so the tests are repeatable
function rng(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); }

test('tension 0 changes nothing: humanity blends into the Earth', () => {
  const r = rng(1);
  for (let m = 40; m < 90; m++) assert.equal(bend(m, 0, r), m);
  assert.equal(detuneCents(0), 0);
  assert.equal(dragSixteenths(0), 0);
});

test('bend chance rises with tension: rare in the middle, about 1 in 43 at the strongest spots', () => {
  const c = [0, 0.25, 0.5, 0.75, 1].map(bendChance);
  for (let i = 1; i < c.length; i++) assert.ok(c[i] > c[i - 1]);
  assert.ok(c[1] < 0.001, `quarter ${c[1]}`);
  assert.ok(c[2] > 0.003 && c[2] < 0.006, `half ${c[2]}`);
  assert.ok(c[4] > 0.02 && c[4] < 0.027, `full ${c[4]}`);
});

test('tension comes from the data under the note, scaled by the lever', () => {
  assert.equal(tension(1, 0), 0); // clean air, dark night, no warming: in tune
  assert.equal(tension(0, 1), 0); // footprint lightened: in tune
  assert.equal(tension(1, 1), 1);
  assert.equal(tension(0.5, 0.5), 0.25);
  assert.equal(tension(2, -1), 0); // clamped
});

const NOTES = [57, 59, 61, 64, 69, 71, 73, 76]; // A3 B3 C#4 E4 A4 B4 C#5 E5: the four notes Earth and humanity play

test('a bent note always ends outside the key, within three semitones', () => {
  const r = rng(7);
  for (const base of NOTES) {
    for (let i = 0; i < 6000; i++) {
      const out = bend(base, 1, r);
      if (out !== base) { assert.ok(!IN_KEY.has(pc(out)), `${base}->${out}`); assert.ok(Math.abs(out - base) <= 3); }
    }
  }
});

test('at full tension about one note in 43 is bent', () => {
  const r = rng(3); let bent = 0; const N = 1000000;
  for (let i = 0; i < N; i++) { const b = NOTES[i % NOTES.length]; if (bend(b, 1, r) !== b) bent++; }
  const share = bent / N;
  assert.ok(share > 0.02 && share < 0.027, `share ${share}`);
});

test('the bends that do happen are mostly the mild blue notes G and C, and the grating ones are rare', () => {
  const r = rng(11); const count = {}; let n = 0;
  for (let i = 0; i < 4000000; i++) { const b = NOTES[i % NOTES.length]; const o = bend(b, 1, r); if (o !== b) { count[pc(o)] = (count[pc(o)] ?? 0) + 1; n++; } }
  const mild = ((count[10] ?? 0) + (count[3] ?? 0)) / n;           // G and C
  const harsh = ((count[8] ?? 0) + (count[1] ?? 0) + (count[6] ?? 0)) / n; // F, A#, D#
  assert.ok(mild > 0.9, `mild ${mild} ${JSON.stringify(count)}`);
  assert.ok(harsh < 0.07, `harsh ${harsh}`);
});

test('settling leans on A and E in the proportions of all.mp3 (65% anchors, 31% B and C#)', () => {
  const r = rng(5); const c = { 0: 0, 2: 0, 4: 0, 7: 0 }; const N = 80000;
  for (let i = 0; i < N; i++) c[pc(settle(NOTES[i % 4] + 12 * (i % 3), 0.35, r))]++;
  const anchors = (c[0] + c[7]) / N;
  assert.ok(anchors > 0.63 && anchors < 0.72, `anchors ${anchors}`);
  assert.ok(Math.abs(c[2] - c[4]) / N < 0.03, 'B and C# share what is left evenly');
  for (const m of [57, 64, 69, 76]) assert.equal(settle(m, 1), m); // A and E never move
  for (const m of [59, 61]) assert.ok(Math.abs(settle(m, 1) - m) <= 3);
});

test('detune and drag stay small: at most 6 cents (2 at half tension) and a twenty-fifth of a 16th note', () => {
  const r = rng(5);
  for (let i = 0; i < 500; i++) {
    assert.ok(Math.abs(detuneCents(1, r)) <= 6);
    assert.ok(Math.abs(detuneCents(0.5, r)) <= 2);
    const d = dragSixteenths(1, r); assert.ok(d >= 0 && d <= 0.04);
  }
});
