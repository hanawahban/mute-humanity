// The jukebox dock: six records, the humanity lever, how to listen, places, and the story.
// Built from real buttons and range inputs, so keyboard and screen readers work by default.

import { type CSSProperties } from 'react';
import { HOTSPOTS } from '../config/places';
import { RECORDS, type RecordDef } from '../config/records';
import { bringToTop, goToPlace, muteHumanity, setHumanity, setMode, toggleRecord, toggleSolo, unmuteHumanity } from '../state/actions';
import { startStory, stopStory, storyLength } from '../state/story';
import { useStore, visible, type Mode } from '../state/store';

function Vinyl({ rec, index }: { rec: RecordDef; index: number }) {
  const isOn = useStore((s) => s.playing[rec.id]);
  const selected = useStore((s) => s.selected === rec.id);
  const solo = useStore((s) => s.solo);
  const level = useStore((s) => s.levels[rec.id]?.value ?? 0);
  const onMap = useStore((s) => visible(s).includes(rec.id));
  const progress = useStore((s) => s.progress[rec.id]);
  const silenced = solo != null && solo !== rec.id;
  const status = isOn ? (silenced ? 'playing, silenced by solo' : onMap ? 'playing, on the map' : 'playing, sound only') : 'stopped';

  return (
    <div
      className={`vinyl ${isOn ? 'on' : ''} ${selected ? 'selected' : ''} ${silenced ? 'dark' : ''}`}
      style={{ '--rec': rec.colour, '--level': `${Math.round(level * 100)}%` } as CSSProperties}
    >
      <button
        type="button"
        className="vinyl-disc"
        aria-pressed={isOn}
        aria-label={`${rec.name}, ${rec.side === 'earth' ? 'Earth' : 'humanity'} record, ${status}. ${rec.hear} Key ${index + 1}.`}
        title={`${rec.eicTitle} (NASA SVS ${rec.svs}) · ${rec.period}`}
        onClick={() => void toggleRecord(rec.id)}
      >
        <span className="disc" aria-hidden="true">
          <span className="label">{index + 1}</span>
        </span>
      </button>
      <span className="vinyl-name" aria-hidden="true">{rec.short}</span>
      {isOn && !onMap && !silenced ? (
        <button type="button" className="flip" onClick={() => bringToTop(rec.id)} aria-label={`Show ${rec.name} on the map`}>
          Show
        </button>
      ) : (
        <span className="vinyl-note" aria-hidden="true">
          {isOn && progress != null ? <span className="progress" style={{ '--p': `${Math.round(progress * 100)}%` } as CSSProperties} /> : rec.period.replace(/\s*\(.*\)/, '')}
        </span>
      )}
    </div>
  );
}

const MODES: Array<{ id: Mode; label: string; hint: string }> = [
  { id: 'listen', label: 'Listen', hint: 'Hear everything in view (L)' },
  { id: 'scan', label: 'Scan', hint: 'A needle sweeps the view (S)' },
  { id: 'probe', label: 'Probe', hint: 'Hear the spot under the cursor (P)' },
];

export function Jukebox() {
  const humanity = useStore((s) => s.humanity);
  const mode = useStore((s) => s.mode);
  const selected = useStore((s) => s.selected);
  const solo = useStore((s) => s.solo);
  const story = useStore((s) => s.story);
  const earth = RECORDS.filter((r) => r.side === 'earth');
  const human = RECORDS.filter((r) => r.side === 'human');
  const sel = RECORDS.find((r) => r.id === selected)!;

  return (
    <section className="dock" aria-label="Jukebox">
      <div className="dock-row">
        <div className="group earth" role="group" aria-label="Earth records, in tune">
          <h2>Earth</h2>
          <div className="vinyls">{earth.map((r) => <Vinyl key={r.id} rec={r} index={RECORDS.indexOf(r)} />)}</div>
        </div>
        <div className="group human" role="group" aria-label="Humanity records, out of key">
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

      <div className="controls-row">
        <div className="modes" role="group" aria-label="How to listen">
          {MODES.map((m) => (
            <button key={m.id} type="button" aria-pressed={mode === m.id} title={m.hint} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="places" role="group" aria-label={`Places for ${sel.name}`}>
          <span className="places-label" aria-hidden="true">{sel.short}:</span>
          {(HOTSPOTS[selected] ?? []).map((p) => (
            <button key={p} type="button" className="chip" onClick={() => goToPlace(p)}>
              {p.replace(/^the /, '')}
            </button>
          ))}
          <button type="button" className="chip" aria-pressed={solo === selected} onClick={() => toggleSolo(selected)} title="Hear only this record (O)">
            Solo
          </button>
        </div>
        <button
          type="button"
          className={`story ${story.running ? 'running' : ''}`}
          onClick={() => (story.running ? stopStory() : void startStory())}
          title="A guided 90-second tour (T)"
        >
          {story.running ? `Stop the story · ${story.step + 1}/${storyLength}` : 'Play the story'}
        </button>
      </div>
    </section>
  );
}
