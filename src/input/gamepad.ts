// Xbox controller input, through the browser Gamepad API. Vibration lives in haptics.ts.
// Mac: use Chrome and a USB cable. Press any button once after the page loads so the
// browser reveals the controller.
//
// Controls (standard mapping):
//   D-pad left/right  choose a record        A  play/stop the chosen record
//   D-pad up/down     humanity lever         Y  Listen -> Scan -> Probe
//   LT / RT           previous / next place for the chosen record
//   Left stick        move the map (the probe, in Probe mode)
//   LB / RB or right stick  zoom out / in    View  solo the chosen record
//   B                 "what am I hearing?" (spoken)
//   X (hold)          talk: voice command
//   Start             play / stop the story

import {
  announce, cycleMode, describe, moveProbe, nextHotspot, panBy, selectRecord, setHumanity, toggleRecord, toggleSolo, zoomBy,
} from '../state/actions';
import { startStory, stopStory } from '../state/story';
import { getState, setState } from '../state/store';
import { startListening, stopListening } from './voice';

const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

let padIndex: number | null = null;
let prevPressed: boolean[] = [];
let prevTriggers: [number, number] = [0, 0];

export function initGamepad() {
  window.addEventListener('gamepadconnected', (e) => {
    padIndex = e.gamepad.index;
    const canRumble = !!e.gamepad.vibrationActuator;
    setState({ controller: e.gamepad.id || 'Controller' });
    announce(`Controller connected${canRumble ? ', vibration on' : ', but this browser cannot vibrate it'}`);
  });
  window.addEventListener('gamepaddisconnected', (e) => {
    if (e.gamepad.index === padIndex) padIndex = null;
    setState({ controller: null });
    announce('Controller disconnected');
  });
  const loop = () => {
    poll();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function currentPad(): Gamepad | null {
  if (padIndex == null) return null;
  return navigator.getGamepads()[padIndex] ?? null;
}

export const isControllerConnected = () => currentPad() != null;

function poll() {
  const gp = currentPad();
  if (!gp) return;
  const pressed = gp.buttons.map((b) => b.pressed);
  const down = (i: number) => pressed[i] && !prevPressed[i];
  const up = (i: number) => !pressed[i] && prevPressed[i];
  const s = getState();

  if (down(BTN.LEFT)) selectRecord(-1);
  if (down(BTN.RIGHT)) selectRecord(1);
  if (down(BTN.A)) void toggleRecord(s.selected);
  if (down(BTN.Y)) cycleMode();
  if (down(BTN.VIEW)) toggleSolo();
  if (down(BTN.UP)) setHumanity(Math.round((s.humanity + 0.1) * 10) / 10);
  if (down(BTN.DOWN)) setHumanity(Math.round((s.humanity - 0.1) * 10) / 10);
  if (down(BTN.B)) describe('speech');
  if (down(BTN.START)) {
    if (s.story.running) stopStory();
    else void startStory();
  }
  if (down(BTN.X)) startListening();
  if (up(BTN.X)) stopListening();
  if (down(BTN.LB)) zoomBy(1 / 1.5);
  if (down(BTN.RB)) zoomBy(1.5);

  // Triggers jump between the chosen record's places.
  const lt = gp.buttons[BTN.LT]?.value ?? 0;
  const rt = gp.buttons[BTN.RT]?.value ?? 0;
  const prevLt = prevTriggers[0];
  const prevRt = prevTriggers[1];
  if (lt > 0.6 && prevLt <= 0.6) nextHotspot(-1);
  if (rt > 0.6 && prevRt <= 0.6) nextHotspot(1);
  prevTriggers = [lt, rt];

  // Left stick moves the map.
  const [ax, ay] = [gp.axes[0] ?? 0, gp.axes[1] ?? 0];
  const dead = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
  if (dead(ax) || dead(ay)) {
    if (s.mode === 'probe') moveProbe(-dead(ay) * 1.2 / s.focus.zoom, dead(ax) * 1.8 / s.focus.zoom);
    else panBy(-dead(ay) * 2 / s.focus.zoom, dead(ax) * 3 / s.focus.zoom);
  }
  // Right stick up/down zooms smoothly.
  const rz = dead(gp.axes[3] ?? 0);
  if (rz) zoomBy(Math.exp(-rz * 0.05));

  prevPressed = pressed;
}
