// The Sonific-8 logo. `live` makes it glow with the music (driven straight from the store,
// without re-rendering React); `reveal` sweeps it in from left to right like the scan needle.

import { useEffect, useRef } from 'react';
import { LOGO_PATH, LOGO_VIEWBOX } from './logoPath';
import { useStore } from '../state/store';

export function Logo({ className = '', live = false, reveal = false, title }: { className?: string; live?: boolean; reveal?: boolean; title?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!live) return;
    return useStore.subscribe((s) => {
      const el = ref.current;
      if (!el) return;
      let v = 0;
      for (const l of Object.values(s.levels)) v = Math.max(v, l?.value ?? 0);
      el.style.setProperty('--pulse', (Math.round(v * 20) / 20).toString());
    });
  }, [live]);
  return (
    <svg
      ref={ref}
      className={`logo ${live ? 'live' : ''} ${reveal ? 'reveal' : ''} ${className}`}
      viewBox={LOGO_VIEWBOX}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path fill="currentColor" fillRule="evenodd" d={LOGO_PATH} />
    </svg>
  );
}
