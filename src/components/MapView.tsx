// The shared map: NASA Blue Marble underneath, then every playing EIC visualization stacked on
// top (WebGL, see map/gl.ts: each layer's background is made transparent so they all fit).
// A 2D canvas on top draws borders, the scan needle, the probe and a flash for every note.

import { useEffect, useRef } from 'react';
import { feature, mesh } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { GeoJsonObject } from 'geojson';
import { geoEquirectangular, geoPath } from 'd3-geo';
import { nameRegion } from '../config/places';
import { RECORDS, RECORD_BY_ID } from '../config/records';
import { layers } from '../eic/layers';
import { openCloseUp, panBy, probeAt, resetView, setProbe, zoomBy } from '../state/actions';
import { audible, getState, useStore, type AppState } from '../state/store';
import { baseScale, latLonToScreen, screenToLatLon, setViewport, stepCamera } from '../map/camera';
import { MapRenderer, type GlLayer } from '../map/gl';
import { audioNow, hits, scanNeedle } from '../audio/conductor';

const degrees = geoEquirectangular().scale(180 / Math.PI).translate([0, 0]).precision(0.05);
let borders: Path2D | null = null;
let coast: Path2D | null = null;
function loadOutlines(onDone: () => void) {
  void Promise.all([import('world-atlas/countries-50m.json'), import('world-atlas/land-50m.json')]).then(([c, l]) => {
    const ct = (c.default ?? c) as unknown as Topology<{ countries: GeometryCollection }>;
    const lt = (l.default ?? l) as unknown as Topology<{ land: GeometryCollection }>;
    const draw = (g: unknown) => {
      const p = new Path2D();
      geoPath(degrees, p as unknown as CanvasRenderingContext2D)(g as never);
      return p;
    };
    borders = draw(mesh(ct, ct.objects.countries, (a, b) => a !== b) as unknown as GeoJsonObject);
    coast = draw(feature(lt, lt.objects.land) as unknown as GeoJsonObject);
    onDone();
  });
}

/** Bahrain's pin on the world map: tap it for the close-up. */
export const BAHRAIN = { lat: 26.07, lon: 50.55 };

/** Draw order: Earth underneath (ocean first), humanity on top. */
const ORDER = RECORDS.map((r) => r.id);

/** Changes that need the map layers redrawn (the mix changes 10 times a second and must not). */
const pickMap = (s: AppState) => [s.focus, s.playing, s.solo, s.humanity, s.sources, s.settings.highContrast];
/** Changes that need the outlines redrawn. */
const pickOutline = (s: AppState) => [s.focus, s.settings.highContrast, s.closeUp];
/** The GPU draws at most 1.5x resolution: sharp enough, and much lighter on a laptop. */
const glDpr = () => Math.min(1.5, window.devicePixelRatio || 1);

