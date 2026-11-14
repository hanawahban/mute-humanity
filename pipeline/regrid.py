"""Regrid to the common coarse grid (default 2 deg, 90 x 180).

Cell centres: lat = lat0 - res*(i+0.5), lon = lon0 + res*(j+0.5).
Mean mode is area-weighted (cos latitude). Sum mode adds raw values.
Cells with no valid input are NaN (null), never 0.
"""
import numpy as np

from . import config


def to_180(lon):
    """Convert any longitude convention (0..360 or -180..180) to -180..180."""
    return ((np.asarray(lon, dtype=float) + 180.0) % 360.0) - 180.0


def mask_invalid(a, fill=None, valid_min=None, valid_max=None):
    """Return float array with fill values, NaN and out-of-range values set to NaN."""
    a = np.array(a, dtype=float, copy=True)
    if fill is not None:
        a[np.isclose(a, fill, rtol=1e-6, atol=0)] = np.nan
    if valid_min is not None:
        a[a < valid_min] = np.nan
    if valid_max is not None:
        a[a > valid_max] = np.nan
    return a


def cell_centres(g=None):
    g = g or config.grid()
    lat = g["lat0"] - g["res"] * (np.arange(g["rows"]) + 0.5)
    lon = g["lon0"] + g["res"] * (np.arange(g["cols"]) + 0.5)
    return lat, lon


def regrid_sums(data, lat, lon, g=None):
    """Accumulators for one block: (sum w*v, sum w over valid, sum w over all), each flat (rows*cols,).

    Blocks can be added together, so huge grids can be coarsened in row chunks.
    """
    g = g or config.grid()
    rows, cols, res = g["rows"], g["cols"], g["res"]
    data = np.asarray(data, dtype=float)
    lat = np.asarray(lat, dtype=float)
    lon = to_180(lon)
    if data.shape != (lat.size, lon.size):
        raise ValueError(f"data {data.shape} does not match lat {lat.size} x lon {lon.size}")
    ri = np.clip(np.floor((g["lat0"] - lat) / res).astype(int), 0, rows - 1)
    ci = np.floor((lon - g["lon0"]) / res).astype(int) % cols
    flat = (ri[:, None] * cols + ci[None, :]).ravel()
    w = np.broadcast_to(np.cos(np.deg2rad(lat))[:, None], data.shape).ravel()
    v = data.ravel()
    ok = np.isfinite(v)
    n = rows * cols
    sw = np.bincount(flat[ok], weights=(w * v)[ok], minlength=n)
    wv = np.bincount(flat[ok], weights=w[ok], minlength=n)
    wt = np.bincount(flat, weights=w, minlength=n)
    return sw, wv, wt


def finalize_mean(sw, wv, wt, min_valid_frac=0.0, g=None):
    g = g or config.grid()
    with np.errstate(invalid="ignore", divide="ignore"):
        out = np.where(wv > 0, sw / wv, np.nan)
        frac = np.where(wt > 0, wv / wt, 0.0)
    out = np.where(frac >= max(min_valid_frac, 1e-12), out, np.nan)
    return out.reshape(g["rows"], g["cols"])


def regrid(data, lat, lon, mode="mean", min_valid_frac=0.0, g=None):
    """Regrid a 2-D field (nlat, nlon) with 1-D cell-centre lat/lon to the common grid.

    Any lat orientation and any lon convention is accepted.
    min_valid_frac: mean mode only; cell becomes NaN if the valid share of
    source area in the cell is below this.
    """
    g = g or config.grid()
    if mode == "mean":
        return finalize_mean(*regrid_sums(data, lat, lon, g), min_valid_frac, g)
    if mode != "sum":
        raise ValueError(mode)
    data = np.asarray(data, dtype=float)
    lat = np.asarray(lat, dtype=float)
    lon = to_180(lon)
    if data.shape != (lat.size, lon.size):
        raise ValueError(f"data {data.shape} does not match lat {lat.size} x lon {lon.size}")
    rows, cols, res = g["rows"], g["cols"], g["res"]
    ri = np.clip(np.floor((g["lat0"] - lat) / res).astype(int), 0, rows - 1)
    ci = np.floor((lon - g["lon0"]) / res).astype(int) % cols
    flat = (ri[:, None] * cols + ci[None, :]).ravel()
    v = data.ravel()
    ok = np.isfinite(v)
    s = np.bincount(flat[ok], weights=v[ok], minlength=rows * cols)
    cnt = np.bincount(flat[ok], minlength=rows * cols)
    return np.where(cnt > 0, s, np.nan).reshape(rows, cols)


def nanmean_stack(grids):
    """Mean over a list of grids ignoring NaN. Returns (mean, count)."""
    arr = np.stack(grids)
    cnt = np.isfinite(arr).sum(axis=0)
    with np.errstate(invalid="ignore"):
        s = np.nansum(arr, axis=0)
    return np.where(cnt > 0, s / np.maximum(cnt, 1), np.nan), cnt
