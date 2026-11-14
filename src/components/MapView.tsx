// The shared map. NASA Blue Marble underneath, then the EIC visualizations themselves: every
// record is a flat (equirectangular) world map, so its video frames line up with the base map
// and with each other using one linear transform. Two layers are drawn at most (the two most
// recently turned on); the others play as sound only. The second layer is blended with
// "screen", so its bright data shows through without hiding the first.

import { useEffect, useRef } from 'react';
import { mesh } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { GeoJsonObject } from 'geojson';
import { geoEquirectangular, geoPath } from 'd3-geo';
import { nameRegion } from '../config/places';
import { RECORD_BY_ID } from '../config/records';
import { layers } from '../eic/layers';
import { panBy, resetView, setProbe, zoomBy } from '../state/actions';
import { getState, useStore, visible, type AppState } from '../state/store';
import { baseScale, screenToLatLon, setViewport, stepCamera } from '../map/camera';

// Country borders in degree space (x = longitude, y = -latitude); d3 cuts them at 180°.
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

const pick = (s: AppState) => [s.focus, s.order, s.playing, s.solo, s.humanity, s.mode, s.probe, s.scanX, s.sources, s.settings.highContrast];

export function MapView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const focus = useStore((s) => s.focus);
  const mode = useStore((s) => s.mode);
  const probe = useStore((s) => s.probe);
  const order = useStore((s) => s.order);
  const solo = useStore((s) => s.solo);
  const playing = useStore((s) => s.playing);
  const shown = visible({ ...getState(), order, solo, playing });
  const region = mode === 'probe' ? nameRegion(probe.lat, probe.lon, 4) : nameRegion(focus.lat, focus.lon, focus.zoom);

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
    loadBorders(() => (dirty = true));

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
      const f = s.focus;
      const hc = s.settings.highContrast;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width;
      const h = canvas.height;
      const k = baseScale(w / dpr, h / dpr) * f.zoom * dpr;
      const cy = h / 2 + f.lat * k;
      let x0 = w / 2 + (-180 - f.lon) * k;
      while (x0 > 0) x0 -= 360 * k;
      while (x0 + 360 * k < 0) x0 += 360 * k;
      const copies: number[] = [];
      for (let x = x0; x < w; x += 360 * k) copies.push(x);
      const toDeg = (x: number) => ctx.setTransform(k, 0, 0, k, x + 180 * k, cy);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#04070d';
      ctx.fillRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      for (const x of copies) {
        toDeg(x);
        if (base.complete && base.naturalWidth) ctx.drawImage(base, -180, -90, 360, 180);
      }

      // The EIC layers.
      visible(s).forEach((id, i) => {
        const layer = layers.get(id);
        const el = layer?.el;
        if (!layer?.ready || !el) return;
        const ew = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
        const eh = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
        if (!ew || !eh) return;
        const [ax0, ay0, ax1, ay1] = layer.rec.area;
        const alpha = layer.rec.side === 'human' ? 0.25 + 0.75 * s.humanity : 1;
        ctx.globalCompositeOperation = i === 0 ? 'source-over' : 'screen';
        ctx.globalAlpha = (i === 0 ? 1 : 0.9) * alpha;
        for (const x of copies) {
          toDeg(x);
          ctx.drawImage(el, ax0 * ew, ay0 * eh, (ax1 - ax0) * ew, (ay1 - ay0) * eh, -180, -90, 360, 180);
        }
      });
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;

      // Borders, faint, so places stay recognisable over any layer.
      if (borders) {
        for (const x of copies) {
          toDeg(x);
          ctx.lineWidth = ((hc ? 1.2 : 0.6) * dpr) / k;
          ctx.strokeStyle = hc ? 'rgba(255,255,255,0.9)' : 'rgba(255,240,209,0.28)';
          ctx.stroke(borders);
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      // Scan needle.
      if (s.mode === 'scan' && s.scanX != null) {
        const nx = s.scanX * w;
        const g = ctx.createLinearGradient(nx - 40 * dpr, 0, nx, 0);
        g.addColorStop(0, 'rgba(255,215,36,0)');
        g.addColorStop(1, 'rgba(255,215,36,0.22)');
        ctx.fillStyle = g;
        ctx.fillRect(nx - 40 * dpr, 0, 40 * dpr, h);
        ctx.fillStyle = '#FFD724';
        ctx.shadowColor = '#FFD724';
        ctx.shadowBlur = 12 * dpr;
        ctx.fillRect(nx - 1.5 * dpr, 0, 3 * dpr, h);
        ctx.shadowBlur = 0;
      }

      // Probe.
      if (s.mode === 'probe') {
        let d = s.probe.lon - f.lon;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        const px = w / 2 + d * k;
        const py = h / 2 - (s.probe.lat - f.lat) * k;
        ctx.strokeStyle = '#FFD724';
        ctx.lineWidth = 2.5 * dpr;
        ctx.beginPath();
        ctx.arc(px, py, 14 * dpr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#FFD724';
        ctx.beginPath();
        ctx.arc(px, py, 3 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const moving = stepCamera((now - last) / 1000);
      last = now;
      const s = getState();
      // playing videos change every frame
      const videoOn = visible(s).some((id) => {
        const el = layers.get(id)?.el;
        return el instanceof HTMLVideoElement && !el.paused;
      });
      if (moving || videoOn) dirty = true;
      if (!dirty) return;
      dirty = false;
      draw();
    };
    raf = requestAnimationFrame(frame);
    const tick = window.setInterval(() => (dirty = true), 500);

    // Drag to pan; wheel, pinch or double-click to zoom; in Probe mode the pointer is the probe.
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
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Map showing ${shown.map((id) => RECORD_BY_ID[id].eicTitle).join(' and ') || 'NASA Blue Marble'}. ${label} ${region}. Drag or Shift and the arrow keys to move, scroll or plus and minus to zoom.`}
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
