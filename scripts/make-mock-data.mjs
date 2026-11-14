// Generates realistic-looking FAKE data in the agreed data format, so the frontend can be
// built and demoed before the real pipeline output exists. Output: public/data/mock/
//
//   index.json                     layer list and metadata (see src/data/contract.ts)
//   <layer>/yearly.bin             Uint8 [year][row][col], 0-254 = value, 255 = no data
//   <layer>/monthly_<year>.bin     Uint8 [month][row][col], same layout
//
// Grid: 2 degrees, 90 rows x 180 cols. Row 0 is the band 90N-88N, col 0 is 180W-178W.
//
// The patterns copy the shapes of the real NASA products (where things are, which months they
// peak, known events like the 2019-20 Australian fires or the 2015 El Nino), so the map and the
// music behave like the real thing. They are still made up: never present them as NASA data.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { geoContains } from 'd3-geo';
import { feature } from 'topojson-client';
import jpeg from 'jpeg-js';

const require = createRequire(import.meta.url);
const land110 = require('world-atlas/land-110m.json');
const land = feature(land110, land110.objects.land);

const OUT = new URL('../public/data/mock/', import.meta.url);
const ROWS = 90;
const COLS = 180;
const CELLS = ROWS * COLS;
const RES = 2;
const NOW = 2026;
const NO_DATA = 255;
const D2R = Math.PI / 180;

const latOf = (r) => 90 - RES / 2 - r * RES;
const lonOf = (c) => -180 + RES / 2 + c * RES;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ---------- static fields ----------
const LAT = new Float32Array(CELLS);
const LON = new Float32Array(CELLS);
const X = new Float32Array(CELLS);
const Y = new Float32Array(CELLS);
const Z = new Float32Array(CELLS);
const LAND = new Uint8Array(CELLS);
console.log('Building land mask...');
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const i = r * COLS + c;
    const lat = latOf(r);
    const lon = lonOf(c);
    LAT[i] = lat;
    LON[i] = lon;
    X[i] = Math.cos(lat * D2R) * Math.cos(lon * D2R);
    Y[i] = Math.cos(lat * D2R) * Math.sin(lon * D2R);
    Z[i] = Math.sin(lat * D2R);
    LAND[i] = geoContains(land, [lon, lat]) ? 1 : 0;
  }
}

// Vegetation and snow, read from the NASA Blue Marble base map (used only to shape mock NDVI).
console.log('Reading Blue Marble for vegetation shapes...');
const bm = jpeg.decode(readFileSync(new URL('../public/basemap/blue-marble.jpg', import.meta.url)), { useTArray: true, maxMemoryUsageInMB: 1024 });
const GREEN = new Float32Array(CELLS);
const ICE = new Float32Array(CELLS);
{
  const pxW = bm.width / COLS;
  const pxH = bm.height / ROWS;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      let g = 0;
      let ice = 0;
      let n = 0;
      for (let y = Math.floor(r * pxH); y < Math.floor((r + 1) * pxH); y += 2) {
        for (let x = Math.floor(c * pxW); x < Math.floor((c + 1) * pxW); x += 2) {
          const o = (y * bm.width + x) * 4;
          const R = bm.data[o];
          const G = bm.data[o + 1];
          const B = bm.data[o + 2];
          const bright = (R + G + B) / 765;
          const isIce = bright > 0.7 && Math.abs(R - B) < 40 ? 1 : 0;
          // Dark green = forest, tan = desert, grey-white = ice.
          const greenness = (G - R) / (G + R + 1) * 3 + (1 - bright) * 0.9 - 0.25;
          g += isIce ? 0 : greenness;
          ice += isIce;
          n++;
        }
      }
      GREEN[r * COLS + c] = g / n;
      ICE[r * COLS + c] = ice / n;
    }
  }
}

