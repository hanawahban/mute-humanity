// The shared map: NASA Blue Marble underneath, then every playing EIC visualization stacked on
// top (WebGL, see map/gl.ts: each layer's background is made transparent so they all fit).
// A 2D canvas on top draws borders, the scan needle, the probe and a flash for every note.

import { useEffect, useRef } from 'react';
import { feature, mesh } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { GeoJsonObject } from 'geojson';
import { geoEquirectangular, geoPath } from 'd3-geo';
import { nameRegion } from '../config/places';
import { RECORD_BY_ID, type RecordId } from '../config/records';
import { layers } from '../eic/layers';
import { panBy, probeAt, resetView, setProbe, zoomBy } from '../state/actions';
import { audible, getState, useStore, type AppState } from '../state/store';
import { baseScale, latLonToScreen, screenToLatLon, setViewport, stepCamera, viewBounds } from '../map/camera';
import { getDetail, onDetailChange, updateDetail } from '../map/detail';
import { MapRenderer, type GlLayer } from '../map/gl';
import { audioNow, hits, scanNeedle } from '../audio/conductor';
import { asset } from '../config/asset';

const degrees = geoEquirectangular().scale(180 / Math.PI).translate([0, 0]).precision(0.05);
// Outlines in two levels of detail: the light 1:110m set when zoomed out, 1:50m when zoomed in.
type Outlines = { borders: Path2D; coast: Path2D };
const outlines: { low: Outlines | null; high: Outlines | null; fine: Outlines | null } = { low: null, high: null, fine: null };
let fineLoading = false;
/** The 1:10m set (about 6 MB) only loads the first time someone zooms in close. */
function loadFineOutlines(onDone: () => void) {
  if (fineLoading) return;
  fineLoading = true;
  void Promise.all([import('world-atlas/countries-10m.json'), import('world-atlas/land-10m.json')]).then(([c, l]) => {
    outlines.fine = buildOutlines(c.default ?? c, l.default ?? l);
    onDone();
  });
}
/** Zoom level from which the finest coastline is used. */
const FINE_ZOOM = 9;
function buildOutlines(c: unknown, l: unknown): Outlines {
  const ct = c as Topology<{ countries: GeometryCollection }>;
  const lt = l as Topology<{ land: GeometryCollection }>;
  const draw = (g: unknown) => {
    const p = new Path2D();
    geoPath(degrees, p as unknown as CanvasRenderingContext2D)(g as never);
    return p;
  };
  return {
    borders: draw(mesh(ct, ct.objects.countries, (a, b) => a !== b) as unknown as GeoJsonObject),
    coast: draw(feature(lt, lt.objects.land) as unknown as GeoJsonObject),
  };
}
function loadOutlines(onDone: () => void) {
  void Promise.all([import('world-atlas/countries-110m.json'), import('world-atlas/land-110m.json')]).then(([c, l]) => {
    outlines.low = buildOutlines(c.default ?? c, l.default ?? l);
    onDone();
  });
  void Promise.all([import('world-atlas/countries-50m.json'), import('world-atlas/land-50m.json')]).then(([c, l]) => {
    outlines.high = buildOutlines(c.default ?? c, l.default ?? l);
    onDone();
  });
}

/**
 * Draw order. Smog (NOx) goes low, straight after temperature, so the red CO₂ glow and the city
 * lights stay visible through it; lightning flashes on top of everything.
 */
const ORDER: RecordId[] = ['temperature', 'nox', 'rain', 'lights', 'co2', 'lightning'];

/** Changes that need the map layers redrawn (the mix changes 10 times a second and must not). */
const pickMap = (s: AppState) => [s.focus, s.playing, s.solo, s.humanity, s.sources, s.settings.highContrast];
/** Changes that need the outlines redrawn. */
const pickOutline = (s: AppState) => [s.focus, s.settings.highContrast];
/**
 * Resolution caps. The data is blurry at this zoom anyway, and a laptop has to push every
 * pixel of several full-screen layers 60 times a second.
 */
const glDpr = () => Math.min(1.25, window.devicePixelRatio || 1);
const lineDpr = () => Math.min(1.5, window.devicePixelRatio || 1);

