// Voice commands through the browser's Web Speech API (Chrome, Edge, Safari).
// Two ways: push to talk (hold V or the controller's X button; the music ducks while you
// talk), or "always listening" (Settings, or say "always listen"): the microphone stays on
// and every sentence is checked for a command. While the narrator talks, what the microphone
// hears is ignored, so it can't trigger its own commands. Headphones help in this mode.
// Chrome sends speech to a server by default, so this needs internet.

import { showChange, showYear } from '../eic/timeline';
import { RECORDS, type RecordId } from '../config/records';
import { duck } from '../audio/engine';
import {
  announce, describe, goToPlace, muteHumanity, setHumanity, setMode, speak, toggleRecord, toggleSolo, unmuteHumanity, zoomBy,
} from '../state/actions';
import { startStory, stopStory } from '../state/story';
import { nameRegion } from '../config/places';
import { getState, setState } from '../state/store';
import { isSpeaking } from '../audio/speech';

// Minimal typing for the Web Speech API, which TypeScript's DOM types don't include everywhere.
interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
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
    if (always) {
      // act on each finished sentence right away, unless it was the narrator talking
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        const text = e.results[i][0].transcript.trim();
        if (text && !isSpeaking()) void runCommand(text, true);
      }
      return;
    }
    for (let i = 0; i < e.results.length; i++) heard = `${heard} ${e.results[i][0].transcript}`;
  };
  recognition.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      setAlwaysListen(false);
      announce('The microphone is blocked. Allow it in the browser to use voice commands.');
    } else if (e.error !== 'no-speech' && e.error !== 'aborted') announce(`Voice error: ${e.error}`);
  };
  recognition.onend = () => {
    if (always) {
      // the browser stops listening after a while: start again
      window.setTimeout(() => {
        if (!always) return;
        try {
          recognition?.start();
        } catch {
          /* already running */
        }
      }, 250);
      return;
    }
    setState({ listening: false });
    duck(false);
    const text = heard.trim();
    heard = '';
    if (text) void runCommand(text);
  };
  return recognition;
}

let always = false;
/** Keep the microphone on (true) or go back to push to talk (false). */
export function setAlwaysListen(on: boolean) {
  const r = getRecognition();
  if (on && !r) {
    announce('Voice commands need Chrome, Edge or Safari');
    return;
  }
  const s = getState();
  if (s.settings.alwaysListen !== on) setState({ settings: { ...s.settings, alwaysListen: on } });
  if (always === on) return;
  always = on;
  try {
    if (on) {
      r!.interimResults = false;
      r!.start();
      announce('Microphone on. Just say a command, like "play rain" or "lighten our footprint".');
    } else {
      r?.stop();
      announce('Microphone off. Hold V to talk.');
    }
  } catch {
    /* already in that state */
  }
}

export function startListening() {
  const r = getRecognition();
  if (!r) {
    announce('Voice commands need Chrome, Edge or Safari');
    return;
  }
  if (always) return; // already listening all the time
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
  if (recognition && getState().listening && !always) recognition.stop();
}

const RECORD_WORDS: Array<[RegExp, RecordId]> = [
  [/\bocean(s)?\b|\bsea\b|\bcello\b|\bcurrents?\b/, 'ocean'],
  [/\brain\b|\bclouds?\b|\bflute\b|\bweather\b/, 'rain'],
  [/\blightning\b|\bstorms?\b|\bviolin\b/, 'lightning'],
  [/\b(city |night )?lights\b|\bcities\b|\bclarinet\b/, 'lights'],
  [/\bco ?2\b|\bc o 2\b|\bcarbon\b|\bemissions?\b/, 'co2'],
  [/\bno ?x\b|\bnox\b|\bnitrogen\b|\btraffic\b|\bindustry\b|\boboe\b|\bpollution\b/, 'nox'],
];

function findRecords(t: string): RecordId[] {
  return RECORD_WORDS.filter(([re]) => re.test(t)).map(([, id]) => id);
}

const NUMBER_WORDS: Record<string, number> = { zero: 0, ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };

const HELP =
  'Say: play ocean, add lightning, stop rain, solo NOx, scan, probe, listen, lighten our footprint, full footprint, ' +
  'humanity to 50 percent, then, now, what changed, go to Bahrain, zoom in, zoom out, play the story, what am I hearing, or where am I.';

export async function runCommand(raw: string, openMic = false) {
  const t = raw.toLowerCase().replace(/[.,!?]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!openMic) announce(`Heard: ${raw}`);

  if (/always listen|(microphone|mic) on|keep listening/.test(t)) return setAlwaysListen(true);
  if (/stop listening|(microphone|mic) off/.test(t)) return setAlwaysListen(false);
  if (/how (does it|do you|it) work|how it works/.test(t)) return setState({ howOpen: true });
  if (/\bhelp\b|what can i say/.test(t)) return speak(HELP);
  if (/what am i hearing|what's playing|what is playing|describe/.test(t)) return describe('speech');
  if (/where am i/.test(t)) {
    const { focus } = getState();
    return speak(`You are listening to ${nameRegion(focus.lat, focus.lon, focus.zoom)}.`);
  }
  // "full footprint" first: it must not be read as "lighten"
  if (/\bfull footprint\b|\b(restore|bring back|heavy|heavier) (our |the )?footprint\b|\b(un ?mute|bring) (humanity|us|people)( back)?\b|\bunmute\b/.test(t)) return unmuteHumanity();
  if (/\blight(en)? (our |the )?footprint\b|\btread lightly\b|\bmute (humanity|us|people)\b|\bmute\b/.test(t)) return muteHumanity();

  const hum = t.match(/humanity (?:to |at )?(\d+|[a-z]+)\s*(?:percent|%)?/);
  if (hum) {
    const n = Number.isNaN(Number(hum[1])) ? NUMBER_WORDS[hum[1]] : Number(hum[1]);
    if (n != null) return setHumanity(n / 100);
  }

  // city lights through time: "then", "now", "what changed"
  if (/\bwhat changed\b|\bshow (me )?(the )?change\b|\bthe difference\b/.test(t)) {
    if (!getState().playing.lights) await toggleRecord('lights', true);
    return speak(showChange('lights', true) ?? '');
  }
  if (/^(show (me )?|go )?(back )?then$|\b(in |back in )?2012\b|\bback then\b/.test(t)) {
    if (!getState().playing.lights) await toggleRecord('lights', true);
    return speak(showYear('lights', 'then') ?? '');
  }
  if (/^(show (me )?)?(now|today)$|\b(in )?2023\b|\bright now\b/.test(t)) {
    if (!getState().playing.lights) await toggleRecord('lights', true);
    return speak(showYear('lights', 'now') ?? '');
  }

  if (/\b(story|tour)\b/.test(t)) return /\bstop\b/.test(t) ? stopStory() : void startStory();
  if (/\bscan\b|\bneedle\b/.test(t)) return setMode('scan');
  if (/\bprobe\b|\bpoint\b/.test(t)) return setMode('probe');
  if (/^listen\b|\blisten mode\b/.test(t)) return setMode('listen');
  if (/zoom in|closer/.test(t)) return zoomBy(1.8);
  if (/zoom out|further|farther/.test(t)) return zoomBy(1 / 1.8);

  const recs = findRecords(t);
  if (recs.length) {
    if (/\bsolo\b|\bonly\b/.test(t)) return toggleSolo(recs[0]);
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

  // with the microphone always on, people talk to each other too: stay quiet about the rest
  if (!openMic) speak(`Sorry, I didn't catch that. Say help to hear the commands.`);
}
