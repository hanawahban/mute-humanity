"""OMNO2d v003 (HDF-EOS5): daily 0.25 deg tropospheric NO2, cloud screened.

Confirmed field: HDFEOS/GRIDS/ColumnAmountNO2/Data Fields/ColumnAmountNO2TropCloudScreened
Processing:
  - fill value (-1.2676506e30) and NaN -> NaN. Negatives are KEPT (retrieval noise near zero).
  - lat/lon axes come from StructMetadata.0 corner points, so row order is never assumed.
  - per day: pixel weights = Weight field if present (else 1) x cos(lat); regrid to 2 deg.
  - annual mean = weighted mean of the sampled days, then clipped at 0.
  - raw file deleted after regridding; raw units molec/cm2.
"""
import re

import numpy as np

from .. import access, config, regrid, sampling

NAME = "omno2d"
META = "HDFEOS INFORMATION/StructMetadata.0"


def parse_struct_metadata(text):
    """Return (ul_lon, ul_lat, lr_lon, lr_lat, xdim, ydim) of the first grid, in degrees."""
    def pair(key):
        m = re.search(rf"{key}=\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\)", text)
        if not m:
            raise ValueError(f"{key} not found in StructMetadata.0")
        return float(m.group(1)), float(m.group(2))
    ul, lr = pair("UpperLeftPointMtrs"), pair("LowerRightMtrs")
    x = int(re.search(r"XDim=(\d+)", text).group(1))
    y = int(re.search(r"YDim=(\d+)", text).group(1))
    # HDF-EOS stores geographic corners as packed DDDMMMSSS.SS unless already scaled to 1e6 degrees
    scale = 1e6 if max(abs(ul[0]), abs(ul[1]), abs(lr[0]), abs(lr[1])) > 1000 else 1.0
    return ul[0] / scale, ul[1] / scale, lr[0] / scale, lr[1] / scale, x, y


def axes_from_metadata(text, shape):
    ul_lon, ul_lat, lr_lon, lr_lat, x, y = parse_struct_metadata(text)
    if (y, x) != tuple(shape):
        raise ValueError(f"metadata dims {(y, x)} != data {shape}")
    lat = ul_lat + (lr_lat - ul_lat) * (np.arange(y) + 0.5) / y   # descending if UL is north
    lon = ul_lon + (lr_lon - ul_lon) * (np.arange(x) + 0.5) / x
    return lat, lon


def read_granule(path, hdfeos_path):
    """Return (data, weight|None, lat, lon). Fill -> NaN, negatives kept."""
    import h5py
    with h5py.File(path, "r") as f:
        ds = f[hdfeos_path]
        data = ds[...].astype(float)
        fill = ds.attrs.get("_FillValue")
        fill = float(np.ravel(fill)[0]) if fill is not None else None
        wpath = hdfeos_path.rsplit("/", 1)[0] + "/Weight"
        weight = f[wpath][...].astype(float) if wpath in f else None
        meta = f[META][()]
    text = meta.decode() if isinstance(meta, bytes) else str(meta)
    lat, lon = axes_from_metadata(text, data.shape)
    data = regrid.mask_invalid(data, fill=fill, valid_min=-1e29)  # only the fill is dropped
    if weight is not None:
        weight = regrid.mask_invalid(weight, valid_min=0.0)
        weight[weight <= 0] = np.nan
    return data, weight, lat, lon


def process_granule(path, hdfeos_path, use_weight=True):
    """-> (2, 90, 180): [weighted mean value, summed weight] on the common grid."""
    data, weight, lat, lon = read_granule(path, hdfeos_path)
    w = weight if (use_weight and weight is not None) else np.ones_like(data)
    w = np.where(np.isfinite(data), w, np.nan)
    d = np.where(np.isfinite(w), data, np.nan)
    num = regrid.regrid(d * w, lat, lon)
    den = regrid.regrid(w, lat, lon)
    with np.errstate(invalid="ignore", divide="ignore"):
        val = np.where(den > 0, num / den, np.nan)
    return np.stack([val, den])


def annual_mean(days):
    """days: list of (2,90,180) -> weighted mean grid clipped at 0 (NaN where no data)."""
    if not days:
        return np.full((90, 180), np.nan)
    a = np.stack(days)
    v, w = a[:, 0], a[:, 1]
    ok = np.isfinite(v) & np.isfinite(w) & (w > 0)
    sw = np.where(ok, w, 0).sum(axis=0)
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = np.where(sw > 0, np.where(ok, v * w, 0).sum(axis=0) / sw, np.nan)
    return np.where(np.isfinite(mean), np.maximum(mean, 0.0), np.nan)


def read_years(ds, record_id, record_cfg, years):
    layer = record_cfg["layers"][0]["id"]
    use_w = ds.get("use_weight", True)
    out = {}
    for year in years:
        days = sampling.plan_dates(year, ds["sampling"])
        got = []
        for day in days:
            key = day.isoformat()
            arr = access.load_processed(NAME, key)
            if arr is None:
                found = access.find(ds["short_name"], key, key, version=ds.get("version"), count=5)
                if not found:
                    access.log_granule(record_id, NAME, year, key, "-", "missing")
                    continue
                path = access.download(found[0], config.CACHE / "raw" / NAME)
                try:
                    arr = process_granule(path, ds["hdfeos_path"], use_w)
                finally:
                    path.unlink(missing_ok=True)  # keep only coarse outputs
                access.save_processed(NAME, key, arr)
                access.log_granule(record_id, NAME, year, key, access.granule_name(found[0]), "ok")
            else:
                access.log_granule(record_id, NAME, year, key, "-", "cached")
            got.append(arr)
        out[year] = {"grids": {layer: annual_mean(got)}, "planned": len(days), "used": len(got),
                     "partial": sampling.is_partial(year), "source": ds["short_name"]}
        print(f"omno2d {year}: {len(got)}/{len(days)} days")
    return out
