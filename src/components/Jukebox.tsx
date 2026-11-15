// The map screen's controls, following the team's layout:
// - the Factors drawer on the right: the six records (lamp switches) and the humanity lever
// - the bottom bar: play/pause, three ways to listen, a place picker and the story
// Every control is a real button, switch, slider or select, so keyboard, switch and
// screen-reader users get them for free.

import { useEffect, useRef, type CSSProperties } from 'react';
import { HOTSPOTS } from '../config/places';
import { INSTRUMENT_NAMES, RECORDS, type RecordDef } from '../config/records';
import { goToPlace, muteHumanity, resetView, setHumanity, setMode, toggleRecord, togglePause, unmuteHumanity } from '../state/actions';
import { startStory, stopStory, storyLength } from '../state/story';
import { setState, useStore, type Mode } from '../state/store';
import { ModeIcon } from './icons';

function Factor({ rec, index }: { rec: RecordDef; index: number }) {
  const on = useStore((s) => s.playing[rec.id]);
  const silenced = useStore((s) => (s.solo != null && s.solo !== rec.id) || (rec.side === 'human' && s.humanity === 0));
  const level = useStore((s) => (s.playing[rec.id] ? Math.round((s.levels[rec.id]?.value ?? 0) * 10) / 10 : 0));
  return (
    <li>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className={`factor ${on ? 'on' : ''} ${on && silenced ? 'silenced' : ''}`}
        style={{ '--rec': rec.color, '--level': level } as CSSProperties}
        aria-label={`${rec.name}, ${INSTRUMENT_NAMES[rec.instrument]}${on && silenced ? ', quiet' : ''}. Key ${index + 1}.`}
        title={`${rec.eicTitle} · NASA SVS ${rec.svs} · ${rec.period}`}
        onClick={() => void toggleRecord(rec.id)}
      >
        <span className="lamp" aria-hidden="true" />
        <span className="factor-text" aria-hidden="true">
          <span className="factor-name">{rec.short}</span>
          <span className="factor-inst">{INSTRUMENT_NAMES[rec.instrument]}</span>
        </span>
        <span className="factor-swatch" aria-hidden="true" />
      </button>
    </li>
  );
}

export function FactorsDrawer() {
  const open = useStore((s) => s.factorsOpen);
  const humanity = useStore((s) => s.humanity);
  const earth = RECORDS.filter((r) => r.side === 'earth');
  const human = RECORDS.filter((r) => r.side === 'human');
  return (
    <aside className={`factors ${open ? 'open' : ''}`} aria-label="Records and humanity lever">
      <button
        type="button"
        className="factors-tab"
        aria-expanded={open}
        aria-controls="factors-panel"
        onClick={() => setState({ factorsOpen: !open })}
      >
        <span>Factors</span>
      </button>
      <div id="factors-panel" className="factors-panel" hidden={!open}>
        <h2>Factors</h2>
        <div role="group" aria-labelledby="f-natural">
          <h3 id="f-natural">
            Natural <span>in tune</span>
          </h3>
          <ul>{earth.map((r) => <Factor key={r.id} rec={r} index={RECORDS.indexOf(r)} />)}</ul>
        </div>
        <div role="group" aria-labelledby="f-human">
          <h3 id="f-human">
            Human-made <span>out of key</span>
          </h3>
          <ul>{human.map((r) => <Factor key={r.id} rec={r} index={RECORDS.indexOf(r)} />)}</ul>
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
            {humanity === 0 ? 'Full footprint' : 'Lighten our footprint'}
          </button>
        </div>
      </div>
    </aside>
  );
}

const MODES: Array<{ id: Mode; label: string; hint: string }> = [
  { id: 'listen', label: 'Listen', hint: 'everything on screen' },
  { id: 'scan', label: 'Scan', hint: 'a needle sweeps the map' },
  { id: 'probe', label: 'Probe', hint: 'click to hear one spot' },
];

export function Dock() {
  const mode = useStore((s) => s.mode);
  const story = useStore((s) => s.story);
  const paused = useStore((s) => s.paused);
  const playing = useStore((s) => s.playing);
  const screen = useStore((s) => s.screen);
  const playRef = useRef<HTMLButtonElement>(null);
  // after the jukebox slides away, keyboard focus lands on the play/pause button
  useEffect(() => {
    if (screen !== 'map') return;
    const t = window.setTimeout(() => playRef.current?.focus({ preventScroll: true }), 950);
    return () => window.clearTimeout(t);
  }, [screen]);
  const placeGroups = RECORDS.filter((r) => playing[r.id]).length ? RECORDS.filter((r) => playing[r.id]) : RECORDS;

  return (
    <section className="dock" aria-label="Playback">
      <button ref={playRef} type="button" className="playpause" onClick={togglePause} aria-label={paused ? 'Play' : 'Pause'}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {paused ? <path d="M7 4.5v15l13-7.5z" /> : <path d="M6 4.5h4.5v15H6zM13.5 4.5H18v15h-4.5z" />}
        </svg>
        <span aria-hidden="true">{paused ? 'Play' : 'Pause'}</span>
      </button>

      <div className="modes" role="group" aria-label="How to listen">
        {MODES.map((m) => (
          <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => setMode(m.id)} aria-label={`${m.label}: ${m.hint}`}>
            <ModeIcon mode={m.id} />
            <span className="mode-text" aria-hidden="true">
              <strong>{m.label}</strong>
              <span>{m.hint}</span>
            </span>
          </button>
        ))}
      </div>

      <label className="goto">
        <span>Go to</span>
        <select
          value=""
          onChange={(e) => {
            if (e.target.value === '*') resetView();
            else if (e.target.value) goToPlace(e.target.value);
            e.target.blur();
          }}
        >
          <option value="">Choose a place…</option>
          <option value="*">The whole planet</option>
          {placeGroups.map((r) => (
            <optgroup key={r.id} label={r.name}>
              {(HOTSPOTS[r.id] ?? []).map((p) => (
                <option key={`${r.id}-${p}`} value={p}>
                  {p.replace(/^the /, '').replace(/^./, (c) => c.toUpperCase())}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <button type="button" className={`story ${story.running ? 'running' : ''}`} onClick={() => (story.running ? stopStory() : void startStory())}>
        {story.running ? `Stop the story (${story.step + 1}/${storyLength})` : 'Play the story'}
      </button>
    </section>
  );
}
