// Small pieces that sit on top of the map: the top bar, the legend and the caption line.

import { RECORDS } from '../config/records';
import { LAYER_STYLES, legendGradient } from '../map/styles';
import { hasYear } from '../data/sample';
import { hapticPatternName } from '../input/haptics';
import { setState, useStore } from '../state/store';

export function TopBar() {
  const mock = useStore((s) => s.data?.index.mock);
  const controller = useStore((s) => s.controller);
  const captions = useStore((s) => s.settings.captions);
  const settings = useStore((s) => s.settings);
  return (
    <header className="topbar">
      <h1>
        Mute Humanity <span>The Earth Jukebox</span>
      </h1>
      <div className="topbar-right">
        {mock && <span className="pill warn" title="The map shows made-up data shaped like the NASA products, until the pipeline output is plugged in.">Mock data</span>}
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

export function Legend() {
  const data = useStore((s) => s.data);
  const playing = useStore((s) => s.playing);
  const sideA = useStore((s) => s.sideA);
  const year = useStore((s) => s.year);
  const humanity = useStore((s) => s.humanity);
  const shown = RECORDS.filter((r) => {
    const layer = data?.layers.get(r.layer);
    return playing[r.id] && sideA !== r.id && layer && hasYear(layer, year) && (r.side === 'earth' || humanity > 0);
  });
  if (!shown.length) return null;
  return (
    <ul className="legend" aria-label="Map key">
      {shown.map((r) => {
        const st = LAYER_STYLES[r.id];
        return (
          <li key={r.id}>
            <span className="legend-title">{st.legend.title}</span>
            <span className="legend-bar" style={{ background: legendGradient(st) }} aria-hidden="true" />
            <span className="legend-ends">
              <span>{st.legend.low}</span>
              <span>{st.legend.high}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The caption describes the music continuously, for deaf and hard-of-hearing users. It is not
 * a live region, so screen readers aren't flooded; they press D instead. The announcer below
 * is a polite live region for actions (record started, year changed...).
 */
export function Captions() {
  const caption = useStore((s) => s.caption);
  const announcement = useStore((s) => s.announcement);
  const listening = useStore((s) => s.listening);
  const on = useStore((s) => s.settings.captions);
  const anyPlaying = useStore((s) => Object.values(s.playing).some(Boolean));
  return (
    <>
      {(listening || (on && anyPlaying && caption)) && (
        <p className="caption">
          {listening ? <strong className="listening">Listening… </strong> : null}
          {listening ? 'say a command' : caption}
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
  const felt = useStore((s) => {
    if (!s.controller) return null;
    if (s.playing[s.selected]) return s.selected;
    return RECORDS.find((r) => s.playing[r.id])?.id ?? null;
  });
  if (!controller || !felt) return null;
  const rec = RECORDS.find((r) => r.id === felt)!;
  return (
    <p className="feeling" aria-hidden="true">
      Controller feels <strong>{rec.name}</strong> · {hapticPatternName[felt]}
    </p>
  );
}
