// Land or water at a point, read from the bundled NASA Blue Marble base map (ocean is dark blue,
// shallow seas a lighter blue). Used to say "over the open ocean" or "over land" in Probe.

import { asset } from '../config/asset';

const W = 720;
const H = 360;
let mask: Uint8Array | null = null;
let loading = false;

function load() {
  if (loading) return;
  loading = true;
  const img = new Image();
  img.src = asset('/basemap/blue-marble.jpg');
  img.decode().then(() => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    const m = new Uint8Array(W * H);
    for (let i = 0, o = 0; i < m.length; i++, o += 4) m[i] = d[o + 2] > d[o] + 20 && d[o + 2] > d[o + 1] + 10 ? 1 : 0;
    mask = m;
  }, () => undefined);
}

/** true = water, false = land, null = not known yet (the map is still loading). */
export function isWater(lat: number, lon: number): boolean | null {
  if (!mask) {
    load();
    return null;
  }
  const x = ((Math.floor(((lon + 180) / 360) * W) % W) + W) % W;
  const y = Math.max(0, Math.min(H - 1, Math.floor(((90 - lat) / 180) * H)));
  return mask[y * W + x] === 1;
}
