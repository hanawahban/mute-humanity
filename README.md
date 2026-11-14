# Mute Humanity

NASA Space Apps 2026 entry for the **Earth Information Jukebox** challenge.

An interactive Earth map where NASA Earth Information Center (EIC) visualizations become sound. Moving a cursor over the map plays the data under it. A **humanity slider** fades human-caused sound layers in and out over the natural ones, so you can hear what Earth sounds like with and without us.

## Contents

- [Stack](#stack)
- [Repository layout](#repository-layout)
- [Data pipeline](#data-pipeline)
- [Data to sound mappings](#data-to-sound-mappings)
- [Sound engine](#sound-engine)
- [Input modes](#input-modes)
- [Accessibility](#accessibility)
- [Privacy](#privacy)
- [Milestones](#milestones)

## Stack

| Area | Tools |
| --- | --- |
| Data prep (offline) | Python, OpenCV, NumPy, scikit-image |
| App | React, Vite, TypeScript |
| Audio | Tone.js |
| Map | MapLibre GL (equirectangular projection) |
| Hand tracking | MediaPipe Tasks Vision `HandLandmarker`, in-browser only |
| Voice | Web Speech API (`SpeechRecognition` and `speechSynthesis`), English and Arabic |
| Hosting | Firebase Hosting, static, must work offline once loaded |

## Repository layout

Code is split into modules with clear boundaries.

```
pipeline/            Offline Python: fetch NASA SVS media, extract features, write JSON
  config/            Crop boxes and projection per source image
public/data/         Pipeline output, one <layer>.json per layer
public/audio/        Optional samples: <group>_<layer>_lvl{1,2,3}.wav
src/audio/           Tone.js engine, channels, mappings, earcons
src/input/           Input modes and the shared action interface
src/a11y/            Screen reader announcer, captions, describe, cursor feel
src/viz/             Canvas overlay: ripples, seismograph strip, flashes
```

## Data pipeline

Lives in `/pipeline`. Runs offline; the app only reads the JSON it produces.

### Sources

Media lists are fetched from the NASA SVS API (`https://svs.gsfc.nasa.gov/api/<id>`).

| SVS id | Dataset | Layer group |
| --- | --- | --- |
| 5669 | Aerosols | nature and human (split by mask) |
| 5313 | Night lights | human |
| 5196 | CO2 | nature and human |
| 3912 | Sea surface temperature and currents | nature |
| 5011 | Lightning | nature |
| 4950 | GEDI forest height | nature |
| 4960 | Atmospheric river | nature (reserved) |

Rules:

- Prefer PNG frames or stills over MP4. Video compression shifts colors, which would corrupt hue-based extraction.
- For 5313 (night lights), download only the annual keyframes, never the full frame set.
- A config file holds the crop box and projection for each source image, because they differ between sources.

### Grid and output format

Every frame is reduced to a **5 degree lat/lon grid** (36 rows by 72 columns), with values normalized to 0 to 1.

Output is written to `/public/data/<layer>.json`:

```json
{
  "layer": "aerosol_dust",
  "group": "nature",
  "times": ["2020-01-01T00:00:00Z"],
  "grid": [[[0.0, 0.1]]]
}
```

`grid[t][lat][lon]` is indexed by time step, then latitude row, then longitude column. `group` is `"nature"` or `"human"` and decides which side of the humanity slider controls the layer.

### Feature extraction per source

| Source | Method | Output |
| --- | --- | --- |
| Aerosols (5669) | Hue segmentation into four masks | `sea_salt`, `dust`, `smoke`, `sulfates` grids |
| Night lights (5313) | Pixel brightness per cell; change map between keyframes (purple = more light, orange = less light) | `night_lights` brightness and `night_lights_change` |
| CO2 (5196) | Density and brightness per cell; day/night pulse over time | `co2` density and pulse |
| Currents (3912) | Farneback optical flow between frames | speed and direction per cell |
| Lightning (5011) | Frame differencing | flash events per cell and time |
| GEDI (4950) | Decode the colorbar back to values | canopy height per cell |

## Data to sound mappings

This section is the contract between the pipeline and the sound engine. Exact numbers are tunable in config; the mappings are the design.

All values are the smoothed grid value `v` (0 to 1) under the cursor unless noted. The key, scale and tempo are shared by all layers, so layers always sit in harmony.

### Nature layers

| Layer | Data | Sound | Mapping |
| --- | --- | --- | --- |
| Sea salt | Aerosol sea salt mask | Soft filtered noise, like surf or wind over water | `v` sets volume and opens a low-pass filter (more salt = brighter, louder) |
| Dust | Aerosol dust mask | Dry, grainy, breathy texture | `v` sets volume and grain density (more dust = denser grain) |
| Ecosystems | CO2 day/night pulse | Slow rhythmic pad that breathes | Pulse phase drives pad swell; the pulse follows the day/night cycle; `v` sets volume |
| Currents | Optical flow speed and direction | Flowing, evolving tone | Speed sets volume and movement rate; direction sets stereo pan and pitch drift (eastward right, westward left) |
| Lightning | Flash events | Short percussive crackle or clicks | Each flash event triggers a hit; flash density sets how often hits fire; hit velocity scales with intensity |
| Forest | GEDI canopy height | Warm sustained harmonic tones | Taller canopy = lower register and more voices (up to three layered tones); `v` sets volume |

### Human layers

| Layer | Data | Sound | Mapping |
| --- | --- | --- | --- |
| Night lights | Brightness | Electric hum and shimmer | Brightness sets volume and shimmer rate; brighter cells sound busier |
| Fossil CO2 | CO2 density | Low, heavy drone | Density sets volume and drone weight (sub bass level) |
| Sulfates | Aerosol sulfates mask | Thin, harsh, high-frequency tone | `v` sets volume and brightness; more sulfates = harsher |
| Smoke | Aerosol smoke mask | Dark, rough, crackling bed | `v` sets volume and roughness (distortion amount) |

### Change over time

Night lights uses the annual change map. Cells that gained light (purple) push the night-lights layer up in density; cells that lost light (orange) thin it out. Scrubbing across years audibly shows human growth.

### Sample mapping (later)

Placeholder Tone.js synths come first. When samples arrive, each layer uses three intensity levels, crossfaded by `v`:

```
/public/audio/<group>_<layer>_lvl1.wav   low intensity
/public/audio/<group>_<layer>_lvl2.wav   medium intensity
/public/audio/<group>_<layer>_lvl3.wav   high intensity
```

### Earcons

Short non-spatial cues, independent of layers:

| Event | Purpose |
| --- | --- |
| Region enter | Cursor crosses into a named region |
| Select | Cell or region selected |
| Mode change | Input mode switched |
| Mute / unmute | Humanity toggled |

## Sound engine

- One `Tone.Transport`, one key, one scale, one tempo, all set in config.
- One channel per layer.
- Grid value at the cursor drives each channel's volume, filter and density. Values are smoothed to avoid clicks and zipper noise.
- **Humanity slider** (0 to 1) scales the gain of the whole human group. **Mute humanity** sets it to 0 and restores the previous value on unmute.
- Placeholder synths now; sample crossfade later (see above).

## Input modes

The user picks a mode at start and can switch at any time. Every mode is mapped onto **one shared action interface**, so new modes (head tracking, single switch) can be added without touching the audio or UI code.

Shared actions include: move cursor, select, set humanity, mute/unmute humanity, speak current cell, describe, go to region, change mode.

| Mode | Controls |
| --- | --- |
| Mouse, trackpad, touch | Move = cursor. Click or tap = select |
| Keyboard | Arrow keys move across grid cells. `Enter` = select. `M` = mute humanity. `[` and `]` = slider down and up. `S` = speak current cell |
| Hand | Index fingertip = cursor. Pinch = grab slider; move hand up or down to set; open hand = release. Fist = mute. Open palm = unmute. Landmarks smoothed with a One Euro filter. Sensitivity setting. Hand outline overlay |
| Voice | Fixed commands: "go to <region>", "listen", "mute humanity", "bring us back", "louder", "quieter", "describe". English and Arabic |

## Accessibility

- Full screen reader support: ARIA labels and a live region for announcements.
- **Describe** speaks the region name, the top layers and their values.
- **Captions** for sound events, delivered in a live region.
- **Visual pulse** on a canvas overlay, driven by the same events as the audio:
  - Ripples at the cursor. Size and speed = intensity; shape depends on the layer.
  - Seismograph strip.
  - Region-enter flash.
  - Select double pulse.
- **Cursor feel** (mouse and hand), with a toggle and a strength setting:
  - Friction in dense cells.
  - Jitter in human-heavy cells.
  - Gentle pull toward hotspots.
- **Reduced motion**: honors `prefers-reduced-motion` and has an in-app toggle. Ripples and jitter are replaced by brightness changes. The app never exceeds 3 flashes per second.
- **Vibration**: `navigator.vibrate` behind a feature check, off by default.

## Privacy

Camera and microphone input is processed on-device only. Nothing is uploaded. Hand tracking runs in the browser through MediaPipe; voice uses the browser's Web Speech API.

Note: some browsers implement `SpeechRecognition` by sending audio to a cloud service. The settings panel will say so, and keyboard, mouse and hand modes work without it.

## Milestones

1. **Pipeline and first sound.** Pipeline outputs `aerosols.json`; the app plays it with mouse and slider.
2. **All layers and a11y.** All layers, keyboard mode, screen reader support, captions, visual pulse.
3. **Hand and voice.** Hand mode, voice mode, cursor feel.
4. **Ship.** Settings panel, offline check, Firebase deploy.

## Credits

Data: NASA Scientific Visualization Studio (SVS) and NASA Earth Information Center.
