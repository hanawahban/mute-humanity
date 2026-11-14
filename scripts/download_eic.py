#!/usr/bin/env python3
"""Download the EIC "Beauty Pieces" from NASA's Scientific Visualization Studio (SVS)
and turn them into small web clips the jukebox can read pixels from.

    python3 scripts/download_eic.py            # all records
    python3 scripts/download_eic.py fire co2   # only some

Needs: curl (built into macOS) and ffmpeg (brew install ffmpeg, or
conda install -c conda-forge ffmpeg). Downloads resume if the connection drops:
just run it again.

Output:
    eic-raw/<record>/<original file>          big originals (not committed)
    public/eic/<record>/clip.mp4               1280 px wide, H.264, no audio
    public/eic/<record>/colorbar.png           the NASA colour key, if SVS has one
    public/eic/eic.json                        titles, SVS ids, alt text, credits
"""

import json
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "eic-raw"
OUT = ROOT / "public" / "eic"

# record id -> SVS id, side, preferred movie (first filename containing one of these wins)
RECORDS = {
    "currents":  {"svs": 5425, "side": "earth", "prefer": ["temperature_1080p30", "clean_noDate_1080p30"]},
    "sst":       {"svs": 3912, "side": "earth", "prefer": ["1080", "2048x1024"]},
    "forests":   {"svs": 4950, "side": "earth", "prefer": ["GEDI_global_w_colorbar_1080p60.mp4", "GEDI_global_w_colorbar_2160p30"]},
    "river":     {"svs": 4960, "side": "earth", "prefer": ["atmos_river_HD.webm", "atmos_river_HD.mp4"]},
    "lightning": {"svs": 5011, "side": "earth", "prefer": ["iss_lightning_sphere_07312023.mp4", "eic_display"]},
    "fire":      {"svs": 4993, "side": "human", "prefer": ["Dixie_fire_2021_4x_1080p30", "Dixie_fire_2021_p30_1080p30"]},
    "lights":    {"svs": 5313, "side": "human", "prefer": ["EIC_2160p30_h265.mp4"]},
    "co2":       {"svs": 5196, "side": "human", "prefer": ["globe_zoom_1080p30", "globe_orbit_1080p30"]},
    "air":       {"svs": 5533, "side": "human", "prefer": ["EIC_AirQuality_Preview_3840x1080", "MapWithLabels"]},
}

SKIP = ("prores", ".mov", "hwshow", "_print", "_thm", "searchweb", "DATE_ONLY", "datesOnly", "LAND_", "SEA_ICE", "holdout")


def api(svs_id, tries=6):
    url = f"https://svs.gsfc.nasa.gov/api/{svs_id}"
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return json.load(r)
        except Exception as e:  # SVS is slow during the hackathon: back off and retry
            wait = 5 * (i + 1)
            print(f"  SVS {svs_id}: {e}; retrying in {wait}s")
            time.sleep(wait)
    raise SystemExit(f"Could not reach SVS {svs_id}. Try again later, or download from https://svs.gsfc.nasa.gov/{svs_id}/")


def media(page):
    for group in page.get("media_groups", []):
        for item in group.get("items", []):
            inst = item.get("instance") or {}
            if inst.get("url") and inst.get("filename"):
                yield inst


def pick_movie(items, prefer):
    movies = [m for m in items if m.get("media_type") == "Movie"
              and m["filename"].lower().endswith((".mp4", ".webm"))
              and not any(s.lower() in m["filename"].lower() for s in SKIP)]
    for p in prefer:
        for m in movies:
            if p.lower() in m["filename"].lower():
                return m
    # fallback: the smallest movie at least 1000 px wide
    ok = [m for m in movies if (m.get("width") or 0) >= 1000] or movies
    return min(ok, key=lambda m: m.get("width") or 1e9) if ok else None


def curl(url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    # -C - resumes a partial download; --retry survives timeouts
    cmd = ["curl", "-L", "--fail", "-C", "-", "--retry", "8", "--retry-delay", "5", "--retry-all-errors",
           "--connect-timeout", "30", "-o", str(dest), url]
    for attempt in range(3):
        if subprocess.call(cmd) == 0:
            return True
        print(f"  download interrupted, resuming ({attempt + 1}/3)...")
        time.sleep(5)
    return False


def transcode(src, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    subprocess.check_call([
        "ffmpeg", "-y", "-loglevel", "error", "-i", str(src),
        "-vf", "scale=1280:-2", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(dest),
    ])


def main():
    if not shutil.which("curl"):
        raise SystemExit("curl is missing")
    have_ffmpeg = bool(shutil.which("ffmpeg"))
    if not have_ffmpeg:
        print("ffmpeg not found: downloading only. Install it (brew install ffmpeg) and run again to make the web clips.")
    wanted = sys.argv[1:] or list(RECORDS)
    manifest_path = OUT / "eic.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}

    for rid in wanted:
        cfg = RECORDS[rid]
        print(f"\n== {rid}: SVS {cfg['svs']}")
        page = api(cfg["svs"])
        items = list(media(page))
        movie = pick_movie(items, cfg["prefer"])
        if not movie:
            print("  no movie found on this page, skipping")
            continue
        raw = RAW / rid / movie["filename"]
        print(f"  movie: {movie['filename']} ({movie.get('width')}x{movie.get('height')})")
        if not curl(movie["url"], raw):
            print(f"  failed: download it by hand from https://svs.gsfc.nasa.gov/{cfg['svs']}/ into {raw.parent}")
            continue
        for img in items:
            name = img["filename"].lower()
            if img.get("media_type") == "Image" and ("colorbar" in name or "cbar" in name) and "_thm" not in name:
                curl(img["url"], OUT / rid / "colorbar.png")
                print(f"  colour key: {img['filename']}")
                break
        if have_ffmpeg:
            transcode(raw, OUT / rid / "clip.mp4")
            print(f"  wrote public/eic/{rid}/clip.mp4")
        manifest[rid] = {
            "svs": cfg["svs"], "side": cfg["side"], "title": page.get("title"),
            "url": f"https://svs.gsfc.nasa.gov/{cfg['svs']}/", "source_file": movie["filename"],
            "alt_text": movie.get("alt_text") or page.get("description", "")[:500],
            "credit": "NASA's Scientific Visualization Studio",
        }
        OUT.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(manifest, indent=2))

    print("\nDone. Clips are in public/eic/, details in public/eic/eic.json")


if __name__ == "__main__":
    main()
