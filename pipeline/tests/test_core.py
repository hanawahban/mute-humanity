import numpy as np

from pipeline import normalize, regions, regrid


def _fine_grid(res=0.25):
    lat = 90 - res * (np.arange(int(180 / res)) + 0.5)
    lon = -180 + res * (np.arange(int(360 / res)) + 0.5)
    return lat, lon


def test_regrid_constant_field_is_exact():
    lat, lon = _fine_grid()
    out = regrid.regrid(np.full((lat.size, lon.size), 7.0), lat, lon)
    assert out.shape == (90, 180)
    assert np.allclose(out, 7.0)


def test_regrid_conserves_area_weighted_mean():
    lat, lon = _fine_grid()
    field = 10 + np.cos(np.deg2rad(lat))[:, None] * 5 + np.sin(np.deg2rad(lon))[None, :]
    out = regrid.regrid(field, lat, lon)
    wf = np.broadcast_to(np.cos(np.deg2rad(lat))[:, None], field.shape)
    src_mean = (field * wf).sum() / wf.sum()
    clat, _ = regrid.cell_centres()
    wc = np.broadcast_to(np.cos(np.deg2rad(clat))[:, None], out.shape)
    assert abs((out * wc).sum() / wc.sum() - src_mean) / src_mean < 1e-3


def test_regrid_handles_0_360_lon_and_flipped_lat():
    lat, lon = _fine_grid()
    lon360 = np.where(lon < 0, lon + 360, lon)
    order = np.argsort(lon360)
    field = np.broadcast_to(np.sign(lon)[None, :], (lat.size, lon.size)).copy()
    a = regrid.regrid(field, lat, lon)
    b = regrid.regrid(field[::-1][:, order], lat[::-1], lon360[order])
    assert np.allclose(a, b)
    assert a[45, 0] == -1 and a[45, 179] == 1


def test_fill_values_become_null():
    a = np.array([[1.0, -3000.0], [np.nan, -1.267651e30]])
    m = regrid.mask_invalid(a, fill=-3000, valid_min=-1e29)
    assert np.isnan(m).sum() == 3 and m[0, 0] == 1.0
    lat, lon = np.array([45.0, -45.0]), np.array([-90.0, 90.0])
    out = regrid.regrid(np.full((2, 2), np.nan), lat, lon)
    assert np.isnan(out).all()  # null, not 0


def test_region_stats_known_grid():
    series = np.full((2, 90, 180), np.nan)
    box = {"south": 0, "north": 10, "west": 0, "east": 10}
    m = regions.region_mask(box)
    assert m.sum() == 25  # 5 x 5 cells of 2 degrees
    series[0][m] = 0.5
    series[0][np.where(m)[0][0], np.where(m)[1][0]] = 1.0
    series[1][m] = np.nan
    s = regions.region_stats(series, box)
    assert s["max"] == [1.0, None] and s["coverage"] == [1.0, 0.0]
    assert 0.5 < s["mean"][0] < 0.53 and s["mean"][1] is None


def test_region_wraps_antimeridian():
    m = regions.region_mask({"south": 20, "north": 40, "west": 135, "east": -145})
    lon = regrid.cell_centres()[1]
    cols = np.where(m.any(axis=0))[0]
    assert lon[cols].min() < -145 and lon[cols].max() > 135 and 0 not in cols[(lon[cols] > -140) & (lon[cols] < 130)]


def test_humanity_skips_missing():
    stats = {"global": {"a": {"mean": [0.2, None]}, "b": {"mean": [0.4, 0.6]}},
             "x": {"a": {"mean": [None, None]}, "b": {"mean": [None, None]}}}
    h = regions.humanity(stats, ["a", "b"])
    assert h["global"] == [0.3, 0.6] and h["byRegion"]["x"] == [None, None]


def test_normalize_linear_log_and_percentile():
    a = np.array([0.0, 5.0, 10.0, np.nan])
    n = normalize.normalize(a, 0, 10)
    assert np.allclose(n[:3], [0, 0.5, 1]) and np.isnan(n[3])
    n = normalize.normalize(np.array([1e14, 1e15, 1e16, 0.0]), 1e14, 1e16, "log")
    assert np.allclose(n, [0, 0.5, 1, 0])
    series = np.random.default_rng(0).uniform(0, 1, (3, 4, 4))
    out, meta = normalize.normalize_series(series, {"rawMin": None, "rawMax": None, "scale": "linear"})
    assert meta["rangeSource"] == "percentile_2_98" and 0 <= np.nanmin(out) and np.nanmax(out) <= 1
