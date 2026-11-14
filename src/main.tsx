import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@fontsource/fraunces/600.css';
import './styles.css';
import { useStore } from './state/store';

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__store = useStore;
  void import('./audio/conductor').then((c) => ((window as unknown as Record<string, unknown>).__needle = c.scanNeedle, (window as unknown as Record<string, unknown>).__clock = c.debugClock));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
