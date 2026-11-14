import type { DataIndex, LayerMeta } from './contract';

// Real pipeline output goes in public/data/. Until it exists, run `npm run mock-data`
// and the app reads public/data/mock/. Override with VITE_DATA_BASE=/data in .env.local.
export const DATA_BASE: string = import.meta.env.VITE_DATA_BASE ?? '/data/mock';

export interface LoadedLayer {
  meta: LayerMeta;
  yearly: Uint8Array;
  monthly: Map<number, Uint8Array>; // year -> 12 grids
}

export interface LoadedData {
  index: DataIndex;
  layers: Map<string, LoadedLayer>;
  cells: number;
}

async function fetchBin(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function loadData(): Promise<LoadedData> {
  const res = await fetch(`${DATA_BASE}/index.json`);
  if (!res.ok) {
    throw new Error(`No data found at ${DATA_BASE}/index.json. Run "npm run mock-data" first.`);
  }
  const index = (await res.json()) as DataIndex;
  const cells = index.grid.rows * index.grid.cols;
  const layers = new Map<string, LoadedLayer>();
  await Promise.all(
    index.layers.map(async (meta) => {
      const yearly = await fetchBin(`${DATA_BASE}/${meta.id}/yearly.bin`);
      if (yearly.length !== meta.years.length * cells) {
        throw new Error(`${meta.id}/yearly.bin has ${yearly.length} bytes, expected ${meta.years.length * cells}`);
      }
      layers.set(meta.id, { meta, yearly, monthly: new Map() });
    }),
  );
  return { index, layers, cells };
}

const pending = new Map<string, Promise<void>>();

// Loads monthly grids for one year on demand (when the slider stops on that year).
export function ensureMonthly(data: LoadedData, layerId: string, year: number): Promise<void> {
  const layer = data.layers.get(layerId);
  if (!layer || layer.monthly.has(year) || !layer.meta.monthlyYears.includes(year)) return Promise.resolve();
  const key = `${layerId}:${year}`;
  let p = pending.get(key);
  if (!p) {
    p = fetchBin(`${DATA_BASE}/${layerId}/monthly_${year}.bin`).then((bin) => {
      layer.monthly.set(year, bin);
    });
    pending.set(key, p);
  }
  return p;
}
