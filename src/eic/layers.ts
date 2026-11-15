// The EIC layers: loads each record's visualization (a looping video, or one still image),
// reads its current frame into a 1-degree grid of values, and answers questions about it:
// what's in the view (Listen), what's under the needle (Scan), what's under the probe (Probe).
//
// Real clips live in public/eic/<record>/ (from scripts/download_eic.py). Until they exist,
// public/eic-placeholder/ is used, and the site says so.
//
// The big clips (rain, NOx, temperature) also come as clip-lite.mp4, 1024 x 512 and a quarter
// of the size. That is what loads first, and it is plenty for the sound: every frame is read
// into a 720 x 360 grid. The full 2048 x 1024 clip is fetched in the background only once you
// zoom in on that record, where the extra detail shows, and swapped in at the same moment.

import { RECORDS, type Decode, type RecordDef, type RecordId } from '../config/records';
import { setState, getState, type SourceStatus } from '../state/store';
import { asset } from '../config/asset';

/** Cells per degree: 2 = half-degree grid, fine enough to catch single cities and lightning flashes. */
export const PER_DEG = 2;
export const GRID_W = 360 * PER_DEG;
export const GRID_H = 180 * PER_DEG;
const CELLS = GRID_W * GRID_H;

export interface Layer {
  rec: RecordDef;
  el: HTMLVideoElement | HTMLImageElement | null;
  ready: boolean;
  placeholder: boolean;
  colorbarUrl: string | null; // the NASA color key image, if there is one
  decode: Decode;
  lut: Float32Array | null; // 32x32x32 color -> value, for color-bar decoding
  grid: Float32Array; // NaN = no data
  second: Float32Array | null; // clouds, for rain
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  sampledAt: number;
  /** The record averaged over its whole clip (filled in the background after loading). */
  overall: Float32Array | null;
  /** The sharper clip to swap in when zoomed in (null once swapped, or if there is none). */
  full: string | null;
  upgrading: boolean;
}

export const layers = new Map<RecordId, Layer>();

async function exists(url: string, type: 'video' | 'image' | 'json', tries = 2): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    const ct = r.headers.get('content-type') ?? '';
    // dev servers answer missing files with the HTML page, so check the type too
    return r.ok && (type === 'json' ? ct.includes('json') : ct.startsWith(type));
  } catch {
    // a dropped request on a busy connection is not a missing file: try once more
    return tries > 1 ? exists(url, type, tries - 1) : false;
  }
}

interface ManifestRecord {
  id: string;
  localFiles: Array<{ name: string; kind: string }>;
}
let manifest: Promise<ManifestRecord[]> | null = null;
/** The pipeline's list of what it downloaded: public/eic/manifest.json, files in public/eic/<SVS id>/. */
function pipelineFiles(): Promise<ManifestRecord[]> {
  manifest ??= fetch(asset('/eic/manifest.json'))
    .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : { records: [] }))
    .then((m: { records?: ManifestRecord[] }) => m.records ?? [])
    .catch(() => []);
  return manifest;
}

/** Where this record's picture is: our web clip, the pipeline's download, or the placeholder. */
async function findSource(rec: RecordDef) {
  const type = rec.kind === 'movie' ? 'video' : 'image';
  const ours = asset(`/eic/${rec.id}/${rec.kind === 'movie' ? 'clip.mp4' : 'still.png'}`);
  const lite = asset(`/eic/${rec.id}/clip-lite.mp4`);
  if (rec.kind === 'movie' && (await exists(lite, type))) return { url: lite, full: ours, dir: asset(`/eic/${rec.id}`), placeholder: false };
  if (await exists(ours, type)) return { url: ours, dir: asset(`/eic/${rec.id}`), placeholder: false };
  const entry = (await pipelineFiles()).find((m) => m.id === String(rec.svs));
  if (entry) {
    const files = entry.localFiles.map((f) => f.name);
    const pick = rec.kind === 'movie'
      ? files.find((f) => /\.(mp4|webm)$/i.test(f))
      : files.find((f) => /\.(png|jpe?g)$/i.test(f) && !/(colorbar|cbar|_print|_thm|thumb|searchweb)/i.test(f));
    if (pick && (await exists(asset(`/eic/${entry.id}/${pick}`), type))) {
      const cb = files.find((f) => /(colorbar|cbar).*plain/i.test(f)) ?? files.find((f) => /(colorbar|cbar)/i.test(f));
      return { url: asset(`/eic/${entry.id}/${pick}`), dir: asset(`/eic/${entry.id}`), placeholder: false, colorbarPng: cb ? asset(`/eic/${entry.id}/${cb}`) : undefined };
    }
  }
  const ph = asset(`/eic-placeholder/${rec.id}/${rec.kind === 'movie' ? 'clip.mp4' : 'still.png'}`);
  if (await exists(ph, type)) return { url: ph, dir: asset(`/eic-placeholder/${rec.id}`), placeholder: true };
  return null;
}

