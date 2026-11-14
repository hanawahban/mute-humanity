"""FIRMS archive CSV -> per-year, per-2deg-cell fire count and summed FRP."""
from pathlib import Path

import numpy as np
import pandas as pd

from . import config

COLS = ["latitude", "longitude", "acq_date", "acq_time", "frp", "confidence", "type", "satellite"]


SAT_NAMES = {"T": {"T", "Terra"}, "Terra": {"T", "Terra"}, "A": {"A", "Aqua"}, "Aqua": {"A", "Aqua"}}
DEDUP = ["latitude", "longitude", "acq_date", "acq_time", "satellite"]


def keep_rows(df, satellite="Terra", min_confidence=30):
    """Wanted satellite (accepts 'T' or 'Terra' spellings) and confidence >= min_confidence."""
    names = SAT_NAMES.get(satellite, {satellite})
    return df[df["satellite"].astype(str).str.strip().isin(names) & (df["confidence"] >= min_confidence)]


def dedup(df):
    """Drop duplicate detections (same lat, lon, date, time, satellite), e.g. border pixels in two countries."""
    return df.drop_duplicates(subset=[c for c in DEDUP if c in df.columns])


def _csv_sources(path):
    """Yield (name, binary file object) for each CSV in a yearly ZIP or an extracted folder."""
    import zipfile
    path = Path(path)
    if path.is_dir():
        for f in sorted(path.rglob("*.csv")):
            with f.open("rb") as fh:
                yield f.name, fh
    else:
        with zipfile.ZipFile(path) as z:
            for name in sorted(n for n in z.namelist() if n.lower().endswith(".csv")):
                with z.open(name) as fh:
                    yield name, fh


def load_year_zip(zip_path, satellite="Terra", min_confidence=30):
    """One yearly country ZIP (or extracted folder; one CSV per country) -> deduplicated, filtered DataFrame.
    Returns (df, stats) with row counts before and after filtering and dedup."""
    parts, n_raw = [], 0
    for _, f in _csv_sources(zip_path):
        df = pd.read_csv(f, usecols=lambda c: c in COLS, dtype={"satellite": str, "acq_time": str})
        n_raw += len(df)
        parts.append(keep_rows(df, satellite, min_confidence))
    out = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=COLS)
    n_filtered = len(out)
    out = dedup(out)
    return out, {"rows_raw": n_raw, "rows_filtered": n_filtered, "rows_dedup": len(out), "files": len(parts)}


def cell_ids(df, step=0.1):
    """Integer id of the step-degree cell of each detection (for coverage estimates)."""
    r = np.floor((90 - df["latitude"].to_numpy()) / step).astype(int)
    c = np.floor((df["longitude"].to_numpy() + 180) / step).astype(int)
    return r * int(360 / step) + c


def load_csvs(directory, satellite="Terra", min_confidence=30):
    """Read every CSV in directory (archive may come in chunks). Keeps only the
    wanted satellite and confidence >= min_confidence. Returns a DataFrame."""
    files = sorted(Path(directory).glob("*.csv"))
    if not files:
        raise FileNotFoundError(f"no FIRMS CSVs in {directory}")
    parts = []
    for f in files:
        df = pd.read_csv(f, usecols=lambda c: c in COLS, dtype={"satellite": str, "acq_time": str})
        n0 = len(df)
        df = keep_rows(df, satellite, min_confidence)
        print(f"firms: {f.name}: {len(df)}/{n0} rows kept")
        parts.append(df)
    out = pd.concat(parts, ignore_index=True)
    out["year"] = pd.to_datetime(out["acq_date"]).dt.year
    return out


def split_types(df, type_map):
    """Return {'veg': df, 'industrial': df}. Types in type_map['ignored'] (volcano) are dropped."""
    return {k: df[df["type"].isin(type_map[k])] for k in ("veg", "industrial")}


def aggregate(df, g=None):
    """df rows -> (count, frp) grids (rows, cols). Zero where no fire (satellite covers all cells)."""
    g = g or config.grid()
    rows, cols, res = g["rows"], g["cols"], g["res"]
    ri = np.clip(np.floor((g["lat0"] - df["latitude"].to_numpy()) / res).astype(int), 0, rows - 1)
    lon = ((df["longitude"].to_numpy() + 180.0) % 360.0) - 180.0
    ci = np.floor((lon - g["lon0"]) / res).astype(int) % cols
    flat = ri * cols + ci
    n = rows * cols
    count = np.bincount(flat, minlength=n).astype(float).reshape(rows, cols)
    frp = np.bincount(flat, weights=df["frp"].to_numpy(dtype=float), minlength=n).reshape(rows, cols)
    return count, frp