// ---------- noise (3D value noise on the sphere, so there is no seam at 180 degrees) ----------
function hash(x, y, z, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440662683) + Math.imul(s, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const fade = (t) => t * t * (3 - 2 * t);
function vnoise(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  let v = 0;
  for (let dz = 0; dz <= 1; dz++)
    for (let dy = 0; dy <= 1; dy++)
      for (let dx = 0; dx <= 1; dx++) {
        const w = (dx ? xf : 1 - xf) * (dy ? yf : 1 - yf) * (dz ? zf : 1 - zf);
        v += w * hash(xi + dx, yi + dy, zi + dz, s);
      }
  return v;
}
/** Fractal noise field, 0..1, for one seed. freq ~ features per Earth radius. */
function noiseField(seed, freq, octaves = 4) {
  const out = new Float32Array(CELLS);
  for (let i = 0; i < CELLS; i++) {
    let a = 0.5, f = freq, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += a * vnoise(X[i] * f + 17.3, Y[i] * f + 4.1, Z[i] * f + 9.7, seed + o * 101);
      norm += a;
      a *= 0.5;
      f *= 2.03;
    }
    out[i] = sum / norm;
  }
  return out;
}
const noiseCache = new Map();
const noise = (seed, freq, oct) => {
  const k = `${seed}|${freq}|${oct}`;
  if (!noiseCache.has(k)) {
    if (noiseCache.size > 40) noiseCache.delete(noiseCache.keys().next().value);
    noiseCache.set(k, noiseField(seed, freq, oct));
  }
  return noiseCache.get(k);
};

// ---------- shapes ----------
function dLon(a, b) {
  let d = a - b;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}
/** Elliptical Gaussian bump. latR/lonR in degrees. */
function bump(lat, lon, cLat, cLon, latR, lonR = latR) {
  const dy = (lat - cLat) / latR;
  const dx = dLon(lon, cLon) / lonR;
  return Math.exp(-(dx * dx + dy * dy));
}
function kernel(cLat, cLon, latR, lonR = latR) {
  const k = new Float32Array(CELLS);
  for (let i = 0; i < CELLS; i++) k[i] = bump(LAT[i], LON[i], cLat, cLon, latR, lonR);
  return k;
}
/** Pollution plume: blown east in the mid-latitude westerlies, west in the trade winds. */
function plume(cLat, cLon, r) {
  const dir = Math.abs(cLat) > 28 ? 1 : -1;
  const k = new Float32Array(CELLS);
  const cosLat = Math.cos(cLat * D2R);
  for (let i = 0; i < CELLS; i++) {
    const dx = dLon(LON[i], cLon) * cosLat;
    const dy = LAT[i] - cLat;
    const along = dx * dir;
    const len = along > 0 ? r * 2.6 : r; // longer tail downwind
    k[i] = Math.exp(-((along / len) ** 2 + (dy / r) ** 2));
  }
  return k;
}
const season = (m) => Math.cos(((m - 7) / 12) * 2 * Math.PI); // +1 in July, -1 in January (m = 1..12)
const monthDist = (a, b) => {
  const d = Math.abs(a - b) % 12;
  return Math.min(d, 12 - d);
};
// ENSO: + El Nino, - La Nina (rough, by year)
const ENSO = { 1982: 1, 1983: 0.8, 1987: 0.6, 1991: 0.5, 1994: 0.4, 1997: 1, 1998: 0.6, 1999: -0.6, 2000: -0.5, 2002: 0.4, 2007: -0.5, 2008: -0.5, 2009: 0.5, 2010: -0.6, 2011: -0.6, 2015: 1, 2016: 0.5, 2018: -0.3, 2020: -0.5, 2021: -0.6, 2022: -0.6, 2023: 0.9, 2024: 0.4 };
const enso = (y) => ENSO[y] ?? 0;

// ---------- layers ----------
// Each layer returns a Float32Array grid of 0..1 values (NaN = no data) for (year, month 1-12).

