// Voice commands through the browser's Web Speech API (Chrome or Edge).
// Push to talk: hold the V key or the controller's X button. The music ducks while
// listening so the microphone doesn't hear it. Chrome sends speech to a server by
// default, so this needs internet unless on-device recognition is available.

import { RECORDS, YEAR_MAX, YEAR_MIN, type RecordId } from '../config/records';
import { duck } from '../audio/engine';
import {
  announce, describe, flipRecord, goToPlace, muteHumanity, setAutoplay, setHumanity, setYear, speak,
  toggleRecord, unmuteHumanity, zoomBy,
} from '../state/actions';
import { nameRegion } from '../config/places';
import { getState, setState } from '../state/store';

// Minimal typing for the Web Speech API, which TypeScript's DOM types don't include everywhere.
interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

let recognition: RecognitionLike | null = null;
let heard = '';

export const voiceSupported = () =>
  'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;

function getRecognition(): RecognitionLike | null {
  if (recognition) return recognition;
  const w = window as unknown as Record<string, new () => RecognitionLike>;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  recognition = new Ctor();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.continuous = true;
  recognition.onresult = (e) => {
    for (let i = 0; i < e.results.length; i++) heard = `${heard} ${e.results[i][0].transcript}`;
  };
  recognition.onerror = (e) => {
    if (e.error !== 'no-speech' && e.error !== 'aborted') announce(`Voice error: ${e.error}`);
  };
  recognition.onend = () => {
    setState({ listening: false });
    duck(false);
    const text = heard.trim();
    heard = '';
    if (text) runCommand(text);
  };
  return recognition;
}

export function startListening() {
  const r = getRecognition();
  if (!r) {
    announce('Voice commands need Chrome or Edge');
    return;
  }
  if (getState().listening) return;
  heard = '';
  setState({ listening: true });
  duck(true);
  try {
    r.start();
  } catch {
    /* already started */
  }
}

export function stopListening() {
  if (recognition && getState().listening) recognition.stop();
}

const RECORD_WORDS: Array<[RegExp, RecordId]> = [
  [/\bocean(s)?\b|\bsea\b|\bstrings?\b/, 'ocean'],
  [/\bplants?\b|\bforests?\b|\bgreen\b|\bchoir\b/, 'plants'],
  [/\brain\b|\bpiano\b/, 'rain'],
  [/\bno ?2\b|\bn o 2\b|\bnitrogen\b|\btraffic\b|\bindustry\b|\bdrone\b/, 'no2'],
  [/\bfires?\b|\bburning\b/, 'fires'],
  [/\bplastics?\b/, 'plastic'],
];

function findRecords(t: string): RecordId[] {
  return RECORD_WORDS.filter(([re]) => re.test(t)).map(([, id]) => id);
}

const NUMBER_WORDS: Record<string, number> = { zero: 0, ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };

const HELP =
  'Say: play ocean, add fires, stop rain, flip ocean, mute humanity, bring humanity back, humanity to 50 percent, ' +
  'go to Bahrain, go to 1985, play the 1990s, zoom in, zoom out, what am I hearing, where am I, play 75 years, or pause.';

export function runCommand(raw: string) {
  const t = raw.toLowerCase().replace(/[.,!?]/g, ' ').replace(/\s+/g, ' ').trim();
  announce(`Heard: ${raw}`);

  if (/\bhelp\b|what can i say/.test(t)) return speak(HELP);
  if (/what am i hearing|what's playing|what is playing|describe/.test(t)) return describe('speech');
  if (/where am i/.test(t)) {
    const { focus } = getState();
    return speak(`You are listening to ${nameRegion(focus.lat, focus.lon, focus.zoom)}, year ${Math.round(getState().year)}.`);
  }
  if (/\b(un ?mute|bring) (humanity|us|people)( back)?\b|\bunmute\b/.test(t)) return unmuteHumanity();
  if (/\bmute (humanity|us|people)\b|\bmute\b/.test(t)) return muteHumanity();

  const hum = t.match(/humanity (?:to |at )?(\d+|[a-z]+)\s*(?:percent|%)?/);
  if (hum) {
    const n = Number.isNaN(Number(hum[1])) ? NUMBER_WORDS[hum[1]] : Number(hum[1]);
    if (n != null) return setHumanity(n / 100);
  }

  const decade = t.match(/\b(?:the )?(19[5-9]0|20[0-2]0)s\b/);
  if (decade) {
    setYear(Number(decade[1]));
    return setAutoplay(true);
  }
  const year = t.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
  if (year) {
    const y = Math.min(YEAR_MAX, Math.max(YEAR_MIN, Number(year[1])));
    setYear(y);
    return speak(`Year ${y}`);
  }

  if (/75 years|seventy five years|whole timeline|play everything in time/.test(t)) {
    setYear(YEAR_MIN, { quiet: true });
    return setAutoplay(true);
  }
  if (/\b(pause|stop the timeline|stop time)\b/.test(t)) return setAutoplay(false);
  if (/zoom in|closer/.test(t)) return zoomBy(1.8);
  if (/zoom out|further|farther/.test(t)) return zoomBy(1 / 1.8);

  const recs = findRecords(t);
  if (recs.length) {
    if (/\b(flip|side a|side b|visuali[sz]ation)\b/.test(t)) return void flipRecord(recs[0]);
    const off = /\b(stop|remove|turn off|silence|off)\b/.test(t);
    recs.forEach((id) => void toggleRecord(id, !off));
    return;
  }
  if (/\b(play all|everything|all records)\b/.test(t)) {
    RECORDS.forEach((r) => void toggleRecord(r.id, true));
    return;
  }

  const go = t.match(/\b(?:go to|fly to|take me to|show me|listen to)\s+(.+)$/);
  if (go && goToPlace(go[1])) return;
  if (goToPlace(t)) return;

  speak(`Sorry, I didn't catch that. Say help to hear the commands.`);
}