export function MapView() {
  const glRef = useRef<HTMLCanvasElement>(null);
  const outlineRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Only the place name re-renders this component, not every frame of a camera move.
  const mode = useStore((s) => s.mode);
  const region = useStore((s) => (s.mode === 'probe' ? nameRegion(s.probe.lat, s.probe.lon, 4) : nameRegion(s.focus.lat, s.focus.lon, s.focus.zoom)));
  const playing = useStore((s) => s.playing);
  const solo = useStore((s) => s.solo);
  const shown = audible({ ...getState(), playing, solo });

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
    let dimNow = 0.9;
    let dimTarget = 0.9;
    let outlineDirty = true;
    let raf = 0;
    let last = performance.now();
    const videoTimes = new Map<HTMLVideoElement, number>();

    const base = new Image();
    base.src = asset('/basemap/blue-marble.jpg');
    base.onload = () => {
      renderer?.setBase(base);
      mapDirty = true;
    };
    loadOutlines(() => (outlineDirty = true));

    const resize = () => {
      const dpr = lineDpr();
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
    let lastFocus = getState().focus;
    let focusAt = 0; // when the map last moved (drags move it directly, outside the camera easing)
    const unsub = useStore.subscribe((s) => {
      if (s.focus !== lastFocus) {
        lastFocus = s.focus;
        focusAt = performance.now();
      }
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
      // City lights are seen at night: when they play the base map darkens, fully when alone
      const night = on.includes('lights') && s.humanity > 0.05;
      dimTarget = s.settings.highContrast ? 0.45 : night ? (on.length === 1 ? 0.14 : 0.38) : on.length ? 0.72 : 0.9;
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
          alpha: rec.side === 'human' ? 0.15 + 0.85 * s.humanity : id === 'temperature' && on.length > 1 ? 0.55 : 1, // temperature steps back under the others
          boost: id === 'lights' ? (night ? 1.9 : 1.5) : rec.boost ?? 1,
          floor: layer.placeholder || rec.decode.kind !== 'bright' ? 0.1 : Math.max(0.1, rec.decode.floor - (id === 'lights' ? 0.16 : 0.1)),
          grow: id === 'lightning' ? 1.5 : 0,
        });
      }
      renderer?.draw({ lon: f.lon, lat: f.lat, k }, dimNow, list);
    };

    /**
     * Coastlines and borders, with a dark halo so they show over any layer. Stroking the
     * whole world's coastline is the most expensive drawing we do, so while the map moves the
     * last drawing is just slid and scaled (a CSS transform, free on the GPU) and redrawn
     * properly only a few times a second and when the map stops.
     */
    let drawn = { ...getState().focus };
    let drawnAt = 0;
    const drawOutline = () => {
      const s = getState();
      const f = s.focus;
      const hc = s.settings.highContrast;
      const dpr = lineDpr();
      const w = outline.width;
      const h = outline.height;
      const k = baseScale() * f.zoom * dpr;
      if (f.zoom >= FINE_ZOOM && !outlines.fine) loadFineOutlines(() => (outlineDirty = true));
      const set = (f.zoom >= FINE_ZOOM && outlines.fine) || (f.zoom < 2.2 ? outlines.low : outlines.high) || outlines.low || outlines.high;
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, w, h);
      outline.style.transform = '';
      drawn = { ...f };
      drawnAt = performance.now();
      if (!set) return;
      const cy = h / 2 + f.lat * k;
      let x0 = w / 2 + (-180 - f.lon) * k;
      while (x0 > 0) x0 -= 360 * k;
      while (x0 + 360 * k < 0) x0 += 360 * k;
      octx.lineJoin = 'round';
      for (let x = x0; x < w; x += 360 * k) {
        octx.setTransform(k, 0, 0, k, x + 180 * k, cy);
        octx.lineWidth = (3 * dpr) / k;
        octx.strokeStyle = 'rgba(0,0,0,0.55)';
        octx.stroke(set.coast);
        octx.lineWidth = ((hc ? 1.8 : 1.2) * dpr) / k;
        octx.strokeStyle = hc ? '#ffffff' : 'rgba(255,240,209,0.85)';
        octx.stroke(set.coast);
        octx.lineWidth = ((hc ? 1 : 0.7) * dpr) / k;
        octx.strokeStyle = hc ? 'rgba(255,255,255,0.7)' : 'rgba(255,240,209,0.35)';
        octx.stroke(set.borders);
      }
      octx.setTransform(1, 0, 0, 1, 0, 0);
    };
    /** Slide and scale the last outline drawing to where the map is now. */
    const shiftOutline = () => {
      const f = getState().focus;
      const W = wrap.clientWidth;
      const H = wrap.clientHeight;
      const k0 = baseScale() * drawn.zoom;
      let dl = f.lon - drawn.lon;
      if (dl > 180) dl -= 360;
      if (dl < -180) dl += 360;
      const px = W / 2 + dl * k0;
      const py = H / 2 - (f.lat - drawn.lat) * k0;
      const sc = f.zoom / drawn.zoom;
      outline.style.transformOrigin = '0 0';
      outline.style.transform = `translate(${W / 2 - sc * px}px, ${H / 2 - sc * py}px) scale(${sc})`;
    };

    /** Needle, note flashes and the probe: small, redrawn every frame only in Scan and Probe. */
    let overlayHadContent = false;
    const drawOverlay = () => {
      const s = getState();
      const dpr = lineDpr();
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      overlayHadContent = false;
      const needle = scanNeedle();
      if (needle != null) {
        overlayHadContent = true;
        const nx = needle * w;
        const g = ctx.createLinearGradient(nx - 70 * dpr, 0, nx, 0);
        g.addColorStop(0, 'rgba(255,215,36,0)');
        g.addColorStop(1, 'rgba(255,215,36,0.25)');
        ctx.fillStyle = g;
        ctx.fillRect(nx - 70 * dpr, 0, 70 * dpr, h);
        // a soft glow without shadowBlur, which is slow to draw every frame
        ctx.fillStyle = 'rgba(255,215,36,0.35)';
        ctx.fillRect(nx - 4 * dpr, 0, 8 * dpr, h);
        ctx.fillStyle = '#FFD724';
        ctx.fillRect(nx - 1.5 * dpr, 0, 3 * dpr, h);
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
        ctx.strokeStyle = hit.color;
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

    let settleFrames = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const moving = stepCamera((now - last) / 1000);
      last = now;
      const s = getState();
      if (moving) mapDirty = true;
      // a video only needs a redraw when it has moved (playing, or a jump like Then / Now). After a
      // jump the new frame can arrive a moment later, so keep redrawing for a few frames
      for (const id of audible(s)) {
        const el = layers.get(id)?.el;
        if (el instanceof HTMLVideoElement && videoTimes.get(el) !== el.currentTime) {
          videoTimes.set(el, el.currentTime);
          mapDirty = true;
          settleFrames = 12;
        }
      }
      if (settleFrames > 0) {
        settleFrames--;
        mapDirty = true;
      }
      const motion = moving || now - focusAt < 120;
      // sharper NASA tiles for where the map is now, once it settles
      if (!motion && now - detailAt > 250) {
        detailAt = now;
        const b = viewBounds();
        updateDetail({ west: b.west, east: b.west + b.lonSpan, south: b.south, north: b.north }, 1 / (baseScale() * s.focus.zoom * glDpr()));
      }
      // ease the base map darker or lighter (it goes dark like night when city lights play)
      if (Math.abs(dimNow - dimTarget) > 0.004) {
        dimNow += (dimTarget - dimNow) * Math.min(1, ((now - last2) / 1000) * 3);
        mapDirty = true;
      }
      last2 = now;
      if (mapDirty) {
        mapDirty = false;
        drawMap();
      }
      if (outlineDirty) {
        outlineDirty = false;
        // while moving: slide the old drawing, and redraw for real at most ~6 times a second
        if (motion && now - drawnAt < 160) shiftOutline();
        else drawOutline();
      } else if (!motion && outline.style.transform) drawOutline();
      if (s.mode !== 'listen' || overlayHadContent) drawOverlay();
    };
    let detailAt = 0;
    let last2 = performance.now();
    onDetailChange(() => {
      renderer?.setDetail(getDetail());
      mapDirty = true;
    });
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
      if (moved >= 4) return;
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
      <p className="attribution">Visualizations: NASA Earth Information Center / Scientific Visualization Studio · Base map: NASA Blue Marble (zoomed in: NASA GIBS) · Narrator voice: AI-generated (Kokoro)</p>
    </div>
  );
}
