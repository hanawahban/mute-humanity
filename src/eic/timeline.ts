// Time inside each NASA clip: which real date a frame shows, scrubbing, and "then vs now".
//
// Every record keeps its own clock. Rain and NOx cover 15 days of NASA model output, lightning
// six and a half years, city lights 2012 to 2023, temperature 1880 to 2025, CO2 one month. So
// there is no single shared year: each record gets its own timeline, labelled in its own dates.

import { RECORD_BY_ID, type RecordId } from '../config/records';
import { getState, setState } from '../state/store';
import { layers } from './layers';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The clip's current position in seconds, or null if the record has no moving clip. */
export function clipTime(id: RecordId): number | null {
  const el = layers.get(id)?.el;
  return el instanceof HTMLVideoElement ? el.currentTime : null;
}

/** The part of the clip that is playing for this record: its normal span, or its change map. */
export function activeSegment(id: RecordId): [number, number] | null {
  const tl = RECORD_BY_ID[id].timeline;
  const el = layers.get(id)?.el;
  if (!tl || !(el instanceof HTMLVideoElement)) return null;
  if (tl.change && getState().changeView[id]) return tl.change.segment;
  return tl.segment ?? [0, el.duration || tl.anchors[tl.anchors.length - 1][0]];
}

/** The real date shown at clip second t (straight lines between the anchors). */
export function dateAt(id: RecordId, t: number): Date | null {
  const a = RECORD_BY_ID[id].timeline?.anchors;
  if (!a?.length) return null;
  if (t <= a[0][0]) return new Date(a[0][1]);
  for (let i = 1; i < a.length; i++) {
    if (t <= a[i][0]) {
      const [t0, d0] = a[i - 1];
      const [t1, d1] = a[i];
      const f = (t - t0) / (t1 - t0 || 1);
      const m0 = Date.parse(d0);
      return new Date(m0 + f * (Date.parse(d1) - m0));
    }
  }
  return new Date(a[a.length - 1][1]);
}

