// Help and settings, in one dialog behind the "?" button (or the H key), so the main screen
// stays calm. A native <dialog> traps focus and closes with Escape.

import { useEffect, useRef } from 'react';
import { Logo } from './Logo';
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
        <Logo className="help-logo" />
        <h2 id="help-title">How to play Sonific-8</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={() => setState({ helpOpen: false })}>×</button>
      </div>

      <div className="help-grid">
        <section>
          <h3>The idea</h3>
          <p>Six records, each a NASA Earth Information Center map of the whole Earth, each with its own instrument. Turn records on and they stack on one map and play together. Earth plays in tune; humanity plays out of key. Then mute humanity and listen to the planet without us.</p>
          <p>Every layer keeps its real dates: they line up in place, not in time. The sound comes from the pixels, read through each visualization's colour key.</p>
          <h3>Three ways to listen</h3>
          <p><strong>Listen</strong>: you hear everything on screen. Zoom in to hear one place. <strong>Scan</strong>: a needle slowly sweeps the map (about 9 seconds a sweep); every bright point it crosses flashes and plays a note, higher on screen is higher in pitch. <strong>Probe</strong>: click a spot and the narrator says where it is and what each record shows there.</p>
        </section>

        <section>
          <h3>Settings</h3>
          <label className="check">
            <input type="checkbox" checked={settings.captions} onChange={(e) => set({ captions: e.target.checked })} /> Captions of the music
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.narrate} onChange={(e) => set({ narrate: e.target.checked })} /> Spoken narration
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
            <dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>choose a record</dd>
            <dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>humanity lever</dd>
            <dt><kbd>M</kbd></dt><dd>mute humanity</dd>
            <dt><kbd>L</kbd> <kbd>S</kbd> <kbd>P</kbd></dt><dd>Listen, Scan, Probe</dd>
            <dt>arrows in Probe</dt><dd>move the probe</dd>
            <dt><kbd>G</kbd></dt><dd>next place for the chosen record</dd>
            <dt><kbd>O</kbd></dt><dd>solo the chosen record</dd>
            <dt><kbd>T</kbd></dt><dd>play or stop the story</dd>
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
            <dt><kbd>A</kbd></dt><dd>play or stop it</dd>
            <dt><kbd>Y</kbd></dt><dd>Listen → Scan → Probe</dd>
            <dt>D-pad ↑ ↓</dt><dd>humanity lever</dd>
            <dt>Left stick</dt><dd>move the map, or the probe in Probe mode</dd>
            <dt>Right stick, bumpers</dt><dd>zoom</dd>
            <dt>Triggers</dt><dd>previous / next place</dd>
            <dt><kbd>B</kbd></dt><dd>what am I hearing? (spoken)</dd>
            <dt>hold <kbd>X</kbd></dt><dd>talk</dd>
            <dt>View</dt><dd>solo</dd>
            <dt>Start</dt><dd>play the story</dd>
          </dl>
          <p className="small">Vibration: the ocean swells, rain patters, lightning strikes, city lights flicker, CO₂ rumbles and NOx clicks like a Geiger counter. Faster and stronger means more.</p>
        </section>

        <section className="wide">
          <h3>Voice (hold V or X)</h3>
          <p>"Play ocean", "add lightning", "stop rain", "solo NOx", "scan", "probe", "listen", "mute humanity", "humanity to 50 percent", "go to Bahrain", "zoom in", "play the story", "what am I hearing?", "help".</p>
          <h3>Credits</h3>
          <p className="small">Visualizations: NASA Earth Information Center and Scientific Visualization Studio (SVS 3912, 5149, 5011, 5475, 5121, 5154). Base map: NASA Blue Marble. Instruments recorded by our multimedia team.</p>
        </section>
      </div>
    </dialog>
  );
}
