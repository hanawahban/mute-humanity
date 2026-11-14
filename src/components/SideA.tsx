// Side A: plays a record's EIC visualization and turns its frames into sound live.
// Each tick, the current video frame is drawn to a small hidden canvas and one column is
// read, sweeping left to right like the radar sweep in NASA's Caldwell 73 sonification.
// If public/eic/<record>/colorbar.json exists, colours are matched to the colour key to
// recover real values; otherwise brightness is used.
//
// Put the clips in public/eic/<record>/clip.mp4 (download from svs.gsfc.nasa.gov).
// They must be served by this app: browsers block reading pixels from other websites.

import { useEffect, useRef, useState } from 'react';
import { RECORD_BY_ID } from '../config/records';
import { getState, setState, useStore } from '../state/store';
import { flipRecord } from '../state/actions';

const SWEEP_SECONDS = 8;
const SAMPLE_W = 96;
const SAMPLE_H = 48;

type Stop = [r: number, g: number, b: number, value: number];

async function loadColorbar(id: string): Promise<Stop[] | null> {
  try {
    const res = await fetch(`/eic/${id}/colorbar.json`);
    if (!res.ok) return null;
    const json = (await res.json()) as { stops: Stop[] };
    return json.stops?.length ? json.stops : null;
  } catch {
    return null;
  }
}

function pixelValue(r: number, g: number, b: number, stops: Stop[] | null): number | null {
  if (!stops) {
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return lum < 0.04 ? null : lum; // treat near-black (empty background) as no data
  }
  let best = stops[0];
  let bestD = Infinity;
  for (const s of stops) {
    const d = (s[0] - r) ** 2 + (s[1] - g) ** 2 + (s[2] - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return bestD > 60 * 60 * 3 ? null : best[3]; // too far from every colour: not part of the data
}

export function SideA() {
  const sideA = useStore((s) => s.sideA);
  const reducedMotion = useStore((s) => s.settings.reducedMotion);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [missing, setMissing] = useState(false);
  const [sweep, setSweep] = useState(0);
  const rec = sideA ? RECORD_BY_ID[sideA] : null;

  useEffect(() => {
    setMissing(false);
    if (!sideA) return;
    const video = videoRef.current!;
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_W;
    canvas.height = SAMPLE_H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    let stops: Stop[] | null = null;
    let smoothed = 0;
    void loadColorbar(sideA).then((s) => (stops = s));
    const start = performance.now();

    const timer = window.setInterval(() => {
      if (video.readyState < 2) return;
      ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
      const pos = ((performance.now() - start) / 1000 / SWEEP_SECONDS) % 1;
      const x = Math.min(SAMPLE_W - 1, Math.floor(pos * SAMPLE_W));
      const px = ctx.getImageData(x, 0, 1, SAMPLE_H).data;
      let sum = 0;
      let n = 0;
      for (let y = 0; y < SAMPLE_H; y++) {
        const v = pixelValue(px[y * 4], px[y * 4 + 1], px[y * 4 + 2], stops);
        if (v == null) continue;
        sum += v;
        n++;
      }
      const v = n ? sum / n : 0;
      smoothed += (v - smoothed) * 0.3;
      setState({ sideAValue: { ...getState().sideAValue, [sideA]: smoothed } });
      setSweep(pos);
    }, 100);
    return () => window.clearInterval(timer);
  }, [sideA]);

  if (!rec) return null;

  return (
    <figure className="side-a" aria-label={`Side A: ${rec.name}`}>
      <div className="side-a-head">
        <span className="side-a-tag" style={{ background: rec.colour }}>Side A</span>
        <strong>{rec.name}</strong>
        <button type="button" className="side-a-back" onClick={() => void flipRecord(rec.id)}>
          Back to the map
        </button>
      </div>
      <div className="side-a-screen">
        <video
          key={rec.id}
          ref={videoRef}
          src={rec.eic.clip}
          muted
          loop
          autoPlay
          playsInline
          aria-hidden="true"
          onError={() => setMissing(true)}
        />
        {!reducedMotion && !missing && <div className="sweep" style={{ left: `${sweep * 100}%` }} aria-hidden="true" />}
        {missing && (
          <p className="side-a-missing">
            <span>The NASA visualization isn't added yet.</span>
            <span>
              Put SVS {rec.eic.svsId} at <code>public{rec.eic.clip}</code>
            </span>
          </p>
        )}
      </div>
      <figcaption>
        {rec.eic.title} (NASA SVS {rec.eic.svsId}), turned into sound frame by frame.
        {rec.eic.note && <span className="note"> {rec.eic.note}.</span>}
      </figcaption>
    </figure>
  );
}
