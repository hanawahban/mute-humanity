// Keyboard control for the whole app. Switch devices send key presses too, so they work here.
//
//   1-6           play/stop a record          Left/Right  choose a record
//   Up/Down       humanity lever              M           mute / unmute humanity
//   L / S / P     Listen, Scan, Probe         arrows in Probe mode move the probe
//   G             next place for the record   O           solo the chosen record
//   T             play / stop the story       Shift + arrows  move the map
//   + / - / 0     zoom in, out, whole planet  D           "what am I hearing?"
//   V (hold)      talk: voice command         C captions, H help
//
// When a slider or text field has focus, it keeps its own arrow keys.

import { RECORDS } from '../config/records';
import {
  announce, cycleMode, describe, moveProbe, nextHotspot, panBy, resetView, selectRecord, setHumanity, setMode,
  toggleMuteHumanity, toggleRecord, toggleSolo, zoomBy,
} from '../state/actions';
import { startStory, stopStory } from '../state/story';
import { getState, setState } from '../state/store';
import { startListening, stopListening } from './voice';

function ownsArrows(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return (el as HTMLInputElement).type !== 'checkbox';
  return false;
}

export function initKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const s = getState();
    if (s.helpOpen || s.howOpen) return; // the dialogs have their own keys (Tab, Escape)
    const arrowsTaken = ownsArrows(e.target);

    if (/^[1-6]$/.test(e.key)) {
      void toggleRecord(RECORDS[Number(e.key) - 1].id);
      e.preventDefault();
      return;
    }
    if (e.key.startsWith('Arrow') && !arrowsTaken) {
      const step = 6 / s.focus.zoom;
      const dy = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
      const dx = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (e.shiftKey) panBy(dy * step, dx * step * 1.5);
      else if (s.mode === 'probe') moveProbe(dy * step * 0.5, dx * step * 0.6);
      else if (dx) selectRecord(dx);
      else setHumanity(s.humanity + dy * 0.1);
      e.preventDefault();
      return;
    }
    if (arrowsTaken && (e.target as HTMLInputElement).type === 'text') return;

    switch (e.key.toLowerCase()) {
      case 'm':
        toggleMuteHumanity();
        break;
      case 'l':
        setMode('listen');
        break;
      case 's':
        setMode('scan');
        break;
      case 'p':
        setMode('probe');
        break;
      case 'tab':
        return;
      case 'g':
        nextHotspot(e.shiftKey ? -1 : 1);
        break;
      case 'o':
        toggleSolo();
        break;
      case 't':
        if (s.story.running) stopStory();
        else void startStory();
        break;
      case 'enter':
        if (e.target === document.body) void toggleRecord(s.selected);
        else return;
        break;
      case '+':
      case '=':
        zoomBy(1.5);
        break;
      case '-':
      case '_':
        zoomBy(1 / 1.5);
        break;
      case 'd':
        describe('screen-reader');
        break;
      case '0':
        resetView();
        break;
      case 'c':
        setState({ settings: { ...s.settings, captions: !s.settings.captions } });
        announce(`Captions ${s.settings.captions ? 'off' : 'on'}`);
        break;
      case 'i':
        setState({ howOpen: true });
        break;
      case 'h':
      case '?':
        setState({ helpOpen: true });
        break;
      case 'v':
        if (!e.repeat) startListening();
        break;
      case 'y':
        cycleMode();
        break;
      default:
        return;
    }
    e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    if (e.key.toLowerCase() === 'v') stopListening();
  });
}
