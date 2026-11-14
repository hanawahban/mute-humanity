"""Download one still per album cover from the NASA SVS API.

The API's JSON layout is searched generically for image URLs; confirm the
chosen file after the first run (printed).
"""
import re
from pathlib import Path

import requests

IMG = re.compile(r"\.(png|jpe?g)(\?|$)", re.I)


def _urls(obj):
    if isinstance(obj, dict):
        for v in obj.values():
            yield from _urls(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _urls(v)
    elif isinstance(obj, str) and obj.startswith("http") and IMG.search(obj):
        yield obj


def fetch_cover(svs_id, out_dir):
    r = requests.get(f"https://svs.gsfc.nasa.gov/api/{svs_id}", timeout=30)
    r.raise_for_status()
    urls = list(dict.fromkeys(_urls(r.json())))
    if not urls:
        raise RuntimeError(f"SVS {svs_id}: no image URL found in API response")
    # prefer something that is not a thumbnail
    pick = next((u for u in urls if not re.search(r"thumb|print|small|tn", u, re.I)), urls[0])
    dest = Path(out_dir) / "covers" / f"svs_{svs_id}{Path(pick.split('?')[0]).suffix}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(requests.get(pick, timeout=120).content)
    print(f"cover {svs_id}: {pick} -> {dest}")
    return dest.name, pick
