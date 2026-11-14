// Pieces on top of the map: the top bar, the key for the layers on the map, the probe
// readout and the caption line.

import { RECORDS, RECORD_BY_ID } from '../config/records';
import { layers } from '../eic/layers';
import { hapticPatternName } from '../input/haptics';
import { describeValue } from '../state/actions';
import { audible, setState, useStore, visible } from '../state/store';

export function TopBar() {
  const sources = useStore((s) => s.sources);
  const controller = useStore((s) => s.controller);
  const captions = useStore((s) => s.settings.captions);
  const settings = useStore((s) => s.settings);
  const placeholders = RECORDS.filter((r) => sources[r.id] === 'placeholder').length;
  return (
    <header className="topbar">
      <h1>
        Mute Humanity <span>The Earth Jukebox</span>
      </h1>
      <div className="topbar-right">
        {placeholders > 0 && (
          <span className="pill warn" title="Run python3 scripts/download_eic.py to get the real NASA EIC clips.">
            {placeholders === 6 ? 'Placeholder visuals' : `${placeholders} placeholder visuals`}
          </span>
        )}
        {controller && <span className="pill" title={controller}>Controller connected</span>}
        <button
          type="button"
          className="icon-button"
          aria-pressed={captions}
          aria-label="Captions"
          title="Captions (C)"
          onClick={() => setState({ settings: { ...settings, captions: !captions } })}
        >
          CC
        </button>
        <button type="button" className="icon-button" aria-label="Help and settings" title="Help and settings (H)" onClick={() => setState({ helpOpen: true })}>
          ?
        </button>
      </div>
    </header>
  );
}

/** What's on the map: title, real time period, one-line explanation and NASA colour key. */
export function Legend() {
  const order = useStore((s) => s.order);
  const playing = useStore((s) => s.playing);
  const solo = useStore((s) => s.solo);
  const humanity = useStore((s) => s.humanity);
  const s = { order, playing, solo } as Parameters<typeof visible>[0];
  const shown = visible(s);
  const soundOnly = audible(s).filter((id) => !shown.includes(id));
  if (!shown.length && !soundOnly.length) return null;
  return (
    <div className="legend" aria-label="On the map">
      {[...shown].reverse().map((id, i) => {
        const r = RECORD_BY_ID[id];
        const cb = layers.get(id)?.colorbarUrl;
        return (
          <div className="legend-item" key={id}>
            <div className="legend-title">
              <span className="dot" style={{ background: r.colour }} aria-hidden="true" />
              {r.name}
            </div>
            <span className="legend-period">{r.period}</span>
            {i === 0 && <p className="legend-shows">{r.shows}</p>}
            {cb && <img className="legend-key" src={cb} alt={`Colour key for ${r.name}`} />}
            <p className="legend-source">
              EIC: {r.eicTitle} · <a href={`https://svs.gsfc.nasa.gov/${r.svs}/`} target="_blank" rel="noreferrer">SVS {r.svs}</a>
              {r.side === 'human' && humanity < 1 ? ` · humanity ${Math.round(humanity * 100)}%` : ''}
            </p>
          </div>
        );
      })}
      {soundOnly.length > 0 && (
        <p className="legend-sound">
          Sound only: {soundOnly.map((id) => RECORD_BY_ID[id].short).join(', ')}
        </p>
      )}
    </div>
  );
}

export function ProbeReadout() {
  const mode = useStore((s) => s.mode);
  const values = useStore((s) => s.probeValues);
  const playing = useStore((s) => s.playing);
  if (mode !== 'probe') return null;
  const on = RECORDS.filter((r) => playing[r.id]);
  if (!on.length) return null;
  return (
    <ul className="probe-readout" aria-hidden="true">
      {on.map((r) => {
        const v = values[r.id];
        return (
          <li key={r.id}>
            <span className="dot" style={{ background: r.colour }} />
            {r.short}: <strong>{v == null ? 'no data' : describeValue(r.id, v)}</strong>
            {v != null && <span className="bar" style={{ width: `${Math.round(v * 60)}px`, background: r.colour }} />}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The caption describes the music for deaf and hard-of-hearing users. It is not a live region,
 * so screen readers aren't flooded (they press D). The announcer below is a polite live region
 * for actions.
 */
export function Captions() {
  const caption = useStore((s) => s.caption);
  const announcement = useStore((s) => s.announcement);
  const listening = useStore((s) => s.listening);
  const on = useStore((s) => s.settings.captions);
  const story = useStore((s) => s.story.running);
  const anyPlaying = useStore((s) => Object.values(s.playing).some(Boolean));
  const show = listening || story || (on && anyPlaying && caption);
  return (
    <>
      {show && (
        <p className={`caption ${story ? 'story-caption' : ''}`}>
          {listening ? <><strong className="listening">Listening… </strong>say a command</> : caption}
        </p>
      )}
      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}

export function Feeling() {
  const controller = useStore((s) => s.controller);
  const felt = useStore((s) => (s.controller ? (s.playing[s.selected] ? s.selected : RECORDS.find((r) => s.playing[r.id])?.id ?? null) : null));
  if (!controller || !felt) return null;
  return (
    <p className="feeling" aria-hidden="true">
      Controller feels <strong>{RECORD_BY_ID[felt].short}</strong> · {hapticPatternName[felt]}
    </p>
  );
}
