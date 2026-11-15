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

test('bend chance rises with tension but stays small: about 1 in 12 at the most', () => {
  const c = [0, 0.25, 0.5, 0.75, 1].map(bendChance);
  for (let i = 1; i < c.length; i++) assert.ok(c[i] > c[i - 1]);
  assert.ok(c[4] > 0.06 && c[4] < 0.1 && c[2] > 0.02 && c[2] < 0.045, JSON.stringify(c));
});

const NOTES = [57, 59, 61, 64, 69, 71, 73, 76]; // A3 B3 C#4 E4 A4 B4 C#5 E5: the four notes Earth and humanity play

test('a bent note always ends outside the key, within two semitones', () => {
  const r = rng(7);
  for (const base of NOTES) {
    for (let i = 0; i < 2000; i++) {
      const out = bend(base, 1, r);
      if (out !== base) { assert.ok(!IN_KEY.has(pc(out)), `${base}->${out}`); assert.ok(Math.abs(out - base) <= 2); }
    }
  }
});

test('at full tension about one note in twelve is bent', () => {
  const r = rng(3); let bent = 0; const N = 40000;
  for (let i = 0; i < N; i++) { const b = NOTES[i % NOTES.length]; if (bend(b, 1, r) !== b) bent++; }
  const share = bent / N;
  assert.ok(share > 0.065 && share < 0.095, `share ${share}`);
});

test('when a note has a choice, bending favours the out-of-key notes all.mp3 uses most', () => {
  const r = rng(11);
  const pick = (base) => { const c = {}; for (let i = 0; i < 200000; i++) { const o = bend(base, 1, r); if (o !== base) c[pc(o)] = (c[pc(o)] ?? 0) + 1; } return c; };
  const fromA = pick(69);   // can bend to A# (weight 0.8) or G (0.4): about 2 to 1
  assert.ok(fromA[1] / fromA[10] > 1.7 && fromA[1] / fromA[10] < 2.3, JSON.stringify(fromA));
  const fromE = pick(64);   // F (0.5) or D# (0.1): about 5 to 1
  assert.ok(fromE[8] / fromE[6] > 4 && fromE[8] / fromE[6] < 6, JSON.stringify(fromE));
  const fromB = pick(71);   // A# (0.8) or C (0.2): about 4 to 1
  assert.ok(fromB[1] / fromB[3] > 3.3 && fromB[1] / fromB[3] < 4.8, JSON.stringify(fromB));
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

test('detune and drag stay small: at most 9 cents and a sixth of a 16th note', () => {
  const r = rng(5);
  for (let i = 0; i < 500; i++) { assert.ok(Math.abs(detuneCents(1, r)) <= 9); const d = dragSixteenths(1, r); assert.ok(d >= 0 && d <= 0.15); }
});
