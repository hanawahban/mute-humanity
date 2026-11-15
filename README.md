<p align="center"><img src="public/logo.svg" width="320" alt="Sonific-8 logo: a sound wave that loops into an 8"></p>

# Sonific-8: The Earth Jukebox

NASA Space Apps 2026, challenge "Earth Information Jukebox". By team Sonific-8, from Bahrain.

Six NASA Earth Information Center (EIC) visualizations, all flat maps of the whole Earth, are the six records of a jukebox. Turn records on and they stack on one shared map and play together; zoom anywhere to hear just that place. Earth plays in tune; humanity plays out of key. Then mute humanity and listen to the planet without us.

Every sound comes from the pixels of the EIC frames, read through each visualization's color key.

## Quick start

```bash
npm install
npm run eic        # only if public/eic/<record>/clip.mp4 are missing: downloads the six EIC visualizations from NASA SVS (needs curl + ffmpeg)
npm run dev        # http://localhost:5173 in Chrome
```

Without the clips, the site uses placeholder layers from `public/eic-placeholder/` and shows a "Placeholder visuals" badge. Rebuild them with `npm run placeholders` (needs Python with numpy and Pillow).

## The six records

| # | Record | Side | EIC visualization | Period | Instrument | What you hear |
|---|---|---|---|---|---|---|
| 1 | Ocean | Earth | [SVS 3912](https://svs.gsfc.nasa.gov/3912/) Sea Surface Currents and Temperature | Mar 2007 – Mar 2008 | Cello | warmer water = higher notes |
| 2 | Rain and clouds | Earth | [SVS 5149](https://svs.gsfc.nasa.gov/5149/) GEOS-FP Precipitation and Clouds | recent days | Flute + clarinet pad | more rain = more notes; thicker cloud = louder pad |
| 3 | Lightning | Earth | [SVS 5011](https://svs.gsfc.nasa.gov/5011/) Lightning from the ISS | 2017 – 2023 | Violin | every flash = a sharp note |
| 4 | City lights | Humanity | [SVS 5475](https://svs.gsfc.nasa.gov/5475/) Night Lights 2012–2023 (flat version of 5313) | 2012 – 2023 | Synth 1 | brighter = more and higher notes |
| 5 | Carbon emissions | Humanity | [SVS 5121](https://svs.gsfc.nasa.gov/5121/) ODIAC (one still image) | Dec 2021 | Synth 2 (deep drone) | more emissions = thicker, louder drone |
| 6 | Traffic and industry | Humanity | [SVS 5154](https://svs.gsfc.nasa.gov/5154/) Nitrogen Oxides (NOx) | recent days | Synth 3 | more pollution = louder, harsher |

The layers line up in place, not in time: each keeps its real dates, shown on the map. The team's other instruments: `all.mp3` is the welcome chord; Oboe is a spare. Rule: traditional instruments are for nature, synths are for human-made things.

## How the map stacks six visualizations

The map is drawn with WebGL (`src/map/gl.ts`). Every EIC visualization is an equirectangular world map, so one shader places them all. Each layer's background is made transparent in the shader (black space for lights, lightning and CO₂; gray land under the ocean flows; the base map under rain and clouds; light green "clean air" for NOx, which is redrawn as dark smog), so all six can be layered while the data stays visible. NASA logos and date stamps burned into the frames are masked out of both the picture and the sound.

## How it's sonified

1. **Pixels to numbers.** Each frame is drawn into a 360 × 180 grid (1° cells). Each pixel's color is matched to the visualization's color key (`src/eic/layers.ts`), giving a value from 0 to 1, or "no data" (land under the ocean layer).
2. **Three ways to listen** (`src/audio/conductor.ts`), all on a 16th-note grid at 80 BPM:
   - **Listen**: the view's average, hotspot strength and coverage drive each instrument while its video plays.
   - **Scan**: the videos pause and a needle sweeps the view in three bars (about 9 seconds), driven by the audio clock so it moves smoothly. Each strong point plays exactly when the needle reaches it, and flashes on the map: higher on screen = higher pitch, stronger = louder, left/right = stereo.
   - **Probe**: the value under the probe plays on every beat. Clicking a spot makes the narrator say where it is and what each playing record shows there.
3. **Harmony.** Under the Earth records, a slow A major progression (A, F#m, D, E) on viola with a cello root (no synths) changes every two bars. When our footprint is lightened, it swells and the hall opens up.
4. **Mix rules.** Earth records use A major pentatonic, the key the instruments were recorded in, with reverb. Humanity records are synths that play the same notes, bent off the key (toward C, G, then A#, D#, F) as the humanity lever rises: about 1 note in 5 at 50%, about half at 100%, plus up to 34 cents of drift and a slight drag behind the beat. So it disturbs the Earth's harmony without turning into noise. The lever also scales their volume; Lighten our footprint fades them down.

## For the pipeline: what the app expects

```
public/eic/<record>/clip.mp4       the visualization, 2048 px wide, H.264, no audio (still.png for co2)
public/eic/<record>/colorbar.json  optional: {"stops": [[r, g, b, value0to1], ...]}  (beats the built-in guess)
public/eic/<record>/colorbar.png   optional: the NASA color key, shown in the map key
```

Record ids: `ocean`, `rain`, `lightning`, `lights`, `co2`, `nox`. `scripts/download_eic.py` produces the clips and fetches color key images. If a clip has titles or a color bar inside the frame, set its `area` (the part that is the map, as fractions) in `src/config/records.ts`.

Built-in decoding until `colorbar.json` exists: ocean uses the SVS color bar description; lights, lightning and CO₂ use brightness; NOx uses warm colors; rain separates gray clouds from colored rain.

## Voice

The story and key moments are narrated with **Kokoro**, an open neural text-to-speech model (voice `af_heart`), pre-rendered to `public/voice/` by `scripts/make_voice.py` from the text in `src/config/narration.json`. Live descriptions ("what am I hearing?") use the most natural voice installed on the computer; on a Mac, download a Premium or Enhanced voice in System Settings → Accessibility → Spoken Content for the best result.

Voice commands work two ways: hold V (or the controller's X) to talk, or turn on **Microphone always on** in Settings (or say "microphone on"). With the microphone on, every sentence is checked for a command; anything said while the narrator is talking is ignored so it can't trigger itself, and unrecognized speech is ignored quietly. Headphones help. The browser shows its own microphone indicator, and Chrome sends speech to its server, so this needs internet.

## How it works view

The **How it works** button (or `I`) opens a step-by-step view for any record: the live NASA map, a slider along its color key, the note that position becomes, and the instrument. Dragging the slider plays each note.

## Zooming in

The bundled Blue Marble base map is 4096 px wide (about 10 km per pixel). Zoomed in, the map streams **NASA Blue Marble Next Generation** tiles from **NASA GIBS** (geographic tiles, up to about 500 m per pixel; `src/map/detail.ts`) and switches to Natural Earth 1:10m coastlines, so you can zoom to about 9° across the screen. The NASA EIC records themselves are about 19 km per pixel, so up close they stay soft; the detail is in the base map. If GIBS can't be reached, the bundled base map is used.

## Controls

| | Keyboard | Xbox controller | Voice (hold V or X, or mic always on) |
|---|---|---|---|
| Play / stop a record | `1`–`6` | D-pad ← → to choose, `A` | "play ocean", "stop rain" |
| Humanity | `↑` `↓`, `M` lighten / full footprint | D-pad ↑ ↓ | "lighten our footprint", "full footprint", "humanity to 50 percent" |
| Listen / Scan / Probe | `L` `S` `P` | `Y` cycles | "scan", "probe", "listen" |
| Move probe | arrows (Probe mode) or mouse | left stick (Probe mode) | |
| Places | `G` next place; Go to list | triggers | "go to Bahrain" |
| Solo | `O` | View | "solo NOx" |
| Story | `T` | Start | "play the story" |
| Map | Shift + arrows, `+` `-` `0`, mouse | left stick, right stick / bumpers zoom | "zoom in" |
| What am I hearing? | `D` | `B` (spoken) | "what am I hearing?" |
| Captions, help | `C`, `H` | | "help" |

**Controller vibration** (`src/input/haptics.ts`): you feel the chosen record. Ocean swells, rain patters, lightning strikes, city lights flicker, CO₂ rumbles, NOx clicks like a Geiger counter; faster and stronger means more. Chrome on Mac, USB cable, press a button once after loading. The controller's LEDs can't be set from a browser.

## Accessibility

- Every control is a real button or slider with a label; the screen reader hears what each record sounds like.
- "Play the story" is a hands-free guided listen of about a minute and a half, with very few words that explain how each map becomes sound. Each Earth record plays alone first, zoomed into wherever its NASA map is densest at that moment (found from the data by `densest()` in `src/eic/layers.ts`), then joins the others. Then each humanity record alone, then all six at once, louder and rougher, then our footprint is lightened. The music ducks while the narrator speaks.
- `D` describes what you're hearing; captions describe the music for deaf and hard-of-hearing users.
- Keyboard and switch access for everything, controller vibration, voice commands.
- High contrast and reduced motion (also follows the system setting).

## Repository layout

```
src/config/records.ts     the six records: EIC source, period, decoding, instrument
src/config/places.ts      places and the curated hotspots per record
src/eic/layers.ts         loads clips, decodes frames into values, view / column / point queries
src/audio/engine.ts       Tone.js samplers with the team's instruments, buses, channels
src/audio/conductor.ts    Listen / Scan / Probe note scheduling, levels, vibration, captions
src/state/                store, shared actions, the story
src/map/camera.ts         smooth zoom and pan
src/components/           map, dock, overlays, help
src/input/                keyboard, controller, vibration, voice
public/sounds/            the 10 instruments (trimmed, normalized mp3) + instruments.json
public/eic-placeholder/   placeholder layers until the real clips are downloaded
scripts/download_eic.py   downloads the EIC clips from NASA SVS
pipeline/                 the earlier gridded-data pipeline (shelved)
```

## Credits

Visualizations: NASA Earth Information Center and NASA's Scientific Visualization Studio. Base map: NASA Blue Marble. Instruments recorded by our multimedia team.

## Brand

Logo artwork is in `public/brand/` (black and white PNGs from the team). `public/logo.svg` and the in-app logo (`src/components/logoPath.ts`) are vector traces of it, so it stays sharp and can take any color. The favicon is `public/favicon.svg`.
