import { useEffect, useState } from 'react';
import { Jukebox } from './components/Jukebox';
import { MapView } from './components/MapView';
import { SideA } from './components/SideA';
import { Captions } from './components/Captions';
import { Settings } from './components/Settings';
import { loadData } from './data/loader';
import { startMixer } from './audio/mixer';
import { initKeyboard } from './input/keyboard';
import { initGamepad } from './input/gamepad';
import { ensureAudio, toggleRecord } from './state/actions';
import { setState, useStore } from './state/store';

let initialised = false;

export function App() {
  const audioOn = useStore((s) => s.audioOn);
  const data = useStore((s) => s.data);
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
      <header>
        <h1>Mute Humanity <span>The Earth Jukebox</span></h1>
        {data?.index.mock && <p className="mock-banner">Mock data: run the pipeline and set VITE_DATA_BASE=/data for real NASA data.</p>}
      </header>

      {loadError && <p className="error" role="alert">{loadError}</p>}

      {!audioOn && (
        <div className="start">
          <button type="button" className="start-button" onClick={() => void start()} disabled={starting} autoFocus>
            Start the jukebox
          </button>
          <p>Sound needs one click or key press to start. Then use the records, your keyboard, your voice, or an Xbox controller.</p>
        </div>
      )}

      <main className="layout">
        <div className="left">
          <Jukebox />
          <SideA />
          <Settings />
        </div>
        <MapView />
      </main>
      <Captions />
    </div>
  );
}