function maxOf(kernels) {
  const out = new Float32Array(CELLS);
  for (const k of kernels) for (let i = 0; i < CELLS; i++) out[i] = Math.max(out[i], k[i]);
  return out;
}
const OCEAN_K = {
  warmPool: kernel(5, 150, 12, 30),
  gulfStream: maxOf([[30, -78], [35, -71], [39, -62], [43, -50], [47, -38]].map(([a, b]) => kernel(a, b, 3, 7))),
  kuroshio: maxOf([[27, 128], [32, 136], [35, 145], [37, 155]].map(([a, b]) => kernel(a, b, 3, 7))),
  nAtlDrift: kernel(58, -10, 8, 20),
  humboldt: kernel(-16, -77, 10, 5),
  coldTongue: kernel(-1, -110, 4, 30),
  california: kernel(33, -123, 6, 5),
  benguela: kernel(-22, 11, 7, 5),
  canary: kernel(23, -19, 6, 5),
  somali: kernel(9, 53, 5, 5),
  gulfs: kernel(25, 50, 6, 10),
  ninoBox: kernel(0, -125, 8, 40),
};
function ocean(year, month) {
  const out = new Float32Array(CELLS).fill(NaN);
  const s = season(month);
  const n = noise(1000 + year * 13 + month, 3.2, 4);
  const e = enso(year);
  const K = OCEAN_K;
  for (let i = 0; i < CELLS; i++) {
    if (LAND[i]) continue;
    const lat = LAT[i];
    const absLat = Math.abs(lat);
    let t = -1.6 + 30 * Math.cos(lat * D2R) ** 1.45;
    t += 1.5 * K.warmPool[i];
    t += 6 * K.gulfStream[i] + 5 * K.kuroshio[i];
    t += 4 * K.nAtlDrift[i];
    t -= 5 * K.humboldt[i] + 3 * K.coldTongue[i] * (1 - Math.max(0, e)) + 3 * K.california[i] + 4.5 * K.benguela[i] + 2.5 * K.canary[i];
    t -= 4 * K.somali[i] * Math.max(0, s);
    t += K.gulfs[i] * (2 + 4 * s); // the Gulf and Red Sea bake in summer
    t += 2.6 * e * K.ninoBox[i];
    t += s * Math.sign(lat) * 4 * Math.sin(Math.min(absLat, 60) * 1.5 * D2R); // seasons, strongest mid-latitudes
    t += 0.022 * (year - 1993); // warming
    if (year >= 2023) t += 0.35; // record-warm oceans of 2023-24
    t += (n[i] - 0.5) * 2.4; // eddies
    if ((lat > 72 || lat < -62) && t < -1.2) t = -1.8; // sea ice
    out[i] = clamp01((t + 2) / 34);
  }
  return out;
}

const PLANT_K = {
  amazonArc: kernel(-10, -56, 4, 10),
  sahel: kernel(13, 5, 4, 28),
  chinaIndia: [kernel(32, 112, 7, 10), kernel(24, 79, 6, 8)],
  europe2003: kernel(46, 3, 6, 10),
  russia2010: kernel(53, 45, 6, 12),
  usMidwest2012: kernel(40, -92, 5, 10),
  europe2022: kernel(46, 5, 7, 14),
};
function plants(year, month) {
  const out = new Float32Array(CELLS).fill(NaN);
  const s = season(month);
  const n = noise(2000 + year, 6, 3);
  const K = PLANT_K;
  for (let i = 0; i < CELLS; i++) {
    if (!LAND[i]) continue;
    const lat = LAT[i];
    const absLat = Math.abs(lat);
    if (ICE[i] > 0.3 || lat < -62) {
      out[i] = 0; // ice sheets: no plants (NDVI at the bottom of the scale)
      continue;
    }
    const base = clamp01((GREEN[i] + 0.15) / 0.75);
    const local = (s * Math.sign(lat) + 1) / 2; // 1 in local summer
    let v;
    if (absLat > 23) {
      const amp = Math.min(1, (absLat - 23) / 22); // seasons matter more further from the equator
      v = base * (1 - amp * 0.92 * (1 - local ** 1.5)); // winter: dormant or under snow
    } else v = base * (0.9 + 0.1 * local);
    v += 0.35 * K.sahel[i] * Math.exp(-((monthDist(month, 8.5) / 1.6) ** 2)); // Sahel greens in the rains
    v -= 0.006 * Math.max(0, year - 2000) * K.amazonArc[i] * (0.5 + n[i]); // deforestation
    v += 0.0025 * Math.max(0, year - 2000) * (K.chinaIndia[0][i] + K.chinaIndia[1][i]) * 0.6; // greening
    const summer = Math.exp(-((monthDist(month, 7.5) / 1.3) ** 2));
    if (year === 2003) v -= 0.25 * K.europe2003[i] * summer;
    if (year === 2010) v -= 0.25 * K.russia2010[i] * summer;
    if (year === 2012) v -= 0.25 * K.usMidwest2012[i] * summer;
    if (year === 2022) v -= 0.2 * K.europe2022[i] * summer;
    v += (n[i] - 0.5) * 0.12;
    out[i] = clamp01(0.12 + v * 0.88); // NDVI -0.2..1 -> bare ground sits near 0.12
  }
  return out;
}

