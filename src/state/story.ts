// "Play the story": a guided tour of about 90 seconds. It flies between places, turns
// records on, switches listening modes and ends by muting humanity. It is the demo, and the
// hands-free way in for screen-reader users (the narration is spoken when "Narrate" is on).

import type { RecordId } from '../config/records';
import type { Mode } from './store';
import { getState, setState } from './store';
import { announce, ensureAudio, fadeHumanity, goToPlace, resetView, setMode, speak, toggleRecord } from './actions';

interface Step {
  text: string;
  records: RecordId[]; // exactly these play during the step
  place?: string;
  mode?: Mode;
  humanity?: number;
  ms: number;
}

const STEPS: Step[] = [
  { text: 'This is the Earth Jukebox. Every sound you hear comes from a NASA Earth Information Center map.', records: ['ocean'], place: 'the whole planet', mode: 'listen', humanity: 1, ms: 9000 },
  { text: 'The ocean plays the cello. Warmer water sings higher. Here is the Gulf Stream, carrying warm water north.', records: ['ocean'], place: 'the Gulf Stream', ms: 10000 },
  { text: 'Rain is a flute and clouds are a soft pad. Listen to the rain over India.', records: ['ocean', 'rain'], place: 'India', ms: 10000 },
  { text: 'Lightning strikes like a violin. The needle sweeps the map: every flash it crosses is a note.', records: ['rain', 'lightning'], place: 'the Congo Basin', mode: 'scan', ms: 10000 },
  { text: 'Now, humanity. City lights play a clarinet, out of key with the planet.', records: ['ocean', 'lights'], place: 'the Nile Delta', mode: 'listen', ms: 10000 },
  { text: 'Carbon emissions are a low drone. Traffic and industry are an oboe.', records: ['co2', 'nox'], place: 'eastern China', ms: 10000 },
  { text: 'Here, at home in the Gulf, everything plays together.', records: ['ocean', 'rain', 'lights', 'co2', 'nox'], place: 'Bahrain', ms: 10000 },
  { text: 'Now mute humanity, and listen to the planet without us.', records: ['ocean', 'rain', 'lightning', 'lights', 'co2', 'nox'], place: 'the whole planet', humanity: 0, ms: 12000 },
  { text: 'This is the Earth, in tune. Move the humanity lever to bring us back. Now explore: pick a record, zoom anywhere, and listen.', records: ['ocean', 'rain', 'lightning', 'lights', 'co2', 'nox'], ms: 9000 },
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
  if (getState().settings.narrate) speak(step.text);
  announce(step.text);
  timer = window.setTimeout(() => void run(i + 1), step.ms);
}

export async function startStory() {
  await ensureAudio();
  window.clearTimeout(timer);
  setState({ story: { running: true, step: 0 } });
  await run(0);
}

export function stopStory(finished = false) {
  window.clearTimeout(timer);
  window.speechSynthesis?.cancel();
  setState({ story: { running: false, step: 0 } });
  if (!finished) announce('Story stopped');
}

export const storyLength = STEPS.length;
