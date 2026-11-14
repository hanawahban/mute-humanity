// Keyboard control for the whole app. Switch devices send key presses too, so they work here.
//
//   1-6           play/stop a record          F       flip the chosen record (side A / B)
//   Left/Right    previous/next year          Up/Down humanity lever
//   M             mute / unmute humanity      P       play/pause the 75-year timeline
//   + / -         zoom in / out               Shift + arrows  move around the map
//   D             "what am I hearing?"        V (hold) talk: voice command
//   0             whole planet                C captions, H help
//
// When a slider or text field has focus, it keeps its own arrow keys.

import { RECORDS } from '../config/records';
import {
  announce, describe, flipRecord, nudgeYear, panBy, resetView, setAutoplay, setHumanity, toggleMuteHumanity, toggleRecord, zoomBy,
} from '../state/actions';
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
    if (s.helpOpen) return; // the dialog has its own keys (Tab, Escape)
    const arrowsTaken = ownsArrows(e.target);

    if (/^[1-6]$/.test(e.key)) {
      void toggleRecord(RECORDS[Number(e.key) - 1].id);
      e.preventDefault();
      return;
    }
    if (e.shiftKey && e.key.startsWith('Arrow')) {
      const step = 6 / s.focus.zoom;
      if (e.key === 'ArrowUp') panBy(step, 0);
      if (e.key === 'ArrowDown') panBy(-step, 0);
      if (e.key === 'ArrowLeft') panBy(0, -step * 1.5);
      if (e.key === 'ArrowRight') panBy(0, step * 1.5);
      e.preventDefault();
      return;
    }
    if (!arrowsTaken) {
      if (e.key === 'ArrowLeft') return void (nudgeYear(-1), e.preventDefault());
      if (e.key === 'ArrowRight') return void (nudgeYear(1), e.preventDefault());
      if (e.key === 'ArrowUp') return void (setHumanity(s.humanity + 0.1), e.preventDefault());
      if (e.key === 'ArrowDown') return void (setHumanity(s.humanity - 0.1), e.preventDefault());
    }
    if (arrowsTaken && (e.target as HTMLInputElement).type === 'text') return;

    switch (e.key.toLowerCase()) {
      case 'm':
        toggleMuteHumanity();
        break;
      case 'f':
        void flipRecord(s.selected);
        break;
      case 'p':
        setAutoplay(!s.autoplay);
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
      case 'h':
      case '?':
        setState({ helpOpen: true });
        break;
      case 'v':
        if (!e.repeat) startListening();
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