const RAIN_K = {
  amazon: kernel(-4, -62, 8, 12), congo: kernel(0, 20, 7, 10), maritime: kernel(0, 115, 8, 20),
  india: kernel(21, 80, 7, 9), bengal: kernel(21, 92, 5, 6), meiyu: kernel(30, 120, 4, 18),
  westAfrica: kernel(9, -5, 5, 12), nAtlTrack: kernel(52, -30, 7, 30), nPacTrack: kernel(45, -170, 7, 40),
  dry: [
    [kernel(23, 10, 9, 22), 1], [kernel(22, 47, 7, 10), 1], [kernel(-24, -70, 6, 4), 1], [kernel(-25, 132, 8, 12), 0.8],
    [kernel(-20, -100, 14, 30), 0.9], [kernel(-20, -5, 10, 18), 0.8], [kernel(25, -130, 8, 25), 0.7], [kernel(42, 100, 6, 14), 0.8],
    [kernel(33, -112, 5, 7), 0.7], [kernel(-24, 20, 6, 7), 0.6], [kernel(27, 65, 6, 10), 0.8],
  ],
  enso: kernel(0, -150, 8, 35), ensoDry: kernel(-5, 125, 12, 25),
  spcz: maxOf([[-8, 160], [-12, 172], [-16, -175], [-20, -162], [-24, -150]].map(([a, b]) => kernel(a, b, 4, 10))),
};
function rain(year, month) {
  const out = new Float32Array(CELLS);
  const s = season(month);
  const cells = noise(3000 + year * 13 + month, 9, 3);
  const big = noise(3500 + year * 13 + month, 2.5, 2);
  const e = enso(year);
  const K = RAIN_K;
  for (let i = 0; i < CELLS; i++) {
    const lat = LAT[i];
    const isL = LAND[i];
    const centre = 6 + s * (isL ? 13 : 6) + (big[i] - 0.5) * 14; // the rain belt follows the sun, further over land, and meanders
    let p = 11 * Math.exp(-(((lat - centre) / (isL ? 9 : 5.5)) ** 2)) * (0.5 + big[i]);
    p += 6 * K.amazon[i] * (1 - 0.6 * Math.max(0, s)) + 6 * K.congo[i] + 7 * K.maritime[i] * (1 - 0.7 * Math.max(0, e));
    const monsoon = Math.max(0, s) ** 2;
    p += 18 * K.india[i] * monsoon + 16 * K.bengal[i] * monsoon + 9 * K.meiyu[i] * Math.exp(-((monthDist(month, 6.5) / 1) ** 2));
    p += 9 * K.westAfrica[i] * monsoon;
    const winterN = Math.max(0, -s);
    p += (2 + 4 * winterN) * K.nAtlTrack[i] * (0.4 + 1.2 * big[i]) + (2 + 4 * winterN) * K.nPacTrack[i] * (0.4 + 1.2 * big[i]);
    if (lat < -38 && !isL) p += (2.2 + 1.2 * Math.max(0, s)) * Math.exp(-(((lat + 50) / 8) ** 2)) * (0.3 + 1.4 * big[i]); // Southern Ocean
    p += 6 * K.spcz[i] * (1 + 0.5 * Math.max(0, -s)); // South Pacific Convergence Zone
    p += 7 * e * K.enso[i];
    let dry = 0;
    for (const [k, w] of K.dry) dry = Math.max(dry, k[i] * w);
    p *= 1 - 0.95 * dry;
    p *= 0.1 + 2.1 * cells[i] ** 1.8 * (0.3 + 1.2 * big[i]); // storms are patchy
    if (Math.abs(lat) > 70) p *= 0.3;
    out[i] = clamp01(p / 22) ** 0.85;
  }
  return out;
}

