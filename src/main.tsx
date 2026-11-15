import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@fontsource/fraunces/600.css';
import './styles.css';
import { useStore } from './state/store';

// test hooks: in development, or with ?debug in the address
if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
  (window as unknown as Record<string, unknown>).__store = useStore;
  void import('./audio/conductor').then((c) => ((window as unknown as Record<string, unknown>).__needle = c.scanNeedle, (window as unknown as Record<string, unknown>).__clock = c.debugClock));
  void import('./eic/layers').then((l) => ((window as unknown as Record<string, unknown>).__layers = l));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
