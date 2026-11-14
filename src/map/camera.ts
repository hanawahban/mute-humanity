// Smooth map movement. Zoom, fly-to and the zoom buttons set a target; the map eases toward it
// every frame. Dragging moves the map directly. The store's `focus` is always where the map
// is right now, so the music follows the motion.

import { getState, setState, type Focus } from '../state/store';

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 10;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

let viewW = 1200;
let viewH = 700;
let target: Focus | null = null;

/** Pixels per degree at zoom 1: the planet always fills the map area. */
export const baseScale = (w = viewW, h = viewH) => Math.max(w / 360, h / 180);

export function setViewport(w: number, h: number) {
  viewW = w;
  viewH = h;
  const f = getState().focus;
  setState({ focus: clampFocus(f) });
}

/** Keep the poles from scrolling into view. */
function clampFocus(f: Focus): Focus {
  const zoom = clamp(f.zoom, ZOOM_MIN, ZOOM_MAX);
  const k = baseScale() * zoom;
  const halfLat = viewH / 2 / k;
  const maxLat = Math.max(0, 90 - halfLat);
  return { zoom, lat: clamp(f.lat, -maxLat, maxLat), lon: wrapLon(f.lon) };
}

function current(): Focus {
  return target ?? getState().focus;
}

export function flyTo(f: Partial<Focus>) {
  target = clampFocus({ ...current(), ...f });
  if (getState().settings.reducedMotion) jump();
}

/** Zoom by a factor, keeping the point under the cursor (anchor) where it is. */
export function zoomAt(factor: number, anchor?: { lat: number; lon: number }) {
  const from = current();
  const zoom = clamp(from.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  const real = zoom / from.zoom;
  let { lat, lon } = from;
  if (anchor && real !== 1) {
    let dl = anchor.lon - lon;
    if (dl > 180) dl -= 360;
    if (dl < -180) dl += 360;
    lat = anchor.lat - (anchor.lat - lat) / real;
    lon = anchor.lon - dl / real;
  }
  flyTo({ zoom, lat, lon });
  return zoom !== from.zoom;
}

/** Direct movement (drag, stick, keys): no easing. */
export function moveBy(dLat: number, dLon: number) {
  const f = clampFocus({ ...getState().focus, lat: getState().focus.lat + dLat, lon: getState().focus.lon + dLon });
  setState({ focus: f });
  if (target) target = clampFocus({ ...target, lat: target.lat + dLat, lon: target.lon + dLon });
}

function jump() {
  if (!target) return;
  setState({ focus: target });
  target = null;
}

/** Called every animation frame by the map. Returns true while moving. */
export function stepCamera(dt: number): boolean {
  if (!target) return false;
  const f = getState().focus;
  const t = 1 - Math.exp(-dt * 11);
  let dl = target.lon - f.lon;
  if (dl > 180) dl -= 360;
  if (dl < -180) dl += 360;
  const next = clampFocus({
    zoom: Math.exp(Math.log(f.zoom) + (Math.log(target.zoom) - Math.log(f.zoom)) * t),
    lat: f.lat + (target.lat - f.lat) * t,
    lon: f.lon + dl * t,
  });
  const done = Math.abs(Math.log(target.zoom / next.zoom)) < 0.002 && Math.abs(target.lat - next.lat) < 0.02 && Math.abs(dl) * (1 - t) < 0.02;
  if (done) jump();
  else setState({ focus: next });
  return true;
}

/** Screen position (CSS pixels, relative to the map) to latitude/longitude. */
export function screenToLatLon(x: number, y: number): { lat: number; lon: number } {
  const f = getState().focus;
  const k = baseScale() * f.zoom;
  return { lat: clamp(f.lat - (y - viewH / 2) / k, -90, 90), lon: wrapLon(f.lon + (x - viewW / 2) / k) };
}