export function MapView() {
  const glRef = useRef<HTMLCanvasElement>(null);
  const outlineRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const focus = useStore((s) => s.focus);
  const mode = useStore((s) => s.mode);
  const probe = useStore((s) => s.probe);
  const playing = useStore((s) => s.playing);
  const solo = useStore((s) => s.solo);
  const shown = audible({ ...getState(), playing, solo });
  const region = mode === 'probe' ? nameRegion(probe.lat, probe.lon, 4) : nameRegion(focus.lat, focus.lon, focus.zoom);

  useEffect(() => {
    const glCanvas = glRef.current!;
    const outline = outlineRef.current!;
    const canvas = overlayRef.current!;
    const wrap = wrapRef.current!;
    const octx = outline.getContext('2d')!;
    const ctx = canvas.getContext('2d')!;
    let renderer: MapRenderer | null = null;
    try {
      renderer = new MapRenderer(glCanvas);
    } catch (e) {
      console.error('WebGL2 is needed for the map', e);
    }
    let mapDirty = true;
    let outlineDirty = true;
    let raf = 0;
    let last = performance.now();
    const videoTimes = new Map<HTMLVideoElement, number>();

    const base = new Image();
    base.src = '/basemap/blue-marble.jpg';
    base.onload = () => {
      renderer?.setBase(base);
      mapDirty = true;
    };
    loadOutlines(() => (outlineDirty = true));

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      glCanvas.width = Math.round(wrap.clientWidth * glDpr());
      glCanvas.height = Math.round(wrap.clientHeight * glDpr());
      for (const c of [outline, canvas]) {
        c.width = Math.round(wrap.clientWidth * dpr);
        c.height = Math.round(wrap.clientHeight * dpr);
      }
      setViewport(wrap.clientWidth, wrap.clientHeight);
      mapDirty = true;
      outlineDirty = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();
    let prevMap = pickMap(getState());
    let prevOutline = pickOutline(getState());
    const unsub = useStore.subscribe((s) => {
      const m = pickMap(s);
      if (m.some((v, i) => v !== prevMap[i])) mapDirty = true;
      prevMap = m;
      const o = pickOutline(s);
      if (o.some((v, i) => v !== prevOutline[i])) outlineDirty = true;
      prevOutline = o;
    });

    /** The EIC layers, on the GPU. Only when the view or a video frame changed. */
    const drawMap = () => {
      const s = getState();
      const f = s.focus;
      const k = baseScale() * f.zoom * glDpr();
      const on = audible(s);
      const list: GlLayer[] = [];
      for (const id of ORDER) {
        if (!on.includes(id)) continue;
        const layer = layers.get(id);
        if (!layer?.ready || !layer.el) continue;
        const rec = layer.rec;
        list.push({
          source: layer.el,
          isVideo: layer.el instanceof HTMLVideoElement,
          mode: layer.placeholder ? rec.keyingPlaceholder ?? rec.keying : rec.keying,
          area: rec.area,
          masks: layer.placeholder ? [] : rec.masks ?? [],
          alpha: rec.side === 'human' ? 0.15 + 0.85 * s.humanity : 1,
          boost: rec.boost ?? 1,
          floor: layer.placeholder || rec.decode.kind !== 'bright' ? 0.1 : Math.max(0.1, rec.decode.floor - 0.1),
        });
      }
      renderer?.draw({ lon: f.lon, lat: f.lat, k }, s.settings.highContrast ? 0.45 : list.length ? 0.72 : 0.9, list);
    };

    /** Coastlines (clear, with a dark halo so they show over any layer), borders and the Bahrain pin. */
    const drawOutline = () => {
      const s = getState();
      const f = s.focus;
      const hc = s.settings.highContrast;
      const dpr = window.devicePixelRatio || 1;
      const w = outline.width;
      const h = outline.height;
      const k = baseScale() * f.zoom * dpr;
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, w, h);
      const cy = h / 2 + f.lat * k;
      let x0 = w / 2 + (-180 - f.lon) * k;
      while (x0 > 0) x0 -= 360 * k;
      while (x0 + 360 * k < 0) x0 += 360 * k;
      for (let x = x0; x < w; x += 360 * k) {
        octx.setTransform(k, 0, 0, k, x + 180 * k, cy);
        if (coast) {
          octx.lineJoin = 'round';
          octx.lineWidth = (3 * dpr) / k;
          octx.strokeStyle = 'rgba(0,0,0,0.55)';
          octx.stroke(coast);
          octx.lineWidth = ((hc ? 1.8 : 1.2) * dpr) / k;
          octx.strokeStyle = hc ? '#ffffff' : 'rgba(255,240,209,0.85)';
          octx.stroke(coast);
        }
        if (borders) {
          octx.lineWidth = ((hc ? 1 : 0.7) * dpr) / k;
          octx.strokeStyle = hc ? 'rgba(255,255,255,0.7)' : 'rgba(255,240,209,0.35)';
          octx.stroke(borders);
        }
      }
      octx.setTransform(1, 0, 0, 1, 0, 0);
      // Bahrain pin
      const p = latLonToScreen(BAHRAIN.lat, BAHRAIN.lon);
      const px = p.x * dpr;
      const py = p.y * dpr;
      octx.fillStyle = '#FFD724';
      octx.strokeStyle = '#450101';
      octx.lineWidth = 2 * dpr;
      octx.beginPath();
      octx.arc(px, py, 7 * dpr, 0, Math.PI * 2);
      octx.fill();
      octx.stroke();
      octx.font = `700 ${12 * dpr}px -apple-system, system-ui, sans-serif`;
      octx.lineWidth = 3 * dpr;
      octx.strokeStyle = 'rgba(43,0,0,0.85)';
      octx.strokeText('Bahrain · tap for close-up', px + 11 * dpr, py + 4 * dpr);
      octx.fillStyle = '#FFF0D1';
      octx.fillText('Bahrain · tap for close-up', px + 11 * dpr, py + 4 * dpr);
    };

    /** Needle, note flashes and the probe: small, redrawn every frame only in Scan and Probe. */
    let overlayHadContent = false;
    const drawOverlay = () => {
      const s = getState();
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      overlayHadContent = false;
      if (s.closeUp) return;
      const needle = scanNeedle();
      if (needle != null) {
        overlayHadContent = true;
        const nx = needle * w;
        const g = ctx.createLinearGradient(nx - 70 * dpr, 0, nx, 0);
        g.addColorStop(0, 'rgba(255,215,36,0)');
        g.addColorStop(1, 'rgba(255,215,36,0.25)');
        ctx.fillStyle = g;
        ctx.fillRect(nx - 70 * dpr, 0, 70 * dpr, h);
        ctx.fillStyle = '#FFD724';
        ctx.shadowColor = '#FFD724';
        ctx.shadowBlur = 14 * dpr;
        ctx.fillRect(nx - 1.5 * dpr, 0, 3 * dpr, h);
        ctx.shadowBlur = 0;
      }
      const now = audioNow();
      for (const hit of hits) {
        const age = now - hit.at;
        if (age < 0 || age > 1.2) continue;
        overlayHadContent = true;
        const t = age / 1.2;
        const hx = hit.x * w;
        const hy = hit.y * h;
        const r = (6 + 24 * t) * dpr * (0.7 + 0.6 * hit.v);
        ctx.globalAlpha = (1 - t) * 0.95;
        ctx.strokeStyle = hit.colour;
        ctx.lineWidth = 3 * dpr * (1 - t) + 1;
        ctx.beginPath();
        ctx.arc(hx, hy, r, 0, Math.PI * 2);
        ctx.stroke();
        if (age < 0.3) {
          ctx.globalAlpha = 1 - age / 0.3;
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(hx, hy, 4 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      if (s.mode === 'probe') {
        overlayHadContent = true;
        const p = latLonToScreen(s.probe.lat, s.probe.lon);
        const pulse = 1 + 0.15 * Math.sin(performance.now() / 180);
        ctx.strokeStyle = '#FFD724';
        ctx.lineWidth = 3 * dpr;
        ctx.beginPath();
        ctx.arc(p.x * dpr, p.y * dpr, 16 * dpr * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#FFD724';
        ctx.beginPath();
        ctx.arc(p.x * dpr, p.y * dpr, 3.5 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const moving = stepCamera((now - last) / 1000);
      last = now;
      const s = getState();
      if (moving) {
        mapDirty = true;
        outlineDirty = true;
      }
      // a playing video only needs a redraw when it has shown a new frame (about 30 times a second)
      for (const id of audible(s)) {
        const el = layers.get(id)?.el;
        if (el instanceof HTMLVideoElement && !el.paused && videoTimes.get(el) !== el.currentTime) {
          videoTimes.set(el, el.currentTime);
          mapDirty = true;
        }
      }
      if (mapDirty) {
        mapDirty = false;
        drawMap();
      }
      if (outlineDirty) {
        outlineDirty = false;
        drawOutline();
      }
      if (s.mode !== 'listen' || overlayHadContent) drawOverlay();
    };
    raf = requestAnimationFrame(frame);
    const tick = window.setInterval(() => (mapDirty = true), 1000);

    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;
    const local = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return screenToLatLon(e.clientX - r.left, e.clientY - r.top);
    };
    const nearPin = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      const p = latLonToScreen(BAHRAIN.lat, BAHRAIN.lon);
      const dx = e.clientX - r.left - p.x;
      const dy = e.clientY - r.top - p.y;
      return dx * dx + dy * dy < 16 * 16 || (dx > 0 && dx < 175 && Math.abs(dy) < 10);
    };
    const scale = () => baseScale() * getState().focus.zoom;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      moved = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('grabbing');
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) {
        canvas.classList.toggle('over-pin', nearPin(e));
        if (getState().mode === 'probe') {
          const p = local(e);
          setProbe(p.lat, p.lon);
        }
        return;
      }
      const k = scale();
      moved += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
      panBy((e.clientY - lastY) / k, -(e.clientX - lastX) / k);
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
      canvas.classList.remove('grabbing');
      if (moved >= 4) return;
      if (nearPin(e)) {
        void openCloseUp();
        return;
      }
      if (getState().mode === 'probe') {
        const p = local(e);
        probeAt(p.lat, p.lon, true);
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const lines = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1;
      const speed = e.ctrlKey ? 0.012 : 0.004;
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

  const label = mode === 'probe' ? 'Probe at' : mode === 'scan' ? 'Scanning' : 'Listening to';
  return (
    <div className={`map mode-${mode}`} ref={wrapRef}>
      <canvas ref={glRef} className="map-gl" aria-hidden="true" />
      <canvas ref={outlineRef} className="map-outline" aria-hidden="true" />
      <canvas
        ref={overlayRef}
        role="img"
        aria-label={`Map showing ${shown.map((id) => RECORD_BY_ID[id].name).join(', ') || 'the Earth'}. ${label} ${region}. Drag or Shift and the arrow keys to move, scroll or plus and minus to zoom. In Probe mode, click to hear what is there.`}
      />
      <div className="map-region" aria-hidden="true">
        <span>{label}</span> <strong>{region}</strong>
      </div>
      <div className="zoom-controls" role="group" aria-label="Zoom">
        <button type="button" onClick={() => zoomBy(2)} aria-label="Zoom in" title="Zoom in (+)">+</button>
        <button type="button" onClick={() => zoomBy(0.5)} aria-label="Zoom out" title="Zoom out (−)">−</button>
        <button type="button" onClick={() => resetView()} aria-label="Whole planet" title="Whole planet (0)" className="globe">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><ellipse cx="12" cy="12" rx="3.6" ry="8.5" /><path d="M3.5 12h17" /></svg>
        </button>
      </div>
      <p className="attribution">Visualizations: NASA Earth Information Center / Scientific Visualization Studio · Base map: NASA Blue Marble</p>
    </div>
  );
}
