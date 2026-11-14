"""Paths and config loading. Nothing dataset-specific lives in code."""
from pathlib import Path

import yaml

PIPE = Path(__file__).resolve().parent
ROOT = PIPE.parent
CACHE = PIPE / "cache"
LOGS = PIPE / "logs"
OUT = ROOT / "public" / "data"


def _load(name):
    return yaml.safe_load((PIPE / "config" / name).read_text())


def sources():
    return _load("sources.yaml")


def regions():
    return _load("regions.yaml")["regions"]


def grid():
    return sources()["grid"]
