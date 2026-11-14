import numpy as np

from pipeline import build, config


def _res(val, planned=2, used=2, partial=False, src="X"):
    return {"grids": {"no2": np.full((90, 180), val)}, "planned": planned, "used": used,
            "partial": partial, "source": src}


def test_assemble_splices_and_nulls_sparse_years():
    src = config.sources()
    rec = src["records"]["no2"]
    per = {
        "sfc_no2": {y: _res(1.0, src="SFC") for y in range(2000, 2011)},
        "omno2d": {y: _res(2.0, src="OMI") for y in range(2005, 2012)},
    }
    per["omno2d"][2007] = _res(2.0, planned=2, used=0, src="OMI")      # < 50% -> null
    per["omno2d"][2011]["partial"] = True
    years, series, meta, smeta = build.assemble(rec, per, src, config.regions())
    s = series["no2"]
    i = years.index
    assert np.allclose(s[i(2001)], 2.0)            # surface scaled by OMI/surface ratio (2.0)
    assert np.allclose(s[i(2005)], 2.0)            # OMI as is
    assert np.isnan(s[i(2007)]).all() and "samples" in meta[i(2007)]["nullReason"]
    assert meta[i(2011)]["partial"] is True
    assert smeta[0]["from"] == "sfc_no2" and smeta[0]["year"] == 2005
