// Pieces on top of the map: the top bar, the key for the layers on the map, the probe
// readout and the caption line.

import { useState } from 'react';
import { Logo } from './Logo';
import { setAlwaysListen } from '../input/voice';
import { RECORDS, RECORD_BY_ID } from '../config/records';
import { hapticPatternName } from '../input/haptics';
import { backToJukebox, describeValue } from '../state/actions';
import { setState, useStore } from '../state/store';

export function TopBar() {
  const micOn = useStore((s) => s.settings.alwaysListen);
  const sources = useStore((s) => s.sources);
  const controller = useStore((s) => s.controller);
  const captions = useStore((s) => s.settings.captions);
  const settings = useStore((s) => s.settings);
  const placeholders = RECORDS.filter((r) => sources[r.id] === 'placeholder').length;
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button type="button" className="back-button" onClick={backToJukebox} aria-label="Back to the jukebox" title="Back to the jukebox (J)">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <p className="brand">
          <button type="button" className="brand-home" onClick={backToJukebox} aria-label="Melodic Earth Jukebox, back to the jukebox" title="Back to the jukebox (J)">
            <Logo live className="brand-logo" />
            <span className="brand-name">Melodic Earth Jukebox</span>
          </button>
        </p>
      </div>
      <div className="topbar-right">
        {placeholders > 0 && (
          <span className="pill warn" title="Run python3 scripts/download_eic.py to get the real NASA EIC clips.">
            {placeholders === 6 ? 'Placeholder visuals' : `${placeholders} placeholder visuals`}
          </span>
        )}
        {controller && <span className="pill" title={controller}>Controller connected</span>}
        {micOn && (
          <button type="button" className="pill mic-pill" onClick={() => setAlwaysListen(false)} title="The microphone is on: just say a command. Click to turn it off.">
            <span className="mic-dot" aria-hidden="true" /> Mic on
          </button>
        )}
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
        <button type="button" className="pill-button" title="How it works (I)" onClick={() => setState({ howOpen: true })}>
          How it works
        </button>
        <button type="button" className="icon-button" aria-label="Help and settings" title="Help and settings (H)" onClick={() => setState({ helpOpen: true })}>
          ?
        </button>
      </div>
    </header>
  );
}

/** What's on the map: one compact row per layer (name, real period, NASA color key). Details for the last one chosen. */
export function Legend() {
  const playing = useStore((s) => s.playing);
  const solo = useStore((s) => s.solo);
  const selected = useStore((s) => s.selected);
  const humanity = useStore((s) => s.humanity);
  const [open, setOpen] = useState(true);
  const on = RECORDS.filter((r) => playing[r.id] && (!solo || solo === r.id));
  if (!on.length) return null;
  const detail = on.find((r) => r.id === selected) ?? on[on.length - 1];
  return (
    <div className="legend" aria-label="Key: what's on the map">
      <button type="button" className="legend-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="legend-title">Key</span> <span className="legend-count">{on.length} on the map</span> <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <>
          <ul>
            {on.map((r) => {
              const muted = r.side === 'human' && humanity === 0;
              return (
                <li key={r.id} className={muted ? 'muted' : ''}>
                  <div className="legend-row">
                    <span className="dot" style={{ background: r.color }} aria-hidden="true" />
                    <span className="legend-name">{r.short}</span>
                    <span className="legend-period">{r.period.replace(/\s*\(.*\)/, '')}</span>
                  </div>
                  <div className={`legend-bar ${r.scale.lightBar ? 'light' : ''}`} style={{ background: `linear-gradient(to right, ${r.scale.colors.join(', ')})` }} aria-hidden="true" />
                  <div className="legend-ends" aria-label={`${r.name}: from ${r.scale.low} to ${r.scale.high}`}>
                    <span>{r.scale.low}</span>
                    <span>{r.scale.high}</span>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="legend-shows">
            <strong>{detail.name}:</strong> {detail.shows}{' '}
            <a href={`https://svs.gsfc.nasa.gov/${detail.svs}/`} target="_blank" rel="noreferrer">NASA SVS {detail.svs}</a>
          </p>
        </>
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
            <span className="dot" style={{ background: r.color }} />
            {r.short}: <strong>{v == null ? 'no data' : describeValue(r.id, v)}</strong>
            {v != null && <span className="bar" style={{ width: `${Math.round(v * 60)}px`, background: r.color }} />}
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
    </>
  );
}

/** Spoken feedback for screen readers. Outside the map, so it still works on the jukebox screen. */
export function Announcer() {
  const announcement = useStore((s) => s.announcement);
  return (
    <p className="visually-hidden" role="status" aria-live="polite">
      {announcement}
    </p>
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
