// Spoken words. The story and key moments use pre-recorded narration made with Kokoro, an open
// neural voice (scripts/make_voice.py), so they sound human. Anything generated on the fly
// ("what am I hearing?") uses the most natural voice the computer has: on a Mac, a Premium or
// Enhanced Siri voice if one is installed (System Settings > Accessibility > Spoken Content).

import narration from '../config/narration.json';
import { duck } from './engine';
import { asset } from '../config/asset';

export const LINES = narration.lines as Record<string, string>;

let current: HTMLAudioElement | null = null;

/** Play a recorded line. Resolves with its length in seconds (0 if it couldn't play). */
export function say(id: string): Promise<number> {
  stopSpeaking();
  const a = new Audio(asset(`/voice/${id}.mp3`));
  current = a;
  return new Promise((resolve) => {
    a.addEventListener('loadedmetadata', () => resolve(a.duration || 0), { once: true });
    a.addEventListener('error', () => resolve(0), { once: true });
    a.addEventListener('ended', () => {
      if (current === a) duck(false);
    });
    duck(true, 0.28);
    void a.play().catch(() => resolve(0));
  });
}

let queueId = 0;
/** Play several recorded lines one after another (cancels any line already playing). */
export async function sayQueue(ids: string[]) {
  const me = ++queueId;
  for (const id of ids) {
    if (me !== queueId) return;
    const seconds = await say(id);
    if (!seconds) continue;
    await new Promise<void>((resolve) => {
      const a = current;
      if (!a) return resolve();
      a.addEventListener('ended', () => resolve(), { once: true });
      a.addEventListener('pause', () => resolve(), { once: true });
    });
  }
}

export const hasLine = (id: string) => id in LINES;

let quietUntil = 0;
/** Is the narrator (or the system voice) talking, or did it just stop? Voice commands ignore that. */
export const isSpeaking = () =>
  (!!current && !current.paused && !current.ended) || (typeof window !== 'undefined' && !!window.speechSynthesis?.speaking) || performance.now() < quietUntil;
export const markSpoke = () => (quietUntil = performance.now() + 800);

export function stopSpeaking() {
  current?.pause();
  current = null;
  window.speechSynthesis?.cancel();
  duck(false);
}

const PREFERRED = [/premium/i, /enhanced/i, /natural/i, /neural/i, /^(ava|zoe|samantha|allison|evan|nathan|serena|daniel)\b/i, /google (uk|us) english/i];
let best: SpeechSynthesisVoice | null = null;
function bestVoice(): SpeechSynthesisVoice | null {
  if (best) return best;
  const voices = window.speechSynthesis?.getVoices().filter((v) => v.lang.startsWith('en')) ?? [];
  for (const re of PREFERRED) {
    const v = voices.find((x) => re.test(x.name));
    if (v) return (best = v);
  }
  return voices.find((v) => v.default) ?? voices[0] ?? null;
}
if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.onvoiceschanged = () => (best = null);

/** Speak any text with the best system voice. */
export function speakText(text: string) {
  if (!('speechSynthesis' in window)) return;
  stopSpeaking();
  const u = new SpeechSynthesisUtterance(text);
  const v = bestVoice();
  if (v) u.voice = v;
  u.rate = 0.98;
  u.pitch = 1;
  u.onend = () => {
    duck(false);
    markSpoke();
  };
  duck(true, 0.28);
  window.speechSynthesis.speak(u);
}
