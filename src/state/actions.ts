// One shared set of actions. The dock buttons, keyboard, voice and Xbox controller all call
// these, so a new input never needs to touch the audio or UI code.

import { HOTSPOTS, PLACES, findPlace, nameRegion, nearestPlace } from '../config/places';
import { RECORDS, RECORD_BY_ID, type RecordId } from '../config/records';
import { getState, setState, type Mode } from './store';
import { playIntro, startAudio } from '../audio/engine';
import { hasLine, say, sayQueue, speakText } from '../audio/speech';
import { densest, layers, sample, valueAt } from '../eic/layers';
import { flyTo, moveBy, viewSpan, zoomAt } from '../map/camera';
import { cue, feelSample } from '../input/haptics';

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
  announce(next ? `${rec.name} on. ${rec.hear}` : `${rec.name} off`);
  cue(next ? 'on' : 'off');
}

export function selectRecord(delta: number) {
  const ids = RECORDS.map((r) => r.id);
  const i = ids.indexOf(getState().selected);
  const next = ids[(i + delta + ids.length) % ids.length];
  setState({ selected: next });
  // the controller now feels this record: play its feel once so you learn it
  if (getState().playing[next]) feelSample(next);
  else cue('select');
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

let fadeTimer = 0;

/** Set humanity directly (the slider, voice, controller). Stops any fade in progress. */
export function setHumanity(v: number, quiet = false) {
  window.clearInterval(fadeTimer);
  const h = clamp(v, 0, 1);
  setState({ humanity: h });
  if (!quiet) announce(`Humanity ${Math.round(h * 100)} percent`);
}

/** Fade humanity to a value over a few seconds: the lever moves on its own. */
export function fadeHumanity(to: number, ms = 3000) {
  window.clearInterval(fadeTimer);
  const from = getState().humanity;
  const t0 = performance.now();
  fadeTimer = window.setInterval(() => {
    const t = Math.min(1, (performance.now() - t0) / ms);
    setState({ humanity: clamp(from + (to - from) * t, 0, 1) });
    if (t >= 1) window.clearInterval(fadeTimer);
  }, 50);
}

export function muteHumanity() {
  fadeHumanity(0, 2500);
  announce('Lightening our footprint. Listen to the planet with a light touch.');
  cue('mute');
  if (getState().settings.narrate && !getState().story.running) void say('mute');
}

export function unmuteHumanity() {
  // the lever glides all the way back up
  fadeHumanity(1, 3000);
  announce('Full footprint.');
  cue('unmute');
  if (getState().settings.narrate && !getState().story.running) void say('unmute');
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

/**
 * Fly to wherever this record is strongest right now, read from the NASA frame itself, at a
 * zoom close enough to hear single notes. Returns false if the data isn't loaded yet.
 */
export function focusDensest(id: RecordId, zoom: number, glide = 1, avoid: Array<{ lat: number; lon: number }> = []): { lat: number; lon: number } | null {
  const span = viewSpan(zoom);
  const spot = densest(id, span.lon * 0.6, span.lat * 0.6, avoid);
  if (!spot) return null;
  flyTo({ lat: spot.lat, lon: spot.lon, zoom }, glide);
  setState({ probe: { lat: spot.lat, lon: spot.lon } });
  return spot;
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
const CHANGE_WORDS = ['lights went out', 'no change', 'new lights'];
export const describeValue = (id: RecordId, v: number) =>
  (getState().changeView[id] ? CHANGE_WORDS : WORDS[id])[v > 0.6 ? 2 : v > 0.25 ? 1 : 0];

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
    const muted = r.side === 'human' && s.humanity === 0 ? ' (silent)' : '';
    if (v == null) return `${r.short}: no data here${muted}`;
    const clouds = r.id === 'rain' && (l?.second ?? 0) > 0.08 ? ', cloudy' : '';
    return `${r.short}: ${describeValue(r.id, v)}${clouds}${muted}`;
  });
  return `${place}. ${parts.join(' · ')}`;
}

export function speak(text: string) {
  speakText(text);
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

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const level = (v: number) => (v > 0.6 ? 2 : v > 0.25 ? 1 : 0);

/**
 * Probe a spot: move the probe there and, if asked, say where it is and what each playing
 * record shows there, in the recorded narrator's voice.
 */
export function probeAt(lat: number, lon: number, speakIt: boolean) {
  setProbe(lat, lon);
  const s = getState();
  const near = nearestPlace(lat, lon, 9);
  const ocean = layers.get('ocean');
  if (ocean?.ready && !ocean.sampledAt) sample('ocean', 0);
  const sea = ocean?.sampledAt ? valueAt(ocean.grid, lat, lon, 1) : null;
  const clips: string[] = [near && hasLine(`near-${slug(near.name)}`) ? `near-${slug(near.name)}` : sea != null ? 'over-ocean' : 'over-land'];
  const words: string[] = [near ? `Near ${near.name}.` : sea != null ? 'Over the open ocean.' : 'Over land.'];
  for (const r of RECORDS) {
    if (!s.playing[r.id] || (s.solo && s.solo !== r.id)) continue;
    const l = layers.get(r.id);
    if (!l?.ready) continue;
    if (!l.sampledAt) sample(r.id, 0);
    const v = valueAt(l.grid, lat, lon);
    if (v == null) continue;
    clips.push(`${r.id}-${level(v)}`);
    words.push(`${r.short}: ${describeValue(r.id, v)}.`);
  }
  announce(words.join(' '));
  if (speakIt && s.settings.narrate) void sayQueue(clips);
}

/** Leave the jukebox for the map: the chosen records start playing. */
export async function enterMap() {
  await ensureAudio();
  const on = RECORDS.filter((r) => getState().playing[r.id]);
  if (!on.length) {
    announce('Pick at least one record first');
    return;
  }
  setState({ screen: 'map', paused: false });
  announce(`Playing ${on.map((r) => r.short).join(', ')}. Map view.`);
}

/** Back to the jukebox: the music stops, the picks stay. */
export function backToJukebox() {
  if (getState().story.running) void import('./story').then((m) => m.stopStory());
  setState({ screen: 'jukebox' });
  announce('Back at the jukebox');
}

export function togglePause() {
  const paused = !getState().paused;
  if (paused && getState().story.running) void import('./story').then((m) => m.stopStory());
  setState({ paused });
  announce(paused ? 'Paused' : 'Playing');
}
