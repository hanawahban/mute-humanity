// The EIC layers: loads each record's visualization (a looping video, or one still image),
// reads its current frame into a 1-degree grid of values, and answers questions about it:
// what's in the view (Listen), what's under the needle (Scan), what's under the probe (Probe).
//
// Real clips live in public/eic/<record>/ (from scripts/download_eic.py). Until they exist,
// public/eic-placeholder/ is used, and the site says so.

import { RECORDS, type Decode, type RecordDef, type RecordId } from '../config/records';
import { setState, getState } from '../state/store';

export const GRID_W = 360;
export const GRID_H = 180;
const CELLS = GRID_W * GRID_H;

export interface Layer {
  rec: RecordDef;
  el: HTMLVideoElement | HTMLImageElement | null;
  ready: boolean;
  placeholder: boolean;
  colorbarUrl: string | null; // the NASA colour key image, if there is one
  decode: Decode;
  lut: Float32Array | null; // 32x32x32 colour -> value, for colour-bar decoding
  grid: Float32Array; // NaN = no data
  second: Float32Array | null; // clouds, for rain
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  sampledAt: number;
}

export const layers = new Map<RecordId, Layer>();

async function exists(url: string, type: 'video' | 'image' | 'json'): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    const ct = r.headers.get('content-type') ?? '';
    // dev servers answer missing files with the HTML page, so check the type too
    return r.ok && (type === 'json' ? ct.includes('json') : ct.startsWith(type));
  } catch {
    return false;
  }
}

interface ManifestRecord {
  id: string;
  localFiles: Array<{ name: string; kind: string }>;
}
let manifest: Promise<ManifestRecord[]> | null = null;
/** The pipeline's list of what it downloaded: public/eic/manifest.json, files in public/eic/<SVS id>/. */
function pipelineFiles(): Promise<ManifestRecord[]> {
  manifest ??= fetch('/eic/manifest.json')
    .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : { records: [] }))
    .then((m: { records?: ManifestRecord[] }) => m.records ?? [])
    .catch(() => []);
  return manifest;
}

/** Where this record's picture is: our web clip, the pipeline's download, or the placeholder. */
async function findSource(rec: RecordDef) {
  const type = rec.kind === 'movie' ? 'video' : 'image';
  const ours = `/eic/${rec.id}/${rec.kind === 'movie' ? 'clip.mp4' : 'still.png'}`;
  if (await exists(ours, type)) return { url: ours, dir: `/eic/${rec.id}`, placeholder: false };
  const entry = (await pipelineFiles()).find((m) => m.id === String(rec.svs));
  if (entry) {
    const files = entry.localFiles.map((f) => f.name);
    const pick = rec.kind === 'movie'
      ? files.find((f) => /\.(mp4|webm)$/i.test(f))
      : files.find((f) => /\.(png|jpe?g)$/i.test(f) && !/(colorbar|cbar|_print|_thm|thumb|searchweb)/i.test(f));
    if (pick && (await exists(`/eic/${entry.id}/${pick}`, type))) {
      const cb = files.find((f) => /(colorbar|cbar).*plain/i.test(f)) ?? files.find((f) => /(colorbar|cbar)/i.test(f));
      return { url: `/eic/${entry.id}/${pick}`, dir: `/eic/${entry.id}`, placeholder: false, colorbarPng: cb ? `/eic/${entry.id}/${cb}` : undefined };
    }
  }
  const ph = `/eic-placeholder/${rec.id}/${rec.kind === 'movie' ? 'clip.mp4' : 'still.png'}`;
  if (await exists(ph, type)) return { url: ph, dir: `/eic-placeholder/${rec.id}`, placeholder: true };
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
    canvas, ctx: canvas.getContext('2d', { willReadFrequently: true })!, sampledAt: 0,
  };
  if (!src) {
    setState({ sources: { ...getState().sources, [rec.id]: 'missing' } });
    return layer;
  }
  const base = src.dir;

  // A colour key from the pipeline beats the built-in guess.
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
  if (layer.decode.kind === 'colorbar') layer.lut = buildLut(layer.decode.stops, layer.decode.maxDistance ?? 70);

  const open = async (url: string) => {
    if (rec.kind === 'movie') {
      const v = document.createElement('video');
      v.src = url;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.crossOrigin = 'anonymous';
      await new Promise<void>((resolve) => {
        v.addEventListener('loadeddata', () => resolve(), { once: true });
        v.addEventListener('error', () => resolve(), { once: true });
        v.load();
      });
      return { el: v, w: v.videoWidth, h: v.videoHeight, ok: v.readyState >= 2 };
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
    const ph = `/eic-placeholder/${rec.id}/${rec.kind === 'movie' ? 'clip.mp4' : 'still.png'}`;
    src = { url: ph, dir: `/eic-placeholder/${rec.id}`, placeholder: true };
    layer.colorbarUrl = null;
    opened = await open(ph);
  }
  layer.el = opened.el;
  layer.ready = opened.ok;
  layer.placeholder = src.placeholder;
  setState({ sources: { ...getState().sources, [rec.id]: layer.ready ? (src.placeholder ? 'placeholder' : 'real') : 'missing' } });
  return layer;
}

