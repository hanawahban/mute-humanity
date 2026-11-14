// One shared set of actions. The dock buttons, keyboard, voice and Xbox controller all call
// these, so a new input never needs to touch the audio or UI code.

import { HOTSPOTS, PLACES, findPlace, nameRegion } from '../config/places';
import { RECORDS, RECORD_BY_ID, type RecordId } from '../config/records';
import { getState, setState, visible, type Mode } from './store';
import { playIntro, startAudio } from '../audio/engine';
import { flyTo, moveBy, zoomAt } from '../map/camera';
import { cue } from '../input/haptics';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function announce(text: string) {
  // Re-setting the same text would not be re-read by screen readers, so add an invisible change.
  const prev = getState().announcement;
  setState({ announcement: prev === text ? `${text}​` : text });
}

export async function ensureAudio() {
  if (!getState().audioOn) {
    await startAudio();
    setState({ audioOn: true });
    playIntro();
  }
}

export async function toggleRecord(id: RecordId, on?: boolean) {
  await ensureAudio();
  const { playing, order, solo } = getState();
  const next = on ?? !playing[id];
  if (next === playing[id]) return;
  setState({
    playing: { ...playing, [id]: next },
    order: next ? [...order.filter((x) => x !== id), id] : order.filter((x) => x !== id),
    selected: id,
    solo: solo === id && !next ? null : solo,
  });
  const rec = RECORD_BY_ID[id];
  const shown = visible().includes(id);
  announce(next ? `${rec.name} playing. ${rec.hear}${shown ? '' : ' Sound only: two layers are already on the map.'}` : `${rec.name} stopped`);
  cue(next ? 'on' : 'off');
}

export function selectRecord(delta: number) {
  const ids = RECORDS.map((r) => r.id);
  const i = ids.indexOf(getState().selected);
  const next = ids[(i + delta + ids.length) % ids.length];
  setState({ selected: next });
  cue('select');
  announce(`${RECORD_BY_ID[next].name}, ${getState().playing[next] ? 'playing' : 'stopped'}`);
}

/** Hear (and see) only one record. */
export function toggleSolo(id: RecordId = getState().selected) {
  const { solo, playing } = getState();
  if (solo === id) {
    setState({ solo: null });
    announce('Solo off, all records back');
    return;
  }
  if (!playing[id]) void toggleRecord(id, true);
  setState({ solo: id });
  announce(`Solo: ${RECORD_BY_ID[id].name}`);
}

/** Put a record on top of the map (it becomes one of the two drawn layers). */
export function bringToTop(id: RecordId) {
  const { order, playing } = getState();
  if (!playing[id]) return;
  setState({ order: [...order.filter((x) => x !== id), id], selected: id });
}

const MODE_TEXT: Record<Mode, string> = {
  listen: 'Listen: you hear everything in view.',
  scan: 'Scan: a needle sweeps across the view. Higher on screen is a higher note.',
  probe: 'Probe: you hear the spot under the cursor. Move it with the mouse or arrow keys.',
};

export function setMode(mode: Mode) {
  setState({ mode, scanX: mode === 'scan' ? 0 : null });
  announce(MODE_TEXT[mode]);
  cue('flip');
}

export function cycleMode() {
  const order: Mode[] = ['listen', 'scan', 'probe'];
  setMode(order[(order.indexOf(getState().mode) + 1) % order.length]);
}

export function setHumanity(v: number, quiet = false) {
  const h = clamp(v, 0, 1);
  setState({ humanity: h, lastHumanity: h > 0 ? h : getState().lastHumanity });
  if (!quiet) announce(`Humanity ${Math.round(h * 100)} percent`);
}

let fadeTimer = 0;
/** Fade humanity to a value over a few seconds: the lever moves on its own. */
export function fadeHumanity(to: number, ms = 3000) {
  window.clearInterval(fadeTimer);
  const from = getState().humanity;
  const t0 = performance.now();
  fadeTimer = window.setInterval(() => {
    const t = Math.min(1, (performance.now() - t0) / ms);
    setHumanity(from + (to - from) * t, true);
    if (t >= 1) window.clearInterval(fadeTimer);
  }, 50);
}

