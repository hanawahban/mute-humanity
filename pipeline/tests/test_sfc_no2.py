import h5py
import numpy as np

from pipeline.readers import sfc_no2


def _write(path, lat, lon, data):
    with h5py.File(path, "w") as f:
        d = f.create_dataset("SurfaceNO2", data=data.astype(np.float32))
        d.attrs["_FillValue"] = np.float32(-999)
        f.create_dataset("lat", data=lat)
        f.create_dataset("lon", data=lon)


def test_chunked_coarsen_is_exact_and_fill_is_null(tmp_path):
    res = 0.5
    lat = 75 - res * (np.arange(270) + 0.5)               # 75N..-60S, descending like the product
    lon = -179.5 + res * np.arange(718)
    data = np.full((lat.size, lon.size), 10.0)
    data[:, :40] = -999                                    # no data over the first 20 degrees
    data[:50, 100:140] = 30.0
    p = tmp_path / "s.nc"
    _write(p, lat, lon, data)
    a = sfc_no2.coarsen_file(p, "SurfaceNO2", chunk_rows=7)    # chunk edges cut across 2-degree cells
    b = sfc_no2.coarsen_file(p, "SurfaceNO2", chunk_rows=10000)
    assert np.allclose(a, b, equal_nan=True)
    assert np.isnan(a[:, :9]).all()                       # fill -> null, not 0
    assert np.isnan(a[:7]).all() and np.isnan(a[-1:]).all()    # outside 60S-75N
    assert np.isclose(np.nanmax(a), 30.0) and np.isclose(a[40, 150], 10.0)
