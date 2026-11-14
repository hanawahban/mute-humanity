// Help and settings, in one dialog behind the "?" button (or the H key), so the main screen
// stays calm. A native <dialog> traps focus and closes with Escape.

import { useEffect, useRef } from 'react';
import { setState, useStore } from '../state/store';

export function HelpDialog() {
  const open = useStore((s) => s.helpOpen);
  const settings = useStore((s) => s.settings);
  const ref = useRef<HTMLDialogElement>(null);
  const set = (patch: Partial<typeof settings>) => setState({ settings: { ...settings, ...patch } });

  useEffect(() => {
    const d = ref.current!;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} className="help" aria-labelledby="help-title" onClose={() => setState({ helpOpen: false })}>
      <div className="help-head">
        <h2 id="help-title">How to play</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={() => setState({ helpOpen: false })}>×</button>
      </div>

      <div className="help-grid">
        <section>
          <h3>The idea</h3>
          <p>Each record is a part of the planet, heard through NASA data. Earth plays in tune. Humanity plays out of key. Drag the timeline from 1950 to today, then mute humanity and listen to the planet without us.</p>
          <p>Every record has two sides. <strong>Side B</strong> puts the NASA data on the map. <strong>Side A</strong> plays a NASA Earth Information Center visualization and turns its frames into sound.</p>
        </section>

        <section>
          <h3>Settings</h3>
          <label className="check">
            <input type="checkbox" checked={settings.captions} onChange={(e) => set({ captions: e.target.checked })} /> Captions of the music
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.highContrast} onChange={(e) => set({ highContrast: e.target.checked })} /> High contrast
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.reducedMotion} onChange={(e) => set({ reducedMotion: e.target.checked })} /> Reduce motion
          </label>
          <label className="slider">
            Controller vibration
            <input type="range" min={0} max={100} value={Math.round(settings.vibration * 100)} onChange={(e) => set({ vibration: Number(e.target.value) / 100 })} />
          </label>
        </section>

        <section>
          <h3>Keyboard</h3>
          <dl className="keys">
            <dt><kbd>1</kbd>–<kbd>6</kbd></dt><dd>play or stop a record</dd>
            <dt><kbd>F</kbd></dt><dd>flip the selected record to side A or B</dd>
            <dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>year</dd>
            <dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>humanity lever</dd>
            <dt><kbd>M</kbd></dt><dd>mute humanity</dd>
            <dt><kbd>P</kbd></dt><dd>play 75 years</dd>
            <dt><kbd>Shift</kbd> + arrows</dt><dd>move the map</dd>
            <dt><kbd>+</kbd> <kbd>−</kbd> <kbd>0</kbd></dt><dd>zoom in, out, whole planet</dd>
            <dt><kbd>D</kbd></dt><dd>what am I hearing?</dd>
            <dt>hold <kbd>V</kbd></dt><dd>talk</dd>
            <dt><kbd>C</kbd> <kbd>H</kbd></dt><dd>captions, this help</dd>
          </dl>
        </section>

        <section>
          <h3>Xbox controller</h3>
          <dl className="keys">
            <dt>D-pad ← →</dt><dd>choose a record (the controller vibrates for it)</dd>
            <dt><kbd>A</kbd> / <kbd>Y</kbd></dt><dd>play or stop / flip side</dd>
            <dt>D-pad ↑ ↓</dt><dd>humanity lever</dd>
            <dt>Triggers</dt><dd>back and forward in time, press harder to go faster</dd>
            <dt>Left stick</dt><dd>move the map</dd>
            <dt>Right stick, bumpers</dt><dd>zoom</dd>
            <dt><kbd>B</kbd></dt><dd>what am I hearing? (spoken)</dd>
            <dt>hold <kbd>X</kbd></dt><dd>talk</dd>
            <dt>Start</dt><dd>play 75 years</dd>
          </dl>
          <p className="small">Vibration: ocean swells, plants breathe, rain patters, NO₂ clicks like a Geiger counter, fires crackle, plastic rattles. Faster and stronger means more. Notches mark each decade as you scrub.</p>
        </section>

        <section className="wide">
          <h3>Voice (hold V or X)</h3>
          <p>"Play ocean", "add fires", "stop rain", "flip ocean", "mute humanity", "humanity to 50 percent", "go to Bahrain", "go to 1985", "play the 1990s", "zoom in", "what am I hearing?", "help".</p>
        </section>
      </div>
    </dialog>
  );
}
