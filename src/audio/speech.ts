// Spoken words. The story and key moments use pre-recorded narration made with Kokoro, an open
// neural voice (scripts/make_voice.py), so they sound human. Anything generated on the fly
// ("what am I hearing?") uses the most natural voice the computer has: on a Mac, a Premium or
// Enhanced Siri voice if one is installed (System Settings > Accessibility > Spoken Content).

import narration from '../config/narration.json';
import { duck } from './engine';

export const LINES = narration.lines as Record<string, string>;

let current: HTMLAudioElement | null = null;

/** Play a recorded line. Resolves with its length in seconds (0 if it couldn't play). */
export function say(id: string): Promise<number> {
  stopSpeaking();
  const a = new Audio(`/voice/${id}.mp3`);
  current = a;
  return new Promise((resolve) => {
    a.addEventListener('loadedmetadata', () => resolve(a.duration || 0), { once: true });
    a.addEventListener('error', () => resolve(0), { once: true });
    a.addEventListener('ended', () => {
      if (current === a) duck(false);
    });
    duck(true, 0.45);
    void a.play().catch(() => resolve(0));
  });
}

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
  u.onend = () => duck(false);
  duck(true, 0.45);
  window.speechSynthesis.speak(u);
}
