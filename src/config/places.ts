export interface Place {
  name: string;
  lat: number;
  lon: number;
  zoom: number;
  aliases?: string[];
}

// Used for "go to <place>" and for naming the region at the centre of the map.
export const PLACES: Place[] = [
  { name: 'Bahrain', lat: 26.07, lon: 50.55, zoom: 5, aliases: ['manama'] },
  { name: 'the Arabian Gulf', lat: 26.5, lon: 52, zoom: 4, aliases: ['gulf', 'persian gulf', 'arabian gulf'] },
  { name: 'the Amazon', lat: -5, lon: -62, zoom: 3.5, aliases: ['amazon', 'amazon rainforest'] },
  { name: 'Brazil', lat: -12, lon: -50, zoom: 3 },
  { name: 'eastern China', lat: 32, lon: 117, zoom: 3.5, aliases: ['china'] },
  { name: 'Beijing', lat: 39.9, lon: 116.4, zoom: 5 },
  { name: 'India', lat: 22, lon: 79, zoom: 3 },
  { name: 'Delhi', lat: 28.6, lon: 77.2, zoom: 5 },
  { name: 'Central Africa', lat: 0, lon: 20, zoom: 3, aliases: ['africa', 'congo'] },
  { name: 'the Sahara', lat: 23, lon: 13, zoom: 3, aliases: ['sahara'] },
  { name: 'Europe', lat: 50, lon: 10, zoom: 3 },
  { name: 'the United States', lat: 39, lon: -98, zoom: 2.5, aliases: ['usa', 'america', 'united states'] },
  { name: 'Los Angeles', lat: 34, lon: -118.2, zoom: 5 },
  { name: 'New York', lat: 40.7, lon: -74, zoom: 5 },
  { name: 'Australia', lat: -25, lon: 134, zoom: 2.5 },
  { name: 'Indonesia', lat: -2, lon: 118, zoom: 3 },
  { name: 'Southeast Asia', lat: 15, lon: 105, zoom: 3 },
  { name: 'Japan', lat: 36, lon: 138, zoom: 4 },
  { name: 'Siberia', lat: 62, lon: 100, zoom: 2.5 },
  { name: 'the Arctic', lat: 80, lon: 0, zoom: 2, aliases: ['arctic', 'north pole'] },
  { name: 'Antarctica', lat: -78, lon: 0, zoom: 2, aliases: ['south pole'] },
  { name: 'the North Pacific garbage patch', lat: 32, lon: -145, zoom: 3, aliases: ['garbage patch', 'pacific garbage patch'] },
  { name: 'the Gulf Stream', lat: 38, lon: -65, zoom: 3.5, aliases: ['gulf stream'] },
  { name: 'the Mediterranean', lat: 36, lon: 18, zoom: 3.5, aliases: ['mediterranean'] },
  { name: 'Mexico', lat: 23, lon: -102, zoom: 3 },
  { name: 'South Africa', lat: -29, lon: 25, zoom: 3.5 },
  { name: 'Egypt', lat: 27, lon: 30, zoom: 4, aliases: ['cairo', 'nile'] },
  { name: 'the Atlantic Ocean', lat: 10, lon: -35, zoom: 2, aliases: ['atlantic'] },
  { name: 'the Pacific Ocean', lat: 0, lon: -160, zoom: 2, aliases: ['pacific'] },
  { name: 'the Indian Ocean', lat: -15, lon: 75, zoom: 2, aliases: ['indian ocean'] },
  { name: 'the Kuroshio Current', lat: 34, lon: 145, zoom: 4, aliases: ['kuroshio'] },
  { name: 'the Agulhas Current', lat: -37, lon: 25, zoom: 4, aliases: ['agulhas'] },
  { name: 'the Congo Basin', lat: -1, lon: 22, zoom: 4, aliases: ['congo basin'] },
  { name: 'Lake Maracaibo', lat: 9.8, lon: -71.6, zoom: 6, aliases: ['maracaibo', 'venezuela'] },
  { name: 'the Bay of Bengal', lat: 17, lon: 89, zoom: 4, aliases: ['bay of bengal', 'bangladesh'] },
  { name: 'the Nile Delta', lat: 30.5, lon: 31, zoom: 6, aliases: ['nile delta'] },
  { name: 'the Eastern Mediterranean', lat: 33, lon: 34, zoom: 5, aliases: ['eastern mediterranean', 'levant'] },
  { name: 'Western Europe', lat: 49, lon: 5, zoom: 4, aliases: ['western europe', 'france'] },
  { name: 'the South African Highveld', lat: -26.3, lon: 29, zoom: 6, aliases: ['highveld', 'johannesburg'] },
  { name: 'the whole planet', lat: 10, lon: 0, zoom: 1, aliases: ['world', 'earth', 'everywhere', 'planet'] },
];

/** Curated places to zoom into for each record: the story stops. */
export const HOTSPOTS: Record<string, string[]> = {
  ocean: ['the Gulf Stream', 'the Kuroshio Current', 'the Agulhas Current', 'the Arabian Gulf'],
  rain: ['India', 'the Bay of Bengal', 'the Amazon', 'Indonesia'],
  lightning: ['the Congo Basin', 'Lake Maracaibo', 'Southeast Asia'],
  lights: ['India', 'the Nile Delta', 'the Eastern Mediterranean', 'Bahrain'],
  co2: ['eastern China', 'Western Europe', 'New York', 'the Arabian Gulf'],
  nox: ['eastern China', 'the South African Highveld', 'Delhi', 'Bahrain'],
};

export function findPlace(text: string): Place | undefined {
  const t = text.toLowerCase().replace(/^the\s+/, '').trim();
  return PLACES.find(
    (p) => p.name.toLowerCase().replace(/^the\s+/, '') === t || (p.aliases ?? []).some((a) => a === t),
  ) ?? PLACES.find((p) => t.includes(p.name.toLowerCase().replace(/^the\s+/, '')) || (p.aliases ?? []).some((a) => t.includes(a)));
}

function angularDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  let dLon = Math.abs(lon1 - lon2);
  if (dLon > 180) dLon = 360 - dLon;
  const dLat = lat1 - lat2;
  return Math.hypot(dLat, dLon * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180)));
}

export function nameRegion(lat: number, lon: number, zoom: number): string {
  if (zoom < 1.5) return 'the whole planet';
  let best: Place | undefined;
  let bestD = Infinity;
  for (const p of PLACES) {
    if (p.zoom <= 1) continue;
    const d = angularDistance(lat, lon, p.lat, p.lon);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (best && bestD < 18) return best.name;
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(Math.round(lat))}°${ns}, ${Math.abs(Math.round(lon))}°${ew}`;
}