async function loadLayer(rec: RecordDef): Promise<Layer> {
  let src = await findSource(rec);
  const canvas = document.createElement('canvas');
  canvas.width = GRID_W;
  canvas.height = GRID_H;
  const layer: Layer = {
    rec, el: null, ready: false, placeholder: src?.placeholder ?? true, colorbarUrl: null, decode: rec.decode, lut: null,
    grid: new Float32Array(CELLS).fill(NaN), second: rec.decode.kind === 'precip' ? new Float32Array(CELLS) : null,
    canvas, ctx: canvas.getContext('2d', { willReadFrequently: true })!, sampledAt: 0, overall: null,
    full: src && 'full' in src ? src.full ?? null : null, upgrading: false,
  };
  if (!src) {
    setState({ sources: { ...getState().sources, [rec.id]: 'missing' } });
    return layer;
  }
  const base = src.dir;

  // A color key from the pipeline beats the built-in guess.
  if (await exists(`${base}/colorbar.json`, 'json')) {
    try {
      const cb = (await (await fetch(`${base}/colorbar.json`)).json()) as { stops: Array<[number, number, number, number]> };
      if (cb.stops?.length >= 2) {
        layer.decode = rec.decode.kind === 'precip' ? rec.decode : { kind: 'colorbar', stops: cb.stops };
        if (rec.decode.kind === 'precip') layer.lut = buildLut(cb.stops, 70);
      }
    } catch {
      /* keep the default */
    }
  }
  if (!src.placeholder) {
    if (await exists(`${base}/colorbar.png`, 'image')) layer.colorbarUrl = `${base}/colorbar.png`;
    else if ('colorbarPng' in src && src.colorbarPng) layer.colorbarUrl = src.colorbarPng;
  }
  if (layer.decode.kind === 'colorbar') layer.lut = buildLut(layer.decode.stops, layer.decode.maxDistance ?? 70, rec.matchHue);

  const open = async (url: string) => {
    if (rec.kind === 'movie') {
      const v = makeVideo(url);
      await new Promise<void>((resolve) => {
        v.addEventListener('loadeddata', () => resolve(), { once: true });
        v.addEventListener('error', () => resolve(), { once: true });
        // Safari on iPhone and iPad may load nothing past the size until the clip plays: the size is enough to start
        v.addEventListener('loadedmetadata', () => setTimeout(resolve, 2500), { once: true });
        v.load();
      });
      // WebKit can report the first frame before the picture's size: wait for the size
      if (v.readyState >= 1 && !v.videoWidth) {
        await new Promise<void>((resolve) => {
          v.addEventListener('resize', () => resolve(), { once: true });
          setTimeout(resolve, 3000);
        });
      }
      return { el: v, w: v.videoWidth, h: v.videoHeight, ok: v.readyState >= 1 && v.videoWidth > 0 };
    }
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => undefined);
    return { el: img, w: img.naturalWidth, h: img.naturalHeight, ok: img.complete && img.naturalWidth > 0 };
  };
  let opened = await open(src.url);
  // The map only lines up with flat world maps (2:1). Anything else (a globe, a 16:9 or 32:9 cut) is skipped.
  const ratio = opened.h ? opened.w / opened.h : 0;
  if (opened.ok && !src.placeholder && (ratio < 1.9 || ratio > 2.1)) {
    console.warn(`${rec.name}: ${src.url} is ${opened.w}x${opened.h}, not a flat 2:1 world map, so it can't line up. Using the placeholder. See README.`);
    const ph = asset(`/eic-placeholder/${rec.id}/${rec.kind === 'movie' ? 'clip.mp4' : 'still.png'}`);
    src = { url: ph, dir: asset(`/eic-placeholder/${rec.id}`), placeholder: true };
    layer.colorbarUrl = null;
    layer.full = null;
    opened = await open(ph);
  }
  layer.el = opened.el;
  layer.ready = opened.ok;
  layer.placeholder = src.placeholder;
  const status = () => (layer.ready ? (src.placeholder ? 'placeholder' : 'real') : 'missing') as SourceStatus;
  setState({ sources: { ...getState().sources, [rec.id]: status() } });
  // a slow or interrupted first load (it happens in Safari) is not a missing clip: take it when it arrives
  if (!layer.ready && opened.el instanceof HTMLVideoElement) {
    const v = opened.el;
    const late = () => {
      if (layer.ready || !v.videoWidth || v.readyState < 2) return;
      layer.ready = true;
      setState({ sources: { ...getState().sources, [rec.id]: status() } });
    };
    v.addEventListener('loadeddata', late);
    v.addEventListener('resize', late);
  }
  return layer;
}

