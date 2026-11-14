import { useStore } from '../state/store';

/**
 * Two lines:
 * - The caption describes the music continuously, for deaf and hard-of-hearing users.
 *   It is not a live region by default, so screen readers aren't flooded every second;
 *   screen reader users press D (or ask "what am I hearing?") instead.
 * - The announcer is a polite live region for actions (record started, year changed...).
 */
export function Captions() {
  const caption = useStore((s) => s.caption);
  const announcement = useStore((s) => s.announcement);
  const listening = useStore((s) => s.listening);
  return (
    <div className="captions">
      <p className="caption">
        {listening ? <strong className="listening">Listening… </strong> : null}
        {caption || 'Press a record to start.'}
      </p>
      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
