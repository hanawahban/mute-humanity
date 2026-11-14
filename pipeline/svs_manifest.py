"""Build public/eic/manifest.json from the saved api.json files and print a summary table.

    python -m pipeline.svs_manifest [ids...]      (default: the six records in config)

Dates come from text in the API (ISO timestamps in frame-set notes, 'Month YYYY' / 'YYYY to YYYY'
in titles and descriptions). Where the API gives none (the GEOS dashboard visuals), dateRange is null
and the real per-frame datetimes must be recorded when frames are downloaded.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EIC = ROOT / "public" / "eic"
IDS = ["3912", "5149", "5011", "5313", "5121", "5154"]
MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"
KIND = {".jpg": "still", ".jpeg": "still", ".png": "still", ".mp4": "movie", ".json": "api"}


def clean(t):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]*>", " ", t or "")).strip()


def find_dates(text):
    iso = sorted(set(re.findall(r"\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}Z?)?", text)))
    months = re.findall(rf"({MONTHS})\s+(20\d\d|19\d\d)", text)
    years = sorted(set(re.findall(r"\b(?:19|20)\d\d\b", text)))
    return iso, months, years


def date_range(api):
    texts = [api.get("title", ""), clean(api.get("description"))]
    frame_notes = []
    for g in api.get("media_groups", []):
        for it in g.get("items", []):
            i = it["instance"]
            if i.get("media_type") == "Frames" and i.get("alt_text"):
                frame_notes.append(i["alt_text"])
    iso = sorted({d for t in frame_notes for d in find_dates(t)[0]})
    if iso:
        return {"start": iso[0], "end": iso[-1], "source": "frame-set note (alt_text)"}
    iso, months, years = find_dates(" ".join(texts))
    if len(months) >= 2:
        return {"start": " ".join(months[0]), "end": " ".join(months[-1]), "source": "description"}
    if len(months) == 1:
        return {"start": " ".join(months[0]), "end": " ".join(months[0]), "source": "description"}
    if len(years) >= 2:
        return {"start": years[0], "end": years[-1], "source": "title/description"}
    return {"start": None, "end": None, "source": None}


def record(id_):
    d = EIC / id_
    api = json.loads((d / "api.json").read_text())
    frames = []
    for g in api.get("media_groups", []):
        for it in g.get("items", []):
            i = it["instance"]
            if i.get("media_type") == "Frames":
                frames.append({"name": i.get("filename"), "width": i.get("width"), "height": i.get("height"),
                               "url": (i.get("url") or "").replace("http://", "https://"), "note": clean(i.get("alt_text"))[:240]})
    files = [{"name": f.name, "kind": KIND.get(f.suffix.lower(), "other"), "bytes": f.stat().st_size}
             for f in sorted(d.iterdir()) if f.is_file()]
    credits = [{"role": c.get("role"), "people": [f"{p.get('name')} ({p.get('employer')})" if p.get("employer") else p.get("name")
                                                  for p in c.get("people", [])]} for c in api.get("credits", [])]
    dr = date_range(api)
    live = api.get("update_date", "")[:10] >= "2026-01-01" and id_ in ("5149", "5154")
    return {"id": id_, "title": api.get("title"), "pageUrl": (api.get("url") or "").replace("http://", "https://"),
            "releaseDate": api.get("release_date"), "updateDate": api.get("update_date"),
            "credits": credits, "dateRange": dr,
            "liveDashboard": live,
            "note": "EIC dashboard visual (model output); frames change as it updates. Record the exact datetime of every frame used." if live else None,
            "localFiles": files, "framesSets": frames}


def main(ids):
    recs = [record(i) for i in ids]
    out = EIC / "manifest.json"
    out.write_text(json.dumps({"records": recs}, indent=1))
    print(f"wrote {out.relative_to(ROOT)}\n")
    print(f"{'id':5} {'title':44} {'dates':32} {'MB':>6} files / frame sets")
    for r in recs:
        mb = sum(f["bytes"] for f in r["localFiles"]) / 1e6
        dr = r["dateRange"]
        ds = f"{dr['start']} .. {dr['end']}" if dr["start"] else "(none in API)"
        kinds = {}
        for f in r["localFiles"]:
            kinds[f["kind"]] = kinds.get(f["kind"], 0) + 1
        print(f"{r['id']:5} {r['title'][:43]:44} {ds[:31]:32} {mb:6.0f} {kinds} / {len(r['framesSets'])} sets")


if __name__ == "__main__":
    main(sys.argv[1:] or IDS)