function makeVideo(url: string) {
  const v = document.createElement('video');
  v.muted = true;
  v.loop = true;
  v.playsInline = true; // iPhone and iPad: play in the page, not full screen
  v.setAttribute('playsinline', '');
  // just enough for the first frame: a record's clip streams in once it plays (see wake)
  v.preload = 'metadata';
  v.crossOrigin = 'anonymous';
  v.src = url;
  return v;
}

/**
 * Swap a record's small first-load clip for the full 2048 x 1024 one, at the same moment of the
 * clip, once the full one can play through. One at a time, in the background.
 */
let swapping = false;
export async function upgradeLayer(id: RecordId) {
  const l = layers.get(id);
  if (swapping || !l?.full || l.upgrading || !(l.el instanceof HTMLVideoElement)) return;
  swapping = true;
  l.upgrading = true;
  const old = l.el;
  const v = makeVideo(l.full);
  v.preload = 'auto';
  try {
    await new Promise<void>((ok, fail) => {
      v.addEventListener('canplaythrough', () => ok(), { once: true });
      v.addEventListener('error', () => fail(), { once: true });
      v.load();
    });
    v.currentTime = old.currentTime;
    await new Promise<void>((ok) => v.addEventListener('seeked', () => ok(), { once: true }));
    if (!old.paused) {
      await v.play().catch(() => undefined);
      v.currentTime = old.currentTime; // catch up with the time the swap took
    }
    l.el = v;
    l.sampledAt = 0;
    old.pause();
    old.removeAttribute('src');
    old.load();
  } catch {
    /* keep the small clip */
  } finally {
    l.full = null;
    l.upgrading = false;
    swapping = false;
  }
}

export async function loadLayers() {
  await Promise.all(
    RECORDS.map(async (rec) => {
      layers.set(rec.id, await loadLayer(rec));
    }),
  );
}

/** A record is playing: let its clip buffer ahead, and (once) average it over its whole clip. */
export function wake(id: RecordId) {
  const l = layers.get(id);
  if (!l?.ready) return;
  if (l.el instanceof HTMLVideoElement && l.el.preload !== 'auto') l.el.preload = 'auto';
  if (!l.overall && !profiled.has(id)) {
    profiled.add(id);
    queue = queue.then(() => new Promise((r) => setTimeout(r, 4000))).then(() => profileLayer(l));
  }
}
const profiled = new Set<RecordId>();
let queue: Promise<void> = Promise.resolve();

/**
 * Average a record over its whole clip, once, in the background: a hidden copy of the video is
 * stepped through 16 moments and read like a live frame. This is "where this record is densest
 * across the whole NASA dataset", which a single frame can't tell (one frame of lightning has
 * only a few flashes). Only for records that play, one at a time, so it doesn't slow the start.
 */
