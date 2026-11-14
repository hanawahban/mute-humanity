// How each record's NASA data is drawn on the map. Colours follow the conventions people
// already know from NASA maps: blue-to-red for sea temperature, brown-to-green for plants,
// blue-to-purple for rain, yellow-to-dark-red for pollution, glowing dots for fires.

import type { RecordId } from '../config/records';

/** [value 0-1, colour, opacity 0-1] */
export type Stop = [number, string, number];

export interface LayerStyle {
  kind: 'field' | 'dots';
  /** Clip to land or ocean, so a 2-degree grid still has sharp coastlines. */
  mask?: 'land' | 'ocean';
  ramp: Stop[];
  /** Dots: drawn on top of the field ramp (if any). */
  dots?: { colour: [inner: string, outer: string]; maxPerCell: number; size: number; glow: boolean; threshold: number };
  legend: { title: string; low: string; high: string };
}

export const LAYER_STYLES: Record<RecordId, LayerStyle> = {
  ocean: {
    kind: 'field',
    mask: 'ocean',
    ramp: [
      [0, '#0b1d51', 0.85], [0.25, '#1f5fa8', 0.85], [0.47, '#3fa3c9', 0.85], [0.63, '#8fd1b5', 0.85],
      [0.76, '#f6e58d', 0.85], [0.86, '#f39c45', 0.85], [0.94, '#d7472f', 0.85], [1, '#7a0b1c', 0.9],
    ],
    legend: { title: 'Sea surface temperature', low: 'cold', high: 'warm' },
  },
  plants: {
    kind: 'field',
    mask: 'land',
    ramp: [
      [0, '#8e8170', 0], [0.06, '#8e8170', 0.45], [0.15, '#a58b5a', 0.55], [0.3, '#c9b458', 0.62], [0.5, '#8fb33e', 0.72],
      [0.7, '#3f8f2f', 0.8], [0.9, '#145c22', 0.86], [1, '#0a3d17', 0.9],
    ],
    legend: { title: 'Plant greenness (NDVI)', low: 'bare', high: 'lush' },
  },
  rain: {
    kind: 'field',
    ramp: [
      [0, '#9fd3f5', 0], [0.08, '#9fd3f5', 0], [0.15, '#9fd3f5', 0.35], [0.3, '#3d8fe0', 0.6], [0.5, '#2147b8', 0.75],
      [0.7, '#6b2fb5', 0.85], [0.85, '#c22aa0', 0.9], [1, '#ffd6f2', 0.95],
    ],
    legend: { title: 'Rainfall', low: 'light', high: 'heavy' },
  },
  no2: {
    kind: 'field',
    ramp: [
      [0, '#fff3b0', 0], [0.09, '#fff3b0', 0], [0.16, '#ffe680', 0.35], [0.3, '#ffb347', 0.6], [0.5, '#f0642c', 0.78],
      [0.7, '#c41e1e', 0.88], [0.85, '#7d0a0a', 0.92], [1, '#450101', 0.95],
    ],
    legend: { title: 'NO₂ air pollution', low: 'clean', high: 'polluted' },
  },
  fires: {
    kind: 'dots',
    mask: 'land',
    ramp: [],
    dots: { colour: ['#fff2a8', '#ff5a1f'], maxPerCell: 5, size: 3, glow: true, threshold: 0.05 },
    legend: { title: 'Active fires', low: 'few', high: 'many' },
  },
  plastic: {
    kind: 'dots',
    mask: 'ocean',
    ramp: [[0, '#d8f3ff', 0], [0.15, '#d8f3ff', 0], [0.45, '#d8f3ff', 0.18], [1, '#ffffff', 0.4]],
    dots: { colour: ['#ffffff', '#bfe8ff'], maxPerCell: 6, size: 1.4, glow: false, threshold: 0.25 },
    legend: { title: 'Ocean microplastics', low: 'fewer', high: 'more' },
  },
};

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 255-entry RGBA lookup table for values 0-254. */
export function buildLut(ramp: Stop[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(255 * 4);
  if (!ramp.length) return lut;
  for (let i = 0; i < 255; i++) {
    const v = i / 254;
    let j = 0;
    while (j < ramp.length - 2 && v > ramp[j + 1][0]) j++;
    const [v0, c0, a0] = ramp[j];
    const [v1, c1, a1] = ramp[Math.min(j + 1, ramp.length - 1)];
    const t = v1 > v0 ? Math.max(0, Math.min(1, (v - v0) / (v1 - v0))) : 0;
    const p = hexToRgb(c0);
    const q = hexToRgb(c1);
    lut[i * 4] = p[0] + (q[0] - p[0]) * t;
    lut[i * 4 + 1] = p[1] + (q[1] - p[1]) * t;
    lut[i * 4 + 2] = p[2] + (q[2] - p[2]) * t;
    lut[i * 4 + 3] = (a0 + (a1 - a0) * t) * 255;
  }
  return lut;
}

/** CSS gradient for the legend. */
export function legendGradient(style: LayerStyle): string {
  if (style.kind === 'dots' && style.dots && !style.ramp.length) {
    return `linear-gradient(to right, ${style.dots.colour[1]}55, ${style.dots.colour[1]}, ${style.dots.colour[0]})`;
  }
  const visible = style.ramp.filter((s, i) => s[2] > 0 || i === style.ramp.length - 1);
  return `linear-gradient(to right, ${visible.map(([v, c, a]) => `${c}${Math.round(Math.max(a, 0.25) * 255).toString(16).padStart(2, '0')} ${Math.round(v * 100)}%`).join(', ')})`;
}
