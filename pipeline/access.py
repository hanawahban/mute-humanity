"""Earthdata access (earthaccess), granule logging and processed-file cache.

Credentials: ~/.netrc entry for urs.earthdata.nasa.gov, or env
EARTHDATA_USERNAME / EARTHDATA_PASSWORD. Never printed or logged.
"""
import csv
import datetime as dt
import os
from pathlib import Path

import numpy as np

from . import config

_auth = None


def login():
    global _auth
    if _auth is None:
        import earthaccess
        strategy = "environment" if os.environ.get("EARTHDATA_USERNAME") else "netrc"
        _auth = earthaccess.login(strategy=strategy)
        if not _auth or not getattr(_auth, "authenticated", True):
            raise RuntimeError("Earthdata login failed: set ~/.netrc or EARTHDATA_USERNAME/PASSWORD")
    return _auth


def find(short_name, start, end, version=None, count=50, **kw):
    """Search granules for [start, end] (ISO date strings)."""
    import earthaccess
    login()
    args = dict(short_name=short_name, temporal=(start, end), count=count, **kw)
    if version:
        args["version"] = version
    return earthaccess.search_data(**args)


def granule_name(g):
    return g["umm"]["GranuleUR"]


def download(granule, dest_dir):
    """Download one granule to dest_dir; returns local Path."""
    import earthaccess
    login()
    Path(dest_dir).mkdir(parents=True, exist_ok=True)
    files = earthaccess.download([granule], str(dest_dir))
    if not files:
        raise RuntimeError(f"download failed: {granule_name(granule)}")
    return Path(files[0])


def log_granule(record, dataset, year, date, granule, status):
    """Append one line to pipeline/logs/<record>.csv."""
    config.LOGS.mkdir(exist_ok=True)
    path = config.LOGS / f"{record}.csv"
    new = not path.exists()
    with path.open("a", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["logged_at", "dataset", "year", "date", "granule", "status"])
        w.writerow([dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                    dataset, year, date, granule, status])


def processed_path(dataset, key):
    d = config.CACHE / "processed" / dataset
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{key}.npy"


def load_processed(dataset, key):
    p = processed_path(dataset, key)
    return np.load(p) if p.exists() else None


def save_processed(dataset, key, arr):
    np.save(processed_path(dataset, key), arr)
