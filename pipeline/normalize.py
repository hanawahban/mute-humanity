"""Normalize to 0-1 using fixed physical ranges from config (percentile fallback)."""
import numpy as np


def percentile_range(arr, lo=2, hi=98):
    v = np.asarray(arr, dtype=float)
    v = v[np.isfinite(v)]
    if v.size == 0:
        return None, None
    return float(np.percentile(v, lo)), float(np.percentile(v, hi))


def normalize(arr, raw_min, raw_max, scale="linear"):
    """NaN stays NaN. Log scale clips values to raw_min first (zero -> 0.0)."""
    a = np.asarray(arr, dtype=float)
    if raw_min is None or raw_max is None or raw_max <= raw_min:
        raise ValueError("invalid range")
    if scale == "log":
        if raw_min <= 0:
            raise ValueError("log scale needs rawMin > 0")
        with np.errstate(invalid="ignore", divide="ignore"):
            x = np.log10(np.maximum(a, raw_min))
        lo, hi = np.log10(raw_min), np.log10(raw_max)
    else:
        x, lo, hi = a, raw_min, raw_max
    out = (x - lo) / (hi - lo)
    return np.clip(out, 0.0, 1.0)


def normalize_series(series, layer_cfg):
    """series: array (T, rows, cols), raw units, NaN = no data.

    Uses layer rawMin/rawMax when both set, else 2nd-98th percentile over ALL
    years so years stay comparable. Returns (norm, meta).
    """
    raw_min, raw_max = layer_cfg.get("rawMin"), layer_cfg.get("rawMax")
    source = "config"
    if raw_min is None or raw_max is None:
        raw_min, raw_max = percentile_range(series)
        source = "percentile_2_98"
        if raw_min is not None and layer_cfg["scale"] == "log":
            pos = series[np.isfinite(series) & (series > 0)]
            raw_min = float(np.percentile(pos, 2)) if pos.size else None
    finite = series[np.isfinite(series)]
    meta = {
        "rawMin": raw_min, "rawMax": raw_max, "rangeSource": source,
        "dataMin": float(finite.min()) if finite.size else None,
        "dataMax": float(finite.max()) if finite.size else None,
    }
    if raw_min is None or raw_max is None or raw_max <= raw_min:
        return np.full(series.shape, np.nan), meta
    return normalize(series, raw_min, raw_max, layer_cfg["scale"]), meta
