// The team's rule: synths are for human-made things, traditional instruments for nature.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { RECORDS } from '../src/config/records.ts';

const isSynth = (id) => id.startsWith('synth');

test('every human record plays only synths', () => {
  for (const r of RECORDS.filter((r) => r.side === 'human')) {
    assert.ok(isSynth(r.instrument), `${r.id} uses ${r.instrument}`);
    if (r.second) assert.ok(isSynth(r.second.instrument), `${r.id} second voice uses ${r.second.instrument}`);
  }
});

test('every Earth record plays only traditional instruments', () => {
  for (const r of RECORDS.filter((r) => r.side === 'earth')) {
    assert.ok(!isSynth(r.instrument) && r.instrument !== 'all', `${r.id} uses ${r.instrument}`);
    if (r.second) assert.ok(!isSynth(r.second.instrument), `${r.id} second voice uses ${r.second.instrument}`);
  }
});

test('the three synths are each used by a different human record', () => {
  const used = RECORDS.filter((r) => r.side === 'human').map((r) => r.instrument).sort();
  assert.deepEqual(used, ['synth1', 'synth2', 'synth3']);
});

test('the harmony bed under the Earth uses no synths', () => {
  const engine = readFileSync(new URL('../src/audio/engine.ts', import.meta.url), 'utf8');
  for (const line of engine.split('\n').filter((l) => /channels\.set\('(bed|sub)'/.test(l))) {
    assert.ok(!/synth/.test(line), line.trim());
  }
});

test("the story's finale plays exactly what manual play-all does: no extra volume or distortion for humanity", () => {
  for (const f of ['../src/state/story.ts', '../src/audio/conductor.ts', '../src/audio/engine.ts']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.ok(!/setHarsh|setHumanBoost|humanBoost|harsh:/.test(src), `${f} still has a story-only boost`);
  }
});
