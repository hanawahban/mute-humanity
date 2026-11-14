# Mute Humanity: The Earth Jukebox

NASA Space Apps 2026 entry for the **Earth Information Jukebox** challenge.

A website built as a literal jukebox. Each record is made from NASA data: three play Earth's natural systems (Ocean, Plants, Rain) and three play human damage (NO2, Fires, Ocean plastic). Every record has two sides:

- **Side A:** the record's NASA Earth Information Center (EIC) visualization, with its frames turned into sound live.
- **Side B:** the NASA data on a shared 2D map, with a timeline from 1950 to today that changes the music as you drag.

Earth plays in tune; humanity pulls it out of tune. The **Mute Humanity** lever fades every human record out at once.

## Contents

- [Quick start](#quick-start)
- [Repository layout](#repository-layout)
- [Records and datasets](#records-and-datasets)
- [Data contract (pipeline to app)](#data-contract-pipeline-to-app)
- [EIC clips (side A)](#eic-clips-side-a)
- [Sound files](#sound-files)
- [Controls](#controls)
- [Accessibility](#accessibility)
- [Status](#status)

## Quick start

```bash
npm install
npm run mock-data   # writes fake data to public/data/mock/ (about 30 MB, not committed)
npm run dev         # http://localhost:5173
```

Use **Chrome**. Click "Start the jukebox" (browsers need one click before playing sound).

When the real pipeline output is in `public/data/`, create `.env.local` with:

```
VITE_DATA_BASE=/data
```

## Repository layout

```
scripts/make-mock-data.mjs   Fake data in the agreed format, until the pipeline delivers
public/data/                 Pipeline output (see "Data contract")
public/eic/<record>/         EIC clips for side A (see "EIC clips")
public/audio/<record>/       Sound files from GarageBand (see "Sound files")
src/config/                  Records, places, key and tempo
src/data/                    Data contract types, loader, sampling (fractional years, regions)
src/state/                   Shared state (zustand) and actions used by every input
src/audio/                   Tone.js engine (placeholder synths) and the mixer loop
src/input/                   Keyboard, Xbox controller (input and vibration), voice
src/components/              Jukebox, map (side B), side A player, captions, settings
```

Every input (buttons, keyboard, voice, controller) calls the same actions in `src/state/actions.ts`, so adding an input never touches the audio or UI code.

## Records and datasets

All data is from NASA. Values are sampled at the map position and the slider year.

| Record | Side | Data (side B) | Years | EIC visualization (side A) |
| --- | --- | --- | --- | --- |
| Ocean | Earth | [MUR 0.25° SST](https://podaac.jpl.nasa.gov/dataset/MUR25-JPL-L4-GLOB-v04.2) + [OSCAR currents](https://podaac.jpl.nasa.gov/dataset/OSCAR_L4_OC_FINAL_V2.0) | 1993-now | [SVS 3912](https://svs.gsfc.nasa.gov/3912/) |
| Plants | Earth | [MODIS/Terra NDVI monthly (MOD13C2)](https://www.earthdata.nasa.gov/es/data/catalog/lpcloud-mod13c2-061) | 2000-now | [SVS 4950](https://svs.gsfc.nasa.gov/4950/) |
| Rain | Earth | GPCP (1979-2000), then [GPM IMERG monthly](https://disc.gsfc.nasa.gov/datasets/GPM_3IMERGM_07/summary) | 1979-now | [SVS 4960](https://svs.gsfc.nasa.gov/4960/) |
| NO2 | Human | [Surface NO2](https://doi.org/10.5067/J99FI2U38YRN) (1990-2003), then [OMI OMNO2d](https://disc.gsfc.nasa.gov/datacollection/OMNO2d_003.html) | 1990-now | [SVS 5533](https://svs.gsfc.nasa.gov/5533/) |
| Fires | Human | [FIRMS active fires](https://firms.modaps.eosdis.nasa.gov/download/) | 2001-now | [SVS 5669](https://svs.gsfc.nasa.gov/5669/) |
| Ocean plastic | Human | [CYGNSS microplastics v3.2](https://podaac.jpl.nasa.gov/dataset/CYGNSS_L3_MICROPLASTIC_V3.2) | 2018-now | [SVS 5425](https://svs.gsfc.nasa.gov/5425/) (currents, not plastic) |

Prologue layer (no button): `temperature` from [NASA GISTEMP v4](https://data.giss.nasa.gov/gistemp/), 1950-now. It draws the warming stripes on the timeline. Land use (LUH2) and pollution (MERRA-2) are planned prologue layers.

## Data contract (pipeline to app)

The pipeline writes this layout. `scripts/make-mock-data.mjs` writes exactly the same layout with fake values, so it is also a working example.

```
public/data/index.json
public/data/<layer>/yearly.bin
public/data/<layer>/monthly_<year>.bin
```

**Grid:** 2 degrees, 90 rows by 180 columns. Row 0 is the band 90N to 88N (north to south). Column 0 is 180W to 178W (west to east). Cell centre: `lat = 89 - 2*row`, `lon = -179 + 2*col`.

**Encoding:** one byte per cell. `0-254` is the value scaled between the layer's `min` and `max`; `255` means no data (for example land for ocean layers, or polar night for NO2).

- `yearly.bin`: `[yearIndex][row][col]`, one grid per year in `years`. Yearly average.
- `monthly_<year>.bin`: `[month 0-11][row][col]`, for each year in `monthlyYears` (2000-now where the dataset allows).

**index.json:**

```json
{
  "version": 1,
  "grid": { "resolutionDeg": 2, "rows": 90, "cols": 180, "rowOrder": "north-to-south", "colOrder": "west-to-east", "noData": 255 },
  "layers": [
    {
      "id": "no2",
      "record": "no2",
      "side": "human",
      "units": "1e15 molecules/cm2",
      "min": 0,
      "max": 20,
      "years": [1990, 1991, "...", 2026],
      "monthlyYears": [2004, 2005, "...", 2026],
      "source": "OMI OMNO2d v003, doi:10.5067/Aura/OMI/DATA3007"
    }
  ]
}
```

Layer ids the app expects: `ocean`, `plants`, `rain`, `no2`, `fires`, `plastic`, `temperature`. Types are in `src/data/contract.ts`. Where the data source changes (NO2 in 2004, Rain in 2000), keep one layer and note it in `source`.

## EIC clips (side A)

Download each record's EIC visualization from the SVS page in the table above and save it as `public/eic/<record>/clip.mp4`. Browsers block reading pixels from videos on other websites, so the clips must be served by this app.

Optional `public/eic/<record>/colorbar.json` decodes colours into values:

```json
{ "stops": [[r, g, b, value0to1], ...] }
```

Without it, side A uses brightness. The player samples one column per tick and sweeps left to right (like NASA's Caldwell 73 sonification), and drives the record's instrument.

## Sound files

The engine (`src/audio/engine.ts`) uses placeholder Tone.js synths. Shared key: **D major pentatonic** (D E F# A B), about **80 BPM**. Human sounds play outside the key (the NO2 drone is on G#).

Proposed file layout for the GarageBand exports (MP3, about equally loud):

```
public/audio/ocean/strings_<note>.mp3     e.g. strings_D3.mp3 ... strings_B4.mp3
public/audio/plants/pad.mp3              seamless 16-bar loop
public/audio/rain/drop_<note>.mp3
public/audio/no2/drone.mp3               seamless loop on G#
public/audio/fires/crackle_<1-8>.mp3
public/audio/plastic/click_<1-8>.mp3     plus static.mp3 loop
public/audio/ui/<name>.mp3               record press, lever, decade tick, voice chimes
```

## Controls

| Action | Keyboard | Xbox controller | Voice (hold V or X) |
| --- | --- | --- | --- |
| Play/stop a record | `1`-`6` | D-pad left/right to choose, `A` | "play ocean", "stop fires" |
| Flip side A/B | `F` | `Y` | "flip ocean" |
| Humanity lever | Up/Down, `M` mute | D-pad up/down | "mute humanity", "humanity to 50 percent" |
| Year | Left/Right | `LT` / `RT` (harder = faster) | "go to 1985", "play the 1990s" |
| Map | Shift + arrows, `+` / `-` | Left stick, `LB` / `RB` | "go to Bahrain", "zoom in" |
| What am I hearing? | `D` | `B` | "what am I hearing?" |
| Play 75 years | `P` | `Start` | "play 75 years" |

**Controller on Mac:** Chrome, USB cable, press any button once after the page loads. Vibration uses `vibrationActuator.playEffect('dual-rumble')`; strong motor for Ocean, Plants and NO2, weak motor for Rain, Fires and plastic.

**Voice:** Web Speech API (Chrome). It needs internet unless on-device recognition is available. The music ducks while listening.

## Accessibility

- Real buttons and range inputs: full keyboard control and screen reader labels (test with VoiceOver: Cmd+F5).
- A polite live region announces actions. The caption line describes the music continuously for deaf users; it is not a live region, so screen readers aren't flooded (press `D` instead).
- Volume meter on every record button.
- Settings: high contrast, reduced motion, vibration strength.
- No flashing faster than 3 times per second.

## Status

Working with mock data and placeholder synths:

- [x] Jukebox with six records, stacking, Mute Humanity lever
- [x] Timeline 1950-today, live while dragging, monthly loop when it rests on a year
- [x] Shared 2D map with zoom, pan and a local listening area
- [x] Side A player sampling EIC video frames (needs the clips)
- [x] Xbox controller input and vibration, keyboard, voice commands, captions

To do:

- [ ] Real pipeline output in `public/data/`
- [ ] EIC clips and colour keys in `public/eic/`
- [ ] GarageBand samples replacing the placeholder synths
- [ ] Jukebox artwork from multimedia
- [ ] Prologue layers (land use, pollution), mono audio switch, left/right panning
- [ ] Project page: how each sound is made, sources, caveats
