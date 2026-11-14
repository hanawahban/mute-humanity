"""Build one record end to end.

    python -m pipeline.build <record> [--years 2004 2006] [--no-png] [--cover]

access -> annual 2 deg grids -> splice -> normalize -> region stats ->
humanity -> JSON + overlay PNGs -> manifest.json entry.
"""
import argparse
import datetime as dt
import json

import numpy as np

from . import config, readers, regions as regmod, render, sampling, splice
from .normalize import normalize_series


def _enc(a, decimals):
    return [[[None if not np.isfinite(x) else round(float(x), decimals) for x in row] for row in g] for g in a]


def collect(record_id, rec, src, years_filter=None):
    """Read every dataset -> {dataset_reader: {year: YearResult}} (years limited by years_filter)."""
    out = {}
    for ds in rec["datasets"]:
        yrs = sampling.year_range(ds["years"])
        if years_filter:
            yrs = [y for y in yrs if years_filter[0] <= y <= years_filter[1]]
        if not yrs:
            continue
        out[ds["reader"]] = readers.get(ds["reader"]).read_years(ds, record_id, rec, yrs)
    return out


def assemble(rec, per_ds, src, regions):
    """Splice datasets into one series per layer. Returns (years, raw layer series, per-year meta, splice meta)."""
    frac = src["sampling_defaults"]["min_sample_fraction"]
    order = [d["reader"] for d in rec["datasets"] if d["reader"] in per_ds]
    splices = rec.get("splice", [])
    layers = [l["id"] for l in rec["layers"]]

    def usable(res):
        return res["planned"] > 0 and res["used"] / res["planned"] >= frac

    # choose the dataset per year: splices say who covers what; otherwise the latest dataset covering the year
    def source_for(year):
        for sp in splices:
            if sp["from"] in per_ds and year < sp["year"]:
                return sp["from"]
            if sp["to"] in per_ds and year >= sp["year"] and sp["to"] in per_ds:
                return sp["to"]
        for name in reversed(order):
            if year in per_ds[name]:
                return name
        return None

    adjust = {}
    splice_meta = []
    for sp in splices:
        if sp["from"] not in per_ds or sp["to"] not in per_ds:
            continue
        ov = [y for y in range(sp["overlap"][0], sp["overlap"][1] + 1)
              if y in per_ds[sp["from"]] and y in per_ds[sp["to"]]
              and usable(per_ds[sp["from"]][y]) and usable(per_ds[sp["to"]][y])]
        for lid in layers:
            to_s = np.stack([per_ds[sp["to"]][y]["grids"][lid] for y in ov])
            fr_s = np.stack([per_ds[sp["from"]][y]["grids"][lid] for y in ov])
            adjust[(sp["from"], lid)] = splice.compute_ratio(
                to_s, fr_s, sp["method"], sp.get("smooth", 3), sp.get("clip"), regions)
        splice_meta.append({"year": sp["year"], "from": sp["from"], "to": sp["to"],
                            "method": sp["method"], "overlapYears": ov})

    all_years = sorted({y for d in per_ds.values() for y in d})
    years, meta = [], []
    series = {l: [] for l in layers}
    for y in all_years:
        name = source_for(y)
        res = per_ds[name].get(y) if name else None
        m = {"year": y, "source": res["source"] if res else None,
             "sampled": {"planned": res["planned"], "used": res["used"]} if res else None,
             "partial": bool(res and res["partial"]) if res else False, "nullReason": None}
        ok = res is not None and usable(res)
        if res is not None and not ok:
            m["nullReason"] = f"only {res['used']}/{res['planned']} samples (< {frac:.0%})"
        if res is None:
            m["nullReason"] = "no data"
        years.append(y)
        meta.append(m)
        for lid in layers:
            g = res["grids"][lid] if ok else np.full((90, 180), np.nan)
            if ok and (name, lid) in adjust:
                g = g * adjust[(name, lid)]
            series[lid].append(g)
    return years, {l: np.stack(v) for l, v in series.items()}, meta, splice_meta


