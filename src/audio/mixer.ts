// The heartbeat of the app: about 20 times per second it reads the data at the
// current year and map position, and sends the result to the sound engine,
// the controller and the caption line.

import { RECORDS, YEAR_MAX, type RecordId } from '../config/records';
import { ensureMonthly } from '../data/loader';
import { gridAt, listenRadius, regionValue } from '../data/sample';
import { describeNow } from '../state/actions';
import { getState, setState, type MixEntry } from '../state/store';
import { updateLevels } from './engine';
import { hapticTick } from '../input/haptics';

const TICK_MS = 50;
export const MONTH_SECONDS = 5; // the plan says about 15 s per month; shorter while developing
const YEAR_SECONDS_AUTOPLAY = 2.4; // 1950 to today in about 3 minutes
const SETTLE_MS = 700; // how long the slider must rest before the monthly loop starts

const buffers = new Map<string, Uint8Array>();
let lastYearChange = performance.now();
let lastYear = -1;
let monthClock = 0;
let lastCaptionAt = 0;

function computeMix(): Partial<Record<RecordId, MixEntry | null>> {
  const { data, year, month, focus, humanity, sideA, sideAValue, playing } = getState();
  const mix: Partial<Record<RecordId, MixEntry | null>> = {};
  if (!data) return mix;
  const radius = listenRadius(focus.zoom);
  for (const rec of RECORDS) {
    if (!playing[rec.id]) continue;
    const scale = rec.side === 'human' ? humanity : 1;
    if (sideA === rec.id) {
      const v = sideAValue[rec.id] ?? 0;
      mix[rec.id] = { value: v * scale, raw: v, peak: v };
      continue;
    }
    let buf = buffers.get(rec.layer);
    if (!buf) {
      buf = new Uint8Array(data.cells);
      buffers.set(rec.layer, buf);
    }
    const grid = gridAt(data, rec.layer, year, month, buf);
    const region = grid ? regionValue(data, grid, focus.lat, focus.lon, radius) : null;
    // Blend the area average with its strongest cell, so hotspots (cities, fires) stay
    // audible at the whole-planet view instead of being averaged away.
    const loudness = region ? Math.min(1, 0.6 * Math.sqrt(region.mean) + 0.4 * region.peak) : 0;
    mix[rec.id] = region ? { value: loudness * scale, raw: loudness, peak: region.peak } : null;
  }
  return mix;
}

function advanceTime(now: number, dt: number) {
  const s = getState();
  if (s.autoplay) {
    const next = s.year + dt / YEAR_SECONDS_AUTOPLAY;
    if (next >= YEAR_MAX) setState({ year: YEAR_MAX, autoplay: false });
    else setState({ year: next, month: null });
    lastYearChange = now;
    return;
  }
  if (s.year !== lastYear) {
    lastYear = s.year;
    lastYearChange = now;
    monthClock = 0;
    return;
  }
  // When the slider rests on a whole year, loop that year's months.
  if (s.dragging || !s.data || now - lastYearChange < SETTLE_MS) return;
  const y = Math.round(s.year);
  if (Math.abs(s.year - y) > 0.001) return;
  const layers = RECORDS.filter((r) => s.playing[r.id]).map((r) => r.layer);
  const anyMonthly = layers.some((id) => s.data!.layers.get(id)?.meta.monthlyYears.includes(y));
  if (!anyMonthly) return;
  layers.forEach((id) => void ensureMonthly(s.data!, id, y));
  monthClock += dt;
  const m = Math.floor(monthClock / MONTH_SECONDS) % 12;
  if (m !== s.month) setState({ month: m });
}

export function startMixer() {
  let prev = performance.now();
  const timer = window.setInterval(() => {
    const now = performance.now();
    const dt = (now - prev) / 1000;
    prev = now;
    advanceTime(now, dt);
    const mix = computeMix();
    setState({ mix });
    const levels: Partial<Record<RecordId, number | null>> = {};
    for (const rec of RECORDS) levels[rec.id] = mix[rec.id]?.value ?? 0;
    updateLevels(levels);
    hapticTick(mix, now);
    if (now - lastCaptionAt > 1500) {
      lastCaptionAt = now;
      const caption = describeNow();
      if (caption !== getState().caption) setState({ caption });
    }
  }, TICK_MS);
  return () => window.clearInterval(timer);
}
