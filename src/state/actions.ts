// One shared set of actions. The jukebox buttons, keyboard, voice and Xbox controller
// all call these, so a new input never needs to touch the audio or UI code.

import { findPlace, nameRegion } from '../config/places';
import { RECORDS, RECORD_BY_ID, YEAR_MAX, YEAR_MIN, type RecordId } from '../config/records';
import { getState, setState } from './store';
import { startAudio } from '../audio/engine';
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
  }
}

export async function toggleRecord(id: RecordId, on?: boolean) {
  await ensureAudio();
  const { playing, sideA } = getState();
  const next = on ?? !playing[id];
  setState({
    playing: { ...playing, [id]: next },
    selected: id,
    sideA: next ? sideA : sideA === id ? null : sideA,
  });
  announce(`${RECORD_BY_ID[id].name} ${next ? 'playing' : 'stopped'}`);
  cue(next ? 'on' : 'off');
}

/** Flip a record between side A (its EIC visualization) and side B (the NASA data on the map). */
export async function flipRecord(id: RecordId) {
  await ensureAudio();
  const { sideA, playing } = getState();
  const toA = sideA !== id;
  setState({ sideA: toA ? id : null, playing: { ...playing, [id]: true }, selected: id });
  const rec = RECORD_BY_ID[id];
  announce(toA ? `${rec.name}, side A: ${rec.eic.title}` : `${rec.name}, side B: NASA data on the map`);
  cue('flip');
}

export function selectRecord(delta: number) {
  const ids = RECORDS.map((r) => r.id);
  const i = ids.indexOf(getState().selected);
  const next = ids[(i + delta + ids.length) % ids.length];
  setState({ selected: next });
  cue('select');
  announce(`${RECORD_BY_ID[next].name} selected, ${getState().playing[next] ? 'playing' : 'stopped'}`);
}

export function setYear(year: number, opts: { dragging?: boolean; quiet?: boolean } = {}) {
  const y = clamp(year, YEAR_MIN, YEAR_MAX);
  const prev = getState().year;
  if (opts.dragging && y !== prev) timeCues(prev, y);
  setState({ year: y, dragging: opts.dragging ?? false, month: null });
  if (!opts.quiet && !opts.dragging) announce(`Year ${Math.round(y)}`);
}

/** Vibration notches while scrubbing: each decade, the ends, and where a dataset begins. */
function timeCues(prev: number, y: number) {
  const { data, playing } = getState();
  const lo = Math.min(prev, y);
  const hi = Math.max(prev, y);
  if ((y === YEAR_MIN || y === YEAR_MAX) && prev !== y) return cue('edge');
  for (const rec of RECORDS) {
    const first = data?.layers.get(rec.layer)?.meta.years[0];
    if (playing[rec.id] && first != null && first > lo && first <= hi) {
      announce(`${rec.name} data ${y > prev ? 'begins' : 'ends'}, ${first}`);
      return cue('dataStarts');
    }
  }
  if (Math.floor(prev / 10) !== Math.floor(y / 10)) cue('decade');
}

export function nudgeYear(delta: number) {
  setYear(Math.round(getState().year) + delta);
}

export function setHumanity(v: number, quiet = false) {
  const h = clamp(v, 0, 1);
  setState({ humanity: h, lastHumanity: h > 0 ? h : getState().lastHumanity });
  if (!quiet) announce(`Humanity ${Math.round(h * 100)} percent`);
}

export function muteHumanity() {
  const { humanity } = getState();
  setState({ lastHumanity: humanity > 0 ? humanity : getState().lastHumanity, humanity: 0 });
  announce('Humanity muted. Listen to the planet without us.');
  cue('mute');
}

export function unmuteHumanity() {
  setState({ humanity: getState().lastHumanity || 1 });
  announce('Humanity is back.');
  cue('unmute');
}

export function toggleMuteHumanity() {
  if (getState().humanity > 0) muteHumanity();
  else unmuteHumanity();
}

export function setAutoplay(on: boolean) {
  setState({ autoplay: on });
  if (on && getState().year >= YEAR_MAX - 0.5) setYear(YEAR_MIN, { quiet: true });
  announce(on ? 'Playing 75 years, from 1950 to today' : 'Timeline paused');
}

export function panBy(dLat: number, dLon: number) {
  moveBy(dLat, dLon);
}

/** Zoom by a factor, optionally keeping a point (under the cursor) fixed. */
export function zoomBy(factor: number, anchor?: { lat: number; lon: number }) {
  if (!zoomAt(factor, anchor)) cue('edge');
}

export function resetView() {
  flyTo({ lat: 10, lon: 0, zoom: 1 });
  announce('Whole planet');
}

export function goToPlace(text: string): boolean {
  const place = findPlace(text);
  if (!place) return false;
  flyTo({ lat: place.lat, lon: place.lon, zoom: place.zoom });
  announce(`Flying to ${place.name}`);
  return true;
}

const level = (v: number) => (v > 0.66 ? 'strong' : v > 0.33 ? 'medium' : v > 0.05 ? 'weak' : 'silent');

/** The text for "what am I hearing?", and for the live caption line. */
export function describeNow(): string {
  const { mix, focus, year, month, playing, sideA, humanity } = getState();
  const place = nameRegion(focus.lat, focus.lon, focus.zoom);
  const when = month != null
    ? `${new Date(2000, month, 1).toLocaleString('en', { month: 'long' })} ${Math.floor(year)}`
    : `${Math.round(year)}`;
  const parts = RECORDS.filter((r) => playing[r.id])
    .map((r) => {
      if (sideA === r.id) return { r, text: `${r.instrument} from the EIC visualization ${r.eic.title}`, v: 1 };
      const m = mix[r.id];
      if (!m) return { r, text: `${r.instrument}, no data for this year`, v: -1 };
      return { r, text: `${r.instrument}, ${level(m.value)}`, v: m.value };
    })
    .sort((a, b) => b.v - a.v);
  if (parts.length === 0) return `Nothing playing. ${place.charAt(0).toUpperCase() + place.slice(1)}, ${when}. Press a record to start.`;
  const muted = humanity === 0 ? ' Humanity is muted.' : '';
  const text = `${place}, ${when}: ${parts.map((p) => p.text).join('. ')}.${muted}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function speak(text: string) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  window.speechSynthesis.speak(u);
}

/**
 * Keyboard users (often with a screen reader) get it through the live region.
 * Voice and controller users get it spoken by the browser. Never both, so it isn't read twice.
 */
export function describe(via: 'screen-reader' | 'speech') {
  const text = describeNow();
  if (via === 'speech') speak(text);
  else announce(text);
}
