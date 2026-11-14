import type { LoadedData, LoadedLayer } from './loader';

export const NO_DATA = 255;

export function cellCenter(data: LoadedData, row: number, col: number): [lat: number, lon: number] {
  const res = data.index.grid.resolutionDeg;
  return [90 - res / 2 - row * res, -180 + res / 2 + col * res];
}

function yearRange(layer: LoadedLayer): [number, number] {
  const ys = layer.meta.years;
  return [ys[0], ys[ys.length - 1]];
}

/** True if the layer has data for this (fractional) year. */
export function hasYear(layer: LoadedLayer, year: number): boolean {
  const [a, b] = yearRange(layer);
  return year >= a - 0.001 && year <= b + 0.999;
}

/**
 * Returns one grid (0-254, 255 = no data) for a layer at a fractional year, or at a month.
 * While dragging, values blend between the two nearest real years so the sound glides.
 * The year label in the UI always shows the real year.
 */
export function gridAt(data: LoadedData, layerId: string, year: number, month: number | null, out?: Uint8Array): Uint8Array | null {
  const layer = data.layers.get(layerId);
  if (!layer || !hasYear(layer, year)) return null;
  const cells = data.cells;
  const result = out ?? new Uint8Array(cells);

  if (month != null) {
    const monthly = layer.monthly.get(Math.floor(year));
    if (monthly) {
      result.set(monthly.subarray(month * cells, (month + 1) * cells));
      return result;
    }
  }

  const [first, last] = yearRange(layer);
  const y = Math.min(Math.max(year, first), last);
  const i0 = Math.floor(y) - first;
  const i1 = Math.min(i0 + 1, layer.meta.years.length - 1);
  const t = y - Math.floor(y);
  const a = layer.yearly.subarray(i0 * cells, (i0 + 1) * cells);
  const b = layer.yearly.subarray(i1 * cells, (i1 + 1) * cells);
  for (let i = 0; i < cells; i++) {
    const va = a[i];
    const vb = b[i];
    result[i] = va === NO_DATA || vb === NO_DATA ? (t < 0.5 ? va : vb) : Math.round(va + (vb - va) * t);
  }
  return result;
}

/**
 * Area-weighted average (0-1) of a grid within radiusDeg of a point, or null if no data.
 * Also returns the strongest cell value, used for "strong / medium / weak" captions.
 */
export function regionValue(
  data: LoadedData,
  grid: Uint8Array,
  lat: number,
  lon: number,
  radiusDeg: number,
): { mean: number; peak: number } | null {
  const { rows, cols, resolutionDeg: res } = data.index.grid;
  let sum = 0;
  let weight = 0;
  let peak = 0;
  const rowMin = Math.max(0, Math.floor((90 - (lat + radiusDeg)) / res));
  const rowMax = Math.min(rows - 1, Math.floor((90 - (lat - radiusDeg)) / res));
  for (let r = rowMin; r <= rowMax; r++) {
    const cLat = 90 - res / 2 - r * res;
    const cosLat = Math.cos((cLat * Math.PI) / 180);
    for (let c = 0; c < cols; c++) {
      const v = grid[r * cols + c];
      if (v === NO_DATA) continue;
      const cLon = -180 + res / 2 + c * res;
      let dLon = Math.abs(cLon - lon);
      if (dLon > 180) dLon = 360 - dLon;
      const d = Math.hypot(cLat - lat, dLon * cosLat);
      if (d > radiusDeg) continue;
      const w = cosLat * (1 - (d / radiusDeg) * 0.5);
      sum += (v / 254) * w;
      weight += w;
      if (v > peak) peak = v;
    }
  }
  if (weight === 0) return null;
  return { mean: sum / weight, peak: peak / 254 };
}

/** Radius of the listening area, from the whole planet (zoom 1) to about 8 degrees when zoomed in. */
export function listenRadius(zoom: number): number {
  if (zoom <= 1.2) return 180;
  return Math.max(8, 60 / zoom);
}
