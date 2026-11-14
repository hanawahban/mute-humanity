// Side B: the shared flat map. Same latitude/longitude layout as the data (equirectangular),
// so every grid cell lines up without reprojection.

import { useEffect, useRef } from 'react';
import { geoEquirectangular, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import land110 from 'world-atlas/land-110m.json';
import { RECORDS } from '../config/records';
import { nameRegion } from '../config/places';
import { gridAt, listenRadius, NO_DATA } from '../data/sample';
import { panBy, zoomBy } from '../state/actions';
import { getState, useStore } from '../state/store';

const topo = land110 as unknown as Topology<{ land: GeometryCollection }>;
const land = feature(topo, topo.objects.land);

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function MapView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const focus = useStore((s) => s.focus);
  const region = nameRegion(focus.lat, focus.lon, focus.zoom);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    const layerCanvas = document.createElement('canvas');
    const layerCtx = layerCanvas.getContext('2d')!;
    const buffers = new Map<string, Uint8Array>();
    let dirty = true;
    let raf = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(wrap.clientWidth * dpr);
      canvas.height = Math.round(wrap.clientHeight * dpr);
      dirty = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();
    const unsub = useStore.subscribe(() => {
      dirty = true;
    });

    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!dirty) return;
      dirty = false;
      const s = getState();
      const { data, focus: f, year, month, humanity, playing, sideA } = s;
      const w = canvas.width;
      const h = canvas.height;
      const k = (w / 360) * f.zoom; // pixels per degree
      const dpr = window.devicePixelRatio || 1;

      ctx.fillStyle = s.settings.highContrast ? '#000' : '#0b1622';
      ctx.fillRect(0, 0, w, h);

      const projection = geoEquirectangular()
        .rotate([-f.lon, 0])
        .center([0, f.lat])
        .scale((k * 180) / Math.PI)
        .translate([w / 2, h / 2]);
      const path = geoPath(projection, ctx);
      ctx.beginPath();
      path(land);
      ctx.fillStyle = s.settings.highContrast ? '#333' : '#1c2633';
      ctx.fill();
      ctx.lineWidth = 1 * dpr;
      ctx.strokeStyle = s.settings.highContrast ? '#fff' : '#3a4a5c';
      ctx.stroke();

      if (data) {
        const { rows, cols } = data.index.grid;
        layerCanvas.width = cols;
        layerCanvas.height = rows;
        // Map x for longitude -180, wrapped so the image can be drawn twice across the seam.
        let x0 = w / 2 + (-180 - f.lon) * k;
        while (x0 > 0) x0 -= 360 * k;
        const y0 = h / 2 - (90 - f.lat) * k;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        for (const rec of RECORDS) {
          if (!playing[rec.id] || sideA === rec.id) continue;
          let buf = buffers.get(rec.layer);
          if (!buf) buffers.set(rec.layer, (buf = new Uint8Array(data.cells)));
          const grid = gridAt(data, rec.layer, year, month, buf);
          if (!grid) continue;
          const img = layerCtx.createImageData(cols, rows);
          const [r, g, b] = hexToRgb(rec.colour);
          const scale = rec.side === 'human' ? humanity : 1;
          for (let i = 0; i < grid.length; i++) {
            const v = grid[i];
            if (v === NO_DATA) continue;
            img.data[i * 4] = r;
            img.data[i * 4 + 1] = g;
            img.data[i * 4 + 2] = b;
            img.data[i * 4 + 3] = Math.round(Math.pow(v / 254, 0.8) * 220 * scale);
          }
          layerCtx.putImageData(img, 0, 0);
          ctx.globalCompositeOperation = rec.side === 'human' ? 'source-over' : 'screen';
          for (let x = x0; x < w; x += 360 * k) ctx.drawImage(layerCanvas, x, y0, 360 * k, 180 * k);
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      // Listening area
      const radius = listenRadius(f.zoom);
      if (radius < 180) {
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, radius * k, 0, Math.PI * 2);
        ctx.setLineDash([6 * dpr, 6 * dpr]);
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = '#fff';
      ctx.fillRect(w / 2 - 1 * dpr, h / 2 - 8 * dpr, 2 * dpr, 16 * dpr);
      ctx.fillRect(w / 2 - 8 * dpr, h / 2 - 1 * dpr, 16 * dpr, 2 * dpr);
    };
    raf = requestAnimationFrame(draw);

    // Drag to pan, wheel or pinch to zoom.
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const k = (wrap.clientWidth / 360) * getState().focus.zoom;
      panBy((e.clientY - lastY) / k, -(e.clientX - lastX) / k);
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = () => {
      dragging = false;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * 0.002));
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      unsub();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  return (
    <div className="map" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Map of the playing records. Listening to ${region}. Drag or use Shift and the arrow keys to move, plus and minus to zoom.`}
      />
      <div className="map-region" aria-hidden="true">
        Listening to <strong>{region}</strong>
      </div>
    </div>
  );
}
