// Generates fake data in the agreed data format, so the frontend can be built
// before the real pipeline output exists. Output: public/data/mock/
//
//   index.json                     layer list and metadata (see src/data/contract.ts)
//   <layer>/yearly.bin             Uint8 [year][row][col], 0-254 = value, 255 = no data
//   <layer>/monthly_<year>.bin     Uint8 [month][row][col], same layout (2000-now only)
//
// Grid: 2 degrees, 90 rows x 180 cols. Row 0 is the band 90N-88N, col 0 is 180W-178W.
// The real pipeline must write exactly this layout to public/data/.

import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { geoContains } from 'd3-geo';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);
const land110 = require('world-atlas/land-110m.json');
const land = feature(land110, land110.objects.land);

const OUT = new URL('../public/data/mock/', import.meta.url);
const ROWS = 90;
const COLS = 180;
const RES = 2;
const NOW = 2026;
const NO_DATA = 255;

const latOf = (r) => 90 - RES / 2 - r * RES;
const lonOf = (c) => -180 + RES / 2 + c * RES;

console.log('Building land mask...');
const isLand = new Uint8Array(ROWS * COLS);
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    isLand[r * COLS + c] = geoContains(land, [lonOf(c), latOf(r)]) ? 1 : 0;
  }
}

// Great-circle-ish distance in degrees, good enough for blobs.
function dist(lat1, lon1, lat2, lon2) {
  let dLon = Math.abs(lon1 - lon2);
  if (dLon > 180) dLon = 360 - dLon;
  const dLat = lat1 - lat2;
  return Math.sqrt(dLat * dLat + (dLon * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180))) ** 2);
}
const blob = (lat, lon, cLat, cLon, radius) => Math.exp(-((dist(lat, lon, cLat, cLon) / radius) ** 2));
const clamp01 = (v) => Math.max(0, Math.min(1, v));
// Month as a fraction of the year, 0 = mid January.
const season = (m) => Math.cos(((m - 6.5) / 12) * 2 * Math.PI); // +1 in July, -1 in January

const CITIES = [
  // lat, lon, base strength, trend per year (+ growing, - shrinking)
  [39.9, 116.4, 1.0, 0.004], [31.2, 121.5, 0.9, 0.004], [34.0, 113.0, 0.8, 0.004],
  [28.6, 77.2, 0.8, 0.012], [23.0, 88.0, 0.5, 0.012], [19.0, 73.0, 0.5, 0.01],
  [34.0, -118.2, 0.8, -0.012], [40.7, -74.0, 0.8, -0.012], [41.9, -87.6, 0.6, -0.012],
  [51.5, 0.0, 0.7, -0.012], [51.0, 6.8, 0.8, -0.012], [48.8, 2.3, 0.6, -0.012],
  [35.7, 51.4, 0.6, 0.006], [26.1, 50.5, 0.5, 0.008], [25.3, 51.5, 0.5, 0.008], [25.2, 55.3, 0.6, 0.008],
  [30.0, 31.2, 0.5, 0.006], [55.8, 37.6, 0.6, -0.004], [35.7, 139.7, 0.8, -0.008],
  [19.4, -99.1, 0.6, 0.0], [-23.5, -46.6, 0.6, 0.0], [-26.2, 28.0, 0.7, 0.0],
];

const FIRE_ZONES = [
  // lat, lon, radius, peak month (1-12), width in months, strength
  [8, 20, 10, 1, 2.0, 1.0], [-12, 22, 10, 8, 2.0, 1.0], [-8, -60, 9, 8.5, 1.5, 1.0],
  [18, 100, 7, 3, 1.5, 0.7], [-25, 140, 12, 12.5, 2.0, 0.6], [62, 110, 12, 7, 1.5, 0.5],
  [40, -120, 6, 8, 1.5, 0.4],
];

const GYRES = [
  [32, -145, 14, 1.0], [30, -50, 13, 0.7], [-30, -100, 14, 0.6], [-30, -15, 12, 0.5], [-30, 75, 13, 0.6],
];

const monthDiff = (a, b) => {
  let d = Math.abs(a - b);
  return d > 6 ? 12 - d : d;
};