// NO2: cities and industrial regions, with the real trends of each region.
// [lat, lon, strength, size (deg), region]
const SOURCES = [
  [36.5, 115.5, 1.0, 3.5, 'cn'], [31.2, 120.8, 0.85, 2.5, 'cn'], [23.0, 113.3, 0.6, 2, 'cn'], [30.5, 104.5, 0.4, 2.5, 'cn'],
  [39.9, 116.4, 0.6, 1.5, 'cn'], [41.8, 123.4, 0.45, 2, 'cn'], [34.7, 113.6, 0.6, 2.5, 'cn'], [30.6, 114.3, 0.4, 2, 'cn'],
  [37.6, 127.0, 0.65, 1.5, 'kr'], [35.7, 139.8, 0.7, 1.8, 'jp'], [34.7, 135.5, 0.45, 1.5, 'jp'], [25.0, 121.5, 0.4, 1.2, 'jp'],
  [28.6, 77.2, 0.55, 2, 'in'], [26.5, 82.0, 0.35, 4, 'in'], [23.5, 87.0, 0.5, 2, 'in'], [22.0, 84.0, 0.45, 2, 'in'],
  [19.0, 73.0, 0.35, 1.5, 'in'], [24.9, 67.1, 0.3, 1.5, 'in'], [23.8, 90.4, 0.35, 1.5, 'in'], [13.7, 100.5, 0.3, 1.5, 'as'],
  [21.0, 105.8, 0.3, 1.5, 'as'], [10.8, 106.7, 0.3, 1.2, 'as'], [-6.2, 106.8, 0.4, 1.5, 'as'], [14.6, 121.0, 0.3, 1.2, 'as'],
  [1.3, 103.8, 0.3, 1, 'as'],
  [26.3, 50.2, 0.45, 1.5, 'me'], [29.3, 47.9, 0.4, 1.5, 'me'], [25.2, 55.3, 0.45, 1.5, 'me'], [25.3, 51.5, 0.35, 1, 'me'],
  [24.7, 46.7, 0.45, 1.5, 'me'], [35.7, 51.4, 0.6, 1.8, 'me'], [30.0, 31.2, 0.5, 1.5, 'me'], [41.0, 29.0, 0.45, 1.5, 'me'],
  [33.3, 44.4, 0.35, 1.5, 'me'], [21.5, 39.2, 0.3, 1.2, 'me'],
  [51.3, 6.5, 0.85, 2.5, 'eu'], [51.5, -0.1, 0.65, 1.8, 'eu'], [48.9, 2.3, 0.5, 1.5, 'eu'], [45.5, 9.5, 0.6, 2.5, 'eu'],
  [50.1, 19.5, 0.45, 2, 'eu'], [52.5, 13.4, 0.35, 1.5, 'eu'], [40.4, -3.7, 0.35, 1.2, 'eu'], [55.8, 37.6, 0.6, 2, 'ru'],
  [59.9, 30.3, 0.3, 1.5, 'ru'], [55.0, 61.0, 0.35, 2, 'ru'], [50.5, 30.5, 0.3, 1.5, 'ru'],
  [40.7, -74.0, 0.75, 2, 'us'], [39.5, -77.0, 0.5, 2.5, 'us'], [41.9, -87.7, 0.6, 2, 'us'], [40.0, -82.0, 0.55, 3, 'us'],
  [34.0, -118.2, 0.8, 1.8, 'us'], [29.8, -95.4, 0.45, 1.8, 'us'], [32.8, -96.8, 0.35, 1.5, 'us'], [37.7, -122.2, 0.35, 1.2, 'us'],
  [33.7, -84.4, 0.35, 1.5, 'us'], [43.7, -79.4, 0.35, 1.5, 'us'], [36.5, -108.5, 0.25, 1, 'us'],
  [19.4, -99.1, 0.6, 1.5, 'la'], [-23.6, -46.6, 0.55, 1.8, 'la'], [-22.9, -43.2, 0.35, 1.2, 'la'], [-34.6, -58.4, 0.35, 1.5, 'la'],
  [-33.4, -70.6, 0.4, 1.2, 'la'], [4.7, -74.1, 0.25, 1, 'la'], [-12.0, -77.0, 0.25, 1, 'la'],
  [-26.5, 29.2, 0.85, 2.2, 'za'], [6.5, 3.4, 0.3, 1.5, 'af'], [-1.3, 36.8, 0.2, 1, 'af'], [33.6, -7.6, 0.2, 1, 'af'],
  [-33.9, 151.2, 0.3, 1.2, 'au'], [-37.8, 145.0, 0.25, 1.2, 'au'],
];
const SHIPPING = [];
{
  const lanes = [
    [[1.5, 104], [5, 97], [6, 85], [9, 72], [12, 55], [13, 46], [20, 39], [29, 33], [33, 25], [36, 12], [36, -6]],
    [[1.5, 104], [8, 108], [16, 112], [22, 116], [28, 123], [33, 129]],
    [[36, -6], [43, -12], [48, -6], [51, 2]],
  ];
  for (const lane of lanes) {
    for (let j = 0; j < lane.length - 1; j++) {
      const [a1, b1] = lane[j];
      const [a2, b2] = lane[j + 1];
      const steps = Math.ceil(Math.hypot(a2 - a1, b2 - b1) / 2);
      for (let t = 0; t < steps; t++) SHIPPING.push(kernel(a1 + ((a2 - a1) * t) / steps, b1 + ((b2 - b1) * t) / steps, 1.3));
    }
  }
}
const SHIP_FIELD = new Float32Array(CELLS);
for (const k of SHIPPING) for (let i = 0; i < CELLS; i++) SHIP_FIELD[i] = Math.max(SHIP_FIELD[i], k[i]);
const NO2_K = SOURCES.map(([a, b, , r]) => plume(a, b, r));

