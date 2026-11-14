// Side B: the shared flat map. NASA Blue Marble underneath, each playing record's NASA data on
// top in its own realistic colours. Same latitude/longitude layout as the data
// (equirectangular), so every grid cell lines up without reprojection, and the whole map is
// one linear transform: drawing is cheap, and coastlines come from vector outlines so they
// stay sharp at any zoom even though the data grid is 2 degrees.

import { useEffect, useRef } from 'react';
import { feature, mesh } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { GeoJsonObject } from 'geojson';
import { geoEquirectangular, geoPath } from 'd3-geo';
import land110 from 'world-atlas/land-110m.json';
import { RECORDS, type RecordId } from '../config/records';
import { nameRegion } from '../config/places';
import { gridAt, listenRadius, NO_DATA } from '../data/sample';
import type { LoadedData } from '../data/loader';
import { panBy, resetView, zoomBy } from '../state/actions';
import { getState, useStore, type AppState } from '../state/store';
import { baseScale, screenToLatLon, setViewport, stepCamera } from '../map/camera';
import { LAYER_STYLES, buildLut } from '../map/styles';

// ---------- geometry in degree space: x = longitude, y = -latitude ----------
// d3 cuts shapes at 180 degrees properly; a projection with scale 180/pi gives plain degrees.
const degrees = geoEquirectangular().scale(180 / Math.PI).translate([0, 0]).precision(0.05);
function pathOf(g: GeoJsonObject) {
  const p = new Path2D();
  geoPath(degrees, p as unknown as CanvasRenderingContext2D)(g as Parameters<ReturnType<typeof geoPath>>[0]);
  return p;
}
type LandTopo = Topology<{ land: GeometryCollection }>;
type CountryTopo = Topology<{ countries: GeometryCollection }>;
const geom = {
  land: pathOf(feature(land110 as unknown as LandTopo, (land110 as unknown as LandTopo).objects.land)),
  ocean: null as Path2D | null,
  borders: null as Path2D | null,
};
function makeOcean() {
  const o = new Path2D();
  o.rect(-200, -95, 400, 190);
  o.addPath(geom.land);
  geom.ocean = o;
}
makeOcean();
let detailLoaded: Promise<void> | null = null;
function loadDetail(onDone: () => void) {
  detailLoaded ??= Promise.all([import('world-atlas/land-50m.json'), import('world-atlas/countries-50m.json')]).then(([l, c]) => {
    const lt = (l.default ?? l) as unknown as LandTopo;
    const ct = (c.default ?? c) as unknown as CountryTopo;
    geom.land = pathOf(feature(lt, lt.objects.land));
    geom.borders = pathOf(mesh(ct, ct.objects.countries, (a, b) => a !== b));
    makeOcean();
  });
  void detailLoaded.then(onDone);
}

// ---------- layer images (cached, so panning and zooming never rebuild them) ----------
const LUTS = Object.fromEntries(RECORDS.map((r) => [r.id, buildLut(LAYER_STYLES[r.id].ramp)]));
const fieldCache = new Map<string, HTMLCanvasElement>();
const gridCache = new Map<string, Uint8Array>();

function cacheKey(data: LoadedData, layerId: string, year: number, month: number | null) {
  const layer = data.layers.get(layerId);
  const monthly = month != null && layer?.monthly.has(Math.floor(year)) ? month : 'y';
  const y = Math.abs(year - Math.round(year)) < 0.001 ? Math.round(year) : year.toFixed(2);
  return `${layerId}|${y}|${monthly}`;
}
function remember<T>(cache: Map<string, T>, key: string, make: () => T | null, max = 40): T | null {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const v = make();
  if (v == null) return null;
  cache.set(key, v);
  if (cache.size > max) cache.delete(cache.keys().next().value!);
  return v;
}
function cachedGrid(data: LoadedData, layerId: string, year: number, month: number | null) {
  return remember(gridCache, cacheKey(data, layerId, year, month), () => gridAt(data, layerId, year, month));
}
/** The grid as a small image, one pixel per cell, with one wrapped column on each side so smoothing doesn't seam at 180 degrees. */
function fieldImage(data: LoadedData, recId: RecordId, layerId: string, year: number, month: number | null) {
  return remember(fieldCache, `${recId}:${cacheKey(data, layerId, year, month)}`, () => {
    const grid = cachedGrid(data, layerId, year, month);
    if (!grid) return null;
    const { rows, cols } = data.index.grid;
    const c = document.createElement('canvas');
    c.width = cols + 2;
    c.height = rows;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(cols + 2, rows);
    const lut = LUTS[recId];
    // Under a land or ocean mask, spread values into the masked-out cells first, so the
    // smoothed image reaches all the way to the (sharp) coastline instead of fading out.
    const src = LAYER_STYLES[recId].mask ? fillGaps(grid, rows, cols, 3) : grid;
    for (let r = 0; r < rows; r++) {
      for (let x = 0; x < cols + 2; x++) {
        const v = src[r * cols + ((x - 1 + cols) % cols)];
        if (v === NO_DATA) continue;
        const o = (r * (cols + 2) + x) * 4;
        img.data[o] = lut[v * 4];
        img.data[o + 1] = lut[v * 4 + 1];
        img.data[o + 2] = lut[v * 4 + 2];
        img.data[o + 3] = lut[v * 4 + 3];
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  });
}

/** Fill no-data cells from their neighbours, a few cells deep. */
function fillGaps(grid: Uint8Array, rows: number, cols: number, passes: number): Uint8Array {
  let cur = grid;
  for (let p = 0; p < passes; p++) {
    const next = new Uint8Array(cur);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (cur[i] !== NO_DATA) continue;
        let sum = 0;
        let n = 0;
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
          const rr = r + dr;
          if (rr < 0 || rr >= rows) continue;
          const v = cur[rr * cols + ((c + dc + cols) % cols)];
          if (v === NO_DATA) continue;
          sum += v;
          n++;
        }
        if (n) next[i] = Math.round(sum / n);
      }
    }
    cur = next;
  }
  return cur;
}

