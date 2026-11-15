// Detailed base map for zooming in: NASA Blue Marble Next Generation streamed as tiles from
// NASA GIBS (Global Imagery Browse Services), up to about 500 m per pixel. The bundled
// 4096-px Blue Marble is about 10 km per pixel, fine for the whole planet but soft up close.
//
// GIBS's geographic tiles (EPSG:4326) use the same flat latitude/longitude grid as our map
// and the EIC records, so tiles are simply pasted into one canvas that covers the view plus a
// margin. That canvas is geo-referenced, so the map can pan and zoom over it without redrawing;
// it is rebuilt only when the view leaves it or needs a sharper level. If GIBS can't be
// reached, nothing breaks: the bundled base map shows through.

const GIBS =
  'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/wmts.cgi?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
  '&LAYER=BlueMarble_NextGeneration&STYLE=default&TILEMATRIXSET=500m&FORMAT=image%2Fjpeg';
const TILE = 512;
const RES0 = 0.5625; // degrees per pixel at level 0; each level halves it
const MAX_LEVEL = 7; // about 500 m per pixel
/** Below this level the bundled Blue Marble (0.088° per pixel) is already as sharp. */
const MIN_LEVEL = 3;
const MAX_CANVAS = 3072;

export interface Detail {
  canvas: HTMLCanvasElement;
  west: number;
  north: number;
  east: number; // may exceed 180 when the view crosses the date line
  south: number;
  level: number;
  version: number; // bumps whenever the canvas content changes
}

const cache = new Map<string, HTMLImageElement>(); // insertion order = least recently used first
const failed = new Set<string>();
let detail: Detail | null = null;
let pending: { key: string } | null = null;
let onChange: () => void = () => undefined;
let offline = false;

export const getDetail = () => detail;
export function onDetailChange(cb: () => void) {
  onChange = cb;
}

function tileUrl(level: number, row: number, col: number) {
  return `${GIBS}&TILEMATRIX=${level}&TILEROW=${row}&TILECOL=${col}`;
}

function loadTile(url: string): Promise<HTMLImageElement | null> {
  const hit = cache.get(url);
  if (hit) {
    cache.delete(url);
    cache.set(url, hit);
    return Promise.resolve(hit);
  }
  if (failed.has(url) || offline) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // GIBS allows it, so the tiles can go into WebGL
    img.decoding = 'async';
    img.onload = () => {
      cache.set(url, img);
      while (cache.size > 400) cache.delete(cache.keys().next().value!);
      resolve(img);
    };
    img.onerror = () => {
      failed.add(url);
      if (failed.size > 12 && cache.size === 0) offline = true; // GIBS unreachable: stop trying
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * Make sure the detail canvas covers this view at a sharp enough level.
 * degPerPx: degrees per device pixel on screen now.
 */
export function updateDetail(view: { west: number; east: number; south: number; north: number }, degPerPx: number) {
  let level = MAX_LEVEL;
  while (level > 0 && RES0 / 2 ** (level - 1) <= degPerPx * 1.1) level--;
  if (level < MIN_LEVEL || offline) {
    if (detail) {
      detail = null;
      onChange();
    }
    return;
  }
  // the view still fits inside what we have, at this level: nothing to do
  const d = detail;
  const inside = (w: number, e: number) => d && w >= d.west && e <= d.east && view.south >= d.south && view.north <= d.north;
  if (d && d.level === level && (inside(view.west, view.east) || inside(view.west + 360, view.east + 360))) return;

  const res = RES0 / 2 ** level;
  const lonSpan = view.east - view.west;
  const latSpan = view.north - view.south;
  // the view plus a margin, as big as the canvas cap allows
  let mx = lonSpan * 0.35;
  let my = latSpan * 0.35;
  while ((lonSpan + 2 * mx) / res > MAX_CANVAS || (latSpan + 2 * my) / res > MAX_CANVAS) {
    mx *= 0.7;
    my *= 0.7;
    if (mx < lonSpan * 0.02) break;
  }
  const west = view.west - mx;
  const east = view.east + mx;
  const north = Math.min(90, view.north + my);
  const south = Math.max(-90, view.south - my);
  const w = Math.min(MAX_CANVAS, Math.round((east - west) / res));
  const h = Math.min(MAX_CANVAS, Math.round((north - south) / res));
  if (w < 2 || h < 2) return;
  const key = `${level}:${west.toFixed(3)}:${north.toFixed(3)}`;
  pending = { key };
  void compose(level, west, east, north, south, w, h, key);
}

async function compose(level: number, west: number, east: number, north: number, south: number, w: number, h: number, key: string) {
  const res = RES0 / 2 ** level;
  const span = TILE * res; // degrees per tile
  const cols = Math.ceil(360 / span);
  const rows = Math.ceil(180 / span);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const sx = w / (east - west);
  const sy = h / (north - south);
  // start from the previous detail (blurrier, or offset) so nothing flashes while tiles arrive
  const old = detail;
  if (old) {
    for (const shift of [0, -360, 360]) {
      ctx.drawImage(old.canvas, (old.west + shift - west) * sx, (north - old.north) * sy, (old.east - old.west) * sx, (old.north - old.south) * sy);
    }
  }
  const jobs: Promise<void>[] = [];
  let painted = 0;
  const r0 = Math.max(0, Math.floor((90 - north) / span));
  const r1 = Math.min(rows - 1, Math.floor((90 - south) / span));
  const c0 = Math.floor((west + 180) / span);
  const c1 = Math.floor((east + 180) / span);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const col = ((c % cols) + cols) % cols;
      const tileWest = -180 + c * span; // in the canvas's own (possibly > 180) longitude
      const tileNorth = 90 - r * span;
      // the last column and row run past 180° / -90°: only paste the real part
      const validW = Math.min(TILE, Math.round((180 - (-180 + col * span)) / res));
      const validH = Math.min(TILE, Math.round((tileNorth + 90) / res));
      if (validW <= 0 || validH <= 0) continue;
      jobs.push(
        loadTile(tileUrl(level, r, col)).then((img) => {
          if (!img || pending?.key !== key) return;
          // a hair of overlap so no seams show between tiles
          ctx.drawImage(img, 0, 0, validW, validH, (tileWest - west) * sx, (north - tileNorth) * sy, validW * res * sx + 0.6, validH * res * sy + 0.6);
          painted++;
        }),
      );
    }
  }
  // show progress: publish once the first batch lands, then again when all are in
  const publish = () => {
    if (pending?.key !== key || !painted) return;
    detail = { canvas, west, east, north, south, level, version: (detail?.version ?? 0) + 1 };
    onChange();
  };
  const timer = window.setTimeout(publish, 700);
  await Promise.all(jobs);
  window.clearTimeout(timer);
  publish();
}
