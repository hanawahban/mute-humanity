// The data contract between the Python pipeline and the app.
// The pipeline writes public/data/index.json plus one folder per layer.
// The fake-data script (scripts/make-mock-data.mjs) writes the same layout to public/data/mock/.

export interface GridSpec {
  resolutionDeg: number; // 2
  rows: number; // 90, row 0 = northernmost band (90N to 88N)
  cols: number; // 180, col 0 = westernmost band (180W to 178W)
  rowOrder: 'north-to-south';
  colOrder: 'west-to-east';
  noData: number; // 255
}

export interface LayerMeta {
  id: string; // folder name, e.g. "no2"
  record: string | null; // jukebox record id, or null for prologue layers
  side: 'earth' | 'human' | 'prologue';
  units: string; // label for the real value, e.g. "1e15 molecules/cm2"
  min: number; // real value that 0 encodes
  max: number; // real value that 254 encodes
  years: number[]; // years in yearly.bin, in order
  monthlyYears: number[]; // years that have monthly_<year>.bin
  source: string; // dataset name or DOI, shown on the project page
}

export interface DataIndex {
  version: 1;
  grid: GridSpec;
  mock?: boolean;
  layers: LayerMeta[];
}

// yearly.bin:          Uint8, [yearIndex][row][col], 0-254 = value, 255 = no data
// monthly_<year>.bin:  Uint8, [month 0-11][row][col], same encoding
