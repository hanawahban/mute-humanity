// The jukebox: record buttons, the humanity lever and the timeline.
// Built from real buttons and range inputs, so keyboard and screen readers work by default.
// Multimedia's jukebox artwork replaces the styling, not the controls.

import { useMemo, type CSSProperties } from 'react';
import { RECORDS, YEAR_MAX, YEAR_MIN } from '../config/records';
import { flipRecord, muteHumanity, setAutoplay, setHumanity, setYear, toggleRecord, unmuteHumanity } from '../state/actions';
import { useStore } from '../state/store';
import { hasYear } from '../data/sample';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function useWarmingStripes(): string | undefined {
  const data = useStore((s) => s.data);
  return useMemo(() => {
    const layer = data?.layers.get('temperature');
    if (!data || !layer) return undefined;
    const cells = data.cells;
    const means = layer.meta.years.map((_, t) => {
      let sum = 0;
      let n = 0;
      for (let i = t * cells; i < (t + 1) * cells; i++) {
        if (layer.yearly[i] === 255) continue;
        sum += layer.yearly[i];
        n++;
      }
      return n ? sum / n / 254 : 0.5;
    });
    const lo = Math.min(...means);
    const hi = Math.max(...means);
    const stops = means.map((m, i) => {
      const t = (m - lo) / (hi - lo || 1);
      const colour = t < 0.5 ? `rgb(${Math.round(60 + t * 2 * 190)}, ${Math.round(110 + t * 2 * 140)}, 230)` : `rgb(250, ${Math.round(250 - (t - 0.5) * 2 * 200)}, ${Math.round(230 - (t - 0.5) * 2 * 200)})`;
      const pos = ((layer.meta.years[i] - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100;
      return `${colour} ${pos.toFixed(1)}%`;
    });
    return `linear-gradient(to right, ${stops.join(', ')})`;
  }, [data]);
}

export function Jukebox() {
  const data = useStore((s) => s.data);
  const playing = useStore((s) => s.playing);
  const sideA = useStore((s) => s.sideA);
  const selected = useStore((s) => s.selected);
  const mix = useStore((s) => s.mix);
  const year = useStore((s) => s.year);
  const month = useStore((s) => s.month);
  const humanity = useStore((s) => s.humanity);
  const autoplay = useStore((s) => s.autoplay);
  const stripes = useWarmingStripes();
  const shownYear = Math.round(year);
  const yearText = month != null ? `${MONTHS[month]} ${Math.floor(year)}` : `${shownYear}`;

  return (
    <section className="jukebox" aria-label="Jukebox">
      <h2 className="visually-hidden">Records</h2>
      <div className="records">
        {RECORDS.map((rec, i) => {
          const layer = data?.layers.get(rec.layer);
          const available = layer ? hasYear(layer, year) : false;
          const startYear = layer?.meta.years[0];
          const level = mix[rec.id]?.value ?? 0;
          const isOn = playing[rec.id];
          const status = !available && sideA !== rec.id ? `data starts ${startYear ?? 'later'}` : isOn ? 'playing' : 'stopped';
          return (
            <div key={rec.id} className={`record ${rec.side} ${isOn ? 'on' : ''} ${selected === rec.id ? 'selected' : ''} ${available ? '' : 'dark'}`} style={{ '--rec': rec.colour } as CSSProperties}>
              <button
                type="button"
                className="record-play"
                aria-pressed={isOn}
                aria-label={`${rec.name}, ${rec.side === 'earth' ? 'Earth' : 'humanity'} record, ${status}. Key ${i + 1}.`}
                onClick={() => void toggleRecord(rec.id)}
              >
                <span className="record-name">{rec.name}</span>
                <span className="record-meta">{rec.side === 'earth' ? 'Earth' : 'Humanity'} · {status}</span>
                <span className="meter" aria-hidden="true">
                  <span style={{ width: `${Math.round(level * 100)}%` }} />
                </span>
              </button>
              <button
                type="button"
                className="record-flip"
                aria-label={`Flip ${rec.name} to side ${sideA === rec.id ? 'B, NASA data on the map' : `A, the EIC visualization ${rec.eic.title}`}`}
                onClick={() => void flipRecord(rec.id)}
              >
                Side {sideA === rec.id ? 'A' : 'B'}
              </button>
            </div>
          );
        })}
      </div>

      <div className="lever">
        <label htmlFor="humanity">Humanity</label>
        <input
          id="humanity"
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(humanity * 100)}
          aria-valuetext={`${Math.round(humanity * 100)} percent`}
          onChange={(e) => setHumanity(Number(e.target.value) / 100, true)}
        />
        <button type="button" className="mute" aria-pressed={humanity === 0} onClick={() => (humanity === 0 ? unmuteHumanity() : muteHumanity())}>
          {humanity === 0 ? 'Bring humanity back' : 'Mute humanity'}
        </button>
      </div>

      <div className="timeline">
        <div className="year" aria-hidden="true">{yearText}</div>
        <label htmlFor="year" className="visually-hidden">Year</label>
        <input
          id="year"
          type="range"
          min={YEAR_MIN}
          max={YEAR_MAX}
          step="any"
          value={year}
          style={stripes ? { background: stripes } : undefined}
          aria-valuetext={`Year ${yearText}`}
          onChange={(e) => setYear(Number(e.target.value), { dragging: true })}
          onPointerUp={(e) => setYear(Math.round(Number((e.target as HTMLInputElement).value)), { quiet: true })}
          onKeyUp={(e) => setYear(Math.round(Number((e.target as HTMLInputElement).value)), { quiet: true })}
        />
        <div className="eras" aria-hidden="true">
          <span>1950 before satellites</span>
          <span style={{ left: `${((1979 - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100}%` }}>1979 satellites</span>
          <span style={{ left: `${((2000 - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100}%` }}>2000 full orchestra</span>
        </div>
        <button type="button" onClick={() => setAutoplay(!autoplay)} aria-pressed={autoplay}>
          {autoplay ? 'Pause timeline' : 'Play 75 years'}
        </button>
      </div>
    </section>
  );
}
