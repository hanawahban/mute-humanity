"""Overlay PNGs: transparent, grayscale, equirectangular 1440 x 720.

NOTE: rendered from the 2 deg grid (bilinear upsample), so overlays are soft.
A finer 0.25 deg preview needs the readers to keep a fine annual field; not done yet.
"""
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

W, H = 1440, 720


def render_png(norm_grid, path):
    """norm_grid (rows, cols) in 0..1, NaN = transparent."""
    ok = np.isfinite(norm_grid)
    zoom = (H / norm_grid.shape[0], W / norm_grid.shape[1])
    val = ndimage.zoom(np.where(ok, norm_grid, 0.0), zoom, order=1)
    msk = ndimage.zoom(ok.astype(float), zoom, order=1)
    # edge cells blend with the 0 fill; renormalise where mask is partial
    with np.errstate(invalid="ignore", divide="ignore"):
        val = np.where(msk > 0.5, val / np.maximum(msk, 1e-6), 0.0)
    gray = (np.clip(val, 0, 1) * 255).astype(np.uint8)
    alpha = np.where(msk > 0.5, 255, 0).astype(np.uint8)
    img = np.dstack([gray, gray, gray, alpha])
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(img, "RGBA").save(path, optimize=True)


def render_layer(out_dir, record_id, layer_id, times, norm_series):
    paths = []
    for t, year in enumerate(times):
        p = Path(out_dir) / "overlays" / record_id / f"{layer_id}_{year}.png"
        render_png(norm_series[t], p)
        paths.append(p)
    return paths
