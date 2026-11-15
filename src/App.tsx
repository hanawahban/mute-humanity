import { useEffect } from 'react';
import { Dock, FactorsDrawer } from './components/Jukebox';
import { JukeboxScreen } from './components/JukeboxScreen';
import { MapView } from './components/MapView';
import { HelpDialog } from './components/Settings';
import { HowItWorks } from './components/HowItWorks';
import { Announcer, Captions, Feeling, Legend, ProbeReadout, TopBar } from './components/Overlays';
import { loadLayers } from './eic/layers';
import { startConductor } from './audio/conductor';
import { initKeyboard } from './input/keyboard';
import { initGamepad } from './input/gamepad';
import { useStore } from './state/store';

let initialized = false;

export function App() {
  const audioOn = useStore((s) => s.audioOn);
  const highContrast = useStore((s) => s.settings.highContrast);
  const reducedMotion = useStore((s) => s.settings.reducedMotion);
  const onJukebox = useStore((s) => s.screen === 'jukebox');
  const factorsOpen = useStore((s) => s.factorsOpen);

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

  return (
    <div className={`app ${onJukebox ? 'on-jukebox' : 'on-map'} ${highContrast ? 'high-contrast' : ''} ${reducedMotion ? 'reduced-motion' : ''}`}>
      <main className={`stage ${factorsOpen ? 'drawer-open' : ''}`} inert={onJukebox} aria-hidden={onJukebox || undefined}>
        <div className="map-area">
          <MapView />
          <TopBar />
          <Legend />
          <FactorsDrawer />
          <div className="map-bottom">
            <ProbeReadout />
            <div className="map-bottom-center">
              <Captions />
              <Feeling />
            </div>
          </div>
        </div>
        <Dock />
      </main>
      <JukeboxScreen />
      <HelpDialog />
      <HowItWorks />
      <Announcer />
    </div>
  );
}