/** A date as this record shows it: "2019", "Mar 2019" or "7 Nov, 03:00 UTC". */
export function formatDate(id: RecordId, d: Date): string {
  switch (RECORD_BY_ID[id].timeline?.unit) {
    case 'year':
      return String(d.getUTCFullYear());
    case 'month':
      return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    default:
      return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${String(d.getUTCHours()).padStart(2, '0')}:00 UTC`;
  }
}

/** What the record shows right now: its date, or its change map, or its fixed period. */
export function nowLabel(id: RecordId): string {
  const rec = RECORD_BY_ID[id];
  if (rec.timeline?.change && getState().changeView[id]) return rec.timeline.change.label;
  const t = clipTime(id);
  const d = t == null ? null : dateAt(id, t);
  return d ? formatDate(id, d) : rec.period.replace(/\s*\(.*\)/, '');
}

/** Where the clip is inside its segment, 0-1 (for the scrubber). */
export function progress(id: RecordId): number {
  const seg = activeSegment(id);
  const t = clipTime(id);
  if (!seg || t == null) return 0;
  return Math.max(0, Math.min(1, (t - seg[0]) / (seg[1] - seg[0])));
}

/** Jump to a point of the record's timeline (0-1). The frame is read for sound right away. */
export function seekTo(id: RecordId, p: number) {
  const seg = activeSegment(id);
  const el = layers.get(id)?.el;
  if (!seg || !(el instanceof HTMLVideoElement)) return;
  el.currentTime = seg[0] + Math.max(0, Math.min(0.999, p)) * (seg[1] - seg[0]);
  const l = layers.get(id);
  if (l) l.sampledAt = 0;
}

/** Hold a record at one point of its timeline (or let it play again with null). */
export function hold(id: RecordId, p: number | null) {
  setState({ holds: { ...getState().holds, [id]: p } });
  if (p != null) seekTo(id, p);
}

/** City lights: switch between the years (2012 → 2023) and the map of what changed. */
export function setChangeView(id: RecordId, on: boolean) {
  const s = getState();
  setState({ changeView: { ...s.changeView, [id]: on }, holds: { ...s.holds, [id]: null } });
  const seg = activeSegment(id);
  const el = layers.get(id)?.el;
  if (seg && el instanceof HTMLVideoElement) el.currentTime = on ? seg[0] + (seg[1] - seg[0]) * 0.4 : seg[0];
  const l = layers.get(id);
  if (l) l.sampledAt = 0;
}

/** Keep each clip inside its segment (a loop over just that part). Call often. */
export function keepInSegment() {
  for (const [id, l] of layers) {
    const el = l.el;
    if (!(el instanceof HTMLVideoElement) || !RECORD_BY_ID[id].timeline) continue;
    const seg = activeSegment(id);
    if (!seg) continue;
    const h = getState().holds[id];
    if (h != null) {
      const want = seg[0] + h * (seg[1] - seg[0]);
      if (Math.abs(el.currentTime - want) > 0.2) el.currentTime = want;
      if (!el.paused) el.pause();
      continue;
    }
    if (el.currentTime < seg[0] - 0.05 || el.currentTime > seg[1]) el.currentTime = seg[0];
  }
}

/** "Then" and "now" for a record: the first and last year of its normal timeline. */
export function thenNow(id: RecordId): { then: string; now: string } | null {
  const tl = RECORD_BY_ID[id].timeline;
  if (!tl || tl.unit !== 'year') return null;
  const seg = tl.segment ?? [tl.anchors[0][0], tl.anchors[tl.anchors.length - 1][0]];
  const first = dateAt(id, seg[0] + 0.2);
  const last = dateAt(id, seg[1] - 0.2);
  return first && last ? { then: formatDate(id, first), now: formatDate(id, last) } : null;
}

/** The "then" and "now" points (0-1 of the segment) for a record with years. */
export function thenNowPoints(id: RecordId): { then: number; now: number } | null {
  const tl = RECORD_BY_ID[id].timeline;
  if (!tl || tl.unit !== 'year') return null;
  const a = tl.anchors;
  const seg = tl.segment ?? [a[0][0], a[a.length - 1][0]];
  const lastDate = a[a.length - 1][1];
  const reached = a.find(([, d]) => d === lastDate)![0]; // the clip reaches its last year here, then holds it
  const at = (t: number) => (t - seg[0]) / (seg[1] - seg[0]);
  // a little into the first year (temperature moves 0.4 s a year, city lights about 1 s)
  const perYear = (a[1][0] - a[0][0]) / Math.max(1, new Date(a[1][1]).getUTCFullYear() - new Date(a[0][1]).getUTCFullYear());
  return { then: at(seg[0] + Math.min(0.5, perYear * 0.4)), now: at(Math.min(seg[1] - 0.2, reached + 1)) };
}

/** Hold the record on its first ("then") or last ("now") year, or let it play again. Returns what to say. */
export function showYear(id: RecordId, which: 'then' | 'now', toggle = false): string | null {
  const pts = thenNowPoints(id);
  const tn = thenNow(id);
  if (!pts || !tn) return null;
  const s = getState();
  const short = RECORD_BY_ID[id].short;
  if (s.changeView[id]) setChangeView(id, false);
  const p = pts[which];
  if (toggle && !s.changeView[id] && s.holds[id] === p) {
    hold(id, null);
    return `${short} playing`;
  }
  hold(id, p);
  return `${short}, ${tn[which]}`;
}

/** Switch a record to its "what changed" map (or back). Returns what to say. */
export function showChange(id: RecordId, on: boolean): string | null {
  const tl = RECORD_BY_ID[id].timeline;
  if (!tl?.change) return null;
  setChangeView(id, on);
  const short = RECORD_BY_ID[id].short;
  return on
    ? `${short}: ${tl.change.label.replace('→', 'to')}. High notes mean ${tl.change.scale.high}, low notes mean ${tl.change.scale.low}.`
    : `${short}: back to the years`;
}

/** Step a record's timeline back or forward by a twentieth, holding it there. */
export function stepTime(id: RecordId, dir: 1 | -1): string | null {
  if (!activeSegment(id)) return null;
  const p = Math.max(0, Math.min(0.999, progress(id) + dir * 0.05));
  hold(id, p);
  return nowLabel(id);
}
