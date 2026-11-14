"""FIRMS archive CSV -> per-year, per-2deg-cell fire count and summed FRP."""
from pathlib import Path

import numpy as np
import pandas as pd

from . import config

COLS = ["latitude", "longitude", "acq_date", "frp", "confidence", "type", "satellite"]


def load_csvs(directory, satellite="T", min_confidence=30):
    """Read every CSV in directory (archive may come in chunks). Keeps only the
    wanted satellite and confidence >= min_confidence. Returns a DataFrame."""
    files = sorted(Path(directory).glob("*.csv"))
    if not files:
        raise FileNotFoundError(f"no FIRMS CSVs in {directory}")
    parts = []
    for f in files:
        df = pd.read_csv(f, usecols=lambda c: c in COLS, dtype={"satellite": str})
        n0 = len(df)
        df = df[df["satellite"].str.strip() == satellite]
        df = df[df["confidence"] >= min_confidence]
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