// Each layer: value(lat, lon, land, year, month) -> 0..1 or null (no data).
// month is 1-12, or null for the yearly average.
const LAYERS = [
  {
    id: 'ocean', record: 'ocean', side: 'earth', units: 'deg C (mock)', min: -2, max: 32,
    startYear: 1993, monthlyFrom: 2000,
    value: (lat, lon, isL, year, month) => {
      if (isL) return null;
      const s = month == null ? 0 : season(month) * Math.sign(lat) * 0.08;
      const warming = (year - 1993) * 0.002;
      return clamp01(Math.cos((lat * Math.PI) / 180) ** 1.6 + s + warming - 0.05);
    },
  },
  {
    id: 'plants', record: 'plants', side: 'earth', units: 'NDVI (mock)', min: -0.2, max: 1,
    startYear: 2000, monthlyFrom: 2000,
    value: (lat, lon, isL, year, month) => {
      if (!isL) return null;
      const tropics = Math.exp(-((lat / 14) ** 2)) * 0.9;
      const s = month == null ? 0.5 : (season(month) * Math.sign(lat) + 1) / 2;
      const temperate = Math.abs(lat) > 25 && Math.abs(lat) < 65 ? 0.25 + 0.55 * s : 0;
      const desert = blob(lat, lon, 23, 13, 14) + blob(lat, lon, 24, 47, 9) + blob(lat, lon, -25, 130, 10) * 0.6;
      const amazonLoss = blob(lat, lon, -8, -60, 8) * (year - 2000) * 0.004;
      return clamp01(tropics + temperate - desert * 0.9 - amazonLoss);
    },
  },
  {
    id: 'rain', record: 'rain', side: 'earth', units: 'mm/day (mock)', min: 0, max: 20,
    startYear: 1979, monthlyFrom: 2000,
    value: (lat, lon, isL, year, month) => {
      const shift = month == null ? 0 : season(month) * 8;
      const itcz = Math.exp(-(((lat - shift) / 7) ** 2));
      const monsoon = month == null ? 0.3 : clamp01(season(month)) * blob(lat, lon, 20, 82, 10) * 1.2;
      const storms = 0.25 * Math.exp(-(((Math.abs(lat) - 45) / 10) ** 2));
      return clamp01(itcz * 0.9 + monsoon + storms);
    },
  },
  {
    id: 'no2', record: 'no2', side: 'human', units: '1e15 molec/cm2 (mock)', min: 0, max: 20,
    startYear: 1990, monthlyFrom: 2004,
    value: (lat, lon, isL, year, month) => {
      if (month != null && Math.abs(lat) > 60 && season(month) * Math.sign(lat) < 0) return null; // polar night gap
      let v = 0;
      for (const [cLat, cLon, base, trend] of CITIES) {
        const strength = clamp01(base + trend * (year - 2005));
        v += strength * blob(lat, lon, cLat, cLon, 4.5);
      }
      const winter = month == null ? 0 : -season(month) * Math.sign(lat) * 0.1; // more NO2 in winter
      return clamp01(v * (1 + winter));
    },
  },
  {
    id: 'fires', record: 'fires', side: 'human', units: 'fires per cell (mock)', min: 0, max: 400,
    startYear: 2001, monthlyFrom: 2001,
    value: (lat, lon, isL, year, month) => {
      if (!isL) return 0;
      let v = 0;
      for (const [cLat, cLon, radius, peak, width, strength] of FIRE_ZONES) {
        const timing = month == null ? 0.35 : Math.exp(-((monthDiff(month, peak) / width) ** 2));
        const yearBoost = cLat < 0 && cLon < -40 && year === 2019 ? 1.4 : cLat < -20 && year === 2019 ? 1.6 : 1;
        v += strength * timing * yearBoost * blob(lat, lon, cLat, cLon, radius);
      }
      return clamp01(v);
    },
  },
  {
    id: 'plastic', record: 'plastic', side: 'human', units: 'pieces/km2 (mock)', min: 0, max: 1e6,
    startYear: 2018, monthlyFrom: 2018,
    value: (lat, lon, isL) => {
      if (isL || Math.abs(lat) > 37.4) return null;
      let v = 0;
      for (const [cLat, cLon, radius, strength] of GYRES) v += strength * blob(lat, lon, cLat, cLon, radius);
      return clamp01(v);
    },
  },
  {
    id: 'temperature', record: null, side: 'prologue', units: 'deg C anomaly vs 1951-1980 (mock)', min: -2, max: 4,
    startYear: 1950, monthlyFrom: null,
    value: (lat, lon, isL, year) => {
      const trend = Math.max(0, year - 1975) * 0.019 + Math.sin(year * 1.7) * 0.05;
      const polar = 1 + Math.abs(lat) / 45;
      return clamp01((trend * polar + 2) / 6);
    },
  },
];

const encode = (v) => (v == null ? NO_DATA : Math.round(clamp01(v) * 254));

function grid(layer, year, month) {
  const out = new Uint8Array(ROWS * COLS);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      out[i] = encode(layer.value(latOf(r), lonOf(c), isLand[i] === 1, year, month));
    }
  }
  return out;
}

const index = {
  version: 1,
  grid: { resolutionDeg: RES, rows: ROWS, cols: COLS, rowOrder: 'north-to-south', colOrder: 'west-to-east', noData: NO_DATA },
  mock: true,
  layers: [],
};

for (const layer of LAYERS) {
  const dir = new URL(`${layer.id}/`, OUT);
  mkdirSync(dir, { recursive: true });
  const years = [];
  for (let y = layer.startYear; y <= NOW; y++) years.push(y);
  const yearly = new Uint8Array(years.length * ROWS * COLS);
  years.forEach((y, t) => yearly.set(grid(layer, y, null), t * ROWS * COLS));
  writeFileSync(new URL('yearly.bin', dir), yearly);

  const monthlyYears = [];
  if (layer.monthlyFrom != null) {
    for (let y = Math.max(layer.monthlyFrom, layer.startYear); y <= NOW; y++) {
      const monthly = new Uint8Array(12 * ROWS * COLS);
      for (let m = 1; m <= 12; m++) monthly.set(grid(layer, y, m), (m - 1) * ROWS * COLS);
      writeFileSync(new URL(`monthly_${y}.bin`, dir), monthly);
      monthlyYears.push(y);
    }
  }

  index.layers.push({
    id: layer.id,
    record: layer.record,
    side: layer.side,
    units: layer.units,
    min: layer.min,
    max: layer.max,
    years,
    monthlyYears,
    source: 'MOCK DATA - replace with pipeline output',
  });
  console.log(`  ${layer.id}: ${years[0]}-${years[years.length - 1]}, monthly for ${monthlyYears.length} years`);
}

writeFileSync(new URL('index.json', OUT), JSON.stringify(index, null, 2));
console.log('Done: public/data/mock/');