function regionTrend(region, year, month) {
  const y = year + (month - 0.5) / 12;
  let f;
  switch (region) {
    case 'cn': f = y < 2011 ? 0.45 + 0.55 * clamp01((y - 1995) / 16) : 1 - 0.035 * (y - 2011); break;
    case 'us': case 'eu': case 'jp': f = 1.6 * Math.exp(-0.032 * (y - 1990)); break;
    case 'kr': f = 1.1 - 0.012 * (y - 2005); break;
    case 'in': f = 0.45 * Math.exp(0.03 * (y - 1990)); break;
    case 'me': f = 0.55 * Math.exp(0.022 * (y - 1990)); break;
    case 'ru': f = 1.05 - 0.008 * (y - 1990); break;
    case 'za': f = 0.9 + 0.006 * (y - 1990) - (y > 2015 ? 0.015 * (y - 2015) : 0); break;
    default: f = 0.7 * Math.exp(0.012 * (y - 1990));
  }
  // COVID-19 lockdowns
  if (year === 2020) {
    if (region === 'cn' && (month === 2 || month === 3)) f *= month === 2 ? 0.55 : 0.75;
    if (['eu', 'us', 'in', 'la', 'me', 'kr', 'jp'].includes(region) && month >= 3 && month <= 5) f *= month === 4 ? 0.65 : 0.8;
  }
  return Math.max(0.05, f);
}
function no2(year, month) {
  const out = new Float32Array(CELLS);
  const s = season(month);
  const n = noise(4000 + year * 13 + month, 5, 3);
  const weights = SOURCES.map(([, , strength, , region]) => strength * regionTrend(region, year, month));
  for (let k = 0; k < NO2_K.length; k++) {
    const K = NO2_K[k];
    const w = weights[k];
    for (let i = 0; i < CELLS; i++) out[i] += w * K[i];
  }
  const shipTrend = 0.07 * clamp01(0.5 + (year - 1995) / 40);
  for (let i = 0; i < CELLS; i++) {
    const lat = LAT[i];
    const winter = -s * Math.sign(lat); // +1 in local winter: more NO2 in the cold season
    let v = out[i] * (1 + 0.25 * winter * Math.min(1, Math.abs(lat) / 35));
    v += SHIP_FIELD[i] * shipTrend + 0.025 * (LAND[i] ? 1 : 0.3);
    v *= 0.8 + 0.4 * n[i];
    // the satellite can't see in polar night
    if (Math.abs(lat) > 58 && winter > 0.4 && Math.abs(lat) - 58 > (1 - winter) * 20) {
      out[i] = NaN;
      continue;
    }
    out[i] = clamp01(v) ** 0.8;
  }
  return out;
}

