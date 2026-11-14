"""Describe the music stems: format, key, tempo, and what each stem does over time.

    python pipeline/audio_tools/analyze_stems.py "<folder with the wav stems>"
"""
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import stft

NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def load(path):
    sr, x = wavfile.read(path)
    x = x.astype(float)
    m = x.mean(1) if x.ndim > 1 else x
    return sr, m / (np.abs(m).max() or 1), x.shape


def chroma(m, sr):
    f, _, Z = stft(m, sr, nperseg=8192)
    P = np.abs(Z).mean(1)
    sel = (f > 60) & (f < 2000)
    pc = np.round(12 * np.log2(f[sel] / 440) + 69).astype(int) % 12
    c = np.bincount(pc, weights=P[sel], minlength=12)
    return c / c.sum()


def key_of(c):
    return max((np.corrcoef(np.roll(p, k), c)[0, 1], NOTE[k], mode)
               for k in range(12) for p, mode in ((MAJ, "major"), (MIN, "minor")))


def tempo(m, sr, hop=512):
    _, _, Z = stft(m, sr, nperseg=2048, noverlap=2048 - hop)
    S = np.log1p(np.abs(Z))
    fl = np.maximum(np.diff(S, axis=1), 0).sum(0)
    fl = fl - fl.mean()
    ac = np.correlate(fl, fl, "full")[len(fl) - 1:]
    lags = np.arange(1, len(ac))
    bpm = 60 * (sr / hop) / lags
    ok = (bpm > 50) & (bpm < 180)
    top = np.argsort(-(ac[1:] * ok))[:5]
    return [round(float(bpm[i]), 1) for i in top]


def main(folder):
    d = Path(folder)
    sr, m, shape = load(d / "All.wav")
    print(f"sample rate {sr}  shape {shape}  duration {len(m) / sr:.2f}s", flush=True)
    c = chroma(m, sr)
    r, k, mode = key_of(c)
    print(f"key (All): {k} {mode}  r={r:.2f}   top pitch classes: {[NOTE[i] for i in np.argsort(-c)[:6]]}", flush=True)
    print("tempo candidates (bpm):", tempo(m, sr), flush=True)
    print(f"\n{'stem':9} {'rms':>6} {'active':>7} {'centroid':>9} {'peak Hz':>8}  top notes     active beats (0.5 s bins, > 20% of own max)", flush=True)
    for p in sorted(d.glob("*.wav")):
        if p.stem == "All":
            continue
        sr, m, _ = load(p)
        f, t, Z = stft(m, sr, nperseg=8192)
        P = np.abs(Z)
        cen = (f[:, None] * P).sum() / P.sum()
        band = (f > 50) & (f < 4000)
        peak = f[band][np.argmax(P.mean(1)[band])]
        step = sr // 2                      # half-second bins = one beat at ~120 bpm
        n = len(m) // step
        rms = np.array([np.sqrt((m[i * step:(i + 1) * step] ** 2).mean()) for i in range(n)])
        act = rms > 0.2 * rms.max()
        bins = "".join("#" if a else "." for a in act)
        cc = chroma(m, sr)
        print(f"{p.stem:9} {np.sqrt((m ** 2).mean()):6.3f} {act.mean() * 100:6.0f}% {cen:8.0f}  {peak:7.0f}   {','.join(NOTE[i] for i in np.argsort(-cc)[:3]):12} {bins}", flush=True)


if __name__ == "__main__":
    main(sys.argv[1])
