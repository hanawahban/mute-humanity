// Simple line icons for the records and listening modes (decorative: always aria-hidden).

import type { RecordId } from '../config/records';
import type { Mode } from '../state/store';

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function RecordIcon({ id }: { id: RecordId }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
      {id === 'ocean' && (
        <g {...P}>
          <path d="M2 9c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0" />
          <path d="M2 14c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0" />
          <path d="M2 19c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0" />
        </g>
      )}
      {id === 'rain' && (
        <g {...P}>
          <path d="M7 15a4.5 4.5 0 1 1 1.2-8.8A5.5 5.5 0 0 1 18.5 8 3.5 3.5 0 0 1 18 15z" />
          <path d="M8 18l-1 2.5M12 18l-1 2.5M16 18l-1 2.5" />
        </g>
      )}
      {id === 'lightning' && <path {...P} d="M13 2 5 13.5h6L10 22l8-11.5h-6z" />}
      {id === 'lights' && (
        <g {...P}>
          <path d="M3 21V11h5v10M8 21V6h6v15M14 21v-8h7v8M2 21h20" />
          <path d="M10 9h2M10 12h2M10 15h2M16.5 16h2" />
        </g>
      )}
      {id === 'co2' && (
        <g {...P}>
          <path d="M3 21V12l5 3v-3l5 3V8h3v13zM2 21h20" />
          <path d="M14.5 6c0-2 2-2 2-4M18 7c0-2 2-2 2-4" />
        </g>
      )}
      {id === 'nox' && (
        <g {...P}>
          <path d="M3 15l2-5h11l3 5v3H3z" />
          <circle cx="7" cy="18" r="1.8" />
          <circle cx="16" cy="18" r="1.8" />
          <path d="M20 12c1.5 0 2-1 2-2" />
        </g>
      )}
    </svg>
  );
}

export function ModeIcon({ mode }: { mode: Mode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
      {mode === 'listen' && (
        <g {...P}>
          <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
          <rect x="3" y="14" width="4" height="6" rx="1.5" />
          <rect x="17" y="14" width="4" height="6" rx="1.5" />
        </g>
      )}
      {mode === 'scan' && (
        <g {...P}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M12 2v20" strokeWidth={2.6} />
        </g>
      )}
      {mode === 'probe' && (
        <g {...P}>
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </g>
      )}
    </svg>
  );
}
