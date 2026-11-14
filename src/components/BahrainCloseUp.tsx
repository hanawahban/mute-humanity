// The Bahrain close-up. A panel over the map with a detailed coastline (Natural Earth 1:10m)
// and the six NASA records drawn on top at their real resolution. While it is open, the sound
// listens only to this corner of the Gulf.
//
// Honest by design: NASA's EIC maps are 2048 pixels wide, about 19 km per pixel, so Bahrain is
// only a handful of pixels. The faint grid shows exactly where each NASA pixel is.

import { useEffect, useRef, useState } from 'react';
import { RECORDS, RECORD_BY_ID, type RecordId } from '../config/records';
import { regionValues } from '../eic/layers';
import { BAHRAIN_REGION, closeCloseUp, describeValue, probeAt } from '../state/actions';
import { audible, getState, useStore } from '../state/store';
import { audioNow, hits, scanNeedle } from '../audio/conductor';

const R = BAHRAIN_REGION;
const ASPECT = ((R.east - R.west) * Math.cos((26 * Math.PI) / 180)) / (R.north - R.south);

type Ring = Array<[number, number]>;
let gulf: Array<{ name: string; rings: Ring[] }> | null = null;
let gulfLoading: Promise<void> | null = null;
function loadGulf() {
  gulfLoading ??= fetch('/geo/gulf-10m.json')
    .then((r) => r.json())
    .then((fc: { features: Array<{ properties: { name: string }; geometry: { type: string; coordinates: unknown } }> }) => {
      gulf = fc.features.map((f) => {
        const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as Ring[][];
        return { name: f.properties.name, rings: polys.flat() };
      });
    })
    .catch(() => undefined);
  return gulfLoading;
}

const LABELS = [
  { text: 'BAHRAIN', lat: 26.02, lon: 50.55, big: true },
  { text: 'Manama', lat: 26.225, lon: 50.585, dot: true },
  { text: 'QATAR', lat: 25.45, lon: 51.2, big: true },
  { text: 'SAUDI ARABIA', lat: 25.45, lon: 49.95, big: true },
  { text: 'Persian Gulf', lat: 26.7, lon: 51.0 },
];

