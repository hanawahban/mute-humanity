"""FIRMS MODIS archive -> yearly fire count and summed FRP per 2 deg cell.

Inputs in pipeline/cache/firms/ (nothing is downloaded by the pipeline):
  modis_<year>_all_countries.zip   one CSV per country inside; duplicates across countries dropped
  *.csv                            archive CSV (e.g. the partial current year), any years inside
Columns confirmed on a real file: latitude, longitude, brightness, scan, track, acq_date, acq_time,
satellite ("Terra"/"Aqua"), instrument, confidence, version, bright_t31, frp, daynight, type.
Rows kept: satellite == Terra, confidence >= min_confidence.
Types: 0 vegetation fire, 2 other static source + 3 offshore -> industrial, 1 volcano ignored.
Layers (record config order): veg_frp, veg_count, ind_frp, ind_count. Zero means no detection
(the sensor covers every cell); there is no null.
"""
import re
from pathlib import Path

import numpy as np
import pandas as pd

from .. import access, config, fires, sampling

NAME = "firms"
LAYER_KEYS = {"veg_fire_count": ("veg", 0), "veg_fire_frp": ("veg", 1),
              "ind_fire_count": ("industrial", 0), "ind_fire_frp": ("industrial", 1)}


def _directory(ds):
    d = Path(ds["dir"])
    return d if d.is_absolute() else config.ROOT / d


def _layers_from_df(df, type_map, layers):
    parts = fires.split_types(df, type_map)
    agg = {k: fires.aggregate(v) for k, v in parts.items()}      # (count, frp)
    return {lid: agg[LAYER_KEYS[lid][0]][LAYER_KEYS[lid][1]] for lid in layers}


def inventory(directory):
    """{year: ('zip', path)} for country ZIPs, plus the archive CSV paths."""
    zips, csvs = {}, []
    for p in sorted(Path(directory).iterdir()):
        m = re.search(r"modis_(\d{4})_", p.name)
        if p.suffix.lower() == ".zip" and m:
            zips[int(m.group(1))] = p
        elif p.suffix.lower() == ".csv":
            csvs.append(p)
    return zips, csvs


def read_years(ds, record_id, record_cfg, years):
    directory = _directory(ds)
    if not directory.exists():
        raise FileNotFoundError(f"{directory} missing: put modis_<year>_all_countries.zip and the archive CSV there")
    layers = [l["id"] for l in record_cfg["layers"]]
    zips, csvs = inventory(directory)
    archive = None
    out = {}
    for year in years:
        key = str(year)
        arr = access.load_processed(NAME, key)
        if arr is None:
            if year in zips:
                df, st = fires.load_year_zip(zips[year], ds["satellite"], ds["min_confidence"])
                src = zips[year].name
                print(f"firms {year}: {st['rows_raw']:,} raw -> {st['rows_filtered']:,} kept -> {st['rows_dedup']:,} after dedup ({st['files']} files)")
            else:
                if archive is None and csvs:
                    archive = fires.dedup(fires.load_csvs(directory, ds["satellite"], ds["min_confidence"]))
                df = archive[archive["year"] == year] if archive is not None else pd.DataFrame()
                src = "archive csv"
                if len(df) == 0:
                    access.log_granule(record_id, NAME, year, key, "-", "missing")
                    out[year] = {"grids": {l: np.full((90, 180), np.nan) for l in layers}, "planned": 1, "used": 0,
                                 "partial": False, "source": "FIRMS MODIS"}
                    continue
            g = _layers_from_df(df, ds["type_map"], layers)
            arr = np.stack([g[l] for l in layers])
            access.save_processed(NAME, key, arr)
            access.log_granule(record_id, NAME, year, key, src, "ok")
        else:
            access.log_granule(record_id, NAME, year, key, "-", "cached")
        out[year] = {"grids": {l: arr[i] for i, l in enumerate(layers)}, "planned": 1, "used": 1,
                     "partial": sampling.is_partial(year), "source": "FIRMS MODIS (Terra)"}
    return out


def coverage_report(ds, sample_year=None, step=0.1):
    """Estimate how many archive-CSV rows fall outside every country's area.

    Union of 0.1 deg cells that have any detection in the country ZIPs = 'covered'.
    Archive rows in cells never seen in the country files are counted as outside.
    Upper-bound estimate: a land fire in a never-burned cell also counts. Offshore/open-ocean
    detections (type 3 flares etc.) are the main thing this exposes."""
    directory = _directory(ds)
    zips, csvs = inventory(directory)
    n = int(180 / step) * int(360 / step)
    covered = np.zeros(n, dtype=bool)
    for y, z in sorted(zips.items()):
        df, _ = fires.load_year_zip(z, ds["satellite"], 0)
        covered[fires.cell_ids(df, step)] = True
    arch = fires.dedup(fires.load_csvs(directory, ds["satellite"], ds["min_confidence"]))
    ids = fires.cell_ids(arch, step)
    outside = ~covered[ids]
    by_type = arch.assign(outside=outside).groupby("type")["outside"].agg(["sum", "count"])
    print(f"archive rows (Terra, conf>={ds['min_confidence']}, deduped): {len(arch):,}")
    print(f"outside every country's detections: {int(outside.sum()):,} ({outside.mean():.1%})")
    print(by_type.rename(columns={"sum": "outside", "count": "total"}).to_string())
    return outside.mean()
