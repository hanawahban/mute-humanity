"""List Frames sets, save first/middle/last sample frames, report projection, crop and colorbar.

    python -m pipeline.inspect_frames <id> [--set <frame-set-name>]

Nothing is analysed here: this only produces what a person needs to confirm the crop,
projection and which frame set to use. Writes public/eic/<id>/samples/ and inspect.json.
Never downloads a whole frame folder: one index page, then three files.
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
import requests
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
EIC = ROOT / "public" / "eic"
IMG = re.compile(r'href="([^"?/][^"]*\.(?:png|jpg|jpeg|tif|tiff|exr|tga))"', re.I)
SUBDIR = re.compile(r'href="([^"?/][^"]*/)"')
UA = {"User-Agent": "mute-humanity-pipeline"}


def list_frames(url):
    """HTTP directory index -> (image filenames sorted, subfolders)."""
    r = requests.get(url, timeout=180, headers=UA)
    r.raise_for_status()
    names = sorted(set(IMG.findall(r.text)))
    subs = sorted(set(SUBDIR.findall(r.text)))
    return names, subs


def frame_sets(api):
    out = []
    for g in api.get("media_groups", []):
        for it in g.get("items", []):
            i = it["instance"]
            if i.get("media_type") == "Frames":
                out.append({"name": i["filename"], "w": i.get("width") or 0, "h": i.get("height") or 0,
                            "url": i["url"].replace("http://", "https://"), "note": (i.get("alt_text") or "")[:200]})
    return out


def pick_set(sets):
    """Prefer a 2:1 set, smallest one that is at least 2048 wide; else the first."""
    flat = [s for s in sets if s["w"] and abs(s["w"] / s["h"] - 2) < 0.02 and s["w"] >= 2048]
    if flat:
        return sorted(flat, key=lambda s: s["w"] * s["h"])[0]
    return sets[0] if sets else None


def content_bbox(img, tol=18):
    """Bounding box of pixels that differ from the corner background colour (a crop starting point)."""
    a = np.asarray(img.convert("RGB")).astype(int)
    bg = np.median(np.stack([a[0, 0], a[0, -1], a[-1, 0], a[-1, -1]]), axis=0)
    diff = np.abs(a - bg).sum(axis=2) > tol
    ys, xs = np.where(diff)
    if not len(xs):
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]


def describe_image(path):
    im = Image.open(path)
    w, h = im.size
    bb = content_bbox(im)
    info = {"file": str(path.relative_to(ROOT)), "size": [w, h], "aspect": round(w / h, 3),
            "equirectangular_2to1": abs(w / h - 2) < 0.02, "contentBox": bb}
    if bb:
        cw, ch = bb[2] - bb[0], bb[3] - bb[1]
        info["contentAspect"] = round(cw / ch, 3)
        info["contentIs2to1"] = abs(cw / ch - 2) < 0.04
    return info


def fetch(url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size:
        return dest
    r = requests.get(url, timeout=300, headers=UA)
    r.raise_for_status()
    dest.write_bytes(r.content)
    return dest


def samples_from_movie(mp4, out_dir, id_):
    """No frame folder: pull first/middle/last frames from the MP4 with ffmpeg."""
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries",
                            "stream=nb_read_packets,duration,r_frame_rate,width,height", "-of", "json", str(mp4)],
                           capture_output=True, text=True)
    s = json.loads(probe.stdout)["streams"][0]
    n = int(s["nb_read_packets"])
    paths = []
    for tag, idx in (("first", 0), ("middle", n // 2), ("last", n - 1)):
        dest = out_dir / f"{id_}_{tag}.png"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(mp4), "-vf", f"select=eq(n\\,{idx})", "-vframes", "1", str(dest)],
                       check=True)
        paths.append(dest)
    return paths, {"movie": mp4.name, "frames": n, "fps": s["r_frame_rate"], "size": [s["width"], s["height"]]}


def main(id_, want_set=None):
    d = EIC / id_
    api = json.loads((d / "api.json").read_text())
    out = {"id": id_, "title": api["title"]}
    sets = frame_sets(api)
    print(f"== {id_} {api['title']}\nFrames sets:")
    for s in sets:
        print(f"   {s['name']:34} {s['w']}x{s['h']}  {s['url']}")
    out["frameSets"] = sets
    sdir = d / "samples"
    sdir.mkdir(exist_ok=True)

    chosen = next((s for s in sets if s["name"] == want_set), None) if want_set else pick_set(sets)
    sample_paths = []
    if chosen:
        try:
            names, subs = list_frames(chosen["url"])
        except Exception as e:
            names, subs = [], []
            print(f"   index fetch failed: {e}")
        print(f"Chosen set: {chosen['name']}  -> {len(names)} images, subfolders: {subs[:8]}")
        out["chosen"] = {**chosen, "count": len(names), "subfolders": subs[:20],
                         "firstName": names[:1], "lastName": names[-1:]}
        if names:
            for tag, i in (("first", 0), ("middle", len(names) // 2), ("last", len(names) - 1)):
                n = names[i]
                sample_paths.append(fetch(chosen["url"] + n, sdir / f"{id_}_{tag}_{n}"))
    if not sample_paths:
        mp4s = sorted(d.glob("*.mp4"))
        stills = [p for p in d.iterdir() if p.suffix.lower() in (".png", ".jpg") and "cbar" not in p.name.lower()
                  and "colorbar" not in p.name.lower() and p.parent == d]
        if mp4s and id_ == "5011":
            sample_paths, mv = samples_from_movie(mp4s[0], sdir, id_)
            out["movieSamples"] = mv
            print("No usable frame folder: samples from", mv)
        else:
            sample_paths = [p for p in sorted(stills)[:1]]
            print("No frames listed: describing the downloaded still instead")
    out["samples"] = [describe_image(p) for p in sample_paths]
    for s in out["samples"]:
        print(f"   {s['file']}  {s['size']}  aspect={s['aspect']}  2:1={s['equirectangular_2to1']}  contentBox={s['contentBox']}")

    cbs = [p for p in d.iterdir() if re.search(r"cbar|colorbar|GMAO\.png", p.name, re.I)]
    out["colorbars"] = [{"file": str(p.relative_to(ROOT)), "size": list(Image.open(p).size)} for p in sorted(cbs)]
    print("Colorbars:", [(Path(c["file"]).name, c["size"]) for c in out["colorbars"]] or "none downloaded")
    (d / "inspect.json").write_text(json.dumps(out, indent=1))
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("id")
    ap.add_argument("--set")
    a = ap.parse_args()
    main(a.id, a.set)
