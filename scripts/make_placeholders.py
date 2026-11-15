#!/usr/bin/env python3
"""Makes PLACEHOLDER layers that look roughly like the six EIC visualizations, so the site
works before the real clips are downloaded. They are built from the old mock data and are
NOT NASA data: the site labels them "placeholder" until public/eic/<record>/ has real files.

    npm run mock-data && python3 scripts/make_placeholders.py

Output: public/eic-placeholder/<record>/clip.mp4 (or still.png) + colorbar.json
"""

import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
MOCK = ROOT / "public" / "data" / "mock"
OUT = ROOT / "public" / "eic-placeholder"
W, H = 1024, 512
ROWS, COLS = 90, 180
CELLS = ROWS * COLS

base = Image.open(ROOT / "public" / "basemap" / "blue-marble.jpg").convert("RGB").resize((W, H), Image.LANCZOS)
BASE = np.asarray(base).astype(np.float32) / 255


def monthly(layer, year):
    a = np.fromfile(MOCK / layer / f"monthly_{year}.bin", dtype=np.uint8).reshape(12, ROWS, COLS)
    return a


def yearly(layer):
    meta = json.loads((MOCK / "index.json").read_text())
    years = next(l for l in meta["layers"] if l["id"] == layer)["years"]
    return years, np.fromfile(MOCK / layer / "yearly.bin", dtype=np.uint8).reshape(len(years), ROWS, COLS)


def up(grid):
    """2-degree grid (0-254, 255 = none) -> W x H float image 0..1 and a validity mask."""
    g = grid.astype(np.float32)
    valid = (grid != 255).astype(np.float32)
    g = np.where(grid == 255, 0, g) / 254
    gi = np.asarray(Image.fromarray(g).resize((W, H), Image.BILINEAR))
    vi = np.asarray(Image.fromarray(valid).resize((W, H), Image.BILINEAR))
    return gi, vi


def ramp(stops, v):
    xs = [s[0] for s in stops]
    out = np.zeros(v.shape + (3,), np.float32)
    for c in range(3):
        out[..., c] = np.interp(v, xs, [s[1 + c] / 255 for s in stops])
    return out


def save_frames(frames, path, fps=8):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for i, f in enumerate(frames):
            Image.fromarray((np.clip(f, 0, 1) * 255).astype(np.uint8)).save(f"{tmp}/f{i:04d}.png")
        subprocess.check_call(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps), "-i", f"{tmp}/f%04d.png",
                               "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p",
                               "-movflags", "+faststart", str(path)])


def tween(grids, steps=4):
    out = []
    for i in range(len(grids)):
        a, b = grids[i], grids[(i + 1) % len(grids)]
        for t in range(steps):
            out.append(a * (1 - t / steps) + b * (t / steps))
    return out


def colorbar(rec, stops):
    (OUT / rec).mkdir(parents=True, exist_ok=True)
    (OUT / rec / "colorbar.json").write_text(json.dumps({"placeholder": True, "stops": [[s[1], s[2], s[3], s[0]] for s in stops]}))


# Ocean: like 3912's key (blue 0 C, green 10-20 C, yellow ~25 C, red 32 C), land dark gray.
OCEAN = [(0.0, 20, 40, 160), (0.3, 30, 150, 90), (0.6, 140, 200, 60), (0.78, 250, 220, 40), (1.0, 220, 30, 20)]
m = monthly("ocean", 2019)
frames = []
for g in tween([up(m[i])[0] for i in range(12)]):
    v = np.clip((g - 0.3) / 0.65, 0, 1)
    img = ramp(OCEAN, v)
    land = up(m[0])[1] < 0.5
    img[land] = [0.16, 0.16, 0.17]
    frames.append(img)
save_frames(frames, OUT / "ocean" / "clip.mp4")
colorbar("ocean", OCEAN)

# Rain and clouds: Blue Marble, white clouds, rain from light blue to purple.
RAIN = [(0.0, 120, 200, 255), (0.4, 40, 110, 230), (0.75, 120, 50, 200), (1.0, 230, 80, 200)]
m = monthly("rain", 2024)
frames = []
for g in tween([up(m[i])[0] for i in range(12)]):
    cloud = np.asarray(Image.fromarray((g * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6))).astype(np.float32) / 255
    img = BASE * 0.75
    ca = np.clip(cloud * 1.6 - 0.1, 0, 0.85)[..., None]
    img = img * (1 - ca) + 0.92 * ca
    ra = np.clip((g - 0.35) * 2.2, 0, 0.9)[..., None]
    img = img * (1 - ra) + ramp(RAIN, np.clip((g - 0.35) / 0.6, 0, 1)) * ra
    frames.append(img)
save_frames(frames, OUT / "rain" / "clip.mp4")
colorbar("rain", RAIN)

# Lightning: dark map with bright flashes over tropical land storms.
m = monthly("rain", 2019)
land = (up(monthly("plants", 2019)[0])[1] > 0.5)
rng = np.random.default_rng(3)
frames = []
for g in tween([up(m[i])[0] for i in range(12)], 6):
    img = BASE * 0.18
    p = np.clip((g - 0.45) * 3, 0, 1) * land * (np.abs(np.linspace(90, -90, H))[:, None] < 55)
    flashes = (rng.random((H, W)) < p * 0.06).astype(np.float32)
    glow = np.asarray(Image.fromarray((flashes * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5))).astype(np.float32) / 255
    glow = np.clip(glow * 6 + flashes, 0, 1)[..., None]
    img = img * (1 - glow) + np.array([0.85, 0.95, 1.0]) * glow
    frames.append(img)
save_frames(frames, OUT / "lightning" / "clip.mp4", fps=12)

# City lights 2012-2023: black map, warm lights growing year by year.
years, Y = yearly("no2")
frames = []
for y in range(2012, 2024):
    g = up(Y[years.index(y)])[0]
    v = np.clip((g - 0.12) * 1.8, 0, 1) ** 1.5
    img = BASE * 0.06 + np.array([1.0, 0.85, 0.5]) * v[..., None]
    frames.append(img)
save_frames(tween(frames, 6)[: 11 * 6 + 1], OUT / "lights" / "clip.mp4", fps=8)

# CO2 (ODIAC, December 2021): a single image, dark map with orange-yellow emissions.
g = up(Y[years.index(2021)])[0]
v = np.clip((g - 0.1) * 1.6, 0, 1)
img = BASE * 0.12 + ramp([(0, 60, 10, 0), (0.5, 230, 110, 20), (1, 255, 240, 160)], v) * (v[..., None] ** 0.7)
(OUT / "co2").mkdir(parents=True, exist_ok=True)
Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save(OUT / "co2" / "still.png")

# NOx: Blue Marble with yellow-to-red pollution.
NOX = [(0.0, 255, 240, 150), (0.4, 255, 170, 60), (0.7, 230, 60, 30), (1.0, 120, 0, 10)]
m = monthly("no2", 2024)
frames = []
for g in tween([up(m[i])[0] for i in range(12)]):
    a = np.clip((g - 0.15) * 2.0, 0, 0.92)[..., None]
    img = BASE * 0.85 * (1 - a) + ramp(NOX, np.clip((g - 0.15) / 0.7, 0, 1)) * a
    frames.append(img)
save_frames(frames, OUT / "nox" / "clip.mp4")
colorbar("nox", NOX)

print("Placeholders written to", OUT)
