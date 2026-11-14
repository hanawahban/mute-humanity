import { useEffect, useState } from 'react';
import { Jukebox } from './components/Jukebox';
import { MapView } from './components/MapView';
import { SideA } from './components/SideA';
import { HelpDialog } from './components/Settings';
import { Captions, Feeling, Legend, TopBar } from './components/Overlays';
import { loadData } from './data/loader';
import { startMixer } from './audio/mixer';
import { initKeyboard } from './input/keyboard';
import { initGamepad } from './input/gamepad';
import { ensureAudio, toggleRecord } from './state/actions';
import { setState, useStore } from './state/store';

let initialised = false;

export function App() {
  const audioOn = useStore((s) => s.audioOn);
  const loadError = useStore((s) => s.loadError);
  const highContrast = useStore((s) => s.settings.highContrast);
  const reducedMotion = useStore((s) => s.settings.reducedMotion);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (initialised) return;
    initialised = true;
    loadData()
      .then((d) => setState({ data: d }))
      .catch((e: Error) => setState({ loadError: e.message }));
    initKeyboard();
    initGamepad();
    startMixer();
  }, []);

  const start = async () => {
    setStarting(true);
    await ensureAudio();
    await toggleRecord('ocean', true);
  };

  return (
    <div className={`app ${highContrast ? 'high-contrast' : ''} ${reducedMotion ? 'reduced-motion' : ''}`}>
      <main className="stage">
        <MapView />
        <TopBar />
        <SideA />
        <div className="map-bottom">
          <Legend />
          <div className="map-bottom-centre">
            <Captions />
            <Feeling />
          </div>
        </div>
        {loadError && <p className="error" role="alert">{loadError}</p>}
      </main>
      <Jukebox />
      <HelpDialog />

      {!audioOn && (
        <div className="start">
          <div className="start-card">
            <p className="start-kicker">NASA Space Apps 2026 · Earth Information Jukebox</p>
            <h1>Mute Humanity</h1>
            <p className="start-sub">Six records. 75 years of NASA data. Earth plays in tune, humanity plays out of key.</p>
            <button type="button" className="start-button" onClick={() => void start()} disabled={starting} autoFocus>
              Start the jukebox
            </button>
            <p className="start-hint">Sound starts with one click or key press. Play with the mouse, keyboard, your voice (hold V) or an Xbox controller. Press H for help.</p>
          </div>
        </div>
      )}
    </div>
  );
}
