"""Paths and config loading. Per-visual settings live in config/visuals.yaml."""
from pathlib import Path

import yaml

PIPE = Path(__file__).resolve().parent
ROOT = PIPE.parent
CACHE = PIPE / "cache"
LOGS = PIPE / "logs"
EIC = ROOT / "public" / "eic"
OUT = ROOT / "public" / "data"


def visuals():
    return yaml.safe_load((PIPE / "config" / "visuals.yaml").read_text())


def regions():
    return visuals()["regions"]


def grid():
    """Equirect grid (rows, cols, res, lat0, lon0)."""
    return visuals()["grid"]["equirect"]
