// "Play the story": a guided tour of about 90 seconds. It flies between places, turns
// records on, switches listening modes and ends by muting humanity. It is the demo, and the
// hands-free way in for screen-reader users (the narration is spoken when "Narrate" is on).

import type { RecordId } from '../config/records';
import type { Mode } from './store';
import { getState, setState } from './store';
import { announce, ensureAudio, fadeHumanity, goToPlace, resetView, setMode, toggleRecord } from './actions';
import { LINES, say, stopSpeaking } from '../audio/speech';

interface Step {
  text: string;
  records: RecordId[]; // exactly these play during the step
  place?: string;
  mode?: Mode;
  humanity?: number;
  ms: number;
}

const STEPS: Step[] = [
  { text: LINES['story-0'], records: ['ocean'], place: 'the whole planet', mode: 'listen', humanity: 1, ms: 9000 },
  { text: LINES['story-1'], records: ['ocean'], place: 'the Gulf Stream', ms: 10000 },
  { text: LINES['story-2'], records: ['ocean', 'rain'], place: 'India', ms: 10000 },
  { text: LINES['story-3'], records: ['rain', 'lightning'], place: 'the Congo Basin', mode: 'scan', ms: 10000 },
  { text: LINES['story-4'], records: ['ocean', 'lights'], place: 'the Nile Delta', mode: 'listen', ms: 10000 },
  { text: LINES['story-5'], records: ['co2', 'nox'], place: 'eastern China', ms: 10000 },
  { text: LINES['story-6'], records: ['ocean', 'rain', 'lights', 'co2', 'nox'], place: 'Bahrain', ms: 10000 },
  { text: LINES['story-7'], records: ['ocean', 'rain', 'lightning', 'lights', 'co2', 'nox'], place: 'the whole planet', humanity: 0, ms: 12000 },
  { text: LINES['story-8'], records: ['ocean', 'rain', 'lightning', 'lights', 'co2', 'nox'], ms: 9000 },
];

let timer = 0;

async function run(i: number) {
  const st = getState();
  if (!st.story.running) return;
  if (i >= STEPS.length) return stopStory(true);
  const step = STEPS[i];
  setState({ story: { running: true, step: i }, caption: step.text, solo: null });
  for (const id of ['ocean', 'rain', 'lightning', 'lights', 'co2', 'nox'] as RecordId[]) {
    const want = step.records.includes(id);
    if (getState().playing[id] !== want) await toggleRecord(id, want);
  }
  if (step.place === 'the whole planet') resetView();
  else if (step.place) goToPlace(step.place);
  if (step.mode) setMode(step.mode);
  if (step.humanity != null) fadeHumanity(step.humanity, step.humanity === 0 ? 5000 : 800);
  announce(step.text);
  const seconds = getState().settings.narrate ? await say(`story-${i}`) : 0;
  if (!getState().story.running) return;
  timer = window.setTimeout(() => void run(i + 1), Math.max(step.ms, seconds * 1000 + 2500));
}

export async function startStory() {
  await ensureAudio();
  window.clearTimeout(timer);
  setState({ story: { running: true, step: 0 } });
  await run(0);
}

export function stopStory(finished = false) {
  window.clearTimeout(timer);
  stopSpeaking();
  setState({ story: { running: false, step: 0 } });
  if (!finished) announce('Story stopped');
}

export const storyLength = STEPS.length;
