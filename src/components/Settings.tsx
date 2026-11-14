import { setState, useStore } from '../state/store';

export function Settings() {
  const settings = useStore((s) => s.settings);
  const set = (patch: Partial<typeof settings>) => setState({ settings: { ...settings, ...patch } });
  return (
    <details className="settings">
      <summary>Settings and help</summary>
      <label>
        <input type="checkbox" checked={settings.highContrast} onChange={(e) => set({ highContrast: e.target.checked })} /> High contrast
      </label>
      <label>
        <input type="checkbox" checked={settings.reducedMotion} onChange={(e) => set({ reducedMotion: e.target.checked })} /> Reduced motion
      </label>
      <label>
        Controller vibration
        <input type="range" min={0} max={100} value={Math.round(settings.vibration * 100)} onChange={(e) => set({ vibration: Number(e.target.value) / 100 })} />
      </label>
      <h3>Keyboard</h3>
      <ul>
        <li><kbd>1</kbd>–<kbd>6</kbd> play or stop a record, <kbd>F</kbd> flip it to side A or B</li>
        <li><kbd>←</kbd> <kbd>→</kbd> change year, <kbd>↑</kbd> <kbd>↓</kbd> humanity, <kbd>M</kbd> mute humanity</li>
        <li><kbd>Shift</kbd> + arrows move the map, <kbd>+</kbd> <kbd>−</kbd> zoom, <kbd>P</kbd> play 75 years</li>
        <li><kbd>D</kbd> what am I hearing, hold <kbd>V</kbd> to talk</li>
      </ul>
      <h3>Xbox controller</h3>
      <ul>
        <li>D-pad left/right choose a record, <kbd>A</kbd> play/stop, <kbd>Y</kbd> flip side</li>
        <li>D-pad up/down humanity, triggers move through time, bumpers zoom, left stick moves the map</li>
        <li><kbd>B</kbd> what am I hearing, hold <kbd>X</kbd> to talk, <kbd>Start</kbd> play 75 years</li>
      </ul>
      <h3>Voice (hold V or X)</h3>
      <p>"Play ocean", "add fires", "stop rain", "flip ocean", "mute humanity", "humanity to 50 percent", "go to Bahrain", "go to 1985", "play the 1990s", "zoom in", "what am I hearing?", "help".</p>
    </details>
  );
}
