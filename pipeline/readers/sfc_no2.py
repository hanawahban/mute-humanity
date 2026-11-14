"""SFC_NITROGEN_DIOXIDE_CONC: annual mean surface NO2, 0.0083 deg, 60S-75N, land only.

Confirmed from first granule (SurfaceNO2_0.0083deg_<year>.nc, netCDF4/HDF5):
  variable SurfaceNO2 (lat, lon) float32, units ppbv, _FillValue -999,
  1-D lat/lon variables, 16200 x 43080.
The file is far too big to regrid at once, so rows are read in blocks and the
area-weighted sums are accumulated (exact across block edges). Values stay in
ppbv here; the NO2 splice rescales them to OMI column units (molec/cm2).
Annual product: one sample per year.
"""
import numpy as np

from .. import access, config, regrid, sampling

NAME = "sfc_no2"


def coarsen_file(path, variable, chunk_rows=400):
    import h5py
    with h5py.File(path, "r") as f:
        ds = f[variable]
        fill = ds.attrs.get("_FillValue")
        fill = float(np.ravel(fill)[0]) if fill is not None else None
        lat, lon = f["lat"][...], f["lon"][...]
        if ds.shape != (lat.size, lon.size):
            raise ValueError(f"{variable} {ds.shape} != lat/lon {(lat.size, lon.size)}")
        n = 90 * 180
        acc = [np.zeros(n), np.zeros(n), np.zeros(n)]
        for i in range(0, lat.size, chunk_rows):
            block = regrid.mask_invalid(ds[i:i + chunk_rows, :], fill=fill)
            for a, part in zip(acc, regrid.regrid_sums(block, lat[i:i + chunk_rows], lon)):
                a += part
    return regrid.finalize_mean(*acc)


def read_years(ds, record_id, record_cfg, years):
    layer = record_cfg["layers"][0]["id"]
    out = {}
    for year in years:
        key = str(year)
        g2 = access.load_processed(NAME, key)
        status = "cached"
        gname = "-"
        if g2 is None:
            found = access.find(ds["short_name"], f"{year}-01-01", f"{year}-12-31", count=10)
            found = [g for g in found if str(year) in access.granule_name(g)]
            if not found:
                access.log_granule(record_id, NAME, year, key, "-", "missing")
                out[year] = {"grids": {layer: np.full((90, 180), np.nan)}, "planned": 1, "used": 0,
                             "partial": False, "source": ds["short_name"]}
                continue
            path = access.download(found[0], config.CACHE / "raw" / NAME)
            try:
                g2 = coarsen_file(path, ds["variable"])
            finally:
                path.unlink(missing_ok=True)  # keep only coarse outputs
            access.save_processed(NAME, key, g2)
            status, gname = "ok", access.granule_name(found[0])
        access.log_granule(record_id, NAME, year, key, gname, status)
        out[year] = {"grids": {layer: g2}, "planned": 1, "used": 1,
                     "partial": sampling.is_partial(year), "source": ds["short_name"]}
        print(f"sfc_no2 {year}: {status}")
    return out
