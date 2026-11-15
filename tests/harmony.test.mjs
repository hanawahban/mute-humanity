// Run: node --test tests/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bend, bendChance, detuneCents, dragSixteenths } from '../src/audio/harmony.ts';

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

test('bend chance rises with tension and stays below one half', () => {
  const c = [0, 0.25, 0.5, 0.75, 1].map(bendChance);
  for (let i = 1; i < c.length; i++) assert.ok(c[i] > c[i - 1]);
  assert.ok(c[4] < 0.5 && c[2] > 0.15 && c[2] < 0.25, JSON.stringify(c));
});

test('a bent note always ends outside the key, within two semitones', () => {
  const r = rng(7);
  for (const base of [57, 59, 61, 64, 66, 69, 71, 73]) { // A major pentatonic notes
    for (let i = 0; i < 400; i++) {
      const out = bend(base, 1, r);
      if (out !== base) { assert.ok(!IN_KEY.has(pc(out)), `${base}->${out}`); assert.ok(Math.abs(out - base) <= 2); }
    }
  }
});

test('at full tension about half the notes are bent, so most stay in the key', () => {
  const r = rng(3); const base = [57, 61, 64, 66, 69];
  let bent = 0; const N = 20000;
  for (let i = 0; i < N; i++) { const b = base[i % 5]; if (bend(b, 1, r) !== b) bent++; }
  const share = bent / N;
  assert.ok(share > 0.4 && share < 0.55, `share ${share}`);
});

test('mild blue notes (C, G) dominate at low tension, harsh ones at high', () => {
  const r = rng(11); const harshShare = (t) => {
    let harsh = 0, bentN = 0;
    for (let i = 0; i < 40000; i++) { const b = [57, 61, 64, 66, 69][i % 5]; const o = bend(b, t, r); if (o !== b) { bentN++; if (![3, 10].includes(pc(o))) harsh++; } }
    return harsh / bentN;
  };
  assert.ok(harshShare(0.2) < harshShare(1), `${harshShare(0.2)} vs ${harshShare(1)}`);
});

test('detune and drag stay small', () => {
  const r = rng(5);
  for (let i = 0; i < 500; i++) { assert.ok(Math.abs(detuneCents(1, r)) <= 34); const d = dragSixteenths(1, r); assert.ok(d >= 0 && d <= 0.3); }
});
