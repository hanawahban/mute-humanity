"""Open the first granule of a dataset and print its structure, then STOP.

    python -m pipeline.peek <reader-name>

Prints variables, dims, attributes and value range so the structure can be
confirmed before any processing code is trusted. Raw file stays in
pipeline/cache/inspect/ (not deleted until you confirm).
"""
import sys

import numpy as np

from . import access, config, sampling


def describe_h5(path):
    import h5py
    with h5py.File(path, "r") as f:
        print("root attrs:", {k: _s(v) for k, v in list(f.attrs.items())[:20]})
        items = []
        f.visititems(lambda n, o: items.append((n, o)) if isinstance(o, h5py.Dataset) else None)
        for name, ds in items:
            print(f"\n[{name}] shape={ds.shape} dtype={ds.dtype}")
            for k, v in ds.attrs.items():
                print(f"    @{k} = {_s(v)}")
            if ds.ndim >= 2 and ds.size <= 5e7 and ds.dtype.kind in "fiu":
                a = ds[...].astype(float)
                fill = ds.attrs.get("_FillValue")
                if fill is not None:
                    a[np.isclose(a, float(np.ravel(fill)[0]))] = np.nan
                ok = np.isfinite(a)
                if ok.any():
                    print(f"    range={a[ok].min():.6g}..{a[ok].max():.6g} valid={ok.mean():.1%}")


def _s(v):
    v = np.ravel(v)
    s = [x.decode() if isinstance(x, bytes) else x for x in v[:6]]
    return s[0] if len(s) == 1 else s


def describe_file(path):
    path = str(path)
    try:
        import h5py
        if h5py.is_hdf5(path):
            return describe_h5(path)
    except ImportError:
        pass
    try:
        import xarray as xr
        ds = xr.open_dataset(path)
        print(ds)
        for v in ds.data_vars:
            print(f"\n[{v}] dims={ds[v].dims} attrs={dict(ds[v].attrs)}")
            a = ds[v].values.astype(float)
            print(f"    range={np.nanmin(a):.6g}..{np.nanmax(a):.6g}")
        return
    except Exception as e:
        print("xarray failed:", e)
    try:
        from pyhdf.SD import SD
        sd = SD(path)
        for name, info in sd.datasets().items():
            print(f"\n[{name}] dims={info[0]} shape={info[1]}")
            print("   attrs:", sd.select(name).attributes())
    except Exception as e:
        print("cannot open file:", e)


def main(name):
    src = config.sources()
    ds = next((d for r in src["records"].values() for d in r["datasets"] if d["reader"] == name), None)
    if ds is None:
        sys.exit(f"no dataset with reader '{name}' in sources.yaml")
    if str(ds.get("short_name", "")).startswith("TODO"):
        sys.exit(f"{name}: short_name still TODO_verify in sources.yaml")
    y = ds["years"][0]
    first = (sampling.plan_dates(y, ds["sampling"]) or [None])[0] if "days" in ds["sampling"] else None
    start, end = (first.isoformat(),) * 2 if first else (f"{y}-01-01", f"{y}-12-31")
    found = access.find(ds["short_name"], start, end, version=ds.get("version"), count=1)
    if not found:  # product may start mid-year: widen to the whole start year, then the next
        print(f"no granule for {start}..{end}; widening search")
        for yy in (y, y + 1):
            found = access.find(ds["short_name"], f"{yy}-01-01", f"{yy}-12-31", version=ds.get("version"), count=1)
            if found:
                break
    if not found:
        sys.exit(f"no granules for {ds['short_name']} (version {ds.get('version')}) near {y}. "
                 f"Check the short name: search with earthaccess.search_datasets(keyword=...)")
    print("granule:", access.granule_name(found[0]))
    path = access.download(found[0], config.CACHE / "inspect" / name)
    print("file:", path)
    describe_file(path)
    print("\nSTOP: confirm structure above before processing.")


if __name__ == "__main__":
    main(sys.argv[1])
