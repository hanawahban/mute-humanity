import h5py
import numpy as np

from pipeline import regrid
from pipeline.readers import omno2d

PATH = "HDFEOS/GRIDS/ColumnAmountNO2/Data Fields/ColumnAmountNO2TropCloudScreened"
FILL = -1.2676506e30


def _meta(ul_lat, lr_lat):
    return (f"GROUP=GridStructure\n GROUP=GRID_1\n  XDim=1440\n  YDim=720\n"
            f"  UpperLeftPointMtrs=(-180000000.000000,{ul_lat * 1e6:.6f})\n"
            f"  LowerRightMtrs=(180000000.000000,{lr_lat * 1e6:.6f})\n")


def _write(path, field, north_first, weight=None):
    with h5py.File(path, "w") as f:
        d = f.create_dataset(PATH, data=field)
        d.attrs["_FillValue"] = np.float32(FILL)
        if weight is not None:
            f.create_dataset(PATH.rsplit("/", 1)[0] + "/Weight", data=weight)
        f.create_dataset("HDFEOS INFORMATION/StructMetadata.0",
                         data=np.bytes_(_meta(90, -90) if north_first else _meta(-90, 90)))


def _field(north_first):
    lat = -90 + 0.25 * (np.arange(720) + 0.5)
    f = np.zeros((720, 1440), dtype=np.float32)
    f[(lat > 30) & (lat < 40), :] = 5e15
    f[:, :4] = FILL
    return f[::-1] if north_first else f


def test_orientation_from_metadata_both_ways(tmp_path):
    outs = []
    for nf in (False, True):
        p = tmp_path / f"o{nf}.he5"
        _write(p, _field(nf), nf)
        outs.append(omno2d.process_granule(p, PATH)[0])
    assert np.allclose(outs[0], outs[1], equal_nan=True)
    lat = regrid.cell_centres()[0]
    row = int(np.nanargmax(np.nanmean(outs[0], axis=1)))
    assert 30 < lat[row] < 40


def test_fill_nan_negatives_kept_and_final_clip(tmp_path):
    f = np.full((720, 1440), -2e14, dtype=np.float32)
    f[:, :4] = FILL
    p = tmp_path / "n.he5"
    _write(p, f, True)
    day = omno2d.process_granule(p, PATH)
    v = day[0][np.isfinite(day[0])]
    assert np.allclose(v, -2e14)                      # negatives kept per pixel
    assert np.nanmax(omno2d.annual_mean([day])) == 0  # clipped at 0 after averaging


def test_weight_used_in_day_average():
    a = np.stack([np.full((90, 180), 1.0), np.full((90, 180), 1.0)])
    b = np.stack([np.full((90, 180), 3.0), np.full((90, 180), 3.0)])
    assert np.allclose(omno2d.annual_mean([a, b]), 2.5)  # (1*1 + 3*3) / 4
