"""Region statistics and humanity level on the common grid."""
import numpy as np

from . import config
from .regrid import cell_centres


def region_mask(bbox, g=None):
    lat, lon = cell_centres(g)
    la = (lat >= bbox["south"]) & (lat <= bbox["north"])
    if bbox["west"] <= bbox["east"]:
        lo = (lon >= bbox["west"]) & (lon <= bbox["east"])
    else:  # wraps the antimeridian
        lo = (lon >= bbox["west"]) | (lon <= bbox["east"])
    return la[:, None] & lo[None, :]


def region_stats(series, bbox, g=None):
    """series (T, rows, cols) with NaN = null -> {mean[t], max[t], coverage[t]} (None where no data)."""
    mask = region_mask(bbox, g)
    lat, _ = cell_centres(g)
    w = np.broadcast_to(np.cos(np.deg2rad(lat))[:, None], mask.shape)
    mean, mx, cov = [], [], []
    for t in range(series.shape[0]):
        v = series[t][mask]
        wt = w[mask]
        ok = np.isfinite(v)
        cov.append(round(float(ok.mean()), 3) if v.size else 0.0)
        if ok.any():
            mean.append(round(float((v[ok] * wt[ok]).sum() / wt[ok].sum()), 3))
            mx.append(round(float(v[ok].max()), 3))
        else:
            mean.append(None)
            mx.append(None)
    return {"mean": mean, "max": mx, "coverage": cov}


def all_region_stats(layer_series, regions=None, g=None):
    """layer_series {layer: (T,r,c)} -> {region: {layer: stats}}."""
    regions = regions or config.regions()
    return {r["id"]: {lid: region_stats(s, r["bbox"], g) for lid, s in layer_series.items()}
            for r in regions}


def humanity(stats, human_layers):
    """Mean of normalized human layers' regional means, skipping layers with no data.

    stats: output of all_region_stats. Returns {global[t], byRegion{region[t]}} or None.
    """
    if not human_layers:
        return None

    def level(region_id):
        n = len(next(iter(stats[region_id].values()))["mean"])
        out = []
        for t in range(n):
            vals = [stats[region_id][l]["mean"][t] for l in human_layers
                    if stats[region_id][l]["mean"][t] is not None]
            out.append(round(float(np.mean(vals)), 3) if vals else None)
        return out

    return {"global": level("global"),
            "byRegion": {r: level(r) for r in stats if r != "global"}}
