import { useEffect, useState } from 'react';
import { Jukebox } from './components/Jukebox';
import { Logo } from './components/Logo';
import { MapView } from './components/MapView';
import { HelpDialog } from './components/Settings';
import { HowItWorks } from './components/HowItWorks';
import { setState } from './state/store';
import { Captions, Feeling, Legend, ProbeReadout, TopBar } from './components/Overlays';
import { loadLayers } from './eic/layers';
import { startConductor } from './audio/conductor';
import { initKeyboard } from './input/keyboard';
import { initGamepad } from './input/gamepad';
import { ensureAudio, toggleRecord } from './state/actions';
import { startStory } from './state/story';
import { useStore } from './state/store';

let initialized = false;

export function App() {
  const audioOn = useStore((s) => s.audioOn);
  const highContrast = useStore((s) => s.settings.highContrast);
  const reducedMotion = useStore((s) => s.settings.reducedMotion);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (audioOn) startConductor(); // also when sound is started by a key or the controller
  }, [audioOn]);

  useEffect(() => {
    if (initialized) return;
    initialized = true;
    void loadLayers();
    initKeyboard();
    initGamepad();
  }, []);

  const start = async (story: boolean) => {
    setStarting(true);
    await ensureAudio();
    startConductor();
    if (story) await startStory();
    else await toggleRecord('ocean', true);
  };

  return (
    <div className={`app ${highContrast ? 'high-contrast' : ''} ${reducedMotion ? 'reduced-motion' : ''}`}>
      <main className="stage">
        <MapView />
        <TopBar />
        <div className="map-bottom">
          <Legend />
          <div className="map-bottom-center">
            <Captions />
            <Feeling />
          </div>
          <ProbeReadout />
        </div>
      </main>
      <Jukebox />
      <HelpDialog />
      <HowItWorks />

      {!audioOn && (
        <div className="start">
          <div className="start-card">
            <Logo reveal className="start-logo" title="Sonific-8 logo" />
            <p className="start-kicker">NASA Space Apps 2026 · Earth Information Jukebox</p>
            <h1>Sonific-8</h1>
            <p className="start-sub">Six NASA Earth Information Center maps, played as music. Earth plays in tune. Humanity plays out of key. Then you get to mute humanity.</p>
            <div className="start-buttons">
              <button type="button" className="start-button" onClick={() => void start(true)} disabled={starting} autoFocus>
                Play the story
              </button>
              <button type="button" className="start-button secondary" onClick={() => void start(false)} disabled={starting}>
                Explore on my own
              </button>
            </div>
            <ol className="start-steps">
              <li><strong>Turn on records.</strong> Each one is a NASA map with its own instrument.</li>
              <li><strong>Choose how to listen.</strong> Hear the whole screen, sweep a needle across it, or point at one spot.</li>
              <li><strong>Mute humanity.</strong> Hear the planet without us.</li>
            </ol>
            <p className="start-hint">The story is a short guided listen: each sound on its own, then all of them together. Works with a mouse, keyboard, screen reader, your voice (hold V) or an Xbox controller. Press H any time for help, or I to see <button type="button" className="link-button" onClick={() => setState({ howOpen: true })}>how it works</button>.</p>
          </div>
        </div>
      )}
    </div>
  );
}
