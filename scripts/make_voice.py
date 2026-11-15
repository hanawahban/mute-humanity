#!/usr/bin/env python3
"""Renders the narration with Kokoro, an open neural text-to-speech model, so the story is
spoken by a natural human-sounding voice instead of the browser's robotic one.

    pip install kokoro-onnx soundfile
    # model files (GitHub releases of thewh1teagle/kokoro-onnx, model-files-v1.0):
    #   kokoro-v1.0.int8.onnx -> scripts/tts/kokoro.onnx, voices-v1.0.bin -> scripts/tts/voices.bin
    python3 scripts/make_voice.py [path/to/kokoro.onnx path/to/voices.bin]

Text lives in src/config/narration.json (the app shows the same text as captions).
Output: public/voice/<id>.mp3
"""
import json
import subprocess

# Every file says it is AI-generated, in its own metadata (NASA Space Apps SI disclosure rules).
AI_TAGS = [
    "-metadata", "artist=AI-generated voice (Kokoro-82M text-to-speech)",
    "-metadata", "album=Melodic Earth Jukebox narration (Sonific-8)",
    "-metadata", "comment=AI-generated audio: synthesized with the Kokoro-82M open text-to-speech model, voice af_heart. Text by the Sonific-8 team, drafted with Claude (Anthropic).",
    "-metadata", "copyright=Sonific-8, NASA Space Apps 2026",
]
import sys
import tempfile
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = Path(__file__).resolve().parent.parent
cfg = json.loads((ROOT / "src" / "config" / "narration.json").read_text())
model = sys.argv[1] if len(sys.argv) > 2 else str(ROOT / "scripts" / "tts" / "kokoro.onnx")
voices = sys.argv[2] if len(sys.argv) > 2 else str(ROOT / "scripts" / "tts" / "voices.bin")
k = Kokoro(model, voices)
out = ROOT / "public" / "voice"
out.mkdir(parents=True, exist_ok=True)
only = set(sys.argv[3:])
for key, text in cfg["lines"].items():
    if only and key not in only:
        continue
    speed = float(__import__("os").environ.get("VOICE_SPEED", "0.93"))
    samples, sr = k.create(text, voice=cfg["voice"], speed=speed, lang="en-us")
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        sf.write(tmp.name, samples, sr)
        subprocess.check_call(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp.name, "-af", "apad=pad_dur=0.2", "-b:a", "96k", *AI_TAGS, str(out / f"{key}.mp3")])
    print(key, f"{len(samples) / sr:.1f}s")