// Fires: [lat, lon, latR, lonR, peak month, width (months), strength, {year: boost}]
const FIRE_ZONES = [
  [9, 18, 4, 22, 1, 1.4, 1.0], [-11, 23, 5, 13, 8, 1.4, 1.0],
  [-10, -55, 4, 11, 9, 1.1, 0.8, { 2002: 1.3, 2004: 1.4, 2005: 1.4, 2007: 1.5, 2010: 1.5, 2019: 1.3, 2020: 1.3, 2024: 1.7 }],
  [-14, -46, 4, 6, 9, 1.2, 0.5], [19, 100, 3.5, 6, 3, 1, 0.8], [30.5, 75.5, 1.5, 3, 11, 0.7, 0.5],
  [-1, 108, 3, 9, 9, 1, 0.25, { 1997: 4, 2002: 2, 2004: 1.8, 2006: 2.6, 2009: 1.8, 2015: 4, 2019: 2.5, 2023: 2 }],
  [-15, 132, 3.5, 12, 9.5, 1.3, 0.7], [-34, 149, 3, 4, 12.5, 1, 0.08, { 2019: 9, 2020: 4 }],
  [62, 115, 5, 25, 7, 1.2, 0.22, { 2003: 2.5, 2012: 2, 2019: 2.5, 2020: 2.5, 2021: 3 }],
  [57, -112, 5, 25, 7, 1.2, 0.16, { 2016: 1.8, 2023: 6, 2024: 2 }],
  [39, -121, 3, 4, 8.5, 1, 0.12, { 2018: 3, 2020: 5, 2021: 3 }],
  [17, -91, 4, 6, 4, 1, 0.5], [50, 40, 3, 14, 4, 1.4, 0.25], [50, 65, 3, 10, 8, 1, 0.2], [-24, -61, 3.5, 4, 9, 1.1, 0.3],
  [12, 104, 3, 4, 2, 1, 0.5], [-20, 46, 3, 2, 10, 1.2, 0.4],
];
const GAS_FLARES = [[30.5, 47.5], [5, 6.5], [61, 73], [27, 50], [29.5, 48.5], [32, 13], [28, 2]];
const FIRE_K = FIRE_ZONES.map(([a, b, ar, br]) => kernel(a, b, ar, br));
const FLARE_K = GAS_FLARES.map(([a, b]) => kernel(a, b, 1.2));
function fires(year, month) {
  const out = new Float32Array(CELLS);
  const patches = noise(5000 + year * 13 + month, 11, 3);
  const regional = noise(5500 + year, 3, 2);
  for (let z = 0; z < FIRE_ZONES.length; z++) {
    const [, , , , peak, width, strength, boosts] = FIRE_ZONES[z];
    let w = strength * Math.exp(-((monthDist(month, peak) / width) ** 2));
    // a second, smaller season for cropland zones
    if (z === 5 && monthDist(month, 4.5) < 1.2) w += 0.3;
    if (boosts) {
      // A season peaking around New Year belongs to the year it started (Black Summer: Dec 2019 - Jan 2020).
      const seasonYear = peak > 11 && month <= 3 ? year - 1 : year;
      w *= boosts[seasonYear] ?? 1;
    }
    if (w < 0.01) continue;
    const K = FIRE_K[z];
    for (let i = 0; i < CELLS; i++) out[i] += w * K[i];
  }
  for (const K of FLARE_K) for (let i = 0; i < CELLS; i++) out[i] += 0.12 * K[i];
  for (let i = 0; i < CELLS; i++) {
    if (!LAND[i] || ICE[i] > 0.5) {
      out[i] = 0;
      continue;
    }
    const spotty = clamp01((patches[i] - 0.3) * 3) ** 1.2 * (0.6 + 0.8 * regional[i]);
    out[i] = clamp01(1 - Math.exp(-out[i] * spotty * 4.5));
  }
  return out;
}

const GYRES = [
  [32, -145, 8, 24, 1.0], [30, 150, 6, 14, 0.5], [30, -45, 8, 20, 0.7], [-30, -110, 8, 26, 0.6], [-30, -18, 7, 18, 0.5],
  [-28, 82, 8, 22, 0.6], [15, 115, 6, 6, 0.4], [14, 88, 5, 5, 0.3], [35, 18, 3, 12, 0.45], [22, 128, 6, 10, 0.35],
];
const GYRE_K = GYRES.map(([a, b, ar, br]) => kernel(a, b, ar, br));
function plastic(year, month) {
  const out = new Float32Array(CELLS).fill(NaN);
  const n = noise(6000 + year * 13 + month, 10, 3);
  const s = season(month);
  for (let i = 0; i < CELLS; i++) {
    if (LAND[i] || Math.abs(LAT[i]) > 37.4) continue; // CYGNSS only sees up to about 38 degrees
    let v = 0;
    for (let g = 0; g < GYRES.length; g++) v += GYRES[g][4] * GYRE_K[g][i];
    v *= 1 + 0.15 * s * Math.sign(LAT[i]) + 0.012 * (year - 2018);
    v = v * (0.3 + 1.4 * n[i] ** 1.3) + 0.04;
    out[i] = clamp01(v);
  }
  return out;
}

