"""Splice two datasets of one record into a single comparable series."""
import numpy as np
from scipy import ndimage

from .regions import region_mask


def smooth_nan(a, size=3):
    """size x size mean over valid cells only (NaN-aware); NaN cells stay NaN if no valid neighbours."""
    if not size or size <= 1:
        return a
    ok = np.isfinite(a)
    s = ndimage.uniform_filter(np.where(ok, a, 0.0), size=size, mode="nearest")
    c = ndimage.uniform_filter(ok.astype(float), size=size, mode="nearest")
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(c > 0, s / c, np.nan)


def compute_ratio(to_stack, from_stack, method, smooth=3, clip=None, regions=None, min_years=2):
    """Per-cell factor so that from * factor ~ to over the overlap.

    to_stack, from_stack: (Y, rows, cols), same years.
    method: ratio_median  - median over years of per-year ratio
            ratio_of_means - mean(to) / mean(from)
    Sparse cells (fewer than min_years valid) fall back to the regional, then global, median factor.
    """
    with np.errstate(invalid="ignore", divide="ignore"):
        if method == "ratio_median":
            r = np.where((from_stack > 0) & np.isfinite(to_stack), to_stack / from_stack, np.nan)
            n = np.isfinite(r).sum(axis=0)
            with np.errstate(all="ignore"):
                ratio = np.nanmedian(r, axis=0)
        elif method == "ratio_of_means":
            both = np.isfinite(to_stack) & np.isfinite(from_stack) & (from_stack > 0)
            n = both.sum(axis=0)
            tm = np.where(both, to_stack, np.nan)
            fm = np.where(both, from_stack, np.nan)
            with np.errstate(all="ignore"):
                ratio = np.nanmean(tm, axis=0) / np.nanmean(fm, axis=0)
        else:
            raise ValueError(method)
    ratio = np.where(n >= min_years, ratio, np.nan)
    ratio = smooth_nan(ratio, smooth)
    valid = np.isfinite(ratio)
    if not valid.any():
        raise ValueError("no overlap: cannot compute splice ratio")
    gmed = float(np.median(ratio[valid]))
    out = ratio.copy()
    for reg in regions or []:
        m = region_mask(reg["bbox"])
        vm = m & valid
        if reg["id"] != "global" and vm.sum() >= 3:
            out[m & ~valid] = np.median(ratio[vm])
    out[~np.isfinite(out)] = gmed
    if clip:
        out = np.clip(out, clip[0], clip[1])
    return out


def apply_ratio(stack, ratio):
    return stack * ratio[None, :, :]
