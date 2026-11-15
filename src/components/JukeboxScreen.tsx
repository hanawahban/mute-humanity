// The first page: the jukebox, based on the multimedia team's layout (a cream arch, two
// columns of records with indicator lamps, a big play button). Picking a record lights its
// lamp, plays a note on its instrument, and shows its map faintly behind the jukebox.
// Play slides the jukebox away and the map takes over.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { INSTRUMENT_NAMES, RECORDS, type RecordDef } from '../config/records';
import { previewValue } from '../audio/conductor';
import { enterMap, ensureAudio, toggleRecord } from '../state/actions';
import { startStory } from '../state/story';
import { getState, setState, useStore } from '../state/store';
import { Logo } from './Logo';

/** The names on the jukebox, in the team's wording. */
const LABEL: Record<string, string> = {
  ocean: 'Sea surface temperature',
  rain: 'Rain and clouds',
  lightning: 'Lightning',
  lights: 'City lights',
  co2: 'CO₂ emissions',
  nox: 'NO₂ pollution',
};

function Pick({ rec, index }: { rec: RecordDef; index: number }) {
  const on = useStore((s) => s.playing[rec.id]);
  const pick = async () => {
    await ensureAudio();
    const next = !getState().playing[rec.id];
    await toggleRecord(rec.id, next);
    if (next) previewValue(rec.id, 0.7); // hear the instrument as the lamp lights
  };
  return (
    <li>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className={`pick ${on ? 'on' : ''}`}
        style={{ '--rec': rec.color } as CSSProperties}
        onClick={() => void pick()}
        aria-label={`${LABEL[rec.id]}, on ${INSTRUMENT_NAMES[rec.instrument]}. Key ${index + 1}.`}
      >
        <span className="lamp" aria-hidden="true">{index + 1}</span>
        <span className="pick-pill" aria-hidden="true">
          <span className="pick-name">{LABEL[rec.id]}</span>
          <span className="pick-inst">{INSTRUMENT_NAMES[rec.instrument]}</span>
        </span>
      </button>
    </li>
  );
}

export function JukeboxScreen() {
  const screen = useStore((s) => s.screen);
  const playing = useStore((s) => s.playing);
  const count = RECORDS.filter((r) => playing[r.id]).length;
  // stay mounted while sliding away, and mount before sliding back in
  const [mounted, setMounted] = useState(screen === 'jukebox');
  const [shown, setShown] = useState(screen === 'jukebox');
  const playRef = useRef<HTMLButtonElement>(null);
  const [hint, setHint] = useState(false);

  useEffect(() => {
    if (screen === 'jukebox') {
      setMounted(true);
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      const t = window.setTimeout(() => playRef.current?.focus(), 400);
      return () => {
        cancelAnimationFrame(raf);
        window.clearTimeout(t);
      };
    }
    setShown(false);
    const t = window.setTimeout(() => setMounted(false), 900);
    return () => window.clearTimeout(t);
  }, [screen]);

  if (!mounted) return null;
  const earth = RECORDS.filter((r) => r.side === 'earth');
  const human = RECORDS.filter((r) => r.side === 'human');

  const play = () => {
    if (!count) {
      setHint(true);
      return;
    }
    void enterMap();
  };
  const all = async () => {
    await ensureAudio();
    const every = count < RECORDS.length;
    for (const r of RECORDS) await toggleRecord(r.id, every);
  };

  return (
    <section className={`jukebox-screen ${shown ? 'shown' : ''}`} aria-labelledby="jb-title">
      <div className="jb-arch">
        <div className="jb-inner" style={{ '--count': count } as CSSProperties}>
          <header className="jb-head">
            {/* a record turns behind the logo while anything is picked */}
            <div className={`jb-window ${count ? 'spin' : ''}`}>
              <span className="jb-disc" aria-hidden="true" />
              <Logo className="jb-logo" title="Melodic Earth Jukebox logo" />
            </div>
            <h1 id="jb-title">Melodic Earth Jukebox</h1>
            <p className="jb-sub">Six NASA maps, each played by its own instrument. Pick your records.</p>
          </header>

          <div className="jb-columns">
            <div className="jb-col" role="group" aria-labelledby="jb-natural">
              <h2 id="jb-natural">
                Natural
              </h2>
              <ul>
                {earth.map((r) => (
                  <Pick key={r.id} rec={r} index={RECORDS.indexOf(r)} />
                ))}
              </ul>
            </div>
            <div className="jb-col" role="group" aria-labelledby="jb-human">
              <h2 id="jb-human">
                Human-made
              </h2>
              <ul>
                {human.map((r) => (
                  <Pick key={r.id} rec={r} index={RECORDS.indexOf(r)} />
                ))}
              </ul>
            </div>
          </div>

          <div className="jb-actions">
            <button type="button" className="jb-all" onClick={() => void all()}>
              {count < RECORDS.length ? 'Pick all six' : 'Clear'}
            </button>
            <button ref={playRef} type="button" className="jb-play" aria-disabled={!count} aria-describedby="jb-count" onClick={play}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 4.5v15l13-7.5z" />
              </svg>
              Play
            </button>
            <button type="button" className="jb-story" onClick={() => void startStory()}>
              Play the story
              <span>1½ min, guided</span>
            </button>
          </div>
          <p id="jb-count" className={`jb-count ${hint && !count ? 'warn' : ''}`} aria-live="polite">
            {count ? `${count} record${count > 1 ? 's' : ''} picked` : 'Pick at least one record to play'}
          </p>

          <div className="jb-grille" aria-hidden="true" />

          <nav className="jb-foot" aria-label="More">
            <button type="button" onClick={() => setState({ howOpen: true })}>
              How it works
            </button>
            <button type="button" onClick={() => setState({ helpOpen: true })}>
              Help and settings
            </button>
            <span>
              Keys <kbd>1</kbd>–<kbd>6</kbd> pick, <kbd>Enter</kbd> plays
            </span>
          </nav>
        </div>
      </div>
    </section>
  );
}
