// Run: node --test tests/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bend, bendChance, detuneCents, dragSixteenths, settle } from '../src/audio/harmony.ts';

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

test('bend chance rises with tension but stays tiny: about 1 in 110 at the most', () => {
  const c = [0, 0.25, 0.5, 0.75, 1].map(bendChance);
  for (let i = 1; i < c.length; i++) assert.ok(c[i] > c[i - 1]);
  assert.ok(c[4] > 0.007 && c[4] < 0.012 && c[2] > 0.0025 && c[2] < 0.006, JSON.stringify(c));
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

test('at full tension only about one note in 110 is bent', () => {
  const r = rng(3); let bent = 0; const N = 800000;
  for (let i = 0; i < N; i++) { const b = NOTES[i % NOTES.length]; if (bend(b, 1, r) !== b) bent++; }
  const share = bent / N;
  assert.ok(share > 0.007 && share < 0.0115, `share ${share}`);
});

test('the bends that do happen are mostly the mild blue notes G and C, and the grating ones are rare', () => {
  const r = rng(11); const count = {}; let n = 0;
  for (let i = 0; i < 1500000; i++) { const b = NOTES[i % NOTES.length]; const o = bend(b, 1, r); if (o !== b) { count[pc(o)] = (count[pc(o)] ?? 0) + 1; n++; } }
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

test('detune and drag stay tiny: at most 3 cents and a twelfth of a 16th note', () => {
  const r = rng(5);
  for (let i = 0; i < 500; i++) { assert.ok(Math.abs(detuneCents(1, r)) <= 3); const d = dragSixteenths(1, r); assert.ok(d >= 0 && d <= 0.08); }
});