export function muteHumanity() {
  const { humanity } = getState();
  setState({ lastHumanity: humanity > 0 ? humanity : getState().lastHumanity });
  fadeHumanity(0, 2500);
  announce('Humanity muted. Listen to the planet without us.');
  cue('mute');
}

export function unmuteHumanity() {
  fadeHumanity(getState().lastHumanity || 1, 1500);
  announce('Humanity is back.');
  cue('unmute');
}

export function toggleMuteHumanity() {
  if (getState().humanity > 0) muteHumanity();
  else unmuteHumanity();
}

export function panBy(dLat: number, dLon: number) {
  moveBy(dLat, dLon);
}

/** Move the probe (Probe mode), in degrees. */
export function moveProbe(dLat: number, dLon: number) {
  const p = getState().probe;
  let lon = p.lon + dLon;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  setState({ probe: { lat: clamp(p.lat + dLat, -85, 85), lon } });
}

export function setProbe(lat: number, lon: number) {
  setState({ probe: { lat: clamp(lat, -85, 85), lon } });
}

/** Zoom by a factor, optionally keeping a point (under the cursor) fixed. */
export function zoomBy(factor: number, anchor?: { lat: number; lon: number }) {
  if (!zoomAt(factor, anchor)) cue('edge');
}

export function resetView() {
  flyTo({ lat: 15, lon: 20, zoom: 1 });
  announce('Whole planet');
}

export function goToPlace(text: string): boolean {
  const place = findPlace(text);
  if (!place) return false;
  flyTo({ lat: place.lat, lon: place.lon, zoom: place.zoom });
  setState({ probe: { lat: place.lat, lon: place.lon } });
  announce(`Flying to ${place.name}`);
  return true;
}

let hotspotIndex = -1;
/** Jump through the selected record's curated places. */
export function nextHotspot(delta = 1) {
  const names = HOTSPOTS[getState().selected] ?? [];
  if (!names.length) return;
  hotspotIndex = (hotspotIndex + delta + names.length) % names.length;
  goToPlace(names[hotspotIndex]);
}

const WORDS: Record<RecordId, [string, string, string]> = {
  ocean: ['cold', 'mild', 'warm'],
  rain: ['dry', 'light rain', 'heavy rain'],
  lightning: ['no lightning', 'some lightning', 'lots of lightning'],
  lights: ['dark', 'some lights', 'bright lights'],
  co2: ['low emissions', 'medium emissions', 'high emissions'],
  nox: ['clean air', 'some pollution', 'heavy pollution'],
};
export const describeValue = (id: RecordId, v: number) => WORDS[id][v > 0.6 ? 2 : v > 0.25 ? 1 : 0];

/** The text for "what am I hearing?", and for the caption line. */
export function describeNow(): string {
  const s = getState();
  const place = s.mode === 'probe'
    ? `At ${nameRegion(s.probe.lat, s.probe.lon, 4)}`
    : `${s.mode === 'scan' ? 'Scanning' : 'Listening to'} ${nameRegion(s.focus.lat, s.focus.lon, s.focus.zoom)}`;
  const on = RECORDS.filter((r) => s.playing[r.id] && (!s.solo || s.solo === r.id));
  if (!on.length) return `${place}. Nothing playing: pick a record.`;
  const parts = on.map((r) => {
    const l = s.levels[r.id];
    const v = s.mode === 'probe' ? s.probeValues[r.id] ?? null : l?.raw ?? null;
    const muted = r.side === 'human' && s.humanity === 0 ? ' (muted)' : '';
    if (v == null) return `${r.short}: no data here${muted}`;
    const clouds = r.id === 'rain' && (l?.second ?? 0) > 0.08 ? ', cloudy' : '';
    return `${r.short}: ${describeValue(r.id, v)}${clouds}${muted}`;
  });
  return `${place}. ${parts.join(' · ')}`;
}

export function speak(text: string) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.02;
  window.speechSynthesis.speak(u);
}

/**
 * Keyboard users (often with a screen reader) get it through the live region.
 * Voice and controller users get it spoken by the browser. Never both, so it isn't read twice.
 */
export function describe(via: 'screen-reader' | 'speech') {
  const text = describeNow().replace(/·/g, '.');
  if (via === 'speech') speak(text);
  else announce(text);
}

export const placeNames = () => PLACES.map((p) => p.name);
