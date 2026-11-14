// "Play the story": a guided listen of about two and a half minutes, with very few words.
// Each Earth record plays alone first, zoomed into wherever NASA's map is densest right now,
// then joins the others. Then humanity, one record at a time, then all of us at once, loud
// and out of key. Then the lever: humanity is muted and the Earth is left, in tune.
// The music ducks under the narrator. It is also the hands-free way in for screen-reader users.

import type { RecordId } from '../config/records';
import type { Mode } from './store';
import { getState, setState } from './store';
import { announce, ensureAudio, fadeHumanity, focusDensest, resetView, setMode, toggleRecord } from './actions';
import { LINES, say, stopSpeaking } from '../audio/speech';
import { setHarsh } from '../audio/engine';
import { setHumanBoost } from '../audio/conductor';

interface Step {
  line: string; // narration id; its text is also the caption
  speak?: boolean; // false: caption only, let the music talk
  records: RecordId[]; // exactly these play during the step
  planet?: boolean; // zoom out to the whole planet
  densest?: RecordId; // zoom into where this record is strongest right now
  zoom?: number;
  mode?: Mode;
  humanity?: number;
  harsh?: boolean; // humanity louder and rougher
  ms: number; // at least this long, so the music can be heard
}

const EARTH: RecordId[] = ['ocean', 'rain', 'lightning'];
const ALL: RecordId[] = ['ocean', 'rain', 'lightning', 'lights', 'co2', 'nox'];

const STEPS: Step[] = [
  { line: 'story-0', records: ['ocean'], planet: true, mode: 'listen', humanity: 1, ms: 7000 },
  { line: 'story-1', records: ['ocean'], densest: 'ocean', zoom: 4, ms: 12000 },
  { line: 'story-2', records: ['rain'], densest: 'rain', zoom: 4.5, ms: 12000 },
  { line: 'story-3', records: ['ocean', 'rain'], ms: 10000 },
  { line: 'story-4', records: ['lightning'], densest: 'lightning', zoom: 3.2, ms: 12000 },
  { line: 'story-5', speak: false, records: EARTH, ms: 10000 },
  { line: 'story-6', records: EARTH, planet: true, ms: 12000 },
  { line: 'story-7', records: ['lights'], densest: 'lights', zoom: 4, ms: 11000 },
  { line: 'story-8', records: ['co2'], densest: 'co2', zoom: 4, ms: 10000 },
  { line: 'story-9', records: ['nox'], densest: 'nox', zoom: 4, ms: 10000 },
  { line: 'story-10', records: ALL, planet: true, harsh: true, ms: 14000 },
  { line: 'story-11', records: ALL, humanity: 0, ms: 8000 },
  { line: 'story-12', records: ALL, ms: 14000 },
  { line: 'story-13', records: ALL, ms: 6000 },
];

let timer = 0;
let visited: Array<{ lat: number; lon: number }> = []; // humanity's stops, so each one is somewhere new

async function run(i: number) {
  if (!getState().story.running) return;
  if (i >= STEPS.length) return stopStory(true);
  const step = STEPS[i];
  const text = LINES[step.line];
  setState({ story: { running: true, step: i }, caption: text, solo: null });
  for (const id of ALL) {
    const want = step.records.includes(id);
    if (getState().playing[id] !== want) await toggleRecord(id, want);
  }
  if (step.mode) setMode(step.mode);
  if (step.planet) resetView();
  if (step.densest) {
    const human = step.densest === 'lights' || step.densest === 'co2' || step.densest === 'nox';
    const spot = focusDensest(step.densest, step.zoom ?? 4, 3, human ? visited : []);
    if (!spot) resetView();
    else if (human) visited.push(spot);
  }
  setHarsh(step.harsh ? 1 : 0);
  setHumanBoost(step.harsh ? 1.5 : 1);
  if (step.humanity != null) fadeHumanity(step.humanity, step.humanity === 0 ? 6000 : 800);
  announce(text);
  const seconds = getState().settings.narrate && step.speak !== false ? await say(step.line) : 0;
  if (!getState().story.running) return;
  timer = window.setTimeout(() => void run(i + 1), Math.max(step.ms, seconds * 1000 + 2500));
}

export async function startStory() {
  await ensureAudio();
  window.clearTimeout(timer);
  setState({ story: { running: true, step: 0 } });
  visited = [];
  await run(0);
}

export function stopStory(finished = false) {
  window.clearTimeout(timer);
  stopSpeaking();
  setHarsh(0);
  setHumanBoost(1);
  setState({ story: { running: false, step: 0 } });
  if (!finished) announce('Story stopped');
}

export const storyLength = STEPS.length;
