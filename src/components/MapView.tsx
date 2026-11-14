// The shared map: NASA Blue Marble underneath, then every playing EIC visualization stacked on
// top (WebGL, see map/gl.ts: each layer's background is made transparent so they all fit).
// A 2D canvas on top draws borders, the scan needle, the probe and a flash for every note.

import { useEffect, useRef } from 'react';
import { mesh } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { GeoJsonObject } from 'geojson';
import { geoEquirectangular, geoPath } from 'd3-geo';
import { nameRegion } from '../config/places';
import { RECORDS, RECORD_BY_ID } from '../config/records';
import { layers } from '../eic/layers';
import { panBy, resetView, setProbe, zoomBy } from '../state/actions';
import { audible, getState, useStore, type AppState } from '../state/store';
import { baseScale, screenToLatLon, setViewport, stepCamera } from '../map/camera';
import { MapRenderer, type GlLayer } from '../map/gl';
import { audioNow, hits, scanNeedle } from '../audio/conductor';

const degrees = geoEquirectangular().scale(180 / Math.PI).translate([0, 0]).precision(0.05);
let borders: Path2D | null = null;
function loadBorders(onDone: () => void) {
  void import('world-atlas/countries-50m.json').then((c) => {
    const ct = (c.default ?? c) as unknown as Topology<{ countries: GeometryCollection }>;
    const p = new Path2D();
    geoPath(degrees, p as unknown as CanvasRenderingContext2D)(mesh(ct, ct.objects.countries, (a, b) => a !== b) as unknown as GeoJsonObject as never);
    borders = p;
    onDone();
  });
}

/** Draw order: Earth underneath (ocean first), humanity on top. */
const ORDER = RECORDS.map((r) => r.id);

const pick = (s: AppState) => [s.focus, s.playing, s.solo, s.humanity, s.mode, s.probe, s.sources, s.settings.highContrast];

export function MapView() {
  const glRef = useRef<HTMLCanvasElement>(null);
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
    const canvas = overlayRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    let renderer: MapRenderer | null = null;
    try {
      renderer = new MapRenderer(glCanvas);
    } catch (e) {
      console.error('WebGL2 is needed for the map', e);
    }
    let dirty = true;
    let raf = 0;
    let last = performance.now();

    const base = new Image();
    base.src = '/basemap/blue-marble.jpg';
    base.onload = () => {
      renderer?.setBase(base);
      dirty = true;
    };
    loadBorders(() => (dirty = true));

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      for (const c of [glCanvas, canvas]) {
        c.width = Math.round(wrap.clientWidth * dpr);
        c.height = Math.round(wrap.clientHeight * dpr);
      }
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
      const f = s.focus;
      const hc = s.settings.highContrast;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width;
      const h = canvas.height;
      const k = baseScale(w / dpr, h / dpr) * f.zoom * dpr;

      // Map layers (WebGL).
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
      renderer?.draw({ lon: f.lon, lat: f.lat, k }, hc ? 0.45 : list.length ? 0.72 : 0.9, list);

      // Overlay (2D).
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const cy = h / 2 + f.lat * k;
      let x0 = w / 2 + (-180 - f.lon) * k;
      while (x0 > 0) x0 -= 360 * k;
      while (x0 + 360 * k < 0) x0 += 360 * k;
      if (borders) {
        for (let x = x0; x < w; x += 360 * k) {
          ctx.setTransform(k, 0, 0, k, x + 180 * k, cy);
          ctx.lineWidth = ((hc ? 1.2 : 0.6) * dpr) / k;
          ctx.strokeStyle = hc ? 'rgba(255,255,255,0.9)' : 'rgba(255,240,209,0.3)';
          ctx.stroke(borders);
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }

      // Scan needle and a flash for every note it plays.
      const needle = scanNeedle();
      if (needle != null) {
        const nx = needle * w;
        const g = ctx.createLinearGradient(nx - 60 * dpr, 0, nx, 0);
        g.addColorStop(0, 'rgba(255,215,36,0)');
        g.addColorStop(1, 'rgba(255,215,36,0.25)');
        ctx.fillStyle = g;
        ctx.fillRect(nx - 60 * dpr, 0, 60 * dpr, h);
        ctx.fillStyle = '#FFD724';
        ctx.shadowColor = '#FFD724';
        ctx.shadowBlur = 14 * dpr;
        ctx.fillRect(nx - 1.5 * dpr, 0, 3 * dpr, h);
        ctx.shadowBlur = 0;
      }
      const now = audioNow();
      for (const hit of hits) {
        const age = now - hit.at;
        if (age < 0 || age > 1) continue;
        const t = age / 1;
        const hx = hit.x * w;
        const hy = hit.y * h;
        const r = (6 + 22 * t) * dpr * (0.7 + 0.6 * hit.v);
        ctx.globalAlpha = (1 - t) * 0.9;
        ctx.strokeStyle = hit.colour;
        ctx.lineWidth = 3 * dpr * (1 - t) + 1;
        ctx.beginPath();
        ctx.arc(hx, hy, r, 0, Math.PI * 2);
        ctx.stroke();
        if (age < 0.25) {
          ctx.globalAlpha = 1 - age / 0.25;
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(hx, hy, 4 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // Probe.
      if (s.mode === 'probe') {
        let d = s.probe.lon - f.lon;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        const px = w / 2 + d * k;
        const py = h / 2 - (s.probe.lat - f.lat) * k;
        const pulse = 1 + 0.15 * Math.sin(performance.now() / 180);
        ctx.strokeStyle = '#FFD724';
        ctx.lineWidth = 3 * dpr;
        ctx.beginPath();
        ctx.arc(px, py, 16 * dpr * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#FFD724';
        ctx.beginPath();
        ctx.arc(px, py, 3.5 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const moving = stepCamera((now - last) / 1000);
      last = now;
      const s = getState();
      const animating = s.mode !== 'listen' || audible(s).some((id) => {
        const el = layers.get(id)?.el;
        return el instanceof HTMLVideoElement && !el.paused;
      });
      if (moving || animating) dirty = true;
      if (!dirty) return;
      dirty = false;
      draw();
    };
    raf = requestAnimationFrame(frame);
    const tick = window.setInterval(() => (dirty = true), 500);

    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;
    const local = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return screenToLatLon(e.clientX - r.left, e.clientY - r.top);
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
      if (moved < 4 && getState().mode === 'probe') {
        const p = local(e);
        setProbe(p.lat, p.lon);
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
      <canvas
        ref={overlayRef}
        role="img"
        aria-label={`Map showing ${shown.map((id) => RECORD_BY_ID[id].name).join(', ') || 'the Earth'}. ${label} ${region}. Drag or Shift and the arrow keys to move, scroll or plus and minus to zoom.`}
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
