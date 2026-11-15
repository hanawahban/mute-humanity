"""What does all.mp3 (the full arrangement) do harmonically? Key, chord per bar, bass line,
pitch-class energy, and how much of it falls outside A major.

    python3 pipeline/audio_tools/analyze_all.py public/sounds/all.mp3 [bpm]
"""
import subprocess
import sys
import tempfile

import numpy as np
from scipy.io import wavfile
from scipy.signal import stft

NOTE = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"]  # semitones above A
IN_KEY = {0, 2, 4, 5, 7, 9, 11}
TEMPLATES = {"": [0, 4, 7], "m": [0, 3, 7], "sus2": [0, 2, 7], "sus4": [0, 5, 7], "maj7": [0, 4, 7, 11], "7": [0, 4, 7, 10], "m7": [0, 3, 7, 10], "dim": [0, 3, 6]}


def load(path, sr=22050):
    with tempfile.NamedTemporaryFile(suffix=".wav") as t:
        subprocess.check_call(["ffmpeg", "-y", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", str(sr), t.name])
        r, x = wavfile.read(t.name)
    x = x.astype(float)
    return r, x / (np.abs(x).max() or 1)


def pc_energy(x, sr, lo=55, hi=2000):
    n = min(16384, len(x))
    f, _, Z = stft(x, sr, nperseg=n, noverlap=n * 3 // 4)
    P = (np.abs(Z) ** 2).mean(1)
    sel = (f > lo) & (f < hi)
    pc = np.round(12 * np.log2(f[sel] / 440)).astype(int) % 12  # semitones above A
    e = np.bincount(pc, weights=P[sel], minlength=12)
    return e / e.sum()


def chord_of(chroma):
    best = (-1, None)
    for root in range(12):
        for name, tpl in TEMPLATES.items():
            t = np.zeros(12)
            for i in tpl:
                t[(root + i) % 12] = 1
            score = np.dot(chroma, t) / (np.linalg.norm(t) + 1e-9) - 0.12 * (len(tpl) - 3)
            if score > best[0]:
                best = (score, f"{NOTE[root]}{name}")
    return best[1]


def bass_note(x, sr, lo=40, hi=200):
    n = min(16384, len(x))
    f, _, Z = stft(x, sr, nperseg=n, noverlap=n * 3 // 4)
    P = np.abs(Z).mean(1)
    sel = (f > lo) & (f < hi)
    k = np.argmax(P[sel])
    fr = f[sel][k]
    return NOTE[int(np.round(12 * np.log2(fr / 440))) % 12], fr


def main(path, bpm=120.0):
    sr, x = load(path)
    print(f"{path}: {len(x) / sr:.2f} s")
    e = pc_energy(x, sr)
    print("\npitch-class energy (share of total):")
    for i in np.argsort(-e):
        print(f"  {NOTE[i]:3} {100 * e[i]:5.1f}%  {'in A major' if i in IN_KEY else 'OUT of key'}")
    out = sum(e[i] for i in range(12) if i not in IN_KEY)
    print(f"  -> out-of-key energy: {100 * out:.1f}%")
    bar = 4 * 60 / bpm
    beat = 60 / bpm
    print(f"\nbpm {bpm}: bar = {bar:.2f} s")
    print("\nchord per bar (full mix) and bass note:")
    for b in range(int(len(x) / sr / bar)):
        seg = x[int(b * bar * sr): int((b + 1) * bar * sr)]
        c = pc_energy(seg, sr, 80, 1500)
        bn, bf = bass_note(seg, sr)
        print(f"  bar {b + 1} ({b * bar:4.1f}-{(b + 1) * bar:4.1f} s)  chord {chord_of(c):6}  bass {bn} ({bf:.0f} Hz)  top pcs {[NOTE[i] for i in np.argsort(-c)[:4]]}")
    print("\nchord per beat:")
    row = []
    for b in range(int(len(x) / sr / beat)):
        seg = x[int(b * beat * sr): int((b + 1) * beat * sr)]
        row.append(chord_of(pc_energy(seg, sr, 80, 1500)))
    for i in range(0, len(row), 4):
        print("  ", " | ".join(f"{c:6}" for c in row[i:i + 4]))


if __name__ == "__main__":
    main(sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 120.0)