export async function loadLayers() {
  await Promise.all(
    RECORDS.map(async (rec) => {
      layers.set(rec.id, await loadLayer(rec));
    }),
  );
}

// ---------- decoding ----------

/** Colour key -> lookup table over a 32x32x32 colour cube. Colours far from the key are "no data". */
function buildLut(stops: Array<[number, number, number, number]>, maxDistance: number): Float32Array {
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
        const R = r * 8 + 4;
        const G = g * 8 + 4;
        const B = b * 8 + 4;
        let best = Infinity;
        let val = NaN;
        for (const [sr, sg, sb, sv] of samples) {
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

function decodeFrame(layer: Layer) {
  const { data } = layer.ctx.getImageData(0, 0, GRID_W, GRID_H);
  const out = layer.grid;
  const d = layer.decode;
  for (let i = 0, o = 0; i < CELLS; i++, o += 4) {
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const mx = Math.max(r, g, b);
    switch (d.kind) {
      case 'colorbar': {
        const v = layer.lut![((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
        out[i] = Number.isNaN(v) && layer.rec.empty === 'zero' ? 0 : v;
        break;
      }
      case 'bright':
        out[i] = Math.max(0, (mx / 255 - d.floor) / (1 - d.floor));
        break;
      case 'warm': {
        const warm = (r - b) / 255;
        out[i] = Math.max(0, Math.min(1, (warm - 0.28) / 0.55)) * (r / 255);
        break;
      }
      case 'precip': {
        const mn = Math.min(r, g, b);
        const sat = mx ? (mx - mn) / mx : 0;
        const lat = 90 - Math.floor(i / GRID_W) - 0.5;
        // clouds: bright and grey (ice sheets look the same, so skip the polar caps)
        layer.second![i] = sat < 0.2 && mx > 140 && Math.abs(lat) < 66 ? (mx - 140) / 115 : 0;
        // rain: the colour key if we have one, otherwise bright saturated blue-to-pink
        const v = layer.lut ? layer.lut[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)] : NaN;
        out[i] = Number.isNaN(v) ? (sat > 0.35 && mx > 120 && b >= g ? Math.min(1, (mx - 120) / 135) : 0) : v;
        break;
      }
    }
  }
}

/** Reads the current frame into the grid (at most every `minMs`). */
export function sample(id: RecordId, minMs = 90) {
  const layer = layers.get(id);
  if (!layer?.el || !layer.ready) return null;
  const now = performance.now();
  if (now - layer.sampledAt < minMs && layer.sampledAt) return layer;
  const el = layer.el;
  const w = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
  const h = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
  if (!w || !h) return null;
  const [x0, y0, x1, y1] = layer.rec.area;
  layer.ctx.drawImage(el, x0 * w, y0 * h, (x1 - x0) * w, (y1 - y0) * h, 0, 0, GRID_W, GRID_H);
  decodeFrame(layer);
  layer.sampledAt = now;
  return layer;
}

// ---------- questions about the grid ----------

const col = (lon: number) => ((Math.floor(lon + 180) % GRID_W) + GRID_W) % GRID_W;
const row = (lat: number) => Math.max(0, Math.min(GRID_H - 1, Math.floor(90 - lat)));

export interface Bounds {
  west: number;
  lonSpan: number;
  south: number;
  north: number;
}

export interface ViewStats {
  mean: number; // average over cells with data
  peak: number; // 90th percentile
  coverage: number; // share of cells above 0.15
  hot: number; // average of those cells: how strong the hotspots are
  pan: number; // -1 (west) .. 1 (east): where the strongest part is
  second: number; // average of the second part (clouds)
}

/** What's in the view. Steps through big views so a whole-planet view stays cheap. */
export function viewStats(grid: Float32Array, b: Bounds, second?: Float32Array | null): ViewStats {
  const c0 = Math.floor(b.west + 180);
  const cols = Math.max(1, Math.ceil(b.lonSpan));
  const r0 = row(b.north);
  const r1 = row(b.south);
  const step = cols * (r1 - r0 + 1) > 20000 ? 2 : 1;
  let sum = 0;
  let n = 0;
  let cov = 0;
  let hotSum = 0;
  let wx = 0;
  let wsum = 0;
  let sec = 0;
  const hist = new Uint32Array(20);
  for (let r = r0; r <= r1; r += step) {
    for (let k = 0; k < cols; k += step) {
      const i = r * GRID_W + ((((c0 + k) % GRID_W) + GRID_W) % GRID_W);
      if (second) sec += second[i];
      const v = grid[i];
      if (Number.isNaN(v)) continue;
      sum += v;
      n++;
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

/** Value at a point (average of a small neighbourhood, so a single pixel doesn't decide). */
export function valueAt(grid: Float32Array, lat: number, lon: number, radius = 1): number | null {
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