async function profileLayer(layer: Layer, frames = 16) {
  if (!layer.ready || !layer.el) return;
  if (!(layer.el instanceof HTMLVideoElement)) {
    if (!layer.sampledAt) sample(layer.rec.id, 0);
    layer.overall = layer.grid.slice();
    return;
  }
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'metadata'; // each seek fetches just the part it needs
  v.src = layer.el.currentSrc || layer.el.src;
  try {
    await new Promise<void>((ok, fail) => {
      v.addEventListener('loadeddata', () => ok(), { once: true });
      v.addEventListener('error', () => fail(), { once: true });
    });
    const canvas = document.createElement('canvas');
    canvas.width = GRID_W;
    canvas.height = GRID_H;
    const tmp: Layer = { ...layer, el: v, canvas, ctx: canvas.getContext('2d', { willReadFrequently: true })!, grid: new Float32Array(CELLS), second: layer.second ? new Float32Array(CELLS) : null };
    const sum = new Float32Array(CELLS);
    const n = new Uint16Array(CELLS);
    for (let k = 0; k < frames; k++) {
      // only the record's own span (city lights: the years, not the change map at the end)
      const [t0, t1] = layer.rec.timeline?.segment ?? [0, v.duration || 1];
      v.currentTime = t0 + ((k + 0.5) / frames) * (t1 - t0);
      await new Promise<void>((ok) => v.addEventListener('seeked', () => ok(), { once: true }));
      readFrame(tmp);
      for (let i = 0; i < CELLS; i++) {
        const x = tmp.grid[i];
        if (x === x) {
          sum[i] += x;
          n[i]++;
        }
      }
      await new Promise((r) => setTimeout(r, 30)); // stay out of the music's way
    }
    const overall = new Float32Array(CELLS);
    for (let i = 0; i < CELLS; i++) overall[i] = n[i] ? sum[i] / n[i] : NaN;
    layer.overall = overall;
  } catch {
    /* keep the live frame */
  } finally {
    v.removeAttribute('src');
    v.load();
  }
}

// ---------- decoding ----------

/** Color key -> lookup table over a 32x32x32 color cube. Colors far from the key are "no data". */
function buildLut(stops: Array<[number, number, number, number]>, maxDistance: number, hueOnly = false): Float32Array {
  const sorted = [...stops].sort((a, b) => a[3] - b[3]);
  const samples: Array<[number, number, number, number]> = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const [r0, g0, b0, v0] = sorted[i];
    const [r1, g1, b1, v1] = sorted[i + 1];
    for (let t = 0; t < 16; t++) {
      const f = t / 16;
      samples.push([r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f, v0 + (v1 - v0) * f]);
    }
  }
  samples.push(sorted[sorted.length - 1]);
  const lut = new Float32Array(32 * 32 * 32);
  const max2 = maxDistance * maxDistance;
  for (let r = 0; r < 32; r++) {
    for (let g = 0; g < 32; g++) {
      for (let b = 0; b < 32; b++) {
        let R = r * 8 + 4;
        let G = g * 8 + 4;
        let B = b * 8 + 4;
        const m = Math.max(R, G, B);
        if (hueOnly) {
          // compare color, not brightness: a dim orange flow line is still orange
          if (m < 40 || (m - Math.min(R, G, B)) / m < 0.25) {
            lut[(r << 10) | (g << 5) | b] = NaN;
            continue;
          }
          R = (R / m) * 255;
          G = (G / m) * 255;
          B = (B / m) * 255;
        }
        let best = Infinity;
        let val = NaN;
        for (const [sr0, sg0, sb0, sv] of samples) {
          const sm = hueOnly ? Math.max(sr0, sg0, sb0, 1) / 255 : 1;
          const sr = sr0 / sm;
          const sg = sg0 / sm;
          const sb = sb0 / sm;
          const d = (R - sr) ** 2 + (G - sg) ** 2 + (B - sb) ** 2;
          if (d < best) {
            best = d;
            val = sv;
          }
        }
        lut[(r << 10) | (g << 5) | b] = best <= max2 ? val : NaN;
      }
    }
  }
  return lut;
}