/** Colour for a value 0-1 from the record's own colour scale. */
function parseColour(c: string): [number, number, number, number] {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b, a = '1'] = m[1].split(',').map((x) => x.trim());
    return [Number(r), Number(g), Number(b), Number(a)];
  }
  const h = c.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
}
const RAMPS = new Map<RecordId, Array<[number, number, number, number]>>(RECORDS.map((r) => [r.id, r.scale.colours.map(parseColour)]));
function colourAt(id: RecordId, v: number) {
  const stops = RAMPS.get(id)!;
  const t = Math.max(0, Math.min(1, v)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  const f = t - i;
  return stops[i].map((x, k) => x + (stops[i + 1][k] - x) * f) as [number, number, number, number];
}

interface Reading {
  id: RecordId;
  value: number | null;
}

export function BahrainCloseUp() {
  const open = useStore((s) => s.closeUp);
  const playing = useStore((s) => s.playing);
  const solo = useStore((s) => s.solo);
  const humanity = useStore((s) => s.humanity);
  const base = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [pixelKm, setPixelKm] = useState(19);

  useEffect(() => {
    if (!open) return;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeCloseUp();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  // The data layer: redrawn twice a second, because the videos keep moving.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const small = document.createElement('canvas');
    const cache = new Map<RecordId, NonNullable<ReturnType<typeof regionValues>>>();
    const readAt = new Map<RecordId, number>();
    const sctx = small.getContext('2d')!;
    const draw = async () => {
      await loadGulf();
      const c = base.current;
      if (!alive || !c) return;
      const W = c.clientWidth;
      const H = c.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (c.width !== Math.round(W * dpr)) c.width = Math.round(W * dpr);
      if (c.height !== Math.round(H * dpr)) c.height = Math.round(H * dpr);
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const X = (lon: number) => ((lon - R.west) / (R.east - R.west)) * W;
      const Y = (lat: number) => ((R.north - lat) / (R.north - R.south)) * H;
      const landPath = new Path2D();
      for (const f of gulf ?? []) for (const ring of f.rings) {
        ring.forEach(([lon, lat], i) => (i ? landPath.lineTo(X(lon), Y(lat)) : landPath.moveTo(X(lon), Y(lat))));
        landPath.closePath();
      }
      ctx.fillStyle = '#16354d';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#5b5446';
      ctx.fill(landPath, 'evenodd');

      const st = getState();
      const ids = audible(st);
      const due = ids
        .filter((id) => RECORD_BY_ID[id].kind === 'movie' || !cache.has(id))
        .sort((a, b) => (readAt.get(a) ?? 0) - (readAt.get(b) ?? 0))[0];
      const out: Reading[] = [];
      let pixelDeg = 0.176;
      for (const id of ids) {
        const rec = RECORD_BY_ID[id];
        // Reading pixels back from a video is slow, so only one record is re-read per redraw
        // (the one read longest ago); stills are read once. Keeps the map and audio smooth.
        let rv = cache.get(id);
        if (!rv || (id === due && rec.kind === 'movie')) {
          rv = regionValues(id, R) ?? undefined;
          if (rv) cache.set(id, rv);
          readAt.set(id, performance.now());
        }
        if (!rv) continue;
        pixelDeg = rv.pixelDeg;
        small.width = rv.w;
        small.height = rv.h;
        const img = sctx.createImageData(rv.w, rv.h);
        let sum = 0;
        let n = 0;
        for (let i = 0; i < rv.w * rv.h; i++) {
          const v = rv.values[i];
          if (Number.isNaN(v)) continue;
          sum += v;
          n++;
          const [r, g, b, a] = colourAt(id, v);
          // sparse records fade to nothing where there is nothing, so the land and sea show through
          // capped, so six layers stacked still let the land and sea show through
          const strength = rec.empty === 'nodata' ? 0.55 : Math.max(0, Math.min(0.6, (v - 0.05) * 1.4));
          img.data.set([r, g, b, Math.round(255 * a * strength * (rec.side === 'human' ? Math.max(0.25, st.humanity) : 1))], i * 4);
        }
        sctx.putImageData(img, 0, 0);
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        // the ocean record only exists over water: keep it off the land
        if (rec.empty === 'nodata') {
          const sea = new Path2D();
          sea.rect(0, 0, W, H);
          sea.addPath(landPath);
          ctx.clip(sea, 'evenodd');
        }
        ctx.globalAlpha = 0.85;
        ctx.drawImage(small, 0, 0, W, H);
        ctx.restore();
        out.push({ id, value: n ? sum / n : null });
      }

      // a light land tint on top keeps land and sea apart however many records are on
      ctx.fillStyle = 'rgba(150,135,105,0.18)';
      ctx.fill(landPath, 'evenodd');

      // the NASA pixel grid: what the data can actually see
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const start = Math.ceil((R.west + 180) / pixelDeg) * pixelDeg - 180;
      for (let lon = start; lon < R.east; lon += pixelDeg) {
        ctx.moveTo(X(lon), 0);
        ctx.lineTo(X(lon), H);
      }
      const startLat = Math.ceil((R.south + 90) / pixelDeg) * pixelDeg - 90;
      for (let lat = startLat; lat < R.north; lat += pixelDeg) {
        ctx.moveTo(0, Y(lat));
        ctx.lineTo(W, Y(lat));
      }
      ctx.stroke();

      // detailed coastline on top
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 3.5;
      ctx.stroke(landPath);
      ctx.strokeStyle = '#ffd8a8';
      ctx.lineWidth = 1.4;
      ctx.stroke(landPath);

      for (const l of LABELS) {
        ctx.font = l.big ? '600 15px system-ui, sans-serif' : 'italic 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.fillStyle = l.big ? '#fff' : '#cfe3f2';
        const x = X(l.lon);
        const y = Y(l.lat);
        if (l.dot) {
          ctx.beginPath();
          ctx.arc(x, y, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = '#ffd166';
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'left';
          ctx.strokeText(l.text, x + 7, y + 4);
          ctx.fillText(l.text, x + 7, y + 4);
        } else {
          ctx.strokeText(l.text, x, y);
          ctx.fillText(l.text, x, y);
        }
      }
      setReadings(out);
      setPixelKm(Math.round(pixelDeg * 111 * Math.cos((26 * Math.PI) / 180)));
    };
    void draw();
    const t = window.setInterval(() => void draw(), 400);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [open, playing, solo, humanity]);

  // The scan needle, note flashes and probe, every animation frame.
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const c = over.current;
      if (!c) return;
      const W = c.clientWidth;
      const H = c.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (c.width !== Math.round(W * dpr)) c.width = Math.round(W * dpr);
      if (c.height !== Math.round(H * dpr)) c.height = Math.round(H * dpr);
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const s = getState();
      const x = scanNeedle();
      if (x != null) {
        const g = ctx.createLinearGradient(x * W - 40, 0, x * W, 0);
        g.addColorStop(0, 'rgba(255,209,102,0)');
        g.addColorStop(1, 'rgba(255,209,102,0.25)');
        ctx.fillStyle = g;
        ctx.fillRect(x * W - 40, 0, 40, H);
        ctx.fillStyle = '#ffd166';
        ctx.fillRect(x * W - 1, 0, 2, H);
      }
      const now = audioNow();
      for (const h of hits) {
        const age = now - h.at;
        if (age < 0 || age > 1.2) continue;
        ctx.beginPath();
        ctx.arc(h.x * W, h.y * H, 8 + age * 30, 0, Math.PI * 2);
        ctx.strokeStyle = h.colour;
        ctx.globalAlpha = (1 - age / 1.2) * (0.4 + 0.6 * h.v);
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (s.mode === 'probe') {
        const px = ((s.probe.lon - R.west) / (R.east - R.west)) * W;
        const py = ((R.north - s.probe.lat) / (R.north - R.south)) * H;
        if (px >= 0 && px <= W && py >= 0 && py <= H) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px, py, 12, 0, Math.PI * 2);
          ctx.moveTo(px - 18, py);
          ctx.lineTo(px + 18, py);
          ctx.moveTo(px, py - 18);
          ctx.lineTo(px, py + 18);
          ctx.stroke();
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  if (!open) return null;

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const lon = R.west + ((e.clientX - r.left) / r.width) * (R.east - R.west);
    const lat = R.north - ((e.clientY - r.top) / r.height) * (R.north - R.south);
    probeAt(lat, lon, true);
  };

  const anyLayer = readings.length > 0;
  return (
    <div className="closeup-backdrop" onClick={(e) => e.target === e.currentTarget && closeCloseUp()}>
      <section className="closeup" role="dialog" aria-modal="false" aria-labelledby="closeup-h">
        <header className="closeup-head">
          <div>
            <h2 id="closeup-h">Bahrain, up close</h2>
            <p>The sound now comes only from this corner of the Gulf.</p>
          </div>
          <button ref={closeBtn} type="button" className="closeup-close" onClick={closeCloseUp} aria-label="Close the Bahrain close-up (Escape)">
            ✕
          </button>
        </header>
        <div className="closeup-body">
          <div className="closeup-map" style={{ aspectRatio: String(ASPECT) }}>
            <canvas ref={base} aria-hidden="true" />
            <canvas
              ref={over}
              className="closeup-over"
              role="img"
              aria-label="Detailed map of Bahrain, Qatar and the Saudi coast with the playing NASA records on top. Click to hear one spot."
              onClick={onClick}
            />
          </div>
          <aside className="closeup-side">
            <h3>Here, right now</h3>
            {anyLayer ? (
              <ul className="closeup-readings">
                {readings.map(({ id, value }) => {
                  const rec = RECORD_BY_ID[id];
                  return (
                    <li key={id}>
                      <span className="dot" style={{ background: rec.colour }} aria-hidden="true" />
                      <strong>{rec.short}</strong>
                      <span>{value == null ? 'no data here' : describeValue(id, value)}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="closeup-empty">Turn on a record to see and hear it here.</p>
            )}
            <p className="closeup-note">
              <strong>How sharp is this?</strong> The coastline is detailed, but NASA's Earth Information Center maps see the world in
              squares about {pixelKm} km wide (the faint grid). Bahrain is only a handful of them, so the colours are NASA's real
              readings, smoothed between those squares, not street-level detail.
            </p>
            <p className="closeup-tip">Click the map to hear one spot. Press Escape to go back.</p>
          </aside>
        </div>
      </section>
    </div>
  );
}
