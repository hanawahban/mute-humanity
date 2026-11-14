// The jukebox dock: six records, the humanity lever and the timeline.
// Built from real buttons and range inputs, so keyboard and screen readers work by default.

import { useMemo, type CSSProperties } from 'react';
import { RECORDS, YEAR_MAX, YEAR_MIN, type RecordDef } from '../config/records';
import { flipRecord, muteHumanity, setAutoplay, setHumanity, setYear, toggleRecord, unmuteHumanity } from '../state/actions';
import { useStore } from '../state/store';
import { hasYear } from '../data/sample';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pct = (y: number) => ((y - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100;

/** Warming stripes from the temperature prologue layer: the timeline's track. */
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
      const colour = t < 0.5
        ? `rgb(${Math.round(40 + t * 2 * 200)}, ${Math.round(90 + t * 2 * 150)}, ${Math.round(190 + t * 2 * 40)})`
        : `rgb(${Math.round(240 - (t - 0.5) * 2 * 60)}, ${Math.round(240 - (t - 0.5) * 2 * 210)}, ${Math.round(230 - (t - 0.5) * 2 * 200)})`;
      return `${colour} ${pct(layer.meta.years[i]).toFixed(1)}%`;
    });
    return `linear-gradient(to right, ${stops.join(', ')})`;
  }, [data]);
}

function Vinyl({ rec, index }: { rec: RecordDef; index: number }) {
  const data = useStore((s) => s.data);
  const isOn = useStore((s) => s.playing[rec.id]);
  const isA = useStore((s) => s.sideA === rec.id);
  const selected = useStore((s) => s.selected === rec.id);
  const level = useStore((s) => s.mix[rec.id]?.value ?? 0);
  const year = useStore((s) => s.year);
  const layer = data?.layers.get(rec.layer);
  const available = isA || (layer ? hasYear(layer, year) : false);
  const startYear = layer?.meta.years[0];
  const status = !available ? `no data yet, starts ${startYear ?? 'later'}` : isOn ? (isA ? 'playing side A' : 'playing') : 'stopped';

  return (
    <div
      className={`vinyl ${isOn ? 'on' : ''} ${selected ? 'selected' : ''} ${available ? '' : 'dark'}`}
      style={{ '--rec': rec.colour, '--level': `${Math.round(level * 100)}%` } as CSSProperties}
    >
      <button
        type="button"
        className="vinyl-disc"
        aria-pressed={isOn}
        aria-label={`${rec.name}, ${rec.side === 'earth' ? 'Earth' : 'humanity'} record, ${status}. Key ${index + 1}.`}
        onClick={() => void toggleRecord(rec.id)}
      >
        <span className="disc" aria-hidden="true">
          <span className="label">{index + 1}</span>
        </span>
      </button>
      <span className="vinyl-name" aria-hidden="true">{rec.name}</span>
      {!available ? (
        <span className="vinyl-note" aria-hidden="true">from {startYear}</span>
      ) : isOn ? (
        <button
          type="button"
          className={`flip ${isA ? 'is-a' : ''}`}
          aria-pressed={isA}
          aria-label={isA ? `${rec.name}: back to side B, NASA data on the map` : `${rec.name}: flip to side A, the visualization ${rec.eic.title}`}
          onClick={() => void flipRecord(rec.id)}
        >
          {isA ? 'Side A' : 'Side B'}
        </button>
      ) : (
        <span className="vinyl-note" aria-hidden="true">&nbsp;</span>
      )}
    </div>
  );
}

export function Jukebox() {
  const year = useStore((s) => s.year);
  const month = useStore((s) => s.month);
  const humanity = useStore((s) => s.humanity);
  const autoplay = useStore((s) => s.autoplay);
  const stripes = useWarmingStripes();
  const shownYear = Math.round(year);
  const yearText = month != null ? `${MONTHS[month]} ${Math.floor(year)}` : `${shownYear}`;
  const earth = RECORDS.filter((r) => r.side === 'earth');
  const human = RECORDS.filter((r) => r.side === 'human');

  return (
    <section className="dock" aria-label="Jukebox">
      <div className="dock-row">
        <div className="group earth" role="group" aria-label="Earth records">
          <h2>Earth</h2>
          <div className="vinyls">{earth.map((r) => <Vinyl key={r.id} rec={r} index={RECORDS.indexOf(r)} />)}</div>
        </div>
        <div className="group human" role="group" aria-label="Humanity records">
          <h2>Humanity</h2>
          <div className="vinyls">{human.map((r) => <Vinyl key={r.id} rec={r} index={RECORDS.indexOf(r)} />)}</div>
        </div>
        <div className={`lever ${humanity === 0 ? 'muted' : ''}`}>
          <div className="lever-head">
            <label htmlFor="humanity">Humanity</label>
            <output htmlFor="humanity">{Math.round(humanity * 100)}%</output>
          </div>
          <input
            id="humanity"
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(humanity * 100)}
            aria-valuetext={`${Math.round(humanity * 100)} percent`}
            style={{ '--fill': `${humanity * 100}%` } as CSSProperties}
            onChange={(e) => setHumanity(Number(e.target.value) / 100, true)}
          />
          <button type="button" className="mute" aria-pressed={humanity === 0} onClick={() => (humanity === 0 ? unmuteHumanity() : muteHumanity())}>
            {humanity === 0 ? 'Bring humanity back' : 'Mute humanity'}
          </button>
        </div>
      </div>

      <div className="timeline">
        <button
          type="button"
          className="play"
          onClick={() => setAutoplay(!autoplay)}
          aria-pressed={autoplay}
          aria-label={autoplay ? 'Pause the timeline' : 'Play 75 years, 1950 to today'}
          title={autoplay ? 'Pause (P)' : 'Play 75 years (P)'}
        >
          {autoplay ? (
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>
          )}
        </button>
        <div className="track">
          <div className="eras" aria-hidden="true">
            <span style={{ left: '0%' }}>1950 · prologue</span>
            <span style={{ left: `${pct(1979)}%` }}>1979 · satellites</span>
            <span style={{ left: `${pct(2000)}%` }}>2000 · full mix</span>
          </div>
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
          <div className="ticks" aria-hidden="true">
            {[1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020].map((y) => (
              <span key={y} style={{ left: `${pct(y)}%` }}>{y}</span>
            ))}
          </div>
        </div>
        <div className="year-display" aria-hidden="true">
          <span className="year-big">{Math.floor(month != null ? year : shownYear)}</span>
          <span className="year-month">{month != null ? MONTHS[month] : 'yearly'}</span>
        </div>
      </div>
    </section>
  );
}