/** One pixel's color -> value (NaN = no data). `cloud` receives the cloud amount for rain. */
function decodePixel(layer: Layer, r: number, g: number, b: number, lat: number, cloud?: { v: number }): number {
  const d = layer.decode;
  const mx = Math.max(r, g, b);
  switch (d.kind) {
    case 'colorbar': {
      // a key that runs through one tint (NOx: white to dark green): black borders, gray land
      // and no-data areas are not on the key, even if their color is closest to its dark end
      if (layer.rec.tint === 'green' && g - Math.max(r, b) < 10) return 0;
      let v = layer.lut![((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
      const c = layer.rec.contrast;
      if (c && !Number.isNaN(v)) v = Math.max(0, Math.min(1, (v - c[0]) / (c[1] - c[0])));
      return Number.isNaN(v) && layer.rec.empty === 'zero' ? 0 : v;
    }
    case 'bright':
      return Math.max(0, (mx / 255 - d.floor) / (1 - d.floor));
    case 'colorful': {
      const sat = mx ? (mx - Math.min(r, g, b)) / mx : 0;
      return Math.min(1, Math.max(0, (sat - 0.35) / 0.5) * (mx / 255) * 1.6);
    }
    case 'warm': {
      const warm = (r - b) / 255;
      return Math.max(0, Math.min(1, (warm - 0.28) / 0.55)) * (r / 255);
    }
    case 'precip': {
      const mn = Math.min(r, g, b);
      const sat = mx ? (mx - mn) / mx : 0;
      // clouds: bright and gray (ice sheets look the same, so skip the polar caps)
      if (cloud) cloud.v = sat < 0.2 && mx > 140 && Math.abs(lat) < 66 ? (mx - 140) / 115 : 0;
      // rain: the color key if we have one, otherwise bright saturated blue-to-pink
      const v = layer.lut ? layer.lut[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)] : NaN;
      return Number.isNaN(v) ? (sat > 0.35 && mx > 120 && b >= g ? Math.min(1, (mx - 120) / 135) : 0) : v;
    }
  }
}

function decodeFrame(layer: Layer) {
  const { data } = layer.ctx.getImageData(0, 0, GRID_W, GRID_H);
  const grid = layer.grid;
  const d = layer.decode;
  // City lights' change map (2012 → 2023): purple = new lights (high notes), white = no change
  // (middle), orange = lights that went out (low notes), dark = no lights at all.
  if (layer.rec.timeline?.change && getState().changeView[layer.rec.id]) {
    for (let i = 0, o = 0; i < CELLS; i++, o += 4) {
      const r = data[o], g = data[o + 1], b = data[o + 2];
      const mx = Math.max(r, g, b);
      if (mx < 64) grid[i] = 0;
      else if (b > g + 15 && r > g) grid[i] = 0.62 + 0.38 * Math.min(1, (b - g) / 90); // new lights
      else if (r > b + 25 && g > b) grid[i] = 0.08 + 0.17 * Math.min(1, (r - b) / 120); // lights went out
      else grid[i] = 0.42; // lit in both years
    }
    return;
  }
  // Fast paths for the common keys: one tight loop, no function call per pixel.
  if (d.kind === 'bright') {
    const f = d.floor;
    for (let i = 0, o = 0; i < CELLS; i++, o += 4) {
      const mx = Math.max(data[o], data[o + 1], data[o + 2]) / 255;
      grid[i] = mx > f ? (mx - f) / (1 - f) : 0;
    }
    return;
  }
  if (d.kind === 'colorbar' && !layer.rec.tint && !layer.rec.contrast) {
    const lut = layer.lut!;
    const zero = layer.rec.empty === 'zero';
    for (let i = 0, o = 0; i < CELLS; i++, o += 4) {
      const v = lut[((data[o] >> 3) << 10) | ((data[o + 1] >> 3) << 5) | (data[o + 2] >> 3)];
      grid[i] = zero && v !== v ? 0 : v;
    }
    return;
  }
  const cloud = { v: 0 };
  for (let r = 0, i = 0, o = 0; r < GRID_H; r++) {
    const lat = 90 - (r + 0.5) / PER_DEG;
    for (let c = 0; c < GRID_W; c++, i++, o += 4) {
      grid[i] = decodePixel(layer, data[o], data[o + 1], data[o + 2], lat, cloud);
      if (layer.second) layer.second[i] = cloud.v;
    }
  }
}

/** Reads the current frame into the grid (at most every `minMs`). */
export function sample(id: RecordId, minMs = 90) {
  const layer = layers.get(id);
  if (!layer?.el || !layer.ready) return null;
  const now = performance.now();
  if (now - layer.sampledAt < minMs && layer.sampledAt) return layer;
  if (!readFrame(layer)) return null;
  layer.sampledAt = now;
  return layer;
}

/** Draw the layer's current frame small and decode it into its grid (masks become no data). */
function readFrame(layer: Layer): boolean {
  const el = layer.el!;
  const w = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
  const h = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
  if (!w || !h) return false;
  const [x0, y0, x1, y1] = layer.rec.area;
  layer.ctx.drawImage(el, x0 * w, y0 * h, (x1 - x0) * w, (y1 - y0) * h, 0, 0, GRID_W, GRID_H);
  decodeFrame(layer);
  if (!layer.placeholder) {
    for (const [mx0, my0, mx1, my1] of layer.rec.masks ?? []) {
      // mask rectangles are in frame fractions; convert to grid cells inside the map area
      const gx0 = Math.max(0, Math.floor(((mx0 - x0) / (x1 - x0)) * GRID_W));
      const gx1 = Math.min(GRID_W, Math.ceil(((mx1 - x0) / (x1 - x0)) * GRID_W));
      const gy0 = Math.max(0, Math.floor(((my0 - y0) / (y1 - y0)) * GRID_H));
      const gy1 = Math.min(GRID_H, Math.ceil(((my1 - y0) / (y1 - y0)) * GRID_H));
      for (let yy = gy0; yy < gy1; yy++) for (let xx = gx0; xx < gx1; xx++) layer.grid[yy * GRID_W + xx] = NaN;
    }
  }
  return true;
}

// ---------- questions about the grid ----------

const col = (lon: number) => ((Math.floor((lon + 180) * PER_DEG) % GRID_W) + GRID_W) % GRID_W;
const row = (lat: number) => Math.max(0, Math.min(GRID_H - 1, Math.floor((90 - lat) * PER_DEG)));

export interface Bounds {
  west: number;
  lonSpan: number;
  south: number;
  north: number;
}

export interface ViewStats {
  mean: number; // average over cells with data
  areaMean: number; // the same, weighted by real area (a flat map stretches the poles)
  peak: number; // 90th percentile
  coverage: number; // share of cells above 0.15
  hot: number; // average of those cells: how strong the hotspots are
  pan: number; // -1 (west) .. 1 (east): where the strongest part is
  second: number; // average of the second part (clouds)
}

/** What's in the view. Steps through big views so a whole-planet view stays cheap. */
export function viewStats(grid: Float32Array, b: Bounds, second?: Float32Array | null): ViewStats {
  const c0 = Math.floor((b.west + 180) * PER_DEG);
  const cols = Math.max(1, Math.ceil(b.lonSpan * PER_DEG));
  const r0 = row(b.north);
  const r1 = row(b.south);
  const step = Math.max(1, Math.round(Math.sqrt((cols * (r1 - r0 + 1)) / 40000)));
  let sum = 0;
  let n = 0;
  let cov = 0;
  let hotSum = 0;
  let wx = 0;
  let wsum = 0;
  let sec = 0;
  let aSum = 0;
  let aW = 0;
  const hist = new Uint32Array(20);
  for (let r = r0; r <= r1; r += step) {
    const area = Math.cos(((90 - (r + 0.5) / PER_DEG) * Math.PI) / 180);
    for (let k = 0; k < cols; k += step) {
      const i = r * GRID_W + ((((c0 + k) % GRID_W) + GRID_W) % GRID_W);
      if (second) sec += second[i];
      const v = grid[i];
      if (Number.isNaN(v)) continue;
      sum += v;
      n++;
      aSum += v * area;
      aW += area;
      if (v > 0.15) {
        cov++;
        hotSum += v;
      }
      hist[Math.min(19, Math.floor(v * 20))]++;
      wx += v * (k / cols);
      wsum += v;
    }
  }
  let acc = 0;
  let peak = 0;
  for (let h = 0; h < 20; h++) {
    acc += hist[h];
    if (acc >= n * 0.9) {
      peak = (h + 1) / 20;
      break;
    }
  }
  const total = Math.ceil(cols / step) * Math.ceil((r1 - r0 + 1) / step);
  return {
    mean: n ? sum / n : 0,
    areaMean: aW ? aSum / aW : 0,
    peak,
    coverage: n ? cov / n : 0,
    hot: cov ? hotSum / cov : 0,
    pan: wsum > 0 ? (wx / wsum) * 2 - 1 : 0,
    second: second && total ? sec / total : 0,
  };
}

/** Strongest points in one column of the view, top to bottom, for the scan needle. */
export function columnPeaks(grid: Float32Array, lon: number, b: Bounds, max = 3): Array<{ y: number; v: number }> {
  const c = col(lon);
  const r0 = row(b.north);
  const r1 = row(b.south);
  const span = Math.max(1, r1 - r0);
  const found: Array<{ y: number; v: number }> = [];
  for (let r = r0; r <= r1; r++) {
    const v = grid[r * GRID_W + c];
    if (Number.isNaN(v) || v < 0.2) continue;
    const up = r > r0 ? grid[(r - 1) * GRID_W + c] : 0;
    const down = r < r1 ? grid[(r + 1) * GRID_W + c] : 0;
    if (v >= (Number.isNaN(up) ? 0 : up) && v >= (Number.isNaN(down) ? 0 : down)) found.push({ y: (r - r0) / span, v });
  }
  return found.sort((a, b2) => b2.v - a.v).slice(0, max);
}

/** Value at a point (average of a small neighborhood, so a single pixel doesn't decide). */
export function valueAt(grid: Float32Array, lat: number, lon: number, radius = PER_DEG): number | null {
  let sum = 0;
  let n = 0;
  const r = row(lat);
  const c = col(lon);
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      const rr = r + dr;
      if (rr < 0 || rr >= GRID_H) continue;
      const v = grid[rr * GRID_W + ((c + dc + GRID_W) % GRID_W)];
      if (Number.isNaN(v)) continue;
      sum += v;
      n++;
    }
  }
  return n ? sum / n : null;
}

