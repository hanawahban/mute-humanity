// "How it works": the sonification, step by step, for one record at a time.
// NASA map -> color -> number -> note -> instrument, with a slider you can drag along the
// record's color key to hear exactly which note each color becomes.

import { useEffect, useRef, useState } from 'react';
import { RECORDS, RECORD_BY_ID, INSTRUMENT_NAMES, EARTH_SCALE, HUMAN_SCALE, type RecordId } from '../config/records';
import { layers } from '../eic/layers';
import { notesFor, noteIndexFor, previewValue } from '../audio/conductor';
import { ensureAudio } from '../state/actions';
import { setState, useStore } from '../state/store';
import { Logo } from './Logo';

/** The record's own color, picked from its scale at a point 0-1 along it. */
function colorAt(colors: string[], v: number) {
  const parse = (c: string) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (m) return m[1].split(',').slice(0, 3).map((x) => Number(x));
    const h = c.replace('#', '');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  };
  const stops = colors.map(parse);
  const t = Math.max(0, Math.min(1, v)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  const f = t - i;
  const [r, g, b] = stops[i].map((x, k) => Math.round(x + (stops[i + 1][k] - x) * f));
  return `rgb(${r},${g},${b})`;
}

/** A small live copy of the record's NASA visualization. */
function Thumb({ id }: { id: RecordId }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const draw = () => {
      const c = ref.current;
      const el = layers.get(id)?.el;
      if (!c || !el) return;
      const ctx = c.getContext('2d')!;
      try {
        ctx.drawImage(el, 0, 0, c.width, c.height);
      } catch {
        /* not loaded yet */
      }
    };
    draw();
    const t = window.setInterval(draw, 500);
    return () => window.clearInterval(t);
  }, [id]);
  return <canvas ref={ref} width={320} height={160} className="how-thumb" aria-hidden="true" />;
}

export function HowItWorks() {
  const open = useStore((s) => s.howOpen);
  const ref = useRef<HTMLDialogElement>(null);
  const [id, setId] = useState<RecordId>('ocean');
  const [v, setV] = useState(0.7);
  const rec = RECORD_BY_ID[id];
  const notes = notesFor(id);
  const ni = noteIndexFor(id, v);
  const earth = rec.side === 'earth';

  useEffect(() => {
    const d = ref.current!;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const hear = async (value: number, record = id) => {
    await ensureAudio();
    previewValue(record, value);
  };
  const onSlide = (value: number) => {
    const before = noteIndexFor(id, v);
    setV(value);
    if (noteIndexFor(id, value) !== before) void hear(value);
  };

  return (
    <dialog ref={ref} className="help how" aria-labelledby="how-title" onClose={() => setState({ howOpen: false })}>
      <div className="help-head">
        <Logo className="help-logo" />
        <h2 id="how-title">How it works</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={() => setState({ howOpen: false })}>
          ×
        </button>
      </div>
      <p className="how-lede">
        We don't make up the music. Every note comes from a pixel of a NASA Earth Information Center map. Pick a record and drag along
        its color key to hear the exact note each color becomes.
      </p>

      <div className="how-picker" role="radiogroup" aria-label="Record">
        {RECORDS.map((r) => (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={r.id === id}
            className={r.id === id ? 'on' : ''}
            onClick={() => {
              setId(r.id);
              void hear(v, r.id);
            }}
          >
            <span className="dot" style={{ background: r.color }} aria-hidden="true" /> {r.short}
          </button>
        ))}
      </div>

      <ol className="how-flow">
        <li>
          <span className="how-num">1</span>
          <h3>The NASA map</h3>
          <Thumb id={id} />
          <p>
            {rec.eicTitle}, {rec.period}. NASA SVS {rec.svs}.
          </p>
        </li>
        <li>
          <span className="how-num">2</span>
          <h3>Color → number</h3>
          <div className={`how-key ${rec.scale.lightBar ? 'light' : ''}`}>
            <div className="how-bar" style={{ background: `linear-gradient(90deg, ${rec.scale.colors.join(', ')})` }} />
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={v}
              onChange={(e) => onSlide(Number(e.target.value))}
              aria-label={`Position along the ${rec.short} color key, from ${rec.scale.low} to ${rec.scale.high}`}
              aria-valuetext={`${Math.round(v * 100)} percent, note ${notes[ni]}`}
            />
            <div className="how-ends">
              <span>{rec.scale.low}</span>
              <span>{rec.scale.high}</span>
            </div>
          </div>
          <p>
            Each pixel's color is matched to the nearest color on NASA's key. This one is{' '}
            <span className="swatch" style={{ background: colorAt(rec.scale.colors, v) }} aria-hidden="true" /> <strong>{Math.round(v * 100)}%</strong> of the way
            up.
          </p>
        </li>
        <li>
          <span className="how-num">3</span>
          <h3>Number → note</h3>
          <div className="how-notes" aria-hidden="true">
            {notes.map((n, i) => (
              <span key={n + i} className={i === ni ? 'on' : ''}>
                {n}
              </span>
            ))}
          </div>
          <p>
            Higher numbers play higher notes. {earth ? 'Earth uses A major pentatonic' : "Humanity starts on Earth's notes, then bends them toward"} (
            {(earth ? EARTH_SCALE : HUMAN_SCALE).join(' ')}), so {earth ? 'every Earth sound agrees.' : 'the more we press, the more they disturb the harmony.'}
          </p>
        </li>
        <li>
          <span className="how-num">4</span>
          <h3>Note → instrument</h3>
          <p className="how-inst">{INSTRUMENT_NAMES[rec.instrument]}</p>
          <p>{rec.hear}</p>
          <p>{earth ? 'Played in a big hall, with a soft echo.' : 'Played dry, with a little grit.'}</p>
          <button type="button" className="how-play" onClick={() => void hear(v)}>
            ▶ Play {notes[ni]}
          </button>
        </li>
      </ol>

      <div className="help-grid how-more">
        <section>
          <h3>From the whole map to music</h3>
          <p>
            <strong>Listen</strong>: for each record, how much of the screen it covers and how strong it is set how loud it plays and how
            often; its strongest spot sets the pitch. Sounds on the left of the screen are in your left ear.
          </p>
          <p>
            <strong>Scan</strong>: a needle sweeps the view. Each point it crosses plays one note, timed to the moment it's crossed: higher on
            the map is a higher note, stronger is louder.
          </p>
          <p>
            <strong>Probe</strong>: only the spot you pick plays, on every beat.
          </p>
        </section>
        <section>
          <h3>Earth and humanity</h3>
          <p>
            The three Earth records share one key, so any mix of them sounds in tune. The three humanity records are synths that bend those
            notes off the key and drift out of tune as the lever goes up. Lighten our footprint and the Earth's harmony swells back.
          </p>
          <h3>Honest about the data</h3>
          <p>
            We read NASA's published visualizations, not raw science values. They are about 19 km per pixel, and each keeps its real dates,
            so layers line up in place, not in time. The zoomed-in base map is NASA Blue Marble from NASA GIBS.
          </p>
        </section>
      </div>
    </dialog>
  );
}