function sprite(inner: string, outer: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, outer);
  g.addColorStop(1, `${outer}00`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return c;
}
const SPRITES = Object.fromEntries(
  RECORDS.filter((r) => LAYER_STYLES[r.id].dots).map((r) => [r.id, sprite(...LAYER_STYLES[r.id].dots!.colour)]),
);
/** Stable pseudo-random 0-1 per (cell, dot), so dots don't jump around between frames. */
const jitter = (i: number, j: number) => {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(j + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

// Only these parts of the state change the picture (the mix changes 20 times a second, and must not cause redraws).
const pick = (s: AppState) => [s.data, s.focus, s.year, s.month, s.playing, s.sideA, s.humanity, s.settings.highContrast];

export function MapView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const focus = useStore((s) => s.focus);
  const mock = useStore((s) => s.data?.index.mock);
  const region = nameRegion(focus.lat, focus.lon, focus.zoom);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    let dirty = true;
    let raf = 0;
    let last = performance.now();

    const base = new Image();
    base.src = '/basemap/blue-marble.jpg';
    base.onload = () => (dirty = true);
    loadDetail(() => (dirty = true));

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(wrap.clientWidth * dpr);
      canvas.height = Math.round(wrap.clientHeight * dpr);
      setViewport(wrap.clientWidth, wrap.clientHeight);
      dirty = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();
    let prev = pick(getState());
    const unsub = useStore.subscribe((s) => {
      const next = pick(s);
      if (next.some((v, i) => v !== prev[i])) dirty = true;
      prev = next;
    });

    const draw = () => {
      const s = getState();
      const { data, focus: f, year, month, humanity, playing, sideA } = s;
      const hc = s.settings.highContrast;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width;
      const h = canvas.height;
      const k = baseScale(w / dpr, h / dpr) * f.zoom * dpr; // device pixels per degree
      const cy = h / 2 + f.lat * k;
      let x0 = w / 2 + (-180 - f.lon) * k;
      while (x0 > 0) x0 -= 360 * k;
      while (x0 + 360 * k < 0) x0 += 360 * k;
      const copies: number[] = [];
      for (let x = x0; x < w; x += 360 * k) copies.push(x);
      const toDeg = (x: number) => ctx.setTransform(k, 0, 0, k, x + 180 * k, cy);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#04070d';
      ctx.fillRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // Base map, dimmed a little so the data stands out.
      for (const x of copies) {
        toDeg(x);
        if (base.complete && base.naturalWidth) ctx.drawImage(base, -180, -90, 360, 180);
        else {
          ctx.fillStyle = '#16263a';
          ctx.fill(geom.land);
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = hc ? 'rgba(0,0,0,0.6)' : 'rgba(18,4,4,0.28)';
      ctx.fillRect(0, 0, w, h);

      if (data) {
        const res = data.index.grid.resolutionDeg;
        const { cols } = data.index.grid;
        for (const rec of RECORDS) {
          if (!playing[rec.id] || sideA === rec.id) continue;
          const style = LAYER_STYLES[rec.id];
          const alpha = rec.side === 'human' ? humanity : 1;
          if (alpha <= 0.01) continue;
          const field = style.ramp.length ? fieldImage(data, rec.id, rec.layer, year, month) : null;
          const grid = style.dots ? cachedGrid(data, rec.layer, year, month) : null;
          for (const x of copies) {
            ctx.save();
            toDeg(x);
            if (style.mask) ctx.clip(style.mask === 'land' ? geom.land : geom.ocean!, 'evenodd');
            ctx.globalAlpha = alpha;
            if (field) ctx.drawImage(field, -180 - res, -90, 360 + 2 * res, 180);
            if (grid && style.dots) {
              ctx.setTransform(1, 0, 0, 1, 0, 0);
              const d = style.dots;
              const spr = SPRITES[rec.id];
              const size = d.size * dpr * (0.75 + 0.25 * Math.sqrt(f.zoom));
              const minV = d.threshold * 254;
              ctx.globalCompositeOperation = d.glow ? 'lighter' : 'source-over';
              const perCellBoost = Math.min(3, Math.sqrt(f.zoom)); // more detail as you zoom in
              for (let i = 0; i < grid.length; i++) {
                const v = grid[i];
                if (v === NO_DATA || v < minV) continue;
                const r = Math.floor(i / cols);
                const c = i % cols;
                const cellX = x + c * res * k;
                const cellY = cy + (-90 + r * res) * k;
                if (cellX > w || cellX + res * k < 0 || cellY > h || cellY + res * k < 0) continue;
                const vn = v / 254;
                const n = Math.ceil(vn * d.maxPerCell * perCellBoost);
                for (let j = 0; j < n; j++) {
                  const px = cellX + jitter(i, j * 3) * res * k;
                  const py = cellY + jitter(i, j * 3 + 1) * res * k;
                  const sz = size * (0.45 + 0.55 * vn) * (0.6 + 0.8 * jitter(i, j * 3 + 2));
                  ctx.drawImage(spr, px - sz, py - sz, sz * 2, sz * 2);
                }
              }
            }
            ctx.restore();
          }
        }
      }

      // Country borders and coastlines, faint.
      for (const x of copies) {
        toDeg(x);
        ctx.lineWidth = ((hc ? 1.2 : 0.6) * dpr) / k;
        ctx.strokeStyle = hc ? 'rgba(255,255,255,0.9)' : 'rgba(255,240,209,0.22)';
        if (geom.borders) ctx.stroke(geom.borders);
        if (hc) ctx.stroke(geom.land);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      // Where you are listening.
      const radius = listenRadius(f.zoom);
      if (radius < 180) {
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, radius * k, 0, Math.PI * 2);
        ctx.setLineDash([5 * dpr, 7 * dpr]);
        ctx.lineWidth = 1.5 * dpr;
        ctx.strokeStyle = 'rgba(255,215,36,0.85)';
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = '#FFD724';
      ctx.fillRect(w / 2 - 1 * dpr, h / 2 - 7 * dpr, 2 * dpr, 14 * dpr);
      ctx.fillRect(w / 2 - 7 * dpr, h / 2 - 1 * dpr, 14 * dpr, 2 * dpr);
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const moving = stepCamera((now - last) / 1000);
      last = now;
      if (moving) dirty = true;
      if (!dirty) return;
      dirty = false;
      draw();
    };
    raf = requestAnimationFrame(frame);
    // Monthly files arrive in the background; redraw now and then so they show up.
    const tick = window.setInterval(() => (dirty = true), 1000);

    // Drag to pan, wheel / trackpad pinch / double-click to zoom where the pointer is.
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const local = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return screenToLatLon(e.clientX - r.left, e.clientY - r.top);
    };
    const scale = () => baseScale() * getState().focus.zoom;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('grabbing');
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const k = scale();
      panBy((e.clientY - lastY) / k, -(e.clientX - lastX) / k);
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = () => {
      dragging = false;
      canvas.classList.remove('grabbing');
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const lines = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1;
      const speed = e.ctrlKey ? 0.012 : 0.004; // ctrlKey = trackpad pinch
      zoomBy(Math.exp(-e.deltaY * lines * speed), local(e));
    };
    const onDbl = (e: MouseEvent) => zoomBy(e.shiftKey ? 0.5 : 2, local(e));
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDbl);

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(tick);
      ro.disconnect();
      unsub();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDbl);
    };
  }, []);

  return (
    <div className="map" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Map of the playing records over NASA Blue Marble. Listening to ${region}. Drag, or Shift and the arrow keys, to move. Scroll, double-click, or plus and minus to zoom.`}
      />
      <div className="map-region" aria-hidden="true">
        <span>Listening to</span> <strong>{region}</strong>
      </div>
      <div className="zoom-controls" role="group" aria-label="Zoom">
        <button type="button" onClick={() => zoomBy(2)} aria-label="Zoom in" title="Zoom in (+)">+</button>
        <button type="button" onClick={() => zoomBy(0.5)} aria-label="Zoom out" title="Zoom out (−)">−</button>
        <button type="button" onClick={() => resetView()} aria-label="Whole planet" title="Whole planet (0)" className="globe">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><ellipse cx="12" cy="12" rx="3.6" ry="8.5" /><path d="M3.5 12h17" /></svg>
        </button>
      </div>
      <p className="attribution">
        Base map: NASA Blue Marble{mock ? ' · Data layers: mock data, not real yet' : ' · Data: NASA'}
      </p>
    </div>
  );
}