/**
 * Where on Earth this record is strongest right now: the center of the window (lonSpan × latSpan
 * degrees, the size of the zoomed-in view) with the highest average (for temperature: the
 * strongest warming). Used by the story, so it zooms into the densest area of each NASA map,
 * read from the data itself.
 */
export function densest(
  id: RecordId,
  lonSpan: number,
  latSpan: number,
  avoid: Array<{ lat: number; lon: number }> = [], // places already visited: find somewhere new
  maxLat = 60,
): { lat: number; lon: number; score: number } | null {
  const live = sample(id, 0) ?? layers.get(id);
  if (!live?.sampledAt && !live?.overall) return null;
  // the whole clip, averaged, if we have it: where this record is densest across the dataset
  const l = { rec: live.rec, grid: live.overall ?? live.grid };
  const W2 = GRID_W * 2; // twice as wide, so windows can cross the date line
  const S = new Float64Array((W2 + 1) * (GRID_H + 1));
  for (let r = 0; r < GRID_H; r++) {
    let rs = 0;
    for (let c = 0; c < W2; c++) {
      const v = l.grid[r * GRID_W + (c % GRID_W)];
      const ok = !Number.isNaN(v);
      if (ok) rs += v;
      const i = (r + 1) * (W2 + 1) + c + 1;
      const up = r * (W2 + 1) + c + 1;
      S[i] = S[up] + rs;
    }
  }
  const box = (T: Float64Array, r0: number, c0: number, r1: number, c1: number) =>
    T[r1 * (W2 + 1) + c1] - T[r0 * (W2 + 1) + c1] - T[r1 * (W2 + 1) + c0] + T[r0 * (W2 + 1) + c0];
  const w = Math.round(lonSpan * PER_DEG);
  const h = Math.round(latSpan * PER_DEG);
  const rMin = Math.max(0, Math.round((90 - maxLat) * PER_DEG) - Math.floor(h / 2));
  const rMax = Math.min(GRID_H - h, Math.round((90 + maxLat) * PER_DEG) - Math.ceil(h / 2));
  let best = { lat: 0, lon: 0, score: -1 };
  for (let r0 = rMin; r0 <= rMax; r0 += 2) {
    for (let c0 = 0; c0 < GRID_W; c0 += 2) {
      const sum = box(S, r0, c0, r0 + h, c0 + w);
      const score = sum / (w * h);
      if (score > best.score) {
        let lon = (c0 + w / 2) / PER_DEG - 180;
        if (lon > 180) lon -= 360;
        const lat = 90 - (r0 + h / 2) / PER_DEG;
        if (avoid.some((p) => Math.abs(p.lat - lat) < latSpan * 0.8 && Math.abs(((lon - p.lon + 540) % 360) - 180) < lonSpan * 0.8)) continue;
        best = { lat, lon, score };
      }
    }
  }
  return best.score >= 0 ? best : null;
}