function temperature(year) {
  const out = new Float32Array(CELLS);
  const n = noise(7000 + year, 3, 3);
  const trend = Math.max(0, year - 1975) * 0.019 + Math.sin(year * 1.7) * 0.06 + 0.15 * enso(year);
  for (let i = 0; i < CELLS; i++) {
    const polar = 1 + Math.abs(LAT[i]) / 40 + (LAND[i] ? 0.3 : 0);
    out[i] = clamp01((trend * polar + (n[i] - 0.5) * 0.6 + 2) / 6);
  }
  return out;
}

const LAYERS = [
  { id: 'ocean', record: 'ocean', side: 'earth', units: 'deg C (mock)', min: -2, max: 32, startYear: 1993, monthlyFrom: 2000, fn: ocean },
  { id: 'plants', record: 'plants', side: 'earth', units: 'NDVI (mock)', min: -0.2, max: 1, startYear: 2000, monthlyFrom: 2000, fn: plants },
  { id: 'rain', record: 'rain', side: 'earth', units: 'mm/day (mock)', min: 0, max: 22, startYear: 1979, monthlyFrom: 2000, fn: rain },
  { id: 'no2', record: 'no2', side: 'human', units: '1e15 molec/cm2 (mock)', min: 0, max: 20, startYear: 1990, monthlyFrom: 2005, fn: no2 },
  { id: 'fires', record: 'fires', side: 'human', units: 'fires per cell (mock)', min: 0, max: 400, startYear: 2001, monthlyFrom: 2001, fn: fires },
  { id: 'plastic', record: 'plastic', side: 'human', units: 'pieces/km2 (mock)', min: 0, max: 1e6, startYear: 2018, monthlyFrom: 2018, fn: plastic },
  { id: 'temperature', record: null, side: 'prologue', units: 'deg C anomaly vs 1951-1980 (mock)', min: -2, max: 4, startYear: 1950, monthlyFrom: null, fn: null },
];

const encode = (grid) => {
  const out = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) out[i] = Number.isNaN(grid[i]) ? NO_DATA : Math.round(clamp01(grid[i]) * 254);
  return out;
};
/** Yearly value = mean of the 12 months (cells with no data in some months use the others). */
function yearMean(months) {
  const out = new Float32Array(CELLS);
  for (let i = 0; i < CELLS; i++) {
    let sum = 0;
    let n = 0;
    for (const m of months) {
      if (Number.isNaN(m[i])) continue;
      sum += m[i];
      n++;
    }
    out[i] = n ? sum / n : NaN;
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
  const t0 = Date.now();
  const dir = new URL(`${layer.id}/`, OUT);
  mkdirSync(dir, { recursive: true });
  const years = [];
  for (let y = layer.startYear; y <= NOW; y++) years.push(y);
  const yearly = new Uint8Array(years.length * CELLS);
  const monthlyYears = [];
  years.forEach((y, t) => {
    if (!layer.fn) {
      yearly.set(encode(temperature(y)), t * CELLS);
      return;
    }
    const months = [];
    for (let m = 1; m <= 12; m++) months.push(layer.fn(y, m));
    yearly.set(encode(yearMean(months)), t * CELLS);
    if (layer.monthlyFrom != null && y >= layer.monthlyFrom) {
      const monthly = new Uint8Array(12 * CELLS);
      months.forEach((g, m) => monthly.set(encode(g), m * CELLS));
      writeFileSync(new URL(`monthly_${y}.bin`, dir), monthly);
      monthlyYears.push(y);
    }
  });
  writeFileSync(new URL('yearly.bin', dir), yearly);
  index.layers.push({
    id: layer.id, record: layer.record, side: layer.side, units: layer.units, min: layer.min, max: layer.max,
    years, monthlyYears, source: 'MOCK DATA - shaped like the real NASA product, but made up. Replace with pipeline output.',
  });
  console.log(`  ${layer.id}: ${years[0]}-${years[years.length - 1]}, monthly for ${monthlyYears.length} years (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

writeFileSync(new URL('index.json', OUT), JSON.stringify(index, null, 2));
console.log('Done: public/data/mock/');
