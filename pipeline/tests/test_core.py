import numpy as np
import pandas as pd

from pipeline import fires, normalize, regions, regrid, splice


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


def test_sum_mode_and_min_valid_frac():
    lat, lon = _fine_grid(1.0)
    field = np.ones((lat.size, lon.size))
    out = regrid.regrid(field, lat, lon, mode="sum")
    assert np.allclose(out, 4.0)  # 2x2 one-degree cells per 2-degree cell
    field[:, :] = np.nan
    field[0, 0] = 1.0
    out = regrid.regrid(field, lat, lon, min_valid_frac=0.5)
    assert np.isnan(out).all()


def test_firms_type_split_and_aggregate():
    df = pd.DataFrame({
        "latitude": [10.1, 10.2, 10.3, -20.0], "longitude": [20.1, 20.2, 20.3, 150.0],
        "acq_date": ["2019-01-01"] * 4, "frp": [5.0, 10.0, 1.0, 2.0],
        "confidence": [90, 90, 90, 90], "type": [0, 2, 1, 3], "satellite": ["T"] * 4})
    tm = {"veg": [0], "industrial": [2, 3], "ignored": [1]}
    parts = fires.split_types(df, tm)
    assert len(parts["veg"]) == 1 and len(parts["industrial"]) == 2
    count, frp = fires.aggregate(parts["industrial"])
    assert count.sum() == 2 and frp.sum() == 12.0
    assert count[int((90 - 10.2) // 2), int((20.2 + 180) // 2)] == 1


def test_firms_load_filters(tmp_path):
    pd.DataFrame({
        "latitude": [1, 2, 3], "longitude": [1, 2, 3], "acq_date": ["2019-05-01"] * 3,
        "frp": [1.0, 1.0, 1.0], "confidence": [20, 50, 80], "type": [0, 0, 0],
        "satellite": ["T", "T", "A"]}).to_csv(tmp_path / "a.csv", index=False)
    df = fires.load_csvs(tmp_path, satellite="T", min_confidence=30)
    assert len(df) == 1 and df.iloc[0]["confidence"] == 50


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


def test_splice_ratio_recovers_known_factor():
    rng = np.random.default_rng(1)
    frm = rng.uniform(1, 2, (6, 90, 180))
    to = frm * 2.5
    to[:, :5, :5] = np.nan  # sparse corner falls back to global factor
    r = splice.compute_ratio(to, frm, "ratio_median", smooth=3)
    assert np.allclose(r, 2.5, atol=1e-6)
    r = splice.compute_ratio(to, frm, "ratio_of_means", smooth=3, clip=[0.5, 2.0])
    assert np.allclose(r, 2.0)  # clipped


def test_firms_zip_dedup_and_terra_names(tmp_path):
    import zipfile
    cols = "latitude,longitude,acq_date,acq_time,satellite,confidence,frp,type\n"
    a = cols + "10.0,20.0,2019-01-01,0137,Terra,90,5,0\n11.0,21.0,2019-01-01,0137,Aqua,90,5,0\n12.0,22.0,2019-01-01,0137,Terra,10,5,0\n"
    b = cols + "10.0,20.0,2019-01-01,0137,Terra,90,5,0\n13.0,23.0,2019-01-02,0900,Terra,80,2,2\n"  # first row = border duplicate
    zp = tmp_path / "modis_2019_all_countries.zip"
    with zipfile.ZipFile(zp, "w") as z:
        z.writestr("modis/2019/modis_2019_A.csv", a)
        z.writestr("modis/2019/modis_2019_B.csv", b)
    df, st = fires.load_year_zip(zp, "Terra", 30)
    assert st["rows_raw"] == 5 and st["rows_filtered"] == 3 and st["rows_dedup"] == 2
    assert set(df["type"]) == {0, 2}
