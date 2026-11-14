"""Quality report for a built record.

    python -m pipeline.report <record>

Writes public/data/report/<record>/: contact sheet per layer, histograms,
report.md with % valid cells and the sanity table (expectations in sources.yaml).
"""
import json
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from . import config


def main(record_id):
    doc = json.loads((config.OUT / f"{record_id}.json").read_text())
    rec = config.sources()["records"][record_id]
    out = config.OUT / "report" / record_id
    out.mkdir(parents=True, exist_ok=True)
    times = doc["times"]
    lines = [f"# Report: {record_id}", f"years: {times[0]}-{times[-1]} ({len(times)})", ""]

    for lid, L in doc["layers"].items():
        g = np.array(L["grid"], dtype=float)  # None -> nan
        n = len(times)
        pick = np.unique(np.linspace(0, n - 1, min(n, 12)).astype(int))
        cols = 4
        fig, ax = plt.subplots(int(np.ceil(len(pick) / cols)), cols, figsize=(14, 2.4 * np.ceil(len(pick) / cols)))
        for a in np.ravel(ax):
            a.axis("off")
        for a, t in zip(np.ravel(ax), pick):
            a.imshow(g[t], vmin=0, vmax=1, cmap="viridis")
            a.set_title(str(times[t]), fontsize=8)
        fig.suptitle(f"{record_id}/{lid}")
        fig.savefig(out / f"{lid}_contact.png", dpi=80)
        plt.close(fig)

        fig, a = plt.subplots(figsize=(5, 3))
        v = g[np.isfinite(g)]
        a.hist(v, bins=50)
        a.set_title(f"{lid} normalized values")
        fig.savefig(out / f"{lid}_hist.png", dpi=80)
        plt.close(fig)

        valid = np.isfinite(g).mean(axis=(1, 2))
        lines.append(f"- {lid}: valid cells {valid.mean():.0%} avg (min {valid.min():.0%}, max {valid.max():.0%})")

    lines += ["", "## Sanity (region mean over all years vs global)", "", "| region | layer | expect | region | global | pass |", "|---|---|---|---|---|---|"]
    for s in rec.get("sanity", []):
        st = doc["regionStats"]
        m = lambda r: np.nanmean([x for x in st[r][s["layer"]]["mean"] if x is not None] or [np.nan])
        r, g_ = m(s["region"]), m("global")
        ok = (r > g_) if s["expect"] == "above_global" else (r < g_)
        lines.append(f"| {s['region']} | {s['layer']} | {s['expect']} | {r:.3f} | {g_:.3f} | {'PASS' if ok else 'FAIL'} |")
    (out / "report.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main(sys.argv[1])