def build_record(record_id, years_filter=None, png=True, cover=False):
    src = config.sources()
    rec = src["records"][record_id]
    regions = config.regions()
    per_ds = collect(record_id, rec, src, years_filter)
    years, raw, ymeta, smeta = assemble(rec, per_ds, src, regions)
    if not years:
        raise RuntimeError("no years produced")

    layer_cfg = {l["id"]: l for l in rec["layers"]}
    norm, layer_meta = {}, []
    for lid, s in raw.items():
        n, m = normalize_series(s, layer_cfg[lid])
        norm[lid] = n
        lm = {"id": lid, "group": layer_cfg[lid]["group"], "units": layer_cfg[lid]["units"],
              "scale": layer_cfg[lid]["scale"], **m}
        if layer_cfg[lid].get("caveat"):
            lm["caveat"] = layer_cfg[lid]["caveat"]
        layer_meta.append(lm)

    stats = regmod.all_region_stats(norm, regions)
    human = [l["id"] for l in rec["layers"] if l["group"] == "human"]
    hum = regmod.humanity(stats, human)
    raw_stats = regmod.all_region_stats(raw, [r for r in regions])

    limit = src["limits"]["record_json_max_bytes"]
    for decimals in (2, 1):
        doc = {"id": record_id, "times": years, "meta": ymeta,
               "layers": {lid: {"grid": _enc(norm[lid], decimals)} for lid in norm},
               "regionStats": stats, "rawRegionStats": raw_stats, "humanity": hum}
        text = json.dumps(doc, separators=(",", ":"))
        if len(text) <= limit:
            break
        print(f"{record_id}.json {len(text)/1e6:.2f} MB > limit at {decimals} decimals")
    if len(text) > limit:
        print(f"WARNING: {record_id}.json still {len(text)/1e6:.2f} MB; needs RLE or fewer cells")
    config.OUT.mkdir(parents=True, exist_ok=True)
    (config.OUT / f"{record_id}.json").write_text(text)
    print(f"wrote {record_id}.json ({len(text)/1e6:.2f} MB, {decimals} decimals)")

    if png:
        for lid in norm:
            render.render_layer(config.OUT, record_id, lid, years, norm[lid])

    cover_info = {"svsId": rec["cover_svs"]}
    if cover:
        from . import covers
        cover_info["file"], cover_info["url"] = covers.fetch_cover(rec["cover_svs"], config.OUT)

    entry = {
        "id": record_id, "title": rec["title"], "group": rec["group"], "cover": cover_info,
        "datasets": [{"shortName": d["short_name"], "doi": d.get("doi"),
                      "url": f"https://search.earthdata.nasa.gov/search?q={d['short_name']}",
                      "credit": "NASA"} for d in rec["datasets"]],
        "times": years, "partialYears": [m["year"] for m in ymeta if m["partial"]],
        "grid": src["grid"], "splice": smeta,
        "sampling": {d["reader"]: d["sampling"] for d in rec["datasets"]},
        "layers": layer_meta,
        "regions": [{"id": r["id"], "name": r["name"], "bbox": r["bbox"]} for r in regions],
        "builtAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    }
    mpath = config.OUT / "manifest.json"
    man = json.loads(mpath.read_text()) if mpath.exists() else {"records": []}
    man["records"] = [r for r in man["records"] if r["id"] != record_id] + [entry]
    mpath.write_text(json.dumps(man, indent=1))
    return doc


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("record")
    ap.add_argument("--years", nargs=2, type=int, metavar=("FROM", "TO"))
    ap.add_argument("--no-png", action="store_true")
    ap.add_argument("--cover", action="store_true")
    a = ap.parse_args()
    build_record(a.record, a.years, png=not a.no_png, cover=a.cover)
