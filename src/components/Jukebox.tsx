// The jukebox dock, kept simple: six big record buttons, the humanity lever, three ways to
// listen, a place picker and the story. Every control is a real button, slider or select, so
// keyboard, switch and screen-reader users get it for free.

import { type CSSProperties } from 'react';
import { HOTSPOTS } from '../config/places';
import { INSTRUMENT_NAMES, RECORDS, type RecordDef } from '../config/records';
import { goToPlace, muteHumanity, resetView, setHumanity, setMode, toggleRecord, unmuteHumanity } from '../state/actions';
import { startStory, stopStory, storyLength } from '../state/story';
import { useStore, type Mode } from '../state/store';
import { ModeIcon, RecordIcon } from './icons';

function RecordButton({ rec, index }: { rec: RecordDef; index: number }) {
  const isOn = useStore((s) => s.playing[rec.id]);
  const silenced = useStore((s) => (s.solo != null && s.solo !== rec.id) || (rec.side === 'human' && s.humanity === 0));
  const level = useStore((s) => s.levels[rec.id]?.value ?? 0);
  const placeholder = useStore((s) => s.sources[rec.id] === 'placeholder');
  return (
    <button
      type="button"
      className={`record ${isOn ? 'on' : ''} ${silenced && isOn ? 'silenced' : ''}`}
      style={{ '--rec': rec.color, '--level': `${Math.round(level * 100)}%` } as CSSProperties}
      aria-pressed={isOn}
      aria-label={`${rec.name}. ${isOn ? 'Playing' : 'Off'}. ${rec.hear} ${rec.period}. Key ${index + 1}.`}
      title={`${rec.eicTitle} · NASA SVS ${rec.svs} · ${rec.period}${placeholder ? ' · placeholder picture' : ''}`}
      onClick={() => void toggleRecord(rec.id)}
    >
      <span className="record-icon" aria-hidden="true"><RecordIcon id={rec.id} /></span>
      <span className="record-text" aria-hidden="true">
        <span className="record-name">{rec.short}</span>
        <span className="record-sub">{INSTRUMENT_NAMES[rec.instrument]} · {isOn ? (silenced ? 'muted' : 'on') : 'off'}</span>
      </span>
      <span className="record-meter" aria-hidden="true" />
    </button>
  );
}

const MODES: Array<{ id: Mode; label: string; hint: string }> = [
  { id: 'listen', label: 'Listen', hint: 'everything on screen' },
  { id: 'scan', label: 'Scan', hint: 'a needle sweeps the map' },
  { id: 'probe', label: 'Probe', hint: 'point to hear one spot' },
];

export function Jukebox() {
  const humanity = useStore((s) => s.humanity);
  const mode = useStore((s) => s.mode);
  const story = useStore((s) => s.story);
  const playing = useStore((s) => s.playing);
  const earth = RECORDS.filter((r) => r.side === 'earth');
  const human = RECORDS.filter((r) => r.side === 'human');
  const placeGroups = RECORDS.filter((r) => playing[r.id]).length ? RECORDS.filter((r) => playing[r.id]) : RECORDS;

  return (
    <section className="dock" aria-label="Jukebox">
      <div className="dock-row">
        <div className="group" role="group" aria-labelledby="earth-h">
          <h2 id="earth-h">Earth <span>in tune</span></h2>
          <div className="records">{earth.map((r) => <RecordButton key={r.id} rec={r} index={RECORDS.indexOf(r)} />)}</div>
        </div>
        <div className="group human" role="group" aria-labelledby="human-h">
          <h2 id="human-h">Humanity <span>out of key</span></h2>
          <div className="records">{human.map((r) => <RecordButton key={r.id} rec={r} index={RECORDS.indexOf(r)} />)}</div>
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

      <div className="controls-row">
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
                  <option key={`${r.id}-${p}`} value={p}>{p.replace(/^the /, '').replace(/^./, (c) => c.toUpperCase())}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={`story ${story.running ? 'running' : ''}`}
          onClick={() => (story.running ? stopStory() : void startStory())}
        >
          {story.running ? `Stop the story (${story.step + 1}/${storyLength})` : '▶ Play the story'}
        </button>
      </div>
    </section>
  );
}
