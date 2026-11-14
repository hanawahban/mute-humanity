"""OMNO2d v003 (HDF-EOS5): daily 0.25 deg tropospheric NO2, cloud screened.

Processing: open granule -> mask fill/negative -> regrid to 2 deg (area-weighted
mean) -> delete raw file -> annual mean of the sampled days.
Grid assumption (verified by inspect): 720 x 1440, lat -90..90 ascending,
lon -180..180, cell centres. read_grid() asserts this.
"""
import numpy as np

from .. import access, config, regrid, sampling

NAME = "omno2d"


def read_grid(path, hdfeos_path):
    """Return (data, lat, lon, fill) from one granule."""
    import h5py
    with h5py.File(path, "r") as f:
        ds = f[hdfeos_path]
        data = ds[...].astype(float)
        fill = ds.attrs.get("_FillValue")
        fill = float(np.ravel(fill)[0]) if fill is not None else None
    nlat, nlon = data.shape
    if (nlat, nlon) != (720, 1440):
        raise ValueError(f"unexpected OMNO2d grid {data.shape}; re-inspect")
    lat = -90 + 0.25 * (np.arange(nlat) + 0.5)
    lon = -180 + 0.25 * (np.arange(nlon) + 0.5)
    return data, lat, lon, fill


def process_granule(path, hdfeos_path):
    data, lat, lon, fill = read_grid(path, hdfeos_path)
    data = regrid.mask_invalid(data, fill=fill, valid_min=0.0)  # drop fill and negatives
    data[data == 0] = np.nan                                     # exact zeros are not retrievals
    return regrid.regrid(data, lat, lon)


def _find_day(ds, day):
    return access.find(ds["short_name"], day.isoformat(), day.isoformat(), version=ds.get("version"), count=5)


def read_years(ds, record_id, record_cfg, years):
    layer = record_cfg["layers"][0]["id"]
    out = {}
    for year in years:
        days = sampling.plan_dates(year, ds["sampling"])
        grids = []
        for day in days:
            key = day.isoformat()
            g2 = access.load_processed(NAME, key)
            if g2 is None:
                found = _find_day(ds, day)
                if not found:
                    access.log_granule(record_id, NAME, year, key, "-", "missing")
                    continue
                path = access.download(found[0], config.CACHE / "raw" / NAME)
                try:
                    g2 = process_granule(path, ds["hdfeos_path"])
                finally:
                    path.unlink(missing_ok=True)  # keep only coarse outputs
                access.save_processed(NAME, key, g2)
                access.log_granule(record_id, NAME, year, key, access.granule_name(found[0]), "ok")
            else:
                access.log_granule(record_id, NAME, year, key, "-", "cached")
            grids.append(g2)
        mean = regrid.nanmean_stack(grids)[0] if grids else np.full((90, 180), np.nan)
        out[year] = {"grids": {layer: mean}, "planned": len(days), "used": len(grids),
                     "partial": sampling.is_partial(year), "source": ds["short_name"]}
        print(f"omno2d {year}: {len(grids)}/{len(days)} days")
    return out
